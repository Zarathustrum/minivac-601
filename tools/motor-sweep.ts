/**
 * `tools/motor-sweep.ts` — motor sensitivity sweep (Phase 5 Step 3, `docs/plans/phase-5-corpus.md`).
 *
 *   node tools/motor-sweep.ts                 full sweep; writes docs/research/motor-sensitivity.md
 *                                             and test/conformance/corpus/motor-sweep.json
 *   node tools/motor-sweep.ts --axis <key>    one axis; prints the report to stdout, writes nothing
 *   node tools/motor-sweep.ts --check         full sweep; writes nothing; a regression gate against the
 *                                             committed motor-sweep.json. Exits 1 when a printed case's
 *                                             verdict is worse than the committed one, when a new printed
 *                                             case is not ROBUST, or (full run only) when the committed JSON
 *                                             is stale. Non-ROBUST printed cases are listed as information
 *                                             and never fail it on their own: FRAGILE is reported, not fixed.
 *                                             Combine with --axis to gate one axis (no staleness check).
 *   --jobs <n>                                with any of the above: split the cases of each axis across
 *                                             child processes, at most n at once (default 1, in-process).
 *                                             The merged result is the serial one, byte for byte.
 *
 * KILL RULE (Tom, DECISIONS 2026-08-30): no profile constant is ever tuned to make anything pass.
 * This tool REPORTS pass bands. It overrides one profile value at a time on an in-memory clone of
 * `data/profiles/MV601-REF-A.json` and never writes under `data/profiles/`.
 *
 * Cases per grid point: every `MOTOR_CLAIMS` entry (printed-quote checks, `tools/motor-claims.ts`) and
 * every fixture that wires D16-D19 or is tier C1/C2. Output is deterministic: no timestamps, LF,
 * trailing newline.
 */
import { fork } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadProfile } from '../src/core/profile.ts';
import type { Profile } from '../src/core/profile.ts';
import { loadFixture, readStrictJson } from '../test/conformance/helpers.ts';
import { runLoadedFixture } from '../test/conformance/run.ts';
import type { LoadedFixture } from '../test/conformance/types.ts';
import type { ClaimResult, MotorClaim } from './motor-claims.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SWEEP_MD_PATH = ROOT + 'docs/research/motor-sensitivity.md';
export const SWEEP_JSON_PATH = ROOT + 'test/conformance/corpus/motor-sweep.json';
const SHIPPED_PROFILE_PATH = ROOT + 'data/profiles/MV601-REF-A.json';
const MANIFEST_PATH = ROOT + 'test/conformance/fixtures/manifest.json';

const PITCH_UDEG = 360_000_000 / 16;

export type Group = 'claim' | 'printed' | 'speculative';
export type PointStatus = 'pass' | 'fail' | 'invalid';
/** NO-EXPECTS: a fixture with zero expects, which cannot fail; it is not a sensitivity result. */
export type Verdict = 'ROBUST' | 'FRAGILE' | 'FAILS-AT-SHIPPED' | 'NO-EXPECTS';

export interface SweepCase {
  readonly id: string;
  readonly group: Group;
  /** Fixtures only: how many expect/until steps the fixture has. 0 means it passes trivially. */
  readonly expects?: number;
  readonly check: (profile: Profile) => ClaimResult;
}

export interface Axis {
  readonly key: string;
  /** Natural unit for the md: divide the raw value by `scale` and print `unit`. */
  readonly unit: 'rpm' | 'deg';
  readonly scale: number;
  /** The nominal grid step, in raw units. */
  readonly step: number;
  /** Grid values in raw units, without the shipped value (the sweep inserts it). */
  readonly grid: readonly number[];
}

export interface Point {
  readonly v: number;
  readonly s: PointStatus;
  readonly d: string;
}

export interface Band {
  readonly lo: number;
  readonly hi: number;
}

export interface Judgement {
  readonly verdict: Verdict;
  readonly bands: readonly Band[];
  /** Empty for ROBUST. */
  readonly reasons: readonly string[];
}

export interface CaseSweep extends Judgement {
  readonly id: string;
  readonly group: Group;
  readonly expects?: number;
  readonly points: readonly Point[];
}

