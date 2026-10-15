/**
 * Independent source pins for W5a's eight hand-authored Tier-B fixtures.
 *
 * The PDF hashes bind the cited primary bytes. Literal wires, quotes and observable projections
 * keep a fixture edit from silently changing the reviewed input while updating its own golden.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allocateHoles, parseTerminalWire } from '../../src/core/terminals.ts';
import { readManifest } from './manifest.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_DIR = ROOT + '/test/conformance/fixtures/B/';
const IDS = [
  'I-EXP9', 'II-MANUALMEM', 'II-SELFLOCK', 'II-2BUTTONMEM',
  'II-FF1', 'IV-FF1', 'IV-FF2', 'IV-FF2-CARRY',
] as const;
type Id = (typeof IDS)[number];

interface Step {
  readonly k: string;
  readonly cmd?: Readonly<Record<string, unknown>>;
  readonly collapse?: true;
  readonly obs?: readonly { readonly dev: string; readonly v: string }[];
  readonly cite?: string;
  readonly quote?: string;
  readonly tag?: string;
  readonly source?: string;
}

interface FixtureDoc {
  readonly id: string;
  readonly source: string;
  readonly tier: string;
  readonly confidence: string;
  readonly profile: string;
  readonly contract: string;
  readonly as_printed: readonly string[];
  readonly errata_applied: readonly Readonly<Record<string, string>>[];
  readonly wires: readonly string[];
  readonly script: readonly Step[];
  readonly marginal?: true;
  readonly mechanism?: Readonly<{ profileKey: string; decision: string }>;
  readonly note?: string;
}

interface KatCase {
  readonly id: string;
  readonly wires: readonly { readonly id: number; readonly a: string; readonly b: string }[];
}

const WIRES = Object.freeze<Record<Id, readonly string[]>>({
  'I-EXP9': ['1F/1-', '1C/1X', '1Y/2Y', '2Y/2+', '2Z/1L', '1K/1C'],
  'II-MANUALMEM': ['1+/1Y', '1+/1H', '1X/1C', '1-/1F', '1G/1A', '1B/1-'],
  'II-SELFLOCK': ['1+/1Y', '1+/1H', '1X/1C', '1-/1F', '1G/1A', '1B/1-', '1C/1A'],
  'II-2BUTTONMEM': ['1+/1Y', '1+/1H', '1X/1C', '1G/1C', '1B/1-', '2-/2Y', '2Z/1F', '1A/1G'],
  'II-FF1': [
    '1-/1B', '1-/1C', '1A/1E', '1E/2G', '1F/2F', '1H/1F', '1G/1Y',
    '1Y/1+', '1X/1J', '1J/2H', '2J/2E', '2E/2A', '2B/2-', '2-/2C',
  ],
  'IV-FF1': [
    '5+/5H', '5H/6H', '5G/5F', '6G/6F', '5C/6C', '6C/6-', '6H/6Y', '6X/5L',
    '5K/6F', '5N/6E', '6Z/6L', '6K/5E', '6N/5F', '6G/6A', '6B/6-',
  ],
  'IV-FF2': [
    '5+/5G', '5H/5F', '5F/6F', '5C/6C', '6C/6-', '5J/6H', '6G/5E',
    '6J/6E', '6E/6A', '6B/6-', '5H/5A', '5B/5-', '6+/6Y', '6X/6H',
  ],
  'IV-FF2-CARRY': [
    '5+/5G', '5H/5F', '5F/6F', '5C/6C', '6C/6-', '5J/6H', '6G/5E',
    '6J/6E', '6E/6A', '6B/6-', '5H/5A', '5B/5-', '6+/6Y', '6X/6H',
    '5G/5N', '5L/6L', '6K/4A', '4B/4-',
  ],
});

const AS_PRINTED_2BUTTON = Object.freeze([
  '1+/1Y', '1+/1H', '1X/1C', '1G/1C', '1B/1-', '2-/2Y', '2Z/1F', '1A/1C',
]);

const SOURCE = Object.freeze<Record<Id, readonly [string, string]>>({
  'I-EXP9': ['BK1 printed p.17 = book1.pdf PDF p.19', 'verified'],
  'II-MANUALMEM': ['BK2 printed p.10 = book2-3-4.pdf PDF p.16', 'likely'],
  'II-SELFLOCK': ['BK2 printed pp.10-11 = book2-3-4.pdf PDF pp.16-17', 'likely'],
  'II-2BUTTONMEM': ['BK2 printed p.11 = book2-3-4.pdf PDF p.17; ERRATA sheet p.1', 'verified'],
  'II-FF1': ['BK2 printed pp.11-12 = book2-3-4.pdf PDF pp.17-18', 'verified'],
  'IV-FF1': ['BK4 printed pp.68-69 = book2-3-4.pdf PDF pp.74-75; ERRATA sheet p.2', 'likely'],
  'IV-FF2': ['BK4 printed p.70 = book2-3-4.pdf PDF p.76', 'verified'],
  'IV-FF2-CARRY': ['BK4 printed p.70 = book2-3-4.pdf PDF p.76', 'verified'],
});

const QUOTES = Object.freeze<Record<Id, readonly string[]>>({
  'I-EXP9': [
    'Push pushbutton 1 and release. The relay indicator light comes ON and stays ON.',
    'Push pushbutton 2 and release. This momentarily interrupts current flow through the coil and turns the relay OFF.',
  ],
  'II-MANUALMEM': [
    'This simple circuit may be thought of as a manual memory: as long as the pushbutton is being held DOWN, the relay remembers a one.',
    'When the pushbutton is released, the relay forgets the one and starts remembering a zero.',
  ],
  'II-SELFLOCK': [
    'The manual memory relay circuit above can be easily modified to achieve this by using one of the switches of the relay to continue to supply current to the coil of the relay after the pushbutton has been released.',
    'The evident difficulty with this self-locking relay memory circuit is that, although the relay will now remember a 1 once it is told to remember 1, it cannot forget 1 unless the current to the computer is turned off.',
  ],
  'II-2BUTTONMEM': [
    'Pushbutton 1 serves as the "forget 0 remember 1" signal and pushbutton 2 provides the "forget 1 remember 0" signal.',
    'Pushbutton 1 serves as the "forget 0 remember 1" signal and pushbutton 2 provides the "forget 1 remember 0" signal.',
    'Pushbutton 1 serves as the "forget 0 remember 1" signal and pushbutton 2 provides the "forget 1 remember 0" signal.',
  ],
  'II-FF1': [
    'Light 1 will be OFF when the flip-flop is remembering a 0.',
    'If the relays are remembering a 0, pushing pushbutton 1 will signal them to "stop remembering 0 and start remembering 1".',
    'If the relays are remembering a 1, pushing pushbutton 1 will signal them to "forget 1 and start remembering 0".',
  ],
  'IV-FF1': [
    'Light 6 will go off and on, indicating the state of the whole flip-flop.',
    'push pushbutton 6 slowly when operating the single-input flip-flop. Light 6 will go off and on, indicating the state of the whole flip-flop.',
    'push pushbutton 6 slowly when operating the single-input flip-flop. Light 6 will go off and on, indicating the state of the whole flip-flop.',
  ],
  'IV-FF2': [
    'Turn power ON. Notice that both relays 5 and 6 are OFF.',
    'Push and release pushbutton 6. Notice that both relays 5 and 6 are now ON.',
    'Push pushbutton 6, but do not release. Notice that relay 5 is OFF; relay 6 is ON.',
  ],
  'IV-FF2-CARRY': [
    'Turn power ON. Notice that both relays 5 and 6 are OFF.',
    'Push and release pushbutton 6. Notice that both relays 5 and 6 are now ON.',
    'Push pushbutton 6, but do not release. Notice that relay 5 is OFF; relay 6 is ON.',
  ],
});

const CITES = Object.freeze<Record<Id, readonly string[]>>({
  'I-EXP9': [
    'BK1 printed p.17 = book1.pdf PDF p.19',
    'BK1 printed p.17 = book1.pdf PDF p.19',
  ],
  'II-MANUALMEM': [
    'BK2 printed p.10 = book2-3-4.pdf PDF p.16',
    'BK2 printed p.10 = book2-3-4.pdf PDF p.16',
  ],
  'II-SELFLOCK': [
    'BK2 printed p.10 = book2-3-4.pdf PDF p.16',
    'BK2 printed p.11 = book2-3-4.pdf PDF p.17',
  ],
  'II-2BUTTONMEM': [
    'BK2 printed p.11 = book2-3-4.pdf PDF p.17',
    'BK2 printed p.11 = book2-3-4.pdf PDF p.17',
    'BK2 printed p.11 = book2-3-4.pdf PDF p.17',
  ],
  'II-FF1': [
    'BK2 printed p.11 = book2-3-4.pdf PDF p.17; cold-start phase not printed',
    'BK2 printed p.11 = book2-3-4.pdf PDF p.17',
    'BK2 printed p.11 = book2-3-4.pdf PDF p.17',
  ],
  'IV-FF1': [
    'ERRATA sheet PDF p.2; cold-start phase not printed',
    'ERRATA sheet PDF p.2, BOOK IV printed p.69; absolute phase rests on the cold-start fallback',
    'ERRATA sheet PDF p.2, BOOK IV printed p.69; absolute phase rests on the cold-start fallback',
  ],
  'IV-FF2': [
    'BK4 printed p.70 step 1 = book2-3-4.pdf PDF p.76',
    'BK4 printed p.70 step 2 = book2-3-4.pdf PDF p.76',
    'BK4 printed p.70 step 3 = book2-3-4.pdf PDF p.76',
  ],
  'IV-FF2-CARRY': [
    'BK4 printed p.70 step 1 = book2-3-4.pdf PDF p.76; stated for the 14-wire circuit before the carry wires are added',
    'BK4 printed p.70 step 2 = book2-3-4.pdf PDF p.76; stated for the 14-wire circuit before the carry wires are added',
    'BK4 printed p.70 step 3 = book2-3-4.pdf PDF p.76; stated for the 14-wire circuit before the carry wires are added',
  ],
});

const PROJECTIONS = Object.freeze<Record<Id, readonly string[]>>({
  'I-EXP9': ['relay1=no,pb1=nc,indLamp1=on', 'relay1=nc,pb2=nc,indLamp1=off'],
  'II-MANUALMEM': ['relay1=no,pb1=no', 'relay1=nc,pb1=nc'],
  'II-SELFLOCK': ['relay1=no,pb1=nc', 'relay1=nc'],
  'II-2BUTTONMEM': ['relay1=no', 'relay1=nc', 'relay1=no'],
  'II-FF1': ['outLamp1=off', 'outLamp1=on', 'outLamp1=off'],
  'IV-FF1': ['outLamp6=off', 'outLamp6=on', 'outLamp6=off'],
  'IV-FF2': ['relay5=nc,relay6=nc', 'relay5=no,relay6=no,pb6=nc', 'relay5=nc,relay6=no,pb6=no'],
  'IV-FF2-CARRY': ['relay5=nc,relay6=nc', 'relay5=no,relay6=no', 'relay5=nc,relay6=no'],
});

const MARGINAL_DECISION =
  'docs/DECISIONS.md#2026-09-01-canonical-marginal-counter-ruling-after-w1';
const MARGINAL_IDS = ['IV-FF2', 'IV-FF2-CARRY'] as const;
const KNIFE_EDGE_NOTE =
  "Modeled release-path quantization knife edge: under REF-A, relay 5 drops out at tick t=1498 with 17,789 uA against its 17,793-uA threshold, a 4-uA margin. This carve-out does not attribute SDC's documented physical counter marginality to L_coil_uh or identify its physical cause.";
const MARGINAL_NOTES = Object.freeze<Record<'IV-FF2' | 'IV-FF2-CARRY', string>>({
  'IV-FF2': KNIFE_EDGE_NOTE,
  'IV-FF2-CARRY': 'The page says light 4 indicates carry but prints no absolute light-4 value; ' +
    'this fixture does not invent one. ' + KNIFE_EDGE_NOTE,
});

function fixture(id: Id): FixtureDoc {
  return JSON.parse(readFileSync(FIXTURE_DIR + id + '.fixture.json', 'utf8')) as FixtureDoc;
}

describe('Tier-B fixture reviewed inputs', () => {
  it('binds the three cited source PDFs', () => {
    const sources = [
      ['book1.pdf', 1707863, 'ae98e6578e1812702310b9883c96ed495d7a5e045e508ea5768a4ca47327355b'],
      ['book2-3-4.pdf', 2933205, '85a40731b0dbe9d9bd2c502155e22a78d26238ebd1c5f36dc8fd86436f8776f7'],
      ['errata.pdf', 140730, '33ede94ea3663e0a7e5b303efc3d965907eb37ac1dcb804cfc220b65b78b83e9'],
    ] as const;
    for (const [name, size, hash] of sources) {
      const bytes = readFileSync(ROOT + '/docs/research/raw/pdf/' + name);
      expect(bytes.length, name).toBe(size);
      expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(hash);
    }
  });

  it('contains the registered eight W5a fixtures with pinned metadata and wires', () => {
    const manifestPaths = new Set(readManifest().map((entry) => entry.path));
    for (const id of IDS) expect(manifestPaths.has('B/' + id + '.fixture.json'), id).toBe(true);
    for (const id of IDS) {
      const doc = fixture(id);
      expect(doc.id).toBe(id);
      expect([doc.source, doc.confidence]).toEqual(SOURCE[id]);
      expect(doc.tier).toBe('B');
      expect(doc.profile).toBe('MV601-REF-A');
      expect(doc.contract).toBe('1.1.0');
      expect(doc.wires).toEqual(WIRES[id]);
      expect(() => allocateHoles(doc.wires.map(parseTerminalWire))).not.toThrow();
      if (id !== 'II-2BUTTONMEM') expect(doc.as_printed).toEqual(WIRES[id]);
    }
  });

  it('pins ER-05 positively without treating prose-only ER-04/ER-19 as wire substitutions', () => {
    const corrected = fixture('II-2BUTTONMEM');
    expect(corrected.as_printed).toEqual(AS_PRINTED_2BUTTON);
    expect(corrected.errata_applied).toEqual([{ id: 'ER-05', from: '1A/1C', to: '1A/1G' }]);
    for (const id of IDS.filter((value) => value !== 'II-2BUTTONMEM')) {
      expect(fixture(id).errata_applied, id).toEqual([]);
    }
  });

  it('matches the four independently frozen W2 KAT wire inputs', () => {
    const kat = JSON.parse(readFileSync(ROOT + '/data/kat/netlist-kat.json', 'utf8')) as {
      readonly cases: readonly KatCase[];
    };
    for (const id of ['II-MANUALMEM', 'II-SELFLOCK', 'II-2BUTTONMEM', 'II-FF1'] as const) {
      const row = kat.cases.find((candidate) => candidate.id === id);
      expect(row, id).toBeDefined();
      expect(row?.wires.map((wire) => wire.a + '/' + wire.b), id).toEqual(WIRES[id]);
    }
  });

  it('pins every printed/fallback citation, quote and observable projection', () => {
    for (const id of IDS) {
      const expectations = fixture(id).script.filter((step) => step.k === 'expect');
      expect(expectations.map((step) => step.cite), id).toEqual(CITES[id]);
      expect(expectations.map((step) => step.quote), id).toEqual(QUOTES[id]);
      expect(expectations.map((step) => step.obs?.map((obs) => obs.dev + '=' + obs.v).join(',')), id)
        .toEqual(PROJECTIONS[id]);
    }
    const fallbacks = IDS.flatMap((id) => fixture(id).script.map((step, scriptIndex) => ({
      id, scriptIndex, cite: step.cite, source: step.source, tag: step.tag,
    }))).filter((row) => row.tag === 'unverified');
    expect(fallbacks).toEqual([
      {
        id: 'II-FF1',
        scriptIndex: 2,
        cite: 'BK2 printed p.11 = book2-3-4.pdf PDF p.17; cold-start phase not printed',
        source: 'FALLBACK-PWRUP-COLD',
        tag: 'unverified',
      },
      {
        id: 'IV-FF1',
        scriptIndex: 2,
        cite: 'ERRATA sheet PDF p.2; cold-start phase not printed',
        source: 'FALLBACK-PWRUP-COLD',
        tag: 'unverified',
      },
      {
        id: 'IV-FF1',
        scriptIndex: 9,
        cite: 'ERRATA sheet PDF p.2, BOOK IV printed p.69; absolute phase rests on the cold-start fallback',
        source: 'FALLBACK-PWRUP-COLD',
        tag: 'unverified',
      },
      {
        id: 'IV-FF1',
        scriptIndex: 16,
        cite: 'ERRATA sheet PDF p.2, BOOK IV printed p.69; absolute phase rests on the cold-start fallback',
        source: 'FALLBACK-PWRUP-COLD',
        tag: 'unverified',
      },
      {
        id: 'IV-FF2-CARRY',
        scriptIndex: 2,
        cite: 'BK4 printed p.70 step 1 = book2-3-4.pdf PDF p.76; stated for the 14-wire circuit before the carry wires are added',
        source: 'FALLBACK-FF2-CARRY-BASE-CIRCUIT',
        tag: 'unverified',
      },
      {
        id: 'IV-FF2-CARRY',
        scriptIndex: 7,
        cite: 'BK4 printed p.70 step 2 = book2-3-4.pdf PDF p.76; stated for the 14-wire circuit before the carry wires are added',
        source: 'FALLBACK-FF2-CARRY-BASE-CIRCUIT',
        tag: 'unverified',
      },
      {
        id: 'IV-FF2-CARRY',
        scriptIndex: 10,
        cite: 'BK4 printed p.70 step 3 = book2-3-4.pdf PDF p.76; stated for the 14-wire circuit before the carry wires are added',
        source: 'FALLBACK-FF2-CARRY-BASE-CIRCUIT',
        tag: 'unverified',
      },
    ]);
    expect(fixture('IV-FF2-CARRY').script.some((step) =>
      step.obs?.some((obs) => obs.dev === 'outLamp4'))).toBe(false);
  });

  it('pins the exact modeled knife-edge carve-out without making a physical-cause claim', () => {
    const marginal = IDS.filter((id) => fixture(id).marginal === true);
    expect(marginal).toEqual(MARGINAL_IDS);
    for (const id of MARGINAL_IDS) {
      const doc = fixture(id);
      expect(doc.mechanism, id).toEqual({
        profileKey: 'L_coil_uh',
        decision: MARGINAL_DECISION,
      });
      expect(doc.note, id).toBe(MARGINAL_NOTES[id]);
    }
  });

  it('pins II-2BUTTONMEM reset followed by the source-defined remember-1 signal', () => {
    const buttonTargets = fixture('II-2BUTTONMEM').script.flatMap((step) => {
      if (step.k !== 'do' || step.cmd?.['k'] !== 'button') return [];
      return [String(step.cmd['n']) + '=' + String(step.cmd['target'])];
    });
    expect(buttonTargets).toEqual(['1=1000', '1=0', '2=1000', '2=0', '1=1000', '1=0']);
  });

  it('keeps every source-required release explicit, settled and tagged for collapse', () => {
    for (const id of IDS) {
      const script = fixture(id).script;
      const releases = script.map((step, index) => ({ step, index })).filter(({ step }) =>
        step.k === 'do' && step.cmd?.['k'] === 'button' && step.cmd['target'] === 0);
      expect(releases.length, id).toBeGreaterThan(0);
      for (const { step, index } of releases) {
        expect(step.collapse, id + ' script[' + index + ']').toBe(true);
        const section = step.cmd?.['n'];
        let press = -1;
        for (let at = index - 1; at >= 0; at--) {
          const prior = script[at];
          if (prior?.k === 'do' && prior.cmd?.['k'] === 'button' &&
              prior.cmd['n'] === section && prior.cmd['target'] === 1000) {
            press = at;
            break;
          }
        }
        expect(press, id + ' matching press').toBeGreaterThanOrEqual(0);
        expect(script.slice(press + 1, index).some((prior) => prior.k === 'settle'),
          id + ' settle between press and release').toBe(true);
        expect(script[index + 1]?.k, id + ' post-release settle').toBe('settle');
      }
    }
  });
});
