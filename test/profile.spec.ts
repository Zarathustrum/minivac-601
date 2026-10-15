/**
 * `src/core/profile.ts` against architecture §4.4, §5, §6, §10.1 and §11, and against
 * `components.md` §9.3's R1-R6.
 *
 * Every derivation is checked against arithmetic written out here in full, not against a second
 * call to the function under test: layer 0 of the port proof (§9.5) is worthless if the expected
 * side is produced by the thing being proved.
 */
import { describe, expect, it } from 'vitest';
import katJson from '../data/kat/profile-kat.json';
import w3KatJson from '../data/kat/w3-derived-kat.json';
import idealJson from '../data/profiles/MV601-IDEAL.json';
import refJson from '../data/profiles/MV601-REF-A.json';
import { idiv, idivRound, roundHalfEven } from '../src/core/ints.ts';
import {
  ARRAY_KEYS,
  SCALAR_KEYS,
  bothOpenTicks,
  evalConstraints,
  loadProfile,
  releaseToBreakTicks,
  sweepUdegPerTick,
} from '../src/core/profile.ts';
import type { ConstraintInputs, Profile } from '../src/core/profile.ts';
import { doubleOfHex } from './kat-hex.ts';
import { makePwl } from './mv601-ref.ts';

/**
 * The three data files are imported rather than read off disk: the repo ships no `@types/node`
 * and adding one for a test would be a new devDependency, which W1a's harness forbids.
 * `resolveJsonModule` is already on, and vitest resolves these through the same loader the app
 * would. UTF-8 / LF / no-BOM is determinism rule 17's repo check, not this file's job.
 */
type Entry = { v: unknown; tag: string; src: string };
type Doc = Record<string, unknown> & { values: Record<string, Entry> };

/** A fresh mutable copy of the shipped default, so a test that breaks it breaks only its own. */
function clone(x: unknown): Doc {
  return JSON.parse(JSON.stringify(x)) as Doc;
}

function refDoc(): Doc {
  return clone(refJson);
}

function setScalar(doc: Doc, key: string, value: number): void {
  doc.values[key] = { v: value, tag: 'unverified', src: 'W3 negative-mutation test' };
}

const refA: Profile = loadProfile(refJson);
const ideal: Profile = loadProfile(idealJson);
const CONTACT_PROVENANCE =
  'components.md §8.2: 0.05 Ω nominal. PRESENT AND UNUSED. architecture.md §3.1 collapses contacts ' +
  'to ideal shorts: against a 150 Ω coil this is 0.03%, below the resolution of anything SDC ' +
  'printed. The W2 contract permits at most 174 base nodes, 173 non-datum rows, and 278 elements; ' +
  'where R is the number of connected positive-resistance cords, its safe bound is ' +
  'N <= min(173, 43 + 2R), and the common R=0 case has N <= 43. Declared here so a porter does ' +
  'not implement it, and kept so the departure is visible rather than silent.';

describe('minivac.profile/1 schema', () => {
  it('carries every key architecture 10.1 names, and nothing else', () => {
    const doc = refDoc();
    const got = Object.keys(doc.values).sort();
    const want = [...SCALAR_KEYS, ...ARRAY_KEYS].sort();
    expect(got).toEqual(want);
    expect(want.length).toBe(45);
  });

  it('rejects an unknown key in values', () => {
    const doc = refDoc();
    doc.values['R_coil_ohms'] = { v: 150, tag: 'unverified', src: 'a plausible-looking typo' };
    expect(() => loadProfile(doc)).toThrow(/unknown key "R_coil_ohms" in values/);
  });

  it('rejects an unknown key at the top level', () => {
    const doc = refDoc();
    (doc as Record<string, unknown>)['notes'] = 'a place for someone to put a constant';
    expect(() => loadProfile(doc)).toThrow(/unknown key "notes"/);
  });

  it('rejects a missing required key, by name, for every key in the list', () => {
    for (const k of [...SCALAR_KEYS, ...ARRAY_KEYS]) {
      const doc = refDoc();
      delete doc.values[k];
      expect(() => loadProfile(doc)).toThrow('missing required key "' + k + '"');
    }
  });

  it('rejects a non-integer where the key is integral', () => {
    for (const k of ['tick_us', 'R_coil_uohm', 'break_milli'] as const) {
      const doc = refDoc();
      doc.values[k] = { v: 12.5, tag: 'unverified', src: 'ms crept back in' };
      expect(() => loadProfile(doc)).toThrow(new RegExp(k + ' must be a safe integer'));
    }
    // Strokes are in us precisely so no profile value is ever a decimal (10.1).
    const doc = refDoc();
    doc.values['relay_operate_stroke_us'] = { v: 12.0e3 + 0.5, tag: 'unverified', src: 'x' };
    expect(() => loadProfile(doc)).toThrow(/safe integer/);
  });

  it('accepts a raw duplicate object key and keeps its last value', () => {
    const marker = '"tick_us":';
    const raw = JSON.stringify(refJson).replace(
      marker,
      '"tick_us":{"v":101,"tag":"unverified","src":"test-local duplicate"},' + marker,
    );
    expect(raw).not.toBe(JSON.stringify(refJson));
    expect(loadProfile(JSON.parse(raw) as Doc).v.tick_us).toBe(100);
  });

  it('requires an honest tag and a real citation on every value', () => {
    const bad = refDoc();
    bad.values['V_oc_mv'] = { v: 13000, tag: 'measured', src: 'MAINT p.3' };
    expect(() => loadProfile(bad)).toThrow(/tag must be verified-reading \| unverified \| assumption/);

    const noSrc = refDoc();
    noSrc.values['V_oc_mv'] = { v: 13000, tag: 'unverified', src: '' };
    expect(() => loadProfile(noSrc)).toThrow(/src must be a non-empty citation string/);

    const extra = refDoc();
    (noSrc.values['V_oc_mv'] as Record<string, unknown>)['why'] = 'prose';
    extra.values['V_oc_mv'] = noSrc.values['V_oc_mv'] as never;
    expect(() => loadProfile(extra)).toThrow(/unknown key "why" in V_oc_mv/);
  });

  it('pins the unused contact-resistance provenance to the W2 graph bounds', () => {
    const katProfile = clone((katJson as unknown as { profile: unknown }).profile);
    for (const doc of [clone(refJson), clone(idealJson), katProfile]) {
      expect(doc.values['R_contact_uohm']?.src).toBe(CONTACT_PROVENANCE);
    }
  });

  it('rejects a wrong schema, a missing id and a missing marginal flag', () => {
    const s = refDoc();
    s['schema'] = 'minivac.profile/2';
    expect(() => loadProfile(s)).toThrow(/schema must be "minivac.profile\/1"/);

    const i = refDoc();
    i['id'] = '';
    expect(() => loadProfile(i)).toThrow(/id must be a non-empty string/);

    const m = refDoc();
    delete m['marginal'];
    expect(() => loadProfile(m)).toThrow(/marginal must be a boolean/);
  });

  it('requires exactly six per-relay offsets', () => {
    for (const v of [[-282, -169, -56, 56, 169], [-282, -169, -56, 56, 169, 282, 0]]) {
      const doc = refDoc();
      doc.values['dV_relay_mv'] = { v, tag: 'unverified', src: 'x' };
      expect(() => loadProfile(doc)).toThrow(/dV_relay_mv must be 6 integers/);
    }
  });

  it('enforces every W3 positive and non-negative int32 domain before derivation', () => {
    const positive = [
      'tick_us', 'V_oc_mv', 'R_src_uohm', 'R1_uohm', 'R2_uohm', 'R_arm_uohm', 'I_trip_ua',
      'trip_delay_us', 'run_mrpm', 'hand_slew_mrpm', 'settle_quiet_ticks', 'settle_cap_us',
      'chatter_n', 'chatter_cycles', 'chatter_quiet_cycles',
    ];
    for (const key of positive) {
      for (const value of [0, -1, 2147483648]) {
        const doc = refDoc();
        setScalar(doc, key, value);
        expect(() => loadProfile(doc), `${key}=${value}`).toThrow(new RegExp(key + ' must be an int32 in 1'));
      }
    }
    for (const key of ['coast_udeg_stop_shorted', 'coast_udeg_drive_removed']) {
      for (const value of [-1, 2147483648]) {
        const doc = refDoc();
        setScalar(doc, key, value);
        expect(() => loadProfile(doc), `${key}=${value}`).toThrow(new RegExp(key + ' must be an int32 in 0'));
      }
    }
  });

  it('enforces the electrical scalar domains before solver arithmetic', () => {
    const zeroGmin = refDoc();
    setScalar(zeroGmin, 'gmin_ns', 0);
    expect(() => loadProfile(zeroGmin)).not.toThrow();

    const negativeGmin = refDoc();
    setScalar(negativeGmin, 'gmin_ns', -1);
    expect(() => loadProfile(negativeGmin)).toThrow(/gmin_ns must be non-negative/);

    for (const key of ['V_arc_clamp_mv', 'I_hot_ua'] as const) {
      for (const value of [0, -1]) {
        const doc = refDoc();
        setScalar(doc, key, value);
        expect(() => loadProfile(doc), `${key}=${value}`).toThrow(new RegExp(key + ' must be positive'));
      }
    }
  });

  it('bounds blessing gates as non-negative int32 values without disabling their zero boundary', () => {
    for (const key of ['min_decision_ua', 'min_tick_gap'] as const) {
      for (const value of [-1, 2147483648]) {
        const doc = refDoc();
        setScalar(doc, key, value);
        expect(() => loadProfile(doc), `${key}=${value}`).toThrow(
          new RegExp(key + ' must be an int32 in 0\\.\\.2147483647'),
        );
      }
      for (const value of [0, 2147483647]) {
        const doc = refDoc();
        setScalar(doc, key, value);
        expect(() => loadProfile(doc), `${key}=${value}`).not.toThrow();
      }
    }
  });

  it('keeps the documented relay-bounce feature disabled at exactly zero', () => {
    const zero = refDoc();
    setScalar(zero, 'relay_bounce_us', 0);
    expect(() => loadProfile(zero)).not.toThrow();

    for (const value of [-1, 1]) {
      const doc = refDoc();
      setScalar(doc, 'relay_bounce_us', value);
      expect(() => loadProfile(doc), `relay_bounce_us=${value}`).toThrow(/relay_bounce_us must be zero/);
    }
  });
});

