// Audio + theme test. Usage: PLAYWRIGHT_BROWSERS_PATH=... NODE_PATH=./node_modules node test-audio.mjs http://127.0.0.1:3101/bullscows/
import { chromium, devices } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:3101/bullscows/';
let pass = 0, failN = 0; const check = (n, ok, x='') => { ok ? pass++ : failN++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  ' + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const errors = [];
const init = () => { window.__osc = 0; window.__buf = 0; const P = AudioContext.prototype; const co = P.createOscillator, cb = P.createBufferSource; P.createOscillator = function () { window.__osc++; return co.apply(this, arguments); }; P.createBufferSource = function () { window.__buf++; return cb.apply(this, arguments); }; };
const ctxA = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const ctxB = await browser.newContext({ ...devices['iPhone 12'] });
await ctxA.addInitScript(init); await ctxB.addInitScript(init);
const A = await ctxA.newPage(), B = await ctxB.newPage();
for (const [n, p] of [['A', A], ['B', B]]) { p.on('pageerror', e => errors.push(n + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(n + ' console: ' + m.text()); }); }
const osc = p => p.evaluate(() => window.__osc);
const au = p => p.evaluate(() => ({ ctx: !!window.__bc.audio.ctx, state: window.__bc.audio.ctx && window.__bc.audio.ctx.state, music: !!window.__bc.audio.nodes, started: window.__bc.audio.started, sfx: window.__bc.audio.sfx, musicOn: window.__bc.audio.music }));
const st = p => p.evaluate(() => window.__bc.state);
const meId = p => p.evaluate(() => window.__bc.me);
const typeNum = async (p, padId, num) => { for (const d of num) await p.click(`#${padId} [data-k="${d}"]`); await p.click(`#${padId} [data-k="ok"]`); };
const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };
const contrast = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + .05) / (l2 + .05); };

// ---- theme + music boot ----
await A.goto(URL); await sleep(300);
check('light theme is default', await A.evaluate(() => document.documentElement.dataset.theme === 'light'));
check('body background is light', lum(await A.evaluate(() => getComputedStyle(document.body).backgroundColor)) > .7);
check('no AudioContext before first gesture', !(await au(A)).ctx);
await A.click('#name'); await A.keyboard.type('Pras'); await sleep(250);
const a1 = await au(A);
check('first gesture creates AudioContext, state running', a1.ctx && a1.state === 'running', JSON.stringify(a1));
check('music started by default: pad nodes + >=9 oscillators (8 chord voices + LFO)', a1.music && (await osc(A)) >= 9, 'osc=' + await osc(A));
check('rain bed buffer source created once', (await A.evaluate(() => window.__buf)) === 1);
await A.click('#btnMusic'); await sleep(100);
const a2 = await au(A);
check('music toggle off: nodes released + pref saved', !a2.music && !a2.musicOn && (await A.evaluate(() => JSON.parse(localStorage.getItem('bc_snd')).music)) === false);
check('music button shows off state', await A.$eval('#btnMusic', b => b.classList.contains('off')));
await A.click('#btnMusic'); await sleep(100);
check('music toggle on again: nodes back', (await au(A)).music);
await A.click('#btnMusic'); await sleep(100); // leave OFF so oscillator counts below are SFX only

// ---- theme toggle + persistence ----
await A.click('#btnTheme'); await sleep(450);
check('theme toggle → dark, meta theme-color updated', await A.evaluate(() => document.documentElement.dataset.theme === 'dark' && document.getElementById('themeColor').content === '#1a1f1c'));
check('dark body background is dark', lum(await A.evaluate(() => getComputedStyle(document.body).backgroundColor)) < .05);
await A.reload(); await sleep(300);
check('dark theme persists after reload', await A.evaluate(() => document.documentElement.dataset.theme === 'dark'));
check('music pref persists after reload (off)', await A.evaluate(() => window.__bc.audio.music === false));
await A.click('#btnTheme'); await sleep(100);
check('back to light', await A.evaluate(() => document.documentElement.dataset.theme === 'light'));
await A.click('#name'); await A.keyboard.type('Pras'); await sleep(100);

