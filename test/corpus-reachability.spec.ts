/**
 * `tools/corpus-reachability.ts` under vitest — the permanent regression behind the O-E11 ruling.
 *
 * **What this file used to say, and why it was wrong.** It said the state the arc-pass defect needs
 * is *unreachable*: that over every settled state of every published program, no configuration puts
 * two coils in series through a bare node at mismatched currents. That claim is FALSE, and it was
 * false for two reasons that are now fixed in the tool — the predicate was evaluated on the LANDED
 * netlist while the arc pass runs on the TRANSFER one, and `build()` took a scalar pushbutton, so
 * the corpus's own simultaneous two-button presses (`I-EXP4`, `I-EXP5`, both tier A `[verified]`)
 * were never swept. The corrected census reaches the state in five programs, including **II-FF1**,
 * the corpus's primary timing fixture.
 *
 * **What is true, and what this file now pins.** Reaching the state changes no relay decision. Over
 * 214,992 reachable configurations, after §4.3's both-open window and after the armature lands and
 * the circuit settles, **no coil's §4.3 direction decision differs from the landed netlist's own DC
 * solution.** 96 configurations do carry a permanent coil-current error, worst 3.04101 mA — 7.0% of
 * the 43.333 mA pull-in — and the smallest margin any decision survived by is 1.03215 mA. That is a
 * measured bound with a stated margin. It is not "harmless", and nothing here says it is: `L_coil`
 * W1b completed with `L_coil`=1.2 H and checked-in REF-A contains the current Wave D vector; this
 * file is what will go red if either profile input closes the margin.
 *
 * **What this spec covers, and what only the tool covers.** The spec runs the FULL sweep — all 90
 * usable programs, both pushbutton axes, ~9 s — so there is no bounded subset and no gap between
 * what the gate measures and what the suite pins. `only: [...]` is used where a subset is the point
 * rather than a compromise (determinism, the settling-budget sensitivity, the corpus mutations),
 * and its size is asserted each time so it cannot drift. The only things left to the tool alone are
 * its stdout plumbing and its process exit code; the invariant those report is asserted here
 * directly through `violations()`.
 *
 * **What is asserted, and what deliberately is not.** Everything below is a *measurement* or a
 * *census*. Nothing here asserts that the solver is right — the defect it documents is real and the
 * `it.fails` named "DEFECT (O-E11)" in `test/solve.spec.ts` is where that lives. If the corpus
 * grows a program whose reachable states move a relay decision, this file is supposed to go red:
 * that is a finding, not a broken test, and the fix is to repair the solver rather than to relax
 * the number.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  BOTH_OPEN_TICKS,
  COIL_ERR_BOUND_A,
  D_DV_RELAY_MV,
  D_THRESHOLD_SET,
  EXPECTED_PARSE,
  I_DROPOUT,
  L_CENSUS_H,
  L_COIL_ENV,
  NAMED_QUIET,
  SERIES_BOUND_A,
  SETTLE_TICKS,
  SHIPPED_PROFILE_JSON,
  WIPER,
  Z_THRESHOLD_SET,
  bareTwoCoilNodes,
  build,
  census,
  commonThresholdSet,
  dEndpointCensus,
  dcCoilCurrents,
  formatCensus,
  formatThresholdIntegrity,
  parsePrograms,
  perturbedCoilHeadroom,
  readLCoilOverride,
  relayDir,
  requireShippedDProfile,
  shippedProfile,
  shippedProfileUsesD,
  thresholdIntegrityRows,
  verifyJackMap,
  verifyRefConstants,
  violations,
  wireDigest,
} from '../tools/corpus-reachability.ts';
import type { AxisTally, Census, Program, ProgramTally } from '../tools/corpus-reachability.ts';
import { loadProfile } from '../src/core/profile.ts';
import type { Profile } from '../src/core/profile.ts';
import { tickSolve } from '../src/core/solve.ts';
import type { Carried, El, SolveCfg } from '../src/core/solve.ts';
import { DT_S, GMIN_S, I_PULLIN, K_THERMAL, L_COIL, R_COIL, R_SRC, V_ARC, V_OC, makePwl } from './mv601-ref.ts';

const PROGRAMS_MD = new URL('../docs/research/programs.md', import.meta.url);
const JACK_MAP_MD = new URL('../docs/research/jack-map.md', import.meta.url);

const JACK_MAP = verifyJackMap();
const PROGRAMS = parsePrograms();
const CENSUS = census(PROGRAMS);
const LOADED_SHIPPED = shippedProfile();
const D_ENDPOINT = dEndpointCensus(PROGRAMS, LOADED_SHIPPED);
const D_CENSUS = D_ENDPOINT.census;

const tally = (a: AxisTally, name: string): ProgramTally => {
  const t = a.perProgram.find((x) => x.name === name);
  if (t === undefined) throw new Error(`${name} is not in the sweep`);
  return t;
};
/** Per-program `[name, hits, latched, flips]`, sorted, so a whole axis reads as one assertion. */
const hitProfile = (a: AxisTally): (readonly [string, number, number, number])[] =>
  a.perProgram.filter((t) => t.hits > 0).map((t) => [t.name, t.hits, t.latched, t.flips] as const)
    .sort((x, y) => (x[0] < y[0] ? -1 : 1));

