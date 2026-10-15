/**
 * The `minivac.profile/1` loader: schema validation, the pinned load-time derivations, the
 * load-time assertions, and R1-R6 as evaluable functions over the post-quantization tick counts.
 *
 * Architecture §10 (where the fallback values live), §10.1 (the normative key list), §4.4 (the
 * pinned derivations), §3.2 and determinism rule 15 (the tick assertion), §5 (the sweep
 * assertion), §6 (tick counts must agree with the µs inputs within one tick), §3.4 (the lamp PWL),
 * and `components.md` §9.3 (the R1-R6 ordering constraints).
 *
 * **There are no physical constants in this file.** Every number the simulator uses comes out of
 * the profile JSON — `DECISIONS.md`, 2026-08-30: *"invented constants live in
 * `data/profiles/*.json`, tagged `[unverified]`, never as constants in code."* The only literals
 * below are unit scales and the structural constants of the pinned formulas: `1_000_000_000` in
 * the mV/µΩ -> µA conversion, `1000` in the mV -> µA-per-tick and milli scales, `360_000_000 / 16`
 * for the rotary pitch, `6` for the six relays, `20` from determinism rule 15, and the integer
 * bounds and formula constants pinned in §13.4.1.
 *
 * DOM-free, dependency-free, no transcendental, no clock, no Map or Set iteration.
 */
import { fnv1a64, iabs, idivRound } from './ints.ts';

/** The three honest provenance tags of architecture §10. */
export type Tag = 'verified-reading' | 'unverified' | 'assumption';

/**
 * The scalar half of architecture §10.1's normative key list, in the table's own row order.
 * Every one is **required** and every one is an integer in the unit its name carries — `_us` µs,
 * `_mv` mV, `_ua` µA, `_uohm` µΩ, `_uh` µH, `_ns` nS, `_milli` milli, `_udeg` µdeg, `_mrpm`
 * milli-rpm, `_ticks` ticks. Strokes are in µs, so no profile value is ever a decimal (§10.1).
 *
 * `R_contact_uohm`, `R_wire_uohm`, and `visual_decay_us` are required but unused keys. Architecture
 * §3.1 and §10.1 retain them in the profile so a porter does not silently change the schema.
 */
export const SCALAR_KEYS = [
  'tick_us',
  'gmin_ns',
  'V_oc_mv',
  'R_src_uohm',
  'I_trip_ua',
  'trip_delay_us',
  'R_coil_uohm',
  'L_coil_uh',
  'V_arc_clamp_mv',
  'V_pullin_mv',
  'V_dropout_mv',
  'relay_operate_stroke_us',
  'relay_release_stroke_us',
  'pushbutton_stroke_us',
  'slide_stroke_us',
  'relay_bounce_us',
  'break_milli',
  'make_milli',
  'R_cold_uohm',
  'R_hot_uohm',
  'I_hot_ua',
  'lamp_thermal_tau_us',
  'lamp_on_milli',
  'lamp_dim_milli',
  'contact_arc_udeg',
  'wiper_offset_udeg',
  'run_mrpm',
  'hand_slew_mrpm',
  'coast_udeg_stop_shorted',
  'coast_udeg_drive_removed',
  'R1_uohm',
  'R2_uohm',
  'R_arm_uohm',
  'settle_quiet_ticks',
  'settle_cap_us',
  'chatter_n',
  'chatter_cycles',
  'chatter_quiet_cycles',
  'min_decision_ua',
  'min_tick_gap',
  'R_contact_uohm',
  'R_wire_uohm',
  'visual_decay_us',
] as const;

export type ScalarKey = (typeof SCALAR_KEYS)[number];

/** The two non-scalar keys of §10.1: six per-relay offsets, and the lamp table. */
export const ARRAY_KEYS = ['dV_relay_mv', 'lamp_pwl_uohm'] as const;

/** The five members of a `minivac.profile/1` document. Anything else is an unknown key. */
export const TOP_KEYS = ['schema', 'id', 'marginal', 'provenance', 'values'] as const;

export const SCHEMA = 'minivac.profile/1';

/** One `[µA, µΩ]` breakpoint of the tungsten table (§3.4). */
export type PwlPoint = readonly [number, number];

/** The load-time derivations pinned in architecture §4.4 and §13.4.1, and nothing else. */
export interface Derived {
  /** `idivRound(V_pullin_mv * 1e9, R_coil_uohm)` — 6500 mV into 150 Ω -> 43_333 µA. */
  readonly pullInUa: number;
  /** `idivRound(V_dropout_mv * 1e9, R_coil_uohm)`. */
  readonly dropOutUa: number;
  /** `relayUa[n] = idivRound((V_pullin_mv + dV_relay_mv[n]) * 1e9, R_coil_uohm)` — six. */
  readonly relayPullInUa: readonly number[];
  /**
   * The same formula with `V_dropout_mv`. §4.4 pins only the pull-in form, but §4.3 says the six
   * offsets are "applied to pull-in and drop-out together" and §8's `State.relays[i]` carries both
   * per instance, so the drop-out companion has to exist; it is derived by the identical shape so
   * a porter has one rule to copy, not two.
   */
  readonly relayDropOutUa: readonly number[];
  /** `strokeTicks = idivRound(stroke_us, tick_us)` — 12000 µs at 100 µs -> 120 ticks. */
  readonly relayOperateTicks: number;
  readonly relayReleaseTicks: number;
  readonly pushbuttonTicks: number;
  readonly slideTicks: number;
  /** `tick_us / (lamp_thermal_tau_us + tick_us)` — a **double**, carried state only (§3.4). */
  readonly kThermal: number;
  /** `idivRound(V_arc_clamp_mv * tick_us * 1000, L_coil_uh)` — µA per tick (§3.3 pass 2). */
  readonly arcStepUa: number;
  readonly tripDelayTicks: number;
  readonly deadShortUa: number;
  readonly rMotorParUohm: number;
  readonly vMotorRunMv: number;
  readonly relayCycleTicks: number;
  readonly buttonCycleTicks: number;
  readonly switchCycleTicks: number;
  readonly dialCycleTicks: number;
  readonly settleCapTicks: number;
}

