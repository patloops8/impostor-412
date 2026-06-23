
const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;

/* =========================================================
   DATOS
   ========================================================= */
const CONCEPTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'concepts.json'), 'utf-8'));
const ALL_CATEGORIES = [...new Set(CONCEPTS.map(c => c.category))];
const LIE_CATEGORIES = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'mentiroso-categories.json'), 'utf-8'));
const SUBASTA_CARDS = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'subasta-cards.json'), 'utf-8'));

// Posiciones específicas. Orden de subasta de atrás hacia adelante.
const POSITION_ORDER = ['POR','LD','DFC','LI','MCD','MC','MCO','ED','EI','DC'];
const POSITION_LABELS = {
  POR: 'Portero', LD: 'Lateral Derecho', DFC: 'Defensa Central', LI: 'Lateral Izquierdo',
  MCD: 'Mediocentro Defensivo', MC: 'Mediocentro', MCO: 'Mediocentro Ofensivo',
  ED: 'Extremo Derecho', EI: 'Extremo Izquierdo', DC: 'Delantero Centro',
};
// Cada formación define cuántos jugadores por posición específica (deben sumar 11)
const FORMATIONS = {
  '4-3-3':   { POR:1, LD:1, DFC:2, LI:1, MCD:1, MC:2, MCO:0, ED:1, EI:1, DC:1 },
  '4-4-2':   { POR:1, LD:1, DFC:2, LI:1, MCD:0, MC:2, MCO:0, ED:1, EI:1, DC:2 },
  '4-2-3-1': { POR:1, LD:1, DFC:2, LI:1, MCD:2, MC:0, MCO:1, ED:1, EI:1, DC:1 },
  '3-5-2':   { POR:1, LD:0, DFC:3, LI:0, MCD:1, MC:2, MCO:1, ED:1, EI:1, DC:1 },
  '3-4-3':   { POR:1, LD:0, DFC:3, LI:0, MCD:1, MC:2, MCO:0, ED:1, EI:1, DC:2 },
  '4-3-1-2': { POR:1, LD:1, DFC:2, LI:1, MCD:1, MC:2, MCO:1, ED:0, EI:0, DC:2 },
};
const ALL_FORMATIONS = Object.keys(FORMATIONS);

/* =========================================================
   WIKIPEDIA IMAGE CACHE
   ========================================================= */
const imageCache = new Map();

async function getWikiImageUrl(wikiTitle) {
  if (imageCache.has(wikiTitle)) return imageCache.get(wikiTitle);
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) { imageCache.set(wikiTitle, null); return null; }
    const data = await res.json();
    const imgUrl = data.thumbnail?.source || null;
    imageCache.set(wikiTitle, imgUrl);
    return imgUrl;
  } catch {
    imageCache.set(wikiTitle, null);
    return null;
  }
}

async function prewarmImageCache() {
  const titles = [...new Set(SUBASTA_CARDS.map(c => c.wikiTitle))];
  let loaded = 0;
  // Lotes de 8 con 150ms entre lotes para no sobrecargar Wikipedia
  for (let i = 0; i < titles.length; i += 8) {
    const batch = titles.slice(i, i + 8);
    await Promise.all(batch.map(async t => {
      try { await getWikiImageUrl(t); } catch {}
    }));
    loaded += batch.length;
    if (i + 8 < titles.length) await new Promise(r => setTimeout(r, 150));
  }
  const found = [...imageCache.values()].filter(Boolean).length;
  console.log(`[Subasta] Cache lista: ${found}/${loaded} imagenes encontradas`);
}
prewarmImageCache().catch(() => {});

/* =========================================================
   CONSTANTES
   ========================================================= */
const MIN_PLAYERS_IMPOSTOR = 3;
const MIN_PLAYERS_MENTIROSO = 2;
const MIN_PLAYERS_SUBASTA = 2;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLUE_PHASE_END_DELAY_MS = 4500;
const RESULT_DISPLAY_DELAY_MS = 3500;
const TIE_DISPLAY_DELAY_MS = 4000;
const MAX_CLAIM = 300;
const VOICE_ANSWER_TIMEOUT_MS = 10000;
const TEXT_ANSWER_TIMEOUT_MS = 15000;
const FORMATION_VOTE_TIMEOUT_MS = 45000;

/* =========================================================
   ESTADO EN MEMORIA
   ========================================================= */
const rooms = new Map();
const subastaTimers = new Map(); // code -> intervalId

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
  } while (rooms.has(code));
  return code;
}

