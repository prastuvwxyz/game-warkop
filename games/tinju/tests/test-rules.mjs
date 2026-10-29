// Tinju Kata 2.0 rule tests — resolveRound() called directly, no server. Usage: node test-rules.mjs
// Sources of the expected numbers: tests/PLAN-2.0.md (A-na) §1 O-01…O-33 and §1b D-1…D-9, typed in by hand below;
// the brief's 2026-10-30 Rules (rank weight, ties, streak reset) for the rank-weight cases.
import { createRequire } from 'node:module';
import { makeChecker } from './test-lib.mjs';
import { link as oracleLink, domino as oracleDomino } from './plan-2.0/oracle-2.0.mjs';
const require = createRequire(import.meta.url);
const E = require('../server/engine.js');
const { check, summary } = makeChecker('test-rules');

const cfgOf = (o = {}) => ({ ...E.makeCfg({}), ...o });
const P = (id, seat, o = {}) => ({ id, seat, hp: 100, streak: 0, fire: false, ...o });
const L = (len, ulti = false) => ({ text: 'x'.repeat(len), ulti });
const run = (ents, dones, len, cfg, ulti = false) => E.resolveRound(ents, dones, L(len, ulti), cfg);
const D = (e, t) => (e == null ? undefined : { elapsed: e, typos: t });

// ---------- defaults ----------
{
  const c = E.makeCfg({});
  check('CFG defaults: RANK_WEIGHT 1, EXTRA_LAST_HIT 0, BASE_PER_CHAR 0.7, CAP 60, RECV_CAP 60, MAX_PLAYERS 10',
    c.RANK_WEIGHT === 1 && c.EXTRA_LAST_HIT === 0 && c.BASE_PER_CHAR === E.CFG_DEFAULTS.BASE_PER_CHAR && c.CAP === 60 && c.RECV_CAP === 60 && c.MAX_PLAYERS === 10);
  const o = E.makeCfg({ TK_BASE_PER_CHAR: '3', TK_RANK_WEIGHT: '0', TK_HP: 'abc', TK_CAP: '' });
  check('CFG: TK_* env overrides numbers; junk and empty fall back to the default', o.BASE_PER_CHAR === 3 && o.RANK_WEIGHT === 0 && o.HP === 100 && o.CAP === 60);
}

// ---------- O-01…O-29 literal 1.0 rows: 2 entrants, base 3, words of n letters ----------
// [id, n, hitter ms, hitter typos, hitee ms|null, hitee typos, ulti, combo, expected 1.0 damage]
const R10 = [
  ['O-01', 6, 1200, 0, 2400, 0, 0, 0, 34], ['O-02', 6, 1500, 1, 1800, 0, 0, 0, 9], ['O-03', 10, 2000, 0, null, 0, 1, 0, 60],
  ['O-04', 6, 2000, 1, 2000, 2, 0, 0, 9], ['O-05', 6, 2000, 1, 2390, 0, 0, 0, 9], ['O-06', 6, 2000, 1, 2399, 0, 0, 0, 9],
  ['O-07', 6, 2000, 1, 2400, 0, 0, 0, 9], ['O-08', 6, 2000, 1, 2401, 0, 0, 0, 18], ['O-09', 6, 2000, 1, 2410, 0, 0, 0, 18],
  ['O-10', 6, 2000, 1, 2999, 0, 0, 0, 18], ['O-11', 6, 2000, 1, 3000, 0, 0, 0, 18], ['O-12', 6, 2000, 1, 3001, 0, 0, 0, 23],
  ['O-13', 6, 2000, 1, 3010, 0, 0, 0, 23], ['O-14', 6, 2000, 1, null, 0, 0, 0, 23], ['O-15', 6, 1225, 0, null, 0, 0, 0, 23],
  ['O-16', 6, 1201, 0, null, 0, 0, 0, 23], ['O-17', 6, 1200, 0, null, 0, 0, 0, 34], ['O-18', 6, 1200, 1, null, 0, 0, 0, 23],
  ['O-19', 4, 2000, 1, 2100, 0, 0, 0, 6], ['O-20', 5, 2000, 1, 2100, 0, 0, 0, 8], ['O-21', 5, 1000, 0, 1500, 0, 0, 0, 23],
  ['O-22', 9, 1800, 0, null, 0, 0, 0, 51], ['O-23', 9, 1800, 0, null, 0, 0, 1, 60], ['O-24', 8, 1600, 0, null, 0, 0, 1, 56],
  ['O-25', 6, 2000, 1, 2500, 0, 0, 1, 23], ['O-26', 8, 3000, 1, 3500, 0, 1, 0, 60], ['O-27', 8, 3000, 1, 3100, 0, 1, 0, 30],
  ['O-28', 9, 3000, 1, 3500, 0, 1, 0, 60], ['O-29', 14, 2800, 0, 2900, 0, 1, 0, 60],
];
{
  let bad = [];
  const c3 = cfgOf({ BASE_PER_CHAR: 3 });
  for (const [id, n, we, wt, le, lt, ulti, combo, exp] of R10) {
    const ents = [P('W', 1, { fire: !!combo }), P('V', 2)];
    const dones = { W: D(we, wt), V: D(le, lt) };
    const r = run(ents, dones, n, c3, !!ulti);
    const h = r.chain[0];
    const okLink = h && h.from === 'W' && h.to === 'V' && h.damage === exp && h.applied === exp && r.hp.V === 100 - exp && r.hp.W === 100;
    check(`${id} base 3, 2 entrants -> ${exp}`, okLink, h ? `damage ${h.damage} applied ${h.applied}` : 'no hit');
    if (!okLink) bad.push(id);
  }
  check('O-01…O-29 (29 rows) all reproduce the 1.0 damage on 2 entrants at base 3', bad.length === 0 && R10.length === 29, bad.join(','));
}

