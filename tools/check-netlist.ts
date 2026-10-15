/**
 * W2-AT02-STATIC: the frozen count-4 boolean-topology discriminator.
 *
 * This is deliberately narrower than a simulator. It loads the checked-in W2 topology and the
 * two separately transcribed program inputs, builds their real union graphs, then asks only
 * whether opposite source rails reach opposite ends of output lamps 4, 5 and 6 when the target
 * lamp and PSU are removed. Every other finite physical element remains a conductive path.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildGraph } from '../src/core/graph.ts';
import type { BuiltGraph, ResolvedCord } from '../src/core/graph.ts';
import { fnv1a64 } from '../src/core/ints.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import { loadProfile } from '../src/core/profile.ts';
import { allocateHoles, parseTerminalId, terminalIndex } from '../src/core/terminals.ts';
import type { TerminalWire } from '../src/core/terminals.ts';
import type { El } from '../src/core/solve.ts';

export const STATIC_SCHEMA = 'minivac.w2-at02-static/1';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INT32_MAX = 2147483647;
const REVIEWED_STATIC_INPUT_FNV64 = '7dfc1d82a9341248';

interface StaticWire {
  readonly id: number;
  readonly a: string;
  readonly b: string;
}

interface StaticState {
  readonly relays: readonly number[];
  readonly buttons: readonly number[];
  readonly switches: readonly number[];
  readonly wiper: number;
}

interface StaticProgram {
  readonly id: 'IV-EXP1' | 'ER-ALTCOUNTER';
  readonly source: string;
  readonly wires: readonly StaticWire[];
}

export interface StaticInput {
  readonly schema: typeof STATIC_SCHEMA;
  readonly state: StaticState;
  readonly programs: readonly StaticProgram[];
}

export interface StaticRow {
  readonly id: StaticProgram['id'];
  readonly source: string;
  readonly wires: number;
  readonly lamps: readonly boolean[];
  readonly tuple: string;
}

export interface StaticReport {
  readonly input: StaticInput;
  readonly rows: readonly StaticRow[];
  readonly pass: boolean;
}

/** The classifier needs only the immutable electrical half of a BuiltGraph. */
export interface ClassifierGraph {
  readonly elements: readonly Readonly<El>[];
  readonly elementIds: readonly string[];
  readonly nodeCount: number;
}

function fail(message: string): never {
  throw new Error('check-netlist: ' + message);
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(where + ' must be an object');
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], where: string): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    fail(where + ' must contain exactly ' + keys.join(','));
  }
  for (const key of keys) if (!(key in value)) fail(where + ' is missing ' + key);
}

function string(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(where + ' must be a non-empty string');
  return value;
}

function integer(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(where + ' must be a safe integer');
  return value;
}

function stopArray(value: unknown, expected: readonly number[], where: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 6) fail(where + ' must contain six stops');
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    const stop = integer(value[i], where + '[' + i + ']');
    if (stop !== 0 && stop !== 1000) fail(where + '[' + i + '] must be 0 or 1000');
    if (stop !== expected[i]) fail(where + '[' + i + '] does not match the frozen count-4 state');
    out.push(stop);
  }
  return Object.freeze(out);
}

function loadStaticWire(value: unknown, index: number, where: string): StaticWire {
  const row = record(value, where);
  exactKeys(row, ['id', 'a', 'b'], where);
  const id = integer(row['id'], where + '.id');
  if (id !== index || id < 0 || id > INT32_MAX) fail(where + '.id must equal its array index');
  const a = parseTerminalId(string(row['a'], where + '.a'));
  const b = parseTerminalId(string(row['b'], where + '.b'));
  return Object.freeze({ id, a, b });
}

/** Canonical reviewed-input projection. Classifier results are deliberately not part of this pin. */
function staticInputProjection(input: StaticInput): string {
  return JSON.stringify([
    input.schema,
    [input.state.relays, input.state.buttons, input.state.switches, input.state.wiper],
    input.programs.map((program) => [
      program.id,
      program.source,
      program.wires.map((wire) => [wire.id, wire.a, wire.b]),
    ]),
  ]);
}

