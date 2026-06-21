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
let myId = null;
let latestRound = { roundNumber: 0, currentTurnPlayerId: null };
let currentPlayersSnapshot = [];
let selectedVoteTarget = null;
let currentMangaInfo = { mangaNumber: 1, mangaCount: 1 };

const screens = {
  join: document.getElementById('screen-join'),
  waiting: document.getElementById('screen-waiting'),
  role: document.getElementById('screen-role'),
  cluePhase: document.getElementById('screen-clue-phase'),
  vote: document.getElementById('screen-vote'),
  revealPlayer: document.getElementById('screen-reveal-player'),
  tiePlayer: document.getElementById('screen-tie-player'),
  matchOverPlayer: document.getElementById('screen-match-over-player'),
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

// ---------- Unirse ----------
document.getElementById('btn-join').addEventListener('click', joinRoom);
document.getElementById('input-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

function joinRoom() {
  const code = document.getElementById('input-code').value.trim().toUpperCase();
  const name = document.getElementById('input-name').value.trim();
  const errorEl = document.getElementById('join-error');
  errorEl.classList.add('hidden');

  if (!code || !name) {
    errorEl.textContent = 'Completa el código y tu nombre.';
    errorEl.classList.remove('hidden');
    return;
  }

  socket.emit('player:join_room', { code, name }, (res) => {
    if (!res.ok) {
      errorEl.textContent = res.error;
      errorEl.classList.remove('hidden');
      return;
    }
    roomCode = res.code;
    myId = res.playerId;
    showScreen('waiting');
  });
}

socket.on('room:players_update', ({ players }) => {
  currentPlayersSnapshot = players;
});

// ---------- Inicio de manga ----------
socket.on('manga:started', ({ mangaNumber, mangaCount }) => {
  currentMangaInfo = { mangaNumber, mangaCount };
});

// ---------- Rol ----------
socket.on('match:your_role', ({ isImpostor, impostorCount, category, concept }) => {
  const card = document.getElementById('role-card');
  const label = document.getElementById('role-label');
  const conceptEl = document.getElementById('role-concept');
  const hint = document.getElementById('role-hint');

  if (isImpostor) {
    card.className = 'role-card impostor';
    label.textContent = 'Eres el impostor';
    conceptEl.textContent = '???';
    hint.textContent =
      impostorCount > 1
        ? `Hay ${impostorCount} impostores en esta manga (tú eres uno, no sabes quiénes son los demás). No sabes el concepto, disimula.`
        : 'No sabes el concepto. Escucha las pistas y disimula.';
  } else {
    card.className = 'role-card innocent';
    label.textContent = `Tu concepto (${category})`;
    conceptEl.textContent = concept;
    hint.textContent =
      impostorCount > 1
        ? `Hay ${impostorCount} impostores entre ustedes. No lo digas directamente, da una pista relacionada.`
        : 'No lo digas directamente. Da una pista relacionada.';
  }

  showScreen('role');
});

document.getElementById('btn-role-continue').addEventListener('click', () => {
  renderCluePhase();
  showScreen('cluePhase');
});

// ---------- Fase de pistas ----------
socket.on('round:started', ({ roundNumber, currentTurnPlayerId }) => {
  latestRound = { roundNumber, currentTurnPlayerId };
  document.getElementById('clue-log-player').innerHTML = '';
  // Si ya estoy en la pantalla de rol (recién empezó la manga), se actualizará al dar "Continuar".
  if (!screens.role.classList.contains('hidden')) return;
  renderCluePhase();
  showScreen('cluePhase');
});

socket.on('round:turn_changed', ({ currentTurnPlayerId }) => {
  latestRound.currentTurnPlayerId = currentTurnPlayerId;
  if (!screens.cluePhase.classList.contains('hidden')) renderCluePhase();
});

function renderCluePhase() {
  document.getElementById('my-round-number').textContent =
    `${latestRound.roundNumber} (Manga ${currentMangaInfo.mangaNumber}/${currentMangaInfo.mangaCount})`;
  const isMyTurn = latestRound.currentTurnPlayerId === myId;

  document.getElementById('clue-my-turn').classList.toggle('hidden', !isMyTurn);
  document.getElementById('clue-waiting').classList.toggle('hidden', isMyTurn);

  if (!isMyTurn) {
    const turnPlayer = currentPlayersSnapshot.find((p) => p.id === latestRound.currentTurnPlayerId);
    document.getElementById('clue-turn-name-player').textContent = turnPlayer ? turnPlayer.name : '—';
  } else {
    document.getElementById('input-clue').value = '';
    document.getElementById('clue-error').classList.add('hidden');
  }
}

document.getElementById('btn-submit-clue').addEventListener('click', submitClue);
document.getElementById('input-clue').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitClue();
});

