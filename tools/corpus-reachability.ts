/**
 * `tools/corpus-reachability.ts` — the corpus census behind `test/solve.spec.ts`'s
 * `DEFECT (O-E11)` `it.fails`.
 *
 *   npm run check-reachability        (node 26; type stripping, no build step)
 *
 * It is the permanent O-E11 regression (`docs/DECISIONS.md`, *2026-08-31 — O-E11 arc-pass
 * latch*): it stamps its own element arrays for each published program and drives them through
 * `tickSolve`, independently of `graph.ts`. `test/corpus-reachability.spec.ts` runs it on every
 * `npm test`, and `test/extract-corpus.spec.ts` reuses its `parsePrograms`.
 *
 * ================================================================================================
 * WHAT THE FIRST VERSION OF THIS FILE CLAIMED, AND WHY THE CLAIM IS WITHDRAWN
 * ================================================================================================
 *
 * It claimed the O-E11 latch is UNREACHABLE — that over the published corpus no configuration puts
 * two coils in series through a bare node at mismatched currents. **That claim is false.** Two
 * defects in this tool produced it, and both are fixed below:
 *
 *   1. THE PREDICATE RAN ON THE WRONG NETLIST. The arc pass runs during architecture §4.3's
 *      both-open transfer window, on the TRANSFER netlist. The census evaluated `bareTwoCoilNodes`
 *      only on the LANDED netlist, after the armature had already closed the other contact set. On
 *      the transfer netlist the state occurs even with at most one button down: 80 configurations
 *      across `II-FF1` — the corpus's own primary timing fixture — `V-EXP10`, `V-EXP13` and
 *      `V-SUPERCIRCUIT`.
 *   2. AT MOST ONE PUSHBUTTON COULD EVER BE DOWN. `build()` took a scalar `pb`. `I-EXP4` (tier A,
 *      `[verified]` from a 500 dpi crop of `book1.pdf` p.12) prints "Push down both pushbutton 1
 *      and pushbutton 2 at the same time and see light 2 go ON", and `I-EXP5` prints the same for
 *      the OR circuit. `pb` is now a 6-bit mask and all 64 combinations are swept.
 *
 * A third defect moved every count: the reachability filter compared BOTH relay senses against
 * pull-in, so every relay legitimately holding in §4.3's hysteresis band was discarded as
 * unreachable. An operated relay holds down to DROP-OUT (§4.3's `dir` ladder), and it now does.
 *
 * ================================================================================================
 * THE INVARIANT THIS FILE NOW GATES — a measured bound with a stated margin, not "harmless"
 * ================================================================================================
 *
 * The state the defect needs IS reached. What is true, and what the gate asserts, is the next
 * question down: **does reaching it change what any relay does?**
 *
 *   over every reachable configuration, after §4.3's both-open window and after the armature lands
 *   and the circuit settles, NO coil's §4.3 direction decision differs from the landed netlist's
 *   own DC solution — and the worst settled coil error stays under `COIL_ERR_BOUND_A`.
 *
 * Measured (see `test/corpus-reachability.spec.ts` for the pinned numbers): on the shipped axes —
 * at most one button down — the state is reached and nothing latches at all, because 12 ticks is
 * too short for the wrong attractor to establish and the landed netlist then converges. With
 * simultaneous presses a small number of configurations carry a PERMANENT coil-current error, and
 * the worst of those is single-digit milliamps against a 43.333 mA pull-in.
 *
 * **That margin is real but it is not large, and it is not guaranteed under a different
 * `dV_relay_mv` or `L_coil`.** Both remain `[unverified]`; W1b completed with 1.2 H and Wave D's
 * checked-in D vector is the current sensitivity. Nothing here says the defect is harmless; it
 * says the defect is bounded at these constants, and prints the number so a later change has to
 * re-run the measurement.
 *
 * ================================================================================================
 * WHICH CONSTANTS — the guard in section 0, and the one override
 * ================================================================================================
 *
 * "at these constants" was, until the guard below existed, a claim nothing checked. The physics
 * here is imported from `test/mv601-ref.ts`, whose own header says its `L_COIL` is the solver
 * KAT's arbitrary test vector and is NOT `L_coil_uh` — so the bound above was being measured at a
 * W1a fixture value. It happens to equal the shipped one today. `verifyRefConstants` re-reads
 * `data/profiles/MV601-REF-A.json` on every run and fails, by name, the moment it stops doing so;
 * This guard was added before W1b's now-completed `L_coil_uh` selection so that change could not
 * leave the census measuring a stale fixture value.
 *
 * `MINIVAC_L_COIL_H=<henries>` sweeps the census across §4.4's 0.9-1.5 H band without editing the
 * KAT. The guard steps aside for `L_COIL` alone, the report wears a banner saying the run is not
 * the shipped configuration, and nothing else changes.
 *
 * ================================================================================================
 * WHAT IT MEASURES, STEP BY STEP
 * ================================================================================================
 *
 * For every program `docs/research/programs.md` states a parseable wire list for, every relay
 * state, all 64 pushbutton combinations and both slide positions:
 *
 *   1. build the panel netlist from the wire list and the fixed components of `jack-map.md` §5;
 *   2. DC-solve it with the coils as plain 150 Ω resistors — a settled, KCL-consistent start;
 *   3. keep only SELF-CONSISTENT before-states, where every relay's marked position is one §4.3's
 *      own hysteresis ladder would hold: a relay marked RELEASED needs its coil below pull-in, a
 *      relay marked OPERATED needs its coil above drop-out. That is this file's reachability
 *      criterion, and it is the whole reason the census means anything: an arbitrary relay mask is
 *      not a state the machine can sit in;
 *   4. put ONE relay into §4.3's both-open transfer window and hold it there for 12 ticks on the
 *      shipped `tickSolve`, asking on every tick — on the TRANSFER netlist, which is what the arc
 *      pass sees — whether there is a node carrying **exactly two coils and nothing else**, at
 *      **different** currents;
 *   5. close that relay's other contact set and ask the same question of the LANDED netlist;
 *   6. wherever either answer is yes, settle the landed netlist for `SETTLE_TICKS` and compare
 *      every coil against that netlist's own DC solution — the answer with no defect in it.
 *
 * Both axes are reported: all 64 button combinations, and the 0-or-1-button subset the withdrawn
 * numbers were measured on. The comparison is what makes the correction legible.
 *
 * The two shapes a bare two-coil node can take are different physics and are counted separately
 * (see `bareTwoCoilNodes`): a SERIES pair, which is the defect's own shape, and a STRANDED pair,
 * which is the open-release case the arc pass already exists to handle and gets right.
 *
 * THE 12 TICKS. §4.3's `breakMilli` = 450 and `makeMilli` = 550 leave 100 milli-travel with both
 * contacts open, and a 120-tick operate stroke covers 1000 milli, so the window is 12 ticks.
 *
 * PROVENANCE. Ported from the Wave A bench's `corpus.ts`, which found and fixed four defects in the
 * first attempt's parser. All four fixes are carried over below, with their reasoning, as D1-D4.
 * That bench cross-checked this panel netlist element-for-element against `jack-map.md` over 88,200
 * configurations with 0 mismatches, and an independent re-derivation by a second agent agreed with
 * its parse exactly.
 *
 * READ-ONLY, AT RUN TIME. `docs/research/programs.md` and `docs/research/jack-map.md` are read on
 * every run and never written. Editing a wire list therefore re-runs the census against the edit,
 * which is the point — and `violations()` itself pins the parse census and a digest of every
 * parsed wire, so a research edit that drops a program, rewrites a wire or corrupts a stated count
 * fails **this tool's own exit code**, not only the vitest spec that imports it.
 *
 * REPRODUCIBLE. This is a tool, so architecture §12's determinism rules do not bind it — but the
 * output is a regression baseline, so it must be byte-identical run to run. Nothing on the stdout
 * path reads a clock, calls `Math.random`, or iterates a `Map` or a `Set`; per-program tallies are
 * arrays indexed by parse order and every printed list is explicitly sorted. The elapsed time goes
 * to **stderr** for exactly this reason.
 *
 * DELIBERATELY OMITTED, each stated rather than assumed — inherited from the bench, unchanged:
 *
 *   THE SIX CAPACITORS. W1 has no capacitor element, and at DC and over one tick a capacitor is an
 *   open circuit, so omitting it is right for what this measures. The consequence is topological:
 *   `ncap` is left as an isolated junction, so a program returning a coil through `ncap` reads here
 *   as an open node rather than as a node tied to MINUS through a capacitor. No program in the
 *   parsed set does that; if a later criterion is sensitive to it, this is where to look.
 *
 *   R1 = 22 Ω, motor = 22 Ω, R2 = 33 Ω are `tools/gen-solver-kat.ts`'s PLACEHOLDER values, not
 *   profile keys — architecture §5 says no manual states them and W1b pins the real ones. Nothing
 *   here is evidence about them, and no result below turns on them: they sit on the motor branch,
 *   which no coil node touches.
 *
 *   LAMPS ARE FIXED WARM RESISTORS at `tungsten(46 mA)`, not `lamp` elements. The DC pre-solve
 *   needs a resistance anyway and a 12-tick probe gives the filament nothing to relax toward.
 *   Consequence: the lamp PWL is never exercised here. `test/solve.spec.ts` covers it with real
 *   carried state.
 *
 *   THE WIPER SITS AT D0. It is a free parameter; the bench found no program's arming decision
 *   changed across the positions it tried. Named as a constant rather than buried.
 *
 *   `dV_relay_mv` IS NOT APPLIED. The thresholds below are the nominal ones, the same for all six
 *   relays. The checked-in Wave D vector remains `[unverified]`, so the permanent acceptance gate
 *   stays on nominal Z by Tom's ruling; `--d` runs it as a separately guarded sensitivity. What
 *   this costs is named: an indexed threshold can decide differently near the line, and the
 *   ordinary report's headroom is nominal headroom.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { quantize } from '../src/core/ints.ts';
import { loadProfile } from '../src/core/profile.ts';
import type { Profile } from '../src/core/profile.ts';
import { tickSolve } from '../src/core/solve.ts';
import type { Carried, El, SolveCfg } from '../src/core/solve.ts';
import { DT_S, GMIN_S, I_HOT, I_PULLIN, K_THERMAL, L_COIL, R_COIL, R_COLD, R_HOT, R_SRC, V_ARC, V_OC, makePwl, tungsten } from '../test/mv601-ref.ts';

const PROGRAMS_MD = new URL('../docs/research/programs.md', import.meta.url);
const JACK_MAP_MD = new URL('../docs/research/jack-map.md', import.meta.url);

/**
 * The shipped profile, re-read on every run.
 *
 * `MV601-REF-A` is architecture §11's default — the marginal machine, the one `check-profile`
 * gates and the one every published figure is measured on. `MV601-IDEAL` is the control.
 */
export const SHIPPED_PROFILE_JSON = new URL('../data/profiles/MV601-REF-A.json', import.meta.url);

/** Architecture §4.3: (makeMilli 550 - breakMilli 450) milli over a 120-tick / 1000-milli stroke. */
export const BOTH_OPEN_TICKS = 12;

/** The rotary wiper position every configuration is built at. See the header. */
export const WIPER = 0;

/**
 * Ticks the LANDED netlist is settled for before its coils are compared against its own DC answer.
 *
 * The coil time constant is `L_coil / R_coil` = 8 ms = 80 ticks, so this is ~37 τ. It is a settling
 * budget and not a tuned number, and `CensusOpts.settleTicks` exists so that can be checked rather
 * than asserted. Measured on V-EXP9, the one program that latches (`test/corpus-reachability.spec.ts`
 * pins this): at 3,000 and at 12,000 ticks the answer is identical to every printed digit — 96
 * latched, worst error 3.04101 mA — while 100 and 300 are still transient (160 latched, 23.8101 and
 * 3.07364 mA). So 3,000 is past convergence rather than at it. **The decision flip count is 0 at
 * every budget tried, transient ones included**, which is the part the ruling rests on.
 */
