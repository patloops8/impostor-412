const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

/* ===================== DATOS ===================== */
const CONCEPTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'concepts.json'), 'utf-8'));
const ALL_CATEGORIES = [...new Set(CONCEPTS.map(c => c.category))];
const LIE_CATEGORIES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'mentiroso-categories.json'), 'utf-8'));
const SUBASTA_CARDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'subasta-cards.json'), 'utf-8'));

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
const MIN_PLAYERS = { impostor: 3, mentiroso: 2, subasta: 2 };

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
    mentirosoConfig: { roundCount: 5, mode: 'texto' },
    lie: { roundNumber:0, turnStartIndex:0, category:null, turnOrder:[], currentTurnIndex:0, currentClaim:0, lastClaimerId:null, challenge:null },
    subastaConfig: { budget: 500, skipLimit: 5 },
    subasta: {
      phase:'config', formation:null, formationVotes:new Map(),
      deck:[], currentCardIndex:-1, currentCard:null,
      auctionPhase:null, secondsLeft:0, totalEligible:0,
      bids:new Map(), highestBid:null, playerState:new Map(), resolvedCards:[], rps:null, rpsTimer:null,
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
  const dur=r.mentirosoConfig.mode==='voz'?10000:15000;
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
const ANALYSIS_S=15, BIDDING_S=15, EXT_S=8, FORMATION_S=45;
function clearSubTimer(r){ if(timers.has(r.code)){clearInterval(timers.get(r.code));timers.delete(r.code);} }
function subPlayerState(budget,skip){ const t={}; for(const p of POSITION_ORDER)t[p]=[]; return {budget,skipsLeft:skip,team:t,totalRealValue:0}; }
function buildDeck(r){
  const slots=FORMATIONS[r.subasta.formation], pc=r.players.size, pool={};
  for(const p of POSITION_ORDER)pool[p]=[];
  for(const c of SUBASTA_CARDS) if(pool[c.position])pool[c.position].push(c);
  const deck=[];
  for(const pos of POSITION_ORDER){ const n=(slots[pos]||0)*pc; if(!n)continue; deck.push(...shuffle(pool[pos]).slice(0,Math.min(n,pool[pos].length))); }
  return deck.map(c=>({...c}));
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
  io.to(r.code).emit('sub:card',{ cardIndex:s.currentCardIndex, totalCards:s.deck.length, position:card.position, positionLabel:POSITION_LABELS[card.position], startingPrice:card.startingPrice, wikiTitle:card.wikiTitle, phase:'analysis', secondsLeft:s.secondsLeft, totalEligible:elig });
  startSubClock(r);
}
function subSnapshot(r){
  const s=r.subasta, card=s.currentCard; if(!card)return null;
  return { cardIndex:s.currentCardIndex, totalCards:s.deck.length, position:card.position, positionLabel:POSITION_LABELS[card.position], startingPrice:card.startingPrice, wikiTitle:card.wikiTitle, phase:s.auctionPhase, secondsLeft:s.secondsLeft, highestBid:s.highestBid, totalEligible:s.totalEligible };
}
function startSubClock(r){
  clearSubTimer(r); const code=r.code;
  const iv=setInterval(()=>{
    const room=rooms.get(code);
    if(!room||room.status!=='subasta_play'){clearInterval(iv);timers.delete(code);return;}
    const s=room.subasta; s.secondsLeft--;
    io.to(code).emit('sub:tick',{phase:s.auctionPhase,secondsLeft:Math.max(0,s.secondsLeft)});
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
  const slots=FORMATIONS[s.formation];
  const valid=[], noResp=[];
  for(const [pid,b] of bids.entries()){
    if(!b.eligible||b.skip)continue;
    if(b.amount!==null&&b.amount>=card.startingPrice) valid.push({playerId:pid,amount:b.amount});
    else if(!b.responded||b.amount===null) noResp.push(pid);
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
    // Nadie pujó pero 2+ siguen "vivos" (no skipearon): piedra-papel-tijera, pierde uno y se la queda
    startRPS(r,noResp,card);
    return; // se resuelve async tras el PPT
  } else if(noResp.length===1){
    // Solo uno quedó sin skipear: se la lleva al precio inicial
    assignCard(r,noResp[0],card.startingPrice); result={type:'forced',winnerId:noResp[0],amount:card.startingPrice};
    finishResolveCard(r,card,result);
  } else {
    // Todos skipearon. ¿Alguien AÚN necesita esta posición?
    const needers=[];
    for(const [pid] of r.players.entries()){
      const ps=s.playerState.get(pid);
      if(ps && ps.team[card.position].length<slots[card.position] && ps.budget>=card.startingPrice) needers.push(pid);
    }
    if(needers.length>=2){ startRPS(r,needers,card); return; }
    else if(needers.length===1){ assignCard(r,needers[0],card.startingPrice); result={type:'forced',winnerId:needers[0],amount:card.startingPrice}; finishResolveCard(r,card,result); }
    else { result={type:'discard'}; finishResolveCard(r,card,result); } // nadie la necesita o nadie puede pagarla
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
    cardName:card.name, positionLabel:POSITION_LABELS[card.position],
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
  io.to(r.code).emit('sub:card_resolved',{ cardName:card.name, cardLabel:card.label, cardPosition:card.position, positionLabel:POSITION_LABELS[card.position], cardWikiTitle:card.wikiTitle, cardTroll:card.troll, result, winnerName:result.winnerId?r.players.get(result.winnerId)?.name:null, bidLog, isLastCard:s.currentCardIndex>=s.deck.length-1 });
}
function assignCard(r,pid,amount){
  const s=r.subasta, card=s.currentCard, ps=s.playerState.get(pid); if(!ps)return;
  ps.budget-=amount; ps.team[card.position].push({cardId:card.id,amountPaid:amount}); ps.totalRealValue+=card.realValue;
}
function endSubasta(r){
  r.subasta.phase='over'; r.status='subasta_over';
  const s=r.subasta;
  const teamCards=new Map(); for(const [pid] of r.players.entries())teamCards.set(pid,[]);
  for(const {card,result} of s.resolvedCards){
    if(result.winnerId&&teamCards.has(result.winnerId))
      teamCards.get(result.winnerId).push({name:card.name,label:card.label,position:card.position,positionLabel:POSITION_LABELS[card.position],realValue:card.realValue,amountPaid:result.amount,troll:card.troll});
  }
  const scores=[];
  for(const [pid,ps] of s.playerState.entries()){
    const pl=r.players.get(pid); if(!pl)continue;
    const cards=teamCards.get(pid)||[];
    scores.push({id:pid,name:pl.name,totalRealValue:cards.reduce((a,c)=>a+c.realValue,0),budgetLeft:ps.budget,cards});
  }
  scores.sort((a,b)=>b.totalRealValue-a.totalRealValue);
  scores.forEach((sc,i)=>{ const p=r.players.get(sc.id); if(p)p.score+=Math.max(0,scores.length-i); });
  io.to(r.code).emit('sub:game_over',{scores,formation:s.formation});
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
    io.to(code).emit('sub:formation_tick',{secondsLeft:Math.max(0,s.formationSecondsLeft)});
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
  // Mandar los títulos de Wikipedia del deck para que los clientes precarguen las imágenes
  io.to(r.code).emit('sub:prefetch',{ wikiTitles:[...new Set(s.deck.map(c=>c.wikiTitle))] });
  setTimeout(()=>showCard(r),1500);
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
    if(!['impostor','mentiroso','subasta'].includes(gameType))return;
    r.gameType=gameType; emitRoom(r);
  });
  socket.on('host:update_impostor_config', ({code,impostorCount,mangaCount,categories}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.status!=='lobby')return;
    if(Number.isInteger(impostorCount))r.impostorConfig.impostorCount=Math.min(Math.max(1,impostorCount),maxImpostorsFor(r.players.size));
    if(Number.isInteger(mangaCount))r.impostorConfig.mangaCount=Math.min(Math.max(1,mangaCount),20);
    if(Array.isArray(categories)){const v=categories.filter(c=>ALL_CATEGORIES.includes(c));r.impostorConfig.categories=v.length?v:ALL_CATEGORIES.slice();}
    emitRoom(r);
  });
  socket.on('host:update_mentiroso_config', ({code,roundCount,mode}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.status!=='lobby')return;
    if(Number.isInteger(roundCount))r.mentirosoConfig.roundCount=Math.min(Math.max(1,roundCount),20);
    if(mode==='voz'||mode==='texto')r.mentirosoConfig.mode=mode;
    emitRoom(r);
  });
  socket.on('host:update_subasta_config', ({code,budget,skipLimit}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||r.status!=='lobby')return;
    if(Number.isInteger(budget)&&budget>=10)r.subastaConfig.budget=Math.min(budget,9999);
    if(Number.isInteger(skipLimit)&&skipLimit>=0)r.subastaConfig.skipLimit=Math.min(skipLimit,20);
    emitRoom(r);
  });

  socket.on('host:start_match', ({code}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId||!r.gameType)return;
    if(r.players.size<MIN_PLAYERS[r.gameType])return;
    if(r.gameType==='impostor'){r.mangaNumber=1;startManga(r);}
    else if(r.gameType==='mentiroso'){startLieSession(r);}
    else if(r.gameType==='subasta'){startFormationVote(r);}
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
    r.lie.challenge={accusedId:r.lie.lastClaimerId,accuserId:socket.id,target:r.lie.currentClaim,count:0,namedSoFar:[],deadlineAt:null,timeoutHandle:null,finalVotes:new Map()};
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
    const s=r.subasta;
    if(s.currentCardIndex>=s.deck.length-1)endSubasta(r);
    else{s.currentCardIndex++;showCard(r);}
  });

  socket.on('host:new_session', ({code}) => {
    const r=rooms.get(code); if(!r||socket.id!==r.hostId)return;
    clearLieTimer(r); clearSubTimer(r);
    r.status='lobby'; r.gameType=null; r.concept=null; r.impostorIds=new Set(); r.usedClues=[]; r.roundNumber=0; r.mangaNumber=0;
    r.lie={roundNumber:0,turnStartIndex:0,category:null,turnOrder:[],currentTurnIndex:0,currentClaim:0,lastClaimerId:null,challenge:null};
    r.subasta={phase:'config',formation:null,formationVotes:new Map(),deck:[],currentCardIndex:-1,currentCard:null,auctionPhase:null,secondsLeft:0,totalEligible:0,bids:new Map(),highestBid:null,playerState:new Map(),resolvedCards:[],rps:null,rpsTimer:null};
    for(const p of r.players.values()){p.alive=true;p.score=0;}
    emitRoom(r);
  });

  socket.on('player:rejoin', ({code,playerId}, cb) => {
    // Permite reconectarse a una sala tras perder conexión
    const r=rooms.get((code||'').toUpperCase());
    if(!r){cb&&cb({ok:false});return;}
    const existing=r.players.get(playerId);
    if(existing){
      // reasignar el socket
      r.players.delete(playerId);
      existing.id=socket.id; existing.connected=true;
      if(r.hostId===playerId)r.hostId=socket.id;
      r.players.set(socket.id,existing);
      socket.join(r.code); socket.data.roomCode=r.code;
      cb&&cb({ok:true,code:r.code,playerId:socket.id,isHost:r.hostId===socket.id});
      emitRoom(r);
      if(r.status==='subasta_play'){const snap=subSnapshot(r);if(snap)socket.emit('sub:resync',snap);}
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
      }
      emitRoom(r);
    }
    if(r.players.size===0){clearSubTimer(r);clearLieTimer(r);rooms.delete(code);}
  });
});

/* ===================== EXPRESS ===================== */
app.use(express.static(path.join(__dirname,'public')));
app.get('/tv',(_q,res)=>res.sendFile(path.join(__dirname,'public','tv.html')));
app.get('/',(_q,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
server.listen(PORT,'0.0.0.0',()=>console.log(`412 corriendo en http://localhost:${PORT}`));
