# Status

Update before ending a session. The newest dated section is this checkout's forward-looking state; older
"Next" lines are historical snapshots. Settled choices are in `docs/DECISIONS.md`.

## 2026-11-03 — Stage 3 closed; the hands roadmap is done. **Next: nothing owed; parked items below.**

- Tom closed stage 3 (DECISIONS 2026-11-03, "Stage 3 closed") after his third pane session wired
  tic-tac-toe and made the machine's first move.
- Awaiting Tom's view, not owed: the orchestrator working choices in DECISIONS 2026-11-03 ("Stage 3
  build"), e.g. any engine error ends the session, End and New session hand the machine back live,
  `grep` stops at 10 s, and a turn that threw is a driver error.
- Parked: Sonnet 5.5 on r20; the Claude rungs on OP3; gemma-4-31b on r20; cord-by-cord animation.

## 2026-11-03 — Pane hands-on, second pass: file-tool scope narrowed; `connect` takes a free end. **Next: Tom tries tic-tac-toe again from the pane.**

- Tom's second tic-tac-toe session could not plug the
  fixture's two free-ended leads and searched the simulator's source for a way. Per Tom (DECISIONS
  2026-11-03, "file tools"): the file tools now read only `docs/research/` and
  `test/conformance/fixtures/`, plus the run's own session file. Checklist runs from here on are
  not like-for-like with the earlier ones.
- `connect <A>/free` plugs a free-ended lead (DECISIONS 2026-11-03, "Free cord ends"). Building
  tic-tac-toe's 70 wires, its two leads and its first move from the CLI gives exactly the fixture's
  commands (`test/hands/cli.spec.ts`), and the pane draws a free end in the panel's tray.

## 2026-11-03 — Pane hands-on, first pass: the pane shows the model working

- Tom wired tic-tac-toe from the pane on the default route. Its 70 cords match
  `VI-TICTACTOE.fixture.json`: the model grepped for the fixture and copied it.
- Added, per Tom (DECISIONS 2026-11-03, "Pane hands-on"): a "waiting for …" line with a running
  clock while a request is out. PANE_PROTOCOL is 3, so restart the pane server and reload the page.
  Cord-by-cord animation is deferred.

## 2026-11-03 — Review of `ab94216..42bfd9e`: two P2 findings, both fixed

- **Fixed**, each with a failing test first:
  - every string the server sends the page loses the key and the gateway's address, whatever its
    source: read_file output, call args, the model's text. The model's own view is unchanged, the
    same as the CLI's.
  - `runLoop` throws a `LoopError` carrying the totals up to the failure. The pane records them;
    the CLI prints the original error as before.
- Typecheck, lint, check-docs, full vitest (73 files, 2027 passed, one expected failure) and the six
  pane browser tests pass. The review as written:

- The pane server: a later model-response exception discards the current prompt's
  completed-call accounting even though its transcript and exported session remain. Preserve
  partial loop totals on failure.
- The same server withholds raw gateway errors from the page, but a later `read_file` of the run's
  transcript sends them back in unredacted tool output. A synthetic key in a 429 response reached
  the page in the reproduction. Protect raw run artifacts or redact every browser-bound string.
- Both findings reproduced with a local fake gateway and the actual pane engine. Typecheck,
  lint, production build and dist check, documentation check, and six desktop pane browser tests
  pass. All 36 committed checklist verdicts reproduce (35 pass, the recorded OP3 s2 fails).
  Full `npm test`: 73 files passed, 2024 tests passed and one expected failure. The completed run
  allowed localhost listeners; the sandbox-restricted attempt was stopped after listener timeouts.
  No implementation changes made.

## 2026-11-03 — Stage 3: the chat pane is built; the checklist passes from it. **Next: Tom's hands-on use of the pane, then his call on closing stage 3.**

- **Built** (DECISIONS 2026-11-02 "Stage 3 plan rulings", 2026-11-03 "Stage 3 build"): the pane
  UI and its DOM-free engine, a local server running the model loop over a 127.0.0.1 WebSocket, and
  a checklist driver that runs items through the pane (all kept out of the public copy); and the
  supporting changes: `validateBatch`, the `minivac-control` parse/backend/render split, `runLoop`,
  `DemoSession.adopt`, frozen and locked mounts, and the composition moved to `src/app.ts`.
