// Tinju Kata UI test (Playwright). Usage: node test-ui.mjs [port=3201]
// Two browsers in one room play a full match to KO, for: desktop, iPhone 12, a 320 px phone, and a reduced-motion desktop.
// Spawns its own server (HP 350, fast timings) on <port>. Screenshots are written next to this file (shot-*.png).
import path from 'node:path';
import { EVIDENCE, sleep, makeChecker, startServer, launchBrowser, devices } from './test-lib.mjs';

const PORT = Number(process.argv[2] || 3201);
if ([3100, 3200].includes(PORT)) { console.error('refusing to use 3100/3200'); process.exit(2); }
const { check, summary } = makeChecker('test-ui');
const srv = startServer(PORT, { TK_COUNTDOWN_MS: 600, TK_RESULT_MS: 1000, TK_GRACE_MS: 700, TK_WORD_CAP_MS: 20000, TK_HP: 350 }, 'server-ui.log');
await srv.ready;
const URL = `http://127.0.0.1:${PORT}/tinju/`;
const browser = await launchBrowser();
const errors = [], external = [];

// records DOM effects that only live for ~1 s (shake class, bursts, countdown numbers) so assertions can run later
const INIT = () => {
  window.__seen = { shake: 0, kritikal: 0, kombo: 0, dmg: 0, cd: 0, ultiBurst: 0, seri: 0 };
  const mo = new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'attributes' && m.target.id === 'arena' && m.target.classList.contains('shake')) window.__seen.shake++;
      for (const n of m.addedNodes || []) if (n.nodeType === 1 && n.classList) {
        if (n.classList.contains('burst')) { if (n.textContent === 'KRITIKAL!') window.__seen.kritikal++; if (n.textContent.includes('KOMBO')) window.__seen.kombo++; if (n.textContent === 'ULTI!') window.__seen.ultiBurst++; if (n.textContent === 'Seri') window.__seen.seri++; }
        if (n.classList.contains('dmg')) window.__seen.dmg++;
        if (n.classList.contains('cdnum')) window.__seen.cd++;
      }
    }
  });
  mo.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class'] });
};
async function newPage(ctx, label) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`${label}: pageerror ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errors.push(`${label}: console ${m.text()}`); });
  p.on('request', r => { const u = r.url(); if (!u.startsWith(URL.replace('/tinju/', '')) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:')) external.push(label + ' ' + u); });
  p.on('dialog', d => d.accept());
  return p;
}
const ev = (p, f, a) => p.evaluate(f, a);
async function waitReady(p, minRound) { // word delivered, nothing typed yet, or match ended
  const h = await p.waitForFunction(r => { const t = window.__tinju, s = t.state; if (!s) return false; if (s.state === 'ended') return 'ended';
    return (s.state === 'word' && t.word && t.word.round === s.round && s.round >= r && !t.typing.sentDone && t.typing.typed === '' && !t.typing.bad) ? 'word' : false; }, minRound, { timeout: 25000 });
  return h.jsonValue();
}
const waitResult = (p, r) => p.waitForFunction(n => { const l = window.__tinju.lastResult; return l && l.round === n; }, r, { timeout: 15000 });
async function overflow(p) {
  return p.evaluate(() => { const vw = document.documentElement.clientWidth, sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const bad = [...document.querySelectorAll('body *')].filter(e => { if (e.id === 'typer' || e.closest('.toast')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.right > vw + 1 && !e.closest('.arena'); }).map(e => e.tagName + '#' + e.id + '.' + String(e.className)).slice(0, 3);
    return { vw, sw, bad }; });
}
const animsSince = (p, i) => p.evaluate(n => __tinju.anims.slice(n).map(a => a.l + ':' + a.r), i);
async function shot(p, name, prof) { await p.screenshot({ path: path.join(EVIDENCE, `shot-${name}-${prof}.png`) }); }

async function runProfile(prof, label, ctxOpts, o = {}) {
  const T = s => `[${label}] ${s}`;
  const rm = !!o.rm;
  const ctxA = await browser.newContext(ctxOpts), ctxB = await browser.newContext(ctxOpts);
  await ctxA.addInitScript(INIT); await ctxB.addInitScript(INIT);
  const A = await newPage(ctxA, label + '/A'), B = await newPage(ctxB, label + '/B');
  const maxOv = { sw: 0, vw: 0, bad: [] };
  const ovCheck = async (p) => { const r = await overflow(p); maxOv.sw = Math.max(maxOv.sw, r.sw); maxOv.vw = r.vw; if (r.sw > r.vw || r.bad.length) maxOv.bad.push(JSON.stringify(r)); };

  // ---- home ----
  await A.goto(URL); await B.goto(URL);
  check(T('home: version meta 1.0.0, __tinju.version, title'), (await A.getAttribute('meta[name="tinju-version"]', 'content')) === '1.0.0' && (await ev(A, () => __tinju.version)) === '1.0.0' && /Tinju Kata/.test(await A.title()));
  await ovCheck(A);
  await A.fill('#name', 'Pras'); await B.fill('#name', 'Budi');
  await A.click('#btnCreate'); await A.waitForSelector('#scr-lobby.active');
  const code = (await A.textContent('#lobbyCode')).trim();
  check(T('lobby: 5-char room code shown'), /^[A-Z0-9]{5}$/.test(code));
  await B.fill('#joinCode', code); await B.click('#btnJoin'); await B.waitForSelector('#scr-lobby.active');
  await A.waitForFunction(() => __tinju.state.players.length === 2);
  check(T('lobby: both players listed on both screens'), (await A.locator('#lobbyPlayers .pl').count()) === 2 && (await B.locator('#lobbyPlayers .pl').count()) === 2);
  check(T('lobby: 4 colour swatches, the opponent\'s colour is disabled'), (await A.locator('#swatches .swatch').count()) === 4 && (await A.locator('#swatches .swatch:disabled').count()) === 1 && (await A.locator('#swatches .swatch.sel').count()) === 1);
  check(T('lobby: Mulai disabled for the guest, enabled for the host'), await B.isDisabled('#btnStart') && !(await A.isDisabled('#btnStart')));
  const aSkin0 = await ev(A, () => __tinju.state.players.find(p => p.id === __tinju.me).skin);
  const pick = [0, 1, 2, 3].find(i => i !== aSkin0 && i !== (aSkin0 === 0 ? 1 : 0) && i !== 1) ?? 2;
  await A.click(`#swatches .swatch[data-skin="${pick}"]`);
  await B.waitForFunction(k => __tinju.state.players.some(p => p.skin === k), pick);
  check(T('lobby: colour change reaches the opponent and is saved in tk_skin'), (await ev(A, () => localStorage.getItem('tk_skin'))) === String(pick));
  await A.reload(); await A.waitForSelector('#scr-lobby.active');
  check(T('lobby: reload keeps the room (rejoin by tk_sess token)'), (await A.textContent('#lobbyCode')).trim() === code && (await ev(A, () => __tinju.state.players.length)) === 2);
  await ovCheck(A); await ovCheck(B);
  if (!rm) await shot(A, 'lobby', prof);

  // ---- start: countdown ----
  await A.click('#btnStart');
  await A.waitForSelector('#scr-game.active'); await B.waitForSelector('#scr-game.active');
  await A.waitForFunction(() => __tinju.state.state === 'countdown');
  check(T('countdown: no word and no tiles before the countdown ends'), (await ev(A, () => __tinju.word === null && document.querySelectorAll('#tiles .tile').length === 0)) === true);
  await A.waitForFunction(() => window.__seen.cd > 0);
  check(T('countdown: number overlay shown'), (await ev(A, () => window.__seen.cd)) > 0);
  check(T('arena exposes data-anim="<left>:<right>"'), /^[a-z]+:[a-z]+$/.test(await A.getAttribute('#arena', 'data-anim')));

  // ---- rounds ----
  const log = { A: 0, B: 0 }; // anim log cursor per page
  let round = 0, sawUlti = false, sawBadge = false, sawFire = false, sawCombo = false, rainbowOk = true, ultiShot = false, jabShot = false;
  const seenAnims = new Set(), resultsLog = [];
  for (; round < 40;) {
    round++;
    const ra = await waitReady(A, round);
    if (ra === 'ended') break;
    await waitReady(B, round);
    const w = await ev(A, () => ({ text: __tinju.word.text, ulti: __tinju.word.ulti, round: __tinju.word.round }));
    const wb = await ev(B, () => __tinju.word.text);
    if (round === 1) {
      check(T('word: both screens show the same word, one tile per character'), w.text === wb && (await A.locator('#tiles .tile').count()) === w.text.length && (await B.locator('#tiles .tile').count()) === w.text.length);
      check(T('word: first tile is the cursor, none typed yet'), await ev(A, () => document.querySelector('#tiles .tile').classList.contains('cur') && !document.querySelector('#tiles .tile.ok')));
    }
    const sU = await ev(A, () => __tinju.state.ultiIn);
    if (sU === 1) { sawBadge = (await A.locator('#ultiBadge.on').count()) === 1 || sawBadge; }
    await ovCheck(A);
    if (w.ulti) {
      sawUlti = true;
      const n = await A.locator('#tiles .tile.rainbow').count();
      rainbowOk = rainbowOk && n === w.text.length;
      if (rm) {
        const an = await ev(A, () => getComputedStyle(document.querySelector('#tiles .tile.rainbow')).animationName);
        check(T('reduced-motion: rainbow tiles do not cycle (animation-name none)'), an === 'none', an);
      }
      if (!ultiShot && !rm) { await shot(A, 'ulti', prof); ultiShot = true; }
    } else if (round === 1) {
      check(T('normal word: tiles are not rainbow'), (await A.locator('#tiles .tile.rainbow').count()) === 0);
    }
    const idxA = (await ev(A, () => __tinju.anims.length)), idxB = (await ev(B, () => __tinju.anims.length));
    const type = async (p, t, delay, wait) => { await sleep(wait); await p.keyboard.type(t, { delay }); };

    if (round === 1) {
      // B: blur -> overlay -> tap -> typo handling -> finishes. A stays silent, so B wins this round with 1 typo (no critical).
      await B.evaluate(() => document.activeElement && document.activeElement.blur());
      await B.waitForFunction(() => document.getElementById('focusHint').classList.contains('on'));
      check(T('blur: overlay "Ketuk untuk mengetik" appears'), true);
      await B.click('#focusHint');
      check(T('blur: tapping the overlay refocuses the hidden input and hides the overlay'), await ev(B, () => document.activeElement.id === 'typer' && !document.getElementById('focusHint').classList.contains('on')));
      const wrong = w.text[0] === 'q' ? 'x' : 'q';
      await B.keyboard.type(wrong);
      check(T('typo: wrong letter -> red tile'), await ev(B, () => document.querySelector('#tiles .tile').classList.contains('bad') && __tinju.typing.bad !== ''));
      await B.keyboard.type('zz');
      check(T('typo: further letters are ignored until the red tile is deleted'), await ev(B, (wr) => __tinju.typing.typed === '' && __tinju.typing.bad === wr && document.getElementById('typer').value === wr && document.querySelectorAll('#tiles .tile.ok').length === 0, wrong));
      await B.keyboard.press('Backspace');
      check(T('typo: backspace clears the red tile and counts exactly 1 typo'), await ev(B, () => __tinju.typing.typos === 1 && __tinju.typing.bad === '' && !document.querySelector('#tiles .tile.bad')));
      await B.keyboard.type(w.text.slice(0, 2), { delay: 20 });
      check(T('typing: correct letters turn tiles green in order'), await ev(B, () => document.querySelectorAll('#tiles .tile.ok').length === 2 && __tinju.typing.typed.length === 2));
      await B.keyboard.press('Backspace');
      check(T('typing: backspace on a correct letter costs no typo'), await ev(B, () => __tinju.typing.typos === 1 && __tinju.typing.typed.length === 1));
      await B.keyboard.type(w.text.slice(1), { delay: 20 });
      check(T('typing: finishing the word locks input and says "Selesai"'), await ev(B, () => __tinju.typing.sentDone === true && /Selesai/.test(document.getElementById('status').textContent)));
    } else if (round === 2) {
      // block scenario: both finish within 400 ms of each other, A first
      await Promise.all([type(A, w.text, 30, 250), type(B, w.text, 60, 250)]);
    } else if (w.ulti) {
      await type(A, w.text, 30, 300);
    } else {
      await type(A, w.text, 30, 250);
    }
    await waitResult(A, round); await waitResult(B, round);
    const res = await ev(A, () => __tinju.lastResult);
    resultsLog.push(res);
    const myWin = res.winner !== null && res.winner === (await ev(A, () => __tinju.me));
    if (round === 1) {
      check(T('round 1: B wins (finished, A silent): damage dealt to A'), res.winner !== null && !myWin && res.damage > 0 && res.critical === false);
      if (!rm && !jabShot) {
        // deterministic freeze of the pose for the screenshot (jab by B, ouch for A), text + HP bars are real
        await A.evaluate(() => { window.__frz = setInterval(() => { const t = __tinju.boxers, n = performance.now(); t[1].anim = 'jab'; t[1].t0 = n - 110; t[0].anim = 'ouch'; t[0].t0 = n - 200; t[0].power = 1.2; }, 8); });
        await sleep(60); await shot(A, 'jab', prof);
        await A.evaluate(() => clearInterval(window.__frz)); jabShot = true;
      }
    }
    if (round === 2) check(T('round 2: finishing within 400 ms of the winner is a block (x0.5)'), res.tier === 'block' && res.margin === 0.5, JSON.stringify(res));
    // animation mapping for this round (per page: left = me, right = opponent)
    const la = await animsSince(A, idxA), lb = await animsSince(B, idxB);
    la.concat(lb).forEach(s => s.split(':').forEach(x => seenAnims.add(x)));
    if (res.tier !== 'draw' && !rm) {
      const wSide = myWin ? 0 : 1, lSide = 1 - wSide;
      const hasA = (side, name) => la.some(s => s.split(':')[side] === name);
      const winAnim = res.critical ? 'uppercut' : 'jab', loseAnim = res.tier === 'block' ? 'block' : 'ouch';
      check(T(`round ${round}: ${res.tier}${res.critical ? '+critical' : ''} -> winner ${winAnim}, loser ${loseAnim} (own screen)`), hasA(wSide, winAnim) && hasA(lSide, loseAnim), JSON.stringify(la));
    }
    if (rm && round <= 3) check(T(`reduced-motion: round ${round} plays no one-shot animation (pose stays idle)`), !la.concat(lb).some(s => /jab|uppercut|block|ouch/.test(s)), JSON.stringify(la));
    if (res.critical) { await sleep(50); }
    // shake on ulti hit
    if (res.ulti && res.tier !== 'draw') {
      const sh = await ev(A, () => window.__seen.shake);
      if (rm) check(T('reduced-motion: ulti hit does not shake the arena'), sh === 0, String(sh));
      else check(T('ulti hit: arena shakes (class "shake")'), sh > 0, String(sh));
    }
    // fire after 3 straight wins
    const fireNow = await ev(A, () => __tinju.state.players.some(p => p.fire));
    if (fireNow) { sawFire = true; if (!(await A.locator('.fb.hot').count())) sawFire = false; }
    if (res.combo) sawCombo = true;
    await ovCheck(A);
    await sleep(120);
  }
  // ---- after the loop: summary assertions ----
  const seenA = await ev(A, () => window.__seen);
  check(T('ulti: a rainbow ulti word appeared, every tile has class "rainbow"'), sawUlti && rainbowOk);
  if (!rm) check(T('ulti: "Ulti berikutnya!" badge visible in the round before'), sawBadge);
  check(T('ulti: "ULTI!" burst shown on reveal'), seenA.ultiBurst > 0);
  check(T('combo: 🔥 badge shown on the HUD after 3 straight wins'), sawFire);
  check(T('combo: the next win after 🔥 is flagged combo'), sawCombo);
  if (!rm) {
    check(T('KRITIKAL! burst shown on a critical hit'), seenA.kritikal > 0);
    check(T('floating damage numbers shown'), seenA.dmg > 0);
  } else {
    check(T('reduced-motion: no jab/uppercut/block/ouch animation at any point'), !['jab', 'uppercut', 'block', 'ouch'].some(a => seenAnims.has(a)), [...seenAnims].join(','));
    const shB = await ev(B, () => window.__seen.shake);
    check(T('reduced-motion: arena never got the shake class on either screen'), seenA.shake === 0 && shB === 0);
  }

  // ---- KO screen ----
  await A.waitForFunction(() => __tinju.state.state === 'ended', null, { timeout: 15000 });
  await B.waitForFunction(() => __tinju.state.state === 'ended', null, { timeout: 15000 });
  await sleep(1300); // KO fall animation (900 ms) finished
  for (const p of [A, B]) (await p.evaluate(() => __tinju.anims.map(a => a.l + ':' + a.r))).forEach(x => x.split(':').forEach(y => seenAnims.add(y)));
  const endA = await A.textContent('#endTitle'), endB = await B.textContent('#endTitle');
  check(T('KO: winner sees "KO! Kamu menang", loser sees "KO! Kamu kalah"'), /KO! Kamu menang/.test(endA) && /KO! Kamu kalah/.test(endB), endA + ' | ' + endB);
  check(T('KO: end card visible, tiles hidden, loser HP 0'), await ev(A, () => !document.getElementById('endCard').hidden && document.getElementById('wordbox').hidden && __tinju.state.players.some(p => p.hp === 0)));
  check(T('KO: final poses data-anim = win:ko on the winner, ko:win on the loser'), (await A.getAttribute('#arena', 'data-anim')) === 'win:ko' && (await B.getAttribute('#arena', 'data-anim')) === 'ko:win', (await A.getAttribute('#arena', 'data-anim')) + ' / ' + (await B.getAttribute('#arena', 'data-anim')));
  if (!rm) for (const a of ['jab', 'uppercut', 'block', 'ouch', 'ko', 'win']) check(T(`animation "${a}" fired during the match`), seenAnims.has(a), [...seenAnims].join(','));
  else check(T('reduced-motion: ko and win poses still reached (jump to end state)'), seenAnims.has('ko') && seenAnims.has('win'), [...seenAnims].join(','));
  await ovCheck(A); await ovCheck(B);
  if (!rm) await shot(A, 'ko', prof);

  // ---- rematch ----
  await B.click('#btnRematch');
  await A.waitForFunction(() => /mau rematch/.test(document.getElementById('btnRematch').textContent));
  await B.waitForFunction(() => /Menunggu/.test(document.getElementById('btnRematch').textContent), null, { timeout: 4000 }).catch(() => {});
  const bTxt = await B.textContent('#btnRematch'), bDis = await B.isDisabled('#btnRematch');
  check(T('rematch: one vote shows "Menunggu…" for the voter and "mau rematch" for the other'), /Menunggu/.test(bTxt) && bDis, `B button="${bTxt}" disabled=${bDis}`);
  await A.click('#btnRematch');
  await A.waitForFunction(() => __tinju.state.state === 'countdown' && __tinju.state.round === 1);
  check(T('rematch: both voted -> new countdown, HP full on both bars, end card hidden'), await ev(A, () => __tinju.state.players.every(p => p.hp === __tinju.state.cfg.HP) && document.getElementById('endCard').hidden && [...document.querySelectorAll('.hpbar i')].every(i => i.style.width === '100%')));
  await A.click('#btnLeaveGame'); // confirm dialog auto-accepted: mid-match leave -> walkover for the opponent
  await A.waitForSelector('#scr-home.active');
  await B.waitForFunction(() => __tinju.state && __tinju.state.state === 'ended' && __tinju.state.endReason === 'walkover');
  check(T('leave mid-match: leaver is home, opponent sees the walkover result'), /walkover/.test(await B.textContent('#endTitle')));
  await B.click('#btnLeaveEnd'); await B.waitForSelector('#scr-home.active');
  check(T('Keluar from the end screen returns home and clears tk_sess'), (await ev(B, () => localStorage.getItem('tk_sess'))) === null);

  check(T(`no horizontal overflow in any screen state (max scrollWidth ${maxOv.sw} <= viewport ${maxOv.vw})`), maxOv.bad.length === 0 && maxOv.sw <= maxOv.vw, maxOv.bad.slice(0, 2).join(' '));
  await ctxA.close(); await ctxB.close();
  return resultsLog;
}

