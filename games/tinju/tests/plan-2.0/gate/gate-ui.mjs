// A-na gate 2.0.0 — Playwright UI + audio checks against a real server.js from a tree copy.
// Usage: node gate-ui.mjs <path-to-games/tinju> <basePort> <tag>    (ports base..base+4, all >= 3300)
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const T = process.argv[2], BASE = +process.argv[3], TAG = process.argv[4] || 'x';
if (!(BASE >= 3300)) throw new Error('ports must be >= 3300');
const LOGS = '/tmp/ana-g2/logs', SHOTS = `/tmp/ana-g2/shots-${TAG}`, TMP = `/tmp/ana-g2/tmp-ui-${TAG}`; fs.mkdirSync(SHOTS, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });
const pw = createRequire('/home/prastuvwxyz/.nalar/workspaces/stella/bullscows/node_modules/x.js')('playwright');
const EXE = '/home/prastuvwxyz/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const only = (process.env.ONLY || '').split(',').filter(Boolean); const want = k => !only.length || only.includes(k);
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  | ' + x : '')); };
const servers = [];
function server(port, env, name) {
  const lf = `${LOGS}/gate-srv-${TAG}-ui-${name}.log`;
  const child = spawn(process.execPath, [path.join(T, 'server', 'server.js')], { env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let buf = ''; child.stdout.on('data', d => { buf += d; fs.appendFileSync(lf, d); }); child.stderr.on('data', d => fs.appendFileSync(lf, d)); servers.push(child);
  const ready = new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no listen')), 8000); child.stdout.on('data', () => { if (buf.includes('listening')) { clearTimeout(t); res(); } }); child.on('exit', c => rej(new Error('exit ' + c))); });
  return { ready, stop: () => { try { child.kill('SIGTERM'); } catch {} }, url: `http://127.0.0.1:${port}/tinju/` };
}
process.on('exit', () => servers.forEach(s => { try { s.kill('SIGKILL'); } catch {} }));
const browser = await pw.chromium.launch({ executablePath: EXE });
const DEV = {
  'desktop': { viewport: { width: 1280, height: 800 } },
  '320x480': { viewport: { width: 320, height: 480 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  '320x568': { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  'iPhone 12': pw.devices['iPhone 12'],
};
const errors = [], external = [];
async function page(dev, label) {
  const ctx = await browser.newContext(DEV[dev]); const p = await ctx.newPage(); p._label = `${label}@${dev}`; p._dev = dev;
  p.on('console', m => { if (m.type() === 'error') errors.push(`${p._label}: console: ${m.text()}`); });
  p.on('pageerror', e => errors.push(`${p._label}: pageerror: ${e.message}`));
  p.on('request', r => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !u.protocol.startsWith('data') && !u.protocol.startsWith('blob')) external.push(r.url()); });
  p._ws = []; p.on('websocket', ws => ws.on('framereceived', f => p._ws.push(String(f.payload))));
  return p;
}
const H = p => p.evaluate(() => { const t = window.__tinju; return { st: t.state && t.state.state, round: t.state && t.state.round, code: t.state && t.state.code, line: t.line, n: t.state && t.state.players.length }; });
async function waitFor(p, fn, arg, ms = 15000) { await p.waitForFunction(fn, arg, { timeout: ms, polling: 30 }); }
async function makeRoom(url, specs) { // specs: [[dev,label]...]; first = host
  const ps = []; for (const [d, l] of specs) ps.push(await page(d, l));
  await ps[0].goto(url); await ps[0].fill('#name', ps[0]._label.split('@')[0]); await ps[0].click('#btnCreate');
  await waitFor(ps[0], () => window.__tinju.state && window.__tinju.state.code);
  const code = (await H(ps[0])).code;
  for (const p of ps.slice(1)) { await p.goto(url + '?room=' + code); await p.fill('#name', p._label.split('@')[0]); await p.click('#btnJoin'); await waitFor(p, () => window.__tinju.state && window.__tinju.state.code); }
  await waitFor(ps[0], n => window.__tinju.state.players.length === n, ps.length);
  return { ps, code };
}
const overflow = p => p.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, iw: window.innerWidth }));
const lineRect = p => p.evaluate(() => { const b = document.getElementById('linebox').getBoundingClientRect(), l = document.getElementById('line').getBoundingClientRect();
  return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), lt: Math.round(l.top), lb: Math.round(l.bottom), vh: window.innerHeight, vw: window.innerWidth, sy: Math.round(scrollY), len: window.__tinju.line && window.__tinju.line.text.length, rows: Math.round(l.height / parseFloat(getComputedStyle(document.getElementById('line')).lineHeight || 24)) }; });
