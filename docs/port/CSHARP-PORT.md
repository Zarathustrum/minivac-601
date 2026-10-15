# C# port guide — MINIVAC 601 core and conformance runner

Version 1, 2026-09-03. This guide is the executable handoff for the TypeScript-to-C# port. The
authorities, in order, are the shipped TypeScript code, the blessed conformance artifacts, the
dated corrections in `docs/plans/architecture.md` §13.6.8, and then the older architecture prose.
Never change or re-bless a frozen artifact to make the port pass. A mismatch is a port bug unless
the unchanged TypeScript suite demonstrates a core defect; stop the wave in that case.

The required result is exact: every KAT double bit pattern, every snapshot integer, every event,
every probe integer and every trace byte. No comparison in this port has a tolerance except a
probe `near` check whose artifact itself supplies that integer tolerance.

## Boundaries and public surface

`Minivac.Core` is a plain `Microsoft.NET.Sdk` class library with no package, project or engine
reference. `Minivac.Conformance` owns schema validation and all artifact IO through
`IArtifactSource`; it does not bless. Godot is an adapter and composition root. It does not change
core semantics.

Transcribe these eleven modules one-to-one:

| TypeScript | C# |
|---|---|
| `contract.ts` | `Contract.cs` |
| `ints.ts` | `Ints.cs` |
| `terminals.ts` | `Terminals.cs` |
| `netlist.ts` | `Netlist.cs` |
| `profile.ts` | `Profile.cs` |
| `graph.ts` | `Graph.cs` |
| `solve.ts` | `Solve.cs` |
| `devices.ts` | `Devices.cs` |
| `rotary.ts` | `Rotary.cs` |
| `trace.ts` | `Trace.cs` |
| `machine.ts` | `Machine.cs` |

The public surface is exactly the exported members of `src/core/*.ts`, name-for-name. It includes
`CONTRACT`; all `Command`, `CmdResult`, `Event`, `Note`, `State`, `CordEnd`, `ChatterDev` and
`TraceAnomaly` shapes; `Machine.Apply`, `Advance`, `Snapshot`, `Observables`, `MotionMask` and
`DrainEvents`; `CreateMachine`; `LoadNetlist(byte[])`; `LoadProfile(JsonElement)` and its key
lists; the terminal table, parsers and `AllocateHoles`; `OBSERVABLES`, `OBSERVABLE_COUNT`,
`MOVER_OBSERVABLE_START`, `CHATTER_DEVICES`, `CHATTER_DEVICE_COUNT`, `WriteObservables`,
`FormatMs`, `FormatCommand`, `FormatTransitions`, `FormatAnomaly`, `FormatTrace`, and the chatter
workspace; every exported solver, graph, device and rotary member used by the tools; and the
`Ints` primitives. Preserve `CmdResult.why` strings and every `Note` and `Event` discriminator
exactly. They are contract, not implementation detail.

### C# symbol-spelling seam

C# needs static module containers where TypeScript has top-level exports; those containers are
mechanical and carry no convenience member. Within them, an exported TypeScript symbol keeps its
source spelling **except** for the five explicit C# endpoints already named in this guide and
plan: `loadNetlist` → `Netlist.LoadNetlist`, `loadProfile` → `Profile.LoadProfile`,
`createMachine` → `Machine.CreateMachine`, `allocateHoles` → `Terminals.AllocateHoles`, and the
`Machine` interface methods → `Apply`, `Advance`, `Snapshot`, `Observables`, `MotionMask`,
`DrainEvents`. Thus `Ints.roundHalfEven`, `Graph.createGraphWorkspace`, terminal parsers and all
data-member spellings remain as in TypeScript. This table resolves the prose's broad
“name-for-name” rule against its explicit C# endpoint list; it is the convention G2–G4 extend.

`IArtifactSource` is the only IO seam used by loaders and runners:

```csharp
byte[] ReadAllBytes(string relativePath);
IReadOnlyList<string> EnumerateFiles(string relativeDir, string pattern);
```

Paths use `/`, are relative to exactly `data/` or `conformance/`, and enumeration results are
sorted with `StringComparer.Ordinal`. `FileSystemSource` maps those roots to repository `data/`
and `test/conformance/`; `GodotResourceSource` maps them to `res://data/` and
`res://conformance/`. `Minivac.Trace` may read its one fixture argument with
`File.ReadAllBytes`; no `Minivac.Conformance` source may call `File.*` or `Directory.*` directly.

## The 21 determinism rules

1. **Node numbering.** For every non-datum super-node, take its minimum member terminal index,
   sort ascending and number rows `0..N-1`. The super-node containing `MINUS` is datum and has no
   row.
2. **Element order.** Iterate fixed non-source rows in `data/netlist.json` order, then connected
   positive-resistance cords by ascending int32 `CordId`, then the source last. Zero-resistance
   and absent-resistance cords emit unions only.
3. **Stamp order and expression trees.** Accumulate stamps in rule 2 order. Do not reassociate.
   Preserve every parenthesis from architecture §§3.3, 3.4 and 4.4. On every solved diagonal,
   stamp `gmin` first, before every element; this is the explicit ruling in
   `DECISIONS.md`, *2026-08-30 — Phase 1 Wave 1a spec readings*, made because the alternative differs by one ULP on the shipped
   divider row.
4. **LU is project code.** Partial pivot by maximum absolute value in the column; ties select the
   lowest row index. Preserve loop shape. No BLAS, MKL, `System.Numerics` or library solver.
   `SOLVE_MAX_NODES` is 174, but the LU matrix is `SOLVE_MAX_ROWS` squared, 173 squared; loops end
   at actual `N`.
