// ===================== i18n (ES / EN) =====================
// Diccionario de todo el texto de interfaz (menús, instrucciones, mensajes
// de juego). Los nombres de jugadores y clubes NUNCA pasan por acá.
const I18N = {
es: {
  connecting: 'Conectando...',
  reconnecting: 'Se perdió la conexión, reconectando...',
  enterYourName: 'Ingresa tu nombre.',
  enterCode: 'Ingresa el código.',
  shareInviteText: '¡Únete a mi partida de 412! Entra en: {url}',
  copied: 'Copiado',
  linkCopied: 'Link copiado',
  leaveRoomConfirm: '¿Salir de esta sala?',
  kickedAlert: 'El anfitrión te expulsó de la sala.',
  howToPlayGame: 'Cómo se juega: {title}',
  roomGoneMsg: 'Esa sala ya no existe o la partida terminó. Crea una nueva o únete a otra.',
  playerDisconnected: '⚠ {name} se desconectó',
  playerReconnected: '✓ {name} volvió a conectarse',
  hostReassigned: '👑 {name} es el nuevo anfitrión (el anterior se desconectó)',
  showQr: '📱 Mostrar código QR',
  hideQr: '📱 Ocultar código QR',
  scanToJoin: 'Escanea para unirte',
  contactAria: 'Contacto / reportar un problema',
  contactTitle: 'Contacto',
  contactIntro: '¿Encontraste un bug o tienes una sugerencia? Cuéntanos.',
  contactTypeBug: 'Bug',
  contactTypeSuggestion: 'Sugerencia',
  contactTypeOther: 'Otro',
  contactPlaceholder: 'Cuéntanos qué pasó...',
  contactOptional: 'Tu email o usuario (opcional)',
  contactSend: 'Enviar',
  contactEmptyError: 'Escribe un mensaje antes de enviar.',
  contactSendError: 'No se pudo enviar. Probá de nuevo en un momento.',
  contactSentOk: '¡Gracias! Mensaje enviado.',
  shareResult: '📤 Compartir resultado',
  loginGoogle: 'Iniciar sesión con Google',
  loginDiscord: 'Iniciar sesión con Discord',
  myStats: '📊 Mis estadísticas',
  logout: '🚪 Cerrar sesión',
  statsTitle: 'Mis estadísticas',
  loading: 'Cargando...',
  statsError: 'No se pudieron cargar las estadísticas.',
  statsEmpty: 'Todavía no has jugado ninguna partida con tu cuenta iniciada. ¡Juega una para empezar tu historial!',
  statsWon: 'ganadas',
  authError: 'No se pudo completar el inicio de sesión. Intenta de nuevo.',
  leaderboardBtn: '🏅 Tabla de posiciones',
  leaderboardTitle: 'Tabla de posiciones',
  leaderboardEmpty: 'Todavía nadie tiene partidas registradas. ¡Inicia sesión y juega para aparecer acá!',
  leaderboardWins: 'ganadas',
  leaderboardPlayed: 'jugadas',
  achievementUnlocked: '🏆 ¡Logro desbloqueado!',
  profileTitle: 'Mi perfil de juego',
  profileHint: 'Elige cómo te ven los demás jugadores dentro del juego. No cambia tu cuenta de Google/Discord.',
  profileChangePhoto: '📷 Cambiar foto',
  profileRemovePhoto: 'Quitar foto',
  profileNameLabel: 'Nombre en el juego',
  profileSave: 'Guardar perfil',
  profileSaved: 'Perfil actualizado.',
  profileError: 'No se pudo guardar el perfil. Intenta de nuevo.',
  profileImageError: 'No se pudo procesar la imagen. Prueba con otra foto.',
  shareCardBtn: '📤 Compartir mi tarjeta',
  shareCardText: 'Mirá mi tarjeta de 412 🏆',
  shareCardSaved: '✓ Imagen guardada',
  shareCardError: 'No se pudo generar la tarjeta.',
  historyTitle: 'Historial de partidas',
  historyEmpty: 'Todavía no hay partidas en tu historial.',
  historyVs: 'con {names}',
  historyWon: 'Ganada',
  historyLost: 'Jugada',
  leaderboardPeriodAll: 'Todo el tiempo',
  leaderboardPeriodWeek: 'Esta semana',
  leaderboardPeriodMonth: 'Este mes',
  statsGamesPlayed: 'Partidas jugadas',
  statsGamesWon: 'Victorias',
  statsWinRate: '% de victorias',
  achievementsTitle: 'Logros',
  achievementsUnlockedOf: '{n} de {total} desbloqueados',
  byGameTitle: 'Por juego',
  playAgain: '🔁 Jugar de nuevo',
  shareResultText: '🏆 {winner} ganó en {game} jugando 412! ¿Te animas a superarlo? {url}',
  shareCopied: '✓ Copiado',
  muteAria: 'Silenciar/activar sonidos',
  rulesAria: 'Cómo se juega',
  rulesTitle: 'Cómo se juega',
  closeAria: 'Cerrar',
  appTagline: 'Juegos de fútbol para jugar con amigos',
  yourName: 'Tu nombre',
  createRoom: 'Crear sala',
  code: 'Código',
  join: 'Unirme',
  browsePublicRooms: '🌐 Unirse a sala pública',
  createRoomTitle: 'Crear sala',
  createRoomTypeHint: 'Elige qué tipo de sala quieres crear.',
  createPrivateRoom: '🔒 Sala privada',
  createPrivateRoomDesc: 'Compartís un código con tus amigos para que se unan.',
  createPublicRoom: '🌐 Sala pública',
  createPublicRoomDesc: 'Cualquiera la encuentra y se une desde la lista de salas públicas.',
  backBtn: '← Atrás',
  btnCreatePublicRoom: 'Crear sala pública',
  publicRoomsTitle: 'Salas públicas',
  publicRoomsFilterAll: 'Todos',
  publicRoomsEmpty: 'No hay salas públicas ahora mismo. ¡Creá una!',
  publicRoomsHost: 'Anfitrión: {name}',
  publicRoomsPlayers: '{n}/10 jugadores',
  publicRoomsJoin: 'Unirme',
  publicRoomBadge: '🌐 Sala pública',
  publicGameLocked: 'El modo de esta sala pública quedó fijo desde que se creó.',
  chatTitle: '💬 Chat de la sala',
  chatPlaceholder: 'Escribe un mensaje...',
  chatSend: 'Enviar',
  chatEmpty: 'Todavía no hay mensajes. ¡Saluda!',
  chatEnableOn: '💬 Chat: activado',
  chatEnableOff: '💬 Chat: desactivado',
  publicRequiresLogin: 'Necesitás iniciar sesión con Google o Discord para jugar en salas públicas.',
  guidelinesTitle: '🤝 Antes de entrar...',
  guidelinesBody: 'Vas a jugar con desconocidos. Trata a los demás con respeto: nada de insultos, acoso ni contenido inapropiado en el chat. Además, juega de la forma correcta: escribe pistas, respuestas o conceptos reales, sin arruinar la partida a los demás con cosas sin sentido. Puedes reportar cualquier mensaje o jugador que rompa estas reglas — los reportes los revisa el equipo de 412, y las cuentas que no las respeten pueden quedar vetadas de las salas públicas.',
  guidelinesAccept: 'Entendido, continuar',
  chatReportBtn: 'Reportar este mensaje',
  chatReportConfirm: '¿Reportar este mensaje al equipo de 412?',
  chatReportSent: '✓ Mensaje reportado',
  chatReportError: 'No se pudo enviar el reporte.',
  scoreReportBtn: 'Reportar a este jugador',
  scoreReportConfirm: '¿Reportar a este jugador por arruinar la partida (pistas o respuestas sin sentido)?',
  supportProject: '💚 Apoyar este proyecto',
  legalDisclaimer: 'Proyecto de fans hecho para jugar entre amigos. No está afiliado, patrocinado ni avalado por ningún club, liga, federación o jugador. Los nombres e imágenes de jugadores se usan únicamente con fines de identificación dentro del juego; no reclamamos derechos de propiedad sobre ellos.',
  shareCode: '📋 Copiar / compartir código',
  leaveRoom: '🚶 Salir de esta sala',
  players: 'Jugadores',
  tvView: '📺 Vista TV',
  whatToPlay: '¿Qué van a jugar?',
  gameImpostorTitle: 'El Impostor',
  gameImpostorDesc: 'Todos conocen al jugador... excepto uno.',
  gameSubastaTitle: 'Subasta Futbolera',
  gameSubastaDesc: 'Construye el mejor equipo con presupuesto limitado.',
  gameMentirosoTitle: 'Mentiroso Futbolero',
  gameMentirosoDesc: 'Convence a todos de que tu respuesta es real.',
  gameWavelengthTitle: 'La Frecuencia',
  gameWavelengthDesc: 'Sintoniza con el grupo en el debate futbolero.',
  gameWhoTitle: '¿Quién Soy?',
  gameWhoDesc: 'Todos ven tu identidad menos tú.',
  cfgImpostores: 'Impostores',
  cfgRondas: 'Rondas',
  cfgCategorias: 'Categorías',
  cfgTiempoNombrar: 'Tiempo para nombrar',
  cfgModoRespuesta: 'Modo de respuesta',
  cfgTexto: 'Texto',
  cfgVoz: 'Voz',
  cfgPresupuesto: 'Presupuesto',
  cfgSkipsPorJugador: 'Skips por jugador',
  cfgModoVictoria: 'Modo de victoria',
  cfgOvrFifa: 'OVR (estilo FIFA)',
  cfgVotacionDebate: 'Votación (debate)',
  winModeDescOvr: 'OVR: gana quien tenga el equipo con mayor media promedio.',
  winModeDescVotacion: 'Votación: al final se debate posición por posición y el grupo vota. Torneo de eliminación.',
  subastaCfgInfo: 'Análisis 8s + puja 10s por carta. Precio inicial variable según lo configurado por el anfitrión. Las medias se ocultan hasta el final.',
  wavelengthCfgInfo: 'Cada ronda un jugador es el Psíquico: ve dónde cae la zona secreta y da una pista hablada. Los demás adivinan moviendo su propia aguja, a ciegas del resto, y bloquean su respuesta antes de que se acabe el tiempo.',
  whoCfgInfo: 'Sin tiempo límite: por turnos, cada jugador hace una pregunta de Sí/No en voz alta (los demás contestan tocando el primer botón) o intenta adivinar quién es. Termina cuando todos adivinaron.',
  startMatch: 'Iniciar partida',
  hintChooseGame: 'Elige un juego',
  hintMissingPlayers: 'Faltan jugadores (mín. {min})',
  hintReady: '¡Listos!',
  waitingHostStart: 'Esperando a que el anfitrión inicie la partida...',
  host: '★ anfitrión',
  connected: 'conectado',
  kickAria: 'Expulsar',

  // Reglas / instrucciones
  rulesImpTitle: 'El Impostor',
  rulesImpHtml: `
      <h3>Objetivo</h3>
      <p>Todos reciben el mismo concepto futbolero en secreto — excepto uno: el Impostor, que recibe uno diferente (o ninguno).</p>
      <h3>Cómo se juega</h3>
      <ul>
        <li>Por turnos, cada jugador da <strong>una pista</strong> sobre el concepto sin decirlo directamente.</li>
        <li>El Impostor improvisa sin saber el concepto real.</li>
        <li>Al final de la vuelta, todos votan quién creen que es el Impostor.</li>
      </ul>
      <h3>Puntos</h3>
      <ul>
        <li>Si el Impostor <strong>es descubierto</strong>: el grupo gana puntos.</li>
        <li>Si el Impostor <strong>no es descubierto</strong>: el Impostor gana 3 puntos.</li>
        <li>Si votas al Impostor correcto: +1 punto extra.</li>
      </ul>`,
  rulesMentirosoTitle: 'Mentiroso Futbolero',
  rulesMentirosoHtml: `
      <h3>Objetivo</h3>
      <p>Un jugador hace una afirmación ("Puedo nombrar 5 delanteros de la Champions 2022"). Otro puede acusarlo de mentiroso. Si te acusan, tienes que demostrarlo.</p>
      <h3>Cómo se juega</h3>
      <ul>
        <li>En tu turno, puedes <strong>subir la apuesta</strong> ("Puedo nombrar 6...") o <strong>acusar de mentiroso</strong> al jugador anterior.</li>
        <li>Si nadie te acusa, la ronda pasa al siguiente jugador.</li>
        <li>Si te acusan, debes nombrar lo que dijiste en el tiempo límite.</li>
      </ul>
      <h3>Puntos</h3>
      <ul>
        <li>Si el acusado <strong>lo logra</strong>: el acusador pierde 1 punto.</li>
        <li>Si el acusado <strong>falla</strong>: el acusador gana 1 punto.</li>
      </ul>`,
  rulesSubastaTitle: 'Subasta Futbolera',
  rulesSubastaHtml: `
      <h3>Objetivo</h3>
      <p>Construye el mejor equipo comprando jugadores reales en subasta.</p>
      <h3>Cómo se juega</h3>
      <ul>
        <li>Cada carta muestra la <strong>silueta</strong> de un jugador — sin nombre ni media.</li>
        <li>Fase de análisis (8s): todos estudian la silueta.</li>
        <li>Fase de puja (10s): pujan dinero. La puja más alta se lleva al jugador.</li>
        <li>Puedes usar <strong>skips</strong> para no pujar por una carta.</li>
      </ul>
      <h3>Modos de victoria</h3>
      <ul>
        <li><strong>OVR:</strong> gana quien tenga mayor media posición por posición.</li>
        <li><strong>Votación:</strong> al final, el grupo debate y vota al mejor equipo.</li>
      </ul>`,
  rulesWavelengthTitle: 'La Frecuencia',
  rulesWavelengthHtml: `
      <h3>Objetivo</h3>
      <p>El Psíquico sabe dónde cae una zona secreta en una escala entre dos conceptos futboleros. Los demás deben adivinar.</p>
      <h3>Cómo se juega</h3>
      <ul>
        <li>El Psíquico ve la zona secreta y da <strong>una sola pista hablada</strong>.</li>
        <li>Los demás mueven su aguja individualmente (a ciegas del resto) y la bloquean antes de que se acabe el tiempo.</li>
        <li>El Psíquico puede ver la zona para calibrar mejor su pista.</li>
      </ul>
      <h3>Puntos</h3>
      <ul>
        <li>Cuanto más cerca caigas de la zona, más puntos.</li>
        <li>El Psíquico gana puntos según cuántos adivinen bien.</li>
      </ul>`,
  rulesWhoTitle: '¿Quién Soy?',
  rulesWhoHtml: `
      <h3>Objetivo</h3>
      <p>A cada jugador se le asigna un futbolista o DT en secreto — visible para todos menos para él mismo.</p>
      <h3>Cómo se juega</h3>
      <ul>
        <li>Por turnos, el jugador activo hace <strong>preguntas de Sí/No</strong> en voz alta.</li>
        <li>El <strong>primero</strong> en tocar un botón responde — esa es la respuesta oficial.</li>
        <li>Cuando creas saber quién eres, escribe tu intento. Solo el anfitrión valida si es correcto.</li>
      </ul>
      <h3>Puntos</h3>
      <ul>
        <li><strong>+3 puntos</strong> si adivinas correctamente.</li>
        <li>El juego termina cuando todos adivinaron su identidad.</li>
      </ul>`,

  // ===== El Impostor =====
  impUnderstood: 'Entendido',
  impRoundLabel: 'Ronda {n}/{c}',
  impClueRound: 'Vuelta de pistas',
  impYourTurn: '¡Tu turno!',
  impSayWord: 'Di una palabra relacionada (sin repetir).',
  impYourClue: 'Tu pista...',
  impSendClue: 'Enviar pista',
  impTurnOf: 'Turno de',
  impClues: 'Pistas',
  impVoting: 'Votación',
  impWhoIsImpostor: '¿Quién es el impostor?',
  impVoteSent: 'Voto enviado, esperando...',
  impVoteSentCount: 'Voto enviado ({in}/{needed})',
  impYouAreImpostor: 'Eres el impostor',
  impHintImpostor: 'Categoría: {cat}. {extra}',
  impHintImpostorMulti: 'Hay {n} impostores. Disimula.',
  impHintImpostorSingle: 'Disimula.',
  impConceptLabel: 'Concepto ({cat})',
  impHintInnocentMulti: 'Hay {n} impostores. Da una pista relacionada.',
  impHintInnocentSingle: 'Da una pista relacionada, sin decirlo directo.',
  impCaught: '🎯 ¡Atrapado!',
  impEscaped: '❌ Era inocente...',
  impWasImpostor: 'Era impostor.',
  impMatchContinues: 'La partida sigue...',
  impTie: 'Empate',
  impNobodyOut: 'Nadie sale',
  impVotingLabel: 'Votación...',
  impostorsCaught: 'Impostores atrapados',
  impostorsWon: 'Ganaron los impostores',
  impWereImpostor: '{names} {verb} impostor',
  impWasVerb: 'era',
  impWereVerb: 'eran',
  impConceptSummary: 'Concepto: {name} ({cat})',
  backToStart: 'Volver al inicio',
  nextRound: 'Siguiente ronda',
  waitingHost: 'Esperando al anfitrión...',
  scoreboard: 'Marcador',
  next: 'Siguiente',

  // ===== Mentiroso =====
  raiseTheBet: 'Sube la apuesta...',
  raiseBet: 'Subir apuesta',
  liarBtn: '¡Mentiroso!',
  mustBeGreaterThan: 'Debe ser mayor a {n}.',
  liarAlert: '🚨 ¡Mentiroso!',
  pauseTime: '⏸ Pausar tiempo',
  resumeTime: '▶ Reanudar tiempo',
  pausedLabel: '⏸ En pausa...',
  markAnswer: 'Marcar respuesta ✓',
  writeAnAnswer: 'Escribe una respuesta...',
  send: 'Enviar',
  answerNumber: 'Respuesta {n}',
  didntBelieveYou: '{accuser} no te creyó. Nombra {target} de: {cat}',
  accusedOf: '{accuser} acusó a {accused}. Categoría: {cat}',
  sayAnswersAloud: 'Di tus respuestas en voz alta.',
  listenAndJudge: 'Escucha y juzga al final.',
  isTyping: '{name} está escribiendo...',
  groupBelieve: '¿El grupo le cree?',
  answersValid: '¿Las {n} respuestas fueron válidas?',
  saidAloudAccept: 'Se dijeron en voz alta. ¿Las aceptan?',
  validBtn: 'Válido ✓',
  invalidBtn: 'No válido ✗',
  voteColon: 'Vota:',
  groupVoting: 'El grupo está votando...',
  waitingVotes: 'Esperando votos...',
  voteSentDots: 'Voto enviado...',
  votesCount: '{in}/{needed} votos',
  finalResult: '¡Resultado Final!',
  roundOf: 'Ronda {n}/{c}',
  liarSucceeded: '✅ {name} sí pudo',
  liarTimeout: '⏱ {name} se quedó sin tiempo',
  liarFailed: '❌ {name} no convenció',
  accuserLosesPoint: '{name} pierde 1 punto.',
  accuserGainsPoint: '{name} gana 1 punto.',

  // ===== Subasta =====
  voteFormation: 'Voten la formación',
  votesN: '{n} votos',
  voteSent: '¡Voto enviado!',
  formationLabel: 'Formación: {f}',
  preparingSilhouettes: 'Preparando las siluetas...',
  budgetLabel: 'presupuesto',
  skipsLabel: 'skips',
  teamLabel: 'equipo',
  cardLabel: 'carta',
  noBidsYet: 'Sin pujas aún',
  basePriceLabel: '${p}M precio base',
  analyzing: 'Analizando...',
  biddingOpen: '¡Pujas abiertas!',
  passSkips: 'Pasar ({n} skips)',
  waitingDots: 'Esperando...',
  ineligibleMsg: 'Ya cubriste esta posición o no te alcanza el presupuesto.',
  bestBid: 'Mejor: ${amount}M — {name}',
  winningWith: 'Vas ganando con ${amount}M',
  biddingAmount: 'Pujando ${amount}M...',
  youPassedCard: 'Pasaste esta carta.',
  rockPaperScissors: 'Piedra, papel o tijera',
  nobodyWantedCard: 'Nadie quería esta carta',
  loserKeepsIt: 'El que pierde se la queda 😈',
  rpsRock: 'Piedra',
  rpsPaper: 'Papel',
  rpsScissors: 'Tijera',
  mysteryPlayerOf: 'Jugador misterioso de {pos} — el que pierde se lo queda 😈',
  chooseYourMove: 'Elige tu jugada',
  waitingFor: 'Esperando a: {names}',
  chosenWaitingRival: 'Elegiste. Esperando al rival...',
  alreadyChose: '{chosen}/{total} ya eligieron...',
  keepsIt: '¡{name} se la queda!',
  lostRps: 'Perdió el piedra-papel-tijera',
  tieAgain: '¡Empate! Otra vez',
  repeatsBetweenTied: 'Se repite entre los empatados',
  discarded: 'Descartada',
  nobodyTookIt: 'Nadie se la llevó.',
  gotItFor: '¡La conseguiste por ${amount}M!',
  lottery: 'Ruleta',
  sold: 'Vendida',
  wonItFor: '{name} la ganó por ${amount}M',
  seeFinalResult: 'Ver resultado final',
  nextCard: 'Siguiente carta',
  autoInSeconds: '(auto en {s}s)',
  teamTournament: 'Torneo de equipos',
  debateBegins: '¡Empieza el debate!',
  tournamentDesc: 'Se enfrentarán posición por posición. Votan los que no juegan el duelo.',
  ovrHidden: 'OVR oculto',
  advancesDirectly: '{name} pasa directo',
  bestTeamOfRound: 'Mejor equipo de la ronda {round} — espera rival',
  roundN: 'Ronda {n}',
  roundWord: 'Ronda',
  remaining: 'Siguen: {names}',
  whoIsBetter: '¿Quién es mejor?',
  youPlayThisDuel: 'Tú juegas este duelo. Esperando votos...',
  winsThisPositionLeft: '◄ Gana esta posición',
  winsThisPositionRight: 'Gana esta posición ►',
  mediaValue: 'Media {v}',
  duelResult: 'Resultado del duelo',
  advances: '{name} avanza',
  beatOpponent: '{winner} venció a {loser} ({a}–{b})',
  yourLineup: 'Tu alineación',
  lineupOf: 'Alineación de {name}',
  champion: '🏆 Campeón',
  ptsValue: '{p} pts',
  winsThisDuel: '{name} gana este duelo',
  tie: 'Empate',
  noCard: 'Sin carta',
  youSuffix: ' (tú)',
  finalResultTitle: 'Resultado Final',
  tapPlayerForLineup: 'Toca un jugador para ver su plantilla',
  newMatch: 'Nueva partida',
  noPlayerParens: '(sin jugador)',

  // ===== La Frecuencia =====
  psychicThinking: 'El Psíquico está pensando...',
  youArePsychic: '¡Eres el Psíquico!',
  psychicInstructions: 'Mira dónde cayó la zona y da una pista al grupo (por voz o por texto).',
  seeZone: '👁 Ver la zona',
  hideZone: '🙈 Ocultar',
  writeClueOptional: 'Escribe tu pista (opcional)...',
  clueGivenLetGuess: 'Ya di mi pista, ¡que adivinen!',
  thinkingClue: 'Pensando su pista',
  whereDoesFallLabel: '¿Dónde cae la pista?',
  psychicClueLabel: 'Pista del Psíquico',
  lockAnswer: 'Bloquear respuesta',
  waitingEveryoneLock: 'Esperando a que todos bloqueen su respuesta...',
  waitingGuesses: 'Esperando a que adivinen...',
  moveYourNeedle: 'Mueve tu aguja y bloquea cuando estés listo.',
  answerLockedWaiting: 'Respuesta bloqueada. Esperando a los demás...',
  alreadyLocked: '{in}/{needed} ya bloquearon...',
  zoneRevealed: '¡Zona revelada!',
  sentCheck: '✓ Enviada',
  psychicSuffix: '🔮 {name} (Psíquico)',
  ptsPlus: '+{p} pts',

  // ===== ¿Quién Soy? =====
  board: 'Tablero',
  whoInstructions: 'Haz una pregunta de Sí/No (por voz o texto), o intenta adivinar quién eres.',
  writeYourQuestion: 'Escribe tu pregunta...',
  whoDoYouThinkYouAre: '¿Quién crees que eres?',
  iKnowWhoIAm: '¡Ya sé quién soy!',
  yourTurnToAnswer: '¡Te toca responder!',
  yes: 'Sí',
  no: 'No',
  maybe: 'Tal vez',
  waitingAnswer: 'Esperando respuesta...',
  questions: 'Preguntas',
  didTheyGetIt: '¿Acertó?',
  correctBtn: 'Correcto ✓',
  incorrectBtn: 'Incorrecto ✗',
  saysTheyAre: '{name} dice que es...',
  waitingConfirmation: 'Esperando confirmación...',
  youFailed: '💀 ¡Fallaste!',
  youWere: 'Eras: {identity}',
  guessedIt: '🎉 {name} adivinó: {identity}',
  wasEliminated: '💀 {name} fue eliminado',
  triedToGuess: '{name} intentó adivinar',
  roundOfN: 'Ronda {n} de {c}',
  nextRoundArrow: 'Siguiente ronda ▶',
  whoWasEachOne: '¿Quién era cada uno?',
  identitiesRevealed: 'Identidades reveladas',
  everyoneRevealed: '¡Todos se descubrieron!',
  matchEnded: 'Partida terminada',
  catFutbolistas: 'Futbolistas',
  catEquipos: 'Equipos',
  catSelecciones: 'Selecciones',
  catDts: 'DTs',
  catFutbolista: 'Futbolista',
  catEquipo: 'Equipo',
  catSeleccion: 'Selección',
  catDt: 'DT',

  // ===== Misc / overlays =====
  endMatchConfirm: '¿Terminar la partida ahora?',
  scoresAria: 'Ver puntajes',
  endMatchAria: 'Terminar partida',
  scoresTitle: 'Puntajes',
  winnerLabel: '🏆 ¡Ganador!',
},
en: {
  connecting: 'Connecting...',
  reconnecting: 'Connection lost, reconnecting...',
  enterYourName: 'Enter your name.',
  enterCode: 'Enter the code.',
  shareInviteText: 'Join my 412 game! Go to: {url}',
  copied: 'Copied',
  linkCopied: 'Link copied',
  leaveRoomConfirm: 'Leave this room?',
  kickedAlert: 'The host kicked you from the room.',
  howToPlayGame: 'How to play: {title}',
  roomGoneMsg: 'That room no longer exists, or the match ended. Create a new one or join another.',
  playerDisconnected: '⚠ {name} disconnected',
  playerReconnected: '✓ {name} reconnected',
  hostReassigned: '👑 {name} is the new host (the previous one disconnected)',
  showQr: '📱 Show QR code',
  hideQr: '📱 Hide QR code',
  scanToJoin: 'Scan to join',
  contactAria: 'Contact / report an issue',
  contactTitle: 'Contact',
  contactIntro: 'Found a bug or have a suggestion? Let us know.',
  contactTypeBug: 'Bug',
  contactTypeSuggestion: 'Suggestion',
  contactTypeOther: 'Other',
  contactPlaceholder: 'Tell us what happened...',
  contactOptional: 'Your email or username (optional)',
  contactSend: 'Send',
  contactEmptyError: 'Write a message before sending.',
  contactSendError: "Couldn't send it. Try again in a moment.",
  contactSentOk: 'Thanks! Message sent.',
  shareResult: '📤 Share result',
  loginGoogle: 'Sign in with Google',
  loginDiscord: 'Sign in with Discord',
  myStats: '📊 My stats',
  logout: '🚪 Log out',
  statsTitle: 'My stats',
  loading: 'Loading...',
  statsError: "Couldn't load stats.",
  statsEmpty: "You haven't played any games signed in yet. Play one to start your history!",
  statsWon: 'won',
  authError: "Couldn't complete sign-in. Try again.",
  leaderboardBtn: '🏅 Leaderboard',
  leaderboardTitle: 'Leaderboard',
  leaderboardEmpty: "No one has any recorded games yet. Sign in and play to show up here!",
  leaderboardWins: 'wins',
  leaderboardPlayed: 'played',
  achievementUnlocked: '🏆 Achievement unlocked!',
  profileTitle: 'My game profile',
  profileHint: "Choose how other players see you in-game. This doesn't change your Google/Discord account.",
  profileChangePhoto: '📷 Change photo',
  profileRemovePhoto: 'Remove photo',
  profileNameLabel: 'In-game name',
  profileSave: 'Save profile',
  profileSaved: 'Profile updated.',
  profileError: "Couldn't save your profile. Try again.",
  profileImageError: "Couldn't process that image. Try a different photo.",
  shareCardBtn: '📤 Share my card',
  shareCardText: 'Check out my 412 card 🏆',
  shareCardSaved: '✓ Image saved',
  shareCardError: "Couldn't generate the card.",
  historyTitle: 'Match history',
  historyEmpty: "No games in your history yet.",
  historyVs: 'with {names}',
  historyWon: 'Won',
  historyLost: 'Played',
  leaderboardPeriodAll: 'All time',
  leaderboardPeriodWeek: 'This week',
  leaderboardPeriodMonth: 'This month',
  statsGamesPlayed: 'Games played',
  statsGamesWon: 'Wins',
  statsWinRate: 'Win rate',
  achievementsTitle: 'Achievements',
  achievementsUnlockedOf: '{n} of {total} unlocked',
  byGameTitle: 'By game',
  playAgain: '🔁 Play again',
  shareResultText: '🏆 {winner} won at {game} playing 412! Think you can beat them? {url}',
  shareCopied: '✓ Copied',
  muteAria: 'Mute/unmute sounds',
  rulesAria: 'How to play',
  rulesTitle: 'How to play',
  closeAria: 'Close',
  appTagline: 'Football games to play with friends',
  yourName: 'Your name',
  createRoom: 'Create room',
  code: 'Code',
  join: 'Join',
  browsePublicRooms: '🌐 Join a public room',
  createRoomTitle: 'Create room',
  createRoomTypeHint: 'Choose what kind of room you want to create.',
  createPrivateRoom: '🔒 Private room',
  createPrivateRoomDesc: 'Share a code with your friends so they can join.',
  createPublicRoom: '🌐 Public room',
  createPublicRoomDesc: 'Anyone can find it and join from the public room list.',
  backBtn: '← Back',
  btnCreatePublicRoom: 'Create public room',
  publicRoomsTitle: 'Public rooms',
  publicRoomsFilterAll: 'All',
  publicRoomsEmpty: 'No public rooms right now. Create one!',
  publicRoomsHost: 'Host: {name}',
  publicRoomsPlayers: '{n}/10 players',
  publicRoomsJoin: 'Join',
  publicRoomBadge: '🌐 Public room',
  publicGameLocked: "This public room's mode was locked in when it was created.",
  chatTitle: '💬 Room chat',
  chatPlaceholder: 'Type a message...',
  chatSend: 'Send',
  chatEmpty: 'No messages yet. Say hi!',
  chatEnableOn: '💬 Chat: on',
  chatEnableOff: '💬 Chat: off',
  publicRequiresLogin: 'You need to sign in with Google or Discord to play in public rooms.',
  guidelinesTitle: "🤝 Before you jump in...",
  guidelinesBody: "You're about to play with strangers. Treat others with respect: no insults, harassment, or inappropriate content in chat. Also play properly: write real clues, answers, or concepts, and don't ruin the match for others with nonsense. You can report any message or player that breaks these rules — reports are reviewed by the 412 team, and accounts that don't follow this can be banned from public rooms.",
  guidelinesAccept: 'Got it, continue',
  chatReportBtn: 'Report this message',
  chatReportConfirm: 'Report this message to the 412 team?',
  chatReportSent: '✓ Message reported',
  chatReportError: "Couldn't send the report.",
  scoreReportBtn: 'Report this player',
  scoreReportConfirm: 'Report this player for ruining the match (nonsense clues or answers)?',
  supportProject: '💚 Support this project',
  legalDisclaimer: 'Fan project made to play with friends. Not affiliated with, sponsored by, or endorsed by any club, league, federation, or player. Player names and images are used solely for in-game identification purposes; we claim no ownership over them.',
  shareCode: '📋 Copy / share code',
  leaveRoom: '🚶 Leave this room',
  players: 'Players',
  tvView: '📺 TV View',
  whatToPlay: 'What are you going to play?',
  gameImpostorTitle: 'The Impostor',
  gameImpostorDesc: 'Everyone knows the player... except one.',
  gameSubastaTitle: 'Football Auction',
  gameSubastaDesc: 'Build the best team with a limited budget.',
  gameMentirosoTitle: 'Football Liar',
  gameMentirosoDesc: 'Convince everyone your answer is real.',
  gameWavelengthTitle: 'Wavelength',
  gameWavelengthDesc: 'Tune in with the group in the football debate.',
  gameWhoTitle: 'Who Am I?',
  gameWhoDesc: 'Everyone sees your identity but you.',
  cfgImpostores: 'Impostors',
  cfgRondas: 'Rounds',
  cfgCategorias: 'Categories',
  cfgTiempoNombrar: 'Time to name',
  cfgModoRespuesta: 'Answer mode',
  cfgTexto: 'Text',
  cfgVoz: 'Voice',
  cfgPresupuesto: 'Budget',
  cfgSkipsPorJugador: 'Skips per player',
  cfgModoVictoria: 'Win mode',
  cfgOvrFifa: 'OVR (FIFA style)',
  cfgVotacionDebate: 'Vote (debate)',
  winModeDescOvr: 'OVR: whoever has the team with the highest average rating wins.',
  winModeDescVotacion: 'Vote: at the end, the group debates position by position and votes. Elimination tournament.',
  subastaCfgInfo: 'Analysis 8s + bidding 10s per card. Starting price varies based on host settings. Ratings stay hidden until the end.',
  wavelengthCfgInfo: 'Each round one player is the Psychic: they see where the secret zone falls and give a spoken clue. The others guess by moving their own needle, blind to the rest, and lock their answer before time runs out.',
  whoCfgInfo: 'No time limit: taking turns, each player asks a Yes/No question out loud (others answer by tapping the first button) or tries to guess who they are. Ends when everyone has guessed.',
  startMatch: 'Start match',
  hintChooseGame: 'Choose a game',
  hintMissingPlayers: 'Need more players (min. {min})',
  hintReady: 'Ready!',
  waitingHostStart: 'Waiting for the host to start the match...',
  host: '★ host',
  connected: 'connected',
  kickAria: 'Kick',

  rulesImpTitle: 'The Impostor',
  rulesImpHtml: `
      <h3>Objective</h3>
      <p>Everyone gets the same football concept in secret — except one: the Impostor, who gets a different one (or none).</p>
      <h3>How to play</h3>
      <ul>
        <li>Taking turns, each player gives <strong>one clue</strong> about the concept without saying it directly.</li>
        <li>The Impostor improvises without knowing the real concept.</li>
        <li>At the end of the round, everyone votes who they think is the Impostor.</li>
      </ul>
      <h3>Points</h3>
      <ul>
        <li>If the Impostor <strong>is caught</strong>: the group gains points.</li>
        <li>If the Impostor <strong>is not caught</strong>: the Impostor gains 3 points.</li>
        <li>If you vote the correct Impostor: +1 extra point.</li>
      </ul>`,
  rulesMentirosoTitle: 'Football Liar',
  rulesMentirosoHtml: `
      <h3>Objective</h3>
      <p>A player makes a claim ("I can name 5 Champions League 2022 forwards"). Another player can accuse them of lying. If you're accused, you have to prove it.</p>
      <h3>How to play</h3>
      <ul>
        <li>On your turn, you can <strong>raise the bet</strong> ("I can name 6...") or <strong>accuse the previous player</strong> of lying.</li>
        <li>If nobody accuses you, the round passes to the next player.</li>
        <li>If you're accused, you must name what you said within the time limit.</li>
      </ul>
      <h3>Points</h3>
      <ul>
        <li>If the accused <strong>pulls it off</strong>: the accuser loses 1 point.</li>
        <li>If the accused <strong>fails</strong>: the accuser gains 1 point.</li>
      </ul>`,
  rulesSubastaTitle: 'Football Auction',
  rulesSubastaHtml: `
      <h3>Objective</h3>
      <p>Build the best team by buying real players at auction.</p>
      <h3>How to play</h3>
      <ul>
        <li>Each card shows a player's <strong>silhouette</strong> — no name or rating.</li>
        <li>Analysis phase (8s): everyone studies the silhouette.</li>
        <li>Bidding phase (10s): bid money. The highest bid gets the player.</li>
        <li>You can use <strong>skips</strong> to pass on a card.</li>
      </ul>
      <h3>Win modes</h3>
      <ul>
        <li><strong>OVR:</strong> whoever has the highest average rating, position by position, wins.</li>
        <li><strong>Vote:</strong> at the end, the group debates and votes for the best team.</li>
      </ul>`,
  rulesWavelengthTitle: 'Wavelength',
  rulesWavelengthHtml: `
      <h3>Objective</h3>
      <p>The Psychic knows where a secret zone falls on a scale between two football concepts. The others must guess.</p>
      <h3>How to play</h3>
      <ul>
        <li>The Psychic sees the secret zone and gives <strong>one single spoken clue</strong>.</li>
        <li>The others move their needle individually (blind to the rest) and lock it before time runs out.</li>
        <li>The Psychic can view the zone to calibrate their clue better.</li>
      </ul>
      <h3>Points</h3>
      <ul>
        <li>The closer you land to the zone, the more points.</li>
        <li>The Psychic earns points based on how many guess correctly.</li>
      </ul>`,
  rulesWhoTitle: 'Who Am I?',
  rulesWhoHtml: `
      <h3>Objective</h3>
      <p>Each player is secretly assigned a footballer or coach — visible to everyone except themselves.</p>
      <h3>How to play</h3>
      <ul>
        <li>Taking turns, the active player asks <strong>Yes/No questions</strong> out loud.</li>
        <li>The <strong>first</strong> person to tap a button answers — that's the official answer.</li>
        <li>When you think you know who you are, write your guess. Only the host validates if it's correct.</li>
      </ul>
      <h3>Points</h3>
      <ul>
        <li><strong>+3 points</strong> if you guess correctly.</li>
        <li>The game ends when everyone has guessed their identity.</li>
      </ul>`,

  impUnderstood: 'Got it',
  impRoundLabel: 'Round {n}/{c}',
  impClueRound: 'Clue round',
  impYourTurn: 'Your turn!',
  impSayWord: 'Say a related word (don\'t repeat).',
  impYourClue: 'Your clue...',
  impSendClue: 'Send clue',
  impTurnOf: 'Turn:',
  impClues: 'Clues',
  impVoting: 'Voting',
  impWhoIsImpostor: 'Who is the impostor?',
  impVoteSent: 'Vote sent, waiting...',
  impVoteSentCount: 'Vote sent ({in}/{needed})',
  impYouAreImpostor: 'You are the impostor',
  impHintImpostor: 'Category: {cat}. {extra}',
  impHintImpostorMulti: 'There are {n} impostors. Blend in.',
  impHintImpostorSingle: 'Blend in.',
  impConceptLabel: 'Concept ({cat})',
  impHintInnocentMulti: 'There are {n} impostors. Give a related clue.',
  impHintInnocentSingle: 'Give a related clue, without saying it directly.',
  impCaught: '🎯 Caught!',
  impEscaped: '❌ They were innocent...',
  impWasImpostor: 'They were an impostor.',
  impMatchContinues: 'The match continues...',
  impTie: 'Tie',
  impNobodyOut: 'Nobody is out',
  impVotingLabel: 'Voting...',
  impostorsCaught: 'Impostors caught',
  impostorsWon: 'The impostors won',
  impWereImpostor: '{names} {verb} the impostor',
  impWasVerb: 'was',
  impWereVerb: 'were',
  impConceptSummary: 'Concept: {name} ({cat})',
  backToStart: 'Back to start',
  nextRound: 'Next round',
  waitingHost: 'Waiting for host...',
  scoreboard: 'Scoreboard',
  next: 'Next',

  raiseTheBet: 'Raise the bet...',
  raiseBet: 'Raise bet',
  liarBtn: 'Liar!',
  mustBeGreaterThan: 'Must be greater than {n}.',
  liarAlert: '🚨 Liar!',
  pauseTime: '⏸ Pause time',
  resumeTime: '▶ Resume time',
  pausedLabel: '⏸ Paused...',
  markAnswer: 'Mark answer ✓',
  writeAnAnswer: 'Write an answer...',
  send: 'Send',
  answerNumber: 'Answer {n}',
  didntBelieveYou: '{accuser} didn\'t believe you. Name {target} from: {cat}',
  accusedOf: '{accuser} accused {accused}. Category: {cat}',
  sayAnswersAloud: 'Say your answers out loud.',
  listenAndJudge: 'Listen and judge at the end.',
  isTyping: '{name} is typing...',
  groupBelieve: 'Does the group believe them?',
  answersValid: 'Were the {n} answers valid?',
  saidAloudAccept: 'They were said out loud. Do you accept them?',
  validBtn: 'Valid ✓',
  invalidBtn: 'Not valid ✗',
  voteColon: 'Vote:',
  groupVoting: 'The group is voting...',
  waitingVotes: 'Waiting for votes...',
  voteSentDots: 'Vote sent...',
  votesCount: '{in}/{needed} votes',
  finalResult: 'Final result!',
  roundOf: 'Round {n}/{c}',
  liarSucceeded: '✅ {name} pulled it off',
  liarTimeout: '⏱ {name} ran out of time',
  liarFailed: '❌ {name} didn\'t convince',
  accuserLosesPoint: '{name} loses 1 point.',
  accuserGainsPoint: '{name} gains 1 point.',

  voteFormation: 'Vote for the formation',
  votesN: '{n} votes',
  voteSent: 'Vote sent!',
  formationLabel: 'Formation: {f}',
  preparingSilhouettes: 'Preparing the silhouettes...',
  budgetLabel: 'budget',
  skipsLabel: 'skips',
  teamLabel: 'team',
  cardLabel: 'card',
  noBidsYet: 'No bids yet',
  basePriceLabel: '${p}M base price',
  analyzing: 'Analyzing...',
  biddingOpen: 'Bidding open!',
  passSkips: 'Pass ({n} skips)',
  waitingDots: 'Waiting...',
  ineligibleMsg: 'You already filled this position or can\'t afford it.',
  bestBid: 'Best: ${amount}M — {name}',
  winningWith: 'You\'re winning with ${amount}M',
  biddingAmount: 'Bidding ${amount}M...',
  youPassedCard: 'You passed this card.',
  rockPaperScissors: 'Rock, paper or scissors',
  nobodyWantedCard: 'Nobody wanted this card',
  loserKeepsIt: 'The loser gets stuck with it 😈',
  rpsRock: 'Rock',
  rpsPaper: 'Paper',
  rpsScissors: 'Scissors',
  mysteryPlayerOf: 'Mystery player from {pos} — the loser gets stuck with them 😈',
  chooseYourMove: 'Choose your move',
  waitingFor: 'Waiting for: {names}',
  chosenWaitingRival: 'You chose. Waiting for the opponent...',
  alreadyChose: '{chosen}/{total} already chose...',
  keepsIt: '{name} gets stuck with it!',
  lostRps: 'Lost rock-paper-scissors',
  tieAgain: 'Tie! Again',
  repeatsBetweenTied: 'Repeats between those tied',
  discarded: 'Discarded',
  nobodyTookIt: 'Nobody took it.',
  gotItFor: 'You got it for ${amount}M!',
  lottery: 'Lottery',
  sold: 'Sold',
  wonItFor: '{name} won it for ${amount}M',
  seeFinalResult: 'See final result',
  nextCard: 'Next card',
  autoInSeconds: '(auto in {s}s)',
  teamTournament: 'Team tournament',
  debateBegins: 'The debate begins!',
  tournamentDesc: 'They\'ll face off position by position. Those not playing the duel vote.',
  ovrHidden: 'OVR hidden',
  advancesDirectly: '{name} advances directly',
  bestTeamOfRound: 'Best team of round {round} — waiting for opponent',
  roundN: 'Round {n}',
  roundWord: 'Round',
  remaining: 'Remaining: {names}',
  whoIsBetter: 'Who is better?',
  youPlayThisDuel: 'You\'re playing this duel. Waiting for votes...',
  winsThisPositionLeft: '◄ Wins this position',
  winsThisPositionRight: 'Wins this position ►',
  mediaValue: 'Rating {v}',
  duelResult: 'Duel result',
  advances: '{name} advances',
  beatOpponent: '{winner} beat {loser} ({a}–{b})',
  yourLineup: 'Your lineup',
  lineupOf: '{name}\'s lineup',
  champion: '🏆 Champion',
  ptsValue: '{p} pts',
  winsThisDuel: '{name} wins this duel',
  tie: 'Tie',
  noCard: 'No card',
  youSuffix: ' (you)',
  finalResultTitle: 'Final result',
  tapPlayerForLineup: 'Tap a player to see their lineup',
  newMatch: 'New match',
  noPlayerParens: '(no player)',

  psychicThinking: 'The Psychic is thinking...',
  youArePsychic: 'You\'re the Psychic!',
  psychicInstructions: 'See where the zone fell and give a clue to the group (by voice or text).',
  seeZone: '👁 See the zone',
  hideZone: '🙈 Hide',
  writeClueOptional: 'Write your clue (optional)...',
  clueGivenLetGuess: 'I gave my clue, let them guess!',
  thinkingClue: 'Thinking of their clue',
  whereDoesFallLabel: 'Where does the clue fall?',
  psychicClueLabel: 'Psychic\'s clue',
  lockAnswer: 'Lock answer',
  waitingEveryoneLock: 'Waiting for everyone to lock their answer...',
  waitingGuesses: 'Waiting for guesses...',
  moveYourNeedle: 'Move your needle and lock when ready.',
  answerLockedWaiting: 'Answer locked. Waiting for others...',
  alreadyLocked: '{in}/{needed} already locked...',
  zoneRevealed: 'Zone revealed!',
  sentCheck: '✓ Sent',
  psychicSuffix: '🔮 {name} (Psychic)',
  ptsPlus: '+{p} pts',

  board: 'Board',
  whoInstructions: 'Ask a Yes/No question (by voice or text), or try to guess who you are.',
  writeYourQuestion: 'Write your question...',
  whoDoYouThinkYouAre: 'Who do you think you are?',
  iKnowWhoIAm: 'I know who I am!',
  yourTurnToAnswer: 'It\'s your turn to answer!',
  yes: 'Yes',
  no: 'No',
  maybe: 'Maybe',
  waitingAnswer: 'Waiting for answer...',
  questions: 'Questions',
  didTheyGetIt: 'Did they get it?',
  correctBtn: 'Correct ✓',
  incorrectBtn: 'Incorrect ✗',
  saysTheyAre: '{name} says they are...',
  waitingConfirmation: 'Waiting for confirmation...',
  youFailed: '💀 You failed!',
  youWere: 'You were: {identity}',
  guessedIt: '🎉 {name} guessed: {identity}',
  wasEliminated: '💀 {name} was eliminated',
  triedToGuess: '{name} tried to guess',
  roundOfN: 'Round {n} of {c}',
  nextRoundArrow: 'Next round ▶',
  whoWasEachOne: 'Who was each one?',
  identitiesRevealed: 'Identities revealed',
  everyoneRevealed: 'Everyone was revealed!',
  matchEnded: 'Match ended',
  catFutbolistas: 'Players',
  catEquipos: 'Teams',
  catSelecciones: 'National teams',
  catDts: 'Coaches',
  catFutbolista: 'Player',
  catEquipo: 'Team',
  catSeleccion: 'National team',
  catDt: 'Coach',

  endMatchConfirm: 'End the match now?',
  scoresAria: 'See scores',
  endMatchAria: 'End match',
  scoresTitle: 'Scores',
  winnerLabel: '🏆 Winner!',
},
};

let currentLang = localStorage.getItem('lang') || 'es';

function t(key, vars){
  let str = (I18N[currentLang] && I18N[currentLang][key]) ?? (I18N.es[key] ?? key);
  if(vars){ for(const k in vars) str = str.split('{'+k+'}').join(vars[k]); }
  return str;
}

function applyStaticI18n(){
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach(el=>{ el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach(el=>{ el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el=>{ el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el=>{ el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  const btn = document.getElementById('btn-lang');
  if(btn) btn.textContent = currentLang === 'es' ? '🌐 ES' : '🌐 EN';
}

function setLang(lang){
  currentLang = lang;
  localStorage.setItem('lang', lang);
  applyStaticI18n();
  document.dispatchEvent(new Event('langchange'));
}

document.addEventListener('DOMContentLoaded', applyStaticI18n);
