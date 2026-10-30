// Tinju Kata 2.0 client. Draws what the server decides (DESIGN.md); the only claim it makes is `done{elapsed,typos}`.
import { AU, SFX, saveSnd, unlock, startPad, stopPad, setOnStart, actx } from './audio.js';
import { loadArt, imgUrl, skinOf, SKINS, POSES } from './art.js';
import { createTyper } from './typing.js';
import { createNet } from './net.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const VERSION = '2.0.0';
const LS_NAME = 'tk_name', LS_SESS = 'tk_sess', LS_SKIN = 'tk_skin'; // tk_snd lives in audio.js; tk_theme is ignored on purpose
const EMOJIS = ['👏', '🔥', '😂', '😱', '🥊', '💪', '😴', '❤️'];
const CFG = { HP: 100, COUNTDOWN_MS: 2400, WORD_CAP_MS: 20000, RESULT_MS: 1400, LINK_MS: 150, TITLE_MS: 1000, WALKOVER_MS: 20000, MAX_PLAYERS: 10 };

let S = null, me = null, sess = null, offset = 0;
let cd = null, W = null, typer = null, sentDone = false, tStart = 0, lineKey = '', lastRes = null, endApplied = false;
let playing = null, hpDisp = {}, chainIds = [], progressTxt = '';
const log = []; // test hook: what the domino actually did, with timestamps
const slots = { left: { id: null, pose: 'idle', skin: 0 }, right: { id: null, pose: 'idle', skin: 0 } };
const timers = new Set();

const RM = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const lsDel = k => { try { localStorage.removeItem(k); } catch (e) {} };
function mySkin() { const n = parseInt(lsGet(LS_SKIN, '0'), 10); return Number.isFinite(n) && n >= 0 ? n % SKINS.length : 0; }
const later = (ms, f) => { const t = setTimeout(() => { timers.delete(t); f(); }, ms); timers.add(t); return t; };
const clearTimers = () => { timers.forEach(clearTimeout); timers.clear(); };
const now = () => Date.now() + offset;

// grain: a tiny noise tile generated once (no image file, no data-URI SVG)
try {
  const c = document.createElement('canvas'); c.width = c.height = 96; const x = c.getContext('2d'), d = x.createImageData(96, 96);
  for (let i = 0; i < d.data.length; i += 4) { const v = 128 + Math.random() * 127 | 0; d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255; }
  x.putImageData(d, 0, 0); document.documentElement.style.setProperty('--grain', 'url(' + c.toDataURL('image/png') + ')');
} catch (e) {}

// ---------- audio buttons ----------
function sndUI() { $('btnMusic').classList.toggle('off', !AU.music); $('btnMusic').classList.toggle('wait', AU.music && !AU.started); $('btnSfx').classList.toggle('off', !AU.sfx); }
const padWanted = () => !S || S.state === 'lobby' || S.state === 'ended';
setOnStart(() => { sndUI(); if (AU.music && padWanted()) startPad(); });
sndUI();
$('btnMusic').onclick = () => { AU.music = !AU.music; saveSnd(); sndUI(); if (AU.music) { unlock(); if (padWanted()) startPad(); } else stopPad(); toast(AU.music ? 'Musik latar: nyala' : 'Musik latar: mati'); };
$('btnSfx').onclick = () => { AU.sfx = !AU.sfx; saveSnd(); sndUI(); if (AU.sfx) { unlock(); setTimeout(SFX.set, 30); } toast(AU.sfx ? 'Efek suara: nyala' : 'Efek suara: mati'); };

// ---------- network ----------
function saveSess(s) { sess = s; if (s) lsSet(LS_SESS, JSON.stringify(s)); else lsDel(LS_SESS); }
const net = createNet({
  getSession: () => sess,
  onOpen: () => $('connDot').classList.add('on'),
  onClose: () => $('connDot').classList.remove('on'),
  onMessage: onMsg,
});
const send = o => { const ok = net.send(o); if (!ok && o.t !== 'create' && o.t !== 'join') toast('Koneksi terputus, menyambung ulang…'); return ok; };

