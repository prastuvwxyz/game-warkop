# Bulls & Cows — changelog

## 3.0.0 — 2026-10-29
- First tagged release: v3 as it has been live (light/dark theme, sound, reconnect by token).
- Moved into `games/bullscows/`: client split into `index.html` + `src/style.css` + `src/game.js`, server in
  `server/server.js` on `shared/server/` (WebSocket + HTTP, extracted unchanged from this server). The client is
  byte-identical to what was live apart from the new `bullscows-version` meta
  (`node tools/inline.mjs games/bullscows | grep -v bullscows-version` → md5 `3d6de47c…`).
