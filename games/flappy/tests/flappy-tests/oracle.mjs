// Reachability oracle (RFC §3 layer 2). Pass/fail: does ANY flap / no-flap input sequence survive?
// DP over (y in 2 px buckets, k = frames since the last flap), v = FLAP + G*k. The obstacle schedule comes from the
// core's own scheduler (a ghost world: stepWorld only, no bird), the blocked ranges from def.blocked via blockedAt.
const H = 640, GROUND = H - 80, G = 0.45, FLAP = -7.5, R = 14, K = 64, B = 2, NB = Math.ceil(GROUND / B), M = 1;

export function oracle(core, seed, startScore, nObst, opts = {}) {
  const w = core.createWorld(seed, startScore);
  if (opts.fc) Object.assign(w.fc, opts.fc);               // test-only: defang fairCheck so the oracle is tested on its own
  const target = startScore + nObst;
  const out = new Float64Array(64);
  let ky = new Int32Array(K * NB * 2), ys = new Float64Array(K * NB * 2), cnt = 0;       // active states
  let nky = new Int32Array(K * NB * 2), nys = new Float64Array(K * NB * 2), ncnt = 0;
  const stamp = new Int32Array(K * NB); let sid = 0;
  ky[0] = 17 * NB + ((H / 2 / B) | 0); ys[0] = H / 2; cnt = 1;                          // ready-state start: v ~ 0
  const types = {}; let frames = 0, minStates = 1e9;
  w.hook = (o) => { types[o.type] = (types[o.type] || 0) + 1; };
  const seenTypes = {};
  while (w.score < target) {
    w.ev = 0; w.dead = false; w.bird.y = H / 2; w.bird.v = 0;
    core.stepWorld(w); frames++;
    if (w.ev & core.NEW_TYPE) seenTypes[w.newType] = (seenTypes[w.newType] || 0) + 1;
    const n = core.blockedAt(w, 0, out);
    sid++; ncnt = 0;
    const add = (k2, y2) => {
      if (y2 < R + M || y2 > GROUND - R - M) return;
      for (let i = 0; i < n; i++) if (y2 > out[2 * i] - M && y2 < out[2 * i + 1] + M) return;
      const key = k2 * NB + ((y2 / B) | 0);
      if (stamp[key] === sid) return; stamp[key] = sid; nky[ncnt] = key; nys[ncnt] = y2; ncnt++;
    };
    for (let s = 0; s < cnt; s++) {
      const k = (ky[s] / NB) | 0, y = ys[s];
      const k2 = Math.min(k + 1, K - 1); add(k2, y + FLAP + G * k2);                    // no flap
      add(1, y + FLAP + G);                                                              // flap
    }
    if (ncnt === 0) return { ok: false, frames, passed: w.score - startScore, failFrame: frames, w, seenTypes };
    [ky, nky] = [nky, ky]; [ys, nys] = [nys, ys]; cnt = ncnt; if (cnt < minStates) minStates = cnt;
    if (opts.ghostScoreCap) w.score = Math.min(w.score, opts.ghostScoreCap);
  }
  return { ok: true, frames, passed: w.score - startScore, spawns: w.spawns, rerolls: w.rerolls, fallbacks: w.fallbacks, minStates, seenTypes, types, w };
}