function onMsg(m) {
  if (m.serverTime) offset = m.serverTime - Date.now();
  switch (m.t) {
    case 'joined': me = m.id; saveSess({ code: m.code, token: m.token }); break;
    case 'state': {
      const prev = S; S = m.room; if (S.you) me = S.you.id;
      if (S.cfg) Object.assign(CFG, S.cfg);
      if (!playing) hpDisp = Object.fromEntries(S.players.map(p => [p.id, p.hp]));
      if (S.state === 'lobby' && prev && prev.state !== 'lobby') resetRound();
      if (S.state !== 'ended') endApplied = false;
      if (S.state === 'countdown' && (!prev || prev.state !== 'countdown')) onCountdownState();
      render(); break;
    }
    case 'countdown': cd = m; render(); if (S && S.round === m.round) { SFX.roundBell(); } break;
    case 'line': onLine(m); break;
    case 'progress': progressTxt = m.finished + '/' + m.of + ' selesai'; $('progress').textContent = progressTxt; break;
    case 'result': onResult(m); break;
    case 'end': break; // the following `state` (ended) carries winnerId/endReason
    case 'emoji': onEmoji(m); break;
    case 'error':
      if (m.code === 'old_client') { toast(m.msg); break; }
      if (m.code === 'stale' || m.code === 'dup' || m.code === 'spectator') break;
      toast(m.msg || 'Terjadi kesalahan'); break;
    case 'rejoin_failed': saveSess(null); S = null; me = null; show('home'); break;
    case 'left': saveSess(null); S = null; me = null; resetRound(); show('home'); break;
    case 'pong': break;
  }
}

// ---------- screens ----------
function show(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === 'scr-' + name));
  $('roomPill').textContent = (S && name !== 'home') ? 'Room ' + S.code : '';
  if (name === 'home' && location.search) history.replaceState(null, '', location.pathname);
  if (padWanted()) { if (AU.started && AU.music) startPad(); } else stopPad();
}
let toastT; function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200); }
const P = id => S && S.players.find(p => p.id === id);
const meP = () => P(me);
const hpOf = id => (playing || hpDisp[id] !== undefined) && hpDisp[id] !== undefined ? hpDisp[id] : (P(id) ? P(id).hp : CFG.HP);
const isSpectator = () => { const m = meP(); return !!(S && m && (m.out !== null || (W && W.round === S.round && W.entrant === false))); };

function render() {
  if (!S) { show('home'); return; }
  if (S.state === 'lobby') { show('lobby'); renderLobby(); return; }
  show('game'); renderGame();
}
function resetRound() { clearTimers(); playing = null; W = null; typer = null; sentDone = false; lastRes = null; cd = null; lineKey = ''; progressTxt = ''; $('fx').innerHTML = ''; $('songcard').hidden = true; slots.left = { id: null, pose: 'idle', skin: 0 }; slots.right = { id: null, pose: 'idle', skin: 0 }; }

function renderLobby() {
  $('lobbyCode').textContent = S.code;
  const m = meP(), host = m && m.isHost;
  $('plCount').textContent = S.players.length + '/' + CFG.MAX_PLAYERS;
  $('lobbyPlayers').innerHTML = S.players.map(p => '<div class="pl' + (p.id === me ? ' me' : '') + '"><img alt="" src="' + imgUrl(p.skin, 'idle') + '"><span class="nm">' + esc(p.name) + '</span>' + (p.isHost ? '<span class="tag">Host</span>' : '') + (p.online ? '' : '<span class="tag off">offline</span>') + (p.id === me ? '<span class="tag ok">Kamu</span>' : '') + '</div>').join('');
  $('swatches').innerHTML = SKINS.map((k, i) => '<button class="swatch' + (m && m.skin === i ? ' sel' : '') + '" data-skin="' + i + '" aria-label="Warna ' + k.n + '" title="' + k.n + '" style="background:' + k.dot + '"></button>').join('');
  const online = S.players.filter(p => p.online).length;
  $('btnStart').disabled = !(host && online >= 2);
  $('startHint').textContent = online < 2 ? 'Menunggu pemain lain — bagikan kode room (2–' + CFG.MAX_PLAYERS + ' pemain)' : host ? 'Siap? Tekan Mulai (' + online + ' pemain)' : 'Menunggu host menekan Mulai…';
}