// ---------- O-01…O-33 at base 1 (PLAN §1) ----------
// [id, len, hitter ms, typos, hitee ms|null, ulti, combo, expected]
const R1 = [
  ['O-01', 18, 3600, 0, 4800, 0, 0, 34], ['O-02', 18, 4500, 1, 4800, 0, 0, 9], ['O-03', 30, 6000, 0, null, 1, 0, 60], ['O-04', 18, 6000, 1, 6000, 0, 0, 9],
  ['O-05', 18, 6000, 1, 6390, 0, 0, 9], ['O-06', 18, 6000, 1, 6399, 0, 0, 9], ['O-07', 18, 6000, 1, 6400, 0, 0, 9], ['O-08', 18, 6000, 1, 6401, 0, 0, 18],
  ['O-09', 18, 6000, 1, 6410, 0, 0, 18], ['O-10', 18, 6000, 1, 6999, 0, 0, 18], ['O-11', 18, 6000, 1, 7000, 0, 0, 18], ['O-12', 18, 6000, 1, 7001, 0, 0, 23],
  ['O-13', 18, 6000, 1, 7010, 0, 0, 23], ['O-14', 18, 6000, 1, null, 0, 0, 23], ['O-15', 18, 3675, 0, null, 0, 0, 23], ['O-16', 18, 3601, 0, null, 0, 0, 23],
  ['O-17', 18, 3600, 0, null, 0, 0, 34], ['O-18', 18, 3600, 1, null, 0, 0, 23], ['O-19', 15, 6000, 1, 6100, 0, 0, 8], ['O-20', 17, 6000, 1, 6100, 0, 0, 9],
  ['O-21', 15, 3000, 0, 3500, 0, 0, 23], ['O-22', 27, 5400, 0, null, 0, 0, 51], ['O-23', 27, 5400, 0, null, 0, 1, 60], ['O-24', 24, 4800, 0, null, 0, 1, 56],
  ['O-25', 18, 6000, 1, 6500, 0, 1, 23], ['O-26', 24, 9000, 1, 9500, 1, 0, 60], ['O-27', 24, 9000, 1, 9100, 1, 0, 30], ['O-28', 27, 9000, 1, 9500, 1, 0, 60],
  ['O-29', 40, 8000, 0, 8100, 1, 0, 60], ['O-30', 40, 8000, 0, null, 0, 0, 60], ['O-31', 40, 8001, 0, null, 0, 0, 50], ['O-32', 32, 6400, 0, null, 0, 0, 60],
  ['O-33', 40, 19999, 0, 20000, 0, 0, 20],
];
{
  const c1 = cfgOf({ BASE_PER_CHAR: 1 });
  let bad = [];
  for (const [id, len, we, wt, le, ulti, combo, exp] of R1) {
    // O-26…O-29 in the plan are ULTI rows: the 5th numeric column is the ulti flag there
    const isU = ['O-03', 'O-26', 'O-27', 'O-28', 'O-29'].includes(id);
    const r = run([P('W', 1, { fire: !!combo }), P('V', 2)], { W: D(we, wt), V: D(le, 0) }, len, c1, isU);
    const h = r.chain[0];
    const o = oracleLink({ len, hitter: { elapsed: we, typos: wt }, hitee: { elapsed: le }, ulti: isU, combo: !!combo, base: 1 });
    const ok = h && h.damage === exp && h.applied === exp && o.dmg === exp;
    if (!ok) bad.push(id);
  }
  check('O-01…O-33 at base 1: 33/33 exact (damage, applied) and equal to A-na\'s oracle link()', bad.length === 0 && R1.length === 33, bad.join(','));
  const r = run([P('W', 1), P('V', 2)], { W: D(3600, 0), V: D(4800, 0) }, 18, c1);
  const h = r.chain[0];
  check('O-01 link fields: clean tier, d 1200, critical, margin 1.25, no combo, weight 1', h.tier === 'clean' && h.d === 1200 && h.critical && h.margin === 1.25 && !h.combo && h.weight === 1 && !h.extra);
  const u = run([P('W', 1), P('V', 2)], { W: D(6000, 0) }, 30, c1, true).chain[0];
  check('O-03: unfinished hitee -> d null, tier clean, ulti flag on the link', u.d === null && u.tier === 'clean' && u.ulti === true && u.applied === 60);
}