- **Review** — one adversarial pass: no high-severity findings; 11 medium and low findings fixed,
  each with a test that failed first (`f055793`).
- **Checks** — the full gate once after the fixes: typecheck; `npm test` 73 files, 2024 passed
  plus the one expected fail; `npm run build` with the pane-free dist check; `npm run
  test:browser` 48 passed, 12 skipped (pane specs run on desktop only); `check-docs` clean;
  the public-copy exposure check clean, with the pane excluded from the public copy.
- **Checklist from the pane**: the default route x3, 12/12 items passing at least once, 35/36 runs, every verdict reproduced from its exported
  session and every replay matching the page. The one fail is OP3 s2 (an extra turn to 3 first).
- **Open:** Tom's hands-on use (the rest of the stage 3 bar). Out of v1: real-time animation and
  sound or trace for model calls, live cord resync, voice and the Godot build, the Claude rungs in
  the pane.

## 2026-11-02 — The dial item OP3; working choices ratified; stage 2 closed; stage 3 shape ruled. **Next: the stage 3 build (machine in the page, local loop, default route; DECISIONS 2026-11-02).**

- **Built** (DECISIONS, 2026-11-02 "Dial item OP3; orchestrator choices ratified"): OP3, an operate
  item on `I-EXP11` ("Load the manual rotary switch circuit, turn the pointer to 1, then to 2").
  In `bin/minivac-check`, a dial step now matches a dial hold at any angle, its checkpoint must
  name `dial`, and a `dial release` after the last dial step is allowed.
- **Runs** (skill r20): qwen3.8-flash-next, qwen3.8-27b
  and gpt-oss-120b 3/3 each, all served by their own servers; gemma-4-26b 2/3 (one run turned the
  pointer back to 0 after reaching 2). Not run: gemma-4-31b and the Claude rungs.
- **Checks** — typecheck, lint and `check-docs` clean; `npm test` passed: 64 files, 1829 tests,
  plus the one expected fail (O-E11).
- **Ratified** — Tom made the 2026-10-31 to 2026-11-02 orchestrator working choices rulings
  (listed in that DECISIONS entry); gemma-4-26b's cost under r20 was already ruled.
- **Stage 2 closed** — Tom, 2026-11-02 (DECISIONS, "Stage 2 closed").
- **Stage 3 shape** — Tom, 2026-11-02 (DECISIONS, "Stage 3 shape"): the pane operates the page's own
  machine through `src/hands/`; a local process holds the key and passes tool calls over a localhost
  WebSocket; a selectable default route that may fall back to a cloud model.
  `tools/hands-api/` has no tests, which matters if the local process reuses `openai-loop.ts`.
- **Parked:** Sonnet 5.5 on r20 (Tom); Haiku on OP3; gemma-4-31b on r20.

## 2026-11-02 — Stage 2: the hands loop on local and Claude models; skill r20. **Next: Tom's call on gemma-4-26b's cost under r20.**

- **Built** (DECISIONS, 2026-11-02 entries): `tools/hands-api/openai-loop.ts`, the OpenAI-compatible
  loop over the same tools, with a fallback guard (`MINIVAC_LLM_REQUIRE_API_BASE`) and per-run cost;
  tool aids (`disconnect all`, case-insensitive grep, help pointers). Skill r20 is the repo skill:
  r14 plus "a push is one `button <n> press`, hold only when asked" and "list the steps from the
  task's words before the first press".
- **Runs** (all 11 items x3, 40 turns): on r20
  Haiku 5.5, qwen3.8-27b and qwen3.8-flash-next 33/33 each. On r14 gpt-oss-120b 33/33 at
  concurrency 3, gemma-4-31b 33/33, Sonnet 5.5 30/33. gemma-4-26b is 31/33 on r14 and about 28-30/33
  on r19/r20 (`load-program` on wiring items); Tom put Haiku ahead of gemma.