// ---------- ring: the two big boxers ----------
function setSlot(side, id, pose, o) {
  o = o || {};
  const p = id ? P(id) : null, sl = slots[side];
  sl.id = id; sl.pose = pose; sl.skin = p ? p.skin : sl.skin;
  const img = $(side === 'left' ? 'imgL' : 'imgR'), el = $(side === 'left' ? 'slotL' : 'slotR');
  const url = imgUrl(sl.skin, pose); if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
  $(side === 'left' ? 'whoL' : 'whoR').textContent = o.label !== undefined ? o.label : (p ? p.name : '');
  el.classList.toggle('unknown', !!o.unknown);
  el.dataset.pose = pose; el.dataset.who = id || '';
  if (o.fx && !RM()) { el.classList.remove('punch', 'recoil'); void el.offsetWidth; el.classList.add(o.fx); }
}
function neutralRing() {
  setSlot('left', null, 'idle', { unknown: true, label: 'siapa?' });
  setSlot('right', null, 'idle', { unknown: true, label: 'siapa?' });
  slots.left.skin = (mySkin() + 1) % SKINS.length; slots.right.skin = (mySkin() + 2) % SKINS.length;
  const a = imgUrl(slots.left.skin, 'idle'), b = imgUrl(slots.right.skin, 'idle');
  if (a) $('imgL').setAttribute('src', a); if (b) $('imgR').setAttribute('src', b);
}

// ---------- avatars (static images) ----------
let avOrder = [];
function renderAvatars(sorted) {
  const row = $('avatars');
  const others = S.players.filter(p => p.id !== me && !(p.out === 'walkover' && p.hp === CFG.HP && false));
  const ids = sorted ? sorted.filter(id => id !== me && P(id)) : others.map(p => p.id);
  const rest = others.map(p => p.id).filter(id => !ids.includes(id));
  const order = sorted ? ids.concat(rest) : ids;
  const before = new Map([...row.children].map(e => [e.dataset.id, e.getBoundingClientRect()]));
  const have = new Set([...row.children].map(e => e.dataset.id));
  const same = order.length === have.size && order.every(id => have.has(id));
  if (!same) {
    row.innerHTML = order.map(id => '<div class="av" data-id="' + id + '"><span class="rk"></span><img alt="" draggable="false"><span class="n"></span><div class="hpbar"><i></i></div></div>').join('');
  }
  order.forEach((id, i) => {
    const e = row.querySelector('[data-id="' + id + '"]'); if (!e) return;
    const p = P(id); row.appendChild(e);
    const im = e.querySelector('img'), u = imgUrl(p.skin, p.out === 'ko' ? 'ko' : 'idle'); if (im.getAttribute('src') !== u) im.setAttribute('src', u);
    e.querySelector('.n').textContent = p.name;
    e.classList.toggle('out', p.out !== null); e.classList.toggle('off', !p.online);
    const pc = Math.max(0, Math.min(100, hpOf(id) / CFG.HP * 100)), bar = e.querySelector('.hpbar i');
    bar.style.width = pc + '%'; bar.className = pc <= 25 ? 'low' : pc <= 50 ? 'mid' : '';
    e.querySelector('.rk').textContent = sorted ? (rankOf(id)) : '';
    e.title = p.name + ' · HP ' + hpOf(id);
  });
  row.classList.toggle('sorted', !!sorted);
  if (!same || !sorted) return;
  if (!RM()) order.forEach(id => { // FLIP: slide from the old position into the finishing order
    const e = row.querySelector('[data-id="' + id + '"]'), a = before.get(id); if (!e || !a) return;
    const b = e.getBoundingClientRect(), dx = a.left - b.left; if (!dx) return;
    e.style.transition = 'none'; e.style.transform = 'translateX(' + dx + 'px)'; void e.offsetWidth;
    e.style.transition = 'transform var(--t-drift) var(--ease-drift)'; e.style.transform = '';
  });
}
function rankOf(id) { const o = lastRes && lastRes.order.find(x => x.id === id); return o ? o.rank : ''; }