// ---------- 2 players = 1.0 on the draw cases ----------
{
  const c = cfgOf({ BASE_PER_CHAR: 1 });
  const a = run([P('A', 1, { streak: 2 }), P('B', 2, { streak: 1 })], { A: D(5000, 1), B: D(5000, 1) }, 20, c);
  check('2 players, same elapsed and typos: no hit, HP and streaks unchanged (draw)', a.chain.length === 0 && a.noHits && a.hp.A === 100 && a.streak.A === 2 && a.streak.B === 1);
  const b = run([P('A', 1), P('B', 2)], {}, 20, c);
  check('nobody finished: no hits, HP unchanged', b.chain.length === 0 && b.noHits && b.hp.A === 100 && b.hp.B === 100);
  const t = run([P('A', 1), P('B', 2)], { A: D(5000, 1), B: D(5000, 3) }, 20, c);
  check('equal elapsed: fewer typos ranks first and hits (typo tie-break)', t.chain.length === 1 && t.chain[0].from === 'A');
  const arr = run([P('B', 2), P('A', 1)], { B: D(4000, 0), A: D(4500, 0) }, 20, c);
  check('winner by elapsed, not by entrants/dones order (B listed and inserted first but slower is hit)', arr.chain[0].from === 'B' && arr.chain[0].to === 'A');
}