describe('the parse census (docs/research/programs.md, read at run time)', () => {
  // Pinned exactly. The wave that produced these numbers found FOUR parser defects in its first
  // attempt — silent over-collection from prose, errata tables concatenated with printed ones,
  // partial parses run as complete, and VI-TICTACTOE invisible to the record regex — and a fifth
  // was found by review: the section alphabet was `[A-Z]`, six letters wider than jack-map.md §1.
  // A sixth (D6) followed: VI-SECRETCODE and VI-MAZE print the connections ADDED to VI-SEQREC, not
  // circuits, and were being censused as standalone 36- and 3-wire panels that exist nowhere.
  // Every one of them moved this count. A silent drift back is the failure mode this test exists
  // for.
  it('finds 102 records, 88 usable, 14 skipped, 2,157 wires', () => {
    expect(CENSUS.recordsFound).toBe(102);
    expect(CENSUS.usable).toBe(88);
    expect(CENSUS.skipped.length).toBe(14);
    // 2026-10-14: II-EXP1 gained the printed 5F/5- (Phase 5 wave 3, image-read). Old value 2156.
    expect(CENSUS.totalWires).toBe(2157);
    expect(CENSUS.usable + CENSUS.skipped.length).toBe(CENSUS.recordsFound);
  });

  it('every skip is named, and the reasons are the twelve on the record', () => {
    // A skip with no reason is a lie the tool exists to not tell, so the reasons are pinned too:
    // four families — a free-ended wire the W1 element array cannot express, a prose-only record
    // with no wire table, a section-less Maintenance Manual designator the grammar rejects, and
    // (D6) a record whose table is only the connections added to another record's circuit.
    expect(CENSUS.skipped.map((s) => s.name)).toEqual([
      'VI-TICTACTOE',
      'I-PROBLEMS', 'IV-EXP2', 'IV-EXP3', 'IV-EXP7', 'IV-EXP9',
      'V-MAZESOLVER',
      'VI-SECRETCODE', 'VI-COMBOLOCK', 'VI-MAZE', 'VI-RANDOM',
      'MM-PB-CHECK', 'MM-RLY-CHECK', 'MM-SW-CHECK',
    ]);
    for (const s of CENSUS.skipped) expect(s.reason, s.name).not.toBe('');
    expect(CENSUS.skipped.filter((s) => s.reason.startsWith('no wire table')).length).toBe(7);
    expect(CENSUS.skipped.filter((s) => s.reason.includes('outside the designator grammar')).length).toBe(5);
    // D6. VI-SECRETCODE's own metadata line reads "36 + 38 = 74" and its body says "These are the
    // 36 **additional** connections"; VI-MAZE states no count at all and was being censused as the
    // three-wire short-path variant table. Both name VI-SEQREC as their prerequisite, and neither
    // fragment is a circuit any panel was ever wired to.
    expect(CENSUS.skipped.filter((s) => s.reason.includes('ADDED to VI-SEQREC')).map((s) => s.name))
      .toEqual(['VI-SECRETCODE', 'VI-MAZE']);
    // The centrepiece is found and then skipped for a stated reason — the D4 fix. Before it, the
    // record was invisible to the parser and the skip count read as eleven honest ones.
    expect(CENSUS.skipped[0]?.reason).toContain('free');
  });

  it('all 88 usable records state their own wire count, and every one of them matches', () => {
    // The check is inside the parser: a record whose table disagrees with its own stated count is
    // SKIPPED, so "usable and stating a count" already implies "matching". This pins the split.
    expect(CENSUS.statedAndMatched).toBe(88);
    const usable = PROGRAMS.filter((p) => p.skip === '');
    for (const p of usable) if (p.stated !== null) expect(p.wires.length, p.name).toBe(p.stated);
  });

  it('the tool pins the same parse census it just measured, digest included', () => {
    // The finding this answers: `npm run check-reachability` used to exit 0 on a corpus with a
    // whole program deleted, because every downstream number is a count that simply gets smaller.
    // `violations()` now asserts the parse census itself, and `EXPECTED_PARSE` is where a
    // deliberate corpus edit gets re-blessed.
    // 2026-10-14: V-EXP19 4H/5U -> printed 4H/5L (Phase 5 waves 1-2). Old digest dd1dba95f7e448bb.
    // 2026-10-14: II-EXP1 +5F/5- (Phase 5 wave 3). Old digest ba6ff5eb813ed171.
    expect(CENSUS.digest).toBe('a4a15f3c39d0ed83');
    expect(EXPECTED_PARSE).toEqual({
      recordsFound: CENSUS.recordsFound,
      usable: CENSUS.usable,
      skipped: CENSUS.skipped.length,
      statedAndMatched: CENSUS.statedAndMatched,
      totalWires: CENSUS.totalWires,
      digest: CENSUS.digest,
    });
  });
});

describe('the designator grammar is jack-map.md §1 and nothing wider', () => {
  // The D5 fix. `[A-Z]` accepted `1D`, `2I`, `3M`, `4O`, `5P`, `6Q` — six letters §1 says do not
  // exist. Such a token named no panel terminal, so `find()` returned `undefined` and `uni()` wrote
  // `parent[other] = undefined`, which an `Int32Array` stores as 0: **the PLUS terminal**. A typo
  // in a research file silently shorted a wire to the rail.
  const record = (token: string): string =>
    `### ZZ-PROBE — one wire, made of ${token}\n\nnowhere · 1 wire · tier Z\n\n| |\n|---|\n| \`${token}\` |\n`;

  it('the six letters §1 excludes make a record unusable instead of a wire', () => {
    for (const letter of 'DIMOPQ') {
      const p = parsePrograms(record(`1${letter}/1A`)).find((x) => x.name === 'ZZ-PROBE');
      expect(p, letter).toBeDefined();
      expect(p?.wires.length, letter).toBe(0);
      expect(p?.skip, letter).toContain('outside the designator grammar');
    }
  });

  it('the twenty letters §1 defines still parse, and so do the two named traps', () => {
    for (const letter of 'ABCEFGHJKLNRSTUVWXYZ') {
      const p = parsePrograms(record(`1${letter}/1A`)).find((x) => x.name === 'ZZ-PROBE');
      expect(p?.skip, letter).toBe('');
      expect(p?.wires, letter).toEqual([[`1${letter}`, '1A']]);
    }
    // §1's own two parser traps, unchanged by the narrowing: M10/M11 have no t/b form, and D runs
    // 0..19 rather than 0..9.
    expect(parsePrograms(record('M10t/1A')).find((x) => x.name === 'ZZ-PROBE')?.skip).toContain('grammar');
    expect(parsePrograms(record('M11b/1A')).find((x) => x.name === 'ZZ-PROBE')?.skip).toContain('grammar');
    expect(parsePrograms(record('D19/1A')).find((x) => x.name === 'ZZ-PROBE')?.skip).toBe('');
    expect(parsePrograms(record('D20/1A')).find((x) => x.name === 'ZZ-PROBE')?.skip).toContain('grammar');
  });

  it('and if one ever reaches the builder anyway, it throws instead of shorting to PLUS', () => {
    // Defence in depth, because the grammar is a regex and the consequence of a hole in it was a
    // silent short. The interner is sealed once the panel is built, so a designator with no
    // terminal cannot quietly become one.
    const bad: Program = { name: 'ZZ-PROBE', stated: null, wires: [['1D', '1A']], skip: '' };
    expect(() => build(bad, [0, 0, 0, 0, 0, 0], 0, 0, WIPER)).toThrow(/not a panel terminal/);
  });
});

describe('the panel netlist is still the one docs/research/jack-map.md describes', () => {
  it('§5 rows, §5 arm/rest/operated senses, §4 rails and §1 section letters all agree', () => {
    // The tool hardcodes the netlist; this is the run-time tie that stops it drifting away from the
    // research package. Any mismatch is reported as a sentence rather than a boolean.
    expect(JACK_MAP).toEqual([]);
  });
});

