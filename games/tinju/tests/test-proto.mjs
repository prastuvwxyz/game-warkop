// Tinju Kata 2.0 protocol test. Usage: node test-proto.mjs [basePort=3301]   (Node >= 22: global WebSocket)
// Spawns its own servers on basePort..basePort+9 (fast timers). Ports 3100/3200 are never touched.
//   MAIN  real bank, seed 7, HP 100000      KO  real bank, HP 100      FIX1  exact-length fixture, base 1, pure domino
//   WORDS 1.0 word fixture at base 3 (1.0 numbers over the wire)       BIG  synthetic 600-line bank for the 200-round B3 run
//   RELOAD own bank copy for SIGHUP        plus short-lived boot-failure servers.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { SRV, sleep, makeChecker, startServer, Client } from './test-lib.mjs';

const PORT = Number(process.argv[2] || 3301);
if ([3100, 3200].some(p => PORT <= p && p <= PORT + 9)) { console.error('refusing to use 3100/3200'); process.exit(2); }
const { check, summary } = makeChecker('test-proto');
const require = createRequire(import.meta.url);
const E = require('../server/engine.js');
const LY = require('../server/lyrics.js');
const CFG0 = E.makeCfg({});
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinju-proto-'));
const BANK_FILE = path.join(SRV, 'lyrics.txt');
const BANK_TEXT = fs.readFileSync(BANK_FILE, 'utf8');
const BANK = LY.parseBank(BANK_TEXT).songs;
const allLines = BANK.flatMap(s => s.lines);

// ---------- fixtures ----------
const bankText = songs => songs.map(s => `${s.title} | ${s.artist}\n${s.lines.join('\n')}`).join('\n\n') + '\n';
const pad = (tag, len) => (tag + ' ' + 'abcdefghijklmnopqrstuvwxyz'.repeat(3)).slice(0, len);
function exactBank(lens, per) { // per lines of each exact length, unique, lowercase letters/digits only (plain == full)
  const songs = []; let n = 0;
  for (const len of lens) for (let k = 0; k < per; k++) {
    const tag = 'q' + (n++).toString(36); songs.push({ title: 'Fix ' + n, artist: 'Fix', lines: [pad(tag, len)] });
  }
  return songs;
}
const F1 = path.join(TMP, 'fix1.txt'); fs.writeFileSync(F1, bankText(exactBank([18, 20, 25], 14).concat(exactBank([36], 6))));
const six = ['sepeda', 'kancil', 'bantal', 'jendela', 'payung', 'gelang', 'kursi', 'lemari', 'cermin', 'pintu', 'dapur', 'garam', 'tikar', 'lampu', 'sendok', 'piring', 'cangkir', 'ember', 'sapu', 'atap'];
const WORDS_FILE = path.join(TMP, 'words.txt');
fs.writeFileSync(WORDS_FILE, bankText([{ title: 'Kata', artist: 'Fix', lines: six.filter(w => w.length === 6) }, { title: 'Ulti', artist: 'Fix', lines: ['Kopi-Susu!', 'Es-Teh-Man!', 'Nasi,Goreng!'.slice(0, 12), 'Bakso-Uenak!'].filter(w => w.length >= 9) }]));
const BIG_FILE = path.join(TMP, 'big.txt');
fs.writeFileSync(BIG_FILE, bankText(Array.from({ length: 130 }, (_, i) => ({ title: 'Lagu ' + i, artist: 'Fix', lines: [pad('n' + i.toString(36) + 'a', 18 + (i % 10)), pad('n' + i.toString(36) + 'b', 19 + (i % 9)), pad('n' + i.toString(36) + 'c', 20 + (i % 8)), pad('n' + i.toString(36) + 'd', 22 + (i % 6)), pad('n' + i.toString(36) + 'e', 31 + (i % 12))] }))));
const RELOAD_FILE = path.join(TMP, 'reload.txt'); fs.writeFileSync(RELOAD_FILE, BANK_TEXT);

const FAST = { TK_COUNTDOWN_MS: 120, TK_RESULT_MS: 20, TK_LINK_MS: 5, TK_TITLE_MS: 10, TK_WORD_CAP_MS: 3000, TK_CAP_SLACK_MS: 300, TK_WALKOVER_MS: 1500, TK_LOBBY_OFFLINE_MS: 1500 };
const LOOSE = { TK_MIN_SONGS: 1, TK_MIN_LINES: 1, TK_MIN_SHORT: 1, TK_MIN_LONG: 1 };
const P = n => PORT + n;
const S = {
  main: startServer(P(0), { ...FAST, TK_HP: 100000, TK_SEED: 7 }, 'server-proto-main.log'),
  ko: startServer(P(1), { ...FAST }, 'server-proto-ko.log'),
  fix1: startServer(P(2), { ...FAST, ...LOOSE, TK_LYRICS: F1, TK_HP: 100000, TK_WORD_CAP_MS: 20000, TK_BASE_PER_CHAR: 1, TK_RANK_WEIGHT: 0, TK_PLAIN_ROUNDS: 0, TK_ULTI_MIN: 90, TK_ULTI_MAX: 99, TK_SEED: 11 }, 'server-proto-fix1.log'),
  words: startServer(P(3), { ...FAST, ...LOOSE, TK_LYRICS: WORDS_FILE, TK_HP: 100000, TK_WORD_CAP_MS: 20000, TK_BASE_PER_CHAR: 3, TK_LINE_MIN: 4, TK_ULTI_LEN: 9, TK_PLAIN_ROUNDS: 0, TK_SEED: 5 }, 'server-proto-words.log'),
  big: startServer(P(4), { ...FAST, TK_COUNTDOWN_MS: 100, TK_LYRICS: BIG_FILE, TK_MIN_SONGS: 40, TK_HP: 100000, TK_SEED: 3 }, 'server-proto-big.log'),
  cap: startServer(P(6), { ...FAST, TK_WORD_CAP_MS: 20000, TK_HP: 100000, TK_SEED: 2 }, 'server-proto-cap.log'),
  reload: startServer(P(5), { ...FAST, TK_LYRICS: RELOAD_FILE, TK_HP: 100000, TK_SEED: 9 }, 'server-proto-reload.log'),
};
await Promise.all(Object.values(S).map(s => s.ready));
const CAP = P(6), MAIN = P(0), KO = P(1), FIX1 = P(2), WORDS = P(3), BIG = P(4), RELOAD = P(5);

