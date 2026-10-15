/**
 * Emits the tungsten lamp table into `data/profiles/*.json` — architecture §3.4's PWL.
 *
 *   node tools/gen-lamp-pwl.ts          (node 26; type stripping, no build step) -> 33 breakpoints
 *   node tools/gen-lamp-pwl.ts 9        -> the same table at 9 breakpoints
 *
 * **The shipped artifact is the table, not the law.** `Math.pow` is barred inside `src/core/**`
 * (determinism rule 5) because it is not required to be correctly rounded and V8 and .NET disagree
 * in the last ulps, and lamp resistance feeds coil current, which decides contacts. So the law
 * lives here, in a one-off generator, and the table is what both languages load — which is also
 * exactly the thing a real measurement of an SDC 6435 lamp assembly would replace.
 *
 * The generating law, `components.md` §8.2:
 *
 *     R_lamp(I) = R_hot * (I / I_hot) ^ 0.36,  clamped to [R_cold, 2 * R_hot]
 *
 * `R_hot`, `I_hot` and `R_cold` are **read out of the profile being written** (`R_hot_uohm`,
 * `I_hot_ua`, `R_cold_uohm`), so this tool carries no physical constant of its own: retune the
 * profile and the table follows. What the tool does own is the *construction* — where the
 * breakpoints go — and that is pinned below.
 *
 * Architecture §10.1 allows N in {9, 33}, and W1b's job is to report whether the count changes any
 * acceptance-test result or relay decision. Both tables are printed on every run; the argument
 * selects which one is written into the profiles, so the comparison is a profile swap and a
 * re-run of `check-profile`, not a second code path.
 *
 * Both profiles are rewritten in place, canonically formatted, and the operation is idempotent:
 * re-running with the same argument reproduces the same bytes. UTF-8, no BOM, LF, one trailing
 * newline (determinism rule 17).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { roundHalfEven } from '../src/core/ints.ts';
import { makePwl } from '../test/mv601-ref.ts';

// Resolved against this script, never against the cwd: a relative path reads and overwrites
// whatever `data/profiles` tree the generator happened to be run from.
const PROFILES = [
  fileURLToPath(new URL('../data/profiles/MV601-REF-A.json', import.meta.url)),
  fileURLToPath(new URL('../data/profiles/MV601-IDEAL.json', import.meta.url)),
];

/**
 * The breakpoint construction, pinned so the profile and the solver KAT share one table.
 *
 * Breakpoint 0 sits at 0 A; the remaining N-1 are geometric from 1 mA to 800 mA. The span covers
 * everything the machine does — a lamp-fed coil at 46 mA, one lamp straight across the rail at
 * 81 mA, and the ~696 mA cold inrush of that same lamp — and geometric spacing puts the
 * breakpoints where the law is curved. This is `test/mv601-ref.ts`'s `makePwl()` generalised from
 * 33 to N; the assertion below proves the two agree at 33, element for element, so the solver KAT
 * and the shipped profile cannot drift apart.
 */
const LO_A = 1e-3;
const HI_A = 0.8;
const EXPONENT = 0.36;

function tungsten(iA: number, rHot: number, iHot: number, rCold: number): number {
  if (iA <= 0) return rCold;
  const r = rHot * Math.pow(iA / iHot, EXPONENT);
  if (r < rCold) return rCold;
  const hi = 2 * rHot; // the upper clamp of components.md §8.2
  if (r > hi) return hi;
  return r;
}

function breakpointsA(n: number): number[] {
  const xs: number[] = [0];
  const geometric = n - 1;
  for (let k = 0; k < geometric; k++) xs.push(LO_A * Math.pow(HI_A / LO_A, k / (geometric - 1)));
  return xs;
}

/**
 * Amps -> µA and ohms -> µΩ, rounded with `roundHalfEven` from `ints.ts`.
 *
 * The project has exactly one rounding rule (determinism rule 10), and a table generated under a
 * second one would be a second rule in the repo whether or not anything ever noticed. Half-even is
 * also what keeps the emitted integers independent of which language regenerates them.
 */
function toIntegerPairs(xs: readonly number[], ys: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < xs.length; i++) {
    out.push([roundHalfEven((xs[i] as number) * 1e6), roundHalfEven((ys[i] as number) * 1e6)]);
  }
  return out;
}

/**
 * JSON with 2-space indent, but every all-integer array collapsed onto one line. Idempotent.
 *
 * The collapse happens structurally, in a `JSON.stringify` replacer, not as a regex over the
 * serialized text: the provenance prose in these profiles quotes integer vectors (`dV_relay_mv`'s
 * `src` carries `[-282,-169,-56,56,169,282]`), and a text-level pass rewrites those too — a silent
 * mutation of a source citation, and a diff on every run even when the table has not changed.
 */
const ONE_LINE = '@@gen-lamp-pwl:one-line:';

