// A-na gate 2.0.0 — rule checks through the REAL resolveRound() of a tree copy.
// Usage: node gate-rules.mjs <path-to-games/tinju>
import { createRequire } from 'node:module';
import path from 'node:path';
import { domino, link, SHIP } from './oracle-2.0.mjs';
const T = process.argv[2];
const E = createRequire(import.meta.url)(path.join(T, 'server', 'engine.js'));
let pass = 0, fail = 0;
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  | ' + x : '')); };
const cfgWith = o => { const c = E.makeCfg({}); return Object.assign(c, o); };
const run = (players, len, ulti, cfg) => E.resolveRound(players.map(p => ({ id: p.id, seat: p.seat, hp: p.hp, streak: p.streak || 0, fire: !!p.fire })),
  Object.fromEntries(players.filter(p => p.elapsed != null).map(p => [p.id, { elapsed: p.elapsed, typos: p.typos }])), { text: 'a'.repeat(len), ulti }, cfg);

// ---- shipped defaults are the PM decisions ----
const d0 = E.makeCfg({});
check('CFG defaults: BASE_PER_CHAR 0.6, RANK_WEIGHT 1, EXTRA_LAST_HIT 0, CAP 60, RECV_CAP 60', d0.BASE_PER_CHAR === 0.6 && d0.RANK_WEIGHT === 1 && d0.EXTRA_LAST_HIT === 0 && d0.CAP === 60 && d0.RECV_CAP === 60, JSON.stringify({ b: d0.BASE_PER_CHAR, rw: d0.RANK_WEIGHT, x: d0.EXTRA_LAST_HIT }));

// ---- P-02a: the literal 1.0 oracle O-01..O-29, base 3, 2 entrants (rows from tinju-test-plan.md §1) ----
// [id, len, Wms, Lms|null, Wtypos, combo, ulti, expected]
const O10 = [
  ['O-01', 6, 1200, 2400, 0, 0, 0, 34], ['O-02', 6, 1500, 1800, 1, 0, 0, 9], ['O-03', 10, 2000, null, 0, 0, 1, 60],
  ['O-04', 6, 2000, 2000, 1, 0, 0, 9], ['O-05', 6, 2000, 2390, 1, 0, 0, 9], ['O-06', 6, 2000, 2399, 1, 0, 0, 9],
  ['O-07', 6, 2000, 2400, 1, 0, 0, 9], ['O-08', 6, 2000, 2401, 1, 0, 0, 18], ['O-09', 6, 2000, 2410, 1, 0, 0, 18],
  ['O-10', 6, 2000, 2999, 1, 0, 0, 18], ['O-11', 6, 2000, 3000, 1, 0, 0, 18], ['O-12', 6, 2000, 3001, 1, 0, 0, 23],
  ['O-13', 6, 2000, 3010, 1, 0, 0, 23], ['O-14', 6, 2000, null, 1, 0, 0, 23], ['O-15', 6, 1225, null, 0, 0, 0, 23],
  ['O-16', 6, 1201, null, 0, 0, 0, 23], ['O-17', 6, 1200, null, 0, 0, 0, 34], ['O-18', 6, 1200, null, 1, 0, 0, 23],
  ['O-19', 4, 2000, 2100, 1, 0, 0, 6], ['O-20', 5, 2000, 2100, 1, 0, 0, 8], ['O-21', 5, 1000, 1500, 0, 0, 0, 23],
  ['O-22', 9, 1800, null, 0, 0, 0, 51], ['O-23', 9, 1800, null, 0, 1, 0, 60], ['O-24', 8, 1600, null, 0, 1, 0, 56],
  ['O-25', 6, 2000, 2500, 1, 1, 0, 23], ['O-26', 8, 3000, 3500, 1, 0, 1, 60], ['O-27', 8, 3000, 3100, 1, 0, 1, 30],
  ['O-28', 9, 3000, 3500, 1, 0, 1, 60], ['O-29', 14, 2800, 2900, 0, 0, 1, 60]];
