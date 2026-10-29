// Protocol test — Node >= 22 (global WebSocket). Usage: node test-proto.mjs <port>
const PORT = process.argv[2] || 3101, URL = `ws://127.0.0.1:${PORT}/bullscows/ws`;
let pass = 0, failN = 0;
const check = (name, ok, extra='') => { if (ok) pass++; else failN++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  ' + extra)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
class C {
  constructor(name) { this.name = name; this.state = null; this.msgs = []; this.waiters = []; }
  connect() { return new Promise((res, rej) => { this.ws = new WebSocket(URL); this.ws.onopen = () => res(this); this.ws.onerror = rej;
    this.ws.onmessage = e => { const m = JSON.parse(e.data); this.msgs.push(m); if (m.t === 'joined') { this.token = m.token; this.id = m.id; this.code = m.code; } if (m.t === 'state') this.state = m.room; this.waiters = this.waiters.filter(w => !w(m)); };
    this.ws.onclose = () => { this.closed = true; }; }); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, ms = 3000) { return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timeout waiting in ' + this.name)), ms); this.waiters.push(m => { if (pred(m)) { clearTimeout(t); res(m); return true; } return false; }); }); }
  async rpc(o, pred, ms) { const p = this.wait(pred || (m => m.t === 'state' || m.t === 'error'), ms); this.send(o); const r = await p; await sleep(60); return r; }
  err(o) { return this.rpc(o, m => m.t === 'error'); }
}
const me = c => c.state.players.find(p => p.id === c.id);
const turnOf = c => c.state.turn;
const whose = (cs) => cs.find(c => c.id === cs[0].state.turn);

// ---- scoring unit (replicates server) ----
const a = await new C('A').connect(), b = await new C('B').connect();
await a.rpc({ t: 'create', name: '  Pras<script> ' }, m => m.t === 'state');
check('create → lobby state with code', a.state.state === 'lobby' && /^[A-Z2-9]{5}$/.test(a.state.code), a.state.code);
check('name sanitized', me(a).name === 'Prasscript', me(a).name);
check('creator is host', a.state.hostId === a.id);
let e = await b.err({ t: 'join', code: 'ZZZZZ', name: 'B' }); check('join unknown room → error', /tidak ditemukan/.test(e.msg));
await b.rpc({ t: 'join', code: a.state.code.toLowerCase(), name: 'Budi' }, m => m.t === 'state');
check('join (lowercase code ok), 2 players', b.state.players.length === 2);
e = await a.err({ t: 'start' }); check('start before secrets → error names player', /belum memasang/.test(e.msg), e.msg);
e = await a.err({ t: 'secret', secret: '1123' }); check('secret with repeat digit rejected', /berbeda/.test(e.msg));
e = await a.err({ t: 'secret', secret: '12a4' }); check('secret non-digit rejected', !!e);
e = await a.err({ t: 'secret', secret: 1234 }); check('secret non-string rejected', !!e);
await a.rpc({ t: 'secret', secret: '3657' }); check('A secret set, visible only to A', a.state.you.secret === '3657');
await b.rpc({ t: 'secret', secret: '0123' }, m => m.t === 'state' && m.room.you.secret === '0123' || m.t === 'error'); check('B secret with leading zero accepted', b.state.you.secret === '0123');
await a.wait(m => m.t === 'state' && m.room.players.every(p => p.ready), 2000).catch(() => {});
check('B does not see A secret in lobby', b.state.players.find(p => p.id === a.id).secret === null && b.state.players.find(p => p.id === a.id).ready === true);
e = await b.err({ t: 'start' }); check('non-host start → error', /host/.test(e.msg));
e = await a.err({ t: 'guess', target: b.id, guess: '1234' }); check('guess in lobby → error', /belum dimulai/.test(e.msg));
await a.rpc({ t: 'start' }); await sleep(50);
check('start → playing, turn assigned to a player', a.state.state === 'playing' && [a.id, b.id].includes(a.state.turn));
check('history has start with order of 2', a.state.history[0].type === 'start' && a.state.history[0].order.length === 2);
check('deadline ≈ now + turnMs', Math.abs(a.state.turnDeadline - a.state.serverTime - a.state.turnMs) < 200);
e = await a.err({ t: 'secret', secret: '9876' }); check('secret change during play rejected', /tidak bisa diubah/.test(e.msg));
const cs = [a, b]; let cur = whose(cs), oth = cur === a ? b : a;
e = await oth.err({ t: 'guess', target: cur.id, guess: '1234' }); check('guess out of turn → error', /giliran/i.test(e.msg));
e = await cur.err({ t: 'guess', target: cur.id, guess: '1234' }); check('guess self → error', !!e);
e = await cur.err({ t: 'guess', target: oth.id, guess: '1223' }); check('guess repeated digit → error', /berbeda/.test(e.msg));
// scoring: secret of oth
const sec = oth.state.you.secret; // 3657 or 0123
const g1 = sec === '3657' ? '1234' : '3210'; // expected: 3657 vs 1234 → 0 bulls 1 cow (3), pattern x,x,y,x ; 0123 vs 3210 → 0 bulls 4 cows
await cur.rpc({ t: 'guess', target: oth.id, guess: g1 });
let h = cur.state.history.filter(x => x.type === 'guess').at(-1);
if (sec === '3657') check('score 3657 vs 1234 = 0 bull 1 cow, pattern xxyx', h.bulls === 0 && h.cows === 1 && h.pattern.join('') === 'xxyx', JSON.stringify(h));
else check('score 0123 vs 3210 = 0 bull 4 cow', h.bulls === 0 && h.cows === 4 && h.pattern.join('') === 'yyyy', JSON.stringify(h));
check('turn passed to other player', cur.state.turn === oth.id);
check('both see same history (public)', JSON.stringify(oth.state.history) === JSON.stringify(cur.state.history));
// other guesses
const sec2 = cur.state.you.secret, g2 = sec2 === '3657' ? '3124' : '0321';
await oth.rpc({ t: 'guess', target: cur.id, guess: g2 });
h = oth.state.history.filter(x => x.type === 'guess').at(-1);
if (sec2 === '3657') check('score 3657 vs 3124 = 1 bull 0 cow, pattern gxxx', h.bulls === 1 && h.cows === 0 && h.pattern.join('') === 'gxxx', JSON.stringify(h));
else check('score 0123 vs 0321 = 2 bull 2 cow, pattern gygy', h.bulls === 2 && h.cows === 2 && h.pattern.join('') === 'gygy', JSON.stringify(h));
// rate limit: flood 30 msgs
const flood = await new C('F').connect(); for (let i = 0; i < 40; i++) flood.send({ t: 'ping' }); await sleep(300);
check('rate limit closes flooding socket', flood.closed === true);
// oversized frame
const big = await new C('G').connect(); big.send(JSON.stringify({ t: 'ping', x: 'a'.repeat(5000) })); await sleep(300);
check('oversized frame closes socket', big.closed === true);
// rejoin: cur disconnects, reconnects with token
const curTok = cur.token, curCode = cur.code, curId = cur.id; cur.ws.close(); await sleep(150);
check('other sees cur offline', oth.state.players.find(p => p.id === curId).online === false);
const cur2 = await new C('A2').connect();
let rj = await cur2.rpc({ t: 'rejoin', code: curCode, token: 'bad' }, m => m.t === 'rejoin_failed' || m.t === 'state'); check('rejoin with bad token → rejoin_failed', rj.t === 'rejoin_failed');
await cur2.rpc({ t: 'rejoin', code: curCode, token: curTok }, m => m.t === 'state');
check('rejoin restores id, secret, online', cur2.id === curId && cur2.state.you.secret === sec2 && me(cur2).online === true);
// finish game: cur2 cracks oth
if (cur2.state.turn !== cur2.id) { await oth.rpc({ t: 'guess', target: cur2.id, guess: sec2 === '3657' ? '9876' : '9876' }); }
await cur2.rpc({ t: 'guess', target: oth.id, guess: sec }); await sleep(50);
check('4 bulls → cracked, game ended, winner = guesser', cur2.state.state === 'ended' && cur2.state.winnerId === cur2.id && oth.state.players.find(p => p.id === oth.id).cracked);
check('secrets revealed to all at end', oth.state.players.every(p => /^\d{4}$/.test(p.secret)));
e = await cur2.err({ t: 'guess', target: oth.id, guess: '1234' }); check('guess after end → error', !!e);
const hostC = cur2.id === a.id ? cur2 : oth, guestC = hostC === cur2 ? oth : cur2;
e = await guestC.err({ t: 'restart' }); check('non-host restart → error', /host/.test(e.msg));
await hostC.rpc({ t: 'restart' }); await sleep(30);
check('host restart → lobby, secrets cleared, players kept', hostC.state.state === 'lobby' && hostC.state.you.secret === null && hostC.state.players.length === 2 && guestC.state.players.every(p => !p.ready));
// kick
e = await guestC.err({ t: 'kick', id: hostC.id }); check('non-host kick → error', !!e);
const k = guestC.wait(m => m.t === 'kicked'); hostC.send({ t: 'kick', id: guestC.id }); await k; await sleep(30);
check('host kick → target gets kicked, room has 1 player', hostC.state.players.length === 1);
// leave → room destroyed
hostC.send({ t: 'leave' }); await hostC.wait(m => m.t === 'left'); await sleep(30);
const probe = await new C('P').connect(); e = await probe.err({ t: 'join', code: curCode, name: 'x' }); check('room destroyed after last player leaves', /tidak ditemukan/.test(e.msg));

// ---- 3 players: elimination, turn skipping, turn timeout, host transfer ----
const p1 = await new C('p1').connect(), p2 = await new C('p2').connect(), p3 = await new C('p3').connect();
await p1.rpc({ t: 'create', name: 'P1' }, m => m.t === 'state');
await p2.rpc({ t: 'join', code: p1.code, name: 'P2' }, m => m.t === 'state');
await p3.rpc({ t: 'join', code: p1.code, name: 'P3' }, m => m.t === 'state');
const extra = await new C('x').connect(); 
await p1.rpc({ t: 'secret', secret: '1234' }); await p2.rpc({ t: 'secret', secret: '5678' }); await p3.rpc({ t: 'secret', secret: '9012' });
await p1.rpc({ t: 'start' }); await sleep(50);
const ps = [p1, p2, p3]; const byId = id => ps.find(c => c.id === id);
check('3P start, order has 3 unique ids', new Set(p1.state.history[0].order).size === 3);
e = await extra.err({ t: 'join', code: p1.code, name: 'late' }); check('join while playing → error', /berjalan/.test(e.msg));
// turn timeout (server run with TURN_MS small)
const t0 = Date.now(); const firstTurn = p1.state.turn;
await p1.wait(m => m.t === 'state' && m.room.history.some(x => x.type === 'skip'), p1.state.turnMs + 1500);
check('turn timeout → skip logged, turn moved', p1.state.history.at(-1).type === 'skip' && p1.state.turn !== firstTurn, `${Date.now() - t0}ms`);
// now current player cracks next target
let c1 = byId(p1.state.turn); let tgt = ps.find(c => c !== c1);
const secrets = { [p1.id]: '1234', [p2.id]: '5678', [p3.id]: '9012' };
await c1.rpc({ t: 'guess', target: tgt.id, guess: secrets[tgt.id] }); await sleep(50);
check('3P: crack one → game continues (2 alive)', c1.state.state === 'playing' && c1.state.players.filter(p => p.cracked).length === 1);
check('cracked player secret revealed to all', p1.state.players.find(p => p.id === tgt.id).secret === secrets[tgt.id]);
e = await tgt.err({ t: 'guess', target: c1.id, guess: '0987' }); check('eliminated player cannot guess', !!e);
check('turn skips eliminated player', p1.state.turn !== tgt.id);
let c2 = byId(p1.state.turn); e = await c2.err({ t: 'guess', target: tgt.id, guess: '0987' }); check('guessing eliminated target → error', /sudah tertebak/.test(e.msg));
const c3 = ps.find(c => c !== c2 && c !== tgt);
await c2.rpc({ t: 'guess', target: c3.id, guess: secrets[c3.id] }); await sleep(50);
check('3P: last standing wins', p1.state.state === 'ended' && p1.state.winnerId === c2.id);
// host leaves → host transfers
const hostId = p1.state.hostId; const host = byId(hostId); host.send({ t: 'leave' }); await host.wait(m => m.t === 'left'); await sleep(50);
const rem = ps.find(c => c !== host);
check('host leave → host transferred to earliest joiner', rem.state.players.length === 2 && rem.state.hostId !== hostId && rem.state.players.find(p => p.isHost));
// health
const hres = await fetch(`http://127.0.0.1:${PORT}/bullscows/health`).then(r => r.json());
check('health reports rooms/players', hres.ok === true && hres.rooms >= 1 && hres.players >= 2, JSON.stringify(hres));
// bad upgrade path
const badws = new WebSocket(`ws://127.0.0.1:${PORT}/bullscows/nope`); const badRes = await new Promise(r => { badws.onerror = () => r('err'); badws.onopen = () => r('open'); });
check('upgrade on wrong path rejected', badRes === 'err');
console.log(`\n${pass} passed, ${failN} failed`); process.exit(failN ? 1 : 0);
