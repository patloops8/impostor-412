const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// ---------- Datos ----------
const CONCEPTS = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'concepts.json'), 'utf-8')
);
const ALL_CATEGORIES = [...new Set(CONCEPTS.map((c) => c.category))];

const LIE_CATEGORIES = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'data', 'mentiroso-categories.json'), 'utf-8')
);

// ---------- Estado en memoria ----------
/** rooms: Map<code, RoomState> */
const rooms = new Map();

const MIN_PLAYERS = 3;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres confusos
const CLUE_PHASE_END_DELAY_MS = 4500;
const RESULT_DISPLAY_DELAY_MS = 3500;
const TIE_DISPLAY_DELAY_MS = 4000;
const MAX_CLAIM = 300;

function generateRoomCode() {
  let code;
  do {
    code = '';
    for (let i = 0; i < 4; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
  } while (rooms.has(code));
  return code;
}

function normalizeWord(word) {
  return word
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // quita acentos
}

function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Máximo de impostores permitido para que arranquen en minoría real
function maxImpostorsFor(playerCount) {
  return Math.max(1, Math.floor((playerCount - 1) / 2));
}

function newRoom(code, hostSocketId) {
  return {
    code,
    hostId: hostSocketId,
    players: new Map(), // socketId -> { id, name, score, alive, connected }
    gameType: null, // null | 'impostor' | 'mentiroso'
    status: 'lobby',

    // --- El Impostor ---
    impostorConfig: {
      impostorCount: 1,
      mangaCount: 3,
      categories: ALL_CATEGORIES.slice(),
    },
    mangaNumber: 0,
    concept: null,
    impostorIds: new Set(),
    usedClues: [],
    clueLog: [],
    clueOrder: [],
    clueTurnIndex: 0,
    cluePhaseEnding: false,
    votes: new Map(),
    roundNumber: 0,

    // --- Mentiroso ---
    mentirosoConfig: {
      roundCount: 5,
      includeObjective: true,
      includeSubjective: true,
    },
    lie: {
      roundNumber: 0,
      turnStartIndex: 0,
      category: null,
      turnOrder: [],
      currentTurnIndex: 0,
      currentClaim: 0,
      lastClaimerId: null,
      challenge: null,
    },
  };
}

function alivePlayers(room) {
  return [...room.players.values()].filter((p) => p.alive);
}

function connectedAlivePlayers(room) {
  return alivePlayers(room).filter((p) => p.connected);
}

function connectedPlayers(room) {
  return [...room.players.values()].filter((p) => p.connected);
}

function publicPlayerList(room) {
  return [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    score: p.score,
    alive: p.alive,
    connected: p.connected,
  }));
}

function emitRoomState(room) {
  io.to(room.code).emit('room:players_update', {
    players: publicPlayerList(room),
    status: room.status,
    gameType: room.gameType,
    impostorConfig: room.impostorConfig,
    mentirosoConfig: room.mentirosoConfig,
    maxImpostors: maxImpostorsFor(room.players.size),
  });
}

/* =========================================================
   EL IMPOSTOR
   ========================================================= */

function startNewManga(room) {
  const pool = CONCEPTS.filter((c) => room.impostorConfig.categories.includes(c.category));
  const usablePool = pool.length > 0 ? pool : CONCEPTS;
  room.concept = usablePool[Math.floor(Math.random() * usablePool.length)];

  const ids = shuffle([...room.players.keys()]);
  const impostorCount = Math.min(room.impostorConfig.impostorCount, maxImpostorsFor(room.players.size));
  room.impostorIds = new Set(ids.slice(0, impostorCount));
  room.usedClues = [];
  room.roundNumber = 0;

  for (const p of room.players.values()) {
    p.alive = true;
  }

  for (const [id, p] of room.players.entries()) {
    const isImpostor = room.impostorIds.has(id);
    io.to(id).emit('match:your_role', {
      isImpostor,
      impostorCount: room.impostorIds.size,
      category: isImpostor ? null : room.concept.category,
      concept: isImpostor ? null : room.concept.name,
    });
  }

  emitRoomState(room);
  io.to(room.code).emit('manga:started', {
    mangaNumber: room.mangaNumber,
    mangaCount: room.impostorConfig.mangaCount,
    impostorCount: room.impostorIds.size,
  });
  startClueRound(room);
}

