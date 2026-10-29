# game-warkop

Small browser games made for fun — the kind you open on your phone while waiting for coffee at the warkop.
Game-game kecil buat iseng, main langsung di browser.

| Game | What it is | Play | Stack |
|---|---|---|---|
| [Flappy](games/flappy/) | One-tap flyer with a rank ladder, skins and a fair pipe generator | [play](https://nalar.prastya.net/flappy/) | single static HTML file |
| [Bulls & Cows](games/bullscows/) | Guess-the-number, 2–6 players per room, last one uncracked wins | [play](https://nalar.prastya.net/bullscows/) | Node server + WebSocket |
| [Tinju Kata](games/tinju/) | 1v1 typing-boxing: type the word first, throw the punch | [play](https://nalar.prastya.net/tinju/) | Node server + WebSocket |

Every game is dependency-free: plain HTML/CSS/JS on the client, Node ≥ 20 standard library on the server,
no build step, no external assets. Tests use Playwright (`npm i playwright`) and Node's built-in WebSocket (Node ≥ 22).

## Run one locally

    npm install                 # Playwright, for tests only
    node tools/serve.mjs        # http://127.0.0.1:8080/flappy/ — same paths as production
    npm test                    # every game's tests

    # multiplayer: the game's own server serves the client and the WebSocket
    PORT=3301 node games/tinju/server/server.js       # http://127.0.0.1:3301/tinju/
    PORT=3302 node games/bullscows/server/server.js   # http://127.0.0.1:3302/bullscows/

Each game folder has its own README with protocol, config and tests.

## How they were made

Designed and built by an AI agent team running on Nalar — a product spec, an RFC,
a build, and a test plan with a go/no-go gate per game — with a human picking what to make and saying "ship it".

## License

MIT
