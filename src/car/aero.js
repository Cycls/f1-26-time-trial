/**
 * 2026 aero: active front wing (2 movable elements), 3-element rear wing with
 * NO beam wing, partially flat floor with de-emphasised venturi tunnels, diffuser.
 * Owner: CAR.
 *
 * Regulation box this file builds to (docs/reference-physics.md):
 *   front wing  overall width 1800 mm; PROFILES span 1350 mm; footplate and
 *               diveplane reach 900 mm from the centreline. Two movable elements
 *               (FW Primary Flap + FW Secondary Flap). Low, and ahead of the front axle.
 *   rear wing   3 elements, span 1150 mm, profiles AND endplates inside a
 *               725-880 mm band above the reference plane. Beam wing removed.
 *   floor       max width 1540 mm, tunnels retained but shallow.
 */
import * as THREE from 'three';
import { D } from './dims.js';
import { sweepAirfoil, plate, splineShape, plateZY, plateZX, mergeSafe } from './geometry.js';

const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

function mesh(geo, mat, name = '') {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true; m.receiveShadow = true; m.name = name;
  return m;
}

/**
 * One wing element swept across the span.
 * chord/twist/rise are functions of |normalised span| (0 centre, 1 tip).
 */
function element({ span, n = 15, chord, twist, rise = () => 0, sweep = () => 0, camber = 0.09, thickness = 0.10, sections = 30 }) {
  const st = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), s = t * 2 - 1, a = Math.abs(s);
    st.push({
      x: s * span, y: rise(a), z: sweep(a),
      chord: chord(a), twist: twist(a), scaleY: -1,
      thickness: thickness * (1 + 0.15 * a),
    });
  }
  return sweepAirfoil(st, { flip: true, camber, thickness, sections });
}

/* ----------------------------------------------------------- FRONT WING ---- */
export function buildFrontWing(M) {
  const g = new THREE.Group();
  g.name = 'frontWing';
  g.position.set(0, D.fwY, D.fwZ);
  const S = D.fwSpan;           // 675 mm — profiles span 1350 mm
  const EP = S + 0.016;         // endplate inner face
  const FLARE = D.fwOuter - EP; // outboard reach of footplate + diveplane

  // main plane — fixed. Flat neutral centre section, loading up outboard.
  const dihedral = (a) => 0.050 * a * a + 0.014 * smooth(clamp01((a - 0.72) / 0.28));
  const backSweep = (a) => -0.034 * a * a;
  const mainGeo = element({
    span: S, n: 17,
    chord: (a) => 0.250 + 0.045 * smooth(clamp01((a - 0.12) / 0.55)) - 0.062 * smooth(clamp01((a - 0.80) / 0.20)),
    twist: (a) => -0.040 - 0.110 * smooth(clamp01((a - 0.16) / 0.6)),
    rise: dihedral,
    sweep: backSweep,
    camber: 0.085, thickness: 0.095,
  });
  g.add(mesh(mainGeo, M.wingMain, 'fwMain'));

  // The two movable elements live in one pivoting group (2026 active aero).
  // Each leading edge sits behind and above the one in front, leaving a real slot
  // gap rather than merging into a single sheet.
  const flaps = new THREE.Group();
  flaps.name = 'fwFlaps';
  flaps.position.set(0, 0.034, -0.150);
  const flap1 = element({
    span: S * 0.985, n: 15,
    chord: (a) => 0.140 + 0.040 * smooth(clamp01((a - 0.12) / 0.6)) - 0.055 * smooth(clamp01((a - 0.82) / 0.18)),
    twist: (a) => -0.20 - 0.30 * smooth(clamp01((a - 0.14) / 0.6)),
    rise: dihedral,
    sweep: backSweep,
    camber: 0.10, thickness: 0.075,
  });
  const flap2 = element({
    span: S * 0.965, n: 15,
    chord: (a) => 0.112 + 0.034 * smooth(clamp01((a - 0.12) / 0.6)) - 0.048 * smooth(clamp01((a - 0.84) / 0.16)),
    twist: (a) => -0.34 - 0.44 * smooth(clamp01((a - 0.14) / 0.6)),
    rise: (a) => dihedral(a) + 0.074,
    sweep: (a) => backSweep(a) - 0.138,
    camber: 0.10, thickness: 0.065,
  });
  flaps.add(mesh(flap1, M.wingFlap, 'fwFlap1'), mesh(flap2, M.wingMain, 'fwFlap2'));
  g.add(flaps);

  // endplates (ZY outline: shape.x = car Z, shape.y = car Y)
  const epShape = splineShape([
    [0.190, -0.055], [0.205, 0.030], [0.150, 0.135], [-0.020, 0.198],
    [-0.280, 0.205], [-0.348, 0.120], [-0.358, -0.010], [-0.322, -0.088],
    [-0.090, -0.102], [0.120, -0.094],
  ], 6);
  const epGeo = plateZY(epShape, 0.016, {
    bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.003, bevelSegments: 1, fitUV: true,
  });
  for (const sx of [1, -1]) {
    // Sponsor text runs along +Z. From the car's right the nose is to the viewer's
    // LEFT, so the +X plate needs the mirrored sheet or the decal reads backwards.
    const ep = mesh(epGeo, sx > 0 ? M.endplateL : M.endplate, 'fwEndplate');
    ep.position.set(sx * EP, 0.058, 0);
    ep.rotation.z = -sx * 0.06;
    g.add(ep);
  }

  // Footplate flaring outboard from each endplate to the 900 mm legality line
  // (ZX outline: shape.x = car Z, shape.y = outboard X).
  const fpShape = splineShape([
    [0.150, 0.0], [0.095, FLARE * 0.42], [-0.120, FLARE * 0.88], [-0.300, FLARE],
    [-0.372, FLARE * 0.72], [-0.348, FLARE * 0.18], [-0.300, 0.0], [0.060, -0.012],
  ], 6);
  const fpGeo = plateZX(fpShape, 0.012);
  for (const sx of [1, -1]) {
    const fp = mesh(fpGeo, M.carbon, 'fwFootplate');
    fp.position.set(sx * EP, -0.100, 0);
    fp.scale.x = sx;
    g.add(fp);
  }

  // Diveplane / upper turning vane on the outer face of each endplate, also
  // reaching 900 mm. This is what carries the front wing out to its legal width
  // now that the profiles stop at 675 mm.
  const dvShape = splineShape([
    [0.060, 0.0], [0.020, FLARE * 0.50], [-0.150, FLARE * 0.95], [-0.250, FLARE * 0.92],
    [-0.235, FLARE * 0.40], [-0.190, 0.0],
  ], 6);
  const dvGeo = plateZX(dvShape, 0.010);
  for (const sx of [1, -1]) {
    const dv = mesh(dvGeo, M.carbon, 'fwDiveplane');
    dv.position.set(sx * (EP + 0.008), 0.055, 0);
    dv.scale.x = sx;
    dv.rotation.z = sx * 0.10;
    g.add(dv);
  }

  // nose-to-wing pylons
  const pyShape = splineShape([
    [0.16, 0.005], [0.13, 0.115], [-0.06, 0.125], [-0.10, 0.015], [-0.02, -0.006],
  ], 5);
  const pyGeo = plateZY(pyShape, 0.020);
  for (const sx of [1, -1]) {
    const py = mesh(pyGeo, M.carbon, 'fwPylon');
    py.position.set(sx * 0.058, 0.008, -0.055);
    g.add(py);
  }

  return { group: g, flaps, main: g.getObjectByName('fwMain') };
}

