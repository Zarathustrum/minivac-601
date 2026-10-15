/**
 * The solver's two halves, against the criteria as corrected in
 * `docs/DECISIONS.md`, *2026-08-30 — Phase 1 Wave 1a spec readings (orchestrator)*.
 *
 * Half 1 proves the reference is RIGHT: every expectation below is derived from architecture
 * §3.1-§3.4, §4.1 and §4.2 and from `components.md` §8.2, by arithmetic done off the solver. None
 * of it was read off a solver run and pasted back. Where a number needs an iteration to reach
 * (the filament's self-consistent point), the iteration is a one-line scalar recurrence over the
 * §8.2 loop equation, which shares no code with the network solve it checks.
 *
 * Half 2 proves the reference is FROZEN: `data/kat/solver-kat.json` runs, every case's `expect` is
 * compared as hex strings, and the file's own structural claims are asserted.
 *
 * Three tests here once failed against `src/core/solve.ts`. All three have been adjudicated;
 * `docs/DECISIONS.md` carries the rulings (*2026-08-30 — Phase 1 Wave 1a spec readings* and
 * *2026-08-31 — O-E11 arc-pass latch*), and each is marked below with what was ruled and why:
 *
 *   - "no node voltage exceeds V_arc_clamp" — the PLAN's criterion overstates what two solves can
 *     promise, because `Garc = |i_prev|/V_arc` is exactly zero for a coil carrying no current.
 *     Restated as the two things that are true and load-bearing, and passing.
 *   - "no branch current moves more than V_arc*dt/L" — the SPEC's arithmetic dropped the `i*R`
 *     term. The corrected bound is asserted; the failing form is deleted. The PRUNED hand-ramp
 *     does satisfy the literal figure and is still asserted separately.
 *   - "two coils in series reach the same DC operating point" — a REAL CODE DEFECT in the settled
 *     `ARC-CLAMP` mechanism of O-E11. It is NOT fixed and NOT deleted: it is an `it.fails` so it
 *     stays machine-checked and breaks loudly the day someone repairs it.
 */
import { describe, expect, it } from 'vitest';
import {
  createSolveWorkspace,
  pwlLookup,
  tickSolve,
  tickSolveGraphInto,
  tickSolveInto,
} from '../src/core/solve.ts';
import type { Carried, El, SolveCfg, TickResult } from '../src/core/solve.ts';
import katJson from '../data/kat/solver-kat.json';
import { runPwlCase, runQuantizeCase, runSolveCase } from './kat-run.ts';
import type { KatFile } from './kat-run.ts';
import {
  DT_S,
  GMIN_S,
  I_PULLIN,
  K_THERMAL,
  L_COIL,
  R_COIL,
  R_COLD,
  R_SRC,
  V_ARC,
  V_OC,
  makePwl,
  tungsten,
} from './mv601-ref.ts';

const PWL = makePwl();

/** `noUncheckedIndexedAccess` is on. Every indexed read of a solver output goes through here. */
function at(a: ArrayLike<number>, i: number): number {
  return a[i] as number;
}

function cfg(datum = 0, gmin = GMIN_S): SolveCfg {
  return { dtS: DT_S, vArc: V_ARC, kThermal: K_THERMAL, gminS: gmin, pwl: PWL, datum };
}

function carried(iCoil: readonly number[], rLamp: readonly number[]): Carried {
  return { iCoil: Float64Array.from(iCoil), rLamp: Float64Array.from(rLamp) };
}

const coil = (a: number, b: number): El => ({ k: 'coil', a, b, rOhm: R_COIL, lH: L_COIL });
const lamp = (a: number, b: number): El => ({ k: 'lamp', a, b });
const res = (a: number, b: number, rOhm: number): El => ({ k: 'res', a, b, rOhm });
const source = (a: number, b: number): El => ({ k: 'source', a, b, vOc: V_OC, rSrcOhm: R_SRC });

function runTicks(els: readonly El[], c: Carried, cf: SolveCfg, ticks: number): TickResult {
  let r = tickSolve(els, c, cf);
  for (let t = 1; t < ticks; t++) r = tickSolve(els, c, cf);
  return r;
}

// The three derived quantities §3.3 and §4.2 name, written with the spec's own parenthesisation so
// a bit-exact comparison against the solver is meaningful.
const GEQ = 1 / (R_COIL + L_COIL / DT_S); // the R-L companion conductance, 1/12150 S
const FREEWHEEL = (L_COIL / DT_S) / (R_COIL + L_COIL / DT_S); // §3.3's 0.9877 per tick
const ARC_STEP = (V_ARC * DT_S) / L_COIL; // §4.2's V_arc/L ramp over one tick, 2.5 mA

/**
 * The lowest pull-in current any relay reaches under Wave D's shipped offset vector
 * `[-282,-169,-56,56,169,282]` mV on a 6.5 V nominal: relay 1 at 6.218 V into 150 ohm.
 */
const I_PULLIN_LOWEST = (6500 - 282) * 1e-3 / R_COIL; // 41.453 mA

// ---------------------------------------------------------------------------------------------
// Half 1 — correctness against closed-form arithmetic
// ---------------------------------------------------------------------------------------------

describe('divider — the E-fed bare coil across the rail (§4.1, components.md §8.2)', () => {
  // 3000 ticks is 37.7 of the loop's L/R time constants (1.2 H / 150.67 ohm = 7.96 ms = 79.6
  // ticks), which is more than double precision has room to keep moving through. The stability
  // test below proves that rather than assuming it.
  const SETTLE = 3000;
  const ELS = [coil(1, 0), source(1, 0)];

  it('settles at V_oc / (R_src + R_coil) = 86.3 mA', () => {
    const c = carried([0], []);
    const r = runTicks(ELS, c, cfg(), SETTLE);
    const closed = V_OC / (R_SRC + R_COIL); // 13 / 150.67 = 86.281 mA

    // The only thing standing between the solve and the closed form is §3.1.5's gmin: 1 nS across
    // the settled 12.942 V shunts 1.29e-8 A around the coil, which moves the coil current by
    // i * R_src * gmin = 5.8e-11 A. 1e-9 A is that, with an order of magnitude to spare, and is
    // 1.2e-8 of the answer -- six orders tighter than the 2.8% §3.4 says must not be settled for.
    expect(Math.abs(at(r.branchI, 0) - closed)).toBeLessThan(1e-9);
    expect(Math.abs(at(r.v, 1) - (V_OC * R_COIL) / (R_SRC + R_COIL))).toBeLessThan(1e-7);
  });

  it("matches §4.1's coil arithmetic table: 150.67 ohm loop, 86.3 mA", () => {
    const c = carried([0], []);
    const i = at(runTicks(ELS, c, cfg(), SETTLE).branchI, 0);
    expect(Math.abs(i - 86.3e-3)).toBeLessThan(0.05e-3);
    expect(Math.abs(V_OC / i - 150.67)).toBeLessThan(0.01);
    // The table's i_pullin / i_final = 0.502, which is why the bare coil pulls in fast.
    expect(Math.abs(I_PULLIN / i - 0.502)).toBeLessThan(0.001);
  });

  it('the fixed point is stable: another 100 ticks does not move it', () => {
    const c = carried([0], []);
    const settled = at(runTicks(ELS, c, cfg(), SETTLE).branchI, 0);
    const later = at(runTicks(ELS, c, cfg(), 100).branchI, 0);
    expect(Math.abs(later - settled)).toBeLessThan(1e-15);
  });
});

describe('divider — the C-fed coil through its indicator lamp (§4.1, §3.4, AT-01)', () => {
  // The filament relaxes on tau = 40 ms = 400 ticks (§3.4), so the thermal state, not the R-L
  // rise, sets the settling time. 20000 ticks is 50 tau. NOTE: `gen-solver-kat.ts`'s comment on
  // `lamp-warm-relaxation` calls 500 ticks "12.5 tau"; 500 ticks is 50 ms, which is 1.25 tau, and
  // at 500 ticks this loop is still 13% away from its answer. The KAT case is unaffected -- it
  // freezes whatever 500 ticks produces -- but 500 ticks would not prove settling here.
  const SETTLE = 20000;
  const ELS = [lamp(1, 2), coil(2, 0), source(1, 0)];
  const COIL_I = 1; // element index of the coil

  /**
   * The self-consistent point of §3.4, computed OUTSIDE the solver: one scalar equation,
   * `i = V_oc / (R_src + R_lamp(i) + R_coil)`, iterated against a resistance law until it stops
   * moving. `pwlLookup` is the only solver-side code in here and it is proved separately below.
   */
  function selfConsistent(law: (i: number) => number): { i: number; rLamp: number } {
    let i = 0;
    for (let k = 0; k < 20000; k++) i = V_OC / (R_SRC + law(i) + R_COIL);
    return { i, rLamp: law(i) };
  }
  const REF = selfConsistent((i) => pwlLookup(PWL, i));

  it('settles at the self-consistent PWL point, not near it', () => {
    const c = carried([0], [R_COLD]);
    const r = runTicks(ELS, c, cfg(), SETTLE);
    // 5e-8 A is 1.1e-6 of the answer. It is the gmin leak again -- two solved nodes this time, at
    // 12.97 V and 6.93 V, so ~2e-8 A of shunt the scalar reference does not model.
    expect(Math.abs(at(r.branchI, COIL_I) - REF.i)).toBeLessThan(5e-8);
    expect(Math.abs(at(c.rLamp, 0) - REF.rLamp)).toBeLessThan(1e-4);
  });

  it("matches §4.1's coil arithmetic table: ~281.7 ohm loop, 46.2 mA", () => {
    const c = carried([0], [R_COLD]);
    const i = at(runTicks(ELS, c, cfg(), SETTLE).branchI, COIL_I);
    expect(Math.abs(i - 46.2e-3)).toBeLessThan(0.05e-3);
    // §4.1 prints 281.7 ohm; the shipped 33-breakpoint table lands the filament at 130.61 ohm, so
    // the loop is 281.28 ohm. The 0.42 ohm is the table's chord error against the closed-form law,
    // which is the difference the next test bounds.
    expect(Math.abs(V_OC / i - 281.7)).toBeLessThan(1.0);
    // AT-01: the latch holds through the lamp because V_coil clears the 6.5 V pull-in. §8.2 prints
    // 6.92 V.
    const vCoil = at(runTicks(ELS, c, cfg(), 1).v, 2);
    expect(vCoil).toBeGreaterThan(6.5);
    expect(Math.abs(vCoil - 6.92)).toBeLessThan(0.02);
  });

  it("the table's fixed point and the closed-form law's agree to better than 0.1%", () => {
    // `mv601-ref.ts` claims ~0.04% for the 33-breakpoint table. This is the check that the PWL is
    // a faithful stand-in for `R_hot * (I/I_hot)^0.36`, which is why §3.4 is allowed to ban `pow`.
    const closed = selfConsistent(tungsten);
    expect(Math.abs(REF.i - closed.i) / closed.i).toBeLessThan(1e-3);
  });

  it('the fixed point is stable: another 100 ticks does not move it', () => {
    const c = carried([0], [R_COLD]);
    const settled = at(runTicks(ELS, c, cfg(), SETTLE).branchI, COIL_I);
    const later = at(runTicks(ELS, c, cfg(), 100).branchI, COIL_I);
    expect(Math.abs(later - settled)).toBeLessThan(1e-15);
  });
});