async function sendDone(p, elapsed, typos = 0) { await p.evaluate(([e, t]) => { const L = window.__tinju.line; window.__tinju.send({ t: 'done', round: L.round, elapsed: e, typos: t }); }, [elapsed, typos]); }
async function waitLine(ps, r) { await Promise.all(ps.map(p => waitFor(p, r => window.__tinju.state && window.__tinju.state.state === 'line' && window.__tinju.line && window.__tinju.line.round === r, r, 30000))); }
async function waitCountdown(ps, r) { await Promise.all(ps.map(p => waitFor(p, r => window.__tinju.state && window.__tinju.state.state === 'countdown' && window.__tinju.state.round === r, r, 30000))); }

// worst-case fixture bank: every normal line exactly 29 chars, every ULTI line exactly 45 chars, realistic words
function fixture() {
  const songs = []; for (let k = 0; k < 40; k++) { const lines = [];
    for (let i = 0; i < 4; i++) { const s = `kita nyanyi lagu ${k} bait ${i} `; lines.push((s + 'bersama kawan semua').slice(0, 29).trimEnd().padEnd(29, 'a')); }
    const L = `Marilah kita bernyanyi, lagu ${k} ini bersama`; lines.push((L + ' kawan-kawanku!!!!!!!!!!').slice(0, 44) + '!'); songs.push(`Gerbang ${k} | A-na QA\n${lines.join('\n')}`); }
  const f = path.join(TMP, 'worst.txt'); fs.writeFileSync(f, songs.join('\n\n') + '\n'); return f;
}

// ===== U-01 (B1) worst case: host + 2 guests at 320x480, every line 29 or 45 chars =====
if (want('b1')) { const s = server(BASE, { TK_COUNTDOWN_MS: '700', TK_RESULT_MS: '300', TK_HP: '100000', TK_LYRICS: fixture() }, 'b1fix'); await s.ready;
  const { ps } = await makeRoom(s.url, [['320x480', 'Host'], ['320x480', 'Guest1'], ['320x480', 'Guest2']]);
  await ps[0].click('#btnStart'); let bad = [], seen45 = 0, n = 0;
  for (let r = 1; r <= 12; r++) {
    await waitCountdown(ps, r); await ps[1].evaluate(() => scrollTo(0, 1e5)); await ps[2].evaluate(() => scrollTo(0, 0));
    await waitLine(ps, r); await sleep(350);
    for (const p of ps) { const R = await lineRect(p); n++; if (R.len === 45) seen45++;
      const ok = R.top >= 0 && R.bottom <= R.vh && R.lt >= 0 && R.lb <= R.vh && R.left >= 0 && R.right <= R.vw; if (!ok) bad.push(`r${r} ${p._label} ${JSON.stringify(R)}`);
      if (r === 5 || (R.len === 45 && !fs.existsSync(`${SHOTS}/b1-${p._label.split('@')[0]}-45.png`))) await p.screenshot({ path: `${SHOTS}/b1-${p._label.split('@')[0]}-${R.len}.png` }); }
    await sendDone(ps[0], 3000); await sendDone(ps[1], 3500); await sendDone(ps[2], 4000);
  }
  check('U-01 (B1, worst-case bank 29/45 chars): whole line box and line inside the 320x480 viewport for HOST and both GUESTS, every round (guest1 scrolled to bottom, guest2 to top before each reveal)', bad.length === 0 && seen45 >= 3, `${n - bad.length}/${n} page-rounds ok, 45-char reveals seen ${seen45} ${bad.slice(0, 3).join(' ; ')}`);
  for (const p of ps) await p.context().close(); s.stop(); }