// ---------- game screen ----------
function statusText() {
  if (!S) return '';
  const m = meP();
  if (S.state === 'countdown') return S.ultiIn === 0 ? 'Bersiap… ronde ULTI!' : 'Bersiap…';
  if (S.state === 'paused') return 'Menunggu pemain — pertandingan dijeda';
  if (S.state === 'line') {
    if (isSpectator()) return 'Kamu penonton di ronde ini';
    if (!W || W.round !== S.round) return 'Ronde berjalan — tunggu';
    if (sentDone) return 'Selesai! Menunggu yang lain…';
    return W.ulti ? 'ULTI! Huruf besar dan tanda baca harus pas' : 'Ketik secepatnya!';
  }
  if (S.state === 'result' && lastRes && lastRes.round === S.round) {
    if (playing) return 'Domino…';
    const l = lastRes.chain.filter(c => c.to === me).reduce((n, c) => n + c.applied, 0), g = lastRes.chain.filter(c => c.from === me && !c.extra).reduce((n, c) => n + c.applied, 0);
    if (m && lastRes.sat.includes(me)) return 'Kamu duduk di ronde ini';
    return (g ? 'Pukulanmu ' + g : 'Kamu tidak memukul') + ' · ' + (l ? 'kamu kena ' + l : 'kamu aman');
  }
  return '';
}
function renderGame() {
  const m = meP();
  renderAvatars(playing ? chainIds : null);
  if (m) {
    $('meNm').textContent = m.name + ' (kamu)'; $('meSw').style.background = skinOf(m.skin).dot;
    const pc = Math.max(0, Math.min(100, hpOf(me) / CFG.HP * 100)), bar = $('meHp'); bar.style.width = pc + '%'; bar.className = pc <= 25 ? 'low' : pc <= 50 ? 'mid' : '';
    $('meHpTxt').textContent = 'HP ' + hpOf(me) + (m.streak ? ' · ' + m.streak + 'x' : '');
    $('meBar').classList.toggle('hot', !!m.fire);
  }
  $('status').textContent = statusText();
  $('ultiBadge').classList.toggle('on', !!(S.ultiIn === 1 && (S.state === 'result' || S.state === 'countdown')));
  const spec = !!(m && (m.out !== null || (W && W.round === S.round && W.entrant === false && S.state === 'line')));
  if (spec) dropTyperFocus();
  const midMatch = S.state !== 'ended';
  $('specbar').hidden = !(spec && midMatch) && S.state !== 'ended';
  $('linebox').hidden = S.state === 'ended' || S.state === 'paused';
  $('endCard').hidden = S.state !== 'ended';
  $('scr-game').classList.toggle('ended', S.state === 'ended');
  $('leaveRow').hidden = S.state === 'ended';
  if (S.state === 'ended') renderEnd(); 
  else if (!playing) {
    if (S.state === 'countdown' || (S.state === 'line' && W && W.round === S.round && !sentDone) || S.state === 'paused') neutralRing();
  }
  if (S.state === 'line') { renderLine(); updateFocusHint(); }
  tickCountdown();
}

// ---------- countdown ----------
let cdKey = '';
function onCountdownState() { resetRoundVisual(); }
function resetRoundVisual() { W = null; typer = null; sentDone = false; lineKey = ''; progressTxt = ''; $('progress').textContent = ''; $('line').innerHTML = ''; $('songcard').hidden = true; neutralRing(); }
function tickCountdown() {
  if (!S || S.state !== 'countdown' || !cd || cd.round !== S.round) { if (cdKey) { cdKey = ''; $('fx').querySelectorAll('[data-cd]').forEach(e => e.remove()); } return; }
  const rem = cd.endsAt - now(), step = cd.ms / 3, n = Math.max(0, Math.ceil(rem / step)), key = n > 0 ? String(n) : '';
  if (key !== cdKey) {
    $('fx').querySelectorAll('[data-cd]').forEach(e => e.remove()); cdKey = key;
    if (key) { const d = document.createElement('div'); d.className = 'cdnum'; d.dataset.cd = '1'; d.textContent = key; $('fx').appendChild(d); }
  }
  if (S.state === 'countdown') requestAnimationFrame(tickCountdown);
}

