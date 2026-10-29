import { createRequire } from 'node:module'; import { spawn } from 'node:child_process';
const pw = createRequire('/home/prastuvwxyz/.nalar/workspaces/stella/bullscows/node_modules/x.js')('playwright');
const srv = spawn(process.execPath, ['/tmp/ana-g2/A/games/tinju/server/server.js'], { env: { PATH: process.env.PATH, PORT: '3495', HOST: '127.0.0.1', TK_COUNTDOWN_MS: '700', TK_HP: '100000' }, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));
const b = await pw.chromium.launch({ executablePath: '/home/prastuvwxyz/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell' });
const mk = async d => { const c = await b.newContext(d); const p = await c.newPage(); await p.goto('http://127.0.0.1:3495/tinju/'); return p; };
const ph = await mk(pw.devices['iPhone 12']), d1 = await mk({ viewport: { width: 1280, height: 800 } });
await ph.fill('#name', 'Ph'); await ph.click('#btnCreate'); await ph.waitForFunction(() => window.__tinju.state && window.__tinju.state.code);
const code = await ph.evaluate(() => window.__tinju.state.code);
await d1.goto('http://127.0.0.1:3495/tinju/?room=' + code); await d1.fill('#name', 'D1'); await d1.click('#btnJoin');
await ph.waitForFunction(() => window.__tinju.state.players.length === 2); await ph.click('#btnStart');
await ph.waitForFunction(() => window.__tinju.state.state === 'line' && window.__tinju.line, null, { timeout: 8000 });
await new Promise(r => setTimeout(r, 150));

const st = async tag => console.log(tag, JSON.stringify(await ph.evaluate(() => ({ a: document.activeElement.id || document.activeElement.tagName, hint: document.getElementById('focusHint').classList.contains('on') }))));
await st('auto-focused at reveal:');
await ph.evaluate(() => document.getElementById('typer').blur()); await new Promise(r => setTimeout(r, 120)); await st('after blur:');
for (let k = 1; k <= 3; k++) { await ph.tap('#linebox'); await new Promise(r => setTimeout(r, 120)); await st('after tap #linebox #' + k + ':'); }
await ph.tap('#line'); await new Promise(r => setTimeout(r, 120)); await st('after tap #line:');
await ph.tap('#focusHint').catch(e => console.log('focusHint tap err', e.message.split('\n')[0])); await new Promise(r => setTimeout(r, 120)); await st('after tap #focusHint:');
await ph.keyboard.type('k'); await new Promise(r => setTimeout(r, 100)); console.log('typing after hint', JSON.stringify(await ph.evaluate(() => window.__tinju.typing)));
await d1.waitForFunction(() => window.__tinju.state.state === 'line'); await d1.evaluate(() => document.getElementById('typer').blur()); await d1.click('#linebox'); await new Promise(r => setTimeout(r, 120));
console.log('desktop click #linebox ->', await d1.evaluate(() => document.activeElement.id || document.activeElement.tagName));
const av = await d1.evaluate(() => [...document.querySelectorAll('#avatars, #avatars *')].flatMap(e => e.getAnimations().filter(a => a.playState === 'running').map(a => ({ el: e.tagName + '.' + e.className, name: a.animationName || a.transitionProperty || a.constructor.name, dur: a.effect && a.effect.getTiming().duration, it: a.effect && a.effect.getTiming().iterations }))));
console.log('avatar anims', JSON.stringify(av));
await b.close(); srv.kill();
