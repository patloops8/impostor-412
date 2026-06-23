# 412

App de juegos de fiesta sobre fútbol. Tres juegos en uno: **El Impostor**, **Mentiroso** y **Subasta Futbolera**.

## Novedad de esta versión: sin pantalla "host" separada

Ahora **no necesitas dos dispositivos**. Quien crea la sala es un jugador más (el "anfitrión")
que además controla la configuración y el avance de la partida, todo desde su mismo celular.

- Una persona abre la app, pone su nombre y **crea una sala** → recibe un código de 4 letras.
- Comparte el código con sus amigos (botón de compartir nativo).
- Los amigos entran a la misma URL, ponen su nombre y el código.
- El anfitrión elige el juego, lo configura y le da iniciar. Todos juegan desde su propio celular.

### Vista TV opcional
Si quieren una pantalla central (tele, proyector), abran `/tv` en ese dispositivo
y pongan el código. Es **opcional** y solo muestra el estado en grande, sin controles.
También funciona con link directo: `/tv?c=CODIGO`.

## Correr en local

```bash
cd impostor-412
npm install
npm start
```

Abre `http://localhost:3000` en cada dispositivo (misma red WiFi), o despliega en Render
para jugar a distancia.

## Estructura

```
impostor-412/
├── server.js              # Servidor: salas, jugador-anfitrión, lógica de los 3 juegos
├── data/
│   ├── concepts.json          # El Impostor
│   ├── mentiroso-categories.json
│   └── subasta-cards.json     # 130 cartas con 9 posiciones específicas
└── public/
    ├── index.html             # App unificada (todos los estados)
    ├── app.js                 # Toda la lógica del cliente
    ├── tv.html                # Vista TV opcional
    └── style.css
```

## Notas técnicas importantes

- **El servidor es el reloj único.** En Subasta, el tiempo lo lleva el servidor y emite
  "ticks" cada segundo a todos por igual. Los celulares solo muestran el número que reciben,
  así que no se desincronizan entre sí.
- **Reconexión automática.** Si un celular pierde conexión (típico con el plan gratis de
  Render que duerme el servidor), al reconectar se reintegra a la sala con `player:rejoin`
  y, si está en una subasta, pide el estado actual para no quedar atascado.
- **Imágenes de Subasta:** por ahora se cargan desde Wikipedia en el navegador de cada quien.
  El plan es reemplazarlas por imágenes propias (siluetas hechas en Photoshop) usando el
  formato Excel + ZIP que definimos.

## Hacia una app nativa (App Store / Play Store)

Esta versión está diseñada como app web para poder empaquetarse luego con Capacitor o
similar. Eso es un proyecto aparte que requiere tu máquina, cuentas de desarrollador
(Apple $99/año, Google $25 una vez) y los procesos de revisión de cada tienda.
