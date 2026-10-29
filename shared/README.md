# shared

Mechanics used by two or more games (loop, seeded RNG, input, audio unlock, storage, WebSocket).
No colours or fonts — each game owns its look. Each game reaches this folder through its
`games/<slug>/shared` symlink, and every release carries a frozen copy (skill `game-ship`).

Empty until the multiplayer games move in: Bulls & Cows and Tinju Kata share the WebSocket server.
