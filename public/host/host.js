const socket = io();

let roomCode = null;

const screens = {
  create: document.getElementById('screen-create'),
  lobby: document.getElementById('screen-lobby'),
  clue: document.getElementById('screen-clue'),
  voting: document.getElementById('screen-voting'),
  reveal: document.getElementById('screen-reveal'),
  tie: document.getElementById('screen-tie'),
  matchOver: document.getElementById('screen-match-over'),
};

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

// ---------- Crear sala ----------
document.getElementById('btn-create-room').addEventListener('click', () => {
  socket.emit('host:create_room', {}, (res) => {
    if (!res.ok) return;
    roomCode = res.code;
    document.getElementById('room-code').textContent = roomCode;
    document.getElementById('join-url').textContent = `${window.location.origin}`;
    showScreen('lobby');
  });
});

// ---------- Lobby: lista de jugadores ----------
socket.on('room:players_update', ({ players, status }) => {
  if (status === 'lobby') {
    renderLobbyPlayers(players);
  }
});

function renderLobbyPlayers(players) {
  const grid = document.getElementById('lobby-players');
  grid.innerHTML = '';
  players.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    chip.innerHTML = `<div class="name">${escapeHtml(p.name)}</div><div class="meta">${p.connected ? 'conectado' : 'desconectado'}</div>`;
    grid.appendChild(chip);
  });
  document.getElementById('player-count').textContent = players.length;

  const startBtn = document.getElementById('btn-start-match');
  const hint = document.getElementById('start-hint');
  if (players.length >= 3) {
    startBtn.disabled = false;
    hint.textContent = 'Listos para arrancar';
  } else {
    startBtn.disabled = true;
    hint.textContent = 'Necesitas al menos 3 jugadores';
  }
}

document.getElementById('btn-start-match').addEventListener('click', () => {
  socket.emit('host:start_match', { code: roomCode });
});

// ---------- Ronda de pistas ----------
let currentPlayersSnapshot = [];

socket.on('round:started', ({ roundNumber, turnOrder, currentTurnPlayerId }) => {
  document.getElementById('clue-round-number').textContent = roundNumber;
  document.getElementById('clue-log').innerHTML = '';
  renderClueTurn(currentTurnPlayerId);
  showScreen('clue');
});

socket.on('round:turn_changed', ({ currentTurnPlayerId }) => {
  renderClueTurn(currentTurnPlayerId);
});

function renderClueTurn(currentTurnPlayerId) {
  const grid = document.getElementById('clue-player-grid');
  grid.innerHTML = '';
  currentPlayersSnapshot.forEach((p) => {
    const chip = document.createElement('div');
    chip.className = 'player-chip' + (!p.alive ? ' dead' : '') + (p.id === currentTurnPlayerId ? ' turn' : '');
    chip.innerHTML = `<div class="name">${escapeHtml(p.name)}</div>`;
    grid.appendChild(chip);
  });
  const turnPlayer = currentPlayersSnapshot.find((p) => p.id === currentTurnPlayerId);
  document.getElementById('clue-turn-name').textContent = turnPlayer ? turnPlayer.name : '—';
}

socket.on('room:players_update', ({ players }) => {
  currentPlayersSnapshot = players;
});

socket.on('round:clue_submitted', ({ name, word }) => {
  const log = document.getElementById('clue-log');
  const item = document.createElement('div');
  item.className = 'clue-item';
  item.innerHTML = `<span>${escapeHtml(word)}</span><span class="who">${escapeHtml(name)}</span>`;
  log.prepend(item);
});

socket.on('round:clue_phase_ending', () => {
  document.getElementById('clue-turn-name').textContent = 'Todas las pistas listas';
  document.querySelectorAll('#clue-player-grid .player-chip').forEach((c) => c.classList.remove('turn'));
});

// ---------- Votación ----------
socket.on('round:voting_started', ({ candidates }) => {
  document.getElementById('vote-progress').textContent = `0 / ${candidates.length} votos`;
  showScreen('voting');
});

socket.on('round:vote_registered', ({ votesIn, votesNeeded }) => {
  document.getElementById('vote-progress').textContent = `${votesIn} / ${votesNeeded} votos`;
});

// ---------- Eliminación / revelación ----------
socket.on('round:elimination', ({ eliminatedName, wasImpostor }) => {
  const banner = document.getElementById('reveal-banner');
  banner.className = 'reveal-banner ' + (wasImpostor ? 'caught' : 'escaped');
  document.getElementById('reveal-eyebrow').textContent = wasImpostor ? '¡Atrapado!' : 'Era inocente...';
  document.getElementById('reveal-title').textContent = eliminatedName;
  document.getElementById('reveal-subtitle').textContent = wasImpostor
    ? 'Era el impostor. Ganan los inocentes.'
    : 'El impostor sigue libre. Nueva ronda...';
  showScreen('reveal');
});

// ---------- Empate ----------
socket.on('round:tie', ({ tiedPlayers }) => {
  document.getElementById('tie-names').textContent = tiedPlayers.join(' vs. ');
  showScreen('tie');
});

// ---------- Fin de partida ----------
socket.on('match:over', ({ result, concept, impostorName, scores }) => {
  const banner = document.getElementById('final-banner');
  banner.className = 'reveal-banner ' + (result === 'impostor_caught' ? 'caught' : 'escaped');
  document.getElementById('final-eyebrow').textContent =
    result === 'impostor_caught' ? 'Impostor atrapado' : 'El impostor escapó';
  document.getElementById('final-title').textContent = `${impostorName} era el impostor`;
  document.getElementById('final-subtitle').textContent = `El concepto era: ${concept.name} (${concept.category})`;

  const board = document.getElementById('final-scoreboard');
  board.innerHTML = '';
  scores.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.innerHTML = `<span class="rank">#${idx + 1}</span><span style="flex:1; margin-left:10px;">${escapeHtml(p.name)}</span><span class="points">${p.score} pts</span>`;
    board.appendChild(row);
  });

  showScreen('matchOver');
});

document.getElementById('btn-next-match').addEventListener('click', () => {
  socket.emit('host:next_match', { code: roomCode });
  showScreen('lobby');
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
