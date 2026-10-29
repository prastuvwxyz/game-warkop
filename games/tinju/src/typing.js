// Strict-typo line typing, pure (no DOM): one wrong character turns red and blocks further input until it is deleted.
// The hidden <input> always mirrors typed + bad, so a phone keyboard's backspace and replacement events keep working.
export const QUOTES = { '\u2018': "'", '\u2019': "'", '\u201A': "'", '\u201B': "'", '\u2032': "'", '\u201C': '"', '\u201D': '"', '\u201E': '"', '\u2033': '"', '\u00A0': ' ' };
export const mapQuotes = s => String(s).replace(/[\u2018\u2019\u201A\u201B\u2032\u201C\u201D\u201E\u2033\u00A0]/g, c => QUOTES[c]);

export function createTyper(text) {
  const st = { text, typed: '', bad: '', typos: 0, done: false };
  const mirror = () => st.typed + st.bad;
  function fromScratch(v) { // value changed in a way that is not a plain append/backspace (predictive replace, paste)
    const hadBad = !!st.bad;
    st.typed = ''; st.bad = '';
    for (const c of v) {
      if (st.bad) break;
      if (c === text[st.typed.length]) st.typed += c; else st.bad = c;
    }
    if (st.bad && !hadBad) st.typos++;
  }
  // feed the current input value; returns the value the input must be set to (typed + bad)
  st.input = function (raw) {
    if (st.done) return mirror();
    let v = mapQuotes(raw);
    const m = mirror();
    if (v === m) return m;
    if (v.startsWith(m)) { // appended characters, in order
      for (const c of v.slice(m.length)) {
        if (st.bad) break;
        if (c === text[st.typed.length]) st.typed += c;
        else { st.bad = c; st.typos++; }
        if (st.typed.length === text.length) break;
      }
    } else if (m.startsWith(v)) { // deleted from the end
      if (st.bad && v.length < m.length) st.bad = ''; // first backspace removes the red character
      if (v.length < st.typed.length) st.typed = v;
    } else fromScratch(v);
    if (st.typed.length === text.length && !st.bad) st.done = true; // a trailing space after the last char is simply never read
    return mirror();
  };
  return st;
}
