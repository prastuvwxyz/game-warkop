# Tinju Kata — changelog

## 1.0.0 — 2026-10-29
- First release: 1v1 typing-boxing, HP 100, ULTI words every 4–6 rounds, rematch, canvas-drawn boxers, sound.
- Moved into `games/tinju/`: client split into `index.html` + `src/style.css` + `src/game.js`, server in
  `server/server.js` + `server/words.js` on `shared/server/` (WebSocket + HTTP, extracted unchanged from this
  server). The client is byte-identical to what was live (`node tools/inline.mjs games/tinju` → md5 `af9110b8…`).
