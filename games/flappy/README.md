# Flappy

Live: https://nalar.prastya.net/flappy/   ·   Tier: Jam — single-player, no server

## The game in one breath
Tap to keep the bird in the air and slip through the gaps. Each run climbs a rank ladder and unlocks skins.

## The core loop
1. Tap to flap. 2. Pass a gap → +1. 3. Hit anything → rank and best shown. 4. Tap to go again.

## Feel
Quick, bright, one more try.

## Art direction
- Mood: cerah, ringan, arcade
- Palette: sky teal `#4ec0ca`, grass green, pipe green, warm sand ground, white clouds; night backdrop `#12161f`
- Shape language: round & soft (cartoon bird, rounded pipes)
- Type: system stack
- Motion: snappy flap, smooth scroll
- Sound: synth blips (Web Audio)
- Signature moment: rank-up banner mid-run
- Different from: Bulls & Cows (pastel cards, turn-based) · Tinju Kata (bold red/blue boxers)

## Controls
Phone: tap · Desktop: Space / click · skin picker: ◀ ▶ or swipe on the menu

## Saved on the device
`flappy_best` · `flappy_mute` · `flappy_skin` · `flappy_skins_seen` · `flappy_ranks_seen`

## Code
`src/core.js` pure rules (no DOM — the test suite runs it in an empty VM) · `src/bot.js` lookahead bot
(`?bot=1`) · `src/game.js` canvas, input, audio, UI · `src/style.css`. Test hooks: `window.__flappy`, `?seed=<n>`.

## How to run
    node tools/serve.mjs            # http://127.0.0.1:8080/flappy/
    node --test games/flappy/tests/ # rules suite (+ browser gate when Playwright is installed)
