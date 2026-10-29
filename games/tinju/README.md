# Tinju Kata 2.0 — lyric-typing boxing royale

Live: https://nalar.prastya.net/tinju/   ·   Tier: Big — a v2 rewrite: the room goes from 2 to 2–10 players, the
WebSocket protocol changes (`result` becomes a chain of hits, `state` carries N players, spectators and emoji are
new), `MAX_PLAYERS` and `resolve()` in `server/server.js` are rewritten. Jiwoo writes `DESIGN.md`; A-na writes the
test plan. Pras's "coba dulu deh" (2026-10-30 00:13) is the go to build, not to deploy.

Version 2.0.0 (major: the 1.x protocol is incompatible). This brief replaces the 1.1 restyle brief on branch
`tinju/1.1-look`: 1.1's Must haves (SVG boxers, hit sounds with body, B1, B3) are inside 2.0, so 1.1 is parked,
not built.

## The game in one breath
Up to ten friends in one ring see the same line of a song everyone knows, and all type it at once. When the line is
done, the punches fall like dominoes down the finishing order — first hits second, second hits third — until one
boxer is left standing.

## The core loop
1. 3-2-1 countdown (strategy-free: nothing to choose, hands on the keyboard).
2. One lyric line appears on every phone at the same moment. Everyone types it; strict typos (a wrong letter goes
   red, backspace to continue).
3. When everyone has finished, or 20 s have passed, the domino plays: avatars line up in finishing order and the
   hits ripple left to right, ~0.15 s per link. 1st hits 2nd, 2nd hits 3rd, …; the last one only takes it. The two
   big boxers in the ring are *who hit you* (left) and *who you hit* (right) — unknown while typing.
4. Damage per link is the 1.0 formula with the per-character base retuned for lines (see Rules). Song title and
   artist show for 1 s after the domino.
5. HP 0 → KO → spectator in the same room (can throw emoji). Last standing wins → Rematch, same room, same players.

## Feel
Pras's words: "siapa yang duluan", "auto hit siapa ke siapa", "lagu 90an 2000an dan yang viral di TikTok", "ada
character dan animasi pukul". Fast, no choices during a match, a KO you can feel, and the shared "aaah" when the
whole ring recognises the song.

## Rules (what Jiwoo must not change without asking)
- **Finishing order decides who hits whom.** Order by `elapsed` (own typing time, as in 1.0 — never packet arrival);
  equal → fewer typos → tie, no hit between the two. A player who has not finished at the 20 s cap finishes last
  with `d = ∞` and takes a clean hit; several unfinished players take hits from the last finisher only (no hit among
  the unfinished — nothing to order them by).
- **Damage per link = 1.0's function** with the base retuned: `min(CAP, round(len × BASE_PER_CHAR × margin ×
  critical × combo × ulti))`, margin 0.5 / 1 / 1.25 for `d ≤ 400 ms / ≤ 1000 ms / later`, critical ×1.5 (0 typos
  and ≥ 5 chars/s), combo ×1.25 (one round after 3 wins in a row — "win" = you hit someone), ULTI ×2.5, `CAP 60`.
  `BASE_PER_CHAR` starts at **1** (lines are 15–40 chars → base 15–40); Wasawho tunes it so a 2-player match
  lasts 40–60 s and a 10-player match 2–4 min, and records the number in `CHANGELOG.md`.
- **Received damage per round is capped at 60** — nobody is KO'd from 100 in a single round. (Only relevant if a
  future mode lets one player be hit twice in a round; in pure domino everyone takes at most one hit.)
- **2 players is 1.0 again** — 1st hits 2nd with their own `d`. This is a claim to prove, not a fact: A-na re-runs the
  damage oracle (28 rows) on the new `resolve()` with 2 players and the oracle must match.
- **Lines, not words.** Early rounds show the line lowercase with no punctuation; from round 4 on, the line's own
  punctuation and capitals are used. **ULTI = the line exactly as written** (capitals, commas, `!`, `?`, digits),
  every 4–6 rounds as in 1.0, ×2.5, screen shake on the hit. No separate ULTI bank.
- Option (b) — the last finisher takes an extra hit from the first — is **off** in 2.0 (`EXTRA_LAST_HIT=0`,
  present as a config flag so a playtest can switch it on without a release).

## Art direction
Card **C — 15 Angkasa lofi** (default — asked Pras; A/B/C thumbnails are in `art/thumbs/`, he may still switch before the
go request, and a switch changes only `src/theme.css` tokens + the SVG set).
- Mood in 3 words: melayang, tenang, lalu BUK
- Palette: background `#14122b` · surface `#221f45` · ink `#e6e3ff` · accent `#9d8cff` · highlight `#ffd28a` ·
  danger `#ff6b8a` (hit flash, HP low)
- Shape language: round planets, dotted orbits, grain over everything; round astronaut boxers with dark visors
  (x-x eyes when hit)
- Type: light rounded sans system stack (`ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif`), the lyric
  line in the same face at 20–22 px; body = system
- Motion: slow drift (ease-out, 400–600 ms) for everything *except* the punch — the punch is snappy (≤ 120 ms, no
  overshoot) then the victim drifts and settles. The domino is the one place both meet: snap, drift, snap, drift.
- Sound: soft detuned pads under the lobby; the four hit sounds (jab, block, uppercut, KO) **with body** — each
  layered (impact click + low thump + short tail), synthesised, distinguishable with eyes closed. Round bell, win/lose
  and taps stay.
- Signature moment: the domino — the ring goes quiet, avatars slide into finishing order, then bak-bak-bak down the
  line and the last one floats off on an orbit.
