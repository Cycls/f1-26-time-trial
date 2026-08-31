# REFERENCE — HUD, measured from real screenshots
Positions are **normalised 0-1 of a 16:9 frame**. Hex values were pixel-sampled from 1080p/1440p
in-game frames. This is measurement, not guesswork — match it.

## Element map (defaults; nearly everything is user-movable in the real game)
| Element | Anchor | x | y |
|---|---|---|---|
| Timing tower (F1 logo + session name header, 5 driver rows centred on player) | top-left | 0.020-0.185 | 0.040-0.324 |
| Lap counter ("LAP 17 / 18") | in tower header | - | ~0.09 |
| Penalty pills ("3s","10s") | right of tower rows | 0.19-0.315 | per row |
| Race-control banner ("WARNING - COLLISION WITH...") | top-centre | 0.30-0.70 | 0.044-0.115 |
| Virtual rear-view mirror (rounded-pill letterbox) | top-centre | 0.34-0.65 | 0.138-0.235 |
| **Timing panel (sectors/times/delta)** | **top-RIGHT** | 0.772-0.968 | 0.040-0.142 race, ->0.34 in TT/quali |
| Session timer (red pill + stopwatch glyph) | below timing panel | 0.865-0.93 | 0.23-0.27 |
| **Track map "Track Position"** | **left edge, LOWER** | 0.020-0.230 | 0.658-0.933 |
| Proximity arrows | flanking car | 0.18-0.24 | 0.42-0.54 |
| **F1 Dial (speed/gear/rev/battery cluster)** | **bottom-CENTRE** | 0.40-0.60 | 0.818-0.978 |
| Car status / tyre widget = collapsed MFD | bottom-right | 0.777-0.968 | 0.645-0.956 |
| Radio subtitles (GREEN text on dark box) | bottom-centre | 0.30-0.70 | 0.89-0.98 |

NOTE our layout guess was wrong in two places: **the timing panel is TOP-RIGHT, not top-left**, and
**the speed/gear cluster is BOTTOM-CENTRE, not bottom-right**. The track map is LOWER-LEFT.

## Timing panel — exact construction
Rounded rect, dark navy **#1C2739 at ~85% opacity**, ~2px light stroke, ~12px corner radius @1080p.
Rows top->bottom:
1. **Three sector pills `S1 S2 S3`**, each a **left-to-right gradient**:
   | state | left | right |
   |---|---|---|
   | purple (session best) | `#6E3986` | `#A425BD` |
   | green (personal best) | `#2E7B34` | `#06BC06` |
   | yellow (slower than PB) | `#8C7D30` | `#EAC205` |
   | no time set | `#474A51` | flat |
2. **Position + running lap time** — `1 / 19` left (position bold white, `/N` smaller grey), lap time
   right, large white.
3. **Thin full-width accent bar** under row 2, horizontal gradient (amber `#E08A20`-ish or teal).
4. **BEST** — label left, time right, light grey.
5. **PREVIOUS** — same styling (present in TT/practice/quali, absent in race).
6. **DELTA** — full-width coloured bar with **45-degree diagonal stripe hatching**, stopwatch outline
   glyph + `DELTA` label left, signed value right in large bold white.
   - slower: red **#E31419** (sampled #F5130D / #B81E21)
   - at/faster: green **#21A02B** (sampled #209327)

## Rev light strip — measured
**15 discrete circular LEDs**, spanning x 0.464-0.536 (**7.3% of screen width**), directly above the
gear numeral inside the dial's centre panel. Zones filling left->right:
**LEDs 1-5 green, 6-10 red, 11-15 magenta/purple.** No blue stage.
Near the shift point the green block goes DARK while red+purple stay lit — the strip re-ranges or
flashes at the shift point rather than simply filling monotonically.
The 3D steering wheel in cockpit view carries its own working LED bar plus a small live LCD.

