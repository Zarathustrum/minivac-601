# Phase 4 — tactile and 3D presentation on the Godot build

Status: Phase 4 is complete (S1–S4), with the native Windows runtime leg deferred under R8d;
`docs/STATUS.md` carries current state. Tom's Phase 4 rulings are recorded in `docs/DECISIONS.md`
(*2026-09-04 — Phase 4*). What remains here is the design: §1.4's contract rulings, §2's
architecture, and the appendices the code and tests cite. Gate numbers (`gate 3.2.n`), wave steps
and checks (`P0 step n`, `P0 check n`) and risk numbers below are labels from this plan's
acceptance-gate, build-wave and risk sections, which were removed once Phase 4 closed; the tests
named in §2.1 and Appendix E implement the gates.

Binding inputs, in precedence order: the shipped code and the blessed conformance artifacts;
`docs/DECISIONS.md` (the 2026-09-03 entry governs Phase 3's fences and the Phase 4 deferral, and
the 2026-09-04 Phase 4 entry governs this plan); `docs/plans/architecture.md` §13.6, then its
§§1–13; the conformance artifacts under `test/conformance/` and `data/kat/`;
`docs/plans/phase-3-godot.md` — §2.6 and Appendix C carry forward **by reference and
unamended**, and this plan adds to them rather than rewriting them. **Three amendments are made,
each under a ruling and each recorded as one:** Appendix D's *Redraw and simulation limits* row
under R9 (Appendix D of this plan); gate 3.2.9's split into 9a/9b at P4, which amended a gate list
since removed; and §2.2's five-file composition-root list, which gains `Acceptance.cs` under R16
(§2.2, PR-7). Then: this plan;
`docs/plans/phase-2-console.md` as the parity reference; `docs/research/` for every physical
claim. Where prose and shipped code disagree, the code the goldens were blessed against governs
(`docs/DECISIONS.md`, *Precedence when architecture prose and shipped code disagree*).

