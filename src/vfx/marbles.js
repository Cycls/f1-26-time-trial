/**
 * Rubber marbles lying off the racing line. Owner: VFX.
 *
 * A rolling window of instanced pellets around the car (one InstancedMesh, one draw call).
 * Positions are deterministic per 30 m segment, so the field never swims or flickers as the
 * car moves; only segments that leave the window are rebuilt, a couple per frame at most.
 * Marbles collect on the outside of the corner and at the track edges, exactly where a real
 * lap sheds them, and they are standard-lit so the floodlights catch them.
 */
import * as THREE from 'three';

const SEG_LEN = 30;
const SEGS = 11;                 // ~330 m of track carried around the car
const PER_SEG = 40;

const rnd = (seed) => {          // deterministic per (segment, index)
  let x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

export class Marbles {
  constructor(scene) {
    this.count = SEGS * PER_SEG;
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1a1615, roughness: 0.62, metalness: 0.0 });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.count);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; this.mesh.receiveShadow = false;
    this.mesh.name = 'vfx.marbles';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.mesh);
    this.slotSeg = new Int32Array(SEGS).fill(-999999);
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    // park every instance far below the world until its segment is built
    this._m.makeTranslation(0, -9999, 0);
    for (let i = 0; i < this.count; i++) this.mesh.setMatrixAt(i, this._m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** @param track Track module @param s car distance along the lap */
  update(track, s) {
    if (!track?.sampleS) return;
    const first = Math.floor(s / SEG_LEN) - 2;
    let rebuilt = 0;
    for (let k = 0; k < SEGS && rebuilt < 2; k++) {
      const seg = first + k;
      const slot = ((seg % SEGS) + SEGS) % SEGS;
      if (this.slotSeg[slot] === seg) continue;
      this.slotSeg[slot] = seg;
      this.#build(track, seg, slot);
      rebuilt++;
    }
    if (rebuilt) this.mesh.instanceMatrix.needsUpdate = true;
  }

  #build(track, seg, slot) {
    const base = slot * PER_SEG;
    for (let i = 0; i < PER_SEG; i++) {
      const h = seg * 131 + i * 7919;
      const a = rnd(h), b = rnd(h + 1.7), c = rnd(h + 3.3), d = rnd(h + 5.1);
      const sm = (seg * SEG_LEN + a * SEG_LEN + track.length) % track.length;
      const t = track.sampleS(sm);
      // marbles gather off the rubbered-in line, thickest on the outside of the corner
      const line = track.racingLineAt ? (track.racingLineAt(sm) || 0) : 0;
      const curv = t.curvature ?? 0;
      const outside = curv > 0.0006 ? -1 : curv < -0.0006 ? 1 : (b < 0.5 ? -1 : 1);
      const side = b < 0.8 ? outside : -outside;
      const lat = line + side * (1.6 + (t.halfWidth - 1.9) * (0.25 + 0.75 * c));
      const r = 0.018 + 0.030 * d;
      this._p.copy(t.point).addScaledVector(t.right, lat);
      // exact surface height at that lateral offset (camber / crown / apron)
      let y = t.point.y, ok = true;
      if (track.locate) {
        const q = track.locate(this._p, sm);
        y = q.height;
        ok = q.surface === 'asphalt';
      }
      if (!ok || Math.abs(lat) > t.halfWidth * 1.02) {
        this._m.makeTranslation(0, -9999, 0);
        this.mesh.setMatrixAt(base + i, this._m);
        continue;
      }
      this._p.y = y + r * 0.7 + 0.01;
      this._s.set(r, r * (0.6 + 0.4 * a), r);
      this._q.setFromAxisAngle(UP, b * 6.283);
      this._m.compose(this._p, this._q, this._s);
      this.mesh.setMatrixAt(base + i, this._m);
    }
  }
}

const UP = new THREE.Vector3(0, 1, 0);