5. **No transcendental functions.** No `Pow`, `Exp`, `Log`, `Sqrt`, trig, `Hypot` or single-
   precision rounding in the core. The lamp law is the PWL table.
6. **No FMA contraction.** Desktop Godot C# executes on CoreCLR, whose x64 and ARM64 RyuJIT paths
   do not auto-contract `a*b+c` `[verified: F28, F29, F33]`. Still ban
   `Math.FusedMultiplyAdd`, `MultiplyAddEstimate`, `System.Numerics` and `Godot.Mathf` in the
   core. A runtime sentinel must prove that a selected triple gives different results for
   `Math.FusedMultiplyAdd(a,b,c)` and `a*b+c`. Run the solver KAT inside every shipped export, not
   only under `dotnet test`. NativeAOT uses RyuJIT `[verified: F30]`; automatic contraction is a
   value-changing optimization rejected by the runtime project `[verified: F31, F32]`. Mono LLVM
   AOT contraction remains `[unverified]` and is not part of the Phase 3 desktop target.
7. **Integer time.** Time is an int32 tick. Convert each latency to ticks at profile load with the
   architecture formulas; mover travel uses the frozen remainder accumulator.
8. **Literal spread.** Per-relay spread is six literal integers. No RNG, seed or draw order.
9. **One solution per tick.** Contacts remain frozen for the tick; every mover advances from that
   one solution.
10. **Quantize before decisions.** Scale, floor-based round-half-even, normalize negative zero,
    clamp explicitly to int32, and set `flags.nonPortable` for NaN, either infinity or a clamp.
    Never decide a threshold from a `double`; never use a bare `(int)` cast or
    `double.ConvertToIntegerNative`. .NET 9+ changed such casts to saturate, while older x64
    behavior differed `[verified: F20]`; `ConvertToIntegerNative` restores the old
    platform-specific behavior. The explicit algorithm is the contract.
11. **Only two carried floating-point vectors.** Carry exactly six `iCoil` values and twelve
    `rLamp` values. Update them in rule 2 order. Multi-tick solver KATs pin the result.
12. **No unordered containers in an output path.** No `Map`, `Set`, `Dictionary` or `HashSet`
    iteration affects simulation or trace bytes. The C# core contains no `Dictionary<` or
    `HashSet<` at all. Use index arrays; core sorting is only on integer keys. The `?` line follows
    frozen observable index order, never JSON member order.
13. **No ambient inputs.** No wall clock, RNG or hash other than FNV-1a 64. Hash netlist raw bytes;
    hash the profile's normative semantic payload. Render each as sixteen lowercase,
    zero-padded hex digits with invariant culture.
14. **NaN stops portability.** Assert no NaN after every solve and set `flags.nonPortable`; a
    runner refuses a non-portable result. Where the graph deliberately writes the floating-node
    sentinel, emit the canonical positive quiet-NaN payload `0x7ff8000000000000` with
    `BitConverter.Int64BitsToDouble`, never `double.NaN`: .NET's default payload is negative on
    the proof host, while V8's frozen KAT value is positive.
15. **Tick granularity is validated.** At load, assert `tick_us * 20 <` the shortest device
    latency.
16. **Branch currents use companion equations.** After solving, evaluate each element current
    from its own equation and the resulting node voltages, even if both ends map to one super-node.
    Zero unknowns is a valid solve. A doubly pruned isolated coil follows the code's both-ends-open
    arc ramp.
17. **Canonical bytes.** All `data/**` and `test/conformance/**` text is UTF-8 without BOM, LF
    only. `.gitattributes` carries `* -text`. C# writers use `new UTF8Encoding(false)` and `"\n"`.
18. **The core stays engine-free.** It builds and tests on a machine with no Godot installed.
    Parse `Minivac.Core.csproj` in a test and assert zero `PackageReference` and zero
    `ProjectReference`.
19. **Contract JSON enters as bytes.** Parse `IArtifactSource.ReadAllBytes` with
    `System.Text.Json`. Godot uses `FileAccess.GetFileAsBytes` `[verified: F13]`, never `GD.Load`,
    `ResourceLoader` or `Godot.Json`; Godot registers JSON as a `Resource` and parses every number
    as `double` `[verified: F15, F16]`. Read integer fields as `long`; hash before parsing. Scan
    Godot C# and reject `GD.Load`, `ResourceLoader.Load`, `ResourceLoader.LoadThreadedRequest` or
    `Json.Parse` on a JSON path.
20. **One frame loop, one clock.** `FrameLoop.Frame(long nowUs)` owns accounting. `Loop._Process`
    only passes `(long)Time.GetTicksUsec()`. The clock is monotonic microseconds since engine start
    `[verified: F17]`; its independence from `Engine.TimeScale` was measured at G0 (Godot 4.7.2): at
    `Engine.TimeScale=0.1` the editor wall clock advanced 252357 µs while the summed process delta
    ratio was 0.155, and the export measured 250682 µs and 0.163. `_Process` delta is scaled by `Engine.TimeScale` `[verified: F18]` and is not
    an input; `_PhysicsProcess` is not used. Advance and drain once per tick, render one snapshot
    per frame, cap catch-up at 50 ms and retain the sub-tick remainder.
21. **Packed data is a byte copy proved at boot.** `npm run sync-data` alone writes the Godot
    copies; both runtimes assert byte identity. Include `*.json, *.trace` as non-resource export
    files `[verified: F6]`. `Boot.cs` loads through the core and refuses to start, naming both
    hashes, unless the netlist hash is `2354ceebf3f8c566`; a .NET test independently pins that
    value from line 2 of `test/conformance/golden/A/I-EXP1.trace`.

