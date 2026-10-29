// STEP 4 — ranks: data, rankOf, once-per-tier, migration (emblem/panel/title wiring is covered in gate.mjs).
import { loadCore, mulberry32 } from './lib.mjs';

// A-na's table (test plan §2.3) — typed in by hand, NOT derived from the core: [tier, name, I, II, III]
export const RANK_TABLE = [
  ['Kayu', 1, 2, 4], ['Batu', 5, 7, 8], ['Perunggu', 10, 13, 17], ['Perak', 20, 23, 27], ['Emas', 30, 33, 37], ['Platinum', 40, 45, 50],
  ['Zamrud', 55, 60, 65], ['Rubi', 70, 77, 83], ['Berlian', 90, 100, 110], ['Master', 120, 130, 140], ['Grandmaster', 150, 167, 183],
  ['Legenda', 200, 217, 233], ['Mitos', 250, 267, 283], ['Dewa', 300, 350, 400]];

export default async function ({ check, section }) {
  section('STEP 4 — rank ladder: rankOf table, once-per-tier, migration');
  const K = loadCore(), RN = K.RANKS.map(r => r.name);
  check('14 tiers in the order Kayu..Dewa, thresholds as the RFC table', K.RANKS.length === 14 && K.RANKS.map(r => r.min).join() === '1,5,10,20,30,40,55,70,90,120,150,200,250,300' && RN.join() === RANK_TABLE.map(r => r[0]).join());
  check('thresholds 10/20/30/40 kept for Perunggu/Perak/Emas/Platinum', [2, 3, 4, 5].every((t, i) => K.RANKS[t].min === [10, 20, 30, 40][i]));
  check('tier bits are 1<<index and unique', K.RANKS.every((r, i) => r.bit === 1 << i));
  let n = 0, bad = [];
  const eq = (sc, tier, sub) => { n++; const r = K.rankOf(sc); if (r.tier !== tier || r.sub !== sub) bad.push(`rankOf(${sc})=${r.tier}/${r.sub} want ${tier}/${sub}`); };
  RANK_TABLE.forEach((row, t) => {
    for (let sub = 0; sub < 3; sub++) {
      const N = row[1 + sub];
      // at N-1 the state is the previous sub-level (or previous tier's III, or "no rank" below Kayu I)
      const pt = sub > 0 ? t : t - 1, ps = sub > 0 ? sub - 1 : 2;
      eq(N - 1, pt, pt < 0 ? 0 : ps);
      eq(N, t, sub);
    }
  });
  check(`rankOf table test: 14 tiers x 3 sub-levels at N-1 and N (${n} assertions)`, bad.length === 0 && n === 84, bad.slice(0, 4).join(' | '));
  check('score 0 => no rank (tier -1, the "?" medal)', K.rankOf(0).tier === -1);
  check('best 200 => Legenda I (tier index 11 of 14)', (() => { const r = K.rankOf(200); return r.tier === 11 && r.sub === 0 && RN[r.tier] === 'Legenda'; })());
  check('299 => Mitos III, 300 => Dewa I, 350 => Dewa II, 400 and 10000 => Dewa III (span 150)', (() => { const g = s => K.rankOf(s); return g(299).tier === 12 && g(299).sub === 2 && g(300).tier === 13 && g(300).sub === 0 && g(349).sub === 0 && g(350).sub === 1 && g(399).sub === 1 && g(400).sub === 2 && g(10000).tier === 13 && g(10000).sub === 2; })());
  { // v2 medal() names kept, nobody demoted: v2 PERUNGGU>=10, PERAK>=20, EMAS>=30, PLATINUM>=40
    let ok = true; const v2 = s => s >= 40 ? 'Platinum' : s >= 30 ? 'Emas' : s >= 20 ? 'Perak' : s >= 10 ? 'Perunggu' : null;
    for (let s = 10; s <= 54; s++) if (RN[K.rankOf(s).tier] !== v2(s)) { ok = false; }
    for (let s = 0; s <= 60; s++) { const v = v2(s); if (v && K.rankOf(s).tier < RN.indexOf(v)) ok = false; }
    check('no demotion vs v2 medal(): names equal for 10..54, never lower for 0..60', ok); }
  { let prev = -2 * 3, mono = true; const seen = new Set(); for (let s = 0; s <= 1000; s++) { const r = K.rankOf(s), idx = r.tier * 3 + r.sub; if (idx < prev) mono = false; prev = idx; seen.add(idx); }
    check(`rankOf monotonic and total over 0..1000, ${seen.size} distinct states (42 ranked + none)`, mono && seen.size === 43); }
  { // next / from are consistent: at next-1 still the same state with "+1", at next the following state
    let ok = true, detail = '';
    for (let s = 1; s < 450; s++) { const r = K.rankOf(s); if (r.next < 0) { if (r.tier !== 13 || r.sub !== 2) ok = false; continue; }
      const a = K.rankOf(r.next - 1), b = K.rankOf(r.next);
      if (a.tier !== r.tier || a.sub !== r.sub || (b.tier * 3 + b.sub) !== (r.tier * 3 + r.sub + 1) || r.from > s || K.rankOf(r.from).tier !== r.tier || K.rankOf(r.from).sub !== r.sub) { ok = false; detail = `s=${s} ${JSON.stringify(r)}`; break; } }
    check('progress fields: next = first score of the following sub-level, from = first score of the current one', ok, detail); }
  check('UI example: score 34 => Emas II, "+3 ke Emas III" (next 37)', (() => { const r = K.rankOf(34); return r.tier === 4 && r.sub === 1 && r.next - 34 === 3; })());

  // once-per-tier via simulated deaths (the shell calls rankUpCheck on every death)
  const sim = (seen0, scores) => { let seen = seen0; const toasts = []; for (const sc of scores) { const r = K.rankUpCheck(seen, sc); if (r.toast) toasts.push(RN[r.tier]); seen = r.mask; } return { toasts, seen }; };
  const mig = best => K.rankUpMask(0, K.rankOf(best).tier);                  // what the shell does when flappy_ranks_seen is missing
  check('best 9 -> run to 10 -> die: Perunggu toast exactly once; die at 10 again, 11, 12: none', sim(mig(9), [10, 10, 11, 12, 10]).toasts.join() === 'Perunggu');
  check('fresh player, first run to 12: ONE toast (Perunggu), Kayu/Batu never toast later', (() => { const r = sim(mig(0), [12, 3, 7, 12, 9]); return r.toasts.join() === 'Perunggu' && (r.seen & 7) === 7; })());
  check('sub-levels never toast: 30 (Emas I) toasts once, 33 (Emas II), 37 (Emas III) do not', sim(mig(29), [30, 33, 37, 34]).toasts.join() === 'Emas');
  check('migration best=200 (no ranks_seen key): no toast for tiers <= Legenda, first Mitos run toasts', (() => { const r = sim(mig(200), [5, 120, 199, 200, 249, 250, 251]); return r.toasts.join() === 'Mitos'; })());
  check('migration marks exactly tiers <= rankOf(best): best 200 => mask 0b111111111111', mig(200) === 0xFFF && mig(0) === 0 && mig(9) === 3);
  { // random deaths: toasts == number of new tier records, never > 14, never a repeat
    const rr = mulberry32(5); let seen = mig(0), toasts = 0, maxTier = -1, rec = 0, repeat = false; const got = new Set();
    for (let i = 0; i < 5000; i++) { const sc = Math.floor(Math.pow(rr(), 2.2) * 420); const r = K.rankUpCheck(seen, sc); if (r.toast) { toasts++; if (got.has(r.tier)) repeat = true; got.add(r.tier); } seen = r.mask; if (r.tier > maxTier) { maxTier = r.tier; rec++; } }
    check(`5000 random deaths: ${toasts} toasts <= 14, = number of new highest tiers (${rec}), no tier twice`, toasts <= 14 && toasts === rec && !repeat); }
  check('rank-up mask: reaching tier t sets every bit <= t', [0, 3, 9, 13].every(t => K.rankUpMask(0, t) === (1 << (t + 1)) - 1) && K.rankUpMask(5, -1) === 5);
  check('ranks_seen mask range is 14 bits', K.MASK_RANKS === 16383);
}
