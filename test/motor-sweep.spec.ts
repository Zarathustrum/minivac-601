import { describe, expect, it } from 'vitest';
import {
  AXES,
  allCases,
  fixtureCases,
  fmtUnits,
  gateFailures,
  judge,
  mergeShards,
  profileWith,
  readShippedRaw,
  regressions,
  renderJson,
  renderMarkdown,
  shardIndices,
  sweepAxis,
} from '../tools/motor-sweep.ts';
import type { Axis, Baseline, Point, Shard, SweepCase, Verdict } from '../tools/motor-sweep.ts';

/** Points from a pattern: p pass, f fail, i invalid; values 1..n. */
function pts(pattern: string): Point[] {
  return [...pattern].map((c, i) => ({ v: i + 1, s: c === 'p' ? 'pass' : c === 'f' ? 'fail' : 'invalid', d: c }));
}

/** Every point is a nominal grid point. */
function grid(points: readonly Point[]): Set<number> {
  return new Set(points.map((p) => p.v));
}

describe('judge (verdict logic on synthetic bands)', () => {
  it('ROBUST: shipped deep inside a wide band', () => {
    const j = judge(pts('fpppppppppppppf'), 8, 1, grid(pts('fpppppppppppppf')));
    expect(j.verdict).toBe('ROBUST');
    expect(j.bands).toEqual([{ lo: 2, hi: 14 }]);
  });

  it('ROBUST: a band running to the axis end has no edge there', () => {
    expect(judge(pts('pppppppp'), 8, 1, grid(pts('pppppppp'))).verdict).toBe('ROBUST');
  });

  it('FRAGILE: shipped one step from a failing neighbour edge', () => {
    // band 4..14; shipped 5 is one step from the band end at 4, whose neighbour fails
    const j = judge(pts('fffppppppppppp'), 5, 1, grid(pts('fffppppppppppp')));
    expect(j.verdict).toBe('FRAGILE');
    expect(j.reasons.join()).toContain('lower band edge');
  });

  it('ROBUST: shipped two steps from the edge is more than one step', () => {
    expect(judge(pts('fffppppppppppp'), 6, 1, grid(pts('fffppppppppppp'))).verdict).toBe('ROBUST');
  });

  it('FRAGILE: narrow band, under half the valid axis', () => {
    const j = judge(pts('ffffpppffffffff'), 6, 1, grid(pts('ffffpppffffffff')));
    expect(j.verdict).toBe('FRAGILE');
    expect(j.reasons.join()).toContain('under half');
  });

  it('FAILS-AT-SHIPPED: shipped point fails even though other bands pass', () => {
    const j = judge(pts('pppfpppp'), 4, 1, grid(pts('pppfpppp')));
    expect(j.verdict).toBe('FAILS-AT-SHIPPED');
    expect(j.bands).toEqual([{ lo: 1, hi: 3 }, { lo: 5, hi: 8 }]);
  });

  it('FAILS-AT-SHIPPED: shipped point is invalid', () => {
    expect(judge(pts('pppipppp'), 4, 1, grid(pts('pppipppp'))).verdict).toBe('FAILS-AT-SHIPPED');
  });

  it('coverage counts nominal grid points only, not an inserted off-grid shipped value', () => {
    // 9 fail then 9 pass; shipped 14 sits in the band 10..18, which runs to the axis end.
    const points = pts('fffffffffppppppppp');
    expect(judge(points, 14, 1, grid(points)).verdict).toBe('ROBUST'); // 9 of 18
    const nominal = new Set(points.map((p) => p.v).filter((v) => v !== 14));
    const j = judge(points, 14, 1, nominal); // 8 of 17
    expect(j.verdict).toBe('FRAGILE');
    expect(j.reasons.join()).toContain('8 of 17');
  });

  it('invalid points break runs, are not edges, and leave the valid axis', () => {
    // valid points: 7 (ppp + pppp); shipped at 6 is next to an invalid, not a fail.
    const j = judge(pts('pppippppp'), 6, 1, grid(pts('pppippppp')));
    expect(j.bands).toEqual([{ lo: 1, hi: 3 }, { lo: 5, hi: 9 }]);
    expect(j.verdict).toBe('ROBUST');
    // band 5..9 is 5 of 8 valid points; with more fails the same band falls under half
    expect(judge(pts('ffffffippp'), 9, 1, grid(pts('ffffffippp'))).verdict).toBe('FRAGILE');
  });
});

