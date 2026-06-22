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
let currentGameType = null;
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
  lieClaim: document.getElementById('screen-lie-claim'),
  lieNaming: document.getElementById('screen-lie-naming'),
  lieFinalVote: document.getElementById('screen-lie-final-vote'),
  lieRoundOver: document.getElementById('screen-lie-round-over'),
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
    document.getElementById('room-code').textContent = roomCode;
    document.getElementById('join-url').textContent = `${window.location.origin}`;
    renderCategoryChecks(res.categories, res.impostorConfig.categories);
    showScreen('lobby');
  });
});

// ---------- Lobby: jugadores + elegir juego + config ----------
socket.on('room:players_update', (state) => {
  currentPlayersSnapshot = state.players;
  currentGameType = state.gameType;
  if (state.maxImpostors) currentMaxImpostors = state.maxImpostors;

  if (state.status === 'lobby') {
    renderLobbyPlayers(state.players);
    renderGamePicker(state.gameType);
    if (state.gameType === 'impostor') renderImpostorOptions(state.impostorConfig);
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
  updateStartButton(players.length);
}

function updateStartButton(playerCount) {
  const startBtn = document.getElementById('btn-start-match');
  const hint = document.getElementById('start-hint');
  const canStart = playerCount >= 3 && currentGameType;
  startBtn.classList.toggle('hidden', !currentGameType);
  startBtn.disabled = !canStart;
  if (!currentGameType) {
    hint.textContent = 'Elige un juego para continuar';
  } else if (playerCount < 3) {
    hint.textContent = 'Necesitas al menos 3 jugadores';
  } else {
    hint.textContent = 'Listos para arrancar';
  }
}

function renderGamePicker(gameType) {
  document.getElementById('game-picker').classList.toggle('hidden', !!gameType);
  document.getElementById('config-impostor').classList.toggle('hidden', gameType !== 'impostor');
  document.getElementById('config-mentiroso').classList.toggle('hidden', gameType !== 'mentiroso');
}

document.getElementById('pick-impostor').addEventListener('click', () => {
  socket.emit('host:select_game', { code: roomCode, gameType: 'impostor' });
});
document.getElementById('pick-mentiroso').addEventListener('click', () => {
  socket.emit('host:select_game', { code: roomCode, gameType: 'mentiroso' });
});
document.getElementById('btn-change-game-1').addEventListener('click', backToGamePicker);
document.getElementById('btn-change-game-2').addEventListener('click', backToGamePicker);
function backToGamePicker() {
  // El servidor no tiene un evento para "deseleccionar"; simplemente mostramos
  // el picker localmente y al elegir otro juego se sobreescribe en el servidor.
  currentGameType = null;
  renderGamePicker(null);
  updateStartButton(currentPlayersSnapshot.length);
}

function renderImpostorOptions(config) {
  const select = document.getElementById('cfg-impostors');
  const previousValue = Number(select.value) || config.impostorCount || 1;
  select.innerHTML = '';
  for (let i = 1; i <= currentMaxImpostors; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = i;
    select.appendChild(opt);
  }
  select.value = Math.min(previousValue, currentMaxImpostors);
  document.getElementById('cfg-mangas').value = config.mangaCount;
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
      sendImpostorConfigUpdate();
    });
    wrap.appendChild(label);
  });
}

function sendImpostorConfigUpdate() {
  const impostorCount = Number(document.getElementById('cfg-impostors').value);
  const mangaCount = Number(document.getElementById('cfg-mangas').value);
  const categories = [...document.querySelectorAll('#category-checks input:checked')].map((i) => i.value);
  socket.emit('host:update_impostor_config', { code: roomCode, impostorCount, mangaCount, categories });
}
document.getElementById('cfg-impostors').addEventListener('change', sendImpostorConfigUpdate);
document.getElementById('cfg-mangas').addEventListener('change', sendImpostorConfigUpdate);

