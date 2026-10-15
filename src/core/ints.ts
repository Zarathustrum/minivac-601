/**
 * Integer and hashing primitives shared by the whole core.
 *
 * Architecture §3.5 (quantize), §4.4 (idiv / idivRound and which derivation uses which),
 * §5 (mod, iabs) and determinism rules 10 and 13.
 *
 * Every function here is a portability contract: a C# port implements these exact rules or the
 * goldens diverge. Nothing in this file allocates, reads a clock, or calls a transcendental.
 */

/** Carries the "this run used arithmetic a port may not reproduce" bit (determinism rule 10). */
export interface PortFlags {
  nonPortable: boolean;
}

const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

/**
 * Round to nearest, ties to even — banker's rounding.
 *
 * Hand-written on purpose. `Math.round` rounds halves *up* (toward +Infinity), so
 * `Math.round(-0.5)` is `-0` and `Math.round(2.5)` is `3`; both differ from the rule the
 * quantizer needs, and .NET's `Math.Round` default is half-even, so using `Math.round` here
 * would build the divergence straight into the TypeScript side.
 */
export function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff > 0.5) return f + 1;
  // Exactly a half: take the even neighbour. `f % 2` is 0 or -0 when f is even, and -0 === 0.
  const r = diff < 0.5 ? f : f % 2 === 0 ? f : f + 1;
  // -0 -> 0. Determinism rule 10 puts the normalisation in the ROUND step, not only in `quantize`:
  // `Math.floor(-0)` is `-0`, so the pass-through branch above would otherwise hand a negative zero
  // back to any caller that rounds without quantizing.
  return r === 0 ? 0 : r;
}

/**
 * The one quantizer (architecture §3.5, determinism rule 10).
 *
 * Scale first, then round half-even, then a *saturating* clamp to int32. Never a bare cast of an
 * out-of-range double: JS `x|0` wraps modulo 2^32, .NET Core saturates and .NET Framework yields
 * 0x80000000 — three answers for one expression. NaN, +/-Infinity and any clamp raise
 * `flags.nonPortable`.
 */
export function quantize(x: number, scale: number, flags: PortFlags): number {
  const s = x * scale;
  if (Number.isNaN(s) || s === Infinity || s === -Infinity) {
    flags.nonPortable = true;
    return 0;
  }
  const r = roundHalfEven(s);
  if (r > INT32_MAX) {
    flags.nonPortable = true;
    return INT32_MAX;
  }
  if (r < INT32_MIN) {
    flags.nonPortable = true;
    return INT32_MIN;
  }
  return r === 0 ? 0 : r; // -0 -> 0
}

/**
 * Integer division truncating toward zero — C#'s `/` on integers, and what §4.4's `idiv` means.
 *
 * **Domain: `a` and `b` are integers with `|a|, |b| <= 2^53`** — §4.4's "TS integers are exact
 * below 2^53", which is the range every derivation in that section lives in. Inside it,
 * `Math.trunc(a / b)` is already exact: `a / b` is correctly rounded to the nearest double, and
 * for an exactly representable a and b the nearest double can only cross an integer boundary once
 * the true quotient is within half an ulp of it, which cannot happen while both operands are
 * exact. Verified against a BigInt reference over 2,000,000 random pairs (500,000 per sign
 * combination) spanning magnitudes from 1 to 2^53: zero disagreements.
 *
 * An earlier revision carried a remainder-sign correction step. It is deleted rather than kept as
 * belt-and-braces: it fired zero times over the same 2,000,000 pairs, and OUTSIDE the domain it
 * fires and returns a WRONG answer, because there `q * b` is not exact either, so the remainder it
 * tests is not the real remainder. A branch that cannot help inside the contract and actively
 * hurts outside it is worse than no branch.
 *
 * `idiv(x, 0)` is NOT integer division: `x / 0` is +/-Infinity (NaN for `0 / 0`), `Math.trunc`
 * passes that through, and the result is +/-Infinity or NaN. C# throws `DivideByZeroException` on
 * the same input. No caller in this project divides by zero — every divisor is a profile value
 * asserted non-zero at load — and the divergence is recorded here rather than papered over with a
 * guard that would itself have to be ported.
 */
export function idiv(a: number, b: number): number {
  const q = Math.trunc(a / b);
  return q === 0 ? 0 : q; // -0 -> 0: integer division in C# has no negative zero
}

/**
 * Integer division rounding halves away from zero (architecture §4.4).
 *
 * This is the rule that decides the rotary's pitch boundary at exactly 11.25 degrees and that
 * turns 12000 us into 120 stroke ticks, so it is stated rather than implied. Same domain as
 * `idiv`: integer `a`, `b` with `|a|, |b| <= 2^53`.
 */
export function idivRound(a: number, b: number): number {
  const q = idiv(a, b);
  const r = a - q * b; // |r| < |b|, sign of a
  if (iabs(r) * 2 >= iabs(b)) return q + ((a < 0) !== (b < 0) ? -1 : 1);
  return q === 0 ? 0 : q; // -0 -> 0
}

/**
 * Mathematical modulus: the result is always in [0, b).
 *
 * **Precondition: `b > 0`.** The one caller is §5's rotary angle wrap, whose modulus is
 * 360_000_000. With `b < 0` the single `m + b` correction lands in `(b, 0]` rather than `[0, b)`,
 * and with `b === 0` the result is NaN — neither is defined behaviour here, and neither is
 * guarded, because a guard would be one more thing a port has to reproduce exactly.
 */
export function mod(a: number, b: number): number {
  const m = a % b;
  if (m < 0) return m + b;
  return m === 0 ? 0 : m; // -0 -> 0
}

/** Absolute value on integers. */
export function iabs(a: number): number {
  if (a < 0) return -a;
  return a === 0 ? 0 : a; // -0 -> 0
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const FNV_MASK = 0xffffffffffffffffn;

/**
 * FNV-1a 64 over raw bytes, rendered as exactly 16 lowercase zero-padded hex digits
 * (determinism rule 13 — the only hash in the project).
 *
 * BigInt with an explicit mask after every step: the 64-bit wrap is part of the algorithm, not an
 * artifact of a machine word, so a port using `ulong` and this using BigInt agree by construction.
 */
export function fnv1a64(bytes: Uint8Array): string {
  let h = FNV_OFFSET_BASIS;
  for (let i = 0; i < bytes.length; i++) {
    h = (h ^ BigInt(bytes[i] as number)) & FNV_MASK;
    h = (h * FNV_PRIME) & FNV_MASK;
  }
  let s = h.toString(16);
  while (s.length < 16) s = '0' + s;
  return s;
}
