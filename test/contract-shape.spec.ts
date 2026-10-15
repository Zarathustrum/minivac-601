/**
 * Compile-time and literal-shape proof for architecture §§7–8 and §13.4.
 *
 * This file constructs contract data only. It does not fake Machine behavior or duplicate runtime
 * validation that belongs to later W3 modules.
 */
import { describe, expect, expectTypeOf, it } from 'vitest';
import { CONTRACT } from '../src/core/contract.ts';
import type {
  ChatterDev,
  CmdResult,
  Command,
  CordEnd,
  Event,
  HoleId,
  Machine,
  Note,
  Sect,
  State,
  TerminalId,
  TraceAnomaly,
} from '../src/core/contract.ts';
import { parseHoleId, parseTerminalId } from '../src/core/terminals.ts';

const terminalA = parseTerminalId('1A');
const terminalB = parseTerminalId('1B');
const holeA = parseHoleId('1A#1').id;

function compileOnlyBrandChecks(): void {
  const terminal: TerminalId = terminalA;
  const hole: HoleId = holeA;
  void terminal;
  void hole;

  // The contract imports W2's brands; it does not redeclare either identity as a plain string.
  // @ts-expect-error a plain string is not a TerminalId
  const badTouch: CordEnd = { k: 'touch', term: '1A' };
  // @ts-expect-error a plain string is not a HoleId
  const badHole: CordEnd = { k: 'hole', hole: '1A#1' };
  // @ts-expect-error an arbitrary string is not a chatter device
  const badChatter: State['flags']['chattering'][number] = 'caller-corruption';
  void badTouch;
  void badHole;
  void badChatter;
}
void compileOnlyBrandChecks;

describe('contract 1.1.0 command surface', () => {
  it('exports the exact version and ten command discriminants', () => {
    const commands: Command[] = [
      { k: 'power', on: true },
      { k: 'breaker', reset: true },
      { k: 'connect', cord: 7, a: { k: 'hole', hole: holeA }, b: { k: 'touch', term: terminalB } },
      { k: 'disconnect', cord: 7 },
      { k: 'button', n: 1, target: 500 },
      { k: 'switch', n: 2, target: 1000 },
      { k: 'relayGrab', n: 3, target: 750 },
      { k: 'relayRelease', n: 3 },
      { k: 'dialGrab', targetUdeg: 359_999_999 },
      { k: 'dialRelease' },
    ];

    expect(CONTRACT).toBe('1.1.0');
    expect(commands.map((command) => command.k)).toEqual([
      'power', 'breaker', 'connect', 'disconnect',
      'button', 'switch', 'relayGrab', 'relayRelease', 'dialGrab', 'dialRelease',
    ]);
    expect(Object.keys(commands[2] as Command)).toEqual(['k', 'cord', 'a', 'b']);

    expectTypeOf<Command['k']>().toEqualTypeOf<
      'power' | 'breaker' | 'connect' | 'disconnect' |
      'button' | 'switch' | 'relayGrab' | 'relayRelease' | 'dialGrab' | 'dialRelease'
    >();
    expectTypeOf<Sect>().toEqualTypeOf<1 | 2 | 3 | 4 | 5 | 6>();
  });

  it('has exactly the three CordEnd variants and seven failure reasons', () => {
    const ends: CordEnd[] = [
      { k: 'hole', hole: holeA },
      { k: 'touch', term: terminalA },
      { k: 'free' },
    ];
    expect(ends.map((end) => end.k)).toEqual(['hole', 'touch', 'free']);
    expectTypeOf<CordEnd['k']>().toEqualTypeOf<'hole' | 'touch' | 'free'>();
    expectTypeOf<Extract<CmdResult, { ok: false }>['why']>().toEqualTypeOf<
      'hole_occupied' | 'unknown_hole' | 'unknown_terminal' |
      'unknown_cord' | 'cord_exists' | 'bad_cord_id' | 'bad_target'
    >();
  });

  it('pins every command, end and result variant key', () => {
    expectTypeOf<keyof Extract<Command, { k: 'power' }>>().toEqualTypeOf<'k' | 'on'>();
    expectTypeOf<keyof Extract<Command, { k: 'breaker' }>>().toEqualTypeOf<'k' | 'reset'>();
    expectTypeOf<keyof Extract<Command, { k: 'connect' }>>().toEqualTypeOf<
      'k' | 'cord' | 'a' | 'b' | 'r_uohm'
    >();
    expectTypeOf<keyof Extract<Command, { k: 'disconnect' }>>().toEqualTypeOf<'k' | 'cord'>();
    expectTypeOf<keyof Extract<Command, { k: 'button' }>>().toEqualTypeOf<'k' | 'n' | 'target'>();
    expectTypeOf<keyof Extract<Command, { k: 'switch' }>>().toEqualTypeOf<'k' | 'n' | 'target'>();
    expectTypeOf<keyof Extract<Command, { k: 'relayGrab' }>>().toEqualTypeOf<'k' | 'n' | 'target'>();
    expectTypeOf<keyof Extract<Command, { k: 'relayRelease' }>>().toEqualTypeOf<'k' | 'n'>();
    expectTypeOf<keyof Extract<Command, { k: 'dialGrab' }>>().toEqualTypeOf<'k' | 'targetUdeg'>();
    expectTypeOf<keyof Extract<Command, { k: 'dialRelease' }>>().toEqualTypeOf<'k'>();

    expectTypeOf<keyof Extract<CordEnd, { k: 'hole' }>>().toEqualTypeOf<'k' | 'hole'>();
    expectTypeOf<keyof Extract<CordEnd, { k: 'touch' }>>().toEqualTypeOf<'k' | 'term'>();
    expectTypeOf<keyof Extract<CordEnd, { k: 'free' }>>().toEqualTypeOf<'k'>();
    expectTypeOf<keyof Extract<CmdResult, { ok: true }>>().toEqualTypeOf<'ok'>();
    expectTypeOf<keyof Extract<CmdResult, { ok: false }>>().toEqualTypeOf<'ok' | 'why'>();
  });
});