Nothing here re-opens a ruling in `DECISIONS.md`. The frozen strings are named so a reader can
check by grep: Contract `1.1.0`; `minivac.fixture/1`; `minivac.probe/1`; `minivac.netlist/1`;
`minivac.profile/1`; the golden trace header `#!mv601-trace 1`; the netlist hash
`2354ceebf3f8c566`; the `MV601-REF-A` profile hash `e25b2257499508da`. No byte of `src/core/**`,
`dotnet/Minivac.Core/**`, `data/netlist.json`, `data/profiles/`, `data/kat/`, the fixtures, the
goldens or the probes changes in any wave. The **only** change under `src/` that Phase 4 may make
is the Appendix D public-copy amendment under ruling R9 (§7 of this plan's Appendix D).
Additions under `tools/` are allowed.

---

## 1. Scope

### 1.4 Contract, schema and data rulings

- **Core frozen**, with the frozen strings named in the header.
- **The only `src/` change is the Appendix D amendment under R9** — the two limits paragraphs, plus
  a fifth credits **entry** if R10 or R14 ships an asset. The four existing credit description
  sentences are not touched. `src/ui/help-credits.ts`
  145–156 carries the two *Redraw and simulation limits* paragraphs. They are Appendix D frozen
  copy, byte-identical in the Godot build and pinned there by a literal-string test. Phase 4's
  glow, case, knob, cord and audio work all change what those paragraphs must say. R9 authorizes
  the edit; Appendix D of this plan carries the current text and the proposed replacement verbatim;
  and the edit lands in one commit that touches
  **five places** — `src/ui/help-credits.ts`, the Godot literal pins, `test/help-credits.spec.ts`
  179–186, `test/browser/help.browser.ts` **47–55** and `phase-3-godot.md` Appendix D's cited range.
  **Only `test/help-credits.spec.ts` would otherwise land `npm test` red**: it asserts both
  paragraphs with `.toBe(...)` on the exact strings. `npm test` is `vitest run` over
  `test/**/*.spec.ts`, `src/**/*.spec.ts` and `tools/**/*.spec.ts` (`package.json` 16,
  `vite.config.ts` 8) and does **not** run the Playwright suite, which is `npm run test:browser`
  over `test/browser/**/*.browser.ts` (`package.json` 17, `playwright.config.ts` 10–11); and
  `help.browser.ts`'s three `toContainText` fragments happen to survive the append-only
  replacement. It is updated in the same commit anyway, so the disclosure text is not asserted in
  two shapes. If
  R9 is **no**, then no bloom, no new sound layer and no new chosen-token disclosure ships, and the
  plan stops at S3.
- **`tools/` additions are allowed**; `tools/export-proof.ts` and its
  `tools/export-proof.spec.ts` companion are the only ones, and production code uses node builtins
  only.
- **No `data/` JSON is added.** `TactileTheme.cs` is code (§2.6, Appendix H). `data/public-assets.json`
  changes only if R10 is **yes** (new audio samples), and then through the existing schema and the
  existing `npm run sync-data`, which is otherwise untouched.
- **`godot/data/**` is never hand-edited.** It is written only by `npm run sync-data`, and `Boot.cs`
  refuses to start, naming both hashes, if the loaded netlist hash is not `2354ceebf3f8c566`.
- **Presentation constants never enter a profile.** `profile.ts` rejects an unknown key; profiles are
  the physics knob. A glow threshold or a cord slack is a theme token.
- **Duplicate object keys stay an acceptance rule**, unchanged.

---

## 2. Architecture

### 2.1 Layout

`phase-3-godot.md` §2.1's tree, extended. Only additions are shown; everything else is unchanged.

```
dotnet/
  Minivac.Godot.Tests/
    G4FrameSessionTraceTests.cs     (exists)
    GodotBoundaryTests.cs           P0 — the Godot-side source scan; Appendix A is its data
    LiteralExtractor.cs             P2 — the inverse of CorePurityTests' masker; literal spans with
                                    source offsets; consumed by StatusStringTests and
                                    P3FrozenCopyTests
    StatusStringTests.cs            P2 — 14 status literals over 13 sites + the hint
    P2CommandTableTests.cs          P2 — Appendix C through a spy Apply (gate 3.2.2)
    P2HoleTableTests.cs             P2 — the 392-hole identity table
    P2CordTransactionTests.cs       P2 — the five ReplaceCordEndpoint outcomes, over CordModel.cs
    P3AudioRouterTests.cs           P3 — burst anchoring, drop-vs-retry, motor coalescing, over
                                    AudioSchedule.cs (engine-free), NOT over AudioRouter.cs
    P3FrozenCopyTests.cs            P3 — Appendix D byte pins
    P4QuadMapTests.cs               P4 — QuadMap as pure math; the forwarding gate 3.2.15
    P4OrbitMathTests.cs             P4 — OrbitMath + QuadMap + PanelLayout.HoleRect; gate 3.2.9b,
                                    which also solves and prints the two wire-pose tokens
    P4Stage3DLifecycleTests.cs       P7 review repair — source guard for restoring root viewport
                                    picking after Stage3D detaches or exits
    P5CordLayTests.cs               P5 — CordLay determinism, containment, lifecycle
    TactileThemeTests.cs            P4 — token tags, sources, O-P/PR rows, the no-unit scan, the
                                    numeric-literal scan; gate 3.2.21 runs from P4, so the harness
                                    is written in P4 with TactileTheme.cs, not in P6
    P6AssetProvenanceTests.cs       P6 — data/public-assets.json records for any new asset
godot/
  project.godot                     [rendering]'s renderer keys moved off gl_compatibility (P0 —
                                    an edit of two existing values, not a new section; the
                                    [rendering] block already exists), + [input] actions for the
                                    3D shell (P4); no project-wide hdr_2d key
  export_presets.cfg                + [preset.1] Windows Desktop, + [preset.2] Linux (P0)
  scenes/Main.tscn                  unchanged: the ONLY scene file; every node below is built in
                                    code by Boot._Ready, as it is at HEAD (ruling R13)
  scripts/
    Boot.cs                         P0 — ONE added line on the windowed path: the renderer
                                    method/driver print (P0 check 1).
                                    P2 — the two-branch --acceptance dispatch of §2.9, inside the
                                    existing try/catch, which is otherwise unchanged; AND the one
                                    named edit R16 authorizes: `private void Start` ->
                                    `internal void Start` (line 39), with Start's body from the
                                    version pin to LoadDemo extracted verbatim into
                                    `internal void BuildConsole(...)` so Boot and Acceptance share
                                    ONE composition body (§2.9). `Refuse` stays private — nothing
                                    outside Boot calls it. No other change; no statement of the
                                    extracted body is altered.
    SelfTest.cs                     P0 — ONE added line: the §2.10 proof line at the start of Run.
                                    P2 — ONE added line: the node-inventory line before `return 0`
                                    (§2.9, gate 3.2.12). The count set itself never moves.
    Acceptance.cs                   P2 — composition-root tier under ruling R16; a Node instanced
                                    by Boot only under --acceptance. Builds the tree Start() builds
                                    through Session's engine-free mount-delegate constructor, with
                                    no Loop node (§2.9); runs one named suite, prints PASS/FAIL,
                                    and calls GetTree().Quit(0/1/2)
    Preferences.cs                  P2 — user://minivac.cfg: audio/muted, help/seen,
                                    motion/reduce, view/mode
    Chrome.cs                       P2 — CanvasLayer holding toolbar, drawer, demo experience,
                                    cord list, picker, diagnostics, Help/Credits, in BOTH views
    Commands.cs                     P2 — ENGINE-FREE: the Appendix C command constructors, the
                                    switch-toggle rule and the dial µdeg rule; gate 3.2.2's H half
    CordModel.cs                    P2 — ENGINE-FREE: the five ReplaceCordEndpoint outcomes, the
                                    CordId 0..255 rule, the tray slot order; gate 3.2.5's H half
    PanelLayout.cs PanelTheme.cs PanelView.cs Stage.cs Controls.cs Cords.cs CordList.cs
    Picker.cs Lamps.cs              P2 — phase-3 by reference, plus Lamps pulled forward
    Toolbar.cs Drawer.cs           P2 (shells) / P3 (content) — phase-3 by reference
    DemoExperience.cs Diagnostics.cs AudioRouter.cs GodotAudioSink.cs
    HelpCredits.cs                  P3 — phase-3 by reference, minus Lamps
    AudioSchedule.cs                P3 — ENGINE-FREE: anchorUs/dueUs, the lastEventTick clause,
                                    the motor clamp, drop-vs-retry; gate 3.2.6/3.2.23's H half
    Stage3D.cs                      P4 — Camera3D + WorldEnvironment + PanelQuad + SubViewport
                                    (Panel) + exactly one Area3D. P5 adds CordMeshes and Tray;
                                    P6 adds Case and PopOuts (§2.4)
    QuadInput.cs                    P4 — the forwarder: Area3D signals -> Viewport.PushInput
    QuadMap.cs                      P4 — ENGINE-FREE: quad-local -> viewport-pixel, pure math
    OrbitCamera.cs                  P4 — node wiring for the orbit gesture and the key table
    OrbitMath.cs                    P4 — ENGINE-FREE: pose, clamping, projection, wire dolly
    CordLay.cs                      P5 — ENGINE-FREE: fixed-step verlet, no Godot Object type
    CordMesh.cs                     P5 — ImmediateMesh tube build, cached per cord
    PopOuts.cs                      P6 — 3D mirrors of the moving parts, no collision shapes
    Case3D.cs Knob3D.cs Relay3D.cs Bezels.cs                        P6 — procedural geometry
    TactileTheme.cs                 P4 — ENGINE-FREE token table (Appendix H); NOT a data/ JSON.
                                    Created at P4 with the twenty-six rows P4 and P5 consume; P6
                                    adds the original remaining forty-eight plus the nine-row
                                    geometry/material/lighting supplement
    LampGlow.cs                     P6 — emission + WorldEnvironment glow
    AudioLayers.cs                  P6 — extends AudioRouter/GodotAudioSink
tools/export-proof.ts               P0 — node builtins only; export + payload + mode-bit +
                                    proof-line formatting; npm script `export-proof`
tools/export-proof.spec.ts          P0 — Vitest coverage for all three export shapes and failures
docs/plans/phase-4-presentation.md  this document
```

**Expected `ProjectSettings` deltas — the complete list, so an unlisted key is a finding.**

| Key | Value | Written at | Why, and by what |
|---|---|---|---|
| `rendering/renderer/rendering_method` | absent: Godot 4.7.2 stores desktop Forward+ as the default | **P0 step 16** | Written by the **editor's renderer switcher**, not by hand; windowed runtime reported `method=forward_plus driver=metal` |
| `rendering/renderer/rendering_method.mobile` | `forward_plus` | **P0 step 16** | Written by the editor's renderer switcher |
| `application/config/features` | unchanged: `PackedStringArray("4.7", "C#", "GL Compatibility")` | **P0 step 16** | Observed editor behavior; it is a compatibility marker, not a pin, and is not evidence of the renderer in force |
| `rendering/textures/vram_compression/import_etc2_astc`, and any sibling `import_s3tc_bptc` the switcher writes | **whatever the editor writes**, recorded from the P0 step-16 diff | **P0 step 16** | `import_etc2_astc=true` is present at HEAD in the same `[rendering]` block and is the Compatibility/mobile compression flag; high-quality VRAM compression only becomes real off Compatibility `[verified: F37]`. `godot/` ships **no texture**, so no automatic "used in 3D" reimport can follow. The value is **recorded, not chosen** — the switcher owns it, and F49 does not enumerate the keys it writes |
| `rendering/viewport/hdr_2d` | **absent** | **P4 review amendment** | P0 check 4 established that a non-root `SubViewport` requires its own explicit `UseHdr2D=true`; the project-wide key is redundant and would affect flat mode. The panel property remains explicit in code (§2.4) |
| `input/*` | the 3D shell's actions | **P4 step 6** | `godot/project.godot` has **no** `[input]` section today, so every action P4 adds is new `[verified: F93]` |
| `physics/3d/physics_engine` | **left at its stored default, not written** | — | The key exists and its registered stored value is `DEFAULT` `[verified: F94]`; the repository's `project.godot` has no physics section at all. **No Godot physics is used**: no body, no `SoftBody3D`, no joint, no `_PhysicsProcess`. The one physics-server feature in use is pointer picking on a single `Area3D`, which reaches no Command (gates 3.2.16, 3.2.20). Stated here rather than written, so a later reader does not read the silence as an oversight |
| audio buses | built **in code** via `AudioServer.AddBus` / `SetBusName` / `SetBusSend` / `AddBusEffect` `[verified: F69]` | **P6** | Not an `AudioBusLayout` resource, so there is no imported asset and nothing for `sync-data` to carry (§2.8) |

No other `project.godot` key changes in any wave. A diff touching a key outside this table is a
wave stop **unless it was written by the editor's renderer switcher in step 16**, in which case it
is added to this table in the same commit. The switcher's full
effect is not enumerated by any source read `[F49]`, which is why the exception is stated rather
than discovered.

`.uid` files: one per new script, committed alongside it. They are **generated by the editor** when
the project is opened once after the scripts are added; no worker authors a `uid://` value. The
wave's integration step commits whatever the editor generated, matching the convention the eight
tracked `.uid` files already follow.

Ignored by git, unchanged: `dotnet/**/bin/`, `dotnet/**/obj/`, `godot/.godot/`, `godot/bin/`,
`godot/obj/`, `godot/export/`, `godot/**/*.import`. Phase 4 ships no imported asset, so the
untracked-`.import` asymmetry that already exists for the two `.wav` files does not grow — unless
R10 is yes, in which case each new sample's `.import` stays untracked exactly as the existing two
do, and the `.wav` itself is tracked and mirrored by `sync-data`.

### 2.2 The tiers and the Godot boundary scan

`phase-3-godot.md` §2.2 is the intended rule, corrected at P0 for one already-shipped G4 seam and
**amended in one planned respect by ruling R16**: its composition-root list is five files
(`Boot.cs`, `Session.cs`, `DemoLibrary.cs`,
`SelfTest.cs`, `GodotResourceSource.cs`) `[verified: B-22]` and R16 makes it six by adding
`Acceptance.cs`. That widening is a normative amendment to the most binding boundary rule in the
project, so it is a ruling with a dated entry, not a sentence in a plan (`docs/DECISIONS.md`,
*Precedence when architecture prose and shipped code disagree*: the prose is amended by a dated
entry). It is recorded again as presentation rule **PR-7**.

**`architecture.md` carries no tier text and is not amended.** §13.6.5 is *"§12 extended — rules
18–21"* and its body is rules 18, 19, 20 and 21 verbatim; it names no file, no composition root and
no tier. `grep -n "composition root" docs/plans/architecture.md` returns two hits, both about
`src/main.ts` in the TypeScript build. The two-tier rule exists **only** at
`docs/plans/phase-3-godot.md` §2.2's two-tier bullet. So R16's amendment target is that passage and nothing else,
and the dated entry says so explicitly rather than leaving a reader to look in `architecture.md`
for a change that is not there.

With R16 answered yes, the Godot project has two tiers: the composition root — `Boot.cs`,
`Session.cs`, `DemoLibrary.cs`, `SelfTest.cs`, `GodotResourceSource.cs`, and `Acceptance.cs` — may
use every `Minivac.Core` loader and, in
`SelfTest.cs`, `GodotResourceSource.cs` and `Acceptance.cs` only, all of `Minivac.Conformance`;
`Boot.cs` may additionally name `IArtifactSource` and `GodotResourceSource` and nothing else from
that library. `DemoLibrary.cs` may name `IArtifactSource` and nothing else from that library: its
shipped G4 `Load(IArtifactSource, LoadedNetlist)` signature predates this plan and wins under the
stated shipped-code precedence rule. This is a P0 prose correction, not a new Phase 4 capability.
**Every other script under `godot/scripts/` may name only `Contract` (the types and
`Machine`) and `Trace` (`Observables`, the formatters), may not name `Session`, and receives an
apply delegate `Func<Command, CmdResult>` from the composition root.**

That rule has never been mechanically enforced. `dotnet/Minivac.Core.Tests/CorePurityTests.cs`
scans `Minivac.Core` (banned identifiers) and `Minivac.Conformance` (filesystem IO) and nothing
else; `dotnet/Minivac.Godot.Tests/` contains one test file. Phase 4 adds roughly thirty
Godot-touching files, so the scan is written **first**, in P0, before any of them exists.

**`GodotBoundaryTests.cs`**, over `godot/scripts/**/*.cs`, with the comment/literal masker copied
from `CorePurityTests.cs` (it already masks verbatim, raw and interpolated literals while
preserving interpolation-hole expressions):

1. **JSON-as-resource ban.** Fail on `GD.Load`, `ResourceLoader.Load`,
   `ResourceLoader.LoadThreadedRequest` or `Json.Parse` whose argument literal ends in `".json"`.
   `GD.Load("res://data/netlist.json")` silently succeeds and returns a tree in which every number
   is a `double`; that is a failure with no error message, which is why it is scanned rather than
   reviewed.
2. **Session ban.** The identifier `Session` outside `{Boot, Session, DemoLibrary, SelfTest,
   GodotResourceSource, Acceptance}`.
3. **Conformance ban.** `Minivac.Conformance` outside the same set.
4. **Loader ban.** `LoadNetlist`, `LoadProfile`, `CreateMachine`, `AllocateHoles`, `IArtifactSource`,
   `GodotResourceSource` outside the same set — with `Boot.cs` exempt for `IArtifactSource` and
   `GodotResourceSource` only, and `DemoLibrary.cs` exempt for `IArtifactSource` only. This is the
   exact way a 3D module would reach for netlist-shaped
   data instead of declaring a local view interface, as `PanelLayout.cs` must.
5. **`Math.Round` ban**, anywhere in `godot/scripts/`. Half-up is the rule: `Math.Floor(x + 0.5)`.
6. **Ambient-input ban.** `DateTime`, `Random`, `Stopwatch` and `Time.` outside `{Loop.cs,
   Acceptance.cs}`. `Loop.cs` is rule 20's single clock; `Acceptance.cs` is the harness, which is
   not on any shipped path. **The forwarder is inside this ban**, which is why `QuadInput.cs`
   derives `Relative` from geometry and never from a clock (§2.3, PR-1).
7. **A positive allow-list.** Appendix A is a table of file → permitted namespaces and API classes.
   **Mechanism:** Appendix A is **transcribed into `GodotBoundaryTests.cs` as a literal table**, in
   the shape `CorePurityTests` already uses for its own banned-identifier and `Math.` allow-lists
   (`dotnet/Minivac.Core.Tests/CorePurityTests.cs` 14–40 — literal arrays in the test file). No test
   parses markdown. The appendix is the human-readable copy; the transcribed table is normative.
   This is the half of rule B-22 a ban-list alone cannot express.

   **Enforcement, by a closed vocabulary rather than by a prefix.** Godot C# opens with
   `using Godot;` and then names `Node`, `Control`, `Area3D`, `Vector2` **bare**; a
   `Godot.`-prefixed occurrence is the exception, not the rule — the whole tracked `godot/scripts/`
   contains exactly **three**, all of them `global::Godot.FileAccess` in `GodotResourceSource.cs`,
   and neither `Loop.cs` nor `Boot.cs` contains one. (Inside `namespace Minivac.Godot` the
   qualified spelling a file can legally use is `global::Godot.X`, not `Godot.X`, which is a second
   reason a prefix scan is the wrong instrument.) So the test carries a **closed Godot vocabulary**,
   supplemented at runtime by public top-level types reflected from the pinned GodotSharp assembly.
   The supplement makes an otherwise-unlisted Godot class fail instead of silently bypassing the
   forward table; the forward table remains the source of what each file is permitted to use.

   **The vocabulary and the rows are two different sets, and conflating them makes the scan
   unsatisfiable at P0.** The **vocabulary** is fixed and global: the union of every API name in the
   **forward** Appendix A table — all forty-five rows, whatever wave adds the file — plus the Godot
   base types the tiers turn on (`Node`, `Node3D`, `Control`, `CanvasLayer`, `Resource`,
   `RefCounted`), plus the statics `GD`, `OS`, `Time`, `Engine`, `Input`, `AudioServer`,
   `RenderingServer`, `ResourceLoader`, `Json`, `FileAccess`, `DirAccess`, `ProjectSettings`.
   `InputEvent*` is a real wildcard row matched against concrete reflected types such as
   `InputEventMouseButton`. The
   **rows** are the live subset (next paragraph). After the `CorePurityTests` masker, the test
   tokenises each file and, for **every identifier in that vocabulary — bare, `Godot.`-qualified or
   `global::Godot.`-qualified — asserts that the file's own row names it**, with a Root-tier row
   reading *all Godot* satisfying any vocabulary member by that fact. A file naming a vocabulary
   member its own row does not name **fails**, naming both. A file with no row fails by that fact
   alone. A file whose row says Engine-free and which nonetheless names `using Godot;` fails unless
   its row permits value types.

   **Seven vocabulary members are named by no Appendix A row, forward or live, and that is
   deliberate:** `GD`, `RenderingServer`, `ProjectSettings`, `ResourceLoader`, `Json`, `Resource`
   and `RefCounted`. They are carried as **detection-only** members — permitted in Root-tier files,
   whose rows read *all Godot*, and **banned everywhere else**: a Presentation- or Engine-free-tier
   file naming one fails by that fact. `GD` and `RenderingServer` are additionally named **on
   `Boot.cs`'s and `SelfTest.cs`'s rows explicitly**, as documentation, the way those rows already
   name `Engine.GetMainLoop` and `SceneTree` — `godot/scripts/Boot.cs` 107 is `GD.PushError` and
   `godot/scripts/SelfTest.cs` 110 is `GD.Print` at HEAD, and P0 step 0b adds `RenderingServer` to
   `Boot.cs`. The **transcription-gap case is over the forward table, not over the transcription**,
   and is asserted **once per wave** against Appendix A: a vocabulary member named by no forward row
   and not on the detection-only list is a plan defect. The vocabulary is extended in this plan and
   in the dated record, never in the test alone.
   **A row that is too narrow is a plan defect, not a code defect:** the wave stops and the row is
   amended in this plan and in the dated record, never widened silently in the test.

   **The transcribed table is the live subset, and the dead-row assertion is over the
   transcription.** Appendix A is the *forward* table: it carries a row for every file Phase 4 will
   ever add, and each row names the wave that adds it. The transcription inside
   `GodotBoundaryTests.cs` carries a row for exactly the files that exist under `godot/scripts/` at
   that wave's close, and no others. A wave that adds a file adds its transcribed row in the same
   commit; a wave that adds a transcribed row for a file it did not add fails the dead-row case.
   Without this rule P0 would be unreachable by construction: Appendix A has **forty-five** rows and
   only **eight** name a file that exists at P0's close — P0 adds lines to `Boot.cs` and
   `SelfTest.cs` but no new script, so `godot/scripts/` still holds the eight `.cs` files it holds
   at HEAD.

**Scanner self-tests**, in the same file, mirroring `CorePurityTests`' own pattern: an inline
`GD.Load("res://data/netlist.json")` is flagged; `GD.Load("res://models/case.tscn")` is not; the
word `Session` inside a comment or a string literal is not; a file with no allow-list row is
flagged by name; and — the one that would have caught the prefix defect — **a source naming the
bare identifier `Area3D` in a file whose row does not permit it is flagged by both file and API
name**, proving the vocabulary scan sees unqualified spellings. P0 review extended this to eleven
self-tests covering generic resource loads, Core and Conformance per-file permissions,
`System.IO`, `InputEvent*`, and reflected Godot types absent from the fixed plan vocabulary.

All Godot scripts reject `System.IO`; packed artifact reads stay behind `IArtifactSource` and
`GodotResourceSource`. `System` in an Engine-free row does not grant filesystem access.

**Negative proof**, run once at P0 with both outputs recorded:
temporarily insert `GD.Load("res://data/netlist.json");` into `godot/scripts/TraceView.cs`, run
`dotnet test dotnet/Minivac.sln --filter GodotBoundaryTests`, observe the failure naming
`TraceView.cs`, revert, re-run, observe the pass. A scanner that has never failed is not evidence.

**Status-string pins.** Thirteen status strings carry verbatim in both builds; the Godot build pins
them (`StatusStringTests.cs`, below) and the web build pins none — `src/ui/inspector.ts` 584, 588, 609, 621, 625, 628, 637, 651–653, 734, 737,
751, 796, 805, plus the cord-panel hint literal at 519 (inside the `element(…)` call at 515–520).
**Those line numbers were re-read at the executor's HEAD, not carried from planning:** the
concurrent fix loop moved `src/ui/inspector.ts` (912 lines at HEAD), `src/ui/panel-layout.ts`
(651) and `src/ui/stage-controls.ts` (498), and citations into all three shifted — the drift is
**not** confined to `inspector.ts`. **P0 step 0c re-verifies every line citation in this plan the
same way**, by grepping the quoted literal or identifier rather than trusting the number, and
corrects any that moved again before the citation is used as an expectation. A re-implemented
input layer surfaces all of them.
Those thirteen assignment sites carry **fourteen distinct literals** (two of them are ternaries);
`StatusStringTests.cs` pins each literal in the Godot build at P2 (gate 3.2.14) and Appendix E
carries all fourteen verbatim, plus the cord-panel hint — fifteen cases.

If the scanner fails a *shipped* file at P0, the finding is real: the wave stops and records it
rather than widening the allow-list.

### 2.3 The view modes and Chrome

**Chrome is screen-space in both view modes.** Phase 2 parity requires a toolbar, a drawer, the
demo experience, the cord list, the terminal picker, a diagnostics pane (trace, terminal voltages,
notes, status) and a Help/Credits dialog. Painting them onto a 3D panel face would be absurd, and
leaving them unstated would make an implementer invent the whole chrome architecture. `Chrome.cs`
is a `CanvasLayer` holding all of them, in screen space, in **both** modes. **Only the panel tree
is inside the `SubViewport`.** Chrome is a `CanvasLayer`, which is the documented way to keep UI out
of glow **on the 2D / Canvas-background route** `[verified: F47]`; whether it also escapes a 3D
`WorldEnvironment`'s glow post-process under `forward_plus` — the Phase 4 case — is addressed by no
source read `[not-settled]`. P0 check 5 records it: with glow on, screenshot a `CanvasLayer` label
over the emissive and record whether it blooms. **Stops:** if Chrome blooms, the `Environment`'s
`glow` is disabled while a Chrome overlay is open, or Chrome moves to its own `SubViewport`; either
outcome is recorded as a presentation-rule row rather than tuned away.

**The view toggle rebuilds only the stage subtree.** `Preferences` gains a fourth key,
`view/mode ∈ {flat, 3d}`. In `flat`, `Stage2D` draws the panel Control tree directly, exactly as
P2 built it. In `3d`, the same Control tree is reparented into the `SubViewport` and `Stage3D`
draws the quad. The toggle tears down `Stage2D` or `Stage3D`, builds the other, reparents the
**unchanged** panel `Control` tree into it, and rebuilds the presentation state that belongs to the
view — camera pose, `CordLay` particle state, cord meshes. **It never touches `Session`, `Machine`,
`FrameLoop`, the `Loop` node's `Current` field or the selected demo, and it emits no Command; the
machine keeps its tick.** `Session.LoadDemo`, `Reset` and `SwitchProfile` remain the only mount triggers, and those
are the only paths that construct a new `FrameLoop` (§2.5). Recorded as presentation rule PR-3 and
asserted by gate 3.2.16's `toggle-preserves-tick` case, because a toggle that rebuilt the *mount*
would silently discard a user's manual wiring and restart the trace at tick 1.

**Flat is the accessibility baseline.** The v1 claim is keyboard operability, visible focus,
tooltips and a persisted reduce-motion preference. Whether Control tooltips, keyboard focus and
popups behave correctly for a Control tree inside a `SubViewport` textured onto a 3D quad is
documented **nowhere** `[not-settled: F52]`, and whether AccessKit reaches such controls is
unknown `[unverified: F53]`. So the default mode is **conditional**, and the condition is written
into ruling R4 rather than decided at execution time: default `3d` only if P0 check 2 **and** the
P4 accessibility gate 3.2.28 both record a visible focus ring, a visible tooltip and a working
keyboard path inside the SubViewport; otherwise default `flat`. Flat is always one key away.

**Key allocation (A12).** The shell consumes a key **only when no panel Control has focus**. This
matters because the forwarding pattern hands the outer tree every non-mouse event first, so a shell
that grabbed keys unconditionally would silently change the pinned keyboard command tables.

| Key / gesture | Flat mode | 3D mode | Collides with |
|---|---|---|---|
| `f` | toggle view | toggle view | nothing; new |
| `r` | — | reset camera to the default pose | nothing; new |
| `w` | wire view | enter the 15° accessibility framing; orbit and pan retain it, dolly stays in 0.6–0.639434 W, and Fit/R exits to the normal 45° camera | already a panel-stage key; the shell owns it in both modes when no Control has focus |
| wheel | stage zoom (unchanged) | dolly | unchanged in flat |
| right-button drag, or Alt + left drag | — | orbit | nothing; `MOUSE_MODE_VISIBLE` throughout — the mouse is **never** captured |
| middle drag | — | pan | nothing |
| `+`/`=`, `-`/`_`, arrows, `0`/`Home`, `End`, `PageUp`/`PageDown`, `Space`, `Enter`, `Escape`, `Tab` | panel keys, unchanged | panel keys, unchanged | **the shell never consumes any of these** |

Arrows are already bound twice — stage pan in flat view, and a one-step relay or dial increment
when a control is focused, which gate 3.2.2 pins exactly. `Home`/`End` are the dial's min and max.
Binding a camera to any of them would change a pinned command table. Gate 3.2.2's keyboard cases
are re-run through the forwarded path in P4 so a collision fails a gate rather than a review.

The mouse is never captured, and that is a decision, not an oversight: `MOUSE_MODE_CAPTURED`'s own
note says to use `InputEventMouseMotion.relative`, while that member's note says to use
`screen_relative` under capture `[verified: F59, F60]` — an unresolved contradiction in the docs —
and the forwarding algorithm **rewrites** `relative` from quad-local deltas, which cannot coexist
with a captured-mouse orbit reading `relative` on the same event. Recorded as PR-4.

### 2.4 The 3D shell

**`Stage3D` node shape (A1), in three tiers — because S3 ships "no new fidelity" and the case,
pop-outs and cord meshes are P5/P6 deliverables.**

- **At P4 (S3):** `Camera3D` + `WorldEnvironment` + `PanelQuad` (a `MeshInstance3D` quad whose
  material albedo is a `ViewportTexture` of a `SubViewport` hosting the **unchanged** panel Control
  tree) + exactly **one** `Area3D` on the quad. Nothing else. No case, no pop-outs, no cord meshes,
  no tray.
- **At P5:** `Stage3D` gains `CordMeshes` and `Tray`.
- **At P6:** `Stage3D` gains `Case` and `PopOuts`.

**No collision shape is ever added to any of those four later subtrees.** The `Area3D` on the quad
is the only collider in the scene in every tier, which is what makes the picking facts below moot.

One collider is the whole point. `Viewport.physics_object_picking` documents a cap of 64
simultaneously pickable objects and a **non-deterministic** selection order among them
`[verified: F50]`; with a single collider both facts are moot, and neither can reach a Command.
`PhysicsObjectPickingSort` and `PhysicsObjectPickingFirstOnly` are left at their defaults with that
as the stated reason.

Prerequisites, each of which is silent if missed: `GetViewport().PhysicsObjectPicking = true` on the
root viewport — it defaults to **false**, and without it `CollisionObject3D.input_event` never fires
and the entire input path is dead `[verified: F50]`; the `Area3D`'s `collision_layer` bit 1 set —
picking "requires at least one collision_layer bit to be set" `[verified: F51]`;
`InputRayPickable = true`; `InputCaptureOnDrag = true`, which is required for dragging a cord across
the panel `[verified: F51]`.

**Drag state is driven by forwarded button down/up, never by `Area3D` enter/exit.**
`mouse_entered`/`mouse_exited` emission "may be delayed or skipped with fast mouse movement"
`[verified: F51]`, and a flick-drag of a cord is exactly that case.

**`QuadInput` forwarding rules (A2, PR-1).** Transcribe the canonical `gui_in_3d` algorithm
`[verified: F48]` with four substitutions, each with its reason:

- `Viewport.PushInput`, never `PushUnhandledInput` — the latter is deprecated **and** explicitly
  does not propagate to `SubViewport`s, which is fatal here `[verified: F45]`.
- `Viewport.NotifyMouseEntered()` / `NotifyMouseExited()`, not the demo's raw `notification()`
  calls — the 4.7 doc names the `Area3D` case explicitly `[verified: F45]`.
- The `input_event` handler's parameter 0 is typed **`Node`**, not `Camera3D`; the signal's declared
  type is `Node` even though the GDScript demo types it `Camera3D`, so a `Camera3D`-typed C#
  delegate will not match the generated event `[verified: F51]`.
- **No `Time.*` read.** The demo computes `relative` and `velocity` from the previous event position
  and `Time.get_ticks_msec()/1000.0` `[verified: F48]`. That is a second clock in the input path and
  it fails this plan's own boundary scan (rule 6 of §2.2). The C# forwarder rewrites only
  `Position` and `GlobalPosition`; computes `Relative` as the pure delta of the previous forwarded
  quad-local pixel position; and leaves `Velocity` at zero. Recorded as **PR-1**, with the note that
  no panel Control consumes `velocity`.

Coordinate map, verbatim from the demo and implemented in `QuadMap` as pure math so xunit can pin
the whole world-to-pixel seam. `quad.GlobalTransform` and `quad.Mesh.Size` are read by the
**forwarder** (`QuadInput.cs`, Presentation tier) and passed in as values; `QuadMap`'s sole public
member accepts the event's world point and the quad transform, performs the affine inverse itself,
and returns the pixel. `QuadMap` names only `System` and the Godot **value** types `Vector2`,
`Vector2I`, `Vector3` and `Transform3D`, whose headless constructibility P0 check 11 records before
any of this is written:

```
quadLocal = quad.GlobalTransform.AffineInverse() * eventPosition3D
uv        = new Vector2(quadLocal.X, -quadLocal.Y) / quad.Mesh.Size + new Vector2(0.5f, 0.5f)
pixel     = uv * viewport.Size
```

**`Pose`**, the parameter type of `OrbitMath.ClampPose`, `WireDolly` and `Project`, is declared in
`OrbitMath.cs` as `public readonly record struct Pose(double ElevationDeg, double AzimuthDeg,
double DollyW)` — three doubles, no Godot type, so the class-H gates can construct it whatever P0
check 11 records.

Keyboard events are forwarded unchanged unless the shell consumes them per the key table of §2.3.

The C# spellings in the fact base — `PushInput`, `PushUnhandledInput`, `NotifyMouseEntered`,
`NotifyMouseExited`, `GetCamera3D`, `UseHdr2D`, `PhysicsObjectPicking`,
`Node.NotificationVpMouseEnter` — come from a third-party generated GodotSharp mirror at tags
**4.3 and 4.4**, neither first-party nor 4.7 `[likely: F54]`. **Compilation against GodotSharp
4.7.2 in P0 check 2 is the verification**, the same method G0 check 8 used, and the exact spellings
that compiled are recorded before any of them is written into shipped code.

**SubViewport configuration (A13).**

| Property | Value | Derivation |
|---|---|---|
| `size` | **2880 × 1600** | 1.8:1, matching the panel aspect exactly. At 1.05 cqi the hole hit target is 0.0105 × 2880 = **30.24 texture px**, comfortably over the 24 px floor; and at a 1920-wide window the quad is filled by ≥ 1.5 texture px per window px. Recorded as a derived token (Appendix H). **Fixed in the shipped build.** The `geometry` suite temporarily resizes it to 1440 × 800 — the same 1.8:1 ratio at half scale — to prove the layout is size-independent, and restores the shipped value before the suite exits; nothing outside the harness ever changes it (gate 3.2.9a). |
| `render_target_update_mode` | `UPDATE_WHEN_VISIBLE` (**2**, the default) | Re-rendering happens when the `ViewportTexture` has been drawn in a frame `[verified: F42, F43]`, which is the case for a quad in view. |
| `render_target_clear_mode` | `CLEAR_MODE_ALWAYS` (**0**, the default) | `[verified: F42]` |
| own `Environment` | none — the 3D `WorldEnvironment` governs | **Except** under the `gl_compatibility` fallback, where the panel SubViewport gets its own `Environment` with background mode `Canvas` and a lowered `glow_hdr_threshold` (§2.7). |
| `PhysicsObjectPicking` | not set on the SubViewport; set on the **root** viewport | The picking that matters happens on the 3D quad, not inside the texture. |
| `UseHdr2D` | set **explicitly to true** on the panel node; the project-wide setting is absent | The per-viewport property is `Viewport.use_hdr_2d` and its default is **false** `[verified: F38]`. P0 check 4 measured that the project setting alone left a non-root `SubViewport` at `UseHdr2D=false`, while the explicit node property produced the over-1.0 readback. The shipped behavior therefore depends only on the node property. |

There is **no** `SubViewportContainer`. A quad-mounted SubViewport gets zero input for free
`[verified: F42, F43]`, which is why the forwarder exists at all.

**Rounding.** Every projection and geometry site uses `Math.Floor(x + 0.5)`. JS `Math.round` is
half-up; `Math.Round` is banker's rounding and is banned in the app as well as in the core, and
gate 3.2.13 rule 5 enforces it.

**Gates the 3D shell must satisfy before it is called done** are 3.2.9a, 3.2.9b, 3.2.15, 3.2.16,
3.2.2-through-the-forwarded-path, 3.2.26, 3.2.27 and 3.2.28.

### 2.5 Cords

**`CordLay.cs` — engine-free, position-based verlet (A6).** No Godot `Object`-derived type appears
in the file; its only Godot dependencies are value types, so `P5CordLayTests` can construct it
headless. Named constants, all in Appendix H:

- `cordSegments` = **16** longitudinal particles per cord. P5 gate 3.2.18 took both prescribed
  performance rungs after 24 × 8 and 24 × 6 exceeded budget.
- `dtStep` = **240 steps per second**, driven by an accumulator fed from the render callback's
  `nowUs` delta, clamped at **50 ms** exactly as `FrameLoop` clamps its catch-up. This is **not** a
  second clock: it is the same `nowUs` the `AudioRouter` already receives from `FrameLoop`'s render
  callback, and `CordLay` reads no clock of its own.
  **The accumulator is exact integer arithmetic in the `FrameLoop` style, not seconds**, because
  1/240 s is 4166.66… µs and is representable neither as a whole number of microseconds nor exactly
  in binary floating point — so a `double` seconds accumulator, or an integer accumulator with a
  4167 µs step, would fail gate 3.2.17(f) and stop the wave for an arithmetic reason rather than a
  design one:
  ```
  acc += clamp(dtUs, 0, 50_000) * 240;   // acc is a long
  steps = acc / 1_000_000;
  acc  %= 1_000_000;
  ```
  `dtStep` is therefore stated as the **rational** 240 steps per second and never as a float
  seconds constant; no `double` enters the step count. Registered in Appendix H as a `chosen`
  token with this expression as its value.
- `convergeSteps` = **480** steps (two seconds at 240 steps/s) — the K of gate 3.2.17(c), a chosen
  token registered at O-P10.
- `rebuildEpsilon` = **0.0001 W** — the "moved more than an epsilon" threshold of `CordMesh`'s
  per-cord cache, a chosen token registered at O-P10.
- Endpoints are **pinned** at the hole centre plus a vertical taper-pin stub of `taperPinStub`
  = 0.008 W.
- Gravity acts toward the panel plane at `cordGravityWPerStep2` = **0.00002 W per fixed step
  squared** — a W-relative acceleration, a chosen token with no source, registered at O-P10. It is
  stated because a position-based verlet is **defined** by it: without a magnitude the sag, and
  therefore gate 3.2.17(c)'s convergence, is whatever an executor invents.
- A plane constraint keeps every particle at height ≥ `cordRadius` = 0.0025 W.
- Rest length = `pinDistance × cordSlack` + 2 × `taperPinStub`, with `cordSlack` = **1.15**.
- `cordRelaxIterations` = **4** constraint-relaxation passes per fixed step — rest-length first,
  then the plane constraint, in that order, the order itself being part of the token's meaning.
  A chosen token, registered at O-P10.
- `cordDamping` = **1.0** — **no velocity damping**. The plane and rest-length constraints are the
  only dissipation, stated explicitly so an executor does not add a damping term the gates would
  then be measuring. A chosen token, registered at O-P10.
- **Those three, with `cordSegments`, `dtStep`, `cordSlack` and `taperPinStub`, are the complete
  definition of the integrator.** Gate 3.2.17(c), (e) and (f) are direct functions of them, so an
  unregistered fourth would make a gate result unreproducible.
- **No cord–cord collision.** It is named only in the Phase 2 deferral list and nowhere in the
  Phase 3 one, so it is currently unassigned; ruling R11 drops it to a tripwire (Appendix J). The
  primary-source hook is recorded and not lost: ERRATA troubleshooting step 4 tells the owner to
  "replace short programming wires with longer ones so that the wires do not interfere with the
  movement of the relay arms" `[verified]`.
- **Presentation only.** `CordLay` never feeds a Command. Gate 3.2.17 proves it with a spy apply,
  rather than asserting it in prose.

**Lifecycle (F10 of the determinism critique).** `CordLay` is owned by the mount and is **rebuilt on
every mount**. `Session.LoadDemo`, `Reset` and `SwitchProfile` construct a new `FrameLoop` over a
new `Machine` and drop the previous instance; the unmount clears the `Loop` node's `Current`
instance field. Every frame,
`CordLay` **reconciles against `State.cords`**: ids it does not know are seeded at the converged
rest curve; ids that have disappeared are dropped. This is also what makes a `RollbackRejected`
rebuild safe, since that path discards the UI cord list and rebuilds it from `State.cords`.

**Reduce motion.** With `motion/reduce` on, `CordLay` produces the converged curve **instantly** —
no settling animation — and the camera snaps. That is the same contract the flat build already
promises: drag previews snap and lens changes are immediate.

**`CordMesh.cs` — `ImmediateMesh` tube (A7).** Godot's own procedural-geometry comparison is the
authority: `SurfaceTool` and `ArrayMesh` are "excellent for generating static geometry"; for
geometry that changes every frame `ImmediateMesh` "provides a much easier interface that can be
slightly faster than generating an ArrayMesh every frame" `[verified: F63]`. CSG is rejected twice
over: "CSG nodes are only intended for prototyping as they have a significant CPU performance cost"
**and** "CSG mesh data updates are deferred, which means they are updated with a delay of one
rendered frame" `[verified: F64, F65]`, which would desynchronise a cord from the tick that moved
it. The call order is `SurfaceBegin(primitive, material)` → attribute setters
(`SurfaceSetNormal`/`SurfaceSetUv`/`SurfaceSetColor`) → `SurfaceAddVertex` → `SurfaceEnd`, with
`ClearSurfaces()` between rebuilds `[verified: F62]`.

- **16 longitudinal samples × 6 radial sides** per cord. P5 gate 3.2.18 took both prescribed
  performance rungs after measuring 24 × 8 and 24 × 6 above budget.
- **Rebuilt only for cords whose particles moved more than `rebuildEpsilon` = 0.0001 W since the
  last build.** A converged cord is cached and not re-emitted.
- **Budget gate (3.2.18):** 72 cords — `VI-TICTACTOE`'s pinned connection count — at 1440 × 900,
  under the shipped renderer, on the macOS arm64 development host: **rebuild time ≤ 4 ms per frame**, measured inside the
  acceptance harness. **Stops:** reduce radial sides to 6, re-measure and record; then longitudinal
  samples to 16, re-measure and record; a third failure stops the wave.
- **Handle rule (PR-2).** The tube starts at the **top of the pin stub**, so the 2D handle ring
  painted inside the SubViewport stays visible and hittable underneath it. Gate 3.2.19 asserts that
  a handle under a tube is grabbable at every pose in the allowed camera envelope. Without this
  rule a cord's own 3D body occludes the only affordance for grabbing it.
- **Free ends and touch ends.** Free ends attach to a **3D tray strip** at the panel's near edge,
  in slots ordered `(CordId, a before b)` — the same order the flat build uses, and, as there, the
  slot position **never enters `CordEnd`, `State` or the trace**. A `touch` end attaches at the
  named terminal. Incomplete cords exist in `State.cords` and are rendered; they contribute no
  circuit element and that is the core's business, not the renderer's.
- **The cord view is a projection of `State`, not its own model.** A queued command is not visible
  in the next `Snapshot()` before a positive advance, so nothing may render optimistically from a
  local model; it reconciles.

### 2.6 Pop-outs, geometry and materials

**Pop-outs (A8).** 3D mirrors of the moving parts, driven from the same render pass as the panel:
six relay crossbars, six pushbutton caps, six slide actuators, the POWER slide, the breaker button,
the dial knob, twelve lamp lenses and the POWER jewel. Rules:

- **No collision shapes on any pop-out.** The pointer ray always resolves to the single quad
  `Area3D`; a pop-out with a collider would steal the pick, and one without is unclickable by
  design. Gate 3.2.20 asserts both halves.
- The 2D artwork stays underneath as the **footprint**; the pop-out stands proud of it. Recorded as
  **PR-6**.
- Positions come from `data/panel-layout.json` normalized coordinates projected onto the quad.
  Nothing re-derives a coordinate.
- **Render-vs-grab rule, unchanged:** the per-frame render writes a relay crossbar's or the dial's
  value **only when that control is not currently grabbed** by pointer or keyboard; every other
  projected state is written unconditionally.
- **Section identity comes from the control's metadata, never from scene-tree order.**
- The **dial renders `udeg` continuously and never snaps** to the sixteen positions, in any mode
  including reduce-motion, and **no contact arcs or pad outlines are drawn on the dial face**. The
  research is explicit: there are no detents, ratchet, index spring or click stop, and "a UI that
  snaps the knob to integer positions silently destroys both the gap hang and the hand-parking
  hazard" `[likely]`; the contact-arc-versus-gap split is given nowhere and the 0.25 gap fraction in
  the `UNIFORM-CONTACTS` fallback is an unsourced engineering default, "not a finding"
  `[not-settled]`. B1 p.20's under-panel figure draws a plain circle, sixteen pairs of dots and a
  hatched wiper bar — no arcs, no dimensions. Detents and a clutch are **forbidden imports**.
- The **POWER jewel** is a red translucent jewel on a knurled threaded barrel `[verified — PH3]`,
  a distinct and smaller part from the twelve lamps, driven **binary from `State.railMv > 0`** and
  never from `milli`. **No FUSE cap.** **O-P5 keeps the light's *lens and bezel type* open** — its
  position is closed, its type is not — and its fallback is followed verbatim: draw it like the
  panel's other lamps, a red translucent lens in a cream bezel, on the knurled threaded barrel PH3
  shows. Only the barrel's **proud height** is a new chosen token, and that one is O-P18's.
- **Relay parts, left to right, from the panel face:** white cylindrical coil bobbin; white plastic
  crossbar block with a vertical slot; then the contact stacks, plainly visible to the right of the
  crossbar as two vertically separated assemblies of brown/copper springs, an upper stack and a
  lower stack `[verified — PH2; B1 pp.12, 14]`. The coil bobbin is white/cream, not tan — the tan
  reading was a PH1 tungsten-light artefact `[verified]`. **No dust cover**: the only photograph of
  Minivac relays in the round with covers is PH4, a 6010, forbidden for 601 geometry.
- **The jack ring reads as printed ink**, not a chamfer and not a drilled edge exposing a light
  substrate, and the hole sits visibly **off-centre inside its own ring**
  `[verified — PH2, in the MATRIX; likely as a whole-panel rule]` — that is the tag the research
  package carries, and this plan does not strengthen it. **O-P7 keeps the question open** ("whether
  the thin light ring around each jack hole is printed ink or the drilled edge exposing
  substrate"); its fallback — *"Draw the ring — its appearance is certain either way"* — is what
  the 3D model follows, so the choice is reversible if O-P7 closes the other way. A chamfered-hole
  model would be wrong under the reading the package prefers. The 16:24 hole-to-ring ratio is **an
  ink measurement** and must never be used as a bezel or chamfer dimension.

**Geometry fallbacks (A17).** Every value below is a **chosen** token unless stated, every one is
registered at an O-P row (`docs/research/open-questions.md`), and none is an absolute dimension.

| Item | Choice | O-P row | Note |
|---|---|---|---|
| Case height | `caseHeight` = 0.20 W (chosen) | O-P11 | The Wikipedia 5⅛ / 24 figure is **named as a rejected candidate**: it is `[unverified]`, its companion weight is contradicted by CHM's 10 lb, and the research rule is that no absolute figure — inch, millimetre or pound — may be encoded as fact. Deriving a height from it would also mix a WP proportion into a PH2-derived width base. |
| Side walls | vertical, `caseEdgeRadius` = 0.006 W | O-P11 | The case's outer edges are the same light blue as the stripes `[verified]`, so the top face wraps and there is no separate side colour token. |
| Plate recess | `plateRecess` = 0.004 W, applied uniformly to all three plates | O-P17 | The three dark sub-panels are set into the blue console face with a blue margin all round `[likely]`, and the upper-right one is a removable *power panel* `[verified — MM p.3]`, but the recess depth is given nowhere. Consequence: the blue stripes are the tray showing through the gaps between plates, **not paint on the plates**. |
| Feet | four; `footRadius` 0.012, `footHeight` 0.006, `footInset` 0.03 | O-P11 | The only evidence is that feet exist and their screws hold the bottom panel `[verified — MM p.1]`. Count, size, shape and placement are all unsourced choices. |
| Knob | PH2 form: dark brown/maroon cylinder, white pie-wedge on the **top face** terminating at the knob's own rim, `knobWedgeRadiusOverInnerCircle` = 0.769, `knobHeight` = 0.020 W | O-P12 | The body radius and wedge radius are both the frozen `decimal/inner-circle` linework's `RadiusX` 0.032 W times 0.769; `knobSquare` 0.085 W remains only the unchanged 2D artwork/pick footprint. Three sources give three forms and the package's own rule is "do not commit" — which a renderer cannot obey. O-P12 exists to record the forced choice with **both rejected forms named**: PH1's red cylinder with a cream blade reaching the number ring (a refuted claim, not a default), and B1 p.20's teardrop/leaf (a drawing, from a figure whose joining-line convention a redraw must not copy either). |
| Control travel and proud heights | `pushbuttonCapProud` 0.012 / `pushbuttonStroke` 0.006; `breakerProud` 0.010 tripped / 0.006 reset; `slideActuatorProud` 0.006; `crossbarProud` 0.008 | O-P15 | The package supplies durations, never distances. B1 p.9 establishes a human-holdable dead zone on the pushbutton with no depth. |
| Relay body | from PH2's **top view only** | O-P16 | No dust cover; four strips per contact stack at a chosen 0.5 strip-to-pitch fill ratio; the residual unknowns (bobbin diameter, slot depth, spring counts and spacing, screw positions) are recorded by the row. |
| Bezels | lamp and indicator bezel **white/cream**; pushbutton and breaker bezel **chrome/cream**; all four bezel-ring types share `lampBezelProud` 0.004 W, while the POWER jewel's separate knurled barrel remains `jewelBarrelProud` 0.008 W | O-P18 | The shared proud height is a chosen redraw value, not a sourced equivalence. Lamp, pushbutton and breaker rings reuse the pinned 0.0038 W border width established independently at `main.css` 594 and 627; the jewel uses its pinned 0.0022 W border. The research distinguishes the colours: lamps are "red translucent cap in a white/cream bezel ring, standing proud"; the pushbutton is "a large round flat-topped red cap with a chrome/cream bezel ring around its base"; the breaker is "a large red push button with a chrome/cream bezel ring". |
| Cords | one colour, `#cf5c4c`, pinned from `main.css:197` where it is already a recorded UI invention | O-P10 | Ruling R7. A multi-colour/multi-length set is a **later** chosen token, and **Gardi's yellow/red/blue 8-16-24 in set may not be its source**: it is downstream, its only justification is "because the original did so as well", and its author measured nothing from an original. Taper pins render grey metal per PH2; an occupied jack reads dark from above. |
| Sound layering | see §2.8 | O-P13 | |
| Lamp optics and bloom | see §2.7 | O-P14 | |

**`TactileTheme.cs` is normative for every token Appendix H names.** Nineteen of those rows —
`consoleTeal` … `dialRotation` — are values `PanelTheme.cs` already carries from P2, transcribed
from `main.css`, `src/ui/panel-view.ts` and `src/ui/inspector.ts`. Two
independent declarations of one value, with no rule saying which is normative and no gate scanning
`PanelTheme.cs`, is precisely the drift that was the reason for creating `TactileTheme.cs`
early. So: `PanelTheme.cs` keeps its P2 shape, and **from P6 it reads those nineteen shared rows
from `TactileTheme` rather than re-declaring them**. A P6 step asserts `PanelTheme`'s exposed values
equal the corresponding `TactileTheme` values for those nineteen names, and gate 3.2.21 case (g) fails any
literal in `PanelTheme.cs` that duplicates an Appendix H row's value.

**Materials.** The panel field is **a matt dark coating over a distinctly lighter, chalky off-white
core** — established from two chips above the `16 ARM` terminal that are "irregular, ragged-edged,
flat, matte and chalky-white, flush with the panel and casting no shadow", against neighbouring
rivet discs that are "domed and cast a lower-right shadow" `[likely]`. The core material itself is
unnamed by any source, and O-P1's register fallback is blunt: *"Render as a matt painted dark
surface; do not model material."* **The single `chalkyCore` token therefore has exactly one
consumer, named here so it cannot spread:** the exposed plate edge inside `plateRecess`, where the
coating stops. Never a chip, never a scratch, never mottling, and never a material model. That is
the narrowest reading of the fallback, and it is recorded as a chosen colour token, not as a
material stack. The frame is teal `#62979a`; its **finish** is a
chosen token, not a sourced one — no source describes the frame's finish, and the matt-coat finding
is scoped to the dark plates, which is why `frameFinish` is registered at O-P18's extended
surface-response question and not at O-P2 (paint *colours*). Chips, debris and the brown/olive mottling are **omitted**: the
package's rule for a redraw is a clean render. No photo textures, no HDRI, no image-based lighting:
procedural sky or flat ambient only.

**Legend-plate text.** The logo plate's second line is set **verbatim from PH2**:
`Scientific Development Corporation, Cambridge, Massachusetts. Made in U. S. A. Patents applied
for.` — including the full stop after Massachusetts and the spaced `U. S. A.` It is a **configurable
string**, not encoded history: the plate city varies between units (PH3 reads a ~7-glyph word ending
`-tham`, the 6010 plate reads *Watertown*, and every printed SDC document reads "372 Main Street,
Watertown, Massachusetts"). O-H1's standing rule is "configurable legend string; report, do not
resolve." The text itself is already in `data/panel-layout.json` `legends[].text` and Appendix D
pins it; Phase 4 does not retype it.

### 2.7 Lamps and glow

Lamp brightness stays exactly where it is: lens alpha = `milli / 1000`, **linear**, with `cls`
retained for the accessible name `"<name>: <cls> · <ua> µA · <milli> milli"` and the tooltip
`"<cls> · <ua> µA · <milli> milli"`. Glow is added **on top of** that mapping and never replaces it.

**Per-lens emission.** The lens pop-out's `BaseMaterial3D` carries `EmissionEnabled = true`,
`Emission` = the warm lamp colour token, and
`EmissionEnergyMultiplier = lampEmissionMax × milli / 1000` — linear in `milli`, with
`lampEmissionMax` = 2.0 (chosen, O-P14). The property spellings are `emission_enabled`, `emission`,
`emission_energy_multiplier`, `shading_mode` `[verified: F61]`. Note honestly: **no Godot document
links emission to glow**, or to values above 1.0, so the visible result rests on Environment tuning,
not on a documented guarantee.

**Environment glow**, on the 3D `WorldEnvironment`, by exact property name with the documented
defaults recorded so a deviation is visible `[verified: F40]`:

| Property | Default | Phase 4 value | Why |
|---|---|---|---|
| `glow_enabled` | `false` | `true` | — |
| `glow_intensity` | `0.3` | `0.3` (unchanged) | the overall brightness multiplier applied just before blending |
| `glow_bloom` | `0.0` | **1.0** (`glowBloom`, chosen, O-P14) | P0's initial 0.2 was invisible; 1.0 produced visible glow. "By default, even if the effect is enabled, it will be weak or invisible" `[verified: F41]` |
| `glow_hdr_threshold` | `1.0` | **0.1** (`glowHdrThreshold`, chosen, O-P14) | P0's initial 0.9 was invisible; 0.1 was the paired value that produced visible glow without project-wide HDR |
| `glow_blend_mode` | `1` | left at default | the Compatibility path forces Screen anyway, and the docs call Screen the good all-round choice |

**Chrome is a `CanvasLayer`**, which is the documented way to keep UI out of glow **on the
2D / Canvas-background route** `[verified: F47]`. Whether that also excludes it from a 3D
`WorldEnvironment`'s glow post-process under `forward_plus` is addressed by no source read
`[not-settled]`; P0 check 5 records it and §2.3 carries the Stops clause.

**Compatibility fallback (F18 of the determinism critique).** If R2 lands on `gl_compatibility`, or
if P0 check 1's Stops clause forces it, the two glow paths are **different objects** and the plan
says which is which: the 3D case keeps its own `WorldEnvironment` glow, and the **panel SubViewport
gets its own `Environment` with background mode `Canvas` and a lowered `glow_hdr_threshold`** —
the documented no-HDR 2D route `[verified: F47]`. Under Compatibility, glow works but is reduced:
Screen blend is forced and Levels, Normalized, Strength, Blend Mode, Mix, Map and Map Strength are
unavailable `[verified: F39]`, and 2D HDR Viewport is not supported at all `[verified: F38]`.

**HDR 2D.** After the P2/P3 panel tree's `source_color` audit, the panel `SubViewport`'s own
`UseHdr2D` is set **explicitly to true** in code (§2.4's table). The redundant project-wide
`rendering/viewport/hdr_2d` setting remains absent: P0 check 4 measured that it did not seed the
non-root viewport, and removing it avoids changing flat mode. The reason for the audit's ordering is that its subject —
`canvas_item` shaders and 2D samplers — does not exist at P0, where `godot/scripts` holds eight
files and the stage is a bare `Control`. With HDR 2D on, 2D rendering is performed on linear values
and every `canvas_item` uniform sampler needs the `source_color` hint `[likely: F41]`. The reason to
want it at all is exactly this design: an HDR 2D viewport's result "can be used in 3D rendering
without color encoding adjustments" `[verified: F38]`.

**Bloom is a labelled aesthetic invention.** There is no bloom evidence anywhere in the research
package and no bloom layer in the shipped build; Phase 2's public copy says so. It is registered at
O-P14 and it forces the Appendix D text change under R9.

**Lamp persistence.** The only sourced statement about lamp response speed is ERRATA, Book V p.31:
"Light 6 flashes on very briefly when indicating a dot. The three successive dots may be so rapid
and so close together that they are almost indistinguishable." That establishes that lamps smear at
speed, and it is the sole basis in the package for a persistence effect. **Phase 4 adds no
persistence effect beyond the core's own `milli` ramp**, and records that as a decision rather than
an omission: the core already relaxes `R_lamp` toward its PWL target each tick from
`lamp_thermal_tau_us`, itself an explicitly invented 40 ms constant, and a second visual decay on
top of it would be an invention stacked on an invention. Tripwire in Appendix J.

### 2.8 Layered audio

The existing router contract is unchanged and is not restated here: `phase-3-godot.md` §2.6's
`AudioRouter.cs` / `GodotAudioSink.cs` paragraph is the specification, and P3 executes it by
reference. Restated only because P6 extends them, and an extension that got these wrong would be
invisible:

- The router's clock is not its own: `FrameLoop` passes the frame's `nowUs` to its render callback
  and `AudioRouter.Frame(state, nowUs)` receives that value, so rule 20's single clock stands.
- `anchorUs = max(lastOnsetUs, nowUs)`, and only when `lastEventTick` is non-null and
  `firstTick >= lastEventTick` also `max(anchorUs, lastOnsetUs + (firstTick − lastEventTick) × 100)`;
  then per event `tick = max(priorTick, event.t)` and
  `dueUs = max(lastOnsetUs, anchorUs + (tick − firstTick) × 100)` — `Event.t`-spaced at 100 µs per
  tick, and monotone.
- Only `relay.pullIn` and `relay.dropOut` are routed.
- A relay cue that cannot get a voice is **dropped, not retried**; a refused **motor** cue **is**
  retried next frame. `MotorPlaybackRate = clamp(|mrpm| / 45 000, 0.5, 2)`.

**The scheduling arithmetic is split out into `AudioSchedule.cs`, engine-free, at P3** — the same
split `FrameLoop`/`Loop` already uses, and for the same reason: `AudioRouter.cs` is a
Presentation-tier `Godot.Node` and **a `Godot.Node` subclass cannot be constructed in the headless
xunit project**, which is exactly why the G4 suite re-implements `TraceView`'s logic inline rather
than calling it. Without the split there is nothing for a class-H gate to test, and gates 3.2.6 and
3.2.23 would name a class they cannot execute. `AudioSchedule` holds `anchorUs`, `dueUs`, the
`lastEventTick` clause, the motor clamp and the drop-vs-retry decision as **pure functions over
`(State, IReadOnlyList<Event>, long nowUs)`**; `AudioRouter.cs` becomes the `Godot.Node` that calls
it and owns the sink. `P3AudioRouterTests.cs` targets `AudioSchedule`; the bus assertion and the
observed drop rule stay class A.

**What P6 adds (A10):**

1. **Distinct pull-in and drop-out cues.** Today one sample serves both.
2. **Six-literal per-relay pitch offsets.** Six constants in `AudioLayers.cs`, no RNG.
   `AudioStreamRandomizer` is rejected on determinism grounds: it exposes **no seed and no RNG
   control anywhere in the class** `[verified: F71]`, so it cannot appear in a build whose premise
   is reproducibility.
3. **A `Room` bus with an `AudioEffectReverb`.** Built in code through `AudioServer.AddBus`,
   `SetBusName`, `SetBusSend`, `AddBusEffect` `[verified: F69]` — **not** as an `AudioBusLayout`
   resource, so there is no imported asset and nothing for `sync-data` to carry. `AudioEffectReverb`
   is used at its documented defaults `[verified: F72]`. **Assertion, because the failure is
   silent:** `AudioStreamPlayer3D.bus` performs **no validation** that the named bus exists
   `[verified: F70]`, so a mistyped `"Room"` fails quietly. `AudioLayers` asserts
   `AudioServer.GetBusIndex("Room") >= 0` before assigning it and throws with the bus name if not.
4. **Spatial relay cues — ruling R12, conditional.**
   - **If R12 is yes:** six `AudioStreamPlayer3D`, one per relay, each with
     `AttenuationModel = ATTENUATION_DISABLED` — positional panning with no distance rolloff, which
     is the desk-scale case `[verified: F70]` — and each owning its own `AudioStreamPolyphonic` with
     `Polyphony = 6`, for 36 voices in total against the single 32-voice pool today. The drop rule
     becomes **per relay**: a cue that cannot get a voice **on its own relay's player** is dropped,
     not retried, and never borrows another relay's pool. The listener is the `Camera3D`
     `[unverified — no source read states which node is the audio listener; P0 check 8 records the
     observed behaviour, and if the `Camera3D` is not the listener an explicit listener node is
     added and PR-5 records it]`. Risk 12's disclosure text (audio scheduling granularity)
     is amended in the same commit, and a presentation-rule row **PR-5** records the voice-pool
     shape.
   - **Spatial relay cues are a 3D-mode-only presentation.** There is no `Camera3D` in `flat` mode —
     exactly one of `Stage2D` and `Stage3D` is instanced, and the camera lives under `Stage3D` —
     while the `Audio` node hangs off `Boot` in both. So in `flat` mode `AudioLayers` routes the six
     cues to the **single `AudioStreamPolyphonic` path with the global drop rule**, exactly as P3
     shipped it; the switch happens on the view toggle and is recorded in PR-5. **If no `Camera3D`
     exists — flat mode, or before `Stage3D` is built — no `AudioStreamPlayer3D` is instanced at
     all.** Gate 3.2.23 asserts it.
   - **If R12 is no:** the single 32-voice `AudioStreamPolyphonic` pool stays, pan is not modelled,
     and spatial audio becomes a tripwire (Appendix J).
5. **Buttons stay silent and there is no ratchet.** The 2026-09-02 ruling is verbatim: "no per-contact
   click is used to imply a ratchet, and buttons make no sound."

**Provenance rule.** Exactly one sound in the machine has primary-source support: "The relay clicks
audibly on operate" `[verified — BK1 p.15]`. The rotary drive cue is a ruled simulation; motor
audibility has **no** source statement anywhere in the research files; silent buttons rest on a
project ruling plus another emulator author's guess. **Every new sample under ruling R10** therefore
carries a full `data/public-assets.json` record — `id`, `kind`, `localPath`, `sourcePage`,
`directSource`, `creator`, `captureDate`, `license`, `licenseUrl`, `sha256`, `purpose`,
`derivativeStatus`, `ship` — whose `derivativeStatus` ends with the mandatory sentence **"is not an
authenticated MINIVAC recording"**, is mirrored by `npm run sync-data`, and adds a **fifth credit**,
which is itself an Appendix D change under R9. Gate 3.2.22 checks all of it including the SHA-256
against the file bytes.

### 2.9 The acceptance harness and the gate classes

**Gate classes.** Every Phase 4 gate **names one or more, and a gate that names more than one states
which half each covers** — 3.2.2, 3.2.3, 3.2.5, 3.2.6, 3.2.8, 3.2.20, 3.2.23, 3.2.25, 3.2.27 and
3.2.28 each name two. Four letters, one meaning each; the gates use no other.

- **H** — headless xunit under `dotnet/`, needing no engine, in **two** projects:
  `dotnet/Minivac.Core.Tests/` carries the inherited repository gates — the core and conformance
  runs and the source scans, including `CorePurityTests` — and `dotnet/Minivac.Godot.Tests/` carries
  every gate this plan adds, over engine-free classes only. That second
  project references `godot/Minivac.Godot.csproj`, so GodotSharp types compile and load, but **no
  engine is initialized**: it can construct `FrameLoop`, `Session` (through its engine-free
  constructor), `DemoLibrary`, `Commands`, `CordModel`, `AudioSchedule`, `QuadMap`, `OrbitMath`,
  `CordLay` and `TactileTheme`, and it can
  never construct `Boot`, `Loop`, `TraceView`, `SelfTest`, `GodotResourceSource`, `AudioRouter`,
  `Acceptance` or any `Control` — everything deriving from `Godot.Node` is out of reach, which is
  why the shipped G4 suite re-implements `TraceView`'s three methods inline instead of calling
  them. **Any gate whose class is H therefore names an engine-free class, and every engine-free
  class a gate needs is given an Appendix A row.** Whether GodotSharp **value**
  types (`Vector2`, `Vector2I`, `Vector3`, `Transform3D`, `Color`) are usable in that host is
  established by no fact and by no repository precedent — the shipped suite has never touched one —
  so **P0 check 11 measures it** before any engine-free file names one.
- **A** — an in-app run of `--acceptance <suite>`, exit code 0, 1 or 2.
- **S (shell)** — a command run from the repository root or on a proof host whose pass condition is
  its exit code and its stdout. It constructs nothing and initialises no engine. `dotnet build`,
  `npm run parity`, `--selftest` and the exported-binary runs of §2.10 are class S; they are **not**
  class H, which is xunit over engine-free classes, and **not** class A, which is an
  `--acceptance` suite.
- **V** — visual, screenshot, or an observation recorded as secondary evidence and never as the
  pass condition.

No gate names a class it cannot execute, and no half of a gate names a letter that cannot run it.

**The acceptance mechanism adds no autoload.** Gate 3.2.12 requires that a `--selftest` run
instantiate no node other than `SelfTest` and `Boot`; an autoload is instantiated unconditionally on
every launch, before any argument check, so a second one would break that gate by construction.
Instead:

- `SelfTest._Ready` already parses `OS.GetCmdlineUserArgs()` for `--selftest`. It additionally sets
  `SelfTest.AcceptanceSuite` to the value following `--acceptance` when that flag is present.
  Parsing: scan the user args for the literal `--acceptance`; the **next** argument is the suite
  name; a missing or empty next argument is an error printed as
  `acceptance: --acceptance requires a suite name` with exit code 2.
- `Boot._Ready` branches in this order, and the order is the contract. **The shipped `try`/`catch`
  is retained exactly as it is at HEAD (`godot/scripts/Boot.cs` 23–30); it is the refusal path gate
  3.2.1's `refusal` case reads, and a transcription that dropped it would fail that gate for a
  reason this plan created:**
  1. `if (SelfTest.Requested) { GetTree().Quit(SelfTest.Run(source)); return; }` — the **dispatch**
     is unchanged, so `--selftest` still builds nothing.
  2. `if (SelfTest.AcceptanceSuite != null) { try { Acceptance.Start(this, SelfTest.AcceptanceSuite, source); } catch (Exception error) { GD.Print("acceptance: harness error " + error.Message); GetTree().Quit(2); } return; }`
     — this handler is **one of two** mechanisms behind the exit-2 contract below; the other is the
     per-`_Process` handler a framed suite carries.
  3. `try { Start(source); } catch (Exception error) { Refuse("MINIVAC 601 refused to start.\n" + error.Message); }`
     — **unchanged from HEAD.**
- **`--selftest` wins over `--acceptance`** when both are present. Stated so it is not discovered.
- `Acceptance.cs` is a **composition-root-tier** file under ruling R16 (Appendix A gives it the full
  API row).

**One entry point, three members, and the relation between them stated once so no later section has
to guess.** `Acceptance.Start(Node parent, string suite, IArtifactSource source)` is a **static**
method and the only thing `Boot` calls. It constructs the `Acceptance` node, adds it under `Boot`,
and then calls the instance method `Run(string suite)` **from `Start`'s own stack** — not from
`_Ready`. `Run` performs the no-`Loop` assertion, builds the tree `Start()` builds **through
`Boot.BuildConsole` (below), not through a second copy of it**, executes the suite, prints one line
per check, and calls
`GetTree().Quit(code)`. **`Acceptance._Ready` does nothing for a driven suite**; for a framed suite
it records the start frame and arms the per-frame step.

**There is exactly one composition body, and both entry points call it.** `Boot` exposes
`internal void BuildConsole(IArtifactSource source, Func<Func<string, Machine>, TraceView, Session> makeSession)`
carrying the whole body of `Start` from the version pin to `LoadDemo` — the version and hash
refusals, the netlist and profile loads, the `DemoLibrary` load, the `Stage` and `TraceView` nodes,
the `CreateMachine` local function and the final `LoadDemo` — parameterised **only** on how the
`Session` is made. `Start` passes a factory that creates the `Loop` node, adds it under `Boot` and
returns `new Session(createMachine, loop, trace)` (`godot/scripts/Boot.cs` 81–91, unchanged
statements in a new home); `Acceptance` passes a factory that creates **no `Loop`**, builds the
session through `Session`'s engine-free mount-delegate constructor with the mount factory below,
and hands the constructed `FrameLoop` to the harness. Without this, `Acceptance` would hand-build
the whole console tree a second time and **no gate would assert the two trees agree** — gate
3.2.12's `selftest nodes=Boot,SelfTest` line is taken on a run that returns at branch 1 before
anything is built, so it says nothing about the acceptance tree, and roughly fifteen class-A gates
would be measuring a tree the player never runs. `Boot.Start` is already becoming `internal` under
R16, so the extraction costs nothing further. **No statement of `Start`'s body is altered** — it
moves, whole, into `BuildConsole`, and `Start` becomes the caller.

The reason `Run` is called from `Start` rather than from `_Ready` is the exit-2 contract itself.
`AddChild` invokes `_Ready` synchronously through Godot's native binding, and **whether a managed
exception thrown inside `_Ready` propagates back out of `AddChild` to `Boot._Ready`'s `catch` is
stated by no fact in the fact base and by no P0 check** — exactly the class of question this plan's
own standard says is measured, not assumed (the headless-or-windowed paragraph below). Calling `Run`
from `Start`'s own stack keeps the throw inside managed code on both sides of the boundary, so the
`catch` is reached whatever the answer. **P0 check 3d records the answer anyway**, because a later
wave may want it.

**Two backstops, because a harness that hangs has no exit code and every class-A gate's pass
condition is one.**

- **Driven backstop.** A driven suite runs synchronously on `Boot._Ready`'s stack inside Godot's
  single-threaded main loop, so a suite that hangs **never yields a frame**: no `_Process` step and
  no `SceneTree` timer can run, and a backstop armed outside the suite could never fire. The bound
  therefore lives **inside** the suite, in `Acceptance.cs`, which is the only file holding this
  plan's `Stopwatch` / `Time.*` exemption (Appendix A's `Acceptance.cs` row, R16). Every driven
  suite checks its own `Stopwatch` **before each injected command and before each
  `FrameLoop.Frame` call**; past **60 s** it prints `FAIL <suite> harness-timeout` and quits **2**.
  `Run` additionally quits **2** with `FAIL <suite> harness-no-exit` if it falls out of the suite
  body without reaching a `Quit`. **`Boot` arms nothing**, so §2.1's `Boot.cs` budget stays at
  exactly the edits it names.
- **Framed backstop.** A framed suite runs its steps in `_Process`, in a **later** frame than
  `Boot._Ready`, where branch 2's `catch` cannot reach it. Each `_Process` step is therefore wrapped
  in the suite's own `try`/`catch`, which prints `FAIL <gate> harness-error <message>` and calls
  `GetTree().Quit(2)`. Without it gates 3.2.18, 3.2.19 and 3.2.28 would have no exit-2 path at all.

**Gate 3.2.12's observation mechanism, named here because no class-A suite can ever see a
`--selftest` run's tree** — that run is a different process, and precedence sends it down branch 1
before `Acceptance` exists. **`SelfTest.Run` is `static`** (`godot/scripts/SelfTest.cs` 110 and
112), so `GetTree()` — an instance member of `Godot.Node` — is not in scope, and the inventory is
taken from `((SceneTree)Engine.GetMainLoop()).Root` instead. Immediately **before `return 0`**, and
inside the existing `try`, `Run` writes one additional line after the summary:

```
selftest nodes=<ordinal-sorted names of Root's children, comma-separated>
```

expected exactly `Boot,SelfTest`. The line is **not** written on the `catch` path. **The count set's
lines, values and order are unchanged**, and §2.10's proof procedure greps the counts rather than
the line count, so the only pass signal is unaffected; check 1b re-runs at P0 and again at P2 to
record that the counts are unmoved. Gate 3.2.12 greps that one line. `Engine` and `SceneTree` are
added to `SelfTest.cs`'s Appendix A row — documentation only, since the Root tier already permits
every Godot API. This is why `godot/scripts/SelfTest.cs` appears in P2's Built deltas, and why
§2.9's branch-order guarantee is stated as *the dispatch is unchanged* rather than *the file is
unchanged*.

**No `Loop` node exists under `--acceptance`, and this is what makes gate 3.2.16 reachable at all.**
`Loop._Process` does nothing but `Frame((long)Time.GetTicksUsec())` on the currently mounted
`FrameLoop`, and `Current` is a **public instance field** on the `Loop` node — not a static —
which `Session`'s mount closure re-arms on **every** mount (`godot/scripts/Session.cs` 163, cleared
at 166–167 under `ReferenceEquals`). A harness that both built the tree `Start()` builds *and* drove
`FrameLoop` from a canned `nowUs` sequence would have two drivers on one `FrameLoop`, injecting
real-time ticks into a canned run — so the two modes' `TraceView` bytes could not be byte-identical,
and rule 20's single clock would be violated by the very harness that exists to prove there is no
new determinism surface. The mechanism is stated against the constructor, not against the node,
because `Boot.Start`'s path cannot express it: `new Session(CreateMachine, loop, trace)`
(`Boot.cs` 91) runs `ArgumentNullException.ThrowIfNull(loop)` inside `CreateLoopMount`
(`Session.cs` 145), so "the tree `Start()` builds minus the `Loop`" is not a tree that overload can
build, and with no `Loop` there would be no handle on the mounted `FrameLoop` at all. Therefore:

- **Driven suites** (the default) construct the session through `Session`'s **engine-free
  mount-delegate constructor** `Session(Func<string,Machine> createMachine,
  Func<Machine,SessionContext,Action> mount, string profileId)` (`Session.cs` 24–32), passing a
  mount factory `Acceptance` supplies. That factory reproduces `CreateLoopMount`'s body exactly —
  `traceView.Reset(machine.Observables())`, then a `FrameLoop` whose sample callback calls
  `traceView.Frame` and whose render callback calls `traceView.Flush` (`Session.cs` 147–162) — and
  then hands the constructed `FrameLoop` **to the harness** instead of to a `Loop` node. It touches
  no `Loop`. `Acceptance` calls `FrameLoop.Frame(nowUs)` itself from the suite's fixed sequence.
  **No `Loop` instance exists, so nothing can re-arm one.**

  **That constructor leaves `Session._traceView` null, so a driven suite does not get `Session.Apply`'s
  command line for free, and the harness must write it itself.** `Session.cs` 17 declares
  `private readonly TraceView? _traceView;` and it is assigned **only** at line 43, inside the
  `Loop`-taking overload's body; the three-argument mount-delegate constructor at 24–32 never touches
  it. `Session.Apply` writes the command line through `_traceView?.Command(...)` at line 84 — a
  null-conditional, hence a no-op under that constructor — and `CreateLoopMount`'s body (147–168)
  touches only `traceView.Reset` / `.Frame` / `.Flush`, so reproducing it exactly does **not** restore
  the command line. The shipped suite confirms it: `G4FrameSessionTraceTests.Replay` uses the same
  constructor and appends the line by hand at `dotnet/Minivac.Godot.Tests/G4FrameSessionTraceTests.cs`
  **405**. `Acceptance` therefore injects each canned command through a wrapper that reproduces
  `Session.Apply`'s body **in its shipped order** (`Session.cs` 81–85: snapshot, apply, **return
  early if the result is not ok**, then trace) and in the shape `G4FrameSessionTraceTests.Replay`
  already uses (403–405):

  ```
  var before = machine.Snapshot();
  var result = session.Apply(command);
  if (!result.ok) { FAIL <gate> command-rejected <k>; }
  traceView.Command(Session.CommandTraceTick(before, command), command);
  ```

  **A rejected canned command is a harness failure, not a trace line.** Tracing before applying, or
  tracing unconditionally, would write a `command` line for a command the machine refused — and
  because both modes run the same wrapper, `bytes-equal` would still pass, so the gate that exists
  to catch trace divergence would be blind to it. Without the wrapper gate 3.2.16's `<n>` would
  be a transition-only trace containing none of the six commands the gate exists to inject, and a
  divergence in command-to-tick attribution between the two modes would be invisible in the byte
  comparison.
- **Framed suites** — 3.2.18 `budget`, 3.2.19 `handles`, 3.2.28 `a11y` — need real frames. Each
  constructs its own `Loop` node **before** the session and uses the `Session(createMachine, loop,
  traceView, …)` overload exactly as `Start()` does, and **says so in its output line**.
- **A suite may never use both overloads.** Before any driven frame, `Acceptance.Run` — the instance
  method `Acceptance.Start` calls, above — asserts that
  `GetTree().Root.FindChild("Loop", true, false)` is `null` and **exits 2** if not, so a harness bug
  is never read as a gate failure. The assertion is a tree walk because `Current` is an instance
  field: `Loop.Current` is not a legal expression and there is no static to test.

**Suite shape and exit, because a harness that never quits has no pass signal.** Every class-A gate
names the exit code as its pass condition, so `Acceptance` must reach one. Suites are one of the two
shapes above:

- A **driven** suite runs to completion inside `Acceptance.Run`, called from `Acceptance.Start`'s own
  stack, and calls `GetTree().Quit(code)` at the end. Its own `Stopwatch` bounds it at **60 s**,
  checked before each injected command and each `FrameLoop.Frame` call — `FAIL <suite>
  harness-timeout`, exit **2** — and falling out of the suite body without a `Quit` prints
  `FAIL <suite> harness-no-exit` and exits **2** (the driven backstop above).
- A **framed** suite is armed by `Run`, then runs one step per `_Process`, counts its own frames, and
  calls `GetTree().Quit(code)` when its step budget is exhausted. Each step is inside the suite's own
  `try`/`catch` (the framed backstop above). A framed suite that has not finished
  within **3 000 frames** prints `FAIL <gate> harness-timeout` and quits **2**.

Either way the last thing printed is `acceptance: <suite> <passed>/<total>`.

**Line format**, fixed so a script can grep it:

```
PASS <gate> <check> <detail>
FAIL <gate> <check> <detail>
acceptance: <suite> <passed>/<total>
```

`<gate>` is the gate number (`3.2.15`), `<check>` a short stable slug, `<detail>` the observed
value. **Exit code 0** iff every line is `PASS`; **1** if any line is `FAIL`; **2** on a usage or
harness error, so a harness bug is never read as a gate failure.

**Headless or windowed** is decided by P0, not by the executor: if check 3a shows a
`Camera3D` + `MeshInstance3D` + `Area3D` + `SubViewport` tree instantiating cleanly under
`--headless`, **and** check 3c shows a synthetic `InputEventMouseButton` pushed with
`Viewport.PushInput` making `Area3D.input_event` fire under `--headless`, then class-A suites run
headless. If either fails, class-A suites run **windowed with the identical exit-code contract**,
which is exactly the shape Phase 3's G0 plan already used for its checks 2 and 3. Nothing about the gates changes; only the launch does.

Neither question is answerable from documentation. No Godot document states that a 3D scene tree
instantiates without error under `--headless` `[not-settled: F55]`; `--headless` is defined as
exactly two driver overrides, `--display-driver headless --audio-driver Dummy` `[verified: F56]`,
which is orthogonal to the rendering method; and whether the dummy rasterizer is what the
`--headless` path installs could not be proven from source `[likely: F57]`. Whether physics picking
runs under `--headless` is not addressed anywhere. So they are measured.

**Gate 3.2.12** — a `--selftest` run instantiates no node other than `SelfTest` and `Boot` — is
**assigned to P2**, the wave that first completes the tree, and is **re-run at the close of every
wave from P2 onward**. Phase 3 deferred it "once the full tree exists"; P2 is that moment.

### 2.10 Cross-host proof mechanics

**Presets.** Authored **once, through the editor's Export dialog on the macOS arm64 development host**, then committed and
asserted. The reason is precise: the `platform=` field's exact string is **not settled** by the
fact base — the existing macOS preset uses `platform="macOS"`, the export feature strings are
`linuxbsd` and `windows`, and the class names are `EditorExportPlatformLinuxBSD` and
`EditorExportPlatformWindows`; none of those is proof of the preset field. Do not hand-write it.
Assert the option keys that **are** settled:

- `[preset.1]` **Windows Desktop**: `binary_format/architecture="x86_64"` (→ RID `win-x64`)
  `[verified: F76, F79, F80]`; `debug/export_console_wrapper=2` — the key is an **INT enum**
  defaulting to `1` = *Debug Only*, so a `--export-release` build gets **no** `.console.exe` at the
  default `[verified: F78]`; `codesign/enable=false` `[verified: F81]`; `export_filter="all_resources"`;
  `include_filter="*.json, *.trace"`; `exclude_filter="export/*"`; and an `export_path` that the
  `exclude_filter="export/*"` rule keeps out of the pack — `export/<name>`, matching `[preset.0]`'s
  `export_path="export/Minivac.app"` (`godot/export_presets.cfg` `[preset.0]`), which is inside
  `godot/` and excluded by the filter rather than by living elsewhere.
- `[preset.2]` **Linux**: `binary_format/architecture="x86_64"` (→ RID `linux-x64`)
  `[verified: F77]`; the same four filter/path keys.

The include filter is what carries `data/` and `conformance/` into the pack; omitting it silently
breaks the packed self-test, and the exclude filter is what keeps a previous export out of the next
one.

**Export, on the macOS arm64 development host** (read-only with respect to every remote host):

```
godot-mono --headless --path godot --export-release "<preset name>" <ABSOLUTE out path>
```

A relative `<out>` resolves against `godot/`, so it is always absolute. Grep the output for the four
.NET-plugin failure strings — `Target platform not supported.`, `Target platform not yet
implemented.`, `no solution file was found`, `Failed to build project.` `[verified: F75]`; none may
appear. Caveat to carry: the **first** cross-RID self-contained publish must restore that RID's
runtime pack, so the **export machine** needs network on that first run `[verified: F86, with the
acquisition step itself undocumented]`. A first-export network error is that cause, not a port
defect.

No .NET install is needed on any run host: Godot's .NET export plugin always passes
`--self-contained true` `[verified: F74]`, and a self-contained publish bundles the runtime so "the
environment that runs the app doesn't need to have the .NET runtime preinstalled" `[verified: F85]`.
It does **not** bundle .NET's own native OS dependencies `[verified: F85]`.

**Payload check.** Read the complete `data_*` directory name **from the listing**; do not assert its
project-name prefix. The template is `data_{CSharpProjectName}_{platform}_{arch}` `[verified: F75]`,
and `CSharpProjectName` is not proven equal to the project's `assembly_name` by any fact. The
platform/architecture suffix **is** asserted: `_linuxbsd_x86_64` for Linux and
`_windows_x86_64` for Windows. `tools/export-proof.ts` owns this assertion so P0 and P1 cannot
accept a payload exported for the other platform.

**Per-host procedure.** Every step is numbered and marked. A MUTATING step requires its own explicit
operator yes, naming host and command first; SSH is read-only by default.

*Linux x64 — the primary or the secondary Linux proof host (R8a / R8b); at P7, the replacement Linux proof host replaces the primary under the
2026-09-10 host amendment (`docs/DECISIONS.md`, *P7 proof-host substitution*):*

1. **read-only** — reachability: `ssh -p <port> <host-ip> true`. For the secondary Linux proof host specifically, do
   this **before** scheduling anything: the portproxy can die while the host still answers ping.
2. **read-only** — probe: `uname -m; cat /etc/os-release; dpkg -l | grep -E 'libicu|libssl'`.
   The primary Linux proof host's WSL2 distribution is named nowhere, so the dependency list is resolved **against the
   release this step reports**, not assumed.
3. **read-only** — resolve dependencies. For Ubuntu 24.04 the .NET native dependencies are
   `ca-certificates`, `libc6`, `libgcc-s1`, `libgssapi-krb5-2`, **`libicu74`**, `libssl3t64`,
   `libstdc++6`, `tzdata`, `zlib1g` `[verified: F87]`. `libicu74` is the 24.04-specific name; 22.04
   is `libicu70`, 25.x is `libicu76`. On an **egress-locked host no install path is assumed** — a
   missing dependency **disqualifies the host** rather than triggering an apt run.
4. **MUTATING (explicit yes)** — only if step 3 found a gap and R8a authorizes it. Run it as
   `ssh -t -p <port> <ip> sudo apt-get install -y <the missing packages>`: a non-interactive `sudo`
   has **no tty** and fails with `sudo: a terminal is required to read the password` followed by
   `sudo: a password is required`, which is exactly how the first G0 toolchain install died: it needed `sudo` without a tty
   `[verified at G0]`.
   If `-t` is refused, hand the install to Tom on that host rather than iterating.
5. **MUTATING (explicit yes)** — if the lab NAS mount exists, stage the export there under one exact
   named directory. If the read-only preflight shows the mount is absent, copy directly to the
   exact approved `/tmp` directory on that run host (`/tmp/minivac-p1-linux.94WNNj` at P1;
   `/tmp/minivac-p7-linux.final` at P7). Both are remote filesystem mutations, so the host, source,
   destination and command are named before the yes. The staged bundle is deleted at P7 closure.
6. **read-only** — `ls -l <dir>` and record **the binary's name**, its mode bit and the `data_*`
   directory name. Whether a Linux binary exported from a macOS host carries the executable bit is
   **not settled**: Godot documents an executable-bit hazard only in the Windows→macOS direction
   `[verified: F83]`, and a zip transfer can drop the bit regardless.
7. **MUTATING (inside the same yes as step 8)** — `chmod +x <name>` if the bit is absent.
8. **MUTATING (explicit yes)** — `cd <dir> && ./<name> --headless -- --selftest; echo $?`, where
   `<name>` is **read from the step-6 listing** and never asserted. The Linux binary's name comes
   from `[preset.2]`'s `export_path`, which the editor authors at P0 step 14 and which no fact
   settles — the same discipline this section already applies to `data_*` and to the Windows leg's
   `<name>`.

*Windows x64 — the secondary Linux proof host (R8d):*

9. **read-only** — reachability probe from the WSL2 session:
   `powershell.exe -NoProfile -Command "$PSVersionTable.PSVersion.Major"`. Expect an integer.
   Nothing in any source confirms that WSL2→Windows interop is enabled, that `/mnt/c` is available,
   or that a native Windows shell exists `[unverified]`. **If this fails, the Windows leg stops
   here**, is recorded as still deferred, and the run proceeds to the next leg. That is a pre-stated
   fallback, not a decision made at execution time.
10. **MUTATING (explicit yes)** — from the same WSL2 bash session step 9 established, so the shell
    is bash and not `cmd.exe`:
    `cmd.exe /c "<win path>\<name>.console.exe --headless -- --selftest"; echo $?`, where `<name>`
    is **read from the listing of the P1 step-0 re-export** and never asserted — the same discipline
    the Linux leg's step 6 applies, and for the same reason: P0's step-15 check-10 artefacts are
    discarded at P1 step 0 because they were exported before the step-16 renderer switch. If `cmd.exe` interop is unavailable:
    `powershell.exe -NoProfile -Command "& '<win path>\<name>.console.exe' --headless -- --selftest; exit $LASTEXITCODE"; echo $?`.
    (`echo %ERRORLEVEL%` is `cmd.exe` syntax and prints the literal string in bash; that is why it
    is not the command here.) The console wrapper forwards the child's exit code — it launches the main
    exe suspended, waits on a job-object completion port and returns `GetExitCodeProcess`'s value
    `[likely: F79]` — and **this run is the empirical confirmation of that fact**, on which the whole
    Windows pass/fail signal depends. Two Windows preconditions are already satisfied by
    construction and are asserted in the record: `InvariantGlobalization` is project-wide and the
    CLI opens stdout with an explicit `UTF8Encoding(false)`, so console encoding never enters the
    trace bytes; and `.gitattributes` carries `* -text`, so `core.autocrlf` cannot change bytes.

*macOS x64 under Rosetta — the macOS arm64 development host (R8c):*

11. **read-only** — `man arch | col -b | head -60` (paging disabled so the output is capturable in a
    non-interactive session; confirm the `-x86_64` flag spelling, which the fact base has as prose,
    not quoted roff `[likely: F88]`) and
    `pkgutil --pkg-info com.apple.pkg.RosettaUpdateAuto; echo $?` as the presence probe `[likely]`.
    **Never execute x86_64 code before the ruling** — opening any Intel binary is itself the install
    prompt `[verified: F82]`. *Stops:* if `man arch` does not carry `-x86_64`, **the spelling is not
    invented** — the Rosetta leg is recorded as unexecutable and R8c's run half is answered **no**.
    If `pkgutil` returns non-zero, Rosetta's presence is **undetermined, not absent** (risk 20
    `[likely]`); the question goes to Tom and no install is attempted from that reading alone.
