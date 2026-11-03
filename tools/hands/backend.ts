/**
 * Where a `minivac-control` session lives. A backend does the work a parsed call asks for and
 * answers in data, never text; `render.ts` writes the text, so any backend's answers read exactly
 * like the CLI's. `fileBackend` is the session file. The chat pane's backend will be the page's
 * live machine (docs/plans/stage-3-chat-pane.md).
 */
import { existsSync } from 'node:fs';
import { replay, runBatch, sessionOf, stateView } from '../../src/hands/table.ts';
import type { BatchOutcome, Rig, Session, StateView, ToolCall } from '../../src/hands/table.ts';
import { createSessionFile, loadRepoNetlist, loadRepoProfile, readSession, withSessionLock, writeSessionFile } from './session-file.ts';

/** `new`: the session was started, or one was already there and nothing changed. */
export type CreateReply = 'created' | 'exists';

/** `state`: the machine's state, or no session to read. */
export type StateReply = StateView | 'missing';

/**
 * A batch: on success the outcome and the state after it settled; a refusal, which changed
 * nothing; or no session to run it on.
 */
export type BatchReply =
  | (Extract<BatchOutcome, { ok: true }> & { view: StateView })
  | Extract<BatchOutcome, { ok: false }>
  | 'missing';

export interface SessionBackend {
  /** Start `session` at `path`, unless a session is already there. */
  create(path: string, session: Session): CreateReply;
  state(path: string): StateReply;
  /** Apply `calls` in order, then one settle capped at `settleMs`. A refused batch changes nothing. */
  run(path: string, calls: readonly ToolCall[], settleMs: number): BatchReply;
}

function loadRig(path: string): { rig: Rig; base: Session } {
  const base = readSession(path);
  const rig = replay(loadRepoNetlist(), loadRepoProfile(base.profile), base);
  return { rig, base };
}

/**
 * The session file: every call rebuilds the machine by replaying the file from scratch. `new` and
 * a batch hold `<session>.lock` from read to write; a batch rewrites the file atomically, and only
 * when it was not refused. Lock, replay and I/O failures throw (SessionError for the expected ones).
 */
export const fileBackend: SessionBackend = {
  create(path, session) {
    return withSessionLock(path, () => createSessionFile(path, session) ? 'created' : 'exists');
  },
  state(path) {
    if (!existsSync(path)) return 'missing';
    return stateView(loadRig(path).rig);
  },
  run(path, calls, settleMs) {
    return withSessionLock(path, () => {
      if (!existsSync(path)) return 'missing';
      const { rig, base } = loadRig(path);
      const outcome = runBatch(rig, calls, settleMs);
      if (!outcome.ok) return outcome;
      writeSessionFile(path, sessionOf(rig, base));
      return { ...outcome, view: stateView(rig) };
    });
  },
};
