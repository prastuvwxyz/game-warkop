// A-na's KO-clustering model (PLAN-2.0 §5, same bot model as tests/plan-2.0/sim-ko.mjs) driving the REAL resolveRound()
// of a tree copy at its shipped CFG. Usage: node sim-ko-engine.mjs <path-to-games/tinju>
import { createRequire } from 'node:module';
import path from 'node:path';
const T = process.argv[2];
const req = createRequire(import.meta.url);
const E = req(path.join(T, 'server', 'engine.js')), LY = req(path.join(T, 'server', 'lyrics.js'));
const CFG = E.makeCfg({});
const bank = LY.loadFile(path.join(T, 'server', 'lyrics.txt'), CFG).bank;
const NORM_FULL = bank.normal.map(x => x.text.length), NORM_PLAIN = bank.normal.map(x => x.plain.length), ULTI = bank.ulti.map(x => x.text.length);
function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function sim(N, lines) {
  const st = { maxKo: [], koR: [], dur: [], first: [], fastest: 0 };
  for (let m = 0; m < 1000; m++) { const r = rng(1000 + m);
    const ps = Array.from({ length: N }, (_, i) => ({ id: 'B' + i, seat: i, hp: CFG.HP, streak: 0, fire: false, cps: 3 + 5 * r() }));
    const fastest = ps.reduce((a, b) => a.cps > b.cps ? a : b).id;
    let round = 0, t = 0, ultiAt = 4 + Math.floor(r() * 3), maxKo = 0, koR = 0, first = null;
    while (ps.filter(p => p.hp > 0).length > 1 && round < 300) { round++; const alive = ps.filter(p => p.hp > 0);
      const ulti = round >= ultiAt; if (ulti) ultiAt = round + 4 + Math.floor(r() * 3);
      const pick = a => a[Math.floor(r() * a.length)];
      const len = lines === 'plan' ? 15 + Math.floor(r() * 26) : ulti ? pick(ULTI) : round <= 3 ? pick(NORM_PLAIN) : pick(NORM_FULL);
      const dones = {};
      for (const p of alive) { let typos = 0; for (let c = 0; c < len; c++) if (r() < 0.02) typos++;
        const e = Math.round(400 + len / p.cps * 1000 * (0.85 + 0.3 * r()) + 600 * typos); if (e <= 20000) dones[p.id] = { elapsed: Math.max(150, e), typos }; }
      const res = E.resolveRound(alive.map(p => ({ id: p.id, seat: p.seat, hp: p.hp, streak: p.streak, fire: p.fire })), dones, { text: 'x'.repeat(len), ulti }, CFG);
      for (const p of alive) { p.hp = res.hp[p.id]; p.streak = res.streak[p.id]; p.fire = res.fire[p.id]; }
      const ko = res.ko.length; if (ko) { koR++; if (first == null) first = round; } maxKo = Math.max(maxKo, ko);
      const fin = Object.values(dones).map(d => d.elapsed); const typing = fin.length < alive.length ? 20000 : Math.max(...fin);
      t += CFG.COUNTDOWN_MS + typing + CFG.LINK_MS * res.chain.length + CFG.TITLE_MS + CFG.RESULT_MS;
    }
    const w = ps.filter(p => p.hp > 0); if (w.length === 1 && w[0].id === fastest) st.fastest++;
    st.maxKo.push(maxKo); st.koR.push(koR); st.dur.push(t / 1000); st.first.push(first ?? 99);
  }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };
  return { le3: st.maxKo.filter(x => x <= 3).length, ge5: st.maxKo.filter(x => x >= 5).length, d: [q(st.dur, .1), q(st.dur, .5), q(st.dur, .9)].map(x => Math.round(x)), koR50: q(st.koR, .5), first50: q(st.first, .5), fastest: st.fastest / 10 };
}
console.log(`CFG: BASE_PER_CHAR ${CFG.BASE_PER_CHAR} RANK_WEIGHT ${CFG.RANK_WEIGHT} EXTRA_LAST_HIT ${CFG.EXTRA_LAST_HIT} HP ${CFG.HP}; bank normal ${bank.normal.length} ulti ${bank.ulti.length}; 1000 matches per row, seed 1000+match`);
let pass = 0, fail = 0; const check = (n, ok, x) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + '  | ' + x); };
for (const lines of ['plan', 'bank']) {
  const s10 = sim(10, lines), s5 = sim(5, lines), s2 = sim(2, lines);
  for (const [n, s] of [[10, s10], [5, s5], [2, s2]]) console.log(`  lines=${lines} N=${n}: maxKO<=3 ${s.le3}/1000  maxKO>=5 ${s.ge5}  secs p10/p50/p90 ${s.d.join('/')}  KO-rounds p50 ${s.koR50}  first KO p50 r${s.first50}  fastest wins ${s.fastest}%`);
  const tag = lines === 'plan' ? 'plan model (lines 15-40)' : 'real bank lengths (plain r1-3, normal <30, ULTI >=30)';
  check(`K-1 [${tag}] 10 bots: <=3 KOs in one round in >=95 % AND never >=5`, s10.le3 >= 950 && s10.ge5 === 0, `${(s10.le3 / 10).toFixed(1)} %, ${s10.ge5} matches with >=5`);
  check(`K-2 [${tag}] 10 bots: median 120-240 s, p10 >= 90, p90 <= 300`, s10.d[1] >= 120 && s10.d[1] <= 240 && s10.d[0] >= 90 && s10.d[2] <= 300, s10.d.join('/'));
  check(`K-3 [${tag}] 2 bots: median 40-60 s`, s2.d[1] >= 40 && s2.d[1] <= 60, s2.d.join('/'));
  check(`K-4 [${tag}] 10 bots: rounds with >=1 KO, median >= 5`, s10.koR50 >= 5, String(s10.koR50));
  check(`K-5 [${tag}] 10 bots: round of first KO, median >= 4`, s10.first50 >= 4, String(s10.first50));
  console.log(`  K-6 [${tag}] report only: 5 bots ${s5.d.join('/')} s, fastest bot wins ${s5.fastest}%`);
}
console.log(`\n== sim-ko-engine: PASS ${pass} / FAIL ${fail} ==`);
