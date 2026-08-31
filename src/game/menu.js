/**
 * Time Trial front end: session menu + settings. Owner: GAME.
 *
 * The HUD is owned by another module, so this deliberately lives in its own root
 * (#tt-menu) with its own styles and only appears in the 'menu' phase or when the
 * driver opens settings. If the HUD module ever wants to own the menu it can set
 * window.__HUD_OWNS_MENU = true before GAME.init() and this stays silent — all the
 * same state is on state.lap.* / state.input.* either way (see docs/REQUESTS.md).
 */
import { ASSIST_OPTIONS, ASSIST_LABELS } from '../input/assists.js';
import { OVERLAY_MODES, OVERLAY_LABELS } from './overlay.js';
import { CURVE_LIMITS, curvePoints } from '../input/curves.js';

const TABS = [
  ['session', 'Session'], ['assists', 'Assists'], ['ghost', 'Ghost'],
  ['controls', 'Controls'], ['rules', 'Rules'],
];

const CSS = `
#tt-menu{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;
  font-family:"Formula1","Segoe UI",system-ui,sans-serif;color:#fff;
  background:radial-gradient(120% 90% at 50% 0%,rgba(18,2,4,.72),rgba(0,0,0,.90));
  backdrop-filter:blur(7px) saturate(.85);-webkit-backdrop-filter:blur(7px) saturate(.85);}
#tt-menu.open{display:flex;}
#tt-menu .panel{width:min(860px,88vw);max-height:88vh;display:flex;flex-direction:column;
  background:linear-gradient(180deg,rgba(20,20,24,.93),rgba(9,9,11,.96));
  border:1px solid rgba(255,255,255,.10);border-radius:6px;overflow:hidden;
  box-shadow:0 40px 120px rgba(0,0,0,.8),0 0 0 1px rgba(225,6,0,.18);}
#tt-menu header{padding:22px 28px 16px;border-bottom:1px solid rgba(255,255,255,.08);
  background:linear-gradient(90deg,rgba(225,6,0,.16),transparent 55%);}
#tt-menu .eyebrow{font-size:11px;letter-spacing:.34em;text-transform:uppercase;color:#e10600;font-weight:700;}
#tt-menu h1{margin:6px 0 4px;font-size:34px;font-weight:800;letter-spacing:-.02em;line-height:1;}
#tt-menu .sub{font-size:12px;letter-spacing:.13em;text-transform:uppercase;opacity:.55;}
#tt-menu .tabs{display:flex;gap:2px;padding:0 20px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.35);}
#tt-menu .tab{padding:11px 14px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;
  opacity:.45;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap;}
#tt-menu .tab:hover{opacity:.8;}
#tt-menu .tab.on{opacity:1;border-bottom-color:#e10600;}
#tt-menu .tab i{font-style:normal;opacity:.4;margin-right:6px;font-size:10px;}
#tt-menu .body{padding:14px 20px 18px;overflow-y:auto;}
#tt-menu .row{display:flex;align-items:center;gap:14px;padding:9px 12px;border-radius:4px;cursor:pointer;
  border-left:2px solid transparent;}
#tt-menu .row.sel{background:rgba(255,255,255,.07);border-left-color:#e10600;}
#tt-menu .row .lbl{flex:1;font-size:13px;letter-spacing:.03em;}
#tt-menu .row .hint{font-size:11px;opacity:.4;max-width:44%;text-align:right;line-height:1.35;}
#tt-menu .row .val{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:700;
  letter-spacing:.09em;text-transform:uppercase;color:#ffd93a;min-width:150px;justify-content:flex-end;}
#tt-menu .row .arrow{opacity:.35;font-size:10px;padding:0 3px;}
#tt-menu .row.sel .arrow{opacity:.9;}
#tt-menu .row.action .lbl{font-weight:700;letter-spacing:.14em;text-transform:uppercase;font-size:13px;}
#tt-menu .row.action.primary{background:rgba(225,6,0,.16);}
#tt-menu .row.action.primary.sel{background:rgba(225,6,0,.34);}
#tt-menu .row.info{cursor:default;}
#tt-menu .row.info .val{color:#fff;opacity:.85;}
#tt-menu .note{font-size:11.5px;line-height:1.6;opacity:.5;padding:8px 12px 2px;}
#tt-menu .sect{font-size:10px;letter-spacing:.26em;text-transform:uppercase;opacity:.35;
  padding:16px 12px 6px;font-weight:700;}
#tt-menu table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:12.5px;}
#tt-menu td{padding:6px 12px;border-bottom:1px solid rgba(255,255,255,.05);}
#tt-menu td.pos{opacity:.4;width:28px;}
#tt-menu td.t{font-weight:700;}
#tt-menu td.meta{opacity:.4;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.08em;}
#tt-menu tr.pb td.t{color:#d63aff;}
#tt-menu footer{padding:11px 24px;border-top:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.4);
  font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;opacity:.4;display:flex;gap:20px;flex-wrap:wrap;}
#tt-menu .curve{display:block;margin:6px 12px 0;}
#tt-menu .empty{opacity:.35;font-size:12px;padding:10px 12px;}
#tt-toast{position:fixed;left:50%;top:16%;transform:translateX(-50%);z-index:55;pointer-events:none;
  font-family:"Formula1","Segoe UI",system-ui,sans-serif;text-align:center;opacity:0;transition:opacity .18s;}
#tt-toast.on{opacity:1;}
#tt-toast .t{font-size:13px;font-weight:800;letter-spacing:.22em;text-transform:uppercase;
  text-shadow:0 2px 22px #000;}
#tt-toast .d{font-size:11px;letter-spacing:.14em;text-transform:uppercase;opacity:.65;margin-top:4px;}
`;

