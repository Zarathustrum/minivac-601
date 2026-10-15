/**
 * Independent source pins for W5b's four hand-authored Book-I rotary fixtures.
 *
 * The PDF hashes bind the page images. Literal arrays below bind the wire transcription, while the
 * independently frozen W2 netlist KAT supplies a second copy of the same four programs.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHATTER_DEVICES } from '../../src/core/trace.ts';
import { allocateHoles, parseTerminalWire } from '../../src/core/terminals.ts';
import { readManifest } from './manifest.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const IDS = ['I-EXP11', 'I-EXP12', 'I-EXP13', 'I-EXP14'] as const;
const C2_IDS = ['I-EXP12', 'I-EXP13', 'I-EXP14'] as const;
type Id = (typeof IDS)[number];
type C2Id = (typeof C2_IDS)[number];

interface FixtureDoc {
  readonly id: string;
  readonly source: string;
  readonly tier: string;
  readonly confidence: string;
  readonly as_printed: readonly string[];
  readonly errata_applied: readonly Readonly<Record<string, string>>[];
  readonly wires: readonly string[];
  readonly script: readonly FixtureStep[];
  readonly digest?: {
    readonly eventCount: number;
    readonly moverTransitions: readonly number[];
  };
  readonly note?: string;
}

interface FixtureStep {
  readonly k: string;
  readonly ms?: number;
  readonly cmd?: {
    readonly k: string;
    readonly on?: boolean;
    readonly n?: number;
    readonly target?: number;
    readonly targetUdeg?: number;
  };
  readonly obs?: readonly { readonly dev: string; readonly v: string }[];
  readonly cite?: string;
  readonly quote?: string;
  readonly tag?: string;
}

interface KatCase {
  readonly id: string;
  readonly wires: readonly { readonly a: string; readonly b: string }[];
}

const SOURCE = Object.freeze<Record<Id, readonly [string, string, string]>>({
  'I-EXP11': ['BK1 printed p.21 = book1.pdf PDF p.23; ERRATA sheet p.3 dead-gap note', 'C1', 'verified'],
  'I-EXP12': ['BK1 printed p.23 = book1.pdf PDF p.25', 'C2', 'verified'],
  'I-EXP13': ['BK1 printed p.23 = book1.pdf PDF p.25', 'C2', 'verified'],
  'I-EXP14': [
    'BK1 printed p.24 = book1.pdf PDF p.26; ERRATA sheet p.1 diagram-only 6Y-to-6V correction',
    'C2',
    'likely',
  ],
});

const WIRES = Object.freeze<Record<Id, readonly string[]>>({
  'I-EXP11': ['6+/D16', 'D2/6A', '6-/6B', 'D1/5A', '5B/6B'],
  'I-EXP12': ['6+/5Y', '5X/D17', '6-/D18', '6-/6Y', '6X/D19'],
  'I-EXP13': [
    '6+/D16', 'D2/6A', '6-/6B', 'D1/5A', '5B/6B',
    '6+/5Y', '5X/D17', '5-/D18', '6-/6Y', '6X/D19',
  ],
  'I-EXP14': ['6+/6R', '6+/6W', '6-/6T', '6T/6U', '6S/D18', '6V/D17'],
});

const DIGESTS = Object.freeze<Record<C2Id, readonly [number, readonly number[]]>>({
  'I-EXP12': [73, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 4, 0, 0, 0, 0, 0, 0, 64]],
  'I-EXP13': [53, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0, 40]],
  'I-EXP14': [61, [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 56]],
});

const SCRIPTS = Object.freeze<Record<Id, readonly string[]>>({
  'I-EXP11': [
    'power:on', 'dialGrab:22500000', 'advance:200', 'expect',
    'dialGrab:45000000', 'advance:200', 'expect',
    'dialGrab:146250000', 'advance:650', 'expect',
    'dialGrab:326250000', 'advance:1050', 'expect',
  ],
  'I-EXP12': [
    'power:on', 'advance:100', 'button5:1000', 'until:dial=c8', 'until:dial=c0',
    'button6:1000', 'advance:3000', 'expect', 'button6:0',
    'until:dial=c8', 'until:dial=c0', 'button5:0', 'advance:3000',
  ],
  'I-EXP13': [
    'power:on', 'advance:100', 'button5:1000', 'until:outLamp5=on', 'until:outLamp6=on',
    'until:outLamp5=off,outLamp6=off', 'until:outLamp5=on', 'until:outLamp6=on',
    'until:outLamp5=off,outLamp6=off', 'button6:1000', 'advance:6000',
  ],
  'I-EXP14': [
    'power:on', 'until:dial=c8', 'switch6:1000', 'until:dial=c0', 'advance:1000',
  ],
});

const I_EXP11_QUOTES = Object.freeze([
  'Light 5 comes ON and remains ON as long as the pointer points at number 1.',
  'Rotate the pointer to number 2. Light 5 goes OFF and light 6 comes ON.',
  'This happens when the pointer knob stops between adjacent terminals — for example, between D6 and D7 — and is not making proper connection with either.',
  'This happens when the pointer knob stops between adjacent terminals — for example, between D6 and D7 — and is not making proper connection with either.',
]);

const I_EXP11_PROJECTIONS = Object.freeze([
  'dial=c1,outLamp5=on',
  'dial=c2,outLamp5=off,outLamp6=on',
  'dial=gap',
  'dial=gap',
]);

function scriptSignature(step: FixtureStep): string {
  if (step.k === 'advance') return 'advance:' + step.ms;
  if (step.k === 'expect') return 'expect';
  if (step.k === 'until') {
    return 'until:' + (step.obs ?? []).map((obs) => obs.dev + '=' + obs.v).join(',');
  }
  const command = step.cmd as NonNullable<FixtureStep['cmd']>;
  if (command.k === 'power') return 'power:' + (command.on === true ? 'on' : 'off');
  if (command.k === 'dialGrab') return 'dialGrab:' + command.targetUdeg;
  return command.k + command.n + ':' + command.target;
}

function load(id: Id): FixtureDoc {
  const tier = id === 'I-EXP11' ? 'C1' : 'C2';
  const path = ROOT + '/test/conformance/fixtures/' + tier + '/' + id + '.fixture.json';
  return JSON.parse(readFileSync(path, 'utf8')) as FixtureDoc;
}

describe('Tier-C fixture reviewed inputs', () => {
  it('binds the visually reviewed Book-I and errata source volumes', () => {
    const sources = [
      ['book1.pdf', 1707863, 'ae98e6578e1812702310b9883c96ed495d7a5e045e508ea5768a4ca47327355b'],
      ['errata.pdf', 140730, '33ede94ea3663e0a7e5b303efc3d965907eb37ac1dcb804cfc220b65b78b83e9'],
    ] as const;
    for (const [file, size, hash] of sources) {
      const bytes = readFileSync(ROOT + '/docs/research/raw/pdf/' + file);
      expect(bytes.length, file).toBe(size);
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(hash);
    }
  });

  it('pins its exact four owned ids, metadata, wire order and independent W2 copies', () => {
    expect(IDS).toHaveLength(4);
    expect(new Set(IDS).size).toBe(4);
    const manifestPaths = new Set(readManifest().map((entry) => entry.path));
    expect(manifestPaths.has('C1/I-EXP11.fixture.json')).toBe(true);
    for (const id of C2_IDS) expect(manifestPaths.has('C2/' + id + '.fixture.json'), id).toBe(true);
    const kat = JSON.parse(readFileSync(ROOT + '/data/kat/netlist-kat.json', 'utf8')) as {
      readonly cases: readonly KatCase[];
    };
    for (const id of IDS) {
      const fixture = load(id);
      const source = SOURCE[id];
      expect(fixture.id, id).toBe(id);
      expect([fixture.source, fixture.tier, fixture.confidence], id).toEqual(source);
      expect(fixture.as_printed, id).toEqual(WIRES[id]);
      expect(fixture.wires, id).toEqual(WIRES[id]);
      expect(fixture.script.map(scriptSignature), id).toEqual(SCRIPTS[id]);
      expect(fixture.errata_applied, id).toEqual([]);
      expect(allocateHoles(fixture.wires.map(parseTerminalWire)), id).toHaveLength(fixture.wires.length);
      const katCase = kat.cases.find((candidate) => candidate.id === id);
      expect(katCase, id).toBeDefined();
      expect(katCase?.wires.map((wire) => wire.a + '/' + wire.b), id).toEqual(WIRES[id]);
    }
  });

  it('pins the C1 source sentences and observable projections independently', () => {
    const expects = load('I-EXP11').script.filter((step) => step.k === 'expect');
    expect(expects.map((step) => step.quote)).toEqual(I_EXP11_QUOTES);
    expect(expects.map((step) => step.obs?.map((obs) => obs.dev + '=' + obs.v).join(',')))
      .toEqual(I_EXP11_PROJECTIONS);
    expect(expects.slice(0, 2).every((step) => step.cite === 'BK1 printed p.21 = book1.pdf PDF p.23'))
      .toBe(true);
    expect(expects.slice(2).every((step) => step.cite === 'ERRATA sheet p.3, Three-Floor Elevator note'))
      .toBe(true);
  });

  it('pins diagram-only ER-02 handling and C2 printed-fixture provenance with untagged cited assertions', () => {
    const exp14 = load('I-EXP14');
    expect(exp14.as_printed.at(-1)).toBe('6V/D17');
    expect(exp14.errata_applied).toEqual([]);
    expect(exp14.note).toContain('ER-02 corrects only the circuit-diagram label');

    for (const id of C2_IDS) {
      const fixture = load(id);
      const asserts = fixture.script.filter((step) => step.k === 'expect' || step.k === 'until');
      const untagged = asserts.filter((step) => step.tag === undefined);
      expect(untagged.length, id).toBeGreaterThan(0);
      for (const step of untagged) {
        expect(step.cite, id).toBeTruthy();
        expect(step.cite, id).not.toMatch(/FALLBACK/i);
        expect(step.quote, id).toBeTruthy();
        expect(step.quote, id).not.toMatch(/FALLBACK/i);
      }
      expect(
        fixture.script.filter((step) => step.k === 'expect')
          .map((step) => step.obs?.map((obs) => obs.dev + '=' + obs.v).join(',')),
        id,
      ).toEqual(id === 'I-EXP12' ? ['breaker=ok'] : []);
      expect(fixture.note, id).toContain('profile fallbacks O-R1, O-R3, and O-R5');
      const reviewed = DIGESTS[id];
      expect(fixture.digest, id).toEqual({
        eventCount: reviewed[0],
        moverTransitions: reviewed[1],
      });
      expect(fixture.digest?.moverTransitions, id).toHaveLength(CHATTER_DEVICES.length);
    }
  });
});
