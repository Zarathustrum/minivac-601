import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import profileDocument from '../data/profiles/MV601-REF-A.json';
import type { Command, Event as CoreEvent, HoleId, Machine, Note, State } from '../src/core/contract.ts';
import { createMachine } from '../src/core/machine.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import { loadProfile } from '../src/core/profile.ts';
import { PANEL_HOLES } from '../src/ui/panel-layout.ts';
import type { PeriodPanelControls } from '../src/ui/panel-view.ts';
import {
  bindHoleControls,
  bindPanelCommandControls,
  breakerResetCommand,
  buttonMomentaryCommand,
  commandTraceTick,
  dialGrabCommand,
  dialReleaseCommand,
  dialTargetUdeg,
  panelSection,
  powerToggleCommand,
  projectPanelState,
  relayGrabCommand,
  relayReleaseCommand,
  renderNote,
  switchToggleCommand,
} from '../src/ui/inspector.ts';
import { createTraceView } from '../src/ui/trace-view.ts';

const netlist = loadNetlist(new Uint8Array(readFileSync(new URL('../data/netlist.json', import.meta.url))));
const profile = loadProfile(profileDocument);

class FakeControl extends EventTarget {
  readonly dataset: Record<string, string> = {};
  value = '0';
  pointerCapture: number | null = null;

  setPointerCapture(pointerId: number): void {
    this.pointerCapture = pointerId;
  }

  getBoundingClientRect(): DOMRect {
    return { left: 100, top: 200, width: 80, height: 80 } as DOMRect;
  }
}

function fakeEvent(type: string, values: Record<string, unknown> = {}): Event {
  return Object.assign(new Event(type), values);
}

function fakeControls(): PeriodPanelControls {
  const sections = (): FakeControl[] => Array.from({ length: 6 }, (_, index) => {
    const control = new FakeControl();
    control.dataset.section = String(index + 1);
    return control;
  });
  return {
    power: new FakeControl() as unknown as HTMLButtonElement,
    breaker: new FakeControl() as unknown as HTMLButtonElement,
    pushbuttons: sections() as unknown as HTMLButtonElement[],
    switches: sections() as unknown as HTMLButtonElement[],
    relays: sections() as unknown as HTMLInputElement[],
    dial: new FakeControl() as unknown as HTMLInputElement,
  };
}

function connect(machine: Machine, cord: number, a: string, b: string): void {
  expect(machine.apply({
    k: 'connect',
    cord,
    a: { k: 'hole', hole: a as HoleId },
    b: { k: 'hole', hole: b as HoleId },
  })).toEqual({ ok: true });
}

