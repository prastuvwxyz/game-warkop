// Playwright release gate for v3.0: desktop 1280x800 + iPhone 12.  Wiring tests for steps 4/5 live here too.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { INDEX, ROOT } from './lib.mjs';
const require = createRequire(import.meta.url);                              // Playwright from the repo's node_modules (devDependency)
const { chromium, devices } = require('playwright');
const EXE = process.env.CHROMIUM || undefined;                               // default: the build PLAYWRIGHT_BROWSERS_PATH holds
// The version under test is the top entry of the game's CHANGELOG.md, not a constant here.
export const VERSION = fs.readFileSync(new URL('../../CHANGELOG.md', import.meta.url), 'utf8').match(/^## (\d+\.\d+\.\d+)/m)[1];
export const SHOTS = ROOT + 'evidence/';

export default async function ({ check, section }) {
  section('GATE — Playwright, desktop 1280x800 + iPhone 12 (headless shell, executablePath set)');
  fs.mkdirSync(SHOTS, { recursive: true });
  const URL = 'file://' + INDEX;
  const browser = await chromium.launch({ executablePath: EXE });
  const kinds = {
    desktop: { opts: { viewport: { width: 1280, height: 800 } }, touch: false },
    iphone: { opts: { ...devices['iPhone 12'] }, touch: true }
  };
  const allErrors = [], requests = [];

  // open a page with localStorage pre-seeded ONCE per tab (sessionStorage flag, so a reload keeps what the game wrote)
  async function open(kind, { ls = {}, query = '', block = false, viewport } = {}) {
    const ctx = await browser.newContext(viewport ? { ...kinds[kind].opts, viewport } : kinds[kind].opts);
    const page = await ctx.newPage(); const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('request', r => requests.push(r.url()));
    await page.addInitScript(({ ls, block }) => {
      if (block) { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }); return; }
      if (!sessionStorage.getItem('__seeded')) { for (const k in ls) localStorage.setItem(k, ls[k]); sessionStorage.setItem('__seeded', '1'); }
    }, { ls, block });
    await page.goto(URL + query); await page.waitForTimeout(250);
    return { page, ctx, errs, kind, touch: kinds[kind].touch, async close() { allErrors.push(...errs.map(e => `[${kind}] ${e}`)); await ctx.close(); } };
  }
  const P = async (page, gx, gy) => page.evaluate(([gx, gy]) => { const r = c.getBoundingClientRect(); return { x: r.left + gx * r.width / 360, y: r.top + gy * r.height / 640 }; }, [gx, gy]);
  async function tap(h, gx, gy) { const p = await P(h.page, gx, gy); if (h.touch) await h.page.touchscreen.tap(p.x, p.y); else await h.page.mouse.click(p.x, p.y); await h.page.waitForTimeout(40); }
  async function swipe(h, gx0, gy0, gx1, gy1) {
    const a = await P(h.page, gx0, gy0), b = await P(h.page, gx1, gy1);
    if (!h.touch) { await h.page.mouse.move(a.x, a.y); await h.page.mouse.down(); await h.page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 }); await h.page.mouse.move(b.x, b.y, { steps: 4 }); await h.page.mouse.up(); }
    else { const cdp = await h.ctx.newCDPSession(h.page); const t = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y }] });
      await t('touchStart', a); for (let i = 1; i <= 4; i++) await t('touchMove', { x: a.x + (b.x - a.x) * i / 4, y: a.y + (b.y - a.y) * i / 4 }); await t('touchEnd', b); }
    await h.page.waitForTimeout(60);
  }
  const ev = (h, f, a) => h.page.evaluate(f, a);
  const waitState = async (h, st, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(h, () => state) === st) return true; await h.page.waitForTimeout(40); } return false; };
  // start a run and die at score n (bird dropped to the ground), wait for the full panel
  async function dieAt(h, n) {
    if (await ev(h, () => state) === 'ready') await ev(h, () => flap());
    await ev(h, n => { world.score = score = n; scoreStr = String(n); bird.y = 600; }, n);
    const ok = await waitState(h, 'dead'); await h.page.waitForFunction(() => panelT >= 1, null, { timeout: 4000 }).catch(() => {}); await h.page.waitForTimeout(120); return ok;
  }
  const restart = async h => { await h.page.waitForTimeout(550); await ev(h, () => flap()); return waitState(h, 'ready', 1000); };

  for (const kind of ['desktop', 'iphone']) {
    const tag = `[${kind}]`;
    // ---------- boot + hooks ----------
    { const h = await open(kind, { query: '?seed=7' });
      const meta = await ev(h, () => document.querySelector('meta[name=flappy-version]').content);
      const api = await ev(h, () => ({ v: __flappy.version, seed: __flappy.seed, score: __flappy.score, hasRank: 'rank' in __flappy, fns: ['step', 'blocked', 'corridors', 'snapshot', 'restore', 'rankOf', 'skinUnlocked'].every(k => typeof __flappy[k] === 'function') }));
      check(`${tag} <meta name=flappy-version> == __flappy.version == CHANGELOG version, ?seed=7 -> seed 7, all hooks present`, meta === VERSION && api.v === VERSION && api.seed === 7 && api.fns && api.hasRank, JSON.stringify(api));
      // snapshot/restore + step hook replay the same future
      const rep = await ev(h, () => { flap(); __flappy.step(130, i => i % 17 === 0); const s = __flappy.snapshot(); __flappy.step(200, i => i % 17 === 0); const a = JSON.stringify([bird.y, bird.v, pipes.map(p => [p.x, p.top]), world.playFrame]); __flappy.restore(s); __flappy.step(200, i => i % 17 === 0); const b = JSON.stringify([bird.y, bird.v, pipes.map(p => [p.x, p.top]), world.playFrame]); return { same: a === b, len: a.length }; });
      check(`${tag} __flappy.step / snapshot / restore replay identically`, rep.same, JSON.stringify(rep));
      const cor = await ev(h, () => { __flappy.restore(__flappy.snapshot()); const b = __flappy.blocked(0), c2 = __flappy.corridors(0); return { b: b.length, c: c2.length, ok: Array.isArray(b) && Array.isArray(c2) }; });
      check(`${tag} __flappy.blocked()/corridors() return arrays`, cor.ok, JSON.stringify(cor));
      await h.close(); }

    // ---------- title: picker arrows, no auto-start ----------
    { const h = await open(kind);
      await tap(h, 132, 320); await tap(h, 132, 320); await tap(h, 132, 320);                  // ▶ x3
      let p = await ev(h, () => __flappy.pick); let st = await ev(h, () => state);
      check(`${tag} picker ▶ x3 from best 0: index 0->3, state still 'ready' (arrow taps never start a run)`, p.pickIdx === 3 && st === 'ready', JSON.stringify(p));
      await tap(h, 30, 320); p = await ev(h, () => __flappy.pick); st = await ev(h, () => state);
      check(`${tag} picker ◀ x1: index 3->2, still 'ready'`, p.pickIdx === 2 && st === 'ready', JSON.stringify(p));
      await ev(h, () => { for (let i = 0; i < 11; i++) __flappy.pickStep(-1); }); p = await ev(h, () => __flappy.pick);
      check(`${tag} picker wraps around at both ends (2 -11 steps -> index 2, from 0 one ◀ -> 10)`, p.pickIdx === 2, JSON.stringify(p));
      await ev(h, () => { pickIdx = 0; refreshPick(); __flappy.pickStep(-1); }); p = await ev(h, () => __flappy.pick); check(`${tag} ◀ from index 0 wraps to the last skin (10)`, p.pickIdx === 10);
      await ev(h, () => { pickIdx = 0; refreshPick(); }); 
      // swipe: left = next, right = previous, never starts a run
      await swipe(h, 220, 330, 120, 332); p = await ev(h, () => __flappy.pick); st = await ev(h, () => state);
      check(`${tag} swipe left (100 px) -> next skin (index 1), state 'ready' (a swipe is not a flap)`, p.pickIdx === 1 && st === 'ready', JSON.stringify(p) + ' ' + st);
      await swipe(h, 120, 330, 220, 330); p = await ev(h, () => __flappy.pick); st = await ev(h, () => state);
      check(`${tag} swipe right -> previous skin (index 0), still 'ready'`, p.pickIdx === 0 && st === 'ready', JSON.stringify(p));
      await swipe(h, 150, 400, 160, 380); st = await ev(h, () => state);                         // small drag (12 px): neither swipe nor tap
      check(`${tag} a 20 px drag is neither a swipe nor a tap (stays 'ready')`, st === 'ready');
      await tap(h, 220, 450); st = await ev(h, () => state);
      check(`${tag} a short tap in the middle still starts the run`, st === 'play');
      await h.close(); }

    // ---------- locked silhouette + text ----------
    { const h = await open(kind, { ls: { flappy_best: '49' } });
      await ev(h, () => { pickIdx = 0; refreshPick(); });
      for (let i = 0; i < 5; i++) await tap(h, 132, 320);                                        // 0 -> 5 (penguin, needs 50)
      const p = await ev(h, () => __flappy.pick);
      await h.page.waitForTimeout(100);
      const px = await ev(h, () => { const g = (X, Y) => { const d = x.getImageData(Math.round(X * SC), Math.round(Y * SC), 1, 1).data; return [d[0], d[1], d[2]]; }; return g(bird.x - 4, bird.y); });
      const lum = 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
      check(`${tag} Penguin at best 49: locked, text "Terbaik 50 untuk buka", silhouette pixel is dark (luminance ${lum.toFixed(0)} < 70)`, p.pickId === 'penguin' && p.locked && p.text === 'Terbaik 50 untuk buka' && lum < 70, JSON.stringify(p) + ' px ' + px);
      check(`${tag} browsing a locked skin leaves the selection on the last unlocked skin (hantu, unlocked at 25)`, p.skinId === 'hantu', p.skinId);
      await h.page.screenshot({ path: SHOTS + `locked-skin-${kind}.png` });
      await tap(h, 220, 450); const sk = await ev(h, () => ({ st: state, skin: SKIN_META[skin].id }));
      check(`${tag} starting while a locked skin is shown plays with the selected unlocked skin (hantu)`, sk.st === 'play' && sk.skin === 'hantu', JSON.stringify(sk));
      const sel = await ev(h, () => ({ a: selectSkin('penguin'), b: selectSkin('dewa'), c: selectSkin('__proto__'), id: skinId }));
      check(`${tag} selectSkin() refuses locked/unknown ids (penguin, dewa, __proto__) and keeps hantu`, !sel.a && !sel.b && !sel.c && sel.id === 'hantu', JSON.stringify(sel));
      await h.close(); }

    // ---------- selection persists across reload; forged value rejected ----------
    { const h = await open(kind);
      await tap(h, 132, 320);                                                                     // -> biru
      const before = await ev(h, () => ({ id: skinId, ls: localStorage.getItem('flappy_skin') }));
      await h.page.reload(); await h.page.waitForTimeout(250);
      const after = await ev(h, () => ({ id: skinId, ls: localStorage.getItem('flappy_skin'), pick: __flappy.pick.pickId }));
      check(`${tag} pick Biru, reload: selection kept (skinId biru, flappy_skin 'biru', picker on biru)`, before.id === 'biru' && after.id === 'biru' && after.ls === 'biru' && after.pick === 'biru', JSON.stringify([before, after]));
      await h.close();
      const f = await open(kind, { ls: { flappy_skin: 'penguin', flappy_best: '20' } });
      const fs_ = await ev(f, () => skinId); check(`${tag} forged flappy_skin='penguin' with best 20 falls back to kuning`, fs_ === 'kuning', fs_);
      await f.close(); }

    // ---------- game over: emblem + "Emas II" + "+N ke Emas III"; rank-up once; migration ----------
    { const h = await open(kind, { ls: { flappy_best: '120' }, query: '?seed=3' });
      const ok = await dieAt(h, 34);
      const pn = await ev(h, () => __flappy.panel);
      check(`${tag} game over at 34 with best 120: panel says "Emas II" and "+3 ke Emas III" (run rank, not best rank)`, ok && pn.label === 'Emas II' && pn.next === '+3 ke Emas III' && pn.tier === 4 && pn.sub === 1, JSON.stringify(pn));
      await h.page.waitForTimeout(700);
      const ink = await ev(h, () => { const L = panelLayout(), cx = Math.round((L.px + 62) * SC), cy = Math.round((L.py + 58) * SC), r = Math.round(26 * SC); const d = x.getImageData(cx - r, cy - r, 2 * r, 2 * r).data; const bg = x.getImageData(Math.round((L.px + 20) * SC), Math.round((L.py + 20) * SC), 1, 1).data; let n = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 60) n++; return { n, total: d.length / 4 }; });
      check(`${tag} the Emas emblem is actually painted on the panel (${ink.n}/${ink.total} px differ from the panel colour)`, ink.n > ink.total * 0.25, JSON.stringify(ink));
      await h.page.screenshot({ path: SHOTS + `gameover-emblem-${kind}.png` });
      const btn = await ev(h, () => { const L = panelLayout(), r = c.getBoundingClientRect(); return { hCss: L.again.h * r.height / 640, wCss: L.again.w * r.width / 360 }; });
      console.log(`  ${tag} MAIN LAGI button is ${btn.wCss.toFixed(1)} x ${btn.hCss.toFixed(1)} CSS px`);
      await h.close(); }
    { // rank-up toast: exactly once per tier, sub-levels silent
      const h = await open(kind, { ls: { flappy_best: '9' } });
      await ev(h, () => { window.__rt = []; const o = showToast; showToast = t => { window.__rt.push(t); o(t); }; });
      await dieAt(h, 10); await restart(h); await dieAt(h, 10); await restart(h); await dieAt(h, 12); await restart(h); await dieAt(h, 17);
      let rt = await ev(h, () => window.__rt.filter(t => t.startsWith('Pangkat baru')));
      check(`${tag} best 9 -> die at 10, 10, 12, 17 (Perunggu I -> III): exactly ONE rank-up toast ("Pangkat baru: Perunggu!")`, rt.length === 1 && rt[0] === 'Pangkat baru: Perunggu!', JSON.stringify(rt));
      await restart(h); await dieAt(h, 20); rt = await ev(h, () => window.__rt.filter(t => t.startsWith('Pangkat baru')));
      check(`${tag} next tier (Perak at 20) toasts once more; ranks_seen persisted (${await ev(h, () => localStorage.getItem('flappy_ranks_seen'))})`, rt.length === 2 && rt[1] === 'Pangkat baru: Perak!', JSON.stringify(rt));
      await h.page.reload(); await h.page.waitForTimeout(250);
      await ev(h, () => { window.__rt = []; const o = showToast; showToast = t => { window.__rt.push(t); o(t); }; });
      await dieAt(h, 25); const after = await ev(h, () => window.__rt.filter(t => t.startsWith('Pangkat baru')));
      check(`${tag} after reload: dying at 25 (Perak again) does not toast`, after.length === 0, JSON.stringify(after));
      await h.close(); }
    { // migration: best 200, no ranks_seen / skins_seen keys
      const h = await open(kind, { ls: { flappy_best: '200' } });
      await ev(h, () => { window.__rt = []; const o = showToast; showToast = t => { window.__rt.push(t); o(t); }; });
      const seen0 = await ev(h, () => ({ rs: localStorage.getItem('flappy_ranks_seen'), ss: localStorage.getItem('flappy_skins_seen'), t: toast && toast.text }));
      check(`${tag} migration (best 200, keys missing): ranks_seen written = 4095 (tiers 0..11), skins_seen = 1023 (10 unlocked), one title toast "${seen0.t}"`, seen0.rs === '4095' && seen0.ss === '1023' && seen0.t === '7 burung baru terbuka — geser untuk memilih', JSON.stringify(seen0));
      await dieAt(h, 150); const rt = await ev(h, () => window.__rt.filter(t => t.startsWith('Pangkat baru')));
      check(`${tag} migration: first death (Grandmaster, below best 200) shows NO rank-up toast`, rt.length === 0, JSON.stringify(rt));
      await h.page.reload(); await h.page.waitForTimeout(300);
      const t2 = await ev(h, () => toast && toast.text);
      check(`${tag} migration: the skins announcement does not repeat after reload`, !t2 || !/burung baru/.test(t2), String(t2));
      await h.close(); }

    // ---------- storage fuzz + blocked storage ----------
    for (const bad of ['abc', '-1', '1e9', '{', 'Infinity', 'null']) {
      const h = await open(kind, { ls: { flappy_best: bad, flappy_mute: bad, flappy_skin: bad, flappy_ranks_seen: bad, flappy_skins_seen: bad } });
      const v = await ev(h, () => ({ best, skinId, muted, rs: ranksSeen, ss: skinsSeen, st: state }));          // values right after boot
      await ev(h, () => flap()); await ev(h, () => { world.score = score = 3; bird.y = 600; }); const died = await waitState(h, 'dead'); await h.page.waitForTimeout(500);
      const w = await ev(h, () => ({ best, ls: localStorage.getItem('flappy_best') })); await h.close();
      check(`${tag} storage fuzz ${JSON.stringify(bad)} in all 5 keys -> boot defaults (best 0, kuning, not muted, ranks 0, skins 7), plays + dies, then saves a clean best`, v.best === 0 && v.skinId === 'kuning' && v.muted === false && v.rs === 0 && v.ss === 7 && v.st === 'ready' && died && w.best === 3 && w.ls === '3', JSON.stringify([v, w]));
    }
    { const h = await open(kind, { ls: { flappy_skin: 'zzz', flappy_best: '100' } }); const id = await ev(h, () => skinId); check(`${tag} unknown skin id 'zzz' with best 100 -> kuning`, id === 'kuning', id); await h.close(); }
    { const h = await open(kind, { block: true });
      const boot = await ev(h, () => ({ st: state, best, skinId }));
      await ev(h, () => flap()); await h.page.waitForTimeout(200); await ev(h, () => { world.score = score = 12; bird.y = 600; }); await waitState(h, 'dead'); await h.page.waitForTimeout(500);
      await restart(h); await ev(h, () => toggleMute()); const m = await ev(h, () => muted); const st = await ev(h, () => state);
      check(`${tag} localStorage access THROWS (blocked storage): game boots, plays, dies, restarts, toggles mute; progress simply not saved`, boot.st === 'ready' && boot.best === 0 && st === 'ready' && m === true, JSON.stringify([boot, st, m]));
      await h.close(); }
    { const h = await open(kind, { ls: {} });
      await h.page.evaluate(() => { Storage.prototype.setItem = function () { throw new Error('quota'); }; Storage.prototype.getItem = function () { throw new Error('boom'); }; });
      await ev(h, () => flap()); await ev(h, () => { world.score = score = 12; bird.y = 600; }); const d = await waitState(h, 'dead'); await h.page.waitForTimeout(500);
      check(`${tag} Storage.getItem/setItem throw at run time: death + rank-up + best save are swallowed`, d); await h.close(); }

    // ---------- layout: 320 px, no horizontal overflow ----------
    for (const vp of [{ width: 320, height: 568 }, { width: 320, height: 480 }]) {
      const h = await open(kind, { ls: { flappy_best: '47' }, viewport: vp, query: '?seed=11' });
      const res = {};
      const m = async name => { res[name] = await ev(h, () => { const r = c.getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: innerWidth, bw: document.body.scrollWidth, inside: r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.top >= -0.5 && r.bottom <= innerHeight + 0.5 }; }); };
      await m('title'); await ev(h, () => flap()); await h.page.waitForTimeout(150); await m('play'); await ev(h, () => pause()); await m('paused'); await ev(h, () => pause());
      await dieAt(h, 44); await m('gameover'); await h.page.screenshot({ path: SHOTS + `gameover-${vp.width}x${vp.height}-${kind}.png` });
      const geo = await ev(h, () => { const L = panelLayout(), r = c.getBoundingClientRect(), s = r.width / 360; return { panelRight: (L.px + L.pw) * s + r.left, panelLeft: L.px * s + r.left, btnR: (L.share.x + L.share.w) * s + r.left, btnL: L.again.x * s + r.left, btnH: L.again.h * s, iw: innerWidth, bot: (L.again.y + L.again.h) * s + r.top, ih: innerHeight }; });
      const ok = Object.values(res).every(r => r.sw <= r.iw && r.bw <= r.iw && r.inside) && geo.panelLeft >= 0 && geo.panelRight <= geo.iw && geo.btnL >= 0 && geo.btnR <= geo.iw && geo.bot <= geo.ih;
      check(`${tag} viewport ${vp.width}x${vp.height}: title/play/paused/game-over -> scrollWidth <= innerWidth, canvas + panel + buttons inside the viewport`, ok, JSON.stringify({ res, geo }));
      console.log(`  ${tag} ${vp.width}x${vp.height}: scrollWidth ${res.gameover.sw} <= ${res.gameover.iw}; tap targets ${geo.btnH.toFixed(1)} CSS px high`);
      await h.close(); }

    // ---------- emblems: 14 distinct, painted, repainted at the new scale ----------
    { const h = await open(kind);
      const em = await ev(h, () => { const hs = [], counts = []; for (let t = 0; t < 14; t++) { const cv = getEmblem(t), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 20) n++; counts.push(n / (cv.width * cv.height)); hs.push(cv.toDataURL().length + ':' + cv.toDataURL().slice(-60)); } return { distinct: new Set(hs).size, min: Math.min(...counts), max: Math.max(...counts), size: getEmblem(0).width, SC, cached: emblemCache.filter(Boolean).length }; });
      check(`${tag} 14 emblems: all distinct, each covers ${(em.min * 100).toFixed(0)}..${(em.max * 100).toFixed(0)}% of its tile, tile ${em.size}px = ceil(64*${em.SC.toFixed(2)})`, em.distinct === 14 && em.min > 0.2 && em.size === Math.ceil(64 * em.SC), JSON.stringify(em));
      await h.page.setViewportSize({ width: 300, height: 500 }); await h.page.waitForTimeout(300);
      const em2 = await ev(h, () => ({ cached: emblemCache.filter(Boolean).length, SC, size: getEmblem(0).width }));
      check(`${tag} emblem cache is cleared when SC changes and repainted at the new size (cached 14 -> ${em2.cached} then tile ${em2.size}px)`, em2.cached <= 1 && em2.size === Math.ceil(64 * em2.SC), JSON.stringify(em2));
      await h.close(); }

    // ---------- title screenshot + 10 s bot run (frame times, errors, speed of play) ----------
    { const h = await open(kind, { ls: { flappy_best: '120' }, query: '?seed=5' });
      await h.page.waitForTimeout(500);
      await h.page.screenshot({ path: SHOTS + `title-picker-${kind}.png` }); await h.close(); }
    { const h = await open(kind, { query: '?seed=21&bot=1' });
      await h.page.evaluate(() => { window.__ft = []; let l = performance.now(); const f = n => { window.__ft.push(n - l); l = n; requestAnimationFrame(f); }; requestAnimationFrame(f); });
      await h.page.waitForTimeout(10000);
      const r = await ev(h, () => { const a = window.__ft.slice(5); a.sort((x, y) => x - y); return { n: a.length, max: a[a.length - 1], p50: a[a.length >> 1], over32: a.filter(v => v > 32).length, score, state }; });
      console.log(`  ${tag} ?bot=1 10 s real time: ${r.n} frames, p50 ${r.p50.toFixed(1)} ms, max ${r.max.toFixed(1)} ms, >32 ms: ${r.over32}, score ${r.score}, state ${r.state} (headless software rendering; informational)`);
      check(`${tag} ?bot=1 plays by itself for 10 s of real time (alive, score ${r.score} >= 3)`, r.state === 'play' && r.score >= 3, JSON.stringify(r));
      await h.close(); }
    { const h = await open(kind, { query: '?seed=33&bot=1' });          // fast-forward the real shell (update() x N) so slide/double/narrow are drawn too
      const r = await ev(h, () => { __flappy.step(60); const seen = {}; let f = 0; while (f < 40000 && state === 'play') { __flappy.step(100); f += 100; for (const p of pipes) seen[p.type] = 1; } return { f, score, state, seen: Object.keys(seen).join('+') }; });
      await h.page.waitForTimeout(300);
      await h.page.screenshot({ path: SHOTS + `bot-ff-${kind}.png` });
      check(`${tag} real shell + bot, fast-forwarded: reached score ${r.score} in ${r.f} frames (${r.state}); obstacle types met: ${r.seen}`, r.score >= 40 && /slide/.test(r.seen) && /double/.test(r.seen) && /narrow/.test(r.seen), JSON.stringify(r));
      await h.close(); }
  }
  const external = requests.filter(u => !/^(file:|data:|about:|blob:)/.test(u));
  check(`zero external requests across all gate runs (${requests.length} requests, all file:/data:)`, external.length === 0, external.slice(0, 3).join(' '));
  check(`0 console errors / page errors across all gate runs (desktop + iPhone 12)`, allErrors.length === 0, allErrors.slice(0, 5).join(' | '));
  await browser.close();
}
