/** Pins the public demo library (`data/demo-library.json`) against source-owned expectations. */
import Ajv2020 from 'ajv/dist/2020.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import productionDocument from '../data/demo-library.json';
import schema from '../data/demo-library.schema.json';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
type ProductionConnection = string | { readonly wire: string; readonly r_uohm: number };
const COUNTER_NOTICE =
  'SDC supplied a second wiring for this counter.\n\n' +
  "SDC's errata warns that Book IV's three-bit counter can strain the relays, and adds bypass " +
  'paths so the relay coils receive full voltage and pull in more reliably. Both published ' +
  'wirings are included here.\n\n' +
  "The simulator's six relay thresholds use an unmeasured fallback. The available evidence does " +
  'not establish why the physical counter was marginal, and this simulation does not claim to ' +
  'reproduce that cause.';
const COMBOLOCK_NOTICE = 'To re-set the game, turn the rotary switch through one complete revolution.';
const MORSE_NOTICE =
  'Dial plate (Book V printed p.33): each letter and the rotary switch numbers it covers.\n' +
  'Band 1 (read light 3): E 0-7, T 8-15.\n' +
  'Band 2 (read lights 3-4): I 0-3, A 4-7, N 8-11, M 12-15.\n' +
  'Band 3 (read lights 3-5): S 0-1, U 2-3, R 4-5, W 6-7, D 8-9, K 10-11, G 12-13, O 14-15.\n' +
  'Band 4 (read lights 3-6): H 0, V 1, F 2, L 4, P 6, J 7, B 8, X 9, C 10, Y 11, Z 12, Q 13.\n' +
  'Always turn the rotary switch (pointer knob) clockwise.';