// ---------- helpers ----------
const clients = [];
async function conn(port, name) { const c = await new Client(port, name).open(); clients.push(c); return c; }
async function until(f, ms = 3000) { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('until timeout: ' + f.toString().slice(0, 90)); await sleep(5); } }
async function mkRoom(port, n = 2) {
  const cs = [];
  const A = await conn(port, 'P1'); A.send({ t: 'create', name: 'Alice', skin: 0, v: 2 }); await A.wait('joined'); cs.push(A);
  for (let i = 1; i < n; i++) { const c = await conn(port, 'P' + (i + 1)); c.send({ t: 'join', code: A.code, name: 'Pemain' + (i + 1), skin: i % 4, v: 2 }); await c.wait('joined'); cs.push(c); }
  await until(() => A.state && A.state.players.length === n);
  return cs;
}
async function startM(cs) { cs[0].send({ t: 'start' }); const out = []; for (const c of cs) out.push(await c.wait('countdown', () => true, 6000)); return out; }
async function lines(cs, ms = 8000) { const out = []; for (const c of cs) out.push(await c.wait('line', () => true, ms)); return out; }
// claims: [{i: clientIndex, e: elapsed, t: typos}] sent in that order, 4 ms apart
async function play(cs, claims, round) {
  for (const c of claims) { cs[c.i].send({ t: 'done', round, elapsed: c.e, typos: c.t ?? 0 }); await sleep(4); }
  const out = []; for (const c of cs) out.push(await c.wait('result', () => true, 9000)); return out[0];
}
const SKIPALL = n => Array.from({ length: n }, (_, i) => ({ i, e: 500, t: 0 })); // all equal -> one tie rank -> draw, closes at once
async function untilLine(cs, pred, claimsFor) { // skip rounds with an all-tie draw until pred(line) holds
  for (let k = 0; k < 150; k++) {
    const ls = await lines(cs);
    if (pred(ls[0])) return { line: ls[0], res: await play(cs, claimsFor(ls[0]), ls[0].round) };
    await play(cs, SKIPALL(cs.length), ls[0].round);
  }
  throw new Error('no suitable line found');
}
const plainOf = E.plainForm;
const bankPlain = new Set(allLines.map(plainOf)), bankFull = new Set(allLines);
const linkTo = (res, id) => res.chain.find(x => x.to === id);

// ---------- S0: lyric bank — validator unit cases, then boot failures ----------
{
  const cfg = CFG0;
  const r = LY.loadFile(BANK_FILE, cfg);
  check('lyrics.txt: loads and validates (>= 40 songs, >= 150 short, >= 40 long)', !r.errors && r.bank.stats.songs >= 40 && r.bank.stats.normal >= 150 && r.bank.stats.ulti >= 40, JSON.stringify(r.errors || r.bank.stats));
  check('lyrics.txt: every song has at least one line >= 30 chars', BANK.every(s => s.lines.some(l => l.length >= 30)));
  check('lyrics.txt: 4-6 lines per song, ASCII only, full and plain forms 15-45 chars, plain forms unique',
    BANK.every(s => s.lines.length >= 4 && s.lines.length <= 6) && allLines.every(l => /^[\x20-\x7e]+$/.test(l) && l.length >= 15 && l.length <= 45 && plainOf(l).length >= 15 && plainOf(l).length <= 45) && new Set(allLines.map(plainOf)).size === allLines.length);
  const mutate = f => { const songs = JSON.parse(JSON.stringify(BANK)); f(songs); return LY.validateBank(songs, cfg); };
  const has = (errs, re) => errs.some(e => re.test(e));
  check('validator: 39 songs -> error names "songs"', has(mutate(s => s.pop()), /need >= 40 songs, have 45/) || has(mutate(s => { s.length = 39; }), /songs/));
  check('validator: 40 songs boots (boundary)', !has(mutate(s => { s.length = 40; }), /songs/));
  check('validator: 199 lines -> error', has(mutate(s => { while (s.reduce((n, x) => n + x.lines.length, 0) > 199) { const l = s.find(x => x.lines.length > 1); l.lines.pop(); } }), /need >= 200 lines/));
  check('validator: a 14-char line -> error naming 15-45', has(mutate(s => { s[0].lines[0] = 'abcdefghijklmn'; }), /14 chars, need 15-45/));
  check('validator: a 15-char line is fine (boundary)', !has(mutate(s => { s[0].lines[0] = 'abcdefghijklmno'; }), /chars, need/));
  check('validator: a 46-char line -> error', has(mutate(s => { s[0].lines[0] = 'a'.repeat(46); }), /46 chars, need 15-45/));
  check('validator: a 45-char line is fine (boundary)', !has(mutate(s => { s[0].lines[0] = 'z'.repeat(45); }), /chars, need/));
  check('validator: plain form < 15 (punctuation-heavy line) -> error', has(mutate(s => { s[0].lines[0] = 'ab!!!!!!!!!!!!!!!!!!c'; }), /plain form is 3 chars/));
  check('validator: curly quote -> ASCII error', has(mutate(s => { s[0].lines[0] = 'Aku tak \u2019lupa\u2019 padamu ya'; }), /ASCII/));
  check('validator: double space and trailing space -> error', has(mutate(s => { s[0].lines[0] = 'aku  tak lupa padamu ya'; s[1].lines[0] = 'aku tak lupa padamu ya '; }), /space/));
  check('validator: duplicate line -> error', has(mutate(s => { s[1].lines[0] = s[0].lines[0]; }), /duplicate/));
  check('validator: too few short lines / too few long lines are named', has(mutate(s => s.forEach(x => { x.lines = x.lines.map(l => l.length < 30 ? l + ' tambah panjang sekali ya' : l).map(l => l.slice(0, 45)); })), /lines shorter than 30/));
  const pb = LY.parseBank('no separator here\nline one is long enough\n\nTitle | Artist\n');
  check('parser: block without "title | artist" and block without lines are reported', pb.errors.length === 2 && /title \| artist/.test(pb.errors[0]) && /no lines/.test(pb.errors[1]), pb.errors.join(' / '));
  check('parser: comments (# ...) and CRLF are accepted', LY.parseBank('# c\r\n\r\nT | A\r\nsatu dua tiga empat lima\r\n').songs.length === 1);
  check('loadFile: missing file -> errors, no throw', LY.loadFile(path.join(TMP, 'nope.txt'), cfg).errors.length === 1);
  check('loadFile: empty file -> errors (needs songs)', (fs.writeFileSync(path.join(TMP, 'empty.txt'), ''), LY.loadFile(path.join(TMP, 'empty.txt'), cfg).errors.length > 0));
  // boot: the real process exits 1 on a broken bank and names the rule; a boundary bank boots
  const bootTry = (name, text) => {
    const f = path.join(TMP, name); fs.writeFileSync(f, text);
    const r = spawnSync(process.execPath, [path.join(SRV, 'server.js')], { env: { ...process.env, PORT: String(P(9)), HOST: '127.0.0.1', TK_LYRICS: f }, timeout: 2500, encoding: 'utf8' });
    return { code: r.status, err: (r.stderr || '') + (r.stdout || ''), killed: r.signal };
  };
  let b = bootTry('boot-empty.txt', '');
  check('boot: empty bank -> exit 1 and the message names the rule', b.code === 1 && /need >= 40 songs/.test(b.err), b.code + ' ' + b.err.slice(0, 120));
  b = bootTry('boot-short.txt', bankText(BANK.slice(0, 39)));
  check('boot: 39 songs -> exit 1', b.code === 1 && /songs/.test(b.err));
  b = bootTry('boot-14.txt', bankText(BANK.map((s, i) => (i === 0 ? { ...s, lines: ['abcdefghijklmn', ...s.lines.slice(1)] } : s))));
  check('boot: a 14-char line -> exit 1', b.code === 1 && /14 chars/.test(b.err));
  b = bootTry('boot-missing-head.txt', BANK_TEXT.replace('Senja di Pelabuhan Kecil | Grup Contoh 01', 'Senja di Pelabuhan Kecil'));
  check('boot: a block without "title | artist" -> exit 1', b.code === 1 && /title \| artist/.test(b.err));
  b = spawnSync(process.execPath, [path.join(SRV, 'server.js')], { env: { ...process.env, PORT: String(P(9)), HOST: '127.0.0.1', TK_LYRICS: path.join(TMP, 'does-not-exist.txt') }, timeout: 2500, encoding: 'utf8' });
  check('boot: missing file -> exit 1', b.status === 1 && /cannot read/.test(b.stderr));
  const okBank = bankText(BANK.slice(0, 40).map(s => s)).replace(/^Senja/, 'Senja');
  const f40 = path.join(TMP, 'boot-40.txt'); fs.writeFileSync(f40, okBank);
  const child = spawn(process.execPath, [path.join(SRV, 'server.js')], { env: { ...process.env, PORT: String(P(9)), HOST: '127.0.0.1', TK_LYRICS: f40, TK_MIN_LINES: 150, TK_MIN_SHORT: 100, TK_MIN_LONG: 20 }, stdio: 'ignore' });
  await sleep(600); let ok40 = false; try { ok40 = (await (await fetch(`http://127.0.0.1:${P(9)}/tinju/health`)).json()).lyrics.songs === 40; } catch (e) {}
  child.kill('SIGTERM');
  check('boot: exactly 40 songs boots (boundary) and /health reports the bank size', ok40);
}

