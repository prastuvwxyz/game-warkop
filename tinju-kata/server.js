'use strict';
// Tinju Kata — 1v1 real-time typing-boxing server. Node >= 20, zero dependencies.
// HTTP: GET <BASE>/ -> public/index.html, GET <BASE>/health -> JSON.
// WS:   <BASE>/ws (RFC 6455, text frames only, JSON messages).
// Round engine, protocol and damage function follow tinju-rfc.md (Jiwoo, 2026-10-29).
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WORDS = require('./words.js');

const PORT = Number(process.env.PORT || 3200);
const HOST = process.env.HOST || '127.0.0.1';
const BASE = (process.env.BASE || '/tinju').replace(/\/$/, '');
const MAX_ROOMS = 500, MAX_PLAYERS = 2, MIN_PLAYERS = 2;
const ROOM_IDLE_MS = 2 * 3600e3, ROOM_ALL_OFFLINE_MS = 10 * 60e3, LOBBY_OFFLINE_GRACE_MS = 60e3;
const MAX_FRAME = 4096, MSG_RATE = 20; // msgs per second per socket

// All tuning constants live here. Each may be overridden by env TK_<KEY> (used by the tests).
const CFG_DEFAULTS = { HP: 100, COUNTDOWN_MS: 2400, GRACE_MS: 1500, WORD_CAP_MS: 20000, RESULT_MS: 1400, WALKOVER_MS: 20000,
  ELAPSED_MIN: 150, BASE_PER_CHAR: 3, BLOCK_MS: 400, JAB_MS: 1000, M_BLOCK: 0.5, M_JAB: 1, M_CLEAN: 1.25,
  CRIT_CPS: 5, CRIT_X: 1.5, COMBO_STREAK: 3, COMBO_X: 1.25, ULTI_X: 2.5, ULTI_MIN: 4, ULTI_MAX: 6, CAP: 60 };
const CFG = {};
for (const k of Object.keys(CFG_DEFAULTS)) {
  const e = process.env['TK_' + k];
  CFG[k] = (e !== undefined && e !== '' && Number.isFinite(Number(e))) ? Number(e) : CFG_DEFAULTS[k];
}

const INDEX = path.join(__dirname, 'public', 'index.html');
const CODE_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const rooms = new Map();
const log = (...a) => console.log(new Date().toISOString(), ...a);

