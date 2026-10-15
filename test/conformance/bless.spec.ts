import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { assertBlessable, writeBlessed } from './bless.ts';
import { DECISION_ANCHOR } from './helpers.ts';
import { PERTURBATIONS } from './robust.ts';
import type { Perturbation } from './robust.ts';
import { runFixture, runLoadedFixture } from './run.ts';
import type { LoadedFixture, RunResult } from './types.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(script: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'minivac.fixture/1',
    id: 'BLESS-CASE',
    source: 'bless test',
    tier: 'A',
    confidence: 'verified',
    profile: 'MV601-REF-A',
    contract: '1.1.0',
    as_printed: ['A/B'],
    errata_applied: [],
    wires: ['1A/1B'],
    script,
    ...extra,
  };
}

function setup(value: unknown): { fixturePath: string; goldenPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'mv601-bless-'));
  roots.push(root);
  const fixturePath = join(root, 'case.fixture.json');
  const goldenPath = join(root, 'case.trace');
  writeFileSync(fixturePath, JSON.stringify(value) + '\n');
  writeFileSync(goldenPath, 'sentinel\n');
  return { fixturePath, goldenPath };
}

function expectUnchanged(path: string): void {
  expect(readFileSync(path, 'utf8')).toBe('sentinel\n');
}

const HOLDS = { k: 'expect', obs: [{ dev: 'power', v: 'off' }], cite: 'x', quote: 'Power is off.' };

/** A real runner whose result gains one failed assert when `when` matches the perturbed profile. */
function flipWhen(when: (loaded: LoadedFixture) => boolean): (loaded: LoadedFixture) => RunResult {
  return (loaded) => {
    const result = runLoadedFixture(loaded);
    if (!when(loaded)) return result;
    return { ...result, failures: [{ scriptIndex: 0, dev: 'power', expected: 'off', actual: 'on' }] };
  };
}

function counting(): { run: (loaded: LoadedFixture) => RunResult; calls: () => number } {
  let calls = 0;
  return {
    run: (loaded) => {
      calls++;
      return runLoadedFixture(loaded);
    },
    calls: () => calls,
  };
}

function tripped(path: string): RunResult {
  const result = runFixture(path);
  result.metrics.minDecisionUa = result.loaded.profile.v.min_decision_ua - 1;
  return result;
}

describe('bless refusal gates', () => {
  it('refuses a failed structured assertion before touching the golden', () => {
    const paths = setup(fixture([{
      k: 'expect', obs: [{ dev: 'power', v: 'on' }], cite: 'x', quote: 'Power is on.',
    }]));
    const result = runFixture(paths.fixturePath);
    expect(result.failures).toHaveLength(1);
    expect(() => writeBlessed(result, paths.goldenPath)).toThrow(/assertion failed/);
    expectUnchanged(paths.goldenPath);
  });

  it('refuses each numeric knife-edge metric without the exact marginal pair when a perturbation fails', () => {
    const paths = setup(fixture([{ k: 'advance', ms: 1 }]));
    const result = runFixture(paths.fixturePath);
    const options = { run: flipWhen(() => true), log: () => undefined };
    result.metrics.minDecisionUa = result.loaded.profile.v.min_decision_ua - 1;
    expect(() => writeBlessed(result, paths.goldenPath, options)).toThrow(/minDecisionUa/);
    expectUnchanged(paths.goldenPath);

    result.metrics.minDecisionUa = null;
    result.metrics.minTickGap = result.loaded.profile.v.min_tick_gap - 1;
    expect(() => writeBlessed(result, paths.goldenPath, options)).toThrow(/minTickGap/);
    expectUnchanged(paths.goldenPath);
  });

  it('allows numeric knife-edge metrics only for a schema-valid exact mechanism pair', () => {
    const paths = setup(fixture([{ k: 'advance', ms: 1 }], {
      marginal: true,
      mechanism: { profileKey: 'L_coil_uh', decision: DECISION_ANCHOR },
    }));
    const result = runFixture(paths.fixturePath);
    result.metrics.minDecisionUa = 0;
    result.metrics.minTickGap = 1;
    expect(writeBlessed(result, paths.goldenPath)).toBe(paths.goldenPath);
    const bytes = readFileSync(paths.goldenPath);
    expect(bytes[0]).not.toBe(0xef);
    expect(bytes.toString('utf8').endsWith('\n')).toBe(true);
    expect(bytes.toString('utf8')).not.toContain('\r');
  });

  it('refuses a changed C2 mover digest with equal eventCount before touching the golden', () => {
    const reviewedMovers = new Array<number>(19).fill(0);
    reviewedMovers[7] = 1;
    const paths = setup(fixture([{ k: 'advance', ms: 1 }], {
      tier: 'C2',
      digest: { eventCount: 0, moverTransitions: reviewedMovers },
    }));
    const result = runFixture(paths.fixturePath);
    expect(result.digest.eventCount).toBe(0);
    expect(result.loaded.fixture.digest?.eventCount).toBe(result.digest.eventCount);
    expect(result.digest.moverTransitions[7]).toBe(0);
    expect(() => writeBlessed(result, paths.goldenPath)).toThrow(/C2 digest differs/);
    expectUnchanged(paths.goldenPath);
  });

  it('refuses a changed C2 eventCount with equal mover digest before touching the golden', () => {
    const reviewedMovers = new Array<number>(19).fill(0);
    const paths = setup(fixture([{ k: 'advance', ms: 1 }], {
      tier: 'C2',
      digest: { eventCount: 1, moverTransitions: reviewedMovers },
    }));
    const result = runFixture(paths.fixturePath);
    expect(result.digest.eventCount).toBe(0);
    expect(result.digest.moverTransitions).toEqual(reviewedMovers);
    expect(result.loaded.fixture.digest?.moverTransitions).toEqual(result.digest.moverTransitions);
    expect(() => writeBlessed(result, paths.goldenPath)).toThrow(/C2 digest differs/);
    expectUnchanged(paths.goldenPath);
  });

  it('creates no output path when refusal happens before a first write', () => {
    const paths = setup(fixture([{
      k: 'expect', obs: [{ dev: 'power', v: 'on' }], cite: 'x', quote: 'Power is on.',
    }]));
    const missing = join(paths.goldenPath, 'nested', 'case.trace');
    expect(() => writeBlessed(runFixture(paths.fixturePath), missing)).toThrow(/assertion failed/);
    expect(existsSync(missing)).toBe(false);
  });
});