export const DEMO_SOURCE_MANIFEST = Object.freeze([
  {
    id: 'IV-EXP1', title: 'Original three-bit counter', category: 'counter', connections: 44,
    locator: 'Book IV printed pp.71-72 = book2-3-4.pdf PDF pp.77-78',
    confidence: 'verified', errata: ['ER-20', 'ER-21'], fallbacks: [],
    wireSha256: 'ae1e587f3abf52b7ab4bd6b2b2b4a6368cd67cbb2efbbb38df0aecb9fb4b29ff',
  },
  {
    id: 'ER-ALTCOUNTER', title: 'SDC alternate three-bit counter', category: 'counter', connections: 48,
    locator: 'errata.pdf p.2 right column', confidence: 'verified', errata: [], fallbacks: [],
    wireSha256: '62b27eb7819a8206f99bbf8de77e0c4cdc437f3e5e2e27009cc0275aa5acd034',
  },
  {
    id: 'VI-TICTACTOE', title: 'Tic-Tac-Toe', category: 'game', connections: 72,
    locator: 'Book VI printed pp.55-56 = book5-6.pdf PDF pp.61-62',
    confidence: 'verified', errata: ['ER-44'], fallbacks: ['FALLBACK-TTT-RING-CW'],
    wireSha256: 'e5ab782ae2232e1062ac4c8e58579349cb1efe87e151e5dbf685ff193b7afb72',
  },
  {
    id: 'V-JOBSELECT', title: 'Mate Selection', category: 'comparison', connections: 30,
    locator: 'Book V printed pp.41-43 = book5-6.pdf PDF pp.48-49',
    confidence: 'verified', errata: [], fallbacks: [],
    wireSha256: '7189d1344ab2130cafea7b9330a1866a99ba77fdd9bf04869bf32c3ba6670bf1',
  },
  {
    id: 'VI-RANDOM', title: 'Four-sided die', category: 'random', connections: 40,
    locator: 'Book VI printed pp.58-59 = book5-6.pdf PDF pp.64-65',
    confidence: 'verified', errata: [], fallbacks: [],
    wireSha256: '4327040d7249289efbb3d413f38246400a9ad6a9565a3332ecbf6999a7833c2c',
  },
  {
    id: 'III-RELAYAND', title: 'Relay AND', category: 'logic', connections: 10,
    locator: 'Book III printed p.43 = book2-3-4.pdf PDF p.49; ER-12',
    confidence: 'verified', errata: ['ER-12'], fallbacks: [],
    wireSha256: '753465e23503cd579d457c25c2457fbccb7879a1a872ba3db175360cc655820c',
  },
  {
    id: 'III-RELAYOR', title: 'Relay OR', category: 'logic', connections: 11,
    locator: 'Book III printed p.43 = book2-3-4.pdf PDF p.49',
    confidence: 'verified', errata: [], fallbacks: [],
    wireSha256: '184819a892f1155a0d95bf38a3c35321083557c7194a93905dfcbd5ee05d58e4',
  },
  {
    id: 'III-RELAYNOT', title: 'Relay NOT', category: 'logic', connections: 6,
    locator: 'Book III printed p.44 = book2-3-4.pdf PDF p.50',
    confidence: 'verified', errata: [], fallbacks: [],
    wireSha256: '9f7509fc70205dbbd4f20796752e0343c521eb1de100d8d13f7e0c7247a16bed',
  },
  {
    id: 'III-RELAYXOR', title: 'Relay XOR', category: 'logic', connections: 11,
    locator: 'Book III printed p.44 = book2-3-4.pdf PDF p.50',
    confidence: 'verified', errata: [], fallbacks: [],
    wireSha256: 'd1ead981ef5b9a6e860c5c6d46aa9ff618054f05a30da05e70aaa9d2b752560e',
  },
  {
    id: 'V-EXP2', title: 'Burglar Alarm', category: 'alarm', connections: 16,
    locator: 'Book V printed p.3 = book5-6.pdf PDF p.9',
    confidence: 'verified', errata: [], fallbacks: [],
    wireSha256: '400aeae966ca406c18b00fe466049a6e0060a8f3640a1f04ec2a0227cb214bb4',
  },
  {
    id: 'IV-FF2', title: 'Two-relay flip-flop', category: 'memory', connections: 14,
    locator: 'Book IV printed p.70 = book2-3-4.pdf PDF p.76',
    confidence: 'verified', errata: [], fallbacks: [],
    wireSha256: '3a3657827b5e2fb5b99fb48795f45a8ed22bf6cbe204fed692745b5ee986f024',
  },
  {
    id: 'V-EXP4', title: 'Traffic Light', category: 'control', connections: 22,
    locator: 'Book V printed pp.4-5 = book5-6.pdf PDF pp.10-11',
    confidence: 'verified', errata: [], fallbacks: [],
    wireSha256: 'a84ebfe0e20f9bd1a28775fd859935ff35d962f604282a85bbda54e91027218c',
  },
  {
    id: 'VI-SPS', title: 'Scissors, Paper or Stone', category: 'game', connections: 41,
    locator: 'Book VI printed p.59 = book5-6.pdf PDF p.65',
    confidence: 'verified', errata: [], fallbacks: [],
    wireSha256: 'f0bf59b28541a7d41051ab8fe9b1b93d537ca882ca580dbb84999a5dfdf60f23',
  },
  {
    id: 'VI-COMBOLOCK', title: 'Combination Lock', category: 'lock', connections: 46,
    locator: 'Book VI printed pp.52-53 = book5-6.pdf PDF pp.58-59',
    confidence: 'likely', errata: ['ER-41'], fallbacks: [],
    wireSha256: '28f80c8ee5383cca7f4482395054373c909b2e7bf3280ef4de82d1b820a8d5df',
  },
  {
    id: 'V-EXP19', title: 'Morse Code Encoder', category: 'code', connections: 49,
    locator: 'Book V printed pp.32-34 = book5-6.pdf PDF pp.38-40',
    confidence: 'verified', errata: ['ER-38'], fallbacks: [],
    wireSha256: '49bc3c47624636ac78094ce80e11ee768ed7af29f6a2fca2fed1278f30e376e6',
  },
  {
    id: 'VI-REACTION', title: 'Reaction Time Tester', category: 'game', connections: 51,
    locator: 'Book VI printed p.60 = book5-6.pdf PDF p.66',
    confidence: 'verified', errata: ['ER-46'], fallbacks: [],
    wireSha256: '69bff6ebda92f9abb9603f5b8d91395949589a9fab86bb5f998ff5f02f7dd08a',
  },
  {
    id: 'IV-EXP4', title: 'Half-Adder', category: 'arithmetic', connections: 8,
    locator: 'Book IV printed p.75 = book2-3-4.pdf PDF p.81',
    confidence: 'verified', errata: [], fallbacks: [],
    wireSha256: '468862a16a5694ba0fdec6151d0be9064609bd402c3f9416d35c5cb227f48a6b',
  },
] as const);

