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
  lieFinalVotePlayer: document.getElementById('screen-lie-final-vote-player'),
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

socket.on('room:players_update', ({ players, status, subastaConfig }) => {
  currentPlayersSnapshot = players;
  // Sincronizar el budget inicial si aún no ha empezado la partida
  if (subastaConfig && status === 'lobby') {
    mySubastaState.budget = subastaConfig.budget;
    mySubastaState.skipsLeft = subastaConfig.skipLimit;
  }
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

let lieCountdownInterval = null;

function startLieCountdown(deadlineAt) {
  stopLieCountdown();
  const circle = document.getElementById('lie-p-countdown');
  function tick() {
    const remaining = Math.max(0, Math.ceil((deadlineAt - Date.now()) / 1000));
    circle.textContent = remaining;
    circle.classList.toggle('urgent', remaining <= 3);
    if (remaining <= 0) stopLieCountdown();
  }
  tick();
  lieCountdownInterval = setInterval(tick, 250);
}

function stopLieCountdown() {
  if (lieCountdownInterval) {
    clearInterval(lieCountdownInterval);
    lieCountdownInterval = null;
  }
}

socket.on('lie:round_started', ({ roundNumber, roundCount, category, currentTurnPlayerId }) => {
  document.getElementById('lie-p-round-number').textContent = roundNumber;
  document.getElementById('lie-p-round-count').textContent = roundCount;
  document.getElementById('lie-p-category').textContent = category;
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

let lieMode = 'texto';
let amAccused = false;
let amAccuser = false;

socket.on('lie:accused', ({ accuserId, accuserName, accusedId, accusedName, target, category, mode, deadlineAt }) => {
  lieMode = mode;
  amAccused = accusedId === myId;
  amAccuser = accuserId === myId;

  document.getElementById('lie-p-target').textContent = target;
  document.getElementById('lie-p-named-count').textContent = '0';
  document.getElementById('lie-p-named-log').innerHTML = '';

  const heading = amAccused
    ? `${accuserName} no te creyó. Nombra ${target} de:\n${category}`
    : `${accuserName} acusó a ${accusedName}. Categoría:\n${category}`;
  document.getElementById('lie-p-naming-heading').textContent = heading;

  // Mostrar los controles correctos según modo y rol
  const markBtn = document.getElementById('btn-mark-answer');
  const textInput = document.getElementById('lie-p-am-accused');
  const waitingMsg = document.getElementById('lie-p-naming-waiting');

  markBtn.classList.add('hidden');
  textInput.classList.add('hidden');
  waitingMsg.classList.add('hidden');

  if (mode === 'voz' && amAccuser) {
    markBtn.classList.remove('hidden');
  } else if (mode === 'texto' && amAccused) {
    textInput.classList.remove('hidden');
    document.getElementById('input-name-item').value = '';
    document.getElementById('name-item-error').classList.add('hidden');
  } else {
    waitingMsg.classList.remove('hidden');
    waitingMsg.textContent = mode === 'voz'
      ? `Di tus respuestas en voz alta. ${accuserName} irá marcándolas.`
      : `${accusedName} está escribiendo las respuestas...`;
  }

  startLieCountdown(deadlineAt);
  showScreen('lieNamingPlayer');
});

// Modo VOZ: acusador marca cada respuesta que escucha
document.getElementById('btn-mark-answer').addEventListener('click', () => {
  socket.emit('player:mark_answer_valid', { code: roomCode });
});

socket.on('lie:answer_marked', ({ count, target, deadlineAt }) => {
  document.getElementById('lie-p-named-count').textContent = count;
  const log = document.getElementById('lie-p-named-log');
  const item = document.createElement('div');
  item.className = 'clue-item';
  item.innerHTML = `<span>Respuesta ${count}</span><span class="who">✓</span>`;
  log.prepend(item);
  if (deadlineAt) startLieCountdown(deadlineAt);
  else stopLieCountdown();
});

// Modo TEXTO: acusado escribe cada respuesta
document.getElementById('btn-submit-name-item').addEventListener('click', submitNameItem);
document.getElementById('input-name-item').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitNameItem();
});
function submitNameItem() {
  const text = document.getElementById('input-name-item').value.trim();
  if (!text) return;
  document.getElementById('input-name-item').value = '';
  socket.emit('player:name_item', { code: roomCode, text });
}

socket.on('lie:item_submitted', ({ text, count, target, deadlineAt }) => {
  document.getElementById('lie-p-named-count').textContent = count;
  const log = document.getElementById('lie-p-named-log');
  const item = document.createElement('div');
  item.className = 'clue-item';
  item.innerHTML = `<span>${escapeHtml(text)}</span><span class="who">#${count}</span>`;
  log.prepend(item);
  if (deadlineAt) startLieCountdown(deadlineAt);
  else stopLieCountdown();
});

// Voto final único
socket.on('lie:final_vote_needed', ({ target, mode, namedSoFar, eligibleVoterIds }) => {
  stopLieCountdown();
  const canVote = eligibleVoterIds.includes(myId);

  document.getElementById('lie-p-finalvote-title').textContent = `¿Las ${target} respuestas fueron válidas?`;

  const list = document.getElementById('lie-p-finalvote-list');
  list.innerHTML = '';
  if (mode === 'texto' && namedSoFar) {
    namedSoFar.forEach((text) => {
      const item = document.createElement('div');
      item.className = 'clue-item';
      item.innerHTML = `<span>${escapeHtml(text)}</span>`;
      list.appendChild(item);
    });
  } else {
    const note = document.createElement('div');
    note.className = 'clue-item';
    note.innerHTML = `<span>Se dijeron en voz alta. ¿Las aceptan todas?</span>`;
    list.appendChild(note);
  }

  document.getElementById('lie-p-can-vote').classList.toggle('hidden', !canVote);
  document.getElementById('lie-p-vote-status').textContent = canVote
    ? 'Vota si las respuestas fueron válidas.'
    : amAccused
    ? 'El grupo está votando si tus respuestas fueron válidas...'
    : 'Esperando los votos del grupo...';

  showScreen('lieFinalVotePlayer');
});

document.getElementById('btn-vote-valid').addEventListener('click', () => castFinalVote(true));
document.getElementById('btn-vote-invalid').addEventListener('click', () => castFinalVote(false));

function castFinalVote(valid) {
  document.getElementById('lie-p-can-vote').classList.add('hidden');
  document.getElementById('lie-p-vote-status').textContent = 'Voto enviado. Esperando al resto...';
  socket.emit('player:vote_final_validity', { code: roomCode, valid });
}

socket.on('lie:final_vote_progress', ({ votesIn, votesNeeded }) => {
  if (!document.getElementById('lie-p-can-vote').classList.contains('hidden')) return;
  document.getElementById('lie-p-vote-status').textContent = `${votesIn}/${votesNeeded} votos enviados...`;
});

socket.on('lie:challenge_resolved', ({ success, reason, accusedName, accuserName, roundNumber, roundCount, isLastRound, scores }) => {
  stopLieCountdown();
  document.getElementById('lie-p-result-eyebrow').textContent = `Ronda ${roundNumber} de ${roundCount}`;
  document.getElementById('lie-p-result-title').textContent = success
    ? `${accusedName} sí pudo`
    : reason === 'timeout'
    ? `${accusedName} se quedó sin tiempo`
    : `${accusedName} no convenció al grupo`;
  document.getElementById('lie-p-result-subtitle').textContent = success
    ? `${accuserName} perdió 1 punto.`
    : `${accuserName} ganó 1 punto.`;

  const me = scores.find((p) => p.id === myId);
  document.getElementById('lie-p-my-score').textContent = me ? me.score : 0;

  document.getElementById('lie-p-waiting-text').textContent = isLastRound
    ? '¡Partida terminada! Esperando que el host reinicie...'
    : 'Esperando que el host arranque la siguiente ronda...';

  showScreen('lieRoundOverPlayer');
});



/* =========================================================
   CARGA DE IMÁGENES WIKIPEDIA (client-side)
   ========================================================= */
const wikiImageCacheP = new Map();

async function loadWikiSilhouetteP(imgEl, placeholderEl, posPlaceholderEl, wikiTitle, positionName, revealed = false) {
  if (!imgEl) return;
  if (!wikiTitle) { showPlaceholderP(imgEl, placeholderEl, posPlaceholderEl, positionName); return; }
  if (wikiImageCacheP.has(wikiTitle)) {
    const url = wikiImageCacheP.get(wikiTitle);
    if (url) applyImageP(imgEl, placeholderEl, url, revealed);
    else showPlaceholderP(imgEl, placeholderEl, posPlaceholderEl, positionName);
    return;
  }
  try {
    const res = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle)}`);
    const data = await res.json();
    const url = data.thumbnail?.source || null;
    wikiImageCacheP.set(wikiTitle, url);
    if (url) applyImageP(imgEl, placeholderEl, url, revealed);
    else showPlaceholderP(imgEl, placeholderEl, posPlaceholderEl, positionName);
  } catch { wikiImageCacheP.set(wikiTitle, null); showPlaceholderP(imgEl, placeholderEl, posPlaceholderEl, positionName); }
}

function applyImageP(imgEl, placeholderEl, url, revealed) {
  imgEl.className = revealed ? 'silhouette-img revealed' : 'silhouette-img';
  imgEl.onerror = () => { imgEl.classList.add('hidden'); if (placeholderEl) placeholderEl.classList.remove('hidden'); };
  imgEl.src = url;
  imgEl.classList.remove('hidden');
  if (placeholderEl) placeholderEl.classList.add('hidden');
}

function showPlaceholderP(imgEl, placeholderEl, posPlaceholderEl, positionName) {
  if (imgEl) imgEl.classList.add('hidden');
  if (placeholderEl) placeholderEl.classList.remove('hidden');
  if (posPlaceholderEl && positionName) posPlaceholderEl.textContent = positionName.charAt(0).toUpperCase();
}
/* =========================================================
   SUBASTA FUTBOLERA — player
   ========================================================= */

screens.subastaFormationVotePlayer = document.getElementById('screen-subasta-formation-vote-player');
screens.subastaWaitingDeck = document.getElementById('screen-subasta-waiting-deck');
screens.subastaBiddingPlayer = document.getElementById('screen-subasta-bidding-player');
screens.subastaCardResultPlayer = document.getElementById('screen-subasta-card-result-player');
screens.subastaOverPlayer = document.getElementById('screen-subasta-over-player');

let mySubastaState = { budget: 500, skipsLeft: 5, team: { portero: [], defensa: [], mediocampista: [], delantero: [] } };
let currentSubastaWikiTitle = null;
let currentSubastaPosition = null;

const FORMATIONS_INFO = {
  '4-3-3': 'portero, 4 defensas, 3 medios, 3 delanteros',
  '4-4-2': 'portero, 4 defensas, 4 medios, 2 delanteros',
  '4-2-3-1': 'portero, 4 defensas, 5 medios, 1 delantero',
  '3-5-2': 'portero, 3 defensas, 5 medios, 2 delanteros',
  '3-4-3': 'portero, 3 defensas, 4 medios, 3 delanteros',
  '5-3-2': 'portero, 5 defensas, 3 medios, 2 delanteros',
};

function posLabelP(pos) {
  return {
    POR: 'Portero', LD: 'Lateral Der.', DFC: 'Defensa Central', LI: 'Lateral Izq.',
    MCD: 'Medio Def.', MC: 'Mediocentro', MCO: 'Medio Ofensivo',
    ED: 'Extremo Der.', EI: 'Extremo Izq.', DC: 'Delantero',
  }[pos] || pos;
}

function positionGroup(pos) {
  if (pos === 'POR') return 'portero';
  if (['LD','DFC','LI'].includes(pos)) return 'defensa';
  if (['MCD','MC','MCO'].includes(pos)) return 'mediocampista';
  return 'delantero';
}

function updateSubastaStats() {
  document.getElementById('sub-p-budget').textContent = `$${mySubastaState.budget}M`;
  document.getElementById('sub-p-skips').textContent = mySubastaState.skipsLeft;
  document.getElementById('sub-p-budget-result').textContent = `$${mySubastaState.budget}M`;
  document.getElementById('sub-p-skips-result').textContent = mySubastaState.skipsLeft;
  document.getElementById('sub-p-skips-btn').textContent = mySubastaState.skipsLeft;
}

socket.on('subasta:formation_vote_started', ({ formations, deadlineAt }) => {
  const btns = document.getElementById('sub-p-formation-buttons');
  btns.innerHTML = '';
  document.getElementById('sub-p-voted-text').classList.add('hidden');
  formations.forEach(f => {
    const btn = document.createElement('button');
    btn.className = 'btn-secondary';
    btn.style.textAlign = 'left';
    btn.innerHTML = `<strong>${f}</strong><br><span style="font-size:0.8rem; color:var(--text-dim);">${FORMATIONS_INFO[f] || ''}</span>`;
    btn.addEventListener('click', () => {
      btns.querySelectorAll('button').forEach(b => { b.disabled = true; b.classList.remove('selected'); });
      btn.classList.add('selected');
      socket.emit('player:vote_formation', { code: roomCode, formation: f });
      document.getElementById('sub-p-voted-text').classList.remove('hidden');
    });
    btns.appendChild(btn);
  });
  showScreen('subastaFormationVotePlayer');
});

socket.on('subasta:formation_decided', ({ formation }) => {
  document.getElementById('sub-p-formation-decided').textContent = 'Formación: ' + formation;
  showScreen('subastaWaitingDeck');
});

// Info privada de la carta + imagen para el jugador (handler único más abajo)

let myCurrentHighestBid = 0; // monto actual más alto en la carta
let myStartingPrice = 0;
let myEligibleForBid = false;
let subPAnalysisCdi = null;

function updateBidButtons() {
  const base = Math.max(myCurrentHighestBid, myStartingPrice);
  document.getElementById('sub-p-bid-preview-1').textContent = base + 1;
  document.getElementById('sub-p-bid-preview-5').textContent = base + 5;
  document.getElementById('sub-p-bid-preview-10').textContent = base + 10;
}

socket.on('subasta:card_shown', ({ cardIndex, totalCards, position, startingPrice, wikiTitle, analysisDeadline }) => {
  myCurrentHighestBid = 0;
  myStartingPrice = startingPrice;
  myEligibleForBid = false; // se actualiza en card_shown_private
  if (subPAnalysisCdi) { clearInterval(subPAnalysisCdi); subPAnalysisCdi = null; }

  document.getElementById('sub-p-card-counter').textContent = `${cardIndex + 1}/${totalCards}`;
  const badge = document.getElementById('sub-p-position-badge');
  badge.textContent = posLabelP(position);
  badge.className = 'position-badge ' + positionGroup(position);
  document.getElementById('sub-p-starting-price').textContent = `$${startingPrice}M precio base`;
  document.getElementById('sub-p-highest-bid').textContent = 'Sin pujas aún';
  updateBidButtons();

  loadWikiSilhouetteP(
    document.getElementById('sub-p-silhouette-img'),
    document.getElementById('sub-p-silhouette-placeholder'),
    document.getElementById('sub-p-placeholder-pos'),
    wikiTitle, posLabelP(position), false
  );

  showScreen('subastaBiddingPlayer');

  // Countdown de la fase de análisis
  if (analysisDeadline) {
    const el = document.getElementById('sub-p-analysis-countdown');
    if (el) {
      function tick() {
        const rem = Math.max(0, Math.ceil((analysisDeadline - Date.now()) / 1000));
        el.textContent = rem;
        el.classList.toggle('urgent', rem <= 3);
      }
      tick();
      subPAnalysisCdi = setInterval(tick, 250);
    }
  }
});

// Info privada: elegibilidad + datos para botones de puja
socket.on('subasta:card_shown_private', ({ eligible, skipsLeft, wikiTitle, position, startingPrice }) => {
  mySubastaState.skipsLeft = skipsLeft;
  myStartingPrice = startingPrice;
  myEligibleForBid = eligible;
  updateSubastaStats();

  // Durante análisis: mostrar fase de análisis a los elegibles, mensaje a los no elegibles
  document.getElementById('sub-p-can-bid').classList.add('hidden');
  document.getElementById('sub-p-bid-sent').classList.add('hidden');
  document.getElementById('sub-p-analysis-phase').classList.toggle('hidden', !eligible);
  document.getElementById('sub-p-ineligible').classList.toggle('hidden', eligible);

  if (eligible) {
    document.getElementById('btn-skip-card').disabled = skipsLeft <= 0;
    updateBidButtons();
  }
});

// Abrir fase de puja
socket.on('subasta:bidding_phase', ({ deadlineAt }) => {
  if (subPAnalysisCdi) { clearInterval(subPAnalysisCdi); subPAnalysisCdi = null; }
  if (myEligibleForBid) {
    document.getElementById('sub-p-analysis-phase').classList.add('hidden');
    document.getElementById('sub-p-can-bid').classList.remove('hidden');
    document.getElementById('sub-p-bid-sent').classList.add('hidden');
    
    
    
    updateBidButtons();
  }
});

// Pujas públicas de otros jugadores
socket.on('subasta:bid_public', ({ name, amount, highestBid }) => {
  myCurrentHighestBid = highestBid.amount;
  document.getElementById('sub-p-highest-bid').textContent = `Mejor: $${highestBid.amount}M — ${escapeHtml(highestBid.name)}`;
  updateBidButtons();
});

socket.on('subasta:timer_extended', () => {
  const errEl = document.getElementById('bid-error');
  if (errEl && !document.getElementById('sub-p-can-bid').classList.contains('hidden')) {
    errEl.textContent = '⏱ ¡Puja de último segundo! +5s extra';
    errEl.classList.remove('hidden');
    setTimeout(() => errEl.classList.add('hidden'), 3000);
  }
});

function submitBid(increment) {
  const base = Math.max(myCurrentHighestBid, myStartingPrice);
  const amount = base + increment;
  const errEl = document.getElementById('bid-error');
  errEl.classList.add('hidden');
  document.getElementById('sub-p-can-bid').classList.add('hidden');
  document.getElementById('sub-p-bid-sent').classList.remove('hidden');
  document.getElementById('sub-p-bid-sent-msg').textContent = `Puja de $${amount}M enviada. Esperando...`;
  socket.emit('player:submit_bid', { code: roomCode, amount });
}

document.getElementById('btn-submit-bid-1').addEventListener('click', () => submitBid(1));
document.getElementById('btn-submit-bid-5').addEventListener('click', () => submitBid(5));
document.getElementById('btn-submit-bid-10').addEventListener('click', () => submitBid(10));

document.getElementById('btn-skip-card').addEventListener('click', () => {
  document.getElementById('sub-p-analysis-phase').classList.add('hidden');
  document.getElementById('sub-p-can-bid').classList.add('hidden');
  document.getElementById('sub-p-bid-sent').classList.remove('hidden');
  document.getElementById('sub-p-bid-sent-msg').textContent = 'Pasaste esta carta.';
  socket.emit('player:skip_card', { code: roomCode });
});

socket.on('subasta:bid_rejected', ({ reason }) => {
  const errEl = document.getElementById('bid-error');
  errEl.textContent = reason;
  errEl.classList.remove('hidden');
  document.getElementById('sub-p-can-bid').classList.remove('hidden');
  document.getElementById('sub-p-bid-sent').classList.add('hidden');
  // Re-calcular botones con el monto mínimo correcto
  updateBidButtons();
});

socket.on('subasta:skip_confirmed', ({ skipsLeft }) => {
  mySubastaState.skipsLeft = skipsLeft;
  updateSubastaStats();
});

socket.on('subasta:card_resolved', ({ cardName, cardLabel, cardPosition, result, winnerName, cardTroll }) => {
  const isWinner = result.winnerId === myId;
  if (isWinner) {
    mySubastaState.budget -= result.amount;
    mySubastaState.team[cardPosition] = mySubastaState.team[cardPosition] || [];
    mySubastaState.team[cardPosition].push({ name: cardName, amountPaid: result.amount });
  }
  updateSubastaStats();

  const eyebrow = document.getElementById('sub-p-result-eyebrow');
  const title = document.getElementById('sub-p-result-title');
  const sub = document.getElementById('sub-p-result-subtitle');
  const trollEl = document.getElementById('sub-p-result-troll');

  if (cardTroll) trollEl.classList.remove('hidden');
  else trollEl.classList.add('hidden');

  if (result.type === 'discard') {
    eyebrow.textContent = 'Descartado';
    title.textContent = cardName;
    sub.textContent = 'Nadie se llevó esta carta';
  } else if (isWinner) {
    eyebrow.textContent = `¡Lo conseguiste! $${result.amount}M`;
    title.textContent = cardName;
    sub.textContent = cardLabel;
  } else {
    eyebrow.textContent = winnerName ? `${winnerName} se lo llevó por $${result.amount}M` : 'Ruleta';
    title.textContent = cardName;
    sub.textContent = cardLabel;
  }

  showScreen('subastaCardResultPlayer');
});

socket.on('subasta:game_over', ({ scores }) => {
  const me = scores.find(s => s.id === myId);
  document.getElementById('sub-p-total-value').textContent = `$${me?.totalRealValue ?? 0}M`;
  const teamDiv = document.getElementById('sub-p-final-team');
  teamDiv.innerHTML = '';
  if (me) {
    for (const c of me.cards) {
      const slot = document.createElement('div');
      slot.className = 'team-slot filled';
      slot.innerHTML = `<div class="pos-label">${posLabelP(c.position)}</div>
        <div class="player-name">${escapeHtml(c.name)}</div>
        <div class="player-price">$${c.amountPaid}M pagados · <span style="color:${c.troll ? 'var(--red)' : 'var(--lime);'}">$${c.realValue}M real</span></div>`;
      teamDiv.appendChild(slot);
    }
  }
  showScreen('subastaOverPlayer');
});
