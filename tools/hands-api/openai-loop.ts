// A minimal model loop for an OpenAI-compatible endpoint (the LiteLLM facade), giving the model the
// same hands a Claude Code session has in the stage-1 runs: minivac-control, plus read-only file
// tools scoped to the manuals' research and the conformance fixtures (repo-files.ts READABLE) and
// the run's own session file, with the minivac skill as the system prompt. A probe of where the local
// models stand, not the stage-2 hands API (which will expose the tool table directly).
//
// Usage: node tools/hands-api/openai-loop.ts <model> <out-dir> <prompt-file>
// Env: MINIVAC_LLM_BASE_URL (…/v1), MINIVAC_LLM_API_KEY. Optional MINIVAC_LLM_MAX_TURNS (default 80);
// MINIVAC_LLM_NUDGES (default 0): how many times an empty reply (no text, no tool call) is answered
// with "continue" instead of ending the run; each one is counted in run.json. MINIVAC_SKILL_PATH
// replaces the repo's minivac skill with another file (the skill-tuning loop's candidates).
// MINIVAC_LLM_REQUIRE_API_BASE: the run stops with stop "wrong_api_base" as soon as a response's
// x-litellm-model-api-base differs from it (a gateway fallback served the request). run.json's
// costUsd sums the gateway's x-litellm-response-cost headers.
// Writes <out-dir>/transcript.jsonl (one line per request) and <out-dir>/run.json (summary). The
// model's session file is pinned to <out-dir>/session.json.
//
// `runLoop` is the loop itself, for the chat pane's server (docs/plans/stage-3-chat-pane.md, step 3):
// the caller owns the messages, so a later user turn continues the same conversation, and supplies
// the minivac_control executor. The command line above is `runLoop` with an executor that runs
// minivac-control in this process.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { run as minivacControl } from '../hands/cli.ts';
import { grep, listInRepo, READABLE, visibleInRepo } from './repo-files.ts';

const REPO = resolve(new URL('../..', import.meta.url).pathname);
const MAX_OUTPUT = 12_000;
const REQUEST_TIMEOUT_MS = 600_000;
const NETWORK_RETRIES = 2;
const NOT_RUN = 'error: not run: the run was stopped before this call';
const MALFORMED = 'error: malformed tool call';
const IN_SCOPE = ' (' + READABLE.map((root) => root + '/').join(' and ') + ' only)';

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

/** Runs one minivac_control call: the words after "bin/minivac-control", already split by `splitArgs`. */
export type Execute = (words: string[]) => Promise<{ text: string; exit: number }>;

interface Usage { prompt_tokens?: number; completion_tokens?: number }

/** One request to the model, reported once its tool calls have run (or once it ended the loop). */
export interface TurnInfo {
  /** Requests so far in this `runLoop` call, from 1. */
  turn: number;
  status: number;
  /** x-litellm-model-api-base: the server that answered, '?' when the header is absent. */
  servedBy: string;
  /** x-litellm-attempted-fallbacks. */
  fallbacks: number;
  /** x-litellm-response-cost, 0 when absent. */
  costUsd: number;
  /** Set when this response ended the loop before its message was kept: http_<status> or wrong_api_base. */
  stop?: string | undefined;
  /** The response body, on an HTTP error. */
  body?: string | undefined;
  finish?: string | undefined;
  usage?: Usage | undefined;
  content?: string | null | undefined;
  reasoning?: string | undefined;
  calls: { id: string; name: string; args: string; output: string }[];
}

/** Who answered a request, reported as soon as its response is in: before any of its calls run. */
export type ResponseInfo = Pick<TurnInfo, 'turn' | 'status' | 'servedBy' | 'fallbacks' | 'costUsd'>;

/** A session path the model names, read from another file: the chat pane's pane.json. */
export interface Pinned {
  /** The path as the model writes it, relative to the repo (pane.json). */
  name: string;
  /** The file read_file gives for it. */
  file: string;
}

export interface LoopOptions {
  base: string;
  key: string;
  model: string;
  /** Caller-owned: runLoop appends to it, and a later call continues from it. */
  messages: Message[];
  execute: Execute;
  onTurn?: ((turn: TurnInfo) => void) | undefined;
  /** Each request as it goes out, numbered as TurnInfo.turn: the model is working until its response. */
  onRequest?: ((turn: number) => void) | undefined;
  onResponse?: ((response: ResponseInfo) => void) | undefined;
  /** read_file of `pinned.name` reads `pinned.file`. */
  pinned?: Pinned | undefined;
  /** Stops the loop. A call already running finishes; the rest of its reply's calls are answered as not run. */
  signal?: AbortSignal | undefined;
  /** Requests per call before stop "max_turns". Default 80. */
  maxTurns?: number | undefined;
  /** Empty replies answered with "continue" per call before an empty reply ends it. Default 0. */
  nudges?: number | undefined;
  /** When set, the first response another server answered stops the loop with "wrong_api_base". */
  requireApiBase?: string | undefined;
}

