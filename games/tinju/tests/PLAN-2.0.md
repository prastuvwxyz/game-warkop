# Tinju Kata 2.0.0 — Test Plan (DRAFT)

Date: 2026-10-30 · Author: A-na (QA) · Status: DRAFT. It's written from the brief alone; `DESIGN.md` doesn't exist yet (checked `git pull` on 2026-10-30, branch at `c16b253`).
Sources: `games/tinju/README.md` @ `c16b253` (the brief, "Rules" section is the oracle source) · 1.0 code `server/server.js` (`CFG_DEFAULTS` line 19, `resolve()` lines 179–207) · 1.0 suites in `tests/` · my 1.0 gate result (`stella/tinju-gate-result.md`, 2026-10-29: B1 and B3 found there).
Scope: server round engine (N players, domino), lyric bank, client for N players, audio, real phones, KO-clustering simulation. Out of scope: the art itself (looked at, not graded), deploy, nginx/systemd.
Tools I wrote for this plan (test-only, in `tests/plan-2.0/`): `oracle-2.0.mjs` (my implementation of the brief's Rules, not read from any agent's code), `rows-2.0.mjs` (prints every row below), `sim-ko.mjs` (the KO-clustering model in §5). `node tests/plan-2.0/rows-2.0.mjs` reproduces §1.

Tags: **Rules-n** = the n-th bullet of the brief's "Rules" section (1 finishing order · 2 damage · 3 received cap · 4 two players · 5 lines/ULTI · 6 option b) · **Must** = "Must have in v1" · **Risk** = brief "Risks" · **1.0-Fn** = 1.0 spec Fairness MUST n, carried over.

## 0. Assumptions this plan makes (DESIGN.md must confirm or overrule)

Every oracle number below depends on these. If DESIGN.md says otherwise, I recompute the affected rows; I don't bend the tests to fit the code.

| # | Assumption | Why I need it | Rows it affects |
|---|---|---|---|
| A1 | Link `d` = hitee's `elapsed` − hitter's `elapsed`; unfinished hitee → `d = ∞` → clean | Rules-1/2 say "the 1.0 formula", 1.0 uses loser − winner | all |
| A2 | `critical` is judged on the **hitter**: `typos == 0` and `len·1000 ≥ 5·elapsed` (integer compare, as 1.0 line 197) | 1.0 behaviour | all |
| A3 | `len` = length of the text **shown that round** (rounds 1–3: lowercased, punctuation removed; from 4: verbatim), spaces count | brief doesn't say which length | O-*, D-1, D-2, D-5 |
| C1 | Combo streak: a "win" = a round in which you dealt ≥ 1 hit. A round in which you dealt none (last finisher, unfinished, tie at the end, KO) resets streak and fire. Being hit does **not** reset it. Fire applies to the one round after the 3rd straight win, then streak = 0 (1.0 lines 201–203). A no-hit round (nobody finished) leaves streaks unchanged (1.0 draw rule) | brief: "win = you hit someone"; 1.0 reset the loser because a loser never hit | D-3, D-6, P-21 |
| T1 | Tie group (same `elapsed` and same `typos`): no hit inside the group; the single player before the group hits **every** member, each with their own `d` (mirrors "several unfinished take hits from the last finisher") | brief says only "tie, no hit between the two" | D-2 |
| T2 | **Open:** a tie group that is *not* last — who hits the next player? Both members (that player takes 2 hits, and the received cap matters) or one? | unanswerable from the brief | pending, §3 |
| X1 | `EXTRA_LAST_HIT=1`: the first finisher hits every last-group member once more, `d` = their elapsed − first's elapsed, no combo on the extra hit; then the received cap applies | brief Rules-6 names the flag only | D-7 |
| R1 | Received cap = `min(60, sum of the round's hits)` per player, applied after the per-link cap | Rules-3 | D-7 |
| G1 | Round resolves when every **alive, non-spectator** player has finished, or at 20 s. No 1.0-style 1.5 s grace window | core loop step 3 | P-04, P-10 |

## 1. Damage oracle — one link, `BASE_PER_CHAR = 1`

Formula (Rules-2): `damage = min(60, round(len × 1 × margin × crit × combo × ulti))`; margin 0.5 if `d ≤ 400`, 1 if `d ≤ 1000`, 1.25 otherwise or unfinished; crit ×1.5; combo ×1.25; ULTI ×2.5. `round` = JS `Math.round` (halves up; all multipliers are exact in binary, so x.5 always goes up).

How the 1.0 rows were carried over: a 1.0 word of `n` letters at base 3 has the same `len × base` as a line of `3n` characters at base 1. So each 1.0 row uses `len = 3n` and the winner's `elapsed × 3` (keeps the 5 chars/s edge exactly where it was); gaps `d` stay the same in ms. 26 of the 29 rows then give the **same damage as 1.0**; O-19, O-20 and O-29 can't (12 and 42 chars are outside 15–40) and are noted. The 1.0 plan had 29 rows (O-01…O-29); the brief says 28 — all 29 are here, plus 4 new 2.0 rows.

