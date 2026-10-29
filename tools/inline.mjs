// Rebuild a single-file index.html from a game's index.html + its local <link>/<script src>.
// The inverse of the Flappy migration split: used by tests that load one file (file://, vm).
//   node tools/inline.mjs games/flappy > /tmp/flappy.html
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('usage: node tools/inline.mjs <game dir>'); process.exit(2); }
const read = (p) => fs.readFileSync(path.join(dir, p), 'utf8');
const US = "'use strict';\n";

let html = read('index.html');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">\n/g, (_, href) => '<style>\n' + read(href) + '</style>\n');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>\n/g)];
if (scripts.length) {
  const bodies = scripts.map(([, src]) => read(src)).map((s) => (s.startsWith(US) ? s.slice(US.length) : s));
  const first = scripts[0].index, last = scripts.at(-1).index + scripts.at(-1)[0].length;
  html = html.slice(0, first) + '<script>\n' + US + bodies.join('') + '</script>\n' + html.slice(last);
}
process.stdout.write(html);
