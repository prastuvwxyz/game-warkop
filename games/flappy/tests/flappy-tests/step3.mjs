// STEP 3 — slide, double, narrow, scheduler pacing.
import { loadCore, mulberry32 } from './lib.mjs';
import { oracle } from './oracle.mjs';
import { parityRun, SEEDS50 } from './step1.mjs';
import { ORACLE_SEEDS } from './step2.mjs';

const ghost = (core, w) => { w.ev = 0; w.dead = false; w.bird.y = 320; w.bird.v = 0; core.stepWorld(w); };

// Independent re-statement of F1..F5 (brute force over frames, no shared helper with the core).
function indepFair(core, prev, o, speed) {
  const { R, GROUND } = core, BXc = 80, out = new Float64Array(32), tmp = new Float64Array(32);
  const overlap = (ob, k) => { const px = ob.x - speed * k; return BXc + R > px && BXc - R < px + ob.w; };
  const room = (ob, k) => {                                         // largest free stretch of the bird centre, by 0.5 px scan
    const n = ob.def.blocked(ob, k, out); let best = 0, run = 0;
    for (let y = R; y <= GROUND - R; y += 0.5) { let b = false; for (let i = 0; i < n; i++) if (y > out[2 * i] && y < out[2 * i + 1]) { b = true; break; } if (b) run = 0; else { run += 0.5; if (run > best) best = run; } }
    return best;
  };
  let ke = -1, kl = -1; for (let k = 0; k < 400; k++) if (overlap(o, k)) { if (ke < 0) ke = k; kl = k; }
  const errs = [];
  if (ke < 72) errs.push('F2');
  if (prev && o.x - (prev.x + prev.w) < 90) errs.push('F3');
  let prevEdges = null, f1 = false, f5 = false;
  for (let k = ke; k <= kl; k++) {
    if (room(o, k) < 102 - 0.5) f1 = true;
    const n = o.def.blocked(o, k, tmp); const e = Array.from(tmp.subarray(0, 2 * n));
    if (prevEdges) for (let i = 0; i < e.length; i++) if (isFinite(e[i]) && Math.abs(e[i] - prevEdges[i]) > 2 + 1e-9) f5 = true;
    prevEdges = e;
  }
  if (f1) errs.push('F1'); if (f5) errs.push('F5');
  if (prev) {
    let kp = -1; for (let k = 0; k < 400; k++) if (overlap(prev, k)) kp = k;
    if (kp >= 0) {
      const free = (ob, k) => { const n = ob.def.blocked(ob, k, out); const arr = []; for (let y = R; y <= GROUND - R; y += 0.5) { let b = false; for (let i = 0; i < n; i++) if (y > out[2 * i] && y < out[2 * i + 1]) { b = true; break; } if (!b) arr.push(y); } return arr; };
      const P = free(prev, kp), Q = free(o, ke); let d = Infinity, j = 0;
      for (const p of P) { while (j < Q.length - 1 && Q[j] < p) j++; for (const q of [Q[Math.max(0, j - 1)], Q[j]]) d = Math.min(d, Math.abs(q - p)); }
      const avail = (o.x - 94) / speed - (prev.x + prev.w - 66) / speed;
      if (d > 4.5 * avail + 0.5) errs.push('F4');
    }
  }
  return errs;
}