Each row is run as a 2-player round (also the proof for Rules-4, see P-02). "Lp" = the hit player.

| ID | 1.0 intent | len | Hitter ms / typos | Lp ms | d | Tier | Crit check | Arithmetic | **Dmg** | 1.0 |
|---|---|---|---|---|---|---|---|---|---|---|
| O-01 | spec ex. 1 | 18 | 3600 / 0 | 4800 | 1200 | clean | 18000 ≥ 18000 ✓ | 18×1.25×1.5 = 33.75 | **34** | 34 |
| O-02 | spec ex. 2 | 18 | 4500 / 1 | 4800 | 300 | block | typo ✗ | 18×0.5 = 9 | **9** | 9 |
| O-03 | spec ex. 3, ULTI | 30 | 6000 / 0 | – | ∞ | clean | 30000 ≥ 30000 ✓ | 30×1.25×1.5×2.5 = 140.625 → 141 | **60** cap | 60 |
| O-04 | gap 0, typo tie-break (Lp typos 2) | 18 | 6000 / 1 | 6000 | 0 | block | ✗ | 18×0.5 = 9 | **9** | 9 |
| O-05 | gap 390 | 18 | 6000 / 1 | 6390 | 390 | block | ✗ | 18×0.5 = 9 | **9** | 9 |
| O-06 | gap 399 | 18 | 6000 / 1 | 6399 | 399 | block | ✗ | 18×0.5 = 9 | **9** | 9 |
| O-07 | gap 400 (inclusive) | 18 | 6000 / 1 | 6400 | 400 | block | ✗ | 18×0.5 = 9 | **9** | 9 |
| O-08 | gap 401 | 18 | 6000 / 1 | 6401 | 401 | jab | ✗ | 18×1 = 18 | **18** | 18 |
| O-09 | gap 410 | 18 | 6000 / 1 | 6410 | 410 | jab | ✗ | 18×1 = 18 | **18** | 18 |
| O-10 | gap 999 | 18 | 6000 / 1 | 6999 | 999 | jab | ✗ | 18×1 = 18 | **18** | 18 |
| O-11 | gap 1000 (inclusive) | 18 | 6000 / 1 | 7000 | 1000 | jab | ✗ | 18×1 = 18 | **18** | 18 |
| O-12 | gap 1001 | 18 | 6000 / 1 | 7001 | 1001 | clean | ✗ | 18×1.25 = 22.5 | **23** | 23 |
| O-13 | gap 1010 | 18 | 6000 / 1 | 7010 | 1010 | clean | ✗ | 18×1.25 = 22.5 | **23** | 23 |
| O-14 | Lp unfinished at cap | 18 | 6000 / 1 | – | ∞ | clean | ✗ | 18×1.25 = 22.5 | **23** | 23 |
| O-15 | 4.9 chars/s | 18 | 3675 / 0 | – | ∞ | clean | 18000 ≥ 18375 ✗ | 18×1.25 = 22.5 | **23** | 23 |
| O-16 | 1 ms over the edge | 18 | 3601 / 0 | – | ∞ | clean | 18000 ≥ 18005 ✗ | 18×1.25 = 22.5 | **23** | 23 |
| O-17 | exactly 5.0 chars/s | 18 | 3600 / 0 | – | ∞ | clean | 18000 ≥ 18000 ✓ | 18×1.25×1.5 = 33.75 | **34** | 34 |
| O-18 | 5.0 chars/s + 1 typo | 18 | 3600 / 1 | – | ∞ | clean | typo ✗ | 18×1.25 = 22.5 | **23** | 23 |
| O-19 | shortest (1.0: 4 letters) → shortest line | 15 | 6000 / 1 | 6100 | 100 | block | ✗ | 15×0.5 = 7.5 | **8** | 6 (not reachable) |
| O-20 | half rounds up | 17 | 6000 / 1 | 6100 | 100 | block | ✗ | 17×0.5 = 8.5 | **9** | 8 (15 chars = O-19) |
| O-21 | half up with crit | 15 | 3000 / 0 | 3500 | 500 | jab | 15000 ≥ 15000 ✓ | 15×1×1.5 = 22.5 | **23** | 23 |
| O-22 | clean + crit | 27 | 5400 / 0 | – | ∞ | clean | 27000 ≥ 27000 ✓ | 27×1.25×1.5 = 50.625 | **51** | 51 |
| O-23 | non-ULTI reaches cap (combo) | 27 | 5400 / 0, fire | – | ∞ | clean | ✓ | 27×1.25×1.5×1.25 = 63.281 | **60** cap | 60 |
| O-24 | just under cap | 24 | 4800 / 0, fire | – | ∞ | clean | 24000 ≥ 24000 ✓ | 24×1.25×1.5×1.25 = 56.25 | **56** | 56 |
| O-25 | combo on a jab | 18 | 6000 / 1, fire | 6500 | 500 | jab | ✗ | 18×1×1.25 = 22.5 | **23** | 23 |
| O-26 | ULTI exactly 60 | 24 | 9000 / 1 | 9500 | 500 | jab | ✗ | 24×1×2.5 = 60 | **60** | 60 |
| O-27 | smallest ULTI | 24 | 9000 / 1 | 9100 | 100 | block | ✗ | 24×0.5×2.5 = 30 | **30** | 30 |
| O-28 | ULTI just over cap | 27 | 9000 / 1 | 9500 | 500 | jab | ✗ | 27×1×2.5 = 67.5 → 68 | **60** cap | 60 |
| O-29 | longest ULTI, block + crit (1.0: 14 → 40) | 40 | 8000 / 0 | 8100 | 100 | block | 40000 ≥ 40000 ✓ | 40×0.5×1.5×2.5 = 75 | **60** cap | 60 |
| O-30 | **new:** longest line, non-ULTI, clean + crit | 40 | 8000 / 0 | – | ∞ | clean | ✓ | 40×1.25×1.5 = 75 | **60** cap | – |
| O-31 | **new:** same, 1 ms slower | 40 | 8001 / 0 | – | ∞ | clean | 40000 ≥ 40005 ✗ | 40×1.25 = 50 | **50** | – |
| O-32 | **new:** non-ULTI lands exactly on 60 | 32 | 6400 / 0 | – | ∞ | clean | 32000 ≥ 32000 ✓ | 32×1.25×1.5 = 60 | **60** | – |
| O-33 | **new:** both finish at the 20 s edge | 40 | 19999 / 0 | 20000 | 1 | block | 40000 ≥ 99995 ✗ | 40×0.5 = 20 | **20** | – |

