/**
 * The chat pane's wire protocol (docs/plans/stage-3-chat-pane.md, step 8): JSON text frames over
 * one WebSocket between the dev page (`src/pane/`) and the local pane server
 * (`tools/hands-pane/server.ts`) on 127.0.0.1. Both sides import these types, so they cannot
 * drift; the module is types and constants only, safe in the browser bundle and in Node.
 *
 * The page opens the socket and sends `hello` with the per-launch token from its URL. After
 * `ready`, the page sends the user's messages; the server runs the model and, for each
 * `minivac_control` call, parses the words itself and sends the page a `request` for its engine
 * (`src/pane/engine.ts`), which the page answers with a `reply` carrying the engine's data. The
 * server writes the text the model sees with the CLI's own renderer. The key and the gateway's
 * base URL never cross this socket.
 */
import type { Session, ToolCall } from '../hands/table.ts';
import type { BatchReply, CreateReply, StateReply } from './engine.ts';

/** Bumped on any change below; a page from another build is refused at `hello`. */
export const PANE_PROTOCOL = 3;

/** The server's port when the page URL names none (`#t=<token>&port=<n>`). */
export const DEFAULT_PANE_PORT = 8601;

/** Close codes the server uses on refusal (4000-4999 are the application's). */
export const CLOSE_BAD_TOKEN = 4001;
export const CLOSE_BAD_PROTOCOL = 4002;
export const CLOSE_NO_HELLO = 4003;

/** What the server asks the page's engine to do; each maps to one `PaneEngine` method. */
export type PaneRequest =
  | { op: 'create'; session: Session }
  | { op: 'run'; calls: ToolCall[]; settleMs: number }
  | { op: 'state' }
  | { op: 'session' };

/** The engine's answer to each request, exactly as `PaneEngine` returns it. */
export interface PaneReplies {
  create: CreateReply;
  run: BatchReply;
  state: StateReply;
  session: Session | 'missing';
}

export type PaneReply = PaneReplies[keyof PaneReplies];

/** Page to server. */
export type PageMessage =
  | { type: 'hello'; protocol: number; token: string }
  /** One user message, run on `route`; the first of a pane session starts its run directory. */
  | { type: 'user'; text: string; route: string }
  /** Stop the running user turn: a call already running finishes, the rest are answered as not run. */
  | { type: 'stop' }
  /** End the pane session (stopping any turn first); the server answers `ended`. */
  | { type: 'end' }
  | { type: 'reply'; id: number; reply: PaneReply };

/** One tool call the model made in a reply, with the output it was given. */
export interface TurnCall {
  name: string;
  /** The call's JSON arguments, as the model sent them. */
  args: string;
  output: string;
}

/** Who answered one model request, sent as soon as the response is in: before any of its calls run. */
export interface ServedEvent {
  type: 'served';
  /** Requests so far in this user turn, from 1. */
  turn: number;
  status: number;
  /** The server that answered (x-litellm-model-api-base), '?' when the gateway did not say. */
  servedBy: string;
  /** Fallbacks the gateway tried before this answer. */
  fallbacks: number;
  costUsd: number;
  /** The route has an expected primary server, and this reply came from another one. */
  offPrimary: boolean;
}

/** One model reply, once its calls have run: who served it, what it said, and the calls it made. */
export interface TurnEvent extends Omit<ServedEvent, 'type'> {
  type: 'turn';
  /** Set when this request ended the turn: http_<status> or wrong_api_base. */
  stop?: string;
  /** A failed request's HTTP reason, fixed text: the gateway's reply stays in the run's transcript. */
  reason?: string;
  content: string | null;
  calls: TurnCall[];
}

/** Server to page. */
export type ServerMessage =
  | { type: 'ready'; routes: string[]; maxUserChars: number }
  /** A pane session started: `run` is its directory in the server's run folder. Start a fresh engine. */
  | { type: 'started'; run: string }
  | ({ type: 'request'; id: number } & PaneRequest)
  /** A request to the model on `route` is out, numbered as ServedEvent.turn: the model is working until its `served`. */
  | { type: 'requesting'; turn: number; route: string }
  | ServedEvent
  | TurnEvent
  /**
   * The answer to every `user` message: how its turn ended (`done`, `aborted`, `max_turns`,
   * `http_<status>`, `wrong_api_base`, `error`), with the model's final text or the error with
   * anything key-like taken out; or `refused`, with why, when no turn ran.
   */
  | { type: 'done'; stop: string; text: string }
  /**
   * The pane session ended, on `end` or because the page's engine failed (`error` says how).
   * Sent even when no session was live, so the page can always hand the machine back.
   */
  | { type: 'ended'; run: string | null; error?: string }
  /** A page frame the server could not take (not a pane message, or a turn already running). */
  | { type: 'error'; message: string };
