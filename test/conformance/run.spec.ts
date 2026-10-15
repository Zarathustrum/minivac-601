import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import refJson from '../../data/profiles/MV601-REF-A.json';
import { loadProfile } from '../../src/core/profile.ts';
import { contactAt } from '../../src/core/rotary.ts';
import { formatFallbacks, listFallbacks, runFixture } from './run.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(script: unknown[], id = 'RUN-CASE'): Record<string, unknown> {
  return {
    schema: 'minivac.fixture/1',
    id,
    source: 'runner test',
    tier: 'A',
    confidence: 'verified',
    profile: 'MV601-REF-A',
    contract: '1.1.0',
    as_printed: ['A/B'],
    errata_applied: [],
    wires: ['1A/1B'],
    script,
  };
}

function writeFixture(value: unknown, directory?: string): string {
  const root = directory ?? mkdtempSync(join(tmpdir(), 'mv601-run-'));
  if (directory === undefined) roots.push(root);
  mkdirSync(root, { recursive: true });
  const path = join(root, String((value as Record<string, unknown>)['id']) + '.fixture.json');
  writeFileSync(path, JSON.stringify(value) + '\n');
  return path;
}

describe('fixture execution and trace bytes', () => {
  it('queues initial wiring into the first boundary without tracing authoring commands', () => {
    const path = writeFixture(fixture([
      { k: 'do', cmd: { k: 'power', on: true } },
      { k: 'advance', ms: 1 },
      {
        k: 'expect',
        obs: [{ dev: 'power', v: 'on' }, { dev: 'breaker', v: 'ok' }],
        cite: 'runner test',
        quote: 'Power is on.',
      },
    ]));
    const result = runFixture(path);
    expect(result.failures).toEqual([]);
    expect(result.digest.eventCount).toBe(1);
    expect(result.trace).toContain('#!mv601-trace 1\n');
    expect(result.trace).toContain('# id=RUN-CASE contract=1.1.0 netlist=fnv1a64:');
    expect(result.trace).toContain('wires=1\n');
    expect(result.trace).toContain('     0.0 > power on\n     0.0 * power off->on\n');
    expect(result.trace).toContain('     1.0 ? power=on breaker=ok  "Power is on."\n');
    expect(result.trace).not.toContain('> connect');
    expect(result.trace.endsWith('\n')).toBe(true);
    expect(result.trace).not.toContain('\r');
    expect(runFixture(path).trace).toBe(result.trace);
  });

  it('preserves same-tick action order and renders projections in frozen order', () => {
    const result = runFixture(writeFixture(fixture([
      { k: 'do', cmd: { k: 'power', on: true } },
      {
        k: 'expect',
        obs: [{ dev: 'indLamp6', v: 'off' }, { dev: 'power', v: 'off' }],
        cite: 'runner test',
        quote: 'A \\ and a " quote.',
      },
    ])));
    expect(result.trace).toContain(
      '     0.0 > power on\n     0.0 ? power=off indLamp6=off  "A \\\\ and a \\" quote."\n',
    );
  });

  it('preserves a valid astral quote as exact UTF-8 trace bytes', () => {
    const result = runFixture(writeFixture(fixture([{
      k: 'expect',
      obs: [{ dev: 'power', v: 'off' }],
      cite: 'runner test',
      quote: 'Astral 🚀 quote.',
    }], 'ASTRAL-BYTES')));
    const expectedTail = Buffer.from('     0.0 ? power=off  "Astral 🚀 quote."\n', 'utf8');
    const bytes = Buffer.from(result.trace, 'utf8');
    expect(bytes.subarray(bytes.length - expectedTail.length)).toEqual(expectedTail);
    expect(bytes.includes(Buffer.from([0xf0, 0x9f, 0x9a, 0x80]))).toBe(true);
    expect(bytes.includes(Buffer.from([0xef, 0xbf, 0xbd]))).toBe(false);
  });

  it('renders and asserts dial=gap instead of treating encoding -1 as absence', () => {
    const profile = loadProfile(refJson);
    let gap = -1;
    for (let udeg = 0; udeg < 22_500_000; udeg += 1000) {
      if (contactAt(udeg, profile) === null) {
        gap = udeg;
        break;
      }
    }
    expect(gap).toBeGreaterThanOrEqual(0);
    const result = runFixture(writeFixture(fixture([
      { k: 'do', cmd: { k: 'dialGrab', targetUdeg: gap } },
      { k: 'advance', ms: 200 },
      { k: 'expect', obs: [{ dev: 'dial', v: 'gap' }], cite: 'runner test', quote: 'The wiper is in a gap.' },
    ])));
    expect(result.failures).toEqual([]);
    expect(result.trace).toContain('? dial=gap  "The wiper is in a gap."');
  });

  it('uses motionMask during settle and emits no-settle after final-boundary output', () => {
    const result = runFixture(writeFixture(fixture([
      { k: 'do', cmd: { k: 'button', n: 1, target: 1000 } },
      { k: 'settle', maxMs: 1 },
    ])));
    const lines = result.trace.trimEnd().split('\n');
    expect(lines.at(-1)).toBe('     0.9 ! no settle in 1.0ms');
    expect(result.digest.moverTransitions[6]).toBe(0);
  });

  it('emits a final-boundary switch transition before the settle-cap anomaly', () => {
    const result = runFixture(writeFixture(fixture([
      { k: 'do', cmd: { k: 'switch', n: 1, target: 1000 } },
      { k: 'settle', maxMs: 27 },
    ], 'CAP-ORDER')));
    const lines = result.trace.trimEnd().split('\n');
    expect(lines.slice(-2)).toEqual([
      '    26.9 * sw1 nc->mid',
      '    26.9 ! no settle in 27.0ms',
    ]);
  });

  it('keeps fixed advance distinct from data-dependent settle', () => {
    const prefix = [{ k: 'do', cmd: { k: 'button', n: 1, target: 1000 } }];
    const fixed = runFixture(writeFixture(fixture([
      ...prefix,
      { k: 'advance', ms: 5 },
      { k: 'expect', obs: [{ dev: 'pb1', v: 'nc' }], cite: 'x', quote: 'Fixed hold.' },
    ], 'FIXED-ADVANCE')));
    const settled = runFixture(writeFixture(fixture([
      ...prefix,
      { k: 'settle', maxMs: 100 },
      { k: 'expect', obs: [{ dev: 'pb1', v: 'no' }], cite: 'x', quote: 'Settled move.' },
    ], 'DATA-SETTLE')));
    expect(fixed.failures).toEqual([]);
    expect(settled.failures).toEqual([]);
    expect(fixed.trace).toContain('     5.0 ? pb1=nc');
    expect(settled.trace).toContain('    44.9 ? pb1=no');
    expect(fixed.trace).not.toBe(settled.trace);
  });

  it('distinguishes a fixed 40ms hold from a fixed 5ms tap without settle', () => {
    const hold = runFixture(writeFixture(fixture([
      { k: 'do', cmd: { k: 'button', n: 1, target: 1000 } },
      { k: 'advance', ms: 40 },
      { k: 'expect', obs: [{ dev: 'pb1', v: 'no' }], cite: 'x', quote: 'Held forty milliseconds.' },
    ], 'FIXED-HOLD-40')));
    const tap = runFixture(writeFixture(fixture([
      { k: 'do', cmd: { k: 'button', n: 1, target: 1000 } },
      { k: 'advance', ms: 5 },
      { k: 'do', cmd: { k: 'button', n: 1, target: 0 } },
      { k: 'advance', ms: 35 },
      { k: 'expect', obs: [{ dev: 'pb1', v: 'nc' }], cite: 'x', quote: 'Tapped for five milliseconds.' },
    ], 'FIXED-TAP-5')));
    expect(hold.failures).toEqual([]);
    expect(tap.failures).toEqual([]);
    expect(hold.trace).toContain('    40.0 ? pb1=no');
    expect(tap.trace).toContain('     5.0 > button1 target=0');
    expect(tap.trace).toContain('    40.0 ? pb1=nc');
    expect(hold.trace).not.toBe(tap.trace);
  });

  it('settles the dial from contact only, not held angle or motor motion', () => {
    const result = runFixture(writeFixture(fixture([
      { k: 'do', cmd: { k: 'dialGrab', targetUdeg: 8_000_000 } },
      { k: 'settle', maxMs: 100 },
      { k: 'expect', obs: [{ dev: 'dial', v: 'c0' }], cite: 'x', quote: 'Still on contact zero.' },
    ], 'DIAL-CONTACT-ONLY')));
    expect(result.failures).toEqual([]);
    expect(result.trace).toContain('    20.0 ? dial=c0  "Still on contact zero."');
    expect(result.trace).not.toContain('no settle');
  });

  it('keeps epoch-reset timestamps in action order and resets per-index gap history', () => {
    const result = runFixture(writeFixture(fixture([
      { k: 'do', cmd: { k: 'power', on: true } },
      { k: 'advance', ms: 1 },
      { k: 'do', cmd: { k: 'power', on: false } },
      { k: 'advance', ms: 1 },
      { k: 'do', cmd: { k: 'power', on: true } },
      { k: 'advance', ms: 1 },
    ])));
    const transitions = result.trace.split('\n').filter((line) => line.includes(' * power '));
    expect(transitions).toEqual([
      '     0.0 * power off->on',
      '     1.0 * power on->off',
      '     0.0 * power off->on',
    ]);
    expect(result.metrics.minTickGap).toBe(10);
  });

  it('derives every rules-header family from the loaded profile', () => {
    const result = runFixture(writeFixture(fixture([{ k: 'advance', ms: 1 }])));
    expect(result.trace).toContain(
      '# rules settleTicks=200 chatterN=8 relayWinTicks=800 relayQuietTicks=2400 ' +
      'buttonWinTicks=2000 buttonQuietTicks=6000 switchWinTicks=4800 switchQuietTicks=14400 ' +
      'dialWinTicks=3332 dialQuietTicks=9996\n',
    );
    expect(result.trace).toContain('# margins minDecisionUa=na minTickGap=na marginal=false\n');
  });

  it('counts all drained Events, mover changes, decision margins and same-index tick gaps', () => {
    const value = fixture([
      { k: 'do', cmd: { k: 'power', on: true } },
      { k: 'advance', ms: 20 },
      { k: 'do', cmd: { k: 'power', on: false } },
      { k: 'advance', ms: 20 },
    ]);
    value['wires'] = ['1+/1E', '1F/1-'];
    const result = runFixture(writeFixture(value));
    expect(result.metrics.minDecisionUa).not.toBeNull();
    expect(result.metrics.minDecisionUa).toBeGreaterThan(0);
    expect(result.metrics.minTickGap).toBeGreaterThan(0);
    expect(result.digest.eventCount).toBe(12);
    expect(result.digest.moverTransitions).toEqual([4, ...new Array<number>(18).fill(0)]);
  });

  it('counts manual relay contacts without manufacturing an electrical decision margin', () => {
    const result = runFixture(writeFixture(fixture([
      { k: 'do', cmd: { k: 'relayGrab', n: 1, target: 1000 } },
      { k: 'advance', ms: 20 },
      { k: 'do', cmd: { k: 'relayGrab', n: 1, target: 0 } },
      { k: 'advance', ms: 20 },
    ], 'MANUAL-RELAY-METRICS')));
    expect(result.metrics.minDecisionUa).toBeNull();
    expect(result.metrics.minTickGap).not.toBeNull();
    expect(result.digest.eventCount).toBeGreaterThan(0);
    expect(result.digest.moverTransitions[0]).toBeGreaterThan(0);
    expect(result.trace).toContain('> relayGrab1 target=1000');
    expect(result.trace).toContain('> relayGrab1 target=0');
  });

  it('records repeated relay release as accepted no-op commands', () => {
    const result = runFixture(writeFixture(fixture([
      { k: 'do', cmd: { k: 'relayRelease', n: 1 } },
      { k: 'do', cmd: { k: 'relayRelease', n: 1 } },
    ], 'REPEATED-RELAY-RELEASE')));
    expect(result.trace.match(/> relayRelease1/g)).toHaveLength(2);
    expect(result.digest.eventCount).toBe(0);
  });
});

