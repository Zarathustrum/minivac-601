import { describe, expect, it } from 'vitest';
import { fnv1a64, iabs, idiv, idivRound, mod, quantize, roundHalfEven } from '../src/core/ints.ts';
import type { PortFlags } from '../src/core/ints.ts';

function flags(): PortFlags {
  return { nonPortable: false };
}

function ascii(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

describe('roundHalfEven', () => {
  it('takes the even neighbour at every half, both signs', () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
    expect(roundHalfEven(-0.5)).toBe(0);
    expect(roundHalfEven(-1.5)).toBe(-2);
    expect(roundHalfEven(-2.5)).toBe(-2);
    expect(roundHalfEven(-3.5)).toBe(-4);
  });

  it('differs from Math.round exactly where it must', () => {
    // Math.round is half-UP: 2.5 -> 3 and -0.5 -> -0. Both are the divergence this function exists
    // to prevent, since .NET's default Math.Round is half-even.
    expect(Math.round(2.5)).toBe(3);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(Object.is(Math.round(-0.5), -0)).toBe(true);
    expect(Object.is(roundHalfEven(-0.5), 0)).toBe(true);
  });

  it('rounds to nearest away from the halves', () => {
    expect(roundHalfEven(0.4999999999)).toBe(0);
    expect(roundHalfEven(0.5000000001)).toBe(1);
    expect(roundHalfEven(-0.5000000001)).toBe(-1);
    expect(roundHalfEven(1e300)).toBe(1e300);
  });

  it('never returns -0, including on -0 itself', () => {
    // Determinism rule 10 puts `-0 -> 0` in the ROUND step, not only in `quantize`. `Math.floor(-0)`
    // is `-0` and `-0 - -0` is `+0`, so the "below a half" branch used to pass a negative zero
    // straight back out. `-0 === 0` is true, so `toBe(0)` cannot see this; `Object.is` can.
    expect(Object.is(roundHalfEven(-0), 0)).toBe(true);
    expect(Object.is(roundHalfEven(-0.25), 0)).toBe(true);
    expect(Object.is(roundHalfEven(0), 0)).toBe(true);
  });
});

describe('quantize', () => {
  it('applies the scale before rounding', () => {
    const f = flags();
    // 0.0865 V -> 86.5 mV -> half-even -> 86, not (round(0.0865) * 1000).
    expect(quantize(0.0865, 1000, f)).toBe(86);
    expect(quantize(0.0875, 1000, f)).toBe(88);
    expect(f.nonPortable).toBe(false);
  });

  it('rounds halves to even on both signs', () => {
    const f = flags();
    expect(quantize(2.5, 1, f)).toBe(2);
    expect(quantize(3.5, 1, f)).toBe(4);
    expect(quantize(-2.5, 1, f)).toBe(-2);
    expect(quantize(-3.5, 1, f)).toBe(-4);
    expect(f.nonPortable).toBe(false);
  });

  it('normalises -0 to +0', () => {
    const f = flags();
    expect(Object.is(quantize(-0.4, 1, f), 0)).toBe(true);
    expect(Object.is(quantize(-0, 1000, f), 0)).toBe(true);
    expect(f.nonPortable).toBe(false);
  });

  it('returns 0 and flags on NaN and both infinities', () => {
    for (const x of [NaN, Infinity, -Infinity]) {
      const f = flags();
      expect(quantize(x, 1000, f)).toBe(0);
      expect(f.nonPortable).toBe(true);
    }
    const f = flags();
    expect(quantize(1e308, 1e308, f)).toBe(0); // the product overflows to +Infinity
    expect(f.nonPortable).toBe(true);
  });

  it('saturates at the int32 rails and flags the clamp', () => {
    const hi = flags();
    expect(quantize(3e9, 1, hi)).toBe(2147483647);
    expect(hi.nonPortable).toBe(true);

    const lo = flags();
    expect(quantize(-3e9, 1, lo)).toBe(-2147483648);
    expect(lo.nonPortable).toBe(true);

    // The rails themselves are representable and are NOT a clamp.
    const edge = flags();
    expect(quantize(2147483647, 1, edge)).toBe(2147483647);
    expect(quantize(-2147483648, 1, edge)).toBe(-2147483648);
    expect(edge.nonPortable).toBe(false);

    // A bare cast is the hazard the clamp replaces: JS wraps modulo 2^32 here, .NET Core saturates.
    expect(3e9 | 0).not.toBe(2147483647);
  });
});

