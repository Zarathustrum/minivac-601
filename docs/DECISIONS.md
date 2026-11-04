# Decisions

Tags: `[settled]` respect on sight · `[proposed]` awaiting Tom's confirmation · `[open]`.

## 2026-08-30 — Tom's answers to the Step 0 questions

- **Unity strategy: TypeScript reference core + frozen schemas + golden conformance suite**
  `[settled]` — a C# port implements the same JSON command/state schemas and must pass the
  same fixtures. No JS-in-Unity, no socket bridge.
- **Fidelity: relay-level, discrete-time tick** `[settled]` — coils energize and de-energize,
  contacts transfer, lamps light, the rotary steps. Not a boolean net solve.
- **Scope: Minivac 601 only** `[settled]` — the 6010 is a labelled deferral, not a target.
- **Feel: period-accurate flat for Phase 2** `[settled]` — correct panel art, relay and
  ratchet sound, static patch cords. Cord physics, layered audio and lamp bloom are the
  3D version's job.
- **Demos: the full candidate set** `[settled]` — binary counter, tic-tac-toe, dating
  machine, dice, logic-gate demos, burglar alarm, two-relay flip-flop.
- **Audience: public** `[settled]` — strangers who have never seen a patch panel. Sets
  tutorial and help depth. Public deployment still requires Tom's explicit approval.
- **No physical artifacts** `[settled]` — no unit, no personal manuals. Everything is
  reconstructed from web scans.

## 2026-08-30 — existing emulator

- **Oracle only** `[settled]` — Greg Sadetsky's TypeScript browser simulator (no declared licence)
  (November 2025) is not read. Not its source, not its repository. We build from the
  manuals and use the running app as an external behavioural cross-check only.
  *Why:* it is our project with a year's head start; reading it would make our core
  derivative and the Unity port would inherit that. The point of this project is a
  relay-level core with a frozen schema and a golden suite that survives into Unity.
  Alternatives considered and rejected: study-first (faster, contaminating) and
  ignore-it (throws away a free second opinion).

## 2026-08-30 — research and process

- **Research before code** `[settled]` — a primary-source package in `docs/research/`,
  adversarially verified, before any simulation code. The jack map is the netlist spec.
- **Model policy** `[settled]` — provider-neutral roles with dated provider mappings, kept in
  the private repo's `CLAUDE.md` (the public copy omits them). The main orchestrator owns integration and commits; adversarial reviewers use the
  strongest worker configuration; complex work uses a flagship worker; mechanical work uses a
  balanced or cost-optimized worker only when its output is checked deterministically. Every
  subagent call specifies the provider's available model and, where supported, reasoning effort.

## 2026-08-30 — marginal-failure modeling (after Step 1 research)

- **Solver class: DC resistive-network, not boolean connectivity** `[settled]` — forced by
  primary evidence, not preference. The relay indicator lamp is wired in SERIES with its
  coil (`nC —lamp— nE —coil— nF`), so driving `C–F` under-volts the coil while `E–F` gives
  it full voltage with the lamp dark. SDC's own errata publishes an alternate three-bit
  counter whose stated purpose is to "by-pass the relay indicator lights so that full
  voltage is supplied to the relay coils, causing them to pull in more reliably" — the only
  relay failure SDC ever documented, and a voltage-divider effect a boolean core cannot
  express. Book VII independently documents relay hysteresis (a bi-stable band between
  pull-in and drop-out) and builds bias-resistor circuits on it. A net is therefore a node
  in a conductance graph, never a boolean equipotential class.
- **Marginal-failure behavior ships ON by default** `[settled]` — Tom: "yea i like both
  with on by default." A user wiring Book IV's counter straight from the manual watches it
  mis-count, exactly as a 1961 owner did. A toggle disables it for people who just want the
  machine to work.
- **Both counters ship as demos** `[settled]` — Book IV's original marginal counter and the
  errata's 48-connection bypass counter, side by side. The failure is the most interesting
  thing in the manuals; the pair is what makes it legible rather than baffling. Given the
  public audience, the help layer has to explain what just happened.
- **Fallback profile `MV601-REF-A` is a knob, not a finding** `[settled]` — no primary
  source states any timing or analog quantity, so the numbers (13.0 V open circuit, 0.67 Ω
  source, 150 Ω coil, ~131 Ω lamp, 6.5 V pull-in, 2.5 V drop-out, ±0.7 V per-relay spread)
  are a named, documented default with pull-in placed just below the lamp-divided rail so
  rail sag can push a marginal circuit across. Everything else is scale. It lives in
  `docs/research/open-questions.md` and must never be presented as measured.

## 2026-08-30 — architecture approved (Tom: "I agree with all")

Phase 1's seven plan bullets are approved (Phase 1 is built), and the six items in
`docs/plans/architecture.md` §17 are settled; §17 carries each item with its reasoning.

- **Three invented constants go on the record as open questions** `[settled]` — `L_coil`
  (**O-E10**), `V_arc_clamp_mv` (**O-E11**), and `lamp_thermal_tau` promoted from display
  filter to the filament's electrical time constant (**O-E12**). None appears in any primary
  source. Recording them is what keeps them from being mistaken for findings later.
- **Invented constants live in `data/profiles/*.json`, tagged `[unverified]`** `[settled]` —
  not in the research files, and never as constants in code. The research files record what
  the sources say; the profile holds what we invented, where it stays replaceable.
- **If the physics proves jointly unsatisfiable, ship the counter pair with a printed note**
  `[settled]` — not hold the demo. Holding it throws away the most interesting thing in the
  manuals; a note is honest about an unresolved mechanism. Consistent with the standing
  ruling that both counters ship.
- **Capacitors and motor dynamics are out of contract 1.0** `[settled]` — six elements, a
  config flag, a carried double and a state field that no Phase 1 fixture touches. This originally
  reserved the 1.1 minor bump; the 2026-09-02 ruling below supersedes only that version number and
  moves the excluded dynamics to 1.2. A re-bless of every golden remains required whenever someone
  wires a Book VII program. Simplicity rule wins.
- **W1 is a spike with a written kill criterion** `[settled]` — it ends in
  a findings report with either an `L_coil` value and its acceptance
  table, or a demonstration that no `L_coil` satisfies AT-01, AT-02 and AT-11 jointly. In
  the second case **the plan stops at W1** and comes back to Tom before W2 begins. Finding
  (a) is not earned if a control reproduces the counter failure without the timing
  mechanism. Tuning until it works is not an outcome. W1 returned finding (b); see
  *2026-09-01 — canonical marginal-counter ruling after W1*.

### Why the kill criterion exists

The first synthesis made the Book IV counter fail by shipping
`dV_relay_mv: [300,-240,290,-110,250,-170]` — six literals whose signs were reverse-
engineered so that exactly the three lamp-fed relays fail. It read as physics and was
curve-fitting. An adversarial reviewer caught it. The replacement mechanism is honest but
unproven, so W1 proves it before anything is built on top.

## 2026-08-30 — Phase 1 Wave 1a spec readings (orchestrator)

Orchestrator working choice, not Tom-approved.

Where architecture §3 contradicted itself or the code, the Phase 1 orchestrator took these
readings. They are its working choices, not Tom's rulings; the solver, the KAT and their tests
implement them.

- **The arc clamp bounds current-carrying coils only** `[settled]` — `Garc = |i_prev|/V_arc`
  (§3.3), so a coil carrying no current gets zero arc conductance and is unclamped: the
  `arc-clamp-series-junction` KAT case solves its middle node to 40.67 V against a 30 V clamp. The
  criterion is that no current-carrying coil branch exceeds the clamp, and that a dead coil in the
  series-junction idiom never reaches any relay's pull-in (it lands at 3.35 mA against 43.333 mA).
  This is a defect in O-E11's stated mechanism. It is not repaired with an invented floor
  constant, which would be a new number fitted to make a sentence true.
- **`V_arc/L` per tick is the arc term alone** `[settled]` — the companion gives
  `Δi = (V_arc·Δt + i_prev·R_coil·Δt) / (L + R_coil·Δt)`: the arc ramp plus the L/R decay, about
  2.47 + 1.07 ≈ 3.44 mA per tick on the shipped numbers (the two arc KAT cases measure 3.4363 and
  3.3475 mA). The code is the physics; "ramps down at `V_arc/L` per tick" in §3.3, §4.2 and O-E11 is
  shorthand, and the true open-release ramp is about 40% faster than it says.
- **The solver KAT has 21 cases** `[settled]` — §3.5 says "20 cases" and then enumerates 21 (three
  PWL cases plus three whole-panel snapshots). The enumeration wins; the count was decorative.
- **`gmin` is stamped first** `[settled]` — on every solved diagonal, before any element. §3.1.5
  does not fix the order, and `(gmin + G_coil) + G_src` differs from `(G_coil + G_src) + gmin` by
  one ULP on the shipped divider row, so the order is part of the port contract
  (`docs/port/CSHARP-PORT.md`).
- **A doubly-pruned coil ramps at the arc rate** `[settled]` — §3.1.4 leaves the current of a coil
  whose feed and return contacts have both opened undefined. The code ramps it at the arc rate. This
  is the both-ends-open case, not §4.2's single-open release row, which the matrix handles.
- **The no-allocation rule covers the stamp/solve path** `[settled]` — §1.1's tick-loop ban is read
  as covering stamping and solving; the result object `tickSolve` returns is allowed.

## 2026-08-31 — O-E11 arc-pass latch: accepted and documented (Tom's ruling)

- **Accept the defect and document it** `[settled]` — Tom's ruling, 2026-08-31. O-E11's arc pass
  stamps `Garc` as a parallel shunt, so two coils in series through a bare node can latch at
  mismatched currents (the `it.fails` "DEFECT (O-E11)" case in `test/solve.spec.ts`, cited by test
  name). Nothing is repaired: no arming change, no Δi bound, no KAT re-bless, no new constant or
  profile key, no test inversion. The `it.fails` stays failing and machine-checked.
- **The ruling rests on a measured bound, not on unreachability** `[settled]` — the orchestrator's
  re-basing, the same day. The ruling was given on the premise that the state is unreachable; the
  corrected census then showed it is reached (II-FF1, V-EXP10, V-EXP13, V-SUPERCIRCUIT). The ruling
  stood; the premise did not. What holds is that no relay decision differs from the landed
  netlist's DC answer. The claim that ships is a measured bound with a stated margin — worst coil
  error 3.04101 mA, 7.0% of the 43.333 mA pull-in — never an absence and never "harmless".
- **The defect is the placement of `Garc`, not its arming** `[measured]` — the orchestrator's
  finding. An oracle-exact arming criterion reproduces the shipped latch bit for bit
  (46.109272 / 40.341545 mA). The arc belongs in series across the opened gap, and §3.1's node model
  gives the netlist no gap; that is an architecture change, identified and not adopted. Every repair
  measured restored §4.2's revision-1 defect on reachable states: a 45.58 mA one-tick coil collapse
  and 547 V on a panel jack, where the shipped solver holds 2.90 mA and 38.3 V.
- **Re-measure when a constant moves** — the orchestrator's rule. Nothing guarantees the bound
  under a different `dV_relay_mv` or `L_coil`, both `[unverified]`. `npm run check-reachability` is
  the source of truth for every count in this family and is re-run whenever either moves. The bound
  was measured at nine points across architecture §4.4's 0.9–1.5 H `L_coil` band (0.9, 1.0, 1.1,
  1.2, 1.3, 1.35, 1.4, 1.45, 1.5 H), with 0 relay decisions differing at each: "measured at nine
  points", never "proved for all `L_coil`". The travel model is the instrument of record; its
  tightest corner is the shipped six thresholds, window plus settle, 1.5 H — 20 operate / 54 release
  ticks against the 120 / 80 strokes, a 1.48x release margin, and the figure to watch if any
  constant moves.