## Eight-step port sequence

1. Run `npm run sync-data`; never translate, retype or compile artifacts into C# literals. Check
   hashes at load. Before the first Windows checkout, retain rule 17's `* -text` configuration.
2. Transcribe `contract.ts` to `Contract.cs` one-to-one, preserving every serialized name.
3. Implement the eleven modules listed above.
4. Run `profile-kat.json`, `w3-derived-kat.json`, then all 21 cases in `solver-kat.json`. Stop at
   any bit mismatch. Once these pass, later failures are not floating point or derivation bugs.
5. Run all 40 cases in `netlist-kat.json`; compare only integers and strings.
6. Run every fixture `expect` clause. Passing means the port is a MINIVAC implementation.
7. Run every golden through `minivac-trace` and a zero-tolerance byte diff. Then run all probes to
   their pinned integers, the tier-B collapse test, and the W2 static classifier (`111`/`101`).
   Passing means the port is this MINIVAC implementation.
8. Export Godot for every shipped target and run steps 4–7 inside the export with `--headless --
   --selftest`. An editor run or `dotnet test` alone does not prove the shipped runtime. Phase 3's
   empirical target is macOS ARM64 on the macOS arm64 development host; other target-runtime proof is deferred.

## Transcription rules

| TypeScript construct | Required C# transcription |
|---|---|
| `profile.ts` `BigInt` derivations | Use project-wide checked arithmetic and explicit `checked(long)`. Catch `OverflowException` at the derivation site and rethrow the same `profile:` failure. Keep `idivRound64`'s `(absB + 1) / 2` integer-ceiling form. |
| `ints.ts` `fnv1a64` | Use `unchecked ulong`; format with `ToString("x16", CultureInfo.InvariantCulture)`. This is the only required unchecked block outside an optional literal rotary limb port. |
| `rotary.ts` limb multiply/divide | It may become `long`/`Int128`, but must preserve remainder round-half-up, asymmetric int32 saturation and `nonPortable`. C1/C2 goldens decide. |
| `roundHalfEven`, `quantize`, `idiv`, `idivRound`, `mod`, `iabs` | Transcribe literally. Round-half-even is floor-based. `idiv` and `idivRound` truncate toward zero; reverse rotary drive exercises negative dividends. For positive `b`, `mod` returns `[0,b)`. Never substitute `Math.Round`. |
| Floating-point-to-integer conversion | Use only `quantize`'s explicit floor, clamp and cast sequence. Bare casts and `double.ConvertToIntegerNative` are banned: neither is portable contract behavior. |
| Typed arrays | Map `Int32Array`, `Int16Array`, `Int8Array`, `Uint8Array`, `Float64Array` to `int[]`, `short[]`, `sbyte[]`, `byte[]`, `double[]`. Allocate by named constants, not literals: `GRAPH_TERMINALS=186`; `GRAPH_MAX_NODES=SOLVE_MAX_NODES=174`; `GRAPH_MAX_ROWS=SOLVE_MAX_ROWS=173`; `GRAPH_MAX_CORDS=256`; `GRAPH_FIXED_ELEMENTS=22`; `GRAPH_MAX_ELEMENTS=SOLVE_MAX_ELEMENTS=278`; `HOLE_COUNT=392`; `OBSERVABLE_COUNT=33`; `CONTACTS=31`; `CHATTER_DEVICE_COUNT=19`; `LAMPS=12`; `SECTIONS=6`; `STORE_PAGE_SIZE=CHATTER_PAGE_SIZE=64`; and the named derived capacities in `machine.ts`. Keep every range guard. |
| `Machine.observables()` | Return the live `int[]` by reference. Every caller copies before advancing; see `test/conformance/run.ts:79,121-140` and `test/conformance/probe.ts:284-296`. |
| `Object.freeze`, `readonly` | Use readonly fields, records and `IReadOnlyList<T>`. `Object.freeze(Array.from(typed))` becomes a copied read-only array, not a view. |
| TypeScript discriminated unions | Use a closed abstract base with sealed variant records/classes and exhaustively switch on the discriminator. JSON-derived variants are constructed only in the parser; public API callers still construct the required `Command`/`CordEnd` variants, and the machine/runner construct their own `Event`/`Note`/`TraceAnomaly` variants. Do not use an open record hierarchy or an untyped JSON bag. |
| Branded terminal and hole IDs | Use plain strings. Re-run the parser at every entry point, matching `terminalIndex`; do not introduce a JSON wrapper. |
| `Number.isInteger` / `isSafeInteger` | Perform the same boundary checks. Where TypeScript requires a safe integer, bound a C# `long` to the same `2^53` range. |
| NaN and infinity tests | Use `double.IsNaN`, `double.IsPositiveInfinity` and `double.IsNegativeInfinity`. |
| `%` on doubles or negative integers | Preserve C#'s dividend-sign/fmod-style semantics `[verified: F21]`. Keep `mod`'s `b > 0` precondition unguarded. |
| `Math.floor`, `Math.trunc`, `Math.abs` | Use `Math.Floor`, `Math.Truncate`, `Math.Abs` on `double`. Integer division may replace a floor only where the operand is proven non-negative. |
| Machine insertion sort | Copy the loop and comparator `priorMv > mv || (priorMv === mv && priorElement < element)`. No `Array.Sort` or LINQ. |
| Numeric string building | Call invariant `ToString` for every integer and long; keep project-wide `InvariantGlobalization=true`. |
| Profile `semanticHash` payload | Assert the payload is ASCII, then use `Encoding.ASCII.GetBytes`; this matches its one-byte-per-UTF-16-unit construction. |
| Runner string sorting | Use `StringComparer.Ordinal` and `string.CompareOrdinal`; never current culture. |
| `formatTrace` trailing-whitespace check | Use `char.IsWhiteSpace` on the final character. Its set differs from JavaScript only for characters traces cannot contain; U+FEFF is rejected separately. |
| Module exceptions | Keep one exception type per module prefix. Use `HoleAllocationException` with `WireIndex` and `Terminal`; use `ArgumentOutOfRangeException` for the two `RangeError` sites in `machine.ts`. Only CLI-visible and profile-rejection messages are byte/prefix contract. |
| Strict JSON read | Call `source.ReadAllBytes`; reject BOM, then any CR by byte offset, then invalid UTF-8 with `new UTF8Encoding(false, true)`, then invalid JSON using default `JsonDocument.Parse` options. Preserve this order. |
| Schema validation | Use `JsonSchema.Net`; set `Dialect.Default` to Draft 2020-12. Accept all shipped artifacts and reject the complete invalid corpus in `test/conformance/schema.spec.ts`, including duplicate `dev` entries in `obs` through `contains`/`minContains`/`maxContains`. |
| Standard output | Wrap `Console.OpenStandardOutput()` in `StreamWriter(stream, new UTF8Encoding(false)) { NewLine = "\n" }`; set `Environment.ExitCode`. Assertion failure still emits the complete trace on stdout. |
| File enumeration | Sort returned names ordinally or require uniqueness before use. Never expose filesystem order. |
| UI `Math.round` sites | Port as half-up `Math.Floor(x + 0.5)` in `Controls.cs` and `Stage.cs`; `Math.Round` is banned in the core and not a substitute in the app. |

