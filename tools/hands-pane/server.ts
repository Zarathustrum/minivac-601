// The chat pane's local server (docs/plans/stage-3-chat-pane.md, step 8): it holds the gateway key,
// runs the model loop (`runLoop`, tools/hands-api/openai-loop.ts), and drives the dev page's machine
// over a WebSocket on 127.0.0.1. Each minivac_control call is parsed here by the CLI's parser
// (tools/hands/invocation.ts), run on the page's engine (src/pane/engine.ts), which answers in data,
// and written up here by the CLI's renderer (tools/hands/render.ts), so the model reads exactly the
// text the checklist runs gave it. The protocol is src/pane/protocol.ts.
//
// Usage: npm run dev:pane (Vite on 127.0.0.1:5173 with a strict port, so the token never lands in
// another app's tab), then node tools/hands-pane/server.ts, then open the URL it prints. The guide is
// tools/hands-pane/README.md.
// Env: MINIVAC_LLM_BASE_URL (the endpoint's …/v1, http or https, no credentials in it) and
// MINIVAC_LLM_API_KEY, required; neither is sent to the page or printed, and error text for the
// page has anything key-like taken out. MINIVAC_PANE_ROUTES, required: the model names the page may
// pick, comma-separated, the default first. Optional: MINIVAC_PANE_RUNS, the run folder (absolute
// or relative to the repo, default pane-runs/); MINIVAC_PANE_PORT (default 8601);
// MINIVAC_PANE_ORIGINS, the exact page origins allowed, comma-separated (default the Vite dev
// origins); MINIVAC_PANE_PRIMARY, behind a LiteLLM proxy, a JSON object of route -> the
// x-litellm-model-api-base that route should be served by, so a reply from any other server is
// flagged on the page; MINIVAC_PANE_MAX_TURNS, requests per user message (default 40, as the
// checklist runs had); MINIVAC_SKILL_PATH as for openai-loop.ts.
//
// A pane session starts with its first user message and ends on End session, New session, or a
// failure of the page's engine. It writes <run folder>/<date>-pane-<n>/: transcript.jsonl and
// run.json in the shapes openai-loop.ts writes (run.json adds the prompts, `errors` with the prompt
// each happened on, and `invalid` when the page went away or the server was killed mid-session; its
// stop is `running` while a turn runs, `interrupted` when the server was killed during one), and
// session.json after `new` and after every successful call, which read_file gives for pane.json.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createServer, STATUS_CODES } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, relative, resolve } from 'node:path';
import { WebSocketServer } from 'ws';
import type { RawData, WebSocket } from 'ws';
import type { BatchReply as EngineBatchReply, EngineError } from '../../src/pane/engine.ts';
import {
  CLOSE_BAD_PROTOCOL, CLOSE_BAD_TOKEN, CLOSE_NO_HELLO, DEFAULT_PANE_PORT, PANE_PROTOCOL,
} from '../../src/pane/protocol.ts';
import type {
  PageMessage, PaneReplies, PaneReply, PaneRequest, ServedEvent, ServerMessage, TurnEvent,
} from '../../src/pane/protocol.ts';
import { LoopError, runLoop, skillText, SYSTEM_PREAMBLE, transcriptLine } from '../hands-api/openai-loop.ts';
import type { LoopResult, Message, ResponseInfo, TurnInfo } from '../hands-api/openai-loop.ts';
import { parseInvocation } from '../hands/invocation.ts';
import type { Invocation } from '../hands/invocation.ts';
import { error, renderBatch, renderLocal, renderNew, renderState } from '../hands/render.ts';
import type { CliResult } from '../hands/render.ts';
import { writeSessionFile } from '../hands/session-file.ts';

const REPO = resolve(new URL('../..', import.meta.url).pathname);

/** Vite's dev origins; the printed URL uses the first, which `npm run dev:pane` holds strictly. */
export const DEV_ORIGINS: readonly string[] = Object.freeze(['http://127.0.0.1:5173', 'http://localhost:5173']);
/** The one session path the model may name; the page's engine holds that session. */
export const PINNED = 'pane.json';
/** The checklist runs' first-turn prompt prefix, with the pane's session file. */
export const FIRST_TURN_PREFIX = 'You are operating the Minivac 601 simulator in this repository. Use the session file ' +
  PINNED + ' (create it).\n\n';
