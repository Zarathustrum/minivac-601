# Phase 5 — full corpus conformance

Approved by Tom, 2026-10-13, including decisions D1–D4. Forward state lives in `docs/STATUS.md`. Phase 5 closed 2026-10-15 (DECISIONS, *Public copy calls*).

## Context

The manuals hold 101 program records: 98 from Books I–VI and the errata, plus 3 Maintenance Manual checks. 35 have fixtures (36 files), and 11 are demos. Tom wants every program in and checked before a GitHub release.

Ground rules (Tom, 2026-10-13):
- Only printed answers count as verification. Everything else is tested as **speculative**.
- Motor programs test the timing model. That is their job.
- Work goes most-likely-broken first, in batches: smoke, rank, fix, re-smoke, re-rank.

Corpus census (Explore pass, this session):
- PRINTED yes 34 / partial 56 / no 11. Tiers: A 36, B 22, C1 4, C2 29, D 9. Motor 31.
- 4 programs need a free (loose) cord end.
- 5 programs need the operator to push a relay by hand (`relayGrab`, Contract 1.1).
- 15 programs have a printed answer and no fixture.
- Not standalone: VI-SEQREC is a sub-circuit, I-PROBLEMS is a problem set, IV-SELFHOLD is a fragment.
- Delta-only entries (wired as changes to another program): IV-EXP2/3/7/9, VI-RANDOM.
- Suspect lists:
  - II-EXP1 looks one wire short (no `5F/5-`).
  - IV-EXP10 has 56 wires printed, 57 after correction.

Harness facts this plan relies on:
- Each expect step carries a provenance pair, `tag` + `source: FALLBACK-*`. That pair is the only marker of a derived expectation.
- 7 existing fixtures have no printed expectation at all: III-RELAYXOR, V-EXP1, ER-ALTCOUNTER, IV-EXP1-FAST, I-EXP12/13/14. The other 29 are printed.
- Several printed fixtures assert observables their quote does not state: I-EXP6, I-EXP7, I-EXP8-STEP5[4], I-EXP11[9,12], MM-RLY-CHECK. That breaks `programs.md` §2's fixture definition ("every observable the printed page names, **and no others**").
- The inventory is hardcoded in about 10 places, and 36 is asserted throughout:
  - `tools/parity.ts:61`
  - `tier-*-golden.spec.ts` listings
  - `tier-a-fixture-source.spec.ts:259`
  - C# `ArtifactSourceTests.cs:33-39`, `G3TraceCliSliceTests.cs:14-22`, `G3FixtureClassifierSliceTests.cs:217-226`
  - Godot `SelfTest.cs:36-50,154-158`
- `bless.ts` writes goldens by the fixture's `tier` field. Parity, C# and Godot find goldens by directory. TS probes resolve fixtures only in `fixtures/A`.
- The C2 schema **forbids expect steps** (`fixture.schema.json:75-97`). No motor program can assert a printed answer today.
- The core already supports free and touch cord ends (`contract.ts:20-28`) and hand relay control. No input gap blocks the corpus.
- Profile overrides already work: copy the raw JSON, change `.v`, run `loadProfile` (pattern at `tools/check-profile.ts:2463`). `runLoadedFixture` accepts a substituted profile.
- No existing check runs every program headless. Shorts surface as `breakerTripped` (`devices.ts:246`).

## Why a manifest, not a directory

A separate directory for speculative fixtures was the first proposal. It is wrong for this harness:
- Moving files splits golden paths (bless goes by tier, the ports go by directory).
- It breaks TS probe resolution and Godot's hardcoded paths.

The split is a **manifest field** instead. Files stay where they are.

## Decisions (approved with the plan, 2026-10-13)

- **D1 — Motor fixtures can assert printed answers.** Allow expect steps in C2. Add one script step, `{k:"until", obs, maxMs}`: advance tick by tick until every listed observable matches, and fail at `maxMs`. Expectations then key off dial position, not milliseconds from an invented speed.
  - This is an additive change to the fixture schema. It needs TS and C# implementations, and the C# schema hash pin (`ArtifactSourceTests.cs:16`) gets updated.
  - Existing goldens must stay byte-identical.
