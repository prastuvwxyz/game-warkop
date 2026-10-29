# Tinju Kata 2.0.0 — Release gate, Stage A

Date: 2026-10-30 (runs between 01:39 and 02:10 WIB, by the log file times in /tmp/ana-g2/logs) · Author: A-na (QA) · Plan: `tests/PLAN-2.0.md` §6
Commit under test: **`49ad6b8`** on `tinju/2.0-royale`. `git pull` said "Already up to date"; HEAD and `origin/tinju/2.0-royale` were both `49ad6b8` at the start and again before this commit. The branch did not move.
How: `git archive 49ad6b8` into two separate copies, `/tmp/ana-g2/A` (run 1) and `/tmp/ana-g2/B` (run 2). Every suite and every check of mine ran once on each copy. Ports used: 3300–3561. Never 3100 or 3200; both were still live and untouched at the end. Nothing deployed, no sudo, no file outside `tests/` changed.
Logs: `tests/evidence/logs/gate-*` (copied from `/tmp/ana-g2/logs/`). My scripts: `tests/plan-2.0/gate/`.
PM decisions gated against, not re-litigated: `BASE_PER_CHAR` 0.6, `RANK_WEIGHT` 1, `EXTRA_LAST_HIT` 0 (`PASS CFG defaults: BASE_PER_CHAR 0.6, RANK_WEIGHT 1, EXTRA_LAST_HIT 0, CAP 60, RECV_CAP 60`, gate-rules-A/B). B2 (44 px) stays waived. K-1 is reported as FAIL, waived pending Pras.

## Verdict: NO-GO for Stella's go request, as of `49ad6b8`

One blocking case fails in both runs, and only Pras may waive it:

- **U-10, spectator UI: FAIL in both runs.** A player who gets KO'd keeps keyboard focus on the hidden input during the next rounds (`"foc":"typer"`). On a phone the keyboard would stay open while they're a spectator. The emoji bar sits at 444–544 px of a 664 px iPhone 12 screen, where an open keyboard normally sits. That last point is inferred from the layout, not seen on a phone. See bug B4. The fix looks small: blur the input when a `line` arrives with `entrant:false`. After the fix: re-run U-10, U-06 and U-13 twice.

Every other blocking case in Stage A passes in both runs, including B1 (host + 2 guests and 10 players at 320×480, plus a worst-case 45-character bank) and B3 (200/200 rounds, both runs). K-1 fails as expected and is waived pending Pras (§4).

The verdict becomes **GO for the go request** if Wasawho fixes B4 and the re-run passes, or if Pras waives U-10 in writing. Stage B (phones, after deploy) is still required either way (§7).

## 1. Wasawho's suites, my runs

| Suite | Run 1 (copy A) | Run 2 (copy B) | Logs |
|---|---|---|---|
| test-rules.mjs | `== test-rules: PASS 90 / FAIL 0 ==` | `== test-rules: PASS 90 / FAIL 0 ==` | gate-w-rules-A/B.log |
| test-proto.mjs | `== test-proto: PASS 128 / FAIL 0 ==` (90 s) | `== test-proto: PASS 128 / FAIL 0 ==` (91 s) | gate-w-proto-A/B.log |
| test-ui.mjs | `== test-ui: PASS 134 / FAIL 0 ==` (109 s) | `== test-ui: PASS 134 / FAIL 0 ==` (109 s) | gate-w-ui-A/B.log |
| test-audio.mjs | `== test-audio: PASS 34 / FAIL 0 ==` | `== test-audio: PASS 34 / FAIL 0 ==` | gate-w-audio-A/B.log |
| e2e/look.mjs | `look: 3/3 pass` (B1 3/3 per device; frame max gap 17 ms, informational) | `look: 3/3 pass` | gate-w-look-A/B.log |

My first try at the browser suites crashed before any check ran. Under the agent sandbox `HOME`, `launchBrowser()` couldn't find the Playwright cache. That's a harness problem, not the build; the logs are kept as `gate-w-*-harness-crash.log`. Both runs above used `PLAYWRIGHT_BROWSERS_PATH=/home/prastuvwxyz/.cache/ms-playwright`.

## 2. My checks (`tests/plan-2.0/gate/`, oracle written from the brief + DESIGN.md, not from engine.js)

