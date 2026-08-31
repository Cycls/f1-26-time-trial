/**
 * TIME TRIAL — the only game mode we ship. Owner: GAME.
 * Writes state.lap.*, state.flags.* (and nothing else).
 *
 * Rules implemented verbatim from docs/reference-physics.md "Time Trial rules":
 *   - damage off, tyre wear off, tyre temp off/ideal, fuel not modelled,
 *     weather fixed ideal, car performance equalised
 *   - ERS is FIXED / AUTOMATIC for the lap and is NOT driver-deployable
 *   - track limits: all four wheels FULLY beyond the white line = immediate deletion.
 *     A sliver of tyre still on the line is legal. If the excursion conferred a
 *     benefit the NEXT lap is deleted too.
 *   - PB ghost ON by default, a replay not a simulation, no collision
 *   - ghost telemetry overlay Off / Brakes only / Full (default Full)
 *   - delta live and continuous, green faster / red slower
 *
 * Session flow:  menu -> out-lap -> flying lap -> result -> (retry | keep lapping)
 *
 * Ownership note: the vehicle model belongs to PHYSICS, so the "wear/temp/fuel/damage
 * off" half of the ruleset is published rather than enforced here — state.lap.rules,
 * the 'game:rules' bus event and physics.rules. See docs/REQUESTS.md.
 */
import * as THREE from 'three';
import { CONFIG } from '../core/config.js';
import { RacingLine, LINE_MODES } from './line.js';
import { GhostRecorder, GhostCar } from './ghost.js';
import { GhostOverlay, OVERLAY_MODES, OVERLAY_LABELS } from './overlay.js';
import { Leaderboard, loadGhost, saveGhost, clearGhost } from './leaderboard.js';
import { TTMenu, fmtTime, fmtSector } from './menu.js';

const RULES = Object.freeze({
  mode: 'timeTrial',
  damage: false,
  tyreWear: false,
  tyreTemp: false, tyreTempIdealC: 90,
  fuel: false,
  weather: 'fixed-ideal-night',
  equalisedCar: true,
  ersAuto: true, ersManualDeploy: false,
  trackLimits: 'allFourWheelsBeyondLine',
  benefitDeletesNextLap: true,
  ghost: 'personalBest',
});

const OUTLAP_BACK = 900;        // metres before the line the out-lap starts
const RESULT_TIME = 4.5;        // seconds the result banner stays up
const TELEPORT = 120;           // metres of lap-distance change that means "teleport"
const FB_HZ = 20, FB_SECONDS = 10, FB_JUMP = 2.6;
const SECTOR_KEY = 'f1_26_tt_sectors_v1';

export class TimeTrial {
  constructor(ctx) {
    this.ctx = ctx; this.state = ctx.state;
    this.guide = null;
    this.ghostEnabled = true;       // PB ghost default ON
    this.pbGhost = null;
    this.recorder = new GhostRecorder();
    this.leaderboard = new Leaderboard();
    this.menu = new TTMenu(ctx, this);
    this.pose = {
      position: new THREE.Vector3(), quaternion: new THREE.Quaternion(),
      s: 0, kph: 0, throttle: 0, brake: 0, steerAngle: 0, gear: 1,
    };
    this.fb = []; this.fbAcc = 0;
    this.prevS = 0; this.lapS = 0; this.time = 0;
    this.phase = 'menu';
    this.resultT = 0;
    this.excursion = null;
    this.pendingBenefit = false;
    this.prevReset = false;
    this.sectorValid = [true, true, true];
    this.dbg = { limitEvents: 0, benefitEvents: 0, laps: 0 };
  }