Note O-30/O-32: at base 1, a plain 32+ char line typed cleanly at 5 chars/s already hits the 60 cap. Two such hits KO from 100. This feeds §5.

### 1b. Domino oracle — N players

Every number is mine, from the Rules and the assumptions in §0. HP before the round is 100 unless given. "→" = hits. Order = sort by `elapsed`, then `typos`.

**D-1 · 3 players · round 1 (lowercase) · len 25 · all finish**

| Player | ms / typos | Pos |
|---|---|---|
| A | 5000 / 0 | 1 |
| B | 5300 / 1 | 2 |
| C | 6800 / 0 | 3 |

- A→B: d 300 block; crit 25000 ≥ 25000 ✓ → 25×0.5×1.5 = 18.75 → **19**
- B→C: d 1500 clean; B has a typo ✗ → 25×1.25 = 31.25 → **31**
- HP after: A **100**, B **81**, C **69**. A never hit (first finisher).

**D-2 · 3 players · tie at the end (T1) · len 20 · HP from D-1**

A 4000/0 · B 5000/1 · C 5000/1 → order A > B = C.
- A→B: d 1000 jab; crit 20000 ≥ 20000 ✓ → 20×1×1.5 = **30**
- A→C: d 1000 jab, same → **30**
- B, C: no hit between them.
- HP after: A **100**, B 81−30 = **51**, C 69−30 = **39**. Streaks (C1): A +1; B, C reset.

**D-3 · 5 players · round 5 (verbatim, not ULTI) · len 30 · one unfinished · A has fire (combo)**

| Player | ms / typos | Pos |
|---|---|---|
| A (fire) | 6000 / 0 | 1 |
| B | 6200 / 2 | 2 |
| C | 7500 / 0 | 3 |
| D | 7600 / 0 | 4 |
| E | unfinished | 5 |

- A→B: d 200 block; crit 30000 ≥ 30000 ✓; combo → 30×0.5×1.5×1.25 = 28.125 → **28**
- B→C: d 1300 clean; typos ✗ → 30×1.25 = 37.5 → **38**
- C→D: d 100 block; crit 30000 ≥ 37500 ✗ → 30×0.5 = **15**
- D→E: d ∞ clean; crit 30000 ≥ 38000 ✗ → 30×1.25 = 37.5 → **38**
- HP after: A **100**, B **72**, C **62**, D **85**, E **62**. A's fire is spent: fire false, streak 0.

**D-4 · 5 players · ULTI · len 36 · two unfinished · HP from D-3**

A 7200/0 · B 9000/0 · C 9500/1 · D unfinished · E unfinished.
- A→B: d 1800 clean; crit 36000 ≥ 36000 ✓ → 36×1.25×1.5×2.5 = 168.75 → **60** cap
- B→C: d 500 jab; crit 36000 ≥ 45000 ✗ → 36×1×2.5 = **90 → 60** cap
- C→D: d ∞ clean; typo ✗ → 36×1.25×2.5 = 112.5 → **60** cap
- C→E: same → **60**. D and E don't hit each other.
- HP after: A **100**, B 72−60 = **12**, C 62−60 = **2**, D 85−60 = **25**, E 62−60 = **2**.
- Note: on any ULTI with len ≥ 24, every hit with `d > 400` is 60. Every player but the first loses 60 in the same round.

