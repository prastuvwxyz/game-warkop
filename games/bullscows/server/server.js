'use strict';
// Bulls & Cows — multiplayer server. Node >= 20, zero dependencies.
// HTTP: GET <BASE>/ -> ../index.html + ../src/*, GET <BASE>/health -> JSON.
// WS:   <BASE>/ws (RFC 6455, text frames only, JSON messages).
const crypto = require('crypto');
const { send, upgrade } = require('../shared/server/ws.js');
const { createHttpServer } = require('../shared/server/static.js');
const path = require('path');

const PORT = Number(process.env.PORT || 3100);
const HOST = process.env.HOST || '127.0.0.1';
const BASE = (process.env.BASE || '/bullscows').replace(/\/$/, '');
const TURN_MS = Number(process.env.TURN_MS || 75000);
const MAX_ROOMS = 500, MAX_PLAYERS = 6, MIN_PLAYERS = 2;
const ROOM_IDLE_MS = 2 * 3600e3, ROOM_ALL_OFFLINE_MS = 10 * 60e3, LOBBY_OFFLINE_GRACE_MS = 60e3;

const ROOT = path.join(__dirname, '..'); // games/<slug>/ — index.html, src/, shared/
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- game logic ----------
function validNumber(s) { return typeof s === 'string' && /^\d{4}$/.test(s) && new Set(s).size === 4; }
function score(secret, guess) {
  let bulls = 0, cows = 0; const pattern = [];
  for (let i = 0; i < 4; i++) {
    if (guess[i] === secret[i]) { bulls++; pattern.push('g'); }
    else if (secret.includes(guess[i])) { cows++; pattern.push('y'); }
    else pattern.push('x');
  }
  return { bulls, cows, pattern };
}
function makeCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = ''; const b = crypto.randomBytes(5);
    for (let i = 0; i < 5; i++) c += CODE_ALPHA[b[i] % CODE_ALPHA.length];
    if (!rooms.has(c)) return c;
  }
  return null;
}
function cleanName(n) {
  n = String(n == null ? '' : n).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 16);
  return n || 'Pemain';
}
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }

function newRoom(hostName) {
  const code = makeCode(); if (!code) return null;
  const room = { code, hostId: null, state: 'lobby', players: new Map(), order: [], turnIdx: 0,
    turnDeadline: 0, turnTimer: null, history: [], winnerId: null, round: 0,
    createdAt: Date.now(), lastActivity: Date.now(), allOfflineSince: null };
  rooms.set(code, room);
  return room;
}
function addPlayer(room, name, ws) {
  const id = crypto.randomBytes(4).toString('hex'), token = crypto.randomBytes(16).toString('hex');
  const p = { id, token, name: cleanName(name), secret: null, ws, cracked: false, crackedBy: null,
    online: true, offlineSince: null, leaveTimer: null, joinedAt: Date.now() };
  room.players.set(id, p);
  if (!room.hostId) room.hostId = id;
  return p;
}
function alive(room) { return [...room.players.values()].filter(p => !p.cracked); }
function touch(room) { room.lastActivity = Date.now(); }

function view(room, me) {
  const ended = room.state === 'ended';
  return {
    code: room.code, state: room.state, hostId: room.hostId, round: room.round,
    you: me ? { id: me.id, secret: me.secret } : null,
    players: [...room.players.values()].map(p => ({
      id: p.id, name: p.name, online: p.online, ready: !!p.secret, cracked: p.cracked, crackedBy: p.crackedBy,
      secret: (ended || p.cracked) ? p.secret : null, isHost: p.id === room.hostId })),
    turn: room.state === 'playing' ? room.order[room.turnIdx] : null,
    turnDeadline: room.state === 'playing' ? room.turnDeadline : null,
    turnMs: TURN_MS,
    history: room.history, winnerId: room.winnerId,
    minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, serverTime: Date.now(),
  };
}
function broadcast(room) {
  for (const p of room.players.values()) if (p.ws) send(p.ws, { t: 'state', room: view(room, p) });
}

