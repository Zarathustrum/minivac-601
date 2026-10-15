import type { Command, CordEnd, Sect } from './core/contract.ts';
import type { LoadedNetlist } from './core/netlist.ts';
import {
  HOLE_PREFIXES,
  holeAt,
  parseHoleId,
  parseTerminalId,
  terminalAt,
  terminalIndex,
} from './core/terminals.ts';
import type { HoleRef, TerminalId } from './core/terminals.ts';

export const DEMO_LIBRARY_SCHEMA = 'minivac.demo-library/1';

/** Demo id reserved by `src/main.ts` for the blank manual session; no library record may claim it. */
export const MANUAL_SESSION_ID = 'MANUAL';

export type DemoCategory =
  | 'counter' | 'game' | 'comparison' | 'random' | 'logic' | 'alarm' | 'memory'
  | 'control' | 'lock' | 'code' | 'arithmetic';
export type DemoConfidence = 'verified' | 'likely' | 'unverified';

export interface DemoSource {
  readonly program: string;
  readonly locator: string;
  readonly confidence: DemoConfidence;
  readonly errata: readonly string[];
  readonly fallbacks: readonly string[];
}

export interface DemoInitial {
  readonly power: boolean;
  readonly switches: readonly number[];
  readonly buttons: readonly number[];
  readonly relayHands: readonly (number | null)[];
  readonly dialHand: number | null;
}

export interface DemoConnection {
  readonly wire: string;
  readonly a: CordEnd;
  readonly b: CordEnd;
  readonly r_uohm?: number;
}

export interface Demo {
  readonly id: string;
  readonly title: string;
  readonly category: DemoCategory;
  readonly source: DemoSource;
  readonly connections: readonly DemoConnection[];
  readonly initial: DemoInitial;
  readonly instructions: readonly string[];
  readonly controlLabels: Readonly<Record<string, string>>;
  readonly notice?: string;
  /** Canonical initialization order: cords, switches, buttons, relay hands, dial, then power. */
  readonly commands: readonly Command[];
}

export interface DemoLibrary {
  readonly schema: typeof DEMO_LIBRARY_SCHEMA;
  readonly demos: readonly Demo[];
}

type ParsedEnd =
  | { readonly k: 'free' }
  | { readonly k: 'terminal'; readonly terminal: TerminalId }
  | { readonly k: 'hole'; readonly hole: HoleRef };

interface ParsedConnection {
  readonly wire: string;
  readonly a: ParsedEnd;
  readonly b: ParsedEnd;
  readonly r_uohm?: number;
}

const DEMO_KEYS = [
  'id', 'title', 'category', 'source', 'connections', 'initial', 'instructions', 'controlLabels',
  'notice',
] as const;
const SOURCE_KEYS = ['program', 'locator', 'confidence', 'errata', 'fallbacks'] as const;
const INITIAL_KEYS = ['power', 'switches', 'buttons', 'relayHands', 'dialHand'] as const;
const CATEGORIES = new Set<DemoCategory>([
  'counter', 'game', 'comparison', 'random', 'logic', 'alarm', 'memory', 'control', 'lock', 'code',
  'arithmetic',
]);
const CONFIDENCES = new Set<DemoConfidence>(['verified', 'likely', 'unverified']);
const CONTROL_KEY = /^(?:(?:button|switch|relay)[1-6]|dial|power)$/u;
const FALLBACK = /^FALLBACK-[A-Z0-9]+(?:-[A-Z0-9]+)*$/u;
const MAX_CORDS = 256;
const HOLE_COUNT = HOLE_PREFIXES[HOLE_PREFIXES.length - 1] as number;

function fail(message: string): never {
  throw new Error('demo library: ' + message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function object(value: unknown, where: string): Record<string, unknown> {
  if (!isObject(value)) fail(where + ' must be an object');
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(where + ' has unknown key ' + JSON.stringify(key));
  }
}

function required(value: Record<string, unknown>, key: string, where: string): unknown {
  if (!Object.hasOwn(value, key)) fail(where + ' is missing ' + JSON.stringify(key));
  return value[key];
}

function nonEmptyString(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(where + ' must be a non-empty string');
  return value;
}

function integer(value: unknown, minimum: number, maximum: number, where: string): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    fail(where + ' must be an integer in ' + minimum + '..' + maximum);
  }
  return value as number;
}