- **Scope and open leads** — the orchestrator's working choices. The census is a single-transfer,
  frozen-topology model: one transfer, one topology (armatures moved in 962 of the 1,122 hit
  configurations, identically in both arms). Gate A0 never exercised a coil any openness test could
  classify open, so any future gate here must include a feed contact opening mid-run from a settled
  state. If an arming criterion is ever wanted, the measured candidate is `S2 / KCL-BAL-UA`:
  oracle-exact over 400k circuits, 0 corpus misclassifications, no frozen KAT case moved, +30.7% on a
  settled-panel tick — and it does not fix the latch. Not scheduled.
- **Superseded the same day** — Tom's first ruling after Gate A0 was to repair the arming criterion
  and pair it with an explicit Δi bound on carried coil current at live junctions. The bound was
  then measured dead in all four specified shapes, and the ruling above replaced it.

## 2026-09-01 — canonical marginal-counter ruling after W1

This is the canonical statement for the simulator's treatment of the Book IV counter and
`ER-ALTCOUNTER`. Where older text conflicts, this ruling governs: it preserves the shipping
decisions while superseding their causal explanation. Other documents point here; they do not
restate that explanation.

- **The proposed carry-race/timing mechanism is not reproduced by the shipped model** `[settled]` —
  W1 returned finding (b). Across the tested `L_coil` range, no value satisfied the named
  acceptance set jointly, and the modeled counter pair provided no observable button-hold window
  that distinguished the lamp-fed circuit from the bypass circuit for the proposed reason. The
  tested implementation therefore does not support that causal account.
- **The refutation is implementation-scoped** `[settled]` — it refutes a claim about what this
  simulator computes. It does not refute hypotheses about timing, relay variation, contact
  transfer, or other behavior in a physical MINIVAC 601. The corpus has no measurements capable of
  settling those real-relay hypotheses.
- **ER-21 remains primary-source evidence** `[settled]` — SDC states that the Book IV counter
  strains relay capabilities; relays satisfactory elsewhere may perform inadequately in that
  circuit; and the alternate circuit bypasses the relay indicator lights so full voltage reaches
  the coils, causing them to pull in more reliably. Those are verified claims about SDC's
  published circuit and remedy. W1 neither withdraws nor rewrites them.
- **Both counters still ship, with the mechanism unresolved** `[settled]` — by Tom's ruling, the
  public demos retain the Book IV counter and `ER-ALTCOUNTER` side by side. Their public explanation
  must say that SDC documented the original circuit as marginal and supplied the bypass circuit,
  while this implementation does not reproduce the proposed cause. The pair is not held pending a
  mechanism the available evidence cannot establish.

### May state

- SDC documented the Book IV counter as marginal on real hardware and supplied
  `ER-ALTCOUNTER` as the remedy described above.
- The two published programs differ electrically: the alternate bypasses the relay indicator
  lamps and supplies full voltage to the relay coils.
- W1 tested the proposed simulator mechanism and did not reproduce it.
- W1's result is evidence about this implementation, not a bench measurement of a MINIVAC 601.
- The public counter pair remains by Tom's ruling and carries an explicit unresolved-mechanism note.

### May not state

- The shipped model reproduces the proposed carry-race/timing explanation.
- The modeled Book IV counter fails for the same physical reason that led SDC to publish ER-21.
- `L_coil`, lamp-fed operation, or their modeled interaction causes the documented counter
  marginality.
- W1 disproved timing, relay-variation, contact-transfer, or other hypotheses about real relays.
- W1 weakened, contradicted, or superseded ER-21's primary-source claims.
- The counter pair establishes a resolved causal story; its mechanism remains open.

## 2026-09-01 — Wave C: registered counter-pair measurement (orchestrator)

Orchestrator working choice, not Tom-approved.

- **What it is** — a preregistered measurement of the Book IV counter (`IV-EXP1`, 44 wires) and
  `ER-ALTCOUNTER` (48 wires) as literal wire lists, run by `npm run check-profile -- --counter`
  (`tools/stamp-counter.ts`, the Wave C section of `tools/check-profile.ts`, `test/counter.spec.ts`).
  The orchestrator registered the protocol before the tool existed: the literal arrays and their
  terminal grammar, Gate T (the 22-element contact/stamp oracle), Gate P (it refuses a bare two-coil
  super-node), the C-B, Q1 and Q2 predicates, and the Z/S/R/N offset vectors. The tool pins its
  source files by bytes and MD5.
- **Outcome (a)** `[measured]` — Gate T matched; Gate P reported 34 VALUE / 0 REFUSED. C-B's minimum
  signed expected-state margin was 1,509 µA, with both source maxima 719,426 µA < 818,779 µA. Q1
  passed every Z/S/R/N crossing at both registered inductances, smallest delta 12,427 µA > 1,000 µA.
  Q2 passed 6/6 structural rows; its representative comparison was 2,779 µA at t=67
  (1,200,000 µH) and 5,075 µA at t=2 (12,000 µH). The report is 447 lines and deterministic. These
  are modelled properties of the two wire lists, not a physical causal explanation: the canonical
  counter ruling above governs, and O-E1 stays open.
- **Still live** — Wave D's identity report (`runD` in `tools/check-profile.ts`, run by
  `test/check-profile.spec.ts`) takes its rows from Wave C's Q1 computation, so Wave C stays in the
  tree.

## 2026-09-01 — Wave D relay-threshold convention and reachability policy

- **D1 — fixed profile convention** `[settled]` — with physical section order `n = 1..6`,
  `A = 282 mV`, and sign-symmetric nearest-integer `sround5`,
  `dV_relay_mv[n] = sround5((2*n - 7) * A)`. `A` is the greatest non-negative whole millivolt
  for which `46218 - idivRound((6500 + A) * 1000000000, 150000000) >= 1000`; it uses the dated
  inputs `V_pullin_mv = 6500`, `R_coil_uohm = 150000000`, `min_decision_ua = 1000`, and AT-01's
  settled coil current `46218 uA`. The output is `[-282, -169, -56, 56, 169, 282]`, with derived
  pull-in thresholds `[41453, 42207, 42960, 43707, 44460, 45213] uA` and drop-out thresholds
  `[14787, 15540, 16293, 17040, 17793, 18547] uA`; the strictest pull-in threshold remains
  1,005 uA below that current.
  The rule is a sign-symmetric simulator convention, not a relay measurement. Physical section
  order, the linear ramp, and every resulting offset remain `[unverified]`; no source establishes
  that real relays varied monotonically, symmetrically, or by these amounts.
- **D2 — public authority** `[settled]` — Phase 2 renders exactly this public copy:

  > **SDC supplied a second wiring for this counter.**
  >
  > SDC's errata warns that Book IV's three-bit counter can strain the relays, and adds bypass paths
  > so the relay coils receive full voltage and pull in more reliably. Both published wirings are
  > included here.
  >
  > The simulator's six relay thresholds use an unmeasured fallback. The available evidence does not
  > establish why the physical counter was marginal, and this simulation does not claim to reproduce
  > that cause.

  The separate maintainer-facing fixture string is exactly:

  > Profile-dependent accepted margin: `dV_relay_mv`. SDC documented the original counter as marginal
  > and supplied `ER-ALTCOUNTER`; this fixture does not identify the physical cause. Authority:
  > `docs/DECISIONS.md`, “2026-09-01 — canonical marginal-counter ruling after W1”.
- **Reachability default — NO** `[settled]` — permanent reachability remains nominal. The shipped
  `npm run check-reachability` gate retains one nominal pull-in and drop-out threshold for all six
  relays; its header identifies that stable identical-relay acceptance baseline, not the exact
  REF-A machine. The D-vector endpoint and travel runs are mandatory recorded sensitivities, not
  the permanent gate default.
- **Measured sensitivity under D** — with the D vector applied, the all-64-combination census
  shows 0 relay decisions differing (perturbed population 368, minimum headroom 0.134934 mA), and
  the travel instrument's 24 axis-results show no travel or contact difference (tightest 18/120
  operate, 52/80 release).

## 2026-09-02 — W4 source-driven Contract 1.1 and V-EXP1 ruling

- **Manual relay control is Contract 1.1** `[settled]` — Book I Experiment 6 requires the operator
  to push relay 1's plastic crossbar by hand, and Book I separately distinguishes releasing a relay
  from forcing it toward OFF. Contract 1.0 cannot express that authority fixture. Contract 1.1 adds
  `relayGrab` / `relayRelease` plus `State.relays[].held`; hand control owns mechanics while held,
  electrical solve/state continues, and release returns mechanics to the electrical controller.
  Manual and handoff motion emits contact/lamp effects but never manufactures a relay threshold
  Event or `minDecisionUa`. Trace version 1 and the 33 observables do not change.
- **The minor version is real** `[settled]` — architecture's additive-only rule forbids adding two
  commands and a state field while claiming Contract 1.0. Because no fixture or golden has landed,
  `minivac.fixture/1` now requires `contract:"1.1.0"` without a dual-version branch. Capacitors and
  motor dynamics, still excluded, move from the previously reserved 1.1 bump to 1.2.
- **V-EXP1 preserves the published wires and global switch polarity** `[settled]` — image review
  confirms that Book V's five-wire list and circuit diagram implement equality/XNOR under Book I
  and Maintenance's independently verified LEFT=`V-U`, RIGHT=`V-W` convention. Book V's worked
  LR-ON/LL-OFF prose prints the inverse. ER-28 proves only that moving either switch toggles the
  lamp; it does not choose XOR over XNOR. The prose conflict is not an acceptance oracle.
- **V-EXP1 absolute phase is derived** `[settled]` — the fixture covers all four states
  LL=ON, LR=OFF, RR=ON, RL=OFF from the preserved topology, each tagged `unverified` with
  `FALLBACK-V-EXP1-TOPOLOGY`. ER-28 cites only the verified one-switch toggle invariant. No switch
  target is inverted and no wire is crossed to make the contradictory paragraph pass.

## 2026-09-02 — W4 measured bless gates: `min_decision_ua` 14 µA, `min_tick_gap` 6 ticks

- **Measured on the corpus, not chosen** `[settled]` — the orchestrator's preregistered run took the
  21-fixture Contract 1.1 corpus (the three Maintenance checks plus the 18 corrected Tier-A
  fixtures), all non-marginal, through two complete passes with zero expectation failures and
  byte-identical traces. `minDecisionUa` had 8 populated values and 13 `na`, distribution
  `14×1, 53×1, 100×1, 105×2, 252×2, 456×1`. `minTickGap` had all 21 populated, distribution
  `6×1, 9×5, 13×3, 25×6, 61×3, 189×3`. W4b reproduced both distributions exactly on the same inputs.
- **The gate is the minimum populated value, compared strictly** `[settled]` — per architecture
  §9.3's procedure, `na` values and declared marginal fixtures are discarded, the minimum remaining
  value becomes the gate, and refusal is strict `<`, so equality passes. Both profiles carry 14 µA
  and 6 ticks, tagged `[unverified]` because they are measured on this simulator, not on hardware.
- **Wave D keeps its dated input** `[settled]` — Wave D's derivation of `A = 282` used the dated
  1,000 µA input and still does; the live 14 µA gate does not feed it. Its preregistered forward guard
  stands: a live `min_decision_ua` above 1,005 µA reopens Wave D and returns to Tom, rather than
  silently re-deriving `A` (`tools/check-profile.ts`).