describe('the load-time derivations of architecture 4.4', () => {
  // Every expectation below is the formula from 4.4 with MV601-REF-A's numbers substituted and
  // the division done by hand, then re-stated as the formula so the two can be compared by eye.
  const d = refA.derived;

  it('pullInUa = idivRound(V_pullin_mv * 1e9, R_coil_uohm)', () => {
    // 6500 mV / 150 ohm = 43.3333 mA. 6_500_000_000_000 / 150_000_000 = 43333.33 -> 43333.
    expect(d.pullInUa).toBe(43_333);
    expect(d.pullInUa).toBe(idivRound(6500 * 1_000_000_000, 150_000_000));
  });

  it('dropOutUa = idivRound(V_dropout_mv * 1e9, R_coil_uohm)', () => {
    // 2500 mV / 150 ohm = 16.6667 mA. 2_500_000_000_000 / 150_000_000 = 16666.67 -> 16667.
    expect(d.dropOutUa).toBe(16_667);
    expect(d.dropOutUa).toBe(idivRound(2500 * 1_000_000_000, 150_000_000));
  });

  it('relayUa[n] = idivRound((V_pullin_mv + dV_relay_mv[n]) * 1e9, R_coil_uohm)', () => {
    // 6500 + [-282,-169,-56,56,169,282] = [6218,6331,6444,6556,6669,6782] mV, each / 150 ohm:
    //   6218 -> 41453.33 -> 41453      6331 -> 42206.67 -> 42207
    //   6444 -> 42960.00 -> 42960      6556 -> 43706.67 -> 43707
    //   6669 -> 44460.00 -> 44460      6782 -> 45213.33 -> 45213
    expect(d.relayPullInUa).toEqual([41_453, 42_207, 42_960, 43_707, 44_460, 45_213]);
    // The same offsets applied to drop-out (4.3: "applied to pull-in and drop-out together"):
    //   2218 -> 14786.67 -> 14787      2331 -> 15540.00 -> 15540
    //   2444 -> 16293.33 -> 16293      2556 -> 17040.00 -> 17040
    //   2669 -> 17793.33 -> 17793      2782 -> 18546.67 -> 18547
    expect(d.relayDropOutUa).toEqual([14_787, 15_540, 16_293, 17_040, 17_793, 18_547]);
  });

  it('the Wave D linear ramp follows the frozen sign-symmetric rounding rule', () => {
    const a = 282;
    const sround5 = (p: number): number => Math.sign(p) * Math.floor((2 * Math.abs(p) + 5) / 10);
    expect(refA.dVRelayMv).toEqual([1, 2, 3, 4, 5, 6].map((n) => sround5((2 * n - 7) * a)));
    expect(refA.dVRelayMv).toEqual([-282, -169, -56, 56, 169, 282]);
    expect(refA.dVRelayMv.reduce((sum, dv) => sum + dv, 0)).toBe(0);
  });

  it('freezes the Wave D A=282 boundary and rejects A+1', () => {
    const threshold = (a: number): number => idivRound((6500 + a) * 1_000_000_000, 150_000_000);
    expect(threshold(282)).toBe(45_213);
    expect(46_218 - threshold(282)).toBe(1_005);
    expect(threshold(283)).toBe(45_220);
    expect(46_218 - threshold(283)).toBe(998);
  });

  it('strokeTicks = idivRound(stroke_us, tick_us), for all four strokes', () => {
    expect(d.relayOperateTicks).toBe(120); // 12000 us / 100 us
    expect(d.relayReleaseTicks).toBe(80); //   8000 us / 100 us
    expect(d.pushbuttonTicks).toBe(250); //   25000 us / 100 us
    expect(d.slideTicks).toBe(600); //        60000 us / 100 us
  });

  it('kThermal = tick_us / (lamp_thermal_tau_us + tick_us), and is the only double', () => {
    // 100 / (40000 + 100) = 100 / 40100.
    expect(d.kThermal).toBe(100 / 40100);
    // The same quantity test/mv601-ref.ts computes from seconds, bit for bit: DT_S/(TAU_S+DT_S)
    // is 1e-4/(4e-2+1e-4), a different expression tree, so agreement here is not tautological.
    expect(d.kThermal).toBeCloseTo(1e-4 / (40e-3 + 1e-4), 15);
    expect(Number.isInteger(d.kThermal)).toBe(false);
  });

  it('arcStepUa = idivRound(V_arc_clamp_mv * tick_us * 1000, L_coil_uh)', () => {
    // 30 V across 1.2 H for 100 us = 2.5 mA. 30000 * 100 * 1000 / 1_200_000 = 2500.
    expect(d.arcStepUa).toBe(2500);
    expect(d.arcStepUa).toBe(idivRound(30_000 * 100 * 1000, 1_200_000));
    // 4.2's claim that the open release ramps 86.3 mA to zero in ~3.5 ms, well inside the 8 ms
    // mechanical stroke, is this number divided into that current.
    expect(Math.ceil(86_300 / d.arcStepUa)).toBe(35); // 35 ticks = 3.5 ms
  });

  it('every derivation in 4.4 uses idivRound; none uses idiv', () => {
    // Stated because 4.4 says "which one each derivation uses is written above and nowhere else",
    // and the answer turns out to be uniform: every load-time derivation is idivRound. idiv is
    // used by 4.3's travel accumulator, which is devices.ts. The two do differ on this data —
    // relay 2's offset threshold is 42206.67 uA, so a porter who truncates gets 42206, not 42207,
    // and a 1 uA threshold error is exactly the kind of thing a marginal fixture decides on.
    expect(idivRound(6331 * 1_000_000_000, 150_000_000)).toBe(42_207);
    expect(idiv(6331 * 1_000_000_000, 150_000_000)).toBe(42_206);
    expect(refA.derived.relayPullInUa[1]).toBe(42_207);
  });

  it('rejects signed-64 overflow in nominal, offset, and arc derivation products', () => {
    const nominal = refDoc();
    setScalar(nominal, 'V_pullin_mv', 9_223_372_037);
    expect(() => loadProfile(nominal)).toThrow(/V_pullin_mv \* 1000000000 overflows signed 64-bit/);

    const offset = refDoc();
    setScalar(offset, 'V_pullin_mv', 9_223_372_036);
    setScalar(offset, 'V_dropout_mv', 5_000_000_000);
    setScalar(offset, 'R_coil_uohm', 5_000_000_000);
    offset.values['dV_relay_mv'] = { v: [1, 0, 0, 0, 0, 0], tag: 'unverified', src: 'test' };
    expect(() => loadProfile(offset)).toThrow(
      /V_pullin_mv \+ dV_relay_mv\[0\].*overflows signed 64-bit/,
    );

    const arc = refDoc();
    setScalar(arc, 'V_arc_clamp_mv', 92_233_720_368_548);
    expect(() => loadProfile(arc)).toThrow(/V_arc_clamp_mv \* tick_us \* 1000 overflows signed 64-bit/);
  });

  it('rejects nominal, per-relay, and arc results outside positive int32', () => {
    const nominal = refDoc();
    setScalar(nominal, 'V_pullin_mv', 3);
    setScalar(nominal, 'V_dropout_mv', 1);
    setScalar(nominal, 'R_coil_uohm', 1);
    nominal.values['dV_relay_mv'] = { v: [0, 0, 0, 0, 0, 0], tag: 'unverified', src: 'test' };
    expect(() => loadProfile(nominal)).toThrow(/pullInUa must be a positive int32/);

    const offset = refDoc();
    setScalar(offset, 'V_pullin_mv', 2);
    setScalar(offset, 'V_dropout_mv', 1);
    setScalar(offset, 'R_coil_uohm', 1);
    offset.values['dV_relay_mv'] = { v: [1, 0, 0, 0, 0, 0], tag: 'unverified', src: 'test' };
    expect(() => loadProfile(offset)).toThrow(/relayPullInUa\[0\] must be a positive int32/);

    const arc = refDoc();
    setScalar(arc, 'V_arc_clamp_mv', 2_147_484);
    setScalar(arc, 'L_coil_uh', 100);
    expect(() => loadProfile(arc)).toThrow(/arcStepUa must be a positive int32/);
  });

  it('reproduces exact in-range derivations whose products exceed the idivRound number domain', () => {
    const doc = refDoc();
    setScalar(doc, 'V_pullin_mv', 9_007_200);
    setScalar(doc, 'V_dropout_mv', 9_007_195);
    setScalar(doc, 'R_coil_uohm', 5_000_003);
    setScalar(doc, 'V_arc_clamp_mv', 90_072_000_000);
    setScalar(doc, 'L_coil_uh', 5_000_003);
    doc.values['dV_relay_mv'] = { v: [0, 0, 0, 0, 0, 0], tag: 'unverified', src: 'test' };
    const derived = loadProfile(doc).derived;
    expect(derived.pullInUa).toBe(1_801_438_919);
    expect(derived.dropOutUa).toBe(1_801_437_919);
    expect(derived.relayPullInUa).toEqual(new Array<number>(6).fill(1_801_438_919));
    expect(derived.relayDropOutUa).toEqual(new Array<number>(6).fill(1_801_437_919));
    expect(derived.arcStepUa).toBe(1_801_438_919);
  });

  it('requires ordered positive nominal and per-relay hysteresis after rounding', () => {
    for (const [pullInMv, dropOutMv, resistance] of [
      [1, 1, 1_000_000_000],
      [1, 2, 1_000_000_000],
      [2, 1, 2_000_000_000],
    ]) {
      const doc = refDoc();
      setScalar(doc, 'V_pullin_mv', pullInMv as number);
      setScalar(doc, 'V_dropout_mv', dropOutMv as number);
      setScalar(doc, 'R_coil_uohm', resistance as number);
      doc.values['dV_relay_mv'] = { v: [0, 0, 0, 0, 0, 0], tag: 'unverified', src: 'test' };
      expect(() => loadProfile(doc), `${dropOutMv} < ${pullInMv} through ${resistance}`).toThrow(
        /nominal relay thresholds must satisfy 0 < dropOutUa < pullInUa/,
      );
    }

    const offset = refDoc();
    setScalar(offset, 'V_pullin_mv', 2);
    setScalar(offset, 'V_dropout_mv', 1);
    setScalar(offset, 'R_coil_uohm', 1_000_000_000);
    offset.values['dV_relay_mv'] = { v: [-1, 0, 0, 0, 0, 0], tag: 'unverified', src: 'test' };
    expect(() => loadProfile(offset)).toThrow(
      /relay 1 thresholds must satisfy 0 < dropOutUa < pullInUa/,
    );

    const minimal = refDoc();
    setScalar(minimal, 'V_pullin_mv', 2);
    setScalar(minimal, 'V_dropout_mv', 1);
    setScalar(minimal, 'R_coil_uohm', 1_000_000_000);
    minimal.values['dV_relay_mv'] = { v: [0, 0, 0, 0, 0, 0], tag: 'unverified', src: 'test' };
    expect(loadProfile(minimal).derived).toMatchObject({ pullInUa: 2, dropOutUa: 1 });
  });
});

