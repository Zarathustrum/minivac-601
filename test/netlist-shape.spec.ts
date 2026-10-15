/**
 * W2's four independent checks: fixed panel shape/attributes, strict fixture parsing, exact
 * partition/hole KAT execution, and the static count-4 topology discriminator.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import refJson from '../data/profiles/MV601-REF-A.json';
import {
  CONTACT_NC,
  CONTACT_NO,
  CONTACT_OPEN,
  buildGraph,
  buildGraphInto,
  createGraphWorkspace,
} from '../src/core/graph.ts';
import type { BuiltGraph, GraphWorkspace, ResolvedCord } from '../src/core/graph.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import type { NetContact } from '../src/core/netlist.ts';
import { loadProfile } from '../src/core/profile.ts';
import { createSolveWorkspace, tickSolve, tickSolveGraphInto } from '../src/core/solve.ts';
import type { Carried, SolveCfg } from '../src/core/solve.ts';
import {
  HOLE_COUNT,
  TERMINALS,
  TERMINAL_COUNT,
  TERMINAL_IDS,
  HoleAllocationError,
  allocateHoles,
  parseHoleId,
  parseProgramDesignator,
  parseTerminalId,
  parseTerminalWire,
  terminalIndex,
} from '../src/core/terminals.ts';
import type { TerminalId, TerminalWire } from '../src/core/terminals.ts';
import {
  classifyLamp,
  formatStaticReport,
  loadStaticInput,
  runStaticGate,
} from '../tools/check-netlist.ts';
import type { ClassifierGraph } from '../tools/check-netlist.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NETLIST_BYTES = readFileSync(ROOT + '/data/netlist.json');
const netlist = loadNetlist(NETLIST_BYTES);
const profile = loadProfile(refJson);

const MANIFEST = [
  'I-EXP1', 'I-EXP2', 'I-EXP3', 'I-EXP4', 'I-EXP5', 'I-EXP6', 'I-EXP7',
  'I-EXP8', 'I-EXP9', 'I-EXP10', 'I-EXP11', 'I-EXP12', 'I-EXP13', 'I-EXP14',
  'II-EXP1', 'II-EXP2', 'II-EXP3', 'II-MANUALMEM', 'II-SELFLOCK', 'II-2BUTTONMEM',
  'II-FF1', 'II-EXP4', 'II-EXP5', 'II-EXP6', 'II-EXP7',
  'III-3STMT', 'III-ANDOR', 'III-XOR-PB', 'III-RELAYAND', 'III-RELAYOR',
  'III-RELAYNOT', 'III-RELAYXOR',
  'MM-PB-CHECK', 'MM-RLY-CHECK', 'MM-SW-CHECK',
  'SYN-HOLE-EXHAUSTION', 'SYN-SAME-TERMINAL', 'SYN-ALL-FLOATING-ISLAND',
  'SYN-RAILS-PREUNIONED-NO-CORD', 'SYN-DATUM-NOT-LOWEST',
] as const;
const REVIEWED_KAT_INPUT_FNV64 = '73b5b6b772c3e938';

interface KatWire {
  readonly id: number;
  readonly a: TerminalId;
  readonly b: TerminalId;
  readonly r_uohm?: number;
}

interface KatMovers {
  readonly relays: readonly number[];
  readonly buttons: readonly number[];
  readonly switches: readonly number[];
}

interface KatHole {
  readonly id: number;
  readonly a: string;
  readonly b: string;
}

interface KatGraph {
  readonly k: 'graph';
  readonly holes: readonly KatHole[];
  readonly partition: readonly (readonly TerminalId[])[];
  readonly floating: readonly TerminalId[];
}

interface KatError {
  readonly k: 'error';
  readonly why: 'hole_occupied';
  readonly wire: number;
}

interface KatCase {
  readonly id: string;
  readonly source: string;
  readonly wires: readonly KatWire[];
  readonly movers: KatMovers;
  readonly wiper: number;
  readonly expect: KatGraph | KatError;
}

interface KatDoc {
  readonly schema: 'minivac.netlist-kat/1';
  readonly cases: readonly KatCase[];
}

/** Canonical reviewed-input projection. Graph/error goldens are deliberately excluded. */
function katInputProjection(doc: KatDoc): string {
  return JSON.stringify([
    doc.schema,
    doc.cases.map((fixture) => [
      fixture.id,
      fixture.source,
      fixture.wires.map((wire) => wire.r_uohm === undefined
        ? [wire.id, wire.a, wire.b]
        : [wire.id, wire.a, wire.b, wire.r_uohm]),
      [fixture.movers.relays, fixture.movers.buttons, fixture.movers.switches],
      fixture.wiper,
    ]),
  ]);
}

function fail(message: string): never {
  throw new Error('netlist-kat: ' + message);
}

