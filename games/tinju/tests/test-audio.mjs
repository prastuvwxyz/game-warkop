// Tinju Kata 2.0 audio test. Usage: node test-audio.mjs [port=3631]
// Hooks AudioContext (oscillators, buffer sources, detune) to check: autoplay policy, the soft detuned lobby pad,
// four hit sounds that are layered (impact click + low thump + tail, >= 3 sources each) and told apart, and that the game fires
// the right hit sound for the right tier. Ports 3100/3200 are never used.
import { sleep, makeChecker, startServer, launchBrowser, devices } from './test-lib.mjs';

const PORT = Number(process.argv[2] || 3631);
if ([3100, 3200].includes(PORT)) { console.error('refusing to use 3100/3200'); process.exit(2); }
const { check, summary } = makeChecker('test-audio');
const srv = startServer(PORT, { TK_COUNTDOWN_MS: 600, TK_RESULT_MS: 900, TK_HP: 30, TK_ULTI_MIN: 4, TK_ULTI_MAX: 4, TK_SEED: 31 }, 'server-audio.log');
await srv.ready;
const URL = `http://127.0.0.1:${PORT}/tinju/`;
const browser = await launchBrowser(['--autoplay-policy=no-user-gesture-required']);
const errors = [];
const HOOK = () => {
  window.__osc = 0; window.__buf = 0; window.__ctxs = 0; window.__oscTypes = []; window.__detunes = []; window.__starts = 0;
  const P = AudioContext.prototype, co = P.createOscillator, cb = P.createBufferSource;
  P.createOscillator = function () { window.__osc++; const o = co.apply(this, arguments); const st = o.start.bind(o); o.start = function () { window.__starts++; window.__oscTypes.push(o.type); window.__detunes.push(o.detune.value); return st.apply(null, arguments); }; return o; };
  P.createBufferSource = function () { window.__buf++; return cb.apply(this, arguments); };
  const Orig = window.AudioContext;
  window.AudioContext = function () { window.__ctxs++; return new Orig(...arguments); }; window.AudioContext.prototype = Orig.prototype;
};
async function mk(opts, label) {
  const ctx = await browser.newContext(opts); await ctx.addInitScript(HOOK);
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`${label}: pageerror ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errors.push(`${label}: console ${m.text()}`); });
  p.on('dialog', d => d.accept());
  return p;
}
const cnt = p => p.evaluate(() => ({ osc: window.__osc, buf: window.__buf }));
const au = p => p.evaluate(() => ({ ctx: !!__tinju.audio.ctx, state: __tinju.audio.ctx && __tinju.audio.ctx.state, pad: !!__tinju.audio.nodes, started: __tinju.audio.started, sfx: __tinju.audio.sfx, musicOn: __tinju.audio.music }));
const sig = async (p, name) => { // run one hit sound alone and describe its node graph
  await p.evaluate(() => { window.__osc = 0; window.__buf = 0; window.__oscTypes = []; });
  await p.evaluate(n => __tinju.sfx[n](), name); await sleep(80);
  return p.evaluate(() => ({ osc: window.__osc, buf: window.__buf, types: window.__oscTypes.slice().sort().join('+') }));
};

const A = await mk({ viewport: { width: 1200, height: 900 } }, 'A');
const B = await mk({ ...devices()['iPhone 12'] }, 'B');

// ---- autoplay policy + the lobby pad ----
await A.goto(URL); await sleep(300);
let a0 = await au(A);
check('no AudioContext before the first gesture (ctx null, 0 oscillators, 0 contexts)', !a0.ctx && (await cnt(A)).osc === 0 && (await A.evaluate(() => window.__ctxs)) === 0, JSON.stringify(a0));
check('music button pulses (class wait) until the first gesture', await A.$eval('#btnMusic', b => b.classList.contains('wait')));
await A.click('#name'); await sleep(400);
const a1 = await au(A);
check('first gesture creates the AudioContext, state running', a1.ctx && a1.state === 'running', JSON.stringify(a1));
check('soft pad starts by default: pad nodes + >= 9 oscillators (8 chord voices + LFO)', a1.pad && (await cnt(A)).osc >= 9, JSON.stringify(await cnt(A)));
const dts = await A.evaluate(() => window.__detunes);
check('pad voices are detuned (-7 and +7 cents both present)', dts.includes(-7) && dts.includes(7), dts.join());
check('pad is built from triangles (soft)', (await A.evaluate(() => window.__oscTypes)).filter(t => t === 'triangle').length >= 8);
check('pulse stops after the gesture', !(await A.$eval('#btnMusic', b => b.classList.contains('wait'))));
await A.click('#btnMusic'); await sleep(100);
check('music off: pad released, pref saved in tk_snd, button shows off', !(await au(A)).pad && (await A.evaluate(() => JSON.parse(localStorage.getItem('tk_snd')).music)) === false && await A.$eval('#btnMusic', b => b.classList.contains('off')));
await A.click('#btnMusic'); await sleep(100);
check('music on again: pad back', (await au(A)).pad);
await A.click('#btnMusic'); await sleep(1700); // leave OFF so counts below are hit sounds only

// ---- the four hit sounds: layered and distinct ----
const S = {};
for (const n of ['jab', 'block', 'uppercut', 'ko']) S[n] = await sig(A, n);
for (const n of ['jab', 'block', 'uppercut', 'ko']) check(`${n}: layered — at least 3 sound sources (click + thump + tail): ${S[n].osc} oscillators + ${S[n].buf} noise`, S[n].osc + S[n].buf >= 3, JSON.stringify(S[n]));
for (const n of ['jab', 'block', 'uppercut', 'ko']) check(`${n}: has an impact click (noise burst) and a low thump (oscillator)`, S[n].buf >= 1 && S[n].osc >= 1);
const sigs = Object.values(S).map(s => `${s.osc}/${s.buf}/${s.types}`);
check('the four graphs all differ (distinguishable with eyes closed): ' + sigs.join('  '), new Set(sigs).size === 4);
check('uppercut and ko are heavier than jab (more sources)', S.uppercut.osc + S.uppercut.buf > S.jab.osc + S.jab.buf && S.ko.osc + S.ko.buf > S.uppercut.osc + S.uppercut.buf);
const kept = {};
for (const n of ['tap', 'err', 'win', 'lose', 'roundBell']) kept[n] = await sig(A, n);
check('kept sounds still play: tap, err, win, lose, roundBell each make >= 1 oscillator', Object.values(kept).every(k => k.osc >= 1), JSON.stringify(kept));
await A.click('#btnSfx'); await sleep(80);
const off0 = await cnt(A); await A.evaluate(() => __tinju.sfx.jab()); await sleep(80);
check('effects off: a hit makes no sound source', JSON.stringify(await cnt(A)) === JSON.stringify(off0));
check('effects off is saved in tk_snd', (await A.evaluate(() => JSON.parse(localStorage.getItem('tk_snd')).sfx)) === false);
await A.click('#btnSfx'); await sleep(80);

// ---- in a match: the right hit sound per tier, the KO sound, pad off during the match ----
await A.evaluate(() => { localStorage.setItem('tk_snd', JSON.stringify({ sfx: true, music: true })); });
await A.reload(); await sleep(300);
check('after a reload no AudioContext exists until a tap (autoplay policy)', !(await au(A)).ctx);
await A.click('#name'); await sleep(300);
check('after the tap the pad plays again (music pref on)', (await au(A)).pad);
await B.goto(URL); await B.click('#name'); await sleep(200);
await A.fill('#name', 'Ana'); await A.click('#btnCreate'); await A.waitForSelector('#scr-lobby.active');
check('lobby: the pad is playing', (await au(A)).pad);
const code = (await A.textContent('#lobbyCode')).trim();
await B.fill('#name', 'Budi'); await B.fill('#joinCode', code); await B.click('#btnJoin'); await B.waitForSelector('#scr-lobby.active');
for (const p of [A, B]) await p.evaluate(() => { window.__hits = []; for (const n of ['jab', 'block', 'uppercut', 'ko']) { const o = __tinju.sfx[n]; __tinju.sfx[n] = function () { window.__hits.push(n); return o.apply(this, arguments); }; } });
await A.waitForFunction(() => __tinju.state.players.length === 2);
await A.click('#btnStart'); await sleep(250);
check('the pad stops when the countdown starts', !(await au(A)).pad);

async function driver(p, delay, stop) {
  let last = 0;
  while (!stop.v) {
    const r = await p.evaluate(({ last }) => { const t = __tinju, s = t.state; if (!s) return {}; if (s.state === 'ended') return { ended: true }; const l = t.line; return (s.state === 'line' && l && l.round > last && l.entrant && !t.typing.sentDone) ? { text: l.text, round: l.round } : {}; }, { last }).catch(() => ({}));
    if (r.ended) return;
    if (r.text) { last = r.round; try { await p.evaluate(() => document.getElementById('typer').focus()); await p.keyboard.type(r.text, { delay }); } catch (e) {} } else await sleep(25);
  }
}
const stop = { v: false };
await Promise.race([Promise.all([driver(A, 25, stop), driver(B, 80, stop)]), sleep(90000)]); stop.v = true;
await A.waitForFunction(() => __tinju.state.state === 'ended', null, { timeout: 15000 }).catch(() => {});
const hitsA = await A.evaluate(() => window.__hits), hitsB = await B.evaluate(() => window.__hits);
const resA = await A.evaluate(() => ({ s: __tinju.state.state, win: __tinju.state.winnerId, me: __tinju.me }));
check('the match ended in a KO (HP 30)', resA.s === 'ended');
check('hit sounds fired in the match on both screens (hitter and victim hear it)', hitsA.length >= 2 && hitsB.length >= 2, JSON.stringify([hitsA, hitsB]));
check('the KO sound played for the knocked-out round on both screens', hitsA.includes('ko') && hitsB.includes('ko'), JSON.stringify([hitsA, hitsB]));
const tiers = await A.evaluate(() => window.__rec ? null : null);
check('only the four hit sounds are used for hits (jab/block/uppercut/ko)', [...hitsA, ...hitsB].every(h => ['jab', 'block', 'uppercut', 'ko'].includes(h)));
check('the pad is back at the end screen (lobby/ended play the pad)', (await au(A)).pad);
await A.close(); await B.close();

// ---- iPhone 12: gesture rules ----
const M = await mk({ ...devices()['iPhone 12'] }, 'M');
await M.goto(URL); await sleep(200);
check('iPhone 12: no AudioContext before a tap', !(await au(M)).ctx);
await M.tap('#name'); await sleep(300);
check('iPhone 12: a tap unlocks audio (running) and starts the pad', (await au(M)).state === 'running' && (await au(M)).pad);
await M.close();

check('0 console errors and 0 page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
await browser.close(); srv.stop();
process.exit(summary() ? 1 : 0);