function startTurnTimer(room) {
  clearTimeout(room.turnTimer);
  room.turnDeadline = Date.now() + TURN_MS;
  room.turnTimer = setTimeout(() => {
    if (room.state !== 'playing') return;
    const pid = room.order[room.turnIdx]; const p = room.players.get(pid);
    room.history.push({ type: 'skip', by: pid, byName: p ? p.name : '?', at: Date.now() });
    advanceTurn(room); broadcast(room);
  }, TURN_MS);
}
function advanceTurn(room) {
  const n = room.order.length;
  for (let k = 1; k <= n; k++) {
    const idx = (room.turnIdx + k) % n; const p = room.players.get(room.order[idx]);
    if (p && !p.cracked) { room.turnIdx = idx; startTurnTimer(room); return; }
  }
  endGame(room, null);
}
function endGame(room, winnerId) {
  clearTimeout(room.turnTimer); room.turnTimer = null;
  room.state = 'ended'; room.winnerId = winnerId; room.turnDeadline = 0;
  room.history.push({ type: 'end', winnerId, at: Date.now() });
}
function startGame(room) {
  room.state = 'playing'; room.round++;
  room.history = []; room.winnerId = null;
  for (const p of room.players.values()) { p.cracked = false; p.crackedBy = null; }
  room.order = shuffle([...room.players.keys()]);
  room.turnIdx = 0;
  room.history.push({ type: 'start', order: room.order.map(id => room.players.get(id).name), at: Date.now() });
  startTurnTimer(room);
}
function resetToLobby(room) {
  clearTimeout(room.turnTimer); room.turnTimer = null;
  room.state = 'lobby'; room.history = []; room.winnerId = null; room.order = []; room.turnIdx = 0;
  for (const p of room.players.values()) { p.secret = null; p.cracked = false; p.crackedBy = null; }
}
function removePlayer(room, p) {
  clearTimeout(p.leaveTimer);
  room.players.delete(p.id);
  if (room.players.size === 0) { destroyRoom(room); return; }
  if (room.hostId === p.id) room.hostId = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
  if (room.state === 'playing') {
    room.order = room.order.filter(id => id !== p.id);
    if (room.turnIdx >= room.order.length) room.turnIdx = 0;
    const a = alive(room);
    if (a.length <= 1) endGame(room, a.length === 1 ? a[0].id : null);
    else { room.turnIdx = (room.turnIdx - 1 + room.order.length) % room.order.length; advanceTurn(room); }
  }
}
function destroyRoom(room) { clearTimeout(room.turnTimer); for (const p of room.players.values()) clearTimeout(p.leaveTimer); rooms.delete(room.code); }

