# 412 — El Impostor (Prototipo)

Prototipo jugable de "El Impostor". Una persona abre la pantalla del host (TV/laptop/proyector)
y los demás se conectan desde su celular en la misma red WiFi.

> ⚠️ Nota: este código se generó en un entorno sin acceso a internet, así que no se pudo
> correr `npm install` ni probarlo en vivo aquí. Sí se validó la sintaxis de todos los archivos
> (`node --check`). Revísalo al correrlo por primera vez y avísame si algo truena para corregirlo.

## 1. Instalar

Necesitas [Node.js](https://nodejs.org) instalado (v18 o superior).

```bash
cd impostor-412
npm install
```

## 2. Correr el servidor

```bash
npm start
```

Vas a ver algo como:

```
412 - El Impostor corriendo en http://localhost:3000
Host: http://localhost:3000/host
```

## 3. Conectar dispositivos

- **Pantalla del juego (host)**: en la computadora/laptop conectada a la TV, abre
  `http://localhost:3000/host`
- **Celulares de los jugadores**: deben estar conectados a la **misma red WiFi** que la
  computadora del host. Averigua la IP local de tu computadora:
  - Mac/Linux: `ifconfig | grep "inet "` (o `ipconfig getifaddr en0` en Mac)
  - Windows: `ipconfig` (busca "Dirección IPv4")
  - Luego en cada celular abre: `http://TU_IP_LOCAL:3000` (ej. `http://192.168.1.45:3000`)

El host también puede mostrar esa dirección + el código de sala para que la gente se una.

## 4. Jugar

1. En el host: clic en **Crear sala** → aparece un código de 4 caracteres.
2. Cada jugador entra a la URL del celular, escribe el código y su nombre.
3. Cuando haya 3+ jugadores conectados, el host puede pulsar **Iniciar partida**.
4. Cada celular recibe en privado su rol (concepto real o "eres el impostor").
5. Por turnos (mostrados en la pantalla del host), cada jugador escribe una palabra
   relacionada — y la dice en voz alta para que todos jueguen en persona.
6. Al terminar la ronda de pistas, todos votan desde su celular.
7. Se revela el resultado; si nadie atrapó al impostor, sigue la partida; si lo atraparon
   o solo quedan 2 jugadores, termina la partida y se reparten puntos.
8. El host puede pulsar **Nueva partida** para jugar otra ronda manteniendo el marcador.

## Estructura del proyecto

```
impostor-412/
├── server.js              # Servidor Express + Socket.io con toda la lógica del juego
├── data/concepts.json      # Set de ejemplo: futbolistas, equipos y selecciones
├── public/
│   ├── style.css            # Estilos compartidos (identidad visual)
│   ├── host/                # Pantalla compartida
│   │   ├── index.html
│   │   └── host.js
│   └── player/               # Pantalla de celular
│       ├── index.html
│       └── player.js
```

## Limitaciones conocidas de este prototipo (para la siguiente iteración)

- No hay reconexión "inteligente" del host si se cae (si el host se desconecta, la sala
  sigue viva pero nadie controla el flujo).
- Si un jugador se desconecta a mitad de partida, su turno se salta automáticamente y no
  cuenta para la votación, pero sigue apareciendo en la lista.
- El set de datos (`concepts.json`) es solo de ejemplo — hay que ampliarlo con más
  futbolistas/equipos/selecciones y variar la dificultad.
- Todo vive en memoria: si reinicias el servidor, se pierden todas las salas y marcadores.
- Pensado para jugarse en la misma red WiFi local (no está desplegado en internet).

## Próximos pasos sugeridos

1. Probarlo con tus amigos y anotar fricciones de UX (esto es lo más valioso ahora).
2. Ampliar `concepts.json`.
3. Una vez validado, seguimos con Mentiroso y Subasta Futbolera con la misma base de
   servidor (salas + Socket.io).
