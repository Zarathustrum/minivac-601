# Phase 3 — the Godot port

Status: Phase 3 is complete through G4; the application waves it left unauthorized (G5, G6) were
delivered by reference under Phase 4 (`docs/plans/phase-4-presentation.md`). `docs/STATUS.md`
carries current state, and Tom's Phase 3 rulings are recorded in `docs/DECISIONS.md`
(*2026-09-03 — engine target: Godot supersedes Unity*). What remains here is the design: §1.4's
contract rulings, §2's architecture, and the appendices the code and tests cite. Gate numbers
(`gate 3.n.m`), wave names (G0–G6) and G0 check numbers below are labels from this plan's
acceptance-gate and build-wave sections, which were removed once Phase 3 closed.

This plan delivers Phase 3 of `docs/PROJECT-BRIEF.md` retargeted from Unity to Godot: a C# port of
the core proven bit-exact against the existing conformance artifacts, the port guide written from
that port, and a Godot 4 desktop application that runs the ported core at the web console's
period-accurate-flat fidelity. It does not start the tactile 3D version and it does not publish.

Binding inputs, in precedence order: `docs/DECISIONS.md` (the 2026-09-03 entry governs wherever
older text says Unity); `docs/plans/architecture.md` §13.6 (the Phase 3 amendment), then its
§§1–13; the conformance artifacts under `test/conformance/` and `data/kat/`; this plan;
`docs/plans/phase-2-console.md` as the parity reference for a later playable-console decision.
Where architecture prose and shipped code disagree, this plan follows the code the goldens were
blessed against, as `DECISIONS.md` now settles, and §13.6.8 records every known
disagreement so a porter does not rediscover them.

Nothing here re-opens a ruling in `DECISIONS.md`. Facts about Godot and .NET carry the project's
confidence tags with their sources in Appendix F.

---

## 1. Scope

### 1.4 Contract, schema and data rulings

- **Core frozen.** No Phase 3 module changes `src/core/**`. If the port discovers a real core
  defect, the wave stops and records it; the fix is a Phase 1 core change with its own re-bless,
  never a port-side deviation.
- **Every existing artifact is consumed as-is.** Fixtures, goldens, probes and KATs are read from
  their current locations by the .NET tests and copied byte-for-byte into the Godot project. No
  parallel fixture format, no exported "port fixtures", no side-car expectations.
- **`minivac.panel-layout/1`** is a new application-data schema, not a fixture schema. It carries
  the fifteen data constants exported by `src/ui/panel-layout.ts` and none of its three functions
  (§2.5), and nothing electrical. It is generated, never hand-edited.
- **`data/demo-library.json` and `data/public-assets.json`** are application data the Godot build
  consumes verbatim. The loader rules that exist only in `src/demo-library.ts` — the 256-cord cap,
  hole allocation, the unloaded PLUS-to-MINUS short — are ported as code (§2.6); the schema alone
  is not the loader.
- **`data/` stays the single source.** `godot/data/`, `godot/conformance/` and `godot/audio/` are
  committed copies written only by `npm run sync-data`; a TypeScript test and a .NET test each
  assert byte identity so a drift fails on both sides.
- **The C# core's public API is exactly the set of members exported by `src/core/*.ts`**, name
  for name (§2.4). No additional public member, no convenience overload, no engine-facing helper.
- **Duplicate object keys are an acceptance rule.** A JSON artifact with duplicate object keys is
  accepted on both sides and the last key wins; neither side rejects it. Each implementation has a
  test-local raw input that proves this. `System.Text.Json`'s default handling is `[likely]` until
  G1 confirms it; strict duplicate-property rejection is never enabled. Integer-typed fields
  spelled `1.0` or `1e3` are not an edge: JSON Schema 2020-12 defines `integer` as any number with
  a zero fractional part, so every conformant validator on both sides accepts them `[verified: F19]`.

---

## 2. Architecture

### 2.1 Layout

```
dotnet/
  Minivac.sln
  global.json                       sdk 10.0.400, rollForward latestPatch
  Directory.Build.props             net10.0, Nullable enable, TreatWarningsAsErrors,
                                    InvariantGlobalization true
  Minivac.Core/                     Microsoft.NET.Sdk class library. ZERO PackageReference.
                                    CheckForOverflowUnderflow TRUE; `unchecked` only in Fnv1a64
                                    and, if the limb arithmetic is kept, in Rotary.
    Contract.cs  Ints.cs  Terminals.cs  Netlist.cs  Profile.cs  Graph.cs
    Solve.cs  Devices.cs  Rotary.cs  Trace.cs  Machine.cs
  Minivac.Conformance/              library. IArtifactSource (the ONLY IO seam), FileSystemSource,
                                    FixtureLoader, TraceRunner, ProbeLoader, ProbeRunner,
                                    Fallbacks, StaticClassifier, CollapseMetaTest (with its
                                    expected functional-failure lists as data in this library).
                                    One package: JsonSchema.Net.
  Minivac.Trace/                    console app, AssemblyName minivac-trace, Program.cs only.
                                    Resolves its artifact root by walking up from
                                    AppContext.BaseDirectory to the first directory containing
                                    both data/netlist.json and test/conformance/, and fails with
                                    "minivac-trace: cannot locate the repository root" otherwise.
                                    Reads its one fixture argument with File.ReadAllBytes on the
                                    raw argument string (the only sanctioned File. use, allow-
                                    listed by name in the purity scan); everything the fixture
                                    references goes through IArtifactSource.
  Minivac.Core.Tests/               xUnit. Uses FileSystemSource(rootAbsolutePath) with the
                                    repository root injected (default: solution root/..)
godot/
  project.godot                     config/features (version, "C#" and renderer tags, editor-
                                    maintained); application/run/main_scene = scenes/Main.tscn;
                                    [autoload] SelfTest="*res://scripts/SelfTest.cs"
  Minivac.Godot.csproj              Godot.NET.Sdk/4.7.2; <TargetFramework>net10.0</TargetFramework>
                                    written literally; ProjectReference ../dotnet/Minivac.Core,
                                    ../dotnet/Minivac.Conformance
  export_presets.cfg                macOS Universal 2 G4 proof preset; non-resource include filter
                                    "*.json, *.trace"
  data/                             byte copy of ../data (sync-data)
  conformance/                      byte copy of ../test/conformance/{fixtures,golden,probes,
                                    fixture.schema.json,probe.schema.json} (sync-data)
  audio/                            byte copies of ../public/audio/*.wav (sync-data)
  scenes/Main.tscn                  the console; the only main scene. Its root is the Boot node and
                                    nothing else is scripted in the file: every other node is
                                    instanced by Boot.cs at _Ready, so Boot's --selftest early
                                    return leaves the tree inert.
  scenes/Panel.tscn                 the 2D panel scene: plates, bands, linework, legends, holes,
                                    components, controls, cords layer
  scenes/Stage2D.tscn               the default stage: letterbox, Fit/Wire, zoom, pan; instances
                                    Panel.tscn
  scripts/                          Boot.cs  FrameLoop.cs  Loop.cs  Session.cs  DemoLibrary.cs
                                    GodotResourceSource.cs  SelfTest.cs  Preferences.cs
                                    PanelLayout.cs  PanelTheme.cs  PanelView.cs  Stage.cs
                                    Controls.cs  Cords.cs  CordList.cs  Picker.cs  Lamps.cs
                                    AudioRouter.cs  GodotAudioSink.cs  Toolbar.cs  Drawer.cs
                                    DemoExperience.cs  TraceView.cs  Diagnostics.cs
                                    HelpCredits.cs
docs/port/CSHARP-PORT.md
tools/gen-panel-layout.ts  tools/sync-data.ts  tools/parity.ts
data/panel-layout.json
```

Ignored by git: `dotnet/**/bin/`, `dotnet/**/obj/`, `godot/.godot/`, `godot/bin/`, `godot/obj/`,
`godot/export/` and generated `godot/**/*.import` manifests. Everything else above is tracked.
`.gitattributes` already carries `* -text`;
`test/encoding.spec.ts` extends its byte rules to `godot/data/**` and `godot/conformance/**`
(`godot/audio/*.wav` is binary and excluded from the LF/BOM walk; its identity is checked by hash).