function sendMentirosoConfigUpdate() {
  const roundCount = Number(document.getElementById('cfg-lie-rounds').value);
  const mode = document.querySelector('input[name="lie-mode"]:checked').value;
  socket.emit('host:update_mentiroso_config', { code: roomCode, roundCount, mode });
}
document.getElementById('cfg-lie-rounds').addEventListener('change', sendMentirosoConfigUpdate);
document.querySelectorAll('input[name="lie-mode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    document.getElementById('mode-chip-texto').classList.toggle('checked', document.querySelector('input[name="lie-mode"][value="texto"]').checked);
    document.getElementById('mode-chip-voz').classList.toggle('checked', document.querySelector('input[name="lie-mode"][value="voz"]').checked);
    sendMentirosoConfigUpdate();
  });
});

document.getElementById('btn-start-match').addEventListener('click', () => {
  socket.emit('host:start_match', { code: roomCode });
});

/* =========================================================
   EL IMPOSTOR
   ========================================================= */

socket.on('manga:started', ({ mangaNumber, mangaCount }) => {
  document.getElementById('clue-manga-label').textContent = `Manga ${mangaNumber} de ${mangaCount}`;
});

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

socket.on('round:voting_started', ({ candidates }) => {
  document.getElementById('vote-progress').textContent = `0 / ${candidates.length} votos`;
  showScreen('voting');
});

socket.on('round:vote_registered', ({ votesIn, votesNeeded }) => {
  document.getElementById('vote-progress').textContent = `${votesIn} / ${votesNeeded} votos`;
});

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

socket.on('round:tie', ({ tiedPlayers }) => {
  document.getElementById('tie-names').textContent = tiedPlayers.join(' vs. ');
  showScreen('tie');
});

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

  renderScoreboard('final-scoreboard', scores);

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

function renderScoreboard(elementId, scores) {
  const board = document.getElementById(elementId);
  board.innerHTML = '';
  scores.forEach((p, idx) => {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.innerHTML = `<span class="rank">#${idx + 1}</span><span style="flex:1; margin-left:10px;">${escapeHtml(p.name)}</span><span class="points">${p.score} pts</span>`;
    board.appendChild(row);
  });
}

/* =========================================================
   MENTIROSO
   ========================================================= */

let countdownInterval = null;

function startCountdown(deadlineAt) {
  stopCountdown();
  const circle = document.getElementById('lie-countdown');
  function tick() {
    const remaining = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
    circle.textContent = remaining;
    circle.classList.toggle('urgent', remaining <= 3);
    if (remaining <= 0) stopCountdown();
  }
  tick();
  countdownInterval = setInterval(tick, 250);
}