12. **MUTATING (explicit yes, R8c install half)** — install Rosetta if absent.
13. **MUTATING (explicit yes, R8c run half)** —
    `arch -x86_64 <app>/Contents/MacOS/<name> --headless -- --selftest; echo $?`. The Universal 2
    bundle already contains a complete natively-published `osx-x64` .NET payload alongside the
    `osx-arm64` one `[verified: F75]`, and `lipo -archs` reported `x86_64 arm64` at G4.
    **Interpretation rule, stated in advance:** a success is empirical evidence **for this host
    only**, because no Microsoft or Apple document states the configuration is supported
    `[unverified: F84]`; a failure is recorded as a **Rosetta/.NET interaction** — Rosetta's
    page-size and JIT behaviour is exactly the class of problem `dotnet/runtime#44897` lists, and
    CoreCLR is a JIT — and is **never** recorded as a port defect. Rosetta's shelf life runs through
    macOS 27 `[verified: F82]`.

**Proof line.** Each run prints, from inside the build:

```
proof host=<OS.GetName()> cpu=<OS.GetProcessorName()> arch=<Engine.GetArchitectureName()> audio=<AudioServer.GetDriverName()> method=<RenderingServer.GetCurrentRenderingMethod()> driver=<RenderingServer.GetCurrentRenderingDriverName()>
```