**`IArtifactSource` — the single IO seam.** `byte[] ReadAllBytes(string relativePath)` and
`IReadOnlyList<string> EnumerateFiles(string relativeDir, string pattern)`; results are sorted
with `StringComparer.Ordinal`. Paths are **source-relative**, with `/` separators, under exactly
two roots: `data/` and `conformance/`. `FileSystemSource(string repoRoot)` in
`Minivac.Conformance` maps `data/` to `<repo>/data/` and `conformance/` to
`<repo>/test/conformance/`; `GodotResourceSource` in `godot/scripts/` maps them to `res://data/`
and `res://conformance/` using `FileAccess.GetFileAsBytes` and `DirAccess.GetFilesAt`. The tests
and `Minivac.Trace` use the first; `SelfTest.cs` and `Boot.cs` the second — Boot reads its six
documents (`data/netlist.json`, `data/profiles/MV601-REF-A.json`, `data/profiles/MV601-IDEAL.json`,
`data/demo-library.json`, `data/public-assets.json`, `data/panel-layout.json`) through
`GodotResourceSource.ReadAllBytes`; a test asserts both sources return byte-identical content for
the same relative path. No loader, runner or test calls
`System.IO.File` or `System.IO.Directory` directly — the one exception is `Minivac.Trace` reading
its single fixture argument — and a test scans `Minivac.Conformance/*.cs` for `File.` and
`Directory.` and fails on a hit. Without this seam, Layer 1 would be built on filesystem IO that
cannot read a Godot pack, and gate 3.2.12 would force a rewrite at G4.

**Why in-repo and not a second repository** `[settled]`. `data/` is hashed into every golden
header; a second repository would make the copy the thing that drifts. One repository, one
`npm run sync-data`, two identity tests.

**Why four .NET projects and not one.** The core must be provably engine-free and dependency-free
(its `.csproj` has no `PackageReference`, and a test parses the project file to say so). The
schema validator is a dependency, so it lives one project up. The Godot self-test needs the runner
without the CLI, and the tests need the runner without Godot. Four is the minimum that keeps every
boundary structural rather than reviewed.

### 2.2 The three hard boundaries, in C#

- **`Minivac.Core` is engine-free and dependency-free.** No `Godot.*`, no `System.Numerics`, no
  `System.Linq`, no `Random`, no `DateTime`/`Stopwatch`/`Environment.TickCount`, no `Dictionary<`
  or `HashSet<` anywhere (the TypeScript core has no `Map` or `Set`, so there is nothing to carve
  out), no `Math.*` member other than `Floor`, `Truncate` and `Abs`, no culture-sensitive
  formatting. Enforced by `CorePurityTests`: a source scan of `Minivac.Core/*.cs` with the
  allow-list and banned-identifier list of Appendix A; a parse of `Minivac.Core.csproj` asserting
  zero `PackageReference` and zero `ProjectReference`; and a tick-path allocation scan of
  `Machine.cs` mirroring `test/core-purity.spec.ts` 117–140 (no `new` other than exception
  construction, no lambdas, inside the methods reachable from `Advance`). This is the C# analogue
  of `test/core-purity.spec.ts` and `tsconfig.core.json`.
- **The conformance artifacts are read, never written.** `Minivac.Conformance` has no bless. The
  goldens are compared as raw bytes from `IArtifactSource`.
- **The Godot project has two tiers, as the TypeScript build does.** The composition root —
  `Boot.cs`, `Session.cs`, `DemoLibrary.cs`, `SelfTest.cs`, `GodotResourceSource.cs` — may use every
  `Minivac.Core` loader (`LoadNetlist`, `LoadProfile`, `CreateMachine`, the terminal parsers,
  `AllocateHoles`) and, in `SelfTest.cs` and `GodotResourceSource.cs` only, all of
  `Minivac.Conformance`; `Boot.cs` may additionally name `IArtifactSource` and
  `GodotResourceSource`, and nothing else from that library. Every other script under `godot/scripts/` and every scene may use only
  `Contract` (the types and `Machine`) and `Trace` (`Observables`, the formatters), and may not
  name `Session` — the controls, the cord model, the cord list and the picker receive an apply
  delegate (`Func<Command, CmdResult>`) from the composition root, exactly as `mountInspector` hands
  `applyCommand` down today. That is what `test/ui-boundary.spec.ts` holds `src/ui/**` to: the two
  core imports plus a ban on the identifier `session`. `PanelLayout.cs` declares its own
  `IRawNetlistView` (terminal ids and hole counts), exactly as `src/ui/panel-layout.ts` declares
  `RawNetlistView`; `Boot.cs` adapts `LoadedNetlist` to it. A Godot-side source scan enforces all
  three rules. Nothing is possible in the other direction: the core has no Godot reference, so no
  engine type can enter it.

### 2.3 Determinism rules 18–21 (Godot-specific; normative text in architecture §13.6.5)

18. **The core is a plain class library.** It compiles and its tests pass with `dotnet test` on a
    machine with no Godot installed.
19. **Contract data enters as raw bytes and is parsed by `System.Text.Json`.** In the Godot build,
    `FileAccess.GetFileAsBytes("res://data/…")` `[verified: F13]`; never `ResourceLoader`,
    `GD.Load` or `Godot.Json`. The reason is not that JSON cannot be loaded — it is that it can:
    Godot 4 registers a `ResourceFormatLoaderJSON` and `JSON` inherits `Resource`, so
    `GD.Load("res://data/netlist.json")` silently succeeds and hands back a tree in which every
    number is a `double` `[verified: F15, F16]`. Integers are read as `long`; the netlist hash is
    taken over the bytes before parsing, exactly as `netlist.ts` does. A Godot-side source scan of
    `godot/scripts/*.cs` fails on `GD.Load`, `ResourceLoader.Load`,
    `ResourceLoader.LoadThreadedRequest` or `Json.Parse` applied to any `.json` path.
20. **One frame loop, one clock.** `FrameLoop.cs` holds the accounting and exposes
    `Frame(long nowUs)`; `Loop.cs` is a `Node` whose `_Process` does nothing but
    `Frame((long)Time.GetTicksUsec())`. The clock is `Time.GetTicksUsec()` — 64-bit microseconds
    since engine start, guaranteed monotonic `[verified: F17]`, taken to be unaffected by
    `Engine.TimeScale` `[likely: undocumented; G0 check 5]` — never the `_Process` `delta`, which
    `Engine.TimeScale` scales `[verified: F18]`, and never `_PhysicsProcess`. Per-tick `Advance(1)`
    + `DrainEvents()`; `Snapshot()` rendered once per frame; 50 ms catch-up cap; sub-tick
    remainder carried. Quoted in §2.7.
21. **Packed data is a byte copy, and boot proves it.** The export preset's non-resource include
    filter carries `*.json, *.trace` because Godot's export documentation lists `.json` among the
    non-resource files that need the filter `[verified: F6]`. `Boot.cs` loads the netlist through
    the core loader and refuses to start, naming both hashes, if `LoadedNetlist.Hash` differs from
    the pinned `2354ceebf3f8c566` — the value in every golden header. The same pin is asserted by a
    .NET test against `test/conformance/golden/A/I-EXP1.trace` line 2, so it cannot go stale.

### 2.4 Transcription rules — what a porter must do deliberately

The public surface is exactly the exported members of `src/core/*.ts`, name-for-name, including
the ones the runner needs that a prose list would forget: `CONTRACT`; the `Command`/`CmdResult`/
`Event`/`Note`/`State`/`CordEnd`/`ChatterDev`/`TraceAnomaly` shapes; `Machine` with `Apply`,
`Advance`, `Snapshot`, `Observables`, `MotionMask`, `DrainEvents`; `CreateMachine`;
`LoadNetlist(byte[])`; `LoadProfile(JsonElement)` and its key lists; the terminal table, its
parsers and `AllocateHoles`; `OBSERVABLES`, `OBSERVABLE_COUNT`, `MOVER_OBSERVABLE_START`,
`CHATTER_DEVICES`, `CHATTER_DEVICE_COUNT`, `WriteObservables`, `FormatMs`, `FormatCommand`,
`FormatTransitions`, `FormatAnomaly`, `FormatTrace`, the chatter workspace; the solver, graph,
device and rotary exports the tools consume; the `Ints` primitives. `CmdResult.why` strings and
`Note`/`Event` discriminators are contract and are spelled identically.

