# Architecture — MINIVAC 601 simulator

Status: the implemented design; `docs/STATUS.md` carries current state. Binding inputs:
`docs/PROJECT-BRIEF.md`,
`docs/DECISIONS.md`, and the research package in `docs/research/`. Where this document rests on a
fallback rather than a fact it says so and cites `docs/research/open-questions.md`.

Every review finding is either applied below or answered in §15, which now carries a
**Considered and not taken** block. Nothing was dropped silently.

---

## 0. The synthesis, and what it took from where

> **2026-09-03:** the "Determinism rules" row's named cause, IL2CPP's FMA contraction, is superseded
> by the Phase 3 engine-target amendment, §13.6.3. The row's mechanism is unchanged. The "Second
> recorded cost" paragraph's 5,393 lines is the Phase 1 closure figure — §13.6.8.

Four architectures were designed independently and scored through three lenses. Each won the
lens it was built for and lost the others. This is not one of them with trim; it is the
mechanism-by-mechanism composition, with every fatal flaw named against an adopted mechanism
fixed rather than inherited.

| Concern | Mechanism | From | What was fixed |
|---|---|---|---|
| Relay electrical state | Coil is a series R-L branch; pull-in is a threshold on coil **current** | failure-first | The permanent `R_coil_shunt` is **deleted**. It broke AT-01 (Book I Exp 9 stops latching). Backward-Euler on an R-L branch is already a finite conductance, so no shunt was ever needed. The branch is retained for its measured release-path role, not as an explanation of the Book IV counter; see the canonical 2026-09-01 ruling in `DECISIONS.md` |
| Two release paths | Fall out of the solve: an open coil ramps down at the arc clamp, a shorted coil freewheels on L/R | failure-first, corrected twice | failure-first wrote the open release as the *slow* one. Under this model open is fast and shorted is slow, which is the direction the corpus requires. Review 1 then showed "open collapses in one tick" was an artifact of the companion's own `G_eq` riding a ~1 kV transient; §3.3's arc clamp replaces it |
| Boundary units | Integer-only. No float crosses the core boundary or enters a trace | port-first | `Record<TerminalId, …>` in the snapshot replaced by an array indexed by frozen terminal index — map serialization order is not a contract |
| Port equality proof | Layered KATs (solver, netlist) then fixtures then goldens, zero comparison tolerance | port-first | The golden is **line-oriented**, so `diff` localizes to an event. Layer 1's input is an **element list plus carried state**, not a pre-stamped matrix, so it covers stamping and the lamp law as well as the LU |
| Knife-edge bless gate | Refuse to bless a fixture that decides within a stated margin of a threshold | port-first | Carved out a declared `marginal` fixture class. The margin is now `minDecisionUa` — the design's decision variable is current, and a shorted-coil release decides at exactly 0 V |
| Golden trace format | Change-only, integer-timestamped, purely discrete text; profile hash in the header; `bless` refuses if a cited assertion failed | fixture-first | Hash algorithm, input and hex format pinned. Emission order is an explicit versioned list of 33 classified observables, not TypeScript declaration order. Encoding, BOM and line endings are normative |
| Analog channel | Separate tolerance-compared probe set carrying the acceptance tests | fixture-first | port-first had no analog channel at all; core-first put quantized volts in the goldens, which is the float-equality risk it deleted elsewhere |
| Fixture provenance | `as_printed` + `errata_applied: [{id, from, to}]` + a positive per-erratum test | fixture-first | The original negative test (`wires !== as_printed`) is vacuous once section prefixes are expanded at transcription time — it passes on a fixture where the transcriber forgot the correction |
| Tick model | Freeze contacts → solve once → advance every mover from that one solution. No settling fixpoint | core-first | Guarded by a load-time assertion (`tick_us × 20 < min device latency`), because the argument is a consequence of the tick size, not a structural result |
| Determinism rules | A numbered, mechanically-enforced list that is the port guide | core-first | Extended to cover carried floating-point state, quantize-then-decide, saturation, file encoding, branch-current evaluation, and IL2CPP's FMA contraction |
| Per-relay spread | Six literal numbers in the profile | core-first, port-first, failure-first | No PRNG. fixture-first's LCG is deleted. **The spread is now controlled against** — see §4.3 and §10, because a spread anti-correlated with the failing stages would carry the whole mechanism |
| Netlist source | Hand-authored `data/netlist.json`, checked in, hashed, loaded by both languages | port-first | No markdown parser over `jack-map.md`. No TypeScript literals either — core-first's profile-in-source is the brief's explicit anti-pattern |
| Spliced resistor | `r_uohm` on the patch cord | port-first | Without it Book VII is unrunnable — including the bias procedure that is the sole primary source for the hysteresis every design models |
| Play wire | `CordEnd` union: hole \| touch \| free | core-first | Kept `touch` despite the objection that it is electrically identical to plugging: it is, but it does **not occupy a hole**, and three of the four play-wire programs touch into a densely wired matrix |
| Help layer | `Note[]` on the snapshot, cut to the two kinds that do derived work | failure-first + core-first | Six kinds restated a `State` field the adapter already has, one unimplemented kind asserted the withdrawn counter explanation, and transient notes were invisible on a once-per-frame snapshot. Transients are Events, which are drained |

**The one thing that does not compose cleanly.** port-first's contract says a fixture must never
decide near a threshold; the default profile's declared marginal fixture may do exactly that. There
is no discipline that removes this. The choice made
here: ship the marginal fixtures, mark them `marginal: true`, record their decision margins in the
trace header, and state plainly that **they are the least portable artifacts in the suite**. If a
C# port ever disagrees on one, the solver KAT is what says whether the cause is arithmetic or
physics. Cost recorded: the "zero tolerance, permanently" claim holds for the whole suite except
that the marginal fixtures' equality is backed by the KAT layer rather than by a margin guarantee.

**Second recorded cost.** The pre-build estimate was ~1,600 core lines against the smallest
design's ~1,100. The final raw measurement is 5,393 lines; §13.6.8 records the current figures. The implemented mechanisms remain the R-L
coil, integer carried state, the KAT layer, the trace formatter, and the notes channel.

**Third recorded cost, new in revision 2.** Capacitors and motor *dynamics* are out of contract
1.0 entirely — not flag-gated, not reserved fields, absent. See §5, §8 and §15. That removes a
config flag that mutated the frozen element set, a carried double with no equation behind it, and
six elements no Phase 1 fixture touches; after W4's source-required Contract 1.1 relay-hand addition,
it costs a 1.2 minor bump when someone wires a Book VII
program or asserts on the motor.

---

## 1. The three hard boundaries

### 1.1 `src/core/` — DOM-free, framework-free

Owns: the netlist, the patch-cord graph, the solver, every device model, time, and the trace
formatter.

May not: import anything under `src/ui`; reference `document`, `window`, `performance`, `Date`,
`Math.random`; call any transcendental (`pow`, `exp`, `log`, `sqrt`, trig, `hypot`, `fround`);
allocate inside the tick loop.

Enforced mechanically, not by review:

- `tsconfig.core.json` compiles `src/core/**` with `"lib": ["ES2022"]` and **no `DOM`** — a stray
  `document` is a type error.
- ESLint `no-restricted-imports` bars `src/core` → `src/ui`.
- ESLint `no-restricted-properties` bars the transcendental list and `Math.random` inside
  `src/core`.
- `test/core-purity.spec.ts` greps the built core bundle for `document|window|Date|Math.pow`.

Runtime dependencies: **zero**. Dev: vite, typescript, vitest, eslint.

### 1.2 `test/conformance/` — the golden suite

Owns: fixtures (JSON), goldens (text), probes (JSON), KATs (JSON), the runner, `bless`.

Crossing in: nothing but the public core surface — `createMachine`, `apply`, `advance`,
`snapshot`, `observables`, `formatTrace`, `drainEvents`, and the data files.

Crossing out: nothing. The conformance layer is not importable by core or UI, and no conformance
concept (`expect`, `bless`) appears in the command union.

The **trace formatter lives in `src/core/trace.ts`**, not in the conformance layer. Review 3 caught
the contradiction: `src/ui/trace-view.ts` cannot import from `test/conformance/`, and a second
formatter in the UI is two formatters that can diverge. The formatter is also something the C# port
must ship anyway (its own `minivac-trace`), so it belongs on the frozen side of the boundary.

### 1.3 `src/ui/` — adapter

> **2026-09-03:** the Unity `Update()` sentence below is retargeted to Godot by §13.6.2.

Owns: the clock, the DOM, rendering, sound, layout.

May import from core: `contract.ts` (types) and `trace.ts` (the formatter). Nothing else. If the UI
needs a derived quantity it either computes it from `State` or `State` grows a field — it never
reaches into the solver.

`src/main.ts` is the deliberately small composition root outside that boundary. It alone imports
`loadNetlist`, `loadProfile`, `createMachine`, the raw netlist, the shipped REF-A profile and
`mountInspector`; it validates the two data inputs, constructs the `Machine`, and passes the
machine plus the raw netlist view into the adapter. This seam resolves construction without making
the UI a loader or widening its core imports. A source-level test pins both allowlists exactly.

`data/netlist.json` carries no panel coordinates. Phase 1's inspector uses a deterministic
schematic grid from the frozen terminal order and group boundaries, with placement owned by the UI;
it does not claim photographed geometry. Period-accurate panel layout belongs to Phase 2 assets.

The wall clock exists in exactly one function, and it is in the adapter:

```ts
// src/ui/loop.ts — the entire dependency of the simulation on wall time
let carryUs = 0;
function frame(nowMs: number): void {
  const dtUs  = Math.min((nowMs - lastMs) * 1000, 50_000);   // cap catch-up at 50 ms
  const total = dtUs + carryUs;
  const ticks = Math.floor(total / 100);
  carryUs = total - ticks * 100;
  for (let i = 0; i < ticks; i++) {
    machine.advance(1);
    sampleBoundary(machine.observables(), machine.drainEvents());
  }
  flushTraceAndRender(machine.snapshot());
  lastMs = nowMs;
}
```

Unity's `Update()` has the same clock accounting with `Time.deltaTime`. Each elapsed core tick is
sampled at its own boundary before the adapter performs its one DOM trace commit and one State
render for the animation frame. A bulk `advance(ticks)` followed by one observable read is not
equivalent: it collapses any intermediate transitions and assigns the survivors the frame-end
timestamp. The per-tick drain also preserves all transient Events, which is why those conditions
are Events and not `Note`s (§8).

---

## 2. Netlist representation

### 2.1 The four objects

| Object | Count | What it is |
|---|---|---|
| **Terminal** | 186 | An SDC designator: `1A`, `3com`, `6cap`, `M7t`, `M10`, `M+`, `D16`. Frozen index order = the order in `data/netlist.json` |
| **Hole** | 392 | Where one taper pin goes. `"3com#2"` — terminal plus **1-based** hole index. One cord end per hole, enforced |
| **Node** | 174 | A terminal's electrical identity. `186 − 14 + 2 = 174`: the fourteen power jacks collapse to PLUS and MINUS **by construction**, so the errata bus rule holds with zero cords plugged |
| **Element** | 22 | A two-terminal component spanning two nodes, **never** collapsed. 21 fixed components plus the supply |

The 22: 6 output lamps, 6 relay indicator lamps, 6 relay coils, R1, R2, the motor armature, the
supply. `1cap`..`6cap` are **bare terminals in contracts 1.0 and 1.1** — no capacitor element, no
`FITTED-CAPS` flag, no `caps[]` state field (§15). Books I–VI contain no reactive element, and a
flag that adds six elements to a frozen array mutates stamp accumulation order and therefore every
golden byte.

Contacts are not elements. A contact is a conditional union evaluated from an integer travel
scalar: 30 transfer sets (12 relay + 6 pushbutton + 12 slide) plus the rotary wiper = 31
contact-set records.

`1C` and `1E` are always distinct nodes because a lamp joins them. `1+` and `3+` are always the
same node. `1H` and `1L` are never joined — there is no field in the schema that could express it.
`jack-map.md` §4, §5, §7.

### 2.2 `data/netlist.json`

Hand-authored **once** from `jack-map.md` §§1–7. Checked in. Hashed. Loaded at runtime by both
TypeScript and C#, byte-for-byte identical. There is no build step and no markdown parser: the file
is prose with load-bearing footnotes, a parser for it would be larger than the data it produces,
and it would break every time the research file is edited.

```jsonc
{ "schema": "minivac.netlist/1",
  "terminals": [ {"id":"1A","holes":2}, …, {"id":"3com","holes":4}, …,
                 {"id":"M10","holes":6}, {"id":"M11","holes":6}, … ],   // 186, frozen order
  "bus": { "PLUS":  ["1+","2+","3+","4+","5+","6+","M+"],
           "MINUS": ["1-","2-","3-","4-","5-","6-","M-"] },
  "elements": [
    {"k":"lamp","id":"out1","a":"1A","b":"1B","curve":"lamp6435"},
    {"k":"lamp","id":"ind1","a":"1C","b":"1E","curve":"lamp6435"},
    {"k":"coil","id":"coil1","a":"1E","b":"1F","relay":1},
    {"k":"res", "id":"R1", "a":"D17","b":"D19","r":"R1_uohm"},
    {"k":"res", "id":"R2", "a":"D18","b":"D19","r":"R2_uohm"},
    {"k":"res", "id":"MOT","a":"D18","b":"D19","r":"R_arm_uohm","drives":"dial"},
    {"k":"source","id":"PSU","a":"PLUS","b":"MINUS"} ],                  // 22 with the ×6 expansions
  "contacts": [
    {"k":"relay","n":1,"set":1,"arm":"1H","nc":"1J","no":"1G"},
    {"k":"relay","n":1,"set":2,"arm":"1L","nc":"1N","no":"1K"},
    {"k":"button","n":1,"arm":"1Y","nc":"1Z","no":"1X"},
    {"k":"slide","n":1,"set":1,"arm":"1S","nc":"1R","no":"1T"},
    {"k":"slide","n":1,"set":2,"arm":"1V","nc":"1U","no":"1W"},
    {"k":"wiper","arm":"D16","pads":["D0","D1",…,"D15"]} ] }             // 31 with the ×6 expansions
```

The top-level fields are exactly `schema`, `terminals`, `bus`, `elements`, and `contacts`; all are
required and an unknown field fails load. Terminal entries contain exactly `id` and `holes`.
Frozen terminal order is section-major: for each section 1..6, use `jack-map.md` §2 table-row order
`A B + - C E F G H J K L N com cap R S T U V W X Y Z`; then use §3 table-row order
`M+ M- M1t..M9t M1b..M9b M10 M11 D0..D19`. The loader literal-pins that 186-id list and the hole
count of each entry; it does not accept a permutation whose totals happen to agree.

`bus` contains exactly `PLUS` and `MINUS`; their arrays are exactly the seven members and order
shown above. Relay and slide contact records require exactly `k,n,set,arm,nc,no`; button records
exactly `k,n,arm,nc,no`; the wiper exactly `k,arm,pads`. `n` is section 1..6, `set` is 1 or 2,
and `pads` is exactly D0..D15 in numeric order. Every bus-array member and every contact
`arm`/`nc`/`no`/`pads[]` endpoint is a `TerminalId` resolved through the frozen table before any
index array or union is built.

Element order and ids are also frozen: for each section `n = 1..6`, append `outN`, `indN`, then
`coilN`; after all six triples append `R1`, `R2`, `MOT`, `PSU`. A lamp requires exactly
`k,id,a,b,curve`, with curve `lamp6435` mapped to the profile's required `lamp_pwl_uohm`. A coil
requires exactly `k,id,a,b,relay`; its indexed stamp uses required profile keys `R_coil_uohm` and
`L_coil_uh`. `R1`, `R2`, and `MOT` require `k,id,a,b,r`, where `r` is respectively `R1_uohm`,
`R2_uohm`, and `R_arm_uohm`; only `MOT` also requires `drives:"dial"`. Every non-source element's
`a` and `b` are `TerminalId`s. The sole exception is `PSU`, which requires exactly
`{"k":"source","id":"PSU","a":"PLUS","b":"MINUS"}`: those two endpoint values are bus aliases,
not terminal ids. `PLUS`/`MINUS` fail in every contact or non-source endpoint, and a terminal id
fails in either PSU endpoint. PSU stamps from required `V_oc_mv` and `R_src_uohm`. An unknown
terminal endpoint or duplicate terminal-table id fails load. Numeric resistance never appears in
this file.

Contact-record order is also section-major: for each `n = 1..6`, append relay set 1, relay set 2,
button, slide set 1, then slide set 2; append the wiper after all six section groups. A transfer
record's identity is its exact `(k,n,set)` tuple (`button` has no `set`), and the wiper is the sole
`k:"wiper"` record; no parallel id namespace is invented. Thus there are
31 contact-set records controlled by 18 movers plus one wiper selection, **not 31 movers**. The 30
SPDT records describe 60 possible arm-to-fixed unions and the wiper 16 more, 76 possible pairs.
At W2 KAT stop states exactly 31 are active; intermediate mover travel or a W3 rotary gap may leave
any affected set open, so runtime active unions range from 0 through 31.

The `r` field names a **profile key**, never a number: resistances that the manuals never state do
not get baked into the netlist. The motor armature is an ordinary resistor with a `drives` marker;
what it does to the dial is §5, and it is a rate law, not a dynamical model.

`ncom`, `ncap` and the twenty matrix points appear in `terminals` and in no other array. That *is*
the statement that they are bare junctions — correct by construction rather than by a rule.

The portable loader boundary is raw bytes. `netlist.ts` accepts the ASCII bytes of this artifact,
computes FNV-1a 64 over those same bytes, decodes and parses them itself, and returns the bound
decoded value plus hash. An exact equivalent may assert byte/text identity before parsing. It may
not accept an already-decoded object beside unrelated bytes and claim those bytes authenticate it;
core remains free of `fs`, DOM, fetch, and other environment APIs.

### 2.3 How it is checked against `jack-map.md`

Four gates, because a single wrong terminal letter produces a simulator that is subtly and
permanently wrong:

1. **`test/netlist-shape.spec.ts`** re-derives and asserts jack-map's own totals: 186 terminals,
   392 holes, 174 nodes, 22 fixed elements, 31 contact-set records / 76 possible union pairs,
   18 movers plus the wiper, PLUS = 7 members,
   MINUS = 7, `ncom` = 4 holes, `M10`/`M11` = 6 holes, 26 bare junctions.
2. **The element attribute table.** The same spec asserts the `elements` array field-by-field
   against `jack-map.md` §5's component table — 21 rows plus the supply, hand-checked once: kind,
   both terminals, curve name, profile key, relay index. Gates 1 and 3 are blind to a wrong
   attribute on a right topology, and the mechanical ×6 expansion is exactly where that error is
   born (`jack-map.md` §5 gives capacitor 6 a different value from 1–5 — the class of slip this
   gate exists to catch, still worth catching for `curve` and `relay`).
3. **`data/kat/netlist-kat.json`** — 40 wire lists paired with their expected node partition
   (arrays of terminal ids) and floating set. String and integer comparison only, no arithmetic.
   This is what a wrong terminal actually trips. It is authored from the same file by the same
   hand as the netlist, so it catches **transcription slips, not misreadings** — stated plainly
   here because calling it "independent" overstates it (review 3).
4. **The isolation fixtures.** `II-EXP5` and `II-EXP6` fail loudly if `H` is ever tied to `L`; a
   core that ties them passes all three Maintenance Manual check circuits.

Counts alone are known not to catch a single wrong node assignment. That is why (2) and (3) exist.

`netlist-kat.json` has one normative shape; W2 does not invent a second fixture format:

```jsonc
{ "schema": "minivac.netlist-kat/1",
  "cases": [
    { "id": "I-EXP1", "source":"docs/research/programs.md#I-EXP1",
      "wires": [ {"id":0,"a":"1+","b":"1A"},
                   {"id":1,"a":"1B","b":"1-","r_uohm":0} ],
      "movers": { "relays":[0,0,0,0,0,0],
                  "buttons":[0,0,0,0,0,0],
                  "switches":[0,0,0,0,0,0] },
      "wiper": 0,
      "expect": { "k":"graph",
        "holes": [ {"id":0,"a":"1+#1","b":"1A#1"},
                    {"id":1,"a":"1B#1","b":"1-#1"} ],
        "partition": [ ["1A","1+","2+","3+","4+","5+","6+","M+"],
                       ["1B","1-","2-","3-","4-","5-","6-","M-"], "…" ],
        "floating": ["…"] } } ] }
```

The shown case is shape, not a complete two-wire expectation. The file contains exactly 40 cases.
The exact ordered manifest is:

- Book I: `I-EXP1` through `I-EXP14` in numeric order.
- Book II: `II-EXP1`, `II-EXP2`, `II-EXP3`, `II-MANUALMEM`, `II-SELFLOCK`,
  `II-2BUTTONMEM`, `II-FF1`, `II-EXP4`, `II-EXP5`, `II-EXP6`, `II-EXP7`.
- Book III: `III-3STMT`, `III-ANDOR`, `III-XOR-PB`, `III-RELAYAND`, `III-RELAYOR`,
  `III-RELAYNOT`, `III-RELAYXOR`. `III-NOT` is excluded because its first wire is unverified.
- Maintenance Manual: `MM-PB-CHECK`, `MM-RLY-CHECK`, `MM-SW-CHECK`; their printed shorthand is
  expanded once by the rule and exact arrays below before entering this artifact.
- Synthetic: `SYN-HOLE-EXHAUSTION`, `SYN-SAME-TERMINAL`, `SYN-ALL-FLOATING-ISLAND`,
  `SYN-RAILS-PREUNIONED-NO-CORD`, `SYN-DATUM-NOT-LOWEST`.

This exact 40-case partition KAT excludes the two counters by design: its job is netlist breadth,
not the count-4 classifier. `IV-EXP1` and `ER-ALTCOUNTER` instead have the separate checked-in
input artifact frozen in §9.5.

Maintenance shorthand has two distinct rules and is never expanded by the runner. An unnumbered
device letter names section 1 (`H` becomes `1H`). Process cord ends in printed wire-list order; an
unnumbered `+` or `-` names the lowest-numbered `n+` or `n-` terminal with a free physical hole
after all earlier ends, then the ordinary lowest-free-hole allocator of §2.4 applies. An explicitly
numbered rail terminal keeps that name and participates in the same occupancy. In `a/b` shorthand,
the frozen terminal arrays are exactly:

- `MM-PB-CHECK`: `1+/1Y`, `1Z/1A`, `1B/1-`, `1X/2A`, `2B/2-`.
- `MM-RLY-CHECK`: `1+/1H`, `1+/1L`, `2+/1Y`, `1X/1E`, `1F/1-`, `1J/1A`,
  `1B/1-`, `1G/2A`, `2B/2-`, `1N/3A`, `3B/3-`, `1K/4A`, `4B/4-`.
- `MM-SW-CHECK`: `1+/1S`, `1+/1V`, `1T/1A`, `1B/1-`, `1R/2A`, `2B/2-`,
  `1W/3A`, `3B/3-`, `1U/4A`, `4B/4-`.

Thus `MM-RLY-CHECK` consumes both holes of `1+` on its first two cords and assigns its third bare
`+` to `2+`; `1F/1-` consumes the first `1-` hole and the later explicit `1B/1-` the second. The
same alias-safe rule governs the bare rails in the pushbutton and slide-switch records.

Each `id` is required, unique, stable, and used in failures. The shape test literal-pins this list;
ids are not generated from array positions. Before `graph.ts` is written, W2 freezes the 35 source
wire arrays against their cited records and the five synthetic inputs. Expected graph outputs are
then authored independently from the netlist spec — never emitted by `graph.ts` or a second copy of
its algorithm. The required coverage subset is `I-EXP1`, `I-EXP11`, `II-EXP5`, `II-EXP6`, all
three maintenance cases, and all five synthetics; the remaining cases are preselected breadth, not
a search after outputs exist.

**W2 closure amendment, 2026-09-02 — the input freeze is executable.** Schema validation and
self-consistency against a co-located graph golden do not freeze an input: reversing an ideal cord
and reversing its expected hole row preserves both. `test/netlist-shape.spec.ts` therefore hashes a
canonical input-only projection before it compares any graph output. The projection is compact
JSON over `[schema,cases]`; each case contributes, in manifest order,
`[id,source,wires,[relays,buttons,switches],wiper]`, and each wire contributes `[id,a,b]` or
`[id,a,b,r_uohm]` when the resistance member is present. Graph/error expectations are excluded.
FNV-1a 64 over the UTF-8 projection is exactly `73b5b6b772c3e938`. This one external constant pins
all 35 cited source inputs and all five synthetic inputs independently of their co-located outputs;
source-only, endpoint, reversal, mover-state and co-mutated-input/output attacks are negative tests.

The KAT top level contains exactly `schema,cases`. A case contains exactly
`id,source,wires,movers,wiper,expect`; `source` is the evidence pointer for sourced cases and a
protocol description for synthetics. A wire contains exactly `id,a,b` plus optional `r_uohm`.
`movers` contains exactly `relays,buttons,switches`. `expect` is the discriminated `graph` or
`error` form below. Missing and unknown fields fail rather than acquire runner defaults.

Within a case, `wires[].id` is exactly its zero-based array index with no gap or duplicate. `a` and
`b` are terminal ids, not hole ids. `r_uohm` is optional int32 `>= 0` with the §3.1 semantics below.
A successful case has `expect.k = "graph"`; its `holes` has the same ids and order. The exhaustion
case instead has exactly `expect:{"k":"error","why":"hole_occupied","wire":2}`: three cord ends
target one two-hole terminal, so the third fails. The same-terminal case connects both ends of one
cord to one two-hole terminal and must allocate its two **distinct** holes. No case supplies an
already occupied hole id; W2 inputs are terminal-level and the allocator owns hole selection.

All mover inputs are mandatory — no omitted value means "rest". The three arrays are in physical
section order 1..6, have exactly six entries, and contain only the two stop values 0 and 1000 in
W2's static KAT. Relay 0 closes H–J and L–N; relay 1000 closes H–G and L–K. Button 0 closes Y–Z
and 1000 closes Y–X. Switch 0 (LEFT) closes S–R and V–U; 1000 (RIGHT) closes S–T and V–W.
`wiper` is required and is one integer 0..15, closing D16–D`wiper`; it is not a nineteenth mover.
Intermediate travel and rotary gaps belong to W3. All 35 source cases explicitly carry the
source-backed static state selected during input freeze; where the source states none, the case is
the all-0 rest/LEFT state with wiper 0 and says so in its `source` field. At least one synthetic case
uses all mover entries 1000 and wiper 15. Thus the KAT executes both alternatives of every
mechanically repeated SPDT table; the shape gate separately pins all 76 possible terminal pairs.

`partition` covers every one of the 186 terminal ids exactly once. Members are sorted by frozen
terminal index, then groups by their first member; it records unions only, never finite-resistance
connectivity. `floating` is the sorted list of the first member of each partition group removed by
the source-component prune. `holes` records the allocator result in wire order. Comparison is exact
string/integer equality; neither runner canonicalizes a malformed expected artifact into passing.

### 2.4 Designator parser, and hole allocation

`src/core/terminals.ts`. Accepts `1A`..`6Z` over exactly the twenty letters
`A B C E F G H J K L N R S T U V W X Y Z`; `n+`, `n-`, `ncom`, `ncap`; `M1t`..`M9t`,
`M1b`..`M9b`, `M10`, `M11`, `M+`, `M-`; `D0`..`D19`. **Rejects** `M10t`, `M10b`, `M11t`, `M11b`,
and any `D`/`I`/`M`/`O`/`P`/`Q` section letter. There is no `Q` terminal — `jack-map.md` §1 traps
the OCR artefact that invents one.

Book VII's `Ω` pseudo-terminal is **not** a terminal. In W2, the designator parser recognizes exact
Unicode `Ω`, `Ω_` followed by a positive base-10 integer with no sign or leading zero, and
`Ω_B1`..`Ω_B6`, and returns a symbolic splice token: respectively `unspecified`, `literal` carrying
the digit string, or `bias` carrying relay 1..6. It allocates no terminal id or hole and performs no
resistance conversion. OCR `Q`, a sign, a decimal point, `Ω_0`, and every other `Ω_*` form fail.
W3 pairs the two sides of the splice and resolves the numeric resistance under §7; this division is
what keeps W2's topology KAT from inventing an electrical value.

Shorthand `"1+/1A"` parses to a fully-qualified **terminal pair**. Fixture wire lists are stored
fully qualified at the *terminal* level — the Maintenance Manual's section-implied bare designators
(`+/H`) are expanded once at transcription time and the expansion is not runner behaviour. A
runner-side expansion rule is a rule the C# runner has to reimplement identically or silently build
a different circuit.

**Hole allocation is different, and it is normative runner behaviour** (review 2 is right that it
was unstated; it is wrong that the §2.4 principle forbids a rule here). Section-prefix expansion is
a *reading* of an ambiguous source, so it is resolved by a human once. Which hole a pin goes in is
not in the source at all — SDC never numbers holes — so there is nothing to transcribe and a rule
is the only option:

> Hole indices are **1-based**. Loading a fixture's `wires` list assigns, for each end in
> wire-list order, the **lowest-numbered free hole** on that terminal. A terminal whose holes are
> exhausted is a **fixture authoring error**: the load fails with `hole_occupied` and names the
> wire. The rule is stated here, restated in `CSHARP-PORT.md`, and covered by a netlist-KAT case
> whose expected `cords[]` array pins the assignment.

Fully-qualified `HoleId`s in fixtures were considered and rejected: they make a wire list unreadable
against the printed page, and they would have to be re-derived by hand for all ~30 fixtures.

---

## 3. The solver

### 3.1 Node model, and the datum

A node is a vertex in a conductance graph, never a boolean equipotential class
(`DECISIONS.md`, `components.md` §8.1). Per tick:

1. **Union-find** over: patch cords (hole → terminal → node), every **closed** contact taken from
   the frozen mover travels, and `D16`–`D{k}` when the wiper is on a pad. Path compression,
   union by size, `Int32Array` parent — ~30 lines.
2. **The datum.** The super-node containing `MINUS` is the reference. It is **eliminated from the
   matrix and receives no row**; its voltage is 0 by definition (`components.md` §8.4 step 2,
   "Ground the − node"). Every node voltage in `State` is relative to it.
