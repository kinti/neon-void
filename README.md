# NEON VOID

Arcade espacial 3D (estilo neón) construido con Babylon.js + Vite + TypeScript.

## Estado

- [x] Scaffold Vite + TS + `@babylonjs/core`
- [x] Nave con movimiento 2D (x/y), inclinación y estela de partículas
- [x] Asteroides poliedro de 2 tipos (grandes 3 HP / pequeños 1 HP), spawn con dificultad progresiva
- [x] Disparos con cooldown, colisiones bala-asteroide y nave-asteroide
- [x] Puntuación, 3 vidas, game over + reintento
- [x] Estética neón: GlowLayer, explosiones de partículas, starfield procedural, camera shake
- [x] HUD (score + vidas + BEST) y overlay de inicio/game over
- [x] Power-ups: cápsula verde = triple disparo (8 s, nave en verde), cápsula amarilla = escudo (absorbe 1 impacto)
- [x] Sonido sintetizado con Web Audio API (disparo, explosión, power-up, game over) — sin assets
- [x] Récord persistente en localStorage (`neonvoid-best`)
- [x] Verificado con captura headless y vídeo de prueba (`proof.mp4`)

## Pendiente

- [ ] Assets generados con asset-gen (requiere API keys: GOOGLE_API_KEY / XAI_API_KEY)

## Assets

| Asset | Tipo | Origen |
|---|---|---|
| spark.png | partícula | procedural (script Node, radial gradient) |
| starfield.png | textura | procedural (script Node, puntos aleatorios) |
| nave, asteroides, balas | geometría | primitivas Babylon.js + materiales emisivos |

## Cómo jugar

```sh
npm install
npm run dev   # http://localhost:5173
```

WASD / flechas para mover, ESPACIO para disparar. Recoge las cápsulas verdes (triple disparo) y amarillas (escudo).
