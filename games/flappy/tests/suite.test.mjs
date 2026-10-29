// Runs the Flappy v3 harness (flappy-tests/) as one node:test.
// Steps 0–5 read the single-file form (markers /*@core*/ …), so they run on `tools/inline.mjs` output;
// the browser gate runs on the real multi-file games/flappy/index.html.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GAME = path.resolve(HERE, '..');
const REPO = path.resolve(GAME, '../..');
const run = (env, args) => execFileSync(process.execPath, [path.join(HERE, 'flappy-tests/run.mjs'), ...args],
  { env: { ...process.env, ...env }, encoding: 'utf8', maxBuffer: 64 << 20 });
const summary = (out) => out.match(/SUMMARY: (\d+) passed, (\d+) failed/);

test('rules suite (steps 0–5) on the inlined build', { timeout: 600_000 }, (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flappy-'));
  const file = path.join(tmp, 'index.html');
  fs.writeFileSync(file, execFileSync(process.execPath, [path.join(REPO, 'tools/inline.mjs'), GAME]));
  const out = run({ FLAPPY_INDEX: file }, ['--steps=0,1,2,3,4,5', '--no-browser']);
  const m = summary(out); assert.ok(m, out.slice(-2000)); t.diagnostic(m[0]);
  assert.equal(Number(m[2]), 0, out.split('\n').filter((l) => l.includes('FAIL')).join('\n'));
});

let hasPlaywright = true;
try { await import('playwright'); } catch { hasPlaywright = false; }
test('browser gate on the multi-file layout', { skip: !hasPlaywright && 'playwright not installed', timeout: 600_000 }, (t) => {
  const out = run({ FLAPPY_INDEX: path.join(GAME, 'index.html') }, ['--steps=gate']);
  const m = summary(out); assert.ok(m, out.slice(-2000)); t.diagnostic(m[0]);
  assert.equal(Number(m[2]), 0, out.split('\n').filter((l) => l.includes('FAIL')).join('\n'));
});