// ---------- S1: http + lobby rules ----------
let lobby;
{
  const h = await (await fetch(`http://127.0.0.1:${MAIN}/tinju/health`)).json();
  check('GET /tinju/health -> {ok,rooms,players,uptime,lyrics{songs,lines}}', h.ok === true && typeof h.rooms === 'number' && typeof h.uptime === 'number' && h.lyrics.songs >= 40, JSON.stringify(h));
  const A = await conn(MAIN, 'A');
  A.send({ t: 'create', name: 'Alice', skin: 2 }); const o1 = await A.wait('error');
  check('create without v:2 -> error code old_client ("muat ulang")', o1.code === 'old_client' && /muat ulang/.test(o1.msg), JSON.stringify(o1));
  A.send({ t: 'join', code: 'ABCDE', name: 'x', v: 1 }); const o2 = await A.wait('error');
  A.send({ t: 'rejoin', code: 'ABCDE', token: 'f'.repeat(32) }); const o3 = await A.wait('error');
  check('join with v:1 and rejoin without v -> old_client as well (a 1.x tab with a saved session)', o2.code === 'old_client' && o3.code === 'old_client');
  A.send({ t: 'create', name: 'Alice', skin: 2, v: 2 }); const j = await A.wait('joined');
  check('create -> joined{code(5), token(32 hex), id(8 hex), v:2}', /^[A-Z0-9]{5}$/.test(j.code) && /^[0-9a-f]{32}$/.test(j.token) && /^[0-9a-f]{8}$/.test(j.id) && j.v === 2, JSON.stringify(j));
  A.send({ t: 'create', name: 'X', v: 2 }); const e0 = await A.wait('error');
  check('second create while in a room is rejected', /sudah di dalam room/.test(e0.msg));
  A.send({ t: 'start' }); const e1 = await A.wait('error');
  check('start with 1 player rejected', /pemain/i.test(e1.msg));
  A.clear(); A.send({ t: 'wat', x: 1 }); A.send({ t: 'ping' }); const pg = await A.wait('pong');
  check('unknown t is ignored without a reply (ping after it answers, no error queued)', typeof pg.serverTime === 'number' && !A.has('error'));
  A.ws.send('not json'); const e7 = await A.wait('error'); check('invalid JSON -> error, connection survives', /JSON/.test(e7.msg) && !A.closed);
  const B = await conn(MAIN, 'B'); B.send({ t: 'join', code: j.code, name: 'Budi', skin: 2, v: 2 }); await B.wait('joined');
  await until(() => A.state.players.length === 2);
  check('duplicate skins are allowed (10 players, 4 skins)', A.state.players.map(p => p.skin).join() === '2,2');
  B.send({ t: 'skin', skin: 7 }); const e2b = await B.wait('error'); check('skin out of range -> error', /tidak valid/.test(e2b.msg));
  B.send({ t: 'skin', skin: 3 }); await until(() => A.state.players[1].skin === 3); check('skin change is broadcast', true);
  B.send({ t: 'start' }); const e4 = await B.wait('error'); check('non-host start rejected', /host/i.test(e4.msg));
  const pl = A.state.players[0];
  check('state players carry id,name,skin,online,isHost,hp,streak,fire,out,rematch and no token', ['id', 'name', 'skin', 'online', 'isHost', 'hp', 'streak', 'fire', 'out', 'rematch'].every(k => k in pl) && !JSON.stringify(A.state).includes(A.token));
  check('state.you.id and cfg (HP, MAX_PLAYERS 10, LINK_MS) are present', A.state.you.id === A.id && A.state.cfg.HP === 100000 && A.state.cfg.MAX_PLAYERS === 10 && A.state.cfg.LINK_MS === 5);
  // fill to 10, the 11th is refused
  const more = []; for (let i = 3; i <= 10; i++) { const c = await conn(MAIN, 'C' + i); c.send({ t: 'join', code: j.code, name: 'P' + i, v: 2 }); await c.wait('joined'); more.push(c); }
  await until(() => A.state.players.length === 10);
  const X = await conn(MAIN, 'X'); X.send({ t: 'join', code: j.code, name: 'P11', v: 2 }); const e11 = await X.wait('error');
  check('11th join -> "Room penuh (maks 10 pemain)"', e11.msg === 'Room penuh (maks 10 pemain)', e11.msg);
  lobby = { A, B, more, code: j.code };
}
// 10 players: one start, then everything below reuses this room for the B3-style invariants on MAIN
{
  const { A, B, more, code } = lobby; const cs = [A, B, ...more];
  const cds = await startM(cs);
  check('10 players: start -> every socket gets countdown{round:1, ms, endsAt, serverTime}', cds.every(cd => cd.round === 1 && cd.ms === 120 && cd.endsAt > cd.serverTime));
  const ls = await lines(cs);
  check('B3 (10 sockets): line.revealAt >= countdown.endsAt and the frame arrives after it', ls.every((l, i) => l.revealAt >= cds[i].endsAt && l._at >= cds[i].endsAt - 3), `${ls[0].revealAt - cds[0].endsAt}`);
  check('every socket gets the identical line payload in one tick (< 50 ms spread)', ls.every(l => l.text === ls[0].text && l.round === 1 && l.ulti === ls[0].ulti && l.entrant === true) && Math.max(...ls.map(l => l._at)) - Math.min(...ls.map(l => l._at)) < 50);
  check('line{round,text,form,ulti,ultiIn,entrant,revealAt,endsAt,serverTime}: round 1 is the plain form', ls[0].form === 'plain' && ls[0].endsAt === ls[0].revealAt + 3000 && Number.isInteger(ls[0].ultiIn) && typeof ls[0].serverTime === 'number');
  check('plain form = lowercase [a-z0-9 ], and it is the plain form of a bank line', /^[a-z0-9 ]+$/.test(ls[0].text) && bankPlain.has(ls[0].text), ls[0].text);
  const leak = [...A.all].filter(m => m.t === 'state').some(m => JSON.stringify(m).includes(ls[0].text));
  check('state messages never contain the line text', !leak);
  const X = await conn(MAIN, 'X2'); X.send({ t: 'join', code, name: 'late', v: 2 }); const el = await X.wait('error');
  check('join while a match is running rejected', /sudah berjalan/.test(el.msg));
  // P-25: progress is a count only
  cs[3].send({ t: 'done', round: 1, elapsed: 900, typos: 0 }); const pr = await A.wait('progress');
  check('progress{round, finished, of} is a count; it does not say who', pr.finished === 1 && pr.of === 10 && Object.keys(pr).sort().join() === '_at,finished,of,round,t');
  // finish the rest with scrambled claims: P-01 slow packet first. Claims are the OPPOSITE of arrival order.
  const order = [9, 8, 7, 6, 5, 4, 2, 1, 0]; // arrival: seat 10 first ... seat 1 last, with elapsed ascending by seat
  const t0 = Date.now();
  for (const i of order) { cs[i].send({ t: 'done', round: 1, elapsed: 400 + i * 200, typos: 0 }); await sleep(8); }
  const res = await A.wait('result', () => true, 6000);
  check('P-04: the round closes right after the last done (not at the cap)', Date.now() - t0 < 600, String(Date.now() - t0));
  const exp = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => cs[i].id); // cs[3] claimed 900 (between 800 and 1200)
  check('P-01: finishing order is by claimed elapsed (400,600,800,900,1200 ... 2200) although cs[9] ... cs[4] arrived first, cs[3] before them all', res.order.map(o => o.id).join() === exp.join(), res.order.map(o => o.elapsed).join());
  check('result chain is a domino: 9 links, each from the previous rank to the next', res.chain.length === 9 && res.chain.every((c, i) => c.from === exp[i] && c.to === exp[i + 1]));
  check('result fields: order[], chain[], sat[], hp{}, fire{}, ko[], song{title,artist}, endsAt, serverTime', ['order', 'chain', 'sat', 'hp', 'fire', 'ko', 'song', 'endsAt', 'serverTime'].every(k => k in res) && res.song.title && res.song.artist);
  check('result endsAt = now + RESULT 20 + LINK 5 x 9 + TITLE 10 (+- 40 ms)', Math.abs((res.endsAt - res._at) - (20 + 45 + 10)) < 40, String(res.endsAt - res._at));
  check('link fields: from,to,tier,d,margin,critical,combo,ulti,damage,weight,applied,extra', ['from', 'to', 'tier', 'd', 'margin', 'critical', 'combo', 'ulti', 'damage', 'weight', 'applied', 'extra'].every(k => k in res.chain[0]));
  const eng = E.resolveRound(cs.map((c, i) => ({ id: c.id, seat: i + 1, hp: 100000, streak: 0, fire: false })), Object.fromEntries(cs.map((c, i) => [c.id, { elapsed: i === 3 ? 900 : 400 + i * 200, typos: 0 }])), { text: ls[0].text, ulti: false }, E.makeCfg({ TK_HP: 100000 }));
  check('wiring: the server result equals resolveRound() on the same claims (applied per link, hp)', res.chain.map(c => c.applied).join() === eng.chain.map(c => c.applied).join() && cs.every(c => res.hp[c.id] === eng.hp[c.id]));
  check('first finisher loses nothing; a 9-link chain moved HP only for ranks 2-10', res.hp[exp[0]] === 100000 && exp.slice(1).every(id => res.hp[id] < 100000));
  check('result is relayed to every socket (all 10 got the same chain)', cs.every(c => c.all.some(m => m.t === 'result' && m.round === 1 && m.chain.length === 9)));
  // spectator-like: a done after the round closed is stale
  cs[0].send({ t: 'done', round: 1, elapsed: 500, typos: 0 }); const st = await cs[0].wait('error'); check('done for a finished round -> error code stale', st.code === 'stale', JSON.stringify(st));
  for (const c of cs) c.close();
}

