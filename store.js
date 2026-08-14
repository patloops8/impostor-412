// ===================== STORE (feedback + analytics) =====================
// Persistencia con fallback automático:
//   - Si existe DATABASE_URL (Postgres, ej. Neon/Supabase/Render Postgres):
//     todo se guarda ahí, sobrevive redeploys y reinicios del servidor.
//   - Si NO existe (desarrollo local sin base configurada): se usan los
//     mismos archivos data/feedback.json y data/analytics.json de antes,
//     así no hace falta nada extra para desarrollar en la máquina propia.
const fs = require('fs');
const path = require('path');

let pool = null;
try {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
} catch (e) {
  console.error('[store] No se pudo inicializar Postgres, se usarán archivos locales:', e.message);
}

const FEEDBACK_PATH = path.join(__dirname, 'data', 'feedback.json');
const ANALYTICS_PATH = path.join(__dirname, 'data', 'analytics.json');
const GAME_TYPES = ['impostor', 'mentiroso', 'subasta', 'wavelength', 'who'];

/* ---- Fallback en archivo local (sin DATABASE_URL) ---- */
let _fileFeedback = (() => {
  try { return JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf-8')); }
  catch { return []; }
})();
let _fileAnalytics = (() => {
  try { return JSON.parse(fs.readFileSync(ANALYTICS_PATH, 'utf-8')); }
  catch { return { roomsCreated: 0, playersJoined: 0, gamesCompleted: { impostor: 0, mentiroso: 0, subasta: 0, wavelength: 0, who: 0 }, daily: {} }; }
})();
function _saveFileFeedback() { fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(_fileFeedback, null, 2), 'utf-8'); }
let _fileAnalyticsDirty = false;
setInterval(() => { if (_fileAnalyticsDirty) { _fileAnalyticsDirty = false; fs.writeFileSync(ANALYTICS_PATH, JSON.stringify(_fileAnalytics, null, 2), 'utf-8'); } }, 30000);

/* ---- Inicialización de tablas (solo si hay Postgres) ---- */
async function initStore() {
  if (!pool) { console.log('[store] Sin DATABASE_URL: usando archivos locales (no persiste entre redeploys).'); return; }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      message TEXT NOT NULL,
      contact TEXT,
      room_code TEXT,
      game_type TEXT,
      type TEXT,
      read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analytics_daily (
      day TEXT PRIMARY KEY,
      rooms_created INT DEFAULT 0,
      players_joined INT DEFAULT 0,
      games_completed INT DEFAULT 0
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analytics_totals (
      key TEXT PRIMARY KEY,
      value INT DEFAULT 0
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      provider TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar_url TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE(provider, provider_id)
    )`);
  // display_name/avatar_image: perfil de juego personalizado, separado del
  // nombre/foto que manda el proveedor OAuth (name/avatar_url no se tocan,
  // así siempre queda un valor original al que volver). ADD COLUMN IF NOT
  // EXISTS porque la tabla `users` ya existe en producción desde antes.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_image TEXT`);
  // Veto de salas públicas: banned_until NULL = sin veto; con fecha futura,
  // no puede crear ni unirse a salas públicas hasta esa fecha (las salas
  // privadas no se tocan — el veto es específico de la convivencia entre
  // desconocidos, no un castigo general de la cuenta).
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT`);
  // Código de amigo: se genera la primera vez que hace falta (getOrCreateFriendCode),
  // no acá — así no hay que backfillear todas las cuentas existentes de una.
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS friend_code TEXT UNIQUE`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS friendships (
      id SERIAL PRIMARY KEY,
      requester_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      addressee_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_stats (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_type TEXT NOT NULL,
      games_played INT DEFAULT 0,
      games_won INT DEFAULT 0,
      PRIMARY KEY (user_id, game_type)
    )`);
  // Historial de partidas: una fila por partida jugada por un usuario
  // logueado. A diferencia de player_stats (solo contadores acumulados),
  // esto guarda cada partida individual con fecha — lo usan tanto el
  // historial visible en "Mis estadísticas" como la tabla de posiciones
  // semanal/mensual (que necesita saber CUÁNDO se jugó cada partida).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_history (
      id SERIAL PRIMARY KEY,
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_type TEXT NOT NULL,
      won BOOLEAN NOT NULL,
      other_players TEXT,
      played_at TIMESTAMPTZ DEFAULT now()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS achievements (
      id SERIAL PRIMARY KEY,
      key TEXT UNIQUE NOT NULL,
      icon_emoji TEXT,
      icon_image TEXT,
      title_es TEXT NOT NULL,
      title_en TEXT NOT NULL,
      desc_es TEXT,
      desc_en TEXT,
      condition_type TEXT NOT NULL,
      condition_game TEXT,
      condition_goal INT NOT NULL DEFAULT 1,
      sort_order INT DEFAULT 0,
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT now()
    )`);
  // Reportes: de mensajes de chat (con el texto del mensaje tal cual estaba
  // en ese momento, ya que el chat de la sala es efímero) o de conducta en
  // el juego (alguien que arruina la partida a propósito — sin mensaje
  // puntual asociado, message_text queda NULL en ese caso).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      reporter_user_id INT REFERENCES users(id) ON DELETE SET NULL,
      reported_user_id INT REFERENCES users(id) ON DELETE CASCADE,
      room_code TEXT,
      message_text TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT now(),
      reviewed_at TIMESTAMPTZ
    )`);
  await pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS report_type TEXT NOT NULL DEFAULT 'chat'`);
  await pool.query(`ALTER TABLE reports ADD COLUMN IF NOT EXISTS game_type TEXT`);
  await seedDefaultAchievements();
  console.log('[store] Postgres conectado — feedback, analytics, cuentas y logros persisten entre redeploys.');
}