describe('until step (architecture §13.5.1)', () => {
  const sw1On = { k: 'do', cmd: { k: 'switch', n: 1, target: 1000 } };
  const until = (obs: unknown[], maxMs: number): Record<string, unknown> =>
    ({ k: 'until', obs, maxMs, cite: 'x', quote: 'q' });
  const expectStep = (obs: unknown[]): Record<string, unknown> => ({ k: 'expect', obs, cite: 'x', quote: 'q' });

  it('matches before any tick and emits exactly the expect line', () => {
    const viaUntil = runFixture(writeFixture(fixture([until([{ dev: 'power', v: 'off' }], 1)], 'UNTIL-NOW')));
    const viaExpect = runFixture(writeFixture(fixture([expectStep([{ dev: 'power', v: 'off' }])], 'UNTIL-NOW')));
    expect(viaUntil.failures).toEqual([]);
    expect(viaUntil.trace).toBe(viaExpect.trace);
    expect(viaUntil.trace).toContain('     0.0 ? power=off  "q"\n');
    expect(viaUntil.digest.eventCount).toBe(0);

    // A queued command has not landed until the next boundary, so this still matches at zero ticks.
    const queued = runFixture(writeFixture(fixture([
      { k: 'do', cmd: { k: 'power', on: true } },
      until([{ dev: 'power', v: 'off' }], 1),
      { k: 'advance', ms: 1 },
    ], 'UNTIL-QUEUED')));
    expect(queued.failures).toEqual([]);
    expect(queued.trace).toContain('     0.0 > power on\n     0.0 ? power=off  "q"\n     0.0 * power off->on\n');
  });

  it('after k ticks equals advance-by-k then expect, including a match on the cap tick', () => {
    const obs = [{ dev: 'power', v: 'off' }, { dev: 'sw1', v: 'mid' }];
    const reference = runFixture(writeFixture(fixture([
      sw1On, { k: 'advance', ms: 27 }, expectStep(obs), { k: 'advance', ms: 1 },
    ], 'UNTIL-K')));
    expect(reference.failures).toEqual([]);
    expect(reference.trace).toContain('    27.0 ? power=off sw1=mid  "q"\n');
    for (const maxMs of [27, 1000]) {
      const result = runFixture(writeFixture(fixture([
        sw1On, until(obs, maxMs), { k: 'advance', ms: 1 },
      ], 'UNTIL-K')));
      expect(result.failures, String(maxMs)).toEqual([]);
      expect(result.trace, String(maxMs)).toBe(reference.trace);
      expect(result.digest, String(maxMs)).toEqual(reference.digest);
      expect(result.metrics, String(maxMs)).toEqual(reference.metrics);
    }
  });

  it('times out at exactly cap ticks, records only differing observables and continues', () => {
    const obs = [{ dev: 'power', v: 'off' }, { dev: 'sw1', v: 'mid' }];
    const tail = [{ k: 'advance', ms: 1 }, expectStep([{ dev: 'sw1', v: 'mid' }])];
    const result = runFixture(writeFixture(fixture([sw1On, until(obs, 26), ...tail], 'UNTIL-CAP')));
    const reference = runFixture(writeFixture(fixture([
      sw1On, { k: 'advance', ms: 26 }, expectStep(obs), ...tail,
    ], 'UNTIL-CAP')));
    expect(result.failures).toEqual([{ scriptIndex: 1, dev: 'sw1', expected: 'mid', actual: 'nc' }]);
    expect(reference.failures).toEqual([{ scriptIndex: 2, dev: 'sw1', expected: 'mid', actual: 'nc' }]);
    expect(result.trace).toBe(reference.trace);
    expect(result.digest).toEqual(reference.digest);
    expect(result.trace).toContain('    26.0 ? power=off sw1=nc  "q"\n');
    expect(result.trace).toContain('    27.0 ? sw1=mid  "q"\n');
    expect(result.trace).not.toContain('no settle');
  });

  it('runs inside a C2 fixture and feeds the digest like advance', () => {
    const c2 = (script: unknown[]): Record<string, unknown> => ({
      ...fixture(script, 'UNTIL-C2'),
      tier: 'C2',
      digest: { eventCount: 0, moverTransitions: new Array<number>(19).fill(0) },
    });
    const obs = [{ dev: 'sw1', v: 'mid' }];
    const viaUntil = runFixture(writeFixture(c2([sw1On, until(obs, 1000)])));
    const viaAdvance = runFixture(writeFixture(c2([sw1On, { k: 'advance', ms: 27 }, expectStep(obs)])));
    expect(viaUntil.failures).toEqual([]);
    expect(viaUntil.trace).toBe(viaAdvance.trace);
    expect(viaUntil.digest).toEqual(viaAdvance.digest);
    expect(viaUntil.digest.moverTransitions[12]).toBe(1);
  });
});