`Engine.GetArchitectureName()` reports the **slice that is running**, not the system's architecture,
which is exactly what is wanted after a lipo'd binary launches `[verified: F58]`. `AudioServer`'s
driver is expected to read `Dummy` under `--headless` `[verified: F69]`. **The rendering method and
driver may be empty under `--headless` and that is not a failure** — the documented headless
caveats cover the adapter getters, and `GetRenderingDevice()` returns null under the OpenGL driver
as well as under headless `[verified: F46]`. The renderer-in-force check that *does* gate is the
windowed one, P0 check 1 and gate 3.2.26.

**The only pass signal is exit code 0 plus the exact G4 count set**, reproduced byte for byte:
profile 1/1, derived 10/10, W3 9/9, contraction 1/1, solver 21/21, netlist 40/40, fixtures and
goldens 36/36, probes 8/8, exact pins 46/46, collapse 8/8, static 2/2 (`111`, `101`). Any count
differing is a wave stop, not a tolerance. Reproducing the counts, not merely exiting 0, is the
determinism claim.

**If the Windows leg is unreachable**, S1 closes on the Linux and Rosetta legs and `docs/STATUS.md`
says so in those words. That is ruling R8d's second half, and it is a legitimate wave outcome, not a
failure. Do not invent a host.

### 2.11 The frame loop and the clock

