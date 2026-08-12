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
//
// Nota: cada corrida crea 5 salas y las abandona (todos los jugadores se
// desconectan). El servidor las limpia solo, pero recién en el barrido
// periódico de salas huérfanas (cada 15 min) — así que correr esto muchas
// veces seguidas en poco tiempo puede acercarse al límite de 100 salas
// simultáneas (protección real del servidor, no un bug). Si eso pasa vas
// a ver "Servidor lleno" — no afecta producción real, ahí nadie crea y
// abandona decenas de salas por minuto.
const { io } = require('socket.io-client');

const URL = process.env.SMOKE_URL || 'http://localhost:3000';
const STEP_TIMEOUT = 15000;
// Mismo valor por defecto que SMOKE_TEST_TOKEN en server.js: le dice al
// servidor que estas salas son de prueba, para que no sumen a Analytics.
const SMOKE_TEST_TOKEN = process.env.SMOKE_TEST_TOKEN || 'local-smoke-test-412';

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
  const created = await emitAck(host, 'player:create_room', { name: hostName, isTest: true, testToken: SMOKE_TEST_TOKEN });
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

// IMPORTANTE: en todos los tests de abajo, el waitFor() de cada evento se
// registra ANTES de emitir la acción que lo dispara, nunca después. Si el
// servidor responde muy rápido (a veces sin ningún setTimeout de por
// medio, ej. imp:round), el evento puede llegar antes de que el próximo
// "await waitFor(...)" alcance a registrar su listener .once() — y como
// para ese momento ya pasó, se queda esperando para siempre hasta el
// timeout. Es una carrera clásica de tests basados en eventos.

async function testImpostor() {
  const room = await makeRoom('Host', ['Guest1', 'Guest2']); // impostor necesita mín. 3
  const { host, code } = room;
  host.emit('host:select_game', { code, gameType: 'impostor' });
  await wait(150);
  const rolesPromise = Promise.all(room.all.map((s) => waitFor(s, 'imp:role')));
  const roundPromise = waitFor(host, 'imp:round');
  host.emit('host:start_match', { code });
  await rolesPromise;
  const round = await roundPromise;
  if (!round.currentTurnPlayerId) throw new Error('imp:round sin currentTurnPlayerId');
  // El servidor ignora en silencio la pista si no la manda quien tiene el
  // turno (server.js: r.clueOrder[r.clueTurnIndex]!==socket.id), así que
  // hay que mandarla desde el socket correcto, no siempre desde el host.
  const turnSocket = room.all.find((s) => s.id === round.currentTurnPlayerId);
  if (!turnSocket) throw new Error('no se encontró el socket con el turno actual');
  const cluePromise = waitFor(host, 'imp:clue');
  turnSocket.emit('player:submit_clue', { code, word: 'prueba' });
  await cluePromise;
  closeAll(room);
}

async function testMentiroso() {
  const room = await makeRoom('Host', ['Guest1']);
  const { host, code } = room;
  host.emit('host:select_game', { code, gameType: 'mentiroso' });
  await wait(150);
  const roundPromise = waitFor(host, 'lie:round');
  host.emit('host:start_match', { code });
  const roundData = await roundPromise;
  const turnSocket = roundData.currentTurnPlayerId === host.id ? host : room.guests[0];
  const claimPromise = waitFor(host, 'lie:claim');
  turnSocket.emit('player:make_claim', { code, amount: 1 });
  await claimPromise;
  closeAll(room);
}

async function testSubasta() {
  const room = await makeRoom('Host', ['Guest1']);
  const { host, guests, code } = room;
  host.emit('host:select_game', { code, gameType: 'subasta' });
  await wait(150);
  const votePromise = waitFor(host, 'sub:formation_vote');
  host.emit('host:start_match', { code });
  const voteData = await votePromise;
  const formation = voteData.formations[0];
  const decidedPromise = waitFor(host, 'sub:formation_decided');
  host.emit('player:vote_formation', { code, formation });
  guests[0].emit('player:vote_formation', { code, formation });
  await decidedPromise;
  // Tras decidir formación hay un setTimeout(1500ms) antes de mostrar la 1ra carta.
  const cardPromise = waitFor(host, 'sub:card', 8000);
  const card = await cardPromise;
  if (typeof card.startingPrice !== 'number') throw new Error('sub:card sin startingPrice');
  // Ambos pasan -> la carta se descarta y llega el resultado.
  const resolvedPromise = waitFor(host, 'sub:card_resolved', 8000);
  host.emit('player:skip_card', { code });
  guests[0].emit('player:skip_card', { code });
  await resolvedPromise;
  closeAll(room);
}

async function testWavelength() {
  const room = await makeRoom('Host', ['Guest1']);
  const { host, guests, code } = room;
  host.emit('host:select_game', { code, gameType: 'wavelength' });
  await wait(150);
  const roundPromise = waitFor(host, 'wave:round');
  host.emit('host:start_match', { code });
  const roundData = await roundPromise;
  const psychic = roundData.psychicId === host.id ? host : guests[0];
  const guesser = psychic === host ? guests[0] : host;
  const guessingPromise = waitFor(guesser, 'wave:guessing_start');
  psychic.emit('player:wave_ready', { code });
  await guessingPromise;
  guesser.emit('player:wave_lock', { code, value: 50 });
  await wait(500); // confirma que el servidor no explota al procesar el lock
  closeAll(room);
}

async function testWho() {
  const room = await makeRoom('Host', ['Guest1']);
  const { host, code } = room;
  host.emit('host:select_game', { code, gameType: 'who' });
  await wait(150);
  const statePromise = waitFor(host, 'who:state');
  host.emit('host:start_match', { code });
  const state = await statePromise;
  // El servidor ignora la pregunta si no la manda el jugador activo
  // (server.js: if(socket.id!==whoActiveId(r))return;).
  const activeSocket = room.all.find((s) => s.id === state.activePlayerId);
  if (!activeSocket) throw new Error('no se encontró el socket del jugador activo');
  const questionPromise = waitFor(host, 'who:question');
  activeSocket.emit('player:who_question', { code, text: '¿Es delantero?' });
  await questionPromise;
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
