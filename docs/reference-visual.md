# REFERENCE — rendering, art direction, cameras, VFX, HUD
Source: F1 25 (EGO Engine, DX12) + 2026 Season Pack. Grading source of truth for anything visual.

## THE RESTRAINT RULES (F1 is not a UE showcase — these are the easiest ways to look WRONG)
1. **NO chromatic aberration in gameplay.** EA removed it by design; it exists only as a Photo Mode
   filter. Adding CA makes us LESS accurate, not more. Remove it.
2. **Depth of field is a replay / Photo Mode effect, not a gameplay one.** Do not DOF the driving view.
3. **Motion blur is present but MILD, on a slider, and fully disableable.** Per-object blur is visible
   on the wheels; camera blur is gentle at default. Do not smear the frame.
4. **Film grain is a Photo Mode filter only.**
5. Sharpening is a real 0-100% slider. TAA/DLAA are the AA baseline.

## Lighting
Three tiers: raster (SSR + CACAO AO + baked/probe GI) -> ray tracing (RT shadows, RT reflections,
RT transparent reflections, RTAO, **RT DDGI**) -> **path tracing** ("Ultra Max", PC only).
- Path tracing casts rays from every pixel and bounces **3-4 times**. Sampling is **ReSTIR + ReGIR**
  with hierarchical light structures to avoid "light soup". Denoise via NVIDIA NRD / DLSS Ray
  Reconstruction.
- **A night race contains over 325,000 dynamic light sources.** This is THE number for Bahrain night.
  We cannot have 8 real lights and match it by brute force — it must be faked convincingly
  (IBL + emissive + analytic falloff).
- Tonemapping and "light balancing" were reworked for a more dramatic effect across all weather,
  with better cloud-coverage representation. Auto-exposure is part of the "Post Process" setting.
  **HDR10+ certified.**
- **The specific tell that separates good from bad night lighting:** contact-shadow **gradation**
  where the tyre meets the road. RT-only shadows "get too dark and lose the detail that gives an
  authentic sense of weight and contact" — cars "appear unnaturally detached from the track, almost
  like they're floating." Path tracing gives "realistic gradation where the car meets the road."
  **If our car looks pasted onto the track, we fail on exactly the axis the reference is judged on.**
- **Bloom on night lighting is confirmed present** (a patch fixed it disappearing during camera moves).
- Real-world anchors: FIA mandates **>=3,000 lux** over the whole surface. Bahrain: 495 poles
  (10-45 m), ~4,500 luminaires. The venue — track, run-off, pit lane, grandstands, marshal posts —
  is lit to near-daylight; drivers need no headlights.

## Cameras — corrections to what we assumed
- **There is NO helmet camera in F1 25.** The eight views are: **TV Pod** (default), **TV Pod Offset**,
  **Near Chase**, **Far Chase**, **Cockpit**, **Nose Offset**, **Nose**, **Wing**.
- **There is NO horizon-lock setting**, and no evidence the cockpit camera levels to the horizon.
- **"Look to Apex Limit" YAWS the camera toward the corner — it does not roll it.** Range 0-15,
  default 4.
- **Camera Shake and Camera Movement both ship at MAXIMUM** (-20..20 scale, default 20). Stock shake
  is five separately-triggered procedural effects layered on real suspension/bump motion:
  speed-based, wheel-slip, wheel-lockup, wheel-spin, and **surface-based** (kerbs/bumps).
  Competitive players turn them to 0 — but stock is at the top of the scale.
- **No speed-based FOV widening exists in F1 25.** FOV is a per-camera -20..+20 offset scale, not
  degrees, default 0. If we widen FOV with speed we are adding something the reference does not have —
  keep it very subtle or not at all.
- The **halo column can be hidden** in cockpit view (a shipped concession that pure realism loses).
  The halo is fully lit and shadow-casting, and carries livery decals.
- **Steering wheel animation can be disabled**; the wheel's display is a live render, not a texture.
- Driver **hands are rendered** and bounce light into the cockpit under path tracing.

## VFX — what the reference actually has, and where it is WEAK
- `Particles` setting covers "smoke, sparks, embers, smog". `Skidmarks` + `Skidmark Blending` are
  separate settings: **persistent rubber laydown is a real system**.
- **Tyre smoke**: patched to be *less* thick and to fade *faster* than at launch. Launch complaint was
  that it triggered far too often vs real life, where you only see it after a big lock-up.
- **Track surface shader** has "more pronounced tyre and lock-up marks".
- **Off-track pickup on the tyres is confirmed and was improved twice** — grass/gravel visibly builds
  up on the tyres and costs grip until it wears off.
- **WEAK SPOTS WE CAN BEAT** (the reference is genuinely poor here):
  * **rain spray is described by players as "completely non-existent"** and far too sparse to obscure
  * texture **pop-in** and "occasionally bland textures" (EGO showing its age)
  * weather applies as a **blanket over 2-3 laps, uniform track-wide**
  * **no HUD indicator for super-clipping**
  * the 2026 battery/ERS widget **cannot be resized or repositioned**
  * airborne **dust/gravel plumes** are undocumented — only tyre pickup is confirmed
- **Undocumented in the reference — treat as an open gap, not a known strength:** spark behaviour
  (colour/quantity/trigger), brake-disc glow, brake dust, heat haze intensity, marbles. Sparks are
  declared in the Particles setting but players report bottoming-out sparks **not appearing** in F1 25
  races. **So a good spark implementation is a chance to BEAT the reference outright.**
- Transparents/VFX sit **outside** the path-traced loop — particles are lit by the legacy path even in
  PT mode. Crowds are not in the RT BVH at all.

## HUD
Elements: speed, gear, **rev-light strip + RPM bar**, **ERS % with coloured gauge**, live delta, last
lap, position, driver ahead/behind, session time/name, team, ERS mode, differential, brake bias,
**active-aero mode indicator (2026)**, pit limiter, flags, tyre temps.
- **Overtake Mode turns the HUD blue.**
- MFD tyre page shows **three numbers per wheel**: core temp (top), surface temp (middle), **brake
  temp (bottom)**, with window colour indicators.
- Every element is individually toggleable; the HUD can be disabled entirely. Racing line has
  adjustable opacity, 2D/3D modes, and **protanopia/deuteranopia/tritanopia** variants.

## Track & environment
- **Five LiDAR circuits: Bahrain, Miami, Melbourne, Suzuka, Imola** — scanned during live GP weekends,
  so barriers/kerbs/furniture match that weekend. **Bahrain is one of them, so the reference's Bahrain
  is survey-accurate and ours is being compared against that.**
- Vegetation is the standout upgrade: species-correct trees, denser and bushier.
- Reference weaknesses: pop-in, bland textures, stutters at Spa.
- **Undocumented (do not assume the reference nails these):** crowd rendering technique, barrier
  typology (TecPro vs Armco vs tyre wall), kerb typology.

## Car surfaces
Compound colours: soft **red**, medium **yellow**, hard **white**, inter **green**, wet **blue**.
Patch work shipped: improved off-track dirt build-up on tyres, improved tyre shadows, improved car
bodywork reflections. Halo sponsor decals are symmetrical.
**Undocumented:** paint flake/clearcoat, carbon weave, brake glow, wishbone/halo shading specifics.
**Caveat we can exploit:** EA admits some 2026 teams are the **generic My Team chassis with a livery
skin**, not a true-to-life model, and Ferrari/Red Bull's real rear wings are missing.