function object(value: unknown, where: string): Record<string, unknown> {
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

function nonempty(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(where + ' must be a non-empty string');
  return value;
}

function integer(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(where + ' must be a safe integer');
  return value;
}

function terminal(value: unknown, where: string): TerminalId {
  try {
    return parseTerminalId(nonempty(value, where));
  } catch {
    fail(where + ' must be a physical terminal id');
  }
}

function stops(value: unknown, where: string): readonly number[] {
  if (!Array.isArray(value) || value.length !== 6) fail(where + ' must contain six stop values');
  const out: number[] = [];
  for (let i = 0; i < 6; i++) {
    const stop = integer(value[i], where + '[' + i + ']');
    if (stop !== 0 && stop !== 1000) fail(where + '[' + i + '] must be 0 or 1000');
    out.push(stop);
  }
  return Object.freeze(out);
}

function loadWire(value: unknown, index: number, where: string): KatWire {
  const row = object(value, where);
  const keys = 'r_uohm' in row ? ['id', 'a', 'b', 'r_uohm'] : ['id', 'a', 'b'];
  exactKeys(row, keys, where);
  const id = integer(row['id'], where + '.id');
  if (id !== index) fail(where + '.id must equal its zero-based array index');
  const a = terminal(row['a'], where + '.a');
  const b = terminal(row['b'], where + '.b');
  if ('r_uohm' in row) {
    const r = integer(row['r_uohm'], where + '.r_uohm');
    if (r < 0 || r > 2147483647) fail(where + '.r_uohm must be int32 >= 0');
    return Object.freeze({ id, a, b, r_uohm: r });
  }
  return Object.freeze({ id, a, b });
}

function loadMovers(value: unknown, where: string): KatMovers {
  const row = object(value, where);
  exactKeys(row, ['relays', 'buttons', 'switches'], where);
  return Object.freeze({
    relays: stops(row['relays'], where + '.relays'),
    buttons: stops(row['buttons'], where + '.buttons'),
    switches: stops(row['switches'], where + '.switches'),
  });
}

function loadGraph(value: Record<string, unknown>, wires: readonly KatWire[], where: string): KatGraph {
  exactKeys(value, ['k', 'holes', 'partition', 'floating'], where);
  if (!Array.isArray(value['holes']) || value['holes'].length !== wires.length) {
    fail(where + '.holes must match wires cardinality');
  }
  const holes: KatHole[] = value['holes'].map((raw, i) => {
    const rowWhere = where + '.holes[' + i + ']';
    const row = object(raw, rowWhere);
    exactKeys(row, ['id', 'a', 'b'], rowWhere);
    const id = integer(row['id'], rowWhere + '.id');
    if (id !== i || id !== wires[i]?.id) fail(rowWhere + '.id must match the wire id');
    const a = parseHoleId(nonempty(row['a'], rowWhere + '.a'));
    const b = parseHoleId(nonempty(row['b'], rowWhere + '.b'));
    return Object.freeze({ id, a: a.id, b: b.id });
  });

  if (!Array.isArray(value['partition']) || value['partition'].length === 0) {
    fail(where + '.partition must be a non-empty array');
  }
  const seen = new Uint8Array(TERMINAL_COUNT);
  const partition: TerminalId[][] = [];
  let previousFirst = -1;
  for (let g = 0; g < value['partition'].length; g++) {
    const rawGroup = value['partition'][g];
    if (!Array.isArray(rawGroup) || rawGroup.length === 0) fail(where + '.partition[' + g + '] must be non-empty');
    const group: TerminalId[] = [];
    let previousMember = -1;
    for (let m = 0; m < rawGroup.length; m++) {
      const id = terminal(rawGroup[m], where + '.partition[' + g + '][' + m + ']');
      const index = terminalIndex(id);
      if (index <= previousMember) fail(where + '.partition[' + g + '] is not in frozen terminal order');
      if (seen[index] !== 0) fail(where + '.partition duplicates ' + id);
      previousMember = index;
      seen[index] = 1;
      group.push(id);
    }
    const first = terminalIndex(group[0] as TerminalId);
    if (first <= previousFirst) fail(where + '.partition groups are not ordered by first member');
    previousFirst = first;
    partition.push(Object.freeze(group) as TerminalId[]);
  }
  for (let i = 0; i < seen.length; i++) {
    if (seen[i] === 0) fail(where + '.partition omits ' + TERMINAL_IDS[i]);
  }

  if (!Array.isArray(value['floating'])) fail(where + '.floating must be an array');
  const firstMembers = new Uint8Array(TERMINAL_COUNT);
  for (const group of partition) firstMembers[terminalIndex(group[0] as TerminalId)] = 1;
  const floating: TerminalId[] = [];
  let previousFloating = -1;
  for (let i = 0; i < value['floating'].length; i++) {
    const id = terminal(value['floating'][i], where + '.floating[' + i + ']');
    const index = terminalIndex(id);
    if (index <= previousFloating) fail(where + '.floating is not in frozen terminal order');
    if (firstMembers[index] === 0) fail(where + '.floating entry is not a partition key: ' + id);
    previousFloating = index;
    floating.push(id);
  }
  return Object.freeze({
    k: 'graph', holes: Object.freeze(holes),
    partition: Object.freeze(partition.map((group) => Object.freeze(group))),
    floating: Object.freeze(floating),
  });
}

function loadExpect(value: unknown, wires: readonly KatWire[], where: string): KatGraph | KatError {
  const row = object(value, where);
  if (row['k'] === 'error') {
    exactKeys(row, ['k', 'why', 'wire'], where);
    if (row['why'] !== 'hole_occupied') fail(where + '.why must be hole_occupied');
    const wire = integer(row['wire'], where + '.wire');
    if (wire !== 2) fail(where + '.wire must be 2');
    return Object.freeze({ k: 'error', why: 'hole_occupied', wire });
  }
  if (row['k'] !== 'graph') fail(where + '.k must be graph or error');
  return loadGraph(row, wires, where);
}

/** Parse the exact portable KAT schema without repairing or canonicalizing expected output. */
function loadKatSchema(value: unknown): KatDoc {
  const top = object(value, 'document');
  exactKeys(top, ['schema', 'cases'], 'document');
  if (top['schema'] !== 'minivac.netlist-kat/1') fail('schema must be "minivac.netlist-kat/1"');
  if (!Array.isArray(top['cases'])) fail('cases must be an array');
  const cases: KatCase[] = [];
  for (let i = 0; i < top['cases'].length; i++) {
    const where = 'cases[' + i + ']';
    const row = object(top['cases'][i], where);
    exactKeys(row, ['id', 'source', 'wires', 'movers', 'wiper', 'expect'], where);
    const id = nonempty(row['id'], where + '.id');
    if (!Array.isArray(row['wires'])) fail(where + '.wires must be an array');
    const wires = row['wires'].map((wire, w) => loadWire(wire, w, where + '.wires[' + w + ']'));
    const wiper = integer(row['wiper'], where + '.wiper');
    if (wiper < 0 || wiper > 15) fail(where + '.wiper must be 0..15');
    cases.push(Object.freeze({
      id,
      source: nonempty(row['source'], where + '.source'),
      wires: Object.freeze(wires),
      movers: loadMovers(row['movers'], where + '.movers'),
      wiper,
      expect: loadExpect(row['expect'], wires, where + '.expect'),
    }));
  }
  const ids = cases.map((fixture) => fixture.id);
  if (ids.length !== MANIFEST.length || ids.some((id, i) => id !== MANIFEST[i])) {
    fail('case manifest must be the exact ordered 40-case list');
  }
  const exhaustion = cases.filter((fixture) => fixture.expect.k === 'error');
  if (exhaustion.length !== 1 || exhaustion[0]?.id !== 'SYN-HOLE-EXHAUSTION') {
    fail('SYN-HOLE-EXHAUSTION must be the sole error case');
  }
  const fullStops = cases.some((fixture) =>
    fixture.id.startsWith('SYN-') && fixture.wiper === 15 &&
    [...fixture.movers.relays, ...fixture.movers.buttons, ...fixture.movers.switches].every((x) => x === 1000));
  if (!fullStops) fail('one synthetic must exercise all 1000 stops and wiper 15');
  return Object.freeze({ schema: 'minivac.netlist-kat/1', cases: Object.freeze(cases) });
}

/** Load the schema, then bind its reviewed inputs independently of the co-located graph goldens. */
function loadKat(value: unknown): KatDoc {
  const doc = loadKatSchema(value);
  const inputHash = independentFnv(Buffer.from(katInputProjection(doc), 'utf8'));
  if (inputHash !== REVIEWED_KAT_INPUT_FNV64) {
    fail('reviewed input projection hash ' + inputHash + ' != ' + REVIEWED_KAT_INPUT_FNV64);
  }
  return doc;
}

function contactPositions(movers: KatMovers, wiper: number): readonly number[] {
  const out: number[] = [];
  for (let section = 0; section < 6; section++) {
    const relay = (movers.relays[section] as number) / 1000;
    const button = (movers.buttons[section] as number) / 1000;
    const slide = (movers.switches[section] as number) / 1000;
    out.push(relay, relay, button, slide, slide);
  }
  out.push(wiper);
  return Object.freeze(out);
}

function inputPairs(wires: readonly KatWire[]): readonly TerminalWire[] {
  return Object.freeze(wires.map((wire) => Object.freeze([wire.a, wire.b]) as TerminalWire));
}

function runKatCase(fixture: KatCase): KatGraph | KatError {
  let allocated;
  try {
    allocated = allocateHoles(inputPairs(fixture.wires));
  } catch (error: unknown) {
    if (error instanceof HoleAllocationError) {
      return Object.freeze({ k: 'error', why: error.code, wire: error.wireIndex });
    }
    throw error;
  }
  const cords: ResolvedCord[] = fixture.wires.map((wire) => {
    const base = { id: wire.id, a: terminalIndex(wire.a), b: terminalIndex(wire.b) };
    return Object.freeze(wire.r_uohm === undefined ? base : { ...base, rUohm: wire.r_uohm });
  });
  const graph = buildGraph(netlist, profile, {
    cords: Object.freeze(cords),
    contactPosition: contactPositions(fixture.movers, fixture.wiper),
  });
  const partition = graph.members.map((members) =>
    members.map((index) => TERMINAL_IDS[index] as TerminalId));
  partition.sort((a, b) => terminalIndex(a[0] as TerminalId) - terminalIndex(b[0] as TerminalId));
  const floating = graph.members
    .filter((_members, node) => graph.inSource[node] === 0)
    .map((members) => TERMINAL_IDS[members[0] as number] as TerminalId)
    .sort((a, b) => terminalIndex(a) - terminalIndex(b));
  return Object.freeze({
    k: 'graph',
    holes: Object.freeze(allocated.map((cord) => Object.freeze({ id: cord.wireIndex, a: cord.a.id, b: cord.b.id }))),
    partition: Object.freeze(partition.map((group) => Object.freeze(group))),
    floating: Object.freeze(floating),
  });
}

function openGraph(cords: ArrayLike<ResolvedCord> = []): BuiltGraph {
  return buildGraph(netlist, profile, { cords, contactPosition: new Int8Array(31).fill(CONTACT_OPEN) });
}

function openGraphInto(
  workspace: GraphWorkspace,
  cords: readonly ResolvedCord[] = [],
  sourceEnabled = true,
): GraphWorkspace {
  return buildGraphInto(
    netlist,
    profile,
    { cords, contactPosition: new Int8Array(31).fill(CONTACT_OPEN) },
    sourceEnabled,
    workspace,
  );
}

function activeMembers(workspace: GraphWorkspace): number[][] {
  const out: number[][] = [];
  for (let node = 0; node < workspace.nodeCount; node++) {
    const row: number[] = [];
    const end = workspace.memberOffsets[node + 1] as number;
    for (let i = workspace.memberOffsets[node] as number; i < end; i++) {
      row.push(workspace.memberTerminals[i] as number);
    }
    out.push(row);
  }
  return out;
}

function panelSolveCfg(datum: number): SolveCfg {
  return {
    dtS: profile.v.tick_us * 1e-6,
    vArc: profile.v.V_arc_clamp_mv * 1e-3,
    kThermal: profile.derived.kThermal,
    gminS: profile.v.gmin_ns * 1e-9,
    pwl: {
      xs: profile.pwl.map((point) => (point[0] as number) * 1e-6),
      ys: profile.pwl.map((point) => (point[1] as number) * 1e-6),
    },
    datum,
  };
}

function panelCarried(coilA = 0, lampOhm = profile.v.R_cold_uohm * 1e-6): Carried {
  return { iCoil: new Float64Array(6).fill(coilA), rLamp: new Float64Array(12).fill(lampOhm) };
}

function activeElements(workspace: GraphWorkspace): BuiltGraph['elements'] {
  return Array.from({ length: workspace.elementCount }, (_unused, index) => {
    const element = workspace.elements[index];
    if (element?.k === 'lamp') return { k: element.k, a: element.a, b: element.b };
    if (element?.k === 'coil') {
      return { k: element.k, a: element.a, b: element.b, rOhm: element.rOhm, lH: element.lH };
    }
    if (element?.k === 'res') return { k: element.k, a: element.a, b: element.b, rOhm: element.rOhm };
    if (element?.k === 'source') {
      return { k: element.k, a: element.a, b: element.b, vOc: element.vOc, rSrcOhm: element.rSrcOhm };
    }
    throw new Error('missing active element ' + index);
  });
}

function possiblePairs(contact: NetContact): readonly (readonly [TerminalId, TerminalId])[] {
  if (contact.k === 'wiper') {
    return contact.pads.map((pad) => Object.freeze([contact.arm, pad]) as readonly [TerminalId, TerminalId]);
  }
  return Object.freeze([
    Object.freeze([contact.arm, contact.nc]) as readonly [TerminalId, TerminalId],
    Object.freeze([contact.arm, contact.no]) as readonly [TerminalId, TerminalId],
  ]);
}

function recursivelyFrozen(value: unknown, seen: Set<object> = new Set()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return true;
  seen.add(value);
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every((child) => recursivelyFrozen(child, seen));
}

function independentFnv(bytes: Uint8Array): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of bytes) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 0x100000001b3n);
  return hash.toString(16).padStart(16, '0');
}