// ===== U-01 / U-02 real bank, 10 players at 320x480 (+ lobby / ring / result overflow) =====
if (want('ten')) { const s = server(BASE + 1, { TK_COUNTDOWN_MS: '700', TK_RESULT_MS: '300', TK_HP: '100000' }, 'ten'); await s.ready;
  const specs = [['320x480', 'H'], ...Array.from({ length: 9 }, (_, i) => ['320x480', 'G' + (i + 1)])];
  const { ps } = await makeRoom(s.url, specs);
  const ov = []; for (const p of ps) { const o = await overflow(p); if (o.sw > o.iw) ov.push(`lobby ${p._label} ${JSON.stringify(o)}`); }
  await ps[0].screenshot({ path: `${SHOTS}/ten-lobby-320x480.png`, fullPage: true });
  await ps[0].click('#btnStart'); const bad = []; let maxLen = 0, n = 0;
  for (let r = 1; r <= 12; r++) {
    await waitCountdown(ps, r); await Promise.all(ps.map((p, i) => p.evaluate(y => scrollTo(0, y), i % 2 ? 1e5 : 0)));
    await waitLine(ps, r); await sleep(350);
    for (const p of ps) { const R = await lineRect(p); n++; maxLen = Math.max(maxLen, R.len); if (!(R.top >= 0 && R.bottom <= R.vh && R.lt >= 0 && R.lb <= R.vh)) bad.push(`r${r} ${p._label} ${JSON.stringify(R)}`);
      const o = await overflow(p); if (o.sw > o.iw) ov.push(`ring r${r} ${p._label} ${JSON.stringify(o)}`); }
    if (r === 4) await ps[3].screenshot({ path: `${SHOTS}/ten-ring-guest3-320x480.png` });
    await Promise.all(ps.map((p, i) => sendDone(p, 2000 + 211 * i, i % 3)));
    await Promise.all(ps.map(p => waitFor(p, r => window.__tinju.state.state === 'result' && window.__tinju.lastResult && window.__tinju.lastResult.round === r, r)));
    await sleep(120); for (const p of ps.slice(0, 3)) { const o = await overflow(p); if (o.sw > o.iw) ov.push(`result r${r} ${p._label} ${JSON.stringify(o)}`); }
    if (r === 2) await ps[5].screenshot({ path: `${SHOTS}/ten-domino-guest5-320x480.png` });
  }
  check('U-01 (B1, real bank, 10 players all at 320x480, odd guests scrolled to bottom): line inside the viewport on all 10, 12 rounds', bad.length === 0, `${n - bad.length}/${n}, longest line seen ${maxLen} ${bad.slice(0, 2).join(' ; ')}`);
  check('U-02: 10-player room at 320x480: no horizontal overflow on lobby, ring and result screens', ov.length === 0, ov.slice(0, 3).join(' ; '));
  await sleep(1500);
  const av = await ps[0].evaluate(() => { const a = document.getElementById('avatars'); const anims = [a, ...a.querySelectorAll('*')].flatMap(e => e.getAnimations().filter(x => x.playState === 'running').map(x => ({ el: e.tagName + '.' + e.className, name: x.animationName || x.transitionProperty, it: x.effect.getTiming().iterations })));
    return { kids: a.children.length, imgs: a.querySelectorAll('img').length, running: anims }; });
  check('U-14: avatar row = 9 static <img>; no looping (infinite) animation and no animation on the images (one-shot damage float-ups / colour transitions allowed)', av.kids === 9 && !av.running.some(x => x.it === Infinity || x.el.startsWith('IMG')), JSON.stringify(av));
  for (const p of ps) await p.context().close(); s.stop(); }

