/**
 * `tools/check-profile.ts` — the load-time gate of architecture §10.1, and Wave 1b's measuring
 * instrument.
 *
 *   npm run check-profile        (node 26; type stripping, no build step)
 *   npm run check-profile -- --d (Wave D profile derivation and live C-Z identity report)
 *
 * It runs the acceptance tests of architecture §9.4 (AT-01, AT-04, AT-05, AT-06, AT-07, AT-09,
 * AT-10, AT-11) plus **AT-02 loaded**, evaluates `components.md` §9.3's R1-R6 through
 * `src/core/profile.ts`'s evaluators, reports an `L_coil_uh` sweep alongside the constraints,
 * sweeps `lamp_thermal_tau_us` (O-E12's invented 40 ms) to find which
 * constraint that number is deciding, runs **four** controls — architecture §4.3's two, a
 * neutral-`L_coil` one, and one that removes the spread and shortens the filament constant at
 * once — and reports whether the 9- and 33-breakpoint lamp tables change any
 * result or any relay decision.
 *
 * §9.3 names **two** worst carry steps, 3->4 and 7->0, and they compose differently: only 3->4
 * terminates on a stage going 0->1, so only 3->4 is charged a terminating operate. Both are
 * composed and the worst is taken per drive. The hold-off-free counterfactual beside them is what
 * separates "the window has this sign" from "there is no discriminator at any composition".
 *
 * **This file measures. It does not tune.** No profile value is adjusted to make a test pass, no
 * free parameter is introduced, and `data/profiles/*.json` is never written — the sweep and the
 * controls work on in-memory copies. `DECISIONS.md` ("Why the kill criterion exists") is the reason
 * that sentence is here. Wave D replaced the fitted vector; the normal report still runs its
 * zeroed, rotated and neutral-inductance diagnostics against the current shipped profile.
 *
 * **No invented constant appears as a literal below.** Every physical number comes out of a loaded
 * profile. The handful of structural inputs a `minivac.profile/1` document cannot hold — the E12
 * resistor decade, the number of output lamps, the carry-chain shape, the human-hold bracket, the
 * 2-5x release band, the lamp table's breakpoint construction — are named in one block, each with
 * the clause it is read from. Constraint thresholds in code follow the precedent `profile.ts` set
 * with `R1_MIN_RATIO`.
 *
 * **This tool does not load the netlist.** Its circuits are hand-stamped element arrays over small
 * node ids, exactly as in `test/solve.spec.ts`. Relay terminal semantics are `components.md` §1.4's:
 * `nC --lamp-- nE --coil-- nF`, so "C-fed" drives the coil through its own indicator lamp and
 * "E-fed" bypasses the lamp and puts the full rail on the coil.
 *
 * Determinism: no wall clock, no RNG, no Map or Set iteration reaches the output.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { idivRound, quantize, roundHalfEven } from '../src/core/ints.ts';
import type { PortFlags } from '../src/core/ints.ts';
import { evalConstraints, loadProfile } from '../src/core/profile.ts';
import type { ConstraintInputs, ConstraintResult, Profile, PwlPoint } from '../src/core/profile.ts';
import { tickSolve } from '../src/core/solve.ts';
import type { Carried, El, SolveCfg } from '../src/core/solve.ts';
import {
  COUNTER_PROGRAMS,
  REGISTERED_STATES,
  gateP,
  runGateT,
  stampCounter,
  validateProgramLiteral,
} from './stamp-counter.ts';
import type {
  CounterEvent,
  CounterProgramId,
  CounterStamp,
  GatePRefusal,
  RegisteredState,
  RowStatus,
  StampElement,
} from './stamp-counter.ts';

// -------------------------------------------------------------------------------------------
// Structural inputs. Not physical quantities and not tunables: each is a fact about the machine
// or about a printed procedure, and each carries the clause it is read from. Nothing here is
// fitted to an outcome, and nothing here is a number the profile could have held instead.
// -------------------------------------------------------------------------------------------

/**
 * `components.md` §8.2, AT-04: "E12 sweep at 13 V into 150 Ω: 180, 220, 270, 330, 390, 470 Ω all
 * land strictly inside (2.5, 6.5); 150 Ω sits at pull-in, where the descending search terminates;
 * 120 Ω and below pull in at power-on." These are resistor values a 1961 owner plugs into the
 * panel, so they are a property of the drawer, not of the profile.
 */
const E12_INSIDE_OHM = [180, 220, 270, 330, 390, 470] as const;
const E12_BELOW_OHM = [150, 120] as const;

/**
 * Six binary output lamps (`components.md` §2), six relay indicator lamps (§1.4), and the POWER
 * light, which is wired across the DC output and lit whenever the machine is on (§7.3). Six plus
 * six plus one is the thirteen lamps AT-05 counts (§8.2).
 */
const OUTPUT_LAMPS_MAX = 6;
const RELAY_COUNT = 6;

/**
 * `components.md` §9.3's corrected falsifiable prediction: the serial device-time chain lengths on
 * the DOWN edge are 1,2,1,3,1,2,1,3 for 0->1 .. 7->0, and the two **longest** steps are 3->4 and
 * 7->0. They are three device times each, but they are **not the same three**, and the difference
 * is R4's own terminating clause — "the terminating stage contributing `t_operate` **when it goes
 * 0->1**" (§9.3's R4 row; `profile.ts`'s `evalR4` repeats it verbatim):
 *
 *   3->4   011 -> 100   C 1->0 shorted release, B 1->0 shorted release, A **0->1 operate**
 *   7->0   111 -> 000   C 1->0, B 1->0, A 1->0 — three shorted releases and **no operate at all**
 *
 * Both are read off SDC's own BINARY COUNTER — SEQUENCE OF OPERATIONS chart (BK4 printed p.71,
 * transcribed in `programs.md` under `IV-EXP1`): the `3 UP -> 4 UP` pair of rows takes Flip-Flop A
 * from 0 to 1 with both carries YES, while the `7 UP -> 0 UP` pair takes all three flip-flops from
 * 1 to 0. §9.3's terminating clause is conditional on 0->1, so it does not reach 7->0.
 *
 * An earlier revision of this file composed **one** chain, `2 shorted releases + 1 operate`, and
 * applied it to both steps. That is correct for 3->4 and wrong for 7->0. Both are composed below
 * and the worst chain is taken **per drive**, evaluated rather than assumed — on a drive whose
 * shorted release is longer than its operate the 7->0 chain is the binding one, and on a drive
 * where it is shorter, 3->4 is.
 */
const CARRY_CHAINS = [
  {
    id: '3->4',
    shortedReleases: 2,
    operates: 1,
    why: '011 -> 100: two stages go 1->0 (shorted release each), the terminating stage goes 0->1, ' +
      'which is the one case §9.3 R4 charges an operate for',
  },
  {
    id: '7->0',
    shortedReleases: 3,
    operates: 0,
    why: '111 -> 000: all three stages go 1->0. No stage goes 0->1, so §9.3 R4\'s "when it goes ' +
      '0->1" clause never fires and there is NO terminating operate',
  },
] as const;

/**
 * `components.md` §9.3, "Human-scale sanity check": "For SDC to have needed a printed warning, the
 * relay timescale must be an appreciable fraction of a fast tap (~30-50 ms)." This is the reality
 * check R6's discriminating interval is held against, and it is the only source of a button-hold
 * duration in the corpus — a hold is a property of a script, and W1 has no scripts.
 */
const FAST_TAP_MS = [30, 50] as const;

/**
 * `components.md` §9.3's "typically 2-5x" slugged-relay ratio, held by architecture §4.2 as a
 * constraint on the **total observed release** (electrical hold-off plus mechanical stroke) rather
 * than on the L/R decay alone. A constraint threshold in code, on the precedent `profile.ts` set
 * with `R1_MIN_RATIO`: §10.1's key list has no slot for it and adding one would make §10's own
 * example profile fail to load.
 */
const RELEASE_RATIO_LO = 2;
const RELEASE_RATIO_HI = 5;

/**
 * The historical W1 `L_coil_uh` sweep. Architecture §4.4 gives an indicative 0.9-1.5 H band and
 * §10 ships 1.2 H. W1 finding (b) established that this sweep does not select a jointly feasible
 * value; it remains here as a non-gating diagnostic, widened to 0.3-5 H so each shape stays visible.
 */
const L_SWEEP_UH = [
  300_000, 450_000, 600_000, 750_000, 900_000, 1_050_000, 1_200_000, 1_350_000,
  1_500_000, 1_800_000, 2_100_000, 2_500_000, 3_000_000, 3_500_000, 4_000_000, 5_000_000,
] as const;

/**
 * The `lamp_thermal_tau_us` sweep. The shipped 40 000 µs is `components.md` §9.3's parameter block
 * ("`lamp_thermal_tau_ms` / `visual_decay_ms` | 40 / 60"), promoted from a display filter to the
 * filament's **electrical** time constant by O-E12 — an invented number, `[unverified]`, and the
 * one this file has the most reason to sweep: it sets how much of the electrical rise a dark
 * stage's filament spends near `R_cold`, which is the whole of the gap between the warm-filament
 * ratio and the one the model runs at.
 *
 * The range is taken down to 1000 µs deliberately, **below what the loader accepts**: determinism
 * rule 15 requires `tick_us * 20 < min device latency` and the filament constant is in that min, so
 * at a 100 µs tick anything at or under 2000 µs is rejected at load. Those rows are reported as
 * rejections with the loader's own message rather than dropped, because "the sweep starts at 2100"
 * would otherwise look like a choice instead of a floor.
 */
const TAU_SWEEP_US = [
  1_000, 2_000, 2_100, 2_500, 3_000, 4_000, 5_000, 6_000, 8_000,
  10_000, 15_000, 20_000, 40_000, 60_000, 80_000,
] as const;

/**
 * `tools/gen-lamp-pwl.ts`'s pinned breakpoint construction: breakpoint 0 sits at 0 A and the
 * remaining N-1 are geometric from 1 mA to 800 mA.
 *
 * The 9-breakpoint table is built here by **re-sampling the shipped 33-breakpoint table** at those
 * nine currents through architecture §3.4's own interpolation. That is deliberate: it re-types no
 * physical law (the tungsten exponent, `R_hot`, `I_hot` and `R_cold` never appear here — the curve
 * comes out of the loaded profile), and `gen-lamp-pwl.ts` cannot be imported for the purpose
 * because it rewrites `data/profiles/*.json` at module scope. The cost is the 33-point table's own
 * chord error at those nine abscissae, which `test/mv601-ref.ts` puts at ~0.04%; measured against
 * the generator's own 9-point output the re-sampled table agrees to within 0.14% at every
 * breakpoint, which is far below the ~2.3% chord error the 9-point table itself carries at the
 * E-fed operating point — the thing this comparison exists to test.
 */
const PWL_LO_A = 1e-3;
const PWL_HI_A = 0.8;
const PWL_SHORT_N = 9;

/**
 * Figures quoted from the documents for comparison only. Nothing below is an input to any
 * computation in this file; they are printed beside the measured values so the finding can be read
 * without the documents open.
 */
const CITED_FACTS = [
  ['architecture §4.1 / components.md §8.3', 'light-load coil 6.92 V, fully-loaded coil 6.62 V, sag 4.38%'],
  ['architecture §4.1', 'the DC story needs 6.11% sag to put a nominal coil under threshold'],
  ['components.md §8.2', 'AT-01 loop 281.7 ohm, 46.2 mA, V_coil 6.92 V'],
  ['components.md §8.2', 'AT-05 0.844 A realistic; 1.57 A driving all six at E with thirteen lamps lit'],
  ['components.md §8.2', 'AT-06 13.0/0.67 = 19.4 A, ~13x trip'],
  ['components.md §9.3', 'a fast tap is ~30-50 ms; ~20 ms per stage puts the worst case at ~60 ms'],
] as const;

// -------------------------------------------------------------------------------------------
// Node ids for the hand-stamped circuits. Structure, not data: a closed contact is expressed by
// giving two element ends the same id, exactly as `test/solve.spec.ts` does.
// -------------------------------------------------------------------------------------------

/** MINUS. The datum (§3.1.2): eliminated from the matrix, voltage 0 by definition. */
const N_MINUS = 0;
/** PLUS. Every `+` terminal is one node (`components.md` §7.3, ERRATA opening notes). */
const N_PLUS = 1;
/** The measured stage's `E` terminal — the junction between its indicator lamp and its coil. */
const N_MEASURED_E = 2;
/** The five loading stages' `E` terminals. */
const N_LOAD_E0 = 3;
/**
 * A terminal with no path to the rail: an open feed contact, or the `C` of a relay driven at `E`
 * with nothing plugged into `C`. It still reaches the datum through the coil, so it is inside the
 * source component and stays in the matrix — it is not §3.1.4's prune case.
 */
const N_UNFED = 9;

// -------------------------------------------------------------------------------------------
// Environment: one loaded profile turned into the doubles the solver takes.
// -------------------------------------------------------------------------------------------

interface Env {
  p: Profile;
  cfg: SolveCfg;
  /** Ohms, henries, volts — the profile's integers in the solver's units. */
  rCoil: number;
  lCoil: number;
  rSrc: number;
  vOc: number;
  rCold: number;
  /** Ticks. `settle_cap_us` and `settle_quiet_ticks` are profile keys (§10.1); no cap is invented. */
  capTicks: number;
  quietTicks: number;
  flags: PortFlags;
  /**
   * Every `settle` this environment ran, in call order, with the tick count it stopped at and
   * whether it stopped because the quantized currents went quiet or because `settle_cap_us` ran
   * out. The convergence flag used to be reported for AT-01 alone, while `cStartUa` / `eStartUa` —
   * the two currents the whole release argument rests on — came out of settles nobody checked.
   */
  settles: { label: string; ticks: number; quiet: boolean }[];
}

/**
 * `kThermalOverride` is not a physical parameter. Passing 0 freezes every filament at whatever
 * resistance it is carrying, which is how the warm-lamp **counterfactual** of the AT-02 block is
 * built — see `riseWarm`. It is never used for an acceptance-test verdict.
 */
function makeEnv(p: Profile, kThermalOverride: number | null): Env {
  const v = p.v;
  return {
    p,
    cfg: {
      dtS: v.tick_us * 1e-6,
      vArc: v.V_arc_clamp_mv * 1e-3,
      kThermal: kThermalOverride === null ? p.derived.kThermal : kThermalOverride,
      gminS: v.gmin_ns * 1e-9,
      pwl: { xs: p.pwl.map((q) => q[0] * 1e-6), ys: p.pwl.map((q) => q[1] * 1e-6) },
      datum: N_MINUS,
    },
    rCoil: v.R_coil_uohm * 1e-6,
    lCoil: v.L_coil_uh * 1e-6,
    rSrc: v.R_src_uohm * 1e-6,
    vOc: v.V_oc_mv * 1e-3,
    rCold: v.R_cold_uohm * 1e-6,
    capTicks: idivRound(v.settle_cap_us, v.tick_us),
    quietTicks: v.settle_quiet_ticks,
    flags: { nonPortable: false },
    settles: [],
  };
}

function coil(e: Env, a: number, b: number): El {
  return { k: 'coil', a, b, rOhm: e.rCoil, lH: e.lCoil };
}
function lamp(a: number, b: number): El {
  return { k: 'lamp', a, b };
}
function source(e: Env): El {
  // Determinism rule 2 and `solve.ts`'s own assertion: the source is stamped last, always.
  return { k: 'source', a: N_PLUS, b: N_MINUS, vOc: e.vOc, rSrcOhm: e.rSrc };
}

/** Amps -> µA and volts -> mV through the one quantizer of §3.5 / determinism rule 10. */
function ua(e: Env, amps: number): number {
  return quantize(amps, 1e6, e.flags);
}
function mv(e: Env, volts: number): number {
  return quantize(volts, 1e3, e.flags);
}

interface SettleOut {
  /** Per element, µA, at the settled tick. */
  iUa: number[];
  /** Per element, µA, the largest magnitude seen at any tick — the pull-in decision reads this. */
  peakUa: number[];
  /** Per node, mV, at the settled tick. NaN nodes (floating, §3.1.4) come back as 0 and are flagged. */
  vMv: number[];
  ticks: number;
  quiet: boolean;
}

/**
 * Run a circuit until its quantized branch currents stop moving for `settle_quiet_ticks`, or until
 * `settle_cap_us` is spent. Both bounds are profile keys (§10.1), so the run length is not a number
 * this file invented.
 *
 * The peak is tracked because architecture §4.3's hysteresis makes pull-in a decision on the
 * **largest** current the coil reaches, not on its settled value — and with `LAMP-THERMAL-R`
 * (O-E12) live, a C-fed coil's cold-filament inrush is well above its own DC operating point. That
 * distinction turns out to decide AT-11, so both numbers are reported everywhere.
 */
function settle(els: readonly El[], carried: Carried, e: Env, label: string): SettleOut {
  const n = els.length;
  const peak = new Float64Array(n);
  let prev: number[] | null = null;
  let quietRun = 0;
  let iUa: number[] = [];
  let vMv: number[] = [];
  let ticks = 0;
  let quiet = false;
  for (let t = 0; t < e.capTicks; t++) {
    const r = tickSolve(els, carried, e.cfg);
    if (r.nonPortable) e.flags.nonPortable = true;
    ticks = t + 1;
    iUa = [];
    for (let k = 0; k < n; k++) {
      const a = r.branchI[k] as number;
      const mag = a < 0 ? -a : a;
      if (mag > (peak[k] as number)) peak[k] = mag;
      iUa.push(ua(e, a));
    }
    vMv = [];
    for (let k = 0; k < r.v.length; k++) {
      const x = r.v[k] as number;
      vMv.push(Number.isNaN(x) ? 0 : mv(e, x));
    }
    let same = prev !== null && prev.length === iUa.length;
    if (same && prev !== null) {
      for (let k = 0; k < iUa.length; k++) if (prev[k] !== iUa[k]) { same = false; break; }
    }
    if (same) {
      quietRun++;
      if (quietRun >= e.quietTicks) { quiet = true; break; }
    } else {
      quietRun = 0;
      prev = iUa;
    }
  }
  const peakUa: number[] = [];
  for (let k = 0; k < n; k++) peakUa.push(ua(e, peak[k] as number));
  e.settles.push({ label, ticks, quiet });
  return { iUa, peakUa, vMv, ticks, quiet };
}

function coldStart(els: readonly El[], e: Env): Carried {
  let nc = 0;
  let nl = 0;
  for (const el of els) {
    if (el.k === 'coil') nc++;
    else if (el.k === 'lamp') nl++;
  }
  // `FALLBACK-PWRUP-COLD` (`programs.md` §2): every filament starts at R_cold, every coil at 0 A.
  return { iCoil: new Float64Array(nc), rLamp: new Float64Array(nl).fill(e.rCold) };
}

// -------------------------------------------------------------------------------------------
// The circuits.
// -------------------------------------------------------------------------------------------

/**
 * AT-01 — Book I Experiment 9's latch, hand-stamped: `1F/1-`, `1C/1X`, `1Y/2Y`, `2Y/2+`, `2Z/1L`,
 * `1K/1C`. Both the initial press (`1X` -> `1C`) and the self-hold (`1K/1C`) land on the **same**
 * terminal, so the coil is fed through its own indicator lamp in both phases and the electrical
 * circuit is one C-fed branch. Contacts do not exist in W1; the two feed paths are the same node.
 */
function at01Circuit(e: Env): El[] {
  return [lamp(N_PLUS, N_MEASURED_E), coil(e, N_MEASURED_E, N_MINUS), source(e)];
}

/** AT-04 — a series resistor into the bare coil at `V_oc`, the descending Book VII bias search. */
function at04Circuit(e: Env, rOhm: number): El[] {
  return [{ k: 'res', a: N_PLUS, b: N_MEASURED_E, rOhm }, coil(e, N_MEASURED_E, N_MINUS), source(e)];
}

/** AT-07 as printed, `1X/1E`: the rail on `E`, nothing in `C`, so the lamp branch dangles. */
function at07ECircuit(e: Env): El[] {
  return [lamp(N_UNFED, N_PLUS), coil(e, N_PLUS, N_MINUS), source(e)];
}

/**
 * AT-11's circuit and AT-05's realistic case: six relay stages driven through their own indicator
 * lamps, plus the POWER light, plus `nOut` lit output lamps.
 */
function machineCircuit(e: Env, nOut: number): El[] {
  const els: El[] = [];
  for (let i = 0; i < RELAY_COUNT; i++) {
    els.push(lamp(N_PLUS, N_LOAD_E0 + i));
    els.push(coil(e, N_LOAD_E0 + i, N_MINUS));
  }
  els.push(lamp(N_PLUS, N_MINUS)); // the POWER light, §7.3
  for (let i = 0; i < nOut; i++) els.push(lamp(N_PLUS, N_MINUS));
  els.push(source(e));
  return els;
}

/**
 * AT-05's worst case, read literally off `components.md` §8.2: "Driving all six coils at E while
 * lighting thirteen lamps reaches 1.57 A and does trip — reachable by an unusual program, not by a
 * normal one." Six coils on the full rail and thirteen lamps on the full rail, at once.
 */
function at05WorstCircuit(e: Env): El[] {
  const els: El[] = [];
  for (let i = 0; i < RELAY_COUNT; i++) els.push(coil(e, N_PLUS, N_MINUS));
  for (let i = 0; i < RELAY_COUNT + OUTPUT_LAMPS_MAX + 1; i++) els.push(lamp(N_PLUS, N_MINUS));
  els.push(source(e));
  return els;
}

/**
 * AT-02's loaded stand-in — one measured stage plus the rest of the machine's load, about twenty
 * elements in a literal array. Architecture §4.1's mechanism is a **whole-machine** property ("a
 * few percent of rail sag from five other coils and twelve lamps"), which one stage in isolation
 * cannot show.
 *
 * The measured stage is element 0 (its lamp) and element 1 (its coil) in both variants, so the
 * carried state indices line up and the feed can be opened and closed between two arrays of
 * identical shape. `fed === false` puts the feed on `N_UNFED`: the branch hangs off the datum
 * through its own coil, carries no current, and its filament relaxes to cold — which is the state a
 * dark counter stage is actually in when the carry reaches it.
 */
function standInCircuit(e: Env, cFed: boolean, nOut: number, fed: boolean): El[] {
  const feed = fed ? N_PLUS : N_UNFED;
  const els: El[] = cFed
    ? [lamp(feed, N_MEASURED_E), coil(e, N_MEASURED_E, N_MINUS)]
    : [lamp(feed, feed), coil(e, feed, N_MINUS)];
  for (let i = 0; i < RELAY_COUNT - 1; i++) {
    els.push(lamp(N_PLUS, N_LOAD_E0 + i));
    els.push(coil(e, N_LOAD_E0 + i, N_MINUS));
  }
  els.push(lamp(N_PLUS, N_MINUS)); // POWER light
  for (let i = 0; i < nOut; i++) els.push(lamp(N_PLUS, N_MINUS));
  els.push(source(e));
  return els;
}

// -------------------------------------------------------------------------------------------
// The measurements.
// -------------------------------------------------------------------------------------------

interface Rise {
  /** Ticks from the feed closing to the coil crossing `thrUa`, or null if it never does. */
  ticks: number | null;
  /** The coil current at the crossing, or the current at the cap if there was none. */
  iUa: number;
  /** The largest current reached over the whole run. */
  peakUa: number;
}

/**
 * Measured rise: settle the machine with the stage's feed OPEN, then close it and count ticks to
 * the relay's own pull-in current.
 *
 * This is the state the counter is actually in — five stages lit and warm, the sixth dark and its
 * filament cold — and it is not the same as a cold power-on, which would start every filament
 * together.
 */
