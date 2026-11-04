/**
 * The page's half of the chat pane (docs/plans/stage-3-chat-pane.md, step 4): the one live
 * machine the model operates, answering in data. Node parses the model's words
 * (`tools/hands/invocation.ts`) and writes the text (`tools/hands/render.ts`); for each request
 * Node sends, the page runs this engine on its Rig and sends the reply back over the WebSocket.
 *
 * The replies mirror `SessionBackend`'s in `tools/hands/backend.ts`, plus an `EngineError` for what
 * the session file would have thrown, so Node renders them exactly as it renders the file
 * backend's. Every reply is plain JSON. A batch is validated before it runs, so a refused batch
 * leaves the live rig untouched without rebuilding anything.
 *
 * DOM-free and filesystem-free: it imports only the hands table and the core, and takes the
 * page's bundled netlist and profiles as arguments.
 */
import type { Machine } from '../core/contract.ts';
import type { LoadedNetlist } from '../core/netlist.ts';
import type { Profile } from '../core/profile.ts';
import { replay, runBatch, sessionOf, stateView, validateBatch } from '../hands/table.ts';
import type { BatchOutcome, BatchRejection, Rig, Session, StateView, ToolCall } from '../hands/table.ts';

/** A request the engine could not carry out; Node reports `error` as minivac-control's error text. */
export interface EngineError { error: string }

/** `new`: the session is live, a session was already live and nothing changed, or it was refused. */
export type CreateReply = 'created' | 'exists' | EngineError;

/** `state`: the live machine's state, or no live session. */
export type StateReply = StateView | 'missing';

/**
 * A batch: the outcome and the state after it settled; a refusal, which changed nothing; no live
 * session; or an error. After a broken invariant the error also means the session has ended.
 */
export type BatchReply =
  | (Extract<BatchOutcome, { ok: true }> & { view: StateView })
  | BatchRejection
  | 'missing'
  | EngineError;

export interface PaneEngine {
  /** Replay `session` (built by Node with `newSession`) into the live rig, unless one is live. */
  create(session: Session): CreateReply;
  /** Validate `calls`, then apply them in order and settle once, capped at `settleMs`. */
  run(calls: readonly ToolCall[], settleMs: number): BatchReply;
  state(): StateReply;
  /** The live session's `minivac.session/1` log, for export. */
  session(): Session | 'missing';
  /**
   * The live rig's machine, for the page's inspector, or null with no live session. It is the
   * same object from one `create` to the next, so the page reads it after each reply.
   */
  machine(): Machine | null;
}

function message(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}

export function createPaneEngine(netlist: LoadedNetlist, profiles: readonly Profile[]): PaneEngine {
  let live: { rig: Rig; base: Session } | null = null;

  /** A broken invariant: drop the rig rather than keep driving a machine no log describes. */
  function end(why: string): EngineError {
    live = null;
    return { error: why + '; the pane session has ended (start a new one)' };
  }

  return {
    create(session) {
      if (live !== null) return 'exists';
      const profile = profiles.find((candidate) => candidate.id === session.profile);
      if (profile === undefined) {
        return { error: 'the page has no profile ' + JSON.stringify(session.profile) + ' (it has ' +
          profiles.map((candidate) => candidate.id).join(', ') + ')' };
      }
      try {
        // Replay checks the session's netlist and profile hashes against the page's own data.
        live = { rig: replay(netlist, profile, session), base: session };
      } catch (problem: unknown) {
        return { error: 'the page cannot start this session: ' + message(problem) };
      }
      return 'created';
    },

    run(calls, settleMs) {
      if (live === null) return 'missing';
      const { rig } = live;
      let verdict: { ok: true } | BatchRejection;
      try {
        verdict = validateBatch(rig, calls, settleMs);
      } catch (problem: unknown) {
        // validateBatch never touches the rig, so the session stands.
        return { error: 'the page could not check this batch: ' + message(problem) };
      }
      if (!verdict.ok) return verdict;
      let outcome: BatchOutcome;
      try {
        outcome = runBatch(rig, calls, settleMs);
      } catch (problem: unknown) {
        return end('the page machine failed a validated batch: ' + message(problem));
      }
      if (!outcome.ok) {
        const { failedAt, result } = outcome;
        const step = failedAt < calls.length ? 'command ' + (failedAt + 1) : 'the settle step';
        return end('the page machine refused ' + step + ' of a validated batch (' + result.why + ': ' + result.detail + ')');
      }
      return { ...outcome, view: stateView(rig) };
    },

    state() {
      return live === null ? 'missing' : stateView(live.rig);
    },

    session() {
      return live === null ? 'missing' : sessionOf(live.rig, live.base);
    },

    machine() {
      return live === null ? null : live.rig.machine;
    },
  };
}