// ===== U-03 / U-04 / U-05 / U-06 / U-07 / U-08: iPhone 12 host typing for real, 2 desktop guests =====
if (want('type')) { const s = server(BASE + 2, { TK_COUNTDOWN_MS: '700', TK_RESULT_MS: '300', TK_HP: '100000' }, 'type'); await s.ready;
  const { ps } = await makeRoom(s.url, [['iPhone 12', 'Phone'], ['desktop', 'D1'], ['desktop', 'D2']]); const [ph, d1, d2] = ps;
  const attrs = await ph.evaluate(() => { const i = document.getElementById('typer'), cs = getComputedStyle(i); return { ac: i.getAttribute('autocapitalize'), acor: i.getAttribute('autocorrect'), sp: i.getAttribute('spellcheck'), im: i.getAttribute('inputmode'), fs: cs.fontSize, disp: cs.display }; });
  check('U-03: hidden input autocapitalize=off autocorrect=off spellcheck=false inputmode=text, 16px, not display:none (iPhone 12)', attrs.ac === 'off' && attrs.acor === 'off' && attrs.sp === 'false' && attrs.im === 'text' && attrs.fs === '16px' && attrs.disp !== 'none', JSON.stringify(attrs));
  await ph.click('#btnStart'); let focusOk = 0, typedOk = 0, orderOk = 0, boxOk = 0; const notes = [];
  for (let r = 1; r <= 10; r++) {
    await waitLine(ps, r); await sleep(120);
    if (r === 1 && await ph.evaluate(() => document.activeElement.id !== 'typer')) await ph.tap('#linebox'); // focus once (only if the reveal did not focus it)
    const foc = await ph.evaluate(() => document.activeElement && document.activeElement.id); if (foc === 'typer') focusOk++; else notes.push(`r${r} focus=${foc}`);
    const text = await ph.evaluate(() => window.__tinju.line.text);
    if (r === 1) { // U-04 strict typos
      const wrong = text[0] === '#' ? '%' : '#';
      await ph.keyboard.type(wrong); await ph.keyboard.type(text.slice(0, 2));
      const t1 = await ph.evaluate(() => window.__tinju.typing);
      const redTile = await ph.evaluate(() => !!document.querySelector('#line .bad, #line [class*="bad"]'));
      check('U-04: a wrong char goes red and blocks: typed stays empty, bad = the wrong char, typos 1, red tile drawn', t1.typed === '' && t1.bad === wrong && t1.typos === 1 && redTile, JSON.stringify({ ...t1, redTile }));
      await ph.keyboard.press('Backspace'); const t2 = await ph.evaluate(() => window.__tinju.typing);
      check('U-04: backspace removes the red char, typos stays 1', t2.bad === '' && t2.typos === 1, JSON.stringify(t2));
      await ph.keyboard.type(text); await sleep(80); await ph.keyboard.type(' '); await sleep(150);
      const t3 = await ph.evaluate(() => window.__tinju.typing);
      check('U-05: line done and sent; a trailing space after the last char adds no typo and no error', t3.done && t3.sentDone && t3.typos === 1, JSON.stringify(t3));
    } else if (r === 2) { // U-05b predictive replacement of the first word + space
      const w = text.split(' ')[0] + ' ';
      await ph.evaluate(v => { const i = document.getElementById('typer'); i.value = v; i.dispatchEvent(new InputEvent('input', { inputType: 'insertReplacementText', data: v, bubbles: true })); }, w);
      const t = await ph.evaluate(() => window.__tinju.typing); check('U-05: a predictive "word " replacement mid-line is read as correct chars, no false typo', t.typed === w && t.typos === 0 && t.bad === '', JSON.stringify(t));
      await ph.keyboard.type(text.slice(w.length));
    } else await ph.keyboard.type(text);
    await sleep(100); const tt = await ph.evaluate(() => window.__tinju.typing); if (tt.done && tt.sentDone) typedOk++; else notes.push(`r${r} typing ${JSON.stringify(tt)}`);
    const myEl = await ph.evaluate(() => window.__tinju.lastResult); // not yet
    await sendDone(d1, 15000 + r, 1); await sendDone(d2, 16000 + r, 2);
    await Promise.all(ps.map(p => waitFor(p, r => window.__tinju.lastResult && window.__tinju.lastResult.round === r, r)));
    await sleep(Math.max(300, 0)); // let the domino play
    await sleep(400);
    const vis = await d1.evaluate(() => ({ res: window.__tinju.lastResult, av: window.__tinju.avatarOrder, me: window.__tinju.state.you.id, L: document.getElementById('imgL').dataset, R: document.getElementById('imgR').dataset, slots: JSON.parse(JSON.stringify(window.__tinju.slots || {})) }));
    const ordIds = vis.res.order.map(o => o.id); if (JSON.stringify(vis.av.filter(x => x)) === JSON.stringify(ordIds.filter(x => x !== vis.me))) orderOk++; else notes.push(`r${r} avatars ${vis.av} vs order ${ordIds}`);
    const inc = vis.res.chain.find(c => c.to === vis.me), out = vis.res.chain.find(c => c.from === vis.me);
    const sl = vis.slots; if (inc && out && JSON.stringify(sl).includes(inc.from) && JSON.stringify(sl).includes(out.to)) boxOk++; else notes.push(`r${r} slots ${JSON.stringify(sl).slice(0, 120)}`);
  }
  check('U-06: iPhone 12, one tap in round 1, then 10 rounds: the hidden input has focus at every line reveal', focusOk === 10, `${focusOk}/10 ${notes.filter(x => x.includes('focus')).join(' ')}`);
  check('U-04/U-06: the line typed for real on the iPhone 12 page completes and sends done in 10/10 rounds', typedOk === 10, `${typedOk}/10 ${notes.filter(x => x.includes('typing')).slice(0, 2).join(' ')}`);
  check('U-07: avatar row order after the domino = server finishing order (middle player view), 10 rounds', orderOk === 10, `${orderOk}/10 ${notes.filter(x => x.includes('avatars')).slice(0, 2).join(' ')}`);
  check('U-08: big boxers = who hit you (left) / who you hit (right), middle player, 10 rounds', boxOk === 10, `${boxOk}/10 ${notes.filter(x => x.includes('slots')).slice(0, 1).join(' ')}`);
  await ph.screenshot({ path: `${SHOTS}/type-iphone12.png` });
  for (const p of ps) await p.context().close(); s.stop(); }

