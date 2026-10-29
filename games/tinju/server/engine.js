'use strict';
// Tinju Kata 2.0 — pure rules. No I/O, no timers, no Math.random, no Date: the rule tests and the
// simulation call these functions directly (DESIGN.md "Authority"). Node >= 20, zero dependencies.

// All tuning constants live here. Each numeric one may be overridden by env TK_<KEY> (tests, playtests).
const CFG_DEFAULTS = {
  HP: 100, COUNTDOWN_MS: 2400, WORD_CAP_MS: 20000, CAP_SLACK_MS: 1000, RESULT_MS: 1400, LINK_MS: 150, TITLE_MS: 1000,
  WALKOVER_MS: 20000, LOBBY_OFFLINE_MS: 60000, ELAPSED_MIN: 150, MAX_PLAYERS: 10, MIN_PLAYERS: 2,
  BASE_PER_CHAR: 0.6, BLOCK_MS: 400, JAB_MS: 1000, M_BLOCK: 0.5, M_JAB: 1, M_CLEAN: 1.25,
  CRIT_CPS: 5, CRIT_X: 1.5, COMBO_STREAK: 3, COMBO_X: 1.25, ULTI_X: 2.5, ULTI_MIN: 4, ULTI_MAX: 6,
  CAP: 60, RECV_CAP: 60, EXTRA_LAST_HIT: 0, RANK_WEIGHT: 1,
  LINE_MIN: 15, LINE_MAX: 45, ULTI_LEN: 30, PLAIN_ROUNDS: 3,
  MIN_SONGS: 40, MIN_LINES: 200, MIN_SHORT: 150, MIN_LONG: 40,
};
function makeCfg(env) {
  env = env || {};
  const cfg = {};
  for (const k of Object.keys(CFG_DEFAULTS)) {
    const e = env['TK_' + k];
    cfg[k] = (e !== undefined && e !== '' && Number.isFinite(Number(e))) ? Number(e) : CFG_DEFAULTS[k];
  }
  return cfg;
}

// Seeded generator (same algorithm as Flappy's core). crypto stays for room codes and tokens only.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Rounds 1-3 show the line lowercase, only [a-z0-9 ], spaces collapsed.
function plainForm(line) {
  return String(line).toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/ +/g, ' ').trim();
}

const tierOf = (d, cfg) => d === null ? 'clean' : d <= cfg.BLOCK_MS ? 'block' : d <= cfg.JAB_MS ? 'jab' : 'clean';
const marginOf = (tier, cfg) => tier === 'block' ? cfg.M_BLOCK : tier === 'jab' ? cfg.M_JAB : cfg.M_CLEAN;

// One link of the domino: 1.0's damage function with the per-character base retuned for lines.
//   hitter {elapsed, typos, fire}, hitee {elapsed|null}, len = length of the form shown, ulti = bool.
// Returns {d, tier, margin, critical, combo, damage}; damage = min(CAP, round(...)) BEFORE rank weight.
function linkDamage(hitter, hitee, len, ulti, combo, cfg) {
  const d = hitee.elapsed == null ? null : hitee.elapsed - hitter.elapsed;
  const tier = tierOf(d, cfg), margin = marginOf(tier, cfg);
  const critical = hitter.typos === 0 && len * 1000 >= cfg.CRIT_CPS * hitter.elapsed; // integer compare, no float cps
  const damage = Math.min(cfg.CAP, Math.round(len * cfg.BASE_PER_CHAR * margin * (critical ? cfg.CRIT_X : 1) * (combo ? cfg.COMBO_X : 1) * (ulti ? cfg.ULTI_X : 1)));
  return { d, tier, margin, critical, combo, damage };
}