describe('the checked Wave 3 profile derivations of architecture 13.4.1', () => {
  it('derives the exact nine-member projection from MV601-REF-A', () => {
    expect({
      tripDelayTicks: refA.derived.tripDelayTicks,
      deadShortUa: refA.derived.deadShortUa,
      rMotorParUohm: refA.derived.rMotorParUohm,
      vMotorRunMv: refA.derived.vMotorRunMv,
      relayCycleTicks: refA.derived.relayCycleTicks,
      buttonCycleTicks: refA.derived.buttonCycleTicks,
      switchCycleTicks: refA.derived.switchCycleTicks,
      dialCycleTicks: refA.derived.dialCycleTicks,
      settleCapTicks: refA.derived.settleCapTicks,
    }).toEqual({
      tripDelayTicks: 2000,
      deadShortUa: 19_402_985,
      rMotorParUohm: 10_312_500,
      vMotorRunMv: 4065,
      relayCycleTicks: 200,
      buttonCycleTicks: 500,
      switchCycleTicks: 1200,
      dialCycleTicks: 833,
      settleCapTicks: 5000,
    });
  });

  it('rejects signed-64 derivation and runtime angular-accumulator overflow separately', () => {
    const derivation = refDoc();
    for (const key of [
      'tick_us', 'trip_delay_us', 'relay_operate_stroke_us', 'relay_release_stroke_us',
      'pushbutton_stroke_us', 'slide_stroke_us', 'settle_cap_us',
    ]) setScalar(derivation, key, 2147483647);
    setScalar(derivation, 'run_mrpm', 2147483647);
    expect(() => loadProfile(derivation)).toThrow(/16 \* run_mrpm \* tick_us overflows signed 64-bit/);

    const angular = refDoc();
    for (const key of [
      'tick_us', 'relay_operate_stroke_us', 'relay_release_stroke_us', 'pushbutton_stroke_us',
      'slide_stroke_us',
    ]) setScalar(angular, key, 715827883);
    setScalar(angular, 'trip_delay_us', 2147483647);
    setScalar(angular, 'settle_cap_us', 2147483647);
    setScalar(angular, 'run_mrpm', 1);
    setScalar(angular, 'V_arc_clamp_mv', 1);
    expect(() => loadProfile(angular)).toThrow(/2147483647 \* 6 \* tick_us \+ 999 overflows signed 64-bit/);
  });

  it('rejects every positive-result int32 boundary before runtime', () => {
    const zeroTrip = refDoc();
    setScalar(zeroTrip, 'tick_us', 3);
    setScalar(zeroTrip, 'trip_delay_us', 1);
    expect(() => loadProfile(zeroTrip)).toThrow(/tripDelayTicks must be a positive int32/);

    const deadShort = refDoc();
    setScalar(deadShort, 'V_oc_mv', 2147483647);
    setScalar(deadShort, 'R_src_uohm', 1);
    expect(() => loadProfile(deadShort)).toThrow(/deadShortUa must be a positive int32/);

    for (const [key, product] of [
      ['relay_operate_stroke_us', 'relayCycleTicks'],
      ['pushbutton_stroke_us', 'buttonCycleTicks'],
      ['slide_stroke_us', 'switchCycleTicks'],
    ] as const) {
      const doc = refDoc();
      setScalar(doc, 'tick_us', 1);
      setScalar(doc, key, 2147483647);
      if (key === 'relay_operate_stroke_us') setScalar(doc, 'relay_release_stroke_us', 1);
      expect(() => loadProfile(doc), product).toThrow(new RegExp(product + ' must be a positive int32'));
    }

    const dial = refDoc();
    setScalar(dial, 'tick_us', 1);
    setScalar(dial, 'run_mrpm', 1);
    expect(() => loadProfile(dial)).toThrow(/dialCycleTicks must be a positive int32/);
  });

  it('checks chatter_n + 1 and both window products for all four device families', () => {
    const count = refDoc();
    setScalar(count, 'chatter_n', 2147483647);
    expect(() => loadProfile(count)).toThrow(/chatter_n \+ 1 must fit int32/);

    const cycles = [
      ['relay', 200, undefined],
      ['button', 500, undefined],
      ['switch', 1200, undefined],
      ['dial', 833, 'short-switch'],
    ] as const;
    for (const [device, cycleTicks, setup] of cycles) {
      const multiplier = Math.floor(2147483647 / cycleTicks) + 1;
      for (const key of ['chatter_cycles', 'chatter_quiet_cycles'] as const) {
        const doc = refDoc();
        if (key === 'chatter_quiet_cycles') setScalar(doc, 'chatter_cycles', 1);
        if (setup === 'short-switch') setScalar(doc, 'slide_stroke_us', 100);
        setScalar(doc, key, multiplier);
        expect(() => loadProfile(doc), `${key} ${device}`).toThrow(
          new RegExp(key + ' \\* ' + device + 'CycleTicks'),
        );
      }
    }
  });
});