export const DEFAULT_MAX_TURNS = 40;
export const MAX_USER_CHARS = 8_000;
/** The largest frame either side may send: a session log or a `state --json` reply fits easily. */
const MAX_PAYLOAD = 4 * 1024 * 1024;
const HELLO_MS = 10_000;
const PAGE_GONE = 'the page disconnected';

export interface PaneServerOptions {
  base: string;
  key: string;
  /** 0 picks a free port. */
  port: number;
  /** The exact page origins allowed to connect. */
  origins: readonly string[];
  /** The model names the page may pick, the default first. */
  routes: readonly string[];
  /** Where each pane session's run directory goes. */
  runsRoot: string;
  /** Route -> the api base its replies should come from; a reply from another is flagged. */
  primary?: Readonly<Record<string, string>> | undefined;
  maxTurns?: number | undefined;
  /**
   * A reply another server than the route's primary served stops the turn before its calls run
   * (the checklist runs). Off, as in hands-on sessions, such a reply is only flagged.
   */
  requirePrimary?: boolean | undefined;
  log?: ((line: string) => void) | undefined;
}

export interface PaneServer {
  readonly port: number;
  readonly token: string;
  /** The page to open: dev.html on the first allowed origin, with the token and the port. */
  readonly url: string;
  close(): Promise<void>;
}

/** The page's engine, one request at a time over the socket. */
export interface PageLink {
  request<R extends PaneRequest>(request: R): Promise<PaneReplies[R['op']]>;
}

/** One minivac_control call on the page: the CLI's result, and what the server must act on. */
export interface PaneCall {
  result: CliResult;
  kind: Invocation['kind'];
  /** The page's engine answered with an error: a stale page build on `new`, a broken engine after. */
  engineError?: string;
}

class EngineFailure extends Error {}

/** The engine's data, with its `{ error }` turned into a throw, as the file backend would throw. */
function answer<T>(reply: T): Exclude<T, EngineError> {
  if (typeof reply === 'object' && reply !== null && 'error' in reply) {
    throw new EngineFailure(String((reply as EngineError).error));
  }
  return reply as Exclude<T, EngineError>;
}

function message(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}

/**
 * `runWith` (tools/hands/cli.ts) over the page instead of a SessionBackend: the same parse, the same
 * render, and the same catch-all, so every word gets the CLI's bytes. It is async only because the
 * page answers over the socket.
 */
export async function callOnPage(words: readonly string[], page: PageLink): Promise<PaneCall> {
  let kind: Invocation['kind'] = 'error';
  try {
    const invocation = parseInvocation(words, { pinned: PINNED });
    kind = invocation.kind;
    switch (invocation.kind) {
      case 'new':
        return { kind, result: renderNew(invocation, answer(await page.request({ op: 'create', session: invocation.session }))) };
      case 'state':
        return { kind, result: renderState(invocation, answer(await page.request({ op: 'state' }))) };
      case 'batch': {
        const reply: EngineBatchReply = await page.request({ op: 'run', calls: invocation.calls, settleMs: invocation.settleMs });
        return { kind, result: renderBatch(invocation, answer(reply)) };
      }
      default:
        return { kind, result: renderLocal(invocation) };
    }
  } catch (problem: unknown) {
    const text = message(problem);
    return { kind, result: error(text), ...(problem instanceof EngineFailure ? { engineError: text } : {}) };
  }
}

/** Compare the page's token with ours in constant time, whatever its length. */
function sameToken(given: string, token: string): boolean {
  const digest = (text: string): Buffer => createHash('sha256').update(text).digest();
  return timingSafeEqual(digest(given), digest(token));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A page frame, checked field by field; null for anything that is not a page message. */
function parsePageMessage(text: string): PageMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'hello':
      return typeof raw.protocol === 'number' && typeof raw.token === 'string' ?
        { type: 'hello', protocol: raw.protocol, token: raw.token } : null;
    case 'user':
      return typeof raw.text === 'string' && typeof raw.route === 'string' ?
        { type: 'user', text: raw.text, route: raw.route } : null;
    case 'stop':
    case 'end':
      return { type: raw.type };
    case 'reply':
      return Number.isSafeInteger(raw.id) && 'reply' in raw ?
        { type: 'reply', id: raw.id as number, reply: raw.reply as PaneReply } : null;
    default:
      return null;
  }
}

function localDate(now: Date): string {
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
}