describe('idiv', () => {
  it('truncates toward zero on every sign combination', () => {
    expect(idiv(7, 2)).toBe(3);
    expect(idiv(-7, 2)).toBe(-3);
    expect(idiv(7, -2)).toBe(-3);
    expect(idiv(-7, -2)).toBe(3);
    expect(idiv(6, 3)).toBe(2);
    expect(idiv(-6, 3)).toBe(-2);
    expect(idiv(1, 3)).toBe(0);
    expect(idiv(-1, 3)).toBe(0);
    expect(idiv(0, 3)).toBe(0);
  });

  it('holds on the derivation-sized operands of architecture 4.4', () => {
    expect(idiv(6500 * 1_000_000_000, 150_000_000)).toBe(43_333); // 43_333.33 uA, truncated
    expect(idiv(12000, 100)).toBe(120);
  });

  it('agrees with BigInt truth across the documented domain', () => {
    // §4.4's domain is integer operands exact below 2^53. `Math.trunc(a / b)` is already exact
    // there, which is why the remainder-sign correction step this function used to carry is gone:
    // it never fired inside the domain and returned WRONG answers outside it, where `q * b` is not
    // exact either. Deterministic operands, no RNG in a test that has to be reproducible.
    const mags = [1, 3, 7, 999, 1_000_003, 2 ** 26 - 1, 2 ** 31 - 1, 2 ** 42 + 5, 2 ** 53 - 1];
    for (const ma of mags) {
      for (const mb of mags) {
        for (const sa of [1, -1]) {
          for (const sb of [1, -1]) {
            const a = sa * ma;
            const b = sb * mb;
            const truth = Number(BigInt(a) / BigInt(b)); // BigInt / also truncates toward zero
            expect(idiv(a, b), `idiv(${a}, ${b})`).toBe(truth === 0 ? 0 : truth);
          }
        }
      }
    }
  });

  it('never returns -0', () => {
    expect(Object.is(idiv(0, -5), 0)).toBe(true);
    expect(Object.is(idiv(-3, 5), 0)).toBe(true);
    expect(Object.is(idiv(3, -5), 0)).toBe(true);
  });

  it('divides by zero the way the doc says, not the way C# does', () => {
    // Recorded rather than guarded: C# throws DivideByZeroException on the same input, and the
    // divergence belongs in a test where a porter will see it. No caller divides by zero.
    expect(idiv(5, 0)).toBe(Infinity);
    expect(idiv(-5, 0)).toBe(-Infinity);
    expect(Number.isNaN(idiv(0, 0))).toBe(true);
  });
});

describe('idivRound', () => {
  it('rounds halves away from zero on every sign combination', () => {
    expect(idivRound(5, 2)).toBe(3);
    expect(idivRound(-5, 2)).toBe(-3);
    expect(idivRound(5, -2)).toBe(-3);
    expect(idivRound(-5, -2)).toBe(3);
    expect(idivRound(7, 2)).toBe(4);
    expect(idivRound(-7, 2)).toBe(-4);
  });

  it('rounds to nearest away from the halves', () => {
    expect(idivRound(1, 3)).toBe(0);
    expect(idivRound(2, 3)).toBe(1);
    expect(idivRound(-1, 3)).toBe(0);
    expect(idivRound(-2, 3)).toBe(-1);
    expect(idivRound(4, 2)).toBe(2);
    expect(idivRound(0, 7)).toBe(0);
  });

  it('reproduces the 4.4 derivations', () => {
    // pullInUa = idivRound(V_pullin_mv * 1e9, R_coil_uohm) -> 6500 mV into 150 ohm = 43_333 uA
    expect(idivRound(6500 * 1_000_000_000, 150_000_000)).toBe(43_333);
    // strokeTicks = idivRound(stroke_us, tick_us) -> 12000 us at 100 us = 120 ticks
    expect(idivRound(12000, 100)).toBe(120);
    // arcStepUa = idivRound(V_arc_clamp_mv * tick_us * 1000, L_coil_uh) -> 30 V, 100 us, 1.2 H
    expect(idivRound(30_000 * 100 * 1000, 1_200_000)).toBe(2500);
    // The rotary's pitch boundary decides at exactly 11.25 degrees by this rule (section 5).
    expect(idivRound(11_250_000, 22_500_000)).toBe(1);
    expect(idivRound(-11_250_000, 22_500_000)).toBe(-1);
  });
});

describe('mod', () => {
  it('is mathematical: the result is always in [0, b)', () => {
    expect(mod(7, 3)).toBe(1);
    expect(mod(-7, 3)).toBe(2);
    expect(mod(-1, 360)).toBe(359);
    expect(mod(0, 360)).toBe(0);
    expect(mod(360, 360)).toBe(0);
    expect(mod(-360, 360)).toBe(0);
    expect(mod(-359_999_999, 360_000_000)).toBe(1);
  });

  it('never returns -0', () => {
    expect(Object.is(mod(-0, 360), 0)).toBe(true);
    expect(Object.is(mod(-360, 360), 0)).toBe(true);
  });
});

describe('iabs', () => {
  it('is exact, including at -0 and the int32 rails', () => {
    expect(iabs(5)).toBe(5);
    expect(iabs(-5)).toBe(5);
    expect(iabs(0)).toBe(0);
    expect(Object.is(iabs(-0), 0)).toBe(true);
    expect(iabs(-2147483648)).toBe(2147483648);
  });
});

describe('fnv1a64', () => {
  it('matches the standard vectors', () => {
    expect(fnv1a64(ascii(''))).toBe('cbf29ce484222325'); // the offset basis itself
    expect(fnv1a64(ascii('a'))).toBe('af63dc4c8601ec8c');
    // Published FNV-1a 64 vector, re-derived from the constants by a separate implementation
    // before being written down here.
    expect(fnv1a64(ascii('foobar'))).toBe('85944171f73967e8');
  });

  it('renders exactly 16 lowercase zero-padded hex digits', () => {
    for (const s of ['', 'a', 'foobar', 'minivac.solver-kat/1', 'the quick brown fox']) {
      expect(fnv1a64(ascii(s))).toMatch(/^[0-9a-f]{16}$/);
    }
    // A longer project-shaped vector, verified against the same independent implementation.
    expect(fnv1a64(ascii('minivac.solver-kat/1'))).toBe('116d570d8ebdf1dc');
  });

  it('is sensitive to byte order and to a single bit', () => {
    expect(fnv1a64(ascii('ab'))).not.toBe(fnv1a64(ascii('ba')));
    expect(fnv1a64(Uint8Array.from([0]))).not.toBe(fnv1a64(Uint8Array.from([1])));
  });
});