`phase-3-godot.md` §2.7 is the contract and is quoted there; nothing in Phase 4 amends it.
`FrameLoop.cs` holds the accounting and exposes `Frame(long nowUs)`; `Loop.cs` is the only
wall-clock code in the project and its `_Process` does nothing but
`Frame((long)Time.GetTicksUsec())`, ignoring `delta`; per-tick `Advance(1)` + `DrainEvents()`;
`Snapshot()` rendered once per frame; 50 ms catch-up cap; sub-tick remainder carried. The render
callback's signature is `Action<State, long>` and the second argument is the frame's `nowUs`.

**Every Phase 4 subsystem hangs off that one callback and reads no clock.**

- `CordLay` takes `nowUs`, differences it against its own previous `nowUs`, clamps at 50 ms and
  feeds a fixed `1/240 s` accumulator. Same clock, second accumulator **inside** it — which is why
  gate 3.2.17 requires that one 50 ms frame and the equivalent sequence of small frames produce
  **identical** particle arrays, not merely close ones.
- `OrbitCamera` takes `nowUs` for any easing; with `motion/reduce` on it snaps and takes none.
- `AudioLayers` inherits `AudioRouter.Frame(state, nowUs)` unchanged.
- `PopOuts` are written from the same `State` snapshot in the same render pass; they hold no
  animation state of their own beyond what the render writes.

**Forwarder rule PR-1**, restated here because it is the one place a clock would look natural:
`QuadInput` computes `Relative` as the pure delta of the previous forwarded quad-local pixel
position and leaves `Velocity` at zero. It reads no clock. The boundary scan enforces it.

Presentation state — camera pose, verlet particles, glow accumulators, tray slots — is owned by the
mount, resets on session replacement, and never influences a Command's value or its ordering.

---

## Appendix A — the Godot boundary allow-list

This table is **transcribed into `GodotBoundaryTests.cs` as a literal table**, in the shape
`CorePurityTests` already uses for its own lists; the appendix is the human-readable copy and the
transcription is normative (§2.2 rule 7). **The appendix is the *forward* table — every row the
plan will ever need, each marked with the wave that adds its file. The transcription is the *live
subset*: exactly the files that exist under `godot/scripts/` at that wave's close.** A file with no
transcribed row fails the scan; **an identifier from §2.2 rule 7's closed Godot vocabulary — bare,
`Godot.`-qualified or `global::Godot.`-qualified — that is absent from its file's row fails**; a
transcribed row naming no file fails as dead. **The closed vocabulary §2.2 rule 7 scans with is
built from this *forward* table, not from the transcription**, so an API name a P6 row owns is in
the vocabulary from P0 onward. The prefix is not the instrument: the whole tracked
`godot/scripts/` contains three `Godot.`-prefixed identifiers and every other Godot type is named
bare under `using Godot;`. Three tiers. *Root* = the composition root: every Godot API, every `Minivac.Core` loader,
and `Minivac.Conformance` where noted — six files, the sixth added by ruling R16. *Presentation* =
only the Godot APIs in its row, plus
`Minivac.Core.Contract` (the types and `Machine`) and `Minivac.Core.Trace` (`Observables`, the
formatters); may not name `Session`, `Minivac.Conformance` or any loader. *Engine-free* = `System.*`
plus **`Minivac.Core.Contract` (the types and `Machine`) and `Minivac.Core.Trace` (`Observables`,
the formatters)** — the same core surface the Presentation tier gets, and the reason the row wording
is `System` **+ Contract** rather than `System` only: `godot/scripts/FrameLoop.cs` 1–3 is
`using System; using System.Collections.Generic; using Minivac.Core;` and its members name
`Machine`, `State` and `Event`, so a `System`-only row would fail a shipped file on the day the scan
is written; `Commands.cs` needs `Command`/`CmdResult`, `CordModel.cs` needs `CordEnd`/`CordId`, and
`AudioSchedule.cs` needs `State`/`Event`. No Godot **node** type, no `Session`, no
`Minivac.Conformance`, no loader. Godot **value** types (`Vector2`, `Vector2I`, `Vector3`,
`Transform3D`, `Color`) additionally where
the row says so; constructible in headless xunit. **The engine-free rows' Godot value types are
conditional on P0 check 11:** if that check finds GodotSharp value types unusable without an
initialised engine, the four affected rows (`QuadMap.cs`, `OrbitMath.cs`, `CordLay.cs`,
`TactileTheme.cs`) drop them and those files use plain `Vec2`/`Vec3`/`Mat4` structs declared in
`QuadMap.cs`, converted at the Presentation-tier call sites.

**A row that is too narrow is a plan defect, not a code defect:** the wave stops and the row is
amended here and in the dated record, never widened silently in the test.

| File | Wave | Tier | Permitted namespaces / APIs |
|---|---|---|---|
| `Boot.cs` | exists | Root | all Godot; all `Minivac.Core` loaders; `IArtifactSource` and `GodotResourceSource` **only** from `Minivac.Conformance`. `GD` (`Boot.cs` 107, `GD.PushError`) and `RenderingServer` (added by P0 step 0b) are named explicitly — documentation, not a widening, since Root already permits every Godot API |
| `Session.cs` | exists | Root | `Minivac.Core` loaders; `Godot` not required |
| `DemoLibrary.cs` | exists | Root | `Minivac.Core` loaders; `IArtifactSource` only from `Minivac.Conformance`; no `using Godot` |
| `SelfTest.cs` | exists | Root | all Godot; all `Minivac.Conformance`. `Engine.GetMainLoop`, `SceneTree` and `GD` (`SelfTest.cs` 110, `GD.Print`) are named explicitly for the §2.9 inventory line and the §2.10 proof line — documentation, not a widening, since Root already permits every Godot API |
| `GodotResourceSource.cs` | exists | Root | `Godot.FileAccess`, `Godot.DirAccess`, `Godot.Error`; `IArtifactSource` |
| `Acceptance.cs` | P2 | Root **(ruling R16)** | all Godot (`GD` named explicitly for the `PASS`/`FAIL` lines); all `Minivac.Conformance`; `System.Diagnostics.Stopwatch` and `Time.*` **permitted here only**, for harness timing |
| `Loop.cs` | exists | Presentation | `Godot.Node`; `Time.GetTicksUsec` **permitted here only** |
| `FrameLoop.cs` | exists | Engine-free | `System` + Contract (`Machine`, `State`, `Event`) — the file is `using System; using System.Collections.Generic; using Minivac.Core;` at HEAD |
| `TraceView.cs` | exists | Presentation | `Godot.RichTextLabel` |
| `Preferences.cs` | P2 | Presentation | `Godot.ConfigFile`, `Godot.Node` |
| `Chrome.cs` | P2 | Presentation | `Godot.CanvasLayer`, `Godot.Control` and its subclasses |
| `PanelLayout.cs` | P2 | Engine-free | `System`, `System.Text.Json`; Godot value types |
| `PanelTheme.cs` | P2 | Engine-free | `System`; `Godot.Color`, `Godot.Vector2` |
| `PanelView.cs` | P2 | Presentation | `Godot.Control`, `Button`, `Panel`, `Line2D`, `TextureRect`, `Label`, `FontVariation`, `SystemFont`, `Godot.Vector2`, `Godot.Color` |
| `Stage.cs` | P2 | Presentation | `Godot.Control`, `Godot.InputEvent*`, `Godot.Vector2` |
| `Commands.cs` | P2 | Engine-free | `System` + Contract (`Command`, `CmdResult`) |
| `Controls.cs` | P2 | Presentation | `Godot.Control`, `Button`, `Range`/`Slider`, `Godot.InputEvent*`, `Godot.Vector2` |
| `CordModel.cs` | P2 | Engine-free | `System` + Contract (`CordEnd`, `CordId`) |
| `Cords.cs` | P2 | Presentation | `Godot.Control`, `Line2D`, `Godot.InputEvent*`, `Godot.Vector2`, `Godot.Color` |
| `CordList.cs` | P2 | Presentation | `Godot.Control`, `Button`, `Godot.Vector2` |
| `Picker.cs` | P2 | Presentation | `Godot.Control`, `LineEdit`, `Button`, `Godot.Vector2` |
| `Lamps.cs` | P2 | Presentation | `Godot.Control`, `Godot.Color`, `Godot.Vector2` |
| `Toolbar.cs` | P2 | Presentation | `Godot.Control`, `Button` |
| `Drawer.cs` | P2 | Presentation | `Godot.Control`, `Button` |
| `DemoExperience.cs` | P3 | Presentation | `Godot.Control`, `Button`, `Label`, `RichTextLabel` |
| `Diagnostics.cs` | P3 | Presentation | `Godot.Control`, `RichTextLabel`, `Label` |
| `HelpCredits.cs` | P3 | Presentation | `Godot.AcceptDialog`, `Godot.Control`, `OS.ShellOpen` |
| `AudioSchedule.cs` | P3 | Engine-free | `System` + Contract (`State`, `Event`) |
| `AudioRouter.cs` | P3 | Presentation | `Godot.Node` |
| `GodotAudioSink.cs` | P3 | Presentation | `Godot.AudioStream`, `AudioStreamPlayer`, `AudioStreamPolyphonic`, `AudioStreamPlaybackPolyphonic`, `AudioServer` |
| `Stage3D.cs` | P4 | Presentation | **P4 set:** `Godot.Node3D`, `Camera3D`, `WorldEnvironment`, `Environment`, `MeshInstance3D`, `QuadMesh`, `SubViewport`, `ViewportTexture`, `StandardMaterial3D`, `Area3D`, `CollisionShape3D`, `BoxShape3D`, `Viewport`, `Vector2I`, `Vector3`. **P5 adds** nothing (the `CordMeshes`/`Tray` subtrees are built by `CordMesh.cs`). **P6 adds** `DirectionalLight3D`, `Color`, `Vector2`, and Contract `State`; the `Case`/`PopOuts` subtrees themselves are built by `Case3D.cs` / `PopOuts.cs` |
| `QuadInput.cs` | P4 | Presentation | `Godot.Area3D`, `Camera3D`, `Viewport`, `MeshInstance3D`, `Mesh`, `Transform3D`, `Vector2`, `Vector3`, `Vector2I`, `Godot.InputEvent*`, `MouseButton`, `Node`; **no `Time.*`** |
| `QuadMap.cs` | P4 | Engine-free | `System`; `Godot.Vector2`, `Vector2I`, `Vector3`, `Transform3D` |
| `OrbitCamera.cs` | P4 | Presentation | `Godot.Camera3D`, `Node3D`, `Godot.InputEvent*`, `Input.MouseMode`, `Key`, `MouseButton`, `Vector2`, `Vector3` |
| `OrbitMath.cs` | P4 | Engine-free | `System`; `Godot.Vector2`, `Vector2I`, `Vector3`, `Transform3D` |
| `CordLay.cs` | P5 | Engine-free | `System`; `Godot.Vector2`, `Vector3` value types; no `Godot.Object`-derived type |
| `CordMesh.cs` | P5 | Presentation | `Godot.ImmediateMesh`, `MeshInstance3D`, `Node3D`, `StandardMaterial3D`, `BaseMaterial3D`, `Mesh`, `Vector3`, `Color` |
| `PopOuts.cs` | P6 | Presentation | `Godot.MeshInstance3D`, `Node3D`, `BaseMaterial3D`, `StandardMaterial3D`, `Vector2`, `Vector3`, `Color`; Contract `State` |
| `Case3D.cs` | P6 | Presentation | `Godot.MeshInstance3D`, `Node3D`, `ArrayMesh`, `SurfaceTool`, `Mesh`, `BaseMaterial3D`, `StandardMaterial3D`, `Color`, `Vector2`, `Vector3`; owns the shared primitive/material helpers |
| `Knob3D.cs` | P6 | Presentation | as `Case3D.cs` |
| `Relay3D.cs` | P6 | Presentation | as `Case3D.cs` |
| `Bezels.cs` | P6 | Presentation | as `Case3D.cs` |
| `TactileTheme.cs` | P4 | Engine-free | `System`; `Godot.Color`, `Godot.Vector2` |
| `LampGlow.cs` | P6 | Presentation | `Godot.BaseMaterial3D`, `MeshInstance3D`, `WorldEnvironment`, `Environment`, `Color`; Contract `State` |
| `AudioLayers.cs` | P6 | Presentation | `Godot.AudioServer`, `AudioStream`, `AudioEffectReverb`, `AudioStreamPlayer` |

