// Tinju Kata protocol test. Usage: node test-proto.mjs [port=3201]   (needs Node >= 22 for global WebSocket)
// Spawns its own servers: MAIN on <port> (HP 10000, fast timings) and KO on <port>+1 (HP 100). Ports 3100/3200 are never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { DIR, sleep, makeChecker, startServer, Client } from './test-lib.mjs';

const PORT = Number(process.argv[2] || 3201), KOPORT = PORT + 1;
if ([3100, 3200].includes(PORT) || [3100, 3200].includes(KOPORT)) { console.error('refusing to use 3100/3200'); process.exit(2); }
const { check, summary } = makeChecker('test-proto');
const WORDS = createRequire(import.meta.url)('./words.js');

const main = startServer(PORT, { TK_COUNTDOWN_MS: 250, TK_RESULT_MS: 50, TK_GRACE_MS: 300, TK_WORD_CAP_MS: 3000, TK_WALKOVER_MS: 1500, TK_HP: 10000 }, `server-proto-main.log`);
const kos = startServer(KOPORT, { TK_COUNTDOWN_MS: 100, TK_RESULT_MS: 50, TK_GRACE_MS: 300, TK_WORD_CAP_MS: 3000, TK_WALKOVER_MS: 1500 }, `server-proto-ko.log`);
await Promise.all([main.ready, kos.ready]);

// ---------- helpers ----------
const clients = [];
async function conn(port, name) { const c = await new Client(port, name).open(); clients.push(c); return c; }
async function mkRoom(port = PORT) {
  const A = await conn(port, 'A'); A.send({ t: 'create', name: 'Alice', skin: 0 }); await A.wait('joined');
  const B = await conn(port, 'B'); B.send({ t: 'join', code: A.code, name: 'Budi', skin: 1 }); await B.wait('joined');
  await until(() => A.state && A.state.players.length === 2);
  return { A, B };
}
async function until(f, ms = 3000) { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('until timeout'); await sleep(5); } }
async function startM(A, B) { A.send({ t: 'start' }); const cd = await A.wait('countdown'); await B.wait('countdown'); return cd; }
async function nextWord(A, B) { const w = await A.wait('word', () => true, 8000); await B.wait('word'); return w; }
async function playRound(A, B, w, plan) {
  for (const k of (plan.first === 'b' ? ['b', 'a'] : ['a', 'b'])) {
    const P = k === 'a' ? A : B, d = plan[k];
    if (d) P.send({ t: 'done', round: w.round, elapsed: d[0], typos: d[1] });
    await sleep(6);
  }
  const ra = await A.wait('result', () => true, 8000); await B.wait('result', () => true, 8000); return ra;
}
const SKIP = { a: [500, 0], b: [500, 0] }; // equal elapsed + equal typos = draw, resolves instantly, no state change
async function untilWord(A, B, pred, plan) {
  for (let i = 0; i < 120; i++) {
    const w = await nextWord(A, B);
    if (pred(w)) return { w, res: await playRound(A, B, w, plan(w)) };
    await playRound(A, B, w, SKIP);
  }
  throw new Error('no suitable word found');
}
// independent re-implementation of the spec damage formula
const dmg = ({ len, margin, crit, combo, ulti }) => Math.min(60, Math.round(len * 3 * margin * (crit ? 1.5 : 1) * (combo ? 1.25 : 1) * (ulti ? 2.5 : 1)));
const isCrit = (len, el, typos) => typos === 0 && len * 1000 >= 5 * el;

// ---------- S0: word bank ----------
{
  const N = WORDS.normal, U = WORDS.ulti;
  check('words: >= 400 normal words', N.length >= 400, String(N.length));
  check('words: every normal word matches /^[a-z]{4,9}$/ and is unique', N.every(w => /^[a-z]{4,9}$/.test(w)) && new Set(N).size === N.length);
  check('words: >= 80 ulti words', U.length >= 80, String(U.length));
  check('words: every ulti word is 8-14 chars, >=1 uppercase, >=1 of - ! ? ,', U.every(w => /^[A-Za-z!?,\-]{8,14}$/.test(w) && /[A-Z]/.test(w) && /[-!?,]/.test(w)));
  check('words: ulti unique and no overlap with normal', new Set(U).size === U.length && !U.some(w => N.includes(w)));
}

