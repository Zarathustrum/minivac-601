/**
 * Integer rotary control for architecture §5 and §13.4.5.
 *
 * The motor is a rate law over the solved armature voltage, not a dynamical model. Stopping is the
 * one-shot configured angular offset, chosen by the brake in force when the drive goes (see
 * `stepRotary` for the one case where that choice waits for a contact to land) and scaled by the
 * speed it stops from (`scaledCoastUdeg`). Crossings are reported through a caller-owned sink so a
 * Machine tick needs no temporary Event array.
 *
 * DOM-free, dependency-free, no filesystem, no clock, no transcendental arithmetic.
 */
import { iabs, idivRound, mod } from './ints.ts';
import type { PortFlags } from './ints.ts';
import type { Profile } from './profile.ts';

const FULL_UDEG = 360_000_000;
const HALF_UDEG = FULL_UDEG / 2;
const PITCH_UDEG = FULL_UDEG / 16;
const RATE_DENOMINATOR = 1000;
const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;
const UINT32 = 4294967296;
const LIMB = 65536;

export type RotaryEdgeKind = 'make' | 'break';

/** A no-allocation edge sink. Machine maps these directly to `dial.make` / `dial.break` Events. */
export type RotaryEdgeSink = (kind: RotaryEdgeKind, pos: number) => void;

/** Machine-owned rotary state. `remainder` is the signed numerator remainder in thousandths. */
export interface RotaryState {
  udeg: number;
  contact: number | null;
  held: boolean;
  targetUdeg: number;
  mrpm: number;
  remainder: number;
  lastMotorMrpm: number;
  /**
   * Ticks the one-shot coast has waited for a mid-transfer contact to land (0 = not waiting). While it
   * is non-zero, `lastMotorMrpm` keeps the last driven rate: the coast is still owed, in that direction.
   */
  coastDeferTicks: number;
}

/** Architecture §5's circular integer contact algorithm, verbatim in integer units. */
export function contactAt(udeg: number, profile: Profile): number | null {
  const offset = mod(profile.v.wiper_offset_udeg, FULL_UDEG);
  const phi = mod(udeg - offset, FULL_UDEG);
  const k = idivRound(phi, PITCH_UDEG); // 0..16; reduction happens only after the difference.
  const raw = phi - k * PITCH_UDEG;
  const d = iabs(raw);
  return d * 2 <= profile.v.contact_arc_udeg ? k % 16 : null;
}

/** The power-off, breaker-clear construction state of §13.4.3. */
export function createRotaryState(profile: Profile): RotaryState {
  return {
    udeg: 0,
    contact: contactAt(0, profile),
    held: false,
    targetUdeg: 0,
    mrpm: 0,
    remainder: 0,
    lastMotorMrpm: 0,
    coastDeferTicks: 0,
  };
}

/** Accept an already-validated `dialGrab` target. A new grab is a controller change. */
export function grabRotary(state: RotaryState, targetUdeg: number): void {
  state.held = true;
  state.targetUdeg = targetUdeg;
  state.mrpm = 0;
  state.remainder = 0;
  state.lastMotorMrpm = 0;
  state.coastDeferTicks = 0;
}

/** Release hand control. Motor control resumes when the next tick supplies its solved voltage. */
export function releaseRotary(state: RotaryState): void {
  if (!state.held) return;
  state.held = false;
  state.mrpm = 0;
  state.remainder = 0;
  state.lastMotorMrpm = 0;
  state.coastDeferTicks = 0;
}

/**
 * §13.4.5's signed armature-voltage rate law, including its int32 portability clamp. `vMotorMv` is
 * V(D18)-V(D19); travel is positive (increasing numbers) when it is negative, i.e. with D17 at + and
 * D18 at - (Book I p.23 Exp 13; Tom's ruling, docs/DECISIONS.md 2026-10-13).
 */
