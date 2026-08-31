/**
 * Render quality switches. Owner: RENDER.
 * Everything the pipeline can turn off lives here. CONFIG.quality wins over these
 * defaults, so CORE can add any of these keys and they take effect immediately;
 * until then the defaults apply. Also reachable at runtime:
 *   __F1.modules.get('render').setQuality({ motionBlur:false, grain:0 })
 */
import { CONFIG } from '../core/config.js';

export const QUALITY_DEFAULTS = {
  shadows: true,
  // per key light; we run three of them. 2048 over the +/-36 m frustum in
  // lightrig.js is 3.5 cm/texel, which is what lets a barrier shadow keep an edge
  // instead of dissolving into the normalBias.
  shadowMapSize: 2048,
  post: true,
  msaa: 0,                 // scene MSAA off: AA is done by SMAA after the tonemap
  smaa: true,
  anisotropy: 8,

  ibl: true,               // PMREM floodlight environment
  lightField: true,        // baked floodlight illuminance map + black desert falloff
  fog: true,               // exponential height haze (sand)
  volumetrics: true,       // light cones + luminaire halos
  contactShadow: true,

  bloom: true,
  ao: true,                // GTAO — see reference-visual.md: grounding the car beats any post FX
  // Off by default (the reference makes it a slider that ships mild and is fully
  // disableable), but it is now a LIVE switch: the pass and its depth attachment are
  // always built, so setQuality({ motionBlur: true }) actually turns it on.
  motionBlur: false,
  motionBlurAmount: 0.55,  // 0..1 "slider"; the reference ships MILD blur, do not smear

  // The reference deliberately has NO chromatic aberration and NO film grain in
  // gameplay (both are Photo Mode filters only) — see docs/reference-visual.md.
  // The uniforms stay so a photo mode could dial them up; gameplay defaults are 0.
  chromatic: 0.0,
  grain: 0.0,

  exposure: 2.30,
  contrast: 1.06,
  saturation: 1.10,
  sharpen: 0.38,           // real 0-100% slider in the reference
  vignette: 0.22,
};

export function resolveQuality(overrides = {}) {
  return { ...QUALITY_DEFAULTS, ...(CONFIG.quality || {}), ...overrides };
}