  // ------------------------------------------------------------------- init --
  async init() {
    this.track = this.ctx.get('track');
    const L = this.state.lap;

    // publish the ruleset for anyone who models wear/temp/fuel/damage
    L.rules = RULES;
    this.state.flags.timeTrial = true;
    safeEmit(this.ctx.bus, 'game:rules', RULES);
    try { const ph = this.ctx.get('physics'); if (ph) ph.rules = RULES; } catch { /* not up yet */ }

    // racing line + speed profile (also drives braking / steering assist)
    try {
      this.guide = new RacingLine(this.ctx, this.track);
      if (!this.guide.build()) this.guide = null;
      else console.log(`[game] racing line built: ${this.guide.M} nodes, ideal lap ${fmtTime(this.guide.refLap)}`);
    } catch (e) { console.error('[game] racing line failed', e); this.guide = null; }

    // ghost: visual + persisted PB trace + telemetry overlay
    this.ghostCar = new GhostCar(this.ctx).build();
    this.overlay = new GhostOverlay(this.ctx);
    this.pbGhost = loadGhost();
    if (this.pbGhost) this.overlay.build(this.pbGhost);
    this.overlay.setMode('full');                 // reference default

    this.#loadBestSectors();
    L.best = this.leaderboard.best()?.time ?? null;
    L.bestValid = L.best;
    L.leaderboard = this.leaderboard.top(10);

    this.menu.init();
    this.#applyLineMode();

    this.ctx.bus.on('input:assist', (e) => { if (e.key === 'racingLine') this.#applyLineMode(); this.menu.refresh(); });
    this.ctx.bus.on('input:scripted', (on) => { if (on && this.phase === 'menu') this.#autoStart(); });

    addEventListener('keydown', (e) => this.#key(e));

    this.#enterMenu();
    window.__tt = this;                           // probe / tooling hook
  }

  #key(e) {
    if (this.menu.open) return;                   // the menu consumes its own keys
    switch (e.code) {
      case 'Escape': this.openMenu(); break;
      case 'Tab': e.preventDefault(); this.openMenu('assists'); break;
      case 'Enter': case 'NumpadEnter': if (this.phase === 'menu') this.startSession(); break;
      case 'KeyG': this.setGhostEnabled(!this.ghostEnabled); break;
      case 'KeyT': this.setOverlayMode(OVERLAY_MODES[(OVERLAY_MODES.indexOf(this.overlay.mode) + 1) % 3]); break;
      case 'KeyL': {
        const inp = this.ctx.get('input');
        inp?.cycleAssist('racingLine', 1);
        break;
      }
      default: break;
    }
  }

  // --------------------------------------------------------------- session ----
  openMenu(tab = null) {
    this.state.flags.menu = true;
    this.menu.setOpen(true, tab ?? (this.phase === 'menu' ? 'session' : 'assists'));
  }

  closeMenu() {
    this.menu.setOpen(false);
    if (this.phase === 'menu') this.startSession();
    else this.state.flags.menu = false;
  }

  #enterMenu() {
    if (!this.menu.enabled) { this.startSession(true); return; }   // HUD owns the menu
    this.phase = 'menu';
    this.time = 0; this.lapS = 0;
    this.state.flags.menu = true; this.state.flags.started = false;
    this.#resetCar(0);
    this.menu.setOpen(true, 'session');
  }

  /**
   * A headless tool (tools/shoot.mjs, tools/probe_game.mjs) started driving. Leave the
   * menu WITHOUT emitting game:reset — the tool has usually just placed the car itself
   * and resetting would teleport it back to the pit straight mid-capture.
   */
  #autoStart() {
    this.menu.setOpen(false);
    this.state.flags.menu = false; this.state.flags.started = true;
    this.phase = 'flying';
    this.lapS = this.prevS; this.time = 0;
    this.recorder.reset(); this.fb.length = 0; this.excursion = null;
    const L = this.state.lap;
    L.valid = true; L.invalidReason = ''; L.sectorDone = [false, false, false];
  }

  startSession(silent = false) {
    this.menu.setOpen(false);
    this.state.flags.menu = false;
    this.state.flags.started = true;
    this.retry(silent);
  }

  /** Restart: back to the out-lap, everything about the current lap discarded. */
  retry(silent = false) {
    const L = this.state.lap, len = this.track?.length ?? CONFIG.track.length;
    this.phase = 'outlap';
    const s0 = ((len - OUTLAP_BACK) % len + len) % len;
    this.#resetCar(s0);
    this.lapS = -OUTLAP_BACK;
    this.time = 0;
    this.excursion = null; this.pendingBenefit = false;
    this.recorder.reset();
    this.fb.length = 0;
    L.time = 0; L.valid = true; L.started = false;
    L.sector = [0, 0, 0]; L.sectorDone = [false, false, false];
    L.lastSectorColour = ['', '', ''];
    L.delta = 0; L.deltaValid = false; L.deltaColour = '';
    L.invalidatedAt = null; L.invalidReason = ''; L.invalidNext = false;
    this.sectorValid = [true, true, true];
    this.state.flags.menu = false;
    if (!silent) this.menu.showToast('Out-lap', 'Cross the line to start a timed lap');
  }

  #resetCar(s) {
    this.prevS = s;
    safeEmit(this.ctx.bus, 'game:reset', s);
    const c = this.state.car;
    if (c?.position) { try { this.prevS = this.track.locate(c.position, s).s; } catch { /* ignore */ } }
  }

  clearRecords() {
    this.leaderboard.clear(); clearGhost();
    this.pbGhost = null; this.overlay.clear();
    const L = this.state.lap;
    L.best = null; L.bestValid = null; L.last = null;
    L.bestSector = [null, null, null]; L.sessionBestSector = [null, null, null];
    L.leaderboard = [];
    try { localStorage.removeItem(SECTOR_KEY); } catch { /* ignore */ }
    this.menu.showToast('Records cleared', '');
    this.menu.refresh();
  }

  setGhostEnabled(v) {
    this.ghostEnabled = !!v;
    this.ghostCar.setVisible(false);
    this.menu.showToast('PB ghost', this.ghostEnabled ? 'On' : 'Off', 1600);
    this.menu.refresh();
  }

  setOverlayMode(m) {
    this.overlay.setMode(m);
    this.state.lap.ghost.telemetry = this.overlay.mode;
    this.menu.showToast('Ghost telemetry', OVERLAY_LABELS[this.overlay.mode], 1600);
    this.menu.refresh();
  }

  #applyLineMode() {
    const m = this.ctx.get('input')?.assists?.settings?.racingLine ?? 'corners';
    this.guide?.setMode(LINE_MODES.includes(m) ? m : 'off');
  }