// ---- game flow with SFX counts ----
await A.click('#btnCreate'); await A.waitForSelector('#scr-lobby.active');
const code = (await A.textContent('#lobbyCode')).trim();
await B.goto(URL + '?room=' + code); await sleep(300);
await B.click('#name'); await B.keyboard.type('Budi'); await sleep(150);
await B.click('#btnMusic'); await sleep(100); // B music off too
const bOsc0 = await osc(B);
const aOsc0 = await osc(A);
await B.click('#btnJoin'); await B.waitForSelector('#scr-lobby.active');
await A.waitForFunction(() => window.__bc.state.players.length === 2); await sleep(150);
check('host hears join chime (2 tones) when Budi joins', (await osc(A)) - aOsc0 === 2, 'delta=' + ((await osc(A)) - aOsc0));
let b0 = await osc(B);
await B.click('#secretPad [data-k="0"]'); await sleep(50);
check('keypad tap = 1 tone', (await osc(B)) - b0 === 1, 'delta=' + ((await osc(B)) - b0));
b0 = await osc(B); await B.click('#secretPad [data-k="del"]'); await sleep(50);
check('delete = 1 tone', (await osc(B)) - b0 === 1);
await B.click('#btnSfx'); await sleep(50);
check('sfx off: pref saved + button off', (await B.evaluate(() => JSON.parse(localStorage.getItem('bc_snd')).sfx)) === false && await B.$eval('#btnSfx', b => b.classList.contains('off')));
b0 = await osc(B); await B.click('#secretPad [data-k="0"]'); await sleep(50);
check('sfx off: tap makes no tone', (await osc(B)) - b0 === 0);
await B.click('#btnSfx'); await sleep(100); // on again (plays a 2-tone confirmation)
await B.click('#secretPad [data-k="del"]'); await sleep(50);
await typeNum(B, 'secretPad', '0123'); await B.waitForFunction(() => window.__bc.state.you.secret === '0123');
await typeNum(A, 'secretPad', '3657'); await A.waitForFunction(() => window.__bc.state.you.secret === '3657');
await A.waitForFunction(() => !document.getElementById('btnStart').disabled);
const aT = await osc(A), bT = await osc(B);
await A.click('#btnStart'); await A.waitForSelector('#scr-game.active'); await B.waitForSelector('#scr-game.active'); await sleep(300);
const turn = (await st(A)).turn; const cur = turn === (await meId(A)) ? A : B, oth = cur === A ? B : A;
const curT0 = cur === A ? aT : bT, othT0 = cur === A ? bT : aT;
check('player on turn hears turn bell (2 tones); other hears nothing', (await osc(cur)) - curT0 === 2 && (await osc(oth)) - othT0 === 0, 'cur=' + ((await osc(cur)) - curT0) + ' oth=' + ((await osc(oth)) - othT0));
const c0 = await osc(cur), o0 = await osc(oth);
await typeNum(cur, 'guessPad', '1234'); await oth.waitForFunction(() => window.__bc.state.history.some(e => e.type === 'guess')); await sleep(400);
// cur: 4 taps + 1 submit(2 tones) + 4 reveal = 10 ; oth: 4 reveal + turn bell 2 = 6
check('guesser: 4 taps + submit(2) + 4 reveal tones = 10', (await osc(cur)) - c0 === 10, 'delta=' + ((await osc(cur)) - c0));
check('target: 4 reveal tones + turn bell(2) = 6', (await osc(oth)) - o0 === 6, 'delta=' + ((await osc(oth)) - o0));