const DEMO_PUBLIC_COPY = Object.freeze([
  {
    id: 'IV-EXP1',
    instructions: [
      'Turn power on.',
      'Push and release pushbutton 6 once for each count.',
      'Read lights 4, 5, and 6 as the 4, 2, and 1 bits.',
    ],
    controlLabels: { button6: 'Count' },
  },
  {
    id: 'ER-ALTCOUNTER',
    instructions: [
      'Turn power on.',
      'Push and release pushbutton 6 once for each count, holding it long enough for carry to propagate.',
      'Observe lights 4, 5, and 6 after each count.',
    ],
    controlLabels: { button6: 'Count' },
  },
  {
    id: 'VI-TICTACTOE',
    instructions: [
      "Turn power on, then place the machine's M10 play-wire end in 6com.",
      'Hold pushbutton 6 while pressing pushbutton 1 for the first move; release both.',
      "For later turns, place the M10 end in the bottom matrix hole for the machine's last move and the M11 end in the top hole for the player's move.",
      'Hold pushbutton 6 while pressing the numbered pushbutton for the turn.',
      'Free both play-wire ends before starting another game.',
    ],
    controlLabels: {
      button1: 'First move', button2: 'Second move', button3: 'Third move',
      button4: 'Fourth move', button5: 'Fifth move', button6: 'Compute move',
    },
  },
  {
    id: 'V-JOBSELECT',
    instructions: [
      'Enter one person\'s replies on slide switches 1 through 6: left for a and right for b.',
      'Enter the other person\'s replies with pushbuttons 1 through 6: pressed for a and released for b.',
      'Count the lights that remain on, repeat with the second questionnaire, and add the results.',
    ],
    controlLabels: {
      switch1: 'Answer 1', switch2: 'Answer 2', switch3: 'Answer 3',
      switch4: 'Answer 4', switch5: 'Answer 5', switch6: 'Answer 6',
      button1: 'Compare 1', button2: 'Compare 2', button3: 'Compare 3',
      button4: 'Compare 4', button5: 'Compare 5', button6: 'Compare 6',
    },
  },
  {
    id: 'VI-RANDOM',
    instructions: [
      'Turn power on.',
      'Hold pushbutton 2 while MINIVAC generates a result.',
      'Release pushbutton 2 and press pushbutton 4 to display it on lights 1 through 4.',
    ],
    controlLabels: { button2: 'Generate', button4: 'Show result' },
  },
  {
    id: 'III-RELAYAND',
    instructions: [
      'Turn power on.',
      'Press pushbuttons 1 and 2; light 3 is on only when both are pressed.',
    ],
    controlLabels: { button1: 'Input A', button2: 'Input B' },
  },
  {
    id: 'III-RELAYOR',
    instructions: [
      'Turn power on.',
      'Press pushbutton 1 or 2; either input turns on light 3.',
    ],
    controlLabels: { button1: 'Input A', button2: 'Input B' },
  },
  {
    id: 'III-RELAYNOT',
    instructions: [
      'Turn power on.',
      'Light 2 is on while pushbutton 1 and relay 1 are off.',
    ],
    controlLabels: { button1: 'Input' },
  },
  {
    id: 'III-RELAYXOR',
    instructions: [
      'Turn power on.',
      'Light 3 is on when exactly one of pushbuttons 1 and 2 is pressed.',
    ],
    controlLabels: { button1: 'Input A', button2: 'Input B' },
  },
  {
    id: 'V-EXP2',
    instructions: [
      'Turn power on; light 5 is the alarm.',
      'Press pushbutton 1 to set or reset the system.',
      'Pushbuttons 2 through 6 represent protected contacts; operating any one triggers the alarm.',
    ],
    controlLabels: {
      button1: 'Reset', button2: 'Contact 2', button3: 'Contact 3',
      button4: 'Contact 4', button5: 'Contact 5', button6: 'Contact 6',
    },
  },
  {
    id: 'IV-FF2',
    instructions: [
      'Turn power on; relays 5 and 6 begin off.',
      'Push and release pushbutton 6 to turn both relays on.',
      'Push and hold pushbutton 6 to turn relay 5 off while relay 6 remains on.',
    ],
    controlLabels: { button6: 'Toggle' },
  },
  {
    id: 'V-EXP4',
    instructions: [
      'Turn power on.',
      'Light 4 represents red, light 5 amber and light 6 green.',
      'The rotary switch will turn, turning lights 4, 5 and 6 on and off in succession.',
    ],
    controlLabels: {},
  },
  {
    id: 'VI-SPS',
    instructions: [
      'Turn power on.',
      'Each player picks scissors, paper or stone and pushes the matching pushbutton: player 1 uses pushbuttons 1, 2 and 3, player 2 uses pushbuttons 4, 5 and 6.',
      'Player 1 pushes and holds their pushbutton just before player 2 pushes; the lights show the result while both pushbuttons are held down.',
      'Scissors win over paper, paper wins over stone, stone wins over scissors.',
      'Light 1 means player 1 wins, light 6 means player 2 wins, lights 3 and 4 mean a tie.',
    ],
    controlLabels: {
      button1: 'P1 Scissors', button2: 'P1 Paper', button3: 'P1 Stone',
      button4: 'P2 Scissors', button5: 'P2 Paper', button6: 'P2 Stone',
    },
  },
  {
    id: 'VI-COMBOLOCK',
    instructions: [
      'Turn power on.',
      'Starting from 0, turn the rotary switch left (counterclockwise, numbers going down) to 13, right (clockwise, numbers going up) to 2, left to 10, right to 6, then left to 9; passing 8 at any point is an error.',
      'Light 1 comes on when the combination is solved; light 6 comes on when an error is made, and you must start over.',
    ],
    controlLabels: { dial: 'Rotary switch' },
  },
  {
    id: 'V-EXP19',
    instructions: [
      'Set the rotary switch dial to 0 and turn power on.',
      'Turn the rotary switch clockwise until the pointer knob is pointing at the position of the letter you wish to code on the dial plate (see the notice).',
      'Read the Morse Code representation of the letter starting with output light 3: band 1 reads light 3 only, band 2 lights 3 and 4, band 3 lights 3, 4 and 5, band 4 lights 3, 4, 5 and 6.',
      'A light on represents a dash; a light off represents a dot.',
      'For each new letter, turn power off and start again from the first step.',
    ],
    controlLabels: { dial: 'Rotary switch' },
  },
  {
    id: 'VI-REACTION',
    instructions: [
      'Turn power on; player 1 uses pushbutton 1 and player 2 uses pushbutton 6.',
      'Push the re-set button (pushbutton 3).',
      'As soon as lights 3 and 4 come on, each player tries to be the first to push their pushbutton.',
      'Light 1 means player 1 wins, light 6 means player 2 wins, light 2 means player 1 has fouled, and light 5 means player 2 has fouled.',
      'If a player pushes before lights 3 and 4 come on, the game must be begun again; to start another game, push the re-set button.',
    ],
    controlLabels: { button1: 'Player 1', button3: 'Re-set', button6: 'Player 2' },
  },
  {
    id: 'IV-EXP4',
    instructions: [
      'Turn power on.',
      'Move slide switch 6 to the right for input A = 0, or to the left for input A = 1.',
      'Hold pushbutton 6 for input B = 1; leave it up for input B = 0.',
      'Light 6 shows the sum; light 5 shows carry out.',
    ],
    controlLabels: { switch6: 'Input A', button6: 'Input B' },
  },
] as const);