export interface AxisSweep {
  readonly key: string;
  readonly unit: 'rpm' | 'deg';
  readonly scale: number;
  readonly step: number;
  readonly shipped: number;
  readonly values: readonly number[];
  /** Grid points whose overridden profile failed `loadProfile`, with the loader's message. */
  readonly invalid: readonly { readonly v: number; readonly error: string }[];
  readonly cases: readonly CaseSweep[];
}

interface RawProfile {
  values: Record<string, { v: number }>;
}

function range(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
}

export const AXES: readonly Axis[] = [
  { key: 'run_mrpm', unit: 'rpm', scale: 1000, step: 2500, grid: range(25_000, 60_000, 2500) },
  {
    key: 'contact_arc_udeg',
    unit: 'deg',
    scale: 1_000_000,
    step: PITCH_UDEG / 16,
    grid: range(1, 15, 1).map((k) => k * (PITCH_UDEG / 16)),
  },
  {
    key: 'coast_udeg_stop_shorted',
    unit: 'deg',
    scale: 1_000_000,
    step: PITCH_UDEG / 8,
    grid: range(0, 16, 1).map((k) => k * (PITCH_UDEG / 8)),
  },
  {
    key: 'coast_udeg_drive_removed',
    unit: 'deg',
    scale: 1_000_000,
    step: PITCH_UDEG / 8,
    grid: range(0, 16, 1).map((k) => k * (PITCH_UDEG / 8)),
  },
];

export function readShippedRaw(): RawProfile {
  return readStrictJson(SHIPPED_PROFILE_PATH, 'MV601-REF-A profile') as RawProfile;
}

/** Load the shipped profile with exactly one value replaced. Throws if `loadProfile` rejects it. */
export function profileWith(raw: RawProfile, key: string, value: number): Profile {
  const clone = structuredClone(raw);
  const entry = clone.values[key];
  if (entry === undefined) throw new Error('profile has no key ' + key);
  entry.v = value;
  return loadProfile(clone);
}

/**
 * Verdict logic. `points` must be ascending by value and include the shipped value.
 *
 * - Bands are maximal runs of consecutive passing grid points; an invalid or failing point ends a run.
 * - A band edge is a band end whose neighbour on that side is a FAILING point. The axis end and an
 *   invalid neighbour are not edges: nothing was observed to break there.
 * - "Within one grid step" is measured in value, from the shipped value to the band's end point
 *   (the last passing value), and is not strictly more than `step`.
 * - Coverage is the shipped band's point count against the count of valid (non-invalid) points,
 *   counting nominal grid points (`onGrid`) only, so an inserted off-grid shipped value does not count.
 */
export function judge(points: readonly Point[], shipped: number, step: number, onGrid: ReadonlySet<number>): Judgement {
  const bands: Band[] = [];
  let start = -1;
  for (let i = 0; i <= points.length; i++) {
    const passing = i < points.length && (points[i] as Point).s === 'pass';
    if (passing && start < 0) start = i;
    if (!passing && start >= 0) {
      bands.push({ lo: (points[start] as Point).v, hi: (points[i - 1] as Point).v });
      start = -1;
    }
  }

  const at = points.findIndex((p) => p.v === shipped);
  const here = points[at];
  if (here === undefined) return { verdict: 'FAILS-AT-SHIPPED', bands, reasons: ['shipped value is not on the grid'] };
  if (here.s === 'invalid') return { verdict: 'FAILS-AT-SHIPPED', bands, reasons: ['shipped value is an invalid profile'] };
  if (here.s === 'fail') return { verdict: 'FAILS-AT-SHIPPED', bands, reasons: ['fails at shipped: ' + here.d] };

  let i0 = at;
  while (i0 > 0 && (points[i0 - 1] as Point).s === 'pass') i0--;
  let i1 = at;
  while (i1 < points.length - 1 && (points[i1 + 1] as Point).s === 'pass') i1++;

  const reasons: string[] = [];
  const lowEdge = i0 > 0 && (points[i0 - 1] as Point).s === 'fail';
  const highEdge = i1 < points.length - 1 && (points[i1 + 1] as Point).s === 'fail';
  if (lowEdge && shipped - (points[i0] as Point).v <= step) reasons.push('within one grid step of the lower band edge');
  if (highEdge && (points[i1] as Point).v - shipped <= step) reasons.push('within one grid step of the upper band edge');
  const valid = points.filter((p) => p.s !== 'invalid' && onGrid.has(p.v)).length;
  const inBand = points.slice(i0, i1 + 1).filter((p) => onGrid.has(p.v)).length;
  if (inBand * 2 < valid) reasons.push('band covers ' + inBand + ' of ' + valid + ' valid points (under half)');
  return { verdict: reasons.length === 0 ? 'ROBUST' : 'FRAGILE', bands, reasons };
}

