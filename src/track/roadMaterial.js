/**
 * Road surface material. Owner: TRACK.
 *
 * A MeshStandardMaterial (so it keeps three's lighting, shadows and tone mapping)
 * with an injected fragment stage that paints, in arc-length space:
 *   - two decorrelated samples of the graywacke asphalt tile, killing the repeat
 *   - paving-pass longitudinal seams and rectangular repair patches
 *   - the rubbered-in racing line (darker, smoother) with a dusty, lighter,
 *     marble-strewn band off-line
 *   - white track-limit lines whose OUTER edge is exactly at halfWidth, because
 *     the 2026 rule is "all four wheels fully beyond the white line"
 *   - start/finish line, 20 staggered grid boxes, sector lines,
 *     Straight-Line-Mode detection (dashed) and activation (solid) lines,
 *     pit entry / pit exit blend lines
 *
 * Geometry must supply the attributes aS (lap distance, m), aLat (lateral, m),
 * aHW (half width, m) and aLine (racing-line lateral, m), plus a uv in
 * (lat, s) / ASPHALT_TILE metres.
 */
import * as THREE from 'three';

const COMMON_GLSL = /* glsl */`
varying float vS;
varying float vLat;
varying float vHW;
varying float vLine;
`;

const FRAG_HEAD = /* glsl */`
uniform float uLapLength;
uniform float uSector0;
uniform float uSector1;
uniform vec3  uSlmDetect;
uniform vec3  uSlmStart;
uniform float uGridPitch;
uniform float uGridOffset;
uniform float uGridCount;
uniform float uPitSide;
uniform float uPitEntry;
uniform float uPitExit;
uniform float uDetailNorm;

float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }

float sWrap(float a, float b){
  float h = uLapLength * 0.5;
  return abs(mod(a - b + h, uLapLength) - h);
}
// solid transverse band of half-width w centred on lap distance s0
float xline(float s0, float w, float aa){
  return 1.0 - smoothstep(w - aa, w + aa, sWrap(vS, s0));
}
`;

/**
 * @param {object} tex      { map, normalMap, roughnessMap, metres } from asphaltSet()
 * @param {object} data     BAHRAIN track data
 * @param {object} opts     { runoff: bool }
 */
