/**
 * MV601-REF-A's electrical numbers (components.md §8.2) and the tungsten lamp law, as the
 * *reference* side of the Wave 1a tests.
 *
 * This file is test-side on purpose. `Math.pow` is barred inside `src/core/**` (determinism rule
 * 5) precisely because it is not required to be correctly rounded, so the shipped artifact is the
 * PWL table and the closed-form law lives out here, where it is only ever used to build that table
 * and to sanity-check it.
 */

export const V_OC = 13.0; // V, MAINT p.3 "approximately 13 volts"
export const R_SRC = 0.67; // ohm
export const R_COIL = 150; // ohm
export const R_HOT = 160; // ohm at I_HOT
export const I_HOT = 0.081; // A
export const R_COLD = 18; // ohm
export const R_CLAMP_LO = 18; // = R_cold
export const R_CLAMP_HI = 320; // = 2 * R_hot

/**
 * The inductance the solver KAT is frozen against. **This is an arbitrary test vector, NOT
 * `L_coil_uh`.**
 *
 * §4.4 says `L_coil` is "deliberately not pinned here." `tools/check-profile.ts` reports the
 * release-path sweep; R1, AT-01, and AT-11 do not select the value. The KAT needs *some*
 * inductance to have arithmetic to freeze, so it takes a value
 * from §4.4's indicative 0.9-1.5 H band and hex-freezes it. Nothing here is evidence for it, and
 * no KAT expectation may ever be cited in W1b's argument for the shipped number.
 *
 * The value is not changed and must not be: the KAT is hex-frozen against it, and re-picking it
 * here would be the fit-the-constant-to-the-outcome pattern the project rejects by name. It is
 * labelled instead — here, and in `data/kat/solver-kat.json`'s own `note`.
 *
 * `data/kat/solver-kat.json` is NOT evidence about `L_coil`. Do not cite it as such.
 */
export const L_COIL = 1.2; // H — the KAT's test vector, not the profile's L_coil_uh
export const DT_S = 100e-6; // tick_us * 1e-6
export const V_ARC = 30; // V, V_arc_clamp_mv = 30000
export const TAU_S = 40e-3; // lamp_thermal_tau_us = 40000
export const GMIN_S = 1e-9; // gmin_ns = 1
export const K_THERMAL = DT_S / (TAU_S + DT_S); // §3.4's kThermal, computed at load

/** i_pullin = idivRound(6500 mV * 1e9, 150e6 uohm) = 43_333 uA (§4.4). */
export const I_PULLIN = 43_333e-6;

/** The tungsten power law of components.md §8.2, clamped to [R_cold, 2 * R_hot]. */
export function tungsten(i: number): number {
  if (i <= 0) return R_CLAMP_LO;
  const r = R_HOT * Math.pow(i / I_HOT, 0.36);
  if (r < R_CLAMP_LO) return R_CLAMP_LO;
  if (r > R_CLAMP_HI) return R_CLAMP_HI;
  return r;
}

/**
 * The shipped 33-breakpoint table (§3.4). Breakpoint 0 sits at 0 A; the other 32 are geometric
 * from 1 mA to 800 mA, which covers everything from a lamp-fed coil at 46 mA to the 696 mA cold
 * inrush of one lamp straight across the rail, and keeps the chord error near the operating
 * points small enough that the table's fixed point and the closed-form law's agree to ~0.04%.
 */
export function makePwl(): { xs: number[]; ys: number[] } {
  const xs: number[] = [0];
  const ys: number[] = [tungsten(0)];
  const lo = 1e-3;
  const hi = 0.8;
  const n = 32;
  for (let k = 0; k < n; k++) {
    const x = lo * Math.pow(hi / lo, k / (n - 1));
    xs.push(x);
    ys.push(tungsten(x));
  }
  return { xs, ys };
}