// ---------- S1: http + lobby rules ----------
{
  const h = await (await fetch(`http://127.0.0.1:${PORT}/tinju/health`)).json();
  check('GET /tinju/health -> {ok,rooms,players,uptime}', h.ok === true && typeof h.rooms === 'number' && typeof h.players === 'number' && typeof h.uptime === 'number', JSON.stringify(h));
  const idx = await fetch(`http://127.0.0.1:${PORT}/tinju/`); const html = await idx.text();
  check('GET /tinju/ serves index.html with tinju-version meta', idx.status === 200 && html.includes('name="tinju-version"'));
  const A = await conn(PORT, 'A'); A.send({ t: 'create', name: 'Alice', skin: 2 }); const j = await A.wait('joined');
  check('create -> joined{code(5), token(32 hex), id(8 hex)}', /^[A-Z0-9]{5}$/.test(j.code) && /^[0-9a-f]{32}$/.test(j.token) && /^[0-9a-f]{8}$/.test(j.id), JSON.stringify(j));
  A.send({ t: 'create', name: 'X' }); const e0 = await A.wait('error');
  check('second create while in a room is rejected', /sudah di dalam room/.test(e0.msg));
  A.send({ t: 'start' }); const e1 = await A.wait('error');
  check('start with 1 player rejected', /pemain/i.test(e1.msg));
  const B = await conn(PORT, 'B'); B.send({ t: 'join', code: j.code, name: 'Budi', skin: 2 }); await B.wait('joined');
  await until(() => A.state.players.length === 2);
  const sk = A.state.players.map(p => p.skin);
  check('join with taken skin -> server assigns first free (0), skins differ', sk[0] === 2 && sk[1] === 0, JSON.stringify(sk));
  B.send({ t: 'skin', skin: 2 }); const e2 = await B.wait('error');
  check('skin change to a colour the opponent holds -> error', /sudah dipakai/.test(e2.msg));
  B.send({ t: 'skin', skin: 7 }); const e2b = await B.wait('error');
  check('skin out of range -> error', /tidak valid/.test(e2b.msg));
  B.send({ t: 'skin', skin: 3 }); await until(() => A.state.players[1].skin === 3);
  check('skin change to a free colour is broadcast', A.state.players[1].skin === 3);
  const C = await conn(PORT, 'C'); C.send({ t: 'join', code: j.code, name: 'Cici' }); const e3 = await C.wait('error');
  check('3rd join rejected: Room penuh (maks 2 pemain)', e3.msg === 'Room penuh (maks 2 pemain)', e3.msg);
  B.send({ t: 'start' }); const e4 = await B.wait('error');
  check('non-host start rejected', /host/i.test(e4.msg));
  await startM(A, B);
  C.send({ t: 'join', code: j.code, name: 'Cici' }); const e5 = await C.wait('error');
  check('join while match is running rejected', /sudah berjalan/.test(e5.msg));
  C.send({ t: 'rejoin', code: j.code, token: 'f'.repeat(32) }); await C.wait('rejoin_failed');
  check('rejoin with bad token -> rejoin_failed', true);
  C.send({ t: 'done', round: 1, elapsed: 500, typos: 0 }); const e6 = await C.wait('error');
  check('done before joining a room -> error', /Belum masuk room/.test(e6.msg));
  A.ws.send('not json'); const e7 = await A.wait('error'); check('invalid JSON -> error, connection survives', /JSON/.test(e7.msg) && !A.closed);
  A.send({ t: 'wat' }); const e8 = await A.wait('error'); check('unknown command -> error', /tidak dikenal/.test(e8.msg));
  A.send({ t: 'ping' }); const pg = await A.wait('pong'); check('ping -> pong{serverTime}', typeof pg.serverTime === 'number');
}