describe('the census measures at the SHIPPED profile, not at the solver KAT\'s test vector', () => {
  // The defect this block exists for. The tool builds every coil out of `test/mv601-ref.ts`'s
  // `L_COIL`, and that file's own header says its inductance is the solver KAT's arbitrary test
  // vector and is "NOT `L_coil_uh`. Do not cite it as such." They agree TODAY — 1.2 H on both
  // sides — so no number this file pins is wrong. W1b completed with 1.2 H; this guard prevents a
  // later profile change from leaving the census at the W1a fixture value while the gate exits 0.
  // `verifyRefConstants` is the same kind of run-time tie `verifyJackMap` is, for the electrical
  // constants instead of the panel.

  const SHIPPED = shippedProfile();
  /** All six relays at rest — the contact configuration is not what these tests are about. */
  const REST = [0, 0, 0, 0, 0, 0];

  /** The shipped document with one value replaced, through the real loader — no hand-built profile. */
  const doctor = (key: string, v: number): Profile => {
    const doc = JSON.parse(readFileSync(SHIPPED_PROFILE_JSON, 'utf8')) as { values: Record<string, { v: unknown } | undefined> };
    const e = doc.values[key];
    if (e === undefined) throw new Error(`no ${key} in the shipped profile`);
    e.v = v;
    if (key === 'R_cold_uohm') {
      const pwl = doc.values['lamp_pwl_uohm']?.v;
      if (!Array.isArray(pwl) || !Array.isArray(pwl[0])) throw new Error('no lamp PWL cold anchor in the shipped profile');
      pwl[0][1] = v;
    }
    return loadProfile(doc);
  };

  it('every constant the census consumes still equals the shipped profile\'s own value', () => {
    expect(SHIPPED.id).toBe('MV601-REF-A');
    expect(verifyRefConstants()).toEqual([]);
    // The agreement that makes every measurement pinned above a statement about the shipped
    // machine rather than about a fixture. Asserted, not assumed.
    expect(L_COIL).toBe(SHIPPED.v.L_coil_uh / 1e6);
    expect(R_COIL).toBe(SHIPPED.v.R_coil_uohm / 1e6);
    expect(I_PULLIN).toBe(SHIPPED.derived.pullInUa / 1e6);
    expect(K_THERMAL).toBe(SHIPPED.derived.kThermal);
  });

  it('a diverged L_coil_uh fires the guard, and it names the constant and both values', () => {
    const bad = verifyRefConstants(doctor('L_coil_uh', 1_500_000));
    expect(bad.length).toBe(1);
    expect(bad[0]).toContain('L_COIL');
    expect(bad[0]).toContain('1.2');
    expect(bad[0]).toContain('1.5');
    expect(bad[0]).toContain('L_coil_uh');
  });

  it('so does every other constant it consumes, the derived ones included', () => {
    // Each is doctored one at a time and the guard must name the `mv601-ref.ts` export, not the
    // profile key — the export is what the census actually reads.
    const fires = (key: string, v: number, name: string): void => {
      expect(verifyRefConstants(doctor(key, v)).join(' '), key).toContain(name);
    };
    fires('V_oc_mv', 12_000, 'V_OC');
    fires('R_src_uohm', 700_000, 'R_SRC');
    fires('R_coil_uohm', 160_000_000, 'R_COIL');
    fires('V_arc_clamp_mv', 25_000, 'V_ARC');
    fires('gmin_ns', 2, 'GMIN_S');
    fires('tick_us', 50, 'DT_S');
    // Derived, not raw keys: §4.4's pull-in threshold comes out of `V_pullin_mv` and `R_coil_uohm`,
    // and §3.4's `kThermal` out of `tick_us` and `lamp_thermal_tau_us`.
    fires('V_pullin_mv', 6_000, 'I_PULLIN');
    fires('lamp_thermal_tau_us', 30_000, 'K_THERMAL');
    // The tungsten law reaches the census through the imported `tungsten`/`makePwl` rather than as
    // a constant, and the census's lamps are fixed warm resistors off it, so it is checked too.
    fires('R_hot_uohm', 150_000_000, 'R_HOT');
    fires('I_hot_ua', 90_000, 'I_HOT');
    fires('R_cold_uohm', 20_000_000, 'R_COLD');
    // And `I_DROPOUT`, which is the tool's OWN hand-copy of §4.4's drop-out derivation rather than
    // a `mv601-ref.ts` import — same failure mode, and it feeds `relayDir`, which is what the
    // gate's `decisionFlips` is counted from.
    fires('V_dropout_mv', 2_400, 'I_DROPOUT');
  });

  it('a divergence fails the GATE, not only this spec', () => {
    const bad = violations(CENSUS, JACK_MAP, verifyRefConstants(doctor('L_coil_uh', 1_500_000)));
    expect(bad.length).toBe(1);
    expect(bad[0]).toContain('L_COIL');
    // And the clean profile leaves the gate exactly where it was.
    expect(violations(CENSUS, JACK_MAP, verifyRefConstants())).toEqual([]);
  });

  it('this suite itself runs in the shipped configuration', () => {
    // Without this, `MINIVAC_L_COIL_H=0.9 npm test` would measure every pinned number above at
    // 0.9 H. They would move and the suite would go red anyway, but it would go red without
    // saying why. It says why here.
    expect(readLCoilOverride({})).toBeNull();
    expect(L_CENSUS_H).toBe(L_COIL);
  });

  it('MINIVAC_L_COIL_H sets the census\'s inductance for a run, and rejects nonsense', () => {
    // §4.4's indicative band is 0.9-1.5 H, and sweeping it is why this exists: the alternative is
    // editing `L_COIL` in `test/mv601-ref.ts` and reverting, which is the exact fragility the guard
    // above removes.
    expect(readLCoilOverride({ [L_COIL_ENV]: '0.9' })).toBe(0.9);
    expect(readLCoilOverride({ [L_COIL_ENV]: '1.5' })).toBe(1.5);
    expect(readLCoilOverride({ [L_COIL_ENV]: '' })).toBeNull();
    for (const junk of ['ish', '0', '-1.2', 'NaN', 'Infinity']) {
      expect(() => readLCoilOverride({ [L_COIL_ENV]: junk }), junk).toThrow(/positive number of henries/);
    }
  });

  it('an overridden run builds its coils at the override, and the guard steps aside for L_COIL', () => {
    const p = PROGRAMS.find((x) => x.name === 'II-FF1') as Program;
    const coilLs = (lH?: number): number[] => {
      const b = lH === undefined ? build(p, REST, 0, 0, WIPER) : build(p, REST, 0, 0, WIPER, lH);
      const out: number[] = [];
      for (const e of b.els) if (e.k === 'coil') out.push(e.lH);
      return out;
    };
    expect(coilLs()).toEqual([L_COIL, L_COIL, L_COIL, L_COIL, L_COIL, L_COIL]);
    expect(coilLs(0.9)).toEqual([0.9, 0.9, 0.9, 0.9, 0.9, 0.9]);
    expect(coilLs(1.5)).toEqual([1.5, 1.5, 1.5, 1.5, 1.5, 1.5]);
    // The one constant the override is allowed to disagree with the profile about — and only that
    // one: a stale `V_arc_clamp_mv` still fires while an override is in force.
    expect(verifyRefConstants(SHIPPED, 0.9)).toEqual([]);
    expect(verifyRefConstants(doctor('L_coil_uh', 1_500_000), 0.9)).toEqual([]);
    expect(verifyRefConstants(doctor('V_arc_clamp_mv', 25_000), 0.9).join(' ')).toContain('V_ARC');
  });

  it('and the report says, at the top, that such a run is not the shipped configuration', () => {
    const text = formatCensus(CENSUS, JACK_MAP, [], 0.9);
    expect(text).toContain(L_COIL_ENV);
    expect(text).toContain('0.9 H');
    expect(text).toContain('NOT THE SHIPPED CONFIGURATION');
    expect(text.split('\n')[0]).toContain('=====');
    // A shipped run carries none of it, which is what keeps the report a regression baseline.
    expect(formatCensus(CENSUS, JACK_MAP)).not.toContain('NOT THE SHIPPED CONFIGURATION');
    expect(formatCensus(CENSUS, JACK_MAP)).not.toContain(L_COIL_ENV);
  });
});

