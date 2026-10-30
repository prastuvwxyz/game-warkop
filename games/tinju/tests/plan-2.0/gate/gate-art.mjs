// A-na gate 2.0.0 — pixel statistics for the boxer art and for screenshots (no human eye involved).
// Usage: node gate-art.mjs <path-to-games/tinju> <png>...
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const T = process.argv[2], pngs = process.argv.slice(3);
const pw = createRequire('/home/prastuvwxyz/.nalar/workspaces/stella/bullscows/node_modules/x.js')('playwright');
const b = await pw.chromium.launch({ executablePath: '/home/prastuvwxyz/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell' });
const p = await (await b.newContext({ viewport: { width: 400, height: 400 } })).newPage();
await p.setContent('<canvas id=c width=200 height=200></canvas>');
const POSES = ['idle', 'jab', 'uppercut', 'block', 'ouch', 'ko', 'win'];
const SK = [{ body: '#e6e3ff', acc: '#9d8cff', glove: '#ffd28a' }, { body: '#ffe9c4', acc: '#ff9d6b', glove: '#9d8cff' }, { body: '#d6f5ea', acc: '#4fbf9f', glove: '#ffd28a' }, { body: '#ffd9e4', acc: '#ff6b8a', glove: '#e6e3ff' }];
const PAL = { bg: '#14122b', surface: '#221f45', ink: '#e6e3ff', accent: '#9d8cff', hi: '#ffd28a', danger: '#ff6b8a' };
const raw = Object.fromEntries(POSES.map(k => [k, fs.readFileSync(path.join(T, 'assets', 'img', `boxer-${k}.svg`), 'utf8')]));
const stats = await p.evaluate(async ({ raw, SK, POSES, PAL }) => {
  const c = document.getElementById('c'), x = c.getContext('2d');
  const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const pal = Object.entries(PAL).map(([k, v]) => [k, hex(v)]);
  const out = {}, masks = {};
  for (let s = 0; s < SK.length; s++) for (const pose of POSES) {
    let t = raw[pose].split('#e6e3ff').join('\u0001').split('#9d8cff').join('\u0002').split('#ffd28a').join('\u0003');
    t = t.split('\u0001').join(SK[s].body).split('\u0002').join(SK[s].acc).split('\u0003').join(SK[s].glove);
    const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t); await img.decode();
    x.clearRect(0, 0, 200, 200); x.drawImage(img, 0, 0, 200, 200);
    const d = x.getImageData(0, 0, 200, 200).data; let cov = 0, minX = 200, minY = 200, maxX = 0, maxY = 0; const cols = new Set(); const m = new Uint8Array(40000);
    for (let i = 0; i < 40000; i++) { if (d[i * 4 + 3] > 40) { cov++; m[i] = 1; const X = i % 200, Y = (i / 200) | 0; minX = Math.min(minX, X); maxX = Math.max(maxX, X); minY = Math.min(minY, Y); maxY = Math.max(maxY, Y); cols.add((d[i * 4] >> 4) + ',' + (d[i * 4 + 1] >> 4) + ',' + (d[i * 4 + 2] >> 4)); } }
    out[s + '/' + pose] = { coverage: +(cov / 400).toFixed(1), bbox: [minX, minY, maxX, maxY], colours: cols.size, w: img.naturalWidth, h: img.naturalHeight }; masks[s + '/' + pose] = m;
  }
  const diff = {}; for (const a of POSES) for (const bb of POSES) if (a < bb) { const A = masks['0/' + a], B = masks['0/' + bb]; let n = 0, u = 0; for (let i = 0; i < 40000; i++) { if (A[i] || B[i]) { u++; if (A[i] !== B[i]) n++; } } diff[a + '~' + bb] = +(100 * n / u).toFixed(1); }
  return { out, diff };
}, { raw, SK, POSES, PAL });
console.log('ART (rendered by me at 200x200 from assets/img/*.svg with the 4 palette swaps of src/art.js):');
for (const [k, v] of Object.entries(stats.out)) console.log(`  skin ${k}: ${v.w}x${v.h}, coverage ${v.coverage} %, bbox ${v.bbox.join(',')}, quantised colours ${v.colours}`);
const dv = Object.values(stats.diff); console.log(`  pose-to-pose silhouette difference (skin 0, % of union pixels): min ${Math.min(...dv)} max ${Math.max(...dv)} :: ${JSON.stringify(stats.diff)}`);
// screenshots: luminance, share of pixels near each card colour
for (const f of pngs) {
  const b64 = fs.readFileSync(f).toString('base64');
  const s = await p.evaluate(async ({ b64, PAL }) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height).data;
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); const pal = Object.entries(PAL).map(([k, v]) => [k, hex(v)]); const near = Object.fromEntries(pal.map(([k]) => [k, 0]));
    let lum = 0, n = d.length / 4; const cols = new Set();
    for (let i = 0; i < d.length; i += 4) { lum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; cols.add((d[i] >> 3) + ',' + (d[i + 1] >> 3) + ',' + (d[i + 2] >> 3)); for (const [k, [r, g, bb]] of pal) if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - bb) < 30) { near[k]++; break; } }
    return { w: c.width, h: c.height, lum: +(lum / n).toFixed(1), colours: cols.size, near: Object.fromEntries(Object.entries(near).map(([k, v]) => [k, +(100 * v / n).toFixed(1)])) }; }, { b64, PAL });
  console.log(`  ${path.basename(path.dirname(f))}/${path.basename(f)}: ${s.w}x${s.h}, mean luminance ${s.lum}/255, colours(5-bit) ${s.colours}, % near card colours ${JSON.stringify(s.near)}`);
}
await b.close();