- **D2 — Unstated observables are removed, not tagged.** The golden trace still records every transition, so no regression coverage is lost. This re-blesses the affected goldens: `?` lines change, nothing else.
- **D3 — Book VII is out of scope.** It is a joint 601/6010 document (N-11), and capacitors need Contract 1.2.
- **D4 — Batches of 5 programs.** That is about 12–15 agents per workflow, slightly over the session's 10-agent guideline.

## Model and effort map (project policy, Claude mapping)

| Role | Model | Effort |
|---|---|---|
| Orchestrator: integration, core fixes, bless, commits | Opus (this seat) | xhigh |
| Tool and wiring workers: manifest, extractor, smoke, sweep | Sonnet | medium |
| Edit applier, manifest/queue regeneration | Sonnet | low |
| Fixture author, simple | Sonnet | medium |
| Fixture author, complex: motor, >40 wires, delta, free wire, manual relay | Opus | high |
| Failure triage, C# port of core fixes, motor spec author, speculative derivation | Opus | high |
| Every adversarial reviewer (fixture vs page image, core fix, tool) | Opus | xhigh |

Workers never commit, stash, or push. Every `agent()` call passes `model` and `effort` explicitly. The orchestrator owns `package.json`, the manifest, goldens and `src/core/`.

## Steps

### Step 1 — Printed/speculative split *(starts on approval)*

**1a. Manifest** — `test/conformance/fixtures/manifest.json`. It sits inside `fixtures/` so `sync-data` mirrors it to Godot. Each entry: `{path:"A/I-EXP1", suite:"printed"|"speculative", sha256}`.
- **Rule, enforced by a new `test/conformance/suites.spec.ts`:**
  - A fixture is `printed` if it has at least one untagged expect step. Otherwise it is `speculative`, which includes digest-only C2.
  - The manifest must equal the recursive `**/*.fixture.json` glob.
  - Every sha must match.
- **Replace the hardcoded inventories with manifest reads:**
  - TS: `parity.ts`, the four `tier-*-golden.spec.ts` / `maintenance-golden.spec.ts` / `counter-golden.spec.ts` listings, and the 18-ID count in `tier-a-fixture-source.spec.ts`.
  - C#: the three count tests above, plus a small manifest reader in `Minivac.Conformance`.
  - Godot: `SelfTest.cs` builds its fixture list from the manifest. The summary string format is unchanged.
  - Per-fixture content guards in the existing `*-fixture-source.spec.ts` files stay as they are.
- **Labels:** golden spec `describe` titles carry `[printed]` or `[speculative]`. New scripts: `npm run test:printed` and `npm run test:speculative`, both vitest `-t` filters.
- **Workflow `p5-s1-manifest`:**
  1. I write the manifest first, so both sides code against the same format.
  2. In parallel: a TS wiring worker (Sonnet medium) and a C#/Godot wiring worker (Sonnet medium). Their file sets don't overlap.
  3. Then one adversarial reviewer (Opus xhigh). Its brief: does any guard get weaker than the hardcoded list it replaces?

**1b. Unstated-observable audit** — runs read-only alongside 1a. Edits wait until 1a lands.
- **Workflow `p5-s1-audit`:** pipeline over the 29 printed fixtures, in 6 groups.
  - Auditor (Opus high): for each expect obs, is it stated by the page? It checks the quote and the page image under `docs/research/raw/pdf/pages/` (generated locally and not tracked; `docs/research/METHOD.md` gives the command).
  - Each finding goes to a refuter (Opus xhigh). An observable counts as stated only with verbatim page text; without it, the removal stands. (Tightened at execution from "default to stated when uncertain"; orchestrator's choice, not Tom's.)
- I apply the surviving removals.
  - If removing an observable empties a step, the step is removed. Shifted script indices get fixed in the probes (AT-07 uses I-EXP7, AT-11 uses I-EXP8-STEP5) and in the source-spec projections.
  - Re-bless. The golden diff must show only `?` lines.
- **Commits:** `[Conformance]: fixture manifest and printed/speculative suites`, then `[Conformance]: drop observables the page does not state`.

