'use strict';
// Tinju Kata 2.0 — 2-10 player lyric-typing boxing royale. Node >= 20, zero dependencies.
// HTTP: GET <BASE>/ -> ../index.html + ../src/* + ../assets/*, GET <BASE>/health -> JSON.
// WS:   <BASE>/ws (RFC 6455, text frames only, JSON messages). Protocol, state and timers: DESIGN.md.
// The server decides every outcome; the pure rules live in engine.js (resolveRound) and lyrics.js.
const crypto = require('crypto');
const path = require('path');
const { send, upgrade } = require('../shared/server/ws.js');
const { createHttpServer } = require('../shared/server/static.js');
const { makeCfg, mulberry32, resolveRound } = require('./engine.js');
const { loadFile, matchBags } = require('./lyrics.js');

const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || '127.0.0.1';
const BASE = (process.env.BASE || '/tinju').replace(/\/$/, '');
const CFG = makeCfg(process.env);
const MAX_ROOMS = 100, SKIN_COUNT = 4, EMOJI_COUNT = 8;
const ROOM_IDLE_MS = 2 * 3600e3, ROOM_ALL_OFFLINE_MS = 10 * 60e3;
const ROOT = path.join(__dirname, '..');
const LYRICS_FILE = process.env.TK_LYRICS || path.join(__dirname, 'lyrics.txt');
const ENV_SEED = process.env.TK_SEED !== undefined && process.env.TK_SEED !== '' && Number.isFinite(Number(process.env.TK_SEED)) ? Number(process.env.TK_SEED) : null;
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- lyric bank: validated at boot (exit 1), reloaded on SIGHUP (invalid -> keep the old one) ----------
let BANK;
{
  const r = loadFile(LYRICS_FILE, CFG);
  if (r.errors) { console.error('lyrics invalid (' + LYRICS_FILE + '):\n - ' + r.errors.join('\n - ')); process.exit(1); }
  BANK = r.bank; log('lyrics loaded', JSON.stringify(BANK.stats));
}
process.on('SIGHUP', () => {
  const r = loadFile(LYRICS_FILE, CFG);
  if (r.errors) { log('lyrics reload REJECTED, keeping the old bank:', r.errors.join(' | ')); return; }
  BANK = r.bank; log('lyrics reloaded', JSON.stringify(BANK.stats));
});

// ---------- helpers ----------
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
const validSkin = s => Number.isInteger(s) && s >= 0 && s < SKIN_COUNT;
const rint = (rng, a, b) => a + Math.floor(rng() * (b - a + 1)); // inclusive, seeded
const IN_MATCH = new Set(['countdown', 'line', 'result', 'paused']);
const inMatch = room => IN_MATCH.has(room.state);
const plist = room => [...room.players.values()];
const alive = room => plist(room).filter(p => p.out === null && !p.left);
const aliveOnline = room => alive(room).filter(p => p.online);
const touch = room => { room.lastActivity = Date.now(); };

