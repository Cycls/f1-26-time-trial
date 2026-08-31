# RENDER / NIGHT LIGHTING — round 1 blind A/B result

**Protocol:** our frame and a real F1-game frame, normalised to identical resolution, format, byte
size and mtime, shuffled by an unbiased coin, judged by a separate agent with fresh context that
never saw the builder's reasoning.

**Critic picked A as better, with high confidence. A was the REFERENCE. Ours lost. FAIL.**

The critic's reasons, before it knew which was which:
1. Contact shadow — reference tyres land in a tight dark patch gradating outward; ours meet an
   unbroken flat plane and the car reads as "pasted on".
2. Light falloff — our ~30 floodlights illuminate nothing: a single smooth vertical gradient, no
   pools, no bright patches under the nearest masts, no scalloping between them.
3. Bloom — ours is ~30 near-identical circular gaussian blobs; no core, no glare spikes, no fixture
   geometry inside the blob.
4. Black point — ours has no true black anywhere: washed charcoal sky, muddy warm brown floor.
   "Night simulated by dimming a grey scene, not by lighting a bright object inside a black one."
5. Material response — the reference separates gloss/carbon/rubber/metal by specular behaviour
   alone; ours is one flat plastic response.
6. Road surface — reference has aggregate, a rubbered-in line, kerb specular; ours is uniform brown.
7. Nothing casts a shadow in ours except the car.

## Root cause (single, dominant)
**Every light-level knob is set to between 5% and 47% of its own documented value.**
- reference clean asphalt **linY 0.168**; ours **linY 0.020** — **8x too dark**
- `pipeline.js` ships `direct 1.27 / rim 0.18 / hemi 0.26`; `lightrig.js` documents `3.10 / 0.62 / 0.55`
- `buildEnvironment(..., lumRadiance: 6.0)` against `skyenv.js`'s own default of **105** (17.5x cut),
  which is why bodywork has no specular

Two counter-intuitive findings worth keeping:
- **Contact-shadow grounding was NOT the thing to fix first.** Our shadow ratio under the tyre is
  3x, *stronger* than the reference's 1.45x — it just occurs between sRGB 22 and 52, about eight
  distinguishable steps, so it is invisible. Raising the light corridor makes it readable for free.
- **The black desert already works** (linY 0.0032). Half the stated look is correct.

## Real bugs the critic found
1. **The composer runs at 1/devicePixelRatio** — `composer.setPixelRatio()` is never called, so on a
   retina display the entire post chain runs at a quarter of the pixel count. Invisible in every
   capture because the harness sets `deviceScaleFactor: 1`.
2. `uTexel` is in device px against a CSS-px buffer, so the sharpen kernel taps sub-texel.
3. `setQuality({motionBlur:true})` is a silent no-op — the pass and its depth attachment never exist.
4. Warm sodium floods the racing surface: road sRGB **(52, 30, 2)**, blue at 2/255. Reference asphalt
   is neutral (R-B = -1.2); ours is R-B = **+49.5**. The documented "cool-white over the circuit,
   warm sodium around the grandstands" is **inverted**.
5. Highlight clipping: ours clips 0.50% of the frame and 1.29% of the sky to 255; reference clips
   **0.00%**.

## Claims the critic falsified
- `pipeline.js` header: "Bahrain at night is a BRIGHT track in a black desert" — half false; the
  desert is right, the track is 8x too dark.
- `lightfield.js`: "cool-white over the circuit against warmer sodium around the grandstands" —
  inverted in the shipped bake.
- `lightfield.js`: "One-time, ~60 ms" — measured **271 ms**.
