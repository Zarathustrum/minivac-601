import type { Command, Event } from '../core/contract.ts';
import {
  formatAnomaly,
  formatCommand,
  formatTrace,
  formatTransitions,
} from '../core/trace.ts';

export interface TraceView {
  command(tick: number, command: Command): void;
  frame(tick: number, observables: ArrayLike<number>, events: readonly Event[]): void;
  flush(): void;
}

// Bound the retained history so a long run cannot grow memory or per-flush cost without limit.
const MAX_LINES = 2000;

/** Live display assembled exclusively from the core's frozen trace-format functions. */
export function createTraceView(element: HTMLElement, initial: ArrayLike<number>): TraceView {
  const lines: string[] = [];
  const previous = Int32Array.from(initial);
  let rendered = '';
  let pending = 0;

  function push(line: string): void {
    lines.push(line);
    pending++;
  }

  function flush(): void {
    if (pending > 0) {
      if (lines.length > MAX_LINES) {
        lines.splice(0, lines.length - MAX_LINES);
        rendered = formatTrace(lines);
      } else {
        rendered += formatTrace(lines.slice(lines.length - pending));
      }
      pending = 0;
    }
    element.textContent = rendered;
    element.scrollTop = element.scrollHeight;
  }

  return {
    command(tick, command): void {
      push(formatCommand(tick, command));
    },
    frame(tick, observables, events): void {
      const transition = formatTransitions(tick, previous, observables);
      if (transition !== null) push(transition);
      for (const event of events) {
        if (event.k === 'chatter') push(formatAnomaly(event.t, event));
      }
      for (let i = 0; i < previous.length; i++) previous[i] = observables[i] as number;
    },
    flush,
  };
}
