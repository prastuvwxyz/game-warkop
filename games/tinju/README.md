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
- **The slower you finish, the harder you are hit** (added 2026-10-30 00:40, default — asked Pras): each link's
  damage is multiplied by the victim's rank weight `k / (n − 1)` — `k` = the victim's finishing rank counted from 1
  (the second finisher is 1), `n` = entrants of the round. The last finisher takes the full hit, the second finisher
  takes `1/(n−1)` of it; with 2 players the weight is 1, so 1.0 is untouched. Why: in pure domino every player but
  the first takes a same-sized hit each round, so the whole pack reaches 0 HP together (Jiwoo's and A-na's bot
  models: ≥ 5 KOs in one round in 65 % of 10-player matches at base 1; Stella's rerun of A-na's model with this
  weight: 0.6 %, match median 142 s at base 1 / 186 s at base 0.7, 2-player unchanged at 42 s —
  `~/.nalar/workspaces/stella/tinju2-sim/sim-rank.mjs`). Config `RANK_WEIGHT=1` (0 = pure domino, kept for
  playtests). `BASE_PER_CHAR` starts at **0.7** with this weight on.
- **Ties** (confirming Jiwoo's DESIGN.md): players with equal `elapsed` and `typos` share a rank; no hit inside the
  group; the group is hit by the rank above and hits the rank below through its lowest seat. A player who hits
  nobody in a round (tied, last, or unfinished) has their streak reset.
- **ULTI lines are the long ones.** Every bank line is 15–45 chars; normal rounds draw from lines < 30 chars,
  ULTI rounds from lines ≥ 30 chars, verbatim. So from round 4 a normal line and an ULTI line differ in length and
  in ×2.5, not only in the shake.
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
  15–45 chars ASCII, ≥ 40 songs, ≥ 150 lines < 30 chars, ≥ 40 lines ≥ 30 chars).
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
- **Everyone KOs together** — confirmed in two bot models for pure domino (see Rules); the rank weight is the
  answer on paper only. Wasawho runs the 10-bot simulation (3–8 chars/s, N = 2/5/10) on the real `resolveRound()`
  with `RANK_WEIGHT=1` before drawing anything and reports A-na's K-1…K-5 numbers; if K-1 still fails, stop and
  report, do not tune blindly.
- **One AFK player holds the ring for 20 s a round** (Jiwoo) — accepted for 2.0.0; the playtest logs per-round
  duration and 2.0.1 decides on an early cap.
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

---

# Tinju Kata 2.1 — final standings (change brief, 2026-10-30)

Live: https://nalar.prastya.net/tinju/ (2.0.0)   ·   Tier: **Multiplayer** — the `end` message gains a `standings`
field and the server must remember *when* each player went out (`outRound`), so the WebSocket protocol changes
(additively) and Jiwoo adds the rule to `DESIGN.md` before Wasawho builds. Version **2.1.0** (minor: new feature,
protocol 2 stays compatible — a 2.0 client ignores the new field). Branch `tinju/2.1-ranking`.

Pras, 2026-10-30 15:38: "tambahkan ranking juga — kalau yang main, siapa yang urutan 1–10".

## The change in one breath
When the match ends, every player sees the full table: who finished 1st to 10th, with how they went out. Today the
end card only names the winner and shows the last KO in the ring; eight other people learn nothing about where they
placed.

## Rules (Jiwoo writes them into DESIGN.md; do not change without asking)
- **Place = reverse order of leaving the ring.** The winner is 1st. Among the KO'd, the later the KO round, the
  higher the place.
- **Same round, several KOs:** the one who finished typing *earlier* in that round places higher (their `rank` in
  that round's `order`). Equal rank (a tie in that round) → shared place; the next place skips (1, 2, 2, 4).
- **Walkover (left or offline > 20 s) counts as going out in that round**, placed *below* anyone KO'd in the same
  round. Leaving is a forfeit, not a result.
- **`reason: 'bank'`** (lyrics ran out): the alive players are placed first, by HP descending; equal HP → shared
  place. KO'd players follow by the rule above.
- **Match cancelled by walkover with one player left:** that player is 1st, the rest by the rule above. The card
  still says "Pertandingan dibatalkan".
- The server computes the table; the client only draws it. A player who rejoins an ended room receives the same
  table (it rides on `state` for `ended`, as `winnerId` does today).

## Must have in 2.1.0
- Server: per player `outRound` (round of KO or walkover, `null` while alive) and `outRank` (their `order.rank` in
  that round), set where `p.out` is set today (`server.js` ≈ line 188 and `onWalkover`). `end` and the `ended`
  `state` carry `standings: [{id, place, hp, out: null|'ko'|'walkover', round}]`, sorted by place.
- End card: the standings list under the title, one row per player — place, skin avatar, name, and the fate: `HP 37`
  for a survivor, `KO ronde 5`, `keluar ronde 3`. Your own row is highlighted. 10 rows fit on an iPhone 12 and at
  320×480 without covering the Rematch button (scroll inside the card if it must, never the page).
- Rule tests for every bullet above (incl. a 3-way tie in one round and a walkover in the same round as a KO);
  proto test that `end.standings` and the rejoin `state` agree; look-at-it run at 320×480 and iPhone 12 with 10
  players on the end screen.
- `CHANGELOG.md` 2.1.0 entry; `tinju-version` meta = 2.1.0.

## Not in 2.1
- A live standings panel during the match — the avatar row already shows HP and per-round finishing rank.
- A win tally across rematches in the same room ("Dewi 3 — Bima 1") — asked Pras below; if yes, it is 2.2 and
  lives in room memory only (nothing saved across devices).
- Stats per player (chars/s, typos, hits landed) — later, if the table alone is not enough.
- Any change to damage, domino, rank weight, the look, the lyric bank.

## Controls / Saved on the device / Content
Unchanged. New localStorage keys: none.

## Risks
- Ten rows + two big boxers + Rematch on a 320×480 screen is tight — the gate is the look-at-it screenshot, not a
  guess. If it does not fit, the ring shrinks on the end screen, the list never does.
- "Who went out in the same round places by finishing rank" is a Stella default, not a Pras ruling; cheap to change
  (one comparator) if the playtest finds it unfair.

## How to run
    node tools/serve.mjs            # http://127.0.0.1:8080/tinju/   (server: PORT=3300 node games/tinju/server/server.js)
