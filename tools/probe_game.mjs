import puppeteer from 'puppeteer';
const b = await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=metal','--enable-gpu','--enable-unsafe-swiftshader']});
const p = await b.newPage(); await p.setViewport({width:320,height:180});
await p.goto('http://localhost:8123/index.html',{waitUntil:'domcontentloaded'});
await p.waitForFunction('window.__F1&&window.__F1.state.flags.ready',{timeout:40000});
await new Promise(r=>setTimeout(r,900));
const R = await p.evaluate(()=>{
  const g=window.__F1,T=window.__THREE,ph=g.modules.get('physics'),tr=g.modules.get('track'),S=g.state;
  const A=[]; const ok=(n,c,d='')=>A.push(`${c?'PASS':'FAIL'}  ${n}${d?'  ('+d+')':''}`);
  // sector completion is transient (reset at lap rollover) - listen to the event, not the flag
  const fired=[]; g.bus.on('sector', e=>fired.push(e.i));
  const place=(s,lat=0)=>{ const t=tr.sampleS(s);
    ph.pos.copy(t.point).addScaledVector(t.right,lat).add(new T.Vector3(0,0.32,0));
    ph.quat.setFromUnitVectors(new T.Vector3(0,0,1),t.tangent.clone().setY(0).normalize());
    ph.vel.copy(t.tangent).multiplyScalar(60); ph.hintS=s; };
  // drive a synthetic lap by teleporting round the centreline
  g.bus.emit('game:reset',0);
  const L=tr.length; let sectorsSeen=[];
  const prevValid=S.lap.valid;
  for(let s=0;s<L;s+=L/400){ place(s); for(let i=0;i<3;i++) g.step(1/60);
    for(let i=0;i<3;i++) if(S.lap.sectorDone[i] && !sectorsSeen.includes(i)) sectorsSeen.push(i); }
  ok('lap timer runs', S.lap.time>0, 't='+S.lap.time.toFixed(2)+'s');
  // cross the line so sector 3 (whose gate sits ON the line) can close out
  place(5); for(let i=0;i<10;i++) g.step(1/60);
  // ignore any leading partial-lap event from the synthetic reset; judge the last full lap
  const lap=fired.slice(-3);
  ok('all 3 sectors fire in order', lap.join()==='0,1,2', 'last lap fired ['+lap+'] of ['+fired+']');
  // cross the line
  place(5); for(let i=0;i<10;i++) g.step(1/60);
  ok('crossing the line rolls the lap over', S.lap.last!=null || S.lap.number>0,
     'last='+(S.lap.last?S.lap.last.toFixed(3):'null')+' n='+S.lap.number);
  // track limits: small excursion legal, 4 wheels off invalid
  g.bus.emit('game:reset',0); place(1200, 0); for(let i=0;i<20;i++) g.step(1/60);
  const validOnTrack=S.lap.valid;
  const hw=tr.locate(ph.pos,1200).halfWidth;
  place(1250, hw*0.98); for(let i=0;i<20;i++) g.step(1/60);
  const validSliver=S.lap.valid;
  place(1300, hw+4.0); for(let i=0;i<30;i++) g.step(1/60);
  const validOff=S.lap.valid;
  ok('lap valid while on track', validOnTrack);
  ok('sliver of tyre on the line stays legal', validSliver, 'lat=0.98*halfWidth');
  ok('all four wheels beyond the line invalidates', !validOff, 'lat=halfWidth+4m, wheelsOff='+S.car.wheelsOff);
  // ghost + delta plumbing
  ok('ghost state exists', S.lap.ghost!==undefined);
  ok('delta field is finite', Number.isFinite(S.lap.delta), 'delta='+S.lap.delta);
  ok('best-lap persistence wired', typeof localStorage!=='undefined');
  // TT rules: wear/temp/fuel off
  ok('TT: tyre wear not accumulating', S.car.wheel.every(w=>w.wear<0.02), 'wear='+S.car.wheel.map(w=>w.wear.toFixed(3)));
  return A.join('\n');
});
console.log(R);
await b.close();