  // ------------------------------------------------------------ persistence --
  #loadBestSectors() {
    const L = this.state.lap;
    L.bestSector = [null, null, null];
    L.sessionBestSector = [null, null, null];
    try {
      const v = JSON.parse(localStorage.getItem(SECTOR_KEY) || 'null');
      if (Array.isArray(v) && v.length === 3) L.bestSector = v.map((x) => (typeof x === 'number' && isFinite(x) ? x : null));
    } catch { /* ignore */ }
  }

  #saveBestSectors() {
    try { localStorage.setItem(SECTOR_KEY, JSON.stringify(this.state.lap.bestSector)); } catch { /* ignore */ }
  }

  // ------------------------------------------------------- track limits ------
  /**
   * All four wheels FULLY beyond the white line. The line's outer edge is the track
   * half-width, so a wheel is "fully beyond" only once its inboard edge clears it —
   * a sliver of rubber still touching the line is legal.
   */
  #wheelState() {
    const c = this.state.car, C = CONFIG.car;
    const hx = C.trackWidth / 2, zf = C.wheelbase * 0.456, zr = -C.wheelbase * 0.544;
    const geo = [
      [-hx + 0.17, zf, C.tyreWidthF / 2], [hx - 0.17, zf, C.tyreWidthF / 2],
      [-hx + 0.12, zr, C.tyreWidthR / 2], [hx - 0.12, zr, C.tyreWidthR / 2],
    ];
    let beyond = 0, side = 0, worst = -Infinity, anyOff = 0;
    for (let i = 0; i < 4; i++) {
      const [x, z, tw] = geo[i];
      _w.set(x, 0, z).applyQuaternion(c.quaternion).add(c.position);
      let loc;
      try { loc = this.track.locate(_w, this.prevS); } catch { return { allFour: false, beyond: 0, anyOff: 0, over: 0 }; }
      const over = Math.abs(loc.lateral) - loc.halfWidth;
      if (over > 0) anyOff++;
      worst = Math.max(worst, over);
      if (over - tw > 0) { beyond++; side += Math.sign(loc.lateral); }
    }
    // PHYSICS also reports wheelsOff; it corroborates but may not override the
    // geometric test, because its threshold is a single lateral distance and would
    // delete a lap that still has a sliver of tyre on the line.
    const physFour = (c.wheelsOff ?? 0) >= 4;
    return {
      allFour: (beyond === 4 && Math.abs(side) === 4) || (physFour && beyond >= 3),
      beyond, anyOff, over: worst,
    };
  }

  #invalidate(reason) {
    const L = this.state.lap;
    if (!L.valid) return;
    L.valid = false;
    L.invalidatedAt = this.lapS;
    L.invalidReason = reason;
    for (let i = 0; i < 3; i++) if (!L.sectorDone[i]) this.sectorValid[i] = false;
    this.dbg.limitEvents++;
    safeEmit(this.ctx.bus, 'lap:invalid', { reason, s: this.lapS });
    this.menu.showToast('Lap deleted', reason);
  }

  /**
   * Did the excursion actually gain anything? Three pace-independent tests, any one
   * of which deletes the following lap as well:
   *   1. the car gained more lap distance than the ground it actually covered — the
   *      geometric signature of cutting a corner
   *   2. the delta to the ghost improved across the excursion
   *   3. it rejoined carrying more speed than the corner it skipped physically allows
   */
  #closeExcursion() {
    const e = this.excursion; this.excursion = null;
    if (!e) return;
    const dS = this.lapS - e.lapS;
    if (dS < 1) return;
    const reasons = [];
    if (dS - e.path > 0.5) reasons.push('shortened the lap');
    if (e.delta != null && this.state.lap.deltaValid && (e.delta - this.state.lap.delta) > 0.04) reasons.push('gained on the ghost');
    if (this.guide?.ready) {
      const allowed = this.guide.speedAt(this.lapS) * 3.6;
      if (allowed < 300 && (this.state.car.kph ?? 0) > allowed + 12) reasons.push('rejoined above the corner speed');
    }
    if (!reasons.length) return;
    this.pendingBenefit = true;
    this.state.lap.invalidNext = true;
    this.dbg.benefitEvents++;
    safeEmit(this.ctx.bus, 'lap:benefit', { reasons, s: this.lapS });
    this.menu.showToast('Advantage gained', 'Next lap deleted as well');
  }

  // ------------------------------------------------------------- flashback ---
  #snapshot(dt) {
    this.fbAcc += dt;
    if (this.fbAcc < 1 / FB_HZ) return;
    this.fbAcc = 0;
    const c = this.state.car, ph = this.ctx.get('physics');
    this.fb.push({
      time: this.time, lapS: this.lapS, s: this.prevS, valid: this.state.lap.valid,
      pos: c.position.clone(), quat: c.quaternion.clone(), vel: c.velocity.clone(),
      omegaY: ph?.omega?.y ?? 0, gear: c.gear, rpm: c.rpm,
      sector: this.state.lap.sector.slice(), sectorDone: this.state.lap.sectorDone.slice(),
    });
    if (this.fb.length > FB_HZ * FB_SECONDS) this.fb.shift();
  }

  flashback() {
    if (this.phase === 'menu' || this.fb.length < 4) return false;
    const want = this.time - FB_JUMP;
    let sn = this.fb[0];
    for (const f of this.fb) if (f.time <= want) sn = f;
    const ph = this.ctx.get('physics');
    try {
      ph.pos.copy(sn.pos); ph.quat.copy(sn.quat); ph.vel.copy(sn.vel);
      ph.omega.set(0, sn.omegaY, 0);
      ph.hintS = sn.s; ph.gear = sn.gear; ph.rpm = sn.rpm;
    } catch (err) { console.warn('[game] flashback could not restore physics:', err?.message); return false; }
    const L = this.state.lap;
    this.time = sn.time; this.lapS = sn.lapS; this.prevS = sn.s;
    L.valid = sn.valid; L.sector = sn.sector.slice(); L.sectorDone = sn.sectorDone.slice();
    this.recorder.rewind(sn.time);
    this.excursion = null;
    while (this.fb.length && this.fb[this.fb.length - 1].time > sn.time) this.fb.pop();
    safeEmit(this.ctx.bus, 'game:flashback', { time: sn.time });
    this.menu.showToast('Flashback', `${FB_JUMP.toFixed(1)} s`, 1400);
    return true;
  }

  // ---------------------------------------------------------------- update ---
  update(dt) {
    dt = Math.min(Math.max(dt, 0), 0.1);
    const L = this.state.lap, c = this.state.car, inp = this.state.input;
    const len = this.track?.length ?? CONFIG.track.length;

    this.guide?.update(dt);
    this.overlay?.update();
    this.ghostCar?.update(dt);

    // -- discrete requests ----------------------------------------------------
    if (inp.resetRequest && !this.prevReset) this.retry();
    this.prevReset = !!inp.resetRequest;
    if (inp.flashback) this.flashback();

    // -- lap distance ---------------------------------------------------------
    let loc = null;
    try { loc = this.track.locate(c.position, this.prevS); } catch { /* track not ready */ }
    const s = loc ? loc.s : this.prevS;
    let ds = s - this.prevS;
    if (ds > len / 2) ds -= len; else if (ds < -len / 2) ds += len;
    this.prevS = s;

    if (Math.abs(ds) > TELEPORT) {
      // a capture tool or a debug jump moved the car: re-baseline silently rather
      // than spraying "lap deleted" across someone else's screenshots.
      this.lapS = s; this.time = Math.max(this.time, 0);
      if (this.phase === 'menu') { this.phase = 'flying'; this.state.flags.menu = false; this.menu.setOpen(false); }
      if (this.phase === 'outlap') this.phase = 'flying';
      L.valid = true; L.invalidReason = ''; L.invalidatedAt = null;
      this.recorder.reset(); this.excursion = null; this.fb.length = 0;
      ds = 0;
    } else this.lapS += ds;

    const v = Math.max(0.5, c.speed || 0);

    // -- phase machine --------------------------------------------------------
    // The out-lap becomes the flying lap the instant the line is crossed; the
    // sub-frame overshoot is converted back to time so the clock does not inherit
    // up to one frame (1.4 m at 300 km/h) of error.
    if (this.phase === 'outlap' && this.lapS >= 0) {
      this.phase = 'flying';
      this.time = Math.max(0, this.lapS / v - dt);
      this.#beginLap();
      this.menu.showToast('Timing', 'Flying lap');
    }
    const timing = this.phase === 'flying' || this.phase === 'result';

    if (timing) {
      this.time += dt;
      // sectors BEFORE the rollover: sector 3 ends exactly on the line
      this.#sectors(len, v);
      if (this.lapS >= len) {
        const back = (this.lapS - len) / v;
        this.#completeLap(this.time - back);
        this.lapS -= len;
        this.time = back;
        this.#beginLap();
      }
      if (this.lapS < -8) { this.#invalidate('Driving backwards'); this.lapS = -8; }
    }
    if (this.phase === 'result') {
      this.resultT -= dt;
      if (this.resultT <= 0) this.phase = 'flying';
    }

    // -- track limits ---------------------------------------------------------
    const ws = this.#wheelState();
    L.wheelsBeyond = ws.beyond;
    if (timing) {
      if (ws.allFour) {
        if (!this.excursion) {
          this.excursion = { lapS: this.lapS, time: this.time, path: 0, delta: L.deltaValid ? L.delta : null };
        }
        this.#invalidate('Track limits — all four wheels beyond the line');
      }
      if (this.excursion) {
        this.excursion.path += v * dt;
        if (!ws.allFour && ws.anyOff === 0) this.#closeExcursion();
      }
    }

    // -- ghost ----------------------------------------------------------------
    if (timing) this.recorder.push(dt, this.time, c, inp, Math.max(0, this.lapS));
    this.#ghost(dt, timing, len);

    if (timing) this.#snapshot(dt);

    // -- publish --------------------------------------------------------------
    L.phase = this.phase;
    L.timing = timing;
    L.time = timing ? this.time : 0;
    L.started = this.phase !== 'menu';
    L.distance = s;
    L.lapDistance = Math.max(0, this.lapS);
    L.progress = THREE.MathUtils.clamp(this.lapS / len, 0, 1);
    L.outLapRemaining = this.phase === 'outlap' ? -this.lapS : 0;
    L.trackLength = len;
    L.deltaColour = L.deltaValid ? (L.delta < 0 ? 'green' : 'red') : '';
    L.message = this.#message();
    this.state.flags.menu = this.menu.open || this.phase === 'menu';
    this.state.flags.started = this.phase !== 'menu';
  }

  #message() {
    const L = this.state.lap;
    if (this.phase === 'menu') return 'TIME TRIAL';
    if (this.phase === 'outlap') return `OUT-LAP · ${Math.max(0, Math.round(-this.lapS))} m TO THE LINE`;
    if (this.phase === 'result') {
      return `${L.lastValid ? 'LAP' : 'LAP DELETED'} ${fmtTime(L.last)}`;
    }
    if (!L.valid) return `LAP DELETED · ${L.invalidReason || 'TRACK LIMITS'}`;
    return '';
  }

  /** Sector 1/2/3 gates. Durations, not cumulative times — that is what the HUD wants. */
  #sectors(len, v) {
    const L = this.state.lap;
    if (!this.track?.sectorS) return;
    for (let i = 0; i < 3; i++) {
      if (L.sectorDone[i]) continue;
      const mark = Math.min(this.track.sectorS[i] ?? (len * (i + 1) / 3), len);
      if (this.lapS < mark) continue;
      const at = this.time - (this.lapS - mark) / v;
      const cum = i === 0 ? 0 : (i === 1 ? L.sector[0] : L.sector[0] + L.sector[1]);
      const dur = Math.max(0, at - cum);
      L.sector[i] = dur; L.sectorDone[i] = true;
      L.lastSectorColour[i] = this.#classifySector(i, dur, L.valid && this.sectorValid[i]);
      safeEmit(this.ctx.bus, 'sector', { i, time: dur, at, colour: L.lastSectorColour[i] });
    }
  }

  #beginLap() {
    const L = this.state.lap;
    L.number++;
    L.sector = [0, 0, 0]; L.sectorDone = [false, false, false];
    L.lastSectorColour = ['', '', ''];
    L.invalidatedAt = null;
    this.sectorValid = [true, true, true];
    this.excursion = null;
    this.recorder.reset();
    this.recorder.push(0, 0, this.state.car, this.state.input, 0, true);
    if (this.pendingBenefit) {
      this.pendingBenefit = false;
      L.valid = false;
      L.invalidReason = 'Track limits — advantage gained on the previous lap';
      L.invalidNext = false;
      this.sectorValid = [false, false, false];
    } else {
      L.valid = true; L.invalidReason = ''; L.invalidNext = false;
    }
    safeEmit(this.ctx.bus, 'lap:start', { number: L.number, valid: L.valid });
  }

  #classifySector(i, dur, valid) {
    const L = this.state.lap;
    if (!valid) return 'yellow';
    const all = L.bestSector[i], sess = L.sessionBestSector[i];
    let colour;
    if (all == null || dur < all) colour = 'purple';
    else if (sess == null || dur < sess) colour = 'green';
    else colour = 'yellow';
    if (all == null || dur < all) { L.bestSector[i] = dur; this.#saveBestSectors(); }
    if (sess == null || dur < sess) L.sessionBestSector[i] = dur;
    return colour;
  }

  #completeLap(lapTime) {
    const L = this.state.lap;
    // Sector 3's gate sits ON the start/finish line, so #sectors() can never win the race
    // against the lap rollover — close it out here, from the finished lap time, or S3 would
    // never register and lapValid would be permanently false.
    if (!L.sectorDone[2] && isFinite(lapTime) && lapTime > 0) {
      const dur = Math.max(0, lapTime - (L.sector[0] || 0) - (L.sector[1] || 0));
      L.sector[2] = dur; L.sectorDone[2] = true;
      L.lastSectorColour[2] = this.#classifySector(2, dur, L.valid && this.sectorValid[2]);
      safeEmit(this.ctx.bus, 'sector', { i: 2, time: dur, at: lapTime, colour: L.lastSectorColour[2] });
    }
    const valid = L.valid && L.sectorDone.every(Boolean);
    L.last = lapTime;
    L.lastValid = valid;
    this.dbg.laps++;

    let pb = false;
    if (valid && isFinite(lapTime) && lapTime > 5) {
      pb = this.leaderboard.add({
        time: lapTime, sectors: L.sector.slice(), valid: true,
        assists: { ...(this.ctx.get('input')?.assists?.settings ?? {}) },
        source: this.state.input.source,
      });
      L.leaderboard = this.leaderboard.top(10);
      L.best = this.leaderboard.best()?.time ?? null;
      L.bestValid = L.best;
      if (pb) {
        const lap = this.recorder.finalise(lapTime, L.sector.slice(), Math.max(0, this.lapS));
        if (lap) {
          this.pbGhost = lap;
          saveGhost(lap);
          this.overlay.build(lap);
        }
      }
    }

    this.phase = 'result';
    this.resultT = RESULT_TIME;
    L.result = {
      time: lapTime, valid, pb,
      sectors: L.sector.slice(), colours: L.lastSectorColour.slice(),
      delta: L.deltaValid ? L.delta : null,
      reason: valid ? '' : (L.invalidReason || 'Track limits'),
    };
    safeEmit(this.ctx.bus, 'lap:complete', { time: lapTime, valid, pb, sectors: L.sector.slice() });
    this.menu.showToast(
      valid ? (pb ? 'Personal best' : 'Lap complete') : 'Lap deleted',
      `${fmtTime(lapTime)} &middot; ${L.sector.map(fmtSector).join(' / ')}`,
    );
    this.menu.refresh();
  }

  // -------------------------------------------------------------- the ghost --
  #ghost(dt, timing, len) {
    const L = this.state.lap, g = L.ghost;
    g.available = !!this.pbGhost;
    g.enabled = this.ghostEnabled;
    g.telemetry = this.overlay?.mode ?? 'off';
    g.pbTime = this.pbGhost?.time ?? null;

    const live = this.ghostEnabled && this.pbGhost && timing;
    if (!live) {
      g.active = false;
      this.ghostCar.setVisible(false);
      if (!this.pbGhost || !timing) { L.deltaValid = false; L.delta = 0; }
      return;
    }

    // --- continuous delta: the ghost's time at OUR exact track distance --------
    const sHere = THREE.MathUtils.clamp(this.lapS, 0, this.pbGhost.length);
    const gt = this.pbGhost.timeAtDistance(sHere);
    if (gt != null && isFinite(gt) && this.lapS >= 0) {
      L.delta = this.time - gt;
      L.deltaValid = true;
      g.delta = L.delta;
    } else { L.deltaValid = false; L.delta = 0; }

    // --- replay: pose at the same elapsed time --------------------------------
    const alive = this.pbGhost.poseAtTime(this.time, this.pose);
    g.active = alive;
    this.ghostCar.setVisible(alive);
    if (alive) {
      this.ghostCar.apply(this.pose, dt);
      g.position.copy(this.pose.position);
      g.quaternion.copy(this.pose.quaternion);
      g.time = this.time;
      g.progress = THREE.MathUtils.clamp(this.pose.s / len, 0, 1);
      g.kph = this.pose.kph; g.throttle = this.pose.throttle;
      g.brake = this.pose.brake; g.gear = this.pose.gear;
      g.gap = this.pose.s - this.lapS;         // metres: + means the ghost is ahead
    }
  }
}

const _w = new THREE.Vector3();

/**
 * The shared Bus is synchronous and does not isolate listeners: a throw inside any
 * subscriber propagates back into the emitter and would take this module's frame with
 * it. Every emit from here goes through this guard. (See docs/REQUESTS.md — the fix
 * belongs in core/bus.js, which GAME/INPUT do not own.)
 */
function safeEmit(bus, event, payload) {
  try { bus.emit(event, payload); }
  catch (e) { if (!safeEmit.seen?.has(event)) { (safeEmit.seen ??= new Set()).add(event); console.warn(`[bus] a listener for "${event}" threw:`, e?.message); } }
}
