// A-na's independent 2.0 oracle, written from games/tinju/README.md (Rules) + DESIGN.md (domino steps 1-6).
// Not derived from server/engine.js. v2 (2026-10-30): rank weight, lowest-seat tie hitter, brief streak rule, cfg-driven.
export const SHIP = { BASE: 0.6, RW: 1, EXTRA: 0, BLOCK: 400, JAB: 1000, CPS: 5, CAP: 60, RCAP: 60, CRITX: 1.5, COMBOX: 1.25, ULTIX: 2.5 };

// One link. Returns the arithmetic as a string too, so the gate doc can quote it.
export function link({ len, hitter, hitee, ulti = false, combo = false, base = SHIP.BASE, c = SHIP }) {
  const d = hitee.elapsed == null ? null : hitee.elapsed - hitter.elapsed;
  const [tier, m] = d == null ? ['clean', 1.25] : d <= c.BLOCK ? ['block', 0.5] : d <= c.JAB ? ['jab', 1] : ['clean', 1.25];
  const crit = hitter.typos === 0 && len * 1000 >= c.CPS * hitter.elapsed;
  const raw = len * base * m * (crit ? c.CRITX : 1) * (combo ? c.COMBOX : 1) * (ulti ? c.ULTIX : 1);
  const dmg = Math.min(c.CAP, Math.round(raw));
  const f = [len, base, m]; if (crit) f.push(c.CRITX); if (combo) f.push(c.COMBOX); if (ulti) f.push(c.ULTIX);
  return { d, tier, m, crit, combo, raw, dmg, math: `${f.join('×')} = ${+raw.toFixed(4)} → ${Math.round(raw)}${Math.round(raw) > c.CAP ? ' → cap 60' : ''}` };
}

// players: [{id, seat, elapsed|null, typos, hp, fire, streak}]
export function domino({ len, players, ulti = false, base = SHIP.BASE, rw = SHIP.RW, extra = SHIP.EXTRA, c = SHIP }) {
  const n = players.length;
  const fin = players.filter(p => p.elapsed != null).sort((a, b) => a.elapsed - b.elapsed || a.typos - b.typos || a.seat - b.seat);
  const unf = players.filter(p => p.elapsed == null).sort((a, b) => a.seat - b.seat);
  const groups = [];
  for (const p of fin) { const g = groups.at(-1); if (g && g[0].elapsed === p.elapsed && g[0].typos === p.typos) g.push(p); else groups.push([p]); }
  // competition rank: first index + 1
  let idx = 0; const rank = {}; for (const g of groups) { for (const p of g) rank[p.id] = idx + 1; idx += g.length; }
  if (unf.length) { groups.push(unf); for (const p of unf) rank[p.id] = fin.length + 1; }
  const weight = p => (!rw || n <= 2 || p.elapsed == null) ? 1 : (rank[p.id] - 1) / (n - 1);
  const hits = [], recv = {}, dealt = new Set();
  const doHit = (h, v, isExtra) => {
    const L = link({ len, hitter: h, hitee: v, ulti, combo: isExtra ? false : !!h.fire, base, c });
    const w = weight(v); const scaled = Math.min(c.CAP, Math.round(L.dmg * w));
    const applied = Math.max(0, Math.min(scaled, c.RCAP - (recv[v.id] || 0)));
    recv[v.id] = (recv[v.id] || 0) + applied; dealt.add(h.id);
    hits.push({ from: h.id, to: v.id, extra: !!isExtra, ...L, w, scaled, applied,
      math2: w === 1 ? `${L.dmg}` : `${L.dmg}×${rank[v.id] - 1}/${n - 1} = ${+(L.dmg * w).toFixed(4)} → ${scaled}` });
  };
  const lowest = g => g.reduce((a, b) => b.seat < a.seat ? b : a);
  for (let i = 0; i + 1 < groups.length; i++) { if (groups[i][0].elapsed == null) break; const h = lowest(groups[i]); for (const v of groups[i + 1]) doHit(h, v, false); }
  if (extra && groups.length >= 3 && groups[0][0].elapsed != null) { const h = lowest(groups[0]); for (const v of groups.at(-1)) doHit(h, v, true); }
  const noHits = hits.length === 0;
  const hp = {}, fire = {}, streak = {}, ko = [];
  for (const p of players) {
    hp[p.id] = Math.max(0, p.hp - (recv[p.id] || 0)); if (p.hp > 0 && hp[p.id] === 0) ko.push(p.id);
    let s = p.streak || 0, f = !!p.fire;
    if (!noHits) { if (dealt.has(p.id)) { if (f) { f = false; s = 0; } else if (++s >= 3) { f = true; s = 0; } } else { s = 0; f = false; } } // brief: hit nobody -> reset
    fire[p.id] = f; streak[p.id] = s;
  }
  return { order: groups.map(g => g.map(p => p.id).join('=')), rank, hits, recv, hp, fire, streak, ko };
}
