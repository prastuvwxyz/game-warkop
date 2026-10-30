// Tinju Kata 2.1 end-screen run: a full 10-player match through the real server, TWO real browsers (host + second player)
// plus 8 bot sockets, one of whom leaves mid-match (walkover row). Checked per device on the end screen:
// 10 standings rows, own row highlighted, the list scrolls INSIDE the card, Rematch fully in the viewport and not covered,
// no horizontal overflow, 0 console errors, 0 foreign requests. Screenshots: tests/evidence/end-<device>.png
//   node tests/e2e/look-end.mjs [basePort=3800]       DEVICES="iPhone 12,320x480" to pick
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
const base = Number(process.argv[2] || 3800);
if (base < 3300 || [3100, 3200].some(p => base <= p && p <= base + 5)) { console.error('use a port >= 3300, not 3100/3200'); process.exit(2); }
const browser = await launchBrowser();
let fail = 0, n = 0;

for (const name of wanted) {
  const port = base + n++;
  const server = spawn(process.execPath, [path.join(HERE, '..', '..', 'server', 'server.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1',
    TK_COUNTDOWN_MS: 400, TK_RESULT_MS: 300, TK_LINK_MS: 20, TK_TITLE_MS: 50, TK_HP: 60, TK_SEED: 5 }, stdio: 'ignore' });
  const url = `http://127.0.0.1:${port}/tinju/`;
  for (let i = 0; i < 50; i++) { try { await fetch(url); break; } catch { await sleep(100); } }
  const host = new URL(url).host, wsUrl = `ws://${host}/tinju/ws`;
  const errors = [], foreign = [];
  const open = async (profile, who) => {
    const ctx = await browser.newContext(profile), page = await ctx.newPage();
    page.on('pageerror', e => errors.push(who + ': ' + e.message)); page.on('console', m => m.type() === 'error' && errors.push(who + ': ' + m.text()));
    page.on('request', r => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.host !== host) foreign.push(r.url()); });
    page.on('dialog', d => d.accept());
    await page.goto(url); await page.waitForFunction(() => window.__tinju && window.__tinju.art, null, { timeout: 8000 }).catch(() => {});
    return { ctx, page };
  };
  const A = await open(PROFILES[name], 'A'), B = await open(PROFILES.desktop, 'B');
  await A.page.fill('#name', 'Host'); await A.page.click('#btnCreate'); await A.page.waitForSelector('#scr-lobby.active');
  const code = (await A.page.textContent('#lobbyCode')).trim();
  await B.page.fill('#name', 'Kedua'); await B.page.fill('#joinCode', code); await B.page.click('#btnJoin'); await B.page.waitForSelector('#scr-lobby.active');
  const socks = [];
  for (let i = 0; i < 8; i++) {
    const ws = new WebSocket(wsUrl); socks.push(ws);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', code, name: 'Bot' + (i + 1) + (i === 3 ? '-nama-panjang-sekali' : ''), skin: i % 4, v: 2 }));
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.t === 'line' && m.entrant) setTimeout(() => { try { ws.send(JSON.stringify({ t: 'done', round: m.round, elapsed: 900 + i * 260, typos: 0 })); } catch (e) {} }, 100 + i * 20);
      if (m.t === 'line' && i === 7 && m.round === 2) setTimeout(() => { try { ws.send(JSON.stringify({ t: 'leave' })); } catch (e) {} }, 60); }; // walkover in round 2
  }
  await A.page.waitForFunction(() => __tinju.state && __tinju.state.players.length === 10, null, { timeout: 8000 });
  // the two browsers answer every line through the game's own send (what typing ends in), mid-pack elapsed
  for (const [pg, el] of [[A.page, 1500], [B.page, 2300]]) await pg.evaluate(el => { setInterval(() => { const t = __tinju, s = t.state; if (!s || s.state !== 'line' || !t.line) return;
    const m = s.players.find(p => p.id === t.me); if (!m || m.out !== null || t.__d === t.line.round) return; t.__d = t.line.round; t.send({ t: 'done', round: t.line.round, elapsed: el, typos: 0 }); }, 60); }, el);
  await A.page.click('#btnStart');
  await A.page.waitForFunction(() => __tinju.state.state === 'ended', null, { timeout: 150000 });
  await sleep(500);
  const r = await A.page.evaluate(() => {
    const q = s => document.querySelector(s), list = q('#standings'), btn = q('#btnRematch'), card = q('#endCard'), lr = list.getBoundingClientRect(), br = btn.getBoundingClientRect(), cr = card.getBoundingClientRect();
    const mid = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2);
    return { rows: list.children.length, own: list.querySelectorAll('li.me').length, scrolls: list.scrollHeight > list.clientHeight, listOverBtn: lr.bottom > br.top + 0.5,
      btnInView: br.top >= 0 && br.bottom <= innerHeight && br.left >= 0 && br.right <= innerWidth, btnTop: !!mid && (mid === btn || btn.contains(mid)), overflowX: document.documentElement.scrollWidth > innerWidth,
      cardInView: cr.bottom <= innerHeight + 0.5, vh: innerHeight, places: [...list.children].map(li => li.querySelector('.pl').textContent + ' ' + li.querySelector('.nm').textContent + ' · ' + li.querySelector('.ft').textContent),
      sameAsServer: JSON.stringify(__tinju.state.standings.map(x => x.place)) === JSON.stringify([...list.children].map(li => Number(li.querySelector('.pl').textContent))) };
  });
  const dev = name.replace(/\W+/g, '-').toLowerCase();
  await A.page.screenshot({ path: path.join(OUT, `end-${dev}.png`) });
  if (name !== 'desktop') { await A.page.evaluate(() => { document.getElementById('standings').scrollTop = 1e6; }); await A.page.screenshot({ path: path.join(OUT, `end-${dev}-scrolled.png`) }); }
  const ok = r.rows === 10 && r.own === 1 && !r.listOverBtn && r.btnInView && r.btnTop && !r.overflowX && r.sameAsServer && errors.length === 0 && foreign.length === 0
    && r.places.some(s => /keluar ronde 2/.test(s)) && r.places.some(s => /KO ronde/.test(s));
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: rows ${r.rows} · own row ${r.own} · list scrolls inside card ${r.scrolls} · list overlaps Rematch ${r.listOverBtn} · Rematch in viewport ${r.btnInView}, topmost ${r.btnTop} · overflowX ${r.overflowX} · places match server ${r.sameAsServer} · console errors ${errors.length} · external requests ${foreign.length}${errors.length ? ' · ' + errors.slice(0, 3).join(' | ') : ''}\n   ${r.places.join('\n   ')}`);
  socks.forEach(w => { try { w.close(); } catch (e) {} });
  await A.ctx.close(); await B.ctx.close(); server.kill();
}
await browser.close();
console.log(`look-end: ${wanted.length - fail}/${wanted.length} pass · screenshots in ${OUT}`);
process.exit(fail ? 1 : 0);
