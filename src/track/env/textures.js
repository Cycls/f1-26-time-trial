/**
 * Procedural canvas textures for the environment. Owner: ENVIRONMENT.
 * No network assets — everything is drawn into a 2D canvas at load.
 */
import * as THREE from 'three';
import { makeRng, rr, ri } from './util.js';

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(canvas, repeat = [1, 1], opts = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = opts.aniso ?? 8;
  t.colorSpace = opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  if (opts.nearest) { t.magFilter = THREE.NearestFilter; }
  t.needsUpdate = true;
  return t;
}

const cache = new Map();
const memo = (k, f) => { if (!cache.has(k)) cache.set(k, f()); return cache.get(k); };

/* ----------------------------------------------------------------- sand */

export function sandTexture() {
  return memo('sand', () => {
    const S = 512, c = cv(S, S), x = c.getContext('2d');
    x.fillStyle = '#b09068'; x.fillRect(0, 0, S, S);
    const r = makeRng(4242);
    // wind ripples
    for (let i = 0; i < 260; i++) {
      x.strokeStyle = `rgba(${ri(r, 150, 200)},${ri(r, 125, 165)},${ri(r, 90, 125)},0.30)`;
      x.lineWidth = rr(r, 0.6, 2.4);
      x.beginPath();
      const y0 = r() * S, amp = rr(r, 3, 16), ph = r() * 6.28;
      x.moveTo(0, y0);
      for (let px = 0; px <= S; px += 16) x.lineTo(px, y0 + Math.sin(px * 0.02 + ph) * amp);
      x.stroke();
    }
    // grain
    const img = x.getImageData(0, 0, S, S), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * 34;
      d[i] += n; d[i + 1] += n * 0.9; d[i + 2] += n * 0.7;
    }
    x.putImageData(img, 0, 0);
    return tex(c, [90, 90]);
  });
}

/* --------------------------------------------------------- catch fencing */

/** Diamond debris-fence weave. Alpha-tested; mips make it fade out at distance like the real thing. */
export function fenceTexture() {
  return memo('fence', () => {
    const S = 256, c = cv(S, S), x = c.getContext('2d');
    x.clearRect(0, 0, S, S);
    x.strokeStyle = '#c8ccd2'; x.lineWidth = 2.6; x.lineCap = 'square';
    const p = 32;
    for (let i = -S; i < S * 2; i += p) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i + S, S); x.stroke();
      x.beginPath(); x.moveTo(i, S); x.lineTo(i + S, 0); x.stroke();
    }
    return tex(c, [1, 1], { aniso: 8 });
  });
}

/* ---------------------------------------------------------------- crowd */