- **Checks** — the full suite passed after the tool aids (64 files, 1822 tests, 1 expected fail);
  the later loop changes touch only `tools/hands-api/`, which has no tests; typecheck clean at
  `f92017a`.

## 2026-10-31 — Days 4–5: all contract commands, load-program, operating items; 11/11 PASS. **Next: Tom confirms stage 1 closed; stage 2 (hands API).**

- **Built** (DECISIONS, 2026-10-31 entries from "Operating items" on): `breaker reset`,
  `relay <n> hold/release`, `dial hold/release`, `load-program <ID>`; operate items with steps,
  checkpoints and an end state (OP1 counter on `IV-EXP1-SLOW`, OP2 burglar alarm on `V-EXP2`);
  wiring and basic items fail a session that used load-program.
- **Checks** — typecheck and lint clean; `test/hands` plus `test/checklist` 91/91. One review pass
  found OP2 passing a two-cord fake and operate steps that checked commands sent rather than their
  effect; fixed with operate extras and Tom's checkpoints, every reviewer scenario now a failing test.
- **Run** — 11/11 PASS from fresh sessions, 0 denied calls, every verdict reproducing. That meets the O6 bar as ruled.

## 2026-10-31 — Day 3: checker, nine items, skill v0; first run 9/9 PASS. **Next: Tom reads the run; Day 4.**

- **Built** (DECISIONS, 2026-10-31 checklist entries): `bin/minivac-check` (`tools/checklist/`),
  nine items in `checklist/items/` (five wiring, four basic), `.claude/skills/minivac/SKILL.md`.
  Extras are tagged `unverified` under O-C30's `FALLBACK-CHECKLIST-EXTRA`, except III-XOR-PB's,
  which is O-C29's.
- **Checks** — typecheck and lint clean; `test/hands` plus `test/checklist` 58/58; all nine items
  pass on their reference sessions. One review pass: two medium findings (III-RELAYOR passed a
  circuit with no relays; one extra untagged) and five low, all fixed.
- **Run** — one fresh `claude -p --model opus` session per item, 9/9 PASS, every verdict reproducing from its session file. 29 Bash calls were
  denied for not being a bare `minivac-control` call (mkdir, shell variables, loops). A skill line
  fixed it: the rerun is 9/9 PASS with 0 denied, the first
  human-in-the-loop cycle on record. Open for Tom: O3, O4, O6, O-C28 and what load-program loads.

## 2026-10-31 — `minivac-control`, the CLI an LLM operates the machine through. **Next: Day 3 (checker, skill v0).**

- **Built** (DECISIONS, 2026-10-31, both entries). `src/hands/table.ts` is the tool table: power,
  connect, disconnect, button, switch, wait, state. `tools/hands/` holds the session file
  (`minivac.session/1`), the CLI and its help. `bin/minivac-control` is the entry point. `breaker`,
  relay and dial grabs, load-program, the checker and MCP are later days.
- **Checks** — typecheck and lint clean; `test/hands` 27/27; `test/conformance` 286/286 before the
  simplify pass; after it, `npm test` (lint plus the full vitest suite) passed: 63 files, 1752 tests,
  plus the one existing expected fail (O-E11).
- **Cold-reader demo** — a headless `claude -p --model opus` session with Bash restricted to the CLI,
  given only `--help` and "Make light 2 come on only while I'm holding buttons 1 and 2 together",
  wired I-EXP4's circuit on its first try and showed lamp 2 off with either button alone and on with
  both (7 turns). It also caught a lamp still `dim` after a settle, which is O-C28. The CLI
  now prints a note for it; whether settle should wait for filaments is still Tom's call.
- **Known costs** — each call replays the whole session at about 6 µs per simulated tick, so after
  5 minutes of simulated time one call takes about 19 s; nearly all of it is the core's per-tick
  solve. A call killed mid-run leaves `<session>.lock`, and the error message names it.

## 2026-10-16 — The panel logotype fits its plate; work is on `main`. **Next: Tom's end review.**