function newRoom() {
  const code = makeCode(); if (!code) return null;
  const seed = ENV_SEED !== null ? ENV_SEED : crypto.randomBytes(4).readUInt32BE(0);
  const room = { code, hostId: null, state: 'lobby', players: new Map(), round: 0, timer: null, phaseEndsAt: 0, seatNo: 0,
    entrants: new Set(), dones: new Map(), seed, matchNo: 0, rng: null, bank: null, bags: null, ultiAt: 0, line: null, lastResult: null,
    revealAt: 0, winnerId: null, endReason: null, pausedFrom: null, createdAt: Date.now(), lastActivity: Date.now(), allOfflineSince: null };
  rooms.set(code, room);
  return room;
}
function addPlayer(room, name, ws, skin) {
  const id = crypto.randomBytes(4).toString('hex'), token = crypto.randomBytes(16).toString('hex');
  const p = { id, token, name: cleanName(name), skin: validSkin(skin) ? skin : 0, ws, online: true, offlineSince: null, leaveTimer: null, joinedAt: Date.now(),
    seat: ++room.seatNo, hp: CFG.HP, streak: 0, fire: false, out: null, left: false, lockedRound: 0, rematch: false, emojiAt: 0 };
  room.players.set(id, p);
  if (!room.hostId) room.hostId = id;
  return p;
}
const ultiIn = room => Math.max(0, room.ultiAt - room.round);
function view(room, me) {
  return {
    code: room.code, state: room.state, hostId: room.hostId, round: room.round, you: me ? { id: me.id } : null,
    // NOTE: never contains the line text; it travels only in the `line` message (DESIGN "Messages").
    players: plist(room).map(p => ({ id: p.id, name: p.name, skin: p.skin, online: p.online && !p.left, isHost: p.id === room.hostId,
      hp: p.hp, streak: p.streak, fire: p.fire, out: p.out, rematch: p.rematch })),
    phaseEndsAt: room.phaseEndsAt, ultiIn: room.ultiAt && inMatch(room) ? ultiIn(room) : null, winnerId: room.winnerId, endReason: room.endReason,
    serverTime: Date.now(),
    cfg: { HP: CFG.HP, COUNTDOWN_MS: CFG.COUNTDOWN_MS, WORD_CAP_MS: CFG.WORD_CAP_MS, RESULT_MS: CFG.RESULT_MS, LINK_MS: CFG.LINK_MS, TITLE_MS: CFG.TITLE_MS,
      WALKOVER_MS: CFG.WALKOVER_MS, MAX_PLAYERS: CFG.MAX_PLAYERS, PLAIN_ROUNDS: CFG.PLAIN_ROUNDS, EMOJI_COUNT },
  };
}
function broadcast(room) { for (const p of room.players.values()) if (p.ws) send(p.ws, { t: 'state', room: view(room, p) }); }
function sendAll(room, obj) { for (const p of room.players.values()) if (p.ws) send(p.ws, obj); }