function startClueRound(room) {
  room.status = 'clue';
  room.roundNumber += 1;
  room.clueLog = [];
  room.votes = new Map();
  room.clueOrder = shuffle(alivePlayers(room)).map((p) => p.id);
  room.clueTurnIndex = 0;

  io.to(room.code).emit('round:started', {
    roundNumber: room.roundNumber,
    turnOrder: room.clueOrder.map((id) => room.players.get(id)?.name),
    currentTurnPlayerId: room.clueOrder[0] || null,
  });

  advanceClueTurnIfDisconnected(room);
}

function advanceClueTurnIfDisconnected(room) {
  while (
    room.status === 'clue' &&
    room.clueTurnIndex < room.clueOrder.length &&
    !room.players.get(room.clueOrder[room.clueTurnIndex])?.connected
  ) {
    room.clueTurnIndex += 1;
  }
  if (room.status === 'clue' && room.clueTurnIndex >= room.clueOrder.length) {
    finishCluePhase(room);
  } else if (room.status === 'clue') {
    io.to(room.code).emit('round:turn_changed', {
      currentTurnPlayerId: room.clueOrder[room.clueTurnIndex],
    });
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
  io.to(room.code).emit('round:voting_started', {
    candidates: alivePlayers(room).map((p) => ({ id: p.id, name: p.name })),
  });
}

function resolveVotes(room) {
  const tally = new Map();
  for (const targetId of room.votes.values()) {
    tally.set(targetId, (tally.get(targetId) || 0) + 1);
  }

  let maxVotes = 0;
  for (const count of tally.values()) maxVotes = Math.max(maxVotes, count);

  const topVoted = [...tally.entries()]
    .filter(([, count]) => count === maxVotes)
    .map(([id]) => id);

  if (topVoted.length !== 1) {
    io.to(room.code).emit('round:tie', {
      tiedPlayers: topVoted.map((id) => room.players.get(id)?.name),
    });
    setTimeout(() => startClueRound(room), TIE_DISPLAY_DELAY_MS);
    return;
  }

  const eliminatedId = topVoted[0];
  const eliminated = room.players.get(eliminatedId);
  eliminated.alive = false;
  const wasImpostor = room.impostorIds.has(eliminatedId);

  const votersForImpostorThisRound = [...room.votes.entries()]
    .filter(([, targetId]) => room.impostorIds.has(targetId))
    .map(([voterId]) => voterId);

  io.to(room.code).emit('round:elimination', {
    eliminatedId,
    eliminatedName: eliminated.name,
    wasImpostor,
  });

  room.status = 'reveal';

  const aliveImpostors = alivePlayers(room).filter((p) => room.impostorIds.has(p.id));
  const aliveInnocentsCount = alivePlayers(room).length - aliveImpostors.length;

  if (aliveImpostors.length === 0) {
    setTimeout(() => endManga(room, 'impostors_caught', votersForImpostorThisRound), RESULT_DISPLAY_DELAY_MS);
    return;
  }

  if (aliveImpostors.length >= aliveInnocentsCount) {
    setTimeout(() => endManga(room, 'impostors_win', []), RESULT_DISPLAY_DELAY_MS);
    return;
  }

  aliveImpostors.forEach((imp) => {
    imp.score += 1;
  });

  setTimeout(() => startClueRound(room), RESULT_DISPLAY_DELAY_MS);
}

function endManga(room, result, votersForFinalImpostor) {
  room.status = 'manga_over';
  const impostorNames = [...room.impostorIds]
    .map((id) => room.players.get(id)?.name)
    .filter(Boolean);

  if (result === 'impostors_caught') {
    for (const p of room.players.values()) {
      if (room.impostorIds.has(p.id)) continue;
      p.score += 1;
      if (votersForFinalImpostor.includes(p.id)) p.score += 1;
    }
  } else if (result === 'impostors_win') {
    for (const id of room.impostorIds) {
      const p = room.players.get(id);
      if (p && p.alive) p.score += 3;
    }
  }

  const isLastManga = room.mangaNumber >= room.impostorConfig.mangaCount;

  io.to(room.code).emit('manga:over', {
    result,
    concept: room.concept,
    impostorNames,
    mangaNumber: room.mangaNumber,
    mangaCount: room.impostorConfig.mangaCount,
    isLastManga,
    scores: publicPlayerList(room).sort((a, b) => b.score - a.score),
  });
}

/* =========================================================
   MENTIROSO
   ========================================================= */

function pickLieCategory(room) {
  const pool = LIE_CATEGORIES.filter((c) => {
    if (c.type === 'objetiva') return room.mentirosoConfig.includeObjective;
    return room.mentirosoConfig.includeSubjective;
  });
  const usable = pool.length > 0 ? pool : LIE_CATEGORIES;
  return usable[Math.floor(Math.random() * usable.length)];
}

function startLieSession(room) {
  room.lie.roundNumber = 0;
  room.lie.turnStartIndex = 0;
  startLieRound(room);
}

function startLieRound(room) {
  room.lie.roundNumber += 1;
  room.lie.category = pickLieCategory(room);

  const allIds = [...room.players.keys()];
  const start = room.lie.turnStartIndex % allIds.length;
  room.lie.turnOrder = [...allIds.slice(start), ...allIds.slice(0, start)];
  room.lie.turnStartIndex = (room.lie.turnStartIndex + 1) % allIds.length;

  room.lie.currentTurnIndex = 0;
  room.lie.currentClaim = 0;
  room.lie.lastClaimerId = null;
  room.lie.challenge = null;
  room.status = 'lie_claim';

  emitRoomState(room);
  io.to(room.code).emit('lie:round_started', {
    roundNumber: room.lie.roundNumber,
    roundCount: room.mentirosoConfig.roundCount,
    category: room.lie.category,
    currentTurnPlayerId: currentLieTurnPlayerId(room),
  });
}

function currentLieTurnPlayerId(room) {
  return room.lie.turnOrder[room.lie.currentTurnIndex] || null;
}

function advanceLieTurn(room) {
  const order = room.lie.turnOrder;
  if (order.length === 0) return;
  let tries = 0;
  do {
    room.lie.currentTurnIndex = (room.lie.currentTurnIndex + 1) % order.length;
    tries += 1;
  } while (!room.players.get(order[room.lie.currentTurnIndex])?.connected && tries <= order.length);

  io.to(room.code).emit('lie:turn_changed', {
    currentTurnPlayerId: currentLieTurnPlayerId(room),
  });
}

function resolveLieChallenge(room, success) {
  const { accusedId, accuserId, target, namedSoFar } = room.lie.challenge;
  const accused = room.players.get(accusedId);
  const accuser = room.players.get(accuserId);

  if (success) {
    if (accused) accused.score += 1;
    if (accuser) accuser.score -= 1;
  } else {
    if (accuser) accuser.score += 1;
    if (accused) accused.score -= 1;
  }

  room.status = 'lie_round_over';
  const isLastRound = room.lie.roundNumber >= room.mentirosoConfig.roundCount;

  io.to(room.code).emit('lie:challenge_resolved', {
    success,
    accusedName: accused ? accused.name : '???',
    accuserName: accuser ? accuser.name : '???',
    category: room.lie.category,
    target,
    namedSoFar,
    validAnswers: room.lie.category.type === 'objetiva' ? room.lie.category.validAnswers : null,
    roundNumber: room.lie.roundNumber,
    roundCount: room.mentirosoConfig.roundCount,
    isLastRound,
    scores: publicPlayerList(room).sort((a, b) => b.score - a.score),
  });
}

/* =========================================================
   Socket.io
   ========================================================= */

io.on('connection', (socket) => {
  socket.on('host:create_room', (_payload, callback) => {
    const code = generateRoomCode();
    const room = newRoom(code, socket.id);
    rooms.set(code, room);
    socket.join(code);
    callback({
      ok: true,
      code,
      impostorConfig: room.impostorConfig,
      mentirosoConfig: room.mentirosoConfig,
      categories: ALL_CATEGORIES,
    });
  });

  socket.on('player:join_room', ({ code, name }, callback) => {
    const room = rooms.get((code || '').toUpperCase());
    if (!room) {
      callback({ ok: false, error: 'Sala no encontrada. Revisa el código.' });
      return;
    }
    if (room.status !== 'lobby') {
      callback({ ok: false, error: 'La partida ya empezó, espera a la siguiente.' });
      return;
    }
    const trimmedName = (name || '').trim().slice(0, 20);
    if (!trimmedName) {
      callback({ ok: false, error: 'Ingresa un nombre.' });
      return;
    }
    const nameTaken = [...room.players.values()].some(
      (p) => p.name.toLowerCase() === trimmedName.toLowerCase()
    );
    if (nameTaken) {
      callback({ ok: false, error: 'Ese nombre ya está en uso en la sala.' });
      return;
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: trimmedName,
      score: 0,
      alive: true,
      connected: true,
    });
    socket.join(room.code);
    socket.data.roomCode = room.code;

    callback({ ok: true, code: room.code, playerId: socket.id });
    emitRoomState(room);
  });

  socket.on('host:select_game', ({ code, gameType }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.status !== 'lobby') return;
    if (gameType !== 'impostor' && gameType !== 'mentiroso') return;
    room.gameType = gameType;
    emitRoomState(room);
  });

  socket.on('host:update_impostor_config', ({ code, impostorCount, mangaCount, categories }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.status !== 'lobby') return;

    if (Number.isInteger(impostorCount)) {
      const max = maxImpostorsFor(room.players.size);
      room.impostorConfig.impostorCount = Math.min(Math.max(1, impostorCount), max);
    }
    if (Number.isInteger(mangaCount)) {
      room.impostorConfig.mangaCount = Math.min(Math.max(1, mangaCount), 20);
    }
    if (Array.isArray(categories)) {
      const valid = categories.filter((c) => ALL_CATEGORIES.includes(c));
      room.impostorConfig.categories = valid.length > 0 ? valid : ALL_CATEGORIES.slice();
    }

    emitRoomState(room);
  });

  socket.on('host:update_mentiroso_config', ({ code, roundCount, includeObjective, includeSubjective }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.status !== 'lobby') return;

    if (Number.isInteger(roundCount)) {
      room.mentirosoConfig.roundCount = Math.min(Math.max(1, roundCount), 20);
    }
    if (typeof includeObjective === 'boolean') room.mentirosoConfig.includeObjective = includeObjective;
    if (typeof includeSubjective === 'boolean') room.mentirosoConfig.includeSubjective = includeSubjective;

    if (!room.mentirosoConfig.includeObjective && !room.mentirosoConfig.includeSubjective) {
      room.mentirosoConfig.includeSubjective = true; // al menos un tipo activo
    }

    emitRoomState(room);
  });

  socket.on('host:start_match', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    if (room.players.size < MIN_PLAYERS) return;
    if (!room.gameType) return;

    if (room.gameType === 'impostor') {
      room.mangaNumber = 1;
      startNewManga(room);
    } else if (room.gameType === 'mentiroso') {
      startLieSession(room);
    }
  });

  socket.on('host:next_manga', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.gameType !== 'impostor') return;
    if (room.mangaNumber >= room.impostorConfig.mangaCount) return;
    room.mangaNumber += 1;
    startNewManga(room);
  });

  socket.on('host:next_lie_round', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.gameType !== 'mentiroso') return;
    if (room.lie.roundNumber >= room.mentirosoConfig.roundCount) return;
    startLieRound(room);
  });

  socket.on('player:submit_clue', ({ code, word }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'clue') return;
    if (room.clueOrder[room.clueTurnIndex] !== socket.id) return;

    const clean = (word || '').trim();
    if (!clean) return;
    const norm = normalizeWord(clean);
    if (room.usedClues.includes(norm)) {
      socket.emit('round:clue_rejected', { reason: 'Esa palabra ya se usó en esta partida.' });
      return;
    }

    room.usedClues.push(norm);
    const player = room.players.get(socket.id);
    room.clueLog.push({ playerId: socket.id, name: player.name, word: clean });

    io.to(room.code).emit('round:clue_submitted', {
      playerId: socket.id,
      name: player.name,
      word: clean,
    });

    room.clueTurnIndex += 1;
    advanceClueTurnIfDisconnected(room);
  });

  socket.on('player:submit_vote', ({ code, targetId }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'voting') return;
    const voter = room.players.get(socket.id);
    if (!voter || !voter.alive) return;
    if (!room.players.get(targetId)?.alive) return;

    room.votes.set(socket.id, targetId);
    io.to(room.code).emit('round:vote_registered', {
      votesIn: room.votes.size,
      votesNeeded: connectedAlivePlayers(room).length,
    });

    if (room.votes.size >= connectedAlivePlayers(room).length) {
      resolveVotes(room);
    }
  });

  // ---------- Mentiroso ----------

  socket.on('player:make_claim', ({ code, amount }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'lie_claim') return;
    if (currentLieTurnPlayerId(room) !== socket.id) return;

    const n = Number(amount);
    if (!Number.isInteger(n) || n <= room.lie.currentClaim || n < 1 || n > MAX_CLAIM) {
      socket.emit('lie:claim_rejected', {
        reason: `Debes decir un número entero mayor a ${room.lie.currentClaim}.`,
      });
      return;
    }

    room.lie.currentClaim = n;
    room.lie.lastClaimerId = socket.id;
    const player = room.players.get(socket.id);

    io.to(room.code).emit('lie:claim_made', {
      playerId: socket.id,
      name: player.name,
      amount: n,
    });

    advanceLieTurn(room);
  });

  socket.on('player:accuse_liar', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'lie_claim') return;
    if (currentLieTurnPlayerId(room) !== socket.id) return;
    if (room.lie.currentClaim <= 0 || !room.lie.lastClaimerId) return;

    const accuserId = socket.id;
    const accusedId = room.lie.lastClaimerId;
    room.lie.challenge = {
      accusedId,
      accuserId,
      target: room.lie.currentClaim,
      namedSoFar: [],
      pendingItem: null,
      votes: new Map(),
    };
    room.status = 'lie_naming';

    io.to(room.code).emit('lie:accused', {
      accuserId,
      accuserName: room.players.get(accuserId)?.name,
      accusedId,
      accusedName: room.players.get(accusedId)?.name,
      target: room.lie.currentClaim,
      category: room.lie.category,
    });
  });

  socket.on('player:name_item', ({ code, text }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'lie_naming') return;
    const ch = room.lie.challenge;
    if (!ch || socket.id !== ch.accusedId) return;

    const clean = (text || '').trim();
    if (!clean) return;
    const norm = normalizeWord(clean);

    if (ch.namedSoFar.some((it) => normalizeWord(it) === norm)) {
      io.to(room.code).emit('lie:item_rejected', { text: clean, reason: 'repetido' });
      resolveLieChallenge(room, false);
      return;
    }

    if (room.lie.category.type === 'objetiva') {
      const valid = room.lie.category.validAnswers.some((a) => normalizeWord(a) === norm);
      if (!valid) {
        io.to(room.code).emit('lie:item_rejected', { text: clean, reason: 'no_valido' });
        resolveLieChallenge(room, false);
        return;
      }
      acceptNamedItem(room, clean);
      return;
    }

    // Categoría subjetiva: el grupo vota
    ch.pendingItem = clean;
    ch.votes = new Map();
    room.status = 'lie_voting';

    const eligibleVoters = connectedPlayers(room).filter(
      (p) => p.id !== ch.accusedId && p.id !== ch.accuserId
    );

    io.to(room.code).emit('lie:vote_needed', {
      text: clean,
      votesNeeded: eligibleVoters.length,
      eligibleVoterIds: eligibleVoters.map((p) => p.id),
    });
  });

  socket.on('player:vote_item_validity', ({ code, valid }) => {
    const room = rooms.get(code);
    if (!room || room.status !== 'lie_voting') return;
    const ch = room.lie.challenge;
    if (!ch) return;
    if (socket.id === ch.accusedId || socket.id === ch.accuserId) return;

    ch.votes.set(socket.id, !!valid);

    const eligibleVoters = connectedPlayers(room).filter(
      (p) => p.id !== ch.accusedId && p.id !== ch.accuserId
    );

    io.to(room.code).emit('lie:vote_progress', {
      votesIn: ch.votes.size,
      votesNeeded: eligibleVoters.length,
    });

    if (ch.votes.size >= eligibleVoters.length && eligibleVoters.length > 0) {
      let validCount = 0;
      let invalidCount = 0;
      for (const v of ch.votes.values()) {
        if (v) validCount += 1;
        else invalidCount += 1;
      }
      const accepted = validCount >= invalidCount; // empate = válido

      room.status = 'lie_naming';
      io.to(room.code).emit('lie:vote_result', {
        text: ch.pendingItem,
        accepted,
        validCount,
        invalidCount,
      });

      if (!accepted) {
        resolveLieChallenge(room, false);
        return;
      }
      acceptNamedItem(room, ch.pendingItem);
    }
  });

  function acceptNamedItem(room, text) {
    const ch = room.lie.challenge;
    ch.namedSoFar.push(text);
    ch.pendingItem = null;

    io.to(room.code).emit('lie:item_accepted', {
      text,
      count: ch.namedSoFar.length,
      target: ch.target,
    });

    if (ch.namedSoFar.length >= ch.target) {
      resolveLieChallenge(room, true);
    }
  }

  socket.on('host:new_session', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    room.status = 'lobby';
    room.gameType = null;
    room.concept = null;
    room.impostorIds = new Set();
    room.usedClues = [];
    room.clueLog = [];
    room.roundNumber = 0;
    room.mangaNumber = 0;
    room.lie = {
      roundNumber: 0,
      turnStartIndex: 0,
      category: null,
      turnOrder: [],
      currentTurnIndex: 0,
      currentClaim: 0,
      lastClaimerId: null,
      challenge: null,
    };
    for (const p of room.players.values()) {
      p.alive = true;
      p.score = 0;
    }
    emitRoomState(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    const player = room.players.get(socket.id);
    if (player) {
      if (room.status === 'lobby') {
        room.players.delete(socket.id);
      } else {
        player.connected = false;
        if (room.status === 'clue' && room.clueOrder[room.clueTurnIndex] === socket.id) {
          advanceClueTurnIfDisconnected(room);
        }
        if (
          room.status === 'voting' &&
          room.votes.size >= connectedAlivePlayers(room).length &&
          connectedAlivePlayers(room).length > 0
        ) {
          resolveVotes(room);
        }
        if (room.status === 'lie_claim' && currentLieTurnPlayerId(room) === socket.id) {
          advanceLieTurn(room);
        }
      }
      emitRoomState(room);
    }

    if (socket.id === room.hostId && room.players.size === 0) {
      rooms.delete(code);
    }
  });
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/host', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host', 'index.html'));
});
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player', 'index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`412 corriendo en http://localhost:${PORT}`);
  console.log(`Host: http://localhost:${PORT}/host`);
});