export function motorRateMrpm(vMotorMv: number | null, profile: Profile, flags: PortFlags): number {
  if (vMotorMv === null || vMotorMv === 0) return 0;

  // Exact unsigned 32x32 -> 64 multiplication in four 16-bit partial products. Keeping the high
  // and low words as separate numbers avoids both Number's 53-bit ceiling and heap-backed integers.
  const a = profile.v.run_mrpm;
  const b = vMotorMv < 0 ? -vMotorMv : vMotorMv;
  const a0 = a % LIMB;
  const a1 = Math.floor(a / LIMB);
  const b0 = b % LIMB;
  const b1 = Math.floor(b / LIMB);
  const p0 = a0 * b0;
  const p1 = a0 * b1;
  const p2 = a1 * b0;
  const p3 = a1 * b1;
  const middle = Math.floor(p0 / LIMB) + (p1 % LIMB) + (p2 % LIMB);
  const numeratorLo = (p0 % LIMB) + (middle % LIMB) * LIMB;
  const numeratorHi = p3 + Math.floor(p1 / LIMB) + Math.floor(p2 / LIMB) + Math.floor(middle / LIMB);

  // Exact unsigned 64/positive-uint32 long division. `remainder * 2 + bit` stays below 2^32,
  // while quotient words are built from powers of two that are exact doubles.
  const divisor = profile.derived.vMotorRunMv;
  let quotientHi = 0;
  let quotientLo = 0;
  let remainder = 0;
  for (let bit = 63; bit >= 0; bit--) {
    const word = bit >= 32 ? numeratorHi : numeratorLo;
    const wordBit = bit >= 32 ? bit - 32 : bit;
    remainder = remainder * 2 + ((word >>> wordBit) & 1);
    if (remainder >= divisor) {
      remainder -= divisor;
      if (bit >= 32) quotientHi += 2 ** (bit - 32);
      else quotientLo += 2 ** bit;
    }
  }
  if (remainder * 2 >= divisor) {
    quotientLo++;
    if (quotientLo === UINT32) {
      quotientLo = 0;
      quotientHi++;
    }
  }

  if (vMotorMv < 0 && (quotientHi !== 0 || quotientLo > INT32_MAX)) {
    flags.nonPortable = true;
    return INT32_MAX;
  }
  if (vMotorMv > 0 && (quotientHi !== 0 || quotientLo > -INT32_MIN)) {
    flags.nonPortable = true;
    return INT32_MIN;
  }
  const result = vMotorMv > 0 ? -quotientLo : quotientLo;
  return result === 0 ? 0 : result;
}

/** Shortest target delta, with the exact 180° tie resolved in the positive direction. */
function handDelta(udeg: number, targetUdeg: number): number {
  const positive = mod(targetUdeg - udeg, FULL_UDEG);
  return positive > HALF_UDEG ? positive - FULL_UDEG : positive;
}

/**
 * Enumerate every integer contact-state boundary in physical travel order. Contact endpoints are
 * inclusive, so positive breaks occur one µdeg above an upper endpoint and negative breaks one
 * µdeg below a lower endpoint.
 */
