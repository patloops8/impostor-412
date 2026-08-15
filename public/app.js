/* ===== Wake Lock: evita que la pantalla se apague durante el juego ===== */
let _wakeLock = null;
async function acquireWakeLock(){
  if(!('wakeLock' in navigator)) return;
  try{ _wakeLock = await navigator.wakeLock.request('screen'); }catch(e){}
}
async function releaseWakeLock(){
  if(!_wakeLock) return;
  try{ await _wakeLock.release(); _wakeLock=null; }catch(e){}
}
// Re-adquirir si el usuario vuelve a la pestaña (visibilitychange la libera automáticamente)
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='visible'&&_wakeLock===null&&currentGame) acquireWakeLock(); });

/* ===== Vibración ===== */
function vib(ms){ if(navigator.vibrate) navigator.vibrate(ms); }

/* ===== Sonidos (Web Audio API, sin librería) ===== */
const sfx = (() => {
  let _ac = null;
  let _muted = localStorage.getItem('sfx_muted') === '1';

  function ctx() {
    if (!_ac) _ac = new (window.AudioContext || window.webkitAudioContext)();
    if (_ac.state === 'suspended') _ac.resume();
    return _ac;
  }
  // freq Hz, dur s, vol 0-1, type OscillatorType, delay s
  function b(freq, dur, vol = 0.25, type = 'sine', delay = 0) {
    if (_muted) return;
    try {
      const c = ctx(), o = c.createOscillator(), g = c.createGain();
      o.connect(g); g.connect(c.destination);
      o.type = type; o.frequency.value = freq;
      const t = c.currentTime + delay;
      g.gain.setValueAtTime(0.001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur + 0.05);
    } catch (_) {}
  }

  return {
    get muted() { return _muted; },
    toggle() { _muted = !_muted; localStorage.setItem('sfx_muted', _muted ? '1' : '0'); return _muted; },

    // Tu turno — dos notas ascendentes
    turn()    { b(660,0.13,0.22); b(880,0.17,0.25,'sine',0.14); },
    // Alerta de tiempo — cuadrada corta
    urgent()  { b(440,0.08,0.18,'square'); },
    // Victoria / carta ganada — acorde mayor ascendente
    win()     { b(523,0.11,0.24); b(659,0.13,0.26,'sine',0.13); b(784,0.22,0.28,'sine',0.27); },
    // Fanfarria — secuencia de 6 notas (game over, campeón)
    fanfare() { [523,659,784,659,784,1047].forEach((f,i)=>b(f,0.2,0.3,'sine',i*0.12)); },
    // Puja colocada — dos pulsos cortos triangle
    bid()     { b(700,0.06,0.2,'triangle'); b(900,0.07,0.18,'triangle',0.08); },
    // Respuesta correcta — intervalo de quinta ascendente
    correct() { b(523,0.09,0.24); b(784,0.18,0.28,'sine',0.11); },
    // Error / eliminado — dos tonos graves descendentes
    wrong()   { b(220,0.1,0.22,'sawtooth'); b(160,0.22,0.2,'sawtooth',0.12); },
    // Reveal dramático — tres notas: tensión→resolución
    reveal()  { b(330,0.08,0.2); b(440,0.08,0.22,'sine',0.1); b(660,0.25,0.3,'sine',0.2); },
    // Anuncio suave — dos notas (fase nueva, pista compartida)
    announce(){ b(440,0.07,0.18); b(550,0.12,0.22,'sine',0.09); },
    // Carta nueva en subasta — sweep descendente
    card()    { b(880,0.04,0.16,'triangle'); b(660,0.06,0.18,'triangle',0.05); b(440,0.15,0.22,'sine',0.12); },
    // Tick de alerta — cuadrada corta aguda
    tick()    { b(1100,0.04,0.13,'square'); },
    // PPT (piedra-papel-tijera) — dos pulsos
    rps()     { b(440,0.05,0.2,'square'); b(330,0.08,0.18,'square',0.07); },
    // Punto ganado en matchup de posición
    match()   { b(550,0.07,0.2,'triangle'); b(660,0.14,0.24,'sine',0.09); },
    // Invitación enviada — chasquido suave y breve
    inviteSent()     { b(700,0.06,0.16,'sine'); b(950,0.09,0.18,'sine',0.06); },
    // Invitación recibida — timbre de 3 notas, más llamativo
    inviteReceived() { b(659,0.09,0.22,'sine'); b(784,0.09,0.24,'sine',0.09); b(988,0.22,0.28,'sine',0.18); },
    // Abrir un sobre — sweep ascendente rápido, como un "rasgado"
    packOpen()    { b(300,0.05,0.18,'sawtooth'); b(500,0.05,0.18,'sawtooth',0.04); b(750,0.08,0.2,'sawtooth',0.08); },
    // Estampa nueva dentro del sobre — brillo ascendente
    newSticker()  { b(880,0.08,0.22,'sine'); b(1175,0.14,0.26,'sine',0.08); },
  };
})();

/* ===== Auto-rellenar código desde URL (?code=XXXX) ===== */
(function checkURLCode(){
  const params = new URLSearchParams(location.search);
  const code = (params.get('code')||'').toUpperCase().slice(0,4);
  if(code) document.getElementById('inp-code').value = code;
})();

const socket = io({
  // Intentar WebSocket primero; si la red lo bloquea, cae a polling automáticamente.
  transports: ['websocket', 'polling'],
  // Reconexión robusta: si se cae, reintenta rápido y de forma persistente.
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 800,
  reconnectionDelayMax: 4000,
  timeout: 20000,
});

/* ===== Conexión + reconexión ===== */
const connBanner = document.getElementById('conn-banner');
let myId = null, roomCode = null, myStoredId = null, isHost = false, currentGame = null, tvLink = '';

// Persistimos sala + id en localStorage: si el celular recarga la página
// (muy común al volver de segundo plano), podemos reintegrarnos solos en
// vez de quedar bloqueados fuera de una partida ya empezada.
const SESSION_KEY='412_session';
const SESSION_MAX_AGE_MS = 4*60*60*1000; // 4 horas: cubre una junta larga, no "volví días después"
function saveSession(){ try{ localStorage.setItem(SESSION_KEY, JSON.stringify({code:roomCode, playerId:myStoredId, savedAt:Date.now()})); }catch(e){} }
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); }catch(e){} }
(function hydrateSession(){
  try{
    const raw=localStorage.getItem(SESSION_KEY); if(!raw)return;
    const saved=JSON.parse(raw);
    // Sin esto, cualquiera que haya jugado alguna vez intenta reconectarse a
    // una sala vieja cada vez que abre la app, para siempre — y ahora que el
    // fallo muestra un aviso visible, eso se veía como un error molesto en
    // el uso normal. Una sesión vieja se descarta calladita, sin intentar
    // reconectar ni avisar nada.
    if(saved && saved.code && saved.playerId && saved.savedAt && (Date.now()-saved.savedAt)<SESSION_MAX_AGE_MS){
      roomCode=saved.code; myStoredId=saved.playerId;
    } else {
      clearSession();
    }
  }catch(e){}
})();

// Setea los campos que dependen del codigo de sala (el display del lobby y
// el link de Vista TV). Se usa tanto al crear/unirse como al reconectarse
// solo — antes esto SOLO se llamaba desde onJoined, asi que un reingreso
// automatico via player:rejoin dejaba el codigo en "----" (el placeholder
// del HTML) aunque la sala fuera real.
function applyRoomCode(code){
  roomCode=code;
  $('lobby-code').textContent=roomCode;
  tvLink = location.origin+'/tv?c='+roomCode;
  $('tv-hint').textContent=t('tvView');
  // Nueva sala: el QR viejo (si había uno cargado) ya no sirve.
  _qrLoaded=false; $('qr-box').classList.add('hidden'); $('btn-toggle-qr').textContent=t('showQr');
}
let _qrLoaded=false;

// Presencia de amigos: le avisa al servidor "estoy en línea" apenas hay
// conexión de socket Y sesión iniciada — no hace falta estar en una sala.
function registerPresence(){
  const tok = getAuthToken();
  if(!tok) return;
  socket.emit('auth:presence', { authToken: tok });
}
socket.on('connect', () => {
  connBanner.classList.add('hidden');
  registerPresence();
  loadFriends(); // precarga la lista para que "Invitar amigos" no arranque vacío
  loadAlbumStatus();
  // Reconexión: si ya teníamos sala (recién ahora, o recuperada de localStorage), reintegrarse
  if (roomCode && myStoredId) {
    socket.emit('player:rejoin', { code: roomCode, playerId: myStoredId }, (res) => {
      if (res && res.ok) {
        myId = res.playerId; myStoredId = res.playerId; isHost = res.isHost;
        if(res.categories) ALL_CATEGORIES=res.categories;
        if(res.formations) ALL_FORMATIONS=res.formations;
        applyRoomCode(res.code);
        setChatHistory(res.chat);
        saveSession();
      } else {
        // La sala ya no existe o el jugador no está: volver a home y avisar,
        // en vez de dejar a la persona congelada en una pantalla muerta.
        clearSession(); roomCode=null; myStoredId=null;
        show('s-home');
        showHomeError(t('roomGoneMsg'));
        updateChatVisibility();
      }
    });
  }
});
socket.on('disconnect', () => { connBanner.textContent=t('reconnecting'); connBanner.className='conn-banner error'; });
socket.io.on('reconnect', () => { connBanner.classList.add('hidden'); });

