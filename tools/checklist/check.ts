/**
 * `minivac-check`: grades an operator's `minivac-control` session against one checklist item
 * (`checklist/items/<id>.json`, schema `checklist/item.schema.json`).
 *
 * A wire item is judged by behaviour, not by cord list: the session's final cords become the
 * `wires` of a copy of the item's reference conformance fixture (errata emptied, the item's
 * `extra` steps appended), and the conformance runner plays the manual's own script against them.
 * The operator's own presses are discarded, and a session that used load-program fails (ruling
 * O4). A basic item is judged on the operator's own session: the exact cord multiset, any
 * `connected` pairs plugged at some point, and the end-state observables after 500 ms more
 * simulated time; it also fails a session that used load-program. An operate item asks the
 * operator to run a program: its final cords must run the program's fixture (the wire check with
 * the item's extras; loaded or hand-wired), its `steps` must appear in order among the commands
 * sent after the wiring was finished with nothing after a control's last step, each step's
 * checkpoint must hold once its call settled, and its end state is read as a basic item's is.
 * Every kind refuses a session on another profile.
 *
 * Separate from `minivac-control` on purpose, so an operator allowed only that tool cannot reach
 * the yardstick. Output is one verdict line (plus any further mismatch lines); exit 0 pass,
 * 1 fail, 2 error. The reference fixture file is only read; the copy lives in a temp directory.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema, ValidateFunction } from 'ajv';
import { parseHoleId, parseTerminalWire } from '../../src/core/terminals.ts';
import { callTool, DEFAULT_PROFILE, replay, stateView } from '../../src/hands/table.ts';
import type { Command } from '../../src/core/contract.ts';
import type { Rig, Session } from '../../src/hands/table.ts';
import { loadFixture, readStrictJson, REPO_ROOT } from '../../test/conformance/helpers.ts';
import { runLoadedFixture } from '../../test/conformance/run.ts';
import type { ExpectedObservable, Fixture, RunResult, ScriptStep } from '../../test/conformance/types.ts';
import { loadRepoNetlist, loadRepoProfile, readSession } from '../hands/session-file.ts';

export const ITEM_SCHEMA = 'minivac.checkitem/1';
/** Simulated time a basic check runs past the session's end, so lamp filaments finish (O-C28). */
export const BASIC_SETTLE_MS = 500;

interface ItemBase {
  schema: typeof ITEM_SCHEMA;
  id: string;
  prompt: string;
  note?: string;
}

export interface WireItem extends ItemBase {
  kind: 'wire';
  /** Repo-relative path of the reference conformance fixture. */
  fixture: string;
  extra?: ScriptStep[];
}

export interface BasicItem extends ItemBase {
  kind: 'basic';
  /** Terminal pairs in manual shorthand; matched as an unordered multiset of unordered pairs. */
  cords: string[];
  /** Terminal pairs some accepted connect in the session must have joined, even if later unplugged. */
  connected?: string[];
  expect: ExpectedObservable[];
}

type ExpectStep = Extract<ScriptStep, { k: 'expect' }>;

/** One required command, optionally with a checkpoint read when its call has settled (+500 ms). */
export interface OperateStep {
  cmd: Command;
  expect?: ExpectStep;
}

export interface OperateItem extends ItemBase {
  kind: 'operate';
  /** Repo-relative path of the program's conformance fixture. */
  program: string;
  /** Steps appended to the program fixture copy in the wiring stage, as a wire item's `extra`. */
  extra?: ScriptStep[];
  /** Commands that must appear, in order, among the session's commands after its wiring. */
  steps: OperateStep[];
  expect: ExpectedObservable[];
}

export type Item = WireItem | BasicItem | OperateItem;

export interface CheckResult {
  code: 0 | 1 | 2;
  stdout: string;
  stderr: string;
}

/** Anything that makes the check impossible rather than failed. */
export class CheckError extends Error {}

let validateCache: ValidateFunction | null = null;

function itemValidator(): ValidateFunction {
  if (validateCache === null) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addSchema(readStrictJson(new URL('../../test/conformance/fixture.schema.json', import.meta.url), 'fixture schema') as AnySchema);
    validateCache = ajv.compile(readStrictJson(new URL('../../checklist/item.schema.json', import.meta.url), 'item schema') as AnySchema);
  }
  return validateCache;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Validate a parsed item: schema, terminal names in basic cords. Throws CheckError. */