### Duplicate object keys

A JSON artifact with duplicate object keys is accepted on both sides; the last key wins; neither
side rejects it. This is an acceptance rule, not a parser-internals rule. Leave
`System.Text.Json` duplicate-property handling at its default and never enable strict rejection.
The .NET 10 default is `[likely]` until G1 executes a test-local raw JSON input containing a
duplicate key and proves that load succeeds and the last value is observed. The TypeScript side
gets the corresponding raw-input test. No frozen fixture is edited for this check. Hashes are
over raw bytes before parsing, so duplicate collapse cannot change the hashed input. JSON Schema
2020-12 treats `1.0` and `1e3` as integers when their mathematical value has zero fractional part
`[verified: F19]`; both validators accept them.

## Conformance runner contract

The descriptions below cite the current TypeScript source. A port may reorganize private code but
must reproduce these behaviors.

### Fixture loading and validation

- Read bytes and reject, in order: UTF-8 BOM, any CR (report its byte offset), invalid UTF-8, then
  invalid JSON (`test/conformance/helpers.ts:41-63`). Schema validation uses Draft 2020-12, strict
  mode and all errors; rendered errors preserve validator order on TypeScript
  (`test/conformance/helpers.ts:28-39,175-179`). Validator-specific schema text after the CLI's
  fixed load-error prefix is the sole allowed parity difference.
- A `connect` endpoint must parse as a physical hole or touch terminal
  (`test/conformance/helpers.ts:65-80`). Every wire parses and hole allocation succeeds; initial
  wiring may not require cord id 256 (`test/conformance/helpers.ts:113-135`).
- Canonical wire pairs map section and motor rails to `PLUS`/`MINUS`, sort endpoint names
  ordinally, and join with `/`. An erratum's canonical `from` must be absent and its canonical `to`
  must occur exactly once (`test/conformance/helpers.ts:95-110,136-147`).
- A marginal fixture's `mechanism.profileKey` belongs to the normative key lists and its decision
  equals the fixed decision anchor (`test/conformance/helpers.ts:149-157`). Milliseconds must not
  overflow after multiplication by ten; citations and quotes contain only valid Unicode scalar
  sequences (`test/conformance/helpers.ts:82-93,159-171`).
- Load the named profile, require its id to match and require `tick_us=100`; load netlist raw bytes
  (`test/conformance/helpers.ts:175-197`). The fixture schema permits tiers A, B, C1 and C2 only
  (`test/conformance/types.ts:6,43-59`).
- Connect initial cords in allocation order using cord id `wireIndex` and physical hole ids. Any
  rejection is a runner error (`test/conformance/run.ts:46-55`).

### Trace execution

- Construction creates the machine, connects initial wires, copies the live 33-entry observable
  buffer, fills each `lastChange` with -1, and initializes `nextBoundaryTick` from the snapshot
  (`test/conformance/run.ts:62-82`).
- Every trace advance is a loop of `Advance(1)` calls. After each call, drain once. All drained
  events must share one timestamp; if events exist, that timestamp is the boundary tick, otherwise
  use `nextBoundaryTick`. Then record events and observable changes, append one transition line,
  append each chatter anomaly in event order, copy the live observable buffer and increment the
  boundary tick (`test/conformance/run.ts:121-146`).
- `eventCount` includes every event and must stay int32. A `power.on` event resets all per-
  observable last-change ticks before current changes are measured. `minDecisionUa` is the minimum
  non-negative `marginUa` among `relay.pullIn` and `relay.dropOut` events only
  (`test/conformance/run.ts:84-97`). `minTickGap` is the smallest strictly positive gap between
  changes of the same observable within a power epoch. Mover transitions count observable indexes
  2 through 20 and each count must stay int32 (`test/conformance/run.ts:99-119`).