/** Strict loader for the separately frozen static-gate input artifact. */
export function loadStaticInput(value: unknown): StaticInput {
  const top = record(value, 'document');
  exactKeys(top, ['schema', 'state', 'programs'], 'document');
  if (top['schema'] !== STATIC_SCHEMA) fail('schema must be ' + JSON.stringify(STATIC_SCHEMA));

  const rawState = record(top['state'], 'state');
  exactKeys(rawState, ['relays', 'buttons', 'switches', 'wiper'], 'state');
  const state = Object.freeze({
    relays: stopArray(rawState['relays'], [1000, 1000, 0, 0, 0, 0], 'state.relays'),
    buttons: stopArray(rawState['buttons'], [0, 0, 0, 0, 0, 0], 'state.buttons'),
    switches: stopArray(rawState['switches'], [0, 0, 0, 0, 0, 0], 'state.switches'),
    wiper: integer(rawState['wiper'], 'state.wiper'),
  });
  if (state.wiper !== 0) fail('state.wiper must be frozen at 0');

  if (!Array.isArray(top['programs']) || top['programs'].length !== 2) {
    fail('programs must contain IV-EXP1 then ER-ALTCOUNTER');
  }
  const ids = ['IV-EXP1', 'ER-ALTCOUNTER'] as const;
  const wireCounts = [44, 48] as const;
  const programs: StaticProgram[] = [];
  for (let p = 0; p < ids.length; p++) {
    const id = ids[p] as StaticProgram['id'];
    const where = 'programs[' + p + ']';
    const row = record(top['programs'][p], where);
    exactKeys(row, ['id', 'source', 'wires'], where);
    if (row['id'] !== id) fail(where + '.id must be ' + id);
    const source = string(row['source'], where + '.source');
    if (source !== 'docs/research/programs.md#' + id) fail(where + '.source is not the frozen citation');
    if (!Array.isArray(row['wires']) || row['wires'].length !== wireCounts[p]) {
      fail(where + '.wires must contain ' + wireCounts[p] + ' rows');
    }
    const wires = row['wires'].map((wire, i) => loadStaticWire(wire, i, where + '.wires[' + i + ']'));
    programs.push(Object.freeze({ id, source, wires: Object.freeze(wires) }));
  }
  const input = Object.freeze({ schema: STATIC_SCHEMA, state, programs: Object.freeze(programs) });
  const inputHash = fnv1a64(Buffer.from(staticInputProjection(input), 'utf8'));
  if (inputHash !== REVIEWED_STATIC_INPUT_FNV64) {
    fail('reviewed static input projection hash ' + inputHash + ' != ' + REVIEWED_STATIC_INPUT_FNV64);
  }
  return input;
}

function componentRoots(graph: ClassifierGraph, target: number, source: number): Int32Array {
  const parent = new Int32Array(graph.nodeCount);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (start: number): number => {
    let at = start;
    while ((parent[at] as number) !== at) at = parent[at] as number;
    return at;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < graph.elements.length; i++) {
    if (i === target || i === source) continue;
    const element = graph.elements[i] as Readonly<El>;
    union(element.a, element.b);
  }
  for (let i = 0; i < parent.length; i++) parent[i] = find(i);
  return parent;
}