for (const cfgName of ['RANK_WEIGHT=1', 'RANK_WEIGHT=0']) {
  const cfg = cfgWith({ BASE_PER_CHAR: 3, RANK_WEIGHT: cfgName.endsWith('1') ? 1 : 0 });
  let ok = 0, bad = [];
  for (const [id, len, w, l, wt, combo, ulti, exp] of O10) {
    const P = [{ id: 'W', seat: 1, elapsed: w, typos: wt, hp: 100, fire: !!combo }, { id: 'L', seat: 0, elapsed: l, typos: wt + 1, hp: 100 }];
    const r = run(P, len, !!ulti, cfg); const mine = domino({ len, players: P, ulti: !!ulti, base: 3, rw: 1 }).hits[0];
    const c = r.chain[0];
    const good = r.chain.length === 1 && c.from === 'W' && c.to === 'L' && c.applied === exp && mine.applied === exp && r.hp.L === 100 - exp && r.hp.W === 100 && c.tier === mine.tier && c.critical === mine.crit && c.combo === !!combo;
    if (cfgName === 'RANK_WEIGHT=1') console.log(`  ${id} len ${len} W ${w}/${wt} L ${l ?? 'unf'}: engine ${c.tier}/crit ${c.critical}/combo ${c.combo}/applied ${c.applied} · oracle ${mine.tier} ${mine.math} · expected ${exp}`);
    good ? ok++ : bad.push(`${id}:${c && c.applied}`);
  }
  check(`P-02a: literal 1.0 rows O-01..O-29 at base 3, 2 entrants, ${cfgName}: damage = 1.0 plan, HP = 100 - damage`, ok === 29, `${ok}/29 ${bad.join(' ')}`);
}

// ---- P-02b: plan §1 rows O-01..O-33 at base 1 (line form), 2 entrants ----
const O20 = [
  ['O-01', 18, 3600, 4800, 0, 0, 0, 34], ['O-02', 18, 4500, 4800, 1, 0, 0, 9], ['O-03', 30, 6000, null, 0, 0, 1, 60],
  ['O-04', 18, 6000, 6000, 1, 0, 0, 9], ['O-05', 18, 6000, 6390, 1, 0, 0, 9], ['O-06', 18, 6000, 6399, 1, 0, 0, 9],
  ['O-07', 18, 6000, 6400, 1, 0, 0, 9], ['O-08', 18, 6000, 6401, 1, 0, 0, 18], ['O-09', 18, 6000, 6410, 1, 0, 0, 18],
  ['O-10', 18, 6000, 6999, 1, 0, 0, 18], ['O-11', 18, 6000, 7000, 1, 0, 0, 18], ['O-12', 18, 6000, 7001, 1, 0, 0, 23],
  ['O-13', 18, 6000, 7010, 1, 0, 0, 23], ['O-14', 18, 6000, null, 1, 0, 0, 23], ['O-15', 18, 3675, null, 0, 0, 0, 23],
  ['O-16', 18, 3601, null, 0, 0, 0, 23], ['O-17', 18, 3600, null, 0, 0, 0, 34], ['O-18', 18, 3600, null, 1, 0, 0, 23],
  ['O-19', 15, 6000, 6100, 1, 0, 0, 8], ['O-20', 17, 6000, 6100, 1, 0, 0, 9], ['O-21', 15, 3000, 3500, 0, 0, 0, 23],
  ['O-22', 27, 5400, null, 0, 0, 0, 51], ['O-23', 27, 5400, null, 0, 1, 0, 60], ['O-24', 24, 4800, null, 0, 1, 0, 56],
  ['O-25', 18, 6000, 6500, 1, 1, 0, 23], ['O-26', 24, 9000, 9500, 1, 0, 1, 60], ['O-27', 24, 9000, 9100, 1, 0, 1, 30],
  ['O-28', 27, 9000, 9500, 1, 0, 1, 60], ['O-29', 40, 8000, 8100, 0, 0, 1, 60], ['O-30', 40, 8000, null, 0, 0, 0, 60],
  ['O-31', 40, 8001, null, 0, 0, 0, 50], ['O-32', 32, 6400, null, 0, 0, 0, 60], ['O-33', 40, 19999, 20000, 0, 0, 0, 20]];
{ const cfg = cfgWith({ BASE_PER_CHAR: 1 }); let ok = 0, bad = [];
  for (const [id, len, w, l, wt, combo, ulti, exp] of O20) {
    const P = [{ id: 'W', seat: 0, elapsed: w, typos: wt, hp: 100, fire: !!combo }, { id: 'L', seat: 1, elapsed: l, typos: wt + 1, hp: 100 }];
    const c = run(P, len, !!ulti, cfg).chain[0]; c && c.applied === exp ? ok++ : bad.push(`${id}:${c && c.applied}`); }
  check('P-02b: plan §1 rows O-01..O-33 at base 1, 2 entrants', ok === 33, `${ok}/33 ${bad.join(' ')}`); }