const EXPECTED_ELEMENTS = [
  { k: 'lamp', id: 'out1', a: '1A', b: '1B', curve: 'lamp6435' },
  { k: 'lamp', id: 'ind1', a: '1C', b: '1E', curve: 'lamp6435' },
  { k: 'coil', id: 'coil1', a: '1E', b: '1F', relay: 1 },
  { k: 'lamp', id: 'out2', a: '2A', b: '2B', curve: 'lamp6435' },
  { k: 'lamp', id: 'ind2', a: '2C', b: '2E', curve: 'lamp6435' },
  { k: 'coil', id: 'coil2', a: '2E', b: '2F', relay: 2 },
  { k: 'lamp', id: 'out3', a: '3A', b: '3B', curve: 'lamp6435' },
  { k: 'lamp', id: 'ind3', a: '3C', b: '3E', curve: 'lamp6435' },
  { k: 'coil', id: 'coil3', a: '3E', b: '3F', relay: 3 },
  { k: 'lamp', id: 'out4', a: '4A', b: '4B', curve: 'lamp6435' },
  { k: 'lamp', id: 'ind4', a: '4C', b: '4E', curve: 'lamp6435' },
  { k: 'coil', id: 'coil4', a: '4E', b: '4F', relay: 4 },
  { k: 'lamp', id: 'out5', a: '5A', b: '5B', curve: 'lamp6435' },
  { k: 'lamp', id: 'ind5', a: '5C', b: '5E', curve: 'lamp6435' },
  { k: 'coil', id: 'coil5', a: '5E', b: '5F', relay: 5 },
  { k: 'lamp', id: 'out6', a: '6A', b: '6B', curve: 'lamp6435' },
  { k: 'lamp', id: 'ind6', a: '6C', b: '6E', curve: 'lamp6435' },
  { k: 'coil', id: 'coil6', a: '6E', b: '6F', relay: 6 },
  { k: 'res', id: 'R1', a: 'D17', b: 'D19', r: 'R1_uohm' },
  { k: 'res', id: 'R2', a: 'D18', b: 'D19', r: 'R2_uohm' },
  { k: 'res', id: 'MOT', a: 'D18', b: 'D19', r: 'R_arm_uohm', drives: 'dial' },
  { k: 'source', id: 'PSU', a: 'PLUS', b: 'MINUS' },
] as const;

const EXPECTED_CONTACTS = [
  'relay:1:1:1H:1J:1G', 'relay:1:2:1L:1N:1K', 'button:1:1Y:1Z:1X',
  'slide:1:1:1S:1R:1T', 'slide:1:2:1V:1U:1W',
  'relay:2:1:2H:2J:2G', 'relay:2:2:2L:2N:2K', 'button:2:2Y:2Z:2X',
  'slide:2:1:2S:2R:2T', 'slide:2:2:2V:2U:2W',
  'relay:3:1:3H:3J:3G', 'relay:3:2:3L:3N:3K', 'button:3:3Y:3Z:3X',
  'slide:3:1:3S:3R:3T', 'slide:3:2:3V:3U:3W',
  'relay:4:1:4H:4J:4G', 'relay:4:2:4L:4N:4K', 'button:4:4Y:4Z:4X',
  'slide:4:1:4S:4R:4T', 'slide:4:2:4V:4U:4W',
  'relay:5:1:5H:5J:5G', 'relay:5:2:5L:5N:5K', 'button:5:5Y:5Z:5X',
  'slide:5:1:5S:5R:5T', 'slide:5:2:5V:5U:5W',
  'relay:6:1:6H:6J:6G', 'relay:6:2:6L:6N:6K', 'button:6:6Y:6Z:6X',
  'slide:6:1:6S:6R:6T', 'slide:6:2:6V:6U:6W',
  'wiper:D16:D0,D1,D2,D3,D4,D5,D6,D7,D8,D9,D10,D11,D12,D13,D14,D15',
] as const;