### Step 2 — Motor isolation spec, plus D1

- **`test/motor.spec.ts`**, at Machine level (`rotary.spec.ts` is unit level). Assertions are qualitative only: signs, orderings, ratios above 1. No invented numbers. Each cites its page:
  - The seven drive conditions (`rotary.md` §3.2).
  - RUN polarity sets direction.
  - STOP wins over RUN.
  - A STOP short does not trip the breaker (Book I p.22).
  - Power across STOP runs faster than RUN (Maintenance Manual p.9).
  - Under the motor, every pad edge comes in travel order, break-before-make.
  - Answers 14 and 15 (Book I p.31).
  - The two tests `rotary.md` §7 names: elevator hang between D6 and D7, and the combination-lock D8 trap.
- **D1 implementation:** `until` step and C2 expects, in the schema, `run.ts`, the C# runner, and the trace format line. Existing 36 goldens must be byte-identical.
- **Workflow `p5-s2-motor`:** two parallel lanes.
  1. Spec author (Opus high), then reviewer (Opus xhigh). The reviewer's brief: does every assertion trace to a printed claim?
  2. D1-TS (Opus high), then D1-C# (Opus high), then reviewer (Opus xhigh).

### Step 3 — Sensitivity sweep tool

`tools/motor-sweep.ts` (`npm run motor-sweep`).
- **Axes:**
  - `run_mrpm` 25–60 rpm. The sources bracket it: Book II implies under ~34 rpm, Book V uses 45.
  - `contact_arc_udeg` across its valid open interval.
  - `coast_udeg_*` from 0 to 2 pitches.
- **Mechanics:** each grid point loads a re-validated profile. Pass means printed expects plus `until` steps succeed. Digests are ignored.
- **Output:** `docs/research/motor-sensitivity.md`. It gives each program's pass band per axis. **FRAGILE** means the shipped value is within one grid step of a band edge, or the band covers less than half the axis.
- **Built by** Sonnet medium after D1-TS lands, then an Opus xhigh review. It is a gate in every motor batch from then on.
- **Kill rule** (DECISIONS 2026-08-30 history): no profile constant is ever tuned to make a fixture pass.

### Step 4 — Corpus extraction and smoke

- **`tools/extract-corpus.ts`** reads `programs.md` §4 into `test/conformance/corpus/programs.json`. Each entry holds: id, tier, printed and corrected wires, errata, flags (motor, free-wire, manual-relay, delta-of), and PRINTED class.
  - Deterministic checks:
    - The corrected count must equal the header count.
    - Every terminal must be valid in `data/netlist.json`.
  - Mismatches are reported, never auto-fixed (II-EXP1, IV-EXP10 expected).
  - Delta entries are marked, then resolved by hand in their batch.
- **`tools/corpus-smoke.ts`** runs each program:
  1. Wire it, power on, settle (500 ms cap).
  2. Press and release each pushbutton it uses, and toggle each slide switch.
  3. Record breaker trips, chatter, no-settle (expected for motor programs), and dial motion.
  - Output: `docs/research/corpus-smoke.md` plus JSON.
- **Workflow `p5-s4-smoke`:** extractor worker (Sonnet medium), then smoke worker (Sonnet medium), then reviewer (Opus xhigh). The reviewer spot-checks 12 extracted entries against `programs.md` and audits the classification logic.

**Parallelism:** Steps 2 and 4 run as concurrent workflows once Step 1 lands. Step 3 starts when D1-TS lands. File ownership doesn't overlap, and the orchestrator adds the npm scripts.

### Step 5 — Rank *(orchestrator, deterministic)*

- **Score:**
  - smoke failure +5, motor +3, free-wire or manual-relay +2, wires >40 +2
  - +1 per erratum, +1 if `[likely]`/`[unverified]`
- **Queues:**
  - Printed queue: PRINTED yes and partial (the printed steps only).
  - Speculative queue: PRINTED no, plus the derived parts of partial programs.
  - Non-standalone entries ride with their dependents. I-PROBLEMS contributes only its verified Answers 13–15.