function stringArray(value: unknown, where: string, minimum: number, unique: boolean): readonly string[] {
  if (!Array.isArray(value) || value.length < minimum) {
    fail(where + ' must contain at least ' + minimum + ' string' + (minimum === 1 ? '' : 's'));
  }
  const out = value.map((entry, index) => nonEmptyString(entry, where + '[' + index + ']'));
  if (unique && new Set(out).size !== out.length) fail(where + ' must not contain duplicates');
  return Object.freeze(out);
}

function sixTargets(value: unknown, where: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 6) fail(where + ' must contain exactly six targets');
  return Object.freeze(value.map((entry, index) => integer(entry, 0, 1000, where + '[' + index + ']')));
}

function loadSource(value: unknown, where: string): DemoSource {
  const raw = object(value, where);
  exactKeys(raw, SOURCE_KEYS, where);
  const confidence = required(raw, 'confidence', where);
  if (typeof confidence !== 'string' || !CONFIDENCES.has(confidence as DemoConfidence)) {
    fail(where + '.confidence is not a recognized confidence');
  }
  const fallbacks = stringArray(required(raw, 'fallbacks', where), where + '.fallbacks', 0, true);
  for (let i = 0; i < fallbacks.length; i++) {
    if (!FALLBACK.test(fallbacks[i] as string)) fail(where + '.fallbacks[' + i + '] is not a fallback id');
  }
  return Object.freeze({
    program: nonEmptyString(required(raw, 'program', where), where + '.program'),
    locator: nonEmptyString(required(raw, 'locator', where), where + '.locator'),
    confidence: confidence as DemoConfidence,
    errata: stringArray(required(raw, 'errata', where), where + '.errata', 0, true),
    fallbacks,
  });
}

function loadInitial(value: unknown, where: string): DemoInitial {
  const raw = object(value, where);
  exactKeys(raw, INITIAL_KEYS, where);
  const power = required(raw, 'power', where);
  if (typeof power !== 'boolean') fail(where + '.power must be a boolean');

  const relayValue = required(raw, 'relayHands', where);
  if (!Array.isArray(relayValue) || relayValue.length !== 6) {
    fail(where + '.relayHands must contain exactly six entries');
  }
  const relayHands = relayValue.map((entry, index) => entry === null
    ? null
    : integer(entry, 0, 1000, where + '.relayHands[' + index + ']'));
  const dialValue = required(raw, 'dialHand', where);
  const dialHand = dialValue === null
    ? null
    : integer(dialValue, 0, 359_999_999, where + '.dialHand');

  return Object.freeze({
    power,
    switches: sixTargets(required(raw, 'switches', where), where + '.switches'),
    buttons: sixTargets(required(raw, 'buttons', where), where + '.buttons'),
    relayHands: Object.freeze(relayHands),
    dialHand,
  });
}

