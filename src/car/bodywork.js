/**
 * Monocoque, nose, sidepods, engine cover / airbox, halo, mirrors, cockpit.
 * Owner: CAR. Everything is lofted or swept — no primitives used as bodywork.
 */
import * as THREE from 'three';
import { D } from './dims.js';
import {
  loft, bodySection, podSection, sweepProfile, teardropProfile,
  ellipseProfile, roundedRect, plateZY, splineShape,
} from './geometry.js';

const V3 = THREE.Vector3;

function ringsFrom(stations, N = 76) {
  return stations.map(s => bodySection(s, N).map(p => new V3(p.x, p.y, s.z)));
}

function mesh(geo, mat, { shadow = true, name = '' } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = shadow; m.receiveShadow = shadow;
  if (name) m.name = name;
  return m;
}

/* ------------------------------------------------------------ monocoque ---- */
const BODY = [
  { z: 2.60, hw: 0.050, yBot: -0.118, yTop: 0.000, deck: 0.55, waist: 0.55, bottomHW: 0.6 },
  { z: 2.44, hw: 0.064, yBot: -0.106, yTop: 0.030, deck: 0.60, waist: 0.52 },
  { z: 2.22, hw: 0.083, yBot: -0.094, yTop: 0.060, deck: 0.64 },
  { z: 1.98, hw: 0.104, yBot: -0.088, yTop: 0.086 },
  { z: 1.72, hw: 0.130, yBot: -0.087, yTop: 0.108 },
  { z: 1.48, hw: 0.162, yBot: -0.092, yTop: 0.127 },
  { z: 1.24, hw: 0.203, yBot: -0.104, yTop: 0.143 },
  { z: 1.02, hw: 0.244, yBot: -0.126, yTop: 0.154 },
  { z: 0.84, hw: 0.274, yBot: -0.150, yTop: 0.161 },
  { z: 0.64, hw: 0.296, yBot: -0.178, yTop: 0.166, deck: 0.80, cockpitHW: 0.110, yTub: 0.118 },
  { z: 0.42, hw: 0.310, yBot: -0.196, yTop: 0.172, deck: 0.86, cockpitHW: 0.192, yTub: 0.048 },
  { z: 0.14, hw: 0.318, yBot: -0.207, yTop: 0.176, deck: 0.88, cockpitHW: 0.214, yTub: 0.006 },
  { z: -0.14, hw: 0.316, yBot: -0.211, yTop: 0.182, deck: 0.88, cockpitHW: 0.210, yTub: 0.006 },
  { z: -0.36, hw: 0.303, yBot: -0.212, yTop: 0.197, deck: 0.84, cockpitHW: 0.146, yTub: 0.092 },
  { z: -0.56, hw: 0.288, yBot: -0.212, yTop: 0.209 },
  { z: -0.90, hw: 0.262, yBot: -0.209, yTop: 0.208 },
  { z: -1.24, hw: 0.216, yBot: -0.204, yTop: 0.188 },
  { z: -1.58, hw: 0.166, yBot: -0.199, yTop: 0.154 },
  { z: -1.88, hw: 0.116, yBot: -0.194, yTop: 0.110 },
  { z: -2.12, hw: 0.072, yBot: -0.189, yTop: 0.060 },
  { z: -2.30, hw: 0.040, yBot: -0.182, yTop: 0.014 },
];

/* --------------------------------------------------------------- sidepods -- */
const POD = [
  { z: 0.760, xIn: 0.10, xOut: 0.520, yBot: -0.090, yTop: 0.108, undercut: 0.05 },
  { z: 0.660, xIn: 0.10, xOut: 0.620, yBot: -0.128, yTop: 0.118, undercut: 0.10 },
  { z: 0.480, xIn: 0.10, xOut: 0.695, yBot: -0.168, yTop: 0.122, undercut: 0.20 },
  { z: 0.220, xIn: 0.10, xOut: 0.722, yBot: -0.196, yTop: 0.118, undercut: 0.30 },
  { z: -0.100, xIn: 0.10, xOut: 0.716, yBot: -0.208, yTop: 0.104, undercut: 0.36 },
  { z: -0.420, xIn: 0.10, xOut: 0.672, yBot: -0.212, yTop: 0.076, undercut: 0.40 },
  { z: -0.760, xIn: 0.10, xOut: 0.582, yBot: -0.212, yTop: 0.036, undercut: 0.42 },
  { z: -1.060, xIn: 0.10, xOut: 0.462, yBot: -0.210, yTop: -0.012, undercut: 0.42 },
  { z: -1.320, xIn: 0.09, xOut: 0.336, yBot: -0.206, yTop: -0.058, undercut: 0.40 },
  { z: -1.540, xIn: 0.08, xOut: 0.224, yBot: -0.202, yTop: -0.098, undercut: 0.34 },
  { z: -1.700, xIn: 0.07, xOut: 0.150, yBot: -0.198, yTop: -0.132, undercut: 0.28 },
];

