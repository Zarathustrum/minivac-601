import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Event, Machine, Sect, State } from '../src/core/contract.ts';
import { createMachine } from '../src/core/machine.ts';
import { createInspectorFrame } from '../src/ui/inspector.ts';
import { createFrameLoop, startFrameLoop } from '../src/ui/loop.ts';
import { createTraceView } from '../src/ui/trace-view.ts';
import { loadFixture } from './conformance/helpers.ts';

function wireFixture(machine: Machine, loaded: ReturnType<typeof loadFixture>): void {
  for (const cord of loaded.cords) {
    expect(machine.apply({
      k: 'connect',
      cord: cord.wireIndex,
      a: { k: 'hole', hole: cord.a.id },
      b: { k: 'hole', hole: cord.b.id },
    })).toEqual({ ok: true });
  }
}

describe('inspector frame accounting', () => {
  it('carries fractional microseconds and caps one frame of catch-up at 50 ms', () => {
    let advanced = 0;
    let drains = 0;
    const rendered: number[] = [];
    const machine = {
      advance(ticks: number): void { expect(ticks).toBe(1); advanced += ticks; },
      snapshot(): State { return { tick: advanced } as State; },
      observables(): Int32Array { return new Int32Array(33); },
      drainEvents(): Event[] { drains++; return []; },
    } as Pick<Machine, 'advance' | 'snapshot' | 'observables' | 'drainEvents'>;
    const frame = createFrameLoop(machine, () => undefined, (state) => rendered.push(state.tick));

    frame(0);
    frame(0.0625);
    frame(0.125);
    frame(100.125);
    frame(100.1875);
    frame(100.25);

    expect(rendered).toEqual([0, 0, 1, 501, 501, 502]);
    expect(drains).toBe(502);
  });

  it('ignores a backwards timestamp instead of crediting a near-full tick of carry', () => {
    let advanced = 0;
    const machine = {
      advance(ticks: number): void { advanced += ticks; },
      snapshot(): State { return { tick: advanced } as State; },
      observables(): Int32Array { return new Int32Array(33); },
      drainEvents(): Event[] { return []; },
    } as Pick<Machine, 'advance' | 'snapshot' | 'observables' | 'drainEvents'>;
    const frame = createFrameLoop(machine, () => undefined, () => undefined);

    frame(0);
    frame(-0.05);
    frame(0);

    expect(advanced).toBe(0);
  });

  it('matches exact-tick headless state and event order on wired MM-RLY-CHECK', () => {
    const loaded = loadFixture(new URL(
      './conformance/fixtures/A/MM-RLY-CHECK.fixture.json',
      import.meta.url,
    ).pathname);
    const loopMachine = loadedMachine(loaded);
    const headless = loadedMachine(loaded);
    const loopTicks: TickSample[] = [];
    const loopFrames: State[] = [];
    const frame = createFrameLoop(loopMachine, (tick, observables, events) => loopTicks.push({
      tick,
      observables: Array.from(observables),
      events: [...events],
    }), (state) => loopFrames.push(state));

    expect(loopMachine.apply({ k: 'power', on: true })).toEqual({ ok: true });
    expect(headless.apply({ k: 'power', on: true })).toEqual({ ok: true });
    frame(0);
    frame(50);
    frame(100);
    expect(loopTicks).toEqual(headlessTicks(headless, 1000));
    expect(loopFrames.at(-1)).toEqual(headless.snapshot());
    loopTicks.length = 0;
    loopFrames.length = 0;

    expect(loopMachine.apply({ k: 'button', n: 1, target: 1000 })).toEqual({ ok: true });
    expect(headless.apply({ k: 'button', n: 1, target: 1000 })).toEqual({ ok: true });
    frame(150);
    frame(200);
    expect(loopTicks).toEqual(headlessTicks(headless, 1000));
    expect(loopFrames.at(-1)).toEqual(headless.snapshot());
  });

  it('preserves every MM-RLY-CHECK transition and original tick inside a 50 ms frame', () => {
    const loaded = loadFixture(new URL(
      './conformance/fixtures/A/MM-RLY-CHECK.fixture.json',
      import.meta.url,
    ).pathname);
    const machine = loadedMachine(loaded);
    const target = { textContent: '' } as HTMLElement;
    const trace = createTraceView(target, machine.observables());
    const power = { k: 'power', on: true } as const;
    expect(machine.apply(power)).toEqual({ ok: true });
    trace.command(0, power);
    const frame = createFrameLoop(
      machine,
      (tick, observables, events) => trace.frame(tick, observables, events),
      () => trace.flush(),
    );

    frame(0);
    frame(50);

    expect(target.textContent).toBe(
      '     0.0 > power on\n' +
      '     0.0 * power off->on\n' +
      '     3.2 * outLamp1 off->dim  outLamp3 off->dim\n' +
      '    22.2 * outLamp1 dim->on  outLamp3 dim->on\n',
    );
  });

  it('samples all 500 capped ticks but commits the trace DOM once per frame', () => {
    let tick = 0;
    let samples = 0;
    let writes = 0;
    let text = '';
    const target = {
      get textContent(): string { return text; },
      set textContent(value: string) { writes++; text = value; },
      scrollTop: 0,
      scrollHeight: 0,
    } as HTMLElement;
    const observable = new Int32Array(33);
    observable[20] = -1;
    const machine = {
      advance(n: number): void { tick += n; },
      snapshot(): State { return { tick } as State; },
      observables(): Int32Array { return observable; },
      drainEvents(): Event[] { return []; },
    } as Pick<Machine, 'advance' | 'snapshot' | 'observables' | 'drainEvents'>;
    const trace = createTraceView(target, observable);
    const frame = createFrameLoop(machine, (boundaryTick, observables, events) => {
      samples++;
      trace.frame(boundaryTick, observables, events);
    }, () => trace.flush());

    frame(0);
    samples = 0;
    writes = 0;
    frame(50);

    expect(samples).toBe(500);
    expect(writes).toBe(1);
  });

  it('forwards every event in a 500-tick catch-up to both trace and audio before final-state render', () => {
    let tick = 0;
    const observable = new Int32Array(33);
    const machine = {
      advance(n: number): void { tick += n; },
      snapshot(): State {
        return {
          tick,
          dial: { udeg: 0, contact: null, mrpm: tick === 500 ? 45_000 : 0, held: false },
        } as State;
      },
      observables(): Int32Array { return observable; },
      drainEvents(): Event[] {
        return [{
          t: tick - 1,
          k: tick % 2 === 0 ? 'relay.pullIn' : 'relay.dropOut',
          n: (tick % 6 + 1) as Sect,
          coilUa: 40_000,
          marginUa: 1_000,
        }];
      },
    } as Pick<Machine, 'advance' | 'snapshot' | 'observables' | 'drainEvents'>;
    const traceFrames: { tick: number; events: readonly Event[] }[] = [];
    const audioSamples: Event[][] = [];
    const audioFrames: State[] = [];
    const renders: State[] = [];
    const frame = createInspectorFrame(
      machine,
      {
        frame(boundaryTick, _observables, events): void {
          traceFrames.push({ tick: boundaryTick, events: [...events] });
        },
        flush(): void {},
      },
      {
        sample(events): void { audioSamples.push([...events]); },
        frame(state): void { audioFrames.push(state as State); },
      },
      (state) => renders.push(state),
    );

    frame(0);
    traceFrames.length = 0;
    audioSamples.length = 0;
    audioFrames.length = 0;
    renders.length = 0;
    frame(50);

    expect(traceFrames).toHaveLength(500);
    expect(audioSamples).toHaveLength(500);
    expect(traceFrames.flatMap(({ events }) => events)).toEqual(audioSamples.flat());
    expect(traceFrames.map(({ tick: boundaryTick }) => boundaryTick))
      .toEqual(Array.from({ length: 500 }, (_, index) => index));
    expect(audioFrames.map((state) => state.dial.mrpm)).toEqual([45_000]);
    expect(renders.map((state) => state.tick)).toEqual([500]);
  });
});