export const SETTLE_TICKS = 3000;

/**
 * `dropOutUa` at nominal, in amps: architecture §4.4's `idivRound(V_dropout_mv * 1e9,
 * R_coil_uohm)` = `idivRound(2500 * 1e9, 150e6)` = 16,667 µA. `V_dropout_mv` is `[unverified]` —
 * `components.md` §8.2's ratio 0.38 of pull-in, from BK7 p.6's qualitative "great difference".
 *
 * It is here because §4.3 holds an OPERATED relay down until drop-out, not until pull-in, and the
 * reachability filter below has to use the same ladder the simulator does or it discards states the
 * machine can actually sit in.
 */
export const I_DROPOUT = 16_667e-6;

/**
 * The current above which two coils on a bare node count as MISMATCHED, in amps.
 *
 * Architecture §3.5 quantizes coil current to microamps, so a two-coil node mismatched by less than
 * 1 µA is mismatched by less than the model can express. It is not an invented epsilon and it is
 * not tuned to the answer.
 */
export const SERIES_BOUND_A = 1e-6;

/**
 * The bound the worst settled coil error is gated at, in amps.
 *
 * **This is a regression tripwire, not a physical tolerance and not a safety claim.** The rule that
 * sets it is stated so it cannot be quietly refitted: the next whole milliamp above the measured
 * worst. The load-bearing gate is `decisionFlips === 0` — the error moves no relay — and the number
 * this bound sits above is printed in the report next to its share of the 43.333 mA pull-in, so a
 * change of constants that grows it has to walk past the figure.
 */
export const COIL_ERR_BOUND_A = 4e-3;

/** The two threshold selections in the Wave D endpoint sensitivity. */
export type ThresholdSetName = 'Z' | 'D';

/**
 * One indivisible selection for every place the reachability census makes a relay decision.
 * Arrays and the containing object are frozen so pull-in and drop-out cannot be applied piecemeal.
 */
export interface ThresholdSet {
  readonly name: ThresholdSetName;
  readonly pullInUa: readonly number[];
  readonly dropOutUa: readonly number[];
}

function thresholdSet(name: ThresholdSetName, pullInUa: readonly number[], dropOutUa: readonly number[]): ThresholdSet {
  if (pullInUa.length !== 6 || dropOutUa.length !== 6) {
    throw new Error(`reachability threshold set ${name}: expected six pull-in and six drop-out thresholds`);
  }
  // §4.3's ladder is only a ladder while drop-out sits below pull-in: `relayDirUa` returns operate
  // before it ever reaches the release test, so an inverted pair would silently make the hold band
  // empty and the reachability filter accept states the machine cannot sit in.
  for (let c = 0; c < 6; c++) {
    if (!((dropOutUa[c] as number) < (pullInUa[c] as number))) {
      throw new Error(`reachability threshold set ${name} relay=${c + 1}: dropOutUa=${dropOutUa[c]} is not below pullInUa=${pullInUa[c]}`);
    }
  }
  return Object.freeze({ name, pullInUa: Object.freeze([...pullInUa]), dropOutUa: Object.freeze([...dropOutUa]) });
}

/** Stable identical-relay acceptance baseline. This remains the ordinary gate's default. */
export const Z_THRESHOLD_SET = thresholdSet(
  'Z',
  [43_333, 43_333, 43_333, 43_333, 43_333, 43_333],
  [16_667, 16_667, 16_667, 16_667, 16_667, 16_667],
);

/** Wave D's frozen checked-in vector, derived in physical relay order 1..6. */
export const D_DV_RELAY_MV = Object.freeze([-282, -169, -56, 56, 169, 282]);

/** Wave D's frozen derived thresholds. They are guarded against the unchanged loaded profile. */
export const D_THRESHOLD_SET = thresholdSet(
  'D',
  [41_453, 42_207, 42_960, 43_707, 44_460, 45_213],
  [14_787, 15_540, 16_293, 17_040, 17_793, 18_547],
);

/** True when the supplied or shipped profile carries the permanent Wave D vector. */
export function shippedProfileUsesD(profile: Profile): boolean {
  return profile.dVRelayMv.length === D_DV_RELAY_MV.length &&
    profile.dVRelayMv.every((value, index) => value === D_DV_RELAY_MV[index]);
}

export interface ThresholdIntegrityRow {
  relay: number;
  selectedPullInUa: number;
  loadedPullInUa: number;
  selectedDropOutUa: number;
  loadedDropOutUa: number;
}

/** Six indexed rows / twelve independently checked scalars. Throws with the physical relay name. */
export function thresholdIntegrityRows(selected: ThresholdSet, loaded: Profile): ThresholdIntegrityRow[] {
  const rows: ThresholdIntegrityRow[] = [];
  for (let c = 0; c < 6; c++) {
    const relay = c + 1;
    const row = {
      relay,
      selectedPullInUa: selected.pullInUa[c] as number,
      loadedPullInUa: loaded.derived.relayPullInUa[c] as number,
      selectedDropOutUa: selected.dropOutUa[c] as number,
      loadedDropOutUa: loaded.derived.relayDropOutUa[c] as number,
    };
    if (row.selectedPullInUa !== row.loadedPullInUa) {
      throw new Error(`reachability threshold integrity relay=${relay}: selected pullInUa=${row.selectedPullInUa}, loaded indexed pullInUa=${row.loadedPullInUa}`);
    }
    if (row.selectedDropOutUa !== row.loadedDropOutUa) {
      throw new Error(`reachability threshold integrity relay=${relay}: selected dropOutUa=${row.selectedDropOutUa}, loaded indexed dropOutUa=${row.loadedDropOutUa}`);
    }
    rows.push(row);
  }
  return rows;
}

/** Rejects a non-D checked-in lineage before any D census result can be constructed. */
export function requireShippedDProfile(loaded: Profile): ThresholdIntegrityRow[] {
  if (!shippedProfileUsesD(loaded)) {
    throw new Error(
      `reachability D sensitivity: loaded ${loaded.id} dV_relay_mv=[${loaded.dVRelayMv.join(',')}], ` +
      `expected checked-in D=[${D_DV_RELAY_MV.join(',')}] before census`,
    );
  }
  return thresholdIntegrityRows(D_THRESHOLD_SET, loaded);
}

/**
 * Runtime backstop for callers that try to select thresholds independently at the filter and the
 * endpoint. Value equality is insufficient: both sites must receive the same immutable object.
 */
export function commonThresholdSet(selfConsistency: ThresholdSet, endpoint: ThresholdSet): ThresholdSet {
  if (selfConsistency !== endpoint) {
    throw new Error(`reachability threshold partial application: self-consistency=${selfConsistency.name}, endpoint=${endpoint.name}`);
  }
  return selfConsistency;
}

/** §3.5 quantized direction decision at one indexed relay. */
export function relayDirUa(uaAbs: number, selected: ThresholdSet, relayIndex: number): number {
  if (uaAbs >= (selected.pullInUa[relayIndex] as number)) return 1;
  if (uaAbs <= (selected.dropOutUa[relayIndex] as number)) return -1;
  return 0;
}

export interface CoilEndpointSample {
  relayIndex: number;
  gotA: number;
  wantA: number;
}

export interface PerturbedHeadroom {
  population: number;
  minimumA: number;
}

/** The executable Wave D perturbed-coil population and headroom expression. */
export function perturbedCoilHeadroom(samples: readonly CoilEndpointSample[], selected: ThresholdSet): PerturbedHeadroom {
  let population = 0;
  let minimumA = Number.POSITIVE_INFINITY;
  for (const sample of samples) {
    const got = Math.abs(sample.gotA);
    const want = Math.abs(sample.wantA);
    const err = Math.abs(got - want);
    if (!(err > SERIES_BOUND_A)) continue;
    const c = sample.relayIndex;
    const margin = Math.min(
      Math.abs(want - (selected.pullInUa[c] as number) / 1e6),
      Math.abs(want - (selected.dropOutUa[c] as number) / 1e6),
    );
    const headroom = margin - err;
    population++;
    if (headroom < minimumA) minimumA = headroom;
  }
  return { population, minimumA };
}

// =================================================================================================
// 0. THE DIVERGENCE GUARD — the census's constants against the shipped profile's
// =================================================================================================
//
// This file's physics comes out of `test/mv601-ref.ts`, and that file says of its own inductance:
// "This is an arbitrary test vector, NOT `L_coil_uh`" and "`data/kat/solver-kat.json` is NOT
// evidence about `L_coil`. Do not cite it as such." Every coil below is nevertheless built at it,
// because it is the only inductance the tool has, and the O-E11 bound this census produces is
// therefore measured at a W1a FIXTURE value rather than at the shipped constant.
//
// They agree today — 1.2 H on both sides, and so does every other constant here. W1b completed
// with that value; this guard prevents any later profile change from leaving the census measuring
// the fixture while `npm run check-reachability` continues to exit 0.
//
// So the constants are tied to the profile the same way the panel is tied to `jack-map.md`:
// re-read on every run, compared value for value, and a mismatch is a sentence and a non-zero
// exit rather than a silent measurement of the wrong machine.
//
// The comparison is EXACT — `!==`, no epsilon. Every profile value is an integer in a µ- or
// milli-unit (§10.1) and every conversion below divides it by a power of ten, which is correctly
// rounded, so the shipped side lands on exactly the double the `mv601-ref.ts` literal is. An
// epsilon here would only hide the divergence it exists to catch.

export function shippedProfile(): Profile {
  return loadProfile(JSON.parse(readFileSync(SHIPPED_PROFILE_JSON, 'utf8')));
}

/** The environment variable that overrides the census's coil inductance for one run. */
export const L_COIL_ENV = 'MINIVAC_L_COIL_H';

/**
 * The override, in henries, or `null` for the shipped configuration.
 *
 * It exists because §4.4's `L_coil` band is 0.9-1.5 H and sweeping it is a thing that has to be
 * done — and the only way to do it before was to edit `L_COIL` in `test/mv601-ref.ts` and revert,
 * which mutates the solver KAT's own frozen vector to move a census. One env var, read once, is
 * the whole mechanism: the guard steps aside for `L_COIL` alone while it is set, the report says
 * so at the top, and nothing else in the file changes.
 */
export function readLCoilOverride(env: Record<string, string | undefined> = process.env): number | null {
  const raw = env[L_COIL_ENV];
  if (raw === undefined || raw === '') return null;
  const h = Number(raw);
  if (!Number.isFinite(h) || h <= 0) {
    throw new Error(`corpus-reachability: ${L_COIL_ENV}="${raw}" is not a positive number of henries`);
  }
  return h;
}

/** Resolved once, at load. `null` IS the shipped configuration; a number is not. */
export const L_COIL_OVERRIDE_H = readLCoilOverride();

/** The inductance every coil in this census is built at. */
export const L_CENSUS_H = L_COIL_OVERRIDE_H ?? L_COIL;

/** One constant the census is built on, beside the shipped profile's own value for the quantity. */
interface RefRow {
  /** The name the census reads it by. */
  name: string;
  /** Where that name lives, so a divergence report says which file to edit. */
  where: string;
  code: number;
  shipped: number;
  unit: string;
  /** The profile key and the conversion, so it says where to look on the other side too. */
  from: string;
}

const REF = 'test/mv601-ref.ts';
const HERE = 'tools/corpus-reachability.ts';