function applyDisplacement(
  state: RotaryState,
  negative: boolean,
  displacementHi: number,
  displacementLo: number,
  profile: Profile,
  emit: RotaryEdgeSink,
): void {
  if (displacementHi === 0 && displacementLo === 0) return;

  const radius = Math.floor(profile.v.contact_arc_udeg / 2);
  const offset = mod(profile.v.wiper_offset_udeg, FULL_UDEG);
  let cursor = state.udeg;
  let remainingHi = displacementHi;
  let remainingLo = displacementLo;

  while (true) {
    let found = false;
    let nextDistance = 0;
    let nextUdeg = 0;
    let nextKind: RotaryEdgeKind = 'make';
    let nextPos = 0;

    for (let pos = 0; pos < 16; pos++) {
      const center = offset + pos * PITCH_UDEG;
      const makeUdeg = mod(negative ? center + radius : center - radius, FULL_UDEG);
      const breakUdeg = mod(negative ? center - radius - 1 : center + radius + 1, FULL_UDEG);
      let makeDistance = negative ? cursor - makeUdeg : makeUdeg - cursor;
      let breakDistance = negative ? cursor - breakUdeg : breakUdeg - cursor;
      if (makeDistance <= 0) makeDistance += FULL_UDEG;
      if (breakDistance <= 0) breakDistance += FULL_UDEG;

      if (!found || makeDistance < nextDistance) {
        found = true;
        nextDistance = makeDistance;
        nextUdeg = makeUdeg;
        nextKind = 'make';
        nextPos = pos;
      }
      if (breakDistance < nextDistance) {
        nextDistance = breakDistance;
        nextUdeg = breakUdeg;
        nextKind = 'break';
        nextPos = pos;
      }
    }

    if (!found || (remainingHi === 0 && remainingLo < nextDistance)) break;
    if (remainingLo < nextDistance) {
      remainingLo = remainingLo + UINT32 - nextDistance;
      remainingHi--;
    } else {
      remainingLo -= nextDistance;
    }
    cursor = nextUdeg;
    emit(nextKind, nextPos);
  }

  // Once fewer than one boundary remains, the high word is necessarily zero and the low word is
  // below one revolution. The update therefore remains an exact Number integer.
  state.udeg = mod(cursor + (negative ? -remainingLo : remainingLo), FULL_UDEG);
  state.contact = contactAt(state.udeg, profile);
}

/**
 * Integrate an int32 rate through one profile tick, then move by the exact signed int64 quotient.
 * A positive `clampMagnitude` is the hand target distance; zero means unbounded motor travel.
 */
function integrateAndMove(
  state: RotaryState,
  rate: number,
  clampMagnitude: number,
  profile: Profile,
  emit: RotaryEdgeSink,
): boolean {
  const magnitude = rate < 0 ? -rate : rate;
  const tickUs = profile.v.tick_us;
  const a0 = magnitude % LIMB;
  const a1 = Math.floor(magnitude / LIMB);
  const b0 = tickUs % LIMB;
  const b1 = Math.floor(tickUs / LIMB);
  const p0 = a0 * b0;
  const p1 = a0 * b1;
  const p2 = a1 * b0;
  const p3 = a1 * b1;
  const middle = Math.floor(p0 / LIMB) + (p1 % LIMB) + (p2 % LIMB);
  let numeratorLo = (p0 % LIMB) + (middle % LIMB) * LIMB;
  let numeratorHi = p3 + Math.floor(p1 / LIMB) + Math.floor(p2 / LIMB) + Math.floor(middle / LIMB);

  const timesSix = numeratorLo * 6;
  numeratorLo = timesSix % UINT32;
  numeratorHi = numeratorHi * 6 + Math.floor(timesSix / UINT32);

  let negative = rate < 0;
  const carried = state.remainder;
  if (carried !== 0) {
    const carriedNegative = carried < 0;
    const carriedMagnitude = carriedNegative ? -carried : carried;
    if (carriedNegative === negative) {
      numeratorLo += carriedMagnitude;
      if (numeratorLo >= UINT32) {
        numeratorLo -= UINT32;
        numeratorHi++;
      }
    } else if (numeratorHi === 0 && numeratorLo < carriedMagnitude) {
      numeratorLo = carriedMagnitude - numeratorLo;
      negative = !negative;
    } else if (numeratorHi === 0 && numeratorLo === carriedMagnitude) {
      numeratorLo = 0;
      negative = false;
    } else if (numeratorLo < carriedMagnitude) {
      numeratorLo = numeratorLo + UINT32 - carriedMagnitude;
      numeratorHi--;
    } else {
      numeratorLo -= carriedMagnitude;
    }
  }

  // Exact unsigned 64/1000 division in base 2^32. The combined low division is below 2^53.
  const quotientHi = Math.floor(numeratorHi / RATE_DENOMINATOR);
  const highRemainder = numeratorHi - quotientHi * RATE_DENOMINATOR;
  const combined = highRemainder * UINT32 + numeratorLo;
  const quotientLo = Math.floor(combined / RATE_DENOMINATOR);
  const remainder = combined - quotientLo * RATE_DENOMINATOR;
  state.remainder = remainder === 0 ? 0 : negative ? -remainder : remainder;

  if (clampMagnitude > 0 && (quotientHi !== 0 || quotientLo >= clampMagnitude)) {
    state.remainder = 0;
    applyDisplacement(state, negative, 0, clampMagnitude, profile, emit);
    return true;
  }
  applyDisplacement(state, negative, quotientHi, quotientLo, profile, emit);
  return false;
}