| Script | Run 1 (A) | Run 2 (B) |
|---|---|---|
| gate-rules.mjs: real `resolveRound()` | `PASS 33 / FAIL 0` | `PASS 33 / FAIL 0` |
| gate-proto.mjs: real `server.js` | `PASS 63 / FAIL 4`. All 4 were my fixture bugs (§6); the section re-run gave `PASS 19 / FAIL 0` (gate-proto-A-p15rerun.log). P-01 strengthened and re-run: `PASS 4 / FAIL 0` (gate-proto-A-p01v2.log) | `PASS 67 / FAIL 0`, plus P-01 v2 `PASS 4 / FAIL 0` |
| gate-ui.mjs: Playwright UI + audio | gate-ui-A.log (B1 sections), gate-ui-A-r2.log (audio), gate-ui-A-r3.log: `PASS 17 / FAIL 1` (U-10) | gate-ui-B.log: `PASS 22 / FAIL 1` (U-10) |
| sim-ko-engine.mjs: my KO model on the real engine | gate-sim-A.log `PASS 8 / FAIL 2` (K-1 ×2) | gate-sim-B.log, identical output (`diff` empty) |

**Mutation checks.** Each new check was run against a deliberately broken copy, to prove it can fail:

| Mutant (`/tmp/ana-g2/mut-*`) | Caught by | Log |
|---|---|---|
| `d <= BLOCK_MS` → `d < BLOCK_MS` | P-02a, `PASS 27 / FAIL 6` | gate-mut-rules-block-rules.log |
| rank weight `(rank−1)/(n−1)` → `rank/(n−1)` | P-03 shipped config, `PASS 23 / FAIL 10` | gate-mut-rules-weight-rules.log |
| finishing order sorted by seat, not `elapsed` | P-01 `0/20 rounds` | gate-mut-eng-seat-proto.log |
| B3 re-arm removed, reveal 3 ms early | P-17 `early 200/200, min revealAt-endsAt -4 ms` | gate-mut-srv-b3-proto.log |
| B1: ring +200 px **and** scroll-into-view removed | U-01 `12/36 page-rounds ok` | gate-mut-cli-b1-tall-noscroll-ui.log |
| B1: ring +200 px, scroll kept (the shipped fix) | U-01 still `36/36` | gate-mut-cli-tall-withscroll-ui.log |

At the shipped layout, a 320×480 game screen fits without scrolling (document height 480). B1 holds by layout, and the scroll-into-view is a second safety: removing only the scroll is not caught, because nothing moves.

## 3. Every blocking case in PLAN-2.0 §6, Stage A

R1 = copy A, R2 = copy B. Evidence is quoted from the named log (A or B; the line has the same form in both unless shown).

