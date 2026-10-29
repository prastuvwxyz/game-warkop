# Tinju Kata 2.0 — design   ·   Tier: Big — set by Stella (v2 rewrite, protocol 2.x incompatible with 1.x); kept

Brief: `README.md` (c16b253). Its "Rules" are reproduced here, not changed; everything I could not settle without
changing one is in Open risks. Keywords MUST/SHOULD/MAY as in RFC 2119. Code refs are to 1.0 `server/server.js`.

## Authority
The **server decides every outcome**: who is in the round, finishing order, every hit and its damage, HP, KO, ULTI,
the line text and every timer. The client sends inputs (`done{elapsed,typos}` is a client claim, as in 1.0 — trusted,
friends only) and draws. `resolve()` becomes a **pure function** `resolveRound(entrants, dones, line, cfg) →
{order, chain, hp, streak, fire}` with no I/O, so the rule tests call it directly.

## State
Server, per room:
| Field | Meaning · who changes it |
|---|---|
| `code, hostId, state, round, timer, phaseEndsAt` | as 1.0. `state` ∈ lobby · countdown · line · result · paused · ended (1.0's `resolving` is gone: there is no grace, the round ends when every online entrant is done or the cap fires) |
| `players: Map` (≤ 10) | `id, token, name, skin, ws, online, offlineSince, hp, streak, fire, out: null\|'ko'\|'walkover'\|'sat', lockedRound, rematch, seat` |
| `entrants: Set<id>` | fixed at reveal: alive (`out===null`) **and online**. Offline at reveal = sits this round out, no hit given or taken |
| `dones: Map<id,{elapsed,typos}>` | this round's valid `done`s |
| `seed, matchNo, rng, bank, bag, ultiAt, line` | randomness (see Time and fairness). `bank` = the lyric snapshot the match started with |
| `lastResult` | the last `result`, re-sent to a rejoiner during `result` |
Client: everything is for drawing only — `S` from `state`, the two big boxers (left = `from` of my incoming link,
right = `to` of my outgoing link), the domino playback queue, the typed buffer.

**Line forms.** `plain` (rounds 1–3) = lowercase, only `[a-z0-9 ]`, spaces collapsed. `full` (round ≥ 4, and every
ULTI) = the line verbatim. `lyrics.txt`: blocks separated by a blank line, first line `title | artist`, then lines.
Boot validation (exit 1 on failure, like `validateWords()` lines 34–53): ≥ 40 songs, ≥ 200 lines, printable ASCII
only (`[\x20-\x7e]`, no curly quotes), no leading/trailing/double spaces, both `plain` and `full` forms 15–45 chars,
no duplicate line. `SIGHUP`: reload + validate; invalid → keep the old bank and log; running matches keep their snapshot.

**Domino, as `resolveRound()` computes it.**
1. Sort entrants with a `done` by (`elapsed`, `typos`). Equal on both = one **rank** (tie, no hit inside a rank).
   Entrants with no `done` = the last rank, `elapsed:null` (`d = ∞`).
2. Rank k's hitter = its lowest `seat` (join order); it hits **every** member of rank k+1. Unfinished players are
   hit by the last *finished* rank's hitter only. Nobody finished → no hits (Seri).
3. Damage per link = 1.0 lines 194–199 unchanged: `d = to.elapsed − from.elapsed`; margin 0.5/1/1.25 at
   `d ≤ 400 / ≤ 1000 / later`; critical = `from.typos==0 && len*1000 ≥ CRIT_CPS*from.elapsed`; combo = `from.fire`;
   `min(CAP, round(len·BASE_PER_CHAR·margin·crit·combo·ulti))`, `len` = length of the form shown.
3b. **Rank weight** (brief 2026-10-30, Stella): `damage` is multiplied by the victim's weight `k/(n−1)` — `k` = the victim's competition rank − 1 (second finisher = 1; tied victims take the rank of their first seat), `n` = entrants; unfinished victims and 2-player rounds weigh 1; `RANK_WEIGHT=0` is pure domino. Applied after the per-link cap: `scaled = min(CAP, round(damage·weight))`. `BASE_PER_CHAR` default 0.7 (final value in CHANGELOG).
4. `applied = min(scaled, RECV_CAP − receivedThisRound[to])`; `hp = max(0, hp − applied)`.
5. `EXTRA_LAST_HIT=1` only: rank 1's hitter also hits every member of the last rank (link `extra:true`), when there
   are ≥ 3 ranks. Default **0**.
6. Streak/fire (1.0 lines 202–204, "win" = dealt ≥ 1 hit): hitters as 1.0's winner (all its links use the same
   pre-round `fire`); entrants who dealt none and took one as 1.0's loser; tied non-hitters unchanged (a 1.0 draw).