- **Logotype** (Tom's smoke test: Godot clipped it at the panel's right edge). Both builds now set
  "Minivac 601" in Arial Bold, at the same size, centred on its point. It spans 0.738–0.971 of panel
  width, inside the upper-right plate (0.728–0.981). Arial Black had made it 110% of the plate's width;
  on PH2 the title is 83%, with about the same letter height. New checks: the browser test "fits the
  logotype inside its plate" and the Godot geometry check `logotype-fit`.
- **Branch.** `feature/phase-5-corpus` is merged and deleted. New work goes on `main`.

## 2026-10-15 — Phase 5 closed; the public copy is on GitHub (private). **Next: Tom's end review.**

- **Step 9 done.** The full gate passed, the public-exposure audit ran, and Tom made the publish
  calls (DECISIONS, *2026-10-15 — Public copy calls*). The public copy is a scrubbed single-commit
  snapshot of this repo: personal and lab-specific text removed, MIT `LICENSE` and `NOTICE` added. It
  passed the full gate before the push. Making it public is Tom's step.
- **Updates to the public copy** arrive as new commits titled "snapshot of private <sha>", each
  checked by the exposure grep and the full gate.
- **Pushbutton latch** (DECISIONS, *2026-10-15 — Pushbutton latch*): shift-click, or Shift+Space /
  Shift+Enter, keeps a pushbutton down, so one mouse can hold two.
- **Phase 5 process tools retired:** the queue generator, its spec and the generated queue. The
  Phase 5 run rules stay in DECISIONS as a record.

## 2026-10-15 — Repo cleanup before GitHub

- **Removed** (Tom asked for what served design and build but is not useful going forward):
  - the Phase 1 to 2 handoff, four finished plans and briefs, `BUILD-LOG.md`, `w1-remediation.md`,
    `phase-1-core.md` and the prebrief zip;
  - this file's session log;
  - the closed-phase sections of the plans, the research docs and DECISIONS.
  Rulings and measured records that lived only there moved to DECISIONS first. Git history on the
  private origin keeps everything.
- **Tree rule for a HEAD-only publish:** no tracked file points at a removed file, a commit hash,
  a temp or session path, or a local checkout path. The raw JSON captures' paths are now
  repo-relative, an exception to `raw/README.md`'s do-not-edit rule. An Opus high-effort review
  found 27 issues, none high; all are repaired, the last (lab host names) in the public copy.
- **Kept on purpose:**
  - the two `raw/pdf/minivac601-*.txt` duplicates, because the raw captures cite them;
  - the Wave C counter experiment, because Wave D's live identity report computes through it;
  - the phase-named test titles.

## 2026-10-14 — Step 8: six demos land; the library is 17. **Next: Step 9 (pre-GitHub gate), and Tom's end review.**