| Case | R1 | R2 | Evidence (log) |
|---|---|---|---|
| P-01 finishing order by own `elapsed`, slow packet first | PASS | PASS | `PASS P-01: 5 bots, done sent slowest-claim first (fastest arrives 1.2 s after the first): order by own elapsed \| 20/20 rounds` + `PASS P-01/P-03: every link (from, to, applied, combo) and HP after = my oracle at the shipped config, 20 rounds \| 20/20` (gate-proto-A/B-p01v2) |
| P-02 2 players = 1.0 | PASS | PASS | `PASS P-02a: literal 1.0 rows O-01..O-29 at base 3, 2 entrants, RANK_WEIGHT=1 … \| 29/29` (and RANK_WEIGHT=0 29/29); `PASS P-02b: plan §1 rows O-01..O-33 at base 1 \| 33/33`; `PASS P-02c: … shipped base 0.6 … engine = my oracle \| 33/33` (gate-rules-A/B). Over the wire: `PASS SPEC "sepeda" … = 34 (base 3, 2 players)` (gate-w-proto) |
| P-03 domino oracle | PASS | PASS | D-1…D-9 + D-7off, hand numbers (base 1, RW 0) and shipped config (base 0.6, RW 1), e.g. `PASS P-03 D-6 (plan §1b hand numbers …): every HP after \| {"P1":100,"P2":10,"P3":30,"P4":0,…}`, `PASS P-03 D-4 at the shipped config …` (gate-rules-A/B) |
| P-04 closes at the last **alive** done | PASS | PASS | `PASS P-04: the round closes when the 3 ALIVE players are done (2 spectators never send) — not at the cap \| 1 ms after the 3rd done` (B: 2 ms) |
| P-05 20 s cap, unfinished | PASS | PASS | `PASS P-05 (defaults): result at revealAt + 20000 + 1000 (+-200 ms) with one player unfinished \| 21003 ms` (B: 21002 ms); `PASS P-05: a done{19900} sent at revealAt+20.6 s counts`; `PASS P-05: the unfinished player is hit by the last finisher only, clean, d null, weight 1` |
| P-07 ties | PASS | PASS | `PASS P-07: 3-way tie in front -> lowest seat (B) hits D; A and C hit nobody, take nothing \| ["B>D"]`, `PASS P-07: 2 players, same elapsed + typos -> no hit, streaks unchanged (1.0 draw)` (gate-rules); D-2 tie at the end (P-03) |
| P-08 300 random rounds vs oracle | PASS | PASS | `PASS P-08: 300 random rounds (N 3-10, len 15-45, ULTI 20 %, fire 20 %, EXTRA_LAST_HIT 0) engine = my oracle … \| mismatches 0 · rounds with a tie 30`; flag 1: `mismatches 0 · rounds with a tie 42`; `PASS P-08: invariants … over 0 neg 0 firstLost 0` |
| P-09 flag default off, received cap | PASS | PASS | CFG line above; `PASS P-03 D-7 (… EXTRA_LAST_HIT 1): every HP after \| {"A":100,"B":40,"C":40}`; `PASS P-09: EXTRA_LAST_HIT=1 with only 2 ranks -> no extra link` |
| P-11 rounds 1–3 plain | PASS | PASS | `PASS P-11: rounds 1-3 (9 lines): plain form = lowercase [a-z0-9 ], single spaces, = plain form of a bank line, never ULTI \| 9/9` |
| P-12 verbatim from round 4 | PASS | PASS | `PASS P-12: rounds >= 4: form "full", byte-for-byte a bank line \| 171/171` |
| P-13 ULTI cadence | PASS | PASS | `PASS P-13: first ULTI in round 4-6 in 3/3 matches; ultiIn counts down to 0 …`; gaps A `4,6,5,5,6,5,5,4,…` / B `6,5,4,6,4,5,4,4,…`; `PASS P-13/brief: ULTI lines verbatim and >= 30 chars; normal rounds >= 4 < 30 chars \| ulti 35/35 normal 136/136` (B: 36/36, 135/135) |
| P-17 B3 | PASS | PASS | `PASS P-17 (B3): line.revealAt >= countdown.endsAt on all 10 sockets, 200/200 rounds \| early 0/200, min revealAt-endsAt 0 ms`; `… frames early 0, min receive gap 98 ms` (B: 99 ms). Wasawho's `B3 (10 sockets)` line passes too |
| P-19 spectator | PASS | PASS | `PASS P-19: KO'd players get the line with entrant:false …`, `… done -> error{code:"spectator"}`, `… emoji reaches all 5 sockets`, `… alive player cannot throw emoji mid-match`, `… spectators are not in order[] and not in any link` |
| P-20 rematch resets | PASS | PASS | `PASS P-20: rematch: same room code and the same 5 ids and skins \| [0,1,2,3,0]`, `PASS P-20: rematch resets: HP = HP for everyone, out null …, streak 0, fire false, round 1 plain`, `… first ULTI scheduled in round 4-6 … \| 4` |
| P-15 bank validation at boot | PASS | PASS | 15 lines per run, e.g. `PASS P-15: boot with 149 lines < 30 (brief: >= 150) -> exit 1 …`, `… 39 lines >= 30 (brief: >= 40) -> exit 1`, `… curly quote`, `… duplicate line`, `… missing file`, boundaries `PASS P-15: 200 lines boots (boundary)`, `… exactly 40 songs … boots` (R1: gate-proto-A-p15rerun, see §6; R2: gate-proto-B) |
| P-16 SIGHUP on a live server (port 3407 / 3427) | PASS | PASS | `PASS P-16: SIGHUP with a valid new bank -> process stays up, /health lyrics = 40 songs / 200 lines, log says reloaded`, `… running match keeps its snapshot: 20 more rounds, every line from the OLD bank`, `… next match draws only from the new bank`, `… invalid bank -> process stays up, keeps the new bank (40 songs), logs REJECTED` |
| P-22 rejoin mid-round | PASS | PASS | `PASS P-22: rejoin by token mid-round -> same id, same HP, same skin`, `… line is NOT re-sent`, `… done for that round -> stale`, `… takes exactly one hit: clean from the last finisher, weight 1`, `… other links equal my oracle`, `PASS P-22/P-24: rejoin with a bad token -> rejoin_failed` |
| P-23 room size | PASS | PASS | `PASS P-23: 11th join -> error "Room penuh (maks 10 pemain)"; room still 10`, `PASS P-23: start with 1 player refused … \| Butuh 2 pemain online` |
| P-24 1.0 guards | PASS | PASS | `PASS P-24: typos -1, 100, 1.5, "0" -> bad_typos`, `… dup`, `… stale`, `… malformed JSON -> error, socket stays open`, `… oversize frame (70 kB) … closed true code 1009`, `PASS P-27: unknown t -> no reply` |
| P-10 `elapsed` bounds at defaults | PASS | PASS | `PASS P-10 (defaults): elapsed 149, 20001, -1, 0, 1.5, "abc", "1200", null, missing, 1e9 -> bad_elapsed each`, `PASS P-10: 150 and 20000 accepted (no error)` |
| P-14 no repeats | PASS | PASS | `PASS P-14: match 1/2/3, 60 rounds: no line repeats`, `PASS P-14: one match of 150 rounds on the real bank: 150 distinct lines \| 150` |
| P-18 same line to all | PASS | PASS | `PASS P-18: identical line payload on all 10 sockets, 200/200; receive spread < 50 ms \| identical 200/200, max spread 1 ms` |
| U-01 B1, host **and** guests, 320×480 | PASS | PASS | `PASS U-01 (B1, worst-case bank 29/45 chars): … HOST and both GUESTS, every round (guest1 scrolled to bottom, guest2 to top …) \| 36/36 page-rounds ok, 45-char reveals seen 6`; `PASS U-01 (B1, real bank, 10 players all at 320x480 …) \| 120/120` (gate-ui-A, -A-r3, -B) |
| U-02 320 px width | PASS | PASS | `PASS U-02: 10-player room at 320x480: no horizontal overflow on lobby, ring and result screens`, `PASS U-02: end screen at 320x480, 320x568, desktop, iPhone 12: no horizontal overflow` |
| U-03 input attributes | PASS | PASS | `PASS U-03: … \| {"ac":"off","acor":"off","sp":"false","im":"text","fs":"16px","disp":"block"}` |
| U-04 strict typos | PASS | PASS | `PASS U-04: a wrong char goes red and blocks … \| {"typed":"","bad":"#","typos":1,…,"redTile":true}`, `PASS U-04: backspace removes the red char, typos stays 1` (gate-ui-A-r3, see §6 / B) |
| U-06 focus kept across rounds | PASS | PASS | `PASS U-06: iPhone 12, one tap in round 1, then 10 rounds: the hidden input has focus at every line reveal \| 10/10`; `PASS U-04/U-06: the line typed for real … 10/10` |
| **U-10 spectator UI** | **FAIL** | **FAIL** | `FAIL U-10: spectator typing does nothing and the input is not focused \| {"typing":{"typed":"",…},"foc":"typer"}` (gate-ui-A-r3, gate-ui-B). The other U-10 lines pass: `… emoji bar visible with 8 emoji, line marked spectator \| {"bar":true,"n":8,"entrant":false,"out":"ko"}`, `… tapping an emoji reaches another player's socket` |
| U-13 0 console errors | PASS | PASS | `PASS U-13: 0 page and 0 console errors across every page in this run \| errors=0` (mine); Wasawho: 134/0 per run |
| K-1 KO clustering | FAIL, waived pending Pras | FAIL, waived pending Pras | §4 |
| K-2 10-bot length | PASS | PASS | `PASS K-2 [plan model (lines 15-40)] … \| 184/206/231`; real bank lengths `188/209/234` |
| K-3 2-bot length | PASS | PASS | `PASS K-3 [plan model …] 2 bots: median 40-60 s \| 45/58/87`; real bank lengths `46/59/86` |
| M-01…M-05 | NOT RUN, Stage B | | Need deploy + real phones, §7 |

