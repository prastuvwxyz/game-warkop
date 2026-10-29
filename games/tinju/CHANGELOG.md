# Tinju Kata — changelog

## 2.0.0 — in progress (branch tinju/2.0-royale) — server side done, client NOT built
Why it is not finished: the 10-bot simulation on the real `resolveRound()` fails K-1 (≤ 3 KOs per round in ≥ 95 % of
matches, never ≥ 5) at every `BASE_PER_CHAR` from 0.5 to 1.0 with `RANK_WEIGHT=1`. Per the brief the build stops before art
until Pras decides. Numbers: `tests/evidence/sim-2.0.txt`.
- **Final `BASE_PER_CHAR` = 0.6** (the brief started at 0.7). Best allowed value: A-na's model, 10 bots: 97.1 % of matches ≤ 3 KOs in a
  round, 1 match in 1000 with a round of ≥ 5 KOs; match length p10/p50/p90 184/206/231 s (K-2 ok); 2 players 45/58/87 s (K-3 ok); KO
  rounds p50 7 (K-4 ok); first KO round p50 5 (K-5 ok). Bank-shaped lines (normal < 30, ULTI ≥ 30): 93.5 % and 8 matches ≥ 5 KOs.
  Every round with ≥ 5 KOs is an ULTI round. With `EXTRA_LAST_HIT=1` (a flag, off in the brief) K-1 passes: 99.6 % / 98.6 %, 0 matches ≥ 5.
- New: 2–10 players per room, protocol 2 (`v:2`; 1.x tabs get `error{code:'old_client'}`), domino resolution by finishing order
  (`elapsed`, then typos; ties share a rank), rank-weighted damage, received cap 60 per round, KO → spectator with emoji,
  `walkover`/`sat`, rematch with votes, seeded rooms (`TK_SEED`), lyric bank `server/lyrics.txt` loaded at boot and on `SIGHUP`
  (`server/words.js` is gone). `server/engine.js` is pure (rules), `server/lyrics.js` is the loader/validator.
- The bank in `server/lyrics.txt` is PLACEHOLDER content (46 invented songs, 252 lines) — to be replaced with the real bank.
- Client (`index.html`, `src/`), SVG boxers, hit sounds, `test-ui.mjs`, `test-audio.mjs`, `tests/e2e/look.mjs`: still 1.0, not updated.
  `tinju-version` meta is still 1.0.0 on purpose; do not release this branch as is.

## 1.0.0 — 2026-10-29
- First release: 1v1 typing-boxing, HP 100, ULTI words every 4–6 rounds, rematch, canvas-drawn boxers, sound.
- Moved into `games/tinju/`: client split into `index.html` + `src/style.css` + `src/game.js`, server in
  `server/server.js` + `server/words.js` on `shared/server/` (WebSocket + HTTP, extracted unchanged from this
  server). The client is byte-identical to what was live (`node tools/inline.mjs games/tinju | grep -v "saved theme"`
  → md5 `af9110b8…`) except one line: a `<head>` script that sets the saved theme before the stylesheet applies.
  Without it the split client faded in from light on a dark reload (0.4 s), which the single file never did.