export function validateItem(raw: unknown, where: string): Item {
  const validate = itemValidator();
  if (!validate(raw)) {
    const detail = (validate.errors ?? []).map((error) => (error.instancePath || '/') + ' ' + error.message).join('; ');
    throw new CheckError('invalid item ' + where + ': ' + detail);
  }
  const item = raw as Item;
  if (item.kind === 'operate') {
    item.steps.forEach((step, i) => {
      if (step.cmd.k === 'connect' || step.cmd.k === 'disconnect') {
        throw new CheckError('invalid item ' + where + ': steps cannot ' + step.cmd.k + '; the program supplies the wiring');
      }
      if (step.cmd.k === 'dialGrab' && !(step.expect?.obs ?? []).some((obs) => obs.dev === 'dial')) {
        throw new CheckError('invalid item ' + where + ': dial step ' + (i + 1) +
          ' needs a checkpoint on the dial; a dial step matches a dial hold at any angle');
      }
    });
  }
  if (item.kind === 'basic') {
    for (const cord of [...item.cords, ...(item.connected ?? [])]) {
      try {
        parseTerminalWire(cord);
      } catch (error: unknown) {
        throw new CheckError('invalid item ' + where + ': cord ' + JSON.stringify(cord) + ': ' + message(error));
      }
    }
  }
  return item;
}

export function readItem(path: string): Item {
  let raw: unknown;
  try {
    raw = readStrictJson(path, 'item ' + path);
  } catch (error: unknown) {
    throw new CheckError(message(error).replace(/^fixture: /, ''));
  }
  return validateItem(raw, path);
}

function replaySession(session: Session): Rig {
  return replay(loadRepoNetlist(), loadRepoProfile(session.profile), session);
}

/** `1-/1B` and `1B/1-` are one cord; `1+` and `2+` stay distinct. A free-ended cord is `M10/free` as written. */
function cordKey(wire: string): string {
  if (wire.split('/').includes('free')) return wire;
  const [a, b] = parseTerminalWire(wire);
  return a < b ? a + '/' + b : b + '/' + a;
}

/** Every terminal pair a hole-to-hole connect step in the session log joined, removed or not. */
function everConnected(session: Session): Set<string> {
  const keys = new Set<string>();
  for (const step of session.script) {
    if (step.k !== 'do' || step.cmd.k !== 'connect' || step.cmd.a.k !== 'hole' || step.cmd.b.k !== 'hole') continue;
    keys.add(cordKey(parseHoleId(step.cmd.a.hole).terminal + '/' + parseHoleId(step.cmd.b.hole).terminal));
  }
  return keys;
}

interface Outcome {
  pass: boolean;
  lines: string[];
}

/** Advance BASIC_SETTLE_MS past the session's end and list every `expect` observable that differs. */
function endStateLines(rig: Rig, expected: readonly ExpectedObservable[]): string[] {
  const waited = callTool(rig, { name: 'wait', args: { ms: BASIC_SETTLE_MS } });
  if (!waited.ok) throw new CheckError(waited.detail);
  const view = stateView(rig);
  const lines: string[] = [];
  for (const wanted of expected) {
    const row = view.observables.find((entry) => entry.name === wanted.dev);
    const actual = row === undefined ? '?' : row.value;
    if (actual !== wanted.v) lines.push(wanted.dev + ' expected ' + wanted.v + ', got ' + actual);
  }
  return lines;
}

function checkBasic(item: BasicItem, session: Session): Outcome {
  // Basic items are written against the reference machine; one profile, as wire items have.
  if (session.profile !== DEFAULT_PROFILE) {
    throw new CheckError('profile mismatch: the session uses ' + session.profile + ', basic items need ' +
      DEFAULT_PROFILE + ' (start the session with --profile ' + DEFAULT_PROFILE + ')');
  }
  const rig = replaySession(session);
  if (usedLoad(session)) return { pass: false, lines: ['used load-program, which a basic item does not allow (O4)'] };
  const cords = stateView(rig).cords;

  const lines: string[] = [];
  const have = new Map<string, number>();
  for (const cord of cords) {
    const key = cordKey(cord.wire);
    have.set(key, (have.get(key) ?? 0) + 1);
  }
  for (const wanted of item.cords) {
    const key = cordKey(wanted);
    const left = have.get(key) ?? 0;
    if (left > 0) have.set(key, left - 1);
    else lines.push('missing cord ' + wanted);
  }
  for (const cord of cords) {
    const key = cordKey(cord.wire);
    const left = have.get(key) ?? 0;
    if (left === 0) continue;
    have.set(key, left - 1);
    lines.push('extra cord ' + cord.wire + ' (cord ' + cord.id + ')');
  }
  const joined = everConnected(session);
  for (const wanted of item.connected ?? []) {
    if (!joined.has(cordKey(wanted))) lines.push('never connected ' + wanted);
  }
  lines.push(...endStateLines(rig, item.expect));
  return { pass: lines.length === 0, lines };
}