describe('series-through-float — O-T6 (§3.1.4, §4.2 row 3)', () => {
  // Book II p.12's flip-flop: two coils in series to node 2, which carries nothing else. §3.1.4
  // decides this structurally -- node 2 reaches the source *through* the coils, so it is in the
  // source component and is not pruned.
  const ELS = [coil(1, 2), coil(2, 0), source(1, 0)];
  const SETTLE = 3000;

  it('the middle node is not reported floating and has a real voltage', () => {
    const c = carried([0, 0], []);
    const r = tickSolve(ELS, c, cfg());
    expect(at(r.floating, 2)).toBe(0);
    expect(Number.isNaN(at(r.v, 2))).toBe(false);
  });

  it('it solves as a divider: V_oc/(R_src + 2*R_coil), and node 2 sits at half the rail', () => {
    const c = carried([0, 0], []);
    const r = runTicks(ELS, c, cfg(), SETTLE);
    const closed = V_OC / (R_SRC + 2 * R_COIL); // 13 / 300.67 = 43.237 mA
    // Both coils carry it, to within the 6.5e-9 A that gmin leaks out of node 2 between them.
    expect(Math.abs(at(r.branchI, 0) - closed)).toBeLessThan(1e-8);
    expect(Math.abs(at(r.branchI, 1) - closed)).toBeLessThan(1e-8);
    expect(Math.abs(at(r.v, 2) - at(r.v, 1) / 2)).toBeLessThan(1e-6);
  });

  it('relay 2 sits near half the single-coil current, which is what a union-find core gets wrong', () => {
    const c = carried([0, 0], []);
    const i = at(runTicks(ELS, c, cfg(), SETTLE).branchI, 1);
    const half = V_OC / (R_SRC + R_COIL) / 2; // 43.141 mA
    // Not exactly half: the one R_src is shared across twice the coil resistance, worth 0.096 mA.
    expect(Math.abs(i - half)).toBeLessThan(0.15e-3);
    // And it lands just under the nominal 43.333 mA pull-in -- 0.1 mA of margin, which is the
    // knife edge §4.1 says the corpus's counter lives on.
    expect(i).toBeLessThan(I_PULLIN);
  });
});

describe('a genuinely floating island (§3.1.4)', () => {
  it('is pruned, reported floating, and its voltage is NaN', () => {
    // Nodes 5 and 6 carry a resistor and nothing else: no element path to the source element's
    // nodes, so the walk of §3.1.4 never reaches them.
    const c = carried([0], []);
    const r = tickSolve([coil(1, 0), res(5, 6, 100), source(1, 0)], c, cfg());

    expect(at(r.floating, 5)).toBe(1);
    expect(at(r.floating, 6)).toBe(1);
    expect(Number.isNaN(at(r.v, 5))).toBe(true);
    expect(Number.isNaN(at(r.v, 6))).toBe(true);
    // A pruned non-coil carries 0 (a pruned coil is the arc ramp instead -- see below).
    expect(at(r.branchI, 1)).toBe(0);

    // The datum and the source node are of course not floating.
    expect(at(r.floating, 0)).toBe(0);
    expect(at(r.floating, 1)).toBe(0);
    expect(r.arcPass).toBe(false);
    expect(r.openRamp).toBe(false); // the pruned element is a resistor, not a coil
  });
});

