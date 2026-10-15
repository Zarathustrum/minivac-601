import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import refJson from '../data/profiles/MV601-REF-A.json';
import type { PortFlags } from '../src/core/ints.ts';
import { loadProfile } from '../src/core/profile.ts';
import type { Profile, ScalarKey } from '../src/core/profile.ts';
import {
  contactAt,
  createRotaryState,
  grabRotary,
  motorRateMrpm,
  releaseRotary,
  stepRotary,
} from '../src/core/rotary.ts';
import type { RotaryEdgeKind, RotaryState } from '../src/core/rotary.ts';

const refA = loadProfile(refJson);
const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

function profileWith(
  values: Partial<Record<ScalarKey, number>> = {},
  derived: Partial<Profile['derived']> = {},
): Profile {
  return {
    ...refA,
    v: { ...refA.v, ...values },
    derived: { ...refA.derived, ...derived },
  };
}

function flags(): PortFlags {
  return { nonPortable: false };
}

type Edge = { kind: RotaryEdgeKind; pos: number };

function collector(): { edges: Edge[]; emit: (kind: RotaryEdgeKind, pos: number) => void } {
  const edges: Edge[] = [];
  return { edges, emit: (kind, pos) => edges.push({ kind, pos }) };
}

/** Positive travel for negative V(D18)-V(D19), i.e. D17 side positive (§13.4.5). */
function referenceMotorRate(runMrpm: number, vMotorMv: number, vMotorRunMv: number): bigint {
  const numerator = -BigInt(runMrpm) * BigInt(vMotorMv);
  const divisor = BigInt(vMotorRunMv);
  let quotient = numerator / divisor;
  const remainder = numerator % divisor;
  const magnitude = remainder < 0n ? -remainder : remainder;
  if (magnitude * 2n >= divisor) quotient += numerator < 0n ? -1n : 1n;
  return quotient;
}

function wrapReference(udeg: number, displacement: bigint): number {
  const full = 360_000_000n;
  const wrapped = (BigInt(udeg) + displacement) % full;
  return Number(wrapped < 0n ? wrapped + full : wrapped);
}