// ===== U-10 spectator UI + U-02 end screens + U-11 =====
if (want('spec')) { const s = server(BASE + 3, { TK_COUNTDOWN_MS: '700', TK_RESULT_MS: '300', TK_HP: '1' }, 'spec'); await s.ready;
  const { ps } = await makeRoom(s.url, [['320x480', 'P0'], ['320x568', 'P1'], ['desktop', 'P2'], ['iPhone 12', 'P3']]);
  await ps[0].click('#btnStart'); await waitLine(ps, 1);
  await sendDone(ps[0], 2000); await sendDone(ps[1], 2000); await sendDone(ps[2], 2000); await sendDone(ps[3], 4000);
  await waitLine(ps, 2); await sleep(400); const sp = ps[3];
  const u = await sp.evaluate(() => ({ bar: !document.getElementById('specbar').hidden && document.getElementById('specbar').getBoundingClientRect().height > 0, n: document.querySelectorAll('#emojis [data-e]').length, entrant: window.__tinju.line.entrant, out: window.__tinju.state.players.find(x => x.id === window.__tinju.state.you.id).out }));
  await sp.keyboard.type('abc'); const ty = await sp.evaluate(() => ({ typing: window.__tinju.typing, foc: document.activeElement && document.activeElement.id }));
  await sp.tap('#emojis [data-e="4"]'); await sleep(300);
  const got = ps[0]._ws.some(f => /"t":"emoji"/.test(f) && /"e":4/.test(f));
  check('U-10: KO\'d player (iPhone 12): emoji bar visible with 8 emoji, line marked spectator', u.bar && u.n === 8 && u.entrant === false && u.out === 'ko', JSON.stringify(u));
  check('U-10: spectator typing does nothing and the input is not focused', ty.typing.typed === '' && ty.foc !== 'typer', JSON.stringify(ty));
  check('U-10: tapping an emoji reaches another player\'s socket', got);
  await sp.screenshot({ path: `${SHOTS}/spec-iphone12.png` });
  await sendDone(ps[0], 1000); await sendDone(ps[1], 1500); await sendDone(ps[2], 3000);
  await Promise.all(ps.map(p => waitFor(p, () => window.__tinju.state.state === 'ended')));
  await sleep(600); const ov = []; for (const p of ps) { const o = await overflow(p); if (o.sw > o.iw) ov.push(`${p._label} ${JSON.stringify(o)}`); }
  const endVis = await ps[0].evaluate(() => { const r = document.getElementById('endCard').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight, hidden: document.getElementById('endCard').hidden }; });
  check('U-02: end screen at 320x480, 320x568, desktop, iPhone 12: no horizontal overflow; end card shown', ov.length === 0 && !endVis.hidden, ov.join(' ; ') + JSON.stringify(endVis));
  for (const p of ps) await p.screenshot({ path: `${SHOTS}/end-${p._label.replace(/[^\w]/g, '_')}.png` });
  for (const p of ps) await p.context().close(); s.stop(); }