/** The longest relay, pushbutton or slide stroke: the cap on a deferred coast (`stepRotary`). */
function longestStrokeTicks(profile: Profile): number {
  const d = profile.derived;
  let ticks = d.relayOperateTicks;
  if (d.relayReleaseTicks > ticks) ticks = d.relayReleaseTicks;
  if (d.pushbuttonTicks > ticks) ticks = d.pushbuttonTicks;
  if (d.slideTicks > ticks) ticks = d.slideTicks;
  return ticks;
}

/**
 * COAST SCALES WITH SPEED (`[unverified]`, fallback `COAST-SCALES-WITH-SPEED`, open-questions.md
 * O-R13; the offsets themselves are INVENTED, O-R5).
 * The configured offsets are read as the overrun from RUN speed. A permanent-magnet armature under
 * dynamic (back-EMF) braking decelerates in proportion to its speed, so its stopping distance is
 * proportional to the speed it stops from: `coast * min(1, speed / run_mrpm)`. Without this a creep
 * of a few per cent of RUN (V-EXP12's coil-flyback reverse drive) took the whole 20° jump and
 * landed a pad short of Books V-VI p.23's "will turn to the number drawn on the matrix".
 *
 * Capped at 1: power across STOP runs the motor faster than RUN (Maintenance p.9), and the cap
 * keeps every stop at or above RUN speed on exactly the configured offset, so no stop overruns
 * further than the pad-tuned numbers allow. stops at or above the unloaded RUN rate keep the configured offset; a loaded RUN stop, typically 96-99.5% of run_mrpm, shrinks by that fraction.
 *
 * Exact integer `coast * speed / run_mrpm`, rounded half away from zero like `idivRound` (§4.4).
 * Below the cap `speed < run_mrpm <= INT32_MAX`, so the product can reach 2^62, past Number's
 * exact range: the speed is split into 16-bit limbs and the division done in two exact steps,
 * each below 2^48. The quotient is below `coast`, so it is an exact int32. C# uses one 64-bit
 * product.
 */
function scaledCoastUdeg(coastUdeg: number, speedMrpm: number, runMrpm: number): number {
  if (speedMrpm >= runMrpm) return coastUdeg;
  const upper = coastUdeg * Math.floor(speedMrpm / LIMB);
  const upperQuotient = Math.floor(upper / runMrpm);
  const lower = (upper - upperQuotient * runMrpm) * LIMB + coastUdeg * (speedMrpm % LIMB);
  const lowerQuotient = Math.floor(lower / runMrpm);
  const remainder = lower - lowerQuotient * runMrpm;
  const quotient = upperQuotient * LIMB + lowerQuotient;
  return remainder * 2 >= runMrpm ? quotient + 1 : quotient;
}