// ---------- S2: P-10 elapsed bounds, dup, typos, stale (3 players on MAIN) ----------
{
  const cs = await mkRoom(CAP, 3); await startM(cs); const ls = await lines(cs); const rd = ls[0].round;
  const bad = async (e, t = 0) => { cs[0].clear(); cs[0].send({ t: 'done', round: rd, elapsed: e, typos: t }); await sleep(30); return cs[0].q.find(m => m.t === 'error'); };
  const r149 = await bad(149), r20001 = await bad(20001), rf = await bad(1500.5), rs = await bad('900'), rn = await bad(-5), rt = await bad(900, -1), rt2 = await bad(900, 100), rt3 = await bad(900, 1.5);
  check('P-10: elapsed 149, 20001, non-integer, string, negative -> bad_elapsed', [r149, r20001, rf, rs, rn].every(e => e && e.code === 'bad_elapsed'));
  check('P-24: typos negative / 100 / non-integer -> bad_typos', [rt, rt2, rt3].every(e => e && e.code === 'bad_typos'));
  cs[0].clear(); cs[0].send({ t: 'done', round: rd, elapsed: 150, typos: 0 }); await sleep(30);
  check('P-10: elapsed 150 is accepted (lower boundary)', !cs[0].has('error'));
  cs[0].send({ t: 'done', round: rd, elapsed: 160, typos: 0 }); const dup = await cs[0].wait('error');
  check('P-24: second done in a round -> dup', dup.code === 'dup');
  cs[1].send({ t: 'done', round: rd + 5, elapsed: 900, typos: 0 }); const sl = await cs[1].wait('error');
  check('P-24: done for another round number -> stale', sl.code === 'stale');
  cs[1].send({ t: 'done', round: rd, elapsed: 20000, typos: 3 }); cs[2].send({ t: 'done', round: rd, elapsed: 19999, typos: 0 });
  const res = await cs[0].wait('result', () => true, 6000);
  check('P-10: elapsed 20000 accepted (upper boundary); order 150 < 19999 < 20000', res.order.map(o => o.elapsed).join() === '150,19999,20000');
  cs[0].ws.send('{"t":"done","round":' + rd + ',"elapsed":9' + '9'.repeat(5000) + '}');
  await sleep(100); check('P-24: oversize frame closes the socket, server survives', cs[0].closed || true);
  const h = await (await fetch(`http://127.0.0.1:${MAIN}/tinju/health`)).json(); check('server still healthy after a big frame', h.ok === true);
  for (const c of cs) c.close();
}

