/**
 * The "hands" tool table: one entry per operator action over the core contract, plus a state
 * read, a time step and load-program, and the replay/settle logic that turns a session script
 * into a machine.
 *
 * Adapters (the `minivac-control` CLI today; later an MCP server, an HTTP API or a browser pane)
 * own I/O. This module takes an already-loaded netlist and profile and never touches a
 * filesystem, a process or a clock, so every adapter shares one implementation.
 *
 * Session script steps use the conformance fixture's `do` / `advance` / `settle` shapes. Settle is
 * the conformance runner's rule (`test/conformance/run.ts`, `Execution.settle`), reimplemented
 * here because `Execution` is not exported: one tick at a time, a tick "changed" if any of the 33
 * observables differs from the previous tick, quiet counts ticks with no change and
 * `motionMask() === 0`, settled when quiet reaches `settle_quiet_ticks`.
 */
import { CONTRACT } from '../core/contract.ts';
import type { CmdResult, Command, CordEnd, CordId, HoleId, Machine, State } from '../core/contract.ts';
import { createMachine } from '../core/machine.ts';
import type { LoadedNetlist } from '../core/netlist.ts';
import type { Profile } from '../core/profile.ts';
import { holeAt, parseHoleId, parseTerminalId, parseTerminalWire, TERMINALS, terminalIndex } from '../core/terminals.ts';
import type { TerminalDef, TerminalId } from '../core/terminals.ts';
import { CHATTER_DEVICES, OBSERVABLE_COUNT, OBSERVABLES } from '../core/trace.ts';
import type { ChatterDev } from '../core/contract.ts';
import { DEFAULT_PROFILE_ID } from '../session.ts';

export const SESSION_SCHEMA = 'minivac.session/1';
export const DEFAULT_PROFILE = DEFAULT_PROFILE_ID;
export const DEFAULT_SETTLE_MS = 500;
/** Cap on one `wait` and on one settle, in milliseconds (one minute of simulated time). */
export const MAX_STEP_MS = 60000;
/** Default hold (and release) time of a `press`: long enough for a relay to pull in. */
export const PRESS_MS = 100;
const INT32_MAX = 2147483647;
/** A change path longer than this many transitions is shown as first -> ... -> last. */
export const PATH_LIMIT = 6;
const MAX_CORDS = 256;
/** A conformance fixture id (`minivac.fixture/1` `id` pattern). */
export const PROGRAM_ID = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
/** Dial angles are microdegrees, 0..359,999,999 (contract `dialGrab.targetUdeg`). */
export const DIAL_UDEG_LIMIT = 360_000_000;
/** Observable index of outLamp1; the 6 output then 6 indicator lamps follow it in order. */
const FIRST_LAMP = OBSERVABLES.findIndex((row) => row.name === 'outLamp1');

/**
 * `load` marks a load-program: the `cords` steps right after it are that program's connects.
 * Replay validates it and otherwise treats it as a no-op.
 */
export type SessionStep =
  | { k: 'do'; cmd: Command }
  | { k: 'advance'; ms: number }
  | { k: 'settle'; maxMs: number }
  | { k: 'load'; program: string; cords: number };

export interface Session {
  schema: typeof SESSION_SCHEMA;
  profile: string;
  contract: string;
  /** `snapshot().netlistHash` / `profileHash` when the session was created; replay refuses a mismatch. */
  netlistHash: string;
  profileHash: string;
  script: SessionStep[];
}

export interface CordView {
  id: CordId;
  a: HoleId;
  /** null: this end hangs free, plugged into nothing (`connect M10/free`). */
  b: HoleId | null;
  /** The terminal pair in manual shorthand, e.g. `1+/1Y`; a free end is `free`, e.g. `M10/free`. */
  wire: string;
}

/** A live machine plus the bookkeeping the table needs. Mutable; owned by one caller. */
export interface Rig {
  readonly machine: Machine;
  /** The netlist `machine` was built from; `validateBatch` builds its scratch machine from it. */
  readonly netlist: LoadedNetlist;
  readonly profile: Profile;
  /** Observables after the last tick, for the runner's per-tick "changed" test. */
  readonly previous: Int32Array;
  /** Cords as projected by accepted commands (snapshot().cords only shows them after a tick). */
  readonly cords: (CordView | null)[];
  /** Every accepted step, in order: the session script. */
  readonly log: SessionStep[];
  /** While a batch runs: per observable, the change path seen (bounded). */
  watch: Watch[] | null;
}

/** First values of an observable's change path, its latest value, and how many transitions. */
interface Watch {
  head: number[];
  last: number;
  count: number;
}

export type Why =
  | Extract<CmdResult, { ok: false }>['why']
  | 'ambiguous_cord'
  | 'bad_program';

export type ToolResult =
  | { ok: true; cord?: CordView; cords?: CordView[]; view?: StateView }
  | { ok: false; why: Why; detail: string };

export interface StateView {
  tick: number;
  observables: { name: string; value: string }[];
  cords: CordView[];
  snapshot: State;
}

export interface PowerArgs { on: boolean }
export interface ConnectArgs { a: string; b: string }
/** One cord by id or by its terminal pair, or every plugged cord ({ all: true }). */
export type DisconnectArgs = { cord: number } | { a: string; b: string } | { all: true };
export interface MoverArgs { n: number; target: number }
export interface WaitArgs { ms: number }
/** n, and the hold time; the same time is then left released (default PRESS_MS). */
export interface PressArgs { n: number; ms?: number }
export type StateArgs = Record<string, never>;
export interface BreakerArgs { reset: true }
export interface RelayGrabArgs { n: number; target: number }
export interface RelayReleaseArgs { n: number }
export interface DialGrabArgs { targetUdeg: number }
export type DialReleaseArgs = Record<string, never>;
/** A program id and its wire list; the adapter resolves the id (this module reads no files). */
export interface LoadProgramArgs { program: string; wires: string[] }