function stopCountdown() {
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

socket.on('lie:round_started', ({ roundNumber, roundCount, category, currentTurnPlayerId }) => {
  document.getElementById('lie-round-number').textContent = roundNumber;
  document.getElementById('lie-round-count').textContent = roundCount;
  document.getElementById('lie-category-prompt').textContent = category;
  document.getElementById('lie-current-claim').textContent = '0';
  document.getElementById('lie-claim-log').innerHTML = '';
  renderLieTurn(currentTurnPlayerId);
  showScreen('lieClaim');
});

socket.on('lie:turn_changed', ({ currentTurnPlayerId }) => {
  renderLieTurn(currentTurnPlayerId);
});

function renderLieTurn(currentTurnPlayerId) {
  const player = currentPlayersSnapshot.find((p) => p.id === currentTurnPlayerId);
  document.getElementById('lie-turn-name').textContent = player ? player.name : '—';
}

socket.on('lie:claim_made', ({ name, amount }) => {
  document.getElementById('lie-current-claim').textContent = amount;
  const log = document.getElementById('lie-claim-log');
  const item = document.createElement('div');
  item.className = 'clue-item';
  item.innerHTML = `<span>Dice poder nombrar ${amount}</span><span class="who">${escapeHtml(name)}</span>`;
  log.prepend(item);
});

socket.on('lie:accused', ({ accuserName, accusedName, target, category, mode, deadlineAt }) => {
  document.getElementById('lie-accused-name').textContent = accusedName;
  document.getElementById('lie-target-number').textContent = target;
  document.getElementById('lie-target-number-2').textContent = target;
  document.getElementById('lie-named-count').textContent = '0';
  document.getElementById('lie-category-prompt-2').textContent = `${accuserName} no le creyó a ${accusedName}. Categoría: ${category}`;
  document.getElementById('lie-mode-hint').textContent =
    mode === 'voz'
      ? `${accuserName} va marcando cada respuesta correcta que escucha en voz alta`
      : `${accusedName} está escribiendo las respuestas`;
  document.getElementById('lie-named-log').innerHTML = '';
  startCountdown(deadlineAt);
  showScreen('lieNaming');
});

socket.on('lie:answer_marked', ({ count, target, deadlineAt }) => {
  document.getElementById('lie-named-count').textContent = count;
  const log = document.getElementById('lie-named-log');
  const item = document.createElement('div');
  item.className = 'clue-item';
  item.innerHTML = `<span>Respuesta ${count}</span><span class="who">✓ marcada</span>`;
  log.prepend(item);
  if (deadlineAt) startCountdown(deadlineAt);
  else stopCountdown();
});

socket.on('lie:item_submitted', ({ text, count, target, deadlineAt }) => {
  document.getElementById('lie-named-count').textContent = count;
  const log = document.getElementById('lie-named-log');
  const item = document.createElement('div');
  item.className = 'clue-item';
  item.innerHTML = `<span>${escapeHtml(text)}</span><span class="who">#${count}</span>`;
  log.prepend(item);
  if (deadlineAt) startCountdown(deadlineAt);
  else stopCountdown();
});

socket.on('lie:final_vote_needed', ({ target, mode, namedSoFar }) => {
  stopCountdown();
  document.getElementById('lie-finalvote-title').textContent = `¿Las ${target} respuestas fueron válidas?`;
  const list = document.getElementById('lie-finalvote-list');
  list.innerHTML = '';
  if (mode === 'texto' && namedSoFar) {
    namedSoFar.forEach((text) => {
      const item = document.createElement('div');
      item.className = 'clue-item';
      item.innerHTML = `<span>${escapeHtml(text)}</span>`;
      list.appendChild(item);
    });
  }
  document.getElementById('lie-finalvote-progress').textContent = 'Esperando votos...';
  showScreen('lieFinalVote');
});

socket.on('lie:final_vote_progress', ({ votesIn, votesNeeded }) => {
  document.getElementById('lie-finalvote-progress').textContent = `${votesIn} / ${votesNeeded} votos`;
});

let lastLieRoundWasFinal = false;

socket.on('lie:challenge_resolved', ({ success, reason, accusedName, accuserName, category, target, count, namedSoFar, mode, roundNumber, roundCount, isLastRound, scores }) => {
  stopCountdown();
  lastLieRoundWasFinal = isLastRound;

  const banner = document.getElementById('lie-result-banner');
  banner.className = 'reveal-banner ' + (success ? 'caught' : 'escaped');
  document.getElementById('lie-result-eyebrow').textContent = `Ronda ${roundNumber} de ${roundCount}`;

  let title = success ? `${accusedName} sí pudo` : `${accusedName} no pudo`;
  let subtitle = `Categoría: ${category} (decía ${target})`;
  if (reason === 'timeout') subtitle = `Se le acabó el tiempo a ${accusedName}. ` + subtitle;
  if (reason === 'vote' && !success) subtitle = `El grupo no le creyó. ` + subtitle;

  document.getElementById('lie-result-title').textContent = title;
  document.getElementById('lie-result-subtitle').textContent = subtitle;

  const list = document.getElementById('lie-result-list');
  list.innerHTML = '';
  if (mode === 'texto') {
    namedSoFar.forEach((text) => {
      const item = document.createElement('div');
      item.className = 'clue-item';
      item.innerHTML = `<span>${escapeHtml(text)}</span>`;
      list.appendChild(item);
    });
  }
  document.getElementById('lie-reveal-heading').textContent = `Llegó a ${count} de ${target}`;

  renderScoreboard('lie-scoreboard', scores);

  const nextBtn = document.getElementById('btn-next-lie-round');
  nextBtn.textContent = isLastRound ? 'Ver resultado final y reiniciar' : 'Siguiente ronda';

  showScreen('lieRoundOver');
});

document.getElementById('btn-next-lie-round').addEventListener('click', () => {
  if (lastLieRoundWasFinal) {
    socket.emit('host:new_session', { code: roomCode });
    showScreen('lobby');
  } else {
    socket.emit('host:next_lie_round', { code: roomCode });
  }
});