/* ------------------------------------------------------- engine cover / airbox */
const AIRBOX = [
  { z: -0.240, hw: 0.052, yBot: 0.150, yTop: 0.245, deck: 0.6 },
  { z: -0.340, hw: 0.098, yBot: 0.160, yTop: 0.470, deck: 0.6 },
  { z: -0.430, hw: 0.122, yBot: 0.172, yTop: 0.576, deck: 0.55 },
  { z: -0.540, hw: 0.126, yBot: 0.186, yTop: 0.588, deck: 0.55 },
  { z: -0.720, hw: 0.114, yBot: 0.198, yTop: 0.556, deck: 0.6 },
  { z: -0.980, hw: 0.090, yBot: 0.204, yTop: 0.472, deck: 0.65 },
  { z: -1.280, hw: 0.064, yBot: 0.196, yTop: 0.368, deck: 0.7 },
  { z: -1.600, hw: 0.043, yBot: 0.168, yTop: 0.258, deck: 0.7 },
  { z: -1.880, hw: 0.028, yBot: 0.124, yTop: 0.158, deck: 0.7 },
  { z: -2.020, hw: 0.018, yBot: 0.080, yTop: 0.098, deck: 0.7 },
];

/**
 * Section perimeter along the monocoque, so the livery can keep its decals a
 * constant PHYSICAL size. loft() writes U normalised per ring, and the monocoque's
 * perimeter runs from ~0.30 m at the nose to ~1.6 m at the cockpit — without this
 * a decal drawn "13 cm tall" is 13 cm on the flank and 2.5 cm on the nose.
 * @returns {(v:number)=>number} ring perimeter in metres at normalised spine v
 */
export function bodyProfile() {
  const rings = ringsFrom(BODY, 48);
  const per = rings.map(r => {
    let p = 0;
    for (let i = 0; i < r.length; i++) p += r[i].distanceTo(r[(i + 1) % r.length]);
    return p;
  });
  const cen = rings.map(r => r.reduce((s, p) => s.add(p.clone()), new V3()).multiplyScalar(1 / r.length));
  const vs = [0];
  for (let j = 1; j < rings.length; j++) vs.push(vs[j - 1] + cen[j].distanceTo(cen[j - 1]));
  const tot = vs[vs.length - 1] || 1;
  for (let j = 0; j < vs.length; j++) vs[j] /= tot;
  return (v) => {
    if (v <= vs[0]) return per[0];
    for (let j = 1; j < vs.length; j++) {
      if (v <= vs[j]) {
        const t = (v - vs[j - 1]) / Math.max(1e-6, vs[j] - vs[j - 1]);
        return per[j - 1] + (per[j] - per[j - 1]) * t;
      }
    }
    return per[per.length - 1];
  };
}