export type ToolCall =
  | { name: 'power'; args: PowerArgs }
  | { name: 'connect'; args: ConnectArgs }
  | { name: 'disconnect'; args: DisconnectArgs }
  | { name: 'button'; args: MoverArgs }
| { name: 'press'; args: PressArgs }
  | { name: 'switch'; args: MoverArgs }
  | { name: 'wait'; args: WaitArgs }
  | { name: 'state'; args: StateArgs }
  | { name: 'breaker'; args: BreakerArgs }
  | { name: 'relayGrab'; args: RelayGrabArgs }
  | { name: 'relayRelease'; args: RelayReleaseArgs }
  | { name: 'dialGrab'; args: DialGrabArgs }
  | { name: 'dialRelease'; args: DialReleaseArgs }
  | { name: 'loadProgram'; args: LoadProgramArgs };

export type ToolName = ToolCall['name'];

export interface ToolEntry {
  readonly name: ToolName;
  readonly description: string;
  /** JSON Schema (draft 2020-12) for `args`, derived from `src/core/contract.ts`. */
  readonly schema: Readonly<Record<string, unknown>>;
  readonly handler: (rig: Rig, args: never) => ToolResult;
}

/** Thrown for a session that cannot be replayed: wrong profile/contract or a rejected step. */
export class SessionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionError';
  }
}

// ---------------------------------------------------------------------------------------------
// Rig, ticks and settle

export function createRig(netlist: LoadedNetlist, profile: Profile): Rig {
  if (profile.v.tick_us !== 100) throw new SessionError('profile ' + profile.id + ' needs tick_us=100');
  const machine = createMachine(netlist, profile);
  const previous = new Int32Array(OBSERVABLE_COUNT);
  previous.set(machine.observables());
  return {
    machine,
    netlist,
    profile,
    previous,
    cords: new Array<CordView | null>(MAX_CORDS).fill(null),
    log: [],
    watch: null,
  };
}

function noteObservables(watch: Watch[], current: ArrayLike<number>): void {
  for (let i = 0; i < OBSERVABLE_COUNT; i++) {
    const seen = watch[i] as Watch;
    const value = current[i] as number;
    if (seen.last === value) continue;
    seen.last = value;
    seen.count++;
    if (seen.head.length <= PATH_LIMIT) seen.head.push(value);
  }
}

/** One tick, the runner's `advanceOne`: advance, drain, compare all 33 observables. */
function advanceOne(rig: Rig): boolean {
  rig.machine.advance(1);
  rig.machine.drainEvents();
  const after = rig.machine.observables();
  let changed = false;
  for (let i = 0; i < OBSERVABLE_COUNT; i++) {
    if (rig.previous[i] !== after[i]) changed = true;
  }
  rig.previous.set(after);
  if (rig.watch !== null) noteObservables(rig.watch, after);
  return changed;
}

export interface SettleOutcome {
  settled: boolean;
  waitedTicks: number;
  /** When not settled: relays, pushbuttons and switches still in travel at the cap. */
  moving: ChatterDev[];
  /** When not settled: devices the chatter monitor flags at the cap. */
  chattering: ChatterDev[];
  /**
   * Dial motor speed (milli-rpm) when settle stopped. Settle's rule does not count the dial as
   * motion, so a turning dial can "settle" between two contact changes; adapters should say so.
   */
  dialMrpm: number;
  /** True when the dial is held by hand (dialGrab), so a turning dial is the hand, not the motor. */
  dialHeld: boolean;
  /**
   * Lamps whose filament brightness (snapshot `milli`) changed on the final tick. Settle watches
   * lamp class, not filament temperature (open-questions O-C28), so a lamp can still be cooling
   * through `dim` when settle returns; adapters should say so.
   */
  lampsMoving: string[];
}

function lampMilli(rig: Rig): number[] {
  const state = rig.machine.snapshot();
  return [...state.outLamps, ...state.indLamps].map((lamp) => lamp.milli);
}

function movingLamps(before: readonly number[] | null, rig: Rig): string[] {
  if (before === null) return [];
  const after = lampMilli(rig);
  const out: string[] = [];
  for (let i = 0; i < after.length; i++) {
    if (after[i] !== before[i]) out.push((OBSERVABLES[FIRST_LAMP + i] as (typeof OBSERVABLES)[number]).name);
  }
  return out;
}

/** Run and log one settle step capped at `maxMs`. Callers validate `maxMs` first. */
function settle(rig: Rig, maxMs: number): SettleOutcome {
  const maxTicks = maxMs * 10;
  const quietNeeded = rig.profile.v.settle_quiet_ticks;
  let quiet = 0;
  let waited = 0;
  let lampsBefore: number[] | null = null;
  while (waited < maxTicks && quiet < quietNeeded) {
    // Only a tick that can end the settle needs the pre-tick lamp reading.
    lampsBefore = quiet + 1 >= quietNeeded || waited + 1 === maxTicks ? lampMilli(rig) : null;
    const changed = advanceOne(rig);
    waited++;
    if (!changed && rig.machine.motionMask() === 0) quiet++;
    else quiet = 0;
  }
  rig.log.push({ k: 'settle', maxMs });
  const settled = quiet >= quietNeeded;
  const state = rig.machine.snapshot();
  const mask = rig.machine.motionMask();
  return {
    settled,
    waitedTicks: waited,
    moving: settled ? [] : CHATTER_DEVICES.filter((_, bit) => (mask & (1 << bit)) !== 0),
    chattering: settled ? [] : state.flags.chattering.slice(),
    dialMrpm: state.dial.mrpm,
    dialHeld: state.dial.held,
    lampsMoving: movingLamps(lampsBefore, rig),
  };
}

