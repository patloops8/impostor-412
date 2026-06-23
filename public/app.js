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
let myId = null, roomCode = null, myStoredId = null, isHost = false, currentGame = null;

socket.on('connect', () => {
  connBanner.classList.add('hidden');
  // Reconexión: si ya teníamos sala, reintegrarse
  if (roomCode && myStoredId) {
    socket.emit('player:rejoin', { code: roomCode, playerId: myStoredId }, (res) => {
      if (res && res.ok) { myId = res.playerId; myStoredId = res.playerId; isHost = res.isHost; }
    });
  }
});
socket.on('disconnect', () => { connBanner.textContent='Se perdió la conexión, reconectando...'; connBanner.className='conn-banner error'; });
socket.io.on('reconnect', () => { connBanner.classList.add('hidden'); });

/* ===== Helpers ===== */
const $ = id => document.getElementById(id);
function esc(s){ const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
const SECTIONS = ['s-home','s-lobby','s-imp-role','s-imp-clue','s-imp-vote','s-imp-reveal','s-imp-over','s-lie-claim','s-lie-naming','s-lie-final','s-lie-over','s-sub-formation','s-sub-wait-deck','s-sub-play','s-sub-rps','s-sub-result','s-sub-over'];
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
  roomCode=res.code; myId=res.playerId; myStoredId=res.playerId; isHost=res.isHost;
  ALL_CATEGORIES=res.categories||[]; ALL_FORMATIONS=res.formations||[];
  $('lobby-code').textContent=roomCode;
  $('tv-hint').textContent='Vista TV: '+location.origin+'/tv?c='+roomCode;
  show('s-lobby');
}

/* ===== Compartir código ===== */
$('btn-share').addEventListener('click', async () => {
  const text = `¡Únete a mi partida de 412! Código: ${roomCode} — entra en ${location.origin}`;
  if(navigator.share){ try{ await navigator.share({text}); }catch(e){} }
  else { try{ await navigator.clipboard.writeText(text); $('btn-share').textContent='✓ Copiado'; setTimeout(()=>$('btn-share').textContent='📋 Copiar / compartir código',2000);}catch(e){} }
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
    // Si veníamos de un resultado, volver al lobby
    if(!['s-lobby','s-home'].includes(currentVisibleSection())) show('s-lobby');
  }
});

function currentVisibleSection(){ return SECTIONS.find(s=>!$(s).classList.contains('hidden')); }

function renderLobby(st){
  const grid=$('lobby-players'); grid.innerHTML='';
  st.players.forEach(p=>{
    const c=document.createElement('div'); c.className='player-chip'+(p.id===myId?' me':'');
    c.innerHTML=`<div class="name">${esc(p.name)}</div><div class="meta">${p.isHost?'★ anfitrión':(p.connected?'conectado':'...')}</div>`;
    grid.appendChild(c);
  });
  $('player-count').textContent=st.players.length;

  $('host-controls').classList.toggle('hidden',!isHost);
  $('guest-wait').classList.toggle('hidden',isHost);

  if(isHost){
    renderGamePicker(st.gameType);
    if(st.gameType==='impostor') renderImpostorCfg(st.impostorConfig);
    updateStartBtn(st.players.length);
  }
}