// ---------- word bank (validated once at boot, RFC section 5) ----------
function validateWords(w) {
  const errs = [];
  const uniq = a => new Set(a).size === a.length;
  if (!w || !Array.isArray(w.normal) || !Array.isArray(w.ulti)) return ['words.js must export { normal: [], ulti: [] }'];
  if (w.normal.length < 400) errs.push('normal: need >= 400 words, have ' + w.normal.length);
  const badN = w.normal.filter(x => typeof x !== 'string' || !/^[a-z]{4,9}$/.test(x));
  if (badN.length) errs.push('normal: must match /^[a-z]{4,9}$/, offenders: ' + badN.slice(0, 5).join(', '));
  if (!uniq(w.normal)) errs.push('normal: duplicates present');
  if (w.ulti.length < 80) errs.push('ulti: need >= 80 words, have ' + w.ulti.length);
  const badU = w.ulti.filter(x => typeof x !== 'string' || !/^[A-Za-z!?,\-]{8,14}$/.test(x) || !/[A-Z]/.test(x) || !/[-!?,]/.test(x));
  if (badU.length) errs.push('ulti: need 8-14 chars of [A-Za-z!?,-] with >=1 uppercase and >=1 of - ! ? , offenders: ' + badU.slice(0, 5).join(', '));
  if (!uniq(w.ulti)) errs.push('ulti: duplicates present');
  const set = new Set(w.normal); const ov = w.ulti.filter(x => set.has(x));
  if (ov.length) errs.push('ulti overlaps normal: ' + ov.slice(0, 5).join(', '));
  return errs;
}
{
  const errs = validateWords(WORDS);
  if (errs.length) { console.error('words.js invalid:\n - ' + errs.join('\n - ')); process.exit(1); }
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

// ---------- rooms and players ----------
const IN_MATCH = new Set(['countdown', 'word', 'resolving', 'result', 'paused']);
const inMatch = room => IN_MATCH.has(room.state);
const rint = (a, b) => crypto.randomInt(a, b + 1); // inclusive both ends

function newRoom() {
  const code = makeCode(); if (!code) return null;
  const room = { code, hostId: null, state: 'lobby', players: new Map(), round: 0, word: null, wordSentAt: 0,
    dones: new Map(), timer: null, phaseEndsAt: 0, bag: { normal: [], ulti: [] }, ultiAt: 0, winnerId: null, endReason: null,
    pausedFrom: null, createdAt: Date.now(), lastActivity: Date.now(), allOfflineSince: null };
  rooms.set(code, room);
  return room;
}
function freeSkin(room, want, exceptId) {
  const taken = new Set([...room.players.values()].filter(p => p.id !== exceptId).map(p => p.skin));
  if (Number.isInteger(want) && want >= 0 && want <= 3 && !taken.has(want)) return want;
  for (let s = 0; s < 4; s++) if (!taken.has(s)) return s;
  return 0;
}
function addPlayer(room, name, ws, skin) {
  const id = crypto.randomBytes(4).toString('hex'), token = crypto.randomBytes(16).toString('hex');
  const p = { id, token, name: cleanName(name), skin: freeSkin(room, skin, null), ws, online: true, offlineSince: null, leaveTimer: null,
    joinedAt: Date.now(), hp: CFG.HP, streak: 0, fire: false, lockedRound: 0, rematch: false };
  room.players.set(id, p);
  if (!room.hostId) room.hostId = id;
  return p;
}
function touch(room) { room.lastActivity = Date.now(); }
const others = (room, p) => [...room.players.values()].filter(q => q.id !== p.id);
const bothOnline = room => room.players.size === MAX_PLAYERS && [...room.players.values()].every(p => p.online);

// ultiIn = rounds until the next ulti: 0 = this round is ulti, 1 = next round is ulti (client flashes "Ulti berikutnya!")
const ultiIn = room => Math.max(0, room.ultiAt - room.round);
function view(room, me) {
  return {
    code: room.code, state: room.state, hostId: room.hostId, round: room.round,
    you: me ? { id: me.id } : null,
    // NOTE: never contains the word text; it travels only in the `word` message (RFC section 1.4).
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, skin: p.skin, online: p.online, isHost: p.id === room.hostId,
      hp: p.hp, streak: p.streak, fire: p.fire, rematch: p.rematch })),
    phaseEndsAt: room.phaseEndsAt, ultiIn: room.ultiAt ? ultiIn(room) : null, winnerId: room.winnerId, endReason: room.endReason,
    serverTime: Date.now(),
    cfg: { HP: CFG.HP, COUNTDOWN_MS: CFG.COUNTDOWN_MS, WORD_CAP_MS: CFG.WORD_CAP_MS, GRACE_MS: CFG.GRACE_MS,
      RESULT_MS: CFG.RESULT_MS, WALKOVER_MS: CFG.WALKOVER_MS },
  };
}
function broadcast(room) {
  for (const p of room.players.values()) if (p.ws) send(p.ws, { t: 'state', room: view(room, p) });
}
function sendAll(room, obj) { for (const p of room.players.values()) if (p.ws) send(p.ws, obj); }

