/**
 * Independent source pins for W4b's hand-authored Tier-A fixture inputs.
 *
 * The three source-PDF hashes bind the reviewed page images. W2's independently frozen KAT binds
 * every ordinary corpus wire array; the two additions not present in that KAT are literal here.
 * Quotes and observable projections are repeated here so a fixture edit cannot quietly turn a
 * source assertion into a derived one.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allocateHoles, parseTerminalWire } from '../../src/core/terminals.ts';
import { readManifest } from './manifest.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_DIR = ROOT + '/test/conformance/fixtures/A/';

const IDS = [
  'I-EXP1', 'I-EXP2', 'I-EXP3', 'I-EXP4', 'I-EXP5', 'I-EXP6', 'I-EXP7', 'I-EXP8-STEP5', 'I-EXP10',
  'II-EXP5', 'II-EXP6', 'III-3STMT', 'III-XOR-PB', 'III-RELAYAND', 'III-RELAYOR',
  'III-RELAYNOT', 'III-RELAYXOR', 'V-EXP1',
] as const;

type Id = (typeof IDS)[number];

interface FixtureStep {
  readonly k: string;
  readonly cmd?: Readonly<Record<string, unknown>>;
  readonly obs?: readonly { readonly dev: string; readonly v: string }[];
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
  readonly wires: readonly string[];
  readonly script: readonly FixtureStep[];
}

interface KatCase {
  readonly id: string;
  readonly wires: readonly { readonly id: number; readonly a: string; readonly b: string }[];
}

const SOURCE = Object.freeze<Record<Id, readonly [string, string]>>({
  'I-EXP1': ['BK1 printed p.5 = book1.pdf PDF p.7', 'likely'],
  'I-EXP2': ['BK1 printed p.7 = book1.pdf PDF p.9', 'likely'],
  'I-EXP3': ['BK1 printed p.9 = book1.pdf PDF p.11', 'likely'],
  'I-EXP4': ['BK1 printed p.10 = book1.pdf PDF p.12', 'verified'],
  'I-EXP5': ['BK1 printed p.11 = book1.pdf PDF p.13', 'verified'],
  'I-EXP6': ['BK1 printed p.13 = book1.pdf PDF p.15', 'verified'],
  'I-EXP7': ['BK1 printed pp.14-15 = book1.pdf PDF pp.16-17', 'verified'],
  'I-EXP8-STEP5': ['BK1 printed p.16 step 5 = book1.pdf PDF p.18', 'verified'],
  'I-EXP10': ['BK1 printed p.19 = book1.pdf PDF p.21', 'likely'],
  'II-EXP5': ['BK2 printed pp.13-14 = book2-3-4.pdf PDF pp.19-20', 'likely'],
  'II-EXP6': ['BK2 printed p.14 = book2-3-4.pdf PDF p.20; ERRATA sheet p.1', 'likely'],
  'III-3STMT': [
    'BK3 printed p.36 = book2-3-4.pdf PDF p.42; ER-07 replaces the diagram without changing the program list',
    'likely',
  ],
  'III-XOR-PB': ['BK3 printed p.41 = book2-3-4.pdf PDF p.47', 'verified'],
  'III-RELAYAND': ['BK3 printed p.43 = book2-3-4.pdf PDF p.49; ERRATA sheet p.2', 'verified'],
  'III-RELAYOR': ['BK3 printed p.43 = book2-3-4.pdf PDF p.49', 'verified'],
  'III-RELAYNOT': ['BK3 printed p.44 = book2-3-4.pdf PDF p.50', 'verified'],
  'III-RELAYXOR': [
    'BK3 printed p.44 = book2-3-4.pdf PDF p.50; derived truth-table expectations',
    'verified',
  ],
  'V-EXP1': ['BK5 printed p.2 = book5-6.pdf PDF p.8, image-read; ER-28', 'verified'],
});

function repeatedCite(count: number, cite: string): readonly string[] {
  return Object.freeze(new Array<string>(count).fill(cite));
}

const CITES = Object.freeze<Record<Id, readonly string[]>>({
  'I-EXP1': repeatedCite(1, 'BK1 printed p.5 = book1.pdf PDF p.7'),
  'I-EXP2': repeatedCite(1, 'BK1 printed p.7 = book1.pdf PDF p.9'),
  'I-EXP3': repeatedCite(2, 'BK1 printed p.9 = book1.pdf PDF p.11'),
  'I-EXP4': repeatedCite(3, 'BK1 printed p.10 = book1.pdf PDF p.12'),
  'I-EXP5': repeatedCite(4, 'BK1 printed p.11 = book1.pdf PDF p.13'),
  'I-EXP6': repeatedCite(2, 'BK1 printed p.13 = book1.pdf PDF p.15'),
  'I-EXP7': [
    'BK1 printed p.15 = book1.pdf PDF p.17',
    'BK1 printed pp.14-15 = book1.pdf PDF pp.16-17',
    'BK1 printed p.15 = book1.pdf PDF p.17',
  ],
  'I-EXP8-STEP5': [
    'BK1 printed p.16 step 5 = book1.pdf PDF p.18',
  ],
  'I-EXP10': repeatedCite(2, 'BK1 printed p.19 = book1.pdf PDF p.21'),
  'II-EXP5': [2, 3, 4, 5].map((step) =>
    `BK2 printed p.14 step ${step} = book2-3-4.pdf PDF p.20`),
  'II-EXP6': [2, 3, 4, 5].map((step) =>
    `BK2 printed p.14 step ${step} = book2-3-4.pdf PDF p.20`),
  'III-3STMT': repeatedCite(2, 'BK3 printed p.37 = book2-3-4.pdf PDF p.43'),
  'III-XOR-PB': repeatedCite(3, 'BK3 printed p.41 = book2-3-4.pdf PDF p.47'),
  'III-RELAYAND': repeatedCite(1, 'BK3 printed p.43 = book2-3-4.pdf PDF p.49; ER-12'),
  'III-RELAYOR': repeatedCite(2, 'BK3 printed p.43 = book2-3-4.pdf PDF p.49'),
  'III-RELAYNOT': repeatedCite(1, 'BK3 printed p.44 = book2-3-4.pdf PDF p.50'),
  'III-RELAYXOR': repeatedCite(4, 'BK3 printed p.44 = book2-3-4.pdf PDF p.50'),
  'V-EXP1': repeatedCite(4, 'BK5 printed p.2 diagram = book5-6.pdf PDF p.8; ER-28 = errata.pdf PDF p.3, Book V \'page 2\' entry'),
});

const QUOTES = Object.freeze<Record<Id, readonly string[]>>({
  'I-EXP1': ['These connections cause lamp 1 to light when the Power Switch is turned on.'],
  'I-EXP2': ['Light 1 comes ON because current flows through the light.'],
  'I-EXP3': [
    'Light 2 comes on as soon as power is turned ON.',
    'Push down on pushbutton 1. Light 2 goes OFF and light 1 comes ON.',
  ],
  'I-EXP4': [
    'It does NOT light because the connection from + to the light is broken by pushbutton 2.',
    'It still does NOT light because the connection from + to the light is now broken by pushbutton 1.',
    'Push down both pushbutton 1 and pushbutton 2 at the same time and see light 2 go ON.',
  ],
  'I-EXP5': [
    'The light does not come on because there is not a closed circuit.',
    'Push down pushbutton 1. Light 1 comes ON.',
    'Release pushbutton 1 and push down pushbutton 2. The light again comes ON.',
    'The circuit is closed and the light comes ON if either pushbutton 1 is down OR if pushbutton 2 is down OR if both pushbutton 1 and pushbutton 2 are down at the same time.',
  ],
  'I-EXP6': [
    'Turn power ON. Light 2 comes ON.',
    'Gently push the relay crossbar to the left. Light 2 goes OFF and light 1 comes ON.',
  ],
  'I-EXP7': [
    'Turn power ON. Light 2 comes ON.',
    'If the relay coil is energized by supplying power through contacts E and F, the light beneath the relay will NOT come on ... Press down pushbutton 1 and see the relay operate. ... Light 2 goes OFF and light 1 comes ON.',
    'To modify this program so that the coil indicator lamp will light when the coil of relay 1 is energized: remove connection 1X/1E; add connection 1X/1C.',
  ],
  'I-EXP8-STEP5': [
    'Expand the present circuit to use all six relays with each relay controlling the coil of the next. The last relay in the series, relay 6, should turn light 6 ON.',
  ],
  'I-EXP10': [
    'Light 1 comes ON but light 2 remains OFF.',
    'Move switch 1 to the right. Light 1 goes OFF and light 2 comes ON.',
  ],
  'II-EXP5': [
    'Turn power ON. Relay 3 comes ON because both numbers are zero.',
    'Push pushbutton 1. Relay 3 goes OFF because the numbers are no longer equal.',
    'Push pushbutton 2 while holding down pushbutton 1. Once again the numbers are equal (both are 1) and relay 3 comes ON.',
    'Release pushbutton 1 while holding down pushbutton 2. Relay 3 goes OFF because the numbers are not equal.',
  ],
  'II-EXP6': [
    'Turn power ON. No lights come on because the input numbers are both zero: 0 + 0 = 0',
    'Push pushbutton 1. Light 1 comes ON: 1 + 0 = 1',
    'Push pushbutton 2 while holding pushbutton 1 down. Light 2 comes ON: 1 + 1 = 2',
    'Release pushbutton 1 while holding pushbutton 2 down. Light 1 comes ON: 0 + 1 = 1.',
  ],
  'III-3STMT': [
    'Therefore both pushbutton 1 and pushbutton 2 must be pushed before light 3 comes ON.',
    'Using the circuit and representation indicated above, pushing both pushbutton 1 and pushbutton 2 indicates to the computer that both statements A and B are true ... it can indicate that statement C must also be true',
  ],
  'III-XOR-PB': [
    'The program uses the contacts so that if either pushbutton 1 or pushbutton 2 is pushed, light 3 will come ON.',
    'Light 3 will NOT come on if both pushbuttons 1 and 2 are pushed.',
    'The program uses the contacts so that if either pushbutton 1 or pushbutton 2 is pushed, light 3 will come ON.',
  ],
  'III-RELAYAND': [
    'Light 3 indicates when the "AND" condition is met—both relay 1 and relay 2 are closed (ON).',
  ],
  'III-RELAYOR': [
    'If either relay 1, controlled by pushbutton 1, or relay 2, controlled by pushbutton 2, are ON, then light 3 will come ON.',
    'If either relay 1, controlled by pushbutton 1, or relay 2, controlled by pushbutton 2, are ON, then light 3 will come ON.',
  ],
  'III-RELAYNOT': [
    'If relay 1 is not energized (is not ON) light 2 will come ON.',
  ],
  'III-RELAYXOR': [
    'The circuit and program below represent the EITHER BUT NOT BOTH condition using relays 1 and 2 controlled by pushbuttons 1 and 2 respectively.',
    'The circuit and program below represent the EITHER BUT NOT BOTH condition using relays 1 and 2 controlled by pushbuttons 1 and 2 respectively.',
    'The circuit and program below represent the EITHER BUT NOT BOTH condition using relays 1 and 2 controlled by pushbuttons 1 and 2 respectively.',
    'The circuit and program below represent the EITHER BUT NOT BOTH condition using relays 1 and 2 controlled by pushbuttons 1 and 2 respectively.',
  ],
  'V-EXP1': [
    'Note that moving either slide switch will change the light to the opposite state (ON or OFF), regardless of the position of the other slide switch.',
    'Note that moving either slide switch will change the light to the opposite state (ON or OFF), regardless of the position of the other slide switch.',
    'Note that moving either slide switch will change the light to the opposite state (ON or OFF), regardless of the position of the other slide switch.',
    'Note that moving either slide switch will change the light to the opposite state (ON or OFF), regardless of the position of the other slide switch.',
  ],
});

const PROJECTIONS = Object.freeze<Record<Id, readonly string[]>>({
  'I-EXP1': ['outLamp1=on'],
  'I-EXP2': ['outLamp1=on'],
  'I-EXP3': ['outLamp2=on', 'outLamp1=on,outLamp2=off'],
  'I-EXP4': ['outLamp2=off', 'outLamp2=off', 'outLamp2=on'],
  'I-EXP5': ['outLamp1=off', 'outLamp1=on', 'outLamp1=on', 'outLamp1=on'],
  'I-EXP6': ['outLamp2=on', 'outLamp1=on,outLamp2=off'],
  'I-EXP7': [
    'outLamp2=on',
    'outLamp1=on,outLamp2=off,indLamp1=off,relay1=no',
    'indLamp1=on,relay1=no',
  ],
  'I-EXP8-STEP5': ['outLamp6=on'],
  'I-EXP10': ['outLamp1=on,outLamp2=off', 'outLamp1=off,outLamp2=on'],
  'II-EXP5': ['relay3=no', 'relay3=nc', 'relay3=no', 'relay3=nc'],
  'II-EXP6': [
    'outLamp1=off,outLamp2=off', 'outLamp1=on',
    'outLamp2=on', 'outLamp1=on',
  ],
  'III-3STMT': ['outLamp3=off', 'outLamp3=on'],
  'III-XOR-PB': ['outLamp3=on', 'outLamp3=off', 'outLamp3=on'],
  'III-RELAYAND': ['outLamp3=on'],
  'III-RELAYOR': ['outLamp3=on', 'outLamp3=on'],
  'III-RELAYNOT': ['outLamp2=on'],
  'III-RELAYXOR': ['outLamp3=off', 'outLamp3=on', 'outLamp3=off', 'outLamp3=on'],
  'V-EXP1': ['outLamp1=on', 'outLamp1=off', 'outLamp1=on', 'outLamp1=off'],
});

const EXP8_BASE = Object.freeze([
  '1+/1Y', '1X/1C', '1F/1-', '1+/1H', '1G/2C', '2F/2-', '2+/2H', '2G/2A', '2B/2-',
]);
const EXP8_STEP5 = Object.freeze([
  '1+/1Y', '1X/1C', '1F/1-', '1+/1H', '1G/2C', '2F/2-', '2+/2H', '2G/3C',
  '3F/3-', '3+/3H', '3G/4C', '4F/4-', '4+/4H', '4G/5C', '5F/5-', '5+/5H',
  '5G/6C', '6F/6-', '6+/6H', '6G/6A', '6B/6-',
]);
const V_EXP1_WIRES = Object.freeze(['1A/1+', '1B/1V', '1U/2U', '1W/2W', '2V/2-']);

function loadFixture(id: Id): FixtureDoc {
  return JSON.parse(readFileSync(FIXTURE_DIR + id + '.fixture.json', 'utf8')) as FixtureDoc;
}

describe('Tier-A fixture reviewed inputs', () => {
  it('binds the three visually reviewed source volumes and applied errata', () => {
    const sources = [
      ['book1.pdf', 1707863, 'ae98e6578e1812702310b9883c96ed495d7a5e045e508ea5768a4ca47327355b'],
      ['book2-3-4.pdf', 2933205, '85a40731b0dbe9d9bd2c502155e22a78d26238ebd1c5f36dc8fd86436f8776f7'],
      ['book5-6.pdf', 1929436, '1dd73acaac0e84b1d6ea95eb112d809fd7a984fffe9ddb3bc8d7d0ce9becf6e4'],
      ['errata.pdf', 140730, '33ede94ea3663e0a7e5b303efc3d965907eb37ac1dcb804cfc220b65b78b83e9'],
    ] as const;
    for (const [file, size, hash] of sources) {
      const bytes = readFileSync(ROOT + '/docs/research/raw/pdf/' + file);
      expect(bytes.length, file).toBe(size);
      expect(createHash('sha256').update(bytes).digest('hex'), file).toBe(hash);
    }
  });

  it('pins its owned manifest entries, metadata, source quotes and observable projections', () => {
    const manifestPaths = new Set(readManifest().map((entry) => entry.path));
    expect(new Set(IDS).size).toBe(IDS.length);
    for (const id of IDS) expect(manifestPaths.has('A/' + id + '.fixture.json'), id).toBe(true);
    for (const id of IDS) {
      const raw = readFileSync(FIXTURE_DIR + id + '.fixture.json');
      expect(raw[0], id).not.toBe(0xef);
      expect(raw.includes(0x0d), id).toBe(false);

      const fixture = loadFixture(id);
      const expectedSource = SOURCE[id];
      const expects = fixture.script.filter((step) => step.k === 'expect');
      expect(fixture.schema, id).toBe('minivac.fixture/1');
      expect(fixture.id, id).toBe(id);
      expect(fixture.source, id).toBe(expectedSource[0]);
      expect(fixture.tier, id).toBe('A');
      expect(fixture.confidence, id).toBe(expectedSource[1]);
      expect(fixture.profile, id).toBe('MV601-REF-A');
      expect(fixture.contract, id).toBe('1.1.0');
      expect(expects.map((step) => step.cite), id).toEqual(CITES[id]);
      expect(expects.map((step) => step.quote), id).toEqual(QUOTES[id]);
      expect(expects.map((step) => step.obs?.map((obs) => obs.dev + '=' + obs.v).join(',')), id)
        .toEqual(PROJECTIONS[id]);
      for (const step of expects) {
        expect(step.quote, id).toBeTruthy();
      }
      const parsed = fixture.wires.map(parseTerminalWire);
      expect(allocateHoles(parsed), id).toHaveLength(fixture.wires.length);
    }
  });

  it('matches the independently frozen W2 corpus wire arrays', () => {
    const kat = JSON.parse(readFileSync(ROOT + '/data/kat/netlist-kat.json', 'utf8')) as {
      readonly cases: readonly KatCase[];
    };
    for (const id of IDS) {
      if (id === 'I-EXP8-STEP5' || id === 'V-EXP1') continue;
      const sourceId = id;
      const sourceCase = kat.cases.find((entry) => entry.id === sourceId);
      expect(sourceCase, id).toBeDefined();
      expect(sourceCase?.wires.map((wire, index) => {
        expect(wire.id, id).toBe(index);
        return wire.a + '/' + wire.b;
      }), id).toEqual(loadFixture(id).wires);
    }
  });

  it('pins the printed Step-5 base, its literal six-relay expansion, and V-EXP1 image read', () => {
    const exp8 = loadFixture('I-EXP8-STEP5');
    expect(exp8.as_printed).toEqual(EXP8_BASE);
    expect(exp8.wires).toEqual(EXP8_STEP5);
    const vExp1 = loadFixture('V-EXP1');
    expect(vExp1.as_printed).toEqual(V_EXP1_WIRES);
    expect(vExp1.wires).toEqual(V_EXP1_WIRES);
  });

  it('pins both program corrections positively and leaves all other arrays source-identical', () => {
    const exp6 = loadFixture('II-EXP6');
    expect(exp6.as_printed[4]).toBe('2Z/2C');
    expect(exp6.errata_applied).toEqual([{ id: 'ER-06', from: '2Z/2C', to: '2X/2C' }]);
    expect(exp6.wires[4]).toBe('2X/2C');

    const relayAnd = loadFixture('III-RELAYAND');
    expect(relayAnd.as_printed[7]).toBe('2+/2H');
    expect(relayAnd.errata_applied).toEqual([{ id: 'ER-12', from: '2+/2H', to: '1G/2H' }]);
    expect(relayAnd.wires[7]).toBe('1G/2H');

    for (const id of IDS) {
      if (id === 'II-EXP6' || id === 'III-RELAYAND' || id === 'I-EXP8-STEP5') continue;
      const fixture = loadFixture(id);
      expect(fixture.errata_applied, id).toEqual([]);
      expect(fixture.as_printed, id).toEqual(fixture.wires);
    }
  });

  it('confines derived expectations to the two reviewed fallback fixtures', () => {
    for (const id of IDS) {
      const expects = loadFixture(id).script.filter((step) => step.k === 'expect');
      if (id === 'III-RELAYXOR') {
        expect(expects).toHaveLength(4);
        for (const step of expects) {
          expect(step.tag).toBe('unverified');
          expect(step.source).toBe('FALLBACK-RELAYXOR-TRUTH-TABLE');
        }
      } else if (id === 'V-EXP1') {
        expect(expects).toHaveLength(4);
        for (const step of expects) {
          expect(step.tag).toBe('unverified');
          expect(step.source).toBe('FALLBACK-V-EXP1-TOPOLOGY');
        }
      } else {
        expect(expects.some((step) => step.tag !== undefined || step.source !== undefined), id)
          .toBe(false);
      }
    }
  });

  it('pins I-EXP7 as the printed power-off E-to-C cord substitution', () => {
    const fixture = loadFixture('I-EXP7');
    const commands = fixture.script.filter((step) => step.k === 'do').map((step) => step.cmd);
    expect(commands).toEqual([
      { k: 'power', on: true },
      { k: 'button', n: 1, target: 1000 },
      { k: 'power', on: false },
      { k: 'disconnect', cord: 6 },
      {
        k: 'connect', cord: 6,
        a: { k: 'hole', hole: '1X#1' }, b: { k: 'hole', hole: '1C#1' },
      },
      { k: 'button', n: 1, target: 0 },
      { k: 'power', on: true },
      { k: 'button', n: 1, target: 1000 },
    ]);
  });

  it('pins I-EXP6 as a held manual crossbar move back and forth', () => {
    const fixture = loadFixture('I-EXP6');
    const commands = fixture.script.filter((step) => step.k === 'do').map((step) => step.cmd);
    expect(commands).toEqual([
      { k: 'power', on: true },
      { k: 'relayGrab', n: 1, target: 1000 },
      { k: 'relayGrab', n: 1, target: 0 },
    ]);
  });
});