/**
 * Every physical constant this census is built on that the profile has a value for.
 *
 * Nine are imported from `mv601-ref.ts` by name. Three more — `R_HOT`, `I_HOT`, `R_COLD` — arrive
 * through the imported `tungsten` and `makePwl`, which is where the census's lamps get their fixed
 * warm resistance, so a profile that re-measured the filament and left the KAT's law alone would
 * move every current here without moving anything the guard could see. `I_DROPOUT` is this file's
 * own, a hand-copy of §4.4's drop-out derivation, and it has the identical failure mode: it feeds
 * `relayDir`, which is what `decisionFlips` — the gate — is counted from.
 *
 * Not compared, and named rather than silently left out:
 *
 *   `R_CLAMP_LO` / `R_CLAMP_HI` are `R_COLD` and `2 * R_HOT` restated inside `mv601-ref.ts`; the
 *   profile has no keys of their own for them, and the two they are built from are checked.
 *
 *   `TAU_S` has a key but reaches the census only through `K_THERMAL`, which is compared as the
 *   derived double §3.4 actually carries.
 *
 *   `BOTH_OPEN_TICKS` looks like it should be `profile.ts`'s `bothOpenTicks`, and IS NOT. That
 *   helper measures the window during the RELEASE stroke and returns 8; the 12 here is the same
 *   100 milli of travel over the OPERATE stroke, which is the stroke the arc pass runs in. They
 *   are different quantities and comparing them would be a false alarm, not a check.
 *
 *   `SERIES_BOUND_A` and `COIL_ERR_BOUND_A` are this file's own thresholds — §3.5's µA
 *   quantization and a regression tripwire — and are not profile values at all.
 */
function refRows(p: Profile): RefRow[] {
  const v = p.v;
  return [
    { name: 'V_OC', where: REF, code: V_OC, shipped: v.V_oc_mv / 1e3, unit: 'V', from: 'V_oc_mv / 1e3' },
    { name: 'R_SRC', where: REF, code: R_SRC, shipped: v.R_src_uohm / 1e6, unit: 'ohm', from: 'R_src_uohm / 1e6' },
    { name: 'R_COIL', where: REF, code: R_COIL, shipped: v.R_coil_uohm / 1e6, unit: 'ohm', from: 'R_coil_uohm / 1e6' },
    { name: 'L_COIL', where: REF, code: L_COIL, shipped: v.L_coil_uh / 1e6, unit: 'H', from: 'L_coil_uh / 1e6' },
    { name: 'DT_S', where: REF, code: DT_S, shipped: v.tick_us / 1e6, unit: 's', from: 'tick_us / 1e6' },
    { name: 'V_ARC', where: REF, code: V_ARC, shipped: v.V_arc_clamp_mv / 1e3, unit: 'V', from: 'V_arc_clamp_mv / 1e3' },
    { name: 'GMIN_S', where: REF, code: GMIN_S, shipped: v.gmin_ns / 1e9, unit: 'S', from: 'gmin_ns / 1e9' },
    { name: 'I_PULLIN', where: REF, code: I_PULLIN, shipped: p.derived.pullInUa / 1e6, unit: 'A', from: '§4.4 derived pullInUa / 1e6' },
    { name: 'K_THERMAL', where: REF, code: K_THERMAL, shipped: p.derived.kThermal, unit: '', from: '§3.4 derived kThermal' },
    { name: 'R_HOT', where: REF, code: R_HOT, shipped: v.R_hot_uohm / 1e6, unit: 'ohm', from: 'R_hot_uohm / 1e6' },
    { name: 'I_HOT', where: REF, code: I_HOT, shipped: v.I_hot_ua / 1e6, unit: 'A', from: 'I_hot_ua / 1e6' },
    { name: 'R_COLD', where: REF, code: R_COLD, shipped: v.R_cold_uohm / 1e6, unit: 'ohm', from: 'R_cold_uohm / 1e6' },
    { name: 'I_DROPOUT', where: HERE, code: I_DROPOUT, shipped: p.derived.dropOutUa / 1e6, unit: 'A', from: '§4.4 derived dropOutUa / 1e6' },
  ];
}

/**
 * Re-read the shipped profile and check every constant the census is built on against it. Returns
 * the divergences, as sentences; an empty array is the pass. Nothing here mutates the profile.
 *
 * `overrideLH` is `L_COIL_OVERRIDE_H`: while it is set, `L_COIL` is expected to disagree — that is
 * what the override IS — so its row is skipped and every other row still bites.
 */
export function verifyRefConstants(p: Profile = shippedProfile(), overrideLH: number | null = L_COIL_OVERRIDE_H): string[] {
  const bad: string[] = [];
  for (const r of refRows(p)) {
    if (r.name === 'L_COIL' && overrideLH !== null) continue;
    if (r.code === r.shipped) continue;
    const u = r.unit === '' ? '' : ` ${r.unit}`;
    bad.push(
      `${r.where} ${r.name} = ${r.code}${u}, but ${p.id} says ${r.shipped}${u} (${r.from}) — ` +
      'the census would be measuring the O-E11 bound at a stale constant rather than at the shipped one',
    );
  }
  return bad;
}

// =================================================================================================
// 1. THE PARSER — and the four defects it fixes
// =================================================================================================
//
// D1 SILENT OVER-COLLECTION. The first attempt scooped every backticked `X/Y` token anywhere in a
//    program's section: prose, "Expected behaviour", errata discussion, per-line confidence tables.
//    Checked against each record's OWN stated wire count ("· 15 wires ·" in the metadata line), 38
//    of the 93 records that state one disagreed, the worst by more than a factor of two — V-EXP14
//    stated 60 and the old parser extracted 135, V-EXP9 stated 48 and it extracted 107. Fixed:
//    wires come only from markdown TABLE ROWS whose every non-empty cell is a single backticked
//    token, and the extracted count is then CHECKED against the record's stated count.
//
// D2 THE ERRATA TABLE WAS CONCATENATED WITH THE PRINTED ONE. Six records print the wire list twice
//    — as printed, then "Corrected wire list (errata ER-05: `1A/1C` -> `1A/1G`)". The old parser
//    merged both, so II-2BUTTONMEM ran as 16 wires including BOTH the wrong `1A/1C` and the right
//    `1A/1G`. Same for II-EXP6, III-RELAYAND, V-EXP9, V-EXP14, V-EXP16. Fixed: wire tables are kept
//    separate and the LAST table matching the stated count wins, which is the errata-applied one —
//    `programs.md`'s own header says the corpus is transcribed "with the errata applied".
//
// D3 PARTIAL PARSES WERE RUN AS IF COMPLETE. The three Maintenance Manual check circuits are
//    written for "a relay", with section-less designators (`+/H`, `X/E`, `F/-`). Only the few wires
//    that happen to carry a section number parse. The old parser built and reported on circuits
//    made of 4 of MM-RLY-CHECK's 13 wires, 4 of MM-SW-CHECK's 10 and 2 of MM-PB-CHECK's 5. Fixed: a
//    record whose wire table contains ANY cell the designator grammar rejects is SKIPPED, loudly.
//
// D4 TIC-TAC-TOE WAS INVISIBLE. The old parser matched `^### NAME —`; the corpus's centrepiece sits
//    under `## 1. Tic-Tac-Toe`, so it was never even considered. It is found here — and then
//    skipped, for the stated reason that two of its 72 wires (`M10/free*`, `M11/free**`) are
//    free-ended, which is a first-class simulator input the W1 element array cannot express.
//    **A stated skip is a fact; a silent one is a lie**, and this tool exists to be believed.
//
// D6 A RECORD'S WIRE TABLE IS NOT ALWAYS THE WHOLE CIRCUIT. Three Book VI records are printed as
//    ADDITIONS to `VI-SEQREC` rather than as circuits — each says so on its own line, "Requires
//    `VI-SEQREC` ...". The parser took the table at face value, so `VI-SECRETCODE` was censused as
//    a standalone 36-wire circuit when its own metadata line reads "36 + 38 = 74", and `VI-MAZE`
//    — which states no wire count, needs `VI-SEQREC`, and needs the free-ended play wire the W1
//    element array cannot express — was censused as the LAST table in the record, its three-wire
//    short-path variant. Neither circuit exists on any panel. That is D3's defect wearing a
//    different hat: a fragment run as if it were a program. Fixed the same way — a record that
//    names a prerequisite is SKIPPED, loudly, with the prerequisite named.
//
// D5 THE SECTION ALPHABET WAS `[A-Z]`, WHICH IS SIX LETTERS TOO MANY. `jack-map.md` §1 defines 20
//    section terminal letters; D, I, M, O, P and Q are deliberately absent. `[A-Z]` accepted `1D`,
//    `2M`, `3O`. Such a token names no panel terminal, so it was never interned, `find()` returned
//    `undefined`, and `uni()` wrote `parent[other] = undefined` — which an `Int32Array` stores as
//    **0, the PLUS terminal**. A single mistyped letter in a research file silently shorted a wire
//    to the rail, in a tool whose entire job is to be believed about that file. Fixed twice over:
//    the grammar is built from `SECTION_LETTERS` (so it is the same 20 letters `verifyJackMap`
//    re-reads from §1 on every run), and the interner is FROZEN after the panel is built, so any
//    designator that still reaches `term()` without a terminal throws by name instead of shorting.
const CELL = /^`([^`]+)`$/;

export interface Program {
  name: string;
  /** The wire count the record states about itself, or null if it states none. */
  stated: number | null;
  wires: readonly (readonly [string, string])[];
  /** Non-empty iff the record is unusable; the string says why. Never silent. */
  skip: string;
}

/** First-seen-order dedupe. `Set` would do it, but nothing on the stdout path iterates one. */
function uniq(xs: readonly string[]): string[] {
  const out: string[] = [];
  for (const x of xs) if (!out.includes(x)) out.push(x);
  return out;
}

export function parsePrograms(text = readFileSync(PROGRAMS_MD, 'utf8')): Program[] {
  interface Tbl { wires: [string, string][]; bad: string[] }
  interface Rec { name: string; stated: number | null; requires: string | null; tabs: Tbl[] }
  const recs: Rec[] = [];
  let cur: Rec | null = null;
  let tab: Tbl | null = null;
  for (const line of text.split('\n')) {
    const h = /^### ([A-Z0-9-]+) —/.exec(line);
    if (h !== null) { cur = { name: h[1] as string, stated: null, requires: null, tabs: [] }; recs.push(cur); tab = null; continue; }
    // D4: the centrepiece is a level-2 heading, not a level-3 one.
    if (/^## 1\. Tic-Tac-Toe/.test(line)) { cur = { name: 'VI-TICTACTOE', stated: null, requires: null, tabs: [] }; recs.push(cur); tab = null; continue; }
    if (/^## /.test(line)) { cur = null; continue; }
    if (cur === null) continue;
    const w = /·\s*(\d+)\s*wires?\s*·/.exec(line);
    if (w !== null && cur.stated === null) cur.stated = Number(w[1]);
    // D6: the record's own "Requires `X` ..." line. Exactly three carry one, all of them Book VI
    // additions to VI-SEQREC, and none of the three is a circuit on its own.
    const req = /^Requires\s+`([A-Z0-9-]+)`/.exec(line);
    if (req !== null && cur.requires === null) cur.requires = req[1] as string;
    if (!/^\s*\|/.test(line)) { tab = null; continue; }
    if (/^\s*\|[\s|:-]+\|\s*$/.test(line)) { tab = { wires: [], bad: [] }; continue; }
    if (tab === null) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length === 0) continue;
    // D1: a row is a wire row only if EVERY cell is a single backticked token. Prose rows, and the
    // per-line confidence tables that quote a wire beside a sentence, fall out here.
    if (!cells.every((c) => CELL.test(c))) { tab = null; continue; }
    if (tab.wires.length === 0 && tab.bad.length === 0) cur.tabs.push(tab);
    for (const cell of cells) {
      // Footnote markers ride on the token in the printed tables (`2T/1com*`). They are print, not
      // circuit; strip them. `M10/free*` still fails the grammar, which is the wanted outcome.
      const t = (CELL.exec(cell) as RegExpExecArray)[1]!.trim().replace(/\*+$/, '');
      const parts = t.split('/');
      if (parts.length !== 2) { tab.bad.push(t); continue; }
      const a = (parts[0] as string).trim();
      const b = (parts[1] as string).trim();
      if (DESIG.test(a) && DESIG.test(b)) tab.wires.push([a, b]);
      else tab.bad.push(t);
    }
  }
  const out: Program[] = [];
  for (const r of recs) {
    const cand = r.tabs.filter((t) => t.wires.length > 0 || t.bad.length > 0);
    if (cand.length === 0) { out.push({ name: r.name, stated: r.stated, wires: [], skip: 'no wire table in the record (prose-only)' }); continue; }
    // D2: the LAST table whose size matches the record's own stated count, which is the
    // errata-applied one where a record prints both.
    let pick = cand[cand.length - 1] as Tbl;
    if (r.stated !== null) {
      const m = cand.filter((t) => t.wires.length + t.bad.length === r.stated);
      if (m.length > 0) pick = m[m.length - 1] as Tbl;
    }
    // D6: a record printed as additions to another one is a fragment, not a program. Its wires are
    // kept so `wireDigest` still notices an edit to them; only the census skips it.
    if (r.requires !== null) {
      out.push({ name: r.name, stated: r.stated, wires: pick.wires, skip: `wire table is only the connections ADDED to ${r.requires}, not a standalone circuit` });
      continue;
    }
    // D3: any cell the grammar rejects makes the whole record unusable. A partial parse is not a
    // program, and running one is how the first attempt reported on 4 of 13 wires.
    if (pick.bad.length > 0) {
      const shown = uniq(pick.bad).slice(0, 4).join(' ');
      out.push({ name: r.name, stated: r.stated, wires: pick.wires, skip: `${pick.bad.length} of ${pick.wires.length + pick.bad.length} wires outside the designator grammar [${shown}]` });
      continue;
    }
    if (r.stated !== null && pick.wires.length !== r.stated) {
      out.push({ name: r.name, stated: r.stated, wires: pick.wires, skip: `wire count ${pick.wires.length} != the record's own stated ${r.stated}` });
      continue;
    }
    out.push({ name: r.name, stated: r.stated, wires: pick.wires, skip: '' });
  }
  return out;
}

