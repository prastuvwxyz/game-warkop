// Look-at-it run (skill game-build Step 6): open the game on three devices, let the bot play,
// keep screenshots, and fail on any console error or request to another host.
//   node games/flappy/tests/e2e/look.mjs                      # serves the repo itself
//   GAME_URL=https://nalar.prastya.net/flappy/ DEVICES="iPhone 12" node games/flappy/tests/e2e/look.mjs
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.resolve(HERE, '../evidence'); fs.mkdirSync(OUT, { recursive: true });
const PROFILES = {
  'desktop': { viewport: { width: 1280, height: 800 } },
  'iPhone 12': devices['iPhone 12'],
  '320': { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const wanted = (process.env.DEVICES || Object.keys(PROFILES).join(',')).split(',').map((s) => s.trim());

let server, url = process.env.GAME_URL;
if (!url) {
  const port = 3300 + Math.floor(Math.random() * 600);
  server = spawn(process.execPath, [path.resolve(HERE, '../../../../tools/serve.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  url = `http://127.0.0.1:${port}/flappy/`;
  for (let i = 0; i < 50; i++) { try { await fetch(url); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
}
const host = new URL(url).host;
const browser = await chromium.launch();
let fail = 0;
for (const name of wanted) {
  const ctx = await browser.newContext(PROFILES[name]); const page = await ctx.newPage();
  const errors = [], foreign = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.host !== host) foreign.push(r.url()); });
  await page.goto(url + '?seed=1&bot=1');
  const tag = name.replace(/\W+/g, '-').toLowerCase();
  await page.waitForTimeout(600); await page.screenshot({ path: `${OUT}/${tag}-start.png` });
  await page.waitForTimeout(4000); await page.screenshot({ path: `${OUT}/${tag}-mid.png` });
  const info = await page.evaluate(() => ({ version: document.querySelector('meta[name="flappy-version"]')?.content, hook: typeof window.__flappy, score: window.__flappy?.score }));
  const ok = errors.length === 0 && foreign.length === 0 && info.hook === 'object';
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: version ${info.version} · score ${info.score} · console errors ${errors.length} · external requests ${foreign.length}${errors.length ? ' · ' + errors.join(' | ') : ''}${foreign.length ? ' · ' + foreign.join(' ') : ''}`);
  await ctx.close();
}
await browser.close(); server?.kill();
console.log(`look: ${wanted.length - fail}/${wanted.length} pass · screenshots in ${OUT}`);
process.exit(fail ? 1 : 0);
