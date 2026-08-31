import puppeteer from 'puppeteer';
const b = await puppeteer.launch({headless:true,args:['--no-sandbox','--use-angle=metal','--enable-gpu','--enable-unsafe-swiftshader']});
const p = await b.newPage(); await p.setViewport({width:320,height:180});
await p.goto('http://localhost:8123/index.html',{waitUntil:'domcontentloaded'});
await p.waitForFunction('window.__F1&&window.__F1.state.flags.ready',{timeout:40000});
await new Promise(r=>setTimeout(r,1000));
const R = await p.evaluate(()=>{
  const g=window.__F1,T=window.__THREE,ph=g.modules.get('physics'),tr=g.modules.get('track');
  const S=g.state, H=1/120;
  const place=(s,kph)=>{ const t=tr.sampleS(s);
    ph.pos.copy(t.point).add(new T.Vector3(0,0.32,0));
    ph.quat.setFromUnitVectors(new T.Vector3(0,0,1), t.tangent.clone().setY(0).normalize());
    ph.vel.copy(t.tangent).multiplyScalar(kph/3.6); ph.hintS=s; };
  const set=(o)=>Object.assign(S.input,{steer:0,throttle:0,brake:0,override:false},o);
  const out={};
  // --- downforce vs speed ---
  out.downforce={};
  for (const kph of [80,150,180,190,250,300]) {
    place(300,kph); set({throttle:1});
    for(let i=0;i<60;i++) ph.fixedUpdate(H);
    out.downforce[kph]=+(S.car.downforce/9.81).toFixed(0); // kgf
  }
  // --- peak lateral G: ramp steering until grip saturates ---
  out.latG={};
  for (const kph of [80,150,250]) {
    let best=0;
    for (let st=0.1; st<=1.0; st+=0.1) {
      place(300,kph); set({throttle:0.35, steer:st});
      for(let i=0;i<180;i++){ ph.fixedUpdate(H); if(Math.abs(S.car.lateralG)>best) best=Math.abs(S.car.lateralG); }
    }
    out.latG[kph]=+best.toFixed(2);
  }
  // --- braking: 300 -> 100 km/h distance & peak decel ---
  place(300,300); set({brake:1});
  let d=0,peak=0,t=0; const p0=ph.pos.clone();
  while (S.car.kph>100 && t<12) { ph.fixedUpdate(H); t+=H; if(-S.car.longG>peak) peak=-S.car.longG; }
  d=ph.pos.distanceTo(p0);
  out.brake300to100_m=+d.toFixed(1); out.peakBrakeG=+peak.toFixed(2);
  // --- top speed on full throttle from 200 ---
  place(3400,200); set({throttle:1});
  let mx=0, trace=[];
  for(let i=0;i<120*30;i++){ ph.fixedUpdate(H); if(S.car.kph>mx)mx=S.car.kph; if(i%600===0) trace.push(+S.car.kph.toFixed(0)); }
  out.topSpeed_kph=+mx.toFixed(0); out.speedTrace=trace;
  out.gearCount=S.car.gearCount||g.config.car.gears; out.revLimit=g.config.car.revLimit;
  out.mass=g.config.car.mass; out.wheelbase=g.config.car.wheelbase; out.width=g.config.car.trackWidth;
  return out;
});
console.log(JSON.stringify(R,null,1));
await b.close();