function renderGamePicker(g){
  $('pick-impostor').classList.toggle('selected',g==='impostor');
  $('pick-mentiroso').classList.toggle('selected',g==='mentiroso');
  $('pick-subasta').classList.toggle('selected',g==='subasta');
  $('cfg-impostor').classList.toggle('hidden',g!=='impostor');
  $('cfg-mentiroso').classList.toggle('hidden',g!=='mentiroso');
  $('cfg-subasta').classList.toggle('hidden',g!=='subasta');
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

function sendLieCfg(){ socket.emit('host:update_mentiroso_config',{code:roomCode,roundCount:Number($('cfg-lie-rounds').value),mode:document.querySelector('input[name=lm]:checked').value}); }
$('cfg-lie-rounds').addEventListener('change',sendLieCfg);
document.querySelectorAll('input[name=lm]').forEach(r=>r.addEventListener('change',()=>{
  $('lie-mode-texto').classList.toggle('checked',document.querySelector('input[name=lm][value=texto]').checked);
  $('lie-mode-voz').classList.toggle('checked',document.querySelector('input[name=lm][value=voz]').checked);
  sendLieCfg();
}));

function sendSubCfg(){ socket.emit('host:update_subasta_config',{code:roomCode,budget:Number($('cfg-sub-budget').value),skipLimit:Number($('cfg-sub-skips').value)}); }
$('cfg-sub-budget').addEventListener('change',sendSubCfg);
$('cfg-sub-skips').addEventListener('change',sendSubCfg);

$('btn-start').addEventListener('click',()=>socket.emit('host:start_match',{code:roomCode}));

/* ===================== EL IMPOSTOR ===================== */
let impManga={n:1,c:3}, impTurn=null;
socket.on('imp:manga_started',({mangaNumber,mangaCount})=>{ impManga={n:mangaNumber,c:mangaCount}; });
socket.on('imp:role',({isImpostor,impostorCount,category,concept})=>{
  const card=$('imp-role-card');
  if(isImpostor){ card.className='role-card impostor'; $('imp-role-label').textContent='Eres el impostor'; $('imp-role-concept').textContent='???'; $('imp-role-hint').textContent=impostorCount>1?`Hay ${impostorCount} impostores. Disimula.`:'No sabes el concepto. Disimula.'; }
  else { card.className='role-card innocent'; $('imp-role-label').textContent='Concepto ('+category+')'; $('imp-role-concept').textContent=concept; $('imp-role-hint').textContent=impostorCount>1?`Hay ${impostorCount} impostores. Da una pista relacionada.`:'Da una pista relacionada, sin decirlo directo.'; }
  show('s-imp-role');
});
$('btn-imp-role-ok').addEventListener('click',()=>{ renderClue(); show('s-imp-clue'); });
socket.on('imp:round',({roundNumber,currentTurnPlayerId})=>{ $('imp-round').textContent=roundNumber; impTurn=currentTurnPlayerId; $('imp-clue-log').innerHTML=''; if(currentVisibleSection()!=='s-imp-role'){renderClue();show('s-imp-clue');} });
socket.on('imp:turn',({currentTurnPlayerId})=>{ impTurn=currentTurnPlayerId; if(currentVisibleSection()==='s-imp-clue')renderClue(); });
function renderClue(){
  $('imp-manga-label').textContent=`Manga ${impManga.n}/${impManga.c}`;
  const grid=$('imp-players'); grid.innerHTML='';
  players.forEach(p=>{ const c=document.createElement('div'); c.className='player-chip'+(p.id===impTurn?' turn':'')+(p.id===myId?' me':''); c.innerHTML=`<div class="name">${esc(p.name)}</div>`; grid.appendChild(c); });
  const mine=impTurn===myId;
  $('imp-my-turn').classList.toggle('hidden',!mine);
  $('imp-wait-turn').classList.toggle('hidden',mine);
  if(mine){ $('inp-clue').value=''; $('clue-error').classList.add('hidden'); }
  else { const t=players.find(p=>p.id===impTurn); $('imp-turn-name').textContent=t?t.name:'—'; }
}
$('btn-clue').addEventListener('click',()=>{ const w=$('inp-clue').value.trim(); if(w)socket.emit('player:submit_clue',{code:roomCode,word:w}); });
$('inp-clue').addEventListener('keydown',e=>{ if(e.key==='Enter')$('btn-clue').click(); });
socket.on('imp:clue_rejected',({reason})=>{ $('clue-error').textContent=reason; $('clue-error').classList.remove('hidden'); });
socket.on('imp:clue',({name,word})=>{ const log=$('imp-clue-log'); const it=document.createElement('div'); it.className='clue-item'; it.innerHTML=`<span>${esc(word)}</span><span class="who">${esc(name)}</span>`; log.prepend(it); });
socket.on('imp:clue_phase_ending',()=>{ $('imp-my-turn').classList.add('hidden'); $('imp-wait-turn').classList.remove('hidden'); $('imp-turn-name').textContent='Votación...'; });
let impVoted=false;
socket.on('imp:voting',({candidates})=>{ impVoted=false; const g=$('imp-vote-grid'); g.innerHTML=''; candidates.filter(c=>c.id!==myId).forEach(c=>{ const b=document.createElement('button'); b.className='vote-btn'; b.textContent=c.name; b.addEventListener('click',()=>castVote(c.id,b)); g.appendChild(b); }); $('imp-vote-status').textContent=''; show('s-imp-vote'); });
function castVote(id,btn){ if(impVoted)return; impVoted=true; document.querySelectorAll('#imp-vote-grid .vote-btn').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); $('imp-vote-status').textContent='Voto enviado, esperando...'; socket.emit('player:submit_vote',{code:roomCode,targetId:id}); }
socket.on('imp:vote_count',({votesIn,votesNeeded})=>{ if(impVoted)$('imp-vote-status').textContent=`Voto enviado (${votesIn}/${votesNeeded})`; });
socket.on('imp:elimination',({eliminatedName,wasImpostor})=>{ $('imp-reveal-banner').className='reveal-banner '+(wasImpostor?'caught':'escaped'); $('imp-reveal-eyebrow').textContent=wasImpostor?'¡Atrapado!':'Era inocente...'; $('imp-reveal-title').textContent=eliminatedName; $('imp-reveal-sub').textContent=wasImpostor?'Era impostor.':'La partida sigue...'; show('s-imp-reveal'); });
socket.on('imp:tie',({tiedPlayers})=>{ $('imp-reveal-banner').className='reveal-banner escaped'; $('imp-reveal-eyebrow').textContent='Empate'; $('imp-reveal-title').textContent='Nadie sale'; $('imp-reveal-sub').textContent=(tiedPlayers||[]).join(' vs '); show('s-imp-reveal'); });
let impLastFinal=false;
socket.on('imp:manga_over',({result,concept,impostorNames,mangaNumber,mangaCount,isLastManga,scores})=>{
  impLastFinal=isLastManga;
  $('imp-over-banner').className='reveal-banner '+(result==='impostors_caught'?'caught':'escaped');
  $('imp-over-eyebrow').textContent=(result==='impostors_caught'?'Impostores atrapados':'Ganaron los impostores')+` · Manga ${mangaNumber}/${mangaCount}`;
  $('imp-over-title').textContent=(impostorNames.length>1?impostorNames.join(', ')+' eran':impostorNames.join(', ')+' era')+' impostor';
  $('imp-over-sub').textContent='Concepto: '+concept.name+' ('+concept.category+')';
  renderScores('imp-scoreboard',scores);
  $('btn-imp-next').textContent=isLastManga?'Volver al inicio':'Siguiente manga';
  $('btn-imp-next').classList.toggle('hidden',!isHost);
  $('imp-over-wait').classList.toggle('hidden',isHost);
  show('s-imp-over');
});
$('btn-imp-next').addEventListener('click',()=>{ if(impLastFinal)socket.emit('host:new_session',{code:roomCode}); else socket.emit('host:next_manga',{code:roomCode}); });
function renderScores(elId,scores){ const b=$(elId); b.innerHTML=''; scores.forEach((p,i)=>{ const r=document.createElement('div'); r.className='score-row'; r.innerHTML=`<span class="rank">#${i+1}</span><span style="flex:1;margin-left:8px;">${esc(p.name)}</span><span class="points">${p.score} pts</span>`; b.appendChild(r); }); }