function normalizeWord(word) {
  return word.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function maxImpostorsFor(n) { return Math.max(1, Math.floor((n - 1) / 2)); }

function newRoom(code, hostId) {
  return {
    code, hostId,
    players: new Map(),
    gameType: null,
    status: 'lobby',

    // El Impostor
    impostorConfig: { impostorCount: 1, mangaCount: 3, categories: ALL_CATEGORIES.slice() },
    mangaNumber: 0, concept: null, impostorIds: new Set(),
    usedClues: [], clueLog: [], clueOrder: [], clueTurnIndex: 0,
    cluePhaseEnding: false, votes: new Map(), roundNumber: 0,

    // Mentiroso
    mentirosoConfig: { roundCount: 5, mode: 'texto' },
    lie: { roundNumber: 0, turnStartIndex: 0, category: null, turnOrder: [],
           currentTurnIndex: 0, currentClaim: 0, lastClaimerId: null, challenge: null },

    // Subasta
    subastaConfig: { budget: 500, timerSeconds: 30, skipLimit: 5 },
    subasta: {
      phase: 'config',
      formation: null,
      formationVotes: new Map(),
      formationVoteTimer: null,
      deck: [],
      currentCardIndex: -1,
      currentCard: null,
      auctionPhase: null, secondsLeft: 0, totalEligible: 0,
      analysisTimer: null,
      bidDeadline: null,
      bidTimer: null,
      bids: new Map(),
      playerState: new Map(),
      resolvedCards: [],
    },
  };
}

function alivePlayers(room) { return [...room.players.values()].filter(p => p.alive); }
function connectedAlivePlayers(room) { return alivePlayers(room).filter(p => p.connected); }
function connectedPlayers(room) { return [...room.players.values()].filter(p => p.connected); }

function publicPlayerList(room) {
  return [...room.players.values()].map(p => ({
    id: p.id, name: p.name, score: p.score, alive: p.alive, connected: p.connected,
  }));
}

function minPlayersFor(gameType) {
  if (gameType === 'mentiroso') return MIN_PLAYERS_MENTIROSO;
  if (gameType === 'subasta') return MIN_PLAYERS_SUBASTA;
  return MIN_PLAYERS_IMPOSTOR;
}

function emitRoomState(room) {
  io.to(room.code).emit('room:players_update', {
    players: publicPlayerList(room),
    status: room.status,
    gameType: room.gameType,
    impostorConfig: room.impostorConfig,
    mentirosoConfig: room.mentirosoConfig,
    subastaConfig: room.subastaConfig,
    maxImpostors: maxImpostorsFor(room.players.size),
    minPlayers: minPlayersFor(room.gameType),
    subastaPhase: room.subasta.phase,
    formation: room.subasta.formation,
  });
}

/* =========================================================
   EL IMPOSTOR — logica
   ========================================================= */
function startNewManga(room) {
  const pool = CONCEPTS.filter(c => room.impostorConfig.categories.includes(c.category));
  room.concept = (pool.length > 0 ? pool : CONCEPTS)[Math.floor(Math.random() * (pool.length || CONCEPTS.length))];
  const ids = shuffle([...room.players.keys()]);
  const cnt = Math.min(room.impostorConfig.impostorCount, maxImpostorsFor(room.players.size));
  room.impostorIds = new Set(ids.slice(0, cnt));
  room.usedClues = [];
  room.roundNumber = 0;
  for (const p of room.players.values()) p.alive = true;
  for (const [id] of room.players.entries()) {
    const isI = room.impostorIds.has(id);
    io.to(id).emit('match:your_role', {
      isImpostor: isI, impostorCount: room.impostorIds.size,
      category: isI ? null : room.concept.category,
      concept: isI ? null : room.concept.name,
    });
  }
  emitRoomState(room);
  io.to(room.code).emit('manga:started', {
    mangaNumber: room.mangaNumber, mangaCount: room.impostorConfig.mangaCount,
    impostorCount: room.impostorIds.size,
  });
  startClueRound(room);
}

function startClueRound(room) {
  room.status = 'clue';
  room.roundNumber++;
  room.clueLog = [];
  room.votes = new Map();
  room.clueOrder = shuffle(alivePlayers(room)).map(p => p.id);
  room.clueTurnIndex = 0;
  io.to(room.code).emit('round:started', {
    roundNumber: room.roundNumber,
    turnOrder: room.clueOrder.map(id => room.players.get(id)?.name),
    currentTurnPlayerId: room.clueOrder[0] || null,
  });
  advanceClueTurnIfDisconnected(room);
}

function advanceClueTurnIfDisconnected(room) {
  while (room.status === 'clue' && room.clueTurnIndex < room.clueOrder.length &&
         !room.players.get(room.clueOrder[room.clueTurnIndex])?.connected) {
    room.clueTurnIndex++;
  }
  if (room.status === 'clue' && room.clueTurnIndex >= room.clueOrder.length) {
    finishCluePhase(room);
  } else if (room.status === 'clue') {
    io.to(room.code).emit('round:turn_changed', { currentTurnPlayerId: room.clueOrder[room.clueTurnIndex] });
  }
}

function finishCluePhase(room) {
  if (room.cluePhaseEnding) return;
  room.cluePhaseEnding = true;
  io.to(room.code).emit('round:clue_phase_ending');
  setTimeout(() => {
    room.cluePhaseEnding = false;
    if (room.status === 'clue') startVotingPhase(room);
  }, CLUE_PHASE_END_DELAY_MS);
}

function startVotingPhase(room) {
  room.status = 'voting';
  room.votes = new Map();
  io.to(room.code).emit('round:voting_started', { candidates: alivePlayers(room).map(p => ({ id: p.id, name: p.name })) });
}

function resolveVotes(room) {
  const tally = new Map();
  for (const t of room.votes.values()) tally.set(t, (tally.get(t) || 0) + 1);
  let max = 0;
  for (const v of tally.values()) max = Math.max(max, v);
  const top = [...tally.entries()].filter(([, c]) => c === max).map(([id]) => id);
  if (top.length !== 1) {
    io.to(room.code).emit('round:tie', { tiedPlayers: top.map(id => room.players.get(id)?.name) });
    setTimeout(() => startClueRound(room), TIE_DISPLAY_DELAY_MS);
    return;
  }
  const elId = top[0];
  const el = room.players.get(elId);
  el.alive = false;
  const wasI = room.impostorIds.has(elId);
  const votersForI = [...room.votes.entries()].filter(([, t]) => room.impostorIds.has(t)).map(([v]) => v);
  io.to(room.code).emit('round:elimination', { eliminatedId: elId, eliminatedName: el.name, wasImpostor: wasI });
  room.status = 'reveal';
  const aliveI = alivePlayers(room).filter(p => room.impostorIds.has(p.id));
  const aliveInnocents = alivePlayers(room).length - aliveI.length;
  if (aliveI.length === 0) { setTimeout(() => endManga(room, 'impostors_caught', votersForI), RESULT_DISPLAY_DELAY_MS); return; }
  if (aliveI.length >= aliveInnocents) { setTimeout(() => endManga(room, 'impostors_win', []), RESULT_DISPLAY_DELAY_MS); return; }
  aliveI.forEach(imp => imp.score++);
  setTimeout(() => startClueRound(room), RESULT_DISPLAY_DELAY_MS);
}

function endManga(room, result, votersForFinal) {
  room.status = 'manga_over';
  const impostorNames = [...room.impostorIds].map(id => room.players.get(id)?.name).filter(Boolean);
  if (result === 'impostors_caught') {
    for (const p of room.players.values()) {
      if (room.impostorIds.has(p.id)) continue;
      p.score++;
      if (votersForFinal.includes(p.id)) p.score++;
    }
  } else if (result === 'impostors_win') {
    for (const id of room.impostorIds) { const p = room.players.get(id); if (p?.alive) p.score += 3; }
  }
  const isLast = room.mangaNumber >= room.impostorConfig.mangaCount;
  io.to(room.code).emit('manga:over', {
    result, concept: room.concept, impostorNames,
    mangaNumber: room.mangaNumber, mangaCount: room.impostorConfig.mangaCount,
    isLastManga: isLast, scores: publicPlayerList(room).sort((a, b) => b.score - a.score),
  });
}

/* =========================================================
   MENTIROSO — logica
   ========================================================= */
function startLieSession(room) { room.lie.roundNumber = 0; room.lie.turnStartIndex = 0; startLieRound(room); }

function startLieRound(room) {
  room.lie.roundNumber++;
  room.lie.category = LIE_CATEGORIES[Math.floor(Math.random() * LIE_CATEGORIES.length)];
  const allIds = [...room.players.keys()];
  const start = room.lie.turnStartIndex % allIds.length;
  room.lie.turnOrder = [...allIds.slice(start), ...allIds.slice(0, start)];
  room.lie.turnStartIndex = (room.lie.turnStartIndex + 1) % allIds.length;
  room.lie.currentTurnIndex = 0;
  room.lie.currentClaim = 0;
  room.lie.lastClaimerId = null;
  clearLieChallengeTimer(room);
  room.lie.challenge = null;
  room.status = 'lie_claim';
  emitRoomState(room);
  io.to(room.code).emit('lie:round_started', {
    roundNumber: room.lie.roundNumber, roundCount: room.mentirosoConfig.roundCount,
    category: room.lie.category, mode: room.mentirosoConfig.mode,
    currentTurnPlayerId: currentLieTurnId(room),
  });
}

function currentLieTurnId(room) { return room.lie.turnOrder[room.lie.currentTurnIndex] || null; }

function advanceLieTurn(room) {
  const order = room.lie.turnOrder;
  if (!order.length) return;
  let tries = 0;
  do {
    room.lie.currentTurnIndex = (room.lie.currentTurnIndex + 1) % order.length;
    tries++;
  } while (!room.players.get(order[room.lie.currentTurnIndex])?.connected && tries <= order.length);
  io.to(room.code).emit('lie:turn_changed', { currentTurnPlayerId: currentLieTurnId(room) });
}

function clearLieChallengeTimer(room) {
  if (room.lie.challenge?.timeoutHandle) { clearTimeout(room.lie.challenge.timeoutHandle); room.lie.challenge.timeoutHandle = null; }
}

function restartLieAnswerTimer(room) {
  clearLieChallengeTimer(room);
  const ch = room.lie.challenge;
  if (!ch) return null;
  const dur = room.mentirosoConfig.mode === 'voz' ? VOICE_ANSWER_TIMEOUT_MS : TEXT_ANSWER_TIMEOUT_MS;
  ch.deadlineAt = Date.now() + dur;
  ch.timeoutHandle = setTimeout(() => {
    if (room.status === 'lie_naming' && room.lie.challenge === ch) resolveLieChallenge(room, false, 'timeout');
  }, dur);
  return ch.deadlineAt;
}

function transitionToFinalVote(room) {
  clearLieChallengeTimer(room);
  const ch = room.lie.challenge;
  room.status = 'lie_final_vote';
  ch.finalVotes = new Map();
  const eligible = connectedPlayers(room).filter(p => p.id !== ch.accusedId);
  io.to(room.code).emit('lie:final_vote_needed', {
    target: ch.target, mode: room.mentirosoConfig.mode,
    namedSoFar: room.mentirosoConfig.mode === 'texto' ? ch.namedSoFar : null,
    votesNeeded: eligible.length, eligibleVoterIds: eligible.map(p => p.id),
  });
}

function resolveLieChallenge(room, success, reason) {
  clearLieChallengeTimer(room);
  const ch = room.lie.challenge;
  if (!ch) return;
  const accused = room.players.get(ch.accusedId);
  const accuser = room.players.get(ch.accuserId);
  if (success) { if (accused) accused.score++; if (accuser) accuser.score--; }
  else { if (accuser) accuser.score++; if (accused) accused.score--; }
  room.status = 'lie_round_over';
  const isLast = room.lie.roundNumber >= room.mentirosoConfig.roundCount;
  io.to(room.code).emit('lie:challenge_resolved', {
    success, reason: reason || (success ? 'completed' : 'rejected'),
    accusedName: accused?.name || '???', accuserName: accuser?.name || '???',
    category: room.lie.category, target: ch.target, count: ch.count,
    namedSoFar: ch.namedSoFar, mode: room.mentirosoConfig.mode,
    roundNumber: room.lie.roundNumber, roundCount: room.mentirosoConfig.roundCount,
    isLastRound: isLast, scores: publicPlayerList(room).sort((a, b) => b.score - a.score),
  });
}

/* =========================================================
   SUBASTA FUTBOLERA — logica
   ========================================================= */
function subastaPlayerState(budget, skipLimit) {
  const team = {};
  for (const pos of POSITION_ORDER) team[pos] = [];
  return { budget, skipsLeft: skipLimit, team, totalRealValue: 0 };
}

function buildSubastaDeck(room) {
  // Las cartas se agrupan y ordenan POR POSICIÓN (orden de POSITION_ORDER).
  // Dentro de cada posición van barajadas. No se avanza de posición hasta terminar la anterior.
  const formation = room.subasta.formation;
  const slots = FORMATIONS[formation];
  const playerCount = room.players.size;
  const pool = {};
  for (const pos of POSITION_ORDER) pool[pos] = [];
  for (const card of SUBASTA_CARDS) {
    if (pool[card.position]) pool[card.position].push(card);
  }
  const deck = [];
  for (const pos of POSITION_ORDER) {
    const count = slots[pos] || 0;
    if (count === 0) continue;
    const needed = count * playerCount;
    const available = shuffle(pool[pos]);
    const chosen = available.slice(0, Math.min(needed, available.length));
    deck.push(...chosen); // ya en orden de posición; dentro barajadas
  }
  const result = deck.map(card => ({ ...card }));
  console.log('[Subasta] Deck por posición:', result.length, 'cartas,', playerCount, 'jugadores,', formation);
  return result;
}

function getPositionsFilled(ps, slots) {
  const filled = {};
  for (const [pos, count] of Object.entries(slots)) {
    filled[pos] = ps.team[pos].length >= count;
  }
  return filled;
}

const ANALYSIS_DURATION = 15; // segundos
const BIDDING_DURATION = 15;  // segundos
const LAST_SECOND_EXTENSION = 5; // segundos

// ============================================================
//  RELOJ AUTORITATIVO DEL SERVIDOR
//  Un solo interval por sala. Cada segundo emite la fase y los
//  segundos restantes. Los clientes SOLO muestran lo que llega.
// ============================================================
function clearSubastaBidTimer(room) {
  if (subastaTimers.has(room.code)) {
    clearInterval(subastaTimers.get(room.code));
    subastaTimers.delete(room.code);
  }
}

function showSubastaCard(room) {
  const sub = room.subasta;
  const card = sub.deck[sub.currentCardIndex];
  if (!card) { console.error('[Subasta] Carta no encontrada:', sub.currentCardIndex); return; }

  clearSubastaBidTimer(room);
  sub.currentCard = card;
  sub.bids = new Map();
  sub.highestBid = null;
  sub.auctionPhase = 'analysis';
  sub.secondsLeft = ANALYSIS_DURATION;

  const slots = FORMATIONS[sub.formation];
  let totalEligible = 0;
  for (const [pid] of room.players.entries()) {
    const ps = sub.playerState.get(pid);
    if (!ps) { sub.bids.set(pid, { amount: null, skip: false, eligible: false, responded: true }); continue; }
    const posNeeded = ps.team[card.position].length < slots[card.position];
    const canAfford = ps.budget >= card.startingPrice;
    const eligible = posNeeded && canAfford;
    sub.bids.set(pid, { amount: null, skip: false, eligible, responded: !eligible });
    if (eligible) totalEligible++;
  }

  room.status = 'subasta_bidding'; // un solo status para toda la subasta de la carta
  sub.totalEligible = totalEligible;

  // Info privada para cada jugador (elegibilidad)
  for (const [pid, bid] of sub.bids.entries()) {
    io.to(pid).emit('subasta:card_shown_private', {
      eligible: bid.eligible,
      skipsLeft: sub.playerState.get(pid)?.skipsLeft ?? 0,
      wikiTitle: card.wikiTitle,
      position: card.position,
      startingPrice: card.startingPrice,
    });
  }

  // Broadcast inicial de la carta
  io.to(room.code).emit('subasta:card_shown', {
    cardIndex: sub.currentCardIndex,
    totalCards: sub.deck.length,
    position: card.position,
    startingPrice: card.startingPrice,
    wikiTitle: card.wikiTitle,
    phase: 'analysis',
    secondsLeft: sub.secondsLeft,
    totalEligible,
  });

  startSubastaClock(room);
}

// Devuelve un snapshot del estado actual de la carta (para re-sincronizar clientes)
function subastaCardSnapshot(room) {
  const sub = room.subasta;
  const card = sub.currentCard;
  if (!card) return null;
  return {
    cardIndex: sub.currentCardIndex,
    totalCards: sub.deck.length,
    position: card.position,
    startingPrice: card.startingPrice,
    wikiTitle: card.wikiTitle,
    phase: sub.auctionPhase,
    secondsLeft: sub.secondsLeft,
    highestBid: sub.highestBid,
    totalEligible: sub.totalEligible,
  };
}

function startSubastaClock(room) {
  clearSubastaBidTimer(room);
  const code = room.code;
  const iv = setInterval(() => {
    const r = rooms.get(code);
    if (!r || r.status !== 'subasta_bidding') {
      clearInterval(iv);
      subastaTimers.delete(code);
      return;
    }
    const sub = r.subasta;
    sub.secondsLeft -= 1;

    // Emitir tick a TODOS: misma fuente de verdad para host y celulares
    io.to(code).emit('subasta:tick', {
      phase: sub.auctionPhase,
      secondsLeft: Math.max(0, sub.secondsLeft),
    });

    if (sub.secondsLeft <= 0) {
      if (sub.auctionPhase === 'analysis') {
        // Pasar a fase de puja
        sub.auctionPhase = 'bidding';
        sub.secondsLeft = BIDDING_DURATION;
        io.to(code).emit('subasta:bidding_phase', {
          secondsLeft: sub.secondsLeft,
          highestBid: sub.highestBid,
        });
      } else {
        // Fin de la puja: resolver
        clearInterval(iv);
        subastaTimers.delete(code);
        try { resolveSubastaCard(r); }
        catch(e) { console.error('[Subasta] resolveSubastaCard error:', e); }
      }
    }
  }, 1000);
  subastaTimers.set(code, iv);
}

function checkAllEligibleResponded(room) {
  for (const bid of room.subasta.bids.values()) {
    if (bid.eligible && !bid.responded) return false;
  }
  return true;
}

function resolveSubastaCard(room) {
  // Guard: evitar doble resolución (timer + todos-respondieron)
  if (room.status !== 'subasta_bidding') {
    console.log('[Subasta] resolveSubastaCard ignorado: status=' + room.status);
    return;
  }
  clearSubastaBidTimer(room);
  const sub = room.subasta;
  const card = sub.currentCard;
  if (!card) {
    console.error('[Subasta] resolveSubastaCard: currentCard es null, abortando');
    return;
  }
  const bids = sub.bids;

  const validBids = [];
  const noResponse = [];

  for (const [pid, bid] of bids.entries()) {
    if (!bid.eligible) continue;
    if (bid.skip) continue;
    if (bid.amount !== null && bid.amount >= card.startingPrice) {
      validBids.push({ playerId: pid, amount: bid.amount });
    } else if (!bid.responded || bid.amount === null) {
      noResponse.push(pid);
    }
  }

  let result;

  if (validBids.length > 0) {
    const maxAmt = Math.max(...validBids.map(b => b.amount));
    const tied = validBids.filter(b => b.amount === maxAmt);
    const winner = tied[Math.floor(Math.random() * tied.length)];
    assignSubastaCard(room, winner.playerId, winner.amount);
    result = { type: 'bid', winnerId: winner.playerId, amount: winner.amount, allBids: validBids };
  } else if (noResponse.length > 0) {
    const winnerId = noResponse[Math.floor(Math.random() * noResponse.length)];
    assignSubastaCard(room, winnerId, card.startingPrice);
    result = { type: 'lottery', winnerId, amount: card.startingPrice, pool: noResponse };
  } else {
    result = { type: 'discard' };
  }

  room.status = 'subasta_card_result';
  sub.resolvedCards.push({ card, result });

  // Construir log de pujas para mostrar
  const bidLog = [];
  for (const [pid, bid] of bids.entries()) {
    const name = room.players.get(pid)?.name;
    if (!name) continue;
    if (!bid.eligible) continue;
    bidLog.push({
      name,
      action: bid.skip ? 'skip' : bid.amount !== null ? `$${bid.amount}M` : 'sin respuesta',
      isWinner: result.winnerId === pid,
    });
  }
  bidLog.sort((a, b) => {
    if (a.isWinner) return -1;
    if (b.isWinner) return 1;
    return 0;
  });

  io.to(room.code).emit('subasta:card_resolved', {
    // Identidad del jugador revelada inmediatamente
    cardName: card.name,
    cardLabel: card.label,
    cardPosition: card.position,
    cardWikiTitle: card.wikiTitle, // cliente carga imagen revelada
    cardTroll: card.troll,
    cardStartingPrice: card.startingPrice,
    // Valor real OCULTO hasta el final
    result,
    winnerName: result.winnerId ? room.players.get(result.winnerId)?.name : null,
    bidLog,
    isLastCard: sub.currentCardIndex >= sub.deck.length - 1,
  });
}

function assignSubastaCard(room, playerId, amount) {
  const sub = room.subasta;
  const card = sub.currentCard;
  const ps = sub.playerState.get(playerId);
  if (!ps) return;
  ps.budget -= amount;
  ps.team[card.position].push({ cardId: card.id, amountPaid: amount, realValue: null }); // realValue hidden until reveal
  ps.totalRealValue += card.realValue;
}

function buildFinalScores(room) {
  const sub = room.subasta;
  const scores = [];
  for (const [pid, ps] of sub.playerState.entries()) {
    const player = room.players.get(pid);
    if (!player) continue;
    scores.push({
      id: pid,
      name: player.name,
      totalRealValue: ps.totalRealValue,
      budgetLeft: ps.budget,
      team: ps.team,
    });
  }
  return scores.sort((a, b) => b.totalRealValue - a.totalRealValue);
}

/* =========================================================
   SOCKET.IO
   ========================================================= */
io.on('connection', socket => {
  socket.on('host:create_room', (_p, cb) => {
    const code = generateRoomCode();
    const room = newRoom(code, socket.id);
    rooms.set(code, room);
    socket.join(code);
    cb({ ok: true, code, impostorConfig: room.impostorConfig, mentirosoConfig: room.mentirosoConfig, subastaConfig: room.subastaConfig, categories: ALL_CATEGORIES, formations: ALL_FORMATIONS });
  });

  socket.on('player:join_room', ({ code, name }, cb) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room) { cb({ ok: false, error: 'Sala no encontrada. Revisa el código.' }); return; }
    if (room.status !== 'lobby') { cb({ ok: false, error: 'La partida ya empezó, espera a la siguiente.' }); return; }
    const trimmed = (name || '').trim().slice(0, 20);
    if (!trimmed) { cb({ ok: false, error: 'Ingresa un nombre.' }); return; }
    if ([...room.players.values()].some(p => p.name.toLowerCase() === trimmed.toLowerCase())) {
      cb({ ok: false, error: 'Ese nombre ya está en uso.' }); return;
    }
    room.players.set(socket.id, { id: socket.id, name: trimmed, score: 0, alive: true, connected: true });
    socket.join(room.code);
    socket.data.roomCode = room.code;
    cb({ ok: true, code: room.code, playerId: socket.id });
    emitRoomState(room);
  });

  socket.on('host:select_game', ({ code, gameType }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.status !== 'lobby') return;
    if (!['impostor','mentiroso','subasta'].includes(gameType)) return;
    room.gameType = gameType;
    emitRoomState(room);
  });

  socket.on('host:update_impostor_config', ({ code, impostorCount, mangaCount, categories }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.status !== 'lobby') return;
    if (Number.isInteger(impostorCount)) room.impostorConfig.impostorCount = Math.min(Math.max(1, impostorCount), maxImpostorsFor(room.players.size));
    if (Number.isInteger(mangaCount)) room.impostorConfig.mangaCount = Math.min(Math.max(1, mangaCount), 20);
    if (Array.isArray(categories)) { const v = categories.filter(c => ALL_CATEGORIES.includes(c)); room.impostorConfig.categories = v.length ? v : ALL_CATEGORIES.slice(); }
    emitRoomState(room);
  });

  socket.on('host:update_mentiroso_config', ({ code, roundCount, mode }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.status !== 'lobby') return;
    if (Number.isInteger(roundCount)) room.mentirosoConfig.roundCount = Math.min(Math.max(1, roundCount), 20);
    if (mode === 'voz' || mode === 'texto') room.mentirosoConfig.mode = mode;
    emitRoomState(room);
  });

  socket.on('host:update_subasta_config', ({ code, budget, timerSeconds, skipLimit }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.status !== 'lobby') return;
    if (Number.isInteger(budget) && budget >= 10) room.subastaConfig.budget = Math.min(budget, 999);
    if (Number.isInteger(timerSeconds) && timerSeconds >= 5) room.subastaConfig.timerSeconds = Math.min(timerSeconds, 120);
    if (Number.isInteger(skipLimit) && skipLimit >= 0) room.subastaConfig.skipLimit = Math.min(skipLimit, 20);
    emitRoomState(room);
  });

  socket.on('host:start_match', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || !room.gameType) return;
    const min = minPlayersFor(room.gameType);
    if (room.players.size < min) return;

    if (room.gameType === 'impostor') { room.mangaNumber = 1; startNewManga(room); }
    else if (room.gameType === 'mentiroso') { startLieSession(room); }
    else if (room.gameType === 'subasta') { startFormationVote(room); }
  });

  // ---- El Impostor ----
  socket.on('host:next_manga', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.gameType !== 'impostor') return;
    if (room.mangaNumber >= room.impostorConfig.mangaCount) return;
    room.mangaNumber++;
    startNewManga(room);
  });

  socket.on('player:submit_clue', ({ code, word }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'clue' || room.clueOrder[room.clueTurnIndex] !== socket.id) return;
    const clean = (word || '').trim();
    if (!clean) return;
    const norm = normalizeWord(clean);
    if (room.usedClues.includes(norm)) { socket.emit('round:clue_rejected', { reason: 'Esa palabra ya se usó en esta partida.' }); return; }
    room.usedClues.push(norm);
    const player = room.players.get(socket.id);
    room.clueLog.push({ playerId: socket.id, name: player.name, word: clean });
    io.to(room.code).emit('round:clue_submitted', { playerId: socket.id, name: player.name, word: clean });
    room.clueTurnIndex++;
    advanceClueTurnIfDisconnected(room);
  });

  socket.on('player:submit_vote', ({ code, targetId }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'voting') return;
    const voter = room.players.get(socket.id);
    if (!voter?.alive || !room.players.get(targetId)?.alive) return;
    room.votes.set(socket.id, targetId);
    io.to(room.code).emit('round:vote_registered', { votesIn: room.votes.size, votesNeeded: connectedAlivePlayers(room).length });
    if (room.votes.size >= connectedAlivePlayers(room).length) resolveVotes(room);
  });

  // ---- Mentiroso ----
  socket.on('host:next_lie_round', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.gameType !== 'mentiroso') return;
    if (room.lie.roundNumber >= room.mentirosoConfig.roundCount) return;
    startLieRound(room);
  });

  socket.on('player:make_claim', ({ code, amount }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'lie_claim' || currentLieTurnId(room) !== socket.id) return;
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= room.lie.currentClaim || n < 1 || n > MAX_CLAIM) {
      socket.emit('lie:claim_rejected', { reason: `Debes decir un número entero mayor a ${room.lie.currentClaim}.` }); return;
    }
    room.lie.currentClaim = n;
    room.lie.lastClaimerId = socket.id;
    io.to(room.code).emit('lie:claim_made', { playerId: socket.id, name: room.players.get(socket.id)?.name, amount: n });
    advanceLieTurn(room);
  });

  socket.on('player:accuse_liar', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'lie_claim' || currentLieTurnId(room) !== socket.id) return;
    if (room.lie.currentClaim <= 0 || !room.lie.lastClaimerId) return;
    const accuserId = socket.id;
    const accusedId = room.lie.lastClaimerId;
    room.lie.challenge = { accusedId, accuserId, target: room.lie.currentClaim, count: 0, namedSoFar: [], deadlineAt: null, timeoutHandle: null, finalVotes: new Map() };
    room.status = 'lie_naming';
    const deadlineAt = restartLieAnswerTimer(room);
    io.to(room.code).emit('lie:accused', {
      accuserId, accuserName: room.players.get(accuserId)?.name,
      accusedId, accusedName: room.players.get(accusedId)?.name,
      target: room.lie.currentClaim, category: room.lie.category,
      mode: room.mentirosoConfig.mode, deadlineAt,
    });
  });

  socket.on('player:mark_answer_valid', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'lie_naming' || room.mentirosoConfig.mode !== 'voz') return;
    const ch = room.lie.challenge;
    if (!ch || socket.id !== ch.accuserId) return;
    ch.count++;
    if (ch.count >= ch.target) { io.to(room.code).emit('lie:answer_marked', { count: ch.count, target: ch.target, deadlineAt: null }); transitionToFinalVote(room); return; }
    const deadlineAt = restartLieAnswerTimer(room);
    io.to(room.code).emit('lie:answer_marked', { count: ch.count, target: ch.target, deadlineAt });
  });

  socket.on('player:name_item', ({ code, text }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'lie_naming' || room.mentirosoConfig.mode !== 'texto') return;
    const ch = room.lie.challenge;
    if (!ch || socket.id !== ch.accusedId) return;
    const clean = (text || '').trim();
    if (!clean) return;
    ch.namedSoFar.push(clean);
    ch.count++;
    if (ch.count >= ch.target) { io.to(room.code).emit('lie:item_submitted', { text: clean, count: ch.count, target: ch.target, deadlineAt: null }); transitionToFinalVote(room); return; }
    const deadlineAt = restartLieAnswerTimer(room);
    io.to(room.code).emit('lie:item_submitted', { text: clean, count: ch.count, target: ch.target, deadlineAt });
  });

  socket.on('player:vote_final_validity', ({ code, valid }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'lie_final_vote') return;
    const ch = room.lie.challenge;
    if (!ch || socket.id === ch.accusedId) return;
    ch.finalVotes.set(socket.id, !!valid);
    const eligible = connectedPlayers(room).filter(p => p.id !== ch.accusedId);
    io.to(room.code).emit('lie:final_vote_progress', { votesIn: ch.finalVotes.size, votesNeeded: eligible.length });
    if (ch.finalVotes.size >= eligible.length && eligible.length > 0) {
      let yes = 0, no = 0;
      for (const v of ch.finalVotes.values()) { if (v) yes++; else no++; }
      resolveLieChallenge(room, yes >= no, 'vote');
    }
  });

  // ---- Subasta ----
  socket.on('player:vote_formation', ({ code, formation }) => {
    const room = rooms.get(code);
    if (!room || room.subasta.phase !== 'formation_vote' || !FORMATIONS[formation]) return;
    room.subasta.formationVotes.set(socket.id, formation);
    io.to(room.code).emit('subasta:formation_vote_cast', {
      playerId: socket.id, name: room.players.get(socket.id)?.name, formation,
      votesIn: room.subasta.formationVotes.size, totalPlayers: room.players.size,
    });
    if (room.subasta.formationVotes.size >= room.players.size) resolveFormationVote(room);
  });

  socket.on('player:submit_bid', ({ code, amount }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'subasta_bidding' || room.subasta.auctionPhase !== 'bidding') return;
    const sub = room.subasta;
    const bid = sub.bids.get(socket.id);
    if (!bid || !bid.eligible || bid.responded) return;
    const n = Number(amount);
    const card = sub.currentCard;
    const ps = sub.playerState.get(socket.id);
    const minBid = sub.highestBid ? sub.highestBid.amount + 1 : card.startingPrice;
    const maxBid = ps?.budget ?? 0;
    if (!Number.isInteger(n) || n < minBid || n > maxBid) {
      socket.emit('subasta:bid_rejected', { reason: `La puja mínima es $${minBid}M. Tienes $${maxBid}M disponibles.` }); return;
    }
    bid.amount = n;
    bid.responded = true;
    sub.highestBid = { playerId: socket.id, name: room.players.get(socket.id)?.name, amount: n };

    // Si quedan 5 segundos o menos, devolver el reloj a 5 segundos
    if (sub.auctionPhase === 'bidding' && sub.secondsLeft <= LAST_SECOND_EXTENSION) {
      sub.secondsLeft = LAST_SECOND_EXTENSION;
      io.to(room.code).emit('subasta:timer_extended', { secondsLeft: sub.secondsLeft });
    }

    // Emitir puja pública para que todos la vean
    io.to(room.code).emit('subasta:bid_public', {
      playerId: socket.id,
      name: room.players.get(socket.id)?.name,
      amount: n,
      highestBid: sub.highestBid,
    });
    // NOTA: ya no se resuelve por "todos respondieron". La carta se resuelve
    // SOLO cuando el reloj llega a 0, para dar siempre chance de contra-pujar.
  });

  socket.on('player:skip_card', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'subasta_bidding') return;
    const sub = room.subasta;
    const bid = sub.bids.get(socket.id);
    if (!bid || !bid.eligible || bid.responded) return;
    const ps = sub.playerState.get(socket.id);
    if (ps && ps.skipsLeft <= 0) { socket.emit('subasta:bid_rejected', { reason: 'Ya no tienes skips disponibles.' }); return; }
    bid.skip = true;
    bid.responded = true;
    if (ps) ps.skipsLeft--;
    socket.emit('subasta:skip_confirmed', { skipsLeft: ps?.skipsLeft ?? 0 });
    io.to(room.code).emit('subasta:skip_public', {
      name: room.players.get(socket.id)?.name,
    });
    // Resolución temprana SOLO si todos los elegibles ya respondieron Y nadie pujó
    // (es decir, todos pasaron → descarte inmediato, no hay nada que esperar).
    if (checkAllEligibleResponded(room) && !sub.highestBid) {
      clearSubastaBidTimer(room);
      resolveSubastaCard(room);
    }
  });

  socket.on('player:request_subasta_sync', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'subasta_bidding') return;
    const snap = subastaCardSnapshot(room);
    if (snap) socket.emit('subasta:resync', snap);
  });

  socket.on('host:force_resolve_card', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.status !== 'subasta_bidding') return;
    console.log('[Subasta] Force resolve por host');
    resolveSubastaCard(room);
  });

  socket.on('host:next_subasta_card', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    const sub = room.subasta;
    if (sub.currentCardIndex >= sub.deck.length - 1) {
      startFinalReveal(room);
    } else {
      sub.currentCardIndex++;
      showSubastaCard(room);
    }
  });

  socket.on('host:next_reveal', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.subasta.phase !== 'final_reveal') return;
    const sub = room.subasta;
    sub.revealIndex = (sub.revealIndex || 0) + 1;
    const entry = sub.resolvedCards[sub.revealIndex];
    if (!entry) {
      endSubasta(room);
    } else {
      io.to(room.code).emit('subasta:reveal_next', { entry, revealIndex: sub.revealIndex, totalCards: sub.resolvedCards.length });
    }
  });

  socket.on('host:new_session', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    clearLieChallengeTimer(room);
    clearSubastaBidTimer(room);
    room.status = 'lobby';
    room.gameType = null;
    room.concept = null;
    room.impostorIds = new Set();
    room.usedClues = [];
    room.roundNumber = 0;
    room.mangaNumber = 0;
    room.lie = { roundNumber: 0, turnStartIndex: 0, category: null, turnOrder: [], currentTurnIndex: 0, currentClaim: 0, lastClaimerId: null, challenge: null };
    room.subasta = { phase: 'config', formation: null, formationVotes: new Map(), formationVoteTimer: null, deck: [], currentCardIndex: -1, currentCard: null, auctionPhase: null, secondsLeft: 0, totalEligible: 0, bids: new Map(), playerState: new Map(), resolvedCards: [] };
    for (const p of room.players.values()) { p.alive = true; p.score = 0; }
    emitRoomState(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.get(socket.id);
    if (player) {
      if (room.status === 'lobby') { room.players.delete(socket.id); }
      else {
        player.connected = false;
        if (room.status === 'clue' && room.clueOrder[room.clueTurnIndex] === socket.id) advanceClueTurnIfDisconnected(room);
        if (room.status === 'voting' && room.votes.size >= connectedAlivePlayers(room).length && connectedAlivePlayers(room).length > 0) resolveVotes(room);
        if (room.status === 'lie_claim' && currentLieTurnId(room) === socket.id) advanceLieTurn(room);
        if (room.status === 'lie_final_vote' && room.lie.challenge) {
          const ch = room.lie.challenge;
          const eligible = connectedPlayers(room).filter(p => p.id !== ch.accusedId);
          if (ch.finalVotes.size >= eligible.length && eligible.length > 0) {
            let yes = 0, no = 0;
            for (const v of ch.finalVotes.values()) { if (v) yes++; else no++; }
            resolveLieChallenge(room, yes >= no, 'vote');
          }
        }
        // En subasta, si un jugador se desconecta, el reloj del servidor sigue corriendo
        // y resuelve la carta al llegar a 0. No forzamos resolución aquí.
        if (room.status === 'subasta_bidding' && checkAllEligibleResponded(room) && !room.subasta.highestBid) {
          clearSubastaBidTimer(room);
          resolveSubastaCard(room);
        }
      }
      emitRoomState(room);
    }
    if (socket.id === room.hostId && room.players.size === 0) rooms.delete(code);
  });
});