// ---------- round engine ----------
// One timer per room. Every transition clears it first; every callback re-checks state + round (RFC section 1.1).
function setTimer(room, ms, fn) {
  clearTimeout(room.timer);
  const st = room.state, r = room.round;
  room.timer = setTimeout(() => { if (room.state !== st || room.round !== r) return; fn(); }, ms);
}
function resetMatch(room) {
  for (const p of room.players.values()) { p.hp = CFG.HP; p.streak = 0; p.fire = false; p.lockedRound = 0; p.rematch = false; }
  room.round = 0; room.word = null; room.dones.clear(); room.winnerId = null; room.endReason = null; room.pausedFrom = null;
  room.bag = { normal: shuffle([...WORDS.normal]), ulti: shuffle([...WORDS.ulti]) };
  room.ultiAt = rint(CFG.ULTI_MIN, CFG.ULTI_MAX);
}
function startMatch(room) {
  clearTimeout(room.timer);
  resetMatch(room); room.round = 1;
  beginCountdown(room);
}
function sendCountdown(room, only) {
  const msg = { t: 'countdown', round: room.round, ms: CFG.COUNTDOWN_MS, endsAt: room.phaseEndsAt, serverTime: Date.now() };
  if (only) { if (only.ws) send(only.ws, msg); } else sendAll(room, msg);
}
function beginCountdown(room) {
  clearTimeout(room.timer);
  room.state = 'countdown'; room.dones.clear(); room.word = null; room.pausedFrom = null;
  room.phaseEndsAt = Date.now() + CFG.COUNTDOWN_MS;
  setTimer(room, CFG.COUNTDOWN_MS, () => { if (bothOnline(room)) sendWord(room); else pause(room, 'countdown'); });
  broadcast(room); sendCountdown(room);
}
function pause(room, from) {
  clearTimeout(room.timer); room.timer = null;
  room.state = 'paused'; room.pausedFrom = from; room.phaseEndsAt = 0;
  broadcast(room);
}
function sendWord(room) {
  const ulti = room.ultiAt > 0 && room.round >= room.ultiAt;
  const bag = ulti ? room.bag.ulti : room.bag.normal;
  const text = bag.pop();
  if (text === undefined) return endMatch(room, 'bank', null); // bag exhausted (~400 rounds), RFC section 5
  room.word = { text, ulti }; room.wordSentAt = Date.now(); room.state = 'word'; room.dones.clear();
  room.phaseEndsAt = room.wordSentAt + CFG.WORD_CAP_MS;
  setTimer(room, CFG.WORD_CAP_MS, () => resolve(room));
  broadcast(room);
  sendAll(room, { t: 'word', round: room.round, text, ulti, ultiIn: ultiIn(room), revealAt: room.wordSentAt, capMs: CFG.WORD_CAP_MS });
}
function onDone(ws, room, p, m) {
  const err = (msg, code) => send(ws, { t: 'error', msg, code });
  if ((room.state !== 'word' && room.state !== 'resolving') || m.round !== room.round || p.lockedRound === room.round) return err('Ronde sudah lewat', 'stale');
  if (room.dones.has(p.id)) return err('Sudah selesai', 'dup');
  if (!Number.isInteger(m.elapsed) || m.elapsed < CFG.ELAPSED_MIN || m.elapsed > CFG.WORD_CAP_MS) return err('Waktu tidak valid', 'bad_elapsed');
  if (!Number.isInteger(m.typos) || m.typos < 0 || m.typos > 99) return err('Jumlah typo tidak valid', 'bad_typos');
  room.dones.set(p.id, { elapsed: m.elapsed, typos: m.typos, at: Date.now() });
  if (room.dones.size === 1) {
    room.state = 'resolving'; room.phaseEndsAt = Date.now() + CFG.GRACE_MS;
    setTimer(room, CFG.GRACE_MS, () => resolve(room));
    broadcast(room);
  } else resolve(room); // both in: no need to wait
}
// Damage function — spec numbers: "sepeda" 1200 vs 2400 ms, 0 typos = 34; 300 ms + 1 typo = 9; "Kopi-Susu!" clean+critical = 60 (cap).
function resolve(room) {
  if (room.state !== 'word' && room.state !== 'resolving') return;
  clearTimeout(room.timer);
  const [a, b] = [...room.players.values()];
  const da = room.dones.get(a.id), db = room.dones.get(b.id);
  let winner = null, loser = null;
  if (da && db) {
    // winner = smaller elapsed; equal elapsed -> fewer typos; else draw. Arrival order never decides.
    if (da.elapsed !== db.elapsed) [winner, loser] = da.elapsed < db.elapsed ? [a, b] : [b, a];
    else if (da.typos !== db.typos) [winner, loser] = da.typos < db.typos ? [a, b] : [b, a];
  } else if (da) [winner, loser] = [a, b];
  else if (db) [winner, loser] = [b, a];
  if (!winner) return draw(room);
  const W = room.dones.get(winner.id), L = room.dones.get(loser.id); // L may be undefined = not finished
  const d = L ? L.elapsed - W.elapsed : Infinity;
  const tier = d <= CFG.BLOCK_MS ? 'block' : d <= CFG.JAB_MS ? 'jab' : 'clean';
  const margin = tier === 'block' ? CFG.M_BLOCK : tier === 'jab' ? CFG.M_JAB : CFG.M_CLEAN;
  const len = room.word.text.length;
  const critical = W.typos === 0 && len * 1000 >= CFG.CRIT_CPS * W.elapsed; // integer compare, no float cps
  const combo = winner.fire;
  const damage = Math.min(CFG.CAP, Math.round(len * CFG.BASE_PER_CHAR * margin * (critical ? CFG.CRIT_X : 1) * (combo ? CFG.COMBO_X : 1) * (room.word.ulti ? CFG.ULTI_X : 1)));
  loser.hp = Math.max(0, loser.hp - damage);
  // D9 combo, literal reading: fire applies to the ONE round after the 3rd straight win, then resets.
  if (winner.fire) { winner.fire = false; winner.streak = 0; }
  else { winner.streak++; if (winner.streak >= CFG.COMBO_STREAK) { winner.fire = true; winner.streak = 0; } }
  loser.streak = 0; loser.fire = false;
  const arrivalGap = (L && W.at && L.at) ? Math.abs(L.at - W.at) : null;
  finishRound(room, { winner: winner.id, tier, damage, margin, critical, combo }, d === Infinity ? null : d, arrivalGap);
}
function draw(room) { // no damage; streaks and fire unchanged
  finishRound(room, { winner: null, tier: 'draw', damage: 0, margin: null, critical: false, combo: false }, null, null);
}
function finishRound(room, r, elapsedGap, arrivalGap) {
  clearTimeout(room.timer);
  const ps = [...room.players.values()];
  const mapOf = f => Object.fromEntries(ps.map(p => [p.id, f(p)]));
  const res = Object.assign({ t: 'result', round: room.round }, r, { ulti: room.word.ulti,
    hp: mapOf(p => p.hp), elapsed: mapOf(p => room.dones.has(p.id) ? room.dones.get(p.id).elapsed : null), fire: mapOf(p => p.fire) });
  if (room.word.ulti) room.ultiAt = room.round + rint(CFG.ULTI_MIN, CFG.ULTI_MAX);
  log('round', room.code, room.round, r.tier, 'elapsedGap=' + elapsedGap, 'arrivalGap=' + arrivalGap);
  room.state = 'result'; room.phaseEndsAt = Date.now() + CFG.RESULT_MS;
  setTimer(room, CFG.RESULT_MS, () => {
    if (ps.some(p => p.hp <= 0)) return endMatch(room, 'ko', null);
    if (bothOnline(room)) { room.round++; beginCountdown(room); } else pause(room, 'result');
  });
  sendAll(room, res); broadcast(room);
}
function endMatch(room, reason, winnerId) {
  clearTimeout(room.timer); room.timer = null;
  const ps = [...room.players.values()];
  if (reason === 'ko' || reason === 'bank') {
    const sorted = ps.slice().sort((x, y) => y.hp - x.hp);
    winnerId = (reason === 'ko' || (sorted.length > 1 && sorted[0].hp !== sorted[1].hp)) ? sorted[0].id : null;
  }
  room.state = 'ended'; room.endReason = reason; room.winnerId = winnerId; room.phaseEndsAt = 0; room.pausedFrom = null;
  for (const p of ps) { p.rematch = false; if (!p.online) armOffline(room, p); }
  log('match end', room.code, reason, winnerId || '-');
  sendAll(room, { t: 'end', winner: winnerId, reason, hp: Object.fromEntries(ps.map(p => [p.id, p.hp])) });
  broadcast(room);
}
function walkover(room, p) { // p is offline or left; the other player (if still online) wins
  const o = others(room, p)[0];
  endMatch(room, 'walkover', o && o.online ? o.id : null);
}
function backToLobby(room) { // one player left behind waits for a new opponent
  clearTimeout(room.timer); room.timer = null;
  resetMatch(room); room.state = 'lobby'; room.phaseEndsAt = 0; room.ultiAt = 0;
  broadcast(room);
}
// Offline timer: in a match -> walkover after WALKOVER_MS; in lobby/ended -> removal after the usual 60 s.
function armOffline(room, p) {
  clearTimeout(p.leaveTimer);
  p.leaveTimer = setTimeout(() => {
    if (p.online || !rooms.has(room.code) || !room.players.has(p.id)) return;
    if (inMatch(room)) { walkover(room, p); return; }
    removePlayer(room, p);
    if (rooms.has(room.code)) { if (room.state === 'ended') backToLobby(room); else broadcast(room); }
  }, inMatch(room) ? CFG.WALKOVER_MS : LOBBY_OFFLINE_GRACE_MS);
}
function removePlayer(room, p) {
  clearTimeout(p.leaveTimer);
  room.players.delete(p.id);
  if (room.players.size === 0) { destroyRoom(room); return; }
  if (room.hostId === p.id) room.hostId = [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0].id;
}
function destroyRoom(room) { clearTimeout(room.timer); for (const p of room.players.values()) clearTimeout(p.leaveTimer); rooms.delete(room.code); }

