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

socket.on('connect', () => {
  connBanner.classList.add('hidden');
  // Reconexión: si ya teníamos sala (recién ahora, o recuperada de localStorage), reintegrarse
  if (roomCode && myStoredId) {
    socket.emit('player:rejoin', { code: roomCode, playerId: myStoredId }, (res) => {
      if (res && res.ok) {
        myId = res.playerId; myStoredId = res.playerId; isHost = res.isHost;
        if(res.categories) ALL_CATEGORIES=res.categories;
        if(res.formations) ALL_FORMATIONS=res.formations;
        applyRoomCode(res.code);
        saveSession();
      } else {
        // La sala ya no existe o el jugador no está: volver a home y avisar,
        // en vez de dejar a la persona congelada en una pantalla muerta.
        clearSession(); roomCode=null; myStoredId=null;
        show('s-home');
        showHomeError(t('roomGoneMsg'));
      }
    });
  }
});
socket.on('disconnect', () => { connBanner.textContent=t('reconnecting'); connBanner.className='conn-banner error'; });
socket.io.on('reconnect', () => { connBanner.classList.add('hidden'); });

/* ===== Helpers ===== */
const $ = id => document.getElementById(id);
function esc(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
// Paleta de avatares para jugadores humanos (sin foto): color de fondo + color de letra legible.
const AVATAR_PALETTE=[{bg:'#b6ff2e',fg:'#0a1400'},{bg:'#e9b949',fg:'#1a1200'},{bg:'#8b54e0',fg:'#ffffff'},{bg:'#ff4d4d',fg:'#ffffff'},{bg:'#4e8ecb',fg:'#ffffff'}];
function avatarFor(id){
  let h=0; for(let i=0;i<(id||'').length;i++) h=(h*31+id.charCodeAt(i))>>>0;
  const c=AVATAR_PALETTE[h%AVATAR_PALETTE.length];
  return c;
}
function avatarHTML(id,name){
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
  socket.emit('player:create_room', { name, authToken:getAuthToken() }, onJoined);
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
  if(!res.ok){ showHomeError(res.error); return; }
  myId=res.playerId; myStoredId=res.playerId; isHost=res.isHost;
  ALL_CATEGORIES=res.categories||[]; ALL_FORMATIONS=res.formations||[];
  applyRoomCode(res.code);
  saveSession();
  show('s-lobby');
}

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
function renderAuthUI(){
  const box=$('auth-box');
  if(authUser){
    $('auth-logged-out').classList.add('hidden');
    $('auth-logged-in').classList.remove('hidden');
    box.classList.remove('hidden');
    $('auth-avatar').src = authUser.avatar || '/images/ui/logo.png';
    $('auth-name').textContent = authUser.name;
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
    if(payload && payload.exp*1000>Date.now()){ authUser={id:payload.uid,name:payload.name,avatar:payload.avatar,provider:payload.provider}; }
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
})();
$('btn-login-google').addEventListener('click', ()=>{ location.href='/auth/google/start'; });
$('btn-login-discord').addEventListener('click', ()=>{ location.href='/auth/discord/start'; });
$('btn-auth-logout').addEventListener('click', ()=>{ setAuthToken(null); authUser=null; renderAuthUI(); });
$('btn-my-stats').addEventListener('click', async ()=>{
  const tok=getAuthToken();
  $('stats-body').innerHTML = `<p style="color:var(--text-dim)">${esc(t('loading'))}</p>`;
  $('stats-overlay').classList.remove('hidden');
  try{
    const res = await fetch('/auth/me', { headers:{ Authorization:'Bearer '+tok } });
    const json = await res.json();
    if(!json.ok){ $('stats-body').innerHTML=`<p>${esc(t('statsError'))}</p>`; return; }
    if(!json.stats.length){ $('stats-body').innerHTML=`<p style="color:var(--text-dim)">${esc(t('statsEmpty'))}</p>`; return; }
    $('stats-body').innerHTML = json.stats.map(s=>`
      <div class="config-row" style="justify-content:space-between;">
        <span>${esc(t(GAME_TITLE_KEYS[s.gameType]||s.gameType))}</span>
        <span style="color:var(--neon);font-weight:700;">${s.gamesWon}/${s.gamesPlayed} ${esc(t('statsWon'))}</span>
      </div>`).join('');
  }catch(e){ $('stats-body').innerHTML=`<p>${esc(t('statsError'))}</p>`; }
});
$('btn-stats-close').addEventListener('click',()=>$('stats-overlay').classList.add('hidden'));
$('stats-overlay').addEventListener('click', e=>{ if(e.target===$('stats-overlay'))$('stats-overlay').classList.add('hidden'); });

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

socket.on('room:update', (st) => {
  players = st.players;
  isHost = (st.hostId === myId);
  currentGame = st.gameType;
  if(st.status==='lobby') _lobbyGameType = st.gameType||null;
  maxImpostors = st.maxImpostors; minPlayers = st.minPlayers;
  if(st.formations) formationsData = st.formations;
  _checkDisconnectToasts(st);

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
    c.innerHTML=`<div class="player-chip-top">${avatarHTML(p.id,p.name)}<div class="name">${esc(p.name)}</div>${kickHtml}</div><div class="meta">${p.isHost?t('host'):(p.connected?t('connected'):'...')}</div>`;
    grid.appendChild(c);
  });
  grid.querySelectorAll('.kick-btn').forEach(btn=>{
    btn.addEventListener('click',()=>socket.emit('host:kick_player',{code:roomCode,targetId:btn.dataset.id}));
  });
  $('player-count').textContent=st.players.length;

  $('host-controls').classList.toggle('hidden',!isHost);
  $('guest-wait').classList.toggle('hidden',isHost);

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
  players.forEach(p=>{ const c=document.createElement('div'); c.className='player-chip'+(p.id===impTurn?' turn':'')+(p.id===myId?' me':''); c.innerHTML=`<div class="player-chip-top">${avatarHTML(p.id,p.name)}<div class="name">${esc(p.name)}</div></div>`; grid.appendChild(c); });
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
  renderScores('imp-scoreboard',scores);
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
function renderScores(elId,scores){ const b=$(elId); b.innerHTML=''; scores.forEach((p,i)=>{ const r=document.createElement('div'); r.className='score-row'; r.innerHTML=`<span class="rank">${rankLabel(i)}</span><span style="flex:1;margin-left:8px;">${esc(p.name)}</span><span class="points">${p.score} pts</span>`; b.appendChild(r); }); }

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
socket.on('lie:round',({roundNumber,roundCount,category,mode,currentTurnPlayerId})=>{ $('lie-round').textContent=roundNumber; $('lie-round-count').textContent=roundCount; $('lie-category').textContent=category; $('lie-claim-amount').textContent='0'; lieClaim=0; lieMode=mode; lieTurn=currentTurnPlayerId; acquireWakeLock(); renderLieClaim(); show('s-lie-claim'); });
socket.on('lie:turn',({currentTurnPlayerId})=>{ lieTurn=currentTurnPlayerId; if(currentVisibleSection()==='s-lie-claim')renderLieClaim(); });
socket.on('lie:claim',({amount})=>{ lieClaim=amount; const el=$('lie-claim-amount'); el.textContent=amount; bump(el); });
function renderLieClaim(){ const mine=lieTurn===myId; $('lie-my-turn').classList.toggle('hidden',!mine); $('lie-wait-turn').classList.toggle('hidden',mine); if(mine){$('inp-claim').value='';$('claim-error').classList.add('hidden');$('btn-accuse').disabled=lieClaim<=0; sfx.turn(); vib(80);}else{const pl=players.find(p=>p.id===lieTurn);$('lie-turn-name').textContent=pl?pl.name:'—';const av=$('lie-turn-avatar');const c=avatarFor(lieTurn||'?');av.style.background=c.bg;av.style.color=c.fg;av.textContent=(pl?pl.name:'?').trim().charAt(0).toUpperCase()||'?';} }
$('btn-claim').addEventListener('click',()=>{ const v=Number($('inp-claim').value); if(!Number.isInteger(v)||v<=lieClaim){$('claim-error').textContent=t('mustBeGreaterThan',{n:lieClaim});$('claim-error').classList.remove('hidden');return;} socket.emit('player:make_claim',{code:roomCode,amount:v}); });
$('btn-accuse').addEventListener('click',()=>socket.emit('player:accuse_liar',{code:roomCode}));
socket.on('lie:claim_rejected',({reason})=>{ $('claim-error').textContent=reason; $('claim-error').classList.remove('hidden'); });
socket.on('lie:accused',({accuserId,accuserName,accusedId,accusedName,target,category,mode,deadlineAt,paused,remainingMs})=>{
  amAccused=accusedId===myId; amAccuser=accuserId===myId; lieMode=mode;
  if(amAccused) sfx.turn();
  $('lie-target').textContent=target; $('lie-named-count').textContent='0'; $('lie-named-log').innerHTML='';
  $('lie-naming-heading').textContent=amAccused?t('didntBelieveYou',{accuser:accuserName,target,cat:category}):t('accusedOf',{accuser:accuserName,accused:accusedName,cat:category});
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
  renderScores('lie-scoreboard', scores);
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
    r.innerHTML=`<span class="rank">${rankLabel(i)}</span><span style="flex:1;margin-left:8px;">${esc(s.name)}${s.id===myId?esc(t('youSuffix')):''}</span><span class="points">${detail}</span>`;
    r.addEventListener('click', ()=>showSubPitchFor(s.id, s.id===myId));
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
  waveRoundInfo={n:roundNumber,c:roundCount}; waveLeft=left; waveRight=right;
  waveIsPsychic = psychicId===myId; wavePeekTarget=null; wavePeeking=false;
  $('wave-round').textContent=roundNumber; $('wave-round-count').textContent=roundCount;
  $('wave-round-2').textContent=roundNumber; $('wave-round-count-2').textContent=roundCount;
  renderWaveDial('wave-dial-psychic', {leftLabel:left, rightLabel:right});
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
  waveLocked=false; waveMyValue=50; waveLeft=left; waveRight=right;
  renderWaveDial('wave-dial-guess', {leftLabel:left, rightLabel:right, interactive:!waveIsPsychic, value:50, onChange:v=>{waveMyValue=v;}});
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
  renderWaveDial('wave-dial-reveal', {leftLabel:left, rightLabel:right, target, needles});
  $('wave-reveal-eyebrow').textContent = t('roundOf',{n:roundNumber,c:roundCount});
  const list=$('wave-reveal-list'); list.innerHTML='';
  const psyRow=document.createElement('div'); psyRow.className='clue-item';
  psyRow.innerHTML=`<span>${esc(t('psychicSuffix',{name:psychicName}))}</span><span class="who">${esc(t('ptsPlus',{p:psychicScore}))}</span>`;
  list.appendChild(psyRow);
  guesses.forEach(g=>{ const it=document.createElement('div'); it.className='clue-item'; it.innerHTML=`<span>${esc(g.name)}</span><span class="who">${esc(t('ptsPlus',{p:g.score}))}</span>`; list.appendChild(it); });
  renderScores('wave-scoreboard', scores);
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
  renderScores('who-scoreboard', scores);
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
  renderScores('force-over-scoreboard', scores);
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