function rise(e: Env, cFed: boolean, nOut: number, thrUa: number): Rise {
  const open = standInCircuit(e, cFed, nOut, false);
  const carried = coldStart(open, e);
  settle(open, carried, e, 'AT-02 rise ' + (cFed ? 'C' : 'E') + '-fed, feed OPEN (pre-state)');
  const closed = standInCircuit(e, cFed, nOut, true);
  let peak = 0;
  let last = 0;
  for (let t = 1; t <= e.capTicks; t++) {
    const r = tickSolve(closed, carried, e.cfg);
    if (r.nonPortable) e.flags.nonPortable = true;
    const i = ua(e, r.branchI[1] as number);
    if (i > peak) peak = i;
    last = i;
    if (i >= thrUa) return { ticks: t, iUa: i, peakUa: peak };
  }
  // The threshold search IS the run, and `settle_cap_us` bounds it. Continuing into a second,
  // unmonitored settle would measure this row past its own cap, miss any crossing that happened
  // in there while still reporting `ticks: null`, and push a row into the settle census that
  // nothing reads. Report the endpoint of the capped search instead.
  return { ticks: null, iUa: last, peakUa: peak };
}

/**
 * The same rise with the filament held at its warm operating value — a **counterfactual**, stated
 * as one. It holds the filament at its warm operating value while retaining the settled loading
 * state, and reports that result separately from the model's ordinary run.
 */
function riseWarm(e: Env, cFed: boolean, nOut: number, thrUa: number): Rise {
  const closed = standInCircuit(e, cFed, nOut, true);
  const carried = coldStart(closed, e);
  settle(closed, carried, e, 'AT-02 warm counterfactual ' + (cFed ? 'C' : 'E') + '-fed, settle to warm');
  const frozen = makeEnv(e.p, 0);
  // ONE variable. The previous revision restarted from `new Float64Array(...)`, which zeroes ALL
  // SIX coil currents: that does not just freeze the filament, it also un-loads the five other
  // stages and hands the measured coil a rail nothing else is pulling on yet — which is the load
  // the AT-02 stand-in exists to model. Here the settled state is carried forward intact (five
  // loading coils at their settled currents, every filament at its warm resistance) and the
  // measured stage's own coil — `iCoil[0]`, the first coil stamped by `standInCircuit` in both
  // variants — is the single quantity set back to zero.
  const restarted: Carried = { iCoil: Float64Array.from(carried.iCoil), rLamp: carried.rLamp };
  restarted.iCoil[0] = 0;
  let peak = 0;
  let last = 0;
  for (let t = 1; t <= e.capTicks; t++) {
    const r = tickSolve(closed, restarted, frozen.cfg);
    if (r.nonPortable) e.flags.nonPortable = true;
    const i = ua(e, r.branchI[1] as number);
    if (i > peak) peak = i;
    last = i;
    if (i >= thrUa) return { ticks: t, iUa: i, peakUa: peak };
  }
  // Same bound as the model run above: stop at `settle_cap_us` and report the endpoint of the
  // capped search, so `ticks: null` means exactly "no crossing inside the cap" and the two rows
  // report the same quantity measured over the same window.
  return { ticks: null, iUa: last, peakUa: peak };
}

/**
 * The two release paths of architecture §4.2, measured rather than asserted.
 *
 * `shorted`: both coil ends land on one node, the branch voltage is 0 and the current freewheels on
 * `L/R_coil`. `open`: the feeding contact has left, one end dangles, and the coil stays in the
 * matrix where the arc pass of §3.2 step 5 clamps it.
 *
 * The open ramp is **measured, not computed**. `docs/DECISIONS.md`, *2026-08-30 — Phase 1 Wave 1a
 * spec readings*, records that §3.3, §4.2 and O-E11's "ramps down at `V_arc/L` per tick" is
 * shorthand: the companion gives
 * `di = (V_arc*dt + i_prev*R_coil*dt) / (L + R_coil*dt)` — the arc term plus the L/R decay — and the
 * clamped node does not sit exactly at `V_arc` either, because `Garc` is finite. On the shipped
 * numbers the real first step is ~3.44 mA against the shorthand's 2.50 mA, so the shorthand would
 * overstate the open release by ~40%.
 */
function releaseHoldOffTicks(e: Env, i0A: number, shorted: boolean, dropUa: number): number | null {
  const els: El[] = shorted
    ? [coil(e, N_PLUS, N_PLUS), source(e)]
    : [coil(e, N_UNFED, N_MINUS), source(e)];
  const carried: Carried = { iCoil: Float64Array.from([i0A]), rLamp: new Float64Array(0) };
  for (let t = 1; t <= e.capTicks; t++) {
    const r = tickSolve(els, carried, e.cfg);
    if (r.nonPortable) e.flags.nonPortable = true;
    if (ua(e, r.branchI[0] as number) <= dropUa) return t;
  }
  return null;
}

// -------------------------------------------------------------------------------------------
// The battery: every acceptance test and every relay decision, as one record of quantized
// integers. The controls and the 9-vs-33 PWL comparison both run this and diff the result.
// -------------------------------------------------------------------------------------------

interface At11Row {
  nOut: number;
  peakUa: number[];
  settledUa: number[];
  /** `peak - relayPullInUa[i]`: the pull-in decision under §4.3's hysteresis. */
  pullInMarginUa: number[];
  /** `settled - relayPullInUa[i]`: the DC decision `components.md` §8.3's arithmetic is about. */
  dcMarginUa: number[];
  /** `settled - relayDropOutUa[i]`: whether a latched armature stays latched. */
  holdMarginUa: number[];
  pullInAll: boolean;
  dcAll: boolean;
  holdAll: boolean;
  supplyUa: number;
  railMv: number;
}

interface At02 {
  nOut: number;
  thrUa: number;
  tCTicks: number | null;
  tETicks: number | null;
  tCNominalTicks: number | null;
  tENominalTicks: number | null;
  ratio: number | null;
  warmTCTicks: number | null;
  warmTETicks: number | null;
  warmRatio: number | null;
  /** Rail and coil, light load (AT-01) versus the fully-loaded stand-in. */
  lightRailMv: number;
  loadedRailMv: number;
  lightCoilMv: number;
  loadedCoilMv: number;
  railSagPct: number;
  coilSagPct: number;
  /** The sag the DC story would need, derived from the profile: (V_light - V_pullin)/V_light. */
  neededSagPct: number;
  /** Operate device time = electrical rise + the mechanical stroke, ticks. */
  deviceCTicks: number | null;
  deviceETicks: number | null;
  /** The shorted release each drive's stored current produces, hold-off + mechanical stroke. */
  shortedReleaseCTicks: number | null;
  shortedReleaseETicks: number | null;
  /** Worst chain read literally as 3 x the operate device time. */
  chainLiteralCTicks: number | null;
  chainLiteralETicks: number | null;
  /**
   * Both §9.3 chains, composed, one row per `CARRY_CHAINS` entry: 3->4 is two shorted releases
   * plus one terminating operate, 7->0 is three shorted releases and no operate.
   *
   * `mechOnly*` is the same composition with the **electrical hold-off removed** from every
   * release — the mechanical stroke alone. It is a counterfactual on one modelling decision (§4.2:
   * the shorted coil freewheels on `L/R_coil` before the armature starts to move), reported
   * because that decision, and not the size of any measured quantity, is what sets the SIGN of the
   * R6 window.
   */
  chainCTicks: (number | null)[];
  chainETicks: (number | null)[];
  chainWorstCTicks: number | null;
  chainWorstETicks: number | null;
  chainWorstCId: string | null;
  chainWorstEId: string | null;
  mechOnlyCTicks: (number | null)[];
  mechOnlyETicks: (number | null)[];
  mechOnlyWorstCTicks: number | null;
  mechOnlyWorstETicks: number | null;
}

interface Release {
  cStartUa: number;
  eStartUa: number;
  /** Did the settle those two currents come out of actually converge? (fix 8: never checked before) */
  cStartQuiet: boolean;
  eStartQuiet: boolean;
  cStartTicks: number;
  eStartTicks: number;
  cShortedHoldOff: number | null;
  cOpenHoldOff: number | null;
  eShortedHoldOff: number | null;
  eOpenHoldOff: number | null;
  cRatio: number | null;
  eRatio: number | null;
  cInBand: boolean;
  eInBand: boolean;
}

interface Battery {
  profileId: string;
  lCoilUh: number;
  dVRelayMv: readonly number[];
  pwlPoints: number;
  at01: {
    coilUa: number; peakUa: number; coilMv: number; railMv: number; lampUa: number;
    supplyUa: number; thrUa: number; dropUa: number; marginUa: number; pullsIn: boolean; holds: boolean;
    quiet: boolean; ticks: number;
  };
  at04: { rOhm: number; iUa: number; inside: boolean; abovePullIn: boolean }[];
  at05: {
    cFedSupplyUa: number; cFedPeakUa: number; eFedSupplyUa: number; eFedPeakUa: number;
    tripUa: number; tripDelayTicks: number; cFedTrips: boolean; eFedTrips: boolean;
    eFedPeakTrips: boolean; eFedTicksOverTrip: number;
  };
  at06: { supplyUa: number; trips: boolean; overTrip: number };
  at07: {
    eCoilUa: number; eLampUa: number; eLampMilli: number;
    cCoilUa: number; cLampUa: number; cLampMilli: number;
    onMilli: number; dimMilli: number;
  };
  at10: { stopShortUa: number; trips: boolean; shortPlusMinusUa: number; shortTrips: boolean };
  at11: { rows: At11Row[]; firstDcFailNOut: number | null; firstPullInFailNOut: number | null };
  at02: At02;
  release: Release;
  /** Every settle this battery ran, with its tick count and its convergence flag (fix 8). */
  settles: { label: string; ticks: number; quiet: boolean }[];
  nonPortable: boolean;
}

function runBattery(p: Profile): Battery {
  const e = makeEnv(p, null);
  const d = p.derived;
  const v = p.v;

  // --- AT-01 -------------------------------------------------------------------------------
  const c01 = at01Circuit(e);
  const s01 = settle(c01, coldStart(c01, e), e, 'AT-01 latch');
  const thr0 = d.relayPullInUa[0] as number;
  const drop0 = d.relayDropOutUa[0] as number;
  const at01 = {
    coilUa: s01.iUa[1] as number,
    peakUa: s01.peakUa[1] as number,
    coilMv: s01.vMv[N_MEASURED_E] as number,
    railMv: s01.vMv[N_PLUS] as number,
    lampUa: s01.iUa[0] as number,
    supplyUa: s01.iUa[2] as number,
    thrUa: thr0,
    dropUa: drop0,
    marginUa: (s01.iUa[1] as number) - thr0,
    pullsIn: (s01.peakUa[1] as number) >= thr0,
    // "Stays latched" is a DROP-OUT question, not a pull-in one: an operated armature holds
    // anywhere strictly above `relayDropOutUa`. Same predicate as AT-11's `holdAll`. The
    // settled-vs-pull-in comparison is `marginUa`, reported separately as the DC reading.
    holds: (s01.iUa[1] as number) > drop0,
    quiet: s01.quiet,
    ticks: s01.ticks,
  };

  // --- AT-04 -------------------------------------------------------------------------------
  const at04: Battery['at04'] = [];
  for (const rOhm of [...E12_INSIDE_OHM, ...E12_BELOW_OHM]) {
    const c = at04Circuit(e, rOhm);
    const s = settle(c, coldStart(c, e), e, 'AT-04 ' + rOhm + ' ohm');
    const i = s.iUa[1] as number;
    at04.push({ rOhm, iUa: i, inside: i > d.dropOutUa && i < d.pullInUa, abovePullIn: i >= d.pullInUa });
  }

  // --- AT-05 -------------------------------------------------------------------------------
  const c05c = machineCircuit(e, OUTPUT_LAMPS_MAX);
  const s05c = settle(c05c, coldStart(c05c, e), e, 'AT-05 six C-fed + thirteen lamps');
  const c05e = at05WorstCircuit(e);
  const carried05e = coldStart(c05e, e);
  // Contiguous ticks from power-on for which the supply is over the breaker's trip current. The
  // cold-filament inrush of thirteen dark lamps (O-E12) is a real overcurrent the DC arithmetic of
  // §8.2 has no way to see; whether it trips is `trip_delay_us`'s business, in W3.
  let ticksOver = 0;
  for (let t = 0; t < e.capTicks; t++) {
    const r = tickSolve(c05e, carried05e, e.cfg);
    if (r.nonPortable) e.flags.nonPortable = true;
    // `devices.ts`'s `breakerOverThreshold` is `iabs(supplyUa) >= tripUa`; match it exactly —
    // magnitude, and equality counts as over-threshold.
    if (Math.abs(ua(e, r.branchI[c05e.length - 1] as number)) < v.I_trip_ua) break;
    ticksOver++;
  }
  const s05e = settle(c05e, coldStart(c05e, e), e, 'AT-05 six E-fed + thirteen lamps');
  const at05 = {
    cFedSupplyUa: s05c.iUa[c05c.length - 1] as number,
    cFedPeakUa: s05c.peakUa[c05c.length - 1] as number,
    eFedSupplyUa: s05e.iUa[c05e.length - 1] as number,
    eFedPeakUa: s05e.peakUa[c05e.length - 1] as number,
    tripUa: v.I_trip_ua,
    tripDelayTicks: idivRound(v.trip_delay_us, v.tick_us),
    cFedTrips: Math.abs(s05c.iUa[c05c.length - 1] as number) >= v.I_trip_ua,
    eFedTrips: Math.abs(s05e.iUa[c05e.length - 1] as number) >= v.I_trip_ua,
    eFedPeakTrips: (s05e.peakUa[c05e.length - 1] as number) >= v.I_trip_ua,
    eFedTicksOverTrip: ticksOver,
  };

  // --- AT-06: a dead `+`/`-` cord. Both source terminals land on the datum, so N = 0 and the
  // --- solve is the zero-unknown system of §3.3; the supply companion still yields a current.
  const c06: El[] = [{ k: 'source', a: N_MINUS, b: N_MINUS, vOc: e.vOc, rSrcOhm: e.rSrc }];
  const r06 = tickSolve(c06, coldStart(c06, e), e.cfg);
  if (r06.nonPortable) e.flags.nonPortable = true;
  const i06 = ua(e, r06.branchI[0] as number);
  const at06 = {
    supplyUa: i06,
    trips: Math.abs(i06) >= v.I_trip_ua,
    overTrip: Math.abs(i06) / v.I_trip_ua,
  };

  // --- AT-07 -------------------------------------------------------------------------------
  const c07e = at07ECircuit(e);
  const s07e = settle(c07e, coldStart(c07e, e), e, 'AT-07 E-fed');
  const eLamp = s07e.iUa[0] as number;
  const cLamp = at01.lampUa;
  // §10.1's brightness map: the lamp's current against `I_hot_ua`, in milli, classified by
  // `lamp_on_milli` / `lamp_dim_milli` (§9.2's three bands).
  const at07 = {
    eCoilUa: s07e.iUa[1] as number,
    eLampUa: eLamp,
    eLampMilli: idivRound((eLamp < 0 ? -eLamp : eLamp) * 1000, v.I_hot_ua),
    cCoilUa: at01.coilUa,
    cLampUa: cLamp,
    cLampMilli: idivRound((cLamp < 0 ? -cLamp : cLamp) * 1000, v.I_hot_ua),
    onMilli: v.lamp_on_milli,
    dimMilli: v.lamp_dim_milli,
  };

  // --- AT-10: a short across the STOP terminals leaves R1 in series with the supply, which is the
  // --- whole point of `R1_uohm` (architecture §5; BK1 printed p.22). The `+`/`-` short is AT-06.
  const c10: El[] = [{ k: 'res', a: N_PLUS, b: N_MINUS, rOhm: v.R1_uohm * 1e-6 }, source(e)];
  const r10 = tickSolve(c10, coldStart(c10, e), e.cfg);
  if (r10.nonPortable) e.flags.nonPortable = true;
  const i10 = ua(e, r10.branchI[1] as number);
  const at10 = {
    stopShortUa: i10,
    trips: Math.abs(i10) >= v.I_trip_ua,
    shortPlusMinusUa: i06,
    shortTrips: at06.trips,
  };

  // --- AT-11 -------------------------------------------------------------------------------
  const rows: At11Row[] = [];
  let firstDcFail: number | null = null;
  let firstPullInFail: number | null = null;
  for (let nOut = 0; nOut <= OUTPUT_LAMPS_MAX; nOut++) {
    const c = machineCircuit(e, nOut);
    const s = settle(c, coldStart(c, e), e, 'AT-11 n_out=' + nOut);
    const peakUa: number[] = [];
    const settledUa: number[] = [];
    for (let k = 0; k < c.length; k++) {
      if ((c[k] as El).k !== 'coil') continue;
      peakUa.push(s.peakUa[k] as number);
      settledUa.push(s.iUa[k] as number);
    }
    const pullInMarginUa = peakUa.map((x, i) => x - (d.relayPullInUa[i] as number));
    const dcMarginUa = settledUa.map((x, i) => x - (d.relayPullInUa[i] as number));
    const holdMarginUa = settledUa.map((x, i) => x - (d.relayDropOutUa[i] as number));
    const row: At11Row = {
      nOut,
      peakUa,
      settledUa,
      pullInMarginUa,
      dcMarginUa,
      holdMarginUa,
      pullInAll: pullInMarginUa.every((m) => m >= 0),
      dcAll: dcMarginUa.every((m) => m >= 0),
      holdAll: holdMarginUa.every((m) => m > 0),
      supplyUa: s.iUa[c.length - 1] as number,
      railMv: s.vMv[N_PLUS] as number,
    };
    if (!row.dcAll && firstDcFail === null) firstDcFail = nOut;
    if (!(row.pullInAll && row.holdAll) && firstPullInFail === null) firstPullInFail = nOut;
    rows.push(row);
  }
  const at11 = { rows, firstDcFailNOut: firstDcFail, firstPullInFailNOut: firstPullInFail };

  // --- AT-02, loaded ------------------------------------------------------------------------
  const nOut = OUTPUT_LAMPS_MAX;
  const riseC = rise(e, true, nOut, thr0);
  const riseE = rise(e, false, nOut, thr0);
  const riseCn = rise(e, true, nOut, d.pullInUa);
  const riseEn = rise(e, false, nOut, d.pullInUa);
  // The counterfactual stays against the NOMINAL pull-in, not relay 1's own: it is the frozen W1
  // diagnostic comparing two L/R time constants. Wave D moved relay 1's indexed threshold; it does
  // not retroactively change the diagnostic's definition or make that old joint result a gate.
  const warmC = riseWarm(e, true, nOut, d.pullInUa);
  const warmE = riseWarm(e, false, nOut, d.pullInUa);

  const loadedC = standInCircuit(e, true, nOut, true);
  const sLoadedC = settle(loadedC, coldStart(loadedC, e), e, 'AT-02 loaded C-fed (source of cStartUa)');
  const loadedE = standInCircuit(e, false, nOut, true);
  const sLoadedE = settle(loadedE, coldStart(loadedE, e), e, 'AT-02 loaded E-fed (source of eStartUa)');

  const lightCoilMv = at01.coilMv;
  const loadedCoilMv = sLoadedC.vMv[N_MEASURED_E] as number;
  const lightRailMv = at01.railMv;
  const loadedRailMv = sLoadedC.vMv[N_PLUS] as number;

  // The release each drive's own stored current produces. §4.2: the shorted path freewheels on
  // L/R_coil from wherever the coil was sitting, so the C-fed and E-fed counters do NOT share a
  // release time — the E-fed coil stores twice the current and takes longer to fall.
  const cStartUa = sLoadedC.iUa[1] as number;
  const eStartUa = sLoadedE.iUa[1] as number;
  const cShort = releaseHoldOffTicks(e, cStartUa * 1e-6, true, drop0);
  const cOpen = releaseHoldOffTicks(e, cStartUa * 1e-6, false, drop0);
  const eShort = releaseHoldOffTicks(e, eStartUa * 1e-6, true, drop0);
  const eOpen = releaseHoldOffTicks(e, eStartUa * 1e-6, false, drop0);
  const relTicks = d.relayReleaseTicks;
  const cRatio = cShort === null || cOpen === null ? null : (cShort + relTicks) / (cOpen + relTicks);
  const eRatio = eShort === null || eOpen === null ? null : (eShort + relTicks) / (eOpen + relTicks);
  const release: Release = {
    cStartUa,
    eStartUa,
    cStartQuiet: sLoadedC.quiet,
    eStartQuiet: sLoadedE.quiet,
    cStartTicks: sLoadedC.ticks,
    eStartTicks: sLoadedE.ticks,
    cShortedHoldOff: cShort,
    cOpenHoldOff: cOpen,
    eShortedHoldOff: eShort,
    eOpenHoldOff: eOpen,
    cRatio,
    eRatio,
    cInBand: cRatio !== null && cRatio >= RELEASE_RATIO_LO && cRatio <= RELEASE_RATIO_HI,
    eInBand: eRatio !== null && eRatio >= RELEASE_RATIO_LO && eRatio <= RELEASE_RATIO_HI,
  };

  const devC = riseC.ticks === null ? null : riseC.ticks + d.relayOperateTicks;
  const devE = riseE.ticks === null ? null : riseE.ticks + d.relayOperateTicks;
  const shortRelC = cShort === null ? null : cShort + relTicks;
  const shortRelE = eShort === null ? null : eShort + relTicks;
  // §9.3 reads the worst step as three device times; the literal reading multiplies the OPERATE
  // device time by three, which is what the chain is NOT (it is release-dominated) and is kept only
  // so the two readings can be compared side by side.
  const chainCount = (CARRY_CHAINS[0] as { shortedReleases: number }).shortedReleases +
    (CARRY_CHAINS[0] as { operates: number }).operates;
  /** One composed chain, ticks: `shortedReleases x shorted-release device time + operates x operate`. */
  const compose = (
    ch: { shortedReleases: number; operates: number },
    shortRel: number | null,
    dev: number | null,
  ): number | null => {
    if (ch.shortedReleases > 0 && shortRel === null) return null;
    if (ch.operates > 0 && dev === null) return null;
    return ch.shortedReleases * (shortRel ?? 0) + ch.operates * (dev ?? 0);
  };
  /** The same with the electrical hold-off struck out of every release: the mechanical stroke only. */
  const composeMech = (
    ch: { shortedReleases: number; operates: number },
    dev: number | null,
  ): number | null => {
    if (ch.operates > 0 && dev === null) return null;
    return ch.shortedReleases * relTicks + ch.operates * (dev ?? 0);
  };
  const chainC = CARRY_CHAINS.map((ch) => compose(ch, shortRelC, devC));
  const chainE = CARRY_CHAINS.map((ch) => compose(ch, shortRelE, devE));
  const mechC = CARRY_CHAINS.map((ch) => composeMech(ch, devC));
  const mechE = CARRY_CHAINS.map((ch) => composeMech(ch, devE));
  /** The worse (longer) of the composed chains, per drive — evaluated, not assumed. */
  const worst = (xs: (number | null)[]): { ticks: number | null; id: string | null } => {
    let bestI = -1;
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i];
      if (x === null || x === undefined) continue;
      if (bestI < 0 || x > (xs[bestI] as number)) bestI = i;
    }
    // A chain that could not be composed at all is a chain the hold can never satisfy, so it is
    // reported as `never` rather than silently dropped in favour of the one that did compose.
    for (const x of xs) if (x === null) return { ticks: null, id: null };
    return bestI < 0
      ? { ticks: null, id: null }
      : { ticks: xs[bestI] as number, id: (CARRY_CHAINS[bestI] as { id: string }).id };
  };
  const worstC = worst(chainC);
  const worstE = worst(chainE);
  const worstMechC = worst(mechC);
  const worstMechE = worst(mechE);
  const at02: At02 = {
    nOut,
    thrUa: thr0,
    tCTicks: riseC.ticks,
    tETicks: riseE.ticks,
    tCNominalTicks: riseCn.ticks,
    tENominalTicks: riseEn.ticks,
    ratio: riseC.ticks === null || riseE.ticks === null ? null : riseC.ticks / riseE.ticks,
    warmTCTicks: warmC.ticks,
    warmTETicks: warmE.ticks,
    warmRatio: warmC.ticks === null || warmE.ticks === null ? null : warmC.ticks / warmE.ticks,
    lightRailMv,
    loadedRailMv,
    lightCoilMv,
    loadedCoilMv,
    railSagPct: ((lightRailMv - loadedRailMv) / lightRailMv) * 100,
    coilSagPct: ((lightCoilMv - loadedCoilMv) / lightCoilMv) * 100,
    neededSagPct: ((lightCoilMv - v.V_pullin_mv) / lightCoilMv) * 100,
    deviceCTicks: devC,
    deviceETicks: devE,
    shortedReleaseCTicks: shortRelC,
    shortedReleaseETicks: shortRelE,
    chainLiteralCTicks: devC === null ? null : devC * chainCount,
    chainLiteralETicks: devE === null ? null : devE * chainCount,
    chainCTicks: chainC,
    chainETicks: chainE,
    chainWorstCTicks: worstC.ticks,
    chainWorstETicks: worstE.ticks,
    chainWorstCId: worstC.id,
    chainWorstEId: worstE.id,
    mechOnlyCTicks: mechC,
    mechOnlyETicks: mechE,
    mechOnlyWorstCTicks: worstMechC.ticks,
    mechOnlyWorstETicks: worstMechE.ticks,
  };

  return {
    profileId: p.id,
    lCoilUh: v.L_coil_uh,
    dVRelayMv: p.dVRelayMv,
    pwlPoints: p.pwl.length,
    at01,
    at04,
    at05,
    at06,
    at07,
    at10,
    at11,
    at02,
    release,
    settles: e.settles,
    nonPortable: e.flags.nonPortable,
  };
}