describe('browser frame-loop ownership', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('cancels the pending animation frame once and does not advance afterward', () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback): number => {
      const id = callbacks.size + 1;
      callbacks.set(id, callback);
      return id;
    });
    const cancel = vi.fn((id: number): void => { callbacks.delete(id); });
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const frame = vi.fn();

    const dispose = startFrameLoop(frame);
    expect(request).toHaveBeenCalledTimes(1);
    dispose();
    dispose();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(1);
    expect(frame).not.toHaveBeenCalled();
  });

  it('ignores a stale callback after cancellation and never reschedules it', () => {
    let callback: FrameRequestCallback | undefined;
    const request = vi.fn((next: FrameRequestCallback): number => {
      callback = next;
      return 17;
    });
    const cancel = vi.fn();
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', cancel);
    const frame = vi.fn();

    const dispose = startFrameLoop(frame);
    const stale = callback;
    dispose();
    stale?.(123);

    expect(frame).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });
});

interface TickSample {
  readonly tick: number;
  readonly observables: readonly number[];
  readonly events: readonly Event[];
}

function headlessTicks(machine: Machine, count: number): TickSample[] {
  const samples: TickSample[] = [];
  let nextBoundaryTick = machine.snapshot().tick;
  for (let i = 0; i < count; i++) {
    machine.advance(1);
    const events = machine.drainEvents();
    const tick = events.length === 0 ? nextBoundaryTick : (events[0] as Event).t;
    samples.push({
      tick,
      observables: Array.from(machine.observables()),
      events,
    });
    nextBoundaryTick = tick + 1;
  }
  return samples;
}

function loadedMachine(loaded: ReturnType<typeof loadFixture>): Machine {
  const machine = createMachine(loaded.netlist, loaded.profile);
  wireFixture(machine, loaded);
  return machine;
}
