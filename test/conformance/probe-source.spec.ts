import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadFixture } from './helpers.ts';
import { loadProbe, runProbe } from './probe.ts';
import type { ProbeDocument } from './probe-types.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const PROBES = resolve(import.meta.dirname, 'probes');

function probe(id: string): ProbeDocument {
  return loadProbe(resolve(PROBES, id + '.probe.json')).probe;
}

function caseInventory(doc: ProbeDocument): unknown[] {
  return doc.cases.map((row) => row.k === 'machine' ? {
    k: row.k,
    name: row.name,
    source: row.source.k === 'fixture'
      ? row.source
      : { k: row.source.k, actionKinds: row.source.actions.map((action) => action.k) },
    checkpoints: row.checkpoints.map((checkpoint) => checkpoint.at),
  } : {
    k: row.k,
    name: row.name,
    diagnostic: row.diagnostic ?? false,
  });
}

function fullCheckArrays(doc: ProbeDocument): string[] {
  return doc.cases.flatMap((row) => row.k === 'machine'
    ? row.checkpoints.map((checkpoint) => JSON.stringify(checkpoint.checks))
    : [JSON.stringify(row.checks)]);
}

function powerMappings(doc: ProbeDocument): unknown {
  return {
    loads: doc.cases.flatMap((row) => row.k === 'profileLoad' ? [row.load.powerLamp] : []),
    substitutions: doc.modeledSubstitutions ?? [],
  };
}

const AT04_BAND = '[{"k":"compare","name":"above-dropout","left":{"k":"relay","n":1,"field":"coilUa"},"op":"gt","right":{"k":"profile","field":"dropOutUa"}},{"k":"compare","name":"below-pullin","left":{"k":"relay","n":1,"field":"coilUa"},"op":"lt","right":{"k":"profile","field":"pullInUa"}}]';