## Appendix B — the node tree, in both view modes

```
Main = Boot (Node)            Boot.cs      scenes/Main.tscn — the ONLY scene file; Boot is its root
│                                          and its only node. Everything below is built in code by
│                                          Boot._Ready, after the --selftest early return and the
│                                          --acceptance branch (§2.9). Data load, hash and version
│                                          pins live in Boot.
├─ Loop (Node)                Loop.cs      rule 20; the only wall-clock read in the project
├─ Session (Node)             Session.cs
├─ DemoLibrary (Node)         DemoLibrary.cs
├─ Preferences (Node)         Preferences.cs        audio/muted, help/seen, motion/reduce, view/mode
├─ Audio (Node)               AudioRouter.cs        children: GodotAudioSink.cs + AudioStreamPlayer ×2;
│                             AudioSchedule.cs      the anchor/drop arithmetic, ENGINE-FREE, called
│                             (engine-free, no node) by AudioRouter — the class-H seam
│                                                   from P6, AudioLayers.cs and, in 3D mode only and
│                                                   only if R12, six AudioStreamPlayer3D. In flat
│                                                   mode there is no Camera3D, so none is instanced
│                                                   and the single 32-voice pool is used (§2.8)
├─ Chrome (CanvasLayer)       Chrome.cs             SCREEN SPACE IN BOTH MODES: Toolbar, Drawer,
│                                                   DemoExperience, CordList, Picker, Diagnostics,
│                                                   HelpCredits. Excluded from glow by being a
│                                                   CanvasLayer.
├─ Stage2D (Control)          Stage.cs              view/mode = flat: draws the panel Control tree
│   └─ Panel (Control)        PanelView.cs            directly
│      … PanelLayout, Controls, Cords, CordList anchors, Lamps
├─ Stage3D (Node3D)           Stage3D.cs            view/mode = 3d: draws the quad
│   ├─ Camera3D               OrbitCamera.cs        P4. Also the audio listener [unverified — no
│   │                                               source names the listener node; P0 check 8]
│   ├─ WorldEnvironment       LampGlow.cs           P4 (bare); glow properties added at P6
│   ├─ PanelQuad (MeshInstance3D)                   P4. material albedo = ViewportTexture
│   │   ├─ SubViewport                              P4. 2880×1600, update WHEN_VISIBLE, clear
│   │   │   │                                       ALWAYS, UseHdr2D set explicitly at P4 step 7
│   │   │   └─ Panel (Control) PanelView.cs         no SubViewportContainer — the SAME tree as flat
│   │   └─ Area3D             QuadInput.cs          P4. THE ONLY pickable body in the scene
│   ├─ CordMeshes (Node3D)    CordMesh.cs           P5. no collision shapes
│   ├─ Tray (Node3D)                                P5. free-end slots, (CordId, a before b)
│   ├─ Case (Node3D)          Case3D.cs / Knob3D.cs / Relay3D.cs / Bezels.cs   P6. no collision
│   └─ PopOuts (Node3D)       PopOuts.cs            P6. no collision shapes
└─ Trace                      TraceView.cs
SelfTest (autoload)           SelfTest.cs           the ONLY autoload; its _Ready runs before Main's
                                                    on every launch and parses --selftest and
                                                    --acceptance <suite>. From P0 its Run prints the
                                                    §2.10 proof line first; from P2 it prints
                                                    `selftest nodes=…` last. The count set never
                                                    moves.
Acceptance                    Acceptance.cs         a Node instanced by Boot ONLY under
                                                    --acceptance; never on the --selftest or normal
                                                    paths. A DRIVEN suite builds the session through
                                                    Session's engine-free mount-delegate ctor and no
                                                    Loop node exists at all; a FRAMED suite (budget,
                                                    handles, a11y) builds its own Loop first and
                                                    uses the Loop-taking ctor, and says so in its
                                                    output line. Every suite ends in
                                                    GetTree().Quit(0/1/2) (§2.9)
```

**`Stage3D` is built in three tiers** — P4 (camera, environment, quad, SubViewport, the one
`Area3D`), P5 (`CordMeshes`, `Tray`), P6 (`Case`, `PopOuts`) — because S3 ships **no new fidelity**.

Exactly one of `Stage2D` and `Stage3D` is **instanced at a time**. The view toggle reparents the
panel `Control` tree between `Stage2D` and the `SubViewport`, frees the unused stage node, and
rebuilds the presentation state that belongs to the view — camera pose, `CordLay` particles, cord
meshes. **It never touches `Session`, `Machine`, `FrameLoop` or the `Loop` node's `Current` field, and it
emits no Command**; the machine keeps its tick. It is *not* a mount: `Session.LoadDemo`, `Reset` and
`SwitchProfile` are the only mount triggers, and only they construct a new `FrameLoop`. Gate
3.2.16's `toggle-preserves-tick` case asserts it. The panel `Control` tree is identical in both.

## Appendix C — command tables and key allocation

**`phase-3-godot.md` Appendix C is unchanged and is the command table.** Every gesture in it emits
exactly the same commands through the 3D path as through the flat path; gate 3.2.2 re-run through
the forwarded path is the proof, and gate 3.2.16 is the proof that nothing else is emitted.

**3D gestures — how each reaches the flat table.**

| 3D gesture | Becomes | Emitted by |
|---|---|---|
| pointer press on the quad over a hole | `Area3D.input_event` → `QuadMap` pixel → `Viewport.PushInput` of an `InputEventMouseButton` at that pixel → the hole `Button` | the flat `Cords.cs` / `Controls.cs`, unchanged |
| pointer drag across the quad | further forwarded `InputEventMouseMotion`, `Relative` = the quad-local pixel delta, `Velocity` = 0 (PR-1); `InputCaptureOnDrag = true` keeps them flowing | the flat drag path |
| pointer release / leaving the quad | forwarded button-up; drag state ends on the **forwarded button**, never on `Area3D` enter/exit | the flat release path |
| a key while a panel Control has focus | forwarded unchanged | the flat keyboard path |
| a key while no panel Control has focus | consumed by the shell **only** if it is in the shell's list below | `OrbitCamera` / the view toggle |
| pop-out press | resolves to the quad, then to the 2D control underneath (PR-6) | the flat control |
| cord handle press under a tube | resolves to the handle, because the tube starts at the pin-stub top (PR-2) | the flat cord path |

**Key allocation.** The shell's list is exactly: `f` (toggle view), `r` (reset camera), `w` (wire
view in flat; wire dolly in 3D), wheel (stage zoom in flat; dolly in 3D), right-button drag or
Alt + left drag (orbit), middle drag (pan). **Everything else belongs to the panel and is never
consumed by the shell**: `+`/`=`, `-`/`_`, arrows, `0`/`Home`, `End`, `PageUp`/`PageDown`, `Space`,
`Enter`, `Escape`, `Tab`. The mouse is never captured (`MOUSE_MODE_VISIBLE` throughout).

## Appendix D — frozen public copy, and the R9 amendment

`phase-3-godot.md` Appendix D is unchanged except for the one row this appendix amends. Every other
row — the D2 counter notice, the profile disclosure, the per-demo Source block labels, the credits
headings and description sentences, the licence display map, demo titles and categories, control
base names, panel legends including the Cambridge fine print, the five help workflow headings, the
reset control labels — carries verbatim and is pinned by gate 3.2.8.

**The row amended: *Redraw and simulation limits*, two paragraphs, `src/ui/help-credits.ts`
145–156.**

**Current text, quoted for comparison** (`src/ui/help-credits.ts`, the two `help-limit`
paragraphs):

> The palette and panel geometry are approximate and photograph-derived. The 1.80 ratio, band
> boundaries, and placement values are unverified proportions, not physical dimensions. Exact RGB
> values, typeface, coating, substrate, mounting-disc function, and rotary-knob colour and form
> remain unresolved.

> The POWER jewel is a binary interface projection: lit when rail voltage is above zero and dark at
> zero. It is not a modeled lamp-current or intensity result.

**Proposed replacement under ruling R9, verbatim.**

P1 (redraw): "The palette and panel geometry are approximate and photograph-derived. The 1.80 ratio,
band boundaries, and placement values are unverified proportions, not physical dimensions. Exact RGB
values, typeface, coating, substrate, mounting-disc function, and rotary-knob colour and form remain
unresolved. The three-dimensional case, knob, control heights, relay bodies, bezels and patch cords
are chosen redraw tokens recorded in the project's open questions; no dimension of the original is
known."

P2 (power, lamps and sound): "The POWER jewel is a binary interface projection: lit when rail
voltage is above zero and dark at zero. It is not a modeled lamp-current or intensity result. Lamp
glow and every sound other than the relay click are simulated presentation, not evidence about the
original; the relay click is the only sound the manuals describe."

