/**
 * THROWAWAY HUD state probe (owner: UI).
 * Drives state.lap.* / state.car.* directly so the HUD can be photographed in states the
 * normal capture harness never produces: sector colours, an invalidated lap, Overtake,
 * the lap-result panel and the fallback start screen.
 *
 *   node tools/probe_hud.mjs --out shots/hudp --w 1600 --h 900
 *   node tools/probe_hud.mjs --out shots/hud4k --w 3840 --h 2160 --only hot
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const A = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map((s) => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ')]; }));
const OUT = path.resolve(A.out ?? 'shots/hudprobe');
const W = +(A.w ?? 1600), H = +(A.h ?? 900);
const ONLY = A.only ? A.only.split(',').map((s) => s.trim()) : null;
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--enable-webgl', '--disable-dev-shm-usage',
    '--hide-scrollbars', `--window-size=${W},${H}`],
});
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
const logs = [], errors = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => errors.push(String(e.stack || e)));

const HELPERS = `
window.__pose = (s, kph, mode) => {
  const T = window.__THREE, g = window.__F1;
  const tr = g.modules.get('track'), ph = g.modules.get('physics');
  const t = tr.sampleS(s);
  ph.pos.copy(t.point).add(new T.Vector3(0, 0.32, 0));
  ph.quat.setFromUnitVectors(new T.Vector3(0, 0, 1), t.tangent.clone().setY(0).normalize());
  ph.vel.copy(t.tangent).multiplyScalar(kph / 3.6);
  ph.hintS = s; ph.gear = Math.max(1, Math.min(8, Math.round(kph / 45)));
  ph.rpm = 8200 + (kph / 340) * 4600;
  g.state.input.throttle = 0.95; g.state.input.brake = 0;
  const c = g.modules.get('camera'); if (c) c.mode = mode; g.state.camera.mode = mode;
  for (let i = 0; i < 40; i++) g.step(1 / 60);
};
window.__freeze = () => {
  const g = window.__F1;
  for (const p of [['game','update'],['physics','fixedUpdate'],['physics','update']]) {
    const m = g.modules.get(p[0]); if (m && m[p[1]]) m[p[1]] = () => {};
  }
  const tt = document.getElementById('tt-menu'); if (tt) tt.style.display = 'none';
  const to = document.getElementById('tt-toast'); if (to) to.style.display = 'none';
};
window.__apply = (o) => {
  const s = window.__F1.state;
  Object.assign(s.lap, o.lap || {});
  Object.assign(s.car, o.car || {});
  Object.assign(s.input, o.input || {});
  if (o.flags) Object.assign(s.flags, o.flags);
  if (o.energy && window.__hud) window.__hud.energy = o.energy;
  if (o.hud && window.__hud) Object.assign(window.__hud, o.hud);
};
1;`;

async function load() {
  await page.goto('http://localhost:8123/index.html', { waitUntil: 'domcontentloaded', timeout: 90000 });
  try { await page.waitForFunction('window.__F1 && window.__F1.state.flags.ready', { timeout: 60000 }); }
  catch { errors.push('TIMEOUT: __F1 never ready'); }
  await new Promise((r) => setTimeout(r, 1800));
  await page.evaluate(HELPERS);
}
await load();

const LB = [
  { time: 91.992, sectors: [30.412, 33.106, 28.474], valid: true, date: Date.now() },
  { time: 92.418, sectors: [30.602, 33.310, 28.506], valid: true, date: Date.now() },
  { time: 93.101, sectors: [30.880, 33.502, 28.719], valid: true, date: Date.now() },
];

const SCENES = {
  // flat out on the back straight, S1 purple / S2 green, ghost delta green
  hot: {
    pose: [3400, 322, 'tvpod'],
    apply: {
      lap: {
        number: 3, time: 68.412, valid: true, started: true, phase: 'flying', timing: true,
        best: 91.992, last: 92.418, lastValid: true,
        sector: [30.244, 33.106, 0], sectorDone: [true, true, false],
        lastSectorColour: ['purple', 'green', ''],
        bestSector: [30.412, 33.106, 28.474], sessionBestSector: [30.244, 33.106, 28.474],
        delta: -0.412, deltaValid: true, deltaColour: 'green',
        wheelsBeyond: 0, leaderboard: LB,
        ghost: { active: true, progress: 0.63, enabled: true, available: true },
        rules: { tyreWear: false, ersAuto: true },
      },
      car: { ers: 0.62, ersDeploy: 1, aeroMode: 'X', overrideActive: false, rpm: 12180, gear: 8, kph: 322 },
      energy: { deploy: 5.4, harvest: 6.9 },
    },
  },
  // slow corner, lap deleted for track limits, S1 yellow
  deleted: {
    pose: [1150, 88, 'cockpit'],
    apply: {
      lap: {
        number: 4, time: 12.884, valid: false, started: true, phase: 'flying', timing: true,
        invalidReason: 'Track limits — all four wheels beyond the line',
        best: 91.992, last: 93.101, lastValid: true,
        sector: [31.204, 0, 0], sectorDone: [true, false, false],
        lastSectorColour: ['yellow', '', ''],
        bestSector: [30.412, 33.106, 28.474], sessionBestSector: [30.244, 33.106, 28.474],
        delta: 0.287, deltaValid: true, wheelsBeyond: 4, leaderboard: LB,
        ghost: { active: true, progress: 0.21, enabled: true, available: true },
      },
      car: { ers: 0.31, ersDeploy: 0, aeroMode: 'Z', overrideActive: false, rpm: 8600, gear: 2, kph: 88 },
      energy: { deploy: 8.1, harvest: 8.5 },
      hud: { warnUntil: 1e9, warnText: 'LAP DELETED — ALL FOUR WHEELS BEYOND THE LINE', warnKind: 'bad2' },
    },
  },
  // Overtake engaged: the whole HUD turns blue
  overtake: {
    pose: [300, 331, 'tvpod'],
    apply: {
      lap: {
        number: 3, time: 4.118, valid: true, started: true, phase: 'flying', timing: true,
        best: 91.992, last: 92.418, lastValid: true,
        sector: [0, 0, 0], sectorDone: [false, false, false], lastSectorColour: ['', '', ''],
        bestSector: [30.412, 33.106, 28.474], delta: -0.058, deltaValid: true,
        wheelsBeyond: 0, leaderboard: LB,
        ghost: { active: true, progress: 0.05, enabled: true, available: true },
      },
      car: { ers: 0.88, ersDeploy: 1, aeroMode: 'X', overrideActive: true, rpm: 12460, gear: 8, kph: 331 },
      energy: { deploy: 1.2, harvest: 2.4 },
    },
  },
  // lap-complete result panel, personal best
  result: {
    pose: [180, 296, 'chase'],
    apply: {
      lap: {
        number: 4, time: 3.204, valid: true, started: true, phase: 'result', timing: true,
        best: 91.418, last: 91.418, lastValid: true,
        sector: [30.244, 33.002, 28.172], sectorDone: [true, true, true],
        lastSectorColour: ['purple', 'purple', 'green'],
        bestSector: [30.244, 33.002, 28.172], delta: -0.574, deltaValid: true,
        leaderboard: [{ time: 91.418, valid: true }, ...LB],
        result: {
          time: 91.418, valid: true, pb: true,
          sectors: [30.244, 33.002, 28.172], colours: ['purple', 'purple', 'green'], delta: -0.574,
        },
      },
      car: { ers: 0.95, ersDeploy: 0.4, aeroMode: 'Z', rpm: 11200, gear: 7, kph: 296 },
      energy: { deploy: 0.4, harvest: 0.9 },
    },
    after: () => window.__hud.showResult({ time: 91.418, pb: true, valid: true, gap: -0.574 }),
  },
  // the fallback start screen (shown only when GAME does not ship a menu)
  menu: {
    pose: [5150, 0, 'tvpod'],
    apply: {
      lap: { best: 91.992, leaderboard: LB },
      flags: { menu: true },
      hud: { ownMenu: true },
    },
    after: () => { window.__hud.hud.classList.add('own-menu'); window.__hud.setScreen('menu'); },
  },
};

for (const [name, sc] of Object.entries(SCENES)) {
  if (ONLY && !ONLY.includes(name)) continue;
  await page.evaluate((p) => window.__pose(p[0], p[1], p[2]), sc.pose);
  await page.evaluate(() => window.__freeze());
  await page.evaluate((o) => window.__apply(o), sc.apply);
  if (sc.apply.hud && sc.apply.hud.warnKind) {
    await page.evaluate((k) => { window.__hud.el.warn.dataset.k = k; }, sc.apply.hud.warnKind);
  }
  if (sc.after) await page.evaluate(`(${sc.after.toString()})()`);
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log('probe shot', name);
  await load();   // the frozen modules only come back with a fresh page
}

fs.writeFileSync(path.join(OUT, 'console.log'), logs.join('\n'));
fs.writeFileSync(path.join(OUT, 'errors.json'), JSON.stringify(errors, null, 1));
console.log(errors.length ? `\n!! ${errors.length} ERRORS:\n` + errors.slice(0, 10).join('\n') : '\nno page errors');
await browser.close();
