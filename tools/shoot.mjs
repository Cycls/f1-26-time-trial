/**
 * Headless capture + telemetry harness.
 *   node tools/shoot.mjs --out shots/x --shots cam:tvpod@s=1200,cam:cockpit@s=2400 --w 1600 --h 900
 * Options:
 *   --out <dir>     output directory (default shots/latest)
 *   --shots <list>  comma list of  cam:<mode>@s=<metres>[&kph=<n>]  ; or "drive" for an autopilot run
 *   --drive <sec>   run the AI autopilot for N seconds and log telemetry
 *   --w --h         viewport size
 * Always writes: console.log, errors.json, telemetry.json
 */
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const A = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean)
  .map(s => { const [k, ...v] = s.trim().split(/\s+/); return [k, v.join(' ')]; }));
const OUT = path.resolve(A.out ?? 'shots/latest');
const W = +(A.w ?? 1600), H = +(A.h ?? 900);
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
page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', e => errors.push(String(e.stack || e)));
page.on('requestfailed', r => errors.push(`REQFAIL ${r.url()} ${r.failure()?.errorText}`));

await page.goto('http://localhost:8123/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
try {
  await page.waitForFunction('window.__F1 && window.__F1.state.flags.ready', { timeout: 45000 });
} catch { errors.push('TIMEOUT: window.__F1 never became ready'); }
await new Promise(r => setTimeout(r, 1500));

// --- deterministic pose helper injected into the page ---
await page.evaluate(() => {
  window.__pose = (s, kph, lateral = 0) => {
    const T = window.__THREE;
    const g = window.__F1, tr = g.modules.get('track'), ph = g.modules.get('physics');
    const t = tr.sampleS(s);
    ph.pos.copy(t.point).addScaledVector(t.right, lateral).add(new T.Vector3(0, 0.32, 0));
    ph.quat.setFromUnitVectors(new T.Vector3(0, 0, 1), t.tangent.clone().setY(0).normalize());
    ph.vel.copy(t.tangent).multiplyScalar(kph / 3.6);
    ph.hintS = s; ph.gear = Math.max(1, Math.min(8, Math.round(kph / 45)));
    ph.rpm = 9000 + (kph / 340) * 5000;
    g.state.input.throttle = 0.85; g.state.input.brake = 0;
    for (let i = 0; i < 40; i++) g.step(1 / 60);
  };
  window.__cam = (m) => { const c = window.__F1.modules.get('camera'); if (c) c.mode = m; window.__F1.state.camera.mode = m; };
  window.__telemetry = () => {
    const s = window.__F1.state, R = window.__F1.renderer;
    R.info.autoReset = false; R.info.reset(); window.__F1.step(1 / 60);
    return { kph: s.car.kph, rpm: s.car.rpm, gear: s.car.gear, latG: s.car.lateralG, longG: s.car.longG,
      ers: s.car.ers, downforce: s.car.downforce, drag: s.car.drag, aeroMode: s.car.aeroMode,
      fps: s.render.fps, drawCalls: s.render.drawCalls, tris: s.render.triangles,
      s: s.lap.distance, valid: s.lap.valid, lapTime: s.lap.time, wheelsOff: s.car.wheelsOff,
      grip: s.car.wheel.map(w => +w.gripUse.toFixed(2)), load: s.car.wheel.map(w => Math.round(w.load)) };
  };
});

const telemetry = {};
const shots = (A.shots ?? 'cam:tvpod@s=300,cam:cockpit@s=2450,cam:chase@s=4100').split(',').map(s => s.trim()).filter(Boolean);
for (const spec of shots) {
  const m = /^cam:(\w+)@s=(\d+)(?:&kph=(\d+))?(?:&lat=(-?\d+))?$/.exec(spec);
  if (!m) { errors.push('bad shot spec ' + spec); continue; }
  const [, mode, s, kph, lat] = m;
  await page.evaluate((mo, ss, kk, ll) => { window.__cam(mo); window.__pose(+ss, +kk, +ll); }, mode, s, +(kph ?? 240), +(lat ?? 0));
  await new Promise(r => setTimeout(r, 700));
  const name = `${mode}_s${s}.png`;
  await page.screenshot({ path: path.join(OUT, name) });
  telemetry[name] = await page.evaluate(() => window.__telemetry());
  console.log('shot', name, telemetry[name].kph?.toFixed?.(0) + 'kph', telemetry[name].drawCalls + ' calls');
}

if (A.drive) {
  const secs = +A.drive; const trace = [];
  await page.evaluate(() => { window.__F1.state.input.throttle = 1; });
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < secs) {
    trace.push(await page.evaluate(() => window.__telemetry()));
    await new Promise(r => setTimeout(r, 250));
  }
  fs.writeFileSync(path.join(OUT, 'drive-trace.json'), JSON.stringify(trace, null, 1));
}

fs.writeFileSync(path.join(OUT, 'telemetry.json'), JSON.stringify(telemetry, null, 1));
fs.writeFileSync(path.join(OUT, 'console.log'), logs.join('\n'));
fs.writeFileSync(path.join(OUT, 'errors.json'), JSON.stringify(errors, null, 1));
console.log(errors.length ? `\n!! ${errors.length} ERRORS:\n` + errors.slice(0, 12).join('\n') : '\nno page errors');
await browser.close();
