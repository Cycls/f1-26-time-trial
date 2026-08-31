# F1-26-three — SHARED BRIEF (read fully before editing anything)

We are building a three.js Formula 1 game whose **only** game mode is **Time Trial at
Bahrain International Circuit, night race**. The quality bar is the video game **F1 26**
(EA/Codemasters). Not "good for a web game" — the actual game.

## Absolute rules

1. **You own only the files listed in your task. Never edit another piece's files.**
   If you need something from another module, use the documented API or the shared state.
   If you truly need a change elsewhere, write it to `docs/REQUESTS.md` (append only) instead.
2. Shared, do-not-break files: `src/main.js`, `src/core/state.js`, `src/core/config.js`,
   `src/core/bus.js`, `index.html`, `tools/*`. You may READ them. Editing them is forbidden
   unless your task explicitly says otherwise.
3. **Never remove another module's functionality to make yours look better.**
4. The game must always still run. After every change:
   `node --check <yourfile>.js` for each file you touched, then verify with a capture (below).
5. No external network assets at runtime (no CDN textures/models). Everything procedural or
   generated into `assets/`. three.js is local at `./node_modules/three`.
6. Target 60fps on a normal laptop GPU. Watch draw calls; instance repeated geometry.
   **Never add more than 8 dynamic lights** — it blows the WebGL uniform budget and stalls
   shader compilation. Use emissive materials + bloom for light *sources*.

## Architecture

Entry `index.html` → `src/main.js` builds a `Game` that owns the scene, camera, state and a
registry of modules. Every module is a class:

```js
constructor(ctx)   // ctx = {scene, camera, renderer, state, config, bus, get(name), game}
async init()       // build resources
fixedUpdate(h)     // physics only, fixed 1/120 s
update(dt)         // per frame
lateUpdate(dt)     // after camera solve
resize(w, h)
```

A throw inside a module is caught and logged — the rest of the game keeps running. That means
**a silent bug will not crash the page; you must read the console log from the capture.**

`src/core/state.js` is the shared state contract. Read it. Write only the sub-object your
module owns. Do not add top-level keys.

Module registry names for `ctx.get(name)`:
`render, track, env, car, physics, input, camera, vfx, audio, hud, game`

Track API (depended on by physics, vfx, env, game — signatures are frozen):
```
track.length                          // metres
track.sampleS(s)   -> {point,tangent,right,up,halfWidth,curvature,banking,s}
track.locate(pos, hintS) -> {s, lateral, halfWidth, onTrack, surface, height, tangent, right}
track.surfaceAt(pos) -> 'asphalt'|'kerb'|'astro'|'gravel'|'grass'|'wall'
track.sectorS[3]                      // sector end distances in metres
```

## How to see your work (mandatory)

A static server is already running on **http://localhost:8123**. If it is not, start it:
`node tools/serve.mjs 8123 . &`

Capture real frames + telemetry headlessly:

```bash
cd /path/to/f1-26-time-trial
node tools/shoot.mjs --out shots/mypiece --w 1600 --h 900 \
  --shots cam:tvpod@s=300&kph=300,cam:cockpit@s=2450&kph=180,cam:chase@s=4100&kph=260
```

Shot spec: `cam:<mode>@s=<metres along lap>&kph=<speed>&lat=<lateral offset m>`
Camera modes: `tvpod cockpit halo chase chaseFar nose`.
Writes PNGs + `telemetry.json` + `console.log` + `errors.json` into the out dir.
**Always read `errors.json` and `console.log`.** Then look at the PNGs with the Read tool —
actually look at them, do not assume.

`--drive <seconds>` runs with throttle pinned and logs a telemetry trace to `drive-trace.json`.

Useful distances around the 5412 m lap: `0` start/finish, `300` main straight,
`1100` T1 area, `1900` mid sector 1, `2450` sector 2, `3400` back straight, `4100` fast
sector 3, `5000` final corners.

Rendering is headless via ANGLE — **fps in telemetry is NOT a real performance number.**
Judge performance by `drawCalls` and `triangles`, not fps.

## The bar

Every piece is judged by a separate critic with fresh context, in a **blind** A/B against a
real F1 26 reference. "Better than what a web game usually does" is a fail. The critic is
instructed to be hostile. Assume it will zoom in.