export function fmtTime(t) {
  if (t == null || !isFinite(t)) return '--:--.---';
  const neg = t < 0; t = Math.abs(t);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${neg ? '-' : ''}${m}:${s.toFixed(3).padStart(6, '0')}`;
}
export function fmtSector(t) { return t == null || !isFinite(t) ? '--.---' : t.toFixed(3); }

export class TTMenu {
  constructor(ctx, game) {
    this.ctx = ctx; this.game = game; this.state = ctx.state;
    this.open = false; this.tab = 0; this.sel = 0;
    this.enabled = !window.__HUD_OWNS_MENU;
    this.root = null;
  }

  init() {
    if (!this.enabled) return;
    const style = document.createElement('style');
    style.id = 'tt-menu-css'; style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'tt-menu';
    this.root.innerHTML = `
      <div class="panel">
        <header>
          <div class="eyebrow">Formula 1 &middot; 2026 season</div>
          <h1>Time Trial</h1>
          <div class="sub">Bahrain International Circuit &middot; Night &middot; 5.412 km &middot; 15 turns</div>
        </header>
        <div class="tabs"></div>
        <div class="body"></div>
        <footer>
          <span>&uarr;&darr; select</span><span>&larr;&rarr; change</span><span>Enter confirm</span>
          <span>1-5 tabs</span><span>Esc close</span>
        </footer>
      </div>`;
    document.body.appendChild(this.root);
    this.tabsEl = this.root.querySelector('.tabs');
    this.bodyEl = this.root.querySelector('.body');
    this.tabsEl.innerHTML = TABS.map(([id, label], i) =>
      `<div class="tab" data-i="${i}"><i>${i + 1}</i>${label}</div>`).join('');
    this.tabsEl.addEventListener('click', (e) => {
      const t = e.target.closest('.tab'); if (!t) return;
      this.tab = +t.dataset.i; this.sel = 0; this.render();
    });

    this.toast = document.createElement('div');
    this.toast.id = 'tt-toast';
    this.toast.innerHTML = '<div class="t"></div><div class="d"></div>';
    document.body.appendChild(this.toast);

    addEventListener('keydown', (e) => this.#key(e), true);
    this.render();
  }

  // ------------------------------------------------------------------- rows --
  #rows() {
    const g = this.game, inp = this.ctx.get('input');
    const A = inp?.assists;
    const L = this.state.lap;
    const opt = (label, key, hint) => ({
      kind: 'option', label, hint,
      get: () => ASSIST_LABELS[key][A?.settings?.[key]] ?? '--',
      step: (d) => inp?.cycleAssist(key, d),
    });
    switch (TABS[this.tab][0]) {
      case 'session': return [
        { kind: 'action', primary: true, label: L.phase === 'menu' ? 'Start session' : 'Resume', run: () => g.startSession() },
        { kind: 'action', label: 'Restart out-lap', hint: 'R', run: () => g.retry() },
        { kind: 'action', label: 'Clear leaderboard and ghost', run: () => g.clearRecords() },
        { kind: 'board' },
      ];
      case 'assists': return [
        opt('Traction control', 'tc', 'Full clamps rear slip hard; Medium lets the car rotate on exit.'),
        opt('Anti-lock brakes', 'abs', 'Modulates brake pressure when a wheel starts to lock.'),
        opt('Racing line', 'racingLine', 'Green flat, amber at the cornering limit, red braking.'),
        opt('Braking assist', 'brakingAssist', 'Brakes for you into a corner. Needs the racing line data.'),
        opt('Steering assist', 'steeringAssist', 'Pure-pursuit nudge toward the line. The driver always out-votes it.'),
        opt('Gearbox', 'gearbox', 'Manual uses E / Q or the shoulder buttons. 8 forward gears.'),
        { kind: 'note', text: 'Assists shape your input; they never change the car. Everyone drives the same equalised 2026 car in Time Trial.' },
      ];
      case 'ghost': return [
        { kind: 'option', label: 'Personal best ghost', hint: 'A replay of your own best lap. No collision.',
          get: () => (g.ghostEnabled ? 'On' : 'Off'), step: () => g.setGhostEnabled(!g.ghostEnabled) },
        { kind: 'option', label: 'Rival ghost', hint: 'No rival trace is shipped with this build.',
          get: () => 'Off', step: () => {} },
        { kind: 'option', label: 'Telemetry overlay', hint: 'Brakes only draws just the ghost braking phases: where the fast lap actually brakes.',
          get: () => OVERLAY_LABELS[g.overlay?.mode] ?? 'Off',
          step: (d) => g.setOverlayMode(OVERLAY_MODES[(OVERLAY_MODES.indexOf(g.overlay.mode) + d + 3) % 3]) },
        { kind: 'info', label: 'Ghost lap on record', get: () => (g.pbGhost ? fmtTime(g.pbGhost.time) : 'none yet') },
        { kind: 'info', label: 'Ghost samples', get: () => (g.pbGhost ? `${g.pbGhost.count} @ 30 Hz` : '--') },
        { kind: 'note', text: 'The delta is continuous, not sector-only: the ghost time is interpolated at your exact track distance every frame. Green means you are ahead.' },
      ];
      case 'controls': {
        const rows = [];
        for (const [axis, keys] of [['steer', ['rate', 'deadzone', 'linearity', 'saturation']],
          ['throttle', ['linearity']], ['brake', ['linearity']]]) {
          rows.push({ kind: 'sect', text: axis === 'steer' ? 'Steering' : axis });
          for (const k of keys) {
            rows.push({
              kind: 'option', label: k[0].toUpperCase() + k.slice(1),
              get: () => `${inp?.curves?.[axis]?.[k] ?? 0}${k === 'rate' ? '%' : ''}`,
              step: (d) => inp?.nudgeCurve(axis, k, d),
              hint: k === 'linearity' ? '50 is linear; lower is softer around neutral' : undefined,
            });
          }
          if (axis === 'steer') rows.push({ kind: 'curve', axis: 'steer' });
        }
        rows.push({ kind: 'sect', text: 'Feedback' });
        rows.push({
          kind: 'option', label: 'Vibration', hint: 'Slip, kerbs, off-track texture, steering damper.',
          get: () => `${Math.round((inp?.haptics?.strength ?? 0) * 100)}%`,
          step: (d) => { if (inp) { inp.haptics.strength = Math.max(0, Math.min(1, inp.haptics.strength + d * 0.1)); inp.saveSettings(); } },
        });
        rows.push({ kind: 'action', label: 'Reset to reference values', run: () => inp?.resetSettings() });
        rows.push({ kind: 'note', text: 'Reference pad values: steering rate 140%, deadzone 0, linearity 40, saturation 10; throttle linearity 50; brake linearity 35. Steering lock is 360 degrees total.' });
        return rows;
      }
      default: return [
        { kind: 'info', label: 'Damage', get: () => 'Off' },
        { kind: 'info', label: 'Tyre wear', get: () => 'Off' },
        { kind: 'info', label: 'Tyre temperature', get: () => 'Off — permanently ideal' },
        { kind: 'info', label: 'Fuel', get: () => 'Not modelled' },
        { kind: 'info', label: 'Weather', get: () => 'Fixed — ideal, night' },
        { kind: 'info', label: 'Car performance', get: () => 'Equalised' },
        { kind: 'info', label: 'ERS', get: () => 'Automatic — fixed for the lap' },
        { kind: 'info', label: 'Track limits', get: () => 'All four wheels past the line = deleted' },
        { kind: 'note', text: 'ERS deployment is not driver-controlled in Time Trial. That is a deliberate design choice so you can concentrate on your racing line, and no control here can deploy it.' },
        { kind: 'note', text: 'A lap is deleted the instant all four wheels are fully beyond the white line. A sliver of tyre still on the line is legal. If the excursion gained you time, the next lap is deleted as well.' },
      ];
    }
  }

  #selectable(rows) { return rows.map((r, i) => [r, i]).filter(([r]) => r.kind === 'option' || r.kind === 'action'); }

  render() {
    if (!this.root) return;
    const rows = this.rows = this.#rows();
    const sel = this.#selectable(rows);
    if (!sel.length) this.sel = 0;
    else this.sel = Math.max(0, Math.min(this.sel, sel.length - 1));
    const selIdx = sel[this.sel]?.[1] ?? -1;
    for (const t of this.tabsEl.children) t.classList.toggle('on', +t.dataset.i === this.tab);

    const html = rows.map((r, i) => {
      const on = i === selIdx ? ' sel' : '';
      const hint = r.hint ? `<div class="hint">${r.hint}</div>` : '';
      switch (r.kind) {
        case 'sect': return `<div class="sect">${r.text}</div>`;
        case 'note': return `<div class="note">${r.text}</div>`;
        case 'curve': return this.#curveSvg(r.axis);
        case 'board': return this.#board();
        case 'info': return `<div class="row info"><div class="lbl">${r.label}</div>${hint}<div class="val">${r.get()}</div></div>`;
        case 'action': return `<div class="row action${r.primary ? ' primary' : ''}${on}" data-i="${i}">
            <div class="lbl">${r.label}</div>${hint}<div class="val">${r.hint && r.hint.length < 4 ? '' : ''}&#9654;</div></div>`;
        default: return `<div class="row${on}" data-i="${i}">
            <div class="lbl">${r.label}</div>${hint}
            <div class="val"><span class="arrow" data-d="-1">&#9664;</span>${r.get()}<span class="arrow" data-d="1">&#9654;</span></div>
          </div>`;
      }
    }).join('');
    this.bodyEl.innerHTML = html;
    this.bodyEl.onclick = (e) => {
      const row = e.target.closest('.row[data-i]'); if (!row) return;
      const i = +row.dataset.i, r = rows[i];
      this.sel = sel.findIndex(([, idx]) => idx === i);
      if (r.kind === 'action') r.run?.();
      else r.step?.(e.target.classList.contains('arrow') ? +e.target.dataset.d : 1);
      this.render();
    };
  }

  #curveSvg(axis) {
    const inp = this.ctx.get('input');
    const c = inp?.curves?.[axis]; if (!c) return '';
    const pts = curvePoints(c, 40).map(([x, y]) => `${(x * 180).toFixed(1)},${(56 - y * 52).toFixed(1)}`).join(' ');
    return `<svg class="curve" width="188" height="60" viewBox="0 0 188 60">
      <rect x="0" y="2" width="182" height="54" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.09)"/>
      <line x1="0" y1="56" x2="180" y2="4" stroke="rgba(255,255,255,.14)" stroke-dasharray="3 3"/>
      <polyline points="${pts}" fill="none" stroke="#e10600" stroke-width="2"/>
    </svg>`;
  }

  #board() {
    const rows = this.game.leaderboard.top(8);
    if (!rows.length) return '<div class="empty">No laps recorded yet. Set one.</div>';
    return `<div class="sect">Leaderboard</div><table>${rows.map((e, i) => {
      const a = e.assists;
      const meta = a ? `TC ${ASSIST_LABELS.tc[a.tc]} &middot; ABS ${ASSIST_LABELS.abs[a.abs]} &middot; ${ASSIST_LABELS.gearbox[a.gearbox]}` : '';
      return `<tr class="${i === 0 ? 'pb' : ''}"><td class="pos">${i + 1}</td>
        <td class="t">${fmtTime(e.time)}</td><td class="meta">${meta}</td></tr>`;
    }).join('')}</table>`;
  }

  // ------------------------------------------------------------------- input --
  #key(e) {
    if (!this.open) return;
    const rows = this.rows ?? [];
    const sel = this.#selectable(rows);
    const cur = sel[this.sel]?.[0];
    let used = true;
    switch (e.code) {
      case 'ArrowDown': this.sel = sel.length ? (this.sel + 1) % sel.length : 0; break;
      case 'ArrowUp': this.sel = sel.length ? (this.sel - 1 + sel.length) % sel.length : 0; break;
      case 'ArrowLeft': cur?.step?.(-1); break;
      case 'ArrowRight': cur?.step?.(1); break;
      case 'Enter': case 'NumpadEnter':
        if (cur?.kind === 'action') cur.run?.(); else if (cur?.step) cur.step(1);
        else this.game.startSession();
        break;
      case 'Space': if (cur?.kind === 'action') cur.run?.(); else this.game.startSession(); break;
      case 'Escape': case 'Tab': this.game.closeMenu(); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4': case 'Digit5':
        this.tab = Math.min(TABS.length - 1, +e.code.slice(5) - 1); this.sel = 0; break;
      default: used = false;
    }
    if (used) { e.preventDefault(); e.stopPropagation(); this.render(); }
  }

  setOpen(v, tab = null) {
    this.open = !!v && this.enabled;
    if (tab != null) { this.tab = TABS.findIndex(([id]) => id === tab); if (this.tab < 0) this.tab = 0; this.sel = 0; }
    if (!this.root) return;
    this.root.classList.toggle('open', this.open);
    if (this.open) this.render();
  }

  showToast(title, detail, ms = 2600) {
    if (!this.toast) return;
    this.toast.querySelector('.t').innerHTML = title;
    this.toast.querySelector('.d').innerHTML = detail ?? '';
    this.toast.classList.add('on');
    clearTimeout(this._tt);
    this._tt = setTimeout(() => this.toast.classList.remove('on'), ms);
  }

  refresh() { if (this.open) this.render(); }
}
