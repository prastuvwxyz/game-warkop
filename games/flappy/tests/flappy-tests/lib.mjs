// Shared helpers for the Flappy v3 test harness (Node, no deps).
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

export const HERE = new URL('.', import.meta.url).pathname;
export const ROOT = HERE.replace(/flappy-tests\/$/, '');
export const INDEX = process.env.FLAPPY_INDEX || ROOT + 'index.html';
export const V2 = ROOT + 'index.v2.html';

// ---- tiny check runner -------------------------------------------------
export const R_ = { pass: 0, fail: 0, fails: [] };
export function check(name, ok, detail = '') {
  if (ok) { R_.pass++; if (process.env.VERBOSE) console.log('  PASS ' + name + (detail ? ' — ' + detail : '')); }
  else { R_.fail++; R_.fails.push(name); console.log('  FAIL ' + name + (detail ? ' — ' + detail : '')); }
  return !!ok;
}
export function section(t) { console.log('\n== ' + t); }
export const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

// ---- core extraction (the marked block is run in an EMPTY vm context) ----
export function coreSource(file = INDEX) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('/*@core*/'), b = src.indexOf('/*@endcore*/');
  if (a < 0 || b < 0 || b < a) throw new Error('core markers missing');
  return src.slice(a + 9, b);
}
export function blockSource(name, file = INDEX) {
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf('/*@' + name + '*/'), b = src.indexOf('/*@end' + name + '*/');
  if (a < 0 || b < 0 || b < a) throw new Error(name + ' markers missing');
  return src.slice(a + name.length + 5, b);
}
// Names the core is expected to define; the eval expression reads them by name.
export const CORE_EXPORTS = ['W', 'H', 'GROUND', 'G', 'FLAP', 'GAP', 'PIPE_W', 'SPEED', 'SPAWN', 'R', 'BX',
  'MIN_OPEN', 'TELE', 'CLEAR', 'CLIMB', 'BAND_V', 'SCORED', 'DIED', 'ROAR', 'NEW_TYPE',
  'mulberry32', 'createWorld', 'step', 'stepWorld', 'fairCheck', 'blockedAt', 'freeIntervals', 'OBST', 'OBSTS',
  'RANKS', 'rankOf', 'rankUpMask', 'rankUpCheck', 'MASK_RANKS', 'MASK_SKINS', 'SKIN_META', 'skinUnlocked', 'skinIndex', 'skinNews', 'PALETTE_SKINS_MASK', 'parseBest', 'parseMask', 'snapshotWorld', 'restoreWorld', 'speedFor'];
export function loadCore(file = INDEX, withBot = false) {
  // Fresh EMPTY context. Math.random / Date.now are booby-trapped so a stray call inside core throws.
  const ctx = vm.createContext({});
  vm.runInContext("Math.random=function(){throw new Error('Math.random() used inside @core')};" +
    "Date.now=function(){throw new Error('Date.now() used inside @core')};", ctx);
  const names = CORE_EXPORTS.concat(withBot ? ['botDecide'] : []);
  const code = "'use strict';\n" + coreSource(file) + (withBot ? blockSource('bot', file) : '') +
    '\n;({' + names.join(',') + '})';
  return vm.runInContext(code, ctx, { filename: 'core.vm.js' });
}

// ---- independent PRNG + v2 reference (verbatim logic of v2 l.126, 140-154) ----
export function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const W = 360, H = 640, GROUND = H - 80, G = 0.45, FLAP = -7.5, GAP = 150, PIPE_W = 56, SPEED = 2.4, SPAWN = 95, R = 14;
export function v2new() { return { bird: { x: 80, y: H / 2, v: 0 }, pipes: [], score: 0, playFrame: 0, dead: false }; }
export function v2step(s, rand, flap) {
  const bird = s.bird;
  if (flap) bird.v = FLAP;                         // flap() sets v between updates
  const die = () => { if (!s.dead) { s.dead = true; bird.v = Math.max(bird.v, 0); } };
  bird.v += G; bird.y += bird.v;
  s.playFrame++;
  if (s.playFrame % SPAWN === 0) { const top = 60 + rand() * (GROUND - GAP - 120); s.pipes.push({ x: W, top, passed: false }); }
  for (const p of s.pipes) {
    p.x -= SPEED;
    if (!p.passed && p.x + PIPE_W < bird.x) { p.passed = true; s.score++; }
    const inX = bird.x + R > p.x && bird.x - R < p.x + PIPE_W;
    const hitY = bird.y - R < p.top || bird.y + R > p.top + GAP;
    if (inX && hitY) die();
  }
  s.pipes = s.pipes.filter(p => p.x + PIPE_W > 0);
  if (bird.y + R > GROUND) { bird.y = GROUND - R; die(); }
  if (bird.y - R < 0) { bird.y = R; die(); }
}

// ---- lookahead bot on the v2 representation (port of Jiwoo's bot4.js) ----
const BX = 80, N = 36, M = 2;
function band(pipes, k, speed, gap) {
  let lo = R + M, hi = GROUND - R - M;
  for (const p of pipes) { const px = p.x - speed * k; if (BX + R > px && BX - R < px + PIPE_W) { lo = Math.max(lo, p.top + R + M); hi = Math.min(hi, p.top + gap - R - M); } }
  return [lo, hi];
}
function survive(y0, v0, flapNow, pipes, speed, gap) {
  let best = 0;
  for (let j = 1; j <= N + 1; j++) {
    let y = y0, v = flapNow ? FLAP : v0, k = 1;
    for (; k <= N; k++) { if (k === j) v = FLAP; v += G; y += v; const [lo, hi] = band(pipes, k, speed, gap); if (y < lo || y > hi) break; }
    if (k > best) best = k; if (best > N) break;
  }
  return best;
}
export function v2bot(s) {
  const b = s.bird, pipes = s.pipes;
  const a = survive(b.y, b.v, true, pipes, SPEED, GAP), n = survive(b.y, b.v, false, pipes, SPEED, GAP);
  if (a !== n) return a > n;
  const nx = pipes.find(p => p.x + PIPE_W > BX - R); const c = nx ? nx.top + GAP / 2 : H / 2;
  return b.y > c + 20 && b.v >= 0;
}