| TypeScript construct | C# rule |
|---|---|
| `BigInt` in `profile.ts` (`checkedSum64`, `checkedProduct64`, `idivRound64`, `positiveInt32`) | `checked(long)` arithmetic under the project-wide `CheckForOverflowUnderflow`; `OverflowException` is caught at the derivation site and re-thrown as the same `profile:` failure. `idivRound64` keeps the exact `(absB + 1) / 2` integer-ceiling form. Gate 3.1.15 proves the rejection paths. |
| `BigInt` in `ints.ts` `fnv1a64` | `unchecked` `ulong`; render `ToString("x16", CultureInfo.InvariantCulture)`. |
| The 16-bit-limb multiply and 64-step long division in `rotary.ts` (`motorRateMrpm`, `sweepUdegPerTick`) | May collapse to `long`/`Int128` arithmetic. Must reproduce the round-half-up on the remainder, the asymmetric int32 saturation and the `nonPortable` flag exactly. The C1/C2 goldens are the check. |
| `roundHalfEven`, `quantize`, `idiv`, `idivRound`, `mod`, `iabs` | Transcribe literally. `roundHalfEven` is floor-based. **`idiv` and `idivRound` truncate toward zero** (`Math.trunc`; C# integer `/` semantics) — never floor division; negative dividends are live in `sweepUdegPerTick` on reverse drive. `mod` returns `[0, b)` for `b > 0`. Do not substitute `Math.Round`. `quantize` clamps explicitly; never a bare `(int)` cast (pre-.NET 9 x64 returned `int.MinValue`; .NET 9+ saturates `[verified: F20]`). |
| `Int32Array`/`Int16Array`/`Int8Array`/`Uint8Array`/`Float64Array` | `int[]`/`short[]`/`sbyte[]`/`byte[]`/`double[]` at the capacities declared at each allocation site, transcribed **by constant name, never by literal**: `GRAPH_TERMINALS` 186, `GRAPH_MAX_NODES`/`SOLVE_MAX_NODES` 174, `GRAPH_MAX_ROWS`/`SOLVE_MAX_ROWS` 173, `GRAPH_MAX_CORDS` 256, `GRAPH_FIXED_ELEMENTS` 22, `GRAPH_MAX_ELEMENTS`/`SOLVE_MAX_ELEMENTS` 278, `HOLE_COUNT` 392, `OBSERVABLE_COUNT` 33, `CONTACTS` 31, `CHATTER_DEVICE_COUNT` 19, `LAMPS` 12, `SECTIONS` 6, `STORE_PAGE_SIZE`/`CHATTER_PAGE_SIZE` 64, and the derived `SECTIONS * 3` and `SECTIONS * NOTE_STRIDE` in `machine.ts`. Keep every range guard; do not rely on wider types. The LU matrix is `SOLVE_MAX_ROWS`² = 173², not 174². |
| `machine.observables()` returns the live buffer | `int[]` returned by reference; callers copy before advancing, as `run.ts` and `probe.ts` do. |
| `Object.freeze`, `readonly` | `readonly` fields, `IReadOnlyList<T>`, records; `Object.freeze(Array.from(typed))` becomes a copied read-only array, not a view. |
| Branded `TerminalId`/`HoleId` | Plain `string`; every entry point calls the parser, as `terminalIndex` re-validates today. No struct wrapper — the JSON stays a bare string. |
| `Number.isInteger` / `isSafeInteger` guards on `number` inputs | The same checks on the numeric type at the boundary; `long` inputs checked against `2^53` where the TS checks `isSafeInteger`. |
| `Number.isNaN`, `=== Infinity` in `quantize` | `double.IsNaN`, `double.IsPositiveInfinity`/`IsNegativeInfinity`. |
| `%` on doubles and on negative integers | Same semantics (`fmod`-style, sign of dividend) `[verified: F21]`. `mod`'s `b > 0` precondition stays unguarded. |
| `Math.floor` (all sites non-negative), `Math.trunc`, `Math.abs` | `Math.Floor`, `Math.Truncate`, `Math.Abs` on `double`; integer sites may use integer division only where the operand is proven non-negative (it is at every `Math.floor` site). |
| The hand-written insertion sort in `machine.ts` (`priorMv > mv \|\| (priorMv === mv && priorElement < element)`) | Transcribe the loop and the comparator. No `Array.Sort`, no LINQ. |
| String building of numbers (`trace.ts`, `profile.ts` hash payload) | `ToString(CultureInfo.InvariantCulture)` on `int`/`long`; `InvariantGlobalization` is also set project-wide. |
| `payload.charCodeAt(i)` → bytes in `semanticHash` | `Encoding.ASCII.GetBytes` with an assertion that the payload is pure ASCII (it is by construction; the assertion makes the port fail loudly rather than diverge). |
| `Array.prototype.sort()` and `<`/`>` on strings in the runner | `StringComparer.Ordinal` / `string.CompareOrdinal`. Never a culture. |
| `/\s$/u` in `formatTrace` | `char.IsWhiteSpace` on the last char. The JS and .NET sets differ only on characters no trace can contain (U+FEFF is rejected earlier); recorded, not reproduced. |
| `throw new Error('module: …')` per module; `HoleAllocationError`; the two `RangeError`s in `machine.ts` | One exception type per module prefix; `HoleAllocationException` carrying `WireIndex` and `Terminal`; `ArgumentOutOfRangeException` for the two `RangeError` sites. Messages are not contract except where the CLI writes them to stderr and where gate 3.1.15 pins them. |
| `readStrictJson` (BOM, any CR, fatal UTF-8, then parse) | `source.ReadAllBytes`; the same three byte checks in the same order; `new UTF8Encoding(false, true)`; `JsonDocument.Parse` with default options (trailing content rejected, comments disallowed). |
| Ajv Draft 2020-12, `strict`, `allErrors` | `JsonSchema.Net` with `Dialect.Default` = 2020-12 on the checked-in schemas. It must accept every shipped fixture and probe and reject `test/conformance/schema.spec.ts`'s invalid corpus (ported as data-driven cases), including a duplicated `dev` in `obs` (`contains`/`minContains`/`maxContains`). |
| `process.stdout.write` / `process.exitCode` | `Console.OpenStandardOutput()` wrapped in `new StreamWriter(stream, new UTF8Encoding(false)) { NewLine = "\n" }`; `Environment.ExitCode`. stdout still carries the full trace on assertion failure. |
| `globSync` order, `readdirSync` | Never observable: results are sorted ordinally or required unique. `source.EnumerateFiles` plus the same sort. |
| JS `Math.round` at every site the app ports — `src/ui/inspector.ts` 350 (dial geometry) and `src/ui/panel-layout.ts` 631 (`roundProjection`) | Half-up, not half-even: `Math.Floor(x + 0.5)` in `Controls.cs` and `Stage.cs`. `Math.Round` is banned in the core and must not be reached for in the app either. |

### 2.5 The panel layout export and the theme

`tools/gen-panel-layout.ts` imports `src/ui/panel-layout.ts` (a pure module with no imports, no
DOM and no side effects beyond computing frozen tables at load) and writes `data/panel-layout.json`:

```
{ "schema": "minivac.panel-layout/1",
  "sources": { "ph2HorizontalSource": "panel.md §3 — PH2 unverified image measurement",
               "note": "panel.md §11 — absolute dimensions and jack pitch are not settled by any source; every placement here is an unverified redraw token" },
  "aspect": 1.8,
  "ph2Horizontal": {…}, "ph2PowerStripe": {…},
  "plates": [...3], "bands": [...12], "regions": [...40],
  "terminals": [...186, each with its nested holes], "holes": [...392, the flattened duplicate],
  "legends": [...], "components": [...], "controls": [...21], "linework": [...],
  "matrixOrder": [[1,2,3],[8,9,4],[7,6,5]], "decimalAngles": [...16] }
```

Fifteen data constants of the module (the fourteen arrays and scalars above plus
`PH2_HORIZONTAL_SOURCE`); the three functions `validatePanelLayout`, `fitPanel` and
`projectPanelPoint` are behaviour and are ported as code in `PanelLayout.cs` and `Stage.cs`. Every
coordinate is normalized to `[0,1]`. Seven inventories (plates, regions, terminals, legends,
components, controls, linework) carry a per-record `source` in the TypeScript; **bands (positional
six-tuples `[id, plate, tone, top, bottom, title]`), holes and `decimalAngles` carry none, and the
generator emits every inventory exactly as the module exports it** — no record gains a field the
TypeScript does not export. Their shared attribution is recorded once, in `sources.note`, and the
Godot loader applies it to every band, hole and dial-angle record at load (holes additionally
inherit their parent terminal's `source`), so no coordinate reaches the Godot side unattributed.
`terminals` keep their nested `holes` array and `holes` is the flattened duplicate.

The eleven SHA-256 digests in `test/panel-layout.spec.ts` are over `JSON.stringify` of each
in-memory array with no indentation and insertion key order; the generator writes the file with
two-space indentation, so the digest test re-serializes the parsed arrays canonically rather than
hashing file bytes, and because no record was altered the same eleven values must come out. The
generator is deterministic and idempotent.

**Presentation constants live in two places outside the layout table, and the Godot renderer
transcribes both into `PanelTheme.cs`** (the UI is allowed to differ; these are what "the same
look" means):

- eight geometry constants in the TypeScript renderer: relay body 9.5 × 5.8 % of panel width and
  dial knob 8.5 % square (`src/ui/panel-view.ts` 104–113); artwork coordinate scale 1000
  (136–138, 328); arrowhead offsets ±6/±4 in the 1000-space (153–158); bracket end-tick depth
  0.006 (175–176); two-line legend width 5 % (349); relay crossbar shift
  `travel × 1.6 / 1000 − 0.8` % of panel width (`src/ui/inspector.ts` 780–783); dial pointer
  rotation `udeg / 1 000 000` degrees (`src/ui/inspector.ts` 798);
- `main.css` (repository root): the five palette tokens at lines 2–6 (`--console-teal #62979a`,
  `--console-dark #24241f`, `--console-cream #e6dfc7`, `--console-red #a9473d`, `--console-red-lit
  #d65a4b`), the container-query type scale at 487–520, the component dimensions at 530–652 (hole
  1.05 cqi, lamp lens 2.4 cqi, POWER jewel 1.75 cqi with 0.22 cqi bezel, pushbutton 3.4 cqi,
  breaker 3.1 cqi, slide switch 3.2 × 1.15 cqi, power switch 1.15 × 3.2 cqi, rivet 0.8 cqi,
  terminal gaps 0.12/0.18 cqi), the `--relay-shift` default at 658 and the focus ring at 752–753
  (0.22 cqi outline, 0.18 cqi offset). `cqi` is 1 % of the panel's inline size, so each converts
  to a fraction of panel width. A test pins the five palette values.

### 2.6 The application, module by module

**`SelfTest.cs`** (autoload singleton, registered in `project.godot`). Its `_Ready` runs before
the main scene's `_Ready`. If `OS.GetCmdlineUserArgs()` `[verified: F22]` contains `--selftest`,
it sets `SelfTest.Requested`, constructs a `GodotResourceSource`, runs the normative self-test list
(architecture §13.6.7 steps 4–7 in full), prints one line per artifact and a summary, and
calls `GetTree().Quit(0)` iff all pass, else `Quit(1)` `[verified: F23]`. Because `Quit` is
deferred to the end of the current iteration, the main scene is still instantiated. That is why
`Main.tscn` contains only the `Boot` node: every other node — stage, toolbar, drawer, picker,
help, audio, loop, session — is instanced by `Boot._Ready`, which begins with
`if (SelfTest.Requested) return;`. That one branch (the stage choice is the only other
argument-dependent branch) leaves the whole tree inert, so no window, dialog or audio device is
created on the self-test path. Gate 3.2.12 asserts it once the full tree exists: a `--selftest`
run instantiates no node other than `SelfTest` and `Boot`.

**`Boot.cs`** (composition root, the root node of `Main.tscn`). Reads its six documents through
`GodotResourceSource` (§2.1); loads through the core and the ported demo loader; asserts the
netlist hash pin (rule 21) and the engine version (Godot 4.7.2); instances the G4 placeholder stage,
`Loop`, `Session`, `Preferences` and `TraceView`; constructs the first `FrameLoop`; and loads the
first demo on REF-A. The fuller console composition is not authorized in this phase.

**`FrameLoop.cs` / `Loop.cs`.** §2.7. `Session.LoadDemo`, `Reset` and `SwitchProfile` construct a
new `FrameLoop` over the new machine and assign it to `Loop.Current`; the previous instance is
dropped, so `_lastUs`, `_carryUs` and `_nextBoundaryTick` all restart. Session does this inside the
mount callback it passes to the ported `createDemoSession` — the analogue of `mountInspector`,
which is where `src/ui/inspector.ts` 821–822 builds and starts the loop today.

**`Session.cs`.** Two roles in one class, stated because `src/session.ts` holds only the first.
(1) A transcription of `src/session.ts`: `LoadDemo`, `Reset`, `SwitchProfile`, `Dispose`; every
path builds a fresh `Machine`, applies the demo's commands in order, `Advance(1)`, `DrainEvents()`,
disposes the previous mount only after the new machine is built, remounts the previous session if
mounting throws. (2) The mount-callback role `mountInspector` plays today: `Apply` (the
transcription of `applyCommand`, below), construction of the `FrameLoop` and assignment to
`Loop.Current`, and an unmount that clears `Loop.Current` so no loop ticks a disposed machine;
`Dispose` also clears it. The apply delegate handed to the controls is `Session.Apply`. Blank/manual mode is the empty `MANUAL` command list, so
`Reset` in manual mode discards manual wiring, and the reset control reads *Reset blank panel*
(`src/ui/demo-experience.ts` 230–233); otherwise *Reset selected demo*.

**`DemoLibrary.cs`.** A transcription of `src/demo-library.ts`: exactly eleven demos, unknown-key
rejection, the two-pass hole allocation (explicit `#n` claims first, 261–265; then, for each
terminal-only endpoint, the lowest-numbered free hole **within that same terminal**, 226–238 — a
full terminal is the *has no free hole* failure, never a spill to another terminal), every
`fail()` call site of the module (25 as of 2026-09-03; the 26th `fail(` match is the declaration)
with the same message text — the wiring-specific
seven are named because a port is likeliest to soften them: over 256 cords (258), unknown terminal
or hole (191), duplicate id (370), occupied hole (222), no free hole (237), two free ends (213),
unloaded PLUS-to-MINUS short (281) — and the exact command order a record expands to: connects in file order **with `CordId` equal to the connection's
zero-based array index** (`src/demo-library.ts` 302–310), six switches, six buttons, six relay
grabs/releases, dial grab/release, **power last**.

**`PanelLayout.cs` / `PanelTheme.cs` / `PanelView.cs` / `Stage.cs`.** `Boot` reads the
`panel-layout.json` bytes and hands them to `PanelLayout.Parse(byte[], IRawNetlistView)`, which
validates them against the loaded netlist exactly as `validatePanelLayout` does (identity, order,
hole counts, region ownership, normalization), and builds the 2D scene: three plates, twelve bands,
linework and legends drawn on a `Control` in the 1000-space, 186 terminal rings and 392 hole
`Button`s placed by normalized coordinates and carrying their `HoleId` as metadata (with an
`occupied` visual state recomputed on every cord render), twelve lamp lenses and one jewel, six
relay crossbars, six pushbuttons, six slide switches, the dial, POWER and breaker, all sized and
coloured from `PanelTheme`. The console never reflows: the panel is a fixed 1.80:1 `Control` inside
a stage with a **Fit/Wire view pair**, wheel zoom, drag pan and the Phase 2 control set — Fit,
Wire, Zoom out, Zoom in, four Pan buttons, and the keys `+`/`=`, `-`/`_`, arrows, `0`/`Home`
(fit), `w` (wire). Fit letterboxes the whole panel (`width = min(vw, vh × 1.8)`); Wire raises the
scale until every hole hit target is at least 24 × 24 window pixels (`wireMinimumScale`,
`src/ui/stage-controls.ts` 152–164, guard constant 24.25); pan is clamped so the surface never
leaves the stage (`containPan`, 170–177). The per-frame render writes a relay crossbar's or the
dial's value **only when that control is not currently grabbed** by pointer or keyboard
(`src/ui/inspector.ts` 770–772, 797); every other projected state is written unconditionally.
Toolbar, drawer and dialogs live outside the panel, as in Phase 2.

**`Controls.cs`.** Emits exactly the command tables of Appendix C. Section identity comes from the
control's metadata, never from scene-tree order. Pushbuttons are momentary (press → `target 1000`,
release/cancel/focus-loss/Escape → `target 0`). Relay crossbars and the dial are ranges with
`min 0`, `step 1`, and `max 1000` / `max 359 999 999` respectively (`src/ui/panel-view.ts`
278–281); keyboard increments are a Godot rule (the browser defaults Phase 2 inherits are not specified by
any standard, so this is a choice, not a fact): Arrow = 1 step, PageUp/PageDown = one tenth of the range, Home = min,
End = max — the dial's one-µdeg arrow step is intentional. The pointer/keyboard arbitration is
**deliberately asymmetric and is reproduced as such**: a pointer press on a keyboard-held
**button** is suppressed (`src/ui/inspector.ts` 162–166, guard at 165; keyboard path 172–179); a
pointer press on a keyboard-held **relay** is not (197–201); a keyboard press on a pointer-held
relay is suppressed (214–221); both release paths suppress while the other modality still holds
(220, 254). Relay crossbars emit `relayGrab` on pointer press and **one further `relayGrab` per
drag update** while held. A keyboard step on a relay emits `relayGrab` with the pre-step value from the keydown (214–217,
suppressed on key auto-repeat by `bindKeyboardHold`), plus one further `relayGrab` per **actual
value change** from the value-change path (202–206) — two commands for an ordinary step, one when
the value is already at the bound (End on a relay at 1000). Then one `relayRelease` on
release/cancel/focus-loss/Escape. The dial emits `dialGrab` on press and per
pointer move using the clockwise rule `degrees = (atan2(dx, −dy) × 180/π + 360) mod 360`,
`targetUdeg = min(359 999 999, floor(degrees × 10⁶ + 0.5))` (JS `Math.round` is half-up; never
`Math.Round`), and one `dialRelease`; keyboard steps emit a momentary `dialGrab`/`dialRelease`
pair from the slider value. Slide switches toggle on click from the current travel. POWER toggles
from `State.power`; breaker emits `{k:'breaker', reset:true}` and is disabled unless tripped.

**`Cords.cs` / `CordList.cs` / `Picker.cs`.** A transcription of `src/ui/cord-model.ts`.
`ReplaceCordEndpoint` returns one of five outcomes — `Noop`, `Committed`, `DisconnectRejected`,
`ConnectRejected` (original restored by re-connecting the byte-identical `{cord, a, b, r_uohm}`),
`RollbackRejected` (the restoring connect was refused; the UI cord list is discarded and rebuilt
from `State.cords`) — mirroring `cord-model.ts` 56–74 and 317–360, with the status strings of
`src/ui/inspector.ts` 566–573. Every change is `disconnect` then `connect` on the same `CordId`
with the same `r_uohm`, applied before the next `Advance`. `CordId` allocation is the lowest
unused integer in 0..255. Free ends render in a tray ordered `(CordId, a before b)` and that
position never enters `CordEnd`, `State` or the trace. Occupancy is computed **with the dragged
endpoint excluded** (`isHoleOccupied(cords, hole, drag.endpoint)`, `cord-model.ts` 197–208, 291),
so a drop back onto the endpoint's own hole resolves as a no-op, not as occupied; the occupied
test runs before the same-end test. Drop on an occupied hole, outside, Escape or cancel restores
the exact prior endpoint with no command. Cords draw as straight `Line2D`s between hole centres;
the drag preview follows the pointer and emits no command.

A cord list outside the panel mirrors `src/ui/inspector.ts` 604–637: one row per cord carrying
`Cord <id>`, an `A: <endpoint>` button and a `B: <endpoint>` button that select the end and open
the picker, a `Free` button per end, and a `Remove` button. **Add free cord** (the exact Phase 2
label) allocates the cord, selects end `a` and opens the picker (551–561). The picker is a search
field (*Find terminal or hole*, matching terminal **and** hole ids, `src/ui/stage-controls.ts`
362–375, 445–451), a **Free** action, a **Cancel** action, Escape-to-cancel (464–468), and one row
per terminal carrying its per-hole buttons and a per-terminal **Touch <id>** button that applies
`{k:'touch'}` while held and returns the end to `free` on pointer up, pointer cancel, lost
capture, key up, blur or dispose (406, 419–439). Touch requires the end to be `free`.

**`AudioRouter.cs` / `GodotAudioSink.cs`.** `AudioRouter.cs` ports only the routing half of
`src/ui/audio-router.ts` — `Sample(events)`, `Frame(state)`, `Reset()`, `Dispose()`,
`MotorPlaybackRate` (`clamp(|mrpm| / 45 000, 0.5, 2)`, lines 69–72) and the mute preference. The
DOM button and `renderControl()` (59, 92, 130–140) do not port: the toolbar's Sound button calls
`AudioRouter.SetMuted(bool)`, and has two labels, *Sound on* and *Sound muted* (*Enable sound* is
the browser-unlock label and is unused). The Web Audio `AudioBackend` is replaced by
`IAudioSink { void PlayRelay(RelayCue cue); bool SetMotor(MotorCue cue); void StopMotor(); void
StopRelayCues(); }` where `RelayCue` carries `Kind` (pullIn/dropOut), `Relay` and `DueUs`,
matching `audio-router.ts` 251–255. Godot audio is always available, so `state()` and `unlock()`
have no analogue and `audible()` reduces to `!disposed && !muted`. The router's clock is not its
own: `FrameLoop` passes the frame's `nowUs` to its render callback (§2.7), and
`AudioRouter.Frame(state, nowUs)` receives that value, so rule 20's single clock stands. It
computes each burst's anchor by the same formula as `audio-router.ts` 232–243, with `nowUs`
substituted for `backend.now()` — the one divergence, logged in the guide: `anchorUs =
max(lastOnsetUs, nowUs)`, and only when `lastEventTick` is non-null and `firstTick >= lastEventTick` also
`max(anchorUs, lastOnsetUs + (firstTick − lastEventTick) × 100)`; then per event, as 244–249 does,
`tick = max(priorTick, event.t)` and `dueUs = max(lastOnsetUs, anchorUs + (tick − firstTick) × 100)`
— `Event.t`-spaced (100 µs per tick) and monotone. Only
`relay.pullIn` and `relay.dropOut` are routed. `GodotAudioSink` keeps a due-time queue and drains
it against that same `nowUs`, starting each cue in the first frame at or after its due time — never
reading a clock of its own — so a 50 ms catch-up frame carrying N relay Events plays N cues spread
over the following 50 ms rather than one burst, at frame granularity (≤ one frame of jitter; an
allowed UI difference). Relay cues play through one `AudioStreamPolyphonic` with `Polyphony = 32` (the
default `[verified: F24]`); a cue that cannot get a voice is dropped, not retried. The motor loop
follows only the final `State.dial.mrpm` of the frame with three cue kinds `start`, `rate`,
`direction`, plus `StopMotor()` when `mrpm` reaches zero; a refused **motor** cue is retried next
frame (`audio-router.ts` 278–281). Muted or disposed routers drop cues rather than queueing them;
`Reset()` on session replacement clears routing state and keeps the mute preference; `Dispose()`
on `NotificationWMCloseRequest`. Playback: `AudioStreamPolyphonic` for relay cues, a looping
`AudioStreamPlayer` with `PitchScale` for the drive loop `[verified names: F24, F25; behaviour
G0 check 7]`.

**`Lamps.cs`.** Lens alpha = `milli / 1000` (linear); `cls` retained for the accessible name
`"<name>: <cls> · <ua> µA · <milli> milli"` and the tooltip `"<cls> · <ua> µA · <milli> milli"`
(`src/ui/lamp-presentation.ts` 29–35); the POWER jewel is lit iff `State.railMv > 0` and is a
different component that never reads `milli`. No FUSE cap.

**`Toolbar.cs` / `Drawer.cs` / `DemoExperience.cs`.** The toolbar carries Library, Blank panel,
Reset, Profile, Sound and Help. The drawer transcribes `src/ui/demo-experience.ts` and
`createDrawerController` (`src/ui/interaction-accessibility.ts` 61–110: Escape closes, focus
returns): the demo list with the eleven entries in source order, the counter pair adjacent, and
for each entry its title, category, the **Source block** — Program, Locator, Confidence, Errata,
Fallbacks, *None* when empty (`demo-experience.ts` 73–111) — instructions, control labels, the D2
notice rendered as three paragraphs, and the profile control with its disclosure (Appendix D).
`VI-TICTACTOE`'s Fallbacks list shows `FALLBACK-TTT-RING-CW`.

**`TraceView.cs` / `Diagnostics.cs`.** `TraceView.cs` transcribes all three methods of
`src/ui/trace-view.ts` — `Command(tick, command)`, `Frame(tick, observables, events)` per tick,
`Flush()` per frame. `Controls.cs` and the cord model route every command through
the apply delegate — `Session.Apply` — which transcribes `applyCommand` (`src/ui/inspector.ts` 525–535): snapshot the
pre-apply state, call `Machine.Apply`, return on `!ok` **without tracing**, then call
`TraceView.Command(CommandTraceTick(preState, command), command)`, where `CommandTraceTick`
(420–425) returns 0 for a power-on that turns the rail on from off and `preState.tick` otherwise. `Diagnostics.cs` transcribes
`src/ui/inspector.ts` 805–814: the 186 terminal voltages
(*floating* or `<mv> mV`), the steady-state notes list (*No steady-state notes.* when empty), and
the status title `tick … · rail … mV · supply … µA` with the portable flag.

**`HelpCredits.cs`.** A dialog with the five workflows (Load, Power, Operate, Wire, Momentary
Touch) reworded only where the Godot controls differ; the two "Redraw and simulation limits"
paragraphs **verbatim**; four credits (PH2, PH3, relay cue, rotary loop) whose creator, source
link and licence link are read from `public-assets.json` by id and whose heading and description
sentence are the frozen literals of `src/ui/help-credits.ts` 165–188 — never the JSON's
`derivativeStatus`, which is a production note; the licence display names map exactly
`CC-BY-SA-4.0 → CC BY-SA 4.0`, `CC-BY-2.0 → CC BY 2.0`, `CC0-1.0 → CC0 1.0` and throw otherwise
(51–56); the profile disclosure verbatim (Appendix D). External links open with `OS.ShellOpen`
`[verified: F22]`.

**`Preferences.cs`.** `user://minivac.cfg` via `ConfigFile` `[verified: F26]`: `audio/muted`,
`help/seen`, `motion/reduce`. A read or write failure falls back to in-memory, as
`safePreferenceStorage` does. The selected profile is **not** persisted. Reduce motion: if Godot
4.7 exposes the OS setting (G0 check 8, `[unverified]`) it seeds the preference; otherwise the
toggle in Help is the only source. With it on, drag previews snap and lens changes are immediate,
mirroring `main.css` 1023–1029.

### 2.7 The frame loop, quoted

`src/ui/loop.ts` is the reference. `createFrameLoop` returns a `frame(nowMs)` closure and
`startFrameLoop` alone touches `requestAnimationFrame`; the C# form keeps that seam so gate 3.2.4
can drive the accounting directly.

```csharp
// godot/scripts/FrameLoop.cs — the accounting. No engine reference.
public sealed class FrameLoop {
  const long TickUs = 100;
  const long MaxCatchUpUs = 50_000;
  readonly Machine _machine; readonly Action<int, int[], IReadOnlyList<Event>> _sample; readonly Action<State, long> _render;
  long? _lastUs; long _carryUs; int _nextBoundaryTick;

  public FrameLoop(Machine machine, Action<int, int[], IReadOnlyList<Event>> sample, Action<State, long> render) {
    _machine = machine; _sample = sample; _render = render;
    _nextBoundaryTick = machine.Snapshot().Tick;      // seeded after the machine is in scope
  }

  public void Frame(long nowUs) {
    _lastUs ??= nowUs;
    long dtUs = Math.Min(nowUs - _lastUs.Value, MaxCatchUpUs);
    long total = dtUs + _carryUs;
    long ticks = total / TickUs;                        // non-negative: integer division == floor
    _carryUs = total - ticks * TickUs;
    for (long i = 0; i < ticks; i++) {
      _machine.Advance(1);
      var events = _machine.DrainEvents();
      int boundaryTick = events.Count == 0 ? _nextBoundaryTick : events[0].T;
      foreach (var e in events) if (e.T != boundaryTick) throw new InvalidOperationException("ui loop: one-tick drain had mixed timestamps");
      _sample(boundaryTick, _machine.Observables(), events); // trace + audio, per tick
      _nextBoundaryTick = boundaryTick + 1;
    }
    _render(_machine.Snapshot(), nowUs);                // once per frame; nowUs feeds AudioRouter.Frame
    _lastUs = nowUs;
  }
}

// godot/scripts/Loop.cs — the only wall-clock code in the Godot project.
public partial class Loop : Node {
  public FrameLoop? Current;                            // replaced by Session on every load/reset
  public override void _Process(double delta) => Current?.Frame((long)Time.GetTicksUsec());  // delta ignored (rule 20)
}
```

Differences from the TypeScript loop, all deliberate: microseconds are integers from the engine
clock instead of fractional milliseconds from `requestAnimationFrame`, so `_carryUs` is exact; the
render callback also receives `nowUs`, because the audio router anchors bursts on it and rule 20
allows no second clock; the cap discards time beyond 50 ms exactly as before; a headless caller still uses `Advance(exactTicks)`.
The microsecond image of `test/ui-loop.spec.ts` 33–41 is `0, 62, 125, 100125, 100187, 100250` →
rendered ticks `0, 0, 1, 501, 501, 502`, 502 drains (gate 3.2.4).

---

## Appendix A — the port contract on one page

Normative text is architecture §12 as amended by §13.6; this is the porter's checklist and the
identifier lists `CorePurityTests` enforces. Rules 1–17 are unchanged in substance except where
§13.6 says otherwise.

| # | Rule | Enforced by |
|---|---|---|
| 1 | Node index = ascending minimum terminal index per non-datum super-node; datum = MINUS's super-node, no row | netlist-KAT |
| 2 | Element order: fixed rows in `netlist.json` order, then positive-resistance cords by ascending `CordId`, source last; zero/absent cords emit unions only | netlist-KAT, goldens |
| 3 | Stamp accumulation in element order, no re-association; `gmin` first on every solved diagonal (`DECISIONS.md`, *2026-08-30 — Phase 1 Wave 1a spec readings*) | solver-KAT |
| 4 | LU: partial pivot, max abs, ties → lowest row; static `SOLVE_MAX_ROWS`² = 173×173 with node arrays at `SOLVE_MAX_NODES` = 174; no library | solver-KAT (`pivot-tie`) |
| 5 | No transcendental in the core; PWL table for the lamp; `Math.` allow-list is `Floor`, `Truncate`, `Abs` | purity scan |
| 6 | **No FMA contraction, by runtime fact and by ban**: `FusedMultiplyAdd`, `MultiplyAddEstimate`, `System.Numerics` banned; solver KAT runs inside every exported build | purity scan, sentinel, self-test |
| 7 | All time is `int tick`; latencies become per-tick counts at load by §4.4's formulas | profile-KAT, w3-derived |
| 8 | Per-relay spread is six literals; no RNG | purity scan |
| 9 | Contacts frozen for the tick; every mover advances from one solution | goldens |
| 10 | Quantize then decide: scale, round-half-even, −0 → 0, saturating clamp, `nonPortable`; never a bare cast; `ConvertToIntegerNative` banned; **no threshold comparison ever touches a double** | solver-KAT (`saturating-quantize`), purity scan, a reviewed scan of comparison sites in `Devices.cs`/`Machine.cs` |
| 11 | Carried doubles are exactly `iCoil[6]` and `rLamp[12]`, updated in rule-2 order | solver-KAT 500-tick cases |
| 12 | No `Dictionary<`/`HashSet<` anywhere in the core; index arrays; sort only on integer keys (the hand-written insertion sort) | purity scan, goldens |
| 13 | No wall clock, no RNG, no hash but FNV-1a 64 over raw netlist bytes and the profile's semantic payload; 16 lowercase hex digits | purity scan, hash pins |
| 14 | Assert no NaN after every solve; set `nonPortable` | solver-KAT |
| 15 | `tick_us × 20 < min device latency`, asserted at load | profile load, gate 3.1.15 |
| 16 | Branch currents from companion equations after the solve, never from the matrix | solver-KAT (`collapsed-*`, `zero-unknown`) |
| 17 | UTF-8, no BOM, LF; `UTF8Encoding(false)`, `"\n"`; `* -text` | encoding tests |
| 18 | The core is an engine-free, dependency-free class library | csproj parse |
| 19 | Contract data: raw bytes → `System.Text.Json`; never `GD.Load`/`ResourceLoader`/`Godot.Json` | app source scan |
| 20 | One loop, `Time.GetTicksUsec()` through `FrameLoop.Frame(long)`, per-tick advance and drain, render once per frame | loop tests |
| 21 | Packed data is a byte copy; boot refuses on a netlist hash mismatch; `*.json, *.trace` exported | identity tests, boot test |

Banned identifiers in `Minivac.Core/*.cs` (word-bounded, outside comments and strings): `Godot`,
`System.Linq`, `System.Numerics`, `Random`, `DateTime`, `Stopwatch`, `Environment.TickCount`,
`MathF`, `Math.Round`, `MultiplyAddEstimate`, `ConvertToIntegerNative`, `CultureInfo.CurrentCulture`,
`Dictionary<`, `HashSet<`, `OrderBy`, `Sort(`, `.ToString()` on a numeric expression (best-effort
regex, reviewed). Allowed `Math.` members: `Floor`, `Truncate`, `Abs` — every other `Math.`
member (`Pow`, `Exp`, `Log`, `Log2`, `Log10`, `Sqrt`, `Cbrt`, `Sin`, `Cos`, `Tan`, `Asin`, `Acos`,
`Atan`, `Atan2`, `Sinh`, `Cosh`, `Tanh`, `FusedMultiplyAdd`, `ReciprocalEstimate`,
`ReciprocalSqrtEstimate`, `BitIncrement`, `BitDecrement`, `Min`, `Max`, `Sign`, `Ceiling`, …) is
a finding.

## Appendix B — the Godot node tree

```
Main = Boot (Node)        Boot.cs            scenes/Main.tscn — the only main scene; Boot is its root
│                                            and the only node in the file. Everything below is
│                                            instanced by Boot._Ready, after the --selftest early
│                                            return; data load, hash + version pins live in Boot.
├─ Loop (Node)            Loop.cs            rule 20; holds the current FrameLoop
├─ Session (Node)         Session.cs
├─ DemoLibrary (Node)     DemoLibrary.cs
├─ Preferences (Node)     Preferences.cs
├─ Audio (Node)           AudioRouter.cs     children: GodotAudioSink.cs with AudioStreamPlayer ×2
├─ Stage                  placeholder Control; G4 only, no panel console
└─ Trace                  TraceView.cs, enough to observe FrameLoop sampling
SelfTest (autoload)       SelfTest.cs        runs its _Ready before Main's on every launch; acts only
                                             when --selftest is present, and Boot._Ready then
                                             returns immediately
```

`Main.tscn` is the only main scene. A future playable console requires a new dated decision after
G4; its 2D and 3D scene design is not part of this committed tree.

## Appendix C — command tables the application must emit

`n` is the section from the control's metadata. `T` is a target in 0..1000. Citations are
`src/ui/inspector.ts` unless stated.

| Control | Gesture | Commands, in order |
|---|---|---|
| POWER | activate | `{power, on: !State.power}` |
| Breaker | activate (enabled only while tripped) | `{breaker, reset: true}` |
| Pushbutton n | pointer press (not keyboard-held) | `{button, n, target: 1000}` (162–166, guard 165) |
| Pushbutton n | pointer release / cancel (not keyboard-held) | `{button, n, target: 0}` |
| Pushbutton n | key press Space/Enter (not pointer-held) | `{button, n, target: 1000}` (172–179) |
| Pushbutton n | key release / focus loss / Escape (not pointer-held) | `{button, n, target: 0}` |
| Slide switch n | activate | `{switch, n, target: travel < 500 ? 1000 : 0}` |
| Relay crossbar n | pointer press (unconditional — even while keyboard-held; once per press) | `{relayGrab, n, target: T(current)}` (197–201) |
| Relay crossbar n | key press Arrow/Page/Home/End (not pointer-held) | `{relayGrab, n, target: T(current, pre-step)}` (214–217) then `{relayGrab, n, target: T(stepped)}` (202–206) — two commands, as the browser emits |
| Relay crossbar n | each drag update while pointer-held, or each further key step while keyboard-held | `{relayGrab, n, target: T}` — one per update (202–206) |
| Relay crossbar n | pointer release / cancel (not keyboard-held) | `{relayRelease, n}` (254) |
| Relay crossbar n | key release / focus loss / Escape (not pointer-held) | `{relayRelease, n}` (220) |
| Dial | pointer press | `{dialGrab, targetUdeg}` by the clockwise rule of §2.6, half-up rounding |
| Dial | pointer move while held | `{dialGrab, targetUdeg}` recomputed |
| Dial | pointer release / cancel | `{dialRelease}` |
| Dial | keyboard step while not pointer-held | `{dialGrab, targetUdeg: slider}` then `{dialRelease}` (243–247) |
| Add free cord | activate | `{connect, cord: lowest unused 0..255, a: free, b: free, r_uohm: 0}`, then end `a` selected and the picker opened; no command if exhausted (*All 256 cord ids are in use.*) |
| Remove | activate | `{disconnect, cord}` |
| Endpoint → hole / tray / Free / picker hole | valid drop or choice | `{disconnect, cord}` then `{connect, cord, a', b', r_uohm}`; on connect failure, `{connect}` of the byte-identical original; if that fails too, no further command, *Cord rollback rejected: <why>.*, cord list rebuilt from `State.cords` |
| Endpoint → occupied hole (dragged endpoint excluded from occupancy), outside, Escape, cancel, same end | — | no command |
| Touch (picker) | press while the end is free | `{disconnect}` then `{connect … {touch, term}}` |
| Touch (picker) | release / cancel / lost capture / key up / blur / dispose | `{disconnect}` then `{connect … free}` |
| Demo load / Reset / profile change | — | fresh Machine; the record's commands in §2.6 order with `CordId` = connection index; `Advance(1)`; `DrainEvents()` |

## Appendix D — frozen public copy, with sources

Byte-identical in the Godot build; each pinned by a Godot-side test with the literal string.

| Copy | Source of truth |
|---|---|
| D2 counter notice (three `\n\n`-separated paragraphs) | `data/demo-library.json`, `notice` on `IV-EXP1` and `ER-ALTCOUNTER`; authority `docs/DECISIONS.md` D2 |
| Profile disclosure: *Both choices are unmeasured simulator profiles. REF-A is the default marginal-behavior profile; IDEAL is the forgiving profile.* and the two radio labels | `src/ui/demo-experience.ts` 8–10, 188–191 |
| Per-demo Source block labels (Program / Locator / Confidence / Errata / Fallbacks / *None*) and values | `src/ui/demo-experience.ts` 73–111; values from `data/demo-library.json` `source` |
| Redraw and simulation limits, two paragraphs | `src/ui/help-credits.ts` 145–156 |
| Credits: the four frozen headings and description sentences, plus the P6 Relay release simulation entry, including the PH2 sentence *It is an adaptation, and the panel-art derivative is licensed CC BY-SA 4.0.* and the audio sentences ending *not an authenticated MINIVAC recording* | `src/ui/help-credits.ts` 165–195 (PH2 170, PH3 176, relay 182, rotary 188, release 194; `credit()` composition 65–70); creator, source URL and licence URL from `data/public-assets.json` by id; licence display names from `licenseName` 51–56 |
| Demo titles, categories, instructions, control labels | `data/demo-library.json` |
| Control base names (Pushbutton 1 … Decimal dial angle, Power) and the `base: label` composition | `src/ui/control-labels.ts` 25–46, 61–64 |
| Panel legends including the Cambridge fine print | `data/panel-layout.json` `legends[].text` |
| Help workflow headings: Load, Power, Operate, Wire, Momentary Touch (body text may be reworded for Godot controls) | `src/ui/help-credits.ts` 104–131 |
| Reset control labels *Reset selected demo* / *Reset blank panel* | `src/ui/demo-experience.ts` 230–233 |

Status strings that carry verbatim but are not pinned by a test in either build — the thirteen at
`src/ui/inspector.ts` 529, 533, 554, 566, 570, 573, 582, 596, 665, 668, 681, 723, 732 (*Accepted:
<k>* / *Rejected: <why>*, *All 256 cord ids are in use.*, *Cord endpoint connected.*, *Cord change
rejected: <why>.*, *Cord rollback rejected: <why>.*, *Cord change cancelled.*, *Cord drop
cancelled.*, *Cord move cancelled.*, *<hole> is occupied.*, *Touch requires a free cord end.*,
*Touching terminal <t>.*, *Choose a terminal or Free for cord <n><SIDE>.*, *Select a cord end
first.*) and the cord-panel hint at 465–470.

## Appendix E — inventories the tests assert

| Artifact | Count | Ids or members |
|---|---|---|
| Fixtures / goldens, tier A | 21 / 21 | `I-EXP1`…`I-EXP7`, `I-EXP8-STEP5`, `I-EXP10`, `II-EXP5`, `II-EXP6`, `III-3STMT`, `III-XOR-PB`, `III-RELAYAND`, `III-RELAYOR`, `III-RELAYNOT`, `III-RELAYXOR`, `V-EXP1`, `MM-PB-CHECK`, `MM-RLY-CHECK`, `MM-SW-CHECK` |
| Fixtures / goldens, tier B | 11 / 11 | `ER-ALTCOUNTER`, `I-EXP9`, `II-2BUTTONMEM`, `II-FF1`, `II-MANUALMEM`, `II-SELFLOCK`, `IV-EXP1-FAST`, `IV-EXP1-SLOW`, `IV-FF1`, `IV-FF2`, `IV-FF2-CARRY` |
| Fixtures / goldens, tier C1 / C2 | 1 / 3 | `I-EXP11`; `I-EXP12`, `I-EXP13`, `I-EXP14` |
| Tier D | 0 | never created; `tier` enum excludes it (§13.6.8) |
| Probes | 8 | `AT-01`, `AT-04`, `AT-05`, `AT-06`, `AT-07`, `AT-09`, `AT-10`, `AT-11` |
| `solver-kat.json` | 21 cases: 17 `solve`, 3 `pwl`, 1 `quantize` | `divider`, `series-through-float`, `collapsed-coil`, `collapsed-armature`, `zero-unknown`, `datum-not-lowest-index`, `arc-clamp-single`, `arc-clamp-series-junction`, `lamp-cold-start`, `lamp-warm-relaxation`, `pwl-below-first-breakpoint`, `pwl-above-last-breakpoint`, `pwl-on-a-breakpoint`, `saturating-quantize`, `pivot-tie`, `rl-rise-500`, `freewheel-500`, `six-coil-load`, `whole-panel-cold`, `whole-panel-500`, `whole-panel-open-feed` |
| `netlist-kat.json` | 40 cases | 14 `I-EXP*`, 11 `II-*`, 7 `III-*`, 3 `MM-*`, `SYN-HOLE-EXHAUSTION`, `SYN-SAME-TERMINAL`, `SYN-ALL-FLOATING-ISLAND`, `SYN-RAILS-PREUNIONED-NO-CORD`, `SYN-DATUM-NOT-LOWEST` |
| `profile-kat.json` | 1 profile, 10 derived | `MV601-KAT-A` → `pullInUa`, `dropOutUa`, `relayPullInUa[6]`, `relayDropOutUa[6]`, `relayOperateTicks`, `relayReleaseTicks`, `pushbuttonTicks`, `slideTicks`, `arcStepUa`, `kThermal` (hex double). The file carries no hash. |
| `w3-derived-kat.json` | 9 derived | `source.profileHash` `8fb3c78e1d2c9a09`; `tripDelayTicks`, `deadShortUa`, `rMotorParUohm`, `vMotorRunMv`, `relayCycleTicks`, `buttonCycleTicks`, `switchCycleTicks`, `dialCycleTicks`, `settleCapTicks` |
| `w2-at02-static.json` | 2 programs | `IV-EXP1` 44 wires → `111`; `ER-ALTCOUNTER` 48 wires → `101`; projection hash `7dfc1d82a9341248` |
| Shipped hashes | — | netlist `2354ceebf3f8c566`; `MV601-REF-A` profile `e25b2257499508da` |
| Observables | 33 | `power`, `breaker`, `relay1..6`, `pb1..6`, `sw1..6`, `dial` (min −1), `outLamp1..6`, `indLamp1..6` |
| Profile scalar keys, in hash order | 43 | `tick_us`, `gmin_ns`, `V_oc_mv`, `R_src_uohm`, `I_trip_ua`, `trip_delay_us`, `R_coil_uohm`, `L_coil_uh`, `V_arc_clamp_mv`, `V_pullin_mv`, `V_dropout_mv`, `relay_operate_stroke_us`, `relay_release_stroke_us`, `pushbutton_stroke_us`, `slide_stroke_us`, `relay_bounce_us`, `break_milli`, `make_milli`, `R_cold_uohm`, `R_hot_uohm`, `I_hot_ua`, `lamp_thermal_tau_us`, `lamp_on_milli`, `lamp_dim_milli`, `contact_arc_udeg`, `wiper_offset_udeg`, `run_mrpm`, `hand_slew_mrpm`, `coast_udeg_stop_shorted`, `coast_udeg_drive_removed`, `R1_uohm`, `R2_uohm`, `R_arm_uohm`, `settle_quiet_ticks`, `settle_cap_us`, `chatter_n`, `chatter_cycles`, `chatter_quiet_cycles`, `min_decision_ua`, `min_tick_gap`, `R_contact_uohm`, `R_wire_uohm`, `visual_decay_us` |
| Panel | 186 terminals, 392 holes, 21 controls, 12 lamps + 1 jewel, 3 plates, 12 bands, 40 regions, 16 dial angles | `6×50 + 2×2 + 18×2 + 2×6 + 20×2 = 392`; eleven inventory digests in `test/panel-layout.spec.ts` |
| Demos | 11 | `IV-EXP1` 44, `ER-ALTCOUNTER` 48, `VI-TICTACTOE` 72, `V-JOBSELECT` 30, `VI-RANDOM` 40, `III-RELAYAND` 10, `III-RELAYOR` 11, `III-RELAYNOT` 6, `III-RELAYXOR` 11, `V-EXP2` 16, `IV-FF2` 14 connections |
| CLI cases | 5 | clean; assertion failure; load failure; `--list-fallbacks`; arity rejection (`test/conformance/cli.spec.ts`) |

The runner contract's exact statements — header templates, `formatMs` alignment, the `?` payload
in observable index order with one space between fields and two before the quote, the `>` line
timestamp read before `apply`, the em dash in chatter lines, `minDecisionUa` over non-negative
margins only, strictly positive tick gaps, the settle rule (`!changed && MotionMask() == 0` for
`settle_quiet_ticks`, anomaly on cap for the trace runner but a thrown error for the probe
runner), probe checkpoints strictly increasing, `near` inclusive in 64-bit, `eventSeen` cumulative
per case, `ticksOverTrip` as the initial contiguous run, the four bless refusals the port must not
be able to evade — are written into `docs/port/CSHARP-PORT.md` at G0 from the code, with
`file:line` citations, and are not restated here.

## Appendix F — sources for the external facts

Read on 2026-09-03. Architecture §13.6.9 lists the subset it cites, with the same numbering.

- F1 — Godot docs, *C#/.NET* (`tutorials/scripting/c_sharp/index.html`): desktop supported since
  4.2; Android and iOS experimental; "projects written in C# cannot be exported to the web
  platform".
- F2 — godotengine/godot#70796 (open, no milestone); draft PRs #106125 and #118976.
- F3 — godotengine.org/download/archive and the `4.7.2-stable` release (2026-08-18);
  godot-builds releases show `4.8-dev4` as the newest pre-release.
- F4 — formulae.brew.sh casks `godot-mono` (4.7.2, depends on `dotnet-sdk`) and `dotnet-sdk`
  (10.0.400).
- F5 — godotengine/godot#118806 (a closed 4.7-dev5 crash report whose body shows
  `config/features` rewritten from `"4.6"` to `"4.7"` on opening a 4.6.1 project — evidence of
  rewrite on version migration, hence `[likely]`).
- F6 — Godot docs, *Exporting projects* (export templates; the non-resource include filter for
  `.txt`, `.json`, `.csv`).
- F7 — builds.dotnet.microsoft.com `releases-index.json`: .NET 8 and 9 EOL 2026-11-10; .NET 10 LTS
  EOL 2028-11-14.
- F8 — `modules/mono/editor/GodotTools/GodotTools.ProjectEditor/ProjectGenerator.cs`
  (`GodotMinimumRequiredTfm => "net8.0"`) at tags `4.5-stable`, `4.6-stable`, `4.7.2-stable`.
- F9 — godotengine.org/article/godotsharp-packages-net8.
- F10 — godotengine/godot#103545 (open).
- F11 — docs.json-everything.net/schema/basics (`Dialect.Default`).
- F12 — Godot docs, *Exporting for macOS* (Universal 2); `GodotTools/Export/ExportPlugin.cs` at
  `4.7-stable` (both RIDs published under the `universal` feature).
- F13 — Godot class reference, `FileAccess.get_file_as_bytes`.
- F14 — godotengine.org/releases/4.5 (AccessKit screen-reader support, experimental).
- F15 — Godot class reference, `JSON` (inherits `Resource`; numbers parsed with
  `String.to_float`); `core/io/json.cpp` at `4.7-stable`.
- F16 — `core/register_core_types.cpp` at `4.7-stable` (`ResourceFormatLoaderJSON` registered).
- F17 — Godot class reference, `Time.get_ticks_usec`.
- F18 — Godot class reference, `Engine.time_scale`.
- F19 — JSON Schema Validation 2020-12 §6.1.1 (`integer`: any number with a zero fractional part).
- F20 — learn.microsoft.com, .NET 9 breaking change *Floating point-to-integer conversions are
  saturating*; dotnet/runtime#61885.
- F21 — learn.microsoft.com, C# arithmetic operators (`%` on floating-point operands).
- F22 — Godot class reference, `OS.get_cmdline_user_args`, `OS.shell_open`.
- F23 — Godot class reference, `SceneTree.quit`.
- F24 — Godot class reference, `AudioStreamPolyphonic` (`polyphony` default 32).
- F25 — Godot class reference, `AudioStreamPlayer.pitch_scale`.
- F26 — Godot class reference, `ConfigFile`.
- F27 — Godot class reference, `Viewport.push_input`, `Viewport.notify_mouse_entered`,
  `Viewport.physics_object_picking`, `CollisionObject3D.input_event`, `input_ray_pickable`,
  `input_capture_on_drag`; godot-demo-projects `viewport/gui_in_3d`.
- F28 — dotnet/runtime `src/coreclr/jit/lowerxarch.cpp` (FMA nodes only from intrinsics).
- F29 — dotnet/runtime `src/coreclr/jit/lowerarmarch.cpp` (madd/msub integer-only).
- F30 — dotnet/runtime `docs/design/coreclr/botr/ilc-architecture.md` (NativeAOT uses RyuJIT).
- F31 — dotnet/runtime#64604 (contraction is value-changing; `-ffp-contract=off` for native
  builds).
- F32 — dotnet/runtime#64591, #10137, #8289 (automatic FMA contraction declined).
- F33 — `modules/mono/mono_gd/gd_mono.cpp` at `4.7-stable` (C# loaded through `hostfxr`/CoreCLR
  on desktop); `Godot.NET.Sdk/Sdk/iOS.targets` (NativeAOT); `GodotTools/Export/ExportPlugin.cs`
  and `gd_mono.cpp` (Android CoreCLR-or-Mono selection).
- F34 — Godot docs, *Complying with licenses* (MIT; third-party notices via
  `Engine.get_license_text`); dotnet/runtime `LICENSE.TXT` (MIT).
