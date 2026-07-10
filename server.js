const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  // Priorizar WebSocket (rápido) pero permitir polling como respaldo.
  transports: ['websocket', 'polling'],
  // Tiempos más tolerantes: en móvil/Render las conexiones tardan más en establecerse.
  pingTimeout: 30000,
  pingInterval: 25000,
  // Permitir que el cliente "actualice" de polling a websocket sin perder la sesión.
  allowUpgrades: true,
  // CORS abierto (mismo origen en producción, pero evita bloqueos en pruebas).
  cors: { origin: '*', methods: ['GET','POST'] },
});
const PORT = process.env.PORT || 3000;

/* ===================== DATOS ===================== */
const CONCEPTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'concepts.json'), 'utf-8'));
const ALL_CATEGORIES = [...new Set(CONCEPTS.map(c => c.category))];
const LIE_CATEGORIES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'mentiroso-categories.json'), 'utf-8'));
const SUBASTA_CARDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'subasta-cards.json'), 'utf-8'));
const WAVE_PAIRS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'wavelength-pairs.json'), 'utf-8'));

const POSITION_ORDER = ['POR','LD','DFC','LI','MCD','MC','MCO','ED','EI','DC'];
const POSITION_LABELS = {
  POR:'Portero', LD:'Lateral Derecho', DFC:'Defensa Central', LI:'Lateral Izquierdo',
  MCD:'Mediocentro Defensivo', MC:'Mediocentro', MCO:'Mediocentro Ofensivo',
  ED:'Extremo Derecho', EI:'Extremo Izquierdo', DC:'Delantero Centro',
};
const FORMATIONS = {
  '4-3-3':   { POR:1, LD:1, DFC:2, LI:1, MCD:1, MC:2, MCO:0, ED:1, EI:1, DC:1 },
  '4-4-2':   { POR:1, LD:1, DFC:2, LI:1, MCD:0, MC:2, MCO:0, ED:1, EI:1, DC:2 },
  '4-2-3-1': { POR:1, LD:1, DFC:2, LI:1, MCD:2, MC:0, MCO:1, ED:1, EI:1, DC:1 },
  '3-5-2':   { POR:1, LD:0, DFC:3, LI:0, MCD:1, MC:2, MCO:1, ED:1, EI:1, DC:1 },
  '3-4-3':   { POR:1, LD:0, DFC:3, LI:0, MCD:1, MC:2, MCO:0, ED:1, EI:1, DC:2 },
  '4-3-1-2': { POR:1, LD:1, DFC:2, LI:1, MCD:1, MC:2, MCO:1, ED:0, EI:0, DC:2 },
};
const ALL_FORMATIONS = Object.keys(FORMATIONS);

/* ===================== ESTADO ===================== */
const rooms = new Map();
const timers = new Map(); // code -> intervalId (reloj único por sala)

const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIN_PLAYERS = { impostor: 3, mentiroso: 2, subasta: 2, wavelength: 2, who: 2 };