function contactKey(contact: NetContact): string {
  if (contact.k === 'wiper') return 'wiper:' + contact.arm + ':' + contact.pads.join(',');
  if (contact.k === 'button') return ['button', contact.n, contact.arm, contact.nc, contact.no].join(':');
  return [contact.k, contact.n, contact.set, contact.arm, contact.nc, contact.no].join(':');
}

describe('the fixed netlist shape and literal attributes', () => {
  it('pins every architecture §2.2 count and bus member', () => {
    expect(TERMINAL_COUNT).toBe(186);
    expect(HOLE_COUNT).toBe(392);
    expect(netlist.terminals).toHaveLength(186);
    expect(netlist.holePrefixes).toHaveLength(187);
    expect(netlist.holePrefixes[186]).toBe(392);
    expect(netlist.plusMembers).toEqual(['1+', '2+', '3+', '4+', '5+', '6+', 'M+']);
    expect(netlist.minusMembers).toEqual(['1-', '2-', '3-', '4-', '5-', '6-', 'M-']);
    expect(netlist.elements).toHaveLength(22);
    expect(netlist.contacts).toHaveLength(31);
    expect(openGraph().nodeCount).toBe(174);
    expect(netlist.contacts.reduce((sum, contact) => sum + possiblePairs(contact).length, 0)).toBe(76);
    expect(netlist.contacts.filter((contact) => contact.k === 'relay')).toHaveLength(12);
    expect(netlist.contacts.filter((contact) => contact.k === 'button')).toHaveLength(6);
    expect(netlist.contacts.filter((contact) => contact.k === 'slide')).toHaveLength(12);
    expect(netlist.contacts.filter((contact) => contact.k === 'wiper')).toHaveLength(1);
  });

  it('pins special holes and every bare junction named by the protocol', () => {
    for (let section = 1; section <= 6; section++) {
      expect(TERMINALS[terminalIndex(parseTerminalId(section + 'com'))]?.holes).toBe(4);
      expect(TERMINALS[terminalIndex(parseTerminalId(section + 'cap'))]?.holes).toBe(2);
    }
    expect(TERMINALS[terminalIndex(parseTerminalId('M10'))]?.holes).toBe(6);
    expect(TERMINALS[terminalIndex(parseTerminalId('M11'))]?.holes).toBe(6);
    const bare = [
      ...[1, 2, 3, 4, 5, 6].map((n) => n + 'com'),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => 'M' + n + 't'),
      ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => 'M' + n + 'b'),
      'M10', 'M11',
    ];
    expect(bare).toHaveLength(26);
    for (const id of bare) expect(() => parseTerminalId(id)).not.toThrow();
  });

  it('pins all 22 element rows field-for-field', () => {
    expect(netlist.elements).toEqual(EXPECTED_ELEMENTS);
  });

  it('pins all 31 contact records, including every wiper pad', () => {
    expect(netlist.contacts.map(contactKey)).toEqual(EXPECTED_CONTACTS);
  });
});

describe('raw-byte ownership, strict parsing and immutability', () => {
  it('hashes the same bytes it parses, including insignificant JSON whitespace', () => {
    expect(netlist.hash).toBe(independentFnv(NETLIST_BYTES));
    const changed = new Uint8Array(NETLIST_BYTES.length + 1);
    changed[0] = NETLIST_BYTES[0] as number;
    changed[1] = 0x20;
    changed.set(NETLIST_BYTES.subarray(1), 2);
    const loaded = loadNetlist(changed);
    expect(loaded.hash).toBe(independentFnv(changed));
    expect(loaded.hash).not.toBe(netlist.hash);
    expect(loaded.elements).toEqual(netlist.elements);
    expect(loaded.contacts).toEqual(netlist.contacts);
  });

  it('snapshots SharedArrayBuffer bytes before hashing and parsing', () => {
    const shared = new Uint8Array(new SharedArrayBuffer(NETLIST_BYTES.length));
    shared.set(NETLIST_BYTES);
    const originalBytes = Uint8Array.from(shared);
    const expectedHash = independentFnv(originalBytes);
    const originalBigInt = globalThis.BigInt;
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'BigInt');
    let hashReads = 0;

    Object.defineProperty(globalThis, 'BigInt', {
      ...originalDescriptor,
      value(value: string | number | bigint | boolean): bigint {
        const converted = originalBigInt(value);
        hashReads++;
        if (hashReads === shared.length) shared[0] = 0x5b;
        return converted;
      },
    });

    try {
      const loaded = loadNetlist(shared);
      expect(hashReads).toBe(originalBytes.length);
      expect(shared[0]).toBe(0x5b);
      expect(loaded.hash).toBe(expectedHash);
      expect(loaded.elements).toEqual(netlist.elements);
      expect(loaded.contacts).toEqual(netlist.contacts);
    } finally {
      if (originalDescriptor === undefined) {
        delete (globalThis as { BigInt?: BigIntConstructor }).BigInt;
      } else {
        Object.defineProperty(globalThis, 'BigInt', originalDescriptor);
      }
    }
  });

  it('rejects a non-ASCII byte and unknown schema keys', () => {
    const nonAscii = Uint8Array.from(NETLIST_BYTES);
    nonAscii[0] = 0xef;
    expect(() => loadNetlist(nonAscii)).toThrow(/byte 0 is not ASCII/);
    const raw = JSON.parse(NETLIST_BYTES.toString('utf8')) as Record<string, unknown>;
    raw['comment'] = 'unauthenticated extension';
    expect(() => loadNetlist(Buffer.from(JSON.stringify(raw)))).toThrow(/unknown key "comment"/);
  });

  it('recursively freezes the authenticated topology and rejects mutation', () => {
    expect(recursivelyFrozen(netlist)).toBe(true);
    expect(() => (netlist.elements as unknown[]).push({})).toThrow();
    expect(() => ((netlist.contacts[0] as unknown as Record<string, unknown>)['arm'] = '6Z')).toThrow();
    const wiper = netlist.contacts[30];
    expect(wiper?.k).toBe('wiper');
    if (wiper?.k === 'wiper') expect(() => (wiper.pads as unknown as string[]).push('D16')).toThrow();
  });
});