/** Load and run the temp copy; loader and runner refusals (hole allocation, rejected command) are errors. */
function runCopy(path: string, fixture: string): RunResult {
  try {
    return runLoadedFixture(loadFixture(path));
  } catch (error: unknown) {
    throw new CheckError(message(error).replaceAll(path, '<copy of ' + fixture + '>'));
  }
}

function readReference(fixture: string, session: Session): Fixture {
  let reference: Fixture;
  try {
    reference = readStrictJson(resolve(REPO_ROOT, fixture), fixture) as Fixture;
  } catch (error: unknown) {
    throw new CheckError('reference fixture ' + fixture + ': ' + message(error).replace(/^fixture: /, ''));
  }
  if (session.profile !== reference.profile) {
    throw new CheckError('profile mismatch: the session uses ' + session.profile + ', ' + fixture +
      ' needs ' + reference.profile + ' (start the session with --profile ' + reference.profile + ')');
  }
  return reference;
}

/** Does any step of the session log come from load-program? */
function usedLoad(session: Session): boolean {
  return session.script.some((step) => step.k === 'load');
}

function checkWire(item: WireItem, session: Session): Outcome {
  const reference = readReference(item.fixture, session);
  const rig = replaySession(session);
  if (usedLoad(session)) return { pass: false, lines: ['used load-program, which a wiring item does not allow (O4)'] };
  return runWiring(item.fixture, reference, rig, item.extra ?? []);
}

/**
 * The wire check: the rig's final cords as the `wires` of a copy of `reference` (errata emptied,
 * `extra` appended), run through the conformance runner. Errors when no cord is plugged.
 */
