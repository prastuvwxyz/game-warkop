// Look-at-it run for a multiplayer game (skill game-build Step 6): open the lobby on three devices,
// keep a screenshot each, and fail on any console error, request to another host, or missing version meta.
//   node tools/look-multiplayer.mjs <slug>                    # starts games/<slug>/server/server.js on a free port
//   GAME_URL=https://nalar.prastya.net/<slug>/ DEVICES="iPhone 12" node tools/look-multiplayer.mjs <slug>
import { chromium, devices } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const slug = process.argv[2];
if (!slug) { console.error('usage: node tools/look-multiplayer.mjs <slug>'); process.exit(2); }
const GAME = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../games', slug);
const OUT = path.join(GAME, 'tests/evidence'); fs.mkdirSync(OUT, { recursive: true });
const PROFILES = {
  'desktop': { viewport: { width: 1280, height: 800 } },
  'iPhone 12': devices['iPhone 12'],
  '320': { viewport: { width: 320, height: 568 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};
const wanted = (process.env.DEVICES || Object.keys(PROFILES).join(',')).split(',').map((s) => s.trim());

let server, url = process.env.GAME_URL;
if (!url) {
  const port = 3300 + Math.floor(Math.random() * 600);
  server = spawn(process.execPath, [path.join(GAME, 'server/server.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' });
  url = `http://127.0.0.1:${port}/${slug}/`;
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
  const res = await page.goto(url);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/look-${name.replace(/\W+/g, '-').toLowerCase()}.png` });
  const version = await page.evaluate((s) => document.querySelector(`meta[name="${s}-version"]`)?.content, slug);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const ok = res.status() === 200 && version && !overflow && errors.length === 0 && foreign.length === 0;
  if (!ok) fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: HTTP ${res.status()} · version ${version} · horizontal overflow ${overflow} · console errors ${errors.length} · external requests ${foreign.length}${errors.length ? ' · ' + errors.join(' | ') : ''}${foreign.length ? ' · ' + foreign.join(' ') : ''}`);
  await ctx.close();
}
await browser.close(); server?.kill();
console.log(`look: ${wanted.length - fail}/${wanted.length} pass · screenshots in ${OUT}`);
process.exit(fail ? 1 : 0);