// ---------- S2: reveal timing, identical word, no leak ----------
{
  const { A, B } = await mkRoom();
  const cd = await startM(A, B);
  check('countdown{round:1, ms, endsAt, serverTime}', cd.round === 1 && cd.ms === 250 && cd.endsAt > cd.serverTime && typeof cd.serverTime === 'number', JSON.stringify(cd));
  const wa = await A.wait('word'), wb = await B.wait('word');
  check('no word before countdown.endsAt (server revealAt >= endsAt)', wa.revealAt >= cd.endsAt - 5 && wa._at >= cd.endsAt - 5, `revealAt-endsAt=${wa.revealAt - cd.endsAt}`);
  check('both players get the identical word in the same tick', wa.text === wb.text && wa.ulti === wb.ulti && wa.round === wb.round && Math.abs(wa._at - wb._at) < 50);
  check('word{round,text,ulti,ultiIn,revealAt,capMs} fields', wa.round === 1 && typeof wa.text === 'string' && typeof wa.ulti === 'boolean' && Number.isInteger(wa.ultiIn) && wa.capMs === 3000);
  const leak = [...A.all, ...B.all].filter(m => m.t === 'state').some(m => JSON.stringify(m).includes('"text"') || m.room.word !== undefined || JSON.stringify(m).includes(wa.text + '"'));
  check('state messages never contain the word text', !leak);
  check('state view carries cfg + you.id and no token', A.state.cfg.HP === 10000 && A.state.you.id === A.id && !JSON.stringify(A.state).includes(A.token));
}

// ---------- S3: winner by elapsed, not arrival ----------
{
  const { A, B } = await mkRoom();
  await startM(A, B); const w = await nextWord(A, B);
  const res = await playRound(A, B, w, { first: 'b', b: [900, 0], a: [500, 0] }); // B arrives FIRST with the larger elapsed
  check('winner = smaller elapsed (A) even though B arrived first', res.winner === A.id && res.elapsed[A.id] === 500 && res.elapsed[B.id] === 900, JSON.stringify(res));
  check('result fields complete', ['round', 'winner', 'tier', 'damage', 'margin', 'critical', 'combo', 'ulti', 'hp', 'elapsed', 'fire'].every(k => k in res));
  check('hp only drops for the loser', res.hp[A.id] === 10000 && res.hp[B.id] === 10000 - res.damage);
}

// ---------- S4: tiers (inclusive lower tier, O5), combo-free alternation ----------
{
  const { A, B } = await mkRoom();
  await startM(A, B);
  const cases = [[390, 'block', 0.5], [410, 'jab', 1], [1010, 'clean', 1.25], [400, 'block', 0.5], [1000, 'jab', 1]];
  let i = 0;
  for (const [gap, tier, margin] of cases) {
    const w = await nextWord(A, B);
    const aWins = i % 2 === 0; // alternate so nobody reaches 3 straight wins
    const plan = aWins ? { a: [500, 0], b: [500 + gap, 0] } : { b: [500, 0], a: [500 + gap, 0] };
    const res = await playRound(A, B, w, plan);
    const expected = dmg({ len: w.text.length, margin, crit: isCrit(w.text.length, 500, 0), combo: false, ulti: w.ulti });
    check(`tier at loser +${gap} ms -> ${tier} x${margin}`, res.tier === tier && res.margin === margin && res.winner === (aWins ? A.id : B.id), JSON.stringify(res));
    check(`  damage matches formula (len ${w.text.length}${w.ulti ? ', ulti' : ''}) = ${expected}`, res.damage === expected, String(res.damage));
    i++;
  }
}