// -------------------------------------------------------------------------------------------
// The joint verdict. Stated once, in code, so every control is judged by the same rule.
// -------------------------------------------------------------------------------------------

interface Verdict {
  /** Book I Experiment 9 latches and stays latched through its own lamp (`components.md` §8.2). */
  at01Holds: boolean;
  /** Every relay pulls in and stays in with the whole machine lit (`components.md` §8.3, verified). */
  at11Holds: boolean;
  /**
   * The DC route, **two-sided**: the C-fed (lamp-fed) stage never reaches its own threshold AND the
   * E-fed (lamp-bypassed) one does.
   *
   * It used to be the one-sided `tCTicks === null`, which tests only that the lamp-fed side fails
   * and never that the bypassed side succeeds. R6 is a two-sided statement — "lamp-in-series must
   * make the counter marginal; lamp bypassed must make it **reliable**" — so a profile on which
   * NEITHER side counts would have read as a counter failure attributable to the lamp. It does not
   * bite on the shipped profile (the E-fed coil settles far above threshold; the margin is printed
   * with the release paths), but it is a latent hole in the predicate the whole wave turns on, and
   * the τ sweep below is exactly the regime that opens it.
   */
  counterFailsDc: boolean;
  /** `t_E` margin over threshold, µA, at the loaded operating point: why the second clause is slack. */
  eFedDcMarginUa: number;
  /** A hold H exists with `t_E_chain <= H < t_C_chain`: the E-fed chain completes, the C-fed does not. */
  counterFailsTiming: boolean;
  counterFails: boolean;
  /**
   * The same, but requiring the window to be a hold a human could actually produce. A discriminator
   * nobody can hit is not a discriminator: if the window lies outside the ~30-50 ms fast tap, then
   * every real press either completes both chains or neither, and SDC's lamp bypass buys nothing
   * observable. `components.md` §9.3's human-scale sanity check is the only bracket the corpus has.
   */
  counterFailsObservable: boolean;
  /**
   * The discriminating interval, ms, under the composed §9.3 chains: `lo` is the E-fed chain and
   * `hi` the C-fed one, each the WORSE of the 3->4 and 7->0 compositions for that drive.
   */
  windowLoMs: number | null;
  windowHiMs: number | null;
  windowMs: number | null;
  /** Which chain is the binding one, per drive. */
  worstChainCId: string | null;
  worstChainEId: string | null;
  /** The window with the electrical hold-off struck out of every release — mechanical stroke only. */
  mechOnlyWindowMs: number | null;
  /** Same, reading the worst chain literally as three operate device times. */
  literalLoMs: number | null;
  literalHiMs: number | null;
  /** Does the discriminating window overlap `components.md` §9.3's ~30-50 ms fast tap? */
  overlapsFastTap: boolean;
}

function verdict(b: Battery, tickUs: number): Verdict {
  const toMs = (t: number | null): number | null => (t === null ? null : (t * tickUs) / 1000);
  const lo = toMs(b.at02.chainWorstETicks);
  const hi = toMs(b.at02.chainWorstCTicks);
  const litLo = toMs(b.at02.chainLiteralETicks);
  const litHi = toMs(b.at02.chainLiteralCTicks);
  const mechLo = toMs(b.at02.mechOnlyWorstETicks);
  const mechHi = toMs(b.at02.mechOnlyWorstCTicks);
  // Two-sided, per R6's own wording: marginal WITH the lamp and reliable WITHOUT it.
  const counterFailsDc = b.at02.tCTicks === null && b.at02.tETicks !== null;
  const counterFailsTiming = lo !== null && hi !== null && hi > lo;
  const overlaps =
    // The discriminating hold set is half-open, [lo, hi) — R6-hold reads `windowLoMs <= holdMs`
    // and `windowHiMs > holdMs` — so it meets the closed bracket iff hi > 30 AND lo <= 50.
    lo !== null && hi !== null && hi > lo && hi > FAST_TAP_MS[0] && lo <= FAST_TAP_MS[1];
  const lastRow = b.at11.rows[b.at11.rows.length - 1] as At11Row;
  return {
    // Two-sided, like AT-11's row below: the armature has to pull in before "stays latched" is a
    // question at all. `holds` alone is a drop-out test, and the drop-out band is about a third of
    // pull-in, so a profile that never pulls in could otherwise report AT-01 as holding.
    at01Holds: b.at01.pullsIn && b.at01.holds,
    at11Holds: lastRow.pullInAll && lastRow.holdAll,
    counterFailsDc,
    eFedDcMarginUa: b.release.eStartUa - b.at02.thrUa,
    counterFailsTiming,
    counterFails: counterFailsDc || counterFailsTiming,
    counterFailsObservable: counterFailsDc || overlaps,
    windowLoMs: lo,
    windowHiMs: hi,
    windowMs: lo === null || hi === null ? null : hi - lo,
    worstChainCId: b.at02.chainWorstCId,
    worstChainEId: b.at02.chainWorstEId,
    mechOnlyWindowMs: mechLo === null || mechHi === null ? null : mechHi - mechLo,
    literalLoMs: litLo,
    literalHiMs: litHi,
    overlapsFastTap: overlaps,
  };
}

// -------------------------------------------------------------------------------------------
// R1-R6, through `profile.ts`'s evaluators, on the post-quantization tick counts.
// -------------------------------------------------------------------------------------------

interface ConstraintRun {
  holdMs: number;
  holdTicks: number;
  /** R1-R6 in order. R4 is the BINDING chain's result — see `r4ByChain` for both. */
  results: ConstraintResult[];
  /** R4 evaluated once per `CARRY_CHAINS` entry, so the composition is visible and not asserted. */
  r4ByChain: { id: string; result: ConstraintResult }[];
  bindingChainId: string;
}

/** Index of R4 in `evalConstraints`'s fixed R1..R6 ordering. */
const R4_INDEX = 3;

function runConstraints(p: Profile, b: Battery, vd: Verdict): ConstraintRun[] {
  const out: ConstraintRun[] = [];
  for (const holdMs of FAST_TAP_MS) {
    const holdTicks = idivRound(holdMs * 1000, p.v.tick_us);
    const base = {
      buttonHoldTicks: holdTicks,
      // A tap's up-interval is the same order as its down-interval; the corpus gives no other
      // figure, so the same bracket is used and the reading is stated rather than hidden.
      buttonUpTicks: holdTicks,
      shortedHoldOffTicks: b.release.cShortedHoldOff,
      // `components.md` §9.3 ships `supply_ripple` default OFF, so R5 stays unevaluated rather
      // than being handed a period it did not earn.
      ripplePeriodUs: null,
      r6: {
        // "Miscounts with the lamp in series" and "counts with it bypassed" are the two verdicts
        // R6 is a statement about; the decision margin is the DC margin the relay decision turns
        // on at the loaded operating point. This is `R6-hold` — a DIFFERENT test from the sweep's
        // `R6-observable`; the block below the sweep says how they differ and why both are kept.
        miscountsWithLamp: vd.counterFailsDc || (vd.windowHiMs !== null && vd.windowHiMs > holdMs),
        countsWithoutLamp: vd.windowLoMs !== null && vd.windowLoMs <= holdMs,
        marginUa: b.release.cStartUa - b.at01.thrUa,
      },
    };
    // R4 is the one constraint that reads the carry chain, and §9.3 names TWO worst steps whose
    // compositions differ. Both are evaluated through `profile.ts`'s own formula — this file does
    // not re-implement it to pick between them — and the binding (largest required) one is the R4
    // the run reports. On a drive whose shorted release exceeds its operate that is 7->0.
    const perChain = CARRY_CHAINS.map((ch) => ({
      id: ch.id,
      results: evalConstraints(p, {
        ...base,
        carryChain: { shortedReleases: ch.shortedReleases, operates: ch.operates },
      } satisfies ConstraintInputs),
    }));
    let binding = perChain[0] as { id: string; results: ConstraintResult[] };
    for (const c of perChain) {
      if ((c.results[R4_INDEX] as ConstraintResult).required >
          (binding.results[R4_INDEX] as ConstraintResult).required) binding = c;
    }
    const results = (perChain[0] as { results: ConstraintResult[] }).results.map((c, i) =>
      i === R4_INDEX ? (binding.results[R4_INDEX] as ConstraintResult) : c);
    out.push({
      holdMs,
      holdTicks,
      results,
      r4ByChain: perChain.map((c) => ({ id: c.id, result: c.results[R4_INDEX] as ConstraintResult })),
      bindingChainId: binding.id,
    });
  }
  return out;
}

// -------------------------------------------------------------------------------------------
// Profile variants: the L sweep, the three controls, and the 9-breakpoint lamp table. All of them
// are in-memory copies. `data/profiles/*.json` is opened read-only and never written.
// -------------------------------------------------------------------------------------------

type Doc = { values: Record<string, { v: unknown; tag: string; src: string }> } & Record<string, unknown>;

function readDoc(name: string): Doc {
  return JSON.parse(readFileSync(new URL('../data/profiles/' + name, import.meta.url), 'utf8')) as Doc;
}

function cloneDoc(d: Doc): Doc {
  return JSON.parse(JSON.stringify(d)) as Doc;
}

function withValue(d: Doc, key: string, value: unknown): Doc {
  const out = cloneDoc(d);
  const entry = out.values[key];
  if (entry === undefined) throw new Error('check-profile: no ' + key + ' in the profile document');
  entry.v = value;
  return out;
}

/** Architecture §3.4's pinned interpolation, over integer µA / µΩ pairs. */
function interpPwl(t: readonly PwlPoint[], x: number): number {
  const last = t.length - 1;
  if (x <= (t[0] as PwlPoint)[0]) return (t[0] as PwlPoint)[1];
  if (x >= (t[last] as PwlPoint)[0]) return (t[last] as PwlPoint)[1];
  let j = 0;
  while (x > (t[j] as PwlPoint)[0]) j++;
  const a = t[j - 1] as PwlPoint;
  const b = t[j] as PwlPoint;
  return a[1] + ((x - a[0]) / (b[0] - a[0])) * (b[1] - a[1]);
}

/** The 9-breakpoint table, re-sampled off the shipped one — see `PWL_LO_A` above for why. */
function shortPwl(p: Profile): [number, number][] {
  const out: [number, number][] = [];
  const geometric = PWL_SHORT_N - 1;
  for (let k = 0; k < PWL_SHORT_N; k++) {
    const xA = k === 0 ? 0 : PWL_LO_A * Math.pow(PWL_HI_A / PWL_LO_A, (k - 1) / (geometric - 1));
    const xUa = roundHalfEven(xA * 1e6);
    out.push([xUa, roundHalfEven(interpPwl(p.pwl, xUa))]);
  }
  return out;
}

interface SweepRow {
  lUh: number;
  r1Margin: number;
  r1Pass: boolean;
  cRatio: number | null;
  eRatio: number | null;
  releaseBand: boolean;
  at01Holds: boolean;
  at11Holds: boolean;
  at11DcAll: boolean;
  tCTicks: number | null;
  tETicks: number | null;
  ratio: number | null;
  warmRatio: number | null;
  windowMs: number | null;
  /**
   * `R6-observable`: the counter fails in a way a human could SEE — the DC route, or a
   * discriminating window that lands inside §9.3's 30-50 ms fast tap — with Experiment 9 still
   * holding. This is NOT `profile.ts`'s `evalR6` (`R6-hold`); see the note printed under the sweep.
   */
  r6ObservablePass: boolean;
  /** `R6-hold`: `profile.ts`'s own evaluator, at the 30 ms end of the bracket, on the same run. */
  r6HoldPass: boolean;
  feasible: boolean;
  /** Settles this row's battery ran, and how many hit `settle_cap_us` instead of going quiet. */
  settles: number;
  settlesCapped: number;
}

function sweepL(base: Doc): SweepRow[] {
  const rows: SweepRow[] = [];
  for (const lUh of L_SWEEP_UH) {
    const p = loadProfile(withValue(base, 'L_coil_uh', lUh));
    const b = runBattery(p);
    const vd = verdict(b, p.v.tick_us);
    const r1 = (evalConstraints(p, {
      buttonHoldTicks: null, buttonUpTicks: null, shortedHoldOffTicks: null,
      carryChain: null, ripplePeriodUs: null, r6: null,
    })[0] as ConstraintResult);
    const lastRow = b.at11.rows[b.at11.rows.length - 1] as At11Row;
    const band = b.release.cInBand && b.release.eInBand;
    // R6 reads: lamp-in-series must make the counter marginal, lamp bypassed must make it reliable.
    // Held to the observable window, because a window outside every plausible hold satisfies the
    // letter of "different" while leaving SDC's printed warning unexplained.
    const r6Pass = vd.counterFailsObservable && vd.at01Holds;
    // `profile.ts`'s evaluator, on the same run, at the short end of the bracket. It is a DIFFERENT
    // predicate and it is carried alongside rather than folded in, because the two disagree under a
    // short `lamp_thermal_tau_us` — the tau sweep shows exactly where.
    const r6Hold = (runConstraints(p, b, vd)[0] as ConstraintRun).results[5] as ConstraintResult;
    rows.push({
      lUh,
      r1Margin: r1.margin,
      r1Pass: r1.status === 'pass',
      cRatio: b.release.cRatio,
      eRatio: b.release.eRatio,
      releaseBand: band,
      at01Holds: vd.at01Holds,
      at11Holds: vd.at11Holds,
      at11DcAll: lastRow.dcAll,
      tCTicks: b.at02.tCTicks,
      tETicks: b.at02.tETicks,
      ratio: b.at02.ratio,
      warmRatio: b.at02.warmRatio,
      windowMs: vd.windowMs,
      r6ObservablePass: r6Pass,
      r6HoldPass: r6Hold.status === 'pass',
      feasible: r1.status === 'pass' && band && vd.at01Holds && vd.at11Holds && r6Pass,
      settles: b.settles.length,
      settlesCapped: b.settles.filter((x) => !x.quiet).length,
    });
  }
  return rows;
}

/**
 * The historical W1 `lamp_thermal_tau_us` sweep over O-E12's invented 40 ms row. The pre-D vector
 * produced a DC-route flip in this diagnostic; Wave D moves the indexed thresholds, so the table
 * reports the new result without preserving that old interpretation. It remains non-gating.
 */
interface TauRow {
  tauUs: number;
  /** Set when the loader rejected this tau — determinism rule 15's floor. Then nothing else is run. */
  rejected: string | null;
  tCTicks: number | null;
  tETicks: number | null;
  peakUa: number | null;
  dcRoute: boolean;
  at11Holds: boolean;
  at11FirstDcFail: number | null;
  r6ObservablePass: boolean;
  r6HoldPass: boolean;
  at01Holds: boolean;
  releaseBand: boolean;
  /** AT-01 + AT-02 (as R6-observable) + AT-11 together — the joint result the kill criterion names. */
  jointFeasible: boolean;
  /** The same with R1 and the 2-5x release band added: the sweep's own `feasible` rule. */
  fullFeasible: boolean;
  settles: number;
  settlesCapped: number;
}

/**
 * The one loader rejection this sweep expects: determinism rule 15's floor, hit when a short
 * `lamp_thermal_tau_us` drops the shortest device latency to where the tick stops being the
 * fixpoint. Any other throw is a regression in the instrument, not a sweep result.
 */
function isRule15Rejection(err: unknown): boolean {
  return err instanceof Error && err.message.indexOf('the tick is no longer the fixpoint') >= 0;
}

function sweepTau(base: Doc): TauRow[] {
  const rows: TauRow[] = [];
  for (const tauUs of TAU_SWEEP_US) {
    let p: Profile;
    try {
      p = loadProfile(withValue(base, 'lamp_thermal_tau_us', tauUs));
    } catch (err) {
      if (!isRule15Rejection(err)) throw err;
      rows.push({
        tauUs, rejected: err instanceof Error ? err.message : String(err),
        tCTicks: null, tETicks: null, peakUa: null, dcRoute: false, at11Holds: false,
        at11FirstDcFail: null, r6ObservablePass: false, r6HoldPass: false, at01Holds: false,
        releaseBand: false, jointFeasible: false, fullFeasible: false, settles: 0, settlesCapped: 0,
      });
      continue;
    }
    const b = runBattery(p);
    const vd = verdict(b, p.v.tick_us);
    const r1 = (evalConstraints(p, {
      buttonHoldTicks: null, buttonUpTicks: null, shortedHoldOffTicks: null,
      carryChain: null, ripplePeriodUs: null, r6: null,
    })[0] as ConstraintResult);
    const r6Hold = (runConstraints(p, b, vd)[0] as ConstraintRun).results[5] as ConstraintResult;
    const band = b.release.cInBand && b.release.eInBand;
    const r6Obs = vd.counterFailsObservable && vd.at01Holds;
    const lastRow = b.at11.rows[b.at11.rows.length - 1] as At11Row;
    rows.push({
      tauUs,
      rejected: null,
      tCTicks: b.at02.tCTicks,
      tETicks: b.at02.tETicks,
      peakUa: lastRow.peakUa[0] as number,
      dcRoute: vd.counterFailsDc,
      at11Holds: vd.at11Holds,
      at11FirstDcFail: b.at11.firstDcFailNOut,
      r6ObservablePass: r6Obs,
      r6HoldPass: r6Hold.status === 'pass',
      at01Holds: vd.at01Holds,
      releaseBand: band,
      jointFeasible: vd.at01Holds && vd.at11Holds && r6Obs,
      fullFeasible: r1.status === 'pass' && band && vd.at01Holds && vd.at11Holds && r6Obs,
      settles: b.settles.length,
      settlesCapped: b.settles.filter((x) => !x.quiet).length,
    });
  }
  return rows;
}

interface Control {
  id: string;
  why: string;
  battery: Battery;
  verdict: Verdict;
}

function runControls(base: Doc, idealDoc: Doc): Control[] {
  const shippedDv = (base.values['dV_relay_mv'] as { v: number[] }).v;
  const zeroed = shippedDv.map(() => 0);
  // Rotate right by one relay index: every offset moves to a different physical relay section and
  // the multiset is unchanged. This remains a normal-report sensitivity, not a Wave D rule input.
  const rotated = shippedDv.map((_x, i) => shippedDv[(i + shippedDv.length - 1) % shippedDv.length] as number);
  const idealL = (idealDoc.values['L_coil_uh'] as { v: number }).v;

  const defs: { id: string; why: string; doc: Doc }[] = [
    {
      id: 'control-1: dV_relay_mv all zero, L_coil shipped',
      why: 'architecture §4.3 control (i): zero the offset vector and record the resulting verdict.',
      doc: withValue(base, 'dV_relay_mv', zeroed),
    },
    {
      id: 'control-2: dV_relay_mv rotated by one relay index, L_coil shipped',
      why: 'architecture §4.3 control (ii). Same six numbers, different relays.',
      doc: withValue(base, 'dV_relay_mv', rotated),
    },
    {
      id: 'control-3: L_coil neutralised (MV601-IDEAL value), dV_relay_mv shipped',
      why:
        'Use MV601-IDEAL\'s L_coil value while retaining the shipped offset vector; record the ' +
        'result separately from the two §4.3 offset controls.',
      doc: withValue(base, 'L_coil_uh', idealL),
    },
  ];

  const out: Control[] = [];
  for (const def of defs) {
    const p = loadProfile(def.doc);
    const b = runBattery(p);
    out.push({ id: def.id, why: def.why, battery: b, verdict: verdict(b, p.v.tick_us) });
  }
  return out;
}

/**
 * A fourth control, outside architecture §4.3's two and outside the L one: `dV_relay_mv` all zero
 * **and** `lamp_thermal_tau_us` at the bottom of the sweep at once.
 *
 * This combines two independently varied values: zero offsets and the shortest accepted filament
 * constant. It records the resulting counter outcome without attributing it to either value.
 *
 * The tau used is the smallest value in `TAU_SWEEP_US` the loader accepts, so it is the sweep's own
 * floor and not a fourth invented number.
 */
function runCrossControl(base: Doc): Control | null {
  const shippedDv = (base.values['dV_relay_mv'] as { v: number[] }).v;
  const zeroed = shippedDv.map(() => 0);
  for (const tauUs of TAU_SWEEP_US) {
    const doc = withValue(withValue(base, 'dV_relay_mv', zeroed), 'lamp_thermal_tau_us', tauUs);
    let p: Profile;
    try {
      p = loadProfile(doc);
    } catch (err) {
      // Rejected by determinism rule 15's floor; the tau sweep prints the message. Anything else
      // is a loader regression and would otherwise be swallowed as `crossControl === null`.
      if (!isRule15Rejection(err)) throw err;
      continue;
    }
    const b = runBattery(p);
    return {
      id: 'control-4: dV_relay_mv all zero AND lamp_thermal_tau_us ' + tauUs + ' us (the sweep floor)',
      why:
        'closes the pair: control 1 removes the spread, the tau sweep supplies the only other route ' +
        'to a counter failure this model has. Both at once asks whether a short filament constant ' +
        'can produce one on its own.',
      battery: b,
      verdict: verdict(b, p.v.tick_us),
    };
  }
  return null;
}

// -------------------------------------------------------------------------------------------
// The 9-vs-33 comparison: every acceptance-test number and every relay decision, flattened to
// named integers, diffed key by key. Order is fixed by the array, not by object key iteration.
// -------------------------------------------------------------------------------------------

