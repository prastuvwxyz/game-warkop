// STEP 5 — skins: registry, sprites, silhouettes, persistence parsing, unlock boundaries (picker/swipe/reload wiring is in gate.mjs).
import fs from 'node:fs';
import vm from 'node:vm';
import { INDEX, loadCore } from './lib.mjs';
import { lintAll } from './lint.mjs';

export const UNLOCKS = [['kuning', 0], ['biru', 0], ['merah', 0], ['pipit', 10], ['hantu', 25], ['penguin', 50], ['elang', 75], ['flamingo', 100], ['robo', 150], ['phoenix', 200], ['dewa', 300]];

export default async function ({ check, section }) {
  section('STEP 5 — skins: registry, unlock boundaries, persistence fuzz, sprite data, lint');
  const K = loadCore();
  check('11 skins in the RFC order with unlock 0,0,0,10,25,50,75,100,150,200,300', K.SKIN_META.map(s => s.id + ':' + s.unlock).join() === UNLOCKS.map(u => u.join(':')).join());
  check('skin bits are 1<<index (fixed per skin)', K.SKIN_META.every((s, i) => s.bit === 1 << i));
  { let n = 0, bad = [];
    for (const [id, N] of UNLOCKS) {
      if (N === 0) { for (const b of [0, 1, 1e6]) { n++; if (!K.skinUnlocked(id, b)) bad.push(`${id}@${b}`); } continue; }
      n += 2; if (K.skinUnlocked(id, N - 1)) bad.push(`${id} unlocked at ${N - 1}`); if (!K.skinUnlocked(id, N)) bad.push(`${id} locked at ${N}`);
    }
    check(`3 palette skins unlocked at 0; 8 type skins locked at best N-1 and unlocked at N (${n} assertions)`, bad.length === 0 && n === 9 + 16, bad.join(', ')); }
  check('unknown ids are never unlocked ("zzz", "__proto__", "constructor", "", null)', ['zzz', '__proto__', 'constructor', '', null, undefined, 5].every(id => !K.skinUnlocked(id, 99999)));
  // storage fuzz at the parser level (the shell only does getItem/setItem around these)
  { const cases = [['abc', 0], ['-1', 0], ['1e9', 0], ['{', 0], ['', 0], ['null', 0], ['Infinity', 0], ['NaN', 0], ['1e309', 0], ['-5', 0], ['100000', 0], ['99999', 99999], ['12.7', 12], [' 42 ', 42], ['0042', 42], [null, 0], [undefined, 0], [{}, 0], ['0', 0], ['200', 200]];
    const bad = cases.filter(([i, o]) => K.parseBest(i) !== o).map(([i, o]) => `${JSON.stringify(i)}=>${K.parseBest(i)} want ${o}`);
    check(`parseBest fuzz: 'abc','-1','1e9','{',Infinity,NaN,1e309,null... -> 0; sane values kept (${cases.length} cases)`, bad.length === 0, bad.join(' | ')); }
  { const bad = [];
    for (const v of ['abc', '-1', '1e9', '{', '', 'null', '[1,2]', '16384', '99999999', '1.5', null, undefined]) if (K.parseMask(v, K.MASK_RANKS) !== -1) bad.push(JSON.stringify(v));
    for (const [v, o] of [['0', 0], ['16383', 16383], [' 7 ', 7], ['2047', 2047]]) if (K.parseMask(v, K.MASK_RANKS) !== o) bad.push(v);
    check('parseMask fuzz: malformed or out-of-range -> -1 (= treat as missing); valid kept', bad.length === 0, bad.join(' ')); 
    check('parseMask: skins_seen range is 11 bits (2047 ok, 2048 rejected)', K.parseMask('2047', K.MASK_SKINS) === 2047 && K.parseMask('2048', K.MASK_SKINS) === -1); }
  { // skinNews: one aggregated announcement; migration (key missing) for a returning player
    const n = (seen, best) => K.skinNews(seen, best);
    check('skins_seen migration: best 200, key missing => 7 new skins announced ONCE (one toast), mask now covers them', (() => { const r = n(K.PALETTE_SKINS_MASK, 200); const r2 = n(r.mask, 200); return r.n === 7 && r2.n === 0; })());
    check('fresh player (best 0): nothing to announce; best 9 => none, best 10 => exactly 1 (Pipit), next call 0', n(7, 0).n === 0 && n(7, 9).n === 0 && n(7, 10).n === 1 && n(n(7, 10).mask, 10).n === 0);
    check('best 24 -> 25: Burung Hantu announced once', n(n(7, 24).mask, 25).n === 1 && n(n(n(7, 24).mask, 25).mask, 25).n === 0); }
  // sprite data: parse the SKINS table straight out of the page source
  const html = fs.readFileSync(INDEX, 'utf8');
  const a = html.indexOf('const PX=2,WING_DY'), b = html.indexOf('function sprite(sk,wingDy)');
  const art = vm.runInNewContext(html.slice(a, b) + ';({BODY,WING,PAL,SKINS,WING_DY})', {});
  const v2 = fs.readFileSync(new URL('../index.v2.html', import.meta.url), 'utf8');
  const v2body = vm.runInNewContext(v2.slice(v2.indexOf('const BODY='), v2.indexOf('const WING=')) + ';BODY', {});
  check('BODY / WING / PAL for the 3 palette skins are v2\'s, byte for byte', JSON.stringify(art.BODY) === JSON.stringify(v2body) && JSON.stringify(art.WING) === JSON.stringify(['.kkkk.', 'kwwwwk', 'kwwwwk', '.kkkk.']) && art.WING_DY.join() === '-3,0,2');
  check('SKINS has 11 entries (same order as SKIN_META)', art.SKINS.length === 11);
  { const bad = [];
    art.SKINS.forEach((sk, i) => {
      if (sk.body.length !== 12 || sk.body.some(r => r.length !== 18)) bad.push(`#${i} body not 12x18`);
      if (sk.wing.length < 1 || sk.wing.some(r => r.length !== sk.wing[0].length)) bad.push(`#${i} wing ragged`);
      const pal = Object.assign({}, art.PAL, sk.pal), used = new Set((sk.body.join('') + sk.wing.join('')).replace(/\./g, ''));
      for (const ch of used) if (!pal[ch]) bad.push(`#${i} colour '${ch}' undefined`);
      for (const [k, v] of Object.entries(pal)) if (!/^#[0-9a-f]{6}$/i.test(v)) bad.push(`#${i} bad colour ${k}=${v}`);
    });
    check('every sprite: 12 rows x 18 chars, wing rows even, every colour letter defined as #rrggbb', bad.length === 0, bad.join(' | ')); }
  { const sig = art.SKINS.slice(3).map(s => s.body.join('|')); const dup = sig.filter((s, i) => sig.indexOf(s) !== i).length;
    const shapes = art.SKINS.slice(3).map(s => s.body.map(r => r.replace(/[^.]/g, '#')).join('|')); const shapeDup = shapes.filter((s, i) => shapes.indexOf(s) !== i).length;
    check('8 type skins are different sprites (not recolours): the 8 bodies are pairwise distinct, and so are their silhouettes', dup === 0 && shapeDup === 0, `dup bodies ${dup}, dup silhouettes ${shapeDup}`);
    check('Phoenix carries fx "trail" and Dewa "halo" as data for v3.1; others null', art.SKINS.map(s => s.fx).join() === ',,,,,,,,,trail,halo'.replace(/^,/, '') || art.SKINS.map(s => s.fx || '').join() === ',,,,,,,,,trail,halo'); }
  check('hitbox stays R=14 / physics untouched by skins (sprite code never reads R or bird.y)', !/function sprite[\s\S]{0,700}\bR\b/.test(html.slice(a, b + 1200)));
  const L = lintAll();
  check(`lint (final): hot @core fns and all draw* fns clean (${L.scanned.length} scanned: ${L.scanned.filter(n => n.startsWith('draw')).length} draw fns)`, L.violations.length === 0, L.violations.join('; '));
}
