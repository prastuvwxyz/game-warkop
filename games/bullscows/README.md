# Bulls & Cows — multiplayer

Live: https://nalar.prastya.net/bullscows/

Guess-the-number game: 4 unique digits, green = right digit right place (bull),
yellow = right digit wrong place (cow). Players create/join a room by code, each
sets their own secret, turn order is shuffled, a cracked player is eliminated,
last one standing wins. 2–6 players per room, 75 s per turn, reconnect by token.

Version: the `bullscows-version` meta in `index.html` (see `CHANGELOG.md`).

## Layout
- `server/server.js` — Node >= 20, zero dependencies. Rooms, turns and scoring; all game state in memory.
  HTTP and the WebSocket come from `shared/server/` (`static.js`, `ws.js`) on the same port.
- `index.html` + `src/style.css` + `src/game.js` — the client (no build step, no external assets).
- `tests/suite.test.mjs` — runs the checks below on a server at a free port ≥ 3300:
  `test-proto.mjs` (50 protocol checks, `TURN_MS=1500`), `test-ui.mjs`, `test-audio.mjs`, `test-ios-sim.mjs`,
  `test-refresh.mjs` (Playwright). Run by hand: `test-level.mjs` (loudness on the live URL) and
  `test-ios-sim.mjs` (needs a Chromium that withholds user activation from a synthetic pointerdown — see the suite).
- `tests/e2e/look.mjs` — look-at-it run on desktop, iPhone 12 and a 320 px phone.

## Run locally
    PORT=3301 node games/bullscows/server/server.js     # http://127.0.0.1:3301/bullscows/
    node --test "games/bullscows/tests/**/*.test.mjs"

## Deploy
Skill `game-ship`: a release dir under `/var/www/warkop/bullscows/`, a user unit running `server/server.js`
on port 3100, and the nginx block in `/etc/nginx/apps.d/bullscows.conf`.

Env: `PORT` (3100) · `HOST` (127.0.0.1) · `BASE` (/bullscows) · `TURN_MS` (75000).

## Protocol (JSON over WS)
client → server: create{name} · join{code,name} · rejoin{code,token} · secret{secret}
· start · guess{target,guess} · restart · kick{id} · leave · ping
server → client: joined{code,token,id} · state{room} · error{msg} · rejoin_failed
· kicked · left · pong