describe('Wave D threshold-set integrity and atomic application', () => {
  it('keeps the ordinary census on the nominal immutable Z baseline', () => {
    expect(CENSUS.thresholdSet).toBe('Z');
    expect(CENSUS.lCoilH).toBe(1.2);
    expect(Object.isFrozen(Z_THRESHOLD_SET)).toBe(true);
    expect(Object.isFrozen(Z_THRESHOLD_SET.pullInUa)).toBe(true);
    expect(Object.isFrozen(Z_THRESHOLD_SET.dropOutUa)).toBe(true);
    expect(Z_THRESHOLD_SET.pullInUa).toEqual([43_333, 43_333, 43_333, 43_333, 43_333, 43_333]);
    expect(Z_THRESHOLD_SET.dropOutUa).toEqual([16_667, 16_667, 16_667, 16_667, 16_667, 16_667]);
  });

  it('pins the checked-in D vector and all twelve indexed derived scalars', () => {
    expect(D_DV_RELAY_MV).toEqual([-282, -169, -56, 56, 169, 282]);
    expect(D_THRESHOLD_SET.pullInUa).toEqual([41_453, 42_207, 42_960, 43_707, 44_460, 45_213]);
    expect(D_THRESHOLD_SET.dropOutUa).toEqual([14_787, 15_540, 16_293, 17_040, 17_793, 18_547]);
    expect(D_ENDPOINT.profile).toBe(LOADED_SHIPPED);
    expect(LOADED_SHIPPED.dVRelayMv).toEqual(D_DV_RELAY_MV);
    const rows = D_ENDPOINT.rows;
    expect(rows).toHaveLength(6);
    expect(formatThresholdIntegrity(rows).match(/^relay=/gm)).toHaveLength(6);
    expect(formatThresholdIntegrity(rows).match(/selected=/g)).toHaveLength(12);
  });

  it('rejects reverted, rotated, or misindexed checked-in profile lineage before D results', () => {
    const loadedWith = (dv: readonly number[]): Profile => {
      const doc = JSON.parse(readFileSync(SHIPPED_PROFILE_JSON, 'utf8')) as {
      values: { dV_relay_mv: { v: number[] } };
      };
      doc.values.dV_relay_mv.v = [...dv];
      return loadProfile(doc);
    };
    const bad = [
      [300, -240, 290, -110, 250, -170],
      [...D_DV_RELAY_MV.slice(1), D_DV_RELAY_MV[0] as number],
      [D_DV_RELAY_MV[1] as number, D_DV_RELAY_MV[0] as number, ...D_DV_RELAY_MV.slice(2)],
    ];
    for (const dv of bad) {
      expect(() => dEndpointCensus(PROGRAMS, loadedWith(dv))).toThrow(/expected checked-in D=.*before census/);
    }
  });

  it('rejects pull-only, drop-only, and mixed-site threshold application', () => {
    const pullOnly = { ...D_THRESHOLD_SET, dropOutUa: Z_THRESHOLD_SET.dropOutUa };
    const dropOnly = { ...D_THRESHOLD_SET, pullInUa: Z_THRESHOLD_SET.pullInUa };
    expect(() => thresholdIntegrityRows(pullOnly, LOADED_SHIPPED)).toThrow(/relay=1.*dropOutUa/);
    expect(() => thresholdIntegrityRows(dropOnly, LOADED_SHIPPED)).toThrow(/relay=1.*pullInUa/);
    expect(() => commonThresholdSet(Z_THRESHOLD_SET, D_THRESHOLD_SET)).toThrow(/partial application.*self-consistency=Z, endpoint=D/);
    expect(() => census(PROGRAMS, { only: [], thresholdSet: Z_THRESHOLD_SET, endpointThresholdSet: D_THRESHOLD_SET }))
      .toThrow(/partial application/);
  });

  it('computes perturbed-coil headroom on the strict population and indexed pull/drop thresholds', () => {
    expect(perturbedCoilHeadroom([], D_THRESHOLD_SET)).toEqual({ population: 0, minimumA: Infinity });
    const at = SERIES_BOUND_A;
    const below = SERIES_BOUND_A / 2;
    const excludedCloser = 45_200e-6;
    const samples = [
      // Only 0.5 µA from relay 6 pull-in, but err=0: smaller than the included headroom and excluded.
      { relayIndex: 5, gotA: 45_212.5e-6, wantA: 45_212.5e-6 },
      { relayIndex: 0, gotA: below, wantA: 0 },
      { relayIndex: 1, gotA: at, wantA: 0 },
      { relayIndex: 2, gotA: 20e-3 + 2e-6, wantA: 20e-3 },
      { relayIndex: 5, gotA: excludedCloser + 2e-6, wantA: excludedCloser },
    ];
    const got = perturbedCoilHeadroom(samples, D_THRESHOLD_SET);
    const indexedRelay6 = Math.min(
      Math.abs(excludedCloser - 45_213e-6),
      Math.abs(excludedCloser - 18_547e-6),
    ) - 2e-6;
    expect(got.population).toBe(2);
    expect(got.minimumA).toBeCloseTo(indexedRelay6, 15);
  });

  it('detects the integrated D profile and still rejects the retired pre-D shape', () => {
    expect(shippedProfileUsesD(LOADED_SHIPPED)).toBe(true);
    expect(requireShippedDProfile(LOADED_SHIPPED)).toEqual(D_ENDPOINT.rows);
    const preDDoc = JSON.parse(readFileSync(SHIPPED_PROFILE_JSON, 'utf8')) as {
      values: { dV_relay_mv: { v: number[] } };
    };
    preDDoc.values.dV_relay_mv.v = [300, -240, 290, -110, 250, -170];
    expect(shippedProfileUsesD(loadProfile(preDDoc))).toBe(false);
  });

  it('freezes the first approved endpoint population and minimum strings without calling the helper', () => {
    expect(D_CENSUS.lCoilH).toBe(1.2);
    expect(CENSUS.all.perturbedCoils).toBe(368);
    expect(CENSUS.all.perturbedHeadroomA * 1e3).toBeCloseTo(1.26193, 5);
    expect(CENSUS.shipped.perturbedCoils).toBe(0);
    expect(CENSUS.shipped.perturbedHeadroomA).toBe(Infinity);
    expect(D_CENSUS.all.perturbedCoils).toBe(368);
    expect(D_CENSUS.all.perturbedHeadroomA * 1e3).toBeCloseTo(0.134934, 6);
    expect(D_CENSUS.shipped.perturbedCoils).toBe(0);
    expect(D_CENSUS.shipped.perturbedHeadroomA).toBe(Infinity);

    const z = formatCensus(CENSUS, JACK_MAP);
    const d = formatCensus(D_CENSUS, JACK_MAP);
    expect(z).toContain('population 368, minimum 1.26193 mA');
    expect(z).toContain('threshold set Z; L_coil=1.2 H');
    expect(z).toContain('population 0, minimum n/a');
    expect(d).toContain('population 368, minimum 0.134934 mA');
    expect(d).toContain('threshold set D; L_coil=1.2 H');
    expect(d).toContain('population 0, minimum n/a');
    const at145 = formatCensus({ ...CENSUS, lCoilH: 1.45 }, JACK_MAP);
    expect(at145).toContain('threshold set Z; L_coil=1.45 H');
    expect(at145).not.toContain('L_coil=1.5 H');
  });
});