// ---- P-02c: same 33 rows at the shipped base 0.6 — engine vs my oracle ----
{ const cfg = E.makeCfg({}); let ok = 0, bad = [];
  for (const [id, len, w, l, wt, combo, ulti] of O20) {
    const P = [{ id: 'W', seat: 0, elapsed: w, typos: wt, hp: 100, fire: !!combo }, { id: 'L', seat: 1, elapsed: l, typos: wt + 1, hp: 100 }];
    const c = run(P, len, !!ulti, cfg).chain[0]; const m = domino({ len, players: P, ulti: !!ulti }).hits[0];
    console.log(`  ship ${id}: oracle ${m.math} · engine ${c.applied}`);
    c.applied === m.applied ? ok++ : bad.push(`${id}: engine ${c.applied} oracle ${m.applied}`); }
  check('P-02c: rows O-01..O-33 at the shipped base 0.6, 2 entrants: engine = my oracle', ok === 33, `${ok}/33 ${bad.join(' ')}`); }

// ---- P-03: domino D-1..D-9 (plan §1b) ----
const S = (id, seat, elapsed, typos, hp = 100, fire = false, streak = 0) => ({ id, seat, elapsed, typos, hp, fire, streak });
const D = [
  ['D-1', 25, false, [S('A', 0, 5000, 0), S('B', 1, 5300, 1), S('C', 2, 6800, 0)], { A: 100, B: 81, C: 69 }],
  ['D-2', 20, false, [S('A', 0, 4000, 0), S('B', 1, 5000, 1, 81), S('C', 2, 5000, 1, 69)], { A: 100, B: 51, C: 39 }],
  ['D-3', 30, false, [S('A', 0, 6000, 0, 100, true), S('B', 1, 6200, 2), S('C', 2, 7500, 0), S('D', 3, 7600, 0), S('E', 4, null, 0)], { A: 100, B: 72, C: 62, D: 85, E: 62 }],
  ['D-4', 36, true, [S('A', 0, 7200, 0), S('B', 1, 9000, 0, 72), S('C', 2, 9500, 1, 62), S('D', 3, null, 0, 85), S('E', 4, null, 0, 62)], { A: 100, B: 12, C: 2, D: 25, E: 2 }],
  ['D-5', 20, false, [[4000, 0], [4300, 0], [4700, 1], [5800, 0], [5800, 2], [6100, 0], [7200, 1], [7250, 0], [9000, 3], [15000, 0]].map(([e, t], i) => S('P' + (i + 1), i, e, t)),
    { P1: 100, P2: 85, P3: 90, P4: 75, P5: 90, P6: 90, P7: 75, P8: 90, P9: 75, P10: 75 }],
  ['D-6', 40, false, [[8000, 0, 100], [8300, 1, 40], [9000, 0, 70, true], [9900, 0, 50], [10500, 1, 100], [12000, 0, 60], [12100, 0, 30, true], [14000, 2, 100], [null, 0, 45], [null, 0, 90]]
    .map(([e, t, hp, f], i) => S('P' + (i + 1), i, e, t, hp, !!f)), { P1: 100, P2: 10, P3: 30, P4: 0, P5: 60, P6: 10, P7: 10, P8: 40, P9: 0, P10: 40 }],
  ['D-7', 40, false, [S('A', 0, 8000, 0), S('B', 1, 8500, 1), S('C', 2, 10000, 1)], { A: 100, B: 40, C: 40 }, { EXTRA_LAST_HIT: 1 }],
  ['D-7off', 40, false, [S('A', 0, 8000, 0), S('B', 1, 8500, 1), S('C', 2, 10000, 1)], { A: 100, B: 40, C: 50 }],
  ['D-8', 30, false, [S('A', 0, 9000, 1), S('B', 1, null, 0), S('C', 2, null, 0)], { A: 100, B: 62, C: 62 }],
  ['D-9', 30, false, [0, 1, 2, 3, 4].map(i => S('P' + i, i, null, 0)), { P0: 100, P1: 100, P2: 100, P3: 100, P4: 100 }],
];
for (const [id, len, ulti, P, exp, extra] of D) {
  const r = run(P, len, ulti, cfgWith({ BASE_PER_CHAR: 1, RANK_WEIGHT: 0, ...(extra || {}) }));
  const ok = Object.entries(exp).every(([k, v]) => r.hp[k] === v);
  check(`P-03 ${id} (plan §1b hand numbers: base 1, RANK_WEIGHT 0${extra ? ', EXTRA_LAST_HIT 1' : ''}): every HP after`, ok, JSON.stringify(r.hp));
}
// shipped config: engine vs my oracle, every link and HP; print arithmetic
for (const [id, len, ulti, P, , extra] of D) {
  const r = run(P, len, ulti, cfgWith({ ...(extra || {}) }));
  const m = domino({ len, players: P, ulti, extra: extra ? 1 : 0 });
  const links = m.hits.map(h => `${h.from}>${h.to} d ${h.d ?? '∞'} ${h.tier}${h.crit ? '+crit' : ''}${h.combo ? '+combo' : ''}: ${h.math} ; w ${h.math2} ; applied ${h.applied}`);
  console.log(`  ship ${id} len ${len}${ulti ? ' ULTI' : ''}:\n    ` + links.join('\n    ') + `\n    HP after ${JSON.stringify(m.hp)}`);
  const same = r.chain.length === m.hits.length && r.chain.every((c, i) => c.from === m.hits[i].from && c.to === m.hits[i].to && c.applied === m.hits[i].applied && c.tier === m.hits[i].tier)
    && Object.keys(m.hp).every(k => r.hp[k] === m.hp[k]) && Object.keys(m.fire).every(k => r.fire[k] === m.fire[k] && r.streak[k] === m.streak[k]);
  check(`P-03 ${id} at the shipped config (base 0.6, RANK_WEIGHT 1${extra ? ', EXTRA 1' : ''}): links, HP, fire, streak = my oracle`, same, same ? '' : JSON.stringify({ eng: r.chain.map(c => c.applied), hp: r.hp }));
}

