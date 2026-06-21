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

// ---------- Estado en memoria ----------
/** rooms: Map<code, RoomState> */
const rooms = new Map();

const MIN_PLAYERS = 3;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres confusos
const CLUE_PHASE_END_DELAY_MS = 4500;
const RESULT_DISPLAY_DELAY_MS = 3500;
const TIE_DISPLAY_DELAY_MS = 4000;

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
    status: 'lobby', // lobby | clue | voting | reveal | manga_over
    config: {
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
  };
}

function alivePlayers(room) {
  return [...room.players.values()].filter((p) => p.alive);
}

function connectedAlivePlayers(room) {
  return alivePlayers(room).filter((p) => p.connected);
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
    config: room.config,
    maxImpostors: maxImpostorsFor(room.players.size),
  });
}

function startNewManga(room) {
  const pool = CONCEPTS.filter((c) => room.config.categories.includes(c.category));
  const usablePool = pool.length > 0 ? pool : CONCEPTS;
  room.concept = usablePool[Math.floor(Math.random() * usablePool.length)];

  const ids = shuffle([...room.players.keys()]);
  const impostorCount = Math.min(room.config.impostorCount, maxImpostorsFor(room.players.size));
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
    mangaCount: room.config.mangaCount,
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
  // Salta automáticamente turnos de jugadores desconectados para no trabar la partida
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
  if (room.cluePhaseEnding) return; // evita doble timer si se dispara dos veces
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
    // Empate: nadie sale, nueva ronda de pistas
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

  // El juego sigue: cada impostor que sigue vivo gana un punto por sobrevivir esta ronda
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
      if (votersForFinalImpostor.includes(p.id)) p.score += 1; // bonus detective
    }
  } else if (result === 'impostors_win') {
    for (const id of room.impostorIds) {
      const p = room.players.get(id);
      if (p && p.alive) p.score += 3; // bonus por imponerse en número
    }
  }

  const isLastManga = room.mangaNumber >= room.config.mangaCount;

  io.to(room.code).emit('manga:over', {
    result,
    concept: room.concept,
    impostorNames,
    mangaNumber: room.mangaNumber,
    mangaCount: room.config.mangaCount,
    isLastManga,
    scores: publicPlayerList(room).sort((a, b) => b.score - a.score),
  });
}

// ---------- Socket.io ----------
io.on('connection', (socket) => {
  socket.on('host:create_room', (_payload, callback) => {
    const code = generateRoomCode();
    const room = newRoom(code, socket.id);
    rooms.set(code, room);
    socket.join(code);
    callback({ ok: true, code, config: room.config, categories: ALL_CATEGORIES });
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

  socket.on('host:update_config', ({ code, impostorCount, mangaCount, categories }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId || room.status !== 'lobby') return;

    if (Number.isInteger(impostorCount)) {
      const max = maxImpostorsFor(room.players.size);
      room.config.impostorCount = Math.min(Math.max(1, impostorCount), max);
    }
    if (Number.isInteger(mangaCount)) {
      room.config.mangaCount = Math.min(Math.max(1, mangaCount), 20);
    }
    if (Array.isArray(categories)) {
      const valid = categories.filter((c) => ALL_CATEGORIES.includes(c));
      room.config.categories = valid.length > 0 ? valid : ALL_CATEGORIES.slice();
    }

    emitRoomState(room);
  });

  socket.on('host:start_match', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    if (room.players.size < MIN_PLAYERS) return;

    room.mangaNumber = 1;
    startNewManga(room);
  });

  socket.on('host:next_manga', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    if (room.mangaNumber >= room.config.mangaCount) return;
    room.mangaNumber += 1;
    startNewManga(room);
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

  socket.on('host:new_session', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    room.status = 'lobby';
    room.concept = null;
    room.impostorIds = new Set();
    room.usedClues = [];
    room.clueLog = [];
    room.roundNumber = 0;
    room.mangaNumber = 0;
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
  console.log(`412 - El Impostor corriendo en http://localhost:${PORT}`);
  console.log(`Host: http://localhost:${PORT}/host`);
});