// ---------- the line ----------
function lineHtml(text) {
  let h = '', i = 0;
  for (const word of text.split(' ')) {
    h += '<span class="w">';
    for (const ch of word) { h += '<span class="c" data-i="' + i + '">' + esc(ch) + '</span>'; i++; }
    h += '</span>';
    if (i < text.length) { h += '<span class="c sp" data-i="' + i + '"> </span>'; i++; }
  }
  return h;
}
function onLine(m) {
  W = m; sentDone = false; progressTxt = '';
  if (cdKey) { cdKey = ''; $('fx').querySelectorAll('[data-cd]').forEach(e => e.remove()); }
  $('songcard').hidden = true; $('progress').textContent = '';
  tStart = performance.now();
  typer = m.entrant ? createTyper(m.text) : null;
  const inp = $('typer'); inp.value = '';
  lineKey = ''; renderLine(true);
  if (m.entrant) neutralRing();
  // B1: the whole line (two rows) must be inside the viewport for host and guests — pull the box into view as it appears
  try { $('linebox').scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (e) {}
  if (m.entrant) focusTyper(); else dropTyperFocus();
  if (S) renderGame();
  ensureLineVisible();
}
function ensureLineVisible() {
  requestAnimationFrame(() => {
    const r = $('linebox').getBoundingClientRect(), vh = window.innerHeight;
    if (r.bottom > vh || r.top < 0) { try { $('linebox').scrollIntoView({ block: r.height >= vh ? 'start' : 'end' }); } catch (e) {} }
  });
}
function renderLine(force) {
  const box = $('line');
  if (!W || !S || W.round !== S.round) { if (S && S.state === 'line') return; box.innerHTML = lineKey && S && S.state === 'result' ? box.innerHTML : ''; return; }
  const key = W.round + ':' + W.text;
  if (force || key !== lineKey) { box.innerHTML = lineHtml(W.text); lineKey = key; }
  box.classList.toggle('ulti', !!W.ulti); $('linebox').classList.toggle('ulti', !!W.ulti); box.classList.toggle('spec', !W.entrant);
  const t = typer, typed = t ? t.typed.length : 0, bad = t && t.bad;
  const cs = box.querySelectorAll('.c');
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i].classList;
    c.toggle('ok', i < typed); c.toggle('bad', !!bad && i === typed); c.toggle('cur', !!t && !sentDone && !bad && i === typed);
  }
}
function typingPhase() { return !!(S && S.state === 'line' && W && W.round === S.round && W.entrant && typer); }
function updateFocusHint() { $('focusHint').classList.toggle('on', typingPhase() && !sentDone && document.activeElement !== $('typer')); }
// B4: a spectator must not keep the soft keyboard open over the emoji bar
function dropTyperFocus() { const i = $('typer'); if (document.activeElement === i) { try { i.blur(); } catch (e) {} } i.value = ''; updateFocusHint(); }
function focusTyper() { try { $('typer').focus({ preventScroll: true }); } catch (e) {} updateFocusHint(); }
$('typer').addEventListener('input', () => {
  if (!typingPhase() || sentDone) { $('typer').value = ''; return; }
  const before = typer.typed.length, bTypos = typer.typos;
  $('typer').value = typer.input($('typer').value);
  if (typer.typos > bTypos) SFX.err(); else if (typer.typed.length > before) SFX.tap();
  renderLine();
  if (typer.done) {
    sentDone = true;
    const elapsed = Math.max(Number(CFG.ELAPSED_MIN) || 150, Math.min(CFG.WORD_CAP_MS, Math.round(performance.now() - tStart)));
    send({ t: 'done', round: W.round, elapsed, typos: typer.typos });
    $('typer').value = ''; renderGame();
  }
});
$('typer').addEventListener('blur', () => setTimeout(updateFocusHint, 50));
$('typer').addEventListener('focus', updateFocusHint);
$('focusHint').addEventListener('pointerdown', e => { e.preventDefault(); focusTyper(); });
$('linebox').addEventListener('pointerdown', () => { if (typingPhase() && !sentDone) focusTyper(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || !S) return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' && document.activeElement.id !== 'typer') return;
  if (S.state === 'ended' && !$('btnRematch').disabled) $('btnRematch').click();
  else if (S.state === 'lobby' && !$('btnStart').disabled) $('btnStart').click();
});

