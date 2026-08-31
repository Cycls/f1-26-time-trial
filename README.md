# F1 26 — Time Trial, Bahrain (night)

A three.js Formula 1 game built to the standard of the current official F1 title
(**F1 25 + 2026 Season Pack** — there is no standalone "F1 26"; EA skipped the 2026 annual release).
One mode: **Time Trial** at **Bahrain International Circuit** under floodlights, in a
**2026-regulation** car.

## Run it

```bash
npm install
npm start
```
Then open **http://localhost:8123**. No build step. three.js is vendored in `node_modules`;
nothing is fetched from the network at runtime.

### Controls
| | |
|---|---|
| steer | `A` / `D` or arrow keys |
| throttle / brake | `W` / `S` or up / down |
| gears | `E` up, `Q` down (auto by default) |
| Overtake boost | `Space` |
| change camera | `C` |
| restart lap | `R` |
A gamepad is supported if connected (analog triggers + rumble).

## Architecture

`index.html` -> `src/main.js` builds a `Game` owning the scene, camera, shared state and a module
registry. Every module is a class with `constructor(ctx)`, `async init()`, optional
`fixedUpdate(h)` (physics, fixed 1/120 s), `update(dt)`, `lateUpdate(dt)`, `resize(w,h)`.
A throw inside one module is caught and logged so the rest of the game keeps running.

`src/core/state.js` is the shared state contract — the single source of truth every module reads.

| module | owns |
|---|---|
| `render/` | renderer, night light rig, sky/IBL, post chain |
| `track/track.js`, `trackData.js` | Bahrain centreline, road mesh, surface query API |
| `track/environment.js` | floodlight masts, grandstands, barriers, hoardings, desert |
| `car/` | 2026-spec car geometry, materials, livery, active-aero animation |
| `physics/` | vehicle dynamics at 120 Hz |
| `camera/` | TV Pod / cockpit / chase / nose rig |
| `ui/` | broadcast HUD |
| `audio/` | procedural V6 turbo hybrid synthesis (WebAudio, no samples) |
| `vfx/` | tyre smoke, sparks, dust, skid marks |
| `game/`, `input/` | Time Trial rules, ghost, delta, timing; input curves and assists |

Track API other modules depend on (frozen):
`track.sampleS(s)`, `track.locate(pos, hintS)`, `track.surfaceAt(pos)`, `track.length`,
`track.sectorS[3]`.

## Tools

| tool | purpose |
|---|---|
| `tools/serve.mjs` | static server |
| `tools/shoot.mjs` | headless capture — PNGs + telemetry + console + errors, at a chosen camera/track position/speed |
| `tools/smoke.mjs` | integration test: every module constructs, inits and runs; reports honest draw calls |
| `tools/probe_physics.mjs` | measures downforce, lateral G vs speed, braking distance, top speed |
| `tools/blind.mjs` | builds a blind A/B folder from our frame + a reference frame, normalised so neither is identifiable |

Capture example:
```bash
node tools/shoot.mjs --out shots/x --w 1280 --h 720 \
  --shots "cam:chaseFar@s=300&kph=280,cam:cockpit@s=3400&kph=300"
```
Shot spec: `cam:<mode>@s=<metres round the lap>&kph=<speed>&lat=<lateral offset>`.
Cameras: `tvpod cockpit chase chaseFar nose`.

**Note on performance numbers:** captures run through ANGLE in headless Chrome, so the reported
`fps` is meaningless. Judge cost by `drawCalls` and `triangles` (currently ~850 / ~2.7M).
`renderer.info` is reset by the post chain's final pass, so the harness takes manual control of it —
reading it naively gives zero.

## Reference documents
`docs/reference-physics.md` — FIA 2026 technical regs (Issue 18) incl. the exact Art. C5.2.8 power
curves, Bahrain corner-by-corner, and an acceptance-band table.
`docs/reference-visual.md` — rendering, cameras, VFX, and the restraint rules.
`docs/reference-hud.md` — HUD layout measured off real screenshots, with sampled hex values.
`docs/RESULTS-physics.md` — our measured physics vs the bands.
`docs/CRITIC.md` — the blind review protocol used to judge each piece.