/** The next free <date>-pane-<n> under `root`, created exclusively so two sessions never share one. */
function claimRunDir(root: string): { run: string; dir: string } {
  mkdirSync(root, { recursive: true });
  const date = localDate(new Date());
  for (let n = 1; ; n++) {
    const run = date + '-pane-' + n;
    const dir = join(root, run);
    try {
      mkdirSync(dir);
      return { run, dir };
    } catch (problem: unknown) {
      if ((problem as { code?: string }).code !== 'EEXIST') throw problem;
    }
  }
}

interface PaneSession {
  run: string;
  dir: string;
  /** The conversation, carried across user messages. */
  messages: Message[];
  prompts: { route: string; text: string }[];
  model: string;
  totals: Omit<LoopResult, 'stop' | 'finalText'>;
  stop: string;
  finalText: string;
  ms: number;
  /** A user turn that failed, by its place in `prompts` (from 1), and how. */
  errors: { prompt: number; error: string }[];
  /** Set once the run cannot be trusted: the page went away, its engine failed, or the server was killed. */
  invalid?: string;
  /** The page's engine failed: the session ends when the running turn does. */
  fatal?: string;
}

interface Conn {
  ws: WebSocket;
  authed: boolean;
  closed: boolean;
  nextId: number;
  pending: Map<number, { resolve: (reply: PaneReply) => void; reject: (problem: Error) => void }>;
  page: PageLink;
  session: PaneSession | null;
  /** The running user turn; it never rejects. */
  turn: Promise<void> | null;
  controller: AbortController | null;
  /** Settles once the close has been handled. */
  gone: Promise<void>;
  markGone: () => void;
}

function writeRun(session: PaneSession): void {
  const { turns, toolCalls, promptTokens, completionTokens, served, fallbacks, nudges, networkRetries, costUsd } = session.totals;
  writeFileSync(join(session.dir, 'run.json'), JSON.stringify({
    model: session.model, turns, toolCalls, promptTokens, completionTokens, served, fallbacks, nudges, networkRetries,
    stop: session.stop, seconds: Math.round(session.ms / 1000), finalText: session.finalText, costUsd,
    prompts: session.prompts,
    ...(session.errors.length > 0 ? { errors: session.errors } : {}),
    ...(session.invalid !== undefined ? { invalid: session.invalid } : {}),
  }, null, 2) + '\n');
}

/** Add one user turn's loop result to the session's totals, as run.json reports them. */
function record(session: PaneSession, route: string, result: LoopResult): void {
  const totals = session.totals;
  totals.turns += result.turns;
  totals.toolCalls += result.toolCalls;
  totals.promptTokens += result.promptTokens;
  totals.completionTokens += result.completionTokens;
  for (const base of result.served) if (!totals.served.includes(base)) totals.served.push(base);
  totals.fallbacks += result.fallbacks;
  totals.nudges += result.nudges;
  totals.networkRetries += result.networkRetries;
  totals.costUsd += result.costUsd;
  session.model = route;
  session.stop = result.stop;
  session.finalText = result.finalText;
}

/** Key-like runs of letters and digits: long, opaque, and not a word or a number. */
function keyLike(text: string): string {
  return /[0-9]/.test(text) && /[A-Za-z]/.test(text) ? '[redacted]' : text;
}

/** The key and the forms of the gateway's address, longest first. */
function secretsOf(base: string, key: string): string[] {
  const url = URL.canParse(base) ? new URL(base) : null;
  return [key, base, base.replace(/\/+$/, ''), url?.origin, url?.host]
    .filter((secret): secret is string => secret !== undefined && secret.length >= 3)
    .sort((a, b) => b.length - a.length);
}

function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join('[redacted]');
  return out;
}

/** Error text for the page: the key, the gateway's address and anything key-like taken out. */
export function redact(text: string, base: string, key: string): string {
  return scrub(text, secretsOf(base, key))
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/\b(api[_-]?key|key|token|secret|password)(["']?\s*[:=]\s*["']?)[^\s"',;]+/gi, '$1$2[redacted]')
    .replace(/[A-Za-z0-9_+=-]{32,}/g, keyLike);
}

/** This process's live servers, so a SIGINT or SIGTERM can mark their runs before it exits. */
const live = new Set<(why: string) => void>();

/**
 * On SIGINT or SIGTERM, mark every live pane run invalid (a running turn's stop becomes
 * `interrupted`), write its run.json, and exit.
 */