export function makeRoadMaterial(tex, data, opts = {}) {
  const runoff = !!opts.runoff;
  const mat = new THREE.MeshStandardMaterial({
    map: tex.map,
    normalMap: tex.normalMap,
    roughnessMap: tex.roughnessMap,
    // The albedo lives in the generated tile (mean ~0.17 linear, which is what a
    // graywacke race surface actually measures). The reference is emphatic that
    // Bahrain at night reads as a BRIGHT track against black desert, so this tint
    // stays at 1.0 rather than the usual "dark grey road" multiplier.
    color: 0xffffff,
    roughness: 1.0,
    metalness: 0.0,
    normalScale: new THREE.Vector2(runoff ? 0.75 : 1.0, runoff ? 0.75 : 1.0),
    dithering: true,
  });

  const z = data.slmZones;
  mat.userData.uniforms = {
    uLapLength: { value: data.length },
    uSector0: { value: data.sectors[0] },
    uSector1: { value: data.sectors[1] },
    uSlmDetect: { value: new THREE.Vector3(z[0].detect, z[1].detect, z[2].detect) },
    uSlmStart: { value: new THREE.Vector3(z[0].start, z[1].start, z[2].start) },
    uGridPitch: { value: data.grid.pitch },
    uGridOffset: { value: data.grid.offset },
    uGridCount: { value: data.grid.slots },
    uPitSide: { value: data.pit.side },
    uPitEntry: { value: data.pit.entry },
    uPitExit: { value: data.pit.exit },
    uDetailNorm: { value: 1 / Math.max(0.01, tex.mean ?? 0.17) },
  };

  const inject = (shader) => {
    Object.assign(shader.uniforms, mat.userData.uniforms);

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aS;
        attribute float aLat;
        attribute float aHW;
        attribute float aLine;
        ${COMMON_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vS = aS; vLat = aLat; vHW = aHW; vLine = aLine;`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${COMMON_GLSL}
        ${FRAG_HEAD}`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        ${runoff ? RUNOFF_BODY : ROAD_BODY}`);
  };
  const tag = runoff ? 'f1road-runoff' : 'f1road';

  // RENDER's SceneGrade walks the scene and ASSIGNS onBeforeCompile /
  // customProgramCacheKey on every lit material to splice in its floodlight field.
  // A plain assignment here would be silently overwritten (and, worse, the shared
  // cache key would make three hand our geometry somebody else's compiled program).
  // So expose both as accessors that compose instead of replace: whatever another
  // module assigns is kept and run after ours, and its cache key is concatenated
  // with our own so the program stays distinct.
  let extCompile = null, extKey = null;
  const composedCompile = (shader, renderer) => { inject(shader); extCompile?.(shader, renderer); };
  const composedKey = () => tag + '|' + (extKey ? extKey() : '');
  Object.defineProperty(mat, 'onBeforeCompile', {
    configurable: true,
    get: () => composedCompile,
    set: (fn) => { extCompile = (fn === composedCompile) ? extCompile : fn; },
  });
  Object.defineProperty(mat, 'customProgramCacheKey', {
    configurable: true,
    get: () => composedKey,
    set: (fn) => { extKey = (fn === composedKey) ? extKey : fn; },
  });
  return mat;
}

/* --------------------------------------------------------------- shared */

const SURFACE_DETAIL = /* glsl */`
  // --- decorrelate the 2 m asphalt tile with a second, non-commensurate sample
  vec3 detail2 = texture2D( map, vMapUv * 0.2740 + vec2(0.37, 0.11) ).rgb * uDetailNorm;
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * detail2, 0.42 );

  float aa    = fwidth(vLat) + 0.0025;
  float aaS   = fwidth(vS)   + 0.0025;
  float aHalf = abs(vLat);

  // --- paving passes: ~4.6 m wide laying lanes leave longitudinal cold joints
  float lane   = vLat / 4.6 + 0.5;
  float seamD  = abs(fract(lane) - 0.5) * 4.6;
  float seam   = 1.0 - smoothstep(0.012, 0.012 + aa * 2.0, seamD);
  float laneId = floor(lane);
  float laneTone = (h21(vec2(laneId, 3.1)) - 0.5) * 0.085;

  // --- resurfacing patches and small repairs, in cells 6 m x 34 m
  vec2 rc   = vec2(floor(vLat / 6.0), floor(vS / 34.0));
  float rp  = h21(rc + 3.7);
  float isRepair = smoothstep(0.905, 0.930, rp);
  vec2 rf   = vec2(fract(vLat / 6.0), fract(vS / 34.0));
  float rbx = min(rf.x, 1.0 - rf.x) * 6.0;
  float rby = min(rf.y, 1.0 - rf.y) * 34.0;
  float rBorder = 1.0 - smoothstep(0.03, 0.03 + aa * 2.0, min(rbx, rby));

  // --- broad tonal drift so no two stretches of tarmac look identical
  float drift = (h21(vec2(floor(vS / 96.0), floor(vLat / 13.0) + 11.0)) - 0.5) * 0.11;

  diffuseColor.rgb *= (1.0 + laneTone + drift + isRepair * 0.10);
  diffuseColor.rgb *= mix(1.0, 0.68, seam * 0.85);
  diffuseColor.rgb *= mix(1.0, 0.74, isRepair * rBorder);
  roughnessFactor  = mix(roughnessFactor, 0.99, max(seam * 0.6, isRepair * rBorder * 0.6));
`;

/* ----------------------------------------------------------- the track */

const ROAD_BODY = /* glsl */`
  ${SURFACE_DETAIL}

  // --- rubbered-in racing line. Darker and polished on the line, dusty off it.
  float dl   = abs(vLat - vLine);
  float core = 1.0 - smoothstep(0.95, 2.60, dl);
  float halo = 1.0 - smoothstep(2.20, 5.60, dl);
  float rubber = clamp(core * 0.80 + halo * 0.34, 0.0, 1.0);
  // two dry lines either side of the apex line where cars run wide on entry/exit
  rubber = max(rubber, (1.0 - smoothstep(0.6, 2.2, abs(dl - 3.4))) * 0.22);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.47, 0.465, 0.50), rubber);
  roughnessFactor  = mix(roughnessFactor, 0.58, rubber * 0.85);

  // --- off-line: dust blown in off the desert, plus rubber marbles
  float dusty = smoothstep(2.8, 7.0, dl);
  float marble = h21(floor(vec2(vLat, vS) * 5.5));
  marble = smoothstep(0.86, 1.0, marble) * dusty;
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.30, 1.25, 1.13), dusty * 0.72);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.53, 0.55), marble * 0.55);
  roughnessFactor  = mix(roughnessFactor, 0.99, dusty * 0.55);

  // ================= paint =================
  float paint = 0.0;

  // track-limit line: 12 cm of paint whose OUTER edge sits exactly on halfWidth
  float edge = vHW - aHalf;
  float limitLine = smoothstep(-aa, aa, edge) * (1.0 - smoothstep(0.12 - aa, 0.12 + aa, edge));
  paint = max(paint, limitLine);

  // start/finish: 0.4 m solid band, with the timing loop slot just behind it
  float sf = xline(0.0, 0.20, aaS);
  paint = max(paint, sf);
  float loop = xline(uLapLength - 1.4, 0.05, aaS);
  diffuseColor.rgb *= mix(1.0, 0.55, loop);

  // sector lines: thin, dashed across the track
  float dash = step(0.55, fract(vLat * 0.55));
  paint = max(paint, xline(uSector0, 0.075, aaS) * dash);
  paint = max(paint, xline(uSector1, 0.075, aaS) * dash);

  // Straight Line Mode: dashed detection lines, solid activation lines
  float dashS = step(0.5, fract(vLat * 0.85));
  paint = max(paint, xline(uSlmDetect.x, 0.07, aaS) * dashS);
  paint = max(paint, xline(uSlmDetect.y, 0.07, aaS) * dashS);
  paint = max(paint, xline(uSlmDetect.z, 0.07, aaS) * dashS);
  paint = max(paint, xline(uSlmStart.x, 0.11, aaS));
  paint = max(paint, xline(uSlmStart.y, 0.11, aaS));
  paint = max(paint, xline(uSlmStart.z, 0.11, aaS));

  // grid boxes: 20 slots, 8 m pitch, staggered either side of the centreline
  float sg = vS - (vS > uLapLength - 240.0 ? uLapLength : 0.0);
  float gi = floor((-sg - 2.0) / uGridPitch);
  float inGrid = step(-0.5, gi) * step(gi, uGridCount - 1.0);
  float gside  = (mod(gi, 2.0) < 0.5 ? -1.0 : 1.0) * uGridOffset;
  float gs     = -2.0 - gi * uGridPitch - 3.0;
  vec2  gq     = abs(vec2(vLat - gside, sg - gs)) - vec2(1.05, 3.0);
  float gout   = max(gq.x, gq.y);
  float gbox   = (1.0 - smoothstep(-aa, aa, gout)) * smoothstep(-0.10 - aa, -0.10 + aa, gout);
  paint = max(paint, gbox * inGrid);

  // pit entry taper and pit exit blend line, both on the pit side of the road
  float pitLat = uPitSide * (vHW - 0.75);
  float pitBand = 1.0 - smoothstep(0.06 - aa, 0.06 + aa, abs(vLat - pitLat));
  float inEntry = step(0.0, 60.0 - sWrap(vS, uPitEntry + 40.0));
  float inExit  = step(0.0, 160.0 - sWrap(vS, uPitExit - 160.0));
  paint = max(paint, pitBand * max(inEntry, inExit));

  // worn, gritty paint rather than a perfect decal
  float wear = 0.78 + 0.30 * h21(floor(vec2(vLat, vS) * 3.3));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.60, 0.60, 0.585) * wear, paint * 0.94);
  roughnessFactor  = mix(roughnessFactor, 0.60, paint * 0.9);
`;

/* -------------------------------------------------------- run-off apron */

const RUNOFF_BODY = /* glsl */`
  ${SURFACE_DETAIL}
  // paved run-off is newer, paler and sandblasted; nobody rubbers it in
  float sandy = smoothstep(0.0, 16.0, abs(vLat) - vHW);
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.34, 1.27, 1.12), 0.35 + sandy * 0.45);
  roughnessFactor  = mix(roughnessFactor, 1.0, 0.5);
`;