export default async function ({ check, section }) {
  section('STEP 3 — slide / double / narrow, scheduler pacing, oracle at 0/15/25/35');
  const core = loadCore();
  check('registry order pipe,slide,double,narrow with from 0,15,25,35', core.OBSTS.map(d => d.id + ':' + d.from).join(',') === 'pipe:0,slide:15,double:25,narrow:35');
  check('slide gap 150, double 2x140 + 40 block, narrow gap 130 (not 120)', (() => { const w = core.createWorld(1, 0), r = () => 0.5; const mk = id => { const q = { def: core.OBST[id], gap: 150, blk: 0, gap2: 0, base: 0, top: 0, w: 56 }; q.def.spawn(q, r); return q; };
    const s = mk('slide'), d = mk('double'), n = mk('narrow'); return s.gap === 150 && d.gap === 140 && d.blk === 40 && d.gap2 === 140 && n.gap === 130; })());

  // parity below 15 with all four types registered
  { let bad = 0, frames = 0; for (const seed of SEEDS50) for (const m of ['bot', 'fuzz', 'noisybot']) { const r = parityRun(core, seed, m); frames += r.cmp; if (r.bad) bad++; }
    check(`parity below 15 still holds with slide/double/narrow registered (150 runs, ${frames} frames, ===)`, bad === 0, bad + ' diverged'); }

  // geometry: collide() agrees with blocked() ranges (the oracle's view of the world) incl. exact boundaries
  { let n = 0, bad = 0; const rr = mulberry32(77), out = new Float64Array(16);
    for (const d of core.OBSTS) for (let i = 0; i < 4000; i++) {
      const o = { def: d, type: d.id, x: 80 - 20 + rr() * 30, top: 60 + rr() * 200, passed: false, gap: 150, w: 56, t: (rr() * 300) | 0, base: 100 + rr() * 200, blk: 0, gap2: 0 };
      d.spawn(o, rr, 40, null); o.x = 80 - 20 + rr() * 30; o.t = (rr() * 300) | 0; d.update(o);
      const m = d.blocked(o, 0, out); const ys = [core.R, core.GROUND - core.R];
      for (let j = 0; j < 2 * m; j++) if (isFinite(out[j])) ys.push(out[j] - 1e-6, out[j] + 1e-6, out[j] + 0.5, out[j] - 0.5);
      for (let q = 0; q < 12; q++) ys.push(14 + rr() * 520);
      for (const y of ys) { let blocked = false; for (let j = 0; j < m; j++) if (y > out[2 * j] && y < out[2 * j + 1]) blocked = true;
        const hit = d.collide(o, { x: 80, y }); n++; if (hit !== blocked) bad++; } }
    check(`collide() === (y inside a blocked() range) for every type (${n} probes incl. probes 1e-6 px either side of every boundary)`, bad === 0, bad + ' disagreements'); }
  // slide specifics
  { const d = core.OBST.slide, out = new Float64Array(16); let maxEdge = 0, lo = 1e9, hi = -1e9, bad = 0;
    for (let b = 100; b <= 310; b += 5.25) { const o = { def: d, base: b, t: 0, gap: 150, top: b, x: 360, w: 56 };
      let prevTop = null; for (let t = 0; t < 300; t++) { o.t = t; d.update(o); lo = Math.min(lo, o.top); hi = Math.max(hi, o.top + 150); if (prevTop !== null) maxEdge = Math.max(maxEdge, Math.abs(o.top - prevTop)); prevTop = o.top;
        const m = d.blocked(o, 0, out); if (m !== 2 || Math.abs((out[2] - out[1]) - (150 - 28)) > 1e-9) bad++; } }
    check(`slide: top stays in [60,350] (60 px of pipe always visible) range ${lo.toFixed(1)}..${(hi - 150).toFixed(1)}; edge speed ${maxEdge.toFixed(3)} px/f <= 1.75; gap 150 every frame`, lo >= 60 - 1e-9 && hi - 150 <= 350 + 1e-9 && maxEdge <= 1.75 && bad === 0); }
  // double specifics: 3 blocked ranges (RFC said 0-2), middle block 40+2R, two free bands of 112
  { const d = core.OBST.double, out = new Float64Array(16), o = { def: d, top: 120, gap: 140, blk: 40, gap2: 140, x: 80, w: 56 };
    const m = d.blocked(o, 0, out); const f = new Float64Array(16), nf = core.freeIntervals(out, m, f);
    check('double: blocked() returns 3 ranges; free bands are [134,246] and [314,426] (112 px each for the centre)', m === 3 && nf === 2 && f[0] === 134 && f[1] === 246 && f[2] === 314 && f[3] === 426, JSON.stringify([m, nf, Array.from(f.subarray(0, 4))]));
    check('double: a bird inside the 40 px block dies, inside either gap lives', d.collide(o, { x: 80, y: 280 }) && !d.collide(o, { x: 80, y: 190 }) && !d.collide(o, { x: 80, y: 370 }) && d.collide(o, { x: 80, y: 110 }) && d.collide(o, { x: 80, y: 440 })); }

  // scheduler pacing across long ghost runs (score advances as obstacles pass)
  let order = [], total = 0, byType = { pipe: 0, slide: 0, double: 0, narrow: 0 }, nnRepeat = 0, early = 0, forcedBad = 0, toastBad = 0, f1to5 = 0, indepBad = [], rerolls = 0, fallbacks = 0, earlyTopBad = 0;
  for (const seed of ORACLE_SEEDS) {
    const w = core.createWorld(seed, 0), ref = mulberry32(seed); let lastType = null; const firstScore = {}; let toasts = {};
    w.hook = (o, prev) => {
      total++; byType[o.type]++; const d = core.OBST[o.type];
      if (w.score < d.from) early++;
      if (o.type === 'narrow' && lastType === 'narrow') nnRepeat++;
      if (!(o.type in firstScore)) firstScore[o.type] = w.score;
      if (w.score < 15) { if (o.type !== 'pipe' || o.top !== 60 + ref() * 290) earlyTopBad++; }
      if (core.fairCheck(prev, o, w) !== 0) f1to5++;
      const e = indepFair(core, prev, o, Math.max(w.speed, core.speedFor(w.score + 3))); if (e.length) indepBad.push(`seed ${seed} ${o.type}@${w.score}: ${e}`);
      lastType = o.type;
    };
    let guard = 0; while (w.spawns < 3000 && guard++ < 1e7) { ghost(core, w); if (w.ev & core.NEW_TYPE) toasts[w.newType] = (toasts[w.newType] || 0) + 1; }
    order.push(`${seed}: slide@${firstScore.slide} double@${firstScore.double} narrow@${firstScore.narrow}`);
    if (firstScore.slide < 15 || firstScore.slide > 16 || firstScore.double < 25 || firstScore.double > 26 || firstScore.narrow < 35 || firstScore.narrow > 36) forcedBad++;
    if (!(toasts.slide === 1 && toasts.double === 1 && toasts.narrow === 1 && !toasts.pipe)) toastBad++;
    rerolls += w.rerolls; fallbacks += w.fallbacks;
  }
  console.log(`  scheduler: ${total} spawns over 5 seeds — pipe ${byType.pipe}, slide ${byType.slide}, double ${byType.double}, narrow ${byType.narrow}; rerolls ${rerolls}, fallbacks ${fallbacks}`);
  console.log('  first appearances (score at spawn): ' + order.join(' | '));
  check('no obstacle spawns before its `from` score', early === 0);
  check('below 15: only pipes, and tops === v2 formula on the reference rand stream (no extra rand consumed)', earlyTopBad === 0, earlyTopBad + ' bad');
  check('first appearance of each type is forced at its `from` score (15/25/35, +1 tolerance for the pass in the same frame)', forcedBad === 0, forcedBad + ' seeds bad');
  check('NEW_TYPE event fires exactly once per type per run', toastBad === 0, toastBad + ' seeds bad');
  check('a narrow pipe is never followed by another narrow pipe', nnRepeat === 0, nnRepeat + ' repeats');
  check(`fairCheck===0 for all ${total} accepted spawns, and rerolls/fallbacks stay 0 with the real constants`, f1to5 === 0 && rerolls === 0 && fallbacks === 0, `bad ${f1to5}, rerolls ${rerolls}, fallbacks ${fallbacks}`);
  check(`F1–F5 asserted on every spawn by an independent brute-force checker (${total} spawns)`, indepBad.length === 0, indepBad.slice(0, 3).join(' | '));
  { const share = k => (100 * byType[k] / total).toFixed(1); console.log(`  mix shares: pipe ${share('pipe')}% slide ${share('slide')}% double ${share('double')}% narrow ${share('narrow')}%`);
    check('weighted pick: pipe is the most common type (weight 2 vs 1)', byType.pipe > byType.slide && byType.pipe > byType.double && byType.pipe > byType.narrow); }
  // forced re-roll path with the real types: strict CLIMB makes re-rolls happen, everything accepted is still fair
  { const w = core.createWorld(9, 0); w.fc.CLIMB = 0.6; let bad = 0; w.hook = (o, prev) => { if (core.fairCheck(prev, o, w) !== 0) bad++; };
    let g = 0; while (w.spawns < 2000 && g++ < 1e7) ghost(core, w);
    check(`strict CLIMB=0.6: re-rolls ${w.rerolls}, fallbacks ${w.fallbacks}, accepted obstacles all fair (bad ${bad})`, w.rerolls > 0 && bad === 0); }

  // oracle with all types, start scores 0/15/25/35 x 5 seeds x 500 obstacles
  const t0 = Date.now(); const lines = []; let frames = 0, runs = 0; const typeTotals = { pipe: 0, slide: 0, double: 0, narrow: 0 };
  for (const start of [0, 15, 25, 35]) {
    const res = [];
    for (const seed of ORACLE_SEEDS) {
      const r = oracle(core, seed, start, 500); frames += r.frames; runs++; res.push(`${seed | 0}:${r.passed}${r.ok ? '✓' : '✗@' + r.failFrame}`);
      for (const k in r.types || {}) typeTotals[k] += r.types[k];
      check(`oracle: 500 obstacles survivable, start score ${start}, seed ${seed | 0}`, r.ok && r.passed >= 500, `frames ${r.frames}, rerolls ${r.rerolls}, fallbacks ${r.fallbacks}, types ${JSON.stringify(r.types)}`);
    }
    lines.push(`start ${start}: ${res.join(' ')}`);
  }
  console.log('  oracle (all types):\n    ' + lines.join('\n    ') + `\n    ${runs} runs, ${frames} frames, ${Date.now() - t0} ms; obstacle types met: ${JSON.stringify(typeTotals)}`);
  check('oracle runs actually exercised slide, double and narrow', typeTotals.slide > 100 && typeTotals.double > 100 && typeTotals.narrow > 100);
  { const bad = loadCore(); bad.OBST.narrow.spawn = function (o, rand) { o.gap = 26; o.top = 60 + rand() * 300; };
    const r = oracle(bad, 3, 35, 60, { fc: { MIN_OPEN: 0, TELE: 0, CLEAR: 0, CLIMB: 1e9, BAND_V: 1e9 } });
    check('oracle self-check (start 35): an impossible narrow pipe (gap 26) is rejected', !r.ok, `failed at frame ${r.failFrame}`); }
  { const bad = loadCore(); bad.OBST.double.spawn = function (o, rand) { o.gap = 26; o.blk = 40; o.gap2 = 26; o.top = 60 + rand() * 100; };
    const r = oracle(bad, 3, 25, 60, { fc: { MIN_OPEN: 0, TELE: 0, CLEAR: 0, CLIMB: 1e9, BAND_V: 1e9 } });
    check('oracle self-check (start 25): a malformed double pipe (two 26 px gaps) is rejected', !r.ok, `failed at frame ${r.failFrame}`); }
}