export interface LoopResult {
  /** done, max_turns, http_<status>, wrong_api_base, no_choice, or aborted. */
  stop: string;
  finalText: string;
  turns: number;
  toolCalls: number;
  promptTokens: number;
  completionTokens: number;
  served: string[];
  fallbacks: number;
  nudges: number;
  networkRetries: number;
  costUsd: number;
}

const TOOLS = [
  fn('minivac_control', 'Run bin/minivac-control with these arguments (the words after ' +
    '"bin/minivac-control", e.g. "s.json connect 1+/1Y + power on" or "--help"). Returns its output ' +
    'and exit code.', { args: { type: 'string' } }, ['args']),
  fn('read_file', 'Read a text file in the repository' + IN_SCOPE + ', or your session file. Lines are numbered. ' +
    'Use offset/limit for long files (default: first 400 lines).',
  { path: { type: 'string' }, offset: { type: 'integer' }, limit: { type: 'integer' } }, ['path']),
  fn('grep', 'Search files in the repository' + IN_SCOPE + ' for a regular expression (JavaScript syntax), ignoring ' +
    'case. Returns path:line: text for each match.', { pattern: { type: 'string' }, path: { type: 'string' } },
  ['pattern']),
  fn('list_files', 'List the entries of a directory in the repository.', { path: { type: 'string' } },
    ['path']),
];

function fn(name: string, description: string, properties: object, required: string[]): object {
  return { type: 'function', function: { name, description, parameters: { type: 'object', properties, required } } };
}

function cap(text: string): string {
  return text.length <= MAX_OUTPUT ? text : text.slice(0, MAX_OUTPUT) + '\n[output truncated]';
}