describe('formatting', () => {
  it('prints exact natural units', () => {
    expect(fmtUnits(45_000, 1000)).toBe('45');
    expect(fmtUnits(27_500, 1000)).toBe('27.5');
    expect(fmtUnits(16_875_000, 1_000_000)).toBe('16.875');
    expect(fmtUnits(0, 1_000_000)).toBe('0');
    expect(fmtUnits(1_406_250, 1_000_000)).toBe('1.40625');
  });
});

const stub: SweepCase = {
  id: 'STUB/run-above-40',
  group: 'claim',
  check: (p) => ({ pass: p.v.run_mrpm >= 40_000, detail: 'run ' + p.v.run_mrpm }),
};

describe('sweepAxis', () => {
  const twoPoint: Axis = { key: 'run_mrpm', unit: 'rpm', scale: 1000, step: 2500, grid: [30_000, 45_000] };

  it('a tiny two-point grid on a stub claim is deterministic and applies the override', () => {
    const raw = readShippedRaw();
    const before = JSON.stringify(raw);
    const a = sweepAxis(twoPoint, [stub], raw);
    const b = sweepAxis(twoPoint, [stub], raw);
    expect(renderJson([a])).toBe(renderJson([b]));
    expect(renderMarkdown([a], 'node tools/motor-sweep.ts')).toBe(renderMarkdown([b], 'node tools/motor-sweep.ts'));
    expect(a.values).toEqual([30_000, 45_000]);
    expect(a.cases[0]?.points.map((p) => p.s)).toEqual(['fail', 'pass']);
    expect(a.cases[0]?.verdict).toBe('FRAGILE');
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('inserts the shipped value when the grid misses it', () => {
    const axis: Axis = { key: 'run_mrpm', unit: 'rpm', scale: 1000, step: 2500, grid: [30_000] };
    expect(sweepAxis(axis, [stub], readShippedRaw()).values).toEqual([30_000, 45_000]);
  });

  it('an invalid profile point is recorded, not thrown', () => {
    const axis: Axis = {
      key: 'contact_arc_udeg',
      unit: 'deg',
      scale: 1_000_000,
      step: 1_406_250,
      grid: [0, 11_250_000, 22_500_000],
    };
    const never: SweepCase = { id: 'STUB/ok', group: 'claim', check: () => ({ pass: true, detail: 'ok' }) };
    const r = sweepAxis(axis, [never], readShippedRaw());
    expect(r.invalid.map((i) => i.v)).toEqual([0, 22_500_000]);
    expect(r.invalid[0]?.error).toContain('contact_arc_udeg');
    expect(r.cases[0]?.points.map((p) => p.s)).toEqual(['invalid', 'pass', 'pass', 'invalid']);
  });

  it('a throwing check is a recorded failure', () => {
    const boom: SweepCase = { id: 'STUB/boom', group: 'claim', check: () => { throw new Error('nope'); } };
    const r = sweepAxis({ ...twoPoint, grid: [] }, [boom], readShippedRaw());
    expect(r.cases[0]?.verdict).toBe('FAILS-AT-SHIPPED');
    expect(r.cases[0]?.points[0]?.d).toBe('threw: nope');
  });

  it('a zero-expect fixture case is NO-EXPECTS, never ROBUST, and is not listed', () => {
    const trivial: SweepCase = { id: 'STUB/trivial', group: 'printed', expects: 0, check: () => ({ pass: true, detail: 'x' }) };
    const r = sweepAxis(twoPoint, [trivial], readShippedRaw());
    expect(r.cases[0]?.verdict).toBe('NO-EXPECTS');
    expect(gateFailures([r])).toEqual([]);
    expect(regressions([r], { axes: [] })).toEqual([]);
    expect(renderMarkdown([r], 'node tools/motor-sweep.ts')).toContain('| STUB/trivial | NO-EXPECTS |');
  });

  it('gate fails only on a worsened or new non-ROBUST printed verdict', () => {
    const raw = readShippedRaw();
    const spec: SweepCase = { ...stub, id: 'STUB/spec', group: 'speculative', check: () => ({ pass: false, detail: 'x' }) };
    const r = sweepAxis(twoPoint, [stub, spec], raw);
    expect(r.cases.map((c) => c.verdict)).toEqual(['FRAGILE', 'FAILS-AT-SHIPPED']);
    const base = (stubWas: Verdict): Baseline => ({
      axes: [{ key: 'run_mrpm', cases: [{ id: 'STUB/run-above-40', verdict: stubWas }, { id: 'STUB/spec', verdict: 'ROBUST' }] }],
    });
    // Information lines list printed non-ROBUST cases but never fail on their own.
    expect(gateFailures([r])).toHaveLength(1);
    expect(gateFailures([r])[0]).toContain('STUB/run-above-40');
    // Unchanged or improved: no regression. The speculative case got worse and is ignored.
    expect(regressions([r], base('FRAGILE'))).toEqual([]);
    expect(regressions([r], base('FAILS-AT-SHIPPED'))).toEqual([]);
    // Worsened printed verdict: one regression.
    const worse = regressions([r], base('ROBUST'));
    expect(worse).toHaveLength(1);
    expect(worse[0]).toContain('STUB/run-above-40 ROBUST -> FRAGILE');
    // A new printed case that is not ROBUST fails.
    const fresh = regressions([r], { axes: [] });
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toContain('new case, FRAGILE');
  });
});

describe('sharding (--jobs)', () => {
  const axis = AXES.find((a) => a.key === 'run_mrpm') as Axis;
  const cases: SweepCase[] = [30, 35, 40, 45, 50].map((t) => ({
    id: 'STUB/run-above-' + t,
    group: 'claim',
    check: (p) => ({ pass: p.v.run_mrpm >= t * 1000, detail: 'run ' + p.v.run_mrpm }),
  }));
  const shards = (n: number): Shard[] =>
    Array.from({ length: n }, (_, k) => {
      const idx = shardIndices(cases.length, k, n);
      return { key: axis.key, total: cases.length, idx, sweep: sweepAxis(axis, idx.map((i) => cases[i] as SweepCase), readShippedRaw()) };
    });

  it('shards merge back to the serial sweep byte for byte, in any arrival order', () => {
    const serial = sweepAxis(axis, cases, readShippedRaw());
    // A JSON round trip stands in for the IPC channel between processes.
    const merged = mergeShards(JSON.parse(JSON.stringify(shards(3).reverse())) as Shard[]);
    expect(renderJson([merged])).toBe(renderJson([serial]));
    expect(renderMarkdown([merged], 'node tools/motor-sweep.ts')).toBe(renderMarkdown([serial], 'node tools/motor-sweep.ts'));
    // More shards than cases leaves some shards empty; the merge is unchanged.
    expect(renderJson([mergeShards(shards(8))])).toBe(renderJson([serial]));
  });

  it('refuses a missing shard, an overlap, or shards that disagree', () => {
    const s = shards(3);
    expect(() => mergeShards(s.slice(1))).toThrow(/missing/);
    expect(() => mergeShards([...s, s[0] as Shard])).toThrow(/twice/);
    const other = { ...(s[1] as Shard), sweep: { ...(s[1] as Shard).sweep, shipped: 1 } };
    expect(() => mergeShards([s[0] as Shard, other, s[2] as Shard])).toThrow(/disagree/);
  });
});

describe('axes and cases', () => {
  it('grids match the plan', () => {
    const by = (k: string): Axis => AXES.find((a) => a.key === k) as Axis;
    expect(by('run_mrpm').grid).toHaveLength(15);
    expect(by('contact_arc_udeg').grid).toHaveLength(15);
    expect(by('coast_udeg_stop_shorted').grid).toHaveLength(17);
    expect(by('coast_udeg_drive_removed').grid[16]).toBe(45_000_000);
  });

  it('profileWith overrides one value and re-validates', () => {
    expect(profileWith(readShippedRaw(), 'run_mrpm', 50_000).v.run_mrpm).toBe(50_000);
    expect(() => profileWith(readShippedRaw(), 'contact_arc_udeg', 0)).toThrow();
  });

  it('selects the motor-touching fixtures and passes I-EXP11 at the shipped profile', () => {
    const cases = allCases([]);
    const ids = cases.map((c) => c.id);
    expect(ids).toContain('FIXTURE/I-EXP11');
    expect(ids).toContain('FIXTURE/I-EXP13');
    expect(cases.find((c) => c.id === 'FIXTURE/I-EXP11')?.group).toBe('printed');
    expect(fixtureCases().find((c) => c.id === 'FIXTURE/I-EXP11')?.check(profileWith(readShippedRaw(), 'run_mrpm', 45_000)).pass).toBe(true);
  });
});