3. **Canonical row order.** The remaining super-nodes are ordered by **ascending minimum member
   terminal index** and renumbered `0..N−1`. Not by DSU root (union-order dependent), not by
   insertion, never by `Map` iteration. The datum is skipped before renumbering, so a system whose
   datum does not contain the lowest terminal index still numbers identically in both languages —
   one solver-KAT case exists purely to exercise that.
4. **Source-component prune.** Walk the element graph — edges are elements *and* unions — from the
   source node. Super-nodes outside that component are **floating**: dropped from the matrix,
   reported as `null` voltage. This is `SERIES-THROUGH-FLOAT` (`open-questions.md` O-T6) decided
   structurally rather than by hoping `gmin` is small enough: in the Book II p.12 flip-flop node B
   stays in the source component *through the two coils in series*, so it solves as a divider and
   relay 2 sits near half current, which is the behaviour the research says a union-find-only model
   gets wrong.
5. `gmin = profile.gmin_ns` (default 1 nS) is stamped **on the diagonal only**, on every solved
   row, purely for conditioning. It is a profile value, not a code constant (constraint 8).

**Matrix size is bounded, not capped.** Let `R` be the number of connected cords whose
`r_uohm > 0`. Those cords are dynamic resistor elements; absent/zero cords are unions. Every matrix
row is in the source-connected component. Starting from the loose fixed-element bound of 43,
each positive-resistance cord has two endpoint super-nodes and can attach a previously disconnected
fixed-element component, so the conservative bound is `N <= min(173, 43 + 2R)`: at most 174
terminal nodes minus the datum. CordId permits at most 256
connected cords, so the active element count is at most `22 + 256 = 278`. The common `R = 0`
circuit retains the 43-row bound. W2 raises solver scratch to `MAX_N = 174` and
`MAX_ELS = 278`, removes the obsolete 44/64 errors and comments, and retains fixed backing arrays
with every stamp/LU loop bounded by actual `N`. The "matrix exceeded its cap" user error stays
deleted because no legal circuit exceeds the derived terminal bound. `flags.nonPortable` survives
for the arithmetic hazards it can actually catch (§3.5).

**Contacts and ordinary cords are ideal shorts, not resistors** — a deliberate departure from
`MV601-REF-A`'s `R_contact = 0.05 Ω` / `R_wire = 0.02 Ω`. Against a 150 Ω coil that is 0.03%,
below the resolution of anything SDC printed. A connected cord with absent `r_uohm` or
`r_uohm === 0` unions its endpoint terminals. A connected cord with `r_uohm > 0` does **not** union
them; it contributes one dynamic `res` element between their super-nodes. There is never both a
union and a parallel resistor for one cord. The two unused profile constants remain marked unused.
The errata counter's lamp bypass is exactly right under the ordinary-cord collapse — a contact
across the indicator lamp puts both lamp nodes in one super-node, so the lamp is hard-shorted,
dark, and out of the divider.

Dynamic element order is frozen with the same force as the 22 fixed rows: fixed non-source
elements remain in `data/netlist.json` order, then connected positive-`r_uohm` cords are stamped in
ascending int32 CordId, then `PSU` is stamped last. An absent/zero-resistance cord emits only its
union and no element row. The W2 graph tests run one endpoint pair as absent, explicit zero, and
positive: absent and zero have the same partition and no dynamic element; positive keeps the
endpoints in separate partition groups, contributes exactly one resistor, and participates in the
source-component walk.

**Because collapse is ideal, an element's own current is never read out of the matrix.** That is
determinism rule 16 and §3.3 writes the equations. Review 1 was right that three documented
behaviours have no current otherwise: a shorted coil spans one row and cancels out of both `G` and
`i`; a dead `+`/`−` short leaves the matrix with **zero unknowns**; and a shorted motor armature
would develop no braking. All three are handled by evaluating branch currents from companion
equations after the solve.

**Identified, not adopted: this node model gives a series arc nowhere to live.** When a contact
opens, the physical arc sits **in series with the coil, across the gap the contact just made**.
Step 1 above builds super-nodes from **closed** contacts only, so an opened contact leaves no gap
in the netlist to stamp anything across, and §3.3 can only stamp the arc as a conductance in
**parallel** with the coil. That is right for the open-release case — the arc current returns
through the air, outside the netlist, which is why §3.3 excludes `Garc` from `branchI` — and wrong
at a live junction, where nothing has opened and the same shunt steals current permanently (§3.3,
§4.2, `DECISIONS.md`, *2026-08-31 — O-E11 arc-pass latch*). Giving the netlist a real gap — an opened contact
contributing a node *pair* with a stamped arc element between them, rather than simply not
uniting — is an architecture-level change, not a solver fix. `open-questions.md` O-E11's
2026-08-31 amendment **extends** its own *"a change of integration scheme … **replaces** this
constant rather than measures it"* clause to cover this change, and says so as an extension rather
than as a reading — that clause's subject is the integration scheme, and this is the node model.
**Not scheduled, and nothing in §3.1 changes today**: Tom's ruling is to document the defect rather
than repair it, and it rests on a measured bound rather than on the state being out of reach.
Published programs do reach the state; what holds is that no relay decision differs from the landed
netlist's own DC answer in **215,760** transfer configurations over all 64 pushbutton combinations,
worst coil error **3.04101 mA**, which is **7.0% of the 43.333 mA pull-in** (§15.1 carries the
measurement, the margin, and the dated note).

**W2 requirement — an open contact is node separation.** `graph.ts` must ship an open contact as
the **absence of a union**: an open contact contributes nothing at all to the netlist — no union,
and no element of any finite resistance across the gap, however large — and a closed contact
contributes a union and nothing else. The requirement quantifies over **contacts**, and only
contacts. A cord is a different element class and is deliberately outside it: absent/zero
`r_uohm` makes the cord a union, while positive `r_uohm` makes it a resistor without a union. That
resistance is *along* its own connection — Book VII's splice or STOP shunt — never one *across* an
opened contact. Assertable at the netlist gate over `netlist.json`'s 31 contact-set
records, which is exactly the set this sentence covers, and stated as a W2 requirement. What fails if it is violated: every
state- or topology-based arc-arming criterion — including an exact oracle — silently stops arming
the moment any finite element bridges an opened contact, even a 1 TΩ one, so every open coil
silently stops being open and never releases. Only the shipped `abs(v) > V_arc` test is immune,
and it must not be the only thing standing between the model and that failure
(`DECISIONS.md`, *2026-08-31 — O-E11 arc-pass latch*).

### 3.2 A tick

```
1. apply queued commands (they land on tick boundaries; none carries sub-tick time)
2. FREEZE every contact from the travel scalars as they now stand
3. build super-nodes; eliminate the datum; prune to the source component
4. stamp G and i in frozen element order, source last; solve (§3.4)
5. if any coil branch exceeded V_arc_clamp: re-stamp those coils with their arc conductance
   and solve exactly once more. At most two solves per tick, never three
6. evaluate every element's branch current from its own companion equation (§3.3)
7. quantize the solution (§3.5)
8. advance i_coil, lamp filament resistance, breaker heat, dial angle from that one solution
9. advance ALL travel scalars from that SAME solution; emit events; derive notes
```

Steps 3–6 are pure. Step 9 writes only travel scalars and never touches a contact, so simultaneous
threshold crossings resolve simultaneously and the "mutate contacts inside the armature loop" bug
`components.md` §9.3 warns about is structurally impossible.

**There is no settling fixpoint.** With contacts frozen the per-tick network is a static graph, and
contacts can only change at a tick boundary, so the tick *is* the fixpoint. This deletes
`components.md` §8.4 steps 5–6 entirely: no iteration cap, no damping rule, no convergence
tolerance, no non-convergence error path — four portability hazards. The arc pass in step 5 is not
a fixpoint iteration: it is a fixed second solve, taken or not taken, with no third. It is a
conscious deviation from the research's written procedure, and §9.3 authorises it explicitly
*because* the tick is two orders of magnitude below the shortest device latency. That dependency is
load-bearing and is asserted at load time:

```ts
assert(profile.tick_us * 20 < minDeviceLatencyUs, 'the tick is no longer the fixpoint');
```

A genuine oscillator — user wiring can build one, the machine ships none — shows up as chatter
across ticks, is reported as an `Event`, and never throws.

### 3.3 Stamping, and branch currents

`Δt = tick_us × 1e-6` s. Every element is stamped from its own row of this table, in
`data/netlist.json` array order, source last.

| Element | Conductance stamped | Current source stamped | Carried state |
|---|---|---|---|
| Series R-L coil | `Geq = 1/(R_coil + L/Δt)` | `Ieq = Geq * ((L/Δt) * i_prev)` | `i_coil` |
| Coil with arc (pass 2 only) | `Geq + Garc`, `Garc = abs(i_prev)/V_arc` | `Ieq` unchanged | — |
| Lamp | `1/R_lamp` from carried filament state | — | `R_lamp` |
| Resistor (R1, R2, motor armature, spliced cord) | `1/R` | — | — |
| Supply | `Gsrc = 1/R_src` | `Isrc = Gsrc * V_oc` | — |

**Every branch current is evaluated after the solve from its own companion equation, on the
(possibly identical) node voltages** — never read out of the matrix, which carries no information
about an element whose two ends landed in one super-node:

```
v = V[a] - V[b]                                  // 0 for a collapsed element; V[datum] = 0
coil:      i = Geq * v + (Geq * ((L/dt) * i_prev))    // same parenthesisation as the stamp
resistor:  i = v / R
lamp:      i = v / R_lamp
supply:    i = Gsrc * (V_oc - v)
```

The coil equation is what makes the three cases the research separates actually separate:

- **Shorted coil** (`v = 0`): `i_n = i_prev * (L/Δt)/(R_coil + L/Δt)` — the freewheeling decay on
  `L/R_coil`, 0.9877 per tick on the shipped numbers. This is the mechanism every flip-flop in the
  corpus uses to turn a relay off, and it is why that release is slow.
- **Open coil**: the companion alone would put ~1 kV on a panel jack and drive `i` to 0 in one
  tick — both artifacts of `G_eq`, not physics. Pass 2's arc conductance holds `abs(v)` at
  `V_arc_clamp_mv` and the current ramps down at `V_arc/L` per tick (2.5 mA/tick on the shipped
  numbers, so 86 mA → 0 in ~3.5 ms, still well inside the 8 ms mechanical release stroke).