## 4. KO simulation (K-1…K-6): my model on the real `resolveRound()`, shipped config

Model as in PLAN §5: 1000 matches per row, seed 1000+match, 3–8 chars/s, +400 ms, 2 % typo +600 ms, 20 s cap. "plan" = lines uniform 15–40; "bank" = real line lengths from `lyrics.txt` (plain form in rounds 1–3, normal < 30, ULTI ≥ 30). Runs A and B gave identical output.

| Measure | plan lines | real bank lengths | Gate |
|---|---|---|---|
| K-1: 10 bots, matches with ≤ 3 KOs in every round | **97.1 %**, 1 match with ≥ 5 | **93.7 %**, 8 matches with ≥ 5 | FAIL, **waived pending Pras** |
| K-2: 10 bots, match s p10/p50/p90 | 184/206/231 | 188/209/234 | PASS |
| K-3: 2 bots, match s | 45/58/87 | 46/59/86 | PASS |
| K-4: 10 bots, rounds with a KO, median | 7 | 7 | PASS |
| K-5: 10 bots, first-KO round, median | 5 | 6 | PASS |
| K-6: 5 bots s, fastest bot wins | 117/137/162, 83.4 % | 117/137/165, 82.1 % | report |

**Correction to the K-1 framing in the request and in CHANGELOG.** "1 match in 1000" is true only with my plan's line model. With the bank's real line lengths, K-1 fails both halves: 93.7 % is below the 95 % bar, and 8 matches in 1000 have a round with ≥ 5 KOs. That agrees with Wasawho's own `sim-2.0.txt` (`lines=bank … 93.5% … maxKO>=5 8`, "every one of them an ULTI round"). I did not re-measure the ULTI attribution myself. The waiver Pras gives should name the bank-length numbers.

