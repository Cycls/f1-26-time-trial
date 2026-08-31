/**
 * Track map. Owner: UI.
 * Canvas-2D top-down outline of the circuit built from track.sampleS(), with sector splits
 * coloured by the driver's current sector times, the Straight Line Mode zones, the
 * start/finish line, the car and (when the game publishes one) the ghost.
 */

const COL = {
  base: 'rgba(255,255,255,0.16)',
  edge: 'rgba(0,0,0,0.6)',
  none: '#7f8794',
  purple: '#A425BD',
  green: '#06BC06',
  yellow: '#EAC205',
  zone: 'rgba(18,165,255,0.8)',
  zoneOn: '#5cd8ff',
};

export class TrackMap {
  constructor(canvas, track, zones) {
    this.cv = canvas;
    this.g = canvas.getContext('2d');
    this.track = track;
    this.zones = zones || [];
    this.N = 480;
    this.ready = false;
    this.w = 0; this.h = 0;
    try { this.#build(); this.ready = true; } catch (e) { console.warn('[hud] map build failed', e); }
  }

  #build() {
    const L = this.track.length, N = this.N;
    const raw = [], tan = [];
    for (let i = 0; i < N; i++) {
      const t = this.track.sampleS((i / N) * L);
      raw.push([t.point.x, t.point.z]);
      tan.push([t.tangent.x, t.tangent.z]);
    }

    // Orient the map so the longest Straight Line zone (the main straight) runs left->right,
    // the way a circuit map is drawn, rather than along raw world axes.
    let ang = 0;
    const longest = this.zones.slice().sort((a, b) => b.length - a.length)[0];
    if (longest) {
      const i = Math.round((((longest.start + longest.length * 0.5) % L) / L) * N) % N;
      ang = -Math.atan2(tan[i][1], tan[i][0]);
    }
    this.ca = Math.cos(ang);
    this.sa = Math.sin(ang);

    this.pts = raw.map((p) => this.rot(p));
    this.tan = tan.map((p) => this.rot(p));

    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const p of this.pts) {
      if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0];
      if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1];
    }
    this.bounds = { minx, maxx, miny, maxy, w: maxx - minx || 1, h: maxy - miny || 1 };

    // sectorS holds the *end* distance of each sector.
    const ss = this.track.sectorS || [L / 3, (2 * L) / 3, L];
    this.secIdx = ss.map((s) => Math.round(((s % L) / L) * N) % N);
  }

  rot(v) {
    return [v[0] * this.ca - v[1] * this.sa, v[0] * this.sa + v[1] * this.ca];
  }

  /** Pick up the CSS box size; false when the element has not been laid out yet. */
  sync() {
    const r = this.cv.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(8, Math.round(r.width * dpr));
    const h = Math.max(8, Math.round(r.height * dpr));
    if (w !== this.cv.width || h !== this.cv.height) { this.cv.width = w; this.cv.height = h; }
    this.w = w; this.h = h;
    const b = this.bounds;
    const pad = Math.max(6, Math.min(w, h) * 0.10);
    this.sc = Math.min((w - pad * 2) / b.w, (h - pad * 2) / b.h);
    this.ox = (w - b.w * this.sc) / 2 - b.minx * this.sc;
    this.oy = (h - b.h * this.sc) / 2 - b.miny * this.sc;
    this.lw = Math.max(2.2, Math.min(w, h) * 0.037);
    return true;
  }

  #px(p) { return [this.ox + p[0] * this.sc, this.oy + p[1] * this.sc]; }

  #path(from, to) {
    const g = this.g, N = this.N;
    g.beginPath();
    const n = ((to - from) % N + N) % N;
    for (let i = 0; i <= n; i++) {
      const [x, y] = this.#px(this.pts[(from + i) % N]);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
  }

  #tick(idx, colour, scale = 1, wide = 0.34) {
    const g = this.g, N = this.N;
    const p = this.#px(this.pts[idx % N]);
    const t = this.tan[idx % N];
    const nx = -t[1], ny = t[0];
    const r = this.lw * 0.95 * scale;
    g.strokeStyle = colour;
    g.lineWidth = Math.max(1.4, this.lw * wide);
    g.lineCap = 'butt';
    g.beginPath();
    g.moveTo(p[0] - nx * r, p[1] - ny * r);
    g.lineTo(p[0] + nx * r, p[1] + ny * r);
    g.stroke();
    g.lineCap = 'round';
  }

  /**
   * @param {object} o {s, carPos:[x,z], heading:[x,z], sectorColours, activeSector,
   *                    zoneActive, ghost:{active,s}, tint}
   */
  draw(o) {
    if (!this.ready || !this.sync()) return;
    const g = this.g, N = this.N, L = this.track.length;
    g.clearRect(0, 0, this.w, this.h);
    g.lineJoin = 'round';
    g.lineCap = 'round';

    // dark casing so the outline reads over a brightly lit track
    this.#path(0, N);
    g.closePath();
    g.strokeStyle = COL.edge;
    g.lineWidth = this.lw + Math.max(2, this.lw * 0.6);
    g.stroke();

    g.strokeStyle = COL.base;
    g.lineWidth = this.lw;
    g.stroke();

    // sector arcs tinted by the driver's sector colours
    const cols = o.sectorColours || ['', '', ''];
    const ends = this.secIdx;
    const starts = [ends[2] % N, ends[0] % N, ends[1] % N];
    for (let i = 0; i < 3; i++) {
      const c = COL[cols[i]] || COL.none;
      this.#path(starts[i], ends[i]);
      g.strokeStyle = c;
      g.globalAlpha = cols[i] ? 0.82 : 0.36;
      g.lineWidth = this.lw * (i === o.activeSector ? 0.80 : 0.58);
      g.stroke();
      g.globalAlpha = 1;
    }

    // Straight Line Mode zones
    for (const z of this.zones) {
      const a = Math.round((z.start / L) * N) % N;
      const b = Math.round((((z.start + z.length) % L) / L) * N) % N;
      this.#path(a, b);
      const on = o.zoneActive === z;
      g.strokeStyle = on ? COL.zoneOn : COL.zone;
      g.lineWidth = this.lw * (on ? 0.6 : 0.38);
      g.globalAlpha = on ? 1 : 0.75;
      g.stroke();
      g.globalAlpha = 1;
    }

    this.#tick(ends[0], 'rgba(255,255,255,0.5)');
    this.#tick(ends[1], 'rgba(255,255,255,0.5)');
    this.#tick(0, '#ffffff', 1.3, 0.42);

    if (o.ghost && o.ghost.active) {
      const gi = Math.round(((((o.ghost.s % L) + L) % L) / L) * N) % N;
      const p = this.#px(this.pts[gi]);
      g.beginPath();
      g.arc(p[0], p[1], this.lw * 0.55, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,255,255,0.85)';
      g.lineWidth = Math.max(1.2, this.lw * 0.24);
      g.stroke();
    }

    // car chevron
    const si = Math.round(((((o.s || 0) % L) + L) % L / L) * N) % N;
    let cp = null;
    if (o.carPos) {
      const q = this.#px(this.rot(o.carPos));
      if (isFinite(q[0]) && isFinite(q[1])) cp = q;
    }
    if (!cp) cp = this.#px(this.pts[si]);
    const hd = o.heading ? this.rot(o.heading) : this.tan[si];
    const ang = Math.atan2(hd[1], hd[0]);
    const r = Math.max(3.4, this.lw * 0.95);

    g.save();
    g.translate(cp[0], cp[1]);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(r * 1.3, 0);
    g.lineTo(-r * 0.9, r * 0.85);
    g.lineTo(-r * 0.42, 0);
    g.lineTo(-r * 0.9, -r * 0.85);
    g.closePath();
    g.strokeStyle = 'rgba(0,0,0,0.8)';
    g.lineWidth = Math.max(1, r * 0.3);
    g.stroke();
    g.fillStyle = o.tint || '#ffffff';
    g.fill();
    g.restore();
  }
}