// ---------- round engine ----------
// One timer per room. Every transition clears it first; every callback re-checks state + round.
function setTimer(room, ms, fn) {
  clearTimeout(room.timer);
  const st = room.state, r = room.round;
  room.timer = setTimeout(() => { if (room.state !== st || room.round !== r) return; fn(); }, Math.max(0, ms));
}
function resetMatch(room, voters) {
  room.matchNo++;
  room.rng = mulberry32((room.seed + room.matchNo) >>> 0);
  room.bank = BANK; room.bags = matchBags(room.bank, room.rng);
  room.ultiAt = rint(room.rng, CFG.ULTI_MIN, CFG.ULTI_MAX);
  for (const p of plist(room)) {
    p.hp = CFG.HP; p.streak = 0; p.fire = false; p.lockedRound = 0; p.rematch = false;
    p.out = (voters && !voters.has(p.id)) || !p.online ? 'sat' : null;
  }
  room.round = 0; room.line = null; room.lastResult = null; room.entrants = new Set(); room.dones.clear();
  room.winnerId = null; room.endReason = null; room.pausedFrom = null;
}
function startMatch(room, voters) {
  clearTimeout(room.timer);
  resetMatch(room, voters); room.round = 1;
  log('match start', room.code, 'match#' + room.matchNo, 'seed=' + room.seed, 'players=' + alive(room).length);
  beginCountdown(room);
}
function sendCountdown(room, only) {
  const msg = { t: 'countdown', round: room.round, ms: CFG.COUNTDOWN_MS, endsAt: room.phaseEndsAt, serverTime: Date.now() };
  if (only) { if (only.ws) send(only.ws, msg); } else sendAll(room, msg);
}
function beginCountdown(room) {
  clearTimeout(room.timer);
  room.state = 'countdown'; room.dones.clear(); room.line = null; room.entrants = new Set(); room.pausedFrom = null;
  room.phaseEndsAt = Date.now() + CFG.COUNTDOWN_MS;
  const fire = () => {
    // B3: setTimeout can fire 1 ms early. Re-arm for the remainder; the line is never sent before endsAt.
    const left = room.phaseEndsAt - Date.now();
    if (left > 0) { room.timer = setTimeout(() => { if (room.state === 'countdown') fire(); }, left); return; }
    if (aliveOnline(room).length >= 2) sendLine(room); else pause(room, 'countdown');
  };
  const st = room.state, r = room.round;
  room.timer = setTimeout(() => { if (room.state === st && room.round === r) fire(); }, CFG.COUNTDOWN_MS);
  broadcast(room); sendCountdown(room);
}
function pause(room, from) {
  clearTimeout(room.timer); room.timer = null;
  room.state = 'paused'; room.pausedFrom = from; room.phaseEndsAt = 0;
  broadcast(room);
}
function sendLine(room) {
  const ulti = room.ultiAt > 0 && room.round >= room.ultiAt;
  const bag = ulti ? room.bags.ulti : room.bags.normal;
  const item = bag.pop();
  if (item === undefined) return endMatch(room, 'bank', null); // bag exhausted (a very long match)
  const form = (!ulti && room.round <= CFG.PLAIN_ROUNDS) ? 'plain' : 'full';
  const text = form === 'plain' ? item.plain : item.text;
  const now = Date.now();
  room.line = { text, form, ulti, song: item.song };
  room.entrants = new Set(aliveOnline(room).map(p => p.id));
  room.dones.clear();
  room.revealAt = Math.max(now, room.phaseEndsAt);
  room.state = 'line'; room.phaseEndsAt = room.revealAt + CFG.WORD_CAP_MS;
  setTimer(room, room.revealAt + CFG.WORD_CAP_MS + CFG.CAP_SLACK_MS - now, () => closeRound(room));
  broadcast(room);
  for (const p of room.players.values()) if (p.ws) {
    send(p.ws, { t: 'line', round: room.round, text, form, ulti, ultiIn: ultiIn(room), entrant: room.entrants.has(p.id), revealAt: room.revealAt,
      endsAt: room.phaseEndsAt, serverTime: Date.now() });
  }
}
function maybeClose(room) { // every ONLINE entrant has a valid done -> no need to wait for the cap
  if (room.state !== 'line') return;
  for (const id of room.entrants) { const p = room.players.get(id); if (p && p.online && !room.dones.has(id)) return; }
  closeRound(room);
}
function onDone(ws, room, p, m) {
  const err = (msg, code) => send(ws, { t: 'error', msg, code });
  if (room.state !== 'line' || m.round !== room.round || p.lockedRound === room.round) return err('Ronde sudah lewat', 'stale');
  if (!room.entrants.has(p.id)) return err('Kamu penonton di ronde ini', 'spectator');
  if (room.dones.has(p.id)) return err('Sudah selesai', 'dup');
  if (!Number.isInteger(m.elapsed) || m.elapsed < CFG.ELAPSED_MIN || m.elapsed > CFG.WORD_CAP_MS) return err('Waktu tidak valid', 'bad_elapsed');
  if (!Number.isInteger(m.typos) || m.typos < 0 || m.typos > 99) return err('Jumlah typo tidak valid', 'bad_typos');
  room.dones.set(p.id, { elapsed: m.elapsed, typos: m.typos, at: Date.now() });
  sendAll(room, { t: 'progress', round: room.round, finished: room.dones.size, of: room.entrants.size }); // a count only: WHO finished stays hidden
  maybeClose(room);
}
function closeRound(room) {
  if (room.state !== 'line') return;
  clearTimeout(room.timer);
  const ents = [...room.entrants].map(id => room.players.get(id)).filter(Boolean);
  const res = resolveRound(ents.map(p => ({ id: p.id, seat: p.seat, hp: p.hp, streak: p.streak, fire: p.fire })), room.dones,
    { text: room.line.text, ulti: room.line.ulti }, CFG);
  for (const p of ents) { p.hp = res.hp[p.id]; p.streak = res.streak[p.id]; p.fire = res.fire[p.id]; if (p.hp <= 0 && !p.out) p.out = 'ko'; }
  const sat = alive(room).filter(p => !room.entrants.has(p.id)).map(p => p.id);
  const hpAll = Object.fromEntries(plist(room).map(p => [p.id, p.hp]));
  const fireAll = Object.fromEntries(plist(room).map(p => [p.id, p.fire]));
  const song = room.bank.songs[room.line.song];
  const dur = CFG.RESULT_MS + CFG.LINK_MS * res.chain.length + CFG.TITLE_MS;
  const result = { t: 'result', round: room.round, order: res.order, chain: res.chain, sat, hp: hpAll, fire: fireAll, ko: res.ko,
    song: { title: song.title, artist: song.artist }, ulti: room.line.ulti, endsAt: Date.now() + dur, serverTime: Date.now() };
  if (room.line.ulti) room.ultiAt = room.round + rint(room.rng, CFG.ULTI_MIN, CFG.ULTI_MAX);
  // arrival order is logged only so a playtest can see that `elapsed`, not arrival, decided the chain
  const arrival = [...room.dones.entries()].sort((a, b) => a[1].at - b[1].at).map(([id]) => id).join(',');
  log('round', room.code, room.round, 'n=' + ents.length, 'done=' + room.dones.size, 'links=' + res.chain.length, 'ko=' + res.ko.length, 'order=' + res.order.map(o => o.id).join(','), 'arrival=' + arrival);
  room.lastResult = result;
  room.state = 'result'; room.phaseEndsAt = result.endsAt;
  setTimer(room, dur, () => afterResult(room));
  sendAll(room, result); broadcast(room);
}
function afterResult(room) {
  const al = alive(room);
  if (al.length <= 1) return endMatch(room, al.length === 1 && plist(room).some(p => p.out === 'walkover') && !plist(room).some(p => p.out === 'ko') ? 'walkover' : 'ko', null);
  room.round++; beginCountdown(room);
}
function endMatch(room, reason, winnerId) {
  clearTimeout(room.timer); room.timer = null;
  const al = alive(room);
  if (reason === 'ko' || reason === 'walkover') winnerId = al.length === 1 ? al[0].id : null;
  else if (reason === 'bank') { const s = al.slice().sort((x, y) => y.hp - x.hp); winnerId = s.length && (s.length === 1 || s[0].hp !== s[1].hp) ? s[0].id : null; }
  room.state = 'ended'; room.endReason = reason; room.winnerId = winnerId; room.phaseEndsAt = 0; room.pausedFrom = null; room.line = null;
  for (const p of plist(room)) { p.rematch = false; if (p.left) { room.players.delete(p.id); } else if (!p.online) armOffline(room, p); }
  if (room.players.size === 0) return destroyRoom(room);
  if (!room.players.has(room.hostId)) pickHost(room);
  log('match end', room.code, reason, winnerId || '-');
  sendAll(room, { t: 'end', winner: winnerId, reason, hp: Object.fromEntries(plist(room).map(p => [p.id, p.hp])) });
  broadcast(room);
}
function pickHost(room) {
  const c = plist(room).filter(p => !p.left).sort((a, b) => (b.online - a.online) || (a.joinedAt - b.joinedAt));
  room.hostId = c.length ? c[0].id : null;
}
// A player went walkover (offline too long, or left). The match goes on while >= 2 are alive.
function dropFromMatch(room, p) {
  if (p.out === null) p.out = 'walkover';
  const al = alive(room);
  if (al.length <= 1) { if (room.state === 'result') return; /* afterResult ends it with the result card */ return endMatch(room, 'walkover', null); }
  broadcast(room);
}
function armOffline(room, p) {
  clearTimeout(p.leaveTimer);
  p.leaveTimer = setTimeout(() => {
    if (p.online || !rooms.has(room.code) || !room.players.has(p.id)) return;
    if (inMatch(room)) { dropFromMatch(room, p); return; }
    removePlayer(room, p);
    if (rooms.has(room.code)) broadcast(room);
  }, inMatch(room) ? CFG.WALKOVER_MS : CFG.LOBBY_OFFLINE_MS);
}
function removePlayer(room, p) {
  clearTimeout(p.leaveTimer);
  room.players.delete(p.id);
  if (plist(room).filter(q => !q.left).length === 0) { destroyRoom(room); return; }
  if (room.hostId === p.id) pickHost(room);
}
function destroyRoom(room) { clearTimeout(room.timer); for (const p of room.players.values()) clearTimeout(p.leaveTimer); rooms.delete(room.code); }
function backToLobby(room) {
  clearTimeout(room.timer); room.timer = null;
  for (const p of plist(room)) { p.hp = CFG.HP; p.streak = 0; p.fire = false; p.out = null; p.rematch = false; }
  room.state = 'lobby'; room.round = 0; room.phaseEndsAt = 0; room.ultiAt = 0; room.winnerId = null; room.endReason = null; room.line = null;
  broadcast(room);
}
function tryAutoRematch(room) {
  const online = plist(room).filter(p => p.online && !p.left);
  if (online.length >= 2 && online.every(p => p.rematch)) startMatch(room, new Set(online.map(p => p.id)));
}