## The F1 Dial (bottom-centre). 2026 cars use a separate "26 F1 Dial" element.
**A. Battery gauge (left circle)** — outer arc = charge, bright lime **#8CE63C**. Inner yellow arc =
total battery remaining; red arc on the left = regeneration. Label `BATT` + big percentage.
**Numeral colour is stateful: yellow charging/neutral, orange deploying, and the disc fills SOLID
yellow with BLACK numerals when Overtake/Boost is engaged.** Small tyre-compound badge lower-left of
the ring (red S / yellow M / white H / green I / blue W).
**B. Centre panel** — rev LED strip on top; a **status glyph column left of the gear** (double-arrow
aero glyph, fuel pump, crossed X) which is where the **Active Aero mode indicator** lives; large
white gear numeral (greys off-throttle) with small up/down shift chevrons; and an **energy state
label beneath the gear**, all-caps, observed vocabulary: `HARVESTING` (yellow),
`REDUCED HARVESTING` (orange), `DEPLOYING` (orange), `OVERTAKE / BOOST` (lime).
Twin horizontal lime energy bars below the panel.
**C. Speed/rev gauge (right circle)** — thin grey rev arc, `KPH` label + speed numerals, `RPM` label +
rpm numerals in grey.
**D. Prompt line** — keycap badge + action, e.g. `LB OVERTAKE`, flipping to `LB DISABLE` when active.
**Overtake Mode turns the HUD blue** on top of all this.

## MFD (bottom-right, same footprint as the collapsed widget — it does NOT overlay centre screen)
Collapsed page = top-down car schematic (front wing, tyres, brake ducts, sidepods, floor, rear wing
as discrete coloured shapes) with **four percentage rings at the corners joined by dotted leader
lines**; left rings fill anticlockwise, right rings clockwise.
**The ring number is tyre WEAR counting UP from 0%** (verified: fresh set reads 7/4/12/10; a
rear-limited lap-17 car reads 57/52/100/96).
Wear ramp: green ~#3ADB3A (0-20%) -> yellow #F0D000 (45-60%) -> orange #FF7A1A (~80%) -> deep red
(95-100%). Body panels green = undamaged, shifting orange/red with damage.
Expanded page = four rows, `icon + label` left, `< >` chevrons + value right, selected row is a
**solid white pill with dark text** and adjacent rows fade:
Fuel Mix (`[1] Lean` / `[2] Standard` / `[3] Rich`) with live fuel margin (`+2.39 Laps` in green) ·
Front Brake Bias (`58%`) · Differential (`45%`) · ERS Deploy (`None`/`Auto`/`Overtake`).
~4 pages implied by a 4-tick indicator; an alerting page tick renders red.

## Typography
Two registers, **no italics anywhere**:
1. **Panel/brand** — squarish low-contrast grotesque, flat terminals, large x-height, squared
   counters, angular flag on `1`, flat-topped `5`/`7`, geometric `S`. Lining tabular numerals.
   All-caps for labels and driver surnames; mixed case for MFD row labels (`Fuel Mix`).
   Visually matches **Formula1 Display** (the official F1 brand family) — not documented, but that
   is the target look.
2. **Instrument** — the dial's gear/speed/RPM numerals use a squarer, more "digital" cut with
   heavier stems.

## Customisation the real game has
`Settings -> On-Screen Display`. Per element: **Opacity**, **Size** (down to ~50%), Default Settings,
and drag-to-position on a preview of the frame. Layouts are **per camera** and do not carry between
session types. Racing line has opacity, 2D/3D, and **protanopia/deuteranopia/tritanopia** variants.
The whole HUD can be disabled.
**Known reference weaknesses we can beat:** the 2026 battery/ERS widget cannot be resized or
repositioned, elements do not snap or group, and **super-clipping has no HUD indicator at all**.

## 2026 specifics
Trackside marker boards read **`SM`** (Straight-line Mode), plain white boards with black text.
Active Aero on the old DRS button; Overtake on L1/LB. ERS modes None/Medium/Hotlap/Overtake.
Tyre legend strings: `SOFT`/`MEDIUM`/`HARD`/`INTERMEDIATE`/`FULL WET` with single-letter circular
badges S/M/H/I/W in red/yellow/white/green/blue. (In 2026 the compounds are C1-C5 — no C6.)