export interface Profile {
  readonly id: string;
  /** §11's toggle. `MV601-REF-A` is true and is the default; `MV601-IDEAL` is false. */
  readonly marginal: boolean;
  readonly provenance: string;
  /** Bare 16-lowercase-hex FNV-1a 64 of architecture §9.2's semantic payload. */
  readonly hash: string;
  /** Every scalar key of §10.1, by name. A finite literal key union, so indexing is exact. */
  readonly v: Readonly<Record<ScalarKey, number>>;
  /** Six per-relay threshold offsets, mV (§4.3 — six literals, no PRNG). */
  readonly dVRelayMv: readonly number[];
  /** The lamp table, N ∈ {9, 33}, strictly increasing in current (§3.4, §10.1). */
  readonly pwl: readonly PwlPoint[];
  readonly derived: Readonly<Derived>;
}

/** Six relays. The machine has six; this is structure, not a tunable. */
const RELAYS = 6;

/** mV / µΩ -> µA: (mv * 1e-3 V) / (uohm * 1e-6 Ω) = mv * 1e9 / uohm µA. */
const MV_UOHM_TO_UA = 1_000_000_000;

/** Sixteen rotary pads over 360°, in µdeg: the pitch (§5, `D0`..`D15`). */
const PITCH_UDEG = 360_000_000 / 16;

/** Determinism rule 15's own factor: `tick_us * 20 < minDeviceLatencyUs`. */
const TICK_LATENCY_FACTOR = 20;

const INT32_MAX = 2147483647;
const INT64_MIN = -9223372036854775808n;
const INT64_MAX = 9223372036854775807n;

const POSITIVE_INT32_KEYS = [
  'tick_us',
  'V_oc_mv',
  'R_src_uohm',
  'R1_uohm',
  'R2_uohm',
  'R_arm_uohm',
  'I_trip_ua',
  'trip_delay_us',
  'run_mrpm',
  'hand_slew_mrpm',
  'settle_quiet_ticks',
  'settle_cap_us',
  'chatter_n',
  'chatter_cycles',
  'chatter_quiet_cycles',
] as const satisfies readonly ScalarKey[];

const COAST_INT32_KEYS = [
  'coast_udeg_stop_shorted',
  'coast_udeg_drive_removed',
] as const satisfies readonly ScalarKey[];

const BLESSING_GATE_KEYS = [
  'min_decision_ua',
  'min_tick_gap',
] as const satisfies readonly ScalarKey[];

/**
 * R1's stated ratio. `components.md` §9.3 measures the constraint "against a stated requirement of
 * 3x" and reports `MV601-TIMING-A` failing it at 1.04x. It is a constraint threshold, not a
 * property of the machine, so it does not belong in the profile — §10.1's key list has no slot for
 * it and adding one would make the loader reject §10's own example — but it is a number in code,
 * and it is named here rather than buried inline so it is visible when the constraint is read.
 */
const R1_MIN_RATIO = 3;

function fail(msg: string): never {
  throw new Error('profile: ' + msg);
}

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/**
 * Every §10.1 value is integral, so a decimal is a schema error rather than something to round.
 * `isSafeInteger` and not `isInteger`: the derivations multiply by 1e9, and a value that cannot
 * survive that is a bad profile, not a silent loss of precision.
 */
function int(x: unknown, where: string): number {
  if (typeof x !== 'number' || !Number.isSafeInteger(x)) {
    fail(where + ' must be a safe integer, got ' + JSON.stringify(x));
  }
  return x;
}

/**
 * Own-property read. `rejectUnknown` only sees own keys, so a prototype-supplied field would pass
 * the exact-key contract of §10.1 while still being read as a value; this makes the two agree.
 */
function own(o: Record<string, unknown>, key: string): unknown {
  return Object.hasOwn(o, key) ? o[key] : undefined;
}

/** Rejects an unknown key and names it — §10.1: a porter never infers a parameter from prose. */
function rejectUnknown(got: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const k of Object.keys(got)) {
    let ok = false;
    for (const a of allowed) if (a === k) ok = true;
    if (!ok) fail('unknown key ' + JSON.stringify(k) + ' in ' + where);
  }
}

/** Pulls one `{ v, tag, src }` entry, checking that the provenance is really there (§10). */
function entry(values: Record<string, unknown>, key: string): unknown {
  const e = own(values, key);
  if (e === undefined) fail('missing required key ' + JSON.stringify(key));
  if (!isObj(e)) fail(key + ' must be an object { v, tag, src }');
  rejectUnknown(e, ['v', 'tag', 'src'], key);
  const tag = own(e, 'tag');
  if (tag !== 'verified-reading' && tag !== 'unverified' && tag !== 'assumption') {
    fail(key + '.tag must be verified-reading | unverified | assumption, got ' + JSON.stringify(tag));
  }
  const src = own(e, 'src');
  if (typeof src !== 'string' || src.length === 0) fail(key + '.src must be a non-empty citation string');
  if (!Object.hasOwn(e, 'v')) fail(key + '.v is missing');
  return e['v'];
}

/**
 * The lamp table (§3.4, §10.1): N ∈ {9, 33}, `[µA, µΩ]` integer pairs, monotone.
 *
 * "Monotone" is split into the two halves the interpolator of §3.4 actually needs: the currents
 * strictly increase (its `(I - x[j-1]) / (x[j] - x[j-1])` divides by the gap), and the resistances
 * never decrease (the tungsten law rises with current and is clamped, so equal neighbours are
 * legal but an inversion is a corrupt table).
 */
