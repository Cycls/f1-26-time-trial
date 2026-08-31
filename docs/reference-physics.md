# REFERENCE — 2026 F1 physics & Time Trial (grading source of truth)

> **Naming.** There is no standalone "F1 26" game. The 2026 product is **F1 25 + 2026 Season
> Pack** (June 2026). "F1 26" below = that game at 2026 spec. Where the GAME and REALITY differ
> we say which to grade against.

## The four traps (a naive build fails all of these)
1. **Braking is WEAKER in 2026, not stronger.** Brembo, Melbourne T11: 4.8 g (2025) -> **3.3 g (2026)**.
   Distance 96 m -> **116 m**. >4.0 g sustained = definitively wrong.
2. **Peak lateral G is ~4.0-4.5 g, not 5-6 g**, and is meaningless without a speed.
3. **Top speed 315-345 km/h**, not 350+. FIA publicly rejected 400 km/h talk.
4. **Speed peaks MID-straight then dips** as electric deployment tapers. A monotonic rise to the
   braking point is a 2025 car. This is the clearest 2026 signature.

## Car (2026 regs)
mass **768 kg** (regs say **724 kg + nominal tyre mass ~44 kg**; 726 kg in Qualifying. Driver+ballast
min **82 kg**. Mass distribution in Qualifying: front axle >= 0.44x, rear >= 0.54x)
wheelbase **max 3400 mm** (no minimum in the regs) | width **1900 mm** (+/-950 from centreline)
floor max width **1540 mm** (F1.com's "floor reduced to 1.9 m" is a conflation with overall width)
tyres: tread **-25 mm front / -30 mm rear** (absolute widths are set by Pirelli, not the regs).
**Wheel rims are regulated exactly (C10.7.2a): rim diameter 462.5 front / 463 rear mm (18"),
tyre mounting width 315 front / 401.3 rear mm, lip external diameter 496 mm, magnesium alloy.**
front wheel arches removed | **front wing overall width 1800 mm** (profiles span 1350 mm, footplate
and diveplane reach 900 mm from centreline), **two movable elements: FW Primary Flap + FW Secondary
Flap** | **rear wing 3 elements, span 1150 mm, height band 725-880 mm**, beam wing removed
Floor: ground effect **retained but weakened** — partially flat floor + lower-performance diffuser;
the venturi tunnels are shallower, not deleted.
**Active aero transition time <= 400 ms**, only two positions (no intermediates), and **failure
returns the wings to Cornering Mode** (fail-safe). Front wing driven by up to 2 actuators, rear by 1.
roll hoop 20 G | downforce **-30% vs 2025** | drag **-55%**

**Power unit:** ICE ~**400 kW** + MGU-K **350 kW** = **~750 kW / ~1000 bhp**, split ~**50:50**.
**MGU-H removed.** Fuel flow energy-based **3000 MJ/h**. 100% sustainable fuel. Race fuel ~70 kg.
Battery deploy up to **9 MJ/lap**. Rev limit 15,000 rpm but **useful band is 7,000-12,500 rpm** —
peak power ~10,500-12,000. **Shifting at 15,000 sounds wrong.** 8-speed, driver-shifted.

**Active aero (replaces DRS):** two states, driver-switched. **In-game names are "Cornering Mode"
and "Straight Line Mode" — NOT "X-mode"/"Z-mode"** (that is FIA regulation shorthand; no EA source
uses it).
- **Cornering Mode** = high wing angle, max downforce+drag, **default**. Auto-engages when turning,
  braking, lifting, or exiting a Straight Line Zone.
- **Straight Line Mode** = **both front AND rear wings flatten** (the front wing angle changes too,
  not just the rear flap). Only in **pre-designated zones**, up to **4 per circuit**, available to
  **every** car (not gap-gated — that was DRS). **Only works at 100% throttle** — lift early and you
  lose it. Not permitted at Monaco.
- The wings are **visibly animated** and there is a **HUD mode indicator** (needed because in cockpit
  cam you cannot see the wings). Devs: "We needed to make sure the front and rear wings were both
  moving visually and had the correct physics effect."
- Button: same one DRS used. An assist can automate it.

**Overtake (replaces DRS boost; the in-game name is "Overtake", NOT "Manual Override"):** 350 kW,
**+0.5 MJ**, needs to be within **1.0 s** at a detection line.

**EXACT deployment curves — FIA 2026 Technical Regs Section C, Art. C5.2.8, Issue 18 (7 May 2026).
Implement these verbatim; v = car speed in km/h, P = propulsive DC power in kW, capped at 350:**
```
Overtake NOT active:
  P = 1800 - 5*v      for v < 340        -> 350 kW holds to 290, then tapers
  P = 6900 - 20*v     for 340 <= v < 345
  P = 0               for v >= 345
Overtake ACTIVE:
  P = 7100 - 20*v     for v < 355        -> 350 kW holds to 337.5, then tapers
  P = 0               for v >= 355
Race/Sprint safety sectors:
  P = 250             for v < 310, then the non-Overtake curve above
```
NOTE a widely-repeated 2024 figure is now WRONG: the **non-Overtake** curve reaches zero at
**345 km/h**, not 355. The 355 km/h zero point belongs to the **Overtake** curve only.

Other hard regulation numbers: ERS-K absolute power cap **350 kW** (C5.2.7). MGU-K mechanical torque
<= **500 Nm** (C5.2.11). MGU-K unusable below **50 km/h** from a standing start (C5.2.12). Energy
store SoC swing <= **4 MJ** (C5.2.9). Recharge <= **8.5 MJ/lap** (C5.2.10), +0.5 MJ with Overtake.
Fuel energy flow <= **3000 MJ/h**, and below 10,500 rpm <= **0.27*rpm + 165 MJ/h** (C5.2.3/4) — which
is exactly why peak power lands at ~10,500 rpm.
**Clipping**: energy runs out mid-straight, drop to ICE-only ~400 kW.
**Super-clipping**: car slows AT FULL THROTTLE while MGU-K regenerates (up to 250 kW of the
400 kW diverted, leaving ~150 kW at the wheels).

## Performance envelope
0-100 **2.4-2.6 s** | 0-200 ~4.8 s | 0-300 ~8.5-10 s
Top speed: Bahrain test **328 km/h** (Leclerc), 341 max recorded; Australia trap 315 km/h.
Peak braking **3.3 g**; typical race-lap decel 2.0-2.4 g.
300->100 km/h in **~105 m**; 300->0 in ~120-135 m; Bahrain T1 330->85 km/h in **~165-170 m**.

**Lateral G vs speed** (m=768 kg, ClA~4.65, mu~1.6) — grade against THIS, not a single peak:
| speed | downforce | max lateral |
|---|---|---|
| 80 km/h | ~143 kgf | **~1.9 g** |
| 150 km/h | ~504 kgf | **~2.65 g** |
| 200 km/h | ~896 kgf | **~3.5 g** |
| 250 km/h | **~1400 kgf** | **~4.5 g** |

**Downforce = car weight at ~180-190 km/h.** If yours equals weight at ~130 km/h you built 2022 aero.
**Downforce at 250 km/h must be 1300-1500 kgf.** (2025 was ~2000.)

Corner speeds: slow hairpin **65-90**, medium **140-180**, fast **200-250** km/h.
**Bahrain T12 is ~200 km/h in 2026** (was ~260) — drivers under-drive fast corners to save energy.
An optimal 2026 lap is NOT a maximum-lateral-G lap.

Lap times: 2026 is **+2.6 to +3.4 s** slower than 2025 (REAL) but only **+1 to +2 s** in the GAME —
EA modelled only a **15%** downforce cut, not 30% (their own FAQ). Codemasters targeted ~1.5 s
slower on a median track. Bahrain 2026 test best **1:31.992** (Leclerc, C4).
2025 test best 1:29.348. **Target Bahrain qualifying window 1:30.5-1:32.0.**

## Tyres
Compounds **C1-C5** — **C6 was dropped for 2026.** Hard=white Medium=yellow Soft=red Int=green Wet=blue.
mu **1.5-1.8**, **load-sensitive: mu(Fz) ~= 1.8 - 5e-5 * Fz** — omitting load sensitivity is the usual
cause of "our lateral G is too high".
Peak slip angle **6-8 deg**. Peak longitudinal slip ratio **~10%**. Cornering stiffness >100,000 N/rad.
Racing slicks: **sharper peak and steeper post-peak falloff** than road tyres.
Temps (game table, C3): min 80 / optimal **90** / max 105 C.
**Over-temp = grip stays 98-99% but wear rockets.** Under-temp = grip 95-97%, low wear. Modelling
over-temp as a big instantaneous grip loss is a common error.
Graining = too COLD, early stint, front understeer, **recoverable**. Blistering = too hot >140 C,
late, **irreversible**. Bahrain surface is abrasive graywacke — a high-deg, graining circuit.

## How it drives (the target feel)
"Lighter, more agile, noticeably narrower", reacts faster to steering. **Not** a knife-edge car:
oversteer is throttle-induced on **exit**, not entry, and is **catchable**. Grip loss concentrates
in **fast** corners. Progressive throttle still required or you spin. Classed "simcade" —
forgiving-but-punishing. Do not aim for Assetto Corsa knife-edge; do not aim for arcade.

## Time Trial rules (the mode we ship)
- damage **off**, tyre wear **off**, tyre temp **off/ideal**, fuel **not modelled**, weather fixed
- **ERS is fixed/automatic for the lap, NOT manually deployable** (explicit design choice)
- car performance **equalised**; setup is **player-chosen and does matter** (not a fixed setup)
- **PB ghost default ON**, rival ghost default OFF; ghost telemetry overlay Off/Brakes-only/**Full**
- ghost is a **replay**, not a simulation — no collision
- **delta is always visible, live and continuous** (not sector-only). **Green = faster, red = slower.**
  The described core loop is literally "nailing their braking point and keeping their delta green".
- track limits: **all four wheels fully beyond the white line = immediate lap deletion.** A sliver of
  tyre on the line is legal. Next lap may also be deleted if the excursion gave a benefit.

## Bahrain International Circuit
**5.412 km, 15 turns**, 57 laps. Abrasive graywacke surface. **3 DRS/Straight-Mode zones**:
Z1 detect 50 m before T1, activate 23 m after T3 (shortest).
Z2 detect 10 m before T9, activate 50 m after T10.
Z3 detect 110 m before T14, activate 250 m after T15 (longest, main straight).
Race lap record **1:31.447 Pedro de la Rosa, McLaren, 2005**. All-time fastest **1:27.264 Hamilton 2020**.

Corner-by-corner (gear / speed / note):
- **T1** R heavy braking, end of a 1.1 km full-throttle run. 8th->2nd. **313-331 -> 66-85 km/h**.
  Brake at the 100-120 m board. Avoid the high kerb, it destabilises the rear. Exit centre.
- **T2** L fast, effectively flat, 4th. **T3** R uphill, really T2's exit kerb, ->6th, throttle pinned.
- **T4** R uphill, wide, bumpy, 4th. End of DRS zone 1. Straddle the entry kerb. Slow-in fast-out.
- **T5** L fast 5th, **T6** R fast 5th->6th, **T7** L fast 6th->7th — the flowing esses.
- **T8** R **tight hairpin**, downhill braking, 2nd, **~70-90 km/h**. Lock-up risk. Short-shift out.
- **T9** R fast kink 7th — sacrifice it, its only job is to set up T10.
- **T10** L **hardest corner on the lap**: long combined entry that tightens then drops at the apex.
  1st/2nd, **~65-80 km/h**. Highest lock-up risk.
- **T11** L medium-fast uphill after a straight, 8th->4th. Trail-brake only from the 50 m board.
- **T12** R fast, historically flat, 7th. **2025 ~260 -> 2026 ~200 km/h** (energy saving).
- **T13** R medium-fast 4th-5th. **T14** L medium, 309 km/h -> 101 m braking at 4.9 g (2025 spec).
- **T15** R final corner — **exit is the most lap-critical point on the circuit**, it feeds the
  1.1 km main straight.

Shape: four genuinely slow corners (T1, T4, T8, T10) demanding traction; one flowing fast sequence
(T5-6-7); one fast corner (T12); three long straights.

## Bahrain at night — lighting facts that change the render
**495 poles, 10 m to 45 m tall. ~4,500 luminaires. ~500 km of cabling. Lit to HD broadcast levels.**
1. Lighting is **multi-source and overhead from wildly varying heights** — a single directional
   light will never read as Bahrain. Expect **multiple overlapping soft, faint shadows per car**,
   not one hard shadow.
2. **The track surface is BRIGHT and evenly lit** — near-daylight, low-shadow, high-CRI.
   Resist making it dark. The signature is *lit track against black desert*, not darkness.
3. **Beyond the barriers is genuinely black** — no ambient bounce. Falls off fast.
4. **Cool white** broadcast luminaires against warmer sodium paddock/grandstand light.
5. Airborne **sand/dust haze** gives the poles visible volumetric cones.

## Input
**In-game steering lock is 360 deg total (+/-180 deg = full lock).**
Pad reference: steering rate 140%, deadzone 0, **linearity 40**, saturation 10; throttle linearity
50; brake linearity 35 (prevents lock-ups). **A raw linear input map feels materially twitchier
than the reference.** Non-linear mapping is not optional.
Haptics, in priority order: (1) rising **slip-proportional** vibration approaching the traction
limit, (2) discrete kerb impulses, (3) sustained off-track texture, (4) speed/load steering damper.

## ACCEPTANCE BANDS (the critic will test these)
| metric | PASS | FAIL |
|---|---|---|
| peak braking decel | 3.0-3.5 g | >4.0 g |
| peak lateral G @250 km/h | 4.0-4.7 g | >5.0 or <3.0 |
| peak lateral G @80 km/h | 1.7-2.1 g | >2.5 g |
| downforce @250 km/h | 1300-1500 kgf | >1800 kgf |
| speed where DF = weight | 175-195 km/h | ~130 km/h |
| top speed | 315-345 km/h | >360 km/h |
| straight speed trace | peaks mid-straight then dips | monotonic rise |
| braking 300->100 km/h | ~100-115 m | <85 m |
| Bahrain qual lap, 2026 spec | 1:30.5-1:32.0 | <1:29 |
| min speed T1 / T10 / T12 | 66-85 / 65-80 / ~200 km/h | |
| peak slip angle | 6-8 deg | >10 deg |
| tyre mu | 1.5-1.8, load-sensitive | fixed mu |
| gearbox | 8 forward, driver-shifted | 7, or auto-only |
| useful rev band | 7,000-12,500 | shifting at 15,000 |
| active aero | 2 modes, Corner default, Straight zone-restricted, all cars | gap-gated |
| track limits | 4 wheels fully past line -> immediate invalidation | 2 wheels / end-of-lap |
| TT wear/temp/fuel/damage | all off | modelled |
| TT delta | live continuous, green/red | sector-only |
| Bahrain | 5.412 km, 15 turns, 3 zones | |
| night lighting | many overhead sources, soft multi-shadow, BRIGHT track, black surrounds | one directional light, dark track |

**NOT gradeable (do not fail a build on these):** Bahrain elevation in metres, exact sector split
locations, which compound TT uses, the game's exact track-limits algorithm, flashback in TT,
ghost shader specifics, keyboard steering ramp values.