// ---- tie corners (T1/T2) and streak rule ----
{ const P = [S('A', 2, 3000, 0), S('B', 0, 3000, 0), S('C', 1, 3000, 0), S('D', 3, 4000, 1)];
  const r = run(P, 20, false, E.makeCfg({}));
  check('P-07: 3-way tie in front -> lowest seat (B) hits D; A and C hit nobody, take nothing', r.chain.length === 1 && r.chain[0].from === 'B' && r.chain[0].to === 'D' && r.hp.A === 100 && r.hp.C === 100, JSON.stringify(r.chain.map(c => c.from + '>' + c.to)));
  const P2 = [S('A', 0, 3000, 0, 100, false, 2), S('B', 1, 3000, 0, 100, false, 2)];
  const r2 = run(P2, 20, false, E.makeCfg({}));
  check('P-07: 2 players, same elapsed + typos -> no hit, streaks unchanged (1.0 draw)', r2.chain.length === 0 && r2.streak.A === 2 && r2.streak.B === 2);
  const r3 = run([S('A', 0, 3000, 0, 100, false, 2), S('B', 1, 3000, 0, 100, false, 2), S('C', 2, 5000, 0, 100, false, 2)], 20, false, E.makeCfg({}));
  check('P-21/C1: a tied non-hitter (B) has its streak reset, as the brief says ("hits nobody … tied … reset"); A (hitter) goes to 3 -> fire', r3.streak.B === 0 && r3.fire.A === true && r3.streak.C === 0, JSON.stringify([r3.streak, r3.fire])); }