// ---------- A-na's domino rounds D-1…D-9, pure domino (RANK_WEIGHT 0), base 1 ----------
const CD = cfgOf({ BASE_PER_CHAR: 1, RANK_WEIGHT: 0 });
const mk = (rows) => rows.map(([id, hp, fire], i) => P(id, i + 1, { hp: hp ?? 100, fire: !!fire }));
const hpEq = (r, exp) => Object.keys(exp).every(k => r.hp[k] === exp[k]);
const chainDmg = r => r.chain.map(x => `${x.from}>${x.to}:${x.applied}`).join(' ');
{
  const r = run(mk([['A'], ['B'], ['C']]), { A: D(5000, 0), B: D(5300, 1), C: D(6800, 0) }, 25, CD);
  check('D-1: A>B 19, B>C 31; HP 100/81/69', chainDmg(r) === 'A>B:19 B>C:31' && hpEq(r, { A: 100, B: 81, C: 69 }), chainDmg(r));
  const d1 = r;
  const r2 = run([P('A', 1, { hp: 100 }), P('B', 2, { hp: 81 }), P('C', 3, { hp: 69 })], { A: D(4000, 0), B: D(5000, 1), C: D(5000, 1) }, 20, CD);
  check('D-2: tie at the end — A hits B and C for 30 each; B and C do not hit each other; HP 100/51/39', chainDmg(r2) === 'A>B:30 A>C:30' && hpEq(r2, { A: 100, B: 51, C: 39 }), chainDmg(r2));
  check('D-2 streaks: A +1, tied B and C (hit, dealt nothing) reset', r2.streak.A === 1 && r2.streak.B === 0 && r2.streak.C === 0);
  check('D-1 streaks: A +1, B +1 (hit and hits), C reset', d1.streak.A === 1 && d1.streak.B === 1 && d1.streak.C === 0);
}
{
  const r = run(mk([['A', 100, 1], ['B'], ['C'], ['D'], ['E']]), { A: D(6000, 0), B: D(6200, 2), C: D(7500, 0), D: D(7600, 0) }, 30, CD);
  check('D-3: 28, 38, 15, 38; HP 100/72/62/85/62; A\'s fire spent', chainDmg(r) === 'A>B:28 B>C:38 C>D:15 D>E:38' && hpEq(r, { A: 100, B: 72, C: 62, D: 85, E: 62 }) && r.fire.A === false && r.streak.A === 0, chainDmg(r));
  const r4 = run([P('A', 1), P('B', 2, { hp: 72 }), P('C', 3, { hp: 62 }), P('D', 4, { hp: 85 }), P('E', 5, { hp: 62 })], { A: D(7200, 0), B: D(9000, 0), C: D(9500, 1) }, 36, CD, true);
  check('D-4: ULTI, two unfinished — 60 x4 (cap); D and E are hit by C only; HP 100/12/2/25/2', chainDmg(r4) === 'A>B:60 B>C:60 C>D:60 C>E:60' && hpEq(r4, { A: 100, B: 12, C: 2, D: 25, E: 2 }), chainDmg(r4));
}
{
  const ms = [[4000, 0], [4300, 0], [4700, 1], [5800, 0], [5800, 2], [6100, 0], [7200, 1], [7250, 0], [9000, 3], [15000, 0]];
  const ents = ms.map((_, i) => P('P' + (i + 1), i + 1)); const dn = {}; ms.forEach(([e, t], i) => { dn['P' + (i + 1)] = D(e, t); });
  const r = run(ents, dn, 20, CD);
  const hpExp = { P1: 100, P2: 85, P3: 90, P4: 75, P5: 90, P6: 90, P7: 75, P8: 90, P9: 75, P10: 75 };
  check('D-5: 10 players, typo tie-break inside the chain; every HP as in the plan', hpEq(r, hpExp) && r.chain.length === 9 && r.order[3].id === 'P4' && r.order[4].id === 'P5', chainDmg(r));
}
{
  const spec = [[8000, 0, 100], [8300, 1, 40], [9000, 0, 70, 1], [9900, 0, 50], [10500, 1, 100], [12000, 0, 60], [12100, 0, 30, 1], [14000, 2, 100], [null, 0, 45], [null, 0, 90]];
  const ents = spec.map(([, , h, f], i) => P('P' + (i + 1), i + 1, { hp: h, fire: !!f })); const dn = {};
  spec.forEach(([e, t], i) => { if (e != null) dn['P' + (i + 1)] = D(e, t); });
  const r = run(ents, dn, 40, CD);
  const exp = { P1: 100, P2: 10, P3: 30, P4: 0, P5: 60, P6: 10, P7: 10, P8: 40, P9: 0, P10: 40 };
  check('D-6: 10 players, two combos, two unfinished, two KOs — every HP as in the plan', hpEq(r, exp), JSON.stringify(r.hp));
  check('D-6: KO list is P4 and P9 (P4 lands on exactly 0; P9 45-50 floors at 0); P4\'s own hit still lands', r.ko.slice().sort().join() === 'P4,P9' && r.chain.find(x => x.from === 'P4').applied === 40);
  check('D-6: P7 combo hit (62.5 -> 63) is capped at 60; P8>P9 unfinished clean is 50 before the HP floor', r.chain.find(x => x.to === 'P9').damage === 50 && r.chain.find(x => x.from === 'P7').damage === 60 && r.chain.find(x => x.from === 'P7').combo === true);
}
{
  const c7 = cfgOf({ BASE_PER_CHAR: 1, RANK_WEIGHT: 0, EXTRA_LAST_HIT: 1 });
  const ents = [P('A', 1), P('B', 2), P('C', 3)], dn = { A: D(8000, 0), B: D(8500, 1), C: D(10000, 1) };
  const r = run(ents, dn, 40, c7);
  const ex = r.chain.find(x => x.extra);
  check('D-7 flag on: B>C 50, extra A>C 60 (cap) — C receives 110, capped at 60 total: HP 100/40/40', hpEq(r, { A: 100, B: 40, C: 40 }) && ex && ex.damage === 60 && ex.applied === 10 && r.chain.find(x => x.from === 'B').applied === 50, chainDmg(r));
  const r0 = run(ents, dn, 40, cfgOf({ BASE_PER_CHAR: 1, RANK_WEIGHT: 0 }));
  check('D-7 flag off (default): no extra hit, C = 50', !r0.chain.some(x => x.extra) && hpEq(r0, { A: 100, B: 40, C: 50 }));
  check('EXTRA_LAST_HIT default is 0', E.CFG_DEFAULTS.EXTRA_LAST_HIT === 0);
  const two = run([P('A', 1), P('B', 2)], { A: D(8000, 0), B: D(9000, 0) }, 40, c7);
  check('extra hit needs >= 3 ranks (2 players: none)', !two.chain.some(x => x.extra));
}
{
  const r = run(mk([['A'], ['B'], ['C']]), { A: D(9000, 1) }, 30, CD);
  check('D-8: one finisher, two unfinished — 38 each, HP 100/62/62', chainDmg(r) === 'A>B:38 A>C:38' && hpEq(r, { A: 100, B: 62, C: 62 }), chainDmg(r));
  const r9 = run(mk([['A'], ['B'], ['C'], ['D'], ['E']]), {}, 30, CD);
  check('D-9: nobody finishes in 5 players — no hits, HP and streaks unchanged', r9.noHits && Object.values(r9.hp).every(h => h === 100));
  const keep = run([P('A', 1, { streak: 2 }), P('B', 2, { streak: 1 }), P('C', 3)], {}, 30, CD);
  check('D-9: streaks unchanged when nobody finishes', keep.streak.A === 2 && keep.streak.B === 1);
}
// A-na's oracle cross-check on the domino rows that need no tie-hitter rule (hp must agree)
{
  const players = [['A', 4000, 0, 100], ['B', 5300, 1, 100], ['C', 6800, 0, 100], ['D', 7000, 2, 100], ['E', null, 0, 100]].map(([id, e, t, hp]) => ({ id, elapsed: e, typos: t, hp, fire: false }));
  const o = oracleDomino({ len: 28, players, base: 1 });
  const r = run(players.map((p, i) => P(p.id, i + 1)), Object.fromEntries(players.filter(p => p.elapsed != null).map(p => [p.id, D(p.elapsed, p.typos)])), 28, CD);
  check('cross-check vs A-na oracle domino(): same HP for a 5-player round with one unfinished', hpEq(r, o.hp), JSON.stringify(r.hp) + ' vs ' + JSON.stringify(o.hp));
}

