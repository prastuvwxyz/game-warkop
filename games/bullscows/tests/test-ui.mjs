// UI test with Playwright (2 browsers). Usage: NODE_PATH=./node_modules node test-ui.mjs http://127.0.0.1:3100/bullscows/
import { chromium, devices } from 'playwright';
const URL = process.argv[2] || 'http://127.0.0.1:3100/bullscows/';
let pass = 0, failN = 0; const check = (n, ok, x='') => { ok ? pass++ : failN++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (ok ? '' : '  ' + x)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await chromium.launch();
const errors = [];
const ctxA = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const ctxB = await browser.newContext({ ...devices['iPhone 12'] });
const A = await ctxA.newPage(), B = await ctxB.newPage();
for (const [n, p] of [['A', A], ['B', B]]) { p.on('pageerror', e => errors.push(n + ': ' + e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(n + ' console: ' + m.text()); }); }
const st = p => p.evaluate(() => window.__bc.state);
const meId = p => p.evaluate(() => window.__bc.me);
const screen = p => p.evaluate(() => document.querySelector('.screen.active').id);
const typeNum = async (p, padId, num) => { for (const d of num) await p.click(`#${padId} [data-k="${d}"]`); await p.click(`#${padId} [data-k="ok"]`); };

await A.goto(URL); await sleep(300);
check('A home screen, connected dot on', (await screen(A)) === 'scr-home' && await A.$eval('#connDot', e => e.classList.contains('on')));
await A.fill('#name', 'Pras'); await A.click('#btnCreate'); await A.waitForSelector('#scr-lobby.active');
const code = (await A.textContent('#lobbyCode')).trim();
check('A created room, code shown', /^[A-Z2-9]{5}$/.test(code), code);
check('A start button disabled, hint says waiting', await A.$eval('#btnStart', b => b.disabled) && /Menunggu pemain/.test(await A.textContent('#startHint')));
await B.goto(URL + '?room=' + code.toLowerCase()); await sleep(300);
check('B: ?room= prefills code (uppercased)', (await B.inputValue('#joinCode')) === code);
await B.fill('#name', 'Budi'); await B.press('#name', 'Enter'); await B.waitForSelector('#scr-lobby.active');
check('B joined lobby via Enter', (await st(B)).players.length === 2);
await A.waitForFunction(() => window.__bc.state.players.length === 2);
check('A sees 2 players, Budi listed, kick button visible for host', (await A.textContent('#lobbyPlayers')).includes('Budi') && !!(await A.$('[data-kick]')));
check('B (non-host) has no start button & no kick', await B.$eval('#btnStart', b => b.style.display === 'none') && !(await B.$('[data-kick]')));
// secret via keypad; repeated digit button disabled
await A.click('#secretPad [data-k="3"]');
check('digit 3 disabled after use', await A.$eval('#secretPad [data-k="3"]', b => b.disabled));
await A.click('#secretPad [data-k="6"]'); await A.click('#secretPad [data-k="5"]'); await A.click('#secretPad [data-k="7"]');
check('ok enabled at 4 digits; digits disabled', await A.$eval('#secretPad [data-k="ok"]', b => !b.disabled) && await A.$eval('#secretPad [data-k="1"]', b => b.disabled));
await A.click('#secretPad [data-k="ok"]'); await A.waitForFunction(() => window.__bc.state.you.secret === '3657');
check('A secret 3657 set, tiles show it', (await A.textContent('#secretTiles')).replace(/\s/g, '') === '3657');
// B uses physical keyboard
await B.keyboard.type('0123'); await B.keyboard.press('Enter'); await B.waitForFunction(() => window.__bc.state.you.secret === '0123');
check('B secret 0123 set via keyboard', true);
await A.waitForFunction(() => !document.getElementById('btnStart').disabled);
check('A start enabled when all ready', true);
await A.screenshot({ path: 'shot-lobby.png' });
await A.click('#btnStart'); await A.waitForSelector('#scr-game.active'); await B.waitForSelector('#scr-game.active');
let S = await st(A); const aId = await meId(A), bId = await meId(B);
let cur = S.turn === aId ? A : B, oth = cur === A ? B : A; const curSecret = S.turn === aId ? '3657' : '0123', othSecret = cur === A ? '0123' : '3657';
check('game screen: banner says Giliranmu on current, other says Giliran X…', /Giliranmu/.test(await cur.textContent('#turnBanner')) && /^Giliran /.test((await oth.textContent('#turnBanner')).trim()) && !/Giliranmu/.test(await oth.textContent('#turnBanner')));
check('keypad disabled for non-turn player', await oth.$eval('#guessPad [data-k="1"]', b => b.disabled));
check('timer bar visible', await cur.$eval('#timerBar', e => parseFloat(e.style.width) > 80));
const g1 = othSecret === '3657' ? '1234' : '3210';
await typeNum(cur, 'guessPad', g1);
await oth.waitForFunction(() => window.__bc.state.history.filter(e => e.type === 'guess').length === 1); await cur.waitForFunction(() => document.querySelectorAll('#board .gl .tile').length === 4);
const tilesCur = await cur.$$eval('#board .gl .tile', ts => ts.map(t => t.className.replace(/tile|sm|flip|win|\s/g, '')).join(''));
const tilesOth = await oth.$$eval('#againstMe .gl .tile', ts => ts.map(t => t.className.replace(/tile|sm|flip|win|\s/g, '')).join(''));
const bgs = await cur.$$eval('#board .gl .tile', ts => ts.map(t => getComputedStyle(t).backgroundColor));
check('tile computed backgrounds are green/yellow/grey palette', bgs.every(c => ['rgb(61, 150, 104)', 'rgb(240, 194, 90)', 'rgb(213, 220, 214)'].includes(c)), bgs.join(','));
check('guess tiles colored on guesser board (' + g1 + ')', tilesCur === (othSecret === '3657' ? 'xxyx' : 'yyyy'), tilesCur);
check('same colored tiles shown on target "Tebakan ke kamu"', tilesOth === tilesCur, tilesOth);
check('new guess row gets flip animation on both boards (4 tiles each)', (await cur.$$eval('#board .gl .tile.flip', ts => ts.length)) === 4 && (await oth.$$eval('#againstMe .gl .tile.flip', ts => ts.length)) === 4);
check('newest row marked .latest', await cur.$eval('#board .gl:last-child', e => e.classList.contains('latest')));
const expKeys = othSecret === '3657' ? { '1': 'kx', '2': 'kx', '3': 'ky', '4': 'kx' } : { '3': 'ky', '2': 'ky', '1': 'ky', '0': 'ky' };
const keyCls = await cur.$$eval('#guessPad [data-k]', bs => Object.fromEntries(bs.map(b => [b.dataset.k, b.className])));
check('keypad coloured from knowledge (green>yellow>grey) for current target', Object.entries(expKeys).every(([d, c]) => keyCls[d].includes(c)) && !/k[gyx]/.test(keyCls['5'] || ''), JSON.stringify(keyCls));
await sleep(1300);
const bgsAfter = await cur.$$eval('#board .gl .tile', ts => ts.map(t => getComputedStyle(t).backgroundColor));
check('after flip finishes, backgrounds unchanged (palette)', bgsAfter.join(',') === bgs.join(','), bgsAfter.join(','));
const maskOp = await cur.$$eval('#board .gl .tile.flip', ts => ts.map(t => getComputedStyle(t, '::before').opacity));
check('flip mask fully hidden after animation', maskOp.every(o => o === '0'), maskOp.join(','));
await cur.evaluate(() => window.__bc.send({ t: 'guess', target: 'nope', guess: '1234' }));
await cur.waitForFunction(() => document.getElementById('guessTiles').classList.contains('shake'), null, { timeout: 2000 }).then(() => check('rejected guess shakes the input tiles', true), () => check('rejected guess shakes the input tiles', false));
await cur.waitForFunction(() => !document.getElementById('guessTiles').classList.contains('shake'), null, { timeout: 2000 }).then(() => check('shake class removed after animation', true), () => check('shake class removed after animation', false));
await oth.click('#guessPad [data-k="7"]');
check('typing a digit pops the new tile only', await oth.$$eval('#guessTiles .tile', ts => ts.filter(t => t.classList.contains('pop')).length === 1 && ts[0].classList.contains('pop')));
await oth.click('#guessPad [data-k="del"]');

check('turn passed: other now sees Giliranmu', /Giliranmu/.test(await oth.textContent('#turnBanner')));
check('log shows guess line', /hijau/.test(await oth.textContent('#log')));
await cur.screenshot({ path: 'shot-game-desktop.png' }); await B.screenshot({ path: 'shot-game-mobile.png', fullPage: true });
// reconnect: reload the non-turn player, state restored
await cur.reload(); await cur.waitForSelector('#scr-game.active', { timeout: 5000 });
check('reload → rejoin restores game screen and secret', (await st(cur)).you.secret === curSecret);
// other guesses wrong, then cur cracks
await typeNum(oth, 'guessPad', curSecret === '3657' ? '9876' : '9876');
await cur.waitForFunction(id => window.__bc.state.turn === id, await meId(cur));
await typeNum(cur, 'guessPad', othSecret);
await cur.waitForSelector('#scr-end.active'); await oth.waitForSelector('#scr-end.active');
check('end screen: winner text correct both sides', /Kamu menang/.test(await cur.textContent('#winnerName')) && /menang/.test(await oth.textContent('#winnerName')) && !/Kamu/.test(await oth.textContent('#winnerName')));
check('end screen reveals both secrets', (await oth.textContent('#reveal')).replace(/\s/g, '').includes('3657') && (await oth.textContent('#reveal')).replace(/\s/g, '').includes('0123'));
await cur.screenshot({ path: 'shot-end.png' });
// play again (host = A)
check('Main lagi only for host', await A.$eval('#btnAgain', b => b.style.display !== 'none') && await B.$eval('#btnAgain', b => b.style.display === 'none'));
await A.click('#btnAgain'); await A.waitForSelector('#scr-lobby.active'); await B.waitForSelector('#scr-lobby.active');
check('restart → both in lobby, secrets cleared', (await st(B)).you.secret === null && (await B.textContent('#secretTiles')).replace(/\s/g, '') === '');
// leave
await B.click('#btnLeaveLobby'); await B.waitForSelector('#scr-home.active');
await A.waitForFunction(() => window.__bc.state.players.length === 1);
check('B leave → home; A sees 1 player', true);
check('B localStorage session cleared', (await B.evaluate(() => localStorage.getItem('bc_sess'))) === null);
// join nonexistent → toast
// wait for this toast's text: the music hint toast (2.2 s, shown once the game started) may still be up
await B.fill('#joinCode', 'ZZZZZ'); await B.click('#btnJoin');
check('join bad code → toast error', await B.waitForFunction(() => /tidak ditemukan/.test(document.querySelector('.toast.show')?.textContent || ''), null, { timeout: 5000 }).then(() => true, () => false));
// viewport fit 320
const C = await (await browser.newContext({ viewport: { width: 320, height: 568 } })).newPage(); await C.goto(URL); await sleep(200);
check('320px: no horizontal overflow', await C.evaluate(() => document.documentElement.scrollWidth <= 320));
check('0 page errors / console errors', errors.length === 0, errors.join(' | '));
console.log(`\n${pass} passed, ${failN} failed`); await browser.close(); process.exit(failN ? 1 : 0);