- Trace settle advances one tick at a time. A quiet tick has no observable change and
  `MotionMask()==0`; any other tick resets quiet to zero. Return after exactly
  `settle_quiet_ticks` consecutive quiet ticks. Reaching `maxTicks` appends a `no-settle` anomaly at
  the last boundary and continues; it does not throw (`test/conformance/run.ts:148-162`).
- A `do` records the snapshot tick before `Apply`, rejects a failed command, then emits the `>`
  line at that pre-apply timestamp (`test/conformance/run.ts:164-169`). `advance.ms` and
  `settle.maxMs` multiply by ten (`test/conformance/run.ts:224-233`).
- An `expect` builds selected and included 33-entry vectors, scans all observables in frozen index
  order, emits only requested fields separated by one space, and records every mismatch in that
  same order. It then emits `<formatMs> ? <payload>  <quoted text>`: two spaces before the quoted
  text (`test/conformance/run.ts:171-195`). Golden quoting escapes backslash and double quote only
  (`test/conformance/helpers.ts:224-226`).
- Result generation refuses `flags.nonPortable`, freezes metrics, copies the mover digest and
  formats four headers followed by body lines (`test/conformance/run.ts:197-220`). Expectation
  failure does not suppress trace output; it is returned alongside the full trace.

### Exact trace text

The four headers are, with decimal integer substitutions and literal spaces:

```text
#!mv601-trace 1
# id=<id> contract=<contract> netlist=fnv1a64:<netlistHash> profile=<profileId>/fnv1a64:<profileHash> wires=<wireCount>
# rules settleTicks=<n> chatterN=<n> relayWinTicks=<n> relayQuietTicks=<n> buttonWinTicks=<n> buttonQuietTicks=<n> switchWinTicks=<n> switchQuietTicks=<n> dialWinTicks=<n> dialQuietTicks=<n>
# margins minDecisionUa=<integer|na> minTickGap=<integer|na> marginal=<true|false>
```

The formulas and field order are fixed in `test/conformance/helpers.ts:228-256`. Shipped hashes are
netlist `2354ceebf3f8c566` and `MV601-REF-A` profile `92c1419fd8cdd210` (`e25b2257499508da` before
the 2026-10-14 coast change).

`FormatMs` renders integer ticks as tenths of milliseconds, right-aligned to at least eight
characters (`src/core/trace.ts:114-137`). Command spelling, endpoint spelling and default
`r_uohm=0` are fixed at `src/core/trace.ts:139-161`. Transition lines scan observable index order,
put two spaces between changes and omit an unchanged tick (`src/core/trace.ts:163-193`). Chatter
uses the Unicode em dash in `"ms — suppressed"`; no-settle spelling is fixed
(`src/core/trace.ts:195-207`). `FormatTrace` rejects CR, embedded LF, BOM and trailing whitespace,
joins with LF, and appends exactly one final LF (`src/core/trace.ts:209-222`).

Observable order and spellings are fixed at `src/core/trace.ts:13-59`: `power`, `breaker`, six
relays, six pushbuttons, six switches, `dial`, six output lamps, six indicator lamps. Power is
`off/on`; breaker is `ok/tripped`; movers are `nc/mid/no`; dial is `gap/c0..c15` with `gap=-1`;
lamps are `off/dim/on`.

### Fallback listing and CLI

List only `expect` steps tagged `unverified`. Sort by fixture id ordinally, then script index, and
render `<fixtureId>\tscript[<index>]\t<source>\t<cite>\n`
(`test/conformance/run.ts:240-272`). Display a fixture path relative to repo root unless it escapes
the root (`test/conformance/run.ts:275-278`).

`minivac-trace` accepts exactly one argument: a fixture path or `--list-fallbacks`. The usage text
is exactly `minivac-trace: usage: minivac-trace <fixture.json> | minivac-trace --list-fallbacks`.
For a fixture, write the full trace to stdout. For each failed expectation, write
`minivac-trace: assertion failed at script[<i>] <dev>: expected <expected>, got <actual>` plus LF
to stderr and exit 1; otherwise exit 0. A thrown error writes `minivac-trace: <message>` plus LF
and exits 1 (`bin/minivac-trace:4-29`). The C# executable resolves the artifact root by walking up
from `AppContext.BaseDirectory` to the first directory containing both `data/netlist.json` and
`test/conformance/`; if none exists it reports exactly
`minivac-trace: cannot locate the repository root`.

Parity compares all five CLI cases: clean, expectation failure, schema/load failure,
`--list-fallbacks`, and wrong arity. Stdout and exit code must be byte-identical for all five.
Stderr is byte-identical except that schema validator detail after the fixed prefix
`minivac-trace: fixture: schema validation failed:` may differ.

### Probe loading and execution

- Probe input applies the same BOM, CR, fatal UTF-8 and JSON order
  (`test/conformance/probe.ts:60-77`), then Draft 2020-12 schema validation. Validate Unicode scalar
  sequences, unique case/checkpoint/check names and read kinds appropriate to machine versus
  profile-load scope (`test/conformance/probe.ts:47-125,128-134,224-243`).
- Checkpoint source indexes must be strictly increasing, not merely distinct. A fixture checkpoint
  must name an existing script index and its exact step kind; a scenario checkpoint must name an
  existing action index and exact action kind. Scenario wires and commands get physical parsing
  and hole allocation (`test/conformance/probe.ts:136-208`).
- Feed C requires series-with-coils indicator lamps; feed E requires across-rail lamps
  (`test/conformance/probe.ts:211-222`). Profiles and netlist are loaded through the same artifact
  roots; initial cords use allocation order and `wireIndex` ids (`test/conformance/probe.ts:245-262`).
