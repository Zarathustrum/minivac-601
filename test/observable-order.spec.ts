/** Independent pin for architecture §9.2 and §13.4.9's 33-observable order. */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import refJson from '../data/profiles/MV601-REF-A.json';
import type { Machine } from '../src/core/contract.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import type { LoadedNetlist } from '../src/core/netlist.ts';
import { loadProfile } from '../src/core/profile.ts';
import type { Profile } from '../src/core/profile.ts';
import { OBSERVABLE_COUNT, OBSERVABLES, writeObservables } from '../src/core/trace.ts';
import type { ObservableSource } from '../src/core/trace.ts';

const NAMES = [
  'power', 'breaker',
  'relay1', 'relay2', 'relay3', 'relay4', 'relay5', 'relay6',
  'pb1', 'pb2', 'pb3', 'pb4', 'pb5', 'pb6',
  'sw1', 'sw2', 'sw3', 'sw4', 'sw5', 'sw6',
  'dial',
  'outLamp1', 'outLamp2', 'outLamp3', 'outLamp4', 'outLamp5', 'outLamp6',
  'indLamp1', 'indLamp2', 'indLamp3', 'indLamp4', 'indLamp5', 'indLamp6',
] as const;
const MOVER_VALUES = ['nc', 'mid', 'no'] as const;
const LAMP_VALUES = ['off', 'dim', 'on'] as const;

function source(): ObservableSource {
  return {
    power: false,
    breakerTripped: false,
    relays: Array.from({ length: 6 }, () => ({ set1: { nc: true, no: false } })),
    buttons: Array.from({ length: 6 }, () => ({ nc: true, no: false })),
    switches: Array.from({ length: 6 }, () => ({ set1: [true, false] as const })),
    dial: { contact: 0 },
    outLamps: Array.from({ length: 6 }, () => ({ cls: 'off' as const })),
    indLamps: Array.from({ length: 6 }, () => ({ cls: 'off' as const })),
  };
}

function assertOnly(index: number, value: number, mutate: (state: ObservableSource) => void): void {
  const state = source();
  const before = writeObservables(state, new Int32Array(OBSERVABLE_COUNT)).slice();
  mutate(state);
  const after = writeObservables(state, new Int32Array(OBSERVABLE_COUNT));
  expect(after[index], NAMES[index]).toBe(value);
  expect(Array.from(after, (entry, at) => entry === before[at] ? -1 : at).filter((at) => at >= 0), NAMES[index])
    .toEqual([index]);
}

describe('the frozen observable order', () => {
  it('matches the independent 33-name and value-vocabulary contract exactly', () => {
    expect(OBSERVABLE_COUNT).toBe(33);
    expect(OBSERVABLES.map((row) => row.name)).toEqual(NAMES);
    expect(OBSERVABLES.map((row) => row.minValue)).toEqual([
      0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      -1,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
    ]);
    expect(OBSERVABLES[0]?.values).toEqual(['off', 'on']);
    expect(OBSERVABLES[1]?.values).toEqual(['ok', 'tripped']);
    for (let i = 2; i <= 19; i++) expect(OBSERVABLES[i]?.values).toEqual(MOVER_VALUES);
    expect(OBSERVABLES[20]?.values).toEqual([
      'gap', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7',
      'c8', 'c9', 'c10', 'c11', 'c12', 'c13', 'c14', 'c15',
    ]);
    for (let i = 21; i < 33; i++) expect(OBSERVABLES[i]?.values).toEqual(LAMP_VALUES);
  });

  it('binds every State source to its one frozen vector index', () => {
    assertOnly(0, 1, (state) => { state.power = true; });
    assertOnly(1, 1, (state) => { state.breakerTripped = true; });
    for (let i = 0; i < 6; i++) {
      assertOnly(2 + i, 2, (state) => { state.relays[i] = { set1: { nc: false, no: true } }; });
      assertOnly(8 + i, 2, (state) => { state.buttons[i] = { nc: false, no: true }; });
      assertOnly(14 + i, 2, (state) => { state.switches[i] = { set1: [false, true] }; });
      assertOnly(21 + i, 2, (state) => { state.outLamps[i] = { cls: 'on' }; });
      assertOnly(27 + i, 2, (state) => { state.indLamps[i] = { cls: 'on' }; });
    }
    assertOnly(20, -1, (state) => { state.dial.contact = null; });
  });
});

const MACHINE_URL = new URL('../src/core/machine.ts', import.meta.url);
if (existsSync(MACHINE_URL)) {
  it('binds Machine to the shared 33-entry overwrite seam when machine.ts is present', async () => {
    const modulePath = MACHINE_URL.href;
    const machineModule = await import(/* @vite-ignore */ modulePath) as {
      createMachine(netlist: LoadedNetlist, profile: Profile): Machine;
    };
    const raw = new Uint8Array(readFileSync(new URL('../data/netlist.json', import.meta.url)));
    const machine = machineModule.createMachine(loadNetlist(raw), loadProfile(refJson));
    const first = machine.observables();
    expect(first).toEqual(new Int32Array(OBSERVABLE_COUNT));
    expect(machine.observables()).toBe(first);

    expect(machine.apply({ k: 'power', on: true })).toEqual({ ok: true });
    machine.advance(1);
    expect(machine.observables()[0]).toBe(1);
  });
}