function parsePwl(raw: unknown): readonly PwlPoint[] {
  if (!Array.isArray(raw)) fail('lamp_pwl_uohm must be an array of [uA, uohm] pairs');
  const n = raw.length;
  if (n !== 9 && n !== 33) fail('lamp_pwl_uohm has N=' + n + '; architecture §10.1 allows N in {9, 33}');
  const out: PwlPoint[] = [];
  for (let i = 0; i < n; i++) {
    const p: unknown = raw[i];
    if (!Array.isArray(p) || p.length !== 2) fail('lamp_pwl_uohm[' + i + '] must be a [uA, uohm] pair');
    const x = int(p[0], 'lamp_pwl_uohm[' + i + '][0]');
    const y = int(p[1], 'lamp_pwl_uohm[' + i + '][1]');
    if (x < 0 || y <= 0) fail('lamp_pwl_uohm[' + i + '] must be a non-negative current and a positive resistance');
    if (i > 0) {
      const prev = out[i - 1] as PwlPoint;
      if (x <= prev[0]) fail('lamp_pwl_uohm is not monotone: current ' + x + ' at ' + i + ' does not exceed ' + prev[0]);
      if (y < prev[1]) fail('lamp_pwl_uohm is not monotone: resistance ' + y + ' at ' + i + ' is below ' + prev[1]);
    }
    out.push(Object.freeze([x, y]));
  }
  return Object.freeze(out);
}

function assertW3Domains(v: Readonly<Record<ScalarKey, number>>): void {
  for (const key of POSITIVE_INT32_KEYS) {
    const value = v[key];
    if (value < 1 || value > INT32_MAX) fail(key + ' must be an int32 in 1..2147483647, got ' + value);
  }
  for (const key of COAST_INT32_KEYS) {
    const value = v[key];
    if (value < 0 || value > INT32_MAX) fail(key + ' must be an int32 in 0..2147483647, got ' + value);
  }
  for (const key of BLESSING_GATE_KEYS) {
    const value = v[key];
    if (value < 0 || value > INT32_MAX) fail(key + ' must be an int32 in 0..2147483647, got ' + value);
  }
  if (v.gmin_ns < 0) fail('gmin_ns must be non-negative');
  if (v.V_arc_clamp_mv <= 0) fail('V_arc_clamp_mv must be positive');
  if (v.I_hot_ua <= 0) fail('I_hot_ua must be positive');
  if (v.relay_bounce_us !== 0) fail('relay_bounce_us must be zero: bounce is disabled by architecture §4.4');
}

function checkedSum64(where: string, ...terms: readonly (number | bigint)[]): bigint {
  let sum = 0n;
  for (const term of terms) {
    sum += BigInt(term);
    if (sum < INT64_MIN || sum > INT64_MAX) fail(where + ' overflows signed 64-bit');
  }
  return sum;
}

function checkedProduct64(where: string, ...factors: readonly (number | bigint)[]): bigint {
  let product = 1n;
  for (const factor of factors) {
    product *= BigInt(factor);
    if (product < INT64_MIN || product > INT64_MAX) fail(where + ' overflows signed 64-bit');
  }
  return product;
}

function idivRound64(a: bigint, b: bigint, where: string): bigint {
  if (a < INT64_MIN || a > INT64_MAX || b < INT64_MIN || b > INT64_MAX) {
    fail(where + ' operands must fit signed 64-bit');
  }
  if (b === 0n) fail(where + ' denominator must be positive');
  const q = a / b;
  const r = a % b;
  const absR = r < 0n ? -r : r;
  const absB = b < 0n ? -b : b;
  if (absR >= (absB + 1n) / 2n) return q + ((a < 0n) !== (b < 0n) ? -1n : 1n);
  return q;
}

function positiveInt32(value: bigint, where: string): number {
  if (value < 1n || value > BigInt(INT32_MAX)) fail(where + ' must be a positive int32, got ' + value);
  return Number(value);
}

function assertThresholdPair(where: string, dropOutUa: bigint, pullInUa: bigint): void {
  if (dropOutUa <= 0n || dropOutUa >= pullInUa) {
    fail(
      where + ' thresholds must satisfy 0 < dropOutUa < pullInUa; got dropOutUa ' + dropOutUa +
        ' and pullInUa ' + pullInUa,
    );
  }
}

function checkedWindowProduct(multiplier: number, cycleTicks: number, where: string): void {
  const product = checkedProduct64(where, multiplier, cycleTicks);
  positiveInt32(product, where);
}

/** Architecture §9.2's normative line-oriented ASCII payload. */
function semanticHash(
  v: Readonly<Record<ScalarKey, number>>,
  dV: readonly number[],
  pwl: readonly PwlPoint[],
): string {
  let payload = 'minivac.profile-hash/1\n';
  for (const key of SCALAR_KEYS) payload += key + '=' + v[key] + '\n';
  payload += 'dV_relay_mv=' + dV.join(',') + '\n';
  for (const point of pwl) payload += 'lamp_pwl_uohm=' + point[0] + ':' + point[1] + '\n';
  const bytes = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i++) bytes[i] = payload.charCodeAt(i);
  return fnv1a64(bytes);
}