// ---------- result: the domino ----------
function pickAnim(link, asVictim) {
  if (asVictim) return link.tier === 'block' ? 'block' : 'ouch';
  return link.critical || link.ulti ? 'uppercut' : 'jab';
}
const hitSound = link => link.tier === 'block' ? SFX.block : (link.critical || link.ulti) ? SFX.uppercut : SFX.jab;
function onResult(res) {
  lastRes = res; clearTimers();
  $('fx').querySelectorAll('[data-cd]').forEach(e => e.remove()); cdKey = '';
  const head = Math.min(400, (CFG.RESULT_MS || 1400) / 2), linkMs = CFG.LINK_MS || 150, n = res.chain.length;
  const mine = res.chain.find(c => c.to === me), out = res.chain.find(c => c.from === me && !c.extra);
  const first = res.chain[0];
  const leftId = mine ? mine.from : (!P(me) || !out) && first && isSpectator() ? first.from : null;
  const rightId = out ? out.to : (isSpectator() && first ? first.to : null);
  chainIds = res.order.map(o => o.id);
  playing = { res, t0: performance.now() };
  hpDisp = Object.fromEntries((S ? S.players : []).map(p => [p.id, p.hp]));
  // hpDisp holds the HP before this round: the state that follows `result` already carries the new HP
  res.chain.forEach(c => { hpDisp[c.to] = (hpDisp[c.to] !== undefined ? hpDisp[c.to] : CFG.HP); });
  const pre = {}; for (const id of Object.keys(res.hp)) pre[id] = res.hp[id];
  res.chain.forEach(c => { pre[c.to] += c.applied; }); hpDisp = pre;
  log.length = 0; log.push({ ev: 'start', at: 0, order: chainIds.slice(), left: leftId, right: rightId });
  $('ring').dataset.state = 'domino';
  if (S) { renderAvatars(chainIds); renderGame(); }
  // the ring goes quiet: the two big boxers show who they are
  setSlot('left', leftId, 'idle', { label: leftId ? P(leftId) && P(leftId).name : '—', unknown: !leftId });
  setSlot('right', rightId, 'idle', { label: rightId ? P(rightId) && P(rightId).name : '—', unknown: !rightId });
  const instant = RM();
  res.chain.forEach((l, i) => later(instant ? 0 : head + i * linkMs, () => playLink(l, i, res, leftId, rightId, mine, out)));
  later(instant ? 0 : head + n * linkMs, () => {
    // title + artist card, for TITLE_MS
    $('songTitle').textContent = res.song.title; $('songArtist').textContent = res.song.artist; $('songcard').hidden = false;
    log.push({ ev: 'song', at: Math.round(performance.now() - playing.t0), title: res.song.title });
    later(CFG.TITLE_MS || 1000, () => { $('songcard').hidden = true; });
  });
  later(instant ? 0 : head + n * linkMs + 20, () => { // the domino is over: show the final numbers
    hpDisp = Object.fromEntries(Object.entries(res.hp)); playing && (playing.done = true);
    log.push({ ev: 'end', at: Math.round(performance.now() - playing.t0) });
    $('ring').dataset.state = 'idle';
    if (S) { renderAvatars(chainIds); renderGame(); }
  });
  later((res.endsAt - now()) + 40, () => { playing = null; if (S) { hpDisp = Object.fromEntries(S.players.map(p => [p.id, p.hp])); renderGame(); } });
}
function floatAt(el, text, cls) { const d = document.createElement('div'); d.className = 'dm'; d.textContent = text; el.appendChild(d); setTimeout(() => d.remove(), 800); }
function playLink(l, i, res, leftId, rightId, mine, out) {
  const t = Math.round(performance.now() - playing.t0);
  const fromEl = $('avatars').querySelector('[data-id="' + l.from + '"]'), toEl = $('avatars').querySelector('[data-id="' + l.to + '"]');
  hpDisp[l.to] = Math.max(0, (hpDisp[l.to] || 0) - l.applied);
  const ko = res.ko.includes(l.to);
  if (fromEl) { fromEl.classList.add('snap'); setTimeout(() => fromEl.classList.remove('snap'), 220); }
  if (toEl) { toEl.classList.add('hit'); setTimeout(() => toEl.classList.remove('hit'), 300); if (!RM()) floatAt(toEl, '-' + l.applied); }
  let sound = false;
  if (l === mine) { // someone hit me: the left boxer throws it
    setSlot('left', leftId, pickAnim(l, false), { label: P(leftId) && P(leftId).name, fx: 'punch' });
    $('meBar').classList.add('hit'); setTimeout(() => $('meBar').classList.remove('hit'), 300);
    if (!RM()) { const d = document.createElement('div'); d.className = 'dmg l'; d.textContent = '-' + l.applied; $('fx').appendChild(d); setTimeout(() => d.remove(), 1000); }
    (ko ? SFX.ko : hitSound(l))(); sound = true;
  }
  if (l === out) { // I hit someone: the right boxer takes it
    setSlot('right', rightId, ko ? 'ko' : pickAnim(l, true), { label: P(rightId) && P(rightId).name, fx: 'recoil' });
    if (!RM()) { const d = document.createElement('div'); d.className = 'dmg r'; d.textContent = '-' + l.applied; $('fx').appendChild(d); setTimeout(() => d.remove(), 1000); }
    if (!sound) (ko ? SFX.ko : hitSound(l))(); sound = true;
  }
  if (!mine && !out && i === 0 && isSpectator()) { // a spectator watches the first link in the ring
    setSlot('left', leftId, pickAnim(l, false), { label: P(leftId) && P(leftId).name, fx: 'punch' });
    setSlot('right', rightId, ko ? 'ko' : pickAnim(l, true), { label: P(rightId) && P(rightId).name, fx: 'recoil' });
    (ko ? SFX.ko : hitSound(l))();
  }
  if (l.ulti && !RM()) { $('ring').classList.remove('shake'); void $('ring').offsetWidth; $('ring').classList.add('shake'); setTimeout(() => $('ring').classList.remove('shake'), 260); }
  if ((l === mine || l === out) && l.critical) burst('KRITIKAL!', l.ulti);
  if ((l === mine || l === out) && l.ulti && !l.critical) burst('ULTI!', true);
  log.push({ ev: 'link', i, at: t, from: l.from, to: l.to, applied: l.applied, tier: l.tier, ulti: l.ulti, ko, leftPose: slots.left.pose, rightPose: slots.right.pose, sound });
  renderAvatars(chainIds);
  renderGame();
}
function burst(text, ulti) { const d = document.createElement('div'); d.className = 'burst' + (ulti ? ' ulti' : ''); d.textContent = text; $('fx').appendChild(d); setTimeout(() => d.remove(), 1000); }