describe('state, notes and events', () => {
  it('carries the complete Phase 1 State shape and no Phase 2 fields', () => {
    const relays: State['relays'] = Array.from({ length: 6 }, () => ({
      travel: 0,
      coilMv: 0,
      coilUa: 0,
      pullInUa: 43_333,
      dropOutUa: 16_667,
      band: 'below',
      coilShorted: false,
      set1: { nc: true, no: false },
      set2: { nc: true, no: false },
      indicatorUa: 0,
      held: false,
    }));
    const lamps: State['outLamps'] = Array.from({ length: 6 }, () => ({
      ua: 0,
      milli: 0,
      cls: 'off',
    }));
    const buttons: State['buttons'] = Array.from({ length: 6 }, () => ({
      travel: 0,
      nc: true,
      no: false,
    }));
    const switches: State['switches'] = Array.from({ length: 6 }, () => ({
      travel: 0,
      set1: [true, false] as [boolean, boolean],
      set2: [true, false] as [boolean, boolean],
    }));
    const notes: Note[] = [
      {
        k: 'coil-starved',
        relay: 1,
        coilUa: 40_000,
        needsUa: 43_333,
        drops: [{ el: 'lamp:1', mv: 6000 }],
      },
      { k: 'lamp-in-coil-path', relay: 1, lampMv: 6000 },
    ];
    const state: State = {
      contract: CONTRACT,
      netlistHash: 'fnv1a64:0000000000000000',
      profileId: 'MV601-REF-A',
      profileHash: 'fnv1a64:1111111111111111',
      tick: 0,
      power: false,
      breakerTripped: false,
      railMv: 0,
      supplyUa: 0,
      relays,
      outLamps: lamps,
      indLamps: lamps.map((lamp) => ({ ...lamp })),
      buttons,
      switches,
      dial: { udeg: 0, contact: 0, mrpm: 0, held: false },
      cords: [{ id: 7, a: { k: 'hole', hole: holeA }, b: { k: 'free' }, r_uohm: 0 }],
      terminalMv: Array.from({ length: 186 }, () => null),
      notes,
      flags: { chattering: ['relay1'], overCurrent: false, nonPortable: false },
    };

    expect(Object.keys(state)).toEqual([
      'contract', 'netlistHash', 'profileId', 'profileHash', 'tick',
      'power', 'breakerTripped', 'railMv', 'supplyUa',
      'relays', 'outLamps', 'indLamps', 'buttons', 'switches', 'dial',
      'cords', 'terminalMv', 'notes', 'flags',
    ]);
    expect(state.relays).toHaveLength(6);
    expect(state.outLamps).toHaveLength(6);
    expect(state.indLamps).toHaveLength(6);
    expect(state.buttons).toHaveLength(6);
    expect(state.switches).toHaveLength(6);
    expect(state.terminalMv).toHaveLength(186);
    expect(state).not.toHaveProperty('caps');
    expect(state).not.toHaveProperty('energised');
    expectTypeOf<Note['k']>().toEqualTypeOf<'coil-starved' | 'lamp-in-coil-path'>();
  });

  it('pins every Event kind and the complete chatter payload', () => {
    const events: Event[] = [
      { t: 0, k: 'power.on' },
      { t: 1, k: 'relay.pullIn', n: 1, coilUa: 44_000, marginUa: 667 },
      { t: 2, k: 'contact.break', arm: terminalA, to: terminalB },
      { t: 3, k: 'lamp.on', kind: 'out', n: 1 },
      { t: 4, k: 'dial.make', pos: 0 },
      {
        t: 5,
        k: 'chatter',
        dev: 'relay1',
        transitions: 9,
        windowTicks: 800,
        quietTicks: 2400,
      },
    ];

    expect(Object.keys(events[5] as Event)).toEqual([
      't', 'k', 'dev', 'transitions', 'windowTicks', 'quietTicks',
    ]);
    expectTypeOf<Event['k']>().toEqualTypeOf<
      'power.on' | 'power.off' | 'breaker.trip' | 'breaker.reset' |
      'relay.pullIn' | 'relay.dropOut' | 'contact.make' | 'contact.break' |
      'lamp.on' | 'lamp.off' | 'dial.make' | 'dial.break' | 'chatter'
    >();
  });

  it('pins State and every nested public record key', () => {
    expectTypeOf<keyof State>().toEqualTypeOf<
      'contract' | 'netlistHash' | 'profileId' | 'profileHash' | 'tick' |
      'power' | 'breakerTripped' | 'railMv' | 'supplyUa' |
      'relays' | 'outLamps' | 'indLamps' | 'buttons' | 'switches' | 'dial' |
      'cords' | 'terminalMv' | 'notes' | 'flags'
    >();
    expectTypeOf<keyof State['relays'][number]>().toEqualTypeOf<
      'travel' | 'coilMv' | 'coilUa' | 'pullInUa' | 'dropOutUa' | 'band' |
      'coilShorted' | 'set1' | 'set2' | 'indicatorUa' | 'held'
    >();
    expectTypeOf<keyof State['relays'][number]['set1']>().toEqualTypeOf<'nc' | 'no'>();
    expectTypeOf<keyof State['outLamps'][number]>().toEqualTypeOf<'ua' | 'milli' | 'cls'>();
    expectTypeOf<keyof State['buttons'][number]>().toEqualTypeOf<'travel' | 'nc' | 'no'>();
    expectTypeOf<keyof State['switches'][number]>().toEqualTypeOf<'travel' | 'set1' | 'set2'>();
    expectTypeOf<keyof State['dial']>().toEqualTypeOf<'udeg' | 'contact' | 'mrpm' | 'held'>();
    expectTypeOf<keyof State['cords'][number]>().toEqualTypeOf<'id' | 'a' | 'b' | 'r_uohm'>();
    expectTypeOf<keyof State['flags']>().toEqualTypeOf<
      'chattering' | 'overCurrent' | 'nonPortable'
    >();
    expectTypeOf<State['flags']['chattering'][number]>().toEqualTypeOf<ChatterDev>();
  });

  it('pins every Note and Event variant key', () => {
    expectTypeOf<keyof Extract<Note, { k: 'coil-starved' }>>().toEqualTypeOf<
      'k' | 'relay' | 'coilUa' | 'needsUa' | 'drops'
    >();
    expectTypeOf<keyof Extract<Note, { k: 'lamp-in-coil-path' }>>().toEqualTypeOf<
      'k' | 'relay' | 'lampMv'
    >();

    type PowerEvent = Extract<Event, {
      k: 'power.on' | 'power.off' | 'breaker.trip' | 'breaker.reset';
    }>;
    type RelayEvent = Extract<Event, { k: 'relay.pullIn' | 'relay.dropOut' }>;
    type ContactEvent = Extract<Event, { k: 'contact.make' | 'contact.break' }>;
    type LampEvent = Extract<Event, { k: 'lamp.on' | 'lamp.off' }>;
    type DialEvent = Extract<Event, { k: 'dial.make' | 'dial.break' }>;
    type ChatterEvent = Extract<Event, { k: 'chatter' }>;

    expectTypeOf<keyof PowerEvent>().toEqualTypeOf<'t' | 'k'>();
    expectTypeOf<keyof RelayEvent>().toEqualTypeOf<'t' | 'k' | 'n' | 'coilUa' | 'marginUa'>();
    expectTypeOf<keyof ContactEvent>().toEqualTypeOf<'t' | 'k' | 'arm' | 'to'>();
    expectTypeOf<keyof LampEvent>().toEqualTypeOf<'t' | 'k' | 'kind' | 'n'>();
    expectTypeOf<keyof DialEvent>().toEqualTypeOf<'t' | 'k' | 'pos'>();
    expectTypeOf<keyof ChatterEvent>().toEqualTypeOf<
      't' | 'k' | 'dev' | 'transitions' | 'windowTicks' | 'quietTicks'
    >();
  });
});