describe('terminal grammar and lowest-free-hole allocation', () => {
  it('rejects every architecture §2.4 OCR and pseudo-terminal trap', () => {
    const invalid = [
      'M10t', 'M10b', 'M11t', 'M11b', '1D', '1I', '1M', '1O', '1P', '1Q', 'Q',
      'Ω', 'Ω_1', 'Ω_B1', 'PLUS', 'MINUS', 'D20', 'M0t', '0A', '7A', '1a', '1 A',
    ];
    for (const id of invalid) expect(() => parseTerminalId(id), id).toThrow();
    for (const section of [1, 2, 3, 4, 5, 6]) {
      for (const suffix of ['D', 'I', 'M', 'O', 'P', 'Q']) {
        expect(() => parseTerminalId(section + suffix), section + suffix).toThrow();
      }
    }
  });

  it('recognizes only the three exact symbolic resistor-splice forms', () => {
    expect(parseProgramDesignator('Ω')).toEqual({ k: 'resistor-splice', form: 'unspecified' });
    expect(parseProgramDesignator('Ω_123')).toEqual({ k: 'resistor-splice', form: 'literal', text: '123' });
    for (let relay = 1; relay <= 6; relay++) {
      expect(parseProgramDesignator('Ω_B' + relay)).toEqual({ k: 'resistor-splice', form: 'bias', relay });
    }
    for (const bad of ['Q', 'Ω_', 'Ω_0', 'Ω_01', 'Ω_-1', 'Ω_1.0', 'Ω_B0', 'Ω_B7', 'Ω_b1', ' Ω']) {
      expect(() => parseProgramDesignator(bad), bad).toThrow();
    }
  });

  it('parses only fully-qualified terminal pairs, never holes or shorthand', () => {
    expect(parseTerminalWire('1+/1A')).toEqual(['1+', '1A']);
    for (const bad of ['+/H', '1A', '1A/', '/1A', '1A/1B/1C', '1A#1/1B#1', 'Ω/1A']) {
      expect(() => parseTerminalWire(bad), bad).toThrow();
    }
  });

  it('uses distinct lowest holes for both ends on one terminal and reports third-end exhaustion', () => {
    const same = allocateHoles([parseTerminalWire('1A/1A')]);
    expect(same.map((cord) => [cord.a.id, cord.b.id])).toEqual([['1A#1', '1A#2']]);
    const exhausted = [parseTerminalWire('1A/2A'), parseTerminalWire('1A/3A'), parseTerminalWire('1A/4A')];
    expect(() => allocateHoles(exhausted)).toThrow(HoleAllocationError);
    try {
      allocateHoles(exhausted);
      throw new Error('expected exhaustion');
    } catch (error: unknown) {
      expect(error).toMatchObject({ code: 'hole_occupied', wireIndex: 2, terminal: '1A' });
    }
  });
});