function runCase(c: SweepCase, profile: Profile): ClaimResult {
  try {
    return c.check(profile);
  } catch (e) {
    return { pass: false, detail: 'threw: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

/** Sweep one axis over `cases`. A grid point whose profile fails to load is recorded, never skipped. */
export function sweepAxis(axis: Axis, cases: readonly SweepCase[], raw: RawProfile): AxisSweep {
  const entry = raw.values[axis.key];
  if (entry === undefined) throw new Error('profile has no key ' + axis.key);
  const shipped = entry.v;
  const values = [...new Set([...axis.grid, shipped])].sort((a, b) => a - b);

  const profiles: (Profile | null)[] = [];
  const invalid: { v: number; error: string }[] = [];
  for (const v of values) {
    try {
      profiles.push(profileWith(raw, axis.key, v));
    } catch (e) {
      profiles.push(null);
      invalid.push({ v, error: e instanceof Error ? e.message : String(e) });
    }
  }

  const swept: CaseSweep[] = cases.map((c) => {
    const points: Point[] = values.map((v, i) => {
      const profile = profiles[i] as Profile | null;
      if (profile === null) return { v, s: 'invalid', d: 'profile rejected by loadProfile' };
      const r = runCase(c, profile);
      return { v, s: r.pass ? 'pass' : 'fail', d: r.detail };
    });
    const judged = judge(points, shipped, axis.step, new Set(axis.grid));
    const j: Judgement = c.expects === 0 ? { verdict: 'NO-EXPECTS', bands: judged.bands, reasons: [] } : judged;
    const out: CaseSweep = { id: c.id, group: c.group, ...(c.expects === undefined ? {} : { expects: c.expects }), ...j, points };
    return out;
  });

  return { key: axis.key, unit: axis.unit, scale: axis.scale, step: axis.step, shipped, values, invalid, cases: swept };
}

/** One process's slice of an axis: the cases at `idx` (positions in the full case list), swept. */
export interface Shard {
  readonly key: string;
  readonly total: number;
  readonly idx: readonly number[];
  readonly sweep: AxisSweep;
}

/** Positions k, k+n, k+2n, ... of a `total`-long case list. */
export function shardIndices(total: number, k: number, n: number): number[] {
  const out: number[] = [];
  for (let i = k; i < total; i += n) out.push(i);
  return out;
}

/** Reassemble one axis from its shards, in case order. Throws on a gap, an overlap, or shards that disagree. */
export function mergeShards(shards: readonly Shard[]): AxisSweep {
  const first = shards[0];
  if (first === undefined) throw new Error('mergeShards: no shards');
  const { cases: _drop, ...meta } = first.sweep;
  const slots: (CaseSweep | null)[] = new Array<CaseSweep | null>(first.total).fill(null);
  for (const s of shards) {
    const { cases, ...m } = s.sweep;
    if (s.key !== first.key || s.total !== first.total || JSON.stringify(m) !== JSON.stringify(meta)) {
      throw new Error('mergeShards: shards disagree on ' + first.key);
    }
    s.idx.forEach((i, j) => {
      if (slots[i] !== null) throw new Error('mergeShards: ' + first.key + ' case ' + i + ' swept twice');
      slots[i] = cases[j] as CaseSweep;
    });
  }
  if (slots.some((c) => c === null)) throw new Error('mergeShards: ' + first.key + ' has missing cases');
  return { ...meta, cases: slots as CaseSweep[] };
}

/** Fixtures whose wires touch D16-D19, or that are tier C1/C2, in manifest order. */
export function fixtureCases(): SweepCase[] {
  const manifest = readStrictJson(MANIFEST_PATH, 'fixture manifest') as {
    fixtures: { path: string; suite: 'printed' | 'speculative' }[];
  };
  const cases: SweepCase[] = [];
  for (const entry of manifest.fixtures) {
    const loaded: LoadedFixture = loadFixture(ROOT + 'test/conformance/fixtures/' + entry.path);
    const f = loaded.fixture;
    const touches = f.wires.some((w) => /(^|[^0-9A-Za-z])D1[6-9]($|[^0-9A-Za-z])/.test(w));
    if (!touches && f.tier !== 'C1' && f.tier !== 'C2') continue;
    const expects = f.script.filter((s) => s.k === 'expect' || s.k === 'until').length;
    cases.push({
      id: 'FIXTURE/' + f.id,
      group: entry.suite,
      expects,
      check: (profile) => {
        const failures = runLoadedFixture({ ...loaded, profile }).failures;
        if (failures.length === 0) return { pass: true, detail: expects === 0 ? 'no expects, passes trivially' : 'all expects hold' };
        const first = failures[0] as (typeof failures)[number];
        return {
          pass: false,
          detail: failures.length + ' expectation failure(s); first script[' + first.scriptIndex + '] ' + first.dev +
            ' expected ' + first.expected + ' got ' + first.actual,
        };
      },
    });
  }
  return cases;
}

export function allCases(claims: readonly MotorClaim[]): SweepCase[] {
  return [...claims.map((c): SweepCase => ({ id: c.id, group: 'claim', check: c.check })), ...fixtureCases()];
}

/** Information lines for `--check`: printed cases (claims and printed fixtures) that are not ROBUST. */
export function gateFailures(axes: readonly AxisSweep[]): string[] {
  const out: string[] = [];
  for (const a of axes) {
    for (const c of a.cases) {
      if (c.group === 'speculative' || c.verdict === 'ROBUST' || c.verdict === 'NO-EXPECTS') continue;
      out.push(a.key + ' ' + c.id + ' ' + c.verdict + ': ' + c.reasons.join('; '));
    }
  }
  return out;
}

/** The parts of a committed `motor-sweep.json` the regression gate reads. */
export interface Baseline {
  readonly axes: readonly { readonly key: string; readonly cases: readonly { readonly id: string; readonly verdict: Verdict }[] }[];
}

const RANK: Readonly<Record<Exclude<Verdict, 'NO-EXPECTS'>, number>> = { ROBUST: 0, FRAGILE: 1, 'FAILS-AT-SHIPPED': 2 };

/**
 * The `--check` gate: printed cases whose verdict is worse than the committed baseline's
 * (ROBUST < FRAGILE < FAILS-AT-SHIPPED), or that are new and not ROBUST. Speculative and
 * NO-EXPECTS cases never fail it; an improved or unchanged verdict never fails it.
 */
export function regressions(axes: readonly AxisSweep[], baseline: Baseline): string[] {
  const was = new Map<string, Verdict>();
  for (const a of baseline.axes) for (const c of a.cases) was.set(a.key + ' ' + c.id, c.verdict);
  const out: string[] = [];
  for (const a of axes) {
    for (const c of a.cases) {
      if (c.group === 'speculative' || c.verdict === 'NO-EXPECTS') continue;
      const before = was.get(a.key + ' ' + c.id);
      const why = c.reasons.length === 0 ? '' : ': ' + c.reasons.join('; ');
      if (before === undefined || before === 'NO-EXPECTS') {
        if (c.verdict !== 'ROBUST') out.push(a.key + ' ' + c.id + ' new case, ' + c.verdict + why);
      } else if (RANK[c.verdict] > RANK[before]) {
        out.push(a.key + ' ' + c.id + ' ' + before + ' -> ' + c.verdict + why);
      }
    }
  }
  return out;
}

// ---- rendering -----------------------------------------------------------------------------

/** Exact decimal of `v / scale` for a power-of-ten `scale`, trailing zeros trimmed. */
export function fmtUnits(v: number, scale: number): string {
  const digits = String(scale).length - 1;
  const neg = v < 0;
  const abs = neg ? -v : v;
  const whole = Math.floor(abs / scale);
  let frac = String(abs % scale).padStart(digits, '0').replace(/0+$/, '');
  if (frac.length > 0) frac = '.' + frac;
  return (neg ? '-' : '') + String(whole) + frac;
}

function fmtBands(bands: readonly Band[], a: { scale: number; unit: string }): string {
  if (bands.length === 0) return 'none';
  return (
    bands.map((b) => (b.lo === b.hi ? fmtUnits(b.lo, a.scale) : fmtUnits(b.lo, a.scale) + '-' + fmtUnits(b.hi, a.scale))).join('; ') +
    ' ' + (a.unit === 'rpm' ? 'rpm' : 'deg')
  );
}

function table(a: AxisSweep, cases: readonly CaseSweep[]): string[] {
  const lines = ['| Case | Verdict | Pass bands |', '| --- | --- | --- |'];
  for (const c of cases) lines.push('| ' + c.id + ' | ' + c.verdict + ' | ' + fmtBands(c.bands, a) + ' |');
  return lines;
}

export function renderMarkdown(axes: readonly AxisSweep[], command: string): string {
  const L: string[] = [];
  L.push('# Motor sensitivity sweep');
  L.push('');
  L.push('Generated by `' + command + '`. Do not edit by hand; regenerate.');
  L.push('');
  L.push('**Kill rule (Tom, DECISIONS 2026-08-30):** no profile constant is ever tuned to make anything pass. This sweep reports bands. It overrides one value at a time on an in-memory clone of `MV601-REF-A` and never changes `data/profiles/*.json`.');
  L.push('');
  L.push('## Method');
  L.push('');
  L.push('- One axis at a time; every other value stays at the shipped profile. The shipped value is always a grid point.');
  L.push('- Cases per grid point: every entry of `MOTOR_CLAIMS` (`tools/motor-claims.ts`, each resting on a verbatim printed sentence), and every fixture that wires D16-D19 or is tier C1/C2. A fixture passes with zero expectation failures; digests are ignored.');
  L.push('- Printed and speculative fixtures are reported separately. A speculative digest-only C2 fixture has no expects, so it passes at every grid point trivially; its verdict is NO-EXPECTS and it says nothing about the profile.');
  L.push('- A band is a maximal run of consecutive passing grid points. An invalid point (the overridden profile fails `loadProfile`) ends a run and is listed per axis, never skipped.');
  L.push('- ROBUST: the shipped value passes, is more than one grid step from any band edge, and its band covers at least half the valid axis. FRAGILE: it passes but misses either condition. FAILS-AT-SHIPPED: the shipped value fails. NO-EXPECTS: a fixture with zero expects, which cannot fail; it is not a sensitivity result.');
  L.push('- Coverage counts nominal grid points only; the inserted shipped value, when it is off the grid, is not counted.');
  L.push('- A band edge is a band end next to a failing point. The axis end and an invalid neighbour are not edges. Distance is measured in value from the shipped value to the band end point.');
  L.push('');
  const groups: { title: string; group: Group }[] = [
    { title: 'Printed claims', group: 'claim' },
    { title: 'Printed fixtures', group: 'printed' },
    { title: 'Speculative fixtures', group: 'speculative' },
  ];
  for (const a of axes) {
    L.push('## ' + a.key);
    L.push('');
    const u = a.unit === 'rpm' ? 'rpm' : 'deg';
    L.push('Shipped ' + fmtUnits(a.shipped, a.scale) + ' ' + u + '. Grid ' + fmtUnits(a.values[0] as number, a.scale) + ' to ' +
      fmtUnits(a.values[a.values.length - 1] as number, a.scale) + ' ' + u + ', step ' + fmtUnits(a.step, a.scale) + ' ' + u + ', ' + a.values.length + ' points.');
    L.push('');
    L.push(a.invalid.length === 0
      ? 'Invalid grid points: none.'
      : 'Invalid grid points: ' + a.invalid.map((i) => fmtUnits(i.v, a.scale)).join(', ') + ' ' + u + '.');
    L.push('');
    for (const g of groups) {
      const cs = a.cases.filter((c) => c.group === g.group);
      if (cs.length === 0) continue;
      L.push('### ' + g.title);
      L.push('');
      L.push(...table(a, cs));
      L.push('');
    }
  }
  L.push('## Summary');
  L.push('');
  const flagged: string[] = [];
  for (const a of axes) {
    for (const c of a.cases) {
      if (c.verdict === 'ROBUST' || c.verdict === 'NO-EXPECTS') continue;
      flagged.push('- ' + a.key + ' / ' + c.id + ' [' + c.group + '] ' + c.verdict + ': ' + c.reasons.join('; '));
    }
  }
  if (flagged.length === 0) L.push('Every case is ROBUST on every swept axis.');
  else L.push('FRAGILE and FAILS-AT-SHIPPED cases:', '', ...flagged);
  L.push('');
  return L.join('\n');
}

/** JSON with one line per grid point, so the full grid stays diffable. */
function ser(v: unknown, indent: string): string {
  const next = indent + '  ';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return '[]';
    const leaf = v.every((x) => x === null || typeof x !== 'object' || (Array.isArray(x) && x.every((y) => y === null || typeof y !== 'object')));
    if (leaf && v.every((x) => x === null || typeof x !== 'object')) return JSON.stringify(v);
    if (leaf) return '[\n' + v.map((x) => next + JSON.stringify(x)).join(',\n') + '\n' + indent + ']';
    return '[\n' + v.map((x) => next + ser(x, next)).join(',\n') + '\n' + indent + ']';
  }
  const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined);
  return '{\n' + entries.map(([k, x]) => next + JSON.stringify(k) + ': ' + ser(x, next)).join(',\n') + '\n' + indent + '}';
}

export function renderJson(axes: readonly AxisSweep[]): string {
  const doc = {
    schema: 'minivac.motor-sweep/1',
    profile: 'MV601-REF-A',
    axes: axes.map((a) => ({
      key: a.key,
      unit: a.unit,
      scale: a.scale,
      step: a.step,
      shipped: a.shipped,
      values: a.values,
      invalid: a.invalid.map((i) => ({ v: i.v, error: i.error })),
      cases: a.cases.map((c) => ({
        id: c.id,
        group: c.group,
        expects: c.expects,
        verdict: c.verdict,
        reasons: c.reasons,
        bands: c.bands.map((b) => [b.lo, b.hi]),
        points: c.points.map((p) => [p.v, p.s, p.d]),
      })),
    })),
  };
  return ser(doc, '') + '\n';
}

// ---- CLI -----------------------------------------------------------------------------------

/** Child process for `--jobs`: sweep shard k of n of one axis and send it to the parent. */
async function shardMain(key: string, k: number, n: number): Promise<void> {
  const send = process.send?.bind(process);
  if (send === undefined) throw new Error('--shard runs only as a child of --jobs');
  const axis = AXES.find((a) => a.key === key);
  if (axis === undefined) throw new Error('unknown axis ' + key);
  const { MOTOR_CLAIMS } = await import('./motor-claims.ts');
  const cases = allCases(MOTOR_CLAIMS);
  const idx = shardIndices(cases.length, k, n);
  const raw = readShippedRaw();
  const before = JSON.stringify(raw);
  const sweep = sweepAxis(axis, idx.map((i) => cases[i] as SweepCase), raw);
  if (JSON.stringify(raw) !== before) throw new Error('the shipped profile object was mutated');
  const shard: Shard = { key, total: cases.length, idx, sweep };
  send(shard, () => process.disconnect?.());
}

function runShard(key: string, k: number, n: number): Promise<Shard> {
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--shard', key, String(k), String(n)]);
    let got: Shard | undefined;
    child.on('message', (m) => { got = m as Shard; });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 && got !== undefined) resolve(got);
      else reject(new Error('motor-sweep shard ' + key + ' ' + k + '/' + n + ' exited ' + String(code)));
    });
  });
}

