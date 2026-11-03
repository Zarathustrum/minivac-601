import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import profileDocument from '../data/profiles/MV601-REF-A.json';
import { startApp } from '../src/app.ts';
import type { HoleId, Machine } from '../src/core/contract.ts';
import { createMachine } from '../src/core/machine.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import { loadProfile } from '../src/core/profile.ts';
import { mountInspector, type InspectorNetlist } from '../src/ui/inspector.ts';
import { click, FakeDocument, type FakeElement, stubAnimationFrames } from './ui-fake-dom.ts';

const netlistText = readFileSync(new URL('../data/netlist.json', import.meta.url), 'utf8');
const netlist = loadNetlist(new TextEncoder().encode(netlistText));
const rawView = JSON.parse(netlistText) as InspectorNetlist;
const profile = loadProfile(profileDocument);

interface Counts {
  apply: number;
  advance: number;
  drainEvents: number;
}

/** Pass everything through, counting the three calls that change a machine. */
function counting(real: Machine): { machine: Machine; counts: Counts } {
  const counts = { apply: 0, advance: 0, drainEvents: 0 };
  return {
    counts,
    machine: {
      apply(command) { counts.apply++; return real.apply(command); },
      advance(ticks) { counts.advance++; real.advance(ticks); },
      snapshot: () => real.snapshot(),
      observables: () => real.observables(),
      motionMask: () => real.motionMask(),
      drainEvents() { counts.drainEvents++; return real.drainEvents(); },
    },
  };
}

/** Two cords, power on and pushbutton 1 held down by the caller, settled and drained. */
function wired(machine: Machine = createMachine(netlist, profile)): Machine {
  for (const [cord, a, b] of [[0, '1+#1', '1A#1'], [1, '1B#1', '1-#1']] as const) {
    expect(machine.apply({
      k: 'connect',
      cord,
      a: { k: 'hole', hole: a as HoleId },
      b: { k: 'hole', hole: b as HoleId },
    })).toEqual({ ok: true });
  }
  expect(machine.apply({ k: 'power', on: true })).toEqual({ ok: true });
  expect(machine.apply({ k: 'button', n: 1, target: 1000 })).toEqual({ ok: true });
  machine.advance(2000);
  machine.drainEvents();
  return machine;
}

function blank(): Machine {
  return createMachine(netlist, profile);
}

function mountPoint(): { document: FakeDocument; root: FakeElement } {
  const document = new FakeDocument();
  const root = document.createElement('div');
  root.id = 'app';
  document.body.append(root);
  return { document, root };
}

describe('a frozen, locked console', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    ['a blank machine, where an unlocked console plugs a free cord', blank],
    ['a wired machine whose button the caller holds down', () => wired()],
  ])('sends %s nothing across mount, frames and unmount', (_name, build) => {
    const frames = stubAnimationFrames();
    const { document, root } = mountPoint();
    const experience = document.createElement('section');
    const real = build();
    const before = real.snapshot();
    const { machine, counts } = counting(real);

    // startWithFreeCord is left at its default (on): the lock alone must keep the cord out.
    const unmount = mountInspector(root as unknown as HTMLElement, machine, rawView, {
      experience: experience as unknown as HTMLElement,
      frozen: true,
      locked: true,
    });
    for (const nowMs of [0, 16, 1000, 60_000]) frames.run(nowMs);
    expect(root.querySelector('.console-stage')?.inert).toBe(true);
    expect(root.querySelector('.cord-panel')?.inert).toBe(true);
    expect(experience.inert).toBe(true);
    expect(root.querySelectorAll('.cord-row')).toHaveLength(before.cords.length);
    expect(root.querySelector('.trace-text')?.textContent).toBe('');
    unmount();

    expect(counts).toEqual({ apply: 0, advance: 0, drainEvents: 0 });
    expect(real.snapshot()).toEqual(before);
    expect(frames.pending()).toBe(0);
    expect(root.children).toEqual([]);
  });

  it('throws instead of reaching the machine when input gets past the inert controls', () => {
    stubAnimationFrames();
    const { root } = mountPoint();
    const { machine, counts } = counting(wired());
    const unmount = mountInspector(root as unknown as HTMLElement, machine, rawView, {
      frozen: true,
      locked: true,
    });

    expect(() => click(root.querySelector('.power-switch')!))
      .toThrow('inspector: a locked console sends no commands');
    unmount();
    expect(counts.apply).toBe(0);
  });

  it('runs the same machine live and unlocked when remounted without the flags', () => {
    const frames = stubAnimationFrames();
    const { document, root } = mountPoint();
    const experience = document.createElement('section');
    const real = wired();
    const before = real.snapshot();
    const { machine, counts } = counting(real);
    const options = { experience: experience as unknown as HTMLElement, startWithFreeCord: false };

    mountInspector(root as unknown as HTMLElement, machine, rawView, {
      ...options,
      frozen: true,
      locked: true,
    })();
    const unmount = mountInspector(root as unknown as HTMLElement, machine, rawView, options);
    frames.run(0);
    frames.run(16);

    expect(root.querySelector('.console-stage')?.inert).toBe(false);
    expect(root.querySelector('.cord-panel')?.inert).toBe(false);
    expect(experience.inert).toBe(false);
    expect(counts.apply).toBe(0);
    expect(counts.advance).toBe(160);
    expect(real.snapshot().tick).toBe(before.tick + 160);
    expect(real.snapshot().cords).toEqual(before.cords);
    unmount();
  });
});