function parseEnd(text: string, where: string): ParsedEnd {
  if (text === 'free') return Object.freeze({ k: 'free' });
  try {
    if (text.includes('#')) return Object.freeze({ k: 'hole', hole: parseHoleId(text) });
    return Object.freeze({ k: 'terminal', terminal: parseTerminalId(text) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    fail(where + ' is invalid: ' + message);
  }
}

function parseConnection(value: unknown, where: string): ParsedConnection {
  let wire: string;
  let resistance: number | undefined;
  if (typeof value === 'string') {
    wire = value;
  } else {
    const raw = object(value, where);
    exactKeys(raw, ['wire', 'r_uohm'], where);
    wire = nonEmptyString(required(raw, 'wire', where), where + '.wire');
    resistance = integer(required(raw, 'r_uohm', where), 0, 2_147_483_647, where + '.r_uohm');
  }

  const slash = wire.indexOf('/');
  if (slash <= 0 || slash !== wire.lastIndexOf('/') || slash === wire.length - 1) {
    fail(where + '.wire must contain exactly two endpoints');
  }
  const a = parseEnd(wire.slice(0, slash), where + '.a');
  const b = parseEnd(wire.slice(slash + 1), where + '.b');
  if (a.k === 'free' && b.k === 'free') fail(where + ' cannot have two free ends');
  const common = { wire, a, b };
  return resistance === undefined
    ? Object.freeze(common)
    : Object.freeze({ ...common, r_uohm: resistance });
}

function reserveExact(end: ParsedEnd, occupied: Uint8Array, where: string): void {
  if (end.k !== 'hole') return;
  if ((occupied[end.hole.index] as number) !== 0) fail(where + ' uses occupied hole ' + end.hole.id);
  occupied[end.hole.index] = 1;
}

function allocateEnd(end: ParsedEnd, occupied: Uint8Array, where: string): CordEnd {
  if (end.k === 'free') return Object.freeze({ k: 'free' });
  if (end.k === 'hole') return Object.freeze({ k: 'hole', hole: end.hole.id });

  const def = terminalAt(terminalIndex(end.terminal));
  for (let number = 1; number <= def.holes; number++) {
    const hole = holeAt(end.terminal, number);
    if ((occupied[hole.index] as number) !== 0) continue;
    occupied[hole.index] = 1;
    return Object.freeze({ k: 'hole', hole: hole.id });
  }
  fail(where + ' terminal ' + end.terminal + ' has no free hole');
}

function terminalOf(end: CordEnd): TerminalId | null {
  return end.k === 'hole' ? parseHoleId(end.hole).terminal : null;
}

function isDirectRailShort(
  connection: DemoConnection,
  plus: ReadonlySet<TerminalId>,
  minus: ReadonlySet<TerminalId>,
): boolean {
  if ((connection.r_uohm ?? 0) !== 0) return false;
  const a = terminalOf(connection.a);
  const b = terminalOf(connection.b);
  return a !== null && b !== null &&
    ((plus.has(a) && minus.has(b)) || (minus.has(a) && plus.has(b)));
}

function loadConnections(value: unknown, netlist: LoadedNetlist, where: string): readonly DemoConnection[] {
  if (!Array.isArray(value)) fail(where + ' must be an array');
  if (value.length > MAX_CORDS) fail(where + ' needs more than 256 cord ids');
  const parsed = value.map((entry, index) => parseConnection(entry, where + '[' + index + ']'));
  const occupied = new Uint8Array(HOLE_COUNT);
  for (let index = 0; index < parsed.length; index++) {
    const connection = parsed[index] as ParsedConnection;
    reserveExact(connection.a, occupied, where + '[' + index + '].a');
    reserveExact(connection.b, occupied, where + '[' + index + '].b');
  }

  const plus = new Set(netlist.plusMembers);
  const minus = new Set(netlist.minusMembers);
  const connections: DemoConnection[] = [];
  for (let index = 0; index < parsed.length; index++) {
    const source = parsed[index] as ParsedConnection;
    const common = {
      wire: source.wire,
      a: allocateEnd(source.a, occupied, where + '[' + index + '].a'),
      b: allocateEnd(source.b, occupied, where + '[' + index + '].b'),
    };
    const connection: DemoConnection = source.r_uohm === undefined
      ? Object.freeze(common)
      : Object.freeze({ ...common, r_uohm: source.r_uohm });
    if (isDirectRailShort(connection, plus, minus)) {
      fail(where + '[' + index + '] is a direct unloaded PLUS-to-MINUS short');
    }
    connections.push(connection);
  }
  return Object.freeze(connections);
}

function loadControlLabels(value: unknown, where: string): Readonly<Record<string, string>> {
  const raw = object(value, where);
  const labels: Record<string, string> = {};
  for (const key of Object.keys(raw)) {
    if (!CONTROL_KEY.test(key)) fail(where + ' has unknown key ' + JSON.stringify(key));
    labels[key] = nonEmptyString(raw[key], where + '.' + key);
  }
  return Object.freeze(labels);
}

function sect(index: number): Sect {
  return (index + 1) as Sect;
}

function initialCommands(connections: readonly DemoConnection[], initial: DemoInitial): readonly Command[] {
  const commands: Command[] = [];
  for (let index = 0; index < connections.length; index++) {
    const connection = connections[index] as DemoConnection;
    const common = { k: 'connect' as const, cord: index, a: connection.a, b: connection.b };
    commands.push(Object.freeze(connection.r_uohm === undefined
      ? common
      : { ...common, r_uohm: connection.r_uohm }));
  }
  for (let index = 0; index < 6; index++) {
    commands.push(Object.freeze({ k: 'switch', n: sect(index), target: initial.switches[index] as number }));
  }
  for (let index = 0; index < 6; index++) {
    commands.push(Object.freeze({ k: 'button', n: sect(index), target: initial.buttons[index] as number }));
  }
  for (let index = 0; index < 6; index++) {
    const target = initial.relayHands[index];
    commands.push(Object.freeze(target === null
      ? { k: 'relayRelease', n: sect(index) }
      : { k: 'relayGrab', n: sect(index), target: target as number }));
  }
  commands.push(Object.freeze(initial.dialHand === null
    ? { k: 'dialRelease' }
    : { k: 'dialGrab', targetUdeg: initial.dialHand }));
  commands.push(Object.freeze({ k: 'power', on: initial.power }));
  return Object.freeze(commands);
}

function loadDemo(value: unknown, netlist: LoadedNetlist, index: number): Demo {
  const where = 'demos[' + index + ']';
  const raw = object(value, where);
  exactKeys(raw, DEMO_KEYS, where);
  const category = required(raw, 'category', where);
  if (typeof category !== 'string' || !CATEGORIES.has(category as DemoCategory)) {
    fail(where + '.category is not a recognized category');
  }
  const connections = loadConnections(required(raw, 'connections', where), netlist, where + '.connections');
  const initial = loadInitial(required(raw, 'initial', where), where + '.initial');
  const common = {
    id: nonEmptyString(required(raw, 'id', where), where + '.id'),
    title: nonEmptyString(required(raw, 'title', where), where + '.title'),
    category: category as DemoCategory,
    source: loadSource(required(raw, 'source', where), where + '.source'),
    connections,
    initial,
    instructions: stringArray(required(raw, 'instructions', where), where + '.instructions', 1, false),
    controlLabels: loadControlLabels(required(raw, 'controlLabels', where), where + '.controlLabels'),
    commands: initialCommands(connections, initial),
  };
  if (!Object.hasOwn(raw, 'notice')) return Object.freeze(common);
  return Object.freeze({
    ...common,
    notice: nonEmptyString(raw['notice'], where + '.notice'),
  });
}

/** Validate and allocate a closed `minivac.demo-library/1` document without test/runtime dependencies. */
export function loadDemoLibrary(rawValue: unknown, netlist: LoadedNetlist): DemoLibrary {
  const raw = object(rawValue, 'document');
  exactKeys(raw, ['schema', 'demos'], 'document');
  if (required(raw, 'schema', 'document') !== DEMO_LIBRARY_SCHEMA) {
    fail('document.schema must be ' + JSON.stringify(DEMO_LIBRARY_SCHEMA));
  }
  const value = required(raw, 'demos', 'document');
  if (!Array.isArray(value) || value.length !== 17) fail('document.demos must contain exactly seventeen demos');
  const demos = value.map((entry, index) => loadDemo(entry, netlist, index));
  const ids = new Set<string>();
  for (const demo of demos) {
    if (demo.id === MANUAL_SESSION_ID) fail('reserved id ' + JSON.stringify(MANUAL_SESSION_ID));
    if (ids.has(demo.id)) fail('duplicate id ' + JSON.stringify(demo.id));
    ids.add(demo.id);
  }
  return Object.freeze({ schema: DEMO_LIBRARY_SCHEMA, demos: Object.freeze(demos) });
}