/** `--jobs`: each axis split into ceil(jobs / axes) shards, at most `jobs` processes at once. */
async function sweepInChildren(axes: readonly Axis[], jobs: number): Promise<AxisSweep[]> {
  const per = Math.ceil(jobs / axes.length);
  const tasks = axes.flatMap((a) => Array.from({ length: per }, (_, k) => ({ key: a.key, k })));
  const done: Shard[] = [];
  let next = 0;
  const lane = async (): Promise<void> => {
    while (next < tasks.length) {
      const t = tasks[next++] as { key: string; k: number };
      done.push(await runShard(t.key, t.k, per));
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, lane));
  return axes.map((a) => mergeShards(done.filter((s) => s.key === a.key)));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const shardIdx = args.indexOf('--shard');
  if (shardIdx >= 0) {
    await shardMain(args[shardIdx + 1] as string, Number(args[shardIdx + 2]), Number(args[shardIdx + 3]));
    return;
  }
  const jobsIdx = args.indexOf('--jobs');
  const jobs = jobsIdx >= 0 ? Number(args[jobsIdx + 1]) : 1;
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error('--jobs needs a positive integer');
  const check = args.includes('--check');
  const axisIdx = args.indexOf('--axis');
  const axisKey = axisIdx >= 0 ? args[axisIdx + 1] : undefined;
  if (axisIdx >= 0 && axisKey === undefined) throw new Error('--axis needs a key');
  const axes = axisKey === undefined ? AXES : AXES.filter((a) => a.key === axisKey);
  if (axes.length === 0) throw new Error('unknown axis ' + String(axisKey) + '; known: ' + AXES.map((a) => a.key).join(', '));

  const started = Date.now();
  const { MOTOR_CLAIMS } = await import('./motor-claims.ts');
  const cases = allCases(MOTOR_CLAIMS);
  const raw = readShippedRaw();
  const before = JSON.stringify(raw);
  const swept = jobs === 1 ? axes.map((a) => sweepAxis(a, cases, raw)) : await sweepInChildren(axes, jobs);
  if (JSON.stringify(raw) !== before) throw new Error('the shipped profile object was mutated');
  const wall = ((Date.now() - started) / 1000).toFixed(1);

  const command = 'node tools/motor-sweep.ts' + (axisKey === undefined ? '' : ' --axis ' + axisKey);
  if (check) {
    let committed: string;
    try {
      committed = readFileSync(SWEEP_JSON_PATH, 'utf8');
    } catch {
      throw new Error('motor-sweep --check: no committed baseline at ' + SWEEP_JSON_PATH + '; run node tools/motor-sweep.ts');
    }
    const bad = regressions(swept, JSON.parse(committed) as Baseline);
    process.stdout.write('motor-sweep --check: ' + cases.length + ' cases, ' + swept.length + ' axes, ' + wall + ' s\n');
    for (const line of gateFailures(swept)) process.stdout.write('info: ' + line + '\n');
    for (const line of bad) process.stdout.write('REGRESSION: ' + line + '\n');
    if (bad.length > 0) process.exitCode = 1;
    if (axisKey === undefined && renderJson(swept) !== committed) {
      process.stdout.write('motor-sweep.json is stale; regenerate with node tools/motor-sweep.ts and review the diff\n');
      process.exitCode = 1;
    }
    return;
  }
  if (axisKey !== undefined) {
    process.stdout.write(renderMarkdown(swept, command));
    return;
  }
  writeFileSync(SWEEP_MD_PATH, renderMarkdown(swept, command));
  writeFileSync(SWEEP_JSON_PATH, renderJson(swept));
  const nonRobust = swept.reduce((n, a) => n + a.cases.filter((c) => c.verdict === 'FRAGILE' || c.verdict === 'FAILS-AT-SHIPPED').length, 0);
  process.stdout.write('motor-sweep: ' + cases.length + ' cases, ' + swept.length + ' axes, ' + nonRobust + ' non-ROBUST case-axes, ' + wall + ' s\n');
}

const argv1 = process.argv[1];
if (argv1 !== undefined && argv1.endsWith('motor-sweep.ts')) {
  main().catch((e: unknown) => {
    process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n');
    process.exitCode = 1;
  });
}
