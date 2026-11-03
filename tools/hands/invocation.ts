/**
 * The words of one `minivac-control` call, parsed into what to do. Everything about the words is
 * here: help, the session path and the harness's pin on it, `new`, splitting a `+` batch and
 * parsing each command into a tool call, the rule that `state` may only end a batch, and
 * `--settle-ms`. The result describes the call; it is not output text. `backend.ts` does the work
 * and `render.ts` writes the text, so the CLI and the chat pane (docs/plans/stage-3-chat-pane.md)
 * share one parser.
 *
 * Runs in Node: `new` loads the profile it names and `load-program` reads its fixture's wires.
 */
import { DEFAULT_PROFILE, DEFAULT_SETTLE_MS, DIAL_UDEG_LIMIT, MAX_STEP_MS, newSession, parseWire, SessionError } from '../../src/hands/table.ts';
import type { Session, ToolCall, ToolResult } from '../../src/hands/table.ts';
import { loadRepoNetlist, loadRepoProfile, readProgramWires } from './session-file.ts';
import { isAbsolute, relative, resolve } from 'node:path';

export type Rejection = Extract<ToolResult, { ok: false }>;

export interface NewInvocation {
  kind: 'new';
  path: string;
  /** The empty session to start, built against the repo netlist and the named profile. */
  session: Session;
}

export interface StateInvocation {
  kind: 'state';
  path: string;
  /** `--json`: the full machine snapshot instead of the observables and cords. */
  json: boolean;
}

export interface BatchInvocation {
  kind: 'batch';
  path: string;
  /** Each command's words, for the output; `calls[i]` was parsed from `commands[i]`. */
  commands: string[][];
  calls: ToolCall[];
  settleMs: number;
  /** The batch ended with `state`, which reads the machine after the batch settles. */
  showState: boolean;
}

export type Invocation =
  /** No words at all: the main help, on stderr, exit 1. */
  | { kind: 'empty' }
  | { kind: 'help'; topic: 'main' | 'terminals' }
  /** A problem with the words; the session is not touched. */
  | { kind: 'error'; message: string }
  /** A command whose wire shorthand names no terminal, refused before the session is touched. */
  | { kind: 'rejected'; label: string; result: Rejection }
  | NewInvocation
  | StateInvocation
  | BatchInvocation;

/** The invocations answered without a session. */
export type LocalInvocation = Extract<Invocation, { kind: 'empty' | 'help' | 'error' | 'rejected' }>;

export interface InvocationOptions {
  /**
   * The one session path this run may create or use. A harness that runs a model pins it (the CLI
   * reads it from MINIVAC_CONTROL_SESSION); a refusal spells out the call to send instead.
   */
  pinned?: string | undefined;
}

class UsageError extends Error {}

function integer(text: string | undefined, what: string): number {
  if (text === undefined || !/^-?[0-9]+$/.test(text)) throw new UsageError(what + ' must be an integer, got ' + JSON.stringify(text ?? ''));
  return Number(text);
}

function arity(words: readonly string[], count: number, usage: string): void {
  if (words.length !== count) throw new UsageError('usage: ' + usage);
}

/** Decimal degrees (at most 6 places, 0 <= d < 360) to integer microdegrees, exactly. */
function degrees(text: string | undefined): number {
  const match = /^([0-9]{1,3})(?:\.([0-9]{1,6}))?$/.exec(text ?? '');
  if (match === null) throw new UsageError('dial angle must be degrees 0..359.999999, got ' + JSON.stringify(text ?? ''));
  const udeg = Number(match[1]) * 1_000_000 + Number((match[2] ?? '').padEnd(6, '0'));
  if (udeg >= DIAL_UDEG_LIMIT) throw new UsageError('dial angle must be below 360 degrees, got ' + text);
  return udeg;
}

const COMMAND_WORDS = new Set(['power', 'connect', 'disconnect', 'button', 'switch', 'wait', 'state', 'breaker', 'relay',
  'dial', 'load-program']);

const RELAY_USAGE = 'relay <n> hold in|out|<0..1000> | relay <n> release';
const DIAL_USAGE = 'dial hold <degrees> | dial release';

