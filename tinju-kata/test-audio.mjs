// Tinju Kata audio + autoplay test. Usage: node test-audio.mjs [port=3201]
// Counts oscillators through an AudioContext.prototype hook (like bullscows' test-audio) and checks RFC 4.4 SFX counts.
import { sleep, makeChecker, startServer, launchBrowser, devices } from './test-lib.mjs';

const PORT = Number(process.argv[2] || 3201);
if ([3100, 3200].includes(PORT)) { console.error('refusing to use 3100/3200'); process.exit(2); }
const { check, summary } = makeChecker('test-audio');
const srv = startServer(PORT, { TK_COUNTDOWN_MS: 500, TK_RESULT_MS: 1000, TK_GRACE_MS: 700, TK_HP: 350 }, 'server-audio.log');
await srv.ready;
const URL = `http://127.0.0.1:${PORT}/tinju/`;
const browser = await launchBrowser(['--autoplay-policy=no-user-gesture-required']);
const errors = [];
const HOOK = () => {
  window.__osc = 0; window.__buf = 0; window.__ctxs = 0;
  const P = AudioContext.prototype, co = P.createOscillator, cb = P.createBufferSource;
  P.createOscillator = function () { window.__osc++; return co.apply(this, arguments); };
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
const osc = p => p.evaluate(() => window.__osc);
const au = p => p.evaluate(() => ({ ctx: !!__tinju.audio.ctx, state: __tinju.audio.ctx && __tinju.audio.ctx.state, music: !!__tinju.audio.nodes, started: __tinju.audio.started, sfx: __tinju.audio.sfx, musicOn: __tinju.audio.music }));
async function waitReady(p, minRound) {
  const h = await p.waitForFunction(r => { const t = window.__tinju, s = t.state; if (!s) return false; if (s.state === 'ended') return 'ended';
    return (s.state === 'word' && t.word && t.word.round === s.round && s.round >= r && !t.typing.sentDone && t.typing.typed === '' && !t.typing.bad) ? 'word' : false; }, minRound, { timeout: 25000 });
  return h.jsonValue();
}
const waitResult = (p, r) => p.waitForFunction(n => { const l = window.__tinju.lastResult; return l && l.round === n; }, r, { timeout: 15000 });

const A = await mk({ viewport: { width: 1200, height: 900 } }, 'A');
const B = await mk({ ...devices()['iPhone 12'] }, 'B');

// ---- autoplay policy + music boot ----
await A.goto(URL); await sleep(300);
let a0 = await au(A);
check('no AudioContext before the first gesture (ctx null, 0 oscillators, 0 contexts)', !a0.ctx && (await osc(A)) === 0 && (await A.evaluate(() => window.__ctxs)) === 0, JSON.stringify(a0));
check('music button pulses (class wait) until the first gesture', await A.$eval('#btnMusic', b => b.classList.contains('wait')));
await A.click('#name'); await sleep(300);
const a1 = await au(A);
check('first gesture creates the AudioContext, state running', a1.ctx && a1.state === 'running', JSON.stringify(a1));
check('music starts by default: pad nodes + >= 9 oscillators (8 chord voices + LFO)', a1.music && (await osc(A)) >= 9, 'osc=' + await osc(A));
check('rain bed buffer source created exactly once', (await A.evaluate(() => window.__buf)) === 1);
check('music scheduler is on the audio clock (nextAt is ahead of ctx.currentTime)', await A.evaluate(() => __tinju.audio.nodes.nextAt > __tinju.audio.ctx.currentTime));
check('pulse stops after the gesture', !(await A.$eval('#btnMusic', b => b.classList.contains('wait'))));
await A.click('#btnMusic'); await sleep(100);
const a2 = await au(A);
check('music off: nodes released, pref saved in tk_snd, button shows off', !a2.music && !a2.musicOn && (await A.evaluate(() => JSON.parse(localStorage.getItem('tk_snd')).music)) === false && await A.$eval('#btnMusic', b => b.classList.contains('off')));
await A.click('#btnMusic'); await sleep(100);
check('music on again: nodes back', (await au(A)).music);
await A.click('#btnMusic'); await sleep(1700); // leave OFF, let the fade-out timers finish so counts below are SFX only

// ---- direct SFX counts (RFC 4.4 + kept SFX) ----
const want = { roundBell: 2, punch: 2, block: 1, uppercut: 3, koBell: 3, tap: 1, err: 1, win: 5, lose: 3, join: 2 };
for (const [name, n] of Object.entries(want)) {
  const b0 = await osc(A); await A.evaluate(nm => __tinju.sfx[nm](), name); await sleep(40);
  const d = (await osc(A)) - b0;
  check(`SFX ${name}: ${n} oscillator${n > 1 ? 's' : ''}`, d === n, 'delta=' + d);
}

// ---- real game flow ----
await A.fill('#name', 'Pras'); await A.click('#btnCreate'); await A.waitForSelector('#scr-lobby.active');
const code = (await A.textContent('#lobbyCode')).trim();
await B.goto(URL + '?room=' + code); await sleep(300);
await B.click('#name'); await sleep(200); await B.click('#btnMusic'); await sleep(1800); // B music off, fade-out done
check('B (iPhone) music off after toggle', !(await au(B)).music);
await B.fill('#name', 'Budi');
const aJ = await osc(A);
await B.click('#btnJoin'); await B.waitForSelector('#scr-lobby.active');
await A.waitForFunction(() => __tinju.state.players.length === 2); await sleep(150);
check('host hears the join chime (2 tones) when the opponent joins', (await osc(A)) - aJ === 2, 'delta=' + ((await osc(A)) - aJ));
const [aS, bS] = [await osc(A), await osc(B)];
await A.click('#btnStart');
await waitReady(A, 1); await waitReady(B, 1); await sleep(150);
check('round bell on word reveal: 2 oscillators on each screen', (await osc(A)) - aS === 2 && (await osc(B)) - bS === 2, `A=${(await osc(A)) - aS} B=${(await osc(B)) - bS}`);

async function playRound(round, mode) {
  await waitReady(A, round); await waitReady(B, round);
  const w = await A.evaluate(() => __tinju.word);
  const [a, b] = [await osc(A), await osc(B)];
  const n = w.text.length, wrong = w.text[0] === 'q' ? 'x' : 'q';
  const typeA = async (typo) => { await sleep(250); if (typo) { await A.keyboard.type(wrong); await A.keyboard.press('Backspace'); } await A.keyboard.type(w.text, { delay: 25 }); };
  if (mode === 'uppercut') await typeA(false);
  else if (mode === 'punch') await typeA(true);
  else if (mode === 'block') await Promise.all([typeA(true), (async () => { await sleep(500); await B.keyboard.type(w.text, { delay: 25 }); })()]);
  await waitResult(A, round); await waitResult(B, round); await sleep(300);
  return { w, n, dA: (await osc(A)) - a, dB: (await osc(B)) - b, res: await A.evaluate(() => __tinju.lastResult) };
}
let r = await playRound(1, 'uppercut');
check('critical hit: uppercut = 3 oscillators on both screens (+1 tap per letter on the typist)', r.res.critical && r.dB === 3 && r.dA === r.n + 3, `crit=${r.res.critical} A=${r.dA} B=${r.dB} n=${r.n}`);
r = await playRound(2, 'punch');
check('plain hit: punch = 2 oscillators (typist also hears 1 error tone + 1 tap per letter)', !r.res.critical && r.res.tier !== 'block' && r.dB === 2 && r.dA === r.n + 1 + 2, `tier=${r.res.tier} A=${r.dA} B=${r.dB} n=${r.n}`);
r = await playRound(3, 'block');
check('blocked hit: block = 1 oscillator on both screens (B also taps each letter)', r.res.tier === 'block' && !r.res.critical && r.dA === r.n + 1 + 1 && r.dB === r.n + 1, `tier=${r.res.tier} crit=${r.res.critical} A=${r.dA} B=${r.dB} n=${r.n}`);
// sfx off on B: silence on that screen
await B.click('#btnSfx'); await sleep(100);
check('sfx off: pref saved in tk_snd and button shows off', (await B.evaluate(() => JSON.parse(localStorage.getItem('tk_snd')).sfx)) === false && await B.$eval('#btnSfx', b => b.classList.contains('off')));
r = await playRound(4, 'uppercut');
check('sfx off: B hears nothing for a full round (0 oscillators) while A still hears it', r.dB === 0 && r.dA === r.n + 3, `A=${r.dA} B=${r.dB} n=${r.n}`);
await B.click('#btnSfx'); await sleep(300);

// ---- play to KO, count the end fanfare ----
let lastRound = 4, ended = false;
for (let k = 5; k < 40 && !ended; k++) {
  const st = await waitReady(A, k);
  if (st === 'ended') { ended = true; break; }
  await waitReady(B, k);
  const w = await A.evaluate(() => __tinju.word);
  await sleep(250); await A.keyboard.type(w.text, { delay: 25 });
  await waitResult(A, k); lastRound = k;
  const hp = await A.evaluate(() => Math.min(...__tinju.state.players.map(p => p.hp)));
  if (hp <= 0) break;
  await sleep(100);
}
await sleep(300);
const [aK, bK] = [await osc(A), await osc(B)];
await A.waitForFunction(() => __tinju.state.state === 'ended', null, { timeout: 8000 });
await sleep(1800);
const [dAk, dBk] = [(await osc(A)) - aK, (await osc(B)) - bK];
check(`KO: winner hears KO bell (3) + victory jingle (5) = 8; loser KO bell (3) + defeat tones (3) = 6 (after round ${lastRound})`, dAk === 8 && dBk === 6, `A=${dAk} B=${dBk}`);
check('KO: winner screen ends in the win:ko pose', (await A.getAttribute('#arena', 'data-anim')) === 'win:ko');

// ---- refresh mid-match -> pulse hint until tap ----
const C = await mk({ viewport: { width: 1000, height: 800 } }, 'C');
const D = await mk({ viewport: { width: 1000, height: 800 } }, 'D');
await C.goto(URL); await C.fill('#name', 'Cici'); await C.click('#btnCreate'); await C.waitForSelector('#scr-lobby.active');
const code2 = (await C.textContent('#lobbyCode')).trim();
await D.goto(URL + '?room=' + code2); await D.fill('#name', 'Dedi'); await D.click('#btnJoin'); await D.waitForSelector('#scr-lobby.active');
await C.waitForFunction(() => __tinju.state.players.length === 2);
check('before refresh: music running after the creating gesture', (await au(C)).music);
await C.click('#btnStart'); await waitReady(C, 1);
await C.reload();
await C.waitForFunction(() => __tinju.state && __tinju.state.state !== 'lobby');
await sleep(300);
const c1 = await au(C);
check('refresh mid-match: no AudioContext until a tap (autoplay policy respected), music pref still on', !c1.ctx && !c1.started && c1.musicOn && (await osc(C)) === 0 && (await C.evaluate(() => window.__ctxs)) === 0, JSON.stringify(c1));
check('refresh mid-match: music button pulses (class wait, animation waitPulse)', await C.$eval('#btnMusic', b => b.classList.contains('wait') && getComputedStyle(b).animationName === 'waitPulse'));
check('refresh mid-match: toast hints "Ketuk layar untuk menyalakan musik"', /Ketuk layar/.test(await C.textContent('#toast')));
await C.mouse.click(5, 5); await sleep(400);
const c2 = await au(C);
check('first tap after refresh: AudioContext running, music back, pulse gone', c2.ctx && c2.state === 'running' && c2.music && c2.started && !(await C.$eval('#btnMusic', b => b.classList.contains('wait'))), JSON.stringify(c2));
check('first tap after refresh: music oscillators created (>= 9)', (await osc(C)) >= 9, String(await osc(C)));

check('0 page errors and 0 console errors', errors.length === 0, errors.slice(0, 3).join(' || '));
await browser.close();
srv.stop();
await sleep(100);
const failed = summary();
process.exit(failed ? 1 : 0);