- Probe `advance` intentionally makes one `Machine.Advance(ticks)` call, one drain, then one
  portability check. Do not reuse trace runner per-tick advance (`test/conformance/probe.ts:264-276`).
- Probe settle copies observables before advancing, then advances and drains one tick at a time.
  Quiet means vector equality and `MotionMask()==0`; it copies after every tick and checks
  portability. On cap it throws `probe: settle exhausted its cap of <n> ticks`; it never emits a
  trace anomaly (`test/conformance/probe.ts:278-299`).
- For fixture-backed cases, the production provider loads the named fixture through `FixtureLoader`
  and its strict byte/schema/semantic path, then maps that validated fixture to the probe's
  profile/netlist/wiring/script representation and requires its profile id to match the probe.
  It is an `IArtifactSource` consumer, never a test-only JSON parser. For scenarios, load the
  requested profile and netlist and allocate its wires.
  Execute through the last checkpoint only. A fixture `expect` step has no execution effect in a
  probe; a checkpoint at that step reads the current state. The event array is cumulative for the
  entire case; each checkpoint sees all events accumulated so far
  (`test/conformance/probe.ts:309-315,317-373`).
- Machine numeric reads expose selected state, relay, lamp and profile integers. A terminal-pair
  read fails if either endpoint floats and otherwise returns absolute millivolt difference.
  Boolean reads expose breaker state or relay held state (`test/conformance/probe.ts:385-407`).
  Comparisons are literal `<`, `<=`, `==`, `>=`, `>`. `near` computes the difference in 64-bit
  integer space and is inclusive: `abs(actual-expected) <= tolerance`
  (`test/conformance/probe.ts:409-447`). `eventSeen` evaluates against the cumulative case event
  list.
- A `profileLoad` builds the exact circuit by feed mode and includes the output lamps plus one
  extra lamp and the source (`test/conformance/probe.ts:449-471`). Cold state is zero coil current
  and `R_cold` for every lamp; solver configuration is derived directly from the profile
  (`test/conformance/probe.ts:474-499`).
- For each profile-load tick, solve, quantize every absolute branch current, take the source as
  `settledSupplyUa`, update the peak, and count `ticksOverTrip` only through the initial contiguous
  run over threshold. Settling compares the entire quantized current vector and requires
  `settle_quiet_ticks`; non-portable or capped runs throw (`test/conformance/probe.ts:501-550`).
- A profile-load `diagnostic` flag is echoed but does not waive any check. Overall `pass` requires
  every check in every case, including diagnostics (`test/conformance/probe.ts:565-611`).

### Bless refusal contract

The C# conformance library must not contain a bless operation, but its tests must prove it cannot
produce bytes that the TypeScript bless policy would reject. The four refusal gates are:

1. any structured expectation failure;
2. non-null `minDecisionUa` below profile minimum unless the fixture is marginal;
3. non-null `minTickGap` below profile minimum unless the fixture is marginal; and
4. for C2, missing or unequal reviewed digest (both event count and every mover-transition count).

These gates run before directory creation or write (`test/conformance/bless.ts:24-77`). Fixture id
lookup requires one and only one matching loaded fixture; the output path is
`golden/<tier>/<id>.trace` and may not escape the golden directory
(`test/conformance/bless.ts:80-101`). Blessing remains a TypeScript-reference privilege.