describe('the load-time assertions', () => {
  it('accepts both shipped profiles as they stand', () => {
    expect(refA.id).toBe('MV601-REF-A');
    expect(refA.marginal).toBe(true);
    expect(ideal.id).toBe('MV601-IDEAL');
    expect(ideal.marginal).toBe(false);
  });

  it('rejects non-positive, equal, and reversed lamp-resistance endpoints', () => {
    for (const cold of [0, -1]) {
      const doc = refDoc();
      setScalar(doc, 'R_cold_uohm', cold);
      expect(() => loadProfile(doc), `R_cold_uohm=${cold}`).toThrow(/R_cold_uohm must be positive/);
    }

    for (const [cold, hot] of [[18_000_000, 18_000_000], [160_000_000, 18_000_000]]) {
      const doc = refDoc();
      setScalar(doc, 'R_cold_uohm', cold as number);
      setScalar(doc, 'R_hot_uohm', hot as number);
      expect(() => loadProfile(doc), `${cold}..${hot}`).toThrow(
        /R_hot_uohm must be greater than R_cold_uohm/,
      );
    }
  });

  it('rejects an ordered safe-integer pair that collapses after the Machine conversions', () => {
    const cold = 9_007_199_254_740_892;
    const hot = cold + 1;
    expect(Number.isSafeInteger(cold)).toBe(true);
    expect(Number.isSafeInteger(hot)).toBe(true);
    expect(hot).toBeGreaterThan(cold);
    expect(hot * 1e-6).toBe(cold * 1e-6);

    const doc = refDoc();
    setScalar(doc, 'R_cold_uohm', cold);
    setScalar(doc, 'R_hot_uohm', hot);
    expect(() => loadProfile(doc)).toThrow(/lamp-resistance span must be finite and positive after µΩ-to-Ω conversion/);
  });

  it('fires when tick_us * 20 reaches the shortest device latency (rule 15, 3.2)', () => {
    // The shortest latency on MV601-REF-A is the 8000 us release stroke; 100 * 20 = 2000 clears
    // it four-fold. Drop the stroke to exactly 2000 us and the strict inequality has to fail.
    const doc = refDoc();
    doc.values['relay_release_stroke_us'] = { v: 2000, tag: 'unverified', src: 'test' };
    expect(() => loadProfile(doc)).toThrow(/the tick is no longer the fixpoint/);

    const ok = refDoc();
    ok.values['relay_release_stroke_us'] = { v: 2100, tag: 'unverified', src: 'test' };
    expect(() => loadProfile(ok)).not.toThrow();
  });

  it('fires on the sweep assertion of section 5 when a contact could be skipped', () => {
    // Dead gap = 22.5 deg - 16.875 deg = 5_625_000 udeg. At 45 rpm the wiper covers 27_000 udeg
    // per tick, 208x under it; the hand rate is lower still. It takes 9_375_000 mrpm to reach it.
    expect(sweepUdegPerTick(45_000, 100)).toBe(27_000);
    expect(sweepUdegPerTick(30_000, 100)).toBe(18_000);

    const doc = refDoc();
    doc.values['run_mrpm'] = { v: 10_000_000, tag: 'unverified', src: 'test' };
    expect(() => loadProfile(doc)).toThrow(/a contact can be skipped/);

    // Both rates bound it, so the hand rate alone must be able to trip it too (section 5).
    const hand = refDoc();
    hand.values['hand_slew_mrpm'] = { v: 10_000_000, tag: 'unverified', src: 'test' };
    expect(() => loadProfile(hand)).toThrow(/a contact can be skipped/);
  });

  it('fires when the contact arc leaves the pad pitch', () => {
    for (const v of [0, 22_500_000, 30_000_000]) {
      const doc = refDoc();
      doc.values['contact_arc_udeg'] = { v, tag: 'unverified', src: 'test' };
      expect(() => loadProfile(doc)).toThrow(/must lie strictly inside the 22500000 µdeg pad pitch/);
    }
  });

  it('fires when break_milli and make_milli cannot form a both-open window', () => {
    const doc = refDoc();
    doc.values['break_milli'] = { v: 600, tag: 'unverified', src: 'test' };
    expect(() => loadProfile(doc)).toThrow(/must satisfy 0 <= break < make <= 1000/);
  });

  it('enforces 0 <= lamp_dim_milli < lamp_on_milli <= 1000 and accepts both boundaries', () => {
    for (const [dim, on] of [[-1, 600], [150, -1], [0, 0], [700, 600], [0, 1001]]) {
      const doc = refDoc();
      setScalar(doc, 'lamp_dim_milli', dim as number);
      setScalar(doc, 'lamp_on_milli', on as number);
      expect(() => loadProfile(doc), `${dim}..${on}`).toThrow(
        /must satisfy 0 <= lamp_dim_milli < lamp_on_milli <= 1000/,
      );
    }

    const boundaries = refDoc();
    setScalar(boundaries, 'lamp_dim_milli', 0);
    setScalar(boundaries, 'lamp_on_milli', 1000);
    expect(() => loadProfile(boundaries)).not.toThrow();
  });

  it('the section 6 tick-agreement assertion cannot fire through the schema, and that is fine', () => {
    // 6 asks that the post-quantization tick counts agree with the us inputs within 1 tick.
    // idivRound is round-to-nearest, so the residual is bounded by half a tick BY CONSTRUCTION
    // and no legal profile can violate it. The assertion is therefore not a data check; it is a
    // check that the derivation used was 4.4's. It stays because a port that truncates, scales
    // wrongly, or reads ms as us fails it, and those are the failures it exists to catch.
    for (let us = 1; us <= 100_000; us += 137) {
      for (const tick of [1, 7, 100, 3000]) {
        expect(Math.abs(idivRound(us, tick) * tick - us) * 2).toBeLessThanOrEqual(tick);
      }
    }
  });
});

