import { describe, expect, it } from 'vitest';
import demoDocument from '../data/demo-library.json';
import netlistText from '../data/netlist.json?raw';
import profileDocument from '../data/profiles/MV601-REF-A.json';
import type { Command, Machine, State } from '../src/core/contract.ts';
import { createMachine } from '../src/core/machine.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import { loadProfile } from '../src/core/profile.ts';
import { loadDemoLibrary } from '../src/demo-library.ts';
import {
  DEFAULT_PROFILE_ID,
  createDemoSession,
  type SessionContext,
  type SessionDemo,
} from '../src/session.ts';

interface TestMachine extends Machine {
  readonly name: string;
  readonly applied: Command[];
  advanced: number;
}

interface MountedLoop {
  readonly machine: TestMachine;
  readonly frame: () => void;
  readonly disposed: () => boolean;
}

function demo(id: string, ...commands: Command[]): SessionDemo {
  return { id, commands };
}

function machine(name: string, events: string[], rejectAt: number | null = null): TestMachine {
  const applied: Command[] = [];
  return {
    name,
    applied,
    advanced: 0,
    apply(command): ReturnType<Machine['apply']> {
      const index = applied.length;
      applied.push(command);
      events.push('apply:' + name + ':' + index);
      return index === rejectAt ? { ok: false, why: 'hole_occupied' } : { ok: true };
    },
    advance(ticks): void { this.advanced += ticks; },
    snapshot(): State { return {} as State; },
    observables(): Int32Array { return new Int32Array(33); },
    motionMask(): number { return 0; },
    drainEvents(): [] { return []; },
  };
}

function harness(
  rejections: Array<number | null> = [],
  mountFailures: string[] = [],
) {
  const events: string[] = [];
  const machines: TestMachine[] = [];
  const loops: MountedLoop[] = [];
  const contexts: SessionContext[] = [];
  let liveMounts = 0;
  let maxLiveMounts = 0;

  const session = createDemoSession({
    createMachine(profileId) {
      const name = 'm' + (machines.length + 1);
      events.push('create:' + name + ':' + profileId);
      const next = machine(name, events, rejections.shift() ?? null);
      machines.push(next);
      return next;
    },
    mount(candidate, context) {
      const mounted = candidate as TestMachine;
      contexts.push(context);
      events.push('mount:' + mounted.name);
      const failure = mountFailures.indexOf(mounted.name);
      if (failure >= 0) {
        mountFailures.splice(failure, 1);
        throw new Error('test mount failed: ' + mounted.name);
      }
      liveMounts++;
      maxLiveMounts = Math.max(maxLiveMounts, liveMounts);
      let isDisposed = false;
      const loop: MountedLoop = {
        machine: mounted,
        frame: () => { if (!isDisposed) mounted.advance(1); },
        disposed: () => isDisposed,
      };
      loops.push(loop);
      return () => {
        if (isDisposed) throw new Error('test mount disposed twice');
        isDisposed = true;
        liveMounts--;
        events.push('dispose:' + mounted.name);
      };
    },
  });

  return {
    events,
    machines,
    loops,
    contexts,
    session,
    liveMounts: () => liveMounts,
    maxLiveMounts: () => maxLiveMounts,
  };
}