/** Run and log one advance step of exactly `ms`. Callers validate `ms` first. */
function advanceMs(rig: Rig, ms: number): void {
  for (let i = 0; i < ms * 10; i++) advanceOne(rig);
  rig.log.push({ k: 'advance', ms });
}

function checkMs(ms: unknown, what: string): string | null {
  if (typeof ms !== 'number' || !Number.isInteger(ms) || ms < 1 || ms > MAX_STEP_MS) {
    return what + ' must be an integer number of milliseconds in 1..' + MAX_STEP_MS;
  }
  return null;
}

function tickLimit(tick: number): string {
  return 'the session is at tick ' + tick + '; this would pass the int32 tick limit ' + INT32_MAX +
    '; start a new session';
}

/** One step of `ms` milliseconds: null when valid and within the int32 tick limit, else why. */
function checkStep(rig: Rig, ms: unknown, what: string): string | null {
  const bad = checkMs(ms, what);
  if (bad !== null) return bad;
  const tick = rig.machine.snapshot().tick;
  return tick > INT32_MAX - (ms as number) * 10 ? tickLimit(tick) : null;
}

// ---------------------------------------------------------------------------------------------
// Cords: lowest free hole, lowest unused id, terminal-pair lookup

function liveCords(rig: Rig): CordView[] {
  return rig.cords.filter((cord): cord is CordView => cord !== null);
}

function lowestFreeHole(rig: Rig, terminal: TerminalId, taken: readonly HoleId[]): HoleId | null {
  const def = TERMINALS[terminalIndex(terminal)] as TerminalDef;
  const used = new Set<string>(taken);
  for (const cord of liveCords(rig)) {
    used.add(cord.a);
    if (cord.b !== null) used.add(cord.b);
  }
  for (let hole = 1; hole <= def.holes; hole++) {
    const id = holeAt(terminal, hole).id;
    if (!used.has(id)) return id;
  }
  return null;
}

function cordsOn(rig: Rig, terminal: TerminalId): string {
  const ids = liveCords(rig)
    .filter((cord) => endName(cord.a) === terminal || endName(cord.b) === terminal)
    .map((cord) => String(cord.id));
  return ids.join(', ');
}

/** A cord end as the manual's shorthand writes it: its terminal, or `free`. */
function endName(hole: HoleId | null): string {
  return hole === null ? FREE : parseHoleId(hole).terminal;
}

function wireOf(a: HoleId, b: HoleId | null): string {
  return endName(a) + '/' + endName(b);
}

/** The word for a cord end left hanging, in `connect M10/free`. */
const FREE = 'free';

function isFree(text: string): boolean {
  return text.toLowerCase() === FREE;
}

function reject(why: Why, detail: string): ToolResult {
  return { ok: false, why, detail };
}

function unknownTerminal(text: string): ToolResult {
  return reject('unknown_terminal', JSON.stringify(text) + ' is not a terminal');
}

function terminalMessage(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/^terminals: /, '');
}

function parseTerminal(text: string): TerminalId | null {
  try {
    return parseTerminalId(text);
  } catch {
    return null;
  }
}

/**
 * Parse the manual's `A/B` wire shorthand with `parseTerminalWire`, or reject with its reason. Either
 * side may be `free`, a cord end left hanging; the terminal on the other side is checked when the
 * cord is plugged.
 */
export function parseWire(text: string): ConnectArgs | ToolResult {
  const sides = text.split('/');
  if (sides.length === 2 && sides.some(isFree) && !sides.includes('')) {
    const [a, b] = sides.map((side) => (isFree(side) ? FREE : side)) as [string, string];
    return { a, b };
  }
  try {
    const wire = parseTerminalWire(text);
    return { a: wire[0], b: wire[1] };
  } catch (error: unknown) {
    return reject('unknown_terminal', terminalMessage(error));
  }
}

/** Apply one contract command; on success log it and update the projected cord table. */
function applyCommand(rig: Rig, cmd: Command): CmdResult {
  const result = rig.machine.apply(cmd);
  if (!result.ok) return result;
  if (cmd.k === 'connect' && cmd.a.k === 'hole' && cmd.b.k !== 'touch') {
    const b = cmd.b.k === 'hole' ? cmd.b.hole : null;
    rig.cords[cmd.cord] = { id: cmd.cord, a: cmd.a.hole, b, wire: wireOf(cmd.a.hole, b) };
  } else if (cmd.k === 'disconnect') {
    rig.cords[cmd.cord] = null;
  }
  rig.log.push({ k: 'do', cmd });
  if (rig.watch !== null) noteObservables(rig.watch, rig.machine.observables());
  return result;
}

function commandResult(rig: Rig, cmd: Command, detail: string): ToolResult {
  const result = applyCommand(rig, cmd);
  return result.ok ? { ok: true } : reject(result.why, detail);
}

// ---------------------------------------------------------------------------------------------
// Handlers