function minimalDemo(id: string): Record<string, unknown> {
  return {
    id,
    title: 'Schema case',
    category: 'logic',
    source: {
      program: id,
      locator: 'source locator',
      confidence: 'verified',
      errata: [],
      fallbacks: [],
    },
    connections: ['1A/1B'],
    initial: {
      power: false,
      switches: [0, 0, 0, 0, 0, 0],
      buttons: [0, 0, 0, 0, 0, 0],
      relayHands: [null, null, null, null, null, null],
      dialHand: null,
    },
    instructions: ['Operate the circuit.'],
    controlLabels: {},
  };
}

describe('Phase 2 public demo source manifest', () => {
  it('freezes exactly seventeen entries across the eleven settled categories', () => {
    expect(DEMO_SOURCE_MANIFEST).toHaveLength(17);
    expect(new Set(DEMO_SOURCE_MANIFEST.map((row) => row.id)).size).toBe(17);
    expect(new Set(DEMO_SOURCE_MANIFEST.map((row) => row.category))).toEqual(new Set([
      'counter', 'game', 'comparison', 'random', 'logic', 'alarm', 'memory',
      'control', 'lock', 'code', 'arithmetic',
    ]));
    expect(DEMO_SOURCE_MANIFEST.reduce((sum, row) => sum + row.connections, 0)).toBe(519);
    expect(DEMO_SOURCE_MANIFEST.find((row) => row.id === 'VI-TICTACTOE')?.fallbacks)
      .toEqual(['FALLBACK-TTT-RING-CW']);
    expect(DEMO_SOURCE_MANIFEST.filter((row) => row.id !== 'VI-TICTACTOE')
      .every((row) => row.fallbacks.length === 0)).toBe(true);
  });

  it('uses only image-reviewed public source records', () => {
    const text = readFileSync(ROOT + '/docs/research/programs.md', 'utf8');
    for (const { id } of DEMO_SOURCE_MANIFEST) {
      const heading = id === 'VI-TICTACTOE'
        ? '## 1. Tic-Tac-Toe — the reference table'
        : new RegExp('^### ' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' — ', 'm');
      const start = typeof heading === 'string' ? text.indexOf(heading) : text.search(heading);
      expect(start, id).toBeGreaterThanOrEqual(0);
      const next = text.indexOf('\n### ', start + 5);
      const record = text.slice(start, next < 0 ? undefined : next);
      expect(record, id).toMatch(/\*\*\[verified\]\*/);
    }
  });

  it('pins every public instruction and canned control label independently', () => {
    expect(productionDocument.demos.map((demo) => ({
      id: demo.id,
      instructions: demo.instructions,
      controlLabels: demo.controlLabels,
    }))).toEqual(DEMO_PUBLIC_COPY);
  });

  it('pins every ordered corrected wire array independently of production data', () => {
    const fixturePaths: Readonly<Record<string, string>> = {
      'IV-EXP1': 'test/conformance/fixtures/B/IV-EXP1-SLOW.fixture.json',
      'ER-ALTCOUNTER': 'test/conformance/fixtures/B/ER-ALTCOUNTER.fixture.json',
      'III-RELAYAND': 'test/conformance/fixtures/A/III-RELAYAND.fixture.json',
      'III-RELAYOR': 'test/conformance/fixtures/A/III-RELAYOR.fixture.json',
      'III-RELAYNOT': 'test/conformance/fixtures/A/III-RELAYNOT.fixture.json',
      'III-RELAYXOR': 'test/conformance/fixtures/A/III-RELAYXOR.fixture.json',
      'IV-FF2': 'test/conformance/fixtures/B/IV-FF2.fixture.json',
      'V-EXP4': 'test/conformance/fixtures/C2/V-EXP4.fixture.json',
      'VI-SPS': 'test/conformance/fixtures/A/VI-SPS.fixture.json',
      'VI-COMBOLOCK': 'test/conformance/fixtures/C1/VI-COMBOLOCK.fixture.json',
      'V-EXP19': 'test/conformance/fixtures/C1/V-EXP19.fixture.json',
      'VI-REACTION': 'test/conformance/fixtures/C2/VI-REACTION.fixture.json',
      'IV-EXP4': 'test/conformance/fixtures/A/IV-EXP4.fixture.json',
    };
    const raw = JSON.parse(readFileSync(
      ROOT + '/docs/research/raw/find-programs.json', 'utf8',
    )) as { programs: Record<string, unknown>[] };
    const rawProgram = (id: string): Record<string, unknown> => {
      const found = raw.programs.find((row) => row['id'] === id);
      if (found === undefined) throw new Error('missing source program ' + id);
      return found;
    };
    const sourceWires = (id: string): string[] => {
      const fixturePath = fixturePaths[id];
      if (fixturePath !== undefined) {
        return (JSON.parse(readFileSync(ROOT + '/' + fixturePath, 'utf8')) as { wires: string[] }).wires;
      }
      if (id === 'VI-TICTACTOE') {
        return (rawProgram(id)['connections'] as string[]).map((wire) => wire.replace(/\*+$/, ''));
      }
      if (id === 'V-JOBSELECT') {
        const one = rawProgram(id)['connections_section1'] as string[];
        return Array.from({ length: 6 }, (_, index) => one.map((wire) => wire.split('/')
          .map((end) => end.replace(/^1/, String(index + 1))).join('/'))).flat();
      }
      if (id === 'VI-RANDOM') return rawProgram('VI-FORTUNETELLER')['connections'] as string[];
      if (id === 'V-EXP2') return rawProgram(id)['connections'] as string[];
      throw new Error('no source wiring for ' + id);
    };

    const production = new Map(productionDocument.demos.map((demo) => [demo.id, demo]));
    expect([...production.keys()]).toEqual(DEMO_SOURCE_MANIFEST.map((row) => row.id));
    for (const row of DEMO_SOURCE_MANIFEST) {
      const wires = sourceWires(row.id);
      expect(wires, row.id).toHaveLength(row.connections);
      expect(createHash('sha256').update(JSON.stringify(wires)).digest('hex'), row.id)
        .toBe(row.wireSha256);
      if (row.id === 'VI-TICTACTOE') expect(wires.slice(-2)).toEqual(['M10/free', 'M11/free']);

      const demo = production.get(row.id);
      expect(demo, row.id).toBeDefined();
      expect(demo).toMatchObject({
        id: row.id,
        title: row.title,
        category: row.category,
        source: {
          program: row.id,
          locator: row.locator,
          confidence: row.confidence,
          errata: [...row.errata],
          fallbacks: [...row.fallbacks],
        },
      });
      expect((demo!.connections as readonly ProductionConnection[]).map((connection) =>
        typeof connection === 'string' ? connection : connection.wire,
      ), row.id).toEqual(wires);
    }
    expect(['IV-EXP1', 'ER-ALTCOUNTER'].map((id) => production.get(id)?.notice))
      .toEqual([COUNTER_NOTICE, COUNTER_NOTICE]);
    expect(production.get('VI-COMBOLOCK')?.notice).toBe(COMBOLOCK_NOTICE);
    expect(production.get('V-EXP19')?.notice).toBe(MORSE_NOTICE);
    expect(productionDocument.demos.filter((demo) => 'notice' in demo).map((demo) => demo.id))
      .toEqual(['IV-EXP1', 'ER-ALTCOUNTER', 'VI-COMBOLOCK', 'V-EXP19']);
    const original = production.get('IV-EXP1');
    expect(original).toBeDefined();
    expect((original!.connections as readonly ProductionConnection[]).map((connection) =>
      typeof connection === 'string' ? connection : connection.wire,
    )).toEqual((JSON.parse(readFileSync(
      ROOT + '/test/conformance/fixtures/B/IV-EXP1-FAST.fixture.json', 'utf8',
    )) as { wires: string[] }).wires);
  });

  it('closes the application schema and excludes Tier-D expectations', () => {
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    expect(validate(productionDocument), JSON.stringify(validate.errors)).toBe(true);
    const doc = {
      schema: 'minivac.demo-library/1',
      demos: DEMO_SOURCE_MANIFEST.map((row) => minimalDemo(row.id)),
    };
    expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);

    const withExpected = structuredClone(doc) as { demos: Record<string, unknown>[] };
    withExpected.demos[0]!['expect'] = [];
    expect(validate(withExpected)).toBe(false);

    for (const wire of ['garbage with spaces/free', 'free/free', '1D/1A', '1A#7/1B']) {
      const invalid = structuredClone(doc) as unknown as { demos: { connections: string[] }[] };
      invalid.demos[0]!.connections = [wire];
      expect(validate(invalid), wire).toBe(false);
    }
  });
});