/** Architecture §4.4 and §13.4.1, evaluated literally and in document order. */
function derive(v: Readonly<Record<ScalarKey, number>>, dV: readonly number[]): Derived {
  if (v.R_coil_uohm <= 0) fail('R_coil_uohm must be positive: every §4.4 threshold divides by it');
  if (v.tick_us <= 0) fail('tick_us must be positive');
  if (v.L_coil_uh <= 0) fail('L_coil_uh must be positive: arcStepUa divides by it');

  const pullInUa64 = idivRound64(
    checkedProduct64('V_pullin_mv * 1000000000', v.V_pullin_mv, MV_UOHM_TO_UA),
    BigInt(v.R_coil_uohm),
    'pullInUa',
  );
  const dropOutUa64 = idivRound64(
    checkedProduct64('V_dropout_mv * 1000000000', v.V_dropout_mv, MV_UOHM_TO_UA),
    BigInt(v.R_coil_uohm),
    'dropOutUa',
  );
  assertThresholdPair('nominal relay', dropOutUa64, pullInUa64);
  const pullInUa = positiveInt32(pullInUa64, 'pullInUa');
  const dropOutUa = positiveInt32(dropOutUa64, 'dropOutUa');

  const relayPullInUa: number[] = [];
  const relayDropOutUa: number[] = [];
  for (let n = 0; n < RELAYS; n++) {
    const d = dV[n] as number;
    const pullInMv = checkedSum64('V_pullin_mv + dV_relay_mv[' + n + ']', v.V_pullin_mv, d);
    const dropOutMv = checkedSum64('V_dropout_mv + dV_relay_mv[' + n + ']', v.V_dropout_mv, d);
    const relayPullInUa64 = idivRound64(
      checkedProduct64(
        '(V_pullin_mv + dV_relay_mv[' + n + ']) * 1000000000',
        pullInMv,
        MV_UOHM_TO_UA,
      ),
      BigInt(v.R_coil_uohm),
      'relayPullInUa[' + n + ']',
    );
    const relayDropOutUa64 = idivRound64(
      checkedProduct64(
        '(V_dropout_mv + dV_relay_mv[' + n + ']) * 1000000000',
        dropOutMv,
        MV_UOHM_TO_UA,
      ),
      BigInt(v.R_coil_uohm),
      'relayDropOutUa[' + n + ']',
    );
    assertThresholdPair('relay ' + (n + 1), relayDropOutUa64, relayPullInUa64);
    relayPullInUa.push(positiveInt32(relayPullInUa64, 'relayPullInUa[' + n + ']'));
    relayDropOutUa.push(positiveInt32(relayDropOutUa64, 'relayDropOutUa[' + n + ']'));
  }

  const relayOperateTicks = idivRound(v.relay_operate_stroke_us, v.tick_us);
  const relayReleaseTicks = idivRound(v.relay_release_stroke_us, v.tick_us);
  const pushbuttonTicks = idivRound(v.pushbutton_stroke_us, v.tick_us);
  const slideTicks = idivRound(v.slide_stroke_us, v.tick_us);

  const tripDelayTicks = positiveInt32(
    idivRound64(BigInt(v.trip_delay_us), BigInt(v.tick_us), 'tripDelayTicks'),
    'tripDelayTicks',
  );
  const deadShortUa = positiveInt32(
    idivRound64(
      checkedProduct64('V_oc_mv * 1000000000', v.V_oc_mv, MV_UOHM_TO_UA),
      BigInt(v.R_src_uohm),
      'deadShortUa',
    ),
    'deadShortUa',
  );
  const rMotorParUohm = positiveInt32(
    idivRound64(
      checkedProduct64('R2_uohm * R_arm_uohm', v.R2_uohm, v.R_arm_uohm),
      BigInt(v.R2_uohm) + BigInt(v.R_arm_uohm),
      'rMotorParUohm',
    ),
    'rMotorParUohm',
  );
  const vMotorRunMv = positiveInt32(
    idivRound64(
      checkedProduct64('V_oc_mv * rMotorParUohm', v.V_oc_mv, rMotorParUohm),
      BigInt(v.R_src_uohm) + BigInt(v.R1_uohm) + BigInt(rMotorParUohm),
      'vMotorRunMv',
    ),
    'vMotorRunMv',
  );
  const relayCycleTicks = positiveInt32(
    BigInt(relayOperateTicks) + BigInt(relayReleaseTicks),
    'relayCycleTicks',
  );
  const buttonCycleTicks = positiveInt32(checkedProduct64('2 * pushbuttonTicks', 2, pushbuttonTicks), 'buttonCycleTicks');
  const switchCycleTicks = positiveInt32(checkedProduct64('2 * slideTicks', 2, slideTicks), 'switchCycleTicks');
  const dialDenominator = checkedProduct64('16 * run_mrpm * tick_us', 16, v.run_mrpm, v.tick_us);
  const dialCycleTicks = positiveInt32(
    idivRound64(60_000_000_000n, dialDenominator, 'dialCycleTicks'),
    'dialCycleTicks',
  );
  const settleCapTicks = positiveInt32(
    idivRound64(BigInt(v.settle_cap_us), BigInt(v.tick_us), 'settleCapTicks'),
    'settleCapTicks',
  );
  const arcStepUa = positiveInt32(
    idivRound64(
      checkedProduct64(
        'V_arc_clamp_mv * tick_us * 1000',
        v.V_arc_clamp_mv,
        v.tick_us,
        1000,
      ),
      BigInt(v.L_coil_uh),
      'arcStepUa',
    ),
    'arcStepUa',
  );

  return Object.freeze({
    pullInUa,
    dropOutUa,
    relayPullInUa: Object.freeze(relayPullInUa),
    relayDropOutUa: Object.freeze(relayDropOutUa),
    relayOperateTicks,
    relayReleaseTicks,
    pushbuttonTicks,
    slideTicks,
    // The one double in this file. §3.4 computes it once at load; §3.5 keeps it off the boundary.
    kThermal: v.tick_us / (v.lamp_thermal_tau_us + v.tick_us),
    arcStepUa,
    tripDelayTicks,
    deadShortUa,
    rMotorParUohm,
    vMotorRunMv,
    relayCycleTicks,
    buttonCycleTicks,
    switchCycleTicks,
    dialCycleTicks,
    settleCapTicks,
  });
}

