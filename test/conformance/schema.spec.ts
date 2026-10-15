import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { OBSERVABLES } from '../../src/core/trace.ts';
import { DECISION_ANCHOR, loadFixture } from './helpers.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function baseFixture(): Record<string, unknown> {
  return {
    schema: 'minivac.fixture/1',
    id: 'SCHEMA-CASE',
    source: 'schema test',
    tier: 'A',
    confidence: 'verified',
    profile: 'MV601-REF-A',
    contract: '1.1.0',
    as_printed: ['A/B'],
    errata_applied: [],
    wires: ['1A/1B'],
    script: [{
      k: 'expect',
      obs: [{ dev: 'power', v: 'off' }],
      cite: 'schema test',
      quote: 'Power is off.',
    }],
  };
}

function writeFixture(value: unknown, bytes?: Uint8Array | string): string {
  const root = mkdtempSync(join(tmpdir(), 'mv601-schema-'));
  roots.push(root);
  const path = join(root, 'case.fixture.json');
  writeFileSync(path, bytes ?? JSON.stringify(value) + '\n');
  return path;
}

function clone(): Record<string, unknown> {
  return structuredClone(baseFixture());
}

describe('minivac.fixture/1 Draft-2020 schema', () => {
  it('loads the minimal valid shape', () => {
    expect(loadFixture(writeFixture(baseFixture())).fixture.id).toBe('SCHEMA-CASE');
    const oldContract = clone();
    oldContract['contract'] = '1.0.0';
    expect(() => loadFixture(writeFixture(oldContract))).toThrow(/schema validation failed/);
  });

  it('rejects every missing required root member and every unknown member', () => {
    const required = [
      'schema', 'id', 'source', 'tier', 'confidence', 'profile', 'contract',
      'as_printed', 'errata_applied', 'wires', 'script',
    ];
    for (const key of required) {
      const value = clone();
      delete value[key];
      expect(() => loadFixture(writeFixture(value)), key).toThrow(/schema validation failed/);
    }
    const unknown = clone();
    unknown['extra'] = true;
    expect(() => loadFixture(writeFixture(unknown))).toThrow(/schema validation failed/);
  });

  it('accepts all ten exact command variants and rejects extra command fields', () => {
    const commands = [
      { k: 'power', on: true },
      { k: 'breaker', reset: true },
      { k: 'connect', cord: 255, a: { k: 'hole', hole: '1A#1' }, b: { k: 'touch', term: '1B' }, r_uohm: 0 },
      { k: 'disconnect', cord: 0 },
      { k: 'button', n: 1, target: 1000 },
      { k: 'switch', n: 6, target: 0 },
      { k: 'relayGrab', n: 1, target: 1000 },
      { k: 'relayRelease', n: 6 },
      { k: 'dialGrab', targetUdeg: 359999999 },
      { k: 'dialRelease' },
    ];
    for (const command of commands) {
      const value = clone();
      value['script'] = [{ k: 'do', cmd: command }];
      expect(() => loadFixture(writeFixture(value)), command.k).not.toThrow();
    }
    const value = clone();
    value['script'] = [{ k: 'do', cmd: { k: 'power', on: true, tick: 1 } }];
    expect(() => loadFixture(writeFixture(value))).toThrow(/schema validation failed/);
  });

  it('pins all five step shapes, true-only collapse and checked millisecond conversion', () => {
    const steps = [
      { k: 'do', cmd: { k: 'button', n: 1, target: 0 }, collapse: true },
      { k: 'advance', ms: 1 },
      { k: 'settle', maxMs: 1 },
      { k: 'expect', obs: [{ dev: 'dial', v: 'gap' }], cite: 'x', quote: 'q' },
      { k: 'until', obs: [{ dev: 'dial', v: 'gap' }], maxMs: 1, cite: 'x', quote: 'q' },
    ];
    const value = clone();
    value['script'] = steps;
    expect(() => loadFixture(writeFixture(value))).not.toThrow();

    const falseCollapse = clone();
    falseCollapse['script'] = [{ k: 'do', cmd: { k: 'dialRelease' }, collapse: false }];
    expect(() => loadFixture(writeFixture(falseCollapse))).toThrow(/schema validation failed/);

    const overflow = clone();
    overflow['script'] = [{ k: 'advance', ms: 214748365 }];
    expect(() => loadFixture(writeFixture(overflow))).toThrow(/overflow int32 ticks/);

    const untilOverflow = clone();
    untilOverflow['script'] = [{
      k: 'until', obs: [{ dev: 'power', v: 'off' }], maxMs: 214748365, cite: 'x', quote: 'q',
    }];
    expect(() => loadFixture(writeFixture(untilOverflow))).toThrow(/overflow int32 ticks/);
    (untilOverflow['script'] as Record<string, unknown>[])[0]!['maxMs'] = 214748364;
    expect(() => loadFixture(writeFixture(untilOverflow))).not.toThrow();
  });

  it('accepts until in every tier and expect plus until in C2, which still requires digest', () => {
    const until = { k: 'until', obs: [{ dev: 'power', v: 'off' }], maxMs: 1, cite: 'x', quote: 'q' };
    const digest = { eventCount: 0, moverTransitions: new Array<number>(19).fill(0) };
    for (const tier of ['A', 'B', 'C1', 'C2']) {
      const value = clone();
      value['tier'] = tier;
      value['script'] = [structuredClone(until)];
      if (tier === 'C2') value['digest'] = structuredClone(digest);
      expect(() => loadFixture(writeFixture(value)), tier).not.toThrow();
    }
    const c2 = clone();
    c2['tier'] = 'C2';
    c2['script'] = [
      { k: 'expect', obs: [{ dev: 'power', v: 'off' }], cite: 'x', quote: 'q' },
      structuredClone(until),
    ];
    expect(() => loadFixture(writeFixture(c2)), 'C2 without digest').toThrow(/schema validation failed/);
    c2['digest'] = structuredClone(digest);
    expect(() => loadFixture(writeFixture(c2)), 'C2 with digest').not.toThrow();
    const nonC2 = clone();
    nonC2['script'] = [structuredClone(until)];
    nonC2['digest'] = structuredClone(digest);
    expect(() => loadFixture(writeFixture(nonC2)), 'digest on A').toThrow(/schema validation failed/);
  });

  it('rejects every malformed until shape by the expect rules', () => {
    const base = { k: 'until', obs: [{ dev: 'power', v: 'off' }], maxMs: 1, cite: 'x', quote: 'q' };
    const bad: [string, Record<string, unknown>][] = [
      ['maxMs zero', { ...base, maxMs: 0 }],
      ['maxMs negative', { ...base, maxMs: -1 }],
      ['maxMs fractional', { ...base, maxMs: 1.5 }],
      ['maxMs string', { ...base, maxMs: '1' }],
      ['maxMs above int32', { ...base, maxMs: 2147483648 }],
      ['ms instead of maxMs', { k: 'until', obs: base.obs, ms: 1, cite: 'x', quote: 'q' }],
      ['empty obs', { ...base, obs: [] }],
      ['same dev twice', { ...base, obs: [{ dev: 'relay1', v: 'nc' }, { dev: 'relay1', v: 'no' }] }],
      ['illegal pair', { ...base, obs: [{ dev: 'power', v: 'nc' }] }],
      ['unknown dev', { ...base, obs: [{ dev: 'relay7', v: 'nc' }] }],
      ['empty cite', { ...base, cite: '' }],
      ['empty quote', { ...base, quote: '' }],
      ['control in cite', { ...base, cite: 'bad\tfield' }],
      ['control in quote', { ...base, quote: 'bad\nfield' }],
      ['tag without source', { ...base, tag: 'unverified' }],
      ['source without tag', { ...base, source: 'FALLBACK-X' }],
      ['wrong tag', { ...base, tag: 'likely', source: 'FALLBACK-X' }],
      ['lowercase source', { ...base, tag: 'unverified', source: 'FALLBACK-lowercase' }],
      ['collapse member', { ...base, collapse: true }],
    ];
    for (const [label, step] of bad) {
      const value = clone();
      value['script'] = [step];
      expect(() => loadFixture(writeFixture(value)), label).toThrow(/schema validation failed/);
    }
    const fallback = clone();
    fallback['script'] = [{ ...base, tag: 'unverified', source: 'FALLBACK-X' }];
    expect(() => loadFixture(writeFixture(fallback))).not.toThrow();
    for (const field of ['cite', 'quote'] as const) {
      const value = clone();
      value['script'] = [{ ...base, [field]: 'bad\ud800' }];
      expect(() => loadFixture(writeFixture(value)), field).toThrow(/unpaired high surrogate/);
      value['script'] = [{ ...base, [field]: 'valid \ud83d\ude80 scalar' }];
      expect(() => loadFixture(writeFixture(value)), field).not.toThrow();
    }
    const everyPair = clone();
    everyPair['script'] = [{ ...base, obs: OBSERVABLES.map((row) => ({ dev: row.name, v: row.values[0] })) }];
    expect(() => loadFixture(writeFixture(everyPair))).not.toThrow();
  });

  it('pins observable pairs and rejects the same device twice even with different values', () => {
    const everyPair = clone();
    everyPair['script'] = [{
      k: 'expect',
      obs: OBSERVABLES.map((row) => ({ dev: row.name, v: row.values[0] })),
      cite: 'x',
      quote: 'q',
    }];
    expect(() => loadFixture(writeFixture(everyPair))).not.toThrow();

    const value = clone();
    value['script'] = [{
      k: 'expect',
      obs: [{ dev: 'relay1', v: 'nc' }, { dev: 'relay1', v: 'no' }],
      cite: 'x',
      quote: 'q',
    }];
    expect(() => loadFixture(writeFixture(value))).toThrow(/schema validation failed/);

    const badPair = clone();
    badPair['script'] = [{ k: 'expect', obs: [{ dev: 'power', v: 'nc' }], cite: 'x', quote: 'q' }];
    expect(() => loadFixture(writeFixture(badPair))).toThrow(/schema validation failed/);
  });

  it('rejects unknown members in every nested object family', () => {
    const mutations: Record<string, unknown>[] = [];
    const erratum = clone();
    erratum['wires'] = ['1C/1E'];
    erratum['errata_applied'] = [{ id: 'E', from: '1A/1B', to: '1C/1E', extra: true }];
    mutations.push(erratum);
    const doStep = clone();
    doStep['script'] = [{ k: 'do', cmd: { k: 'power', on: true }, extra: true }];
    mutations.push(doStep);
    const end = clone();
    end['script'] = [{
      k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'free', extra: true }, b: { k: 'free' } },
    }];
    mutations.push(end);
    const observable = clone();
    observable['script'] = [{
      k: 'expect', obs: [{ dev: 'power', v: 'off', extra: true }], cite: 'x', quote: 'q',
    }];
    mutations.push(observable);
    const digest = clone();
    digest['tier'] = 'C2';
    digest['script'] = [{ k: 'advance', ms: 1 }];
    digest['digest'] = { eventCount: 0, moverTransitions: new Array<number>(19).fill(0), extra: true };
    mutations.push(digest);
    const mechanism = clone();
    mechanism['marginal'] = true;
    mechanism['mechanism'] = { profileKey: 'L_coil_uh', decision: DECISION_ANCHOR, extra: true };
    mutations.push(mechanism);
    for (const value of mutations) {
      expect(() => loadFixture(writeFixture(value))).toThrow(/schema validation failed/);
    }
  });

  it('exhausts nested required, unknown and discriminant mutations', () => {
    const reject = (value: Record<string, unknown>, label: string): void => {
      expect(() => loadFixture(writeFixture(value)), label).toThrow(/schema validation failed/);
    };
    const withStep = (step: Record<string, unknown>): Record<string, unknown> => {
      const value = clone();
      value['script'] = [step];
      return value;
    };

    const commands: { command: Record<string, unknown>; required: string[] }[] = [
      { command: { k: 'power', on: true }, required: ['k', 'on'] },
      { command: { k: 'breaker', reset: true }, required: ['k', 'reset'] },
      {
        command: {
          k: 'connect', cord: 0,
          a: { k: 'hole', hole: '1A#1' }, b: { k: 'touch', term: '1B' }, r_uohm: 0,
        },
        required: ['k', 'cord', 'a', 'b'],
      },
      { command: { k: 'disconnect', cord: 0 }, required: ['k', 'cord'] },
      { command: { k: 'button', n: 1, target: 0 }, required: ['k', 'n', 'target'] },
      { command: { k: 'switch', n: 1, target: 0 }, required: ['k', 'n', 'target'] },
      { command: { k: 'relayGrab', n: 1, target: 0 }, required: ['k', 'n', 'target'] },
      { command: { k: 'relayRelease', n: 1 }, required: ['k', 'n'] },
      { command: { k: 'dialGrab', targetUdeg: 0 }, required: ['k', 'targetUdeg'] },
      { command: { k: 'dialRelease' }, required: ['k'] },
    ];
    for (const row of commands) {
      for (const key of row.required) {
        const command = structuredClone(row.command);
        delete command[key];
        reject(withStep({ k: 'do', cmd: command }), row.command['k'] + ' missing ' + key);
      }
      const unknown = structuredClone(row.command);
      unknown['extra'] = true;
      reject(withStep({ k: 'do', cmd: unknown }), row.command['k'] + ' unknown');
      const discriminant = structuredClone(row.command);
      discriminant['k'] = 'invalid-command';
      reject(withStep({ k: 'do', cmd: discriminant }), row.command['k'] + ' invalid k');
    }

    const ends: { end: Record<string, unknown>; required: string[] }[] = [
      { end: { k: 'hole', hole: '1A#1' }, required: ['k', 'hole'] },
      { end: { k: 'touch', term: '1A' }, required: ['k', 'term'] },
      { end: { k: 'free' }, required: ['k'] },
    ];
    for (const row of ends) {
      for (const key of row.required) {
        const end = structuredClone(row.end);
        delete end[key];
        reject(withStep({
          k: 'do', cmd: { k: 'connect', cord: 0, a: end, b: { k: 'free' } },
        }), row.end['k'] + ' missing ' + key);
      }
      const unknown = structuredClone(row.end);
      unknown['extra'] = true;
      reject(withStep({
        k: 'do', cmd: { k: 'connect', cord: 0, a: unknown, b: { k: 'free' } },
      }), row.end['k'] + ' unknown');
      const discriminant = structuredClone(row.end);
      discriminant['k'] = 'invalid-end';
      reject(withStep({
        k: 'do', cmd: { k: 'connect', cord: 0, a: discriminant, b: { k: 'free' } },
      }), row.end['k'] + ' invalid k');
    }

    const steps: { step: Record<string, unknown>; required: string[] }[] = [
      { step: { k: 'do', cmd: { k: 'power', on: true } }, required: ['k', 'cmd'] },
      { step: { k: 'advance', ms: 1 }, required: ['k', 'ms'] },
      { step: { k: 'settle', maxMs: 1 }, required: ['k', 'maxMs'] },
      {
        step: { k: 'expect', obs: [{ dev: 'power', v: 'off' }], cite: 'x', quote: 'q' },
        required: ['k', 'obs', 'cite', 'quote'],
      },
      {
        step: { k: 'until', obs: [{ dev: 'power', v: 'off' }], maxMs: 1, cite: 'x', quote: 'q' },
        required: ['k', 'obs', 'maxMs', 'cite', 'quote'],
      },
    ];
    for (const row of steps) {
      for (const key of row.required) {
        const step = structuredClone(row.step);
        delete step[key];
        reject(withStep(step), row.step['k'] + ' missing ' + key);
      }
      const unknown = structuredClone(row.step);
      unknown['extra'] = true;
      reject(withStep(unknown), row.step['k'] + ' unknown');
      const discriminant = structuredClone(row.step);
      discriminant['k'] = 'invalid-step';
      reject(withStep(discriminant), row.step['k'] + ' invalid k');
    }

    for (const row of OBSERVABLES) {
      const pair = { dev: row.name, v: row.values[0] as string };
      for (const key of ['dev', 'v']) {
        const missing = structuredClone(pair) as Record<string, unknown>;
        delete missing[key];
        reject(withStep({ k: 'expect', obs: [missing], cite: 'x', quote: 'q' }), row.name + ' missing ' + key);
      }
      reject(withStep({
        k: 'expect', obs: [{ ...pair, extra: true }], cite: 'x', quote: 'q',
      }), row.name + ' unknown');
      reject(withStep({
        k: 'expect', obs: [{ dev: 'invalid-observable', v: pair.v }], cite: 'x', quote: 'q',
      }), row.name + ' invalid dev');
    }

    const erratumBase = clone();
    erratumBase['wires'] = ['1C/1E'];
    const erratum = { id: 'E', from: '1A/1B', to: '1C/1E' };
    for (const key of ['id', 'from', 'to']) {
      const value = structuredClone(erratumBase);
      const row = structuredClone(erratum) as Record<string, unknown>;
      delete row[key];
      value['errata_applied'] = [row];
      reject(value, 'erratum missing ' + key);
    }

    const marginalOnly = clone();
    marginalOnly['marginal'] = true;
    reject(marginalOnly, 'marginal without mechanism');
    const mechanismOnly = clone();
    mechanismOnly['mechanism'] = { profileKey: 'L_coil_uh', decision: DECISION_ANCHOR };
    reject(mechanismOnly, 'mechanism without marginal');
    const mechanismBase = clone();
    mechanismBase['marginal'] = true;
    for (const key of ['profileKey', 'decision']) {
      const mechanism = { profileKey: 'L_coil_uh', decision: DECISION_ANCHOR } as Record<string, unknown>;
      delete mechanism[key];
      mechanismBase['mechanism'] = mechanism;
      reject(structuredClone(mechanismBase), 'mechanism missing ' + key);
    }

    const tagOnly = clone();
    tagOnly['script'] = [{
      k: 'expect', obs: [{ dev: 'power', v: 'off' }], cite: 'x', quote: 'q', tag: 'unverified',
    }];
    reject(tagOnly, 'fallback tag without source');
    const sourceOnly = clone();
    sourceOnly['script'] = [{
      k: 'expect', obs: [{ dev: 'power', v: 'off' }], cite: 'x', quote: 'q', source: 'FALLBACK-X',
    }];
    reject(sourceOnly, 'fallback source without tag');

    const nonC2Digest = clone();
    nonC2Digest['digest'] = { eventCount: 0, moverTransitions: new Array<number>(19).fill(0) };
    reject(nonC2Digest, 'digest on non-C2');
    const c2 = clone();
    c2['tier'] = 'C2';
    c2['script'] = [{ k: 'advance', ms: 1 }];
    for (const key of ['eventCount', 'moverTransitions']) {
      const value = structuredClone(c2);
      const digest = { eventCount: 0, moverTransitions: new Array<number>(19).fill(0) } as Record<string, unknown>;
      delete digest[key];
      value['digest'] = digest;
      reject(value, 'digest missing ' + key);
    }
  });

  it('pins fallback, marginal/mechanism and C2 digest conditionals', () => {
    const fallback = clone();
    fallback['script'] = [{
      k: 'expect', obs: [{ dev: 'power', v: 'off' }], cite: 'x', quote: 'q', tag: 'unverified',
    }];
    expect(() => loadFixture(writeFixture(fallback))).toThrow(/schema validation failed/);

    const badFallbackName = clone();
    badFallbackName['script'] = [{
      k: 'expect', obs: [{ dev: 'power', v: 'off' }], cite: 'x', quote: 'q',
      tag: 'unverified', source: 'FALLBACK-lowercase',
    }];
    expect(() => loadFixture(writeFixture(badFallbackName))).toThrow(/schema validation failed/);

    const marginal = clone();
    marginal['marginal'] = true;
    marginal['mechanism'] = { profileKey: 'L_coil_uh', decision: DECISION_ANCHOR };
    expect(() => loadFixture(writeFixture(marginal))).not.toThrow();
    (marginal['mechanism'] as Record<string, unknown>)['profileKey'] = 'not_a_profile_key';
    expect(() => loadFixture(writeFixture(marginal))).toThrow(/not a normative profile key/);
    (marginal['mechanism'] as Record<string, unknown>)['profileKey'] = 'L_coil_uh';
    (marginal['mechanism'] as Record<string, unknown>)['decision'] = DECISION_ANCHOR + '-wrong';
    expect(() => loadFixture(writeFixture(marginal))).toThrow(/mechanism\.decision must equal/);

    const c2 = clone();
    c2['tier'] = 'C2';
    c2['script'] = [{ k: 'advance', ms: 1 }];
    c2['digest'] = { eventCount: 0, moverTransitions: new Array<number>(19).fill(0) };
    expect(() => loadFixture(writeFixture(c2))).not.toThrow();
    (c2['script'] as unknown[]) = [{
      k: 'expect', obs: [{ dev: 'power', v: 'off' }], cite: 'x', quote: 'q',
    }];
    expect(() => loadFixture(writeFixture(c2))).not.toThrow();
    delete c2['digest'];
    expect(() => loadFixture(writeFixture(c2))).toThrow(/schema validation failed/);
  });

  it('pins the safe fixture-id grammar and control-free cite/quote domain', () => {
    for (const id of ['../../X', 'A/B', 'A\nB', 'lowercase', 'A--B']) {
      const value = clone();
      value['id'] = id;
      expect(() => loadFixture(writeFixture(value)), id).toThrow(/schema validation failed/);
    }
    for (const field of ['cite', 'quote'] as const) {
      const value = clone();
      const step = (value['script'] as Record<string, unknown>[])[0] as Record<string, unknown>;
      step[field] = 'bad\tfield';
      expect(() => loadFixture(writeFixture(value)), field).toThrow(/schema validation failed/);
    }
  });

  it('rejects unpaired UTF-16 surrogates but accepts valid astral Unicode scalars', () => {
    for (const field of ['cite', 'quote'] as const) {
      for (const surrogate of ['\ud800', '\udfff']) {
        const value = clone();
        const step = (value['script'] as Record<string, unknown>[])[0] as Record<string, unknown>;
        step[field] = 'bad' + surrogate;
        expect(() => loadFixture(writeFixture(value)), field + ' ' + surrogate.charCodeAt(0).toString(16))
          .toThrow(/unpaired (high|low) surrogate/);
      }
      const value = clone();
      const step = (value['script'] as Record<string, unknown>[])[0] as Record<string, unknown>;
      step[field] = 'valid \ud83d\ude80 scalar';
      expect(() => loadFixture(writeFixture(value)), field).not.toThrow();
    }
  });
});