/* ------------------------------------------------------------ REAR WING ---- */
export function buildRearWing(M) {
  const g = new THREE.Group();
  g.name = 'rearWing';
  g.position.set(0, D.rwY, D.rwZ);
  const S = D.rwSpan;           // 575 mm — span 1150 mm

  // Everything below is laid out to keep the whole assembly inside the
  // 725-880 mm band above the reference plane (local y -0.043 .. +0.112 here).
  const rise = (a) => 0.016 * a * a;

  // element 1: main plane, fixed
  const mainGeo = element({
    span: S, n: 15,
    chord: (a) => 0.240 - 0.042 * smooth(clamp01((a - 0.72) / 0.28)),
    twist: () => -0.145,
    rise,
    camber: 0.075, thickness: 0.100,
  });
  g.add(mesh(mainGeo, M.wingMain, 'rwMain'));

  // elements 2 + 3: the movable pack (2026 active aero flattens these on a straight)
  const flap = new THREE.Group();
  flap.name = 'rwFlap';
  flap.position.set(0, 0.040, -0.082);
  const el2 = element({
    span: S * 0.99, n: 15,
    chord: (a) => 0.140 - 0.026 * smooth(clamp01((a - 0.72) / 0.28)),
    twist: () => -0.38,
    rise,
    camber: 0.085, thickness: 0.078,
  });
  const el3 = element({
    span: S * 0.98, n: 15,
    chord: (a) => 0.105 - 0.020 * smooth(clamp01((a - 0.74) / 0.26)),
    twist: () => -0.55,
    rise: (a) => rise(a) + 0.024,
    sweep: () => -0.058,
    camber: 0.09, thickness: 0.070,
  });
  flap.add(mesh(el2, M.wingFlap, 'rwEl2'), mesh(el3, M.wingMain, 'rwEl3'));
  g.add(flap);

  // endplates — small and shallow, the 2026 signature. Kept inside the band.
  const epShape = splineShape([
    [0.140, -0.030], [0.150, 0.040], [0.110, 0.100], [0.010, 0.112],
    [-0.170, 0.110], [-0.226, 0.062], [-0.232, -0.014], [-0.196, -0.041], [-0.020, -0.043],
  ], 6);
  const epGeo = plateZY(epShape, 0.014, {
    bevelEnabled: true, bevelSize: 0.003, bevelThickness: 0.003, bevelSegments: 1, fitUV: true,
  });
  for (const sx of [1, -1]) {
    const ep = mesh(epGeo, sx > 0 ? M.endplateL : M.endplate, 'rwEndplate');
    ep.position.set(sx * (S + 0.007), 0, 0);
    g.add(ep);
  }

  // swan-neck pylons from the crash structure up to the main plane's upper surface
  const pyShape = splineShape([
    [0.095, 0.0], [0.072, 0.150], [0.058, 0.316], [-0.020, 0.334], [-0.044, 0.150], [-0.058, -0.010],
  ], 6);
  const pyGeo = plateZY(pyShape, 0.024);
  for (const sx of [1, -1]) {
    const py = mesh(pyGeo, M.carbon, 'rwPylon');
    py.position.set(sx * 0.088, -0.352, 0.030);
    g.add(py);
  }

  // FIA rain light in the centre of the crash structure (world coords, added by caller)
  return { group: g, flap };
}