function assertW3Products(v: Readonly<Record<ScalarKey, number>>, d: Derived): void {
  const angularProduct = checkedProduct64('2147483647 * 6 * tick_us', INT32_MAX, 6, v.tick_us);
  if (angularProduct + 999n > INT64_MAX) fail('2147483647 * 6 * tick_us + 999 overflows signed 64-bit');
  if (v.chatter_n === INT32_MAX) fail('chatter_n + 1 must fit int32');

  const cycles = [
    ['relay', d.relayCycleTicks],
    ['button', d.buttonCycleTicks],
    ['switch', d.switchCycleTicks],
    ['dial', d.dialCycleTicks],
  ] as const;
  for (const [device, cycleTicks] of cycles) {
    checkedWindowProduct(v.chatter_cycles, cycleTicks, 'chatter_cycles * ' + device + 'CycleTicks');
    checkedWindowProduct(v.chatter_quiet_cycles, cycleTicks, 'chatter_quiet_cycles * ' + device + 'CycleTicks');
  }
}

/**
 * The shortest latency any modelled device has, in µs — the quantity determinism rule 15 compares
 * the tick against.
 *
 * The four mechanical strokes and the filament time constant. `relay_bounce_us` is deliberately
 * **not** in the min: architecture §4.4 adopts it at 0 and disables it, and a zero-length latency
 * is not a latency. If a measurement ever raises it above zero it belongs in this min, and rule
 * 15 will then have something to say about a 0.5 ms bounce against a 100 µs tick.
 */
function minDeviceLatencyUs(v: Readonly<Record<ScalarKey, number>>): number {
  let m = v.relay_operate_stroke_us;
  if (v.relay_release_stroke_us < m) m = v.relay_release_stroke_us;
  if (v.pushbutton_stroke_us < m) m = v.pushbutton_stroke_us;
  if (v.slide_stroke_us < m) m = v.slide_stroke_us;
  if (v.lamp_thermal_tau_us < m) m = v.lamp_thermal_tau_us;
  return m;
}

/**
 * µdeg the wiper covers in one tick at `mrpm` milli-rpm.
 *
 * `(mrpm / 1000) rev/min * 360e6 µdeg/rev / 60e6 µs/min * tick_us` = `mrpm * 6 * tick_us / 1000`.
 * 45 rpm at a 100 µs tick is 27 000 µdeg. §5 does not pin the rounding of this one and the
 * assertion it feeds clears by two orders of magnitude, so `idivRound` is used for consistency
 * with §4.4 rather than because the choice can change an outcome.
 */
export function sweepUdegPerTick(mrpm: number, tickUs: number): number {
  return idivRound(mrpm * 6 * tickUs, 1000);
}

/** Everything architecture asserts at profile load. Throws; there is no "load anyway" path. */
function assertLoadTime(v: Readonly<Record<ScalarKey, number>>, d: Derived): void {
  if (v.R_cold_uohm <= 0) fail('R_cold_uohm must be positive');
  if (v.R_hot_uohm <= v.R_cold_uohm) fail('R_hot_uohm must be greater than R_cold_uohm');
  const rColdOhm = v.R_cold_uohm * 1e-6;
  const rHotOhm = v.R_hot_uohm * 1e-6;
  const rLampSpanOhm = rHotOhm - rColdOhm;
  if (!Number.isFinite(rLampSpanOhm) || rLampSpanOhm <= 0) {
    fail('lamp-resistance span must be finite and positive after µΩ-to-Ω conversion');
  }

  // Determinism rule 15 / §3.2: the tick IS the fixpoint only because it is two orders of
  // magnitude under the shortest device latency. A coarser tick voids rule 9's justification.
  const minLatency = minDeviceLatencyUs(v);
  if (v.tick_us * TICK_LATENCY_FACTOR >= minLatency) {
    fail(
      'the tick is no longer the fixpoint: tick_us * ' + TICK_LATENCY_FACTOR + ' = ' +
        v.tick_us * TICK_LATENCY_FACTOR + ' µs is not below the shortest device latency ' + minLatency + ' µs',
    );
  }

  // §5: the wiper must not step across a whole dead gap in one tick, or a make/break pair is
  // skipped and the Combination Lock's D8 trap stops trapping. Both rates bound it — hand motion
  // has its own, and `dialGrab` must still traverse every pad on the way to a far target.
  if (v.contact_arc_udeg <= 0 || v.contact_arc_udeg >= PITCH_UDEG) {
    fail('contact_arc_udeg must lie strictly inside the ' + PITCH_UDEG + ' µdeg pad pitch (O-R1: 0 < gap < 22.5°)');
  }
  const deadGapUdeg = PITCH_UDEG - v.contact_arc_udeg;
  const fastest = v.run_mrpm > v.hand_slew_mrpm ? v.run_mrpm : v.hand_slew_mrpm;
  const perTick = sweepUdegPerTick(fastest, v.tick_us);
  if (perTick >= deadGapUdeg) {
    fail('a contact can be skipped: ' + perTick + ' µdeg per tick at ' + fastest + ' mrpm vs a ' + deadGapUdeg + ' µdeg dead gap');
  }

  // §6: R1-R6 are evaluated on the post-quantization tick counts, so those counts have to be the
  // µs inputs. `idivRound` rounds to nearest, so the error is at most half a tick by construction:
  // this asserts that contract on the derivation rather than filtering profile values, and fires
  // only if a stroke stops being quantized by nearest-integer division.
  assertTickAgreement('relay_operate_stroke_us', v.relay_operate_stroke_us, d.relayOperateTicks, v.tick_us);
  assertTickAgreement('relay_release_stroke_us', v.relay_release_stroke_us, d.relayReleaseTicks, v.tick_us);
  assertTickAgreement('pushbutton_stroke_us', v.pushbutton_stroke_us, d.pushbuttonTicks, v.tick_us);
  assertTickAgreement('slide_stroke_us', v.slide_stroke_us, d.slideTicks, v.tick_us);

  // §4.3's bands have to be orderable at all: break < make is what makes the both-open window a
  // window, and it is the quantity R1 is a statement about.
  if (v.break_milli < 0 || v.make_milli > 1000 || v.break_milli >= v.make_milli) {
    fail('break_milli ' + v.break_milli + ' and make_milli ' + v.make_milli + ' must satisfy 0 <= break < make <= 1000 (§4.3)');
  }
  // §9.2's three-band lamp classification, same reason.
  if (
    v.lamp_dim_milli < 0 || v.lamp_dim_milli >= v.lamp_on_milli ||
    v.lamp_on_milli > 1000
  ) {
    fail(
      'lamp thresholds ' + v.lamp_dim_milli + ' and ' + v.lamp_on_milli +
        ' must satisfy 0 <= lamp_dim_milli < lamp_on_milli <= 1000 (§9.2)',
    );
  }
}