export function exitOnSignals(): void {
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]] as const) {
    process.once(signal, () => {
      for (const interrupt of live) interrupt('interrupted: the pane server got ' + signal + ' mid-session');
      process.exit(code);
    });
  }
}

export async function startPaneServer(options: PaneServerOptions): Promise<PaneServer> {
  const { base, key, origins, routes, runsRoot, primary } = options;
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const log = options.log ?? ((): void => {});
  const token = randomBytes(32).toString('base64url');
  const conns = new Set<Conn>();
  let hosts = new Set<string>();
  const secrets = secretsOf(base, key);

  // No string reaches the page with the key or the gateway's address in it, whatever its source: any
  // text the model is given (a file it reads, a tool's output) may hold them.
  function send(conn: Conn, out: ServerMessage): void {
    if (!conn.closed && conn.ws.readyState === conn.ws.OPEN) {
      conn.ws.send(JSON.stringify(out, (_name, value: unknown) => (typeof value === 'string' ? scrub(value, secrets) : value)));
    }
  }

  /** Write run.json; a failure is logged rather than thrown from a socket event. */
  function saveRun(session: PaneSession): void {
    try {
      writeRun(session);
    } catch (problem: unknown) {
      log(session.run + ': run.json not written: ' + message(problem));
    }
  }

  function startSession(conn: Conn, route: string): PaneSession {
    const system = SYSTEM_PREAMBLE + skillText();
    const { run, dir } = claimRunDir(runsRoot);
    writeFileSync(join(dir, 'transcript.jsonl'), '');
    const session: PaneSession = {
      run, dir, messages: [{ role: 'system', content: system }], prompts: [], model: route,
      totals: {
        turns: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0, served: [], fallbacks: 0, nudges: 0,
        networkRetries: 0, costUsd: 0,
      },
      stop: '', finalText: '', ms: 0, errors: [],
    };
    conn.session = session;
    send(conn, { type: 'started', run });
    log('pane session ' + run + ' started');
    return session;
  }

  /** End `conn`'s session: its run.json is final, and the page is told. */
  function finish(conn: Conn, why?: string): void {
    const session = conn.session;
    conn.session = null;
    if (session !== null) saveRun(session);
    send(conn, { type: 'ended', run: session?.run ?? null, ...(why !== undefined ? { error: why } : {}) });
  }

  /** The page's engine failed: no further call runs, and the session ends with this turn. */
  function fail(session: PaneSession, controller: AbortController, why: string): void {
    session.fatal ??= why;
    session.invalid ??= why;
    controller.abort();
  }

  async function exportSession(conn: Conn, session: PaneSession, controller: AbortController): Promise<void> {
    try {
      const exported = answer(await conn.page.request({ op: 'session' }));
      if (exported === 'missing') throw new Error('the page has no session after a successful call');
      writeSessionFile(join(session.dir, 'session.json'), exported);
    } catch (problem: unknown) {
      // A disconnect has already marked the run; anything else leaves session.json behind the machine.
      if (!conn.closed) fail(session, controller, 'session.json was not written: ' + message(problem));
    }
  }

  async function execute(conn: Conn, session: PaneSession, controller: AbortController,
    words: string[]): Promise<{ text: string; exit: number }> {
    const call = await callOnPage(words, conn.page);
    if (call.engineError !== undefined) {
      fail(session, controller, call.kind === 'new' ?
        'the page could not start the session (a stale page build? reload it): ' + call.engineError :
        'the page engine failed: ' + call.engineError);
    } else if (call.result.code === 0 && (call.kind === 'new' || call.kind === 'batch')) {
      await exportSession(conn, session, controller);
    }
    return { text: call.result.stdout + call.result.stderr, exit: call.result.code };
  }

  function offPrimary(route: string, servedBy: string): boolean {
    const expected = primary?.[route];
    return expected !== undefined && servedBy !== expected;
  }

  /** Who served a reply, before its calls run on the page: the badge comes first. */
  function onResponse(conn: Conn, route: string, response: ResponseInfo): void {
    const { turn, status, servedBy, fallbacks, costUsd } = response;
    const event: ServedEvent = { type: 'served', turn, status, servedBy, fallbacks, costUsd, offPrimary: offPrimary(route, servedBy) };
    send(conn, event);
  }

  function onTurn(conn: Conn, session: PaneSession, route: string, turn: TurnInfo): void {
    appendFileSync(join(session.dir, 'transcript.jsonl'), JSON.stringify(transcriptLine(turn)) + '\n');
    const event: TurnEvent = {
      type: 'turn', turn: turn.turn, status: turn.status, servedBy: turn.servedBy, fallbacks: turn.fallbacks,
      costUsd: turn.costUsd, offPrimary: offPrimary(route, turn.servedBy),
      content: turn.content ?? null, calls: turn.calls.map(({ name, args, output }) => ({ name, args, output })),
    };
    if (turn.stop !== undefined) event.stop = turn.stop;
    // The page gets the status and a fixed reason; the gateway's reply stays in transcript.jsonl.
    if (turn.body !== undefined) {
      event.reason = (STATUS_CODES[turn.status] ?? 'HTTP ' + turn.status) + '; the gateway\'s reply is in the run\'s transcript.jsonl';
    }
    send(conn, event);
  }

  async function runTurn(conn: Conn, text: string, route: string): Promise<void> {
    let session: PaneSession;
    try {
      session = conn.session ?? startSession(conn, route);
    } catch (problem: unknown) {
      send(conn, { type: 'done', stop: 'refused', text: 'could not start a pane session: ' + message(problem) });
      return;
    }
    const first = session.prompts.length === 0;
    session.prompts.push({ route, text });
    session.messages.push({ role: 'user', content: first ? FIRST_TURN_PREFIX + text + '\n' : text });
    // Until the turn ends, run.json says it is running: a run killed mid-turn never reads as done.
    session.model = route;
    session.stop = 'running';
    session.finalText = '';
    saveRun(session);
    const controller = new AbortController();
    conn.controller = controller;
    const began = Date.now();
    let failure = '';
    try {
      const result = await runLoop({
        base, key, model: route, messages: session.messages, maxTurns, signal: controller.signal,
        execute: (words) => execute(conn, session, controller, words),
        onRequest: (turn) => send(conn, { type: 'requesting', turn, route }),
        onResponse: (response) => onResponse(conn, route, response),
        onTurn: (turn) => onTurn(conn, session, route, turn),
        pinned: { name: PINNED, file: join(session.dir, 'session.json') },
        requireApiBase: options.requirePrimary === true ? primary?.[route] : undefined,
      });
      record(session, route, result);
    } catch (problem: unknown) {
      // The requests, calls and cost before the failure still count.
      if (problem instanceof LoopError) record(session, route, problem.result);
      failure = message(problem);
      session.stop = 'error';
      session.errors.push({ prompt: session.prompts.length, error: failure });
    }
    conn.controller = null;
    session.ms += Date.now() - began;
    saveRun(session);
    log(session.run + ': turn ended, ' + session.stop);
    send(conn, { type: 'done', stop: session.stop, text: session.stop === 'error' ? redact(failure, base, key) : session.finalText });
    if (session.fatal !== undefined && conn.session === session) finish(conn, session.fatal);
  }

  function onUser(conn: Conn, text: string, route: string): void {
    // A message the running turn did not answer gets an error; any other gets exactly one `done`.
    if (conn.turn !== null) return send(conn, { type: 'error', message: 'a turn is already running: wait for it, or press Stop' });
    const refuse = (why: string): void => send(conn, { type: 'done', stop: 'refused', text: why });
    if (!routes.includes(route)) return refuse('route ' + JSON.stringify(route) + ' is not allowed; use one of ' + routes.join(', '));
    if (text.trim() === '') return refuse('the message is empty');
    if (text.length > MAX_USER_CHARS) return refuse('the message is over ' + MAX_USER_CHARS + ' characters');
    conn.turn = runTurn(conn, text, route)
      .catch((problem: unknown) => send(conn, { type: 'done', stop: 'error', text: 'the turn failed: ' + redact(message(problem), base, key) }))
      .finally(() => { conn.turn = null; });
  }

  async function onEnd(conn: Conn): Promise<void> {
    conn.controller?.abort();
    await conn.turn;
    finish(conn);
  }

  function onMessage(conn: Conn, data: RawData, isBinary: boolean): void {
    const parsed = isBinary ? null : parsePageMessage(data.toString());
    if (!conn.authed) {
      // The first frame must be a hello with this launch's token; nothing is said to anyone else.
      if (parsed?.type !== 'hello' || !sameToken(parsed.token, token)) return conn.ws.close(CLOSE_BAD_TOKEN, 'bad token');
      if (parsed.protocol !== PANE_PROTOCOL) return conn.ws.close(CLOSE_BAD_PROTOCOL, 'protocol ' + PANE_PROTOCOL + ' expected');
      conn.authed = true;
      send(conn, { type: 'ready', routes: [...routes], maxUserChars: MAX_USER_CHARS });
      return;
    }
    if (parsed === null) return send(conn, { type: 'error', message: 'not a pane message' });
    switch (parsed.type) {
      case 'reply': {
        const waiting = conn.pending.get(parsed.id);
        conn.pending.delete(parsed.id);
        waiting?.resolve(parsed.reply);
        return;
      }
      case 'user':
        return onUser(conn, parsed.text, parsed.route);
      case 'stop':
        conn.controller?.abort();
        return;
      case 'end':
        void onEnd(conn);
        return;
      case 'hello':
        return send(conn, { type: 'error', message: 'already connected' });
    }
  }

  function onClose(conn: Conn): void {
    conn.closed = true;
    conns.delete(conn);
    for (const waiting of conn.pending.values()) waiting.reject(new Error(PAGE_GONE));
    conn.pending.clear();
    conn.controller?.abort();
    const session = conn.session;
    if (session === null) return;
    session.invalid ??= 'the page disconnected mid-session (a reload or a closed tab), and the machine went with it';
    log(session.run + ': ' + PAGE_GONE + ', run marked invalid');
    // A running turn writes run.json when it settles, which the rejected requests make prompt.
    if (conn.turn === null) saveRun(session);
  }

  function connect(ws: WebSocket): void {
    let markGone = (): void => {};
    const gone = new Promise<void>((done) => { markGone = done; });
    const conn: Conn = {
      ws, authed: false, closed: false, nextId: 1, pending: new Map(), session: null, turn: null, controller: null,
      gone, markGone,
      page: {
        request(request) {
          if (conn.closed) return Promise.reject(new Error(PAGE_GONE));
          const id = conn.nextId++;
          return new Promise((done, reject) => {
            conn.pending.set(id, { resolve: done as (reply: PaneReply) => void, reject });
            send(conn, { type: 'request', id, ...request });
          });
        },
      },
    };
    conns.add(conn);
    const hello = setTimeout(() => { if (!conn.authed) ws.close(CLOSE_NO_HELLO, 'no hello'); }, HELLO_MS);
    ws.on('message', (data, isBinary) => onMessage(conn, data, isBinary));
    ws.on('close', () => {
      clearTimeout(hello);
      onClose(conn);
      conn.markGone();
    });
    ws.on('error', () => { /* a close always follows */ });
  }

  /** The DNS-rebinding and cross-site guards: our own Host, and only the dev page's Origin. */
  function allowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    const host = req.headers.host;
    return origin !== undefined && origins.includes(origin) && host !== undefined && hosts.has(host);
  }

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });
  const http = createServer((_req, res) => {
    res.writeHead(426, { 'Content-Type': 'text/plain' });
    res.end('the minivac pane server speaks WebSocket only\n');
  });
  http.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    if (!allowed(req)) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, connect);
  });
  await new Promise<void>((done, failed) => {
    http.once('error', failed);
    http.listen(options.port, '127.0.0.1', () => done());
  });
  const port = (http.address() as AddressInfo).port;
  hosts = new Set(['127.0.0.1:' + port, 'localhost:' + port]);
  const origin = origins[0] ?? DEV_ORIGINS[0];
  /** The process is going down: every live run is marked, synchronously, before it does. */
  const interrupt = (why: string): void => {
    for (const conn of conns) {
      const session = conn.session;
      if (session === null) continue;
      session.invalid ??= why;
      if (session.stop === 'running') session.stop = 'interrupted';
      saveRun(session);
    }
  };
  live.add(interrupt);

  return {
    port,
    token,
    url: origin + '/dev.html#t=' + token + '&port=' + port,
    async close() {
      live.delete(interrupt);
      const open = [...conns];
      for (const conn of open) conn.ws.terminate();
      await Promise.all(open.map(async (conn) => {
        await conn.gone;
        await conn.turn;
      }));
      wss.close();
      http.closeAllConnections();
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}

function whole(text: string, what: string, min: number, max: number): number {
  if (!/^[0-9]+$/.test(text) || Number(text) < min || Number(text) > max) {
    throw new Error(what + ' must be an integer in ' + min + '..' + max + ', got ' + JSON.stringify(text));
  }
  return Number(text);
}

/** The server's options from the environment: the base URL and key come from nowhere else. */
export function optionsFromEnv(env: NodeJS.ProcessEnv): PaneServerOptions {
  const base = env.MINIVAC_LLM_BASE_URL;
  const key = env.MINIVAC_LLM_API_KEY;
  if (!base || !key) throw new Error('set MINIVAC_LLM_BASE_URL and MINIVAC_LLM_API_KEY');
  // The value is never echoed: it may hold what it must not.
  const url = URL.canParse(base) ? new URL(base) : null;
  if (url === null || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    throw new Error('MINIVAC_LLM_BASE_URL must be an http or https URL, like http://gateway:4000/v1');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('MINIVAC_LLM_BASE_URL must be a URL with no credentials in it: the key goes in MINIVAC_LLM_API_KEY');
  }
  const origins = env.MINIVAC_PANE_ORIGINS === undefined ? DEV_ORIGINS :
    env.MINIVAC_PANE_ORIGINS.split(',').map((origin) => origin.trim()).filter((origin) => origin !== '');
  for (const origin of origins) {
    let parsed: string;
    try {
      parsed = new URL(origin).origin;
    } catch {
      parsed = '';
    }
    if (parsed !== origin) throw new Error('MINIVAC_PANE_ORIGINS: ' + JSON.stringify(origin) + ' is not an exact origin like http://localhost:5173');
  }
  if (origins.length === 0) throw new Error('MINIVAC_PANE_ORIGINS names no origin');
  const routes = (env.MINIVAC_PANE_ROUTES ?? '').split(',').map((route) => route.trim()).filter((route) => route !== '');
  if (routes.length === 0) {
    throw new Error('set MINIVAC_PANE_ROUTES to the model names your endpoint serves (comma-separated, default first)');
  }
  const twice = routes.find((route, i) => routes.indexOf(route) !== i);
  if (twice !== undefined) throw new Error('MINIVAC_PANE_ROUTES names ' + JSON.stringify(twice) + ' twice');
  let primary: Record<string, string> | undefined;
  if (env.MINIVAC_PANE_PRIMARY !== undefined) {
    const shape = 'MINIVAC_PANE_PRIMARY must be a JSON object of route -> api base, routes from ' + routes.join(', ');
    let raw: unknown;
    try {
      raw = JSON.parse(env.MINIVAC_PANE_PRIMARY);
    } catch {
      throw new Error(shape);  // JSON.parse's message quotes the value
    }
    if (!isObject(raw) || !Object.entries(raw).every(([route, api]) => routes.includes(route) && typeof api === 'string')) {
      throw new Error(shape);
    }
    primary = raw as Record<string, string>;
  }
  return {
    base, key, origins, routes, primary, runsRoot: resolve(REPO, env.MINIVAC_PANE_RUNS ?? 'pane-runs'),
    port: env.MINIVAC_PANE_PORT === undefined ? DEFAULT_PANE_PORT : whole(env.MINIVAC_PANE_PORT, 'MINIVAC_PANE_PORT', 1, 65535),
    maxTurns: env.MINIVAC_PANE_MAX_TURNS === undefined ? DEFAULT_MAX_TURNS :
      whole(env.MINIVAC_PANE_MAX_TURNS, 'MINIVAC_PANE_MAX_TURNS', 1, 1000),
  };
}

async function main(): Promise<void> {
  const options = optionsFromEnv(process.env);
  const server = await startPaneServer({ ...options, log: (line) => process.stdout.write(line + '\n') });
  exitOnSignals();
  const runs = relative(REPO, options.runsRoot);
  process.stdout.write('minivac pane server on 127.0.0.1:' + server.port + ', runs in ' +
    (runs.startsWith('..') ? options.runsRoot : runs) + '/\n' +
    'start the dev page with `npm run dev:pane` (Vite on 127.0.0.1:5173, which fails rather than move to another port), then open\n' +
    server.url + '\n');
}

if (import.meta.main) {
  main().catch((problem: unknown) => {
    process.stderr.write('pane server: ' + message(problem) + '\n');
    process.exitCode = 2;
  });
}