// ---- P-08: 300 random rounds, N 3..10, shipped config, vs my oracle; invariants ----
function rng(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
for (const extra of [0, 1]) {
  const r = rng(4242 + extra); let mism = 0, over = 0, firstLost = 0, neg = 0, ties = 0; const ex = [];
  for (let k = 0; k < 300; k++) {
    const n = 3 + Math.floor(r() * 8), len = 15 + Math.floor(r() * 31), ulti = r() < 0.2;
    const P = Array.from({ length: n }, (_, i) => S('p' + i, i, r() < 0.12 ? null : 150 + Math.floor(r() * 40) * 250, Math.floor(r() * 3), 1 + Math.floor(r() * 100), r() < 0.2, Math.floor(r() * 3)));
    const e = run(P, len, ulti, cfgWith({ EXTRA_LAST_HIT: extra })); const m = domino({ len, players: P, ulti, extra });
    const same = e.chain.length === m.hits.length && e.chain.every((c, i) => c.from === m.hits[i].from && c.to === m.hits[i].to && c.applied === m.hits[i].applied && c.critical === m.hits[i].crit && c.combo === m.hits[i].combo)
      && P.every(p => e.hp[p.id] === m.hp[p.id] && e.fire[p.id] === m.fire[p.id] && e.streak[p.id] === m.streak[p.id]);
    if (!same) { mism++; if (ex.length < 3) ex.push(JSON.stringify({ k, n, len, ulti })); }
    const recv = {}; for (const c of e.chain) recv[c.to] = (recv[c.to] || 0) + c.applied; if (Object.values(recv).some(v => v > 60)) over++;
    const first = e.order[0]; if (!extra && first && first.elapsed != null && e.order.filter(o => o.rank === 1).length === 1 && e.hp[first.id] !== P.find(p => p.id === first.id).hp) firstLost++;
    if (Object.values(e.hp).some(h => h < 0)) neg++; if (e.order.some((o, i) => i && o.rank === e.order[i - 1].rank && o.elapsed != null)) ties++;
  }
  check(`P-08: 300 random rounds (N 3-10, len 15-45, ULTI 20 %, fire 20 %, EXTRA_LAST_HIT ${extra}) engine = my oracle (chain, applied, crit, combo, HP, fire, streak)`, mism === 0, `mismatches ${mism} ${ex.join(' ')} · rounds with a tie ${ties}`);
  check(`P-08: invariants (EXTRA ${extra}): nobody receives > 60 in a round; HP never < 0${extra ? '' : '; the sole first finisher never loses HP'}`, over === 0 && neg === 0 && firstLost === 0, `over ${over} neg ${neg} firstLost ${firstLost}`);
}
// P-09: flag default off and no extra hit with 2 ranks
{ const r = run([S('A', 0, 8000, 0), S('B', 1, 8500, 1)], 40, false, cfgWith({ EXTRA_LAST_HIT: 1 }));
  check('P-09: EXTRA_LAST_HIT=1 with only 2 ranks -> no extra link', r.chain.length === 1 && !r.chain[0].extra); }
console.log(`\n== gate-rules: PASS ${pass} / FAIL ${fail} ==`);
