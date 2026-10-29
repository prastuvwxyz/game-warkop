// STEP 2 — registry, blocked, fairCheck, oracle; pipe is the only entry.
import { loadCore, mulberry32 } from './lib.mjs';
import { oracle } from './oracle.mjs';
import { parityRun, SEEDS50 } from './step1.mjs';

export const ORACLE_SEEDS = [1, 42, 1337, 20261028, 0xDEADBEEF | 0];
const ghost = (core, w) => { w.ev = 0; w.dead = false; w.bird.y = 320; w.bird.v = 0; core.stepWorld(w); };
const mkObs = (core, defId, o) => Object.assign({ def: core.OBST[defId], type: defId, x: 360, top: 200, passed: false, gap: 150, w: 56, t: 0, base: 0, blk: 0, gap2: 0 }, o);

export default async function ({ check, section }) {
  section('STEP 2 — registry + fairCheck + reachability oracle (pipes only)');
  const core = loadCore();
  check('registry has pipe', core.OBSTS.length >= 1 && core.OBSTS[0].id === 'pipe');
  // parity still holds with the registry in place
  { let bad = 0, frames = 0; for (const seed of SEEDS50) for (const m of ['bot', 'fuzz', 'noisybot']) { const r = parityRun(core, seed, m); frames += r.cmp; if (r.bad) bad++; }
    check(`parity still holds (150 runs, ${frames} frames, ===)`, bad === 0, bad + ' diverged'); }

  // fairCheck on 10,000 plain-pipe spawns, score held at 0 (ghost bird) => exactly the v2 pipe stream
  { const w = core.createWorld(2026, 0), ref = mulberry32(2026); let n = 0, bad = 0, badTop = 0, worstF4 = 0;
    w.hook = (o, prev) => { n++; if (core.fairCheck(prev, o, w) !== 0) bad++; if (o.top !== 60 + ref() * (core.GROUND - core.GAP - 120)) badTop++; };
    let guard = 0; while (w.spawns < 10000 && guard++ < 2e6) { ghost(core, w); w.score = 0; }
    check(`fairCheck passes 10,000 v2 pipe spawns with 0 re-rolls (spawns ${w.spawns}, rerolls ${w.rerolls}, fallbacks ${w.fallbacks})`, w.spawns === 10000 && bad === 0 && w.rerolls === 0 && w.fallbacks === 0);
    check('those 10,000 spawns consumed exactly one rand() each (tops === v2 formula on reference stream)', badTop === 0, badTop + ' mismatches'); }

  // fairCheck negative cases: each rule must fire for its own violation
  { const w = core.createWorld(1, 0); w.speed = 2.4;
    const prev = mkObs(core, 'pipe', { x: 360 - 95 * 2.4, top: 200, t: 95 });            // prev as it is when the next spawn happens
    check('fairCheck: ordinary spawn passes (0)', core.fairCheck(prev, mkObs(core, 'pipe', { top: 200 }), w) === 0);
    check('F1 fires: gap 100 -> centre room 72 < 102', core.fairCheck(prev, mkObs(core, 'pipe', { top: 200, gap: 100 }), w) === 1);
    check('F2 fires: spawned at x=200 -> only 44 frames from cue to column', core.fairCheck(null, mkObs(core, 'pipe', { x: 200, top: 200 }), w) === 2);
    check('F3 fires: obstacles closer than 90 px clear', core.fairCheck(mkObs(core, 'pipe', { x: 360 - 56 - 60, top: 200 }), mkObs(core, 'pipe', { top: 200 }), w) === 3);
    const wild = Object.assign({}, core.OBST.pipe, { blocked(o, k, out) { const t = o.top + 3 * (k - 111); out[0] = -Infinity; out[1] = t + 14; out[2] = t + 150 - 14; out[3] = Infinity; return 2; } });
    check('F5 fires: band edges moving 3 px/frame', core.fairCheck(prev, mkObs(core, 'pipe', { top: 150, def: wild }), w) === 5);
    const tight = mkObs(core, 'pipe', { x: 210, top: 60, t: 62 });                         // 94 px clear, but only ~27 frames before the next arrives
    check('F4 fires: 290 px apart with ~27 frames to climb', core.fairCheck(tight, mkObs(core, 'pipe', { top: 350 }), w) === 4);
    const okPrev = mkObs(core, 'pipe', { x: 360 - 95 * 2.4, top: 60, t: 95 });
    check('F4 holds at the real worst case (top 60 -> 350 after a normal 95-frame interval)', core.fairCheck(okPrev, mkObs(core, 'pipe', { top: 350 }), w) === 0);
    const s = 2.4, kp = (okPrev.x + 56 - 66) / s, avail = (360 - 94) / s - kp;
    check('RFC §3 worst-case numbers reproduced (avail 60 frames, 4.5*avail = 270 px, need 168 px)', Math.abs(avail - 60) < 1e-9 && Math.abs(4.5 * avail - 270) < 1e-6 && (350 + 14) - (60 + 150 - 14) === 168, `avail ${avail}`);
  }
  // re-roll + fallback path: make F4 impossible to satisfy often (CLIMB 0.5) and check every accepted obstacle is still fair
  { const w = core.createWorld(5, 0); w.fc.CLIMB = 0.5; let bad = 0;
    w.hook = (o, prev) => { if (core.fairCheck(prev, o, w) !== 0) bad++; };
    let guard = 0; while (w.spawns < 3000 && guard++ < 1e6) { ghost(core, w); w.score = 0; }
    check(`re-roll/fallback path exercised (rerolls ${w.rerolls}, fallbacks ${w.fallbacks}) and every accepted obstacle passes fairCheck`, w.rerolls > 0 && w.fallbacks > 0 && bad === 0 && w.rerolls <= 4 * w.spawns, `bad ${bad}`); }

  // oracle
  const t0 = Date.now(); let sumFrames = 0; const per = [];
  for (const seed of ORACLE_SEEDS) {
    const r = oracle(core, seed, 0, 500); sumFrames += r.frames; per.push(`${seed}:${r.passed}${r.ok ? 'ok' : 'FAIL@' + r.failFrame}`);
    check(`oracle: 500 pipes survivable, start score 0, seed ${seed}`, r.ok && r.passed >= 500, `frames ${r.frames}, minStates ${r.minStates}`);
  }
  console.log(`  oracle 500 obstacles x 5 seeds (start 0): ${per.join(' ')} — ${sumFrames} frames, ${Date.now() - t0} ms`);
  // the oracle can actually fail: a deliberately unfair world (gap 60) must be rejected
  { const bad = loadCore(); const p = bad.OBST.pipe; p.spawn = function (o, rand) { o.gap = 26; o.top = 60 + rand() * 300; };
    const r = oracle(bad, 1, 0, 40, { fc: { MIN_OPEN: 0, TELE: 0, CLEAR: 0, CLIMB: 1e9, BAND_V: 1e9 } }); check('oracle self-check: with fairCheck defanged, a broken build (pipe gap 26 < 2R) is rejected by the oracle', !r.ok, `failed at frame ${r.failFrame}, ${r.passed} passed`); }
}