function assertPwlColdAnchor(pwl: readonly PwlPoint[], rColdUohm: number): void {
  const first = pwl[0] as PwlPoint;
  if (first[0] !== 0) fail('lamp_pwl_uohm[0] current must be 0, got ' + first[0]);
  if (first[1] !== rColdUohm) {
    fail(
      'lamp_pwl_uohm[0] resistance must equal R_cold_uohm ' + rColdUohm + ', got ' + first[1],
    );
  }
}

function assertTickAgreement(key: string, us: number, ticks: number, tickUs: number): void {
  const err = iabs(ticks * tickUs - us);
  if (err * 2 > tickUs) {
    fail(key + ' quantizes to ' + ticks + ' ticks = ' + ticks * tickUs + ' µs, which is ' + err + ' µs from ' + us + ' µs (§6: within half a tick)');
  }
}

/**
 * Parse, validate, derive and assert a `minivac.profile/1` document.
 *
 * Rejects an unknown key and a missing required key, at the top level and inside `values`
 * (§10.1). Throws on the first problem with the key named — a profile is a handful of numbers a
 * human edits, so the first error is the useful one.
 */
export function loadProfile(raw: unknown): Profile {
  if (!isObj(raw)) fail('a profile is a JSON object');
  rejectUnknown(raw, TOP_KEYS, 'the profile document');
  const schema = own(raw, 'schema');
  if (schema !== SCHEMA) fail('schema must be ' + JSON.stringify(SCHEMA) + ', got ' + JSON.stringify(schema));
  const id = own(raw, 'id');
  if (typeof id !== 'string' || id.length === 0) fail('id must be a non-empty string');
  const marginal = own(raw, 'marginal');
  if (typeof marginal !== 'boolean') fail('marginal must be a boolean (§11: the toggle is a profile swap)');
  const provenance = own(raw, 'provenance');
  if (typeof provenance !== 'string' || provenance.length === 0) fail('provenance must be a non-empty string (§10)');

  const values = own(raw, 'values');
  if (!isObj(values)) fail('values must be an object');
  const allKeys: string[] = [];
  for (const k of SCALAR_KEYS) allKeys.push(k);
  for (const k of ARRAY_KEYS) allKeys.push(k);
  rejectUnknown(values, allKeys, 'values');

  const v = {} as Record<ScalarKey, number>;
  for (const k of SCALAR_KEYS) v[k] = int(entry(values, k), k);
  assertW3Domains(v);

  const rawDv = entry(values, 'dV_relay_mv');
  if (!Array.isArray(rawDv) || rawDv.length !== RELAYS) fail('dV_relay_mv must be ' + RELAYS + ' integers, one per relay (§4.3)');
  const dVRelayMv: number[] = [];
  for (let n = 0; n < RELAYS; n++) dVRelayMv.push(int(rawDv[n], 'dV_relay_mv[' + n + ']'));

  const pwl = parsePwl(entry(values, 'lamp_pwl_uohm'));

  const frozenValues = Object.freeze(v);
  const frozenDv = Object.freeze(dVRelayMv);
  const derived = derive(frozenValues, frozenDv);
  assertW3Products(frozenValues, derived);
  assertLoadTime(v, derived);
  assertPwlColdAnchor(pwl, v.R_cold_uohm);
  const hash = semanticHash(frozenValues, frozenDv, pwl);
  return Object.freeze({ id, marginal, provenance, hash, v: frozenValues, dVRelayMv: frozenDv, pwl, derived });
}

// ---------------------------------------------------------------------------------------------
// R1-R6 — `components.md` §9.3's ordering constraints.
//
// Each is a function over the **post-quantization integer tick counts** (§6, §10.1), returning a
// numeric margin rather than a boolean so a caller can report how close it came. `check-profile`
// is the gate; this file only computes.
// ---------------------------------------------------------------------------------------------

export type ConstraintId = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'R6';

export interface ConstraintResult {
  id: ConstraintId;
  /** `unevaluated` when an input this constraint needs was not supplied — never a silent pass. */
  status: 'pass' | 'fail' | 'unevaluated';
  actual: number;
  required: number;
  /** `actual - required`, in `unit`. Positive is slack. */
  margin: number;
  unit: 'ticks' | 'ua' | 'none';
  /** The formula, evaluated, with its citation. */
  why: string;
}