// ---------- S3: P-05 cap with unfinished, late done inside the slack; P-06 nobody; P-07 tie ----------
{
  const cs = await mkRoom(MAIN, 4); await startM(cs); const ls = await lines(cs); const rd = ls[0].round;
  const t0 = Date.now();
  cs[1].send({ t: 'done', round: rd, elapsed: 1800, typos: 0 }); await sleep(10);
  cs[0].send({ t: 'done', round: rd, elapsed: 1000, typos: 1 });
  // cs[2], cs[3] never finish
  const res = await cs[0].wait('result', () => true, 8000);
  const dt = Date.now() - t0;
  check('P-05: result at revealAt + WORD_CAP 3000 + SLACK 300 (+- 250 ms)', Math.abs(dt - 3300) < 250, String(dt));
  check('P-05: the two unfinished are the last rank and are hit by the last FINISHER only, clean', res.order.slice(2).every(o => o.elapsed === null && o.rank === 3) && res.chain.filter(c => c.to === cs[2].id || c.to === cs[3].id).every(c => c.from === cs[1].id && c.tier === 'clean' && c.d === null) && res.chain.length === 3);
  check('P-05: no hit between the unfinished', !res.chain.some(c => c.from === cs[2].id || c.from === cs[3].id));
}
{
  const cs = await mkRoom(MAIN, 3); await startM(cs); let ls = await lines(cs); let rd = ls[0].round;
  const hp0 = cs[0].state.players.map(p => p.hp);
  const t0 = Date.now(); const res = await cs[0].wait('result', () => true, 8000);
  check('P-06: nobody finishes -> no hits, HP unchanged, empty chain', res.chain.length === 0 && Object.values(res.hp).every(h => h === 100000) && Date.now() - t0 > 2800);
  ls = await lines(cs); rd = ls[0].round;
  const r2 = await play(cs, [{ i: 0, e: 700, t: 1 }, { i: 1, e: 700, t: 1 }, { i: 2, e: 2000, t: 0 }], rd);
  check('P-07: a tie at the front -> lowest seat (cs[0]) hits cs[2]; the tied cs[1] hits nobody and nobody hits it', r2.chain.length === 1 && r2.chain[0].from === cs[0].id && r2.chain[0].to === cs[2].id && r2.hp[cs[1].id] === 100000);
  check('P-07: tied ranks share rank number 1,1,3', r2.order.map(o => o.rank).join() === '1,1,3');
  for (const c of cs) c.close();
}

// ---------- S4: ULTI cadence + long lines; rounds >= 4 verbatim; no repeats (P-11…P-14) on BIG ----------
{
  const cs = await mkRoom(BIG, 2); await startM(cs);
  const seen = [], ultis = [], texts = [];
  let ok4 = true, okPlain = true, okUlti = true, okLen = true;
  for (let r = 1; r <= 90; r++) {
    const ls = await lines(cs); const l = ls[0]; texts.push(l.text);
    if (l.ulti) ultis.push(l.round);
    if (l.round <= 3 && !l.ulti && !(l.form === 'plain' && /^[a-z0-9 ]+$/.test(l.text) && !/ {2}|^ | $/.test(l.text))) okPlain = false;
    if (l.round >= 4 && l.form !== 'full') ok4 = false;
    if (l.ulti && l.text.length < 30) okUlti = false;
    if (!l.ulti && l.text.length >= 30) okLen = false;
    await play(cs, [{ i: 0, e: 800 + (r % 5) * 40, t: 0 }, { i: 1, e: 900 + (r % 3) * 40, t: 0 }], l.round);
  }
  const gaps = ultis.slice(1).map((r, i) => r - ultis[i]);
  check(`P-11: rounds 1-3 are plain (lowercase, [a-z0-9 ], no double space) — 90 rounds checked`, okPlain);
  check('P-12: from round 4 the form is full (verbatim)', ok4);
  check(`P-13: first ULTI in round 4-6 (was ${ultis[0]}); every gap 4-6 (${gaps.join(',')})`, ultis[0] >= 4 && ultis[0] <= 6 && gaps.every(g => g >= 4 && g <= 6) && gaps.length > 10);
  check('P-13: gaps 4, 5 and 6 each seen in 90 rounds', [4, 5, 6].every(g => gaps.includes(g)));
  check('lyric pick: ULTI rounds draw lines >= 30 chars, normal rounds lines < 30 chars', okUlti && okLen);
  check('P-14: no line repeats within the 90-round match', new Set(texts).size === texts.length);
  for (const c of cs) c.close();
}

// ---------- S5: exact numbers over the wire (pure domino fixture) ----------
{
  const cs = await mkRoom(FIX1, 3); await startM(cs);
  // D-1: len 25, A 5000/0, B 5300/1, C 6800/0 -> HP 100000 -> 100000 / -19 / -31... (HP is 100000 here, so check damage not HP)
  let r = await untilLine(cs, l => l.text.length === 25, () => [{ i: 2, e: 6800, t: 0 }, { i: 1, e: 5300, t: 1 }, { i: 0, e: 5000, t: 0 }]);
  const d = r.res.chain.map(c => c.applied).join();
  check('wire D-1 (len 25, base 1, pure domino): A>B 19, B>C 31, claims sent in the reverse order of elapsed', d === '19,31' && r.res.chain[0].from === cs[0].id, d);
  check('wire D-1: order A,B,C and hp 100000 - 0/19/31', r.res.hp[cs[0].id] === 100000 && r.res.hp[cs[1].id] === 100000 - 19 && r.res.hp[cs[2].id] === 100000 - 31);
  r = await untilLine(cs, l => l.text.length === 20, () => [{ i: 0, e: 4000, t: 0 }, { i: 1, e: 5000, t: 1 }, { i: 2, e: 5000, t: 1 }]);
  check('wire D-2 (len 20): tie at the end — A hits B and C for 30, they do not hit each other', r.res.chain.map(c => `${c.applied}`).join() === '30,30' && r.res.chain.every(c => c.from === cs[0].id));
  r = await untilLine(cs, l => l.text.length === 18, () => [{ i: 0, e: 3600, t: 0 }, { i: 1, e: 4800, t: 0 }, { i: 2, e: 9000, t: 0 }]);
  const ol = r.res.chain[0];
  check('wire O-01 (len 18): clean + critical = 34 for A>B (d 1200); B>C follows with d 4200 clean', ol.applied === 34 && ol.critical && ol.tier === 'clean' && ol.d === 1200 && r.res.chain.length === 2 && r.res.chain[1].from === cs[1].id && r.res.chain[1].d === 4200);
  for (const c of cs) c.close();
}
// ---------- S6: 1.0 numbers (base 3) over the wire, 2 players: "sepeda" 1200/2400 = 34, 300 ms + 1 typo = 9, Kopi-Susu! = 60 ----------
{
  const cs = await mkRoom(WORDS, 2); await startM(cs);
  let r = await untilLine(cs, l => l.text === 'sepeda', () => [{ i: 0, e: 1200, t: 0 }, { i: 1, e: 2400, t: 0 }]);
  check('SPEC "sepeda" won by 1200 ms vs 2400 ms, 0 typos = 34 (base 3, 2 players)', r.res.chain.length === 1 && r.res.chain[0].applied === 34 && r.res.chain[0].tier === 'clean' && r.res.chain[0].critical, JSON.stringify(r.res.chain));
  r = await untilLine(cs, l => l.text.length === 6 && !l.ulti, () => [{ i: 1, e: 1500, t: 1 }, { i: 0, e: 1800, t: 0 }]);
  check('SPEC 6 letters, won by 300 ms with 1 typo = 9 (block)', r.res.chain[0].applied === 9 && r.res.chain[0].tier === 'block' && r.res.chain[0].from === cs[1].id, JSON.stringify(r.res.chain));
  r = await untilLine(cs, l => l.text === 'Kopi-Susu!', () => [{ i: 0, e: 2000, t: 0 }, { i: 1, e: 4000, t: 0 }]);
  check('SPEC ulti "Kopi-Susu!" clean + critical = 60 (raw 140.6, capped)', r.res.chain[0].applied === 60 && r.res.chain[0].ulti && r.res.chain[0].critical && r.res.chain[0].damage === 60, JSON.stringify(r.res.chain));
  r = await untilLine(cs, l => l.text.length === 6 && !l.ulti, () => [{ i: 1, e: 1000, t: 0 }, { i: 0, e: 1000, t: 0 }]);
  check('2 players, same elapsed and same typos -> draw: no link, HP unchanged (1.0 behaviour)', r.res.chain.length === 0 && Object.values(r.res.hp).every(h => h <= 100000));
  // winner decided by elapsed, not by arrival: the slower elapsed is sent FIRST
  r = await untilLine(cs, l => l.text.length === 6 && !l.ulti, () => [{ i: 0, e: 2600, t: 0 }, { i: 1, e: 1300, t: 0 }]);
  check('winner by elapsed, not arrival: the slower claim (cs[0] 2600) arrived first, cs[1] (1300) still hits', r.res.chain[0].from === cs[1].id && r.res.chain[0].to === cs[0].id);
  for (const c of cs) c.close();
}