7. After `result`: hp 0 → `out:'ko'` (spectator). ≤ 1 alive → `end{reason:'ko'}`.

`CFG_DEFAULTS` (1.0 lines 19–21) changes: `BASE_PER_CHAR: 1`, `CAP: 60`, new `RECV_CAP: 60, EXTRA_LAST_HIT: 0,
LINE_MIN: 15, LINE_MAX: 45, CAP_SLACK_MS: 1000, LINK_MS: 150, TITLE_MS: 1000, PLAIN_ROUNDS: 3, MAX_PLAYERS: 10`;
`GRACE_MS` removed. All overridable by `TK_<KEY>` as today; plus `TK_SEED`, `TK_LYRICS` (bank path) for tests.

## Messages   (JSON over WebSocket at `/tinju/ws`)
Every message has `t`. **Unknown `t` is ignored** (1.0 line 342 answers an error — change it). Rate: ws.js 20 msg/s.
client → server:
| `t` | Fields | When |
|---|---|---|
| `create` | `name:str≤16, skin:int, v:2` | Buat Room. Missing `v:2` → `error{code:'old_client'}` (a 1.x tab: "muat ulang") |
| `join` | `code:str5, name, skin, v:2` | state lobby or ended, < 10 players |
| `rejoin` | `code, token:hex32, v:2` | every WS open while `tk_sess` exists |
| `skin` | `skin:int 0..SKIN_COUNT−1` | lobby/ended. Duplicates allowed (10 players, 4 skins) |
| `start` | — | host; lobby or ended; ≥ 2 players (ended: ≥ 2 voted) online |
| `done` | `round:int, elapsed:ms, typos:int` | once per round on correct completion; 1.0 guards (line 167–170) + `error{code:'spectator'}` if not an entrant |
| `rematch` | — | ended: "I'm in" vote |
| `emoji` | `e:int 0..7` | sender `out≠null`, or state lobby/ended. Server drops > 2/s per player silently |
| `leave` · `ping` | — | as 1.0 |
server → client:
| `t` | Fields | When |
|---|---|---|
| `joined` | `code, token, id, v:2` | after create/join/rejoin |
| `state` | `room:{code, state, hostId, round, you:{id}, players:[{id,name,skin,online,isHost,hp,streak,fire,out,rematch}], phaseEndsAt, ultiIn, winnerId, endReason, serverTime, cfg}` | on any membership/online/phase change. MUST NOT contain line text |
| `countdown` | `round, ms, endsAt, serverTime` | entering countdown; re-sent to a rejoiner |
| `line` | `round, text, form:'plain'\|'full', ulti:bool, ultiIn, entrant:bool, revealAt, endsAt, serverTime` | at countdown `endsAt` to all sockets in one tick (spectators get `entrant:false`) |
| `progress` | `round, finished:int, of:int` | after each valid `done` — a count only; who finished stays hidden (order is by `elapsed`, not arrival) |
| `result` | `round, order:[{id,rank,elapsed\|null,typos\|null}], chain:[{from,to,tier,d\|null,margin,critical,combo,ulti,damage,applied,extra}], sat:[id], hp:{id:int}, fire:{id:bool}, ko:[id], song:{title,artist}, endsAt, serverTime` | after resolve; `endsAt = now + RESULT_MS + LINK_MS·chain.length + TITLE_MS` |
| `emoji` | `from:id, e:int` | relayed to the room |
| `end` | `winner:id\|null, reason:'ko'\|'walkover'\|'bank', hp:{id:int}` | match over |
| `error` | `msg, code?:'stale'\|'dup'\|'bad_elapsed'\|'bad_typos'\|'spectator'\|'old_client'` | rejection; client toasts none for stale/dup |
| `rejoin_failed` · `left` · `pong{serverTime}` | as 1.0 | |
Removed from 1.x: `word` (→ `line`), `result.winner/tier/damage/margin` (→ `chain`), `elapsed` map (→ `order`).