describe('the arc clamp (§3.3, §4.2, §3.2 step 5)', () => {
  const I0 = 86.3e-3; // an energised coil at the E-fed asymptote

  // The prune of §3.1.4 splits "the feeding contact opened" into two structurally distinct paths,
  // and only one of them is the arc pass:
  //
  //   OPEN_TO_DATUM  coil(5,0): node 5 is touched by nothing else, but node 0 IS the datum and the
  //                  source's own node, so the walk reaches node 5 *through the coil*. Both ends
  //                  are in the source component, the coil is stamped, and pass 2 of §3.2 fires.
  //   ISLAND         coil(8,9): neither end reaches the source. The coil is pruned out of the
  //                  matrix entirely and takes solve.ts's flagged interpretation instead -- a flat
  //                  V_arc*dt/L ramp, no solve involved.
  const OPEN_TO_DATUM = [coil(5, 0), source(1, 0)];
  const ISLAND = [coil(8, 9), source(1, 0)];

  it('the two paths are distinct: one is solved and clamped, the other is pruned and ramped', () => {
    const a = tickSolve(OPEN_TO_DATUM, carried([I0], []), cfg());
    expect(at(a.floating, 5)).toBe(0);
    expect(Number.isNaN(at(a.v, 5))).toBe(false);

    const b = tickSolve(ISLAND, carried([I0], []), cfg());
    expect(at(b.floating, 8)).toBe(1);
    expect(Number.isNaN(at(b.v, 8))).toBe(true);

    // The two mechanisms are reported separately (`TickResult.arcPass` vs `openRamp`), because
    // conflating them made `arcPass` true on a circuit where zero re-solves ran. OPEN_TO_DATUM runs
    // the second solve of §3.2 step 5 and takes no hand-ramp; ISLAND runs ONE solve and takes the
    // hand-ramp of the doubly-pruned block instead.
    expect(a.arcPass).toBe(true);
    expect(a.openRamp).toBe(false);
    expect(b.arcPass).toBe(false);
    expect(b.openRamp).toBe(true);
  });

  it('the arc pass holds the open coil under V_arc, where the raw companion would put -1035 V', () => {
    const r = tickSolve(OPEN_TO_DATUM, carried([I0], []), cfg());
    // Pass 1 puts node 5 at -Ieq/(Geq + gmin) = -0.085234 / 8.2305e-5 = -1035.6 V, which is §3.3's
    // "~1 kV on a panel jack". Pass 2 adds Garc = i_prev/V_arc = 2.8767e-3 S, giving
    // -0.085234 / 2.95897e-3 = -28.81 V. The ceiling is Geq*(L/dt)*V_arc = 0.98765 * 30 = 29.63 V,
    // so a single coil to the datum can never break the clamp however large i_prev is.
    expect(Math.abs(at(r.v, 5))).toBeLessThan(V_ARC);
    expect(Math.abs(at(r.v, 5))).toBeGreaterThan(28);
  });

  it('the pruned coil ramps at exactly V_arc*dt/L and reaches zero in ~3.5 ms', () => {
    // KEPT DELIBERATELY, alongside the corrected in-matrix bound below. This path is a hand-written
    // ramp rather than a solve, so it is the one place the literal §4.2 figure holds exactly, and
    // the two release paths therefore disagree with each other on rate. It is also the project's
    // ruling on §3.1.4's hole — a coil pruned at BOTH ends has no solved voltage and rule 16 still
    // demands a current — so it is a contract in its own right and must not drift.
    const c = carried([I0], []);
    const r = tickSolve(ISLAND, c, cfg());
    // Bit-exact against §4.2's ramp, with solve.ts's parenthesisation.
    expect(at(r.branchI, 0)).toBe(I0 - ARC_STEP);

    // DERIVED from `ARC_STEP` rather than pinned, because the ramp is flat: the branch loses
    // exactly `V_arc*dt/L` per tick with a floor at zero, so the count is `ceil(I0 / ARC_STEP)` at
    // ANY inductance. `toBe(35)` was arithmetic at 1.2 H (ceil(86.3 mA / 2.5 mA) = ceil(34.52)),
    // and 1.2 H is `mv601-ref.ts`'s KAT test vector, not authority for the profile's independently
    // retained `L_coil_uh`. The count is 26 ticks at
    // 0.9 H and 44 at 1.5 H, so the pinned literal was false at both ends of the band. Derivation
    // is the right strategy here rather than restatement because the exactness IS the test: the
    // ramp must take the ramp's count and not one tick more, and the last tick must be the one
    // clamped to zero by `mag > 0 ? mag : 0`.
    //
    // The 8 ms bound below is the load-bearing claim (§4.2: the release must finish inside §4.4's
    // mechanical release stroke) and it is already band-wide — 4.4 ms at 1.5 H is the slowest the
    // band allows.
    const expectedTicks = Math.ceil(I0 / ARC_STEP);
    let ticks = 1;
    for (;;) {
      ticks++;
      if (at(tickSolve(ISLAND, c, cfg()).branchI, 0) === 0) break;
      expect(ticks).toBeLessThan(100);
    }
    expect(ticks).toBe(expectedTicks);
    expect(ticks * DT_S).toBeLessThan(8e-3);
  });

  it('the dead coil at a series junction never reaches pull-in on the tick the artifact would fire', () => {
    // §3.3's own argument: unclamped, backward Euler drags both series currents to the arithmetic
    // mean of 86.3 mA and 0 in ONE tick -- 43.15 mA, above relays 2, 4 and 6's pull-in -- and
    // §4.3's direction latch would make that permanent. This is the claim the clamp exists for.
    const r = tickSolve([coil(1, 2), coil(2, 0), source(1, 0)], carried([I0, 0], []), cfg());
    const iDead = at(r.branchI, 1);

    expect(iDead).toBeLessThan(I_PULLIN); // 3.35 mA against 43.333 mA nominal
    expect(iDead).toBeLessThan(I_PULLIN_LOWEST); // and against 41.453 mA, Wave D's lowest relay
    expect(iDead).toBeLessThan(I0 / 2 / 5); // an order of magnitude below the unclamped artifact
  });

  it('every CURRENT-CARRYING coil branch is held at or below the clamp, and the dead one never pulls in', () => {
    // RESTATED, per DECISIONS *2026-08-30 — Phase 1 Wave 1a spec readings*. The original Wave 1a
    // criterion said "no node voltage exceeds V_arc_clamp_mv". That is false as printed, and it is
    // false BY CONSTRUCTION rather than by accident: `Garc = abs(i_prev)/V_arc` (§3.3), so a coil
    // carrying ZERO current gets an arc conductance of exactly zero and is not clamped at all. At
    // the series junction the dead coil's Garc is 0/30 = 0, nothing holds node 2 down, and it
    // solves to 40.672 V against a 30 V clamp. §3.2 forbids a third solve, so no amount of
    // iteration reaches it either.
    //
    // The fix is NOT a floor constant on Garc. That would be a new invented number chosen to make a
    // printed sentence true — the `dV_relay_mv` curve-fitting pattern this project rejects by name —
    // and O-E11 already carries one invented constant. So the criterion is restated as the two
    // things that ARE true and that are what O-E11 exists to provide:
    //
    //   (i) every coil branch that carries current is held at or below the clamp;
    //  (ii) the dead coil in the series-junction idiom never reaches any relay's pull-in on the
    //       tick the unclamped artifact would fire.
    //
    // (ii) duplicates the dedicated test above on purpose: it is half of the restated criterion and
    // deleting it here would leave the restatement asserting only half of itself.
    const junction = tickSolve([coil(1, 2), coil(2, 0), source(1, 0)], carried([I0, 0], []), cfg());
    const open = tickSolve(OPEN_TO_DATUM, carried([I0], []), cfg());

    // (i) The live coil at the junction spans nodes 1 and 2 and carries 86.3 mA: -27.674 V.
    const vLive = at(junction.v, 1) - at(junction.v, 2);
    expect(Math.abs(vLive), `live coil branch = ${vLive} V`).toBeLessThanOrEqual(V_ARC);
    // The same for the single open coil to the datum: -28.805 V, and §3.3's ceiling on that branch
    // is Geq*(L/dt)*V_arc = 0.98765 * 30 = 29.63 V however large i_prev is.
    const vOpen = at(open.v, 5) - 0;
    expect(Math.abs(vOpen), `open-to-datum coil branch = ${vOpen} V`).toBeLessThanOrEqual(V_ARC);

    // And the dead coil is the one that is NOT held: 40.672 V, recorded here so the restatement
    // says what it excludes rather than quietly not testing it.
    expect(Math.abs(at(junction.v, 2))).toBeGreaterThan(V_ARC);

    // (ii) 3.35 mA against a 43.333 mA nominal pull-in and 41.453 mA for Wave D's lowest-offset relay.
    const iDead = at(junction.branchI, 1);
    expect(iDead).toBeLessThan(I_PULLIN);
    expect(iDead).toBeLessThan(I_PULLIN_LOWEST);
  });

  it('an in-matrix branch current moves at most (V_arc + i*R_coil)*dt/L in one tick', () => {
    // CORRECTED, per DECISIONS *2026-08-30 — Phase 1 Wave 1a spec readings*. The original Wave 1a
    // criterion, §3.3 ("the current ramps down at V_arc/L per tick, 2.5 mA/tick on the shipped
    // numbers") and §4.2's Open row all state a 2.5 mA/tick ceiling. The solved cases move 3.4363
    // mA and 3.3475 mA -- 1.37x and 1.34x over -- and the SPEC'S ARITHMETIC IS WHAT IS WRONG, not
    // the code. It dropped the i*R term.
    //
    // The clamp holds the BRANCH voltage at V_arc, but the branch is R in series with L, so the
    // inductor sees V_arc *plus* the coil's own i*R drop, and the backward-Euler companion of §3.3
    // gives the step directly:
    //
    //   di = (V_arc * dt + i_prev * R_coil * dt) / (L + R_coil * dt)
    //      = (30 * 1e-4 + 0.0863 * 150 * 1e-4) / (1.2 + 150 * 1e-4)
    //      = (3.0e-3 + 1.2945e-3) / 1.215  =  3.5346 mA
    //
    // which is the arc ramp (2.47 mA) plus the L/R decay (1.07 mA). The measured 3.4363 mA sits
    // under it. Consequence recorded by W1b: the true open-release ramp
    // is ~40% faster than O-E11 states -- 86 mA to 0 in ~2.5 ms, not ~3.5 ms -- so the constraint
    // O-E11 places on `V_arc_clamp_mv` is looser than the document claims.
    //
    // The literal V_arc*dt/L figure is still asserted, above, on the PRUNED path, which is a
    // hand-written ramp rather than a solve and does satisfy it exactly. The two release paths
    // genuinely disagree on rate.
    const bound = (V_ARC * DT_S + I0 * R_COIL * DT_S) / (L_COIL + R_COIL * DT_S); // 3.5346 mA
    expect(bound).toBeGreaterThan(ARC_STEP); // the correction is what makes the difference

    const a = tickSolve(OPEN_TO_DATUM, carried([I0], []), cfg());
    const diOpen = I0 - at(a.branchI, 0);
    expect(diOpen, `open-to-datum coil moved ${diOpen} A, corrected ceiling ${bound} A`).toBeLessThanOrEqual(bound);
    expect(diOpen).toBeGreaterThan(ARC_STEP); // and it really does exceed the spec's printed figure

    const b = tickSolve([coil(1, 2), coil(2, 0), source(1, 0)], carried([I0, 0], []), cfg());
    const diJunction = at(b.branchI, 1);
    expect(diJunction, `series-junction dead coil moved ${diJunction} A`).toBeLessThanOrEqual(bound);
  });

  /**
   * A REAL CODE DEFECT in the settled `ARC-CLAMP` mechanism of O-E11. It is not repaired here and
   * it is not deleted: it is an `it.fails`, so it stays machine-checked and breaks loudly the day
   * someone fixes it.
   *
   * WHAT IS WRONG. Two coils in series between the rail and the datum must carry the SAME current —
   * they are in series — and at DC that current is `V_oc / (R_src + 2*R_coil)` = 43.2368 mA. §3.3
   * says so twice: "the R-L companion is exact at DC: at a fixed point i_n = i_{n-1} reduces to
   * i = v/R_coil, so adding inductance does not perturb the DC operating point", and "the arc
   * conductance does not reintroduce one". An R-L network's DC operating point cannot depend on its
   * initial conditions. On this circuit it does.
   *
   * MEASURED, reproduced by the orchestrator:
   *
   *   seed=[0,0]            tick 5000: i1=43.2368 i2=43.2368  d=0.0000  arc=false   <- correct
   *   seed=[86.3, 0] mA     tick 1:    i1=82.9569 i2=3.3475   d=79.6094 arc=true
   *   seed=[86.3, 0] mA     tick 5000: i1=46.1093 i2=40.3415  d=5.7677  arc=true    <- WRONG, permanent
   *   seed=[86.3, 86.3] mA  tick 5000: i1=43.2368 i2=43.2368  d=0.0000  arc=false   <- correct
   *   seed=[20, 10] mA      tick 100:  i1=35.1062 i2=35.1062  d=0.0000  arc=false   <- correct
   *   true DC = 43.2368 mA
   *
   * A LARGE initial imbalance drives the solver into a spurious stable attractor: two series
   * elements reporting a permanent 5.77 mA (14%) difference in current, with the arc pass armed
   * forever. A MILD imbalance recovers correctly, which is why the cold-start tests above are all
   * green and why this is invisible to the KAT, whose `arc-clamp-series-junction` case runs one
   * tick.
   *
   * WHY IT MATTERS RATHER THAN BEING A CURIOSITY. The two latched currents STRADDLE the 43.333 mA
   * nominal pull-in: 46.109 mA is above it and 40.342 mA is below. One relay reads energised and
   * the other does not, permanently, in a series circuit, and §4.3's direction latch then makes it
   * a permanent relay operation. It is the same class of artifact O-E11's clamp exists to prevent,
   * produced by the clamp. (This paragraph used to add that the shape is "exactly the `nE`/`mG`
   * chaining idiom of Books II and IV and of `ER-ALTCOUNTER`". The idiom is real, and the inference
   * from it is half right in a way worth stating exactly: the two COUNTERS it names are measured
   * clean — `IV-EXP1` and `ER-ALTCOUNTER` never fire the arc pass in any reachable state, on either
   * pushbutton axis — while the state does occur in `II-FF1`, `V-EXP9`, `V-EXP10`, `V-EXP13` and
   * `V-SUPERCIRCUIT`. See ACCEPTED UNREPAIRED below.)
   *
   * MECHANISM. Solve 1 is always run unclamped, so any mismatch i1 != i2 puts node 2 above V_arc in
   * pass 1 and re-arms the arc pass — on every tick, forever. `Garc` is stamped in parallel with
   * each coil and shunts the difference, but §3.3 deliberately leaves `Garc` out of the companion
   * used for `branchI`, so that shunt current is never reported and KCL at node 2 does not close.
   *
   * WHAT THIS PARAGRAPH USED TO SAY, AND WHY IT WAS WRONG. It named the repair as "gating the arc
   * pass on a genuinely open branch rather than on any pass-1 excursion". **That is now measured
   * false.** Wave A built an arming criterion that is EXACT against a resistive arc oracle — zero
   * mismatches over 400,000 random circuits — and it reproduces the latch below BIT FOR BIT:
   * 46.109272 / 40.341545 mA, arc armed on all 5000 ticks, and with it all 46 of the two-coil
   * sweep's permanent spurious latches. Correct arming does not touch this defect. The criterion
   * that appeared to cure it — peeling dead ends — only did so by declining to arm where physics
   * says an arc is needed, and it misclassifies 11 published programs including II-FF1, the
   * corpus's own primary timing fixture.
   *
   * WHAT PRODUCES IT IS THE PLACEMENT OF `Garc`, NOT THE ARMING. `Garc = |i_prev| / V_arc` is
   * stamped as a **parallel shunt across the coil**, so at a LIVE junction it keeps stealing the
   * imbalance for as long as the imbalance exists — which means the imbalance never closes and the
   * arc re-arms every tick, without end. A real arc is in **series across the opened gap**, and
   * architecture §3.1's node model gives the netlist no gap to put one across: a closed contact is
   * expressed by two element ends sharing a node id, so there is no place to insert a series
   * element when one opens. That is an architecture-level change belonging to W2's `graph.ts`, not
   * the ~20-line arming repair this comment used to scope.
   *
   * Including `Garc` in the reported branch current would close KCL here, but it would also
   * collapse an OPEN coil's current to ~0 in a single tick, which is the exact artifact the clamp
   * exists to prevent (§3.3's open-coil row, O-E11's whole rationale). The mechanism as specified
   * cannot satisfy both cases.
   *
   * ACCEPTED UNREPAIRED — on measurement, and NOT on "the state is unreachable", which was the
   * earlier ground and is false. `tools/corpus-reachability.ts` and `test/corpus-reachability.spec.ts`
   * re-run the evidence on every `npm test`, and what they now measure is this:
   *
   *   - the state the latch needs IS reached. Over 217,872 self-consistent settled configurations
   *     of the 90 parseable published programs, each relay driven through §4.3's own both-open
   *     transfer window, **1,122 put two coils in series through a bare node at mismatched
   *     currents**, worst 55.6108 mA — including in `II-FF1`, the corpus's own primary timing
   *     fixture. The earlier "not one" was measured on the landed netlist, where the arc pass does
   *     not run, with at most one pushbutton down, which is not what `I-EXP4` prints;
   *   - **no relay decision anywhere differs from the right answer.** Of those 1,122, 96 settle
   *     away from the landed netlist's own DC solution and carry a permanent coil-current error;
   *     in none of them does any coil's §4.3 direction decision differ from that solution;
   *   - the worst such error is **3.04101 mA, 7.0% of the 43.333 mA pull-in**, and the smallest
   *     margin any decision survived by is 1.03215 mA. That is a bound, not a dismissal: it is not
   *     large, and it is not guaranteed under a different `dV_relay_mv` or `L_coil`, both
   *     `[unverified]`;
   *   - the reason it is not worse is that the relay indicator lamp is in series with the coil
   *     (`nC` —lamp— `nE` —coil— `nF`, `jack-map.md` §5 [verified]), so a coil's junction node
   *     usually carries a lamp and is not bare; and the 12-tick window is 1.2 ms against an 8 ms
   *     coil time constant, so on the shipped 0-or-1-button axis the wrong attractor never even
   *     establishes — 80 configurations reach the state and none of them latch.
   *
   * `IV-EXP1` and `ER-ALTCOUNTER`, the two counters the idiom was supposed to live in, never fire
   * the arc pass at all — 672 reachable configurations each with at most one button down, 6,144
   * each across all 64 combinations. And every repair measured reintroduces §4.2's revision-1
   * defect on states that ARE reachable — a 45.58 mA one-tick coil collapse and 547 V on a panel
   * jack. See `docs/DECISIONS.md`, *2026-08-31 — O-E11 arc-pass latch: accepted and documented
   * (Tom's ruling)*.
   */
  it.fails('DEFECT (O-E11): two coils in series reach the same DC current whatever they started from', () => {
    const els = [coil(1, 2), coil(2, 0), source(1, 0)];
    const closed = V_OC / (R_SRC + 2 * R_COIL); // 43.2368 mA

    const hot = runTicks(els, carried([86.3e-3, 0], []), cfg(), 5000);
    // Series elements carry equal current. This is the invariant that is violated: 46.1093 mA
    // against 40.3415 mA, a 5.7677 mA gap that never closes.
    expect(
      Math.abs(at(hot.branchI, 0) - at(hot.branchI, 1)),
      `series currents settled at ${at(hot.branchI, 0)} A and ${at(hot.branchI, 1)} A`,
    ).toBeLessThan(1e-8);
    expect(Math.abs(at(hot.branchI, 1) - closed)).toBeLessThan(1e-8);
  });

  it('the working half is protected: balanced and mildly-imbalanced seeds reach the true DC point', () => {
    // The defect above is specific to a LARGE initial imbalance. Everything else about this circuit
    // is correct and must stay correct, so the three seeds that work are pinned here — otherwise a
    // future "fix" for the `it.fails` could regress the cases that already work and nothing would
    // catch it.
    const els = [coil(1, 2), coil(2, 0), source(1, 0)];
    const closed = V_OC / (R_SRC + 2 * R_COIL); // 43.2368 mA

    for (const seed of [[0, 0], [86.3e-3, 86.3e-3], [20e-3, 10e-3]]) {
      const r = runTicks(els, carried(seed as number[], []), cfg(), 5000);
      const i1 = at(r.branchI, 0);
      const i2 = at(r.branchI, 1);
      // Equal to within the 6.5e-9 A gmin leaks out of node 2 between the two coils.
      expect(Math.abs(i1 - i2), `seed ${String(seed)}: i1=${i1} i2=${i2}`).toBeLessThan(1e-8);
      expect(Math.abs(i1 - closed), `seed ${String(seed)}`).toBeLessThan(1e-8);
      // And the arc pass is disarmed at the fixed point, which is the tell that separates these
      // from the wrong attractor.
      expect(r.arcPass, `seed ${String(seed)}`).toBe(false);
    }

    // A mild imbalance is already recovered long before settling: 100 ticks is enough.
    const mild = runTicks(els, carried([20e-3, 10e-3], []), cfg(), 100);
    expect(Math.abs(at(mild.branchI, 0) - at(mild.branchI, 1))).toBeLessThan(1e-8);
    expect(mild.arcPass).toBe(false);
  });

  it('the wrong attractor violates KCL at the shared node by 5.77 mA, not by a rounding error', () => {
    // A target for whoever repairs the defect above. Node 2 carries exactly two elements and
    // nothing else, so KCL there is `i1 - i2 = 0` with no third term to hide in. The residual is
    // 5.7677 mA at the KAT vector's 1.2 H — 13.3% of the true DC current, and five decades above
    // the 1e-8 A the healthy case's own tests bound the gmin leak by. That is the shunt current
    // `Garc` is carrying and §3.3's companion is not reporting, so it also sizes the error: a fix
    // that closes KCL here closes the whole defect.
    const els = [coil(1, 2), coil(2, 0), source(1, 0)];
    const closed = V_OC / (R_SRC + 2 * R_COIL);
    const hot = runTicks(els, carried([86.3e-3, 0], []), cfg(), 5000);
    const residual = at(hot.branchI, 0) - at(hot.branchI, 1);

    // RESTATED, not derived: the attractor's position has no closed form to derive from, and
    // 5.7677 mA is a measurement at 1.2 H — which is `mv601-ref.ts`'s KAT test vector and NOT the
    // profile's independently retained `L_coil_uh`. The same residual is 7.7444 mA at 0.9 H and
    // 5.0664 mA at 1.5 H, so the old
    // [5.7, 5.8] mA window was false at BOTH ends of the band. What this test exists to say is the
    // SIZE CLASS — that the residual is the arc shunt and not a rounding error — so it is stated
    // as separation from the healthy case, which holds at every inductance §4.4 allows.
    // Both bars are measured across the band, not guessed: swept at 0.01 H from 0.9 to 1.5 H, the
    // residual bottoms out at 4.7401 mA and 10.96% of the DC current, both at 1.44 H.
    const GMIN_LEAK = 1e-8; // the bound the balanced-seed test above holds i1 - i2 under
    expect(residual).toBeGreaterThan(1e5 * GMIN_LEAK); // 1 mA: five decades clear of the leak
    expect(residual / closed).toBeGreaterThan(0.05); // against ~1.5e-7 of it in the healthy case

    // And the straddle: one relay latches, the other does not, permanently, in a series circuit.
    expect(at(hot.branchI, 0)).toBeGreaterThan(I_PULLIN);
    expect(at(hot.branchI, 1)).toBeLessThan(I_PULLIN);
    // The arc pass never disarms, which is the mechanism's signature.
    expect(hot.arcPass).toBe(true);
  });

  /**
   * Per coil: the largest |current| seen over the run, and the settled value. `runTicks` above
   * returns only the last tick, and the three tests below turn on what happened in between —
   * whether a coil that should sit at rest ever rose to pull-in on the way.
   */
  function sweepCoils(els: readonly El[], seed: readonly number[], ticks: number): { peakMa: number[]; finalMa: number[]; arcTicks: number } {
    const c = carried(seed, []);
    const peak = seed.map(() => 0);
    let arcTicks = 0;
    for (let t = 0; t < ticks; t++) {
      const r = tickSolve(els, c, cfg());
      if (r.arcPass) arcTicks++;
      let j = 0;
      for (let e = 0; e < els.length; e++) {
        if ((els[e] as El).k !== 'coil') continue;
        const x = Math.abs(at(r.branchI, e));
        if (x > (peak[j] as number)) peak[j] = x;
        j++;
      }
    }
    return { peakMa: peak.map((x) => x * 1e3), finalMa: Array.from(c.iCoil, (x) => x * 1e3), arcTicks };
  }

  const PULLIN_MA = I_PULLIN * 1e3; // 43.333 mA

  /**
   * THE INDUCTANCE THE THREE TESTS BELOW ARE HONEST ABOUT.
   *
   * `L_COIL` is `test/mv601-ref.ts`'s KAT test vector, and that file says in its own header that it
   * is **not** authority for `L_coil_uh`: W1's completed sweep found no jointly feasible value,
   * and the profile independently retains 1.2 H for its release-path role.
   * So a number measured at 1.2 H is a number about 1.2 H, and the review that found this file had
   * three assertions silently turned into claims about the whole band was right: two of the pinned
   * figures move across it, and one — the three-coil chain's 0.145 mA clearance under pull-in —
   * **fails** above about 1.32 H.
   *
   * The rule these tests now follow, stated once here rather than repeated:
   *
   *   - every pinned LITERAL is labelled with the inductance it was measured at, and is only
   *     claimed there;
   *   - every PROPERTY that the tests actually rest on is asserted across `L_BAND` — §4.4's two
   *     indicative endpoints and the KAT's vector between them — so it is a statement about the
   *     solver and not about one arbitrary constant.
   *
   * Nothing here is evidence about `L_coil`. They are records of what `src/core/solve.ts` does.
   */
  const L_BAND = [0.9, L_COIL, 1.5] as const;
  const coilL = (a: number, b: number, lH: number): El => ({ k: 'coil', a, b, rOhm: R_COIL, lH });
  const chain2 = (lH: number): readonly El[] => [coilL(1, 2, lH), coilL(2, 0, lH), source(1, 0)];
  const chain3 = (lH: number): readonly El[] => [coilL(1, 2, lH), coilL(2, 3, lH), coilL(3, 0, lH), source(1, 0)];

  /**
   * A DEFECT RECORD, NOT A TARGET. Every number below is what `src/core/solve.ts` does TODAY. It is
   * pinned so that a change to the arc pass has to move it deliberately and say so, not so that
   * anyone should aim at it — the correct answer is 28.8459 mA on all three coils.
   *
   * The two-coil `it.fails` above is the case the project reasons about; this is the same defect on
   * the three-coil chain, and it behaves differently in one way worth having on the record. The two
   * coils seeded TOGETHER end up sharing one wrong current (30.0149 mA, to eight significant
   * figures of each other) and the coil seeded apart from them takes the other (26.5029 mA) — the
   * split follows the initial condition, not the topology, which is the clearest statement there is
   * that this is an initial-condition artifact in a DC-exact companion.
   *
   * Unlike the two-coil case, all three latched currents sit BELOW the 43.333 mA pull-in, so no
   * relay straddles and no relay latches spuriously HERE.
   *
   * AND THE PART THAT ONLY SHOWS UP ACROSS THE BAND, which is why this test now sweeps it. This
   * chain's latch is **not** a property of the solver — it is a property of the solver at 1.1 H and
   * above. At 0.9 and 1.0 H the same seed converges to the true 28.8459 mA on all three coils and
   * the arc disarms inside a couple of hundred ticks; the latch switches on between 1.05 and 1.10 H,
   * inside §4.4's own indicative band. Once it does latch the three currents are the SAME at every
   * inductance from 1.1 to 1.5 H, to eight significant figures — the attractor's position is
   * L-independent, only whether it is reached is not.
   *
   * The version of this test that review killed asserted `peak(coil 3) < pull-in` on the strength
   * of a 0.145 mA clearance measured at 1.2 H. That clearance is gone by about 1.32 H: at 1.5 H the
   * peak is 43.5468 mA, over the line, and §4.3 has no debounce, so the stroke would complete. Both
   * facts are now asserted, at their own inductances, instead of the one that happened to be true.
   */
  it('DEFECT RECORD (O-E11): the three-coil chain latches from [86.3, 86.3, 0] mA — at 1.1 H and above', () => {
    const dc3 = V_OC / (R_SRC + 3 * R_COIL);
    expect(dc3 * 1e3).toBeCloseTo(28.845940, 5); // what three series coils must carry, and do not

    // --- at the KAT's own 1.2 H. Literals, claimed here and nowhere else.
    const r = sweepCoils(chain3(L_COIL), [86.3e-3, 86.3e-3, 0], 5000);
    expect(r.finalMa[0]).toBeCloseTo(30.014876, 5);
    expect(r.finalMa[1]).toBeCloseTo(30.014868, 5);
    expect(r.finalMa[2]).toBeCloseTo(26.502857, 5);
    // Series elements, 3.51 mA apart, permanently, with the arc armed on every one of 5000 ticks.
    expect(Math.abs((r.finalMa[0] as number) - (r.finalMa[2] as number))).toBeCloseTo(3.512019, 5);
    expect(r.arcTicks).toBe(5000);
    for (const i of r.finalMa) expect(i).toBeLessThan(PULLIN_MA);

    // --- the property, across §4.4's band: the latch exists only in its upper part.
    const lo = sweepCoils(chain3(0.9), [86.3e-3, 86.3e-3, 0], 5000);
    for (const i of lo.finalMa) expect(i).toBeCloseTo(28.845940, 4); // correct, on all three
    expect(lo.arcTicks).toBe(93); // and the arc disarms, rather than re-arming forever
    const hi = sweepCoils(chain3(1.5), [86.3e-3, 86.3e-3, 0], 5000);
    expect(hi.arcTicks).toBe(5000);
    // Once latched, the attractor sits in the same place at 1.5 H as at 1.2 H.
    for (let j = 0; j < 3; j++) expect(hi.finalMa[j], `coil ${j + 1}`).toBeCloseTo(r.finalMa[j] as number, 5);

    // --- and the clearance under pull-in that the killed assertion generalised from. It is a fact
    // about 1.2 H, 0.145 mA wide, and it is gone by 1.5 H. Nothing may lean on it.
    expect(r.peakMa[2]).toBeCloseTo(43.1880, 3);
    expect(r.peakMa[2]).toBeLessThan(PULLIN_MA);
    expect(PULLIN_MA - (r.peakMa[2] as number)).toBeCloseTo(0.145, 2);
    expect(hi.peakMa[2]).toBeCloseTo(43.5468, 3);
    expect(hi.peakMa[2]).toBeGreaterThan(PULLIN_MA); // <- the assertion review said fails, pinned
  });

  /**
   * The two seeds Wave A named, pinned permanently.
   *
   * They are here because a criterion change that "fixes" the latch was measured to reintroduce
   * excursions on exactly these two, and an excursion in this design completes a stroke: §4.3 has
   * no debounce, and an armature strictly between the stops continues. So the seeds are frozen with
   * what the shipped solver actually does on them, and the test below freezes the property that
   * matters — that nothing rises to pull-in.
   *
   * Both seeds land in the same wrong attractor as the `it.fails`, mirrored: the two-coil pair
   * settles 6.03 mA apart straddling pull-in, and the three-coil chain reaches the same
   * 26.5029 / 30.0149 / 30.0149 triple the test above does, permuted to follow the seed.
   *
   * The two behave differently across §4.4's band, and the difference is the point of the second
   * half of this test. The TWO-coil latch survives the whole band — it is there at 0.9 H and at
   * 1.5 H, and it straddles pull-in at every inductance tried, only the two settled values move.
   * The THREE-coil one does not: at 0.9 H that seed converges to the true 28.8459 mA. So "the
   * defect latches" is L-independent for the shape the ruling reasons about and L-dependent for the
   * longer chain, and this file should not have been pinning either without saying which.
   */
  it('DEFECT RECORD: the two named excursion seeds — two-coil [0, 90] and three-coil [0, 35, 100] mA', () => {
    // --- literals, at the KAT's 1.2 H.
    const a = sweepCoils(chain2(L_COIL), [0, 90e-3], 5000);
    expect(a.finalMa[0]).toBeCloseTo(40.212348, 5);
    expect(a.finalMa[1]).toBeCloseTo(46.238584, 5);
    expect(a.arcTicks).toBe(5000);

    const b = sweepCoils(chain3(L_COIL), [0, 35e-3, 100e-3], 5000);
    expect(b.finalMa[0]).toBeCloseTo(26.502868, 5);
    expect(b.finalMa[1]).toBeCloseTo(30.014869, 5);
    expect(b.finalMa[2]).toBeCloseTo(30.014864, 5);
    expect(b.arcTicks).toBe(5000);

    // --- the property the ruling actually rests on, asserted across the band rather than at one
    // point: the two-coil pair latches and STRADDLES pull-in at every inductance §4.4 allows.
    for (const lH of L_BAND) {
      const r = sweepCoils(chain2(lH), [0, 90e-3], 5000);
      expect(r.arcTicks, `L = ${lH} H`).toBe(5000);
      expect(r.finalMa[0], `L = ${lH} H, coil 1`).toBeLessThan(PULLIN_MA);
      expect(r.finalMa[1], `L = ${lH} H, coil 2`).toBeGreaterThan(PULLIN_MA);
      // 6.03 mA apart at 1.2 H, 7.74 at 0.9, 5.07 at 1.5 — the gap is real everywhere and its
      // size is not, so only its sign and the straddle are asserted across the band.
      expect((r.finalMa[1] as number) - (r.finalMa[0] as number), `L = ${lH} H`).toBeGreaterThan(5);
    }
    // And the three-coil seed's latch is NOT band-wide: at 0.9 H it reaches the right answer.
    const lo = sweepCoils(chain3(0.9), [0, 35e-3, 100e-3], 5000);
    for (const i of lo.finalMa) expect(i).toBeCloseTo(28.845940, 4);
    expect(lo.arcTicks).toBe(59);
  });

  /**
   * The relationship, machine-checked rather than remembered: **the shipped arming criterion is
   * what keeps those two seeds quiet.**
   *
   * "Quiet" is stated precisely, because the loose version is not true of any solver: a coil SEEDED
   * above pull-in is above pull-in, and that is forced by the initial condition rather than
   * produced by the solver. The property that separates the shipped arming from the repairs Wave A
   * measured is one-directional — **no coil that starts below pull-in ever reaches it.** On the
   * shipped solver every such coil stays clear: 41.4907 mA against 43.333 on the two-coil seed, and
   * 36.6340 / 39.8345 on the three-coil one. A repair that re-arms differently drives those over
   * the line, and §4.3 then completes the stroke because there is no debounce anywhere in the
   * design. If this test goes red, the change under it operates a relay the machine would not.
   *
   * TWO SEEDS, NOT THREE, AND THE PROPERTY IS SWEPT. An earlier version of this test carried a
   * third case, `[86.3, 86.3, 0]`, which is the test above's and not one of the two Wave A named —
   * and which is the one case where the quiet property is an accident of the KAT's inductance: its
   * coil 3 peaks over pull-in above about 1.32 H. It has moved to the test above, where it is
   * measured at both ends of the band instead of asserted at one. What is left here holds at every
   * inductance §4.4 allows, which is what makes it a property of the arming rather than of 1.2 H.
   * The peak LITERALS below are still 1.2 H figures and are pinned only there.
   */
  it('the shipped arming keeps both named seeds quiet, across §4.4\'s whole 0.9-1.5 H band', () => {
    const cases: { name: string; els: (lH: number) => readonly El[]; seed: number[]; peaksAtKat: number[] }[] = [
      { name: 'two-coil [0, 90]', els: chain2, seed: [0, 90e-3], peaksAtKat: [41.4907, 86.6049] },
      { name: 'three-coil [0, 35, 100]', els: chain3, seed: [0, 35e-3, 100e-3], peaksAtKat: [36.6340, 39.8345, 96.5122] },
    ];
    for (const c of cases) {
      // The literals, at the KAT's own inductance.
      const kat = sweepCoils(c.els(L_COIL), c.seed, 5000);
      for (let j = 0; j < c.seed.length; j++) {
        expect(kat.peakMa[j], `${c.name} coil ${j + 1} at ${L_COIL} H`).toBeCloseTo(c.peaksAtKat[j] as number, 3);
      }
      // The property, everywhere in the band.
      for (const lH of L_BAND) {
        const r = sweepCoils(c.els(lH), c.seed, 5000);
        for (let j = 0; j < c.seed.length; j++) {
          if ((c.seed[j] as number) >= I_PULLIN) continue; // seeded above the line: forced, not produced
          expect(r.peakMa[j], `${c.name} coil ${j + 1} rose to pull-in at L = ${lH} H`).toBeLessThan(PULLIN_MA);
        }
      }
    }
  });
});