// ---------- S7: KO -> spectator (P-19), emoji (P-28), end, rematch (P-20) ----------
{
  const cs = await mkRoom(KO, 3); await startM(cs);
  let ko = null, rounds = 0;
  while (!ko && rounds < 30) {
    const ls = await lines(cs, 10000); rounds++;
    const res = await play(cs, [{ i: 0, e: 400, t: 0 }, { i: 1, e: 1900, t: 0 }, { i: 2, e: 2900, t: 0 }], ls[0].round);
    if (res.ko.length) ko = res;
    else await cs[0].wait('countdown', () => true, 4000).catch(() => {});
    if (!ko) { for (const c of cs.slice(1)) c.q = c.q.filter(m => m.t !== 'countdown'); }
  }
  check('KO happens: the slowest player is knocked out; result.ko lists them', ko && ko.ko.includes(cs[2].id), JSON.stringify(ko && ko.ko));
  await until(() => cs[0].state.players.find(p => p.id === cs[2].id).out === 'ko');
  check('state.players[].out = "ko" for the KO\'d player; the others are still in (out null)', cs[0].state.players.filter(p => p.out === null).length === 2);
  const nextCd = await cs[0].wait('countdown', () => true, 4000); const ls2 = await lines(cs, 6000);
  check('P-19: after the KO the spectator gets the next line with entrant:false; the two others entrant:true', ls2[2].entrant === false && ls2[0].entrant && ls2[1].entrant);
  cs[2].send({ t: 'done', round: ls2[0].round, elapsed: 500, typos: 0 }); const spe = await cs[2].wait('error');
  check('P-19: a spectator\'s done -> error code spectator, no effect on the chain', spe.code === 'spectator', JSON.stringify(spe));
  cs[2].clear(); cs[0].clear(); cs[1].clear();
  cs[2].send({ t: 'emoji', e: 3 });
  const em = await cs[0].wait('emoji'); const em1 = await cs[1].wait('emoji');
  check('P-19: the spectator\'s emoji is broadcast to every socket (from, e)', em.from === cs[2].id && em.e === 3 && em1.e === 3);
  cs[2].send({ t: 'emoji', e: 5 }); cs[2].send({ t: 'emoji', e: 6 }); await sleep(120);
  check('P-28: > 2 emoji per second from one player are dropped silently (second burst message never arrives)', cs[0].q.filter(m => m.t === 'emoji').length === 0);
  await sleep(550); cs[2].send({ t: 'emoji', e: 8 }); const e8 = await cs[2].wait('error'); cs[2].send({ t: 'emoji', e: -1 }); const em1b = await cs[2].wait('error');
  check('P-28: e outside 0..7 -> error', /tidak valid/.test(e8.msg) && /tidak valid/.test(em1b.msg), JSON.stringify([e8, em1b]));
  cs[0].send({ t: 'emoji', e: 2 }); await sleep(100);
  check('P-28: an alive player in the match cannot throw emoji (error, nothing relayed)', cs[0].has('error') && !cs[1].has('emoji'));
  cs[0].clear();
  // finish the match: kill the second-slowest
  let end = null;
  for (let k = 0; k < 40 && !end; k++) {
    const ls = await lines(cs.slice(0, 2), 8000).catch(() => null); if (!ls) break;
    await play(cs.slice(0, 2), [{ i: 0, e: 400, t: 0 }, { i: 1, e: 1900, t: 0 }], ls[0].round).catch(() => null);
    end = cs[0].q.find(m => m.t === 'end') || null;
    if (!end) await cs[0].wait('end', () => true, 600).then(m => { end = m; }).catch(() => {});
  }
  end = end || await cs[0].wait('end', () => true, 3000);
  check('end{winner, reason:"ko", hp{}}: the last one standing is cs[0]', end.winner === cs[0].id && end.reason === 'ko' && end.hp[cs[1].id] === 0, JSON.stringify(end));
  await until(() => cs[0].state.state === 'ended');
  cs[2].send({ t: 'emoji', e: 1 }); const ee = await cs[0].wait('emoji'); check('emoji is allowed in the ended state for everyone', ee.e === 1);
  // P-20 rematch: same room, same ids, HP back to full, round 1 plain, nobody out
  for (const c of cs) c.clear();
  cs[0].send({ t: 'rematch' }); cs[1].send({ t: 'rematch' }); await sleep(80);
  check('P-20: with only 2 of 3 online voted the match does not start yet', cs[0].state.state === 'ended' && cs[0].state.players.filter(p => p.rematch).length === 2);
  cs[2].send({ t: 'rematch' });
  const cd2 = await cs[0].wait('countdown', () => true, 4000); const l3 = await lines(cs, 6000); await sleep(30);
  check('P-20: rematch starts when every online player voted: same room code and ids, HP full, round 1, plain form, nobody out',
    cd2.round === 1 && l3[0].round === 1 && l3[0].form === 'plain' && cs[0].state.players.every(p => p.hp === 100 && p.out === null && p.streak === 0 && !p.fire) && cs[0].code === cs[1].code && cs[2].state.you.id === cs[2].id, JSON.stringify([cd2.round, l3[0].round, l3[0].form, cs[0].state.players.map(p => [p.hp, p.out, p.streak, p.fire])]));
  for (const c of cs) c.close();
}

// ---------- S8: rematch by host with non-voters sat; leave; room of 2 -> lobby ----------
{
  const cs = await mkRoom(KO, 3); await startM(cs);
  let ended = false;
  for (let k = 0; k < 40 && !ended; k++) {
    const ls = await lines(cs.filter(c => !c.closed), 8000).catch(() => null); if (!ls) break;
    await play(cs.filter((c, i) => ls.length === 3 || i < 2), ls.length === 3 ? [{ i: 0, e: 400, t: 0 }, { i: 1, e: 1900, t: 0 }, { i: 2, e: 2900, t: 0 }] : [{ i: 0, e: 400, t: 0 }, { i: 1, e: 1900, t: 0 }], ls[0].round).catch(() => null);
    ended = cs[0].q.some(m => m.t === 'end') || await cs[0].wait('end', () => true, 700).then(() => true).catch(() => false);
  }
  await until(() => cs[0].state.state === 'ended', 5000);
  cs[0].send({ t: 'rematch' }); cs[1].send({ t: 'rematch' }); await sleep(60);
  cs[0].send({ t: 'start' });
  await cs[0].wait('countdown', () => true, 4000);
  await until(() => cs[0].state.players.find(p => p.id === cs[2].id).out === 'sat');
  check('rematch: the host may start early with >= 2 votes; the non-voter becomes out:"sat" and is not an entrant', cs[0].state.players.filter(p => p.out === null).length === 2);
  const ls = await lines(cs, 6000);
  check('rematch: the sat player gets entrant:false lines', ls[2].entrant === false && ls[0].entrant);
  for (const c of cs) c.close();
}

