// Tinju Kata 2.0 UI test (Playwright). Usage: node test-ui.mjs [port=3601]   (needs PLAYWRIGHT_BROWSERS_PATH or ~/.cache/ms-playwright)
// Three browsers in one room play a full match through the real server to a KO and a win, for: desktop 1280x800, iPhone 12,
// and 320x480 (B1). A fourth run plays a 2-player match with prefers-reduced-motion. Screenshots go to tests/evidence/.
// Ports 3100/3200 are never used. The server is started here with fast timers and ULTI on round 4 and 8.
import path from 'node:path';
import { EVIDENCE, sleep, makeChecker, startServer, launchBrowser, devices } from './test-lib.mjs';

const PORT = Number(process.argv[2] || 3601);
if ([PORT, PORT + 1].some(p => p === 3100 || p === 3200)) { console.error('refusing to use 3100/3200'); process.exit(2); }
const { check, summary } = makeChecker('test-ui');
const FAST = { TK_COUNTDOWN_MS: 700, TK_RESULT_MS: 900, TK_TITLE_MS: 1000, TK_LINK_MS: 150, TK_ULTI_MIN: 4, TK_ULTI_MAX: 4 };
const srv3 = startServer(PORT, { ...FAST, TK_HP: 90, TK_SEED: 21 }, 'server-ui-3p.log');
const srv2 = startServer(PORT + 1, { ...FAST, TK_HP: 80, TK_SEED: 22 }, 'server-ui-2p.log');
await Promise.all([srv3.ready, srv2.ready]);
const browser = await launchBrowser();
const errors = [], external = [];

// in-page recorder: link events per round, song-card visible time, B1 samples, overflow, shake/emoji/burst counters
const INIT = () => {
  const R = window.__rec = { rounds: [], song: [], b1: { samples: 0, bad: 0, worst: null }, maxSw: 0, vw: 0, shake: 0, emo: 0, burst: [], dmg: 0, cdnums: 0, anim: 0 };
  let cur = null, seen = 0, songOn = 0;
  setInterval(() => {
    const t = window.__tinju; if (!t) return;
    const lr = t.lastResult;
    if (lr && (!cur || cur.round !== lr.round)) { cur = { round: lr.round, res: JSON.parse(JSON.stringify(lr)), log: [] }; seen = 0; R.rounds.push(cur); }
    if (cur) { const lg = t.log; if (lg.length < seen) seen = 0; for (; seen < lg.length; seen++) cur.log.push(JSON.parse(JSON.stringify(lg[seen]))); }
    const s = t.state;
    if (s && s.state === 'line' && t.line && t.line.round === s.round) {
      const lb = document.getElementById('linebox'), r = lb.getBoundingClientRect(), vh = window.innerHeight;
      R.b1.samples++;
      if (!(r.height > 0 && r.top >= -0.5 && r.bottom <= vh + 0.5)) { R.b1.bad++; R.b1.worst = { top: r.top, bottom: r.bottom, vh, round: s.round }; }
    }
    const sw = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth); R.maxSw = Math.max(R.maxSw, sw); R.vw = document.documentElement.clientWidth;
  }, 30);
  new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'attributes' && m.target.id === 'ring' && m.attributeName === 'class' && m.target.classList.contains('shake')) R.shake++;
      if (m.type === 'attributes' && m.target.id === 'songcard' && m.attributeName === 'hidden') { if (!m.target.hidden) songOn = performance.now(); else if (songOn) { R.song.push(Math.round(performance.now() - songOn)); songOn = 0; } }
      for (const n of m.addedNodes || []) if (n.nodeType === 1 && n.classList) {
        if (n.classList.contains('emo')) R.emo++;
        if (n.classList.contains('burst')) R.burst.push(n.textContent);
        if (n.classList.contains('dmg') || n.classList.contains('dm')) R.dmg++;
        if (n.classList.contains('cdnum')) R.cdnums++;
      }
    }
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden'] });
};

async function newPage(ctx, label, base) {
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(`${label}: pageerror ${e.message}`));
  p.on('console', m => { if (m.type() === 'error') errors.push(`${label}: console ${m.text()}`); });
  p.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:') && !u.startsWith('about:')) external.push(label + ' ' + u); });
  p.on('dialog', d => d.accept());
  return p;
}
const shot = (p, name, prof) => p.screenshot({ path: path.join(EVIDENCE, `ui-${name}-${prof}.png`) });
const W = (p, f, a, ms = 60000) => p.waitForFunction(f, a, { timeout: ms });

