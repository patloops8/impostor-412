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

// ---------- Estado en memoria ----------
/** rooms: Map<code, RoomState> */
const rooms = new Map();

const MIN_PLAYERS = 3;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sin caracteres confusos

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

function newRoom(code, hostSocketId) {
  return {
    code,
    hostId: hostSocketId,
    players: new Map(), // socketId -> { id, name, score, alive, connected }
    status: 'lobby', // lobby | clue | voting | reveal | match_over
    concept: null,
    impostorId: null,
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
  });
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

const CLUE_PHASE_END_DELAY_MS = 4500;

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
    setTimeout(() => startClueRound(room), 4000);
    return;
  }

  const eliminatedId = topVoted[0];
  const eliminated = room.players.get(eliminatedId);
  eliminated.alive = false;
  const wasImpostor = eliminatedId === room.impostorId;

  const votersForImpostorThisRound = [...room.votes.entries()]
    .filter(([, targetId]) => targetId === room.impostorId)
    .map(([voterId]) => voterId);

  io.to(room.code).emit('round:elimination', {
    eliminatedId,
    eliminatedName: eliminated.name,
    wasImpostor,
  });

  room.status = 'reveal';

  if (wasImpostor) {
    setTimeout(() => endMatch(room, 'impostor_caught', votersForImpostorThisRound), 3500);
    return;
  }

  // El impostor sobrevive esta ronda
  const impostor = room.players.get(room.impostorId);
  if (impostor) impostor.score += 1;

  if (alivePlayers(room).length <= 2) {
    setTimeout(() => endMatch(room, 'impostor_escaped', []), 3500);
    return;
  }

  setTimeout(() => startClueRound(room), 3500);
}

function endMatch(room, result, votersForImpostor) {
  room.status = 'match_over';
  const impostor = room.players.get(room.impostorId);

  if (result === 'impostor_caught') {
    for (const p of room.players.values()) {
      if (p.id === room.impostorId) continue;
      p.score += 1;
      if (votersForImpostor.includes(p.id)) p.score += 1; // bonus detective
    }
  } else if (result === 'impostor_escaped') {
    if (impostor) impostor.score += 3; // bonus final 2
  }

  io.to(room.code).emit('match:over', {
    result,
    concept: room.concept,
    impostorId: room.impostorId,
    impostorName: impostor ? impostor.name : null,
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
    callback({ ok: true, code });
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

  socket.on('host:start_match', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    if (room.players.size < MIN_PLAYERS) return;

    room.concept = CONCEPTS[Math.floor(Math.random() * CONCEPTS.length)];
    const ids = [...room.players.keys()];
    room.impostorId = ids[Math.floor(Math.random() * ids.length)];
    room.usedClues = [];

    for (const p of room.players.values()) {
      p.alive = true;
    }

    for (const [id, p] of room.players.entries()) {
      const isImpostor = id === room.impostorId;
      io.to(id).emit('match:your_role', {
        isImpostor,
        category: isImpostor ? null : room.concept.category,
        concept: isImpostor ? null : room.concept.name,
      });
    }

    emitRoomState(room);
    startClueRound(room);
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

  socket.on('host:next_match', ({ code }) => {
    const room = rooms.get(code);
    if (!room || socket.id !== room.hostId) return;
    room.status = 'lobby';
    room.concept = null;
    room.impostorId = null;
    room.usedClues = [];
    room.clueLog = [];
    room.roundNumber = 0;
    for (const p of room.players.values()) p.alive = true;
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