/**
 * What R2-R6 need that a profile cannot contain.
 *
 * A hold duration is a property of a *script*, not of the machine; the shorted-release hold-off
 * and R6's two verdicts are properties of a *circuit*. `profile.ts` must not run one (§13.1 keeps
 * the solver in `solve.ts`), so they arrive as inputs and `null` means "not measured" — which
 * reports as `unevaluated`, not as a pass.
 */
export interface ConstraintInputs {
  /** R2, R4 — ticks pushbutton 6 is held down. */
  buttonHoldTicks: number | null;
  /** R3 — ticks between a release and the next press. */
  buttonUpTicks: number | null;
  /**
   * R2, R4 — the freewheeling hold-off, in ticks, before a short-circuited coil's current falls
   * to drop-out and the mechanical release stroke begins (§4.2). Solver-measured: architecture
   * §4.2 replaced `relay_release_shorted_ms` with exactly this derived quantity.
   */
  shortedHoldOffTicks: number | null;
  /**
   * R4 — the carry chain at the step under test. `components.md` §9.3's device-time chain lengths
   * are 1,2,1,3,1,2,1,3 for 0->1 .. 7->0: a stage going 1->0 does a shorted release and emits a
   * carry, a stage going 0->1 does an operate and terminates the chain.
   */
  carryChain: { shortedReleases: number; operates: number } | null;
  /** R5 — the supply ripple period in µs, or `null` when ripple is off (`components.md` §9.3). */
  ripplePeriodUs: number | null;
  /** R6 — the solver's two verdicts and the decision margin it measured, in µA. */
  r6: { miscountsWithLamp: boolean; countsWithoutLamp: boolean; marginUa: number } | null;
}

function result(
  id: ConstraintId,
  actual: number,
  required: number,
  pass: boolean,
  unit: 'ticks' | 'ua' | 'none',
  why: string,
): ConstraintResult {
  return { id, status: pass ? 'pass' : 'fail', actual, required, margin: actual - required, unit, why };
}

function unevaluated(id: ConstraintId, why: string): ConstraintResult {
  return { id, status: 'unevaluated', actual: 0, required: 0, margin: 0, unit: 'none', why };
}

/** The both-open window, in ticks: the travel from `make_milli` down to `break_milli` (§4.3). */
export function bothOpenTicks(p: Profile): number {
  return idivRound((p.v.make_milli - p.v.break_milli) * p.derived.relayReleaseTicks, 1000);
}

/** Ticks for a releasing armature to fall from its stop (1000) to `break_milli` — it loses NC. */
export function releaseToBreakTicks(p: Profile): number {
  return idivRound((1000 - p.v.break_milli) * p.derived.relayReleaseTicks, 1000);
}

/**
 * R1 — the both-open window must be far shorter than the release, checked against the
 * **shorted**-release stroke. `components.md` §9.3, and it is the constraint architecture §4.4
 * repaired `break_milli` / `make_milli` for.
 *
 *   bothOpen   = (make_milli − break_milli) / 1000 × relayReleaseTicks
 *   toBreak    = (1000 − break_milli)       / 1000 × relayReleaseTicks
 *   require      toBreak ≥ 3 × bothOpen
 *
 * §9.3's own failing arithmetic is the same shape on `MV601-TIMING-A`: float = 0.25 × 20.0 ms =
 * 5.0 ms against relay 2 reaching `break_frac` at (1 − 0.35) × 8.0 ms = 5.2 ms, margin 1.04×
 * against a stated 3×.
 *
 * **Both terms are mechanical, and that is a consequence of architecture §4.2, not an oversight.**
 * §4.2 collapsed `relay_release_open_ms` and `relay_release_shorted_ms` into one mechanical
 * `relay_release_stroke_us`; the electrical hold-off delays when a short-circuited armature starts
 * moving but does not lengthen the window it spends between the stops, and §4.3 gives travel one
 * release rate regardless of the electrical path. So under this architecture R1 reduces to a
 * statement about the two travel fractions alone — `(1000 − break) ≥ 3 × (make − break)` — and the
 * shorted/open distinction it was written against no longer discriminates.
 */
function evalR1(p: Profile): ConstraintResult {
  const bothOpen = bothOpenTicks(p);
  const toBreak = releaseToBreakTicks(p);
  const required = R1_MIN_RATIO * bothOpen;
  return result(
    'R1',
    toBreak,
    required,
    toBreak >= required,
    'ticks',
    'both-open ' + bothOpen + ' ticks vs the fed relay reaching break at ' + toBreak +
      ' ticks; components.md §9.3 R1 wants ' + R1_MIN_RATIO + 'x',
  );
}

/**
 * R2 — the minimum button hold must exceed `max(t_operate, t_release_shorted)`: the push phase has
 * to complete before the release phase evaluates. `components.md` §9.3; this is ERRATA Book IV
 * p.69's "push pushbutton 6 slowly".
 *
 *   t_release_shorted = shortedHoldOffTicks + relayReleaseTicks      (§4.2)
 *   require  buttonHoldTicks > max(relayOperateTicks, t_release_shorted)
 */
function evalR2(p: Profile, inp: ConstraintInputs): ConstraintResult {
  if (inp.buttonHoldTicks === null || inp.shortedHoldOffTicks === null) {
    return unevaluated('R2', 'needs buttonHoldTicks (a script property) and shortedHoldOffTicks (solver-measured, §4.2)');
  }
  const shorted = inp.shortedHoldOffTicks + p.derived.relayReleaseTicks;
  const required = p.derived.relayOperateTicks > shorted ? p.derived.relayOperateTicks : shorted;
  return result(
    'R2',
    inp.buttonHoldTicks,
    required,
    inp.buttonHoldTicks > required,
    'ticks',
    'hold ' + inp.buttonHoldTicks + ' vs max(operate ' + p.derived.relayOperateTicks + ', shorted release ' + shorted + ')',
  );
}