describe('the lamp PWL (3.4, 10.1)', () => {
  it('ships 33 breakpoints on both profiles, monotone in both columns', () => {
    for (const p of [refA, ideal]) {
      expect(p.pwl.length).toBe(33);
      for (let i = 1; i < p.pwl.length; i++) {
        const a = p.pwl[i - 1] as readonly [number, number];
        const b = p.pwl[i] as readonly [number, number];
        expect(b[0]).toBeGreaterThan(a[0]);
        expect(b[1]).toBeGreaterThanOrEqual(a[1]);
      }
    }
  });

  it('reproduces test/mv601-ref.ts makePwl() exactly, so the KAT and the profile share one table', () => {
    const ref = makePwl();
    expect(ref.xs.length).toBe(33);
    for (let i = 0; i < 33; i++) {
      const got = refA.pwl[i] as readonly [number, number];
      expect(got[0]).toBe(roundHalfEven((ref.xs[i] as number) * 1e6));
      expect(got[1]).toBe(roundHalfEven((ref.ys[i] as number) * 1e6));
    }
    // The two ends are the tungsten law's own clamps: R_cold at 0 A and 2 * R_hot at 800 mA.
    expect(refA.pwl[0]).toEqual([0, 18_000_000]);
    expect(refA.pwl[32]).toEqual([800_000, 320_000_000]);
  });

  it('rejects a table whose breakpoint count is not 9 or 33', () => {
    const full = (refA.pwl as readonly (readonly number[])[]).map((p) => [...p]);
    const tooLong = [...full, [1_600_000, 320_000_000]];
    for (const v of [full.slice(0, 2), full.slice(0, 8), full.slice(0, 10), full.slice(0, 32), tooLong]) {
      const doc = refDoc();
      doc.values['lamp_pwl_uohm'] = { v, tag: 'unverified', src: 'test' };
      expect(() => loadProfile(doc)).toThrow(/allows N in \{9, 33\}/);
    }
    // 9 and 33 are both legal, and the KAT ships the 9 so the branch is exercised in a shipped file.
    const nine = refDoc();
    nine.values['lamp_pwl_uohm'] = { v: full.slice(0, 9), tag: 'unverified', src: 'test' };
    expect(() => loadProfile(nine)).not.toThrow();
  });

  it('rejects a non-monotone table in either column', () => {
    const xs = refDoc();
    const swapped = (refA.pwl as readonly (readonly number[])[]).map((p) => [...p]);
    const a = swapped[10] as number[];
    const b = swapped[11] as number[];
    [a[0], b[0]] = [b[0] as number, a[0] as number];
    xs.values['lamp_pwl_uohm'] = { v: swapped, tag: 'unverified', src: 'test' };
    expect(() => loadProfile(xs)).toThrow(/lamp_pwl_uohm is not monotone: current/);

    const ys = refDoc();
    const dented = (refA.pwl as readonly (readonly number[])[]).map((p) => [...p]);
    (dented[20] as number[])[1] = 1;
    ys.values['lamp_pwl_uohm'] = { v: dented, tag: 'unverified', src: 'test' };
    expect(() => loadProfile(ys)).toThrow(/lamp_pwl_uohm is not monotone: resistance/);
  });

  it('requires the first point to anchor zero current at R_cold_uohm', () => {
    const nonzeroCurrent = refDoc();
    const shifted = (refA.pwl as readonly (readonly number[])[]).map((p) => [...p]);
    (shifted[0] as number[])[0] = 1;
    nonzeroCurrent.values['lamp_pwl_uohm'] = { v: shifted, tag: 'unverified', src: 'test' };
    expect(() => loadProfile(nonzeroCurrent)).toThrow(/lamp_pwl_uohm\[0\] current must be 0/);

    const wrongResistance = refDoc();
    const detached = (refA.pwl as readonly (readonly number[])[]).map((p) => [...p]);
    (detached[0] as number[])[1] = refA.v.R_cold_uohm + 1;
    wrongResistance.values['lamp_pwl_uohm'] = { v: detached, tag: 'unverified', src: 'test' };
    expect(() => loadProfile(wrongResistance)).toThrow(
      /lamp_pwl_uohm\[0\] resistance must equal R_cold_uohm/,
    );
  });
});

