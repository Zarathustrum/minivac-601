import type { Event, Machine, State } from '../core/contract.ts';

export type FrameTarget = Pick<Machine, 'advance' | 'snapshot' | 'observables' | 'drainEvents'>;
export type TickSample = (
  boundaryTick: number,
  observables: ArrayLike<number>,
  events: readonly Event[],
) => void;
export type FrameRender = (state: State) => void;
export type Frame = (nowMs: number) => void;

const TICK_US = 100;
const MAX_CATCH_UP_US = 50_000;

/** The sole wall-time-to-tick conversion. Headless callers continue to use `advance(exactTicks)`. */
export function createFrameLoop(machine: FrameTarget, sample: TickSample, render: FrameRender): Frame {
  let lastMs: number | null = null;
  let carryUs = 0;
  let nextBoundaryTick = machine.snapshot().tick;
  return (nowMs: number): void => {
    if (lastMs === null) lastMs = nowMs;
    // A backwards clock (or a resumed tab reporting an earlier stamp) contributes no credit: a
    // negative delta would floor to a negative tick count and hand `carryUs` almost a full tick.
    const dtUs = Math.min(Math.max(nowMs - lastMs, 0) * 1000, MAX_CATCH_UP_US);
    const total = dtUs + carryUs;
    const ticks = Math.floor(total / TICK_US);
    carryUs = total - ticks * TICK_US;
    for (let i = 0; i < ticks; i++) {
      machine.advance(1);
      const events = machine.drainEvents();
      const boundaryTick = events.length === 0 ? nextBoundaryTick : (events[0] as Event).t;
      for (const event of events) {
        if (event.t !== boundaryTick) throw new Error('ui loop: one-tick drain had mixed timestamps');
      }
      sample(boundaryTick, machine.observables(), events);
      nextBoundaryTick = boundaryTick + 1;
    }
    render(machine.snapshot());
    lastMs = nowMs;
  };
}

/** Browser scheduling also lives here, keeping every other adapter module clock-free. */
export function startFrameLoop(frame: Frame): () => void {
  let cancelled = false;
  let pending: number | null = null;
  const next = (nowMs: number): void => {
    pending = null;
    if (cancelled) return;
    // A throw out of `frame` escapes the animation-frame callback, so stop the loop rather than
    // leaving it live-but-unscheduled; rethrowing keeps the failure visible to the host page.
    try {
      frame(nowMs);
    } catch (error) {
      cancelled = true;
      throw error;
    }
    if (!cancelled) pending = requestAnimationFrame(next);
  };
  pending = requestAnimationFrame(next);
  return (): void => {
    if (cancelled) return;
    cancelled = true;
    if (pending !== null) {
      cancelAnimationFrame(pending);
      pending = null;
    }
  };
}