function formatProfile(obj: unknown): string {
  const arrays: string[] = [];
  const s = JSON.stringify(
    obj,
    (_key: string, value: unknown) => {
      if (Array.isArray(value) && value.length > 0 && value.every((e) => typeof e === 'number' && Number.isInteger(e))) {
        arrays.push('[' + (value as number[]).join(', ') + ']');
        return ONE_LINE + (arrays.length - 1) + '@@';
      }
      return value;
    },
    2,
  );
  const marker = /"@@gen-lamp-pwl:one-line:(\d+)@@"/g;
  if ((s.match(marker) ?? []).length !== arrays.length) {
    throw new Error('gen-lamp-pwl: the profile text already contains the collapse marker ' + ONE_LINE);
  }
  const collapsed = s.replace(marker, (_m, index: string) => arrays[Number.parseInt(index, 10)] as string);
  return collapsed + '\n';
}

const arg = process.argv[2] ?? '33';
if (arg !== '9' && arg !== '33') throw new Error('gen-lamp-pwl: N must be 9 or 33 (architecture §10.1), got ' + arg);
const shipN = Number.parseInt(arg, 10);

type Doc = { values: Record<string, { v: unknown } | undefined> };
type Lamp = { rHot: number; iHot: number; rCold: number };

function readDoc(path: string): Doc {
  return JSON.parse(readFileSync(path, 'utf8')) as Doc;
}

/** The three lamp constants of the profile being written — this tool carries none of its own. */
function lampConstants(path: string, doc: Doc): Lamp {
  const read = (key: string): number => {
    const entry = doc.values[key];
    if (entry === undefined || typeof entry.v !== 'number') {
      throw new Error('gen-lamp-pwl: ' + path + ' has no numeric ' + key);
    }
    return entry.v / 1e6;
  };
  return { rHot: read('R_hot_uohm'), iHot: read('I_hot_ua'), rCold: read('R_cold_uohm') };
}

function table(n: number, c: Lamp): [number, number][] {
  const xs = breakpointsA(n);
  const ys = xs.map((x) => tungsten(x, c.rHot, c.iHot, c.rCold));
  return toIntegerPairs(xs, ys);
}

// The reference profile's own tables: what the makePwl() assertion below is about, and what the
// 9-vs-33 report at the end is measured on.
const refA = PROFILES[0] as string;
const refConstants = lampConstants(refA, readDoc(refA));
const t33 = table(33, refConstants);
const t9 = table(9, refConstants);

// The 33-breakpoint construction must reproduce test/mv601-ref.ts's makePwl() exactly, or the
// solver KAT (which froze that table) and the profile would be interpolating different curves.
const ref = makePwl();
if (ref.xs.length !== 33) throw new Error('gen-lamp-pwl: mv601-ref makePwl() is not 33 breakpoints');
const refPairs = toIntegerPairs(ref.xs, ref.ys);
for (let i = 0; i < 33; i++) {
  const a = refPairs[i] as [number, number];
  const b = t33[i] as [number, number];
  if (a[0] !== b[0] || a[1] !== b[1]) {
    throw new Error('gen-lamp-pwl: breakpoint ' + i + ' differs from test/mv601-ref.ts makePwl(): ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
  }
}

for (const path of PROFILES) {
  const doc = readDoc(path);
  const entry = doc.values['lamp_pwl_uohm'];
  if (entry === undefined) throw new Error('gen-lamp-pwl: ' + path + ' has no lamp_pwl_uohm entry to fill');
  // Each profile's table follows that profile's own constants: retune MV601-IDEAL's lamp and it
  // must not silently receive MV601-REF-A's curve (its PWL[0] is its own R_cold_uohm anchor).
  const ship = table(shipN, lampConstants(path, doc));
  entry.v = ship;
  writeFileSync(path, formatProfile(doc), 'utf8');
  process.stdout.write(path + ': lamp_pwl_uohm = ' + ship.length + ' breakpoints\n');
}

// Both tables are reported on every run so the 9-vs-33 question is answered with numbers.
process.stdout.write('\n9-breakpoint table (paste-ready), for the W1b comparison:\n');
process.stdout.write(JSON.stringify(t9) + '\n');
process.stdout.write('\nchord check at the operating points, 33 vs 9 (uohm):\n');
for (const iUa of [46200, 81000, 86300, 696000]) {
  process.stdout.write('  ' + iUa + ' uA: ' + interp(t33, iUa) + ' vs ' + interp(t9, iUa) + '\n');
}

/** Architecture §3.4's pinned interpolation, reproduced here only to report the 33-vs-9 delta. */
function interp(t: readonly [number, number][], x: number): number {
  const last = t.length - 1;
  if (x <= (t[0] as [number, number])[0]) return (t[0] as [number, number])[1];
  if (x >= (t[last] as [number, number])[0]) return (t[last] as [number, number])[1];
  let j = 0;
  for (let i = 0; i < t.length; i++) {
    if (x <= (t[i] as [number, number])[0]) {
      j = i;
      break;
    }
  }
  const a = t[j - 1] as [number, number];
  const b = t[j] as [number, number];
  const s = (x - a[0]) / (b[0] - a[0]);
  return a[1] + s * (b[1] - a[1]);
}