const REGISTERED = {
  'AT-01': {
    sha256: 'b9fff3e048514b38dc6123b06de59f08649deabec95f0c6e7ad38225c0a53d00',
    source: 'BK1 printed p.17 = book1.pdf PDF p.19; components.md §8.2 AT-01',
    inventory: [{ k: 'machine', name: 'i-exp9-latch', source: { k: 'scenario', actionKinds: ['do', 'do', 'settle', 'do', 'settle', 'advance'] }, checkpoints: [{ k: 'action', actionIndex: 5, actionKind: 'advance' }] }],
    checks: ['[{"k":"near","name":"coil-voltage","read":{"k":"terminalPairMv","a":"1E","b":"1F"},"expected":6920,"tolerance":100},{"k":"compare","name":"relay-operated","left":{"k":"relay","n":1,"field":"travel"},"op":"eq","right":{"k":"literal","value":1000}},{"k":"compare","name":"holds-above-dropout","left":{"k":"relay","n":1,"field":"coilUa"},"op":"gt","right":{"k":"relay","n":1,"field":"dropOutUa"}},{"k":"eventSeen","name":"pullin-seen","event":{"k":"relay.pullIn","n":1},"expected":true}]'],
    power: { loads: [], substitutions: [] },
  },
  'AT-04': {
    sha256: '3236a39eca8410a55b886bdec452e7f6e6185c2b3088a64c321d18efd2aadac7',
    source: 'BK7 printed pp.8-9; components.md §8.2 AT-04',
    inventory: ['r180', 'r220', 'r270', 'r330', 'r390', 'r470', 'r120', 'r150'].map((name) => ({
      k: 'machine', name, source: { k: 'scenario', actionKinds: ['do', 'do', 'settle'] },
      checkpoints: [{ k: 'action', actionIndex: 2, actionKind: 'settle' }],
    })),
    checks: [AT04_BAND, AT04_BAND, AT04_BAND, AT04_BAND, AT04_BAND, AT04_BAND,
      '[{"k":"compare","name":"at-or-above-pullin","left":{"k":"relay","n":1,"field":"coilUa"},"op":"ge","right":{"k":"profile","field":"pullInUa"}}]',
      '[{"k":"near","name":"near-nominal-pullin","read":{"k":"relay","n":1,"field":"coilUa"},"expected":43333,"tolerance":200}]'],
    power: { loads: [], substitutions: [] },
  },
  'AT-05': {
    sha256: 'a8d3c5f63e4a9bcb34cf8d37934d8df45a24165def39d4e719abec50a80c4a73',
    source: 'components.md §8.2 AT-05; W1 check-profile load convention',
    inventory: [
      { k: 'profileLoad', name: 'realistic-c-fed', diagnostic: false },
      { k: 'profileLoad', name: 'e-fed-diagnostic', diagnostic: true },
    ],
    checks: [
      '[{"k":"near","name":"settled-load","read":{"k":"load","field":"settledSupplyUa"},"expected":830000,"tolerance":30000},{"k":"compare","name":"below-trip","left":{"k":"load","field":"settledSupplyUa"},"op":"lt","right":{"k":"profile","field":"ITripUa"}}]',
      '[{"k":"near","name":"settled-load","read":{"k":"load","field":"settledSupplyUa"},"expected":1500000,"tolerance":100000},{"k":"compare","name":"inrush-shorter-than-delay","left":{"k":"load","field":"ticksOverTrip"},"op":"lt","right":{"k":"profile","field":"tripDelayTicks"}}]',
    ],
    power: { loads: [
      { k: 'panelLampModelSubstitute', count: 1, status: 'unverified' },
      { k: 'panelLampModelSubstitute', count: 1, status: 'unverified' },
    ], substitutions: [] },
  },
  'AT-06': {
    sha256: '8a18f429fcab7f03f2973bdaf78f9d5c4dfc2b5152b7554daba8c7f224a92cad',
    source: 'components.md §8.2 AT-06; architecture §13.4.3',
    inventory: [{ k: 'machine', name: 'dead-short', source: { k: 'scenario', actionKinds: ['do', 'advance', 'advance'] }, checkpoints: [
      { k: 'action', actionIndex: 1, actionKind: 'advance' }, { k: 'action', actionIndex: 2, actionKind: 'advance' },
    ] }],
    checks: [
      '[{"k":"near","name":"dead-short-current","read":{"k":"state","field":"supplyUa"},"expected":19402985,"tolerance":100000},{"k":"bool","name":"breaker-clear","read":{"k":"stateBool","field":"breakerTripped"},"expected":false}]',
      '[{"k":"bool","name":"breaker-tripped","read":{"k":"stateBool","field":"breakerTripped"},"expected":true},{"k":"compare","name":"rail-zero","left":{"k":"state","field":"railMv"},"op":"eq","right":{"k":"literal","value":0}},{"k":"eventSeen","name":"trip-seen","event":{"k":"breaker.trip"},"expected":true}]',
    ],
    power: { loads: [], substitutions: [] },
  },
  'AT-07': {
    sha256: '827dc9074304710cd374695163527eae3154939f7da21f1930f13fa6ac17b622',
    source: 'BK1 printed pp.14-15 = book1.pdf PDF pp.16-17; components.md §8.2 AT-07',
    inventory: [
      { k: 'machine', name: 'e-fed', source: { k: 'fixture', fixture: 'I-EXP7' }, checkpoints: [{ k: 'fixtureStep', scriptIndex: 5, stepKind: 'advance' }] },
      { k: 'machine', name: 'c-fed', source: { k: 'fixture', fixture: 'I-EXP7' }, checkpoints: [{ k: 'fixtureStep', scriptIndex: 16, stepKind: 'advance' }] },
    ],
    checks: [
      '[{"k":"compare","name":"relay-operated","left":{"k":"relay","n":1,"field":"travel"},"op":"eq","right":{"k":"literal","value":1000}},{"k":"near","name":"indicator-dark","read":{"k":"relay","n":1,"field":"indicatorUa"},"expected":0,"tolerance":10}]',
      '[{"k":"compare","name":"relay-operated","left":{"k":"relay","n":1,"field":"travel"},"op":"eq","right":{"k":"literal","value":1000}},{"k":"compare","name":"indicator-equals-coil","left":{"k":"relay","n":1,"field":"indicatorUa"},"op":"eq","right":{"k":"relay","n":1,"field":"coilUa"}},{"k":"near","name":"indicator-brightness","read":{"k":"lamp","kind":"ind","n":1,"field":"milli"},"expected":749,"tolerance":10},{"k":"compare","name":"indicator-lit","left":{"k":"lamp","kind":"ind","n":1,"field":"milli"},"op":"ge","right":{"k":"literal","value":150}},{"k":"compare","name":"holds-above-dropout","left":{"k":"relay","n":1,"field":"coilUa"},"op":"gt","right":{"k":"relay","n":1,"field":"dropOutUa"}}]',
    ],
    power: { loads: [], substitutions: [] },
  },
  'AT-09': {
    sha256: '41fe7488be4f50398e0a0266c54408983cf7a1d222ec87ad0d369ead8ea4c71a',
    source: 'components.md §7.2 and §8.2 AT-09',
    inventory: [{ k: 'machine', name: 'trip-and-reset', source: { k: 'scenario', actionKinds: ['do', 'advance', 'do', 'do', 'settle'] }, checkpoints: [
      { k: 'action', actionIndex: 1, actionKind: 'advance' }, { k: 'action', actionIndex: 4, actionKind: 'settle' },
    ] }],
    checks: [
      '[{"k":"bool","name":"breaker-tripped","read":{"k":"stateBool","field":"breakerTripped"},"expected":true},{"k":"compare","name":"rail-zero","left":{"k":"state","field":"railMv"},"op":"eq","right":{"k":"literal","value":0}}]',
      '[{"k":"bool","name":"breaker-clear","read":{"k":"stateBool","field":"breakerTripped"},"expected":false},{"k":"compare","name":"rail-positive","left":{"k":"state","field":"railMv"},"op":"gt","right":{"k":"literal","value":0}}]',
    ],
    power: { loads: [], substitutions: [{
      k: 'modeledObservableSubstitution',
      claim: 'Breaker trip extinguishes the POWER lamp until reset',
      model: 'breakerTripped && railMv == 0; after reset !breakerTripped && railMv > 0',
      status: 'unverified', sourceEquivalent: false,
    }] },
  },
  'AT-10': {
    sha256: '93edb07c405166af39921b52a86ce6b597693de952750b529ca2e7cf88a2535a',
    source: 'BK1 printed p.22 = book1.pdf PDF p.24; components.md §8.2 AT-10',
    inventory: [
      { k: 'machine', name: 'stop-short', source: { k: 'scenario', actionKinds: ['do', 'settle'] }, checkpoints: [{ k: 'action', actionIndex: 1, actionKind: 'settle' }] },
      { k: 'machine', name: 'dead-short', source: { k: 'scenario', actionKinds: ['do', 'advance'] }, checkpoints: [{ k: 'action', actionIndex: 1, actionKind: 'advance' }] },
    ],
    checks: [
      '[{"k":"near","name":"limited-current","read":{"k":"state","field":"supplyUa"},"expected":550000,"tolerance":50000},{"k":"compare","name":"below-trip","left":{"k":"state","field":"supplyUa"},"op":"lt","right":{"k":"profile","field":"ITripUa"}},{"k":"bool","name":"breaker-clear","read":{"k":"stateBool","field":"breakerTripped"},"expected":false}]',
      '[{"k":"bool","name":"breaker-tripped","read":{"k":"stateBool","field":"breakerTripped"},"expected":true},{"k":"eventSeen","name":"trip-seen","event":{"k":"breaker.trip"},"expected":true}]',
    ],
    power: { loads: [], substitutions: [] },
  },
  'AT-11': {
    sha256: '49aa88a243e8093bcce94d774c3d7fb0136637302865c60cd82f27f585041b3e',
    source: 'BK1 printed p.16 step 5 = book1.pdf PDF p.18; components.md §8.3',
    inventory: [{ k: 'machine', name: 'all-six-relays', source: { k: 'fixture', fixture: 'I-EXP8-STEP5' }, checkpoints: [{ k: 'fixtureStep', scriptIndex: 2, stepKind: 'settle' }] }],
    checks: [JSON.stringify([
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ k: 'eventSeen', name: 'relay' + n + '-pullin', event: { k: 'relay.pullIn', n }, expected: true })),
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ k: 'compare', name: 'relay' + n + '-operated', left: { k: 'relay', n, field: 'travel' }, op: 'eq', right: { k: 'literal', value: 1000 } })),
      ...[1, 2, 3, 4, 5, 6].map((n) => ({ k: 'compare', name: 'relay' + n + '-holds', left: { k: 'relay', n, field: 'coilUa' }, op: 'gt', right: { k: 'relay', n, field: 'dropOutUa' } })),
    ])],
    power: { loads: [], substitutions: [] },
  },
} as const;