/* ===================== MENTIROSO ===================== */
let lieMode='texto', lieTurn=null, lieClaim=0, lieCd=null, amAccused=false, amAccuser=false;
function startLieCd(deadline){ stopLieCd(); const el=$('lie-countdown'); function t(){const r=Math.max(0,Math.ceil((deadline-Date.now())/1000));el.textContent=r;el.classList.toggle('urgent',r<=3);if(r<=0)stopLieCd();} t(); lieCd=setInterval(t,250); }
function stopLieCd(){ if(lieCd){clearInterval(lieCd);lieCd=null;} }
socket.on('lie:round',({roundNumber,roundCount,category,mode,currentTurnPlayerId})=>{ $('lie-round').textContent=roundNumber; $('lie-round-count').textContent=roundCount; $('lie-category').textContent=category; $('lie-claim-amount').textContent='0'; lieClaim=0; lieMode=mode; lieTurn=currentTurnPlayerId; renderLieClaim(); show('s-lie-claim'); });
socket.on('lie:turn',({currentTurnPlayerId})=>{ lieTurn=currentTurnPlayerId; if(currentVisibleSection()==='s-lie-claim')renderLieClaim(); });
socket.on('lie:claim',({amount})=>{ lieClaim=amount; $('lie-claim-amount').textContent=amount; });
function renderLieClaim(){ const mine=lieTurn===myId; $('lie-my-turn').classList.toggle('hidden',!mine); $('lie-wait-turn').classList.toggle('hidden',mine); if(mine){$('inp-claim').value='';$('claim-error').classList.add('hidden');$('btn-accuse').disabled=lieClaim<=0;}else{const t=players.find(p=>p.id===lieTurn);$('lie-turn-name').textContent=t?t.name:'—';} }
$('btn-claim').addEventListener('click',()=>{ const v=Number($('inp-claim').value); if(!Number.isInteger(v)||v<=lieClaim){$('claim-error').textContent=`Debe ser mayor a ${lieClaim}.`;$('claim-error').classList.remove('hidden');return;} socket.emit('player:make_claim',{code:roomCode,amount:v}); });
$('btn-accuse').addEventListener('click',()=>socket.emit('player:accuse_liar',{code:roomCode}));
socket.on('lie:claim_rejected',({reason})=>{ $('claim-error').textContent=reason; $('claim-error').classList.remove('hidden'); });
socket.on('lie:accused',({accuserId,accuserName,accusedId,accusedName,target,category,mode,deadlineAt})=>{
  amAccused=accusedId===myId; amAccuser=accuserId===myId; lieMode=mode;
  $('lie-target').textContent=target; $('lie-named-count').textContent='0'; $('lie-named-log').innerHTML='';
  $('lie-naming-heading').textContent=amAccused?`${accuserName} no te creyó. Nombra ${target} de: ${category}`:`${accuserName} acusó a ${accusedName}. Categoría: ${category}`;
  $('btn-mark').classList.add('hidden'); $('lie-am-accused').classList.add('hidden'); $('lie-naming-wait').classList.add('hidden');
  if(mode==='voz'){ if(amAccuser){$('btn-mark').classList.remove('hidden');}else if(amAccused){$('lie-naming-wait').classList.remove('hidden');$('lie-naming-wait').textContent='Di tus respuestas en voz alta.';}else{$('lie-naming-wait').classList.remove('hidden');$('lie-naming-wait').textContent='Escucha y juzga al final.';} }
  else { if(amAccused){$('lie-am-accused').classList.remove('hidden');$('inp-name-item').value='';}else{$('lie-naming-wait').classList.remove('hidden');$('lie-naming-wait').textContent=`${accusedName} está escribiendo...`;} }
  startLieCd(deadlineAt); show('s-lie-naming');
});
$('btn-mark').addEventListener('click',()=>socket.emit('player:mark_answer',{code:roomCode}));
socket.on('lie:answer_marked',({count,deadlineAt})=>{ $('lie-named-count').textContent=count; const log=$('lie-named-log');const it=document.createElement('div');it.className='clue-item';it.innerHTML=`<span>Respuesta ${count}</span><span class="who">✓</span>`;log.prepend(it); if(deadlineAt)startLieCd(deadlineAt);else stopLieCd(); });
$('btn-name-item').addEventListener('click',sendNameItem); $('inp-name-item').addEventListener('keydown',e=>{if(e.key==='Enter')sendNameItem();});
function sendNameItem(){ const t=$('inp-name-item').value.trim(); if(!t)return; $('inp-name-item').value=''; socket.emit('player:name_item',{code:roomCode,text:t}); }
socket.on('lie:item',({text,count,deadlineAt})=>{ $('lie-named-count').textContent=count; const log=$('lie-named-log');const it=document.createElement('div');it.className='clue-item';it.innerHTML=`<span>${esc(text)}</span><span class="who">#${count}</span>`;log.prepend(it); if(deadlineAt)startLieCd(deadlineAt);else stopLieCd(); });
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
  $('lie-over-eyebrow').textContent=`Ronda ${roundNumber}/${roundCount}`;
  $('lie-over-title').textContent=success?`${accusedName} sí pudo`:(reason==='timeout'?`${accusedName} se quedó sin tiempo`:`${accusedName} no convenció`);
  $('lie-over-sub').textContent=success?`${accuserName} pierde 1 punto.`:`${accuserName} gana 1 punto.`;
  const me=scores.find(s=>s.id===myId); $('lie-my-score').textContent=me?me.score:0;
  $('btn-lie-next').textContent=isLastRound?'Volver al inicio':'Siguiente ronda';
  $('btn-lie-next').classList.toggle('hidden',!isHost);
  $('lie-over-wait').classList.toggle('hidden',isHost);
  show('s-lie-over');
});
$('btn-lie-next').addEventListener('click',()=>{ if(lieLastFinal)socket.emit('host:new_session',{code:roomCode}); else socket.emit('host:next_lie_round',{code:roomCode}); });