// ---------- S5: critical gate + exact spec numbers (6-letter words) ----------
{
  const { A, B } = await mkRoom();
  await startM(A, B);
  const six = w => w.text.length === 6 && !w.ulti;
  let r = await untilWord(A, B, six, () => ({ a: [1225, 0], b: [1900, 0] }));
  check('critical: 6 letters at 1225 ms (4.9 cps) -> false, dmg 18', r.res.critical === false && r.res.damage === 18 && r.res.tier === 'jab', JSON.stringify(r.res));
  r = await untilWord(A, B, six, () => ({ b: [1200, 0], a: [2400, 0] }));
  check('critical: 6 letters at 1200 ms (5.0 cps) -> true', r.res.critical === true && r.res.winner === B.id);
  check('SPEC: "sepeda"-class 6 letters, won by 1200 vs 2400 ms, 0 typos = 34', r.res.damage === 34 && r.res.margin === 1.25 && r.res.tier === 'clean', JSON.stringify(r.res));
  r = await untilWord(A, B, six, () => ({ a: [1200, 1], b: [1500, 0] }));
  check('critical: 1 typo at 5.0 cps -> false', r.res.critical === false);
  check('SPEC: 6 letters, won by 300 ms with 1 typo = 9 (block x0.5)', r.res.damage === 9 && r.res.tier === 'block' && r.res.margin === 0.5, JSON.stringify(r.res));
}

// ---------- S6: cap 60 on an ulti round ----------
{
  const { A, B } = await mkRoom();
  await startM(A, B);
  const r = await untilWord(A, B, w => w.ulti, () => ({ a: [300, 0], b: [1900, 0] }));
  check('ulti word is flagged ulti:true in word and result, text has uppercase + punctuation', r.w.ulti && r.res.ulti && /[A-Z]/.test(r.w.text) && /[-!?,]/.test(r.w.text), r.w.text);
  check('SPEC: ulti clean + critical (calc 112+, "Kopi-Susu!" = 140.6) -> damage capped at 60', r.res.damage === 60 && r.res.critical && r.res.tier === 'clean', JSON.stringify(r.res));
  check('ulti first appears in round 4-6', r.w.round >= 4 && r.w.round <= 6, 'round ' + r.w.round);
}

// ---------- S7: combo ----------
{
  const { A, B } = await mkRoom();
  await startM(A, B);
  const out = [];
  for (let k = 0; k < 5; k++) { const w = await nextWord(A, B); const res = await playRound(A, B, w, { a: [500, 0], b: [1900, 0] }); out.push({ w, res }); }
  check('combo: fire false after wins 1 and 2', !out[0].res.fire[A.id] && !out[1].res.fire[A.id]);
  check('combo: 3rd straight win -> result.fire[A] true', out[2].res.fire[A.id] === true && out[2].res.combo === false);
  const o3 = out[3];
  check('combo: next win is x1.25 and fire clears after it', o3.res.combo === true && o3.res.fire[A.id] === false && o3.res.damage === dmg({ len: o3.w.text.length, margin: 1.25, crit: true, combo: true, ulti: o3.w.ulti }), JSON.stringify(o3.res));
  check('combo: round after the boosted hit is not boosted (one-round fire, O1)', out[4].res.combo === false && out[4].res.fire[A.id] === false);
  const sumHp = out.reduce((s, o) => s + o.res.damage, 0);
  check('combo: loser hp = HP - sum(damage)', out[4].res.hp[B.id] === 10000 - sumHp);
  // loser's streak resets
  const w5 = await nextWord(A, B); await playRound(A, B, w5, { b: [500, 0], a: [1900, 0] });
  await until(() => A.state.players.find(p => p.id === B.id).streak === 1 && A.state.players.find(p => p.id === A.id).streak === 0);
  check('streak: B wins once -> B streak 1, A streak reset to 0 (visible in state)', true);
}

