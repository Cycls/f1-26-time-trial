/**
 * F1 26 — Time Trial HUD. Owner: UI.
 *
 * Layout and colours follow docs/reference-hud.md, which is measured from real in-game
 * frames rather than inferred:
 *   top-left      timing tower  (in Time Trial: the personal leaderboard)   0.020-0.185 x
 *   top-centre    race-control banner                                       0.30-0.70 x
 *   top-right     timing panel: sector pills, lap time, BEST, PREVIOUS, DELTA
 *   lower-left    "TRACK POSITION" circuit map                              y 0.658-0.933
 *   bottom-centre the F1 Dial: battery ring / rev strip + gear / speed ring
 *   bottom-right  car status widget = collapsed MFD
 *
 * Reads shared state, never writes it. Anything the state does not publish (per-lap energy
 * budgets, Straight Line Mode zones, clipping detection) is derived into HUD-local fields.
 */
import { Digits, txt, sty, fmtLap, fmtSector, fmtDelta, fmtMJ, clamp, approach } from './format.js';
import { deriveZones, zoneState } from './zones.js';
import { TrackMap } from './minimap.js';

// --- rev lights (measured: 15 circular LEDs, 1-5 green, 6-10 red, 11-15 magenta) ---------
// The 2026 useful band is 7,000-12,500 rpm even though the limiter is at 15,000, so the
// strip is mapped across the band the driver actually uses.
const REV_LO = 6800;
const REV_HI = 12500;
const LEDS = 15;
const SHIFT_AT = 0.94;

// --- 2026 energy budgets (FIA Technical Regulations, Section C) ---------------------------
const DEPLOY_LIMIT = 9.0;    // MJ per lap
const HARVEST_LIMIT = 8.5;   // MJ per lap
const STORE_MJ = 4.0;        // energy-store SoC swing
const MGUK_KW = 350;

// arc lengths for the battery ring (viewBox 0 0 100 100)
const C_OUT = 2 * Math.PI * 42;
const C_IN = 2 * Math.PI * 32;
const C_HARV = Math.PI * 42;
const C_REV = 2 * Math.PI * 42;

const COMPOUND = { S: ['SOFT', '#E31419'], M: ['MEDIUM', '#EAC205'], H: ['HARD', '#e8ecf2'], I: ['INTERMEDIATE', '#06BC06'], W: ['FULL WET', '#17a9ff'] };

export class HUD {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = ctx.state;
    this.t = 0;

    this.dKph = 0; this.dRpm = 0; this.dRev = 0;
    this.dDelta = 0; this.dBar = 0; this.dBatt = 1;
    this.dvdt = 0; this.prevKph = 0;

    this.energy = { deploy: 0, harvest: 0 };
    this.prevErs = 1;

    this.flash = [0, 0, 0];
    this.prevDone = [false, false, false];
    this.prevBestSec = [null, null, null];

