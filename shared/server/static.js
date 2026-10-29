'use strict';
// HTTP side of a game-warkop multiplayer server. Node >= 20, zero dependencies.
//   <base>          → 301 <base>/
//   <base>/health   → JSON from health()
//   <base>/         → <root>/index.html, plus the client files under src/, assets/ and shared/ (never shared/server/)
// Anything else is 404. Upgrades are not handled here — see ws.js.
const http = require('http');
const fs = require('fs');
const path = require('path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.json': 'application/json' };
const CLIENT_FILE = /^\/(?:src|assets|shared(?!\/server\/))\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function createHttpServer({ base, root, health }) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = url.pathname;
    if (p === base) { res.writeHead(301, { Location: base + '/' + url.search }); return res.end(); }
    if (!p.startsWith(base + '/')) { res.writeHead(404); return res.end('not found'); }
    p = p.slice(base.length);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    if (p === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, ...health(), uptime: Math.round(process.uptime()) }));
    }
    if (p === '/') p = '/index.html';
    if (p !== '/index.html' && !CLIENT_FILE.test(p)) { res.writeHead(404); return res.end('not found'); }
    const type = TYPES[path.extname(p)];
    if (!type) { res.writeHead(404); return res.end('not found'); }
    fs.readFile(path.join(root, p), (err, data) => {
      if (err) { res.writeHead(p === '/index.html' ? 500 : 404); return res.end(p === '/index.html' ? 'index missing' : 'not found'); }
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

module.exports = { createHttpServer };