## 2026-09-02 — W6 measure-only counter trace (`FALLBACK-W6-ACTUAL-TAP-TRACE`)

`IV-EXP1-FAST` and `ER-ALTCOUNTER` assert this simulator's own measured lamp trace, not a printed
answer. Every expect step in them is tagged `unverified` with `FALLBACK-W6-ACTUAL-TAP-TRACE`, and
each step's `quote` is one line of the trace below.

- **Protocol** (the orchestrator's preregistration) — profile `MV601-REF-A`; cold power-up to runner
  quiescence; four 30 ms pushbutton-6 DOWN holds, each followed by an explicit release edge, runner
  quiescence and a fixed 30 ms post-release lamp interval. `IV-EXP1-FAST` is Book IV's 44-wire
  counter (printed pp.71–72, `book2-3-4.pdf` PDF pp.77–78), the declared marginal fixture.
  `ER-ALTCOUNTER` is the errata sheet's 48-wire alternate (p.2, right column), the non-marginal
  control. No expected outputs existed when the trace was first read. Lamps are 4, 5, 6:

```text
IV-EXP1-FAST count=0 phase=UP lamps=off,off,off
IV-EXP1-FAST count=1 phase=DOWN lamps=off,off,dim
IV-EXP1-FAST count=1 phase=UP lamps=off,off,on
IV-EXP1-FAST count=2 phase=DOWN lamps=off,dim,on
IV-EXP1-FAST count=2 phase=UP lamps=off,on,off
IV-EXP1-FAST count=3 phase=DOWN lamps=off,on,dim
IV-EXP1-FAST count=3 phase=UP lamps=off,on,on
IV-EXP1-FAST count=4 phase=DOWN lamps=off,on,on
IV-EXP1-FAST count=4 phase=UP lamps=off,dim,dim
ER-ALTCOUNTER count=0 phase=UP lamps=off,off,off
ER-ALTCOUNTER count=1 phase=DOWN lamps=off,off,dim
ER-ALTCOUNTER count=1 phase=UP lamps=off,off,on
ER-ALTCOUNTER count=2 phase=DOWN lamps=off,dim,on
ER-ALTCOUNTER count=2 phase=UP lamps=off,on,dim
ER-ALTCOUNTER count=3 phase=DOWN lamps=off,on,dim
ER-ALTCOUNTER count=3 phase=UP lamps=off,on,on
ER-ALTCOUNTER count=4 phase=DOWN lamps=off,on,on
ER-ALTCOUNTER count=4 phase=UP lamps=off,dim,dim
```

- **Outcome** `[settled]` — the preregistered IV-EXP1-wrong / ER-ALTCOUNTER-right count-4 contrast is
  absent: both end at `off,dim,dim`, not binary 4's `on,off,off`. Under the registered stop rule, no
  AT-02 discriminator spec is written and no profile value or `dV_relay_mv` changes. The
  2026-09-01 canonical counter ruling still governs what may be said about the pair.
- **Measured margins** — `IV-EXP1-FAST` `minDecisionUa` 8, `minTickGap` 9 (it alone uses the
  declared-marginal carve-out); `ER-ALTCOUNTER` 65 and 9; `IV-EXP1-SLOW` (80 ms holds, 100 ms waits,
  all 17 printed chart rows) 24 and 9.

## 2026-09-02 — Phase 2 implementation scope

- **The seven settled demo categories map to eleven production entries** `[settled]` — original
  `IV-EXP1`, alternate `ER-ALTCOUNTER`, `VI-TICTACTOE`, `V-JOBSELECT` presented as Mate Selection,
  `VI-RANDOM` presented as a four-sided die, `III-RELAYAND`, `III-RELAYOR`, `III-RELAYNOT`,
  `III-RELAYXOR`, `V-EXP2`, and `IV-FF2`. `IV-FF2` is the two-relay flip-flop because its 14-wire
  source and three-step procedure are image-verified. The broader research catalogue in
  `programs.md` §2.4 does not expand the product milestone.
- **Phase 2 remains on Contract 1.1** `[settled]` — the console exercises the implemented voltage
  rate law and its disclosed coast fallbacks in source-pinned demo smoke/invariant tests. It does
  not claim motor conformance, assert a new physical motor model, or add back-EMF, inertia, torque,
  capacitor elements, Book VII programs, `moveEnd`, or `session()`. This supersedes the stale
  Phase 1 handoff sentence that said motor conformance would necessarily land in Phase 2 at 1.2;
  Contract 1.2 remains required if a later milestone asserts new motor physics or wires a Book VII
  capacitor program.
- **The audible rotary cue is not a ratchet claim** `[settled]` — research finds likely no detent,
  ratchet, index spring, or click stop. Phase 2 replaces the brief's loose “ratchet sound” wording
  with a provenance-cleared, explicitly simulated motor/drive-wheel cue keyed to dial motion.
  Relay threshold Events may drive a separate simulated clack cue; only relay operation itself has
  primary-source support as audible. No sample is represented as an authenticated MINIVAC recording,
  no per-contact click is used to imply a ratchet, and buttons make no sound.

## 2026-09-03 — engine target: Godot supersedes Unity

This entry supersedes the word "Unity" wherever the 2026-08-30 entries, `docs/PROJECT-BRIEF.md`
and `docs/plans/architecture.md` §§0–13 use it. Those texts are not rewritten; the architecture
carries the change as its dated §13.6 amendment, and `docs/plans/phase-3-godot.md` is the Phase 3
plan. `CLAUDE.md` is a live instruction file, not a record, and its two Unity sentences (in "What this is"
and "Engineering rules") were rewritten in place.

- **The engine port targets Godot 4, not Unity** `[settled]` — Tom's direction, 2026-09-03. The
  decision that was settled on 2026-08-30 — a TypeScript reference core, frozen JSON command/state
  schemas, a golden conformance suite, and a C# port that must pass the same fixtures; no embedded
  JS runtime, no socket bridge — was a decision about the port, not about Unity, and stands
  unchanged. Godot offers the same two rejected shortcuts (a GDExtension or WebView embed, a
  socket bridge) and they stay rejected for the same reasons. What the switch buys, on the record:
  an MIT engine with no runtime licence `[verified: Godot licensing docs, F34 in the plan]`; C# executed by CoreCLR on every desktop
  target `[verified: gd_mono.cpp at 4.7-stable]`, so the IL2CPP/C++ contraction hazard that
  architecture §12 rule 6 was written against no longer exists on the target (§13.6.3 records the
  verified facts and what still has to be proven in an exported build); and a toolchain that
  installs from Homebrew on the lab's Macs `[verified: casks godot-mono 4.7.2, dotnet-sdk 10.0.400]`.
- **Why Godot** `[settled]` — Tom chose Godot because it is fully open source, its reputation is
  that it has improved substantially recently, and indie developers are increasingly choosing it
  as a primary tool.
- **Phase 3 commits through G4: a proven C# port and a non-playable Godot proof build** `[settled]` —
  not the brief's handoff document set alone. Layer 1 (waves G0–G3) is the port proof: the core
  library, the `minivac-trace` parity CLI, every existing KAT, fixture, golden, probe and
  meta-test passing bit-exact, and `docs/port/CSHARP-PORT.md` written from that port. Layer 2
  (G4) is the application proof shell — data hash check, frame loop, trace pane and exported
  self-test — with the KATs and goldens re-run inside the exported build. It proves the port on the
  shipped runtime; it is not a playable console. *Why:* a
  port guide nobody has executed documents intentions, not behaviour (the rule Phase 1's plan
  applied to the guide itself); and the exported build is the one new determinism surface the
  engine introduces, provable only by running it.
- **Port language: C# on .NET, not GDScript** `[settled]` — architecture §§3.5, 9.2, 12 and
  13.4.1 are written for .NET (`long`, `ulong`, checked arithmetic, `CultureInfo.InvariantCulture`,
  `UTF8Encoding(false)`); GDScript has no checked arithmetic and no fixed-width typed arrays; and
  the web build stays TypeScript, so Godot's lack of a C# web export costs nothing. Tom prefers C#
  to a custom script language on which model training is weaker.
- **Toolchain pins** `[settled]` — Godot 4.7.2 stable (.NET build) `[verified: release
  2026-08-18]` with its mono export templates; .NET SDK 10.0.4xx; `net10.0` for every project,
  above Godot's `net8.0` floor, because .NET 8 and 9 reach end of life on 2026-11-10 and .NET 10 is
  supported to 2028-11-14 `[verified: Microsoft releases index]`. `global.json` selects 10.0.400
  with `rollForward: latestPatch`; it does not pin the SDK to 10.0.400's exact patch. The TFM is written literally in
  the Godot csproj because the editor re-injects `net8` otherwise (godotengine/godot#103545, open).
  G0's eight recorded checks cover the editor on the Homebrew install, `--headless` on the editor
  binary and on an exported binary, the csproj rewrite, the clock's independence from
  `Engine.TimeScale`, the schema validator inside an export, the audio primitives, and the OS
  reduced-motion setting.
- **What the engine forecloses** `[settled]` — no web export exists for C# in Godot 4.7.2
  `[verified: godotengine/godot#70796, open, no milestone]`; Android and iOS are experimental for
  C# `[verified: Godot C#/.NET docs, F1 in the plan]` and are not v1 targets. The public web build remains the TypeScript console.
- **Layout: `dotnet/` and `godot/` live in this repository** `[settled]` — `data/` is hashed into
  every golden header, so the Godot project's copy is written only by `npm run sync-data` and
  asserted byte-identical by tests on both sides. A second repository would make the copy the
  thing that drifts.
- **The conformance artifacts are the acceptance mechanism, unchanged** `[settled]` — no port
  fixture format, no exported side-car expectations, no tolerance-based comparison tool in either
  language, no re-bless. Contract `1.1.0`, trace format 1 and every schema are unchanged.
- **Duplicate object keys are an acceptance rule** `[settled]` — a JSON artifact with duplicate
  object keys is accepted on both sides; the last key wins; neither side rejects it. No shipped
  artifact exercises this, so each implementation carries one test-local raw input that proves the
  rule. The port leaves `System.Text.Json` duplicate-property handling at its default and never
  enables strict rejection; its default is `[likely]` until G1 confirms it. The hash remains over
  raw bytes before parsing. Integer-typed fields spelled `1.0` or `1e3` are not an edge — JSON Schema 2020-12
  defines `integer` as any number with a zero fractional part, so both sides accept them.
- **Precedence when architecture prose and shipped code disagree** `[settled]` — the code the
  goldens were blessed against governs, and the prose is amended by a dated entry rather than the
  code changed. This ranks below the architecture Tom approved on 2026-08-30, so it is his to
  confirm.
- **Accessibility obligation for the desktop build** `[settled]` — v1 claims keyboard
  operability, visible focus, tooltips and a persisted reduce-motion preference. Screen-reader
  parity with the web build is not claimed: Godot's AccessKit integration exists from 4.5 and is
  experimental `[likely]`; no screen-reader-parity claim is made in Phase 3.
- **Public distribution is not Phase 3** `[settled]` — no signing, notarization, installer or
  download page. Exports are local builds for the proof hosts; publishing anything still needs
  Tom's explicit approval.

## 2026-09-04 — Phase 4: tactile and 3D presentation on the Godot build

Tom accepted every recommendation in `docs/plans/phase-4-presentation.md` on 2026-09-04. This is
the dated ruling that plan's header requires; the plan (revision 1) is the Phase 4 plan of record
and executes `phase-3-godot.md` §2.6 and Appendix C by reference. It makes exactly three
amendments to `phase-3-godot.md` — R9, R16, and gate 3.2.9's split into 9a/9b at P4 — and none to
`architecture.md`.

Gate numbers (`gate 3.2.x`) and P0 check numbers in the Phase 3 and Phase 4 entries are labels.
The plan sections that defined them were removed in the 2026-10-15 cleanup, once both phases were
built; the Godot acceptance suites in `godot/scripts/Acceptance.cs` carry the same ids.

- **R1a — Scope: Reading A** `[settled]` — one Phase 4 plan with four named stops: **S1** the
  exported `--selftest` runtime matrix — Linux x64, Windows x64 if reachable (R8d), and the macOS
  x64 slice under Rosetta; **S2** the playable console at Phase 2 parity; **S3** the flat 3D shell
  (the same console rendered into a `SubViewport` on a quad, orbit camera, forwarded input at full
  command-table parity, no new fidelity); **S4** tactile — cord lay, pop-outs, case/knob/relay/bezel
  geometry, materials, lamp glow, layered audio. G5/G6 are executed by reference, unamended. All four
  stops are complete.
- **R2 — Renderer: `forward_plus`** `[settled]` — written to `godot/project.godot` at P0 through the
  editor's renderer switcher; `mobile` is the named alternative and `gl_compatibility` the named
  fallback if P0 check 1's Stops clause fires (the fallback is then recorded here as a dated
  amendment). The value in force is printed at every windowed start, never trusted from the file.
- **R3 — 3D design** `[settled]` — the existing 2D panel Control tree rendered into a `SubViewport`
  textured onto a quad, with 3D pop-outs for the moving parts and exactly one pickable `Area3D`;
  not native 3D controls.
- **R4 — Default view mode is conditional** `[settled]` — `3d` only if P0 check 2 and gate 3.2.28
  both record a visible focus ring, a visible tooltip and a working keyboard path inside the
  SubViewport; otherwise `flat`. Flat is always one key away and remains the accessibility baseline.
- **R5 — Case height 0.20 W** `[settled]` — a chosen token under O-P11; the Wikipedia 5⅛ / 24 figure
  is a named rejected candidate. No inch, millimetre or pound is encoded as fact anywhere.
- **R6 — Knob form: PH2's** `[settled]` — dark cylinder with a white pie-wedge on the top face,
  recorded under O-P12 with both rejected forms named.
- **R7 — Cords v1: one colour token** `[settled]` — `#cf5c4c`, already a recorded UI invention, under
  O-P10. A multi-colour or multi-length set is a later chosen token; Gardi's set may not be its source.
- **R8 — Proof hosts** `[settled]` — each mutating remote step is stated with host and command and
  receives its own explicit yes at the time it is run.
  - **R8a** — Linux x64 on the primary Linux proof host: run and `chmod +x` — **yes**; `apt install`
    of any missing .NET native dependency, over `ssh -t` — **yes**.
  - **R8b** — Linux x64 on a secondary, egress-locked Linux proof host (no install path assumed):
    run — **yes**.
  - **R8c** — Rosetta on the macOS proof host: install if absent — **yes**; run the x86_64 slice —
    **yes**.
  - **R8d** — Windows x64 via WSL interop on a Linux proof host if the read-only probe succeeds —
    **yes**; else Tom runs the `.exe` himself — **yes**; S1 may close without the Windows leg —
    **yes**.
- **R9 — Appendix D amendment** `[settled]` — the two *Redraw and simulation limits* paragraphs (and
  the credits list if a new asset ships) change in both builds, to the replacement text in the plan's
  Appendix D, in one commit touching the five places Appendix D names — `src/ui/help-credits.ts`,
  the Godot-side literal pin, `test/help-credits.spec.ts` 179–186, `test/browser/help.browser.ts`
  47–55, and `phase-3-godot.md` Appendix D's cited line range. The credits change is an **added
  entry only**: the four G4 credit headings and description sentences are not rewritten — gate
  3.2.8(ii) still pins all four byte for byte — and gate 3.2.24's build-naming criterion is scoped
  to the entries Phase 4 adds. This is the only `src/` change Phase 4 makes. *Amendment 1 of 3.*
- **R10 — New audio samples for the pull-in / drop-out split: yes** `[settled]` — each carries a full
  `data/public-assets.json` record ending "is not an authenticated MINIVAC recording", is mirrored by
  `sync-data`, and adds a credit under R9.
- **R11 — Cord–cord collision: tripwire** `[settled]` — not in scope; the ERRATA hook is recorded in
  the plan's Appendix J.
- **R12 — Spatial relay cues: yes, conditional** `[settled]` — six `AudioStreamPlayer3D` voice pools
  in 3D mode only, if P0 check 8 records audible separation; otherwise no, and it becomes a tripwire.
  The disclosed audio divergence text is amended in the same commit if yes.
- **R13 — Scenes built in code** `[settled]` — `Main.tscn` stays the only scene file;
  `phase-3-godot.md` §2.1's `Panel.tscn` / `Stage2D.tscn` are superseded.
- **R14 — Font** `[settled]` — the engine default bold face if P0 check 7 finds one reachable;
  otherwise a libre OFL font file with a full public-assets record and a credit under R9.
- **R15 — Reaffirmed, unchanged** `[settled]` — no public distribution; Godot 4.7.2 pinned; no new
  npm dependency; no NuGet package in the Godot project; `src/core/**`, the contract, the schemas
  and every conformance artifact frozen; screen-reader parity still not claimed.
- **R16 — The Godot composition-root tier gains `Acceptance.cs`** `[settled]` — six files, not
  five, with `SelfTest.cs`-level access plus `Stopwatch` / `Time.*` for harness timing; reachable
  only under `--acceptance`, never on the `--selftest` or normal path, emitting no `Command`.
  **R16 also authorizes the one accessibility change it forces in `Boot.cs`**: `private void Start`
  → `internal void Start` (`godot/scripts/Boot.cs` 39), so gate 3.2.1's hermetic refusal case can
  call it, together with the extraction of `Start`'s body, verbatim, into
  `internal void BuildConsole(...)` so that `Boot` and `Acceptance` share one composition body (plan
  §2.9); no statement of that body is altered, `Refuse` stays `private` because nothing outside
  `Boot` calls it, and §2.1's `Boot.cs` budget names this as the second and last edit.
  `phase-3-godot.md` §2.2's five-file list is amended by this entry; `architecture.md` carries no
  tier text and is not amended; determinism rule 20 is unamended. *Amendment 2 of 3.* (Amendment 3
  is gate 3.2.9's split into 9a/9b at P4.)
- **Model mapping under Codex** `[settled]` — wherever the plan names Opus, read `gpt-5.6-sol`;
  wherever it names Sonnet, read `gpt-5.6-terra`; the effort level the plan names carries over; the
  orchestrator seat is `gpt-5.6-sol` at `xhigh` (Codex mapping, Tom, 2026-09-01). Where the plan names an
  adversarial reviewer without an effort level, the Codex seat is `gpt-5.6-sol` at `xhigh`
  (Codex mapping: adversarial reviewer).

### P0 measured amendment, 2026-09-06

- **R2 remains `forward_plus`** `[measured]` — Godot 4.7.2's editor-authored switch omitted the
  desktop renderer key, wrote `renderer/rendering_method.mobile="forward_plus"`, retained
  `textures/vram_compression/import_etc2_astc=true`, and left the existing
  `config/features="4.7", "C#", "GL Compatibility"` string unchanged. An unoverridden windowed
  launch is authoritative: `method=forward_plus driver=metal`. No fallback was taken.
- **R4's P0 half passed** `[measured]` — click, keyboard input, tooltip and focus ring all worked
  through the scratch SubViewport quad. The later gate 3.2.28 remains the other half of the
  conditional before `3d` can become the default.
- **Glow tokens changed** `[measured]` — the initially weak `glow_bloom=0.2` /
  `glow_hdr_threshold=0.9` pair was retuned to **1.0 / 0.1**. The resulting screenshot showed a
  visible red halo while the CanvasLayer label stayed clean. Appendix H carries the measured pair.
- **Cord mesh tokens remain 24 × 8** `[measured]` — 72 tubes rebuilt for 600 frames at 1440 × 900
  with p95 **2.118400 ms**, below the 4 ms gate, so neither reduction rung was taken.
- **R12 resolves to no for this phase** `[settled; class V NOT_RUN]` — Tom was using
  macOS screen sharing/RDP, so the sounds heard through that transport do not establish spatial
  separation or reverb. P0 check 8(b) is `NOT_RUN`; six spatial relay pools do not ship. The
  existing tripwire reopens R12 only for a local-audio, non-RDP listening run that records audible
  separation.
- **The shipped-code precedence rule corrects three P0 boundary rows** `[settled]` —
  `DemoLibrary.cs` narrowly permits `IArtifactSource`; `GodotResourceSource.cs` permits
  `Godot.Error`; and the scanner's Godot vocabulary includes public top-level GodotSharp types plus
  the `InputEvent*` family. These are corrections to the plan's transcription of shipped code, not
  new Phase 4 capabilities. The live scanner has ten main facts and eleven exploit/self-test facts.

### P4 execution amendment, 2026-09-07

- **Wire view uses a dedicated 15° FOV** `[settled]` — gate 3.2.9b proved the original 45° FOV
  infeasible across the complete permitted dolly interval: the best case was 9.122437 px at the
  0.45 W floor. Tom approved adding `cameraWireFovDeg = 15`; normal orbit remains 45°. At the fixed
  45° wire elevation, the solver produced `cameraWireDollyW = 0.639434 W`, with minimum projected
  extents 24.000031 px at 1440 × 900 and 28.800018 px at 1920 × 1080. PR-8 now has twelve camera
  tokens; P4/P5 have 26 token rows and P6 has 74.
- **Appendix A permits `StandardMaterial3D` in `Stage3D.cs`** `[settled]` — the original row omitted
  the material class even though the same plan requires the panel `ViewportTexture` as the quad's
  albedo. This is a transcription correction, not a wider presentation capability.
- **The 24 px SubViewport hole floor applies at the shipped 2880 × 1600 size** `[settled]` — at the
  harness-only 1440 × 800 resize, the plan's pinned `holeHit = 0.0105 W` is necessarily 15.12 px.
  Tom approved treating that resize as the layout-invariance check it was intended to be, while
  retaining the 24 px floor at the shipped size and recording the 15.12 px observation.
- **R4 resolves to a `3d` default** `[settled]` — gate 3.2.28 is the conditional's second half. Tom
  observed the focus outline and the tooltip through the 3D surface on 2026-09-07, and the automated
  keyboard path reported 8/8. A clean install therefore starts in `3d`; a persisted `view/mode`
  choice is honoured, and flat is always one F press away.

### S3 review decision, 2026-09-08

- **3D wire framing persists through navigation** `[settled]` — after W, orbit and pan retain the
  15° wire FOV and wheel/toolbar dolly is constrained to 0.6–0.639434 W. Fit or R exits wire
  framing and restores the normal 45° default camera. Tom approved this resolution after review
  finding C5 showed that the prior first navigation input discarded the accessibility framing and
  reduced projected hole targets from 24 px to about 8 px.

### P6 audio execution, 2026-09-08

- **R10 execution shape:** retain the existing `relay-cue.wav` as pull-in and derive one distinct
  drop-out sample from the already pinned relay source. Add its provenance record and one fifth
  desktop-only credit together with the R9 amendment. Existing sample bytes and credit sentences
  remain unchanged. **R12 remains no**; Room/reverb is non-spatial presentation in the existing
  global 32-voice pool. No new font is needed under the resolved R14 path.

### P6 execution preflight, 2026-09-08

- The coordinator resolved the missing geometry/material values within the already authorized
  O-P fallbacks. Appendix H gains nine named records: `jewelBezel` (pinned to `main.css:621`),
  `meshQuality`, `footColour`, `slideThrow`, `knobSurface`, `relayForm`, `jewelKnurl`,
  `lampSurface`, and `sceneLighting`. The original 74 records remain; **83 records** is the
  resulting P6 inventory. Structured values group related parameters just as the existing camera
  pose and vector tokens do. Every new value is explicit in Appendix H; none is an original-unit
  measurement.
- The chosen lighting setup is one directional key with neutral flat ambient fill, for displaying
  the new material response. O-P18 records this presentation choice. The existing panel quad and
  cords remain unshaded. Runtime material checks and captures must establish that the new geometry
  is visible; the choice alone is not visual evidence.
- Gate 3.2.21(f)'s closed arithmetic list gains **1000**, solely as the existing contract's
  `milli`/control-travel divisor. The plan and test are amended together; no new simulation scale,
  timestep or physical dimension is introduced. `PanelTheme` delegation is asserted by value and
  source references because its exposed colours, vectors and scalars are value types.
- Only relay/dial pop-outs read the controls' already-presented, grab-protected values. Other
  controls project the current state unconditionally: pushbutton and slide travel stay continuous,
  while POWER and breaker remain binary. The twelve lamp emissions remain linear in `milli`; the
  jewel remains binary in rail voltage. No additional gesture state or lamp persistence is added.

### P6 review clarifications, 2026-09-08

- The release-cue derivative is bundled in both artifacts because the web build copies
  `public/audio`; only the desktop audio router uses it. The fifth credit now says so explicitly.
  This clarifies the earlier "desktop-only credit" shorthand without moving the asset or changing
  web audio behavior. It remains a simulated cue, not an authenticated MINIVAC recording.
- PH2's 0.769 knob ratio applies to the frozen layout's printed decimal inner-circle radius.
  Body and white wedge share that derived radius; the unchanged `knobSquare` still describes the
  2D artwork/pick footprint. The existing 0.5 spring fill ratio belongs inside the `relayForm`
  compound choice. Lamp, pushbutton, breaker and jewel bezels explicitly share the existing
  0.004W proud height; the jewel barrel remains 0.008W. These clarifications retain 83 token rows.
- The existing case-edge radius describes the assembled enclosure, including raised exterior
  rails. Rounding only the lower body while leaving square raised corners does not satisfy it.

### P6 performance continuation, 2026-09-08

- After the two-failure stop at p95 4.060200/4.021700 ms, Tom approved a targeted performance fix.
  Optimize repeated presentation calculations only; retain the 4 ms gate, 600 forced rebuild
  frames, 72 cords, 1440x900 viewport, 16-by-6 mesh resolution and frozen core. Verify old/new
  emitted vertices and normals bit-for-bit before accepting a timing improvement.

### P7 review amendments, 2026-09-08

- **Panel HDR is local to the 3D SubViewport** `[settled]` — P0 measured that the project-wide
  `rendering/viewport/hdr_2d` key does not seed a non-root SubViewport. The shipped panel keeps
  `UseHdr2D=true` explicitly; the redundant project setting remains absent so flat mode is not
  changed. This reconciles the normative plan with the P7 review fix that dropped the project-wide
  setting.
- P7's foreign-host `--selftest` matrix proves the exported deterministic core/runtime path and
  exact frozen count set. It does not construct the presentation tree, so Phase 4 does not claim
  foreign-host presentation startup evidence. Windowed presentation remains verified on the macOS
  development host.

### P7 proof-host substitution, 2026-09-10

- **A second Linux proof host replaces the R8a host for P7 only** `[settled]` — Tom withdrew
  permission to use the R8a host because it is remote and he cannot be present to recover it if a
  run goes wrong, and directed the coordinator to use another Linux x86_64 host, under WSL2. P7's
  authorized Linux hosts are therefore that host and the R8b host. The P1 proof on the R8a host
  remains a historical result; that host is not rerun or otherwise touched during P7. Documenting
  the WSL2 host fired Appendix J's Windows tripwire; its read-only PowerShell interop probe returned
  `powershell.exe: command not found`, so the Windows leg remains deferred and the tripwire is
  re-armed.

## 2026-10-13 — Phase 5: full-corpus conformance

Tom approved `docs/plans/phase-5-corpus.md` with these rulings.

- **Only printed answers verify; everything else is speculative** `[settled]` — a fixture is
  `printed` when at least one `expect` or `until` step carries no `tag`, otherwise `speculative`
  (every such step `FALLBACK-*`-tagged, or digest-only C2). The split is a field in
  `test/conformance/fixtures/manifest.json`, not a directory: moving files would split golden
  paths (bless writes by `tier`, parity/C#/Godot read by directory) and break TS probe
  resolution. The manifest is the one fixture inventory every TS, C# and Godot count reads.
- **D1 — motor fixtures may assert printed answers** `[settled]` — C2 fixtures may carry expect
  steps, and the fixture schema gains one additive step, `{k:"until", obs, maxMs}`, so motor
  expectations key off dial position rather than milliseconds derived from the invented
  `run_mrpm`. Existing goldens stay byte-identical. An `until` emits the same `?` line an
  `expect` would at the tick it matches or times out (architecture §13.5.1); no new trace kind.
- **D2 — observables the page does not state are removed, not tagged** `[settled]` — per
  `programs.md` §2 ("every observable the printed page names, and no others"). The golden trace
  still records every transition, so regression coverage is unchanged.
- **D3 — Book VII stays out of scope** `[settled]` — it is a joint 601/6010 document (N-11) and
  its capacitors need Contract 1.2.
- **D4 — batches of five programs** `[settled]` — about 12–15 agents per workflow, over the
  session's 10-agent guideline by Tom's approval.
- Motor programs are run as tests of the timing model. No profile constant is tuned to make a
  fixture pass; a sensitivity sweep reports programs that pass only in a narrow parameter band
  as FRAGILE.

## 2026-10-13 — Motor polarity: D17 + / D18 − turns toward increasing numbers

Tom ruled `[settled]` that RUN with D17 at + and D18 at − drives the dial toward increasing
numbers. Book I p.23 Exp 13 prints "First, light 5 flashes and then light 6 flashes" (D1, then
D2). In the Books V–VI p.11 elevator the reverse sense sends a floor 1 → floor 2 trip the long way
round, reaching floor 3 (D12) before it turns back. Books V–VI p.6 Exp 5 and the pp.56–57 Tug of War
also fit this sense; Exp 4 disagrees with itself (p.5 fits, p.4 "from red to green to yellow" does
not). open-questions O-R11 lists the evidence. The earlier sign was an `[unverified]` convention that
no source supported (architecture §13.4.5). Only the three speculative C2 goldens moved; no printed
`?` outcome changed. The corpus smoke report moved too: motor signs, V-EXP17 now no-settles on the
pb5 press, and two dial-change counts changed.

## 2026-10-13 — C13 resolved: Book VI's rotation words agree with the panel

Tom accepted `[settled]`. Book VI p.56's "counterclockwise (towards 9) … clockwise (towards 7)"
matches the panel's increasing-clockwise numbering. The p.57 program stops the dial on 7, 8 or 9, so
9 is reached from 10 and 7 from 6. The old "never cite Book VI for direction" rule is withdrawn
(`open-questions.md` C13). O-R11 stays `[likely]`: its sign is inferred from printed behaviour through
the circuit model, and Exp 4 p.4 still disagrees.

## 2026-10-13 — Option B: the coast waits for a mid-transfer contact (Tom's ruling)

- **`TRANSFER-COAST-DEFER`** `[settled]` — Tom chose option B over A to fix the Tic-Tac-Toe coast.
  When the drive goes while a relay, pushbutton or slide switch is mid-stroke, the dial holds, and
  the coast is chosen by the brake the stroke lands on. The wait is capped by the profile's longest
  stroke. No profile constant changed; the rule is `[unverified]` (architecture §13.4.5, `rotary.md`
  §3.3, `stepRotary` in both ports).
- **Known trade** — the V-EXP9 elevator claims are FRAGILE on contact width: below 12.7° pads the
  brake coast leaves the wiper in a gap, the errata's D6–D7 hang. The shipped 16.875° passes.

## 2026-10-13 — Phase 5 run rules: park, back up, pause before demos

Tom ruled these before the printed batches, so the run need not stop for them.

- **A stop rule parks the program; the run continues** `[settled]` — when a fix would flip an
  existing printed `?` outcome, touch a profile constant, or fails twice, that program is left
  out of its batch commit and logged in `docs/STATUS.md` with the evidence. The other programs
  and batches go on, and Tom reviews every parked item together at the end. This replaces the
  plan's "stop and go to Tom".
- **Back up each commit to the private origin** `[settled]` — push `feature/phase-5-corpus` to
  the private origin after each commit. No merge to `main` and no public push without Tom.
- **Gates run in a background worktree** `[settled]` — run the gate in a git worktree in the
  background and keep working; stop only when it fails.
- **Pause before Step 8** `[settled]` — run Steps 6–7 to the end, then Tom picks demos from the
  green candidates.
- **Step 9 history call waits for the exposure audit** `[settled]` — Tom chooses history or a
  squashed repo once the audit shows what the history holds. The push itself needs his yes.
- **This repo keeps its history; GitHub gets a scrubbed, squashed copy** `[settled]` — Tom,
  2026-10-15. The private repo is not squashed. The public copy is built and reviewed in a
  separate private staging repo first, then pushed to GitHub.

## 2026-10-13 — ER-32 and ER-36 stay as printed

- **O-C8, ER-32 kept as printed** `[settled]` — the printed V-EXP10 fixture stays dime-only. Step 7 adds
  a speculative variant with 5L/6G kept, tagged as a fallback.
- **O-C9, ER-36 kept as printed** `[settled]` — the printed V-EXP16 fixture does not assert the pb5
  stop. Step 7 adds a speculative variant on the uncorrected 5X/6E that asserts a clean stop.

## 2026-10-13 — Knife-edge gate: keep the 14 µA trigger, add a robustness check (supersedes settling headroom)

The settling-headroom redesign did not survive review. Every definition tried (coil and filament
settled, coil only, trajectory peak) either refused printed fixtures that had already landed
(IV-EXP1-SLOW, V-EXP16) or still refused the parked ones under the §13.5 re-measure. The reviewer also
rejected the shipped filament-settle reading. The work is archived as a patch in the session
scratchpad and was not landed.

- **Ruling** `[settled]` — the 14 µA `min_decision_ua` gate and the `minTickGap` gate stay as triggers.
  A fixture that trips either gate is still blessed if every assert in it holds under a fixed
  perturbation set: relay thresholds ±150 mV, coil resistance ±10%, lamp thermal τ ×0.5 and ×2. Those
  magnitudes are invented harness parameters, `[unverified]`, not model physics. The check runs in
  the TS bless only. No profile constant changes and no golden is re-blessed.
- This supersedes an earlier 2026-10-13 ruling that the gate measure settling headroom. Tom chose it over peak headroom
  with a fixed floor, the old gate with a marginal carve-out, and parking every such program.

## 2026-10-14 — Coast set from printed bounds; Book IV bit convention; robustness-check details

Tom's rulings before an unattended run.

- **`coast_udeg_drive_removed` is set from the printed band** `[settled]` — a one-off exception to the
  kill rule. The shipped 20° was invented (O-R5), and its elevator rationale is void (O-R12). Two
  printed claims now bound it. The Match Game (Books V–VI p.55, "the rotary switch dial will indicate
  the number of matches remaining") needs it at about 13° or less (O-R14). V-EXP11 (Book V p.14, "The
  rotary switch will return to 0") needs more than the 5.625° gap. It is set to the middle of the band
  in which every printed claim and assert passes, about 9.3°, and documented as bounded by those
  claims. If any printed claim or assert breaks, the change is reverted and VI-MATCHGAME stays parked.
- **Book IV's slide-switch bit convention is printed for Book IV** `[settled]` — p.80's "(A slide switch
  RIGHT represents 0; a slide switch LEFT represents 1.)" counts as printed for the later Book IV binary
  programs, IV-EXP12 included (O-C12). Other books do not inherit it.
- **The lamp τ ×2 robustness leg stays** `[settled]` — stricter is safe. A fixture it refuses is
  parked with the evidence.
- **A knife-edge-tripped fixture with no `expect` or `until` step is refused** `[settled]` — the
  2026-10-13 working choice becomes a ruling. Every perturbation would hold vacuously.
- **Run mode:** printed batches run three at a time as one workflow and land once per wave. Steps 6–7
  run unattended; the pause before Step 8 stands.

## 2026-10-14 — Steps 8 and 9 reviewers run at high effort

- **Step 8 and Step 9 adversarial reviewers run Opus at high, not xhigh** `[settled]` — Tom's ruling,
  an exception to the project's strongest-worker reviewer policy for these two steps only.
  - Step 8 is packaging: demo-library entries, labels, the Godot mirror, parity and browser
    acceptance. The fixtures already verify the circuits, and the parity, self-test and browser gates
    are deterministic.
  - Step 9's public-exposure audit (history and docs: lab hostnames, IPs, local paths, personal
    material) runs at high too.
  - A demo whose change reaches `src/core/` keeps an xhigh review (orchestrator's working choice, not
    Tom's).

## 2026-10-14 — Step 8 demos get one batch review

- **One review over the whole batch of demos at the end, not one per demo** `[settled]` — Tom's
  ruling. It still runs Opus at high, per the entry above.
  - The worker copies each demo's wiring and starting state from its passing fixture, and
    `test/demo-library-source.spec.ts` pins them. The only new writing per demo is a few lines of
    instructions and the control labels, so the review reads that copy across all the demos at once:
    does it match the printed procedure, does it claim behaviour the page does not print, does it read
    right for a stranger.

## 2026-10-14 — Step 8 adds six demos and four categories

- **Six more demos, appended after the eleven** `[settled]` — Tom accepted the orchestrator's
  recommendation: Traffic Light (`V-EXP4`), Scissors, Paper or Stone (`VI-SPS`), Combination Lock
  (`VI-COMBOLOCK`), Morse Code Encoder (`V-EXP19`), Reaction Time Tester (`VI-REACTION`) and
  Half-Adder (`IV-EXP4`). Each has a passing printed fixture and no FRAGILE motor-sweep verdict. This
  extends the 2026-09-02 "seven categories map to eleven entries" scope to seventeen entries.
- **Four new categories** `[settled]` — `control` (Traffic Light), `lock` (Combination Lock), `code`
  (Morse Code Encoder), `arithmetic` (Half-Adder). The two games use the existing `game`.
- Working choices (orchestrator's, not Tom's): `source.errata` lists the SDC errata-sheet ids that
  touch the program even when no wire changes, following IV-EXP1 and VI-TICTACTOE. Local
  source-correction ids stay out. VI-COMBOLOCK is `likely` because its wiring rests on the
  VI-SEQREC-PRINT-01 inference. V-EXP19 carries the printed p.33 dial plate as its notice, because the
  app's dial shows numbers, not letters.

## 2026-10-15 — Pushbutton latch

- **Shift-click latches a pushbutton** `[settled]` — Tom, after his smoke test of the public copy
  found that one mouse cannot hold two pushbuttons (needed by the AND and XOR demos, Tic-Tac-Toe and
  Scissors, Paper or Stone). Shift-click, or Shift+Space / Shift+Enter on a focused pushbutton,
  toggles a latch. A plain click on a latched button or Escape releases it. Focus loss, Tab and power
  do not. Web and Godot both; UI only, sending the existing pushbutton commands.

## 2026-10-15 — Public copy calls

- **Publish shape** `[settled]` — Tom: personal and lab-specific text is removed from the public
  copy; the agent files keep their engineering rules; the manual PDFs and text extracts ship (1961/62,
  no renewal found in the Copyright Office records; `docs/research/history-and-artifacts.md`); the
  prebrief images do not (source unknown); MIT with a `NOTICE`; the snapshot commit carries the
  GitHub account's noreply address and no footer.
- **Where** `[settled]` — a private staging repo, then a private GitHub repo, pushed 2026-10-15 on
  Tom's yes. Going public is his call.
- **Updates** `[settled]` — Tom approved the orchestrator's recommendation: this repo stays the source
  of truth. Each update applies this repo's diff since the last snapshot to the public copy, runs the
  exposure grep and the full gate, and lands as a new commit titled "snapshot of private <sha>".
  While the GitHub repo is private the snapshot may be re-squashed; once it is public, never
  force-push. (Titles superseded 2026-11-03, "Public commit titles".)
- **Phase 5 closed** `[settled]` — Tom, 2026-10-15: Step 9 is done. The queue generator
  (`rank-corpus`), its spec and the generated queue are retired; the run rules above stay as record.

## 2026-10-31 — `minivac-control`: the CLI core for an LLM operating the machine

The first step of a project in which an LLM operates the simulator through tools. Its spec and
decision record live outside this repo (the "Minivac hands" spec and plan, 2026-10-31, and its
2026-10-30 decision record).

- **Shape** `[settled]` — Tom, 2026-10-31: v1 is operate-only, with no scoring. The deliverable is a
  tool table over the core: one entry per contract command, plus a state read and load-program,
  each with a JSON schema derived from `src/core/contract.ts` and a handler that calls
  `Machine.apply` and returns its `CmdResult`. The session is a replayable command log on disk,
  rebuilt on every call. The CLI is the first adapter; MCP comes later, only if Bash friction shows.
- **Name and batching** `[settled]` — Tom, 2026-10-31: the CLI is `minivac-control`. One call may
  carry several commands, applied in order, with one settle at the end.
- **First slice** — the 2026-10-31 build covers `power`, `connect`, `disconnect`, `button`,
  `switch`, the state read and `wait` (the time step, below). `breaker`, `relayGrab`/`relayRelease`,
  `dialGrab`/`dialRelease` and load-program are later steps of the same plan, not dropped.

## 2026-10-31 — `minivac-control` time, session file and code location (orchestrator)

Orchestrator working choices, not Tom-approved. They follow the spec page's recommendations for its
open items O1, O2 and O7.

- **Time (O1)** — the contract has no time command; only `Machine.advance` moves time. Every
  state-changing call ends with one capped settle, the fixture `settle` step with the conformance
  runner's semantics (quiet for `settle_quiet_ticks` with no observable change and an empty motion
  mask, or the cap). It is logged as an explicit step, so replay is exact. The default cap is 500 ms,
  the commonest settle cap in the fixtures; `--settle-ms` overrides it. `wait <ms>` is the fixture
  `advance` step and may sit inside a batch. A call that hits the cap says the machine did not
  settle; that is a result, not an error. Two things that rule does not watch, found in the build:
  the dial motor is not in `motionMask`, so a turning dial can settle between contact changes; and a
  lamp filament still cooling can settle at `dim` (open question O-C28, Tom's call). The CLI keeps
  the runner's rule and adds a note line for each instead.
- **Session file (O2)** — its own schema, `minivac.session/1`, because `minivac.fixture/1` requires
  provenance fields a new session cannot fill. It holds `profile`, `contract` and a `script` of
  fixture-shaped `do`, `settle` and `advance` steps in order, wiring included as `connect` and
  `disconnect` steps, so replay is exact even when wiring changes mid-session. v1 cords run hole to
  hole only. `connect` takes the manual's shorthand (`1+/1Y`) and takes the lowest free hole on each
  terminal and the lowest free cord id; for a connect-only session that is the fixture loader's
  `allocateHoles` result, which has no notion of a disconnect. The file stores the resolved holes
  and cord id, so replay never re-allocates. A batch is atomic: a rejected command writes nothing,
  so a session file always replays clean. The file also records the netlist and profile hashes;
  replay refuses a session recorded against different data. A changing call holds an exclusive
  `<session>.lock` from read to write, so parallel calls on one session cannot lose a batch; a
  killed call can leave the lock behind, and the error message says to delete it.
- **Code location (O7)** — outside `src/core/`. The tool table and settle logic are in `src/hands/`,
  with no filesystem access, so a later browser pane can reuse them. Session file I/O and the CLI are
  in `tools/hands/`, and the entry point is `bin/minivac-control`, beside `bin/minivac-trace`.

## 2026-10-31 — Checklist: P2 with extras, the first nine items

- **Wiring items (P2)** `[settled]` — Tom, 2026-10-31. A wiring item pairs a prompt with an existing
  conformance fixture. The check replays the operator's session, turns its cords into a wire list,
  puts that list into a copy of the fixture with `errata_applied` emptied, and runs the conformance
  runner. A circuit wired differently from the book passes if it behaves the same.
- **Extras** `[settled]` — Tom, 2026-10-31: an item may append script steps to that copy, so
  properties the manual never asserted are checked too. (The orchestrator's reason, put to Tom with
  the question: without them a lamp wired straight to + passes III-RELAYOR, and III-XOR-PB never
  checks the case where no button is pressed.)
- **First items (O5)** `[settled]` — Tom, 2026-10-31: I-EXP4, I-EXP5, III-XOR-PB, III-RELAYOR and
  IV-EXP4, picked from the fixtures that are tier A, verified, on the reference profile, with no
  mid-script rewiring and no marginal mechanism. (Orchestrator note: III-NOT meets those criteria
  but asserts nothing, so 18 fixtures qualify, not the spec page's 19.)
- **Basic items** `[settled]` — Tom, 2026-10-31: literal operating instructions ("plug one end
  there, the other over there"), checked against the operator's own session: the exact cords and
  a few end-state observables, with no fixture. Four to start: one cord pair, a held button, an
  unplug, a slide switch. Tom approved the prompt wording of all nine items.
- **Day-zero probe (P4)** `[settled]` — Tom, 2026-10-31: skipped; the CLI runs measure the same thing.

## 2026-10-31 — Checklist mechanics (orchestrator)

Orchestrator working choices, not Tom-approved.

- **Separate checker** — `bin/minivac-check <item> <session>`, not a `minivac-control` subcommand,
  so an operator restricted to `minivac-control` cannot reach the yardstick, and the skill never
  mentions it. Output `PASS`, `FAIL` (with the first failing line and its manual quote) or `ERROR`
  (a run that could not be judged: no cords, hole allocation failure, rejected reference command,
  corrupt session); exit 0, 1 or 2.
- **Where** — items in `checklist/items/` with their own schema. Not under `data/`, which
  `npm run sync-data` mirrors whole into the Godot build.
- **Lamp reads** — a basic check advances 500 ms after replay before reading the end state, and
  extras read a lamp turning off with `until` or after an `advance`, because a settle can return
  while a filament is still cooling through `dim` (open question O-C28).
- **Run records** — each run's session file, transcript and verdict are kept as run records,
  which the public snapshot leaves out; the transcripts carry local paths.

## 2026-10-31 — Operating items, load-program, the stage-1 bar, lamp settle

- **Operating items (O3)** `[settled]` — Tom, 2026-10-31: the checklist has wiring items and
  operating items. An operating item asks the operator to run a program, for example "load the
  binary counter and count to three", and is checked against the operator's own session.
- **load-program on items (O4)** `[settled]` — Tom, 2026-10-31: not on wiring items, where it skips
  the wiring the item tests, so the checker fails a wiring session that used it; allowed on
  operating items.
- **What load-program loads** `[settled]` — Tom, 2026-10-31: `load-program <ID>` takes the `wires`
  of a conformance fixture by its id, so every program in the corpus is loadable, not only the
  demo library. It adds connect steps to the session, marked as a load in the log, and does not
  power on or press anything.
- **Stage-1 bar (O6)** `[settled]` — Tom, 2026-10-31: stage 1 closes when every v1 item has passed
  at least once from a fresh Claude Code session, every result reproduces from its session file and
  records the model, and one human-in-the-loop cycle is on record (read the failures, edit the
  skill, rerun). That cycle ran on 2026-10-31.
- **Lamp settle (O-C28)** `[settled]` — Tom, 2026-10-31: settle keeps the conformance runner's rule
  and does not wait for lamp filaments. `minivac-control` prints a note when a lamp is still
  warming or cooling; checks wait the transient out.

## 2026-10-31 — Operating-item and load-program mechanics (orchestrator)

Orchestrator working choices, not Tom-approved.

- **Operate items** — an item names a `program` fixture, ordered `steps`, and an end state. The
  check runs in order: the session's final cords must run the program (the wiring-item check, with
  no extras, so loaded and hand-wired both count); the steps must appear in the log, in order,
  after the last wiring change; the end state is read after 500 ms more of simulated time. Commands
  sent with no simulated time between them land on one tick, so only the last command per control
  counts toward a step: `button 1 down + button 1 up` in one call does not press the button, in the
  checker or in the machine.
- **First two** — OP1 runs `IV-EXP1-SLOW` (the plain `IV-EXP1` fixture does not exist; SLOW follows
  the printed sequence chart and is not marginal); OP2 runs `V-EXP2`, the burglar alarm, where only a
  checkpoint can show the reset took effect, since light 5 is on after power-on and after the alarm
  alike; its wiring check borrows `V-EXP2-DERIVED`'s steps as extras. OP2's end state after the door closes comes from `V-EXP2-DERIVED`, not from print.
- **Load marker** — `load-program` writes `{"k":"load","program":"<ID>","cords":N}` before its N
  connect steps; replay checks the count. Older session files still load.

## 2026-10-31 — Checkpoints on operating items; O4 for basic items

- **Checkpoints** `[settled]` — Tom, 2026-10-31: an operating item's step may carry expected
  observables that must hold once the call containing it settles (read after the same 500 ms lamp
  wait as the end state), so a reset that never took effect or a count reached by another route
  fails. They are machine state, not the turn and tool-call metrics the yardstick ruling defers.
  Power-on is not a required step; checkpoints and the end state show it.
- **load-program on basic items** `[settled]` — Tom, 2026-10-31: refused, as on wiring items (O4).
- **Nothing after the last step** (orchestrator working choice, not Tom-approved) — once an
  operating item's last step on a control has matched, no later command on that control may
  follow, so "count to three" fails at eleven presses (the counter wraps back to 3) and at four.

## 2026-11-01 — Stage 1 closed; open items ruled; Claude rung on Sonnet

- **Stage 1** `[settled]` — Tom, 2026-11-01: closed against the O6 bar (11/11 PASS).
- **Nothing after the last step** `[settled]` — Tom, 2026-11-01: kept. This was the orchestrator's
  working choice in the previous entry; it is now ruled.
- **OP2's relay-6 latch** `[settled]` — Tom, 2026-11-01: kept. OP2's extras pin relay 6 as the
  latch, copied verbatim from `V-EXP2-DERIVED`; this stays a derived topology under
  `FALLBACK-CHECKLIST-EXTRA`.
- **Dial item** `[settled]` — Tom, 2026-11-01: add a checklist item that uses the dial, as the plan
  asked. Not built yet.
- **Run diagnostics** `[settled]` — Tom, 2026-11-01: keep the turns and cost columns in run
  results, labelled as diagnostics, not a score.
- **O9 Claude rung** `[settled]` — Tom, 2026-11-01: the main Claude rung is Sonnet 5.5 in place of
  Opus 5.5; Haiku 5.5 stays.

## 2026-11-01 — Skill tuning: gemma as the main target

- **Tuning target** `[settled]` — Tom, 2026-11-01: the skill-tuning loop takes gemma-4-26b
  as its main target, with qwen3.8-flash-next as the second. qwen3.8-27b is
  only a regression guard. This changes the earlier ruled order, which tuned on qwen3.8-flash-next
  then qwen3.8-27b and only re-ran Gemma, because the local-model probe
  gave gemma the failures a skill edit can reach
  and qwen almost none. gpt-oss-120b is parked for now.

## 2026-11-01 — Skill-tuning loop: Opus driver, pooled keep rule

- **Driver** `[settled]` — Tom, 2026-11-01: the skill-tuning loop (a driver script kept private) is
  driven by Opus through `claude -p`, not Sonnet.
- **Keep rule** `[settled]` — Tom, 2026-11-01, approving the orchestrator's proposal after round
  1:
  - A candidate is judged on pass rates against the best skill's pooled record: every evaluation
    of it, plus the 3x baseline for the original.
  - gemma or qwen3.8-flash-next may supply the gain of 2 in 22.
  - gemma may lose at most 1 in 22, the targets' pooled held-out rate at most 1 in 12, and 27b
    at most 1 in 11.
  - flash runs 2 samples.
  - Round 1's edit is rescored under this rule, with its grading language removed.
- **Grading language** (orchestrator working choice, not Tom-approved): the skill must read as
  operating instructions. Candidates that add grading words ("counts as a fail", "graded",
  "scored", "wiring check", and similar) are rejected unscored.
- **Result of the first run:** no edit kept.
- **v01 adopted** `[settled]` — Tom, 2026-11-01: the repo skill takes v01, the load-program rule
  with its grading language removed. It "made Qwen better and didn't hurt Gemma": qwen3.8-flash-next
  97% against 89%, gemma 66% against 69%. That is inside the allowed loss, and only the gain bar
  rejected it. The skill stays open to further tuning. The Claude rungs have not yet run on it.

## 2026-11-02 — Skill r14 and tool aids for local models (orchestrator)

Orchestrator working choices under Tom's goal "get gemma passing tests, then try gpt-oss-120b";
not yet reviewed by Tom.

- **Skill r14 adopted into the repo skill.** Hand-written, not from the tuning loop. It adds an
  order of work (find the manual's circuit before wiring, even when it looks simple), a lookup
  recipe (`programs.md` by behaviour, then the fixture's `wires` through `manifest.json`), testing
  every input combination, one procedure step per call with nothing after the last, `press`
  already releases, use the session path the task names, and leave a finished circuit plugged in.
  - gemma-4-26b: 62/66 pooled over two 3-sample runs, against 26/33 on the skill at `56d59f3`.
  - qwen3.8-flash-next and qwen3.8-27b: 33/33 each, no regression.
  - gpt-oss-120b: 61/65 valid runs over two batches.
  - Candidate r15 scored 28/33 and was not adopted.
  - The Claude rungs have not run on r14.
- **Tool aids** (no change to `src/core/`, the contract, or any fixture, golden or manifest):
  - `disconnect all`; `new`'s "already exists" error names it.
  - Under the harness's session pin, a refused path prints the call to resend with the pinned path.
  - `help terminals` ends with a pointer to `programs.md` and the fixtures' `wires`.
  - `help terminals` says never to join a lamp's two ends (all 3 of gemma's failing III-RELAYOR
    circuits under r14-r16 had a `3A/3B` cord), and names the manuals' three-cord way for
    pushbutton n to work relay n (`n+/nY`, `nX/nC`, `nF/n-`, used by 15 programs). Added after r14
    was adopted; their full 3x run was in progress at commit time.
  - `--help`: `load-program` is for load or run tasks only; a finished circuit stays plugged in.
  - The model loop's `grep` ignores case. `MINIVAC_LLM_REQUIRE_API_BASE` stops a run at the first
    response another server answered.
- **gpt-oss-120b runs at concurrency 1** with the fallback guard.
- **Gemma at about 94% accepted** `[settled]` — Tom, 2026-11-02: gemma-4-26b's result with r14
  (31/33 on two full runs; III-RELAYOR passes about 60% of the time) is accepted. No further
  tuning for III-RELAYOR now; next are the qwen check on the current help text, then Sonnet and
  Haiku.
- **Cloud fallback stays on** `[settled]` — Tom, 2026-11-02: cloud fallback for gpt-oss-120b stays
  on; the harness guard already invalidates and retries any fallback-served run.

## 2026-11-02 — Claude rungs, skill candidate r19, gpt-oss at concurrency 3

- **Claude on r14** (orchestrator): Sonnet 5.5 30/33, Haiku 5.5 30/33, all
  served by api.anthropic.com. Both failed only OP2, by holding button 3 down.
- **Skill candidate r19, not adopted** (orchestrator): r14 plus two procedure rules. A pushbutton
  push is one `button <n> press` whatever the task calls it. List the steps from the task's own
  words before the first press, not from the manual's longer procedure. Haiku: OP2 9/9, all items
  33/33. r17 and r18 were steps to it. On the
  other models: both qwens 33/33; gemma-4-26b 30/33 and 28/33, against 31/33 twice on r14. gemma
  used `load-program` on a wiring item in 5 of 12 IV-EXP4 and III-XOR-PB runs (0 of 12 on r14), and
  r19's "leave every button up" broke B2 ("keep holding it"). r20 fixes the hold rule (gemma B2
  6/6, Haiku B2 and OP2 6/6) but not the `load-program` habit, so neither is adopted and the repo
  skill stays r14. For Tom: r14 costs Claude OP2
  (30/33); r20 costs gemma-4-26b about two runs in 33.
- **gemma-4-31b (QAT) on r14: 33/33**, about 3.1 hours of model time for the 33 runs.
- **gpt-oss-120b at concurrency 3**: 33/33, no retries, no fallback-served response.
- **Haiku ahead of gemma; skill r20 adopted** `[settled]` — Tom, 2026-11-02: "let's prioritize
  haiku over gemma and make sure qwen didnt break". r20 on all 11 items x3: Haiku 33/33, qwen3.8-27b
  33/33, qwen3.8-flash-next 33/33. The accepted cost is
  gemma-4-26b at about 28-30/33 against 31/33 on r14. r21 (r14 plus only the press/hold rule) was
  tried in between: Haiku OP2 6/6, gemma IV-EXP4 3/6.
  - Why r20 over r21 (orchestrator): with Haiku ahead of gemma, r20 had the stronger Haiku record
    (33/33 on all items under r19; B2 and OP2 6/6 on r20). r20's planning bullet guards against
    Haiku's double reset press (1 run in 3 on r17), which r21 lacks. r21 did not spare gemma
    either: IV-EXP4 3/6 against 6/6 on r14. r21 never had a full 11x3 run.

## 2026-11-02 — Dial item OP3; orchestrator choices ratified

- **Dial item** `[settled]` — Tom, 2026-11-02: an operate item, OP3, on `I-EXP11` (Book I
  Experiment 11, Manual Operation of Rotary Switch; tier C1, verified, five cords). No fixture that
  uses the dial is tier A. Prompt: "Load the manual rotary switch circuit, turn the pointer to 1,
  then to 2." Its two checkpoints are I-EXP11's own expects for positions 1 and 2.
- **Dial steps match any angle** `[settled]` — Tom, 2026-11-02: a dial step is taken by a dial
  hold at any angle, and its checkpoint, which the checker requires to name `dial`, carries the
  position. On MV601-REF-A contact 1 holds from about 15 to 30 degrees and contact 2 from about
  37.5 to 52.5 (measured with `minivac-control`).
- **Dial release after the last step** `[settled]` — Tom, 2026-11-02: a `dial release` after the
  last dial step is not a further command under "nothing after the last step". With no motor wired
  the pointer stays put; if a wired motor moves it, the end state catches it.
- **Orchestrator choices ratified** `[settled]` — Tom, 2026-11-02 ("keep all"): these working
  choices are now rulings, as recorded in their entries:
  - 2026-10-31 time, session file and code location: the capped settle per call and `wait` (O1),
    `minivac.session/1` (O2), code outside `src/core/` with `bin/minivac-control` (O7);
  - 2026-10-31 checklist mechanics: the separate `bin/minivac-check`, items in `checklist/items/`,
    lamp reads, the run records;
  - 2026-10-31 operating-item and load-program mechanics;
  - 2026-11-01 the grading-language rule for skill candidates;
  - 2026-11-02 the tool aids: `disconnect all`, the `help terminals` lines, the `--help` lines,
    the case-insensitive `grep`, `MINIVAC_LLM_REQUIRE_API_BASE`.
  Rebuilding the session on every call (the 2026-10-31 "Shape" ruling) is not reopened here; whether
  stage 3 keeps a live machine instead is a separate open question.

## 2026-11-02 — Stage 2 closed

- **Stage 2** `[settled]` — Tom, 2026-11-02: closed. The record it closes on: the hands loop
  (`tools/hands-api/openai-loop.ts`), skill r20, and the checklist runs: the first 11 items on the
  local and Claude rungs, OP3 on the local rungs, each with its results
  record. Sonnet 5.5 on r20 and the Claude rungs on OP3 are parked, not owed.

## 2026-11-02 — Stage 3 shape: machine in the page, local loop, default route

- **Machine** `[settled]` — Tom, 2026-11-02: the chat pane operates the web build's own live
  machine in the page, through the `src/hands/` tool table (filesystem-free so a browser pane can
  reuse it, 2026-10-31 O7). Nothing is rebuilt per call in the pane; `minivac-control` keeps
  rebuilding the session on every call for checklist runs.
- **Model loop (O12)** `[settled]` — Tom, 2026-11-02: a local process on the dev machine holds the
  LiteLLM key, calls the model, and passes tool calls to the page over a localhost WebSocket. The
  pane is dev-only; the public static build stays keyless and unchanged.
- **Default route** `[settled]` — Tom, 2026-11-02: a selectable default route serving
  qwen3.8-flash-next (33/33 on r20, 3/3 on OP3), which may fall back to a cloud model on error or
  timeout.

## 2026-11-02 — Stage 3 plan rulings

Tom approved the stage 3 plan on 2026-11-02; like the pane, it stays out of the public copy.

- **Instant calls** `[settled]` — Tom, 2026-11-02: in the pane each model call runs synchronously
  through the tool table and the panel shows the settled state. Real-time animation of a call is
  out of v1.
- **Frozen and locked** `[settled]` — Tom, 2026-11-02: in pane mode simulated time moves only inside
  the model's calls, as with the CLI, and the panel takes no input. Ending the session hands back
  the machine as the model left it, live and unlocked.
- **Stage 3 bar** `[settled]` — Tom, 2026-11-02: every checklist item passes at least once from the
  pane on the default route, run x3; each result reproduces from its exported session file; and Tom has
  used the pane hands-on.
- **Public copy** `[settled]` — Tom, 2026-11-02: the public copy excludes the pane entirely,
  with its tests. (Superseded 2026-11-03, "Chat pane in the public copy".)

## 2026-11-03 — Stage 3 build: orchestrator working choices

Orchestrator working choices made while building the plan, not Tom-approved.

- **Text identical by construction** — Node parses the model's words and renders the text with the
  CLI's own code; the page returns data. The transfer test runs 15 recorded model sequences through
  the CLI and the pane engine and requires identical text, exit codes and sessions.
- **Rejected batches validated, not rebuilt** — `validateBatch` checks a call before it touches the
  live machine; a live run that rejects after validation passed ends the session.
- **Remount, not resync** — after each call the page remounts on the same machine, frozen and
  locked. The live trace and sound stay blank in pane mode; the pane's transcript shows the calls.
- **The server** — a separate Node process (`ws` 8.22.0), not Vite's socket; 127.0.0.1 only, a
  per-launch token, exact Origin and Host checks, a route allowlist; key and base URL from env
  only and never sent to the page; gateway error bodies stay in the transcript.
- **Invalid runs** — any engine error ends the pane session and marks the run invalid, as does a
  page disconnect or reload while a session is live; SIGINT/SIGTERM mark live runs interrupted;
  `run.json` says `running` while a turn is in flight. New session hands the machine back live (as
  End session does) and clears the transcript.
- **`run.json`** — openai-loop's keys summed across user messages, plus `prompts`, `errors` (per
  prompt) and `invalid`. `read_file pane.json` reads the run's current `session.json`.
- **File tools** — the model's `grep` stops after 10 s; the tools refuse hidden path parts,
  `node_modules` and `.git` in any case, and links that lead outside the repo.
- **Fallbacks** — a hands-on session only flags a fallback-served reply (its badge turns before
  its calls run). The checklist driver refuses one before it touches the machine and retries, up to
  3 attempts; an HTTP error with no served base counts as off-primary; a turn that threw is a
  driver error, not graded.
- **Public copy** — also leaves out the stage 3 plan. `tools/check-dist.ts` runs after every build
  and is carried, naming the pane strings it looks for.

## 2026-11-03 — Pane hands-on: show the model working; cord animation deferred

Tom's first hands-on session (tic-tac-toe wired) went quiet
for a long reply (2,580 tokens before one 70-cord batch), and then every cord appeared at once.

- **Model working** `[settled]` — Tom, 2026-11-03: yes. While a request to the model is out, the
  pane shows "waiting for <route> · request <n> · <s> s" at the transcript's end until the reply
  is in (the server's `requesting` frame, PANE_PROTOCOL 3).
- **Cord-by-cord animation** `[deferred]` — Tom, 2026-11-03: deferred. A batch still lands at once,
  per "Instant calls" (2026-11-02).

## 2026-11-03 — The model's file tools read only the manuals' research and the fixtures; `connect` takes a free end

Tom's second hands-on session (tic-tac-toe again) hit the two
free-ended leads in `VI-TICTACTOE.fixture.json`, which `connect` could not plug, and the model
went through `src/`, `tools/hands/`, `dotnet/` and `dist/` looking for a way. Across the Oct–Nov
run transcripts, 4 checklist runs had also read their own `checklist/items/<id>.json`, which holds
the end state they are graded on.

- **File-tool scope** `[settled]` — Tom, 2026-11-03: narrow. `read_file`, `grep` and `list_files`
  read only `docs/research/` and `test/conformance/fixtures/` (the skill's lookups:
  `tools/hands-api/repo-files.ts` READABLE), plus the run's own session file; above those trees a
  listing or grep shows only the way down. Runs from here on are not like-for-like with the
  earlier checklist runs, which could read the whole repository.
- **Free cord ends** `[settled]` — Tom, 2026-11-03: `connect <A>/free` plugs a cord into A with its
  other end hanging free (the contract's `free` end), as tic-tac-toe's two leads are; `state` shows
  it as `M10/free (M10#3 free)`, and a move is `disconnect <id>` then `connect <A>/<B>`, as the
  fixture plays it. The checker counts such a cord as an extra cord on a basic item and leaves it
  out of a wire item's circuit, since it joins nothing. The skill is unchanged; `--help` names
  the syntax.

## 2026-11-03 — Stage 3 closed

- **Stage 3** `[settled]` — Tom, 2026-11-03: closed, and with it the hands roadmap. The record it
  closes on: the chat pane and its plan (both kept out of the public copy); the checklist from the
  pane on the default route, every item passing at least once and each verdict reproducing from
  its session file; and Tom's three hands-on sessions, the third wiring tic-tac-toe and making the
  machine's first move. Cord-by-cord animation stays deferred. The orchestrator working choices of
  2026-11-03 ("Stage 3 build") stay working choices until Tom rules on them.

## 2026-11-03 — Public snapshot calls

The public GitHub copy is public now, so each snapshot is published for good. For the snapshot of
stages 2 and 3:

- **Tools** `[settled]` — Tom, 2026-11-03: everything the snapshot carries goes public except
  the skill-tuning driver, which names the lab's models and routes.
- **Doc scrub** `[settled]` — Tom, 2026-11-03: the public DECISIONS and STATUS lose lab and
  personal detail: gateway routes, infrastructure and server placement, keys, spend caps, billing
  and costs, and personal goals. Public model names, pass rates and Tom's attributed rulings stay.
- **References** `[settled]` — Tom, 2026-11-03: the public DECISIONS, STATUS and `CLAUDE.md` lose
  paths to the private run records, the chat pane and the skill-tuning driver, and the public
  `package.json` loses the pane's dev script. Code comments that mention the pane stay, so later snapshots do not conflict on
  them. (The pane clauses are superseded 2026-11-03, "Chat pane in the public copy".)

## 2026-11-03 — Public commit titles

- **Titles say what the snapshot adds** `[settled]` — Tom, 2026-11-03: a public commit is titled
  for what it adds, in `[SCOPE]: description` form, and does not name the private repo or a private
  sha. The last snapshot is the private source repo's `public-snapshot` tag, which
  `tools/public-snapshot.sh mark <rev>` moves after the public commit lands.
- **One-time force-push** `[settled]` — Tom, 2026-11-03: the four public commits were retitled and
  force-pushed to GitHub and the staging repo (`74c91fc` → `87015c2`, trees byte-identical,
  authors and dates kept; 0 forks, 0 stars at the time). The old head stays on the public copy's
  local branch `backup/pre-retitle-74c91fc`. Never force-push again stands.

## 2026-11-03 — Chat pane in the public copy

- **The pane is public** `[settled]` — Tom, 2026-11-03, approving the plan: the public copy carries
  the chat pane (`dev.html`, `src/pane/`, `tools/hands-pane/server.ts` and its guide, their tests
  and fixtures) as a local tool for a model of your own: any OpenAI-compatible endpoint with tool
  calls, with your own key. The public static build stays keyless and unchanged. This supersedes
  the 2026-11-02 "Public copy" ruling and the pane clauses of 2026-11-03 "References".
- **The checklist driver stays private** `[settled]` — Tom, 2026-11-03:
  `tools/hands-pane/run-checklist.ts` and its browser test are not carried; its fallback guard
  needs a LiteLLM proxy's served-by header.
- **The stage 3 plan is carried** `[settled]` — Tom, 2026-11-03: `docs/plans/stage-3-chat-pane.md`
  is scrubbed at source and carried, so the pane's citations of it resolve.
- **Routes from the environment** `[settled]` — Tom, 2026-11-03: the server takes the models the
  page may pick from `MINIVAC_PANE_ROUTES` (comma-separated, the default first) and refuses to start
  without it.
- **Working choices stay working choices** `[settled]` — Tom, 2026-11-03: the 2026-11-03 "Stage 3
  build" working choices are published as they are, still not Tom-approved.

Orchestrator working choices, not Tom-approved:

- **Scrub at source** — every carried pane file is made public-safe here, so a snapshot carries it
  unchanged; `test/private/` holds the specs that read private files and is not carried.
- **Run folder** — `MINIVAC_PANE_RUNS`, default `pane-runs/`; `.gitignore` covers it and `.env*`.
  The startup line names the folder.
- **No badge without a served-by header** — a reply from an endpoint that does not say who served
  it gets no "served by ?" badge; fallbacks, cost and a failed request still show.