// ---------- spectators, emoji ----------
$('emojis').innerHTML = EMOJIS.map((e, i) => '<button data-e="' + i + '" aria-label="Emoji ' + (i + 1) + '">' + e + '</button>').join('');
$('emojis').onclick = e => { const b = e.target.closest('[data-e]'); if (b) { send({ t: 'emoji', e: Number(b.dataset.e) }); } };
function onEmoji(m) {
  const p = P(m.from); const d = document.createElement('div'); d.className = 'emo'; d.style.left = (8 + Math.random() * 78) + '%';
  d.innerHTML = esc(EMOJIS[m.e] || '') + '<small>' + esc(p ? p.name : '') + '</small>'; $('fx').appendChild(d); setTimeout(() => d.remove(), 1700);
  SFX.emoji();
}

// ---------- end screen ----------
function renderEnd() {
  const win = P(S.winnerId), r = S.endReason, m = meP();
  const lastKo = lastRes && lastRes.ko.length ? lastRes.ko[lastRes.ko.length - 1] : null;
  if (win) { setSlot('left', win.id, 'win', { label: win.name }); const loser = lastKo && lastKo !== win.id ? lastKo : null; setSlot('right', loser, loser ? 'ko' : 'idle', { label: loser && P(loser) ? P(loser).name : '', unknown: !loser }); }
  else { setSlot('left', null, 'idle', { unknown: true, label: '' }); setSlot('right', null, 'idle', { unknown: true, label: '' }); }
  $('ring').dataset.state = 'end';
  const won = S.winnerId === me;
  $('endTitle').textContent = win ? (won ? 'Kamu menang!' : win.name + ' menang!') : (r === 'walkover' ? 'Pertandingan dibatalkan' : 'Seri');
  $('endSub').textContent = r === 'walkover' ? 'Pemain lain keluar atau terputus lebih dari ' + Math.round(CFG.WALKOVER_MS / 1000) + ' detik' : r === 'bank' ? 'Lirik habis — HP tertinggi menang' : 'Tinggal satu yang berdiri.';
  if (!endApplied) { endApplied = true; (won ? SFX.win : SFX.lose)(); }
  const votes = S.players.filter(p => p.rematch && p.online).length, online = S.players.filter(p => p.online).length;
  $('btnRematch').disabled = !!(m && m.rematch); $('btnRematch').textContent = m && m.rematch ? 'Menunggu…' : 'Rematch';
  $('btnStartNow').hidden = !(m && m.isHost && votes >= 2 && votes < online);
  $('rematchHint').textContent = votes + '/' + online + ' siap rematch' + (S.players.length < 2 ? ' — menunggu pemain lain' : '');
  renderStandings();
  $('status').textContent = '';
}
// Final table: the server computes the places (room.standings), the client only draws them.
function renderStandings() {
  const list = $('standings'), rows = (S && S.standings) || [];
  list.hidden = !rows.length;
  list.innerHTML = rows.map(r => {
    const fate = r.out === 'ko' ? 'KO ronde ' + r.round : r.out === 'walkover' ? 'keluar ronde ' + r.round : 'HP ' + r.hp;
    return '<li class="' + (r.id === me ? 'me' : '') + '" data-id="' + esc(r.id) + '"><span class="pl">' + r.place + '</span>'
      + '<img alt="" src="' + imgUrl(r.skin, r.out === 'ko' ? 'ko' : 'idle') + '"><span class="nm">' + esc(r.name) + (r.id === me ? ' (kamu)' : '')
      + '</span><span class="ft">' + esc(fate) + '</span></li>';
  }).join('');
}

