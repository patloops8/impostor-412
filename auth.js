// ===================== AUTH (login con Google / Discord) =====================
// Login opcional: la app funciona 100% sin loguearse (modo invitado, como
// siempre). Loguearse solo sirve para que las estadísticas/logros persistan
// entre partidas y dispositivos. Implementado a mano con fetch/https (sin
// passport ni express-session) porque la app ya es una SPA sin sesiones de
// servidor — la identidad viaja como un JWT que el cliente guarda en
// localStorage, igual que ya hace con el código de sala.
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const express = require('express');
const store = require('./store');

// Tope generoso para la imagen de perfil en base64 (el cliente ya la
// redimensiona/comprime antes de mandarla, pero esto evita que alguien
// mande un payload gigante directamente a la API).
const PROFILE_BODY_LIMIT = '400kb';

const JWT_SECRET = process.env.JWT_SECRET || '';
const JWT_MAX_AGE = '180d';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';

function baseUrl(req) {
  // APP_URL manda si está seteada (recomendado en producción); si no, se
  // arma con lo que Express ve de la request (útil para probar en local).
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

const googleEnabled = () => !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && JWT_SECRET && store.usingDb);
const discordEnabled = () => !!(DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && JWT_SECRET && store.usingDb);

// Anti-CSRF simple: un "state" de un solo uso con vencimiento corto, en
// memoria (no hace falta que sobreviva un redeploy, dura minutos).
const _pendingStates = new Map();
function newState() {
  const s = crypto.randomBytes(16).toString('hex');
  _pendingStates.set(s, Date.now() + 10 * 60 * 1000);
  return s;
}
function consumeState(s) {
  const exp = _pendingStates.get(s);
  _pendingStates.delete(s);
  return !!exp && exp > Date.now();
}
setInterval(() => {
  const now = Date.now();
  for (const [s, exp] of _pendingStates) if (exp <= now) _pendingStates.delete(s);
}, 5 * 60 * 1000);

function signToken(user) {
  // El JWT lleva el perfil EFECTIVO (nombre/foto personalizados si el
  // jugador los eligió, si no los del proveedor OAuth), para que se vea
  // bien apenas vuelve de loguearse sin esperar a /auth/me.
  const name = user.displayName || user.name;
  const avatar = user.avatarImage || user.avatarUrl;
  return jwt.sign({ uid: user.id, name, avatar, provider: user.provider }, JWT_SECRET, { expiresIn: JWT_MAX_AGE });
}
function verifyToken(token) {
  if (!JWT_SECRET || !token) return null;
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function registerAuthRoutes(app) {
  app.get('/auth/status', (_q, res) => {
    res.json({ google: googleEnabled(), discord: discordEnabled() });
  });

  // ---- Google ----
  app.get('/auth/google/start', (req, res) => {
    if (!googleEnabled()) return res.status(503).send('Login con Google no está configurado.');
    const state = newState();
    const redirectUri = `${baseUrl(req)}/auth/google/callback`;
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    res.redirect(url.toString());
  });

  app.get('/auth/google/callback', async (req, res) => {
    try {
      if (!googleEnabled()) return res.status(503).send('Login con Google no está configurado.');
      const { code, state } = req.query;
      if (!code || !consumeState(state)) return res.status(400).send('Solicitud inválida o vencida. Volvé a intentar desde la app.');
      const redirectUri = `${baseUrl(req)}/auth/google/callback`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      });
      const tokenJson = await tokenRes.json();
      if (!tokenJson.access_token) throw new Error(tokenJson.error_description || 'sin access_token');
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${tokenJson.access_token}` } });
      const profile = await profileRes.json();
      if (!profile.sub) throw new Error('perfil de Google sin sub');
      const user = await store.upsertUser({ provider: 'google', providerId: profile.sub, name: (profile.name || 'Jugador').slice(0, 60), avatarUrl: profile.picture || null });
      const jwtToken = signToken(user);
      res.redirect(`/?auth=${encodeURIComponent(jwtToken)}`);
    } catch (e) {
      console.error('[auth/google] error:', e.message);
      res.redirect('/?authError=1');
    }
  });

  // ---- Discord ----
  app.get('/auth/discord/start', (req, res) => {
    if (!discordEnabled()) return res.status(503).send('Login con Discord no está configurado.');
    const state = newState();
    const redirectUri = `${baseUrl(req)}/auth/discord/callback`;
    const url = new URL('https://discord.com/api/oauth2/authorize');
    url.searchParams.set('client_id', DISCORD_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'identify');
    url.searchParams.set('state', state);
    res.redirect(url.toString());
  });

  app.get('/auth/discord/callback', async (req, res) => {
    try {
      if (!discordEnabled()) return res.status(503).send('Login con Discord no está configurado.');
      const { code, state } = req.query;
      if (!code || !consumeState(state)) return res.status(400).send('Solicitud inválida o vencida. Volvé a intentar desde la app.');
      const redirectUri = `${baseUrl(req)}/auth/discord/callback`;
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: DISCORD_CLIENT_ID, client_secret: DISCORD_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      });
      const tokenJson = await tokenRes.json();
      if (!tokenJson.access_token) throw new Error(tokenJson.error_description || 'sin access_token');
      const profileRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tokenJson.access_token}` } });
      const profile = await profileRes.json();
      if (!profile.id) throw new Error('perfil de Discord sin id');
      const avatarUrl = profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null;
      const user = await store.upsertUser({ provider: 'discord', providerId: profile.id, name: (profile.global_name || profile.username || 'Jugador').slice(0, 60), avatarUrl });
      const jwtToken = signToken(user);
      res.redirect(`/?auth=${encodeURIComponent(jwtToken)}`);
    } catch (e) {
      console.error('[auth/discord] error:', e.message);
      res.redirect('/?authError=1');
    }
  });

  app.get('/auth/me', async (req, res) => {
    const decoded = verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!decoded) return res.status(401).json({ ok: false });
    const dbUser = await store.getUserById(decoded.uid);
    if (!dbUser) return res.status(401).json({ ok: false });
    const stats = await store.getUserStats(decoded.uid);
    const defs = await store.getAchievements();
    const history = await store.getGameHistory(decoded.uid, 20);
    // Reemitimos el JWT con el perfil actual: si el nombre/foto se editó
    // desde otro dispositivo, este también queda al día (el token viejo
    // guardado en localStorage es lo que viaja al crear/unirse a una sala).
    const token = signToken({ ...dbUser, provider: decoded.provider });
    res.json({ ok: true, user: profileView(dbUser, decoded.provider), stats, achievements: computeAchievements(stats, defs), history, token });
  });

  // Perfil de juego personalizado: el jugador puede elegir un nombre y una
  // foto propios para mostrar en el juego, sin tocar su nombre/foto real
  // de Google/Discord. Enviar displayName/avatarImage null o "" limpia esa
  // personalización y vuelve a mostrar el nombre/foto original del login.
  app.put('/auth/profile', express.json({ limit: PROFILE_BODY_LIMIT }), async (req, res) => {
    const decoded = verifyToken((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!decoded) return res.status(401).json({ error: 'No autenticado.' });
    let { displayName, avatarImage } = req.body || {};
    if (displayName != null) {
      displayName = String(displayName).trim().slice(0, 20);
      if (!displayName) displayName = null;
    }
    if (avatarImage != null && !/^data:image\/(png|jpeg|jpg|webp);base64,/.test(avatarImage)) {
      return res.status(400).json({ error: 'Imagen inválida.' });
    }
    const dbUser = await store.updateUserProfile(decoded.uid, { displayName, avatarImage });
    if (!dbUser) return res.status(500).json({ error: 'No se pudo guardar el perfil.' });
    // El cliente reemplaza el JWT guardado con este: si no lo hiciéramos,
    // el nombre/foto nuevos no se usarían al crear/unirse a una sala hasta
    // el próximo login (player:create_room manda el JWT tal cual al server).
    const token = signToken({ ...dbUser, provider: decoded.provider });
    res.json({ ok: true, user: profileView(dbUser, decoded.provider), token });
  });
}