// ---------- message handling ----------
function fail(ws, msg, code) { send(ws, code ? { t: 'error', msg, code } : { t: 'error', msg }); }
function handle(ws, m) {
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return fail(ws, 'Pesan tidak valid');
  const ctx = ws.ctx;
  if (m.t === 'ping') return send(ws, { t: 'pong', serverTime: Date.now() });
  if (m.t === 'create' || m.t === 'join' || m.t === 'rejoin') {
    if (m.v !== 2) return fail(ws, 'Versi game sudah baru — muat ulang halaman ini', 'old_client');
  }
  if (m.t === 'create') {
    if (ctx.room) return fail(ws, 'Kamu sudah di dalam room');
    if (rooms.size >= MAX_ROOMS) return fail(ws, 'Server penuh, coba lagi nanti');
    const room = newRoom(); if (!room) return fail(ws, 'Gagal membuat kode room');
    const p = addPlayer(room, m.name, ws, m.skin); ctx.room = room; ctx.player = p;
    log('room create', room.code, p.name);
    send(ws, { t: 'joined', code: room.code, token: p.token, id: p.id, v: 2 });
    return broadcast(room);
  }
  if (m.t === 'join') {
    if (ctx.room) return fail(ws, 'Kamu sudah di dalam room');
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    if (!room) return fail(ws, 'Room tidak ditemukan');
    if (room.state !== 'lobby' && room.state !== 'ended') return fail(ws, 'Permainan di room ini sudah berjalan');
    if (plist(room).length >= CFG.MAX_PLAYERS) return fail(ws, 'Room penuh (maks ' + CFG.MAX_PLAYERS + ' pemain)');
    const p = addPlayer(room, m.name, ws, m.skin); ctx.room = room; ctx.player = p; touch(room);
    if (room.state === 'ended') p.out = null; // a newcomer waits for the rematch vote like everyone else
    log('room join', room.code, p.name);
    send(ws, { t: 'joined', code: room.code, token: p.token, id: p.id, v: 2 });
    return broadcast(room);
  }
  if (m.t === 'rejoin') {
    if (ctx.room) return fail(ws, 'Kamu sudah di dalam room');
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    const p = room && typeof m.token === 'string' && plist(room).find(q => q.token === m.token && !q.left);
    if (!p) return send(ws, { t: 'rejoin_failed' });
    if (p.ws && p.ws !== ws) { try { send(p.ws, { t: 'error', msg: 'Sesi dibuka di tab lain' }); p.ws.ctx = { room: null, player: null }; p.ws.end(); } catch (e) {} }
    clearTimeout(p.leaveTimer); p.ws = ws; p.online = true; p.offlineSince = null; room.allOfflineSince = null;
    ctx.room = room; ctx.player = p; touch(room);
    // Rejoin during the line: it is NOT re-sent (it would restart their clock) and this round is closed to the rejoiner.
    if (room.state === 'line') p.lockedRound = room.round;
    send(ws, { t: 'joined', code: room.code, token: p.token, id: p.id, v: 2 });
    broadcast(room);
    if (room.state === 'countdown') sendCountdown(room, p);
    else if (room.state === 'result' && room.lastResult) send(ws, room.lastResult);
    else if (room.state === 'paused' && aliveOnline(room).length >= 2) beginCountdown(room);
    else if (room.state === 'ended') { send(ws, { t: 'end', winner: room.winnerId, reason: room.endReason, hp: Object.fromEntries(plist(room).map(q => [q.id, q.hp])) }); tryAutoRematch(room); }
    return;
  }
  if (!ctx.room) return fail(ws, 'Belum masuk room');
  const room = ctx.room, me = ctx.player; touch(room);
  if (m.t === 'skin') {
    if (room.state !== 'lobby' && room.state !== 'ended') return fail(ws, 'Warna tidak bisa diganti saat bermain');
    if (!validSkin(m.skin)) return fail(ws, 'Warna tidak valid');
    me.skin = m.skin; return broadcast(room);
  }
  if (m.t === 'start') {
    if (me.id !== room.hostId) return fail(ws, 'Hanya host yang bisa memulai');
    if (room.state === 'lobby') {
      if (plist(room).filter(p => p.online).length < CFG.MIN_PLAYERS) return fail(ws, 'Butuh ' + CFG.MIN_PLAYERS + ' pemain online');
      startMatch(room, new Set(plist(room).filter(p => p.online).map(p => p.id))); return;
    }
    if (room.state === 'ended') {
      const v = plist(room).filter(p => p.online && p.rematch);
      if (v.length < CFG.MIN_PLAYERS) return fail(ws, 'Butuh ' + CFG.MIN_PLAYERS + ' pemain yang siap');
      startMatch(room, new Set(v.map(p => p.id))); return;
    }
    return fail(ws, 'Permainan sudah berjalan');
  }
  if (m.t === 'done') return onDone(ws, room, me, m);
  if (m.t === 'emoji') {
    if (!(me.out !== null || room.state === 'lobby' || room.state === 'ended')) return fail(ws, 'Emoji hanya untuk penonton');
    if (!Number.isInteger(m.e) || m.e < 0 || m.e >= EMOJI_COUNT) return fail(ws, 'Emoji tidak valid');
    const now = Date.now(); if (now - me.emojiAt < 500) return; // > 2/s: dropped silently
    me.emojiAt = now;
    return sendAll(room, { t: 'emoji', from: me.id, e: m.e });
  }
  if (m.t === 'rematch') {
    if (room.state !== 'ended') return fail(ws, 'Pertandingan belum selesai');
    if (plist(room).filter(p => !p.left).length < CFG.MIN_PLAYERS) { backToLobby(room); return; }
    me.rematch = true; broadcast(room); tryAutoRematch(room); return;
  }
  if (m.t === 'leave') {
    const midMatch = inMatch(room);
    ws.ctx = { room: null, player: null };
    if (midMatch) {
      // stays as a ghost until the match ends so the round in flight still resolves; removed in endMatch
      me.left = true; me.ws = null; me.online = false; clearTimeout(me.leaveTimer);
      if (room.hostId === me.id) pickHost(room);
      send(ws, { t: 'left' });
      if (plist(room).every(p => p.left)) return destroyRoom(room);
      dropFromMatch(room, me);
      if (rooms.has(room.code) && room.state === 'line') maybeClose(room);
      if (rooms.has(room.code) && room.state !== 'ended') broadcast(room);
      return;
    }
    removePlayer(room, me);
    send(ws, { t: 'left' });
    if (rooms.has(room.code)) { if (room.state === 'ended' && plist(room).length < CFG.MIN_PLAYERS) backToLobby(room); else broadcast(room); }
    return;
  }
  // unknown `t` (and spectator-only / ended-only messages sent at the wrong time): ignored without a reply
}
function onDisconnect(ws) {
  const { room, player } = ws.ctx; ws.ctx = { room: null, player: null };
  if (!room || !player || player.ws !== ws) return;
  player.ws = null; player.online = false; player.offlineSince = Date.now();
  if (!plist(room).some(p => p.online)) room.allOfflineSince = Date.now();
  armOffline(room, player);
  if (room.state === 'line') maybeClose(room);
  if (rooms.has(room.code) && room.state !== 'result') broadcast(room); else if (rooms.has(room.code)) broadcast(room);
}
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (now - room.lastActivity > ROOM_IDLE_MS || (room.allOfflineSince && now - room.allOfflineSince > ROOM_ALL_OFFLINE_MS)) { log('room expire', room.code); destroyRoom(room); }
  }
}, 60e3).unref();

// ---------- HTTP + WebSocket (shared/server) ----------
const server = createHttpServer({ base: BASE, root: ROOT, health: () => ({ rooms: rooms.size, players: [...rooms.values()].reduce((n, r) => n + r.players.size, 0),
  lyrics: BANK.stats, version: '2.0.0' }) });
server.on('upgrade', (req, socket, head) => upgrade(req, socket, head, BASE + '/ws', { handle, fail, onDisconnect, log }));
server.listen(PORT, HOST, () => log('tinju listening', HOST + ':' + PORT, 'base', BASE, 'hp', CFG.HP, 'base_per_char', CFG.BASE_PER_CHAR, 'rank_weight', CFG.RANK_WEIGHT));
process.on('SIGTERM', () => { log('SIGTERM'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