## 5. Failing cases, verbatim

```
FAIL U-10: spectator typing does nothing and the input is not focused  | {"typing":{"typed":"","bad":"","typos":0,"done":false,"sentDone":false},"foc":"typer"}      (gate-ui-A-r3.log, gate-ui-B.log)
FAIL K-1 [plan model (lines 15-40)] 10 bots: <=3 KOs in one round in >=95 % AND never >=5  | 97.1 %, 1 matches with >=5      (gate-sim-A/B.log)
FAIL K-1 [real bank lengths (plain r1-3, normal <30, ULTI >=30)] 10 bots: <=3 KOs in one round in >=95 % AND never >=5  | 93.7 %, 8 matches with >=5
```

## 6. Corrections: FAILs that were my harness, not the build

- **gate-proto-A.log `PASS 63 / FAIL 4`** (P-15 200-line boundary, three P-16 lines). Both were my fixtures. My "valid" replacement bank had only 40 lines < 30 chars, and the server correctly logged `lyrics reload REJECTED, keeping the old bank: need >= 150 lines shorter than 30 chars …, have 40` (gate-srv-A-sighup.log). My 200-line mutation also emptied a song (`no lines`). After fixing both fixtures, the section re-ran on the same copy A: `PASS 19 / FAIL 0` (gate-proto-A-p15rerun.log). That is the R1 evidence for P-15/P-16.
- **gate-ui-A.log / -A-r2.log, U-04 / U-05 / U-07 / U-08 / first U-10 line / U-14.**
  - U-04/U-05: my harness tapped the line box in round 1, which *removed* focus (that is bug B5 below), so nothing typed.
  - U-07/U-08/U-10: I read the player's own id from `__tinju.me.id`, which is undefined; the right field is `state.you.id`. That made my first U-08 PASS meaningless.
  - U-14: my first check counted one-shot damage float-ups as "animation".
  - All fixed, then re-run on A (gate-ui-A-r3.log) and run fresh on B. The second U-10 line (focus) failed before and after the fix.
- **P-01 strengthened between runs.** My first P-01 had elapsed order equal to seat order, so an engine that sorts by seat would have passed. I changed the claims so they differ in every round, then re-ran on A and B (`…-p01v2.log`, 20/20 each); the seat mutant now fails 0/20. The earlier P-01 runs (gate-proto-A/B.log) also passed.

## 7. Bugs and findings