**The rule.** The replacement lands in **five places in one commit**: `src/ui/help-credits.ts`
(the web build — the **only** `src/` change Phase 4 makes), the Godot-side literal pin,
**`test/help-credits.spec.ts` 179–186**, **`test/browser/help.browser.ts` 47–55**, and
`phase-3-godot.md` Appendix D's cited line range. The two web tests are named for different
reasons. `test/help-credits.spec.ts` asserts both paragraphs with `.toBe(...)` on the exact
strings, and `npm test` is both one of gate 3.2.24's commands and a per-commit gate, so a
commit that changed `src/ui/help-credits.ts` without it would land red. `test/browser/help.browser.ts`
would **not**: `npm test` is `vitest run` over `test/**/*.spec.ts`, `src/**/*.spec.ts` and
`tools/**/*.spec.ts` (`package.json` 16, `vite.config.ts` 8) and does not run Playwright — that is
`npm run test:browser` over `test/browser/**/*.browser.ts` (`package.json` 17,
`playwright.config.ts` 10–11) — and its three assertions are `toContainText` fragments
(*unverified proportions, not physical dimensions*; *Exact RGB values, typeface, coating,
substrate, mounting-disc function, and rotary-knob colour and form remain unresolved*; *binary
interface projection: lit when rail voltage is above zero and dark at zero*) that the append-only
replacement leaves intact. It is updated in the same commit anyway, so the disclosure text is not
asserted in two shapes.
**Gate 3.2.24 asserts the two copies that carry the text agree byte for byte** and prints
`phase-3-godot.md` Appendix D's updated citation for the reviewer; that row is a citation table and
carries no copy to be byte-identical to (gate 3.2.24).
If a new audio sample ships under R10, or a font under R14, the credits list gains a **fifth entry**
in the same commit and the same gate covers it — **and that entry's description sentence names the
build or builds that ship the asset.** Phase 4 is Godot-desktop-only and the only permitted `src/`
change is the two limits paragraphs plus that added credit entry, so a Phase 4 asset is consumed by
the desktop build alone;
a credit carried identically in both builds would otherwise have the public web build crediting an
asset it does not use and, for an OFL font, does not ship (the web build sets panel type from CSS).
The fix is not to diverge the two credit lists — gate 3.2.24's whole point is that they agree byte
for byte — but to make the **added** sentence true of both, e.g. *"The shipped attenuated derivative is
a simulated relay drop-out cue **in the desktop build**; it is not an authenticated MINIVAC
recording."*
**Gate 3.2.24 asserts the build-naming property for Phase 4's added entries only.** The four G4
credits are **unamended frozen copy** — none of them names a build (`src/ui/help-credits.ts` 169,
175, 181, 187: *"Primary evidence for panel geometry and visual facts…"*, *"Corroboration for the
factory POWER jewel…"*, *"The shipped attenuated derivative is a simulated operation cue, not an
authenticated MINIVAC recording."*, *"The shipped attenuated, wrap-crossfaded derivative is a
simulated motor cue, not an authenticated MINIVAC recording."*) — R9 authorizes **adding** an entry,
not rewriting four existing sentences, and gate 3.2.8(ii) continues to pin all four byte for byte. A
universal quantifier over every credit sentence would demand four `src/` rewrites this plan supplies
no text for and its own `src/` fence forbids.
R9 was answered **yes as written** on 2026-09-04, so the added entry is carried in both builds and
3.2.24's both-builds equality stands; a web build carrying no such entry would be a change to that
gate and would need a new dated ruling.
If R9 is **no**, none of glow, new samples or new
chosen-token disclosure ships, and the plan stops at S3.

## Appendix E — inventories the tests assert

| Inventory | Count | Detail |
|---|---|---|
| Terminals | 186 | asserted at `PanelLayout` module load |
| Holes | **392** | `6×50 + 2×2 + 18×2 + 2×6 + 20×2 = 392`; hole id `<terminalId>#<1-based index>`; gate 3.2.2's 392-hole table and gate 3.2.15's 392 forwarding cases |
| Controls | **21** | relay crossbar ×6, slide switch ×6, pushbutton ×6, power switch, breaker button, dial |
| Lamps | **12 + 1** | twelve red lenses consuming `milli`, plus the POWER jewel, a distinct component that never reads `milli` |
| Demos | **11**, with cord counts | `IV-EXP1` 44, `ER-ALTCOUNTER` 48, `VI-TICTACTOE` **72**, `V-JOBSELECT` 30, `VI-RANDOM` 40, `III-RELAYAND` 10, `III-RELAYOR` 11, `III-RELAYNOT` 6, `III-RELAYXOR` 11, `V-EXP2` 16, `IV-FF2` 14 |
| Cord budget fixture | **72** | `VI-TICTACTOE`, the largest demo, is gate 3.2.18's load |
| Plates / bands / regions / legends / linework / dial angles | 3 / 12 / 40 / 264 / 70 / 16 | from `data/panel-layout.json`, unchanged |
| S1 count set | — | profile 1/1, derived 10/10, W3 9/9, contraction 1/1, solver 21/21, netlist 40/40, fixtures and goldens 36/36, probes 8/8, exact pins 46/46, collapse 8/8, static 2/2 (`111`, `101`) |
| Public-asset records | **6 records + 2 `excludedReferences`** | `data/public-assets.json`: `panel-ph2-primary`, `panel-ph3-corroboration`, `relay-simulation-source`, `rotary-drive-simulation-source`, `relay-cue`, `rotary-drive-loop`; excluded `panel-ph1-low-resolution`, `panel-ph4-minivac-6010`. **Four of the six are credited** in the Help dialog (`src/ui/help-credits.ts` 165–188) — four is the credits count, never the record count, and gate 3.2.22's fallback `[Fact]` asserts six |
| Godot scripts at HEAD | **8** `.cs` (+ 8 `.uid`) | `Boot`, `Session`, `DemoLibrary`, `SelfTest`, `GodotResourceSource`, `Loop`, `FrameLoop`, `TraceView` — the live subset gate 3.2.13's transcribed allow-list carries at P0's close |

**The status strings** (gate 3.2.14) — **fourteen distinct literals across thirteen assignment
sites**, verbatim, in the order of `src/ui/inspector.ts` 584, 588, 609,
621, 625, 628, 637, 651–653, 734, 737, 751, 796, 805 (re-read at HEAD; §2.2):

*Rejected: `<why>`* (584) · *Accepted: `<k>`* (588) · *All 256 cord ids are in use.* (609) · *Cord
endpoint connected.* (621) · *Cord rollback rejected: `<why>`.* (625) · *Cord change rejected:
`<why>`.* (628) · *`<hole>` is occupied.* and *Cord change cancelled.* (637) · *`<hole>` is
occupied.*, *Cord drop cancelled.* and *Cord move cancelled.* (651–653) · *Touching terminal
`<t>`.* (734) · *Touch requires a free cord end.* (737) · *Cord move cancelled.* (751) · *Choose a
terminal or Free for cord `<n><SIDE>`.* (796) · *Select a cord end first.* (805)

— plus the cord-panel hint, printed here verbatim because gate 3.2.14's fifteenth case is written
from this appendix and cannot be written from a description: *Select end A or B, then click a jack
hole. Free ends stay electrically loose.* (`src/ui/inspector.ts` **519**, inside the
`element(document, 'p', 'cord-help', …)` call at 515–520).

**Thirteen assignment sites yield fourteen distinct literals**, because two of the sites are
ternaries: line **637** emits *`<hole>` is occupied.* **or** *Cord change cancelled.*, and lines
**651–653** a nested ternary emitting *`<hole>` is occupied.*, *Cord drop cancelled.* **or** *Cord
move cancelled.* (`*<hole>* is occupied.` therefore appears at two sites and *Cord move cancelled.*
at 653 and again at 751, so the fourteen are distinct **literals**, not distinct site-literal
pairs.) *Accepted* and *Rejected* do **not** share a site: they are two assignments four lines
apart, 584 *Rejected* and 588 *Accepted*, and the order above is the order of the line list.
**Gate 3.2.14 therefore expects fifteen cases: fourteen literals plus the cord-panel hint.**

**Seven of the fourteen sites interpolate; four of those yield an ordered fragment pair and three
yield a single complete literal, which gate 3.2.14 asserts whole.** The shipped sites interpolate — `'Rejected: ' + result.why` (584), `'Accepted: ' +
command.k` (588), `'Cord rollback rejected: ' + result.rollbackWhy + '.'` (625), `'Cord change
rejected: ' + result.why + '.'` (628), `target.hole + ' is occupied.'` (637), `'Touching terminal '
+ result.terminal + '.'` (734), `'Choose a terminal or Free for cord ' + endpoint.cord +
endpoint.side.toUpperCase() + '.'` (796) — so in C# three of them still yield one complete literal
and four yield an ordered pair, and a scan for the rendered strings would fail all seven by
construction:

| Case | Kind | What the test asserts |
|---|---|---|
| *All 256 cord ids are in use.* | fixed | the whole literal occurs at least once |
| *Cord endpoint connected.* | fixed | as above |
| *Cord change cancelled.* | fixed | as above |
| *Cord drop cancelled.* | fixed | as above |
| *Cord move cancelled.* | fixed | as above |
| *Touch requires a free cord end.* | fixed | as above |
| *Select a cord end first.* | fixed | as above |
| *Select end A or B, then click a jack hole. Free ends stay electrically loose.* (`src/ui/inspector.ts` **519**, inside the `element(document, 'p', 'cord-help', …)` call at 515–520) | fixed | the whole literal occurs at least once |
| *Rejected: `<why>`* | fixed | the literal `Rejected: ` occurs at least once — the site is `'Rejected: ' + result.why`, one literal, so there is no second fragment to pair it with |
| *Accepted: `<k>`* | fixed | the literal `Accepted: ` occurs at least once — same reason |
| *`<hole>` is occupied.* | fixed | the literal ` is occupied.` occurs at least once — the site is `target.hole + ' is occupied.'`, one literal |
| *Cord rollback rejected: `<why>`.* | fragment pair | `Cord rollback rejected: ` then `.` — same file, in that order, within 200 source characters |
| *Cord change rejected: `<why>`.* | fragment pair | `Cord change rejected: ` then `.`, same rule |
| *Touching terminal `<t>`.* | fragment pair | `Touching terminal ` then `.`, same rule |
| *Choose a terminal or Free for cord `<n><SIDE>`.* | fragment pair | `Choose a terminal or Free for cord ` then `.`, same rule |

Eleven fixed literals and four fragment pairs — **fifteen cases**. The proximity rule replaces
"within a single statement": the inverse masker blanks executable code, so the `+` and `;` a
statement boundary is made of are not in the text the assertion reads (gate 3.2.14).

## Appendix F — sources for the external facts

Read 2026-09-04, continuing `phase-3-godot.md` Appendix F's numbering (which ends at F34). Tags are
the ones the fact base gives.

- **F35** — Godot docs, *Renderers* (4.7): the three rendering methods; Forward+ "suited for desktop
  platforms only". `[verified]`
- **F36** — godot `4.7-stable` `main/main.cpp`: `rendering/rendering_device/driver.macos` =
  `"metal,vulkan"` default `metal`; `gl_compatibility/driver.macos` default `opengl3`. `[verified]`
- **F37** — Godot docs, *Importing images* (4.7): VRAM compression only off Compatibility; automatic
  reimport when a texture is detected as used in 3D. `[verified]`
- **F38** — renderers comparison table + `doc/classes/Viewport.xml` `use_hdr_2d`: 2D HDR Viewport
  "Not supported" on Compatibility; "can be used in 3D rendering without color encoding
  adjustments". `[verified]`
- **F39** — godot-docs 4.7 `tutorials/3d/environment_and_post_processing.rst` + `Environment.xml`:
  Compatibility glow is a reduced implementation; Screen blend forced; Levels/Map/Strength/Mix
  inert. `[verified]`
- **F40** — `doc/classes/Environment.xml`: `glow_enabled` false, `glow_intensity` 0.3, `glow_bloom`
  0.0, `glow_hdr_threshold` 1.0 and the rest, with defaults. `[verified]`
- **F41** — `environment_and_post_processing.rst`: glow is "weak or invisible" by default; the
  Canvas-background 2D route; the HDR-2D linear-colour-space warning requiring `source_color`.
  `[verified]` for the glow rule, `[likely]` for the `source_color` warning (extractor paraphrase)
- **F42** — `doc/classes/SubViewport.xml`: `size` default 512×512, `render_target_update_mode`
  default 2, `render_target_clear_mode` default 0; needs a container or a `ViewportTexture`;
  InputEvents do not propagate. `[verified]`
- **F43** — Godot docs, *Viewports* (4.7): re-render on `ViewportTexture` draw; "SubViewports don't
  automatically receive input". `[verified]`
- **F44** — `doc/classes/RenderingServer.xml` + renderers page: the
  `rendering/renderer/rendering_method` key and the `--rendering-method` override. `[verified]`
- **F44b** — renderers page, "Since Godot 4.4, if initial rendering driver support is unavailable,
  the engine automatically attempts fallback drivers before reverting to Compatibility mode",
  plus `main/main.cpp`'s `GLOBAL_DEF_RST("rendering/rendering_device/fallback_to_opengl3", true);`
  registration line. **The registration line is the only quoted part; the fallback sentence reached
  the fact base as an extractor paraphrase and is recorded there as `[unverified]` (G4-R64).**
  `[unverified]` — which is precisely why gate 3.2.26 measures the behaviour rather than citing it.
- **F45** — `doc/classes/Viewport.xml`: `push_input`; `push_unhandled_input` deprecated and
  explicitly not propagating to SubViewports; `notify_mouse_entered` / `notify_mouse_exited`.
  `[verified]`
- **F46** — `doc/classes/RenderingServer.xml`: `get_current_rendering_method`,
  `get_current_rendering_driver_name`; the headless empty-string and null-`RenderingDevice` notes.
  `[verified]`
- **F47** — `environment_and_post_processing.rst`, *Using glow in 2D*: "To prevent UI elements from
  glowing, make them children of a CanvasLayer node"; Canvas background; Canvas Max Layer.
  `[verified]`
- **F48** — godot-demo-projects `viewport/gui_in_3d/gui_3d.gd`: the full forwarding algorithm,
  including its `Time.get_ticks_msec()/1000.0` derivation of `relative` and `velocity`. `[verified]`
- **F49** — `renderers.rst`: switching renderers in the editor's upper-right switcher; "manual
  tweaks to your scene, lighting, and environment"; no reimport requirement stated. `[verified]`
- **F50** — `doc/classes/Viewport.xml` `physics_object_picking`: default **false**; 64
  simultaneously pickable objects; "selected in a non-deterministic order";
  `physics_object_picking_sort`, `physics_object_picking_first_only`. `[verified]`
- **F51** — `doc/classes/CollisionObject3D.xml`: `input_event` parameter 0 declared `Node`;
  `mouse_entered`/`mouse_exited` "may be delayed or skipped with fast mouse movement";
  `input_ray_pickable` default true; `input_capture_on_drag` default false; the collision_layer
  requirement. `[verified]`
- **F52** — Godot docs, *Viewports*, queried directly for focus / keyboard / tooltip / popup /
  accessibility: none present; the `gui_in_3d` demo is silent on tooltips and focus.
  `[not-settled]`
- **F53** — godotengine.org/releases/4.5 and godotengine/godot#76829 (AccessKit): desktop-only and
  experimental; `docs.godotengine.org/en/4.7/tutorials/ui/accessibility.html` returns HTTP 404.
  `[unverified]`
- **F54** — straydragon.github.io/godot-csharp-api-doc, `4.4-stable` and `4.3-stable`,
  `Godot.Viewport`: `PushInput`, `PushUnhandledInput` (obsolete), `NotifyMouseEntered`,
  `NotifyMouseExited`, `GetCamera3D`, `UseHdr2D`, `PhysicsObjectPicking`,
  `Node.NotificationVpMouseEnter`. A third-party generated mirror, neither first-party nor 4.7.
  `[likely]`
- **F55** — Godot docs, *Exporting for dedicated servers*, queried for 3D / GPU / headless scene
  instantiation: nothing either way; the nearest material is the Strip Visuals export mode.
  `[not-settled]`
- **F56** — Godot docs, *Command line tutorial* + `main/main.cpp`: `--headless` = `--display-driver
  headless --audio-driver Dummy`; the `--` user-arguments separator read by
  `OS.get_cmdline_user_args`. `[verified]`
- **F57** — `main/main.cpp`: the only visible `RasterizerDummy::make_current()` sits in the
  test-setup entry point, not demonstrably the `--headless` path. `[likely]`
- **F58** — `doc/classes/Engine.xml`: `get_architecture_name` returns the architecture **the binary
  was built for**, so an x86_32 binary on x86_64 hardware still reports `x86_32`. `[verified]`
- **F59** — `doc/classes/InputEventMouseMotion.xml`: `relative` scales with content scale;
  `screen_relative` is recommended under captured mouse. `[verified]`
- **F60** — `doc/classes/Input.xml`: `MOUSE_MODE_VISIBLE`/`CAPTURED` and the note directing captured
  motion to `InputEventMouseMotion.relative` — in tension with F59. `[verified]`
- **F61** — `doc/classes/BaseMaterial3D.xml`: `emission_enabled`, `emission`,
  `emission_energy_multiplier`, `shading_mode`, with defaults; **no note links emission to glow**.
  `[verified]`
- **F62** — `doc/classes/ImmediateMesh.xml`: `surface_begin`, the attribute setters,
  `surface_add_vertex`, `surface_end`, `clear_surfaces`. `[verified]`
- **F63** — Godot docs, *Procedural geometry* index: ImmediateMesh for geometry that changes every
  frame; ArrayMesh and SurfaceTool for static geometry. `[verified]`
- **F64** — `modules/csg/doc_classes/CSGShape3D.xml`: "significant CPU performance cost"; "CSG mesh
  data updates are deferred … a delay of one rendered frame". `[verified]`
- **F65** — `modules/csg/doc_classes/CSGPolygon3D.xml`: MODE_PATH along a `Path3D`; "intended to be
  used for level prototyping". `[verified]`
- **F66** — Godot docs, *Physics introduction*: "Physics in Godot, regardless of physics engine, is
  not deterministic". `[verified]`
- **F67** — godot-docs 4.7 `using_jolt_physics.rst`: no determinism statement anywhere on the page.
  `[verified]` as a negative result
- **F68** — `doc/classes/SoftBody3D.xml`: members and defaults; no determinism guarantee.
  `[verified]`
- **F69** — `doc/classes/AudioServer.xml`: `add_bus`, `set_bus_name`, `set_bus_send`,
  `add_bus_effect`, `get_bus_index` (−1 if absent), `get_driver_name`; `--headless` sets the Dummy
  driver. `[verified]`
- **F70** — `doc/classes/AudioStreamPlayer3D.xml`: `ATTENUATION_DISABLED`; **"no validation is
  performed to see if the given name matches an existing bus"**. `[verified]`
- **F71** — `doc/classes/AudioStreamRandomizer.xml`: no seed and no RNG control is exposed anywhere
  in the class. `[verified]`
- **F72** — `doc/classes/AudioEffectReverb.xml` and `AudioEffectEQ.xml`: property names and
  defaults. `[verified]`
- **F73** — godotengine.org/download/archive/4.7.2-stable and Godot docs *Exporting projects*: the
  two template archives; the mono `.tpz` covers Linux and Windows x86_64. `[verified]`
- **F74** — godot `4.7.2-stable`
  `modules/mono/editor/GodotTools/GodotTools/Build/BuildSystem.cs`: the publish argument list always
  includes `--self-contained true`. `[verified]`
- **F75** — godot `4.7.2-stable` `GodotTools/Export/ExportPlugin.cs` and `GodotTools/Utils/OS.cs`:
  RID composition `{ridOS}-{ridArch}`, the OS and arch maps, `universal` → both macOS archs,
  `data_{CSharpProjectName}_{platform}_{arch}`, and the four failure strings. `[verified]`
- **F76** — Godot class reference, `EditorExportPlatformWindows`: `binary_format/architecture`,
  `debug/export_console_wrapper`, `codesign/enable`. `[verified]`
- **F77** — Godot class reference, `EditorExportPlatformLinuxBSD`: `binary_format/architecture` and
  the filter keys. `[verified]`
- **F78** — godot `4.7.2-stable` `editor/export/editor_export_platform_pc.cpp`:
  `debug/export_console_wrapper` is an INT enum defaulting to 1 = *Debug Only*; the `.console.exe`
  copy path. `[verified]`
- **F79** — godot `4.7.2-stable` `platform/windows/console_wrapper_windows.cpp`: `CreateProcessW`,
  the job-object completion port, `GetExitCodeProcess`. Returned as a structural description, not
  literal source. `[likely]`
- **F80** — learn.microsoft.com, *.NET RID catalog*: `win-x64`, `linux-x64`, `osx-x64` are real
  catalog RIDs; macOS RIDs use the older "OSX" branding. `[verified]`
- **F81** — Godot docs, *Exporting for Windows*: signing is opt-in via `codesign/enable`; no rcedit
  requirement; `platform/windows/export/export_plugin.cpp` contains no `rcedit` line. `[verified]`
- **F82** — support.apple.com HT211861, *Using Intel-based apps on a Mac with Apple silicon*:
  Rosetta must be installed and installs on first opening an Intel app; "Rosetta will remain
  available through the forthcoming macOS 27", restricted from macOS 28. `[verified]`
- **F83** — Godot docs, *Exporting for macOS*: the executable-bit hazard is documented **only** for
  the Windows → macOS direction; `EditorExportPlatformPC::get_chmod_flags()`'s LinuxBSD value was
  not obtained. `[not-settled]` for the macOS → Linux direction
- **F84** — dotnet/runtime#44897 and learn.microsoft.com `dotnet/core/install/macos`: Rosetta framed
  as an interim measure with page-size, emulation-crash and debugger problems; **no statement that
  x64 .NET under Rosetta is a supported configuration**. `[unverified]`
- **F85** — learn.microsoft.com, *.NET application publishing*: a self-contained publish bundles the
  runtime, and "doesn't include the native dependencies of .NET", which "must be present on the
  environment before the app runs". `[verified]`
- **F86** — learn.microsoft.com, *dotnet publish*: `-r|--runtime <RID>` cross-publish is
  first-class; publish restores implicitly. The runtime-pack acquisition itself is not documented in
  the pages read. `[verified]` for the option, `[unverified]` for the acquisition
- **F87** — learn.microsoft.com, *Install .NET on Ubuntu*: for 24.04, `ca-certificates`, `libc6`,
  `libgcc-s1`, `libgssapi-krb5-2`, `libicu74`, `libssl3t64`, `libstdc++6`, `tzdata`, `zlib1g`.
  `[verified]`
- **F88** — keith.github.io/xcode-man-pages/arch.1.html: `arch` executes a universal binary using a
  specified architecture; `-x86_64` reported as prose, not quoted roff. `[likely]`
- **F89** — `doc/classes/AudioStreamPolyphonic.xml`: `polyphony` default 32; **what happens when the
  limit is exceeded is not stated**. `[verified]` for the default, `[not-settled]` for the overflow
- **F90** — godotengine.org/releases/4.7: "the Vulkan Mobile renderer matches or even outperforms
  our Compatibility renderer in benchmarks"; HDR **output** is distinct from HDR **2D**; the
  per-platform export-template downloader; and, as a negative result, no Compatibility / OpenGL /
  Metal / glow / SubViewport / audio / C# item and no breaking-changes section. `[verified]`
- **F91** — `doc/classes/OS.xml`: `get_name`, `get_processor_name` (empty on Android and Web), with
  no headless caveat — the proof line of §2.10 rests on this. `[verified]`
- **F92** — `doc/classes/Camera3D.xml`: `fov` default 75, `project_ray_origin`,
  `project_ray_normal`, `unproject_position`, `is_position_behind`. **Godot documents no orbit
  helper**, so `OrbitMath` is built by hand and no API name is invented for it. `[verified]`
- **F93** — `doc/classes/InputMap.xml` and ProjectSettings `input/*`: the project input map lives
  under `input/*`; `godot/project.godot` has **no** `[input]` section today, so every action P4 adds
  is new. `[verified]`
- **F94** — `servers/physics_3d/physics_server_3d.cpp` and `servers/register_server_types.cpp`:
  the key is `physics/3d/physics_engine`, registered as
  `GLOBAL_DEF(PropertyInfo(Variant::STRING, …, PROPERTY_HINT_ENUM, "DEFAULT"), "DEFAULT")` — the
  stored value is `DEFAULT` and the hint is extended at runtime by whichever physics servers
  register themselves; and `using_jolt_physics.rst`: Jolt is the default 3D engine from 4.4. The
  repository's `godot/project.godot` has **no physics section at all**, so the effective engine is
  whatever `DEFAULT` resolves to — which Phase 4 leaves alone, because it uses no physics
  simulation. `[verified]`

## Appendix H — `TactileTheme` tokens

`W` = panel width. Every value is a fraction of `W` unless stated. `Tag` is one of **pinned** (a
line or line range in `main.css`, `src/ui/panel-view.ts` or `src/ui/inspector.ts`), **derived** (a
ratio from the research package or from this plan), **chosen** (an invention, which must name an
O-P row, or — for the twelve camera tokens and only those — presentation rule **PR-8**). Gate 3.2.21
reads this table's shape.

**`main.css` is the repository-root stylesheet**; there is no `src/ui/main.css`. `panel-view.ts` and
`inspector.ts` are under `src/ui/`. Gate 3.2.21 case (b) accepts a **line or a line range** in any of
the three, because nine of the pinned rows sit inside one CSS block.

**`Wave`** is the wave that writes the row: **P4** for the twenty-six `TactileTheme.cs` is created
with, **P6** for the original remaining forty-eight plus the approved nine-row
geometry/material/lighting supplement, fifty-seven total. Gate 3.2.21's count equality is against
the rows marked for the waves that have closed.

| Token | Value | Tag | Wave | Source / derivation | O-P row |
|---|---|---|---|---|---|
| `consoleTeal` | `#62979a` | pinned | P6 | `main.css:2` | — |
| `consoleDark` | `#24241f` | pinned | P6 | `main.css:3` | — |
| `consoleCream` | `#e6dfc7` | pinned | P6 | `main.css:4` | — |
| `consoleRed` | `#a9473d` | pinned | P6 | `main.css:5` | — |
| `consoleRedLit` | `#d65a4b` | pinned | P6 | `main.css:6` | — |
| `cordColour` | `#cf5c4c` | pinned | P4 | `main.css:197` — itself a recorded UI invention | O-P10 |
| `holeHit` | 0.0105 W | pinned | P6 | `main.css` **544–545**, 1.05 cqi (cqi = 1 % of W) | — |
| `lampLens` | 0.024 W | pinned | P6 | `main.css` **601**, 2.4 cqi | — |
| `lampBezel` | 0.0038 W | pinned | P6 | `main.css` **594–627**, 0.38 cqi at 594 for lamp/jewel and independently at 627 for pushbutton/breaker | — |
| `jewel` | 0.0175 W | pinned | P6 | `main.css` **619**, 1.75 cqi | — |
| `pushbutton` | 0.034 W | pinned | P6 | `main.css` **632**, 3.4 cqi | — |
| `breaker` | 0.031 W | pinned | P6 | `main.css` **633**, 3.1 cqi | — |
| `slide` | 0.032 × 0.0115 W | pinned | P6 | `main.css` **640–641** | — |
| `powerSwitch` | 0.0115 × 0.032 W | pinned | P6 | `main.css` **648** | — |
| `rivet` | 0.008 W | pinned | P6 | `main.css` **651–652**, 0.8 cqi | — |
| `relayBody` | 0.095 × 0.058 W | pinned | P6 | `src/ui/panel-view.ts` 104–113 | — |
| `knobSquare` | 0.085 W | pinned | P6 | `src/ui/panel-view.ts` 104–113 | — |
| `crossbarShift` | `travel × 1.6 / 1000 − 0.8` cqi | pinned | P6 | `src/ui/inspector.ts` **855** | — |
| `dialRotation` | `udeg / 1e6` degrees | pinned | P6 | `src/ui/inspector.ts` **871** | — |
| `glowIntensity` | 0.3 | **derived** | P6 | Godot `Environment.glow_intensity` default, carried unchanged `[verified: F40]` | — |
| `holeDiameterToken` | 0.0040 W | derived | P6 | PH2's ≈16 px hole against the ≈4032 px console-outline span `[unverified: BAND-3 for the 16 px, CASE-6 for the span]`; the channel-pitch reading agrees (453 px = 0.113 W → ≈4009 px), and both round to 0.0040. **A redraw token, not a dimension** — BAND-3 says so in terms — and **ink and hole scale, never a bezel dimension**. Renamed from `physicalHoleDiameter`: the old name asserted a physical measurement the package does not have | — |
| `printedRingOD` | 0.0060 W | derived | P6 | PH2's ≈24 px printed ring OD against the same ≈4032 px span `[unverified: BAND-3, CASE-6]`; printed ink, hole off-centre inside it | — |
| `knobWedgeRadiusOverInnerCircle` | 0.769 | derived | P6 | PH2 150 / 195; ratio of the knob body-and-wedge radius to the decimal inner-circle radius, **not** wedge radius to body radius | O-P12 |
| `subViewport` | 2880 × 1600 | derived | P4 | 1.8:1; hole target 30.24 texture px ≥ 24; ≥ 1.5 texture px per window px at 1920 wide (§2.4) | — |
| `cordRadius` | 0.0025 W | derived | P4 | **0.625** × `holeDiameterToken` (0.625 × 0.0040 = 0.0025; the earlier "0.6 ×" did not reproduce the shipped value) | O-P10 |
| `dtStep` | 240 steps per second, exact integer accumulator: `acc += clamp(dtUs,0,50_000) × 240; steps = acc / 1_000_000; acc %= 1_000_000` (§2.5) | chosen | P4 | chosen presentation token, no source; stated as a rational, never as a float seconds constant | O-P10 |
| `convergeSteps` | 480 | chosen | P4 | chosen presentation token, no source; two seconds at 240 steps/s. Gate 3.2.17(c)'s K | O-P10 |
| `rebuildEpsilon` | 0.0001 W | chosen | P4 | chosen presentation token, no source; `CordMesh`'s per-cord cache threshold | O-P10 |
| `cordGravityWPerStep2` | 0.00002 W per fixed step² | chosen | P4 | chosen presentation token, no source; a W-relative acceleration, not a physical one. A position-based verlet is defined by it, and gate 3.2.17(c)'s convergence is a direct function of it (§2.5) | O-P10 |
| `cordRelaxIterations` | 4 per fixed step | chosen | P4 | chosen presentation token, no source; rest-length pass then plane pass, in that order (§2.5) | O-P10 |
| `cordDamping` | 1.0 — no velocity damping | chosen | P4 | chosen presentation token, no source; the plane and rest-length constraints are the only dissipation, stated as a row so the absence is a decision rather than an omission (§2.5) | O-P10 |
| `caseHeight` | 0.20 W | chosen | P6 | chosen redraw token, no source; the WP 5⅛/24 figure is a named rejected candidate | O-P11 |
| `caseEdgeRadius` | 0.006 W | chosen | P6 | chosen redraw token, no source | O-P11 |
| `footCount` | 4 | chosen | P6 | chosen redraw token, no source; only "feet exist" is sourced | O-P11 |
| `footRadius` | 0.012 W | chosen | P6 | chosen redraw token, no source | O-P11 |
| `footHeight` | 0.006 W | chosen | P6 | chosen redraw token, no source | O-P11 |
| `footInset` | 0.03 W | chosen | P6 | chosen redraw token, no source | O-P11 |
| `plateRecess` | 0.004 W | chosen | P6 | chosen redraw token, no source | O-P17 |
| `lampLensProud` | 0.010 W | chosen | P6 | chosen redraw token, no source | O-P18 |
| `lampBezelProud` | 0.004 W | chosen | P6 | chosen shared bezel-ring proud height for lamp, pushbutton, breaker and jewel; no source. The jewel barrel remains the separate 0.008 W row below | O-P18 |
| `jewelBarrelProud` | 0.008 W | chosen | P6 | chosen redraw token, no source; **only the barrel's proud height is registered here — the jewel's lens and bezel *type* is O-P5's still-open question, whose fallback §2.6 follows verbatim** | O-P18 / O-P5 |
| `pushbuttonCapProud` | 0.012 W | chosen | P6 | chosen redraw token, no source | O-P15 |
| `pushbuttonStroke` | 0.006 W | chosen | P6 | chosen redraw token, no source | O-P15 |
| `breakerProud` | 0.010 W tripped / 0.006 W reset | chosen | P6 | chosen redraw token, no source | O-P15 |
| `slideActuatorProud` | 0.006 W | chosen | P6 | chosen redraw token, no source | O-P15 |
| `crossbarProud` | 0.008 W | chosen | P6 | chosen redraw token, no source | O-P15 |
| `knobHeight` | 0.020 W | chosen | P6 | chosen redraw token, no source | O-P12 |
| `taperPinStub` | 0.008 W | chosen | P4 | chosen redraw token, no source | O-P10 |
| `cordSlack` | 1.15 | chosen | P4 | chosen redraw token, no source | O-P10 |
| `cordSegments` | 16 | chosen | P4 | chosen redraw token, no source; P5 gate 3.2.18 second performance rung | O-P10 |
| `tubeSides` | 6 | chosen | P4 | chosen redraw token, no source; P5 gate 3.2.18 first performance rung | O-P10 |
| `cameraFovDeg` | 45 | chosen | P4 | engineering token; no physical claim | **PR-8** |
| `cameraWireFovDeg` | 15 | chosen | P4 | wire-view-only engineering token; the original 45° gate was infeasible across `[cameraDollyMinW, 2.2 W]`, so Tom approved a dedicated wire FOV while normal orbit remains 45° | **PR-8** |
| `cameraElevationDeg` | 25–90 | chosen | P4 | engineering token; the **envelope**. The wire pose's own elevation is the separate row `cameraWireElevationDeg` below | **PR-8** |
| `cameraAzimuthDeg` | ±60 | chosen | P4 | engineering token | **PR-8** |
| `cameraDolly` | 0.6–2.2 W | chosen | P4 | engineering token | **PR-8** |
| `cameraDollyMinW` | 0.45 W | chosen | P4 | engineering token; the **floor** of gate 3.2.9b's solve interval — the nearest pose the case geometry permits. It is never widened to make that gate pass; if no dolly in `[cameraDollyMinW, 2.2 W]` reaches 24 px the gate **fails** | **PR-8** |
| `cameraDefaultPose` | (55°, 0°, 1.6 W) | chosen | P4 | engineering token | **PR-8** |
| `cameraWireDollyW` | **0.639434 W**, solved by gate 3.2.9b — the largest dolly in the closed interval `[cameraDollyMinW, 2.2 W]` that keeps every hole's projected extent ≥ 24 px at 1440 × 900 over azimuth ±60°, at `cameraWireElevationDeg` and `cameraWireFovDeg` | chosen | P4 | engineering token; **not chosen by an executor** — `P4OrbitMathTests` solved it, observing 24.000031 px at 1440 × 900 and 28.800018 px at 1920 × 1080. The interval was not widened | **PR-8** |
| `cameraWireElevationDeg` | 45° | chosen | P4 | engineering token, **a stated choice, not a solve**: the criterion rises monotonically toward 90°, where the 3D view is indistinguishable from `flat`, so a feasibility-maximising solve would return the flat view. 45° is fixed here and `cameraWireDollyW` is solved at it | **PR-8** |
| `orbitDegPerPixel` | 0.25 | chosen | P4 | engineering token; the orbit gesture's rate (§2.3's key table). Without a row, `OrbitCamera.cs` would ship it as a literal and fail gate 3.2.21 case (f) | **PR-8** |
| `dollyPerWheelNotch` | 0.08 W | chosen | P4 | engineering token; the wheel-dolly rate | **PR-8** |
| `panWPerPixel` | 0.0008 | chosen | P4 | engineering token; the middle-drag pan rate | **PR-8** |
| `glowBloom` | 1.0 | chosen | P6 | chosen redraw token, no source; P0 visibility tuning | O-P14 |
| `glowHdrThreshold` | 0.1 | chosen | P6 | chosen redraw token, no source; P0 visibility tuning | O-P14 |
| `lampEmissionMax` | 2.0 | chosen | P6 | chosen redraw token, no source | O-P14 |
| `lampColour` | `consoleRedLit` | chosen | P6 | chosen redraw token; the only sourced statement is that the lamps are under-driven, hence warm and dim | O-P14 |
| `chalkyCore` | `#d8d2bf` | chosen | P6 | chosen redraw token; the coating-over-lighter-core stack is sourced, the value is not. **One consumer only: the exposed plate edge inside `plateRecess`, where the coating stops** — never a chip, a scratch or mottling. O-P1's fallback is "do not model material", and a single edge-colour token is the narrowest reading of it | O-P1 |
| `bobbinWhite` | `#f2efe6` | chosen | P6 | chosen redraw token; "white/cream" is a description, the value is not sourced. O-P16's question is **extended** to ask for these RGB values, so the unknown is findable in the register | O-P16 |
| `springCopper` | `#b87333` | chosen | P6 | chosen redraw token; "brown/copper springs" is a description, the value is not sourced. Registered under O-P16's extended question | O-P16 |
| `taperPinGrey` | `#8a8f94` | chosen | P4 | chosen redraw token; "grey metal taper pins" is sourced, the value is not | O-P10 |
| `chromeMetallic` | 0.9 | chosen | P6 | chosen redraw token; "chrome/cream bezel" is a **colour**, sourced for the pushbutton and breaker only — no gloss, metalness or roughness is given anywhere. Registered under O-P18's extended surface-response question | O-P18 |
| `chromeRoughness` | 0.3 | chosen | P6 | as `chromeMetallic`; split into its own row so the token count equals the row count, which is what gate 3.2.21 asserts | O-P18 |
| `frameFinish` | matte, roughness 0.7 | chosen | P6 | chosen redraw token; **no source describes the frame's finish** — the matt-coat finding is scoped to the dark plates. Filed under **O-P18's extended surface-response question**, which names the console frame, and **not** under O-P2, whose question is true paint *colours* and does not cover a finish | O-P18 |