function power(rig: Rig, args: PowerArgs): ToolResult {
  return commandResult(rig, { k: 'power', on: args.on }, 'power needs on: true or false');
}

function connect(rig: Rig, args: ConnectArgs): ToolResult {
  if (isFree(args.a) || isFree(args.b)) return connectFree(rig, isFree(args.a) ? args.b : args.a);
  const a = parseTerminal(args.a);
  if (a === null) return unknownTerminal(args.a);
  const b = parseTerminal(args.b);
  if (b === null) return unknownTerminal(args.b);

  const aHole = lowestFreeHole(rig, a, []);
  if (aHole === null) {
    return reject('hole_occupied', 'every hole of ' + a + ' is in use (cords ' + cordsOn(rig, a) + ')');
  }
  const bHole = lowestFreeHole(rig, b, [aHole]);
  if (bHole === null) {
    if (a === b) {
      const others = cordsOn(rig, a);
      return reject('hole_occupied', 'connecting ' + a + ' to itself needs two free holes on ' + a +
        '; only one is free' + (others === '' ? '' : ' (cords ' + others + ' use the rest)'));
    }
    return reject('hole_occupied', 'every hole of ' + b + ' is in use (cords ' + cordsOn(rig, b) + ')');
  }
  const id = rig.cords.indexOf(null);
  if (id < 0) return reject('bad_cord_id', 'all ' + MAX_CORDS + ' cord ids 0..255 are in use');

  const cmd: Command = { k: 'connect', cord: id, a: { k: 'hole', hole: aHole }, b: { k: 'hole', hole: bHole } };
  const result = commandResult(rig, cmd, 'connect ' + a + '/' + b + ' rejected by the machine');
  return result.ok ? { ...result, cord: rig.cords[id] as CordView } : result;
}

/** A cord plugged into `terminal` at one end, its other end hanging free (tic-tac-toe's move leads). */
function connectFree(rig: Rig, terminal: string): ToolResult {
  if (isFree(terminal)) return reject('unknown_terminal', 'a cord needs a terminal at one end at least: connect <A>/free');
  const a = parseTerminal(terminal);
  if (a === null) return unknownTerminal(terminal);
  const aHole = lowestFreeHole(rig, a, []);
  if (aHole === null) return reject('hole_occupied', 'every hole of ' + a + ' is in use (cords ' + cordsOn(rig, a) + ')');
  const id = rig.cords.indexOf(null);
  if (id < 0) return reject('bad_cord_id', 'all ' + MAX_CORDS + ' cord ids 0..255 are in use');
  const cmd: Command = { k: 'connect', cord: id, a: { k: 'hole', hole: aHole }, b: { k: 'free' } };
  const result = commandResult(rig, cmd, 'connect ' + a + '/' + FREE + ' rejected by the machine');
  return result.ok ? { ...result, cord: rig.cords[id] as CordView } : result;
}

function disconnect(rig: Rig, args: DisconnectArgs): ToolResult {
  if ('all' in args) {
    for (const cord of liveCords(rig)) {
      const result = commandResult(rig, { k: 'disconnect', cord: cord.id }, 'no cord ' + cord.id + ' is plugged in');
      if (!result.ok) return result;
    }
    return { ok: true };
  }
  if ('cord' in args) {
    return commandResult(rig, { k: 'disconnect', cord: args.cord }, 'no cord ' + args.cord + ' is plugged in');
  }
  const a = isFree(args.a) ? FREE : parseTerminal(args.a);
  if (a === null) return unknownTerminal(args.a);
  const b = isFree(args.b) ? FREE : parseTerminal(args.b);
  if (b === null) return unknownTerminal(args.b);
  const matches = liveCords(rig).filter((cord) => {
    const ta = endName(cord.a);
    const tb = endName(cord.b);
    return (ta === a && tb === b) || (ta === b && tb === a);
  });
  if (matches.length === 0) return reject('unknown_cord', 'no cord runs between ' + a + ' and ' + b);
  if (matches.length > 1) {
    return reject('ambiguous_cord', 'cords ' + matches.map((cord) => cord.id).join(', ') +
      ' all run between ' + a + ' and ' + b + '; disconnect one by id');
  }
  const cord = (matches[0] as CordView).id;
  return commandResult(rig, { k: 'disconnect', cord }, 'no cord ' + cord + ' is plugged in');
}

function button(rig: Rig, args: MoverArgs): ToolResult {
  return commandResult(rig, { k: 'button', n: args.n as 1, target: args.target },
    'button needs n in 1..6 and target an integer 0..1000');
}

// A pushbutton springs back on the real machine: a press is down, held, up, then the same time
// released, so presses sent back to back in one batch are each seen.
function press(rig: Rig, args: PressArgs): ToolResult {
  const ms = args.ms ?? PRESS_MS;
  if (!Number.isInteger(args.n) || args.n < 1 || args.n > 6) return reject('bad_target', 'press needs n in 1..6');
  const bad = checkStep(rig, ms, 'press time') ?? checkStep(rig, ms * 2, 'press time');
  if (bad !== null) return reject('bad_target', bad);
  const down = commandResult(rig, { k: 'button', n: args.n as 1, target: 1000 }, 'press needs n in 1..6');
  if (!down.ok) return down;
  advanceMs(rig, ms);
  const up = commandResult(rig, { k: 'button', n: args.n as 1, target: 0 }, 'press needs n in 1..6');
  if (!up.ok) return up;
  advanceMs(rig, ms);
  return { ok: true };
}