export function buildBodywork(M) {
  const g = new THREE.Group(); g.name = 'bodywork';
  const refs = {};

  // ---- monocoque + nose + engine cover shell -------------------------------
  const bodyGeo = loft(ringsFrom(BODY, 76), { capStart: true, capEnd: true });
  g.add(mesh(bodyGeo, M.body, { name: 'monocoque' }));

  // ---- sidepods ------------------------------------------------------------
  // Their own livery sheet: they are a separate loft, so sharing the monocoque's
  // squeezed the whole 4.95 m car livery onto a 2.46 m pod and every graphic
  // landed twice, at two different scales.
  const podRings = POD.map(s => podSection(s, 52).map(p => new V3(p.x, p.y, s.z)));
  const podGeo = loft(podRings, { capStart: true, capEnd: true });
  const podR = mesh(podGeo, M.bodyPod ?? M.body, { name: 'sidepodR' });
  const podL = mesh(podGeo, M.bodyPod ?? M.body, { name: 'sidepodL' });
  podL.scale.x = -1;
  g.add(podR, podL);

  // sidepod inlet: carbon lip with a real aperture, dark plenum behind it
  const lipOuter = roundedRect(0.335, 0.200, 0.055, 0, 0);
  lipOuter.holes.push(roundedRect(0.268, 0.140, 0.040, 0, 0));
  const lipGeo = new THREE.ExtrudeGeometry(lipOuter, { depth: 0.055, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.006, bevelSegments: 2, curveSegments: 10 });
  const plenumShape = roundedRect(0.268, 0.140, 0.040, 0, 0);
  const plenumGeo = new THREE.ExtrudeGeometry(plenumShape, { depth: 0.24, bevelEnabled: false, curveSegments: 8 });
  for (const sx of [1, -1]) {
    const lip = mesh(lipGeo, M.carbon, { name: 'podInletLip' });
    lip.position.set(sx * 0.435, 0.000, 0.700); lip.rotation.y = sx > 0 ? -0.12 : 0.12;
    const plenum = new THREE.Mesh(plenumGeo, M.cockpitInner);
    plenum.position.set(sx * 0.435, 0.000, 0.455); plenum.rotation.y = sx > 0 ? -0.12 : 0.12;
    g.add(lip, plenum);
  }

  // sidepod inlet turning vanes (2022+ style deflectors ahead of the pod)
  const vaneShape = splineShape([[0.0, 0.0], [0.30, 0.02], [0.315, 0.145], [0.02, 0.175]], 4);
  const vaneGeo = plateZY(vaneShape, 0.012);
  for (const sx of [1, -1]) {
    for (let i = 0; i < 2; i++) {
      const v = mesh(vaneGeo, M.carbon);
      v.position.set(sx * (0.335 + i * 0.115), -0.205 - i * 0.006, 0.78 - i * 0.04);
      v.rotation.y = sx * 0.14 * (i + 1);
      g.add(v);
    }
  }

  // ---- airbox / roll hoop --------------------------------------------------
  // Metric UVs: this loft's ring perimeter collapses from ~0.9 m at the roll hoop
  // to ~0.04 m at the tail, so a normalised weave would go from 25 mm cells to
  // 1 mm and alias into a grey waterfall down the centreline.
  const airGeo = loft(ringsFrom(AIRBOX, 48), { capStart: true, capEnd: true, metricUV: 0.13 });
  g.add(mesh(airGeo, M.carbonMetric ?? M.carbonBody, { name: 'airbox' }));

  // intake aperture: rounded-triangle lip + dark plenum
  const intake = new THREE.Shape();
  intake.moveTo(0, 0.086);
  intake.bezierCurveTo(0.055, 0.078, 0.086, 0.030, 0.082, -0.030);
  intake.bezierCurveTo(0.050, -0.052, -0.050, -0.052, -0.082, -0.030);
  intake.bezierCurveTo(-0.086, 0.030, -0.055, 0.078, 0, 0.086);
  const intakeRing = new THREE.Shape();
  intakeRing.moveTo(0, 0.112);
  intakeRing.bezierCurveTo(0.072, 0.104, 0.112, 0.040, 0.108, -0.046);
  intakeRing.bezierCurveTo(0.062, -0.076, -0.062, -0.076, -0.108, -0.046);
  intakeRing.bezierCurveTo(-0.112, 0.040, -0.072, 0.104, 0, 0.112);
  intakeRing.holes.push(intake);
  const ringGeo = new THREE.ExtrudeGeometry(intakeRing, { depth: 0.05, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 14 });
  const ringMesh = mesh(ringGeo, M.carbon, { name: 'airboxLip' });
  ringMesh.position.set(0, 0.436, -0.395); ringMesh.rotation.x = 0.10;
  g.add(ringMesh);
  const plenumGeo2 = new THREE.ExtrudeGeometry(intake, { depth: 0.26, bevelEnabled: false, curveSegments: 12 });
  const plenum2 = new THREE.Mesh(plenumGeo2, M.cockpitInner);
  plenum2.position.set(0, 0.436, -0.68); plenum2.rotation.x = 0.10;
  g.add(plenum2);
  // titanium roll structure visible inside the intake
  const rollBar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.17, 8), M.titanium);
  rollBar.position.set(0, 0.436, -0.44);
  g.add(rollBar);

  // engine cover shark fin (small, 2026 style)
  const finShape = new THREE.Shape();
  finShape.moveTo(-0.62, 0.00); finShape.lineTo(0.30, 0.00);
  finShape.quadraticCurveTo(0.24, 0.11, -0.20, 0.135);
  finShape.quadraticCurveTo(-0.48, 0.13, -0.62, 0.00);
  const finGeo = plateZY(finShape, 0.011);
  const fin = mesh(finGeo, M.carbon, { name: 'fin' });
  fin.position.set(0, 0.30, -1.30);
  g.add(fin);

  // exhaust + wastegates
  const exh = mesh(new THREE.CylinderGeometry(0.052, 0.062, 0.16, 16, 1, true), M.exhaust);
  exh.rotation.x = Math.PI / 2; exh.position.set(0, 0.055, -2.16);
  const exhIn = new THREE.Mesh(new THREE.CircleGeometry(0.05, 16), M.matteBlack);
  exhIn.position.set(0, 0.055, -2.19); exhIn.rotation.y = Math.PI;
  g.add(exh, exhIn);
  for (const sx of [1, -1]) {
    const wg = mesh(new THREE.CylinderGeometry(0.021, 0.024, 0.10, 10), M.exhaust);
    wg.rotation.x = Math.PI / 2; wg.position.set(sx * 0.075, 0.115, -2.12);
    g.add(wg);
  }

  // ---- cockpit interior ----------------------------------------------------
  // headrest + side padding, sitting inside the tub the monocoque loft cuts out
  const headShape = roundedRect(0.36, 0.20, 0.07, 0, 0);
  const headGeo = new THREE.ExtrudeGeometry(headShape, { depth: 0.12, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2, curveSegments: 8 });
  const headrest = mesh(headGeo, M.matteBlack, { name: 'headrest' });
  headrest.position.set(0, 0.185, -0.31); headrest.rotation.x = 0.16;
  g.add(headrest);
  for (const sx of [1, -1]) {
    const pad = mesh(new THREE.BoxGeometry(0.05, 0.10, 0.34), M.matteBlack);
    pad.position.set(sx * 0.175, 0.145, -0.09);
    g.add(pad);
  }
  // cockpit floor / seat
  const seat = mesh(new THREE.BoxGeometry(0.30, 0.05, 0.62), M.carbonMatte);
  seat.position.set(0, 0.02, 0.06);
  g.add(seat);

  // ---- halo ----------------------------------------------------------------
  const haloCurve = new THREE.CatmullRomCurve3([
    new V3(0.276, 0.150, -0.240),
    new V3(0.300, 0.243, -0.040),
    new V3(0.268, 0.352, 0.220),
    new V3(0.150, 0.432, 0.470),
    new V3(0.000, 0.452, 0.560),
    new V3(-0.150, 0.432, 0.470),
    new V3(-0.268, 0.352, 0.220),
    new V3(-0.300, 0.243, -0.040),
    new V3(-0.276, 0.150, -0.240),
  ], false, 'catmullrom', 0.5);
  const haloGeo = sweepProfile(haloCurve, (t) => {
    const k = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);      // fatter at the sides
    return teardropProfile(0.0255 + 0.004 * (1 - k), 0.0335, 16);
  }, 96);
  const halo = mesh(haloGeo, M.halo, { name: 'halo' });
  g.add(halo);
  // halo front pylon
  const pylonCurve = new THREE.CatmullRomCurve3([
    new V3(0, 0.452, 0.556), new V3(0, 0.330, 0.606), new V3(0, 0.200, 0.664), new V3(0, 0.140, 0.700),
  ]);
  const pyGeo = sweepProfile(pylonCurve, ellipseProfile(0.024, 0.036, 12), 20);
  g.add(mesh(pyGeo, M.matteBlack, { name: 'haloPylon' }));
  // halo rear mounts
  for (const sx of [1, -1]) {
    const mnt = mesh(new THREE.CylinderGeometry(0.024, 0.030, 0.07, 10), M.titanium);
    mnt.position.set(sx * 0.276, 0.125, -0.245);
    g.add(mnt);
  }

  // ---- mirrors -------------------------------------------------------------
  // Rounded, bevelled pod rather than a bare box: these sit right in the middle
  // of the cockpit view, where a hard-edged cube reads as placeholder geometry.
  const mirrorShell = new THREE.ExtrudeGeometry(roundedRect(0.104, 0.064, 0.024), {
    depth: 0.026, bevelEnabled: true, bevelSize: 0.011, bevelThickness: 0.010,
    bevelSegments: 3, curveSegments: 12,
  });
  for (const sx of [1, -1]) {
    const stalkCurve = new THREE.CatmullRomCurve3([
      new V3(sx * 0.245, 0.150, 0.330), new V3(sx * 0.330, 0.176, 0.322), new V3(sx * 0.402, 0.196, 0.312),
    ]);
    const stalk = mesh(sweepProfile(stalkCurve, ellipseProfile(0.014, 0.028, 10), 12), M.carbon);
    const pod = new THREE.Group();
    pod.position.set(sx * 0.452, 0.200, 0.300); pod.rotation.y = -sx * 0.30;
    const housing = mesh(mirrorShell, M.paint);
    housing.position.z = -0.013;
    // glass faces -Z, i.e. back towards the driver
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.086, 0.048), M.mirrorGlass);
    glass.position.z = -0.0255;
    glass.rotation.y = Math.PI;
    pod.add(housing, glass);
    g.add(stalk, pod);
  }

  // ---- nose camera pods + antenna -----------------------------------------
  for (const sx of [1, -1]) {
    const pod = mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.075, 10), M.matteBlack);
    pod.rotation.x = Math.PI / 2; pod.position.set(sx * 0.088, 0.052, 2.16);
    const arm = mesh(new THREE.BoxGeometry(0.012, 0.055, 0.03), M.carbon);
    arm.position.set(sx * 0.088, 0.020, 2.16);
    g.add(pod, arm);
  }

  refs.body = g;
  return { group: g, refs };
}
