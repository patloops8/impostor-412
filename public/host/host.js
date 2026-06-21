const socket = io();

const connBanner = document.getElementById('connection-banner');
socket.on('connect', () => {
  connBanner.classList.remove('error');
  connBanner.classList.add('hidden');
});
socket.on('disconnect', () => {
  connBanner.textContent = 'Se perdió la conexión, reconectando...';
  connBanner.classList.add('error');
  connBanner.classList.remove('hidden');
});
socket.on('connect_error', () => {
  connBanner.textContent = 'No se pudo conectar al servidor, reintentando...';
  connBanner.classList.add('error');
  connBanner.classList.remove('hidden');
});

let roomCode = null;
let currentPlayersSnapshot = [];
let currentConfig = { impostorCount: 1, mangaCount: 3, categories: [] };
let currentMaxImpostors = 1;

const CATEGORY_LABELS = {
  futbolista: 'Futbolistas',
  equipo: 'Equipos',
  selección: 'Selecciones',
  dt: 'DTs',
};

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Crear sala ----------
document.getElementById('btn-create-room').addEventListener('click', () => {
  socket.emit('host:create_room', {}, (res) => {
    if (!res.ok) return;
    roomCode = res.code;
    currentConfig = res.config;
    document.getElementById('room-code').textContent = roomCode;
    document.getElementById('join-url').textContent = `${window.location.origin}`;
    renderCategoryChecks(res.categories, res.config.categories);
    showScreen('lobby');
  });
});

// ---------- Lobby: lista de jugadores + configuración ----------
socket.on('room:players_update', ({ players, status, config, maxImpostors }) => {
  currentPlayersSnapshot = players;
  if (config) currentConfig = config;
  if (maxImpostors) currentMaxImpostors = maxImpostors;
  if (status === 'lobby') {
    renderLobbyPlayers(players);
    renderImpostorOptions();
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

function renderImpostorOptions() {
  const select = document.getElementById('cfg-impostors');
  const previousValue = Number(select.value) || currentConfig.impostorCount || 1;
  select.innerHTML = '';
  for (let i = 1; i <= currentMaxImpostors; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i;
    select.appendChild(opt);
  }
  select.value = Math.min(previousValue, currentMaxImpostors);
}

function renderCategoryChecks(allCategories, selectedCategories) {
  const wrap = document.getElementById('category-checks');
  wrap.innerHTML = '';
  allCategories.forEach((cat) => {
    const label = document.createElement('label');
    label.className = 'category-chip' + (selectedCategories.includes(cat) ? ' checked' : '');
    label.innerHTML = `<input type="checkbox" value="${cat}" ${selectedCategories.includes(cat) ? 'checked' : ''}/> ${CATEGORY_LABELS[cat] || cat}`;
    label.querySelector('input').addEventListener('change', () => {
      label.classList.toggle('checked');
      sendConfigUpdate();
    });
    wrap.appendChild(label);
  });
}

function sendConfigUpdate() {
  const impostorCount = Number(document.getElementById('cfg-impostors').value);
  const mangaCount = Number(document.getElementById('cfg-mangas').value);
  const categories = [...document.querySelectorAll('#category-checks input:checked')].map((i) => i.value);
  socket.emit('host:update_config', { code: roomCode, impostorCount, mangaCount, categories });
}

document.getElementById('cfg-impostors').addEventListener('change', sendConfigUpdate);
document.getElementById('cfg-mangas').addEventListener('change', sendConfigUpdate);

document.getElementById('btn-start-match').addEventListener('click', () => {
  socket.emit('host:start_match', { code: roomCode });
});

// ---------- Inicio de manga ----------
socket.on('manga:started', ({ mangaNumber, mangaCount }) => {
  document.getElementById('clue-manga-label').textContent = `Manga ${mangaNumber} de ${mangaCount}`;
});

// ---------- Ronda de pistas ----------
socket.on('round:started', ({ roundNumber, currentTurnPlayerId }) => {
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
    ? 'Era impostor. Sigue la partida si quedan más por atrapar.'
    : 'Era inocente. La partida sigue...';
  showScreen('reveal');
});

// ---------- Empate ----------
socket.on('round:tie', ({ tiedPlayers }) => {
  document.getElementById('tie-names').textContent = tiedPlayers.join(' vs. ');
  showScreen('tie');
});

// ---------- Fin de manga / sesión ----------
let lastMangaWasFinal = false;

socket.on('manga:over', ({ result, concept, impostorNames, mangaNumber, mangaCount, isLastManga, scores }) => {
  lastMangaWasFinal = isLastManga;

  const banner = document.getElementById('final-banner');
  banner.className = 'reveal-banner ' + (result === 'impostors_caught' ? 'caught' : 'escaped');
  document.getElementById('final-eyebrow').textContent =
    (result === 'impostors_caught' ? 'Impostores atrapados' : 'Los impostores se impusieron') +
    ` · Manga ${mangaNumber} de ${mangaCount}`;
  const names = impostorNames.join(', ');
  document.getElementById('final-title').textContent =
    impostorNames.length > 1 ? `${names} eran los impostores` : `${names} era el impostor`;
  document.getElementById('final-subtitle').textContent = `El concepto era: ${concept.name} (${concept.category})`;

  const board = document.getElementById('final-scoreboard');
  board.innerHTML = '';
  scores.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.innerHTML = `<span class="rank">#${idx + 1}</span><span style="flex:1; margin-left:10px;">${escapeHtml(p.name)}</span><span class="points">${p.score} pts</span>`;
    board.appendChild(row);
  });

  const nextBtn = document.getElementById('btn-next-match');
  nextBtn.textContent = isLastManga ? 'Ver resultado final y reiniciar' : 'Siguiente manga';

  showScreen('matchOver');
});

document.getElementById('btn-next-match').addEventListener('click', () => {
  if (lastMangaWasFinal) {
    socket.emit('host:new_session', { code: roomCode });
    showScreen('lobby');
  } else {
    socket.emit('host:next_manga', { code: roomCode });
  }
});