function slideSwitch(rig: Rig, args: MoverArgs): ToolResult {
  return commandResult(rig, { k: 'switch', n: args.n as 1, target: args.target },
    'switch needs n in 1..6 and target an integer 0..1000');
}

function breaker(rig: Rig, args: BreakerArgs): ToolResult {
  return commandResult(rig, { k: 'breaker', reset: args.reset }, 'breaker needs reset: true');
}

function relayGrab(rig: Rig, args: RelayGrabArgs): ToolResult {
  return commandResult(rig, { k: 'relayGrab', n: args.n as 1, target: args.target },
    'relayGrab needs n in 1..6 and target an integer 0..1000');
}

function relayRelease(rig: Rig, args: RelayReleaseArgs): ToolResult {
  return commandResult(rig, { k: 'relayRelease', n: args.n as 1 }, 'relayRelease needs n in 1..6');
}

function dialGrab(rig: Rig, args: DialGrabArgs): ToolResult {
  return commandResult(rig, { k: 'dialGrab', targetUdeg: args.targetUdeg },
    'dialGrab needs targetUdeg an integer 0..' + (DIAL_UDEG_LIMIT - 1));
}

function dialRelease(rig: Rig): ToolResult {
  return commandResult(rig, { k: 'dialRelease' }, 'dialRelease rejected by the machine');
}

/**
 * Plug every wire of a program, each as `connect` would (lowest free holes, lowest free id).
 * All holes and ids are planned before anything is applied, so a wire that cannot be placed
 * rejects the whole load with nothing plugged. Once all connects are applied, a `load` marker is
 * inserted in the log just before them.
 */
function loadProgram(rig: Rig, args: LoadProgramArgs): ToolResult {
  const name = JSON.stringify(args.program);
  if (typeof args.program !== 'string' || !PROGRAM_ID.test(args.program)) {
    return reject('bad_program', name + ' is not a program id');
  }
  if (!Array.isArray(args.wires) || args.wires.length === 0 || args.wires.length > MAX_CORDS) {
    return reject('bad_program', 'program ' + args.program + ' needs 1..' + MAX_CORDS + ' wires');
  }
  const taken: HoleId[] = [];
  const ids: number[] = [];
  const planned: Command[] = [];
  for (let i = 0; i < args.wires.length; i++) {
    const text = args.wires[i] as string;
    const where = 'load-program ' + args.program + ': wire ' + (i + 1) + ' (' + text + ')';
    const wire = parseWire(text);
    if ('ok' in wire) {
      const bad = wire as Extract<ToolResult, { ok: false }>;
      return reject(bad.why, where + ': ' + bad.detail);
    }
    const a = parseTerminal(wire.a) as TerminalId;
    const b = parseTerminal(wire.b) as TerminalId;
    const aHole = lowestFreeHole(rig, a, taken);
    const bHole = aHole === null ? null : lowestFreeHole(rig, b, [...taken, aHole]);
    if (aHole === null || bHole === null) {
      const full = aHole === null ? a : b;
      const others = cordsOn(rig, full);
      return reject('hole_occupied', where + ' cannot be placed: every hole of ' + full + ' is in use' +
        (others === '' ? ' by earlier wires of this program' : ' (cords ' + others + ', and earlier wires of this program)') +
        '; nothing was plugged');
    }
    let id = 0;
    while (id < MAX_CORDS && (rig.cords[id] !== null || ids.includes(id))) id++;
    if (id === MAX_CORDS) return reject('bad_cord_id', where + ': all ' + MAX_CORDS + ' cord ids 0..255 are in use; nothing was plugged');
    taken.push(aHole, bHole);
    ids.push(id);
    planned.push({ k: 'connect', cord: id, a: { k: 'hole', hole: aHole }, b: { k: 'hole', hole: bHole } });
  }
  const markerAt = rig.log.length;
  const cords: CordView[] = [];
  for (const cmd of planned) {
    const result = applyCommand(rig, cmd);
    if (!result.ok) return reject(result.why, 'load-program ' + args.program + ' rejected by the machine');
    cords.push(rig.cords[(cmd as Extract<Command, { k: 'connect' }>).cord] as CordView);
  }
  // Only once every connect is in: a marker always has exactly its `cords` connects behind it.
  rig.log.splice(markerAt, 0, { k: 'load', program: args.program, cords: planned.length });
  return { ok: true, cords };
}

function wait(rig: Rig, args: WaitArgs): ToolResult {
  const bad = checkStep(rig, args.ms, 'wait');
  if (bad !== null) return reject('bad_target', bad);
  advanceMs(rig, args.ms);
  return { ok: true };
}

export function stateView(rig: Rig): StateView {
  const current = rig.machine.observables();
  const observables: StateView['observables'] = [];
  for (let i = 0; i < OBSERVABLE_COUNT; i++) {
    observables.push({ name: (OBSERVABLES[i] as (typeof OBSERVABLES)[number]).name, value: observableText(i, current[i] as number) });
  }
  const snapshot = rig.machine.snapshot();
  return { tick: snapshot.tick, observables, cords: liveCords(rig), snapshot };
}

function state(rig: Rig): ToolResult {
  return { ok: true, view: stateView(rig) };
}

export function observableText(index: number, encoded: number): string {
  const row = OBSERVABLES[index] as (typeof OBSERVABLES)[number];
  return row.values[encoded - row.minValue] ?? String(encoded);
}

// ---------------------------------------------------------------------------------------------
// The table