/* ===== Helpers ===== */
const $ = id => document.getElementById(id);
function esc(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
// Contenido de juego bilingüe (categorías de Mentiroso, pares de La Frecuencia):
// el servidor manda {es,en} y acá se elige el idioma actual, con fallback si
// falta alguno de los dos. Si viene un string plano (compatibilidad), se usa tal cual.
function pickLang(v){
  if(v && typeof v==='object') return (currentLang==='en' ? v.en : v.es) || v.es || v.en || '';
  return v||'';
}
// Paleta de avatares para jugadores humanos (sin foto): color de fondo + color de letra legible.
const AVATAR_PALETTE=[{bg:'#b6ff2e',fg:'#0a1400'},{bg:'#e9b949',fg:'#1a1200'},{bg:'#8b54e0',fg:'#ffffff'},{bg:'#ff4d4d',fg:'#ffffff'},{bg:'#4e8ecb',fg:'#ffffff'}];
function avatarFor(id){
  let h=0; for(let i=0;i<(id||'').length;i++) h=(h*31+id.charCodeAt(i))>>>0;
  const c=AVATAR_PALETTE[h%AVATAR_PALETTE.length];
  return c;
}
function avatarHTML(id,name,avatarUrl){
  if(avatarUrl) return `<img class="player-avatar player-avatar-img" src="${esc(avatarUrl)}" alt=""/>`;
  const c=avatarFor(id||name||'?');
  const initial=esc((name||'?').trim().charAt(0).toUpperCase()||'?');
  return `<span class="player-avatar" style="background:${c.bg};color:${c.fg};">${initial}</span>`;
}
function bump(el){ if(!el)return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
const MEDALS=['🥇','🥈','🥉'];
function rankLabel(i){ return MEDALS[i]||('#'+(i+1)); }
const SECTIONS = ['s-home','s-lobby','s-imp-role','s-imp-clue','s-imp-vote','s-imp-reveal','s-imp-over','s-lie-claim','s-lie-naming','s-lie-final','s-lie-over','s-sub-formation','s-sub-wait-deck','s-sub-play','s-sub-rps','s-sub-result','s-sub-tournament','s-sub-duel','s-sub-matchup','s-sub-over','s-wave-psychic','s-wave-guess','s-wave-reveal','s-who-board','s-who-guess-pending','s-who-round-over','s-who-reveal','s-who-over','s-force-over'];
const POS_LABELS = {POR:'Portero',LD:'Lat. Derecho',DFC:'Def. Central',LI:'Lat. Izquierdo',MCD:'MC Defensivo',MC:'Mediocentro',MCO:'MC Ofensivo',ED:'Extremo Der.',EI:'Extremo Izq.',DC:'Delantero'};
function show(id){ SECTIONS.forEach(s=>$(s).classList.add('hidden')); $(id).classList.remove('hidden'); }
function posGroup(p){ if(p==='POR')return 'portero'; if(['LD','DFC','LI'].includes(p))return 'defensa'; if(['MCD','MC','MCO'].includes(p))return 'mediocampista'; return 'delantero'; }

let players = [];

/* ===== Botón de mute ===== */
{
  const btn = $('btn-mute');
  if(btn){
    btn.textContent = sfx.muted ? '🔇' : '🔊';
    btn.addEventListener('click', () => { btn.textContent = sfx.toggle() ? '🔇' : '🔊'; });
  }
}

/* ===== Botón de idioma ===== */
$('btn-lang').addEventListener('click', () => {
  setLang(currentLang === 'es' ? 'en' : 'es');
  impCfgRendered=false; whoCfgRendered=false;
  if(renderLobby.lastState) renderLobby(renderLobby.lastState);
});

/* ===== HOME ===== */
$('btn-create').addEventListener('click', () => {
  const name = $('inp-name').value.trim();
  if(!name){ showHomeError(t('enterYourName')); return; }
  openCreateRoomOverlay();
});
$('btn-join').addEventListener('click', () => {
  const name = $('inp-name').value.trim();
  const code = $('inp-code').value.trim().toUpperCase();
  if(!name){ showHomeError(t('enterYourName')); return; }
  if(!code){ showHomeError(t('enterCode')); return; }
  socket.emit('player:join_room', { code, name, authToken:getAuthToken() }, onJoined);
});
$('inp-code').addEventListener('keydown', e=>{ if(e.key==='Enter')$('btn-join').click(); });
function showHomeError(m){ $('home-error').textContent=m; $('home-error').classList.remove('hidden'); }
function onJoined(res){
  // Cerrar los modales de creación/búsqueda antes que nada: si falla, el
  // error tiene que verse en la pantalla principal, no quedar tapado atrás.
  $('create-room-overlay').classList.add('hidden');
  closePublicRoomsOverlay();
  if(!res.ok){ showHomeError(res.error); return; }
  myId=res.playerId; myStoredId=res.playerId; isHost=res.isHost;
  ALL_CATEGORIES=res.categories||[]; ALL_FORMATIONS=res.formations||[];
  applyRoomCode(res.code);
  setChatHistory(res.chat);
  saveSession();
  show('s-lobby');
}

/* ===== Chat en vivo de la sala: siempre disponible en públicas; en
   privadas el anfitrión lo prende/apaga (ej. si están en una llamada) ===== */
let _chatMessages = [];
let _chatUnread = 0;
let _roomIsPublic = false;
let _chatEnabled = false;
function updateChatVisibility(){
  const shouldShow = !!(roomCode && _chatEnabled);
  $('btn-chat-toggle').classList.toggle('hidden', !shouldShow);
  if(!shouldShow) $('chat-panel').classList.add('hidden');
}
$('btn-toggle-chat-enabled').addEventListener('click', ()=>{
  if(!roomCode) return;
  socket.emit('host:toggle_chat', { code:roomCode, enabled:!_chatEnabled });
});
function setChatHistory(msgs){
  _chatMessages = msgs || [];
  _chatUnread = 0;
  renderChatUnread();
  renderChatMessages();
}
function renderChatMessages(){
  const box = $('chat-messages');
  if(!_chatMessages.length){ box.innerHTML = `<p class="chat-empty">${esc(t('chatEmpty'))}</p>`; return; }
  box.innerHTML = _chatMessages.map(m=>{
    const isMe = m.playerId===myId;
    const reportBtn = isMe ? '' : `<button class="chat-report-btn" data-msg-id="${esc(m.id)}" title="${esc(t('chatReportBtn'))}">🚩</button>`;
    return `
    <div class="chat-msg${isMe?' me':''}">
      <div class="chat-msg-name">${esc(m.name)}${reportBtn}</div>
      <div class="chat-msg-bubble">${esc(m.text)}</div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}
$('chat-messages').addEventListener('click', e=>{
  const btn = e.target.closest('.chat-report-btn'); if(!btn) return;
  if(!confirm(t('chatReportConfirm'))) return;
  socket.emit('player:report_message', { code:roomCode, messageId:btn.dataset.msgId }, (res)=>{
    if(res && res.ok) showToast(t('chatReportSent'), false);
    else showToast((res&&res.error)||t('chatReportError'), true);
  });
});
function renderChatUnread(){
  const badge = $('chat-unread-badge');
  badge.textContent = _chatUnread>9 ? '9+' : _chatUnread;
  badge.classList.toggle('hidden', _chatUnread===0);
}
$('btn-chat-toggle').addEventListener('click', ()=>{
  $('chat-panel').classList.remove('hidden');
  _chatUnread = 0; renderChatUnread();
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  $('inp-chat').focus();
});
$('btn-chat-close').addEventListener('click', ()=>$('chat-panel').classList.add('hidden'));
function sendChatMessage(){
  const val = $('inp-chat').value.trim();
  if(!val || !roomCode) return;
  socket.emit('player:chat_message', { code:roomCode, text:val });
  $('inp-chat').value = '';
}
$('btn-chat-send').addEventListener('click', sendChatMessage);
$('inp-chat').addEventListener('keydown', e=>{ if(e.key==='Enter') sendChatMessage(); });
socket.on('chat:message', (msg)=>{
  _chatMessages.push(msg);
  if(_chatMessages.length>100) _chatMessages.shift();
  renderChatMessages();
  if($('chat-panel').classList.contains('hidden')){ _chatUnread++; renderChatUnread(); }
});
document.addEventListener('langchange', ()=>{ if(!_chatMessages.length) renderChatMessages(); });

/* ===== Crear sala: privada o pública ===== */
let _createPublicGameType = null;
/* ===== Guardia de acceso a salas públicas: exige sesión iniciada (para que
   el sistema de reportes tenga a quién responsabilizar) y muestra el aviso
   de buena convivencia una vez por día antes de entrar. ===== */
const PUBLIC_GUIDELINES_KEY = '412_public_guidelines_seen';
let _pendingPublicProceed = null;
function guardPublicEntry(proceedFn){
  if(!authUser){
    $('create-room-overlay').classList.add('hidden');
    closePublicRoomsOverlay();
    showHomeError(t('publicRequiresLogin'));
    return;
  }
  const today = new Date().toISOString().slice(0,10);
  let lastShown = null;
  try{ lastShown = localStorage.getItem(PUBLIC_GUIDELINES_KEY); }catch(e){}
  if(lastShown===today){ proceedFn(); return; }
  _pendingPublicProceed = proceedFn;
  $('public-guidelines-overlay').classList.remove('hidden');
}
$('btn-guidelines-accept').addEventListener('click', ()=>{
  try{ localStorage.setItem(PUBLIC_GUIDELINES_KEY, new Date().toISOString().slice(0,10)); }catch(e){}
  $('public-guidelines-overlay').classList.add('hidden');
  const fn = _pendingPublicProceed; _pendingPublicProceed = null;
  if(fn) fn();
});
$('btn-guidelines-cancel').addEventListener('click', ()=>{
  _pendingPublicProceed = null;
  $('public-guidelines-overlay').classList.add('hidden');
});
function openCreateRoomOverlay(){
  $('create-room-step-type').classList.remove('hidden');
  $('create-room-step-game').classList.add('hidden');
  _createPublicGameType = null;
  document.querySelectorAll('#create-public-game-grid .game-pick-card').forEach(c=>c.classList.remove('selected'));
  $('btn-create-public-confirm').disabled = true;
  $('create-room-overlay').classList.remove('hidden');
}
$('btn-create-room-close').addEventListener('click', ()=>$('create-room-overlay').classList.add('hidden'));
$('create-room-overlay').addEventListener('click', e=>{ if(e.target===$('create-room-overlay'))$('create-room-overlay').classList.add('hidden'); });
$('btn-create-private').addEventListener('click', ()=>{
  const name = $('inp-name').value.trim();
  if(!name){ showHomeError(t('enterYourName')); return; }
  socket.emit('player:create_room', { name, authToken:getAuthToken() }, onJoined);
});
$('btn-create-public').addEventListener('click', ()=>{
  guardPublicEntry(()=>{
    $('create-room-step-type').classList.add('hidden');
    $('create-room-step-game').classList.remove('hidden');
  });
});
$('btn-create-back').addEventListener('click', ()=>{
  $('create-room-step-type').classList.remove('hidden');
  $('create-room-step-game').classList.add('hidden');
});
$('create-public-game-grid').addEventListener('click', e=>{
  const card = e.target.closest('.game-pick-card'); if(!card) return;
  _createPublicGameType = card.dataset.game;
  document.querySelectorAll('#create-public-game-grid .game-pick-card').forEach(c=>c.classList.toggle('selected', c===card));
  $('btn-create-public-confirm').disabled = false;
});
$('btn-create-public-confirm').addEventListener('click', ()=>{
  const name = $('inp-name').value.trim();
  if(!name){ showHomeError(t('enterYourName')); return; }
  if(!_createPublicGameType) return;
  socket.emit('player:create_room', { name, authToken:getAuthToken(), isPublic:true, gameType:_createPublicGameType }, onJoined);
});

/* ===== Unirse a sala pública ===== */
let _pubRoomsData = [];
let _pubFilter = 'all';
let _watchingPublic = false;
function openPublicRoomsOverlay(){
  $('public-rooms-body').innerHTML = `<p style="color:var(--text-dim)">${esc(t('loading'))}</p>`;
  $('public-rooms-overlay').classList.remove('hidden');
  _watchingPublic = true;
  socket.emit('lobby:watch_public', {}, (res)=>{
    if(res && res.ok){ _pubRoomsData = res.rooms || []; renderPublicRooms(); }
  });
}
function closePublicRoomsOverlay(){
  if(!_watchingPublic) return;
  _watchingPublic = false;
  socket.emit('lobby:unwatch_public');
  $('public-rooms-overlay').classList.add('hidden');
}
function renderPublicRooms(){
  const list = _pubFilter==='all' ? _pubRoomsData : _pubRoomsData.filter(r=>r.gameType===_pubFilter);
  if(!list.length){ $('public-rooms-body').innerHTML = `<p style="color:var(--text-dim);text-align:center;">${esc(t('publicRoomsEmpty'))}</p>`; return; }
  $('public-rooms-body').innerHTML = list.map(r=>`
    <div class="pub-room-row">
      <div class="pub-room-icon">${GAME_EMOJI[r.gameType]||'⚽'}</div>
      <div class="pub-room-info">
        <div class="pub-room-game">${esc(t(GAME_TITLE_KEYS[r.gameType]||r.gameType))}</div>
        <div class="pub-room-meta">${esc(t('publicRoomsHost',{name:r.hostName}))} · ${esc(t('publicRoomsPlayers',{n:r.playerCount}))}</div>
      </div>
      <button class="chip-btn pub-room-join" data-code="${esc(r.code)}" data-i18n="publicRoomsJoin">${esc(t('publicRoomsJoin'))}</button>
    </div>`).join('');
}
$('btn-browse-public').addEventListener('click', ()=>{
  const name = $('inp-name').value.trim();
  if(!name){ showHomeError(t('enterYourName')); return; }
  guardPublicEntry(()=>openPublicRoomsOverlay());
});
$('btn-public-rooms-close').addEventListener('click', closePublicRoomsOverlay);
$('public-rooms-overlay').addEventListener('click', e=>{ if(e.target===$('public-rooms-overlay'))closePublicRoomsOverlay(); });
$('pub-filter-row').addEventListener('click', e=>{
  const btn = e.target.closest('.pub-filter-btn'); if(!btn) return;
  _pubFilter = btn.dataset.filter;
  document.querySelectorAll('.pub-filter-btn').forEach(b=>b.classList.toggle('active', b===btn));
  renderPublicRooms();
});
$('public-rooms-body').addEventListener('click', e=>{
  const btn = e.target.closest('.pub-room-join'); if(!btn) return;
  const name = $('inp-name').value.trim();
  if(!name){ showHomeError(t('enterYourName')); return; }
  socket.emit('player:join_room', { code:btn.dataset.code, name, authToken:getAuthToken() }, onJoined);
});
socket.on('publicRooms:update', (rooms)=>{ _pubRoomsData = rooms||[]; if(_watchingPublic) renderPublicRooms(); });
document.addEventListener('langchange', ()=>{ if(_watchingPublic) renderPublicRooms(); });

/* ===== Login (Google/Discord) — opcional, la app funciona igual como invitado ===== */
const AUTH_KEY = '412_auth';
let authUser = null; // {id,name,avatar,provider} o null si juega como invitado
let _authAnyEnabled = false;
const GAME_TITLE_KEYS = {impostor:'gameImpostorTitle',mentiroso:'gameMentirosoTitle',subasta:'gameSubastaTitle',wavelength:'gameWavelengthTitle',who:'gameWhoTitle'};
function getAuthToken(){ try{ return localStorage.getItem(AUTH_KEY); }catch(e){ return null; } }
function setAuthToken(tok){ try{ if(tok) localStorage.setItem(AUTH_KEY, tok); else localStorage.removeItem(AUTH_KEY); }catch(e){} }
function decodeJwtPayload(tok){
  try{ return JSON.parse(atob(tok.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))); }
  catch(e){ return null; }
}
// Si el nombre de la sala coincide con lo que ya autocompletamos antes (o
// está vacío), lo mantenemos sincronizado con el perfil; si el jugador lo
// editó a mano, no se lo pisamos.
let _nameWasAutofilled = false;
$('inp-name').addEventListener('input', ()=>{ _nameWasAutofilled = false; });
function autofillNameFromAuth(){
  if(!authUser) return;
  const cur = $('inp-name').value.trim();
  if(!cur || _nameWasAutofilled){ $('inp-name').value = authUser.name; _nameWasAutofilled = true; }
}
function renderAuthUI(){
  const box=$('auth-box');
  if(authUser){
    $('auth-logged-out').classList.add('hidden');
    $('auth-logged-in').classList.remove('hidden');
    box.classList.remove('hidden');
    $('auth-avatar').src = authUser.avatar || '/images/ui/logo.png';
    $('auth-name').textContent = authUser.name;
    autofillNameFromAuth();
  } else {
    $('auth-logged-in').classList.add('hidden');
    $('auth-logged-out').classList.toggle('hidden', !_authAnyEnabled);
    box.classList.toggle('hidden', !_authAnyEnabled);
  }
}
(async function initAuth(){
  // Capturar el token que vuelve del callback de OAuth (?auth=...) y
  // limpiar la URL para no dejarlo visible/guardable en el historial.
  const params = new URLSearchParams(location.search);
  const tokenFromUrl = params.get('auth');
  const hadAuthError = params.has('authError');
  if(tokenFromUrl || hadAuthError){
    if(tokenFromUrl) setAuthToken(tokenFromUrl);
    params.delete('auth'); params.delete('authError');
    const clean = location.pathname + (params.toString()?`?${params}`:'');
    history.replaceState({}, '', clean);
  }
  const tok = getAuthToken();
  if(tok){
    const payload = decodeJwtPayload(tok);
    if(payload && payload.exp*1000>Date.now()){ authUser={id:payload.uid,name:payload.name,avatar:payload.avatar,provider:payload.provider}; registerPresence(); loadFriends(); loadAlbumStatus(); }
    else setAuthToken(null);
  }
  try{
    const res = await fetch('/auth/status');
    const st = await res.json();
    $('btn-login-google').classList.toggle('hidden', !st.google);
    $('btn-login-discord').classList.toggle('hidden', !st.discord);
    _authAnyEnabled = !!(st.google || st.discord);
  }catch(e){ _authAnyEnabled = false; }
  renderAuthUI();
  if(hadAuthError) showHomeError(t('authError'));
  // El JWT puede tener el nombre/foto desactualizados si el jugador editó
  // su perfil de juego en otra sesión/dispositivo — se refresca en segundo
  // plano contra la base sin bloquear la pantalla inicial.
  if(authUser){
    try{
      const meRes = await fetch('/auth/me', { headers:{ Authorization:'Bearer '+getAuthToken() } });
      const meJson = await meRes.json();
      if(meJson.ok){
        authUser = { id:meJson.user.id, name:meJson.user.name, avatar:meJson.user.avatar, provider:meJson.user.provider, hasCustomAvatar:meJson.user.hasCustomAvatar };
        if(meJson.token) setAuthToken(meJson.token);
        renderAuthUI();
        registerPresence();
      }
    }catch(e){}
  }
})();
$('btn-login-google').addEventListener('click', ()=>{ location.href='/auth/google/start'; });
$('btn-login-discord').addEventListener('click', ()=>{ location.href='/auth/discord/start'; });
$('btn-auth-logout').addEventListener('click', ()=>{
  setAuthToken(null); authUser=null; renderAuthUI();
  _albumActive = false; $('btn-album').classList.add('hidden');
  // Fuerza una desconexión/reconexión del socket para que el servidor deje
  // de contarnos como "en línea" con la identidad vieja (solo pasa desde la
  // pantalla principal, donde este botón vive — no hay sala activa que perder).
  if(socket.connected){ socket.disconnect(); socket.connect(); }
});
const GAME_COLORS = {impostor:'#8b54e0', mentiroso:'#ff4d4d', subasta:'#e9b949', wavelength:'#22d3ee', who:'#2563eb'};
const GAME_EMOJI = {impostor:'🎭', mentiroso:'🎲', subasta:'💰', wavelength:'📡', who:'🕵️'};
let _lastStatsData = null;
function renderStats(){
  if(!_lastStatsData) return;
  const {stats, achievements, history} = _lastStatsData;
  const totalPlayed = stats.reduce((s,x)=>s+x.gamesPlayed,0);
  const totalWon = stats.reduce((s,x)=>s+x.gamesWon,0);
  const winRate = totalPlayed ? Math.round(totalWon/totalPlayed*100) : 0;
  const unlockedCount = achievements.filter(a=>a.unlocked).length;

  const headerHtml = `
    <div class="stats-summary">
      <div class="stats-summary-stat"><div class="stats-summary-num">${totalPlayed}</div><div class="stats-summary-lbl">${esc(t('statsGamesPlayed'))}</div></div>
      <div class="stats-summary-stat"><div class="stats-summary-num">${totalWon}</div><div class="stats-summary-lbl">${esc(t('statsGamesWon'))}</div></div>
      <div class="stats-summary-stat"><div class="stats-summary-num">${winRate}%</div><div class="stats-summary-lbl">${esc(t('statsWinRate'))}</div></div>
    </div>`;

  const achvHtml = `
    <h3 class="stats-section-title">${esc(t('achievementsTitle'))} <span class="stats-section-sub">${esc(t('achievementsUnlockedOf',{n:unlockedCount,total:achievements.length}))}</span></h3>
    <div class="achv-grid">
      ${achievements.map(a=>{
        const title = (currentLang==='en' ? a.titleEn : a.titleEs) || a.titleEs || a.titleEn || '';
        const desc = (currentLang==='en' ? a.descEn : a.descEs) || a.descEs || a.descEn || '';
        const iconHtml = a.unlocked
          ? (a.iconImage ? `<img src="${esc(a.iconImage)}" alt="" class="achv-icon-img"/>` : esc(a.iconEmoji||'🏆'))
          : '🔒';
        return `
        <div class="achv-badge${a.unlocked?' unlocked':''}" title="${esc(desc)}">
          <div class="achv-icon">${iconHtml}</div>
          <div class="achv-title">${esc(title)}</div>
          ${!a.unlocked?`<div class="achv-progress-track"><div class="achv-progress-fill" style="width:${Math.round(a.progress/a.goal*100)}%"></div></div><div class="achv-progress-label">${a.progress}/${a.goal}</div>`:''}
        </div>`;}).join('')}
    </div>`;

  const byGameHtml = stats.length ? `
    <h3 class="stats-section-title">${esc(t('byGameTitle'))}</h3>
    <div class="stats-game-list">
      ${stats.map(s=>{
        const color = GAME_COLORS[s.gameType]||'var(--neon)';
        const pct = s.gamesPlayed ? Math.round(s.gamesWon/s.gamesPlayed*100) : 0;
        return `
        <div class="stats-game-card" style="border-left-color:${color}">
          <div class="stats-game-head"><span>${esc(t(GAME_TITLE_KEYS[s.gameType]||s.gameType))}</span><span style="color:${color};font-weight:700;">${s.gamesWon}/${s.gamesPlayed}</span></div>
          <div class="stats-game-bar-track"><div class="stats-game-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        </div>`;
      }).join('')}
    </div>` : `<p style="color:var(--text-dim);text-align:center;">${esc(t('statsEmpty'))}</p>`;

  const historyHtml = `
    <h3 class="stats-section-title">${esc(t('historyTitle'))}</h3>
    ${(history&&history.length) ? `<div class="history-list">
      ${history.map(h=>{
        const color = GAME_COLORS[h.gameType]||'var(--neon)';
        const emoji = GAME_EMOJI[h.gameType]||'⚽';
        const date = new Date(h.playedAt).toLocaleDateString(currentLang==='en'?'en-US':'es-ES', {day:'numeric', month:'short'});
        return `
        <div class="history-row" style="border-left-color:${color}">
          <div class="history-icon">${emoji}</div>
          <div class="history-info">
            <div class="history-game">${esc(t(GAME_TITLE_KEYS[h.gameType]||h.gameType))}</div>
            ${h.otherPlayers?`<div class="history-vs">${esc(t('historyVs',{names:h.otherPlayers}))}</div>`:''}
          </div>
          <div class="history-result ${h.won?'won':'lost'}">${h.won?esc(t('historyWon')):esc(t('historyLost'))}</div>
          <div class="history-date">${esc(date)}</div>
        </div>`;
      }).join('')}
    </div>` : `<p style="color:var(--text-dim);text-align:center;">${esc(t('historyEmpty'))}</p>`}`;

  $('stats-body').innerHTML = headerHtml + achvHtml + byGameHtml + historyHtml;
}
$('btn-my-stats').addEventListener('click', async ()=>{
  const tok=getAuthToken();
  $('stats-body').innerHTML = `<p style="color:var(--text-dim)">${esc(t('loading'))}</p>`;
  $('stats-overlay').classList.remove('hidden');
  try{
    const res = await fetch('/auth/me', { headers:{ Authorization:'Bearer '+tok } });
    const json = await res.json();
    if(!json.ok){ $('stats-body').innerHTML=`<p>${esc(t('statsError'))}</p>`; return; }
    _lastStatsData = json;
    renderStats();
  }catch(e){ $('stats-body').innerHTML=`<p>${esc(t('statsError'))}</p>`; }
});
document.addEventListener('langchange', ()=>{ if(!$('stats-overlay').classList.contains('hidden')) renderStats(); });
$('btn-stats-close').addEventListener('click',()=>$('stats-overlay').classList.add('hidden'));
$('stats-overlay').addEventListener('click', e=>{ if(e.target===$('stats-overlay'))$('stats-overlay').classList.add('hidden'); });

let _lastLeaderboardData = null;
function renderLeaderboard(){
  if(!_lastLeaderboardData) return;
  if(!_lastLeaderboardData.length){
    $('leaderboard-body').innerHTML = `<p style="color:var(--text-dim);text-align:center;">${esc(t('leaderboardEmpty'))}</p>`;
    return;
  }
  const rows = _lastLeaderboardData.map((u,i)=>`
    <div class="lb-row${i<3?' lb-top':''}">
      <div class="lb-rank">${i+1}</div>
      ${u.avatarUrl ? `<img class="lb-avatar" src="${esc(u.avatarUrl)}" alt=""/>` : `<div class="lb-avatar lb-avatar-blank">👤</div>`}
      <div class="lb-name">${esc(u.name||'')}</div>
      <div class="lb-wins">${u.totalWon}<span class="lb-wins-lbl">${esc(t('leaderboardWins'))}</span></div>
      <div class="lb-played">${u.totalPlayed}<span class="lb-played-lbl">${esc(t('leaderboardPlayed'))}</span></div>
    </div>`).join('');
  $('leaderboard-body').innerHTML = rows;
}
let _lbPeriod = 'all';
async function loadLeaderboard(){
  $('leaderboard-body').innerHTML = `<p style="color:var(--text-dim)">${esc(t('loading'))}</p>`;
  try{
    const res = await fetch('/api/leaderboard?period='+_lbPeriod);
    _lastLeaderboardData = await res.json();
    renderLeaderboard();
  }catch(e){ $('leaderboard-body').innerHTML = `<p>${esc(t('statsError'))}</p>`; }
}
$('btn-leaderboard').addEventListener('click', ()=>{
  $('leaderboard-overlay').classList.remove('hidden');
  loadLeaderboard();
});
$('lb-period-row').addEventListener('click', e=>{
  const btn = e.target.closest('.lb-period-btn'); if(!btn) return;
  if(btn.dataset.period===_lbPeriod) return;
  _lbPeriod = btn.dataset.period;
  document.querySelectorAll('.lb-period-btn').forEach(b=>b.classList.toggle('active', b===btn));
  loadLeaderboard();
});
document.addEventListener('langchange', ()=>{ if(!$('leaderboard-overlay').classList.contains('hidden')) renderLeaderboard(); });
$('btn-leaderboard-close').addEventListener('click',()=>$('leaderboard-overlay').classList.add('hidden'));
$('leaderboard-overlay').addEventListener('click', e=>{ if(e.target===$('leaderboard-overlay'))$('leaderboard-overlay').classList.add('hidden'); });

/* ===== Compartir tarjeta de perfil (imagen generada en canvas) ===== */
function roundRectPath(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.arcTo(x+w,y,x+w,y+h,r);
  ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);
  ctx.arcTo(x,y,x+w,y,r);
  ctx.closePath();
}
function drawEmojiCentered(ctx, emoji, cx, cy, size){
  const pa=ctx.textAlign, pb=ctx.textBaseline, pf=ctx.font;
  ctx.textAlign='center'; ctx.textBaseline='middle'; ctx.font=size+'px sans-serif';
  ctx.fillText(emoji, cx, cy);
  ctx.textAlign=pa; ctx.textBaseline=pb; ctx.font=pf;
}
// Con crossOrigin='anonymous', si el servidor de la imagen (CDN de Google/
// Discord, o nuestra propia base64) no permite lectura entre orígenes, la
// imagen directamente falla a cargar (no "ensucia" el canvas en silencio) —
// así que basta con caer al avatar de iniciales si esto rechaza.
function loadImageSafe(src, timeoutMs=4000){
  return new Promise((resolve,reject)=>{
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(()=>reject(new Error('timeout')), timeoutMs);
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('load failed')); };
    img.src = src;
  });
}
async function buildProfileCardDataUrl(){
  const {stats, achievements} = _lastStatsData;
  const totalPlayed = stats.reduce((s,x)=>s+x.gamesPlayed,0);
  const totalWon = stats.reduce((s,x)=>s+x.gamesWon,0);
  const winRate = totalPlayed ? Math.round(totalWon/totalPlayed*100) : 0;
  const unlocked = achievements.filter(a=>a.unlocked);

  const W=1080, H=1080;
  const canvas = document.createElement('canvas');
  canvas.width=W; canvas.height=H;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0,0,0,H);
  grad.addColorStop(0,'#0d141d'); grad.addColorStop(1,'#070b10');
  ctx.fillStyle=grad; ctx.fillRect(0,0,W,H);

  if(document.fonts && document.fonts.ready) await document.fonts.ready;

  ctx.textAlign='center';
  ctx.fillStyle='#b6ff2e';
  ctx.font='700 44px Oswald, sans-serif';
  ctx.fillText('412', W/2, 92);
  ctx.fillStyle='#9fb0ad';
  ctx.font='600 22px "Libre Franklin", sans-serif';
  ctx.fillText(t('appTagline').toUpperCase(), W/2, 126);

  const avatarSize=220, avatarY=180;
  ctx.save();
  roundRectPath(ctx, W/2-avatarSize/2, avatarY, avatarSize, avatarSize, avatarSize/2);
  ctx.clip();
  let avatarDrawn=false;
  if(authUser.avatar){
    try{ const img=await loadImageSafe(authUser.avatar); ctx.drawImage(img, W/2-avatarSize/2, avatarY, avatarSize, avatarSize); avatarDrawn=true; }
    catch(e){}
  }
  if(!avatarDrawn){
    const c=avatarFor(authUser.id||authUser.name||'?');
    ctx.fillStyle=c.bg; ctx.fillRect(W/2-avatarSize/2, avatarY, avatarSize, avatarSize);
    ctx.fillStyle=c.fg;
    drawEmojiCentered(ctx, (authUser.name||'?').trim().charAt(0).toUpperCase(), W/2, avatarY+avatarSize/2+8, 110);
  }
  ctx.restore();
  ctx.beginPath(); ctx.arc(W/2, avatarY+avatarSize/2, avatarSize/2, 0, Math.PI*2);
  ctx.lineWidth=6; ctx.strokeStyle='#b6ff2e'; ctx.stroke();

  ctx.fillStyle='#eef4ee';
  ctx.font='700 52px Oswald, sans-serif';
  ctx.fillText(authUser.name||'', W/2, avatarY+avatarSize+66);

  const statsY = avatarY+avatarSize+110;
  const boxW=290, gap=25, totalBoxW=boxW*3+gap*2, startX=(W-totalBoxW)/2;
  const statDefs=[
    {n:String(totalPlayed), lbl:t('statsGamesPlayed')},
    {n:String(totalWon), lbl:t('statsGamesWon')},
    {n:winRate+'%', lbl:t('statsWinRate')},
  ];
  statDefs.forEach((s,i)=>{
    const x=startX+i*(boxW+gap);
    roundRectPath(ctx, x, statsY, boxW, 140, 16);
    ctx.fillStyle='rgba(182,255,46,0.06)'; ctx.fill();
    roundRectPath(ctx, x, statsY, boxW, 140, 16);
    ctx.strokeStyle='#2a3d4f'; ctx.lineWidth=2; ctx.stroke();
    ctx.fillStyle='#b6ff2e';
    ctx.font='800 56px Oswald, sans-serif';
    ctx.fillText(s.n, x+boxW/2, statsY+72);
    ctx.fillStyle='#9fb0ad';
    ctx.font='600 20px "Libre Franklin", sans-serif';
    ctx.fillText(s.lbl.toUpperCase(), x+boxW/2, statsY+108);
  });

  const achY = statsY+195;
  ctx.fillStyle='#eef4ee';
  ctx.font='700 30px Oswald, sans-serif';
  ctx.fillText(`🏆 ${t('achievementsUnlockedOf',{n:unlocked.length,total:achievements.length})}`, W/2, achY);

  const badgeSize=92, badgeGap=22, maxBadges=6;
  const shown = unlocked.slice(0,maxBadges);
  const rowW = shown.length*badgeSize + Math.max(0,shown.length-1)*badgeGap;
  let bx = (W-rowW)/2;
  const by = achY+40;
  for(const a of shown){
    ctx.save();
    ctx.beginPath(); ctx.arc(bx+badgeSize/2, by+badgeSize/2, badgeSize/2, 0, Math.PI*2); ctx.clip();
    ctx.fillStyle='#111b26'; ctx.fillRect(bx,by,badgeSize,badgeSize);
    let drawn=false;
    if(a.iconImage){
      try{ const img=await loadImageSafe(a.iconImage); ctx.drawImage(img,bx,by,badgeSize,badgeSize); drawn=true; }
      catch(e){}
    }
    if(!drawn) drawEmojiCentered(ctx, a.iconEmoji||'🏆', bx+badgeSize/2, by+badgeSize/2, 50);
    ctx.restore();
    ctx.beginPath(); ctx.arc(bx+badgeSize/2, by+badgeSize/2, badgeSize/2, 0, Math.PI*2);
    ctx.strokeStyle='#e9b949'; ctx.lineWidth=3; ctx.stroke();
    bx += badgeSize+badgeGap;
  }

  ctx.fillStyle='#9fb0ad';
  ctx.font='600 24px "Libre Franklin", sans-serif';
  ctx.fillText(location.origin.replace(/^https?:\/\//,''), W/2, H-46);

  return canvas.toDataURL('image/png');
}
$('btn-share-card').addEventListener('click', async function(){
  if(!_lastStatsData || !authUser) return;
  const btn = this; const orig = btn.textContent;
  btn.disabled = true; btn.textContent = t('loading');
  try{
    const dataUrl = await buildProfileCardDataUrl();
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], '412-perfil.png', {type:'image/png'});
    if(navigator.canShare && navigator.canShare({files:[file]})){
      try{ await navigator.share({files:[file], title:'412', text:t('shareCardText')}); btn.disabled=false; btn.textContent=orig; return; }
      catch(e){ if(e.name==='AbortError'){ btn.disabled=false; btn.textContent=orig; return; } }
    }
    const a=document.createElement('a'); a.href=dataUrl; a.download='412-perfil.png'; document.body.appendChild(a); a.click(); a.remove();
    btn.textContent=t('shareCardSaved');
    setTimeout(()=>{ btn.textContent=orig; },2500);
  }catch(e){
    btn.textContent=t('shareCardError');
    setTimeout(()=>{ btn.textContent=orig; },2500);
  }
  btn.disabled = false;
});

/* ===== Amigos: agregar por código, ver quién está en línea ===== */
let _friendsData = { friendCode:'', friends:[], incoming:[], outgoing:[] };
async function loadFriends(){
  const tok = getAuthToken();
  if(!tok) return;
  try{
    const res = await fetch('/friends', { headers:{ Authorization:'Bearer '+tok } });
    const json = await res.json();
    if(!json.ok){ $('friends-error').textContent = json.error||t('friendsError'); $('friends-error').classList.remove('hidden'); return; }
    _friendsData = json;
    renderFriends();
  }catch(e){ $('friends-error').textContent = t('friendsError'); $('friends-error').classList.remove('hidden'); }
}
function updateFriendsUnreadBadge(){
  const n = _friendsData.incoming.length;
  const badge = $('friends-unread-badge');
  badge.textContent = n>9 ? '9+' : n;
  badge.classList.toggle('hidden', n===0);
}
function renderFriends(){
  $('friends-my-code').textContent = _friendsData.friendCode || '------';
  updateFriendsUnreadBadge();

  const inc = _friendsData.incoming;
  $('friends-incoming-section').classList.toggle('hidden', !inc.length);
  $('friends-incoming-list').innerHTML = inc.map(r=>`
    <div class="friend-row">
      ${r.avatar ? `<img class="friend-avatar" src="${esc(r.avatar)}" alt=""/>` : `<div class="friend-avatar"></div>`}
      <div class="friend-info"><div class="friend-name">${esc(r.name)}</div></div>
      <div class="friend-actions">
        <button class="chip-btn" data-accept-req="${r.id}">${esc(t('friendsAccept'))}</button>
        <button class="chip-btn chip-danger" data-decline-req="${r.id}">${esc(t('friendsDecline'))}</button>
      </div>
    </div>`).join('');

  const list = _friendsData.friends;
  if(!list.length){
    $('friends-list').innerHTML = `<p style="color:var(--text-dim);text-align:center;">${esc(t('friendsEmpty'))}</p>`;
  } else {
    $('friends-list').innerHTML = list.map(f=>`
      <div class="friend-row">
        ${f.avatar ? `<img class="friend-avatar" src="${esc(f.avatar)}" alt=""/>` : `<div class="friend-avatar"></div>`}
        <div class="friend-info">
          <div class="friend-name">${esc(f.name)}</div>
          <div class="friend-status"><span class="friend-status-dot${f.online?' online':''}" data-friend-dot="${f.id}"></span><span data-friend-status-label="${f.id}">${esc(f.online?t('friendsOnline'):t('friendsOffline'))}</span></div>
        </div>
        <div class="friend-actions" style="display:flex;gap:6px;">
          ${_albumActive ? `<button class="chip-btn" data-view-album="${f.id}" data-friend-name="${esc(f.name)}" title="${esc(t('albumViewFriendBtn'))}">📕</button>` : ''}
          <button class="chip-btn chip-danger" data-remove-friend="${f.id}" title="${esc(t('friendsRemove'))}">✕</button>
        </div>
      </div>`).join('');
  }
}
function openFriendsOverlay(){
  if(!authUser){ showHomeError(t('publicRequiresLogin')); return; }
  $('friends-error').classList.add('hidden');
  $('inp-friend-code').value = '';
  $('friends-overlay').classList.remove('hidden');
  loadFriends();
}
$('btn-friends').addEventListener('click', openFriendsOverlay);
$('btn-friends-close').addEventListener('click', ()=>$('friends-overlay').classList.add('hidden'));
$('friends-overlay').addEventListener('click', e=>{ if(e.target===$('friends-overlay'))$('friends-overlay').classList.add('hidden'); });
$('btn-friends-copy-code').addEventListener('click', async function(){
  if(!_friendsData.friendCode) return;
  try{ await navigator.clipboard.writeText(_friendsData.friendCode); const orig=this.textContent; this.textContent=t('copied'); setTimeout(()=>{ this.textContent=orig; },1500); }catch(e){}
});
$('btn-friends-add').addEventListener('click', async ()=>{
  const code = $('inp-friend-code').value.trim().toUpperCase();
  $('friends-error').classList.add('hidden');
  if(!code){ $('friends-error').textContent=t('friendsEnterCode'); $('friends-error').classList.remove('hidden'); return; }
  try{
    const res = await fetch('/friends/request', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+getAuthToken() }, body:JSON.stringify({code}) });
    const json = await res.json();
    if(!res.ok || !json.ok){ $('friends-error').textContent = json.error||t('friendsError'); $('friends-error').classList.remove('hidden'); return; }
    $('inp-friend-code').value = '';
    showToast(t('friendsRequestSent'), false);
  }catch(e){ $('friends-error').textContent = t('friendsError'); $('friends-error').classList.remove('hidden'); }
});
$('inp-friend-code').addEventListener('keydown', e=>{ if(e.key==='Enter') $('btn-friends-add').click(); });
$('friends-incoming-list').addEventListener('click', async e=>{
  const acceptBtn = e.target.closest('[data-accept-req]');
  const declineBtn = e.target.closest('[data-decline-req]');
  if(!acceptBtn && !declineBtn) return;
  const requestId = acceptBtn ? acceptBtn.dataset.acceptReq : declineBtn.dataset.declineReq;
  try{
    const res = await fetch('/friends/respond', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+getAuthToken() }, body:JSON.stringify({ requestId:Number(requestId), accept:!!acceptBtn }) });
    const json = await res.json();
    if(!res.ok || !json.ok) throw new Error(json.error||'error');
    loadFriends();
  }catch(e){ showToast(t('friendsError'), true); }
});
$('friends-list').addEventListener('click', async e=>{
  const viewBtn = e.target.closest('[data-view-album]');
  if(viewBtn){ $('friends-overlay').classList.add('hidden'); openFriendAlbum(viewBtn.dataset.viewAlbum, viewBtn.dataset.friendName); return; }
  const btn = e.target.closest('[data-remove-friend]'); if(!btn) return;
  if(!confirm(t('friendsRemoveConfirm'))) return;
  try{
    const res = await fetch('/friends/'+btn.dataset.removeFriend, { method:'DELETE', headers:{ Authorization:'Bearer '+getAuthToken() } });
    const json = await res.json();
    if(!res.ok || !json.ok) throw new Error(json.error||'error');
    loadFriends();
  }catch(e){ showToast(t('friendsError'), true); }
});
socket.on('friend:presence', ({userId,online})=>{
  const f = _friendsData.friends.find(x=>x.id===userId);
  if(!f) return;
  f.online = online;
  const dot = document.querySelector(`[data-friend-dot="${userId}"]`);
  const label = document.querySelector(`[data-friend-status-label="${userId}"]`);
  if(dot) dot.classList.toggle('online', online);
  if(label) label.textContent = online ? t('friendsOnline') : t('friendsOffline');
});
socket.on('friend:list_changed', ()=>{ if(authUser) loadFriends(); });
document.addEventListener('langchange', ()=>{ if(!$('friends-overlay').classList.contains('hidden')) renderFriends(); });

/* ===== Álbum de estampas y sobres ===== */
let _albumActive = false;
let _albumData = { points:0, catalog:[], owned:[], total:0, packs:{}, packCredits:{}, exclusives:[] };
let _albumViewingFriendId = null; // null = mi álbum; si no, el id del amigo que estoy viendo (solo lectura)
async function loadAlbumStatus(){
  const tok = getAuthToken();
  if(!tok){ _albumActive=false; $('btn-album').classList.add('hidden'); return; }
  try{
    const res = await fetch('/album/status', { headers:{ Authorization:'Bearer '+tok } });
    const json = await res.json();
    _albumActive = !!(json && json.active);
    $('btn-album').classList.toggle('hidden', !_albumActive);
    if(_albumActive) loadAlbum();
  }catch(e){ _albumActive=false; $('btn-album').classList.add('hidden'); }
}
async function loadAlbum(){
  const tok = getAuthToken();
  if(!tok || !_albumActive) return;
  try{
    const res = await fetch('/album', { headers:{ Authorization:'Bearer '+tok } });
    const json = await res.json();
    if(!json.ok) return;
    _albumData = json;
    $('album-points-badge').textContent = json.points;
    renderAlbumSummary();
  }catch(e){}
}
function stickerImg(cardId, owned){
  return `/images/${owned?'reales':'siluetas'}/${encodeURIComponent(cardId.toLowerCase())}.png`;
}
function renderAlbumSummary(){
  const viewingFriend = !!_albumViewingFriendId;
  $('album-overlay-title').textContent = viewingFriend ? '📕 '+t('albumOfName',{name:_albumData.friendName||'?'}) : t('albumTitle');
  $('album-points-text').classList.toggle('hidden', viewingFriend);
  $('btn-open-packs').classList.toggle('hidden', viewingFriend);
  $('btn-album-back').classList.toggle('hidden', !viewingFriend);
  const ownedSet = new Set(_albumData.owned);
  $('album-progress-text').textContent = `${ownedSet.size}/${_albumData.total}`;
  $('album-progress-fill').style.width = (_albumData.total ? ownedSet.size/_albumData.total*100 : 0)+'%';
  $('album-points-text').textContent = '🪙 '+_albumData.points;
  $('album-grid').innerHTML = _albumData.catalog.map(c=>{
    const owned = ownedSet.has(c.id);
    const posY = c.imgPosY ?? 20;
    return `<div class="album-sticker rareza-${esc(c.rareza)}${owned?'':' locked'}">
      <img src="${esc(stickerImg(c.id, owned))}" alt="" loading="lazy" style="object-position:50% ${posY}%"/>
      <div class="as-name">${owned ? esc(c.name) : '?'}</div>
    </div>`;
  }).join('');
  const exclusives = viewingFriend ? [] : (_albumData.exclusives||[]);
  $('album-exclusives-section').classList.toggle('hidden', !exclusives.length);
  $('album-exclusives-grid').innerHTML = exclusives.map(s=>`
    <div class="album-sticker exclusive">
      <img src="${esc(s.imagePath)}" alt="" loading="lazy"/>
      <div class="as-name">${esc(s.name)}</div>
    </div>`).join('');
}
function openAlbumOverlay(){
  if(!_albumActive) return;
  _albumViewingFriendId = null;
  $('album-overlay').classList.remove('hidden');
  loadAlbum();
}
async function openFriendAlbum(friendId, friendName){
  const tok = getAuthToken();
  if(!tok || !_albumActive) return;
  try{
    const res = await fetch('/album/'+friendId, { headers:{ Authorization:'Bearer '+tok } });
    const json = await res.json();
    if(!res.ok || !json.ok){ showToast(json.error||t('friendsError'), true); return; }
    _albumViewingFriendId = friendId;
    _albumData = { points:0, catalog:json.catalog, owned:json.owned, total:json.total, packs:_albumData.packs, friendName:json.friendName||friendName };
    renderAlbumSummary();
    $('album-overlay').classList.remove('hidden');
  }catch(e){ showToast(t('friendsError'), true); }
}
$('btn-album').addEventListener('click', openAlbumOverlay);
$('btn-album-back').addEventListener('click', openAlbumOverlay);
$('btn-album-close').addEventListener('click', ()=>$('album-overlay').classList.add('hidden'));
$('album-overlay').addEventListener('click', e=>{ if(e.target===$('album-overlay'))$('album-overlay').classList.add('hidden'); });
$('btn-open-packs').addEventListener('click', ()=>{
  $('album-overlay').classList.add('hidden');
  renderPacksList();
  $('pack-reveal').classList.add('hidden'); $('pack-reveal').innerHTML='';
  $('pack-odds-panel').classList.add('hidden'); $('pack-odds-panel').innerHTML='';
  $('packs-overlay').classList.remove('hidden');
});
$('btn-packs-close').addEventListener('click', ()=>$('packs-overlay').classList.add('hidden'));
$('packs-overlay').addEventListener('click', e=>{ if(e.target===$('packs-overlay'))$('packs-overlay').classList.add('hidden'); });
const PACK_LABELS = { bronce:{icon:'🥉',name:'Bronce'}, plata:{icon:'🥈',name:'Plata'}, oro:{icon:'🥇',name:'Oro'} };
const RAREZA_LABEL_COLORS = { mediano:'#999', top:'#4fc3f7', leyenda:'#ffd700' };
const RAREZA_LABEL_NAMES = { mediano:'Mediano', top:'Top', leyenda:'Leyenda' };
function renderPackOdds(){
  const packs = _albumData.packs || {};
  $('pack-odds-panel').innerHTML = Object.keys(packs).map(key=>{
    const p = packs[key]; const meta = PACK_LABELS[key] || {icon:'🎁',name:key};
    const total = Object.values(p.odds||{}).reduce((a,b)=>a+b,0) || 1;
    const rows = Object.keys(p.odds||{}).map(r=>{
      const pct = (p.odds[r]/total*100).toFixed(1);
      return `<div class="pack-odds-row"><span style="color:${RAREZA_LABEL_COLORS[r]||'var(--ink)'}">${RAREZA_LABEL_NAMES[r]||r}</span><span>${pct}%</span></div>`;
    }).join('');
    return `<div class="pack-odds-group"><div class="pack-odds-group-title">${meta.icon} ${esc(meta.name)}</div>${rows}</div>`;
  }).join('');
}
$('btn-pack-odds').addEventListener('click', ()=>{
  const panel = $('pack-odds-panel');
  const willShow = panel.classList.contains('hidden');
  if(willShow) renderPackOdds();
  panel.classList.toggle('hidden', !willShow);
});
function renderPacksList(){
  const packs = _albumData.packs || {};
  const credits = _albumData.packCredits || {};
  $('packs-list').innerHTML = Object.keys(packs).map(key=>{
    const p = packs[key]; const meta = PACK_LABELS[key] || {icon:'🎁',name:key};
    const free = credits[key]||0;
    return `<div class="pack-card" data-tier="${esc(key)}">
      <div class="pc-info">
        <div class="pc-name">${meta.icon} ${esc(meta.name)}</div>
        <div class="pc-desc">${t('packStickersDesc',{n:p.stickers})}</div>
      </div>
      <div class="pc-actions">
        ${free>0 ? `<button class="chip-btn pc-free-btn" data-open-free="${esc(key)}">${esc(t('packOpenFreeBtn',{n:free}))}</button>` : ''}
        <button class="chip-btn" data-open-pack="${esc(key)}">🪙 ${p.cost}</button>
      </div>
    </div>`;
  }).join('');
}
// Revela las estampas una por una (no todas de golpe), con su propio
// sonido y color según rareza — se siente más a "abrir un sobre" que un
// volcado instantáneo de resultados.
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }
async function revealPackResults(results){
  const revealEl = $('pack-reveal');
  revealEl.classList.remove('hidden');
  revealEl.innerHTML = '';
  for(let i=0;i<results.length;i++){
    const r = results[i];
    if(i>0) await sleep(260);
    const card = document.createElement('div');
    card.className = `pack-reveal-card rareza-${esc(r.rareza)}${r.isNew?' is-new':''}`;
    card.innerHTML = `
      <img src="${esc(stickerImg(r.cardId, true))}" alt="" style="object-position:50% ${r.imgPosY ?? 20}%"/>
      <div class="prc-name">${esc(r.name)}</div>
      <div class="prc-tag">${r.isNew ? t('packNewSticker') : '+'+r.scrapAwarded+' pts'}</div>`;
    revealEl.appendChild(card);
    if(r.isNew) sfx.newSticker(); else sfx.tick();
  }
}
async function openPack(url, packType, btn){
  btn.disabled = true;
  try{
    const res = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+getAuthToken() }, body:JSON.stringify({packType}) });
    const json = await res.json();
    if(!res.ok || !json.ok){ showToast(json.error||t('friendsError'), true); btn.disabled=false; return; }
    _albumData.points = json.newBalance;
    $('album-points-badge').textContent = json.newBalance;
    if('remainingCredits' in json){
      _albumData.packCredits = { ..._albumData.packCredits, [packType]: json.remainingCredits };
      renderPacksList();
    }
    sfx.packOpen();
    await revealPackResults(json.results);
  }catch(e){ showToast(t('friendsError'), true); }
  finally{ btn.disabled = false; }
}
$('packs-list').addEventListener('click', e=>{
  const freeBtn = e.target.closest('[data-open-free]');
  if(freeBtn && !freeBtn.disabled){ openPack('/packs/open-free', freeBtn.dataset.openFree, freeBtn); return; }
  const btn = e.target.closest('[data-open-pack]');
  if(btn && !btn.disabled){ openPack('/packs/open', btn.dataset.openPack, btn); }
});
socket.on('player:points_earned', ({amount, newBalance})=>{
  _albumData.points = newBalance;
  $('album-points-badge').textContent = newBalance;
  showToast(t('pointsEarnedToast',{amount}), false);
});
const TIER_LABELS = { top50:'Top 50%', top20:'Top 20%', top10:'Top 10%', top5:'Top 5%', first:'#1' };
const PERIOD_LABELS = { weekly:'semanal', monthly:'mensual' };
socket.on('rewards:granted', ({periodType, tier, reward, exclusiveGranted})=>{
  const rewardText = reward ? `${reward.count} ${(PACK_LABELS[reward.packType]||{}).name||reward.packType}` : '';
  // Un solo toast (showToast no encola, un segundo llamado inmediato pisaría
  // el primero) — si viene la exclusiva, se agrega como segunda línea.
  let msg = `🏆 ${TIER_LABELS[tier]||tier} ${PERIOD_LABELS[periodType]||periodType} — ${t('rewardsGotToast',{reward:rewardText})}`;
  if(exclusiveGranted) msg += ' · ⭐ '+t('rewardsExclusiveToast',{name:exclusiveGranted.name});
  showToast(msg, false);
  if(_albumActive && !_albumViewingFriendId) loadAlbum(); // refresca sobres/estampas si el álbum está abierto
});

/* ===== Invitar amigos en línea directo a la sala (sin código) ===== */
function renderInviteFriends(){
  const online = _friendsData.friends.filter(f=>f.online);
  if(!online.length){
    $('invite-friends-body').innerHTML = `<p style="color:var(--text-dim);text-align:center;">${esc(t('inviteFriendsEmpty'))}</p>`;
    return;
  }
  $('invite-friends-body').innerHTML = online.map(f=>`
    <div class="invite-friend-row">
      ${f.avatar ? `<img class="friend-avatar" src="${esc(f.avatar)}" alt=""/>` : `<div class="friend-avatar"></div>`}
      <div class="friend-info"><div class="friend-name">${esc(f.name)}</div></div>
      <button class="chip-btn" data-invite-friend="${f.id}">${esc(t('inviteFriendsSend'))}</button>
    </div>`).join('');
}
$('btn-invite-friends').addEventListener('click', ()=>{
  renderInviteFriends();
  $('invite-friends-overlay').classList.remove('hidden');
});
$('btn-invite-friends-close').addEventListener('click', ()=>$('invite-friends-overlay').classList.add('hidden'));
$('invite-friends-overlay').addEventListener('click', e=>{ if(e.target===$('invite-friends-overlay'))$('invite-friends-overlay').classList.add('hidden'); });
$('invite-friends-body').addEventListener('click', e=>{
  const btn = e.target.closest('[data-invite-friend]'); if(!btn || btn.disabled) return;
  const friendUserId = Number(btn.dataset.inviteFriend);
  socket.emit('player:invite_friend', { code:roomCode, friendUserId }, (res)=>{
    if(res && res.ok){ btn.disabled=true; btn.textContent=t('inviteFriendsSent'); showToast(t('inviteFriendsSentToast'), false); sfx.inviteSent(); }
    else showToast((res&&res.error)||t('friendsError'), true);
  });
});

/* ===== Recibir una invitación de amigo a su sala ===== */
let _pendingInvite = null;
let _inviteBannerTimer = null;
function hideInviteBanner(){
  const el = $('room-invite-banner');
  el.classList.remove('show');
  el.classList.add('hidden');
  clearTimeout(_inviteBannerTimer);
  _pendingInvite = null;
}
socket.on('friend:room_invite', ({code,hostName,gameType,isPublic})=>{
  _pendingInvite = { code, isPublic };
  const gameLabel = gameType ? t(GAME_TITLE_KEYS[gameType]||gameType) : null;
  $('room-invite-text').textContent = gameLabel
    ? t('inviteReceivedText', { name:hostName, game:gameLabel })
    : t('inviteReceivedTextNoGame', { name:hostName });
  const el = $('room-invite-banner');
  el.classList.remove('hidden');
  el.classList.add('show');
  clearTimeout(_inviteBannerTimer);
  _inviteBannerTimer = setTimeout(hideInviteBanner, 30000);
  sfx.inviteReceived(); vib([60,40,60]);
});
$('btn-invite-accept').addEventListener('click', ()=>{
  const invite = _pendingInvite; hideInviteBanner();
  if(!invite) return;
  if(roomCode){ showHomeError(t('inviteAlreadyInRoom')); return; }
  const name = ($('inp-name').value.trim()) || authUser?.name || '';
  if(!name){ showHomeError(t('enterYourName')); return; }
  $('inp-name').value = name;
  socket.emit('player:join_room', { code:invite.code, name, authToken:getAuthToken() }, onJoined);
});
$('btn-invite-decline').addEventListener('click', hideInviteBanner);

/* ===== Perfil de juego (nombre e imagen personalizados, aparte de la cuenta OAuth) ===== */
// 'unchanged': no tocar el avatar guardado; 'clear': volver a la foto original de la
// cuenta; 'new': subir _profileAvatarData como nueva foto personalizada.
let _profileAvatarAction = 'unchanged';
let _profileAvatarData = null;
function openProfileEditor(){
  if(!authUser) return;
  _profileAvatarAction = 'unchanged'; _profileAvatarData = null;
  $('profile-avatar-preview').src = authUser.avatar || '/images/ui/logo.png';
  $('profile-name').value = authUser.name || '';
  $('profile-error').classList.add('hidden');
  $('btn-profile-avatar-clear').classList.toggle('hidden', !authUser.hasCustomAvatar);
  $('profile-overlay').classList.remove('hidden');
}
$('btn-edit-profile').addEventListener('click', openProfileEditor);
$('btn-profile-close').addEventListener('click', ()=>$('profile-overlay').classList.add('hidden'));
$('profile-overlay').addEventListener('click', e=>{ if(e.target===$('profile-overlay'))$('profile-overlay').classList.add('hidden'); });

// Redimensiona/comprime la foto en el navegador antes de mandarla: evita
// subir fotos de varios MB directo desde la cámara del celular.
function resizeImageToDataUrl(file, maxSize){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const sx = (img.width-side)/2, sy = (img.height-side)/2;
        const canvas = document.createElement('canvas');
        canvas.width = maxSize; canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
$('profile-avatar-file').addEventListener('change', async (e)=>{
  const file = e.target.files[0]; if(!file) return;
  try{
    const dataUrl = await resizeImageToDataUrl(file, 256);
    _profileAvatarData = dataUrl; _profileAvatarAction = 'new';
    $('profile-avatar-preview').src = dataUrl;
    $('btn-profile-avatar-clear').classList.remove('hidden');
  }catch(e){
    $('profile-error').textContent = t('profileImageError');
    $('profile-error').classList.remove('hidden');
  }
  $('profile-avatar-file').value = '';
});
$('btn-profile-avatar-clear').addEventListener('click', ()=>{
  _profileAvatarAction = 'clear'; _profileAvatarData = null;
  $('profile-avatar-preview').src = '/images/ui/logo.png';
});
$('btn-profile-save').addEventListener('click', async ()=>{
  $('profile-error').classList.add('hidden');
  const body = { displayName: $('profile-name').value.trim() };
  if(_profileAvatarAction==='new') body.avatarImage = _profileAvatarData;
  else if(_profileAvatarAction==='clear') body.avatarImage = null;
  try{
    const res = await fetch('/auth/profile', { method:'PUT', headers:{ 'Content-Type':'application/json', Authorization:'Bearer '+getAuthToken() }, body: JSON.stringify(body) });
    const json = await res.json();
    if(!res.ok || !json.ok){ $('profile-error').textContent = json.error || t('profileError'); $('profile-error').classList.remove('hidden'); return; }
    authUser = { id:json.user.id, name:json.user.name, avatar:json.user.avatar, provider:json.user.provider, hasCustomAvatar:json.user.hasCustomAvatar };
    if(json.token) setAuthToken(json.token);
    renderAuthUI();
    showToast(t('profileSaved'), false);
    $('profile-overlay').classList.add('hidden');
  }catch(e){ $('profile-error').textContent = t('profileError'); $('profile-error').classList.remove('hidden'); }
});

/* ===== Compartir código (link directo con ?code=) ===== */
$('btn-share').addEventListener('click', async () => {
  const url  = `${location.origin}/?code=${roomCode}`;
  const text = t('shareInviteText', {url});
  if(navigator.share){ try{ await navigator.share({title:'412',text,url}); }catch(e){} }
  else { try{ await navigator.clipboard.writeText(url); $('btn-share').textContent='✓ '+t('copied'); setTimeout(()=>$('btn-share').textContent=t('shareCode'),2000);}catch(e){} }
});

// QR de la sala: se carga recién al abrirlo (no antes de que exista roomCode,
// y para no pedirle al servidor un QR que tal vez nadie mira).
$('btn-toggle-qr').addEventListener('click', () => {
  const box=$('qr-box'); const open=box.classList.toggle('hidden');
  $('btn-toggle-qr').textContent = open ? t('showQr') : t('hideQr');
  if(!open && !_qrLoaded && roomCode){ $('qr-img').src=`/qr/${roomCode}`; _qrLoaded=true; }
});

$('tv-hint').addEventListener('click', async () => {
  if(!tvLink) return;
  try{ await navigator.clipboard.writeText(tvLink); $('tv-hint').textContent='✓ '+t('linkCopied'); setTimeout(()=>$('tv-hint').textContent=t('tvView'),2000); }
  catch(e){}
});

// Salir de la sala: por si el navegador reintegra solo a una sala vieja
// (sesion guardada de otra partida) y la persona quiere volver al inicio
// para crear/unirse a otra. Limpiamos la sesion guardada y recargamos.
$('btn-leave-room').addEventListener('click', () => {
  if(!confirm(t('leaveRoomConfirm'))) return;
  clearSession();
  location.reload();
});

socket.on('room:kicked', () => {
  clearSession();
  alert(t('kickedAlert'));
  location.reload();
});

/* ===== REGLAS ===== */
const RULES_KEYS = {
  impostor:   { titleKey:'rulesImpTitle',        htmlKey:'rulesImpHtml' },
  mentiroso:  { titleKey:'rulesMentirosoTitle',  htmlKey:'rulesMentirosoHtml' },
  subasta:    { titleKey:'rulesSubastaTitle',    htmlKey:'rulesSubastaHtml' },
  wavelength: { titleKey:'rulesWavelengthTitle', htmlKey:'rulesWavelengthHtml' },
  who:        { titleKey:'rulesWhoTitle',        htmlKey:'rulesWhoHtml' },
};

let _lobbyGameType = null;

function openRules(){
  const game = currentGame || _lobbyGameType;
  const r = RULES_KEYS[game];
  $('rules-title').textContent = r ? t('howToPlayGame',{title:t(r.titleKey)}) : t('rulesTitle');
  $('rules-body').innerHTML = r ? t(r.htmlKey) : Object.values(RULES_KEYS).map(g=>`<h3>${t(g.titleKey)}</h3>${t(g.htmlKey)}`).join('');
  $('rules-overlay').classList.remove('hidden');
}
document.addEventListener('langchange', ()=>{ if(!$('rules-overlay').classList.contains('hidden')) openRules(); });
$('btn-rules').addEventListener('click', openRules);

/* ===== Contacto / feedback ===== */
$('btn-contact').addEventListener('click', () => {
  $('inp-contact-message').value=''; $('inp-contact-contact').value='';
  $('contact-error').classList.add('hidden'); $('contact-success').classList.add('hidden');
  $('btn-contact-send').disabled=false;
  $('contact-overlay').classList.remove('hidden');
});
$('btn-contact-close').addEventListener('click', ()=>$('contact-overlay').classList.add('hidden'));
$('contact-overlay').addEventListener('click', e=>{ if(e.target===$('contact-overlay'))$('contact-overlay').classList.add('hidden'); });
document.querySelectorAll('input[name=ctype]').forEach(r=>r.addEventListener('change',()=>{
  ['contact-type-bug','contact-type-suggestion','contact-type-other'].forEach(id=>{
    $(id).classList.toggle('checked', $(id).querySelector('input').checked);
  });
}));
$('btn-contact-send').addEventListener('click', async () => {
  const message=$('inp-contact-message').value.trim();
  $('contact-error').classList.add('hidden'); $('contact-success').classList.add('hidden');
  if(!message){ $('contact-error').textContent=t('contactEmptyError'); $('contact-error').classList.remove('hidden'); return; }
  $('btn-contact-send').disabled=true;
  try{
    const res = await fetch('/api/feedback', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        message,
        contact: $('inp-contact-contact').value.trim(),
        type: document.querySelector('input[name=ctype]:checked')?.value||'other',
        roomCode: roomCode||'',
        gameType: currentGame||'',
      }),
    });
    const json = await res.json();
    if(!res.ok || !json.ok){ $('contact-error').textContent=json.error||t('contactSendError'); $('contact-error').classList.remove('hidden'); $('btn-contact-send').disabled=false; return; }
    $('contact-success').textContent=t('contactSentOk'); $('contact-success').classList.remove('hidden');
    setTimeout(()=>$('contact-overlay').classList.add('hidden'), 1800);
  }catch(e){
    $('contact-error').textContent=t('contactSendError'); $('contact-error').classList.remove('hidden'); $('btn-contact-send').disabled=false;
  }
});
$('btn-rules-close').addEventListener('click', ()=>$('rules-overlay').classList.add('hidden'));
$('rules-overlay').addEventListener('click', e=>{ if(e.target===$('rules-overlay'))$('rules-overlay').classList.add('hidden'); });

/* ===== LOBBY ===== */
let ALL_CATEGORIES=[], ALL_FORMATIONS=[], maxImpostors=1, minPlayers=3;
const CAT_KEYS={futbolista:'catFutbolistas',equipo:'catEquipos','selección':'catSelecciones',dt:'catDts'};
const CAT_LABELS=new Proxy({},{get:(_,cat)=>t(CAT_KEYS[cat])||cat});

// Aviso visible cuando alguien se desconecta/reconecta a mitad de partida.
// En el lobby ya se ve en el chip de cada jugador, así que solo avisamos
// fuera de él (donde antes no había ninguna señal de esto).
let _prevConnMap = null;
function _checkDisconnectToasts(st){
  if(st.status==='lobby'){ _prevConnMap=null; return; }
  const cur=new Map(st.players.map(p=>[p.id,p.connected]));
  if(_prevConnMap){
    for(const [id,isConn] of cur.entries()){
      const was=_prevConnMap.get(id);
      if(was===undefined) continue;
      if(was && !isConn){ const p=st.players.find(x=>x.id===id); showToast(t('playerDisconnected',{name:p?.name||'?'}), true); }
      else if(!was && isConn && id!==myId){ const p=st.players.find(x=>x.id===id); showToast(t('playerReconnected',{name:p?.name||'?'}), false); }
    }
  }
  _prevConnMap=cur;
}
let _toastTimer=null;
function showToast(msg, urgent){
  let el=$('conn-toast');
  if(!el){ el=document.createElement('div'); el.id='conn-toast'; el.className='conn-toast'; el.setAttribute('aria-live','polite'); el.setAttribute('role','status'); document.body.appendChild(el); }
  el.textContent=msg; el.classList.toggle('urgent',!!urgent); el.classList.add('show');
  clearTimeout(_toastTimer); _toastTimer=setTimeout(()=>el.classList.remove('show'), 4000);
}

// El anfitrión se desconectó a mitad de partida: el servidor le pasó el
// control a otro jugador conectado tras un margen de espera. Avisamos a
// todos, porque de golpe alguien nuevo tiene los botones de "continuar".
socket.on('host:reassigned', ({newHostName}) => { showToast(t('hostReassigned',{name:newHostName}), true); });

let _achvToastQueue = [];
let _achvToastShowing = false;
function _showNextAchievementToast(){
  if(_achvToastShowing || !_achvToastQueue.length) return;
  _achvToastShowing = true;
  const a = _achvToastQueue.shift();
  const title = (currentLang==='en' ? a.titleEn : a.titleEs) || a.titleEs || a.titleEn || '';
  const iconHtml = a.iconImage ? `<img src="${esc(a.iconImage)}" alt=""/>` : esc(a.iconEmoji||'🏆');
  let el = $('achv-toast');
  if(!el){ el=document.createElement('div'); el.id='achv-toast'; el.className='achv-toast'; document.body.appendChild(el); }
  el.innerHTML = `<div class="achv-toast-icon">${iconHtml}</div><div class="achv-toast-text"><div class="achv-toast-label">${esc(t('achievementUnlocked'))}</div><div class="achv-toast-title">${esc(title)}</div></div>`;
  requestAnimationFrame(()=>el.classList.add('show'));
  setTimeout(()=>{
    el.classList.remove('show');
    setTimeout(()=>{ _achvToastShowing=false; _showNextAchievementToast(); }, 400);
  }, 4200);
}
socket.on('achievements:unlocked', ({achievements}) => {
  if(!achievements || !achievements.length) return;
  _achvToastQueue.push(...achievements);
  _showNextAchievementToast();
});

socket.on('room:update', (st) => {
  players = st.players;
  isHost = (st.hostId === myId);
  currentGame = st.gameType;
  if(st.status==='lobby') _lobbyGameType = st.gameType||null;
  maxImpostors = st.maxImpostors; minPlayers = st.minPlayers;
  if(st.formations) formationsData = st.formations;
  _checkDisconnectToasts(st);
  _roomIsPublic = !!st.isPublic;
  _chatEnabled = !!st.chatEnabled;
  updateChatVisibility();
  $('chat-toggle-row').classList.toggle('hidden', !isHost || _roomIsPublic);
  $('btn-toggle-chat-enabled').textContent = t(_chatEnabled ? 'chatEnableOn' : 'chatEnableOff');
  $('btn-toggle-chat-enabled').classList.toggle('chip-danger', !_chatEnabled);
  $('invite-friends-row').classList.toggle('hidden', !isHost || !authUser);

  if(st.status==='lobby'){
    renderLobby(st);
    // Asegurar que se vea el lobby en este estado: cubre volver de un resultado
    // anterior Y reconectarse (recarga de página) mientras la sala sigue en el
    // lobby, donde la sección visible por defecto es "s-home". Se evita llamar
    // show() si ya estamos en el lobby, para no re-disparar la animación de
    // entrada en cada actualización (p.ej. cada vez que alguien más se une).
    if(currentVisibleSection()!=='s-lobby') show('s-lobby');
  }
});

function currentVisibleSection(){ return SECTIONS.find(s=>!$(s).classList.contains('hidden')); }

function renderLobby(st){
  renderLobby.lastState = st;
  const grid=$('lobby-players'); grid.innerHTML='';
  st.players.forEach(p=>{
    const c=document.createElement('div'); c.className='player-chip'+(p.id===myId?' me':'');
    const kickHtml = isHost&&p.id!==myId ? `<button class="kick-btn" data-id="${esc(p.id)}" title="${t('kickAria')}">✕</button>` : '';
    c.innerHTML=`<div class="player-chip-top">${avatarHTML(p.id,p.name,p.avatar)}<div class="name">${esc(p.name)}</div>${kickHtml}</div><div class="meta">${p.isHost?t('host'):(p.connected?t('connected'):'...')}</div>`;
    grid.appendChild(c);
  });
  grid.querySelectorAll('.kick-btn').forEach(btn=>{
    btn.addEventListener('click',()=>socket.emit('host:kick_player',{code:roomCode,targetId:btn.dataset.id}));
  });
  $('player-count').textContent=st.players.length;

  $('lobby-public-badge').classList.toggle('hidden',!st.isPublic);
  $('lobby-game-pick-grid').classList.toggle('locked',!!st.isPublic);
  $('game-pick-locked-note').classList.toggle('hidden',!st.isPublic);

  $('host-controls').classList.toggle('hidden',!isHost);
  $('guest-wait').classList.toggle('hidden',isHost);

  // El modo "voz" de Mentiroso necesita que los jugadores se escuchen entre
  // sí; sin chat de voz en el juego, una sala pública (con desconocidos)
  // no lo puede ofrecer — se oculta la opción y se fuerza "texto".
  $('lie-mode-voz').classList.toggle('hidden', !!st.isPublic);
  if(st.isPublic && !document.querySelector('input[name=lm][value=texto]').checked){
    document.querySelector('input[name=lm][value=texto]').checked = true;
    $('lie-mode-texto').classList.add('checked');
    $('lie-mode-voz').classList.remove('checked');
  }

  if(isHost){
    renderGamePicker(st.gameType);
    const opts = st.gameOptions || {};
    populateSelect('cfg-lie-rounds',  opts.lieRoundOptions,  st.mentirosoConfig?.roundCount);
    populateSelect('cfg-wave-rounds', opts.waveRoundOptions, st.waveConfig?.roundCount);
    populateSelect('cfg-who-rounds',  opts.whoRoundOptions,  st.whoConfig?.roundCount);
    populateBudgetSelect('cfg-sub-budget', opts.subBudgetOptions, st.subastaConfig?.budget);
    populateSelect('cfg-sub-skips',   opts.subSkipOptions,   st.subastaConfig?.skipLimit);
    if(st.gameType==='impostor') renderImpostorCfg(st.impostorConfig, opts);
    if(st.gameType==='who') renderWhoCfg(st.whoConfig);
    updateStartBtn(st.players.length);
  }
}

function renderGamePicker(g){
  $('pick-impostor').classList.toggle('selected',g==='impostor');
  $('pick-mentiroso').classList.toggle('selected',g==='mentiroso');
  $('pick-subasta').classList.toggle('selected',g==='subasta');
  $('pick-wavelength').classList.toggle('selected',g==='wavelength');
  $('pick-who').classList.toggle('selected',g==='who');
  $('cfg-impostor').classList.toggle('hidden',g!=='impostor');
  $('cfg-mentiroso').classList.toggle('hidden',g!=='mentiroso');
  $('cfg-subasta').classList.toggle('hidden',g!=='subasta');
  $('cfg-wavelength').classList.toggle('hidden',g!=='wavelength');
  $('cfg-who').classList.toggle('hidden',g!=='who');
}
function updateStartBtn(n){
  const can=n>=minPlayers&&currentGame;
  $('btn-start').classList.toggle('hidden',!currentGame);
  $('btn-start').disabled=!can;
  $('start-hint').textContent=!currentGame?t('hintChooseGame'):(n<minPlayers?t('hintMissingPlayers',{min:minPlayers}):t('hintReady'));
}

$('pick-impostor').addEventListener('click',()=>socket.emit('host:select_game',{code:roomCode,gameType:'impostor'}));
$('pick-mentiroso').addEventListener('click',()=>socket.emit('host:select_game',{code:roomCode,gameType:'mentiroso'}));
$('pick-subasta').addEventListener('click',()=>socket.emit('host:select_game',{code:roomCode,gameType:'subasta'}));
$('pick-wavelength').addEventListener('click',()=>socket.emit('host:select_game',{code:roomCode,gameType:'wavelength'}));
$('pick-who').addEventListener('click',()=>socket.emit('host:select_game',{code:roomCode,gameType:'who'}));

function populateSelect(selId, options, currentVal){
  const sel=$(selId);
  if(!sel||!options?.length) return;
  const prev = currentVal ?? Number(sel.value);
  sel.innerHTML = options.map(v=>`<option value="${v}">${v}</option>`).join('');
  const best = options.includes(prev) ? prev : options.reduce((a,b)=>Math.abs(b-prev)<Math.abs(a-prev)?b:a);
  sel.value = best;
}
function populateBudgetSelect(selId, options, currentVal){
  const sel=$(selId);
  if(!sel||!options?.length) return;
  const prev = currentVal ?? Number(sel.value);
  sel.innerHTML = options.map(v=>`<option value="${v}">$${v}M</option>`).join('');
  const best = options.includes(prev) ? prev : options.reduce((a,b)=>Math.abs(b-prev)<Math.abs(a-prev)?b:a);
  sel.value = best;
}

let impCfgRendered=false;
function renderImpostorCfg(cfg, opts){
  const sel=$('cfg-imp-count'); const prev=Number(sel.value)||cfg.impostorCount;
  sel.innerHTML=''; for(let i=1;i<=maxImpostors;i++){const o=document.createElement('option');o.value=i;o.textContent=i;sel.appendChild(o);} sel.value=Math.min(prev,maxImpostors);
  populateSelect('cfg-imp-mangas', opts?.impMangaOptions, cfg.mangaCount);
  if(!impCfgRendered){
    const wrap=$('cfg-imp-cats'); wrap.innerHTML='';
    ALL_CATEGORIES.forEach(cat=>{
      const l=document.createElement('label'); l.className='category-chip'+(cfg.categories.includes(cat)?' checked':'');
      l.innerHTML=`<input type="checkbox" value="${cat}" ${cfg.categories.includes(cat)?'checked':''}/> ${CAT_LABELS[cat]||cat}`;
      l.querySelector('input').addEventListener('change',()=>{l.classList.toggle('checked');sendImpCfg();});
      wrap.appendChild(l);
    });
    impCfgRendered=true;
  }
}
function sendImpCfg(){
  socket.emit('host:update_impostor_config',{code:roomCode,impostorCount:Number($('cfg-imp-count').value),mangaCount:Number($('cfg-imp-mangas').value),categories:[...document.querySelectorAll('#cfg-imp-cats input:checked')].map(i=>i.value)});
}
$('cfg-imp-count').addEventListener('change',sendImpCfg);
$('cfg-imp-mangas').addEventListener('change',sendImpCfg);

function sendLieCfg(){ socket.emit('host:update_mentiroso_config',{code:roomCode,roundCount:Number($('cfg-lie-rounds').value),mode:document.querySelector('input[name=lm]:checked').value,namingSeconds:Number($('cfg-lie-seconds').value)}); }
$('cfg-lie-rounds').addEventListener('change',sendLieCfg);
$('cfg-lie-seconds').addEventListener('change',sendLieCfg);
document.querySelectorAll('input[name=lm]').forEach(r=>r.addEventListener('change',()=>{
  $('lie-mode-texto').classList.toggle('checked',document.querySelector('input[name=lm][value=texto]').checked);
  $('lie-mode-voz').classList.toggle('checked',document.querySelector('input[name=lm][value=voz]').checked);
  sendLieCfg();
}));

function sendSubCfg(){ socket.emit('host:update_subasta_config',{code:roomCode,budget:Number($('cfg-sub-budget').value),skipLimit:Number($('cfg-sub-skips').value),winMode:document.querySelector('input[name=wm]:checked').value}); }
$('cfg-sub-budget').addEventListener('change',sendSubCfg);
$('cfg-sub-skips').addEventListener('change',sendSubCfg);
document.querySelectorAll('input[name=wm]').forEach(r=>r.addEventListener('change',()=>{
  const ovr=document.querySelector('input[name=wm][value=ovr]').checked;
  $('win-mode-ovr').classList.toggle('checked',ovr);
  $('win-mode-votacion').classList.toggle('checked',!ovr);
  $('win-mode-desc').textContent=ovr?t('winModeDescOvr'):t('winModeDescVotacion');
  sendSubCfg();
}));

function sendWaveCfg(){ socket.emit('host:update_wave_config',{code:roomCode,roundCount:Number($('cfg-wave-rounds').value)}); }
$('cfg-wave-rounds').addEventListener('change',sendWaveCfg);

let whoCfgRendered=false;
const WHO_CATS=['futbolista','dt','equipo','selección'];
function renderWhoCfg(cfg){
  $('cfg-who-rounds').value=String(cfg.roundCount||1);
  if(whoCfgRendered)return;
  const wrap=$('cfg-who-cats'); wrap.innerHTML='';
  WHO_CATS.forEach(cat=>{
    const l=document.createElement('label'); l.className='category-chip'+(cfg.categories.includes(cat)?' checked':'');
    l.innerHTML=`<input type="checkbox" value="${cat}" ${cfg.categories.includes(cat)?'checked':''}/> ${CAT_LABELS[cat]||cat}`;
    l.querySelector('input').addEventListener('change',()=>{l.classList.toggle('checked');sendWhoCfg();});
    wrap.appendChild(l);
  });
  whoCfgRendered=true;
}
function sendWhoCfg(){ socket.emit('host:update_who_config',{code:roomCode,categories:[...document.querySelectorAll('#cfg-who-cats input:checked')].map(i=>i.value),roundCount:Number($('cfg-who-rounds').value)}); }
$('cfg-who-rounds').addEventListener('change',sendWhoCfg);

$('btn-start').addEventListener('click',()=>socket.emit('host:start_match',{code:roomCode}));

/* ===================== EL IMPOSTOR ===================== */
let impManga={n:1,c:3}, impTurn=null;
socket.on('imp:manga_started',({mangaNumber,mangaCount})=>{ impManga={n:mangaNumber,c:mangaCount}; });
socket.on('imp:role',({isImpostor,impostorCount,category,concept})=>{
  acquireWakeLock();
  const card=$('imp-role-card');
  if(isImpostor){ card.className='role-card impostor'; $('imp-role-icon').textContent='🕵️'; $('imp-role-label').textContent=t('impYouAreImpostor'); $('imp-role-concept').textContent='???'; $('imp-role-hint').textContent=t('impHintImpostor',{cat:category||'?',extra:impostorCount>1?t('impHintImpostorMulti',{n:impostorCount}):t('impHintImpostorSingle')}); }
  else { card.className='role-card innocent'; $('imp-role-icon').textContent='⚽'; $('imp-role-label').textContent=t('impConceptLabel',{cat:category}); $('imp-role-concept').textContent=concept; $('imp-role-hint').textContent=impostorCount>1?t('impHintInnocentMulti',{n:impostorCount}):t('impHintInnocentSingle'); }
  sfx.turn(); vib(100);
  show('s-imp-role');
});
$('btn-imp-role-ok').addEventListener('click',()=>{ renderClue(); show('s-imp-clue'); });
socket.on('imp:round',({roundNumber,currentTurnPlayerId})=>{ $('imp-round').textContent=roundNumber; impTurn=currentTurnPlayerId; $('imp-clue-log').innerHTML=''; if(currentVisibleSection()!=='s-imp-role'){renderClue();show('s-imp-clue');} });
socket.on('imp:turn',({currentTurnPlayerId})=>{ impTurn=currentTurnPlayerId; if(currentVisibleSection()==='s-imp-clue')renderClue(); });
function renderClue(){
  $('imp-manga-label').textContent=t('impRoundLabel',{n:impManga.n,c:impManga.c});
  const grid=$('imp-players'); grid.innerHTML='';
  players.forEach(p=>{ const c=document.createElement('div'); c.className='player-chip'+(p.id===impTurn?' turn':'')+(p.id===myId?' me':''); c.innerHTML=`<div class="player-chip-top">${avatarHTML(p.id,p.name,p.avatar)}<div class="name">${esc(p.name)}</div></div>`; grid.appendChild(c); });
  const mine=impTurn===myId;
  $('imp-my-turn').classList.toggle('hidden',!mine);
  $('imp-wait-turn').classList.toggle('hidden',mine);
  if(mine){ $('inp-clue').value=''; $('clue-error').classList.add('hidden'); }
  else {
    const t=players.find(p=>p.id===impTurn);
    $('imp-turn-name').textContent=t?t.name:'—';
    const av=$('imp-turn-avatar'); const c=avatarFor(impTurn||'?');
    av.style.background=c.bg; av.style.color=c.fg;
    av.textContent=(t?t.name:'?').trim().charAt(0).toUpperCase()||'?';
  }
}
$('btn-clue').addEventListener('click',()=>{ const w=$('inp-clue').value.trim(); if(w)socket.emit('player:submit_clue',{code:roomCode,word:w}); });
$('inp-clue').addEventListener('keydown',e=>{ if(e.key==='Enter')$('btn-clue').click(); });
socket.on('imp:clue_rejected',({reason})=>{ $('clue-error').textContent=reason; $('clue-error').classList.remove('hidden'); });
socket.on('imp:clue',({name,word})=>{ const log=$('imp-clue-log'); const it=document.createElement('div'); it.className='clue-item'; it.innerHTML=`<span>${esc(word)}</span><span class="who">${esc(name)}</span>`; log.prepend(it); });
socket.on('imp:clue_phase_ending',()=>{ $('imp-my-turn').classList.add('hidden'); $('imp-wait-turn').classList.remove('hidden'); $('imp-turn-name').textContent=t('impVotingLabel'); const av=$('imp-turn-avatar'); av.style.background='var(--bg2)'; av.style.color='var(--neon)'; av.textContent='⏳'; });
let impVoted=false;
socket.on('imp:voting',({candidates})=>{ sfx.announce(); impVoted=false; const g=$('imp-vote-grid'); g.innerHTML=''; candidates.filter(c=>c.id!==myId).forEach(c=>{ const b=document.createElement('button'); b.className='vote-btn'; b.textContent=c.name; b.addEventListener('click',()=>castVote(c.id,b)); g.appendChild(b); }); $('imp-vote-status').textContent=''; show('s-imp-vote'); });
function castVote(id,btn){ if(impVoted)return; impVoted=true; document.querySelectorAll('#imp-vote-grid .vote-btn').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); $('imp-vote-status').textContent=t('impVoteSent'); socket.emit('player:submit_vote',{code:roomCode,targetId:id}); }
socket.on('imp:vote_count',({votesIn,votesNeeded})=>{ if(impVoted)$('imp-vote-status').textContent=t('impVoteSentCount',{in:votesIn,needed:votesNeeded}); });
socket.on('imp:elimination',({eliminatedName,wasImpostor})=>{ wasImpostor?sfx.win():sfx.wrong(); $('imp-reveal-banner').className='reveal-banner '+(wasImpostor?'caught':'escaped'); $('imp-reveal-eyebrow').textContent=(wasImpostor?t('impCaught'):t('impEscaped')); $('imp-reveal-title').textContent=eliminatedName; $('imp-reveal-sub').textContent=wasImpostor?t('impWasImpostor'):t('impMatchContinues'); show('s-imp-reveal'); });
socket.on('imp:tie',({tiedPlayers})=>{ $('imp-reveal-banner').className='reveal-banner escaped'; $('imp-reveal-eyebrow').textContent=t('impTie'); $('imp-reveal-title').textContent=t('impNobodyOut'); $('imp-reveal-sub').textContent=(tiedPlayers||[]).join(' vs '); show('s-imp-reveal'); });
let impLastFinal=false;
socket.on('imp:manga_over',({result,concept,impostorNames,mangaNumber,mangaCount,isLastManga,scores})=>{
  impLastFinal=isLastManga;
  $('imp-over-banner').className='reveal-banner '+(result==='impostors_caught'?'caught':'escaped');
  $('imp-over-eyebrow').textContent=(result==='impostors_caught'?t('impostorsCaught'):t('impostorsWon'))+' · '+t('roundOf',{n:mangaNumber,c:mangaCount});
  $('imp-over-title').textContent=t('impWereImpostor',{names:impostorNames.join(', '),verb:impostorNames.length>1?t('impWereVerb'):t('impWasVerb')});
  $('imp-over-sub').textContent=t('impConceptSummary',{name:concept.name,cat:concept.category});
  renderScores('imp-scoreboard',scores,isLastManga);
  $('btn-imp-next').textContent=isLastManga?t('backToStart'):t('nextRound');
  $('btn-imp-next').classList.toggle('hidden',!isHost);
  $('imp-over-wait').classList.toggle('hidden',isHost);
  $('btn-share-imp').classList.toggle('hidden',!isLastManga);
  $('btn-rematch-imp').classList.toggle('hidden',!isHost||!isLastManga);
  _impWinner = scores[0]?.name||'';
  if(isLastManga){ sfx.fanfare(); show('s-imp-over'); showWinnerThen(scores,()=>show('s-imp-over'),2.5); }
  else { sfx.reveal(); show('s-imp-over'); }
});
let _impWinner='';
$('btn-imp-next').addEventListener('click',()=>{ if(impLastFinal)socket.emit('host:new_session',{code:roomCode}); else socket.emit('host:next_manga',{code:roomCode}); });
$('btn-share-imp').addEventListener('click',()=>doShareResult($('btn-share-imp'), _impWinner, 'gameImpostorTitle'));
$('btn-rematch-imp').addEventListener('click',()=>socket.emit('host:rematch',{code:roomCode}));
// reportable: true solo en la pantalla de posiciones FINALES (no en marcadores
// de mitad de partida) — ahí se puede reportar a un jugador por arruinar el
// juego a propósito (pistas/respuestas sin sentido), no solo por chat.
function renderScores(elId,scores,reportable){
  const b=$(elId); b.innerHTML='';
  scores.forEach((p,i)=>{
    const r=document.createElement('div'); r.className='score-row';
    const canReport = reportable && _roomIsPublic && p.id!==myId;
    const reportBtn = canReport ? `<button class="score-report-btn" data-player-id="${esc(p.id)}" title="${esc(t('scoreReportBtn'))}">🚩</button>` : '';
    r.innerHTML=`<span class="rank">${rankLabel(i)}</span><span style="flex:1;margin-left:8px;">${esc(p.name)}${reportBtn}</span><span class="points">${p.score} pts</span>`;
    b.appendChild(r);
  });
}
function handleScoreReportClick(e){
  const btn = e.target.closest('.score-report-btn'); if(!btn) return;
  if(!confirm(t('scoreReportConfirm'))) return;
  socket.emit('player:report_player', { code:roomCode, targetPlayerId:btn.dataset.playerId }, (res)=>{
    if(res && res.ok) showToast(t('chatReportSent'), false);
    else showToast((res&&res.error)||t('chatReportError'), true);
  });
}
['imp-scoreboard','lie-scoreboard','wave-scoreboard','who-scoreboard','force-over-scoreboard','sub-scoreboard'].forEach(id=>{
  $(id).addEventListener('click', handleScoreReportClick);
});

/* ===== Compartir resultado final ===== */
async function doShareResult(btn, winnerName, gameLabelKey){
  if(!winnerName||!btn)return;
  const url = location.origin;
  const text = t('shareResultText', {winner:winnerName, game:t(gameLabelKey), url});
  if(navigator.share){ try{ await navigator.share({title:'412', text, url}); }catch(e){} return; }
  try{ await navigator.clipboard.writeText(text); const orig=btn.textContent; btn.textContent=t('shareCopied'); setTimeout(()=>{btn.textContent=orig;},2000); }catch(e){}
}

/* ===================== MENTIROSO ===================== */
let lieMode='texto', lieTurn=null, lieClaim=0, lieCd=null, amAccused=false, amAccuser=false, liePaused=false;
function startLieCd(deadline){ stopLieCd(); const el=$('lie-countdown'); let wasUrgent=false; function tick(){const r=Math.max(0,Math.ceil((deadline-Date.now())/1000));el.textContent=r;const urgent=r<=3&&r>0;el.classList.toggle('urgent',urgent);if(urgent&&!wasUrgent){sfx.urgent();vib(30);}wasUrgent=urgent;if(r<=0)stopLieCd();} tick(); lieCd=setInterval(tick,250); }
function stopLieCd(){ if(lieCd){clearInterval(lieCd);lieCd=null;} }
// El que acuso puede frenar el reloj para verificar en vivo una respuesta
// dudosa antes de que se acabe el tiempo. Solo el/la acusador ve el boton;
// los demas ven un aviso de que esta en pausa.
function setLiePauseUI(paused, remainingMs){
  liePaused=paused;
  $('btn-lie-pause').textContent = paused ? t('resumeTime') : t('pauseTime');
  $('lie-pause-indicator').classList.toggle('hidden', !paused || amAccuser);
  if(paused){ stopLieCd(); if(typeof remainingMs==='number') $('lie-countdown').textContent=Math.ceil(remainingMs/1000); }
}
$('btn-lie-pause').addEventListener('click',()=>socket.emit('player:lie_toggle_pause',{code:roomCode}));
socket.on('lie:pause_state',({paused,deadlineAt,remainingMs})=>{
  setLiePauseUI(paused, remainingMs);
  if(!paused && deadlineAt) startLieCd(deadlineAt);
});
socket.on('lie:round',({roundNumber,roundCount,category,mode,currentTurnPlayerId})=>{ $('lie-round').textContent=roundNumber; $('lie-round-count').textContent=roundCount; $('lie-category').textContent=pickLang(category); $('lie-claim-amount').textContent='0'; lieClaim=0; lieMode=mode; lieTurn=currentTurnPlayerId; acquireWakeLock(); renderLieClaim(); show('s-lie-claim'); });
socket.on('lie:turn',({currentTurnPlayerId})=>{ lieTurn=currentTurnPlayerId; if(currentVisibleSection()==='s-lie-claim')renderLieClaim(); });
socket.on('lie:claim',({amount})=>{ lieClaim=amount; const el=$('lie-claim-amount'); el.textContent=amount; bump(el); });
function renderLieClaim(){ const mine=lieTurn===myId; $('lie-my-turn').classList.toggle('hidden',!mine); $('lie-wait-turn').classList.toggle('hidden',mine); if(mine){$('inp-claim').value='';$('claim-error').classList.add('hidden');$('btn-accuse').disabled=lieClaim<=0; sfx.turn(); vib(80);}else{const pl=players.find(p=>p.id===lieTurn);$('lie-turn-name').textContent=pl?pl.name:'—';const av=$('lie-turn-avatar');const c=avatarFor(lieTurn||'?');av.style.background=c.bg;av.style.color=c.fg;av.textContent=(pl?pl.name:'?').trim().charAt(0).toUpperCase()||'?';} }
$('btn-claim').addEventListener('click',()=>{ const v=Number($('inp-claim').value); if(!Number.isInteger(v)||v<=lieClaim){$('claim-error').textContent=t('mustBeGreaterThan',{n:lieClaim});$('claim-error').classList.remove('hidden');return;} socket.emit('player:make_claim',{code:roomCode,amount:v}); });
$('btn-accuse').addEventListener('click',()=>socket.emit('player:accuse_liar',{code:roomCode}));
socket.on('lie:claim_rejected',({reason})=>{ $('claim-error').textContent=reason; $('claim-error').classList.remove('hidden'); });
socket.on('lie:accused',({accuserId,accuserName,accusedId,accusedName,target,category,mode,deadlineAt,paused,remainingMs})=>{
  amAccused=accusedId===myId; amAccuser=accuserId===myId; lieMode=mode;
  if(amAccused) sfx.turn();
  const catText=pickLang(category);
  $('lie-target').textContent=target; $('lie-named-count').textContent='0'; $('lie-named-log').innerHTML='';
  $('lie-naming-heading').textContent=amAccused?t('didntBelieveYou',{accuser:accuserName,target,cat:catText}):t('accusedOf',{accuser:accuserName,accused:accusedName,cat:catText});
  $('btn-mark').classList.add('hidden'); $('lie-am-accused').classList.add('hidden'); $('lie-naming-wait').classList.add('hidden');
  if(mode==='voz'){ if(amAccuser){$('btn-mark').classList.remove('hidden');}else if(amAccused){$('lie-naming-wait').classList.remove('hidden');$('lie-naming-wait').textContent=t('sayAnswersAloud');}else{$('lie-naming-wait').classList.remove('hidden');$('lie-naming-wait').textContent=t('listenAndJudge');} }
  else { if(amAccused){$('lie-am-accused').classList.remove('hidden');$('inp-name-item').value='';}else{$('lie-naming-wait').classList.remove('hidden');$('lie-naming-wait').textContent=t('isTyping',{name:accusedName});} }
  $('btn-lie-pause').classList.toggle('hidden', !amAccuser);
  setLiePauseUI(!!paused, remainingMs);
  if(!paused) startLieCd(deadlineAt);
  show('s-lie-naming');
});
$('btn-mark').addEventListener('click',()=>socket.emit('player:mark_answer',{code:roomCode}));
socket.on('lie:answer_marked',({count,deadlineAt})=>{ $('lie-named-count').textContent=count; bump($('lie-named-count')); const log=$('lie-named-log');const it=document.createElement('div');it.className='clue-item';it.innerHTML=`<span>${esc(t('answerNumber',{n:count}))}</span><span class="who">✓</span>`;log.prepend(it); if(deadlineAt)startLieCd(deadlineAt);else stopLieCd(); });
$('btn-name-item').addEventListener('click',sendNameItem); $('inp-name-item').addEventListener('keydown',e=>{if(e.key==='Enter')sendNameItem();});
function sendNameItem(){ const val=$('inp-name-item').value.trim(); if(!val)return; $('inp-name-item').value=''; socket.emit('player:name_item',{code:roomCode,text:val}); }
socket.on('lie:item',({text,count,deadlineAt})=>{ $('lie-named-count').textContent=count; bump($('lie-named-count')); const log=$('lie-named-log');const it=document.createElement('div');it.className='clue-item';it.innerHTML=`<span>${esc(text)}</span><span class="who">#${count}</span>`;log.prepend(it); if(deadlineAt)startLieCd(deadlineAt);else stopLieCd(); });
let lieEligible=false;
socket.on('lie:final_vote',({target,mode,namedSoFar,eligibleVoterIds})=>{
  stopLieCd(); lieEligible=eligibleVoterIds.includes(myId);
  $('lie-final-title').textContent=t('answersValid',{n:target});
  const list=$('lie-final-list'); list.innerHTML='';
  if(mode==='texto'&&namedSoFar)namedSoFar.forEach(txt=>{const it=document.createElement('div');it.className='clue-item';it.innerHTML=`<span>${esc(txt)}</span>`;list.appendChild(it);});
  else { const it=document.createElement('div');it.className='clue-item';it.innerHTML=`<span>${esc(t('saidAloudAccept'))}</span>`;list.appendChild(it); }
  $('lie-can-vote').classList.toggle('hidden',!lieEligible);
  $('lie-final-status').textContent=lieEligible?t('voteColon'):(amAccused?t('groupVoting'):t('waitingVotes'));
  show('s-lie-final');
});
$('btn-lie-valid').addEventListener('click',()=>castLieVote(true)); $('btn-lie-invalid').addEventListener('click',()=>castLieVote(false));
function castLieVote(v){ $('lie-can-vote').classList.add('hidden'); $('lie-final-status').textContent=t('voteSentDots'); socket.emit('player:vote_final',{code:roomCode,valid:v}); }
socket.on('lie:final_progress',({votesIn,votesNeeded})=>{ if($('lie-can-vote').classList.contains('hidden'))$('lie-final-status').textContent=t('votesCount',{in:votesIn,needed:votesNeeded}); });
let lieLastFinal=false;
socket.on('lie:resolved',({success,reason,accusedName,accuserName,roundNumber,roundCount,isLastRound,scores})=>{
  stopLieCd(); lieLastFinal=isLastRound;
  success ? sfx.win() : sfx.wrong();
  $('lie-over-banner').className='reveal-banner '+(success?'caught':'escaped');
  $('lie-over-eyebrow').textContent=isLastRound?t('finalResult'):t('roundOf',{n:roundNumber,c:roundCount});
  $('lie-over-title').textContent=success?t('liarSucceeded',{name:accusedName}):(reason==='timeout'?t('liarTimeout',{name:accusedName}):t('liarFailed',{name:accusedName}));
  $('lie-over-sub').textContent=success?t('accuserLosesPoint',{name:accuserName}):t('accuserGainsPoint',{name:accuserName});
  renderScores('lie-scoreboard', scores, isLastRound);
  $('btn-lie-next').textContent=isLastRound?t('backToStart'):t('nextRound');
  $('btn-lie-next').classList.toggle('hidden',!isHost);
  $('lie-over-wait').classList.toggle('hidden',isHost);
  $('btn-share-lie').classList.toggle('hidden',!isLastRound);
  $('btn-rematch-lie').classList.toggle('hidden',!isHost||!isLastRound);
  _lieWinner = scores[0]?.name||'';
  if(isLastRound){ show('s-lie-over'); showWinnerThen(scores,()=>show('s-lie-over'),2.5); }
  else show('s-lie-over');
});
let _lieWinner='';
$('btn-lie-next').addEventListener('click',()=>{ if(lieLastFinal)socket.emit('host:new_session',{code:roomCode}); else socket.emit('host:next_lie_round',{code:roomCode}); });
$('btn-share-lie').addEventListener('click',()=>doShareResult($('btn-share-lie'), _lieWinner, 'gameMentirosoTitle'));
$('btn-rematch-lie').addEventListener('click',()=>socket.emit('host:rematch',{code:roomCode}));

/* ===================== SUBASTA ===================== */
// Carga la imagen del jugador desde las imágenes propias del servidor.
//   revealed=false -> silueta negra (/images/siluetas/<id>.png)
//   revealed=true  -> foto a color (/images/reales/<id>.png)
// Si la imagen no existe todavía, muestra el placeholder (inicial de la posición).
function loadSil(imgEl,phEl,phPosEl,cardId,posName,revealed){
  if(!imgEl)return;
  if(!cardId){ silPh(imgEl,phEl,phPosEl,posName); return; }
  const carpeta = revealed ? 'reales' : 'siluetas';
  const url = `/images/${carpeta}/${encodeURIComponent(cardId.toLowerCase())}.png`;
  imgEl.className = 'silhouette-img revealed';
  imgEl.onerror = ()=>{ silPh(imgEl,phEl,phPosEl,posName); }; // sin imagen: placeholder
  imgEl.onload = ()=>{ imgEl.classList.remove('hidden'); if(phEl)phEl.classList.add('hidden'); };
  imgEl.src = url;
}
function silPh(img,ph,phPos,posName){ if(img){img.classList.add('hidden');img.src='';} if(ph)ph.classList.remove('hidden'); if(phPos&&posName)phPos.textContent=posName.charAt(0); }

let subState={budget:1000,skipsLeft:5,teamCount:0}, subHighest=0, subStart=0, subEligible=false, subFormCd=null, iSkipped=false, currentFormation='4-3-3';
let formationsData={}, currentFormationSlots=[];
// Countdown de subasta: animación local fluida, corregida por cada tick del servidor.
// Esto evita el "correteo" en celulares con red lenta: el número baja suave
// localmente, pero cada tick del servidor lo re-sincroniza si se desvió.
let subClockTarget=0;
let subClockIv=null;
let subClockLastShown=-1;
let subClockActive=false;
let subZeroSince=0;
function setSubCount(seconds){
  subClockTarget = Date.now() + seconds*1000;
  subClockActive = true;
  if(!subClockIv){
    subClockIv = setInterval(tickSubClockLocal, 250);
    tickSubClockLocal();
  }
}
function tickSubClockLocal(){
  if(!subClockActive){ return; }
  const el=$('sub-countdown');
  if(!el) return;
  const remaining = Math.max(0, Math.round((subClockTarget - Date.now())/1000));
  // Solo tocar el DOM si el número realmente cambió (evita redibujos innecesarios)
  if(remaining !== subClockLastShown){
    subClockLastShown = remaining;
    el.textContent = remaining;
    el.classList.toggle('urgent', remaining<=5);
  }
  // Salvaguarda anti-atasco: si llevamos varios segundos clavados en 0,
  // significa que se perdió el evento del servidor. Pedimos re-sincronización.
  if(remaining===0){
    subZeroSince = subZeroSince || Date.now();
    if(Date.now()-subZeroSince > 3000){
      subZeroSince = Date.now(); // evitar spamear
      if(roomCode) socket.emit('player:request_sub_sync',{code:roomCode});
    }
  } else {
    subZeroSince = 0;
  }
}
function stopSubClock(){ subClockActive=false; if(subClockIv){clearInterval(subClockIv);subClockIv=null;} subClockLastShown=-1; }
function updSubStats(){ $('sub-budget').textContent=`$${subState.budget}M`; $('sub-skips').textContent=subState.skipsLeft; $('sub-team-count').textContent=`${subState.teamCount}/11`; bump($('sub-budget')); bump($('sub-skips')); const skipBtn=$('btn-skip'); if(skipBtn) skipBtn.textContent=t('passSkips',{n:subState.skipsLeft}); }
function updBidBtns(){ const base=Math.max(subHighest,subStart); $('bp1').textContent=base+1; $('bp5').textContent=base+5; $('bp10').textContent=base+10; }

socket.on('sub:formation_vote',({formations,formationsData:fd,secondsLeft})=>{
  if(fd) formationsData=fd;
  const box=$('sub-form-buttons'); box.innerHTML=''; $('sub-form-voted').classList.add('hidden');
  formations.forEach(f=>{ const b=document.createElement('button'); b.className='btn-secondary'; b.textContent=f; b.addEventListener('click',()=>{ box.querySelectorAll('button').forEach(x=>x.disabled=true); socket.emit('player:vote_formation',{code:roomCode,formation:f}); $('sub-form-voted').classList.remove('hidden'); }); box.appendChild(b); });
  const el=$('sub-form-countdown'); el.textContent=secondsLeft; el.classList.toggle('urgent',secondsLeft<=5);
  show('s-sub-formation');
});
socket.on('sub:formation_tick',({secondsLeft})=>{ const el=$('sub-form-countdown'); if(el){el.textContent=secondsLeft;el.classList.toggle('urgent',secondsLeft<=5);} });
socket.on('sub:formation_vote_cast',({votesIn,totalPlayers})=>{ $('sub-form-votes').textContent=t('votesN',{n:`${votesIn}/${totalPlayers}`}); });
socket.on('sub:formation_decided',({formation,formationSlots})=>{ currentFormation=formation; currentFormationSlots=formationSlots||(formationsData[formation]||[]); subState.teamCount=0; updSubStats(); $('sub-formation-decided').textContent=t('formationLabel',{f:formation}); show('s-sub-wait-deck'); });

socket.on('sub:card',({cardIndex,totalCards,cardId,position,positionLabel,startingPrice,secondsLeft})=>{
  sfx.card();
  subHighest=0; subStart=startingPrice; subEligible=false; iSkipped=false;
  $('sub-counter').textContent=`${cardIndex+1}/${totalCards}`;
  const badge=$('sub-pos-badge'); badge.textContent=positionLabel; badge.className='position-badge '+posGroup(position);
  $('sub-price').textContent=t('basePriceLabel',{p:startingPrice});
  $('sub-highest').textContent=t('noBidsYet');
  $('sub-bid-log').innerHTML='';
  $('sub-phase-label').textContent=t('analyzing');
  $('sub-can-bid').classList.add('hidden'); $('sub-bid-sent').classList.add('hidden'); $('sub-ineligible').classList.add('hidden');
  updBidBtns();
  loadSil($('sub-img'),$('sub-img-placeholder'),$('sub-img-pos'),cardId,positionLabel,false);
  const silBox=document.querySelector('#s-sub-play .silhouette-container'); silBox.classList.remove('flash'); void silBox.offsetWidth; silBox.classList.add('flash');
  show('s-sub-play');           // mostrar la pantalla primero...
  stopSubClock();               // ...resetear cualquier reloj previo...
  setSubCount(secondsLeft);     // ...y arrancar el reloj local ya en pantalla
});
socket.on('sub:eligibility',({eligible,skipsLeft,budget})=>{ subState.skipsLeft=skipsLeft; if(typeof budget==='number') subState.budget=budget; subEligible=eligible; updSubStats(); $('sub-ineligible').classList.toggle('hidden',eligible); });
socket.on('sub:tick',({phase,secondsLeft})=>{ setSubCount(secondsLeft); $('sub-phase-label').textContent=phase==='analysis'?t('analyzing'):t('biddingOpen'); });
socket.on('sub:bidding_open',({eligible,skipsLeft})=>{
  sfx.announce();
  $('sub-phase-label').textContent=t('biddingOpen');
  // La elegibilidad viene en el propio evento: fuente de verdad confiable.
  if(typeof eligible==='boolean') subEligible=eligible;
  if(typeof skipsLeft==='number'){ subState.skipsLeft=skipsLeft; updSubStats(); }
  if(subEligible){
    $('sub-ineligible').classList.add('hidden');
    $('sub-bid-sent').classList.add('hidden');
    $('sub-can-bid').classList.remove('hidden');
    $('btn-skip').disabled=subState.skipsLeft<=0;
    updBidBtns();
  } else {
    $('sub-can-bid').classList.add('hidden');
    $('sub-ineligible').classList.remove('hidden');
  }
});
socket.on('sub:bid_public',({name,amount,highestBid})=>{ sfx.bid();
  subHighest=highestBid.amount;
  const iAmHighest = highestBid.playerId === myId;
  $('sub-highest').textContent=t('bestBid',{amount:highestBid.amount,name:esc(highestBid.name)});
  bump($('sub-highest'));
  updBidBtns();
  // Registrar en el log de pujas
  const log=$('sub-bid-log');const it=document.createElement('div');it.className='clue-item';it.innerHTML=`<span style="color:var(--lime);font-family:var(--mono);">$${amount}M</span><span class="who">${esc(name)}</span>`;log.prepend(it);
  // Si soy elegible y NO pasé (skip), gestionar mis botones
  if(subEligible && !iSkipped){
    if(iAmHighest){
      // Voy ganando: ocultar botones, mostrar mensaje
      $('sub-can-bid').classList.add('hidden');
      $('sub-bid-sent').classList.remove('hidden');
      $('sub-bid-sent-msg').textContent=t('winningWith',{amount});
    } else {
      // Otro me superó: vuelvo a poder pujar
      $('sub-bid-sent').classList.add('hidden');
      $('sub-can-bid').classList.remove('hidden');
      $('btn-skip').disabled=subState.skipsLeft<=0;
      updBidBtns();
    }
  }
});
socket.on('sub:skip_public',({name})=>{ const log=$('sub-bid-log');const it=document.createElement('div');it.className='clue-item';it.innerHTML=`<span style="color:var(--text-dim);">skip</span><span class="who">${esc(name)}</span>`;log.prepend(it); });
socket.on('sub:timer_extended',({secondsLeft})=>{ sfx.tick(); setSubCount(secondsLeft); const log=$('sub-bid-log');const it=document.createElement('div');it.className='clue-item';it.innerHTML='<span style="color:var(--red);">⏱ +5s</span>';log.prepend(it); });
function sendBid(inc){ const base=Math.max(subHighest,subStart); $('sub-can-bid').classList.add('hidden'); $('sub-bid-sent').classList.remove('hidden'); $('sub-bid-sent-msg').textContent=t('biddingAmount',{amount:base+inc}); socket.emit('player:submit_bid',{code:roomCode,amount:base+inc}); }
$('btn-bid-1').addEventListener('click',()=>sendBid(1)); $('btn-bid-5').addEventListener('click',()=>sendBid(5)); $('btn-bid-10').addEventListener('click',()=>sendBid(10));
$('btn-skip').addEventListener('click',()=>{ iSkipped=true; $('sub-can-bid').classList.add('hidden'); $('sub-bid-sent').classList.remove('hidden'); $('sub-bid-sent-msg').textContent=t('youPassedCard'); socket.emit('player:skip_card',{code:roomCode}); });
socket.on('sub:bid_rejected',({reason})=>{ $('bid-error').textContent=reason; $('bid-error').classList.remove('hidden'); if(!iSkipped){$('sub-can-bid').classList.remove('hidden'); $('sub-bid-sent').classList.add('hidden');} updBidBtns(); setTimeout(()=>$('bid-error').classList.add('hidden'),3000); });
socket.on('sub:skip_confirmed',({skipsLeft})=>{ subState.skipsLeft=skipsLeft; updSubStats(); });
socket.on('sub:resync',({phase,secondsLeft,highestBid})=>{ if(highestBid){subHighest=highestBid.amount;$('sub-highest').textContent=t('bestBid',{amount:highestBid.amount,name:esc(highestBid.name)});} setSubCount(secondsLeft); updBidBtns(); if(phase==='bidding'&&subEligible)$('sub-can-bid').classList.remove('hidden'); });
let subLast=false;
// ===== Piedra-papel-tijera (cuando nadie quiere la carta) =====
let rpsAmIn=false;
socket.on('sub:rps_start',({playerIds,playerNames,positionLabel})=>{
  sfx.rps();
  stopSubClock();
  rpsAmIn=playerIds.includes(myId);
  $('sub-rps-title').textContent=t('rockPaperScissors');
  $('sub-rps-sub').textContent=t('mysteryPlayerOf',{pos:positionLabel});
  $('sub-rps-reveal').innerHTML='';
  $('sub-rps-status').textContent='';
  if(rpsAmIn){
    $('sub-rps-choose').classList.remove('hidden');
    $('rps-piedra').disabled=$('rps-papel').disabled=$('rps-tijera').disabled=false;
    ['rps-piedra','rps-papel','rps-tijera'].forEach(id=>$(id).classList.remove('selected'));
    $('sub-rps-status').textContent=t('chooseYourMove');
  } else {
    $('sub-rps-choose').classList.add('hidden');
    $('sub-rps-status').textContent=t('waitingFor',{names:playerNames.join(', ')});
  }
  show('s-sub-rps');
});
function rpsChoose(c){
  $('rps-piedra').disabled=$('rps-papel').disabled=$('rps-tijera').disabled=true;
  ['rps-piedra','rps-papel','rps-tijera'].forEach(id=>$(id).classList.remove('selected'));
  $('rps-'+c).classList.add('selected');
  $('sub-rps-status').textContent=t('chosenWaitingRival');
  socket.emit('player:rps_choice',{code:roomCode,choice:c});
}
$('rps-piedra').addEventListener('click',()=>rpsChoose('piedra'));
$('rps-papel').addEventListener('click',()=>rpsChoose('papel'));
$('rps-tijera').addEventListener('click',()=>rpsChoose('tijera'));
socket.on('sub:rps_progress',({chosen,total})=>{ if(!rpsAmIn)$('sub-rps-status').textContent=t('alreadyChose',{chosen,total}); });
function rpsLabel(ch){ return {piedra:t('rpsRock'),papel:t('rpsPaper'),tijera:t('rpsScissors')}[ch]||ch; }
socket.on('sub:rps_result',({choices,loserName,decided})=>{
  const box=$('sub-rps-reveal'); box.innerHTML='';
  for(const [name,ch] of Object.entries(choices)){ const it=document.createElement('div'); it.className='clue-item'; it.innerHTML=`<span><img class="rps-choice-icon" src="/images/ui/rps-${ch}.png" alt="${esc(rpsLabel(ch))}"/>${esc(rpsLabel(ch))}</span><span class="who">${esc(name)}</span>`; box.appendChild(it); }
  if(decided){ $('sub-rps-title').textContent=t('keepsIt',{name:loserName}); $('sub-rps-sub').textContent=t('lostRps'); $('sub-rps-choose').classList.add('hidden'); $('sub-rps-status').textContent=''; }
  else { $('sub-rps-title').textContent=t('tieAgain'); $('sub-rps-sub').textContent=t('repeatsBetweenTied'); }
});

let _subAutoIv=null;
function _clearSubAutoTimer(){ if(_subAutoIv){clearInterval(_subAutoIv);_subAutoIv=null;} const el=$('sub-auto-label'); if(el)el.textContent=''; }
socket.on('sub:card_resolved',({cardId,cardName,cardLabel,cardPosition,positionLabel,cardTroll,result,winnerName,isLastCard,autoAdvanceAt})=>{
  stopSubClock(); _clearSubAutoTimer();
  subLast=isLastCard;
  const isW=result.winnerId===myId;
  if(isW){ subState.budget-=result.amount; subState.teamCount++; updSubStats(); sfx.win(); vib([50,30,80]); }
  else { sfx.reveal(); }
  loadSil($('sub-result-img'),$('sub-result-placeholder'),null,cardId,positionLabel,true);
  $('sub-result-name').textContent=cardName; $('sub-result-label').textContent=cardLabel;
  $('sub-result-troll').classList.toggle('hidden',!cardTroll);
  if(result.type==='discard'){ $('sub-result-eyebrow').textContent=t('discarded'); $('sub-result-sub').textContent=t('nobodyTookIt'); }
  else if(isW){ $('sub-result-eyebrow').textContent=t('gotItFor',{amount:result.amount}); $('sub-result-sub').textContent=''; }
  else { $('sub-result-eyebrow').textContent=result.type==='lottery'?t('lottery'):t('sold'); $('sub-result-sub').textContent=winnerName?t('wonItFor',{name:winnerName,amount:result.amount}):''; }
  $('btn-sub-next').textContent=isLastCard?t('seeFinalResult'):t('nextCard');
  $('btn-sub-next').classList.toggle('hidden',!isHost);
  $('sub-result-wait').classList.toggle('hidden',isHost);
  if(isHost && autoAdvanceAt){
    const lbl=$('sub-auto-label');
    _subAutoIv=setInterval(()=>{
      const s=Math.max(0,Math.ceil((autoAdvanceAt-Date.now())/1000));
      if(lbl) lbl.textContent=s>0?t('autoInSeconds',{s}):'';
      if(s<=0) _clearSubAutoTimer();
    },250);
  }
  show('s-sub-result');
});
$('btn-sub-next').addEventListener('click',()=>{ _clearSubAutoTimer(); socket.emit('host:next_subasta_card',{code:roomCode}); });
// ===== TORNEO (modo votación) =====
socket.on('sub:tournament_start',({teams})=>{
  stopSubClock();
  $('sub-tour-eyebrow').textContent=t('teamTournament');
  $('sub-tour-title').textContent=t('debateBegins');
  $('sub-tour-sub').textContent=t('tournamentDesc');
  const info=$('sub-tour-info'); info.innerHTML='';
  teams.slice().sort((a,b)=>b.ovr-a.ovr).forEach(tm=>{ const it=document.createElement('div'); it.className='clue-item'; it.innerHTML=`<span>${esc(tm.name)}</span><span class="who">${esc(t('ovrHidden'))}</span>`; info.appendChild(it); });
  show('s-sub-tournament');
});
socket.on('sub:tournament_bye',({name,round})=>{ $('sub-tour-title').textContent=t('advancesDirectly',{name}); $('sub-tour-sub').textContent=t('bestTeamOfRound',{round}); show('s-sub-tournament'); });
socket.on('sub:tournament_round',({round,remaining})=>{ $('sub-tour-title').textContent=t('roundN',{n:round}); $('sub-tour-sub').textContent=t('remaining',{names:remaining.join(', ')}); show('s-sub-tournament'); });
socket.on('sub:duel_start',({aName,bName,round,totalPositions})=>{
  $('sub-duel-round').textContent=t('roundN',{n:round});
  $('sub-duel-a-name').textContent=aName; $('sub-duel-b-name').textContent=bName;
  $('sub-duel-a-score').textContent='0'; $('sub-duel-b-score').textContent='0';
  $('sub-duel-progress').textContent=`Pos 0/${totalPositions}`;
  show('s-sub-duel');
});
let duelAmInvolved=false;
socket.on('sub:duel_position',({position,positionLabel,aCard,bCard,posIndex,totalPositions,voterIds})=>{
  $('sub-duel-pos').textContent=positionLabel; $('sub-duel-pos').className='position-badge '+posGroup(position);
  $('sub-duel-progress').textContent=`Pos ${posIndex}/${totalPositions}`;
  $('sub-duel-a-player').textContent=aCard?aCard.name:t('noPlayerParens');
  $('sub-duel-b-player').textContent=bCard?bCard.name:t('noPlayerParens');
  $('sub-duel-a-media').style.display='none'; $('sub-duel-b-media').style.display='none';
  $('sub-duel-a-side').classList.remove('winner'); $('sub-duel-b-side').classList.remove('winner');
  loadSil($('sub-duel-a-img'),$('sub-duel-a-ph'),null,aCard?aCard.cardId:null,positionLabel,true);
  loadSil($('sub-duel-b-img'),$('sub-duel-b-ph'),null,bCard?bCard.cardId:null,positionLabel,true);
  const canVote=voterIds.includes(myId);
  duelAmInvolved=!canVote;
  $('sub-duel-can-vote').classList.toggle('hidden',!canVote);
  $('sub-duel-status').textContent=canVote?t('whoIsBetter'):t('youPlayThisDuel');
});
$('sub-duel-vote-a').addEventListener('click',()=>castDuelVote('A'));
$('sub-duel-vote-b').addEventListener('click',()=>castDuelVote('B'));
function castDuelVote(c){ $('sub-duel-can-vote').classList.add('hidden'); $('sub-duel-status').textContent=t('voteSentDots'); socket.emit('player:vote_duel',{code:roomCode,choice:c}); }
socket.on('sub:duel_vote_progress',({votesIn,votesNeeded})=>{ if($('sub-duel-can-vote').classList.contains('hidden'))$('sub-duel-status').textContent=t('votesCount',{in:votesIn,needed:votesNeeded}); });
socket.on('sub:duel_position_result',({winner,mediaA,mediaB,scoreA,scoreB})=>{
  if(mediaA!==null){ $('sub-duel-a-media').style.display='block'; $('sub-duel-a-media').textContent=t('mediaValue',{v:mediaA}); }
  if(mediaB!==null){ $('sub-duel-b-media').style.display='block'; $('sub-duel-b-media').textContent=t('mediaValue',{v:mediaB}); }
  $('sub-duel-a-score').textContent=scoreA; $('sub-duel-b-score').textContent=scoreB;
  $('sub-duel-a-side').classList.toggle('winner',winner==='A'); $('sub-duel-b-side').classList.toggle('winner',winner==='B');
  $('sub-duel-status').textContent=winner==='A'?t('winsThisPositionLeft'):t('winsThisPositionRight');
});
socket.on('sub:duel_result',({winnerName,loserName,scoreA,scoreB})=>{
  $('sub-tour-eyebrow').textContent=t('duelResult');
  $('sub-tour-title').textContent=t('advances',{name:winnerName});
  $('sub-tour-sub').textContent=t('beatOpponent',{winner:winnerName,loser:loserName,a:scoreA,b:scoreB});
  $('sub-tour-info').innerHTML='';
  show('s-sub-tournament');
});

let subOverScores=[], subOverMode='ovr', subOverChampionName='';
function showSubPitchFor(pid, isMine){
  const s=subOverScores.find(x=>x.id===pid); if(!s)return;
  document.querySelectorAll('#sub-scoreboard .score-row').forEach(r=>r.classList.remove('selected'));
  const idx=subOverScores.indexOf(s);
  const row=document.querySelectorAll('#sub-scoreboard .score-row')[idx];
  if(row)row.classList.add('selected');
  $('sub-pitch-title').textContent = isMine ? t('yourLineup') : t('lineupOf',{name:s.name});
  if(subOverMode==='votacion'){ $('sub-my-total').textContent = subOverChampionName===s.name ? t('champion') : ''; }
  else { $('sub-my-total').textContent = t('ptsValue',{p:s.points??'?'}); }
  drawPitch($('sub-pitch'), currentFormationSlots.length?currentFormationSlots:(formationsData[currentFormation]||[]), s.cards||[]);
}

// ── Matchup animation ──────────────────────────────────────
let _muMatchups=[], _muIdx=0, _muTimer=null, _muRunning={}, _muOnDone=null;

function _muRenderTally(){
  const el=$('mu-tally'); if(!el)return;
  el.innerHTML='';
  const maxPts=Math.max(0,...Object.values(_muRunning));
  subOverScores.forEach(s=>{
    const pts=_muRunning[s.id]||0;
    const chip=document.createElement('div');
    chip.className='mu-tally-chip'+(pts===maxPts&&pts>0?' leading':'');
    chip.innerHTML=`${esc(s.name)}<span class="mu-pts">${pts}</span>`;
    el.appendChild(chip);
  });
}

function _muRenderCards(mu){
  const el=$('mu-cards'); if(!el)return;
  el.innerHTML='';
  const sorted=[...mu.players].sort((a,b)=>(b.id===myId)-(a.id===myId));
  sorted.forEach(p=>{
    const div=document.createElement('div');
    div.className='mu-card'+(p.card?(p.won?' winner':' loser'):' empty');
    if(p.won){
      const crown=document.createElement('div'); crown.className='mu-card-crown'; crown.textContent='★';
      div.appendChild(crown);
    }
    if(p.card){
      const img=document.createElement('img');
      img.loading='lazy'; img.className='mu-card-img'; img.src=`/images/reales/${p.card.cardId.toLowerCase()}.png`; img.alt=p.card.name;
      img.onerror=()=>{ const ph=document.createElement('div'); ph.className='mu-card-img'; ph.style.cssText='display:flex;align-items:center;justify-content:center;font-size:1.1rem;font-weight:700;color:var(--soft)'; ph.textContent=mu.pos; img.replaceWith(ph); };
      div.appendChild(img);
    } else {
      const ph=document.createElement('div'); ph.className='mu-card-img';
      ph.style.cssText='display:flex;align-items:center;justify-content:center;font-size:1rem;font-weight:700;color:var(--soft)';
      ph.textContent='—'; div.appendChild(ph);
    }
    const nm=document.createElement('div'); nm.className='mu-card-name'; nm.textContent=p.card?p.card.name:t('noCard'); div.appendChild(nm);
    const pl=document.createElement('div'); pl.className='mu-card-player'; pl.textContent=p.name+(p.id===myId?t('youSuffix'):''); div.appendChild(pl);
    const med=document.createElement('div'); med.className='mu-card-media'; med.textContent=p.card?p.card.media:'—'; div.appendChild(med);
    if(p.card?.troll){ const trollTag=document.createElement('div'); trollTag.style.cssText='font-size:10px;color:var(--red,#f55);font-weight:700'; trollTag.textContent='TROLL'; div.appendChild(trollTag); }
    el.appendChild(div);
  });
}

function _muStep(){
  if(_muIdx>=_muMatchups.length){ clearTimeout(_muTimer); if(_muOnDone)_muOnDone(); return; }
  const mu=_muMatchups[_muIdx];
  for(const p of mu.players) if(p.won) _muRunning[p.id]=(_muRunning[p.id]||0)+1;
  $('mu-progress').textContent=`${_muIdx+1} / ${_muMatchups.length}`;
  $('mu-pos-label').textContent=POS_LABELS[mu.pos]||mu.pos;
  $('mu-winner-label').textContent='';
  _muRenderTally();
  _muRenderCards(mu);
  const winners=mu.players.filter(p=>p.won);
  if(winners.length){
    if(winners.length===1&&winners[0].id===myId) sfx.match();
    setTimeout(()=>{
      const lbl=$('mu-winner-label');
      if(lbl) lbl.textContent=winners.length===1?t('winsThisDuel',{name:winners[0].name}):t('tie');
    }, 700);
  }
  _muIdx++;
  _muTimer=setTimeout(_muStep, 2600);
}

function startMatchupAnimation(matchups, scores, onDone){
  _muMatchups=matchups; _muIdx=0; _muOnDone=onDone;
  _muRunning={};
  scores.forEach(s=>{ _muRunning[s.id]=0; });
  show('s-sub-matchup');
  _muStep();
}
// ── fin matchup ────────────────────────────────────────────

socket.on('sub:game_over',({mode,scores,matchups,formation,formationSlots,championName})=>{
  if(scores?.[0]?.id===myId) sfx.fanfare();
  if(formation)currentFormation=formation;
  if(formationSlots)currentFormationSlots=formationSlots; else if(formation)currentFormationSlots=formationsData[formation]||[];
  subOverScores=scores; subOverMode=mode; subOverChampionName=championName||'';
  showSubPitchFor(myId, true);
  const sb=$('sub-scoreboard'); sb.innerHTML='';
  scores.forEach((s,i)=>{
    const r=document.createElement('div'); r.className='score-row sub-score-clickable'+(s.id===myId?' me':'');
    const detail=mode==='votacion'?(i===0?t('champion'):''):t('ptsValue',{p:s.points??'?'});
    const canReport = _roomIsPublic && s.id!==myId;
    const reportBtn = canReport ? `<button class="score-report-btn" data-player-id="${esc(s.id)}" title="${esc(t('scoreReportBtn'))}">🚩</button>` : '';
    r.innerHTML=`<span class="rank">${rankLabel(i)}</span><span style="flex:1;margin-left:8px;">${esc(s.name)}${s.id===myId?esc(t('youSuffix')):''}${reportBtn}</span><span class="points">${detail}</span>`;
    r.addEventListener('click', (e)=>{ if(e.target.closest('.score-report-btn')) return; showSubPitchFor(s.id, s.id===myId); });
    sb.appendChild(r);
  });
  $('btn-sub-new').classList.toggle('hidden',!isHost);
  $('btn-rematch-sub').classList.toggle('hidden',!isHost);
  $('sub-over-wait').classList.toggle('hidden',isHost);
  _subWinner = mode==='votacion' ? (championName||'') : (scores[0]?.name||'');
  if(mode==='ovr'&&matchups?.length){
    startMatchupAnimation(matchups, scores, ()=>showWinnerThen(scores,()=>show('s-sub-over')));
  } else {
    showWinnerThen(scores,()=>show('s-sub-over'));
  }
});
// Dibuja la alineación en una cancha usando coordenadas absolutas por slot.
function drawPitch(container, slots, cards){
  container.innerHTML='';
  if(!slots||!slots.length) return;
  const byPos={}; (cards||[]).forEach(c=>{ (byPos[c.position]=byPos[c.position]||[]).push(c); });
  const usedIdx={};
  for(const slot of slots){
    const pos=slot.pos;
    const idx=usedIdx[pos]=(usedIdx[pos]||0);
    const card=(byPos[pos]&&byPos[pos][idx])||null;
    usedIdx[pos]=idx+1;
    const pl=document.createElement('div');
    pl.className='pitch-player'+(card?'':' pitch-empty');
    pl.style.position='absolute';
    pl.style.left=slot.x+'%';
    pl.style.top=slot.y+'%';
    pl.style.transform='translate(-50%,-50%)';
    pl.appendChild(pitchTokenEl(card,pos));
    const nm=document.createElement('div'); nm.className='pitch-name'; nm.textContent=card?shortName(card.name):'—';
    pl.appendChild(nm);
    if(card){ const p2=document.createElement('div'); p2.className='pitch-pos'; p2.textContent=pos; pl.appendChild(p2); }
    if(card){ const vl=document.createElement('div'); vl.className='pitch-val'; vl.textContent=card.media; pl.appendChild(vl); }
    container.appendChild(pl);
  }
}
function shortName(name){
  const parts=name.split(' ');
  if(parts.length<=1)return name;
  const PREFIXES=new Set(['van','de','di','del','der','den','von','mac','ten','ter','le','la','dos','da','af','bin','el','al','du']);
  let start=parts.length-1;
  while(start>1&&PREFIXES.has(parts[start-1].toLowerCase()))start--;
  return parts.slice(start).join(' ');
}
// Token de la cancha final: foto real circular si existe (/images/reales/<id>.png),
// con fallback automático al circulo con el código de posición si la imagen no carga (404).
function pitchTokenEl(card,pos){
  if(!card) { const t=document.createElement('div'); t.className='pitch-token'; t.textContent=pos; return t; }
  const img=document.createElement('img');
  img.loading='lazy';
  img.className='pitch-token-img'+(card.troll?' troll':'');
  img.src=`/images/reales/${card.cardId.toLowerCase()}.png`;
  img.alt=card.name;
  img.onerror=function(){
    const fallback=document.createElement('div');
    fallback.className='pitch-token'+(card.troll?' troll':'');
    fallback.textContent=pos;
    img.replaceWith(fallback);
  };
  return img;
}
$('btn-sub-new').addEventListener('click',()=>socket.emit('host:new_session',{code:roomCode}));
let _subWinner='';
$('btn-share-sub').addEventListener('click',()=>doShareResult($('btn-share-sub'), _subWinner, 'gameSubastaTitle'));
$('btn-rematch-sub').addEventListener('click',()=>socket.emit('host:rematch',{code:roomCode}));

// Reconexión a subasta: pedir estado
socket.on('connect',()=>{ if(roomCode&&currentVisibleSection()==='s-sub-play')socket.emit('player:request_sub_sync',{code:roomCode}); });

/* ===================== LA FRECUENCIA (estilo Wavelength) ===================== */
// Dial semicircular dibujado a mano en SVG. Escala de valores: 0 (extremo
// izquierdo) a 100 (extremo derecho), 50 = arriba del todo.
const WAVE_CX=150, WAVE_CY=148, WAVE_R=128;
function waveXY(value,r){
  const angleDeg = 180 - (value/100)*180;
  const rad = angleDeg*Math.PI/180;
  return { x: WAVE_CX + r*Math.cos(rad), y: WAVE_CY - r*Math.sin(rad) };
}
function waveWedgePath(centerVal,halfWidth,r){
  const startV=Math.max(0,centerVal-halfWidth), endV=Math.min(100,centerVal+halfWidth);
  const p1=waveXY(startV,r), p2=waveXY(endV,r);
  return `M ${WAVE_CX},${WAVE_CY} L ${p1.x.toFixed(2)},${p1.y.toFixed(2)} A ${r},${r} 0 0,1 ${p2.x.toFixed(2)},${p2.y.toFixed(2)} Z`;
}
function waveArcTrackPath(r){
  const p1=waveXY(0,r), p2=waveXY(100,r);
  return `M ${p1.x.toFixed(2)},${p1.y.toFixed(2)} A ${r},${r} 0 0,1 ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
}
// Corta un texto largo en varias lineas (sin partir palabras) para que quepa
// junto al dial sin pisarse con la etiqueta del otro extremo.
function waveLabelLines(text,maxChars){
  const words=(text||'').split(' '); const lines=[]; let cur='';
  for(const w of words){ const test=cur?cur+' '+w:w; if(test.length>maxChars&&cur){lines.push(cur);cur=w;} else cur=test; }
  if(cur)lines.push(cur);
  return lines;
}
function waveLabelSvg(x,y,anchor,text){
  const lines=waveLabelLines(text,15);
  let out=`<text class="wave-label" x="${x.toFixed(2)}" text-anchor="${anchor}">`;
  lines.forEach((line,i)=>{ out+=`<tspan x="${x.toFixed(2)}" y="${(y+i*13).toFixed(2)}">${esc(line)}</tspan>`; });
  return out+`</text>`;
}
// Dibuja el dial dentro de containerId. opts.target (0-100 o null=oculto),
// opts.needles=[{value,color,label}] para la revelacion, opts.interactive
// habilita arrastrar mi propia aguja (sin avisar al servidor hasta bloquear).
function renderWaveDial(containerId, opts){
  const el=$(containerId); if(!el)return;
  const { leftLabel='', rightLabel='', target=null, needles=[], interactive=false, value=50 } = opts;
  let svg=`<svg viewBox="0 0 300 172">`;
  if(target!=null){
    svg+=`<path class="wave-zone-outer" d="${waveWedgePath(target,16,WAVE_R)}"/>`;
    svg+=`<path class="wave-zone-mid" d="${waveWedgePath(target,9,WAVE_R)}"/>`;
    svg+=`<path class="wave-zone-bullseye" d="${waveWedgePath(target,4,WAVE_R)}"/>`;
  }
  svg+=`<path class="wave-arc-track" d="${waveArcTrackPath(WAVE_R)}"/>`;
  const lp=waveXY(2,WAVE_R+14), rp=waveXY(98,WAVE_R+14);
  svg+=waveLabelSvg(lp.x,lp.y,'start',leftLabel);
  svg+=waveLabelSvg(rp.x,rp.y,'end',rightLabel);
  needles.forEach(n=>{
    const tip=waveXY(n.value,WAVE_R-14), namePos=waveXY(n.value,WAVE_R-34);
    svg+=`<line class="wave-needle-line" x1="${WAVE_CX}" y1="${WAVE_CY}" x2="${tip.x.toFixed(2)}" y2="${tip.y.toFixed(2)}" style="stroke:${n.color}"/>`;
    svg+=`<circle class="wave-needle-dot" cx="${tip.x.toFixed(2)}" cy="${tip.y.toFixed(2)}" r="7" style="fill:${n.color}"/>`;
    svg+=`<text class="wave-needle-name" x="${namePos.x.toFixed(2)}" y="${namePos.y.toFixed(2)}" style="fill:${n.color}">${esc(n.label||'')}</text>`;
  });
  if(interactive){
    const tip=waveXY(value,WAVE_R-14);
    svg+=`<line id="wave-my-needle-line" class="wave-needle-line" x1="${WAVE_CX}" y1="${WAVE_CY}" x2="${tip.x.toFixed(2)}" y2="${tip.y.toFixed(2)}" style="stroke:var(--neon)"/>`;
    svg+=`<circle id="wave-my-needle-dot" class="wave-needle-dot" cx="${tip.x.toFixed(2)}" cy="${tip.y.toFixed(2)}" r="9" style="fill:var(--neon)"/>`;
  }
  svg+=`<circle class="wave-pivot" cx="${WAVE_CX}" cy="${WAVE_CY}" r="4"/>`;
  svg+=`</svg>`;
  el.innerHTML=svg;
  el.classList.toggle('interactive',!!interactive);
  if(!interactive)return;
  const svgEl=el.querySelector('svg');
  let dragging=false;
  function valueFromEvent(evt){
    const rect=svgEl.getBoundingClientRect();
    const scaleX=300/rect.width, scaleY=172/rect.height;
    const px=(evt.clientX-rect.left)*scaleX, py=(evt.clientY-rect.top)*scaleY;
    const dx=px-WAVE_CX, dy=WAVE_CY-py;
    let angleDeg=Math.atan2(dy,dx)*180/Math.PI; // -180..180 (matematico, arriba=positivo)
    if(angleDeg<0) angleDeg = (angleDeg<-90) ? 180 : 0; // debajo de la base: pegar al extremo mas cercano
    angleDeg=Math.min(180,Math.max(0,angleDeg));
    return 100 - (angleDeg/180)*100;
  }
  function updateNeedle(v){
    const tip=waveXY(v,WAVE_R-14);
    const line=$('wave-my-needle-line'), dot=$('wave-my-needle-dot');
    if(line){line.setAttribute('x2',tip.x.toFixed(2));line.setAttribute('y2',tip.y.toFixed(2));}
    if(dot){dot.setAttribute('cx',tip.x.toFixed(2));dot.setAttribute('cy',tip.y.toFixed(2));}
  }
  function onMove(evt){
    if(!dragging)return;
    const v=valueFromEvent(evt);
    updateNeedle(v);
    if(opts.onChange)opts.onChange(v);
  }
  svgEl.addEventListener('pointerdown', e=>{ dragging=true; svgEl.setPointerCapture(e.pointerId); onMove(e); });
  svgEl.addEventListener('pointermove', onMove);
  svgEl.addEventListener('pointerup', ()=>{ dragging=false; });
  svgEl.addEventListener('pointercancel', ()=>{ dragging=false; });
}

let waveRoundInfo={n:1,c:5}, waveIsPsychic=false, waveMyValue=50, waveLocked=false;
let waveLeft='', waveRight='', wavePeekTarget=null, wavePeeking=false, waveLastRound=false;

socket.on('wave:round', ({roundNumber,roundCount,left,right,psychicId,psychicName})=>{
  waveRoundInfo={n:roundNumber,c:roundCount}; waveLeft=pickLang(left); waveRight=pickLang(right);
  waveIsPsychic = psychicId===myId; wavePeekTarget=null; wavePeeking=false;
  $('wave-round').textContent=roundNumber; $('wave-round-count').textContent=roundCount;
  $('wave-round-2').textContent=roundNumber; $('wave-round-count-2').textContent=roundCount;
  renderWaveDial('wave-dial-psychic', {leftLabel:waveLeft, rightLabel:waveRight});
  $('wave-psychic-controls').classList.toggle('hidden', !waveIsPsychic);
  $('wave-psychic-wait').classList.toggle('hidden', waveIsPsychic);
  $('btn-wave-peek').textContent=t('seeZone');
  if(!waveIsPsychic){
    $('wave-psychic-name').textContent = psychicName || '—';
    const av=$('wave-psychic-avatar'); const c=avatarFor(psychicId||'?');
    av.style.background=c.bg; av.style.color=c.fg;
    av.textContent=(psychicName||'?').trim().charAt(0).toUpperCase()||'?';
  }
  // Resetear pista del psíquico al inicio de cada ronda
  $('wave-clue-display').classList.add('hidden');
  $('wave-clue-text').textContent='—';
  $('inp-wave-clue').value='';
  $('btn-wave-clue').textContent=t('send'); $('btn-wave-clue').disabled=false;
  show('s-wave-psychic');
});
$('btn-wave-clue').addEventListener('click', ()=>{
  const txt=$('inp-wave-clue').value.trim(); if(!txt)return;
  socket.emit('player:wave_clue',{code:roomCode,text:txt});
  $('btn-wave-clue').textContent=t('sentCheck'); $('btn-wave-clue').disabled=true;
});
$('inp-wave-clue').addEventListener('keydown',e=>{ if(e.key==='Enter')$('btn-wave-clue').click(); });
socket.on('wave:clue_shared',({clue,psychicName})=>{
  sfx.announce();
  $('wave-clue-text').textContent=clue;
  $('wave-clue-display').classList.remove('hidden');
});
$('btn-wave-peek').addEventListener('click', ()=>{
  if(wavePeekTarget==null){ socket.emit('player:wave_peek',{code:roomCode}); return; }
  wavePeeking=!wavePeeking;
  $('btn-wave-peek').textContent = wavePeeking ? t('hideZone') : t('seeZone');
  renderWaveDial('wave-dial-psychic', {leftLabel:waveLeft, rightLabel:waveRight, target: wavePeeking?wavePeekTarget:null});
});
socket.on('wave:target', ({target})=>{
  wavePeekTarget=target; wavePeeking=true;
  $('btn-wave-peek').textContent=t('hideZone');
  renderWaveDial('wave-dial-psychic', {leftLabel:waveLeft, rightLabel:waveRight, target});
});
$('btn-wave-ready').addEventListener('click', ()=>socket.emit('player:wave_ready',{code:roomCode}));

socket.on('wave:guessing_start', ({secondsLeft,left,right})=>{
  waveLocked=false; waveMyValue=50; waveLeft=pickLang(left); waveRight=pickLang(right);
  renderWaveDial('wave-dial-guess', {leftLabel:waveLeft, rightLabel:waveRight, interactive:!waveIsPsychic, value:50, onChange:v=>{waveMyValue=v;}});
  $('wave-guess-controls').classList.toggle('hidden', waveIsPsychic);
  $('wave-guess-wait').classList.toggle('hidden', !waveIsPsychic);
  $('wave-lock-status').textContent = waveIsPsychic ? t('waitingGuesses') : t('moveYourNeedle');
  setWaveCount(secondsLeft);
  show('s-wave-guess');
});
let _waveWasUrgent=false;
function setWaveCount(s){ const el=$('wave-countdown'); if(!el)return; el.textContent=s; const urgent=s<=8&&s>0; el.classList.toggle('urgent',urgent); if(urgent&&!_waveWasUrgent){sfx.urgent();vib(30);} _waveWasUrgent=urgent; }
socket.on('wave:tick', ({secondsLeft})=>setWaveCount(secondsLeft));
$('btn-wave-lock').addEventListener('click', ()=>{
  if(waveLocked||waveIsPsychic)return; waveLocked=true;
  $('wave-guess-controls').classList.add('hidden');
  $('wave-guess-wait').classList.remove('hidden');
  $('wave-lock-status').textContent=t('answerLockedWaiting');
  socket.emit('player:wave_lock',{code:roomCode, value:waveMyValue});
});
socket.on('wave:lock_progress', ({lockedIn,needed})=>{
  if(waveLocked||waveIsPsychic) $('wave-lock-status').textContent = t('alreadyLocked',{in:lockedIn,needed});
});

socket.on('wave:reveal', ({target,left,right,psychicName,psychicScore,guesses,roundNumber,roundCount,isLastRound,scores})=>{
  sfx.reveal();
  const myScore = waveIsPsychic ? psychicScore : (guesses.find(g=>g.id===myId)?.score??0);
  if(myScore >= 2) sfx.win();
  const needles = guesses.map(g=>({ value:g.value, color:avatarFor(g.id).bg, label:g.name }));
  renderWaveDial('wave-dial-reveal', {leftLabel:pickLang(left), rightLabel:pickLang(right), target, needles});
  $('wave-reveal-eyebrow').textContent = t('roundOf',{n:roundNumber,c:roundCount});
  const list=$('wave-reveal-list'); list.innerHTML='';
  const psyRow=document.createElement('div'); psyRow.className='clue-item';
  psyRow.innerHTML=`<span>${esc(t('psychicSuffix',{name:psychicName}))}</span><span class="who">${esc(t('ptsPlus',{p:psychicScore}))}</span>`;
  list.appendChild(psyRow);
  guesses.forEach(g=>{ const it=document.createElement('div'); it.className='clue-item'; it.innerHTML=`<span>${esc(g.name)}</span><span class="who">${esc(t('ptsPlus',{p:g.score}))}</span>`; list.appendChild(it); });
  renderScores('wave-scoreboard', scores, isLastRound);
  waveLastRound=isLastRound;
  $('btn-wave-next').textContent = isLastRound ? t('backToStart') : t('nextRound');
  $('btn-wave-next').classList.toggle('hidden', !isHost);
  $('wave-over-wait').classList.toggle('hidden', isHost);
  $('btn-share-wave').classList.toggle('hidden', !isLastRound);
  $('btn-rematch-wave').classList.toggle('hidden', !isHost||!isLastRound);
  _waveWinner = scores[0]?.name||'';
  if(isLastRound){ show('s-wave-reveal'); showWinnerThen(scores,()=>show('s-wave-reveal'),2.5); }
  else show('s-wave-reveal');
});
let _waveWinner='';
$('btn-wave-next').addEventListener('click', ()=>{ if(waveLastRound) socket.emit('host:new_session',{code:roomCode}); else socket.emit('host:wave_next_round',{code:roomCode}); });
$('btn-share-wave').addEventListener('click',()=>doShareResult($('btn-share-wave'), _waveWinner, 'gameWavelengthTitle'));
$('btn-rematch-wave').addEventListener('click',()=>socket.emit('host:rematch',{code:roomCode}));

/* ===================== ¿QUIÉN SOY? ===================== */
const WHO_CAT_KEYS={futbolista:'catFutbolista',dt:'catDt',equipo:'catEquipo','selección':'catSeleccion'};
const WHO_CAT_LABELS=new Proxy({},{get:(_,cat)=>t(WHO_CAT_KEYS[cat])||cat});
let whoTurnToken=0, whoIsMyTurn=false, _whoRevealUntil=0;

function renderWhoGrid(cards, activeId){
  const grid=$('who-grid'); grid.innerHTML='';
  cards.forEach(c=>{
    const mine=c.id===myId;
    const div=document.createElement('div');
    div.className='who-card'+(c.id===activeId?' active':'')+(mine?' mine':'')+(!c.hidden&&mine?' revealed':'')+(c.failed?' failed':'');
    if(c.hidden){
      div.innerHTML=`<div class="who-owner">${esc(c.name)}${mine?esc(t('youSuffix')):''}</div><div class="who-hidden-glyph">?</div>`;
    } else {
      div.innerHTML=`<div class="who-owner">${esc(c.name)}${mine?esc(t('youSuffix')):''}</div><div class="who-identity">${esc(c.identity)}</div><div class="who-category">${esc(WHO_CAT_LABELS[c.category]||c.category)}</div>`;
    }
    grid.appendChild(div);
  });
}
socket.on('who:state', ({cards,activePlayerId,activePlayerName,isMyTurn,isNextTurn,turnToken})=>{
  acquireWakeLock();
  whoTurnToken=turnToken; whoIsMyTurn=isMyTurn;
  renderWhoGrid(cards, activePlayerId);
  $('who-my-turn').classList.toggle('hidden', !isMyTurn);
  $('who-others-turn').classList.toggle('hidden', isMyTurn);
  if(isMyTurn){
    $('inp-who-guess').value=''; $('inp-who-question').value='';
    sfx.turn(); vib(80);
  } else {
    $('who-turn-name').textContent=activePlayerName||'—';
    const av=$('who-turn-avatar'); const c=avatarFor(activePlayerId||'?');
    av.style.background=c.bg; av.style.color=c.fg;
    av.textContent=(activePlayerName||'?').trim().charAt(0).toUpperCase()||'?';
    // Solo el siguiente en turno ve los botones de respuesta
    $('who-answer-mine').classList.toggle('hidden', !isNextTurn);
    $('who-answer-wait').classList.toggle('hidden', isNextTurn);
    if(isNextTurn){
      // Limpiar selección anterior
      ['btn-who-si','btn-who-no','btn-who-talvez'].forEach(id=>$(id).classList.remove('selected'));
      ['btn-who-si','btn-who-no','btn-who-talvez'].forEach(id=>$(id).disabled=false);
    }
  }
  if(_whoRevealUntil && Date.now()<_whoRevealUntil) return; // mostrando identidad al jugador eliminado
  show('s-who-board');
});
socket.on('who:question', ({playerName, text})=>{
  const log=$('who-log'); const it=document.createElement('div'); it.className='clue-item';
  it.innerHTML=`<span>❓ ${esc(text)}</span><span class="who">${esc(playerName)}</span>`;
  log.prepend(it);
});
socket.on('who:answer', ({answererName,answer,activePlayerName})=>{
  sfx.tick();
  const label={si:t('yes')+' ✓',no:t('no')+' ✗',talvez:t('maybe')+' ~'}[answer]||answer;
  const log=$('who-log'); const it=document.createElement('div'); it.className='clue-item';
  it.innerHTML=`<span>${esc(label)}</span><span class="who">${esc(answererName)}</span>`;
  log.prepend(it);
  // Deshabilitar botones tras responder
  ['btn-who-si','btn-who-no','btn-who-talvez'].forEach(id=>$(id).disabled=true);
});
function whoSendAnswer(answer, btnId){
  $(btnId).classList.add('selected');
  ['btn-who-si','btn-who-no','btn-who-talvez'].forEach(id=>{ if(id!==btnId) $(id).disabled=true; });
  socket.emit('player:who_answer',{code:roomCode,answer,turnToken:whoTurnToken});
}
$('btn-who-si').addEventListener('click',()=>whoSendAnswer('si','btn-who-si'));
$('btn-who-no').addEventListener('click',()=>whoSendAnswer('no','btn-who-no'));
$('btn-who-talvez').addEventListener('click',()=>whoSendAnswer('talvez','btn-who-talvez'));
$('btn-who-question').addEventListener('click',()=>{
  const txt=$('inp-who-question').value.trim(); if(!txt)return;
  socket.emit('player:who_question',{code:roomCode,text:txt});
  $('inp-who-question').value='';
});
$('inp-who-question').addEventListener('keydown',e=>{ if(e.key==='Enter')$('btn-who-question').click(); });
$('btn-who-guess').addEventListener('click',()=>{
  const txt=$('inp-who-guess').value.trim(); if(!txt)return;
  socket.emit('player:who_guess',{code:roomCode,text:txt});
});
$('inp-who-guess').addEventListener('keydown',e=>{ if(e.key==='Enter')$('btn-who-guess').click(); });

socket.on('who:guess_submitted', ({playerId,playerName,text,guesserIsHost})=>{
  $('who-guess-heading').textContent=t('saysTheyAre',{name:playerName});
  $('who-guess-text').textContent=text;
  const amGuesser=playerId===myId;
  // Puede validar: el host (si no es el que adivina), o cualquier no-adivinador si el host adivinó (1v1)
  const canValidate = !amGuesser && (isHost || guesserIsHost);
  $('who-host-validate').classList.toggle('hidden', !canValidate);
  $('who-validate-wait').classList.toggle('hidden', canValidate);
  $('who-validate-wait').textContent = amGuesser ? t('waitingConfirmation') : t('waitingHost');
  show('s-who-guess-pending');
});
$('btn-who-correct').addEventListener('click',()=>socket.emit('host:who_validate',{code:roomCode,correct:true}));
$('btn-who-incorrect').addEventListener('click',()=>socket.emit('host:who_validate',{code:roomCode,correct:false}));
socket.on('who:guess_result', ({playerId,playerName,correct,identity,points,eliminated})=>{
  if(correct){ sfx.correct(); vib([50,30,80]); } else { sfx.wrong(); vib(120); }
  const log=$('who-log'); const it=document.createElement('div'); it.className='clue-item';
  if(correct) it.innerHTML=`<span>${esc(t('guessedIt',{name:playerName,identity}))}</span><span class="who">${esc(t('ptsPlus',{p:points}))}</span>`;
  else if(eliminated) it.innerHTML=`<span>${esc(t('wasEliminated',{name:playerName}))}</span><span class="who">✗</span>`;
  else it.innerHTML=`<span>${esc(t('triedToGuess',{name:playerName}))}</span><span class="who">✗</span>`;
  log.prepend(it);
  // Si YO fui eliminado, mostrar mi identidad durante 3.5 s antes de volver al tablero
  if(eliminated && playerId===myId){
    $('who-guess-heading').textContent=t('youFailed');
    $('who-guess-text').textContent=t('youWere',{identity:identity||'?'});
    $('who-host-validate').classList.add('hidden');
    $('who-validate-wait').classList.add('hidden');
    show('s-who-guess-pending');
    _whoRevealUntil=Date.now()+3500;
    setTimeout(()=>{ _whoRevealUntil=0; show('s-who-board'); },3500);
  }
});
socket.on('who:round_over', ({roundNumber,roundCount,scores,assigns})=>{
  _storeScores(scores);
  renderScores('who-round-scoreboard', scores);
  $('who-round-label').textContent=t('roundOfN',{n:roundNumber,c:roundCount});
  $('btn-who-next-round').classList.toggle('hidden', !isHost);
  $('who-round-wait').classList.toggle('hidden', isHost);
  const grid=$('who-reveal-grid'); grid.innerHTML='';
  (assigns||[]).forEach(a=>{
    const d=document.createElement('div'); d.className='who-card revealed';
    d.innerHTML=`<span class="who-identity">${esc(a.identity)}</span><span class="who-cat">${esc(a.category)}</span><span class="who-player-name">${esc(a.name)}</span>`;
    grid.appendChild(d);
  });
  show('s-who-reveal');
  setTimeout(()=>show('s-who-round-over'), 4000);
});
$('btn-who-next-round').addEventListener('click',()=>socket.emit('host:who_next_round',{code:roomCode}));

socket.on('who:game_over', ({scores,assigns})=>{
  renderScores('who-scoreboard', scores, true);
  $('btn-who-new').classList.toggle('hidden', !isHost);
  $('btn-rematch-who').classList.toggle('hidden', !isHost);
  $('who-over-wait').classList.toggle('hidden', isHost);
  // Mostrar tablero de identidades reveladas 4 s, luego overlay ganador, luego marcador
  const grid=$('who-reveal-grid'); grid.innerHTML='';
  (assigns||[]).forEach(a=>{
    const div=document.createElement('div');
    div.className='who-card'+(a.id===myId?' mine':'');
    div.innerHTML=`<div class="who-owner">${esc(a.name)}${a.id===myId?esc(t('youSuffix')):''}</div><div class="who-identity">${esc(a.identity)}</div><div class="who-category">${esc(WHO_CAT_LABELS[a.category]||a.category)}</div>`;
    grid.appendChild(div);
  });
  show('s-who-reveal');
  _whoWinner = scores[0]?.name||'';
  setTimeout(()=>showWinnerThen(scores,()=>show('s-who-over')), 4000);
});
let _whoWinner='';
$('btn-who-new').addEventListener('click',()=>socket.emit('host:new_session',{code:roomCode}));
$('btn-share-who').addEventListener('click',()=>doShareResult($('btn-share-who'), _whoWinner, 'gameWhoTitle'));
$('btn-rematch-who').addEventListener('click',()=>socket.emit('host:rematch',{code:roomCode}));

/* ===== Winner overlay ===== */
function showWinnerThen(scores, cb, delaySec) {
  if (!scores || !scores.length) { cb(); return; }
  const overlay = $('winner-overlay');
  if (!overlay) { cb(); return; } // fallback si el browser tiene HTML en caché sin el overlay
  const doShow = () => {
    const w = scores[0];
    $('winner-name').textContent = w.name;
    $('winner-score-label').textContent = w.score != null ? w.score + ' pts' : '';
    const container = $('winner-confetti-container');
    container.innerHTML = '';
    const COLORS = ['#e9b949','#b6ff2e','#ff4d4d','#2563eb','#ffffff','#ff6b35','#c084fc'];
    for (let i = 0; i < 80; i++) {
      const el = document.createElement('div');
      const isBall = i < 12;
      el.className = 'confetti-piece';
      const delay = (Math.random() * 2.2).toFixed(2);
      const dur   = (2.8 + Math.random() * 2.2).toFixed(2);
      const left  = (Math.random() * 100).toFixed(1);
      if (isBall) {
        el.style.cssText = `left:${left}%;font-size:${1.2+Math.random()*0.9}rem;animation-delay:${delay}s;animation-duration:${dur}s;`;
        el.textContent = '⚽';
      } else {
        const size  = (5 + Math.random() * 9).toFixed(0);
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        const br    = Math.random() < 0.5 ? '50%' : '2px';
        el.style.cssText = `left:${left}%;width:${size}px;height:${size}px;background:${color};border-radius:${br};animation-delay:${delay}s;animation-duration:${dur}s;`;
      }
      container.appendChild(el);
    }
    overlay.classList.remove('hidden');
    setTimeout(() => { overlay.classList.add('hidden'); container.innerHTML=''; cb(); }, 5000);
  };
  if (delaySec) setTimeout(doShow, delaySec * 1000);
  else doShow();
}

/* ===== Force-end button (host only) ===== */
function _refreshForceBtn(){ const show=isHost&&_currentSection&&SCORE_SECTIONS.has(_currentSection); $('btn-force-end').classList.toggle('hidden',!show); }
$('btn-force-end').addEventListener('click',()=>{ if(confirm(t('endMatchConfirm'))) socket.emit('host:force_end',{code:roomCode}); });
socket.on('game:force_over',({scores})=>{
  renderScores('force-over-scoreboard', scores, true);
  $('btn-force-over-new').classList.toggle('hidden',!isHost);
  $('force-over-wait').classList.toggle('hidden',isHost);
  showWinnerThen(scores,()=>show('s-force-over'));
});
$('btn-force-over-new').addEventListener('click',()=>socket.emit('host:new_session',{code:roomCode}));

/* ===== Score overlay flotante ===== */
// Secciones en las que tiene sentido ver puntajes mid-game (excluyendo pantallas finales donde ya son visibles)
const SCORE_SECTIONS = new Set(['s-imp-clue','s-imp-vote','s-imp-reveal','s-lie-claim','s-lie-naming','s-lie-final','s-wave-psychic','s-wave-guess','s-wave-reveal','s-who-board','s-who-guess-pending']);
let _lastScores = null, _currentSection = null;
function _refreshScoreBtn(){ const ok=_lastScores&&_currentSection&&SCORE_SECTIONS.has(_currentSection); $('btn-scores-float').classList.toggle('hidden',!ok); }
function _storeScores(scores){ if(scores&&scores.length){ _lastScores=scores; _refreshScoreBtn(); } }
// Interceptar show() para rastrear sección actual
const _origShow = show;
show = function(id){ _origShow(id); _currentSection=id; _refreshScoreBtn(); _refreshForceBtn(); };

function openScoreOverlay(){
  if(!_lastScores) return;
  const body=$('scores-overlay-body'); body.innerHTML='';
  _lastScores.forEach((p,i)=>{ const r=document.createElement('div'); r.className='score-row'; r.innerHTML=`<span class="rank">${rankLabel(i)}</span><span style="flex:1;margin-left:8px;">${esc(p.name)}</span><span class="points">${p.score} pts</span>`; body.appendChild(r); });
  $('scores-overlay').classList.remove('hidden');
}
$('btn-scores-float').addEventListener('click', openScoreOverlay);
$('btn-scores-close').addEventListener('click', ()=>$('scores-overlay').classList.add('hidden'));
$('scores-overlay').addEventListener('click', e=>{ if(e.target===$('scores-overlay')) $('scores-overlay').classList.add('hidden'); });

// Capturar puntajes de todos los juegos que los emiten
socket.on('imp:manga_over',({scores})=>_storeScores(scores));
socket.on('lie:resolved',({scores})=>_storeScores(scores));
socket.on('wave:reveal',({scores})=>_storeScores(scores));
// Limpiar al volver al lobby — el servidor responde a host:new_session con room:update (status='lobby')
socket.on('room:update',({status})=>{ if(status==='lobby'){ _lastScores=null; _currentSection=null; _refreshScoreBtn(); _refreshForceBtn(); } });