describe('shared anomaly and Machine seams', () => {
  it('pins the 19 chatter devices and two anomaly variants', () => {
    const anomalies: TraceAnomaly[] = [
      { k: 'chatter', dev: 'dial', transitions: 9, windowTicks: 3332, quietTicks: 9996 },
      { k: 'no-settle', waitedTicks: 5000 },
    ];
    expect(anomalies.map((anomaly) => anomaly.k)).toEqual(['chatter', 'no-settle']);
    expectTypeOf<TraceAnomaly['k']>().toEqualTypeOf<'chatter' | 'no-settle'>();
    expectTypeOf<ChatterDev>().toEqualTypeOf<
      'relay1' | 'relay2' | 'relay3' | 'relay4' | 'relay5' | 'relay6' |
      'pb1' | 'pb2' | 'pb3' | 'pb4' | 'pb5' | 'pb6' |
      'sw1' | 'sw2' | 'sw3' | 'sw4' | 'sw5' | 'sw6' | 'dial'
    >();
    expectTypeOf<keyof Extract<TraceAnomaly, { k: 'chatter' }>>().toEqualTypeOf<
      'k' | 'dev' | 'transitions' | 'windowTicks' | 'quietTicks'
    >();
    expectTypeOf<keyof Extract<TraceAnomaly, { k: 'no-settle' }>>().toEqualTypeOf<
      'k' | 'waitedTicks'
    >();
  });

  it('defines the six public Machine methods without constructing an implementation', () => {
    expectTypeOf<keyof Machine>().toEqualTypeOf<
      'apply' | 'advance' | 'snapshot' | 'observables' | 'motionMask' | 'drainEvents'
    >();
    expectTypeOf<Machine>().toHaveProperty('apply');
    expectTypeOf<Machine>().toHaveProperty('advance');
    expectTypeOf<Machine>().toHaveProperty('snapshot');
    expectTypeOf<Machine>().toHaveProperty('observables');
    expectTypeOf<Machine>().toHaveProperty('motionMask');
    expectTypeOf<Machine>().toHaveProperty('drainEvents');
    expectTypeOf<Machine['apply']>().parameter(0).toEqualTypeOf<Command>();
    expectTypeOf<Machine['apply']>().returns.toEqualTypeOf<CmdResult>();
    expectTypeOf<Machine['advance']>().parameter(0).toEqualTypeOf<number>();
    expectTypeOf<Machine['advance']>().returns.toEqualTypeOf<void>();
    expectTypeOf<Machine['snapshot']>().returns.toEqualTypeOf<State>();
    expectTypeOf<Machine['observables']>().returns.toEqualTypeOf<Int32Array>();
    expectTypeOf<Machine['motionMask']>().returns.toEqualTypeOf<number>();
    expectTypeOf<Machine['drainEvents']>().returns.toEqualTypeOf<Event[]>();
  });
});