// ---------- S8: draw, tie-break, rejected input, stale/dup ----------
{
  const { A, B } = await mkRoom();
  await startM(A, B);
  let w = await nextWord(A, B); await playRound(A, B, w, { a: [500, 0], b: [1900, 0] });
  await until(() => A.state.players.find(p => p.id === A.id).streak === 1);
  const hpBefore = A.state.players.find(p => p.id === B.id).hp;
  w = await nextWord(A, B);
  const t0 = Date.now();
  const rd = await A.wait('result', () => true, 8000); await B.wait('result');
  check('draw at cap: nobody sends -> result tier draw, winner null, damage 0', rd.tier === 'draw' && rd.winner === null && rd.damage === 0 && rd.margin === null, JSON.stringify(rd));
  check('draw at cap fires at WORD_CAP_MS (3000 +- 400)', Math.abs((Date.now() - t0) - 3000) < 400, String(Date.now() - t0));
  check('draw leaves hp, streak and fire unchanged', rd.hp[B.id] === hpBefore && rd.hp[A.id] === 10000 && A.state.players.find(p => p.id === A.id).streak === 1);
  // tie-break
  w = await nextWord(A, B);
  let res = await playRound(A, B, w, { first: 'b', b: [800, 0], a: [800, 2] }); // B (fewer typos) sent first AND A has more typos
  check('tie on elapsed: fewer typos wins', res.winner === B.id && res.tier === 'block', JSON.stringify(res));
  w = await nextWord(A, B);
  res = await playRound(A, B, w, { a: [800, 1], b: [800, 1] });
  check('tie on elapsed and typos -> Seri (draw), arrival order never decides', res.tier === 'draw' && res.winner === null);
  // rejected elapsed/typos
  w = await nextWord(A, B);
  const bad = [149, 3001, 20001, 'abc', 1.5, null];
  let allBad = true;
  for (const v of bad) { A.send({ t: 'done', round: w.round, elapsed: v, typos: 0 }); const e = await A.wait('error'); if (e.code !== 'bad_elapsed') allBad = false; }
  check('rejected elapsed: 149, cap+1, 20001, "abc", 1.5, null -> bad_elapsed', allBad);
  let allBadT = true;
  for (const v of [-1, 100, 1.5, 'x']) { A.send({ t: 'done', round: w.round, elapsed: 500, typos: v }); const e = await A.wait('error'); if (e.code !== 'bad_typos') allBadT = false; }
  check('rejected typos: -1, 100, 1.5, "x" -> bad_typos', allBadT);
  A.send({ t: 'done', round: w.round, elapsed: 600, typos: 0 }); A.send({ t: 'done', round: w.round, elapsed: 600, typos: 0 });
  const ed = await A.wait('error'); check('second done from the same player -> dup', ed.code === 'dup', JSON.stringify(ed));
  B.send({ t: 'done', round: w.round, elapsed: 900, typos: 0 });
  res = await A.wait('result'); await B.wait('result');
  check('round still resolves after rejected inputs (valid dones count)', res.winner === A.id && res.elapsed[A.id] === 600 && res.elapsed[B.id] === 900);
  A.send({ t: 'done', round: w.round + 1, elapsed: 500, typos: 0 }); const es = await A.wait('error');
  check('done during result/countdown (no word yet) -> stale, no toast code path', es.code === 'stale');
  w = await nextWord(A, B);
  A.send({ t: 'done', round: w.round - 1, elapsed: 500, typos: 0 }); const es2 = await A.wait('error');
  check('done for an old round -> stale', es2.code === 'stale');
  const mid = await playRound(A, B, w, { a: [500, 0], b: [700, 0] });
  check('stale input left the round untouched (resolved normally)', mid.winner === A.id);
}

// ---------- S9: 100 rounds: no repeated word + ulti schedule 4-6 ----------
{
  const { A, B } = await mkRoom();
  await startM(A, B);
  const seq = [];
  for (let k = 0; k < 100; k++) { const w = await nextWord(A, B); seq.push(w); await playRound(A, B, w, SKIP); }
  check('100 rounds: all word.text distinct (no repeats in a match)', new Set(seq.map(w => w.text)).size === 100);
  check('100 rounds: normal words match the bank rule, ulti words match the ulti rule', seq.every(w => w.ulti ? WORDS.ulti.includes(w.text) : WORDS.normal.includes(w.text)));
  const ur = seq.filter(w => w.ulti).map(w => w.round);
  check('ulti schedule: first ulti in round 4-6', ur[0] >= 4 && ur[0] <= 6, JSON.stringify(ur));
  const gaps = ur.slice(1).map((r, i) => r - ur[i]);
  check(`ulti schedule: all ${gaps.length} gaps between ulti rounds are 4-6`, gaps.length >= 12 && gaps.every(g => g >= 4 && g <= 6), JSON.stringify(gaps));
  check('ultiIn: 0 exactly on ulti rounds, counts down 5..0 between them', seq.every((w, i) => (w.ultiIn === 0) === w.ulti) && seq.every((w, i) => i === 0 || w.ulti || w.ultiIn === seq[i - 1].ultiIn - 1 || seq[i - 1].ulti));
  check('ultiIn === 1 in the round just before every ulti round ("Ulti berikutnya!")', ur.every(r => seq[r - 2].ultiIn === 1));
}

