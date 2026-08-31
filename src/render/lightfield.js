/**
 * Baked floodlight illuminance field + scene grading. Owner: RENDER.
 *
 * Bahrain is lit by ~4,500 luminaires on 495 poles. We are allowed 8 dynamic lights.
 * The solution: bake the ARRAY into a top-down illuminance texture (metres -> XZ) and
 * modulate every lit material's reflected light by it in the shader. That buys:
 *   - a bright, evenly lit track corridor (the actual Bahrain signature),
 *   - genuinely black desert beyond the barriers with a steep falloff and no bounce,
 *   - gentle pool-to-pool variation under the pole line so the lighting reads
 *     multi-source rather than like one big lamp,
 *   - cool-white broadcast light over the circuit against warmer sodium light around
 *     the grandstands / paddock, carried in a second channel.
 *
 * The same injection also replaces three's fog with an analytic exponential HEIGHT fog
 * whose colour is modulated by the same field: airborne sand glows over the lit corridor
 * and stays black over the desert, which is what actually sells the night look.
 *
 * Costs: one 512^2 RGBA16F texture and ~3 texture fetches per fragment. No new varying:
 * world position is reconstructed from vViewPosition and an inverse-view uniform, so no
 * other module's vertex shader is touched.
 */
import * as THREE from 'three';

const RES = 512;

/* ------------------------------------------------------------------ bake --- */