type RegisteredId = keyof typeof REGISTERED;

function assertRegisteredProbeIntegrity(id: RegisteredId, path = resolve(PROBES, id + '.probe.json')): void {
  const bytes = readFileSync(path);
  const actualHash = createHash('sha256').update(bytes).digest('hex');
  const pin = REGISTERED[id];
  if (actualHash !== pin.sha256) throw new Error(id + ' SHA-256 mismatch: ' + actualHash);
  const doc = loadProbe(path).probe;
  const comparisons: [string, unknown, unknown][] = [
    ['id', doc.id, id], ['source', doc.source, pin.source],
    ['case/scope/checkpoint inventory', caseInventory(doc), pin.inventory],
    ['full check arrays', fullCheckArrays(doc), pin.checks],
    ['POWER mappings', powerMappings(doc), pin.power],
  ];
  for (const [what, actual, expected] of comparisons) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(id + ' ' + what + ' mismatch');
  }
}

describe('Wave 4b probe source pins', () => {
  it('binds every registered id to its raw bytes and complete frozen semantics', () => {
    for (const id of Object.keys(REGISTERED) as RegisteredId[]) {
      expect(() => assertRegisteredProbeIntegrity(id), id).not.toThrow();
    }
  });

  it('rejects an unrelated passing document relabeled as AT-06 at the owning integrity gate', () => {
    const replacement = structuredClone(probe('AT-10'));
    replacement.id = 'AT-06';
    replacement.source = REGISTERED['AT-06'].source;
    const root = mkdtempSync(join(tmpdir(), 'mv601-probe-integrity-'));
    const path = join(root, 'AT-06.probe.json');
    try {
      writeFileSync(path, JSON.stringify(replacement) + '\n');
      expect(runProbe(path).pass).toBe(true);
      expect(() => assertRegisteredProbeIntegrity('AT-06', path)).toThrow(/AT-06 SHA-256 mismatch/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('pins the registered acceptance rows in the canonical research', () => {
    const components = readFileSync(resolve(ROOT, 'docs/research/components.md'), 'utf8');
    for (const id of ['AT-01', 'AT-04', 'AT-05', 'AT-06', 'AT-07', 'AT-09', 'AT-10']) {
      expect(components, id).toContain('| ' + id + ' |');
    }
    expect(components).toContain('all six relays at once');
    expect(components).toContain('Book I Experiment 8 step 5');
  });

  it('pins AT-01 to the exact six-wire I-EXP9 stamp and a stabilized analog checkpoint', () => {
    const row = probe('AT-01').cases[0];
    expect(row?.k).toBe('machine');
    if (row?.k !== 'machine' || row.source.k !== 'scenario') return;
    expect(row.source.wires).toEqual(['1F/1-', '1C/1X', '1Y/2Y', '2Y/2+', '2Z/1L', '1K/1C']);
    expect(row.source.actions.at(-1)).toEqual({ k: 'advance', ticks: 2000 });
    expect(row.checkpoints[0]?.at).toEqual({ k: 'action', actionIndex: 5, actionKind: 'advance' });

    const raw = JSON.parse(readFileSync(resolve(ROOT, 'data/profiles/MV601-REF-A.json'), 'utf8')) as {
      values: { tick_us: { v: number }; lamp_thermal_tau_us: { v: number } };
    };
    expect(2000 * raw.values.tick_us.v).toBe(5 * raw.values.lamp_thermal_tau_us.v);
  });

  it('pins AT-04 resistor membership and AT-05 diagnostic/substitution policy', () => {
    const at04 = probe('AT-04');
    expect(at04.cases.map((row) => row.name)).toEqual(['r180', 'r220', 'r270', 'r330', 'r390', 'r470', 'r120', 'r150']);
    const resistances = at04.cases.map((row) => {
      if (row.k !== 'machine' || row.source.k !== 'scenario') return -1;
      const action = row.source.actions[0];
      return action?.k === 'do' && action.cmd.k === 'connect' ? action.cmd.r_uohm : -1;
    });
    expect(resistances).toEqual([180, 220, 270, 330, 390, 470, 120, 150].map((ohm) => ohm * 1_000_000));

    const at05 = probe('AT-05');
    expect(at05.cases[0]).toMatchObject({
      k: 'profileLoad',
      load: { feed: 'C', outputLamps: 6, indicatorLamps: 'series-with-coils', powerLamp: { k: 'panelLampModelSubstitute', status: 'unverified' } },
    });
    expect('diagnostic' in (at05.cases[0] as object)).toBe(false);
    expect(at05.cases[1]).toMatchObject({
      k: 'profileLoad', diagnostic: true,
      load: { feed: 'E', outputLamps: 6, indicatorLamps: 'across-rail', powerLamp: { k: 'panelLampModelSubstitute', status: 'unverified' } },
    });
  });

  it('pins the fixture ids, exact checkpoint indexes, compound cases and POWER mapping', () => {
    const at07 = probe('AT-07');
    expect(at07.cases.map((row) => row.k === 'machine' ? row.source : null)).toEqual([
      { k: 'fixture', fixture: 'I-EXP7' }, { k: 'fixture', fixture: 'I-EXP7' },
    ]);
    expect(at07.cases.map((row) => row.k === 'machine' ? row.checkpoints[0]?.at : null)).toEqual([
      { k: 'fixtureStep', scriptIndex: 5, stepKind: 'advance' },
      { k: 'fixtureStep', scriptIndex: 16, stepKind: 'advance' },
    ]);

    const at09 = probe('AT-09');
    expect(at09.modeledSubstitutions).toEqual([expect.objectContaining({
      k: 'modeledObservableSubstitution', status: 'unverified', sourceEquivalent: false,
    })]);
    expect(probe('AT-10').cases.map((row) => row.name)).toEqual(['stop-short', 'dead-short']);

    const at11 = probe('AT-11').cases[0];
    expect(at11).toMatchObject({
      k: 'machine', source: { k: 'fixture', fixture: 'I-EXP8-STEP5' },
      checkpoints: [{ at: { k: 'fixtureStep', scriptIndex: 2, stepKind: 'settle' } }],
    });
  });

  it('pins the two fixture dependencies at the addressed source steps', () => {
    const fixtureRoot = resolve(import.meta.dirname, 'fixtures/A');
    const exp7 = loadFixture(resolve(fixtureRoot, 'I-EXP7.fixture.json')).fixture;
    expect(exp7.source).toBe('BK1 printed pp.14-15 = book1.pdf PDF pp.16-17');
    expect(exp7.wires).toEqual([
      '1+/1H', '1J/2A', '1B/1-', '1G/1A', '2B/2-', '1+/1Y', '1X/1E', '1F/1-',
    ]);
    expect(exp7.script[5]).toEqual({ k: 'advance', ms: 30 });
    expect(exp7.script[16]).toEqual({ k: 'advance', ms: 30 });

    const exp8 = loadFixture(resolve(fixtureRoot, 'I-EXP8-STEP5.fixture.json')).fixture;
    expect(exp8.source).toBe('BK1 printed p.16 step 5 = book1.pdf PDF p.18');
    expect(exp8.wires).toHaveLength(21);
    expect(exp8.script[2]).toEqual({ k: 'settle', maxMs: 500 });
  });
});