// ---------- S10: rejoin ----------
{
  const { A, B } = await mkRoom();
  await startM(A, B);
  let w = await nextWord(A, B);
  A.close(); await until(() => B.state && !B.state.players.find(p => p.id === A.id).online);
  const A2 = await conn(PORT, 'A2'); A2.send({ t: 'rejoin', code: A.code, token: A.token }); const j = await A2.wait('joined');
  check('rejoin mid-round -> joined with the same id/token', j.id === A.id && j.token === A.token);
  await sleep(500);
  check('rejoin mid-round: word is NOT re-sent', !A2.has('word'));
  A2.send({ t: 'done', round: w.round, elapsed: 600, typos: 0 }); const e = await A2.wait('error');
  check("rejoin mid-round: A's done is stale this round", e.code === 'stale');
  B.send({ t: 'done', round: w.round, elapsed: 900, typos: 0 });
  const res = await B.wait('result'); await A2.wait('result');
  check('rejoined round: B wins (A counted as not finished), clean tier', res.winner === B.id && res.tier === 'clean' && res.elapsed[A.id] === null);
  const w2 = await A2.wait('word', () => true, 6000); await B.wait('word');
  check('next round is normal: A2 receives the word again', w2.round === w.round + 1);
  const r2 = await playRound(A2, B, w2, { a: [500, 0], b: [900, 0] });
  check('A2 plays and wins the next round', r2.winner === A.id);
}
{
  const { A, B } = await mkRoom();
  const cd = await startM(A, B);
  A.close();
  const A2 = await conn(PORT, 'A2'); A2.send({ t: 'rejoin', code: A.code, token: A.token }); await A2.wait('joined');
  const cd2 = await A2.wait('countdown', () => true, 1500);
  check('rejoin during countdown -> countdown re-sent with the same round/endsAt', cd2.round === cd.round && cd2.endsAt === cd.endsAt, JSON.stringify([cd.endsAt, cd2.endsAt]));
  const w = await A2.wait('word', () => true, 3000); await B.wait('word');
  check('rejoin during countdown -> word arrives to both afterwards', w.round === 1 && w.revealAt >= cd.endsAt - 5);
}

// ---------- S11: walkover ----------
{
  const { A, B } = await mkRoom();
  await startM(A, B); await nextWord(A, B);
  const t0 = Date.now(); A.close();
  const end = await B.wait('end', () => true, 5000); const dt = end._at - t0;
  check('walkover: A offline -> end{winner:B, reason:walkover} after ~WALKOVER_MS', end.winner === B.id && end.reason === 'walkover' && dt >= 1300 && dt <= 2600, `dt=${dt}`);
  check('walkover: state ended, winnerId + endReason set', B.state.state === 'ended' && B.state.winnerId === B.id && B.state.endReason === 'walkover');
}
{
  const { A, B } = await mkRoom();
  await startM(A, B); await nextWord(A, B);
  A.close(); B.close(); await sleep(2300);
  const B2 = await conn(PORT, 'B2'); B2.send({ t: 'rejoin', code: A.code, token: B.token }); await B2.wait('joined');
  await until(() => B2.state && B2.state.state === 'ended');
  check('both players offline for WALKOVER_MS -> ended, winner null, walkover', B2.state.winnerId === null && B2.state.endReason === 'walkover');
}
{
  const { A, B } = await mkRoom();
  await startM(A, B); await nextWord(A, B);
  const t0 = Date.now(); B.send({ t: 'leave' });
  const end = await A.wait('end'); await B.wait('left');
  check('leave mid-match -> immediate walkover for the opponent (< 400 ms)', end.winner === A.id && end.reason === 'walkover' && end._at - t0 < 400, String(end._at - t0));
}