describe('fallback inventory', () => {
  it('lists tagged until steps exactly as tagged expect steps', () => {
    const root = mkdtempSync(join(tmpdir(), 'mv601-fallback-until-'));
    roots.push(root);
    const tagged = { obs: [{ dev: 'power', v: 'off' }], quote: 'q', tag: 'unverified', source: 'FALLBACK-NAME' };
    writeFixture(fixture([
      { k: 'until', maxMs: 1, cite: 'cite-until', ...tagged },
      { k: 'expect', cite: 'cite-expect', ...tagged },
      { k: 'until', maxMs: 1, obs: tagged.obs, cite: 'untagged', quote: 'q' },
    ], 'U0'), root);
    expect(formatFallbacks(listFallbacks(root))).toBe(
      'U0\tscript[0]\tFALLBACK-NAME\tcite-until\n' +
      'U0\tscript[1]\tFALLBACK-NAME\tcite-expect\n',
    );
  });

  it('sorts by locale-independent fixture-id code units then script index', () => {
    const root = mkdtempSync(join(tmpdir(), 'mv601-fallback-'));
    roots.push(root);
    const fallback = (id: string, indices: number[]): Record<string, unknown> => fixture(indices.map((index) => ({
      k: 'expect',
      obs: [{ dev: 'power', v: 'off' }],
      cite: 'cite-' + index,
      quote: 'fallback',
      tag: 'unverified',
      source: 'FALLBACK-NAME',
    })), id);
    writeFixture(fallback('A0', [0]), root);
    writeFixture(fallback('A-1', [0, 1]), root);
    expect(formatFallbacks(listFallbacks(root))).toBe(
      'A-1\tscript[0]\tFALLBACK-NAME\tcite-0\n' +
      'A-1\tscript[1]\tFALLBACK-NAME\tcite-1\n' +
      'A0\tscript[0]\tFALLBACK-NAME\tcite-0\n',
    );
  });

  it('emits zero bytes for no matches', () => {
    const root = mkdtempSync(join(tmpdir(), 'mv601-fallback-empty-'));
    roots.push(root);
    expect(formatFallbacks(listFallbacks(root))).toBe('');
  });
});
