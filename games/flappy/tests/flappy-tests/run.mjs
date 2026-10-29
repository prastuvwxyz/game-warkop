// Flappy v3.0 test runner.  usage: node flappy-tests/run.mjs [--steps=0,1,2,3,4,5,gate] [--no-browser]
// Each step maps to a row of the RFC "Build order" table (docs/specs/2026-10-28-flappy-v3-progression.md).
import { R_, check, section, md5, v2new, v2step, v2bot, mulberry32, V2, INDEX } from './lib.mjs';
import fs from 'node:fs';

const arg = (k, d) => (process.argv.find(a => a.startsWith('--' + k + '=')) || '').split('=')[1] ?? d;
const STEPS = arg('steps', '0,1,2,3,4,5,gate').split(',');
const T0 = Date.now();
const timed = async (name, f) => { const t = Date.now(); await f(); console.log(`  (${name}: ${Date.now() - t} ms)`); };

if (STEPS.includes('0')) await timed('step 0', async () => {
  section('STEP 0 — v2 saved + harness (v2step with lookahead bot)');
  check('index.v2.html md5 == 7b214604d0759332afa1026c91f89a65', md5(V2) === '7b214604d0759332afa1026c91f89a65', md5(V2));
  check('index.v2.html is 308 lines / 19282 bytes', fs.readFileSync(V2, 'utf8').split('\n').length === 309 && fs.statSync(V2).size === 19282, fs.statSync(V2).size + ' B');
  for (const seed of [2, 3, 4]) {
    const rand = mulberry32(seed), s = v2new(); let f = 0;
    while (!s.dead && s.score < 500 && f < 500 * 100) { v2step(s, rand, v2bot(s)); f++; }
    check(`v2step + lookahead bot reaches 500 (seed ${seed})`, s.score >= 500 && !s.dead, `score ${s.score}, frames ${f}, dead ${s.dead}`);
  }
});

const stepFiles = { 1: './step1.mjs', 2: './step2.mjs', 3: './step3.mjs', 4: './step4.mjs', 5: './step5.mjs', gate: './gate.mjs' };
for (const k of ['1', '2', '3', '4', '5', 'gate']) {
  if (!STEPS.includes(k)) continue;
  if (k === 'gate' && process.argv.includes('--no-browser')) continue;
  if (!fs.existsSync(new URL(stepFiles[k], import.meta.url))) { console.log(`\n(step ${k}: ${stepFiles[k]} not written yet)`); continue; }
  const m = await import(stepFiles[k]);
  await timed('step ' + k, () => m.default({ check, section, timed }));
}

console.log(`\n==== SUMMARY: ${R_.pass} passed, ${R_.fail} failed, ${((Date.now() - T0) / 1000).toFixed(1)} s total (index: ${INDEX})`);
if (R_.fail) console.log('FAILED: ' + R_.fails.join(' | '));
process.exit(R_.fail ? 1 : 0);