describe('the state the O-E11 defect needs IS reached — the withdrawn claim, corrected', () => {
  it('the sweep is the whole corpus on both axes, and the hysteresis filter is §4.3\'s own', () => {
    // Asserted so nothing below can be proved by a harness that built little. The counts are
    // LARGER than the ones this file used to carry (5,322 / 31,932), because the reachability
    // filter used to compare both relay senses against pull-in: a relay marked operated was
    // discarded unless its coil was above PULL-IN, when §4.3 holds it down to DROP-OUT. The band it
    // was throwing away is 26.7 mA wide.
    expect(I_PULLIN - I_DROPOUT).toBeCloseTo(26.666e-3, 6);
    // 2026-10-14: V-EXP19's 4H/5U -> 4H/5L correction halves its self-consistent before-states
    // (28 -> 14 shipped, 256 -> 128 all). Old values 5386 / 32316 / 35960 / 215760.
    // 2026-10-14: II-EXP1's printed 5F/5- (Phase 5 wave 3) raises its configurations 780 -> 1356
    // shipped, 2328 -> 3300 all; no other program moved. Old values 5372 / 32232 / 35832 / 214992.
    expect(CENSUS.shipped.selfConsistentStates).toBe(5468);
    expect(CENSUS.shipped.configurations).toBe(32808);
    expect(CENSUS.all.selfConsistentStates).toBe(35994);
    expect(CENSUS.all.configurations).toBe(215964);
    // Before-states whose wiring ties the two rails together are excluded rather than filtered:
    // `build` stamps that panel with its supply as a datum self-loop, so every coil reads 0 A and
    // the all-released mask would pass the hysteresis filter below on a de-energised netlist.
    expect(CENSUS.all.railShortedStates).toBe(6144);
    expect(CENSUS.shipped.railShortedStates).toBe(128);
    expect(CENSUS.shipped.configurations).toBe(CENSUS.shipped.selfConsistentStates * 6);
    expect(CENSUS.all.configurations).toBe(CENSUS.all.selfConsistentStates * 6);
    expect(CENSUS.all.perProgram.length).toBe(88);
    expect(CENSUS.shipped.perProgram.length).toBe(88);
  });

  it('on the TRANSFER netlist — where the arc pass runs — 80 configurations reach it, 1,122 with both buttons', () => {
    // Finding 1. The census evaluated its predicate on the landed netlist only, and the arc pass
    // does not run there. Sampled on every tick of §4.3's both-open window, the state occurs.
    expect(CENSUS.shipped.transfer.seriesConfigs).toBe(80);
    expect(CENSUS.shipped.transfer.worstSeriesA * 1e3).toBeCloseTo(53.7292, 4);
    expect(CENSUS.all.transfer.seriesConfigs).toBe(1122);
    expect(CENSUS.all.transfer.worstSeriesA * 1e3).toBeCloseTo(55.6108, 4);
    // Both worsts are real currents above pull-in, not conditioning residue.
    expect(CENSUS.shipped.transfer.worstSeriesA).toBeGreaterThan(I_PULLIN);
    expect(CENSUS.all.transfer.worstSeriesA).toBeGreaterThan(I_PULLIN);
  });

  it('on the LANDED netlist it takes a simultaneous two-button press: 0 configurations, then 96', () => {
    // Finding 2. `build()` took a scalar `pb`, so at most one button could ever be down — and
    // `I-EXP4` (tier A, [verified] from a 500 dpi crop of book1.pdf p.12) prints "Push down both
    // pushbutton 1 and pushbutton 2 at the same time". On the 0-or-1 axis the landed netlist really
    // does show nothing: the old 8.2e-9 A figure, which is under the gmin conditioning leak and so
    // is not a mismatch at all. Widen the axis to what the corpus prints and it is 96.
    expect(CENSUS.shipped.landed.seriesConfigs).toBe(0);
    expect(CENSUS.shipped.landed.worstSeriesA).toBeLessThan(SERIES_BOUND_A);
    expect(CENSUS.shipped.landed.worstSeriesA).toBeLessThan(GMIN_S * V_OC);
    expect(CENSUS.shipped.landed.worstSeriesA).toBeGreaterThan(8.2e-9);
    expect(CENSUS.shipped.landed.worstSeriesA).toBeLessThan(8.3e-9);
    expect(CENSUS.all.landed.seriesConfigs).toBe(96);
    expect(CENSUS.all.landed.worstSeriesA * 1e3).toBeCloseTo(17.9098, 4);
  });

  it('five programs reach it, and they include II-FF1, the corpus\'s own primary timing fixture', () => {
    // The names matter more than the counts: II-FF1 is the release-edge fixture W3 is built from,
    // and V-EXP9 is the one program that latches. "Unreachable" was never a statement about
    // obscure demos.
    expect(hitProfile(CENSUS.all)).toEqual([
      ['II-FF1', 128, 0, 0],
      ['V-EXP10', 576, 0, 0],
      ['V-EXP13', 2, 0, 0],
      ['V-EXP9', 160, 96, 0],
      ['V-SUPERCIRCUIT', 256, 0, 0],
    ]);
    expect(hitProfile(CENSUS.shipped)).toEqual([
      ['II-FF1', 4, 0, 0],
      ['V-EXP10', 46, 0, 0],
      ['V-EXP13', 2, 0, 0],
      ['V-SUPERCIRCUIT', 28, 0, 0],
    ]);
  });

  it('the STRANDED pair — the open-release case the arc pass does handle — occurs on both netlists', () => {
    // The other half of the same picture. The bare two-coil node is common in the corpus in the one
    // orientation the arc pass was designed for, both coils pushing current INTO the node with
    // nowhere for it to go. The landed-site count on the 0-or-1 axis is 162, which is the figure
    // this file carried before, unchanged — the hysteresis fix grew the sweep without moving it.
    expect(CENSUS.shipped.landed.strandedConfigs).toBe(162);
    expect(CENSUS.shipped.transfer.strandedConfigs).toBe(441);
    expect(CENSUS.all.landed.strandedConfigs).toBe(1152);
    expect(CENSUS.all.transfer.strandedConfigs).toBe(3921);
    // And it is a real current, not a residual: 51.79 mA landed, 139.15 mA in the open window.
    expect(CENSUS.all.landed.worstStrandedA * 1e3).toBeCloseTo(51.7899, 3);
    expect(CENSUS.all.transfer.worstStrandedA * 1e3).toBeCloseTo(139.152, 2);
    expect(CENSUS.all.landed.worstStrandedA).toBeGreaterThan(I_PULLIN);
    // Every program that produces one arms the arc pass, which is what makes "the arc pass handles
    // this case" a machine-checked statement rather than a remembered one.
    for (const t of CENSUS.all.perProgram.filter((x) => x.transferStranded + x.landedStranded > 0)) {
      expect(t.arcTicks, t.name).toBeGreaterThan(0);
    }
  });
});