// ---------- S12: KO + rematch (server with HP 100) ----------
async function playToKo(A, B, firstWord) {
  const rounds = [];
  for (let k = 0; k < 30; k++) {
    const w = (k === 0 && firstWord) ? firstWord : await nextWord(A, B);
    const res = await playRound(A, B, w, { a: [300, 0], b: null });
    rounds.push({ w, res });
    if (res.hp[B.id] <= 0) break;
  }
  return rounds;
}
{
  const { A, B } = await mkRoom(KOPORT);
  await startM(A, B);
  const rounds = await playToKo(A, B);
  const last = rounds[rounds.length - 1];
  const tRes = last.res._at;
  const end = await A.wait('end', () => true, 3000); await B.wait('end');
  check('KO: hp reaches 0 and no end message before that', last.res.hp[B.id] === 0 && rounds.length >= 2 && !A.all.some(m => m.t === 'end' && m._at < tRes));
  check('KO: end{winner:A, reason:ko, hp} arrives RESULT_MS after the last result', end.winner === A.id && end.reason === 'ko' && end.hp[B.id] === 0 && end._at - tRes >= 30 && end._at - tRes < 400, `dt=${end._at - tRes}`);
  await until(() => A.state.state === 'ended');
  check('KO: state ended with winnerId/endReason', A.state.winnerId === A.id && A.state.endReason === 'ko');
  B.send({ t: 'rematch' });
  await until(() => B.state.players.find(p => p.id === B.id).rematch);
  await sleep(350);
  check('rematch: one vote waits (state stays ended, vote visible)', A.state.state === 'ended' && A.state.players.find(p => p.id === B.id).rematch === true);
  A.clear(); B.clear();
  A.send({ t: 'rematch' });
  const cd = await A.wait('countdown'); await B.wait('countdown');
  await until(() => A.state.state === 'countdown' && A.state.round === 1);
  const ps = A.state.players;
  check('rematch: both voted -> countdown round 1, hp = HP, streak/fire/rematch cleared', cd.round === 1 && ps.every(p => p.hp === 100 && p.streak === 0 && p.fire === false && p.rematch === false), JSON.stringify(ps));
  check('rematch: new ulti schedule (ultiIn at round 1 in 3..5 => ulti round 4-6)', A.state.ultiIn >= 3 && A.state.ultiIn <= 5, String(A.state.ultiIn));
  const w = await nextWord(A, B);
  check('rematch: the new match delivers a word', w.round === 1);
  // second KO, then: vote, go offline, wait, rejoin
  const rounds2 = await playToKo(A, B, w); await A.wait('end'); await B.wait('end');
  await until(() => A.state.state === 'ended');
  A.send({ t: 'rematch' }); await until(() => B.state.players.find(p => p.id === A.id).rematch);
  A.close(); await until(() => !B.state.players.find(p => p.id === A.id).online);
  B.clear(); B.send({ t: 'rematch' }); await sleep(400);
  check('rematch while opponent offline: both voted but waits (no countdown)', !B.has('countdown') && B.state.state === 'ended');
  const A2 = await conn(KOPORT, 'A2'); A2.send({ t: 'rejoin', code: A.code, token: A.token }); await A2.wait('joined');
  const cd3 = await A2.wait('countdown', () => true, 2000);
  check('rematch: starts as soon as the offline voter rejoins', cd3.round === 1);
  const rounds3 = await playToKo(A2, B); await A2.wait('end'); await B.wait('end');
  await until(() => A2.state.state === 'ended');
  B.send({ t: 'leave' }); await B.wait('left');
  await until(() => A2.state.state === 'lobby' && A2.state.players.length === 1);
  check('opponent leaves from the end screen -> remaining player back in lobby alone', A2.state.state === 'lobby' && A2.state.players.length === 1 && A2.state.players[0].hp === 100);
}

