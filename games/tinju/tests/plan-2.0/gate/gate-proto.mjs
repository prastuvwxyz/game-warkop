// A-na gate 2.0.0 — protocol checks against a real server.js from a tree copy.
// Usage: node gate-proto.mjs <path-to-games/tinju> <basePort>=3300 <logTag>   (ports base..base+9; never 3100/3200)
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { domino } from './oracle-2.0.mjs';
const T = process.argv[2], BASE = +process.argv[3] || 3300, TAG = process.argv[4] || 'x';
if (BASE < 3300) throw new Error('port guard: ports must be >= 3300');
const LOGS = '/tmp/ana-g2/logs', TMP = `/tmp/ana-g2/tmp-${TAG}`; fs.mkdirSync(TMP, { recursive: true });
const SRVJS = path.join(T, 'server', 'server.js');
const req = createRequire(import.meta.url); const E = req(path.join(T, 'server', 'engine.js')); const LY = req(path.join(T, 'server', 'lyrics.js'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0; const only = (process.env.ONLY || '').split(',').filter(Boolean);
const check = (n, ok, x = '') => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  | ' + x : '')); };
const servers = [];
function server(port, env, name) {
  const out = fs.openSync(`${LOGS}/gate-srv-${TAG}-${name}.log`, 'a');
  const child = spawn(process.execPath, [SRVJS], { env: { PATH: process.env.PATH, PORT: String(port), HOST: '127.0.0.1', ...env }, stdio: ['ignore', 'pipe', out] });
  let buf = ''; child.stdout.on('data', d => { buf += d; fs.appendFileSync(`${LOGS}/gate-srv-${TAG}-${name}.log`, d); });
  servers.push(child);
  const ready = new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('no listen ' + port)), 8000);
    child.stdout.on('data', () => { if (buf.includes('listening')) { clearTimeout(t); res(); } }); child.on('exit', c => { clearTimeout(t); rej(new Error('exit ' + c)); }); });
  return { child, ready, port, log: () => buf, stop: () => { try { child.kill('SIGTERM'); } catch {} } };
}
process.on('exit', () => servers.forEach(s => { try { s.kill('SIGKILL'); } catch {} }));
class C {
  constructor(port, name) { this.port = port; this.name = name; this.q = []; this.all = []; this.closed = false; this.closeCode = null; }
  open() { return new Promise((res, rej) => { const ws = this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/tinju/ws`);
    ws.onopen = () => res(this); ws.onerror = () => rej(new Error('ws error')); ws.onclose = e => { this.closed = true; this.closeCode = e.code; };
    ws.onmessage = ev => { const m = JSON.parse(ev.data); m._at = Date.now(); if (m.t === 'state') this.state = m.room; if (m.t === 'joined') { this.id = m.id; this.token = m.token; this.code = m.code; } this.q.push(m); this.all.push(m); }; }); }
  send(o) { this.ws.send(typeof o === 'string' ? o : JSON.stringify(o)); }
  close() { try { this.ws.close(); } catch {} }
  async wait(t, pred = () => true, ms = 6000) { const end = Date.now() + ms; for (;;) { const i = this.q.findIndex(m => m.t === t && pred(m)); if (i >= 0) return this.q.splice(i, 1)[0]; if (Date.now() > end) throw new Error(`${this.name}: timeout ${t}`); await sleep(3); } }
  has(t, p = () => true) { return this.q.some(m => m.t === t && p(m)); }
  drop(t) { this.q = this.q.filter(m => m.t !== t); }
}
async function room(port, n, skins = []) {
  const cs = []; for (let i = 0; i < n; i++) cs.push(await new C(port, 'c' + i).open());
  cs[0].send({ t: 'create', name: 'Bot0', skin: skins[0] ?? 0, v: 2 }); await cs[0].wait('joined');
  for (let i = 1; i < n; i++) { cs[i].send({ t: 'join', code: cs[0].code, name: 'Bot' + i, skin: skins[i] ?? (i % 4), v: 2 }); await cs[i].wait('joined'); }
  await until(() => cs.every(c => c.state && c.state.players.length === n)); return cs;
}
async function until(f, ms = 5000) { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('until timeout'); await sleep(5); } }
const plain = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/ +/g, ' ').trim();
const bank = LY.loadFile(path.join(T, 'server', 'lyrics.txt'), E.makeCfg({})).bank;
const FULL = new Set([...bank.normal, ...bank.ulti].map(x => x.text)), PLAIN = new Set([...FULL].map(plain));
const SONGLINES = new Map(); for (const x of [...bank.normal, ...bank.ulti]) SONGLINES.set(x.text, bank.songs[x.song]);
// play one round: everyone in `claims` sends done (order of the array, gap ms apart); returns {line, res, cds}
async function round(cs, claims, gap = 0) {
  const cds = await Promise.all(cs.filter(c => !c.closed).map(c => c.wait('countdown', () => true, 30000)));
  const lines = await Promise.all(cs.filter(c => !c.closed).map(c => c.wait('line', () => true, 30000)));
  const ln = lines[0];
  for (const cl of claims) { const c = cs[cl.i]; c.send({ t: 'done', round: ln.round, elapsed: cl.e, typos: cl.t ?? 0 }); if (gap) await sleep(gap); }
  const res = await cs.find(c => !c.closed).wait('result', m => m.round === ln.round, 30000);
  for (const c of cs) if (c !== cs.find(c => !c.closed)) c.q = c.q.filter(m => !(m.t === 'result' && m.round === ln.round));
  return { line: ln, lines, res, cds };
}
const fast = { TK_COUNTDOWN_MS: '150', TK_RESULT_MS: '30', TK_LINK_MS: '2', TK_TITLE_MS: '5', TK_HP: '100000' };
const want = k => !only.length || only.includes(k);

// ============ S1: P-01 slow packet first, chain vs oracle (5 bots, 20 rounds) + P-18 identical payload ============
if (want('p01')) { const s = server(BASE, fast, 'main'); await s.ready;
  const cs = await room(BASE, 5); cs[0].send({ t: 'start' });
  let ok = 0, okOracle = 0, maxArriveGap = 0, firePrev = {}, hpPrev = Object.fromEntries(cs.map(c => [c.id, 100000])); const bad = [];
  for (let r = 0; r < 20; r++) {
    const el = [...Array(5)].map((_, i) => 1500 + 377 * (r % 2 ? 4 - i : (i * 3) % 5) + ((r * 131 + i * 53) % 300)); // distinct; elapsed order != seat order in every round
    const ty = [...Array(5)].map((_, i) => (r + i) % 3 === 0 ? 0 : 1);
    const perm = [...Array(5).keys()].sort((a, b) => el[b] - el[a]); // slowest claim sent FIRST, fastest last
    const { line, res } = await round(cs, perm.map(i => ({ i, e: el[i], t: ty[i] })), 300);
    const expOrder = [...Array(5).keys()].sort((a, b) => el[a] - el[b]).map(i => cs[i].id);
    const ord = res.order.map(o => o.id);
    if (ord.join() === expOrder.join()) ok++; else bad.push(r);
    const P = cs.map((c, i) => ({ id: c.id, seat: i, elapsed: el[i], typos: ty[i], hp: hpPrev[c.id], fire: !!firePrev[c.id], streak: 0 }));
    const m = domino({ len: line.text.length, players: P, ulti: line.ulti });
    const same = res.chain.length === m.hits.length && res.chain.every((c, k) => c.from === m.hits[k].from && c.to === m.hits[k].to && c.applied === m.hits[k].applied && c.combo === m.hits[k].combo)
      && cs.every(c => res.hp[c.id] === m.hp[c.id]);
    if (same) okOracle++; else console.log('  P-01 mismatch round', r, JSON.stringify(res.chain.map(c => c.applied)), JSON.stringify(m.hits.map(h => h.applied)));
    firePrev = res.fire; hpPrev = res.hp;
  }
  check('P-01: 5 bots, done sent slowest-claim first (fastest arrives 1.2 s after the first): order by own elapsed', ok === 20, `${ok}/20 rounds ${bad}`);
  check('P-01/P-03: every link (from, to, applied, combo) and HP after = my oracle at the shipped config, 20 rounds', okOracle === 20, `${okOracle}/20`);
  // P-23: 6th..10th join fine, 11th refused (fresh lobby), start with 1 refused
  const L = await room(BASE, 10); const x = await new C(BASE, 'x').open(); x.send({ t: 'join', code: L[0].code, name: 'Eleven', skin: 0, v: 2 }); const e11 = await x.wait('error');
  check('P-23: 11th join -> error "Room penuh (maks 10 pemain)"; room still 10', e11.msg === 'Room penuh (maks 10 pemain)' && L[0].state.players.length === 10, e11.msg);
  const one = await new C(BASE, 'one').open(); one.send({ t: 'create', name: 'Solo', skin: 0, v: 2 }); await one.wait('joined'); one.send({ t: 'start' }); const e1 = await one.wait('error');
  check('P-23: start with 1 player refused, state stays lobby', /pemain/i.test(e1.msg) && one.state.state === 'lobby', e1.msg);
  [...cs, ...L, x, one].forEach(c => c.close()); s.stop(); }

// ============ S2: P-04 / P-19 / P-20 (HP 1: 3-way tie in front, two KOs) ============
if (want('p19')) { const s = server(BASE + 1, { ...fast, TK_HP: '1' }, 'ko'); await s.ready;
  const cs = await room(BASE + 1, 5, [0, 1, 2, 3, 0]); const code = cs[0].code, ids = cs.map(c => c.id);
  cs[0].send({ t: 'start' });
  const r1 = await round(cs, [{ i: 0, e: 2000 }, { i: 1, e: 2000 }, { i: 2, e: 2000 }, { i: 3, e: 3000 }, { i: 4, e: 4000 }]);
  check('setup: round 1 KOs exactly the two tail players (3-way tie in front hits nobody inside)', r1.res.ko.sort().join() === [ids[3], ids[4]].sort().join(), JSON.stringify(r1.res.ko));
  await until(() => cs[0].state.players.filter(p => p.out === 'ko').length === 2);
  // round 2: spectators
  const cds = await Promise.all(cs.map(c => c.wait('countdown'))); const ls = await Promise.all(cs.map(c => c.wait('line')));
  check('P-19: KO\'d players get the line with entrant:false; the three alive entrant:true', !ls[3].entrant && !ls[4].entrant && ls.slice(0, 3).every(l => l.entrant));
  cs[3].send({ t: 'done', round: ls[0].round, elapsed: 900, typos: 0 }); const sp = await cs[3].wait('error');
  check('P-19: a spectator\'s done -> error{code:"spectator"}', sp.code === 'spectator', JSON.stringify(sp));
  cs[4].send({ t: 'emoji', e: 5 }); const ems = await Promise.all(cs.map(c => c.wait('emoji', m => m.from === ids[4])));
  check('P-19: a spectator\'s emoji reaches all 5 sockets {from, e}', ems.every(m => m.e === 5));
  cs[0].send({ t: 'emoji', e: 2 }); await sleep(150); const ae = await cs[0].wait('error', () => true, 1000).catch(() => null);
  check('P-19: an alive player cannot throw emoji mid-match (error, not relayed)', !!ae && !cs[1].has('emoji', m => m.from === ids[0]));
  const t0 = Date.now(); cs[0].send({ t: 'done', round: ls[0].round, elapsed: 1000, typos: 0 }); cs[1].send({ t: 'done', round: ls[0].round, elapsed: 1500, typos: 0 }); cs[2].send({ t: 'done', round: ls[0].round, elapsed: 3000, typos: 0 });
  const r2 = await cs[0].wait('result', m => m.round === ls[0].round); const dt = r2._at - t0;
  check('P-04: the round closes when the 3 ALIVE players are done (2 spectators never send) — not at the cap', dt < 200, `${dt} ms after the 3rd done`);
  check('P-19: spectators are not in order[] and not in any link', !r2.order.some(o => o.id === ids[3] || o.id === ids[4]) && !r2.chain.some(c => [ids[3], ids[4]].includes(c.from) || [ids[3], ids[4]].includes(c.to)));
  const end = await cs[0].wait('end'); check('end{reason:"ko", winner} after round 2', end.reason === 'ko' && end.winner === ids[0], JSON.stringify(end));
  await until(() => cs[0].state.state === 'ended');
  for (const c of cs) c.send({ t: 'rematch' });
  const cd = await cs[0].wait('countdown', m => m.round === 1, 8000); await until(() => cs[0].state.state !== 'ended');
  const st = cs[0].state; const l1 = await cs[0].wait('line', m => m.round === 1);
  check('P-20: rematch: same room code and the same 5 ids and skins', st.code === code && st.players.map(p => p.id).join() === ids.join() && st.players.map(p => p.skin).join() === '0,1,2,3,0', JSON.stringify(st.players.map(p => p.skin)));
  check('P-20: rematch resets: HP = HP for everyone, out null (spectators play again), streak 0, fire false, round 1 plain', st.players.every(p => p.hp === 1 && p.out === null && p.streak === 0 && p.fire === false) && l1.form === 'plain' && /^[a-z0-9 ]+$/.test(l1.text));
  check('P-20: rematch: first ULTI scheduled in round 4-6 (state.ultiIn at round 1 = 3..5)', st.ultiIn >= 3 && st.ultiIn <= 5, String(st.ultiIn));
  cs.forEach(c => c.close()); s.stop(); }

// ============ S3: P-05 + P-10 at DEFAULT timers (21 s close, literal bounds) ============
if (want('p05')) { const s = server(BASE + 2, { TK_HP: '100000' }, 'defaults'); await s.ready;
  const cs = await room(BASE + 2, 4); cs[0].send({ t: 'start' });
  const cd = await cs[0].wait('countdown'); check('defaults: countdown ms 2400; cfg WORD_CAP 20000, CAP_SLACK 1000', cd.ms === 2400 && cs[0].state.cfg.WORD_CAP_MS === 20000, JSON.stringify(cs[0].state.cfg).slice(0, 200));
  const ln = await cs[0].wait('line', () => true, 6000);
  const bads = [149, 20001, -1, 0, 1.5, 'abc', '1200', null, undefined, 1e9]; const codes = [];
  for (const b of bads) { const o = { t: 'done', round: ln.round, typos: 0 }; if (b !== undefined) o.elapsed = b; cs[0].send(o); codes.push((await cs[0].wait('error')).code); }
  check('P-10 (defaults): elapsed 149, 20001, -1, 0, 1.5, "abc", "1200", null, missing, 1e9 -> bad_elapsed each', codes.every(c => c === 'bad_elapsed'), codes.join());
  const tb = []; for (const b of [-1, 100, 1.5, '0']) { cs[1].send({ t: 'done', round: ln.round, elapsed: 5000, typos: b }); tb.push((await cs[1].wait('error')).code); }
  check('P-24: typos -1, 100, 1.5, "0" -> bad_typos', tb.every(c => c === 'bad_typos'), tb.join());
  cs[0].send({ t: 'done', round: ln.round, elapsed: 150, typos: 0 }); cs[1].send({ t: 'done', round: ln.round, elapsed: 20000, typos: 1 });
  await sleep(300); check('P-10: 150 and 20000 accepted (no error)', !cs[0].has('error') && !cs[1].has('error'));
  cs[0].send({ t: 'done', round: ln.round, elapsed: 900, typos: 0 }); const dup = await cs[0].wait('error');
  check('P-24: second done in the round -> dup', dup.code === 'dup', JSON.stringify(dup));
  const offs = cs[0].state.serverTime - Date.now(); // rough; use revealAt with local clock (same box)
  await sleep(Math.max(0, ln.revealAt + 20600 - Date.now())); cs[2].send({ t: 'done', round: ln.round, elapsed: 19900, typos: 0 });
  const res = await cs[0].wait('result', () => true, 4000); const dt = res._at - ln.revealAt;
  check('P-05 (defaults): result at revealAt + 20000 + 1000 (+-200 ms) with one player unfinished', Math.abs(dt - 21000) <= 200, `${dt} ms`);
  const ord = res.order.map(o => o.id), id = cs.map(c => c.id);
  check('P-05: a done{19900} sent at revealAt+20.6 s counts (in order, rank 2)', ord.join() === [id[0], id[2], id[1], id[3]].join(), JSON.stringify(res.order));
  const last = res.chain.at(-1);
  check('P-05: the unfinished player is hit by the last finisher only, clean, d null, weight 1', res.chain.filter(c => c.to === id[3]).length === 1 && last.from === id[1] && last.to === id[3] && last.tier === 'clean' && last.d === null && last.weight === 1, JSON.stringify(last));
  cs[0].send({ t: 'done', round: ln.round, elapsed: 900, typos: 0 }); const st2 = await cs[0].wait('error'); check('P-24: done for a finished round -> stale', st2.code === 'stale');
  cs.forEach(c => c.close()); s.stop(); }

// ============ S4: P-11 / P-12 / P-13 / P-14 on the REAL bank (3 matches x 60 rounds + 1 x 150) ============
if (want('p11')) { const s = server(BASE + 3, { ...fast, TK_COUNTDOWN_MS: '60' }, 'bank'); await s.ready;
  let plainOk = 0, plainN = 0, fullOk = 0, fullN = 0, ultiOk = 0, ultiN = 0, normLenOk = 0; const gapsAll = []; let firstOk = 0, inOk = 0; const badTxt = [];
  async function match(rounds) { const cs = await room(BASE + 3, 2); cs[0].send({ t: 'start' }); const texts = [], ultis = []; let ultiInSeq = true, prevIn = null;
    for (let r = 1; r <= rounds; r++) { const { line, res } = await round(cs, [{ i: 0, e: 1000 }, { i: 1, e: 1000 + (r % 7) * 300, t: 1 }]);
      if (line.round !== r) throw new Error('round skew');
      texts.push(line.text); if (line.ulti) ultis.push(r);
      if (r <= 3) { plainN++; const ok = line.form === 'plain' && /^[a-z0-9 ]+$/.test(line.text) && !/ {2}|^ | $/.test(line.text) && PLAIN.has(line.text) && !line.ulti; ok ? plainOk++ : badTxt.push(line.text); }
      else { fullN++; if (line.form === 'full' && FULL.has(line.text)) fullOk++; else badTxt.push(line.text);
        if (line.ulti) { ultiN++; if (line.text.length >= 30) ultiOk++; } else if (line.text.length < 30) normLenOk++; }
      if (prevIn !== null && !(prevIn === 0 ? true : line.ultiIn === prevIn - 1)) ultiInSeq = false; if (line.ulti && line.ultiIn !== 0) ultiInSeq = false; prevIn = line.ultiIn;
      if (res.song && SONGLINES.get([...FULL].find(t => t === line.text || plain(t) === line.text))?.title !== res.song.title) badTxt.push('song:' + res.song.title);
    }
    cs.forEach(c => c.close()); return { texts, ultis, ultiInSeq }; }
  for (let m = 0; m < 3; m++) { const { texts, ultis, ultiInSeq } = await match(60);
    if (ultis[0] >= 4 && ultis[0] <= 6) firstOk++; if (ultiInSeq) inOk++;
    for (let k = 1; k < ultis.length; k++) gapsAll.push(ultis[k] - ultis[k - 1]);
    check(`P-14: match ${m + 1}, 60 rounds: no line repeats`, new Set(texts.map(plain)).size === texts.length); }
  check('P-11: rounds 1-3 (9 lines): plain form = lowercase [a-z0-9 ], single spaces, = plain form of a bank line, never ULTI', plainOk === plainN, `${plainOk}/${plainN} ${badTxt.slice(0, 3)}`);
  check('P-12: rounds >= 4: form "full", byte-for-byte a bank line', fullOk === fullN, `${fullOk}/${fullN}`);
  check('P-13: first ULTI in round 4-6 in 3/3 matches; ultiIn counts down to 0 on the ULTI round', firstOk === 3 && inOk === 3, `first ${firstOk}/3 ultiIn ${inOk}/3`);
  check('P-13: every gap between ULTIs is 4-6, and 4, 5, 6 are each seen', gapsAll.every(g => g >= 4 && g <= 6) && [4, 5, 6].every(g => gapsAll.includes(g)), gapsAll.join(','));
  check('P-13/brief: ULTI lines verbatim and >= 30 chars; normal rounds >= 4 < 30 chars', ultiOk === ultiN && normLenOk === fullN - ultiN, `ulti ${ultiOk}/${ultiN} normal ${normLenOk}/${fullN - ultiN}`);
  check('U-09 (server side): result.song is the song the shown line belongs to', !badTxt.some(x => String(x).startsWith('song:')), badTxt.filter(x => String(x).startsWith('song:')).slice(0, 2).join());
  { const { texts } = await match(150); check('P-14: one match of 150 rounds on the real bank: 150 distinct lines', new Set(texts.map(plain)).size === 150, String(new Set(texts.map(plain)).size)); }
  s.stop(); }

// ============ S5: P-17 B3 200/200 + P-18 (10 sockets, real bank, countdown 100 ms) ============
if (want('p17')) { const s = server(BASE + 4, { ...fast, TK_COUNTDOWN_MS: '100' }, 'b3'); await s.ready;
  const cs = await room(BASE + 4, 10); cs[0].send({ t: 'start' });
  let early = 0, arrEarly = 0, ident = 0, spreadMax = 0, n = 0, minGap = 1e9, minRecv = 1e9, rounds = 0, bankEnds = 0;
  while (n < 200) {
    const cds = await Promise.all(cs.map(c => c.wait('countdown', () => true, 10000)));
    await until(() => cs.every(c => c.has('line')) || cs[0].has('end'), 10000);
    if (cs[0].has('end')) { await until(() => cs.every(c => c.has('end'))); cs.forEach(c => c.drop('end')); bankEnds++; await until(() => cs.every(c => c.state.state === 'ended')); cs.forEach(c => c.send({ t: 'rematch' })); continue; }
    const ls = await Promise.all(cs.map(c => c.wait('line', () => true, 10000)));
    n++; const g = Math.min(...ls.map((l, i) => l.revealAt - cds[i].endsAt)); minGap = Math.min(minGap, g); if (g < 0) early++;
    const recv = Math.min(...ls.map((l, i) => l._at - cds[i]._at)); minRecv = Math.min(minRecv, recv); if (ls.some((l, i) => l._at < cds[i].endsAt)) arrEarly++;
    const key = l => JSON.stringify([l.round, l.text, l.form, l.ulti, l.ultiIn, l.revealAt, l.endsAt]); if (ls.every(l => key(l) === key(ls[0]))) ident++;
    spreadMax = Math.max(spreadMax, Math.max(...ls.map(l => l._at)) - Math.min(...ls.map(l => l._at)));
    cs.forEach((c, i) => c.send({ t: 'done', round: ls[0].round, elapsed: 2000 + 10 * i, typos: 0 }));
    const res = await cs[0].wait('result', m => m.round === ls[0].round, 10000);
    cs.slice(1).forEach(c => c.q = c.q.filter(m => m.t !== 'result'));
  }
  check('P-17 (B3): line.revealAt >= countdown.endsAt on all 10 sockets, 200/200 rounds', early === 0, `early ${early}/200, min revealAt-endsAt ${minGap} ms, matches ended by bank ${bankEnds}`);
  check('P-17 (B3): no line frame arrives before countdown.endsAt (local clock = server clock, same box); min countdown->line receive gap >= COUNTDOWN 100 - 20', arrEarly === 0 && minRecv >= 80, `frames early ${arrEarly}, min receive gap ${minRecv} ms`);
  check('P-18: identical line payload on all 10 sockets, 200/200; receive spread < 50 ms', ident === 200 && spreadMax < 50, `identical ${ident}/200, max spread ${spreadMax} ms`);
  cs.forEach(c => c.close()); s.stop(); }

// ============ S6: P-22 rejoin mid-round, rejoin bad token, rejoin during countdown; P-24 guards ============
if (want('p22')) { const s = server(BASE + 5, { ...fast, TK_COUNTDOWN_MS: '800', TK_RESULT_MS: '300' }, 'rejoin'); await s.ready;
  const cs = await room(BASE + 5, 5); cs[0].send({ t: 'start' });
  await round(cs, [0, 1, 2, 3, 4].map(i => ({ i, e: 2000 + 100 * i })));          // round 1, sets HP
  await until(() => cs[0].state.state === 'countdown' || cs[0].state.state === 'line');
  const ls = await Promise.all(cs.map(c => c.wait('line')));
  cs.forEach(c => c.drop('countdown'));
  const drop = cs[2], did = drop.id, tok = drop.token, code = drop.code, hpBefore = cs[0].state.players.find(p => p.id === did).hp, skin = cs[0].state.players.find(p => p.id === did).skin;
  drop.close(); await sleep(2000);
  const back = await new C(BASE + 5, 'back').open(); back.send({ t: 'rejoin', code, token: tok, v: 2 }); const j = await back.wait('joined'); await until(() => back.state);
  await sleep(150);
  check('P-22: rejoin by token mid-round -> same id, same HP, same skin', j.id === did && back.state.players.find(p => p.id === did).hp === hpBefore && back.state.players.find(p => p.id === did).skin === skin);
  check('P-22: the line is NOT re-sent to the rejoiner', !back.has('line'));
  back.send({ t: 'done', round: ls[0].round, elapsed: 2500, typos: 0 }); const st = await back.wait('error'); check('P-22: the rejoiner\'s done for that round -> stale', st.code === 'stale', JSON.stringify(st));
  cs[2] = back;
  const el = { 0: 2000, 1: 2600, 3: 3900, 4: 4000 }; for (const i of [0, 1, 3, 4]) cs[i].send({ t: 'done', round: ls[0].round, elapsed: el[i], typos: 1 });
  const res = await cs[0].wait('result', m => m.round === ls[0].round, 30000);
  const inc = res.chain.filter(c => c.to === did);
  check('P-22: the rejoiner is an entrant, unfinished (last rank), takes exactly one hit: clean from the last finisher, weight 1', res.order.at(-1).id === did && res.order.at(-1).elapsed === null && inc.length === 1 && inc[0].from === cs[4].id && inc[0].tier === 'clean', JSON.stringify(inc));
  const P = cs.map((c, i) => ({ id: c.id, seat: i, elapsed: el[i] ?? null, typos: 1, hp: 100000 - (100000 - (res.hp[c.id] + (res.chain.filter(x => x.to === c.id).reduce((a, x) => a + x.applied, 0)))), fire: false, streak: 0 }));
  const m = domino({ len: ls[0].text.length, players: P, ulti: ls[0].ulti });
  check('P-22: the other links equal my oracle with the rejoiner as unfinished', res.chain.length === m.hits.length && res.chain.every((c, k) => c.from === m.hits[k].from && c.to === m.hits[k].to && c.applied === m.hits[k].applied), JSON.stringify([res.chain.map(c => c.applied), m.hits.map(h => h.applied)]));
  // rejoin during countdown keeps endsAt
  const cd = await cs[0].wait('countdown', () => true, 5000); const victim = cs[3]; victim.close(); await sleep(150);
  const v2 = await new C(BASE + 5, 'v2').open(); v2.send({ t: 'rejoin', code, token: victim.token, v: 2 }); await v2.wait('joined');
  const cd2 = await v2.wait('countdown', () => true, 3000).catch(() => null);
  check('rejoin during the countdown: countdown re-sent with the SAME endsAt (+-5 ms) (1.0 P-41)', !!cd2 && Math.abs(cd2.endsAt - cd.endsAt) <= 5, cd2 ? `diff ${cd2.endsAt - cd.endsAt}` : 'no countdown re-sent');
  cs[3] = v2;
  const bt = await new C(BASE + 5, 'bt').open(); bt.send({ t: 'rejoin', code, token: '0'.repeat(32), v: 2 }); const rf = await bt.wait('rejoin_failed', () => true, 2000).catch(() => null);
  check('P-22/P-24: rejoin with a bad token -> rejoin_failed', !!rf);
  // P-24 guards
  const g = cs[0]; g.send('not json'); const ej = await g.wait('error'); check('P-24: malformed JSON -> error, socket stays open', /JSON/i.test(ej.msg) && !g.closed, ej.msg);
  g.send({ t: 'zzz_unknown' }); await sleep(200); check('P-27: unknown t -> no reply', !g.has('error'));
  const big = await new C(BASE + 5, 'big').open(); big.send('{"t":"ping","x":"' + 'a'.repeat(70000) + '"}'); await sleep(400);
  check('P-24: oversize frame (70 kB) -> that socket is closed (1009 or similar), others unaffected', big.closed && !g.closed, `closed ${big.closed} code ${big.closeCode}`);
  const h = await (await fetch(`http://127.0.0.1:${BASE + 5}/tinju/health`)).json(); check('server healthy after the guards', h.ok === true);
  [...cs, bt, big].forEach(c => c.close()); s.stop(); }

// ============ S7: P-15 boot validation (own mutated copies), P-16 SIGHUP on a live server ============
if (want('p15')) {
  const src = fs.readFileSync(path.join(T, 'server', 'lyrics.txt'), 'utf8');
  const songs = LY.parseBank(src).songs; // [{title, artist, lines}]
  const write = (name, ss) => { const f = path.join(TMP, name); fs.writeFileSync(f, ss.map(s => `${s.title} | ${s.artist}\n${s.lines.join('\n')}`).join('\n\n') + '\n'); return f; };
  const clone = () => JSON.parse(JSON.stringify(songs));
  const boot = (file, ms = 2500) => { const r = spawnSync(process.execPath, [SRVJS], { env: { PATH: process.env.PATH, PORT: String(BASE + 6), HOST: '127.0.0.1', TK_LYRICS: file }, timeout: ms, encoding: 'utf8' });
    return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), timedOut: r.error && r.error.code === 'ETIMEDOUT' }; };
  const syn = (k, i) => `kalimat uji nomor ${k} baris ${i} ya`.padEnd(20, 'x');
  const cases = [
    ['39 songs', s => { s.length = 39; }, /songs/],
    ['a 14-char line', s => { s[0].lines[0] = 'abcdefghijklmn'; }, /14/],
    ['a 46-char line', s => { s[0].lines[0] = 'q'.repeat(46); }, /46/],
    ['curly quote', s => { s[0].lines[0] = 'aku tak \u2019lupa\u2019 padamu ya'; }, /ASCII/i],
    ['double space', s => { s[0].lines[0] = 'aku  tak lupa padamu ya kawan'; }, /space|spasi/i],
    ['duplicate line', s => { s[1].lines[0] = s[0].lines[0]; }, /duplicate/i],
    ['149 lines < 30 (brief: >= 150)', s => { let short = s.flatMap(x => x.lines).filter(l => l.length < 30).length; for (const x of s) x.lines = x.lines.filter(l => { if (short > 149 && l.length < 30 && x.lines.length > 1) { short--; return false; } return true; }); }, /short|< ?30|150/i],
    ['39 lines >= 30 (brief: >= 40)', s => { let long = s.flatMap(x => x.lines).filter(l => l.length >= 30).length; for (const x of s) x.lines = x.lines.filter(l => { if (long > 39 && l.length >= 30 && x.lines.some(m => m.length < 30)) { long--; return false; } return true; }); }, /long|>= ?30|40/i],
  ];
  for (const [name, mut, re] of cases) { const s = clone(); mut(s); const b = boot(write('bad.txt', s)); check(`P-15: boot with ${name} -> exit 1, message names the rule`, b.code === 1 && re.test(b.out), `code ${b.code} :: ${b.out.split('\n').slice(0, 3).join(' / ').slice(0, 160)}`); }
  fs.writeFileSync(path.join(TMP, 'notitle.txt'), src.replace(/^Indonesia Raya \| W\.R\. Supratman\n/m, ''));
  let b = boot(path.join(TMP, 'notitle.txt')); check('P-15: a block without "title | artist" -> exit 1', b.code === 1, `code ${b.code} :: ${b.out.slice(0, 140)}`);
  fs.writeFileSync(path.join(TMP, 'empty.txt'), ''); b = boot(path.join(TMP, 'empty.txt')); check('P-15: empty file -> exit 1', b.code === 1, `code ${b.code}`);
  b = boot(path.join(TMP, 'missing-nope.txt')); check('P-15: missing file -> exit 1', b.code === 1, `code ${b.code} :: ${b.out.slice(0, 100)}`);
  // boundaries boot (they listen -> spawnSync times out with no exit 1)
  { const s = clone(); s[0].lines[0] = 'abcdefghijklmno'; s[1].lines[0] = 'Z'.repeat(45); const b2 = boot(write('edge.txt', s)); check('P-15: a 15-char and a 45-char line boot (boundaries)', b2.timedOut && /listening/.test(b2.out), b2.out.slice(-120)); }
  { const s = clone(); const extra = s.splice(40); extra.forEach((x, k) => s[k].lines.push(...x.lines)); const b2 = boot(write('forty.txt', s)); check('P-15: exactly 40 songs (all 255 lines kept) boots (boundary)', b2.timedOut && /listening/.test(b2.out), b2.out.slice(-160)); }
  { const s = clone(); let dropS = 11, dropL = 45; for (const x of s) x.lines = x.lines.filter((l, li) => { if (li === 0) return true; if (l.length < 30 && dropS > 0) { dropS--; return false; } if (l.length >= 30 && dropL > 0) { dropL--; return false; } return true; });
    const tot = s.reduce((n, x) => n + x.lines.length, 0); const b2 = boot(write('l199.txt', s)); check(`P-15: ${tot} lines total (short/long minima kept) -> exit 1 naming ">= 200 lines"`, tot === 199 && b2.code === 1 && /200 lines/.test(b2.out), `code ${b2.code} :: ${b2.out.slice(0, 140)}`);
    s[s.length - 1].lines.push('baris tambahan untuk dua ratus'.slice(0, 29)); const b3 = boot(write('l200.txt', s)); check('P-15: 200 lines boots (boundary)', b3.timedOut && /listening/.test(b3.out), b3.out.slice(-120)); }
  // P-16 SIGHUP: a completely new valid bank (40 synthetic songs, distinct lines) -> running match keeps old lines, next match only new lines
  const NEW = Array.from({ length: 40 }, (_, k) => ({ title: `Lagu Gerbang ${k}`, artist: 'A-na QA', lines: [0, 1, 2, 3].map(i => `gerbang ${k} baris ${i} ok`).concat([`Lagu Gerbang ${k}: baris panjang sekali, ya!`]) }));
  const live = path.join(TMP, 'live.txt'); fs.copyFileSync(path.join(T, 'server', 'lyrics.txt'), live);
  const s = server(BASE + 7, { ...fast, TK_COUNTDOWN_MS: '60', TK_LYRICS: live }, 'sighup'); await s.ready;
  const h0 = await (await fetch(`http://127.0.0.1:${BASE + 7}/tinju/health`)).json();
  const cs = await room(BASE + 7, 2); cs[0].send({ t: 'start' });
  for (let r = 0; r < 3; r++) await round(cs, [{ i: 0, e: 1000 }, { i: 1, e: 1500, t: 1 }]);
  write('newbank.txt', NEW); fs.copyFileSync(path.join(TMP, 'newbank.txt'), live); s.child.kill('SIGHUP'); await sleep(400);
  const h1 = await (await fetch(`http://127.0.0.1:${BASE + 7}/tinju/health`)).json();
  check('P-16: SIGHUP with a valid new bank -> process stays up, /health lyrics = 40 songs / 200 lines, log says reloaded', s.child.exitCode === null && h1.lyrics.songs === 40 && /reload/i.test(s.log()), JSON.stringify([h0.lyrics, h1.lyrics]));
  const oldTexts = []; for (let r = 0; r < 20; r++) { const { line } = await round(cs, [{ i: 0, e: 1000 }, { i: 1, e: 1500, t: 1 }]); oldTexts.push(line.text); }
  check('P-16: the running match keeps its snapshot: 20 more rounds, every line from the OLD bank', oldTexts.every(t => FULL.has(t) || PLAIN.has(t)), oldTexts.filter(t => !(FULL.has(t) || PLAIN.has(t))).slice(0, 2).join());
  cs.forEach(c => c.close());
  const cs2 = await room(BASE + 7, 2); cs2[0].send({ t: 'start' }); const newTexts = []; let songOk = true;
  for (let r = 0; r < 6; r++) { const { line, res } = await round(cs2, [{ i: 0, e: 1000 }, { i: 1, e: 1500, t: 1 }]); newTexts.push(line.text); if (!/^Lagu Gerbang/.test(res.song.title)) songOk = false; }
  check('P-16: the next match draws only from the new bank (lines + song card)', newTexts.every(t => /gerbang/i.test(t)) && songOk, newTexts.slice(0, 2).join(' / '));
  fs.writeFileSync(live, 'Rusak | Tanpa\nterlalu pendek\n'); s.child.kill('SIGHUP'); await sleep(400);
  const h2 = await (await fetch(`http://127.0.0.1:${BASE + 7}/tinju/health`)).json();
  check('P-16: SIGHUP with an invalid bank -> process stays up, keeps the new bank (40 songs), logs REJECTED', s.child.exitCode === null && h2.lyrics.songs === 40 && /REJECTED/i.test(s.log()), JSON.stringify(h2.lyrics));
  cs2.forEach(c => c.close()); s.stop(); }

await sleep(300); servers.forEach(s => { try { s.kill('SIGTERM'); } catch {} });
console.log(`\n== gate-proto ${TAG}: PASS ${pass} / FAIL ${fail} ==`);
process.exit(0);