// ---------- buttons ----------
const cleanName = () => ($('name').value || '').trim().slice(0, 16);
function needName() { const n = cleanName(); if (!n) { toast('Isi nama dulu'); $('name').focus(); return null; } lsSet(LS_NAME, n); return n; }
$('btnCreate').onclick = () => { unlock(); const n = needName(); if (n) send({ t: 'create', name: n, skin: mySkin() }); };
$('btnJoin').onclick = () => { unlock(); const n = needName(), c = $('joinCode').value.trim().toUpperCase(); if (!n) return; if (c.length !== 5) { toast('Kode room 5 karakter'); return; } send({ t: 'join', code: c, name: n, skin: mySkin() }); };
$('joinCode').addEventListener('input', () => { $('joinCode').value = $('joinCode').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('joinCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoin').click(); });
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') { if ($('joinCode').value.trim()) $('btnJoin').click(); else $('joinCode').focus(); } });
$('btnStart').onclick = () => send({ t: 'start' });
$('btnStartNow').onclick = () => send({ t: 'start' });
$('swatches').onclick = e => { const b = e.target.closest('[data-skin]'); if (!b) return; const k = Number(b.dataset.skin); lsSet(LS_SKIN, String(k)); send({ t: 'skin', skin: k }); };
$('btnRematch').onclick = () => send({ t: 'rematch' });
const leave = () => { if (S && S.state !== 'lobby' && S.state !== 'ended' && !confirm('Keluar dari pertandingan?')) return; send({ t: 'leave' }); };
$('btnLeaveLobby').onclick = leave; $('btnLeaveGame').onclick = leave; $('btnLeaveEnd').onclick = leave;
function roomLink() { return location.origin + location.pathname.replace(/[^/]*$/, '') + '?room=' + (S ? S.code : ''); }
async function copy(txt) { try { await navigator.clipboard.writeText(txt); return true; } catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (_) {} ta.remove(); return ok; } }
$('btnCopyCode').onclick = async () => { toast((await copy(S.code)) ? 'Kode disalin' : 'Kode: ' + S.code); };
$('btnShare').onclick = async () => { const url = roomLink(); if (navigator.share) { try { await navigator.share({ title: 'Tinju Kata', text: 'Gabung room ' + S.code, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } } toast((await copy(url)) ? 'Link disalin' : url); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') net.ensure(); });
window.addEventListener('resize', () => { if (S && S.state === 'line') ensureLineVisible(); });

// ---------- boot ----------
try { const s = JSON.parse(lsGet(LS_SESS, 'null')); if (s && s.code && s.token) sess = s; } catch (e) {}
$('name').value = lsGet(LS_NAME, '');
const qp = new URLSearchParams(location.search).get('room');
if (qp && !sess) { $('joinCode').value = qp.toUpperCase().slice(0, 5); setTimeout(() => ($('name').value ? $('btnJoin') : $('name')).focus(), 50); }
const base = location.pathname.replace(/[^/]*$/, '');
const artReady = loadArt(base).then(n => { if (S) render(); return n; }).catch(() => 0);
net.connect();

// test hook: everything a test needs, nothing it can break
window.__tinju = window.__tk = {
  version: VERSION, CFG, SKINS, POSES, EMOJIS,
  get state() { return S; }, get me() { return me; }, get line() { return W; }, get lastResult() { return lastRes; },
  get typing() { return typer ? { typed: typer.typed, bad: typer.bad, typos: typer.typos, done: typer.done, sentDone } : { typed: '', bad: '', typos: 0, done: false, sentDone }; },
  get playing() { return !!playing; }, get log() { return log; }, get slots() { return slots; }, get art() { return artReady; },
  get avatarOrder() { return [...$('avatars').children].map(e => e.dataset.id); }, send, audio: AU, sfx: SFX, actx,
};