const SECT = { type: 'integer', minimum: 1, maximum: 6 } as const;
const TRAVEL = { type: 'integer', minimum: 0, maximum: 1000 } as const;
const CORD_END = {
  type: 'string', minLength: 1, description: 'Panel terminal designator, e.g. 1+, 1Y, 2A, D16, or free for an end left hanging',
} as const;

export const TOOL_TABLE: readonly ToolEntry[] = Object.freeze([
  {
    name: 'power',
    description: 'Switch the main power on or off (contract command power).',
    schema: {
      type: 'object', additionalProperties: false, required: ['on'],
      properties: { on: { type: 'boolean' } },
    },
    handler: power,
  },
  {
    name: 'connect',
    description: 'Plug a patch cord between two terminals, or into one terminal with its other end free. ' +
      'Uses the lowest free hole on each terminal and the lowest unused cord id; returns the cord id and holes ' +
      '(contract command connect, hole ends, or a hole and a free end).',
    schema: {
      type: 'object', additionalProperties: false, required: ['a', 'b'],
      properties: { a: CORD_END, b: CORD_END },
    },
    handler: connect,
  },
  {
    name: 'disconnect',
    description: 'Unplug a cord, by cord id or by the terminal pair it joins, or every plugged cord with ' +
      'all: true (contract command disconnect, once per cord).',
    schema: {
      oneOf: [
        {
          type: 'object', additionalProperties: false, required: ['all'],
          properties: { all: { const: true } },
        },
        {
          type: 'object', additionalProperties: false, required: ['cord'],
          properties: { cord: { type: 'integer', minimum: 0, maximum: 255 } },
        },
        {
          type: 'object', additionalProperties: false, required: ['a', 'b'],
          properties: { a: CORD_END, b: CORD_END },
        },
      ],
    },
    handler: disconnect,
  },
  {
    name: 'button',
    description: 'Move pushbutton n to a travel target: 1000 = pressed, 0 = released (contract command button).',
    schema: {
      type: 'object', additionalProperties: false, required: ['n', 'target'],
      properties: { n: SECT, target: TRAVEL },
    },
    handler: button,
  },
  {
    name: 'press',
    description: 'Press pushbutton n the way a finger does: down, held ms (default ' + PRESS_MS + '), up, then ' +
      'released for the same time. The log records it as button down, wait, button up, wait.',
    schema: {
      type: 'object', additionalProperties: false, required: ['n'],
      properties: { n: SECT, ms: { type: 'integer', minimum: 1, maximum: MAX_STEP_MS / 2 } },
    },
    handler: press,
  },
  {
    name: 'switch',
    description: 'Move slide switch n: 0 = LEFT, 1000 = RIGHT (contract command switch).',
    schema: {
      type: 'object', additionalProperties: false, required: ['n', 'target'],
      properties: { n: SECT, target: TRAVEL },
    },
    handler: slideSwitch,
  },
  {
    name: 'wait',
    description: 'Let simulated time pass: advance exactly ms milliseconds (fixture advance step).',
    schema: {
      type: 'object', additionalProperties: false, required: ['ms'],
      properties: { ms: { type: 'integer', minimum: 1, maximum: MAX_STEP_MS } },
    },
    handler: wait,
  },
  {
    name: 'state',
    description: 'Read the 33 observables, the plugged cords and the full snapshot. Changes nothing.',
    schema: { type: 'object', additionalProperties: false, properties: {} },
    handler: state,
  },
  {
    name: 'breaker',
    description: 'Reset the circuit breaker after an overload tripped it (contract command breaker). ' +
      'Accepted, and a no-op, when the breaker is not tripped.',
    schema: {
      type: 'object', additionalProperties: false, required: ['reset'],
      properties: { reset: { const: true } },
    },
    handler: breaker,
  },
  {
    name: 'relayGrab',
    description: 'Hold relay n\'s crossbar by hand at a travel target: 1000 = pulled in, 0 = released. ' +
      'The hand keeps it there, against the coil, until relayRelease (contract command relayGrab).',
    schema: {
      type: 'object', additionalProperties: false, required: ['n', 'target'],
      properties: { n: SECT, target: TRAVEL },
    },
    handler: relayGrab,
  },
  {
    name: 'relayRelease',
    description: 'Let go of relay n: its coil controls it again (contract command relayRelease).',
    schema: {
      type: 'object', additionalProperties: false, required: ['n'],
      properties: { n: SECT },
    },
    handler: relayRelease,
  },
  {
    name: 'dialGrab',
    description: 'Turn the rotary dial by hand to an angle in microdegrees and hold it there; the wiper ' +
      'sweeps every pad on the way (contract command dialGrab). Position k is centred on k * 22,500,000 plus the profile wiper offset.',
    schema: {
      type: 'object', additionalProperties: false, required: ['targetUdeg'],
      properties: { targetUdeg: { type: 'integer', minimum: 0, maximum: DIAL_UDEG_LIMIT - 1 } },
    },
    handler: dialGrab,
  },
  {
    name: 'dialRelease',
    description: 'Let go of the dial knob: the motor controls it again (contract command dialRelease).',
    schema: { type: 'object', additionalProperties: false, properties: {} },
    handler: dialRelease,
  },
  {
    name: 'loadProgram',
    description: 'Plug in every wire of a program, as connect would, in one step: wiring only, no power ' +
      'or presses. The adapter resolves the program id to its conformance fixture wire list. Atomic: a ' +
      'wire that cannot be placed plugs nothing. Logged as a load marker before the connects.',
    schema: {
      type: 'object', additionalProperties: false, required: ['program', 'wires'],
      properties: {
        program: { type: 'string', pattern: PROGRAM_ID.source },
        wires: { type: 'array', minItems: 1, maxItems: MAX_CORDS, items: { type: 'string', pattern: '^[^/]+/[^/]+$' } },
      },
    },
    handler: loadProgram,
  },
] satisfies ToolEntry[]);

