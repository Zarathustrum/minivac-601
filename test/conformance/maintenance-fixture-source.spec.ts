/**
 * Independent source pins for W4a's three hand-authored Maintenance fixtures.
 *
 * This does not stand in for the future fixture.schema.json or runner. It binds the reviewed
 * source bytes, literal transcription, W2's separately frozen physical wires, printed projections
 * and setup commands before graph/golden output exists.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allocateHoles, parseTerminalWire } from '../../src/core/terminals.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_DIR = ROOT + '/test/conformance/fixtures/A/';
const IDS = ['MM-PB-CHECK', 'MM-RLY-CHECK', 'MM-SW-CHECK'] as const;
const MAINTENANCE_PDF_SHA256 = '71773c9ebaddac53b04e1f648617bc7ee47318131c662f832fb5d3fb9b79730d';

interface FixtureStep {
  readonly k: string;
  readonly cmd?: Readonly<Record<string, unknown>>;
  readonly ms?: number;
  readonly maxMs?: number;
  readonly obs?: readonly Readonly<Record<string, string>>[];
  readonly cite?: string;
  readonly quote?: string;
  readonly tag?: string;
  readonly source?: string;
}

interface FixtureDoc {
  readonly schema: string;
  readonly id: string;
  readonly source: string;
  readonly tier: string;
  readonly confidence: string;
  readonly profile: string;
  readonly contract: string;
  readonly as_printed: readonly string[];
  readonly errata_applied: readonly Readonly<Record<string, string>>[];
  readonly note?: string;
  readonly wires: readonly string[];
  readonly script: readonly FixtureStep[];
}

interface KatCase {
  readonly id: string;
  readonly wires: readonly { readonly id: number; readonly a: string; readonly b: string }[];
  readonly movers: {
    readonly relays: readonly number[];
    readonly buttons: readonly number[];
    readonly switches: readonly number[];
  };
}

const EXPECTED = Object.freeze({
  'MM-PB-CHECK': Object.freeze({
    source: 'MAINT printed pp.6-7 = maintenance-manual.pdf PDF pp.8-9',
    asPrinted: Object.freeze(['+/Y', 'Z/1A', '1B/-', 'X/2B', '2B/-']),
    wires: Object.freeze(['1+/1Y', '1Z/1A', '1B/1-', '1X/2A', '2B/2-']),
    commands: Object.freeze([
      Object.freeze({ k: 'power', on: true }),
      Object.freeze({ k: 'button', n: 1, target: 1000 }),
    ]),
    stepKinds: Object.freeze(['do', 'settle', 'expect', 'do', 'settle', 'advance', 'expect']),
    expectations: Object.freeze([
      Object.freeze({
        cite: 'MAINT printed p.7 = maintenance-manual.pdf PDF p.9',
        quote: 'Turn power on. Light 1 should come on.',
        obs: Object.freeze([
          Object.freeze({ dev: 'outLamp1', v: 'on' }),
        ]),
      }),
      Object.freeze({
        cite: 'MAINT printed p.7 = maintenance-manual.pdf PDF p.9',
        quote: 'Push the pushbutton. Light 1 should go off and light 2 should come on.',
        obs: Object.freeze([
          Object.freeze({ dev: 'outLamp1', v: 'off' }),
          Object.freeze({ dev: 'outLamp2', v: 'on' }),
        ]),
      }),
    ]),
  }),
  'MM-RLY-CHECK': Object.freeze({
    source: 'MAINT printed p.7 = maintenance-manual.pdf PDF p.9',
    asPrinted: Object.freeze([
      '+/H', '+/L', '+/Y', 'X/E', 'F/-', 'J/1A', '1B/1-', 'G/2A', '2B/2-',
      'N/3A', '3B/3-', 'K/4A', '4B/4-',
    ]),
    wires: Object.freeze([
      '1+/1H', '1+/1L', '2+/1Y', '1X/1E', '1F/1-', '1J/1A', '1B/1-',
      '1G/2A', '2B/2-', '1N/3A', '3B/3-', '1K/4A', '4B/4-',
    ]),
    commands: Object.freeze([
      Object.freeze({ k: 'power', on: true }),
      Object.freeze({ k: 'button', n: 1, target: 1000 }),
    ]),
    stepKinds: Object.freeze(['do', 'settle', 'expect', 'do', 'settle', 'advance', 'expect']),
    expectations: Object.freeze([
      Object.freeze({
        cite: 'MAINT printed p.7 = maintenance-manual.pdf PDF p.9',
        quote: 'Turn power on. Lights 1 and 3 should come on.',
        obs: Object.freeze([
          Object.freeze({ dev: 'outLamp1', v: 'on' }),
          Object.freeze({ dev: 'outLamp3', v: 'on' }),
        ]),
      }),
      Object.freeze({
        cite: 'MAINT printed p.7 = maintenance-manual.pdf PDF p.9',
        quote: 'Push the pushbutton. Lights 1 and 3 should go off and lights 2 and 4 should come on.',
        obs: Object.freeze([
          Object.freeze({ dev: 'outLamp1', v: 'off' }),
          Object.freeze({ dev: 'outLamp2', v: 'on' }),
          Object.freeze({ dev: 'outLamp3', v: 'off' }),
          Object.freeze({ dev: 'outLamp4', v: 'on' }),
        ]),
      }),
    ]),
  }),
  'MM-SW-CHECK': Object.freeze({
    source: 'MAINT printed p.8 = maintenance-manual.pdf PDF p.10',
    asPrinted: Object.freeze([
      '+/S', '+/V', 'T/1A', '1B/1-', 'R/2A', '2B/2-', 'W/3A', '3B/3-',
      'U/4A', '4B/4-',
    ]),
    wires: Object.freeze([
      '1+/1S', '1+/1V', '1T/1A', '1B/1-', '1R/2A', '2B/2-', '1W/3A',
      '3B/3-', '1U/4A', '4B/4-',
    ]),
    commands: Object.freeze([
      Object.freeze({ k: 'switch', n: 1, target: 1000 }),
      Object.freeze({ k: 'power', on: true }),
      Object.freeze({ k: 'switch', n: 1, target: 0 }),
    ]),
    stepKinds: Object.freeze([
      'do', 'settle', 'do', 'settle', 'expect', 'do', 'settle', 'advance', 'expect',
    ]),
    expectations: Object.freeze([
      Object.freeze({
        cite: 'MAINT printed p.8 = maintenance-manual.pdf PDF p.10',
        quote: 'Set the slide switch RIGHT. Turn power on. Lights 1 and 3 should come on.',
        obs: Object.freeze([
          Object.freeze({ dev: 'outLamp1', v: 'on' }),
          Object.freeze({ dev: 'outLamp3', v: 'on' }),
        ]),
      }),
      Object.freeze({
        cite: 'MAINT printed p.8 = maintenance-manual.pdf PDF p.10',
        quote: 'Move the slide switch to the LEFT. Lights 1 and 3 should go off and lights 2 and 4 should come on.',
        obs: Object.freeze([
          Object.freeze({ dev: 'outLamp1', v: 'off' }),
          Object.freeze({ dev: 'outLamp2', v: 'on' }),
          Object.freeze({ dev: 'outLamp3', v: 'off' }),
          Object.freeze({ dev: 'outLamp4', v: 'on' }),
        ]),
      }),
    ]),
  }),
});

function loadFixture(id: (typeof IDS)[number]): FixtureDoc {
  return JSON.parse(readFileSync(FIXTURE_DIR + id + '.fixture.json', 'utf8')) as FixtureDoc;
}

function canonicalWire(text: string): string {
  const [a, b] = parseTerminalWire(text);
  const rail = (end: string): string => /^[1-6]\+$/.test(end)
    ? 'PLUS'
    : /^[1-6]-$/.test(end) ? 'MINUS' : end;
  return [rail(a), rail(b)].sort().join('/');
}

function assertPbCorrection(wires: readonly string[]): void {
  const canonical = wires.map(canonicalWire);
  if (canonical.includes(canonicalWire('1X/2B'))) throw new Error('MM-PB-PRINT-01 from remains');
  if (canonical.filter((wire) => wire === canonicalWire('1X/2A')).length !== 1) {
    throw new Error('MM-PB-PRINT-01 to must occur exactly once');
  }
}

describe('Maintenance fixture reviewed inputs', () => {
  it('binds the visually reviewed Maintenance Manual bytes', () => {
    const bytes = readFileSync(ROOT + '/docs/research/raw/pdf/maintenance-manual.pdf');
    expect(bytes.length).toBe(231416);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(MAINTENANCE_PDF_SHA256);
  });

  it('pins literal transcriptions, printed projections and command order', () => {
    for (const id of IDS) {
      const raw = readFileSync(FIXTURE_DIR + id + '.fixture.json');
      expect(raw[0]).not.toBe(0xef);
      expect(raw.includes(0x0d)).toBe(false);

      const fixture = loadFixture(id);
      const expected = EXPECTED[id];
      expect(fixture.schema).toBe('minivac.fixture/1');
      expect(fixture.id).toBe(id);
      expect(fixture.source).toBe(expected.source);
      expect(fixture.tier).toBe('A');
      expect(fixture.confidence).toBe('verified');
      expect(fixture.profile).toBe('MV601-REF-A');
      expect(fixture.contract).toBe('1.1.0');
      expect(fixture.as_printed).toEqual(expected.asPrinted);
      expect(fixture.wires).toEqual(expected.wires);
      expect(fixture.script.map((step) => step.k)).toEqual(expected.stepKinds);
      expect(fixture.script.filter((step) => step.k === 'do').map((step) => step.cmd))
        .toEqual(expected.commands);
      expect(fixture.script.filter((step) => step.k === 'settle').map((step) => step.maxMs))
        .toEqual(id === 'MM-SW-CHECK' ? [200, 200, 200] : [200, 200]);
      // Settle stops after classified observables are quiet. A deliberate common post-actuation
      // hold lets the previously lit lamps cool through dim before the printed OFF projection.
      expect(fixture.script.filter((step) => step.k === 'advance').map((step) => step.ms))
        .toEqual([30]);
      expect(fixture.script.filter((step) => step.k === 'expect').map((step) => ({
        cite: step.cite,
        quote: step.quote,
        obs: step.obs,
      }))).toEqual(expected.expectations);
      expect(fixture.script.some((step) => step.tag !== undefined || step.source !== undefined)).toBe(false);

      const parsed = fixture.wires.map(parseTerminalWire);
      expect(allocateHoles(parsed)).toHaveLength(fixture.wires.length);
    }
  });

  it('matches the independently frozen W2 Maintenance wire and initial-state pins', () => {
    const kat = JSON.parse(readFileSync(ROOT + '/data/kat/netlist-kat.json', 'utf8')) as {
      readonly cases: readonly KatCase[];
    };
    for (const id of IDS) {
      const fixture = loadFixture(id);
      const sourceCase = kat.cases.find((entry) => entry.id === id);
      expect(sourceCase, id).toBeDefined();
      expect(sourceCase?.wires.map((wire, index) => {
        expect(wire.id).toBe(index);
        return wire.a + '/' + wire.b;
      })).toEqual(fixture.wires);
      expect(sourceCase?.movers.relays).toEqual([0, 0, 0, 0, 0, 0]);
      expect(sourceCase?.movers.buttons).toEqual([0, 0, 0, 0, 0, 0]);
      expect(sourceCase?.movers.switches).toEqual(
        id === 'MM-SW-CHECK' ? [1000, 0, 0, 0, 0, 0] : [0, 0, 0, 0, 0, 0],
      );
    }
  });

  it('pins MM-PB-PRINT-01 and rejects from, missing-to and reversal attacks', () => {
    const fixture = loadFixture('MM-PB-CHECK');
    expect(fixture.errata_applied).toEqual([
      { id: 'MM-PB-PRINT-01', from: '1X/2B', to: '1X/2A' },
    ]);
    assertPbCorrection(fixture.wires);
    expect(() => assertPbCorrection([...fixture.wires.slice(0, 3), '1X/2B', '2B/2-']))
      .toThrow(/from remains/);
    expect(() => assertPbCorrection(fixture.wires.filter((wire) => wire !== '1X/2A')))
      .toThrow(/to must occur exactly once/);
    expect(() => assertPbCorrection([...fixture.wires.slice(0, 3), '2B/1X', '2B/2-']))
      .toThrow(/from remains/);
  });
});