/** 4-cell atlas of spectator silhouettes (standing / seated / arms up / with flag). */
export function crowdAtlas() {
  return memo('crowd', () => {
    const CW = 64, CH = 128, c = cv(CW * 4, CH), x = c.getContext('2d');
    x.clearRect(0, 0, CW * 4, CH);
    const body = (ox, pose) => {
      x.save(); x.translate(ox, 0);
      x.fillStyle = '#ffffff';
      // head
      x.beginPath(); x.arc(32, 26, 12, 0, 6.2832); x.fill();
      // torso
      x.beginPath();
      x.moveTo(18, 44); x.lineTo(46, 44); x.lineTo(50, 96); x.lineTo(14, 96); x.closePath(); x.fill();
      // shoulders / arms
      if (pose === 2) {                       // arms up
        x.beginPath(); x.moveTo(18, 46); x.lineTo(6, 8); x.lineTo(14, 4); x.lineTo(26, 44); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(46, 46); x.lineTo(58, 8); x.lineTo(50, 4); x.lineTo(38, 44); x.closePath(); x.fill();
      } else if (pose === 3) {                // one arm up holding a flag
        x.beginPath(); x.moveTo(46, 46); x.lineTo(56, 10); x.lineTo(49, 6); x.lineTo(38, 44); x.closePath(); x.fill();
        x.fillRect(50, 0, 3, 40);
        x.beginPath(); x.moveTo(53, 2); x.lineTo(64, 8); x.lineTo(53, 16); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(18, 46); x.lineTo(10, 78); x.lineTo(18, 80); x.lineTo(26, 50); x.closePath(); x.fill();
      } else {
        x.beginPath(); x.moveTo(18, 46); x.lineTo(8, 82); x.lineTo(16, 84); x.lineTo(26, 50); x.closePath(); x.fill();
        x.beginPath(); x.moveTo(46, 46); x.lineTo(56, 82); x.lineTo(48, 84); x.lineTo(38, 50); x.closePath(); x.fill();
      }
      // legs (mostly hidden by the row in front, so keep them stubby)
      x.fillRect(18, 94, 12, 30);
      x.fillRect(34, 94, 12, 30);
      if (pose === 1) { x.clearRect(0, 104, CW, CH - 104); }   // seated
      x.restore();
    };
    for (let i = 0; i < 4; i++) body(i * CW, i);
    const t = tex(c, [1, 1]);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/* -------------------------------------------------------------- sponsors */

const SPONSORS = [
  { t: 'GULF AIR', bg: '#0d3b66', fg: '#f4d35e', sub: 'BAHRAIN GRAND PRIX' },
  { t: 'ARAMCO', bg: '#0a5c46', fg: '#eafff6', sub: 'OFFICIAL PARTNER' },
  { t: 'BATELCO', bg: '#5b1030', fg: '#ffd7e6', sub: 'CONNECTED' },
  { t: 'SAKHIR', bg: '#111418', fg: '#e9edf2', sub: 'DESERT NIGHTS' },
  { t: 'ALBA', bg: '#1c2a5e', fg: '#cfe0ff', sub: 'ALUMINIUM BAHRAIN' },
  { t: 'F1 26', bg: '#8a0d18', fg: '#ffffff', sub: 'FORMULA 1' },
  { t: 'BAPCO', bg: '#123f2f', fg: '#a9f0cf', sub: 'ENERGIES' },
  { t: 'MUMTALAKAT', bg: '#2b2118', fg: '#f0d9b5', sub: 'KINGDOM OF BAHRAIN' },
];

/** 4x2 atlas of trackside advertising panels. Doubles as its own emissive map. */
export function sponsorAtlas() {
  return memo('sponsor', () => {
    const CW = 512, CH = 128, c = cv(CW * 4, CH * 2), x = c.getContext('2d');
    SPONSORS.forEach((s, i) => {
      const ox = (i % 4) * CW, oy = Math.floor(i / 4) * CH;
      x.fillStyle = s.bg; x.fillRect(ox, oy, CW, CH);
      // subtle panel sheen
      const g = x.createLinearGradient(ox, oy, ox, oy + CH);
      g.addColorStop(0, 'rgba(255,255,255,0.13)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.0)');
      g.addColorStop(1, 'rgba(0,0,0,0.22)');
      x.fillStyle = g; x.fillRect(ox, oy, CW, CH);
      x.fillStyle = s.fg;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = 'bold 62px system-ui, Arial, sans-serif';
      x.fillText(s.t, ox + CW / 2, oy + CH * 0.42);
      x.font = '500 22px system-ui, Arial, sans-serif';
      x.globalAlpha = 0.75;
      x.fillText(s.sub, ox + CW / 2, oy + CH * 0.72);
      x.globalAlpha = 1;
      // chevron marks so repeated panels do not look identical at a glance
      x.fillStyle = s.fg; x.globalAlpha = 0.30;
      for (let k = 0; k < 6; k++) x.fillRect(ox + 8 + k * 11, oy + CH - 14, 6, 8);
      for (let k = 0; k < 6; k++) x.fillRect(ox + CW - 60 + k * 11, oy + 6, 6, 8);
      x.globalAlpha = 1;
      x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 4;
      x.strokeRect(ox + 2, oy + 2, CW - 4, CH - 4);
    });
    const t = tex(c, [1, 1]);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}
export const SPONSOR_COUNT = SPONSORS.length;

/** Big pit-building facia / grandstand banner strip. */
export function faciaTexture() {
  return memo('facia', () => {
    const W = 2048, H = 128, c = cv(W, H), x = c.getContext('2d');
    x.fillStyle = '#0a0d12'; x.fillRect(0, 0, W, H);
    const g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(1, 'rgba(0,0,0,0.4)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const words = ['BAHRAIN INTERNATIONAL CIRCUIT', 'GULF AIR', 'SAKHIR', 'F1 26', 'ARAMCO', 'BAHRAIN'];
    const cols = ['#e8ecf2', '#f4d35e', '#e8ecf2', '#ff2d3f', '#7ce0b4', '#e8ecf2'];
    for (let i = 0; i < 6; i++) {
      x.fillStyle = cols[i];
      x.font = 'bold 54px system-ui, Arial, sans-serif';
      x.fillText(words[i], (i + 0.5) * W / 6, H * 0.5);
    }
    return tex(c, [1, 1]);
  });
}

/* --------------------------------------------------------------- windows */

/** Lit office/paddock glazing — used as an unlit emissive panel. */
export function windowTexture(seed = 5, cols = 16, rows = 8, warm = true) {
  return memo('win' + seed + cols + rows + warm, () => {
    const W = 256, H = 128, c = cv(W, H), x = c.getContext('2d');
    x.fillStyle = '#05070b'; x.fillRect(0, 0, W, H);
    const r = makeRng(seed * 7919);
    const cw = W / cols, ch = H / rows;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const on = r();
        if (on < 0.30) continue;
        const b = 0.35 + r() * 0.65;
        const col = warm
          ? `rgba(${Math.round(255 * b)},${Math.round(214 * b)},${Math.round(150 * b)},1)`
          : `rgba(${Math.round(198 * b)},${Math.round(220 * b)},${Math.round(255 * b)},1)`;
        x.fillStyle = col;
        x.fillRect(i * cw + cw * 0.12, j * ch + ch * 0.16, cw * 0.76, ch * 0.62);
      }
    }
    return tex(c, [1, 1]);
  });
}

/* ---------------------------------------------------------- brake markers */

/** 300 / 200 / 100 / 50 m braking-distance boards, 4-cell atlas. */
export function markerTexture() {
  return memo('marker', () => {
    const CW = 128, CH = 96, c = cv(CW * 4, CH), x = c.getContext('2d');
    const labels = ['300', '200', '100', '50'];
    const bg = ['#1b4d1f', '#1b4d1f', '#6d1414', '#6d1414'];
    for (let i = 0; i < 4; i++) {
      const ox = i * CW;
      x.fillStyle = bg[i]; x.fillRect(ox + 4, 4, CW - 8, CH - 8);
      x.strokeStyle = '#f2f4f6'; x.lineWidth = 5;
      x.strokeRect(ox + 8, 8, CW - 16, CH - 16);
      x.fillStyle = '#f6f8fa';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.font = 'bold 58px system-ui, Arial, sans-serif';
      x.fillText(labels[i], ox + CW / 2, CH / 2 + 3);
    }
    const t = tex(c, [1, 1]);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/* ----------------------------------------------------------- point sprite */

export function glowSprite(inner = 'rgba(255,252,240,1)', mid = 'rgba(200,215,255,0.42)') {
  return memo('glow' + inner + mid, () => {
    const S = 128, c = cv(S, S), x = c.getContext('2d');
    const g = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, inner);
    g.addColorStop(0.10, inner);
    g.addColorStop(0.26, mid);
    g.addColorStop(1.00, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    const t = tex(c, [1, 1]);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

/* ---------------------------------------------------------------- palms */

export function palmFrond() {
  return memo('frond', () => {
    const W = 128, H = 64, c = cv(W, H), x = c.getContext('2d');
    x.clearRect(0, 0, W, H);
    x.strokeStyle = '#4a5a2c'; x.lineWidth = 3;
    x.beginPath(); x.moveTo(2, H / 2); x.quadraticCurveTo(W * 0.6, H * 0.30, W - 4, H * 0.34); x.stroke();
    x.strokeStyle = '#5d7036'; x.lineWidth = 2.2;
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const px = 2 + t * (W - 8);
      const py = H / 2 + (H * 0.30 - H / 2) * (2 * t - t * t);
      const len = 20 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 4;
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + len * 0.35, py + len); x.stroke();
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + len * 0.35, py - len); x.stroke();
    }
    const t2 = tex(c, [1, 1]);
    t2.wrapS = t2.wrapT = THREE.ClampToEdgeWrapping;
    return t2;
  });
}

export function disposeTextures() { for (const [, t] of cache) t.dispose?.(); cache.clear(); }