/**
 * Advance the rotary by one tick.
 *
 * `vMotorMv` is the quantized `V(D18)-V(D19)` from this tick's solve, or `null` for a floating
 * armature. `sourceEnabled` is the final power/breaker gate and `stopShorted` is exact D18/D19
 * graph-node equality. Structural equality selects the STOP-shorted coast only while the source is
 * enabled; power loss always selects drive-removed coast, even when those terminals remain unioned.
 * `moversInTransit` is Machine's `motionMask() !== 0`: some relay, pushbutton or slide is mid-stroke.
 * A held dial ignores all of these and keeps following the hand target.
 *
 * COAST DEFERRED ACROSS A CONTACT TRANSFER (Tom's ruling, option B, 2026-10-13; `[unverified]`,
 * fallback `TRANSFER-COAST-DEFER`, open-questions.md O-R12).
 * Circuits such as Tic-Tac-Toe and the elevators stop the motor with one transfer set: the arm leaves
 * the contact that feeds RUN and lands on the one that shorts STOP. Between the two (under 1 ms for a
 * relay release at MV601-REF-A: the 450-550 both-open band of its 8 ms stroke; about 6 ms for a
 * slide) the armature is undriven but not yet braked. Choosing the offset on the
 * first undriven tick locks in the weak drive-removed coast, ignoring the strong brake that arrives a
 * moment later. That overshot Tic-Tac-Toe's first move off the centre square (Book VI p.55: "always
 * to the center"; `tools/motor-claims.ts`, `docs/research/motor-sensitivity.md`).
 *
 * So when the drive goes while the source is on, STOP is not shorted and a mover is mid-stroke, the
 * dial holds and the decision waits. The one-shot offset already lumps all overrun into one jump;
 * waiting changes only WHICH offset applies, never adds motion. The wait ends at the first of these:
 * - STOP shorted: STOP-shorted offset;
 * - drive back: no coast, motion resumes;
 * - every mover landed with no short: drive-removed offset;
 * - power lost: drive-removed offset, as before;
 * - `longestStrokeTicks` waited: whatever the circuit selects now.
 * The cap comes from the profile's own stroke times, not from a new constant. The sources say nothing
 * about momentum at all (`rotary.md` §3.3, O-R5), so this rule is a modelling choice, not a sourced fact.
 *
 * Whichever offset applies is then scaled by the rate in force when the drive left (`previous`,
 * held across the wait): `scaledCoastUdeg`, fallback `COAST-SCALES-WITH-SPEED` (O-R13).
 */
export function stepRotary(
  state: RotaryState,
  vMotorMv: number | null,
  sourceEnabled: boolean,
  stopShorted: boolean,
  moversInTransit: boolean,
  profile: Profile,
  flags: PortFlags,
  emit: RotaryEdgeSink,
): void {
  if (state.held) {
    state.lastMotorMrpm = 0;
    const delta = handDelta(state.udeg, state.targetUdeg);
    if (delta === 0) {
      state.mrpm = 0;
      state.remainder = 0;
      return;
    }

    const rate = delta > 0 ? profile.v.hand_slew_mrpm : -profile.v.hand_slew_mrpm;
    if (integrateAndMove(state, rate, iabs(delta), profile, emit)) {
      state.mrpm = 0;
    } else {
      state.mrpm = rate;
    }
    return;
  }

  const rate = motorRateMrpm(vMotorMv, profile, flags);
  const previous = state.lastMotorMrpm;

  if (rate === 0 && previous !== 0) {
    // Mid-transfer: hold and keep the coast owed (see above). `lastMotorMrpm` stays `previous`.
    if (sourceEnabled && !stopShorted && moversInTransit && state.coastDeferTicks < longestStrokeTicks(profile)) {
      state.coastDeferTicks++;
      state.remainder = 0;
      state.mrpm = 0;
      return;
    }
    state.coastDeferTicks = 0;
    const coast = sourceEnabled && stopShorted
      ? profile.v.coast_udeg_stop_shorted
      : profile.v.coast_udeg_drive_removed;
    state.remainder = 0;
    applyDisplacement(state, previous < 0, 0, scaledCoastUdeg(coast, iabs(previous), profile.v.run_mrpm), profile, emit);
  } else if (rate !== 0) {
    state.coastDeferTicks = 0;
    if (previous !== 0 && (previous < 0) !== (rate < 0)) state.remainder = 0;
    integrateAndMove(state, rate, 0, profile, emit);
  } else {
    state.remainder = 0;
  }

  state.mrpm = rate;
  state.lastMotorMrpm = rate;
}
