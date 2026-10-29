// Runs the Bulls & Cows checks as node:test cases against a real server on a free port ≥ 3300.
// test-level.mjs is not here: it measures loudness on the live URL and is run by hand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SERVER = path.resolve(HERE, '../server/server.js');
const EVIDENCE = path.join(HERE, 'evidence');
fs.mkdirSync(EVIDENCE, { recursive: true });

// Start server.js on a free port in 3300–3899; resolves once it logs "listening".
function startServer(env) {
  return new Promise((resolve, reject) => {
    const tryPort = (left) => {
      const port = 3300 + Math.floor(Math.random() * 600);
      const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, ...env, PORT: String(port), HOST: '127.0.0.1' } });
      let out = '';
      proc.stdout.on('data', (d) => { out += d; if (out.includes('listening')) resolve({ port, stop: () => proc.kill() }); });
      proc.stderr.on('data', (d) => { out += d; });
      proc.on('exit', () => { if (!out.includes('listening')) (left ? tryPort(left - 1) : reject(new Error(out))); });
    };
    tryPort(5);
  });
}

// Run one check script; it prints "N passed, M failed" or "done N pass / M fail".
function check(t, script, args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(HERE, script), ...args], { cwd: EVIDENCE, maxBuffer: 64 << 20, timeout: 300_000 }, (err, stdout, stderr) => {
      const out = stdout + stderr;
      const m = out.match(/(\d+) passed, (\d+) failed/) || out.match(/done (\d+) pass \/ (\d+) fail/);
      assert.ok(m, `${script}: no summary line\n${out.slice(-2000)}`);
      t.diagnostic(`${script}: ${m[1]} passed, ${m[2]} failed`);
      assert.equal(Number(m[2]), 0, out.split('\n').filter((l) => /FAIL/.test(l)).join('\n'));
      if (err && !err.code) throw err; // killed by timeout
      resolve();
    });
  });
}

test('protocol (TURN_MS=1500)', { timeout: 120_000 }, async (t) => {
  const srv = await startServer({ TURN_MS: '1500' });
  try { await check(t, 'test-proto.mjs', [String(srv.port)]); } finally { srv.stop(); }
});

let hasPlaywright = true;
try { await import('playwright'); } catch { hasPlaywright = false; }
test('browser: ui, audio, iOS resume, refresh', { skip: !hasPlaywright && 'playwright not installed', timeout: 900_000 }, async (t) => {
  const srv = await startServer({});
  const url = `http://127.0.0.1:${srv.port}/bullscows/`;
  try {
    for (const s of ['test-ui.mjs', 'test-audio.mjs', 'test-ios-sim.mjs', 'test-refresh.mjs']) await check(t, s, [url]);
  } finally { srv.stop(); }
});