function flatten(b: Battery): [string, number][] {
  const out: [string, number][] = [];
  const push = (k: string, x: number | null | boolean): void => {
    out.push([k, typeof x === 'boolean' ? (x ? 1 : 0) : x === null ? -1 : x]);
  };
  push('AT-01.coil_ua', b.at01.coilUa);
  push('AT-01.peak_ua', b.at01.peakUa);
  push('AT-01.coil_mv', b.at01.coilMv);
  push('AT-01.rail_mv', b.at01.railMv);
  push('AT-01.lamp_ua', b.at01.lampUa);
  push('AT-01.supply_ua', b.at01.supplyUa);
  push('AT-01.decision_pullsIn', b.at01.pullsIn);
  push('AT-01.decision_holds', b.at01.holds);
  for (const r of b.at04) {
    push('AT-04.' + r.rOhm + 'ohm_ua', r.iUa);
    push('AT-04.' + r.rOhm + 'ohm_decision_inside', r.inside);
  }
  push('AT-05.cfed_supply_ua', b.at05.cFedSupplyUa);
  push('AT-05.cfed_peak_ua', b.at05.cFedPeakUa);
  push('AT-05.efed_supply_ua', b.at05.eFedSupplyUa);
  push('AT-05.efed_peak_ua', b.at05.eFedPeakUa);
  push('AT-05.efed_ticks_over_trip', b.at05.eFedTicksOverTrip);
  push('AT-05.decision_cfed_trips', b.at05.cFedTrips);
  push('AT-05.decision_efed_trips', b.at05.eFedTrips);
  push('AT-05.decision_efed_peak_trips', b.at05.eFedPeakTrips);
  push('AT-06.supply_ua', b.at06.supplyUa);
  push('AT-06.decision_trips', b.at06.trips);
  push('AT-07.e_coil_ua', b.at07.eCoilUa);
  push('AT-07.e_lamp_ua', b.at07.eLampUa);
  push('AT-07.c_coil_ua', b.at07.cCoilUa);
  push('AT-07.c_lamp_ua', b.at07.cLampUa);
  push('AT-10.stop_short_ua', b.at10.stopShortUa);
  push('AT-10.decision_trips', b.at10.trips);
  for (const row of b.at11.rows) {
    for (let i = 0; i < row.peakUa.length; i++) {
      push('AT-11.n' + row.nOut + '.relay' + (i + 1) + '_peak_ua', row.peakUa[i] as number);
      push('AT-11.n' + row.nOut + '.relay' + (i + 1) + '_settled_ua', row.settledUa[i] as number);
      push('AT-11.n' + row.nOut + '.relay' + (i + 1) + '_decision_pullin', (row.pullInMarginUa[i] as number) >= 0);
      push('AT-11.n' + row.nOut + '.relay' + (i + 1) + '_decision_dc', (row.dcMarginUa[i] as number) >= 0);
      push('AT-11.n' + row.nOut + '.relay' + (i + 1) + '_decision_hold', (row.holdMarginUa[i] as number) > 0);
    }
    push('AT-11.n' + row.nOut + '.supply_ua', row.supplyUa);
    push('AT-11.n' + row.nOut + '.rail_mv', row.railMv);
  }
  push('AT-11.first_dc_fail_n_out', b.at11.firstDcFailNOut);
  push('AT-11.first_pullin_fail_n_out', b.at11.firstPullInFailNOut);
  push('AT-02.t_C_ticks', b.at02.tCTicks);
  push('AT-02.t_E_ticks', b.at02.tETicks);
  push('AT-02.t_C_nominal_ticks', b.at02.tCNominalTicks);
  push('AT-02.t_E_nominal_ticks', b.at02.tENominalTicks);
  push('AT-02.warm_t_C_ticks', b.at02.warmTCTicks);
  push('AT-02.warm_t_E_ticks', b.at02.warmTETicks);
  push('AT-02.light_rail_mv', b.at02.lightRailMv);
  push('AT-02.light_coil_mv', b.at02.lightCoilMv);
  push('AT-02.loaded_rail_mv', b.at02.loadedRailMv);
  push('AT-02.loaded_coil_mv', b.at02.loadedCoilMv);
  push('AT-02.device_C_ticks', b.at02.deviceCTicks);
  push('AT-02.device_E_ticks', b.at02.deviceETicks);
  push('AT-02.shorted_release_C_ticks', b.at02.shortedReleaseCTicks);
  push('AT-02.shorted_release_E_ticks', b.at02.shortedReleaseETicks);
  push('AT-02.chain_worst_C_ticks', b.at02.chainWorstCTicks);
  push('AT-02.chain_worst_E_ticks', b.at02.chainWorstETicks);
  push('AT-02.mech_only_worst_C_ticks', b.at02.mechOnlyWorstCTicks);
  push('AT-02.mech_only_worst_E_ticks', b.at02.mechOnlyWorstETicks);
  push('release.c_start_ua', b.release.cStartUa);
  push('release.e_start_ua', b.release.eStartUa);
  push('release.c_shorted_holdoff_ticks', b.release.cShortedHoldOff);
  push('release.c_open_holdoff_ticks', b.release.cOpenHoldOff);
  push('release.e_shorted_holdoff_ticks', b.release.eShortedHoldOff);
  push('release.e_open_holdoff_ticks', b.release.eOpenHoldOff);
  push('release.decision_c_in_band', b.release.cInBand);
  push('release.decision_e_in_band', b.release.eInBand);
  return out;
}

interface PwlDiff {
  differing: { key: string; at33: number; at9: number }[];
  compared: number;
  /** The two tables' resistance at the E-fed operating point, µΩ — `gen-lamp-pwl.ts`'s own probe. */
  at33Ohm: number;
  at9Ohm: number;
  probeUa: number;
}

function comparePwl(base: Doc, b33: Battery): { diff: PwlDiff; b9: Battery } {
  const p33 = loadProfile(base);
  const table9 = shortPwl(p33);
  const p9 = loadProfile(withValue(base, 'lamp_pwl_uohm', table9));
  const b9 = runBattery(p9);
  const f33 = flatten(b33);
  const f9 = flatten(b9);
  const differing: { key: string; at33: number; at9: number }[] = [];
  // `flatten` emits a fixed shape, so the two runs line up by index — but a diff that silently
  // compared mismatched keys (or read past the end of the shorter list) would be worse than a
  // loud failure, so the alignment is asserted rather than assumed.
  if (f33.length !== f9.length) {
    throw new Error('PWL comparison: flattened shapes differ, ' + f33.length + ' vs ' + f9.length);
  }
  for (let i = 0; i < f33.length; i++) {
    const a = f33[i] as [string, number];
    const c = f9[i] as [string, number];
    if (a[0] !== c[0]) throw new Error('PWL comparison: key mismatch at ' + i + ', ' + a[0] + ' vs ' + c[0]);
    if (a[1] !== c[1]) differing.push({ key: a[0], at33: a[1], at9: c[1] });
  }
  const probeUa = b33.at07.eCoilUa;
  return {
    diff: {
      differing,
      compared: f33.length,
      at33Ohm: interpPwl(p33.pwl, probeUa),
      at9Ohm: interpPwl(table9, probeUa),
      probeUa,
    },
    b9,
  };
}

// -------------------------------------------------------------------------------------------
// The report.
// -------------------------------------------------------------------------------------------

export interface Report {
  profile: Profile;
  battery: Battery;
  verdict: Verdict;
  constraints: ConstraintRun[];
  sweep: SweepRow[];
  feasibleUh: number[];
  shippedFeasible: boolean;
  /** The historical, non-gating `lamp_thermal_tau_us` diagnostic after the current profile load. */
  tauSweep: TauRow[];
  controls: Control[];
  /** `dV_relay_mv` zeroed AND tau at the sweep floor, together. `null` only if no tau loads. */
  crossControl: Control | null;
  pwl: PwlDiff;
  pwl9Battery: Battery;
}

export function runAll(): Report {
  const base = readDoc('MV601-REF-A.json');
  const ideal = readDoc('MV601-IDEAL.json');
  const p = loadProfile(base);
  const battery = runBattery(p);
  const vd = verdict(battery, p.v.tick_us);
  const sweep = sweepL(base);
  const feasibleUh = sweep.filter((r) => r.feasible).map((r) => r.lUh);
  const { diff, b9 } = comparePwl(base, battery);
  return {
    profile: p,
    battery,
    verdict: vd,
    constraints: runConstraints(p, battery, vd),
    sweep,
    feasibleUh,
    shippedFeasible: feasibleUh.indexOf(p.v.L_coil_uh) >= 0,
    tauSweep: sweepTau(base),
    controls: runControls(base, ideal),
    crossControl: runCrossControl(base),
    pwl: diff,
    pwl9Battery: b9,
  };
}

function f(x: number, n: number): string {
  return x.toFixed(n);
}
function orDash(x: number | null, n: number): string {
  return x === null ? 'never' : x.toFixed(n);
}
function ms(ticks: number | null, tickUs: number): string {
  return ticks === null ? 'never' : ((ticks * tickUs) / 1000).toFixed(1) + ' ms';
}
function yn(b: boolean): string {
  return b ? 'YES' : 'NO';
}
/** The 1-based relay numbers whose DC margin is negative in one AT-11 row. */
function dcFailingRelays(row: At11Row): number[] {
  const out: number[] = [];
  for (let i = 0; i < row.dcMarginUa.length; i++) if ((row.dcMarginUa[i] as number) < 0) out.push(i + 1);
  return out;
}
/** AT-11's DC reading for one battery, as one line: where it first fails and which relays go under. */
function at11DcLine(b: Battery): string {
  const first = b.at11.firstDcFailNOut;
  const last = b.at11.rows[b.at11.rows.length - 1] as At11Row;
  if (first === null) return 'no count in range 0..' + OUTPUT_LAMPS_MAX + ' — the DC reading never fails';
  const atFirst = b.at11.rows[first] as At11Row;
  return 'first fails at ' + first + ' output lamps, relays [' + dcFailingRelays(atFirst).join(', ') +
    ']; by ' + last.nOut + ' lamps the failing set is [' + dcFailingRelays(last).join(', ') + ']';
}