describe('the collapsed cases (§3.1, §3.3, determinism rule 16)', () => {
  it('a shorted coil freewheels at exactly (L/dt)/(R_coil + L/dt) per tick', () => {
    // Both ends on node 1: the stamp cancels out of G and out of i, and the current comes from the
    // companion alone with v = 0. This is how every flip-flop in the corpus turns a relay off, and
    // it is why that release is slow (§4.2 row 2).
    const c = carried([86.3e-3], []);
    const els = [coil(1, 1), source(1, 0)];
    let prev = 86.3e-3;

    for (let t = 0; t < 8; t++) {
      const r = tickSolve(els, c, cfg());
      const i = at(r.branchI, 0);
      // Bit-exact against §3.3's companion at v = 0, with §3.3's parenthesisation.
      expect(i).toBe(GEQ * 0 + GEQ * ((L_COIL / DT_S) * prev));
      // And the ratio is §3.3's stated 0.9877, to within a rounding step of the double.
      expect(Math.abs(i / prev / FREEWHEEL - 1)).toBeLessThan(4e-16);
      expect(r.arcPass).toBe(false); // v = 0 never exceeds the clamp
      expect(r.openRamp).toBe(false); // and nothing is pruned
      prev = i;
    }
    // RESTATED rather than derived: deriving the expectation from `L_COIL` would compare the
    // constant against itself and prove nothing. §3.3 prints 0.9877 for this ratio, and 0.9877 is
    // this formula — at 1.2 H. That is `mv601-ref.ts`'s KAT test vector, NOT the profile's
    // profile's independently retained `L_coil_uh`, so
    // `toBeCloseTo(0.9877, 4)` quietly claimed a doc figure for whatever the vector happened to
    // be: the ratio is 0.98361 at 0.9 H and 0.99010 at 1.5 H, and the assertion fails at both.
    //
    // The closed form is already checked bit-exactly against the solver in the loop above, so what
    // is left to assert — and what §4.2 row 2's "that release is slow" actually rests on — is that
    // backward Euler's per-tick factor IS the physical L/R decay: it tracks exp(-R_coil*dt/L) to
    // second order in dt/tau, and it is a decay, at any inductance.
    const dtOverTau = (R_COIL * DT_S) / L_COIL; // 0.0125 at the KAT's 1.2 H
    expect(Math.abs(FREEWHEEL - Math.exp(-dtOverTau))).toBeLessThan(dtOverTau * dtOverTau);
    expect(FREEWHEEL).toBeGreaterThan(0);
    expect(FREEWHEEL).toBeLessThan(1);
  });

  it('a shorted resistor carries exactly zero current', () => {
    // The shorted motor armature: v = 0 and therefore i = 0, so it develops no braking. The
    // matrix cannot say this -- the element spans one row and cancels -- which is why rule 16
    // exists.
    const r = tickSolve([res(1, 1, 22), res(1, 0, 33), source(1, 0)], carried([], []), cfg());
    expect(Object.is(at(r.branchI, 0), 0)).toBe(true);
    // The rest of the network is untouched by it: node 1 is the 0.67/33 divider.
    expect(Math.abs(at(r.v, 1) - (V_OC * 33) / (R_SRC + 33))).toBeLessThan(1e-6);
  });

  it('a dead +/- cord is a legal zero-unknown solve and still yields V_oc/R_src = 19.4 A', () => {
    // AT-06. PLUS merges into MINUS, which is the datum, so N = 0 and the LU is a no-op. A porter
    // who treats N = 0 as an error gets a crash where the reference gets a breaker trip.
    const r = tickSolve([source(0, 0)], carried([], []), cfg());

    expect(r.v.length).toBe(1);
    expect(at(r.v, 0)).toBe(0);
    expect(at(r.floating, 0)).toBe(0);
    expect(r.nonPortable).toBe(false);
    expect(r.arcPass).toBe(false);
    expect(r.openRamp).toBe(false);
    // Bit-exact against §3.3's supply companion, then against §8.2's printed 19.4 A.
    expect(at(r.branchI, 0)).toBe((1 / R_SRC) * (V_OC - 0));
    expect(Math.abs(at(r.branchI, 0) - 19.4)).toBeLessThan(0.005);
    expect(at(r.branchI, 0) / 1.5).toBeGreaterThan(12); // ~13x the 1.5 A trip
  });

  it('a collapsed coil still advances its carried state (rule 11), unlike the matrix', () => {
    const c = carried([86.3e-3], []);
    tickSolve([coil(1, 1), source(1, 0)], c, cfg());
    expect(at(c.iCoil, 0)).toBe(GEQ * 0 + GEQ * ((L_COIL / DT_S) * 86.3e-3));
  });
});