/* ---- Logros: semilla inicial (solo si la tabla está vacía) ----
   condition_type: 'total_played' | 'total_won' | 'game_played' | 'game_won'
                  | 'distinct_played' | 'distinct_won'
   condition_game solo aplica a 'game_played'/'game_won'. */
const DEFAULT_ACHIEVEMENTS = [
  { key:'first_game', icon_emoji:'🎉', title_es:'Primera partida', title_en:'First game', desc_es:'Juega tu primera partida', desc_en:'Play your first match', condition_type:'total_played', condition_goal:1, sort_order:1 },
  { key:'first_win', icon_emoji:'🏆', title_es:'Primera victoria', title_en:'First win', desc_es:'Gana tu primera partida', desc_en:'Win your first match', condition_type:'total_won', condition_goal:1, sort_order:2 },
  { key:'frequent', icon_emoji:'🔥', title_es:'Jugador frecuente', title_en:'Regular player', desc_es:'Juega 10 partidas en total', desc_en:'Play 10 matches total', condition_type:'total_played', condition_goal:10, sort_order:3 },
  { key:'veteran', icon_emoji:'💪', title_es:'Veterano', title_en:'Veteran', desc_es:'Juega 50 partidas en total', desc_en:'Play 50 matches total', condition_type:'total_played', condition_goal:50, sort_order:4 },
  { key:'tireless', icon_emoji:'🎖️', title_es:'Incansable', title_en:'Tireless', desc_es:'Juega 100 partidas en total', desc_en:'Play 100 matches total', condition_type:'total_played', condition_goal:100, sort_order:5 },
  { key:'allrounder', icon_emoji:'🌟', title_es:'Todoterreno', title_en:'All-rounder', desc_es:'Juega los 5 juegos al menos una vez', desc_en:'Play all 5 games at least once', condition_type:'distinct_played', condition_goal:5, sort_order:6 },
  { key:'triple_crown', icon_emoji:'🥉', title_es:'Triple corona', title_en:'Triple crown', desc_es:'Gana al menos una partida en 3 juegos distintos', desc_en:'Win at least one match in 3 different games', condition_type:'distinct_won', condition_goal:3, sort_order:7 },
  { key:'grand_champion', icon_emoji:'🏅', title_es:'Campeón absoluto', title_en:'Grand champion', desc_es:'Gana al menos una partida en los 5 juegos', desc_en:'Win at least one match in all 5 games', condition_type:'distinct_won', condition_goal:5, sort_order:8 },
  { key:'master_impostor', icon_emoji:'🎭', title_es:'Maestro del Impostor', title_en:'Impostor Master', desc_es:'Gana 5 partidas de El Impostor', desc_en:'Win 5 matches of The Impostor', condition_type:'game_won', condition_game:'impostor', condition_goal:5, sort_order:9 },
  { key:'master_subasta', icon_emoji:'💰', title_es:'Rey de la Subasta', title_en:'Auction King', desc_es:'Gana 5 partidas de Subasta Futbolera', desc_en:'Win 5 matches of Football Auction', condition_type:'game_won', condition_game:'subasta', condition_goal:5, sort_order:10 },
  { key:'master_mentiroso', icon_emoji:'🎲', title_es:'Mentiroso Profesional', title_en:'Professional Liar', desc_es:'Gana 5 partidas de Mentiroso Futbolero', desc_en:'Win 5 matches of Football Liar', condition_type:'game_won', condition_game:'mentiroso', condition_goal:5, sort_order:11 },
  { key:'master_wavelength', icon_emoji:'📡', title_es:'Sintonía Perfecta', title_en:'Perfect Tuning', desc_es:'Gana 5 partidas de La Frecuencia', desc_en:'Win 5 matches of Wavelength', condition_type:'game_won', condition_game:'wavelength', condition_goal:5, sort_order:12 },
  { key:'master_who', icon_emoji:'🕵️', title_es:'Detective', title_en:'Detective', desc_es:'Gana 5 partidas de ¿Quién Soy?', desc_en:'Win 5 matches of Who Am I?', condition_type:'game_won', condition_game:'who', condition_goal:5, sort_order:13 },
  { key:'impostor_elite', icon_emoji:'🎩', title_es:'Impostor de élite', title_en:'Elite Impostor', desc_es:'Gana 15 partidas de El Impostor', desc_en:'Win 15 matches of The Impostor', condition_type:'game_won', condition_game:'impostor', condition_goal:15, sort_order:14 },
  { key:'subasta_magnate', icon_emoji:'💎', title_es:'Magnate', title_en:'Magnate', desc_es:'Gana 15 partidas de Subasta Futbolera', desc_en:'Win 15 matches of Football Auction', condition_type:'game_won', condition_game:'subasta', condition_goal:15, sort_order:15 },
  { key:'legend', icon_emoji:'👑', title_es:'Leyenda', title_en:'Legend', desc_es:'Gana 25 partidas en total', desc_en:'Win 25 matches total', condition_type:'total_won', condition_goal:25, sort_order:16 },
  { key:'immortal', icon_emoji:'🌌', title_es:'Inmortal', title_en:'Immortal', desc_es:'Gana 100 partidas en total', desc_en:'Win 100 matches total', condition_type:'total_won', condition_goal:100, sort_order:17 },
];
async function seedDefaultAchievements() {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM achievements`);
  if (rows[0].n > 0) return; // ya hay logros (por defecto o editados por el admin): no tocar
  for (const a of DEFAULT_ACHIEVEMENTS) {
    await pool.query(
      `INSERT INTO achievements (key,icon_emoji,title_es,title_en,desc_es,desc_en,condition_type,condition_game,condition_goal,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [a.key, a.icon_emoji, a.title_es, a.title_en, a.desc_es, a.desc_en, a.condition_type, a.condition_game || null, a.condition_goal, a.sort_order]
    );
  }
}

