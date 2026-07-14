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
let _ac = null;
function ac(){ if(!_ac) _ac = new (window.AudioContext||window.webkitAudioContext)(); return _ac; }
function beep(freq,dur,vol=0.25,type='sine'){
  try{
    const ctx=ac(), o=ctx.createOscillator(), g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(vol,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+dur);
    o.start(); o.stop(ctx.currentTime+dur);
  }catch(e){}
}
const sfx = {
  turn:    ()=>{ beep(660,0.12,0.2); setTimeout(()=>beep(880,0.15,0.22),120); },
  urgent:  ()=>beep(440,0.08,0.18,'square'),
  win:     ()=>{ beep(523,0.1,0.2); setTimeout(()=>beep(659,0.1,0.22),110); setTimeout(()=>beep(784,0.18,0.25),220); },
  bid:     ()=>beep(600,0.07,0.15),
  correct: ()=>{ beep(523,0.08,0.2); setTimeout(()=>beep(784,0.14,0.25),90); },
  wrong:   ()=>beep(220,0.18,0.2,'sawtooth'),
  reveal:  ()=>beep(440,0.1,0.15),
};

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
function saveSession(){ try{ localStorage.setItem(SESSION_KEY, JSON.stringify({code:roomCode, playerId:myStoredId})); }catch(e){} }
function clearSession(){ try{ localStorage.removeItem(SESSION_KEY); }catch(e){} }
(function hydrateSession(){
  try{
    const raw=localStorage.getItem(SESSION_KEY); if(!raw)return;
    const saved=JSON.parse(raw);
    if(saved && saved.code && saved.playerId){ roomCode=saved.code; myStoredId=saved.playerId; }
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
  $('tv-hint').textContent='📺 Vista TV';
}

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
        // La sala ya no existe o el jugador no está: no insistir, volver a home limpio.
        clearSession(); roomCode=null; myStoredId=null;
      }
    });
  }
});
socket.on('disconnect', () => { connBanner.textContent='Se perdió la conexión, reconectando...'; connBanner.className='conn-banner error'; });
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
const SECTIONS = ['s-home','s-lobby','s-imp-role','s-imp-clue','s-imp-vote','s-imp-reveal','s-imp-over','s-lie-claim','s-lie-naming','s-lie-final','s-lie-over','s-sub-formation','s-sub-wait-deck','s-sub-play','s-sub-rps','s-sub-result','s-sub-tournament','s-sub-duel','s-sub-over','s-wave-psychic','s-wave-guess','s-wave-reveal','s-who-board','s-who-guess-pending','s-who-over'];
function show(id){ SECTIONS.forEach(s=>$(s).classList.add('hidden')); $(id).classList.remove('hidden'); }
function posGroup(p){ if(p==='POR')return 'portero'; if(['LD','DFC','LI'].includes(p))return 'defensa'; if(['MCD','MC','MCO'].includes(p))return 'mediocampista'; return 'delantero'; }

let players = [];