describe('inspector projections', () => {
  it('stamps an effective power rise at its reset epoch and other commands at acceptance', () => {
    expect(commandTraceTick(
      { tick: 950_999, power: false },
      { k: 'power', on: true },
    )).toBe(0);
    expect(commandTraceTick(
      { tick: 950_999, power: true },
      { k: 'power', on: true },
    )).toBe(950_999);
    expect(commandTraceTick(
      { tick: 77, power: false },
      { k: 'button', n: 1, target: 1000 },
    )).toBe(77);
  });

  it('derives exact commands from explicit panel identities and state', () => {
    expect(panelSection('4')).toBe(4);
    expect(() => panelSection(undefined)).toThrow('invalid panel control section');
    expect(() => panelSection('7')).toThrow('invalid panel control section');
    expect(powerToggleCommand(false)).toEqual({ k: 'power', on: true });
    expect(powerToggleCommand(true)).toEqual({ k: 'power', on: false });
    expect(breakerResetCommand()).toEqual({ k: 'breaker', reset: true });
    expect(buttonMomentaryCommand(2, true)).toEqual({ k: 'button', n: 2, target: 1000 });
    expect(buttonMomentaryCommand(2, false)).toEqual({ k: 'button', n: 2, target: 0 });
    expect(switchToggleCommand(3, 0)).toEqual({ k: 'switch', n: 3, target: 1000 });
    expect(switchToggleCommand(3, 1000)).toEqual({ k: 'switch', n: 3, target: 0 });
    expect(switchToggleCommand(3, 499)).toEqual({ k: 'switch', n: 3, target: 1000 });
    expect(switchToggleCommand(3, 500)).toEqual({ k: 'switch', n: 3, target: 0 });
    expect(relayGrabCommand(5, 617)).toEqual({ k: 'relayGrab', n: 5, target: 617 });
    expect(relayReleaseCommand(5)).toEqual({ k: 'relayRelease', n: 5 });
    expect(dialGrabCommand(123_456_789)).toEqual({ k: 'dialGrab', targetUdeg: 123_456_789 });
    expect(dialReleaseCommand()).toEqual({ k: 'dialRelease' });
  });

  it('binds every mounted panel section to its exact command identity', () => {
    const controls = fakeControls();
    const view = new EventTarget();
    const state = {
      power: false,
      switches: Array.from({ length: 6 }, (_, index) => ({ travel: index % 2 === 0 ? 0 : 1000 })),
    } as unknown as State;
    const apply = vi.fn((command: Command) => {
      if (command.k === 'power') state.power = command.on;
      if (command.k === 'switch') state.switches[command.n - 1]!.travel = command.target;
      return true;
    });
    const bindings = bindPanelCommandControls(
      view as unknown as Window,
      controls,
      () => state,
      apply,
    );

    controls.power.dispatchEvent(new Event('click'));
    controls.breaker.dispatchEvent(new Event('click'));
    expect(apply.mock.calls.slice(0, 2).map(([command]) => command)).toEqual([
      { k: 'power', on: true },
      { k: 'breaker', reset: true },
    ]);
    controls.power.dispatchEvent(new Event('click'));
    controls.power.dispatchEvent(new Event('click'));
    expect(apply.mock.calls.slice(-2).map(([command]) => command)).toEqual([
      { k: 'power', on: false },
      { k: 'power', on: true },
    ]);

    for (let index = 0; index < 6; index++) {
      const n = index + 1;
      const button = controls.pushbuttons[index]!;
      button.dispatchEvent(fakeEvent('pointerdown'));
      view.dispatchEvent(fakeEvent('pointercancel'));
      expect(apply.mock.calls.slice(-2).map(([command]) => command)).toEqual([
        { k: 'button', n, target: 1000 },
        { k: 'button', n, target: 0 },
      ]);

      controls.switches[index]!.dispatchEvent(new Event('click'));
      expect(apply).toHaveBeenLastCalledWith({
        k: 'switch',
        n,
        target: index % 2 === 0 ? 1000 : 0,
      });

      const relay = controls.relays[index]!;
      relay.value = String(n * 137);
      relay.dispatchEvent(fakeEvent('pointerdown'));
      view.dispatchEvent(fakeEvent('pointercancel'));
      expect(apply.mock.calls.slice(-2).map(([command]) => command)).toEqual([
        { k: 'relayGrab', n, target: n * 137 },
        { k: 'relayRelease', n },
      ]);
    }

    controls.dial.dispatchEvent(fakeEvent('pointerdown', {
      pointerId: 23,
      clientX: 180,
      clientY: 240,
    }));
    expect((controls.dial as unknown as FakeControl).pointerCapture).toBe(23);
    view.dispatchEvent(fakeEvent('pointercancel'));
    expect(apply.mock.calls.slice(-2).map(([command]) => command)).toEqual([
      { k: 'dialGrab', targetUdeg: 90_000_000 },
      { k: 'dialRelease' },
    ]);

    controls.dial.value = '22500000';
    controls.dial.dispatchEvent(new Event('input'));
    expect(apply.mock.calls.slice(-2).map(([command]) => command)).toEqual([
      { k: 'dialGrab', targetUdeg: 22_500_000 },
      { k: 'dialRelease' },
    ]);

    bindings.dispose();
    apply.mockClear();
    controls.power.dispatchEvent(new Event('click'));
    expect(apply).not.toHaveBeenCalled();
  });

  it('releases only the control the lifted pointer was holding', () => {
    const controls = fakeControls();
    const view = new EventTarget();
    const state = { power: false, switches: [] } as unknown as State;
    const applied: Command[] = [];
    const apply = vi.fn((command: Command) => {
      applied.push(command);
      return true;
    });
    const bindings = bindPanelCommandControls(
      view as unknown as Window,
      controls,
      () => state,
      apply,
    );
    const press = (control: EventTarget, pointerId: number): void => {
      control.dispatchEvent(fakeEvent('pointerdown', { pointerId, button: 0 }));
      view.dispatchEvent(fakeEvent('pointerdown', { pointerId, button: 0 }));
    };

    press(controls.pushbuttons[0]!, 11);
    press(controls.pushbuttons[1]!, 12);
    expect([...bindings.buttonActive]).toEqual([1, 2]);

    applied.length = 0;
    view.dispatchEvent(fakeEvent('pointerup', { pointerId: 11 }));
    expect(applied).toEqual([{ k: 'button', n: 1, target: 0 }]);
    expect([...bindings.buttonActive]).toEqual([2]);

    applied.length = 0;
    view.dispatchEvent(fakeEvent('pointerup', { pointerId: 12 }));
    expect(applied).toEqual([{ k: 'button', n: 2, target: 0 }]);
    expect([...bindings.buttonActive]).toEqual([]);

    applied.length = 0;
    controls.pushbuttons[0]!.dispatchEvent(fakeEvent('pointerdown', { pointerId: 13, button: 2 }));
    controls.relays[0]!.dispatchEvent(fakeEvent('pointerdown', { pointerId: 13, button: 2 }));
    controls.dial.dispatchEvent(fakeEvent('pointerdown', { pointerId: 13, button: 2, clientX: 180, clientY: 240 }));
    expect(applied).toEqual([]);
    expect([...bindings.buttonActive]).toEqual([]);
    expect(bindings.dialIsActive()).toBe(false);
    bindings.dispose();
  });

  it('latches pushbuttons on shift-click until a click, Escape or disposal releases them', () => {
    const controls = fakeControls();
    const view = new EventTarget();
    const state = { power: false, switches: [] } as unknown as State;
    const applied: Command[] = [];
    const bindings = bindPanelCommandControls(
      view as unknown as Window,
      controls,
      () => state,
      (command) => { applied.push(command); return true; },
    );
    const click = (control: EventTarget, pointerId: number, shiftKey: boolean): void => {
      control.dispatchEvent(fakeEvent('pointerdown', { pointerId, button: 0, shiftKey }));
      view.dispatchEvent(fakeEvent('pointerdown', { pointerId, button: 0, shiftKey }));
      view.dispatchEvent(fakeEvent('pointerup', { pointerId }));
    };

    click(controls.pushbuttons[0]!, 21, true);
    click(controls.pushbuttons[1]!, 22, true);
    expect(applied).toEqual([{ k: 'button', n: 1, target: 1000 }, { k: 'button', n: 2, target: 1000 }]);
    expect([...bindings.buttonLatched]).toEqual([1, 2]);
    expect([...bindings.buttonActive]).toEqual([]);

    applied.length = 0;
    click(controls.pushbuttons[0]!, 23, false);
    expect(applied).toEqual([{ k: 'button', n: 1, target: 0 }]);
    expect([...bindings.buttonLatched]).toEqual([2]);

    applied.length = 0;
    click(controls.pushbuttons[0]!, 24, true);
    view.dispatchEvent(fakeEvent('keydown', { key: 'Escape' }));
    expect(applied).toEqual([
      { k: 'button', n: 1, target: 1000 },
      { k: 'button', n: 2, target: 0 },
      { k: 'button', n: 1, target: 0 },
    ]);
    expect([...bindings.buttonLatched]).toEqual([]);

    applied.length = 0;
    click(controls.pushbuttons[2]!, 25, true);
    bindings.dispose();
    expect(applied).toEqual([{ k: 'button', n: 3, target: 1000 }, { k: 'button', n: 3, target: 0 }]);
    expect([...bindings.buttonLatched]).toEqual([]);
  });

  it('sends one press and one release while latch, keyboard and pointer overlap', () => {
    const controls = fakeControls();
    const view = new EventTarget();
    const state = { power: false, switches: [] } as unknown as State;
    const applied: Command[] = [];
    const bindings = bindPanelCommandControls(
      view as unknown as Window,
      controls,
      () => state,
      (command) => { applied.push(command); return true; },
    );
    const button = controls.pushbuttons[0]!;
    const key = (type: string, values: Record<string, unknown>): void => {
      button.dispatchEvent(fakeEvent(type, { repeat: false, shiftKey: false, ...values }));
    };

    button.dispatchEvent(fakeEvent('pointerdown', { pointerId: 31, button: 0 }));
    view.dispatchEvent(fakeEvent('pointerdown', { pointerId: 31, button: 0 }));
    key('keydown', { key: ' ' });
    key('keydown', { key: ' ', shiftKey: true });
    view.dispatchEvent(fakeEvent('pointerup', { pointerId: 31 }));
    key('keyup', { key: ' ' });
    expect(applied).toEqual([{ k: 'button', n: 1, target: 1000 }]);
    expect([...bindings.buttonLatched]).toEqual([1]);

    view.dispatchEvent(fakeEvent('keydown', { key: 'Escape' }));
    expect(applied).toEqual([{ k: 'button', n: 1, target: 1000 }, { k: 'button', n: 1, target: 0 }]);
    bindings.dispose();
    expect(applied).toHaveLength(2);
  });

  it('binds all 392 mounted holes to their exact frozen HoleIds', () => {
    const holes = new Map(PANEL_HOLES.map((hole) => [
      hole.id,
      new FakeControl() as unknown as HTMLButtonElement,
    ]));
    const apply = vi.fn();
    const dispose = bindHoleControls(holes, apply);

    for (const button of holes.values()) button.dispatchEvent(new Event('click'));
    expect(apply.mock.calls.map(([hole]) => hole)).toEqual(PANEL_HOLES.map((hole) => hole.id));

    dispose();
    apply.mockClear();
    for (const button of holes.values()) button.dispatchEvent(new Event('click'));
    expect(apply).not.toHaveBeenCalled();
  });

  it('maps round-dial pointer geometry clockwise from twelve o clock', () => {
    const bounds = { left: 100, top: 200, width: 80, height: 80 };
    expect(dialTargetUdeg(140, 200, bounds)).toBe(0);
    expect(dialTargetUdeg(180, 240, bounds)).toBe(90_000_000);
    expect(dialTargetUdeg(140, 280, bounds)).toBe(180_000_000);
    expect(dialTargetUdeg(100, 240, bounds)).toBe(270_000_000);
  });

  it('projects all panel state without electrical or DOM inference', () => {
    const state = createMachine(netlist, profile).snapshot();
    state.power = true;
    state.breakerTripped = true;
    state.railMv = 1;
    state.outLamps[0] = { ua: 123, milli: 456, cls: 'dim' };
    state.indLamps[0] = { ua: 789, milli: 1000, cls: 'on' };
    state.relays[0] = {
      ...state.relays[0]!,
      travel: 617,
      held: true,
      band: 'hold',
      coilUa: 33_839,
      dropOutUa: 14_787,
      pullInUa: 41_453,
    };
    state.buttons[0] = { travel: 1000, nc: false, no: true };
    state.switches[0] = { travel: 1000, set1: [false, true], set2: [false, true] };
    state.dial = { udeg: 123_456_789, contact: 5, mrpm: 0, held: true };

    const projected = projectPanelState(state);
    expect(projected).toMatchObject({
      powerPressed: true,
      breakerCanReset: true,
      powerJewelLit: true,
      dialUdeg: 123_456_789,
      dialLabel: '123456789 µdeg · D5 · held',
    });
    expect(projected.outLamps[0]).toEqual({
      cls: 'dim', ua: 123, milli: 456, label: 'dim · 123 µA',
    });
    expect(projected.relayLamps[0]).toEqual({
      cls: 'on', ua: 789, milli: 1000, label: 'on · 789 µA',
    });
    expect(projected.relays[0]).toEqual({
      travel: 617,
      held: true,
      band: 'hold',
      label: '33839 µA · hold · drop 14787 / pull 41453 µA',
    });
    expect(projected.buttonsPressed).toEqual([true, false, false, false, false, false]);
    expect(projected.switchesRight).toEqual([true, false, false, false, false, false]);
    expect(projected.switchTravel).toEqual([1000, 0, 0, 0, 0, 0]);
    expect(projected.outLamps).toHaveLength(6);
    expect(projected.relayLamps).toHaveLength(6);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(Object.isFrozen(projected.relays)).toBe(true);

    state.railMv = 0;
    expect(projectPanelState(state).powerJewelLit).toBe(false);
  });

  it('renders both frozen steady-note kinds without changing their data', () => {
    const notes: Note[] = [
      {
        k: 'coil-starved',
        relay: 3,
        coilUa: 40_000,
        needsUa: 43_333,
        drops: [{ el: 'ind3', mv: 4100 }, { el: 'cord:7', mv: 1200 }],
      },
      { k: 'lamp-in-coil-path', relay: 1, lampMv: 6000 },
    ];
    expect(notes.map(renderNote)).toEqual([
      'Relay 3 needs 43333 µA and has 40000 µA. Largest drops: ind3 4100 mV; cord:7 1200 mV.',
      "Relay 1's indicator lamp is in series with its coil and drops 6000 mV.",
    ]);
  });

  it('uses the verified three-cord preheat recipe to produce both notes', () => {
    const direct = createMachine(netlist, profile);
    connect(direct, 0, '1+#1', '1C#1');
    connect(direct, 1, '1F#1', '1-#1');
    expect(direct.apply({ k: 'power', on: true })).toEqual({ ok: true });
    direct.advance(2000);
    expect(direct.snapshot().relays[0]!.coilUa)
      .toBeGreaterThan(Math.max(...profile.derived.relayPullInUa));

    const machine = createMachine(netlist, profile);
    connect(machine, 0, '1+#1', '1A#1');
    connect(machine, 1, '1B#1', '1C#1');
    connect(machine, 2, '1E#1', '1-#1');
    expect(machine.apply({ k: 'power', on: true })).toEqual({ ok: true });
    machine.advance(2000);
    const preheated = machine.snapshot();
    expect(preheated.relays[0]?.coilUa).toBe(0);
    expect(preheated.outLamps[0]?.cls).toBe('on');
    expect(preheated.indLamps[0]?.cls).toBe('on');

    expect(machine.apply({ k: 'disconnect', cord: 2 })).toEqual({ ok: true });
    connect(machine, 2, '1F#1', '1-#1');
    machine.advance(2000);
    const state = machine.snapshot();

    expect(state.relays[0]).toMatchObject({
      travel: 0,
      held: false,
      coilUa: 33_839,
      coilMv: 5076,
      dropOutUa: 14_787,
      pullInUa: 41_453,
      band: 'hold',
    });
    expect(state.outLamps[0]).toMatchObject({ cls: 'on', milli: 695 });
    expect(state.indLamps[0]).toMatchObject({ cls: 'on', milli: 695 });
    expect(state.notes).toEqual([
      {
        k: 'coil-starved',
        relay: 1,
        coilUa: 33_839,
        needsUa: 41_453,
        drops: [{ el: 'out1', mv: 3951 }, { el: 'ind1', mv: 3951 }],
      },
      { k: 'lamp-in-coil-path', relay: 1, lampMv: 3951 },
    ]);
    expect(state.flags).toEqual({ chattering: [], overCurrent: false, nonPortable: false });
  });

  it('records why the former MM-RLY-CHECK rewire cannot trigger a note', () => {
    const machine = createMachine(netlist, profile);
    const wires = [
      ['1+#1', '1H#1'], ['1+#2', '1L#1'], ['2+#1', '1Y#1'], ['1X#1', '1E#1'],
      ['1F#1', '1-#1'], ['1J#1', '1A#1'], ['1B#1', '1-#2'], ['1G#1', '2A#1'],
      ['2B#1', '2-#1'], ['1N#1', '3A#1'], ['3B#1', '3-#1'], ['1K#1', '4A#1'],
      ['4B#1', '4-#1'],
    ] as const;
    for (let i = 0; i < wires.length; i++) {
      const [a, b] = wires[i] as (typeof wires)[number];
      connect(machine, i, a, b);
    }
    expect(machine.apply({ k: 'power', on: true })).toEqual({ ok: true });
    machine.advance(2000);
    expect(machine.apply({ k: 'button', n: 1, target: 1000 })).toEqual({ ok: true });
    machine.advance(2000);
    expect(machine.apply({ k: 'disconnect', cord: 3 })).toEqual({ ok: true });
    connect(machine, 3, '1X#1', '1C#1');
    machine.advance(2000);
    const state = machine.snapshot();

    expect(state.relays[0]).toMatchObject({
      travel: 1000,
      pullInUa: 41_453,
      band: 'above',
    });
    expect(state.relays[0]!.coilUa).toBeGreaterThan(state.relays[0]!.pullInUa);
    expect(state.notes).toEqual([]);
  });

  it('uses core trace formatting for commands, transitions and chatter', () => {
    const target = { textContent: '' } as HTMLElement;
    const before = new Int32Array(33);
    before[20] = -1;
    const trace = createTraceView(target, before);
    trace.command(0, { k: 'power', on: true });
    const after = before.slice();
    after[0] = 1;
    const chatter: CoreEvent = {
      t: 1,
      k: 'chatter',
      dev: 'relay1',
      transitions: 9,
      windowTicks: 800,
      quietTicks: 2400,
    };
    trace.frame(1, after, [chatter]);
    trace.flush();
    expect(target.textContent).toBe(
      '     0.0 > power on\n' +
      '     0.1 * power off->on\n' +
      '     0.1 ! relay1 chatter 9 transitions in 80.0ms — suppressed 240.0ms\n',
    );
  });
});