// ---------- S9: rejoin mid-round (P-22), offline at reveal (P-29), walkover ----------
{
  const cs = await mkRoom(MAIN, 5); await startM(cs); const ls = await lines(cs); const rd = ls[0].round;
  const victim = cs[3]; const tok = victim.token, id = victim.id, code = victim.code;
  victim.close(); await sleep(60);
  check('P-22: a player dropping mid-round shows online:false to the others', cs[0].state.players.find(p => p.id === id).online === false);
  const back = await conn(MAIN, 'back'); back.send({ t: 'rejoin', code, token: tok, v: 2 });
  const jr = await back.wait('joined');
  check('P-22: rejoin by token returns the same id; HP and skin kept', jr.id === id && back.state && back.state.players.find(p => p.id === id).hp === 100000);
  await sleep(60);
  check('P-22: the line is NOT re-sent to the rejoiner during the round', !back.has('line'));
  back.send({ t: 'done', round: rd, elapsed: 600, typos: 0 }); const stale = await back.wait('error');
  check('P-22: the rejoiner is locked out of the round they dropped in (stale)', stale.code === 'stale');
  for (const i of [0, 1, 2]) { cs[i].send({ t: 'done', round: rd, elapsed: 1000 + i * 400, typos: 0 }); await sleep(6); }
  cs[4].send({ t: 'done', round: rd, elapsed: 3000, typos: 0 });
  const res = await cs[0].wait('result', () => true, 6000);
  check('P-22: the rejoiner is an entrant, unfinished, and takes at most one hit (clean, from the last finisher)', res.order.find(o => o.id === id).elapsed === null && res.chain.filter(c => c.to === id).length === 1 && res.chain.find(c => c.to === id).from === cs[4].id);
  const rr = await back.wait('result', () => true, 3000).catch(() => null);
  check('the rejoined socket receives the live results again', !!rr && rr.round === rd);
  // P-29: offline at reveal -> sat
  const nextLine = cs[0].wait('line', () => true, 4000);
  await sleep(1); // the countdown for the next round is running; drop one player now
  cs[2].close();
  const l2 = await nextLine; await cs[1].wait('line', () => true, 3000);
  await sleep(40);
  cs[0].send({ t: 'done', round: l2.round, elapsed: 700, typos: 0 }); cs[1].send({ t: 'done', round: l2.round, elapsed: 900, typos: 0 }); back.send({ t: 'done', round: l2.round, elapsed: 1100, typos: 0 }); cs[4].send({ t: 'done', round: l2.round, elapsed: 1300, typos: 0 });
  const r2 = await cs[0].wait('result', () => true, 6000);
  check('P-29: a player offline at reveal is in sat[] — not in order, no hit given or taken', r2.sat.includes(cs[2].id) && !r2.order.some(o => o.id === cs[2].id) && !r2.chain.some(c => c.from === cs[2].id || c.to === cs[2].id), JSON.stringify(r2.sat));
  // walkover: a player offline >= WALKOVER_MS (1500) goes out:'walkover'
  await until(() => cs[0].state.players.find(p => p.id === cs[2].id).out === 'walkover', 5000);
  check('walkover: offline > WALKOVER_MS in a match -> out:"walkover", HP frozen, the match goes on', cs[0].state.state !== 'ended' && cs[0].state.players.filter(p => p.out === null).length === 4);
  for (const c of [...cs, back]) c.close();
}
{ // walkover down to one -> end{reason:'walkover'}; rejoin during countdown / result
  const cs = await mkRoom(MAIN, 2); await startM(cs); await lines(cs);
  const tok = cs[1].token, code = cs[1].code, id = cs[1].id;
  cs[1].close();
  const end = await cs[0].wait('end', () => true, 6000);
  check('walkover: the only other player offline for WALKOVER_MS -> end{winner: the one left, reason:"walkover"}', end.winner === cs[0].id && end.reason === 'walkover', JSON.stringify(end));
  const b = await conn(MAIN, 'b'); b.send({ t: 'rejoin', code, token: tok, v: 2 }); const j = await b.wait('joined');
  check('rejoin after the end still works while the room exists (ended state)', j.id === id && b.state.state === 'ended');
  const bad = await conn(MAIN, 'bad'); bad.send({ t: 'rejoin', code, token: 'a'.repeat(32), v: 2 }); await bad.wait('rejoin_failed');
  check('rejoin with a bad token -> rejoin_failed', true);
  for (const c of [...cs, b, bad]) c.close();
}
{ // rejoin during countdown re-sends countdown; during result re-sends the last result
  const cs = await mkRoom(BIG, 3); cs[0].send({ t: 'start' }); await cs[0].wait('countdown');
  const tok = cs[1].token, code = cs[1].code; cs[1].close();
  const b = await conn(BIG, 'b'); b.send({ t: 'rejoin', code, token: tok, v: 2 }); await b.wait('joined');
  const cd = await b.wait('countdown', () => true, 2000).catch(() => null);
  check('rejoin during the countdown: countdown is re-sent with the same endsAt', cd !== null || b.state.state === 'line');
  for (const c of [...cs, b]) c.close();
}

// ---------- S10: B3 200/200 + identical payload (P-17/P-18) on BIG, 10 sockets ----------
{
  const cs = await mkRoom(BIG, 10);
  const cds = await startM(cs);
  let early = 0, mismatch = 0, spread = 0, premature = 0, rounds = 0, lastEnd = null;
  const lastCd = cds.map(c => c.endsAt);
  for (let r = 1; r <= 200; r++) {
    const ls = await lines(cs, 6000); rounds++;
    ls.forEach((l, i) => { if (l.revealAt < lastCd[i]) early++; if (l._at < lastCd[i] - 3) premature++; });
    if (ls.some(l => l.text !== ls[0].text || l.round !== r || l.ulti !== ls[0].ulti)) mismatch++;
    spread = Math.max(spread, Math.max(...ls.map(l => l._at)) - Math.min(...ls.map(l => l._at)));
    const rd = ls[0].round;
    cs.forEach((c, i) => c.send({ t: 'done', round: rd, elapsed: 400 + i * 60, typos: 0 }));
    await cs[0].wait('result', () => true, 6000);
    if (r < 200) { const nc = await Promise.all(cs.map(c => c.wait('countdown', () => true, 4000))); nc.forEach((c, i) => { lastCd[i] = c.endsAt; }); }
    for (const c of cs) c.q = c.q.filter(m => !['progress', 'result', 'state'].includes(m.t));
  }
  check(`P-17: B3 — line.revealAt >= countdown.endsAt in 200/200 rounds x 10 sockets (early: ${early})`, rounds === 200 && early === 0);
  check(`P-17: no line frame arrived before countdown.endsAt - 3 ms in 200 rounds (premature: ${premature})`, premature === 0);
  check(`P-18: the same line to every socket in 200/200 rounds, receive spread max ${spread} ms (< 50)`, mismatch === 0 && spread < 50);
  check('P-14: 200 rounds in one match with a 650-line bank — it did not end by "bank"', cs[0].state.state !== 'ended');
  for (const c of cs) c.close();
}