describe('LU and pivoting (§3.4, determinism rule 4)', () => {
  // The pivot-tie circuit: node 1 hangs off node 2 through a 100 ohm resistor and nothing else,
  // with gmin switched off. Stamping §3.3's table by hand over §3.1.3's row order (node 1 -> row 0,
  // node 2 -> row 1) gives a matrix whose column 0 is [Gr, -Gr] -- an EXACT tie in |a|, decided
  // only by the tie-break rule.
  const G_R = 1 / 100;
  const G_SRC = 1 / R_SRC;
  const I_PREV = 40e-3;
  const IEQ = GEQ * ((L_COIL / DT_S) * I_PREV);
  const A00 = G_R;
  const A01 = -G_R;
  const A10 = -G_R;
  const A11 = G_R + GEQ + G_SRC;
  const J0 = 0;
  const J1 = 0 - IEQ + G_SRC * V_OC;

  /** §3.4's LU on the 2x2, written out: no swap, because a tie goes to the LOWEST row index. */
  function solveLowestRow(): [number, number] {
    const m = A10 / A00;
    const a11 = A11 - m * A01;
    const j1 = J1 - m * J0;
    const x1 = j1 / a11;
    const x0 = (J0 - A01 * x1) / A00;
    return [x0, x1];
  }

  /** The same LU with the tie taken by the HIGHEST row index instead: rows 0 and 1 swap first. */
  function solveHighestRow(): [number, number] {
    const m = A00 / A10;
    const a11 = A01 - m * A11;
    const j1 = J0 - m * J1;
    const x1 = j1 / a11;
    const x0 = (J1 - A11 * x1) / A10;
    return [x0, x1];
  }

  it('the tie is exact, so the tie-break rule is the only thing that decides the pivot', () => {
    expect(Math.abs(A00)).toBe(Math.abs(A10));
  });

  it('the two tie-breaks give different answers, and the solver takes the lowest row', () => {
    const lo = solveLowestRow();
    const hi = solveHighestRow();
    // Analytically identical; they differ in the last bits, which is all a bit-exact KAT needs to
    // diverge between two ports. If this ever stops differing the test below stops proving
    // anything, so it is asserted rather than assumed.
    expect(lo[0]).not.toBe(hi[0]);

    const r = tickSolve([res(1, 2, 100), coil(2, 0), source(2, 0)], carried([I_PREV], []), cfg(0, 0));
    expect(at(r.v, 1)).toBe(lo[0]);
    expect(at(r.v, 2)).toBe(lo[1]);
    // The dangling resistor carries nothing, so both its nodes sit at the same potential.
    expect(at(r.branchI, 0)).toBe(0);
  });

  it('rejects NaN and fractional datum values through allocating and in-place APIs', () => {
    const els = [coil(1, 0), source(1, 0)];
    for (const datum of [NaN, 0.5]) {
      expect(() => tickSolve(els, carried([0], []), cfg(datum))).toThrow(
        /datum node id out of range/,
      );
      expect(() =>
        tickSolveInto(
          els,
          els.length,
          carried([0], []),
          cfg(datum),
          true,
          createSolveWorkspace(),
        ),
      ).toThrow(/datum node id out of range/);
    }
  });

  it('rejects NaN and fractional values in either endpoint through allocating and in-place APIs', () => {
    for (const [a, b] of [[NaN, 0], [0.5, 0], [0, NaN], [0, 0.5]]) {
      const els = [res(a as number, b as number, 100), source(1, 0)];
      expect(() => tickSolve(els, carried([], []), cfg())).toThrow(/node id out of range/);
      expect(() =>
        tickSolveInto(
          els,
          els.length,
          carried([], []),
          cfg(),
          true,
          createSolveWorkspace(),
        ),
      ).toThrow(/node id out of range/);
    }
  });

  it('rejects invalid forged graph counts and ids while retaining the maximal legal graph', () => {
    const maximal = {
      elements: [source(0, 173)],
      elementCount: 1,
      nodeCount: 174,
      datum: 173,
      inSource: new Uint8Array(174).fill(1),
      sourceEnabled: true,
    };
    const solveGraph = (graph: typeof maximal) =>
      tickSolveGraphInto(graph, carried([], []), cfg(), createSolveWorkspace());

    for (const datum of [NaN, 172.5]) {
      expect(() => solveGraph({ ...maximal, datum })).toThrow(/datum node id out of range/);
    }
    for (const nodeCount of [NaN, 173.5]) {
      expect(() => solveGraph({ ...maximal, nodeCount })).toThrow(/active node count out of range/);
    }
    for (const [a, b] of [[NaN, 173], [0.5, 173], [0, NaN], [0, 172.5]]) {
      expect(() => solveGraph({ ...maximal, elements: [source(a as number, b as number)] })).toThrow(
        /node id out of range/,
      );
    }
    expect(() =>
      solveGraph({ ...maximal, elements: [source(0, 174)] }),
    ).toThrow(/node id out of range/);
    expect(() =>
      solveGraph({ ...maximal, nodeCount: 173, datum: 172 }),
    ).toThrow(/graph element endpoint outside active node count/);

    const result = solveGraph(maximal);
    expect(result).toMatchObject({ nodeCount: 174, rowCount: 173, elementCount: 1 });
    expect(result.v[173]).toBe(0);
  });

  it('range-checks integer datum and endpoint values without rejecting legal high ids', () => {
    // `cfg.datum` indexes `rowOf` and `inSrc` and sets the floor on `nodeCount`. Unchecked, a large
    // datum allocates a huge result array every tick and writes past both scratch arrays silently,
    // because a typed array drops an out-of-range store instead of throwing.
    const els = [coil(1, 0), source(1, 0)];
    expect(() => tickSolve(els, carried([0], []), cfg(1e6))).toThrow(/datum node id out of range/);
    expect(() => tickSolve(els, carried([0], []), cfg(-1))).toThrow(/datum node id out of range/);
    // The element endpoints were already checked; both paths report, neither silently truncates.
    expect(() => tickSolve([coil(1, 300), source(1, 0)], carried([0], []), cfg())).toThrow(
      /node id out of range/,
    );
    // And a legal high datum still solves.
    expect(() => tickSolve([source(0, 173)], carried([], []), cfg(173))).not.toThrow();
  });

  it('a singular system reports nonPortable rather than throwing (rule 14)', () => {
    // Deliberately degenerate: with gmin off and the source spanning nodes 1 and 2, the datum
    // (node 0) is touched by no element at all, so the reference floats and both rows are the same
    // equation. The LU divides 0 by 0. §3.5's contract is that this is REPORTED, never thrown and
    // never silently continued.
    const r = tickSolve([res(1, 2, 100), source(1, 2)], carried([], []), cfg(0, 0));

    expect(r.nonPortable).toBe(true);
    expect(Number.isNaN(at(r.v, 1))).toBe(true);
    expect(Number.isNaN(at(r.v, 2))).toBe(true);
    // NaN is not floating: these nodes ARE in the source component, they just have no solution.
    // The distinction matters -- §3.1.4's null voltage and rule 14's NaN are different reports.
    expect(at(r.floating, 1)).toBe(0);
    expect(at(r.floating, 2)).toBe(0);
  });

  it('a singular solve does not poison the carried coil current', () => {
    // Same degeneracy as above, but with the coil in it: NaN node voltages give the coil companion
    // a NaN branch current. Committed to `carried.iCoil` that would be permanent -- the next tick
    // stamps NaN as the companion current, so the coil never recovers even once the topology is
    // solvable again. The guard holds the last finite current instead, exactly as `pwlLookup`'s
    // cold clamp protects the filament.
    const c = carried([0], []);
    const bad = tickSolve([coil(1, 2), source(1, 2)], c, cfg(0, 0));
    expect(bad.nonPortable).toBe(true); // the solve really is degenerate
    expect(Number.isNaN(at(bad.branchI, 0))).toBe(true); // and the coil's current really is NaN
    expect(Number.isNaN(at(c.iCoil, 0))).toBe(false); // but the carried current is not poisoned
    expect(at(c.iCoil, 0)).toBe(0);

    // And the recovery that matters: a solvable topology on the next tick answers normally.
    const good = tickSolve([coil(1, 0), source(1, 0)], c, cfg());
    expect(good.nonPortable).toBe(false);
    expect(Number.isNaN(at(good.branchI, 0))).toBe(false);
    expect(at(c.iCoil, 0)).toBe(at(good.branchI, 0));
    expect(at(c.iCoil, 0)).toBeGreaterThan(0);
  });

  it('a well-conditioned system does not set nonPortable', () => {
    const r = tickSolve([coil(1, 0), source(1, 0)], carried([0], []), cfg());
    expect(r.nonPortable).toBe(false);
  });
});