// ---- contrast of coloured tiles (WCAG AA ≥ 4.5 normal text; tiles are 28px bold → large text ≥ 3.0) ----
const tileCs = await cur.$$eval('#board .gl .tile', ts => ts.map(t => [t.className, getComputedStyle(t).backgroundColor, getComputedStyle(t).color]));
const ratios = tileCs.map(([cls, bg, fg]) => [cls.match(/\b([gyx])\b/)[1], +contrast(bg, fg).toFixed(2)]);
check('tile text contrast ≥ 3.5 for every colour (large bold text)', ratios.every(([, r]) => r >= 3.5), JSON.stringify(ratios));
console.log('contrast ratios', JSON.stringify(ratios));
const allC = await cur.evaluate(() => ['g','y','x'].map(k => { const d = document.createElement('div'); d.className = 'tile ' + k; d.textContent = '5'; document.body.appendChild(d); const cs = getComputedStyle(d); const r = [k, cs.backgroundColor, cs.color]; d.remove(); return r; }));
const allR = allC.map(([k, bg, fg]) => [k, +contrast(bg, fg).toFixed(2)]);
check('explicit g/y/x tile contrast ≥ 3.5 (light)', allR.every(([, r]) => r >= 3.5), JSON.stringify(allR));
console.log('contrast g/y/x light', JSON.stringify(allR));
await cur.click('#btnTheme'); await sleep(450);
const darkC = await cur.evaluate(() => ['g','y','x'].map(k => { const d = document.createElement('div'); d.className = 'tile ' + k; document.body.appendChild(d); const cs = getComputedStyle(d); const r = [k, cs.backgroundColor, cs.color]; d.remove(); return r; }));
const darkR = darkC.map(([k, bg, fg]) => [k, +contrast(bg, fg).toFixed(2)]);
check('explicit g/y/x tile contrast ≥ 3.5 (dark)', darkR.every(([, r]) => r >= 3.5), JSON.stringify(darkR));
console.log('contrast g/y/x dark', JSON.stringify(darkR));
await cur.click('#btnTheme'); await sleep(450);
const txtC = await cur.evaluate(() => [getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]);
check('body text contrast ≥ 7 (AAA)', contrast(...txtC) >= 7, contrast(...txtC).toFixed(2));

// ---- screenshots light + dark (mobile = B) ----
await B.screenshot({ path: 'shot-v3-mobile-light.png', fullPage: false });
await A.screenshot({ path: 'shot-v3-desktop-light.png', fullPage: false });
await B.click('#btnTheme'); await sleep(200);
await B.screenshot({ path: 'shot-v3-mobile-dark.png', fullPage: false });
await B.click('#btnTheme'); await sleep(100);

// ---- end screen fanfare ----
const curSecretOth = (await st(oth)).you.secret;
// play until someone cracks: simplest — let the loser crack via the known secret on their turn
const crack = async () => { const s = await st(A); const p = s.turn === (await meId(A)) ? A : B; const o = p === A ? B : A; const sec = (await st(o)).you.secret; const p0 = await osc(p), o0b = await osc(o); await typeNum(p, 'guessPad', sec); await p.waitForFunction(() => window.__bc.state.state === 'ended'); await o.waitForFunction(() => window.__bc.state.state === 'ended'); await sleep(2300); return [p, o, p0, o0b]; };
const [wp, lp, wp0, lp0] = await crack();
// winner: 4 taps + submit 2 + reveal 4 + win-chord 4 (all green) + win fanfare 5 = 19 ; loser: reveal 4 + chord 4 + lose 3 = 11
check('winner hears win fanfare (19 tones total)', (await osc(wp)) - wp0 === 19, 'delta=' + ((await osc(wp)) - wp0));
check('loser hears lose cue (11 tones total)', (await osc(lp)) - lp0 === 11, 'delta=' + ((await osc(lp)) - lp0));
await A.screenshot({ path: 'shot-v3-end.png' });
check('320px: no horizontal overflow (light)', await (async () => { const C = await ctxB.newPage(); await C.setViewportSize({ width: 320, height: 640 }); await C.goto(URL); await sleep(200); const ok = await C.evaluate(() => document.documentElement.scrollWidth <= 320); await C.close(); return ok; })());
check('0 page errors / console errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${failN} failed`);
await browser.close();
process.exit(failN ? 1 : 0);
