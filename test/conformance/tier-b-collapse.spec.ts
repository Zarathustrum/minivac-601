import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadProfile } from '../../src/core/profile.ts';
import { loadFixture } from './helpers.ts';
import { runFixture, runLoadedFixture } from './run.ts';

const ROOT = resolve('test/conformance/fixtures/B');
const IDS = [
  'I-EXP9', 'II-MANUALMEM', 'II-SELFLOCK', 'II-2BUTTONMEM',
  'II-FF1', 'IV-FF1', 'IV-FF2', 'IV-FF2-CARRY',
] as const;
type Id = (typeof IDS)[number];

const COLLAPSED_FUNCTIONAL = Object.freeze<Record<Exclude<Id, 'II-SELFLOCK'>, readonly object[]>>({
  'I-EXP9': [
    { scriptIndex: 11, dev: 'relay1', expected: 'nc', actual: 'no' },
    { scriptIndex: 11, dev: 'indLamp1', expected: 'off', actual: 'on' },
  ],
  'II-MANUALMEM': [
    { scriptIndex: 8, dev: 'relay1', expected: 'nc', actual: 'no' },
  ],
  'II-2BUTTONMEM': [
    { scriptIndex: 13, dev: 'relay1', expected: 'no', actual: 'nc' },
  ],
  'II-FF1': [
    { scriptIndex: 12, dev: 'outLamp1', expected: 'off', actual: 'on' },
  ],
  'IV-FF1': [
    { scriptIndex: 14, dev: 'outLamp6', expected: 'off', actual: 'on' },
  ],
  'IV-FF2': [
    { scriptIndex: 6, dev: 'relay6', expected: 'no', actual: 'nc' },
    { scriptIndex: 9, dev: 'relay5', expected: 'nc', actual: 'no' },
    { scriptIndex: 9, dev: 'relay6', expected: 'no', actual: 'nc' },
  ],
  'IV-FF2-CARRY': [
    { scriptIndex: 6, dev: 'relay6', expected: 'no', actual: 'nc' },
    { scriptIndex: 9, dev: 'relay5', expected: 'nc', actual: 'no' },
    { scriptIndex: 9, dev: 'relay6', expected: 'no', actual: 'nc' },
  ],
});

function isControlPosition(dev: string): boolean {
  return dev === 'power' || dev === 'breaker' || dev === 'dial' ||
    /^pb[1-6]$/.test(dev) || /^sw[1-6]$/.test(dev);
}

function withoutCollapseSteps(id: Id) {
  const loaded = loadFixture(resolve(ROOT, id + '.fixture.json'));
  const script = loaded.fixture.script.filter((step) => !(step.k === 'do' && step.collapse === true));
  expect(script.length, id).toBeLessThan(loaded.fixture.script.length);
  return runLoadedFixture({ ...loaded, fixture: { ...loaded.fixture, script } });
}

describe('Tier-B release-edge collapse gate', () => {
  it('runs every registered W5a fixture twice without an assertion failure or byte drift', () => {
    const names = IDS.map((id) => id + '.fixture.json');
    expect(readdirSync(ROOT).filter((name) => names.includes(name)).sort()).toEqual(names.sort());
    for (const id of IDS) {
      const path = resolve(ROOT, id + '.fixture.json');
      const first = runFixture(path);
      const second = runFixture(path);
      expect(first.failures, id).toEqual([]);
      expect(second.failures, id).toEqual([]);
      expect(second.trace, id).toBe(first.trace);
      expect(second.metrics, id).toEqual(first.metrics);
      expect(second.digest, id).toEqual(first.digest);
    }
  });

  it('makes every fixture except II-SELFLOCK fail functionally when all releases are deleted', () => {
    for (const id of IDS) {
      const collapsed = withoutCollapseSteps(id);
      const functional = collapsed.failures.filter((failure) => !isControlPosition(failure.dev));
      if (id === 'II-SELFLOCK') expect(functional, id + ' documented control-only exception').toEqual([]);
      else expect(functional, id).toEqual(COLLAPSED_FUNCTIONAL[id]);
    }
  });

  it('uses II-SELFLOCK control position as its collapse witness while output stays latched', () => {
    const collapsed = withoutCollapseSteps('II-SELFLOCK');
    expect(collapsed.failures).toContainEqual({
      scriptIndex: 6,
      dev: 'pb1',
      expected: 'nc',
      actual: 'no',
    });
    expect(collapsed.failures.filter((failure) => !isControlPosition(failure.dev))).toEqual([]);
  });

  it('keeps II-FF1 passing while IV-FF2 fails at the accepted neutralised L_coil value', () => {
    const raw = JSON.parse(readFileSync(resolve('data/profiles/MV601-REF-A.json'), 'utf8')) as {
      values: { L_coil_uh: { v: number } };
    };
    raw.values.L_coil_uh.v = 12_000;
    const neutralised = loadProfile(raw);
    const control = loadFixture(resolve(ROOT, 'II-FF1.fixture.json'));
    expect(runLoadedFixture({ ...control, profile: neutralised }).failures).toEqual([]);

    const witness = loadFixture(resolve(ROOT, 'IV-FF2.fixture.json'));
    const sensitivity = runLoadedFixture({ ...witness, profile: neutralised });
    expect(sensitivity.failures).toEqual([
      { scriptIndex: 7, dev: 'relay5', expected: 'no', actual: 'nc' },
      { scriptIndex: 7, dev: 'relay6', expected: 'no', actual: 'nc' },
      { scriptIndex: 10, dev: 'relay5', expected: 'nc', actual: 'no' },
      { scriptIndex: 10, dev: 'relay6', expected: 'no', actual: 'nc' },
    ]);
  });
});