describe('data/kat/profile-kat.json — layer 0 of the port proof (9.5)', () => {
  const kat = katJson as unknown as {
    schema: string;
    profile: unknown;
    derived: Record<string, unknown>;
  };

  it('is a self-contained minivac.profile/1 document that loads', () => {
    expect(kat.schema).toBe('minivac.profile-kat/1');
    const p = loadProfile(kat.profile);
    expect(p.id).toBe('MV601-KAT-A');
    // The KAT deliberately carries the 9-breakpoint table, so loading it exercises that branch.
    expect(p.pwl.length).toBe(9);
  });

  it('pairs that profile with its exact derived integer set', () => {
    const d = loadProfile(kat.profile).derived;
    expect(kat.derived['pullInUa']).toBe(d.pullInUa);
    expect(kat.derived['dropOutUa']).toBe(d.dropOutUa);
    expect(kat.derived['relayPullInUa']).toEqual(d.relayPullInUa);
    expect(kat.derived['relayDropOutUa']).toEqual(d.relayDropOutUa);
    expect(kat.derived['relayOperateTicks']).toBe(d.relayOperateTicks);
    expect(kat.derived['relayReleaseTicks']).toBe(d.relayReleaseTicks);
    expect(kat.derived['pushbuttonTicks']).toBe(d.pushbuttonTicks);
    expect(kat.derived['slideTicks']).toBe(d.slideTicks);
    expect(kat.derived['arcStepUa']).toBe(d.arcStepUa);
  });

  it('carries the derived integers a porter checks by eye, and kThermal as hex', () => {
    expect(kat.derived['pullInUa']).toBe(43_333);
    expect(kat.derived['dropOutUa']).toBe(16_667);
    expect(kat.derived['relayPullInUa']).toEqual([45_333, 41_733, 45_267, 42_600, 45_000, 42_200]);
    expect(kat.derived['relayDropOutUa']).toEqual([18_667, 15_067, 18_600, 15_933, 18_333, 15_533]);
    expect(kat.derived['arcStepUa']).toBe(2500);
    // Every integer in the block is an integer; only kThermal is a double, and it is hex-encoded
    // the way data/kat/solver-kat.json encodes doubles, so no decimal formatter is in the loop.
    for (const [k, v] of Object.entries(kat.derived)) {
      if (k === 'kThermal') continue;
      for (const n of Array.isArray(v) ? v : [v]) expect(Number.isSafeInteger(n)).toBe(true);
    }
    expect(kat.derived['kThermal']).toBe('0x3f646dce34596066');
    expect(doubleOfHex(kat.derived['kThermal'] as string)).toBe(100 / 40100);
  });
});