/* =========================================================
   SUBASTA — funciones auxiliares de fase
   ========================================================= */
function startFormationVote(room) {
  const sub = room.subasta;
  sub.phase = 'formation_vote';
  sub.formationVotes = new Map();
  room.status = 'subasta_formation_vote';
  emitRoomState(room);
  io.to(room.code).emit('subasta:formation_vote_started', {
    formations: ALL_FORMATIONS,
    timeoutMs: FORMATION_VOTE_TIMEOUT_MS,
    deadlineAt: Date.now() + FORMATION_VOTE_TIMEOUT_MS,
  });
  sub.formationVoteTimer = setTimeout(() => resolveFormationVote(room), FORMATION_VOTE_TIMEOUT_MS);
}

function resolveFormationVote(room) {
  const sub = room.subasta;
  if (sub.formationVoteTimer) { clearTimeout(sub.formationVoteTimer); sub.formationVoteTimer = null; }
  const tally = new Map();
  for (const f of sub.formationVotes.values()) tally.set(f, (tally.get(f) || 0) + 1);
  let maxV = 0;
  for (const v of tally.values()) maxV = Math.max(maxV, v);
  const top = [...tally.keys()].filter(f => tally.get(f) === maxV);
  const formation = top.length ? top[Math.floor(Math.random() * top.length)] : ALL_FORMATIONS[Math.floor(Math.random() * ALL_FORMATIONS.length)];
  sub.formation = formation;
  room.subasta.phase = 'building_deck';
  io.to(room.code).emit('subasta:formation_decided', { formation, votes: Object.fromEntries(tally) });
  // Init player states
  for (const [pid] of room.players.entries()) {
    sub.playerState.set(pid, subastaPlayerState(room.subastaConfig.budget, room.subastaConfig.skipLimit));
  }
  sub.deck = buildSubastaDeck(room);
  sub.currentCardIndex = 0;
  sub.phase = 'auction';
  showSubastaCard(room);
}

