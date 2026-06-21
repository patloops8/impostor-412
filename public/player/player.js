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
let lieCurrentTurnPlayerId = null;
let lieCurrentClaim = 0;

const screens = {
  join: document.getElementById('screen-join'),
  waiting: document.getElementById('screen-waiting'),
  role: document.getElementById('screen-role'),
  cluePhase: document.getElementById('screen-clue-phase'),
  vote: document.getElementById('screen-vote'),
  revealPlayer: document.getElementById('screen-reveal-player'),
  tiePlayer: document.getElementById('screen-tie-player'),
  matchOverPlayer: document.getElementById('screen-match-over-player'),
  lieClaimPlayer: document.getElementById('screen-lie-claim-player'),
  lieNamingPlayer: document.getElementById('screen-lie-naming-player'),
  lieVotingPlayer: document.getElementById('screen-lie-voting-player'),
  lieRoundOverPlayer: document.getElementById('screen-lie-round-over-player'),
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

socket.on('room:players_update', ({ players, status }) => {
  currentPlayersSnapshot = players;
  if (status === 'lobby' && myId) {
    const wasShowingResult =
      !screens.matchOverPlayer.classList.contains('hidden') ||
      !screens.revealPlayer.classList.contains('hidden') ||
      !screens.lieRoundOverPlayer.classList.contains('hidden');
    if (wasShowingResult) showScreen('waiting');
  }
});

/* =========================================================
   EL IMPOSTOR
   ========================================================= */

socket.on('manga:started', ({ mangaNumber, mangaCount }) => {
  currentMangaInfo = { mangaNumber, mangaCount };
});

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

socket.on('round:started', ({ roundNumber, currentTurnPlayerId }) => {
  latestRound = { roundNumber, currentTurnPlayerId };
  document.getElementById('clue-log-player').innerHTML = '';
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
  if (selectedVoteTarget) return;
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

/* =========================================================
   MENTIROSO
   ========================================================= */

socket.on('lie:round_started', ({ roundNumber, roundCount, category, currentTurnPlayerId }) => {
  document.getElementById('lie-p-round-number').textContent = roundNumber;
  document.getElementById('lie-p-round-count').textContent = roundCount;
  document.getElementById('lie-p-category').textContent = category.prompt;
  document.getElementById('lie-p-current-claim').textContent = '0';
  lieCurrentClaim = 0;
  lieCurrentTurnPlayerId = currentTurnPlayerId;
  renderLieClaimScreen();
  showScreen('lieClaimPlayer');
});

socket.on('lie:turn_changed', ({ currentTurnPlayerId }) => {
  lieCurrentTurnPlayerId = currentTurnPlayerId;
  if (!screens.lieClaimPlayer.classList.contains('hidden')) renderLieClaimScreen();
});

socket.on('lie:claim_made', ({ amount }) => {
  lieCurrentClaim = amount;
  document.getElementById('lie-p-current-claim').textContent = amount;
});

function renderLieClaimScreen() {
  const isMyTurn = lieCurrentTurnPlayerId === myId;
  document.getElementById('lie-p-my-turn').classList.toggle('hidden', !isMyTurn);
  document.getElementById('lie-p-waiting').classList.toggle('hidden', isMyTurn);

  if (isMyTurn) {
    document.getElementById('input-claim').value = '';
    document.getElementById('claim-error').classList.add('hidden');
    document.getElementById('btn-accuse-liar').disabled = lieCurrentClaim <= 0;
  } else {
    const turnPlayer = currentPlayersSnapshot.find((p) => p.id === lieCurrentTurnPlayerId);
    document.getElementById('lie-p-turn-name').textContent = turnPlayer ? turnPlayer.name : '—';
  }
}

document.getElementById('btn-submit-claim').addEventListener('click', () => {
  const val = Number(document.getElementById('input-claim').value);
  const err = document.getElementById('claim-error');
  if (!Number.isInteger(val) || val <= lieCurrentClaim) {
    err.textContent = `Debe ser un número entero mayor a ${lieCurrentClaim}.`;
    err.classList.remove('hidden');
    return;
  }
  err.classList.add('hidden');
  socket.emit('player:make_claim', { code: roomCode, amount: val });
});

document.getElementById('btn-accuse-liar').addEventListener('click', () => {
  socket.emit('player:accuse_liar', { code: roomCode });
});

socket.on('lie:claim_rejected', ({ reason }) => {
  const err = document.getElementById('claim-error');
  err.textContent = reason;
  err.classList.remove('hidden');
});

socket.on('lie:accused', ({ accuserId, accuserName, accusedId, accusedName, target, category }) => {
  document.getElementById('lie-p-target').textContent = target;
  document.getElementById('lie-p-named-count').textContent = '0';
  document.getElementById('lie-p-named-log').innerHTML = '';

  const amAccused = accusedId === myId;
  document.getElementById('lie-p-am-accused').classList.toggle('hidden', !amAccused);
  document.getElementById('lie-p-naming-heading').textContent = amAccused
    ? `${accuserName} no te creyó. Nombra ${target} de: ${category.prompt}`
    : `${accuserName} acusó a ${accusedName} de mentiroso. Categoría: ${category.prompt}`;

  if (amAccused) {
    document.getElementById('input-name-item').value = '';
    document.getElementById('name-item-error').classList.add('hidden');
  }

  showScreen('lieNamingPlayer');
});

document.getElementById('btn-submit-name-item').addEventListener('click', submitNameItem);
document.getElementById('input-name-item').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitNameItem();
});
function submitNameItem() {
  const text = document.getElementById('input-name-item').value.trim();
  if (!text) return;
  socket.emit('player:name_item', { code: roomCode, text });
  document.getElementById('input-name-item').value = '';
}

socket.on('lie:item_accepted', ({ text, count }) => {
  document.getElementById('lie-p-named-count').textContent = count;
  const log = document.getElementById('lie-p-named-log');
  const item = document.createElement('div');
  item.className = 'clue-item';
  item.innerHTML = `<span>${escapeHtml(text)}</span><span class="who">✓</span>`;
  log.prepend(item);
});

socket.on('lie:item_rejected', ({ text, reason }) => {
  const log = document.getElementById('lie-p-named-log');
  const item = document.createElement('div');
  item.className = 'clue-item';
  const reasonText = reason === 'repetido' ? '✗ repetido' : '✗ no válido';
  item.innerHTML = `<span>${escapeHtml(text)}</span><span class="who" style="color:var(--red);">${reasonText}</span>`;
  log.prepend(item);
});

let lieEligibleVoter = false;

socket.on('lie:vote_needed', ({ text, votesNeeded, eligibleVoterIds }) => {
  document.getElementById('lie-p-vote-text').textContent = `"${text}"`;
  lieEligibleVoter = eligibleVoterIds.includes(myId);
  document.getElementById('lie-p-can-vote').classList.toggle('hidden', !lieEligibleVoter);
  document.getElementById('lie-p-vote-status').textContent = lieEligibleVoter
    ? `0 / ${votesNeeded} votos`
    : 'Esperando la votación del grupo...';
  showScreen('lieVotingPlayer');
});

document.getElementById('btn-vote-valid').addEventListener('click', () => castItemVote(true));
document.getElementById('btn-vote-invalid').addEventListener('click', () => castItemVote(false));
function castItemVote(valid) {
  document.getElementById('lie-p-can-vote').classList.add('hidden');
  document.getElementById('lie-p-vote-status').textContent = 'Voto enviado. Esperando a los demás...';
  socket.emit('player:vote_item_validity', { code: roomCode, valid });
}

socket.on('lie:vote_progress', ({ votesIn, votesNeeded }) => {
  if (lieEligibleVoter) {
    document.getElementById('lie-p-vote-status').textContent = `Voto enviado (${votesIn}/${votesNeeded}). Esperando...`;
  } else {
    document.getElementById('lie-p-vote-status').textContent = `Esperando la votación del grupo... (${votesIn}/${votesNeeded})`;
  }
});

socket.on('lie:vote_result', () => {
  showScreen('lieNamingPlayer');
});

socket.on('lie:challenge_resolved', ({ success, accusedName, accuserName, roundNumber, roundCount, isLastRound, scores }) => {
  document.getElementById('lie-p-result-eyebrow').textContent = `Ronda ${roundNumber} de ${roundCount}`;
  document.getElementById('lie-p-result-title').textContent = success
    ? `${accusedName} sí pudo`
    : `${accusedName} no pudo`;
  document.getElementById('lie-p-result-subtitle').textContent = success
    ? `${accuserName} perdió un punto por desconfiar.`
    : `${accuserName} ganó un punto por desenmascararlo.`;

  const me = scores.find((p) => p.id === myId);
  document.getElementById('lie-p-my-score').textContent = me ? me.score : 0;

  document.getElementById('lie-p-waiting-text').textContent = isLastRound
    ? '¡Partida terminada! Esperando a que el host inicie una nueva partida...'
    : 'Esperando a que el host arranque la siguiente ronda...';

  showScreen('lieRoundOverPlayer');
});