// ---------- S14: the literal spec words ("sepeda", "Kopi-Susu!") on a server copy with a fixed bag order ----------
// The production server shuffles the bag. Here a temp COPY has shuffle() replaced by identity and words.js reordered so that
// the LAST element (the first one popped) is "sepeda" / "Kopi-Susu!". Nothing else in server.js is touched.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tinju-fixed-'));
  let src = fs.readFileSync(path.join(DIR, 'server.js'), 'utf8');
  const re = /function shuffle\(a\) \{[^\n]*\}\n/;
  const patched = re.test(src);
  src = src.replace(re, 'function shuffle(a) { return a; }\n');
  fs.writeFileSync(path.join(tmp, 'server.js'), src);
  fs.mkdirSync(path.join(tmp, 'public')); fs.writeFileSync(path.join(tmp, 'public', 'index.html'), 'x');
  const normal = WORDS.normal.filter(w => w !== 'sepeda').concat(['sepeda']);
  const ulti = WORDS.ulti.filter(w => w !== 'Kopi-Susu!').concat(['Kopi-Susu!']);
  fs.writeFileSync(path.join(tmp, 'words.js'), 'module.exports=' + JSON.stringify({ normal, ulti }) + ';');
  const fx = startServer(PORT + 2, { TK_COUNTDOWN_MS: 100, TK_RESULT_MS: 50, TK_GRACE_MS: 300, TK_WORD_CAP_MS: 3000, TK_HP: 10000, TK_ULTI_MIN: 4, TK_ULTI_MAX: 4 }, 'server-proto-fixed.log', tmp);
  await fx.ready;
  check('fixed-bag copy: only shuffle() was replaced (identity)', patched);
  {
    const { A, B } = await mkRoom(PORT + 2); await startM(A, B); const w = await nextWord(A, B);
    const res = await playRound(A, B, w, { a: [1200, 0], b: [2400, 0] });
    check('SPEC EXACT: "sepeda" won by 1200 ms vs 2400 ms, 0 typos = 34', w.text === 'sepeda' && res.damage === 34 && res.critical && res.tier === 'clean' && res.margin === 1.25, JSON.stringify([w.text, res]));
  }
  {
    const { A, B } = await mkRoom(PORT + 2); await startM(A, B); const w = await nextWord(A, B);
    const res = await playRound(A, B, w, { a: [1200, 1], b: [1500, 0] });
    check('SPEC EXACT: "sepeda" won by 300 ms with 1 typo = 9', w.text === 'sepeda' && res.damage === 9 && !res.critical && res.tier === 'block', JSON.stringify([w.text, res]));
  }
  {
    const { A, B } = await mkRoom(PORT + 2); await startM(A, B);
    for (let k = 1; k <= 3; k++) { const w = await nextWord(A, B); await playRound(A, B, w, SKIP); }
    const w = await nextWord(A, B);
    const res = await playRound(A, B, w, { a: [300, 0], b: [1900, 0] });
    check('SPEC EXACT: ulti "Kopi-Susu!" (round 4) clean + critical = 60 (raw 140.6, capped)', w.round === 4 && w.ulti && w.text === 'Kopi-Susu!' && res.damage === 60 && res.critical && res.tier === 'clean', JSON.stringify([w.text, res]));
  }
  fx.stop(); fs.rmSync(tmp, { recursive: true, force: true });
}

// ---------- S13: boot validation ----------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tinju-boot-'));
  fs.copyFileSync(path.join(DIR, 'server.js'), path.join(tmp, 'server.js'));
  fs.mkdirSync(path.join(tmp, 'public')); fs.writeFileSync(path.join(tmp, 'public', 'index.html'), 'x');
  fs.writeFileSync(path.join(tmp, 'words.js'), "module.exports={normal:['abc','Halo'],ulti:['nopunct']};");
  const r = spawnSync(process.execPath, [path.join(tmp, 'server.js')], { env: { ...process.env, PORT: String(KOPORT + 5) }, encoding: 'utf8', timeout: 5000 });
  check('boot with invalid words.js exits 1 and names the failed rules', r.status === 1 && /normal: need >= 400/.test(r.stderr) && /ulti: need 8-14/.test(r.stderr), `status=${r.status} ${r.stderr.slice(0, 120)}`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

for (const c of clients) c.close();
main.stop(); kos.stop();
await sleep(100);
const failed = summary();
process.exit(failed ? 1 : 0);
