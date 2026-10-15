/** Wave 3 device proof for architecture §13.4.3, §13.4.4 and §13.4.6. */
import { describe, expect, it } from 'vitest';
import netlistJson from '../data/netlist.json';
import refJson from '../data/profiles/MV601-REF-A.json';
import {
  CONTACT_NC,
  CONTACT_NO,
  CONTACT_OPEN,
  LAMP_NO_EVENT,
  LAMP_OFF,
  LAMP_ON,
  RELAY_DROP_OUT,
  RELAY_NO_EVENT,
  RELAY_PULL_IN,
  advanceLampFilament,
  advanceRelay,
  advanceTargetMover,
  applyLatchedBreakerTrip,
  breakerOverThreshold,
  clearBreakerDwell,
  coldResetElectrical,
  emitTransferEdges,
  lampBrightnessMilli,
  lampClass,
  lampClassEvent,
  latchBreakerPending,
  relayBand,
  relayMarginUa,
  resetBreaker,
  sampleBreaker,
  sourceEnabled,
  transferPosition,
  writeContactPositions,
} from '../src/core/devices.ts';
import type {
  BreakerState,
  ContactEdge,
  MoverBank,
} from '../src/core/devices.ts';
import { buildGraph } from '../src/core/graph.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import type { NetContact } from '../src/core/netlist.ts';
import { loadProfile } from '../src/core/profile.ts';
import { terminalIndex } from '../src/core/terminals.ts';
import type { TerminalId } from '../src/core/terminals.ts';

const profile = loadProfile(refJson);

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

const netlist = loadNetlist(ascii(JSON.stringify(netlistJson)));

function movers(travel: readonly number[] = [0], dir?: readonly number[], acc?: readonly number[]): MoverBank {
  return {
    travel: Int32Array.from(travel),
    dir: Int8Array.from(dir ?? travel.map(() => 0)),
    acc: Int32Array.from(acc ?? travel.map(() => 0)),
  };
}

function moverState(bank: MoverBank, n = 0): { travel: number; dir: number; acc: number } {
  return { travel: bank.travel[n] as number, dir: bank.dir[n] as number, acc: bank.acc[n] as number };
}

function runTarget(bank: MoverBank, n: number, target: number, strokeTicks: number, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) advanceTargetMover(bank, n, target, strokeTicks);
}

function breaker(): BreakerState {
  return { overloadTicks: 0, tripPending: false, tripped: false };
}