    this.shiftUpT = -9; this.shiftDnT = -9;
    this.warnUntil = -9; this.warnText = ''; this.warnKind = 'warn';
    this.secPopUntil = -9;
    this.resultUntil = -9;
    this.invalidAt = -99;
    this.mfd = 0;
    this.hidden = false;
    this.ownMenu = true;
    this.screen = 'menu';
    this.compound = 'S';
  }

  async init() {
    const root = document.getElementById('ui-root');
    if (!root) throw new Error('#ui-root missing');
    root.innerHTML = HUD.markup();
    this.root = root;
    this.hud = root.querySelector('#hud');
    const $ = (id) => root.querySelector('#' + id);

    this.el = {};
    for (const id of [
      'tint', 'tower', 'twRows', 'twTrack', 'timing', 'posN', 'posOf', 'sects',
      'dlt', 'dltNeg', 'dltPos', 'map', 'mapC', 'mapPct',
      'dial', 'revs', 'gear', 'chUp', 'chDn', 'estate', 'aero', 'aeroName', 'aeroGlyph',
      'zoneTxt', 'zoneBar', 'smStrip', 'aeroModeTxt', 'arcDep', 'arcBatt', 'arcHarv', 'arcRev',
      'battDisc', 'tyreBadge', 'tyreLetter', 'deplFill', 'harvFill', 'prompt', 'promptAct',
      'mfd', 'mfdCar', 'mfdRows', 'mfdTicks', 'mfdCapL', 'mfdCapR', 'warn', 'warnT',
      'secpop', 'spK', 'spV', 'spD', 'ovMenu', 'ovRes', 'resTag', 'resLap', 'resSecs',
      'resGap', 'resGapK', 'resFoot',
    ]) this.el[id] = $(id);

    this.num = {};
    for (const id of ['lapTime', 'bestTime', 'lastTime', 'dltVal', 'kph', 'rpm', 'battPct',
      'spV', 'spD', 'resTime', 'resGap']) {
      const e = $(id); if (e) this.num[id] = new Digits(e);
    }
    this.secEls = [...root.querySelectorAll('#sects .sec')].map((e) => ({ box: e, val: new Digits(e.querySelector('.v')) }));
    this.leds = [...root.querySelectorAll('#revs i')];
    this.rings = [0, 1, 2, 3].map((i) => ({
      arc: $('ring' + i), val: $('ringV' + i),
    }));
    this.mfdRowEls = [...root.querySelectorAll('#mfdRows .mrow')].map((e) => ({
      box: e, v: e.querySelector('.v'),
    }));
    this.tyEls = [0, 1, 2, 3].map((i) => ({ g: $('ty' + i), bar: $('gu' + i) }));

    // track-derived pieces
    this.track = this.ctx.get('track');
    this.trackLen = this.track?.length || 5412;
    this.zones = [];
    if (this.track?.sampleS) {
      try { this.zones = deriveZones(this.track, 3); } catch (e) { console.warn('[hud] zones', e); }
      try { this.map = new TrackMap(this.el.mapC, this.track, this.zones); } catch (e) { console.warn('[hud] map', e); }
    }

    this.dBatt = this.state.car.ers ?? 1;
    this.prevErs = this.dBatt;
    this.prevKph = this.state.car.kph || 0;

    this.ctx.bus.on('lap:complete', (e) => this.#onLap(e));
    this.ctx.bus.on('sector', (e) => this.#onSector(e));
    this.ctx.bus.on('lap:invalid', (e) => this.#banner('LAP DELETED', 'bad', 2.8, e?.reason));
    this.ctx.bus.on('lap:benefit', () => this.#banner('ADVANTAGE GAINED — NEXT LAP DELETED', 'bad', 3.2));
    this.ctx.bus.on('car:shift', (e) => { if (e?.up) this.shiftUpT = this.t; else this.shiftDnT = this.t; });

    addEventListener('keydown', (e) => {
      if (e.code === 'KeyM') this.#setMfd((this.mfd + 1) % 2);
      else if (e.code === 'KeyH') { this.hidden = !this.hidden; this.hud.classList.toggle('off', this.hidden); }
      if (this.screen === 'menu' && this.ownMenu) this.setScreen('race');
    }, { passive: true });
    addEventListener('pointerdown', () => { if (this.screen === 'menu' && this.ownMenu) this.setScreen('race'); }, { passive: true });

    this.#paintMenu();
    window.__hud = this;
  }

  // ===================================================================== markup
  static markup() {
    const led = '<i></i>'.repeat(LEDS);
    const ring = (i, cx, cy, anti) => `
      <g class="ring ${anti ? 'anti' : ''}" transform="translate(${cx} ${cy})">
        <circle class="rt" r="15"/>
        <circle class="rf" id="ring${i}" r="15"/>
        <text id="ringV${i}" class="rv" y="4">0%</text>
      </g>`;
    return `
<div id="hud" class="hud" data-screen="menu">
  <div class="tint" id="tint"></div>

  <!-- ============ top-left: timing tower (Time Trial = personal records) ======= -->
  <section class="pnl tower" id="tower">
    <div class="tw-h"><i class="mark"></i><span class="tag">TIME TRIAL</span><span class="sub" id="twTrack">BAHRAIN</span></div>
    <div class="tw-rows" id="twRows"></div>
  </section>

  <!-- ============ top-centre: race control ==================================== -->
  <div class="banner" id="warn" data-k="warn"><span class="wt" id="warnT"></span></div>

  <!-- ============ top-right: timing panel ===================================== -->
  <section class="pnl timing" id="timing">
    <div class="sects" id="sects">
      <div class="sec" data-i="0"><span class="k">S1</span><span class="v num"></span></div>
      <div class="sec" data-i="1"><span class="k">S2</span><span class="v num"></span></div>
      <div class="sec" data-i="2"><span class="k">S3</span><span class="v num"></span></div>
    </div>
    <div class="tm-lap">
      <span class="pos"><b id="posN">1</b><i id="posOf">/ 1</i></span>
      <span class="lap num" id="lapTime"></span>
    </div>
    <div class="accent"></div>
    <div class="tm-row"><span class="k">BEST</span><span class="v num" id="bestTime"></span></div>
    <div class="tm-row"><span class="k">PREVIOUS</span><span class="v num" id="lastTime"></span></div>
    <div class="delta" id="dlt" data-st="none">
      <i class="hatch"></i>
      <svg class="sw" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="13.5" r="7.6"/><path d="M12 9.4v4.1h3"/><path d="M9.6 3.2h4.8"/><path d="M12 3.2v2.4"/>
      </svg>
      <span class="dl">DELTA</span>
      <span class="dv num" id="dltVal"></span>
      <i class="dbar"><b class="fill neg" id="dltNeg"></b><b class="fill pos" id="dltPos"></b><b class="mid"></b></i>
    </div>
  </section>

  <div class="secpop" id="secpop"><span class="k" id="spK">SECTOR 1</span><span class="v num" id="spV"></span><span class="d num" id="spD"></span></div>

  <div class="ov res" id="ovRes">
    <div class="res-h"><span class="tag" id="resTag">LAP COMPLETE</span><span class="lapn" id="resLap">LAP 1</span></div>
    <div class="res-time num" id="resTime"></div>
    <div class="res-gapline"><span class="res-gap num" id="resGap"></span><span class="k" id="resGapK"></span></div>
    <div class="res-secs" id="resSecs"></div>
    <div class="res-foot" id="resFoot"></div>
  </div>

  <!-- ============ lower-left: track map ======================================= -->
  <section class="pnl map" id="map">
    <div class="mp-h"><span class="tag">TRACK POSITION</span><span class="sub" id="mapPct">0%</span></div>
    <div class="map-c"><canvas id="mapC"></canvas></div>
    <div class="map-key"><span class="lg z">SM ZONE</span><span class="lg f">S/F</span></div>
  </section>

  <!-- ============ bottom-centre: the F1 Dial ================================== -->
  <section class="dial" id="dial">
    <div class="sm-strip" id="smStrip"><b class="sm">SM</b><span class="mode" id="aeroModeTxt">CORNERING MODE</span><span class="zone" id="zoneTxt">ZONE —</span><i class="zbar"><b id="zoneBar"></b></i></div>

    <div class="dial-row">
      <div class="d-batt">
        <svg viewBox="0 0 100 100">
          <circle class="tk o" cx="50" cy="50" r="42"/>
          <circle class="arc dep" id="arcDep" cx="50" cy="50" r="42"/>
          <circle class="tk i" cx="50" cy="50" r="32"/>
          <circle class="arc bat" id="arcBatt" cx="50" cy="50" r="32"/>
          <path class="arc hrv" id="arcHarv" d="M 50 92 A 42 42 0 0 0 50 8"/>
        </svg>
        <div class="disc" id="battDisc"><span class="bl">BATT</span><b class="num" id="battPct"></b></div>
        <div class="cbadge" id="tyreBadge"><b id="tyreLetter">S</b></div>
      </div>

      <div class="d-core">
        <div class="revs" id="revs">${led}</div>
        <div class="core-row">
          <div class="glyphs" id="aero" data-st="corner">
            <svg class="g-aero" id="aeroGlyph" viewBox="0 0 24 24" aria-hidden="true">
              <path class="a1" d="M3 8.5h18"/><path class="a2" d="M3 15.5h18"/>
              <path class="tip" d="M15.5 4.6 20.6 8.5 15.5 12.4"/>
            </svg>
            <span class="g-lbl" id="aeroName">CM</span>
          </div>
          <div class="gear" id="gear">N</div>
          <div class="chev"><i class="up" id="chUp"></i><i class="dn" id="chDn"></i></div>
        </div>
        <div class="estate" id="estate" data-k=""></div>
        <div class="ebars">
          <div class="eb dep"><i id="deplFill"></i></div>
          <div class="eb hrv"><i id="harvFill"></i></div>
        </div>
      </div>

      <div class="d-spd">
        <svg viewBox="0 0 100 100">
          <circle class="tk r" cx="50" cy="50" r="42"/>
          <circle class="arc rev" id="arcRev" cx="50" cy="50" r="42"/>
        </svg>
        <div class="disc">
          <span class="bl">KPH</span><b class="num" id="kph"></b>
          <span class="bl rl">RPM</span><i class="num rv" id="rpm"></i>
        </div>
      </div>
    </div>

    <div class="prompt" id="prompt"><span class="key">SPACE</span><span class="act" id="promptAct">STRAIGHT LINE</span></div>
  </section>

  <!-- ============ bottom-right: car status / MFD ============================== -->
  <section class="pnl mfd" id="mfd">
    <div class="mfd-page on" id="mfdCar">
      <svg class="car" viewBox="0 0 200 152">
        <g class="body">
          <rect class="pl fw" x="52" y="5" width="96" height="9" rx="3"/>
          <path class="pl nose" d="M93 14 h14 l6 38 h-26 z"/>
          <path class="pl tub" d="M87 52 h26 l4 32 h-34 z"/>
          <rect class="pl pod" x="64" y="58" width="17" height="30" rx="5"/>
          <rect class="pl pod" x="119" y="58" width="17" height="30" rx="5"/>
          <path class="pl floor" d="M79 84 h42 l5 34 h-52 z"/>
          <rect class="pl rw" x="58" y="126" width="84" height="10" rx="3"/>
          <rect class="pl rwp" x="97" y="118" width="6" height="9" rx="2"/>
        </g>
        <g class="tyres">
          <g class="ty" id="ty0"><rect x="40" y="24" width="15" height="28" rx="5"/><rect class="gu" id="gu0" x="41.5" y="50" width="12" height="0"/></g>
          <g class="ty" id="ty1"><rect x="145" y="24" width="15" height="28" rx="5"/><rect class="gu" id="gu1" x="146.5" y="50" width="12" height="0"/></g>
          <g class="ty" id="ty2"><rect x="37" y="94" width="18" height="32" rx="5"/><rect class="gu" id="gu2" x="38.5" y="124" width="15" height="0"/></g>
          <g class="ty" id="ty3"><rect x="145" y="94" width="18" height="32" rx="5"/><rect class="gu" id="gu3" x="146.5" y="124" width="15" height="0"/></g>
        </g>
        <g class="leads">
          <path d="M36 38 H30"/><path d="M164 38 H170"/>
          <path d="M33 110 H30"/><path d="M167 110 H170"/>
        </g>
        ${ring(0, 16, 38, true)}${ring(1, 184, 38, false)}${ring(2, 16, 110, true)}${ring(3, 184, 110, false)}
      </svg>
      <div class="mfd-cap"><span id="mfdCapL">TYRE WEAR</span><span id="mfdCapR">C5 SOFT</span></div>
    </div>

    <div class="mfd-page" id="mfdRows">
      <div class="mrow sel"><span class="ic">E</span><span class="k">ERS Deploy</span><span class="ch">&lsaquo;</span><span class="v">Auto</span><span class="ch">&rsaquo;</span></div>
      <div class="mrow"><span class="ic">A</span><span class="k">Active Aero</span><span class="ch">&lsaquo;</span><span class="v">Cornering</span><span class="ch">&rsaquo;</span></div>
      <div class="mrow"><span class="ic">G</span><span class="k">Ghost</span><span class="ch">&lsaquo;</span><span class="v">Personal Best</span><span class="ch">&rsaquo;</span></div>
      <div class="mrow"><span class="ic">L</span><span class="k">Track Limits</span><span class="ch">&lsaquo;</span><span class="v">Clean</span><span class="ch">&rsaquo;</span></div>
    </div>

    <div class="mfd-ticks" id="mfdTicks"><i class="on"></i><i></i><i></i><i></i></div>
  </section>

  <div class="ov menu" id="ovMenu"></div>
</div>`;
  }

  #paintMenu() {
    this.el.ovMenu.innerHTML = `
<div class="menu-in">
  <div class="m-kick"><i></i>FORMULA 1 · 2026 SEASON<i></i></div>
  <h1 class="m-title">TIME TRIAL</h1>
  <div class="m-track">BAHRAIN INTERNATIONAL CIRCUIT<span>SAKHIR · NIGHT · 5.412 km · 15 TURNS</span></div>
  <div class="m-best"><span>PERSONAL BEST</span><b id="mBest">${fmtLap(this.state.lap.best)}</b></div>
  <div class="m-grid">
    <div class="mi"><span>GHOST</span><b>PERSONAL BEST · ON</b></div>
    <div class="mi"><span>ERS</span><b>AUTOMATIC</b></div>
    <div class="mi"><span>ACTIVE AERO</span><b>${this.zones?.length || 3} SM ZONES</b></div>
    <div class="mi"><span>TYRE</span><b>C5 SOFT</b></div>
    <div class="mi"><span>WEAR · TEMP · FUEL</span><b>OFF</b></div>
    <div class="mi"><span>TRACK LIMITS</span><b>STRICT</b></div>
  </div>
  <div class="m-go">PRESS ANY KEY TO DRIVE</div>
  <div class="m-keys">R RESTART &nbsp;·&nbsp; SPACE ACTIVE AERO &nbsp;·&nbsp; M MFD &nbsp;·&nbsp; H HUD</div>
</div>`;
  }

  #setMfd(i) {
    this.mfd = i;
    this.el.mfdCar.classList.toggle('on', i === 0);
    this.el.mfdRows.classList.toggle('on', i === 1);
    [...this.el.mfdTicks.children].forEach((t, k) => t.classList.toggle('on', k === i));
  }

  // ===================================================================== public
  setScreen(name) {
    this.screen = name;
    this.hud.dataset.screen = name;
    if (name === 'menu' && this.ownMenu) this.#paintMenu();
  }

  showResult(o = {}) {
    const l = this.state.lap;
    const r = l.result || {};
    const time = o.time ?? r.time ?? l.last;
    const durs = o.sectors ?? r.sectors ?? l.sector ?? [null, null, null];
    const cols = o.colours ?? r.colours ?? l.lastSectorColour ?? ['', '', ''];
    const valid = o.valid ?? r.valid ?? l.lastValid ?? true;
    const pb = o.pb ?? r.pb ?? false;
    const gap = o.gap ?? (this.prevBest != null && time != null ? time - this.prevBest : null);

    txt(this.el.resTag, !valid ? 'LAP DELETED' : pb ? 'PERSONAL BEST' : 'LAP COMPLETE');
    this.el.ovRes.dataset.st = !valid ? 'bad' : pb ? 'pb' : 'ok';
    txt(this.el.resLap, 'LAP ' + Math.max(1, l.number || 1));
    this.num.resTime.set(fmtLap(time));
    if (gap != null && isFinite(gap)) {
      this.num.resGap.set(fmtDelta(gap));
      this.el.resGap.className = 'res-gap num ' + (gap < 0 ? 'c-green' : 'c-yellow');
      txt(this.el.resGapK, gap < 0 ? 'TO PREVIOUS BEST' : 'TO PERSONAL BEST');
    } else { this.num.resGap.set(''); this.el.resGap.className = 'res-gap num'; txt(this.el.resGapK, ''); }
    this.el.resSecs.innerHTML = [0, 1, 2].map((i) =>
      `<div class="rs c-${cols[i] || 'none'}"><span class="k">S${i + 1}</span><span class="v">${fmtSector(durs[i])}</span></div>`).join('');
    txt(this.el.resFoot, !valid ? (r.reason || 'TRACK LIMITS').toUpperCase()
      : pb ? 'GHOST UPDATED' : 'GHOST UNCHANGED');
    this.resultUntil = this.t + 6.5;
    this.hud.classList.add('res-on');
  }

  resize() { if (this.map) this.map.sync(); }

  // ===================================================================== events
  #onSector(e) {
    if (!e || e.i == null) return;
    const i = e.i, l = this.state.lap;
    const dur = e.time;
    const col = e.colour || l.lastSectorColour?.[i] || 'yellow';
    this.flash[i] = this.t + 1.6;
    txt(this.el.spK, 'SECTOR ' + (i + 1));
    this.num.spV.set(fmtSector(dur));
    const ref = this.prevBestSec[i];
    if (ref != null && isFinite(ref)) {
      this.num.spD.set(fmtDelta(dur - ref));
      this.el.spD.className = 'd num ' + (dur - ref < 0 ? 'c-green' : 'c-yellow');
    } else { this.num.spD.set(''); this.el.spD.className = 'd num'; }
    this.el.secpop.dataset.c = col;
    this.secPopUntil = this.t + 2.6;
  }

  #onLap(e) {
    this.showResult({ time: e?.time, valid: e?.valid, pb: e?.pb });
    this.energy.deploy = 0;
    this.energy.harvest = 0;
  }

  #banner(text, kind, secs, detail) {
    this.warnText = detail ? `${text} — ${String(detail).toUpperCase()}` : text;
    this.warnKind = kind;
    this.warnUntil = this.t + secs;
    this.el.warn.dataset.k = kind;
    if (kind === 'bad') this.invalidAt = this.t;
  }

  // ====================================================================== frame
  update(dt) {
    dt = clamp(dt || 0, 0, 0.1);
    this.t += dt;
    const st = this.state, c = st.car, l = st.lap;

    if (this.t < 0.2) {
      // GAME ships its own session/settings menu (#tt-menu) with assists, ghost and
      // controls we must not shadow. Ours is the fallback for when it is absent.
      this.ownMenu = !document.getElementById('tt-menu');
      this.hud.classList.toggle('own-menu', this.ownMenu);
    }

    // GAME owns state.flags.menu once it is up; fall back to "moving = racing".
    const inMenu = st.flags?.menu === true || (this.ownMenu && this.screen === 'menu' && !(c.kph > 1.2 || l.started));
    const want = inMenu ? 'menu' : 'race';
    if (want !== this.screen) this.setScreen(want);

    this.#energy(dt);
    this.#tower();
    this.#timing();
    this.#delta(dt);
    this.#dial(dt);
    this.#aero();
    this.#mfdUpdate();
    this.#mapUpdate();
    this.#banners();

    if (this.t > this.resultUntil) this.hud.classList.remove('res-on');
    this.hud.classList.toggle('sp-on', this.t < this.secPopUntil && this.t > this.resultUntil);
    this.hud.classList.toggle('ot', !!c.overrideActive);

    this.prevBest = l.best;
    if (Array.isArray(l.bestSector)) this.prevBestSec = l.bestSector.slice();
    for (let i = 0; i < 3; i++) this.prevDone[i] = !!l.sectorDone?.[i];
  }

  // -------------------------------------------------------------------- energy
  #energy(dt) {
    const c = this.state.car, inp = this.state.input;
    this.energy.deploy += (c.ersDeploy || 0) * MGUK_KW * dt / 1000;
    const d = (c.ers || 0) - this.prevErs;
    if (d > 0) this.energy.harvest += d * STORE_MJ;
    this.prevErs = c.ers || 0;
    this.energy.deploy = Math.min(this.energy.deploy, 60);
    this.energy.harvest = Math.min(this.energy.harvest, 60);

    // 2026 clipping detection. The real game shows nothing for super-clipping; we do.
    const kph = c.kph || 0;
    if (dt > 0) this.dvdt = approach(this.dvdt, (kph - this.prevKph) / dt, dt, 0.25);
    this.prevKph = kph;
    const wot = (inp?.throttle ?? 0) > 0.9 && (inp?.brake ?? 0) < 0.03 && kph > 90;
    this.superClip = wot && this.dvdt < -1.2 && d > 0;
    this.clipping = wot && !this.superClip && (c.ersDeploy || 0) < 0.03;
  }

  // --------------------------------------------------------------------- tower
  #tower() {
    const l = this.state.lap;
    const lb = Array.isArray(l.leaderboard) ? l.leaderboard.slice(0, 5) : [];
    const key = lb.map((e) => e.time?.toFixed(3)).join('|') + '/' + (l.best ?? '');
    if (key === this._twKey) return;
    this._twKey = key;
    if (!lb.length) {
      this.el.twRows.innerHTML = '<div class="tw-row empty"><span class="p">—</span><span class="n">NO TIME SET</span></div>';
      return;
    }
    const best = lb[0].time;
    this.el.twRows.innerHTML = lb.map((e, i) => `
      <div class="tw-row${i === 0 ? ' lead' : ''}">
        <span class="p">${i + 1}</span>
        <span class="n">${i === 0 ? 'PERSONAL BEST' : 'LAP ' + (i + 1)}</span>
        <span class="t">${i === 0 ? fmtLap(e.time) : '+' + (e.time - best).toFixed(3)}</span>
      </div>`).join('');
  }

  // -------------------------------------------------------------------- timing
  #timing() {
    const l = this.state.lap;
    this.num.lapTime.set(fmtLap(l.timing === false && l.phase !== 'flying' ? 0 : l.time));
    this.num.bestTime.set(fmtLap(l.best));
    this.num.lastTime.set(fmtLap(l.last));

    const lb = Array.isArray(l.leaderboard) ? l.leaderboard : [];
    txt(this.el.posN, '1');
    txt(this.el.posOf, '/ ' + Math.max(1, lb.length));

    const done = l.sectorDone || [];
    const durs = l.sector || [];
    const cols = l.lastSectorColour || [];
    for (let i = 0; i < 3; i++) {
      const e = this.secEls[i]; if (!e) continue;
      const has = !!done[i] && typeof durs[i] === 'number' && durs[i] > 0.05;
      e.val.set(has ? fmtSector(durs[i]) : '--.---');
      const cls = 'sec c-' + (has ? (cols[i] || 'yellow') : 'none') + (this.t < this.flash[i] ? ' fl' : '');
      if (e.box.className !== cls) e.box.className = cls;
    }
    this.el.timing.classList.toggle('invalid', l.valid === false);
  }

  // --------------------------------------------------------------------- delta
  #delta(dt) {
    const l = this.state.lap;
    const ok = !!l.deltaValid && isFinite(l.delta);
    const target = ok ? l.delta : 0;
    this.dDelta = approach(this.dDelta, target, dt, 0.10);
    this.dBar = approach(this.dBar, target, dt, 0.14);

    const st = !ok ? 'none' : this.dDelta > 0.004 ? 'dn' : 'up';
    if (this.el.dlt.dataset.st !== st) this.el.dlt.dataset.st = st;
    this.num.dltVal.set(ok ? fmtDelta(this.dDelta) : 'NO GHOST');

    const v = ok ? clamp(Math.abs(this.dBar) / 1.0, 0, 1) : 0;
    sty(this.el.dltNeg, 'transform', `scaleX(${(this.dBar < 0 ? v : 0).toFixed(4)})`);
    sty(this.el.dltPos, 'transform', `scaleX(${(this.dBar > 0 ? v : 0).toFixed(4)})`);
  }

  // ---------------------------------------------------------------------- dial
  #dial(dt) {
    const c = this.state.car, inp = this.state.input;

    // --- rev strip -----------------------------------------------------------
    this.dRev = approach(this.dRev, c.rpm || 0, dt, 0.028);
    const f = clamp((this.dRev - REV_LO) / (REV_HI - REV_LO), 0, 1);
    const lit = Math.round(f * LEDS);
    const shift = f >= SHIFT_AT;
    // At the shift point the green block goes dark and red+purple flash (measured).
    const blink = shift && (Math.floor(this.t * 12) & 1) === 0;
    const key = lit + (shift ? 100 : 0) + (blink ? 1000 : 0);
    if (key !== this._revKey) {
      this._revKey = key;
      for (let i = 0; i < LEDS; i++) {
        const on = shift ? (i >= 5 && !blink) : i < lit;
        this.leds[i].classList.toggle('on', on);
      }
      this.el.revs.classList.toggle('shift', shift);
    }

    // --- gear + shift chevrons ----------------------------------------------
    const neutral = (c.kph || 0) < 1 && (inp?.throttle ?? 0) < 0.02;
    txt(this.el.gear, neutral ? 'N' : String(clamp(Math.round(c.gear || 1), 1, c.gearCount || 8)));
    this.el.gear.classList.toggle('dim', (inp?.throttle ?? 0) < 0.05 && !neutral);
    this.el.chUp.classList.toggle('on', this.t - this.shiftUpT < 0.25);
    this.el.chDn.classList.toggle('on', this.t - this.shiftDnT < 0.25);

    // --- speed / rpm ring ----------------------------------------------------
    this.dKph = approach(this.dKph, c.kph || 0, dt, 0.045);
    this.dRpm = approach(this.dRpm, c.rpm || 0, dt, 0.05);
    this.num.kph.set(String(Math.max(0, Math.round(this.dKph))));
    this.num.rpm.set(String(Math.round(this.dRpm / 100) * 100));
    sty(this.el.arcRev, 'stroke-dashoffset', (C_REV * (1 - clamp(this.dRpm / 15000, 0, 1))).toFixed(2));

    // --- battery ring: outer lime = deploy allowance, inner yellow = charge,
    //     red left arc = harvest used this lap -------------------------------
    this.dBatt = approach(this.dBatt, clamp(c.ers || 0, 0, 1), dt, 0.09);
    const depLeft = clamp(1 - this.energy.deploy / DEPLOY_LIMIT, 0, 1);
    const hv = clamp(this.energy.harvest / HARVEST_LIMIT, 0, 1);
    sty(this.el.arcDep, 'stroke-dashoffset', (C_OUT * (1 - depLeft)).toFixed(2));
    sty(this.el.arcBatt, 'stroke-dashoffset', (C_IN * (1 - this.dBatt)).toFixed(2));
    sty(this.el.arcHarv, 'stroke-dashoffset', (C_HARV * (1 - hv)).toFixed(2));
    this.num.battPct.set(Math.round(this.dBatt * 100) + '%');
    sty(this.el.deplFill, 'transform', `scaleX(${depLeft.toFixed(4)})`);
    sty(this.el.harvFill, 'transform', `scaleX(${hv.toFixed(4)})`);
    this.el.dial.classList.toggle('harv-max', hv >= 0.999);

    // --- energy state label (measured vocabulary, extended with clipping) -----
    const dep = c.ersDeploy || 0;
    const rising = (c.ers || 0) > this.prevErs - 1e-9 && (c.ers || 0) - this.prevErs > 0;
    let state = '', kind = '';
    if (c.overrideActive) { state = 'OVERTAKE'; kind = 'boost'; }
    else if (this.superClip) { state = 'SUPER-CLIPPING'; kind = 'clip2'; }
    else if (this.clipping) { state = 'CLIPPING'; kind = 'clip'; }
    else if (dep > 0.05) { state = 'DEPLOYING'; kind = 'dep'; }
    else if (rising || (this.state.input?.brake ?? 0) > 0.15) { state = hv > 0.85 ? 'REDUCED HARVESTING' : 'HARVESTING'; kind = hv > 0.85 ? 'red' : 'harv'; }
    txt(this.el.estate, state);
    if (this.el.estate.dataset.k !== kind) this.el.estate.dataset.k = kind;

    // battery numeral state: yellow charging / orange deploying / solid on Overtake
    const bk = c.overrideActive ? 'boost' : dep > 0.05 ? 'dep' : 'charge';
    if (this.el.battDisc.dataset.k !== bk) this.el.battDisc.dataset.k = bk;

    // tyre compound badge
    const [name, col] = COMPOUND[this.compound] || COMPOUND.S;
    txt(this.el.tyreLetter, this.compound);
    sty(this.el.tyreBadge, '--tc', col);
    this._compoundName = name;
  }

  // ---------------------------------------------------------------- active aero
  #aero() {
    const c = this.state.car, l = this.state.lap;
    const s = l.distance || 0;
    const z = this.zones.length ? zoneState(this.zones, s, this.trackLen) : { inZone: null, next: null, dist: 0, progress: 0 };
    this.zNow = z;
    const active = c.aeroMode === 'X';
    const st = active ? 'active' : z.inZone ? 'ready' : 'corner';
    if (this.el.aero.dataset.st !== st) this.el.aero.dataset.st = st;
    txt(this.el.aeroName, active ? 'SM' : 'CM');
    txt(this.el.aeroModeTxt, active ? 'STRAIGHT LINE MODE' : 'CORNERING MODE');

    if (z.inZone) {
      txt(this.el.zoneTxt, `ZONE ${z.inZone.index} OPEN · ${Math.round(z.inZone.length * (1 - z.progress))} m`);
      sty(this.el.zoneBar, 'transform', `scaleX(${(1 - z.progress).toFixed(3)})`);
    } else if (z.next) {
      const d = z.dist;
      txt(this.el.zoneTxt, `ZONE ${z.next.index} IN ${d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1) + ' km'}`);
      sty(this.el.zoneBar, 'transform', `scaleX(${clamp(1 - d / 700, 0, 1).toFixed(3)})`);
    } else {
      txt(this.el.zoneTxt, 'ZONE —');
      sty(this.el.zoneBar, 'transform', 'scaleX(0)');
    }
    if (this.el.smStrip.dataset.st !== st) this.el.smStrip.dataset.st = st;

    txt(this.el.promptAct, c.overrideActive ? 'DISABLE' : active ? 'CORNERING' : 'STRAIGHT LINE');
    this.el.prompt.classList.toggle('live', active || !!c.overrideActive);
  }

  // ----------------------------------------------------------------------- MFD
  #mfdUpdate() {
    const c = this.state.car, l = this.state.lap;
    if (this.mfd === 0) {
      for (let i = 0; i < 4; i++) {
        const w = c.wheel?.[i], r = this.rings[i];
        if (!w || !r.arc) continue;
        const wear = clamp((w.wear ?? 0) * (w.wear > 1 ? 1 : 100), 0, 100);
        const C = 2 * Math.PI * 15;
        sty(r.arc, 'stroke-dashoffset', (C * (1 - wear / 100)).toFixed(2));
        const band = wear < 20 ? 'a' : wear < 60 ? 'b' : wear < 80 ? 'c' : 'd';
        if (r.arc.dataset.b !== band) r.arc.dataset.b = band;
        txt(r.val, Math.round(wear) + '%');
      }
      // wear is disabled in Time Trial, so the corners carry live grip usage instead
      for (let i = 0; i < 4; i++) {
        const w = c.wheel?.[i], e = this.tyEls[i];
        if (!w || !e.bar) continue;
        const g = clamp(w.gripUse ?? 0, 0, 1);
        const full = i < 2 ? 28 : 32, y0 = i < 2 ? 24 : 94;
        e.bar.setAttribute('height', (g * full).toFixed(1));
        e.bar.setAttribute('y', (y0 + full - g * full).toFixed(1));
        const b = g > 0.92 ? 'd' : g > 0.75 ? 'c' : 'a';
        if (e.bar.dataset.b !== b) e.bar.dataset.b = b;
        const st = w.locked ? 'lock' : w.spinning ? 'spin' : '';
        if (e.g.dataset.s !== st) e.g.dataset.s = st;
      }
      txt(this.el.mfdCapL, l.rules?.tyreWear === false ? 'TYRE WEAR · OFF' : 'TYRE WEAR');
      txt(this.el.mfdCapR, 'C5 ' + (this._compoundName || 'SOFT'));
    } else {
      const dep = c.ersDeploy || 0;
      const mode = c.overrideActive ? 'Overtake' : dep >= 0.85 ? 'Hotlap' : dep > 0.15 ? 'Medium' : 'None';
      const g = l.ghost || {};
      const vals = [
        (l.rules?.ersAuto ? 'Auto · ' : '') + mode,
        c.aeroMode === 'X' ? 'Straight Line' : 'Cornering',
        g.available ? (g.enabled ? 'Personal Best' : 'Off') : 'Not Set',
        l.valid === false ? 'Lap Deleted' : (l.wheelsBeyond ?? 0) >= 2 ? 'Warning' : 'Clean',
      ];
      for (let i = 0; i < this.mfdRowEls.length; i++) txt(this.mfdRowEls[i].v, vals[i] ?? '');
    }
  }

  // ----------------------------------------------------------------------- map
  #mapUpdate() {
    if (!this.map) return;
    const c = this.state.car, l = this.state.lap;
    const s = l.distance || 0;
    txt(this.el.mapPct, Math.round(clamp(l.progress ?? 0, 0, 1) * 100) + '%');
    const marks = this.track?.sectorS || [this.trackLen / 3, 2 * this.trackLen / 3, this.trackLen];
    const active = s < marks[0] ? 0 : s < marks[1] ? 1 : 2;
    const vx = c.velocity?.x ?? 0, vz = c.velocity?.z ?? 0;
    const spd = Math.hypot(vx, vz);
    try {
      this.map.draw({
        s,
        carPos: c.position ? [c.position.x, c.position.z] : null,
        heading: spd > 1 ? [vx / spd, vz / spd] : null,
        sectorColours: l.lastSectorColour || ['', '', ''],
        activeSector: active,
        zoneActive: c.aeroMode === 'X' ? this.zNow?.inZone : null,
        ghost: l.ghost?.active ? { active: true, s: (l.ghost.progress || 0) * this.trackLen } : null,
        tint: c.overrideActive ? '#38b6ff' : l.valid === false ? '#E31419' : '#ffffff',
      });
    } catch (e) { if (!this._mapErr) { this._mapErr = 1; console.warn('[hud] map draw', e); } }
  }

  // ------------------------------------------------------------------- banners
  #banners() {
    const l = this.state.lap, c = this.state.car;
    if (this.t >= this.warnUntil) {
      if (l.phase === 'outlap') {
        this.warnText = `OUT-LAP · ${Math.max(0, Math.round(l.outLapRemaining || 0))} m TO THE LINE`;
        this.warnKind = 'info'; this.warnUntil = this.t + 0.3; this.el.warn.dataset.k = 'info';
      } else if (l.valid === false) {
        this.warnText = 'LAP DELETED · ' + String(l.invalidReason || 'TRACK LIMITS').toUpperCase();
        this.warnKind = 'bad2'; this.warnUntil = this.t + 0.3; this.el.warn.dataset.k = 'bad2';
      } else if ((l.wheelsBeyond ?? c.wheelsOff ?? 0) >= 2) {
        this.warnText = 'TRACK LIMITS';
        this.warnKind = 'warn'; this.warnUntil = this.t + 0.35; this.el.warn.dataset.k = 'warn';
      }
    }
    const on = this.t < this.warnUntil;
    if (on !== this._warnOn) { this._warnOn = on; this.el.warn.classList.toggle('on', on); }
    if (on) txt(this.el.warnT, this.warnText);
    this.hud.classList.toggle('flash-bad', this.t - this.invalidAt < 0.5);
  }
}