export function formatReport(r: Report): string {
  const p = r.profile;
  const d = p.derived;
  const tickUs = p.v.tick_us;
  const b = r.battery;
  const L: string[] = [];
  const w = (s: string): void => { L.push(s); };

  w('MINIVAC 601 — check-profile (architecture §10.1 load-time gate; Wave 1b measurement run)');
  w('='.repeat(100));
  w('profile              ' + p.id + (p.marginal ? '  (marginal ON)' : '  (marginal OFF)'));
  w('L_coil_uh            ' + p.v.L_coil_uh + ' uH   (' + f(p.v.L_coil_uh / 1e6, 3) + ' H)');
  w('dV_relay_mv          [' + p.dVRelayMv.join(', ') + '] mV');
  w('lamp_pwl_uohm        ' + p.pwl.length + ' breakpoints');
  w('derived              pullInUa=' + d.pullInUa + ' uA, dropOutUa=' + d.dropOutUa + ' uA');
  w('  relayPullInUa      [' + d.relayPullInUa.join(', ') + '] uA');
  w('  relayDropOutUa     [' + d.relayDropOutUa.join(', ') + '] uA');
  w('  strokes            operate=' + d.relayOperateTicks + ' ticks, release=' + d.relayReleaseTicks +
    ' ticks, tick=' + tickUs + ' us');
  w('  arcStepUa          ' + d.arcStepUa + ' uA/tick (the §4.4 SHORTHAND; the measured open ramp is below)');
  w('  nonPortable        ' + yn(b.nonPortable));
  w('');
  w('Factual figures quoted from the documents, for comparison only — no computation below reads them:');
  for (const [src, text] of CITED_FACTS) w('  ' + src.padEnd(40) + text);
  w('');

  // ---- acceptance tests
  w('-'.repeat(100));
  w('ACCEPTANCE TESTS (architecture §9.4)');
  w('-'.repeat(100));
  w('AT-01  Book I Experiment 9 latch, C-fed on the press (1X/1C) AND on the self-hold (1K/1C)');
  w('  settled coil          ' + b.at01.coilUa + ' uA   ' + b.at01.coilMv + ' mV');
  w('  cold-filament peak    ' + b.at01.peakUa + ' uA');
  w('  rail                  ' + b.at01.railMv + ' mV;  lamp ' + b.at01.lampUa + ' uA;  supply ' + b.at01.supplyUa + ' uA');
  w('  relay 1 threshold     ' + b.at01.thrUa + ' uA (dV ' + (p.dVRelayMv[0] as number) + ' mV applied), drop-out ' + b.at01.dropUa + ' uA');
  w('  margin (settled)      ' + b.at01.marginUa + ' uA  (' + f((b.at01.marginUa / b.at01.thrUa) * 100, 2) + '%)');
  w('  pulls in ' + yn(b.at01.pullsIn) + ' / holds ' + yn(b.at01.holds) +
    '   settled after ' + b.at01.ticks + ' ticks, quiet=' + yn(b.at01.quiet));
  w('');
  w('AT-04  E12 series resistor into the bare coil at V_oc; band = (dropOut ' + d.dropOutUa +
    ', pullIn ' + d.pullInUa + ') uA, nominal');
  for (const row of b.at04) {
    const where = row.abovePullIn ? 'ABOVE pull-in (pulls in at power-on)' : row.inside ? 'strictly inside the band' : 'below drop-out';
    w('  ' + String(row.rOhm).padStart(4) + ' ohm -> ' + String(row.iUa).padStart(6) + ' uA   ' + where);
  }
  w('  per-relay spread moves the ceiling to [' + Math.min(...d.relayPullInUa) + ', ' + Math.max(...d.relayPullInUa) + '] uA');
  w('');
  w('AT-05  six coils + thirteen lamps (six indicator, six output, one POWER), vs I_trip_ua ' + b.at05.tripUa + ' uA');
  w('  all six C-fed (the realistic case)  settled ' + b.at05.cFedSupplyUa + ' uA   trips ' + yn(b.at05.cFedTrips));
  w('  all six E-fed, all thirteen lit     settled ' + b.at05.eFedSupplyUa + ' uA   trips ' + yn(b.at05.eFedTrips));
  w('  E-fed cold-filament inrush peak     ' + b.at05.eFedPeakUa + ' uA   over trip for ' + b.at05.eFedTicksOverTrip +
    ' ticks (trip_delay = ' + b.at05.tripDelayTicks + ' ticks)');
  w('');
  w('AT-06  a dead +/- cord: both source terminals on the datum, N=0, the zero-unknown system of §3.3');
  w('  supply ' + b.at06.supplyUa + ' uA = ' + f(b.at06.supplyUa / 1e6, 4) + ' A   trips ' + yn(b.at06.trips) +
    ' (' + f(b.at06.overTrip, 1) + 'x I_trip)');
  w('');
  w('AT-07  the same relay driven at E (1X/1E, as printed) and at C (1X/1C, modified)');
  w('  E-fed  coil ' + b.at07.eCoilUa + ' uA, lamp ' + b.at07.eLampUa + ' uA (' + b.at07.eLampMilli +
    ' milli of I_hot) -> DARK');
  w('  C-fed  coil ' + b.at07.cCoilUa + ' uA, lamp ' + b.at07.cLampUa + ' uA (' + b.at07.cLampMilli +
    ' milli of I_hot) -> lit, classified ' +
    (b.at07.cLampMilli >= b.at07.onMilli ? 'ON' : b.at07.cLampMilli >= b.at07.dimMilli ? 'DIM' : 'OFF') +
    ' by lamp_on_milli=' + b.at07.onMilli + '/lamp_dim_milli=' + b.at07.dimMilli);
  w('');
  w('AT-09 / AT-10  structural. What is MEASURED and what is a DOCUMENTED CLAIM, kept apart:');
  w('  MEASURED   AT-10, short across STOP: R1 stays in series (' + f(p.v.R1_uohm / 1e6, 1) + ' ohm), supply ' +
    b.at10.stopShortUa + ' uA, trips ' + yn(b.at10.trips) + ' — harmless, which is what R1_uohm is for');
  w('  MEASURED   AT-10, short across + and -: ' + b.at10.shortPlusMinusUa + ' uA, trips ' + yn(b.at10.shortTrips));
  w('  CLAIM      AT-09, the breaker latches open and the POWER lamp stays dark until the button is');
  w('             pushed back in. `components.md` §7.2/§7.3 [verified]; it is a device latch, not an');
  w('             electrical quantity. W1 has no devices, so NO MEASUREMENT IS OFFERED FOR IT.');
  w('  CLAIM      AT-09, the breaker is in the DC return so every rail dies together. §8.1 [verified];');
  w('             W1 has no breaker element, so again: not measured here.');
  w('');
  w('AT-11  Book I Experiment 8 step 5 — all six coils through their own indicator lamps at once,');
  w('       plus the POWER light, sweeping the lit output lamps. dV spread applied.');
  w('       All six branches are identical in parallel, so all six carry the same current; the');
  w('       relays differ only in threshold, so the margins below are where the spread shows up.');
  w('  n_out  supply_uA  rail_mV  coil_peak_uA  coil_settled_uA   per-relay DC margin, uA (settled - own pull-in)   pull-in  DC   hold');
  for (const row of b.at11.rows) {
    w('  ' + String(row.nOut).padStart(5) + '  ' + String(row.supplyUa).padStart(9) + '  ' +
      String(row.railMv).padStart(7) + '  ' + String(row.peakUa[0] as number).padStart(12) + '  ' +
      String(row.settledUa[0] as number).padStart(15) + '   ' +
      row.dcMarginUa.map((x) => String(x).padStart(6)).join(' ').padEnd(48) + ' ' +
      yn(row.pullInAll).padEnd(8) + yn(row.dcAll).padEnd(5) + yn(row.holdAll));
  }
  w('  per-relay margins at n_out=0, uA:');
  {
    const r0 = b.at11.rows[0] as At11Row;
    w('    pull-in (peak)   [' + r0.pullInMarginUa.join(', ') + ']');
    w('    DC     (settled) [' + r0.dcMarginUa.join(', ') + ']');
    w('    hold             [' + r0.holdMarginUa.join(', ') + ']');
  }
  {
    const rn = b.at11.rows[b.at11.rows.length - 1] as At11Row;
    w('  per-relay margins at n_out=' + rn.nOut + ', uA:');
    w('    pull-in (peak)   [' + rn.pullInMarginUa.join(', ') + ']');
    w('    DC     (settled) [' + rn.dcMarginUa.join(', ') + ']');
    w('    hold             [' + rn.holdMarginUa.join(', ') + ']');
  }
  w('  FIRST FAILURE, by the DC reading (settled current vs pull-in): ' + at11DcLine(b));
  w('  FIRST FAILURE, by the model\'s own reading (§4.3 hysteresis on the peak, then hold): ' +
    (b.at11.firstPullInFailNOut === null ? 'none in 0..' + OUTPUT_LAMPS_MAX : b.at11.firstPullInFailNOut + ' output lamps'));
  w('  The two readings use different quantities: the DC reading uses settled current; the model');
  w('  latches on peak current and holds above drop-out. The measured peak and settled margins are');
  w('  printed above.');
  w('');

  // ---- AT-02
  w('-'.repeat(100));
  w('AT-02, LOADED — the heart of it');
  w('-'.repeat(100));
  w('Stand-in: one measured stage + five other C-fed stages + the POWER light + ' + b.at02.nOut +
    ' output lamps + R_src.');
  w('The measured stage is dark and cold before the feed closes, which is the state a counter stage');
  w('is actually in when the carry reaches it.');
  w('');
  w('  t_E  (E-fed rise to relay 1 threshold ' + b.at02.thrUa + ' uA, under load)   ' +
    orDash(b.at02.tETicks, 0) + ' ticks = ' + ms(b.at02.tETicks, tickUs));
  w('  t_C  (C-fed, same relay, same load)                          ' +
    orDash(b.at02.tCTicks, 0) + ' ticks = ' + ms(b.at02.tCTicks, tickUs));
  w('  ratio t_C / t_E                                              ' + orDash(b.at02.ratio, 3) +
    '   (measured by this run)');
  w('  the same against the NOMINAL threshold ' + d.pullInUa + ' uA:  t_E ' + orDash(b.at02.tENominalTicks, 0) +
    ' ticks, t_C ' + orDash(b.at02.tCNominalTicks, 0) + ' ticks');
  w('');
  w('  COUNTERFACTUAL, filament frozen at its warm operating value (kThermal = 0):');
  w('    t_E ' + orDash(b.at02.warmTETicks, 0) + ' ticks, t_C ' + orDash(b.at02.warmTCTicks, 0) +
    ' ticks, ratio ' + orDash(b.at02.warmRatio, 3));
  w('    This is the fixed-warm-filament counterfactual. Its ratio is printed separately from the');
  w('    model run above.');
  w('');
  w('  RAIL SAG achieved by the loaded stand-in:');
  w('    rail   light load ' + b.at02.lightRailMv + ' mV -> fully loaded ' + b.at02.loadedRailMv +
    ' mV   sag ' + f(b.at02.railSagPct, 3) + '%');
  w('    coil   light load ' + b.at02.lightCoilMv + ' mV -> fully loaded ' + b.at02.loadedCoilMv +
    ' mV   sag ' + f(b.at02.coilSagPct, 3) + '%');
  w('    sag NEEDED to put a nominal coil (V_pullin_mv ' + p.v.V_pullin_mv + ') under threshold: ' +
    f(b.at02.neededSagPct, 3) + '%');
  w('    architecture §4.1 quotes 4.38% available against 6.11% needed. Measured here: ' +
    f(b.at02.coilSagPct, 3) + '% against ' + f(b.at02.neededSagPct, 3) + '%.');
  w('    ' + (b.at02.coilSagPct >= b.at02.neededSagPct
    ? 'The sag DOES reach what the DC story needs.'
    : 'The sag does NOT reach what the DC story needs — rail sag alone cannot produce non-operation.'));
  w('');
  w('  RELEASE PATHS (§4.2), measured on the solver, not on the V_arc/L shorthand (DECISIONS.md, Wave 1a spec readings):');
  w('    C-fed coil starts at ' + b.release.cStartUa + ' uA;  shorted hold-off ' +
    orDash(b.release.cShortedHoldOff, 0) + ' ticks, open hold-off ' + orDash(b.release.cOpenHoldOff, 0) + ' ticks');
  w('    E-fed coil starts at ' + b.release.eStartUa + ' uA;  shorted hold-off ' +
    orDash(b.release.eShortedHoldOff, 0) + ' ticks, open hold-off ' + orDash(b.release.eOpenHoldOff, 0) + ' ticks');
  w('    both starting currents come from a settle that CONVERGED: C-fed quiet ' +
    yn(b.release.cStartQuiet) + ' after ' + b.release.cStartTicks + ' ticks, E-fed quiet ' +
    yn(b.release.eStartQuiet) + ' after ' + b.release.eStartTicks + ' ticks');
  w('    E-fed DC margin over relay 1 threshold (' + b.at02.thrUa + ' uA): ' + r.verdict.eFedDcMarginUa +
    ' uA — the second, previously untested half of R6\'s "bypassed must be RELIABLE"');
  w('    total observed ratio (hold-off + ' + d.relayReleaseTicks + '-tick stroke), C-fed start: ' +
    orDash(b.release.cRatio, 3) + '   in [' + RELEASE_RATIO_LO + ', ' + RELEASE_RATIO_HI + ']? ' + yn(b.release.cInBand));
  w('    total observed ratio, E-fed start:                       ' +
    orDash(b.release.eRatio, 3) + '   in [' + RELEASE_RATIO_LO + ', ' + RELEASE_RATIO_HI + ']? ' + yn(b.release.eInBand));
  w('');
  w('  PER-STAGE DEVICE TIME = electrical rise + the mechanical relay_operate_stroke_us:');
  w('    C-fed ' + orDash(b.at02.deviceCTicks, 0) + ' ticks = ' + ms(b.at02.deviceCTicks, tickUs) +
    ';   E-fed ' + orDash(b.at02.deviceETicks, 0) + ' ticks = ' + ms(b.at02.deviceETicks, tickUs));
  w('    shorted release device time: C-fed ' + orDash(b.at02.shortedReleaseCTicks, 0) + ' ticks = ' +
    ms(b.at02.shortedReleaseCTicks, tickUs) + ';   E-fed ' + orDash(b.at02.shortedReleaseETicks, 0) +
    ' ticks = ' + ms(b.at02.shortedReleaseETicks, tickUs));
  w('');
  w('  WORST CARRY CHAIN (components.md §9.3, the 3->4 and 7->0 steps of 1,2,1,3,1,2,1,3). TWO chains,');
  w('  not one: §9.3/R4 charges the terminating stage an operate ONLY "when it goes 0->1", which is');
  w('  true of 3->4 (011->100) and false of 7->0 (111->000, where all three stages go 1->0). The');
  w('  chart both are read off is SDC\'s BINARY COUNTER - SEQUENCE OF OPERATIONS, BK4 printed p.71.');
  w('    read literally as 3 x the operate device time (kept only for comparison):');
  w('      C-fed ' + ms(b.at02.chainLiteralCTicks, tickUs) + ',  E-fed ' + ms(b.at02.chainLiteralETicks, tickUs));
  for (let i = 0; i < CARRY_CHAINS.length; i++) {
    const ch = CARRY_CHAINS[i] as { id: string; shortedReleases: number; operates: number; why: string };
    w('    chain ' + ch.id + '  (' + ch.shortedReleases + ' shorted release' +
      (ch.shortedReleases === 1 ? '' : 's') + ' + ' + ch.operates + ' operate' +
      (ch.operates === 1 ? '' : 's') + '):  C-fed ' +
      ms(b.at02.chainCTicks[i] ?? null, tickUs) + ' (' + orDash(b.at02.chainCTicks[i] ?? null, 0) +
      ' ticks),  E-fed ' + ms(b.at02.chainETicks[i] ?? null, tickUs) + ' (' +
      orDash(b.at02.chainETicks[i] ?? null, 0) + ' ticks)');
    w('      ' + ch.why);
  }
  w('    WORST PER DRIVE (the longer of the two, evaluated):  C-fed ' +
    ms(b.at02.chainWorstCTicks, tickUs) + ' via ' + (b.at02.chainWorstCId ?? 'n/a') + ',  E-fed ' +
    ms(b.at02.chainWorstETicks, tickUs) + ' via ' + (b.at02.chainWorstEId ?? 'n/a'));
  w('');
  w('  R6 DISCRIMINATOR, as an interval: is there a hold H where E-fed completes and C-fed does not?');
  w('    composed, worst chain per drive: [t_E_chain, t_C_chain] = [' + orDash(r.verdict.windowLoMs, 1) +
    ', ' + orDash(r.verdict.windowHiMs, 1) + '] ms   non-empty? ' + yn(r.verdict.counterFailsTiming) +
    '   width ' + orDash(r.verdict.windowMs, 1) + ' ms');
  w('    literal:  [' + orDash(r.verdict.literalLoMs, 1) + ', ' + orDash(r.verdict.literalHiMs, 1) + '] ms');
  w('    the same window under each chain in isolation:');
  for (let i = 0; i < CARRY_CHAINS.length; i++) {
    const cT = b.at02.chainCTicks[i] ?? null;
    const eT = b.at02.chainETicks[i] ?? null;
    const wMs = cT === null || eT === null ? null : ((cT - eT) * tickUs) / 1000;
    w('      ' + (CARRY_CHAINS[i] as { id: string }).id + ':  [' + ms(eT, tickUs) + ', ' + ms(cT, tickUs) +
      ']  width ' + orDash(wMs, 1) + ' ms');
  }
  w('    REALITY CHECK against components.md §9.3\'s ~' + FAST_TAP_MS[0] + '-' + FAST_TAP_MS[1] +
    ' ms fast tap: overlaps? ' + yn(r.verdict.overlapsFastTap));
  {
    // The release-model-INVARIANT reading, promoted out of the footnote it used to be. The sign of
    // the window depends on one modelling decision; the absence of a discriminator does not.
    const all: number[] = [];
    for (const x of [...b.at02.chainCTicks, ...b.at02.chainETicks]) if (x !== null) all.push(x);
    const lo = all.length === 0 ? null : Math.min(...all);
    const hi = all.length === 0 ? null : Math.max(...all);
    w('      Every composed chain runs ' + ms(lo, tickUs) + ' .. ' + ms(hi, tickUs) + ' against §9.3\'s ' +
      FAST_TAP_MS[0] + '-' + FAST_TAP_MS[1] + ' ms fast tap.');
    w('      A tap inside that bracket fails BOTH chains, and a press long enough for one is long');
    w('      enough for the other, so the errata\'s lamp bypass buys nothing observable. That is a');
    w('      finding, not a pass.');
    w('');
    w('      RELEASE-MODEL-INVARIANT COUNTERFACTUAL. The SIGN of the window is set by one modelling');
    w('      decision — §4.2\'s electrical hold-off, the ticks a shorted coil freewheels before the');
    w('      armature moves. Struck out, so each release is the ' + d.relayReleaseTicks +
      '-tick mechanical stroke alone:');
    for (let i = 0; i < CARRY_CHAINS.length; i++) {
      w('        ' + (CARRY_CHAINS[i] as { id: string }).id + ':  C-fed ' +
        orDash(b.at02.mechOnlyCTicks[i] ?? null, 0) + ' ticks, E-fed ' +
        orDash(b.at02.mechOnlyETicks[i] ?? null, 0) + ' ticks');
    }
    w('        worst per drive: C-fed ' + orDash(b.at02.mechOnlyWorstCTicks, 0) + ' ticks = ' +
      ms(b.at02.mechOnlyWorstCTicks, tickUs) + ', E-fed ' + orDash(b.at02.mechOnlyWorstETicks, 0) +
      ' ticks = ' + ms(b.at02.mechOnlyWorstETicks, tickUs) + ', window ' +
      orDash(r.verdict.mechOnlyWindowMs, 1) + ' ms');
    if (r.verdict.mechOnlyWindowMs !== null) {
      const ticksWide = Math.round((r.verdict.mechOnlyWindowMs * 1000) / tickUs);
      w('        i.e. ' + ticksWide + ' ticks at a ' + tickUs + ' us tick, ' +
        f((Math.abs(r.verdict.mechOnlyWindowMs) / FAST_TAP_MS[1]) * 100, 1) + '-' +
        f((Math.abs(r.verdict.mechOnlyWindowMs) / FAST_TAP_MS[0]) * 100, 1) + '% of the fast-tap bracket —');
      w('        the same order as the quantization this file calls noise elsewhere (the one-tick');
      w('        control-3 window, the low-L end of the ratio spread). Delete the hold-off and the');
      w('        window changes SIGN; it does not become observable.');
    }
    w('        INVARIANT CONCLUSION: no observable discriminator at ANY composition — 3->4, 7->0,');
    w('        worst-per-drive, the literal 3x-operate reading, or the hold-off-free counterfactual.');
  }
  w('');
  w('  JOINT VERDICT: AT-01 holds ' + yn(r.verdict.at01Holds) + ' / AT-11 holds ' + yn(r.verdict.at11Holds) +
    ' / counter fails ' + yn(r.verdict.counterFails) +
    ' (DC route ' + yn(r.verdict.counterFailsDc) + ', timing route ' + yn(r.verdict.counterFailsTiming) + ')');
  w('');

  // ---- R1-R6
  w('-'.repeat(100));
  w('R1-R6 (components.md §9.3), on the post-quantization tick counts, via profile.ts');
  w('-'.repeat(100));
  w('R6 here is R6-HOLD — profile.ts\'s `evalR6`. It is NOT the sweep\'s R6-OBSERVABLE; the two are');
  w('different tests and the note under the L sweep says how they differ.');
  w('R4 is evaluated once per §9.3 carry chain and the BINDING (largest required) one is reported.');
  for (const run of r.constraints) {
    w('button hold = ' + run.holdMs + ' ms = ' + run.holdTicks + ' ticks (the §9.3 fast-tap bracket; a hold is a script property)');
    for (const c of run.results) {
      const label = c.id === 'R6' ? 'R6-hold' : c.id;
      w('  ' + label.padEnd(7) + ' ' + c.status.toUpperCase().padEnd(12) + 'actual ' + String(c.actual).padStart(6) +
        '  required ' + String(c.required).padStart(6) + '  margin ' + String(c.margin).padStart(6) + ' ' + c.unit);
      w('        ' + c.why);
    }
    w('  R4 by chain (binding = ' + run.bindingChainId + '):');
    for (const q of run.r4ByChain) {
      w('    ' + q.id.padEnd(6) + ' ' + q.result.status.toUpperCase().padEnd(6) + ' required ' +
        String(q.result.required).padStart(6) + ' ticks = ' + ms(q.result.required, tickUs) +
        ', margin ' + String(q.result.margin).padStart(6) + ' ticks' +
        (q.id === run.bindingChainId ? '   <- binding' : ''));
    }
    w('');
  }

  // ---- L sweep
  w('-'.repeat(100));
  w('L_coil SWEEP — historical W1 diagnostic; finding (b) means it does not select the shipped value');
  w('-'.repeat(100));
  w('  "window" is t_C_chain - t_E_chain in ms: positive means a hold exists that the E-fed chain');
  w('  clears and the C-fed one does not; negative means the E-fed chain is the SLOWER of the two.');
  w('  "R6-obs" is R6-OBSERVABLE (this file\'s predicate); "R6-hold" is profile.ts\'s evalR6 on the');
  w('  same run at the 30 ms hold. They are different tests — see the note below the table.');
  w('  L (H)   R1     release C   release E   band  AT-01  AT-11  AT-11(DC)  t_C   t_E   ratio  warm   window(ms)  R6-obs R6-hold FEASIBLE');
  for (const row of r.sweep) {
    w('  ' + f(row.lUh / 1e6, 3).padStart(6) + '  ' +
      (row.r1Pass ? 'pass' : 'FAIL').padEnd(6) +
      orDash(row.cRatio, 3).padStart(9) + '   ' +
      orDash(row.eRatio, 3).padStart(9) + '   ' +
      yn(row.releaseBand).padEnd(5) + ' ' +
      yn(row.at01Holds).padEnd(6) + ' ' +
      yn(row.at11Holds).padEnd(6) + ' ' +
      yn(row.at11DcAll).padEnd(10) + ' ' +
      orDash(row.tCTicks, 0).padStart(5) + ' ' +
      orDash(row.tETicks, 0).padStart(5) + ' ' +
      orDash(row.ratio, 3).padStart(6) + ' ' +
      orDash(row.warmRatio, 3).padStart(6) + ' ' +
      orDash(row.windowMs, 1).padStart(11) + '  ' +
      yn(row.r6ObservablePass).padEnd(7) +
      yn(row.r6HoldPass).padEnd(8) +
      (row.feasible ? 'YES' : 'no'));
  }
  w('');
  w('  FEASIBLE REGION: ' + (r.feasibleUh.length === 0 ? 'EMPTY over 0.3-5.0 H' :
    r.feasibleUh.map((x) => f(x / 1e6, 3) + ' H').join(', ')));
  w('  shipped L_coil ' + f(p.v.L_coil_uh / 1e6, 3) + ' H inside the feasible region? ' + yn(r.shippedFeasible));
  {
    const binding: string[] = [];
    if (r.sweep.some((x) => !x.releaseBand)) binding.push('the 2-5x release band');
    if (r.sweep.some((x) => !x.r6ObservablePass)) binding.push('R6-observable');
    if (r.sweep.some((x) => !x.at11Holds)) binding.push('AT-11');
    if (r.sweep.some((x) => !x.at01Holds)) binding.push('AT-01');
    if (r.sweep.some((x) => !x.r1Pass)) binding.push('R1');
    w('  constraints that move at all over the sweep: ' + (binding.length === 0 ? 'none' : binding.join(', ')));
    w('  constraints that are L-INDEPENDENT over the sweep, and therefore cannot pin L_coil: ' +
      ['R1', 'AT-01', 'AT-11'].filter((id) =>
        (id === 'R1' && r.sweep.every((x) => x.r1Pass === (r.sweep[0] as SweepRow).r1Pass)) ||
        (id === 'AT-01' && r.sweep.every((x) => x.at01Holds === (r.sweep[0] as SweepRow).at01Holds)) ||
        (id === 'AT-11' && r.sweep.every((x) => x.at11Holds === (r.sweep[0] as SweepRow).at11Holds)),
      ).join(', '));
  }
  w('');
  w('  TWO DIFFERENT R6 PREDICATES, REPORTED SEPARATELY. They are not two views of one test:');
  w('    R6-observable (this file, the column above and the FEASIBLE rule):');
  w('      counterFailsObservable && AT-01 holds, where counterFailsObservable is the two-sided DC');
  w('      route (C-fed never reaches threshold AND E-fed does) OR a discriminating window that');
  w('      overlaps the ' + FAST_TAP_MS[0] + '-' + FAST_TAP_MS[1] + ' ms fast tap.');
  w('    R6-hold (profile.ts evalR6, the R1-R6 block above):');
  w('      miscountsWithLamp && countsWithoutLamp, evaluated at ONE stated hold H — miscounts means');
  w('      t_C_chain > H, counts means t_E_chain <= H. No fast-tap bracket, no AT-01 clause, and the');
  w('      answer moves with H.');
  w('    On the shipped profile both read FAIL, which is a coincidence of this operating point and');
  w('    not an equivalence: the two disagree outright under a short lamp_thermal_tau_us, where the');
  w('    DC route fires (R6-observable passes) while evalR6 is still being handed a window. The tau');
  w('    sweep below prints both columns at every value. Neither is unified into the other, and');
  w('    profile.ts is not changed: they answer different questions and the finding needs both.');
  w('');
  w('  ANTI-FITTING CHECK (architecture §14 risk 4). The C-fed/E-fed time-to-threshold ratio is a');
  w('  ratio of two L/R time constants, so it must not move with L_coil — if it did, L could be');
  w('  tuned to manufacture the AT-02 result.');
  {
    const warm = r.sweep.map((x) => x.warmRatio).filter((x): x is number => x !== null);
    const cold = r.sweep.map((x) => x.ratio).filter((x): x is number => x !== null);
    const spread = (xs: number[]): number =>
      xs.length === 0 ? Number.NaN : ((Math.max(...xs) - Math.min(...xs)) / Math.min(...xs)) * 100;
    const span = (xs: number[]): string =>
      xs.length === 0 ? 'no data' : f(Math.min(...xs), 4) + ' .. ' + f(Math.max(...xs), 4) +
        '  (spread ' + f(spread(xs), 2) + '% over a ' +
        f((L_SWEEP_UH[L_SWEEP_UH.length - 1] as number) / (L_SWEEP_UH[0] as number), 1) + 'x L range)';
    // The low-L rows are tick-quantization-limited: at 0.3 H t_E is a couple of dozen ticks, so one
    // 100 us tick is several percent of the ratio. The upper half of the sweep is where the ratio
    // is resolved well enough to be read as physics, so both spans are reported.
    const half = r.sweep.slice(r.sweep.length >> 1);
    const warmHi = half.map((x) => x.warmRatio).filter((x): x is number => x !== null);
    w('    warm-filament counterfactual (the pure L/R ratio):         ' + span(warm));
    w('    ...over the upper half of the sweep, where one tick is a small share of t_E: ' + span(warmHi));
    w('    as the model actually runs it (cold filament at the make): ' + span(cold));
    if (warmHi.length === 0) {
      w('    VERDICT: not resolvable — the warm counterfactual never crossed threshold in the upper');
      w('    half of the sweep, so there is no spread to read either way.');
    } else if (spread(warmHi) < 5) {
      w('    VERDICT: the pure L/R ratio IS independent of L_coil — it moves by ' + f(spread(warmHi), 2) +
        '% over the');
      w('    resolved half of a ' + f((L_SWEEP_UH[L_SWEEP_UH.length - 1] as number) / (L_SWEEP_UH[0] as number), 1) +
        'x range, and the residual ' + f(spread(warm), 2) + '% over the whole sweep is tick');
      w('    quantization at the low end, not physics. L_coil CANNOT be tuned to manufacture that');
      w('    ratio, which is the anti-fitting property §14 risk 4 is about.');
    } else {
      w('    VERDICT: the pure L/R ratio MOVES with L_coil by ' + f(spread(warmHi), 2) +
        '% even where it is well resolved,');
      w('    so the anti-fitting argument of §14 risk 4 does not hold as written.');
    }
    w('    But the ratio the MODEL actually produces is a different number entirely (' +
      (cold.length === 0 ? 'no data' : f(Math.min(...cold), 3) + '-' + f(Math.max(...cold), 3)) +
      ' against');
    w('    ' + (warm.length === 0 ? '-' : f(Math.min(...warm), 3) + '-' + f(Math.max(...warm), 3)) +
      '), and it DOES move with L_coil by ' + f(spread(cold), 2) + '%. That gap is O-E12\'s doing:');
    w('    a dark stage\'s cold filament is ~' + f(p.v.R_cold_uohm / 1e6, 0) + ' ohm against ~' +
      f(p.v.R_hot_uohm / 1e6, 0) + ' ohm warm, so during the electrical rise the');
    w('    indicator lamp is barely in the circuit and the C-fed coil is almost as fast as the E-fed one.');
  }
  w('');

  // ---- tau sweep
  w('-'.repeat(100));
  w('lamp_thermal_tau_us SWEEP — historical W1 diagnostic, non-gating after Wave D');
  w('-'.repeat(100));
  w('  O-E12 (LAMP-THERMAL-R) promoted components.md §9.3\'s 40 ms display filter to the filament\'s');
  w('  ELECTRICAL time constant. It is [unverified] and it is not a number any source states, so the');
  w('  question this table answers is not "is 40 ms right" but "how much of the wave\'s result is');
  w('  that number holding up". Run at the shipped L_coil ' + f(p.v.L_coil_uh / 1e6, 3) + ' H.');
  w('  A tau at or under tick_us * 20 = ' + p.v.tick_us * 20 + ' us is REJECTED AT LOAD by determinism');
  w('  rule 15 (the filament constant is in the min-device-latency term); those rows are printed as');
  w('  rejections rather than dropped, so the floor is visible.');
  w('  A row whose settles hit settle_cap_us instead of going quiet is flagged: at a long tau the');
  w('  filament is still creeping when the ' + idivRound(p.v.settle_cap_us, tickUs) +
    '-tick cap expires, and those rows are measured on a');
  w('  circuit that had not finished moving. Reported, not silently used.');
  w('  tau(us)   t_C          t_E        C-fed peak  DC route  AT-11  AT-11 first DC fail  R6-obs  R6-hold  JOINT  FULL  capped');
  for (const row of r.tauSweep) {
    if (row.rejected !== null) {
      w('  ' + String(row.tauUs).padStart(7) + '   REJECTED AT LOAD: ' + row.rejected);
      continue;
    }
    w('  ' + String(row.tauUs).padStart(7) + '   ' +
      (row.tCTicks === null ? 'never'.padEnd(12) : (row.tCTicks + ' ticks').padEnd(12)) +
      (row.tETicks === null ? 'never'.padEnd(11) : (row.tETicks + ' ticks').padEnd(11)) +
      String(row.peakUa ?? 0).padStart(10) + '  ' +
      yn(row.dcRoute).padEnd(9) + ' ' +
      yn(row.at11Holds).padEnd(6) + ' ' +
      (row.at11FirstDcFail === null ? 'none' : String(row.at11FirstDcFail)).padStart(19) + '  ' +
      yn(row.r6ObservablePass).padEnd(7) + ' ' +
      yn(row.r6HoldPass).padEnd(8) + ' ' +
      yn(row.jointFeasible).padEnd(6) + ' ' +
      yn(row.fullFeasible).padEnd(5) + ' ' +
      (row.settlesCapped === 0 ? '-' : row.settlesCapped + '/' + row.settles + ' CAPPED'));
  }
  w('  JOINT = AT-01 holds AND AT-11 holds AND R6-observable passes — the three the kill criterion');
  w('  names. FULL adds R1 and the 2-5x release band (both L\'s business, not tau\'s).');
  {
    const capped = r.tauSweep.filter((x) => x.rejected === null && x.settlesCapped > 0);
    if (capped.length > 0) {
      w('  SETTLE CAP: ' + capped.map((x) => x.tauUs + ' us').join(', ') + ' did not converge inside');
      w('  settle_cap_us=' + p.v.settle_cap_us + ' us. The shipped ' + p.v.lamp_thermal_tau_us +
        ' us does (its longest settle is printed in the');
      w('  SETTLE CONVERGENCE block below). Read those rows as bounded, not as settled values.');
    }
  }
  {
    const live = r.tauSweep.filter((x) => x.rejected === null);
    // The flip: the smallest tau at which the DC route stops firing / AT-11 starts holding.
    let flipLo: TauRow | null = null;
    let flipHi: TauRow | null = null;
    for (let i = 1; i < live.length; i++) {
      const prev = live[i - 1] as TauRow;
      const cur = live[i] as TauRow;
      if (flipLo === null && prev.dcRoute !== cur.dcRoute) { flipLo = prev; flipHi = cur; }
    }
    if (flipLo !== null && flipHi !== null) {
      w('  FLIP POINT: between tau = ' + flipLo.tauUs + ' us and tau = ' + flipHi.tauUs + ' us.');
      w('    below it  (tau ' + flipLo.tauUs + ' us): t_C ' + (flipLo.tCTicks === null ? 'never reaches threshold' : flipLo.tCTicks + ' ticks') +
        ', DC route ' + yn(flipLo.dcRoute) + ', AT-11 holds ' + yn(flipLo.at11Holds) +
        ', R6-observable ' + yn(flipLo.r6ObservablePass) + ', joint feasible ' + yn(flipLo.jointFeasible));
      w('    above it  (tau ' + flipHi.tauUs + ' us): t_C ' + (flipHi.tCTicks === null ? 'never reaches threshold' : flipHi.tCTicks + ' ticks') +
        ', DC route ' + yn(flipHi.dcRoute) + ', AT-11 holds ' + yn(flipHi.at11Holds) +
        ', R6-observable ' + yn(flipHi.r6ObservablePass) + ', joint feasible ' + yn(flipHi.jointFeasible));
    } else {
      w('  FLIP POINT: none — the DC route reads the same at every tau that loads.');
      const at11Values = new Set(live.map((x) => x.at11Holds));
      const r6Values = new Set(live.map((x) => x.r6ObservablePass));
      w('  WAVE D REVIEW: t_C reaches the indexed relay-1 threshold at every live tau; DC route NO');
      w('  throughout. AT-11 ' + (at11Values.size === 1 ? 'does not change' : 'does change') +
        ' across the sweep; R6-observable ' + (r6Values.size === 1 ? 'does not change' : 'does change') +
        '. These are report diagnostics, not acceptance gates.');
    }
    const shortSide = live.filter((x) => flipLo !== null && x.tauUs <= flipLo.tauUs);
    const longSide = live.filter((x) => flipHi !== null && x.tauUs >= flipHi.tauUs);
    const anyJoint = live.filter((x) => x.jointFeasible).map((x) => x.tauUs);
    w('  JOINT-FEASIBLE tau values over ' + (TAU_SWEEP_US[0] as number) + '-' +
      (TAU_SWEEP_US[TAU_SWEEP_US.length - 1] as number) + ' us: ' +
      (anyJoint.length === 0 ? 'NONE' : anyJoint.join(', ') + ' us'));
    if (anyJoint.length === 0 && shortSide.length > 0 && longSide.length > 0) {
      w('  CONCLUSION: the feasible region is EMPTY ON BOTH SIDES OF THE FLIP, and it is empty for');
      w('  DIFFERENT REASONS on each side. Short tau (' + shortSide.length + ' rows): the filament warms');
      w('  inside the electrical rise, the C-fed inrush peak collapses, AT-11 fails on §4.3\'s own');
      w('  hysteresis rule, and R6-observable PASSES via the DC route. Long tau (' + longSide.length +
        ' rows,');
      w('  the shipped 40000 us among them): the peak carries AT-11, the C-fed stage does reach');
      w('  threshold, the DC route is shut, and R6-observable FAILS. There is no tau at which both');
      w('  hold. O-E12\'s invented 40 ms does not decide WHETHER the profile is feasible — it decides');
      w('  WHICH constraint the infeasibility is reported against.');
    }
  }
  w('');

  // ---- controls
  w('-'.repeat(100));
  w('CONTROLS — three, not two (architecture §4.3 gives two; the third changes L_coil while');
  w('retaining the shipped offset vector.)');
  w('-'.repeat(100));
  w('"The counter fails" means: the C-fed (IV-EXP1) stage either never reaches its own pull-in at');
  w('the loaded operating point (DC reading), or a hold H exists with t_E_chain <= H < t_C_chain so the');
  w('E-fed (ER-ALTCOUNTER) chain completes and the C-fed one does not (hold-window reading). "Observable"');
  w('additionally requires that H be a hold a human could produce (' + FAST_TAP_MS[0] + '-' + FAST_TAP_MS[1] + ' ms, §9.3).');
  w('');
  w('Baseline (shipped): AT-01 ' + yn(r.verdict.at01Holds) + ' / AT-11 ' + yn(r.verdict.at11Holds) +
    ' / counter fails literal ' + yn(r.verdict.counterFails) +
    ' [DC ' + yn(r.verdict.counterFailsDc) + ', hold-window ' + yn(r.verdict.counterFailsTiming) + ']' +
    ' / observable ' + yn(r.verdict.counterFailsObservable));
  w('  baseline AT-11 on the DC reading: ' + at11DcLine(b));
  const controlsAndCross: Control[] = r.crossControl === null ? r.controls : [...r.controls, r.crossControl];
  for (const c of controlsAndCross) {
    const cb = c.battery;
    const cv = c.verdict;
    const last = cb.at11.rows[cb.at11.rows.length - 1] as At11Row;
    w('');
    w('  ' + c.id);
    w('    ' + c.why);
    w('    L_coil ' + f(cb.lCoilUh / 1e6, 3) + ' H, dV [' + cb.dVRelayMv.join(', ') + '] mV');
    w('    AT-01   coil ' + cb.at01.coilUa + ' uA vs ' + cb.at01.thrUa + ' uA -> holds ' + yn(cv.at01Holds) +
      '  (margin ' + cb.at01.marginUa + ' uA)');
    w('    AT-11   at ' + last.nOut + ' output lamps: pull-in ' + yn(last.pullInAll) + ', hold ' + yn(last.holdAll) +
      ', DC ' + yn(last.dcAll));
    w('    AT-11   on the DC reading: ' + at11DcLine(cb));
    w('    AT-02   t_E ' + ms(cb.at02.tETicks, tickUs) + ', t_C ' + ms(cb.at02.tCTicks, tickUs) +
      ', ratio ' + orDash(cb.at02.ratio, 3) + '; chain window [' + orDash(cv.windowLoMs, 1) + ', ' +
      orDash(cv.windowHiMs, 1) + '] ms, width ' + orDash(cv.windowMs, 1) + ' ms, overlaps a ' +
      FAST_TAP_MS[0] + '-' + FAST_TAP_MS[1] + ' ms tap? ' + yn(cv.overlapsFastTap));
    w('    COUNTER FAILS: literal ' + yn(cv.counterFails) + ' [DC ' + yn(cv.counterFailsDc) +
      ', hold-window ' + yn(cv.counterFailsTiming) + ']   observable ' + yn(cv.counterFailsObservable));
  }
  w('');
  w('  Control outcomes:');
  if (!r.verdict.counterFails) {
    w('    NOTE FIRST: the SHIPPED profile does not fail the counter. Baseline and control rows are');
    w('    measurements; a control outcome alone does not establish a cause.');
  }
  {
    const c1 = r.controls[0] as Control;
    const c2 = r.controls[1] as Control;
    const c3 = r.controls[2] as Control;
    w('    control 1 counter fails? ' + yn(c1.verdict.counterFails));
    w('    control 2 counter fails? ' + yn(c2.verdict.counterFails));
    w('    control 3 counter fails? ' + yn(c3.verdict.counterFails));
    w('    (control 3, on the observable reading: ' + yn(c3.verdict.counterFailsObservable) +
      '. Its window is ' + orDash(c3.verdict.windowMs, 1) + ' ms wide — read that against the ' +
      p.v.tick_us + ' us tick.)');
    if (r.crossControl !== null) {
      const c4 = r.crossControl;
      w('    control 4 (spread gone AND tau at the sweep floor) fails the counter? ' +
        yn(c4.verdict.counterFails) + ' [DC ' + yn(c4.verdict.counterFailsDc) + ', hold-window ' +
        yn(c4.verdict.counterFailsTiming) + '], observable ' + yn(c4.verdict.counterFailsObservable));
      w('      AT-11 on the DC reading with the spread gone and tau short: ' + at11DcLine(c4.battery));
    }
    w('');
    w('    WHAT AT-11\'S DC READING SAYS ACROSS THE CONTROLS — the three lines this file exists to');
    w('    put side by side:');
    w('      baseline (spread shipped)   ' + at11DcLine(b));
    w('      control 1 (spread zeroed)   ' + at11DcLine(c1.battery));
    w('      control 2 (spread rotated)  ' + at11DcLine(c2.battery));
    w('      control 3 (L neutralised)   ' + at11DcLine(c3.battery));
    if (r.crossControl !== null) {
      w('      control 4 (zeroed + short tau) ' + at11DcLine(r.crossControl.battery));
    }
  }
  w('');

  // ---- PWL
  w('-'.repeat(100));
  w('PWL BREAKPOINT COUNT — 33 vs 9 (architecture §10.1 allows both; the count is decided by');
  w('measurement, not taste)');
  w('-'.repeat(100));
  w('  compared ' + r.pwl.compared + ' quantized results and relay decisions across every acceptance test');
  w('  lamp resistance at the E-fed operating point (' + r.pwl.probeUa + ' uA): 33-point ' +
    f(r.pwl.at33Ohm / 1e6, 3) + ' ohm, 9-point ' + f(r.pwl.at9Ohm / 1e6, 3) + ' ohm  (' +
    f(((r.pwl.at9Ohm - r.pwl.at33Ohm) / r.pwl.at33Ohm) * 100, 2) + '%)');
  if (r.pwl.differing.length === 0) {
    w('  NOTHING DIFFERS AT ALL. 9 breakpoints ship and 33 stops being a magic number.');
  } else {
    const decisions = r.pwl.differing.filter((x) => x.key.indexOf('decision') >= 0);
    const values = r.pwl.differing.filter((x) => x.key.indexOf('decision') < 0);
    let worst = values[0];
    for (const dd of values) {
      if (worst === undefined) break;
      const a = Math.abs((dd.at9 - dd.at33) / (dd.at33 === 0 ? 1 : dd.at33));
      const bq = Math.abs((worst.at9 - worst.at33) / (worst.at33 === 0 ? 1 : worst.at33));
      if (a > bq) worst = dd;
    }
    w('  RELAY / BREAKER DECISIONS that differ: ' + decisions.length +
      (decisions.length === 0 ? '  — not one state changes.' : ''));
    for (const dd of decisions) {
      w('    ' + dd.key.padEnd(44) + ' 33-point ' + String(dd.at33).padStart(9) + '   9-point ' + String(dd.at9).padStart(9));
    }
    w('  REPORTED VALUES that differ: ' + values.length + ' of ' + r.pwl.compared);
    if (worst !== undefined) {
      w('    largest relative difference: ' + worst.key + '  33-point ' + worst.at33 + ' vs 9-point ' +
        worst.at9 + '  (' + f(((worst.at9 - worst.at33) / (worst.at33 === 0 ? 1 : worst.at33)) * 100, 3) + '%)');
    }
    w('    first ten, for the record:');
    for (let i = 0; i < values.length && i < 10; i++) {
      const dd = values[i] as { key: string; at33: number; at9: number };
      w('      ' + dd.key.padEnd(44) + ' 33-point ' + String(dd.at33).padStart(9) + '   9-point ' + String(dd.at9).padStart(9));
    }
  }
  w('');

  // ---- settle convergence
  w('-'.repeat(100));
  w('SETTLE CONVERGENCE — every settle in the shipped-profile battery, not just AT-01\'s');
  w('-'.repeat(100));
  w('  "quiet" means the quantized branch currents stopped moving for settle_quiet_ticks=' +
    p.v.settle_quiet_ticks + ' before');
  w('  settle_cap_us=' + p.v.settle_cap_us + ' us (' + idivRound(p.v.settle_cap_us, tickUs) +
    ' ticks) ran out. A settle that hit the cap is a number');
  w('  measured on a circuit that had not finished moving, and until now only AT-01 reported it.');
  {
    const bad = b.settles.filter((x) => !x.quiet);
    for (const st of b.settles) {
      w('  ' + (st.quiet ? 'quiet' : 'CAPPED') + '  ' + String(st.ticks).padStart(5) + ' ticks  ' + st.label);
    }
    w('  ' + b.settles.length + ' settles, ' + (b.settles.length - bad.length) + ' converged, ' +
      bad.length + ' hit the cap.');
    if (bad.length === 0) {
      w('  EVERY settle in this battery converged, including the two the release argument rests on');
      w('  (cStartUa ' + b.release.cStartUa + ' uA and eStartUa ' + b.release.eStartUa + ' uA).');
    }
  }
  {
    // The sweep and the controls run their own batteries; their settles are aggregated rather than
    // listed, because the list would be twenty times longer than the finding it supports.
    let tot = 0;
    let cap = 0;
    for (const c of controlsAndCross) {
      tot += c.battery.settles.length;
      cap += c.battery.settles.filter((x) => !x.quiet).length;
    }
    w('  controls (' + controlsAndCross.length + ' batteries): ' + tot + ' settles, ' + cap + ' hit the cap.');
    w('  9-breakpoint comparison battery: ' + r.pwl9Battery.settles.length + ' settles, ' +
      r.pwl9Battery.settles.filter((x) => !x.quiet).length + ' hit the cap.');
    let sTot = 0;
    let sCap = 0;
    for (const row of r.sweep) { sTot += row.settles; sCap += row.settlesCapped; }
    w('  L_coil sweep (' + r.sweep.length + ' batteries): ' + sTot + ' settles, ' + sCap + ' hit the cap.');
    let tTot = 0;
    let tCap = 0;
    let tLive = 0;
    for (const row of r.tauSweep) {
      tTot += row.settles;
      tCap += row.settlesCapped;
      if (row.rejected === null) tLive++;
    }
    w('  lamp_thermal_tau_us sweep (' + tLive + ' batteries that loaded): ' + tTot + ' settles, ' +
      tCap + ' hit the cap.');
    w('  EVERY settle in this run converged: ' +
      yn(b.settles.every((x) => x.quiet) && cap === 0 && sCap === 0 && tCap === 0 &&
        r.pwl9Battery.settles.every((x) => x.quiet)));
  }
  w('');

  // ---- machine-readable
  w('-'.repeat(100));
  w('MACHINE-READABLE SUMMARY (JSON) — the finding document is written from this block');
  w('-'.repeat(100));
  w(JSON.stringify(summary(r), null, 2));
  w('');
  // The finding document quotes this file's own output length; printing it here is what stops that
  // number drifting the moment a line is added. Counted on the CHARACTERS, not on `L.length`: the
  // JSON block above is one array element carrying several hundred newlines.
  const body = L.join('\n');
  let newlines = 0;
  for (let i = 0; i < body.length; i++) if (body.charCodeAt(i) === 10) newlines++;
  // +1 for the newline that separates the body from the line below, +1 for the trailing newline.
  const total = newlines + 2;
  return body + '\nREPORT LINE COUNT: ' + total +
    ' lines, this line included (`node tools/check-profile.ts | wc -l` agrees).\n';
}