- **Output:** a queue doc in batches of 5, regenerated after every batch. The generator and the queue were retired when Phase 5 closed.

### Step 6 — Printed batches *(one workflow per batch: `p5-batch-NN`)*

Each program runs this pipeline, with no barrier between programs:
1. **Author** (Sonnet medium, or Opus high if complex). Writes one fixture file:
   - corrected wires, `as_printed`, `errata_applied`
   - script from the printed procedure, press and release separate for tier B
   - expects only from printed text, with a verbatim quote and a cite
   - Runs schema validation and `bin/minivac-trace`.
2. **Fidelity review** (Opus xhigh), checked against the page image, refuted by default. It checks wires, the errata application, that every observable is stated, that the quote is verbatim, the step order, and the cite. It returns exact edits.
3. **Apply** (Sonnet low). Applies the edits and re-runs. After 2 rounds without convergence, it escalates.
4. **Triage**, failing fixtures only (Opus high). Classifies the failure: transcription, simulator, manual defect, source gap, or unsupported input. Produces a minimal repro. No core edits.

Then the orchestrator works serially:
1. Add the reviewed passing fixtures to the manifest and bless them.
2. **Core fixes, one at a time.** The fixture is the failing test.
   - Fix the TS core, then the C# port (Opus high).
   - Gate: full TS suite, dotnet tests, parity.
   - Review (Opus xhigh). Its lens: is this a source-backed fix or curve-fitting?
   - One `[Core]` commit per fix.
3. Re-smoke, re-rank, update `docs/STATUS.md`.
4. One `[Conformance]` commit per batch.

**Stop rules:**
- A manual defect or source gap goes in `open-questions.md`. The offending step is dropped from the printed fixture. It never enters the fix queue.
- These stop and go to Tom:
  - a fix that flips any existing printed `?` outcome
  - a fix that touches a profile constant
  - two failed attempts at one fix
- Motor batches add a sweep run. FRAGILE results are reported, not fixed.

### Step 7 — Speculative queue

For each program:
1. Two blind derivations (Opus high, each) of expected behaviour from topology and the stated rule.
2. If they agree, the program becomes a speculative fixture: every expect is tagged `FALLBACK-DERIVED-TOPOLOGY`, with one `open-questions.md` entry.
3. If they disagree, an adjudicator (Opus xhigh) decides or drops it.

Tier D games get smoke plus their stated invariant only. For Tic-Tac-Toe that is "move 5 to the right".

### Step 8 — Demos

Tom picks which programs become demos once fixtures are green. Per demo:
- demo-library entry and labels
- `sync-data`
- Godot parity
- browser acceptance

Done by Sonnet medium per demo, then one Opus high review over the whole batch (Tom, 2026-10-14; `docs/DECISIONS.md`).

### Step 9 — Pre-GitHub gate

1. Run the full gate list in `docs/STATUS.md`, *Full gate*, including the Godot `--headless -- --selftest` matrix.
2. Public-exposure audit (Opus xhigh). It checks history and docs for lab hostnames, IPs, local paths and personal material.
3. Tom's call:
   - keep the history or publish a fresh squashed repo
   - which GitHub target
   - approval to push

## Verification — Step 1

- `npm run typecheck`
- Full `npm test`. Reason: shared test infrastructure changed.
- `npm run test:printed` shows 29 fixtures, `test:speculative` shows 7. These drop if the 1b audit empties any fixture.
- `dotnet build -c Release` and `dotnet test`.
- `npm run parity`: still 36 fixtures plus 5 CLI cases.
- `npm run sync-data`, then `DataIdentityTests`.
- Godot `--headless -- --selftest` still prints `fixtures=36/36 goldens=36/36`.
- Negative checks, each reverted after:
  1. A stray fixture file not in the manifest must fail `suites.spec`.
  2. Tagging the only untagged step of a printed fixture must fail the classification check.
  3. A one-byte fixture edit must fail the sha check.
- After 1b: the golden diff contains only `?` lines, and the probes still pass.
- Then: `docs/STATUS.md` entry, `docs/DECISIONS.md` entry for D1–D4, and commits per Step 1.
