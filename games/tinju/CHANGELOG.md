# Tinju Kata — changelog

## 1.0.0 — 2026-10-29
- First release: 1v1 typing-boxing, HP 100, ULTI words every 4–6 rounds, rematch, canvas-drawn boxers, sound.
- Moved into `games/tinju/`: client split into `index.html` + `src/style.css` + `src/game.js`, server in
  `server/server.js` + `server/words.js` on `shared/server/` (WebSocket + HTTP, extracted unchanged from this
  server). The client is byte-identical to what was live (`node tools/inline.mjs games/tinju | grep -v "saved theme"`
  → md5 `af9110b8…`) except one line: a `<head>` script that sets the saved theme before the stylesheet applies.
  Without it the split client faded in from light on a dark reload (0.4 s), which the single file never did.
