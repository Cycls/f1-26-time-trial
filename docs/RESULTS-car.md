# CAR — round 1 blind A/B result

**Critic picked B as better with high confidence. B was the REFERENCE. Ours lost. FAIL.**

Judged blind, before seeing any source: bodywork completeness, wings, tyres/wheels, paint response,
decals, suspension detail, grounding — the reference won on every one.

## The important finding: the geometry is NOT the problem
The critic's blind reading was "a skeleton with missing panels". After investigation that turned out
to be **wrong about cause, and the truth is worse**: `bodywork.js` really does build a full lofted
monocoque, sidepods, airbox, engine cover, halo and mirrors, and the front wing exists. The
expensive geometry is being **destroyed at the material stage**.

### Root cause 1 - the livery UV scale is discarded (highest cost)
`textures.js` authors the livery against a real unwrap (perimeter 1.7 m, length 4.95 m, so decals are
sized in centimetres) but `loft()` writes **normalised** UVs: U is each ring's arc length over *that
ring's* perimeter, V is normalised along *that mesh's* spine. The monocoque perimeter runs ~0.3 m at
the nose to ~1.6 m at the cockpit, so U stretches ~5x along the car. And `podR`/`podL` share the same
material, so the whole 4.95 m livery is squeezed a second time into a 2.46 m sidepod — every graphic
appears twice, at two scales, overlapping.

### Root cause 2 - the halo is painted 60% team red
Two 30%-wide bands of `#c8102e` on a clearcoated material; under the floods it blows to salmon pink
and frames the entire cockpit view with two glowing pink arcs.

### Root cause 3 - carbon weave aliases to grey streaks
34 U repeats over a ring perimeter collapsing ~25x, so the weave cell goes 25 mm -> 1 mm and turns
into a vertical grey waterfall down the engine cover.

## Regulation errors measured from source
| | ours | 2026 reg | error |
|---|---|---|---|
| rear wing profile span | 940 mm | 1150 mm | -210 |
| rear wing mainplane height | 680 mm | band 725-880 | 45 below the band |
| rear endplate | 498-982 mm | inside 725-880 | 227 below / 102 above |
| front wing profile span | 1700 mm | 1350 mm | +350 |
| footplate outer | 1856 mm | 1800 overall | +56 |
| rim diameter | 457 mm both axles | 462.5 F / 463 R | no F/R distinction |
| rim mounting width | 243 / 338 mm | 315 / 401.3 | -72 / -63 |
| front tyre OD | 660 mm (rear 720) | real delta is ~5 mm | fronts 60 mm undersized |
| active aero transition | 405 ms to 99%, asymptotic | <= 400 ms | over, and never completes |

## Regressions and dead code
- **The soft-compound red sidewall band disappeared** between the 19:18 and 19:57 builds. With
  `flip = true` the band lands at r = 251-279 mm on a 237-330 mm sidewall — the bottom third, against
  the rim, and only 28 mm wide.
- `M.endplateL` and `M.wheelCoverL` are built specifically so left-side text is not mirrored, and are
  **never used** — so left sponsor text reads backwards.
- Suspension is one static merged mesh on `root`: it neither steers with the wheels nor follows the
  sprung mass.

## What the critic verified as CORRECT
wheelbase exactly 3400 mm; overall width within 1900 mm; no wheel arches; 3-element rear wing with
**no beam wing**; active aero fails safe to Cornering Mode by construction; both front AND rear wings
animate; partially flat floor with shallow-but-present tunnels; sign-correct static camber
(3.55 deg front / 1.6 deg rear); Time Trial runs soft, C1-C5 only; `errors.json` empty, console clean.

## Claims the critic falsified
- `dims.js` "front wing 1700 mm, 100 mm narrower than 2025" — wrong twice: 2026 overall is 1800 mm
  with profiles at 1350 mm, and the reduction from 2025 is 200 mm, not 100.
- `dims.js` "1596 + 270 tyre = 1900 measured" — that is 1866.
- `bodywork.js` "everything is lofted or swept, no primitives used as bodywork" — mirrors, cockpit
  pads, seat, nose camera pods and roll bar are all Box/Cylinder primitives, and the mirrors are
  prominent in the cockpit view.
- The tyre band comment says "near the shoulder"; it is at the bead.

## Note on method
The round-1 captures were **rear-only chase cameras, which hid the mirroring and front-wing defects
entirely.** Any further car round must shoot from a side and front three-quarter angle.