describe('the caller-owned solve workspace', () => {
  it('reaches 174 nodes, 173 rows and 278 elements, then overwrites them with legal N=0', () => {
    const els: El[] = [];
    for (let node = 0; node < 173; node++) els.push(res(node, node + 1, 100 + node));
    while (els.length < 277) els.push(res(0, 1, 1_000 + els.length));
    els.push(source(0, 173));

    const workspace = createSolveWorkspace();
    const refs = {
      v: workspace.v,
      floating: workspace.floating,
      branchI: workspace.branchI,
      matrix: workspace._a,
      rhs: workspace._j,
      solution: workspace._x,
      rows: workspace._rowOf,
      source: workspace._inSource,
      arc: workspace._arcOn,
    };
    const maximal = tickSolveInto(els, els.length, carried([], []), cfg(173), true, workspace);
    expect(maximal).toBe(workspace);
    expect(maximal).toMatchObject({ nodeCount: 174, rowCount: 173, elementCount: 278 });
    expect(Number.isFinite(maximal.v[0] as number)).toBe(true);

    const zero = tickSolveInto([source(0, 0)], 1, carried([], []), cfg(), true, workspace);
    expect(zero).toBe(workspace);
    expect(zero).toMatchObject({
      nodeCount: 1,
      rowCount: 0,
      elementCount: 1,
      arcPass: false,
      openRamp: false,
      nonPortable: false,
    });
    expect(zero.v).toBe(refs.v);
    expect(zero.floating).toBe(refs.floating);
    expect(zero.branchI).toBe(refs.branchI);
    expect(zero._a).toBe(refs.matrix);
    expect(zero._j).toBe(refs.rhs);
    expect(zero._x).toBe(refs.solution);
    expect(zero._rowOf).toBe(refs.rows);
    expect(zero._inSource).toBe(refs.source);
    expect(zero._arcOn).toBe(refs.arc);
    expect(zero.v[0]).toBe(0);
    expect(zero.floating[0]).toBe(0);
    expect(zero.branchI[0]).toBe((1 / R_SRC) * V_OC);
  });

  it('clears stale flags/results and takes the explicit disabled-source zero path', () => {
    const workspace = createSolveWorkspace();
    const hot = R_COLD * 4;
    const c = carried([0.05], [hot]);
    const arcCircuit = [coil(5, 0), source(1, 0)];
    tickSolveInto(arcCircuit, arcCircuit.length, carried([86.3e-3], []), cfg(), true, workspace);
    expect(workspace.arcPass).toBe(true);

    const els = [coil(1, 0), lamp(1, 0), source(1, 0)];
    const result = tickSolveInto(els, els.length, c, cfg(), false, workspace);
    expect(result).toMatchObject({ rowCount: 0, arcPass: false, openRamp: false, nonPortable: false });
    expect(result.branchI.subarray(0, result.elementCount).every((value) => Object.is(value, 0))).toBe(true);
    expect(Object.is(c.iCoil[0], 0)).toBe(true);
    expect(c.rLamp[0] as number).toBeLessThan(hot);
    expect(result.v[0]).toBe(0);
    expect(Number.isNaN(result.v[1] as number)).toBe(true);
    expect(result.floating[0]).toBe(0);
    expect(result.floating[1]).toBe(1);
  });
});