describe('BLESS-ROBUSTNESS: the knife-edge gates as triggers', () => {
  it('has the six ruled perturbations in a fixed order', () => {
    expect(PERTURBATIONS.map((p) => p.name)).toEqual([
      'relay thresholds +150 mV',
      'relay thresholds -150 mV',
      'coil resistance +10%',
      'coil resistance -10%',
      'lamp thermal tau x0.5',
      'lamp thermal tau x2',
    ]);
  });

  it('applies each perturbation to the named raw profile values', () => {
    const base = {
      V_pullin_mv: { v: 6500 },
      V_dropout_mv: { v: 2500 },
      R_coil_uohm: { v: 150000000 },
      lamp_thermal_tau_us: { v: 40000 },
    };
    const after = PERTURBATIONS.map((p) => {
      const values = structuredClone(base) as Record<string, { v: number }>;
      p.apply(values);
      return [values['V_pullin_mv']?.v, values['V_dropout_mv']?.v, values['R_coil_uohm']?.v,
        values['lamp_thermal_tau_us']?.v];
    });
    expect(after).toEqual([
      [6650, 2650, 150000000, 40000],
      [6350, 2350, 150000000, 40000],
      [6500, 2500, 165000000, 40000],
      [6500, 2500, 135000000, 40000],
      [6500, 2500, 150000000, 20000],
      [6500, 2500, 150000000, 80000],
    ]);
  });

  it('blesses a tripped fixture whose asserts hold under all six, and logs one line', () => {
    const paths = setup(fixture([{ k: 'advance', ms: 1 }, HOLDS]));
    const counter = counting();
    const lines: string[] = [];
    const result = tripped(paths.fixturePath);
    expect(writeBlessed(result, paths.goldenPath, { run: counter.run, log: (l) => lines.push(l) }))
      .toBe(paths.goldenPath);
    expect(counter.calls()).toBe(6);
    expect(lines).toEqual([
      'bless: BLESS-CASE tripped (minDecisionUa ' + (result.loaded.profile.v.min_decision_ua - 1) +
        ' is below profile minimum ' + result.loaded.profile.v.min_decision_ua +
        '); all 6 robustness perturbations held',
    ]);
    expect(readFileSync(paths.goldenPath, 'utf8')).toBe(result.trace);
  });

  it('refuses a tripped fixture whose assert flips under one perturbation, naming it, every time', () => {
    const paths = setup(fixture([HOLDS]));
    const run = flipWhen((loaded) => loaded.profile.v.lamp_thermal_tau_us === 80000);
    const expected = 'bless: minDecisionUa 13 is below profile minimum 14, and the robustness check ' +
      'failed under lamp thermal tau x2: assertion failed at script[0] power: expected off, got on';
    const result = tripped(paths.fixturePath);
    expect(result.loaded.profile.v.min_decision_ua).toBe(14);
    expect(() => writeBlessed(result, paths.goldenPath, { run })).toThrow(expected);
    expect(() => writeBlessed(tripped(paths.fixturePath), paths.goldenPath, { run })).toThrow(expected);
    expectUnchanged(paths.goldenPath);
  });

  it('refuses a tripped fixture with no expect or until step, running no perturbations', () => {
    const paths = setup(fixture([{ k: 'advance', ms: 1 }]));
    const counter = counting();
    expect(() => writeBlessed(tripped(paths.fixturePath), paths.goldenPath, { run: counter.run }))
      .toThrow(/no expect or until step/);
    expect(counter.calls()).toBe(0);
    expectUnchanged(paths.goldenPath);
  });

  it('runs no perturbations for an untripped fixture', () => {
    const paths = setup(fixture([HOLDS]));
    const counter = counting();
    const lines: string[] = [];
    const result = runFixture(paths.fixturePath);
    result.metrics.minDecisionUa = result.loaded.profile.v.min_decision_ua;
    result.metrics.minTickGap = result.loaded.profile.v.min_tick_gap;
    assertBlessable(result, { run: counter.run, log: (l) => lines.push(l) });
    expect(counter.calls()).toBe(0);
    expect(lines).toEqual([]);
  });

  it('keeps the marginal path: a tripped marginal fixture runs no perturbations', () => {
    const paths = setup(fixture([HOLDS], {
      marginal: true,
      mechanism: { profileKey: 'L_coil_uh', decision: DECISION_ANCHOR },
    }));
    const counter = counting();
    const result = tripped(paths.fixturePath);
    result.metrics.minTickGap = 1;
    expect(() => assertBlessable(result, { run: counter.run, log: () => undefined })).not.toThrow();
    expect(counter.calls()).toBe(0);
  });

  it('refuses when loadProfile rejects a perturbed profile, with its reason', () => {
    const paths = setup(fixture([HOLDS]));
    const rejected: Perturbation = {
      name: 'dropout above pull-in',
      apply: (values) => {
        (values['V_dropout_mv'] as { v: number }).v = 99999;
      },
    };
    const counter = counting();
    expect(() => assertBlessable(tripped(paths.fixturePath), {
      perturbations: [PERTURBATIONS[0] as Perturbation, rejected],
      run: counter.run,
    })).toThrow(/failed under dropout above pull-in: perturbed profile rejected: /);
    expect(counter.calls()).toBe(1);
  });

  it('refuses when a perturbed run throws, with its reason', () => {
    const paths = setup(fixture([HOLDS]));
    const run = (): RunResult => {
      throw new Error('settle cap exceeded');
    };
    expect(() => assertBlessable(tripped(paths.fixturePath), { run })).toThrow(
      'failed under relay thresholds +150 mV: perturbed run failed: settle cap exceeded');
  });

  it('refuses, bless-prefixed, when the profile on disk is not the one the fixture ran with', () => {
    const paths = setup(fixture([HOLDS]));
    const result = tripped(paths.fixturePath);
    const stale = { ...result, loaded: { ...result.loaded, profile: { ...result.loaded.profile, hash: '0000000000000000' } } };
    const counter = counting();
    expect(() => assertBlessable(stale, { run: counter.run })).toThrow(
      /^bless: robustness: MV601-REF-A on disk is not the profile the fixture ran with$/);
    expect(counter.calls()).toBe(0);
  });

  it('refuses through the default runner: a lamp read right after a settle fails under tau x2', () => {
    const paths = setup(fixture([
      { k: 'do', cmd: { k: 'power', on: true } },
      { k: 'settle', maxMs: 200 },
      { k: 'expect', obs: [{ dev: 'outLamp1', v: 'on' }], cite: 'x', quote: 'Lamp 1 lights.' },
    ], { as_printed: ['1+/1A', '1B/1-'], wires: ['1+/1A', '1B/1-'] }));
    const result = tripped(paths.fixturePath);
    expect(result.failures).toEqual([]);
    expect(() => writeBlessed(result, paths.goldenPath)).toThrow(
      'failed under lamp thermal tau x2: assertion failed at script[2] outLamp1: expected on, got dim');
    expectUnchanged(paths.goldenPath);
  });

  it('ignores perturbed C2 digests but still enforces the base digest on a tripped fixture', () => {
    const source = JSON.parse(readFileSync(new URL('./fixtures/B/II-SELFLOCK.fixture.json', import.meta.url), 'utf8')) as
      { as_printed: string[]; wires: string[]; script: unknown[] };
    const shape = { as_printed: source.as_printed, wires: source.wires };
    const base = runFixture(setup(fixture(source.script, shape)).fixturePath).digest;
    const digests: string[] = [];
    const run = (loaded: LoadedFixture): RunResult => {
      const perturbed = runLoadedFixture(loaded);
      digests.push(JSON.stringify(perturbed.digest));
      return perturbed;
    };

    const good = setup(fixture(source.script, { ...shape, tier: 'C2', digest: base }));
    expect(writeBlessed(tripped(good.fixturePath), good.goldenPath, { run, log: () => undefined }))
      .toBe(good.goldenPath);
    expect(digests).toHaveLength(6);
    expect(digests.some((digest) => digest !== JSON.stringify(base))).toBe(true);

    const wrong = setup(fixture(source.script, {
      ...shape, tier: 'C2', digest: { ...base, eventCount: base.eventCount + 1 },
    }));
    expect(() => writeBlessed(tripped(wrong.fixturePath), wrong.goldenPath, { run, log: () => undefined }))
      .toThrow(/C2 digest differs/);
    expectUnchanged(wrong.goldenPath);
  });
});
