// Allocation / purity lint (RFC §7): hot functions in @core and every draw* function in the shell.
import fs from 'node:fs';
import { INDEX, coreSource } from './lib.mjs';

function strip(src) {                       // drop comments + string contents, keep structure
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}
function bodyOf(src, startIdx) {            // from first '{' at/after startIdx to its match
  let i = src.indexOf('{', startIdx), d = 0;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (d === 0) return src.slice(i, j + 1); } }
  return '';
}
function fnBody(src, name) {
  const m = new RegExp('function\\s+' + name + '\\s*\\(').exec(src);
  return m ? bodyOf(src, m.index + m[0].length) : null;
}
const BAD = [
  [/\.filter\s*\(/, 'filter('], [/\.map\s*\(/, 'map('], [/\bnew\s/, 'new '], [/create\w*Gradient\s*\(/, 'create*Gradient'],
  [/\bString\s*\(/, 'String('], [/`/, 'template literal'], [/for\s*\(\s*(?:const|let)\s+[^;)]*\sof\s/, 'for..of (iterator)'],
  [/\.slice\s*\(|\.concat\s*\(|Object\.assign\s*\(|\.toFixed\s*\(/, 'allocating call']
];
function arrayLiterals(body) {
  const hits = [];
  for (let i = 0; i < body.length; i++) {
    if (body[i] !== '[') continue;
    let j = i - 1; while (j >= 0 && /\s/.test(body[j])) j--;
    const prev = body[j] || '';
    let isIndex = /[\w$)\]]/.test(prev);
    if (isIndex && /\w/.test(prev)) { const w = /([A-Za-z_$][\w$]*)$/.exec(body.slice(0, j + 1)); if (w && /^(return|typeof|in|of|case|else|do)$/.test(w[1])) isIndex = false; }
    if (!isIndex) hits.push(body.slice(Math.max(0, i - 15), i + 15).replace(/\s+/g, ' '));
  }
  return hits;
}
export function lintBody(name, body) {
  const out = [];
  for (const [re, label] of BAD) if (re.test(body)) out.push(`${name}: ${label}`);
  for (const h of arrayLiterals(body)) out.push(`${name}: array literal near "${h}"`);
  return out;
}
export const HOT_CORE = ['stepWorld', 'step', 'spawnNext', 'pickDef', 'fairCheck', 'blockedAt', 'freeIntervals', 'killBird',
  'fallbackPipe', 'collidePipe', 'collideDouble', 'blockedPipe', 'slideTop', 'noUpdate', 'initObs'];
export function lintAll(file = INDEX) {
  const full = strip(fs.readFileSync(file, 'utf8'));
  const core = strip(coreSource(file));
  const viol = [], scanned = [];
  for (const n of HOT_CORE) { const b = fnBody(core, n); if (b === null) { viol.push('missing hot fn ' + n); continue; } scanned.push(n); viol.push(...lintBody('core.' + n, b)); }
  const ri = core.indexOf('const OBST={'); const reg = bodyOf(core, ri);
  scanned.push('OBST registry'); viol.push(...lintBody('core.OBST', reg));
  // shell: every function whose name starts with draw (incl. named function expressions), plus per-frame helpers
  const names = new Set([...full.matchAll(/function\s+(draw\w*)\s*\(/g)].map(m => m[1]));
  for (const n of ['txt', 'rr', 'button', 'layer', 'fontOf', 'pipeBody', 'pipeCap']) if (new RegExp('function\\s+' + n + '\\s*\\(').test(full)) names.add(n);
  for (const n of names) { const b = fnBody(full, n); if (b === null) continue; scanned.push(n); viol.push(...lintBody(n, b)); }
  return { violations: viol, scanned };
}