## Time and fairness
- Server clock only. Every phase message carries `endsAt` + `serverTime`; client offset = `serverTime − Date.now()`.
- **B3 MUST:** `line` is never sent before countdown `endsAt`. The countdown callback MUST re-arm for the remainder
  when `Date.now() < phaseEndsAt` (setTimeout can fire 1 ms early — the 1.0 gate saw `revealAt` 1 ms early in 1/50
  rounds) and set `revealAt = max(now, endsAt)`. Test: proto, 200 rounds, 3 players: `line.revealAt ≥ countdown.endsAt`
  200/200, and no `line` frame arrives while `room.state` is countdown.
- Round closes when every **online** entrant has a valid `done`, or at `revealAt + WORD_CAP_MS + CAP_SLACK_MS`
  (`elapsed` itself must stay ≤ `WORD_CAP_MS`; the slack lets a 19.9 s finisher's packet land).
- Ties: `elapsed` → `typos` → same rank, no hit. Arrival order never decides.
- Randomness: `room.seed` (crypto at create, or `TK_SEED`); `rng = mulberry32(seed + matchNo)` drives the line bag
  shuffle (no line repeats in a match) and ULTI scheduling (first at round 4–6, then every 4–6, as 1.0 line 217). **Lyric pick (brief 2026-10-30, Stella):** normal rounds draw lines whose shown form is < 30 chars; an ULTI round draws a line ≥ 30 chars, verbatim — two bags, each shuffled by `rng`, no repeats in a match.
  Same seed + bank + `done` sequence → same lines, ULTIs, chain. `crypto` stays for codes and tokens only.

## Disconnect and rejoin
- Offline during the line (an entrant): the round does not wait for them; no `done` = unfinished → takes the last
  finisher's hit. Dropping wifi never escapes a hit (1.0's reason, kept).
- Offline at reveal: in `sat`, no hit either way. Others see "offline" on the avatar.
- Offline `WALKOVER_MS` (20 s) in a match → `out:'walkover'`, a spectator with HP frozen; the match goes on while ≥ 2
  are alive, else `end{reason:'walkover'}`. `paused` only when < 2 alive players are online at countdown expiry.
- Rejoin by token (as 1.0 lines 293–308): during countdown → `countdown` re-sent; during `line` → `lockedRound=round`,
  the line is NOT re-sent (it would restart their clock), stays an entrant if they were one; during `result` →
  `lastResult` re-sent; in `ended` → normal.
- Rematch: auto-starts when every online player voted (≥ 2); the host may `start` earlier with ≥ 2 votes —
  non-voters stay as `out:'sat'`. Offline 60 s in lobby/ended → removed (1.0 line 256).

## Shared code
`shared/server/ws.js` and `shared/server/static.js` unchanged. Nothing new in `shared/`: mulberry32 now exists in
Flappy (`games/flappy/src/core.js` line 19) and here, but Flappy's copy lives in its vm-tested core block — extract
to a shared module when Flappy is next released, not in this change. No game needs re-testing for this release.

## Persistence
`tk_name` (string) · `tk_sess` (`{code,token}`; `rejoin_failed` or a 1.x value without a 2.x room → cleared) ·
`tk_snd` (as 1.0) · `tk_skin` (int; NaN → 0, ≥ SKIN_COUNT → `% SKIN_COUNT`). `tk_theme` read by nobody, not deleted.
No new keys. Every read guarded (try/catch, default on a malformed value).