describe('fixture semantic surface', () => {
  it('rejects invalid UTF-8, BOM and CR before JSON/schema semantics', () => {
    expect(() => loadFixture(writeFixture({}, new Uint8Array([0xff])))).toThrow(/not valid UTF-8/);
    expect(() => loadFixture(writeFixture({}, new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))))
      .toThrow(/UTF-8 BOM/);
    expect(() => loadFixture(writeFixture({}, '{}\r\n'))).toThrow(/contains CR/);
  });

  it('rejects non-physical endpoints, Ω and deterministic hole exhaustion', () => {
    const bad = clone();
    bad['wires'] = ['1A/NOPE'];
    expect(() => loadFixture(writeFixture(bad))).toThrow(/not a physical wire/);
    bad['wires'] = ['Ω/1A'];
    expect(() => loadFixture(writeFixture(bad))).toThrow(/not a physical wire/);
    bad['wires'] = ['1A/1B', '1C/1A', '1A/1E'];
    expect(() => loadFixture(writeFixture(bad))).toThrow(/hole allocation failed/);

    const badCommand = clone();
    badCommand['script'] = [{
      k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'touch', term: 'NOPE' }, b: { k: 'free' } },
    }];
    expect(() => loadFixture(writeFixture(badCommand))).toThrow(/not a physical endpoint/);
  });

  it('normalizes section and matrix rail aliases plus reversal for errata, but no source shorthand', () => {
    const value = clone();
    value['as_printed'] = ['+/B'];
    value['wires'] = ['1B/M+'];
    value['errata_applied'] = [{ id: 'E', from: 'M+/1A', to: '6+/1B' }];
    expect(() => loadFixture(writeFixture(value))).not.toThrow();

    value['errata_applied'] = [{ id: 'E', from: 'M+/1A', to: 'M+/1C' }];
    expect(() => loadFixture(writeFixture(value))).toThrow(/canonical to occurs 0 times/);

    value['errata_applied'] = [{ id: 'E', from: '+/1A', to: '6+/1B' }];
    expect(() => loadFixture(writeFixture(value))).toThrow(/not a physical wire/);
  });

  it('requires every canonical erratum from absent and to present exactly once', () => {
    const value = clone();
    value['wires'] = ['1A/1B', '1C/1E'];
    value['errata_applied'] = [{ id: 'E', from: '1B/1A', to: '1C/1E' }];
    expect(() => loadFixture(writeFixture(value))).toThrow(/canonical from remains/);

    value['wires'] = ['1C/1E', '1E/1C'];
    expect(() => loadFixture(writeFixture(value))).toThrow(/canonical to occurs 2 times/);
  });
});