/** The flat record the finding is written from. Units are in every key name. */
export function summary(r: Report): unknown {
  const p = r.profile;
  const b = r.battery;
  const tickUs = p.v.tick_us;
  const toMs = (t: number | null): number | null => (t === null ? null : (t * tickUs) / 1000);
  return {
    schema: 'minivac.check-profile/1',
    profile_id: p.id,
    L_coil_uh: p.v.L_coil_uh,
    dV_relay_mv: p.dVRelayMv,
    pwl_breakpoints: p.pwl.length,
    tick_us: tickUs,
    nonPortable: b.nonPortable,
    derived: {
      pullIn_ua: p.derived.pullInUa,
      dropOut_ua: p.derived.dropOutUa,
      relayPullIn_ua: p.derived.relayPullInUa,
      relayDropOut_ua: p.derived.relayDropOutUa,
      operate_ticks: p.derived.relayOperateTicks,
      release_ticks: p.derived.relayReleaseTicks,
      arcStep_ua_per_tick_SHORTHAND: p.derived.arcStepUa,
    },
    AT01: b.at01,
    AT04: b.at04,
    AT05: b.at05,
    AT06: b.at06,
    AT07: b.at07,
    AT09: { measured: false, claim: 'breaker latches open, POWER lamp dark until reset; components.md §7.2/§7.3 [verified]; no device layer in W1' },
    AT10: b.at10,
    AT11: {
      rows: b.at11.rows,
      first_dc_failure_output_lamps: b.at11.firstDcFailNOut,
      dc_failing_relays_at_first: b.at11.firstDcFailNOut === null ? []
        : dcFailingRelays(b.at11.rows[b.at11.firstDcFailNOut] as At11Row),
      dc_failing_relays_at_full_load: dcFailingRelays(b.at11.rows[b.at11.rows.length - 1] as At11Row),
      first_pullin_failure_output_lamps: b.at11.firstPullInFailNOut,
    },
    AT02: {
      ...b.at02,
      t_C_ms: toMs(b.at02.tCTicks),
      t_E_ms: toMs(b.at02.tETicks),
      carry_chains: CARRY_CHAINS.map((ch, i) => ({
        id: ch.id,
        shorted_releases: ch.shortedReleases,
        operates: ch.operates,
        C_ticks: b.at02.chainCTicks[i] ?? null,
        E_ticks: b.at02.chainETicks[i] ?? null,
        C_ms: toMs(b.at02.chainCTicks[i] ?? null),
        E_ms: toMs(b.at02.chainETicks[i] ?? null),
        mech_only_C_ticks: b.at02.mechOnlyCTicks[i] ?? null,
        mech_only_E_ticks: b.at02.mechOnlyETicks[i] ?? null,
        why: ch.why,
      })),
      chain_worst_C_ms: toMs(b.at02.chainWorstCTicks),
      chain_worst_E_ms: toMs(b.at02.chainWorstETicks),
      chain_worst_C_id: b.at02.chainWorstCId,
      chain_worst_E_id: b.at02.chainWorstEId,
      mech_only_worst_C_ms: toMs(b.at02.mechOnlyWorstCTicks),
      mech_only_worst_E_ms: toMs(b.at02.mechOnlyWorstETicks),
      chain_literal_C_ms: toMs(b.at02.chainLiteralCTicks),
      chain_literal_E_ms: toMs(b.at02.chainLiteralETicks),
    },
    release: b.release,
    release_band: { lo: RELEASE_RATIO_LO, hi: RELEASE_RATIO_HI },
    verdict: r.verdict,
    fast_tap_bracket_ms: FAST_TAP_MS,
    constraints: r.constraints,
    sweep: r.sweep,
    feasible_L_coil_uh: r.feasibleUh,
    shipped_L_coil_feasible: r.shippedFeasible,
    tau_sweep: r.tauSweep,
    tau_joint_feasible_us: r.tauSweep.filter((x) => x.jointFeasible).map((x) => x.tauUs),
    settles: {
      battery_total: b.settles.length,
      battery_capped: b.settles.filter((x) => !x.quiet).length,
      all_quiet: b.settles.every((x) => x.quiet),
    },
    controls: [...r.controls, ...(r.crossControl === null ? [] : [r.crossControl])].map((c) => ({
      id: c.id,
      L_coil_uh: c.battery.lCoilUh,
      dV_relay_mv: c.battery.dVRelayMv,
      AT01_holds: c.verdict.at01Holds,
      AT01_margin_ua: c.battery.at01.marginUa,
      AT11_holds: c.verdict.at11Holds,
      AT11_first_dc_failure_output_lamps: c.battery.at11.firstDcFailNOut,
      AT11_dc_failing_relays_at_first: c.battery.at11.firstDcFailNOut === null ? []
        : dcFailingRelays(c.battery.at11.rows[c.battery.at11.firstDcFailNOut] as At11Row),
      AT11_dc_failing_relays_at_full_load:
        dcFailingRelays(c.battery.at11.rows[c.battery.at11.rows.length - 1] as At11Row),
      t_C_ticks: c.battery.at02.tCTicks,
      t_E_ticks: c.battery.at02.tETicks,
      window_lo_ms: c.verdict.windowLoMs,
      window_hi_ms: c.verdict.windowHiMs,
      counter_fails: c.verdict.counterFails,
      counter_fails_dc: c.verdict.counterFailsDc,
      counter_fails_timing: c.verdict.counterFailsTiming,
    })),
    pwl_9_vs_33: {
      compared: r.pwl.compared,
      differing: r.pwl.differing,
      differing_decisions: r.pwl.differing.filter((x) => x.key.indexOf('decision') >= 0).length,
      probe_ua: r.pwl.probeUa,
      r33_uohm: r.pwl.at33Ohm,
      r9_uohm: r.pwl.at9Ohm,
    },
  };
}

// ===============================================================================================
// Wave C — the pre-registered two-counter experiment (`npm run check-profile -- --counter`).
// ===============================================================================================

const COUNTER_PROGRAMS_MD = new URL('../docs/research/programs.md', import.meta.url);
const COUNTER_REF_JSON = new URL('../data/profiles/MV601-REF-A.json', import.meta.url);
const COUNTER_IDEAL_JSON = new URL('../data/profiles/MV601-IDEAL.json', import.meta.url);
const COUNTER_T_UA = 43_333;
const COUNTER_SOURCE_BOUND_UA = 818_779;

const COUNTER_FILES = {
  // W4 source correction: old 223_341 / 19e65dcac45b01cbba1f6679afe7fc27.
  // W6 source-image correction: old 224_372 / ffa4c11cf895b0e9e167e8980cc7da96.
  // Phase 2 public-source verification: old 225_122 / 82d3d834cdc7ed13dcd1b0fc90be54f8.
  // Phase 5 Step 1b: the IV-EXP1 count-5 chart misprint note.
  // Phase 5 C13 resolution (Tug of War direction words): old 225_744 / 757b9a7cf00d53c42d96d4a38700cadf.
  // Phase 5 batch 1 (V-EXP10/V-EXP16 image-read, III-RELAYNOT index tag): old 225_462 / 1eede9a6b1c901bb7c1f5480b4b43f84.
  // Phase 5 batch 2 (five records image-read; V-EXP12 code table, VI-REACTION and III-FARMER verbatim procedure): old 225_696 / 42217a96e8ad58f560ba028cf221d1fe.
  // Phase 5 batch 3 (four records image-read; IV-APX-2BITADDER 5Y/6Y; V-EXP20 verbatim procedure): old 226_777 / b0783e806756934b613443cac804e49c.
  // Phase 5 waves 1-2 (28 records image-read, verbatim procedures, page fixes): old 227_510 / 3839571730cd9a7a54b3bc083833a58d.
  // Phase 5 wave 3 (records image-read; II-EXP1 printed 5F/5-, 25 -> 26; ER-33 Affects drops V-EXP13): old 245_727 / 21478560d04f7f7f733613f5c17bacc1.
  programs: { bytes: 252_989, md5: '612f296118a8c6458cf21e6aa5720d7b' },
  // Wave D integrity-container migration: old 19_352 / 1905ade86d2b2922d4553babeca42173.
  // W2 provenance-only correction: old REF 20_208 / b416fb570450ff1eaa02716bb803a5f8;
  // old IDEAL 19_157 / 4c17287c37548a0867820b51ba115c7d.
  // W4a measured-gate migration: old REF 20_349 / 97a9e0386a2d190882b84131da1d4415;
  // old IDEAL 19_298 / 0cade199e19324d0a57499dad23d4ec8.
  // Phase 5 TRANSFER-COAST-DEFER src text: old REF 20_667 / b5df9ea44231d76019a512a295340f0a;
  // old IDEAL 19_616 / 26e6fa57b6ba403ecc5c18be653ab56e.
  // Phase 5 COAST-SCALES-WITH-SPEED src text: old REF 20_755 / 9346ad8f91a7a44133aea54fcc5194cf;
  // old IDEAL 19_704 / 6ee3c740452c19fbcff26047f49b0ab3.
  // Phase 5 coast set from printed bounds (2026-10-14, drive_removed 20 -> 9.54 deg, value and src text):
  // old REF 20_965 / 9aad43fc256d00b431b4d6aa9ca092be; old IDEAL 19_914 / b6c9729599423840fe8f4430c5e38b4f.
  // Cleanup: profile src cites re-pointed at DECISIONS (src text only):
  // old REF 22_263 / b714f8960d4afaa7a03f8e7d77cbf219; old IDEAL 21_212 / 760661d7d64490afa1a8796cbe8ab11a.
  ref: { bytes: 22_270, md5: 'b502742a830c84ba974effcae1046135' },
  ideal: { bytes: 21_201, md5: '4af4ba732c9abee8fca75113c31e7aba' },
} as const;

const Q1_VECTORS = [
  // Wave C's completed arrays are immutable historical experiment inputs. D does not replace S.
  { id: 'Z', dv: [0, 0, 0, 0, 0, 0] },
  { id: 'S', dv: [300, -240, 290, -110, 250, -170] },
  { id: 'R', dv: [-170, 300, -240, 290, -110, 250] },
  { id: 'N', dv: [-300, 240, -290, 110, -250, 170] },
] as const;

const Q1_PAIRS: readonly (readonly (readonly [number, number])[])[] = [
  [],
  [[6, 5]],
  [[4, 3]],
  [[6, 5], [4, 3]],
  [[2, 1]],
  [[6, 5], [2, 1]],
  [[4, 3], [2, 1]],
  [[6, 5], [4, 3], [2, 1]],
];

function md5Bytes(bytes: Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex');
}

function requireRegisteredFile(label: string, bytes: Uint8Array, registered: { bytes: number; md5: string }): string {
  const gotMd5 = md5Bytes(bytes);
  if (bytes.byteLength !== registered.bytes || gotMd5 !== registered.md5) {
    throw new Error(
      `Wave C source-integrity failure: ${label} is ${bytes.byteLength} bytes MD5 ${gotMd5}; ` +
      `registered ${registered.bytes} bytes MD5 ${registered.md5}`,
    );
  }
  return gotMd5;
}

function docValue(doc: Doc, key: string): unknown {
  const e = doc.values[key];
  if (e === undefined) throw new Error(`Wave C source-integrity failure: profile has no ${key}`);
  return e.v;
}

