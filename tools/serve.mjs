import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const ROOT = path.resolve(process.argv[3] ?? '.');
const T = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
  '.hdr':'application/octet-stream', '.glb':'model/gltf-binary', '.ktx2':'application/octet-stream', '.bin':'application/octet-stream', '.wasm':'application/wasm' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404 ' + p); }
  res.writeHead(200, { 'content-type': T[path.extname(f)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(res);
}).listen(+(process.argv[2] ?? 8123), () => console.log('serving', ROOT, 'on', process.argv[2] ?? 8123));
