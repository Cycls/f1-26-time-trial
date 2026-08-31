/**
 * Build a BLIND A/B comparison folder.
 *   node tools/blind.mjs <outdir> <oursImage> <refImage> [<oursImage2> <refImage2> ...]
 * Normalises every image to identical format/resolution/metadata so neither side is
 * identifiable by anything except its content, shuffles the assignment, writes
 * <outdir>/pairN/A.jpg and B.jpg, and stores the answer key OUTSIDE outdir.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [outdir, ...imgs] = process.argv.slice(2);
if (!outdir || imgs.length < 2 || imgs.length % 2) {
  console.error('usage: node tools/blind.mjs <outdir> <ours> <ref> [<ours> <ref> ...]'); process.exit(1);
}
const W = 1280, H = 720;
fs.rmSync(outdir, { recursive: true, force: true });
fs.mkdirSync(outdir, { recursive: true });
const key = [];
for (let i = 0; i < imgs.length; i += 2) {
  const pair = path.join(outdir, `pair${i / 2 + 1}`);
  fs.mkdirSync(pair, { recursive: true });
  // unbiased coin
  const flip = crypto.randomInt(2) === 0;
  const slots = flip ? ['A', 'B'] : ['B', 'A'];
  const src = [imgs[i], imgs[i + 1]];              // [ours, ref]
  for (let k = 0; k < 2; k++) {
    const dst = path.join(pair, `${slots[k]}.jpg`);
    // sips: force identical pixel dims, identical JPEG encoder, strip profile differences
    execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80',
      '-z', String(H), String(W), src[k], '--out', dst], { stdio: 'ignore' });
  }
  // Defeat side-channels: equalise byte size (trailing bytes after JPEG EOI are ignored by
  // decoders) and mtime, so neither ls -l nor stat can reveal which side is which.
  const fa = path.join(pair, 'A.jpg'), fb = path.join(pair, 'B.jpg');
  const sa = fs.statSync(fa).size, sb = fs.statSync(fb).size;
  const target = Math.max(sa, sb) + 512;
  for (const f of [fa, fb]) {
    const need = target - fs.statSync(f).size;
    if (need > 0) fs.appendFileSync(f, Buffer.alloc(need, 0x20));
  }
  const when = new Date(946684800000);
  for (const f of [fa, fb]) fs.utimesSync(f, when, when);
  key.push({ pair: `pair${i / 2 + 1}`, A: flip ? 'OURS' : 'REFERENCE', B: flip ? 'REFERENCE' : 'OURS',
             oursFile: src[0], refFile: src[1] });
}
fs.writeFileSync(outdir + '.key.json', JSON.stringify(key, null, 1));
console.log('blind set ->', outdir);
console.log('key (NOT for the critic) ->', outdir + '.key.json');
for (const k of key) console.log(' ', k.pair, 'A=' + k.A, 'B=' + k.B);