// ---------- ties (brief 2026-10-30 + DESIGN: lowest seat hits for its rank) ----------
{
  const r = run(mk([['A'], ['B'], ['C'], ['D']]), { A: D(5000, 0), B: D(5000, 0), C: D(5000, 0), D: D(9000, 0) }, 20, CD);
  check('3-way tie in front: seat 1 hits D; seats 2 and 3 hit nobody and nobody hits them', r.chain.length === 1 && r.chain[0].from === 'A' && r.chain[0].to === 'D' && r.hp.B === 100 && r.hp.C === 100, chainDmg(r));
  check('3-way tie in front: streak — hitter +1, the other tied seats reset (they hit nobody)', r.streak.A === 1 && r.streak.B === 0 && r.streak.C === 0);
  check('tied ranks share a competition rank (1,1,1,4)', r.order.map(o => o.rank).join() === '1,1,1,4');
  const m = run(mk([['A'], ['B'], ['C'], ['D']]), { A: D(4000, 0), B: D(6000, 0), C: D(6000, 0), D: D(9000, 0) }, 20, CD);
  check('tie in the middle: A hits B and C; seat 2 (B) hits D once; C hits nobody', m.chain.map(x => x.from + '>' + x.to).join() === 'A>B,A>C,B>D', m.chain.map(x => x.from + '>' + x.to).join());
  const s = run([P('X', 7), P('Y', 3)], { X: D(5000, 0), Y: D(5000, 0) }, 20, CD);
  check('2 players fully tied: draw', s.noHits);
  const low = run([P('Z', 9), P('Y', 3), P('W', 1)], { Z: D(3000, 0), Y: D(8000, 0), W: D(8000, 0) }, 20, CD);
  check('the rank\'s hitter is its lowest seat (not array position)', low.chain.map(x => x.from + '>' + x.to).sort().join() === 'Z>W,Z>Y');
  const low2 = run([P('Z', 9), P('Y', 3), P('W', 1), P('V', 5)], { Z: D(3000, 0), Y: D(5000, 0), W: D(5000, 0), V: D(9000, 0) }, 20, CD);
  check('tie then a last player: seat 1 (W) hits V, not Y (seat 3)', low2.chain.some(x => x.from === 'W' && x.to === 'V') && !low2.chain.some(x => x.from === 'Y'));
}

