// STEP 1 — @core block, mulberry32, nextSpawn, store, perf fixes; pipes only.
import fs from 'node:fs';
import { INDEX, loadCore, coreSource, mulberry32, v2new, v2step, v2bot } from './lib.mjs';
import { lintAll } from './lint.mjs';

export const SEEDS50 = Array.from({ length: 50 }, (_, i) => i + 1);

// Drives v2step and v3 step side by side; compares with === every frame. Returns stats.
export function parityRun(core, seed, mode, stopScore = 15) {
  const r2 = mulberry32(seed), w = core.createWorld(seed, 0), s = v2new(), fz = mulberry32(seed ^ 0x5eed);
  let frames = 0, cmp = 0, bad = null, flaps = 0;
  while (!s.dead && s.score < stopScore && frames < 20000) {
    let f;
    if (mode === 'bot') f = v2bot(s);
    else if (mode === 'fuzz') f = fz() < 0.1;
    else f = v2bot(s) !== (fz() < 0.04);                 // noisy bot: 4% of decisions flipped
    if (f) flaps++;
    v2step(s, r2, f); core.step(w, f); frames++;
    const b = w.bird, p = s.bird;
    const same = b.y === p.y && b.v === p.v && w.score === s.score && w.dead === s.dead && w.obs.length === s.pipes.length &&
      w.speed === 2.4 && w.obs.every((o, i) => o.x === s.pipes[i].x && o.top === s.pipes[i].top && o.passed === s.pipes[i].passed && o.type === 'pipe' && o.gap === 150 && o.w === 56);
    cmp++;
    if (!same) { bad = { frame: frames, v3: { y: b.y, v: b.v, score: w.score, n: w.obs.length }, v2: { y: p.y, v: p.v, score: s.score, n: s.pipes.length } }; break; }
  }
  return { frames, cmp, bad, flaps, score: s.score, dead: s.dead };
}

export default async function ({ check, section }) {
  section('STEP 1 — core in empty vm, parity vs v2step, lint');
  const src = coreSource();
  const forbidden = ['document', 'window', 'localStorage', 'Math.random', 'performance', 'Date', 'AudioContext', 'requestAnimationFrame', 'canvas', 'getContext'];
  const stripped = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const f of forbidden) check(`core source has no "${f}"`, !stripped.includes(f));
  let core; try { core = loadCore(); } catch (e) { check('core loads in empty vm context', false, e.message); return; }
  check('core loads in empty vm context (Math.random / Date.now booby-trapped)', typeof core.createWorld === 'function' && typeof core.step === 'function');
  // physics constants
  const K = core;
  check('physics constants G=0.45 FLAP=-7.5 R=14 GAP=150 PIPE_W=56 SPAWN=95 SPEED=2.4', K.G === 0.45 && K.FLAP === -7.5 && K.R === 14 && K.GAP === 150 && K.PIPE_W === 56 && K.SPAWN === 95 && K.SPEED === 2.4);
  const html = fs.readFileSync(INDEX, 'utf8');
  check('STEP = 1000/60 loop unchanged in source', /const STEP=1000\/60;let last=performance\.now\(\),acc=0;/.test(html) && /while\(acc>=STEP\)\{update\(\);acc-=STEP;\}/.test(html) && /acc\+=Math\.min\(now-last,250\)/.test(html));
  // mulberry32 identical to the reference one
  { const a = mulberry32(12345), b = core.mulberry32(12345); let ok = true; for (let i = 0; i < 1000; i++) if (a() !== b()) { ok = false; break; } check('core mulberry32 === reference mulberry32 (1000 draws)', ok); }
  // snapshot-able rand: world.rand state restore reproduces the stream
  { const w = core.createWorld(7, 0); for (let i = 0; i < 5; i++) w.rand(); const sn = core.snapshotWorld(w); const a = [w.rand(), w.rand()]; core.restoreWorld(w, sn); check('snapshot/restore replays rand stream', w.rand() === a[0] && w.rand() === a[1]); }
  // parity: 50 seeds x 3 input modes
  let total = 0, runs = 0, maxScore = 0, fails = [], deaths = 0, flaps = 0;
  const t = Date.now();
  for (const seed of SEEDS50) for (const mode of ['bot', 'fuzz', 'noisybot']) {
    const r = parityRun(core, seed, mode); runs++; total += r.cmp; flaps += r.flaps; maxScore = Math.max(maxScore, r.score); if (r.dead) deaths++;
    if (r.bad) fails.push(`seed ${seed} ${mode}: ${JSON.stringify(r.bad)}`);
  }
  check(`full-run parity vs v2step, 50 seeds x 3 input modes (${runs} runs, ${total} frames compared with ===)`, fails.length === 0, fails.slice(0, 3).join(' | '));
  console.log(`  parity detail: ${runs} runs, ${total} frame comparisons, ${deaths} runs ended in a death (same frame on both sides), max score ${maxScore}, ${flaps} flaps, ${Date.now() - t} ms`);
  { // bot runs must actually reach 15 on every seed (otherwise the run proves little)
    let reached = 0; for (const seed of SEEDS50) { const r = parityRun(core, seed, 'bot'); if (r.score >= 15) reached++; }
    check('bot-driven parity runs reach score 15 on all 50 seeds', reached === 50, reached + '/50');
  }
  // stats: with pipes only the scheduler consumed exactly one rand per spawn
  { const w = core.createWorld(99, 0), r = mulberry32(99); const s = v2new(); let f = 0; while (w.spawns < 40 && f < 99999) { const fl = v2bot(s); v2step(s, r, fl); core.step(w, fl); f++; if (s.dead) break; }
    check('first spawn at playFrame 95, then every 95 (nextSpawn)', w.spawns >= 3 && w.nextSpawn === 95 * (w.spawns + 1), `spawns ${w.spawns} nextSpawn ${w.nextSpawn}`); }
  // lint
  const L = lintAll();
  check(`lint: no filter( map( new  String( create*Gradient array-literals in hot @core fns and draw* fns (${L.scanned.length} scanned)`, L.violations.length === 0, L.violations.join('; '));
  check('storage reads are guarded (no bare localStorage outside store)', (html.match(/localStorage/g) || []).length === 3 && /get\(k\)\{try\{return localStorage/.test(html));
  check('single file, zero external assets', !/\b(src|href)=["'](?!data:)/.test(html.replace(/<link id="icon"[^>]*>/, '')) && !/url\(\s*['"]?https?:/.test(html) && !/\bimport\s|fetch\(/.test(html));
}