/**
 * R3 — the minimum button-up interval must exceed the slave relay's operate: the release phase has
 * to complete before the next press. `components.md` §9.3.
 *
 *   require  buttonUpTicks > relayOperateTicks
 */
function evalR3(p: Profile, inp: ConstraintInputs): ConstraintResult {
  if (inp.buttonUpTicks === null) return unevaluated('R3', 'needs buttonUpTicks (a script property)');
  const required = p.derived.relayOperateTicks;
  return result(
    'R3',
    inp.buttonUpTicks,
    required,
    inp.buttonUpTicks > required,
    'ticks',
    'button-up ' + inp.buttonUpTicks + ' vs slave operate ' + required,
  );
}

/**
 * R4 — the minimum hold must cover the sum along the **actual** carry chain, with the terminating
 * stage contributing an operate when it goes 0->1. `components.md` §9.3, and ERRATA Book IV p.72's
 * "hold the pushbutton down long enough for any carry to propagate to the highest stage".
 *
 *   required = shortedReleases × (shortedHoldOffTicks + relayReleaseTicks)
 *            + operates        × relayOperateTicks
 *   require  buttonHoldTicks ≥ required
 *
 * The ripple is serial on the DOWN edge, so the chain is a sum and not a max — which is why this
 * is the constraint that separates `IV-EXP1-SLOW` from `IV-EXP1-FAST`.
 */
function evalR4(p: Profile, inp: ConstraintInputs): ConstraintResult {
  if (inp.buttonHoldTicks === null || inp.shortedHoldOffTicks === null || inp.carryChain === null) {
    return unevaluated('R4', 'needs buttonHoldTicks, shortedHoldOffTicks and the carry chain composition');
  }
  const shorted = inp.shortedHoldOffTicks + p.derived.relayReleaseTicks;
  const required = inp.carryChain.shortedReleases * shorted + inp.carryChain.operates * p.derived.relayOperateTicks;
  return result(
    'R4',
    inp.buttonHoldTicks,
    required,
    inp.buttonHoldTicks >= required,
    'ticks',
    'hold ' + inp.buttonHoldTicks + ' vs ' + inp.carryChain.shortedReleases + ' shorted releases of ' + shorted +
      ' + ' + inp.carryChain.operates + ' operates of ' + p.derived.relayOperateTicks,
  );
}

/**
 * R5 — operate and release must both exceed the ripple period, **if ripple is enabled**, or the
 * relays chatter at 120 Hz, which the real machine demonstrably does not do. `components.md` §9.3.
 *
 *   require  min(relayOperateTicks, relayReleaseTicks) > idivRound(ripplePeriodUs, tick_us)
 *
 * `minivac.profile/1` has no ripple key (§10.1) and `components.md` §9.3 ships `supply_ripple`
 * default OFF, so the period arrives as an input: passing it in is the only way to turn this
 * constraint on, and passing `null` reports `unevaluated` rather than a pass it did not earn.
 */
function evalR5(p: Profile, inp: ConstraintInputs): ConstraintResult {
  if (inp.ripplePeriodUs === null) {
    return unevaluated('R5', 'ripple is off (components.md §9.3 ships supply_ripple default OFF; §10.1 has no ripple key)');
  }
  const required = idivRound(inp.ripplePeriodUs, p.v.tick_us);
  const actual = p.derived.relayOperateTicks < p.derived.relayReleaseTicks ? p.derived.relayOperateTicks : p.derived.relayReleaseTicks;
  return result(
    'R5',
    actual,
    required,
    actual > required,
    'ticks',
    'min(operate ' + p.derived.relayOperateTicks + ', release ' + p.derived.relayReleaseTicks + ') vs a ' +
      inp.ripplePeriodUs + ' µs ripple period = ' + required + ' ticks',
  );
}

/**
 * R6 — lamp-in-series must make the counter marginal; lamp bypassed must make it reliable. The
 * only ordering constraint anchored to a **verified** primary statement about observable
 * behaviour (`components.md` §9.3, ERRATA Book IV p.72).
 *
 * **R6 needs the solver and this file must not run a circuit.** The two verdicts come in as inputs
 * from `check-profile`, together with the decision margin it measured. What `profile.ts` supplies
 * are the numbers R6 is evaluated against, and they are all in `why`: the nominal pull-in current,
 * the six per-relay pull-in currents derived from the offsets, and the operate stroke used by the
 * supplied solver verdict.
 */
function evalR6(p: Profile, inp: ConstraintInputs): ConstraintResult {
  const numbers =
    'evaluated on pullInUa=' + p.derived.pullInUa + ', relayPullInUa=[' + p.derived.relayPullInUa.join(',') +
    '], operate=' + p.derived.relayOperateTicks + ' ticks, arcStep=' + p.derived.arcStepUa + ' µA/tick';
  if (inp.r6 === null) return unevaluated('R6', 'needs the solver: ' + numbers);
  const pass = inp.r6.miscountsWithLamp && inp.r6.countsWithoutLamp;
  return result(
    'R6',
    inp.r6.marginUa,
    0,
    pass,
    'ua',
    'lamp in series miscounts=' + inp.r6.miscountsWithLamp + ', lamp bypassed counts=' + inp.r6.countsWithoutLamp + '; ' + numbers,
  );
}

/** R1-R6 in order. Six results, always — an unsupplied input is `unevaluated`, never a pass. */
export function evalConstraints(p: Profile, inp: ConstraintInputs): ConstraintResult[] {
  return [evalR1(p), evalR2(p, inp), evalR3(p, inp), evalR4(p, inp), evalR5(p, inp), evalR6(p, inp)];
}
