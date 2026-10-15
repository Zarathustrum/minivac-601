import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import type { State } from '../../src/core/contract.ts';
import { assertProbePortable, loadProbe, runProbe } from './probe.ts';

const PROBE_ROOT = resolve(import.meta.dirname, 'probes');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeProbe(value: unknown, bytes?: Uint8Array | string): string {
  const root = mkdtempSync(join(tmpdir(), 'mv601-probe-run-'));
  roots.push(root);
  const path = join(root, 'case.probe.json');
  writeFileSync(path, bytes ?? JSON.stringify(value) + '\n');
  return path;
}

function scenario(checks: unknown[], actions: unknown[] = [
  { k: 'do', cmd: { k: 'power', on: true } },
  { k: 'advance', ticks: 1 },
]): Record<string, unknown> {
  return {
    schema: 'minivac.probe/1', id: 'AT-06', source: 'runner test', profile: 'MV601-REF-A',
    cases: [{
      k: 'machine', name: 'case', source: { k: 'scenario', wires: ['1+/1A'], actions },
      checkpoints: [{
        name: 'checkpoint',
        at: { k: 'action', actionIndex: actions.length - 1, actionKind: (actions.at(-1) as { k: string }).k },
        checks,
      }],
    }],
  };
}

function numericMeasurements(result: ReturnType<typeof runProbe>): Record<string, number | [number, number]> {
  const values: Record<string, number | [number, number]> = {};
  for (const row of result.cases) {
    const checkpoints = row.k === 'machine'
      ? row.checkpoints
      : [{ name: 'profile', checks: row.checks }];
    for (const checkpoint of checkpoints) {
      for (const check of checkpoint.checks) {
        const key = row.name + '/' + checkpoint.name + '/' + check.name;
        if (check.k === 'near') values[key] = check.actual;
        else if (check.k === 'compare') values[key] = [check.left, check.right];
      }
    }
  }
  return values;
}