/**
 * A digest of the corpus this run actually parsed: every record's name, its own stated wire count,
 * and its wires in order. Pinned in `EXPECTED_PARSE` and checked by `violations()`, so a rewritten
 * wire — which moves no count and so slips past every census number — fails the gate by name.
 *
 * Skip reasons are deliberately NOT digested: those strings are written in this file, and rewording
 * one should not read as a corpus edit.
 */
export function wireDigest(programs: readonly Program[]): string {
  const lines = programs.map((p) => `${p.name}|${p.stated === null ? '-' : p.stated}|${p.wires.map(([a, b]) => `${a}/${b}`).join(' ')}`);
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 16);
}

// =================================================================================================
// 2. THE FIXED PANEL, AND ITS RUN-TIME TIE TO jack-map.md
// =================================================================================================
//
// The tables below ARE the netlist the builder instantiates. `verifyJackMap` re-reads
// `jack-map.md` §4 and §5 on every run and checks them against the file, cell by cell, so an edit
// to the research package cannot silently invalidate the census. What is checked is the part the
// builder actually depends on: every component's terminal list, every movable contact's
// arm / rest / operated assignment, the two rail memberships, and §1's 20-letter section alphabet.
// The prose topology columns are not parsed and are not claimed to be.

interface FixedRow {
  /** The §5 "Component" cell, verbatim. */
  component: string;
  /** The §5 "Count" cell, verbatim. */
  count: string;
  /** The backticked tokens of the §5 "Terminals" cell, in order. `n` is the section template. */
  terminals: readonly string[];
}

const JACKMAP_5: readonly FixedRow[] = [
  { component: 'Binary output lamp *n*', count: '6', terminals: ['nA', 'nB'] },
  { component: 'Relay *n* indicator lamp', count: '6', terminals: ['nC', 'nE'] },
  { component: 'Relay *n* coil', count: '6', terminals: ['nE', 'nF'] },
  { component: 'Relay *n* transfer set 1', count: '6', terminals: ['nG', 'nH', 'nJ'] },
  { component: 'Relay *n* transfer set 2', count: '6', terminals: ['nK', 'nL', 'nN'] },
  { component: 'Pushbutton *n*', count: '6', terminals: ['nX', 'nY', 'nZ'] },
  { component: 'Slide switch *n* set 1', count: '6', terminals: ['nR', 'nS', 'nT'] },
  { component: 'Slide switch *n* set 2', count: '6', terminals: ['nU', 'nV', 'nW'] },
  { component: 'Capacitor *n*', count: '6', terminals: ['ncap'] },
  { component: 'Rotary wiper', count: '1', terminals: ['D16', 'D0', 'D15'] },
  { component: 'Drive motor', count: '1', terminals: ['D18', 'D19'] },
  { component: 'Resistor R1', count: '1', terminals: ['D17', 'D19'] },
  { component: 'Resistor R2', count: '1', terminals: ['D18', 'D19'] },
  { component: 'COMMON junction *n*', count: '6', terminals: ['ncom'] },
  { component: 'Matrix junction', count: '20', terminals: ['M1t', 'M9t', 'M1b', 'M9b', 'M10', 'M11'] },
  { component: 'Power supply', count: '1', terminals: [] },
];

/** The three transfer families, as §5's Topology column assigns them. `rest` = N.C. / LEFT. */
interface MoveRow { component: string; arm: string; rest: string; operated: string }
const JACKMAP_MOVABLE: readonly MoveRow[] = [
  { component: 'Relay *n* transfer set 1', arm: 'nH', rest: 'nJ', operated: 'nG' },
  { component: 'Relay *n* transfer set 2', arm: 'nL', rest: 'nN', operated: 'nK' },
  { component: 'Pushbutton *n*', arm: 'nY', rest: 'nZ', operated: 'nX' },
  { component: 'Slide switch *n* set 1', arm: 'nS', rest: 'nR', operated: 'nT' },
  { component: 'Slide switch *n* set 2', arm: 'nV', rest: 'nU', operated: 'nW' },
];

/**
 * §5's Rotary wiper topology, as the two clauses `build` actually implements: `uni(D16, D<wiper>)`
 * and nothing else. The terminal list alone does not pin this — `D16`, `D0`..`D15` would read the
 * same if the file started saying the fixed contacts are ganged — so the cell is checked as well.
 */
const ROTARY_TOPOLOGY: readonly RegExp[] = [
  /`D16` shorts to `DN` at position \*N\*/,
  /the 16 fixed contacts have no internal connection to one another/,
];

/** §4's two busses. The errata: all `+` terminals are one node, and all `-` terminals are another. */
const PLUS_MEMBERS = ['1+', '2+', '3+', '4+', '5+', '6+', 'M+'] as const;
const MINUS_MEMBERS = ['1-', '2-', '3-', '4-', '5-', '6-', 'M-'] as const;

/** §1's Section terminal row: the 20 letters that exist. D, I, M, O, P, Q are deliberately absent. */
const SECTION_LETTERS = 'ABCEFGHJKLNRSTUVWXYZ';

/**
 * The designator grammar: `jack-map.md` §1 read strictly, including its two named parser traps —
 * `M10`/`M11` have no `t`/`b` form and must be REJECTED as `M10t`/`M11b`, and `D` runs 0..19.
 *
 * D5: the section alphabet is `SECTION_LETTERS`, the same string `verifyJackMap` checks against §1
 * on every run, and NOT `[A-Z]`. A token outside it is not a panel terminal and never was.
 */
const DESIG = new RegExp(`^(?:[1-6](?:[${SECTION_LETTERS}]|com|cap|\\+|-)|M(?:[1-9][tb]|10|11|[+-])|D(?:[0-9]|1[0-9]))$`);

