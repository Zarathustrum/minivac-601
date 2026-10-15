/**
 * The solver-KAT schema and its runner (architecture §3.5 layer 3).
 *
 * A case is an element list plus carried state plus a config — never a pre-stamped matrix, so the
 * KAT covers the stamping, the prune, the row order, the arc pass, the companion equations and
 * the lamp law as well as the LU. Every double is hex; the runner re-encodes what it computed and
 * the comparison is string equality, so no decimal formatter sits between two ports.
 *
 * Shared by `tools/gen-solver-kat.ts` (which fills `expect` from a reference run) and by
 * `test/solve.spec.ts` (which compares against it).
 */
import { pwlLookup, tickSolve } from '../src/core/solve.ts';
import type { Carried, El, Pwl, SolveCfg } from '../src/core/solve.ts';
import { quantize } from '../src/core/ints.ts';
import { doubleArray, doubleOfHex, hexArray, hexOfDouble } from './kat-hex.ts';

export interface KatCfg {
  dtS: string;
  vArc: string;
  kThermal: string;
  gminS: string;
  datum: number;
}

export type KatEl =
  | { k: 'coil'; a: number; b: number; rOhm: string; lH: string }
  | { k: 'lamp'; a: number; b: number }
  | { k: 'res'; a: number; b: number; rOhm: string }
  | { k: 'source'; a: number; b: number; vOc: string; rSrcOhm: string };

export interface SolveExpect {
  v: string[];
  floating: number[];
  branchI: string[];
  /** The second solve of §3.2 step 5 ran. */
  arcPass: boolean;
  /** A coil pruned at both ends took the hand-ramp. A different mechanism from `arcPass`. */
  openRamp: boolean;
  nonPortable: boolean;
  iCoil: string[];
  rLamp: string[];
}

export interface KatSolveCase {
  name: string;
  kind: 'solve';
  ticks: number;
  cfg: KatCfg;
  els: KatEl[];
  carried: { iCoil: string[]; rLamp: string[] };
  expect: SolveExpect;
}

export interface KatPwlCase {
  name: string;
  kind: 'pwl';
  x: string;
  expect: { y: string };
}

export interface KatQuantizeCase {
  name: string;
  kind: 'quantize';
  x: string;
  scale: string;
  expect: { q: number; nonPortable: boolean };
}

export type KatCase = KatSolveCase | KatPwlCase | KatQuantizeCase;

export interface KatFile {
  schema: string;
  note: string;
  pwl: { xs: string[]; ys: string[] };
  cases: KatCase[];
}

export function katPwl(kat: KatFile): Pwl {
  return { xs: Array.from(doubleArray(kat.pwl.xs)), ys: Array.from(doubleArray(kat.pwl.ys)) };
}

function decodeEls(els: readonly KatEl[]): El[] {
  const out: El[] = [];
  for (const e of els) {
    if (e.k === 'coil') out.push({ k: 'coil', a: e.a, b: e.b, rOhm: doubleOfHex(e.rOhm), lH: doubleOfHex(e.lH) });
    else if (e.k === 'lamp') out.push({ k: 'lamp', a: e.a, b: e.b });
    else if (e.k === 'res') out.push({ k: 'res', a: e.a, b: e.b, rOhm: doubleOfHex(e.rOhm) });
    else out.push({ k: 'source', a: e.a, b: e.b, vOc: doubleOfHex(e.vOc), rSrcOhm: doubleOfHex(e.rSrcOhm) });
  }
  return out;
}

/** Run one solve case for `ticks` ticks and return the FINAL tick's outputs, hex-encoded. */
export function runSolveCase(kat: KatFile, c: Omit<KatSolveCase, 'expect'>): SolveExpect {
  const els = decodeEls(c.els);
  const cfg: SolveCfg = {
    dtS: doubleOfHex(c.cfg.dtS),
    vArc: doubleOfHex(c.cfg.vArc),
    kThermal: doubleOfHex(c.cfg.kThermal),
    gminS: doubleOfHex(c.cfg.gminS),
    pwl: katPwl(kat),
    datum: c.cfg.datum,
  };
  const carried: Carried = {
    iCoil: doubleArray(c.carried.iCoil),
    rLamp: doubleArray(c.carried.rLamp),
  };
  let r = tickSolve(els, carried, cfg);
  for (let t = 1; t < c.ticks; t++) r = tickSolve(els, carried, cfg);
  return {
    v: hexArray(r.v),
    floating: Array.from(r.floating),
    branchI: hexArray(r.branchI),
    arcPass: r.arcPass,
    openRamp: r.openRamp,
    nonPortable: r.nonPortable,
    iCoil: hexArray(carried.iCoil),
    rLamp: hexArray(carried.rLamp),
  };
}

export function runPwlCase(kat: KatFile, c: Omit<KatPwlCase, 'expect'>): { y: string } {
  return { y: hexOfDouble(pwlLookup(katPwl(kat), doubleOfHex(c.x))) };
}

export function runQuantizeCase(c: Omit<KatQuantizeCase, 'expect'>): { q: number; nonPortable: boolean } {
  const flags = { nonPortable: false };
  const q = quantize(doubleOfHex(c.x), doubleOfHex(c.scale), flags);
  return { q, nonPortable: flags.nonPortable };
}