// ---------- message handling ----------
function fail(ws, msg, code) { send(ws, code ? { t: 'error', msg, code } : { t: 'error', msg }); }
const validSkin = s => Number.isInteger(s) && s >= 0 && s <= 3;
function handle(ws, m) {
  if (!m || typeof m !== 'object' || typeof m.t !== 'string') return fail(ws, 'Pesan tidak valid');
  const ctx = ws.ctx; // {room, player}
  if (m.t === 'ping') return send(ws, { t: 'pong', serverTime: Date.now() });
  if (m.t === 'create') {
    if (ctx.room) return fail(ws, 'Kamu sudah di dalam room');
    if (rooms.size >= MAX_ROOMS) return fail(ws, 'Server penuh, coba lagi nanti');
    const room = newRoom(); if (!room) return fail(ws, 'Gagal membuat kode room');
    const p = addPlayer(room, m.name, ws, m.skin); ctx.room = room; ctx.player = p;
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
    const p = addPlayer(room, m.name, ws, m.skin); ctx.room = room; ctx.player = p; touch(room);
    log('room join', room.code, p.name);
    send(ws, { t: 'joined', code: room.code, token: p.token, id: p.id });
    return broadcast(room);
  }
  if (m.t === 'rejoin') {
    if (ctx.room) return fail(ws, 'Kamu sudah di dalam room');
    const room = rooms.get(String(m.code || '').toUpperCase().trim());
    const p = room && typeof m.token === 'string' && [...room.players.values()].find(q => q.token === m.token);
    if (!p) return send(ws, { t: 'rejoin_failed' });
    if (p.ws && p.ws !== ws) { try { send(p.ws, { t: 'error', msg: 'Sesi dibuka di tab lain' }); p.ws.ctx = { room: null, player: null }; p.ws.end(); } catch (e) {} }
    clearTimeout(p.leaveTimer); p.ws = ws; p.online = true; p.offlineSince = null; room.allOfflineSince = null;
    ctx.room = room; ctx.player = p; touch(room);
    // Rejoin during word/resolving: the word is NOT re-sent and this round is closed to the rejoiner (RFC edge case 8).
    if (room.state === 'word' || room.state === 'resolving') p.lockedRound = room.round;
    send(ws, { t: 'joined', code: room.code, token: p.token, id: p.id });
    broadcast(room);
    if (room.state === 'countdown') sendCountdown(room, p);
    else if (room.state === 'paused' && bothOnline(room)) { if (room.pausedFrom === 'result') room.round++; beginCountdown(room); }
    else if (room.state === 'ended' && bothOnline(room) && [...room.players.values()].every(q => q.rematch)) startMatch(room);
    return;
  }
  if (!ctx.room) return fail(ws, 'Belum masuk room');
  const room = ctx.room, me = ctx.player; touch(room);
  if (m.t === 'skin') {
    if (room.state !== 'lobby') return fail(ws, 'Warna tidak bisa diganti saat bermain');
    if (!validSkin(m.skin)) return fail(ws, 'Warna tidak valid');
    if (others(room, me).some(q => q.skin === m.skin)) return fail(ws, 'Warna itu sudah dipakai lawan');
    me.skin = m.skin; return broadcast(room);
  }
  if (m.t === 'start') {
    if (me.id !== room.hostId) return fail(ws, 'Hanya host yang bisa memulai');
    if (room.state !== 'lobby') return fail(ws, 'Permainan sudah berjalan');
    const ps = [...room.players.values()];
    if (ps.length < MIN_PLAYERS) return fail(ws, 'Butuh ' + MIN_PLAYERS + ' pemain');
    const off = ps.find(p => !p.online); if (off) return fail(ws, off.name + ' sedang offline — tunggu dulu');
    startMatch(room); log('room start', room.code); return;
  }
  if (m.t === 'done') return onDone(ws, room, me, m);
  if (m.t === 'rematch') {
    if (room.state !== 'ended') return fail(ws, 'Pertandingan belum selesai');
    if (room.players.size < MIN_PLAYERS) { backToLobby(room); return; } // opponent is gone: wait in the lobby for a new one
    me.rematch = true;
    if (bothOnline(room) && [...room.players.values()].every(q => q.rematch)) { startMatch(room); return; }
    return broadcast(room);
  }
  if (m.t === 'leave') {
    const wasInMatch = inMatch(room);
    if (wasInMatch) walkover(room, me); // immediate walkover for the opponent (RFC edge case 16)
    ws.ctx = { room: null, player: null }; removePlayer(room, me);
    send(ws, { t: 'left' });
    if (rooms.has(room.code)) { if (!wasInMatch && room.state === 'ended') backToLobby(room); else broadcast(room); }
    return;
  }
  fail(ws, 'Perintah tidak dikenal');
}
function onDisconnect(ws) {
  const { room, player } = ws.ctx; ws.ctx = { room: null, player: null };
  if (!room || !player || player.ws !== ws) return;
  player.ws = null; player.online = false; player.offlineSince = Date.now();
  if (![...room.players.values()].some(p => p.online)) room.allOfflineSince = Date.now();
  armOffline(room, player); // match: walkover in WALKOVER_MS; lobby/ended: removal in 60 s. The current round is NOT stopped.
  if (rooms.has(room.code)) broadcast(room);
}
setInterval(() => {
  const now = Date.now();
  for (const room of [...rooms.values()]) {
    if (now - room.lastActivity > ROOM_IDLE_MS || (room.allOfflineSince && now - room.allOfflineSince > ROOM_ALL_OFFLINE_MS)) { log('room expire', room.code); destroyRoom(room); }
  }
}, 60e3).unref();