/* ===== HOME ===== */
$('btn-create').addEventListener('click', () => {
  const name = $('inp-name').value.trim();
  if(!name){ showHomeError('Ingresa tu nombre.'); return; }
  socket.emit('player:create_room', { name }, onJoined);
});
$('btn-join').addEventListener('click', () => {
  const name = $('inp-name').value.trim();
  const code = $('inp-code').value.trim().toUpperCase();
  if(!name){ showHomeError('Ingresa tu nombre.'); return; }
  if(!code){ showHomeError('Ingresa el código.'); return; }
  socket.emit('player:join_room', { code, name }, onJoined);
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

/* ===== Compartir código (link directo con ?code=) ===== */
$('btn-share').addEventListener('click', async () => {
  const url  = `${location.origin}/?code=${roomCode}`;
  const text = `¡Únete a mi partida de 412! Entra en: ${url}`;
  if(navigator.share){ try{ await navigator.share({title:'412',text,url}); }catch(e){} }
  else { try{ await navigator.clipboard.writeText(url); $('btn-share').textContent='✓ Copiado'; setTimeout(()=>$('btn-share').textContent='📋 Copiar / compartir código',2000);}catch(e){} }
});

$('tv-hint').addEventListener('click', async () => {
  if(!tvLink) return;
  try{ await navigator.clipboard.writeText(tvLink); $('tv-hint').textContent='✓ Link copiado'; setTimeout(()=>$('tv-hint').textContent='📺 Vista TV',2000); }
  catch(e){}
});

// Salir de la sala: por si el navegador reintegra solo a una sala vieja
// (sesion guardada de otra partida) y la persona quiere volver al inicio
// para crear/unirse a otra. Limpiamos la sesion guardada y recargamos.
$('btn-leave-room').addEventListener('click', () => {
  if(!confirm('¿Salir de esta sala?')) return;
  clearSession();
  location.reload();
});

/* ===== LOBBY ===== */
let ALL_CATEGORIES=[], ALL_FORMATIONS=[], maxImpostors=1, minPlayers=3;
const CAT_LABELS={futbolista:'Futbolistas',equipo:'Equipos','selección':'Selecciones',dt:'DTs'};

socket.on('room:update', (st) => {
  players = st.players;
  isHost = (st.hostId === myId);
  currentGame = st.gameType;
  maxImpostors = st.maxImpostors; minPlayers = st.minPlayers;

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
  const grid=$('lobby-players'); grid.innerHTML='';
  st.players.forEach(p=>{
    const c=document.createElement('div'); c.className='player-chip'+(p.id===myId?' me':'');
    c.innerHTML=`<div class="player-chip-top">${avatarHTML(p.id,p.name)}<div class="name">${esc(p.name)}</div></div><div class="meta">${p.isHost?'★ anfitrión':(p.connected?'conectado':'...')}</div>`;
    grid.appendChild(c);
  });
  $('player-count').textContent=st.players.length;

  $('host-controls').classList.toggle('hidden',!isHost);
  $('guest-wait').classList.toggle('hidden',isHost);

  if(isHost){
    renderGamePicker(st.gameType);
    if(st.gameType==='impostor') renderImpostorCfg(st.impostorConfig);
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
  $('start-hint').textContent=!currentGame?'Elige un juego':(n<minPlayers?`Faltan jugadores (mín. ${minPlayers})`:'¡Listos!');
}

$('pick-impostor').addEventListener('click',()=>socket.emit('host:select_game',{code:roomCode,gameType:'impostor'}));
$('pick-mentiroso').addEventListener('click',()=>socket.emit('host:select_game',{code:roomCode,gameType:'mentiroso'}));
$('pick-subasta').addEventListener('click',()=>socket.emit('host:select_game',{code:roomCode,gameType:'subasta'}));
$('pick-wavelength').addEventListener('click',()=>socket.emit('host:select_game',{code:roomCode,gameType:'wavelength'}));
$('pick-who').addEventListener('click',()=>socket.emit('host:select_game',{code:roomCode,gameType:'who'}));

let impCfgRendered=false;
function renderImpostorCfg(cfg){
  const sel=$('cfg-imp-count'); const prev=Number(sel.value)||cfg.impostorCount;
  sel.innerHTML=''; for(let i=1;i<=maxImpostors;i++){const o=document.createElement('option');o.value=i;o.textContent=i;sel.appendChild(o);} sel.value=Math.min(prev,maxImpostors);
  $('cfg-imp-mangas').value=cfg.mangaCount;
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
  $('win-mode-desc').textContent=ovr?'OVR: gana quien tenga el equipo con mayor media promedio.':'Votación: al final se debate posición por posición y el grupo vota. Torneo de eliminación.';
  sendSubCfg();
}));

function sendWaveCfg(){ socket.emit('host:update_wave_config',{code:roomCode,roundCount:Number($('cfg-wave-rounds').value)}); }
$('cfg-wave-rounds').addEventListener('change',sendWaveCfg);

let whoCfgRendered=false;
const WHO_CATS=['futbolista','dt','equipo','selección'];
function renderWhoCfg(cfg){
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
function sendWhoCfg(){ socket.emit('host:update_who_config',{code:roomCode,categories:[...document.querySelectorAll('#cfg-who-cats input:checked')].map(i=>i.value)}); }

$('btn-start').addEventListener('click',()=>socket.emit('host:start_match',{code:roomCode}));

/* ===================== EL IMPOSTOR ===================== */
let impManga={n:1,c:3}, impTurn=null;
socket.on('imp:manga_started',({mangaNumber,mangaCount})=>{ impManga={n:mangaNumber,c:mangaCount}; });
socket.on('imp:role',({isImpostor,impostorCount,category,concept})=>{
  acquireWakeLock();
  const card=$('imp-role-card');
  if(isImpostor){ card.className='role-card impostor'; $('imp-role-icon').textContent='🕵️'; $('imp-role-label').textContent='Eres el impostor'; $('imp-role-concept').textContent='???'; $('imp-role-hint').textContent=impostorCount>1?`Hay ${impostorCount} impostores. Disimula.`:'No sabes el concepto. Disimula.'; }
  else { card.className='role-card innocent'; $('imp-role-icon').textContent='⚽'; $('imp-role-label').textContent='Concepto ('+category+')'; $('imp-role-concept').textContent=concept; $('imp-role-hint').textContent=impostorCount>1?`Hay ${impostorCount} impostores. Da una pista relacionada.`:'Da una pista relacionada, sin decirlo directo.'; }
  sfx.turn(); vib(100);
  show('s-imp-role');
});
$('btn-imp-role-ok').addEventListener('click',()=>{ renderClue(); show('s-imp-clue'); });
socket.on('imp:round',({roundNumber,currentTurnPlayerId})=>{ $('imp-round').textContent=roundNumber; impTurn=currentTurnPlayerId; $('imp-clue-log').innerHTML=''; if(currentVisibleSection()!=='s-imp-role'){renderClue();show('s-imp-clue');} });
socket.on('imp:turn',({currentTurnPlayerId})=>{ impTurn=currentTurnPlayerId; if(currentVisibleSection()==='s-imp-clue')renderClue(); });
function renderClue(){
  $('imp-manga-label').textContent=`Ronda ${impManga.n}/${impManga.c}`;
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
socket.on('imp:clue_phase_ending',()=>{ $('imp-my-turn').classList.add('hidden'); $('imp-wait-turn').classList.remove('hidden'); $('imp-turn-name').textContent='Votación...'; const av=$('imp-turn-avatar'); av.style.background='var(--bg2)'; av.style.color='var(--neon)'; av.textContent='⏳'; });
let impVoted=false;
socket.on('imp:voting',({candidates})=>{ impVoted=false; const g=$('imp-vote-grid'); g.innerHTML=''; candidates.filter(c=>c.id!==myId).forEach(c=>{ const b=document.createElement('button'); b.className='vote-btn'; b.textContent=c.name; b.addEventListener('click',()=>castVote(c.id,b)); g.appendChild(b); }); $('imp-vote-status').textContent=''; show('s-imp-vote'); });
function castVote(id,btn){ if(impVoted)return; impVoted=true; document.querySelectorAll('#imp-vote-grid .vote-btn').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); $('imp-vote-status').textContent='Voto enviado, esperando...'; socket.emit('player:submit_vote',{code:roomCode,targetId:id}); }
socket.on('imp:vote_count',({votesIn,votesNeeded})=>{ if(impVoted)$('imp-vote-status').textContent=`Voto enviado (${votesIn}/${votesNeeded})`; });
socket.on('imp:elimination',({eliminatedName,wasImpostor})=>{ $('imp-reveal-banner').className='reveal-banner '+(wasImpostor?'caught':'escaped'); $('imp-reveal-eyebrow').textContent=(wasImpostor?'🎯 ¡Atrapado!':'❌ Era inocente...'); $('imp-reveal-title').textContent=eliminatedName; $('imp-reveal-sub').textContent=wasImpostor?'Era impostor.':'La partida sigue...'; show('s-imp-reveal'); });
socket.on('imp:tie',({tiedPlayers})=>{ $('imp-reveal-banner').className='reveal-banner escaped'; $('imp-reveal-eyebrow').textContent='Empate'; $('imp-reveal-title').textContent='Nadie sale'; $('imp-reveal-sub').textContent=(tiedPlayers||[]).join(' vs '); show('s-imp-reveal'); });
let impLastFinal=false;
socket.on('imp:manga_over',({result,concept,impostorNames,mangaNumber,mangaCount,isLastManga,scores})=>{
  impLastFinal=isLastManga;
  $('imp-over-banner').className='reveal-banner '+(result==='impostors_caught'?'caught':'escaped');
  $('imp-over-eyebrow').textContent=(result==='impostors_caught'?'Impostores atrapados':'Ganaron los impostores')+` · Ronda ${mangaNumber}/${mangaCount}`;
  $('imp-over-title').textContent=(impostorNames.length>1?impostorNames.join(', ')+' eran':impostorNames.join(', ')+' era')+' impostor';
  $('imp-over-sub').textContent='Concepto: '+concept.name+' ('+concept.category+')';
  renderScores('imp-scoreboard',scores);
  $('btn-imp-next').textContent=isLastManga?'Volver al inicio':'Siguiente ronda';
  $('btn-imp-next').classList.toggle('hidden',!isHost);
  $('imp-over-wait').classList.toggle('hidden',isHost);
  show('s-imp-over');
});
$('btn-imp-next').addEventListener('click',()=>{ if(impLastFinal)socket.emit('host:new_session',{code:roomCode}); else socket.emit('host:next_manga',{code:roomCode}); });
function renderScores(elId,scores){ const b=$(elId); b.innerHTML=''; scores.forEach((p,i)=>{ const r=document.createElement('div'); r.className='score-row'; r.innerHTML=`<span class="rank">${rankLabel(i)}</span><span style="flex:1;margin-left:8px;">${esc(p.name)}</span><span class="points">${p.score} pts</span>`; b.appendChild(r); }); }

/* ===================== MENTIROSO ===================== */
let lieMode='texto', lieTurn=null, lieClaim=0, lieCd=null, amAccused=false, amAccuser=false, liePaused=false;
function startLieCd(deadline){ stopLieCd(); const el=$('lie-countdown'); let wasUrgent=false; function t(){const r=Math.max(0,Math.ceil((deadline-Date.now())/1000));el.textContent=r;const urgent=r<=3&&r>0;el.classList.toggle('urgent',urgent);if(urgent&&!wasUrgent){sfx.urgent();vib(30);}wasUrgent=urgent;if(r<=0)stopLieCd();} t(); lieCd=setInterval(t,250); }
function stopLieCd(){ if(lieCd){clearInterval(lieCd);lieCd=null;} }
// El que acuso puede frenar el reloj para verificar en vivo una respuesta
// dudosa antes de que se acabe el tiempo. Solo el/la acusador ve el boton;
// los demas ven un aviso de que esta en pausa.
function setLiePauseUI(paused, remainingMs){
  liePaused=paused;
  $('btn-lie-pause').textContent = paused ? '▶ Reanudar tiempo' : '⏸ Pausar tiempo';
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
function renderLieClaim(){ const mine=lieTurn===myId; $('lie-my-turn').classList.toggle('hidden',!mine); $('lie-wait-turn').classList.toggle('hidden',mine); if(mine){$('inp-claim').value='';$('claim-error').classList.add('hidden');$('btn-accuse').disabled=lieClaim<=0; sfx.turn(); vib(80);}else{const t=players.find(p=>p.id===lieTurn);$('lie-turn-name').textContent=t?t.name:'—';const av=$('lie-turn-avatar');const c=avatarFor(lieTurn||'?');av.style.background=c.bg;av.style.color=c.fg;av.textContent=(t?t.name:'?').trim().charAt(0).toUpperCase()||'?';} }
$('btn-claim').addEventListener('click',()=>{ const v=Number($('inp-claim').value); if(!Number.isInteger(v)||v<=lieClaim){$('claim-error').textContent=`Debe ser mayor a ${lieClaim}.`;$('claim-error').classList.remove('hidden');return;} socket.emit('player:make_claim',{code:roomCode,amount:v}); });
$('btn-accuse').addEventListener('click',()=>socket.emit('player:accuse_liar',{code:roomCode}));
socket.on('lie:claim_rejected',({reason})=>{ $('claim-error').textContent=reason; $('claim-error').classList.remove('hidden'); });
socket.on('lie:accused',({accuserId,accuserName,accusedId,accusedName,target,category,mode,deadlineAt,paused,remainingMs})=>{
  amAccused=accusedId===myId; amAccuser=accuserId===myId; lieMode=mode;
  $('lie-target').textContent=target; $('lie-named-count').textContent='0'; $('lie-named-log').innerHTML='';
  $('lie-naming-heading').textContent=amAccused?`${accuserName} no te creyó. Nombra ${target} de: ${category}`:`${accuserName} acusó a ${accusedName}. Categoría: ${category}`;
  $('btn-mark').classList.add('hidden'); $('lie-am-accused').classList.add('hidden'); $('lie-naming-wait').classList.add('hidden');
  if(mode==='voz'){ if(amAccuser){$('btn-mark').classList.remove('hidden');}else if(amAccused){$('lie-naming-wait').classList.remove('hidden');$('lie-naming-wait').textContent='Di tus respuestas en voz alta.';}else{$('lie-naming-wait').classList.remove('hidden');$('lie-naming-wait').textContent='Escucha y juzga al final.';} }
  else { if(amAccused){$('lie-am-accused').classList.remove('hidden');$('inp-name-item').value='';}else{$('lie-naming-wait').classList.remove('hidden');$('lie-naming-wait').textContent=`${accusedName} está escribiendo...`;} }
  $('btn-lie-pause').classList.toggle('hidden', !amAccuser);
  setLiePauseUI(!!paused, remainingMs);
  if(!paused) startLieCd(deadlineAt);
  show('s-lie-naming');
});
$('btn-mark').addEventListener('click',()=>socket.emit('player:mark_answer',{code:roomCode}));
socket.on('lie:answer_marked',({count,deadlineAt})=>{ $('lie-named-count').textContent=count; bump($('lie-named-count')); const log=$('lie-named-log');const it=document.createElement('div');it.className='clue-item';it.innerHTML=`<span>Respuesta ${count}</span><span class="who">✓</span>`;log.prepend(it); if(deadlineAt)startLieCd(deadlineAt);else stopLieCd(); });
$('btn-name-item').addEventListener('click',sendNameItem); $('inp-name-item').addEventListener('keydown',e=>{if(e.key==='Enter')sendNameItem();});
function sendNameItem(){ const t=$('inp-name-item').value.trim(); if(!t)return; $('inp-name-item').value=''; socket.emit('player:name_item',{code:roomCode,text:t}); }
socket.on('lie:item',({text,count,deadlineAt})=>{ $('lie-named-count').textContent=count; bump($('lie-named-count')); const log=$('lie-named-log');const it=document.createElement('div');it.className='clue-item';it.innerHTML=`<span>${esc(text)}</span><span class="who">#${count}</span>`;log.prepend(it); if(deadlineAt)startLieCd(deadlineAt);else stopLieCd(); });
let lieEligible=false;
socket.on('lie:final_vote',({target,mode,namedSoFar,eligibleVoterIds})=>{
  stopLieCd(); lieEligible=eligibleVoterIds.includes(myId);
  $('lie-final-title').textContent=`¿Las ${target} respuestas fueron válidas?`;
  const list=$('lie-final-list'); list.innerHTML='';
  if(mode==='texto'&&namedSoFar)namedSoFar.forEach(t=>{const it=document.createElement('div');it.className='clue-item';it.innerHTML=`<span>${esc(t)}</span>`;list.appendChild(it);});
  else { const it=document.createElement('div');it.className='clue-item';it.innerHTML='<span>Se dijeron en voz alta. ¿Las aceptan?</span>';list.appendChild(it); }
  $('lie-can-vote').classList.toggle('hidden',!lieEligible);
  $('lie-final-status').textContent=lieEligible?'Vota:':(amAccused?'El grupo está votando...':'Esperando votos...');
  show('s-lie-final');
});
$('btn-lie-valid').addEventListener('click',()=>castLieVote(true)); $('btn-lie-invalid').addEventListener('click',()=>castLieVote(false));
function castLieVote(v){ $('lie-can-vote').classList.add('hidden'); $('lie-final-status').textContent='Voto enviado...'; socket.emit('player:vote_final',{code:roomCode,valid:v}); }
socket.on('lie:final_progress',({votesIn,votesNeeded})=>{ if($('lie-can-vote').classList.contains('hidden'))$('lie-final-status').textContent=`${votesIn}/${votesNeeded} votos`; });
let lieLastFinal=false;
socket.on('lie:resolved',({success,reason,accusedName,accuserName,roundNumber,roundCount,isLastRound,scores})=>{
  stopLieCd(); lieLastFinal=isLastRound;
  $('lie-over-banner').className='reveal-banner '+(success?'caught':'escaped');
  $('lie-over-eyebrow').textContent=isLastRound?'¡Resultado Final!':'Ronda '+roundNumber+'/'+roundCount;
  $('lie-over-title').textContent=success?`✅ ${accusedName} sí pudo`:(reason==='timeout'?`⏱ ${accusedName} se quedó sin tiempo`:`❌ ${accusedName} no convenció`);
  $('lie-over-sub').textContent=success?`${accuserName} pierde 1 punto.`:`${accuserName} gana 1 punto.`;
  renderScores('lie-scoreboard', scores);
  $('btn-lie-next').textContent=isLastRound?'Volver al inicio':'Siguiente ronda';
  $('btn-lie-next').classList.toggle('hidden',!isHost);
  $('lie-over-wait').classList.toggle('hidden',isHost);
  show('s-lie-over');
});
$('btn-lie-next').addEventListener('click',()=>{ if(lieLastFinal)socket.emit('host:new_session',{code:roomCode}); else socket.emit('host:next_lie_round',{code:roomCode}); });

/* ===================== SUBASTA ===================== */
// Carga la imagen del jugador desde las imágenes propias del servidor.
//   revealed=false -> silueta negra (/images/siluetas/<id>.png)
//   revealed=true  -> foto a color (/images/reales/<id>.png)
// Si la imagen no existe todavía, muestra el placeholder (inicial de la posición).
function loadSil(imgEl,phEl,phPosEl,cardId,posName,revealed){
  if(!imgEl)return;
  if(!cardId){ silPh(imgEl,phEl,phPosEl,posName); return; }
  const carpeta = revealed ? 'reales' : 'siluetas';
  const url = `/images/${carpeta}/${encodeURIComponent(cardId)}.png`;
  imgEl.className = 'silhouette-img revealed';
  imgEl.onerror = ()=>{ silPh(imgEl,phEl,phPosEl,posName); }; // sin imagen: placeholder
  imgEl.onload = ()=>{ imgEl.classList.remove('hidden'); if(phEl)phEl.classList.add('hidden'); };
  imgEl.src = url;
}
function silPh(img,ph,phPos,posName){ if(img){img.classList.add('hidden');img.src='';} if(ph)ph.classList.remove('hidden'); if(phPos&&posName)phPos.textContent=posName.charAt(0); }

let subState={budget:1000,skipsLeft:5,teamCount:0}, subHighest=0, subStart=0, subEligible=false, subFormCd=null, iSkipped=false, currentFormation='4-3-3';
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
function updSubStats(){ $('sub-budget').textContent=`$${subState.budget}M`; $('sub-skips').textContent=subState.skipsLeft; $('sub-skip-n').textContent=subState.skipsLeft; $('sub-team-count').textContent=`${subState.teamCount}/11`; bump($('sub-budget')); bump($('sub-skips')); }
function updBidBtns(){ const base=Math.max(subHighest,subStart); $('bp1').textContent=base+1; $('bp5').textContent=base+5; $('bp10').textContent=base+10; }

socket.on('sub:formation_vote',({formations,secondsLeft})=>{
  const box=$('sub-form-buttons'); box.innerHTML=''; $('sub-form-voted').classList.add('hidden');
  formations.forEach(f=>{ const b=document.createElement('button'); b.className='btn-secondary'; b.textContent=f; b.addEventListener('click',()=>{ box.querySelectorAll('button').forEach(x=>x.disabled=true); socket.emit('player:vote_formation',{code:roomCode,formation:f}); $('sub-form-voted').classList.remove('hidden'); }); box.appendChild(b); });
  const el=$('sub-form-countdown'); el.textContent=secondsLeft; el.classList.toggle('urgent',secondsLeft<=5);
  show('s-sub-formation');
});
socket.on('sub:formation_tick',({secondsLeft})=>{ const el=$('sub-form-countdown'); if(el){el.textContent=secondsLeft;el.classList.toggle('urgent',secondsLeft<=5);} });
socket.on('sub:formation_vote_cast',({votesIn,totalPlayers})=>{ $('sub-form-votes').textContent=`${votesIn}/${totalPlayers} votos`; });
socket.on('sub:formation_decided',({formation})=>{ currentFormation=formation; subState.teamCount=0; updSubStats(); $('sub-formation-decided').textContent='Formación: '+formation; show('s-sub-wait-deck'); });

socket.on('sub:card',({cardIndex,totalCards,cardId,position,positionLabel,startingPrice,secondsLeft})=>{
  subHighest=0; subStart=startingPrice; subEligible=false; iSkipped=false;
  $('sub-counter').textContent=`${cardIndex+1}/${totalCards}`;
  const badge=$('sub-pos-badge'); badge.textContent=positionLabel; badge.className='position-badge '+posGroup(position);
  $('sub-price').textContent=`$${startingPrice}M precio base`;
  $('sub-highest').textContent='Sin pujas aún';
  $('sub-bid-log').innerHTML='';
  $('sub-phase-label').textContent='Analizando...';
  $('sub-can-bid').classList.add('hidden'); $('sub-bid-sent').classList.add('hidden'); $('sub-ineligible').classList.add('hidden');
  updBidBtns();
  loadSil($('sub-img'),$('sub-img-placeholder'),$('sub-img-pos'),cardId,positionLabel,false);
  const silBox=document.querySelector('#s-sub-play .silhouette-container'); silBox.classList.remove('flash'); void silBox.offsetWidth; silBox.classList.add('flash');
  show('s-sub-play');           // mostrar la pantalla primero...
  stopSubClock();               // ...resetear cualquier reloj previo...
  setSubCount(secondsLeft);     // ...y arrancar el reloj local ya en pantalla
});
socket.on('sub:eligibility',({eligible,skipsLeft})=>{ subState.skipsLeft=skipsLeft; subEligible=eligible; updSubStats(); $('sub-ineligible').classList.toggle('hidden',eligible); });
socket.on('sub:tick',({phase,secondsLeft})=>{ setSubCount(secondsLeft); $('sub-phase-label').textContent=phase==='analysis'?'Analizando...':'¡Pujas abiertas!'; });
socket.on('sub:bidding_open',({eligible,skipsLeft})=>{
  $('sub-phase-label').textContent='¡Pujas abiertas!';
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
  $('sub-highest').textContent=`Mejor: $${highestBid.amount}M — ${esc(highestBid.name)}`;
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
      $('sub-bid-sent-msg').textContent=`Vas ganando con $${amount}M`;
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
socket.on('sub:timer_extended',({secondsLeft})=>{ setSubCount(secondsLeft); const log=$('sub-bid-log');const it=document.createElement('div');it.className='clue-item';it.innerHTML='<span style="color:var(--red);">⏱ +5s</span>';log.prepend(it); });
function sendBid(inc){ const base=Math.max(subHighest,subStart); $('sub-can-bid').classList.add('hidden'); $('sub-bid-sent').classList.remove('hidden'); $('sub-bid-sent-msg').textContent=`Pujando $${base+inc}M...`; socket.emit('player:submit_bid',{code:roomCode,amount:base+inc}); }
$('btn-bid-1').addEventListener('click',()=>sendBid(1)); $('btn-bid-5').addEventListener('click',()=>sendBid(5)); $('btn-bid-10').addEventListener('click',()=>sendBid(10));
$('btn-skip').addEventListener('click',()=>{ iSkipped=true; $('sub-can-bid').classList.add('hidden'); $('sub-bid-sent').classList.remove('hidden'); $('sub-bid-sent-msg').textContent='Pasaste esta carta.'; socket.emit('player:skip_card',{code:roomCode}); });
socket.on('sub:bid_rejected',({reason})=>{ $('bid-error').textContent=reason; $('bid-error').classList.remove('hidden'); if(!iSkipped){$('sub-can-bid').classList.remove('hidden'); $('sub-bid-sent').classList.add('hidden');} updBidBtns(); setTimeout(()=>$('bid-error').classList.add('hidden'),3000); });
socket.on('sub:skip_confirmed',({skipsLeft})=>{ subState.skipsLeft=skipsLeft; updSubStats(); });
socket.on('sub:resync',({phase,secondsLeft,highestBid})=>{ if(highestBid){subHighest=highestBid.amount;$('sub-highest').textContent=`Mejor: $${highestBid.amount}M — ${esc(highestBid.name)}`;} setSubCount(secondsLeft); updBidBtns(); if(phase==='bidding'&&subEligible)$('sub-can-bid').classList.remove('hidden'); });
let subLast=false;
// ===== Piedra-papel-tijera (cuando nadie quiere la carta) =====
let rpsAmIn=false;
socket.on('sub:rps_start',({playerIds,playerNames,positionLabel})=>{
  stopSubClock();
  rpsAmIn=playerIds.includes(myId);
  $('sub-rps-title').textContent='Piedra, papel o tijera';
  $('sub-rps-sub').textContent=`Jugador misterioso de ${positionLabel} — el que pierde se lo queda 😈`;
  $('sub-rps-reveal').innerHTML='';
  $('sub-rps-status').textContent='';
  if(rpsAmIn){
    $('sub-rps-choose').classList.remove('hidden');
    $('rps-piedra').disabled=$('rps-papel').disabled=$('rps-tijera').disabled=false;
    ['rps-piedra','rps-papel','rps-tijera'].forEach(id=>$(id).classList.remove('selected'));
    $('sub-rps-status').textContent='Elige tu jugada';
  } else {
    $('sub-rps-choose').classList.add('hidden');
    $('sub-rps-status').textContent='Esperando a: '+playerNames.join(', ');
  }
  show('s-sub-rps');
});
function rpsChoose(c){
  $('rps-piedra').disabled=$('rps-papel').disabled=$('rps-tijera').disabled=true;
  ['rps-piedra','rps-papel','rps-tijera'].forEach(id=>$(id).classList.remove('selected'));
  $('rps-'+c).classList.add('selected');
  $('sub-rps-status').textContent='Elegiste. Esperando al rival...';
  socket.emit('player:rps_choice',{code:roomCode,choice:c});
}
$('rps-piedra').addEventListener('click',()=>rpsChoose('piedra'));
$('rps-papel').addEventListener('click',()=>rpsChoose('papel'));
$('rps-tijera').addEventListener('click',()=>rpsChoose('tijera'));
socket.on('sub:rps_progress',({chosen,total})=>{ if(!rpsAmIn)$('sub-rps-status').textContent=`${chosen}/${total} ya eligieron...`; });
const RPS_LABEL={piedra:'Piedra',papel:'Papel',tijera:'Tijera'};
socket.on('sub:rps_result',({choices,loserName,decided})=>{
  const box=$('sub-rps-reveal'); box.innerHTML='';
  for(const [name,ch] of Object.entries(choices)){ const it=document.createElement('div'); it.className='clue-item'; it.innerHTML=`<span><img class="rps-choice-icon" src="/images/ui/rps-${ch}.png" alt="${esc(RPS_LABEL[ch]||ch)}"/>${esc(RPS_LABEL[ch]||ch)}</span><span class="who">${esc(name)}</span>`; box.appendChild(it); }
  if(decided){ $('sub-rps-title').textContent='¡'+loserName+' se la queda!'; $('sub-rps-sub').textContent='Perdió el piedra-papel-tijera'; $('sub-rps-choose').classList.add('hidden'); $('sub-rps-status').textContent=''; }
  else { $('sub-rps-title').textContent='¡Empate! Otra vez'; $('sub-rps-sub').textContent='Se repite entre los empatados'; }
});

socket.on('sub:card_resolved',({cardId,cardName,cardLabel,cardPosition,positionLabel,cardTroll,result,winnerName,isLastCard})=>{
  stopSubClock();
  subLast=isLastCard;
  const isW=result.winnerId===myId;
  if(isW){ subState.budget-=result.amount; subState.teamCount++; updSubStats(); sfx.win(); vib([50,30,80]); }
  else { sfx.reveal(); }
  loadSil($('sub-result-img'),$('sub-result-placeholder'),null,cardId,positionLabel,true);
  $('sub-result-name').textContent=cardName; $('sub-result-label').textContent=cardLabel;
  $('sub-result-troll').classList.toggle('hidden',!cardTroll);
  if(result.type==='discard'){ $('sub-result-eyebrow').textContent='Descartada'; $('sub-result-sub').textContent='Nadie se la llevó.'; }
  else if(isW){ $('sub-result-eyebrow').textContent=`¡La conseguiste por $${result.amount}M!`; $('sub-result-sub').textContent=''; }
  else { $('sub-result-eyebrow').textContent=result.type==='lottery'?'Ruleta':'Vendida'; $('sub-result-sub').textContent=winnerName?`${winnerName} la ganó por $${result.amount}M`:''; }
  $('btn-sub-next').textContent=isLastCard?'Ver resultado final':'Siguiente carta';
  $('btn-sub-next').classList.toggle('hidden',!isHost);
  $('sub-result-wait').classList.toggle('hidden',isHost);
  show('s-sub-result');
});
$('btn-sub-next').addEventListener('click',()=>socket.emit('host:next_subasta_card',{code:roomCode}));
// ===== TORNEO (modo votación) =====
socket.on('sub:tournament_start',({teams})=>{
  stopSubClock();
  $('sub-tour-eyebrow').textContent='Torneo de equipos';
  $('sub-tour-title').textContent='¡Empieza el debate!';
  $('sub-tour-sub').textContent='Se enfrentarán posición por posición. Votan los que no juegan el duelo.';
  const info=$('sub-tour-info'); info.innerHTML='';
  teams.slice().sort((a,b)=>b.ovr-a.ovr).forEach(t=>{ const it=document.createElement('div'); it.className='clue-item'; it.innerHTML=`<span>${esc(t.name)}</span><span class="who">OVR oculto</span>`; info.appendChild(it); });
  show('s-sub-tournament');
});
socket.on('sub:tournament_bye',({name,round})=>{ $('sub-tour-title').textContent=`${name} pasa directo`; $('sub-tour-sub').textContent=`Mejor equipo de la ronda ${round} — espera rival`; show('s-sub-tournament'); });
socket.on('sub:tournament_round',({round,remaining})=>{ $('sub-tour-title').textContent=`Ronda ${round}`; $('sub-tour-sub').textContent='Siguen: '+remaining.join(', '); show('s-sub-tournament'); });
socket.on('sub:duel_start',({aName,bName,round,totalPositions})=>{
  $('sub-duel-round').textContent=`Ronda ${round}`;
  $('sub-duel-a-name').textContent=aName; $('sub-duel-b-name').textContent=bName;
  $('sub-duel-a-score').textContent='0'; $('sub-duel-b-score').textContent='0';
  $('sub-duel-progress').textContent=`Pos 0/${totalPositions}`;
  show('s-sub-duel');
});
let duelAmInvolved=false;
socket.on('sub:duel_position',({position,positionLabel,aCard,bCard,posIndex,totalPositions,voterIds})=>{
  $('sub-duel-pos').textContent=positionLabel; $('sub-duel-pos').className='position-badge '+posGroup(position);
  $('sub-duel-progress').textContent=`Pos ${posIndex}/${totalPositions}`;
  $('sub-duel-a-player').textContent=aCard?aCard.name:'(sin jugador)';
  $('sub-duel-b-player').textContent=bCard?bCard.name:'(sin jugador)';
  $('sub-duel-a-media').style.display='none'; $('sub-duel-b-media').style.display='none';
  $('sub-duel-a-side').classList.remove('winner'); $('sub-duel-b-side').classList.remove('winner');
  loadSil($('sub-duel-a-img'),$('sub-duel-a-ph'),null,aCard?aCard.cardId:null,positionLabel,false);
  loadSil($('sub-duel-b-img'),$('sub-duel-b-ph'),null,bCard?bCard.cardId:null,positionLabel,false);
  const canVote=voterIds.includes(myId);
  duelAmInvolved=!canVote;
  $('sub-duel-can-vote').classList.toggle('hidden',!canVote);
  $('sub-duel-status').textContent=canVote?'¿Quién es mejor?':'Tú juegas este duelo. Esperando votos...';
});
$('sub-duel-vote-a').addEventListener('click',()=>castDuelVote('A'));
$('sub-duel-vote-b').addEventListener('click',()=>castDuelVote('B'));
function castDuelVote(c){ $('sub-duel-can-vote').classList.add('hidden'); $('sub-duel-status').textContent='Voto enviado...'; socket.emit('player:vote_duel',{code:roomCode,choice:c}); }
socket.on('sub:duel_vote_progress',({votesIn,votesNeeded})=>{ if($('sub-duel-can-vote').classList.contains('hidden'))$('sub-duel-status').textContent=`${votesIn}/${votesNeeded} votos`; });
socket.on('sub:duel_position_result',({winner,mediaA,mediaB,scoreA,scoreB})=>{
  if(mediaA!==null){ $('sub-duel-a-media').style.display='block'; $('sub-duel-a-media').textContent='Media '+mediaA; }
  if(mediaB!==null){ $('sub-duel-b-media').style.display='block'; $('sub-duel-b-media').textContent='Media '+mediaB; }
  $('sub-duel-a-score').textContent=scoreA; $('sub-duel-b-score').textContent=scoreB;
  $('sub-duel-a-side').classList.toggle('winner',winner==='A'); $('sub-duel-b-side').classList.toggle('winner',winner==='B');
  $('sub-duel-status').textContent=winner==='A'?'◄ Gana esta posición':'Gana esta posición ►';
});
socket.on('sub:duel_result',({winnerName,loserName,scoreA,scoreB})=>{
  $('sub-tour-eyebrow').textContent='Resultado del duelo';
  $('sub-tour-title').textContent=`${winnerName} avanza`;
  $('sub-tour-sub').textContent=`${winnerName} venció a ${loserName} (${scoreA}–${scoreB})`;
  $('sub-tour-info').innerHTML='';
  show('s-sub-tournament');
});

let subOverScores=[], subOverMode='ovr', subOverChampionName='';
// Muestra la cancha final de cualquier jugador (no solo la propia). isMine
// controla el titulo y si el total mostrado es el presupuesto usado o el OVR
// del equipo elegido.
function showSubPitchFor(pid, isMine){
  const s=subOverScores.find(x=>x.id===pid); if(!s)return;
  document.querySelectorAll('#sub-scoreboard .score-row').forEach(r=>r.classList.remove('selected'));
  const idx=subOverScores.indexOf(s);
  const row=document.querySelectorAll('#sub-scoreboard .score-row')[idx];
  if(row)row.classList.add('selected');
  $('sub-pitch-title').textContent = isMine ? 'Tu alineación' : `Alineación de ${s.name}`;
  if(subOverMode==='votacion'){ $('sub-my-total').textContent = subOverChampionName===s.name ? '🏆 Campeón' : ''; }
  else { $('sub-my-total').textContent = `OVR ${s.ovr.toFixed(1)}`; }
  drawPitch($('sub-pitch'), currentFormation, s.cards||[]);
}
socket.on('sub:game_over',({mode,scores,formation,championName})=>{
  if(formation)currentFormation=formation;
  subOverScores=scores; subOverMode=mode; subOverChampionName=championName||'';
  showSubPitchFor(myId, true);
  const sb=$('sub-scoreboard'); sb.innerHTML='';
  scores.forEach((s,i)=>{
    const r=document.createElement('div'); r.className='score-row sub-score-clickable'+(s.id===myId?' me':'');
    const detail=mode==='votacion'?(i===0?'🏆 Campeón':''):(`OVR ${s.ovr.toFixed(1)}`);
    r.innerHTML=`<span class="rank">${rankLabel(i)}</span><span style="flex:1;margin-left:8px;">${esc(s.name)}${s.id===myId?' (tú)':''}</span><span class="points">${detail}</span>`;
    r.addEventListener('click', ()=>showSubPitchFor(s.id, s.id===myId));
    sb.appendChild(r);
  });
  $('btn-sub-new').classList.toggle('hidden',!isHost);
  $('sub-over-wait').classList.toggle('hidden',isHost);
  show('s-sub-over');
});
// Dibuja la alineación en una cancha. Las filas van de arriba (delanteros) a abajo (portero).
const FORMATION_SLOTS={
  '4-3-3':   {POR:1,LD:1,DFC:2,LI:1,MCD:1,MC:2,MCO:0,ED:1,EI:1,DC:1},
  '4-4-2':   {POR:1,LD:1,DFC:2,LI:1,MCD:0,MC:2,MCO:0,ED:1,EI:1,DC:2},
  '4-2-3-1': {POR:1,LD:1,DFC:2,LI:1,MCD:2,MC:0,MCO:1,ED:1,EI:1,DC:1},
  '3-5-2':   {POR:1,LD:0,DFC:3,LI:0,MCD:1,MC:2,MCO:1,ED:1,EI:1,DC:1},
  '3-4-3':   {POR:1,LD:0,DFC:3,LI:0,MCD:1,MC:2,MCO:0,ED:1,EI:1,DC:2},
  '4-3-1-2': {POR:1,LD:1,DFC:2,LI:1,MCD:1,MC:2,MCO:1,ED:0,EI:0,DC:2},
};
function drawPitch(container, formation, cards){
  container.innerHTML='';
  const slots=FORMATION_SLOTS[formation]||FORMATION_SLOTS['4-3-3'];
  // Agrupar las cartas ganadas por posición
  const byPos={}; (cards||[]).forEach(c=>{ (byPos[c.position]=byPos[c.position]||[]).push(c); });
  // Filas visuales de arriba (ataque) hacia abajo (portería).
  // El orden DENTRO de cada fila es de izquierda a derecha en pantalla:
  // los jugadores del lado izquierdo (LI, EI) van primero, los del derecho (LD, ED) al final.
  const rows=[ ['DC'], ['EI','MCO','ED'], ['MC','MCD'], ['LI','DFC','LD'], ['POR'] ];
  // Distribuir verticalmente
  const usableRows=rows.filter(row=>row.some(p=>slots[p]>0));
  const n=usableRows.length;
  usableRows.forEach((row,idx)=>{
    const rowDiv=document.createElement('div'); rowDiv.className='pitch-row';
    rowDiv.style.top=`${(idx+0.5)/n*100}%`; rowDiv.style.transform='translateY(-50%)';
    // Para cada posición de la fila, dibujar tantos tokens como pida la formación
    row.forEach(pos=>{
      const count=slots[pos]||0;
      for(let k=0;k<count;k++){
        const card=(byPos[pos]&&byPos[pos][k])||null;
        const pl=document.createElement('div'); pl.className='pitch-player'+(card?'':' pitch-empty');
        pl.appendChild(pitchTokenEl(card,pos));
        const nm=document.createElement('div'); nm.className='pitch-name'; nm.textContent=card?shortName(card.name):'—';
        pl.appendChild(nm);
        if(card){ const pl2=document.createElement('div'); pl2.className='pitch-pos'; pl2.textContent=pos; pl.appendChild(pl2); }
        if(card){ const v=document.createElement('div'); v.className='pitch-val'; v.textContent=`${card.media}`; pl.appendChild(v); }
        rowDiv.appendChild(pl);
      }
    });
    container.appendChild(rowDiv);
  });
}
function shortName(name){ const parts=name.split(' '); return parts.length>1?parts[parts.length-1]:name; }
// Token de la cancha final: foto real circular si existe (/images/reales/<id>.png),
// con fallback automático al circulo con el código de posición si la imagen no carga (404).
function pitchTokenEl(card,pos){
  if(!card) { const t=document.createElement('div'); t.className='pitch-token'; t.textContent=pos; return t; }
  const img=document.createElement('img');
  img.className='pitch-token-img'+(card.troll?' troll':'');
  img.src=`/images/reales/${card.cardId}.png`;
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
  $('btn-wave-peek').textContent='👁 Ver la zona';
  if(!waveIsPsychic){
    $('wave-psychic-name').textContent = psychicName || '—';
    const av=$('wave-psychic-avatar'); const c=avatarFor(psychicId||'?');
    av.style.background=c.bg; av.style.color=c.fg;
    av.textContent=(psychicName||'?').trim().charAt(0).toUpperCase()||'?';
  }
  show('s-wave-psychic');
});
$('btn-wave-peek').addEventListener('click', ()=>{
  if(wavePeekTarget==null){ socket.emit('player:wave_peek',{code:roomCode}); return; }
  wavePeeking=!wavePeeking;
  $('btn-wave-peek').textContent = wavePeeking ? '🙈 Ocultar' : '👁 Ver la zona';
  renderWaveDial('wave-dial-psychic', {leftLabel:waveLeft, rightLabel:waveRight, target: wavePeeking?wavePeekTarget:null});
});
socket.on('wave:target', ({target})=>{
  wavePeekTarget=target; wavePeeking=true;
  $('btn-wave-peek').textContent='🙈 Ocultar';
  renderWaveDial('wave-dial-psychic', {leftLabel:waveLeft, rightLabel:waveRight, target});
});
$('btn-wave-ready').addEventListener('click', ()=>socket.emit('player:wave_ready',{code:roomCode}));

socket.on('wave:guessing_start', ({secondsLeft,left,right})=>{
  waveLocked=false; waveMyValue=50; waveLeft=left; waveRight=right;
  renderWaveDial('wave-dial-guess', {leftLabel:left, rightLabel:right, interactive:!waveIsPsychic, value:50, onChange:v=>{waveMyValue=v;}});
  $('wave-guess-controls').classList.toggle('hidden', waveIsPsychic);
  $('wave-guess-wait').classList.toggle('hidden', !waveIsPsychic);
  $('wave-lock-status').textContent = waveIsPsychic ? 'Esperando a que adivinen...' : 'Mueve tu aguja y bloquea cuando estés list@.';
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
  $('wave-lock-status').textContent='Respuesta bloqueada. Esperando a los demás...';
  socket.emit('player:wave_lock',{code:roomCode, value:waveMyValue});
});
socket.on('wave:lock_progress', ({lockedIn,needed})=>{
  if(waveLocked||waveIsPsychic) $('wave-lock-status').textContent = `${lockedIn}/${needed} ya bloquearon...`;
});

socket.on('wave:reveal', ({target,left,right,psychicName,psychicScore,guesses,roundNumber,roundCount,isLastRound,scores})=>{
  const needles = guesses.map(g=>({ value:g.value, color:avatarFor(g.id).bg, label:g.name }));
  renderWaveDial('wave-dial-reveal', {leftLabel:left, rightLabel:right, target, needles});
  $('wave-reveal-eyebrow').textContent = `Ronda ${roundNumber}/${roundCount}`;
  const list=$('wave-reveal-list'); list.innerHTML='';
  const psyRow=document.createElement('div'); psyRow.className='clue-item';
  psyRow.innerHTML=`<span>🔮 ${esc(psychicName)} (Psíquico)</span><span class="who">+${psychicScore} pts</span>`;
  list.appendChild(psyRow);
  guesses.forEach(g=>{ const it=document.createElement('div'); it.className='clue-item'; it.innerHTML=`<span>${esc(g.name)}</span><span class="who">+${g.score} pts</span>`; list.appendChild(it); });
  renderScores('wave-scoreboard', scores);
  waveLastRound=isLastRound;
  $('btn-wave-next').textContent = isLastRound ? 'Volver al inicio' : 'Siguiente ronda';
  $('btn-wave-next').classList.toggle('hidden', !isHost);
  $('wave-over-wait').classList.toggle('hidden', isHost);
  show('s-wave-reveal');
});
$('btn-wave-next').addEventListener('click', ()=>{ if(waveLastRound) socket.emit('host:new_session',{code:roomCode}); else socket.emit('host:wave_next_round',{code:roomCode}); });

/* ===================== ¿QUIÉN SOY? ===================== */
const WHO_CAT_LABELS={futbolista:'Futbolista',dt:'DT',equipo:'Equipo','selección':'Selección'};
let whoTurnToken=0, whoIsMyTurn=false;

function renderWhoGrid(cards, activeId){
  const grid=$('who-grid'); grid.innerHTML='';
  cards.forEach(c=>{
    const mine=c.id===myId;
    const div=document.createElement('div');
    div.className='who-card'+(c.id===activeId?' active':'')+(mine?' mine':'')+(!c.hidden&&mine?' revealed':'');
    if(c.hidden){
      div.innerHTML=`<div class="who-owner">${esc(c.name)}${mine?' (tú)':''}</div><div class="who-hidden-glyph">?</div>`;
    } else {
      div.innerHTML=`<div class="who-owner">${esc(c.name)}${mine?' (tú)':''}</div><div class="who-identity">${esc(c.identity)}</div><div class="who-category">${esc(WHO_CAT_LABELS[c.category]||c.category)}</div>`;
    }
    grid.appendChild(div);
  });
}
socket.on('who:state', ({cards,activePlayerId,activePlayerName,isMyTurn,turnToken})=>{
  acquireWakeLock();
  whoTurnToken=turnToken; whoIsMyTurn=isMyTurn;
  renderWhoGrid(cards, activePlayerId);
  $('who-my-turn').classList.toggle('hidden', !isMyTurn);
  $('who-others-turn').classList.toggle('hidden', isMyTurn);
  if(isMyTurn){ $('inp-who-guess').value=''; sfx.turn(); vib(80); }
  else {
    $('who-turn-name').textContent=activePlayerName||'—';
    const av=$('who-turn-avatar'); const c=avatarFor(activePlayerId||'?');
    av.style.background=c.bg; av.style.color=c.fg;
    av.textContent=(activePlayerName||'?').trim().charAt(0).toUpperCase()||'?';
  }
  show('s-who-board');
});
socket.on('who:answer', ({answererName,answer,activePlayerName})=>{
  const label={si:'Sí',no:'No',talvez:'Tal vez'}[answer]||answer;
  const log=$('who-log'); const it=document.createElement('div'); it.className='clue-item';
  it.innerHTML=`<span>${esc(activePlayerName)} → ${esc(label)}</span><span class="who">${esc(answererName)}</span>`;
  log.prepend(it);
});
$('btn-who-si').addEventListener('click',()=>socket.emit('player:who_answer',{code:roomCode,answer:'si',turnToken:whoTurnToken}));
$('btn-who-no').addEventListener('click',()=>socket.emit('player:who_answer',{code:roomCode,answer:'no',turnToken:whoTurnToken}));
$('btn-who-talvez').addEventListener('click',()=>socket.emit('player:who_answer',{code:roomCode,answer:'talvez',turnToken:whoTurnToken}));
$('btn-who-guess').addEventListener('click',()=>{
  const t=$('inp-who-guess').value.trim(); if(!t)return;
  socket.emit('player:who_guess',{code:roomCode,text:t});
});
$('inp-who-guess').addEventListener('keydown',e=>{ if(e.key==='Enter')$('btn-who-guess').click(); });

socket.on('who:guess_submitted', ({playerId,playerName,text})=>{
  $('who-guess-heading').textContent=`${playerName} dice que es...`;
  $('who-guess-text').textContent=text;
  const amHost=isHost, amGuesser=playerId===myId;
  $('who-host-validate').classList.toggle('hidden', !amHost);
  $('who-validate-wait').classList.toggle('hidden', amHost);
  $('who-validate-wait').textContent = amGuesser ? 'Esperando que el anfitrión confirme...' : 'Esperando al anfitrión...';
  show('s-who-guess-pending');
});
$('btn-who-correct').addEventListener('click',()=>socket.emit('host:who_validate',{code:roomCode,correct:true}));
$('btn-who-incorrect').addEventListener('click',()=>socket.emit('host:who_validate',{code:roomCode,correct:false}));
socket.on('who:guess_result', ({playerName,correct,identity,points})=>{
  if(correct){ sfx.correct(); vib([50,30,80]); } else { sfx.wrong(); vib(120); }
  const log=$('who-log'); const it=document.createElement('div'); it.className='clue-item';
  it.innerHTML=correct?`<span>🎉 ${esc(playerName)} adivinó: ${esc(identity)}</span><span class="who">+${points} pts</span>`:`<span>${esc(playerName)} intentó adivinar</span><span class="who">✗</span>`;
  log.prepend(it);
});
socket.on('who:game_over', ({scores})=>{
  renderScores('who-scoreboard', scores);
  $('btn-who-new').classList.toggle('hidden', !isHost);
  $('who-over-wait').classList.toggle('hidden', isHost);
  show('s-who-over');
});
$('btn-who-new').addEventListener('click',()=>socket.emit('host:new_session',{code:roomCode}));

/* ===== Score overlay flotante ===== */
// Secciones en las que tiene sentido ver puntajes mid-game (excluyendo pantallas finales donde ya son visibles)
const SCORE_SECTIONS = new Set(['s-imp-clue','s-imp-vote','s-imp-reveal','s-lie-claim','s-lie-naming','s-lie-final','s-wave-psychic','s-wave-guess','s-wave-reveal','s-who-board','s-who-guess-pending']);
let _lastScores = null, _currentSection = null;
function _refreshScoreBtn(){ const ok=_lastScores&&_currentSection&&SCORE_SECTIONS.has(_currentSection); $('btn-scores-float').classList.toggle('hidden',!ok); }
function _storeScores(scores){ if(scores&&scores.length){ _lastScores=scores; _refreshScoreBtn(); } }
// Interceptar show() para rastrear sección actual
const _origShow = show;
show = function(id){ _origShow(id); _currentSection=id; _refreshScoreBtn(); };

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
socket.on('room:update',({status})=>{ if(status==='lobby'){ _lastScores=null; _currentSection=null; _refreshScoreBtn(); } });