**D-5 · 10 players · round 2 (lowercase) · len 20 · all finish · typo tie-break inside the chain**

| P | ms / typos | Hit taken (from previous) | Arithmetic | Dmg | HP after |
|---|---|---|---|---|---|
| P1 | 4000 / 0 | – | – | – | **100** |
| P2 | 4300 / 0 | P1, d 300 block, crit ✓ (20000 ≥ 20000) | 20×0.5×1.5 = 15 | 15 | **85** |
| P3 | 4700 / 1 | P2, d 400 block, crit ✗ (20000 ≥ 21500) | 20×0.5 = 10 | 10 | **90** |
| P4 | 5800 / 0 | P3, d 1100 clean, typo ✗ | 20×1.25 = 25 | 25 | **75** |
| P5 | 5800 / 2 | P4 (same ms, fewer typos → P4 first), d 0 block | 20×0.5 = 10 | 10 | **90** |
| P6 | 6100 / 0 | P5, d 300 block | 20×0.5 = 10 | 10 | **90** |
| P7 | 7200 / 1 | P6, d 1100 clean | 20×1.25 = 25 | 25 | **75** |
| P8 | 7250 / 0 | P7, d 50 block | 20×0.5 = 10 | 10 | **90** |
| P9 | 9000 / 3 | P8, d 1750 clean | 20×1.25 = 25 | 25 | **75** |
| P10 | 15000 / 0 | P9, d 6000 clean | 20×1.25 = 25 | 25 | **75** |

**D-6 · 10 players · round 7 · len 40 · two combos · two unfinished · two KOs**

| P | ms / typos | HP before | Hit taken | Arithmetic | Dmg | HP after |
|---|---|---|---|---|---|---|
| P1 | 8000 / 0 | 100 | – | – | – | **100** |
| P2 | 8300 / 1 | 40 | P1, d 300 block, crit ✓ (40000 ≥ 40000) | 40×0.5×1.5 = 30 | 30 | **10** |
| P3 (fire) | 9000 / 0 | 70 | P2, d 700 jab | 40×1 = 40 | 40 | **30** |
| P4 | 9900 / 0 | 50 | P3, d 900 jab, **combo** (crit ✗ 40000 ≥ 45000) | 40×1×1.25 = 50 | 50 | **0 KO** |
| P5 | 10500 / 1 | 100 | P4, d 600 jab | 40×1 = 40 | 40 | **60** |
| P6 | 12000 / 0 | 60 | P5, d 1500 clean | 40×1.25 = 50 | 50 | **10** |
| P7 (fire) | 12100 / 0 | 30 | P6, d 100 block | 40×0.5 = 20 | 20 | **10** |
| P8 | 14000 / 2 | 100 | P7, d 1900 clean, **combo** | 40×1.25×1.25 = 62.5 → 63 → cap | 60 | **40** |
| P9 | unfinished | 45 | P8, d ∞ clean | 40×1.25 = 50 | 50 | **0 KO** (45−50 floors at 0) |
| P10 | unfinished | 90 | P8, d ∞ clean | 40×1.25 = 50 | 50 | **40** |

P4 lands on exactly 0: that is a KO (brief: "HP 0 → KO"). P4 and P9 become spectators for the next round. P4 dealt a hit this round (P4→P5) before being KO'd: the hit still lands.

**D-7 · 3 players · `TK_EXTRA_LAST_HIT=1` (X1) · len 40 · received cap 60**

A 8000/0 · B 8500/1 · C 10000/1.
- A→B: d 500 jab; crit ✓ → 40×1×1.5 = **60**
- B→C: d 1500 clean; typo ✗ → 40×1.25 = **50**
- A→C extra: d 2000 clean; crit ✓ → 40×1.25×1.5 = 75 → **60**
- C received 50 + 60 = 110 → **capped at 60**. HP after: A **100**, B **40**, C **40**.
- Same round with the flag **off** (default): no extra hit, C = 100−50 = **50**.

**D-8 · 3 players · only one finisher · len 30**

A 9000/1 · B unfinished · C unfinished → A→B and A→C, d ∞ clean: 30×1.25 = 37.5 → **38** each. HP after: A **100**, B **62**, C **62**.

**D-9 · 5 players · nobody finishes in 20 s · len 30** → no hits, every HP unchanged, streaks unchanged (C1). In 2 players, a full tie (same ms, same typos) is likewise no hit: 1.0's draw.

## 2. Rule tests