describe('data/kat/w3-derived-kat.json — the immutable Wave 3 layer-0 extension', () => {
  const wave1 = katJson as unknown as {
    schema: string;
    profile: unknown;
    derived: Record<string, unknown>;
  };
  const w3 = w3KatJson as unknown as {
    schema: string;
    source: Record<string, unknown>;
    derived: Record<string, unknown>;
  };

  it('pins the exact schemas, source identity and semantic profile hash', () => {
    expect(Object.keys(w3)).toEqual(['schema', 'source', 'derived']);
    expect(w3.schema).toBe('minivac.w3-derived-kat/1');
    expect(Object.keys(w3.source)).toEqual(['profileKat', 'profileId', 'profileHash']);
    expect(w3.source).toEqual({
      profileKat: 'data/kat/profile-kat.json',
      profileId: 'MV601-KAT-A',
      profileHash: '8fb3c78e1d2c9a09',
    });
    const profile = loadProfile(wave1.profile);
    expect(profile.id).toBe(w3.source['profileId']);
    expect(profile.hash).toBe(w3.source['profileHash']);
    expect(profile.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('matches the nine new values and exactly completes the Derived member union', () => {
    const derived = loadProfile(wave1.profile).derived;
    expect(Object.keys(w3.derived)).toEqual([
      'tripDelayTicks', 'deadShortUa', 'rMotorParUohm', 'vMotorRunMv', 'relayCycleTicks',
      'buttonCycleTicks', 'switchCycleTicks', 'dialCycleTicks', 'settleCapTicks',
    ]);
    for (const [key, value] of Object.entries(w3.derived)) {
      expect(derived[key as keyof typeof derived], key).toBe(value);
    }
    const union = new Set([...Object.keys(wave1.derived), ...Object.keys(w3.derived)]);
    expect(Object.keys(derived).sort()).toEqual([...union].sort());
    expect(union.size).toBe(Object.keys(wave1.derived).length + Object.keys(w3.derived).length);
  });
});

describe('the semantic profile hash and recursive runtime immutability', () => {
  it('hashes numeric semantics while excluding provenance and member order', () => {
    const base = refA.hash;
    expect(base).toMatch(/^[0-9a-f]{16}$/);

    const prose = refDoc();
    prose.provenance = 'different profile provenance';
    prose.values['V_oc_mv'] = { v: 13000, tag: 'assumption', src: 'different value provenance' };
    expect(loadProfile(prose).hash).toBe(base);

    const reordered = refDoc();
    reordered.values = Object.fromEntries(Object.entries(reordered.values).reverse());
    expect(loadProfile(reordered).hash).toBe(base);

    for (const mutate of [
      (doc: Doc): void => setScalar(doc, 'V_oc_mv', 13001),
      (doc: Doc): void => {
        const entry = doc.values['dV_relay_mv'] as Entry;
        entry.v = [-281, -169, -56, 56, 169, 282];
      },
      (doc: Doc): void => {
        const entry = doc.values['lamp_pwl_uohm'] as Entry;
        const points = entry.v as number[][];
        points[1] = [points[1]?.[0] as number, (points[1]?.[1] as number) + 1];
      },
    ]) {
      const doc = refDoc();
      mutate(doc);
      expect(loadProfile(doc).hash).not.toBe(base);
    }
  });

  it('freezes the root, nested records, both derived arrays, PWL and every tuple', () => {
    const profile = loadProfile(refJson);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.v)).toBe(true);
    expect(Object.isFrozen(profile.derived)).toBe(true);
    expect(Object.isFrozen(profile.derived.relayPullInUa)).toBe(true);
    expect(Object.isFrozen(profile.derived.relayDropOutUa)).toBe(true);
    expect(Object.isFrozen(profile.dVRelayMv)).toBe(true);
    expect(Object.isFrozen(profile.pwl)).toBe(true);
    for (const point of profile.pwl) expect(Object.isFrozen(point)).toBe(true);

    const mutable = profile as unknown as {
      id: string;
      v: Record<string, number>;
      derived: Record<string, unknown> & { relayPullInUa: number[]; relayDropOutUa: number[] };
      dVRelayMv: number[];
      pwl: number[][];
    };
    expect(() => { mutable.id = 'changed'; }).toThrow(TypeError);
    expect(() => { mutable.v['tick_us'] = 101; }).toThrow(TypeError);
    expect(() => { mutable.derived['tripDelayTicks'] = 1; }).toThrow(TypeError);
    expect(() => { mutable.derived.relayPullInUa[0] = 1; }).toThrow(TypeError);
    expect(() => { mutable.derived.relayDropOutUa[0] = 1; }).toThrow(TypeError);
    expect(() => { mutable.dVRelayMv[0] = 1; }).toThrow(TypeError);
    expect(() => { mutable.pwl.push([1, 1]); }).toThrow(TypeError);
    expect(() => { (mutable.pwl[0] as number[])[0] = 1; }).toThrow(TypeError);

    expect(profile.id).toBe('MV601-REF-A');
    expect(profile.v.tick_us).toBe(100);
    expect(profile.derived.tripDelayTicks).toBe(2000);
    expect(profile.derived.relayPullInUa[0]).toBe(41_453);
    expect(profile.derived.relayDropOutUa[0]).toBe(14_787);
    expect(profile.dVRelayMv[0]).toBe(-282);
    expect(profile.pwl[0]).toEqual([0, 18_000_000]);
  });
});

describe('MV601-IDEAL is a profile swap, not a second code path (section 11)', () => {
  it('differs from MV601-REF-A in exactly the three values 11 names, plus the flag', () => {
    const a = clone(refJson).values;
    const b = clone(idealJson).values;
    const allowed = new Set(['L_coil_uh', 'V_pullin_mv', 'dV_relay_mv']);
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    const changedValues: string[] = [];
    for (const k of Object.keys(a)) {
      if (allowed.has(k)) {
        if (JSON.stringify((a[k] as { v: unknown }).v) !== JSON.stringify((b[k] as { v: unknown }).v)) {
          changedValues.push(k);
        }
      } else {
        // The swap contract covers the complete entry, including tag and citation, not only `v`.
        expect(b[k], `${k} changed outside the three allowed profile-swap values`).toEqual(a[k]);
      }
    }
    expect(changedValues.sort()).toEqual([...allowed].sort());
    expect(refA.marginal).toBe(true);
    expect(ideal.marginal).toBe(false);
  });

  it('relaxes pull-in below the lamp-divided rail with margin', () => {
    // components.md 8.3: the lamp-fed loop delivers 6.92 V light-load, 6.62 V fully loaded.
    // MV601-REF-A's 6.5 V sits just under the first, which is what lets sag cross it.
    expect(refA.v.V_pullin_mv).toBe(6500);
    expect(ideal.v.V_pullin_mv).toBe(5500);
    expect(ideal.derived.pullInUa).toBe(idivRound(5500 * 1_000_000_000, 150_000_000));
    expect(ideal.derived.pullInUa).toBe(36_667);
    // 5.5 V is 20.5% under the light-load figure and 16.9% under the loaded one, against the
    // 4.38% of sag components.md 8.3 says the machine actually has.
    expect((6920 - 5500) / 6920).toBeGreaterThan(0.04380 * 3);
  });

  it('zeroes the per-relay spread and reduces L_coil for the control profile', () => {
    expect(ideal.dVRelayMv).toEqual([0, 0, 0, 0, 0, 0]);
    for (const ua of ideal.derived.relayPullInUa) expect(ua).toBe(ideal.derived.pullInUa);
    // 0.012 H against the 281.7 ohm C-fed loop is a 43 us time constant; the electrical rise
    // completes inside two ticks of a 120-tick operate stroke. MV601-REF-A's 1.2 H is 100x that.
    expect(ideal.v.L_coil_uh).toBe(12_000);
    expect(refA.v.L_coil_uh / ideal.v.L_coil_uh).toBe(100);
    const tauUs = (ideal.v.L_coil_uh / 1e6 / 281.7) * 1e6;
    expect(tauUs).toBeLessThan(ideal.v.tick_us);
  });
});

// -----------------------------------------------------------------------------------------------
// R1-R6.
//
// The inputs R2-R6 need are not profile keys — a hold duration belongs to a script and the
// shorted-release hold-off belongs to a circuit — so they are stated here, with their arithmetic.
// -----------------------------------------------------------------------------------------------

/**
 * The freewheel hold-off, in ticks: how long a short-circuited coil's current takes to fall from
 * the E-fed asymptote to drop-out before the mechanical release stroke begins (architecture §4.2).
 *
 * `i_n = i_prev * (L/dt) / (R_coil + L/dt)` — §3.3's own shorted-coil companion, 0.9877 per tick
 * on the shipped numbers. `Math.log` is legal out here and barred in `src/core` (rule 5); the
 * solver measures this quantity per-circuit; this closed form remains an independent check of that
 * measured path.
 */
function shortedHoldOffTicks(lH: number, rOhm: number, dtS: number, i0A: number, iTargetA: number): number {
  const perTick = (lH / dtS) / (rOhm + lH / dtS);
  return Math.ceil(Math.log(iTargetA / i0A) / Math.log(perTick));
}

// Every quantity here comes out of the SHIPPED PROFILE, never out of `test/mv601-ref.ts`.
// `mv601-ref.ts`'s `L_COIL` is the solver KAT's arbitrary test vector, deliberately not the same
// thing as `L_coil_uh`. W1's completed sweep did not solve the constant; the profile retains 1.2 H
// for its release-path role. They happen to agree today; reading the KAT's value here would silently
// couple the shipped profile to a W1a fixture the moment they diverge.
const HOLD_OFF_REF_A = shortedHoldOffTicks(
  refA.v.L_coil_uh / 1e6,
  refA.v.R_coil_uohm / 1e6,
  refA.v.tick_us / 1e6,
  refA.v.V_oc_mv / 1e3 / (refA.v.R_src_uohm / 1e6 + refA.v.R_coil_uohm / 1e6),
  refA.derived.dropOutUa / 1e6,
);

/** 120 Hz full-wave ripple from 60 Hz mains (components.md §7.2, §9.3) — a 8333 µs period. */
const RIPPLE_PERIOD_US = 8333;

function inputs(over: Partial<ConstraintInputs>): ConstraintInputs {
  return {
    buttonHoldTicks: null,
    buttonUpTicks: null,
    shortedHoldOffTicks: null,
    carryChain: null,
    ripplePeriodUs: null,
    r6: null,
    ...over,
  };
}

describe('R1-R6 on MV601-REF-A (components.md 9.3)', () => {
  it('R1 — the both-open window against the release, repaired from 9.3s 1.04x', () => {
    // bothOpen = (550 - 450) / 1000 * 80 = 8 ticks. toBreak = (1000 - 450) / 1000 * 80 = 44.
    expect(bothOpenTicks(refA)).toBe(8);
    expect(releaseToBreakTicks(refA)).toBe(44);
    const r1 = evalConstraints(refA, inputs({}))[0];
    expect(r1?.id).toBe('R1');
    expect(r1?.actual).toBe(44);
    expect(r1?.required).toBe(24); // 3 x 8
    expect(r1?.margin).toBe(20);
    expect(r1?.status).toBe('pass');

    // components.md 9.3's own fracs, 0.35 / 0.60, are what fail: bothOpen = 20, toBreak = 52,
    // required 60, margin -8. That is the constraint architecture 4.4 changed the pair for.
    const old = refDoc();
    old.values['break_milli'] = { v: 350, tag: 'unverified', src: 'MV601-TIMING-A as published' };
    old.values['make_milli'] = { v: 600, tag: 'unverified', src: 'MV601-TIMING-A as published' };
    const timingA = loadProfile(old);
    const r1old = evalConstraints(timingA, inputs({}))[0];
    expect(r1old?.margin).toBe(-8);
    expect(r1old?.status).toBe('fail');
  });

  it('R2 — a hold must outlast the slower of operate and shorted release', () => {
    // The shorted release is 133 ticks of freewheel hold-off plus the 80-tick mechanical stroke.
    expect(HOLD_OFF_REF_A).toBe(133);
    const r2 = evalConstraints(refA, inputs({ buttonHoldTicks: 250, shortedHoldOffTicks: HOLD_OFF_REF_A }))[1];
    expect(r2?.id).toBe('R2');
    expect(r2?.required).toBe(213); // max(operate 120, 133 + 80)
    expect(r2?.actual).toBe(250);
    expect(r2?.margin).toBe(37);
    expect(r2?.status).toBe('pass');
  });

  it('R3 — the button-up interval must outlast the slave relays operate', () => {
    const r3 = evalConstraints(refA, inputs({ buttonUpTicks: 250 }))[2];
    expect(r3?.required).toBe(120);
    expect(r3?.margin).toBe(130);
    expect(r3?.status).toBe('pass');

    const tight = evalConstraints(refA, inputs({ buttonUpTicks: 120 }))[2];
    expect(tight?.status).toBe('fail'); // strictly greater, not equal
  });

  it('R4 — the carry chain is what separates IV-EXP1-SLOW from IV-EXP1-FAST', () => {
    // The 3->4 step: stages 1 and 2 go 1->0 (a shorted release each, emitting a carry) and stage
    // 3 goes 0->1 (an operate, terminating). 2 * 213 + 120 = 546 ticks = 54.6 ms of hold.
    const chain = { shortedReleases: 2, operates: 1 };
    const tap = evalConstraints(refA, inputs({ buttonHoldTicks: 250, shortedHoldOffTicks: HOLD_OFF_REF_A, carryChain: chain }))[3];
    expect(tap?.required).toBe(546);
    expect(tap?.actual).toBe(250);
    expect(tap?.margin).toBe(-296);
    expect(tap?.status).toBe('fail');

    const hold = evalConstraints(refA, inputs({ buttonHoldTicks: 1000, shortedHoldOffTicks: HOLD_OFF_REF_A, carryChain: chain }))[3];
    expect(hold?.margin).toBe(454);
    expect(hold?.status).toBe('pass');
  });

  it('R5 — still fails against the 8.33 ms ripple period, exactly as MV601-TIMING-A did', () => {
    const off = evalConstraints(refA, inputs({}))[4];
    expect(off?.status).toBe('unevaluated');
    expect(off?.why).toMatch(/supply_ripple default OFF/);

    // components.md 9.3's second failing constraint: relay_release_open_ms 8.0 < the 8.33 ms
    // ripple half-period. Architecture 4.4 kept 8000 us as the mechanical stroke, so it is
    // inherited: 80 ticks against 83. Harmless while ripple is off, which is why it ships.
    const on = evalConstraints(refA, inputs({ ripplePeriodUs: RIPPLE_PERIOD_US }))[4];
    expect(on?.required).toBe(83);
    expect(on?.actual).toBe(80);
    expect(on?.margin).toBe(-3);
    expect(on?.status).toBe('fail');
  });

  it('R6 — is unevaluated without the solver, and reports the numbers it is evaluated on', () => {
    const r6 = evalConstraints(refA, inputs({}))[5];
    expect(r6?.status).toBe('unevaluated');
    expect(r6?.why).toContain('pullInUa=43333');
    expect(r6?.why).toContain('relayPullInUa=[41453,42207,42960,43707,44460,45213]');
    expect(r6?.why).toContain('operate=120 ticks');

    const verdicts = evalConstraints(refA, inputs({ r6: { miscountsWithLamp: true, countsWithoutLamp: true, marginUa: 1200 } }))[5];
    expect(verdicts?.status).toBe('pass');
    expect(verdicts?.margin).toBe(1200);

    const half = evalConstraints(refA, inputs({ r6: { miscountsWithLamp: false, countsWithoutLamp: true, marginUa: 40 } }))[5];
    expect(half?.status).toBe('fail');
  });

  it('returns all six, in order, and never silently passes an unsupplied input', () => {
    const all = evalConstraints(refA, inputs({}));
    expect(all.map((r) => r.id)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
    expect(all.filter((r) => r.status === 'unevaluated').map((r) => r.id)).toEqual(['R2', 'R3', 'R4', 'R5', 'R6']);
  });

  it('MV601-IDEAL passes R1 on the same fracs and loses the shorted-release hold-off', () => {
    const r1 = evalConstraints(ideal, inputs({}))[0];
    expect(r1?.status).toBe('pass');
    // At 0.012 H the freewheel is 0.444 per tick, so the hold-off is 3 ticks rather than 133;
    // the shorted and open release calculations have the same tick-scale hold-off.
    const holdOff = shortedHoldOffTicks(
      ideal.v.L_coil_uh / 1e6,
      ideal.v.R_coil_uohm / 1e6,
      ideal.v.tick_us / 1e6,
      ideal.v.V_oc_mv / 1e3 / (ideal.v.R_src_uohm / 1e6 + ideal.v.R_coil_uohm / 1e6),
      ideal.derived.dropOutUa / 1e6,
    );
    expect(holdOff).toBe(3);
    const r4 = evalConstraints(ideal, inputs({ buttonHoldTicks: 250, shortedHoldOffTicks: holdOff, carryChain: { shortedReleases: 2, operates: 1 } }))[3];
    expect(r4?.required).toBe(286); // 2 * 83 + 120, against MV601-REF-A's 546
    expect(r4?.status).toBe('fail');
  });
});