**B4 [S2] A KO'd player keeps keyboard focus as a spectator** (blocks U-10)
Product: Tinju Kata 2.0.0 @ `49ad6b8`, `src/main.js` `onLine()`: `if (m.entrant) focusTyper();`. There is no blur for `entrant:false`, so focus from the previous round stays.
Steps: 1. `TK_HP=1 TK_COUNTDOWN_MS=700 PORT=3557 node games/tinju/server/server.js`. 2. Three players (2 desktop, 1 iPhone 12 emulation); round 1: the two desktops finish at 2000 ms (tie), the iPhone at 4000 ms, so the iPhone is KO'd. 3. Round 2: read `document.activeElement` on the iPhone.
Expected (PLAN U-10, brief Must "KO → spectator … can throw emoji"): the input isn't focused, so the phone keyboard doesn't open.
Actual: `G round 2 (KO, spectator): {"focus":"typer","entrant":false,"vh":664,"specbar":[444,544]}`. Typing is ignored (`typed ""`). Tapping an emoji moves focus to the button (`G after tapping an emoji: BUTTON`), so it clears itself after one tap, *if* the emoji bar can be seen past the keyboard.
Evidence: gate-u10-repro.log (`tests/plan-2.0/gate/repro-u10-spectator-focus.mjs`), gate-ui-A-r3/B. Reproduced: yes, 4/4 runs (2 gate runs, A and B; 2 repro runs).
Phone impact is inferred: an open iOS/Android keyboard usually covers more than the bottom 120 px. To confirm in M-07. **Owner:** Wasawho (fix), Pras (waive).

**B5 [S2] Tapping the line while the input already has focus *removes* focus** (not in the blocking list)
`#linebox` `pointerdown` calls `focusTyper()`, but the tap's default action then blurs the input. Only the `focusHint` overlay calls `preventDefault`.
Steps: iPhone 12 emulation, a line is shown and the input is focused (it is, after the reveal); tap `#linebox` repeatedly.
Expected (brief Controls: "tap the line to focus"): focus stays. Actual: it toggles: `after tap #linebox #1: typer` → `#2: BODY` → `#3: typer`; `after tap #line: BODY`; on desktop, `click #linebox -> BODY`.
Evidence: gate-tapblur-repro.log (`repro-tap-blur.mjs`), reproduced on copy A and copy B.
A player who taps the line mid-typing will most likely close their own keyboard in a timed round. Inferred from emulation; M-04 on a real phone confirms it. Not a listed blocking case (U-06 passes, because it never taps). **Stella** decides 2.0.0 or 2.0.1; I recommend fixing it before Stage B. Owner: Wasawho.

**B6 [S3] 320×480 end card: Rematch / Keluar start below the fold**
`winner {"vh":480,"docH":601,"sy":0,"endCard":[394,571,"shown"],"rematch":[471,515,"shown"],…}`, so 9 px of the button is visible. Scrolling 121 px brings it fully into view (gate-endcard-320x480.log). No horizontal overflow (U-02 passes). **Stella** may waive. Owner: Wasawho.

**Doc and harness findings (S3, not blocking):**
- DESIGN.md "Domino" step 6 says "tied non-hitters unchanged". The brief's Ties rule says "A player who hits nobody (tied, last, or unfinished) has their streak reset". The engine follows the brief (`PASS P-21/C1: a tied non-hitter (B) has its streak reset …`). DESIGN.md is stale. Owner: Jiwoo.
- CHANGELOG 2.0.0 "Content" still says `lyrics.txt` is "placeholder content (46 invented songs, 252 lines)". At `49ad6b8` it holds Stella's starter bank: 46 songs, 255 lines (161 < 30, 94 ≥ 30). Owner: Wasawho/Stella.
- Wasawho's `test-proto.mjs` has checks that can't fail: `check('rejoin with a bad token -> rejoin_failed', true)`, `cs[0].closed || true` (oversize frame), `cd !== null || b.state.state === 'line'` (rejoin in countdown), `check('skin change is broadcast', true)`. My gate covers each of these for real (P-22 bad token, P-24 1009, rejoin-in-countdown `diff 0`). Owner: Wasawho.
- Three `server.js` processes from my copies outlived their parents, two of them from `e2e/look.mjs`. A direct SIGTERM test exits fine: idle in 6 ms, with an open room in 2006 ms (gate-sigterm.log, 4/4). So this is a harness teardown leak, cause not found; the server isn't at fault. I killed them. Nothing of mine listens on ≥ 3300.
- Question, not a defect: the brief's Must says "one set per skin × 7 poses". The build ships one drawing in 4 colour swaps (CHANGELOG says so openly). Stella/Pras: does that meet the Must?

## 8. Art, external URLs, console errors