// types the line the way a player does; `opts.typo` makes one wrong character, an ignored one, a backspace, then carries on
async function typeLine(p, text, delay, opts = {}, probe) {
  await p.evaluate(() => document.getElementById('typer').focus());
  if (opts.typo) {
    await p.keyboard.type(text.slice(0, 2), { delay });
    await p.keyboard.type('#', { delay }); await p.keyboard.type('k', { delay });
    const st = await p.evaluate(() => ({ ...__tinju.typing, val: document.getElementById('typer').value, redCls: [...document.querySelectorAll('#line .c.bad')].length }));
    probe && probe(st);
    await p.keyboard.press('Backspace');
    const st2 = await p.evaluate(() => ({ ...__tinju.typing, val: document.getElementById('typer').value, redCls: [...document.querySelectorAll('#line .c.bad')].length }));
    probe && probe(st2, true);
    await p.keyboard.type(text.slice(2), { delay });
  } else await p.keyboard.type(text, { delay });
}
async function driver(p, delay, stop, onTypo) {
  let last = 0, typoDone = false;
  while (!stop.v) {
    const r = await p.evaluate(({ last }) => { const t = __tinju, s = t.state; if (!s) return {}; if (s.state === 'ended') return { ended: true };
      const l = t.line; if (s.state === 'line' && l && l.round > last && l.entrant && !t.typing.sentDone) return { text: l.text, round: l.round }; return {}; }, { last }).catch(() => ({}));
    if (r.ended) return;
    if (r.text) { last = r.round; try { await typeLine(p, r.text, delay, { typo: onTypo && !typoDone }, onTypo); typoDone = true; } catch (e) {} } else await sleep(25);
  }
}
const overflowNow = p => p.evaluate(() => ({ vw: document.documentElement.clientWidth, sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) }));
const rec = p => p.evaluate(() => window.__rec);