const dev = devices();
const desktop = { viewport: { width: 1280, height: 800 } };
const iphone = { ...dev['iPhone 12'] };
const phone320 = { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const ONLY = (process.env.UI_ONLY || '').split(',').filter(Boolean); // debugging aid: UI_ONLY=desktop,rm
const want = n => !ONLY.length || ONLY.includes(n);
if (want('desktop')) await runProfile('desktop', 'desktop 1280x800', desktop);
if (want('mobile')) await runProfile('mobile', 'iPhone 12', iphone);
if (want('w320')) await runProfile('w320', '320px phone', phone320);
if (want('rm')) await runProfile('rm', 'reduced-motion', { ...desktop, reducedMotion: 'reduce' }, { rm: true });

// ---- theme + sound prefs persist ----
{
  const ctx = await browser.newContext(desktop);
  const p = await newPage(ctx, 'prefs'); await p.goto(URL);
  check('theme: light by default', (await ev(p, () => document.documentElement.dataset.theme)) === 'light');
  await p.click('#btnTheme'); await p.click('#btnSfx'); await p.click('#btnMusic');
  await p.reload();
  const r = await ev(p, () => ({ th: document.documentElement.dataset.theme, snd: JSON.parse(localStorage.getItem('tk_snd')), thLs: localStorage.getItem('tk_theme'), sfxOff: document.getElementById('btnSfx').classList.contains('off'), musicOff: document.getElementById('btnMusic').classList.contains('off'), color: getComputedStyle(document.body).backgroundColor }));
  check('theme: dark toggle persists after reload (tk_theme)', r.th === 'dark' && r.thLs === 'dark');
  check('theme: dark background is actually dark', r.color.match(/\d+/g).slice(0, 3).map(Number).every(v => v < 60), r.color);
  check('sound prefs persist after reload (tk_snd sfx+music off, buttons show off)', r.snd.sfx === false && r.snd.music === false && r.sfxOff && r.musicOff, JSON.stringify(r.snd));
  check('keys are tk_* only (no bc_* leakage)', await ev(p, () => Object.keys(localStorage).every(k => k.startsWith('tk_'))));
  await p.fill('#name', 'Pras'); await p.click('#btnCreate'); await p.waitForSelector('#scr-lobby.active');
  await p.reload(); await p.waitForSelector('#scr-lobby.active');
  check('name persisted (tk_name) and session token (tk_sess) restores the room', (await ev(p, () => localStorage.getItem('tk_name'))) === 'Pras' && (await ev(p, () => !!JSON.parse(localStorage.getItem('tk_sess')).token)));
  await ctx.close();
}

check('0 page errors and 0 console errors across all runs', errors.length === 0, errors.slice(0, 3).join(' || '));
check('0 requests to external hosts (single file, no external assets)', external.length === 0, external.slice(0, 3).join(' || '));
await browser.close();
srv.stop();
await sleep(100);
const failed = summary();
process.exit(failed ? 1 : 0);