/**
 * The literal Wave C derivation order: raw REF-A clone, two raw replacements, one loadProfile.
 * This is exported so the tests can distinguish it from mutating a loaded Profile/Derived.
 */
export function deriveCounterProfile(
  lCoilUh: number,
  dVRelayMv: readonly number[],
  base: Doc = readDoc('MV601-REF-A.json'),
): Profile {
  const raw = cloneDoc(base);
  const l = raw.values['L_coil_uh'];
  const dv = raw.values['dV_relay_mv'];
  if (l === undefined || dv === undefined) throw new Error('Wave C source-integrity failure: REF-A lacks an override key');
  l.v = lCoilUh;
  dv.v = [...dVRelayMv];
  return loadProfile(raw);
}

export interface CounterSourceIntegrity {
  id: string;
  count: number | null;
  bytes: number;
  md5: string;
}

export interface CounterProfileHashes {
  refBefore: string;
  refAfter: string;
  idealBefore: string;
  idealAfter: string;
}

export interface GatePRow {
  program: CounterProgramId;
  case: string;
  event: CounterEvent;
  mask: string;
  status: 'VALUE' | 'REFUSED';
  refusals: GatePRefusal[];
}

interface CounterValueRow {
  status: RowStatus;
  reason: string | null;
}

export interface CounterMarginRow extends CounterValueRow {
  lCoilUh: number;
  case: string;
  event: CounterEvent;
  mask: string;
  relay: number;
  expectedOperated: boolean;
  currentUa: number | null;
  thresholdUa: number | null;
  marginUa: number | null;
}

export interface CounterSourceRow extends CounterValueRow {
  lCoilUh: number;
  case: string;
  event: CounterEvent;
  mask: string;
  currentUa: number | null;
}

export interface CounterSourceMaximum extends CounterValueRow {
  lCoilUh: number;
  maximumUa: number | null;
}

export interface Q1DeltaRow extends CounterValueRow {
  lCoilUh: number;
  vector: 'Z' | 'S' | 'R' | 'N';
  count: number;
  evenRelay: number;
  oddRelay: number;
  evenMarginUa: number | null;
  oddMarginUa: number | null;
  deltaUa: number | null;
  minDecisionUa: number | null;
}

export interface Q1CountZeroRow extends CounterValueRow {
  lCoilUh: number;
  vector: 'Z' | 'S' | 'R' | 'N';
  count: 0;
  deltaUa: null;
}

export interface Q2StructuralRow extends CounterValueRow {
  state: 'count-0-UP' | 'count-7-UP';
  oddRelay: number;
  evenRelay: number;
  terminal: string;
  inDatum: boolean | null;
  expectedInDatum: boolean;
}

export interface Q2ComparisonRow extends CounterValueRow {
  lCoilUh: number;
  tIv: number | null;
  ivRelay5Ua: number | null;
  erRelay5Ua: number | null;
  deltaUa: number | null;
  minDecisionUa: number | null;
}

export type CounterAggregateStatus =
  | 'PASS'
  | 'FAIL'
  | 'INDETERMINATE (Gate P)'
  | 'INDETERMINATE (NO SETTLE)';

export interface CounterAggregate {
  status: CounterAggregateStatus;
  reason: string;
}

export interface CounterReport {
  sources: CounterSourceIntegrity[];
  profileHashes: CounterProfileHashes;
  nominalPullInUa: number;
  gateT: ReturnType<typeof runGateT>;
  gateP: GatePRow[];
  boundMargins: CounterMarginRow[];
  sourceCurrents: CounterSourceRow[];
  sourceMaxima: CounterSourceMaximum[];
  q1Deltas: Q1DeltaRow[];
  q1CountZero: Q1CountZeroRow[];
  q2Structural: Q2StructuralRow[];
  q2Comparisons: Q2ComparisonRow[];
  boundAggregate: CounterAggregate;
  q1Aggregate: CounterAggregate;
  q2Aggregate: CounterAggregate;
  outcome: '(a)' | '(b)';
}

function gateKey(program: CounterProgramId, state: RegisteredState): string {
  return `${program}|${state.case}|${state.event}|${state.mask}`;
}

function stampForState(program: CounterProgramId, state: RegisteredState, p: Profile): CounterStamp {
  return stampCounter(program, {
    event: state.event,
    mask: state.mask,
    pushbutton6Down: state.event === 'DOWN',
  }, p);
}

function runStaticCounter(
  program: CounterProgramId,
  state: RegisteredState,
  lCoilUh: number,
  dVRelayMv: readonly number[],
  base: Doc,
  label: string,
): { profile: Profile; settled: SettleOut } {
  const p = deriveCounterProfile(lCoilUh, dVRelayMv, base);
  const e = makeEnv(p, null);
  const stamp = stampForState(program, state, p);
  const settled = settle(stamp.els, coldStart(stamp.els, e), e, label);
  if (e.flags.nonPortable) throw new Error(`Wave C infrastructure failure: non-portable arithmetic in ${label}`);
  return { profile: p, settled };
}

function gatePReason(row: GatePRow): string {
  return row.refusals.map((r) => `{${r.members.join(' ')} : ${r.coils.join(',')}}`).join(' ');
}

function gatePRowFor(rows: readonly GatePRow[], program: CounterProgramId, state: RegisteredState): GatePRow {
  const key = gateKey(program, state);
  const found = rows.find((r) => `${r.program}|${r.case}|${r.event}|${r.mask}` === key);
  if (found === undefined) throw new Error(`Wave C infrastructure failure: missing Gate P row ${key}`);
  return found;
}

export function counterAggregate(
  statuses: readonly RowStatus[],
  predicatesPass: boolean,
  predicateFailureReason = 'one or more registered predicates failed',
): CounterAggregate {
  const refused = statuses.filter((s) => s === 'REFUSED').length;
  if (refused > 0) {
    return { status: 'INDETERMINATE (Gate P)', reason: `${refused} required row(s) were REFUSED` };
  }
  const noSettle = statuses.filter((s) => s === 'NO_SETTLE').length;
  if (noSettle > 0) {
    return { status: 'INDETERMINATE (NO SETTLE)', reason: `${noSettle} required row(s) reached settle_cap_us` };
  }
  const noCrossing = statuses.filter((s) => s === 'NO_CROSSING').length;
  if (noCrossing > 0) {
    return { status: 'FAIL', reason: `${noCrossing} required Q2 row(s) had NO_CROSSING` };
  }
  if (!predicatesPass) return { status: 'FAIL', reason: predicateFailureReason };
  return { status: 'PASS', reason: 'every required row is VALUE and every registered predicate passed' };
}

export function counterOutcome(
  bound: CounterAggregateStatus,
  q1: CounterAggregateStatus,
  q2: CounterAggregateStatus,
): '(a)' | '(b)' {
  return bound === 'PASS' && q1 === 'PASS' && q2 === 'PASS' ? '(a)' : '(b)';
}

export interface CounterRunOptions {
  /** Test seam: throws after Gate T, before Gate P or any scientific table exists. */
  failAfterGateT?: string;
}

export function runCounter(options: CounterRunOptions = {}): CounterReport {
  // C0: validate every immutable source before Gate T or any numerical row.
  const iv = validateProgramLiteral('IV-EXP1', COUNTER_PROGRAMS['IV-EXP1']);
  const er = validateProgramLiteral('ER-ALTCOUNTER', COUNTER_PROGRAMS['ER-ALTCOUNTER']);
  const programsBytes = readFileSync(COUNTER_PROGRAMS_MD);
  const refBeforeBytes = readFileSync(COUNTER_REF_JSON);
  const idealBeforeBytes = readFileSync(COUNTER_IDEAL_JSON);
  const programsMd5 = requireRegisteredFile('programs.md', programsBytes, COUNTER_FILES.programs);
  const refBefore = requireRegisteredFile('MV601-REF-A.json before', refBeforeBytes, COUNTER_FILES.ref);
  const idealBefore = requireRegisteredFile('MV601-IDEAL.json before', idealBeforeBytes, COUNTER_FILES.ideal);
  const refDoc = JSON.parse(refBeforeBytes.toString('utf8')) as Doc;
  const idealDoc = JSON.parse(idealBeforeBytes.toString('utf8')) as Doc;
  const refL = docValue(refDoc, 'L_coil_uh');
  const idealL = docValue(idealDoc, 'L_coil_uh');
  if (refL !== 1_200_000 || idealL !== 12_000) {
    throw new Error(`Wave C source-integrity failure: registered inductances are REF=${String(refL)} IDEAL=${String(idealL)}`);
  }
  const inductances = [refL, idealL] as const;
  const zero = Q1_VECTORS[0].dv;
  const nominal = deriveCounterProfile(refL, zero, refDoc);
  if (nominal.derived.pullInUa !== COUNTER_T_UA || nominal.derived.relayPullInUa.some((x) => x !== COUNTER_T_UA)) {
    throw new Error(
      `Wave C source-integrity failure: Z threshold is ${nominal.derived.pullInUa}/` +
      `[${nominal.derived.relayPullInUa.join(',')}], registered T=${COUNTER_T_UA} uA`,
    );
  }

  // Gate T: fail infrastructure before producing any scientific outcome.
  const gateT = runGateT(nominal);
  if (gateT.violations.length > 0) {
    throw new Error(`Wave C Gate T infrastructure failure:\n${gateT.violations.join('\n')}`);
  }
  if (options.failAfterGateT !== undefined) throw new Error(options.failAfterGateT);

  // Gate P: all 32 chart states plus the two distinct Q2 pre-transfer configurations.
  const gatePRows: GatePRow[] = [];
  for (const program of ['IV-EXP1', 'ER-ALTCOUNTER'] as const) {
    for (const state of REGISTERED_STATES) {
      const refusals = gateP(stampForState(program, state, nominal));
      gatePRows.push({
        program, case: state.case, event: state.event, mask: state.mask,
        status: refusals.length === 0 ? 'VALUE' : 'REFUSED', refusals,
      });
    }
  }
  const q2State: RegisteredState = { case: 'Q2-pre-transfer', event: 'DOWN', mask: '000000' };
  for (const program of ['IV-EXP1', 'ER-ALTCOUNTER'] as const) {
    const refusals = gateP(stampForState(program, q2State, nominal));
    gatePRows.push({
      program, case: q2State.case, event: q2State.event, mask: q2State.mask,
      status: refusals.length === 0 ? 'VALUE' : 'REFUSED', refusals,
    });
  }

  // C-B: each table row independently clones raw REF-A, performs both raw replacements, loads
  // once, and settles from cold. Source-current rows repeat the configuration independently.
  const boundMargins: CounterMarginRow[] = [];
  const sourceCurrents: CounterSourceRow[] = [];
  for (const lCoilUh of inductances) {
    for (const state of REGISTERED_STATES) {
      const gate = gatePRowFor(gatePRows, 'IV-EXP1', state);
      for (let relay = 1; relay <= 6; relay++) {
        const base = {
          lCoilUh, case: state.case, event: state.event, mask: state.mask, relay,
          expectedOperated: relayOperatedInMask(state.mask, relay),
        };
        if (gate.status === 'REFUSED') {
          boundMargins.push({ ...base, status: 'REFUSED', reason: gatePReason(gate), currentUa: null, thresholdUa: null, marginUa: null });
          continue;
        }
        const run = runStaticCounter('IV-EXP1', state, lCoilUh, zero, refDoc, `C-B L=${lCoilUh} ${state.case} relay=${relay}`);
        if (!run.settled.quiet) {
          boundMargins.push({ ...base, status: 'NO_SETTLE', reason: 'settle_cap_us reached without quiet', currentUa: null, thresholdUa: null, marginUa: null });
          continue;
        }
        const currentUa = Math.abs(run.settled.iUa[11 + relay] as number);
        const thresholdUa = run.profile.derived.relayPullInUa[relay - 1] as number;
        const marginUa = base.expectedOperated ? currentUa - thresholdUa : (thresholdUa - 1) - currentUa;
        boundMargins.push({ ...base, status: 'VALUE', reason: null, currentUa, thresholdUa, marginUa });
      }

      if (gate.status === 'REFUSED') {
        sourceCurrents.push({
          lCoilUh, case: state.case, event: state.event, mask: state.mask,
          status: 'REFUSED', reason: gatePReason(gate), currentUa: null,
        });
      } else {
        const run = runStaticCounter('IV-EXP1', state, lCoilUh, zero, refDoc, `C-B source L=${lCoilUh} ${state.case}`);
        sourceCurrents.push({
          lCoilUh, case: state.case, event: state.event, mask: state.mask,
          status: run.settled.quiet ? 'VALUE' : 'NO_SETTLE',
          reason: run.settled.quiet ? null : 'settle_cap_us reached without quiet',
          currentUa: run.settled.quiet ? Math.abs(run.settled.iUa[21] as number) : null,
        });
      }
    }
  }
  const sourceMaxima: CounterSourceMaximum[] = [];
  for (const lCoilUh of inductances) {
    const rows = sourceCurrents.filter((r) => r.lCoilUh === lCoilUh);
    const nonValue = rows.filter((r) => r.status !== 'VALUE');
    if (nonValue.length === 0) {
      sourceMaxima.push({
        lCoilUh, status: 'VALUE', reason: null,
        maximumUa: Math.max(...rows.map((r) => r.currentUa as number)),
      });
    } else {
      const status: RowStatus = nonValue.some((r) => r.status === 'REFUSED') ? 'REFUSED' : 'NO_SETTLE';
      sourceMaxima.push({
        lCoilUh, status, maximumUa: null,
        reason: nonValue.map((r) => `IV-EXP1|${r.case}|${r.event}|${r.mask}:${r.status}`).join(' '),
      });
    }
  }
  const boundPredicatesPass = boundMargins.every((r) => r.status === 'VALUE' && (r.marginUa as number) >= 0) &&
    sourceMaxima.every((r) => r.status === 'VALUE' && (r.maximumUa as number) < COUNTER_SOURCE_BOUND_UA);
  const boundAggregate = counterAggregate(
    [...boundMargins, ...sourceCurrents, ...sourceMaxima].map((r) => r.status),
    boundPredicatesPass,
    `a C-B expected-state margin was negative or a source maximum was not < ${COUNTER_SOURCE_BOUND_UA} uA`,
  );

  // C-Q1: fixed 96 pair rows and eight separately printed count-0 rows.
  const q1Deltas: Q1DeltaRow[] = [];
  const q1CountZero: Q1CountZeroRow[] = [];
  for (const lCoilUh of inductances) {
    for (const vector of Q1_VECTORS) {
      q1CountZero.push({ lCoilUh, vector: vector.id, count: 0, status: 'VALUE', reason: 'no energized relay pair', deltaUa: null });
      for (let count = 1; count <= 7; count++) {
        const state = REGISTERED_STATES.find((s) => s.case === String(count) && s.event === 'UP');
        if (state === undefined) throw new Error(`Wave C infrastructure failure: missing UP state ${count}`);
        const gate = gatePRowFor(gatePRows, 'IV-EXP1', state);
        for (const [evenRelay, oddRelay] of Q1_PAIRS[count] as readonly (readonly [number, number])[]) {
          const base = { lCoilUh, vector: vector.id, count, evenRelay, oddRelay };
          if (gate.status === 'REFUSED') {
            q1Deltas.push({
              ...base, status: 'REFUSED', reason: gatePReason(gate), evenMarginUa: null,
              oddMarginUa: null, deltaUa: null, minDecisionUa: null,
            });
            continue;
          }
          const run = runStaticCounter('IV-EXP1', state, lCoilUh, vector.dv, refDoc, `C-Q1 L=${lCoilUh} V=${vector.id} count=${count} pair=${evenRelay}/${oddRelay}`);
          if (!run.settled.quiet) {
            q1Deltas.push({
              ...base, status: 'NO_SETTLE', reason: 'settle_cap_us reached without quiet',
              evenMarginUa: null, oddMarginUa: null, deltaUa: null, minDecisionUa: null,
            });
            continue;
          }
          const evenUa = Math.abs(run.settled.iUa[11 + evenRelay] as number);
          const oddUa = Math.abs(run.settled.iUa[11 + oddRelay] as number);
          const evenMarginUa = evenUa - (run.profile.derived.relayPullInUa[evenRelay - 1] as number);
          const oddMarginUa = oddUa - (run.profile.derived.relayPullInUa[oddRelay - 1] as number);
          q1Deltas.push({
            ...base, status: 'VALUE', reason: null, evenMarginUa, oddMarginUa,
            deltaUa: evenMarginUa - oddMarginUa, minDecisionUa: run.profile.v.min_decision_ua,
          });
        }
      }
    }
  }
  const q1PredicatesPass = q1Deltas.every((r) =>
    r.status === 'VALUE' && (r.deltaUa as number) > (r.minDecisionUa as number));
  const q1Aggregate = counterAggregate(
    q1Deltas.map((r) => r.status),
    q1PredicatesPass,
    'a required C-Q1 delta was not strictly greater than min_decision_ua',
  );

  // C-Q2 structural: two complete ER states, three odd/even pairs, no partner-only inference.
  const q2Structural: Q2StructuralRow[] = [];
  const upState = (count: string): RegisteredState => {
    const found = REGISTERED_STATES.find((s) => s.case === count && s.event === 'UP');
    if (found === undefined) throw new Error(`Wave C infrastructure failure: missing UP state ${count}`);
    return found;
  };
  const q2States = [
    { label: 'count-0-UP' as const, state: upState('0'), expected: true },
    { label: 'count-7-UP' as const, state: upState('7'), expected: false },
  ];
  for (const q of q2States) {
    const gate = gatePRowFor(gatePRows, 'ER-ALTCOUNTER', q.state);
    const stamp = stampForState('ER-ALTCOUNTER', q.state, nominal);
    for (const [oddRelay, evenRelay] of [[1, 2], [3, 4], [5, 6]] as const) {
      const terminal = `${oddRelay}E`;
      if (gate.status === 'REFUSED') {
        q2Structural.push({
          state: q.label, oddRelay, evenRelay, terminal, status: 'REFUSED',
          reason: gatePReason(gate), inDatum: null, expectedInDatum: q.expected,
        });
        continue;
      }
      const inDatum = stamp.nodeByTerminal[terminal] === stamp.datum;
      q2Structural.push({
        state: q.label, oddRelay, evenRelay, terminal, status: 'VALUE', reason: null,
        inDatum, expectedInDatum: q.expected,
      });
    }
  }

  // C-Q2 numeric: two independent profiles and carried states, sampled at IV's first crossing.
  const q2Comparisons: Q2ComparisonRow[] = [];
  const ivQ2Gate = gatePRowFor(gatePRows, 'IV-EXP1', q2State);
  const erQ2Gate = gatePRowFor(gatePRows, 'ER-ALTCOUNTER', q2State);
  for (const lCoilUh of inductances) {
    if (ivQ2Gate.status === 'REFUSED' || erQ2Gate.status === 'REFUSED') {
      q2Comparisons.push({
        lCoilUh, status: 'REFUSED', reason: `IV=${gatePReason(ivQ2Gate)} ER=${gatePReason(erQ2Gate)}`,
        tIv: null, ivRelay5Ua: null, erRelay5Ua: null, deltaUa: null, minDecisionUa: null,
      });
      continue;
    }
    const pIv = deriveCounterProfile(lCoilUh, zero, refDoc);
    const pEr = deriveCounterProfile(lCoilUh, zero, refDoc);
    if (pIv.derived.relayPullInUa[4] !== COUNTER_T_UA || pEr.derived.relayPullInUa[4] !== COUNTER_T_UA) {
      throw new Error('Wave C source-integrity failure: Q2 Z relay-5 threshold differs from pinned T');
    }
    const ivStamp = stampForState('IV-EXP1', q2State, pIv);
    const erStamp = stampForState('ER-ALTCOUNTER', q2State, pEr);
    const ivEnv = makeEnv(pIv, null);
    const erEnv = makeEnv(pEr, null);
    const ivCarried = coldStart(ivStamp.els, ivEnv);
    const erCarried = coldStart(erStamp.els, erEnv);
    const cap = ivEnv.capTicks < erEnv.capTicks ? ivEnv.capTicks : erEnv.capTicks;
    let comparison: Q2ComparisonRow | null = null;
    for (let tick = 1; tick <= cap; tick++) {
      const ivTick = tickSolve(ivStamp.els, ivCarried, ivEnv.cfg);
      const erTick = tickSolve(erStamp.els, erCarried, erEnv.cfg);
      if (ivTick.nonPortable || erTick.nonPortable) {
        throw new Error(`Wave C infrastructure failure: non-portable arithmetic in C-Q2 L=${lCoilUh}`);
      }
      const ivRelay5Ua = Math.abs(ua(ivEnv, ivTick.branchI[16] as number));
      const erRelay5Ua = Math.abs(ua(erEnv, erTick.branchI[16] as number));
      if (ivRelay5Ua >= COUNTER_T_UA) {
        comparison = {
          lCoilUh, status: 'VALUE', reason: null, tIv: tick, ivRelay5Ua, erRelay5Ua,
          deltaUa: erRelay5Ua - ivRelay5Ua, minDecisionUa: pIv.v.min_decision_ua,
        };
        break;
      }
    }
    q2Comparisons.push(comparison ?? {
      lCoilUh, status: 'NO_CROSSING', reason: 'IV relay 5 did not cross T before settle_cap_us',
      tIv: null, ivRelay5Ua: null, erRelay5Ua: null, deltaUa: null, minDecisionUa: null,
    });
  }
  const q2PredicatesPass = q2Structural.every((r) => r.status === 'VALUE' && r.inDatum === r.expectedInDatum) &&
    q2Comparisons.every((r) => r.status === 'VALUE' && (r.deltaUa as number) > (r.minDecisionUa as number));
  const q2Aggregate = counterAggregate(
    [...q2Structural, ...q2Comparisons].map((r) => r.status),
    q2PredicatesPass,
    'a C-Q2 datum membership mismatched or a numeric delta was not strictly greater than min_decision_ua',
  );

  // C0 after hashes: a completed result exists only after both files still match their registered
  // bytes and their before values.
  const refAfterBytes = readFileSync(COUNTER_REF_JSON);
  const idealAfterBytes = readFileSync(COUNTER_IDEAL_JSON);
  const refAfter = requireRegisteredFile('MV601-REF-A.json after', refAfterBytes, COUNTER_FILES.ref);
  const idealAfter = requireRegisteredFile('MV601-IDEAL.json after', idealAfterBytes, COUNTER_FILES.ideal);
  if (refAfter !== refBefore || idealAfter !== idealBefore) {
    throw new Error('Wave C profile-integrity failure: before/after MD5 differs');
  }

  const outcome = counterOutcome(boundAggregate.status, q1Aggregate.status, q2Aggregate.status);
  return {
    sources: [
      { id: 'IV-EXP1', count: iv.count, bytes: iv.bytes, md5: iv.md5 },
      { id: 'ER-ALTCOUNTER', count: er.count, bytes: er.bytes, md5: er.md5 },
      { id: 'programs.md', count: null, bytes: programsBytes.byteLength, md5: programsMd5 },
    ],
    profileHashes: { refBefore, refAfter, idealBefore, idealAfter },
    nominalPullInUa: COUNTER_T_UA,
    gateT, gateP: gatePRows, boundMargins, sourceCurrents, sourceMaxima,
    q1Deltas, q1CountZero, q2Structural, q2Comparisons,
    boundAggregate, q1Aggregate, q2Aggregate, outcome,
  };
}

function relayOperatedInMask(mask: string, relay: number): boolean {
  return mask[6 - relay] === '1';
}

function statusValue(x: number | null): string {
  return x === null ? 'N/A' : String(x);
}