function profileView(dbUser, provider) {
  return {
    id: dbUser.id,
    name: dbUser.displayName || dbUser.name,
    avatar: dbUser.avatarImage || dbUser.avatarUrl,
    provider,
    originalName: dbUser.name,
    originalAvatar: dbUser.avatarUrl,
    hasCustomName: !!dbUser.displayName,
    hasCustomAvatar: !!dbUser.avatarImage,
  };
}

// ---- Logros ----
// Las DEFINICIONES viven en la tabla `achievements` (editable desde el
// panel admin: agregar/borrar/editar, con ícono emoji o imagen propia).
// Lo que se calcula acá es solo si cada definición está desbloqueada,
// comparando su condición contra las estadísticas reales del jugador —
// así un logro nuevo que agregue el admin se evalúa retroactivamente
// para todo el mundo sin tocar una sola fila de player_stats.
const GAME_TYPES_LIST = ['impostor', 'mentiroso', 'subasta', 'wavelength', 'who'];
function achievementValue(def, stats){
  const byGame = {}; stats.forEach(s => { byGame[s.gameType] = s; });
  switch(def.conditionType){
    case 'total_played': return stats.reduce((s,x)=>s+x.gamesPlayed,0);
    case 'total_won': return stats.reduce((s,x)=>s+x.gamesWon,0);
    case 'game_played': return byGame[def.conditionGame]?.gamesPlayed || 0;
    case 'game_won': return byGame[def.conditionGame]?.gamesWon || 0;
    case 'distinct_played': return GAME_TYPES_LIST.filter(g=>(byGame[g]?.gamesPlayed||0)>0).length;
    case 'distinct_won': return GAME_TYPES_LIST.filter(g=>(byGame[g]?.gamesWon||0)>0).length;
    default: return 0;
  }
}
function computeAchievements(stats, defs) {
  return defs.map(d => {
    const value = achievementValue(d, stats);
    const goal = d.conditionGoal;
    return {
      key: d.key, iconEmoji: d.iconEmoji, iconImage: d.iconImage,
      titleEs: d.titleEs, titleEn: d.titleEn, descEs: d.descEs, descEn: d.descEn,
      progress: Math.min(value, goal), goal, unlocked: value >= goal,
    };
  });
}

module.exports = { registerAuthRoutes, verifyToken, googleEnabled, discordEnabled, computeAchievements };
