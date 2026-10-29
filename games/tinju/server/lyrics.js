'use strict';
// Lyric bank for Tinju Kata 2.0: parse, validate, pick. Pure except loadFile(). Node >= 20, zero dependencies.
// File format (server/lyrics.txt): blocks separated by a blank line; first line of a block is `title | artist`, then its
// lines, one per line. Lines starting with `#` are comments and are ignored. ASCII only.
const fs = require('fs');
const { plainForm } = require('./engine.js');

function parseBank(text) {
  const errors = [], songs = [];
  const blocks = String(text).replace(/\r\n?/g, '\n').split(/\n{2,}/);
  let n = 0;
  for (const raw of blocks) {
    const rows = raw.split('\n').filter(l => !l.startsWith('#'));
    while (rows.length && rows[0] === '') rows.shift();
    while (rows.length && rows[rows.length - 1] === '') rows.pop();
    if (!rows.length) continue;
    n++;
    const head = rows[0].split(' | ');
    if (head.length !== 2 || !head[0].trim() || !head[1].trim()) { errors.push(`block ${n}: first line must be "title | artist", got "${rows[0].slice(0, 40)}"`); continue; }
    if (rows.length < 2) { errors.push(`block ${n} (${head[0]}): no lines`); continue; }
    songs.push({ title: head[0].trim(), artist: head[1].trim(), lines: rows.slice(1) });
  }
  return { songs, errors };
}

// Returns an array of error strings (empty = valid). cfg supplies LINE_MIN/LINE_MAX/ULTI_LEN/MIN_*.
function validateBank(songs, cfg) {
  const errs = [];
  if (!Array.isArray(songs)) return ['bank is not a list of songs'];
  if (songs.length < cfg.MIN_SONGS) errs.push(`need >= ${cfg.MIN_SONGS} songs, have ${songs.length}`);
  const seen = new Set(); let total = 0, short = 0, long = 0, reported = 0;
  const bad = msg => { if (reported++ < 8) errs.push(msg); };
  for (const s of songs) {
    for (const l of s.lines) {
      total++;
      const tag = `"${s.title}": "${String(l).slice(0, 50)}"`;
      if (!/^[\x20-\x7e]+$/.test(l)) { bad(`${tag}: printable ASCII only (no curly quotes, tabs, accents)`); continue; }
      if (l !== l.trim() || / {2}/.test(l)) { bad(`${tag}: leading/trailing/double space`); continue; }
      const p = plainForm(l);
      if (l.length < cfg.LINE_MIN || l.length > cfg.LINE_MAX) { bad(`${tag}: full form is ${l.length} chars, need ${cfg.LINE_MIN}-${cfg.LINE_MAX}`); continue; }
      if (p.length < cfg.LINE_MIN || p.length > cfg.LINE_MAX) { bad(`${tag}: plain form is ${p.length} chars, need ${cfg.LINE_MIN}-${cfg.LINE_MAX}`); continue; }
      if (seen.has(p)) { bad(`${tag}: duplicate line`); continue; }
      seen.add(p);
      if (l.length < cfg.ULTI_LEN) short++; else long++;
    }
  }
  if (total < cfg.MIN_LINES) errs.push(`need >= ${cfg.MIN_LINES} lines, have ${total}`);
  if (short < cfg.MIN_SHORT) errs.push(`need >= ${cfg.MIN_SHORT} lines shorter than ${cfg.ULTI_LEN} chars (normal rounds), have ${short}`);
  if (long < cfg.MIN_LONG) errs.push(`need >= ${cfg.MIN_LONG} lines of ${cfg.ULTI_LEN}+ chars (ULTI rounds), have ${long}`);
  if (reported > 8) errs.push(`... and ${reported - 8} more line errors`);
  return errs;
}

// Immutable snapshot a match keeps to its end (SIGHUP swaps the room-level pointer, never this object).
function buildBank(songs, cfg) {
  const normal = [], ulti = [];
  songs.forEach((s, si) => s.lines.forEach(text => {
    const item = { text, plain: plainForm(text), song: si };
    if (text.length < cfg.ULTI_LEN) normal.push(item); else ulti.push(item);
  }));
  return Object.freeze({ songs: Object.freeze(songs.map(s => Object.freeze({ title: s.title, artist: s.artist }))), normal: Object.freeze(normal), ulti: Object.freeze(ulti),
    stats: Object.freeze({ songs: songs.length, lines: normal.length + ulti.length, normal: normal.length, ulti: ulti.length }) });
}

// Load + validate a file. Returns {bank} or {errors}. Never throws.
function loadFile(file, cfg) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { return { errors: [`cannot read ${file}: ${e.code || e.message}`] }; }
  const { songs, errors } = parseBank(text);
  const errs = errors.concat(validateBank(songs, cfg));
  if (errs.length) return { errors: errs };
  return { bank: buildBank(songs, cfg) };
}

// Fisher-Yates with the room's seeded rng. Same seed + same bank -> same order.
function shuffled(items, rng) {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
// The two bags of a match: pop() from the end. `plain` lines of the normal bag are the ones shown in rounds 1-3.
function matchBags(bank, rng) { return { normal: shuffled(bank.normal, rng), ulti: shuffled(bank.ulti, rng) }; }

module.exports = { parseBank, validateBank, buildBank, loadFile, shuffled, matchBags };
