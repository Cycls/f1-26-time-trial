/**
 * Number/time formatting + a fixed-advance digit renderer. Owner: UI.
 *
 * Why the digit renderer exists: `font-variant-numeric: tabular-nums` only works if the
 * chosen font actually ships tnum figures. The HUD stack falls back through several system
 * faces, so instead of trusting the font we render every character into its own fixed-width
 * cell. A running lap timer then never reflows, whatever font resolved.
 */

const CELL = { ':': 'sep', '.': 'sep', '+': 'sgn', '-': 'sgn', ' ': 'spc' };

export function fmtLap(t) {
  if (t == null || !isFinite(t) || t < 0) return '-:--.---';
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return m + ':' + s.toFixed(3).padStart(6, '0');
}

export function fmtSector(t) {
  if (t == null || !isFinite(t) || t <= 0) return '--.---';
  if (t >= 60) {
    const m = Math.floor(t / 60);
    return m + ':' + (t - m * 60).toFixed(3).padStart(6, '0');
  }
  return t.toFixed(3).padStart(6, '0');
}

export function fmtDelta(d, digits = 3) {
  if (d == null || !isFinite(d)) return '--.---';
  const a = Math.min(Math.abs(d), 99.999);
  return (d < 0 ? '-' : '+') + a.toFixed(digits);
}

export function fmtGap(d) {
  if (d == null || !isFinite(d)) return '';
  return (d < 0 ? '-' : '+') + Math.abs(d).toFixed(3);
}

export function fmtMJ(x) {
  if (x == null || !isFinite(x)) return '0.0';
  return x.toFixed(1);
}

export function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

/** Frame-rate independent exponential approach. */
export function approach(cur, target, dt, tau) {
  if (!isFinite(cur)) return target;
  const k = 1 - Math.exp(-dt / Math.max(tau, 1e-4));
  return cur + (target - cur) * k;
}

/**
 * Renders a string into per-character cells inside `el`.
 * Only touches the DOM for characters that actually changed.
 */
export class Digits {
  constructor(el) {
    this.el = el;
    this.cells = [];
    this.cur = null;
  }

  set(str) {
    str = String(str);
    if (str === this.cur) return false;
    const n = str.length;
    while (this.cells.length < n) {
      const i = document.createElement('i');
      this.el.appendChild(i);
      this.cells.push(i);
    }
    while (this.cells.length > n) {
      const i = this.cells.pop();
      if (i.parentNode) i.parentNode.removeChild(i);
    }
    for (let i = 0; i < n; i++) {
      const ch = str[i], cell = this.cells[i];
      if (cell._ch === ch) continue;
      cell._ch = ch;
      cell.textContent = ch;
      const k = CELL[ch] || (ch >= '0' && ch <= '9' ? 'num' : 'chr');
      if (cell._k !== k) { cell.className = k; cell._k = k; }
    }
    this.cur = str;
    return true;
  }
}

/** textContent write with a cache so we never dirty the DOM for nothing. */
export function txt(el, v) {
  if (!el) return false;
  if (el._v === v) return false;
  el._v = v;
  el.textContent = v;
  return true;
}

/** Cached style write. */
export function sty(el, prop, v) {
  if (!el) return;
  const key = '_s_' + prop;
  if (el[key] === v) return;
  el[key] = v;
  el.style.setProperty(prop, v);
}