// resolveRound(entrants, dones, line, cfg) -> { order, chain, hp, streak, fire, ko, noHits }
//   entrants: [{id, seat, hp, streak, fire}]  — alive AND online at reveal (fixed by the room, not here)
//   dones:    Map or plain object  id -> {elapsed, typos}   (valid `done`s only)
//   line:     {text, ulti}  text = the form shown (len = text.length; spaces count)
// Inputs are not mutated. Nothing here depends on arrival order: only `elapsed`, `typos`, `seat`.
function resolveRound(entrants, dones, line, cfg) {
  const getDone = id => (dones instanceof Map ? dones.get(id) : dones[id]);
  const len = line.text.length, ulti = !!line.ulti, n = entrants.length;
  const fin = [], unf = [];
  for (const p of entrants) {
    const dn = getDone(p.id);
    if (dn) fin.push({ p, elapsed: dn.elapsed, typos: dn.typos }); else unf.push({ p, elapsed: null, typos: null });
  }
  fin.sort((a, b) => a.elapsed - b.elapsed || a.typos - b.typos || a.p.seat - b.p.seat);
  // ranks: equal elapsed AND equal typos share one (competition numbering 1,2,2,4); no hit inside a rank
  const groups = [];
  fin.forEach((x, i) => {
    const g = groups[groups.length - 1];
    if (g && g[0].elapsed === x.elapsed && g[0].typos === x.typos) g.push(x);
    else { groups.push([x]); x.rank = i + 1; return; }
    x.rank = g[0].rank;
  });
  for (const g of groups) for (const x of g) x.rank = g[0].rank;
  if (unf.length) { unf.sort((a, b) => a.p.seat - b.p.seat); groups.push(unf); for (const x of unf) x.rank = fin.length + 1; }
  const order = groups.flat().map(x => ({ id: x.p.id, rank: x.rank, elapsed: x.elapsed, typos: x.typos }));

  // rank weight: victim position k (second finisher = 1) / (n - 1); unfinished are the slowest: k = n - 1; 2 players: 1
  const weightOf = x => (!cfg.RANK_WEIGHT || n <= 2) ? 1 : (x.elapsed == null ? 1 : (x.rank - 1) / (n - 1));

  const chain = [], recv = {}, dealt = {};
  const hit = (from, to, extra) => {
    const combo = extra ? false : !!from.p.fire;
    const L = linkDamage(from, to, len, ulti, combo, cfg);
    const weight = weightOf(to);
    const scaled = Math.min(cfg.CAP, Math.round(L.damage * weight));
    const applied = Math.max(0, Math.min(scaled, cfg.RECV_CAP - (recv[to.p.id] || 0)));
    recv[to.p.id] = (recv[to.p.id] || 0) + applied;
    dealt[from.p.id] = true;
    chain.push({ from: from.p.id, to: to.p.id, tier: L.tier, d: L.d, margin: L.margin, critical: L.critical, combo: L.combo, ulti,
      damage: L.damage, weight, applied, extra: !!extra });
  };
  const hitterOf = g => g.reduce((a, b) => (b.p.seat < a.p.seat ? b : a)); // lowest seat of a rank hits for it
  for (let i = 0; i + 1 < groups.length; i++) {
    const g = groups[i];
    if (g[0].elapsed == null) break; // unfinished never hit
    const h = hitterOf(g);
    for (const v of groups[i + 1]) hit(h, v, false);
  }
  if (cfg.EXTRA_LAST_HIT && groups.length >= 3 && groups[0][0].elapsed != null) {
    const h = hitterOf(groups[0]);
    for (const v of groups[groups.length - 1]) hit(h, v, true);
  }

  const noHits = chain.length === 0; // nobody finished, or every entrant tied: a draw, streaks stay
  const hp = {}, streak = {}, fire = {}, ko = [];
  for (const p of entrants) {
    const newHp = Math.max(0, p.hp - (recv[p.id] || 0));
    hp[p.id] = newHp;
    if (p.hp > 0 && newHp === 0) ko.push(p.id);
    let s = p.streak, f = !!p.fire;
    if (!noHits) {
      if (dealt[p.id]) { if (f) { f = false; s = 0; } else { s++; if (s >= cfg.COMBO_STREAK) { f = true; s = 0; } } }
      else { s = 0; f = false; } // dealt nobody a hit (last, tied, unfinished): streak reset (brief 2026-10-30)
    }
    streak[p.id] = s; fire[p.id] = f;
  }
  return { order, chain, hp, streak, fire, ko, noHits };
}

module.exports = { CFG_DEFAULTS, makeCfg, mulberry32, plainForm, linkDamage, resolveRound };