// ---------- minimal WebSocket (RFC 6455) ----------
function send(ws, obj) {
  if (ws.destroyed || !ws.writable) return;
  const payload = Buffer.from(JSON.stringify(obj));
  let header;
  if (payload.length < 126) header = Buffer.from([0x81, payload.length]);
  else if (payload.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  ws.write(Buffer.concat([header, payload]));
}
function sendClose(ws, code = 1000) { try { const b = Buffer.alloc(4); b[0] = 0x88; b[1] = 2; b.writeUInt16BE(code, 2); ws.write(b); } catch (e) {} ws.end(); }
function attachWs(ws) {
  ws.ctx = { room: null, player: null };
  let buf = Buffer.alloc(0), sockAlive = true, rate = 0;
  const rateTimer = setInterval(() => { rate = 0; }, 1000);
  const hb = setInterval(() => {
    if (!sockAlive) { ws.destroy(); return; }
    sockAlive = false; try { ws.write(Buffer.from([0x89, 0])); } catch (e) {}
  }, 30000);
  ws.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > MAX_FRAME * 4) { sendClose(ws, 1009); return; }
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f, masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > BigInt(MAX_FRAME)) { sendClose(ws, 1009); return; } len = Number(big); off = 10; }
      if (len > MAX_FRAME) { sendClose(ws, 1009); return; }
      if (!masked) { sendClose(ws, 1002); return; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4); const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      sockAlive = true;
      if (!fin) { sendClose(ws, 1003); return; } // fragmentation not supported
      if (op === 0x8) { sendClose(ws, 1000); return; }
      if (op === 0x9) { const pong = Buffer.concat([Buffer.from([0x8a, data.length]), data]); ws.write(pong); continue; }
      if (op === 0xa) continue;
      if (op !== 0x1) { sendClose(ws, 1003); return; }
      if (++rate > MSG_RATE) { sendClose(ws, 1008); return; }
      let msg; try { msg = JSON.parse(data.toString('utf8')); } catch (e) { fail(ws, 'JSON tidak valid'); continue; }
      try { handle(ws, msg); } catch (e) { log('handle error', e); fail(ws, 'Kesalahan server'); }
    }
  });
  const cleanup = () => { clearInterval(hb); clearInterval(rateTimer); onDisconnect(ws); };
  ws.on('close', cleanup); ws.on('error', cleanup); ws.on('end', () => ws.end());
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let p = url.pathname;
  if (p === BASE) { res.writeHead(301, { Location: BASE + '/' + url.search }); return res.end(); }
  if (!p.startsWith(BASE + '/')) { res.writeHead(404); return res.end('not found'); }
  p = p.slice(BASE.length);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  if (p === '/health') {
    const players = [...rooms.values()].reduce((n, r) => n + r.players.size, 0);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size, players, uptime: Math.round(process.uptime()) }));
  }
  if (p === '/' || p === '/index.html') {
    fs.readFile(INDEX, (err, data) => {
      if (err) { res.writeHead(500); return res.end('index missing'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
    return;
  }
  res.writeHead(404); res.end('not found');
});
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== BASE + '/ws' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); return socket.destroy(); }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true); socket.setTimeout(0);
  attachWs(socket);
  if (head && head.length) socket.emit('data', head);
});
server.listen(PORT, HOST, () => log('tinju listening', HOST + ':' + PORT, 'base', BASE, 'hp', CFG.HP));
process.on('SIGTERM', () => { log('SIGTERM'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
