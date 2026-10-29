# Tinju Kata — 1v1 typing-boxing

Live: https://nalar.prastya.net/tinju/

Two players share a room. Each round one word shows on both screens at the same moment; whoever types it
correctly first throws the punch. HP 100, about 5-7 winning rounds, Rematch button. Every 4-6 rounds a rainbow
ULTI word (capitals + punctuation, x2.5 damage). Canvas-drawn cartoon boxers, no external assets.

Version: 1.0.0.

## Layout
- `server.js` - Node >= 20, zero dependencies. HTTP (`/`, `/health`) + a minimal RFC 6455 WebSocket on one port.
  Round engine, damage function and all tuning constants (`CFG`) live here. State is in memory.
- `words.js` - word bank (CommonJS): `normal` (4-9 lowercase letters) and `ulti` (8-14 chars, >= 1 uppercase, >= 1 of `- ! ? ,`).
  Validated at boot; the server exits 1 and names the failed rule if the bank is invalid.
- `public/index.html` - single-file client (no build step, no external assets). Meta `tinju-version`, test hook `window.__tinju`.
- `nginx-location.conf` - the nginx `location /tinju` block.
- `test-proto.mjs`, `test-ui.mjs`, `test-audio.mjs` - tests; `test-lib.mjs` is their shared helper (not needed in production).

## Run locally
    PORT=3201 node server.js            # http://127.0.0.1:3201/tinju/
    curl localhost:3201/tinju/health

Env: `PORT` (3200) · `HOST` (127.0.0.1) · `BASE` (/tinju) · `TK_<KEY>` overrides any `CFG` constant
(`TK_HP`, `TK_COUNTDOWN_MS`, `TK_GRACE_MS`, `TK_WORD_CAP_MS`, `TK_RESULT_MS`, `TK_WALKOVER_MS`, ...). The overrides exist for tests.

## Tests
`test-proto.mjs` needs Node >= 22 (global `WebSocket`). The other two use Playwright, resolved from
`./node_modules` (`npm i playwright`) or `PW_NODE_MODULES`. Each test file starts its own server(s) and stops them at the end:

    node test-proto.mjs 3201     # also uses 3202 (KO server) and 3203 (fixed word-order copy)
    node test-ui.mjs 3201        # desktop, iPhone 12, 320 px phone, reduced-motion; UI_ONLY=desktop,rm picks profiles
    node test-audio.mjs 3201

They refuse to run on 3100 / 3200. Output is `PASS ...` / `FAIL ...` lines and a final `PASS n / FAIL n`.

## Deploy
Any process manager works; the server is one Node process with no dependencies. Put it behind a reverse
proxy that forwards WebSocket upgrades - `nginx-location.conf` is the block we use (port 3200, path `/tinju`).

## Protocol (JSON over WS at `<BASE>/ws`)
client -> server: `create{name,skin}` · `join{code,name,skin}` · `rejoin{code,token}` · `skin{skin}` · `start` · `done{round,elapsed,typos}` · `rematch` · `leave` · `ping`

server -> client: `joined{code,token,id}` · `state{room}` · `countdown{round,ms,endsAt,serverTime}` · `word{round,text,ulti,ultiIn,revealAt,capMs}`
· `result{round,winner,tier,damage,margin,critical,combo,ulti,hp,elapsed,fire}` · `end{winner,reason,hp}` · `error{msg,code?}` · `rejoin_failed` · `left` · `pong`

Damage (winner only): `min(60, round(len*3 * margin * critical * combo * ulti))`. Margin is 0.5 / 1 / 1.25 when the loser
finishes within 400 ms / within 1000 ms / later or never. Critical x1.5 (0 typos and >= 5 chars/s), combo x1.25 (the round
after 3 straight wins), ulti x2.5. The winner is the smaller `elapsed`; equal elapsed goes to fewer typos, else a draw.
Arrival order never decides.

## Keys (localStorage)
`tk_name` · `tk_sess` · `tk_theme` · `tk_snd` · `tk_skin` (never `bc_*`).
