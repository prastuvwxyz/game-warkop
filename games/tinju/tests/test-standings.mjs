// Tinju Kata 2.1 standings tests. Usage: node test-standings.mjs [basePort=3301]
//   ST-1…ST-11  computeStandings() called directly (pure, no server)
//   SP-1…SP-4   the wire: end.standings, state.room.standings, rejoin end, leave, rematch, bank end
// Spawns its own servers on basePort..basePort+1. Ports 3100/3200 are never touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { makeChecker, startServer, Client, sleep } from './test-lib.mjs';
const require = createRequire(import.meta.url);
const E = require('../server/engine.js');
const { check, summary } = makeChecker('test-standings');

// ---------- ST: computeStandings ----------
const KO = (id, seat, round, rank, hp = 0) => ({ id, seat, alive: false, hp, kind: 'ko', outRound: round, outRank: rank, outAt: round * 1000 });
const WO = (id, seat, round, at) => ({ id, seat, alive: false, hp: 40, kind: 'walkover', outRound: round, outRank: null, outAt: at });
const AL = (id, seat, hp) => ({ id, seat, alive: true, hp, kind: null, outRound: null, outRank: null, outAt: null });
const places = rows => E.computeStandings(rows).map(r => r.id + ':' + r.place).join(' ');
const ids = rows => E.computeStandings(rows).map(r => r.id).join('');

check('ST-1 KOs in rounds 2/5/7 + a survivor -> reverse order of leaving', places([KO('a', 1, 2, 3), KO('b', 2, 5, 3), KO('c', 3, 7, 2), AL('d', 4, 30)]) === 'd:1 c:2 b:3 a:4');
check('ST-2 two KOs in one round: the earlier finisher (lower outRank) places higher', places([AL('w', 1, 50), KO('x', 2, 4, 3), KO('y', 3, 4, 2)]) === 'w:1 y:2 x:3');
check('ST-3 three KOs tied in one round -> 1, 2, 2, 2, 5', places([AL('w', 1, 10), KO('a', 2, 6, 2), KO('b', 3, 6, 2), KO('c', 4, 6, 2), KO('d', 5, 3, 1)]) === 'w:1 a:2 b:2 c:2 d:5');
check('ST-4 walkover and KO in the same round: the walkover is below, even with a worse KO rank', places([AL('w', 1, 10), WO('x', 2, 5, 9999), KO('y', 3, 5, 4)]) === 'w:1 y:2 x:3');
check('ST-4b a walkover in a later round still beats a KO from an earlier round', places([AL('w', 1, 10), WO('x', 2, 6, 1), KO('y', 3, 5, 1)]) === 'w:1 x:2 y:3');
check('ST-5 two walkovers in one round: the later leaver places higher', ids([AL('w', 1, 10), WO('x', 2, 3, 100), WO('y', 3, 3, 200)]) === 'wyx');
check('ST-6 bank: alive HP 70/40/40 then a KO\'d player -> 1, 2, 2, 4 and a KO below every survivor', places([AL('a', 1, 40), AL('b', 2, 70), AL('c', 3, 40), KO('d', 4, 9, 1)]) === 'b:1 a:2 c:2 d:4');
check('ST-7 cancelled by walkover with one left: that player is 1st, the leaver 2nd', places([AL('a', 1, 20), WO('b', 2, 3, 5)]) === 'a:1 b:2');
check('ST-8 the last two KO\'d together with equal rank -> shared 1st (no survivor)', places([KO('a', 1, 8, 1), KO('b', 2, 8, 1), KO('c', 3, 5, 1)]) === 'a:1 b:1 c:3');
check('ST-9 KO\'d then leaves: the row keeps kind ko and its round (kind comes from the first out)', places([AL('w', 1, 10), KO('x', 2, 4, 1), WO('y', 3, 4, 50)]) === 'w:1 x:2 y:3');
check('ST-10 unfinished KO\'d in one round share a rank -> share a place', places([AL('w', 1, 10), KO('a', 2, 3, 3), KO('b', 3, 3, 3), KO('c', 4, 3, 2)]) === 'w:1 c:2 a:3 b:3');
check('ST-11 out:"sat" players have no row (the server never passes them; 0 rows -> empty table)', E.computeStandings([]).length === 0);
{
  const rows = [KO('a', 1, 2, 3), AL('d', 4, 30)], before = JSON.stringify(rows);
  E.computeStandings(rows);
  check('ST: computeStandings does not mutate its input and is order-independent', JSON.stringify(rows) === before && ids([rows[1], rows[0]]) === ids(rows));
}