// ---------- rank weight (brief 2026-10-30): damage x k/(n-1), victim's finishing rank, k=1 for the 2nd finisher ----------
const CW = cfgOf({ BASE_PER_CHAR: 1, RANK_WEIGHT: 1 });
{
  const r = run(mk([['A'], ['B'], ['C']]), { A: D(5000, 0), B: D(5300, 1), C: D(6800, 0) }, 25, CW);
  check('rank weight, D-1 with 3 players: A>B 19 x 1/2 = 10 (9.5 rounds up), B>C 31 x 2/2; HP 100/90/69', chainDmg(r) === 'A>B:10 B>C:31' && hpEq(r, { A: 100, B: 90, C: 69 }), chainDmg(r));
  check('rank weight is exposed per link (damage before weight, weight, applied after)', r.chain[0].damage === 19 && r.chain[0].weight === 0.5 && r.chain[0].applied === 10 && r.chain[1].weight === 1);
  const r2 = run(mk([['A'], ['B']]), { A: D(5000, 0), B: D(6000, 0) }, 25, CW);
  check('2 players: weight is 1, so 1.0 is untouched', r2.chain[0].weight === 1 && r2.chain[0].applied === r2.chain[0].damage);
  const un = run(mk([['A'], ['B'], ['C'], ['D']]), { A: D(5000, 0) }, 20, CW);
  check('unfinished victims count as last: weight 1', un.chain.every(x => x.weight === 1) && un.chain.length === 3);
  const tie = run(mk([['A'], ['B'], ['C']]), { A: D(4000, 0), B: D(5000, 1), C: D(5000, 1) }, 20, CW);
  check('tied victims share the rank of their first seat: n=3, k=1 -> weight 1/2 for both', tie.chain.every(x => x.weight === 0.5));
  const off = run(mk([['A'], ['B'], ['C']]), { A: D(5000, 0), B: D(5300, 1), C: D(6800, 0) }, 25, cfgOf({ BASE_PER_CHAR: 1, RANK_WEIGHT: 0 }));
  check('RANK_WEIGHT=0 is pure domino (weight 1 everywhere)', off.chain.every(x => x.weight === 1));
}