describe('probe execution', () => {
  it('strictly validates root, nested, UTF-8 and exact command shapes', () => {
    const base = scenario([{
      k: 'near', name: 'rail', read: { k: 'state', field: 'railMv' }, expected: 13_000, tolerance: 0,
    }]);
    expect(() => loadProbe(writeProbe(base))).not.toThrow();

    for (const key of ['schema', 'id', 'source', 'profile', 'cases']) {
      const value = structuredClone(base);
      delete value[key];
      expect(() => loadProbe(writeProbe(value)), key).toThrow(/schema validation failed/);
    }
    const rootUnknown = structuredClone(base);
    rootUnknown['extra'] = true;
    expect(() => loadProbe(writeProbe(rootUnknown))).toThrow(/schema validation failed/);

    const nestedUnknown = structuredClone(base);
    const row = (nestedUnknown['cases'] as Record<string, unknown>[])[0]!;
    const actions = ((row['source'] as Record<string, unknown>)['actions'] as Record<string, unknown>[]);
    actions[0]!['extra'] = true;
    expect(() => loadProbe(writeProbe(nestedUnknown))).toThrow(/schema validation failed/);

    const badCommand = structuredClone(base);
    const badActions = ((((badCommand['cases'] as Record<string, unknown>[])[0]!['source']) as Record<string, unknown>)['actions'] as Record<string, unknown>[]);
    (badActions[0]!['cmd'] as Record<string, unknown>)['k'] = 'tick';
    expect(() => loadProbe(writeProbe(badCommand))).toThrow(/schema validation failed/);

    expect(() => loadProbe(writeProbe({}, new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0a])))).toThrow(/BOM/);
    expect(() => loadProbe(writeProbe({}, '{}\r\n'))).toThrow(/contains CR/);
    expect(() => loadProbe(writeProbe({}, new Uint8Array([0xc3, 0x28])))).toThrow(/not valid UTF-8/);
    const surrogate = structuredClone(base);
    surrogate['source'] = '\ud800';
    expect(() => loadProbe(writeProbe(surrogate))).toThrow(/unpaired high surrogate/);

    for (const control of ['\u0000', '\u0009', '\u001f']) {
      const escapedControl = structuredClone(base);
      escapedControl['source'] = 'source' + control;
      expect(() => loadProbe(writeProbe(escapedControl)), JSON.stringify(control)).toThrow(/schema validation failed/);
    }

    const substitutionBase = structuredClone(base);
    substitutionBase['modeledSubstitutions'] = [{
      k: 'modeledObservableSubstitution', claim: 'claim', model: 'model',
      status: 'unverified', sourceEquivalent: false,
    }];
    for (const field of ['claim', 'model']) {
      const escapedControl = structuredClone(substitutionBase);
      ((escapedControl['modeledSubstitutions'] as Record<string, unknown>[])[0] as Record<string, unknown>)[field] = 'text\u0000';
      expect(() => loadProbe(writeProbe(escapedControl)), field + ' control').toThrow(/schema validation failed/);

      const unpaired = structuredClone(substitutionBase);
      ((unpaired['modeledSubstitutions'] as Record<string, unknown>[])[0] as Record<string, unknown>)[field] = '\udc00';
      expect(() => loadProbe(writeProbe(unpaired)), field + ' surrogate').toThrow(/unpaired low surrogate/);
    }
  });

  it('validates unique names, source scope and exact index+kind checkpoint identity', () => {
    const base = scenario([{
      k: 'near', name: 'rail', read: { k: 'state', field: 'railMv' }, expected: 13_000, tolerance: 0,
    }]);
    const wrongKind = structuredClone(base);
    const row = (wrongKind['cases'] as Record<string, unknown>[])[0]!;
    const checkpoint = (row['checkpoints'] as Record<string, unknown>[])[0]!;
    (checkpoint['at'] as Record<string, unknown>)['actionKind'] = 'settle';
    expect(() => loadProbe(writeProbe(wrongKind))).toThrow(/expected action\[1\]=settle, got advance/);

    const duplicate = structuredClone(base);
    (duplicate['cases'] as unknown[]).push(structuredClone((duplicate['cases'] as unknown[])[0]));
    expect(() => loadProbe(writeProbe(duplicate))).toThrow(/duplicate name/);

    const wrongScope = structuredClone(base);
    const wrongRow = (wrongScope['cases'] as Record<string, unknown>[])[0]!;
    const wrongCheck = ((wrongRow['checkpoints'] as Record<string, unknown>[])[0]!['checks'] as Record<string, unknown>[])[0]!;
    wrongCheck['read'] = { k: 'load', field: 'settledSupplyUa' };
    expect(() => loadProbe(writeProbe(wrongScope))).toThrow(/wrong execution scope/);

    const badWire = structuredClone(base);
    ((badWire['cases'] as Record<string, unknown>[])[0]!['source'] as Record<string, unknown>)['wires'] = ['NOT-A-WIRE'];
    expect(() => loadProbe(writeProbe(badWire))).toThrow(/not physical/);

    const badProfileLoad = structuredClone(base);
    badProfileLoad['cases'] = [{
      k: 'profileLoad', name: 'load',
      load: { coils: 6, feed: 'C', outputLamps: 6, indicatorLamps: 'across-rail', powerLamp: { k: 'panelLampModelSubstitute', count: 1, status: 'unverified' } },
      checks: [{ k: 'compare', name: 'below', left: { k: 'load', field: 'settledSupplyUa' }, op: 'lt', right: { k: 'profile', field: 'ITripUa' } }],
    }];
    expect(() => loadProbe(writeProbe(badProfileLoad))).toThrow(/C feed requires series-with-coils/);
  });

  it('runs every registered document green and keeps a representative mixed-scope run deterministic', () => {
    const names = ['AT-01', 'AT-04', 'AT-05', 'AT-06', 'AT-07', 'AT-09', 'AT-10', 'AT-11'];
    let at05Bytes = '';
    for (const id of names) {
      const path = resolve(PROBE_ROOT, id + '.probe.json');
      const first = runProbe(path);
      expect(first.pass, id).toBe(true);
      expect(first.id).toBe(id);
      expect(first.schema).toBe('minivac.probe-result/1');
      expect(first).not.toHaveProperty('trace');
      if (id === 'AT-05') at05Bytes = JSON.stringify(first);
    }
    expect(JSON.stringify(runProbe(resolve(PROBE_ROOT, 'AT-05.probe.json')))).toBe(at05Bytes);
  });

  it('pins every registered numeric measurement independently of its acceptance tolerance', () => {
    const expected: Record<string, Record<string, number | [number, number]>> = {
      'AT-01': {
        'i-exp9-latch/latched-after-release/coil-voltage': 6933,
        'i-exp9-latch/latched-after-release/relay-operated': [1000, 1000],
        'i-exp9-latch/latched-after-release/holds-above-dropout': [46221, 14787],
      },
      'AT-04': {
        'r180/settled/above-dropout': [39148, 16667], 'r180/settled/below-pullin': [39148, 43333],
        'r220/settled/above-dropout': [34994, 16667], 'r220/settled/below-pullin': [34994, 43333],
        'r270/settled/above-dropout': [30873, 16667], 'r270/settled/below-pullin': [30873, 43333],
        'r330/settled/above-dropout': [27035, 16667], 'r330/settled/below-pullin': [27035, 43333],
        'r390/settled/above-dropout': [24041, 16667], 'r390/settled/below-pullin': [24041, 43333],
        'r470/settled/above-dropout': [20944, 16667], 'r470/settled/below-pullin': [20944, 43333],
        'r120/settled/at-or-above-pullin': [48024, 43333],
        'r150/settled/near-nominal-pullin': 43236,
      },
      'AT-05': {
        'realistic-c-fed/profile/settled-load': 818779,
        'realistic-c-fed/profile/below-trip': [818779, 1500000],
        'e-fed-diagnostic/profile/settled-load': 1476564,
        'e-fed-diagnostic/profile/inrush-shorter-than-delay': [1005, 2000],
      },
      'AT-06': {
        'dead-short/first-boundary/dead-short-current': 19402985,
        'dead-short/trip-boundary/rail-zero': [0, 0],
      },
      'AT-07': {
        'e-fed/after-e-fed/relay-operated': [1000, 1000],
        'e-fed/after-e-fed/indicator-dark': 0,
        'c-fed/after-c-fed/relay-operated': [1000, 1000],
        'c-fed/after-c-fed/indicator-equals-coil': [47217, 47217],
        'c-fed/after-c-fed/indicator-brightness': 749,
        'c-fed/after-c-fed/indicator-lit': [749, 150],
        'c-fed/after-c-fed/holds-above-dropout': [47217, 14787],
      },
      'AT-09': {
        'trip-and-reset/power-substitute-off/rail-zero': [0, 0],
        'trip-and-reset/power-substitute-restored/rail-positive': [13000, 0],
      },
      'AT-10': {
        'stop-short/settled/limited-current': 573445,
        'stop-short/settled/below-trip': [573445, 1500000],
      },
      'AT-11': {
        'all-six-relays/after-step5-settle/relay1-operated': [1000, 1000],
        'all-six-relays/after-step5-settle/relay2-operated': [1000, 1000],
        'all-six-relays/after-step5-settle/relay3-operated': [1000, 1000],
        'all-six-relays/after-step5-settle/relay4-operated': [1000, 1000],
        'all-six-relays/after-step5-settle/relay5-operated': [1000, 1000],
        'all-six-relays/after-step5-settle/relay6-operated': [1000, 1000],
        'all-six-relays/after-step5-settle/relay1-holds': [45961, 14787],
        'all-six-relays/after-step5-settle/relay2-holds': [46146, 15540],
        'all-six-relays/after-step5-settle/relay3-holds': [46423, 16293],
        'all-six-relays/after-step5-settle/relay4-holds': [46842, 17040],
        'all-six-relays/after-step5-settle/relay5-holds': [47486, 17793],
        'all-six-relays/after-step5-settle/relay6-holds': [48500, 18547],
      },
    };
    for (const [id, pins] of Object.entries(expected)) {
      expect(numericMeasurements(runProbe(resolve(PROBE_ROOT, id + '.probe.json'))), id).toEqual(pins);
    }
  });

  it('evaluates inclusive tolerance and all exact ordered relations at their boundaries', () => {
    const checks = [
      { k: 'near', name: 'near-pass', read: { k: 'state', field: 'railMv' }, expected: 12_999, tolerance: 1 },
      { k: 'near', name: 'near-fail', read: { k: 'state', field: 'railMv' }, expected: 12_998, tolerance: 1 },
      { k: 'compare', name: 'lt', left: { k: 'state', field: 'railMv' }, op: 'lt', right: { k: 'literal', value: 13_001 } },
      { k: 'compare', name: 'le', left: { k: 'state', field: 'railMv' }, op: 'le', right: { k: 'literal', value: 13_000 } },
      { k: 'compare', name: 'eq', left: { k: 'state', field: 'railMv' }, op: 'eq', right: { k: 'literal', value: 13_000 } },
      { k: 'compare', name: 'ge', left: { k: 'state', field: 'railMv' }, op: 'ge', right: { k: 'literal', value: 13_000 } },
      { k: 'compare', name: 'gt', left: { k: 'state', field: 'railMv' }, op: 'gt', right: { k: 'literal', value: 12_999 } },
    ];
    const result = runProbe(writeProbe(scenario(checks)));
    const row = result.cases[0];
    if (row?.k !== 'machine') return;
    expect(row.checkpoints[0]?.checks.map((check) => check.pass)).toEqual([true, false, true, true, true, true, true]);
    expect(result.pass).toBe(false);
  });

  it('fails rather than comparing a floating terminal read', () => {
    const value = scenario([{
      k: 'near', name: 'floating', read: { k: 'terminalPairMv', a: '1A', b: '1B' },
      expected: 0, tolerance: 0,
    }], [{ k: 'advance', ticks: 1 }]);
    (value['cases'] as Record<string, unknown>[])[0]!['source'] = {
      k: 'scenario', wires: ['1A/1B'], actions: [{ k: 'advance', ticks: 1 }],
    };
    expect(() => runProbe(writeProbe(value))).toThrow(/terminalPairMv read is floating/);
  });

  it('fails on settle-cap exhaustion, rejected commands and non-portable state', () => {
    const cap = scenario([{ k: 'bool', name: 'clear', read: { k: 'stateBool', field: 'breakerTripped' }, expected: false }], [
      { k: 'do', cmd: { k: 'button', n: 1, target: 1000 } }, { k: 'settle', maxTicks: 1 },
    ]);
    expect(() => runProbe(writeProbe(cap))).toThrow(/settle exhausted its cap/);

    const rejected = scenario([{ k: 'bool', name: 'clear', read: { k: 'stateBool', field: 'breakerTripped' }, expected: false }], [
      { k: 'do', cmd: { k: 'disconnect', cord: 255 } },
    ]);
    expect(() => runProbe(writeProbe(rejected))).toThrow(/scenario command rejected: unknown_cord/);

    expect(() => assertProbePortable({ flags: { nonPortable: true } as State['flags'] })).toThrow(/non-portable/);
    expect(() => assertProbePortable({ flags: { nonPortable: false } as State['flags'] })).not.toThrow();
  });

  it('refuses to replay a fixture until step rather than skipping its ticks', () => {
    const root = mkdtempSync(join(tmpdir(), 'mv601-probe-until-'));
    roots.push(root);
    const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/A/I-EXP8-STEP5.fixture.json'), 'utf8')) as {
      script: Record<string, unknown>[];
    };
    const expectStep = fixture.script[3]!;
    fixture.script[2] = {
      k: 'until', obs: expectStep['obs'], maxMs: 500, cite: expectStep['cite'], quote: expectStep['quote'],
    };
    writeFileSync(join(root, 'I-EXP8-STEP5.fixture.json'), JSON.stringify(fixture) + '\n');
    const probe = {
      schema: 'minivac.probe/1', id: 'AT-11', source: 'runner test', profile: 'MV601-REF-A',
      cases: [{
        k: 'machine', name: 'until-replay', source: { k: 'fixture', fixture: 'I-EXP8-STEP5' },
        checkpoints: [{
          name: 'after-expect', at: { k: 'fixtureStep', scriptIndex: 3, stepKind: 'expect' },
          checks: [{ k: 'bool', name: 'clear', read: { k: 'stateBool', field: 'breakerTripped' }, expected: false }],
        }],
      }],
    };
    expect(() => runProbe(writeProbe(probe), root)).toThrow('probe: fixture replay does not support until steps');
  });

  it('keeps probe execution outside trace, blessing and golden code paths', () => {
    const source = readFileSync(new URL('./probe.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from ['"]\.\/bless\.ts['"]/u);
    expect(source).not.toMatch(/from ['"]\.\/run\.ts['"]/u);
    expect(source).not.toMatch(/formatTrace|writeBlessed|golden\//u);
    expect(loadProbe(resolve(PROBE_ROOT, 'AT-05.probe.json')).probe.schema).toBe('minivac.probe/1');
  });
});