describe('the PWL of §3.4', () => {
  const LAST = PWL.xs.length - 1;

  it('ships 33 strictly increasing breakpoints', () => {
    expect(PWL.xs.length).toBe(33);
    expect(PWL.ys.length).toBe(33);
    for (let j = 1; j <= LAST; j++) expect(at(PWL.xs, j)).toBeGreaterThan(at(PWL.xs, j - 1));
  });

  it('clamps below the first breakpoint', () => {
    // "if (I <= x[0]) return y[0]". y[0] is R_cold = 18 ohm -- the filament at rest.
    expect(pwlLookup(PWL, -1)).toBe(at(PWL.ys, 0));
    expect(pwlLookup(PWL, 0)).toBe(at(PWL.ys, 0));
    expect(pwlLookup(PWL, -1e300)).toBe(18);
  });

  it('clamps above the last breakpoint', () => {
    // "if (I >= x[32]) return y[32]". y[32] is the 2*R_hot ceiling of §8.2's clamped power law:
    // 160 * (0.8/0.081)^0.36 = 364.9 ohm, clamped to 320.
    expect(pwlLookup(PWL, 5)).toBe(at(PWL.ys, LAST));
    expect(pwlLookup(PWL, at(PWL.xs, LAST))).toBe(at(PWL.ys, LAST));
    expect(pwlLookup(PWL, 1e300)).toBe(320);
  });

  it('returns the breakpoint exactly when x lands on one', () => {
    // "ties take that j": x == x[10] selects the segment [9,10], so t == 1 and the result is
    // y[9] + 1*(y[10]-y[9]). Consecutive ys are within a factor of 1.08, so the subtraction is
    // exact by Sterbenz and the sum recovers y[10] bit for bit.
    for (const j of [1, 10, 20, 31]) {
      expect(pwlLookup(PWL, at(PWL.xs, j))).toBe(at(PWL.ys, j));
    }
  });

  it('returns the cold clamp on NaN rather than reading xs[-1]', () => {
    // NaN is false against every relational operator, so both clamps fall through and the segment
    // scan leaves j at 0, which reads `xs[-1]`. The `as number` casts inside `pwlLookup` defeat
    // `noUncheckedIndexedAccess`, so the compiler cannot catch it. The damage is not one bad tick:
    // the caller feeds the result back as the carried filament resistance (rule 11), so a single
    // NaN poisons that lamp permanently.
    expect(pwlLookup(PWL, NaN)).toBe(at(PWL.ys, 0));
    expect(pwlLookup(PWL, NaN)).toBe(18);

    // And end to end, which is the regression that matters. A singular system (rule 14) solves to
    // NaN voltages, so the lamp's companion gives a NaN branch current, which is fed straight to
    // `pwlLookup` as the filament's new target. Unguarded that returned NaN and the carried
    // resistance never recovered, even after the circuit became solvable again. Guarded, the
    // target is the cold clamp and the carried double stays finite.
    const c = carried([], [R_COLD]);
    const r = tickSolve([lamp(1, 2), source(1, 2)], c, cfg(0, 0));
    expect(r.nonPortable).toBe(true); // the solve really is degenerate
    expect(Number.isNaN(at(r.branchI, 0))).toBe(true); // and the lamp's current really is NaN
    expect(Number.isNaN(at(c.rLamp, 0))).toBe(false); // but the carried filament is not poisoned
    expect(at(c.rLamp, 0)).toBe(R_COLD);
  });

  it('interpolates the midpoint of a segment by §3.4s formula, and tracks the closed-form law', () => {
    const x0 = at(PWL.xs, 5);
    const x1 = at(PWL.xs, 6);
    const y0 = at(PWL.ys, 5);
    const y1 = at(PWL.ys, 6);
    const x = x0 + (x1 - x0) * 0.5; // 2.6542 mA, inside segment 5-6

    const t = (x - x0) / (x1 - x0);
    expect(t).toBe(0.5);
    expect(pwlLookup(PWL, x)).toBe(y0 + t * (y1 - y0)); // 46.677 ohm

    // Bracketed by its own breakpoints, and the chord error against R_hot*(I/I_hot)^0.36 is 0.13%
    // -- which is the whole argument for shipping a table instead of `Math.pow` (rule 5).
    expect(pwlLookup(PWL, x)).toBeGreaterThan(y0);
    expect(pwlLookup(PWL, x)).toBeLessThan(y1);
    expect(Math.abs(pwlLookup(PWL, x) - tungsten(x)) / tungsten(x)).toBeLessThan(2e-3);
  });
});