/** Parse one command's words into a tool call. Wire shorthand errors come back as a rejection. */
function parseCommand(words: readonly string[]): ToolCall | ToolResult {
  const [verb, first, second] = words;
  switch (verb) {
    case 'power':
      arity(words, 2, 'power on|off');
      if (first !== 'on' && first !== 'off') throw new UsageError('usage: power on|off');
      return { name: 'power', args: { on: first === 'on' } };
    case 'connect': {
      arity(words, 2, 'connect <A>/<B>');
      const wire = parseWire(first as string);
      return 'ok' in wire ? wire : { name: 'connect', args: wire };
    }
    case 'disconnect': {
      arity(words, 2, 'disconnect <cordId> | disconnect <A>/<B> | disconnect all');
      if (first === 'all') return { name: 'disconnect', args: { all: true } };
      if (/^[0-9]+$/.test(first as string)) return { name: 'disconnect', args: { cord: Number(first) } };
      const wire = parseWire(first as string);
      return 'ok' in wire ? wire : { name: 'disconnect', args: wire };
    }
    case 'button': {
      if (second === 'press') {
        if (words.length !== 3 && words.length !== 4) throw new UsageError('usage: button <n> press [ms]');
        const n = integer(first, 'button number');
        return words.length === 3 ? { name: 'press', args: { n } } :
          { name: 'press', args: { n, ms: integer(words[3], 'press time') } };
      }
      arity(words, 3, 'button <n> down|up|press|<0..1000>');
      const n = integer(first, 'button number');
      const target = second === 'down' ? 1000 : second === 'up' ? 0 : integer(second, 'button target');
      return { name: 'button', args: { n, target } };
    }
    case 'switch': {
      arity(words, 3, 'switch <n> left|right|<0..1000>');
      const n = integer(first, 'switch number');
      const target = second === 'left' ? 0 : second === 'right' ? 1000 : integer(second, 'switch target');
      return { name: 'switch', args: { n, target } };
    }
    case 'wait':
      arity(words, 2, 'wait <ms>');
      return { name: 'wait', args: { ms: integer(first, 'wait') } };
    case 'breaker':
      arity(words, 2, 'breaker reset');
      if (first !== 'reset') throw new UsageError('usage: breaker reset');
      return { name: 'breaker', args: { reset: true } };
    case 'relay': {
      if (second === 'release') {
        arity(words, 3, RELAY_USAGE);
        return { name: 'relayRelease', args: { n: integer(first, 'relay number') } };
      }
      if (second !== 'hold') throw new UsageError('usage: ' + RELAY_USAGE);
      arity(words, 4, RELAY_USAGE);
      const n = integer(first, 'relay number');
      const text = words[3];
      const target = text === 'in' ? 1000 : text === 'out' ? 0 : integer(text, 'relay target');
      return { name: 'relayGrab', args: { n, target } };
    }
    case 'dial':
      if (first === 'release') {
        arity(words, 2, DIAL_USAGE);
        return { name: 'dialRelease', args: {} };
      }
      if (first !== 'hold') throw new UsageError('usage: ' + DIAL_USAGE);
      arity(words, 3, DIAL_USAGE);
      return { name: 'dialGrab', args: { targetUdeg: degrees(second) } };
    case 'load-program': {
      arity(words, 2, 'load-program <ID>');
      const program = first as string;
      try {
        return { name: 'loadProgram', args: { program, wires: readProgramWires(program) } };
      } catch (problem: unknown) {
        if (problem instanceof SessionError) throw new UsageError(problem.message);
        throw problem;
      }
    }
    default:
      throw new UsageError('unknown command ' + JSON.stringify(verb ?? '') + ' (see: minivac-control --help)');
  }
}

function splitBatch(words: readonly string[]): string[][] {
  const commands: string[][] = [[]];
  for (const word of words) {
    if (word === '+') commands.push([]);
    else (commands[commands.length - 1] as string[]).push(word);
  }
  if (commands.some((command) => command.length === 0)) throw new UsageError('empty command in batch (stray +)');
  return commands;
}

/** Pull `--name <value>` out of `words`; returns the value or undefined. */
function takeOption(words: string[], name: string): string | undefined {
  const at = words.indexOf(name);
  if (at < 0) return undefined;
  const value = words[at + 1];
  if (value === undefined) throw new UsageError(name + ' needs a value');
  words.splice(at, 2);
  if (words.includes(name)) throw new UsageError(name + ' given twice');
  return value;
}

function takeFlag(words: string[], name: string): boolean {
  const at = words.indexOf(name);
  if (at < 0) return false;
  words.splice(at, 1);
  return true;
}