describe('startApp with an adopted machine', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('locks it, ignores the demo controls, remounts per adopt and hands it back live', () => {
    const frames = stubAnimationFrames();
    const { document, root } = mountPoint();
    vi.stubGlobal('document', document);
    vi.stubGlobal('window', document.defaultView);
    const app = startApp();
    frames.run(0);
    frames.run(16);

    const ideal = app.profiles.find((candidate) => candidate.id === 'MV601-IDEAL')!;
    const real = wired(createMachine(app.netlist, ideal));
    const before = real.snapshot();
    const { machine, counts } = counting(real);
    const stage = (): FakeElement | null => root.querySelector('.console-stage');
    const checkedProfile = (): string | undefined =>
      root.querySelectorAll('.demo-profile-choice').find((input) => input.checked)?.value;

    app.adopt(machine);
    const adoptedStage = stage();
    for (const nowMs of [32, 1000, 60_000]) frames.run(nowMs);
    expect(adoptedStage?.inert).toBe(true);
    expect(root.querySelector('.demo-experience')?.inert).toBe(true);
    expect(root.querySelectorAll('.cord-row')).toHaveLength(before.cords.length);
    expect(root.querySelector('.demo-manual')?.getAttribute('aria-pressed')).toBe('true');
    expect(checkedProfile()).toBe('MV601-IDEAL');

    // Input that gets past inert reaches the composition, which drops it: no remount, no machine.
    click(root.querySelector('.demo-load')!);
    click(root.querySelector('.demo-manual')!);
    click(root.querySelector('.demo-reset')!);
    const refA = root.querySelectorAll('.demo-profile-choice').find((input) => input.value === 'MV601-REF-A')!;
    refA.checked = true;
    refA.dispatchEvent(new Event('change'));
    expect(stage()).toBe(adoptedStage);
    expect(checkedProfile()).toBe('MV601-IDEAL');

    app.adopt(machine);
    expect(stage()).not.toBe(adoptedStage);
    frames.run(61_000);
    expect(counts).toEqual({ apply: 0, advance: 0, drainEvents: 0 });
    expect(real.snapshot()).toEqual(before);

    app.release();
    const released = stage();
    expect(released?.inert).toBe(false);
    expect(root.querySelector('.demo-experience')?.inert).toBe(false);
    app.release();
    expect(stage()).toBe(released);
    frames.run(70_000);
    frames.run(70_016);
    expect(counts.apply).toBe(0);
    expect(counts.advance).toBe(160);
    expect(real.snapshot().cords).toEqual(before.cords);

    // The controls are back: Reset starts a blank manual panel on the adopted profile.
    click(root.querySelector('.demo-reset')!);
    expect(stage()).not.toBe(released);
    expect(root.querySelectorAll('.cord-row')).toHaveLength(0);
    expect(checkedProfile()).toBe('MV601-IDEAL');
    frames.run(80_000);
    frames.run(80_016);
    expect(counts.advance).toBe(160);
  });
});