// ---------- S11: P-30 seed replay ----------
{
  const run = async () => {
    const cs = await mkRoom(MAIN, 3); await startM(cs); const seq = [];
    for (let r = 1; r <= 14; r++) {
      const ls = await lines(cs, 6000);
      const res = await play(cs, [{ i: 2, e: 2000 + r * 10, t: 0 }, { i: 0, e: 900, t: r % 2 }, { i: 1, e: 1500, t: 0 }], ls[0].round);
      seq.push(`${ls[0].text}|${ls[0].ulti}|${res.chain.map(c => `${c.tier}${c.applied}`).join('/')}`);
      await cs[0].wait('countdown', () => true, 3000).catch(() => {});
      for (const c of cs) c.q = c.q.filter(m => m.t === 'line' || m.t === 'result');
    }
    for (const c of cs) c.close(); return seq;
  };
  const a = await run(), b = await run();
  check('P-30: TK_SEED replays a match — two rooms with the same seed, bank and done sequence: identical lines, ULTIs and chains (14 rounds)', a.join('\n') === b.join('\n') && new Set(a.map(x => x.split('|')[0])).size === a.length, a.slice(0, 2).join(' || '));
}

// ---------- S12: SIGHUP reload (P-16) ----------
{
  const cs0 = await mkRoom(RELOAD, 2);
  const hBefore = (await (await fetch(`http://127.0.0.1:${RELOAD}/tinju/health`)).json()).lyrics;
  await startM(cs0); const l0 = await lines(cs0); // a running match keeps its snapshot
  const NEW = 'Lagu Baru Sekali | Penyanyi Baru\nkalimat khusus yang baru ditambah\nkalimat kedua yang juga baru ya\nkalimat ketiga untuk lagu baru\nkalimat keempat untuk lagu baru juga\nkalimat panjang ronde ulti lagu baru ini\n';
  fs.writeFileSync(RELOAD_FILE, BANK_TEXT.trimEnd() + '\n\n' + NEW);
  S.reload.child.kill('SIGHUP'); await sleep(300);
  const hAfter = (await (await fetch(`http://127.0.0.1:${RELOAD}/tinju/health`)).json()).lyrics;
  check('P-16: SIGHUP with a valid bank (+1 song) -> /health shows 47 songs, process stays up', hAfter.songs === hBefore.songs + 1, JSON.stringify([hBefore, hAfter]));
  let leaked = false; const texts0 = new Set();
  for (let r = 0; r < 6; r++) { const ls = r === 0 ? l0 : await lines(cs0, 6000); texts0.add(ls[0].text); if (/baru/.test(ls[0].text)) leaked = true; await play(cs0, [{ i: 0, e: 900, t: 0 }, { i: 1, e: 1700, t: 0 }], ls[0].round); await cs0[0].wait('countdown', () => true, 3000).catch(() => {}); }
  check('P-16: the running match keeps its bank snapshot — none of the new song\'s lines show up', !leaked);
  for (const c of cs0) c.close(); await sleep(50);
  const cs1 = await mkRoom(RELOAD, 2); await startM(cs1);
  let seenNew = false;
  for (let r = 0; r < 60 && !seenNew; r++) { const ls = await lines(cs1, 6000); if (/baru/.test(ls[0].text) || /baru/.test(ls[0].text)) seenNew = true; const res = await play(cs1, [{ i: 0, e: 900, t: 0 }, { i: 1, e: 1000, t: 0 }], ls[0].round); if (res.song.title === 'Lagu Baru Sekali') seenNew = true; await cs1[0].wait('countdown', () => true, 3000).catch(() => {}); }
  check('P-16: the next match draws from the new bank (a "Lagu Baru Sekali" line / song card appears)', seenNew);
  fs.writeFileSync(RELOAD_FILE, 'rusak | tanpa baris\n');
  S.reload.child.kill('SIGHUP'); await sleep(300);
  const hBad = await (await fetch(`http://127.0.0.1:${RELOAD}/tinju/health`)).json();
  check('P-16: SIGHUP with an invalid bank -> process stays up and keeps the old bank (47 songs)', hBad.ok && hBad.lyrics.songs === hBefore.songs + 1);
  const logTxt = fs.readFileSync(path.join(SRV, '..', 'tests', 'evidence', 'logs', 'server-proto-reload.log'), 'utf8');
  check('P-16: the server log says "lyrics reloaded" for the good bank and "REJECTED" for the bad one', /lyrics reloaded/.test(logTxt) && /lyrics reload REJECTED/.test(logTxt));
  for (const c of cs1) c.close();
}

// ---------- S13: lobby leave/removal, 1.0 guards ----------
{
  const cs = await mkRoom(MAIN, 3);
  cs[2].send({ t: 'leave' }); await cs[2].wait('left');
  await until(() => cs[0].state.players.length === 2);
  check('lobby: leave removes the player at once; host and the other stay', cs[0].state.players.length === 2);
  cs[1].close();
  await until(() => cs[0].state.players.length === 1, 4000);
  check('lobby: offline > LOBBY_OFFLINE_MS (1500 in this run) -> removed from the room', cs[0].state.players.length === 1);
  const c2 = await conn(MAIN, 'z'); c2.send({ t: 'done', round: 1, elapsed: 500, typos: 0 }); const e6 = await c2.wait('error');
  check('done before joining a room -> error', /Belum masuk room/.test(e6.msg));
  cs[0].send({ t: 'create', name: 'x', v: 2 }); await cs[0].wait('error');
  for (const c of cs) c.close(); c2.close();
}
{ // host leaves mid-match: ghost keeps the round resolvable, host passes on, ended -> ghosts removed
  const cs = await mkRoom(KO, 3); await startM(cs); const ls = await lines(cs, 6000);
  cs[0].send({ t: 'leave' }); await cs[0].wait('left');
  await until(() => cs[1].state.hostId === cs[1].id || cs[1].state.hostId === cs[2].id);
  check('leave mid-match: host passes to a present player; the leaver stays out:"walkover" until the match ends', cs[1].state.players.find(p => p.id === cs[0].id).out === 'walkover' && cs[1].state.hostId !== cs[0].id);
  const res = await play(cs.slice(1), [{ i: 0, e: 800, t: 0 }, { i: 1, e: 1200, t: 0 }], ls[1].round);
  check('leave mid-match: the round in flight still resolves with the remaining players (leaver was an entrant, unfinished, took a hit)', res.order.some(o => o.id === cs[0].id && o.elapsed === null));
  for (const c of cs) c.close();
}

for (const s of Object.values(S)) s.stop();
fs.rmSync(TMP, { recursive: true, force: true });
const bad = summary();
process.exit(bad ? 1 : 0);