/* ===================== SUBASTA ===================== */
const wikiCache=new Map();
// Pide el thumbnail reducido a ~300px: mucho más liviano para móvil que la imagen completa.
async function fetchWikiThumb(wikiTitle){
  if(wikiCache.has(wikiTitle)) return wikiCache.get(wikiTitle);
  try{
    const res=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`);
    const d=await res.json();
    let u=d.thumbnail?.source||null;
    // Wikipedia sirve thumbs con el ancho en la URL (…/NNNpx-…). Forzar 300px si se puede.
    if(u) u=u.replace(/\/\d+px-/,'/300px-');
    wikiCache.set(wikiTitle,u);
    return u;
  }catch{ wikiCache.set(wikiTitle,null); return null; }
}
async function loadSil(imgEl,phEl,phPosEl,wikiTitle,posName,revealed){
  if(!imgEl)return;
  if(!wikiTitle){ silPh(imgEl,phEl,phPosEl,posName); return; }
  const u=await fetchWikiThumb(wikiTitle);
  if(u)applySil(imgEl,phEl,u,revealed); else silPh(imgEl,phEl,phPosEl,posName);
}
// Precarga: dispara los fetch de varios títulos en segundo plano (sin bloquear).
function prefetchWiki(titles){ (titles||[]).forEach(t=>{ if(t&&!wikiCache.has(t)) fetchWikiThumb(t).catch(()=>{}); }); }
function applySil(img,ph,url,rev){ img.className=rev?'silhouette-img revealed':'silhouette-img'; img.onerror=()=>{img.classList.add('hidden');if(ph)ph.classList.remove('hidden');}; img.src=url; img.classList.remove('hidden'); if(ph)ph.classList.add('hidden'); }
function silPh(img,ph,phPos,posName){ if(img){img.classList.add('hidden');img.src='';} if(ph)ph.classList.remove('hidden'); if(phPos&&posName)phPos.textContent=posName.charAt(0); }

let subState={budget:500,skipsLeft:5}, subHighest=0, subStart=0, subEligible=false, subFormCd=null, iSkipped=false, currentFormation='4-3-3';
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
function updSubStats(){ $('sub-budget').textContent=`$${subState.budget}M`; $('sub-skips').textContent=subState.skipsLeft; $('sub-skip-n').textContent=subState.skipsLeft; }
function updBidBtns(){ const base=Math.max(subHighest,subStart); $('bp1').textContent=base+1; $('bp5').textContent=base+5; $('bp10').textContent=base+10; }

socket.on('sub:formation_vote',({formations,secondsLeft})=>{
  const box=$('sub-form-buttons'); box.innerHTML=''; $('sub-form-voted').classList.add('hidden');
  formations.forEach(f=>{ const b=document.createElement('button'); b.className='btn-secondary'; b.textContent=f; b.addEventListener('click',()=>{ box.querySelectorAll('button').forEach(x=>x.disabled=true); socket.emit('player:vote_formation',{code:roomCode,formation:f}); $('sub-form-voted').classList.remove('hidden'); }); box.appendChild(b); });
  const el=$('sub-form-countdown'); el.textContent=secondsLeft; el.classList.toggle('urgent',secondsLeft<=5);
  show('s-sub-formation');
});
socket.on('sub:formation_tick',({secondsLeft})=>{ const el=$('sub-form-countdown'); if(el){el.textContent=secondsLeft;el.classList.toggle('urgent',secondsLeft<=5);} });
socket.on('sub:formation_vote_cast',({votesIn,totalPlayers})=>{ $('sub-form-votes').textContent=`${votesIn}/${totalPlayers} votos`; });
socket.on('sub:formation_decided',({formation})=>{ currentFormation=formation; $('sub-formation-decided').textContent='Formación: '+formation; show('s-sub-wait-deck'); });
socket.on('sub:prefetch',({wikiTitles})=>{ prefetchWiki(wikiTitles); });

socket.on('sub:card',({cardIndex,totalCards,position,positionLabel,startingPrice,wikiTitle,secondsLeft})=>{
  subHighest=0; subStart=startingPrice; subEligible=false; iSkipped=false;
  $('sub-counter').textContent=`${cardIndex+1}/${totalCards}`;
  const badge=$('sub-pos-badge'); badge.textContent=positionLabel; badge.className='position-badge '+posGroup(position);
  $('sub-price').textContent=`$${startingPrice}M precio base`;
  $('sub-highest').textContent='Sin pujas aún';
  $('sub-bid-log').innerHTML='';
  $('sub-phase-label').textContent='Analizando...';
  $('sub-can-bid').classList.add('hidden'); $('sub-bid-sent').classList.add('hidden'); $('sub-ineligible').classList.add('hidden');
  updBidBtns();
  loadSil($('sub-img'),$('sub-img-placeholder'),$('sub-img-pos'),wikiTitle,positionLabel,false);
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
socket.on('sub:bid_public',({name,amount,highestBid})=>{
  subHighest=highestBid.amount;
  const iAmHighest = highestBid.playerId === myId;
  $('sub-highest').textContent=`Mejor: $${highestBid.amount}M — ${esc(highestBid.name)}`;
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
socket.on('sub:rps_start',({playerIds,playerNames,cardName,positionLabel})=>{
  stopSubClock();
  rpsAmIn=playerIds.includes(myId);
  $('sub-rps-title').textContent='Piedra, papel o tijera';
  $('sub-rps-sub').textContent=`${cardName} (${positionLabel}) — el que pierde se la queda 😈`;
  $('sub-rps-reveal').innerHTML='';
  $('sub-rps-status').textContent='';
  if(rpsAmIn){
    $('sub-rps-choose').classList.remove('hidden');
    $('rps-piedra').disabled=$('rps-papel').disabled=$('rps-tijera').disabled=false;
    $('sub-rps-status').textContent='Elige tu jugada';
  } else {
    $('sub-rps-choose').classList.add('hidden');
    $('sub-rps-status').textContent='Esperando a: '+playerNames.join(', ');
  }
  show('s-sub-rps');
});
function rpsChoose(c){ $('rps-piedra').disabled=$('rps-papel').disabled=$('rps-tijera').disabled=true; $('sub-rps-status').textContent='Elegiste. Esperando al rival...'; socket.emit('player:rps_choice',{code:roomCode,choice:c}); }
$('rps-piedra').addEventListener('click',()=>rpsChoose('piedra'));
$('rps-papel').addEventListener('click',()=>rpsChoose('papel'));
$('rps-tijera').addEventListener('click',()=>rpsChoose('tijera'));
socket.on('sub:rps_progress',({chosen,total})=>{ if(!rpsAmIn)$('sub-rps-status').textContent=`${chosen}/${total} ya eligieron...`; });
const RPS_EMOJI={piedra:'🪨',papel:'📄',tijera:'✂️'};
socket.on('sub:rps_result',({choices,loserName,decided})=>{
  const box=$('sub-rps-reveal'); box.innerHTML='';
  for(const [name,ch] of Object.entries(choices)){ const it=document.createElement('div'); it.className='clue-item'; it.innerHTML=`<span>${RPS_EMOJI[ch]||''} ${esc(ch)}</span><span class="who">${esc(name)}</span>`; box.appendChild(it); }
  if(decided){ $('sub-rps-title').textContent='¡'+loserName+' se la queda!'; $('sub-rps-sub').textContent='Perdió el piedra-papel-tijera'; $('sub-rps-choose').classList.add('hidden'); $('sub-rps-status').textContent=''; }
  else { $('sub-rps-title').textContent='¡Empate! Otra vez'; $('sub-rps-sub').textContent='Se repite entre los empatados'; }
});

socket.on('sub:card_resolved',({cardName,cardLabel,cardPosition,positionLabel,cardWikiTitle,cardTroll,result,winnerName,isLastCard})=>{
  stopSubClock();
  subLast=isLastCard;
  const isW=result.winnerId===myId;
  if(isW){ subState.budget-=result.amount; updSubStats(); }
  loadSil($('sub-result-img'),$('sub-result-placeholder'),null,cardWikiTitle,positionLabel,true);
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
socket.on('sub:game_over',({scores,formation})=>{
  if(formation)currentFormation=formation;
  const me=scores.find(s=>s.id===myId);
  $('sub-my-total').textContent=`$${me?me.totalRealValue:0}M`;
  drawPitch($('sub-pitch'), currentFormation, me?me.cards:[]);
  const sb=$('sub-scoreboard'); sb.innerHTML='';
  scores.forEach((s,i)=>{ const r=document.createElement('div'); r.className='score-row'; r.innerHTML=`<span class="rank">#${i+1}</span><span style="flex:1;margin-left:8px;">${esc(s.name)}</span><span class="points">$${s.totalRealValue}M</span>`; sb.appendChild(r); });
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
  // Filas visuales de arriba (ataque) hacia abajo (portería)
  const rows=[ ['DC'], ['ED','MCO','EI'], ['MCD','MC'], ['LD','DFC','LI'], ['POR'] ];
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
        const token=document.createElement('div'); token.className='pitch-token'+(card&&card.troll?' troll':'');
        token.textContent=pos;
        const nm=document.createElement('div'); nm.className='pitch-name'; nm.textContent=card?shortName(card.name):'—';
        pl.appendChild(token); pl.appendChild(nm);
        if(card){ const v=document.createElement('div'); v.className='pitch-val'; v.textContent=`$${card.realValue}M`; pl.appendChild(v); }
        rowDiv.appendChild(pl);
      }
    });
    container.appendChild(rowDiv);
  });
}
function shortName(name){ const parts=name.split(' '); return parts.length>1?parts[parts.length-1]:name; }
$('btn-sub-new').addEventListener('click',()=>socket.emit('host:new_session',{code:roomCode}));

// Reconexión a subasta: pedir estado
socket.on('connect',()=>{ if(roomCode&&currentVisibleSection()==='s-sub-play')socket.emit('player:request_sub_sync',{code:roomCode}); });
