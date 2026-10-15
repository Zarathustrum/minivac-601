/**
 * Emits `data/kat/solver-kat.json` — architecture §3.5's solver KAT, 21 cases.
 *
 *   node tools/gen-solver-kat.ts        (node 26; unflagged type stripping, no build step)
 *
 * WHY 21 AND NOT 20. §3.5 says "20 cases" twice and then enumerates 21 — eighteen named cases plus
 * "three whole-panel snapshots". The two statements cannot both hold. Ruling: **21**. The count is
 * decorative and the coverage is the point, and the third snapshot pays for itself (see
 * `whole-panel-open-feed` below). §3.5's "20" is the slip.
 *
 * What this file is and is not. The KAT *freezes the reference implementation* so that a C# port
 * can prove bit equality before it touches a fixture; it does not establish that the reference is
 * right. Correctness is `test/solve.spec.ts`'s job, which checks the same solver against the
 * closed-form arithmetic of components.md §8.2 and architecture §3.3, §4.1 and §4.2. So filling
 * `expect` from a reference run is legitimate here and would not be there.
 *
 * Regenerating changes expectations. Do it only when the solver's contract deliberately changes,
 * and say so in the commit.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hexArray, hexOfDouble as hx } from '../test/kat-hex.ts';
import { runPwlCase, runQuantizeCase, runSolveCase } from '../test/kat-run.ts';
import type { KatCase, KatCfg, KatEl, KatFile, KatPwlCase, KatQuantizeCase, KatSolveCase } from '../test/kat-run.ts';
import { DT_S, GMIN_S, K_THERMAL, L_COIL, R_COIL, R_COLD, R_SRC, V_ARC, V_OC, makePwl } from '../test/mv601-ref.ts';

// R1, R2 and the motor armature are profile keys that no manual states (architecture §5). The
// values below exist only so the whole-panel cases have arithmetic to freeze; W1b pins the real
// ones in `data/profiles/MV601-REF-A.json`.
const R1 = 22;
const R2 = 33;
const R_ARM = 22;

const coil = (a: number, b: number): KatEl => ({ k: 'coil', a, b, rOhm: hx(R_COIL), lH: hx(L_COIL) });
const lamp = (a: number, b: number): KatEl => ({ k: 'lamp', a, b });
const res = (a: number, b: number, r: number): KatEl => ({ k: 'res', a, b, rOhm: hx(r) });
const source = (a: number, b: number): KatEl => ({ k: 'source', a, b, vOc: hx(V_OC), rSrcOhm: hx(R_SRC) });

const cfg = (datum = 0, gmin = GMIN_S): KatCfg => ({
  dtS: hx(DT_S),
  vArc: hx(V_ARC),
  kThermal: hx(K_THERMAL),
  gminS: hx(gmin),
  datum,
});

type SolveIn = Omit<KatSolveCase, 'expect'>;
type PwlIn = Omit<KatPwlCase, 'expect'>;
type QuantIn = Omit<KatQuantizeCase, 'expect'>;
type CaseIn = SolveIn | PwlIn | QuantIn;

const solve = (name: string, ticks: number, els: KatEl[], iCoil: number[], rLamp: number[], c: KatCfg = cfg()): SolveIn => ({
  name,
  kind: 'solve',
  ticks,
  cfg: c,
  els,
  carried: { iCoil: iCoil.map(hx), rLamp: rLamp.map(hx) },
});

const pwl = makePwl();

// The whole-panel circuit: six output lamps straight across the rail, six indicator lamps each
// feeding their own coil, R1 and R2 across the motor divider, supply last (determinism rule 2).
// node 0 = MINUS (datum), node 1 = PLUS, nodes 2..7 = the six lamp/coil junctions, node 8 = the
// R1/R2 junction. 21 elements, 8 unknowns.
//
// `openFeed` moves relay 6's coil off its junction to an otherwise untouched node 9: the contact
// feeding the most heavily energised coil (86.3 mA) has opened. Node 9 still reaches the datum
// through the coil itself, so the coil stays in the matrix and the arc pass of §3.2 step 5 fires
// against the loaded rail; node 7 is left carrying its indicator lamp alone. 10 nodes, 9 unknowns.
function wholePanel(openFeed = false): KatEl[] {
  const els: KatEl[] = [];
  for (let i = 0; i < 6; i++) els.push(lamp(1, 0)); // output lamps
  for (let i = 0; i < 6; i++) els.push(lamp(1, 2 + i)); // indicator lamps
  for (let i = 0; i < 6; i++) els.push(coil(openFeed && i === 5 ? 9 : 2 + i, 0)); // relay coils
  els.push(res(1, 8, R1));
  els.push(res(8, 0, R2));
  els.push(source(1, 0));
  return els;
}
const panelCoils = [0, 10e-3, 20e-3, 40e-3, 60e-3, 86.3e-3];
const panelLamps = [R_COLD, R_COLD, R_COLD, R_COLD, R_COLD, R_COLD, R_COLD, R_COLD, R_COLD, R_COLD, R_COLD, R_COLD];

// The 21 cases of architecture §3.5, read as enumerated rather than as counted (see the header).
// Four of them are multi-tick over 500 ticks: lamp-warm-relaxation, rl-rise-500, freewheel-500 and
// whole-panel-500.
const cases: CaseIn[] = [
  // 1. Divider: the E-fed coil across the rail, mid-rise so the companion's Ieq term is live.
  solve('divider', 1, [coil(1, 0), source(1, 0)], [40e-3], []),

  // 2. Series-through-float (O-T6): node 2 carries nothing but the two coils and must NOT be
  //    pruned - it stays in the source component through them and solves as a divider.
  solve('series-through-float', 1, [coil(1, 2), coil(2, 0), source(1, 0)], [40e-3, 40e-3], []),

  // 3. Collapsed coil: both ends on one node. It cancels out of G and out of i, and its current
  //    comes from the companion alone (determinism rule 16) - the freewheeling release.
  solve('collapsed-coil', 1, [coil(1, 1), source(1, 0)], [86.3e-3], []),

  // 4. Collapsed armature: the shorted motor resistor, v = 0 and therefore i = 0.
  solve('collapsed-armature', 1, [res(1, 1, R_ARM), res(1, 0, R2), source(1, 0)], [], []),

  // 5. Zero-unknown system (AT-06): a dead PLUS/MINUS cord merges the supply into the datum.
  //    N = 0, the LU is a no-op, and the supply companion still yields V_oc / R_src = 19.4 A.
  solve('zero-unknown', 1, [source(0, 0)], [], []),

  // 6. Datum not the lowest node id, with gaps in the id space: the datum is skipped BEFORE
  //    renumbering, so rows are node 0 -> 0 and node 3 -> 1 (§3.1.3).
  solve('datum-not-lowest-index', 1, [coil(0, 3), coil(3, 7), source(0, 7)], [40e-3, 40e-3], [], cfg(7)),

  // 7. The two open-coil paths, side by side and deliberately unloaded. There is no live rail
  //    anywhere in this circuit: node 1 is the supply's positive terminal and NOTHING else touches
  //    it, so nothing is being fed and nothing has "lost a feed" in the circuit sense. What the
  //    case isolates is the structural split. Coil A spans node 5 to node 0, and node 0 is the
  //    datum and the supply's own node, so the prune walk reaches node 5 THROUGH the coil: coil A
  //    stays in the matrix, exceeds the clamp, and pass 2 stamps its arc conductance (§3.2 step 5).
  //    Coil B spans nodes 8 and 9 and neither end reaches the supply, so the prune drops it at both
  //    ends and it takes solve.ts's hand-ramp for a doubly-isolated coil — the project ruling that
  //    fills §3.1.4's hole, NOT §4.2's open-release row, which is the single-open case coil A is.
  //    `arc-clamp-series-junction` covers the clamp against a load of one coil;
  //    `whole-panel-open-feed` covers it against the whole panel.
  solve('arc-clamp-single', 1, [coil(5, 0), coil(8, 9), source(1, 0)], [86.3e-3, 86.3e-3], []),

  // 8. Arc clamp at a series junction (§3.3): a live coil and a dead one meeting at a node with
  //    nothing else. Unclamped, backward Euler drags both to the mean of 86.3 mA and 0 - above
  //    three relays' 43.333 mA pull-in - and §4.3's direction latch makes that permanent.
  solve('arc-clamp-series-junction', 1, [coil(1, 2), coil(2, 0), source(1, 0)], [86.3e-3, 0], []),

  // 9. Lamp cold start: the 7x inrush that FALLBACK-PWRUP-COLD exists to exercise.
  solve('lamp-cold-start', 1, [lamp(1, 2), coil(2, 0), source(1, 0)], [0], [R_COLD]),

  // 10. Lamp warm relaxation. tau_thermal is 40 ms = 400 ticks (§3.4), so 500 ticks is 1.25 tau,
  //     NOT settling: the loop is still ~13% short of its self-consistent point. That is fine for
  //     what this case is for — the carried filament double has had 500 chances to diverge between
  //     two ports, which is what the KAT freezes. Settling is proved in test/solve.spec.ts, which
  //     runs 20000 ticks against a scalar reference.
  solve('lamp-warm-relaxation', 500, [lamp(1, 2), coil(2, 0), source(1, 0)], [0], [R_COLD]),

  // 11-13. The three PWL clamp/interpolation boundaries of §3.4.
  { name: 'pwl-below-first-breakpoint', kind: 'pwl', x: hx(-1.0) },
  { name: 'pwl-above-last-breakpoint', kind: 'pwl', x: hx(5.0) },
  { name: 'pwl-on-a-breakpoint', kind: 'pwl', x: hx(pwl.xs[10] as number) },

  // 14. Saturating quantize (§3.5): 2.5e6 A scaled to uA overflows int32 and must saturate with
  //     nonPortable set, never wrap. This is the case a bare cast fails three different ways.
  { name: 'saturating-quantize', kind: 'quantize', x: hx(2.5e6), scale: hx(1e3) },

  // 15. Pivot tie: with gmin off, row 0's diagonal and row 1's column-0 entry are both exactly
  //     the resistor's conductance. The tie must go to the LOWEST row index (determinism rule 4).
  solve('pivot-tie', 1, [res(1, 2, 100), coil(2, 0), source(2, 0)], [40e-3], [], cfg(0, 0)),

  // 16. 500-tick R-L rise. The loop time constant is L/(R_src + R_coil) = 7.96 ms = 79.6 ticks, so
  //     500 ticks is 6.28 tau and the carried i_coil has integrated to 0.998 of its 86.281 mA
  //     asymptote — 86.113 mA. Deep in the tail, which is where 500 ticks of accumulated rounding
  //     is worth freezing.
  solve('rl-rise-500', 500, [coil(1, 0), source(1, 0)], [0], []),

  // 17. 500-tick freewheel: the shorted-coil release, (L/dt)/(R + L/dt) per tick.
  solve('freewheel-500', 500, [coil(1, 1), source(1, 0)], [86.3e-3], []),

  // 18. Six coils in parallel across the rail, each at a different point on its rise, so the six
  //     companion current sources are all distinct and all stamped into one row. It draws 0.220 A
  //     at this tick — about a quarter of AT-05's 0.844 A budget, which is six coils PLUS thirteen
  //     lamps. This case is not AT-05 and must not be cited as it: AT-05 lives in
  //     `tools/check-profile.ts` in W1b. What it covers here is six same-node stamps accumulating
  //     in element order (determinism rule 3).
  solve(
    'six-coil-load',
    1,
    [coil(1, 0), coil(1, 0), coil(1, 0), coil(1, 0), coil(1, 0), coil(1, 0), source(1, 0)],
    panelCoils,
    [],
  ),

  // 19-21. The three whole-panel snapshots §3.5 enumerates. 21 elements each.
  //
  //   cold       8 unknowns, every filament at R_cold, the 7x inrush on all twelve lamps at once.
  //   500        the same panel 50 ms later: filaments warm, coils risen, four carried doubles per
  //              lamp-coil pair having compounded for 500 ticks.
  //   open-feed  relay 6's feed contact has opened while it carries 86.3 mA. 9 unknowns, and the
  //              ONLY case in the KAT where the second solve of §3.2 step 5 runs against a real
  //              load rather than against a bare coil: the arc conductance is stamped into a matrix
  //              that also carries twelve lamps, five other coils and the motor divider, and the
  //              coil ramps 3.436 mA on the tick. `arc-clamp-single` and
  //              `arc-clamp-series-junction` both fire the arc pass on two- and three-element
  //              circuits, so neither exercises it at panel scale, and the arc stamp lands on a row
  //              whose other entries are what makes the pass-2 LU non-trivial. That is why this is
  //              the third snapshot rather than a mid-warm rerun of the first two, which would
  //              cover no path the 500-tick case does not.
  solve('whole-panel-cold', 1, wholePanel(), panelCoils, panelLamps),
  solve('whole-panel-500', 500, wholePanel(), panelCoils, panelLamps),
  solve('whole-panel-open-feed', 1, wholePanel(true), panelCoils, panelLamps),
];

const kat: KatFile = {
  schema: 'minivac.solver-kat/1',
  note:
    'Architecture 3.5 layer 3. Every double is the 16 hex digits of its IEEE-754 bits, big-endian. ' +
    'Inputs and expectations both. Generated by tools/gen-solver-kat.ts; correctness is proved by ' +
    'test/solve.spec.ts, this file only freezes the reference for port equality. ' +
    'The coil inductance frozen into these cases (1.2 H) is an ARBITRARY TEST VECTOR, not the ' +
    'profile value: architecture 4.4 leaves L_coil deliberately unpinned and tools/check-profile.ts ' +
    'solves for it. Nothing in this file is evidence about L_coil and it must never be cited as such.',
  pwl: { xs: hexArray(pwl.xs), ys: hexArray(pwl.ys) },
  cases: [],
};

const filled: KatCase[] = [];
for (const c of cases) {
  if (c.kind === 'solve') filled.push({ ...c, expect: runSolveCase(kat, c) });
  else if (c.kind === 'pwl') filled.push({ ...c, expect: runPwlCase(kat, c) });
  else filled.push({ ...c, expect: runQuantizeCase(c) });
}
kat.cases = filled;

// 21, not 20. Architecture 3.5 states "20 cases" twice and then enumerates 21 - eighteen named
// cases plus "three whole-panel snapshots". Ruling: the enumeration wins, the count is the slip,
// and the third snapshot earns its place (see whole-panel-open-feed above).
if (filled.length !== 21) throw new Error('the solver KAT is 21 cases (architecture 3.5), got ' + filled.length);
const multi = filled.filter((c) => c.kind === 'solve' && c.ticks === 500).length;
if (multi !== 4) throw new Error('four of the 21 cases are multi-tick at 500 ticks, got ' + multi);

// Resolved against this script, never against the cwd: a relative path silently wrote the KAT into
// whatever directory the generator happened to be run from.
const OUT = fileURLToPath(new URL('../data/kat/solver-kat.json', import.meta.url));
// UTF-8, no BOM, LF, trailing newline (determinism rule 17).
writeFileSync(OUT, JSON.stringify(kat, null, 2) + '\n', 'utf8');
process.stdout.write(OUT + ': ' + filled.length + ' cases, ' + multi + ' multi-tick\n');