/* ---- Feedback ---- */
async function addFeedback(item) {
  if (pool) {
    await pool.query(
      `INSERT INTO feedback (id,message,contact,room_code,game_type,type,read,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [item.id, item.message, item.contact, item.roomCode, item.gameType, item.type, item.read, item.createdAt]
    );
    return;
  }
  _fileFeedback.unshift(item);
  if (_fileFeedback.length > 500) _fileFeedback.length = 500;
  _saveFileFeedback();
}
async function getFeedback() {
  if (pool) {
    const r = await pool.query(`SELECT id,message,contact,room_code as "roomCode",game_type as "gameType",type,read,created_at as "createdAt" FROM feedback ORDER BY created_at DESC LIMIT 500`);
    return r.rows;
  }
  return _fileFeedback;
}
async function markFeedbackRead(id, read) {
  if (pool) {
    const r = await pool.query(`UPDATE feedback SET read=$1 WHERE id=$2`, [read, id]);
    return r.rowCount > 0;
  }
  const item = _fileFeedback.find(f => f.id === id); if (!item) return false;
  item.read = read; _saveFileFeedback(); return true;
}
async function deleteFeedback(id) {
  if (pool) {
    const r = await pool.query(`DELETE FROM feedback WHERE id=$1`, [id]);
    return r.rowCount > 0;
  }
  const idx = _fileFeedback.findIndex(f => f.id === id); if (idx === -1) return false;
  _fileFeedback.splice(idx, 1); _saveFileFeedback(); return true;
}

/* ---- Analytics ---- */
async function _trackEvent(type, gameType) {
  const today = new Date().toISOString().slice(0, 10);
  if (pool) {
    const col = type === 'room_created' ? 'rooms_created' : type === 'player_joined' ? 'players_joined' : 'games_completed';
    await pool.query(`INSERT INTO analytics_daily(day,${col}) VALUES ($1,1) ON CONFLICT (day) DO UPDATE SET ${col}=analytics_daily.${col}+1`, [today]);
    if (type === 'room_created') {
      await pool.query(`INSERT INTO analytics_totals(key,value) VALUES ('roomsCreated',1) ON CONFLICT (key) DO UPDATE SET value=analytics_totals.value+1`);
    } else if (type === 'player_joined') {
      await pool.query(`INSERT INTO analytics_totals(key,value) VALUES ('playersJoined',1) ON CONFLICT (key) DO UPDATE SET value=analytics_totals.value+1`);
    } else if (type === 'game_completed') {
      await pool.query(`INSERT INTO analytics_totals(key,value) VALUES ($1,1) ON CONFLICT (key) DO UPDATE SET value=analytics_totals.value+1`, ['games_' + gameType]);
    }
    return;
  }
  _fileAnalytics.daily[today] = _fileAnalytics.daily[today] || { roomsCreated: 0, playersJoined: 0, gamesCompleted: 0 };
  if (type === 'room_created') { _fileAnalytics.roomsCreated++; _fileAnalytics.daily[today].roomsCreated++; }
  else if (type === 'player_joined') { _fileAnalytics.playersJoined++; _fileAnalytics.daily[today].playersJoined++; }
  else if (type === 'game_completed') { _fileAnalytics.gamesCompleted[gameType] = (_fileAnalytics.gamesCompleted[gameType] || 0) + 1; _fileAnalytics.daily[today].gamesCompleted++; }
  _fileAnalyticsDirty = true;
}
// Nunca debe tumbar el flujo del juego: si falla el tracking, solo se loguea.
async function trackEvent(type, gameType) {
  try { await _trackEvent(type, gameType); }
  catch (e) { console.error('[store] trackEvent falló:', e.message); }
}
async function getAnalytics() {
  if (pool) {
    const totals = await pool.query(`SELECT key,value FROM analytics_totals`);
    const daily = await pool.query(`SELECT day, rooms_created as "roomsCreated", players_joined as "playersJoined", games_completed as "gamesCompleted" FROM analytics_daily ORDER BY day DESC LIMIT 60`);
    const totalsMap = {}; totals.rows.forEach(r => { totalsMap[r.key] = r.value; });
    const gamesCompleted = {}; GAME_TYPES.forEach(g => { gamesCompleted[g] = totalsMap['games_' + g] || 0; });
    const dailyObj = {}; daily.rows.forEach(d => { dailyObj[d.day] = { roomsCreated: d.roomsCreated, playersJoined: d.playersJoined, gamesCompleted: d.gamesCompleted }; });
    return { roomsCreated: totalsMap.roomsCreated || 0, playersJoined: totalsMap.playersJoined || 0, gamesCompleted, daily: dailyObj };
  }
  return _fileAnalytics;
}
// Vuelve los contadores a cero (ej. para descartar números ensuciados por
// pruebas). Solo borra analytics, nunca feedback/cuentas/logros.
async function resetAnalytics() {
  if (pool) {
    await pool.query(`TRUNCATE analytics_daily, analytics_totals`);
    return;
  }
  _fileAnalytics = { roomsCreated: 0, playersJoined: 0, gamesCompleted: { impostor: 0, mentiroso: 0, subasta: 0, wavelength: 0, who: 0 }, daily: {} };
  _fileAnalyticsDirty = true;
}

/* ---- Cuentas (login con Google/Discord) y estadísticas ----
   A propósito NO tienen fallback en archivo: una cuenta de usuario solo
   tiene sentido si persiste de verdad. Sin DATABASE_URL, el login queda
   deshabilitado (authEnabled=false) en vez de simular algo que se
   perdería en el próximo redeploy. */
const USER_COLUMNS = `id, provider, name, avatar_url as "avatarUrl", display_name as "displayName", avatar_image as "avatarImage", banned_until as "bannedUntil", ban_reason as "banReason"`;
async function upsertUser({ provider, providerId, name, avatarUrl }) {
  if (!pool) return null;
  const r = await pool.query(
    `INSERT INTO users (provider,provider_id,name,avatar_url) VALUES ($1,$2,$3,$4)
     ON CONFLICT (provider,provider_id) DO UPDATE SET name=$3, avatar_url=$4
     RETURNING ${USER_COLUMNS}`,
    [provider, providerId, name, avatarUrl]
  );
  return r.rows[0];
}
async function getUserById(id) {
  if (!pool) return null;
  const r = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id=$1`, [id]);
  return r.rows[0] || null;
}
// Perfil de juego personalizado: nombre e imagen que el jugador elige
// mostrar dentro del juego, independientes del nombre/foto real de su
// cuenta de Google/Discord (esas quedan intactas en name/avatar_url).
async function updateUserProfile(id, { displayName, avatarImage }) {
  if (!pool) return null;
  const r = await pool.query(
    `UPDATE users SET display_name=$1, avatar_image=$2 WHERE id=$3 RETURNING ${USER_COLUMNS}`,
    [displayName || null, avatarImage || null, id]
  );
  return r.rows[0] || null;
}

/* ---- Amigos ----
   Se agregan por "código de amigo" (6 caracteres, como los códigos de sala)
   en vez de buscar por nombre, porque los nombres no son únicos y esto
   evita cualquier ambigüedad o suplantación al agregar a alguien. */
const FRIEND_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function genFriendCode(){
  let c=''; for(let i=0;i<6;i++) c+=FRIEND_CODE_CHARS[Math.floor(Math.random()*FRIEND_CODE_CHARS.length)];
  return c;
}
async function getOrCreateFriendCode(userId){
  if (!pool) return null;
  const existing = await pool.query(`SELECT friend_code as "friendCode" FROM users WHERE id=$1`, [userId]);
  if (existing.rows[0]?.friendCode) return existing.rows[0].friendCode;
  // Reintenta si el código al azar choca con uno ya existente (poco probable
  // con 33^6 combinaciones, pero la columna es UNIQUE así que hay que cubrirlo).
  for (let i=0;i<10;i++){
    try{
      const r = await pool.query(`UPDATE users SET friend_code=$1 WHERE id=$2 RETURNING friend_code as "friendCode"`, [genFriendCode(), userId]);
      return r.rows[0]?.friendCode || null;
    }catch(e){ if (e.code !== '23505') throw e; }
  }
  throw new Error('no se pudo generar un código de amigo único');
}
async function sendFriendRequest(requesterId, code){
  if (!pool) return { error:'no-db' };
  const target = await pool.query(`SELECT id FROM users WHERE friend_code=$1`, [String(code||'').trim().toUpperCase()]);
  if (!target.rows[0]) return { error:'not-found' };
  const addresseeId = target.rows[0].id;
  if (addresseeId === requesterId) return { error:'self' };
  const existing = await pool.query(
    `SELECT status FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)`,
    [requesterId, addresseeId]
  );
  if (existing.rows[0]) return { error: existing.rows[0].status==='accepted' ? 'already-friends' : 'already-pending' };
  await pool.query(`INSERT INTO friendships (requester_id,addressee_id,status) VALUES ($1,$2,'pending')`, [requesterId, addresseeId]);
  return { ok:true, addresseeId };
}
async function respondFriendRequest(userId, requestId, accept){
  if (!pool) return null;
  const req = await pool.query(
    `SELECT requester_id as "requesterId", addressee_id as "addresseeId" FROM friendships WHERE id=$1 AND addressee_id=$2 AND status='pending'`,
    [requestId, userId]
  );
  if (!req.rows[0]) return null;
  if (accept) await pool.query(`UPDATE friendships SET status='accepted' WHERE id=$1`, [requestId]);
  else await pool.query(`DELETE FROM friendships WHERE id=$1`, [requestId]);
  return req.rows[0];
}
async function removeFriend(userId, friendId){
  if (!pool) return false;
  const r = await pool.query(
    `DELETE FROM friendships WHERE status='accepted' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,
    [userId, friendId]
  );
  return r.rowCount > 0;
}
async function getFriendsData(userId){
  if (!pool) return { friends:[], incoming:[], outgoing:[] };
  const friends = await pool.query(
    `SELECT u.id, COALESCE(u.display_name,u.name) as "name", COALESCE(u.avatar_image,u.avatar_url) as "avatar"
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END
     WHERE f.status='accepted' AND (f.requester_id=$1 OR f.addressee_id=$1)
     ORDER BY u.name`,
    [userId]
  );
  const incoming = await pool.query(
    `SELECT f.id, u.id as "userId", COALESCE(u.display_name,u.name) as "name", COALESCE(u.avatar_image,u.avatar_url) as "avatar", f.created_at as "createdAt"
     FROM friendships f JOIN users u ON u.id = f.requester_id
     WHERE f.addressee_id=$1 AND f.status='pending' ORDER BY f.created_at DESC`,
    [userId]
  );
  const outgoing = await pool.query(
    `SELECT f.id, u.id as "userId", COALESCE(u.display_name,u.name) as "name", COALESCE(u.avatar_image,u.avatar_url) as "avatar", f.created_at as "createdAt"
     FROM friendships f JOIN users u ON u.id = f.addressee_id
     WHERE f.requester_id=$1 AND f.status='pending' ORDER BY f.created_at DESC`,
    [userId]
  );
  return { friends: friends.rows, incoming: incoming.rows, outgoing: outgoing.rows };
}
// Solo los ids (sin datos de perfil) — lo usa la notificación de presencia en
// vivo, que corre en cada conexión/desconexión y no necesita más que esto.
async function getFriendIds(userId){
  if (!pool) return [];
  const r = await pool.query(
    `SELECT CASE WHEN requester_id=$1 THEN addressee_id ELSE requester_id END as "friendId"
     FROM friendships WHERE status='accepted' AND (requester_id=$1 OR addressee_id=$1)`,
    [userId]
  );
  return r.rows.map(x=>x.friendId);
}
// Usado por las invitaciones a sala: nunca hay que confiar en que el
// cliente mande un userId "de amigo" sin verificarlo server-side, o
// cualquiera podría invitar (spammear) a cualquier usuario en línea.
async function areFriends(userId, otherId){
  if (!pool) return false;
  const r = await pool.query(
    `SELECT 1 FROM friendships WHERE status='accepted' AND ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))`,
    [userId, otherId]
  );
  return r.rowCount > 0;
}

async function recordGameResult(userId, gameType, won) {
  if (!pool || !userId) return;
  try {
    await pool.query(
      `INSERT INTO player_stats (user_id,game_type,games_played,games_won) VALUES ($1,$2,1,$3)
       ON CONFLICT (user_id,game_type) DO UPDATE SET
         games_played=player_stats.games_played+1,
         games_won=player_stats.games_won+GREATEST($3,0)`,
      [userId, gameType, won ? 1 : 0]
    );
  } catch (e) { console.error('[store] recordGameResult falló:', e.message); }
}
async function getUserStats(userId) {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT game_type as "gameType", games_played as "gamesPlayed", games_won as "gamesWon" FROM player_stats WHERE user_id=$1`,
    [userId]
  );
  return r.rows;
}
// period: 'all' usa los contadores acumulados de player_stats (barato, y es
// lo único que existe para partidas jugadas antes de que existiera
// game_history); 'week'/'month' cuentan desde game_history filtrando por
// fecha, así que solo reflejan partidas jugadas desde que se agregó esa tabla.
async function getLeaderboard(limit = 20, period = 'all') {
  if (!pool) return [];
  if (period === 'week' || period === 'month') {
    const interval = period === 'week' ? '7 days' : '30 days';
    const r = await pool.query(
      `SELECT u.id, COALESCE(u.display_name, u.name) as "name",
              COALESCE(u.avatar_image, u.avatar_url) as "avatarUrl",
              COALESCE(SUM(gh.won::int),0)::int as "totalWon",
              COUNT(gh.id)::int as "totalPlayed"
       FROM users u
       JOIN game_history gh ON gh.user_id = u.id AND gh.played_at >= now() - $2::interval
       GROUP BY u.id
       HAVING COUNT(gh.id) > 0
       ORDER BY "totalWon" DESC, "totalPlayed" ASC
       LIMIT $1`,
      [limit, interval]
    );
    return r.rows;
  }
  const r = await pool.query(
    `SELECT u.id, COALESCE(u.display_name, u.name) as "name",
            COALESCE(u.avatar_image, u.avatar_url) as "avatarUrl",
            COALESCE(SUM(ps.games_won),0)::int as "totalWon",
            COALESCE(SUM(ps.games_played),0)::int as "totalPlayed"
     FROM users u
     LEFT JOIN player_stats ps ON ps.user_id = u.id
     GROUP BY u.id
     HAVING COALESCE(SUM(ps.games_played),0) > 0
     ORDER BY "totalWon" DESC, "totalPlayed" ASC
     LIMIT $1`,
    [limit]
  );
  return r.rows;
}