- **Two coils in series through a node with nothing else** — the `nE`/`mG` chaining idiom of
  Books II and IV and of `ER-ALTCOUNTER`. Without the clamp, backward Euler forces both branch
  currents to the arithmetic mean of their previous values in a single tick; review 1 showed that
  puts a dead coil at 43.15 mA, above three of the six relays' pull-in, and §4.3's direction latch
  then makes a one-tick numerical artifact a permanent relay operation. **Revision 2's closing
  sentence here — "with the clamp, neither current can move more than `V_arc·Δt/L` in a tick and
  the artifact cannot occur" — is wrong twice. It is corrected rather than deleted, because the
  reasoning above it still holds.** (i) The per-tick step is not `V_arc·Δt/L`: the companion gives
  the arc term **plus** the L/R decay,
  `Δi = (V_arc·Δt + i_prev·R_coil·Δt) / (L + R_coil·Δt)`, **measured at 3.436 mA**, not the 2.5
  mA this section prints for the arc term alone — on the shipped numbers that term is 2.47 mA/tick
  and the L/R decay adds ≈1.07 (`DECISIONS.md`, *2026-08-30 — Phase 1 Wave 1a spec readings*). (ii) The clamp does not prevent the
  artifact — it converts a **one-tick** artifact into a **permanent** latch. `Garc` is stamped as a
  *parallel shunt*, which is right for a coil across an opened contact and wrong at a live
  junction, where it steals current forever so the imbalance never closes: two coils seeded
  `[86.3, 0] mA` settle at **46.109272 / 40.341545 mA** against a true DC of **43.2368 mA**, arc
  armed for all 5000 ticks. The **arming** criterion is not the cause — an oracle-exact one
  reproduces that latch bit for bit, and all 46 permanent spurious latches with it. The
  **placement** is (§3.1, and `open-questions.md` O-E11's 2026-08-31 amendment). Measured and ruled in
  `DECISIONS.md`, *2026-08-31 — O-E11 arc-pass latch*; it ships unrepaired on Tom's ruling, and that ruling
  rests on a **bound**, not on the state being out of reach. Published programs do reach it —
  **80** of the **32,316** transfer configurations on the shipped axes (the tool's *at most one
  pushbutton down* axis), in `II-FF1`, `V-EXP10`, `V-EXP13` and `V-SUPERCIRCUIT`, and **1,122** of
  the **215,760** once simultaneous pushbutton presses are allowed, which `I-EXP4` prints. What
  holds is that **no relay decision differs from the landed netlist's own DC answer in 215,760
  configurations**, worst coil error **3.04101 mA**, or **7.0% of the 43.333 mA pull-in**
  (§15.1, which carries the measurement, the margin and the dated note in full).

**The zero-unknown case is defined.** AT-06 (a dead `1+`/`1−` cord) merges PLUS and MINUS into the
datum: `N = 0`, the LU is a no-op, every solved voltage is 0, and the supply's companion still
gives `i = Gsrc·V_oc = 19.4 A`, which trips the breaker. A porter who treats `N = 0` as an error
gets a crash where the reference gets a trip. Solver-KAT cases cover the collapsed coil, the
collapsed armature and the zero-unknown system.

The R-L companion is exact at DC: at a fixed point `i_n = i_{n−1}` reduces to `i = v/R_coil`, so
adding inductance **does not perturb the DC operating point** and AT-01 is untouched. This is the
specific reason the failure-first design's permanent `R_coil_shunt` is deleted rather than tuned:
at 400 Ω the Experiment 9 loop delivers ~38 mA against a 43.3 mA pull-in and the canonical latch
stops latching, and the 2–5× release band pins the shunt to 150–600 Ω, so the perturbation cannot
be tuned away. The companion model needs no shunt at all — it is a finite conductance by
construction. The arc conductance does not reintroduce one: it is stamped only on a branch whose
solved voltage already exceeded the clamp, which never happens while a coil is connected to
anything.

### 3.4 LU, and the lamp filament

Dense LU with partial pivoting, hand-written, ~45 lines, over the canonical row order of §3.1.
Pivot = max |a| in column, ties broken by **lowest row index**. No matrix library in either
language: ordinary circuits remain at most 43 rows and the legal positive-cord worst case is 173;
third-party pivot ordering is not a determinism contract we control. The inner loop shape is
**frozen**, not "free as long as the KAT passes" — any
re-association fails a bit-exact KAT, so saying otherwise is a contradiction. `CSHARP-PORT.md`
carries the loop as pseudocode with explicit parenthesisation and named temporaries, and so does
every expression in §3.3.

**The lamp is a thermal state, not a per-tick fixpoint.** The four-pass damped loop of revision 1
is deleted. Review 1 showed it was unspecified in three ways at once (start value, damping form,
residual) and that its residual — 2.8% on coil current from a cold start — was larger than the
decision margins §4.1 claims sensitivity to. Worse, an instantaneous lamp is electrically massless,
which deletes the cold-filament inrush that `FALLBACK-PWRUP-COLD` exists to exercise.

Instead each lamp carries its filament resistance and relaxes toward the PWL target on the profile's
own `lamp_thermal_tau_us` (40000 — `components.md` §9.3's 40 ms carried in the schema's integer
µs; no new constant, but a new *role* for it: see §14 risk 3 and §17.2):

```
R_target = pwl(abs(i_prev))                       // 33-breakpoint table, + - * / only
R_lamp   = R_lamp + ((R_target - R_lamp) * kThermal)     // kThermal = dt/(tau + dt), computed at load
```

Consequences, all of them improvements: the per-tick solve is a single linear system; the DC
operating point converges to the *exact* self-consistent point over ~τ rather than to within 2.8%
of it in one tick; the 7× cold inrush is real, so a marginal C-fed coil can pull in at power-on and
at a contact make, which is the behaviour `FALLBACK-PWRUP-COLD` is about; and there is no damping
rule, no pass count and no convergence criterion left to specify. `R_lamp` starts at `R_cold` at
power-on and is carried thereafter (determinism rule 11).

The tungsten law `R_hot·(I/I_hot)^0.36` is shipped as a **33-breakpoint piecewise-linear table in
the profile**, interpolated with `+ − × ÷` only. `Math.pow` is not required to be correctly rounded
and V8 and .NET disagree in the last ulps. The interpolation is pinned, because "interpolated" is
not a specification:

```
// segment search: linear scan from index 0, first j with I <= x[j]; ties take that j
if (I <= x[0])   return y[0];                    // clamp below the first breakpoint
if (I >= x[32])  return y[32];                   // clamp above the last
t = (I - x[j-1]) / (x[j] - x[j-1]);
return y[j-1] + (t * (y[j] - y[j-1]));
```

The generating formula lives in a comment and a one-off script; the shipped artifact is the table —
which is also exactly the thing a real measurement would replace. W1 generates the table at 33 and
at 9 breakpoints and reports whether any acceptance-test result or any relay decision differs; if
nothing does, 9 ships and the count stops being a magic number.

> **2026-08-30 (W1):** 213 quantized results and relay decisions compared between the 33- and
> 9-breakpoint tables: **0** relay or breaker decisions differ; 94 reported values differ, the
> largest by **1.243%** (`AT-05.cfed_supply_ua`). W1's finding was that 9 ships, measured on a
> model whose relay decisions are dominated by the cold-filament inrush, so to be re-checked if
> O-E12 is revisited. The profiles ship **33** pairs, and no ruling recording why is on file (open in
> `docs/STATUS.md`).

### 3.5 Floating point, and how a C# port reproduces a trace

> **2026-09-03:** the ".NET Core saturates" sentence is corrected by §13.6.4 and the "20 cases" count
> by §13.6.8 (it is 21). Read §13.6 with this section.

Three layers, in this order:

1. **No float crosses the boundary.** Every number in a command, a snapshot, an event or a trace is
   an integer in a named unit. Doubles exist in `solve.ts` and in the carried state — `i_coil` (6)
   and `R_lamp` (12) — and nowhere else.
2. **Quantize, then decide.** Every threshold comparison — pull-in, drop-out, lamp classification,
   breaker trip — happens on the quantized integer, never on the double. Quantization is one named
   function, and the scale is applied *before* rounding:

   ```
   int32 quantize(double x, double scale) {
     double s = x * scale;                        // volts -> mV, amps -> uA
     if (isNaN(s) || isInf(s)) { flags.nonPortable = true; return 0; }
     double r = roundHalfEven(s);                 // -0 -> 0
     if (r >  2147483647.0) { flags.nonPortable = true; return  2147483647; }
     if (r < -2147483648.0) { flags.nonPortable = true; return -2147483648; }
     return (int32)r;                             // never a bare cast of an out-of-range double
   }
   ```

   A bare cast is the hazard: JS `Math.round(x)|0` wraps modulo 2³², .NET Core saturates,
   .NET Framework yields `0x80000000`. Three answers for one expression. The clamp is explicit and
   a saturating case is in the KAT.
3. **The solver KAT.** `data/kat/solver-kat.json` carries **20 cases stated as an element list plus
   carried state plus expected node voltages, branch currents and updated carried state** — not as
   pre-stamped matrices, which would have tested the LU alone while §9.5 claimed they proved the
   stamping and the lamp law too (review 2). All doubles are **hex-encoded**
   (`"0x4029000000000000"`) so no decimal formatter or JSON number parser is in the loop. Four of
   the 20 are multi-tick, running 500 ticks of carried state. A porter runs this before touching a
   fixture. If it passes bit-for-bit, floating point is settled and never comes up again.

   The 20 are chosen, not round: divider, series-through-float, collapsed coil, collapsed armature,
   zero-unknown system, datum-not-lowest-index, arc-clamp single, arc-clamp series junction, lamp
   cold start, lamp warm relaxation, PWL below/above/on a breakpoint, saturating quantize, pivot
   tie, 500-tick R-L rise, 500-tick freewheel, six-coil load, and three whole-panel snapshots.

Layer 3 is what answers the objection that carried floating-point state compounds divergence
instead of re-deriving it. The objection is right that carried state amplifies any divergence; it
is answered by proving there is none, not by hoping.

---

## 4. The relay model

Six relays. One struct, one function, shared with pushbuttons and slide switches.

### 4.1 Coil

The coil is a **series R-L branch with `i_coil` as state**, not an algebraic load. Pull-in and
drop-out are thresholds on **current**; the profile authors them in volts (6.5 / 2.5, so anyone
comparing code to `components.md` §8.2 sees the familiar numbers) and derives
`i_pullin = V_pullin / R_coil` at load by the formula pinned in §4.4.

The R-L branch remains because it carries coil current through the two release topologies in §4.2.
It is **not** the simulator's explanation for the Book IV counter. W1 tested the architecture's
original proposal and returned finding (b); the canonical 2026-09-01 ruling in `DECISIONS.md`
governs every causal statement about the counter.

The analysis that motivated W1 used this warm-resistance comparison on `MV601-REF-A`:

| Drive | Loop R | i_final | i_pullin / i_final | t to threshold |
|---|---|---|---|---|
| E–F, bare coil | 150.7 Ω | 86.3 mA | 0.502 | 0.697 · L/150.7 |
| C–F, through the indicator lamp | 281.7 Ω | 46.2 mA | **0.939** | 2.80 · L/281.7 |

Those expressions are historical design inputs, not modeled counter behavior. W1 measured a loaded
C/E threshold-time ratio of **1.109**; the warm-filament counterfactual was **2.567**. No
`L_coil` in the 0.3–5.0 H sweep satisfied AT-01, AT-02 and AT-11 jointly. See
`DECISIONS.md`, *2026-09-01 — canonical marginal-counter ruling after W1*; do not infer a physical MINIVAC mechanism from either column.

**How much sag the W1 stand-in measured.** The corpus's input figures are 6.92 V
light-load and 6.62 V fully loaded (`components.md` §8.3) — a 4.38% sag against the 6.11% that
would be needed to put a nominal coil under a 6.5 V threshold. W1's loaded stand-in measured
3.418% coil-voltage sag against 6.245% needed. That result was one input to finding (b); it is not a
replacement causal account.

**Book I Experiment 8 step 5 binds in the opposite direction.** SDC tells beginners to drive all
six coils through their own indicator lamps simultaneously, with no caveat, `[verified]`
(`components.md` §8.3). W1 measured only **+885 µA (+1.95%)** settled margin for relay 1 in the
AT-01 latch and found the AT-11 DC reading crossed at two output lamps. It is the tightest
constraint in the corpus, so it is now an acceptance test in its own right
(**AT-11**, §9.4) and `check-profile` reports it jointly with AT-01 and AT-02.

### 4.2 Two release paths, without a rate-selection branch

| Coil condition | Branch voltage | Current behaviour | Release |
|---|---|---|---|
| Open (arm left the feeding contact) | clamped at `V_arc_clamp_mv` | ramps down at `V_arc/L`, ~3.5 ms on the shipped numbers | mechanical stroke dominates — **fast** |
| Shorted (both ends one super-node) | 0 V | freewheels, decays on `L/R_coil` | starts after the hold-off — **slow** |
| Series divider through a floating node | ~V/2 | settles **unequal** — see the correction below | direction latch keeps a mid-stroke armature moving |

No `sameNet(nE, nF)` test, no rate selection, no branch: the solve plus the companion equations of
§3.3 produce all three. Every flip-flop in the corpus turns a relay off by short-circuiting its
coil, and this is what makes that slow. Two timing constants (`relay_release_open_ms`,
`relay_release_shorted_ms`) collapse into one mechanical release stroke plus a **derived,
checkable** ratio.

Revision 1 wrote the open case as "collapses to 0 in one tick". That was the companion's `G_eq`
speaking, not physics, and it rode a ~1 kV transient across a panel jack. The arc clamp replaces it
and the release-in-N-ticks behaviour now falls out of a stated physical constant instead of out of
a discretization artifact.

**Correction to row 3, 2026-08-31.** "Settles inside the band" is false as written: the two series
currents settle **unequal**, and they straddle pull-in rather than sitting between the thresholds.
Seeded `[86.3, 0] mA` they land at **46.109272 / 40.341545 mA** against a true DC of **43.2368 mA**
— one above the nominal 43.333 mA pull-in and one below it — and stay
there, because `Garc` is a parallel shunt at a live junction and steals the imbalance permanently
(§3.3, `DECISIONS.md`, *2026-08-31 — O-E11 arc-pass latch*). It is a **latch**, not a settle. The row's release
column still holds. Unrepaired on Tom's ruling — and **not** because the state is out of reach.
Published programs reach it (§3.3, §15.1, and `open-questions.md` O-E11's 2026-08-31 amendment).
The ruling rests on two measured facts instead: the latch moves **no relay decision anywhere in the
census**, worst coil error 3.04101 mA against a 43.333 mA pull-in; and every repair measured
reintroduces this section's own revision-1 defect on states reached just as often — a 45.58 mA
one-tick coil collapse and 547 V on a panel jack, where the shipped solver holds 2.90 mA and
38.3 V.

Interpretation flagged: `components.md` §9.3's "typically 2–5×" is a general engineering statement,
not a Minivac measurement, and it does not say whether it means the L/R decay or the whole observed
release. This design holds the **total observed release ratio** as the constrained quantity, since
that is what R1 actually cares about, and `check-profile` enforces it on the quantized tick counts.

### 4.3 Travel, hysteresis, and the bi-stable band

```ts
// integer milli-travel, 0..1000; identical shape for relay, pushbutton and slide switch
const ua = m.coilUa;                        // quantized, from the solve
if      (ua >= p.pullInUa[i])  m.dir = +1;
else if (ua <= p.dropOutUa[i]) m.dir = -1;
else                           m.dir = (m.travel === 0 || m.travel === 1000) ? 0 : m.dir;

// exact stroke length: no rounding error accumulates, the stroke lands on the exact tick
if (m.dir !== m.dirPrev) m.acc = 0;
m.acc += 1000;
const step = idiv(m.acc, m.strokeTicks[m.dir > 0 ? 0 : 1]);
m.acc -= step * m.strokeTicks[m.dir > 0 ? 0 : 1];
m.travel = clamp(m.travel + m.dir * step, 0, 1000);

const ncClosed = m.travel < p.breakMilli;   // 450
const noClosed = m.travel > p.makeMilli;    // 550
```

The accumulator replaces revision 1's `stepMilli`, which review 1 correctly killed: a 12.0 ms
operate at 100 µs is 120 ticks, so `stepMilli` is 8.33, and as an integer it is 8 (12.5 ms) or
9 (11.2 ms) — a 4–7% stroke error in a design whose R1 margin is being repaired from 1.04×. With
the accumulator the stroke is exactly `strokeTicks` ticks and `check-profile` evaluates R1–R6 on
those integers.

Inside the band an armature **at a stop holds** — that is Book VII's bi-stable region, and it is why
the hold branch is what makes Book VII expressible (`components.md` §8.4 step 5). An armature
**strictly between the stops continues** in its current direction, because the band is a property of
the two end gaps and a literal freeze would park the arm inside the both-open window indefinitely,
which the mechanism cannot do (`components.md` §9.3).

`break → both-open → make` falls out of the one parameter pair, and so does the interrupted stroke,
and so does BK1 p.9's printed procedure — "find the position where both lights are OFF" — because
buttons take a travel **target**, not a boolean (§7).

**Per-relay threshold offsets are six literal numbers, and they are now controlled against.** Six
literals in the profile, applied to pull-in and drop-out together. No PRNG, no seed, no consumption
order. Book VII's blank six-row bias chart is the evidence that the relays differ, and
`components.md` §8.2 bounds the spread above at +0.42 V (AT-01 must still pass at 6.92 V).

The original vector `[300,−240,290,−110,250,−170]` aligned odd and even relay thresholds with the
stages selected by the earlier counter hypothesis. The project treats that as a fitting hazard,
not evidence. `tools/check-profile.ts` therefore ran these controls:

1. the joint AT-01 / AT-02 / AT-11 result with `dV_relay_mv` **all zero**;
2. the same with the offset vector **rotated by one relay index**.

Neither control produced the required counter discriminator, and neutralising `L_coil` did not
establish one either. W1 returned finding (b). The canonical `DECISIONS.md` ruling supersedes the
proposal this section tested; no control result is a physical explanation.

**Approved REF-A convention.** Wave D fixes the profile vector at
`[-282, -169, -56, 56, 169, 282]` mV, generated by the dated `A = 282 mV` linear-ramp rule in
`DECISIONS.md`'s 2026-09-01 Wave D ruling. It applies to pull-in and drop-out together. This is
an `[unverified]` simulator convention; it is not a measurement or an explanation of the physical
counter's marginality. The preceding old-vector passages remain W1 history.

### 4.4 Defaults, derivations, and the two that must change

`MV601-TIMING-A` fails two of its own five ordering constraints on its own defaults
(`open-questions.md` G2). The R-L model changes the shape of the release constants anyway. Proposed
starting values, all `[unverified]`, all mine and not SDC's:

| Parameter | MV601-TIMING-A | Here | Why |
|---|---|---|---|
| `tick_us` | 100 | 100 | unchanged |
| `relay_operate_stroke_us` | 12.0 ms (whole operate) | 12000, mechanical only | electrical rise is now solved, not asserted |
| `relay_release_open_ms` | 8.0 ms | — deleted | |
| `relay_release_shorted_ms` | 20.0 ms | — deleted | |
| `relay_release_stroke_us` | — | 8000, mechanical only | the shorted case gets its hold-off from L |
| `pushbutton_stroke_us` | 25.0 ms | 25000 | adopted unchanged; the golden's `pb1 nc->mid` timestamp depends on it |
| `slide_stroke_us` | 60.0 ms | 60000 | adopted unchanged |
| `relay_bounce_us` | 0.5 ms make / 0.0 break | **0, adopted and disabled** | see below |
| `L_coil` | — | **new**, ≈ 0.9–1.5 H indicative | unmeasured R-L carried-state value; retained for the release-path role, not as a counter cause |
| `V_arc_clamp_mv` | — | **new**, 30000 indicative | the arc across an opening contact; sets the open-release ramp and bounds one tick's `Δi` |
| `break_milli` / `make_milli` | 0.35 / 0.60 | **450 / 550** | R1's margin is 1.04× on the shipped fracs against a stated 3× |

**Contact bounce is adopted with a value of zero, not ignored.** `components.md` §9.3 ships
`relay_bounce_on_make_ms 0.5`, and revision 1 neither used it nor mentioned it — so a porter reading
the research file would implement it and get a different transition count in every golden. The key
is **required** in the profile schema and shipped at 0: no printed observable in the corpus
depends on a 0.5 ms bounce, it would multiply `*` lines in every trace, and it interacts with the
chatter rule. If a measurement ever justifies it, it is a profile edit and a re-bless.

**Load-time derivations are pinned, because one unit of rounding moves a golden's timestamps.**
All are evaluated in 64-bit integer arithmetic (`long` in C#; TS integers are exact below 2⁵³):

```
pullInUa    = idivRound(V_pullin_mv  * 1_000_000_000, R_coil_uohm)     // 6500 -> 43_333 uA
dropOutUa   = idivRound(V_dropout_mv * 1_000_000_000, R_coil_uohm)
relayUa[n]  = idivRound((V_pullin_mv + dV_relay_mv[n]) * 1_000_000_000, R_coil_uohm)
strokeTicks = idivRound(stroke_us, tick_us)                            // 12000 us -> 120 ticks
kThermal    = tick_us / (lamp_thermal_tau_us + tick_us)                // double, carried state only
arcStepUa   = idivRound(V_arc_clamp_mv * tick_us * 1000, L_coil_uh)    // uA per tick
```

`idivRound` is round-half-away-from-zero on integers and is defined once in `ints.ts`; `idiv`
truncates toward zero. Which one each derivation uses is written above and nowhere else. A
**load-time KAT** (`data/kat/profile-kat.json`) pairs a fixed profile with its exact derived integer
set, so a porter checks derivation before touching the solver.

`L_coil` is deliberately **not derived here.** W1 swept 0.3–5.0 H and found no value satisfying the
named joint acceptance set. The profile's 1.2 H remains an `[unverified]` working value for the
release-path model, not a W1 finding and not an explanation of counter marginality. The load-time
schema gate validates the value's form and derived arithmetic; `check-profile` reports the failed
joint result rather than pretending the profile passed it.

**The 0.9–1.5 H band above has been swept once, for one purpose.** §15.1's O-E11 bound was measured
at nine points across it on 2026-08-31 — 0.9, 1.0, 1.1, 1.2, 1.3, 1.35, 1.4, 1.45, 1.5 H — so that
the bound is band-wide rather than a property of the shipped 1.2 H (§15.1; `DECISIONS.md`, *2026-08-31 — O-E11 arc-pass latch*). That sweep does **not** pin or narrow the band: the constant is
still unpinned and still `[unverified]` (O-E10). W1b's result is finding (b), recorded in
`DECISIONS.md`, *2026-09-01 — canonical marginal-counter ruling after W1*.

---

## 5. The rotary model

A continuous angle in **integer micro-degrees**, 0..359,999,999. Never an integer position.
Snapping to sixteen positions would destroy three primary-sourced behaviours: the errata's
documented D6/D7 elevator hang, the Combination Lock's `D8/6E` pass-through trap, and Book VII's
pulse train, which exists *only* because the dead gap breaks the circuit fifteen times per
revolution (`rotary.md` §2).

```ts
// integer only, no trig, no float
function contactAt(udeg: number, p: Profile): number | null {
  const phi = mod(udeg - p.wiperOffsetUdeg, 360_000_000);
  const k   = idivRound(phi, 22_500_000);                 // 0..16 — NOT reduced yet
  let   raw = phi - k * 22_500_000;                       // circular difference, in (-11.25, +11.25]
  const d   = iabs(raw);
  return d * 2 <= p.contactArcUdeg ? (k % 16) : null;     // arc 16_875_000 by default
}
```

Revision 1 reduced `k` modulo 16 *before* taking the difference, which is not what `rotary.md` §2
writes (`delta = angular_difference(phi, k * 22.5)` — a circular difference). The bug was real and
one-sided: at φ = 355° it returned `null` where the true nearest pad is 0 at 5° away, killing the
approach-from-below half of position 0's arc and with it Book VII p.21's "when the rotary switch has
returned to 0 it stops" and p.24's return-to-zero pulse count. Rotary KAT cases pin 355°, 359.999°,
0.001°, and both sides of a pitch boundary; `idivRound`'s half-away-from-zero rule decides the
boundary at exactly 11.25° and that is stated, not implied.

Never returns two contacts, so break-before-make is structural. Returns `null` on 25% of the circle
at the default. `contact_arc_deg = 16.875°` / dead gap 5.625° is `UNIFORM-CONTACTS`
(`open-questions.md` **O-R1**), an unsourced engineering default chosen because it is a round number
strictly inside the only bound the corpus gives (0 < gap < 22.5°). `wiper_offset_deg` is exposed
because SDC's own realignment procedure treats it as adjustable (`rotary.md` §2).

**The sweep is integrated, never jumped.** `advance(n)` steps n ticks and every pad the wiper
crosses gets its own make and break event, under motor drive and hand drag alike. Hand motion has
its own rate — `hand_slew_mrpm`, `[unverified]`, the operator's knob speed — because `dialGrab`
takes a target and a target 180° away must still traverse every pad between (`rotary.md` §2: "the
connections are made sequentially whether the pointer is turned by hand or driven by the motor",
`[verified]` Book I p.22, and the Combination Lock's `D8/6E` trap depends on it). The load
assertion is over both rates:

```ts
assert(max(run_mrpm, hand_slew_mrpm) * tick_us < dead_gap_udeg_per_tick_bound, 'a contact can be skipped');
```

A rotary KAT case grabs a target 180° away and asserts every intervening pad emits its make and
its break.

**Drive is a rate law over a solved branch voltage, not a dynamical model.** The motor armature is
an ordinary resistor between `D18` and `D19` (§2.2), R1 and R2 are ordinary resistors, and the
dial's speed is

```
dial_mrpm = idivRound(run_mrpm * v_motor_mv, v_motor_run_mv)      // v_motor_run_mv derived at load
```

where `v_motor_run_mv` is the armature voltage the same network produces under condition 1. All
seven documented conditions then follow from the one topology `rotary.md` §3.1 settles:

| Condition | Falls out as |
|---|---|
| RUN, either polarity | supply across D17/D18; R1 in series, R2 shunting; direction from the sign of `v_motor` |
| STOP shorted while RUN is live | `v_motor = 0` → rate 0; supply current limited by R1 alone, which is why AT-10 does not trip |
| RUN de-energised | `v_motor = 0` → rate 0, R2 still across the armature → the braked stop, `coast_udeg_drive_removed` |
| Power across STOP | R1 bypassed, full rail on the armature → several times `run_mrpm` — "the knob should turn very rapidly" |
| 15/22/33 Ω across STOP | a cord with `r_uohm`; solved against R1 and R2, so the rate drops continuously. **Not optional** — BK7 p.24 wires it as an ordinary program line (`rotary.md` §3.2) |
| Hand on the knob | `dialGrab` sets a hand target approached at `hand_slew_mrpm`; the friction drive slips and the operator wins. No stall state |

**What this is honestly not.** Revision 1 claimed back-EMF, dynamic braking and three separated
braking time constants, with no torque constant, no inertia, no friction and no ω update law
anywhere in the document, and `rotary.md` §3.1 states flatly that neither manual gives R1 or R2.
Review 1 and review 2 both caught it. The dynamical model is **deleted from contract 1.0**. What
remains: `R1_uohm`, `R2_uohm` and `R_arm_uohm` are **three coupled invented constants** whose only
job is to set the *ratios* between conditions 1, 4, 5 and 6, and they are fitted so that condition 1
gives `run_mrpm`. That is stated here rather than dressed up as an emergent property. Stopping uses
the two coast angles the research names (`coast_udeg_stop_shorted` for the shorted case,
`coast_udeg_drive_removed` for everything else) and nothing else — a coast angle and a dynamical
brake are two mechanisms for one event, and revision 1 shipped both. `run_rpm = 45.0` remains
`open-questions.md` **O-R3**, Book V's worked-example assumption, labelled in the profile as an
assumption. The coast parameters are labelled invention (**O-R5**); do not cite the manuals for
them. No Phase 1 fixture asserts on any of it and tier C2 is digest-only (§9.3).

---

## 6. Time

Fixed **100 µs integer tick**. `state.tick` counts ticks since the last power-on. Nothing in
`src/core/` reads a clock.

| Quantity | Unit | Range |
|---|---|---|
| Travel (relay, button, switch) | milli-travel | 0..1000, int32 |
| Dial angle | micro-degrees | 0..359,999,999, int32 |
| Dial velocity | milli-rpm, signed | ±~200,000, int32 |
| Voltage | mV | int32 |
| Current | µA | int32 |
| Lamp brightness | milli | 0..1000, int32 |
| Time | ticks | int32 |

All latencies convert to integer per-tick counts **at profile load**, by the formulas pinned in
§4.4. Revision 1 claimed the resulting quantization was "12.0 ms becomes 12.0004 ms"; that is wrong
by two orders of magnitude and review 1 was right to call it. A stroke quantized to whole ticks is
exact — `strokeTicks = 120` *is* 12.0 ms — and the accumulator of §4.3 makes the travel integrator
land on it exactly. What remains is the quantization of a stroke whose millisecond value is not a
multiple of the tick: 12.05 ms would round to 120 ticks, a 0.4% error. `check-profile` evaluates
R1–R6 on the **post-quantization tick counts**, not on the profile's millisecond inputs, and asserts
the two agree within 1 tick — the one number that matters, since R1's repaired margin is being
defended at the same order.

No idle-skip. 167 tiny LU solves per 60 Hz frame is free, and a skip path is a second execution
path that can diverge from the first. No LU cache, for the same reason.

---

## 7. Command schema — frozen

`src/core/contract.ts`. Types only, zero logic. The JSON field names **are** the contract. Every
tagged union in this document — commands, cord ends, notes, events, fixture steps — uses the same
discriminator key `k`, because four keys for one job is four things a porter can get wrong.

```ts
export const CONTRACT = "1.1.0";

export type TerminalId = string;    // "1A" | "3com" | "1cap" | "M10" | "M+" | "D16"
export type HoleId     = string;    // "3com#2" — terminal '#' 1-based hole index
export type CordId     = number;    // int32, 0..255, caller-assigned
export type Sect       = 1 | 2 | 3 | 4 | 5 | 6;

export type CordEnd =
  | { k: "hole";  hole: HoleId }              // plugged; occupies the hole
  | { k: "touch"; term: TerminalId }          // held against a terminal; occupies no hole
  | { k: "free" };                            // loose — the play wire between touches

export type Command =
  | { k: "power";       on: boolean }
  | { k: "breaker";     reset: true }
  | { k: "connect";     cord: CordId; a: CordEnd; b: CordEnd; r_uohm?: number }  // int32 >= 0
  | { k: "disconnect";  cord: CordId }
  | { k: "button";      n: Sect; target: number }        // int32 0..1000 milli-travel
  | { k: "switch";      n: Sect; target: number }        // 0 = LEFT, 1000 = RIGHT
  | { k: "relayGrab";   n: Sect; target: number }        // hand owns relay travel, int32 0..1000
  | { k: "relayRelease"; n: Sect }                       // return relay to electrical control
  | { k: "dialGrab";    targetUdeg: number }             // int32 0..359_999_999
  | { k: "dialRelease" };

export type CmdResult =
  | { ok: true }
  | { ok: false; why: "hole_occupied" | "unknown_hole" | "unknown_terminal"
                    | "unknown_cord"  | "cord_exists"  | "bad_cord_id" | "bad_target" };

export interface Machine {
  apply(c: Command): CmdResult;   // queued; takes effect at the next tick boundary
  advance(ticks: number): void;   // int32 >= 0
  snapshot(): State;              // allocates; call once per frame
  observables(): Int32Array;      // the 33 classified observables (§9.2); no allocation
  motionMask(): number;           // 18-bit relay/button/switch moving mask; no allocation
  drainEvents(): Event[];         // ordered by tick, then by the frozen emission order (§9.2)
}
```

Ten command kinds. Every numeric field is int32 with the range written beside it, and a
command carrying an out-of-range value is rejected with `bad_target` (or `bad_cord_id`) rather than
silently clamped. What is frozen: the kinds, the field names, the units, the `CordEnd`
discriminators. What is free: everything about how a UI decides to emit them.

Four choices worth defending:

- **`target`, not `down`/`press`/`release`/`hold`.** One command form covers a press, a UI drag, and
  BK1 p.9's printed "find the position where both lights are OFF" — one of only two explicitly
  stated break-before-make facts in the corpus, with a demonstrated rest position
  (`components.md` §9.2). A boolean cannot park an arm mid-stroke, and three designs claimed that
  experiment was reproducible while shipping a schema that could not express it. The cost is that
  "release" is not a distinguishable step kind, which is why the collapse test tags its steps
  (§9.1) rather than trying to recognise them.
- **`touch` and `free` are both first-class.** Book VI prints the mechanism verbatim: "(The wire
  need not be plugged into the terminal; touching the terminal will make the contact.)" It is
  electrically identical to plugging — and it **does not occupy a hole**, which is exactly why it
  cannot be collapsed into `hole`: `VI-TICTACTOE`, `V-EXP12` and `V-MAZESOLVER` all touch into a
  densely wired matrix whose terminals may have both holes full. `free` is the same wire *between*
  touches, which is its resting state; without it the play wire has to be disconnected and
  reconnected to be put down. W7's inspector leaves one cord end free so the member is exercised
  before it is frozen.
- **`r_uohm` on the cord** is Book VII's spliced resistor — `Ω_22`, `Ω_B1..Ω_B6`, and the 33 Ω STOP
  shunt that `rotary.md` §3.2 shows is **not** optional. One optional field replaces an entire Ω
  pseudo-terminal apparatus and also carries ordinary wire resistance if it is ever wanted. Without
  it, BK7 p.8's bias procedure — the sole primary source for the hysteresis this design models —
  cannot be built, and Book VII's decimal-to-binary converter cannot be wired.
  Its electrical meaning is exact: absent or zero is an ideal cord union; positive is one resistor
  element and no union. W2 preserves `Ω` syntax as the symbolic splice token of §2.4. W3 resolves
  an `Ω_<n>` literal to `n * 1_000_000` uΩ with exact checked integer arithmetic and rejects zero,
  overflow or a non-int32 result. `Ω_B<n>` and bare `Ω` have no source value: W3 requires an
  explicit positive `r_uohm` from the fixture/caller and rejects the splice if it is absent. No
  Ω form silently becomes an ideal zero-ohm cord.
- **There is no `tick`, `advance`, `reset`, `profile` or `expect` command.** Time is a method, not a
  message. The profile is constructor configuration. SDC's published global reset is a power cycle,
  so `power off` → `power on` is it; modelling a reset the machine does not have would be inventing
  hardware. Conformance verbs do not belong in the machine's public surface.

**Controlling Contract 1.1 relay-hand amendment — 2026-09-02.** Book I Experiment 6 is an authority
fixture whose only state-changing action is “Gently push the relay crossbar to the left.” Book I
later distinguishes releasing a relay from manually operating it, so a lone relay target cannot
represent both hand force and return to electrical control. `relayGrab` / `relayRelease` are the
smallest honest pair, parallel to dial hand control. The additive command kinds and
`State.relays[].held` require Contract 1.1 under §8's own version rule; no 1.0 fixture or golden had
landed, so `minivac.fixture/1` moves wholly to `contract:"1.1.0"` rather than carrying an unused
dual-version branch. Trace format 1, the Event union, the 33 observables and the 18-bit motion mask
are unchanged. §13.4.3–§13.4.4 freeze the mechanics and Event boundary.

**Cut from revision 1, both to a later additive bump:** `moveEnd` (it is `disconnect` then `connect`
with the id preserved, and Phase 1's inspector is click-to-connect, not drag) and `session()` (no
Phase 1 caller — fixtures carry their own script, the runner drives `apply`/`advance` directly, and
a command log is ten lines in an adapter when something needs one). Freezing an interaction nobody
has built yet is the one direction the additive rule cannot rescue.

---

## 8. State schema — frozen

All arrays are **0-indexed, index `i` = section `i+1`**.

```ts
export interface State {
  contract: string;            // "1.1.0"
  netlistHash: string;         // "fnv1a64:0123456789abcdef" — 16 lowercase hex digits
  profileId: string;           // "MV601-REF-A"
  profileHash: string;
  tick: number;                // ticks since power-on

  power: boolean;
  breakerTripped: boolean;
  railMv: number;              // PLUS − MINUS; 0 when tripped
  supplyUa: number;

  relays: {                    // 6
    travel: number;            // 0..1000
    coilMv: number;
    coilUa: number;            // the decision variable
    pullInUa: number;          // THIS instance's thresholds, spread applied
    dropOutUa: number;
    band: "below" | "hold" | "above";
    coilShorted: boolean;
    set1: { nc: boolean; no: boolean };
    set2: { nc: boolean; no: boolean };
    indicatorUa: number;       // the series lamp's current; 0 when bypassed
    held: boolean;             // hand owns mechanics until relayRelease
  }[];

  outLamps:   { ua: number; milli: number; cls: "off" | "dim" | "on" }[];   // 6, nA–nB
  indLamps:   { ua: number; milli: number; cls: "off" | "dim" | "on" }[];   // 6, nC–nE
  buttons:    { travel: number; nc: boolean; no: boolean }[];               // 6
  switches:   { travel: number; set1: [boolean, boolean]; set2: [boolean, boolean] }[]; // 6
  dial:       { udeg: number; contact: number | null; mrpm: number; held: boolean };

  cords:      { id: CordId; a: CordEnd; b: CordEnd; r_uohm: number }[];
  terminalMv: (number | null)[];   // 186, indexed by frozen terminal index; null = floating
  notes:      Note[];              // steady-state only; see below
  flags:      { chattering: ChatterDev[]; overCurrent: boolean; nonPortable: boolean };
}

export type Note =
  | { k: "coil-starved";      relay: Sect; coilUa: number; needsUa: number;
      drops: { el: string; mv: number }[] }      // ranked by dissipation along the coil's own path
  | { k: "lamp-in-coil-path"; relay: Sect; lampMv: number };

export type Event =
  | { t: number; k: "power.on" | "power.off" | "breaker.trip" | "breaker.reset" }
  | { t: number; k: "relay.pullIn" | "relay.dropOut"; n: Sect; coilUa: number; marginUa: number }
  | { t: number; k: "contact.make" | "contact.break"; arm: TerminalId; to: TerminalId }
  | { t: number; k: "lamp.on" | "lamp.off"; kind: "out" | "ind"; n: Sect }
  | { t: number; k: "dial.make" | "dial.break"; pos: number }
  | { t: number; k: "chatter"; dev: string; transitions: number };
```

Every field is an integer, a boolean, a frozen string, or null. Nothing here can differ between
runtimes for any reason other than a genuine behavioural difference.

`terminalMv` is an **array**, not a `Record`. A map's serialization order differs across runtimes
the moment anyone hashes or diffs a snapshot, and the frozen terminal index is already the netlist's
ordering.

**`notes` is two kinds, and both are steady-state.** Revision 1 shipped nine. Two problems,
both caught by review 2. Six of them (`coil-in-band`, `coil-shorted`, `dial-in-gap`, `floating`,
`chatter`, and the unimplemented timing-estimate note) either restated a `State` field or asserted
an explanation W1 did not reproduce. The state-derived cases are one line of adapter code each and
addable later under the additive-only rule. And `notes` is recomputed per tick while `snapshot()` is
taken once per frame, so any *transient* note is discarded with probability ~166/167 at steady
state; a help layer built on that would be silently broken in the browser and fine in the headless
harness, which is exactly the gap W7 exists to close. Transient conditions are **Events**, which are
drained, not sampled. The two that remain do derived work no adapter can do:

- `coil-starved.drops` — after the solve, walk the elements carrying that coil's current and rank
  them by dissipated power. About thirty lines, entirely derived. It yields, without a word of
  authored prose in the core: *"Relay 3 needs 6.6 V and is getting 6.2 V. The biggest loss is its
  own indicator lamp, dropping 4.1 V — the lamp is wired in series with the coil, so lighting it
  starves the relay."*
- `lamp-in-coil-path` — C-fed versus E-fed is a **topology** fact, not a power ranking
  (`components.md` §1.4), and it is the fact that explains why the errata's counter adds a wire.

`marginUa` on a pull-in event is the same quantity `bless` gates on (§9.3) — one number, two
consumers, and it is a current in both places.

`flags.chattering` carries **device name strings** from §9.2's table, the same identifier space the
`chatter` event and the golden's `!` line use. Revision 1 had it as `number[]` indexing nothing
stated. `flags.nonPortable` is set by the quantizer (§3.5) on NaN, ±Infinity or a saturating clamp.
It should never be true; if it is, the trace is void rather than silently wrong.

**Cut from revision 1:** `energised` (defined only in a trailing comment as `travel === 1000`, which
contradicts §4.3's `noClosed = travel > 550` — a relay held at 700 has its NO contacts closed and
would have read `false`; the UI derives what it needs from `travel`, and `set1`/`set2` already carry
contact truth), and `caps[]` (no capacitor element exists at 1.0 or 1.1, §2.1).

**Frozen:** field names, units, the `Note` and `Event` kind strings, `terminalMv`'s ordering, the
33-entry observable vector of §9.2.
**Additive-only on a minor bump:** new fields, new note kinds, new command kinds, and new
observables **appended to the end** of the §9.2 list so 1.0 goldens do not re-order. A port that
ignores a field added at 1.1 still passes every 1.0 trace. Contract 1.1 uses that rule for relay hand
control without appending an observable or changing trace format 1.
**Free:** everything the UI derives. Sound and animation come from diffing consecutive snapshots or
from the event stream; the core emits no callbacks and knows nothing about audio.

---

## 9. Conformance

Two kinds of proof, and conflating them is the classic mistake.

- **Authority fixtures** carry `expect` clauses transcribed from SDC's printed results with verbatim
  citations. They prove a simulator **right**. Both TS and C# must pass them.
- **Golden traces** are the full change-only event stream. They prove the C# port **identical to the
  TS reference**, including in the many behaviours no manual states.

When primary artifacts contradict, a fixture cannot make both true or choose the prose merely
because it is prose. Preserve the image-verified wiring and globally verified component convention;
assert only their common printed invariant as authority; record the conflict; and tag any required
absolute phase derived from topology with a named fallback. `V-EXP1` is the controlling case: its
wire list and diagram implement XNOR, its worked sentence prints the inverse, and ER-28 proves only
that either switch toggles. Its four absolute outcomes therefore use
`FALLBACK-V-EXP1-TOPOLOGY`; no target or wire is inverted to satisfy the bad paragraph.

### 9.1 Fixture format — `minivac.fixture/1`, normative

Shipped as the Draft 2020-12 JSON Schema in `test/conformance/fixture.schema.json` so both runners
**validate** rather than interpret. Every script step carries the `k` discriminator; a step with two
verbs is a schema error, not a precedence question. §13.5 freezes the complete member set,
conditionals and validator boundary.

```jsonc
// test/conformance/fixtures/A/MM-RLY-CHECK.fixture.json
{ "schema": "minivac.fixture/1", "id": "MM-RLY-CHECK",
  "source": "MAINT printed p.7 = maintenance-manual.pdf PDF p.9",
  "tier": "A", "confidence": "verified",
  "profile": "MV601-REF-A", "contract": "1.1.0",
  "as_printed": ["+/H","+/L","+/Y","X/E","F/-","J/1A","1B/1-","G/2A","2B/2-",
                 "N/3A","3B/3-","K/4A","4B/4-"],
  "errata_applied": [],
  "note": "C and Z are deliberately unconnected. Section prefixes implied 1 on the page.",
  "wires": ["1+/1H","1+/1L","1+/1Y","1X/1E","1F/1-","1J/1A","1B/1-","1G/2A","2B/2-",
            "1N/3A","3B/3-","1K/4A","4B/4-"],
  "script": [
    { "k": "do", "cmd": { "k": "power", "on": true } },
    { "k": "settle", "maxMs": 200 },
    { "k": "expect",
      "obs": [ {"dev":"outLamp1","v":"on"},  {"dev":"outLamp2","v":"off"},
               {"dev":"outLamp3","v":"on"},  {"dev":"outLamp4","v":"off"},
               {"dev":"indLamp1","v":"off"}, {"dev":"relay1","v":"nc"} ],
      "cite": "MAINT printed p.7 = maintenance-manual.pdf PDF p.9",
      "quote": "Turn power on. Lights 1 and 3 should come on." },
    { "k": "do", "cmd": { "k": "button", "n": 1, "target": 1000 } },
    { "k": "settle", "maxMs": 200 },
    { "k": "expect",
      "obs": [ {"dev":"outLamp1","v":"off"}, {"dev":"outLamp2","v":"on"},
               {"dev":"outLamp3","v":"off"}, {"dev":"outLamp4","v":"on"},
               {"dev":"indLamp1","v":"off"}, {"dev":"relay1","v":"no"} ],
      "cite": "MAINT printed p.7 = maintenance-manual.pdf PDF p.9",
      "quote": "Push the pushbutton. Lights 1 and 3 should go off and lights 2 and 4 should come on." } ] }
```

**Step kinds.** `do` (one `Command`), `advance` (`{"k":"advance","ms":n}` — a fixed,
data-independent advance), `settle` (`{"k":"settle","maxMs":n}` — the quiescence detector of §9.2,
`maxMs` is its cap and its only parameter), `expect` (an `obs` array plus required `cite` and
`quote`). `do` and `expect` consume no boundary; `advance` and `settle` do. A `>` and `?` may share
a numeric tick, and file order is authoritative (§13.4.7).

**`advance` is why it is here.** Revision 1 had only `do`, `settle_ms` and `expect`, and review 1
was right that a data-dependent settle cannot express a *hold duration* — which makes ERRATA Book IV
p.72's "hold the pushbutton down long enough for any carry to propagate", p.69's "push pushbutton 6
slowly", and ordering constraints R2, R3 and R4 unscriptable. Every timing-dependent behaviour in
the corpus, including the headline marginal demo, needs a fixed advance. A golden's tick numbers
depend on the `ms` value, which is exactly the point.

**`obs` is an array, not an object.** Review 2's catch: a JSON object keyed `{"3":"on","1":"off"}`
iterates in ascending numeric order in ECMAScript and in insertion order in
`System.Text.Json` — a byte difference in a `diff`-compared artifact, produced by nothing but the
transcriber's typing order. The array is authored in any order and **rendered in observable-vector
order** (§9.2); every entry in `obs` appears on the `?` line and nothing else does.

Rules that make it a contract:

- `wires` are fully qualified physical terminal pairs; hole allocation is §2.4's rule.
  `as_printed` preserves the page. Contract 1.1 fixtures do not admit Book VII Ω designators.
- **Errata are asserted positively.** Each entry is `{"id":"ER-12","from":"3H/4A","to":"3L/4A"}`;
  the test asserts every canonical unordered `from` is **absent** from `wires` and every canonical
  unordered `to` occurs exactly once. Rail aliases normalize before endpoints sort, so reversal
  cannot evade the check. Revision
  1's negative test (`wires !== as_printed` whenever errata is non-empty) is vacuous, because §2.4
  makes the two arrays differ in nearly every element for reasons unrelated to errata — it would
  pass on a fixture where the transcriber expanded prefixes and forgot the correction, which is the
  exact failure it existed to catch across 46 errata.
- `expect` is a **projection**: only the observables the page names, and no others
  (`programs.md` §2). Every `expect` requires a source-location `cite` and a separately rendered
  verbatim `quote`. A fallback-derived expectation carries its own `tag:"unverified"` and named
  `source`; fixture-level confidence does not hide mixed provenance.
- Tier B fixtures put press and release in **separate** script steps with a settle between, and the
  release step is tagged `"collapse": true`. The collapse test (§9.5) deletes every tagged step and
  asserts the fixture then fails. Tagging is necessary because `target` deliberately makes release
  indistinguishable from BK1 p.9's mid-travel park (§7) — a runner cannot recognise a release, and
  guessing would silently delete the wrong step.
- Tier D — the games — are **smoke tests, not fixtures** and are excluded from the fixture schema:
  the wire list must load, must not short PLUS to MINUS through no load, and the printed invariant
  must hold. No fabricated traces, ever.
- The comparator normalises `n+` → PLUS and `n-` → MINUS, then sorts each pair's endpoints,
  before comparing wire lists. Rail aliases and endpoint direction cannot manufacture a difference.

**Observable key table** — the legal `dev` values and the `State` field each maps to. This is the
whole vocabulary; a `dev` outside it fails schema validation.

| `dev` | Legal `v` | `State` source |
|---|---|---|
| `power` | `off` `on` | `power` |
| `breaker` | `ok` `tripped` | `breakerTripped` |
| `relay1`..`relay6` | `nc` `mid` `no` | `relays[i].travel` against `break_milli`/`make_milli` |
| `pb1`..`pb6` | `nc` `mid` `no` | `buttons[i].travel` |
| `sw1`..`sw6` | `nc` `mid` `no` | `switches[i].travel` (`nc` = LEFT) |
| `dial` | `c0`..`c15` `gap` | `dial.contact` |
| `outLamp1`..`outLamp6` | `off` `dim` `on` | `outLamps[i].cls` |
| `indLamp1`..`indLamp6` | `off` `dim` `on` | `indLamps[i].cls` |

### 9.2 Golden trace format

> **2026-09-03:** the example header's hashes are stale; the shipped values are in §13.6.8.

Line-oriented text. Change-only. Integers only. `diff` is the comparison.

```
#!mv601-trace 1
# id=MM-RLY-CHECK contract=1.1.0 netlist=fnv1a64:8c3f0a1120de44b7 profile=MV601-REF-A/fnv1a64:11ab93c4770e2f05 wires=13
# rules settleTicks=200 chatterN=8 relayWinTicks=800 relayQuietTicks=2400 buttonWinTicks=2000 buttonQuietTicks=6000 switchWinTicks=4800 switchQuietTicks=14400 dialWinTicks=3332 dialQuietTicks=9996
# margins minDecisionUa=5317 minTickGap=11 marginal=false
     0.0 > power on
     6.5 * outLamp1 off->dim  outLamp3 off->dim
    36.6 * outLamp1 dim->on   outLamp3 dim->on
    56.6 ? outLamp1=on outLamp2=off outLamp3=on outLamp4=off indLamp1=off relay1=nc  "Turn power on. Lights 1 and 3 should come on."
    56.7 > button1 target=1000
    68.0 * pb1 nc->mid
    70.4 * pb1 mid->no
    81.4 * relay1 nc->mid
    82.6 * relay1 mid->no
    …
```

**This example is illustrative and is regenerated from a real run at W4a.** Revision 1 shipped a
hand-written example inside a byte-diff-frozen spec whose timestamps contradicted its own `settle`
rule by an order of magnitude; all three reviews caught it. The *shape* is normative; the numbers
are not, and the numbers in the file will be a machine's.

Grammar: `<ms> <kind> <payload>`. Four kinds — `>` command applied, `*` observable transition,
`?` assertion checkpoint, `!` anomaly.

**The 33 classified observables, in frozen order.** This list — not TypeScript declaration order —
is the emission order, the `?` line's field order, the `*` line's diff source and `settle`'s watch
set. `src/core/trace.ts` exposes it as an `Int32Array` from `Machine.observables()`, so the runner
never calls `snapshot()` per tick (an allocation of 186 entries plus ~40 objects per 100 µs), and
`test/observable-order.spec.ts` asserts this table against the code so the two cannot drift.

| Index | Device | Values |
|---|---|---|
| 0 | `power` | off, on |
| 1 | `breaker` | ok, tripped |
| 2–7 | `relay1`..`relay6` | nc, mid, no |
| 8–13 | `pb1`..`pb6` | nc, mid, no |
| 14–19 | `sw1`..`sw6` | nc, mid, no |
| 20 | `dial` | c0..c15, gap |
| 21–26 | `outLamp1`..`outLamp6` | off, dim, on |
| 27–32 | `indLamp1`..`indLamp6` | off, dim, on |

New observables at a minor version are **appended at index 33 and beyond**, so a 1.0 golden's line
order is unchanged by a 1.1 addition — which is what makes §8's additive-only promise and this
frozen order compatible. Revision 1 pinned the order to "the order declared in `contract.ts`", which
is untranslatable to C# (no meaningful member order) and self-contradictory with additive-only:
adding a field would have re-ordered every golden.

Pinned, because in a byte-diff contract anything unpinned is a guess and a guess is total failure:

| Item | Rule |
|---|---|
| Encoding | **UTF-8, no BOM, LF.** All of `data/**` and `test/conformance/**`. `.gitattributes` ships `* -text` so git never rewrites line endings on a Windows checkout; `netlist-shape.spec.ts` fails if any tracked data or golden file contains `\r` or a BOM. C#: `new UTF8Encoding(false)` and `"\n"` as `NewLine`, always |
| The `ms` column | formatted from the integer tick by integer arithmetic (`tick/10`, `tick%10`), right-aligned in 8 columns. Never `toString` on a double. `CultureInfo.InvariantCulture` on every C# format call |
| Payload values | discrete only, from the table above. **No voltages in a golden** |
| Emission order within a tick | Runner action order controls accepted `>` and `?` lines. For one simulated boundary, `*` transitions are in observable-vector index order on one line and precede drained chatter `!`; a cap `no-settle` follows the final boundary's output. Equal numeric timestamps do not reorder lines (§13.4.7, §13.5) |
| Change detection | against the previous tick's observable vector, never against a float |
| Lamp classification | pure three-band function of `milli`: `on` at ≥ 600, `dim` at ≥ 150, else `off`. No hysteresis, no deadband, and **`dim` lines do appear** while a filament warms or cools — that is the thermal model of §3.4 being visible, not a defect. Revision 1's "full-band move required to change class" is deleted: it was six undefined words, and a lamp parked exactly on a threshold is handled by the chatter rule, not by inventing two more constants |
| Lamp brightness | `milli = clamp(roundAway((1000 * (R_lamp − R_cold)) / (R_hot − R_cold)), 0, 1000)` — each displayed operation is binary64 in written order, then the binary64 quotient rounds nearest with ties away from zero and normalizes negative zero. There is no intermediate resistance quantization and this is not §4.4's integer-domain `idivRound`. Brightness inherits the carried filament's thermal lag, so `visual_decay_us` is not needed (it stays in the profile marked unused) |
| Chatter | derived per device at profile load, not a magic 8-in-100-ticks: `cycleTicks = operateStrokeTicks + releaseStrokeTicks` (200 for a relay, 500 for a button, 833 for the dial at `run_mrpm`); more than `chatter_n` (8) transitions within `chatter_cycles` (4) × `cycleTicks` emits `! <dev> chatter <n> transitions in <ms>ms — suppressed <ms>ms` and resumes after `chatter_quiet_cycles` (12) × `cycleTicks` of quiet. The derived integers are printed in the `# rules` header line so the rule stays a byte-exact contract. Sanity-checked against the fastest legitimate device: the dial at 45 rpm makes exactly 8 transitions in 4 pad periods and therefore never trips it. When motor drive becomes zero, §5's configured coast is an intentional one-tick displacement standing in for continuous physical motion; after retaining every resulting dial event and the final observable transition, the machine clears and reseeds only the dial's chatter history before sampling that post-coast value. Relay, pushbutton and slide-switch histories are unchanged. This prevents the modeled time compression from manufacturing a ninth transition while preserving the window and threshold for every continuous-motion epoch. **Reversal reseed (2026-10-14; `[unverified]`, rides on O-R5 and O-R12):** a non-zero drive that changes sign is §13.4.5's instantaneous reversal, the same kind of modelled discontinuity, so the same dial-only reseed runs on that tick, whether the reversal is immediate or resumes after a `TRANSFER-COAST-DEFER` hold. Why: Book I printed p.24 (PDF p.26) Exp 14 step 5 reverses the motor with slide switch 6; thrown on a pad, the wiper re-crosses the pad it is on, the trimmed dwell put a ninth transition in the 3332-tick window, and C2 `I-EXP14` printed a false `! dial chatter`. A real armature slows through zero, which lengthens that dwell. **Limit:** a reversal reseeds only when no dial reseed (coast or reversal) has run in the last dial `windowTicks` (3332) and the dial is not suppressed; every dial reseed records its tick, cleared with `tick` at each power epoch. Why: reversals are what a hunting oscillation is made of, so a reseed on every one would let a circuit that reverses at least once per 8 dial transitions never trip, and would cut an active suppression short of its `chatter_quiet_cycles` quiet. One reversal per window is forgiven; a hunt still trips (`test/motor.spec.ts` two-relay hunt on pad 8: dial at about 971 ms, against about 683 ms with no reversal reseed). No constant changes |
| `settle` | after every tick, increment quiet exactly when no entry of the 33-vector changed and `motionMask()===0`; otherwise reset it. Stop after `settle_quiet_ticks` consecutive increments, capped at `maxMs`. Only `dial.contact`, index 20, watches the dial. Hitting the cap emits `! no settle in <ms>ms` and continues (§13.5) |
| Netlist hash | FNV-1a 64 (offset `0xcbf29ce484222325`, prime `0x100000001b3`) over the **raw bytes of `data/netlist.json`**, rendered as exactly **16 lowercase hex digits, zero-padded**. TS computes it in `BigInt` with an explicit `& 0xFFFFFFFFFFFFFFFFn`; C# in `ulong` |
| Profile hash | The same FNV-1a 64 over the UTF-8 semantic payload defined below: every loaded scalar integer in §10.1 key order, then `dV_relay_mv`, then every `lamp_pwl_uohm` pair. `tag`, `src`, `provenance`, JSON whitespace and object-member order are excluded |
| Line endings | `\n`, no trailing whitespace, file ends with exactly one `\n` |

Revision 1's chatter window (8 transitions in 100 ticks = 10 ms) was unreachable: a relay's fastest
full cycle is 20 ms and yields four band transitions, so the maximum achievable count in any 100-tick
window was about two. The flag, the event and the note were all dead code, and a real user-built
oscillator ran until `settle` hit its cap.

The profile-hash payload is line-oriented ASCII terminated by one LF: first
`minivac.profile-hash/1`, then one `<key>=<integer>` line for every scalar key in §10.1 order, then
`dV_relay_mv=<six comma-separated integers>`, then one
`lamp_pwl_uohm=<ua>:<uohm>` line per PWL point in array order. No spaces, CRs, BOM or final data
outside that terminating LF. This is the normative cross-language serialization.

The literal `Derived` object is not sufficient hash input: behavioral scalar inputs such as
`V_oc_mv` and `R_src_uohm` are not all represented there. The payload therefore includes every
loaded scalar numeric input, plus `dV_relay_mv` and the PWL table; all derived values remain
deterministic functions of that payload.

The profile hash on line 2 means a behavioral number cannot be edited quietly: changing the loaded
integer set, the six offsets or the PWL re-diffs every golden. An honesty edit to provenance does
not. This keeps the hash tied to simulator behavior rather than penalizing documentation repairs.

### 9.3 Blessing, and the knife-edge gate

> **2026-09-03:** `bless` has four refusal gates, not three — §13.6.8. Since 2026-10-13 the two
> numeric ones are triggers for BLESS-ROBUSTNESS, not refusals — §13.6.8 and below.
>
> **2026-10-13:** rule 2's two numeric gates are now triggers, not refusals — a tripped fixture is
> refused only if it fails the BLESS-ROBUSTNESS check below (Tom's ruling, `docs/DECISIONS.md`
> 2026-10-13, "Knife-edge gate: keep the 14 µA trigger, add a robustness check").

`npm run bless -- <id>` regenerates a golden. It **refuses before opening the golden for write** if:

1. any `?` assertion line in it failed — so the manuals' own sentences, quoted inside the golden,
   gate its regeneration and goldens cannot drift away from what SDC printed; or
2. a numeric `minDecisionUa < min_decision_ua` or `minTickGap < min_tick_gap` and (since
   2026-10-13) an assert that then fails under one of the BLESS-ROBUSTNESS perturbations below,
   **unless** the fixture declares `"marginal":true` with the exact §13.5 `mechanism` object; or
3. the fixture is tier C2 and its **digest** changed — see below.

**BLESS-ROBUSTNESS, defined (2026-10-13).** A tripped fixture with no `expect` or `until` step is
refused outright: every perturbation would hold vacuously (Tom, 2026-10-14). When a non-marginal fixture trips either numeric gate,
`bless` re-runs it six times, each on a perturbed copy of its own profile: relay thresholds ±150 mV
(`V_pullin_mv` and `V_dropout_mv` shifted together, both signs), coil resistance ±10%
(`R_coil_uohm`), and lamp thermal τ ×0.5 and ×2 (`lamp_thermal_tau_us`). Each copy is the raw
profile JSON with one perturbation applied (two values for the threshold shift), re-validated by
`loadProfile`; a copy it rejects fails the check with its reason, and so does a perturbed run that
throws. The fixture is blessed if every `expect` and `until` assert, tagged or not, holds in
all six runs; the perturbed traces, metrics and C2 digests are ignored. A refusal names the
perturbation and its first failing assert; a pass logs one line naming the trip. The magnitudes are
invented harness parameters, `[unverified]`, not model physics (open-questions O-C11): they are named
constants in `test/conformance/robust.ts`, not profile keys, so no profile hash and no golden moves.
The check is TS-only; the C# port has no `bless`. An untripped or `marginal:true` fixture runs no
perturbation.

**`minDecisionUa`, defined.** The minimum non-negative `marginUa` among drained `relay.pullIn` and
`relay.dropOut` Events over the complete run. Those are the only public outcome-changing decisions
whose compared quantity and margin are both exact current-domain values in contract 1.1. Lamp
brightness is milli, the breaker Event does not carry its triggering sample, and rotary geometry is
microdegrees; none is relabelled µA.

**`minTickGap`, defined.** For each observable index independently, remember its preceding change
tick and minimize the positive difference when that same index next changes. Accepted inputs,
assertions, anomalies, simultaneous changes of different observables and epoch timestamp decreases
do not enter; the per-index table clears at an epoch restart. An empty population for either metric
renders `na` and does not fail that gate. This same-observable population catches an unstable
classification without making legal same-tick lines fail the shipped positive threshold.

Revision 1 shipped `minDecisionUv` — microvolts — while §4.1, §8 and the pull-in event all decide on
current. Two reviews caught it independently, and the deeper problem is that a **shorted-coil
release, the mechanism every flip-flop in the corpus uses, happens at exactly 0 V**: a microvolt
margin is meaningless precisely where the suite most needs a knife-edge check.

The gate values live in the profile (`min_decision_ua`, `min_tick_gap`), and the shipped numbers are
**provisional**. After the W4a runner-code commit and before its Maintenance-data commit, one
preregistered pass runs the exact three Maintenance plus complete Tier-A inputs in an isolated
worktree (`DECISIONS.md`, *2026-09-02 — W4 measured bless gates*, records both metric
distributions). For each metric independently, discard `na` and every declared marginal
fixture, then set its gate to the minimum remaining value; the refusal comparison is strict `<`, so
equality passes. Copy the resulting two corpus gates to both profiles. If a metric has no populated
non-marginal value, retain its provisional gate and record the empty population. W4b must later land
the byte-identical measured Tier-A files and reproduce both distributions; any fixture-hash or
distribution drift stops and reopens the gate. This sequencing is what lets the three Maintenance
goldens be the first landed fixtures without choosing a gate before the corpus that defines it
exists. Revision 1's 2000 µV / 2 ticks were never checked against anything.

**The `mechanism` object is maintainer-facing attribution, not public copy.** A `marginal:true`
fixture names one exact normative profile key in `profileKey` and the canonical 2026-09-01
`DECISIONS.md` ruling in `decision`. It must not name a physical cause the shipped model does not
produce. If no profile key accounts for the margin, the fixture cannot use the carve-out.

**Tier C2's gate.** C2 fixtures shipped digest-only; since D1 (§13.5.1) they may also carry
`expect` and `until` steps, but those assert only printed answers, so refusal rule 1 cannot see the
dial sweep or the contact arc, and rule 2 is unrelated to correctness — any regression in the dial sweep or
the contact arc would silently re-bless. So each C2 fixture carries the exact reviewed §13.5
`digest` object: total drained Event count plus 19 mover-observable transition counts in frozen
`CHATTER_DEVICES` order. `bless` refuses when the computed object differs. Changing a C2 golden
therefore requires a human to edit a number and say why in the commit.

The `marginal` carve-out exists for explicitly reviewed knife-edge fixtures. The Book IV counter's
use of it is governed by the canonical `DECISIONS.md` ruling; the flag records the profile-dependent
margin and does not assert the documented hardware's cause.

### 9.4 The analog channel

> **2026-09-03:** checkpoint ordering (strictly increasing) and the `diagnostic` flag (echoed, not
> exempting) are corrected by §13.6.8.

`test/conformance/probes/*.probe.json` carries a second, separately typed protocol. Its envelope is
`minivac.probe/1`; it is not a fixture extension and its result is a structured
`minivac.probe-result/1` object. Probe results are compared by typed exact relations or explicit
integer tolerances. They are **never rendered as traces, blessed, or golden-diffed**.

A document has one exact acceptance id, one source citation, one profile id and one or more named
cases. Only `AT-01`, `AT-04`, `AT-05`, `AT-06`, `AT-07`, `AT-09`, `AT-10` and `AT-11` are legal ids.
CI binds each registered id to the raw document SHA-256, exact source string, complete case/scope and
checkpoint inventory, every ordered check array, and every POWER substitution/load mapping. This
owning integrity gate is separate from the generic loader: temporary schema/runner documents remain
legal, but a passing unrelated document cannot replace a registered probe. Source and substitution
claim/model strings reject decoded C0 controls and unpaired UTF-16 surrogates.
Each case has one of two execution scopes:

- `machine` creates a fresh `Machine`. Its source is either a named conformance fixture or an inline
  scenario with physical wires and probe actions. A fixture checkpoint is addressed by exact
  `{k:"fixtureStep",scriptIndex,stepKind}`; an inline checkpoint by exact
  `{k:"action",actionIndex,actionKind}`. The loader verifies the addressed discriminator, rejects a
  duplicate address and the runner executes only through the last addressed step. Probe actions use
  integer ticks (`advance.ticks`, `settle.maxTicks`), so the one-boundary breaker tests do not acquire
  an invented millisecond rounding rule. Commands are queued through `Machine.apply` and take effect
  at the next simulated boundary, exactly as in the fixture runner.
- `profileLoad` is the one narrow direct-solver scope required by AT-05. It describes only six
  relay-coil branches, their C/E feed, 0..6 output lamps, six indicator lamps and one explicit
  `panelLampModelSubstitute`. It uses the checked-in profile, core solver, quantizer and PWL; it does
  not import `tools/check-profile.ts` and is parity-tested against W1's established integer outputs.
  Its initial contiguous over-threshold count uses the Machine breaker's inclusive
  `abs(supplyUa) >= I_trip_ua` predicate. This is not an arbitrary element-list protocol.

Machine reads are discriminated integer fields (`railMv`, `supplyUa`; relay travel/current/threshold
and indicator current; output/indicator lamp current/brightness), a boolean field
(`breakerTripped` or relay `held`), or an absolute terminal-pair voltage. A terminal-pair read fails
if either terminal is floating. Event checks use an exact event kind and, for relay events, relay
number. Profile-load reads are `settledSupplyUa`, `peakSupplyUa`, `ticksOverTrip`, `tripDelayTicks`,
`ITripUa`, and indexed pull-in/drop-out thresholds. `near` means inclusive
`abs(actual-expected) <= tolerance` in checked signed-64 arithmetic; `compare` is one of
`lt|le|eq|ge|gt` between two typed integer reads or a literal; booleans and event presence are exact.
Every checkpoint fails, rather than returning a result, on settle-cap exhaustion or a sticky
`nonPortable` flag. Every case starts cold and has no state shared with another case.

The eight documents freeze these scopes and checkpoints:

| Probe | Scope and checkpoint | Required comparison |
|---|---|---|
| AT-01 | inline exact I-EXP9 six-wire stamp; after press-settle, release-settle and fixed 2000-tick analog observation | `abs(1E-1F)=6920±100 mV`, relay 1 operated and held above drop-out, pull-in event seen |
| AT-04 | eight fresh inline bare-coil/resistor cases; after settle | 180..470 Ω strictly between nominal drop-out/pull-in; 120 Ω at/above pull-in; 150 Ω within 200 µA of nominal pull-in |
| AT-05 | two fresh `profileLoad` cases | C-fed realistic case `830000±30000 µA` and below trip; E-fed diagnostic `1500000±100000 µA`, with its measured over-trip duration strictly below breaker delay |
| AT-06 | inline dead PLUS/MINUS short; after action 1's one tick and action 2's one next tick | first sample `19402985±100000 µA` with breaker clear; exact next boundary tripped, zero rail, breaker event seen |
| AT-07 | fresh I-EXP7 runs through exact fixture steps 5=`advance` and 16=`advance` | E-fed relay operated with indicator current within 10 µA of zero; C-fed relay operated with indicator current equal to coil current and above drop-out, brightness `749±10` milli and at/above the modeled `dim` threshold 150 |
| AT-09 | inline dead short through trip, then disconnect/reset/settle | tripped+zero-rail, then clear+positive-rail; see POWER substitution below |
| AT-10 | separate STOP-short and dead-short cases | STOP supply `550000±50000 µA`, below trip and clear; dead short trips |
| AT-11 | I-EXP8-STEP5 through exact fixture step 2=`settle` | all six pull-in events seen, all travels 1000, all settled coil currents above indexed drop-out |

AT-05's E-fed case is deliberately a **diagnostic**, not a required trip. W1's checked model settles
at about 1.48 A; its cold inrush exceeds the threshold for fewer ticks than `tripDelayTicks`. The
older prose sentence "does trip" is not used to rewrite breaker delay or lamp physics.

AT-01's 2000 post-settle ticks are an **unverified probe observation convention**, not a printed
settling time: `2000 * tick_us = 200000 µs = 5 * lamp_thermal_tau_us` in the shipped profile. The
ordinary discrete settle excludes continuing analog filament drift, so this fixed five-time-constant
window makes the analog read repeatable without claiming that SDC specified it. CI pins the exact
relationship to both profile values.

The registered `MV601-REF-A` measurements that set those tolerances are integers: AT-01 is
6933 mV after that fixed observation; AT-04's 150 Ω row is 43236 µA against nominal
43333 µA; AT-05 is 818779 µA C-fed and 1476564 µA E-fed, with 1005 over-trip ticks against a
2000-tick delay; AT-06 is 19402985 µA on the first boundary; AT-07's E-fed indicator is 0 µA,
while its C-fed indicator and coil are both 47217 µA and modeled brightness is 749 milli; and
AT-10's STOP short is 573445 µA. Tests pin every registered numeric read and operand separately from the
source-centred expected values and tolerances, so a changed measurement cannot redefine its own
acceptance window.

The fixed machine netlist deliberately omits the unpatchable POWER lamp (§15). Two explicit protocol
mappings preserve the printed claims without pretending source equivalence:

- AT-05 adds one ordinary panel-lamp model to the direct load and marks it
  `panelLampModelSubstitute`, status `unverified`. This is the W1 load convention, not evidence that
  the fixed netlist contains the physical POWER lamp.
- AT-09 maps "POWER lamp extinguished until reset" to `breakerTripped && railMv==0`, then
  `!breakerTripped && railMv>0` after reset. This is a modeled-observable substitution justified by
  the verified downstream topology, not a claim that the breaker flag or rail reading is the lamp.

The acceptance tests that exist are **AT-01, AT-02, AT-04, AT-05, AT-06, AT-07, AT-09, AT-10** in
`components.md` §8.2 and `open-questions.md` (AT-02 is stated there, tagged *currently
unsatisfiable*), plus **AT-11**, new here. There is no AT-03 and no AT-08 outside
`docs/research/raw/`; revision 1 wrote "AT-01…AT-10" three times and sent a porter hunting for two
tests that do not exist.

**AT-11 — Book I Experiment 8 step 5.** All six coils driven through their own indicator lamps
simultaneously, plus the program's output lamps, all six relays pull in, with the per-relay `dV`
spread applied. `[verified]` and printed with no caveat (`components.md` §8.3). W1 found it is the
constraint that pushes hardest against AT-02: the model's peak/hysteresis reading passed, while its
settled-current reading first crossed a relay threshold at two output lamps. Revision 1's acceptance
list did not contain it at all
(AT-05 checks the same six-coil circuit for total *current*, not for pull-in). `check-profile`
reports AT-01, AT-02 and AT-11 **jointly**, because they constrain in opposite directions and their
intersection is the whole question.

Discrete observables are exact-matched in the goldens; analog claims are checked once each, on
purpose, instead of forty times per fixture by accident.

### 9.5 The port proof, and the two meta-tests

> **2026-09-03:** the proof table gains `w3-derived-kat.json` and `w2-at02-static.json`;
> `AT-02.discriminator.spec.ts` does not exist; `solver-kat.json` has 21 cases, not 20 — §13.6.8.

A failure localizes to one of four files, which is what makes a proof a porter can finish.

| Layer | Artifact | What it proves | Comparison |
|---|---|---|---|
| 0 | `data/kat/profile-kat.json` — one profile → its exact derived integer set | The load-time derivations of §4.4 | integer equality |
| 1 | `data/kat/solver-kat.json` — 20 cases as element list + carried state, all doubles **hex-encoded** | Stamping, the LU, the PWL, the arc pass, the lamp filament, carried state | bit-exact |
| 2 | `data/kat/netlist-kat.json` — 40 wire lists → node partitions, floating sets and hole assignments | Union-find, the two busses, the datum, the prune, the contact tables, §2.4's allocation rule | string/integer equality |
| 3a | Fixture `expect` clauses | The port is *a* Minivac | projection equality |
| 3b | Golden traces | The port is *this* Minivac | `diff`, zero tolerance |
| 3c | Probes | Analog fidelity | stated tolerance |

**Meta-test 1 — the collapse test.** Every tier-B fixture is re-run with its `"collapse": true`
steps deleted and must then **fail**. A tier-B fixture that still passes when press and release are
collapsed is testing nothing (`programs.md` §2.1).

**Meta-test 2 — `AT-02.discriminator.spec.ts`.** Revision 1 asserted that `IV-EXP1` and
`ER-ALTCOUNTER` "produce different traces" and that "a boolean connectivity walk over the same two
wire lists produces identical results". Review 3 showed both halves are unsound. Different traces is
satisfied by many irrelevant differences, so the test passes without either counter ever
mis-counting. And the boolean walk is not expected to agree
across the two lists at all, because they tap lamps 4, 5 and 6 differently and the alternate chains
cathodes instead of running six `nB/n-` wires. The assertion is therefore scoped to a **named
observable at a named step**:

> At the count-4 step, record the classification of `outLamp4`, `outLamp5` and `outLamp6` under a
> boolean connectivity walk over both wire lists. In W6, separately measure the actual tap traces;
> only if that trace establishes it may the test assert `IV-EXP1` wrong / `ER-ALTCOUNTER` right.

The W2 classifier is exact and deliberately smaller than a lamp model. For both registered wire
lists it uses the count-4 UP state already frozen by Wave C: relay6..relay1 mask `000011` (therefore
relay1..relay6 travel `[1000,1000,0,0,0,0]`), all six buttons UP at 0, all six switches LEFT at 0,
and wiper 0. For each target `outLamp4`, `outLamp5`, then `outLamp6`, independently:

1. Build W2's union-find from busses, absent/zero-resistance cords, closed contacts and the wiper.
2. If the target lamp's endpoints are one super-node, classify it `off`.
3. Otherwise remove the target lamp and the PSU source from the edge set. Treat every other finite
   passive two-terminal item — fixed lamp, coil, R1, R2, motor armature, and positive-resistance
   cord — as one undirected boolean edge between its endpoint super-nodes. Values and direction do
   not enter this diagnostic.
4. Classify the target `on` iff one endpoint can reach PLUS and the other MINUS, in either polarity;
   otherwise classify it `off`.

The checker takes those inputs only from checked-in `data/kat/w2-at02-static.json`. Its schema is
`minivac.w2-at02-static/1`; the exact top-level members are `schema`, `state`, `programs`, in that
order. The state has exactly `relays`, `buttons`, `switches`, `wiper`. Programs are exactly
`IV-EXP1`, then `ER-ALTCOUNTER`, with exact members `id`, `source`, `wires`; each wire has exact
members `id`, `a`, `b`, and its `id` is its zero-based position. The complete artifact is:

**W2 closure amendment, 2026-09-02.** The loader enforces an input-only FNV-1a 64 pin before it
classifies either program. Its compact-JSON projection is
`[schema,[relays,buttons,switches,wiper],programs]`, where each program contributes
`[id,source,wires]` and each wire contributes `[id,a,b]`, all in artifact order. FNV-1a 64 over the
UTF-8 projection is exactly `7dfc1d82a9341248`. Expected `111`/`101` remains outside both the
artifact and this projection. A changed endpoint or endpoint reversal now fails even when the
unchanged boolean tuple would still pass.

```json
{
  "schema": "minivac.w2-at02-static/1",
  "state": {
    "relays": [1000, 1000, 0, 0, 0, 0],
    "buttons": [0, 0, 0, 0, 0, 0],
    "switches": [0, 0, 0, 0, 0, 0],
    "wiper": 0
  },
  "programs": [
    {
      "id": "IV-EXP1",
      "source": "docs/research/programs.md#IV-EXP1",
      "wires": [
        { "id": 0, "a": "1A", "b": "2E" },
        { "id": 1, "a": "1B", "b": "1-" },
        { "id": 2, "a": "1C", "b": "2C" },
        { "id": 3, "a": "1E", "b": "2G" },
        { "id": 4, "a": "1F", "b": "2F" },
        { "id": 5, "a": "1F", "b": "1H" },
        { "id": 6, "a": "1G", "b": "1+" },
        { "id": 7, "a": "1J", "b": "2H" },
        { "id": 8, "a": "1J", "b": "4K" },
        { "id": 9, "a": "2A", "b": "4E" },
        { "id": 10, "a": "2B", "b": "2-" },
        { "id": 11, "a": "2C", "b": "3C" },
        { "id": 12, "a": "2E", "b": "2J" },
        { "id": 13, "a": "2F", "b": "4A" },
        { "id": 14, "a": "3A", "b": "6E" },
        { "id": 15, "a": "3B", "b": "3-" },
        { "id": 16, "a": "3C", "b": "4C" },
        { "id": 17, "a": "3E", "b": "4G" },
        { "id": 18, "a": "3F", "b": "3H" },
        { "id": 19, "a": "3F", "b": "4F" },
        { "id": 20, "a": "3G", "b": "3+" },
        { "id": 21, "a": "3J", "b": "4H" },
        { "id": 22, "a": "3J", "b": "6K" },
        { "id": 23, "a": "3L", "b": "4L" },
        { "id": 24, "a": "3N", "b": "4H" },
        { "id": 25, "a": "4B", "b": "4-" },
        { "id": 26, "a": "4C", "b": "5C" },
        { "id": 27, "a": "4E", "b": "4J" },
        { "id": 28, "a": "4F", "b": "5A" },
        { "id": 29, "a": "5B", "b": "5-" },
        { "id": 30, "a": "5C", "b": "6C" },
        { "id": 31, "a": "5E", "b": "6G" },
        { "id": 32, "a": "5F", "b": "6F" },
        { "id": 33, "a": "5F", "b": "5H" },
        { "id": 34, "a": "5G", "b": "5+" },
        { "id": 35, "a": "5J", "b": "6H" },
        { "id": 36, "a": "5J", "b": "6X" },
        { "id": 37, "a": "5L", "b": "6L" },
        { "id": 38, "a": "5N", "b": "6H" },
        { "id": 39, "a": "6A", "b": "6F" },
        { "id": 40, "a": "6B", "b": "6-" },
        { "id": 41, "a": "6C", "b": "6-" },
        { "id": 42, "a": "6E", "b": "6J" },
        { "id": 43, "a": "6Y", "b": "6+" }
      ]
    },
    {
      "id": "ER-ALTCOUNTER",
      "source": "docs/research/programs.md#ER-ALTCOUNTER",
      "wires": [
        { "id": 0, "a": "1A", "b": "2E" },
        { "id": 1, "a": "1B", "b": "1C" },
        { "id": 2, "a": "1B", "b": "2B" },
        { "id": 3, "a": "1C", "b": "2C" },
        { "id": 4, "a": "1E", "b": "2G" },
        { "id": 5, "a": "1F", "b": "2F" },
        { "id": 6, "a": "1F", "b": "1H" },
        { "id": 7, "a": "1G", "b": "1+" },
        { "id": 8, "a": "1H", "b": "4A" },
        { "id": 9, "a": "1J", "b": "2H" },
        { "id": 10, "a": "2A", "b": "4E" },
        { "id": 11, "a": "2B", "b": "3B" },
        { "id": 12, "a": "2C", "b": "2-" },
        { "id": 13, "a": "2E", "b": "2J" },
        { "id": 14, "a": "2G", "b": "2N" },
        { "id": 15, "a": "2H", "b": "3L" },
        { "id": 16, "a": "2L", "b": "2-" },
        { "id": 17, "a": "3A", "b": "6E" },
        { "id": 18, "a": "3B", "b": "4B" },
        { "id": 19, "a": "3C", "b": "4C" },
        { "id": 20, "a": "3E", "b": "4G" },
        { "id": 21, "a": "3F", "b": "3H" },
        { "id": 22, "a": "3F", "b": "4F" },
        { "id": 23, "a": "3G", "b": "3+" },
        { "id": 24, "a": "3H", "b": "5A" },
        { "id": 25, "a": "3J", "b": "4H" },
        { "id": 26, "a": "3N", "b": "4N" },
        { "id": 27, "a": "4B", "b": "5B" },
        { "id": 28, "a": "4C", "b": "4-" },
        { "id": 29, "a": "4E", "b": "4J" },
        { "id": 30, "a": "4G", "b": "4N" },
        { "id": 31, "a": "4H", "b": "5L" },
        { "id": 32, "a": "4L", "b": "4-" },
        { "id": 33, "a": "5B", "b": "6B" },
        { "id": 34, "a": "5C", "b": "6C" },
        { "id": 35, "a": "5E", "b": "6G" },
        { "id": 36, "a": "5F", "b": "6F" },
        { "id": 37, "a": "5F", "b": "5H" },
        { "id": 38, "a": "5G", "b": "5+" },
        { "id": 39, "a": "5H", "b": "6A" },
        { "id": 40, "a": "5J", "b": "6H" },
        { "id": 41, "a": "5N", "b": "6N" },
        { "id": 42, "a": "6C", "b": "6-" },
        { "id": 43, "a": "6E", "b": "6J" },
        { "id": 44, "a": "6G", "b": "6N" },
        { "id": 45, "a": "6H", "b": "6X" },
        { "id": 46, "a": "6L", "b": "6-" },
        { "id": 47, "a": "6Y", "b": "6+" }
      ]
    }
  ]
}
```

The W2 checker loads this artifact directly through the shipped designator/netlist/graph path. It
must not call or import Wave C's `tools/stamp-counter.ts`, parse Markdown, or keep another counter
wire literal. The artifact is inputs only: it has no expected-result field. The `111` and `101`
tuples remain preregistered here and in the W2 test, outside the input under test.

The recorded result is the ordered three-value tuple for each program. There is no `dim`, threshold,
profile or carried state in this W2 diagnostic. Two independent preflight derivations give
`IV-EXP1 = [on,on,on]` (`111`) and `ER-ALTCOUNTER = [on,off,on]` (`101`). The real W2 graph must
reproduce those tuples; mismatch stops for transcription/graph review rather than changing the
classifier or being described as an analog result. Unit tests include powered-path `on`,
broken-path `off`, target-shorted `off`, and endpoint-polarity symmetry so an implementation cannot
satisfy the counter rows with a constant classifier.

**That wrong/right clause is a planned W6 measure-only trace, not an established result.** Wave D
measured threshold identities, reachability endpoints and §4.3 travel, not the count-4 output
sequence; it found no relay-decision or travel/contact divergence attributable to O-E11. W2 records
only the static boolean/topology classification. W6 begins by measuring the actual tap traces; if
they do not differ as assumed, stop and amend the fixture branch under the canonical both-demos,
unresolved-mechanism ruling. D is not adjusted to manufacture the premise.

The boolean walk is ~15 lines over the union-find `graph.ts` already provides, and it is run against
the two transcribed wire lists **in W2** — five waves before the fixtures exist — so a transcription
or graph mismatch costs an afternoon rather than a wave. W6 compares its actual tap trace with this
frozen boolean baseline; that later test fails on a core that is secretly boolean, which is the
most likely way a C# implementer "simplifies" a solver they find slow. The canonical `DECISIONS.md`
ruling remains the sole authority for what the counter comparison means.

The parity harness is a shell diff. Both implementations ship the same CLI:
`minivac-trace <fixture.json> > out.txt`, then `diff ts.txt cs.txt`. No bespoke comparison tool
exists in either language, deliberately: a comparison tool is a place for a tolerance to hide.

---

## 10. Where the fallback values live

**Not in code.** Every unsourced constant is a JSON file in `data/profiles/`, hashed, named in
every fixture and recorded in every trace header. A measurement session on a surviving unit
replaces the file and re-blesses; **no source file in either language changes.** That is what
`DECISIONS.md`'s "MV601-REF-A is a knob, not a finding" actually requires, and it is the reason the
netlist and the profile are data rather than TypeScript literals a C# port would re-type by hand.

```jsonc
// data/profiles/MV601-REF-A.json  (extract — the normative key list is below)
{ "schema":"minivac.profile/1", "id":"MV601-REF-A", "marginal": true,
  "provenance":"docs/research/components.md §8.2 and §9.3; open-questions.md G1, G2, O-E1..O-E12",
  "values": {
    "V_oc_mv":        { "v":13000, "tag":"verified-reading",
                        "src":"MAINT p.3 'approximately 13 volts'; the extra digit is ours" },
    "R_src_uohm":     { "v":670000, "tag":"unverified", "src":"components.md §7.4; must not be 0" },
    "R_coil_uohm":    { "v":150000000, "tag":"unverified", "src":"chosen from the 1.5 A budget" },
    "L_coil_uh":      { "v":1200000, "tag":"unverified",
                        "src":"NEW. Unmeasured R-L value retained for the release-path role; not a counter cause. See §14 risk 1" },
    "V_arc_clamp_mv": { "v":30000, "tag":"unverified",
                        "src":"NEW. The arc across an opening contact; bounds one tick's di. §14 risk 2" },
    "V_pullin_mv":    { "v":6500, "tag":"unverified", "src":"components.md §8.2" },
    "V_dropout_mv":   { "v":2500, "tag":"unverified", "src":"ratio 0.38, 'great difference' per BK7" },
    "dV_relay_mv":    { "v":[-282,-169,-56,56,169,282], "tag":"unverified",
                        "src":"Wave D's dated A=282 mV physical-section linear-ramp convention; not a relay measurement or mechanism. See DECISIONS.md 2026-09-01 Wave D ruling" },
    "lamp_pwl_uohm":  { "v":[[0,18000000],["…33 breakpoints…"]], "tag":"unverified",
                        "src":"tungsten law R_hot·(I/I_hot)^0.36, tabulated; the table is the artifact. W1 reports whether 9 breakpoints change any decision" },
    "R_contact_uohm": { "v":50000, "tag":"unverified", "src":"UNUSED under ideal-contact collapse (§3.1)" },
    "contact_arc_udeg":{ "v":16875000, "tag":"unverified", "src":"UNIFORM-CONTACTS, O-R1, gap fraction 0.25" },
    "run_mrpm":       { "v":45000, "tag":"assumption", "src":"O-R3; BK5 p.7 worked example, not a spec" },
    "hand_slew_mrpm": { "v":30000, "tag":"unverified", "src":"NEW. Operator knob speed; bounds the sweep assertion (§5)" } } }
```

Every value carries `tag` and `src`. Nothing unsourced is silently a constant.

### 10.1 `minivac.profile/1` — the normative key list

`profile.ts` **rejects an unknown key and a missing required key**, so a porter never has to infer a
parameter's existence from prose. All values are integers in the stated unit; strokes are in µs,
not ms, so no profile value is ever a decimal. Revision 1 shipped "(extract)" and a partial delta
table while hashing the semantic profile payload into every golden header, and two parameters the worked golden
demonstrably depends on (the pushbutton stroke, the lamp thermal constant) appeared in neither.

| Key | Unit | Req | Notes |
|---|---|---|---|
| `tick_us` | µs | ✔ | 100 |
| `gmin_ns` | nS | ✔ | diagonal conditioning only (§3.1) |
| `V_oc_mv`, `R_src_uohm` | mV, µΩ | ✔ | Thévenin supply |
| `I_trip_ua`, `trip_delay_us` | µA, µs | ✔ | breaker |
| `R_coil_uohm`, `L_coil_uh` | µΩ, µH | ✔ | the R-L branch |
| `V_arc_clamp_mv` | mV | ✔ | §3.3 pass 2 |
| `V_pullin_mv`, `V_dropout_mv` | mV | ✔ | converted to µA at load (§4.4) |
| `dV_relay_mv` | mV × 6 | ✔ | per-relay offsets, applied to both thresholds |
| `relay_operate_stroke_us`, `relay_release_stroke_us` | µs | ✔ | mechanical only |
| `pushbutton_stroke_us`, `slide_stroke_us` | µs | ✔ | 25000 / 60000 |
| `relay_bounce_us` | µs | ✔ | adopted at 0; see §4.4 |
| `break_milli`, `make_milli` | milli | ✔ | 450 / 550 |
| `lamp_pwl_uohm` | [µA, µΩ] × N | ✔ | N ∈ {9, 33}; monotone, asserted at load |
| `R_cold_uohm`, `R_hot_uohm`, `I_hot_ua` | µΩ, µA | ✔ | PWL clamps and the brightness map |
| `lamp_thermal_tau_us` | µs | ✔ | filament electrical **and** visual state (§3.4) |
| `lamp_on_milli`, `lamp_dim_milli` | milli | ✔ | 600 / 150 |
| `contact_arc_udeg`, `wiper_offset_udeg` | µdeg | ✔ | UNIFORM-CONTACTS |
| `run_mrpm`, `hand_slew_mrpm` | milli-rpm | ✔ | both bound the sweep assertion |
| `coast_udeg_stop_shorted`, `coast_udeg_drive_removed` | µdeg | ✔ | the only stop model (§5) |
| `R1_uohm`, `R2_uohm`, `R_arm_uohm` | µΩ | ✔ | three coupled invented constants (§5) |
| `settle_quiet_ticks`, `settle_cap_us` | ticks, µs | ✔ | 200 / 500000 |
| `chatter_n`, `chatter_cycles`, `chatter_quiet_cycles` | count | ✔ | 8 / 4 / 12, derived per device at load |
| `min_decision_ua`, `min_tick_gap` | µA, ticks | ✔ | measured in W4a; W4b reproduces the frozen distribution |
| `R_contact_uohm`, `R_wire_uohm`, `visual_decay_us` | µΩ, µΩ, µs | ✔ | present and **unused**; declared so a porter does not implement them |

For the semantic profile hash, loaded scalar order is this table's rows top-to-bottom and each row's
keys left-to-right, skipping the two non-scalar entries (`dV_relay_mv`, `lamp_pwl_uohm`). Thus its
final three scalar lines are `R_contact_uohm`, `R_wire_uohm`, then `visual_decay_us`.

`profile.ts` is the **load-time schema and derivation gate**; it rejects malformed values and broken
structural assertions. `tools/check-profile.ts` is the measurement gate, not a conformance test. It
runs the acceptance tests of §9.4 and R1–R6 **on the post-quantization integer tick counts** (§6),
reports AT-01, AT-02 and AT-11 jointly, and prints the controls of §4.3. W1 found the joint feasible
region empty, so the tool reports that result rather than treating the working profile as acceptance
evidence.

Named fallbacks this architecture instantiates, all traceable: `MV601-REF-A` and `MV601-TIMING-A`
(`components.md` §8.2, §9.3), `UNIFORM-CONTACTS` (O-R1), `SERIES-THROUGH-FLOAT` (O-T6),
`IDEAL-ISOLATED-COIL` (O-N1), `ISOLATED-SETS` (O-N2), `BBM-EVERYWHERE` (O-T2),
`FALLBACK-PWRUP-COLD` (`programs.md` §2), and two that are new here and were signed off with the
rest of §17: `ARC-CLAMP` (O-E11) and `LAMP-THERMAL-R` (O-E12). `FITTED-CAPS` (O-N5) is **not**
instantiated at 1.0 — there is no capacitor element to gate (§2.1).

---

## 11. The marginal-failure toggle

**A profile swap. There is no second code path. It is a difficulty setting.**

| | `MV601-REF-A` (default, ON) | `MV601-IDEAL` |
|---|---|---|
| `L_coil` | 1.2 H working value, `[unverified]` | 0.012 H, shortening R-L release carry-over |
| `dV_relay_mv` | six literal offsets | all zero |
| `V_pullin_mv` | 6500 | relaxed below the lamp-divided rail with margin |

No `if (marginalFailures)` exists in the solver, the mover loop, or anywhere in `src/core/`, and
this is now literally true: revision 1 said it while shipping `FITTED-CAPS`, a config flag that
added six elements to the frozen element array and therefore changed stamp accumulation order and
every golden byte. Removing capacitors from 1.0 (§2.1) removes the contradiction rather than
papering over it. The two machines are diffable as data, the profile id is in every trace header and
every fixture, and a forgiving-mode trace is a first-class, testable artifact rather than untested
physics.

W1 established that this swap is **not** a resolved physical model of the documented counter
marginality. It remains because Tom's 2026-08-30 ruling keeps the default-on option and the canonical
2026-09-01 `DECISIONS.md` ruling keeps both counter demos while marking their mechanism unresolved.
The UI presents the swap as difficulty/forgiveness, never as "real" versus "ideal" hardware.

---

## 12. Determinism rules — the port contract

> **2026-09-03:** rule 6 is replaced, rule 10 is corrected and rules 18–21 are added by the
> Phase 3 engine-target amendment, §13.6. Read §13.6 with this section.

`docs/port/CSHARP-PORT.md` is this list plus the port sequence in §13.6.7. Each rule is a way to
silently break trace equality.

1. Node index = ascending minimum member **terminal index** of the super-node, over the non-datum
   super-nodes, renumbered `0..N−1`. The datum is the super-node containing MINUS; it gets no row.
2. Element iteration order = fixed non-source rows in `data/netlist.json` order, then connected
   positive-resistance cords in ascending int32 CordId, then the source last. Zero/absent-resistance
   cords emit only unions.
3. Stamp accumulation follows element order. No re-association. The expression trees in §3.3, §3.4
   and §4.4 are literal, including parenthesisation.
4. LU: partial pivot, max |a| in column, ties → **lowest row index**. Loop shape frozen. No BLAS,
   no MKL, no `System.Numerics`, no library. Arrays sized statically at 174×174; loops stop at
   actual `N` (§3.1).
5. **No transcendental anywhere in the core** — `pow`, `exp`, `log`, `sqrt`, trig, `hypot`,
   `fround`. The lamp law is the PWL table. Enforced by lint in TS and stated in the guide for C#.
6. **No FMA contraction — and the hazard is the C++ toolchain, not the CLR.** RyuJIT does not
   auto-contract `a*b+c`, which is why revision 1's rule was aimed at the wrong runtime: the named
   port target is Unity, which compiles through **IL2CPP to C++**, where clang contracts `a*b+c`
   into `fma` on ARM64 (every Apple Silicon and mobile target) under its default
   `-ffp-contract=on`, and some Unity player configurations have shipped `-ffp-contract=fast`, which
   contracts across statement boundaries. `a[i][j] -= m * a[k][j]` is exactly that shape. So: set
   `-ffp-contract=off` in the player's additional compiler arguments, do not use Burst with
   `FloatMode.Fast`, and **run the solver KAT inside a player build on every target platform**, not
   only in the editor or a console harness (§13.6.7 step 8).
7. All time is `int tick`. Every latency converts to an integer per-tick count at profile load, by
   the formulas in §4.4, and travel advances through the remainder accumulator of §4.3.
8. Per-relay spread is six literal integers. No `Random`, no seed, no draw order.
9. Contacts are frozen for the whole tick; every mover advances from one solution.
10. **Quantize, then decide.** The single `quantize` function of §3.5: scale, round-half-even,
    `-0 → 0`, saturating clamp to int32, `flags.nonPortable` on NaN, ±Infinity or a clamp. Never a
    bare cast. No threshold comparison ever touches a double.
11. Carried floating-point state is exactly `i_coil` (6) and `R_lamp` (12). It is updated in the
    frozen order of rule 2 and is covered by the solver KAT's multi-tick cases.
12. No `Map`/`Set`/`Dictionary` iteration anywhere a byte of output depends on it — the simulation
    path **and** the trace writer. Index arrays only. No sorting on anything but integer keys. The
    `?` line's field order is §9.2's observable vector, never the fixture's JSON key order.
13. No wall clock, no RNG, no hashing except FNV-1a 64. The netlist input is raw file bytes; the
    profile input is §9.2's normative semantic payload. Both render as 16 lowercase zero-padded
    hex digits.
14. Assert no NaN after every solve; set `flags.nonPortable` rather than continuing silently.
15. `tick_us × 20 < min device latency`, asserted at load. A coarser tick brings the settling
    question straight back and voids rule 9's justification.
16. **Branch currents come from companion equations, never from the matrix.** Every element's
    current is evaluated after the solve from its own equation on the (possibly identical) node
    voltages (§3.3). An element whose ends land in one super-node still has a defined current, and
    a system with zero unknowns is a legal solve, not an error.
17. **Files are UTF-8, no BOM, LF** — all of `data/**` and `test/conformance/**`. `.gitattributes`
    carries `* -text`; a repo check fails on any `\r` or BOM in a tracked data or golden file. C#
    writers use `new UTF8Encoding(false)` and `"\n"`.

**Must be bit-identical:** every integer in a snapshot, every event, every trace byte, and the
doubles in the solver KAT.
**Allowed to differ:** language, memory layout, allocation, threading (there is none), the UI,
sound, rendering, the asset pipeline, and how each side runs its tests.

---

## 13. File layout

### 13.1 Layout

> **2026-09-03:** "the Unity project" reads "the Godot project"; `fixtures/D` was never created;
> `solver-kat.json` has 21 cases, not 20; the port guide is 21 rules, not 17; the layout gains
> `dotnet/`, `godot/` and the generators — §13.6.6 and §13.6.8.

```
src/core/                       DOM-free, framework-free, zero runtime deps
  contract.ts       ~150   Command, State, Event, Note, CordEnd, CONTRACT. No logic.
  terminals.ts      ~120   frozen id table, designator parser + its traps, hole<->terminal
  netlist.ts        ~110   load data/netlist.json, build index arrays, count asserts
  profile.ts        ~150   schema validation, ms->tick derivation, R1-R6 + AT hooks
  ints.ts            ~60   quantize (saturating), roundHalfEven, idiv, idivRound, mod, iabs, fnv1a64
  graph.ts          ~120   union-find, datum, canonical node ids, source-component prune
  solve.ts          ~210   stamp (R-L, lamp, resistor, source), dense LU, arc pass, branch currents
  devices.ts        ~230   relay/button/switch travel + contacts, lamp filament, breaker
  rotary.ts         ~110   integer angle, contactAt, hand slew, the drive rate law
  trace.ts           ~90   the 33-observable vector, the golden formatter, the chatter rule
  machine.ts        ~250   tick loop, command queue, snapshot, events, notes
                    ----
                    ~1600

data/                           copied verbatim into the Unity project, hashed
  netlist.json              186 terminals, 392 holes, 22 elements, 31 contact sets  (~290 lines)
  profiles/MV601-REF-A.json marginal ON — the default
  profiles/MV601-IDEAL.json marginal OFF
  kat/profile-kat.json      one profile -> its derived integer set
  kat/solver-kat.json       20 element-list cases incl. 4 multi-tick, hex doubles
  kat/netlist-kat.json      40 wire lists -> node partitions + hole assignments
  kat/w2-at02-static.json   count-4 state + IV/ER source wires; no expected outputs

test/conformance/
  run.ts            ~180   load, validate, run, compare expect clauses, diff goldens, run probes
  bless.ts          ~130   regenerate goldens; the three refusal rules
  fixture.schema.json       minivac.fixture/1, validated by both runners
  fixtures/{A,B,C1,C2,D}/*.fixture.json
  golden/{A,B,C1,C2}/*.trace
  probes/*.json
  AT-02.discriminator.spec.ts
test/
  netlist-shape.spec.ts  ~90   counts, the element attribute table, parser traps, encoding check
  observable-order.spec.ts ~30 the 33-entry table against the code
  solve.spec.ts          ~90   divider maths, floating nodes, series-through-float, LU
  core-purity.spec.ts    ~30   no DOM, no clock, no transcendental in the built core

src/ui/
  loop.ts            ~40   the only wall-clock code in the repo
  inspector.ts      ~420   Phase 1: jack grid, lamps, relay rows with band strip, dial, notes pane
  trace-view.ts      ~50   live trace pane; renders src/core/trace.ts's output, owns no format
src/main.ts           ~15   composition root: validated netlist/profile + machine into inspector
index.html, main.css        plain-DOM inspector entry and schematic styling

tools/
  check-profile.ts  ~150   the AT set and R1..R6 as a standalone gate; the joint report; the controls
  gen-lamp-pwl.ts    ~40   one-off: emits the PWL table into the profile at 9 or 33 breakpoints

docs/plans/architecture.md      this document
docs/port/CSHARP-PORT.md        the 17 rules + the port sequence
```

Eleven core files. No `index.ts` barrels, no `types/` directory, no `src/core/devices/` subtree, no
registry, no factory, no dependency injection, no interface with one implementer. Relays are six
entries in parallel typed arrays, not six objects.

### 13.4 Controlling Wave 3 protocol-freeze amendment — 2026-09-02

This insertion controls Wave 3 wherever §§1–13 leave an API, ordering rule or
state transition ambiguous. It adds no component, command, observable, note kind or Phase 2 behavior.
The Phase 1 line estimates and over-engineering thresholds predate the fixed graph/solve workspaces,
exact allocation-free rotary arithmetic and retained paged stores required here. They remain historical
estimates, not acceptance limits for those modules; the no-extra-behavior and listed-module boundaries
still control.
The research package remains read-only: the rules below are simulator conventions where the sources
do not speak, not claims about a physical MINIVAC 601.

#### 13.4.1 The Wave 2 runtime seam: workspaces, source gate, bounds and profile derivations

`Machine.advance` may not call the allocating `buildGraph` or `tickSolve` wrappers that W2 exposes to
tests. W3 adds caller-owned, fixed-capacity graph and solve workspaces and in-place entry points. One
machine owns one of each; every tick overwrites them from the current cords and frozen contacts. The
workspaces retain capacity, never topology, node membership, an LU factorization or a previous answer.
This is scratch reuse, **not** the topology-signature or LU cache rejected in §6 and §15.

Graph construction, source prune, stamp, solve, quantization, device update and note analysis allocate
no transient scratch: they overwrite the caller-owned numeric workspaces and machine state above. That
is the controlling scope of §1.1's no-allocation rule for W3. This amendment explicitly supersedes its
absolute "must not allocate inside the tick loop" wording only for growth of retained Event output and
the retained chatter-transition history specified below; no other tick-loop allocation is permitted.
The accepted-command queue and Event log are growable, paged primitive stores; the implementation may
allocate a new implementation-sized page when `apply` accepts a command or when a tick emits an Event.
The Event store holds discriminants and primitive payload fields, not `Event` objects, retains every
Event until drained and has no behavioral capacity. `advance` therefore neither reserves storage
proportional to its tick argument nor rejects or drops an Event because a fixed buffer filled. Page size
and allocation timing are allowed to differ between ports under determinism rule 12. `snapshot()`
materializes a detached `State`; `drainEvents()` materializes and clears `Event[]`. The W2 allocating
wrappers remain legal for KATs and diagnostics only.

Chatter transition histories are the sole additional retained-state exception to the tick-allocation
rule. Each of the 19 chatter devices owns a growable paged primitive FIFO of int32 transition ticks. A
page may be allocated only when an observed transition requires it; the store has no behavioral
capacity and may not reject, coalesce or drop a transition. `drainEvents()` does not inspect or clear
chatter history. Quiet-episode completion and a rising power epoch clear and recycle that device's
history; ordinary power-off does not. Suppression may recycle the timestamp FIFO after retaining the
primitive `lastTransitionTick` needed for quiet recovery. Event pages and chatter pages are separate
logical stores even if an implementation shares a free-page allocator. This exception is required by
the already-frozen int32 `chatter_n` domain: imposing a construction-time `N+1` allocation or a smaller
profile cap would make a valid profile either impossible to construct or behaviorally narrower.

The source remains the final element in the frozen element order even when disabled. `sourceEnabled`
is exactly `power && !breakerTripped`. When false, the source stamps zero conductance and zero current,
reports branch current zero, and does **not** seed the source-component walk. It is electrically absent,
not a zero-volt source shunting PLUS to MINUS. The datum remains defined: datum-member terminals report
0 mV, every other terminal outside a source component reports `null`, `railMv` and `supplyUa` report 0.
Re-enabling the source restores the ordinary W2 source-last path without changing element order.

A disabled-source tick has an explicit de-energized path; it does not run §3.3's companion equations
on invented voltages for pruned branches. Graph construction still computes unions and canonical node
identity, so `coilShorted` and the rotary's D18/D19 short test remain structural. The solve has zero
source-connected rows. Every element branch current and branch voltage exposed to devices is exactly
zero; consequently every relay reports `coilMv=0`, `coilUa=0`, `indicatorUa=0`, every lamp reports
`ua=0`, and motor voltage/rate are zero. Before device decisions, all six carried `i_coil` doubles are
set to canonical positive zero. This is a simulator power-boundary rule, not an R-L claim about an
unpowered floating loop; breaker trip and power-off use the identical path.

The rest of the tick still runs. Unheld relays compare zero current and begin or continue their
ordinary mechanical release stroke; held relays instead continue toward their hand targets. Buttons
and slide switches continue toward their manual targets. An unheld dial consumes the applicable
one-shot zero-drive coast from §13.4.5, while a held dial continues its hand move. Each carried lamp
resistance performs §3.4's normal update with zero current, hence
`R_target=pwl(0)=R_cold`; it cools rather than snapping cold, and its class-change Events remain in the
ordinary lamp order. Breaker dwell and `flags.overCurrent` are zero/false. Steady-note candidates are
empty, but ordinary chatter and settle accounting observe the release, cooling and coast until their
public observables become quiet. A later source enable starts coils from zero; only a rising power edge
also snaps all lamps to `R_cold` and performs §13.4.3's cold epoch reset.

The structural maxima are unchanged and are not occupancy estimates: 174 graph nodes including the
datum, 173 solved rows, 256 sparse CordIds, and 278 elements including the source. A positive-resistance
`touch`/`touch` cord occupies no hole, so all 256 CordIds can be live even though the panel has 392
holes. W3 storage is therefore `holeOwner[392]`, `cordById[256]`, 31 contact positions, 186 terminal
voltages and the existing 174/173/278 graph-solver backing. Actual-count loops stop at actual counts.

`createMachine(netlist: LoadedNetlist, profile: Profile): Machine` is the only factory. `LoadedNetlist`
and `Profile` are already validated; the factory performs no filesystem access. `Profile` gains a bare,
16-lowercase-hex `hash`, computed from §9.2's normative semantic payload. `State.netlistHash` and
`State.profileHash` render the two bare hashes as `fnv1a64:<hex>`. Derived values are excluded from the
profile-hash payload, as §9.2 already requires.

The loaded profile cannot change behind that hash. In TypeScript, `loadProfile` returns a recursively
immutable value: it freezes the `Profile` root, `v`, `derived`, both relay-threshold arrays,
`dVRelayMv`, the `pwl` array and every PWL tuple after computing the hash. Its public types mark every
field readonly. A C# port uses immutable records/read-only arrays with the same ownership. In addition,
`createMachine` copies every scalar and array entry it will use into machine-owned construction-time
storage and never reads the caller's `Profile` again. Thus even a structurally typed mutable `Profile`
passed by a non-loader caller cannot change behavior while `State.profileHash` stays fixed. Construction
may allocate; no tick reads or copies profile storage. `test/profile.spec.ts` probes mutation of `v`,
`derived`, each derived array, `dVRelayMv`, `pwl` and a PWL tuple, and `test/machine.spec.ts` mutates a
deliberately mutable valid copy after construction and proves snapshot/hash/behavior do not move.

The following load-time derivations join §4.4's existing set. Their left-hand names are the exact new
members of `Profile.derived`. `idivRound64` is signed round-half-away-from-zero over exact signed 64-bit
operands; TypeScript uses `BigInt` for intermediate products and range-checks the result before
converting to `number`, while C# uses checked `long`:

```
tripDelayTicks = idivRound64(trip_delay_us, tick_us)
deadShortUa    = idivRound64(V_oc_mv * 1_000_000_000, R_src_uohm)
rMotorParUohm  = idivRound64(R2_uohm * R_arm_uohm, R2_uohm + R_arm_uohm)
vMotorRunMv    = idivRound64(V_oc_mv * rMotorParUohm, R_src_uohm + R1_uohm + rMotorParUohm)
relayCycleTicks = relayOperateTicks + relayReleaseTicks
buttonCycleTicks = 2 * pushbuttonTicks
switchCycleTicks = 2 * slideTicks
dialCycleTicks = idivRound64(60_000_000_000, 16 * run_mrpm * tick_us)
settleCapTicks = idivRound64(settle_cap_us, tick_us)
```

Every denominator above must be positive and every result must fit the field's stated int32 range.
The current `MV601-REF-A` inputs must derive `tripDelayTicks=2000`, `deadShortUa=19402985`,
`rMotorParUohm=10312500`, `vMotorRunMv=4065`, cycle ticks `200/500/1200/833` for
relay/button/switch/dial, and `settleCapTicks=5000`. These are arithmetic consequences of checked-in
profile values, not new physical constants.

W3 adds these exact profile domains before evaluating the formulas or the older structural assertions.
`tick_us`, `V_oc_mv`, `R_src_uohm`, `R1_uohm`, `R2_uohm`, `R_arm_uohm`, `I_trip_ua`,
`trip_delay_us`, `run_mrpm`, `hand_slew_mrpm`, `settle_quiet_ticks`, `settle_cap_us`, `chatter_n`,
`chatter_cycles` and `chatter_quiet_cycles` must each be an int32 in `1..2147483647`.
`coast_udeg_stop_shorted` and `coast_udeg_drive_removed` must each be an int32 in
`0..2147483647`; zero means no stopping offset. The existing stricter geometric and timing assertions
still run afterward.

Every numerator and denominator product in the displayed derivations must fit signed 64-bit before
division. In addition, `2147483647 * 6 * tick_us + 999`, the worst legal runtime angular-accumulator
sum, must fit signed 64-bit. `tripDelayTicks`, `deadShortUa`, `rMotorParUohm`, `vMotorRunMv`, all four
cycle-tick values and `settleCapTicks` must be positive int32. For each of those four device cycles,
both `chatter_cycles * cycleTicks` and `chatter_quiet_cycles * cycleTicks` must be positive int32;
`chatter_n + 1` must fit int32. These eight checked window products are validation results, not extra
`Profile.derived` members. No multiply may wrap, saturate or defer failure until `advance`.

Runtime counters do not create a second overflow path: `overloadTicks` saturates at
`tripDelayTicks`, the steady-note quiet counter saturates at `settle_quiet_ticks`, and a chatter
episode retains at most `chatter_n + 1` transitions after suppression begins. Window/quiet tests use
the checked int32 products above and non-negative tick differences; none increments an int32 past its
validated threshold.

The loader's negative-mutation table covers zero, `-1` and `2147483648` for every positive-domain key;
`-1` and `2147483648` for each coast key; a signed-64 derivation product overflow; angular-accumulator
overflow; `chatter_n + 1` overflow; and both chatter-window product overflows for every device family.
Each mutation must fail with the implicated key or product named.

Wave 3 extends §9.5's layer 0 without rewriting its evidence. The Wave-1
`data/kat/profile-kat.json` remains byte-identical and is still run first. A new immutable companion,
`data/kat/w3-derived-kat.json`, has schema `minivac.w3-derived-kat/1` and exact top-level members
`schema`, `source`, `derived`. It does not duplicate a profile. `source` has exactly
`profileKat`, `profileId`, `profileHash`, with values `data/kat/profile-kat.json`, `MV601-KAT-A`,
`8fb3c78e1d2c9a09`; the hash is §9.2's semantic hash of the profile embedded in that frozen file.
`derived` has exactly, in formula order, `tripDelayTicks=2000`, `deadShortUa=19402985`,
`rMotorParUohm=10312500`, `vMotorRunMv=4065`, `relayCycleTicks=200`, `buttonCycleTicks=500`,
`switchCycleTicks=1200`, `dialCycleTicks=833`, `settleCapTicks=5000`. Both ports must load the
embedded profile through the ordinary loader, pass the original KAT's exact derived block, reproduce
the companion source hash and then compare all nine new integers before running solver KATs. For this
versioned extension, `profile-kat/1` is exact equality against the Wave-1 member projection and
`w3-derived-kat/1` is exact equality against the nine-member W3 projection; the loader test also rejects
any `Profile.derived` member outside their union. The two immutable projections therefore remain the
exact complete derived set and together are layer 0; neither file may be re-blessed from the current
default profile.

Graph source-membership is authoritative only for a built graph; solve does not maintain a second
independently observable source mask. `terminalMv` uses the final solve's floating mask. Fixed element
indices are obtained once from the validated netlist; dynamic positive cords retain ascending CordId
order and the source remains last. No per-tick string such as `cord:<id>` is constructed: all 256 such
identifiers are prepared at machine construction for notes and diagnostics.

#### 13.4.2 Contract boundary, projected commands and live cords

`contract.ts` imports W2's branded `TerminalId` and `HoleId`; it does not redeclare either as an
unbranded string. "Frozen" means the versioned JSON field/kind/unit contract. A `snapshot()` is a
detached allocation, so caller mutation cannot alter the machine; runtime deep-freezing is not
required. `cords[]` is emitted in ascending CordId, with an absent command resistance normalized to
`r_uohm: 0`, and every `CordEnd` is copied rather than shared with a caller-owned command object.

`apply` validates immediately against a **projected** cord/hole state obtained by applying all already
accepted queued cord commands in FIFO order. It copies accepted primitive fields into the queue;
mutating the caller's object afterward has no effect. `snapshot()` before a positive `advance` sees
none of the queued effects. `advance(0)` validates its argument but applies no command and advances no
state. All queued commands land, in FIFO order, at the first boundary of the next positive advance.

The failure precedence is frozen because `CmdResult` exposes only one reason:

1. Reject a non-int32 or out-of-range CordId as `bad_cord_id`.
2. For `connect`, reject an already projected-live id as `cord_exists`; for `disconnect`, reject an
   absent projected id as `unknown_cord`.
3. For `connect`, validate `a` then `b`: a bad `hole` spelling or range is `unknown_hole`; a bad
   `touch` terminal is `unknown_terminal`; `free` needs no lookup.
4. Reject an explicit `r_uohm` that is not int32 `>= 0` as `bad_target`.
5. Test projected occupancy in `a`, then `b` order. The first occupied hole is `hole_occupied`; two
   ends naming the same HoleId therefore fail on `b` with `hole_occupied`. No partial occupancy or
   cord record is left behind.
6. A button/switch/relay section outside 1..6, a button/switch/relay-grab target outside 0..1000, a
   dial target outside 0..359,999,999, a non-boolean power value, or a breaker value other than
   literal `true` is `bad_target`.

The W4 JSON-schema validator rejects unknown command kinds or fields before `Machine.apply`; the typed
core surface adds no catch-all command or result variant. Repeating the current power value is accepted
and emits no event. `breaker reset` is accepted when already clear and emits no event. `dialRelease` is accepted when
already released. `relayRelease` is accepted when its relay is already unheld. Later target commands
in the same queue replace earlier targets when FIFO application reaches them, including successive
grabs of one relay.

Live cords never call W2's batch `allocateHoles`. A `hole` end owns exactly its parsed global hole
index; a `touch` end resolves to a terminal without occupancy; `free` resolves to terminal index `-1`.
Disconnect releases both occupied ends atomically. The graph input is rebuilt into a caller-owned
256-entry buffer by ascending CordId; incomplete cords stay in `State.cords` but contribute no union or
resistor element.

W2's `ProgramDesignator` remains symbolic. W4's terminal-level fixture compiler — not `Machine`, not
`graph.ts` — owns Ω resolution before it emits `connect`: `Ω_<n>` becomes checked
`n * 1_000_000` µΩ; bare `Ω` and `Ω_B<n>` require an explicit positive `r_uohm` supplied by
the fixture. Zero, overflow and missing values are fixture-load errors. No Ω form becomes an ideal
cord silently. Static fixture wires use W2's lowest-free-hole allocator once, before command emission;
interactive callers supply explicit HoleIds.

`advance(ticks)` accepts only int32 `>= 0`; invalid input throws `RangeError`, not `CmdResult`. Before
mutating, it simulates the queued power values in FIFO order and rejects a call whose resulting tick
would exceed int32. If that boundary contains any effective rising edge, the final surviving epoch
starts at zero and the preflight tests `ticks`; otherwise it tests `state.tick + ticks`.

#### 13.4.3 Power cycle and breaker

A machine is constructed power-off, breaker-clear, electrically cold, relays released and unheld, manual movers
at LEFT/released, dial at 0 and with empty cords. A rising power edge begins a cold electrical epoch:
`tick=0`, all six coil currents become zero and all twelve lamp resistances become `R_cold`. Unheld
relay travel/remainder/direction becomes released. A held relay preserves its travel and hand target,
clears its fractional remainder and retains its last physical non-zero direction; power cannot
teleport a crossbar the operator is holding. Chatter and steady-note histories clear, and undrained
events from the prior epoch clear before `power.on` is recorded. The clear is required because `Event.t`
has no epoch field and `drainEvents` promises tick order. After the first simulated tick of that epoch,
`snapshot().tick` is 1.

Construction performs one zero-time disabled-source graph/solve initialization using those constructed
controls, the D0 wiper and no cords. It applies no command, advances no mover, breaker, chatter or steady
counter, increments no tick and emits no Event. The immediate snapshot therefore has `tick=0`,
`railMv=0` and `supplyUa=0`; datum-member terminals report 0 and every other terminal reports `null`.

A power cycle does **not** move or disconnect physical controls: cords and hole ownership, button and
slide targets/travel, held relay ownership/target/travel, dial angle, dial held/target state, and
breaker-tripped state survive; unheld relay mechanics alone take the cold reset defined above.
Power-off and breaker trip/reset do not release a held relay. Power-off
gates the source and clears delayed-overload dwell, but the dial may take the configured
drive-removed coast; it does not home. A tripped breaker requires `breaker reset` even across a power
cycle. These are simulator reset semantics, not a claim that a zero-duration off/on sequence models
the mechanics of a real relay. `[unverified]`

Power commands in one boundary are still strict FIFO. Each effective rising edge is an epoch barrier:
after all earlier commands have applied, it clears the undrained primitive Event store and cold-resets
the electrical state above, sets `tick=0`, then records `power.on` at 0. Command effects that the reset
rules preserve — including cord occupancy and manual target/position state — remain applied. Later
commands run at tick 0; a later effective rising edge repeats the barrier and clears the zero-duration
epoch before it. Thus `off,on,off` from an on machine leaves, in the surviving epoch, `power.on` then
`power.off`, both at 0, while `off,on,off,on` leaves only the final `power.on` at 0. The source gate for
the ensuing solve uses the final queued power value. This is intentional epoch replacement, not Event
loss: `>` command lines are the caller's pre-apply acceptance records from §13.4.7, so later simulation
lines may show a timestamp decrease at a reset, whereas `drainEvents()` exposes only the surviving
epoch promised by its tick ordering.

The breaker is the minimum model its two existing profile inputs can specify, not an invented thermal
curve. It carries `overloadTicks`, `tripPending`, and `tripped`:

- From the quantized magnitude of source branch current, `>= deadShortUa` sets `tripPending`
  immediately. This is the exact ideal PLUS/MINUS-short case AT-06 names and introduces no unstated
  instantaneous-current multiplier.
- Otherwise `>= I_trip_ua` increments consecutive `overloadTicks`; a smaller sample resets it to zero.
  Reaching `tripDelayTicks` sets `tripPending`. Equality is on the overloaded side.
- At the next tick boundary, latch and clear the incoming `tripPending`, then apply queued commands. The
  consumed latch is boundary state: power epoch barriers do not clear it. After those commands and
  before contacts freeze, a latched pending trip sets `breakerTripped`, clears the dwell,
  emits `breaker.trip`, and disables the source for that tick's graph/solve. Thus the reported tripped
  state and reported rails never disagree and the trip never causes an uncontracted third solve.
- `breaker reset` clears tripped, stored pending and dwell. It cannot clear the boundary's already
  latched pending trip: in that case `breaker.reset` emits first if it changed tripped state, then
  `breaker.trip` restores the trip. If the overload remains after an ordinary reset, the following
  solve starts the same test again.

`flags.overCurrent` means the most recent enabled-source sample was `>= I_trip_ua`; it is false while
the source is gated. The breaker uses current magnitude. The research describes a thermal breaker and
an approximate high-current instantaneous region, but supplies no time-current curve or exact
multiplier; this consecutive-dwell convention is `[unverified]` and makes no stronger physical claim.

#### 13.4.4 Movers, contacts and lamp boundary values

All electrical current/voltage fields used by a polarity-insensitive device are magnitudes:
`relay.coilMv`, `relay.coilUa`, `relay.indicatorUa`, lamp `ua` and `supplyUa` are non-negative. The
motor alone consumes signed `V(D18)-V(D19)`. This follows the verified fact that the relay/lamp chain
is used in both polarities; it is not a new component model.

The shared mover state is `{travel, dir, acc}`. On a direction change, clear `acc`; while moving,
add 1000, take `step=idiv(acc,strokeTicks)`, retain the remainder, and clamp at the exact destination.
Reaching a destination sets `dir=0` and `acc=0`. A target mover chooses `sign(target-travel)` each tick,
uses the same full-stroke tick count in either direction, and clamps rather than overshoots an arbitrary
target. Therefore a 0→1000 move lands in exactly its stroke count and target 500 takes exactly half the
stroke when the per-tick division is exact; non-dividing targets land on the first step that reaches
them.

Machine also carries private `relayLastPhysicalDir[6]`, initialized to 0. Whenever a relay's travel
actually changes, store that step's +1/-1 direction; reaching a hand or electrical target does not
clear it when mover `dir` returns to 0. A cold epoch resets it to 0 for an unheld relay and preserves
it for a held relay. It is not public State, an observable or an Event field. This memory is what lets
release from a held arbitrary mid-stroke target continue through the hysteresis band; if no physical
move has ever supplied a direction, zero means hold.

For relay `n`, compare `abs(coilUa)` to that relay's spread thresholds. `>= pullInUa` requests +1;
`<= dropOutUa` requests -1; strictly between them holds at a stop or continues the existing direction
mid-stroke. A request that points beyond the stop is effective direction zero, so an operated relay does
not repeatedly restart its accumulator. `relay.pullIn`/`relay.dropOut` means an effective direction
change to +1/-1, not arrival at the stop; its non-negative margin is respectively
`coilUa-pullInUa` or `dropOutUa-coilUa`. `band` is `above` at `>= pullInUa`, `below` at
`<= dropOutUa`, otherwise `hold`. `coilShorted` is exact equality of the coil's two graph-node ids,
never a quantized zero-voltage test.

`relayGrab<n> target=<milli>` gives hand control of that relay at the next positive tick boundary.
While held, the electrical solve continues to compute coil current, band, lamps, breaker load and
notes, but the hand target owns travel. Increasing/ON/left travel uses `relayOperateTicks`;
decreasing/OFF/right uses `relayReleaseTicks`, through the same integer-remainder mover and with no
new profile constant. This is an `[unverified]` deterministic hand-speed convention, not a measured
human rate. A later grab replaces the target. `relayRelease<n>` relinquishes the hand; it never means
target zero, and a repeated release is an accepted no-op. Above pull-in the electrical controller
then requests ON, below drop-out it requests OFF, at an end stop inside the band it holds, and
mid-stroke inside the band it continues `relayLastPhysicalDir[n]` so release cannot strand the relay
both-open. The hand may force either direction against an energized coil; Contract 1.1 has no force
limit.

Manual travel emits its ordinary contact and resulting lamp Events, participates in `minTickGap`,
chatter and C2 counts, and sets the existing relay motion-mask bit only while moving. It emits no
`relay.pullIn` / `relay.dropOut`. Electrically controlled motion on the first unheld tick immediately
following a held tick is likewise a handoff rather than a threshold Event. If that tick has no motion,
the suppression expires; a later electrical threshold-direction change emits normally. A grab and
release queued in one boundary, with no held tick, suppresses nothing. Other electrical
threshold-direction changes use the existing Events and margins. A private prior-tick held mask
distinguishes those cases, so
manual operation cannot populate or lower `minDecisionUa`. `State.relays[n].band` remains the coil
condition and `held` reports hand ownership independently.

Contacts are frozen before the solve by walking the validated 31 netlist rows in their stored order.
Every transfer row uses `travel < break_milli` for NC, `travel > make_milli` for NO, and open otherwise;
the wiper row uses `contactAt` or open. No W3 module carries a second hard-coded relay/button/slide
ordering table. After travel advances, transfer contact events are derived by walking those same rows.
If both edges could occur in one update, break emits before make.

Lamp brightness remains §9.2's resistance-derived integer. Its displayed expression is evaluated as
binary64 in written operation order: first `R_lamp-R_cold`, then multiplication by 1000, then division
by `R_hot-R_cold`; round that binary64 quotient to the nearest integer with ties away from zero,
normalize negative zero, then clamp to 0..1000. There is no intermediate resistance quantization, and
this is not a call to §4.4's integer-domain `idivRound`. `lamp.on` emits on a class change from `off` to
`dim` or `on`; `lamp.off` emits on a change from `dim` or `on` to `off`. The `dim`↔`on` boundary remains
observable in the trace but emits no lamp Event.

#### 13.4.5 Rotary control and coast

`contactAt` is exactly §5's circular integer algorithm. `dialGrab` sets `held=true`, replaces the
target and chooses the shortest signed circular delta. A delta of exactly +/−180,000,000 µdeg chooses
the positive direction. A new grab, release, controller change or direction reversal resets the angular
remainder. Hand travel clamps exactly at the target and remains held there; `dialRelease` clears hand
control and motor control resumes on the next tick.

Motor rate uses signed, quantized armature voltage and the new positive derivation. Negative
`V(D18)-V(D19)` (D17 side positive, as Book I Exp 12 wires RUN) maps to positive angular travel, and
positive travel follows the panel's verified increasing-number, clockwise order. The sign comes from
Book I p.23 Exp 13 ("First, light 5 flashes and then light 6 flashes": D1, then D2), Books V-VI p.6
Exp 5, and the p.11 elevator, whose trips keep their selected direction only in this sense. Tom ruled
it on 2026-10-13 (`docs/DECISIONS.md`); it reversed the earlier convention, which no source
supported. `[likely]`; `open-questions.md` O-R11 lists the evidence, including Exp 4's self-conflict.

```
mrpm = quantizeInt32(idivRound64(-(run_mrpm * vMotorMv), vMotorRunMv))
```

The negation applies to the exact 64-bit product, never to `vMotorMv`: `-vMotorMv` overflows int32
at INT32_MIN.

The angle integrator accumulates `mrpm * 6 * tick_us`, divides by 1000 for integer µdeg, and retains
the signed remainder. Saturation sets `flags.nonPortable`. A floating armature gives rate zero. A
non-zero motor rate that reverses sign reverses immediately: contract 1.1 has no reversal dynamics.
Because that reversal is instantaneous, the tick it happens on reseeds the dial's chatter history
as a coast does, but at most once per dial chatter window and never while the dial is suppressed, so a
reversal-driven hunt still trips (§9.2, 2026-10-14).

The two coast values are **stopping offsets, not a hidden velocity model**. On the first non-held tick
whose motor rate changes from non-zero to zero, apply the configured offset, scaled by the speed it
stops from (below), in the last non-zero direction during that tick. While the source is enabled, exact D18/D19 graph-node equality selects
`coast_udeg_stop_shorted`; every other enabled-source loss of drive selects
`coast_udeg_drive_removed`. A disabled source always selects `coast_udeg_drive_removed`, even when
D18/D19 remain structurally unioned. The offset is consumed once. Resumed drive, another zero-rate tick
or an immediate non-zero reversal adds no second coast. `[unverified]` — the angles already carry
O-R5's invented status; this rule adds no time constant.

**Coast deferred across a contact transfer** (Tom's ruling, option B, 2026-10-13; `[unverified]`).
One exception moves the decision tick and never the offsets. A zero-rate tick may come with the
source enabled, D18/D19 not unioned and `motionMask() !== 0` (a relay, pushbutton or slide
mid-stroke). The dial then holds with `mrpm = 0`, applies no offset and keeps the coast owed.
The wait ends on the first tick that has any of these:

- D18/D19 unioned: `coast_udeg_stop_shorted`;
- non-zero drive in either direction: no coast; a reversal through a transfer counts as an
  immediate reversal, and (2026-10-14) reseeds the dial's chatter history under §9.2's
  once-per-window limit;
- `motionMask() === 0`: `coast_udeg_drive_removed`;
- a disabled source: `coast_udeg_drive_removed`;
- `max(relayOperateTicks, relayReleaseTicks, pushbuttonTicks, slideTicks)` ticks already waited:
  the ordinary rule above.

Why: a transfer set that cuts RUN by leaving one contact and shorts STOP by landing on the other
leaves the armature undriven but unbraked for the transfer. Without the wait, the weak drive-removed
offset locks in on the first undriven tick and the STOP short that arrives under 1 ms later (a relay's both-open band; about 6 ms for a slide) is
ignored. Fallback `TRANSFER-COAST-DEFER`, open-questions.md O-R12, `[unverified]`.
That overshot Tic-Tac-Toe's first move past the centre square (Book VI p.55; `tools/motor-claims.ts`).
A grab or release clears an owed coast.

**Coast scales with the speed it stops from** (2026-10-13; `[unverified]`). The configured offsets
are the overrun from RUN speed. Whichever one the rules above select is scaled by the rate in force
when the drive left (`lastMotorMrpm`, which a deferred coast keeps across the wait):

```
speed = |lastMotorMrpm|
offset = speed >= run_mrpm ? coast : idivRound(coast * speed, run_mrpm)
```

The product is exact (below 2^62: C# one 64-bit multiply, TypeScript two 16-bit-limb steps) and
rounds half away from zero; the result is below `coast`. Why: a permanent-magnet armature under
dynamic (back-EMF) braking decelerates in proportion to speed, so its stopping distance is
proportional to the speed it stops from. Both stops are dynamic braking (STOP short through R_arm; drive
removed through R2, which sits permanently across the armature). Friction makes the true distance convex
in speed, so linear scaling from RUN is an upper bound below RUN and the cap understates above RUN. The
V-EXP12 creep ends at -11 mrpm, so the fixture shows only that a near-zero-speed stop must not coast.
Without it, `V-EXP12`'s coil-flyback creep at about 3.6% of
RUN took the whole 20° jump (the shipped value then) and stopped a pad short of Books V-VI p.23 ("The pointer knob of the
rotary switch will turn to the number drawn on the matrix"). The cap at 1 is chosen: power across
STOP runs faster than RUN (Maintenance p.9), and the cap keeps every stop at or above RUN speed on
exactly the configured offset, so no stop overruns further than the pad-tuned values allow. Stops at or above the unloaded RUN rate keep the configured offset; a loaded RUN stop,
typically 96-99.5% of `run_mrpm`, shrinks by that fraction. No profile constant changes. Fallback `COAST-SCALES-WITH-SPEED`,
open-questions.md O-R13 (offsets O-R5).

**The drive-removed offset is set from printed bounds** (Tom's ruling, 2026-10-14; a one-off
exception to the kill rule; `[unverified]`). `coast_udeg_drive_removed` was an invented 20°. It is now
9_540_000 µdeg (9.54°), the midpoint (9.5389695°, rounded to 0.01°) of the band
[5_692_552, 13_385_387] µdeg in which every printed claim and printed assert passes at MV601-REF-A.
Book V p.14 V-EXP11 ("The rotary switch will return to 0") sets the lower edge. Books V-VI p.55
VI-MATCHGAME sets the upper through script[68], the machine-move until on the gap ("the rotary switch
will turn to the number of matches remaining after the machine's move"): from 13_385_388 µdeg the
turn c13→gap→c12 completes inside the fixture's 50 ms pushbutton 6 tap, before the until starts. That
edge is a script observation window, not a printed rest; the printed rest asserts hold to
13_713_926 µdeg (midpoint 9.70° if the tap-window edge were discounted).
`coast_udeg_stop_shorted` (5°) stays the shorter. No rule above changes. open-questions.md O-R5, O-R14;
`rotary.md` §3.3.

Every hand, motor and coast displacement enumerates contact boundaries in actual travel order and
emits every crossed make/break, even if one tick crosses several boundaries or complete revolutions.
Correctness therefore does not depend on §5's load assertion considering only `run_mrpm` and hand
speed; that assertion remains a profile sanity check, not a license to jump. Positive angular travel
orders pads 0→1→…15→0; negative travel reverses it.

#### 13.4.6 Tick, event and snapshot order

`Event.t` is the boundary tick before the tick's final increment. `apply; advance(1)` on a new machine
therefore records `power.on` at 0 and returns `snapshot().tick === 1`. A rising power edge clears the
prior event epoch as stated above; within an epoch `drainEvents()` is emission-ordered and therefore
tick-ordered. Calling it twice returns the events, then an empty array.

Within one tick Events use this frozen order:

1. command-caused `power.on`, `power.off` and effective `breaker.reset`, in FIFO command order;
2. a pending `breaker.trip`;
3. for relay 1..6: its electrical threshold-direction Event when one is due, then set 1 and set 2
   contact edges; manual/handoff travel has no threshold Event;
4. pushbutton 1..6 contact edges;
5. slide switch 1..6, set 1 then set 2 contact edges;
6. dial make/break edges in physical crossing order;
7. output lamp 1..6, then indicator lamp 1..6;
8. chatter Events in observable-index order.

Construction emits no baseline Events. Repeating an already-effective command emits none. Contact
Events carry the `arm` and `to` ids from the loaded netlist row. All movers advance from one quantized
solution before any new contact state can affect a graph. Event ordering never changes this simultaneous
state transition.

`snapshot()` materializes the post-tick state. Cords are ascending CordId; notes use §13.4.8's order;
`flags.chattering` is observable-index order. `terminalMv[i]` is `null` exactly when the final solve marks
that terminal's node floating, except the datum members remain 0. The observable buffer is not part of
the snapshot.

`flags.nonPortable` is lifetime-sticky for one Machine. Machine ORs every solve, quantizer and rotary
portability fault into its private flag and never assigns it false. Ordinary good ticks, a rising power
epoch and a full power cycle do not rehabilitate a trace that has already become void; only constructing
a new Machine begins with `nonPortable=false`.

#### 13.4.7 Observables, formatter and chatter

The 33 integer encodings are frozen in §9.2 order:

- power and breaker: false/clear `0`, true/tripped `1`;
- relay, pushbutton and switch: NC `0`, mid `1`, NO `2`;
- dial: contacts `0..15`, gap `-1`;
- lamps: off `0`, dim `1`, on `2`.

`Machine.observables()` overwrites and returns the same 33-entry caller-visible buffer every call;
it allocates nothing. A caller that retains a vector must copy it. Mutation by a caller is overwritten
on the next call and cannot alter machine state. The conformance runner owns one fixed previous-vector
buffer and copies all 33 entries after comparison.

`Machine.motionMask()` is the allocation-free motion seam for W4 `settle`. Bits 0..5 are relay1..6,
bits 6..11 are pb1..6 and bits 12..17 are sw1..6; a bit is 1 exactly while that mover's private
direction is non-zero. All other bits are zero. The dial is deliberately absent: §9.2 watches only
its classified contact for settle, not angle or motor rate. W4 requires both an unchanged 33-vector
and `motionMask()===0`; it does not infer motion from integer travel deltas or allocate per-tick
snapshots.

This amendment supersedes §9.2's phrases "command applied" and "commands, in the order applied" for
`>` trace lines. A `>` line is an **accepted/queued input record**, not a Machine Event and not an
observation of the later tick boundary. Immediately before each `Machine.apply`, W4 reads the public
`snapshot().tick` as `acceptedAt`; if `apply` returns `{ok:true}`, W4 immediately appends
`formatCommand(acceptedAt, command)`. A rejected command emits no line. Every accepted no-op is still
recorded, including repeated power, reset of an already-clear breaker and an already-released dial.
Multiple queued commands retain call order and their pre-apply ticks. No `>` line is reordered with
later `*`, `?` or `!` output merely because its numeric timestamp matches; trace line order is runner
action order, and a later power epoch may restart simulation timestamps at zero. The illustrative §9.2
`>` lines are to be read with this acceptance meaning. The earlier statement that `>` and `?` cannot
share a tick is also superseded: accepted input and an assertion may carry the same numeric tick if the
script performs both without an intervening advance, and their file order is authoritative.

`trace.ts` owns `OBSERVABLES`, the value spellings, integer millisecond formatting, canonical command
payloads, transition-line formatting and the LF joiner. W4 owns fixture headers and assertion content,
but calls these functions; it does not create a second device/value/command formatter. The public seam
is:

```
formatMs(tick): string
formatCommand(tick, command): string
formatTransitions(tick, before33, after33): string | null
formatAnomaly(tick, anomaly: TraceAnomaly): string
formatTrace(lines): string
```

The anomaly payload is not free text. `contract.ts` exports this exact shared union beside `Event`;
`trace.ts` imports it:

```
type ChatterDev =
  | "relay1" | "relay2" | "relay3" | "relay4" | "relay5" | "relay6"
  | "pb1" | "pb2" | "pb3" | "pb4" | "pb5" | "pb6"
  | "sw1" | "sw2" | "sw3" | "sw4" | "sw5" | "sw6" | "dial";

type TraceAnomaly =
  | { k: "chatter"; dev: ChatterDev; transitions: number;
      windowTicks: number; quietTicks: number }
  | { k: "no-settle"; waitedTicks: number };
```

All four count/duration fields are positive int32. The `Event` chatter case is the `chatter` member
above plus `t`; it therefore adds exact `windowTicks` and `quietTicks` fields, and W4 passes a drained
chatter Event directly to `formatAnomaly(event.t, event)` without re-deriving a profile window. W4,
not Machine, decides that a settle cap was reached and passes the actual ticks advanced as
`{k:"no-settle",waitedTicks}`. Core `trace.ts` owns both renderings.

An inline duration uses unpadded `ticks/10` and `ticks%10` integer digits, for example 800 ticks is
`80.0`; the timestamp prefix still uses `formatMs`. The exact outputs after that prefix and ` ! ` are:

```
<dev> chatter <transitions> transitions in <window-duration>ms — suppressed <quiet-duration>ms
no settle in <waited-duration>ms
```

The dash in the chatter line is U+2014 with one ASCII space on each side. There are no other anomaly
kinds or spellings in contract 1.1. Within a simulated tick, the observable `*` line precedes a
chatter `!`; W4 appends `no-settle` after the final tick output that exhausted the cap.

`formatTrace` rejects CR, trailing whitespace and embedded LF in a supplied line, joins with one LF,
and returns exactly one final LF. `formatTransitions` scans indices 0..32 and emits one `*` line or
`null`. Command payload field order is the union's declaration order. Ends render `hole:<HoleId>`,
`touch:<TerminalId>` or `free`; connect renders normalized `r_uohm` after `b`. The canonical verbs are:

```
power on|off
breaker reset
connect cord=<id> a=<end> b=<end> r_uohm=<n>
disconnect cord=<id>
button<n> target=<milli>
switch<n> target=<milli>
relayGrab<n> target=<milli>
relayRelease<n>
dialGrab targetUdeg=<udeg>
dialRelease
```

Chatter watches only the 19 mover observables: relay1..6, pb1..6, sw1..6 and dial. Power, breaker and
lamps have no independent mechanical cycle and are not chatter devices. Each device uses its derived
cycle from §13.4.1. A transition at tick `t-windowTicks` is outside the half-open window and is evicted;
the current transition is then inserted. Exactly `chatter_n` transitions is legal; transition N+1
emits one `chatter` Event, adds the device name to `flags.chattering`, and suppresses further chatter
Events for that episode. An episode ends when
`currentTick-lastTransitionTick >= chatter_quiet_cycles*cycleTicks`; history clears and ordinary
monitoring resumes. The trigger Event's `transitions` is N+1. Device names and simultaneous trigger
order are the observable table's order.

#### 13.4.8 Steady notes

Contract 1.1 has **two** Note kinds. An older "three-kind notes" phrase was a count
error and does not authorize a third. The tick path stores fixed primitive note candidates; only
`snapshot()` allocates the public Note objects and `drops` arrays.

Notes are present only after `settle_quiet_ticks` consecutive ticks with no relay/button/switch travel
change, `dial.mrpm === 0`, no dial contact change, and no 33-observable change. Any violation clears
the steady count and note candidates. Notes order by relay 1..6, with `coil-starved` before
`lamp-in-coil-path` for the same relay.

For a relay released at travel 0 whose steady current is strictly above `dropOutUa` and strictly below
`pullInUa`, emit `coil-starved` with `needsUa=pullInUa`. Remove the coil edge, then walk independently
from each coil endpoint while the current node has exactly one other incident, non-self element edge;
take that edge and stop on reaching the source, a branch node or a dead end. Parallel elements count as
separate incident edges; an element whose endpoints have collapsed to one node is a self-loop and is
never a chain edge. The two walks plus the coil define its maximal unbranched chain. They share one
element-index visited set: an element enters the chain at most once, and a walk stops before taking an
element already accepted by either walk, so meeting walks form one set union rather than duplicate
drops. Exclude the coil and source. Every remaining element on that chain carries the relay's
non-negative quantized `coilUa` by KCL; include those with non-zero absolute quantized voltage drop.
Rank by exact signed-64
`abs(mv) * abs(ua)` descending, ties by frozen element index, and emit all of them as `{el,mv}` with
non-negative `mv`. Dynamic resistor ids are the prebuilt `cord:<id>` strings. This deliberately makes
no claim about a unique loss path through a branched or looped network: analysis stops at the branch.

Emit `lamp-in-coil-path` when the relay's own indicator lamp lies on that same unbranched chain and has
non-zero current; `lampMv` is its non-negative voltage magnitude. A bypass that creates a branch removes
the lamp from the unbranched chain, which is the topology distinction the note exists to expose. These
are deterministic help-layer conventions over solved topology, not causal claims about the documented
counter marginality.

W7's notes-pane acceptance uses a circuit that actually satisfies that strict predicate. Wire
`1+#1–1A#1`, `1B#1–1C#1`, and `1E#1–1-#1`; power it for 200 ms with the coil open, move the last
cord endpoint from `1E#1` to `1F#1`, and wait 200 ms. The shipped profile then gives relay 1 travel
0, `coilUa=33839`, `coilMv=5076`, its `14787 < 33839 < 41453` hysteresis band, output and indicator
lamp `milli=695`, ordered drops `out1=3951 mV` / `ind1=3951 mV`, both Note kinds, and clean flags.
Three cords are minimal for this preheat construction: a direct one-lamp chain settles at
`46217 µA`, above the shipped maximum `45213 µA` pull-in. The earlier proposed MM-RLY-CHECK
`1X/1E` to `1X/1C` rewire does not qualify; with pushbutton 1 held it measures about `45889 µA`,
above relay 1's pull-in, and therefore correctly has `State.notes=[]`.

#### 13.4.9 Wave 3 test inventory

The hand-written Wave 3 proof consists of five new W3-specific specs, an extension to
`test/profile.spec.ts`, the two separately mandatory purity/order specs, and the immutable
`data/kat/w3-derived-kat.json` companion specified in §13.4.1. §13.1's shorter list did not name all
tests needed to prove the required behaviors:

- Existing `test/profile.spec.ts` runs `profile-kat/1` and then `w3-derived-kat/1`, including the
  companion's source id/hash checks, before any solver or device test; it also exhausts the W3 domain,
  overflow and recursive-immutability mutation table.

- `test/contract-shape.spec.ts`: contract version, exact ten command discriminants, relay section and
  target domains, branded ids, detached snapshots including relay `held`, the exact
  `TraceAnomaly`/chatter-Event shapes and compile-time frozen examples.
- `test/devices.spec.ts`: exact 120/80/250/600-tick full strokes; reversal remainder reset; pull/drop
  equality and mid-stroke continuation; travel 449/450/550/551 contact edges; target 500 both-open;
  retained last physical relay direction after reaching an arbitrary target; all 31 loaded contact
  rows; lamp class boundaries; delayed, ideal-short and reset breaker paths.
- `test/rotary.spec.ts`: 355°/359.999°/0.001°; pitch ties and one µdegree either side; offset wrap;
  positive-tie 180° hand sweep with every edge; motor polarity/rate; both one-shot coast choices;
  reversal; a displacement crossing several boundaries without a skipped event.
- `test/trace.spec.ts`: all 33 names/encodings; stable observable buffer; integer time at ticks
  0/1/10/int32-max; command acceptance time across an epoch reset; accepted no-ops and rejected input;
  repeated-release no-op recording; all ten command spellings; same-tick runner order; both exact
  `TraceAnomaly` renderings; UTF-8/LF/final-LF;
  chatter at N/N+1, exact window eviction, suppression and quiet resume for all four mover families.
- `test/machine.spec.ts`: deferred commands and projected conflicts; caller-command mutation;
  construction-profile mutation isolation; hole/touch/free lifecycle; sparse CordId 255 and ascending
  snapshots; reset and breaker source gate;
  multi-command power epoch barriers; trip-latch/reset ordering; tick/Event/drain order; event-store
  growth across more than one implementation page without loss; disabled-source zero branch values,
  canonical-zero coil carry, unheld mechanical release, held hand travel under disabled source,
  lamp cooling, rotary coast and power-off settle;
  simultaneous relay crossings under reversed update order; terminal null/0
  mapping; `MM-RLY-CHECK`, both `I-EXP7` wirings, hysteresis, target 500 and both release paths;
  invalid relay section/target; later-grab FIFO replacement; hand override against an energized coil;
  contact/lamp but no threshold Events during manual travel and first handoff; no suppression for a
  grab/release pair with zero held ticks; release-at-stop with no motion followed by a later genuine
  threshold Event; power-cycle and breaker preservation of held state; release from a held mid-band
  mid-stroke stop using the retained physical direction; legal
  maxima 174/173/278/256, all 392 hole ids, the zero-unknown dead short, invalid/zero/overflow advance.
  It also proves the immediate construction snapshot and §13.4.8's steady quiet gate; series chains;
  branch, self-loop and parallel stopping; two walks meeting without duplication; exact signed-64
  ranking and frozen-index ties; dynamic `cord:<id>` drops; and the relay's own indicator present versus
  bypassed. A good tick, a portability fault, a later good tick and a power cycle prove that
  `flags.nonPortable` remains lifetime-sticky. The exact 18-bit `motionMask()` mapping is tested for
  all three mover families, including a legal tick whose integer travel does not change while its
  direction remains non-zero.
- `test/core-purity.spec.ts` and `test/observable-order.spec.ts` remain mandatory.

No Wave 3 **core module** imports DOM or filesystem. Tests may use Node filesystem APIs or a shared
test byte-loader solely to read `data/netlist.json` as raw bytes for W2 `loadNetlist`; this preserves
raw-byte hash authentication rather than constructing a fake `LoadedNetlist`. No Wave 3 test imports
DOM, a conformance fixture parser or Phase 2 assets. W4 remains the only owner of fixture validation,
assertions, blessing and golden files.

---

### 13.5 Controlling Wave 4a protocol-freeze amendment — 2026-09-02

This insertion controls W4a wherever §9 was ambiguous. It changes no device
physics, printed expectation or profile numeric value. It records protocol only: no W4 runner,
schema, fixture, golden, CLI or dependency exists merely because this text does.

#### 13.5.1 Schema, validation and exact fixture members

`test/conformance/fixture.schema.json` is JSON Schema Draft 2020-12. Its root declares
`"$schema":"https://json-schema.org/draft/2020-12/schema"` and
`"$id":"minivac.fixture/1"`. TypeScript uses the exact pinned dev dependency `ajv@8.20.0` (not 8.17.1,
because of GHSA-2g4f-4pwh-qvx6, a ReDoS when Ajv's `$data` option is enabled) through its Draft-2020 entry point with `strict:true` and `allErrors:true`. This is a test/tool
dependency, never a `src/core` dependency. A port may choose another Draft-2020-12 validator, but
must accept and reject the same checked-in valid/invalid fixture corpus before running a fixture.
Schema validation precedes every semantic check.

Every schema object has `additionalProperties:false`. A fixture has required members, in this
semantic set, `schema`, `id`, `source`, `tier`, `confidence`, `profile`, `contract`, `as_printed`,
`errata_applied`, `wires`, `script`; optional members are `note`, `marginal`, `mechanism`, `digest`.
JSON member order is not semantic. The exact scalar domains are:

- `schema` is `minivac.fixture/1`; `contract` is `1.1.0`;
- `profile` is `MV601-REF-A` or `MV601-IDEAL`;
- `tier` is `A`, `B`, `C1` or `C2`; Tier D remains a separate smoke-test class, not a fixture;
- `confidence` is `verified`, `likely` or `unverified`; and
- `id` matches `^[A-Z0-9]+(?:-[A-Z0-9]+)*$`; every Phase-1 id already uses this portable token
  grammar. It contains no path separator, dot segment, whitespace or trace delimiter, so the same
  value is safe in the trace header, fallback inventory and `golden/<tier>/<id>.trace` path.
- `source` and a present `note` are non-empty strings.

`as_printed` is a non-empty array of non-empty source strings. `wires` is a non-empty array of
strings accepted by `parseTerminalWire`; terminal-domain and hole-exhaustion checks follow schema
validation. No Book-VII Ω designator is legal in `minivac.fixture/1`: admitting one requires the
now-reserved contract 1.2 element/netlist change.

`errata_applied` is an array of exact `{id,from,to}` objects with non-empty string fields. `from` and
`to` are fully qualified physical terminal pairs accepted by `parseTerminalWire`; the transcriber
expands the page's documented shorthand exactly once when authoring those two fields. `as_printed`
alone preserves the shorthand. The runner never guesses an omitted section prefix from position or
neighboring wires. For the positive check, map every physical rail alias, including `M+`/`M-`, to
`PLUS`/`MINUS`, sort the two canonical ends and compare the resulting unordered pair. Each canonical
`from` must be absent from `wires`; each canonical `to` must occur exactly once.
`MM-PB-PRINT-01` is the local source-correction id for the Maintenance figure's
printed `1X/2B` to intended `1X/2A`; it is not an SDC errata-sheet item. `MM-PB-CHECK` preserves
`X/2B` in `as_printed`, carries
`{"id":"MM-PB-PRINT-01","from":"1X/2B","to":"1X/2A"}`, uses `1X/2A` in `wires`, and
retains `programs.md` §4.7's printing-error explanation in `note`.

A script is a non-empty array of five exact discriminated steps (`until` added 2026-10-13,
`docs/plans/phase-5-corpus.md` Step 2, contract D1):

```
{ "k":"do",      "cmd":Command, "collapse":boolean? }
{ "k":"advance", "ms":positive-int32 }
{ "k":"settle",  "maxMs":positive-int32 }
{ "k":"expect",  "obs":[...], "cite":string, "quote":string,
                         "tag":"unverified"?, "source":"FALLBACK-<name>"? }
{ "k":"until",   "obs":[...], "maxMs":positive-int32, "cite":string, "quote":string,
                         "tag":"unverified"?, "source":"FALLBACK-<name>"? }
```

`do` and `expect` consume no tick; `advance` and `settle` do; `until` consumes zero or more.
`until` follows every `expect` rule below for `obs`, `cite`, `quote`, `tag` and `source`, is
legal in every tier, and its `maxMs` converts to ticks by the same checked multiplication as
`settle`.

`until` semantics, with `cap = maxMs*10` ticks and `waited = 0`: if every listed `obs` equals the
current observable value, stop (match); otherwise, if `waited == cap`, stop (timeout); otherwise
advance exactly one tick through the same per-tick path `advance` and `settle` use, so
transitions, chatter, Events and digest counters stream normally, increment `waited` and test
again. Match is tested before the cap, so a match on the cap tick is a match. The step then emits
exactly the `?` line an `expect` with the same `obs` and `quote` would emit at that moment, on
the current post-boundary `snapshot().tick`. On timeout it also records one failure per listed
`obs` whose actual value differs, at the `until` step's script index, exactly as `expect` does,
and the script continues. There is no new trace line kind, no anomaly line and no header change.
An `until` that matches after `k` ticks, with `k` a multiple of 10, therefore traces identically
to `advance` by `k/10` ms followed by `expect`.

A present `collapse` is meaningful only when true, and the collapse meta-test deletes those `do` steps. Each `obs` is a non-empty array
of exact `{dev,v}` objects from §9.1's 33-row legal table. The schema encodes those pairs as 33
`oneOf` branches and uses one `contains`/`maxContains:1` constraint per device, so one expectation
cannot name the same `dev` twice even with different values.

`cite` is the source location and `quote` is exactly the source sentence rendered in the golden.
Both are non-empty, contain no U+0000..U+001F character and are well-formed Unicode scalar strings:
an unpaired UTF-16 high or low surrogate is invalid, while a valid surrogate pair represents its
astral scalar and is legal. This validation occurs after JSON decoding and before execution. Golden
quoting writes one `"` at each end, replaces
backslash with `\\` and quote with `\"`, and leaves every other Unicode scalar unchanged. The `?`
payload is the observable projection in frozen order, two ASCII spaces, then that quoted string.
Pass/fail remains structured runner state; a failed assertion is never blessable and therefore has
no blessed-line spelling.

An `expect` or `until` step derived from a named fallback additionally has both `tag:"unverified"` and
`source:"FALLBACK-<name>"`; the source matches
`^FALLBACK-[A-Z0-9]+(?:-[A-Z0-9]+)*$`, and the pair is wholly present or wholly absent. Fixture `confidence`
describes transcription and cannot hide step-level fallback provenance. Running
`minivac-trace --list-fallbacks` scans `test/conformance/fixtures/**/*.fixture.json`, validates
each file and emits one LF-terminated line per fallback `expect` or `until` step, sorted by fixture id then
zero-based script index:

```
<fixture-id>\t<script[<index>]>\t<source>\t<cite>
```

No matches produce zero bytes and exit 0.

A non-marginal fixture has neither `marginal` nor `mechanism`. A marginal fixture has
`marginal:true` and exact
`mechanism:{profileKey,decision}`. `profileKey` is one member of the loaded profile's normative
scalar or array key lists; `decision` is exactly
`docs/DECISIONS.md#2026-09-01-canonical-marginal-counter-ruling-after-w1`. The pair is wholly
present or wholly absent. The fixture flag is independent of the selected profile's `marginal` flag.

A C2 fixture requires exact `digest:{eventCount,moverTransitions}`. Until 2026-10-13 it also
contained no `expect` step; contract D1 (`docs/plans/phase-5-corpus.md` Step 2) lifts that ban, so
a C2 fixture may now carry `expect` and `until` steps beside its digest.
`eventCount` is a non-negative int32 count of every Event returned by the runner's per-tick
`drainEvents()` calls over the complete script, including chatter. `moverTransitions` is exactly 19
non-negative int32 entries in `CHATTER_DEVICES` order, counting each value change of that mover
observable independently of chatter suppression. Non-C2 fixtures prohibit `digest`. This reviewed
object, not a hash of the golden, is the C2 bless pin.

#### 13.5.2 Initial wiring, time, output and settle

The runner parses and allocates `wires` in array order, queues their `connect` commands with cord ids
equal to zero-based wire indices and requires every command to be accepted. These authoring commands
are not trace lines and are not advanced separately; they land with the first script boundary.
Scripted setup commands are trace-visible. Thus `MM-SW-CHECK` records
`switch1 target=1000`, settles it while power is off, then records `power on`; the printed RIGHT
initial setting is not hidden fixture state.

Trace version 1 requires `profile.v.tick_us===100`, because its frozen `formatMs` divides ticks by
ten. The runner refuses another tick period before applying commands. `ms` and `maxMs` convert by
checked multiplication by 10; overflow above int32 is a fixture error. There is no rounding.

The runner drains Events after every one-tick advance. It maintains `nextBoundaryTick`, initialized
once from `snapshot().tick`. A boundary with no Event uses that value. If Events were drained, all
must carry one identical `t`, and that value is the boundary tick; an effective rising power edge
always emits `power.on`, so an epoch restart cannot be missed. After output, set
`nextBoundaryTick=boundaryTick+1`. Observable `*` and chatter `!` from that advance use the
boundary-before-increment tick; an immediate `?` uses current post-boundary `snapshot().tick`.
Within a boundary `*` precedes drained chatter `!`; a cap `no-settle` follows all output from the
final advanced tick.

After each settle tick, compare the 33-vector and read `motionMask()`. Increment the quiet counter
exactly when no vector entry changed and the mask is zero; otherwise reset it. Succeed after
`settle_quiet_ticks` consecutive increments. Relay, pushbutton and slide motion is therefore watched
even within one contact class. The dial has no mask bit: only observable index 20, `dial.contact`,
participates. Hitting `maxMs*10` ticks emits `no-settle` with the actual waited ticks and continues.

The rules header has this exact field order and spelling:

```
# rules settleTicks=<n> chatterN=<n> relayWinTicks=<n> relayQuietTicks=<n> buttonWinTicks=<n> buttonQuietTicks=<n> switchWinTicks=<n> switchQuietTicks=<n> dialWinTicks=<n> dialQuietTicks=<n>
```

Each window is `chatter_cycles * <family>CycleTicks`; each quiet value is
`chatter_quiet_cycles * <family>CycleTicks`. REF-A therefore prints, in field order after their
names, `200, 8, 800, 2400, 2000, 6000, 4800, 14400, 3332, 9996`. The old singular
`chatterWin/chatterQuiet` example is superseded.

#### 13.5.3 Metrics, digest refusal and CLI

> **2026-09-03:** `minDecisionUa` is the minimum over non-negative `marginUa` only — §13.6.8.
>
> **2026-10-13:** a numeric gate below threshold no longer refuses by itself; it triggers §9.3's
> BLESS-ROBUSTNESS check (six perturbed-profile runs, asserts only, magnitudes `[unverified]`), and
> the fixture is refused only if an assert fails there. Tom's ruling, `docs/DECISIONS.md`
> 2026-10-13, "Knife-edge gate: keep the 14 µA trigger, add a robustness check".

`minDecisionUa` is the minimum `marginUa` among drained `relay.pullIn` and `relay.dropOut` Events.
`minTickGap` keeps a last-change tick independently for each of the 33 observable indices and is the
minimum positive tick difference when the same index next changes. Accepted inputs, assertions,
anomalies, simultaneous changes of different observables and epoch timestamp decreases do not
enter; clear the 33 last-change entries on epoch restart. An empty population renders `na` and does
not fail its gate. The margins header remains exactly:

```
# margins minDecisionUa=<integer|na> minTickGap=<integer|na> marginal=<true|false>
```

`bless` refuses before any write if a structured expectation failed; if either numeric metric is
below its same-named profile threshold without the exact marginal/mechanism pair; or, for C2, if the
computed digest is not member-for-member equal to the reviewed fixture digest. The marginal carve-out
applies only to the numeric gates, never to assertions or C2 digest. The profile numbers remain
provisional until §9.3's preregistered isolated Maintenance-plus-Tier-A pass records the sorted
SHA-256 fixture inventory and both distributions. Each final gate is the minimum populated
non-marginal value for that metric, copied to both profiles; `na` and declared marginal fixtures are
excluded, equality passes, and an empty population leaves the provisional value unchanged. W4b
lands those exact measured Tier-A bytes and must reproduce the distributions. No value may change
merely to make one fixture pass.

`npm run bless -- <id>` is the exact package invocation. It resolves one unique fixture id,
completes every validation and refusal check before opening a golden for replacement, then writes
UTF-8 without BOM, LF only, exactly one final LF. `bin/minivac-trace <fixture.json>` writes only the
trace to stdout; validation and runtime diagnostics go to stderr with non-zero exit. Both call one
loader and runner. Probe execution is not part of W4a's fixture runner; §9.4's separately typed probe
loader begins with the first probe-bearing wave.

The W4a proof includes mutations for every required or unknown schema member; all ten command, step and
observable discriminants; duplicate observables; invalid encoding, BOM and CR; physical endpoints,
hole exhaustion and wire reversal; each erratum side; failed assertions; unsafe/path-like ids,
control-bearing citation/fallback fields, unpaired citation/quote surrogates and a positive astral
scalar; fallback listing; same-tick
input/assertion and epoch reset; fixed advance versus settle; within-class motion; dial-contact-only
settle; cap order; all numeric and `na` metric cases; per-family header derivation; each bless refusal
without a partial write; C2 digest fields; CLI stdout/stderr and byte parity; and twice-identical runs
of all three Maintenance fixtures. `MM-PB-CHECK` has a negative `MM-PB-PRINT-01` mutation; the three
fixture wire arrays are independently compared with their W2 KAT source pins.

---

### 13.6 Controlling Phase 3 engine-target amendment — 2026-09-03

This insertion controls Phase 3 wherever §§0–13 name Unity, IL2CPP, Burst, a Unity player build or
`Update()`. Tom directed on 2026-09-03 that the engine port targets **Godot 4** (`docs/DECISIONS.md`,
*2026-09-03 — engine target: Godot supersedes Unity*). It changes no device physics, no contract
member, no observable, no fixture, no golden and no profile value. It records what Unity-specific
text is superseded, what merely used "Unity" as the name of the engine port and survives with a
word swap, and which rules gain a Godot analogue. Godot as the engine target, C# as the port
language and the in-repository layout are `[settled]`. The build order lives in
`docs/plans/phase-3-godot.md`; this section carries rules and corrections only.

Facts about Godot and .NET below carry confidence tags; each `[verified]` fact was read on
docs.godotengine.org, the godotengine/godot source at tag `4.7-stable`, the dotnet/runtime source,
or learn.microsoft.com on 2026-09-03; the sources are listed in §13.6.9 by the same F-numbers as
`docs/plans/phase-3-godot.md` Appendix F.

#### 13.6.1 What is superseded, and what survives

- **§0, "Determinism rules" row** — "IL2CPP's FMA contraction" names a cause that no longer
  exists on the target. The row's mechanism (a numbered, mechanically enforced list that is the port
  guide) is unchanged; its named toolchain hazard is replaced by §13.6.3.
- **§1.3** — "Unity's `Update()` has the same clock accounting with `Time.deltaTime`" is superseded
  by §13.6.2. The load-bearing half of that paragraph — per-tick sampling at each boundary, never a
  bulk `advance(ticks)` — is engine-agnostic and stands.
- **§12 rule 6** — replaced in full by §13.6.3.
- **§13.1** — "copied verbatim into the Unity project" reads "into the Godot project"; the layout
  gains the entries in §13.6.6. `docs/port/CSHARP-PORT.md` keeps its name: C# is still the port
  language, and the references to that path (§2.4, §3.4, §12, §13.1) stay valid.
- **§0's size figure** — 5,393 lines is the Phase 1 closure measurement; §13.6.8 records the
  current figures.
- **§15, "Conformance concepts in the frozen Unity contract"** — reads "the frozen engine
  contract".
- Every other occurrence of "C# port", "C# runner" and "C# implementer" names the same port and
  stands. The .NET-generic *mechanisms* in §§3.5, 9.2, 12 and 13.4.1 (`long`, `ulong`, checked
  arithmetic, `CultureInfo.InvariantCulture`, `new UTF8Encoding(false)`, immutable records)
  stand: Godot's C# runs on CoreCLR on every desktop target `[verified: F33]`. **Two things do not
  stand**: §3.5's ".NET Core saturates, .NET Framework yields `0x80000000`" sentence (corrected by
  §13.6.4), and the "20 cases" count for `solver-kat.json` in §3.5, §9.5 and §13.1 (corrected to
  21 by §13.6.8). The 2026-08-30 Step 0 answer (a) — a TypeScript reference
  core, frozen schemas, a golden suite, a C# port; no embedded JS runtime, no socket bridge — was
  never about Unity and transfers unchanged; Godot offers the same two rejected shortcuts (a
  GDExtension or WebView embed, a socket bridge) and they are rejected for the same reasons.

#### 13.6.2 §1.3 retargeted — the clock

The adapter's single wall-clock function lives in the Godot project's `Loop.cs`. It runs from
`_Process` but derives elapsed time from `Time.GetTicksUsec()` `[verified: F17 — 64-bit microseconds since engine start, guaranteed
monotonic]`, unaffected by `Engine.TimeScale` (measured at Phase 3 G0 on Godot 4.7.2: at
`Engine.TimeScale=0.1` the wall clock advanced 252357 µs while the summed delta ratio was 0.155;
`docs/port/CSHARP-PORT.md` rule 20), never from the `delta` argument, because
`Engine.TimeScale` scales `delta` and every simulation that consumes it `[verified: F18]`, and
never from `_PhysicsProcess`, whose fixed step is a second accumulator that would compete with the
tick accounting. The accounting is otherwise §1.3's: capped catch-up at 50 ms, integer carry,
`advance(1)` and `drainEvents()` per tick, one snapshot render per frame. The C# form is quoted in
`phase-3-godot.md` §2.7.

#### 13.6.3 §12 rule 6 replaced — FMA contraction

> **6. No FMA contraction — and on the shipped targets there is no toolchain that performs one.**
> RyuJIT does not auto-contract `a*b+c` on x64 (every FMA node originates from an explicit
> intrinsic) or on ARM64 (the `madd`/`msub` path is integer-only) `[verified: F28, F29]`; NativeAOT
> uses the same code generator `[verified: F30]`; the runtime team classes contraction as a
> value-changing, unsafe optimization and disables it in its own native builds `[verified: F31,
> F32]`. Godot's C# executes on CoreCLR on Windows, macOS and Linux `[verified: F33]`.
> IL2CPP, Burst and `-ffp-contract` do not exist on this target; the Unity-era instruction to set a
> compiler flag evaporates. What remains, and is mandatory: (a) `Math.FusedMultiplyAdd`,
> `MultiplyAddEstimate`, `System.Numerics` and `Godot.Mathf` are banned from the core by the purity
> scan; (b) a runtime sentinel test asserts `Math.FusedMultiplyAdd(a, b, c) != a * b + c` for a
> chosen triple; (c) **the solver KAT runs inside the exported build on every shipped target**, not
> only under `dotnet test` — because the exported build also proves the packed data bytes and the
> frame accounting, and because a future non-desktop target (iOS is NativeAOT `[verified: F33]`,
> Android is CoreCLR or Mono depending on an export option `[verified: F33]`, Mono's LLVM AOT
> contraction policy `[unverified]`) is proven the same way rather than argued.

The revision-1 remark that "RyuJIT does not auto-contract" was correct and is now the rule's
foundation rather than its footnote.

#### 13.6.4 §3.5 and §12 rule 10 corrected — the bare cast

§3.5 says ".NET Core saturates, .NET Framework yields `0x80000000`". Precisely `[verified: F20]`:
before .NET 9, x86 and x64 returned `int.MinValue` for out-of-range inputs (NaN is not tabulated
for the old behaviour); from .NET 9, every platform saturates and NaN converts to 0, explicitly to
make the conversion deterministic. ARM64 already saturated before .NET 9 `[verified: F20 —
dotnet/runtime#61885: "For ARM32 and ARM64, there will be effectively no impact and the codegen
will remain identical to what it is today as the underlying conversions already perform saturation
on overflow"]`. The rule is unchanged — the port never bare-casts;
`quantize`'s explicit clamp and the `saturating-quantize` KAT case are the proof — and the runtime
floor (.NET 10, `docs/DECISIONS.md` 2026-09-03 toolchain pins) sits above the change. `double.ConvertToIntegerNative`,
which restores the old platform-specific behaviour, joins the banned list.

#### 13.6.5 §12 extended — rules 18–21

> **18. The core is a plain class library.** `Minivac.Core` has no package reference and no engine
> reference, and its tests pass with `dotnet test` on a machine without Godot. A test parses the
> project file to say so.
>
> **19. Contract data enters as raw bytes and is parsed by `System.Text.Json`.** In the Godot
> build, `FileAccess.GetFileAsBytes` `[verified: F13]`; never `GD.Load`, `ResourceLoader` or
> `Godot.Json`. The reason is not that JSON cannot be loaded — it is that it can: Godot 4
> registers a `ResourceFormatLoaderJSON` and `JSON` inherits `Resource`, so
> `GD.Load("res://data/netlist.json")` silently succeeds and returns a tree in which every number
> is a `double` `[verified: F15, F16]`. `.json` has no *importer* in Godot 4.7, so the editor
> never rewrites the file bytes; the netlist hash is taken over the bytes before parsing, as
> `netlist.ts` does. A Godot-side source scan fails on `GD.Load`, `ResourceLoader.Load`,
> `ResourceLoader.LoadThreadedRequest` or `Json.Parse` applied to any `.json` path.
>
> **20. One frame loop, one clock** — §13.6.2.
>
> **21. Packed data is a byte copy, and boot proves it.** `data/` and the conformance artifacts are
> copied into the Godot project by one script and asserted byte-identical by tests on both sides;
> the export preset's non-resource include filter carries `*.json, *.trace` because Godot's export
> documentation lists `.json` among the non-resource files that need the filter `[verified: F6]`; `Boot.cs` refuses to start, naming both hashes,
> if the loaded netlist hash is not the pinned `2354ceebf3f8c566` that every golden header carries.

#### 13.6.6 §13.1 extended — layout

```
dotnet/                          engine-free .NET: Minivac.Core (11 files, zero deps),
                                 Minivac.Conformance (loaders, runners, classifier; one schema
                                 validator package), Minivac.Trace (the minivac-trace CLI),
                                 Minivac.Core.Tests (xUnit over the same artifacts)
godot/                           the Godot 4.7.2 .NET project; data/, conformance/ and audio/ are
                                 byte copies; scenes/ and scripts/ are the adapter
data/panel-layout.json           minivac.panel-layout/1, generated from src/ui/panel-layout.ts
tools/gen-panel-layout.ts        the generator
tools/sync-data.ts               data/ + test/conformance artifacts + public/audio/*.wav → godot/
tools/parity.ts                  both CLIs over all 36 fixtures, diff, and diff against golden
docs/port/CSHARP-PORT.md         the 21 rules + the eight-step sequence + the runner contract
```

A C# core meaningfully larger than the TypeScript core it transcribes would signal something built
that the TypeScript core does not have.

#### 13.6.7 The port sequence

1. Copy `data/` and the conformance artifacts verbatim (`npm run sync-data`). No translation, no
   re-typing, no C# literals. Hashes are checked at load. Configure the repo per rule 17 before the
   first checkout on Windows (`.gitattributes` already carries `* -text`).
2. Transcribe `contract.ts` → `Contract.cs` one-to-one, every serialized field named exactly.
3. Implement the eleven core modules from `CSHARP-PORT.md`.
4. Run `profile-kat.json`, `w3-derived-kat.json`, then `solver-kat.json` (21 cases). Do not proceed
   until all pass bit-exactly; every later failure is then guaranteed not to be floating point or a
   derivation.
5. Run `netlist-kat.json` (40 cases). Integer and string comparison only.
6. Run the fixtures' `expect` clauses. Passing means the port is a Minivac.
7. Run the goldens through `minivac-trace` and `diff`. Passing means the port is *this* Minivac.
   Run the probes to their pinned integers. Run the collapse test and the W2 static classifier
   (`111`/`101`).
8. **Export a Godot build for each shipped target and run steps 4–7 inside it** (`--headless --
   --selftest`). Rule 6(c). An editor-only or `dotnet test`-only run does not close the wave.

#### 13.6.8 Record corrections a porter would otherwise rediscover

Read off the shipped code and tests on 2026-09-03. Where prose and code differ, the code — which
the goldens were blessed against — governs.

- **`solver-kat.json` has 21 cases**, not the 20 that §3.5, §9.5 and §13.1 state; the count was
  ruled 21 in `DECISIONS.md`, *2026-08-30 — Phase 1 Wave 1a spec readings* and the prose was never amended.
- **`test/conformance/AT-02.discriminator.spec.ts` does not exist and must not be created.**
  `counter-golden.spec.ts` asserts that no file under `test/conformance/` names both `at-02` and
  `discriminator`. The static classifier lives in `tools/check-netlist.ts` (`runStaticGate`,
  `classifyLamp`) over `data/kat/w2-at02-static.json`; the dynamic count-4 assertion lives in
  `counter-golden.spec.ts`. A port reproduces the `111`/`101` tuple after verifying the input
  projection hash `7dfc1d82a9341248`, and the dynamic assertion on its own traces.
- **§9.5's proof table gains two rows**: `data/kat/w3-derived-kat.json` is layer 0 (nine derived
  integers from the KAT profile, integer equality); `data/kat/w2-at02-static.json` is an
  input-only artifact whose expected tuples live in code.
- **`minDecisionUa` is the minimum over non-negative `marginUa`** among `relay.pullIn` and
  `relay.dropOut` Events (`run.ts`, and §9.3); §13.5.3's unfiltered wording is superseded.
- **`minTickGap` counts strictly positive gaps only**, per observable, reset by a `power.on` epoch
  restart before the comparison.
- **Probe checkpoints must be strictly increasing by address** (`probe.ts`); §9.4's "rejects a
  duplicate address" understates the rule.
- **A probe's `diagnostic` flag is echoed and does not exempt the case from `pass`** (`probe.ts`);
  §9.4's "deliberately a diagnostic, not a required trip" describes intent, not the gate. The port
  follows the code.
- **`bless` has four refusal gates**, not §9.3's three: assertion failure, `minDecisionUa`,
  `minTickGap` (the latter two waived by `marginal: true`) and the C2 digest. **2026-10-13:** the
  two numeric gates are now triggers, not refusals: a non-marginal fixture that trips one is
  refused only if it fails the BLESS-ROBUSTNESS check (§9.3). The C# `GoldenAcceptancePolicy`
  keeps the stricter refusal (port guide, "Bless refusal contract").
- **Tier D was never created.** §13.1's `fixtures/D` entry is void; the fixture schema's `tier`
  enum excludes it; Tier D remains demo smoke tests in the application, not conformance.
- **§9.2's illustrative header prints stale hashes.** The shipped values are netlist
  `2354ceebf3f8c566` and `MV601-REF-A` profile `92c1419fd8cdd210` (`e25b2257499508da` before the
  2026-10-14 coast change, §13.4.5).
- **§12 rule 4's "174×174" is the node capacity, not the matrix.** The LU array is
  `SOLVE_MAX_ROWS`² = 173² (`solve.ts` 103–105, 154); node arrays are `SOLVE_MAX_NODES` = 174.
- **§0's "final raw measurement is 5,393 lines" is the Phase 1 closure figure.** On `main` after
  the 2026-09-03 boundary-validation hardening, the eleven modules total 5,545 raw lines and `devices.ts` is 288,
  over the 280-line tripwire the Phase 1 size estimate set (it named `devices.ts` over 280 lines as
  a signal of over-engineering). Recorded, not excused; no threshold is
  moved.
- **§13.1's layout line for the port guide reads "the 17 rules + the port sequence".** The guide is
  21 rules, the eight-step sequence and the runner contract (§13.6.5, §13.6.6).
- **Duplicate object keys are an acceptance rule** (`DECISIONS.md`, 2026-09-03): an artifact with
  duplicate object keys is accepted on both sides, the last key wins, and neither side rejects it.
  Each implementation has a test-local raw input that pins the behavior. `System.Text.Json` stays
  at its default duplicate-property handling (`[likely]` until G1 verifies it), never strict
  rejection. Integer-typed fields spelled `1.0` or `1e3` are not an edge: JSON
  Schema 2020-12 defines `integer` as any number with a zero fractional part `[verified: F19]`, so
  every conformant validator on both sides accepts them.
- **The profile hash payload is ASCII by construction**, and `semanticHash` maps UTF-16 code units
  to bytes one-to-one. A port encodes the same payload as ASCII and asserts it is ASCII.
- **The trace runner's settle emits a `no-settle` anomaly on cap and continues; the probe runner's
  settle throws on cap.** Same word, different contract, by design.
- **The probe runner's `advance` is one `advance(ticks)` call with one drain; the trace runner's
  is a per-tick loop.** Event batching differs between the two runners by design.

#### 13.6.9 Sources for the external facts in this amendment

Read on 2026-09-03; a subset of `docs/plans/phase-3-godot.md` Appendix F with the same numbering,
which the port guide carries forward.

- F6 — Godot docs, *Exporting projects* (the non-resource include filter for `.txt`, `.json`, `.csv`).
- F13 — Godot class reference, `FileAccess.get_file_as_bytes`.
- F15 — Godot class reference, `JSON` (inherits `Resource`; numbers parsed with `String.to_float`);
  `core/io/json.cpp` at `4.7-stable`.
- F16 — `core/register_core_types.cpp` at `4.7-stable` (`ResourceFormatLoaderJSON` registered).
- F17 — Godot class reference, `Time.get_ticks_usec`.
- F18 — Godot class reference, `Engine.time_scale`.
- F19 — JSON Schema Validation 2020-12 §6.1.1.
- F20 — learn.microsoft.com, .NET 9 breaking change *Floating point-to-integer conversions are
  saturating*; dotnet/runtime#61885.
- F28 — dotnet/runtime `src/coreclr/jit/lowerxarch.cpp` (FMA nodes only from intrinsics).
- F29 — dotnet/runtime `src/coreclr/jit/lowerarmarch.cpp` (madd/msub integer-only).
- F30 — dotnet/runtime `docs/design/coreclr/botr/ilc-architecture.md` (NativeAOT uses RyuJIT).
- F31 — dotnet/runtime#64604 (contraction is value-changing; `-ffp-contract=off` for native builds).
- F32 — dotnet/runtime#64591, #10137, #8289 (automatic FMA contraction declined).
- F33 — `modules/mono/mono_gd/gd_mono.cpp` at `4.7-stable` (CoreCLR via `hostfxr`);
  `Godot.NET.Sdk/Sdk/iOS.targets` (NativeAOT); `GodotTools/Export/ExportPlugin.cs` and
  `gd_mono.cpp` (Android CoreCLR/Mono selection).

---

## 14. Risks, and what is invented

**1. `L_coil` is a constant the research package does not contain.** It is filed as O-E10. W1
tested the simulator prediction that originally justified it and did not reproduce the required
joint behavior. The 1.2 H profile value remains `[unverified]` only for the R-L carried state and
release-path role in §4.2. A measurement on a surviving unit can replace it; until then it must not
be cited as the cause of the Book IV counter's documented marginality. The canonical 2026-09-01
`DECISIONS.md` ruling governs.

**2. `V_arc_clamp_mv` is a second new constant** (**O-E11**). It exists because backward Euler on
an opened inductor is unphysical without one: the companion alone puts ~1 kV on a panel jack and
zeroes the current in one tick, and in the `nE`/`mG` series-chaining idiom it drives a dead coil to
half the live coil's current in a single tick — above three of six relays' pull-in on the shipped
spread. The mitigation is that the constant is *physical* (the arc voltage across an opening
contact) and its effect is checkable: it sets the open-release ramp to `V_arc/L` per tick, which
`check-profile` requires to stay well inside the mechanical release stroke.

**3. `LAMP-THERMAL-R` repurposes an existing constant** (**O-E12**). `lamp_thermal_tau_ms = 40` is
already in `components.md` §9.3, but only as a *display* filter; §3.4 makes it the filament's
electrical time constant as well. No new number, but a new role, and it changes observable
behaviour: lamps now cross `dim` on their way to `on` in every golden, and the cold-lamp inrush is
real. It replaces a four-pass damped fixpoint whose start value, damping form and 2.8% residual
were all unspecified and larger than the decision margins the design claims sensitivity to.

**4. AT-02 was unsatisfiable in W1's tested parameter region.** No `L_coil` in 0.3–5.0 H satisfied
AT-01, AT-02 and AT-11 jointly; the controls did not establish a supported causal account. That is
finding (b), not an invitation to tune another constant. Both counters still ship with the
unresolved-mechanism note by the canonical `DECISIONS.md` ruling, and `lamp-in-coil-path` may report
the verified topology without claiming why the physical counter was marginal.

**5. Marginal fixtures are the least portable artifacts in the suite.** Stated in §0 and repeated
here because it is the design's real cost. The KAT layer is what turns "the port disagrees" into
"the port's arithmetic differs" or "the port's physics differs".

**6. The netlist is hand-transcribed.** 186 terminals typed from a prose file. Four gates (§2.3),
of which gate 3 is honestly a slip-catcher rather than an independent check, since the same hand
authors it from the same file in the same wave. `II-EXP5`/`II-EXP6` catch the isolation class of
error. A quietly-wrong matrix junction would survive all of them — accepted, because the matrix has
nothing behind it.

**7. `MV601-TIMING-A`'s shipped defaults are known broken and someone has to replace them.** The
replacements will be invented. Every one carries `[unverified]` in the profile JSON and in the
provenance string. This is a scheduling risk, not a design risk: the assertions are what make it a
day of arithmetic rather than a month.

**8. Fixture authoring used the settled hand-author fallback because G4 is absent.**
`programs.json` does not exist. Phase 1 hand-authored its fixture seed from `programs.md`
§2.2–§2.3 with the errata applied first. Clerical, not research, and a fixture built on an
un-errata'd wire list encodes SDC's typos — which is what the positive `errata_applied` test
exists to catch.

**9. Tier C2 has no ground truth, and the dial's drive rests on three fitted constants.**
`R1_uohm`, `R2_uohm` and `R_arm_uohm` are invented and coupled: they exist to set the ratios between
the documented drive conditions, and they are chosen so condition 1 yields `run_mrpm = 45`, itself
an assumption (O-R3). §5 says this in those words rather than calling it emergent. C2 fixtures always
carry a reviewed digest (§9.3). Since D1 (§13.5.1) they may also carry `expect` and `until` steps.
One based on a fallback must carry `tag:"unverified"` and a `FALLBACK-*` source, which
`--list-fallbacks` reports and which does not by itself make the fixture `printed`.

**10. Text-diff conformance is brittle by design.** A deliberate change to the trace format
invalidates every golden at once. Contained by the `#!mv601-trace 1` version line, by the `# rules`
header line that pins the derived integers, and by the fact that re-blessing cannot pass if a cited
assertion broke.

**11. Freezing the state schema before Phase 2 knows what the console needs.** Mitigated by making
the *trace* the hardest-frozen artifact, the *snapshot* additive-only on a minor bump, and new
observables append-only. The failure mode actually expected is the console wanting a derived
quantity and someone adding a method to `Machine` instead of a field to `State`. The import lint
catches it. Building the notes pane in Phase 1 is deliberate: if the causal channel is too thin,
that is a schema change and it is far cheaper to find now.

**12. Capacitors and motor dynamics are absent from 1.0 and 1.1, not reserved.** Book VII's capacitor
programs and any assertion on the motor need a 1.2 bump — a new element in `netlist.json` (a new
netlist hash and a re-bless of every golden), `caps[]` on the snapshot, and `v_cap` in the carried
state. That is the price of not shipping a flag that mutates a frozen array or a frozen field with
no equation behind it. It is paid once, in the wave that first wires a Book VII program.

---

## 15. Rejected

> **2026-09-03:** "the frozen Unity contract" reads "the frozen engine contract" — §13.6.1.

**Boolean or hybrid connectivity core.** Settled by `DECISIONS.md`. Recorded here to note that no
fast path sneaks it back in: there is no boolean shortcut for "simple" circuits, because the
shortcut is the thing that would silently disagree with the port. `AT-02.discriminator` is the test
that enforces it.

**A permanent `R_coil_shunt` to get both release rates from one constant.** Elegant and wrong: it
perturbs the DC divider by 20–50% at any value inside the 2–5× band and breaks AT-01. The
backward-Euler companion is already a finite conductance, so the degeneracy it was invented to fix
does not exist.

**A settling fixpoint inside the tick** (`components.md` §8.4 steps 5–6). Deleted: at 100 µs the
tick *is* the fixpoint. Removes an iteration cap, a damping rule, a convergence tolerance and a
non-convergence error path, all portability hazards. Guarded by the load-time tick assertion. The
arc pass is a fixed second solve, not an iteration.

**The four-pass damped lamp loop.** Deleted in revision 2 in favour of a carried filament
resistance (§3.4): fewer lines, an exact DC operating point instead of a 2.8% one, a real cold
inrush, and three unspecified things (start value, damping form, residual) that stop existing
rather than getting specified.

**Event-driven or variable timestep.** Fewer solves; a determinism minefield. It makes the C# port a
scheduler port and turns a trace's timestamps into floats.

**The idle-skip optimisation and the topology-signature LU cache.** Both are second execution paths
that can diverge, bought against an unmeasured performance fear. 167 tiny LU solves per frame is
free.

**A seeded PRNG for the per-relay spread.** Six relays, six literals. Deletes an entire class of
port bug — multiply semantics, seeding, consumption order — for the cost of six numbers.

**`Math.pow` for the tungsten lamp law.** Not required to be correctly rounded; V8 and .NET disagree
in the last ulps, and lamp resistance feeds coil current, which decides contacts.

**Generating the netlist by parsing `jack-map.md` at build time.** A markdown parser as a build
dependency for data written once, over a research file that will keep being edited, with a silent
failure mode when the table formatting shifts.

**TypeScript literals for the profile and the netlist.** The brief's explicit anti-pattern: the C#
port re-types the largest correctness surface in the project by hand, and a measurement session
edits source in two languages instead of replacing one data file.

**Tolerance-based trace comparison** (`abs(a−b) < eps`, or a tick window). A tolerance wide enough
to absorb float drift is wide enough to absorb a real bug, and it only ever grows. Replaced by
integer quantization plus the bless-time gate.

**Voltages in the golden trace.** Converts every fixture into a floating-point equality test.
Analog fidelity lives in the probe set instead — tested once each, deliberately.

**`expect` and `mark` as command kinds.** Conformance concepts in the frozen Unity contract.

**`press`/`release`/`hold` as three kinds, and a non-physical `dialSet` teleport.** One
target-valued command covers the first three; a teleport past `D8` in the Combination Lock is a
fixture testing nothing.

**Snapping the dial to integer positions.** Kills the D6/D7 hang, the Combination Lock trap, and the
Book VII pulse train — three primary-sourced behaviours for one convenience.

**A dynamical motor model** (`k_t`, `J`, viscous friction, back-EMF, conductance-scaled braking).
Revision 1 claimed the behaviours without the equations or the constants; the honest repair was
either to write them or to delete the claim. Writing them means inventing three more constants to
back-solve an unsourced 45 rpm, which is the fitted-constant pattern this project rejects by name.
§5 ships the rate law and the two coast angles the research itself recommends, and says which
constants are fitted.

**Capacitors at 1.0/1.1, and the `FITTED-CAPS` flag** (§2.1, §14 risk 12). The flag mutated the frozen
element array, which changes stamp accumulation order and every golden byte, and contradicted §11's
"no second code path". Books I–VI contain no reactive element and no Phase 1 fixture touches one.

**Modelling the AC side and the rectifier separately.** Per O-E8 the forward drop is already inside
the measured ~13 V open-circuit reading; modelling it separately double-counts it.

**Modelling the POWER lamp, ON/OFF switch and breaker as netlist elements.** They have no jacks.
The breaker is a boolean gate on the source element, and it kills every rail at once, which is right
because it sits in the negative return.

**Stamping every contact and ordinary cord as the profile's 0.05 Ω / 0.02 Ω resistance.** That
would force the large solve on every circuit to model a drop three orders below anything
observable. It remains rejected. A user cord with explicit positive `r_uohm` is the separate Book
VII mechanism frozen in §§3.1 and 7.

**A matrix library, a device/plugin registry, an event bus, a DI container, a `Net` type, a relay
class hierarchy.** Six relays, 22 elements, 10 commands. Data tables and one `advanceMover`
function. Any of these would be the thing that sinks the design.

### 15.1 Considered and not taken — review findings answered rather than applied

**A minimum-consecutive-ticks requirement before `dir` latches to +1.** Proposed alongside the arc
clamp to protect the pull-in decision from a single-tick numerical excursion. **Still not taken —
but the justification this section carried through revision 2 was false, and is replaced here
rather than deleted.**

*What it said:* "the clamp already bounds `Δi_coil` to `V_arc·Δt/L` (2.5 mA/tick on the shipped
numbers) in *both* directions, so the excursion the debounce would filter cannot occur." Both
halves fail. The step is not `V_arc·Δt/L` — the companion adds the L/R decay and the measured
figure is **3.436 mA** (§3.3). And a bound on `Δi` would not stop the excursion becoming a relay
operation: §4.3's rule is that an armature **strictly between the stops continues**, and the
post-excursion current sits inside the band, so the stroke **completes**. A one-tick excursion does
not reverse itself, and there is no debounce anywhere in the design to make it do so. Measured on
§4.3's own travel model, armatures starting released and coils seeded at or below pull-in, the
**shipped** solver completes **144 / 378** two-coil and **1,968 / 11,907** three-coil spurious
operate strokes on the Gate A0 seed grid. **The measurement
condition those two counts did not carry on their own:** `dV_relay_mv` was **zeroed** for them —
that was `MV601-IDEAL`, the identical-relay control, **not** the then-shipped W1 `MV601-REF-A`
default, whose six offsets moved every threshold the counts were taken against. At a live junction
**on that same bench** the excursion was not one tick at all — the series pair latched and stayed
latched for all 5000 ticks measured, and the two-coil sweep contained 46 permanent spurious latches
— so a minimum-consecutive-ticks test would have passed every one of them through. That established
such a test was **not sufficient** on that population; it did not establish that a debounce was
unnecessary, and that population was the hand-seeded one the *Two populations* paragraph below ruled out.

*Why the decision stood anyway:* because the artifact a debounce would have filtered **changed no
relay decision**, measured at nine values of `L_coil` spanning §4.4's whole indicative band, not at
the then-shipped value alone. Not because the state was out of reach, which was what the superseded
justification claimed and which was false.

**Two populations, and they must not be blurred.** The Gate A0 seed grids above were hand-seeded
current vectors — a dead coil carrying 86.3 mA — and *those initial conditions* were not ones the
machine produced; that was the one half of the old argument that survived. The population that
decided this was the corpus census, which started every configuration from a **self-consistent
settled DC state** and drove it through a real contact transfer. On that population the defect's
own topology **was** reached. Published programs did put two coils in series through a bare node at
mismatched currents: **80** of the
**32,496** transfer configurations on the *at most one pushbutton down* axis, in `II-FF1` — the
corpus's own primary timing fixture — and in `V-EXP10`, `V-EXP13` and `V-SUPERCIRCUIT`; **1,122** of
the **217,872** on the *all 64 pushbutton combinations* axis, which `I-EXP4`'s
printed *"push down both pushbutton 1 and pushbutton 2 at the same time"* made a real axis rather
than a hypothetical one. The Wave-A run put every one of those through §4.3's 12-tick both-open
window, landed the armature, settled 3,000 ticks, and compared each coil against the landed
netlist's own DC solution:

| | 0 or 1 button | all 64 button combinations |
|---|---|---|
| configurations that reached a mismatched bare two-coil node | 80 of 32,496 | 1,122 of 217,872 |
| of those, that settled away from the correct DC answer | **0** | **96** |
| **of those, where a relay decision differed from the DC answer** | **0** | **0** |
| worst coil error against DC | 1.31839e-12 mA | **3.04101 mA** |

**Historical Wave A result, under the then-shipped W1 REF-A vector: across 217,872 configurations
the defect was reached and moved no relay decision** — at every one of nine `L_coil` values across
§4.4's band, not only at the then-shipped one. That was the whole argument, and the margin belonged inside it rather than under it:
**3.04101 mA was 7.0% of the 43.333 mA pull-in.** Real, not large — and it was the band's **worst
case**, not a lucky sample. What was still not guaranteed was a different `dV_relay_mv`: that
constant was `[unverified]`, was **not** swept, and `MV601-REF-A`'s own note put its offset vector under
suspicion. The then-shipped W1 vector was applied to the Wave-A census once — 0 relay decisions
differed there too, on both axes, at a 2.7x smaller all-64 margin.
**Current Wave D result:** the replacement D vector was applied at both threshold-selection sites.
At 1.2 H both axes again have zero decision flips; the all-64 perturbed-coil population is 368 with
minimum headroom **0.134934 mA**, and the at-most-one population is empty (`n/a`). The §4.3
instrument crossed nominal/D with 0.9/1.2/1.5 H and settle-only/window+settle: all 24 axis-results
have zero final-travel and contact differences, with tightest observations 18/120 operate and 52/80
release. This is the current simulator bound under an `[unverified]` convention, not a physical
mechanism claim; the surrounding old-vector paragraphs remain historical evidence.
A debounce would have added a profile constant, a per-mover counter, and a systematic delay on
every legitimate pull-in — paying in every fixture to filter an artifact that moved nothing
observable. **The latching case did less work than this section once gave it.** On the hand-seeded
bench a live junction made the pair **latch**, and a minimum-consecutive-ticks test passed that
straight through — which showed such a test was **not sufficient** there, never that a debounce was
unnecessary, and that bench was the population the *Two populations* paragraph above ruled out. On
the corpus the same sentence was true and empty: the **96** configurations that settled away were
permanently offset in **current** and produced **no spurious decision at all**, so there was nothing
there for a debounce to pass through. The corpus artifact was the **filterable** kind rather than
the latched kind — its historical Wave-A disagreeing runs were short, 2–6 ticks operate and 26–39
release at nominal across 0.9–1.5 H, 20 / 54 at the then-shipped W1 six thresholds — which is
exactly the class a minimum-consecutive-ticks test would have caught, and exactly why no stroke
moved. **The decision was carried by the first leg and the third:** no relay decision differed at a
measured bound, and a debounce cost a constant, a counter and a delay on every legitimate pull-in.
That was a defeasible engineering call under a stated bound, not a derivation from the legs. The KAT
case the finding asked for (series junction, `i1p = 86.3 mA`, `i2p = 0`) is in the 20 regardless,
and is what would catch this being wrong. **Re-open this decision if the bound moves** — a
re-measured census, a changed `dV_relay_mv`, or an `L_coil` outside §4.4's band.

**Pinning the lamp loop's start value and raising its pass count.** Superseded rather than rejected:
§3.4 deletes the loop. The finding's diagnosis — that the residual is 2.8% on coil current, larger
than the margins the design claims sensitivity to, and that warm and cold starts differ by more than
the effect being modelled — is what motivated deleting it.

**Fully-qualified `HoleId`s in fixture `wires`.** The alternative offered for §2.4's gap. Not taken:
it makes a wire list unreadable against the printed page it is transcribed from, and it would have
to be re-derived by hand for ~30 fixtures. A normative allocation rule (lowest free hole, 1-based,
wire-list order, exhaustion is an authoring error) is one sentence, is covered by a netlist-KAT
case, and keeps the fixture readable. §2.4's principle is about resolving an *ambiguous source*
once; hole indices are not in the source at all.

**Moving `minDecisionUa` / `minTickGap` out of the diffed header into a side-car.** Not taken: they
are defined instead (§9.3). A margin a reviewer cannot see at the top of the artifact is a margin
nobody reads, and both quantities are now integer and deterministic, so they diff safely.

**Deleting `flags.nonPortable` along with the matrix cap.** Half taken. The cap is deleted and the
bound derived (§3.1) — the finding is right that an error path for a case the architecture argues is
impossible is either dead code or an undocumented limit. The flag survives on the hazards it can
actually catch: NaN, ±Infinity, and a saturating quantize (§3.5), which are real and which a port
can hit where the reference does not.

**Cutting `CordEnd.free` with `moveEnd`.** Half taken. `moveEnd` is cut. `free` stays: it is the
play wire's *resting* state — one end plugged, the other in the operator's hand between touches —
and without it a play wire has to be disconnected and reconnected to be put down, which changes
`cords[]` and the trace. W7 exercises it so it is not frozen untested.

**The claim that the discriminator's boolean half is outright false.** Plausible and not verified
here: the two wire lists were not walked terminal by terminal against `programs.md` §2.3 for this
revision. That is exactly why §9.5 moves the boolean walk to **W2**, where it costs an afternoon,
rather than leaving it as a W6 acceptance gate that fails five waves later for a reason nobody
predicted.

---

## 17. The six rulings Tom made

Everything else in this document was decided in the writing. These six were not mine to settle, and
all six are now settled — `DECISIONS.md`, *2026-08-30 — architecture approved* ("I agree with all").
The ruling leads each item; the reasoning behind it is kept, because the numbering is cited from
§3.4, §4.3, §10.1 and §14 and because a later reader needs to know why each went the way it did.

1. **`L_coil` goes on the record as O-E10.** Ruling: the constant is filed as a new
   `open-questions.md` entry (**O-E10**) and lives in `data/profiles/*.json` tagged `[unverified]` —
   never in the research prose nor as a constant in code. Adding a constant beyond the research
   package means editing `open-questions.md` and naming a superseding profile; the research files
   are the record, this document did not edit them, and that edit has since landed.
2. **`V_arc_clamp_mv` and the `lamp_thermal_tau` promotion go on the record the same way.** Ruling:
   `V_arc_clamp_mv` is filed as **O-E11** (`ARC-CLAMP`) and the promotion of `lamp_thermal_tau` from
   a display filter to the filament's electrical time constant as **O-E12** (`LAMP-THERMAL-R`), both
   `[unverified]` in the profile. Both are corrections to unphysical behaviour rather than
   embellishments — the first replaces a 1 kV discretization artifact, the second replaces an
   unspecified fixpoint loop — but both change what the simulator does, and recording them is what
   keeps them from being read as findings later.
3. **Phase 1 hand-authors the tier-A fixture seed set.** Ruling: hand-author ~30 fixtures now and
   let the G4 merge supersede them. Hand-authoring means transcribing some wire lists twice; waiting
   means Phase 1 has no conformance suite, which is not a Phase 1.
4. **The W1 finding (b) case is settled.** The canonical 2026-09-01 `DECISIONS.md` ruling governs:
   both counters ship, the public note says the simulator did not reproduce the proposed cause, and
   the available evidence leaves the physical mechanism unresolved. Tuning until it works is not
   an outcome.
5. **The replacement timing numbers are published in `data/profiles/` with `[unverified]` tags, not
   by amending the research file.** Ruling: `data/profiles/` is the right home. The break/make
   fracs, the release constants and the µs-not-ms profile convention all change `MV601-TIMING-A`'s
   published block, and `components.md` §9.3 says its own defaults fail two of its own constraints,
   so something had to change — but the replacement numbers are invented and will be cited by future
   readers, so they stay where they are replaceable and tagged. The research file keeps its reading
   and carries a superseded-by note. This also covers adopting `relay_bounce` at zero rather than
   deleting it.
6. **Capacitors and motor dynamics are out of contract 1.0 and 1.1.** Ruling: out. §2.1 and §5 remove six
   elements, a config flag, a carried double and a state field that no Phase 1 fixture touches, at
   the price of a 1.2 minor bump (and a re-bless of every golden, since the netlist hash changes)
   whenever someone wires a Book VII program or asserts on the motor. It was a scope call, not a
   technical one, and the simplicity rule won it.
