# 412 (Prototipo)

App de juegos de fiesta sobre fútbol, inspirada en el programa "412". Una persona abre la
pantalla del host (TV/laptop/proyector) y los demás se conectan desde su celular en la
misma red WiFi. Incluye dos juegos: **El Impostor** y **Mentiroso**.

> ⚠️ Nota: este código se generó en un entorno sin acceso a internet, así que no se pudo
> correr `npm install` ni probarlo en vivo aquí. Sí se validó la sintaxis de todos los archivos
> (`node --check`). Revísalo al correrlo por primera vez y avísame si algo truena.

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

## 3. Conectar dispositivos

- **Pantalla del juego (host)**: `http://localhost:3000/host`
- **Celulares de los jugadores**: misma red WiFi, abrir `http://TU_IP_LOCAL:3000`
  (ej. `http://192.168.1.45:3000`). Para saber tu IP local: `ipconfig getifaddr en0` (Mac)
  o `ipconfig` (Windows, busca "Dirección IPv4").

## 4. Jugar

1. En el host: clic en **Crear sala** → aparece un código de 4 caracteres.
2. Cada jugador entra a la URL del celular, escribe el código y su nombre.
3. Cuando haya 3+ jugadores conectados, el host elige el juego: **El Impostor** o **Mentiroso**.

### El Impostor
- Configura número de impostores, mangas a jugar y categorías incluidas.
- Cada celular recibe en privado su rol (concepto real o "eres impostor").
- Por turnos, cada jugador escribe una palabra relacionada y la dice en voz alta.
- Tras la ronda de pistas, todos votan. Empate = nadie sale. Si se atrapa al último
  impostor, ganan los inocentes; si los impostores igualan o superan en número a los
  inocentes vivos, ganan ellos (regla tipo Mafia).

### Mentiroso
- Configura cuántas rondas (categorías) jugar, y si incluir categorías objetivas
  (validadas contra una base de datos real) y/o subjetivas (las valida el grupo votando).
- Cada ronda sale una categoría (ej. "selecciones campeonas del Mundial" o, para humor,
  "futbolistas que serían buenos DJs").
- Por turnos: el primero dice "puedo decir N", el siguiente sube el número o acusa
  "¡Mentiroso!" al anterior.
- Al acusar, el acusado debe nombrar esa cantidad de respuestas distintas:
  - Categoría objetiva → se valida automático contra la base de datos.
  - Categoría subjetiva → los demás jugadores (menos acusado y acusador) votan
    válido/no válido por cada nombre; empate cuenta como válido.
- Si lo logra, +1 punto para el acusado y -1 para el acusador. Si falla, al revés.

En ambos juegos: al terminar una ronda/manga, el host ve el resultado y el marcador
acumulado, y avanza a la siguiente — excepto en la última, donde reinicia para una
partida nueva con marcador en cero (y vuelve a la pantalla de elegir juego).

## Estructura del proyecto

```
impostor-412/
├── server.js                     # Servidor Express + Socket.io, lógica de ambos juegos
├── data/
│   ├── concepts.json               # El Impostor: futbolistas, equipos, selecciones, DTs
│   └── mentiroso-categories.json   # Mentiroso: categorías objetivas y subjetivas
├── public/
│   ├── style.css                    # Estilos compartidos (identidad visual)
│   ├── host/                        # Pantalla compartida
│   │   ├── index.html
│   │   └── host.js
│   └── player/                       # Pantalla de celular
│       ├── index.html
│       └── player.js
```

## Notas sobre las categorías objetivas de Mentiroso

Las listas "verdad" de las categorías objetivas (campeones del mundo, campeones de
Champions, etc.) son curadas a mano y deberían ser correctas, pero no están
garantizadas al 100% — si el grupo nota que falta una respuesta válida en alguna,
avísame y la corrijo. Por eso mantuve esa lista corta: preferí pocas categorías
objetivas muy confiables, y dejar la mayoría de la variedad en categorías subjetivas
(que no dependen de una base de datos, las decide el grupo).

## Limitaciones conocidas de este prototipo

- No hay reconexión "inteligente" del host si se cae.
- Si un jugador se desconecta a mitad de partida, su turno se salta automáticamente.
- Todo vive en memoria: si reinicias el servidor, se pierden todas las salas y marcadores.
- Pensado para jugarse en la misma red WiFi local, o desplegado en un servicio como
  Render para jugar desde distintas ubicaciones.

## Próximos pasos sugeridos

1. Probar Mentiroso con tus amigos y anotar fricciones de UX.
2. Seguir con Subasta Futbolera usando la misma base de servidor (salas + Socket.io).