/** Architecture §9.5's exact static boolean classifier for one output lamp. */
export function classifyLamp(graph: ClassifierGraph, targetId: string): boolean {
  if (graph.elements.length !== graph.elementIds.length) fail('element/id cardinality mismatch');
  const target = graph.elementIds.indexOf(targetId);
  const source = graph.elementIds.indexOf('PSU');
  if (target < 0 || graph.elementIds.lastIndexOf(targetId) !== target) fail('target must occur exactly once');
  if (source < 0 || graph.elementIds.lastIndexOf('PSU') !== source) fail('PSU must occur exactly once');
  const targetElement = graph.elements[target] as Readonly<El>;
  const sourceElement = graph.elements[source] as Readonly<El>;
  if (targetElement.k !== 'lamp') fail(targetId + ' is not a lamp');
  if (sourceElement.k !== 'source') fail('PSU is not a source');
  if (targetElement.a === targetElement.b) return false;

  const roots = componentRoots(graph, target, source);
  const plus = roots[sourceElement.a] as number;
  const minus = roots[sourceElement.b] as number;
  const a = roots[targetElement.a] as number;
  const b = roots[targetElement.b] as number;
  return (a === plus && b === minus) || (a === minus && b === plus);
}

function contactPositions(state: StaticState): readonly number[] {
  const out: number[] = [];
  for (let section = 0; section < 6; section++) {
    const relay = (state.relays[section] as number) / 1000;
    const button = (state.buttons[section] as number) / 1000;
    const slide = (state.switches[section] as number) / 1000;
    out.push(relay, relay, button, slide, slide);
  }
  out.push(state.wiper);
  return Object.freeze(out);
}

function resolvedCords(program: StaticProgram): readonly ResolvedCord[] {
  const pairs: TerminalWire[] = program.wires.map((wire) => Object.freeze([
    parseTerminalId(wire.a),
    parseTerminalId(wire.b),
  ]) as TerminalWire);
  allocateHoles(pairs);
  return Object.freeze(program.wires.map((wire) => Object.freeze({
    id: wire.id,
    a: terminalIndex(parseTerminalId(wire.a)),
    b: terminalIndex(parseTerminalId(wire.b)),
  })));
}

/** Run the static gate entirely from checked-in bytes. */
export function runStaticGate(): StaticReport {
  const input = loadStaticInput(JSON.parse(readFileSync(ROOT + '/data/kat/w2-at02-static.json', 'utf8')));
  const netlist = loadNetlist(readFileSync(ROOT + '/data/netlist.json'));
  const profile = loadProfile(JSON.parse(readFileSync(ROOT + '/data/profiles/MV601-REF-A.json', 'utf8')));
  const positions = contactPositions(input.state);
  const rows: StaticRow[] = input.programs.map((program) => {
    const graph: BuiltGraph = buildGraph(netlist, profile, {
      cords: resolvedCords(program),
      contactPosition: positions,
    });
    const lamps = Object.freeze([4, 5, 6].map((lamp) => classifyLamp(graph, 'out' + lamp)));
    const tuple = lamps.map((on) => on ? '1' : '0').join('');
    return Object.freeze({ id: program.id, source: program.source, wires: program.wires.length, lamps, tuple });
  });
  const pass = rows[0]?.tuple === '111' && rows[1]?.tuple === '101';
  return Object.freeze({ input, rows: Object.freeze(rows), pass });
}

export function formatStaticReport(report: StaticReport): string {
  const lines = ['W2-AT02-STATIC'];
  lines.push('schema=' + report.input.schema);
  lines.push(
    'state relays=[' + report.input.state.relays.join(',') + '] buttons=[' +
    report.input.state.buttons.join(',') + '] switches=[' + report.input.state.switches.join(',') +
    '] wiper=' + report.input.state.wiper,
  );
  for (const row of report.rows) {
    lines.push(
      row.id + ' source=' + row.source + ' wires=' + row.wires +
      ' outLamp4=' + (row.lamps[0] ? 'on' : 'off') +
      ' outLamp5=' + (row.lamps[1] ? 'on' : 'off') +
      ' outLamp6=' + (row.lamps[2] ? 'on' : 'off') + ' tuple=' + row.tuple,
    );
  }
  lines.push('W2-AT02-STATIC result=' + (report.pass ? 'PASS' : 'FAIL') + ' expected=IV-EXP1:111,ER-ALTCOUNTER:101');
  return lines.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = runStaticGate();
    process.stdout.write(formatStaticReport(report));
    if (!report.pass) process.exitCode = 1;
  } catch (error: unknown) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}