Area: **proto** = raw WebSocket bots (the `conn()` pattern in `test-proto.mjs`) · **ui** = Playwright, desktop + iPhone 12, `launchBrowser()` from `test-lib.mjs` · **audio** = `AudioContext.prototype` hooks as in `test-audio.mjs` · **boot** = start `server.js` from a `/tmp` copy. All servers on ports ≥ 3300 (`suite.test.mjs` already picks 3300–3889). Each new check must fail once against a deliberately broken `/tmp` copy before it counts.

| ID | Area | What | How | Pass | Ref |
|---|---|---|---|---|---|
| P-01 | proto | Finishing order = own `elapsed`, **slow packet sent first** | 5 bots. Each round, bots send `done` in **reverse** order of their `elapsed` claim, 300 ms apart (the fastest claim arrives last, 1.2 s after the first). 20 rounds | Chain follows `elapsed` order 20/20; damage per oracle | Rules-1 |
| P-02 | proto | 2 players reproduce 1.0 | Rows O-01…O-33 as 2-player rounds, `TK_BASE_PER_CHAR=1`, line length picked by skipping rounds (or the test hook, N3) | 33/33 exact: tier, crit, combo, ULTI, damage, HP | Rules-4 |
| P-03 | proto | Domino oracle | Rows D-1…D-8 driven by bots with the exact claims above; HP set by playing the earlier rows first | Every link (from, to, tier, crit, combo, damage) and every HP after matches | Rules-1/2/3 |
| P-04 | proto | Round ends when the last **alive** player finishes | 5 bots, 2 KO'd (spectators); 3 alive finish at 6 s | Result within 200 ms of the 3rd `done`, not at 20 s | Core loop 3, G1 |
| P-05 | proto | 20 s cap with unfinished players | D-4/D-6/D-8 shapes; unfinished bots send nothing | Result at 20000 ± 200 ms; unfinished hit by the last finisher only, clean | Rules-1 |
| P-06 | proto | Nobody finishes | D-9 | No hits, HP unchanged | Rules-1 |
| P-07 | proto | Tie | 2 bots same ms + typos → no hit (draw); 3 bots tie at the end → D-2 | As oracle | Rules-1 |
| P-08 | proto | Invariants, random | 300 rounds, N random 3–10, random claims (no ties outside the end, see T2), compared to `oracle-2.0.mjs` | 300/300 match; nobody receives > 60 in a round; the first finisher never loses HP (flag off); HP never < 0 | Rules-2/3 |
| P-09 | proto | Received cap with the flag on | `TK_EXTRA_LAST_HIT=1`, D-7; then the flag off | C = 40 with the flag, 50 without; default config has the flag = 0 | Rules-3/6 |
| P-10 | proto | `elapsed` bounds at defaults | 149, 150, 20000, 20001, non-integers, strings | 150 and 20000 accepted, rest `bad_elapsed` | 1.0-F5 |
| P-11 | proto | Lines lowercase / no punctuation in rounds 1–3 | Read every `word` (or 2.0's name for it) in rounds 1–3 of 30 matches | Text matches `/^[a-z0-9 ]+$/` (digits: N5), no double space, no leading/trailing space; it equals `normalize(line)` of a line in `lyrics.txt` | Rules-5 |
| P-12 | proto | Verbatim from round 4 | Rounds ≥ 4, same 30 matches | Text is byte-for-byte a line of `lyrics.txt` | Rules-5 |
| P-13 | proto | ULTI cadence | 60 rounds × 3 matches, nobody KO'd (`TK_HP` high) | First ULTI in round 4–6; every gap 4–6; gaps 4, 5 and 6 each seen; ULTI text verbatim; ULTI damage ×2.5 (via P-03/P-08) | Rules-5 |
| P-14 | proto | No line repeats in a match | 150 rounds, one match | All distinct (bank ≥ 200 lines) | 1.0-F3 (not restated in 2.0, N6) |
| P-15 | boot | `lyrics.txt` validation | `/tmp` copies of the bank with: 39 songs · 199 lines · a 14-char line · a 46-char line · a block without `title \| artist` · empty file · missing file. Also exactly 15 and 45 chars, 40 songs, 200 lines | Each broken copy: exit 1, message names the rule. Boundaries boot | Must (lyrics) |
| P-16 | boot | `SIGHUP` reload | Own server on ≥ 3300: replace the bank with a valid copy + 1 new song, `kill -HUP <my pid>`; then with an invalid copy | Valid: the new song shows up (log line / health count), the round in progress keeps its line. Invalid: process stays up and keeps the old bank (N7) | Must (lyrics) |
| P-17 | proto | B3: never revealed early | 200 rounds, 10 sockets | `revealAt ≥ endsAt` **200/200**; on every socket, line received ≥ `COUNTDOWN_MS − 20` after the countdown | Must (B3) |
| P-18 | proto | Same line to everyone | Same 200 rounds | Identical payload on all 10 sockets; receive spread < 50 ms | 1.0-F2 |
| P-19 | proto | Spectator after KO | Bot KO'd; sends `done`, then an emoji | `done` → error, no effect on the chain; emoji is broadcast to every socket; spectator never appears in the finishing order | Must (spectator) |
| P-20 | proto | Rematch resets, same players | After a win, everyone votes rematch | Same room code, same ids and skins; every HP 100; spectators are players again; streak 0, fire false; round 1 lowercase; first ULTI 4–6 | Core loop 5 |
| P-21 | proto | Combo across rounds (C1) | Bot A finishes 1st for 3 rounds, then 4th round; bot B finishes last once in the middle of its streak | A's 4th-round hit ×1.25, fire cleared after; B's streak reset by the last-place round | Rules-2, C1 |
| P-22 | proto | Rejoin mid-round | 5 bots; one drops after the line appears, rejoins by token 2 s later | Same id, HP, skin; the rejoiner takes at most one hit; the other links unchanged (exact rule pending, §3) | Must (rejoin) |
| P-23 | proto | Room size 2–10 | 11th `join`; `start` with 1 | `error` "Room penuh (maks 10 pemain)"-class; start refused with < 2 | Must |
| P-24 | proto | 1.0 guards still hold | stale / dup / `bad_typos` / malformed JSON / big frame | Same codes as 1.0 suite S-guards | 1.0 |
| U-01 | ui | B1: whole line in viewport, **host and every guest** | 320×480, 3 contexts and 10 contexts; play until a 40–45 char line; also with each page scrolled as it lands | Both rows of the line box inside the viewport on every context, every round | Must (B1) |
| U-02 | ui | 320 px width | 320×480, 320×568, iPhone 12, 10 players: lobby, ring + avatar row, result, end | `scrollWidth ≤ innerWidth` | Must (look) |
| U-03 | ui | Input attributes | Inspect the hidden input | `autocapitalize=off autocorrect=off spellcheck=false inputmode=text`, font-size 16px, never `display:none` | Risk (autocorrect) |
| U-04 | ui | Strict typos on a sentence | Type a wrong char mid-line, then more, then backspace | Red tile; further chars ignored until deleted; `typos` = 1 | Core loop 2 |
| U-05 | ui | Trailing space | After the last char, `insertText(' ')`; and a predictive `insertReplacementText('aku ')` mid-line | `done` already sent / not blocked; no extra typo (N8) | Risk (trailing space) |
| U-06 | ui | Focus kept across rounds | iPhone 12: focus once, play 10 rounds without tapping | `document.activeElement` is the input at every line reveal | Controls |
| U-07 | ui | Domino order on screen = server chain | Read the avatar order / `data-` hook after each result | Same order as the result message, 20 rounds | Core loop 3 |
| U-08 | ui | Big boxers = who hit you / who you hit | Middle player in a 5-player round | Left = their hitter, right = their target; unknown (neutral) while typing | Core loop 3 |
| U-09 | ui | Title + artist card | After each domino | Shows the line's own song for ~1 s (900–1300 ms) | Core loop 4 |
| U-10 | ui | Spectator UI | KO'd context | Emoji bar visible and works; typing does nothing; keyboard input not focused | Must (spectator) |
| U-11 | ui | ULTI shake | ULTI hit | `.shake` (or 2.0's equivalent) on the hit, not with `reduced-motion` | Rules-5 |
| U-12 | ui | Saved keys | Old `tk_skin` index, `tk_theme=dark` set before load | Skin maps; theme key ignored and still present; no new keys | Saved on the device |
| U-13 | ui | 0 console errors | Whole UI run, desktop + iPhone 12 | **0** page and console errors | 1.0 gate |
| U-14 | ui | Avatar row is static | 10 players on iPhone 12 | Avatar row has no running CSS/SVG animation; only the two big boxers animate | Risk (10 SVGs) |
| U-15 | ui | Frame budget, iPhone 12 emulation | 10 players, CPU throttle 4×, 10 s across a domino | No frame gap > 50 ms; p95 ≤ 20 ms | Risk (10 SVGs) |
| A-01 | audio | No AudioContext before a gesture; music after refresh needs a tap | 1.0 A-01/A-07 on iPhone 12 | As 1.0 | 1.0 gate |
| A-02 | audio | Hit sounds with body | Force jab, block, uppercut, KO | Each one starts ≥ 3 sound sources (click + thump + tail); the four node graphs differ | Art: Sound |
| A-03 | audio | Lobby pad | Lobby open, music on | Pad playing; stops at countdown or keeps per DESIGN.md | Art: Sound |

## 3. Pending DESIGN.md — message-level tests I can't write yet

Each line becomes concrete when Jiwoo's protocol lands. I won't guess the message names.

- **Result message shape**: the chain (`hits[]` of from/to/tier/margin/crit/combo/ulti/damage?), finishing order, per-player HP, `elapsed` per player, `fire` per player. P-03/P-08 assert against it.
- **`state` for N players**: players list, spectator flag, online flag, HP, skin; no line text in any `state` (1.0 P-54).
- **Line message**: name, `revealAt`, `capMs`, `ulti`, `ultiIn`; whether rounds 1–3 send the normalised text or the client normalises.
- **Emoji message**: client → server name and allowed set; rate limit; who may send (spectators only, or everyone?).
- **Spectator `done`**: which error code.
- **T2**: tie group not at the end — who hits the next player, and does that player take two hits?
- **Rejoin mid-round in N players**: is the line re-sent (1.0 said no → rejoiner unfinished → takes a clean hit)?
- **Offline player at countdown end**: does one offline phone pause all 10 (1.0's `bothOnline` pause), or is the offline player treated as unfinished? Walkover timing with N players.
- **Rematch with someone offline / left**: does it start with the players present? 1.0 needed every vote.
- **A player who leaves mid-match**: removed from the chain, or KO?
- **Grace window**: gone (G1) or kept?
- **Combo semantics** (C1) and **extra-hit `d`** (X1) — confirm.
- **Test hook**: `window.__tinju` fields for chain/order and a way to force a line length (N3).
- **`SIGHUP` with an invalid bank** (N7) and how a reload is observable (log line or `/health` field).

## 4. Phone matrix — needs deploy + Pras

Real iPhone **and** real Android, phone models written down. Not runnable before a deploy, and the deploy is Pras's call.

| ID | Check | Pass |
|---|---|---|
| M-01 | Autocorrect and prediction **on** (iOS QuickType, Gboard): type 5 lines, rounds 1–3 and 4+ | No word changed, no capital inserted; typos counted only for your own mistakes |
| M-02 | Accept a keyboard suggestion mid-line and at the end (it inserts "word ") | No false red tile, `done` still fires at the last char |
| M-03 | Keyboard open: both rows of a 40–45 char line and your own HP stay visible; page doesn't zoom | Both OSes, also on the smallest phone at hand |
| M-04 | Focus once, play 10 rounds without tapping | Keyboard stays up every round |
| M-05 | Refresh mid-match | No sound until a tap; music button pulses; music after the tap; you're back in the same room |
| M-06 | ULTI line with capitals, `,` `!` `?` digits | Typeable within 20 s; symbols keyboard switching doesn't drop focus |
| M-07 | Get KO'd | Spectator view, emoji works, keyboard doesn't open |
| M-08 | As many players as Pras can gather (phones + desktop tabs, up to 10) | Domino readable, avatar row legible, no stutter on an iPhone 12 |
| M-09 | Hit sounds, eyes closed | Jab, block, uppercut and KO told apart |
| M-10 | Lock the phone 25 s mid-match, then 10 s | Behaviour matches DESIGN.md (pending §3) |

## 5. KO-clustering simulation — the numbers I'll hold the build to

The run must drive the **shipped** `resolve()` (bots over WebSocket, or the function exported for tests), not a copy of the formula; a re-implementation proves nothing about the build. Config = whatever ships (`BASE_PER_CHAR`, `EXTRA_LAST_HIT`, HP 100). I'll re-run my own model (`tests/plan-2.0/sim-ko.mjs`) beside it; the two must agree within ±10 % on K-2/K-3 medians.

Bot model (fixed, so runs compare): 1000 matches per size, seeded mulberry32 (seed 1000 + match). Each bot's speed is uniform 3–8 chars/s for the whole match; per round × uniform 0.85–1.15; +400 ms reaction; each char 2 % typo chance, +600 ms per typo; > 20 s = unfinished. Lines uniform 15–40 chars. Round wall time = 2.4 s countdown + typing (slowest alive, or 20 s) + 0.15 s × links + 1 s title card + 1.4 s result.

| ID | Measure | Pass |
|---|---|---|
| K-1 | Most players KO'd in any one round, 10 bots | ≤ 3 in ≥ 95 % of matches, and **never ≥ 5** |
| K-2 | 10-bot match length | median 120–240 s; p10 ≥ 90 s; p90 ≤ 300 s |
| K-3 | 2-bot match length | median 40–60 s |
| K-4 | Rounds containing ≥ 1 KO, 10 bots | median ≥ 5 (KOs arrive one by one-ish) |
| K-5 | Round of the first KO, 10 bots | median ≥ 4 (nobody out before the first ULTI can land) |
| K-6 | 5-bot length; how often the fastest bot wins | Report only |

**My model at the brief's start values (`BASE_PER_CHAR=1`, flag off), run 2026-10-30** — this is a model of the brief, not the build:

| Size | Max KOs in one round ≤ 3 | Match median | KO rounds median | First KO median |
|---|---|---|---|---|
| 10 bots, base 1 | 85 / 1000 (8.5 %) | 80 s | 3 | round 3 |
| 10 bots, base 1, flag on | 210 / 1000 | 74 s | 4 | round 2 |
| 10 bots, base 0.5 | 432 / 1000 | 133 s | 4 | round 5 |
| 10 bots, base 0.35 | 537 / 1000 | 179 s | 5 | round 8 |
| 10 bots, base 1, ULTI off | 218 / 1000 | 87 s | 4 | round 3 |
| 2 bots, base 1 | – | 42 s | – | round 3 |

So at base 1, K-1, K-2, K-4 and K-5 fail; K-3 passes. Turning base down fixes the length (0.35 → 179 s) but not the clustering: even then about half the matches have a round that KOs 4 or more. Turning ULTI off only moves 8.5 % to 22 %. My reading: the clustering is structural — in pure domino, 9 of 10 players take a hit of roughly the same size every round, so their HP falls in step. Flipping `EXTRA_LAST_HIT` on makes it worse, not better. This is a design question for Jiwoo before Wasawho tunes a number (N1).

## 6. Release gate

Severity (A-na's scale): **S1** wrong result or a broken Rule, no workaround · **S2** broken feature, workaround exists · **S3** cosmetic or edge case.

Two stages. **Stage A** (automated, on the exact commit, run twice, a once-failing case counts as failing) decides whether Stella may ask Pras for a deploy. **Stage B** (phones, after Pras deploys) decides whether it stays.

| Blocks go | Who may waive |
|---|---|
| Any S1 | Nobody — fix it |
| Rule tests: P-01, P-02, P-03, P-04, P-05, P-07, P-08, P-09 (flag default off), P-11, P-12, P-13, P-17 (B3 200/200), P-19, P-20 | Pras only — these are the brief's Rules / Must haves |
| P-15, P-16 (bank validation and reload), P-22, P-23, P-24, P-10, P-14, P-18 | Pras only |
| U-01 (B1, host and guests), U-02, U-03, U-04, U-06, U-10, U-13 (0 errors) | Pras only |
| K-1, K-2, K-3 | Pras (they encode his "2–4 min" and the brief's "KO you can feel") |
| M-01…M-05 on both OSes (stage B) | Pras only |
| Everything else: U-05, U-07–U-09, U-11, U-12, U-14, U-15, A-01–A-03, P-06, P-21, K-4, K-5, M-06–M-10, any S3 | **Stella** may waive in writing, with a v2.0.1 follow-up |

Go = every blocking case PASS in both runs, logs under `tests/evidence/logs/`, the phone models written down. A failing blocking case is reported with steps, expected, actual, evidence, and sent to Wasawho.

## 7. Tests I expect to fail first

1. **K-1** KO clustering at base 1 — my model: only 8.5 % of 10-bot matches keep every round to ≤ 3 KOs.
2. **K-2** 10-player length — my model: median 80 s against 120–240 s.
3. **U-01** B1 on guests — 1.0 already hid row two of a 14-char word on the guest at 320×480 (gate B1); 2.0 has 40–45 char lines plus an avatar row above the ring. Inference, not run.
4. **P-17** B3 200/200 — 1.0 revealed 1 ms early in 1 of 50 rounds in 2 of 3 runs (gate B3); unless the countdown re-arms, 200 rounds makes a hit likely. Inference.
5. **U-05** trailing space — strict compare plus a predictive keyboard that appends a space is a new path 1.0 never had. Inference.

## 8. Notes for Jiwoo / Wasawho (no decision changed here)

| # | Note | Who |
|---|---|---|
| N1 | Clustering is structural in pure domino (§5); base tuning fixes length, not clustering. Ideas to test, not decide: smaller margin for the tail of the chain, or damage scaled by position | Jiwoo |
| N2 | At base 1 a plain 32-char line at 5 chars/s already deals 60 (O-32); every ULTI line ≥ 24 chars deals 60 on almost every link (D-4) | Jiwoo |
| N3 | Test hook to force a line (or length) — without it, P-02 skips rounds until a line of the right length comes up, as 1.0 did | Wasawho |
| N4 | The existing `test-proto.mjs` hard-codes base 3 (`dmg` helper line 49) and `MAX_PLAYERS` 2; it will fail on 2.0 by design and must be updated with the protocol | Wasawho |
| N5 | Rounds 1–3 "no punctuation": are digits and accented letters kept? | Jiwoo |
| N6 | 1.0-F3 "no repeated word" isn't restated in 2.0; P-14 assumes it still holds | Jiwoo (confirm) |
| N7 | `SIGHUP` with an invalid bank: keep the old bank or exit? (exit would kill a live match) | Jiwoo |
| N8 | Trailing space after the last char: ignore, or count? The brief says the strict rule must "survive" it | Jiwoo |
| N9 | The brief says the 1.0 oracle has 28 rows; my 1.0 plan has 29 (O-01…O-29). All 29 are here | — |