/* ---------------------------------------------------------------- FLOOR ---- */
export function buildFloor(M) {
  const g = new THREE.Group();
  g.name = 'floor';
  const z0 = 1.06, z1 = -2.06;
  const REF = D.REF;
  const HW = D.floorHW;         // 770 mm — 1540 mm max floor width

  const halfWidth = (tz) => {
    const z = z0 + (z1 - z0) * tz;
    if (z > 0.60) return 0.400 + (HW - 0.400) * smooth(clamp01((1.06 - z) / 0.46));
    if (z < -1.42) return HW - (HW - 0.585) * smooth(clamp01((-1.42 - z) / 0.64));
    return HW;
  };
  // shallow, de-emphasised 2026 venturi tunnels + diffuser ramp
  const tunnel = (x, z) => {
    const a = Math.abs(x);
    if (a < 0.140 || a > 0.700) return 0;
    const t = (a - 0.140) / 0.560;
    const across = Math.sin(Math.PI * t) ** 1.6;
    const along = smooth(clamp01((1.00 - z) / 0.55)) * smooth(clamp01((z + 1.95) / 0.5));
    return 0.042 * across * along;
  };
  const diff = (z) => 0.150 * smooth(clamp01((-1.18 - z) / 0.86)) ** 1.3;
  const bottom = (tx, tz, x, z) => REF + tunnel(x, z) + diff(z);
  const top = (tx, tz, x, z) => {
    const edge = smooth(clamp01((Math.abs(x) - (halfWidth(tz) - 0.075)) / 0.075));
    return Math.max(bottom(tx, tz, x, z) + 0.020, REF + 0.028) + 0.055 * edge * (z > -1.35 ? 1 : 0.35);
  };
  const floorGeo = plate({ z0, z1, nz: 54, nx: 26, halfWidth, bottom, top });
  g.add(mesh(floorGeo, M.carbonFloor, 'floorPlate'));

  // floor fences hanging under the leading edge (shallow — 30 mm ride height there)
  const fenceParts = [];
  for (let i = 0; i < 4; i++) {
    const shape = splineShape([
      [0.30 - i * 0.02, 0.0], [0.24, -0.010 - i * 0.002], [-0.16, -0.016], [-0.28, -0.008], [-0.20, 0.006], [0.16, 0.006],
    ], 4);
    const geo = plateZY(shape, 0.008);
    geo.translate(0.300 + i * 0.126, REF - 0.008, 0.760 - i * 0.030);
    fenceParts.push(geo);
    const m = geo.clone(); m.scale(-1, 1, 1);
    fenceParts.push(m);
  }
  // diffuser strakes (inside the diffuser, pointing down from its ceiling)
  for (let i = 0; i < 2; i++) {
    const shape = splineShape([
      [0.30, 0.0], [0.28, 0.075], [-0.26, 0.100], [-0.30, 0.0],
    ], 4);
    const geo = plateZY(shape, 0.008);
    geo.translate(0.21 + i * 0.195, REF - 0.005, -1.72);
    fenceParts.push(geo);
    const m = geo.clone(); m.scale(-1, 1, 1);
    fenceParts.push(m);
  }
  const merged = mergeSafe(fenceParts);
  if (merged) g.add(mesh(merged, M.carbon, 'floorFences'));

  return { group: g };
}