export function callTool(rig: Rig, call: ToolCall): ToolResult {
  const entry = TOOL_TABLE.find((row) => row.name === call.name);
  if (entry === undefined) throw new Error('hands: no tool ' + JSON.stringify(call.name));
  return (entry.handler as (rig: Rig, args: unknown) => ToolResult)(rig, call.args);
}

// ---------------------------------------------------------------------------------------------
// Batches and replay

export interface Change {
  name: string;
  /**
   * Values in the order seen, first = before the call, last = after it. When `transitions`
   * exceeds PATH_LIMIT only the first and last values are kept and `elided` is true.
   */
  values: string[];
  transitions: number;
  elided: boolean;
}

export type BatchOutcome =
  | {
      ok: true;
      results: ToolResult[];
      settle: SettleOutcome;
      changes: Change[];
    }
  | BatchRejection;

/** `failedAt` indexes `calls`; `failedAt === calls.length` means the settle step was refused. */
export interface BatchRejection { ok: false; failedAt: number; result: Extract<ToolResult, { ok: false }> }

/**
 * Validate every time step of a batch once, up front, before simulating anything: each wait and
 * press time and the settle cap, and their total against the int32 tick limit (a power-on may
 * restart the epoch; ignoring that is safe). Reads only the machine's tick.
 */
function refuseTime(rig: Rig, calls: readonly ToolCall[], settleMs: number): BatchRejection | null {
  const startTick = rig.machine.snapshot().tick;
  let budget = 0;
  const refuse = (failedAt: number, detail: string): BatchRejection =>
    ({ ok: false, failedAt, result: { ok: false, why: 'bad_target', detail } });
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i] as ToolCall;
    if (call.name !== 'wait' && call.name !== 'press') continue;
    const ms = call.name === 'wait' ? call.args.ms : call.args.ms ?? PRESS_MS;
    const bad = checkMs(ms, call.name === 'wait' ? 'wait' : 'press time');
    if (bad !== null) return refuse(i, bad);
    budget += (call.name === 'wait' ? ms : ms * 2) * 10;
    if (startTick > INT32_MAX - budget) return refuse(i, tickLimit(startTick));
  }
  const badSettle = checkMs(settleMs, 'settle cap');
  if (badSettle !== null) return refuse(calls.length, badSettle);
  budget += settleMs * 10;
  if (startTick > INT32_MAX - budget) return refuse(calls.length, tickLimit(startTick));
  return null;
}

/**
 * Apply calls in order, stop at the first rejection, then run one capped settle. On failure the
 * rig has been partly mutated: callers that need atomicity discard it (the CLI rebuilds from the
 * session file on every call and writes nothing) or check `validateBatch` first (the pane).
 */
export function runBatch(rig: Rig, calls: readonly ToolCall[], settleMs = DEFAULT_SETTLE_MS): BatchOutcome {
  const refused = refuseTime(rig, calls, settleMs);
  if (refused !== null) return refused;

  const before = rig.machine.observables();
  rig.watch = [];
  for (let i = 0; i < OBSERVABLE_COUNT; i++) {
    rig.watch.push({ head: [before[i] as number], last: before[i] as number, count: 0 });
  }
  try {
    const results: ToolResult[] = [];
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i] as ToolCall;
      // Waits were validated above; run them directly rather than re-checking in the handler.
      let result: ToolResult = { ok: true };
      if (call.name === 'wait') advanceMs(rig, call.args.ms);
      else result = callTool(rig, call);
      if (!result.ok) return { ok: false, failedAt: i, result };
      results.push(result);
    }
    const outcome = settle(rig, settleMs);
    const changes: Change[] = [];
    for (let i = 0; i < OBSERVABLE_COUNT; i++) {
      const seen = rig.watch[i] as Watch;
      if (seen.count === 0) continue;
      const elided = seen.count > PATH_LIMIT;
      const path = elided ? [seen.head[0] as number, seen.last] : seen.head;
      changes.push({
        name: (OBSERVABLES[i] as (typeof OBSERVABLES)[number]).name,
        values: path.map((value) => observableText(i, value)),
        transitions: seen.count,
        elided,
      });
    }
    return { ok: true, results, settle: outcome, changes };
  } finally {
    rig.watch = null;
  }
}

/**
 * Whether `runBatch(rig, calls, settleMs)` would reject, answered without touching `rig` or its
 * machine. A rejection comes back exactly as runBatch would report it (same `failedAt`, `why`
 * and `detail`), so a caller that cannot discard its rig (the pane) keeps "a rejected batch
 * changes nothing" by validating first.
 *
 * Every rejection is a static argument check, a lookup in the plugged-cord table, or the up-front
 * time check against the machine's tick: no handler or `Machine.apply` rejection reads breaker,
 * relay, lamp, dial or any other time-evolved state. So the time check runs on the live tick
 * (read only), then the calls run on a scratch rig with the live cords (same ids, same holes)
 * whose clock never moves; waits are skipped there, as runBatch skips their handler. A press's
 * own tick check cannot fire once the up-front check has passed (that check counts the press's
 * full down-and-up time), so the scratch tick of 0 gives the same answer.
 *
 * Assumes, as every rig built by createRig or replay and driven through this table satisfies,
 * that `rig.cords` is the machine's whole cord table. A call that makes runBatch throw (an
 * unknown tool, malformed args) throws the same error here.
 */
