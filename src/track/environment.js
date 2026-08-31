/**
 * Bahrain International Circuit — everything beside the track. Owner: ENVIRONMENT.
 *
 * WHAT THIS MODULE OWNS
 *   floodlight masts, grandstands + crowd, the pit complex and Sakhir Tower,
 *   barriers / TecPro / catch fencing / hoardings / marshal posts / gantries,
 *   the desert beyond the circuit, and the star layer.
 *
 * WHAT IT DELIBERATELY DOES NOT OWN
 *   - TRACK builds the road, kerbs, run-off aprons, the sand verge (out to ~90 m
 *     past the run-off) and the far ground plane. Nothing here draws ground inside
 *     that envelope; objects are seated on it with lift().
 *   - RENDER owns scene.fog, scene.environment, tone mapping, the sky gradient,
 *     the baked illuminance field and the volumetric cones/halos. In particular
 *     render/atmosphere.js#findLuminaires scans the scene for emissive materials
 *     above y=6 and hangs light shafts off them — so the luminaires here are a
 *     dedicated InstancedMesh whose instance origin sits AT the lamp cluster with
 *     a MeshStandardMaterial emissive. That is the integration point; we do not
 *     draw our own cones, and we never add a PointLight (8-light hard cap).
 *
 * PERFORMANCE
 *   Repeated dressing is instanced and bucketed into CHUNKS of lap distance, each
 *   its own Group with a tight bounding volume, so the far side of the circuit is
 *   frustum- and distance-culled wholesale. update() is O(chunks).
 */
import * as THREE from 'three';
import { makeRng, clamp, TrackField } from './env/util.js';
import { buildMasts } from './env/masts.js';
import { buildGrandstands } from './env/grandstand.js';
import { buildPitComplex } from './env/pit.js';
import { buildTrackside, buildBridges } from './env/trackside.js';
import { createDesert, buildStars } from './env/desert.js';

/**
 * Mirrors the verge profile track.js builds (#buildVerge / #surfaceY) so that
 * barriers, masts and grandstands sit ON its surface rather than floating.
 * If TRACK retunes these, objects drift by centimetres, not metres.
 */
const VERGE_BASE = -1.6;     // track.js BASE
const VERGE_STEP = 0.35;     // drop at the outer edge of the run-off bands
const VERGE_SLOPE = 0.14;    // fall per metre across the verge
const DRAIN = 0.014;         // run-off drain slope inside the bands

const CHUNKS = 10;
const CULL = 1500;           // metres; beyond this a whole chunk is switched off