function startFinalReveal(room) {
  clearSubastaBidTimer(room);
  endSubasta(room);
}

function endSubasta(room) {
  room.subasta.phase = 'over';
  room.status = 'subasta_over';
  const sub = room.subasta;
  const slots = FORMATIONS[sub.formation];

  // Construir equipos con nombres reales (de las cartas resueltas)
  const teamCards = new Map(); // playerId -> array of card info with realValue
  for (const [pid] of room.players.entries()) {
    teamCards.set(pid, []);
  }
  for (const { card, result } of sub.resolvedCards) {
    if (result.winnerId && teamCards.has(result.winnerId)) {
      teamCards.get(result.winnerId).push({
        name: card.name,
        label: card.label,
        position: card.position,
        realValue: card.realValue,
        amountPaid: result.amount,
        troll: card.troll,
      });
    }
  }

  const scores = [];
  for (const [pid, ps] of sub.playerState.entries()) {
    const player = room.players.get(pid);
    if (!player) continue;
    const cards = teamCards.get(pid) || [];
    const totalRealValue = cards.reduce((sum, c) => sum + c.realValue, 0);
    scores.push({
      id: pid, name: player.name, totalRealValue,
      budgetLeft: ps.budget, cards,
      totalCards: cards.length, totalSlots: 11,
    });
  }
  scores.sort((a, b) => b.totalRealValue - a.totalRealValue);

  scores.forEach((s, idx) => {
    const p = room.players.get(s.id);
    if (p) p.score += Math.max(0, scores.length - idx);
  });

  io.to(room.code).emit('subasta:game_over', { scores, formation: sub.formation, slots });
}

/* =========================================================
   EXPRESS + ARRANQUE
   ========================================================= */
app.use(express.static(path.join(__dirname, 'public')));
app.get('/host', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'host', 'index.html')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'player', 'index.html')));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`412 corriendo en http://localhost:${PORT}`);
});