function genCode() {
  let c;
  do { c = ''; for (let i=0;i<4;i++) c += ROOM_CODE_CHARS[Math.floor(Math.random()*ROOM_CODE_CHARS.length)]; }
  while (rooms.has(c));
  return c;
}
function norm(w){ return w.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function shuffle(a){ const r=a.slice(); for(let i=r.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[r[i],r[j]]=[r[j],r[i]];} return r; }
function maxImpostorsFor(n){ return Math.max(1, Math.floor((n-1)/2)); }

function newRoom(code, hostId) {
  return {
    code, hostId,                 // hostId = jugador anfitrión (también juega)
    players: new Map(),
    gameType: null,
    status: 'lobby',
    impostorConfig: { impostorCount: 1, mangaCount: 3, categories: ALL_CATEGORIES.slice() },
    mangaNumber: 0, concept: null, impostorIds: new Set(),
    usedClues: [], clueOrder: [], clueTurnIndex: 0, cluePhaseEnding: false,
    votes: new Map(), roundNumber: 0,
    mentirosoConfig: { roundCount: 5, mode: 'texto', namingSeconds: 15 },
    lie: { roundNumber:0, turnStartIndex:0, category:null, turnOrder:[], currentTurnIndex:0, currentClaim:0, lastClaimerId:null, challenge:null },
    subastaConfig: { budget: 1000, skipLimit: 5, winMode: 'ovr' }, // winMode: 'ovr' | 'votacion'
    subasta: {
      phase:'config', formation:null, formationVotes:new Map(),
      deck:[], currentCardIndex:-1, currentCard:null,
      auctionPhase:null, secondsLeft:0, totalEligible:0,
      bids:new Map(), highestBid:null, playerState:new Map(), resolvedCards:[], rps:null, rpsTimer:null, teams:null, bracket:null,
    },
    waveConfig: { roundCount: 5 },
    wave: {
      roundNumber:0, order:[], orderIndex:0, psychicId:null, pair:null, target:null,
      usedPairIndexes:new Set(), guesses:new Map(), secondsLeft:0, deadlineAt:null,
    },
    whoConfig: { categories: ['futbolista','dt','equipo','selección'] },
    who: {
      order:[], turnIndex:0, turnToken:0, assignments:new Map(), revealed:new Set(), pendingGuess:null,
    },
  };
}

const playersArr = r => [...r.players.values()];
const alive = r => playersArr(r).filter(p=>p.alive);
const connectedAlive = r => alive(r).filter(p=>p.connected);
const connected = r => playersArr(r).filter(p=>p.connected);

function publicPlayers(r){
  return playersArr(r).map(p=>({ id:p.id, name:p.name, score:p.score, alive:p.alive, connected:p.connected, isHost: p.id===r.hostId }));
}

function emitRoom(r){
  io.to(r.code).emit('room:update', {
    code: r.code,
    players: publicPlayers(r),
    status: r.status,
    gameType: r.gameType,
    hostId: r.hostId,
    impostorConfig: r.impostorConfig,
    mentirosoConfig: r.mentirosoConfig,
    subastaConfig: r.subastaConfig,
    waveConfig: r.waveConfig,
    whoConfig: r.whoConfig,
    maxImpostors: maxImpostorsFor(r.players.size),
    minPlayers: r.gameType ? MIN_PLAYERS[r.gameType] : 3,
  });
}

function reassignHostIfNeeded(r){
  if (!r.players.has(r.hostId)) {
    const first = connected(r)[0] || playersArr(r)[0];
    if (first) r.hostId = first.id;
  }
}

// Al reconectarse, el jugador recibe un socket.id nuevo (oldId -> newId).
// Todas las estructuras de juego que guardan referencias a jugadores por id
// (impostores, orden de turnos, votos, pujas de Subasta, bracket...) deben
// actualizarse, o el jugador reconectado "desaparece" de la partida en curso.
function remapPlayerId(r, oldId, newId){
  if (!oldId || oldId===newId) return;
  const swapKey=(map)=>{ if(map?.has(oldId)){ map.set(newId,map.get(oldId)); map.delete(oldId); } };
  const swapArr=(arr)=> Array.isArray(arr) ? arr.map(id=>id===oldId?newId:id) : arr;

  // Impostor
  if (r.impostorIds.has(oldId)){ r.impostorIds.delete(oldId); r.impostorIds.add(newId); }
  r.clueOrder = swapArr(r.clueOrder);
  if (r.votes.has(oldId)){ r.votes.set(newId, r.votes.get(oldId)); r.votes.delete(oldId); }
  for (const [voter,target] of r.votes.entries()) if (target===oldId) r.votes.set(voter,newId);

  // Mentiroso
  r.lie.turnOrder = swapArr(r.lie.turnOrder);
  if (r.lie.lastClaimerId===oldId) r.lie.lastClaimerId=newId;
  const ch=r.lie.challenge;
  if (ch){
    if (ch.accusedId===oldId) ch.accusedId=newId;
    if (ch.accuserId===oldId) ch.accuserId=newId;
    swapKey(ch.finalVotes);
  }

  // Subasta
  const s=r.subasta;
  swapKey(s.formationVotes);
  swapKey(s.playerState);
  swapKey(s.bids);
  if (s.highestBid?.playerId===oldId) s.highestBid.playerId=newId;
  if (s.rps){
    s.rps.players = swapArr(s.rps.players);
    swapKey(s.rps.choices);
  }
  if (s.teams?.has(oldId)){ const t=s.teams.get(oldId); t.id=newId; s.teams.set(newId,t); s.teams.delete(oldId); }
  if (s.bracket){
    const b=s.bracket;
    b.alive = swapArr(b.alive);
    b.eliminated = swapArr(b.eliminated);
    b.byes = swapArr(b.byes);
    b.winnersThisRound = swapArr(b.winnersThisRound);
    if (Array.isArray(b.queue)) b.queue = b.queue.map(pair=>swapArr(pair));
    if (b.currentDuel){
      const d=b.currentDuel;
      if (d.aId===oldId) d.aId=newId;
      if (d.bId===oldId) d.bId=newId;
      swapKey(d.votes);
    }
  }

  // La Frecuencia
  r.wave.order = swapArr(r.wave.order);
  if (r.wave.psychicId===oldId) r.wave.psychicId=newId;
  swapKey(r.wave.guesses);

  // ¿Quién Soy?
  r.who.order = swapArr(r.who.order);
  swapKey(r.who.assignments);
  if (r.who.revealed.has(oldId)){ r.who.revealed.delete(oldId); r.who.revealed.add(newId); }
  if (r.who.pendingGuess?.playerId===oldId) r.who.pendingGuess.playerId=newId;
}

/* ===================== EL IMPOSTOR ===================== */
function startManga(r){
  const pool = CONCEPTS.filter(c=>r.impostorConfig.categories.includes(c.category));
  const usable = pool.length?pool:CONCEPTS;
  r.concept = usable[Math.floor(Math.random()*usable.length)];
  const ids = shuffle([...r.players.keys()]);
  const cnt = Math.min(r.impostorConfig.impostorCount, maxImpostorsFor(r.players.size));
  r.impostorIds = new Set(ids.slice(0,cnt));
  r.usedClues = []; r.roundNumber = 0;
  for (const p of r.players.values()) p.alive = true;
  for (const [id] of r.players.entries()){
    const isI = r.impostorIds.has(id);
    io.to(id).emit('imp:role', { isImpostor:isI, impostorCount:r.impostorIds.size, category:isI?null:r.concept.category, concept:isI?null:r.concept.name });
  }
  emitRoom(r);
  io.to(r.code).emit('imp:manga_started', { mangaNumber:r.mangaNumber, mangaCount:r.impostorConfig.mangaCount, impostorCount:r.impostorIds.size });
  startClue(r);
}
function startClue(r){
  r.status='imp_clue'; r.roundNumber++; r.votes=new Map();
  r.clueOrder = shuffle(alive(r)).map(p=>p.id); r.clueTurnIndex=0;
  io.to(r.code).emit('imp:round', { roundNumber:r.roundNumber, currentTurnPlayerId:r.clueOrder[0]||null });
  advClue(r);
}
function advClue(r){
  while (r.status==='imp_clue' && r.clueTurnIndex<r.clueOrder.length && !r.players.get(r.clueOrder[r.clueTurnIndex])?.connected) r.clueTurnIndex++;
  if (r.status==='imp_clue' && r.clueTurnIndex>=r.clueOrder.length) endClue(r);
  else if (r.status==='imp_clue') io.to(r.code).emit('imp:turn', { currentTurnPlayerId:r.clueOrder[r.clueTurnIndex] });
}
function endClue(r){
  if (r.cluePhaseEnding) return;
  r.cluePhaseEnding = true;
  io.to(r.code).emit('imp:clue_phase_ending');
  setTimeout(()=>{ r.cluePhaseEnding=false; if(r.status==='imp_clue') startVote(r); }, 4500);
}
function startVote(r){
  r.status='imp_vote'; r.votes=new Map();
  io.to(r.code).emit('imp:voting', { candidates: alive(r).map(p=>({id:p.id,name:p.name})) });
}
function resolveVotes(r){
  const tally=new Map();
  for (const t of r.votes.values()) tally.set(t,(tally.get(t)||0)+1);
  let mx=0; for (const c of tally.values()) mx=Math.max(mx,c);
  const top=[...tally.entries()].filter(([,c])=>c===mx).map(([id])=>id);
  if (top.length!==1){ io.to(r.code).emit('imp:tie',{tiedPlayers:top.map(id=>r.players.get(id)?.name)}); setTimeout(()=>startClue(r),4000); return; }
  const elId=top[0], el=r.players.get(elId); el.alive=false;
  const wasI=r.impostorIds.has(elId);
  const voters=[...r.votes.entries()].filter(([,t])=>r.impostorIds.has(t)).map(([v])=>v);
  io.to(r.code).emit('imp:elimination',{eliminatedName:el.name,wasImpostor:wasI});
  r.status='imp_reveal';
  const aliveI=alive(r).filter(p=>r.impostorIds.has(p.id));
  const aliveInn=alive(r).length-aliveI.length;
  if (aliveI.length===0){ setTimeout(()=>endManga(r,'impostors_caught',voters),3500); return; }
  if (aliveI.length>=aliveInn){ setTimeout(()=>endManga(r,'impostors_win',[]),3500); return; }
  aliveI.forEach(i=>i.score++);
  setTimeout(()=>startClue(r),3500);
}
function endManga(r,result,voters){
  r.status='imp_manga_over';
  const names=[...r.impostorIds].map(id=>r.players.get(id)?.name).filter(Boolean);
  if (result==='impostors_caught'){ for(const p of r.players.values()){ if(r.impostorIds.has(p.id))continue; p.score++; if(voters.includes(p.id))p.score++; } }
  else if (result==='impostors_win'){ for(const id of r.impostorIds){const p=r.players.get(id); if(p?.alive)p.score+=3;} }
  const isLast=r.mangaNumber>=r.impostorConfig.mangaCount;
  io.to(r.code).emit('imp:manga_over',{ result, concept:r.concept, impostorNames:names, mangaNumber:r.mangaNumber, mangaCount:r.impostorConfig.mangaCount, isLastManga:isLast, scores:publicPlayers(r).sort((a,b)=>b.score-a.score) });
}

/* ===================== MENTIROSO ===================== */
function startLieSession(r){ r.lie.roundNumber=0; r.lie.turnStartIndex=0; startLieRound(r); }
function startLieRound(r){
  r.lie.roundNumber++;
  r.lie.category=LIE_CATEGORIES[Math.floor(Math.random()*LIE_CATEGORIES.length)];
  const ids=[...r.players.keys()]; const st=r.lie.turnStartIndex%ids.length;
  r.lie.turnOrder=[...ids.slice(st),...ids.slice(0,st)];
  r.lie.turnStartIndex=(r.lie.turnStartIndex+1)%ids.length;
  r.lie.currentTurnIndex=0; r.lie.currentClaim=0; r.lie.lastClaimerId=null;
  clearLieTimer(r); r.lie.challenge=null; r.status='lie_claim';
  emitRoom(r);
  io.to(r.code).emit('lie:round',{ roundNumber:r.lie.roundNumber, roundCount:r.mentirosoConfig.roundCount, category:r.lie.category, mode:r.mentirosoConfig.mode, currentTurnPlayerId:lieTurnId(r) });
}
const lieTurnId = r => r.lie.turnOrder[r.lie.currentTurnIndex]||null;
function advLie(r){
  const o=r.lie.turnOrder; if(!o.length)return; let t=0;
  do{ r.lie.currentTurnIndex=(r.lie.currentTurnIndex+1)%o.length; t++; } while(!r.players.get(o[r.lie.currentTurnIndex])?.connected && t<=o.length);
  io.to(r.code).emit('lie:turn',{currentTurnPlayerId:lieTurnId(r)});
}
function clearLieTimer(r){ if(r.lie.challenge?.timeoutHandle){clearTimeout(r.lie.challenge.timeoutHandle);r.lie.challenge.timeoutHandle=null;} }
function restartLieTimer(r){
  clearLieTimer(r); const ch=r.lie.challenge; if(!ch)return null;
  const dur=(r.mentirosoConfig.namingSeconds||15)*1000;
  ch.deadlineAt=Date.now()+dur;
  ch.timeoutHandle=setTimeout(()=>{ if(r.status==='lie_naming'&&r.lie.challenge===ch) resolveLie(r,false,'timeout'); },dur);
  return ch.deadlineAt;
}
// Pausa/reanuda el reloj de "nombrar respuestas". Solo lo puede tocar quien
// acuso, por si quiere frenar el tiempo para verificar en vivo si una
// respuesta dicha en voz alta es correcta antes de que se acabe el tiempo.
function pauseLieTimer(r){
  const ch=r.lie.challenge; if(!ch||ch.paused)return;
  clearLieTimer(r);
  ch.remainingMs=Math.max(0,(ch.deadlineAt||Date.now())-Date.now());
  ch.deadlineAt=null; ch.paused=true;
}
function resumeLieTimer(r){
  const ch=r.lie.challenge; if(!ch||!ch.paused)return null;
  ch.paused=false;
  const dur=ch.remainingMs??((r.mentirosoConfig.namingSeconds||15)*1000);
  ch.deadlineAt=Date.now()+dur;
  ch.timeoutHandle=setTimeout(()=>{ if(r.status==='lie_naming'&&r.lie.challenge===ch) resolveLie(r,false,'timeout'); },dur);
  return ch.deadlineAt;
}
function toFinalVote(r){
  clearLieTimer(r); const ch=r.lie.challenge; r.status='lie_final_vote'; ch.finalVotes=new Map();
  const elig=connected(r).filter(p=>p.id!==ch.accusedId);
  io.to(r.code).emit('lie:final_vote',{ target:ch.target, mode:r.mentirosoConfig.mode, namedSoFar:r.mentirosoConfig.mode==='texto'?ch.namedSoFar:null, votesNeeded:elig.length, eligibleVoterIds:elig.map(p=>p.id) });
}
function resolveLie(r,success,reason){
  clearLieTimer(r); const ch=r.lie.challenge; if(!ch)return;
  const accused=r.players.get(ch.accusedId), accuser=r.players.get(ch.accuserId);
  if(success){ if(accused)accused.score++; if(accuser)accuser.score--; }
  else { if(accuser)accuser.score++; if(accused)accused.score--; }
  r.status='lie_round_over';
  const isLast=r.lie.roundNumber>=r.mentirosoConfig.roundCount;
  io.to(r.code).emit('lie:resolved',{ success, reason:reason||(success?'completed':'rejected'), accusedName:accused?.name||'?', accuserName:accuser?.name||'?', category:r.lie.category, target:ch.target, count:ch.count, namedSoFar:ch.namedSoFar, mode:r.mentirosoConfig.mode, roundNumber:r.lie.roundNumber, roundCount:r.mentirosoConfig.roundCount, isLastRound:isLast, scores:publicPlayers(r).sort((a,b)=>b.score-a.score) });
}

/* ===================== SUBASTA ===================== */
const ANALYSIS_S=8, BIDDING_S=10, EXT_S=5, FORMATION_S=45;
function clearSubTimer(r){ if(timers.has(r.code)){clearInterval(timers.get(r.code));timers.delete(r.code);} }
function subPlayerState(budget,skip){ const t={}; for(const p of POSITION_ORDER)t[p]=[]; return {budget,skipsLeft:skip,team:t,mediaSum:0}; }
// Pesos de aparición por rareza. Mayor peso = sale más seguido.
const RAREZA_PESO = { mediano: 12, top: 6, leyenda: 2, troll: 1.5 };
// Selección ponderada SIN reemplazo: saca 'cuantas' cartas del pool dando más
// probabilidad a las comunes (medianos) y menos a las raras (leyendas/trolls).
function weightedSample(pool, cuantas){
  const items = pool.map(c => ({ c, w: RAREZA_PESO[c.rareza] || 5 }));
  const out = [];
  for(let n=0; n<cuantas && items.length>0; n++){
    const total = items.reduce((a,it)=>a+it.w, 0);
    let r = Math.random()*total;
    let idx = 0;
    for(let i=0;i<items.length;i++){ r-=items[i].w; if(r<=0){ idx=i; break; } }
    out.push(items[idx].c);
    items.splice(idx,1); // sin reemplazo
  }
  return out;
}
function buildDeck(r){
  const slots=FORMATIONS[r.subasta.formation], pc=r.players.size, pool={};
  for(const p of POSITION_ORDER)pool[p]=[];
  for(const c of SUBASTA_CARDS) if(pool[c.position])pool[c.position].push(c);
  const deck=[];
  for(const pos of POSITION_ORDER){
    const needPerPlayer=slots[pos]||0;
    if(!needPerPlayer)continue;
    const minimo = needPerPlayer * pc;
    const conColchon = minimo + Math.ceil(minimo*0.5) + 2;
    const cuantas = Math.min(conColchon, pool[pos].length);
    // Selección ponderada por rareza (medianos más probables, leyendas/trolls menos)
    deck.push(...weightedSample(pool[pos], cuantas));
  }
  return deck.map(c=>({ ...c, startingPrice: 10 + Math.floor(Math.random()*141) }));
}
// ¿Algún jugador todavía necesita (y podría llegar a llenar) esta posición?
function someoneNeedsPosition(r, pos){
  const slots=FORMATIONS[r.subasta.formation];
  for(const [pid] of r.players.entries()){
    const ps=r.subasta.playerState.get(pid);
    if(ps && ps.team[pos].length < slots[pos]) return true;
  }
  return false;
}
// Avanza a la siguiente carta ÚTIL: salta las de posiciones que TODOS ya completaron.
function advanceToNextUsefulCard(r){
  const s=r.subasta;
  let idx=s.currentCardIndex+1;
  while(idx < s.deck.length){
    const pos=s.deck[idx].position;
    if(someoneNeedsPosition(r,pos)){ s.currentCardIndex=idx; showCard(r); return; }
    idx++; // nadie necesita esta posición: saltarla
  }
  // No quedan cartas útiles: termina la subasta
  endSubasta(r);
}
function showCard(r){
  const s=r.subasta, card=s.deck[s.currentCardIndex];
  if(!card){console.error('[Subasta] sin carta',s.currentCardIndex);return;}
  clearSubTimer(r);
  s.currentCard=card; s.bids=new Map(); s.highestBid=null; s.auctionPhase='analysis'; s.secondsLeft=ANALYSIS_S;
  const slots=FORMATIONS[s.formation]; let elig=0;
  for(const [pid] of r.players.entries()){
    const ps=s.playerState.get(pid);
    if(!ps){s.bids.set(pid,{amount:null,skip:false,eligible:false,responded:true});continue;}
    const need=ps.team[card.position].length<slots[card.position];
    const afford=ps.budget>=card.startingPrice;
    const e=need&&afford;
    s.bids.set(pid,{amount:null,skip:false,eligible:e,responded:!e});
    if(e)elig++;
  }
  r.status='subasta_play'; s.totalEligible=elig;
  for(const [pid,bid] of s.bids.entries())
    io.to(pid).emit('sub:eligibility',{ eligible:bid.eligible, skipsLeft:s.playerState.get(pid)?.skipsLeft??0 });
  io.to(r.code).emit('sub:card',{ cardIndex:s.currentCardIndex, totalCards:s.deck.length, cardId:card.id, position:card.position, positionLabel:POSITION_LABELS[card.position], startingPrice:card.startingPrice, phase:'analysis', secondsLeft:s.secondsLeft, totalEligible:elig });
  startSubClock(r);
}
function subSnapshot(r){
  const s=r.subasta, card=s.currentCard; if(!card)return null;
  return { cardIndex:s.currentCardIndex, totalCards:s.deck.length, position:card.position, positionLabel:POSITION_LABELS[card.position], startingPrice:card.startingPrice, phase:s.auctionPhase, secondsLeft:s.secondsLeft, highestBid:s.highestBid, totalEligible:s.totalEligible };
}
function startSubClock(r){
  clearSubTimer(r); const code=r.code;
  const iv=setInterval(()=>{
    const room=rooms.get(code);
    if(!room||room.status!=='subasta_play'){clearInterval(iv);timers.delete(code);return;}
    const s=room.subasta; s.secondsLeft--;
    // 'volatile': si un cliente está atrasado, descarta los ticks viejos en lugar de
    // encolarlos. Así las pujas (no volatile) no se atascan detrás de una pila de ticks.
    io.to(code).volatile.emit('sub:tick',{phase:s.auctionPhase,secondsLeft:Math.max(0,s.secondsLeft)});
    if(s.secondsLeft<=0){
      if(s.auctionPhase==='analysis'){
        s.auctionPhase='bidding'; s.secondsLeft=BIDDING_S;
        // Emitir a CADA jugador su elegibilidad junto con la apertura de puja.
        // Así no depende del orden en que llegaron eventos anteriores.
        for(const [pid,bid] of s.bids.entries()){
          io.to(pid).emit('sub:bidding_open',{ secondsLeft:s.secondsLeft, eligible:bid.eligible, skipsLeft:s.playerState.get(pid)?.skipsLeft??0 });
        }
      } else {
        clearInterval(iv); timers.delete(code);
        try{ resolveCard(room); }catch(e){console.error('[Subasta]',e);}
      }
    }
  },1000);
  timers.set(code,iv);
}
function checkAllResponded(r){ for(const b of r.subasta.bids.values()) if(b.eligible&&!b.responded)return false; return true; }
function resolveCard(r){
  if(r.status!=='subasta_play')return;
  clearSubTimer(r);
  const s=r.subasta, card=s.currentCard, bids=s.bids;
  const valid=[], noResp=[];
  for(const [pid,b] of bids.entries()){
    if(!b.eligible)continue;       // no elegible (posición cubierta o sin presupuesto): fuera
    if(b.skip)continue;            // skip = renuncia TOTAL: nunca se lleva la carta, ni va a PPT
    if(b.amount!==null&&b.amount>=card.startingPrice) valid.push({playerId:pid,amount:b.amount});
    else noResp.push(pid);         // elegible, no skipeó, pero no llegó a pujar (sin tiempo)
  }
  let result;
  if(valid.length>0){
    // Hubo pujas: gana la más alta
    const mx=Math.max(...valid.map(b=>b.amount));
    const tied=valid.filter(b=>b.amount===mx);
    const w=tied[Math.floor(Math.random()*tied.length)];
    assignCard(r,w.playerId,w.amount); result={type:'bid',winnerId:w.playerId,amount:w.amount};
    finishResolveCard(r,card,result);
  } else if(noResp.length>=2){
    // Nadie pujó, pero 2+ elegibles NO skipearon: piedra-papel-tijera entre ellos.
    startRPS(r,noResp,card);
    return; // se resuelve async tras el PPT
  } else if(noResp.length===1){
    // Solo un elegible no skipeó ni pujó: se la lleva forzado al precio inicial.
    assignCard(r,noResp[0],card.startingPrice); result={type:'forced',winnerId:noResp[0],amount:card.startingPrice};
    finishResolveCard(r,card,result);
  } else {
    // Todos los elegibles skipearon (o no había elegibles): la carta se DESCARTA.
    result={type:'discard'};
    finishResolveCard(r,card,result);
  }
}

function startRPS(r,playerIds,card){
  const s=r.subasta;
  // Si hay más de 2 candidatos, elegir 2 al azar para competir; el resto queda fuera.
  let contenders=playerIds;
  if(playerIds.length>2){ contenders=shuffle(playerIds).slice(0,2); }
  s.rps={ card, players:contenders, choices:new Map() };
  r.status='subasta_rps';
  io.to(r.code).emit('sub:rps_start',{
    playerIds:contenders, playerNames:contenders.map(id=>r.players.get(id)?.name),
    positionLabel:POSITION_LABELS[card.position],
  });
  // Por si alguien no elige en 12s, elegir aleatorio por él
  s.rpsTimer=setTimeout(()=>resolveRPS(r),12000);
}

function resolveRPS(r){
  const s=r.subasta;
  if(s.rpsTimer){clearTimeout(s.rpsTimer);s.rpsTimer=null;}
  if(!s.rps)return;
  const { card, players:ids, choices } = s.rps;
  const opts=['piedra','papel','tijera'];
  // Rellenar elecciones faltantes al azar
  for(const id of ids) if(!choices.has(id)) choices.set(id,opts[Math.floor(Math.random()*3)]);

  // Determinar PERDEDOR. Jugamos rondas: el que pierde contra todos / queda último.
  // Mecánica simple para N jugadores: contar "derrotas" de cada quien y el de más derrotas pierde.
  // Si hay empate de derrotas, se repite el PPT entre los empatados.
  const beats={ piedra:'tijera', papel:'piedra', tijera:'papel' }; // beats[a]=b → a le gana a b
  const losses=new Map(); ids.forEach(id=>losses.set(id,0));
  for(let i=0;i<ids.length;i++) for(let j=0;j<ids.length;j++){
    if(i===j)continue;
    const a=choices.get(ids[i]), b=choices.get(ids[j]);
    if(beats[a]===b) losses.set(ids[j],losses.get(ids[j])+1); // a le gana a b → b pierde
  }
  let maxL=-1; for(const v of losses.values())maxL=Math.max(maxL,v);
  const losers=ids.filter(id=>losses.get(id)===maxL);

  const choiceMap={}; ids.forEach(id=>choiceMap[r.players.get(id)?.name]=choices.get(id));

  if(losers.length===1){
    // Hay un perdedor claro: se queda con la carta al precio inicial
    assignCard(r,losers[0],card.startingPrice);
    const result={type:'rps',winnerId:losers[0],amount:card.startingPrice,choices:choiceMap};
    io.to(r.code).emit('sub:rps_result',{ choices:choiceMap, loserName:r.players.get(losers[0])?.name, decided:true });
    r.status='subasta_play'; // restaurar para finishResolveCard
    setTimeout(()=>finishResolveCard(r,card,result),2500);
  } else {
    // Empate: repetir PPT solo entre los empatados
    io.to(r.code).emit('sub:rps_result',{ choices:choiceMap, decided:false });
    setTimeout(()=>{ if(rooms.get(r.code)) startRPS(r,losers,card); },2500);
  }
}

function finishResolveCard(r,card,result){
  const s=r.subasta;
  r.status='subasta_card_result'; s.resolvedCards.push({card,result}); s.rps=null;
  const bidLog=[];
  for(const [pid,b] of s.bids.entries()){
    const nm=r.players.get(pid)?.name; if(!nm||!b.eligible)continue;
    bidLog.push({name:nm, action:b.skip?'skip':b.amount!==null?`$${b.amount}M`:'sin pujar', isWinner:result.winnerId===pid});
  }
  bidLog.sort((a,b)=>(b.isWinner?1:0)-(a.isWinner?1:0));
  io.to(r.code).emit('sub:card_resolved',{ cardId:card.id, cardName:card.name, cardLabel:card.label, cardPosition:card.position, positionLabel:POSITION_LABELS[card.position], cardTroll:card.troll, result, winnerName:result.winnerId?r.players.get(result.winnerId)?.name:null, bidLog, isLastCard:s.currentCardIndex>=s.deck.length-1 });
}
function assignCard(r,pid,amount){
  const s=r.subasta, card=s.currentCard, ps=s.playerState.get(pid); if(!ps)return;
  ps.budget-=amount; ps.team[card.position].push({cardId:card.id,amountPaid:amount}); ps.mediaSum+=card.media;
}
function buildTeams(r){
  // Devuelve un Map pid -> { name, cards:[{name,position,positionLabel,media,...}], ovr }
  const s=r.subasta;
  const teamCards=new Map(); for(const [pid] of r.players.entries())teamCards.set(pid,[]);
  for(const {card,result} of s.resolvedCards){
    if(result.winnerId&&teamCards.has(result.winnerId))
      teamCards.get(result.winnerId).push({cardId:card.id,name:card.name,label:card.label,position:card.position,positionLabel:POSITION_LABELS[card.position],media:card.media,amountPaid:result.amount,troll:card.troll});
  }
  const teams=new Map();
  for(const [pid,ps] of s.playerState.entries()){
    const pl=r.players.get(pid); if(!pl)continue;
    const cards=teamCards.get(pid)||[];
    // Sin redondear: el promedio exacto define al ganador. Redondear aca
    // generaba empates artificiales que en realidad no existian.
    // Se divide siempre entre 11 (una formacion completa), no entre la
    // cantidad de cartas ganadas: un puesto vacio por mal manejo del
    // presupuesto debe pesar como 0, no quedar afuera del promedio.
    const ovr=cards.reduce((a,c)=>a+c.media,0)/11;
    teams.set(pid,{id:pid,name:pl.name,cards,ovr,budgetLeft:ps.budget});
  }
  return teams;
}
function endSubasta(r){
  const s=r.subasta;
  s.teams=buildTeams(r);
  if(r.subastaConfig.winMode==='votacion' && s.teams.size>=2){
    startTournament(r);
  } else {
    finishSubastaOVR(r);
  }
}
function finishSubastaOVR(r){
  r.subasta.phase='over'; r.status='subasta_over';
  const s=r.subasta;
  const scores=[...s.teams.values()].map(t=>({id:t.id,name:t.name,ovr:t.ovr,totalMedia:t.cards.reduce((a,c)=>a+c.media,0),budgetLeft:t.budgetLeft,cards:t.cards}));
  scores.sort((a,b)=>b.ovr-a.ovr || b.totalMedia-a.totalMedia);
  scores.forEach((sc,i)=>{ const p=r.players.get(sc.id); if(p)p.score+=Math.max(0,scores.length-i); });
  io.to(r.code).emit('sub:game_over',{mode:'ovr',scores,formation:s.formation});
}

/* ===== TORNEO DE BRACKETS (modo votación) ===== */
function startTournament(r){
  const s=r.subasta;
  r.status='subasta_tournament';
  // Lista de equipos ordenada por OVR (para asignar byes al mejor)
  s.bracket={ alive:[...s.teams.keys()], round:1, currentDuel:null, eliminated:[] };
  io.to(r.code).emit('sub:tournament_start',{
    teams:[...s.teams.values()].map(t=>({id:t.id,name:t.name,ovr:t.ovr})),
  });
  setTimeout(()=>nextDuelOrAdvance(r),3000);
}
function nextDuelOrAdvance(r){
  const s=r.subasta, b=s.bracket; if(!b)return;
  if(b.alive.length===1){ finishTournament(r,b.alive[0]); return; }
  // Emparejar: ordenar vivos por OVR; si impares, el mejor OVR recibe bye
  const aliveSorted=b.alive.slice().sort((x,y)=>s.teams.get(y).ovr-s.teams.get(x).ovr);
  if(!b.queue || b.queue.length===0){
    // Construir la cola de duelos para esta ronda
    let contenders=aliveSorted.slice();
    b.byes=[];
    if(contenders.length%2===1){ b.byes.push(contenders.shift()); } // el mejor OVR pasa directo
    b.queue=[];
    for(let i=0;i<contenders.length;i+=2) b.queue.push([contenders[i],contenders[i+1]]);
    b.winnersThisRound=[...b.byes];
    if(b.byes.length){
      io.to(r.code).emit('sub:tournament_bye',{ name:s.teams.get(b.byes[0]).name, ovr:s.teams.get(b.byes[0]).ovr, round:b.round });
    }
  }
  if(b.queue.length===0){
    // Terminó la ronda: los ganadores pasan a la siguiente
    b.alive=b.winnersThisRound.slice();
    b.round++; b.queue=null;
    if(b.alive.length===1){ finishTournament(r,b.alive[0]); return; }
    io.to(r.code).emit('sub:tournament_round',{round:b.round, remaining:b.alive.map(id=>s.teams.get(id).name)});
    setTimeout(()=>nextDuelOrAdvance(r),3000);
    return;
  }
  // Tomar el siguiente duelo de la cola
  const [aId,bId]=b.queue.shift();
  startDuel(r,aId,bId);
}
function startDuel(r,aId,bId){
  const s=r.subasta, b=s.bracket;
  const teamA=s.teams.get(aId), teamB=s.teams.get(bId);
  // Posiciones a comparar: las de la formación, en orden
  const slots=FORMATIONS[s.formation];
  const positions=[];
  for(const pos of POSITION_ORDER){ const n=slots[pos]||0; for(let k=0;k<n;k++) positions.push({pos,idx:k}); }
  b.currentDuel={ aId, bId, positions, posIndex:0, votesA:0, votesB:0, posResults:[], votes:new Map() };
  io.to(r.code).emit('sub:duel_start',{ aId, bId, aName:teamA.name, bName:teamB.name, round:b.round, totalPositions:positions.length });
  setTimeout(()=>nextDuelPosition(r),2500);
}
function nextDuelPosition(r){
  const s=r.subasta, b=s.bracket, d=b.currentDuel; if(!d)return;
  if(d.posIndex>=d.positions.length){ finishDuel(r); return; }
  const {pos,idx}=d.positions[d.posIndex];
  const teamA=s.teams.get(d.aId), teamB=s.teams.get(d.bId);
  const cardA=cardAtPosition(teamA,pos,idx), cardB=cardAtPosition(teamB,pos,idx);
  d.votes=new Map(); d.currentCardA=cardA; d.currentCardB=cardB;
  r.status='subasta_duel_vote';
  // Votan solo los neutrales (ni dueño A ni dueño B). Si no hay neutrales, decide el OVR de la posición.
  const voters=[...r.players.keys()].filter(pid=>pid!==d.aId&&pid!==d.bId&&r.players.get(pid)?.connected);
  io.to(r.code).emit('sub:duel_position',{
    position:pos, positionLabel:POSITION_LABELS[pos],
    aName:teamA.name, bName:teamB.name,
    aCard:cardA?{name:cardA.name,cardId:cardA.cardId}:null,
    bCard:cardB?{name:cardB.name,cardId:cardB.cardId}:null,
    posIndex:d.posIndex+1, totalPositions:d.positions.length,
    voterIds:voters,
  });
  if(voters.length===0){ // nadie neutral: decide la media
    setTimeout(()=>{ autoResolvePosition(r); },1500);
  }
}
function cardAtPosition(team,pos,idx){ const inPos=team.cards.filter(c=>c.position===pos); return inPos[idx]||null; }
function autoResolvePosition(r){
  const d=r.subasta.bracket.currentDuel; if(!d)return;
  const ma=d.currentCardA?d.currentCardA.media:0, mb=d.currentCardB?d.currentCardB.media:0;
  if(ma>=mb)d.votesA++; else d.votesB++;
  revealPosition(r, ma>=mb?'A':'B', 0, 0);
}
function revealPosition(r,winner,va,vb){
  const s=r.subasta, b=s.bracket, d=b.currentDuel;
  d.posResults.push({ position:d.positions[d.posIndex].pos, winner, mediaA:d.currentCardA?.media??0, mediaB:d.currentCardB?.media??0 });
  io.to(r.code).emit('sub:duel_position_result',{
    winner, votesA:va, votesB:vb,
    mediaA:d.currentCardA?d.currentCardA.media:null, mediaB:d.currentCardB?d.currentCardB.media:null,
    aName:s.teams.get(d.aId).name, bName:s.teams.get(d.bId).name,
    scoreA:d.votesA, scoreB:d.votesB,
  });
  d.posIndex++;
  setTimeout(()=>nextDuelPosition(r),3500);
}
function finishDuel(r){
  const s=r.subasta, b=s.bracket, d=b.currentDuel;
  let winnerId;
  if(d.votesA>d.votesB) winnerId=d.aId;
  else if(d.votesB>d.votesA) winnerId=d.bId;
  else { // empate en posiciones ganadas: decide OVR
    const ovrA=s.teams.get(d.aId).ovr, ovrB=s.teams.get(d.bId).ovr;
    if(ovrA>ovrB)winnerId=d.aId; else if(ovrB>ovrA)winnerId=d.bId;
    else winnerId=Math.random()<0.5?d.aId:d.bId; // empate total: azar (PPT simplificado)
  }
  const loserId = winnerId===d.aId?d.bId:d.aId;
  b.winnersThisRound.push(winnerId);
  b.eliminated.push(loserId);
  io.to(r.code).emit('sub:duel_result',{
    winnerName:s.teams.get(winnerId).name, loserName:s.teams.get(loserId).name,
    scoreA:d.votesA, scoreB:d.votesB, aName:s.teams.get(d.aId).name, bName:s.teams.get(d.bId).name,
  });
  b.currentDuel=null;
  setTimeout(()=>nextDuelOrAdvance(r),4000);
}
function finishTournament(r,championId){
  const s=r.subasta; s.phase='over'; r.status='subasta_over';
  const champion=s.teams.get(championId);
  // Puntos: campeón gana más; el resto por orden de eliminación inverso
  const order=[championId, ...s.bracket.eliminated.slice().reverse().filter(id=>id!==championId)];
  order.forEach((id,i)=>{ const p=r.players.get(id); if(p)p.score+=Math.max(0,order.length-i); });
  const scores=order.map(id=>{ const t=s.teams.get(id); return {id,name:t.name,ovr:t.ovr,cards:t.cards}; });
  io.to(r.code).emit('sub:game_over',{mode:'votacion',championName:champion.name,scores,formation:s.formation});
}
function startFormationVote(r){
  const s=r.subasta; s.phase='formation_vote'; s.formationVotes=new Map(); r.status='subasta_formation';
  s.formationSecondsLeft=FORMATION_S;
  emitRoom(r);
  io.to(r.code).emit('sub:formation_vote',{formations:ALL_FORMATIONS,secondsLeft:s.formationSecondsLeft});
  startFormationClock(r);
}
function startFormationClock(r){
  clearSubTimer(r); const code=r.code;
  const iv=setInterval(()=>{
    const room=rooms.get(code);
    if(!room||room.status!=='subasta_formation'){clearInterval(iv);timers.delete(code);return;}
    const s=room.subasta; s.formationSecondsLeft--;
    io.to(code).volatile.emit('sub:formation_tick',{secondsLeft:Math.max(0,s.formationSecondsLeft)});
    if(s.formationSecondsLeft<=0){ clearInterval(iv); timers.delete(code); resolveFormationVote(room); }
  },1000);
  timers.set(code,iv);
}
function resolveFormationVote(r){
  const s=r.subasta; clearSubTimer(r);
  if (s.phase!=='formation_vote') return;
  const tally=new Map();
  for(const f of s.formationVotes.values())tally.set(f,(tally.get(f)||0)+1);
  let mx=0; for(const v of tally.values())mx=Math.max(mx,v);
  const top=[...tally.keys()].filter(f=>tally.get(f)===mx);
  s.formation = top.length?top[Math.floor(Math.random()*top.length)]:ALL_FORMATIONS[Math.floor(Math.random()*ALL_FORMATIONS.length)];
  s.phase='auction';
  io.to(r.code).emit('sub:formation_decided',{formation:s.formation});
  for(const [pid] of r.players.entries()) s.playerState.set(pid,subPlayerState(r.subastaConfig.budget,r.subastaConfig.skipLimit));
  s.deck=buildDeck(r); s.currentCardIndex=0;
  setTimeout(()=>showCard(r),1500);
}

/* ===================== LA FRECUENCIA (estilo Wavelength) ===================== */
const WAVE_GUESS_S = 45;
// Bandas de puntaje segun que tan cerca cayo la aguja (escala 0-100) del centro de la zona objetivo.
function waveScore(target, guess){
  const d = Math.abs(target - guess);
  if (d <= 4) return 4;
  if (d <= 9) return 3;
  if (d <= 16) return 2;
  return 0;
}
function startWaveSession(r){
  r.wave.roundNumber=0; r.wave.order=shuffle([...r.players.keys()]); r.wave.orderIndex=0; r.wave.usedPairIndexes=new Set();
  startWaveRound(r);
}
function pickWavePair(r){
  if (r.wave.usedPairIndexes.size>=WAVE_PAIRS.length) r.wave.usedPairIndexes=new Set();
  let idx;
  do { idx=Math.floor(Math.random()*WAVE_PAIRS.length); } while (r.wave.usedPairIndexes.has(idx));
  r.wave.usedPairIndexes.add(idx);
  return WAVE_PAIRS[idx];
}
function startWaveRound(r){
  clearSubTimer(r);
  r.wave.order = r.wave.order.filter(id=>r.players.has(id));
  if(!r.wave.order.length) r.wave.order=[...r.players.keys()];
  if(!r.wave.order.length) return;
  r.wave.roundNumber++;
  r.wave.psychicId = r.wave.order[r.wave.orderIndex % r.wave.order.length];
  r.wave.orderIndex++;
  r.wave.pair = pickWavePair(r);
  r.wave.target = 10 + Math.floor(Math.random()*81); // 10..90, deja margen para que las bandas no se corten
  r.wave.guesses = new Map();
  r.status='wave_psychic';
  const psy=r.players.get(r.wave.psychicId);
  io.to(r.code).emit('wave:round', {
    roundNumber:r.wave.roundNumber, roundCount:r.waveConfig.roundCount,
    left:r.wave.pair.left, right:r.wave.pair.right,
    psychicId:r.wave.psychicId, psychicName:psy?psy.name:'?',
  });
}
function startWaveGuessing(r){
  r.status='wave_guessing'; r.wave.guesses=new Map();
  r.wave.secondsLeft=WAVE_GUESS_S; r.wave.deadlineAt=Date.now()+WAVE_GUESS_S*1000;
  io.to(r.code).emit('wave:guessing_start', { secondsLeft:r.wave.secondsLeft, left:r.wave.pair.left, right:r.wave.pair.right });
  startWaveClock(r);
}
function startWaveClock(r){
  clearSubTimer(r); const code=r.code;
  const iv=setInterval(()=>{
    const room=rooms.get(code);
    if(!room||room.status!=='wave_guessing'){clearInterval(iv);timers.delete(code);return;}
    room.wave.secondsLeft--;
    io.to(code).volatile.emit('wave:tick',{secondsLeft:Math.max(0,room.wave.secondsLeft)});
    if(room.wave.secondsLeft<=0){ clearInterval(iv); timers.delete(code); resolveWaveRound(room); }
  },1000);
  timers.set(code,iv);
}
const waveEligibleGuessers = r => playersArr(r).filter(p=>p.id!==r.wave.psychicId);
function checkAllWaveLocked(r){
  const elig = waveEligibleGuessers(r).filter(p=>p.connected);
  return elig.length===0 || elig.every(p=>r.wave.guesses.has(p.id));
}
function resolveWaveRound(r){
  clearSubTimer(r);
  const guessersAll = waveEligibleGuessers(r);
  // A quien no llego a bloquear (se le acabo el tiempo) se le pone el centro por defecto.
  for(const p of guessersAll) if(!r.wave.guesses.has(p.id)) r.wave.guesses.set(p.id,50);
  const results=[]; let sum=0;
  for(const p of guessersAll){
    const value=r.wave.guesses.get(p.id);
    const score=waveScore(r.wave.target,value);
    sum+=score; p.score+=score;
    results.push({id:p.id,name:p.name,value,score});
  }
  const psychicScore = guessersAll.length ? Math.round(sum/guessersAll.length) : 0;
  const psy=r.players.get(r.wave.psychicId);
  if(psy) psy.score+=psychicScore;
  r.status='wave_reveal';
  const isLast = r.wave.roundNumber>=r.waveConfig.roundCount;
  io.to(r.code).emit('wave:reveal', {
    target:r.wave.target, left:r.wave.pair.left, right:r.wave.pair.right,
    psychicId:r.wave.psychicId, psychicName:psy?psy.name:'?', psychicScore,
    guesses:results, roundNumber:r.wave.roundNumber, roundCount:r.waveConfig.roundCount,
    isLastRound:isLast, scores:publicPlayers(r).sort((a,b)=>b.score-a.score),
  });
}

/* ===================== ¿QUIÉN SOY? ===================== */
// Sin timers: el juego avanza turno a turno, una accion por vez.
function startWhoSession(r){
  const pool = shuffle(CONCEPTS.filter(c=>r.whoConfig.categories.includes(c.category)));
  const usable = pool.length ? pool : shuffle(CONCEPTS.filter(c=>c.category==='futbolista'||c.category==='dt'));
  const ids = [...r.players.keys()];
  r.who.assignments = new Map();
  ids.forEach((id,i)=> r.who.assignments.set(id, usable[i % usable.length]));
  r.who.order = shuffle(ids);
  r.who.turnIndex = 0; r.who.turnToken = 0;
  r.who.revealed = new Set(); r.who.pendingGuess = null;
  r.status = 'who_turn';
  emitWhoState(r);
}
const whoActiveId = r => r.who.order.length ? r.who.order[r.who.turnIndex % r.who.order.length] : null;
const whoRemaining = r => playersArr(r).filter(p=>!r.who.revealed.has(p.id));
// Le manda a cada jugador su propia vista del tablero: todas las cartas menos
// la suya (oculta hasta que la adivine). Igual que el reparto de roles de Impostor.
function whoStateFor(r, pid){
  const activeId = whoActiveId(r);
  const activeName = r.players.get(activeId)?.name || '?';
  const cards = playersArr(r).map(p=>{
    const mine = p.id===pid;
    const revealed = r.who.revealed.has(p.id);
    const assign = r.who.assignments.get(p.id);
    if(mine && !revealed) return { id:p.id, name:p.name, hidden:true };
    return { id:p.id, name:p.name, hidden:false, identity:assign?.name, category:assign?.category };
  });
  return { cards, activePlayerId:activeId, activePlayerName:activeName,
    isMyTurn: pid===activeId, canAnswer: pid!==activeId, turnToken:r.who.turnToken };
}
function emitWhoState(r){
  for(const [pid] of r.players.entries()) io.to(pid).emit('who:state', whoStateFor(r,pid));
  // La vista TV no es un jugador (no recibe los emits privados de arriba). Le
  // mandamos un estado aparte, pero SIN revelar ninguna identidad todavia no
  // adivinada: la TV suele estar a la vista de todos, y mostrar ahi los
  // nombres arruinaria el "no sabes quien sos" para cualquiera que mire.
  const activeId=whoActiveId(r);
  io.to(r.code).emit('who:tv_state', {
    activePlayerName: r.players.get(activeId)?.name,
    cards: playersArr(r).map(p=>{
      const revealed=r.who.revealed.has(p.id);
      const assign=r.who.assignments.get(p.id);
      return { name:p.name, revealed, identity: revealed?assign?.name:null, category: revealed?assign?.category:null };
    }),
  });
}
function whoAdvanceTurn(r){
  const order=r.who.order; if(!order.length)return;
  r.who.turnToken++;
  if(whoRemaining(r).length===0){ finishWho(r); return; }
  let attempts=0;
  do{
    r.who.turnIndex=(r.who.turnIndex+1)%order.length; attempts++;
  } while((r.who.revealed.has(order[r.who.turnIndex])||!r.players.get(order[r.who.turnIndex])?.connected) && attempts<=order.length);
  emitWhoState(r);
}
function finishWho(r){
  r.status='who_over';
  io.to(r.code).emit('who:game_over',{ scores:publicPlayers(r).sort((a,b)=>b.score-a.score) });
}

// Al reconectarse en medio de una partida, el jugador necesita que le reenvíen
// el estado actual de SU juego (rol, de quién es el turno, etc.) para aterrizar
// en la pantalla correcta en vez de quedarse pegado en el lobby/home.
function sendResumeState(r, socket){
  const pid=socket.id;
  switch(r.status){
    case 'imp_clue':
    case 'imp_vote':
    case 'imp_reveal':
    case 'imp_manga_over': {
      const isI=r.impostorIds.has(pid);
      socket.emit('imp:role', { isImpostor:isI, impostorCount:r.impostorIds.size, category:isI?null:r.concept?.category, concept:isI?null:r.concept?.name });
      socket.emit('imp:manga_started', { mangaNumber:r.mangaNumber, mangaCount:r.impostorConfig.mangaCount, impostorCount:r.impostorIds.size });
      if(r.status==='imp_clue'){
        socket.emit('imp:round', { roundNumber:r.roundNumber, currentTurnPlayerId:r.clueOrder[0]||null });
        socket.emit('imp:turn', { currentTurnPlayerId:r.clueOrder[r.clueTurnIndex] });
      } else if(r.status==='imp_vote'){
        socket.emit('imp:voting', { candidates: alive(r).map(p=>({id:p.id,name:p.name})) });
      }
      break;
    }
    case 'lie_claim':
    case 'lie_naming':
    case 'lie_final_vote':
    case 'lie_round_over': {
      socket.emit('lie:round',{ roundNumber:r.lie.roundNumber, roundCount:r.mentirosoConfig.roundCount, category:r.lie.category, mode:r.mentirosoConfig.mode, currentTurnPlayerId:lieTurnId(r) });
      if(r.status==='lie_claim'){
        if(r.lie.currentClaim>0) socket.emit('lie:claim',{ amount:r.lie.currentClaim });
      } else if(r.status==='lie_naming'){
        const ch=r.lie.challenge;
        if(ch){
          socket.emit('lie:accused',{ accuserId:ch.accuserId, accuserName:r.players.get(ch.accuserId)?.name, accusedId:ch.accusedId, accusedName:r.players.get(ch.accusedId)?.name, target:ch.target, category:r.lie.category, mode:r.mentirosoConfig.mode, deadlineAt:ch.deadlineAt, paused:ch.paused, remainingMs:ch.remainingMs });
          // Reponer el progreso ya hecho (respuestas nombradas antes de la reconexión)
          if(r.mentirosoConfig.mode==='texto' && ch.namedSoFar.length){
            ch.namedSoFar.forEach((text,i)=> socket.emit('lie:item',{text, count:i+1, target:ch.target, deadlineAt:ch.deadlineAt}));
          } else if(ch.count>0){
            socket.emit('lie:answer_marked',{count:ch.count, target:ch.target, deadlineAt:ch.deadlineAt});
          }
        }
      } else if(r.status==='lie_final_vote'){
        const ch=r.lie.challenge;
        if(ch){ const elig=connected(r).filter(p=>p.id!==ch.accusedId); socket.emit('lie:final_vote',{ target:ch.target, mode:r.mentirosoConfig.mode, namedSoFar:r.mentirosoConfig.mode==='texto'?ch.namedSoFar:null, votesNeeded:elig.length, eligibleVoterIds:elig.map(p=>p.id) }); }
      }
      break;
    }
    case 'subasta_formation':
      socket.emit('sub:formation_vote',{formations:ALL_FORMATIONS,secondsLeft:r.subasta.formationSecondsLeft});
      break;
    case 'subasta_play': {
      const snap=subSnapshot(r); if(snap) socket.emit('sub:resync',snap);
      const bid=r.subasta.bids.get(pid);
      if(bid) socket.emit('sub:eligibility',{eligible:bid.eligible, skipsLeft:r.subasta.playerState.get(pid)?.skipsLeft??0});
      break;
    }
    case 'subasta_rps':
      if(r.subasta.rps) socket.emit('sub:rps_start',{ playerIds:r.subasta.rps.players, playerNames:r.subasta.rps.players.map(id=>r.players.get(id)?.name), positionLabel:POSITION_LABELS[r.subasta.rps.card.position] });
      break;
    case 'wave_psychic':
      if(r.wave.pair) socket.emit('wave:round', { roundNumber:r.wave.roundNumber, roundCount:r.waveConfig.roundCount, left:r.wave.pair.left, right:r.wave.pair.right, psychicId:r.wave.psychicId, psychicName:r.players.get(r.wave.psychicId)?.name });
      break;
    case 'wave_guessing':
      if(r.wave.pair){
        const secondsLeft=Math.max(0,Math.round((r.wave.deadlineAt-Date.now())/1000));
        socket.emit('wave:guessing_start', { secondsLeft, left:r.wave.pair.left, right:r.wave.pair.right });
      }
      break;
    case 'who_turn':
      socket.emit('who:state', whoStateFor(r, pid));
      break;
    case 'who_guess_pending':
      socket.emit('who:state', whoStateFor(r, pid));
      if(r.who.pendingGuess) socket.emit('who:guess_submitted', { playerId:r.who.pendingGuess.playerId, playerName:r.players.get(r.who.pendingGuess.playerId)?.name, text:r.who.pendingGuess.text });
      break;
    // imp_reveal/imp_manga_over/lie_round_over/subasta_duel_vote/subasta_tournament/subasta_card_result/wave_reveal
    // son pantallas cortas y de transición (se resuelven solas o esperan al anfitrión);
    // si alguien recarga justo ahí, el próximo evento de servidor lo pone al día.
  }
}

/* ===================== SOCKET.IO ===================== */
io.on('connection', socket => {

  socket.on('tv:watch', ({ code }, cb) => {
    const r=rooms.get((code||'').toUpperCase());
    if(!r){cb&&cb({ok:false});return;}
    socket.join(r.code);
    cb&&cb({ok:true});
    emitRoom(r); // mandar estado actual inmediatamente
  });

  socket.on('player:create_room', ({ name }, cb) => {
    const trimmed=(name||'').trim().slice(0,20);
    if(!trimmed){cb({ok:false,error:'Ingresa tu nombre.'});return;}
    const code=genCode();
    const room=newRoom(code,socket.id);
    room.players.set(socket.id,{id:socket.id,name:trimmed,score:0,alive:true,connected:true});
    rooms.set(code,room);
    socket.join(code); socket.data.roomCode=code;
    cb({ok:true,code,playerId:socket.id,isHost:true,categories:ALL_CATEGORIES,formations:ALL_FORMATIONS});
    emitRoom(room);
  });

  socket.on('player:join_room', ({ code, name }, cb) => {
    const room=rooms.get((code||'').toUpperCase());
    if(!room){cb({ok:false,error:'Sala no encontrada.'});return;}
    if(room.status!=='lobby'){cb({ok:false,error:'La partida ya empezó.'});return;}
    const trimmed=(name||'').trim().slice(0,20);
    if(!trimmed){cb({ok:false,error:'Ingresa tu nombre.'});return;}
    if(playersArr(room).some(p=>p.name.toLowerCase()===trimmed.toLowerCase())){cb({ok:false,error:'Ese nombre ya está en uso.'});return;}
    room.players.set(socket.id,{id:socket.id,name:trimmed,score:0,alive:true,connected:true});
    socket.join(room.code); socket.data.roomCode=room.code;
    cb({ok:true,code:room.code,playerId:socket.id,isHost:false,categories:ALL_CATEGORIES,formations:ALL_FORMATIONS});
    emitRoom(room);
  });

  socket.on('host:select_game', ({code,gameType}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.status!=='lobby')return;
    if(!['impostor','mentiroso','subasta','wavelength','who'].includes(gameType))return;
    r.gameType=gameType; emitRoom(r);
  });
  socket.on('host:update_impostor_config', ({code,impostorCount,mangaCount,categories}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.status!=='lobby')return;
    if(Number.isInteger(impostorCount))r.impostorConfig.impostorCount=Math.min(Math.max(1,impostorCount),maxImpostorsFor(r.players.size));
    if(Number.isInteger(mangaCount))r.impostorConfig.mangaCount=Math.min(Math.max(1,mangaCount),20);
    if(Array.isArray(categories)){const v=categories.filter(c=>ALL_CATEGORIES.includes(c));r.impostorConfig.categories=v.length?v:ALL_CATEGORIES.slice();}
    emitRoom(r);
  });
  socket.on('host:update_mentiroso_config', ({code,roundCount,mode,namingSeconds}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.status!=='lobby')return;
    if(Number.isInteger(roundCount))r.mentirosoConfig.roundCount=Math.min(Math.max(1,roundCount),20);
    if(mode==='voz'||mode==='texto')r.mentirosoConfig.mode=mode;
    if(Number.isInteger(namingSeconds))r.mentirosoConfig.namingSeconds=Math.min(Math.max(10,namingSeconds),30);
    emitRoom(r);
  });
  socket.on('host:update_subasta_config', ({code,budget,skipLimit,winMode}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.status!=='lobby')return;
    if(Number.isInteger(budget)&&budget>=100)r.subastaConfig.budget=Math.min(budget,99999);
    if(Number.isInteger(skipLimit)&&skipLimit>=0)r.subastaConfig.skipLimit=Math.min(skipLimit,20);
    if(winMode==='ovr'||winMode==='votacion')r.subastaConfig.winMode=winMode;
    emitRoom(r);
  });
  socket.on('host:update_wave_config', ({code,roundCount}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.status!=='lobby')return;
    if(Number.isInteger(roundCount))r.waveConfig.roundCount=Math.min(Math.max(1,roundCount),20);
    emitRoom(r);
  });
  socket.on('host:update_who_config', ({code,categories}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.status!=='lobby')return;
    if(Array.isArray(categories)){const v=categories.filter(c=>ALL_CATEGORIES.includes(c));r.whoConfig.categories=v.length?v:ALL_CATEGORIES.slice();}
    emitRoom(r);
  });

  socket.on('host:start_match', ({code}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||!r.gameType)return;
    if(r.players.size<MIN_PLAYERS[r.gameType])return;
    if(r.gameType==='impostor'){r.mangaNumber=1;startManga(r);}
    else if(r.gameType==='mentiroso'){startLieSession(r);}
    else if(r.gameType==='subasta'){startFormationVote(r);}
    else if(r.gameType==='wavelength'){startWaveSession(r);}
    else if(r.gameType==='who'){startWhoSession(r);}
  });

  // El Impostor
  socket.on('host:next_manga', ({code}) => { const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.gameType!=='impostor')return; if(r.mangaNumber>=r.impostorConfig.mangaCount)return; r.mangaNumber++; startManga(r); });
  socket.on('player:submit_clue', ({code,word}) => {
    const r=rooms.get(code); if(!r||r.status!=='imp_clue'||r.clueOrder[r.clueTurnIndex]!==socket.id)return;
    const clean=(word||'').trim(); if(!clean)return; const n=norm(clean);
    if(r.usedClues.includes(n)){socket.emit('imp:clue_rejected',{reason:'Esa palabra ya se usó.'});return;}
    r.usedClues.push(n); const pl=r.players.get(socket.id);
    io.to(r.code).emit('imp:clue',{name:pl.name,word:clean});
    r.clueTurnIndex++; advClue(r);
  });
  socket.on('player:submit_vote', ({code,targetId}) => {
    const r=rooms.get(code); if(!r||r.status!=='imp_vote')return;
    const v=r.players.get(socket.id); if(!v?.alive||!r.players.get(targetId)?.alive)return;
    r.votes.set(socket.id,targetId);
    io.to(r.code).emit('imp:vote_count',{votesIn:r.votes.size,votesNeeded:connectedAlive(r).length});
    if(r.votes.size>=connectedAlive(r).length)resolveVotes(r);
  });

  // Mentiroso
  socket.on('host:next_lie_round', ({code}) => { const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.gameType!=='mentiroso')return; if(r.lie.roundNumber>=r.mentirosoConfig.roundCount)return; startLieRound(r); });
  socket.on('player:make_claim', ({code,amount}) => {
    const r=rooms.get(code); if(!r||r.status!=='lie_claim'||lieTurnId(r)!==socket.id)return;
    const n=Number(amount); if(!Number.isInteger(n)||n<=r.lie.currentClaim||n<1||n>300){socket.emit('lie:claim_rejected',{reason:`Debe ser mayor a ${r.lie.currentClaim}.`});return;}
    r.lie.currentClaim=n; r.lie.lastClaimerId=socket.id;
    io.to(r.code).emit('lie:claim',{name:r.players.get(socket.id)?.name,amount:n});
    advLie(r);
  });
  socket.on('player:accuse_liar', ({code}) => {
    const r=rooms.get(code); if(!r||r.status!=='lie_claim'||lieTurnId(r)!==socket.id)return;
    if(r.lie.currentClaim<=0||!r.lie.lastClaimerId)return;
    r.lie.challenge={accusedId:r.lie.lastClaimerId,accuserId:socket.id,target:r.lie.currentClaim,count:0,namedSoFar:[],deadlineAt:null,timeoutHandle:null,finalVotes:new Map(),paused:false,remainingMs:null};
    r.status='lie_naming'; const dl=restartLieTimer(r);
    io.to(r.code).emit('lie:accused',{accuserId:socket.id,accuserName:r.players.get(socket.id)?.name,accusedId:r.lie.challenge.accusedId,accusedName:r.players.get(r.lie.challenge.accusedId)?.name,target:r.lie.currentClaim,category:r.lie.category,mode:r.mentirosoConfig.mode,deadlineAt:dl});
  });
  socket.on('player:mark_answer', ({code}) => {
    const r=rooms.get(code); if(!r||r.status!=='lie_naming'||r.mentirosoConfig.mode!=='voz')return;
    const ch=r.lie.challenge; if(!ch||socket.id!==ch.accuserId)return;
    ch.count++;
    if(ch.count>=ch.target){io.to(r.code).emit('lie:answer_marked',{count:ch.count,target:ch.target,deadlineAt:null});toFinalVote(r);return;}
    const dl=restartLieTimer(r); io.to(r.code).emit('lie:answer_marked',{count:ch.count,target:ch.target,deadlineAt:dl});
  });
  socket.on('player:lie_toggle_pause', ({code}) => {
    const r=rooms.get(code); if(!r||r.status!=='lie_naming')return;
    const ch=r.lie.challenge; if(!ch||socket.id!==ch.accuserId)return;
    if(ch.paused){ const dl=resumeLieTimer(r); io.to(r.code).emit('lie:pause_state',{paused:false,deadlineAt:dl}); }
    else { pauseLieTimer(r); io.to(r.code).emit('lie:pause_state',{paused:true,remainingMs:ch.remainingMs}); }
  });
  socket.on('player:name_item', ({code,text}) => {
    const r=rooms.get(code); if(!r||r.status!=='lie_naming'||r.mentirosoConfig.mode!=='texto')return;
    const ch=r.lie.challenge; if(!ch||socket.id!==ch.accusedId)return;
    const clean=(text||'').trim(); if(!clean)return;
    ch.namedSoFar.push(clean); ch.count++;
    if(ch.count>=ch.target){io.to(r.code).emit('lie:item',{text:clean,count:ch.count,target:ch.target,deadlineAt:null});toFinalVote(r);return;}
    const dl=restartLieTimer(r); io.to(r.code).emit('lie:item',{text:clean,count:ch.count,target:ch.target,deadlineAt:dl});
  });
  socket.on('player:vote_final', ({code,valid}) => {
    const r=rooms.get(code); if(!r||r.status!=='lie_final_vote')return;
    const ch=r.lie.challenge; if(!ch||socket.id===ch.accusedId)return;
    ch.finalVotes.set(socket.id,!!valid);
    const elig=connected(r).filter(p=>p.id!==ch.accusedId);
    io.to(r.code).emit('lie:final_progress',{votesIn:ch.finalVotes.size,votesNeeded:elig.length});
    if(ch.finalVotes.size>=elig.length&&elig.length>0){let y=0,n=0;for(const v of ch.finalVotes.values()){if(v)y++;else n++;}resolveLie(r,y>=n,'vote');}
  });

  // Subasta
  socket.on('player:vote_formation', ({code,formation}) => {
    const r=rooms.get(code); if(!r||r.subasta.phase!=='formation_vote'||!FORMATIONS[formation])return;
    r.subasta.formationVotes.set(socket.id,formation);
    io.to(r.code).emit('sub:formation_vote_cast',{name:r.players.get(socket.id)?.name,formation,votesIn:r.subasta.formationVotes.size,totalPlayers:r.players.size});
    if(r.subasta.formationVotes.size>=r.players.size)resolveFormationVote(r);
  });
  socket.on('player:submit_bid', ({code,amount}) => {
    const r=rooms.get(code); if(!r||r.status!=='subasta_play'||r.subasta.auctionPhase!=='bidding')return;
    const s=r.subasta, bid=s.bids.get(socket.id);
    // Puedes pujar varias veces. Solo te bloquea si NO eres elegible o si ya pasaste (skip).
    if(!bid||!bid.eligible||bid.skip)return;
    // No tiene sentido pujar si ya tienes la puja más alta (no compites contra ti mismo).
    if(s.highestBid&&s.highestBid.playerId===socket.id){socket.emit('sub:bid_rejected',{reason:'Ya tienes la puja más alta.'});return;}
    const n=Number(amount), card=s.currentCard, ps=s.playerState.get(socket.id);
    const minBid=s.highestBid?s.highestBid.amount+1:card.startingPrice, maxBid=ps?.budget??0;
    if(!Number.isInteger(n)||n<minBid||n>maxBid){socket.emit('sub:bid_rejected',{reason:`Mínimo $${minBid}M, tienes $${maxBid}M.`});return;}
    bid.amount=n; bid.responded=true;
    s.highestBid={playerId:socket.id,name:r.players.get(socket.id)?.name,amount:n};
    if(s.secondsLeft<=EXT_S){s.secondsLeft=EXT_S;io.to(r.code).emit('sub:timer_extended',{secondsLeft:s.secondsLeft});}
    io.to(r.code).emit('sub:bid_public',{name:r.players.get(socket.id)?.name,amount:n,highestBid:s.highestBid});
  });
  socket.on('player:skip_card', ({code}) => {
    const r=rooms.get(code); if(!r||r.status!=='subasta_play')return;
    const s=r.subasta, bid=s.bids.get(socket.id); if(!bid||!bid.eligible||bid.responded)return;
    const ps=s.playerState.get(socket.id);
    if(ps&&ps.skipsLeft<=0){socket.emit('sub:bid_rejected',{reason:'Sin skips disponibles.'});return;}
    bid.skip=true; bid.responded=true; if(ps)ps.skipsLeft--;
    socket.emit('sub:skip_confirmed',{skipsLeft:ps?.skipsLeft??0});
    io.to(r.code).emit('sub:skip_public',{name:r.players.get(socket.id)?.name});
    if(checkAllResponded(r)&&!s.highestBid){clearSubTimer(r);resolveCard(r);}
  });
  socket.on('player:vote_duel', ({code,choice}) => {
    const r=rooms.get(code); if(!r||r.status!=='subasta_duel_vote')return;
    const d=r.subasta.bracket?.currentDuel; if(!d)return;
    if(socket.id===d.aId||socket.id===d.bId)return; // dueños no votan
    if(choice!=='A'&&choice!=='B')return;
    d.votes.set(socket.id,choice);
    const voters=[...r.players.keys()].filter(pid=>pid!==d.aId&&pid!==d.bId&&r.players.get(pid)?.connected);
    io.to(r.code).emit('sub:duel_vote_progress',{votesIn:d.votes.size,votesNeeded:voters.length});
    if(d.votes.size>=voters.length&&voters.length>0){
      let va=0,vb=0; for(const v of d.votes.values()){ if(v==='A')va++; else vb++; }
      if(va>=vb)d.votesA++; else d.votesB++;
      revealPosition(r, va>=vb?'A':'B', va, vb);
    }
  });
  socket.on('player:rps_choice', ({code,choice}) => {
    const r=rooms.get(code); if(!r||r.status!=='subasta_rps'||!r.subasta.rps)return;
    if(!['piedra','papel','tijera'].includes(choice))return;
    if(!r.subasta.rps.players.includes(socket.id))return;
    r.subasta.rps.choices.set(socket.id,choice);
    io.to(r.code).emit('sub:rps_progress',{chosen:r.subasta.rps.choices.size,total:r.subasta.rps.players.length});
    if(r.subasta.rps.choices.size>=r.subasta.rps.players.length) resolveRPS(r);
  });
  socket.on('player:request_sub_sync', ({code}) => { const r=rooms.get(code); if(!r||r.status!=='subasta_play')return; const snap=subSnapshot(r); if(snap)socket.emit('sub:resync',snap); });
  socket.on('host:next_subasta_card', ({code}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId)return;
    advanceToNextUsefulCard(r);
  });

  // La Frecuencia
  socket.on('player:wave_peek', ({code}) => {
    const r=rooms.get(code); if(!r||r.status!=='wave_psychic'||socket.id!==r.wave.psychicId)return;
    socket.emit('wave:target', { target:r.wave.target });
  });
  socket.on('player:wave_ready', ({code}) => {
    const r=rooms.get(code); if(!r||r.status!=='wave_psychic'||socket.id!==r.wave.psychicId)return;
    startWaveGuessing(r);
  });
  socket.on('player:wave_lock', ({code,value}) => {
    const r=rooms.get(code); if(!r||r.status!=='wave_guessing'||socket.id===r.wave.psychicId)return;
    const v=Number(value); if(!Number.isFinite(v))return;
    r.wave.guesses.set(socket.id, Math.min(100,Math.max(0,v)));
    io.to(r.code).emit('wave:lock_progress', { lockedIn:r.wave.guesses.size, needed:waveEligibleGuessers(r).filter(p=>p.connected).length });
    if(checkAllWaveLocked(r)) resolveWaveRound(r);
  });
  socket.on('host:wave_next_round', ({code}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.gameType!=='wavelength')return;
    if(r.wave.roundNumber>=r.waveConfig.roundCount)return;
    startWaveRound(r);
  });

  // ¿Quién Soy?
  socket.on('player:who_answer', ({code,answer,turnToken}) => {
    const r=rooms.get(code); if(!r||r.status!=='who_turn')return;
    const activeId=whoActiveId(r); if(!activeId||socket.id===activeId)return;
    if(turnToken!==r.who.turnToken)return; // pregunta vieja, ya se paso de turno
    if(!['si','no','talvez'].includes(answer))return;
    const answerer=r.players.get(socket.id);
    io.to(r.code).emit('who:answer',{ answererName:answerer?.name, answer, activePlayerId:activeId, activePlayerName:r.players.get(activeId)?.name });
    whoAdvanceTurn(r);
  });
  socket.on('player:who_guess', ({code,text}) => {
    const r=rooms.get(code); if(!r||r.status!=='who_turn')return;
    const activeId=whoActiveId(r); if(socket.id!==activeId)return;
    const clean=(text||'').trim(); if(!clean)return;
    r.who.pendingGuess={ playerId:socket.id, text:clean };
    r.status='who_guess_pending';
    io.to(r.code).emit('who:guess_submitted',{ playerId:socket.id, playerName:r.players.get(socket.id)?.name, text:clean });
  });
  socket.on('host:who_validate', ({code,correct}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.status!=='who_guess_pending')return;
    const pg=r.who.pendingGuess; if(!pg)return;
    const guesserId=pg.playerId;
    let points=0;
    if(correct){
      r.who.revealed.add(guesserId);
      // Puntaje por orden de llegada: el primero en adivinar se lleva tantos
      // puntos como jugadores haya, el segundo uno menos, y asi hasta 1.
      const position=r.who.revealed.size; // 1er, 2do, 3er... en adivinar
      points=Math.max(1, r.players.size - position + 1);
      const p=r.players.get(guesserId); if(p)p.score+=points;
    }
    r.who.pendingGuess=null; r.status='who_turn';
    io.to(r.code).emit('who:guess_result',{ playerId:guesserId, playerName:r.players.get(guesserId)?.name, correct, identity: r.who.assignments.get(guesserId)?.name, points });
    whoAdvanceTurn(r);
  });

  socket.on('host:new_session', ({code}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId)return;
    clearLieTimer(r); clearSubTimer(r);
    r.status='lobby'; r.gameType=null; r.concept=null; r.impostorIds=new Set(); r.usedClues=[]; r.roundNumber=0; r.mangaNumber=0;
    r.lie={roundNumber:0,turnStartIndex:0,category:null,turnOrder:[],currentTurnIndex:0,currentClaim:0,lastClaimerId:null,challenge:null};
    r.subasta={phase:'config',formation:null,formationVotes:new Map(),deck:[],currentCardIndex:-1,currentCard:null,auctionPhase:null,secondsLeft:0,totalEligible:0,bids:new Map(),highestBid:null,playerState:new Map(),resolvedCards:[],rps:null,rpsTimer:null,teams:null,bracket:null};
    r.wave={roundNumber:0,order:[],orderIndex:0,psychicId:null,pair:null,target:null,usedPairIndexes:new Set(),guesses:new Map(),secondsLeft:0,deadlineAt:null};
    r.who={order:[],turnIndex:0,turnToken:0,assignments:new Map(),revealed:new Set(),pendingGuess:null};
    // Limpiar fantasmas: jugadores que se desconectaron durante la partida anterior
    // y nunca volvieron. Si no, se quedan ocupando su nombre para siempre.
    for(const [id,p] of [...r.players.entries()]) if(!p.connected && id!==r.hostId) r.players.delete(id);
    reassignHostIfNeeded(r);
    for(const p of r.players.values()){p.alive=true;p.score=0;}
    emitRoom(r);
  });

  socket.on('player:rejoin', ({code,playerId}, cb) => {
    // Permite reconectarse a una sala tras perder conexión
    const r=rooms.get((code||'').toUpperCase());
    if(!r){cb&&cb({ok:false});return;}
    const existing=r.players.get(playerId);
    if(existing){
      // reasignar el socket: el jugador vuelve con un socket.id nuevo, así que
      // hay que actualizar toda referencia a su id viejo en el estado de juego
      // (impostores, turnos, votos, pujas...), o "desaparece" de la partida.
      remapPlayerId(r, playerId, socket.id);
      r.players.delete(playerId);
      existing.id=socket.id; existing.connected=true;
      if(r.hostId===playerId)r.hostId=socket.id;
      r.players.set(socket.id,existing);
      socket.join(r.code); socket.data.roomCode=r.code;
      cb&&cb({ok:true,code:r.code,playerId:socket.id,isHost:r.hostId===socket.id,categories:ALL_CATEGORIES,formations:ALL_FORMATIONS});
      emitRoom(r);
      sendResumeState(r, socket);
    } else { cb&&cb({ok:false}); }
  });

  socket.on('disconnect', () => {
    const code=socket.data.roomCode; if(!code)return;
    const r=rooms.get(code); if(!r)return;
    const p=r.players.get(socket.id);
    if(p){
      if(r.status==='lobby'){ r.players.delete(socket.id); reassignHostIfNeeded(r); }
      else {
        p.connected=false;
        if(r.status==='imp_clue'&&r.clueOrder[r.clueTurnIndex]===socket.id)advClue(r);
        if(r.status==='imp_vote'&&r.votes.size>=connectedAlive(r).length&&connectedAlive(r).length>0)resolveVotes(r);
        if(r.status==='lie_claim'&&lieTurnId(r)===socket.id)advLie(r);
        if(r.status==='subasta_play'&&checkAllResponded(r)&&!r.subasta.highestBid){clearSubTimer(r);resolveCard(r);}
        if(r.status==='wave_psychic'&&r.wave.psychicId===socket.id){ setTimeout(()=>{ const room=rooms.get(code); if(room&&room.status==='wave_psychic'&&room.wave.psychicId===socket.id) startWaveRound(room); },3000); }
        if(r.status==='wave_guessing'&&checkAllWaveLocked(r))resolveWaveRound(r);
        if(r.status==='who_turn'&&whoActiveId(r)===socket.id)whoAdvanceTurn(r);
      }
      emitRoom(r);
    }
    if(r.players.size===0){clearSubTimer(r);clearLieTimer(r);rooms.delete(code);}
  });
});

/* ===================== EXPRESS ===================== */
app.use(express.static(path.join(__dirname,'public')));
app.get('/favicon.ico',(_q,res)=>res.status(204).end()); // evita el 404 en consola
app.get('/health',(_q,res)=>res.status(200).send('ok')); // para ping de UptimeRobot (mantener despierto)
app.get('/tv',(_q,res)=>res.sendFile(path.join(__dirname,'public','tv.html')));
app.get('/',(_q,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
server.listen(PORT,'0.0.0.0',()=>console.log(`412 corriendo en http://localhost:${PORT}`));