> **2026-10-13 amendment:** in TypeScript, gates 2 and 3 are now triggers for BLESS-ROBUSTNESS,
> not refusals (Tom's ruling, `docs/DECISIONS.md` 2026-10-13; architecture §9.3). A non-marginal
> fixture that trips either one is refused only if an assert fails under one of six perturbed
> profiles (`test/conformance/robust.ts`); otherwise it is blessed and bless logs one line naming
> the trip. The C# `GoldenAcceptancePolicy` (`dotnet/Minivac.Conformance/GoldenAcceptancePolicy.cs`)
> deliberately keeps the stricter refusal on either trip: the perturbation check is TS-only, and
> stricter is still safe for this contract, since anything C# accepts the TS bless also accepts.
> The C# policy and the TS bless now differ on a tripped fixture that passes robustness; C# refuses
> it.

## Asserted artifact inventories

| Artifact | Exact inventory |
|---|---|
| Tier A fixtures / goldens | 21 / 21: `I-EXP1` through `I-EXP7`, `I-EXP8-STEP5`, `I-EXP10`, `II-EXP5`, `II-EXP6`, `III-3STMT`, `III-XOR-PB`, `III-RELAYAND`, `III-RELAYOR`, `III-RELAYNOT`, `III-RELAYXOR`, `V-EXP1`, `MM-PB-CHECK`, `MM-RLY-CHECK`, `MM-SW-CHECK` |
| Tier B fixtures / goldens | 11 / 11: `ER-ALTCOUNTER`, `I-EXP9`, `II-2BUTTONMEM`, `II-FF1`, `II-MANUALMEM`, `II-SELFLOCK`, `IV-EXP1-FAST`, `IV-EXP1-SLOW`, `IV-FF1`, `IV-FF2`, `IV-FF2-CARRY` |
| Tier C1 / C2 fixtures / goldens | 1 / 3: `I-EXP11`; `I-EXP12`, `I-EXP13`, `I-EXP14` |
| Tier D | 0; it never existed and the schema excludes it |
| Probes | 8: `AT-01`, `AT-04`, `AT-05`, `AT-06`, `AT-07`, `AT-09`, `AT-10`, `AT-11` |
| Solver KAT | 21: 17 solve, 3 PWL, 1 quantize: `divider`, `series-through-float`, `collapsed-coil`, `collapsed-armature`, `zero-unknown`, `datum-not-lowest-index`, `arc-clamp-single`, `arc-clamp-series-junction`, `lamp-cold-start`, `lamp-warm-relaxation`, `pwl-below-first-breakpoint`, `pwl-above-last-breakpoint`, `pwl-on-a-breakpoint`, `saturating-quantize`, `pivot-tie`, `rl-rise-500`, `freewheel-500`, `six-coil-load`, `whole-panel-cold`, `whole-panel-500`, `whole-panel-open-feed` |
| Netlist KAT | 40: 14 `I-EXP*`, 11 `II-*`, 7 `III-*`, 3 `MM-*`, plus `SYN-HOLE-EXHAUSTION`, `SYN-SAME-TERMINAL`, `SYN-ALL-FLOATING-ISLAND`, `SYN-RAILS-PREUNIONED-NO-CORD`, `SYN-DATUM-NOT-LOWEST` |
| Profile KAT | `MV601-KAT-A`; `pullInUa`, `dropOutUa`, `relayPullInUa[6]`, `relayDropOutUa[6]`, `relayOperateTicks`, `relayReleaseTicks`, `pushbuttonTicks`, `slideTicks`, `arcStepUa`, plus `kThermal` by hex-double bit equality; the file carries no hash |
| W3 derived KAT | 9 integers: `tripDelayTicks`, `deadShortUa`, `rMotorParUohm`, `vMotorRunMv`, `relayCycleTicks`, `buttonCycleTicks`, `switchCycleTicks`, `dialCycleTicks`, `settleCapTicks`; source profile hash `8fb3c78e1d2c9a09` |
| W2 static input | `IV-EXP1`, 44 wires -> `111`; `ER-ALTCOUNTER`, 48 wires -> `101`; projection hash `7dfc1d82a9341248` |
| Observables | 33 in the order given above |
| Panel | 186 terminals, 392 holes, 21 controls, 12 lamps plus 1 jewel, 3 plates, 12 bands, 40 regions, 16 dial angles; `6*50 + 2*2 + 18*2 + 2*6 + 20*2 = 392`; eleven inventory digests in `test/panel-layout.spec.ts` |
| Demos | 11: `IV-EXP1` 44 connections, `ER-ALTCOUNTER` 48, `VI-TICTACTOE` 72, `V-JOBSELECT` 30, `VI-RANDOM` 40, `III-RELAYAND` 10, `III-RELAYOR` 11, `III-RELAYNOT` 6, `III-RELAYXOR` 11, `V-EXP2` 16, `IV-FF2` 14 |
| CLI | 5 cases described above |

Do not create `test/conformance/AT-02.discriminator.spec.ts`; it does not exist. The W2 static
classifier is `runStaticGate`/`classifyLamp` over `data/kat/w2-at02-static.json`, and the dynamic
count-four assertion belongs to `counter-golden.spec.ts` and the port's own traces.

The profile hash payload has 43 scalar keys in this exact order:

```text
tick_us, gmin_ns, V_oc_mv, R_src_uohm, I_trip_ua, trip_delay_us,
R_coil_uohm, L_coil_uh, V_arc_clamp_mv, V_pullin_mv, V_dropout_mv,
relay_operate_stroke_us, relay_release_stroke_us, pushbutton_stroke_us,
slide_stroke_us, relay_bounce_us, break_milli, make_milli, R_cold_uohm,
R_hot_uohm, I_hot_ua, lamp_thermal_tau_us, lamp_on_milli, lamp_dim_milli,
contact_arc_udeg, wiper_offset_udeg, run_mrpm, hand_slew_mrpm,
coast_udeg_stop_shorted, coast_udeg_drive_removed, R1_uohm, R2_uohm,
R_arm_uohm, settle_quiet_ticks, settle_cap_us, chatter_n, chatter_cycles,
chatter_quiet_cycles, min_decision_ua, min_tick_gap, R_contact_uohm,
R_wire_uohm, visual_decay_us
```

`relay_pullin_spread_milli` and `relay_dropout_spread_milli` are the array keys, each exactly six
integers, appended according to the current `profile.ts` semantic-payload construction. Do not
derive hash order from JSON object iteration.

## External fact inventory

These are evidence references, not replacement requirements. Facts tagged `[likely]` or
`[unverified]` retain their named runtime check or target exclusion.

| Ref | Confidence carried by this guide | Source and fact |
|---|---|---|
| F1 | `[verified]` | Godot C#/.NET docs: desktop support; Android/iOS experimental; no C# web export. |
| F2 | `[verified]` | `godotengine/godot#70796`, open with no milestone; draft PRs #106125 and #118976: C# web export remains absent. |
| F3 | `[verified]` | Godot archive and `4.7.2-stable` release, 2026-08-18: editor, mono templates and SDK version. |
| F4 | `[verified]` | Homebrew casks `godot-mono` 4.7.2 and `dotnet-sdk` 10.0.400; Godot cask dependency pairing. |
| F5 | `[likely]` | `godotengine/godot#118806`: evidence that opening a migrated project rewrites `config/features`; it is not a version pin. |
| F6 | `[verified]` | Godot *Exporting projects*: templates and non-resource include filters for files such as JSON. |
| F7 | `[verified]` | Microsoft .NET releases index: .NET 8/9 EOL 2026-11-10; .NET 10 LTS EOL 2028-11-14. |
| F8 | `[verified]` | Godot `ProjectGenerator.cs` at 4.5/4.6/4.7.2 stable: minimum required TFM `net8.0`. |
| F9 | `[verified]` | GodotSharp .NET 8 announcement: projects may target a newer TFM. |
| F10 | `[verified]` | `godotengine/godot#103545`, open: editor injects `net8` if `TargetFramework` is absent. |
| F11 | `[likely]` | Json-Everything schema docs: `Dialect.Default`; G0 must prove Draft 2020-12 inside an export. |
| F12 | `[verified]` | Godot macOS export docs and export plugin: Universal 2 publishes `osx-x64` and `osx-arm64`. |
| F13 | `[verified]` | Godot `FileAccess.get_file_as_bytes`. |
| F14 | `[likely]` | Godot 4.5 release notes: AccessKit screen-reader support is experimental; Phase 3 makes no screen-reader-parity claim. |
| F15 | `[verified]` | Godot `JSON` reference and `core/io/json.cpp` at 4.7-stable: JSON is a Resource and numbers parse through float. |
| F16 | `[verified]` | Godot `core/register_core_types.cpp` at 4.7-stable: `ResourceFormatLoaderJSON` is registered. |
| F17 | `[verified]` | Godot `Time.get_ticks_usec`: monotonic 64-bit microseconds since engine start. |
| F18 | `[verified]` for scaled delta; clock independence `[likely]` | Godot `Engine.time_scale`: it scales `_Process` delta. G0 measures whether ticks remain wall-clock based. |
| F19 | `[verified]` | JSON Schema Validation 2020-12 §6.1.1: integer means zero fractional part. |
| F20 | `[verified]` | Microsoft .NET 9 breaking change and `dotnet/runtime#61885`: floating-point-to-integer conversions became saturating. |
| F21 | `[verified]` | Microsoft C# arithmetic operators: floating-point `%` semantics. |
| F22 | `[verified]` | Godot `OS.get_cmdline_user_args` and `OS.shell_open`. |
| F23 | `[verified]` | Godot `SceneTree.quit`. |
| F24 | `[verified]` API; overlap checked in G0 | Godot `AudioStreamPolyphonic`; default polyphony is 32. |
| F25 | `[verified]` API; runtime change checked in G0 | Godot `AudioStreamPlayer.pitch_scale`. |
| F26 | `[verified]` | Godot `ConfigFile`. |
| F27 | `[verified]` APIs; end-to-end forwarding deferred | Godot viewport/input APIs and `godot-demo-projects` `viewport/gui_in_3d`. The 3D shell is Phase 4. |
| F28 | `[verified]` | dotnet/runtime `lowerxarch.cpp`: FMA nodes originate only from intrinsics. |
| F29 | `[verified]` | dotnet/runtime `lowerarmarch.cpp`: `madd`/`msub` path is integer-only. |
| F30 | `[verified]` | dotnet/runtime NativeAOT architecture: NativeAOT uses RyuJIT. |
| F31 | `[verified]` | `dotnet/runtime#64604`: contraction is value-changing; native runtime builds disable it. |
| F32 | `[verified]` | `dotnet/runtime#64591`, #10137 and #8289: automatic FMA contraction was declined. |
| F33 | `[verified]` | Godot mono host and export sources: desktop uses CoreCLR through `hostfxr`; iOS uses NativeAOT; Android selects CoreCLR or Mono. |
| F34 | `[verified]` | Godot *Complying with licenses* and dotnet/runtime `LICENSE.TXT`: MIT licensing and notice mechanism. |

## Divergence log

At G0 this log is intentionally empty. Add one row for every port failure traced to a missing or
ambiguous rule. Do not log ordinary transcription defects. At G3, re-read this guide against the
shipped `Minivac.Core`; every implementation step the guide did not determine becomes a row and is
then folded back into a rule or KAT case.

The G3 re-read folded three earlier underdetermined seams into this guide: exported-symbol spelling
under **C# symbol-spelling seam**, closed TypeScript union construction in the transcription table,
and fixture-backed probe ownership under **Probe loading and execution**. The bounded
validator-detail difference below is the one runner surface that cannot be a byte-for-byte rule:
the fixed CLI prefix is the portable contract and is exercised by the schema CLI parity case. No
other shipped `Minivac.Core` implementation step remained underdetermined.

| Date | Wave | Symptom | Missing or ambiguous rule | Resolution / proving case |
|---|---|---|---|---|
| 2026-09-03 | G1 / G3 re-read | TypeScript exports and discriminated unions did not dictate C# container spelling or a closed construction boundary. | “Name-for-name” did not resolve C# static containers/endpoints or prevent an open C# record hierarchy. | **C# symbol-spelling seam** pins the five endpoint exceptions; the transcription table requires closed bases and sealed variants. Core reflection and conformance tests exercise the result. |
| 2026-09-03 | G3 | Fixture-backed probes initially needed a test-local JSON provider. | The probe contract did not assign validated fixture lookup to the production `IArtifactSource` seam. | **Probe loading and execution** requires the `FixtureLoader`-backed production provider; default `ProbeRunner` tests run the shipped fixture-backed probes through it. |
| 2026-09-03 | G2 | Floating node sentinels differed only in NaN sign/payload. | Rule 14 required NaN detection but did not pin intentionally written NaN bits. | Use positive quiet NaN `0x7ff8000000000000`; `datum-not-lowest-index` and `arc-clamp-single` solver KAT cases are bit-exact. |
| 2026-09-03 | G3 | Schema/load-failure CLI diagnostics differ after the fixed prefix because Ajv and JsonSchema.Net render their own validation details. | The runner contract cannot require validator-internal text to be byte-identical. | The guide pins `minivac-trace: fixture: schema validation failed:` as the portable prefix; the schema CLI parity case compares that prefix and compares every other CLI stderr result byte-for-byte. |