describe('the one integer-remainder mover', () => {
  it('lands relay operate/release and button/switch strokes on their exact profile tick counts', () => {
    const relay = movers();
    for (let tick = 0; tick < profile.derived.relayOperateTicks - 1; tick++) {
      expect(advanceRelay(
        relay,
        0,
        profile.derived.relayPullInUa[0] as number,
        profile.derived.relayPullInUa[0] as number,
        profile.derived.relayDropOutUa[0] as number,
        profile.derived.relayOperateTicks,
        profile.derived.relayReleaseTicks,
      ), `operate tick ${tick}`).toBe(tick === 0 ? RELAY_PULL_IN : RELAY_NO_EVENT);
    }
    expect(relay.travel[0]).toBeLessThan(1000);
    advanceRelay(
      relay,
      0,
      profile.derived.relayPullInUa[0] as number,
      profile.derived.relayPullInUa[0] as number,
      profile.derived.relayDropOutUa[0] as number,
      profile.derived.relayOperateTicks,
      profile.derived.relayReleaseTicks,
    );
    expect(moverState(relay)).toEqual({ travel: 1000, dir: 0, acc: 0 });

    for (let tick = 0; tick < profile.derived.relayReleaseTicks - 1; tick++) {
      expect(advanceRelay(
        relay,
        0,
        profile.derived.relayDropOutUa[0] as number,
        profile.derived.relayPullInUa[0] as number,
        profile.derived.relayDropOutUa[0] as number,
        profile.derived.relayOperateTicks,
        profile.derived.relayReleaseTicks,
      ), `release tick ${tick}`).toBe(tick === 0 ? RELAY_DROP_OUT : RELAY_NO_EVENT);
    }
    expect(relay.travel[0]).toBeGreaterThan(0);
    advanceRelay(
      relay,
      0,
      profile.derived.relayDropOutUa[0] as number,
      profile.derived.relayPullInUa[0] as number,
      profile.derived.relayDropOutUa[0] as number,
      profile.derived.relayOperateTicks,
      profile.derived.relayReleaseTicks,
    );
    expect(moverState(relay)).toEqual({ travel: 0, dir: 0, acc: 0 });

    for (const [strokeTicks, label] of [
      [profile.derived.pushbuttonTicks, 'button'],
      [profile.derived.slideTicks, 'switch'],
    ] as const) {
      const state = movers();
      runTarget(state, 0, 1000, strokeTicks, strokeTicks - 1);
      expect(state.travel[0], label).toBeLessThan(1000);
      runTarget(state, 0, 1000, strokeTicks, 1);
      expect(moverState(state), label).toEqual({ travel: 1000, dir: 0, acc: 0 });
      runTarget(state, 0, 0, strokeTicks, strokeTicks - 1);
      expect(state.travel[0], label + ' reverse').toBeGreaterThan(0);
      runTarget(state, 0, 0, strokeTicks, 1);
      expect(moverState(state), label + ' reverse').toEqual({ travel: 0, dir: 0, acc: 0 });
    }
  });

  it('clears the remainder on reversal and clamps an arbitrary target exactly', () => {
    const reversed = movers([500], [1], [119]);
    advanceTargetMover(reversed, 0, 0, 120);
    expect(moverState(reversed)).toEqual({ travel: 492, dir: -1, acc: 40 });

    const midway = movers();
    runTarget(midway, 0, 500, profile.derived.pushbuttonTicks, 124);
    expect(midway.travel[0]).toBe(496);
    runTarget(midway, 0, 500, profile.derived.pushbuttonTicks, 1);
    expect(moverState(midway)).toEqual({ travel: 500, dir: 0, acc: 0 });

    const nonDividing = movers();
    runTarget(nonDividing, 0, 501, profile.derived.pushbuttonTicks, 125);
    expect(nonDividing.travel[0]).toBe(500);
    runTarget(nonDividing, 0, 501, profile.derived.pushbuttonTicks, 1);
    expect(moverState(nonDividing)).toEqual({ travel: 501, dir: 0, acc: 0 });
  });

  it('puts equality outside the band and continues an in-band relay only while mid-stroke', () => {
    const pull = profile.derived.relayPullInUa[0] as number;
    const drop = profile.derived.relayDropOutUa[0] as number;
    const relay = movers();

    expect(relayBand(pull, pull, drop)).toBe('above');
    expect(advanceRelay(relay, 0, -pull, pull, drop, 120, 80)).toBe(RELAY_PULL_IN);
    expect(relayMarginUa(RELAY_PULL_IN, -pull, pull, drop)).toBe(0);
    const movingTravel = relay.travel[0] as number;
    expect(advanceRelay(relay, 0, idivBand(pull, drop), pull, drop, 120, 80)).toBe(RELAY_NO_EVENT);
    expect(relay.travel[0]).toBeGreaterThan(movingTravel);
    expect(relay.dir[0]).toBe(1);

    expect(relayBand(drop, pull, drop)).toBe('below');
    expect(advanceRelay(relay, 0, -drop, pull, drop, 120, 80)).toBe(RELAY_DROP_OUT);
    expect(relayMarginUa(RELAY_DROP_OUT, -drop, pull, drop)).toBe(0);
    expect(relay.dir[0]).toBe(-1);

    const released = movers();
    expect(advanceRelay(released, 0, idivBand(pull, drop), pull, drop, 120, 80)).toBe(RELAY_NO_EVENT);
    expect(moverState(released)).toEqual({ travel: 0, dir: 0, acc: 0 });
    const operated = movers([1000]);
    expect(advanceRelay(operated, 0, pull + 1, pull, drop, 120, 80)).toBe(RELAY_NO_EVENT);
    expect(moverState(operated)).toEqual({ travel: 1000, dir: 0, acc: 0 });
  });
});

function idivBand(pull: number, drop: number): number {
  return Math.trunc((pull + drop) / 2);
}