/* ---- Historial de partidas ---- */
async function addGameHistory(userId, gameType, won, otherPlayers) {
  if (!pool || !userId) return;
  try {
    await pool.query(
      `INSERT INTO game_history (user_id,game_type,won,other_players) VALUES ($1,$2,$3,$4)`,
      [userId, gameType, !!won, (otherPlayers || []).join(', ') || null]
    );
  } catch (e) { console.error('[store] addGameHistory falló:', e.message); }
}
async function getGameHistory(userId, limit = 20) {
  if (!pool) return [];
  const r = await pool.query(
    `SELECT game_type as "gameType", won, other_players as "otherPlayers", played_at as "playedAt"
     FROM game_history WHERE user_id=$1 ORDER BY played_at DESC LIMIT $2`,
    [userId, limit]
  );
  return r.rows;
}

/* ---- Panel admin: gestión de usuarios ---- */
async function getAllUsersAdmin(search = '') {
  if (!pool) return [];
  const where = search ? `WHERE u.name ILIKE $1 OR u.display_name ILIKE $1` : '';
  const params = search ? [`%${search}%`] : [];
  const r = await pool.query(
    `SELECT u.id, u.provider, u.name, u.avatar_url as "avatarUrl",
            u.display_name as "displayName", u.avatar_image as "avatarImage",
            u.created_at as "createdAt", u.banned_until as "bannedUntil",
            COALESCE(SUM(ps.games_played),0)::int as "totalPlayed",
            COALESCE(SUM(ps.games_won),0)::int as "totalWon"
     FROM users u
     LEFT JOIN player_stats ps ON ps.user_id = u.id
     ${where}
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT 200`,
    params
  );
  return r.rows;
}
async function deleteUser(id) {
  if (!pool) return false;
  const r = await pool.query(`DELETE FROM users WHERE id=$1`, [id]);
  return r.rowCount > 0;
}
// Moderación: le pone un nombre genérico ("User1234"), tanto si lo
// inapropiado era el nombre personalizado como el original de la cuenta
// OAuth (display_name manda sobre name, así que esto lo tapa para siempre,
// sin depender de qué mandó el proveedor). Solo toca display_name, la
// foto de perfil queda como estaba.
async function adminResetUserName(id) {
  if (!pool) return null;
  const randomName = 'User' + Math.floor(1000 + Math.random() * 9000);
  const r = await pool.query(
    `UPDATE users SET display_name=$1 WHERE id=$2 RETURNING ${USER_COLUMNS}`,
    [randomName, id]
  );
  return r.rows[0] || null;
}
// Moderación: saca la foto personalizada y vuelve al avatar por defecto
// (iniciales) o a la foto original de Google/Discord si el jugador nunca
// subió una propia. Solo toca avatar_image, el nombre queda como estaba.
async function adminClearUserAvatar(id) {
  if (!pool) return null;
  const r = await pool.query(
    `UPDATE users SET avatar_image=NULL WHERE id=$1 RETURNING ${USER_COLUMNS}`,
    [id]
  );
  return r.rows[0] || null;
}
// Veto de salas públicas. days=null es permanente (fecha muy lejana, para no
// tener que manejar "NULL pero igual baneado" como un tercer estado aparte).
async function banUser(id, days, reason) {
  if (!pool) return null;
  const until = days ? `now() + interval '${Number(days)} days'` : `'9999-12-31'::timestamptz`;
  const r = await pool.query(
    `UPDATE users SET banned_until=${until}, ban_reason=$1 WHERE id=$2 RETURNING ${USER_COLUMNS}`,
    [reason || null, id]
  );
  return r.rows[0] || null;
}
async function unbanUser(id) {
  if (!pool) return null;
  const r = await pool.query(
    `UPDATE users SET banned_until=NULL, ban_reason=NULL WHERE id=$1 RETURNING ${USER_COLUMNS}`,
    [id]
  );
  return r.rows[0] || null;
}