function refusalText(refusals: readonly GatePRefusal[]): string {
  return refusals.length === 0 ? '-' : refusals.map((r) =>
    `members={${r.members.join(' ')}} coils={${r.coils.join(' ')}}`).join(' ; ');
}

/** The complete deterministic report, in the exact section/table order frozen for Wave C. */
export function formatCounterReport(r: CounterReport): string {
  const out: string[] = [];
  out.push('WAVE C SOURCE INTEGRITY');
  for (const s of r.sources) {
    out.push(`SOURCE id=${s.id} count=${s.count === null ? 'N/A' : s.count} bytes=${s.bytes} md5=${s.md5}`);
  }
  out.push('');
  out.push('WAVE C PROFILE INTEGRITY');
  out.push(`PROFILE id=MV601-REF-A before=${r.profileHashes.refBefore} after=${r.profileHashes.refAfter}`);
  out.push(`PROFILE id=MV601-IDEAL before=${r.profileHashes.idealBefore} after=${r.profileHashes.idealAfter}`);
  out.push(`PINNED nominalPullInUa=${r.nominalPullInUa}`);
  out.push('');
  out.push('GATE T');
  const gateTGroups = [
    { label: 'P/PLUS', member: 'PLUS' },
    { label: 'D/DATUM', member: 'MINUS' },
    { label: 'Q/canonical-3A', member: '3A' },
    { label: 'D17', member: 'D17' },
    { label: 'D18', member: 'D18' },
    { label: 'D19', member: 'D19' },
  ];
  for (const group of gateTGroups) {
    const members = r.gateT.members.find((x) => x.includes(group.member));
    if (members === undefined) throw new Error(`Wave C report: Gate T partition ${group.label} missing`);
    out.push(
      `GATE-T PARTITION ${group.label}={` +
      `${members.filter((x) => x !== 'PLUS' && x !== 'MINUS').join(' ')}}`,
    );
  }
  for (let i = 0; i < r.gateT.elements.length; i++) {
    const e = r.gateT.elements[i] as StampElement;
    out.push(`GATE-T ELEMENT row=${i + 1} id=${e.id} kind=${e.kind} ${e.a}->${e.b}`);
  }
  for (const c of r.gateT.contacts) {
    out.push(
      `GATE-T CONTACT id=${c.id} arm=${c.arm} active=${c.activeTerminal} inactive=${c.inactiveTerminal}`,
    );
  }
  out.push(`GATE-T RESULT ${r.gateT.violations.length === 0 ? 'PASS' : 'FAIL'}`);
  out.push('');
  out.push('GATE P CENSUS (34 rows)');
  for (const q of r.gateP) {
    out.push(`GATE-P program=${q.program} case=${q.case} event=${q.event} mask=${q.mask} status=${q.status} ${refusalText(q.refusals)}`);
  }
  out.push('');
  out.push('C-B EXPECTED-MARGIN TABLE (192 rows)');
  for (const q of r.boundMargins) {
    out.push(
      `C-B-MARGIN L_coil_uh=${q.lCoilUh} case=${q.case} event=${q.event} mask=${q.mask} ` +
      `relay=${q.relay} expected=${q.expectedOperated ? 'OPERATED' : 'RELEASED'} status=${q.status} ` +
      `currentUa=${statusValue(q.currentUa)} thresholdUa=${statusValue(q.thresholdUa)} ` +
      `marginUa=${statusValue(q.marginUa)} reason=${q.reason ?? '-'}`,
    );
  }
  out.push('C-B SOURCE-CURRENT TABLE (32 rows)');
  for (const q of r.sourceCurrents) {
    out.push(
      `C-B-SOURCE L_coil_uh=${q.lCoilUh} case=${q.case} event=${q.event} mask=${q.mask} ` +
      `status=${q.status} currentUa=${statusValue(q.currentUa)} reason=${q.reason ?? '-'}`,
    );
  }
  out.push('C-B SOURCE MAXIMA (2 rows)');
  for (const q of r.sourceMaxima) {
    out.push(
      `C-B-MAX L_coil_uh=${q.lCoilUh} status=${q.status} maximumUa=${statusValue(q.maximumUa)} ` +
      `boundUa=${COUNTER_SOURCE_BOUND_UA} predicate=< reason=${q.reason ?? '-'}`,
    );
  }
  out.push(`C-B AGGREGATE status=${r.boundAggregate.status} reason=${r.boundAggregate.reason}`);
  out.push('');
  out.push('C-Q1 COUNT-0 N/A ROWS (8 rows)');
  for (const q of r.q1CountZero) {
    out.push(`C-Q1-COUNT0 L_coil_uh=${q.lCoilUh} vector=${q.vector} count=0 status=${q.status} deltaUa=N/A reason=${q.reason ?? '-'}`);
  }
  out.push('C-Q1 DELTA TABLE (96 rows)');
  for (const q of r.q1Deltas) {
    out.push(
      `C-Q1 L_coil_uh=${q.lCoilUh} vector=${q.vector} count=${q.count} pair=${q.evenRelay}/${q.oddRelay} ` +
      `status=${q.status} evenMarginUa=${statusValue(q.evenMarginUa)} oddMarginUa=${statusValue(q.oddMarginUa)} ` +
      `deltaUa=${statusValue(q.deltaUa)} minDecisionUa=${statusValue(q.minDecisionUa)} reason=${q.reason ?? '-'}`,
    );
  }
  out.push(`C-Q1 AGGREGATE status=${r.q1Aggregate.status} reason=${r.q1Aggregate.reason}`);
  out.push('');
  out.push('C-Q2 STRUCTURAL TABLE (6 rows)');
  for (const q of r.q2Structural) {
    out.push(
      `C-Q2-STRUCT state=${q.state} pair=${q.oddRelay}/${q.evenRelay} terminal=${q.terminal} ` +
      `status=${q.status} inDatum=${q.inDatum === null ? 'N/A' : q.inDatum ? 'YES' : 'NO'} ` +
      `expected=${q.expectedInDatum ? 'YES' : 'NO'} reason=${q.reason ?? '-'}`,
    );
  }
  out.push('C-Q2 COMPARISON TABLE (2 rows)');
  for (const q of r.q2Comparisons) {
    out.push(
      `C-Q2-COMPARE L_coil_uh=${q.lCoilUh} status=${q.status} tIV=${statusValue(q.tIv)} ` +
      `ivRelay5Ua=${statusValue(q.ivRelay5Ua)} erRelay5Ua=${statusValue(q.erRelay5Ua)} ` +
      `deltaUa=${statusValue(q.deltaUa)} minDecisionUa=${statusValue(q.minDecisionUa)} reason=${q.reason ?? '-'}`,
    );
  }
  out.push(`C-Q2 AGGREGATE status=${r.q2Aggregate.status} reason=${r.q2Aggregate.reason}`);
  out.push('');
  out.push(`WAVE C OUTCOME: ${r.outcome}`);
  return out.join('\n') + '\n';
}

export interface CounterInvocation {
  exitCode: 0 | 1;
  text: string;
  report: CounterReport | null;
}

interface InvocationHashes {
  ref: string;
  ideal: string;
}

function invocationHashes(): InvocationHashes {
  return {
    ref: md5Bytes(readFileSync(COUNTER_REF_JSON)),
    ideal: md5Bytes(readFileSync(COUNTER_IDEAL_JSON)),
  };
}

function formatCounterInfrastructureFailure(
  before: InvocationHashes,
  after: InvocationHashes,
  error: string,
): string {
  return [
    'WAVE C PROFILE INTEGRITY',
    `PROFILE id=MV601-REF-A before=${before.ref} after=${after.ref}`,
    `PROFILE id=MV601-IDEAL before=${before.ideal} after=${after.ideal}`,
    `WAVE C INFRASTRUCTURE ERROR: ${error}`,
    '',
  ].join('\n');
}

/**
 * CLI boundary: the after hashes are captured even when threshold validation, Gate T, or a solve
 * throws. A profile changed during the invocation dominates the earlier error. Failure output has
 * no Gate P/scientific table and no outcome line.
 */
export function runCounterInvocation(options: CounterRunOptions = {}): CounterInvocation {
  const zeroHashes: InvocationHashes = { ref: '(unreadable)', ideal: '(unreadable)' };
  let report: CounterReport | null = null;
  let error: string | null = null;
  let before = zeroHashes;
  let after: InvocationHashes | null = null;
  // Reading the two profiles can itself fail (deleted, unreadable). That is an infrastructure
  // failure like any other and has to leave through the same report, not as a raw stack trace.
  try {
    before = invocationHashes();
    report = runCounter(options);
  } catch (caught: unknown) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    try {
      after = invocationHashes();
    } catch (caught: unknown) {
      after = zeroHashes;
      if (error === null) error = caught instanceof Error ? caught.message : String(caught);
    }
  }
  if (after === null) after = zeroHashes;
  const changedDuringRun = before.ref !== after.ref || before.ideal !== after.ideal;
  const newlyUnregistered =
    (before.ref === COUNTER_FILES.ref.md5 && after.ref !== COUNTER_FILES.ref.md5) ||
    (before.ideal === COUNTER_FILES.ideal.md5 && after.ideal !== COUNTER_FILES.ideal.md5);
  if (changedDuringRun || newlyUnregistered) {
    error =
      `Wave C profile-integrity failure: after hashes changed or left the registered values ` +
      `(REF ${before.ref} -> ${after.ref}; IDEAL ${before.ideal} -> ${after.ideal})`;
    report = null;
  }
  if (error !== null || report === null) {
    return {
      exitCode: 1,
      text: formatCounterInfrastructureFailure(before, after, error ?? 'Wave C ended without a report'),
      report: null,
    };
  }
  return { exitCode: 0, text: formatCounterReport(report), report };
}

// ===============================================================================================
// Wave D — the frozen relay-offset derivation and the live C-Z to D identity report.
// This is deliberately separate from Wave C's report and formatter.
// ===============================================================================================

const D_A_MV = 282;
const D_NEXT_A_MV = 283;
const D_AT01_SETTLED_UA = 46_218;
const D_FROZEN_MIN_DECISION_UA = 1_000;
const D_MAX_MIN_DECISION_UA = 1_005;
const D_OFFSETS_MV = [-282, -169, -56, 56, 169, 282] as const;
const D_PULL_IN_UA = [41_453, 42_207, 42_960, 43_707, 44_460, 45_213] as const;
const D_DROP_OUT_UA = [14_787, 15_540, 16_293, 17_040, 17_793, 18_547] as const;
const D_SOURCE_MINIMUM_UA = 16_027;
const D_MAX_THRESHOLD_DIFFERENCE_UA = 754;
const D_LOWER_BOUND_UA = 15_273;

export interface DSourceRow {
  key: string;
  lCoilUh: number;
  count: number;
  evenRelay: number;
  oddRelay: number;
  status: RowStatus;
  deltaUa: number | null;
}

export interface DIdentityRow extends DSourceRow {
  sourceStatus: RowStatus;
  sourceDeltaUa: number | null;
  thresholdDifferenceUa: number;
  deltaUa: number | null;
  minDecisionUa: number;
  pass: boolean;
}

export interface DReport {
  inputs: {
    VPullInMv: number;
    RCoilUohm: number;
    minDecisionUa: number;
    at01SettledUa: number;
  };
  aMv: number;
  offsetsMv: number[];
  pullInUa: number[];
  dropOutUa: number[];
  at01: {
    actual: { relay: 1; thresholdUa: number; marginUa: number; pass: boolean };
    max: { relay: 6; thresholdUa: number; marginUa: number; pass: boolean };
    next: { aMv: number; thresholdUa: number; marginUa: number; rejected: boolean };
  };
  sourceRows: DSourceRow[];
  rows: DIdentityRow[];
  aggregate: { status: 'PASS'; rows: 24 };
  secondaryBound: {
    sourceMinimumUa: number;
    maximumThresholdDifferenceUa: number;
    lowerBoundUa: number;
  };
}

/** W4 may lower or retain the live gate, but a value above the dated D bound reopens D. */
export function assertWaveDMinDecisionUa(candidateUa: number): number {
  if (!Number.isSafeInteger(candidateUa) || candidateUa < 0) {
    throw new Error('Wave D forward guard: min_decision_ua must be a non-negative safe integer');
  }
  if (candidateUa > D_MAX_MIN_DECISION_UA) {
    throw new Error(
      `Wave D forward guard: candidate min_decision_ua=${candidateUa} exceeds ${D_MAX_MIN_DECISION_UA}; ` +
      'reopen Wave D and return to Tom',
    );
  }
  return candidateUa;
}

function dIdentityKey(row: Pick<Q1DeltaRow, 'lCoilUh' | 'count' | 'evenRelay' | 'oddRelay'>): string {
  return `L_coil_uh=${row.lCoilUh}|count=${row.count}|pair=${row.evenRelay}/${row.oddRelay}`;
}

function requireExactNumbers(label: string, got: readonly number[], expected: readonly number[]): void {
  if (got.length !== expected.length || got.some((value, i) => value !== expected[i])) {
    throw new Error(`Wave D ${label} mismatch: got [${got.join(',')}], expected [${expected.join(',')}]`);
  }
}

/** Wave D's frozen sign-symmetric nearest-integer rounding of p/5. */
function dSround5(p: number): number {
  if (p === 0) return 0;
  const magnitude = Math.floor((2 * Math.abs(p) + 5) / 10);
  return p < 0 ? -magnitude : magnitude;
}

export function runD(): DReport {
  const profile = loadProfile(readDoc('MV601-REF-A.json'));
  const battery = runBattery(profile);
  // Wave D derived its vector from the dated 1,000-uA input. W4's measured live gate is a
  // separately checked forward guard; changing it must not rewrite the historical experiment.
  assertWaveDMinDecisionUa(profile.v.min_decision_ua);
  const inputs = {
    VPullInMv: profile.v.V_pullin_mv,
    RCoilUohm: profile.v.R_coil_uohm,
    minDecisionUa: D_FROZEN_MIN_DECISION_UA,
    at01SettledUa: battery.at01.coilUa,
  };
  if (inputs.VPullInMv !== 6500 || inputs.RCoilUohm !== 150_000_000 ||
      inputs.at01SettledUa !== D_AT01_SETTLED_UA) {
    throw new Error(
      `Wave D frozen-input mismatch: V_pullin_mv=${inputs.VPullInMv} ` +
      `R_coil_uohm=${inputs.RCoilUohm} min_decision_ua=${inputs.minDecisionUa} ` +
      `AT01=${inputs.at01SettledUa}`,
    );
  }
  const derivedOffsets = [1, 2, 3, 4, 5, 6].map((n) => dSround5((2 * n - 7) * D_A_MV));
  requireExactNumbers('rule output', derivedOffsets, D_OFFSETS_MV);
  requireExactNumbers('offset vector', profile.dVRelayMv, D_OFFSETS_MV);
  requireExactNumbers('pull-in thresholds', profile.derived.relayPullInUa, D_PULL_IN_UA);
  requireExactNumbers('drop-out thresholds', profile.derived.relayDropOutUa, D_DROP_OUT_UA);

  const actualThresholdUa = profile.derived.relayPullInUa[0] as number;
  const maxThresholdUa = profile.derived.relayPullInUa[5] as number;
  const nextThresholdUa = idivRound(
    (profile.v.V_pullin_mv + D_NEXT_A_MV) * 1_000_000_000,
    profile.v.R_coil_uohm,
  );
  const actualMarginUa = battery.at01.coilUa - actualThresholdUa;
  const maxMarginUa = battery.at01.coilUa - maxThresholdUa;
  const nextMarginUa = battery.at01.coilUa - nextThresholdUa;
  const at01 = {
    actual: {
      relay: 1 as const,
      thresholdUa: actualThresholdUa,
      marginUa: actualMarginUa,
      pass: battery.at01.pullsIn && battery.at01.holds && battery.at01.quiet && actualMarginUa === 4_765,
    },
    max: {
      relay: 6 as const,
      thresholdUa: maxThresholdUa,
      marginUa: maxMarginUa,
      pass: maxMarginUa === D_MAX_MIN_DECISION_UA,
    },
    next: {
      aMv: D_NEXT_A_MV,
      thresholdUa: nextThresholdUa,
      marginUa: nextMarginUa,
      rejected: nextMarginUa < D_FROZEN_MIN_DECISION_UA,
    },
  };
  if (!at01.actual.pass || !at01.max.pass || !at01.next.rejected || nextMarginUa !== 998) {
    throw new Error('Wave D D-AT01 assertion failed');
  }

  // Wave C is the live numeric authority. Filtering creates a new array and never mutates its
  // fixed 96-row result or formatter.
  const counter = runCounter();
  const zRows = counter.q1Deltas.filter((row) => row.vector === 'Z');
  if (zRows.length !== 24) throw new Error(`Wave D expected exactly 24 live C-Z rows, got ${zRows.length}`);
  const sourceRows: DSourceRow[] = zRows.map((row) => ({
    key: dIdentityKey(row),
    lCoilUh: row.lCoilUh,
    count: row.count,
    evenRelay: row.evenRelay,
    oddRelay: row.oddRelay,
    status: row.status,
    deltaUa: row.deltaUa,
  }));
  if (new Set(sourceRows.map((row) => row.key)).size !== 24) {
    throw new Error('Wave D C-Z identity keys contain a duplicate');
  }

  const rows: DIdentityRow[] = sourceRows.map((source) => {
    const thresholdDifferenceUa =
      (profile.derived.relayPullInUa[source.evenRelay - 1] as number) -
      (profile.derived.relayPullInUa[source.oddRelay - 1] as number);
    const deltaUa = source.status === 'VALUE' && source.deltaUa !== null
      ? source.deltaUa - thresholdDifferenceUa
      : null;
    return {
      ...source,
      sourceStatus: source.status,
      sourceDeltaUa: source.deltaUa,
      thresholdDifferenceUa,
      deltaUa,
      minDecisionUa: inputs.minDecisionUa,
      pass: source.status === 'VALUE' && deltaUa !== null && deltaUa > inputs.minDecisionUa,
    };
  });
  const rowKeys = rows.map((row) => row.key);
  if (rows.length !== 24 || new Set(rowKeys).size !== 24 ||
      rowKeys.some((key, i) => key !== (sourceRows[i] as DSourceRow).key) ||
      rows.some((row, i) => row.status !== (sourceRows[i] as DSourceRow).status)) {
    throw new Error('Wave D row cardinality/key/status identity failed');
  }
  const thresholdDifferences = new Map<string, number>([
    ['6/5', 753], ['4/3', 747], ['2/1', 754],
  ]);
  for (const row of rows) {
    const expected = thresholdDifferences.get(`${row.evenRelay}/${row.oddRelay}`);
    if (expected === undefined || row.thresholdDifferenceUa !== expected || !row.pass) {
      throw new Error(`Wave D delta identity failed for ${row.key}`);
    }
  }
  const sourceMinimumUa = Math.min(...sourceRows.map((row) => row.deltaUa as number));
  const maximumThresholdDifferenceUa = Math.max(...rows.map((row) => row.thresholdDifferenceUa));
  const lowerBoundUa = sourceMinimumUa - maximumThresholdDifferenceUa;
  if (sourceMinimumUa !== D_SOURCE_MINIMUM_UA ||
      maximumThresholdDifferenceUa !== D_MAX_THRESHOLD_DIFFERENCE_UA ||
      lowerBoundUa !== D_LOWER_BOUND_UA || lowerBoundUa <= inputs.minDecisionUa) {
    throw new Error(
      `Wave D secondary bound mismatch: ${sourceMinimumUa}-${maximumThresholdDifferenceUa}=${lowerBoundUa}`,
    );
  }

  return {
    inputs,
    aMv: D_A_MV,
    offsetsMv: [...profile.dVRelayMv],
    pullInUa: [...profile.derived.relayPullInUa],
    dropOutUa: [...profile.derived.relayDropOutUa],
    at01,
    sourceRows,
    rows,
    aggregate: { status: 'PASS', rows: 24 },
    secondaryBound: { sourceMinimumUa, maximumThresholdDifferenceUa, lowerBoundUa },
  };
}

export function formatDReport(r: DReport): string {
  const out: string[] = [];
  out.push('WAVE D FROZEN INPUTS');
  out.push(`INPUT V_pullin_mv=${r.inputs.VPullInMv}`);
  out.push(`INPUT R_coil_uohm=${r.inputs.RCoilUohm}`);
  out.push(`INPUT min_decision_ua=${r.inputs.minDecisionUa}`);
  out.push(`INPUT AT01_settled_coil_ua=${r.inputs.at01SettledUa}`);
  out.push('');
  out.push('WAVE D VECTOR AND DERIVED THRESHOLDS');
  out.push(`D-RULE A_mv=${r.aMv} offsets_mv=[${r.offsetsMv.join(',')}]`);
  out.push(`D-RULE relayPullInUa=[${r.pullInUa.join(',')}]`);
  out.push(`D-RULE relayDropOutUa=[${r.dropOutUa.join(',')}]`);
  out.push('');
  out.push(
    `D-AT01-ACTUAL relay=${r.at01.actual.relay} thresholdUa=${r.at01.actual.thresholdUa} ` +
    `marginUa=${r.at01.actual.marginUa} result=${r.at01.actual.pass ? 'PASS' : 'FAIL'}`,
  );
  out.push(
    `D-AT01-MAX relay=${r.at01.max.relay} thresholdUa=${r.at01.max.thresholdUa} ` +
    `marginUa=${r.at01.max.marginUa} result=${r.at01.max.pass ? 'PASS' : 'FAIL'}`,
  );
  out.push(
    `D-AT01-NEXT A=${r.at01.next.aMv} thresholdUa=${r.at01.next.thresholdUa} ` +
    `marginUa=${r.at01.next.marginUa} result=${r.at01.next.rejected ? 'REJECTED' : 'FAIL'}`,
  );
  out.push('');
  out.push('D/C-Q1 IDENTITY TABLE (24 rows)');
  for (const row of r.rows) {
    out.push(
      `D/C-Q1 key=${row.key} sourceStatus=${row.sourceStatus} dStatus=${row.status} ` +
      `sourceDeltaUa=${statusValue(row.sourceDeltaUa)} ` +
      `thresholdDifferenceUa=${row.thresholdDifferenceUa} deltaUa=${statusValue(row.deltaUa)} ` +
      `minDecisionUa=${row.minDecisionUa} predicate=> result=${row.pass ? 'PASS' : 'FAIL'}`,
    );
  }
  out.push(`D/C-Q1 AGGREGATE status=${r.aggregate.status} rows=${r.aggregate.rows}`);
  out.push(
    `D/C-Q1 SECONDARY BOUND sourceMinimumUa=${r.secondaryBound.sourceMinimumUa} ` +
    `maximumThresholdDifferenceUa=${r.secondaryBound.maximumThresholdDifferenceUa} ` +
    `lowerBoundUa=${r.secondaryBound.lowerBoundUa} predicate=>${r.inputs.minDecisionUa} result=PASS`,
  );
  return out.join('\n') + '\n';
}

/**
 * Run as a script, not when imported. `test/check-profile.spec.ts` imports `runAll` and asserts on
 * the report, because a gate nothing executes buys confidence it has not earned: a passing suite
 * that silently omits the file under test is worse than a failing one.
 */
const argv1 = process.argv[1];
if (argv1 !== undefined && argv1.endsWith('check-profile.ts')) {
  if (process.argv.includes('--d')) {
    process.stdout.write(formatDReport(runD()));
  } else if (process.argv.includes('--counter')) {
    const invocation = runCounterInvocation();
    process.stdout.write(invocation.text);
    process.exitCode = invocation.exitCode;
  } else {
    process.stdout.write(formatReport(runAll()));
  }
}
