# Bulls & Cows — multiplayer

Live: https://nalar.prastya.net/bullscows/

Guess-the-number game: 4 unique digits, green = right digit right place (bull),
yellow = right digit wrong place (cow). Players create/join a room by code, each
sets their own secret, turn order is shuffled, a cracked player is eliminated,
last one standing wins. 2–6 players per room, 75 s per turn, reconnect by token.

## Layout
- `server.js` — Node >= 20, zero dependencies. HTTP (index + /health) and a
  minimal RFC 6455 WebSocket server on the same port. All game state in memory.
- `public/index.html` — single-file client (no build step, no external assets).
- `nginx-location.conf` — the nginx `location /bullscows` block.
- `test-proto.mjs` — 50 protocol checks (`node test-proto.mjs <port>`, run the
  server with `TURN_MS=1500` so the timeout test is fast).
- `test-ui.mjs` — 30 Playwright checks, two browsers (desktop + iPhone 12).

## Run locally
    PORT=3100 node server.js          # http://127.0.0.1:3100/bullscows/
    curl localhost:3100/bullscows/health

## Deploy
Any process manager works; the server is one Node process with no dependencies. Put it behind a reverse
proxy that forwards WebSocket upgrades - `nginx-location.conf` is the block we use (port 3100, path `/bullscows`).

Env: `PORT` (3100) · `HOST` (127.0.0.1) · `BASE` (/bullscows) · `TURN_MS` (75000).

## Protocol (JSON over WS)
client → server: create{name} · join{code,name} · rejoin{code,token} · secret{secret}
· start · guess{target,guess} · restart · kick{id} · leave · ping
server → client: joined{code,token,id} · state{room} · error{msg} · rejoin_failed
· kicked · left · pong