## Budget
10 players/room · `MAX_ROOMS` 100 (≤ 1000 sockets; 1.0 had 500×2) · inbound ≤ 20 msg/s/socket (ws.js) and emoji
≤ 2/s/player · outbound per round ≈ N×(countdown + line + ≤ N progress + result + ~3 state), `result` ≤ 3 KB at
N = 10 · 60 fps on iPhone 12: only the two big SVG boxers animate (CSS `transform`/`opacity`), the avatar row is
static `<img>` + HP bars, the domino toggles classes, typing touches only the tile row.

## Open risks
| Risk | How the build finds out early |
|---|---|
| **One `BASE_PER_CHAR` cannot hit both targets, and KOs cluster at any base.** My rough sim (`~/.nalar/workspaces/jiwoo/tinju2-proto/sim.js`, my assumptions, 200 matches): base 1 → 2p 43 s (in target), 10p 77 s (target 2–4 min) with ≥ 3 KOs in one round in 200/200; base 0.3 → 10p 196 s but 2p 102 s, still clustered 181/200. Pure domino hits everyone but the first each round, so the pack drains together. Fixing it touches a Rule (e.g. HP or base scaled by N, or hits only from rank 1–2) → **Pras decides** | Wasawho's 10-bot simulation at 3–8 chars/s against the real `resolveRound()` **before any art**; report match length and max KOs per round for N = 2, 5, 10 at base 1, and with `EXTRA_LAST_HIT=1` |
| Phone autocorrect / prediction on sentences (iOS curly `’`, auto-capital, trailing space after a predicted word) | Input `autocapitalize=off autocorrect=off spellcheck=false inputmode=text`; client maps `’‘` → `'` and drops a trailing space at the end of the line; the bank is ASCII-only. Real iPhone + real Android before the go request (1.0's M-01–M-05 never ran) |
| "2 players = 1.0" is a claim: A-na's oracle uses 4–14-char words at base 3; lines are 15–45 | Rule test runs O-01…O-29 through `resolveRound()` with 2 entrants and `BASE_PER_CHAR=3`; proto test runs them with `TK_BASE_PER_CHAR=3 TK_LINE_MIN=4 TK_LYRICS=<fixture>`. The plan has **29** rows (`tinju-test-plan.md` O-01–O-29), not 28 |
| Tie hitter rule (lowest seat) and "tied non-hitters keep their streak" are mine; the Rules are silent | Rule tests cover a 3-way tie; Stella/Pras confirm or change before the protocol test is written |
| Round ≥ 4 lines are verbatim, so ULTI shows the same text form — only ×2.5 and the shake differ | Stella: is that intended, or should ULTI pick harder lines (more punctuation)? Default: as written |
| Waiting for a slow typist: one AFK online player holds 9 others for 20 s each round | Playtest log of per-round duration; options (an early cap after the 2nd-to-last finishes) would change a Rule → ask |
| 10 SVG boxers on iPhone 12 | Only two animate; look-at-it run with 10 players before all skins are drawn |

## Handoff note for Wasawho
Branch `tinju/2.0-royale`. Brief `games/tinju/README.md`, this file. Tier Big. Build order, each with its test:
1. `resolveRound()` pure + `CFG` changes → rule tests: oracle O-01…O-29 on 2 entrants, ties, unfinished, caps.
2. 10-bot simulation (3–8 chars/s, N = 2/5/10) → numbers to Stella **before any art**; stop if KOs cluster.
3. `lyrics.txt` loader + validation + `SIGHUP` + seeded rng → boot-fail and replay tests.
4. Room engine + protocol above → protocol tests on ports ≥ 3300 (B3 200/200, rejoin, walkover, rematch, emoji).
5. Client + SVG look → UI/audio tests, look-at-it run at 320×480.
Done evidence: rule tests + protocol tests + a full 3-player match in three browsers through the real server + A-na's
test plan. No deploy.