// ---------- SP: the wire ----------
const PORT = Number(process.argv[2] || 3301);
if ([3100, 3200].some(p => PORT <= p && p <= PORT + 3)) { console.error('refusing to use 3100/3200'); process.exit(2); }
const FAST = { TK_COUNTDOWN_MS: 120, TK_RESULT_MS: 20, TK_LINK_MS: 5, TK_TITLE_MS: 10, TK_WORD_CAP_MS: 3000, TK_CAP_SLACK_MS: 300, TK_WALKOVER_MS: 1500, TK_LOBBY_OFFLINE_MS: 1500 };
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'tinju-st-'));
const pad = (tag, len) => (tag + ' ' + 'abcdefghijklmnopqrstuvwxyz'.repeat(3)).slice(0, len);
const tiny = path.join(TMP, 'tiny.txt'); // 2 songs, 2 normal lines + 1 long each: the bag runs dry after a few rounds
fs.writeFileSync(tiny, [0, 1].map(i => `Mini ${i} | Fix\n${pad('m' + i + 'a', 18)}\n${pad('m' + i + 'b', 20)}\n${pad('m' + i + 'c', 36)}`).join('\n\n') + '\n');
const SV = {
  ko: startServer(PORT, { ...FAST }, 'server-standings-ko.log'),
  bank: startServer(PORT + 1, { ...FAST, TK_LYRICS: tiny, TK_MIN_SONGS: 1, TK_MIN_LINES: 1, TK_MIN_SHORT: 1, TK_MIN_LONG: 1, TK_HP: 100000, TK_ULTI_MIN: 90, TK_ULTI_MAX: 99, TK_PLAIN_ROUNDS: 0, TK_SEED: 4 }, 'server-standings-bank.log'),
};
await Promise.all(Object.values(SV).map(s => s.ready));
const clients = [];
const conn = async (port, name) => { const c = await new Client(port, name).open(); clients.push(c); return c; };
async function until(f, ms = 4000) { const end = Date.now() + ms; while (!f()) { if (Date.now() > end) throw new Error('until timeout: ' + f.toString().slice(0, 90)); await sleep(5); } }
async function mkRoom(port, n) {
  const A = await conn(port, 'P1'); A.send({ t: 'create', name: 'Alice', skin: 0, v: 2 }); await A.wait('joined'); const cs = [A];
  for (let i = 1; i < n; i++) { const c = await conn(port, 'P' + (i + 1)); c.send({ t: 'join', code: A.code, name: 'Pemain' + (i + 1), skin: i % 4, v: 2 }); await c.wait('joined'); cs.push(c); }
  await until(() => A.state && A.state.players.length === n);
  return cs;
}
async function round(cs, claims) { // claims: [{i, e}] ; returns the line round number
  const ls = []; for (const c of cs) ls.push(await c.wait('line', () => true, 8000));
  for (const k of claims) { cs[k.i].send({ t: 'done', round: ls[0].round, elapsed: k.e, typos: 0 }); await sleep(4); }
  for (const c of cs) await c.wait('result', () => true, 9000);
  return ls[0].round;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// SP-1: 3 players, cs[2] always slowest -> KO
{
  const cs = await mkRoom(SV.ko.port, 3); cs[0].send({ t: 'start' });
  let end = null;
  for (let k = 0; k < 60 && !end; k++) {
    const live = cs.filter(c => !c.closed && c.ws.readyState === 1);
    const claims = [{ i: 0, e: 400 }, { i: 1, e: 1900 }, { i: 2, e: 2900 }].filter(x => live.includes(cs[x.i]));
    await Promise.all(live.map(c => c.wait('countdown', () => true, 6000).catch(() => {})));
    await round(live, claims.map(x => ({ i: live.indexOf(cs[x.i]), e: x.e })));
    end = cs[0].q.find(m => m.t === 'end') || await cs[0].wait('end', () => true, 600).catch(() => null);
  }
  end = end || await cs[0].wait('end', () => true, 3000);
  await until(() => cs[0].state.state === 'ended');
  const st = end.standings;
  check('SP-1 end.standings: 3 rows sorted by place, winner 1st with out:null and hp, the KO\'d last with out:"ko" and a round', Array.isArray(st) && st.length === 3 && st[0].id === end.winner && st[0].place === 1 && st[0].out === null && st[2].id === cs[2].id && st[2].out === 'ko' && Number.isInteger(st[2].round) && st[2].hp === 0, JSON.stringify(st));
  check('SP-1 every row has id, name, skin, place, hp, out, round', st.every(r => ['id', 'name', 'skin', 'place', 'hp', 'out', 'round'].every(k => k in r)) && st[0].round === null);
  check('SP-1 state.room.standings (ended) deep-equals end.standings on every client', cs.every(c => same(c.state.standings, st)));
  const rj = await conn(SV.ko.port, 'rj'); rj.send({ t: 'rejoin', code: cs[1].code, token: cs[1].token, v: 2 });
  await rj.wait('joined'); const end2 = await rj.wait('end', () => true, 3000); await until(() => rj.state && rj.state.state === 'ended');
  check('SP-1 a rejoiner in ended gets the same table on the re-sent end and on state.room.standings', same(end2.standings, st) && same(rj.state.standings, st));
  check('SP-3a before the end, state.room.standings was null (first state of the room)', cs[0].all.filter(m => m.t === 'state' && m.room.state !== 'ended').every(m => m.room.standings === null));
  // SP-3: rematch -> null
  const voters = [cs[0], rj, cs[2]]; // rj replaced cs[1]'s socket (the server closes the old one)
  for (const c of voters) { c.clear(); c.send({ t: 'rematch' }); }
  await cs[0].wait('countdown', () => true, 4000); await sleep(40);
  check('SP-3 after a rematch starts, state.room.standings === null on every client', voters.every(c => c.state.state !== 'ended' && c.state.standings === null), JSON.stringify(cs[0].state.standings));
  for (const c of voters) c.close();
}
{ // SP-2: a player who leaves mid-match keeps a row (name, skin) after the ghost is deleted
  const cs = await mkRoom(SV.ko.port, 3); cs[0].send({ t: 'start' });
  for (const c of cs) await c.wait('countdown', () => true, 6000);
  const ls = []; for (const c of cs) ls.push(await c.wait('line', () => true, 8000));
  const leaver = cs[1]; leaver.send({ t: 'leave' }); await leaver.wait('left');
  const live = [cs[0], cs[2]];
  for (const [i, c] of live.entries()) c.send({ t: 'done', round: ls[0].round, elapsed: 500 + i * 900, typos: 0 });
  for (const c of live) await c.wait('result', () => true, 9000);
  // keep playing until the end (cs[2] slow -> KO)
  let end = null;
  for (let k = 0; k < 60 && !end; k++) {
    end = cs[0].q.find(m => m.t === 'end') || await cs[0].wait('end', () => true, 400).catch(() => null);
    if (end) break;
    const l = await Promise.all(live.map(c => c.wait('line', () => true, 8000).catch(() => null))); if (!l[0]) continue;
    live.forEach((c, i) => c.send({ t: 'done', round: l[0].round, elapsed: 400 + i * 1500, typos: 0 }));
    for (const c of live) await c.wait('result', () => true, 9000).catch(() => {});
  }
  end = end || await cs[0].wait('end', () => true, 3000);
  await until(() => cs[0].state && cs[0].state.state === 'ended' && cs[0].state.standings); // `end` is sent before the post-end state broadcast
  const row = end.standings.find(r => r.id === leaver.id);
  check('SP-2 the leaver still has a row with name and skin after the ghost is deleted from players', row && row.name === 'Pemain2' && row.skin === 1 && row.out === 'walkover' && Number.isInteger(row.round), JSON.stringify(end.standings));
  check('SP-2 the leaver is gone from state.players but present in state.room.standings; walkover places below the winner', !cs[0].state.players.some(p => p.id === leaver.id) && cs[0].state.standings.some(r => r.id === leaver.id) && end.standings[0].id !== leaver.id);
  for (const c of cs) c.close();
}
// SP-4: reason 'bank' (lyrics run out), nobody KO'd: survivors by HP desc, equal HP shares a place
{
  const cs = await mkRoom(SV.bank.port, 2); cs[0].send({ t: 'start' });
  let end = null;
  for (let k = 0; k < 20 && !end; k++) {
    await Promise.all(cs.map(c => c.wait('countdown', () => true, 6000)));
    const ls = await Promise.all(cs.map(c => c.wait('line', () => true, 8000).catch(() => null)));
    if (!ls[0]) { end = await cs[0].wait('end', () => true, 3000).catch(() => null); break; }
    cs[0].send({ t: 'done', round: ls[0].round, elapsed: 400, typos: 0 }); cs[1].send({ t: 'done', round: ls[0].round, elapsed: 400 + 80, typos: 0 });
    await Promise.all(cs.map(c => c.wait('result', () => true, 9000)));
    end = cs[0].q.find(m => m.t === 'end') || await cs[0].wait('end', () => true, 400).catch(() => null);
  }
  check('SP-4 the tiny bank ends the match with reason "bank"', end && end.reason === 'bank', JSON.stringify(end));
  const st = end && end.standings;
  check('SP-4 bank: both survive, rows ordered by HP desc (equal HP shares the place), out:null, round:null',
    st && st.length === 2 && st.every(r => r.out === null && r.round === null) && st[0].hp >= st[1].hp && st[0].place === 1 && (st[0].hp === st[1].hp ? st[1].place === 1 : st[1].place === 2), JSON.stringify(st));
  check('SP-4 bank: winner is the unique top HP, or null on equal HP, and the table agrees', end && (st[0].hp === st[1].hp ? end.winner === null : end.winner === st[0].id));
  for (const c of cs) c.close();
}

for (const s of Object.values(SV)) s.stop();
fs.rmSync(TMP, { recursive: true, force: true });
process.exit(summary() ? 1 : 0);