describe('reaching it changes no relay decision — the invariant that replaces "unreachable"', () => {
  it('0 decision flips on either axis, over 214k configurations', () => {
    // THE GATE. Everything else in this file is context for this line: after the both-open window,
    // after the armature lands and after settling, no coil's §4.3 direction decision differs from
    // the landed netlist's own DC solution.
    expect(CENSUS.all.decisionFlips).toBe(0);
    expect(CENSUS.shipped.decisionFlips).toBe(0);
    expect(CENSUS.all.hitConfigs).toBe(1122);
    expect(CENSUS.shipped.hitConfigs).toBe(80);
  });

  it('on the shipped axes nothing even latches: the 12-tick window is too short', () => {
    // The mechanism, stated so it is not mistaken for luck. 12 ticks is 1.2 ms against a coil
    // time constant of 8 ms, so the wrong attractor never establishes, and once the armature lands
    // the landed netlist converges to its own right answer. The residual is 1.3e-12 mA — the
    // solver's own arithmetic noise.
    expect(CENSUS.shipped.latchedConfigs).toBe(0);
    expect(CENSUS.shipped.worstCoilErrA * 1e3).toBeLessThan(1e-11);
    expect(BOTH_OPEN_TICKS * DT_S).toBeCloseTo(1.2e-3, 9);
    expect(L_COIL / R_COIL).toBeCloseTo(8e-3, 9);
  });

  it('with simultaneous presses 96 configurations carry a PERMANENT error, worst 3.04101 mA', () => {
    // Flagged rather than buried: 3.04101 mA is 7.0% of the 43.333 mA pull-in. The margin is real
    // and it is not large, and it is not guaranteed under a different `dV_relay_mv` or `L_coil`.
    // W1b completed and REF-A contains current D; this is a measured bound with a stated margin,
    // not a claim that the defect is harmless.
    expect(CENSUS.all.latchedConfigs).toBe(96);
    expect(CENSUS.all.worstCoilErrA * 1e3).toBeCloseTo(3.04101, 4);
    expect(CENSUS.all.worstCoilErrA / I_PULLIN).toBeCloseTo(0.0702, 4);
    // All 96 are one program's, and it is not one of the counters the idiom was supposed to live in.
    expect(tally(CENSUS.all, 'V-EXP9').latched).toBe(96);
    expect(CENSUS.all.perProgram.filter((t) => t.latched > 0).map((t) => t.name)).toEqual(['V-EXP9']);
  });

  it('and no flip was POSSIBLE, not merely unobserved: every coil clears its threshold by 1.03 mA', () => {
    // The stronger statement, and the one that says how much room there is. For every coil of every
    // configuration that reached the state, the distance from the correct DC answer to the nearest
    // §4.3 threshold exceeds that coil's error — by at least 1.03215 mA. If this number reaches
    // zero, a decision is one rounding away from moving.
    expect(CENSUS.all.worstHeadroomA).toBeGreaterThan(0);
    expect(CENSUS.all.worstHeadroomA * 1e3).toBeCloseTo(1.03215, 4);
    expect(CENSUS.shipped.worstHeadroomA * 1e3).toBeCloseTo(1.53947, 4);
  });

  it('the answer does not depend on the settling budget', () => {
    // 3,000 ticks is past convergence rather than at it: V-EXP9, the one latching program, gives
    // the identical answer at 12,000. 100 and 300 are still transient and say so. The decision flip
    // count is 0 at every budget, transient ones included — which is the part the ruling rests on.
    const at = (settleTicks: number): AxisTally => census(PROGRAMS, { only: ['V-EXP9'], settleTicks }).all;
    const long = at(12000);
    const short = at(300);
    expect(long.hitConfigs).toBe(160);
    expect(long.latchedConfigs).toBe(96);
    expect(long.worstCoilErrA * 1e3).toBeCloseTo(3.04101, 4);
    expect(short.latchedConfigs).toBe(160); // still transient, and honest about it
    expect(short.worstCoilErrA * 1e3).toBeCloseTo(3.07364, 4);
    for (const a of [long, short, at(100)]) expect(a.decisionFlips, 'decision flips at every settling budget').toBe(0);
    expect(SETTLE_TICKS).toBe(3000);
  }, 20_000);

  it('the tool agrees: the invariant holds, so the gate exits zero', () => {
    expect(violations(CENSUS, JACK_MAP)).toEqual([]);
  });
});