function boxBlur(src, tmp, res, r) {
  if (r < 1) return;
  const w = 2 * r + 1, inv = 1 / w;
  for (let y = 0; y < res; y++) {
    const row = y * res;
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += src[row + Math.min(res - 1, Math.max(0, x))];
    for (let x = 0; x < res; x++) {
      tmp[row + x] = sum * inv;
      sum += src[row + Math.min(res - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < res; x++) {
    let sum = 0;
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(res - 1, Math.max(0, y)) * res + x];
    for (let y = 0; y < res; y++) {
      src[y * res + x] = sum * inv;
      sum += tmp[Math.min(res - 1, y + r + 1) * res + x] - tmp[Math.max(0, y - r) * res + x];
    }
  }
}

function splat(field, res, px, py, pr, val, add) {
  const x0 = Math.max(0, Math.floor(px - pr)), x1 = Math.min(res - 1, Math.ceil(px + pr));
  const y0 = Math.max(0, Math.floor(py - pr)), y1 = Math.min(res - 1, Math.ceil(py + pr));
  const r2 = pr * pr;
  for (let y = y0; y <= y1; y++) {
    const dy = y - py, dy2 = dy * dy, row = y * res;
    for (let x = x0; x <= x1; x++) {
      const dx = x - px, d2 = dx * dx + dy2;
      if (d2 > r2) continue;
      const w = add ? 1 - d2 / r2 : 1;            // smooth for additive, flat for max
      const i = row + x;
      if (add) field[i] += val * w;
      else if (field[i] < val) field[i] = val;
    }
  }
}

export class LightField {
  constructor() {
    // 1x1 neutral placeholder so materials compile and look sane before the bake.
    const px = new Uint16Array([
      THREE.DataUtils.toHalfFloat(1), THREE.DataUtils.toHalfFloat(0),
      THREE.DataUtils.toHalfFloat(1), THREE.DataUtils.toHalfFloat(1),
    ]);
    const t = new THREE.DataTexture(px, 1, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    t.needsUpdate = true;
    this.texture = t;
    this.rect = new THREE.Vector4(0, 0, 0, 0);  // minX, minZ, 1/size, unused
    this.built = false;
  }

  /** Rasterise the floodlight array from the track centreline. One-time, ~60 ms. */
  build(track) {
    if (this.built || !track?.length) return false;
    const L = track.length;
    const NS = 640;
    const samp = [];
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < NS; i++) {
      const t = track.sampleS(i / NS * L);
      samp.push(t);
      minX = Math.min(minX, t.point.x); maxX = Math.max(maxX, t.point.x);
      minZ = Math.min(minZ, t.point.z); maxZ = Math.max(maxZ, t.point.z);
    }
    const pad = 300;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxZ - minZ) + pad * 2;
    const originX = cx - size / 2, originZ = cz - size / 2;
    const mpp = size / RES, ppm = RES / size;

    const A = new Float32Array(RES * RES);   // broadcast (cool) illuminance
    const W = new Float32Array(RES * RES);   // warmth 0..1
    const tmp = new Float32Array(RES * RES);

    const toPX = (x) => (x - originX) * ppm;
    const toPY = (z) => (z - originZ) * ppm;

    // 1. the lit corridor — a flat plateau over track + run-off, blurred into a falloff
    const stepM = Math.max(2, mpp * 1.2);
    for (let s = 0; s < L; s += stepM) {
      const t = samp[Math.floor(s / L * NS) % NS];
      splat(A, RES, toPX(t.point.x), toPY(t.point.z), (t.halfWidth + 21) * ppm, 1, false);
    }

    // 2. pole line: gentle overlapping pools so the corridor is not perfectly uniform
    for (let s = 0; s < L; s += 44) {
      const t = samp[Math.floor(s / L * NS) % NS];
      const side = ((s / 44) | 0) % 2 ? 1 : -1;
      const p = t.point.clone().addScaledVector(t.right, side * (t.halfWidth + 26));
      splat(A, RES, toPX(p.x), toPY(p.z), 62 * ppm, 0.09, true);
    }

    // 2b. the corridor mask. Everything the cars actually drive on is lit by the
    // BROADCAST array — cool white, colour-corrected for television. Sodium belongs
    // to the grandstands and the paddock behind them. Round 1 inverted exactly that:
    // a 74 m warm splat blurred a further 38 m from a centre only 53 m off the
    // centreline put warmth 0.49 ON the centreline and measured the asphalt at
    // sRGB (52, 30, 2) — R-B +49.5 against a reference that is neutral to -1.2.
    // A radius alone cannot fix it (any blur wide enough to look like light spills
    // back over the track), so the racing surface is masked out explicitly.
    const M = new Float32Array(RES * RES);
    for (let s = 0; s < L; s += stepM) {
      const t = samp[Math.floor(s / L * NS) % NS];
      splat(M, RES, toPX(t.point.x), toPY(t.point.z), (t.halfWidth + 12) * ppm, 1, false);
    }
    boxBlur(M, tmp, RES, Math.max(1, Math.round(10 * ppm)));

    // 3. warm sodium: grandstands down the main straight, paddock behind pit lane
    for (let s = 0; s < L * 0.20; s += 34) {
      const t = samp[Math.floor(s / L * NS) % NS];
      const p = t.point.clone().addScaledVector(t.right, -(t.halfWidth + 46));
      splat(W, RES, toPX(p.x), toPY(p.z), 25 * ppm, 0.62, true);
      splat(A, RES, toPX(p.x), toPY(p.z), 30 * ppm, 0.05, true);
    }
    for (let s = L * 0.44; s < L * 0.52; s += 40) {
      const t = samp[Math.floor(s / L * NS) % NS];
      const p = t.point.clone().addScaledVector(t.right, (t.halfWidth + 52));
      splat(W, RES, toPX(p.x), toPY(p.z), 25 * ppm, 0.50, true);
    }

    // 4. soften. Two blur widths: light pool tight, haze glow wide.
    const rLight = Math.max(2, Math.round(16 * ppm));
    boxBlur(A, tmp, RES, rLight);
    boxBlur(A, tmp, RES, rLight);
    boxBlur(W, tmp, RES, Math.max(2, Math.round(15 * ppm)));
    // ...then subtract the racing surface back out of the warmth. Done AFTER the
    // blur so the blur cannot carry sodium back over the white line.
    for (let i = 0; i < W.length; i++) W[i] *= Math.max(0, 1 - M[i] * 1.35);

    const H = Float32Array.from(A);
    boxBlur(H, tmp, RES, Math.max(4, Math.round(44 * ppm)));

    // 5. normalise so on-track illuminance == 1
    const probes = [];
    for (let i = 0; i < NS; i += 7) {
      const t = samp[i];
      const x = Math.round(toPX(t.point.x)), y = Math.round(toPY(t.point.z));
      if (x > 0 && y > 0 && x < RES && y < RES) probes.push(A[y * RES + x]);
    }
    probes.sort((a, b) => a - b);
    const med = probes[Math.floor(probes.length * 0.5)] ?? 0;
    if (!(med > 0.05)) { console.warn('[render] flood field bake looks wrong (median', med, ') — keeping neutral light'); return false; }
    const norm = 1 / med;
    let hmed = 0;
    { const hp = []; for (let i = 0; i < NS; i += 11) { const t = samp[i]; const x = Math.round(toPX(t.point.x)), y = Math.round(toPY(t.point.z)); if (x > 0 && y > 0 && x < RES && y < RES) hp.push(H[y * RES + x]); } hp.sort((a, b) => a - b); hmed = hp[Math.floor(hp.length * 0.5)] || 1; }
    const hnorm = 1 / Math.max(0.02, hmed);

    // 6. upload
    const data = new Uint16Array(RES * RES * 4);
    const half = THREE.DataUtils.toHalfFloat;
    const one = half(1);
    for (let i = 0; i < RES * RES; i++) {
      data[i * 4] = half(Math.min(1.30, A[i] * norm));
      data[i * 4 + 1] = half(Math.min(1, W[i]));
      data[i * 4 + 2] = half(Math.min(1, H[i] * hnorm));
      data[i * 4 + 3] = one;
    }
    const tex = new THREE.DataTexture(data, RES, RES, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    this.texture.dispose();
    this.texture = tex;
    this.rect.set(originX, originZ, 1 / size, mpp);
    this.built = true;
    return true;
  }
}

/* --------------------------------------------------------------- grading --- */

// World position is reconstructed from vViewPosition rather than carried in a new
// varying: several materials here already sit close to the varying budget (the road
// shader adds four of its own on top of three shadow coords), and adding a vertex-stage
// injection is one more chance to collide with another module's shader edits.
const FRAG_HEAD = /* glsl */`
uniform mat4 uFldInvView;
uniform sampler2D uFldMap;
uniform vec4  uFldRect;    // originX, originZ, 1/size, metresPerPixel
uniform vec4  uFldTune;    // gain, falloffPow, ambientFloor, hazeGain
uniform vec3  uFldCool;
uniform vec3  uFldWarm;
uniform vec4  uHaze;       // density, heightFalloff, baseY, maxOpacity
uniform vec3  uHazeTint;

vec4 f1FldFetch( vec3 wp ) {
  vec2 uv = ( wp.xz - uFldRect.xy ) * uFldRect.z;
  vec2 cl = clamp( uv, 0.0, 1.0 );
  vec4 s = texture2D( uFldMap, cl );
  // outside the baked area there is only desert
  float inside = step( 0.0, 0.5 - max( abs( uv.x - 0.5 ), abs( uv.y - 0.5 ) ) );
  return s * mix( vec4( 0.0, 0.0, 0.0, 1.0 ), vec4( 1.0 ), inside );
}

vec3 f1FldLight( vec4 s ) {
  float i = pow( max( s.r, 0.0 ), uFldTune.y ) * uFldTune.x;
  return mix( uFldCool, uFldWarm, clamp( s.g, 0.0, 1.0 ) ) * i + uFldTune.z;
}

vec3 f1FldWorldPos() {
  return ( uFldInvView * vec4( -vViewPosition, 1.0 ) ).xyz;
}
`;

const FRAG_LIGHT = /* glsl */`
  {
    vec3 fldM = f1FldLight( f1FldFetch( f1FldWorldPos() ) );
    reflectedLight.directDiffuse   *= fldM;
    reflectedLight.indirectDiffuse *= fldM;
    reflectedLight.directSpecular  *= fldM;
    reflectedLight.indirectSpecular *= fldM;
  }
`;

const FRAG_FOG = /* glsl */`
#ifdef USE_FOG
  {
    vec3 fwp = f1FldWorldPos();
    vec3 camWP = cameraPosition;
    float dist = length( fwp - camWP );
    float k = uHaze.y;
    float y0 = camWP.y - uHaze.z;
    float y1 = fwp.y - uHaze.z;
    float dy = y1 - y0;
    float tI = ( abs( dy ) < 0.05 )
      ? exp( -k * y0 )
      : ( exp( -k * y0 ) - exp( -k * y1 ) ) / ( k * dy );
    tI = clamp( tI, 0.0, 2.0 );
    float f = clamp( 1.0 - exp( -uHaze.x * dist * tI ), 0.0, uHaze.w );
    // Haze is only visible where there is light to scatter: over the lit corridor it
    // glows, over the desert it stays black. That is what keeps the surroundings dark
    // instead of turning the whole distance into pale soup.
    vec4 sm = f1FldFetch( mix( camWP, fwp, 0.55 ) );
    float glow = clamp( sm.b, 0.0, 1.0 ) * uFldTune.w;
    vec3 fogCol = uHazeTint * glow * mix( vec3( 1.0 ), uFldWarm, clamp( sm.g * 0.7, 0.0, 1.0 ) );
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogCol, f * ( 0.22 + 0.78 * glow ) );
  }
#endif
`;

/**
 * Injects the field lookup into every lit material in the scene. Non-destructive:
 * nothing another module authored is replaced, only its reflected light is modulated.
 */
export class SceneGrade {
  constructor(field) {
    this.field = field;
    this.uniforms = {
      uFldInvView: { value: new THREE.Matrix4() },
      uFldMap: { value: field.texture },
      uFldRect: { value: field.rect },
      // gain, falloffPow, ambientFloor, hazeGain.
      //   gain         scales the LIT CORRIDOR only — the desert sits on
      //                ambientFloor, which is added after this multiply, so this is
      //                the one knob that brightens the track without touching the
      //                black surround, and it does not brighten the lamps either
      //                (emissive is not part of reflectedLight). Exposure would
      //                raise all three together and is the wrong tool here.
      //   ambientFloor halved against round 1 because the rig behind it more than
      //                doubled: this is a fraction of a now-larger irradiance, and
      //                the desert has to stay at linY ~0.003.
      uFldTune: { value: new THREE.Vector4(2.00, 1.5, 0.0045, 1.0) },
      // Broadcast metal-halide, colour-corrected for television — genuinely cool,
      // and cooler than round 1 because the asphalt tile itself carries a warm cast
      // that nothing on this side of the module owns (see docs/REQUESTS.md).
      uFldCool: { value: new THREE.Color(0.845, 0.955, 1.135) },
      uFldWarm: { value: new THREE.Color(1.45, 0.90, 0.50) },
      // density, height falloff (1/m), base height, max opacity.
      // Haze is scattered corridor light, so it must sit INSIDE the corridor's own
      // brightness, never above it. Round 1 had it saturating to a pale curtain by
      // 400 m while the road under the wheels was 13-25x darker — the distance was
      // the brightest thing in frame. Lower density and a lower ceiling keep the
      // falloff gradual and let the road stay the brightest surface.
      uHaze: { value: new THREE.Vector4(0.00105, 0.028, 0.0, 0.44) },
      uHazeTint: { value: new THREE.Color(0.050, 0.047, 0.043) },
    };
    this.patched = new WeakSet();
    this.count = 0;
    // A throw inside onBeforeCompile happens mid-render and takes the WHOLE frame
    // down (three has no recovery path), so this is belt-and-braces.
    this._onBeforeCompile = (shader) => { try { this._inject(shader); } catch (e) { console.error('[render] light-field injection failed', e); } };
    this._inject = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      // fragment stage only — world position comes from vViewPosition, so the vertex
      // shader is left exactly as its owner wrote it
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + FRAG_LIGHT)
        .replace('#include <fog_fragment>', FRAG_FOG);
    };
    this._cacheKey = () => 'f1-lightfield';
  }

  setTexture(tex) { this.uniforms.uFldMap.value = tex; this.uniforms.uFldRect.value = this.field.rect; }

  patch(mat) {
    if (!mat || this.patched.has(mat)) return false;
    const lit = mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial
      || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial;
    if (!lit || mat.userData?.noLightField) { this.patched.add(mat); return false; }
    this.patched.add(mat);

    // Never clobber another module's shader injection. Two cases:
    //  - the material exposes onBeforeCompile as a COMPOSING accessor (track/roadMaterial
    //    does): plain assignment is already safe, it keeps both.
    //  - it is a plain property: chain the previous function ahead of ours by hand.
    const DEF_C = THREE.Material.prototype.onBeforeCompile;
    const DEF_K = THREE.Material.prototype.customProgramCacheKey;
    const prevC = mat.onBeforeCompile, prevK = mat.customProgramCacheKey;

    mat.onBeforeCompile = this._onBeforeCompile;
    if (mat.onBeforeCompile === this._onBeforeCompile && prevC && prevC !== DEF_C) {
      mat.onBeforeCompile = (sh, rn) => { prevC.call(mat, sh, rn); this._onBeforeCompile(sh, rn); };
    }
    mat.customProgramCacheKey = this._cacheKey;
    if (mat.customProgramCacheKey === this._cacheKey && prevK && prevK !== DEF_K) {
      mat.customProgramCacheKey = () => 'f1-lightfield|' + prevK.call(mat);
    }
    mat.needsUpdate = true;
    this.count++;
    return true;
  }

  /** Walk the scene and patch anything new. Cheap; safe to call every N frames. */
  scan(scene) {
    let n = 0;
    scene.traverse((o) => {
      const m = o.material; if (!m) return;
      if (Array.isArray(m)) { for (const mm of m) if (this.patch(mm)) n++; }
      else if (this.patch(m)) n++;
    });
    return n;
  }
}