/** Refuse any path but the pinned one, spelling out the call to resend with the pinned path. */
function checkPinned(pinned: string | undefined, path: string, resend: (shown: string) => string): void {
  if (pinned && resolve(path) !== resolve(pinned)) {
    const shown = pinnedPath(pinned);
    throw new UsageError('this run may use only the session file ' + shown + '; resend as: ' + resend(shown));
  }
}

/** The pinned path as a model should type it: relative to the working directory when inside it. */
function pinnedPath(pinned: string): string {
  const rel = relative(process.cwd(), resolve(pinned));
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? pinned : rel;
}

function parseNew(args: string[], pinned: string | undefined): NewInvocation {
  const profile = takeOption(args, '--profile') ?? DEFAULT_PROFILE;
  if (args.includes('+')) {
    throw new UsageError('new takes only the session file; send commands in a second call: minivac-control <session.json> <command> ...');
  }
  if (args.length !== 1) throw new UsageError('usage: minivac-control new <session.json> [--profile <id>]');
  const path = args[0] as string;
  checkPinned(pinned, path, (shown) => 'new ' + shown);
  return { kind: 'new', path, session: newSession(loadRepoNetlist(), loadRepoProfile(profile)) };
}

function parseSessionCall(path: string, args: string[], pinned: string | undefined): Invocation {
  checkPinned(pinned, path, (shown) => [shown, ...args].join(' '));
  if (args[0] === 'state' && !args.includes('+')) {
    const json = takeFlag(args, '--json');
    if (args.length !== 1) throw new UsageError('usage: minivac-control <session.json> state [--json]');
    return { kind: 'state', path, json };
  }

  const settleText = takeOption(args, '--settle-ms');
  const settleMs = settleText === undefined ? DEFAULT_SETTLE_MS : integer(settleText, '--settle-ms');
  if (settleMs < 1 || settleMs > MAX_STEP_MS) throw new UsageError('--settle-ms must be in 1..' + MAX_STEP_MS + ' (one minute)');
  if (args.length === 0) throw new UsageError('no command (see: minivac-control --help)');

  const commands = splitBatch(args);
  // `state` may end a batch: it reads the machine after the batch settles.
  const showState = commands.length > 1 && (commands[commands.length - 1] as string[]).join(' ') === 'state';
  if (showState) commands.pop();
  const misplaced = commands.findIndex((words) => words[0] === 'state');
  if (misplaced >= 0) {
    return { kind: 'error', message: 'command ' + (misplaced + 1) + ' (state): state can only be the last command in a batch, or a call of its own' };
  }
  const calls: ToolCall[] = [];
  for (let i = 0; i < commands.length; i++) {
    const words = commands[i] as string[];
    const label = 'command ' + (i + 1) + ' (' + words.join(' ') + ')';
    let parsed: ToolCall | ToolResult;
    try {
      parsed = parseCommand(words);
    } catch (problem: unknown) {
      if (problem instanceof UsageError) return { kind: 'error', message: label + ': ' + problem.message };
      throw problem;
    }
    if ('ok' in parsed) return { kind: 'rejected', label, result: parsed as Rejection };
    calls.push(parsed);
  }
  return { kind: 'batch', path, commands, calls, settleMs, showState };
}

/**
 * Parse one call's words. A usage problem comes back as `{ kind: 'error' }`, as does a profile
 * `new` cannot load or a `load-program` id with no fixture; anything else that throws is a fault.
 */
export function parseInvocation(argv: readonly string[], options: InvocationOptions): Invocation {
  const args = argv.slice();
  const { pinned } = options;
  try {
    const head = args[0];
    if (head === undefined) return { kind: 'empty' };
    if (head === '--help' || head === '-h' || head === 'help') {
      if (args.length === 1) return { kind: 'help', topic: 'main' };
      if (args.length === 2 && args[1] === 'terminals') return { kind: 'help', topic: 'terminals' };
      throw new UsageError('usage: minivac-control help [terminals]');
    }
    if (head === 'new') return parseNew(args.slice(1), pinned);
    if (COMMAND_WORDS.has(head)) {
      throw new UsageError('the first word must be the session file: minivac-control ' +
        (pinned ? pinnedPath(pinned) : '<session.json>') + ' ' + args.join(' '));
    }
    return parseSessionCall(head, args.slice(1), pinned);
  } catch (problem: unknown) {
    if (problem instanceof UsageError || problem instanceof SessionError) return { kind: 'error', message: problem.message };
    throw problem;
  }
}
