// Shared helpers for test-proto / test-ui / test-audio (not shipped to prod; see README).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DIR = path.dirname(fileURLToPath(import.meta.url));
export const SRV = path.join(DIR, '..', 'server');      // server.js + words.js
export const SHARED = path.join(DIR, '..', 'shared');   // the game's shared/ symlink
export const EVIDENCE = path.join(DIR, 'evidence');     // screenshots + logs, git-ignored
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- PASS/FAIL accounting (one line per check, summary "PASS n / FAIL n") ----
export function makeChecker(label) {
  const st = { pass: 0, fail: 0, fails: [] };
  const check = (name, ok, extra = '') => {
    if (ok) { st.pass++; console.log('PASS ' + name); }
    else { st.fail++; st.fails.push(name); console.log('FAIL ' + name + (extra ? '  :: ' + extra : '')); }
  };
  const summary = () => { console.log(`\n== ${label}: PASS ${st.pass} / FAIL ${st.fail} ==`); return st.fail; };
  return { check, summary, st };
}

// ---- server child process ----
export function startServer(port, env = {}, logName, dir = SRV) {
  const logDir = path.join(EVIDENCE, 'logs'); fs.mkdirSync(logDir, { recursive: true });
  const out = fs.createWriteStream(path.join(logDir, logName || `server-${port}.log`), { flags: 'a' });
  const child = spawn(process.execPath, [path.join(dir, 'server.js')], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.pipe(out, { end: false }); child.stderr.pipe(out, { end: false });
  const ready = new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server did not start on ' + port)), 8000);
    child.stdout.on('data', d => { if (String(d).includes('listening')) { clearTimeout(t); res(); } });
    child.on('exit', c => { clearTimeout(t); rej(new Error('server exited early code=' + c)); });
  });
  const stop = () => { try { child.kill('SIGTERM'); } catch (e) {} };
  process.on('exit', stop);
  return { child, ready, stop, port };
}

// ---- playwright (from ./node_modules or PW_NODE_MODULES) ----
export function loadPlaywright() {
  const roots = [process.env.PW_NODE_MODULES, path.join(DIR, '..', '..', '..', 'node_modules')].filter(Boolean);
  for (const r of roots) {
    try { return createRequire(path.join(r, 'x.js'))('playwright'); } catch (e) {}
  }
  throw new Error('playwright not found; set PW_NODE_MODULES');
}
export async function launchBrowser(args = []) {
  const pw = loadPlaywright();
  try { return await pw.chromium.launch({ args }); } catch (e) {
    // plain launch fails in some sandboxes: fall back to the headless shell in the shared browser cache
    const base = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
    const dirs = fs.readdirSync(base).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const d of dirs) {
      const exe = path.join(base, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell');
      if (fs.existsSync(exe)) { try { return await pw.chromium.launch({ executablePath: exe, args }); } catch (e2) {} }
    }
    throw e;
  }
}
export const devices = () => loadPlaywright().devices;

// ---- WebSocket protocol client (Node >= 22 global WebSocket) ----
export class Client {
  constructor(port, name = '?') { this.port = port; this.name = name; this.q = []; this.all = []; this.id = null; this.token = null; this.code = null; this.state = null; this.closed = false; }
  open() {
    return new Promise((res, rej) => {
      const ws = this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/tinju/ws`);
      ws.onopen = () => res(this);
      ws.onerror = e => rej(new Error('ws error'));
      ws.onclose = () => { this.closed = true; };
      ws.onmessage = ev => {
        const m = JSON.parse(ev.data); m._at = Date.now();
        if (m.t === 'state') this.state = m.room;
        if (m.t === 'joined') { this.id = m.id; this.token = m.token; this.code = m.code; }
        this.q.push(m); this.all.push(m);
      };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  close() { try { this.ws.close(); } catch (e) {} }
  clear() { this.q = []; }
  // wait for the first queued message of type t (matching pred); consumes only that message
  async wait(t, pred = () => true, ms = 4000) {
    const end = Date.now() + ms;
    for (;;) {
      const i = this.q.findIndex(m => m.t === t && pred(m));
      if (i >= 0) return this.q.splice(i, 1)[0];
      if (Date.now() > end) throw new Error(`${this.name}: timeout waiting for ${t}`);
      await sleep(4);
    }
  }
  has(t, pred = () => true) { return this.q.some(m => m.t === t && pred(m)); }
  async quiet(ms) { await sleep(ms); }
}
