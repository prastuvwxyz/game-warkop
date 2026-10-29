# game-warkop

Small browser games made for fun — the kind you open on your phone while waiting for coffee at the warkop.
Game-game kecil buat iseng, main langsung di browser.

| Game | What it is | Play | Stack |
|---|---|---|---|
| [Flappy](flappy/) | One-tap flyer with a rank ladder, skins and a fair pipe generator | [play](https://nalar.prastya.net/flappy/) | single static HTML file |
| [Bulls & Cows](bulls-cows/) | Guess-the-number, 2–6 players per room, last one uncracked wins | [play](https://nalar.prastya.net/bullscows/) | Node server + WebSocket |
| [Tinju Kata](tinju-kata/) | 1v1 typing-boxing: type the word first, throw the punch | [play](https://nalar.prastya.net/tinju/) | Node server + WebSocket |

Every game is dependency-free: plain HTML/CSS/JS on the client, Node ≥ 20 standard library on the server,
no build step, no external assets. Tests use Playwright (`npm i playwright`) and Node's built-in WebSocket (Node ≥ 22).

## Run one locally

    # static
    npx serve flappy            # or just open flappy/index.html

    # multiplayer
    cd tinju-kata && PORT=3200 node server.js     # http://127.0.0.1:3200/tinju/
    cd bulls-cows && PORT=3100 node server.js     # http://127.0.0.1:3100/bullscows/

Each game folder has its own README with protocol, config and tests.

## How they were made

Designed and built by an AI agent team running on Nalar — a product spec, an RFC,
a build, and a test plan with a go/no-go gate per game — with a human picking what to make and saying "ship it".

## License

MIT
