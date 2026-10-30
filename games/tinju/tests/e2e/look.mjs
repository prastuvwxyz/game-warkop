// Tinju Kata 2.0 look-at-it run (skill game-build Step 6): a real browser is the host of a 10-player room (9 bot sockets fill
// the other seats), plays rounds, and is checked on: desktop 1280x800, iPhone 12, 320x480.
//   node tests/e2e/look.mjs                         # starts games/tinju/server/server.js on a free port >= 3700
//   GAME_URL=https://nalar.prastya.net/tinju/ DEVICES="iPhone 12" node tests/e2e/look.mjs
// Per device: 0 console/page errors, 0 requests to another host, version meta 2.0.0, no horizontal overflow, 9 avatars in
// the row with HP bars, B1 (whole line box inside the viewport at every line), frame gaps during the domino (4x CPU throttle on mobile).
// Screenshots: tests/evidence/look-<device>-{home,lobby10,line,domino}.png
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { launchBrowser, devices, sleep } from '../test-lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'evidence'); fs.mkdirSync(OUT, { recursive: true });
const PROFILES = {
  'desktop': { viewport: { width: 1280, height: 800 } },
  'iPhone 12': { ...devices()['iPhone 12'] },
  '320x480': { viewport: { width: 320, height: 480 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const wanted = (process.env.DEVICES || Object.keys(PROFILES).join(',')).split(',').map(s => s.trim());
let server, url = process.env.GAME_URL;
if (!url) {
  const port = 3700 + Math.floor(Math.random() * 200);
  server = spawn(process.execPath, [path.join(HERE, '..', '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TK_COUNTDOWN_MS: 900, TK_RESULT_MS: 1000, TK_HP: 400 }, stdio: 'ignore' });
  url = `http://127.0.0.1:${port}/tinju/`;
  for (let i = 0; i < 50; i++) { try { await fetch(url); break; } catch { await sleep(100); } }
}
const host = new URL(url).host, wsUrl = (url.startsWith('https') ? 'wss://' : 'ws://') + host + new URL(url).pathname.replace(/\/?$/, '/') + 'ws';
const browser = await launchBrowser();
let fail = 0;

function bots(code, n) { // n bot sockets that join and finish every round at staggered times
  const socks = [];
  for (let i = 0; i < n; i++) {
    const ws = new WebSocket(wsUrl); socks.push(ws);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', code, name: 'Bot' + (i + 1), skin: i % 4, v: 2 }));
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.t === 'line' && m.entrant) setTimeout(() => { try { ws.send(JSON.stringify({ t: 'done', round: m.round, elapsed: 900 + i * 260, typos: 0 })); } catch (e) {} }, 500 + i * 120); };
  }
  return socks;
}

for (const name of wanted) {
  const ctx = await browser.newContext(PROFILES[name]); const page = await ctx.newPage();
  const errors = [], foreign = [], notes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('request', r => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.host !== host) foreign.push(r.url()); });
  page.on('dialog', d => d.accept());
  const res = await page.goto(url);
  await page.waitForFunction(() => window.__tinju && window.__tinju.art, null, { timeout: 8000 }).catch(() => {});
  const shot = n => page.screenshot({ path: path.join(OUT, `look-${name.replace(/\W+/g, '-').toLowerCase()}-${n}.png`) });
  const version = await page.evaluate(() => document.querySelector('meta[name="tinju-version"]')?.content);
  await shot('home');
  const ovHome = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  await page.fill('#name', 'Host'); await page.click('#btnCreate'); await page.waitForSelector('#scr-lobby.active');
  const code = (await page.textContent('#lobbyCode')).trim();
  const bs = bots(code, 9);
  await page.waitForFunction(() => __tinju.state && __tinju.state.players.length === 10, null, { timeout: 8000 });
  await sleep(250); await shot('lobby10');
  const ovLobby = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const lobbyRows = await page.locator('#lobbyPlayers .pl').count();
  const cdp = await ctx.newCDPSession(page).catch(() => null);
  if (cdp && name !== 'desktop') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }).catch(() => {});
  await page.click('#btnStart');
  let b1 = { n: 0, bad: 0 }, avatars = 0, maxGap = 0, frames = 0, ovGame = false, domino = false;
  await page.evaluate(() => { window.__gaps = []; let last = performance.now(); (function f(t) { window.__gaps.push(Math.round(t - last)); last = t; requestAnimationFrame(f); })(last); });
  for (let round = 1; round <= 3; round++) {
    await page.waitForFunction(r => __tinju.line && __tinju.line.round >= r && __tinju.state.state === 'line', round, { timeout: 15000 });
    const r = await page.evaluate(() => { const b = document.getElementById('linebox').getBoundingClientRect(); return { top: b.top, bottom: b.bottom, vh: innerHeight, h: b.height, text: __tinju.line.text, rounds: __tinju.line.round }; });
    b1.n++; if (!(r.h > 0 && r.top >= -0.5 && r.bottom <= r.vh + 0.5)) { b1.bad++; notes.push('B1 round ' + round + ' ' + JSON.stringify(r)); }
    if (round === 1) { await shot('line'); avatars = await page.locator('#avatars .av').count(); ovGame = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth); }
    await page.evaluate(() => document.getElementById('typer').focus()); await page.keyboard.type(r.text, { delay: 30 });
    if (round === 2) {
      await page.waitForFunction(() => __tinju.playing, null, { timeout: 15000 });
      await sleep(900); await shot('domino'); domino = await page.evaluate(() => __tinju.log.filter(l => l.ev === 'link').length > 0 || __tinju.lastResult.chain.length > 0);
      await page.evaluate(() => { window.__gaps.length = 0; }); await sleep(1500);
      const g = await page.evaluate(() => window.__gaps.slice()); frames = g.length; maxGap = Math.max(...g);
    }
    await page.waitForFunction(r => __tinju.lastResult && __tinju.lastResult.round >= r, round, { timeout: 25000 });
  }
  const gaps = await page.evaluate(() => window.__gaps.slice().sort((a, b) => a - b)); const p95 = gaps.length ? gaps[Math.floor(gaps.length * .95)] : 0;
  const ok = res.status() === 200 && version === '2.0.0' && !ovHome && !ovLobby && !ovGame && lobbyRows === 10 && avatars === 9 && b1.bad === 0 && domino && errors.length === 0 && foreign.length === 0;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: HTTP ${res.status()} · version ${version} · overflow home/lobby/game ${ovHome}/${ovLobby}/${ovGame} · lobby rows ${lobbyRows} · avatars ${avatars} · B1 ${b1.n - b1.bad}/${b1.n} · domino ${domino} · frames ${frames}, max gap ${maxGap} ms, p95 ${p95} ms (informational, software rendering${name !== 'desktop' ? ', 4x CPU throttle' : ''}) · console errors ${errors.length} · external requests ${foreign.length}${errors.length ? ' · ' + errors.slice(0, 3).join(' | ') : ''}${foreign.length ? ' · ' + foreign.slice(0, 3).join(' ') : ''}${notes.length ? ' · ' + notes.join(' ; ') : ''}`);
  bs.forEach(w => { try { w.close(); } catch (e) {} });
  await ctx.close();
}
await browser.close(); server?.kill();
console.log(`look: ${wanted.length - fail}/${wanted.length} pass · screenshots in ${OUT}`);
process.exit(fail ? 1 : 0);