describe('transfer contacts in validated netlist order', () => {
  it('freezes the four exact break/make boundaries', () => {
    expect(transferPosition(449, 450, 550)).toBe(CONTACT_NC);
    expect(transferPosition(450, 450, 550)).toBe(CONTACT_OPEN);
    expect(transferPosition(550, 450, 550)).toBe(CONTACT_OPEN);
    expect(transferPosition(551, 450, 550)).toBe(CONTACT_NO);
  });

  it('emits break before make and carries the loaded row terminals', () => {
    const row = netlist.contacts[0] as Exclude<NetContact, { readonly k: 'wiper' }>;
    const got: { edge: ContactEdge; arm: TerminalId; to: TerminalId }[] = [];
    emitTransferEdges(row, CONTACT_NC, CONTACT_NO, (edge, arm, to) => got.push({ edge, arm, to }));
    expect(got).toEqual([
      { edge: 'break', arm: row.arm, to: row.nc },
      { edge: 'make', arm: row.arm, to: row.no },
    ]);
  });

  it('walks all 31 loaded rows without carrying a second device-order table', () => {
    const relays = movers([0, 1000, 500, 449, 450, 551]);
    const buttons = movers([1000, 0, 500, 551, 449, 550]);
    const switches = movers([500, 551, 450, 449, 1000, 0]);
    const out = new Int8Array(netlist.contacts.length);
    writeContactPositions(netlist, relays, buttons, switches, 7, 450, 550, out);

    expect(out.length).toBe(31);
    for (let i = 0; i < netlist.contacts.length; i++) {
      const row = netlist.contacts[i] as NetContact;
      if (row.k === 'wiper') {
        expect(out[i], `contact row ${i}`).toBe(7);
      } else {
        const bank = row.k === 'relay' ? relays : row.k === 'button' ? buttons : switches;
        expect(out[i], `contact row ${i}`).toBe(transferPosition(bank.travel[row.n - 1] as number, 450, 550));
      }
    }

    // `buildGraph` is the allocating wrapper over `buildGraphInto`; both consume this exact
    // GraphInput encoding. Passing the complete buffer here catches any code drift.
    const graph = buildGraph(netlist, profile, { cords: [], contactPosition: out });
    for (let i = 0; i < netlist.contacts.length; i++) {
      const row = netlist.contacts[i] as NetContact;
      const position = out[i] as number;
      if (row.k === 'wiper') {
        expect(graph.nodeByTerminal[terminalIndex(row.arm)]).toBe(
          graph.nodeByTerminal[terminalIndex(row.pads[position] as TerminalId)],
        );
      } else if (position === CONTACT_NC) {
        expect(graph.nodeByTerminal[terminalIndex(row.arm)]).toBe(graph.nodeByTerminal[terminalIndex(row.nc)]);
      } else if (position === CONTACT_NO) {
        expect(graph.nodeByTerminal[terminalIndex(row.arm)]).toBe(graph.nodeByTerminal[terminalIndex(row.no)]);
      }
    }

    writeContactPositions(netlist, relays, buttons, switches, null, 450, 550, out);
    expect(out[30]).toBe(-1);
  });
});

describe('lamp filament, brightness and Event boundaries', () => {
  const pwl = { xs: [0, 1], ys: [18, 160] };

  it('relaxes from the carried resistance toward the magnitude-selected PWL target', () => {
    expect(advanceLampFilament(160, 0, pwl, 0.25)).toBe(124.5);
    expect(advanceLampFilament(18, -1, pwl, 0.25)).toBe(53.5);
  });

  it('uses the literal resistance-derived integer brightness map and clamps', () => {
    expect(lampBrightnessMilli(18, 18, 160)).toBe(0);
    expect(lampBrightnessMilli(89, 18, 160)).toBe(500);
    expect(lampBrightnessMilli(160, 18, 160)).toBe(1000);
    expect(lampBrightnessMilli(1, 18, 160)).toBe(0);
    expect(lampBrightnessMilli(400, 18, 160)).toBe(1000);
  });

  it('rejects invalid resistance endpoints before computing brightness', () => {
    for (const [cold, hot] of [
      [18, 18],
      [160, 18],
      [0, 160],
      [-1, 160],
      [18, 0],
      [18, -1],
      [Number.NaN, 160],
      [Number.POSITIVE_INFINITY, 160],
      [18, Number.NaN],
      [18, Number.POSITIVE_INFINITY],
    ]) {
      expect(() => lampBrightnessMilli(89, cold as number, hot as number), `${cold}..${hot}`).toThrow(
        /lamp brightness resistance endpoints must be finite, positive, and increasing/,
      );
    }
  });

  it('rounds the frozen binary64 quotient on opposite sides of one half-integer boundary', () => {
    const bytes = new ArrayBuffer(8);
    const view = new DataView(bytes);
    view.setBigUint64(0, 0x4043af7ced916872n);
    const below = view.getFloat64(0);
    view.setBigUint64(0, 0x4043af7ced916873n);
    const above = view.getFloat64(0);

    expect(below).toBe(39.370999999999995);
    expect(above).toBe(39.371);
    expect(lampBrightnessMilli(below, 18, 160)).toBe(150);
    expect(lampBrightnessMilli(above, 18, 160)).toBe(151);
  });

  it('uses exact dim/on equalities and emits only transitions to or from off', () => {
    expect(lampClass(149, 150, 600)).toBe('off');
    expect(lampClass(150, 150, 600)).toBe('dim');
    expect(lampClass(599, 150, 600)).toBe('dim');
    expect(lampClass(600, 150, 600)).toBe('on');
    expect(lampClassEvent('off', 'dim')).toBe(LAMP_ON);
    expect(lampClassEvent('off', 'on')).toBe(LAMP_ON);
    expect(lampClassEvent('dim', 'on')).toBe(LAMP_NO_EVENT);
    expect(lampClassEvent('on', 'dim')).toBe(LAMP_NO_EVENT);
    expect(lampClassEvent('dim', 'off')).toBe(LAMP_OFF);
    expect(lampClassEvent('on', 'off')).toBe(LAMP_OFF);
  });
});

