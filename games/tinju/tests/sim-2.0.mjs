// Tinju Kata 2.0 KO-clustering simulation (PLAN-2.0 §5, K-1…K-6) against the REAL resolveRound() in server/engine.js.
// Bot model = A-na's sim-ko.mjs: 1000 matches per size, mulberry32(1000 + match); speed uniform 3-8 chars/s per bot;
// per round x uniform 0.85-1.15, +400 ms reaction, 2 % typo chance per char (+600 ms each), > 20 s = unfinished;
// round wall time = 2.4 s countdown + typing (slowest alive, or 20 s) + 0.15 s x links + 1 s title card + 1.4 s result.
// Usage: node sim-2.0.mjs [--lines=ana|bank] [--base=0.7] [--rw=1] [--extra=0] [--n=10] [--matches=1000] [--table]
//   --lines=ana  : every line uniform 15-40 chars (A-na's model; ULTI picks the same distribution)
//   --lines=bank : normal rounds 15-29 chars, ULTI rounds 30-45 chars (the brief's 2026-10-30 line rule)
//   --table      : run the full N=2/5/10 table for the given settings and write tests/evidence/sim-2.0.txt (appended by caller)
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../server/engine.js');

export function simulate({ N, base, rw = 1, extra = 0, lines = 'ana', matches = 1000, hp = 100, over = {} }) {
  const cfg = { ...E.makeCfg({}), BASE_PER_CHAR: base, RANK_WEIGHT: rw, EXTRA_LAST_HIT: extra, HP: hp, ...over };
  const st = { maxKo: [], koRounds: [], dur: [], rounds: [], firstKo: [], fastestWins: 0, ko3: 0, ko5: 0 };
  for (let m = 0; m < matches; m++) {
    const r = E.mulberry32(1000 + m);
    const bots = Array.from({ length: N }, (_, i) => ({ id: 'B' + i, seat: i + 1, hp, fire: false, streak: 0, cps: 3 + 5 * r() }));
    const fastest = bots.reduce((a, b) => (a.cps > b.cps ? a : b)).id;
    let round = 0, t = 0, ultiAt = 4 + Math.floor(r() * 3), maxKo = 0, koR = 0, firstKo = null;
    while (bots.filter(p => p.hp > 0).length > 1 && round < 200) {
      round++;
      const alive = bots.filter(p => p.hp > 0);
      const ulti = round >= ultiAt; if (ulti) ultiAt = round + 4 + Math.floor(r() * 3);
      const len = lines === 'ana' ? 15 + Math.floor(r() * 26) : ulti ? 30 + Math.floor(r() * 16) : 15 + Math.floor(r() * 15);
      const dones = {};
      for (const p of alive) {
        let typos = 0; for (let c = 0; c < len; c++) if (r() < 0.02) typos++;
        const e = Math.round(400 + len / p.cps * 1000 * (0.85 + 0.3 * r()) + 600 * typos);
        p.elapsed = e > 20000 ? null : e; if (p.elapsed != null) dones[p.id] = { elapsed: e, typos };
      }
      const res = E.resolveRound(alive, dones, { text: 'x'.repeat(len), ulti }, cfg);
      for (const p of alive) { p.hp = res.hp[p.id]; p.streak = res.streak[p.id]; p.fire = res.fire[p.id]; }
      const ko = res.ko.length;
      if (ko >= 5) st.ultiBig = (st.ultiBig || 0) + (ulti ? 1 : 0), st.bigN = (st.bigN || 0) + 1;
    if (ko) { koR++; if (firstKo == null) firstKo = round; }
      maxKo = Math.max(maxKo, ko);
      const fin = alive.map(p => p.elapsed).filter(x => x != null);
      const typing = fin.length < alive.length ? 20000 : Math.max(...fin);
      t += 2400 + typing + 150 * res.chain.length + 1000 + 1400;
    }
    const w = bots.filter(p => p.hp > 0);
    if (w.length === 1 && w[0].id === fastest) st.fastestWins++;
    st.maxKo.push(maxKo); st.koRounds.push(koR); st.dur.push(t / 1000); st.rounds.push(round); st.firstKo.push(firstKo ?? 0);
    if (maxKo <= 3) st.ko3++; if (maxKo >= 5) st.ko5++;
  }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  return { N, base, rw, extra, lines, matches,
    k1_le3: st.ko3 / matches, k1_ge5: st.ko5, dur: [q(st.dur, .1), q(st.dur, .5), q(st.dur, .9)], rounds50: q(st.rounds, .5),
    koRounds50: q(st.koRounds, .5), firstKo50: q(st.firstKo, .5), fastestWins: st.fastestWins / matches, bigUlti: st.ultiBig || 0, bigRounds: st.bigN || 0, over };
}
export function verdict(res10, res2) {
  const k1 = res10.k1_le3 >= 0.95 && res10.k1_ge5 === 0;
  const k2 = res10.dur[1] >= 120 && res10.dur[1] <= 240;
  const k2b = res10.dur[0] >= 90 && res10.dur[2] <= 300;
  const k3 = res2.dur[1] >= 40 && res2.dur[1] <= 60;
  return { k1, k2, k2b, k3, k4: res10.koRounds50 >= 5, k5: res10.firstKo50 >= 4 };
}
export const fmt = r => `N=${String(r.N).padEnd(2)} base=${String(r.base).padEnd(4)} rw=${r.rw} extra=${r.extra} lines=${r.lines.padEnd(4)}  maxKO<=3 ${(r.k1_le3 * 100).toFixed(1).padStart(5)}%  maxKO>=5 ${String(r.k1_ge5).padStart(3)}  secs p10/p50/p90 ${r.dur.map(x => x.toFixed(0)).join('/')}  KO-rounds p50 ${r.koRounds50}  first-KO p50 r${r.firstKo50}  fastest wins ${(r.fastestWins * 100).toFixed(0)}%${r.bigRounds ? `  [rounds with >=5 KOs: ${r.bigRounds}, of which ULTI ${r.bigUlti}]` : ''}${Object.keys(r.over || {}).length ? '  cfg ' + JSON.stringify(r.over) : ''}`;

if (process.argv[1] && process.argv[1].endsWith('sim-2.0.mjs')) {
  const a = Object.fromEntries(process.argv.slice(2).map(s => s.replace(/^--/, '').split('=')));
  const over = Object.fromEntries((a.cfg || '').split(',').filter(Boolean).map(x => x.split(':')).map(([k, v]) => [k, Number(v)]));
  const base = Number(a.base ?? 0.7), rw = Number(a.rw ?? 1), extra = Number(a.extra ?? 0), lines = a.lines || 'ana', matches = Number(a.matches ?? 1000);
  const sizes = a.n ? [Number(a.n)] : [2, 5, 10];
  const out = sizes.map(N => simulate({ N, base, rw, extra, lines, matches, over }));
  for (const r of out) console.log(fmt(r));
  if (!a.n) {
    const v = verdict(out[2], out[0]);
    console.log(`K-1 ${v.k1 ? 'PASS' : 'FAIL'} · K-2 ${v.k2 && v.k2b ? 'PASS' : 'FAIL'} (median ${v.k2 ? 'ok' : 'out'}, p10/p90 ${v.k2b ? 'ok' : 'out'}) · K-3 ${v.k3 ? 'PASS' : 'FAIL'} · K-4 ${v.k4 ? 'PASS' : 'FAIL'} · K-5 ${v.k5 ? 'PASS' : 'FAIL'}`);
  }
}