// ---------- invariants over random rounds, against an independent reference ----------
function refRound(ents, dn, len, ulti, c) {
  // written separately from engine.js: sort, then walk the order list
  const n = ents.length;
  const fin = ents.filter(p => dn[p.id]).sort((a, b) => dn[a.id].elapsed - dn[b.id].elapsed || dn[a.id].typos - dn[b.id].typos || a.seat - b.seat);
  const unf = ents.filter(p => !dn[p.id]);
  const same = (a, b) => dn[a.id].elapsed === dn[b.id].elapsed && dn[a.id].typos === dn[b.id].typos;
  const ranks = []; fin.forEach((p, i) => { if (i > 0 && same(fin[i - 1], p)) ranks.push(ranks[i - 1]); else ranks.push(i); });
  const recv = {}; const dealt = new Set();
  const mark = (h, v, vk) => {
    const hd = dn[h.id], d = dn[v.id] ? dn[v.id].elapsed - hd.elapsed : Infinity;
    const m = d <= c.BLOCK_MS ? 0.5 : d <= c.JAB_MS ? 1 : 1.25;
    const crit = hd.typos === 0 && len * 1000 >= 5 * hd.elapsed;
    let dmg = Math.min(60, Math.round(len * c.BASE_PER_CHAR * m * (crit ? 1.5 : 1) * (h.fire ? 1.25 : 1) * (ulti ? 2.5 : 1)));
    const w = (!c.RANK_WEIGHT || n <= 2) ? 1 : vk / (n - 1);
    dmg = Math.min(60, Math.round(dmg * w));
    recv[v.id] = (recv[v.id] || 0) + dmg; dealt.add(h.id);
  };
  const rankSet = [...new Set(ranks)];
  rankSet.forEach((rk, gi) => {
    const members = fin.filter((p, i) => ranks[i] === rk); const hitter = members.reduce((a, b) => (b.seat < a.seat ? b : a));
    const nextRk = rankSet[gi + 1];
    if (nextRk !== undefined) fin.forEach((p, i) => { if (ranks[i] === nextRk) mark(hitter, p, nextRk); });
    else if (unf.length) unf.forEach(u => mark(hitter, u, n - 1));
  });
  const hp = {}; ents.forEach(p => { hp[p.id] = Math.max(0, p.hp - Math.min(60, recv[p.id] || 0)); });
  return { hp, hitters: dealt };
}
{
  let seed = 7; const rnd = () => E.mulberry32(seed++)();
  const g = E.mulberry32(20261030);
  const ri = (a, b) => a + Math.floor(g() * (b - a + 1));
  let mism = 0, over = 0, neg = 0, firstLost = 0, mut = 0, perm = 0, rounds = 0;
  for (let k = 0; k < 600; k++) {
    const n = ri(2, 10), len = ri(15, 45), ulti = len >= 30 && g() < 0.4, base = [0.5, 0.7, 1, 3][ri(0, 3)];
    const c = cfgOf({ BASE_PER_CHAR: base, RANK_WEIGHT: g() < 0.8 ? 1 : 0 });
    const ents = Array.from({ length: n }, (_, i) => P('p' + i, i + 1, { hp: ri(5, 100), fire: g() < 0.15, streak: ri(0, 2) }));
    const dn = {}; ents.forEach(p => { if (g() < 0.85) dn[p.id] = D(150 + ri(0, 140) * 100, ri(0, 3)); });
    // avoid ties except at the end (the reference handles ties, but keep a few exact ties on purpose)
    if (g() < 0.2 && ents.length > 2) { const a = ents[1], b = ents[2]; if (dn[a.id]) dn[b.id] = { ...dn[a.id] }; }
    const frozen = JSON.stringify([ents, dn]);
    const r = E.resolveRound(ents, dn, { text: 'y'.repeat(len), ulti }, c);
    const ref = refRound(ents, dn, len, ulti, c);
    rounds++;
    if (ents.some(p => r.hp[p.id] !== ref.hp[p.id])) mism++;
    if (ents.some(p => p.hp - r.hp[p.id] > 60)) over++;
    if (ents.some(p => r.hp[p.id] < 0)) neg++;
    if (r.order[0] && dn[r.order[0].id] && r.hp[r.order[0].id] !== ents.find(p => p.id === r.order[0].id).hp) firstLost++;
    if (JSON.stringify([ents, dn]) !== frozen) mut++;
    const sh = ents.slice().reverse(); const dn2 = {}; Object.keys(dn).reverse().forEach(k2 => { dn2[k2] = dn[k2]; });
    const r2 = E.resolveRound(sh, dn2, { text: 'y'.repeat(len), ulti }, c);
    if (ents.some(p => r2.hp[p.id] !== r.hp[p.id]) || JSON.stringify(r2.chain.map(x => x.from + x.to).sort()) !== JSON.stringify(r.chain.map(x => x.from + x.to).sort())) perm++;
  }
  check(`600 random rounds (N 2-10, ties, unfinished, base 0.5-3): HP equals the independent reference (${rounds}/${rounds})`, mism === 0, mism + ' mismatches');
  check('invariant: nobody receives more than 60 in a round, HP never < 0', over === 0 && neg === 0);
  check('invariant: the first finisher never loses HP (flag off)', firstLost === 0, String(firstLost));
  check('invariant: inputs are not mutated, and the result does not depend on array / insertion order', mut === 0 && perm === 0, `mut ${mut} perm ${perm}`);
}