**Approved P6 geometry/material/lighting supplement — nine rows.** These rows close implementation
choices the original seventy-four-row table left unnamed; they do not alter any original row.

| Token | Value | Tag | Wave | Source / derivation | O-P row |
|---|---|---|---|---|---|
| `jewelBezel` | 0.0022 W | pinned | P6 | `main.css:621`, 0.22 cqi POWER-jewel border width | — |
| `meshQuality` | radial segments 24; case-corner segments 4 | chosen | P6 | chosen redraw token; shared radial tessellation and case-corner subdivision change silhouette quality, not modeled dimensions | O-P11 |
| `footColour` | `#24241f` | chosen | P6 | chosen redraw token; no source gives the rubber feet colour. Equality with `consoleDark` is intentional, not a sourced alias | O-P11 |
| `slideThrow` | 0.010 W total centre-to-centre travel | chosen | P6 | chosen redraw token; lateral actuator travel is not measured and is mapped linearly from `travel` 0..1000 | O-P15 |
| `knobSurface` | body `#4a2426`; wedge angle 40°; roughness 0.65 | chosen | P6 | chosen PH2 redraw values for the dark brown/maroon body and top-face pie wedge. The frozen `decimal/inner-circle` linework's `RadiusX` 0.032 W times `knobWedgeRadiusOverInnerCircle` supplies the radius of both body and wedge, so the wedge reaches the body rim; `knobSquare` remains only the 2D artwork/pick footprint. `knobHeight` supplies height and wedge colour is `consoleCream` | O-P12 |
| `relayForm` | bobbin 0.030 × 0.034 W; crossbar 0.018 × 0.032 W; slot 0.005 × 0.022 W, depth 0.003 W; each contact stack 0.035 × 0.009 W at ±0.015 W; fixed proud 0.010 W; 4 spring strips per stack at 0.5 strip-to-pitch fill; spring metallic 0.75, roughness 0.45 | chosen | P6 | chosen PH2-top-view redraw values; no scale-referenced relay dimensions or resolved spring spacing exist. Existing `relayBody`, `crossbarShift`, `crossbarProud`, `bobbinWhite` and `springCopper` supply the remaining values | O-P16 |
| `jewelKnurl` | 24 teeth; 0.0006 W alternating-radius depth | chosen | P6 | chosen redraw token; PH3 establishes knurling but not tooth count or depth | O-P18 |
| `lampSurface` | base alpha 0.65; roughness 0.45 | chosen | P6 | chosen redraw token; translucency and diffusion are unsourced. This is the 3D lens's base material only: it neither replaces nor multiplies the unchanged 2D alpha `milli / 1000`, and emission remains independently linear with no added persistence | O-P14 |
| `sceneLighting` | neutral `#ffffff`; directional energy 1.25 at pitch/yaw (−45°, −30°); flat ambient energy 0.35 | chosen | P6 | chosen neutral presentation illumination for material display; no source specifies original lighting. Runtime framed captures determine whether this minimal setup is adequate; it makes no factual claim about original lighting | O-P18 |

The twelve engineering camera tokens carry no O-P row deliberately: they describe a virtual camera,
not the machine, so they belong in the presentation-rule log, not in the research register — and
they name **PR-8**, a real row in Appendix I written for exactly this purpose. A carve-out that
pointed at no row would leave the `OpenQuestion` field with nothing legal to hold and
`TactileThemeTests.cs` unwritable. Gate 3.2.21 case (d) accepts `chosen` + `PR-8` for **exactly
those twelve and no others** — six view/framing, one dolly floor, two wire-pose, three gesture
rates — and fails any other `chosen` token that names a PR id instead of an O-P row.

**Row count: 83 at P6 — 26 at P4 and P5, the original 74 plus the approved nine-row supplement.** One row per named token — `chromeMetallic` and
`chromeRoughness` are separate rows for that reason — so gate 3.2.21's "token count equals the
Appendix H row count" is an equality, taken against the rows marked for the waves that have closed:
the twenty-six `Wave = P4` rows from P4, all eighty-three from P6. The number is re-recorded, not
re-asserted, if a wave adds a token; P0 check 6's Stops ladder may change `cordSegments` and
`tubeSides` **values** but adds no row.

**Before P4 starts, and again at every wave close, this table is re-read against §§2.4–2.8 for any
named constant that has no row** — `dtStep`, `convergeSteps` and `rebuildEpsilon` were found that
way, and so were `cordGravityWPerStep2`, `cordRelaxIterations` and `cordDamping`, which §2.5 had
left to the executor's invention while gate 3.2.17(c), (e) and (f) measured them. **Before P4**,
not before P6: `CordLay.cs` and `CordMesh.cs` are written at P5, so a sweep scheduled at P6 runs a
wave after the file that needs the rows. The two mechanical
backstops are gate 3.2.21's count equality (a token in `TactileTheme` with no row fails) and its
case (f) (a geometry literal outside `TactileTheme` fails), so a missed constant is caught rather
than shipped; the re-read is what keeps it from being caught late.

**Gate 3.2.21's eight cases** (`TactileThemeTests.cs` implements them):
*(a)* every token's `Tag` is one of pinned, derived, chosen;
*(b)* every `pinned` token names a line or line range in root `main.css`, `src/ui/panel-view.ts` or
`src/ui/inspector.ts`;
*(c)* every `derived` token names the ratio, or the engine default, it comes from;
*(d)* every `chosen` token names an O-P row, except the twelve camera tokens, which name PR-8; any
other `chosen` token naming a PR id fails;
*(e)* no token name and no source string matches
`/\b(inch|inches|mm|millimet|centimet|cm|metre|meter|pound|lb|lbs)\b/i`;
*(f)* over `godot/scripts/{Case3D, Knob3D, Relay3D, Bezels, PopOuts, LampGlow, CordLay, CordMesh,
Stage3D, OrbitCamera, OrbitMath, QuadMap}.cs`, using the `CorePurityTests` literal masker, no numeric
literal that is a dimension, colour, angle, rate, count or threshold appears; every such value is
read from `TactileTheme`. Exactly one closed list of pure-arithmetic constants is permitted: `0`,
`1`, `-1`, `2`, `0.5`, `180`, `360`, `100` (the tick microsecond), `1000` (the contract denominator
for `milli` and `travel`), `50_000` (the catch-up clamp, `FrameLoop.cs`'s `MaxCatchUpUs`) and
`1_000_000` (the µs-per-second and µdeg-per-degree divisor), plus array indices. A literal outside
it fails, naming the file and line. **The list is extended in this plan and in the dated record,
never in the test;**
*(g)* `PanelTheme.cs` declares no literal that duplicates an Appendix H row's value;
*(h)* the Appendix H rows have the same token-name set as `TactileTheme.Tokens`, with the same
normalized tag and O-P/PR provenance on every row.

## Appendix I — the presentation rule log

The `phase-3-godot.md` divergence-log discipline, applied to presentation: one row for every rule
the documents did not determine, folded back into a rule rather than left as a silent local
decision. Each wave adds rows.

| # | Rule | Why it was needed | Folds into |
|---|---|---|---|
| PR-1 | The input forwarder rewrites only `Position` and `GlobalPosition`; `Relative` is the pure delta of the previous forwarded quad-local pixel position; `Velocity` is left at zero; **no clock is read** | The canonical `gui_in_3d` algorithm derives both from `Time.get_ticks_msec()` `[F48]`, which is a second clock in the input path and fails this plan's own boundary scan | §2.4; boundary-scan rule 6; gate 3.2.13 |
| PR-2 | The cord tube starts at the top of the pin stub, so the 2D handle ring stays visible and hittable underneath it | Pop-outs and tubes draw above the quad while only the quad is pickable; without the rule a cord occludes its own only affordance | §2.5; gate 3.2.19 |
| PR-3 | The view toggle rebuilds **only the stage subtree** — it frees one of `Stage2D` / `Stage3D`, builds the other, reparents the unchanged panel `Control` tree, and rebuilds camera pose, `CordLay` particles and cord meshes. It **never** touches `Session`, `Machine`, `FrameLoop` or the `Loop` node's `Current` field, and emits no Command; the machine keeps its tick. Chrome is screen-space in both modes; the panel Control tree is identical in both | Nothing in the record says where the non-panel UI lives in 3D, and painting it on the panel face would be absurd. And "the toggle rebuilds the mount" would mean constructing a fresh `Machine` and replaying the demo — discarding a user's manual wiring and restarting the trace at tick 1 — which no gate would otherwise catch, because 3.2.16 drives the two modes as separate runs | §2.3; Appendix B; gate 3.2.16 `toggle-preserves-tick` |
| PR-4 | The shell consumes a key only when no panel Control has focus; the shell's key list is closed; the mouse is never captured | The forwarding pattern hands the outer tree every non-mouse event first, and arrows/Home/End are already pinned panel keys; and `relative` vs `screen_relative` under capture is a documented contradiction `[F59, F60]` | §2.3; Appendix C; gate 3.2.2 in 3D |
| PR-5 | **R12 resolved no at P0:** both view modes retain one global `AudioStreamPolyphonic` pool with `Polyphony = 32`, the global drop-not-retry rule, six fixed relay offsets, one new drop-out sample, and one default `Room` reverb bus. No `AudioStreamPlayer3D` is instanced and the camera is not an audio dependency. Spatial relay cues remain a tripwire | The audible-separation prerequisite was not established; changing allocation and listener semantics without it would add an unverified divergence | §2.8; gate 3.2.23; risk 12's disclosure text |
| PR-6 | Exactly **34** identity-tagged pop-outs are drawn over the 2D artwork, which stays as the footprint: six relay crossbars, six pushbutton caps, six slide actuators, POWER slide, breaker cap, dial knob, twelve lamp lenses and the POWER jewel. Pop-outs and cord meshes carry **no** collision shape; all picking stays on the single quad `Area3D` | Every mirrored part would otherwise be drawn twice with undefined pick ownership, and a collider would steal the quad's deterministic pick ownership | §2.6; gate 3.2.20 |
| PR-7 | The Godot composition-root tier is **six** files, not five: `Acceptance.cs` joins `Boot.cs`, `Session.cs`, `DemoLibrary.cs`, `SelfTest.cs` and `GodotResourceSource.cs`, with `SelfTest.cs`-level access plus `Stopwatch` / `Time.*` for harness timing. It is reachable only under `--acceptance`, is never on the `--selftest` or normal path, and emits no `Command`. **R16 also carries the one accessibility change it forces in `Boot.cs`**: `Start` becomes `internal` (`Boot.cs` 39) so gate 3.2.1's hermetic refusal case can call it, and its body is extracted verbatim into `internal void BuildConsole(...)` so `Boot` and `Acceptance` share one composition body. `Refuse` stays `private` — nothing outside `Boot` calls it | `phase-3-godot.md` §2.2's five-file list is the most binding boundary rule in the project `[verified: B-22]`, and the settled precedence rule is that such prose is amended by a **dated entry**, never by a plan sentence. Every class-A gate depends on the widening, so it is stated once, ruled once, and recorded once. **`architecture.md` §13.6.5 is rules 18–21 and carries no tier text, so nothing there is amended; and the `Stopwatch`/`Time.*` exemption is to this plan's boundary-scan rule 6, not to determinism rule 20, which is unamended** | §2.2; ruling **R16**; Appendix A's `Acceptance.cs` row; P0 step 20's DECISIONS entry |
| PR-8 | The camera envelope is a **closed set of twelve engineering tokens** — six **view/framing**: normal `cameraFovDeg` 45, wire-only `cameraWireFovDeg` 15, `cameraElevationDeg` 25–90, `cameraAzimuthDeg` ±60, `cameraDolly` 0.6–2.2 W, `cameraDefaultPose` (55°, 0°, 1.6 W); one **dolly floor**: `cameraDollyMinW` 0.45 W, never widened to make gate 3.2.9b pass; two **wire-pose**: `cameraWireElevationDeg` 45° and `cameraWireDollyW` 0.639434 W, solved at that elevation and the wire FOV; three **gesture rates**: `orbitDegPerPixel` 0.25, `dollyPerWheelNotch` 0.08 W, `panWPerPixel` 0.0008. They describe a virtual camera, not the machine, so they carry a presentation-rule id rather than an O-P row | At 45° FOV the best result across the complete permitted dolly interval was only 9.122437 px at the 0.45 W floor, so the original gate was infeasible. Tom approved the dedicated 15° wire FOV on 2026-09-07; normal orbit remains 45°. The solved wire dolly then yields 24.000031 px at 1440 × 900 and 28.800018 px at 1920 × 1080. After review exposed that navigation immediately discarded this framing, Tom ruled on 2026-09-08 that orbit and pan retain 15°, dolly is clamped to 0.6–0.639434 W, and Fit/R returns to the normal camera. The gesture rates remain registered because gate 3.2.21 forbids local camera-rate literals | §2.4; §2.3's key table; Appendix H's twelve camera rows; gate 3.2.9b; gate 3.2.21 cases (d) and (f) |

## Appendix J — tripwires

Deferred work with a named trigger, so it is not lost.

| Tripwire | Trigger condition |
|---|---|
| **Cord–cord collision** | A cord visibly passes through a relay crossbar during ordinary operation of any of the eleven demos, **or** a user report of cords reading as intersecting. The primary-source hook is recorded: ERRATA step 4 tells the owner to replace short wires with longer ones so they do not interfere with the relay arms |
| **Spatial relay audio** (R12 resolved **no** at P0) | R12 is revisited when Tom can run P0 check 8(b) in a local-audio session not mediated by screen sharing/RDP, and that check records audible separation; the six-pool shape and its drop rule are already specified in §2.8 and PR-5 |
| **Screen-reader parity** | Godot's AccessKit integration leaves experimental status, **or** the canonical 4.7+ accessibility documentation becomes reachable and states SubViewport behaviour. Until then the claim stays keyboard, focus, tooltips and reduce-motion only |
| **The Windows leg** (triggered and reassessed at P7; still deferred) | The replacement Linux proof host becoming documented as WSL2 fired the new-host trigger on 2026-09-10. Its read-only PowerShell interop probe returned `powershell.exe: command not found`, so the tripwire is re-armed for a documented native Windows shell or WSL2→Windows interop on any lab host, **or** for Tom running the `.exe` himself under R8d's second half |
| **A multi-colour / multi-length cord set** | A photographed original wire set with a scale in frame, an SDC accessory catalogue, or a museum lot photograph settles O-P10. Gardi's set may not be the source under any circumstances |
| **Lamp persistence** | A photograph or video of an unmodified powered unit shows visible smear beyond the core's own `milli` ramp, settling the ERRATA Book V p.31 observation into a measurable effect |

