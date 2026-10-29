'use strict';
// Minimal WebSocket server (RFC 6455): text frames only, JSON messages, no fragmentation.
// Shared by the game-warkop multiplayer servers (Bulls & Cows, Tinju Kata). Node >= 20, zero dependencies.
//   server.on('upgrade', (req, socket, head) => upgrade(req, socket, head, BASE + '/ws', { handle, fail, onDisconnect, log }));
// handle(ws, msg) gets each parsed message; fail(ws, text) answers bad input; onDisconnect(ws) runs once per socket.
// ws.ctx = { room, player } is the game's per-socket slot.
const crypto = require('crypto');

const MAX_FRAME = 4096, MSG_RATE = 20; // msgs per second per socket

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
function attachWs(ws, { handle, fail, onDisconnect, log }) {
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

function upgrade(req, socket, head, wsPath, hooks) {
  const url = new URL(req.url, 'http://x');
  const key = req.headers['sec-websocket-key'];
  if (url.pathname !== wsPath || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); return socket.destroy(); }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true); socket.setTimeout(0);
  attachWs(socket, hooks);
  if (head && head.length) socket.emit('data', head);
}

module.exports = { send, sendClose, upgrade, MAX_FRAME, MSG_RATE };
