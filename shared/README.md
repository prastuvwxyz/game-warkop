# shared

Mechanics used by two or more games (loop, seeded RNG, input, audio unlock, storage, WebSocket).
No colours or fonts — each game owns its look. Each game reaches this folder through its
`games/<slug>/shared` symlink, and every release carries a frozen copy (skill `game-ship`).

| Module | What | Used by |
|---|---|---|
| `server/ws.js` | minimal WebSocket (RFC 6455): `send`, `sendClose`, `upgrade(req, socket, head, path, { handle, fail, onDisconnect, log })` | bullscows, tinju |
| `server/static.js` | `createHttpServer({ base, root, health })`: 301 to `<base>/`, `/health`, the client files (`index.html`, `src/`, `assets/`, `shared/` minus `shared/server/`) | bullscows, tinju |

A change here reaches a game only when that game is re-released — re-run every user's tests first.
