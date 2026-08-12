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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS player_stats (
      user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      game_type TEXT NOT NULL,
      games_played INT DEFAULT 0,
      games_won INT DEFAULT 0,
      PRIMARY KEY (user_id, game_type)
    )`);
  console.log('[store] Postgres conectado — feedback, analytics y cuentas persisten entre redeploys.');
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

/* ---- Cuentas (login con Google/Discord) y estadísticas ----
   A propósito NO tienen fallback en archivo: una cuenta de usuario solo
   tiene sentido si persiste de verdad. Sin DATABASE_URL, el login queda
   deshabilitado (authEnabled=false) en vez de simular algo que se
   perdería en el próximo redeploy. */
async function upsertUser({ provider, providerId, name, avatarUrl }) {
  if (!pool) return null;
  const r = await pool.query(
    `INSERT INTO users (provider,provider_id,name,avatar_url) VALUES ($1,$2,$3,$4)
     ON CONFLICT (provider,provider_id) DO UPDATE SET name=$3, avatar_url=$4
     RETURNING id, provider, name, avatar_url as "avatarUrl"`,
    [provider, providerId, name, avatarUrl]
  );
  return r.rows[0];
}
async function getUserById(id) {
  if (!pool) return null;
  const r = await pool.query(`SELECT id, provider, name, avatar_url as "avatarUrl" FROM users WHERE id=$1`, [id]);
  return r.rows[0] || null;
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

module.exports = {
  initStore, addFeedback, getFeedback, markFeedbackRead, deleteFeedback, trackEvent, getAnalytics,
  upsertUser, getUserById, recordGameResult, getUserStats,
  get usingDb() { return !!pool; },
};
