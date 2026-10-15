/**
 * BLESS-ROBUSTNESS: what bless does when a fixture trips a knife-edge trigger.
 *
 * Tom's ruling (docs/DECISIONS.md, 2026-10-13, "Knife-edge gate: keep the 14 µA trigger, add a
 * robustness check"; architecture §9.3): `min_decision_ua` and `min_tick_gap` stay as triggers. A
 * non-marginal fixture that trips either one is still blessable if every assert in it (expect and
 * until, tagged or not) holds under each of six perturbed profiles. Only the asserts count; the
 * perturbed traces, metrics and C2 digests are ignored.
 *
 * The magnitudes are invented harness parameters, `[unverified]` (open-questions.md O-C11), not
 * model physics. They live here and nowhere else: no profile constant, no profile hash, no golden
 * changes. The TS bless is the only caller; the C# port has no bless.
 */
import { loadProfile } from '../../src/core/profile.ts';
import type { Profile } from '../../src/core/profile.ts';
import { readStrictJson } from './helpers.ts';
import { runLoadedFixture } from './run.ts';
import type { LoadedFixture, RunResult } from './types.ts';

/** Relay pull-in and drop-out thresholds move together by this much, both signs. `[unverified]` */
export const THRESHOLD_SHIFT_MV = 150;
/** Coil resistance moves by this percentage, both signs. `[unverified]` */
export const COIL_RESISTANCE_SPREAD_PERCENT = 10;
/** Lamp filament thermal τ is scaled by ×0.5 and ×2, as numerator/denominator pairs. `[unverified]` */
export const LAMP_TAU_SCALES: readonly (readonly [number, number])[] = [[1, 2], [2, 1]];

export interface Perturbation {
  readonly name: string;
  /** Edits a cloned raw profile's `values` in place. */
  readonly apply: (values: Record<string, unknown>) => void;
}

export interface PerturbationOutcome {
  readonly name: string;
  /** `null` when every assert held; otherwise why this perturbation failed the check. */
  readonly failure: string | null;
}

export interface RobustnessOptions {
  readonly perturbations?: readonly Perturbation[];
  readonly run?: (loaded: LoadedFixture) => RunResult;
}

function scale(values: Record<string, unknown>, key: string, edit: (v: number) => number): void {
  const entry = values[key];
  if (typeof entry !== 'object' || entry === null || typeof (entry as { v?: unknown }).v !== 'number') {
    throw new Error('profile value ' + key + ' is not a number');
  }
  const holder = entry as { v: number };
  holder.v = edit(holder.v);
}

function thresholdShift(sign: 1 | -1): Perturbation {
  const mv = sign * THRESHOLD_SHIFT_MV;
  return {
    name: 'relay thresholds ' + (sign > 0 ? '+' : '-') + THRESHOLD_SHIFT_MV + ' mV',
    apply: (values) => {
      scale(values, 'V_pullin_mv', (v) => v + mv);
      scale(values, 'V_dropout_mv', (v) => v + mv);
    },
  };
}

function coilSpread(sign: 1 | -1): Perturbation {
  const percent = 100 + sign * COIL_RESISTANCE_SPREAD_PERCENT;
  return {
    name: 'coil resistance ' + (sign > 0 ? '+' : '-') + COIL_RESISTANCE_SPREAD_PERCENT + '%',
    apply: (values) => scale(values, 'R_coil_uohm', (v) => Math.round((v * percent) / 100)),
  };
}

function tauScale([num, den]: readonly [number, number]): Perturbation {
  return {
    name: 'lamp thermal tau x' + String(num / den),
    apply: (values) => scale(values, 'lamp_thermal_tau_us', (v) => Math.round((v * num) / den)),
  };
}

/** The fixed set, in the order bless runs and reports it. */
export const PERTURBATIONS: readonly Perturbation[] = [
  thresholdShift(1),
  thresholdShift(-1),
  coilSpread(1),
  coilSpread(-1),
  ...LAMP_TAU_SCALES.map(tauScale),
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function readRawProfile(id: string): unknown {
  return readStrictJson(new URL('../../data/profiles/' + id + '.json', import.meta.url), id + ' profile');
}

/**
 * Re-run `loaded` once per perturbation and report each in order. A perturbed profile that
 * `loadProfile` rejects, or a perturbed run that throws, fails that perturbation with the reason.
 */
export function checkRobustness(
  loaded: LoadedFixture,
  options: RobustnessOptions = {},
): PerturbationOutcome[] {
  const raw = readRawProfile(loaded.fixture.profile);
  if (loadProfile(raw).hash !== loaded.profile.hash) {
    throw new Error('bless: robustness: ' + loaded.fixture.profile + ' on disk is not the profile the fixture ran with');
  }
  const run = options.run ?? runLoadedFixture;
  return (options.perturbations ?? PERTURBATIONS).map((perturbation) => {
    const name = perturbation.name;
    let profile: Profile;
    try {
      const copy = structuredClone(raw) as { values: Record<string, unknown> };
      perturbation.apply(copy.values);
      profile = loadProfile(copy);
    } catch (error: unknown) {
      return { name, failure: 'perturbed profile rejected: ' + message(error) };
    }
    let result: RunResult;
    try {
      result = run({ ...loaded, profile });
    } catch (error: unknown) {
      return { name, failure: 'perturbed run failed: ' + message(error) };
    }
    const first = result.failures[0];
    if (first === undefined) return { name, failure: null };
    return {
      name,
      failure: 'assertion failed at script[' + first.scriptIndex + '] ' + first.dev +
        ': expected ' + first.expected + ', got ' + first.actual,
    };
  });
}