function splitArgs(line: string): string[] {
  const words = line.trim().split(/\s+/).filter((w) => w !== '')
    .map((w) => w.replace(/^(['"])(.*)\1$/, '$2'));
  if (words[0] === 'bin/minivac-control' || words[0] === './bin/minivac-control') words.shift();
  return words;
}

/** Error text names paths as the model does: relative to the repo, never the machine's own paths. */
function repoRelative(text: string, pinned: Pinned | undefined): string {
  const named = pinned === undefined ? text : text.split(pinned.file).join(pinned.name);
  return named.split(REPO + '/').join('').split(REPO).join('.');
}

async function callTool(name: string, rawArgs: string, execute: Execute, pinned: Pinned | undefined): Promise<string> {
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(rawArgs || '{}') as Record<string, unknown>;
  } catch {
    return 'error: arguments are not valid JSON';
  }
  try {
    switch (name) {
      case 'minivac_control': {
        const result = await execute(splitArgs(String(args.args ?? '')));
        return cap(result.text + '\n[exit ' + result.exit + ']');
      }
      case 'read_file': {
        // The run's own session file is readable wherever it lies; any other path is in scope or refused.
        const named = resolve(REPO, String(args.path));
        const file = pinned !== undefined && named === resolve(REPO, pinned.name) ? pinned.file : visibleInRepo(String(args.path));
        const lines = readFileSync(file, 'utf8').split('\n');
        const offset = Math.max(1, Number(args.offset ?? 1));
        const limit = Math.max(1, Number(args.limit ?? 400));
        const slice = lines.slice(offset - 1, offset - 1 + limit).map((l, i) => (offset + i) + '\t' + l);
        const more = offset - 1 + limit < lines.length ? '\n[' + lines.length + ' lines in all]' : '';
        return cap(slice.join('\n') + more);
      }
      case 'grep':
        return cap(await grep(String(args.pattern), visibleInRepo(String(args.path ?? '.'))));
      case 'list_files':
        return cap(listInRepo(String(args.path)).join('\n'));
      default:
        return 'error: no tool named ' + name;
    }
  } catch (problem: unknown) {
    return 'error: ' + repoRelative(problem instanceof Error ? problem.message : String(problem), pinned);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function skillText(): string {
  const path = process.env.MINIVAC_SKILL_PATH ?? join(REPO, '.claude/skills/minivac/SKILL.md');
  const text = readFileSync(path, 'utf8');
  return text.replace(/^---\n[\s\S]*?\n---\n/, '');
}

export const SYSTEM_PREAMBLE =
  'You operate a simulator through tools. Your only shell tool is minivac_control: it runs ' +
  'bin/minivac-control from the repository root with the arguments you give it. Read files with ' +
  'read_file, grep and list_files. Work until the task is done, then reply with a short summary and ' +
  'no tool call.\n\nThe skill below tells you how to operate the machine.\n\n';

// A dropped connection (a socket the gateway closed while a tool ran) is retried; HTTP errors are
// not, and neither is the caller's stop.
async function post(base: string, key: string, body: object, counts: { networkRetries: number },
  signal: AbortSignal | undefined): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
      return await fetch(base.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (problem: unknown) {
      if (signal?.aborted) throw problem;
      const cause = problem instanceof Error && problem.cause instanceof Error ? problem.cause.message : '';
      process.stderr.write('fetch failed (attempt ' + (attempt + 1) + '): ' + String(problem) + ' ' + cause + '\n');
      if (attempt >= NETWORK_RETRIES) throw problem;
      counts.networkRetries += 1;
    }
  }
}

/** runLoop's failure, with the totals up to it: the requests made, the calls run, their cost. */
export class LoopError extends Error {
  readonly result: LoopResult;
  constructor(result: LoopResult, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.result = result;
  }
}

/**
 * Runs the model on `messages` until it replies with no tool call, or a stop. Throws, as the
 * command line always has, on a network failure past the retries or an unparseable reply; even
 * then every tool call in `messages` has its answer. What it throws is a LoopError.
 */
export async function runLoop(options: LoopOptions): Promise<LoopResult> {
  const result: LoopResult = {
    stop: '', finalText: '', turns: 0, toolCalls: 0, promptTokens: 0, completionTokens: 0, served: [],
    fallbacks: 0, nudges: 0, networkRetries: 0, costUsd: 0,
  };
  try {
    return await loop(options, result);
  } catch (problem: unknown) {
    throw new LoopError(result, problem);
  }
}

async function loop(options: LoopOptions, result: LoopResult): Promise<LoopResult> {
  const { base, key, model, messages, execute, onTurn, onRequest, onResponse, signal, requireApiBase, pinned } = options;
  const maxTurns = options.maxTurns ?? 80;
  const maxNudges = options.nudges ?? 0;

  for (;;) {
    if (signal?.aborted) { result.stop = 'aborted'; break; }
    if (result.turns >= maxTurns) { result.stop = 'max_turns'; break; }
    result.turns += 1;
    onRequest?.(result.turns);
    let response: Response;
    let body: string;
    try {
      response = await post(base, key, { model, messages, tools: TOOLS, tool_choice: 'auto' }, result, signal);
      body = await response.text();
    } catch (problem: unknown) {
      if (signal?.aborted) { result.stop = 'aborted'; break; }
      throw problem;
    }
    const servedBy = response.headers.get('x-litellm-model-api-base') ?? '?';
    const fallbacks = Number(response.headers.get('x-litellm-attempted-fallbacks') ?? 0);
    const costUsd = Number(response.headers.get('x-litellm-response-cost') ?? 0) || 0;
    if (!result.served.includes(servedBy)) result.served.push(servedBy);
    result.fallbacks += fallbacks;
    result.costUsd += costUsd;
    const info: TurnInfo = { turn: result.turns, status: response.status, servedBy, fallbacks, costUsd, calls: [] };
    onResponse?.({ turn: info.turn, status: info.status, servedBy, fallbacks, costUsd });
    // An HTTP error first: a gateway refusal (a 429 from a spend cap) carries no api-base header.
    if (!response.ok) {
      result.stop = 'http_' + response.status;
      onTurn?.({ ...info, stop: result.stop, body });
      break;
    }
    if (requireApiBase && servedBy !== requireApiBase) {
      result.stop = 'wrong_api_base';
      onTurn?.({ ...info, stop: result.stop });
      break;
    }
    const data = JSON.parse(body) as {
      choices: { message: Message; finish_reason: string }[];
      usage?: Usage;
    };
    const message = data.choices[0]?.message;
    result.promptTokens += data.usage?.prompt_tokens ?? 0;
    result.completionTokens += data.usage?.completion_tokens ?? 0;
    if (!message) { result.stop = 'no_choice'; break; }
    // Every call gets exactly one answer, matched by id, so a call the model sent without an id
    // gets one here, in the kept message too.
    const sent: unknown[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const calls = sent.map((call, i) => (isObject(call) && typeof call.id === 'string' && call.id !== '' ? call :
      { ...(isObject(call) ? call : {}), id: 'call_unnamed_' + messages.length + '_' + i })) as unknown as ToolCall[];
    const kept: Message = { role: 'assistant', content: message.content ?? null };
    if (calls.length > 0) kept.tool_calls = calls;
    if (message.reasoning_content) kept.reasoning_content = message.reasoning_content;
    messages.push(kept);
    // One call at a time, in order. After a stop every call still gets an answer, so the
    // conversation stays valid for the next user turn.
    for (const call of calls) {
      const fn: unknown = call.function;
      const name = isObject(fn) && typeof fn.name === 'string' ? fn.name : '';
      const args = (isObject(fn) ? fn.arguments : undefined) as string;
      const output = signal?.aborted ? NOT_RUN : name === '' ? MALFORMED : await callTool(name, args, execute, pinned);
      messages.push({ role: 'tool', tool_call_id: call.id, content: output });
      info.calls.push({ id: call.id, name, args, output });
    }
    result.toolCalls += calls.length;
    onTurn?.({
      ...info, finish: data.choices[0]?.finish_reason, usage: data.usage, content: message.content,
      reasoning: message.reasoning_content,
    });
    if (calls.length === 0) {
      if (!message.content?.trim() && result.nudges < maxNudges) {
        result.nudges += 1;
        messages.push({ role: 'user', content: 'Continue: call a tool, or reply with your summary if the task is done.' });
        continue;
      }
      result.stop = 'done';
      result.finalText = message.content ?? '';
      break;
    }
  }
  return result;
}

/** A request's line in transcript.jsonl, in the shapes the command line has always written. */
export function transcriptLine(turn: TurnInfo): object {
  if (turn.stop === 'wrong_api_base') {
    return { turn: turn.turn, servedBy: turn.servedBy, fallbacks: turn.fallbacks, status: turn.status };
  }
  if (turn.stop !== undefined) return { turn: turn.turn, status: turn.status, body: turn.body };
  return {
    turn: turn.turn, servedBy: turn.servedBy, fallbacks: turn.fallbacks, finish: turn.finish, usage: turn.usage,
    content: turn.content, reasoning: turn.reasoning,
    calls: turn.calls.map(({ name, args, output }) => ({ name, args, output })),
  };
}

async function main(): Promise<void> {
  const [model, outDir, promptFile] = process.argv.slice(2);
  const base = process.env.MINIVAC_LLM_BASE_URL;
  const key = process.env.MINIVAC_LLM_API_KEY;
  if (!model || !outDir || !promptFile || !base || !key) {
    throw new Error('usage: openai-loop.ts <model> <out-dir> <prompt-file> (env MINIVAC_LLM_BASE_URL, MINIVAC_LLM_API_KEY)');
  }
  // The model may create and use only <out-dir>/session.json (enforced by minivac-control), and
  // read_file reads it there, though notebook/ is outside what the file tools read.
  const session = resolve(outDir, 'session.json');
  process.env.MINIVAC_CONTROL_SESSION = session;
  const transcript = join(outDir, 'transcript.jsonl');
  writeFileSync(transcript, '');
  const messages: Message[] = [
    { role: 'system', content: SYSTEM_PREAMBLE + skillText() },
    { role: 'user', content: readFileSync(promptFile, 'utf8') },
  ];
  const started = Date.now();
  const result = await runLoop({
    base, key, model, messages,
    execute: async (words) => {
      const ran = minivacControl(words);
      return { text: ran.stdout + ran.stderr, exit: ran.code };
    },
    onTurn: (turn) => appendFileSync(transcript, JSON.stringify(transcriptLine(turn)) + '\n'),
    pinned: { name: relative(REPO, session), file: session },
    maxTurns: Number(process.env.MINIVAC_LLM_MAX_TURNS ?? 80),
    nudges: Number(process.env.MINIVAC_LLM_NUDGES ?? 0),
    requireApiBase: process.env.MINIVAC_LLM_REQUIRE_API_BASE,
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  const { turns, toolCalls, promptTokens, completionTokens, served, fallbacks, nudges, networkRetries, stop, finalText,
    costUsd } = result;
  writeFileSync(join(outDir, 'run.json'), JSON.stringify({
    model, turns, toolCalls, promptTokens, completionTokens, served, fallbacks, nudges, networkRetries, stop, seconds,
    finalText, costUsd,
  }, null, 2) + '\n');
}

if (import.meta.main) {
  main().catch((thrown: unknown) => {
    const problem = thrown instanceof LoopError ? thrown.cause : thrown;
    process.stderr.write((problem instanceof Error ? problem.stack ?? problem.message : String(problem)) + '\n');
    process.exitCode = 2;
  });
}
