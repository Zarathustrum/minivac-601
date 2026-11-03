/**
 * `minivac-control`: the first adapter over the hands tool table (`src/hands/table.ts`).
 *
 * A call is three pieces: `parseInvocation` reads the words (`invocation.ts`), a backend does the
 * work and answers in data (`backend.ts`), and the renderer writes the text (`render.ts`). `run`
 * puts them together over the session file: every call rebuilds the machine by replaying the file
 * from scratch, applies one batch of commands atomically, settles once, and rewrites the file. It
 * returns the output instead of printing so the CLI is testable in-process; `bin/minivac-control`
 * prints it.
 */
import { fileBackend } from './backend.ts';
import type { SessionBackend } from './backend.ts';
import { parseInvocation } from './invocation.ts';
import type { InvocationOptions } from './invocation.ts';
import { error, renderBatch, renderLocal, renderNew, renderState } from './render.ts';
import type { CliResult } from './render.ts';

export type { CliResult } from './render.ts';

/** One call on any backend. Every failure, expected or not, comes back as an error result. */
export function runWith(argv: readonly string[], backend: SessionBackend, options: InvocationOptions): CliResult {
  try {
    const invocation = parseInvocation(argv, options);
    switch (invocation.kind) {
      case 'new':
        return renderNew(invocation, backend.create(invocation.path, invocation.session));
      case 'state':
        return renderState(invocation, backend.state(invocation.path));
      case 'batch':
        return renderBatch(invocation, backend.run(invocation.path, invocation.calls, invocation.settleMs));
      default:
        return renderLocal(invocation);
    }
  } catch (problem: unknown) {
    return error(problem instanceof Error ? problem.message : String(problem));
  }
}

/**
 * The CLI: the session file, pinned by MINIVAC_CONTROL_SESSION when a harness that runs a model
 * sets it, so the model can create and use only that one file.
 */
export function run(argv: readonly string[]): CliResult {
  return runWith(argv, fileBackend, { pinned: process.env.MINIVAC_CONTROL_SESSION });
}
