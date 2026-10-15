import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import demoDocument from '../data/demo-library.json';
import { createMachine } from '../src/core/machine.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import { loadProfile } from '../src/core/profile.ts';
import {
  DEMO_LIBRARY_SCHEMA,
  MANUAL_SESSION_ID,
  loadDemoLibrary,
} from '../src/demo-library.ts';
import profileDocument from '../data/profiles/MV601-REF-A.json';

const netlist = loadNetlist(new Uint8Array(readFileSync(
  new URL('../data/netlist.json', import.meta.url),
)));
const profile = loadProfile(profileDocument);

function changed(mutator: (raw: Record<string, unknown>) => void): unknown {
  const raw = structuredClone(demoDocument) as unknown as Record<string, unknown>;
  mutator(raw);
  return raw;
}

function firstDemo(raw: Record<string, unknown>): Record<string, unknown> {
  return (raw['demos'] as Record<string, unknown>[])[0] as Record<string, unknown>;
}

describe('Phase 2 production demo library', () => {
  it('loads the exact seventeen records and allocates every endpoint deterministically', () => {
    const one = loadDemoLibrary(demoDocument, netlist);
    const two = loadDemoLibrary(structuredClone(demoDocument), netlist);

    expect(one.schema).toBe(DEMO_LIBRARY_SCHEMA);
    expect(one).toEqual(two);
    expect(one.demos.map((demo) => [demo.id, demo.connections.length])).toEqual([
      ['IV-EXP1', 44],
      ['ER-ALTCOUNTER', 48],
      ['VI-TICTACTOE', 72],
      ['V-JOBSELECT', 30],
      ['VI-RANDOM', 40],
      ['III-RELAYAND', 10],
      ['III-RELAYOR', 11],
      ['III-RELAYNOT', 6],
      ['III-RELAYXOR', 11],
      ['V-EXP2', 16],
      ['IV-FF2', 14],
      ['V-EXP4', 22],
      ['VI-SPS', 41],
      ['VI-COMBOLOCK', 46],
      ['V-EXP19', 49],
      ['VI-REACTION', 51],
      ['IV-EXP4', 8],
    ]);

    const ticTacToe = one.demos.find((demo) => demo.id === 'VI-TICTACTOE');
    expect(ticTacToe).toBeDefined();
    expect(ticTacToe!.connections.flatMap((connection) => [connection.a, connection.b])
      .filter((end) => end.k === 'free')).toHaveLength(2);

    for (const demo of one.demos) {
      expect(demo.commands).toHaveLength(demo.connections.length + 20);
      expect(demo.commands.slice(0, demo.connections.length).map((command) =>
        command.k === 'connect' ? command.cord : null,
      )).toEqual(demo.connections.map((_, index) => index));
      expect(demo.commands.slice(demo.connections.length, demo.connections.length + 6)
        .map((command) => command.k)).toEqual(Array(6).fill('switch'));
      expect(demo.commands.slice(demo.connections.length + 6, demo.connections.length + 12)
        .map((command) => command.k)).toEqual(Array(6).fill('button'));
      expect(demo.commands.at(-1)).toEqual({ k: 'power', on: demo.initial.power });

      const run = () => {
        const machine = createMachine(netlist, profile);
        for (const command of demo.commands) expect(machine.apply(command), demo.id).toEqual({ ok: true });
        machine.advance(1);
        return { state: machine.snapshot(), events: machine.drainEvents() };
      };
      const first = run();
      expect(run()).toEqual(first);
      expect(first.state.cords).toEqual(demo.connections.map((connection, index) => ({
        id: index,
        a: connection.a,
        b: connection.b,
        r_uohm: connection.r_uohm ?? 0,
      })));
    }
  });

  it('reserves exact holes before allocating bare terminals and preserves resistance', () => {
    const raw = changed((document) => {
      firstDemo(document)['connections'] = [
        '1A/1B',
        '1A#1/1C',
        { wire: '1K/1E', r_uohm: 123 },
      ];
    });
    const demo = loadDemoLibrary(raw, netlist).demos[0]!;

    expect(demo.connections).toEqual([
      {
        wire: '1A/1B',
        a: { k: 'hole', hole: '1A#2' },
        b: { k: 'hole', hole: '1B#1' },
      },
      {
        wire: '1A#1/1C',
        a: { k: 'hole', hole: '1A#1' },
        b: { k: 'hole', hole: '1C#1' },
      },
      {
        wire: '1K/1E',
        a: { k: 'hole', hole: '1K#1' },
        b: { k: 'hole', hole: '1E#1' },
        r_uohm: 123,
      },
    ]);
    expect(demo.commands[2]).toEqual({
      k: 'connect',
      cord: 2,
      a: { k: 'hole', hole: '1K#1' },
      b: { k: 'hole', hole: '1E#1' },
      r_uohm: 123,
    });
  });

  it.each([
    ['duplicate id', (document: Record<string, unknown>) => {
      const demos = document['demos'] as Record<string, unknown>[];
      demos[1]!['id'] = demos[0]!['id'];
    }, 'duplicate id'],
    ['unknown terminal', (document: Record<string, unknown>) => {
      firstDemo(document)['connections'] = ['1D/nope'];
    }, 'invalid physical terminal'],
    ['occupied exact hole', (document: Record<string, unknown>) => {
      firstDemo(document)['connections'] = ['1A#1/1B', '1A#1/1C'];
    }, 'occupied hole'],
    ['over capacity', (document: Record<string, unknown>) => {
      firstDemo(document)['connections'] = ['D0/1A', 'D0/1B', 'D0/1C'];
    }, 'has no free hole'],
    ['direct unloaded rail short', (document: Record<string, unknown>) => {
      firstDemo(document)['connections'] = ['1+/2-'];
    }, 'direct unloaded PLUS-to-MINUS short'],
    ['reserved manual id', (document: Record<string, unknown>) => {
      firstDemo(document)['id'] = MANUAL_SESSION_ID;
    }, 'reserved id'],
    ['unknown demo key', (document: Record<string, unknown>) => {
      firstDemo(document)['extra'] = true;
    }, 'unknown key'],
  ])('rejects %s', (_name, mutator, message) => {
    expect(() => loadDemoLibrary(changed(mutator), netlist)).toThrow(message);
  });

  it('allows a positive-resistance rail connection but rejects explicit zero resistance', () => {
    const positive = changed((document) => {
      firstDemo(document)['connections'] = [{ wire: '1+/2-', r_uohm: 1 }];
    });
    expect(loadDemoLibrary(positive, netlist).demos[0]!.connections[0]!.r_uohm).toBe(1);

    const zero = changed((document) => {
      firstDemo(document)['connections'] = [{ wire: '1+/2-', r_uohm: 0 }];
    });
    expect(() => loadDemoLibrary(zero, netlist)).toThrow('direct unloaded PLUS-to-MINUS short');
  });
});