describe('open contacts and the 76 possible union pairs', () => {
  const base = openGraph();

  it('all 31 open records contribute neither a union nor a finite element across any alternative', () => {
    let checked = 0;
    for (const contact of netlist.contacts) {
      for (const [a, b] of possiblePairs(contact)) {
        const na = base.nodeByTerminal[terminalIndex(a)] as number;
        const nb = base.nodeByTerminal[terminalIndex(b)] as number;
        expect(na, a + '/' + b).not.toBe(nb);
        const spanning = base.elements.filter((element) =>
          (element.a === na && element.b === nb) || (element.a === nb && element.b === na));
        expect(spanning, a + '/' + b).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBe(76);
  });

  it('each of the 76 alternatives closes as a union and adds no element', () => {
    let checked = 0;
    for (let c = 0; c < netlist.contacts.length; c++) {
      const contact = netlist.contacts[c] as NetContact;
      const pairs = possiblePairs(contact);
      for (let choice = 0; choice < pairs.length; choice++) {
        const positions = new Int8Array(31).fill(CONTACT_OPEN);
        positions[c] = contact.k === 'wiper' ? choice : choice === 0 ? CONTACT_NC : CONTACT_NO;
        const graph = buildGraph(netlist, profile, { cords: [], contactPosition: positions });
        const [a, b] = pairs[choice] as readonly [TerminalId, TerminalId];
        expect(graph.nodeByTerminal[terminalIndex(a)], a + '/' + b)
          .toBe(graph.nodeByTerminal[terminalIndex(b)]);
        expect(graph.elementIds).toEqual(base.elementIds);
        checked++;
      }
    }
    expect(checked).toBe(76);
  });
});

describe('cord semantics, canonical nodes and source pruning', () => {
  it('rejects invalid ArrayLike cord lengths with graph-prefixed errors', () => {
    for (const length of [-1, Number.NaN, 0.5]) {
      expect(
        () => openGraph({ length } as ArrayLike<ResolvedCord>),
        String(length),
      ).toThrow(/^graph: cords length must be an integer in 0\.\.256$/);
    }
  });

  it('rejects sparse, null and primitive cord entries with graph-prefixed errors', () => {
    expect(() => openGraph(new Array<ResolvedCord>(1)))
      .toThrow(/^graph: cord\[0\] must be a non-null object$/);
    for (const entry of [null, 7, 'cord']) {
      const cords = { 0: entry, length: 1 } as unknown as ArrayLike<ResolvedCord>;
      expect(() => openGraph(cords), String(entry))
        .toThrow(/^graph: cord\[0\] must be a non-null object$/);
    }
  });

  it('absent and zero-ohm cords union; a positive cord remains a sorted resistor before PSU', () => {
    const a = terminalIndex(parseTerminalId('1com'));
    const b = terminalIndex(parseTerminalId('2com'));
    expect(openGraph().nodeByTerminal[a]).not.toBe(openGraph().nodeByTerminal[b]);
    for (const cord of [
      { id: 4, a, b },
      { id: 4, a, b, rUohm: 0 },
    ]) {
      const graph = openGraph([cord]);
      expect(graph.nodeByTerminal[a]).toBe(graph.nodeByTerminal[b]);
      expect(graph.elementIds).not.toContain('cord:4');
    }
    const graph = openGraph([
      { id: 9, a, b, rUohm: 9000 },
      { id: 2, a, b, rUohm: 2000 },
      { id: 7, a, b, rUohm: 7000 },
    ]);
    expect(graph.nodeByTerminal[a]).not.toBe(graph.nodeByTerminal[b]);
    expect(graph.elementIds.slice(-4)).toEqual(['cord:2', 'cord:7', 'cord:9', 'PSU']);
    expect(graph.elements.slice(-4, -1)).toEqual([
      { k: 'res', a: graph.nodeByTerminal[a], b: graph.nodeByTerminal[b], rOhm: 2000 * 1e-6 },
      { k: 'res', a: graph.nodeByTerminal[a], b: graph.nodeByTerminal[b], rOhm: 7000 * 1e-6 },
      { k: 'res', a: graph.nodeByTerminal[a], b: graph.nodeByTerminal[b], rOhm: 9000 * 1e-6 },
    ]);
  });

  it('reaches the fixed 174-node / 278-element maxima and rejects the next cord', () => {
    const a = terminalIndex(parseTerminalId('1com'));
    const b = terminalIndex(parseTerminalId('2com'));
    const cords = Array.from({ length: 256 }, (_unused, id) => Object.freeze({ id, a, b, rUohm: id + 1 }));
    const graph = openGraph(cords);
    expect(graph.nodeCount).toBe(174);
    expect(graph.elements).toHaveLength(278);
    expect(graph.elementIds[21]).toBe('cord:0');
    expect(graph.elementIds[276]).toBe('cord:255');
    expect(graph.elementIds[277]).toBe('PSU');
    expect(() => openGraph([...cords, { id: 0, a, b, rUohm: 1 }])).toThrow(/more than 256 cords/);
  });

  it('orders non-datum nodes by minimum member, puts datum last, and never lets gmin unprune', () => {
    const graph = openGraph([{ id: 0, a: terminalIndex(parseTerminalId('6com')), b: terminalIndex(parseTerminalId('1com')) }]);
    expect(graph.datum).toBe(graph.nodeCount - 1);
    expect(graph.nodeByTerminal[terminalIndex(parseTerminalId('1-'))]).toBe(graph.datum);
    expect(graph.members[graph.datum]?.[0]).toBe(terminalIndex(parseTerminalId('1-')));
    expect(graph.members[0]?.[0]).toBe(terminalIndex(parseTerminalId('1A')));
    for (let node = 1; node < graph.datum; node++) {
      expect(graph.members[node]?.[0] as number).toBeGreaterThan(graph.members[node - 1]?.[0] as number);
    }
    const islandNode = graph.nodeByTerminal[terminalIndex(parseTerminalId('1com'))] as number;
    expect(graph.inSource[islandNode]).toBe(0);
    expect(graph.sourceNode).toBe(graph.nodeByTerminal[terminalIndex(parseTerminalId('1+'))]);
    expect(recursivelyFrozen(graph)).toBe(true);
  });

  it('includes a finite positive cord in source-component reachability without unioning it', () => {
    const plus = terminalIndex(parseTerminalId('1+'));
    const island = terminalIndex(parseTerminalId('1com'));
    const graph = openGraph([{ id: 0, a: plus, b: island, rUohm: 1000 }]);
    expect(graph.nodeByTerminal[plus]).not.toBe(graph.nodeByTerminal[island]);
    expect(graph.inSource[graph.nodeByTerminal[island] as number]).toBe(1);
  });
});

describe('the W3 caller-owned graph/solve seam', () => {
  it('matches the allocating graph and solve wrappers field-for-field', () => {
    const plus = terminalIndex(parseTerminalId('1+'));
    const island = terminalIndex(parseTerminalId('1com'));
    const cords = Object.freeze([
      Object.freeze({ id: 7, a: plus, b: island, rUohm: 12_345 }),
      Object.freeze({ id: 2, a: terminalIndex(parseTerminalId('2com')), b: island }),
    ]);
    const positions = new Int8Array(31).fill(CONTACT_OPEN);
    positions[0] = CONTACT_NC;
    positions[30] = 9;
    const allocating = buildGraph(netlist, profile, { cords, contactPosition: positions });
    const graph = buildGraphInto(
      netlist,
      profile,
      { cords, contactPosition: positions },
      true,
      createGraphWorkspace(),
    );

    expect(graph.nodeCount).toBe(allocating.nodeCount);
    expect(graph.datum).toBe(allocating.datum);
    expect(graph.sourceNode).toBe(allocating.sourceNode);
    expect(Array.from(graph.nodeByTerminal)).toEqual(allocating.nodeByTerminal);
    expect(activeMembers(graph)).toEqual(allocating.members);
    expect(Array.from(graph.inSource.subarray(0, graph.nodeCount))).toEqual(allocating.inSource);
    expect(Array.from(graph.elementIds).slice(0, graph.elementCount)).toEqual(allocating.elementIds);
    expect(activeElements(graph)).toEqual(allocating.elements);

    const cfg = panelSolveCfg(graph.datum);
    const wrapperCarried = panelCarried();
    const inPlaceCarried = panelCarried();
    const wrapped = tickSolve(allocating.elements, wrapperCarried, cfg);
    const inPlace = tickSolveGraphInto(graph, inPlaceCarried, cfg, createSolveWorkspace());
    expect(Array.from(inPlace.v.subarray(0, inPlace.nodeCount))).toEqual(Array.from(wrapped.v));
    expect(Array.from(inPlace.floating.subarray(0, inPlace.nodeCount))).toEqual(Array.from(wrapped.floating));
    expect(Array.from(inPlace.branchI.subarray(0, inPlace.elementCount))).toEqual(Array.from(wrapped.branchI));
    expect(inPlace).toMatchObject({
      arcPass: wrapped.arcPass,
      openRamp: wrapped.openRamp,
      nonPortable: wrapped.nonPortable,
    });
    expect(inPlaceCarried.iCoil).toEqual(wrapperCarried.iCoil);
    expect(inPlaceCarried.rLamp).toEqual(wrapperCarried.rLamp);
  });

  it('reuses every fixed buffer and overwrites a previous maximal topology', () => {
    const workspace = createGraphWorkspace();
    const refs = {
      elements: workspace.elements,
      firstElement: workspace.elements[0],
      elementIds: workspace.elementIds,
      nodes: workspace.nodeByTerminal,
      offsets: workspace.memberOffsets,
      members: workspace.memberTerminals,
      source: workspace.inSource,
    };
    const a = terminalIndex(parseTerminalId('1com'));
    const b = terminalIndex(parseTerminalId('2com'));
    const cords = Array.from({ length: 256 }, (_unused, id) => ({ id, a, b, rUohm: id + 1 }));
    openGraphInto(workspace, cords);
    expect(workspace).toMatchObject({ nodeCount: 174, datum: 173, elementCount: 278, sourceEnabled: true });

    openGraphInto(workspace, [], false);
    expect(workspace).toMatchObject({ nodeCount: 174, datum: 173, elementCount: 22, sourceEnabled: false });
    expect(workspace.elements).toBe(refs.elements);
    expect(workspace.elements[0]).toBe(refs.firstElement);
    expect(workspace.elementIds).toBe(refs.elementIds);
    expect(workspace.nodeByTerminal).toBe(refs.nodes);
    expect(workspace.memberOffsets).toBe(refs.offsets);
    expect(workspace.memberTerminals).toBe(refs.members);
    expect(workspace.inSource).toBe(refs.source);
    expect(workspace.elements[workspace.elementCount - 1]).toMatchObject({ k: 'source' });
    expect(workspace.elementIds[workspace.elementCount - 1]).toBe('PSU');
    expect(Array.from(workspace.inSource.subarray(0, workspace.nodeCount))).toEqual(
      new Array<number>(workspace.nodeCount).fill(0),
    );
    expect(activeMembers(workspace)).toEqual(openGraph().members);
  });

  it('keeps the disabled source last but exposes zero rows, floating nodes and zero branches', () => {
    const graph = openGraphInto(createGraphWorkspace(), [], false);
    const carried = panelCarried(0.04, profile.v.R_hot_uohm * 1e-6);
    const result = tickSolveGraphInto(graph, carried, panelSolveCfg(graph.datum), createSolveWorkspace());

    expect(result.rowCount).toBe(0);
    expect(result.arcPass).toBe(false);
    expect(result.openRamp).toBe(false);
    expect(result.nonPortable).toBe(false);
    expect(result.branchI.subarray(0, result.elementCount).every((value) => Object.is(value, 0))).toBe(true);
    expect(carried.iCoil.every((value) => Object.is(value, 0))).toBe(true);
    expect(carried.rLamp.every((value) => value < profile.v.R_hot_uohm * 1e-6)).toBe(true);
    for (let node = 0; node < graph.nodeCount; node++) {
      if (node === graph.datum) {
        expect(result.v[node]).toBe(0);
        expect(result.floating[node]).toBe(0);
      } else {
        expect(Number.isNaN(result.v[node] as number)).toBe(true);
        expect(result.floating[node]).toBe(1);
      }
    }
  });

  it('keeps two graph and solve workspaces isolated', () => {
    const firstGraph = openGraphInto(createGraphWorkspace(), [{
      id: 3,
      a: terminalIndex(parseTerminalId('1com')),
      b: terminalIndex(parseTerminalId('2com')),
    }]);
    const firstNodes = Array.from(firstGraph.nodeByTerminal);
    const firstMembers = activeMembers(firstGraph);
    const firstElements = activeElements(firstGraph);
    const secondGraph = openGraphInto(createGraphWorkspace(), [], false);
    expect(secondGraph.nodeByTerminal).not.toBe(firstGraph.nodeByTerminal);
    expect(secondGraph.elements).not.toBe(firstGraph.elements);

    openGraphInto(secondGraph, Array.from({ length: 256 }, (_unused, id) => ({
      id,
      a: terminalIndex(parseTerminalId('3com')),
      b: terminalIndex(parseTerminalId('4com')),
      rUohm: id + 1,
    })), true);
    expect(Array.from(firstGraph.nodeByTerminal)).toEqual(firstNodes);
    expect(activeMembers(firstGraph)).toEqual(firstMembers);
    expect(activeElements(firstGraph)).toEqual(firstElements);

    const firstSolve = createSolveWorkspace();
    const secondSolve = createSolveWorkspace();
    const firstCarried = panelCarried();
    tickSolveGraphInto(firstGraph, firstCarried, panelSolveCfg(firstGraph.datum), firstSolve);
    const firstV = Array.from(firstSolve.v.subarray(0, firstSolve.nodeCount));
    const firstI = Array.from(firstSolve.branchI.subarray(0, firstSolve.elementCount));
    tickSolveGraphInto(secondGraph, panelCarried(), panelSolveCfg(secondGraph.datum), secondSolve);
    expect(secondSolve.v).not.toBe(firstSolve.v);
    expect(secondSolve.branchI).not.toBe(firstSolve.branchI);
    expect(Array.from(firstSolve.v.subarray(0, firstSolve.nodeCount))).toEqual(firstV);
    expect(Array.from(firstSolve.branchI.subarray(0, firstSolve.elementCount))).toEqual(firstI);
  });

  it('takes datum and source membership only from the graph workspace', () => {
    const enabled = openGraphInto(createGraphWorkspace());
    const correctCfg = panelSolveCfg(enabled.datum);
    const wrongCfg = { ...correctCfg, datum: 0 };
    const expected = tickSolveGraphInto(enabled, panelCarried(), correctCfg, createSolveWorkspace());
    const got = tickSolveGraphInto(enabled, panelCarried(), wrongCfg, createSolveWorkspace());
    expect(Array.from(got.v.subarray(0, got.nodeCount))).toEqual(
      Array.from(expected.v.subarray(0, expected.nodeCount)),
    );
    expect(Array.from(got.floating.subarray(0, got.nodeCount))).toEqual(
      Array.from(expected.floating.subarray(0, expected.nodeCount)),
    );
    expect(Array.from(got.branchI.subarray(0, got.elementCount))).toEqual(
      Array.from(expected.branchI.subarray(0, expected.elementCount)),
    );

    const disabled = openGraphInto(createGraphWorkspace(), [], false);
    const off = tickSolveGraphInto(disabled, panelCarried(0.02), wrongCfg, createSolveWorkspace());
    expect(off.rowCount).toBe(0);
    expect(off.v[disabled.datum]).toBe(0);
    expect(off.branchI.subarray(0, off.elementCount).every((value) => Object.is(value, 0))).toBe(true);
  });

  it('keeps mutable scratch out of module scope and constructs cord ids only at workspace creation', () => {
    const graphSource = readFileSync(new URL('../src/core/graph.ts', import.meta.url), 'utf8');
    const solveSource = readFileSync(new URL('../src/core/solve.ts', import.meta.url), 'utf8');
    const moduleTypedArray = /^const\s+\w+\s*=\s*new\s+(?:Float64|Int32|Int16|Int8|Uint8)Array/gm;
    expect(graphSource.match(moduleTypedArray)).toEqual(null);
    expect(solveSource.match(moduleTypedArray)).toEqual(null);
    const cordConstructions = [...graphSource.matchAll(/'cord:' \+ id/g)];
    expect(cordConstructions).toHaveLength(1);
    expect(cordConstructions[0]?.index as number).toBeLessThan(graphSource.indexOf('export function buildGraphInto'));
  });
});

describe('the strict 40-case portable KAT', () => {
  it('has the exact schema/manifest, frozen inputs, and exact graph or exhaustion outcomes', () => {
    const raw = JSON.parse(readFileSync(ROOT + '/data/kat/netlist-kat.json', 'utf8')) as unknown;
    const doc = loadKat(raw);
    expect(doc.cases.map((fixture) => fixture.id)).toEqual(MANIFEST);
    expect(recursivelyFrozen(doc)).toBe(true);
    for (const fixture of doc.cases) expect(runKatCase(fixture), fixture.id).toEqual(fixture.expect);
  });

  it('rejects unknown top-level fields before considering fixture content', () => {
    const raw = JSON.parse(readFileSync(ROOT + '/data/kat/netlist-kat.json', 'utf8')) as Record<string, unknown>;
    raw['defaults'] = {};
    expect(() => loadKat(raw)).toThrow(/document must contain exactly schema,cases/);
  });

  it('rejects defaults or repairs at every nested schema boundary', () => {
    const original = JSON.parse(readFileSync(ROOT + '/data/kat/netlist-kat.json', 'utf8')) as Record<string, unknown>;
    const caseRows = (doc: Record<string, unknown>): Record<string, unknown>[] =>
      doc['cases'] as Record<string, unknown>[];

    const extraCaseKey = structuredClone(original);
    caseRows(extraCaseKey)[0]!['note'] = 'not in the portable schema';
    expect(() => loadKat(extraCaseKey)).toThrow(/cases\[0\] must contain exactly id,source,wires,movers,wiper,expect/);

    const skippedWireId = structuredClone(original);
    const firstWires = caseRows(skippedWireId)[0]!['wires'] as Record<string, unknown>[];
    firstWires[0]!['id'] = 1;
    expect(() => loadKat(skippedWireId)).toThrow(/id must equal its zero-based array index/);

    const implicitMover = structuredClone(original);
    const movers = caseRows(implicitMover)[0]!['movers'] as Record<string, unknown>;
    delete movers['buttons'];
    expect(() => loadKat(implicitMover)).toThrow(/movers must contain exactly relays,buttons,switches/);

    const midTravel = structuredClone(original);
    const midRelays = (caseRows(midTravel)[0]!['movers'] as Record<string, unknown>)['relays'] as number[];
    midRelays[0] = 500;
    expect(() => loadKat(midTravel)).toThrow(/must be 0 or 1000/);

    const holeIdInput = structuredClone(original);
    const holeWire = (caseRows(holeIdInput)[0]!['wires'] as Record<string, unknown>[])[0]!;
    holeWire['a'] = '1A#1';
    expect(() => loadKat(holeIdInput)).toThrow(/must be a physical terminal id/);

    const badError = structuredClone(original);
    const errorCase = caseRows(badError).find((fixture) => fixture['id'] === 'SYN-HOLE-EXHAUSTION');
    expect(errorCase).toBeDefined();
    (errorCase!['expect'] as Record<string, unknown>)['wire'] = 1;
    expect(() => loadKat(badError)).toThrow(/expect.wire must be 2/);
  });

  it('pins reviewed sources, wires and states independently of co-mutated graph goldens', () => {
    const original = JSON.parse(readFileSync(ROOT + '/data/kat/netlist-kat.json', 'utf8')) as Record<string, unknown>;
    const caseRows = (doc: Record<string, unknown>): Record<string, unknown>[] =>
      doc['cases'] as Record<string, unknown>[];

    const sourceOnly = structuredClone(original);
    caseRows(sourceOnly)[0]!['source'] = 'docs/research/programs.md#wrong-record';
    expect(() => loadKat(sourceOnly)).toThrow(/reviewed input projection hash/);

    const endpoint = structuredClone(original);
    const endpointWire = (caseRows(endpoint)[0]!['wires'] as Record<string, unknown>[])[0]!;
    endpointWire['a'] = '1B';
    expect(() => loadKat(endpoint)).toThrow(/reviewed input projection hash/);

    const reversal = structuredClone(original);
    const reversedWire = (caseRows(reversal)[0]!['wires'] as Record<string, unknown>[])[0]!;
    [reversedWire['a'], reversedWire['b']] = [reversedWire['b'], reversedWire['a']];
    expect(() => loadKat(reversal)).toThrow(/reviewed input projection hash/);

    const changedState = structuredClone(original);
    const switches = (caseRows(changedState)[0]!['movers'] as Record<string, unknown>)['switches'] as number[];
    switches[0] = 1000;
    expect(() => loadKat(changedState)).toThrow(/reviewed input projection hash/);

    // Reversing an ideal cord changes no partition. Updating its hole golden made the old
    // self-consistency gate pass, so this is the co-mutated-input-and-golden attack the pin closes.
    const coMutated = structuredClone(original);
    const firstCase = caseRows(coMutated)[0]!;
    const firstWire = (firstCase['wires'] as Record<string, unknown>[])[0]!;
    [firstWire['a'], firstWire['b']] = [firstWire['b'], firstWire['a']];
    const firstHole = ((firstCase['expect'] as Record<string, unknown>)['holes'] as Record<string, unknown>[])[0]!;
    [firstHole['a'], firstHole['b']] = [firstHole['b'], firstHole['a']];
    const schemaOnly = loadKatSchema(coMutated);
    expect(runKatCase(schemaOnly.cases[0] as KatCase)).toEqual(schemaOnly.cases[0]?.expect);
    expect(() => loadKat(coMutated)).toThrow(/reviewed input projection hash/);
  });
});

function classifierGraph(elements: ClassifierGraph['elements'], ids: readonly string[], nodeCount: number): ClassifierGraph {
  return { elements, elementIds: ids, nodeCount };
}

describe('W2-AT02-STATIC', () => {
  it('counts paths through physical passive elements, removes target and PSU, and accepts either polarity', () => {
    const forward = classifierGraph([
      { k: 'lamp', a: 2, b: 5 },
      { k: 'res', a: 0, b: 3, rOhm: 1 },
      { k: 'coil', a: 3, b: 2, rOhm: 1, lH: 1 },
      { k: 'lamp', a: 1, b: 4 },
      { k: 'res', a: 4, b: 5, rOhm: 1 },
      { k: 'source', a: 0, b: 1, vOc: 1, rSrcOhm: 1 },
    ], ['out4', 'R', 'coil', 'otherLamp', 'cord:7', 'PSU'], 6);
    expect(classifyLamp(forward, 'out4')).toBe(true);
    const reverse = classifierGraph([
      { k: 'lamp', a: 2, b: 3 },
      { k: 'res', a: 0, b: 3, rOhm: 1 },
      { k: 'res', a: 1, b: 2, rOhm: 1 },
      { k: 'source', a: 0, b: 1, vOc: 1, rSrcOhm: 1 },
    ], ['out4', 'R1', 'R2', 'PSU'], 4);
    expect(classifyLamp(reverse, 'out4')).toBe(true);
  });

  it('returns off for collapsed ends, a missing opposite path, or a path supplied only by the target', () => {
    const collapsed = classifierGraph([
      { k: 'lamp', a: 2, b: 2 },
      { k: 'source', a: 0, b: 1, vOc: 1, rSrcOhm: 1 },
    ], ['out4', 'PSU'], 3);
    expect(classifyLamp(collapsed, 'out4')).toBe(false);
    const oneSided = classifierGraph([
      { k: 'lamp', a: 2, b: 3 },
      { k: 'res', a: 0, b: 2, rOhm: 1 },
      { k: 'source', a: 0, b: 1, vOc: 1, rSrcOhm: 1 },
    ], ['out4', 'R', 'PSU'], 4);
    expect(classifyLamp(oneSided, 'out4')).toBe(false);
    const targetOnly = classifierGraph([
      { k: 'lamp', a: 2, b: 3 },
      { k: 'res', a: 0, b: 2, rOhm: 1 },
      { k: 'res', a: 1, b: 2, rOhm: 1 },
      { k: 'source', a: 0, b: 1, vOc: 1, rSrcOhm: 1 },
    ], ['out4', 'R1', 'R2', 'PSU'], 4);
    expect(classifyLamp(targetOnly, 'out4')).toBe(false);
  });

  it('strictly loads the frozen 44/48-wire input and reproduces 111 versus 101 deterministically', () => {
    const raw = JSON.parse(readFileSync(ROOT + '/data/kat/w2-at02-static.json', 'utf8')) as unknown;
    const input = loadStaticInput(raw);
    expect(input.programs.map((program) => [program.id, program.wires.length])).toEqual([
      ['IV-EXP1', 44], ['ER-ALTCOUNTER', 48],
    ]);
    expect(recursivelyFrozen(input)).toBe(true);
    const report = runStaticGate();
    expect(report.rows.map((row) => row.tuple)).toEqual(['111', '101']);
    expect(report.pass).toBe(true);
    expect(formatStaticReport(runStaticGate())).toBe(formatStaticReport(report));
  });

  it('rejects a changed frozen state, wire row, source, count, id, or schema key', () => {
    const original = JSON.parse(readFileSync(ROOT + '/data/kat/w2-at02-static.json', 'utf8')) as Record<string, unknown>;
    const changedState = structuredClone(original);
    ((changedState['state'] as Record<string, unknown>)['relays'] as number[])[0] = 0;
    expect(() => loadStaticInput(changedState)).toThrow(/frozen count-4 state/);
    const missingWire = structuredClone(original);
    ((missingWire['programs'] as Record<string, unknown>[])[0]?.['wires'] as unknown[]).pop();
    expect(() => loadStaticInput(missingWire)).toThrow(/must contain 44 rows/);
    const wrongId = structuredClone(original);
    (((wrongId['programs'] as Record<string, unknown>[])[1]?.['wires'] as Record<string, unknown>[])[0] as Record<string, unknown>)['id'] = 7;
    expect(() => loadStaticInput(wrongId)).toThrow(/id must equal its array index/);
    const wrongSource = structuredClone(original);
    (wrongSource['programs'] as Record<string, unknown>[])[0]!['source'] = 'docs/research/programs.md#wrong';
    expect(() => loadStaticInput(wrongSource)).toThrow(/source is not the frozen citation/);
    const changedEndpoint = structuredClone(original);
    const endpointWire = ((changedEndpoint['programs'] as Record<string, unknown>[])[0]!['wires'] as Record<string, unknown>[])[0]!;
    endpointWire['a'] = '1B';
    expect(() => loadStaticInput(changedEndpoint)).toThrow(/reviewed static input projection hash/);
    const reversedEndpoint = structuredClone(original);
    const reversedWire = ((reversedEndpoint['programs'] as Record<string, unknown>[])[0]!['wires'] as Record<string, unknown>[])[0]!;
    [reversedWire['a'], reversedWire['b']] = [reversedWire['b'], reversedWire['a']];
    expect(() => loadStaticInput(reversedEndpoint)).toThrow(/reviewed static input projection hash/);
    const extra = structuredClone(original);
    extra['expected'] = ['111', '101'];
    expect(() => loadStaticInput(extra)).toThrow(/must contain exactly schema,state,programs/);
  });
});