describe('cold electrical reset and the breaker boundary latch', () => {
  it('classifies the trip threshold itself as over-current', () => {
    expect(breakerOverThreshold(999, 1000)).toBe(false);
    expect(breakerOverThreshold(1000, 1000)).toBe(true);
    expect(breakerOverThreshold(-1000, 1000)).toBe(true);
  });

  it('cold-resets only relay/electrical state and canonicalises coil zero', () => {
    const relays = movers([333, 1000], [1, -1], [77, 99]);
    const manual = movers([500], [1], [3]);
    const b = { overloadTicks: 4, tripPending: true, tripped: true };
    const iCoil = Float64Array.from([-0, 1.5]);
    const rLamp = Float64Array.from([160, 80, 18]);
    coldResetElectrical(relays, iCoil, rLamp, 18);
    expect([...relays.travel]).toEqual([0, 0]);
    expect([...relays.dir]).toEqual([0, 0]);
    expect([...relays.acc]).toEqual([0, 0]);
    for (const current of iCoil) expect(Object.is(current, 0)).toBe(true);
    expect([...rLamp]).toEqual([18, 18, 18]);
    expect(moverState(manual)).toEqual({ travel: 500, dir: 1, acc: 3 });
    expect(b).toEqual({ overloadTicks: 4, tripPending: true, tripped: true });
  });

  it('preserves held relay travel and last physical direction while clearing its remainder', () => {
    const relays = movers([333, 777], [1, -1], [77, 99]);
    const held = Uint8Array.from([1, 0]);
    const lastPhysicalDir = Int8Array.from([1, -1]);
    const iCoil = Float64Array.from([1, 2]);
    const rLamp = Float64Array.from([160]);
    coldResetElectrical(relays, iCoil, rLamp, 18, held, lastPhysicalDir);
    expect([...relays.travel]).toEqual([333, 0]);
    expect([...relays.dir]).toEqual([0, 0]);
    expect([...relays.acc]).toEqual([0, 0]);
    expect([...lastPhysicalDir]).toEqual([1, 0]);
  });

  it('uses exact delayed and ideal-short thresholds, with a next-boundary trip', () => {
    const delayed = breaker();
    expect(sampleBreaker(delayed, true, 999, 1000, 5000, 3)).toBe(false);
    expect(delayed.overloadTicks).toBe(0);
    expect(sampleBreaker(delayed, true, -1000, 1000, 5000, 3)).toBe(true);
    expect(sampleBreaker(delayed, true, 1000, 1000, 5000, 3)).toBe(true);
    expect(delayed.tripPending).toBe(false);
    expect(sampleBreaker(delayed, true, 1000, 1000, 5000, 3)).toBe(true);
    expect(delayed).toEqual({ overloadTicks: 3, tripPending: true, tripped: false });
    sampleBreaker(delayed, true, 1000, 1000, 5000, 3);
    expect(delayed.overloadTicks).toBe(3);

    const incoming = latchBreakerPending(delayed);
    expect(incoming).toBe(true);
    expect(delayed.tripPending).toBe(false);
    expect(delayed.tripped).toBe(false);
    expect(applyLatchedBreakerTrip(delayed, incoming)).toBe(true);
    expect(delayed).toEqual({ overloadTicks: 0, tripPending: false, tripped: true });

    const immediate = breaker();
    expect(sampleBreaker(immediate, true, -5000, 1000, 5000, 2000)).toBe(true);
    expect(immediate.tripPending).toBe(true);
    expect(immediate.tripped).toBe(false);
  });

  it('resets dwell, supports effective reset, and preserves an already-latched trip', () => {
    const b = breaker();
    sampleBreaker(b, true, 1000, 1000, 5000, 3);
    expect(b.overloadTicks).toBe(1);
    expect(sampleBreaker(b, false, 5000, 1000, 5000, 3)).toBe(false);
    expect(b.overloadTicks).toBe(0);

    b.overloadTicks = 2;
    b.tripPending = true;
    clearBreakerDwell(b);
    expect(b).toEqual({ overloadTicks: 0, tripPending: true, tripped: false });
    const latched = latchBreakerPending(b);
    b.tripped = true;
    expect(resetBreaker(b)).toBe(true);
    expect(b).toEqual({ overloadTicks: 0, tripPending: false, tripped: false });
    expect(applyLatchedBreakerTrip(b, latched)).toBe(true);
    expect(b.tripped).toBe(true);
    expect(resetBreaker(b)).toBe(true);
    expect(resetBreaker(b)).toBe(false);
  });

  it('gates the source exactly on power and the latched breaker', () => {
    const b = breaker();
    expect(sourceEnabled(false, b)).toBe(false);
    expect(sourceEnabled(true, b)).toBe(true);
    b.tripped = true;
    expect(sourceEnabled(true, b)).toBe(false);
  });
});