describe('rotary runtime purity', () => {
  it('has no heap-backed integer arithmetic or transient runtime scratch construction', () => {
    const source = readFileSync(new URL('../src/core/rotary.ts', import.meta.url), 'utf8');
    const tickPath = source.slice(source.indexOf('export function motorRateMrpm'));
    expect(source).not.toMatch(/\bBigInt\b|\b\d+n\b/);
    expect(tickPath).not.toMatch(/\bnew\s+[A-Z_$]/);
    expect(tickPath).not.toMatch(/return\s*[\[{]/);
    expect(tickPath).not.toMatch(/(?:const|let|var)\s+\w+\s*=\s*[\[{]/);
    expect(tickPath).not.toContain('=>');
  });
});

describe('contactAt', () => {
  it('uses the circular pad-0 difference on both sides of zero', () => {
    expect(contactAt(355_000_000, refA)).toBe(0);
    expect(contactAt(359_999_000, refA)).toBe(0);
    expect(contactAt(1_000, refA)).toBe(0);
  });

  it('keeps contact endpoints inclusive and the dead gap open', () => {
    expect(contactAt(8_437_500, refA)).toBe(0);
    expect(contactAt(8_437_501, refA)).toBeNull();
    expect(contactAt(14_062_499, refA)).toBeNull();
    expect(contactAt(14_062_500, refA)).toBe(1);
  });

  it('pins the pitch tie and one microdegree on either side', () => {
    expect(contactAt(11_249_999, refA)).toBeNull();
    expect(contactAt(11_250_000, refA)).toBeNull();
    expect(contactAt(11_250_001, refA)).toBeNull();
  });

  it('wraps the configured wiper offset instead of shifting pad numbers', () => {
    const shifted = profileWith({ wiper_offset_udeg: 5_000_000 });
    expect(contactAt(0, shifted)).toBe(0); // phi = 355 degrees, still pad 0.
    expect(contactAt(5_000_000, shifted)).toBe(0);
    expect(contactAt(27_500_000, shifted)).toBe(1);
  });

  it('normalizes a safe-integer offset before endpoint subtraction', () => {
    const doc = JSON.parse(JSON.stringify(refJson)) as typeof refJson;
    doc.values.wiper_offset_udeg.v = Number.MIN_SAFE_INTEGER;
    const extreme = loadProfile(doc);
    const normalized = profileWith({ wiper_offset_udeg: 25_259_009 });
    const probes = [16_821_508, 16_821_509, 33_696_509, 33_696_510];

    expect(probes.map((udeg) => contactAt(udeg, extreme)))
      .toEqual(probes.map((udeg) => contactAt(udeg, normalized)));
    expect(probes.map((udeg) => contactAt(udeg, normalized))).toEqual([null, 0, 0, null]);
  });
});

describe('hand control', () => {
  it('starts power-off at D0 with no controller history', () => {
    expect(createRotaryState(refA)).toEqual({
      udeg: 0,
      contact: 0,
      held: false,
      targetUdeg: 0,
      mrpm: 0,
      remainder: 0,
      lastMotorMrpm: 0,
      coastDeferTicks: 0,
    });
  });

  it('chooses positive at the exact 180-degree tie and emits every edge in travel order', () => {
    const state = createRotaryState(refA);
    const out = collector();
    grabRotary(state, 180_000_000);

    for (let tick = 0; tick < 10_000; tick++) {
      stepRotary(state, null, false, false, false, refA, flags(), out.emit);
    }

    const expected: Edge[] = [{ kind: 'break', pos: 0 }];
    for (let pos = 1; pos <= 7; pos++) {
      expected.push({ kind: 'make', pos }, { kind: 'break', pos });
    }
    expected.push({ kind: 'make', pos: 8 });
    expect(out.edges).toEqual(expected);
    expect(state).toMatchObject({
      udeg: 180_000_000,
      contact: 8,
      held: true,
      targetUdeg: 180_000_000,
      mrpm: 0,
      remainder: 0,
    });
  });

  it('takes the shorter negative path, wraps, and clamps exactly at the target', () => {
    const state = createRotaryState(refA);
    const out = collector();
    grabRotary(state, 359_999_999);
    stepRotary(state, null, false, false, false, refA, flags(), out.emit);

    expect(state.udeg).toBe(359_999_999);
    expect(state.contact).toBe(0);
    expect(state.mrpm).toBe(0);
    expect(state.remainder).toBe(0);
    expect(out.edges).toEqual([]);
  });

  it('retains the signed sub-microdegree remainder and resets it on a new grab', () => {
    const slow = profileWith({ tick_us: 1, hand_slew_mrpm: 1 });
    const state = createRotaryState(slow);
    const out = collector();
    grabRotary(state, 10);

    for (let tick = 0; tick < 167; tick++) {
      stepRotary(state, 0, false, false, false, slow, flags(), out.emit);
    }
    expect(state.udeg).toBe(1);
    expect(state.remainder).toBe(2);

    grabRotary(state, 20);
    expect(state.remainder).toBe(0);
    expect(state.lastMotorMrpm).toBe(0);
  });

  it('preserves motor history when release is repeated while already unheld', () => {
    const residual = profileWith({ run_mrpm: 45_001, tick_us: 1 });
    const state = createRotaryState(residual);
    stepRotary(state, -residual.derived.vMotorRunMv, true, false, false, residual, flags(), () => undefined);
    expect(state).toMatchObject({ held: false, mrpm: 45_001, remainder: 6, lastMotorMrpm: 45_001 });

    releaseRotary(state);

    expect(state).toMatchObject({ held: false, mrpm: 45_001, remainder: 6, lastMotorMrpm: 45_001 });
  });

  it('continues hand motion with the source off, then resumes motor control one tick after release', () => {
    const state = createRotaryState(refA);
    const out = collector();
    grabRotary(state, 1_000_000);
    stepRotary(state, 0, false, false, false, refA, flags(), out.emit);
    expect(state.udeg).toBe(18_000);
    expect(state.mrpm).toBe(30_000);

    state.remainder = 777;
    releaseRotary(state);
    expect(state.mrpm).toBe(0);
    expect(state.remainder).toBe(0);
    stepRotary(state, -refA.derived.vMotorRunMv, true, false, false, refA, flags(), out.emit);
    expect(state.udeg).toBe(45_000);
    expect(state.mrpm).toBe(45_000);
  });
});

describe('motor rate and integration', () => {
  it('maps signed run voltage to signed run rate and null floating voltage to zero', () => {
    const f = flags();
    expect(motorRateMrpm(-refA.derived.vMotorRunMv, refA, f)).toBe(refA.v.run_mrpm);
    expect(motorRateMrpm(refA.derived.vMotorRunMv, refA, f)).toBe(-refA.v.run_mrpm);
    expect(motorRateMrpm(null, refA, f)).toBe(0);
    expect(f.nonPortable).toBe(false);
  });

  it('rounds half away from zero before the int32 clamp', () => {
    const unit = profileWith({ run_mrpm: 1 }, { vMotorRunMv: 2 });
    expect(motorRateMrpm(-1, unit, flags())).toBe(1);
    expect(motorRateMrpm(1, unit, flags())).toBe(-1);
  });

  it('saturates both int32 rails and marks the result non-portable', () => {
    const hi = flags();
    expect(motorRateMrpm(-2147483648, refA, hi)).toBe(2147483647);
    expect(hi.nonPortable).toBe(true);

    const lo = flags();
    expect(motorRateMrpm(2147483647, refA, lo)).toBe(-2147483648);
    expect(lo.nonPortable).toBe(true);
  });

  it('returns exactly INT32_MIN without saturating when the product lands on the rail', () => {
    const exact = flags();
    expect(motorRateMrpm(1_073_741_824, profileWith({ run_mrpm: 2 }, { vMotorRunMv: 1 }), exact)).toBe(INT32_MIN);
    expect(exact.nonPortable).toBe(false);
  });

  it('matches an independent exact-integer reference across int32 product and divisor extremes', () => {
    const runs = [1, 45_000, 65_537, INT32_MAX];
    const voltages = [INT32_MIN, -INT32_MAX, -1, 1, 65_537, INT32_MAX];
    const divisors = [1, 2, 4_065, 65_537, INT32_MAX];

    for (const runMrpm of runs) {
      for (const vMotorMv of voltages) {
        for (const vMotorRunMv of divisors) {
          const profile = profileWith({ run_mrpm: runMrpm }, { vMotorRunMv });
          const f = flags();
          const exact = referenceMotorRate(runMrpm, vMotorMv, vMotorRunMv);
          const expected = exact > BigInt(INT32_MAX)
            ? INT32_MAX
            : exact < BigInt(INT32_MIN)
              ? INT32_MIN
              : Number(exact);
          expect(
            motorRateMrpm(vMotorMv, profile, f),
            `run=${runMrpm} voltage=${vMotorMv} divisor=${vMotorRunMv}`,
          ).toBe(expected);
          expect(f.nonPortable).toBe(exact > BigInt(INT32_MAX) || exact < BigInt(INT32_MIN));
        }
      }
    }
  });

  it('matches exact signed accumulation across 16-bit limbs, int32 saturation, and wrap', () => {
    const cases = [
      { run: 1, voltage: -1, tickUs: 1 },
      { run: 65_537, voltage: -1, tickUs: 65_539 },
      { run: INT32_MAX, voltage: -1, tickUs: 100 },
      { run: INT32_MAX, voltage: -1, tickUs: 1_000 },
      { run: INT32_MAX, voltage: 1, tickUs: 100 },
      { run: INT32_MAX, voltage: 2, tickUs: 100 },
    ];

    for (const c of cases) {
      const profile = profileWith({ run_mrpm: c.run, tick_us: c.tickUs }, { vMotorRunMv: 1 });
      const state = createRotaryState(profile);
      const f = flags();
      const exactRate = referenceMotorRate(c.run, c.voltage, 1);
      const rate = exactRate > BigInt(INT32_MAX)
        ? INT32_MAX
        : exactRate < BigInt(INT32_MIN)
          ? INT32_MIN
          : Number(exactRate);
      const numerator = BigInt(rate) * 6n * BigInt(c.tickUs);
      const displacement = numerator / 1000n;
      const remainder = numerator % 1000n;

      stepRotary(state, c.voltage, true, false, false, profile, f, () => undefined);
      expect(state.udeg, JSON.stringify(c)).toBe(wrapReference(0, displacement));
      expect(state.remainder, JSON.stringify(c)).toBe(Number(remainder));
      expect(state.mrpm, JSON.stringify(c)).toBe(rate);
      expect(f.nonPortable).toBe(exactRate > BigInt(INT32_MAX) || exactRate < BigInt(INT32_MIN));
    }
  });

  it('handles the maximum signed-64 validated hand product before exact target clamping', () => {
    const int64Max = 9223372036854775807n;
    const maxTickUs = Number((int64Max - 999n) / (BigInt(INT32_MAX) * 6n));
    const product = BigInt(INT32_MAX) * 6n * BigInt(maxTickUs) + 999n;
    expect(product).toBeLessThanOrEqual(int64Max);
    expect(product).toBeGreaterThan(BigInt(Number.MAX_SAFE_INTEGER));

    const profile = profileWith({ hand_slew_mrpm: INT32_MAX, tick_us: maxTickUs });
    const state = createRotaryState(profile);
    const out = collector();
    grabRotary(state, 180_000_000);
    stepRotary(state, 0, false, false, false, profile, flags(), out.emit);

    expect(state.udeg).toBe(180_000_000);
    expect(state.contact).toBe(8);
    expect(state.mrpm).toBe(0);
    expect(state.remainder).toBe(0);
    expect(out.edges).toHaveLength(16);
  });

  it('moves positive for negative D18-D19 voltage (D17 side positive) and reverses immediately without stale remainder', () => {
    const state = createRotaryState(refA);
    const out = collector();
    const f = flags();

    stepRotary(state, -refA.derived.vMotorRunMv, true, false, false, refA, f, out.emit);
    expect(state.udeg).toBe(27_000);
    expect(state.mrpm).toBe(45_000);

    state.remainder = 999;
    stepRotary(state, refA.derived.vMotorRunMv, true, false, false, refA, f, out.emit);
    expect(state.udeg).toBe(0);
    expect(state.mrpm).toBe(-45_000);
    expect(state.remainder).toBe(0);
  });
});

describe('coast deferred while a contact is mid-transfer', () => {
  // A relay, pushbutton or slide that cuts the drive by leaving one contact and then shorts STOP by
  // landing on the other leaves the armature undriven but not yet braked for the transfer. The coast
  // waits for the stroke to land, so the brake it lands on picks the offset.
  const longestStroke = Math.max(
    refA.derived.relayOperateTicks,
    refA.derived.relayReleaseTicks,
    refA.derived.pushbuttonTicks,
    refA.derived.slideTicks,
  );

  function running(): RotaryState {
    const state = createRotaryState(refA);
    stepRotary(state, -refA.derived.vMotorRunMv, true, false, false, refA, flags(), () => undefined);
    expect(state.udeg).toBe(27_000);
    return state;
  }

  it('holds while the stroke is in flight, then takes the STOP-shorted offset when the short lands', () => {
    const state = running();
    stepRotary(state, null, true, false, true, refA, flags(), () => undefined);
    stepRotary(state, null, true, false, true, refA, flags(), () => undefined);
    expect(state).toMatchObject({ udeg: 27_000, mrpm: 0, lastMotorMrpm: 45_000 });

    stepRotary(state, 0, true, true, true, refA, flags(), () => undefined);
    expect(state.udeg).toBe(27_000 + refA.v.coast_udeg_stop_shorted);
    expect(state).toMatchObject({ mrpm: 0, lastMotorMrpm: 0, coastDeferTicks: 0 });
  });

  it('takes the drive-removed offset once every stroke has landed without a short', () => {
    const state = running();
    stepRotary(state, null, true, false, true, refA, flags(), () => undefined);
    stepRotary(state, null, true, false, false, refA, flags(), () => undefined);
    expect(state.udeg).toBe(27_000 + refA.v.coast_udeg_drive_removed);
    expect(state.lastMotorMrpm).toBe(0);
  });

  it('owes no coast when the drive returns before the stroke lands', () => {
    const state = running();
    stepRotary(state, null, true, false, true, refA, flags(), () => undefined);
    stepRotary(state, -refA.derived.vMotorRunMv, true, false, true, refA, flags(), () => undefined);
    expect(state).toMatchObject({ udeg: 54_000, mrpm: 45_000, coastDeferTicks: 0 });
  });

  it('waits at most the longest stroke in the profile', () => {
    const state = running();
    for (let i = 0; i < longestStroke; i++) stepRotary(state, null, true, false, true, refA, flags(), () => undefined);
    expect(state).toMatchObject({ udeg: 27_000, coastDeferTicks: longestStroke });
    stepRotary(state, null, true, false, true, refA, flags(), () => undefined);
    expect(state.udeg).toBe(27_000 + refA.v.coast_udeg_drive_removed);
    expect(state.coastDeferTicks).toBe(0);
  });

  // Architecture §13.4.5; fallback TRANSFER-COAST-DEFER (open-questions.md O-R12).
  it('takes the STOP-shorted offset when the short lands on the cap tick', () => {
    const state = running();
    for (let i = 0; i < longestStroke; i++) stepRotary(state, null, true, false, true, refA, flags(), () => undefined);
    expect(state).toMatchObject({ udeg: 27_000, coastDeferTicks: longestStroke });
    stepRotary(state, 0, true, true, true, refA, flags(), () => undefined);
    expect(state.udeg).toBe(27_000 + refA.v.coast_udeg_stop_shorted);
    expect(state).toMatchObject({ mrpm: 0, lastMotorMrpm: 0, coastDeferTicks: 0 });
  });

  // Architecture §13.4.5; fallback TRANSFER-COAST-DEFER (open-questions.md O-R12).
  it('owes no coast when the drive returns reversed within the wait', () => {
    const state = running();
    stepRotary(state, null, true, false, true, refA, flags(), () => undefined);
    stepRotary(state, null, true, false, true, refA, flags(), () => undefined);
    expect(state).toMatchObject({ udeg: 27_000, lastMotorMrpm: 45_000, coastDeferTicks: 2 });
    stepRotary(state, refA.derived.vMotorRunMv, true, false, true, refA, flags(), () => undefined);
    expect(state).toMatchObject({ udeg: 0, mrpm: -45_000, lastMotorMrpm: -45_000, coastDeferTicks: 0 });
  });

  it('never waits on power loss or on a short that is already there', () => {
    const lost = running();
    stepRotary(lost, 0, false, false, true, refA, flags(), () => undefined);
    expect(lost.udeg).toBe(27_000 + refA.v.coast_udeg_drive_removed);

    const shorted = running();
    stepRotary(shorted, 0, true, true, true, refA, flags(), () => undefined);
    expect(shorted.udeg).toBe(27_000 + refA.v.coast_udeg_stop_shorted);
  });

  it('a hand grab cancels an owed coast', () => {
    const state = running();
    stepRotary(state, null, true, false, true, refA, flags(), () => undefined);
    grabRotary(state, 27_000);
    releaseRotary(state);
    expect(state).toMatchObject({ lastMotorMrpm: 0, coastDeferTicks: 0 });
    stepRotary(state, null, true, false, false, refA, flags(), () => undefined);
    expect(state.udeg).toBe(27_000);
  });
});

describe('one-shot zero-drive coast and crossings', () => {
  it('uses the shorted STOP offset once in the last positive direction', () => {
    const state = createRotaryState(refA);
    const out = collector();
    const f = flags();
    stepRotary(state, -refA.derived.vMotorRunMv, true, false, false, refA, f, out.emit);
    stepRotary(state, 0, true, true, false, refA, f, out.emit);
    expect(state.udeg).toBe(5_027_000);
    expect(state.mrpm).toBe(0);
    expect(state.lastMotorMrpm).toBe(0);

    stepRotary(state, 0, true, true, false, refA, f, out.emit);
    expect(state.udeg).toBe(5_027_000);
  });

  it('uses the drive-removed offset once on power loss and preserves the negative direction', () => {
    const positive = createRotaryState(refA);
    const negative = createRotaryState(refA);
    const sink = collector().emit;

    stepRotary(positive, -refA.derived.vMotorRunMv, true, false, false, refA, flags(), sink);
    // Power loss chooses drive-removed coast even if the disabled graph still unions D18/D19.
    stepRotary(positive, 0, false, true, false, refA, flags(), sink);
    expect(positive.udeg).toBe(9_567_000);

    stepRotary(negative, refA.derived.vMotorRunMv, true, false, false, refA, flags(), sink);
    stepRotary(negative, null, false, false, false, refA, flags(), sink);
    expect(negative.udeg).toBe(350_433_000);
    expect(negative.mrpm).toBe(0);
  });

  it('enumerates several boundaries and a complete revolution without skipping an edge', () => {
    const longCoast = profileWith({ coast_udeg_drive_removed: 400_000_000 });
    const state = createRotaryState(longCoast);
    const out = collector();
    const f = flags();

    stepRotary(state, -longCoast.derived.vMotorRunMv, true, false, false, longCoast, f, out.emit);
    stepRotary(state, 0, false, false, false, longCoast, f, out.emit);

    expect(state.udeg).toBe(40_027_000);
    expect(state.contact).toBe(2);
    expect(out.edges).toHaveLength(36);
    expect(out.edges.slice(0, 6)).toEqual([
      { kind: 'break', pos: 0 },
      { kind: 'make', pos: 1 },
      { kind: 'break', pos: 1 },
      { kind: 'make', pos: 2 },
      { kind: 'break', pos: 2 },
      { kind: 'make', pos: 3 },
    ]);
    expect(out.edges.slice(-4)).toEqual([
      { kind: 'break', pos: 0 },
      { kind: 'make', pos: 1 },
      { kind: 'break', pos: 1 },
      { kind: 'make', pos: 2 },
    ]);
  });

  it('emits negative travel in reverse physical order', () => {
    const longCoast = profileWith({ coast_udeg_drive_removed: 100_000_000 });
    const state = createRotaryState(longCoast);
    const out = collector();

    stepRotary(state, longCoast.derived.vMotorRunMv, true, false, false, longCoast, flags(), out.emit);
    stepRotary(state, 0, false, false, false, longCoast, flags(), out.emit);

    expect(out.edges.slice(0, 6)).toEqual([
      { kind: 'break', pos: 0 },
      { kind: 'make', pos: 15 },
      { kind: 'break', pos: 15 },
      { kind: 'make', pos: 14 },
      { kind: 'break', pos: 14 },
      { kind: 'make', pos: 13 },
    ]);
  });
});

// Architecture §13.4.5; fallback COAST-SCALES-WITH-SPEED (open-questions.md O-R13, offsets O-R5).
describe('coast scales with the speed it stops from', () => {
  // With vMotorRunMv equal to run_mrpm the rate law is the identity: |voltage| mrpm, exactly.
  function identity(values: Partial<Record<ScalarKey, number>> = {}): Profile {
    const run = values.run_mrpm ?? refA.v.run_mrpm;
    return profileWith(values, { vMotorRunMv: run });
  }

  /** Stop distance from one driven tick at `speed`, then a stop through the given brake. */
  function coastFrom(profile: Profile, speed: number, shorted: boolean): number {
    const state = createRotaryState(profile);
    stepRotary(state, -speed, true, false, false, profile, flags(), () => undefined);
    const driven = state.udeg;
    stepRotary(state, 0, true, shorted, false, profile, flags(), () => undefined);
    expect(state).toMatchObject({ mrpm: 0, lastMotorMrpm: 0 });
    return (state.udeg - driven + 360_000_000) % 360_000_000;
  }

  function reference(coast: number, speed: number, run: number): number {
    if (speed >= run) return coast;
    const product = BigInt(coast) * BigInt(speed);
    const quotient = product / BigInt(run);
    return Number((product - quotient * BigInt(run)) * 2n >= BigInt(run) ? quotient + 1n : quotient);
  }

  it('leaves a full-speed stop on exactly the configured offsets', () => {
    expect(coastFrom(identity(), 45_000, false)).toBe(refA.v.coast_udeg_drive_removed);
    expect(coastFrom(identity(), 45_000, true)).toBe(refA.v.coast_udeg_stop_shorted);
  });

  it('halves the offset at half speed, rounding an exact half away from zero', () => {
    expect(coastFrom(identity(), 22_500, false)).toBe(4_770_000);
    expect(coastFrom(identity(), 22_500, true)).toBe(2_500_000);
    const odd = identity({ coast_udeg_drive_removed: 20_000_001, coast_udeg_stop_shorted: 4_999_999 });
    expect(coastFrom(odd, 22_500, false)).toBe(10_000_001); // 10_000_000.5
    expect(coastFrom(odd, 22_500, true)).toBe(2_500_000); // 2_499_999.5
  });

  it('gives a creep stop almost no overrun (V-EXP12, O-R13)', () => {
    // REF-A's own rate law: 146 mV of reverse flyback drive is 1616 mrpm, 3.6% of RUN.
    expect(motorRateMrpm(146, refA, flags())).toBe(-1616);
    // A local 20 deg coast, independent of the shipped value, keeps inexact quotients that tell rounding
    // from truncation.
    const coast20 = profileWith({ coast_udeg_drive_removed: 20_000_000 });
    const state = createRotaryState(coast20);
    stepRotary(state, 146, true, false, false, coast20, flags(), () => undefined);
    const driven = state.udeg;
    stepRotary(state, null, true, false, false, coast20, flags(), () => undefined);
    expect(driven - state.udeg).toBe(718_222); // 20_000_000 * 1616 / 45_000 = 718_222.2
    expect(coastFrom(identity({ coast_udeg_drive_removed: 20_000_000 }), 11, false)).toBe(4_889); // 4_888.9
    expect(coastFrom(identity(), 11, true)).toBe(1_222); // 1_222.2
  });

  it('scales the STOP-shorted offset after a deferred transfer by the speed the drive left at', () => {
    const profile = identity();
    const state = createRotaryState(profile);
    stepRotary(state, -9_000, true, false, false, profile, flags(), () => undefined);
    const driven = state.udeg;
    stepRotary(state, null, true, false, true, profile, flags(), () => undefined);
    expect(state).toMatchObject({ udeg: driven, lastMotorMrpm: 9_000, coastDeferTicks: 1 });
    stepRotary(state, 0, true, true, true, profile, flags(), () => undefined);
    expect(state.udeg - driven).toBe(1_000_000); // 5_000_000 * 9_000 / 45_000
  });

  it('caps a stop from faster than RUN at the configured offset', () => {
    expect(coastFrom(identity(), 90_000, false)).toBe(refA.v.coast_udeg_drive_removed);
    expect(coastFrom(identity(), 45_001, true)).toBe(refA.v.coast_udeg_stop_shorted);
  });

  it('matches an exact-integer reference up to a 2^62 product', () => {
    const coasts = [1, 5_000_000, 20_000_001, 359_999_999, INT32_MAX];
    const runs = [1, 3, 45_000, 65_537, INT32_MAX];
    for (const coast of coasts) {
      for (const run of runs) {
        const speeds = [1, Math.floor(run / 2), run - 1, run, run + 1].filter((s) => s > 0 && s <= INT32_MAX);
        for (const speed of speeds) {
          const profile = identity({ run_mrpm: run, coast_udeg_drive_removed: coast });
          expect(coastFrom(profile, speed, false), `coast=${coast} run=${run} speed=${speed}`)
            .toBe(reference(coast, speed, run) % 360_000_000);
        }
      }
    }
  });
});