// ===== A-01 / A-02: audio (iPhone 12) =====
if (want('audio')) { const s = server(BASE + 4, { TK_COUNTDOWN_MS: '700' }, 'audio'); await s.ready;
  const p = await page('iPhone 12', 'Aud');
  await p.context().addInitScript(() => { window.__ac = { made: 0, src: [] }; const C = window.AudioContext; if (!C) return;
    window.AudioContext = class extends C { constructor(...a) { super(...a); window.__ac.made++; } };
    const oo = C.prototype.createOscillator, ob = C.prototype.createBufferSource;
    C.prototype.createOscillator = function () { const o = oo.call(this); const st = o.start.bind(o); o.start = (...a) => { window.__ac.src.push('osc:' + o.type); return st(...a); }; return o; };
    C.prototype.createBufferSource = function () { const o = ob.call(this); const st = o.start.bind(o); o.start = (...a) => { window.__ac.src.push('buf'); return st(...a); }; return o; }; });
  await p.goto(s.url); await sleep(800);
  const a0 = await p.evaluate(() => ({ made: window.__ac.made, ctx: !!window.__tinju.audio.ctx }));
  check('A-01: iPhone 12 fresh load: no AudioContext before the first gesture', a0.made === 0 && !a0.ctx, JSON.stringify(a0));
  await p.tap('#name'); await sleep(400);
  const a1 = await p.evaluate(() => ({ made: window.__ac.made, state: window.__tinju.audio.ctx && window.__tinju.audio.ctx.state, started: window.__tinju.audio.started, src: window.__ac.src.length }));
  check('A-01: first tap creates and runs the AudioContext; lobby pad starts (sources started)', a1.made >= 1 && a1.state === 'running' && a1.src > 0, JSON.stringify(a1));
  const sig = {}; for (const k of ['jab', 'block', 'uppercut', 'ko']) { await p.evaluate(() => { window.__ac.src = []; }); await p.evaluate(k => window.__tinju.sfx[k](), k); await sleep(50); sig[k] = await p.evaluate(() => window.__ac.src.slice()); }
  const sigs = Object.values(sig).map(x => x.join(',')); check('A-02: jab/block/uppercut/KO each start >= 3 sources (click + thump + tail) and the four graphs differ', Object.values(sig).every(x => x.length >= 3) && new Set(sigs).size === 4, JSON.stringify(sig));
  await p.reload(); await sleep(800); const a2 = await p.evaluate(() => ({ made: window.__ac.made, ctx: !!window.__tinju.audio.ctx }));
  check('A-01: after a refresh there is again no AudioContext until a tap', a2.made === 0 && !a2.ctx, JSON.stringify(a2));
  await p.context().close(); s.stop(); }

check('U-13: 0 page errors and 0 console errors across every page in this run', errors.length === 0, `errors=${errors.length} ${errors.slice(0, 3).join(' ; ')}`);
check('no request left 127.0.0.1 in any page of this run (external URLs)', external.length === 0, external.slice(0, 3).join(' '));
await browser.close(); servers.forEach(s => { try { s.kill('SIGTERM'); } catch {} });
console.log(`\n== gate-ui ${TAG}: PASS ${pass} / FAIL ${fail} ==`); process.exit(0);
