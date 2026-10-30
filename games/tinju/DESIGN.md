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
3b. **Rank weight** (brief 2026-10-30, Stella): `damage` is multiplied by the victim's weight `k/(n−1)` — `k` = the victim's competition rank − 1 (second finisher = 1; tied victims take the rank of their first seat), `n` = entrants; unfinished victims and 2-player rounds weigh 1; `RANK_WEIGHT=0` is pure domino. Applied after the per-link cap: `scaled = min(CAP, round(damage·weight))`. `BASE_PER_CHAR` default 0.6 (brief started at 0.7; see CHANGELOG and tests/evidence/sim-2.0.txt).
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

## Standings (2.1.0)   ·   Tier: Multiplayer (Stella) — `end` and `state` gain a field; protocol stays `v:2`, additive
Brief: `README.md` "# Tinju Kata 2.1 — final standings" (12493c6); its Rules are reproduced here, not changed. Damage,
domino, rank weight, look and lyric bank are untouched — `resolveRound()` and the rules suite's 90 checks stay as they are.

**Player state (server only, never sent raw).** Each field is set **once**, when `p.out` first changes from `null`; it is never overwritten (a KO'd player who then leaves stays `ko`).
| Field | Set where | Value |
|---|---|---|
| `outRound` | `closeRound()` where `p.out = 'ko'` (server.js:188) and `dropFromMatch()` (:229) | `room.round` at that moment. The `result` phase belongs to the round just resolved; countdown/paused already carry the next round (`afterResult` increments first) |
| `outRank` | same line as `p.out='ko'` | that player's `rank` in `res.order` (unfinished share `fin.length + 1`). `null` for walkover |
| `outAt` | `dropFromMatch()` | `Date.now()` when the walkover is decided (`leave` = at once, offline = after `WALKOVER_MS`), not when the socket dropped. Breaks same-round walkovers |
All three reset to `null` in `resetMatch()`, `backToLobby()` and on a join in `ended` (:286).

**Who is in the table:** every player with `out ∈ {null,'ko','walkover'}` when `endMatch()` runs — `out:'sat'` (did not vote the
rematch) and anyone who joins after the end are not. The table MUST be computed in `endMatch()` **before** the loop that deletes
`p.left` players (:216), so a player who left mid-match still has a row.

**Comparator** — pure `computeStandings(rows)` in `engine.js` (exported; rule tests call it directly). Row =
`{id, seat, alive, hp, kind:'ko'|'walkover'|null, outRound, outRank, outAt}`.
```
cmp(a, b):                                   // < 0 → a places higher; 0 → shared place
  if a.alive != b.alive   return a.alive ? -1 : 1          // survivors first (bank; ko/walkover have ≤ 1)
  if a.alive              return b.hp - a.hp                // bank: HP desc, equal HP = shared
  if a.outRound != b.outRound  return b.outRound - a.outRound   // reverse order of leaving the ring
  if a.kind != b.kind     return a.kind == 'ko' ? -1 : 1    // same round: walkover below every KO
  if a.kind == 'ko'       return a.outRank - b.outRank      // finished earlier that round places higher; equal rank = shared
  return b.outAt - a.outAt                                  // same-round walkovers: later leaver higher
place(r) = 1 + count(x : cmp(x, r) < 0)      // competition numbering 1, 2, 2, 4
rows sorted by (place, seat)                 // seat only for a stable draw order, never for place
```
| Ending | `winner` (2.0, unchanged) | Table |
|---|---|---|
| `ko`, one standing | the survivor | survivor 1st, then KO'd by the comparator |
| `ko`, last ones KO'd in the same round | `null` | shared 1st possible (equal `outRank`); client draws "Seri" from `winner:null` |
| `walkover`, one left (cancelled) | the one left | that player 1st; card still says "Pertandingan dibatalkan" |
| `bank` | top HP if unique, else `null` | alive by HP desc (equal = shared), then KO'd/walkover by the comparator |

**Messages** (amends the `end` and `state` rows above; a 2.0 client ignores the new field):
| `t` | New field | When |
|---|---|---|
| `end` | `standings:[{id, name, skin, place:int, hp:int, out:null\|'ko'\|'walkover', round:int\|null}]`, sorted by place | match over; also the `end` re-sent to a rejoiner in `ended` (:306) |
| `state` | `room.standings`: the same array when `state==='ended'`, else `null` | every `state` broadcast |
`name` and `skin` are added to the brief's row shape (additive): a player who left mid-match is deleted from `players` at the end,
so the client could not draw their row otherwise. `round` = `outRound`. Server stores the array once on `room.standings`; `end`,
the rejoin `end` and `state` all send that same array, so they cannot disagree. `room.standings = null` in `resetMatch()`/`backToLobby()`.

**Tests.** New rule cases on `computeStandings()` (test-rules): ST-1 KOs in rounds 2/5/7 → reverse order · ST-2 two KOs in one
round by `outRank` · ST-3 3-way tie in one round → 1, 2, 2, 2, 5 · ST-4 walkover and KO in the same round → walkover below ·
ST-5 two walkovers in one round → later leaver higher · ST-6 bank: HP 70/40/40 alive + KO'd → 1, 2, 2, 4 · ST-7 cancelled
by walkover, one left → 1st · ST-8 last two KO'd together with equal rank → shared 1st · ST-9 KO'd then leaves → stays `ko` ·
ST-10 unfinished KO'd in one round share a place · ST-11 `sat` excluded. New proto cases: SP-1 `end.standings` deep-equals a
rejoiner's `state.room.standings` and its re-sent `end` · SP-2 a player who `leave`s mid-match still has a row (name, skin) ·
SP-3 rematch → `state.room.standings === null` · SP-4 `reason:'bank'` end via a tiny bank (`TK_LYRICS` fixture +
`TK_MIN_SONGS`/`TK_MIN_LINES`).
**Re-run (they read `end`/`state` in `ended`):** test-proto S7 (KO → end, rematch P-20), S8 (host rematch with `sat`, leave,
room of 2 → lobby), S9 (walkover down to one → `end{walkover}`, rejoin in `ended`), S13 (lobby leave/removal), plus the whole
suite; test-rules 90/0 MUST stay 90/0 (proves damage untouched); test-ui end-screen checks and `tests/e2e/look.mjs`.

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