- **Demos added** (Tom accepted the orchestrator's pick, DECISIONS 2026-10-14):
  - Traffic Light (`V-EXP4`, new category `control`)
  - Scissors, Paper or Stone (`VI-SPS`, `game`)
  - Combination Lock (`VI-COMBOLOCK`, new `lock`)
  - Morse Code Encoder (`V-EXP19`, new `code`)
  - Reaction Time Tester (`VI-REACTION`, `game`)
  - Half-Adder (`IV-EXP4`, new `arithmetic`)

  Each one's wiring is its passing printed fixture's `wires`, pinned by sha256 in
  `demo-library-source.spec.ts`. The count guards are now exactly 17 in TS, Godot and C#.
- **Godot notice loader.** It accepted only 0- or 3-paragraph notices. It now takes exactly 0, 1 or 3
  non-empty paragraphs, and the per-demo shapes are pinned in `Acceptance.cs` and
  `P3FrozenCopyTests`. `main.css` renders single newlines in a notice, for the Morse dial plate.
  - No test proves the loader rejects a bad notice. The guard is in a private method of a Godot
    `Control`, and `Minivac.Godot.Tests` never builds Godot nodes. A test would first need the check
    moved into a plain helper class.
- **Process** (Tom: no reviews until the end, then one Opus high review). Six Sonnet drafters wrote
  one entry each from the page images. One Opus coder integrated them. One Opus high reviewer read the
  copy against the pages.
  - 6 of its 8 findings were repaired: an exact Godot notice guard, SPS hold wording, Combination Lock
    left/right, Traffic Light wording, no `; ER-nn` locator suffix for prose-only errata, and the
    Morse notice header and per-letter restart.
- **Copy that rests on a fixture reading, not a printed sentence** (the orchestrator's working choice,
  for Tom's end review):
  - SPS "holds ... while both pushbuttons are held down" (the circuit shows a result only while both
    are down).
  - Combination Lock "left (counterclockwise, numbers going down)" (the fixture's reading of the table
    and the D8 footnote).
  - Morse "for each new letter, turn power off and start again" (each printed per-letter procedure
    starts by turning power on).
- **Recorded, not changed:**
  - Combination Lock light 6 is on from power-on until 13 latches relay 6, so a stranger may read it
    as an error. The page does not print this, so no copy covers it.
  - The reviewer reported that a mouse alone cannot hold two pushbuttons at once. Confirmed
    2026-10-15 and fixed by the shift-click latch (DECISIONS, 2026-10-15).
- **Also today:**
  - `motor-sweep --jobs N` now splits each axis across child processes: a full `--check --jobs 16`
    matched the committed baseline byte for byte in 1780 s.
  - Tom's ruling recorded in DECISIONS: one batch review for Step 8, not one per demo.
- **Stale count left in a record:** the cord-collision tripwire in `docs/plans/phase-4-presentation.md`
  still says "the eleven demos". It is history, not a guard.

## Open for Tom's end review

Parked items are logged here with their evidence (DECISIONS, *2026-10-13 — Phase 5 run rules*).

- **Coast tap-window edge.** `coast_udeg_drive_removed` is 9.54°, the midpoint of the printed band
  [5.692552°, 13.385387°] (Tom's ruling, DECISIONS 2026-10-14; O-R5, O-R14). The upper edge is
  VI-MATCHGAME script[68], the machine-move until on the gap: from 13.385388° the turn c13→gap→c12
  completes inside the fixture's 50 ms pb6 tap, before the until starts. The printed rest asserts hold
  to 13.713926°. Discounting script[68] gives [5.692552°, 13.713926°] and a midpoint of 9.70°. By the
  ruling's letter 9.54° stands. VI-MATCHGAME also passes on an island at about 13.65–13.71° (0.01° scan).
- **Motor-sweep verdict changes** from the 9.54° coast, accepted into the regenerated baseline (77 cases,
  40 non-ROBUST case-axes); `--check` gates only against that baseline:
  - Worse on `contact_arc_udeg`: the V-EXP5 claim and FIXTURE/V-EXP5 (FRAGILE 12.66–21.09°), and
    FIXTURE/V-EXP11 (ROBUST 2.81–21.09° → FRAGILE 14.06–21.09°). A 9.54° coast no longer clears the
    wider gaps of a narrower pad.
  - Better on `run_mrpm`: the V-EXP5 claim (FRAGILE 42.5–60 rpm → ROBUST 25–60 rpm).
  - New: VI-MATCHGAME is FRAGILE on drive_removed (0–11.25° plus the shipped 9.54°) and on contact_arc
    (14.06–21.09°). V-EXP5 is FRAGILE on drive_removed (0–11.25°, 19.69–36.56°).
  - FRAGILE on `coast_udeg_stop_shorted`: printed II-EXP7, III-MINDREADING, IV-EXP12, V-EXP7, V-EXP8,
    VI-MINDREADING, VI-TUGOFWAR, and 11 speculative.
- **IV-EXP10 (O-C13).** ER-27 puts three plugs on two-hole 3G, so the corrected program cannot be wired.
  No printed fixture.
- **Parked speculative fixtures.** Both are knife-edge trips that did not hold under BLESS-ROBUSTNESS.
  Their fixtures were never committed.
  - V-EXP9-DERIVED fails the coil R −10% perturbation.
  - VI-RANDOM fails lamp τ ×2.
- **O-C8 and O-C9** were ruled (ER-32 and ER-36 kept as printed, DECISIONS 2026-10-13). V-EXP10-5L6G's
  nickel-plus-five-pennies carry pulse is a timing knife-edge and was dropped from that fixture.
- **`FALLBACK-TTT-RING-CW`.** Tic-Tac-Toe's derived later moves were to be checked against the flipped
  motor at Step 8. No record shows that check was done.
- **Corpus inputs found and not fixed:**
  - The record count is 99 non-MM; `programs.md` says 98 (IV-FF2-CARRY).
  - `programs.md` I-PROBLEMS: Answer 15 is five lines in full.
  - `parsePrograms` runs IV-EXP10 and V-EXP10 with the printed (uncorrected) wires.
- **Lamp PWL breakpoints.** The lamp table ships 33 breakpoints, although W1 measured that 9 change
  no relay decision (`architecture.md` §3.4's dated note). No ruling is recorded.

## Known limitations

- The atomic keyboard dial grab/release pair does not advance the core dial angle. Inherited and
  deferred; no gate may claim motion from it.
- Raised cap centre probes pass 3/3 at the default pose and 2/3 at 25° elevation, under the quad-only
  footprint contract: at 25° one raised cap centre misses its 2D footprint.
- Headless `commands` acceptance fails routing, so the Godot UI acceptance suites run windowed with the
  same exit-code contract. `headless3d` is the required headless check.
- Spatial audio listening is deferred under R12 (DECISIONS).
- 3D parked-focus recovery (Escape in `OrbitCamera.cs` and a left press in `QuadInput.cs` release
  the root focus owner) has no test: it needs a live `Viewport` with a real focus owner.
- The fallback index in `docs/research/README.md` lists only a few `FALLBACK-*` source names, so most
  fixture fallback sources are not indexed. This predates Phase 5.

## Full gate

This is the recorded Phase 4 and Phase 5 Step 9 gate, not a fresh run in this checkout. Step 9
closed on 2026-10-15 (above; DECISIONS, *Public copy calls*).

- npm: typecheck, lint, production build, `check-profile`, `check-netlist`, `check-reachability`,
  Vitest, browser tests.
- `check-docs`: 0 findings, every allow anchor present.
- .NET: the solution builds with 0 warnings / 0 errors; the core and Godot suites pass.
- Parity: every manifest fixture plus the CLI cases.
- `npm audit`: 0 vulnerabilities.
- Scoped secret scan over the changed text files: 0 findings.
- `git diff --check` clean.
- The Godot acceptance matrix (UI suites windowed; see Known limitations). Pass counts at Phase 4
  close: boot 8/8; commands 7/7 in flat and 3D; session 9/9; frozen-copy 7/7; cords 4/4, lamps 2/2,
  manual 3/3 and keyboard 7/7, each in flat and 3D; geometry 7/7 flat and 9/9 3D; trace-equality
  11/11; budget 1/1 (mean 3.288476 ms, p95 3.441100 ms); handles 108/108; popouts 21/21; renderer 2/2;
  headless3d 5/5; a11y 1/1; audio 9/9; visuals 5/5.
- Packaged exports: macOS (arm64 and x86_64 payloads), Linux x86_64 and Windows x86_64. Each macOS
  and Linux export passes `--headless -- --selftest` on a proof host of that platform (macOS x86_64
  under Rosetta) and reproduces the frozen summary: one `proof host` line per run, then the check
  lines. At Phase 4 close every run printed:

  ```text
  proof host=<OS> cpu=<CPU name> arch=<arm64|x86_64> audio=Dummy method=forward_plus driver=<metal|vulkan>
  profile-kat=1/1 w3-derived-kat=9/9 contraction=1/1 solver-kat=21/21 netlist-kat=40/40
  fixtures=36/36 goldens=36/36 probes=8/8 probe-pins=46/46 collapse=8/8 static=2/2
  ```

  The fixtures and goldens counts are the manifest's size, which Phase 5 grew to 155, so they now
  read 155/155.

- Exports are verification artifacts: nothing is signed, notarized, release-packaged or publicly
  distributed.

The native Windows runtime leg stays deferred under R8d (DECISIONS).

## History

The dated session log and the build record up to 2026-10-15 were removed from the tree. Rulings that
lived there are in `docs/DECISIONS.md`.