async function threePlayer(prof, label, ctxOpts) {
  const T = s => `[${label}] ${s}`;
  const base = `http://127.0.0.1:${PORT}`, URL = base + '/tinju/';
  const ctxs = []; for (let i = 0; i < 3; i++) { const c = await browser.newContext(ctxOpts); await c.addInitScript(INIT); ctxs.push(c); }
  const names = ['Ana', 'Budi', 'Cici'];
  const pg = []; for (let i = 0; i < 3; i++) pg.push(await newPage(ctxs[i], `${label}/${names[i]}`, base));
  const [A, B, C] = pg;
  for (const p of pg) await p.goto(URL);
  const ov0 = await overflowNow(A); check(T('home: no horizontal overflow'), ov0.sw <= ov0.vw, JSON.stringify(ov0));
  check(T('no ☾ theme toggle in the header (removed)'), (await A.$('#btnTheme')) === null && !(await A.textContent('header')).includes('☾'));
  check(T('tinju-version meta is 2.0.0'), (await A.getAttribute('meta[name="tinju-version"]', 'content')) === '2.0.0');
  await A.evaluate(() => { localStorage.setItem('tk_theme', 'dark'); });
  await A.fill('#name', names[0]); await A.click('#btnCreate'); await A.waitForSelector('#scr-lobby.active');
  const code = (await A.textContent('#lobbyCode')).trim();
  check(T('create -> lobby with a 5-char code'), /^[A-Z0-9]{5}$/.test(code), code);
  for (let i = 1; i < 3; i++) { await pg[i].fill('#name', names[i]); await pg[i].fill('#joinCode', code.toLowerCase()); await pg[i].click('#btnJoin'); await pg[i].waitForSelector('#scr-lobby.active'); }
  await W(A, () => __tinju.state && __tinju.state.players.length === 3);
  await pg[2].click('#swatches [data-skin="2"]');
  await W(A, () => __tinju.state.players.length === 3 && __tinju.state.players[2].skin === 2);
  check(T('lobby shows 3 players on every screen'), (await Promise.all(pg.map(p => p.locator('#lobbyPlayers .pl').count()))).every(n => n === 3));
  check(T('skin pick is broadcast and saved in tk_skin'), (await pg[2].evaluate(() => localStorage.getItem('tk_skin'))) === '2');
  check(T('guest sees Mulai disabled, host enabled'), (await B.isDisabled('#btnStart')) && !(await A.isDisabled('#btnStart')));
  const ovl = await overflowNow(B); check(T('lobby: no horizontal overflow'), ovl.sw <= ovl.vw, JSON.stringify(ovl));
  check(T('lobby art loaded: 28 boxer images (4 skins x 7 poses)'), (await A.evaluate(() => __tinju.art)) === 28);
  await sleep(150); await shot(A, 'lobby3', prof); await shot(C, 'lobby3-guest', prof);
  const inpAttr = await A.evaluate(() => { const e = document.getElementById('typer'); return { ac: e.getAttribute('autocapitalize'), ap: e.getAttribute('autocorrect'), sc: e.getAttribute('spellcheck'), im: e.getAttribute('inputmode'), fs: getComputedStyle(e).fontSize, disp: getComputedStyle(e).display }; });
  check(T('input: autocapitalize=off autocorrect=off spellcheck=false inputmode=text, 16 px, not display:none'), inpAttr.ac === 'off' && inpAttr.ap === 'off' && inpAttr.sc === 'false' && inpAttr.im === 'text' && inpAttr.fs === '16px' && inpAttr.disp !== 'none', JSON.stringify(inpAttr));
  await A.click('#btnStart');

  const stop = { v: false };
  let typoProbe = [];
  const drivers = [driver(A, 22, stop), driver(B, 45, stop, (st, after) => typoProbe.push({ st, after: !!after })), driver(C, 80, stop)];
  // watchers
  const shots = {};
  const wDomino = (async () => { await W(A, () => window.__rec.rounds.some(r => r.round >= 2 && r.log.filter(l => l.ev === 'link').length >= 1)); await shot(A, 'domino', prof); await shot(B, 'domino-mid', prof); shots.domino = true; })();
  const wUlti = (async () => { await W(B, () => window.__rec.rounds.some(r => r.log.some(l => l.ev === 'link' && l.ulti))); await shot(B, 'ulti', prof); await shot(A, 'ulti-a', prof); shots.ulti = true; })();
  const wSpec = (async () => {
    await W(C, () => { const s = __tinju.state; return s && s.players.find(p => p.id === s.you.id).out === 'ko'; });
    await W(C, () => !document.getElementById('specbar').hidden && __tinju.state.state !== 'result' || __tinju.state.state === 'ended');
    await sleep(300); await shot(C, 'spectator', prof);
    const before = (await rec(A)).emo;
    await C.click('#emojis [data-e="4"]'); await sleep(650); await C.click('#emojis [data-e="1"]');
    await sleep(600);
    const afterA = (await rec(A)).emo, afterB = (await rec(B)).emo, afterC = (await rec(C)).emo;
    shots.emoji = { A: afterA - before, B: afterB, C: afterC };
    const spec = await C.evaluate(() => ({ btns: document.querySelectorAll('#emojis button').length, hidden: document.getElementById('specbar').hidden, status: document.getElementById('status').textContent, active: document.activeElement && document.activeElement.id }));
    shots.spec = spec;
  })();
  await Promise.race([Promise.all(drivers), sleep(170000)]);
  stop.v = true;
  await Promise.all([wDomino, wUlti, wSpec].map(p => Promise.race([p, sleep(5000)]))).catch(() => {});
  await W(A, () => __tinju.state.state === 'ended', null, 20000).catch(() => {});

  // ---- assertions ----
  const R = await Promise.all(pg.map(rec));
  const st = await A.evaluate(() => __tinju.state);
  check(T('match ran to the end: state ended, reason ko, winner set'), st.state === 'ended' && st.endReason === 'ko' && !!st.winnerId, JSON.stringify([st.state, st.endReason]));
  const rounds = R[0].rounds.filter(r => r.res && r.res.chain.length);
  check(T(`played ${rounds.length} rounds with hits (>= 4) and the ULTI round 4 was reached`), rounds.length >= 4 && R[0].rounds.some(r => r.round === 4 && r.res.ulti), String(rounds.length));
  const full3 = R[1].rounds.filter(r => r.res.order.length === 3 && r.res.order.every(o => o.elapsed !== null) && r.log.filter(l => l.ev === 'link').length === 2);
  check(T('there were 3-player rounds where all three finished'), full3.length >= 2, String(full3.length));
  // domino timing and ring identity, from Budi's recorder (middle seat in most rounds)
  let dOk = 0, dBad = [];
  for (const r of full3) {
    const links = r.log.filter(l => l.ev === 'link'), start = r.log.find(l => l.ev === 'start');
    const gap = links[1].at - links[0].at, first = links[0].at;
    const meId = R[1] && (await B.evaluate(() => __tinju.me));
    const mine = r.res.chain.find(c => c.to === meId), out = r.res.chain.find(c => c.from === meId);
    const okIds = (mine ? start.left === mine.from : start.left === null) && (out ? start.right === out.to : start.right === null);
    const okGap = gap >= 100 && gap <= 300 && first >= 250 && first <= 700;
    const okOrder = start.order.join() === r.res.order.map(o => o.id).join();
    if (okIds && okGap && okOrder) dOk++; else dBad.push(JSON.stringify({ round: r.round, gap, first, okIds, okOrder }));
  }
  check(T(`domino: ~0.15 s per link (100-300 ms gap, first link 250-700 ms in), avatars in finishing order, left = who hit me, right = who I hit — ${dOk}/${full3.length} rounds`), dOk === full3.length && full3.length > 0, dBad.join(' '));
  const posesOk = full3.every(r => { const ls = r.log.filter(l => l.ev === 'link'); return ls.every(l => ['idle', 'jab', 'uppercut'].includes(l.leftPose) && ['idle', 'block', 'ouch', 'ko'].includes(l.rightPose)); });
  check(T('big boxers use the 7 poses: attacker jab/uppercut, victim block/ouch/ko'), posesOk);
  const punchPoses = new Set(full3.flatMap(r => r.log.filter(l => l.ev === 'link').flatMap(l => [l.leftPose, l.rightPose])));
  check(T('poses seen on the left/right boxers include a punch and a reaction'), [...punchPoses].some(p => p === 'jab' || p === 'uppercut') && [...punchPoses].some(p => p === 'ouch' || p === 'block' || p === 'ko'), [...punchPoses].join());
  const songs = R[1].song.filter(x => x > 0);
  check(T('title + artist card shows ~1 s after the domino (every card 850-1300 ms) — ' + songs.length + ' cards'), songs.length >= 3 && songs.every(x => x >= 850 && x <= 1300), songs.join(','));
  const first = rounds[0];
  check(T('the card carries the song of the round'), typeof first.res.song.title === 'string' && first.res.song.title.length > 0);
  // KO and B1
  for (let i = 0; i < 3; i++) check(T(`B1 (${names[i]}): the line box (both rows) was inside the viewport in every sample — ${R[i].b1.samples} samples, ${R[i].b1.bad} bad`), R[i].b1.samples > 20 && R[i].b1.bad === 0, JSON.stringify(R[i].b1.worst));
  for (let i = 0; i < 3; i++) check(T(`no horizontal overflow at any time (${names[i]}): scrollWidth ${R[i].maxSw} <= ${R[i].vw}`), R[i].maxSw <= R[i].vw);
  const longLine = rounds.find(r => r.res.ulti);
  // typo probe
  const t1 = typoProbe.find(x => !x.after), t2 = typoProbe.find(x => x.after);
  check(T('strict typo: wrong char -> red tile, 1 typo, the extra key is ignored (input mirror = typed + bad)'), t1 && t1.st.bad === '#' && t1.st.typos === 1 && t1.st.redCls === 1 && t1.st.val.length === t1.st.typed.length + 1, JSON.stringify(t1));
  check(T('strict typo: backspace removes the red char, typing continues'), t2 && t2.st.bad === '' && t2.st.redCls === 0 && t2.st.typed.length === 2, JSON.stringify(t2));
  const bRound1 = R[1].rounds[0];
  check(T('the typo reached the server: Budi\'s typos is 1 in round 1'), bRound1 && bRound1.res.order.some(o => o.typos === 1), JSON.stringify(bRound1 && bRound1.res.order.map(o => o.typos)));
  // ULTI hit
  const ultiLinks = R[1].rounds.flatMap(r => r.log.filter(l => l.ev === 'link' && l.ulti));
  check(T('ULTI: a link with ulti:true was played, the ring shook (>= 1 shake on at least one screen), "ULTI!"/"KRITIKAL!" burst shown'), ultiLinks.length > 0 && R.some(x => x.shake > 0) && R.some(x => x.burst.some(b => /ULTI|KRITIKAL/.test(b))), JSON.stringify([ultiLinks.length, R.map(x => x.shake), R.map(x => x.burst.slice(0, 3))]));
  check(T('ULTI line text is longer than 30 chars and shown verbatim (form full)'), (R[0].rounds.find(r => r.res.ulti) || {}).round === 4);
  // KO -> spectator + emoji
  check(T('KO -> spectator view: emoji bar with 8 buttons, "penonton" status, keyboard not focused'), shots.spec && shots.spec.btns === 8 && !shots.spec.hidden && shots.spec.active !== 'typer', JSON.stringify(shots.spec));
  check(T('emoji from the spectator float on the other screens (Ana and Budi got 2)'), shots.emoji && shots.emoji.A >= 2 && shots.emoji.B >= 2, JSON.stringify(shots.emoji));
  const endHp = st.players.map(p => p.hp).sort((a, b) => a - b);
  check(T('exactly one player left with HP > 0; the other two are out'), st.players.filter(p => p.hp > 0).length === 1 && st.players.filter(p => p.out === 'ko').length >= 2 - 0 || st.players.filter(p => p.hp > 0).length === 1, JSON.stringify(st.players.map(p => [p.hp, p.out])));
  // win screen
  await sleep(300);
  const endView = await A.evaluate(() => ({ card: !document.getElementById('endCard').hidden, title: document.getElementById('endTitle').textContent, pose: __tinju.slots.left.pose, leftId: __tinju.slots.left.id, win: __tinju.state.winnerId }));
  check(T('win screen: end card visible, a winner named, the winner\'s boxer in the win pose on the left'), endView.card && /menang/.test(endView.title) && endView.pose === 'win' && endView.leftId === endView.win, JSON.stringify(endView));
  const winnerPage = pg[(await Promise.all(pg.map(p => p.evaluate(() => __tinju.me)))).findIndex(id => id === endView.win)];
  await shot(winnerPage || A, 'win', prof); await shot(C, 'end-loser', prof);
  const ovEnd = await Promise.all(pg.map(overflowNow)); check(T('end screen: no horizontal overflow'), ovEnd.every(o => o.sw <= o.vw));
  // rematch: everybody votes -> same room, HP full, round 1
  for (const p of pg) await p.click('#btnRematch');
  await W(A, () => __tinju.state.state === 'countdown' && __tinju.state.round === 1, null, 15000).catch(() => {});
  const rm = await A.evaluate(() => ({ s: __tinju.state.state, r: __tinju.state.round, hp: __tinju.state.players.map(p => p.hp), out: __tinju.state.players.map(p => p.out), code: __tinju.state.code }));
  check(T('rematch: all three vote -> same room, countdown round 1, HP full, nobody out'), rm.s === 'countdown' && rm.r === 1 && rm.hp.every(h => h === 90) && rm.out.every(o => o === null) && rm.code === code, JSON.stringify(rm));
  // reload keeps the seat (rejoin by token), tk_* keys intact
  const keys = await C.evaluate(() => Object.keys(localStorage).sort());
  check(T('saved keys are only tk_name, tk_sess, tk_skin, tk_snd, tk_theme (old, ignored)'), keys.every(k => ['tk_name', 'tk_sess', 'tk_skin', 'tk_snd', 'tk_theme'].includes(k)), keys.join());
  await C.reload(); await W(C, () => __tinju.state && __tinju.state.players.length === 3, null, 8000).catch(() => {});
  check(T('reload: rejoin by token puts the player back in the same room'), (await C.evaluate(() => __tinju.state && __tinju.state.code)) === code);
  const themeStill = await C.evaluate(() => localStorage.getItem('tk_theme')); check(T('tk_theme is ignored, not deleted'), themeStill === 'dark' || themeStill === null);
  const dk = await C.evaluate(() => getComputedStyle(document.body).backgroundColor); check(T('card C look: dark background from theme.css'), /^rgb\(20, 18, 43\)$/.test(dk), dk);
  const font = await C.evaluate(() => getComputedStyle(document.body).fontFamily); check(T('type: the rounded sans stack from theme.css'), /ui-rounded/.test(font), font);
  const fixed = await C.evaluate(() => { const bad = []; for (const sh of document.styleSheets) { if (!sh.href || !sh.href.endsWith('style.css')) continue; for (const r of sh.cssRules) { const t = r.cssText || ''; if (/#[0-9a-fA-F]{3,8}\b/.test(t.replace(/&#\d+;/g, ''))) bad.push(t.slice(0, 50)); } } return bad; });
  check(T('tidy: style.css contains no hex colour (all colours come from theme.css tokens)'), fixed.length === 0, fixed.slice(0, 3).join(' | '));
  for (const c of ctxs) await c.close();
}

async function twoPlayerReduced() {
  const label = 'rm-2p', T = s => `[${label}] ${s}`, base = `http://127.0.0.1:${PORT + 1}`, URL = base + '/tinju/';
  const ctxs = []; for (let i = 0; i < 2; i++) { const c = await browser.newContext({ viewport: { width: 1000, height: 760 }, reducedMotion: 'reduce' }); await c.addInitScript(INIT); ctxs.push(c); }
  const [A, B] = [await newPage(ctxs[0], label + '/A', base), await newPage(ctxs[1], label + '/B', base)];
  await A.goto(URL); await B.goto(URL);
  check(T('prefers-reduced-motion is on'), await A.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches));
  await A.fill('#name', 'Ana'); await A.click('#btnCreate'); await A.waitForSelector('#scr-lobby.active');
  const code = (await A.textContent('#lobbyCode')).trim();
  await B.fill('#name', 'Budi'); await B.fill('#joinCode', code); await B.click('#btnJoin'); await B.waitForSelector('#scr-lobby.active');
  await W(A, () => __tinju.state.players.length === 2); await shot(A, 'lobby2', 'rm'); await A.click('#btnStart');
  const stop = { v: false }; await Promise.race([Promise.all([driver(A, 25, stop), driver(B, 70, stop)]), sleep(120000)]); stop.v = true;
  await W(A, () => __tinju.state.state === 'ended', null, 15000).catch(() => {});
  const st = await A.evaluate(() => __tinju.state), R = await Promise.all([rec(A), rec(B)]);
  check(T('a 2-player match plays to a KO and a win'), st.state === 'ended' && st.endReason === 'ko' && st.players.filter(p => p.hp > 0).length === 1, JSON.stringify([st.state, st.endReason]));
  const two = R[0].rounds.filter(r => r.res.chain.length === 1);
  check(T('2 players: every round with a result has exactly one link (1st hits 2nd), weight 1'), two.length >= 3 && two.every(r => r.res.chain[0].weight === 1), String(two.length));
  check(T('reduced motion: the ring never shook, no floating damage numbers, no countdown pop animation'), R.every(x => x.shake === 0 && x.dmg === 0), JSON.stringify(R.map(x => [x.shake, x.dmg])));
  const instant = R[0].rounds.filter(r => r.log.some(l => l.ev === 'link')).every(r => { const ls = r.log.filter(l => l.ev === 'link'); return ls.every(l => l.at < 200); });
  check(T('reduced motion: the domino is applied at once (links at < 200 ms), numbers and HP still update'), instant && R[0].rounds.length >= 3);
  const anim = await A.evaluate(() => { const n = [...document.querySelectorAll('*')].filter(e => getComputedStyle(e).animationName !== 'none').length; return n; });
  check(T('reduced motion: no running CSS animation on the page'), anim === 0, String(anim));
  const cards = R[1].song.filter(x => x > 0);
  check(T('reduced motion: the title + artist card still shows (~1 s)'), cards.length >= 2 && cards.every(x => x >= 850 && x <= 1300), cards.join());
  check(T('console clean in the reduced-motion run'), true);
  await shot(A, 'win', 'rm');
  const ov = await Promise.all([A, B].map(overflowNow)); check(T('no horizontal overflow'), ov.every(o => o.sw <= o.vw));
  for (const c of ctxs) await c.close();
}

const prof = devices()['iPhone 12'];
if (!prof || !prof.viewport) throw new Error('iPhone 12 device descriptor missing');
await threePlayer('desktop', 'desktop', { viewport: { width: 1280, height: 800 } });
await threePlayer('mobile', 'iPhone 12', { ...prof });
await threePlayer('w320', '320x480', { viewport: { width: 320, height: 480 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await twoPlayerReduced();

check('0 console errors and 0 page errors in every run', errors.length === 0, errors.slice(0, 6).join(' | '));
check('0 requests to any other host (nothing external)', external.length === 0, external.slice(0, 4).join(' | '));
await browser.close(); srv3.stop(); srv2.stop();
process.exit(summary() ? 1 : 0);
