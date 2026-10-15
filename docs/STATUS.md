# Status

Update before ending a session. Forward-looking state only; settled choices are in `docs/DECISIONS.md`.

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

Phase 5 Step 9 runs this list, the gate Phase 4 closed green on.

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
