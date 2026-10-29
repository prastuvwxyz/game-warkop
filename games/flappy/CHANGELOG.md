# Flappy — changelog

## 3.0.1 — 2026-10-28
- Clouds no longer cut at the tile seam (each puff drawn at x−420 / x / x+420, clamped from the top).
- 2026-10-29: moved into `games/flappy/` (style, core, bot and shell split into `src/`) — byte-identical
  to the 3.0.1 that was live (`node tools/inline.mjs games/flappy` rebuilds it, md5 `2b49c3e9…`).

## 3.0.0 — 2026-10-28
- Rank ladder (14 ranks), 11 skins, a fair pipe generator with a reachability check, new pipe family.
- Best score and mute kept from v2 (`flappy_best`, `flappy_mute`); new `flappy_skin`, `flappy_skins_seen`, `flappy_ranks_seen`.

## 2.x
- Single-file canvas game: tap to fly, pipes, best score.