function submitClue() {
  const word = document.getElementById('input-clue').value.trim();
  if (!word) return;
  socket.emit('player:submit_clue', { code: roomCode, word });
}

socket.on('round:clue_rejected', ({ reason }) => {
  const err = document.getElementById('clue-error');
  err.textContent = reason;
  err.classList.remove('hidden');
});

socket.on('round:clue_submitted', ({ name, word }) => {
  const log = document.getElementById('clue-log-player');
  const item = document.createElement('div');
  item.className = 'clue-item';
  item.innerHTML = `<span>${escapeHtml(word)}</span><span class="who">${escapeHtml(name)}</span>`;
  log.prepend(item);
  renderCluePhase();
});

socket.on('round:clue_phase_ending', () => {
  document.getElementById('clue-my-turn').classList.add('hidden');
  document.getElementById('clue-waiting').classList.remove('hidden');
  document.getElementById('clue-turn-name-player').textContent = 'Pasando a votación...';
});

// ---------- Votación ----------
socket.on('round:voting_started', ({ candidates }) => {
  selectedVoteTarget = null;
  const grid = document.getElementById('vote-grid');
  grid.innerHTML = '';
  candidates
    .filter((c) => c.id !== myId)
    .forEach((c) => {
      const btn = document.createElement('button');
      btn.className = 'vote-btn';
      btn.textContent = c.name;
      btn.addEventListener('click', () => castVote(c.id, btn));
      grid.appendChild(btn);
    });
  document.getElementById('vote-status').textContent = '';
  showScreen('vote');
});

function castVote(targetId, btnEl) {
  if (selectedVoteTarget) return; // ya votó
  selectedVoteTarget = targetId;
  document.querySelectorAll('.vote-btn').forEach((b) => b.classList.remove('selected'));
  btnEl.classList.add('selected');
  document.getElementById('vote-status').textContent = 'Voto enviado. Esperando a los demás...';
  socket.emit('player:submit_vote', { code: roomCode, targetId });
}

socket.on('round:vote_registered', ({ votesIn, votesNeeded }) => {
  if (selectedVoteTarget) {
    document.getElementById('vote-status').textContent = `Voto enviado (${votesIn}/${votesNeeded}). Esperando...`;
  }
});

// ---------- Revelación / empate ----------
socket.on('round:elimination', ({ eliminatedName, wasImpostor }) => {
  const banner = document.getElementById('reveal-banner-player');
  banner.className = 'reveal-banner ' + (wasImpostor ? 'caught' : 'escaped');
  document.getElementById('reveal-eyebrow-player').textContent = wasImpostor ? '¡Atrapado!' : 'Era inocente...';
  document.getElementById('reveal-title-player').textContent = eliminatedName;
  document.getElementById('reveal-subtitle-player').textContent = wasImpostor
    ? 'Era impostor. Veamos si sigue la manga...'
    : 'Era inocente. La manga sigue...';
  showScreen('revealPlayer');
});

socket.on('round:tie', () => {
  showScreen('tiePlayer');
});

// ---------- Fin de manga / sesión ----------
socket.on('manga:over', ({ result, concept, impostorNames, mangaNumber, mangaCount, isLastManga, scores }) => {
  document.getElementById('final-eyebrow-player').textContent =
    (result === 'impostors_caught' ? 'Impostores atrapados' : 'Los impostores ganaron') +
    ` · Manga ${mangaNumber} de ${mangaCount}`;
  const names = impostorNames.join(', ');
  document.getElementById('final-title-player').textContent =
    impostorNames.length > 1 ? `${names} eran los impostores` : `${names} era el impostor`;
  document.getElementById('final-subtitle-player').textContent = `Concepto: ${concept.name}`;

  const me = scores.find((p) => p.id === myId);
  document.getElementById('my-score').textContent = me ? me.score : 0;

  document.getElementById('match-over-waiting-text').textContent = isLastManga
    ? '¡Partida terminada! Esperando a que el host inicie una nueva partida...'
    : 'Esperando a que el host arranque la siguiente manga...';

  showScreen('matchOverPlayer');
});

socket.on('room:players_update', ({ status }) => {
  if (status === 'lobby' && myId && !screens.join.classList.contains('hidden')) return;
  if (status === 'lobby' && myId) {
    const wasShowingResult =
      !screens.matchOverPlayer.classList.contains('hidden') ||
      !screens.revealPlayer.classList.contains('hidden');
    if (wasShowingResult) {
      showScreen('waiting');
    }
  }
});