describe('the arc pass over the reachable corpus', () => {
  it('31 of the 88 programs ever fire it, on both axes', () => {
    // 2026-10-14: V-EXP19 with the printed 4H/5L never arms the arc pass (it fired on every one of
    // its 168 / 1536 configurations with the OCR'd 4H/5U). Old values 65008 / 402636 / 32 programs.
    // 2026-10-14: II-EXP1's printed 5F/5- (Phase 5 wave 3) raises its arc ticks 2688 -> 5760
    // shipped, 5184 -> 9720 all; the program set is unchanged. Old values 64840 / 401100.
    expect(CENSUS.shipped.arcTicks).toBe(67912);
    expect(CENSUS.all.arcTicks).toBe(405636);
    expect(CENSUS.shipped.arcPrograms.length).toBe(31);
    expect(CENSUS.all.arcPrograms).toEqual(CENSUS.shipped.arcPrograms);
    expect(CENSUS.all.arcPrograms).toEqual([...CENSUS.all.arcPrograms].sort());
  });

  it('IV-EXP1 and ER-ALTCOUNTER never arm it, and their silence is not vacuous', () => {
    // Named by hand in the ruling: the Book IV three-bit counter and the errata's alternate counter
    // are the two circuits the `nE`/`mG` chaining idiom is supposed to live in, and they are the
    // reason the defect was thought to matter. Their configuration counts are asserted so "never
    // fires" cannot be true merely because nothing ran — and note the count DEPENDS ON THE AXIS,
    // 672 with at most one button down and 6,144 across all 64 combinations. Quoting one of those
    // without saying which is how the corpus numbers drifted apart in the first place.
    for (const name of NAMED_QUIET) {
      expect(tally(CENSUS.shipped, name).configs, name).toBe(672);
      expect(tally(CENSUS.all, name).configs, name).toBe(6144);
      expect(tally(CENSUS.all, name).arcTicks, name).toBe(0);
      expect(tally(CENSUS.all, name).hits, name).toBe(0);
      expect(CENSUS.all.arcPrograms, name).not.toContain(name);
    }
  });

  it('and the gate carries that fact, so it cannot decay into a remembered one', () => {
    // The ruling names these two by hand, so `violations()` — the tool's own exit condition — has
    // to notice if either ever starts arming. Doctored here rather than waited for.
    const quiet = (over: Partial<ProgramTally>): Census => ({
      ...CENSUS,
      all: {
        ...CENSUS.all,
        perProgram: CENSUS.all.perProgram.map((t) => (t.name === 'IV-EXP1' ? { ...t, ...over } : t)),
      },
    });
    expect(violations(quiet({ arcTicks: 7 }), JACK_MAP).join(' ')).toContain('never firing in any reachable state');
    expect(violations(quiet({ hits: 3 }), JACK_MAP).join(' ')).toContain('reaching it in none');
    expect(violations(quiet({ configs: 0 }), JACK_MAP).join(' ')).toContain('vacuous');
  });
});

describe('the checks bite — positive and negative controls', () => {
  // The load-bearing results above are NULL results: no decision flips. A null result is only worth
  // reading if the instrument can produce a positive one, so these controls show each check firing
  // on a case built to make it fire.
  const coil = (a: number, b: number): El => ({ k: 'coil', a, b, rOhm: R_COIL, lH: L_COIL });
  const source = (a: number, b: number): El => ({ k: 'source', a, b, vOc: V_OC, rSrcOhm: R_SRC });
  const cfg: SolveCfg = { dtS: DT_S, vArc: V_ARC, kThermal: K_THERMAL, gminS: GMIN_S, pwl: makePwl(), datum: 0 };

  it('the SERIES detector fires on the exact circuit test/solve.spec.ts documents', () => {
    // The `it.fails` circuit at its latched currents: node 2 carries two coils and nothing else,
    // one in and one out, 5.7677 mA apart.
    const els: El[] = [coil(1, 2), coil(2, 0), source(1, 0)];
    const m = bareTwoCoilNodes(els, 0, Float64Array.from([46.109272e-3, 40.341545e-3]));
    expect(m.series * 1e3).toBeCloseTo(5.767727, 5);
    expect(m.series).toBeGreaterThan(SERIES_BOUND_A);
    expect(m.stranded).toBe(0);
  });

  it('the SERIES and STRANDED shapes are told apart by the sign, not by the magnitude', () => {
    // Same node, same two coils, same currents — reversed orientation, so both push IN. That is the
    // open-release case, and it must NOT be counted against the defect.
    const els: El[] = [coil(1, 2), coil(3, 2), source(1, 0)];
    const m = bareTwoCoilNodes(els, 0, Float64Array.from([50e-3, 50e-3]));
    expect(m.series).toBe(0);
    expect(m.stranded * 1e3).toBeCloseTo(100, 6);
  });

  it('THE POSITIVE CONTROL: the decision detector fires on the documented latch', () => {
    // "0 decision flips" is the whole ruling, so it has to be shown to mean *absent* rather than
    // *undetectable*. This runs the census's own comparison — settle, then `relayDir` against the
    // netlist's own DC answer — on the two-coil circuit the `it.fails` documents, seeded the way it
    // seeds it. The DC answer is 43.2368 mA, which is BELOW the 43.333 mA pull-in, so both relays
    // should hold where they are; the latched pair straddles the line, so coil 1 decides to
    // OPERATE and the machine gains a relay operation the circuit does not call for.
    const els: El[] = [coil(1, 2), coil(2, 0), source(1, 0)];
    const truth = dcCoilCurrents(els, 0);
    const carried: Carried = { iCoil: Float64Array.from([86.3e-3, 0]), rLamp: new Float64Array(0) };
    for (let t = 0; t < SETTLE_TICKS; t++) tickSolve(els, carried, cfg);

    expect(Math.abs(truth[0] as number) * 1e3).toBeCloseTo(43.2368, 4);
    expect(relayDir(Math.abs(truth[0] as number))).toBe(0);
    expect(relayDir(Math.abs(truth[1] as number))).toBe(0);
    expect(Math.abs(carried.iCoil[0] as number) * 1e3).toBeCloseTo(46.2386, 3);
    expect(relayDir(Math.abs(carried.iCoil[0] as number))).toBe(1); // <- a flip, detected
    expect(relayDir(Math.abs(carried.iCoil[1] as number))).toBe(0);
  });

  it('a decision flip anywhere makes the invariant fail and the gate exit non-zero', () => {
    const doctored: Census = { ...CENSUS, all: { ...CENSUS.all, decisionFlips: 1 } };
    const bad = violations(doctored, JACK_MAP);
    expect(bad.length).toBe(1);
    expect(bad[0]).toContain('no longer holds');
  });

  it('a worst coil error above the tripwire does too, and the tripwire is above the measurement', () => {
    const doctored: Census = { ...CENSUS, all: { ...CENSUS.all, worstCoilErrA: COIL_ERR_BOUND_A * 1.01 } };
    const bad = violations(doctored, JACK_MAP);
    expect(bad.length).toBe(1);
    expect(bad[0]).toContain('tripwire');
    // The stated rule that sets it: the next whole milliamp above the measured worst. Written as an
    // assertion so a future re-measurement cannot quietly slide the bound up to meet itself.
    expect(COIL_ERR_BOUND_A).toBe(Math.ceil(CENSUS.all.worstCoilErrA * 1e3) * 1e-3);
  });

  it('a sweep that reaches the state nowhere is reported as a narrowed harness, not as a clean bill', () => {
    // The failure mode this whole round exists to prevent: an instrument that measures nothing and
    // reports a null result. If the state stops being reached, that is a bug in the sweep.
    const doctored: Census = { ...CENSUS, all: { ...CENSUS.all, hitConfigs: 0 } };
    expect(violations(doctored, JACK_MAP).join(' ')).toContain('the sweep has narrowed');
  });

  it('an edit to jack-map.md that moves a contact is caught at run time', () => {
    // Swap relay set 1's N.C. and N.O. in the file the tool reads. The netlist the tool hardcodes
    // no longer describes the panel, and every number above would be measured on the wrong machine.
    const text = readFileSync(JACK_MAP_MD, 'utf8');
    const doctored = text.replace('arm `nH`; N.C. `nJ`; N.O. `nG`', 'arm `nH`; N.C. `nG`; N.O. `nJ`');
    expect(doctored).not.toBe(text);
    const bad = verifyJackMap(doctored);
    expect(bad.length).toBe(1);
    expect(bad[0]).toContain('arm/rest/operated');
  });
});