/** The markdown rows of one `## N.` section, as trimmed cell arrays, header and rule dropped. */
function tableRows(text: string, heading: string): string[][] {
  const rows: string[][] = [];
  let inSection = false;
  for (const line of text.split('\n')) {
    if (line.startsWith(heading)) { inSection = true; continue; }
    if (inSection && /^## /.test(line)) break;
    if (!inSection || !/^\s*\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    // GitHub-flavoured separators may carry alignment colons (`:---`, `---:`, `:---:`), and the
    // sibling wire-table parser above already accepts them. Rejecting them here would push the
    // separator into `rows` as data and report every §5 row as displaced by one.
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows.slice(1); // drop the header row
}

const ticked = (cell: string): string[] => (cell.match(/`[^`]+`/g) ?? []).map((t) => t.slice(1, -1));

/**
 * Re-read `jack-map.md` and check every fact the builder below depends on. Returns the mismatches,
 * as sentences; an empty array is the pass. Nothing here mutates the file or the tables.
 */
export function verifyJackMap(text = readFileSync(JACK_MAP_MD, 'utf8')): string[] {
  const bad: string[] = [];
  const rows5 = tableRows(text, '## 5. ');
  if (rows5.length !== JACKMAP_5.length) {
    bad.push(`jack-map.md §5 has ${rows5.length} component rows, this tool expects ${JACKMAP_5.length}`);
  }
  for (let i = 0; i < JACKMAP_5.length; i++) {
    const want = JACKMAP_5[i] as FixedRow;
    const got = rows5[i];
    if (got === undefined) { bad.push(`jack-map.md §5 row ${i + 1} missing, expected "${want.component}"`); continue; }
    const [component, count, terminals, topology] = [got[0] ?? '', got[1] ?? '', got[2] ?? '', got[3] ?? ''];
    if (component !== want.component) { bad.push(`jack-map.md §5 row ${i + 1}: component "${component}" != "${want.component}"`); continue; }
    if (count !== want.count) bad.push(`jack-map.md §5 "${want.component}": count "${count}" != "${want.count}"`);
    const t = ticked(terminals).join(' ');
    if (t !== want.terminals.join(' ')) bad.push(`jack-map.md §5 "${want.component}": terminals [${t}] != [${want.terminals.join(' ')}]`);
    if (want.component === 'Rotary wiper') {
      for (const rule of ROTARY_TOPOLOGY) {
        if (!rule.test(topology)) bad.push(`jack-map.md §5 "${want.component}": topology cell no longer states ${String(rule)}`);
      }
    }
    const mv = JACKMAP_MOVABLE.find((m) => m.component === want.component);
    if (mv !== undefined) {
      const m = /arm `([^`]+)`; (?:N\.C\.|LEFT) `([^`]+)`; (?:N\.O\.|RIGHT) `([^`]+)`/.exec(topology);
      if (m === null) bad.push(`jack-map.md §5 "${want.component}": topology cell no longer states arm / N.C.-LEFT / N.O.-RIGHT`);
      else if (m[1] !== mv.arm || m[2] !== mv.rest || m[3] !== mv.operated) {
        bad.push(`jack-map.md §5 "${want.component}": arm/rest/operated ${m[1]}/${m[2]}/${m[3]} != ${mv.arm}/${mv.rest}/${mv.operated}`);
      }
    }
  }
  const rows4 = tableRows(text, '## 4. ');
  const bus = (label: string, want: readonly string[]): void => {
    const row = rows4.find((r) => (r[0] ?? '').includes(label));
    if (row === undefined) { bad.push(`jack-map.md §4: no "${label}" row`); return; }
    const got = ticked(row[1] ?? '').join(' ');
    if (got !== want.join(' ')) bad.push(`jack-map.md §4 ${label}: members [${got}] != [${want.join(' ')}]`);
  };
  bus('PLUS rail', PLUS_MEMBERS);
  bus('MINUS rail', MINUS_MEMBERS);
  const secRow = tableRows(text, '## 1. ').find((r) => (r[0] ?? '') === 'Section terminal');
  if (secRow === undefined) bad.push('jack-map.md §1: no "Section terminal" row');
  else {
    const letters = (secRow[2] ?? '').replace(/^letters\s*/, '').split(/\s+/).join('');
    if (letters !== SECTION_LETTERS) bad.push(`jack-map.md §1 section letters "${letters}" != "${SECTION_LETTERS}"`);
  }
  return bad;
}

// --- The terminal-name interner. `ids` is only ever `get`/`set`; nothing iterates it.
const ids = new Map<string, number>();
const names: string[] = [];
/** D5: set once the panel below is fully interned. After that, a new name is a bug, not a node. */
let sealed = false;
function tid(n: string): number {
  const v = ids.get(n);
  if (v !== undefined) return v;
  if (sealed) {
    throw new Error(`corpus-reachability: "${n}" is not a panel terminal — jack-map.md §1 defines no such designator, and interning it here would silently create a node`);
  }
  const k = names.length;
  ids.set(n, k);
  names.push(n);
  return k;
}
const PLUS = tid('PLUS');
const MINUS = tid('MINUS');
const sub = (template: string, n: number): string => template.replace('n', String(n));

/** A designator to its interned terminal id, with §4's two rails collapsed. */
function term(d: string): number {
  if ((PLUS_MEMBERS as readonly string[]).includes(d)) return PLUS;
  if ((MINUS_MEMBERS as readonly string[]).includes(d)) return MINUS;
  return tid(d);
}

const LAMP_R = tungsten(0.046);

/** §5's fixed two-terminal components, in the element order the netlist is stamped in. */
interface FixedEl { coil: boolean; a: number; b: number; rOhm: number }
const FIXED: FixedEl[] = [];
for (let n = 1; n <= 6; n++) {
  const outLamp = (JACKMAP_5[0] as FixedRow).terminals;
  const indLamp = (JACKMAP_5[1] as FixedRow).terminals;
  const coilT = (JACKMAP_5[2] as FixedRow).terminals;
  FIXED.push({ coil: false, a: term(sub(outLamp[0] as string, n)), b: term(sub(outLamp[1] as string, n)), rOhm: LAMP_R });
  FIXED.push({ coil: false, a: term(sub(indLamp[0] as string, n)), b: term(sub(indLamp[1] as string, n)), rOhm: LAMP_R });
  FIXED.push({ coil: true, a: term(sub(coilT[0] as string, n)), b: term(sub(coilT[1] as string, n)), rOhm: R_COIL });
}
// The motor branch. R1 = 22, motor = 22, R2 = 33 are `gen-solver-kat.ts`'s placeholders (header).
FIXED.push({ coil: false, a: term('D17'), b: term('D19'), rOhm: 22 });
FIXED.push({ coil: false, a: term('D18'), b: term('D19'), rOhm: 22 });
FIXED.push({ coil: false, a: term('D18'), b: term('D19'), rOhm: 33 });

interface Contacts { arm: number; rest: number; operated: number }
const mv = (component: string, n: number): Contacts => {
  const m = JACKMAP_MOVABLE.find((x) => x.component === component) as MoveRow;
  return { arm: term(sub(m.arm, n)), rest: term(sub(m.rest, n)), operated: term(sub(m.operated, n)) };
};
const RELAY_SETS: Contacts[][] = [];
const BUTTONS: Contacts[] = [];
const SLIDE_SETS: Contacts[][] = [];
for (let n = 1; n <= 6; n++) {
  RELAY_SETS.push([mv('Relay *n* transfer set 1', n), mv('Relay *n* transfer set 2', n)]);
  BUTTONS.push(mv('Pushbutton *n*', n));
  SLIDE_SETS.push([mv('Slide switch *n* set 1', n), mv('Slide switch *n* set 2', n)]);
}
// The bare junctions and the dial, so every designator a program can name exists as a node.
for (let n = 1; n <= 6; n++) { term(`${n}com`); term(`${n}cap`); }
for (let n = 1; n <= 9; n++) { term(`M${n}t`); term(`M${n}b`); }
term('M10');
term('M11');
for (let d = 0; d <= 19; d++) term(`D${d}`);
for (let n = 1; n <= 6; n++) for (const L of SECTION_LETTERS) term(`${n}${L}`);
sealed = true;

const NT = names.length;
const parent = new Int32Array(NT);
function find(x: number): number {
  let r = x;
  while (parent[r] !== r) { parent[r] = parent[parent[r] as number] as number; r = parent[r] as number; }
  return r;
}
function uni(a: number, b: number): void {
  const ra = find(a);
  const rb = find(b);
  if (ra === rb) return;
  parent[ra > rb ? ra : rb] = ra > rb ? rb : ra;
}

export interface Built {
  els: El[];
  datum: number;
  /**
   * The wiring plus these contact positions ties the PLUS rail to the MINUS rail.
   *
   * It is not a state the census can measure. `nodeOf(PLUS)` then returns the datum, so the supply
   * is stamped as `{ k: 'source', a: 0, b: 0 }` — a self-loop that delivers nothing — and every
   * node solves to 0 V with every coil at 0 A. That is a DE-ENERGISED panel, not the shorted one
   * the wiring describes: the short current the real machine's breaker interrupts does not appear
   * anywhere in it. The all-released mask is self-consistent against zero currents, so without
   * this flag the configuration reads as an ordinary quiet reachable state.
   */
  shorted: boolean;
}

/**
 * One contact configuration, as a `src/core/solve.ts` element array.
 *
 * `rst[n]`: 0 = at rest (N.C. made), 1 = operated (N.O. made), -1 = TRANSFER, both contacts open —
 * architecture §4.3's window, and the only place in this file where a contact is neither.
 *
 * `pb` is a **6-bit mask**, bit `n` for pushbutton `n + 1`: `I-EXP4` and `I-EXP5` both print a
 * simultaneous two-button press, so a scalar cannot express the corpus. `sw` is 0 for LEFT, 1 for
 * RIGHT, applied to all six slide switches together.
 *
 * `lH` is the coil inductance, defaulting to `L_CENSUS_H` — the shipped `L_COIL` unless
 * `MINIVAC_L_COIL_H` overrides it. It is a parameter so the override has a seam the spec can pull
 * on without a child process; the census itself never passes one.
 */
export function build(p: Program, rst: readonly number[], pb: number, sw: number, wiper: number, lH: number = L_CENSUS_H): Built {
  for (let i = 0; i < NT; i++) parent[i] = i;
  for (const [a, b] of p.wires) uni(term(a), term(b));
  for (let n = 0; n < 6; n++) {
    for (const c of RELAY_SETS[n] as Contacts[]) {
      if (rst[n] === 0) uni(c.arm, c.rest);
      else if (rst[n] === 1) uni(c.arm, c.operated);
    }
  }
  for (let n = 0; n < 6; n++) {
    const c = BUTTONS[n] as Contacts;
    uni(c.arm, (pb & (1 << n)) !== 0 ? c.operated : c.rest);
  }
  for (let n = 0; n < 6; n++) for (const c of SLIDE_SETS[n] as Contacts[]) uni(c.arm, sw === 0 ? c.rest : c.operated);
  uni(term('D16'), term(`D${wiper}`));

  // Renumber to dense solver node ids, datum first. Only terminals a fixed component or the supply
  // actually touches get an id: §3.1.4 would prune the rest anyway, and the solver's matrix is
  // sized for the panel's 22 elements.
  const map = new Int32Array(NT).fill(-1);
  map[find(MINUS)] = 0;
  let next = 1;
  const nodeOf = (t: number): number => {
    const r = find(t);
    if ((map[r] as number) < 0) { map[r] = next; next++; }
    return map[r] as number;
  };
  const els: El[] = [];
  for (const f of FIXED) {
    const a = nodeOf(f.a);
    const b = nodeOf(f.b);
    els.push(f.coil ? { k: 'coil', a, b, rOhm: f.rOhm, lH } : { k: 'res', a, b, rOhm: f.rOhm });
  }
  // Determinism rule 2: the source is stamped last. `tickSolve` throws if it is not.
  const plus = nodeOf(PLUS);
  els.push({ k: 'source', a: plus, b: 0, vOc: V_OC, rSrcOhm: R_SRC });
  return { els, datum: 0, shorted: plus === 0 };
}

// =================================================================================================
// 3. THE SETTLED START, AND THE TWO QUESTIONS
// =================================================================================================

const PWL = makePwl();
const solveCfg = (datum: number): SolveCfg => ({ dtS: DT_S, vArc: V_ARC, kThermal: K_THERMAL, gminS: GMIN_S, pwl: PWL, datum });
const freshCarried = (n: number): Carried => ({ iCoil: new Float64Array(n), rLamp: new Float64Array(0) });

/**
 * The settled DC coil currents, in coil order.
 *
 * A coil at DC is its own 150 Ω, and a resistor carries no state, so one `tickSolve` on the netlist
 * with every coil replaced by a resistor IS the DC solution — no second solver, and the start state
 * is produced by the same arithmetic the census then runs on.
 *
 * It is used twice: for the settled BEFORE-state the census starts from, and for the landed
 * netlist's own correct answer, which is the thing a latched run is judged against.
 */
export function dcCoilCurrents(els: readonly El[], datum: number): Float64Array {
  const resistive = els.map((e) => (e.k === 'coil' ? { k: 'res' as const, a: e.a, b: e.b, rOhm: e.rOhm } : e));
  const r = tickSolve(resistive, freshCarried(0), solveCfg(datum));
  // `TickResult.nonPortable` is §3.5's "this solve did not produce an answer every port can agree
  // on" — a singular system (rule 14) reports NaN node voltages, and a NaN branch current here is
  // not caught downstream: `quantize(NaN)` is 0 with a throwaway flag, so `relayDir` would read it
  // as a released relay and the filter would call the state reachable. Both the BEFORE state and
  // the landed netlist's own DC answer come out of this function, so an unchecked one poisons the
  // reachability filter and the gate at once. It does not fire over the parsed corpus; if it ever
  // does, that is a finding and not a tick to absorb.
  if (r.nonPortable) {
    throw new Error('corpus-reachability: the DC pre-solve reported a non-portable result — a NaN or clamped current here would be read as a released relay by the reachability filter');
  }
  const out: number[] = [];
  for (let e = 0; e < els.length; e++) {
    if ((els[e] as El).k !== 'coil') continue;
    const i = r.branchI[e] as number;
    if (!Number.isFinite(i)) throw new Error(`corpus-reachability: the DC pre-solve returned a non-finite current ${i} on coil element ${e}`);
    out.push(i);
  }
  return Float64Array.from(out);
}

/**
 * §4.3's own three-way direction decision, as a pure function of one coil current magnitude.
 *
 * `+1` operate, `-1` release, `0` hold where it is. This is the ONLY thing a coil current does to a
 * relay, so it is the right granularity for "did the defect change anything": two currents that
 * decide the same way are the same machine, however far apart they are.
 */
export function relayDir(iAbs: number, selected: ThresholdSet = Z_THRESHOLD_SET, relayIndex = 0): number {
  const flags = { nonPortable: false };
  const ua = quantize(iAbs, 1e6, flags);
  // A raised flag means the µA value is a saturating substitute rather than the current: NaN and
  // both infinities quantize to 0, which reads as RELEASE. `decisionFlips` is counted from this
  // function, so absorbing that would be the gate answering about a number it never had.
  if (flags.nonPortable) throw new Error(`corpus-reachability: coil current ${iAbs} A does not quantize to a §3.5 microamp value, so no §4.3 direction decision exists for it`);
  return relayDirUa(ua, selected, relayIndex);
}

/**
 * The two shapes a bare two-coil node can take, and why they are counted apart.
 *
 * A node incident on exactly two elements, both coils, is the whole topology the O-E11 latch needs:
 * KCL there is `i_a - i_b = 0` with no third element to hide a discrepancy in. Take `sa` as the
 * current INTO the node through coil a and `sb` the same for coil b:
 *
 *   sa * sb < 0   one in, one out — a genuine SERIES pair. `|sa + sb|` is then `||i_a| - |i_b||`,
 *                 the mismatch backward Euler reconciles by jumping both to their mean. **This is
 *                 the defect's shape**, and the shape `test/solve.spec.ts` seeds by hand.
 *   sa * sb > 0   both pushing in — current STRANDED at the node, which is the open-release case
 *                 the arc pass exists for and gets right. Counting it as a series mismatch would
 *                 overstate the defect's reach, which is the mistake this split exists to avoid.
 */
export function bareTwoCoilNodes(els: readonly El[], datum: number, iCoil: Float64Array): { series: number; stranded: number } {
  let nc = datum + 1;
  for (const e of els) { if (e.a + 1 > nc) nc = e.a + 1; if (e.b + 1 > nc) nc = e.b + 1; }
  const deg = new Int32Array(nc);
  const coilDeg = new Int32Array(nc);
  const e1 = new Int32Array(nc).fill(-1);
  const e2 = new Int32Array(nc).fill(-1);
  for (let e = 0; e < els.length; e++) {
    const el = els[e] as El;
    for (const nd of [el.a, el.b]) {
      deg[nd] = (deg[nd] as number) + 1;
      if (el.k === 'coil') coilDeg[nd] = (coilDeg[nd] as number) + 1;
      if ((e1[nd] as number) < 0) e1[nd] = e;
      else if ((e2[nd] as number) < 0) e2[nd] = e;
    }
  }
  const coilIx = new Int32Array(els.length).fill(-1);
  let k = 0;
  for (let e = 0; e < els.length; e++) if ((els[e] as El).k === 'coil') { coilIx[e] = k; k++; }
  let series = 0;
  let stranded = 0;
  for (let nd = 0; nd < nc; nd++) {
    if (nd === datum || deg[nd] !== 2 || coilDeg[nd] !== 2) continue;
    const ea = e1[nd] as number;
    const eb = e2[nd] as number;
    if (ea < 0 || eb < 0 || ea === eb) continue; // a coil with both ends here is a loop, not a pair
    const ela = els[ea] as El;
    const elb = els[eb] as El;
    const x = iCoil[coilIx[ea] as number] as number;
    const y = iCoil[coilIx[eb] as number] as number;
    const sa = ela.b === nd ? x : -x;
    const sb = elb.b === nd ? y : -y;
    const d = Math.abs(sa + sb);
    if (sa * sb < 0) { if (d > series) series = d; }
    else if (d > stranded) stranded = d;
  }
  return { series, stranded };
}

// =================================================================================================
// 4. THE CENSUS
// =================================================================================================

/** One netlist's worth of bare-two-coil-node tallies: the transfer window, or the landed circuit. */
export interface Site {
  /** Configurations where the site showed a SERIES pair mismatched by more than `SERIES_BOUND_A`. */
  seriesConfigs: number;
  worstSeriesA: number;
  /** The same for the STRANDED shape, which is the case the arc pass exists for. */
  strandedConfigs: number;
  worstStrandedA: number;
}

export interface ProgramTally {
  name: string;
  /** Reachable transfer configurations built for this program. */
  configs: number;
  /** Ticks of the both-open window on which `tickSolve` ran its second solve. */
  arcTicks: number;
  transferSeries: number;
  landedSeries: number;
  transferStranded: number;
  landedStranded: number;
  /** Configurations reaching a mismatched SERIES pair on either netlist. */
  hits: number;
  /** Of those, the ones that settled away from the landed netlist's own DC answer. */
  latched: number;
  /** Of those, the ones where a relay's §4.3 decision differs from that answer. Must be 0. */
  flips: number;
}

/** One pushbutton axis's worth of the sweep. Both axes come out of a single pass over the corpus. */
export interface AxisTally {
  label: string;
  /**
   * Before-states rejected before the filter ran because the wiring and contacts short the two
   * rails. See `Built.shorted`: the netlist for one of those is a de-energised panel rather than a
   * shorted one, so it is not a measurement of the machine and is excluded rather than counted.
   */
  railShortedStates: number;
  /** Before-states surviving the §4.3 hysteresis self-consistency filter. */
  selfConsistentStates: number;
  /** Transfer configurations: one per before-state per relay. */
  configurations: number;
  /** The both-open window, sampled on every one of its 12 ticks. Where the arc pass runs. */
  transfer: Site;
  /** The landed netlist, once the other contact set has made. */
  landed: Site;
  /** Configurations reaching a mismatched SERIES pair on either netlist. */
  hitConfigs: number;
  /** Of those, the ones whose settled coils differ from the landed netlist's own DC answer. */
  latchedConfigs: number;
  /** Of those, the ones where a relay DECISION differs from that answer. The gate: must be 0. */
  decisionFlips: number;
  /** Worst |settled - DC| over every coil of every hit configuration, in amps. */
  worstCoilErrA: number;
  /**
   * The smallest margin any decision survived by, in amps: over every coil of every hit
   * configuration, `(distance from the DC answer to the nearest §4.3 threshold) - (that coil's
   * error)`. Positive everywhere means no flip was POSSIBLE, which is a stronger statement than no
   * flip was observed. `Infinity` when nothing was hit.
   */
  worstHeadroomA: number;
  /** Coils whose settled error is strictly greater than `SERIES_BOUND_A`. */
  perturbedCoils: number;
  /** Minimum registered perturbed-coil expression. Infinity iff `perturbedCoils === 0`. */
  perturbedHeadroomA: number;
  arcTicks: number;
  /** Names of the programs whose both-open window ever ran the arc pass, sorted. */
  arcPrograms: readonly string[];
  perProgram: readonly ProgramTally[];
}

export interface Census {
  thresholdSet: ThresholdSetName;
  lCoilH: number;
  recordsFound: number;
  usable: number;
  skipped: readonly { name: string; reason: string }[];
  /** Usable records that state their own wire count — all of which match it, or they were skipped. */
  statedAndMatched: number;
  totalWires: number;
  /** `wireDigest` of every parsed record, so a rewritten wire cannot pass a count-only check. */
  digest: string;
  /** All 64 pushbutton combinations — the corpus's own axis, `I-EXP4` and `I-EXP5`. */
  all: AxisTally;
  /** The 0-or-1-button subset, which is the axis the withdrawn numbers were measured on. */
  shipped: AxisTally;
}

export interface CensusOpts {
  /**
   * Restrict the SWEEP to these program names, in the parse order they appear in. The parse census
   * — `recordsFound`, `usable`, `skipped`, `totalWires`, `digest` — still describes the whole file,
   * because those numbers are a fact about `programs.md` rather than about the subset.
   */
  only?: readonly string[];
  /**
   * Ticks the landed netlist is settled for, defaulting to `SETTLE_TICKS`. Present so the settling
   * budget can be varied and the answer shown not to depend on it.
   */
  settleTicks?: number;
  /** One immutable object used at both self-consistency and endpoint sites. Default: nominal Z. */
  thresholdSet?: ThresholdSet;
  /** Coil inductance for this run. Default: the ordinary gate's shipped/env-selected value. */
  lH?: number;
  /** Negative-test hook: if supplied, it must be the same object as `thresholdSet`. */
  endpointThresholdSet?: ThresholdSet;
}

const newSite = (): Site => ({ seriesConfigs: 0, worstSeriesA: 0, strandedConfigs: 0, worstStrandedA: 0 });

function newAxis(label: string, swept: readonly Program[]): AxisTally {
  return {
    label,
    railShortedStates: 0,
    selfConsistentStates: 0,
    configurations: 0,
    transfer: newSite(),
    landed: newSite(),
    hitConfigs: 0,
    latchedConfigs: 0,
    decisionFlips: 0,
    worstCoilErrA: 0,
    worstHeadroomA: Number.POSITIVE_INFINITY,
    perturbedCoils: 0,
    perturbedHeadroomA: Number.POSITIVE_INFINITY,
    arcTicks: 0,
    arcPrograms: [],
    perProgram: swept.map((p) => ({
      name: p.name, configs: 0, arcTicks: 0,
      transferSeries: 0, landedSeries: 0, transferStranded: 0, landedStranded: 0,
      hits: 0, latched: 0, flips: 0,
    })),
  };
}

export interface DEndpointCensus {
  profile: Profile;
  rows: readonly ThresholdIntegrityRow[];
  census: Census;
}

/** Loads no fallback: the exact checked-in profile object supplies every D endpoint input. */
export function dEndpointCensus(programs: readonly Program[], loaded: Profile): DEndpointCensus {
  const rows = requireShippedDProfile(loaded);
  return {
    profile: loaded,
    rows,
    census: census(programs, {
      thresholdSet: D_THRESHOLD_SET,
      lH: loaded.v.L_coil_uh / 1e6,
    }),
  };
}

/** `a`'s tallies are mutated in place; `AxisTally` is only readonly to its consumers. */
type Mut<T> = { -readonly [K in keyof T]: T[K] };

function addSite(s: Mut<Site>, t: Mut<ProgramTally>, which: 'transfer' | 'landed', m: { series: number; stranded: number }): void {
  if (m.series > s.worstSeriesA) s.worstSeriesA = m.series;
  if (m.stranded > s.worstStrandedA) s.worstStrandedA = m.stranded;
  if (m.series > SERIES_BOUND_A) { s.seriesConfigs++; if (which === 'transfer') t.transferSeries++; else t.landedSeries++; }
  if (m.stranded > SERIES_BOUND_A) { s.strandedConfigs++; if (which === 'transfer') t.transferStranded++; else t.landedStranded++; }
}

export function census(programs: readonly Program[], opts: CensusOpts = {}): Census {
  const usable = programs.filter((p) => p.skip === '');
  const only = opts.only;
  const swept = only === undefined ? usable : usable.filter((p) => only.includes(p.name));
  const settleTicks = opts.settleTicks ?? SETTLE_TICKS;
  const selected = commonThresholdSet(opts.thresholdSet ?? Z_THRESHOLD_SET, opts.endpointThresholdSet ?? opts.thresholdSet ?? Z_THRESHOLD_SET);
  const lH = opts.lH ?? L_CENSUS_H;

  const all = newAxis('all 64 pushbutton combinations', swept) as Mut<AxisTally>;
  const shipped = newAxis('at most one pushbutton down', swept) as Mut<AxisTally>;

  for (let pi = 0; pi < swept.length; pi++) {
    const p = swept[pi] as Program;
    for (let mask = 0; mask < 64; mask++) {
      const base = [0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 6; i++) base[i] = (mask >> i) & 1;
      for (let pb = 0; pb < 64; pb++) {
        // The 0-or-1-button subset is exactly the seven masks of popcount <= 1; a configuration in
        // it is tallied into BOTH axes, out of the one sweep.
        const axes: Mut<AxisTally>[] = (pb & (pb - 1)) === 0 ? [all, shipped] : [all];
        for (let sw = 0; sw < 2; sw++) {
          const before = build(p, base, pb, sw, WIPER, lH);
          // A wiring that ties the rails together is a fault, not a configuration: the netlist for
          // it is a panel with no supply at all (`Built.shorted`), every coil sits at 0 A, and the
          // all-released mask would sail through the filter below on currents that are an artefact
          // of the stamping rather than a measurement. Counted, so the exclusion is visible.
          if (before.shorted) { for (const a of axes) a.railShortedStates++; continue; }
          const i0 = dcCoilCurrents(before.els, before.datum);
          // REACHABILITY, on §4.3's own hysteresis ladder. A relay mask is a state the machine can
          // sit in only if every relay's marked position is one the ladder would HOLD: released
          // needs the coil below pull-in, operated needs it above DROP-OUT. Comparing both senses
          // against pull-in — which this file used to do — throws away every state with a relay
          // holding in the band, and the band is 26.7 mA wide.
          let reachable = true;
          for (let c = 0; c < 6; c++) {
            const m = Math.abs(i0[c] as number);
            const ua = quantize(m, 1e6, { nonPortable: false });
            if (base[c] === 1
              ? !(ua > (selected.dropOutUa[c] as number))
              : !(ua < (selected.pullInUa[c] as number))) { reachable = false; break; }
          }
          if (!reachable) continue;
          for (const a of axes) a.selfConsistentStates++;
          for (let r = 0; r < 6; r++) {
            const transfer = base.slice();
            transfer[r] = -1;
            const T = build(p, transfer, pb, sw, WIPER, lH);
            for (const a of axes) { a.configurations++; (a.perProgram[pi] as Mut<ProgramTally>).configs++; }
            const carried: Carried = { iCoil: Float64Array.from(i0), rLamp: new Float64Array(0) };
            let hit = false;
            // The window's worst over its 12 ticks, so the tallies below count CONFIGURATIONS and
            // not configuration-ticks — the transfer site is 12 samples of one configuration, and
            // counting each sample would inflate it by up to twelvefold against the landed site.
            const win = { series: 0, stranded: 0 };
            for (let t = 0; t < BOTH_OPEN_TICKS; t++) {
              // Sampled BEFORE the solve, because `Garc = |i_prev| / V_arc` — these are the exact
              // currents the arc pass will use on this tick. Over the 12 ticks this samples the
              // settled start and the first 11 solved states; the landed check below picks up the
              // twelfth, so the window is covered end to end with no gap.
              const m = bareTwoCoilNodes(T.els, T.datum, carried.iCoil);
              if (m.series > win.series) win.series = m.series;
              if (m.stranded > win.stranded) win.stranded = m.stranded;
              if (tickSolve(T.els, carried, solveCfg(T.datum)).arcPass) {
                for (const a of axes) { a.arcTicks++; (a.perProgram[pi] as Mut<ProgramTally>).arcTicks++; }
              }
            }
            if (win.series > SERIES_BOUND_A) hit = true;
            for (const a of axes) addSite(a.transfer, a.perProgram[pi] as Mut<ProgramTally>, 'transfer', win);
            // The armature lands: the other contact set makes, and the currents it inherits are the
            // ones the both-open window left behind.
            const after = base.slice();
            after[r] = base[r] === 1 ? 0 : 1;
            const A = build(p, after, pb, sw, WIPER, lH);
            const m = bareTwoCoilNodes(A.els, A.datum, carried.iCoil);
            if (m.series > SERIES_BOUND_A) hit = true;
            for (const a of axes) addSite(a.landed, a.perProgram[pi] as Mut<ProgramTally>, 'landed', m);
            if (!hit) continue;

            // THE QUESTION THE RULING NOW TURNS ON. The state was reached; settle the landed
            // netlist and ask whether it converges to that netlist's own DC answer, and — the part
            // that matters — whether any relay decides differently if it does not.
            const truth = dcCoilCurrents(A.els, A.datum);
            for (let t = 0; t < settleTicks; t++) tickSolve(A.els, carried, solveCfg(A.datum));
            let latched = false;
            let flipped = false;
            let worstErr = 0;
            let worstHead = Number.POSITIVE_INFINITY;
            const endpointSamples: CoilEndpointSample[] = [];
            for (let c = 0; c < 6; c++) {
              const got = Math.abs(carried.iCoil[c] as number);
              const want = Math.abs(truth[c] as number);
              const err = Math.abs(got - want);
              endpointSamples.push({ relayIndex: c, gotA: got, wantA: want });
              if (err > worstErr) worstErr = err;
              if (err > SERIES_BOUND_A) latched = true;
              if (relayDir(got, selected, c) !== relayDir(want, selected, c)) flipped = true;
              const pullInA = (selected.pullInUa[c] as number) / 1e6;
              const dropOutA = (selected.dropOutUa[c] as number) / 1e6;
              const margin = Math.min(Math.abs(want - pullInA), Math.abs(want - dropOutA));
              if (margin - err < worstHead) worstHead = margin - err;
            }
            const perturbed = perturbedCoilHeadroom(endpointSamples, selected);
            for (const a of axes) {
              const t = a.perProgram[pi] as Mut<ProgramTally>;
              a.hitConfigs++; t.hits++;
              if (latched) { a.latchedConfigs++; t.latched++; }
              if (flipped) { a.decisionFlips++; t.flips++; }
              if (worstErr > a.worstCoilErrA) a.worstCoilErrA = worstErr;
              if (worstHead < a.worstHeadroomA) a.worstHeadroomA = worstHead;
              a.perturbedCoils += perturbed.population;
              if (perturbed.minimumA < a.perturbedHeadroomA) a.perturbedHeadroomA = perturbed.minimumA;
            }
          }
        }
      }
    }
  }

  for (const a of [all, shipped]) a.arcPrograms = a.perProgram.filter((t) => t.arcTicks > 0).map((t) => t.name).sort();

  return {
    thresholdSet: selected.name,
    lCoilH: lH,
    recordsFound: programs.length,
    usable: usable.length,
    skipped: programs.filter((p) => p.skip !== '').map((p) => ({ name: p.name, reason: p.skip })),
    statedAndMatched: usable.filter((p) => p.stated !== null).length,
    totalWires: usable.reduce((a, p) => a + p.wires.length, 0),
    digest: wireDigest(programs),
    all: all as AxisTally,
    shipped: shipped as AxisTally,
  };
}

/**
 * The parse census this tool is pinned to, so `npm run check-reachability` fails on a corpus edit
 * by itself rather than only under vitest.
 *
 * The header claims a research edit that drops or changes a program fails the suite; without this
 * the tool exited 0 on a corpus with a whole program deleted, because every downstream number is a
 * ratio-free count that simply gets smaller. `digest` is what catches an edit that moves no count —
 * a rewritten wire. If a corpus edit is intentional, this block is what you update, deliberately,
 * with the new numbers in the commit message.
 */
export const EXPECTED_PARSE = {
  recordsFound: 102,
  usable: 88,
  skipped: 14,
  statedAndMatched: 88,
  // Phase 5 wave 3 (2026-10-14): II-EXP1 gained the printed 5F/5- (image-read), 25 -> 26 wires; the
  // only parsed record that moved. Old totalWires 2156.
  totalWires: 2157,
  // Unchanged across the D6 fix, and that is the point: D6 moved which records are RUN, not which
  // wires were read, so the digest of the parse is the same sixteen hex digits it was before.
  // Phase 5 batch 3 (2026-10-13): IV-APX-2BITADDER 5Y/6V corrected to the printed 5Y/6Y (image-read);
  // no count moved. Old digest 26ed7fb8a64f187c.
  // Phase 5 waves 1-2 (2026-10-14): V-EXP19 4H/5U corrected to the printed 4H/5L (image-read at
  // 600 dpi, PDF p.39); the only parsed wire that moved, so no count moved. Old digest dd1dba95f7e448bb.
  // Phase 5 wave 3 (2026-10-14): II-EXP1 +5F/5- (stated 25 -> 26). Old digest ba6ff5eb813ed171.
  digest: 'a4a15f3c39d0ed83',
} as const;

/** The programs the ruling names by hand, and whose configuration counts must therefore be real. */
export const NAMED_QUIET = ['IV-EXP1', 'ER-ALTCOUNTER'] as const;

/**
 * The invariant, as sentences. Empty = it holds. A non-empty result is a non-zero exit.
 *
 * `jackMap` and `refConst` are the two run-time re-reads — `verifyJackMap` on the panel,
 * `verifyRefConstants` on the constants — and they come in as sentences rather than being taken
 * here so this function stays a pure predicate over what was measured.
 *
 * Note what is NOT here any more: "no bare mismatched two-coil node occurs". It does occur, this
 * file measures where, and a gate asserting otherwise was asserting something false.
 */
export function violations(c: Census, jackMap: readonly string[], refConst: readonly string[] = []): string[] {
  const bad: string[] = [...jackMap, ...refConst];
  // The same denominator `axisBlock` prints the headroom against. Under Z this is `I_PULLIN`; under
  // D it is the strictest of the six indexed pull-ins, and quoting the nominal one there would put
  // two different percentages for one measurement on the same page.
  const strictestPullInA = Math.max(...(c.thresholdSet === 'D' ? D_THRESHOLD_SET : Z_THRESHOLD_SET).pullInUa) / 1e6;

  // --- the corpus is the one this tool was pinned against
  const p = EXPECTED_PARSE;
  if (c.recordsFound !== p.recordsFound) bad.push(`programs.md: ${c.recordsFound} records found, expected ${p.recordsFound}`);
  if (c.usable !== p.usable) bad.push(`programs.md: ${c.usable} usable records, expected ${p.usable}`);
  if (c.skipped.length !== p.skipped) bad.push(`programs.md: ${c.skipped.length} skipped records, expected ${p.skipped}`);
  if (c.statedAndMatched !== p.statedAndMatched) bad.push(`programs.md: ${c.statedAndMatched} usable records state their own wire count, expected ${p.statedAndMatched}`);
  if (c.totalWires !== p.totalWires) bad.push(`programs.md: ${c.totalWires} wires parsed, expected ${p.totalWires}`);
  if (c.digest !== p.digest) bad.push(`programs.md: wire digest ${c.digest}, expected ${p.digest} — a wire was rewritten, or a record's wires moved`);
  for (const s of c.skipped) if (s.reason === '') bad.push(`${s.name} is skipped with no stated reason`);

  // --- the sweep is measuring something
  for (const a of [c.all, c.shipped]) {
    if (a.configurations === 0) bad.push(`${a.label}: no reachable configurations built — the census would be vacuous`);
    if (a.landed.strandedConfigs === 0 && a.transfer.strandedConfigs === 0) {
      bad.push(`${a.label}: no STRANDED pair anywhere — the open-release case the arc pass exists for is not in the sweep, so the harness is building less than the corpus contains`);
    }
  }
  // The positive control on the whole instrument. The state IS reached; if it stops being reached,
  // the harness has narrowed and every "no decision differs" below is a claim about nothing.
  if (c.all.hitConfigs === 0) {
    bad.push('all 64 pushbutton combinations: no configuration reaches a mismatched bare two-coil node at all — that is not what the corpus does, so the sweep has narrowed rather than the defect gone');
  }

  // --- the invariant proper
  for (const a of [c.all, c.shipped]) {
    if (a.decisionFlips > 0) {
      bad.push(`${a.label}: ${a.decisionFlips} configurations where a relay's §4.3 decision differs from the landed netlist's own DC answer — the O-E11 defect now changes what the machine does, and the ruling behind test/solve.spec.ts's it.fails no longer holds`);
    }
    if (a.worstCoilErrA > COIL_ERR_BOUND_A) {
      bad.push(`${a.label}: worst settled coil error ${mA(a.worstCoilErrA)} mA is above the ${mA(COIL_ERR_BOUND_A, 3)} mA tripwire (${(100 * a.worstCoilErrA / strictestPullInA).toFixed(1)}% of pull-in)`);
    }
  }

  // --- the two the ruling names by hand. Checked on the widest axis, which implies the other.
  for (const name of NAMED_QUIET) {
    const t = c.all.perProgram.find((x) => x.name === name);
    if (t === undefined) bad.push(`${name} is not in the sweep — anything the ruling says about it would be vacuous`);
    else if (t.configs === 0) bad.push(`${name} contributed 0 reachable configurations — anything the ruling says about it would be vacuous`);
    else if (t.arcTicks > 0) bad.push(`${name} fired the arc pass on ${t.arcTicks} ticks; the ruling records it as never firing in any reachable state`);
    else if (t.hits > 0) bad.push(`${name} reaches the defect's state in ${t.hits} configurations; the ruling records it as reaching it in none`);
  }
  return bad;
}

// =================================================================================================
// 5. REPORT
// =================================================================================================

const mA = (a: number, p = 6): string => (a * 1e3).toPrecision(p);
const pad = (n: number, w: number): string => String(n).padStart(w);

function axisBlock(a: AxisTally, progCount: number, selected: ThresholdSet): string[] {
  const L: string[] = [];
  L.push(`--- ${a.label} ---`);
  L.push('');
  L.push(`before-states excluded: the wiring shorts the rails : ${pad(a.railShortedStates, 7)}`);
  L.push(`self-consistent settled before-states  : ${pad(a.selfConsistentStates, 7)}`);
  L.push(`transfer configurations                : ${pad(a.configurations, 7)}   (one per before-state per relay, ${BOTH_OPEN_TICKS} ticks each)`);
  L.push('');
  L.push('a node carrying exactly two coils and nothing else, at different currents:');
  L.push(`   TRANSFER netlist (where the arc pass runs, sampled on all ${BOTH_OPEN_TICKS} ticks)`);
  L.push(`      SERIES   : ${pad(a.transfer.seriesConfigs, 7)} configurations   worst ${mA(a.transfer.worstSeriesA)} mA`);
  L.push(`      STRANDED : ${pad(a.transfer.strandedConfigs, 7)} configurations   worst ${mA(a.transfer.worstStrandedA)} mA`);
  L.push('   LANDED netlist (the other contact set has made)');
  L.push(`      SERIES   : ${pad(a.landed.seriesConfigs, 7)} configurations   worst ${mA(a.landed.worstSeriesA)} mA`);
  L.push(`      STRANDED : ${pad(a.landed.strandedConfigs, 7)} configurations   worst ${mA(a.landed.worstStrandedA)} mA`);
  L.push('');
  L.push(`configurations reaching the state (either netlist) : ${pad(a.hitConfigs, 7)}`);
  L.push(`   of those, settling away from the landed netlist's own DC answer : ${pad(a.latchedConfigs, 7)}`);
  L.push(`   of those, where a RELAY DECISION differs from that answer        : ${pad(a.decisionFlips, 7)}`);
  const strictestPullInA = Math.max(...selected.pullInUa) / 1e6;
  const pullLabel = selected.name === 'Z' ? 'pull-in' : 'strictest selected pull-in';
  L.push(`worst settled coil error against DC    : ${a.hitConfigs === 0 ? 'n/a' : `${mA(a.worstCoilErrA)} mA  (${(100 * a.worstCoilErrA / strictestPullInA).toFixed(1)}% of the ${mA(strictestPullInA, 5)} mA ${pullLabel})`}`);
  L.push(`smallest all-coil decision margin       : ${a.hitConfigs === 0 ? 'n/a' : `${mA(a.worstHeadroomA)} mA`}`);
  L.push(`perturbed-coil headroom (err > ${mA(SERIES_BOUND_A)} mA) : population ${a.perturbedCoils}, minimum ${a.perturbedCoils === 0 ? 'n/a' : `${mA(a.perturbedHeadroomA)} mA`}`);
  L.push('');
  L.push(`arc-pass ticks over this axis          : ${a.arcTicks}`);
  L.push(`programs that ever fire it             : ${a.arcPrograms.length} of ${progCount}`);
  L.push(`   ${a.arcPrograms.length === 0 ? '-' : a.arcPrograms.join(' ')}`);
  const hitProgs = a.perProgram.filter((t) => t.hits > 0).map((t) => `${t.name}(${t.hits}${t.latched > 0 ? `, ${t.latched} latched` : ''})`).sort();
  L.push(`programs reaching the state            : ${hitProgs.length === 0 ? '-' : hitProgs.join(' ')}`);
  const strandedProgs = a.perProgram.filter((t) => t.transferStranded + t.landedStranded > 0).map((t) => `${t.name}(${t.transferStranded + t.landedStranded})`).sort();
  L.push(`programs with a stranded pair          : ${strandedProgs.length === 0 ? '-' : strandedProgs.join(' ')}`);
  L.push('');
  L.push('the two the ruling names by hand, so nothing said about them is vacuous:');
  for (const name of NAMED_QUIET) {
    const t = a.perProgram.find((x) => x.name === name);
    L.push(t === undefined
      ? `   ${name.padEnd(14)} NOT IN THE SWEEP`
      : `   ${name.padEnd(14)} ${pad(t.configs, 6)} reachable configurations, ${t.arcTicks} arc-pass ticks, ${t.hits} reaching the state`);
  }
  L.push('');
  return L;
}

/** The banner an overridden run wears. Empty for the shipped configuration. */
function overrideBanner(overrideLH: number | null): string[] {
  if (overrideLH === null) return [];
  const rule = '='.repeat(96);
  return [
    rule,
    `!!! COIL INDUCTANCE OVERRIDDEN: ${overrideLH} H, from ${L_COIL_ENV}. Every coil below is built at it.`,
    '!!! THIS RUN IS NOT THE SHIPPED CONFIGURATION. Its numbers do not re-bless the pins in',
    '!!! test/corpus-reachability.spec.ts and are not the O-E11 bound; the shipped bound is the one',
    `!!! measured with ${L_COIL_ENV} unset, at the profile's own L_coil_uh.`,
    rule,
    '',
  ];
}

export function formatCensus(c: Census, jackMap: readonly string[], refConst: readonly string[] = [], overrideLH: number | null = null): string {
  const L: string[] = [];
  for (const line of overrideBanner(overrideLH)) L.push(line);
  L.push(`=== threshold set ${c.thresholdSet}; L_coil=${String(c.lCoilH)} H: ${c.thresholdSet === 'Z' ? 'stable identical-relay acceptance baseline; not the exact REF-A machine' : 'Wave D indexed sensitivity; not the ordinary gate default'} ===`);
  L.push('');
  L.push('=== jack-map.md, re-read ===');
  L.push('');
  L.push(`§5 component rows / §5 arm-rest-operated senses / §4 rail memberships / §1 section letters : ${jackMap.length === 0 ? 'all agree' : `${jackMap.length} MISMATCHES`}`);
  for (const b of jackMap) L.push(`   ${b}`);
  L.push('');
  L.push('=== the constants the census is built on, re-checked ===');
  L.push('');
  L.push(`the constants this census is built on, against data/profiles/MV601-REF-A.json : ${refConst.length === 0 ? 'all agree' : `${refConst.length} DIVERGENCES`}`);
  for (const b of refConst) L.push(`   ${b}`);
  if (overrideLH !== null) L.push(`   L_COIL is exempt this run: ${L_COIL_ENV} overrides it to ${overrideLH} H.`);
  L.push('');
  L.push('=== programs.md, parsed ===');
  L.push('');
  L.push(`records found                        : ${c.recordsFound}`);
  L.push(`usable (wire table parses, count matches the record's own stated count) : ${c.usable}`);
  L.push(`SKIPPED, with reasons                : ${c.skipped.length}`);
  for (const s of c.skipped) L.push(`   ${s.name.padEnd(18)} ${s.reason}`);
  L.push(`of the ${c.usable} usable, ${c.statedAndMatched} state their own wire count and all ${c.statedAndMatched} match it exactly.`);
  L.push(`total wires replayed                 : ${c.totalWires}`);
  L.push(`wire digest                          : ${c.digest}`);
  L.push('');
  L.push('=== the state the O-E11 defect needs, and what happens when the corpus reaches it ===');
  L.push('');
  const selected = c.thresholdSet === 'D' ? D_THRESHOLD_SET : Z_THRESHOLD_SET;
  for (const line of axisBlock(c.all, c.all.perProgram.length, selected)) L.push(line);
  for (const line of axisBlock(c.shipped, c.shipped.perProgram.length, selected)) L.push(line);
  const bad = violations(c, jackMap, refConst);
  L.push('=== the invariant ===');
  L.push('');
  if (overrideLH !== null) {
    L.push(`(measured at ${overrideLH} H, NOT the shipped configuration — see the banner at the top)`);
    L.push('');
  }
  if (bad.length === 0) {
    L.push('HOLDS. The state the O-E11 latch needs IS reached by the published corpus, on the transfer');
    L.push('netlist and on the landed one — and over every reachable configuration of every parseable');
    L.push('program, no coil\'s §4.3 relay decision differs from the landed netlist\'s own DC answer.');
    L.push('The worst settled coil error is printed above with its share of pull-in. That margin is a');
    L.push('measurement at these constants, not a guarantee: W1b completed with `L_coil`=1.2 H,');
    L.push('and checked-in REF-A contains the current Wave D `dV_relay_mv` sensitivity vector.');
  } else {
    L.push(`VIOLATED, ${bad.length}:`);
    for (const b of bad) L.push(`   ${b}`);
  }
  L.push('');
  return L.join('\n');
}

export function formatThresholdIntegrity(rows: readonly ThresholdIntegrityRow[]): string {
  const L = ['=== Wave D indexed threshold integrity: six rows / twelve scalars ===', ''];
  for (const row of rows) {
    L.push(`relay=${row.relay} pullInUa selected=${row.selectedPullInUa} loaded=${row.loadedPullInUa} dropOutUa selected=${row.selectedDropOutUa} loaded=${row.loadedDropOutUa}`);
  }
  L.push('');
  return L.join('\n');
}

/** Explicit one-off endpoint sensitivity. The ordinary command remains nominal Z. */
export function formatEndpointSensitivity(
  z: Census,
  d: Census,
  rows: readonly ThresholdIntegrityRow[],
  jackMap: readonly string[],
  refConst: readonly string[],
  loaded: Profile,
): string {
  requireShippedDProfile(loaded);
  return [
    '=== WAVE D ENDPOINT SENSITIVITY ===',
    '',
    'PROFILE INTEGRATION: REF-A contains the frozen D vector; the six integrity rows below bind',
    'this sensitivity directly to its indexed derived thresholds.',
    '',
    formatThresholdIntegrity(rows),
    formatCensus(z, jackMap, refConst),
    formatCensus(d, jackMap, refConst),
  ].join('\n');
}

/**
 * Run as a script, not when imported. `test/corpus-reachability.spec.ts` imports the functions
 * above and pins the numbers, because a gate nothing executes buys confidence it has not earned:
 * a passing suite that silently omits the file under test is worse than a failing one.
 */
const argv1 = process.argv[1];
if (argv1 !== undefined && argv1.endsWith('corpus-reachability.ts')) {
  const started = Date.now();
  // Both re-reads happen BEFORE the sweep: a census measured at the wrong constants is not worth
  // the nine seconds, and a divergence should be the first thing on the report rather than the
  // last thing discovered.
  const refConst = verifyRefConstants();
  const jackMap = verifyJackMap();
  const programs = parsePrograms();
  const dSensitivity = process.argv.slice(2).includes('--d');
  const c = census(programs);
  let output = formatCensus(c, jackMap, refConst, L_COIL_OVERRIDE_H);
  let measured: Census[] = [c];
  if (dSensitivity) {
    if (L_COIL_OVERRIDE_H !== null) throw new Error('reachability D endpoint sensitivity runs only at shipped L_coil = 1.2 H');
    const loaded = shippedProfile();
    const d = dEndpointCensus(programs, loaded);
    output = formatEndpointSensitivity(c, d.census, d.rows, jackMap, refConst, d.profile);
    measured = [c, d.census];
  }
  process.stdout.write(output);
  // Off stdout on purpose: the report is a byte-identical regression baseline and a clock is not.
  process.stderr.write(`(${((Date.now() - started) / 1000).toFixed(1)} s)\n`);
  if (measured.some((x) => violations(x, jackMap, refConst).length > 0)) process.exitCode = 1;
}