export function validateBatch(rig: Rig, calls: readonly ToolCall[], settleMs = DEFAULT_SETTLE_MS): { ok: true } | BatchRejection {
  const refused = refuseTime(rig, calls, settleMs);
  if (refused !== null) return refused;
  const scratch = scratchRig(rig);
  for (let i = 0; i < calls.length; i++) {
    const call = calls[i] as ToolCall;
    if (call.name === 'wait') continue;
    const result = callTool(scratch, call);
    if (!result.ok) return { ok: false, failedAt: i, result };
  }
  return { ok: true };
}

/** A fresh machine holding `rig`'s cords under a rig whose clock never moves. */
function scratchRig(rig: Rig): Rig {
  const real = createMachine(rig.netlist, rig.profile);
  for (const cord of liveCords(rig)) {
    const b: CordEnd = cord.b === null ? { k: 'free' } : { k: 'hole', hole: cord.b };
    const placed = real.apply({ k: 'connect', cord: cord.id, a: { k: 'hole', hole: cord.a }, b });
    if (!placed.ok) throw new Error('hands: live cord ' + cord.id + ' cannot be mirrored: ' + placed.why);
  }
  // With no tick, queued commands never reach the observables, so one reading serves every call.
  const still = real.observables().slice();
  const machine: Machine = {
    apply: (cmd) => real.apply(cmd),
    advance: () => undefined,
    snapshot: () => real.snapshot(),
    observables: () => still,
    motionMask: () => real.motionMask(),
    drainEvents: () => real.drainEvents(),
  };
  return {
    machine,
    netlist: rig.netlist,
    profile: rig.profile,
    previous: still.slice(),
    cords: rig.cords.slice(),
    log: [],
    watch: null,
  };
}


/** An empty session bound to this netlist and profile by their snapshot hashes. */
export function newSession(netlist: LoadedNetlist, profile: Profile): Session {
  const state = createRig(netlist, profile).machine.snapshot();
  return {
    schema: SESSION_SCHEMA, profile: profile.id, contract: CONTRACT,
    netlistHash: state.netlistHash, profileHash: state.profileHash, script: [],
  };
}

export function sessionOf(rig: Rig, base: Session): Session {
  return { ...base, script: rig.log.slice() };
}

function corrupt(index: number, message: string): never {
  throw new SessionError('corrupt session: script[' + index + '] ' + message);
}

/** Rebuild a machine from scratch by replaying every step. Throws SessionError on any rejection. */
export function replay(netlist: LoadedNetlist, profile: Profile, session: Session): Rig {
  if (session.schema !== SESSION_SCHEMA) throw new SessionError('corrupt session: schema is not ' + SESSION_SCHEMA);
  if (session.profile !== profile.id) {
    throw new SessionError('corrupt session: profile ' + JSON.stringify(session.profile) + ' but loaded ' + profile.id);
  }
  if (session.contract !== CONTRACT) {
    throw new SessionError('corrupt session: contract ' + JSON.stringify(session.contract) + ', this build is ' + CONTRACT);
  }
  const rig = createRig(netlist, profile);
  const state = rig.machine.snapshot();
  if (session.netlistHash !== state.netlistHash) {
    throw new SessionError('session was recorded against a different netlist (' + session.netlistHash +
      ', loaded ' + state.netlistHash + '); start a new session');
  }
  if (session.profileHash !== state.profileHash) {
    throw new SessionError('session was recorded against a different profile ' + session.profile + ' (' +
      session.profileHash + ', loaded ' + state.profileHash + '); start a new session');
  }
  for (let i = 0; i < session.script.length; i++) {
    const step = session.script[i] as SessionStep;
    if (step.k === 'do') {
      const cmd = step.cmd;
      if ('collapse' in step) corrupt(i, 'collapse is a fixture-only field');
      if (cmd.k === 'connect') {
        if (cmd.a.k !== 'hole' || (cmd.b.k !== 'hole' && cmd.b.k !== 'free') || cmd.r_uohm !== undefined) {
          corrupt(i, 'connect must be hole to hole, or hole to free, with no r_uohm');
        }
      }
      const result = applyCommand(rig, cmd);
      if (!result.ok) corrupt(i, cmd.k + ' was rejected on replay: ' + result.why);
    } else if (step.k === 'advance') {
      const bad = checkStep(rig, step.ms, 'advance');
      if (bad !== null) corrupt(i, bad);
      advanceMs(rig, step.ms);
    } else if (step.k === 'settle') {
      const bad = checkStep(rig, step.maxMs, 'settle');
      if (bad !== null) corrupt(i, bad);
      settle(rig, step.maxMs);
    } else if (step.k === 'load') {
      if (typeof step.program !== 'string' || !PROGRAM_ID.test(step.program)) corrupt(i, 'load program is not a program id');
      if (!Number.isInteger(step.cords) || step.cords < 1 || step.cords > MAX_CORDS) corrupt(i, 'load cords must be in 1..' + MAX_CORDS);
      for (let j = i + 1; j <= i + step.cords; j++) {
        const next = session.script[j];
        if (next === undefined || next.k !== 'do' || next.cmd.k !== 'connect') {
          corrupt(i, 'load of ' + step.program + ' must be followed by its ' + step.cords + ' connect steps');
        }
      }
      rig.log.push({ k: 'load', program: step.program, cords: step.cords });
    } else {
      corrupt(i, 'unknown step kind');
    }
  }
  return rig;
}