// ---------------------------------------------------------------------------------------------
// Half 2 — the KAT actually runs
// ---------------------------------------------------------------------------------------------

/**
 * The KAT comes in through `resolveJsonModule`, not through `node:fs`, and what is asserted here is
 * everything above the bytes. Determinism rule 17's byte-level contract (UTF-8, no BOM, LF, exactly
 * one trailing newline) is `test/encoding.spec.ts`, which walks `data/**` and `test/**` and reads
 * bytes rather than strings. The hex encoding keeps a decimal formatter out of the loop here: the
 * doubles arrive as strings and are compared as strings, never as parsed JSON numbers.
 *
 * The cast is because a JSON module's inferred type widens every string literal, so `kind` comes
 * back as `string` rather than as §3.5's discriminant.
 */
const KAT = katJson as unknown as KatFile;
/** The generator's own serialisation call, re-run so the hex scan below has text to scan. */
const KAT_TEXT = JSON.stringify(KAT, null, 2) + '\n';

/**
 * The 21 names, in order.
 *
 * §3.5's prose names 18 cases individually and then says "three whole-panel snapshots", which
 * totals 21 -- against the "20 cases" §3.5 states twice and `gen-solver-kat.ts` used to enforce.
 * The two statements cannot both hold. RULING (DECISIONS, *2026-08-30 — Phase 1 Wave 1a spec
 * readings*): **21**. The count is
 * decorative and the coverage is the point, so the enumeration wins and the third snapshot is
 * added rather than the word "three" being struck.
 *
 * The third is `whole-panel-open-feed`: relay 6's feed contact opened while its coil carries
 * 86.3 mA. It is the only case in the KAT where the second solve of §3.2 step 5 runs against a real
 * load -- the arc conductance is stamped into a matrix that also carries twelve lamps, five other
 * coils and the motor divider -- where `arc-clamp-single` and `arc-clamp-series-junction` both fire
 * it on two- and three-element circuits.
 */
const KAT_CASE_NAMES = [
  'divider',
  'series-through-float',
  'collapsed-coil',
  'collapsed-armature',
  'zero-unknown',
  'datum-not-lowest-index',
  'arc-clamp-single',
  'arc-clamp-series-junction',
  'lamp-cold-start',
  'lamp-warm-relaxation',
  'pwl-below-first-breakpoint',
  'pwl-above-last-breakpoint',
  'pwl-on-a-breakpoint',
  'saturating-quantize',
  'pivot-tie',
  'rl-rise-500',
  'freewheel-500',
  'six-coil-load',
  'whole-panel-cold',
  'whole-panel-500',
  'whole-panel-open-feed',
];

describe('solver-kat.json — the structural invariants', () => {
  it('carries the schema id §3.5 names', () => {
    expect(KAT.schema).toBe('minivac.solver-kat/1');
  });

  it('is 21 cases, with the names of §3.5s list in the generator’s order', () => {
    expect(KAT.cases.length).toBe(21);
    expect(KAT.cases.map((c) => c.name)).toEqual(KAT_CASE_NAMES);
  });

  it('carries the three whole-panel snapshots §3.5 enumerates, and they are three DIFFERENT states', () => {
    const panel = KAT.cases.filter((c) => c.name.startsWith('whole-panel-'));
    expect(panel.length).toBe(3);
    // Cold and 500 are the same circuit at two times; open-feed is a different circuit, and the
    // only one whose second solve runs. If a future edit made the third a rerun of the first two it
    // would stop paying for itself, so the distinction is asserted rather than described.
    const byName = new Map(panel.map((c) => [c.name, c]));
    const cold = byName.get('whole-panel-cold');
    const open = byName.get('whole-panel-open-feed');
    expect(cold?.kind).toBe('solve');
    expect(open?.kind).toBe('solve');
    if (cold?.kind !== 'solve' || open?.kind !== 'solve') throw new Error('unreachable');
    expect(open.expect.arcPass).toBe(true);
    expect(cold.expect.arcPass).toBe(false);
    expect(open.expect.v.length).toBeGreaterThan(cold.expect.v.length); // 10 nodes against 8
  });

  it('has exactly four multi-tick cases, all at 500 ticks', () => {
    // Unchanged by the 21st case: `whole-panel-open-feed` is a one-tick snapshot, because what it
    // covers is the arc pass inside a loaded matrix, which happens on tick 1.
    const multi = KAT.cases.filter((c) => c.kind === 'solve' && c.ticks !== 1);
    expect(multi.length).toBe(4);
    for (const c of multi) expect(c.kind === 'solve' && c.ticks).toBe(500);
    expect(multi.map((c) => c.name)).toEqual(['lamp-warm-relaxation', 'rl-rise-500', 'freewheel-500', 'whole-panel-500']);
  });

  it('carries the 33-breakpoint table of §3.4', () => {
    expect(KAT.pwl.xs.length).toBe(33);
    expect(KAT.pwl.ys.length).toBe(33);
  });

  it('encodes every double as 16 lowercase hex digits', () => {
    // Scanned off the serialised text rather than off named fields, so a double added to the schema
    // later cannot slip past this by living somewhere nobody enumerated.
    const tokens = KAT_TEXT.match(/"0x[^"]*"/g) ?? [];
    expect(tokens.length).toBeGreaterThan(400); // a floor, not a golden count: 507 today
    for (const t of tokens) expect(t).toMatch(/^"0x[0-9a-f]{16}"$/);
  });

  it('puts a hex string, never a JSON number, everywhere §3.5 requires a double', () => {
    // The complement of the scan above: it proves the doubles are hex, this proves nothing that
    // should be hex arrived as a parsed number instead.
    for (const c of KAT.cases) {
      if (c.kind === 'solve') {
        for (const s of [c.cfg.dtS, c.cfg.vArc, c.cfg.kThermal, c.cfg.gminS]) expect(typeof s).toBe('string');
        for (const s of [...c.expect.v, ...c.expect.branchI, ...c.expect.iCoil, ...c.expect.rLamp]) {
          expect(typeof s).toBe('string');
        }
        expect(typeof c.ticks).toBe('number'); // ticks is a count, not a solver double
      } else if (c.kind === 'pwl') {
        expect(typeof c.x).toBe('string');
        expect(typeof c.expect.y).toBe('string');
      } else {
        expect(typeof c.x).toBe('string');
        expect(typeof c.scale).toBe('string');
        expect(typeof c.expect.q).toBe('number'); // quantize returns an int32, not a double
      }
    }
  });
});

describe('solver-kat.json — every case, bit-exact', () => {
  // String equality on the hex, per §3.5: the runner re-encodes what it computed and no decimal
  // formatter is anywhere in the comparison.
  for (const c of KAT.cases) {
    it(c.name, () => {
      if (c.kind === 'solve') expect(runSolveCase(KAT, c)).toEqual(c.expect);
      else if (c.kind === 'pwl') expect(runPwlCase(KAT, c)).toEqual(c.expect);
      else expect(runQuantizeCase(c)).toEqual(c.expect);
    });
  }
});
