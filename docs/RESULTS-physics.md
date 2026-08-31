# PHYSICS — measured vs reference acceptance bands
Measured by `tools/probe_physics.mjs` (not self-reported by the builder).

| metric | measured | reference band | verdict |
|---|---|---|---|
| mass / wheelbase / width | 768 kg / 3400 mm / 1900 mm | 768 / 3400 / 1900 | **PASS** |
| gearbox | 8 forward | 8 forward | **PASS** |
| peak braking decel | **3.36 g** | 3.0-3.5 g | **PASS** |
| downforce @ 250 km/h | **866 kgf** | 1300-1500 kgf | **FAIL** - 40% short |
| speed where downforce = car weight | **~215 km/h** | 175-195 km/h | **FAIL** - aero too weak |
| peak lateral G @ 80 km/h | **4.28 g** | 1.7-2.1 g | **FAIL** - ~2.2x too grippy |
| peak lateral G @ 150 km/h | **5.73 g** | ~2.65 g | **FAIL** |
| peak lateral G @ 250 km/h | **6.16 g** | 4.0-4.7 g | **FAIL** |
| braking 300 -> 100 km/h | **162 m** | ~100-115 m | **FAIL** - 45% too long |
| top speed | **280 km/h** | 315-345 km/h | **FAIL** - too slow |

## Diagnosis
The lateral-G figures are nearly FLAT across speed (4.28 -> 5.73 -> 6.16 while the reference
demands 1.9 -> 2.65 -> 4.5). That signature means **grip is dominated by a near-constant tyre mu
and barely by aero** — exactly the failure `docs/reference-physics.md` warns about:
"Speed-independent grip = no aero model" and "Load sensitivity is non-optional".

Two concrete causes to fix, in order of value:
1. **Tyre mu is far too high at low load** and lacks load sensitivity. The reference model is
   `mu(Fz) ~= 1.8 - 5e-5 * Fz`. At 80 km/h the car carries ~900 kgf total load and should manage
   only ~1.9 g; ours does 4.28 g.
2. **Aero is ~40% too weak.** Downforce must reach 1300-1500 kgf at 250 km/h and equal car weight
   at 175-195 km/h. Raising ClA fixes the high-speed end and, with (1), restores the correct
   *shape* of the grip-vs-speed curve.

Braking distance is long *despite* a correct 3.36 g peak, which means peak decel is reached only
briefly — the brake torque ramp or the front/rear distribution is not holding the car at the limit.

Top speed of 280 km/h with the deployment taper implemented suggests drag is too high for the
power available once downforce is corrected; retune CdA in Straight Line Mode after fixing (2).

**Not verified:** a full-lap Bahrain time (the probe's full-throttle run leaves the circuit before
completing a lap, so the 1:30.5-1:32.0 target is untested).

---

# ROUND 2 — after the rebuild (final measurement)

| metric | round 1 | **round 2** | band | verdict |
|---|---|---|---|---|
| downforce @ 250 km/h | 866 kgf | **1374 kgf** | 1300-1500 | **PASS** |
| peak lateral G @ 80 km/h | 4.28 g | **2.06 g** | 1.7-2.1 | **PASS** |
| peak lateral G @ 250 km/h | 6.16 g | **4.48 g** | 4.0-4.7 | **PASS** |
| braking 300 -> 100 km/h | 162 m | **104 m** | 100-115 m | **PASS** |
| peak braking decel | 3.36 g | **3.33 g** | 3.0-3.5 g | **PASS** |
| top speed | 280 km/h | **313 km/h** | 315-345 | **FAIL** by 2 km/h |

**5 of 6 bands pass.** The grip-vs-speed curve now has the right *shape* — 2.06 g at 80 km/h rising
to 4.48 g at 250 km/h, against the reference's 1.9 -> 4.5 — where round 1 was nearly flat and roughly
twice too grippy everywhere. Load-sensitive tyre mu plus the corrected aero scale did it.

**Still behind:** top speed 313 km/h against a 315-345 km/h band — 2 km/h short, i.e. drag is
marginally too high in Straight Line Mode. Also still unverified: a full Bahrain lap time against the
1:30.5-1:32.0 target (the probe's full-throttle run leaves the circuit before completing a lap, so
this needs a proper AI driver or a scripted racing line to measure).