// ---------- streak / fire (C1 + brief ties bullet) ----------
{
  const c = cfgOf({ BASE_PER_CHAR: 1, RANK_WEIGHT: 0 });
  let ents = [P('A', 1), P('B', 2), P('C', 3)];
  const play = () => { const r = run(ents, { A: D(5000, 0), B: D(6000, 0), C: D(7000, 0) }, 20, c); ents = ents.map(p => ({ ...p, hp: 100, streak: r.streak[p.id], fire: r.fire[p.id] })); return r; };
  const r1 = play(), r2 = play(), r3 = play();
  check('streak: A hits three rounds in a row -> fire on after the 3rd', r1.streak.A === 1 && r2.streak.A === 2 && r3.fire.A === true && r3.streak.A === 0);
  const r4 = play();
  check('combo: the 4th round A hits x1.25 and the fire is cleared', r4.chain[0].combo === true && r4.fire.A === false && r4.streak.A === 0);
  check('the last finisher (C) hits nobody every round: streak and fire stay 0; B (hits C) climbs', r4.streak.C === 0 && !r4.fire.C);
}


// ---------- client typing state machine (src/typing.js, pure) ----------
{
  const T = await import('../src/typing.js');
  const type = (text, steps) => { const t = T.createTyper(text); let v = ''; for (const st of steps) { v = typeof st === 'function' ? st(v, t) : st; v = t.input(v); } return t; };
  let t = T.createTyper('aku pulang');
  let v = t.input('a'); v = t.input('ak'); v = t.input('aku');
  check('typing: correct prefix is kept, no typos', t.typed === 'aku' && t.typos === 0 && !t.done);
  v = t.input('akux');
  check('typing: a wrong char turns bad, counts 1 typo, input mirror = typed + bad', t.bad === 'x' && t.typos === 1 && v === 'akux');
  v = t.input('akuxy');
  check('typing: more characters are ignored while a bad char is pending (mirror unchanged, no extra typo)', v === 'akux' && t.typos === 1 && t.typed === 'aku');
  v = t.input('aku');
  check('typing: backspace removes the red char first; typed prefix intact', t.bad === '' && t.typed === 'aku' && v === 'aku');
  v = t.input('ak');
  check('typing: backspace over a correct char shortens typed', t.typed === 'ak');
  t = T.createTyper('aku');
  t.input('aku');
  check('typing: completing the line sets done', t.done && t.typed === 'aku');
  const v2 = t.input('aku '); 
  check('typing: a trailing space predicted after the last char is ignored (done stays, no typo)', t.done && t.typos === 0 && v2 === 'aku');
  t = T.createTyper('it\'s ok kok');
  t.input('it\u2019s ok');
  check('typing: curly apostrophe maps to the straight one (no typo)', t.typed === "it's ok" && t.typos === 0);
  t = T.createTyper('ayo main sekarang');
  t.input('ayo m'); t.input('ayo main ');
  check('typing: a predictive keyboard inserting "ain " in one event is read char by char', t.typed === 'ayo main ' && t.typos === 0);
  t.input('ayo mxin ');
  check('typing: a replacement that is not an append is re-read from the start and counts one typo', t.typed === 'ayo m' && t.bad === 'x' && t.typos === 1);
  t = T.createTyper('Aku, ya!');
  t.input('aku'); check('typing: case matters (round >= 4 lines keep capitals)', t.bad === 'a' && t.typed === '');
  t = T.createTyper('abc'); t.input('abx'); t.input('ab'); t.input('abz');
  check('typing: each fresh wrong char after a backspace is a new typo', t.typos === 2);
  const a = T.createTyper('abc'); a.input('a'); const dn = a.input('abc');
  check('typing: done returns the final mirror and further input changes nothing', a.done && a.input('abcd') === 'abc');
}

process.exit(summary() ? 1 : 0);
