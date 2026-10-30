# Tinju Kata — changelog

## 2.0.0 — 2026-10-30 (branch tinju/2.0-royale; not deployed)
Tinju Kata becomes a lyric-typing royale for 2–10 players. Protocol 2 is incompatible with 1.x (a 1.x tab gets `old_client` and a "muat ulang" toast).
- **Game:** everyone types the same lyric line; when all are done (or after 20 s) the punches fall like dominoes down the finishing order — 1st hits 2nd,
  2nd hits 3rd, … the last one only takes it. Order is by own `elapsed`, then fewer typos; equal = shared rank, no hit inside it. Damage is 1.0's function
  with the per-character base retuned for lines, multiplied by the victim's rank weight `k/(n−1)` (the slower you finish, the harder you are hit); received damage
  per round is capped at 60. KO → spectator in the same room (8 emoji); last one standing wins; rematch by vote, same room.
  Rounds 1–3 show the line lowercase without punctuation; from round 4 verbatim; ULTI (round 4–6, then every 4–6) draws lines of 30+ chars, ×2.5.
- **Fix B4 (gate U-10):** a KO'd player / spectator drops focus on the hidden typing input (on `line` with `entrant:false`, on KO and on rejoin as spectator), so the phone keyboard no longer stays open over the emoji bar; entrants keep focus across rounds.
- **Fix (PR #1 review, Jiwoo P1):** a player who rejoins mid-line is locked out of that round, but `maybeClose()` still waited for their `done`, so the room froze until the word cap (8.3 s after the last finish in the 3-player repro). It now skips entrants with `lockedRound === round` (they stay entrants and still take the hit). Proto test P-22b asserts the result arrives < 1 s after the last finish. Also dropped a redundant if/else in `onDisconnect`.
- **`BASE_PER_CHAR` = 0.6** (the brief started at 0.7), `RANK_WEIGHT` 1, `EXTRA_LAST_HIT` 0. Simulation (1000 matches, 3–8 chars/s bots, real `resolveRound()`,
  `tests/evidence/sim-2.0.txt`), A-na's model, 10 bots: match length p10/p50/p90 184/206/231 s (K-2 ok), 2 bots 45/58/87 s (K-3 ok), rounds with a KO p50 7 (K-4 ok),
  first KO round p50 5 (K-5 ok), 97.1 % of matches never have more than 3 KOs in a round.
- **Open item for Pras (K-1, not a build blocker per Stella 2026-10-30 00:58):** K-1 asks "≤ 3 KOs per round in ≥ 95 % of matches and never ≥ 5". At 0.6, 1 match in 1000
  has a round with ≥ 5 KOs (A-na's model); with bank-shaped lines (normal < 30, ULTI ≥ 30 chars) 93.5 % are ≤ 3 and 8 matches in 1000 have ≥ 5 — every one of them an ULTI round.
  No base from 0.5 to 1.0 passes. Not applied, for Pras to decide: `TK_EXTRA_LAST_HIT=1` (a flag; passes K-1 on both models, 99.6 % / 98.6 %, 0 matches ≥ 5) or `ULTI_X` 1.25–1.5.
- **Server:** `server/engine.js` (pure rules, `resolveRound`), `server/lyrics.js` (loader/validator), `server/server.js` (rooms, protocol, `TK_*` overrides, `TK_SEED` replays a match),
  lyrics loaded at boot and on `SIGHUP` (invalid file: logged, old bank kept; running matches keep their snapshot). `server/words.js` is gone.
- **Client:** `index.html` + `src/{main,net,audio,art,typing}.js` as ES modules, `src/theme.css` (every colour, font, radius, duration and easing — card C, Angkasa lofi) and
  `src/style.css` (layout only). Seven SVG poses (`assets/img/boxer-*.svg`: idle, jab, uppercut, block, ouch, ko, win), one design in four colourways (recoloured at load;
  **one skin set**, no per-skin drawings). Lobby for 2–10, avatar row (up to 9 others, static images + HP bars), the two big boxers (left: who hit you, right: who you hit),
  the domino (~0.15 s per link, snap then drift), strict-typo lyric box, song title + artist card for 1 s, ULTI shake, spectator emoji, rematch votes.
  Four layered hit sounds (impact click + low thump + tail, synthesised) and a soft detuned lobby pad. Input `autocapitalize=off autocorrect=off spellcheck=false inputmode=text`;
  curly quotes map to straight, a trailing space after the last character is ignored. B1: the line box is scrolled into view on `line`.
  `tk_name/tk_sess/tk_snd/tk_skin` kept (old `tk_skin` maps modulo 4); `tk_theme` ignored; the ☾ toggle is gone.
- **Content:** `server/lyrics.txt` is still **placeholder content** (46 invented songs, 252 lines). The real bank (Indonesian songs everyone can finish from memory) has to be supplied;
  drop it in the same format and send `SIGHUP`.
- **Tests:** `test-rules.mjs` (resolveRound, O-01…O-33, D-1…D-9, rank weight, typing), `test-proto.mjs`, `test-ui.mjs` (3 players through the real server on desktop / iPhone 12 / 320×480
  + a 2-player reduced-motion match), `test-audio.mjs`, `tests/e2e/look.mjs` (10-player room, 3 devices), `sim-2.0.mjs`.
- Not verified: a real iPhone and a real Android keyboard (autocorrect, prediction, trailing space), frame times on real hardware, the placeholder bank's tone.

## 1.0.0 — 2026-10-29
- First release: 1v1 typing-boxing, HP 100, ULTI words every 4–6 rounds, rematch, canvas-drawn boxers, sound.
- Moved into `games/tinju/`: client split into `index.html` + `src/style.css` + `src/game.js`, server in
  `server/server.js` + `server/words.js` on `shared/server/` (WebSocket + HTTP, extracted unchanged from this
  server). The client is byte-identical to what was live (`node tools/inline.mjs games/tinju | grep -v "saved theme"`
  → md5 `af9110b8…`) except one line: a `<head>` script that sets the saved theme before the stylesheet applies.
  Without it the split client faded in from light on a dark reload (0.4 s), which the single file never did.