- Different from: Flappy (bright sky `#4ec0ca`, chunky pipes, canvas) · Bulls & Cows (sage pastel `#eef3ec`/`#3d9668`,
  round & soft cards, system sans) · Tinju 1.0 (the same sage pastel, blob canvas boxers). 2.0 is the first dark game
  and the first with a display type that is not plain system sans.

## Must have in v1 (2.0.0)
- 2–10 players in one room (create / join by 5-char code / rejoin by token, as 1.0), everyone types the same
  lyric line at once, domino resolution per the Rules, KO → spectator with emoji, last standing wins, rematch.
- Lyric bank `server/lyrics.txt` (plain text: one song per block, `title | artist` then its lines) loaded at boot
  and on `SIGHUP` — new songs without a code release. Validated at boot like `words.js` is today (line length
  15–45 chars, ≥ 40 songs, ≥ 200 lines).
- The look from the card: SVG astronaut boxers (`assets/img/`, one set per skin × 7 poses: idle, jab, uppercut,
  block, ouch, ko, win), the small-avatar row (up to 9 others + HP bars) above the ring, the lyric box, lobby and
  result screens — all from `src/theme.css` tokens.
- Hit sounds with body (above); the domino animation; title + artist card after each round.
- B1 and B3 from the 1.0 gate: at 320×480 the whole line (two rows) is inside the viewport for every player during
  the round; the line is never revealed before the countdown's `endsAt` (200/200 rounds in the proto test).

## Not in v1
- Picking a target (the 2026-10-29 23:47 idea) — Pras: "kalau milih repot". Teams. Option (b) switched on.
- Host pastes their own lyrics — 2.1, the bank must prove itself first.
- Leaderboards, ranks, skin unlocks, anything saved across devices.
- B2 (44 px touch targets) — waived 2026-10-29; the 34 px buttons stay.
- The ☾ light/dark toggle — one look; `tk_theme` is ignored, not deleted.
- Music rewrite beyond the lobby pad.

## Controls
Phone: on-screen keyboard, tap the line to focus (focus is kept across rounds — no re-tap)   ·   Desktop: keyboard;
Enter = ready / rematch; spectators: tap an emoji.

## Saved on the device
`tk_name` · `tk_sess` · `tk_snd` · `tk_skin` — unchanged, an old `tk_skin` index still maps to a skin.
`tk_theme` ignored. New: none.

## Content
`server/lyrics.txt`: ~50 songs, 4–6 lines each, the opening line or the hook — the line everyone can finish from
memory. Mix: Indonesian pop 90s (Dewa 19, Sheila on 7, Padi, Slank…), 2000s (Peterpan, Ungu, Nidji, Letto…), and
lines viral on TikTok now; plus lagu wajib and lagu daerah. Wasawho drafts it during the build; Stella reads it for
tone, Pras reads it before the go request. Copyright: Pras's call 2026-10-29 23:47 — private box, friends only,
not sold; the bank ships.

## Risks
- **Autocorrect and keyboard prediction on phones** — a sentence is far more exposed than a single word. Must be
  tried on a real iPhone and a real Android before go (1.0's M-01–M-05 were never run); the input must set
  `autocapitalize=off autocorrect=off spellcheck=false inputmode=text` and the strict-typo rule must survive
  a predictive keyboard inserting a trailing space.
- **Everyone KOs together** — in pure domino every player but the first takes a hit each round; with base ≈ 1/char
  the middle of the pack may hit 0 within 3–5 rounds at once instead of one by one. Wasawho simulates 10 bots at
  realistic speeds (3–8 chars/s) before drawing anything; if KOs cluster, tune base down or flip `EXTRA_LAST_HIT`
  on and report which.
- **10 animated SVG boxers on an iPhone 12** — the ring shows only two big ones; the avatar row is static images.
  Measured with the look-at-it run before all skins are drawn.
- **Recognition over difficulty** — a line nobody knows is just a typing test. The bank is the game; a bad bank
  sinks it regardless of code.

## How to run
    PORT=3301 node games/tinju/server/server.js     # http://127.0.0.1:3301/tinju/
    node --test "games/tinju/tests/**/*.test.mjs"   # proto + ui + audio on free ports ≥ 3300

## Code (as of 1.0.0 — 2.0 rewrites the marked parts)
`server/server.js` round engine, damage, `CFG` (Node ≥ 20, zero deps; `TK_<KEY>` env overrides for tests) —
**rewrite** `MAX_PLAYERS`, `resolve()`, room state for N players · `server/words.js` → **replaced by**
`server/lyrics.txt` + loader · `index.html` + `src/style.css` + `src/game.js` the client, test hook `window.__tinju` —
**rewrite** for N players, SVG boxers, `src/theme.css` · `tests/test-proto.mjs`, `test-ui.mjs`, `test-audio.mjs`,
`tests/e2e/look.mjs` — updated with the protocol; the 1.0 damage oracle re-run on 2 players.
Deploy: skill `game-ship` (`/var/www/warkop/tinju/`, user unit on port 3200, `/etc/nginx/apps.d/tinju.conf`).

## Protocol — 2.0 is defined in `DESIGN.md` (Jiwoo). 1.0 for reference:
client → server: `create{name,skin}` · `join{code,name,skin}` · `rejoin{code,token}` · `skin{skin}` · `start` ·
`done{round,elapsed,typos}` · `rematch` · `leave` · `ping`
server → client: `joined{code,token,id}` · `state{room}` · `countdown{round,ms,endsAt,serverTime}` ·
`word{round,text,ulti,ultiIn,revealAt,capMs}` · `result{round,winner,tier,damage,margin,critical,combo,ulti,hp,elapsed,fire}` ·
`end{winner,reason,hp}` · `error{msg,code?}` · `rejoin_failed` · `left` · `pong`