// ---------- message handling ----------
function fail(ws, msg) { send(ws, { t: 'error', msg }); }
function handle(ws, m) {
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return fail(ws, 'Pesan tidak valid');
  const ctx = ws.ctx; // {room, player}
  if (m.t === 'ping') return send(ws, { t: 'pong', serverTime: Date.now() });
  if (m.t === 'create') {
    if (ctx.room) return fail(ws, 'Kamu sudah di dalam room');
    if (rooms.size >= MAX_ROOMS) return fail(ws, 'Server penuh, coba lagi nanti');
    const room = newRoom(); if (!room) return fail(ws, 'Gagal membuat kode room');
    const p = addPlayer(room, m.name, ws); ctx.room = room; ctx.player = p;
    log('room create', room.code, p.name);
    send(ws, { t: 'joined', code: room.code, token: p.token, id: p.id });
    return broadcast(room);
  }
  if (m.t === 'join') {
    if (ctx.room) return fail(ws, 'Kamu sudah di dalam room');
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return fail(ws, 'Room tidak ditemukan');
    if (room.state !== 'lobby') return fail(ws, 'Permainan di room ini sudah berjalan');
    if (room.players.size >= MAX_PLAYERS) return fail(ws, 'Room penuh (maks ' + MAX_PLAYERS + ' pemain)');
    const p = addPlayer(room, m.name, ws); ctx.room = room; ctx.player = p; touch(room);
    log('room join', room.code, p.name);
    send(ws, { t: 'joined', code: room.code, token: p.token, id: p.id });
    return broadcast(room);
  }
  if (m.t === 'rejoin') {
    if (ctx.room) return fail(ws, 'Kamu sudah di dalam room');
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    const p = room && [...room.players.values()].find(q => q.token === m.token);
    if (!p) return send(ws, { t: 'rejoin_failed' });
    if (p.ws && p.ws !== ws) { try { send(p.ws, { t: 'error', msg: 'Sesi dibuka di tab lain' }); p.ws.ctx = { room: null, player: null }; p.ws.end(); } catch (e) {} }
    clearTimeout(p.leaveTimer); p.ws = ws; p.online = true; p.offlineSince = null; room.allOfflineSince = null;
    ctx.room = room; ctx.player = p; touch(room);
    send(ws, { t: 'joined', code: room.code, token: p.token, id: p.id });
    return broadcast(room);
  }
  if (!ctx.room) return fail(ws, 'Belum masuk room');
  const room = ctx.room, me = ctx.player; touch(room);
  if (m.t === 'secret') {
    if (room.state !== 'lobby') return fail(ws, 'Angka tidak bisa diubah saat bermain');
    if (!validNumber(m.secret)) return fail(ws, 'Angka harus 4 digit, semua berbeda');
    me.secret = m.secret; return broadcast(room);
  }
  if (m.t === 'rename') { if (room.state !== 'lobby') return fail(ws, 'Nama tidak bisa diubah saat bermain'); me.name = cleanName(m.name); return broadcast(room); }
  if (m.t === 'start') {
    if (me.id !== room.hostId) return fail(ws, 'Hanya host yang bisa memulai');
    if (room.state !== 'lobby') return fail(ws, 'Permainan sudah berjalan');
    const ps = [...room.players.values()];
    if (ps.length < MIN_PLAYERS) return fail(ws, 'Butuh minimal ' + MIN_PLAYERS + ' pemain');
    const off = ps.find(p => !p.online); if (off) return fail(ws, off.name + ' sedang offline — tunggu atau keluarkan dulu');
    const nr = ps.find(p => !p.secret); if (nr) return fail(ws, nr.name + ' belum memasang angka rahasia');
    startGame(room); log('room start', room.code, room.players.size); return broadcast(room);
  }
  if (m.t === 'guess') {
    if (room.state !== 'playing') return fail(ws, 'Permainan belum dimulai');
    if (room.order[room.turnIdx] !== me.id) return fail(ws, 'Bukan giliranmu');
    if (me.cracked) return fail(ws, 'Angkamu sudah tertebak');
    const target = room.players.get(String(m.target || ''));
    if (!target || target.id === me.id) return fail(ws, 'Pilih lawan yang valid');
    if (target.cracked) return fail(ws, 'Angka pemain itu sudah tertebak');
    if (!validNumber(m.guess)) return fail(ws, 'Tebakan harus 4 digit, semua berbeda');
    const r = score(target.secret, m.guess);
    room.history.push({ type: 'guess', by: me.id, byName: me.name, target: target.id, targetName: target.name,
      guess: m.guess, bulls: r.bulls, cows: r.cows, pattern: r.pattern, at: Date.now() });
    if (r.bulls === 4) {
      target.cracked = true; target.crackedBy = me.id;
      room.history.push({ type: 'cracked', by: me.id, byName: me.name, target: target.id, targetName: target.name, secret: target.secret, at: Date.now() });
      const a = alive(room);
      if (a.length <= 1) { endGame(room, a.length === 1 ? a[0].id : me.id); log('room end', room.code); return broadcast(room); }
    }
    advanceTurn(room); return broadcast(room);
  }
  if (m.t === 'restart') {
    if (me.id !== room.hostId) return fail(ws, 'Hanya host yang bisa mengulang');
    if (room.state !== 'ended') return fail(ws, 'Permainan masih berjalan');
    resetToLobby(room); return broadcast(room);
  }
  if (m.t === 'kick') {
    if (me.id !== room.hostId) return fail(ws, 'Hanya host yang bisa mengeluarkan pemain');
    const p = room.players.get(String(m.id || '')); if (!p || p.id === me.id) return fail(ws, 'Pemain tidak valid');
    if (p.ws) { send(p.ws, { t: 'kicked' }); p.ws.ctx = { room: null, player: null }; }
    removePlayer(room, p); if (rooms.has(room.code)) broadcast(room); return;
  }
  if (m.t === 'leave') {
    ws.ctx = { room: null, player: null }; removePlayer(room, me);
    send(ws, { t: 'left' }); if (rooms.has(room.code)) broadcast(room); return;
  }
  fail(ws, 'Perintah tidak dikenal');
}
function onDisconnect(ws) {
  const { room, player } = ws.ctx; ws.ctx = { room: null, player: null };
  if (!room || !player || player.ws !== ws) return;
  player.ws = null; player.online = false; player.offlineSince = Date.now();
  if (![...room.players.values()].some(p => p.online)) room.allOfflineSince = Date.now();
  if (room.state === 'lobby') {
    player.leaveTimer = setTimeout(() => { if (!player.online && rooms.has(room.code)) { removePlayer(room, player); if (rooms.has(room.code)) broadcast(room); } }, LOBBY_OFFLINE_GRACE_MS);
  }
  if (rooms.has(room.code)) broadcast(room);
}
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (now - room.lastActivity > ROOM_IDLE_MS || (room.allOfflineSince && now - room.allOfflineSince > ROOM_ALL_OFFLINE_MS)) { log('room expire', room.code); destroyRoom(room); }
  }
}, 60e3).unref();

// ---------- HTTP + WebSocket (shared/server) ----------
const server = createHttpServer({ base: BASE, root: ROOT, health: () => ({ rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0) }) });
server.on('upgrade', (req, socket, head) => upgrade(req, socket, head, BASE + '/ws', { handle, fail, onDisconnect, log }));
server.listen(PORT, HOST, () => log('bullscows listening', HOST + ':' + PORT, 'base', BASE, 'turn', TURN_MS + 'ms'));
process.on('SIGTERM', () => { log('SIGTERM'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
