#!/usr/bin/env node
// ===================== SMOKE TEST =====================
// Prueba rápida de humo: crea salas reales por socket.io y hace arrancar
// cada uno de los 5 juegos con una interacción representativa (una pista,
// una puja, una pregunta, etc.), sin jugar la partida entera de punta a
// punta — la Subasta en particular tiene temporizadores reales de varios
// segundos por carta, así que llevaría minutos completarla del todo.
// El objetivo es detectar regresiones de protocolo o caídas del servidor
// antes de cada push, no reemplazar el testeo manual completo.
//
// Uso:
//   npm run smoke                       # contra http://localhost:3000
//   SMOKE_URL=https://tu-app.onrender.com npm run smoke   # contra producción
const { io } = require('socket.io-client');

const URL = process.env.SMOKE_URL || 'http://localhost:3000';
const STEP_TIMEOUT = 15000;

let passed = 0, failed = 0;
const results = [];

function log(msg) { console.log(msg); }

function connect() {
  return io(URL, { transports: ['websocket'], reconnection: false, forceNew: true });
}

function once(socket, event) {
  return new Promise((resolve) => socket.once(event, resolve));
}

function waitFor(socket, event, timeoutMs = STEP_TIMEOUT) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando '${event}'`)), timeoutMs);
    socket.once(event, (data) => { clearTimeout(timer); resolve(data); });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout esperando ack de '${event}'`)), STEP_TIMEOUT);
    socket.emit(event, payload, (res) => { clearTimeout(timer); resolve(res); });
  });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function checkHealth() {
  const res = await fetch(`${URL}/health`);
  if (!res.ok) throw new Error(`/health respondió ${res.status}`);
}

async function makeRoom(hostName, playerNames) {
  const host = connect();
  await once(host, 'connect');
  const created = await emitAck(host, 'player:create_room', { name: hostName });
  if (!created.ok) throw new Error('no se pudo crear la sala: ' + created.error);
  const code = created.code;
  const guests = [];
  for (const name of playerNames) {
    const g = connect();
    await once(g, 'connect');
    const joined = await emitAck(g, 'player:join_room', { code, name });
    if (!joined.ok) throw new Error(`'${name}' no pudo unirse: ` + joined.error);
    guests.push(g);
  }
  return { host, guests, code, all: [host, ...guests] };
}

function closeAll(room) { room.all.forEach((s) => s.disconnect()); }

async function runGame(name, fn) {
  const start = Date.now();
  try {
    await fn();
    const ms = Date.now() - start;
    log(`✅ ${name} (${ms}ms)`);
    results.push({ name, ok: true, ms });
    passed++;
  } catch (e) {
    const ms = Date.now() - start;
    log(`❌ ${name}: ${e.message} (${ms}ms)`);
    results.push({ name, ok: false, ms, error: e.message });
    failed++;
  }
}

async function testImpostor() {
  const room = await makeRoom('Host', ['Guest1', 'Guest2']); // impostor necesita mín. 3
  const { host, code } = room;
  host.emit('host:select_game', { code, gameType: 'impostor' });
  await wait(150);
  host.emit('host:start_match', { code });
  await Promise.all(room.all.map((s) => waitFor(s, 'imp:role')));
  const round = await waitFor(host, 'imp:round');
  if (!round.currentTurnPlayerId) throw new Error('imp:round sin currentTurnPlayerId');
  host.emit('player:submit_clue', { code, word: 'prueba' });
  await waitFor(host, 'imp:clue');
  closeAll(room);
}

async function testMentiroso() {
  const room = await makeRoom('Host', ['Guest1']);
  const { host, code } = room;
  host.emit('host:select_game', { code, gameType: 'mentiroso' });
  await wait(150);
  host.emit('host:start_match', { code });
  const roundData = await waitFor(host, 'lie:round');
  const turnSocket = roundData.currentTurnPlayerId === host.id ? host : room.guests[0];
  turnSocket.emit('player:make_claim', { code, amount: 1 });
  await waitFor(host, 'lie:claim');
  closeAll(room);
}

async function testSubasta() {
  const room = await makeRoom('Host', ['Guest1']);
  const { host, guests, code } = room;
  host.emit('host:select_game', { code, gameType: 'subasta' });
  await wait(150);
  host.emit('host:start_match', { code });
  const voteData = await waitFor(host, 'sub:formation_vote');
  const formation = voteData.formations[0];
  host.emit('player:vote_formation', { code, formation });
  guests[0].emit('player:vote_formation', { code, formation });
  await waitFor(host, 'sub:formation_decided');
  // Tras decidir formación hay un setTimeout(1500ms) antes de mostrar la 1ra carta.
  const card = await waitFor(host, 'sub:card', 8000);
  if (typeof card.startingPrice !== 'number') throw new Error('sub:card sin startingPrice');
  host.emit('player:skip_card', { code });
  guests[0].emit('player:skip_card', { code });
  // Ambos pasan -> la carta se descarta y llega el resultado.
  await waitFor(host, 'sub:card_resolved', 8000);
  closeAll(room);
}

async function testWavelength() {
  const room = await makeRoom('Host', ['Guest1']);
  const { host, guests, code } = room;
  host.emit('host:select_game', { code, gameType: 'wavelength' });
  await wait(150);
  host.emit('host:start_match', { code });
  const roundData = await waitFor(host, 'wave:round');
  const psychic = roundData.psychicId === host.id ? host : guests[0];
  const guesser = psychic === host ? guests[0] : host;
  psychic.emit('player:wave_ready', { code });
  await waitFor(guesser, 'wave:guessing_start');
  guesser.emit('player:wave_lock', { code, value: 50 });
  await wait(500); // confirma que el servidor no explota al procesar el lock
  closeAll(room);
}

async function testWho() {
  const room = await makeRoom('Host', ['Guest1']);
  const { host, code } = room;
  host.emit('host:select_game', { code, gameType: 'who' });
  await wait(150);
  host.emit('host:start_match', { code });
  await waitFor(host, 'who:state');
  host.emit('player:who_question', { code, text: '¿Es delantero?' });
  await waitFor(host, 'who:question');
  closeAll(room);
}

(async () => {
  log(`🔥 Smoke test contra ${URL}\n`);
  try {
    await checkHealth();
  } catch (e) {
    log(`❌ El servidor no responde en ${URL}: ${e.message}`);
    process.exit(1);
  }

  await runGame('El Impostor', testImpostor);
  await runGame('Mentiroso Futbolero', testMentiroso);
  await runGame('Subasta Futbolera', testSubasta);
  await runGame('La Frecuencia', testWavelength);
  await runGame('¿Quién Soy?', testWho);

  try {
    await checkHealth();
    log('\n✅ El servidor sigue respondiendo tras las 5 pruebas.');
  } catch (e) {
    log(`\n❌ El servidor dejó de responder después de las pruebas: ${e.message}`);
    failed++;
  }

  log(`\n${passed} de ${passed + failed} juegos OK.`);
  // process.exit() inmediatamente después de socket.disconnect() puede pisar
  // el cierre interno de los handles de socket.io-client en Windows y tirar
  // un assertion error de libuv (inofensivo, pero ensucia la salida). Un
  // margen corto le da tiempo a esos handles a terminar de cerrarse solos.
  const code = failed > 0 ? 1 : 0;
  setTimeout(() => process.exit(code), 300);
})();