function runWiring(fixture: string, reference: Fixture, rig: Rig, extra: readonly ScriptStep[]): Outcome {
  // A free-ended cord joins nothing, so it is no wire of the circuit.
  const wires = stateView(rig).cords.filter((cord) => cord.b !== null).map((cord) => cord.wire);
  if (wires.length === 0) throw new CheckError('the session has no cords plugged in; nothing to check');

  const copy: Fixture = { ...reference, wires, errata_applied: [], script: [...reference.script, ...extra] };
  const dir = mkdtempSync(join(tmpdir(), 'minivac-check-'));
  try {
    const path = join(dir, reference.id + '.fixture.json');
    writeFileSync(path, JSON.stringify(copy, null, 2) + '\n');
    const result = runCopy(path, fixture);
    const lines = result.failures.map((failure) => {
      const step = copy.script[failure.scriptIndex] as Extract<ScriptStep, { k: 'expect' | 'until' }>;
      const refLength = reference.script.length;
      const where = failure.scriptIndex < refLength ? 'script[' + failure.scriptIndex + ']' :
        'extra[' + (failure.scriptIndex - refLength) + ']';
      return where + ' ' + failure.dev + ' expected ' + failure.expected + ', got ' + failure.actual +
        ': "' + step.quote + '"' + (step.tag === 'unverified' ? ' [unverified, derived]' : '');
    });
    return { pass: lines.length === 0, lines };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Which physical control a command moves, so a press and its release can be told apart in time. */
function control(cmd: Command): string {
  switch (cmd.k) {
    case 'button':
    case 'switch':
      return cmd.k + cmd.n;
    case 'relayGrab':
    case 'relayRelease':
      return 'relay' + cmd.n;
    case 'dialGrab':
    case 'dialRelease':
      return 'dial';
    default:
      return cmd.k;
  }
}

/** A command in minivac-control spelling, for FAIL lines. */
export function describeCommand(cmd: Command): string {
  switch (cmd.k) {
    case 'power':
      return 'power ' + (cmd.on ? 'on' : 'off');
    case 'breaker':
      return 'breaker reset';
    case 'button':
      return 'button ' + cmd.n + ' ' + (cmd.target === 1000 ? 'down' : cmd.target === 0 ? 'up' : String(cmd.target));
    case 'switch':
      return 'switch ' + cmd.n + ' ' + (cmd.target === 1000 ? 'right' : cmd.target === 0 ? 'left' : String(cmd.target));
    case 'relayGrab':
      return 'relay ' + cmd.n + ' hold ' + (cmd.target === 1000 ? 'in' : cmd.target === 0 ? 'out' : String(cmd.target));
    case 'relayRelease':
      return 'relay ' + cmd.n + ' release';
    case 'dialGrab':
      return 'dial hold ' + String(cmd.targetUdeg / 1_000_000);
    case 'dialRelease':
      return 'dial release';
    default:
      return JSON.stringify(cmd);
  }
}

/** Stable text for comparing commands whatever their key order. */
function commandKey(cmd: Command): string {
  const record = cmd as unknown as Record<string, unknown>;
  return JSON.stringify(Object.keys(record).sort().map((key) => [key, record[key]]));
}

/**
 * What a sent command must equal to take a step. A dial hold takes a dial step at any angle: a
 * contact spans about 15 degrees, and the step's checkpoint (required on the dial) says which
 * contact the pointer had to reach.
 */
function stepKey(cmd: Command): string {
  return cmd.k === 'dialGrab' ? 'dialGrab' : commandKey(cmd);
}

/** A step in minivac-control spelling, for FAIL lines. */
function describeStep(cmd: Command): string {
  return cmd.k === 'dialGrab' ? 'dial hold, any angle' : describeCommand(cmd);
}

interface Effective {
  cmd: Command;
  /** Index of the command's `do` step in the session script. */
  at: number;
}

interface StepMatch {
  /** Script index of each matched step's command, in step order. */
  at: number[];
  /** The first step not found, and whether it was sent but replaced on the same tick. */
  missing: { index: number; replaced: boolean } | null;
  /** The first command on a step's control sent after that control's last step. */
  trailing: { cmd: Command; step: number } | null;
}

/**
 * Match `steps` in order against the session's effective commands after its last connect,
 * disconnect or load. Commands between two time steps all land on the same tick, so of several
 * on one control only the last takes effect: `button 6 down + button 6 up` in one call moves
 * nothing, and its `down` does not count. Each step takes the first qualifying command (a dial
 * hold qualifies for a dial step at any angle; see `stepKey`). After a control's last step, no
 * further command on that control may follow (eleven presses are not "count to three", though
 * they end on the same lamps), except a dial release.
 */
function matchSteps(session: Session, steps: readonly OperateStep[]): StepMatch {
  let start = 0;
  session.script.forEach((step, i) => {
    if (step.k === 'load' || (step.k === 'do' && (step.cmd.k === 'connect' || step.cmd.k === 'disconnect'))) start = i + 1;
  });
  // Effective commands in order: within each run of do steps, the last command per control.
  const effective: Effective[] = [];
  const replaced: Command[][] = [];
  let run: Effective[] = [];
  const flush = (): void => {
    run.forEach((entry, i) => {
      const later = run.slice(i + 1).some((other) => control(other.cmd) === control(entry.cmd));
      if (!later) effective.push(entry);
      else (replaced[effective.length] ??= []).push(entry.cmd);
    });
    run = [];
  };
  for (let i = start; i < session.script.length; i++) {
    const step = session.script[i] as Session['script'][number];
    if (step.k === 'do') run.push({ cmd: step.cmd, at: i });
    else flush();
  }
  flush();

  const at: number[] = [];
  const position: number[] = [];
  let sentButReplaced = false;
  for (let i = 0; i <= effective.length && at.length < steps.length; i++) {
    const wanted = stepKey((steps[at.length] as OperateStep).cmd);
    if ((replaced[i] ?? []).some((cmd) => stepKey(cmd) === wanted)) sentButReplaced = true;
    const entry = effective[i];
    if (entry !== undefined && stepKey(entry.cmd) === wanted) {
      at.push(entry.at);
      position.push(i);
      sentButReplaced = false;
    }
  }
  if (at.length < steps.length) return { at, missing: { index: at.length, replaced: sentButReplaced }, trailing: null };

  // Per control, the effective position of its last step; anything on it later is trailing.
  const last = new Map<string, number>();
  steps.forEach((step, j) => last.set(control(step.cmd), j));
  let trailing: StepMatch['trailing'] = null;
  for (let i = 0; i < effective.length && trailing === null; i++) {
    const cmd = (effective[i] as Effective).cmd;
    // Letting go of the knob is not a further turn (Tom, 2026-11-02); if a wired motor then moves
    // the pointer, the end state catches it.
    if (cmd.k === 'dialRelease') continue;
    const j = last.get(control(cmd));
    if (j !== undefined && i > (position[j] as number)) trailing = { cmd, step: j };
  }
  return { at, missing: null, trailing };
}

function quoted(step: ExpectStep): string {
  return ': "' + step.quote + '"' + (step.tag === 'unverified' ? ' [unverified, derived]' : '');
}

/**
 * A checkpoint: replay the session up to the settle that ends the call holding the step's command,
 * run BASIC_SETTLE_MS more in that copy, and list each observable that differs. The core has no
 * machine copy, so each checkpoint replays its prefix once; the main replay is untouched.
 */
function checkpointLines(session: Session, at: number, expected: ExpectStep): string[] {
  let end = at;
  while (end < session.script.length && (session.script[end] as Session['script'][number]).k !== 'settle') end++;
  const rig = replaySession({ ...session, script: session.script.slice(0, end + 1) });
  return endStateLines(rig, expected.obs).map((line) => line + quoted(expected));
}

function checkOperate(item: OperateItem, session: Session): Outcome {
  const reference = readReference(item.program, session);
  const rig = replaySession(session);
  const wiring = runWiring(item.program, reference, rig, item.extra ?? []);
  if (!wiring.pass) {
    const [first, ...rest] = wiring.lines;
    return { pass: false, lines: ['the cords do not run ' + reference.id + ': ' + first, ...rest] };
  }
  const total = item.steps.length;
  const label = (j: number): string =>
    'step ' + (j + 1) + ' of ' + total + ' (' + describeStep((item.steps[j] as OperateStep).cmd) + ')';
  const match = matchSteps(session, item.steps);
  if (match.missing !== null) {
    return {
      pass: false,
      lines: [label(match.missing.index) + ' not done after the wiring was finished' +
        (match.missing.replaced ? ' (it was sent, but a later command in the same call replaced it before any time passed)' : '')],
    };
  }
  if (match.trailing !== null) {
    return {
      pass: false,
      lines: [describeCommand(match.trailing.cmd) + ' was sent after ' + label(match.trailing.step) + ', the last step on that control'],
    };
  }
  for (let j = 0; j < total; j++) {
    const expected = (item.steps[j] as OperateStep).expect;
    if (expected === undefined) continue;
    const lines = checkpointLines(session, match.at[j] as number, expected);
    if (lines.length > 0) {
      const [first, ...rest] = lines;
      return { pass: false, lines: [label(j) + ' checkpoint: ' + first, ...rest] };
    }
  }
  const lines = endStateLines(rig, item.expect);
  return { pass: lines.length === 0, lines };
}

/** Grade one session against one item. Never throws; errors come back as code 2. */
export function checkItem(item: Item, session: Session): CheckResult {
  try {
    const outcome = item.kind === 'wire' ? checkWire(item, session)
      : item.kind === 'basic' ? checkBasic(item, session) : checkOperate(item, session);
    if (outcome.pass) return { code: 0, stdout: 'PASS ' + item.id + '\n', stderr: '' };
    const [first, ...rest] = outcome.lines;
    const text = 'FAIL ' + item.id + ': ' + first + '\n' + rest.map((line) => '  ' + line + '\n').join('');
    return { code: 1, stdout: text, stderr: '' };
  } catch (error: unknown) {
    return { code: 2, stdout: 'ERROR ' + item.id + ': ' + message(error) + '\n', stderr: '' };
  }
}

export function run(argv: readonly string[]): CheckResult {
  if (argv.length !== 2) {
    return { code: 2, stdout: '', stderr: 'usage: minivac-check <item.json> <session.json>\n' };
  }
  const [itemPath, sessionPath] = argv as [string, string];
  let item: Item;
  try {
    item = readItem(itemPath);
  } catch (error: unknown) {
    return { code: 2, stdout: 'ERROR ' + itemPath + ': ' + message(error) + '\n', stderr: '' };
  }
  let session: Session;
  try {
    session = readSession(sessionPath);
  } catch (error: unknown) {
    return { code: 2, stdout: 'ERROR ' + item.id + ': ' + message(error) + '\n', stderr: '' };
  }
  return checkItem(item, session);
}
