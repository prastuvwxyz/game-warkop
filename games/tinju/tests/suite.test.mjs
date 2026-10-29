// Runs the Tinju Kata checks as node:test cases. Each script starts its own servers (test-lib.mjs startServer)
// from a base port picked in 3300–3889; test-proto uses base..base+6.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const EVIDENCE = path.join(HERE, 'evidence');
fs.mkdirSync(EVIDENCE, { recursive: true });
const basePort = () => 3300 + 10 * Math.floor(Math.random() * 59);

// Run one check script; it prints "== <label>: PASS n / FAIL n ==".
function check(t, script) {
  return new Promise((resolve) => {
    execFile(process.execPath, [path.join(HERE, script), String(basePort())], { cwd: EVIDENCE, maxBuffer: 64 << 20, timeout: 600_000 }, (err, stdout, stderr) => {
      const out = stdout + stderr;
      const m = out.match(/== [^:]+: PASS (\d+) \/ FAIL (\d+) ==/);
      assert.ok(m, `${script}: no summary line\n${out.slice(-2000)}`);
      t.diagnostic(`${script}: ${m[1]} passed, ${m[2]} failed`);
      assert.equal(Number(m[2]), 0, out.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
      resolve();
    });
  });
}

test('protocol', { timeout: 300_000 }, (t) => check(t, 'test-proto.mjs'));

let hasPlaywright = true;
try { await import('playwright'); } catch { hasPlaywright = false; }
test('browser: ui', { skip: !hasPlaywright && 'playwright not installed', timeout: 600_000 }, (t) => check(t, 'test-ui.mjs'));
test('browser: audio', { skip: !hasPlaywright && 'playwright not installed', timeout: 600_000 }, (t) => check(t, 'test-audio.mjs'));