/* ---- Reportes de chat (salas públicas) ---- */
async function addReport({ reporterUserId, reportedUserId, roomCode, messageText, reportType, gameType }) {
  if (!pool) return null;
  const r = await pool.query(
    `INSERT INTO reports (reporter_user_id,reported_user_id,room_code,message_text,report_type,game_type) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [reporterUserId, reportedUserId, roomCode, messageText || null, reportType || 'chat', gameType || null]
  );
  return r.rows[0];
}
async function getReports(status = 'pending') {
  if (!pool) return [];
  // reportedTotalCount: cuántos reportes tiene esa cuenta en total (cualquier
  // estado), para que el admin note enseguida a quién ya reportaron antes —
  // varios reportes acumulados son la señal de que conviene vetar, no uno solo.
  const r = await pool.query(
    `SELECT rp.id, rp.room_code as "roomCode", rp.message_text as "messageText",
            rp.report_type as "reportType", rp.game_type as "gameType", rp.status, rp.created_at as "createdAt",
            reporter.id as "reporterId", COALESCE(reporter.display_name, reporter.name) as "reporterName",
            reported.id as "reportedId", COALESCE(reported.display_name, reported.name) as "reportedName",
            reported.banned_until as "reportedBannedUntil",
            (SELECT COUNT(*) FROM reports r2 WHERE r2.reported_user_id = rp.reported_user_id)::int as "reportedTotalCount"
     FROM reports rp
     LEFT JOIN users reporter ON reporter.id = rp.reporter_user_id
     LEFT JOIN users reported ON reported.id = rp.reported_user_id
     WHERE rp.status = $1
     ORDER BY rp.created_at DESC
     LIMIT 200`,
    [status]
  );
  return r.rows;
}
async function getReportById(id) {
  if (!pool) return null;
  const r = await pool.query(`SELECT id, reported_user_id as "reportedUserId" FROM reports WHERE id=$1`, [id]);
  return r.rows[0] || null;
}
async function setReportStatus(id, status) {
  if (!pool) return false;
  const r = await pool.query(`UPDATE reports SET status=$1, reviewed_at=now() WHERE id=$2`, [status, id]);
  return r.rowCount > 0;
}

/* ---- Logros: CRUD para el panel admin + lectura pública ---- */
const ACHIEVEMENT_COLUMNS = `id, key, icon_emoji as "iconEmoji", icon_image as "iconImage", title_es as "titleEs", title_en as "titleEn", desc_es as "descEs", desc_en as "descEn", condition_type as "conditionType", condition_game as "conditionGame", condition_goal as "conditionGoal", sort_order as "sortOrder", active`;
async function getAchievements() {
  if (!pool) return [];
  const r = await pool.query(`SELECT ${ACHIEVEMENT_COLUMNS} FROM achievements WHERE active=TRUE ORDER BY sort_order ASC, id ASC`);
  return r.rows;
}
async function getAllAchievementsAdmin() {
  if (!pool) return [];
  const r = await pool.query(`SELECT ${ACHIEVEMENT_COLUMNS} FROM achievements ORDER BY sort_order ASC, id ASC`);
  return r.rows;
}
async function createAchievement(a) {
  if (!pool) return null;
  const r = await pool.query(
    `INSERT INTO achievements (key,icon_emoji,icon_image,title_es,title_en,desc_es,desc_en,condition_type,condition_game,condition_goal,sort_order,active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${ACHIEVEMENT_COLUMNS}`,
    [a.key, a.iconEmoji || null, a.iconImage || null, a.titleEs, a.titleEn, a.descEs || null, a.descEn || null, a.conditionType, a.conditionGame || null, a.conditionGoal, a.sortOrder || 0, a.active !== false]
  );
  return r.rows[0];
}
async function updateAchievement(id, a) {
  if (!pool) return null;
  const r = await pool.query(
    `UPDATE achievements SET key=$1,icon_emoji=$2,icon_image=$3,title_es=$4,title_en=$5,desc_es=$6,desc_en=$7,
       condition_type=$8,condition_game=$9,condition_goal=$10,sort_order=$11,active=$12
     WHERE id=$13 RETURNING ${ACHIEVEMENT_COLUMNS}`,
    [a.key, a.iconEmoji || null, a.iconImage || null, a.titleEs, a.titleEn, a.descEs || null, a.descEn || null, a.conditionType, a.conditionGame || null, a.conditionGoal, a.sortOrder || 0, a.active !== false, id]
  );
  return r.rows[0] || null;
}
async function deleteAchievement(id) {
  if (!pool) return false;
  const r = await pool.query(`DELETE FROM achievements WHERE id=$1`, [id]);
  return r.rowCount > 0;
}

module.exports = {
  initStore, addFeedback, getFeedback, markFeedbackRead, deleteFeedback, trackEvent, getAnalytics, resetAnalytics,
  upsertUser, getUserById, updateUserProfile, recordGameResult, getUserStats, getLeaderboard,
  addGameHistory, getGameHistory, getAllUsersAdmin, deleteUser, adminResetUserName, adminClearUserAvatar,
  banUser, unbanUser, addReport, getReports, getReportById, setReportStatus,
  getOrCreateFriendCode, sendFriendRequest, respondFriendRequest, removeFriend, getFriendsData, getFriendIds, areFriends,
  getAchievements, getAllAchievementsAdmin, createAchievement, updateAchievement, deleteAchievement,
  get usingDb() { return !!pool; },
};