**Boxer art: what I can and can't judge.** No human has seen it, and neither have I: I have no way to view an image. What I measured (gate-art.log): I rendered all 28 combinations (7 SVG poses × 4 palette swaps from `src/art.js`) at 200×200.
- Every one decodes (200×200).
- Coverage is 23.5–30.6 %, except `ko` at 9.9 %, which is rotated −78°, lying down.
- The silhouettes really differ pose to pose: 16–88 % of pixels differ.
- Recolouring changes only colours, not shapes: coverage and bounding boxes are identical per pose across all 4 skins.
- The `ko` source has x-x eyes (two crossed strokes, `M91 69l9 9m0-9l-9 9…`); `ouch` has `><` eyes, as the card asks.
- Two poses touch the edge of the 200×200 viewBox: `jab` reaches x=199 (the glove) and `ko` starts at x=0. They may be cropped; that needs a human eye.
- Screenshots (mine and Wasawho's look run) are dark, mean luminance 39–52/255. About 40–61 % of pixels are near `surface #221f45` and 4–21 % near `bg #14122b`; accent/ink/highlight are each ≤ 2.3 %.

I **cannot** judge: whether the boxers read as astronauts, are appealing, are legible at avatar size, whether the poses read as jab/uppercut/block at a glance, or whether the domino "feels". That is Pras's look at Stage B (M-08), or a person looking at `tests/evidence/look-*.png` / `gate-*.png` before then.

**External URLs.** Searching the served tree (`index.html src assets server shared/server`) for `https?://` finds 7 SVG `xmlns` namespaces and 2 `http://x` URL-parsing bases in `shared/server/{ws,static}.js`. None are requests. In my Playwright runs, `PASS no request left 127.0.0.1 in any page of this run (external URLs)` (A and B).

**Console errors.** My runs: `errors=0` on every page (gate-ui-A-r3, gate-ui-B); Wasawho's UI suite: 134/0 ×2, including its 0-error check.

## 9. Who may waive what

| Item | Status | Who may waive |
|---|---|---|
| U-10 (B4, spectator focus) | FAIL ×2 | **Pras only**, or Wasawho fixes + A-na re-runs |
| K-1 KO clustering | FAIL ×2 (97.1 % / 93.7 %) | **Pras**, pending; listed by Stella as not a build blocker |
| M-01…M-05 on iPhone + Android | Stage B, not run | **Pras only** |
| B5 tap-to-blur (S2, not a listed case) | open | **Stella** (2.0.0 or 2.0.1); recommend fixing before Stage B |
| B6 end card below the fold at 320×480 (S3) | open | **Stella** |
| Doc and harness findings in §7 (S3) | open | **Stella** |
| B2 44 px | waived 2026-10-29 | — |

Non-blocking cases (not in the gate's go decision). Wasawho's suite or mine pass them in both runs: U-05 (trailing space, predictive replace), U-07, U-08, U-09 (title card 850–1300 ms, song matches the line), U-11 (ULTI shake; reduced motion: none), U-12 (`tk_theme` ignored), U-14 (avatar row static), A-01/A-02 (no AudioContext before a tap, also after refresh; 4 hit sounds ≥ 3 sources each, all different), A-03 (pad starts on the first tap), P-06, P-21, K-4, K-5. Not run by me: U-15 under 4× CPU throttle; look.mjs reports frame gaps as informational only.

## 10. Stage B: after deploy (Pras, real iPhone **and** real Android, phone models written down)

- M-01 Autocorrect and prediction **on**: type 5 lines in rounds 1–3 and 4+. No word changed, no capital inserted.
- M-02 Accept a keyboard suggestion mid-line and at the end ("word "): no false red tile, `done` still fires.
- M-03 Keyboard open: both rows of a 40–45-character line and your own HP stay visible; no zoom. Also on the smallest phone at hand.
- M-04 Focus once, play 10 rounds without tapping: the keyboard stays up. **Then tap the line mid-typing once: does the keyboard close? (B5)**
- M-05 Refresh mid-match: no sound until a tap, music after it, back in the same room.
- M-06 ULTI line with capitals, `,` `!` `?` and digits: typeable within 20 s.
- M-07 Get KO'd: spectator view, emoji works, keyboard does **not** stay open (B4).
- M-08 As many players as you can gather: domino readable, avatar row legible, no stutter on an iPhone 12. Look at the boxers (§8).
- M-09 Hit sounds with eyes closed: jab, block, uppercut and KO can be told apart.
- M-10 Lock the phone 25 s mid-match (walkover → spectator), then 10 s (rejoin).
M-01…M-05 block; M-06…M-10 Stella may waive.
