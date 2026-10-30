// All sound is synthesised with Web Audio — no files. Hit sounds are layered: impact click + low thump + short tail.
const LS_SND = 'tk_snd';
export const AU = { ctx: null, master: null, sfx: true, music: true, nodes: null, started: false, noise: null };
try { const s = JSON.parse(localStorage.getItem(LS_SND) || '{}'); if (typeof s.sfx === 'boolean') AU.sfx = s.sfx; if (typeof s.music === 'boolean') AU.music = s.music; } catch (e) {}
export function saveSnd() { try { localStorage.setItem(LS_SND, JSON.stringify({ sfx: AU.sfx, music: AU.music })); } catch (e) {} }

export function actx() {
  if (AU.ctx) return AU.ctx;
  const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
  try { AU.ctx = new C(); } catch (e) { return null; }
  AU.master = AU.ctx.createGain(); AU.master.gain.value = 1; AU.master.connect(AU.ctx.destination);
  return AU.ctx;
}
let onStart = () => {};
export function setOnStart(f) { onStart = f; }
export function unlock() {
  const c = actx(); if (!c) return;
  const go = () => { if (AU.started) return; AU.started = true; SFX.tap(); onStart(); };
  if (c.state === 'running') go(); else c.resume().then(() => { if (c.state === 'running') go(); }).catch(() => {});
}
['pointerdown', 'keydown', 'touchend'].forEach(ev => document.addEventListener(ev, unlock, { passive: true }));

const ok = () => { const c = AU.ctx; return !!(c && AU.sfx && c.state === 'running'); };
function tone(freq, dur, o) {
  if (!ok()) return; o = o || {};
  const c = AU.ctx, t0 = c.currentTime + (o.at || 0), osc = c.createOscillator(), g = c.createGain();
  osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(o.vol || .1, t0 + (o.atk || .008)); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  osc.connect(g); g.connect(AU.master); osc.start(t0); osc.stop(t0 + dur + .05);
}
function noiseBuf() {
  const c = AU.ctx; if (AU.noise) return AU.noise;
  const len = c.sampleRate, b = c.createBuffer(1, len, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return (AU.noise = b);
}
// filtered noise burst: the "click" of an impact or the airy "tail"
function burst(o) {
  if (!ok()) return; const c = AU.ctx, t0 = c.currentTime + (o.at || 0);
  const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
  src.buffer = noiseBuf(); f.type = o.filter || 'bandpass'; f.frequency.value = o.f; f.Q.value = o.q || 1;
  g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(o.vol, t0 + .004); g.gain.exponentialRampToValueAtTime(.0001, t0 + o.dur);
  src.connect(f); f.connect(g); g.connect(AU.master); src.start(t0); src.stop(t0 + o.dur + .05);
}
export const SFX = {
  tap() { tone(660, .07, { vol: .07 }); },
  err() { tone(210, .28, { type: 'triangle', to: 140, vol: .09 }); },
  win() { [523, 659, 784, 1047, 1319].forEach((q, i) => tone(q, .6, { at: i * .11, vol: .1 })); },
  lose() { [440, 392, 330].forEach((q, i) => tone(q, .45, { type: 'triangle', at: i * .18, vol: .08 })); },
  join() { tone(880, .12, { vol: .05 }); tone(1175, .22, { at: .1, vol: .05 }); },
  set() { tone(659, .12, { vol: .06 }); tone(880, .25, { at: .09, vol: .06 }); },
  roundBell() { tone(988, .7, { type: 'triangle', vol: .1 }); tone(1976, .5, { type: 'sine', vol: .05 }); },
  emoji() { tone(1320, .08, { vol: .05 }); },
  // the four hit sounds, each = click (noise) + thump (sine sweep down) + tail (noise or tone); the shapes differ so they can be told apart with eyes closed
  jab()      { burst({ f: 2600, q: 1.2, dur: .035, vol: .18 }); tone(120, .16, { type: 'sine', to: 52, vol: .26 }); burst({ f: 700, q: .7, dur: .22, vol: .05, at: .02 }); },
  block()    { burst({ f: 900, q: 3, dur: .05, vol: .14 }); tone(78, .22, { type: 'triangle', to: 60, vol: .22 }); tone(310, .5, { type: 'square', to: 290, vol: .035, at: .01 }); },
  uppercut() { burst({ f: 1500, q: .8, dur: .06, vol: .22, filter: 'highpass' }); tone(70, .3, { type: 'sine', to: 40, vol: .34 }); tone(240, .38, { type: 'sawtooth', to: 700, vol: .05, at: .02 }); burst({ f: 500, q: .5, dur: .45, vol: .07, at: .05, filter: 'lowpass' }); },
  ko()       { burst({ f: 1200, q: .8, dur: .08, vol: .22 }); tone(55, .55, { type: 'sine', to: 32, vol: .4 }); [784, 1175, 1568].forEach((q, i) => tone(q, 1.1, { type: 'triangle', at: .25 + i * .22, vol: .08 })); burst({ f: 400, q: .5, dur: .9, vol: .06, at: .1, filter: 'lowpass' }); },
};

// soft detuned pad under the lobby: Cmaj7 -> Am7 -> Dm7 -> G6, 8 s each, triangles detuned +-7 cents, breathing low-pass
const CHORDS = [[130.81, 196, 246.94, 329.63], [110, 164.81, 220, 261.63], [146.83, 220, 261.63, 349.23], [98, 146.83, 196, 246.94]];
export function startPad() {
  const c = actx(); if (!c || AU.nodes || !AU.music) return;
  const bus = c.createGain(); bus.gain.setValueAtTime(0, c.currentTime); bus.gain.linearRampToValueAtTime(.05, c.currentTime + 3);
  const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600; lp.Q.value = .5;
  const lfo = c.createOscillator(); lfo.frequency.value = .05; const lg = c.createGain(); lg.gain.value = 180; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
  lp.connect(bus); bus.connect(AU.master);
  let idx = 0; const CH = 8;
  const play = () => {
    if (c.state !== 'running') return; const t = c.currentTime; if (AU.nodes) AU.nodes.nextAt = t + CH;
    CHORDS[idx++ % CHORDS.length].forEach(f => [-7, 7].forEach(dt => {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f; o.detune.value = dt;
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.18, t + 2.5); g.gain.setValueAtTime(.18, t + CH - 2.5); g.gain.linearRampToValueAtTime(0, t + CH + .6);
      o.connect(g); g.connect(lp); o.start(t); o.stop(t + CH + 1);
    }));
  };
  AU.nodes = { bus, lfo, nextAt: 0 };
  AU.nodes.tm = setInterval(() => { const n = AU.nodes; if (!n || c.state !== 'running') return; if (c.currentTime >= n.nextAt - .5) play(); }, 500);
  play();
}
export function stopPad() {
  const n = AU.nodes; if (!n) return; const c = AU.ctx, t = c.currentTime;
  n.bus.gain.cancelScheduledValues(t); n.bus.gain.setValueAtTime(n.bus.gain.value, t); n.bus.gain.linearRampToValueAtTime(0, t + 1);
  clearInterval(n.tm); setTimeout(() => { try { n.lfo.stop(); n.bus.disconnect(); } catch (e) {} }, 1500); AU.nodes = null;
}
document.addEventListener('visibilitychange', () => {
  const c = AU.ctx; if (!c) return;
  if (document.visibilityState === 'hidden') c.suspend().catch(() => {}); else if (AU.started && c.state !== 'running') c.resume().catch(() => {});
});