describe('an edit to programs.md fails the gate, not just the spec', () => {
  // Four corpus mutations, each a way a research edit could quietly shrink or change the evidence,
  // and each run through `violations()` — the TOOL's own exit condition — rather than only through
  // the pinned numbers above. The sweep is deliberately empty (`only: []`): these are about the
  // parse half of the gate, and sweeping 88 programs five more times to learn it would cost a
  // minute and prove nothing extra. So the assertions read only the `programs.md:` sentences.
  const TEXT = readFileSync(PROGRAMS_MD, 'utf8');
  const parseGate = (text: string): string[] =>
    violations(census(parsePrograms(text), { only: [] }), []).filter((s) => s.startsWith('programs.md:'));

  /** I-EXP4's whole printed wire table — the record that prints the two-button press. */
  const ROW = '| `1+/1Y` | `1X/2Y` | `2X/2A` | `2B/2-` |';

  it('the clean corpus passes the parse half of the gate', () => {
    expect(TEXT.split(ROW).length - 1).toBe(1); // the row the mutations below edit is unique
    expect(parseGate(TEXT)).toEqual([]);
  });

  it('a DROPPED WIRE fails it', () => {
    const bad = parseGate(TEXT.replace(ROW, '| `1+/1Y` | `1X/2Y` | `2X/2A` |  |'));
    expect(bad.join('\n')).toContain('87 usable records, expected 88');
    // 2026-10-14: totals +1 for II-EXP1's 5F/5- (Phase 5 wave 3). Old '2152 ... expected 2156'.
    expect(bad.join('\n')).toContain('2153 wires parsed, expected 2157');
  });

  it('a REWRITTEN WIRE fails it — and only the digest catches that one', () => {
    // The mutation that moves no count: `2X/2A` becomes `2X/2B`, so the record still parses, still
    // has four wires, and still matches its own stated count. Every census number is identical.
    const bad = parseGate(TEXT.replace(ROW, '| `1+/1Y` | `1X/2Y` | `2X/2B` | `2B/2-` |'));
    expect(bad.length).toBe(1);
    expect(bad[0]).toContain('wire digest');
    expect(bad[0]).toContain('a wire was rewritten');
  });

  it('a CORRUPTED WIRE COUNT fails it', () => {
    // The record's own metadata line says 5 where its table has 4, so the parser skips it — which
    // is the D1 defence, and the gate now notices the record went missing.
    const bad = parseGate(TEXT.replace('PDF p.12 · 4 wires ·', 'PDF p.12 · 5 wires ·'));
    expect(bad.join('\n')).toContain('87 usable records, expected 88');
    expect(bad.join('\n')).toContain('15 skipped records, expected 14');
  });

  it('a DELETED PROGRAM fails it', () => {
    const cut = TEXT.replace(/### I-EXP4 —[\s\S]*?(?=### I-EXP5 —)/, '');
    expect(cut.length).toBeLessThan(TEXT.length);
    const bad = parseGate(cut);
    expect(bad.join('\n')).toContain('101 records found, expected 102');
    expect(bad.join('\n')).toContain('87 usable records, expected 88');
  });

  it('an INJECTED BAD PROGRAM fails it, even though it changes no wire count', () => {
    // A record naming `1D`, one of the six section letters jack-map.md §1 excludes. It is skipped
    // by the grammar rather than run, so `usable` and `totalWires` are untouched — only the record
    // and skip counts and the digest move.
    const injected = `${TEXT}\n\n### ZZ-INJECTED — a record naming a letter §1 does not define\n\nnowhere · 1 wire · tier Z\n\n| |\n|---|\n| \`1D/1A\` |\n`;
    const p = parsePrograms(injected);
    expect(p.find((x) => x.name === 'ZZ-INJECTED')?.skip).toContain('outside the designator grammar');
    expect(p.filter((x) => x.skip === '').length).toBe(88);
    const bad = parseGate(injected);
    expect(bad.join('\n')).toContain('103 records found, expected 102');
    expect(bad.join('\n')).toContain('15 skipped records, expected 14');
  });
});

describe('reproducibility', () => {
  it('two runs over the same programs produce byte-identical reports', () => {
    // The full sweep is pinned above; this is the cheap two-run check that nothing on the report
    // path reads a clock, an RNG or a Map iteration order. The subset is stated and its size is
    // asserted so the bound cannot drift silently: two programs, one that reaches the state and
    // fires the arc pass, and one that does neither.
    const only = ['II-FF1', 'IV-EXP1'];
    const a = census(PROGRAMS, { only });
    const b = census(PROGRAMS, { only });
    expect(a.all.perProgram.length).toBe(2);
    expect(a.all.hitConfigs).toBeGreaterThan(0);
    expect(formatCensus(a, JACK_MAP)).toBe(formatCensus(b, JACK_MAP));
  });

  it('the digest is a function of the parsed wires and of nothing else', () => {
    // It has to be, or it is a nuisance rather than a check: re-wording a skip reason in the tool
    // must not read as a corpus edit, and reordering nothing must not move it.
    expect(wireDigest(PROGRAMS)).toBe(CENSUS.digest);
    const reworded = PROGRAMS.map((p) => (p.skip === '' ? p : { ...p, skip: `${p.skip} (reworded)` }));
    expect(wireDigest(reworded)).toBe(CENSUS.digest);
  });

  it('the report states both axes, the margin, and the claim it no longer makes', () => {
    const text = formatCensus(CENSUS, JACK_MAP);
    for (const name of NAMED_QUIET) expect(text).toContain(name);
    expect(text).toContain('all 64 pushbutton combinations');
    expect(text).toContain('at most one pushbutton down');
    expect(text).toContain('215964'); // 2026-10-14: was 214992 before II-EXP1's 5F/5- (Phase 5 wave 3)
    expect(text).toContain('7.0% of the 43.333 mA pull-in');
    expect(text).toContain('HOLDS.');
    // The withdrawn claim must not come back into the report by any wording.
    expect(text).not.toContain('unreachable');
  });
});