describe('demo session lifecycle', () => {
  it('commits every production demo before mounting its exact cord state', () => {
    const netlist = loadNetlist(new TextEncoder().encode(netlistText));
    const profile = loadProfile(profileDocument);
    const library = loadDemoLibrary(demoDocument, netlist);
    const mounted: Array<{ id: string; tick: number; cords: number }> = [];
    let nextId = '';
    const session = createDemoSession({
      createMachine: () => createMachine(netlist, profile),
      mount(machine) {
        const state = machine.snapshot();
        mounted.push({ id: nextId, tick: state.tick, cords: state.cords.length });
        expect(machine.drainEvents(), nextId).toEqual([]);
        return () => {};
      },
    });

    for (const demo of library.demos) {
      nextId = demo.id;
      session.loadDemo(demo);
    }

    expect(mounted).toEqual(library.demos.map((demo) => ({
      id: demo.id,
      tick: 1,
      cords: demo.connections.length,
    })));
  });

  it('uses REF-A by default and applies every command in identity order before mounting', () => {
    const h = harness();
    const commands = [
      { k: 'power', on: true },
      { k: 'button', n: 2, target: 1000 },
    ] as const satisfies readonly Command[];

    h.session.loadDemo({ id: 'DEMO-A', commands });

    expect(DEFAULT_PROFILE_ID).toBe('MV601-REF-A');
    expect(h.events).toEqual([
      'create:m1:MV601-REF-A',
      'apply:m1:0',
      'apply:m1:1',
      'mount:m1',
    ]);
    expect(h.machines[0]?.applied[0]).toBe(commands[0]);
    expect(h.machines[0]?.applied[1]).toBe(commands[1]);
    expect(h.liveMounts()).toBe(1);
  });

  it('treats a blank manual session as a fresh zero-command Machine across reset and profile', () => {
    const h = harness();
    const manual = demo('MANUAL');

    h.session.loadDemo(manual);
    h.session.reset();
    h.session.switchProfile('MV601-IDEAL');

    expect(h.machines).toHaveLength(3);
    expect(h.machines.every((candidate) => candidate.applied.length === 0)).toBe(true);
    expect(h.contexts).toEqual([
      { demoId: 'MANUAL', profileId: 'MV601-REF-A' },
      { demoId: 'MANUAL', profileId: 'MV601-REF-A' },
      { demoId: 'MANUAL', profileId: 'MV601-IDEAL' },
    ]);
  });

  it('disposes before every replacement and retains demo/profile across switch and reset', () => {
    const h = harness();
    const a = demo('DEMO-A', { k: 'power', on: true });
    const b = demo('DEMO-B', { k: 'switch', n: 4, target: 1000 });

    h.session.loadDemo(a);
    h.session.switchProfile('MV601-IDEAL');
    h.session.reset();
    h.session.loadDemo(b);

    expect(h.events).toEqual([
      'create:m1:MV601-REF-A', 'apply:m1:0', 'mount:m1',
      'create:m2:MV601-IDEAL', 'apply:m2:0', 'dispose:m1', 'mount:m2',
      'create:m3:MV601-IDEAL', 'apply:m3:0', 'dispose:m2', 'mount:m3',
      'create:m4:MV601-IDEAL', 'apply:m4:0', 'dispose:m3', 'mount:m4',
    ]);
    expect(h.machines.map((candidate) => candidate.applied[0])).toEqual([
      a.commands[0], a.commands[0], a.commands[0], b.commands[0],
    ]);
    expect(new Set(h.machines).size).toBe(4);
    expect(h.maxLiveMounts()).toBe(1);
    expect(h.liveMounts()).toBe(1);
    expect(h.contexts).toEqual([
      { demoId: 'DEMO-A', profileId: 'MV601-REF-A' },
      { demoId: 'DEMO-A', profileId: 'MV601-IDEAL' },
      { demoId: 'DEMO-A', profileId: 'MV601-IDEAL' },
      { demoId: 'DEMO-B', profileId: 'MV601-IDEAL' },
    ]);
    expect(h.contexts.every(Object.isFrozen)).toBe(true);
  });

  it('stops the old mount loop before constructing a fresh Machine', () => {
    const h = harness();
    h.session.loadDemo(demo('DEMO-A'));
    const oldLoop = h.loops[0];
    oldLoop?.frame();
    expect(oldLoop?.machine.advanced).toBe(2);

    h.session.reset();
    expect(oldLoop?.disposed()).toBe(true);
    oldLoop?.frame();
    h.loops[1]?.frame();

    expect(oldLoop?.machine.advanced).toBe(2);
    expect(h.loops[1]?.machine.advanced).toBe(2);
    expect(h.events.slice(1, 4)).toEqual(['mount:m1', 'create:m2:MV601-REF-A', 'dispose:m1']);
  });

  it.each([0, 1, 2])('fails load when initial command %i is rejected and never mounts it', (rejectAt) => {
    const h = harness([rejectAt]);
    const candidate = demo(
      'BAD',
      { k: 'power', on: true },
      { k: 'button', n: 1, target: 1000 },
      { k: 'button', n: 1, target: 0 },
    );

    expect(() => h.session.loadDemo(candidate)).toThrow(
      'session: demo BAD command ' + rejectAt + ' rejected: hole_occupied',
    );
    expect(h.machines[0]?.applied).toHaveLength(rejectAt + 1);
    expect(h.loops).toEqual([]);
    expect(h.liveMounts()).toBe(0);
  });

  it('keeps the old session alive when a replacement rejects and can reset it', () => {
    const h = harness([null, 0, null]);
    const good = demo('GOOD', { k: 'power', on: true });
    h.session.loadDemo(good);
    const oldLoop = h.loops[0];

    expect(() => h.session.loadDemo(demo('BAD', { k: 'power', on: true }))).toThrow(/BAD command 0/);
    expect(oldLoop?.disposed()).toBe(false);
    oldLoop?.frame();
    expect(oldLoop?.machine.advanced).toBe(2);
    expect(h.liveMounts()).toBe(1);
    h.session.reset();

    expect(h.machines[2]?.applied).toEqual([good.commands[0]]);
    expect(h.liveMounts()).toBe(1);
  });

  it('remounts the prior Machine and retains its selection when replacement mounting fails', () => {
    const h = harness([], ['m2']);
    const good = demo('GOOD', { k: 'power', on: true });
    h.session.loadDemo(good);
    const originalLoop = h.loops[0];

    expect(() => h.session.loadDemo(demo('BAD'))).toThrow('test mount failed: m2');
    expect(originalLoop?.disposed()).toBe(true);
    expect(h.liveMounts()).toBe(1);
    expect(h.loops[1]?.machine).toBe(h.machines[0]);
    expect(h.contexts).toEqual([
      { demoId: 'GOOD', profileId: 'MV601-REF-A' },
      { demoId: 'BAD', profileId: 'MV601-REF-A' },
      { demoId: 'GOOD', profileId: 'MV601-REF-A' },
    ]);

    h.session.reset();
    expect(h.machines[2]?.applied).toEqual([good.commands[0]]);
    expect(h.liveMounts()).toBe(1);
  });

  it('disposes idempotently and refuses all later mutation', () => {
    const h = harness();
    h.session.loadDemo(demo('DEMO-A'));

    h.session.dispose();
    h.session.dispose();

    expect(h.events).toEqual(['create:m1:MV601-REF-A', 'mount:m1', 'dispose:m1']);
    expect(h.liveMounts()).toBe(0);
    expect(() => h.session.reset()).toThrow('session: disposed');
    expect(() => h.session.switchProfile('MV601-IDEAL')).toThrow('session: disposed');
    expect(() => h.session.loadDemo(demo('DEMO-B'))).toThrow('session: disposed');
    expect(h.machines).toHaveLength(1);
  });
});
