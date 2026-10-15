/** End-to-end Wave 3 Machine proof for architecture §13.4. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import refJson from '../data/profiles/MV601-REF-A.json';
import type { Command, CordEnd, Machine } from '../src/core/contract.ts';
import { createMachine } from '../src/core/machine.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import { loadProfile } from '../src/core/profile.ts';
import type { Profile } from '../src/core/profile.ts';
import {
  HOLE_COUNT,
  TERMINAL_IDS,
  holeByIndex,
  parseHoleId,
  parseTerminalId,
  terminalIndex,
} from '../src/core/terminals.ts';

const netlist = loadNetlist(new Uint8Array(readFileSync(new URL('../data/netlist.json', import.meta.url))));
const profile = loadProfile(refJson);

function machine(p: Profile = profile): Machine {
  return createMachine(netlist, p);
}

function touch(term: string): CordEnd {
  return { k: 'touch', term: parseTerminalId(term) };
}

function hole(id: string): CordEnd {
  return { k: 'hole', hole: parseHoleId(id).id };
}

function wire(m: Machine, id: number, a: string, b: string, r_uohm?: number): void {
  const command: Command = r_uohm === undefined
    ? { k: 'connect', cord: id, a: touch(a), b: touch(b) }
    : { k: 'connect', cord: id, a: touch(a), b: touch(b), r_uohm };
  expect(m.apply(command)).toEqual({ ok: true });
}

function powerAndAdvance(m: Machine, ticks: number): void {
  expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
  m.advance(ticks);
}

describe('construction and public ownership', () => {
  it('performs the zero-time disabled solve without moving, ticking or emitting', () => {
    const m = machine();
    const state = m.snapshot();
    expect(state).toMatchObject({
      contract: '1.1.0',
      netlistHash: 'fnv1a64:' + netlist.hash,
      profileId: profile.id,
      profileHash: 'fnv1a64:' + profile.hash,
      tick: 0,
      power: false,
      breakerTripped: false,
      railMv: 0,
      supplyUa: 0,
      cords: [],
      notes: [],
      flags: { chattering: [], overCurrent: false, nonPortable: false },
    });
    expect(state.terminalMv).toHaveLength(186);
    for (const minus of netlist.minusMembers) expect(state.terminalMv[terminalIndex(minus)]).toBe(0);
    expect(state.terminalMv[terminalIndex(parseTerminalId('1A'))]).toBeNull();
    expect(state.relays).toHaveLength(6);
    expect(state.relays.every((relay) => relay.travel === 0 && relay.coilUa === 0 && !relay.held)).toBe(true);
    expect(m.drainEvents()).toEqual([]);
  });

  it('keeps zero-current lamps cold and off while the source is disabled', () => {
    expect(profile.pwl[0]).toEqual([0, profile.v.R_cold_uohm]);
    const m = machine();
    const internals = m as unknown as { carried: { rLamp: Float64Array } };
    const coldOhm = profile.v.R_cold_uohm * 1e-6;
    expect([...internals.carried.rLamp]).toEqual(new Array<number>(12).fill(coldOhm));

    m.advance(10);
    expect([...internals.carried.rLamp]).toEqual(new Array<number>(12).fill(coldOhm));
    expect(m.snapshot().outLamps).toEqual(new Array(6).fill({ ua: 0, milli: 0, cls: 'off' }));
    expect(m.snapshot().indLamps).toEqual(new Array(6).fill({ ua: 0, milli: 0, cls: 'off' }));
    expect(m.drainEvents().filter((event) => event.k === 'lamp.on')).toEqual([]);
  });

  it('returns detached snapshots and overwrites one stable observable buffer', () => {
    const m = machine();
    const first = m.snapshot();
    first.relays[0]!.travel = 999;
    first.terminalMv[0] = 123;
    first.flags.chattering.push('relay1');
    expect(m.snapshot().relays[0]!.travel).toBe(0);
    expect(m.snapshot().terminalMv[0]).not.toBe(123);
    expect(m.snapshot().flags.chattering).toEqual([]);

    const observables = m.observables();
    observables.fill(99);
    expect(m.observables()).toBe(observables);
    expect([...observables]).toEqual([0, 0, ...new Array<number>(18).fill(0), 0, ...new Array<number>(12).fill(0)]);
    m.advance(1);
    expect(m.snapshot().flags.chattering).toEqual([]);
  });

  it('copies every behavioral profile field at construction', () => {
    const mutable = JSON.parse(JSON.stringify(profile)) as Profile;
    const m = machine(mutable);
    (mutable.v as { V_oc_mv: number }).V_oc_mv = 1;
    (mutable.derived as { relayOperateTicks: number }).relayOperateTicks = 1;
    (mutable.derived.relayPullInUa as number[])[0] = 1;
    (mutable.dVRelayMv as number[])[0] = 2000;
    (mutable.pwl as [number, number][])[0]![1] = 1;
    (mutable as { hash: string }).hash = '0000000000000000';

    powerAndAdvance(m, 1);
    const state = m.snapshot();
    expect(state.railMv).toBe(profile.v.V_oc_mv);
    expect(state.relays[0]!.pullInUa).toBe(profile.derived.relayPullInUa[0]);
    expect(state.profileHash).toBe('fnv1a64:' + profile.hash);
  });
});

describe('projected commands and cords', () => {
  it('defers accepted commands, validates against projected FIFO state and copies caller fields', () => {
    const m = machine();
    const command: Command = {
      k: 'connect',
      cord: 255,
      a: hole('1A#1'),
      b: touch('1B'),
      r_uohm: 123,
    };
    expect(m.apply(command)).toEqual({ ok: true });
    expect(m.apply({ k: 'connect', cord: 1, a: hole('1A#1'), b: { k: 'free' } })).toEqual({
      ok: false,
      why: 'hole_occupied',
    });
    expect(m.apply({ k: 'connect', cord: 255, a: { k: 'free' }, b: { k: 'free' } })).toEqual({
      ok: false,
      why: 'cord_exists',
    });
    (command as Extract<Command, { k: 'connect' }>).r_uohm = 999;
    (command as Extract<Command, { k: 'connect' }>).a = { k: 'free' };
    expect(m.snapshot().cords).toEqual([]);
    m.advance(0);
    expect(m.snapshot().cords).toEqual([]);
    m.advance(1);
    expect(m.snapshot().cords).toEqual([
      { id: 255, a: hole('1A#1'), b: touch('1B'), r_uohm: 123 },
    ]);
  });

  it('releases holes atomically and accepts every one of the 392 canonical HoleIds', () => {
    const m = machine();
    for (let i = 0; i < HOLE_COUNT; i++) {
      const end: CordEnd = { k: 'hole', hole: holeByIndex(i).id };
      expect(m.apply({ k: 'connect', cord: 0, a: end, b: { k: 'free' } }), String(i)).toEqual({ ok: true });
      expect(m.apply({ k: 'disconnect', cord: 0 }), String(i)).toEqual({ ok: true });
    }
    m.advance(1);
    expect(m.snapshot().cords).toEqual([]);
    expect(m.apply({ k: 'connect', cord: 1, a: hole('M10#6'), b: hole('M11#6') })).toEqual({ ok: true });
  });

  it('keeps incomplete cords in ascending sparse-id snapshots but out of electrical topology', () => {
    const m = machine();
    expect(m.apply({ k: 'connect', cord: 255, a: touch('1+'), b: { k: 'free' }, r_uohm: 22_000_000 }))
      .toEqual({ ok: true });
    expect(m.apply({ k: 'connect', cord: 3, a: { k: 'free' }, b: touch('1-') })).toEqual({ ok: true });
    powerAndAdvance(m, 1);
    expect(m.snapshot().cords.map((cord) => cord.id)).toEqual([3, 255]);
    expect(m.snapshot()).toMatchObject({ railMv: profile.v.V_oc_mv, supplyUa: 0 });
  });

  it('maps live topology to terminal voltage/null without losing datum zero', () => {
    const m = machine();
    wire(m, 0, '1+', '1A');
    powerAndAdvance(m, 1);
    const state = m.snapshot();
    expect(state.terminalMv[terminalIndex(parseTerminalId('1A'))]).toBe(state.railMv);
    expect(state.terminalMv[terminalIndex(parseTerminalId('1-'))]).toBe(0);
    expect(state.terminalMv[terminalIndex(parseTerminalId('2A'))]).toBeNull();
  });

  it('runs the legal 174-node, 173-row, 278-element and 256-live-cord maxima', () => {
    const maximal = JSON.parse(JSON.stringify(profile)) as Profile;
    (maximal.v as { break_milli: number }).break_milli = 0;
    (maximal.v as { make_milli: number }).make_milli = 1000;
    (maximal.v as { wiper_offset_udeg: number }).wiper_offset_udeg = 11_250_000;
    const m = machine(maximal);
    const internals = m as unknown as {
      graph: { nodeCount: number; datum: number; elementCount: number; nodeByTerminal: Int16Array };
      solve: { rowCount: number };
    };
    expect(internals.graph.nodeCount).toBe(174);
    const representative = new Int16Array(174);
    representative.fill(-1);
    for (let terminal = 0; terminal < TERMINAL_IDS.length; terminal++) {
      const node = internals.graph.nodeByTerminal[terminal] as number;
      if ((representative[node] as number) < 0) representative[node] = terminal;
    }
    const plus = terminalIndex(parseTerminalId('1+'));
    const minus = terminalIndex(parseTerminalId('1-'));
    const plusNode = internals.graph.nodeByTerminal[plus] as number;
    let id = 0;
    for (let node = 0; node < internals.graph.nodeCount; node++) {
      if (node === plusNode || node === internals.graph.datum) continue;
      expect(m.apply({
        k: 'connect',
        cord: id,
        a: touch('1+'),
        b: { k: 'touch', term: TERMINAL_IDS[representative[node] as number]! },
        r_uohm: 1_000_000,
      })).toEqual({ ok: true });
      id++;
    }
    while (id < 256) {
      expect(m.apply({
        k: 'connect', cord: id, a: touch('1+'), b: touch('1-'), r_uohm: 1_000_000 + id,
      })).toEqual({ ok: true });
      id++;
    }
    powerAndAdvance(m, 1);
    expect(m.snapshot().cords).toHaveLength(256);
    expect(internals.graph).toMatchObject({ nodeCount: 174, elementCount: 278 });
    expect(internals.solve.rowCount).toBe(173);
    expect(internals.graph.nodeByTerminal[minus]).toBe(internals.graph.datum);
  });

  it('implements the frozen failure precedence', () => {
    const m = machine();
    expect(m.apply({ k: 'connect', cord: -1, a: hole('1A#1'), b: hole('1A#1') })).toEqual({
      ok: false,
      why: 'bad_cord_id',
    });
    expect(m.apply({ k: 'disconnect', cord: 2 })).toEqual({ ok: false, why: 'unknown_cord' });
    expect(m.apply({
      k: 'connect', cord: 2,
      a: { k: 'hole', hole: '1A#0' as ReturnType<typeof parseHoleId>['id'] },
      b: { k: 'touch', term: 'bogus' as ReturnType<typeof parseTerminalId> },
    })).toEqual({ ok: false, why: 'unknown_hole' });
    expect(m.apply({
      k: 'connect', cord: 2,
      a: { k: 'touch', term: 'bogus' as ReturnType<typeof parseTerminalId> },
      b: { k: 'free' },
    })).toEqual({ ok: false, why: 'unknown_terminal' });
    expect(m.apply({ k: 'connect', cord: 2, a: { k: 'free' }, b: { k: 'free' }, r_uohm: -1 }))
      .toEqual({ ok: false, why: 'bad_target' });
    expect(m.apply({ k: 'connect', cord: 2, a: hole('1A#1'), b: hole('1A#1') }))
      .toEqual({ ok: false, why: 'hole_occupied' });
    expect(m.apply({ k: 'button', n: 1, target: 1001 })).toEqual({ ok: false, why: 'bad_target' });
    expect(m.apply({ k: 'relayGrab', n: 0 as 1, target: 1000 })).toEqual({ ok: false, why: 'bad_target' });
    expect(m.apply({ k: 'relayGrab', n: 1, target: 1001 })).toEqual({ ok: false, why: 'bad_target' });
    expect(m.apply({ k: 'relayRelease', n: 7 as 1 })).toEqual({ ok: false, why: 'bad_target' });
    expect(m.apply({ k: 'dialGrab', targetUdeg: 360_000_000 })).toEqual({ ok: false, why: 'bad_target' });
  });
});

describe('tick, epoch, breaker and retained Event order', () => {
  it('uses boundary timestamps, effective command Events and epoch barriers', () => {
    const m = machine();
    expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
    expect(m.apply({ k: 'power', on: false })).toEqual({ ok: true });
    expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot()).toMatchObject({ tick: 1, power: true });
    expect(m.drainEvents()).toEqual([{ t: 0, k: 'power.on' }]);
    expect(m.drainEvents()).toEqual([]);

    expect(m.apply({ k: 'power', on: false })).toEqual({ ok: true });
    expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
    expect(m.apply({ k: 'power', on: false })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot()).toMatchObject({ tick: 1, power: false, railMv: 0, supplyUa: 0 });
    expect(m.drainEvents()).toEqual([{ t: 0, k: 'power.on' }, { t: 0, k: 'power.off' }]);
  });

  it('latches an ideal PLUS/MINUS short for the following boundary and gates that solve', () => {
    const m = machine();
    wire(m, 0, '1+', '1-');
    powerAndAdvance(m, 1);
    expect(m.snapshot().breakerTripped).toBe(false);
    expect(m.snapshot().flags.overCurrent).toBe(true);
    expect(m.snapshot().supplyUa).toBe(profile.derived.deadShortUa);
    m.advance(1);
    expect(m.snapshot()).toMatchObject({ breakerTripped: true, railMv: 0, supplyUa: 0 });
    expect(m.snapshot().flags.overCurrent).toBe(false);
    expect(m.drainEvents()).toEqual([{ t: 0, k: 'power.on' }, { t: 1, k: 'breaker.trip' }]);
    expect(m.apply({ k: 'breaker', reset: true })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot().breakerTripped).toBe(false);
    expect(m.drainEvents()).toEqual([{ t: 2, k: 'breaker.reset' }]);
  });

  it('does not let a same-boundary reset erase an incoming pending-trip latch', () => {
    const m = machine();
    wire(m, 0, '1+', '1-');
    powerAndAdvance(m, 1);
    m.drainEvents();
    expect(m.apply({ k: 'breaker', reset: true })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot()).toMatchObject({ breakerTripped: true, railMv: 0, supplyUa: 0 });
    expect(m.drainEvents()).toEqual([{ t: 1, k: 'breaker.trip' }]);
  });

  it('preserves physical controls, cords and a tripped breaker across a cold power epoch', () => {
    const m = machine();
    wire(m, 0, '1+', '1-');
    expect(m.apply({ k: 'button', n: 1, target: 1000 })).toEqual({ ok: true });
    expect(m.apply({ k: 'dialGrab', targetUdeg: 22_500_000 })).toEqual({ ok: true });
    powerAndAdvance(m, 1250);
    expect(m.snapshot().breakerTripped).toBe(true);
    const before = m.snapshot();
    expect(m.apply({ k: 'power', on: false })).toEqual({ ok: true });
    expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
    m.advance(1);
    const after = m.snapshot();
    expect(after).toMatchObject({
      tick: 1,
      power: true,
      breakerTripped: true,
      railMv: 0,
      dial: { udeg: before.dial.udeg, held: true },
    });
    expect(after.buttons[0]!.travel).toBe(1000);
    expect(after.cords).toEqual(before.cords);
  });

  it('retains more than one primitive Event page without loss or reordering', () => {
    const m = machine();
    for (let n = 1; n <= 6; n++) {
      expect(m.apply({ k: 'button', n: n as 1, target: 1000 })).toEqual({ ok: true });
      expect(m.apply({ k: 'switch', n: n as 1, target: 1000 })).toEqual({ ok: true });
    }
    m.advance(profile.derived.slideTicks);
    for (let n = 1; n <= 6; n++) {
      expect(m.apply({ k: 'button', n: n as 1, target: 0 })).toEqual({ ok: true });
      expect(m.apply({ k: 'switch', n: n as 1, target: 0 })).toEqual({ ok: true });
    }
    m.advance(profile.derived.slideTicks);
    const events = m.drainEvents();
    expect(events).toHaveLength(72);
    expect(events.filter((event) => event.k === 'contact.break')).toHaveLength(36);
    expect(events.filter((event) => event.k === 'contact.make')).toHaveLength(36);
    for (let i = 1; i < events.length; i++) expect(events[i]!.t).toBeGreaterThanOrEqual(events[i - 1]!.t);
  });

  it('keeps multi-page chatter history independent of drain, then recycles it on quiet and epoch reset', () => {
    const chatty = JSON.parse(JSON.stringify(profile)) as Profile;
    (chatty.v as { chatter_n: number }).chatter_n = 64;
    (chatty.v as { chatter_cycles: number }).chatter_cycles = 100;
    (chatty.v as { chatter_quiet_cycles: number }).chatter_quiet_cycles = 1;
    const m = machine(chatty);
    let target = 1000;
    for (let halfCycle = 0; halfCycle < 33; halfCycle++) {
      expect(m.apply({ k: 'button', n: 1, target })).toEqual({ ok: true });
      m.advance(profile.derived.pushbuttonTicks);
      target = target === 0 ? 1000 : 0;
    }
    expect(m.snapshot().flags.chattering).toEqual(['pb1']);
    const internals = m as unknown as { chatter: { allocatedPages: Int32Array } };
    expect(internals.chatter.allocatedPages[6]).toBeGreaterThanOrEqual(2);
    const firstEpisode = m.drainEvents().filter((event) => event.k === 'chatter');
    expect(firstEpisode).toEqual([{
      t: expect.any(Number),
      k: 'chatter',
      dev: 'pb1',
      transitions: 65,
      windowTicks: 50_000,
      quietTicks: 500,
    }]);
    expect(m.snapshot().flags.chattering).toEqual(['pb1']);
    m.advance(500);
    expect(m.snapshot().flags.chattering).toEqual([]);

    for (let halfCycle = 0; halfCycle < 33; halfCycle++) {
      expect(m.apply({ k: 'button', n: 1, target })).toEqual({ ok: true });
      m.advance(profile.derived.pushbuttonTicks);
      target = target === 0 ? 1000 : 0;
    }
    expect(m.drainEvents().filter((event) => event.k === 'chatter')).toHaveLength(1);
    expect(m.snapshot().flags.chattering).toEqual(['pb1']);
    expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot().flags.chattering).toEqual([]);
  });

  it('rebases lamp classes to cold/off at a rising epoch without a stale lamp.off Event', () => {
    const m = machine();
    wire(m, 0, '1+', '1A');
    wire(m, 1, '1B', '1-');
    powerAndAdvance(m, 1000);
    expect(m.snapshot().outLamps[0]!.cls).toBe('on');
    m.drainEvents();
    expect(m.apply({ k: 'power', on: false })).toEqual({ ok: true });
    expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot().outLamps[0]!.cls).toBe('off');
    expect(m.drainEvents()).toEqual([{ t: 0, k: 'power.on' }]);
  });

  it('emits simultaneous command, relay, contact, dial and lamp Events in the frozen global order', () => {
    const immediate = JSON.parse(JSON.stringify(profile)) as Profile;
    (immediate.v as { L_coil_uh: number }).L_coil_uh = 1;
    (immediate.v as { hand_slew_mrpm: number }).hand_slew_mrpm = 30_000_000;
    (immediate.derived as { relayOperateTicks: number }).relayOperateTicks = 1;
    (immediate.derived as { relayReleaseTicks: number }).relayReleaseTicks = 1;
    (immediate.derived as { pushbuttonTicks: number }).pushbuttonTicks = 1;
    (immediate.derived as { slideTicks: number }).slideTicks = 1;
    (immediate.derived as { kThermal: number }).kThermal = 1;
    const m = machine(immediate);
    wire(m, 0, '1+', '1E');
    wire(m, 1, '1F', '1-');
    wire(m, 2, '1+', '1A');
    wire(m, 3, '1B', '1-');
    wire(m, 4, '2+', '2C');
    wire(m, 5, '2E', '2F');
    wire(m, 6, '2F', '2-');
    expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
    expect(m.apply({ k: 'button', n: 1, target: 1000 })).toEqual({ ok: true });
    expect(m.apply({ k: 'switch', n: 1, target: 1000 })).toEqual({ ok: true });
    expect(m.apply({ k: 'dialGrab', targetUdeg: 22_500_000 })).toEqual({ ok: true });
    m.advance(1);
    expect(m.drainEvents().map((event) => event.k +
      (event.k === 'lamp.on' || event.k === 'lamp.off' ? ':' + event.kind + event.n : ''))).toEqual([
      'power.on',
      'relay.pullIn',
      'contact.break', 'contact.make', 'contact.break', 'contact.make',
      'contact.break', 'contact.make',
      'contact.break', 'contact.make', 'contact.break', 'contact.make',
      'dial.break', 'dial.make',
      'lamp.on:out1', 'lamp.on:ind2',
    ]);
  });

  it('rejects invalid advance counts without applying queued commands', () => {
    const m = machine();
    expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
    for (const invalid of [-1, 0.5, Number.NaN, 2147483648]) expect(() => m.advance(invalid)).toThrow(RangeError);
    expect(m.snapshot()).toMatchObject({ tick: 0, power: false });
    m.advance(0);
    expect(m.snapshot()).toMatchObject({ tick: 0, power: false });
  });

  it('preflights tick overflow before mutating or consuming the queued state', () => {
    const m = machine();
    expect(m.apply({ k: 'button', n: 1, target: 1000 })).toEqual({ ok: true });
    const internals = m as unknown as { tick: number };
    internals.tick = 2147483647;
    expect(() => m.advance(1)).toThrow(RangeError);
    expect(m.snapshot().buttons[0]!.travel).toBe(0);
    internals.tick = 0;
    m.advance(1);
    expect(m.snapshot().buttons[0]!.travel).toBeGreaterThan(0);
  });
});

describe('integrated devices and steady notes', () => {
  it('uses relay operate/release rates and lets the last queued grab replace its target', () => {
    const m = machine();
    expect(m.apply({ k: 'relayGrab', n: 1, target: 1000 })).toEqual({ ok: true });
    expect(m.apply({ k: 'relayGrab', n: 1, target: 500 })).toEqual({ ok: true });
    m.advance(Math.ceil(profile.derived.relayOperateTicks / 2));
    expect(m.snapshot().relays[0]).toMatchObject({ travel: 500, held: true });
    expect(m.apply({ k: 'relayGrab', n: 1, target: 0 })).toEqual({ ok: true });
    m.advance(Math.ceil(profile.derived.relayReleaseTicks / 2));
    expect(m.snapshot().relays[0]).toMatchObject({ travel: 0, held: true });
  });

  it('gives a held hand rate-bounded relay ownership against the coil and preserves it across source gates', () => {
    const m = machine();
    wire(m, 0, '1+', '1E');
    wire(m, 1, '1F', '1-');
    powerAndAdvance(m, 500);
    expect(m.snapshot().relays[0]).toMatchObject({ travel: 1000, held: false, band: 'above' });
    m.drainEvents();

    expect(m.apply({ k: 'relayGrab', n: 1, target: 0 })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot().relays[0]).toMatchObject({ held: true, band: 'above' });
    expect(m.snapshot().relays[0]!.travel).toBeLessThan(1000);
    expect(m.motionMask() & 1).toBe(1);
    expect(m.drainEvents().filter((event) => event.k.startsWith('relay.'))).toEqual([]);

    expect(m.apply({ k: 'power', on: false })).toEqual({ ok: true });
    m.advance(1);
    const off = m.snapshot().relays[0]!;
    expect(off).toMatchObject({ held: true, coilUa: 0, band: 'below' });
    expect(off.travel).toBeLessThan(1000);
    expect(m.apply({ k: 'breaker', reset: true })).toEqual({ ok: true });
    expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot().relays[0]).toMatchObject({ held: true });
  });

  it('uses the last physical direction for an in-band handoff from an arbitrary stopped target', () => {
    const m = machine();
    wire(m, 0, '1+', '1E');
    wire(m, 1, '1F', '1-');
    powerAndAdvance(m, 500);
    m.drainEvents();
    expect(m.apply({ k: 'relayGrab', n: 1, target: 500 })).toEqual({ ok: true });
    m.advance(Math.ceil(profile.derived.relayReleaseTicks / 2));
    expect(m.snapshot().relays[0]).toMatchObject({ travel: 500, held: true });
    expect(m.apply({ k: 'disconnect', cord: 0 })).toEqual({ ok: true });
    expect(m.apply({ k: 'connect', cord: 0, a: touch('1+'), b: touch('1E'), r_uohm: 200_000_000 }))
      .toEqual({ ok: true });
    m.advance(500);
    expect(m.snapshot().relays[0]).toMatchObject({ travel: 500, held: true, band: 'hold' });
    expect(m.motionMask() & 1).toBe(0);
    expect(m.apply({ k: 'relayRelease', n: 1 })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot().relays[0]!.travel).toBeLessThan(500);
    expect(m.drainEvents().filter((event) => event.k.startsWith('relay.'))).toEqual([]);
  });

  it('suppresses only a real held-tick handoff, not grab and release in one boundary', () => {
    const immediate = JSON.parse(JSON.stringify(profile)) as Profile;
    (immediate.v as { L_coil_uh: number }).L_coil_uh = 1;
    const m = machine(immediate);
    wire(m, 0, '1+', '1E');
    wire(m, 1, '1F', '1-');
    expect(m.apply({ k: 'relayGrab', n: 1, target: 0 })).toEqual({ ok: true });
    expect(m.apply({ k: 'relayRelease', n: 1 })).toEqual({ ok: true });
    powerAndAdvance(m, 1);
    expect(m.drainEvents().filter((event) => event.k.startsWith('relay.'))).toEqual([{
      t: 0,
      k: 'relay.pullIn',
      n: 1,
      coilUa: expect.any(Number),
      marginUa: expect.any(Number),
    }]);

    const held = machine(immediate);
    wire(held, 0, '1+', '1E');
    wire(held, 1, '1F', '1-');
    expect(held.apply({ k: 'relayGrab', n: 1, target: 0 })).toEqual({ ok: true });
    powerAndAdvance(held, 1);
    held.drainEvents();
    expect(held.apply({ k: 'relayRelease', n: 1 })).toEqual({ ok: true });
    held.advance(1);
    expect(held.drainEvents().filter((event) => event.k.startsWith('relay.'))).toEqual([]);
  });

  it('emits a later threshold Event when release-at-stop had no electrical motion', () => {
    const immediate = JSON.parse(JSON.stringify(profile)) as Profile;
    (immediate.v as { L_coil_uh: number }).L_coil_uh = 1;
    const m = machine(immediate);
    powerAndAdvance(m, 1);
    expect(m.apply({ k: 'relayGrab', n: 1, target: 0 })).toEqual({ ok: true });
    m.advance(1);
    expect(m.apply({ k: 'relayRelease', n: 1 })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot().relays[0]).toMatchObject({ travel: 0, held: false, band: 'below' });
    m.drainEvents();

    wire(m, 0, '1+', '1E');
    wire(m, 1, '1F', '1-');
    m.advance(1);
    expect(m.drainEvents().filter((event) => event.k.startsWith('relay.'))).toEqual([{
      t: 3,
      k: 'relay.pullIn',
      n: 1,
      coilUa: expect.any(Number),
      marginUa: expect.any(Number),
    }]);
  });

  it('accepts repeated release as a no-op and cold-resets only unheld relay mechanics', () => {
    const m = machine();
    expect(m.apply({ k: 'relayGrab', n: 1, target: 500 })).toEqual({ ok: true });
    expect(m.apply({ k: 'relayGrab', n: 2, target: 500 })).toEqual({ ok: true });
    m.advance(20);
    const heldTravel = m.snapshot().relays[0]!.travel;
    expect(m.apply({ k: 'relayRelease', n: 2 })).toEqual({ ok: true });
    expect(m.apply({ k: 'relayRelease', n: 2 })).toEqual({ ok: true });
    expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot().relays[0]).toMatchObject({ held: true });
    expect(m.snapshot().relays[0]!.travel).toBeGreaterThanOrEqual(heldTravel);
    expect(m.snapshot().relays[1]).toMatchObject({ held: false, travel: 0 });
    m.advance(profile.derived.relayOperateTicks);
    expect(m.snapshot().relays[0]).toMatchObject({ held: true, travel: 500 });
  });

  it('does not release a held relay when the breaker trips', () => {
    const m = machine();
    wire(m, 0, '1+', '1-');
    expect(m.apply({ k: 'relayGrab', n: 1, target: 1000 })).toEqual({ ok: true });
    powerAndAdvance(m, 2);
    expect(m.snapshot()).toMatchObject({ breakerTripped: true });
    expect(m.snapshot().relays[0]).toMatchObject({ held: true });
    expect(m.snapshot().relays[0]!.travel).toBeGreaterThan(0);
  });

  it('reports the exact stable 18-bit relay/pushbutton/slide motion mapping', () => {
    const m = machine();
    for (let n = 1; n <= 6; n++) {
      wire(m, (n - 1) * 2, String(n) + '+', String(n) + 'E');
      wire(m, (n - 1) * 2 + 1, String(n) + 'F', String(n) + '-');
      expect(m.apply({ k: 'button', n: n as 1, target: 1000 })).toEqual({ ok: true });
      expect(m.apply({ k: 'switch', n: n as 1, target: 1000 })).toEqual({ ok: true });
    }
    powerAndAdvance(m, 61);
    expect(m.motionMask()).toBe(0x3ffff);
    expect(m.motionMask()).toBe(0x3ffff);
    m.advance(profile.derived.slideTicks);
    expect(m.motionMask()).toBe(0);
  });

  it('reports motion on a zero-integer-displacement tick', () => {
    const slow = JSON.parse(JSON.stringify(profile)) as Profile;
    (slow.derived as { pushbuttonTicks: number }).pushbuttonTicks = 2000;
    const m = machine(slow);
    expect(m.apply({ k: 'button', n: 1, target: 1000 })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot().buttons[0]!.travel).toBe(0);
    expect(m.motionMask()).toBe(1 << 6);
    m.advance(1999);
    expect(m.snapshot().buttons[0]!.travel).toBe(1000);
    expect(m.motionMask()).toBe(0);
  });

  it('reproduces MM-RLY-CHECK including its E-fed dark indicator', () => {
    const m = machine();
    const wires = [
      ['1+', '1H'], ['1+', '1L'], ['2+', '1Y'], ['1X', '1E'], ['1F', '1-'],
      ['1J', '1A'], ['1B', '1-'], ['1G', '2A'], ['2B', '2-'], ['1N', '3A'],
      ['3B', '3-'], ['1K', '4A'], ['4B', '4-'],
    ] as const;
    for (let i = 0; i < wires.length; i++) wire(m, i, wires[i]![0], wires[i]![1]);
    powerAndAdvance(m, 1000);
    expect(m.snapshot().outLamps.slice(0, 4).map((lamp) => lamp.cls)).toEqual(['on', 'off', 'on', 'off']);
    expect(m.snapshot().indLamps[0]!.cls).toBe('off');
    expect(m.apply({ k: 'button', n: 1, target: 1000 })).toEqual({ ok: true });
    m.advance(1001);
    expect(m.snapshot().outLamps.slice(0, 4).map((lamp) => lamp.cls)).toEqual(['off', 'on', 'off', 'on']);
    expect(m.snapshot().indLamps[0]!.cls).toBe('off');
  });

  it('reproduces both I-EXP7 E-fed and C-fed relay-indicator wirings', () => {
    const common = [
      ['1+', '1H'], ['1J', '2A'], ['1B', '1-'], ['1G', '1A'],
      ['2B', '2-'], ['1+', '1Y'],
    ] as const;
    for (const feed of ['1E', '1C'] as const) {
      const m = machine();
      for (let i = 0; i < common.length; i++) wire(m, i, common[i]![0], common[i]![1]);
      wire(m, 6, '1X', feed);
      wire(m, 7, '1F', '1-');
      powerAndAdvance(m, 1000);
      expect(m.snapshot().outLamps.slice(0, 2).map((lamp) => lamp.cls)).toEqual(['off', 'on']);
      expect(m.apply({ k: 'button', n: 1, target: 1000 })).toEqual({ ok: true });
      m.advance(1500);
      expect(m.snapshot().relays[0]!.travel).toBe(1000);
      expect(m.snapshot().outLamps.slice(0, 2).map((lamp) => lamp.cls)).toEqual(['on', 'off']);
      expect(m.snapshot().indLamps[0]!.cls).toBe(feed === '1C' ? 'on' : 'off');
    }
  });

  it('advances mutually cross-gated relay crossings from one pre-update solution', () => {
    const equalThresholds = JSON.parse(JSON.stringify(profile)) as Profile;
    (equalThresholds.derived.relayPullInUa as number[]).fill(equalThresholds.derived.pullInUa);
    (equalThresholds.derived.relayDropOutUa as number[]).fill(equalThresholds.derived.dropOutUa);
    const m = machine(equalThresholds);
    const wires = [
      ['1+', '2H'], ['2J', '1E'], ['1F', '1-'],
      ['2+', '1H'], ['1J', '2E'], ['2F', '2-'],
    ] as const;
    for (let i = 0; i < wires.length; i++) wire(m, i, wires[i]![0], wires[i]![1]);

    powerAndAdvance(m, 109);
    expect(m.snapshot().relays.slice(0, 2).map((relay) => relay.travel)).toEqual([441, 441]);
    m.drainEvents();
    m.advance(1);
    expect(m.snapshot().relays.slice(0, 2).map((relay) => relay.travel)).toEqual([450, 450]);
    expect(m.drainEvents()).toEqual([
      { t: 109, k: 'contact.break', arm: parseTerminalId('1H'), to: parseTerminalId('1J') },
      { t: 109, k: 'contact.break', arm: parseTerminalId('1L'), to: parseTerminalId('1N') },
      { t: 109, k: 'contact.break', arm: parseTerminalId('2H'), to: parseTerminalId('2J') },
      { t: 109, k: 'contact.break', arm: parseTerminalId('2L'), to: parseTerminalId('2N') },
    ]);
  });

  it('holds a relay at a stop and continues its direction mid-stroke while current is in-band', () => {
    const atStop = machine();
    wire(atStop, 0, '1+', '1E');
    wire(atStop, 1, '1F', '1-');
    powerAndAdvance(atStop, 500);
    expect(atStop.snapshot().relays[0]!.travel).toBe(1000);
    expect(atStop.apply({ k: 'disconnect', cord: 0 })).toEqual({ ok: true });
    expect(atStop.apply({ k: 'connect', cord: 0, a: touch('1+'), b: touch('1E'), r_uohm: 200_000_000 }))
      .toEqual({ ok: true });
    atStop.advance(500);
    expect(atStop.snapshot().relays[0]).toMatchObject({ travel: 1000, band: 'hold' });

    const inFlight = machine();
    wire(inFlight, 0, '1+', '1E');
    wire(inFlight, 1, '1F', '1-');
    powerAndAdvance(inFlight, 90);
    expect(inFlight.snapshot().relays[0]!.travel).toBeGreaterThan(0);
    expect(inFlight.snapshot().relays[0]!.travel).toBeLessThan(1000);
    expect(inFlight.apply({ k: 'disconnect', cord: 0 })).toEqual({ ok: true });
    expect(inFlight.apply({ k: 'connect', cord: 0, a: touch('1+'), b: touch('1E'), r_uohm: 200_000_000 }))
      .toEqual({ ok: true });
    inFlight.advance(500);
    expect(inFlight.snapshot().relays[0]).toMatchObject({ travel: 1000, band: 'hold' });
  });

  it('distinguishes the open-coil arc release from a shorted-coil freewheel', () => {
    const release = (shorted: boolean): number => {
      const m = machine();
      wire(m, 0, '1+', '1E');
      wire(m, 1, '1F', '1-');
      powerAndAdvance(m, 500);
      expect(m.apply({ k: 'disconnect', cord: 0 })).toEqual({ ok: true });
      if (shorted) wire(m, 2, '1E', '1F');
      m.advance(1);
      return m.snapshot().relays[0]!.coilUa;
    };
    const openUa = release(false);
    const shortedUa = release(true);
    expect(openUa).toBeGreaterThan(0);
    expect(shortedUa).toBeGreaterThan(openUa);
  });

  it('parks a pushbutton at both-open target 500', () => {
    const m = machine();
    expect(m.apply({ k: 'button', n: 1, target: 500 })).toEqual({ ok: true });
    m.advance(Math.ceil(profile.derived.pushbuttonTicks / 2));
    expect(m.snapshot().buttons[0]).toEqual({ travel: 500, nc: false, no: false });
  });

  it('uses the disabled-source release, cooling and drive-removed coast paths', () => {
    const relay = machine();
    wire(relay, 0, '1+', '1E');
    wire(relay, 1, '1F', '1-');
    wire(relay, 2, '1+', '1A');
    wire(relay, 3, '1B', '1-');
    powerAndAdvance(relay, 1000);
    const hot = relay.snapshot().outLamps[0]!.milli;
    expect(relay.snapshot().relays[0]!.travel).toBe(1000);
    expect(hot).toBeGreaterThan(0);
    expect(relay.apply({ k: 'power', on: false })).toEqual({ ok: true });
    relay.advance(1);
    expect(relay.snapshot().relays[0]!.coilUa).toBe(0);
    const relayInternals = relay as unknown as { carried: { iCoil: Float64Array } };
    expect(Object.is(relayInternals.carried.iCoil[0], 0)).toBe(true);
    expect(relay.snapshot().relays[0]!.travel).toBeLessThan(1000);
    expect(relay.snapshot().outLamps[0]!.ua).toBe(0);
    expect(relay.snapshot().outLamps[0]!.milli).toBeLessThan(hot);

    const dial = machine();
    wire(dial, 0, '1+', 'D17');
    wire(dial, 1, '1-', 'D18');
    powerAndAdvance(dial, 2);
    expect(dial.snapshot().dial.mrpm).not.toBe(0);
    const before = dial.snapshot().dial.udeg;
    expect(dial.apply({ k: 'power', on: false })).toEqual({ ok: true });
    dial.advance(1);
    expect(dial.snapshot().dial.mrpm).toBe(0);
    expect(dial.snapshot().dial.udeg).not.toBe(before);
  });

  it('keeps a redundant dial release from erasing same-boundary power-loss coast', () => {
    // A local 20 deg coast, independent of the shipped value, so the coast crosses onto pad 15.
    const m = machine(loadProfile({
      ...refJson,
      values: { ...refJson.values, coast_udeg_drive_removed: { ...refJson.values.coast_udeg_drive_removed, v: 20_000_000 } },
    }));
    // Reversed RUN (D18 at +) drives toward decreasing numbers (§13.4.5).
    wire(m, 0, '1-', 'D17');
    wire(m, 1, '1+', 'D18');
    powerAndAdvance(m, 2);
    expect(m.snapshot().dial).toEqual({ udeg: 359_946_000, contact: 0, mrpm: -45_000, held: false });
    m.drainEvents();

    expect(m.apply({ k: 'dialRelease' })).toEqual({ ok: true });
    expect(m.apply({ k: 'power', on: false })).toEqual({ ok: true });
    m.advance(1);

    expect(m.snapshot().dial).toEqual({ udeg: 339_946_000, contact: 15, mrpm: 0, held: false });
    expect(m.drainEvents()).toEqual([
      { t: 2, k: 'power.off' },
      { t: 2, k: 'dial.break', pos: 0 },
      { t: 2, k: 'dial.make', pos: 15 },
    ]);
    m.advance(1);
    expect(m.snapshot().dial.udeg).toBe(339_946_000);
    expect(m.drainEvents()).toEqual([]);
  });

  it('derives ordered series-chain notes and a dynamic cord drop only after the quiet gate', () => {
    const m = machine();
    expect(m.apply({
      k: 'connect',
      cord: 255,
      a: touch('1+'),
      b: touch('1C'),
      r_uohm: 300_000_000,
    })).toEqual({ ok: true });
    wire(m, 2, '1F', '1-');
    powerAndAdvance(m, 3000);
    expect(m.snapshot().notes).toEqual([
      {
        k: 'coil-starved',
        relay: 1,
        coilUa: m.snapshot().relays[0]!.coilUa,
        needsUa: profile.derived.relayPullInUa[0],
        drops: [
          { el: 'cord:255', mv: 7052 },
          { el: 'ind1', mv: 2406 },
        ],
      },
      { k: 'lamp-in-coil-path', relay: 1, lampMv: 2406 },
    ]);
    expect(m.apply({ k: 'button', n: 1, target: 1 })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot().notes).toEqual([]);
    m.advance(profile.v.settle_quiet_ticks - 1);
    expect(m.snapshot().notes).toEqual([]);
    m.advance(1);
    expect(m.snapshot().notes).toHaveLength(2);

    const bypassed = machine();
    expect(bypassed.apply({
      k: 'connect',
      cord: 255,
      a: touch('1+'),
      b: touch('1C'),
      r_uohm: 300_000_000,
    })).toEqual({ ok: true });
    wire(bypassed, 2, '1F', '1-');
    wire(bypassed, 3, '1C', '1E');
    powerAndAdvance(bypassed, 3000);
    expect(bypassed.snapshot().notes).toEqual([{
      k: 'coil-starved',
      relay: 1,
      coilUa: bypassed.snapshot().relays[0]!.coilUa,
      needsUa: profile.derived.relayPullInUa[0],
      drops: [{ el: 'cord:255', mv: 8654 }],
    }]);
  });

  it('ignores self-loops, stops at parallel branches and freezes equal-drop ties by element index', () => {
    const selfLoop = machine();
    wire(selfLoop, 10, '1C', '1C', 1_000_000);
    wire(selfLoop, 255, '1+', '1C', 300_000_000);
    wire(selfLoop, 2, '1F', '1-');
    powerAndAdvance(selfLoop, 3000);
    const selfDrops = (selfLoop.snapshot().notes[0] as { drops: { el: string }[] }).drops.map((drop) => drop.el);
    expect(selfDrops).toEqual(['cord:255', 'ind1']);

    const parallel = machine();
    wire(parallel, 254, '1+', '1C', 600_000_000);
    wire(parallel, 255, '1+', '1C', 600_000_000);
    wire(parallel, 2, '1F', '1-');
    powerAndAdvance(parallel, 3000);
    const parallelNotes = parallel.snapshot().notes;
    expect((parallelNotes[0] as { drops: { el: string }[] }).drops.map((drop) => drop.el)).toEqual(['ind1']);
    expect(parallelNotes[1]).toMatchObject({ k: 'lamp-in-coil-path', relay: 1 });

    const tied = machine();
    wire(tied, 9, '1+', 'M1t', 150_000_000);
    wire(tied, 3, 'M1t', '1C', 150_000_000);
    wire(tied, 2, '1F', '1-');
    powerAndAdvance(tied, 3000);
    const tiedDrops = (tied.snapshot().notes[0] as { drops: { el: string; mv: number }[] }).drops;
    const cord3 = tiedDrops.findIndex((drop) => drop.el === 'cord:3');
    const cord9 = tiedDrops.findIndex((drop) => drop.el === 'cord:9');
    expect(cord3).toBeGreaterThanOrEqual(0);
    expect(cord9).toBe(cord3 + 1);
    expect(tiedDrops[cord3]!.mv).toBe(tiedDrops[cord9]!.mv);
  });

  it('stops a meeting endpoint walk when the other accepted edge plus an extra edge form a branch', () => {
    const m = machine();
    const internals = m as unknown as {
      graph: { elementCount: number; _elementSlots: { k: string; a: number; b: number }[] };
      chainVisited: Uint8Array;
      walkChain(node: number, incoming: number): void;
    };
    internals.graph.elementCount = 5;
    Object.assign(internals.graph._elementSlots[0]!, { k: 'coil', a: 0, b: 1 });
    Object.assign(internals.graph._elementSlots[1]!, { k: 'res', a: 0, b: 2 });
    Object.assign(internals.graph._elementSlots[2]!, { k: 'res', a: 1, b: 2 });
    Object.assign(internals.graph._elementSlots[3]!, { k: 'res', a: 2, b: 3 });
    Object.assign(internals.graph._elementSlots[4]!, { k: 'source', a: 3, b: 4 });
    internals.chainVisited.fill(0);
    internals.chainVisited[0] = 1;
    internals.walkChain(0, 0);
    internals.walkChain(1, 0);
    expect([...internals.chainVisited.subarray(0, 5)]).toEqual([1, 1, 1, 0, 0]);
  });

  it('keeps nonPortable sticky across later good ticks and a power epoch', () => {
    const extreme = JSON.parse(JSON.stringify(profile)) as Profile;
    (extreme.v as { run_mrpm: number }).run_mrpm = 2147483647;
    (extreme.derived as { vMotorRunMv: number }).vMotorRunMv = 1;
    const m = machine(extreme);
    wire(m, 0, '1+', 'D18');
    wire(m, 1, '1-', 'D19');
    powerAndAdvance(m, 1);
    expect(m.snapshot().flags.nonPortable).toBe(true);
    expect(m.apply({ k: 'power', on: false })).toEqual({ ok: true });
    expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
    m.advance(1);
    expect(m.snapshot().flags.nonPortable).toBe(true);
  });
});
