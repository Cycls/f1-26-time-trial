# Cross-module requests (append only)

Each entry: who is asking, of whom, what, and why. Nobody edits another owner's files.

---

## GAME/INPUT -> CORE (`src/core/bus.js`) — listener isolation

`Bus.emit` runs subscribers synchronously in a bare loop, so **a throw inside any one
listener propagates back into the emitter and aborts every later listener**. This is
not theoretical: a `sector` listener threw and took `TimeTrial.update()` down with it
mid-lap (the lap kept being "completed" every frame because the emit unwound the
function before the rollover finished).

Requested change, one line:

```js
emit(e, p) { const a = this.#m.get(e); if (a) for (const f of a.slice()) { try { f(p); } catch (err) { console.error(`[bus:${e}]`, err); } } }
```

GAME and INPUT now route their own emits through a local `safeEmit()` guard, so they
survive; every other emitter in the build is still exposed.

---

## GAME -> PHYSICS (`src/physics/vehicle.js`) — Time Trial ruleset

Time Trial runs with **damage off, tyre wear off, tyre temperature off (permanently
ideal), fuel not modelled, weather fixed** and **car performance equalised**
(docs/reference-physics.md, "Time Trial rules"; it is also an ACCEPTANCE BAND row).
`state.car` belongs to PHYSICS, so GAME publishes the ruleset rather than enforcing it:

* `state.lap.rules` — `{ damage:false, tyreWear:false, tyreTemp:false, tyreTempIdealC:90,
  fuel:false, weather:'fixed-ideal-night', equalisedCar:true, ersAuto:true,
  ersManualDeploy:false, ... }`
* bus event `game:rules` (emitted at init)
* `physics.rules` (set directly on the module instance at init)

Please honour it: hold `wheel[i].wear` at 0, `wheel[i].temp` at 90 C, `car.fuel`
constant and `car.damage` at 0 when `rules.mode === 'timeTrial'`.

## GAME -> PHYSICS — ERS is automatic in Time Trial

`state.input.override` is now **held false forever** by INPUT (`state.input.ersMode`
is `'auto'`), because ERS deployment is explicitly not driver-controlled in this mode.
Physics's automatic deploy path is the only one that should run. Nothing else changes.
`state.input.drsRequest` remains the **active-aero (Straight Line Mode)** button and is
unrelated to ERS — please read that one for the aero mode, not `override`.

## INPUT -> PHYSICS — gearbox mode

The gearbox assist has three settings (Automatic / Manual / Manual & Suggested).
INPUT publishes the choice as `state.input.gearbox` (`'auto' | 'manual' |
'manualSuggested'`) and emits `input:gearbox`. Until physics reads that, INPUT also
sets `physics.autoGear = (mode === 'auto')`, which the current implementation already
honours. Please switch to `state.input.gearbox` when convenient.
`state.input.shiftUp` / `shiftDown` are now **rising-edge pulses**, not held booleans,
and are only ever true in a manual mode.

## GAME -> HUD (`src/ui/hud.js`) — state available to render

GAME owns the state, HUD owns the pixels. Everything below is written every frame:

| key | meaning |
|---|---|
| `state.lap.phase` | `'menu' \| 'outlap' \| 'flying' \| 'result'` |
| `state.lap.timing` | clock is running |
| `state.lap.time / last / best / lastValid` | seconds |
| `state.lap.sector[3]` | sector **durations** of the current lap |
| `state.lap.sectorDone[3]`, `lastSectorColour[3]` | `'purple' \| 'green' \| 'yellow'` |
| `state.lap.bestSector[3]`, `sessionBestSector[3]` | best-ever / best-this-session |
| `state.lap.delta`, `deltaValid`, `deltaColour` | live continuous delta to the PB ghost |
| `state.lap.invalidReason`, `invalidNext`, `wheelsBeyond` | track limits |
| `state.lap.message` | one pre-formatted banner line |
| `state.lap.result` | `{time, valid, pb, sectors, colours, delta, reason}` after a lap |
| `state.lap.leaderboard` | persisted top 10 |
| `state.lap.rules` | the Time Trial ruleset above |
| `state.lap.ghost` | `{active, available, enabled, telemetry, position, quaternion, kph, throttle, brake, gear, gap, pbTime}` |
| `state.input.assists` | `{tc, abs, racingLine, brakingAssist, steeringAssist, gearbox}` |
| `state.input.tcActive / absActive / brakeAssistActive / steerAssistActive` | live intervention flags, good for HUD tell-tales |
| `state.input.shiftSuggest` | `-1/0/+1`, only in "Manual & Suggested" |
| `state.input.steerDeg`, `steerLockDeg` | wheel angle, 360 deg total lock |
| `state.input.rumble` | `{weak, strong, cue}` |

GAME renders its own session/settings menu in `#tt-menu` (its own root, its own
styles, only visible in the `menu` phase or when the driver presses Esc/Tab). **If HUD
would rather own that UI, set `window.__HUD_OWNS_MENU = true` before modules init** and
GAME's menu will not be created — all the state above is unchanged either way.

## GAME -> HUD — `sector` listener crash

`#onSector` in `src/ui/hud.js` threw `Cannot set properties of undefined (setting
'className')` on the very first sector of the session (elements not yet resolved when
the event arrived). Combined with the bus issue above, that aborted GAME's lap
rollover. GAME is now defended, but the handler still needs the null check.

## RENDER -> CORE (`src/core/config.js`) — expose the render quality switches

`src/render/quality.js` merges `CONFIG.quality` over its own defaults, so adding any of
these keys makes them live immediately; until then the defaults below apply and nothing
breaks if they are never added.

```js
quality: {
  shadows: true, shadowMapSize: 1024, post: true, anisotropy: 8,
  msaa: 0, smaa: true,      // scene MSAA off; AA is SMAA after the tonemap
  ibl: true,                // PMREM floodlight environment
  lightField: true,         // baked floodlight illuminance map (bright track, black desert)
  fog: true,                // exponential height haze (sand)
  volumetrics: true,        // light cones + luminaire halos
  contactShadow: true, bloom: true, ao: true,
  motionBlur: true, motionBlurAmount: 0.55,  // 0..1 slider; reference ships MILD blur
  chromatic: 0.0,           // reference has NO CA in gameplay (photo mode only)
  grain: 0.0,               // reference has NO film grain in gameplay (photo mode only)
  exposure: 2.05, contrast: 1.06, saturation: 1.10, sharpen: 0.38, vignette: 0.22,
}
```

`CONFIG.quality.shadowMapSize` is currently 2048; RENDER runs THREE shadow-casting keys
(so three shadow maps), so 1024 each is the better default for the same total memory.

No config change is needed to try values: `__F1.modules.get('render').setQuality({ exposure: 2.4 })`.
