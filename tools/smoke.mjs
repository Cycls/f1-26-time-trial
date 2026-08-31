/** Integration smoke test: every module must construct, init, and run without throwing. */
import puppeteer from 'puppeteer';
const W = 1280, H = 720;
const browser = await puppeteer.launch({ headless: true,
  args: ['--no-sandbox', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist',
    '--enable-unsafe-swiftshader', '--enable-webgl', '--disable-dev-shm-usage', `--window-size=${W},${H}`] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
const errs = [], warns = [];
page.on('console', m => { const t = m.text();
  if (m.type() === 'error') errs.push(t); else if (m.type() === 'warning') warns.push(t); });
page.on('pageerror', e => errs.push('PAGEERROR ' + (e.stack || e)));
page.on('requestfailed', r => errs.push('REQFAIL ' + r.url()));
await page.goto('http://localhost:8123/index.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
let ready = true;
try { await page.waitForFunction('window.__F1 && window.__F1.state.flags.ready', { timeout: 45000 }); }
catch { ready = false; }
await new Promise(r => setTimeout(r, 2500));

const rep = await page.evaluate(() => {
  const g = window.__F1; if (!g) return { fatal: 'window.__F1 missing' };
  // renderer.info is auto-reset on every render() call, so the composer's final pass zeroes it.
  // Take manual control so the counters cover the WHOLE frame, post passes included.
  g.renderer.info.autoReset = false;
  const want = ['render','track','env','car','physics','input','camera','vfx','audio','hud','game'];
  const mods = {};
  for (const n of want) { const m = g.modules.get(n); mods[n] = m ? m.constructor.name : 'MISSING'; }
  const s = g.state;
  // step the sim to shake out per-frame throws
  let stepErr = null;
  try { for (let i = 0; i < 240; i++) g.step(1 / 60); } catch (e) { stepErr = String(e); }
  return { mods, stepErr,
    scene: { children: g.scene.children.length },
    car: { kph: s.car.kph, rpm: s.car.rpm, gear: s.car.gear, ers: s.car.ers,
           pos: [s.car.position.x, s.car.position.y, s.car.position.z].map(v => +v.toFixed(1)),
           latG: +s.car.lateralG.toFixed(2), longG: +s.car.longG.toFixed(2), aero: s.car.aeroMode },
    lap: { t: +s.lap.time.toFixed(2), dist: +s.lap.distance.toFixed(0), valid: s.lap.valid },
    render: { calls: g.renderer.info.render.calls, tris: g.renderer.info.render.triangles,
              progs: g.renderer.info.programs?.length ?? -1,
              texMem: g.renderer.info.memory.textures, geoMem: g.renderer.info.memory.geometries },
    track: { len: g.modules.get('track')?.length } };
});
console.log('ready:', ready);
console.log(JSON.stringify(rep, null, 1));
const uniq = [...new Set(errs)];
console.log(`\n--- ${uniq.length} unique console errors ---`);
uniq.slice(0, 25).forEach(e => console.log('  ' + e.slice(0, 300)));
const missing = Object.entries(rep.mods ?? {}).filter(([, v]) => v === 'MISSING');
console.log(missing.length ? `\nMISSING MODULES: ${missing.map(m => m[0])}` : '\nall modules present');
await browser.close();
process.exit(uniq.length || missing.length || !ready ? 1 : 0);