export class Environment {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = ctx.state;
    this.group = null;
    this.chunkGroups = [];
    this.chunkCentres = [];
    this.flashes = null;
    this.stars = null;
    this._t = 0;
    this._attempts = 0;
  }

  async init() {
    if (!this.#build()) this._pending = true;
  }

  /* ------------------------------------------------------------------ build */

  #build() {
    const track = this.ctx.get('track');
    if (!track?.sampleS || !(track.length > 100)) return false;
    let probe;
    try { probe = track.sampleS(0); } catch { return false; }
    if (!probe || !Number.isFinite(probe.point?.x) || !Number.isFinite(probe.point?.y)
      || !Number.isFinite(probe.halfWidth)) {
      console.warn('[env] track geometry is not finite yet — deferring dressing');
      return false;
    }

    const t0 = performance.now();
    const scene = this.ctx.scene;
    const L = track.length;

    const group = this.group = new THREE.Group();
    group.name = 'environment';
    scene.add(group);

    for (let i = 0; i < CHUNKS; i++) {
      const g = new THREE.Group();
      g.name = `envChunk${i}`;
      group.add(g);
      this.chunkGroups.push(g);
      const c = track.sampleS((i + 0.5) * L / CHUNKS);
      this.chunkCentres.push(c.point.clone());
    }

    const rng = makeRng(0x1A26F1);
    const field = new TrackField(track, { step: 7, cell: 22, reach: 430 });

    // ---- cached per-s scalars ---------------------------------------------
    const SS = 5;                                   // sampling step, metres
    const NS = Math.ceil(L / SS);
    const hwA = new Float32Array(NS);
    const yA = new Float32Array(NS);
    const ryA = new Float32Array(NS);
    const bandA = new Float32Array(NS);             // outer edge of TRACK's run-off
    const cornA = new Float32Array(NS);
    const probeV = new THREE.Vector3();

    const readBand = (s) => {
      // fast path: TRACK exposes its band table; otherwise probe the surface API
      if (track.bandW && track.N) {
        const i = Math.round(((s % L) + L) % L / L * track.N) % track.N;
        const a = track.bandW[-1], b = track.bandW[1];
        if (a && b) return Math.max(a[i * 4 + 3], b[i * 4 + 3]);
      }
      const t = track.sampleS(s);
      let last = 1;
      for (let o = 1; o <= 24; o += 1) {
        for (const side of [-1, 1]) {
          probeV.copy(t.point).addScaledVector(t.right, side * (t.halfWidth + o));
          const su = track.locate(probeV, s).surface;
          if (su === 'asphalt' || su === 'kerb' || su === 'astro') last = o;
        }
      }
      return last + 3;
    };

    for (let i = 0; i < NS; i++) {
      const s = i * SS;
      const t = track.sampleS(s);
      hwA[i] = t.halfWidth;
      yA[i] = t.point.y;
      ryA[i] = t.right.y;
      bandA[i] = readBand(s);
      cornA[i] = Math.abs(t.curvature);
    }
    // smooth curvature into a 0..1 "cornerness", then blur so the barrier line
    // does not step in and out over a few metres
    const blur = (arr, radius) => {
      const out = new Float32Array(arr.length);
      for (let i = 0; i < arr.length; i++) {
        let sum = 0, n = 0;
        for (let k = -radius; k <= radius; k++) { sum += arr[(i + k + arr.length * 2) % arr.length]; n++; }
        out[i] = sum / n;
      }
      return out;
    };
    const corner = blur(cornA, 6);
    let cMax = 1e-6;
    for (const v of corner) cMax = Math.max(cMax, v);
    for (let i = 0; i < NS; i++) corner[i] = clamp(corner[i] / (cMax * 0.55), 0, 1);
    const cornerS = blur(corner, 8);
    const bandS = blur(bandA, 5);

    const idx = (s) => Math.floor((((s % L) + L) % L) / SS) % NS;

    // ---- placements --------------------------------------------------------
    const turns = Array.isArray(track.turns) && track.turns.length ? track.turns : null;
    const pitSide = track.data?.pit?.side ?? -1;
    const pitFrom = 120, pitTo = 900;
    const inPit = (s) => {
      const w = ((s % L) + L) % L;
      return w >= pitFrom - 60 && w <= pitTo + 60;
    };

    const E = this;
    const env = {
      track, rng, field, group,
      chunkGroups: this.chunkGroups, chunkCount: CHUNKS,
      pitSide, paddockFrom: pitFrom - 60, paddockTo: pitTo + 60,

      cornerAt: (s) => cornerS[idx(s)],
      bandAt: (s) => bandS[idx(s)],

      /** Lateral offset of the barrier line, measured from the centreline. */
      barrierLat(s, side) {
        const i = idx(s);
        const base = hwA[i] + bandS[i] + 5.5 + cornerS[i] * 15;
        if (side === pitSide && inPit(s)) return Math.max(base, hwA[i] + bandS[i] + 9);
        return base;
      },

      /** Y offset to add to `point + right*side*lateral` so an object sits on TRACK's verge. */
      lift(t, side, lateral) {
        const i = idx(t.s ?? 0);
        const hw = t.halfWidth, py = t.point.y, ob = bandS[i];
        const a = Math.abs(lateral);
        let y;
        if (a <= hw + ob) y = py - DRAIN * hw - Math.max(0, a - hw) * DRAIN;
        else y = Math.max(VERGE_BASE, py - VERGE_STEP - (a - hw - ob) * VERGE_SLOPE);
        // beyond the verge the desert (or the flat ground plane) takes over
        if (a > hw + ob + 88) {
          const p = t.point.clone().addScaledVector(t.right, side * lateral);
          y = Math.max(y, E.desert.heightAt(p.x, p.z), VERGE_BASE - 0.06);
        }
        return y - (py + t.right.y * side * lateral);
      },

      /** True if (x,z) is closer to any part of the circuit than `min` metres. */
      tooClose(x, z, min) { return field.distance(x, z) < min; },

      grandstandAt: (s) => E._standRange(s),
      brakingZones: [],
    };

    // ---- desert first: masts and structures need heightAt() ----------------
    const desert = this.desert = createDesert(env);
    env.desert = desert;

    // ---- where the grandstands go ------------------------------------------
    const outsideOf = (turn) => (turn.dir === 'R' ? -1 : 1);
    const stands = [];
    const mainSide = -pitSide;
    stands.push({ s0: 5330, len: 560, side: mainSide, gap: 15, density: 0.9, phase: 0, name: 'main' });
    if (turns) {
      const T = (n) => turns.find((x) => x.n === n);
      const t1 = T(1), t4 = T(4), t10 = T(10), t8 = T(8);
      if (t1) stands.push({ s0: t1.s - 80, len: 210, side: outsideOf(t1), gap: 16, density: 0.84, phase: 1 });
      if (t10) stands.push({ s0: t10.s - 110, len: 220, side: outsideOf(t10), gap: 16, density: 0.82, phase: 2 });
      if (t4) stands.push({ s0: t4.s - 70, len: 150, side: outsideOf(t4), gap: 17, density: 0.78, phase: 1 });
      if (t8) stands.push({ s0: t8.s - 60, len: 130, side: outsideOf(t8), gap: 17, density: 0.74, phase: 2 });
      env.brakingZones = turns.filter((t) => t.kph <= 165).map((t) => t.s);
    } else {
      stands.push({ s0: L * 0.18, len: 200, side: 1, gap: 16, density: 0.8, phase: 1 });
      stands.push({ s0: L * 0.55, len: 200, side: 1, gap: 16, density: 0.8, phase: 2 });
      for (let s = 0; s < L; s += L / 5) if (cornerS[idx(s)] > 0.6) env.brakingZones.push(s);
    }
    if (!env.brakingZones.length) env.brakingZones = [L * 0.2, L * 0.5, L * 0.95];
    // resolve each stand onto the side that actually has room
    for (const sp of stands) {
      const mid = track.sampleS(sp.s0 + sp.len / 2);
      const lat = env.barrierLat(sp.s0 + sp.len / 2, sp.side) + sp.gap + 16;
      const pa = mid.point.clone().addScaledVector(mid.right, sp.side * lat);
      const pb = mid.point.clone().addScaledVector(mid.right, -sp.side * lat);
      if (field.distance(pa.x, pa.z) < 45 && field.distance(pb.x, pb.z) > field.distance(pa.x, pa.z)) {
        sp.side = -sp.side;
      }
      sp.lateralOf = (s) => env.barrierLat(s, sp.side) + sp.gap;
    }
    this._stands = stands.map((s) => [((s.s0 % L) + L) % L, s.len]);

    // ---- build -------------------------------------------------------------
    const stats = {};
    desert.build({ size: 6400, segments: 188, cx: field.cx ?? 0, cz: field.cz ?? 0 });
    this.stars = buildStars(env);
    stats.masts = buildMasts(env);
    stats.trackside = buildTrackside(env);

    const gs = buildGrandstands(env, stands);
    stats.people = gs.people;
    this.flashes = gs.flashes;

    const pitLat = (() => {
      let m = 0;
      for (let s = pitFrom; s <= pitTo; s += 20) m = Math.max(m, env.barrierLat(s, pitSide));
      return m + 19.5;
    })();
    buildPitComplex(env, {
      pit: { s0: pitFrom + 30, bays: 24, side: pitSide, lat: pitLat },
      tower: { s: pitFrom - 40, side: pitSide, lat: pitLat + 46, yaw: 0.10 },
      gantries: [
        { s: 0, height: 9.6, startLights: true },
        { s: (turns ? turns[0].s : L * 0.2) - 420, height: 9.0, startLights: false },
        { s: L * 0.62, height: 9.0, startLights: false },
      ],
      paddock: { s0: pitFrom, len: 900, lat: pitLat + 62, side: pitSide, count: 30 },
    });
    buildBridges(env, [{ s: L * 0.27 }, { s: L * 0.84 }]);

    // ---- report ------------------------------------------------------------
    let meshes = 0, tris = 0;
    group.traverse((o) => {
      if (!o.isMesh && !o.isPoints) return;
      meshes++;
      const g = o.geometry;
      const n = g?.index ? g.index.count / 3 : (g?.attributes?.position?.count ?? 0) / 3;
      tris += n * (o.isInstancedMesh ? o.count : 1);
    });
    console.log(`[env] ${meshes} draw objects, ${(tris / 1000).toFixed(0)}k tris, `
      + `${stats.masts.poles} poles / ${stats.masts.lamps} luminaires, `
      + `${stats.people} spectators, ${stats.trackside.armco} armco, `
      + `${stats.trackside.boards} hoardings, ${stats.trackside.fence} fence panels `
      + `— built in ${(performance.now() - t0).toFixed(0)} ms`);

    this._pending = false;
    return true;
  }

  /** Is this lap distance covered by a grandstand? (drives catch-fence density) */
  _standRange(s) {
    const L = this.ctx.get('track')?.length ?? 1;
    const w = ((s % L) + L) % L;
    if (!this._stands) return false;
    for (const [s0, len] of this._stands) {
      const d = ((w - s0) % L + L) % L;
      if (d < len + 60) return true;
    }
    return false;
  }

  /* ----------------------------------------------------------------- update */

  update(dt) {
    if (this._pending) {
      // TRACK may still have been mid-build when we first ran; retry a few times.
      if (++this._attempts % 30 === 0 && this._attempts < 400) {
        if (this.#build()) this._pending = false;
      }
      return;
    }
    if (!this.group) return;
    this._t += dt;

    const cam = this.ctx.camera;
    // whole-chunk distance culling; frustum culling then handles the rest
    for (let i = 0; i < this.chunkGroups.length; i++) {
      const c = this.chunkCentres[i];
      const dx = cam.position.x - c.x, dz = cam.position.z - c.z;
      this.chunkGroups[i].visible = (dx * dx + dz * dz) < CULL * CULL;
    }

    // the star shell rides with the camera so it never clips the far plane
    if (this.stars) this.stars.position.set(cam.position.x, 0, cam.position.z);

    // camera flashes in the crowd
    const f = this.flashes;
    if (f) {
      const a = f.geometry.attributes.alpha;
      const arr = a.array;
      const n = arr.length;
      for (let k = 0; k < n; k++) {
        if (arr[k] > 0) arr[k] = Math.max(0, arr[k] - dt * 7.5);
      }
      const pops = Math.min(24, Math.max(1, Math.round(n * dt * 0.55)));
      for (let k = 0; k < pops; k++) arr[(Math.random() * n) | 0] = 1;
      a.needsUpdate = true;
    }
  }
}
