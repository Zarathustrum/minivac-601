/**
 * Physical terminal identities and deterministic hole allocation.
 *
 * The order and hole counts are the frozen contract from architecture §2.1–§2.4 and
 * `jack-map.md` §1–§3. The byte-owning netlist loader checks its decoded terminal rows against
 * this table; this module deliberately does not import or parse `data/netlist.json`.
 *
 * DOM-free, dependency-free, no filesystem, no clock, no Map or Set iteration.
 */

declare const terminalIdBrand: unique symbol;
declare const holeIdBrand: unique symbol;

export type TerminalId = string & { readonly [terminalIdBrand]: true };
export type HoleId = string & { readonly [holeIdBrand]: true };

export interface TerminalDef {
  readonly id: TerminalId;
  readonly holes: number;
  readonly index: number;
  /** Zero-based global index of this terminal's first hole. */
  readonly holePrefix: number;
}

export interface HoleRef {
  readonly id: HoleId;
  readonly terminal: TerminalId;
  /** One-based hole number within `terminal`. */
  readonly hole: number;
  /** Zero-based index in the frozen 392-hole order. */
  readonly index: number;
}

export type TerminalWire = readonly [TerminalId, TerminalId];

export interface AllocatedCord {
  /** Zero-based index in the input wire list. */
  readonly wireIndex: number;
  readonly a: HoleRef;
  readonly b: HoleRef;
}

const SECTION_SUFFIXES = Object.freeze([
  'A', 'B', '+', '-', 'C', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'N', 'com', 'cap',
  'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
] as const);

interface TerminalRow {
  readonly id: string;
  readonly holes: number;
}

function fail(message: string): never {
  throw new Error('terminals: ' + message);
}

/** Build the approved grammar in its approved frozen order; this is not a second netlist. */
function buildRows(): readonly TerminalRow[] {
  const rows: TerminalRow[] = [];

  for (let section = 1; section <= 6; section++) {
    for (const suffix of SECTION_SUFFIXES) {
      rows.push(Object.freeze({
        id: String(section) + suffix,
        holes: suffix === 'com' ? 4 : 2,
      }));
    }
  }

  rows.push(Object.freeze({ id: 'M+', holes: 2 }));
  rows.push(Object.freeze({ id: 'M-', holes: 2 }));
  for (let cell = 1; cell <= 9; cell++) {
    rows.push(Object.freeze({ id: 'M' + cell + 't', holes: 2 }));
  }
  for (let cell = 1; cell <= 9; cell++) {
    rows.push(Object.freeze({ id: 'M' + cell + 'b', holes: 2 }));
  }
  rows.push(Object.freeze({ id: 'M10', holes: 6 }));
  rows.push(Object.freeze({ id: 'M11', holes: 6 }));
  for (let pad = 0; pad <= 19; pad++) {
    rows.push(Object.freeze({ id: 'D' + pad, holes: 2 }));
  }

  return Object.freeze(rows);
}

const ROWS = buildRows();
if (ROWS.length !== 186) fail('internal terminal table has ' + ROWS.length + ' rows, expected 186');

const terminalDefs: TerminalDef[] = [];
const terminalIds: TerminalId[] = [];
const holePrefixes: number[] = [0];
const indexById = Object.create(null) as Record<string, number>;

for (let index = 0; index < ROWS.length; index++) {
  const row = ROWS[index] as TerminalRow;
  const id = row.id as TerminalId;
  const holePrefix = holePrefixes[index] as number;

  if (indexById[row.id] !== undefined) fail('duplicate internal terminal ' + JSON.stringify(row.id));
  indexById[row.id] = index;
  terminalIds.push(id);
  terminalDefs.push(Object.freeze({ id, holes: row.holes, index, holePrefix }));
  holePrefixes.push(holePrefix + row.holes);
}

export const TERMINAL_COUNT = terminalDefs.length;
export const HOLE_COUNT = holePrefixes[holePrefixes.length - 1] as number;

if (HOLE_COUNT !== 392) fail('internal terminal table has ' + HOLE_COUNT + ' holes, expected 392');

export const TERMINALS: readonly TerminalDef[] = Object.freeze(terminalDefs);
export const TERMINAL_IDS: readonly TerminalId[] = Object.freeze(terminalIds);
/** Prefix sum with length `TERMINAL_COUNT + 1`; the final entry is `HOLE_COUNT`. */
export const HOLE_PREFIXES: readonly number[] = Object.freeze(holePrefixes);

Object.freeze(indexById);

/** Parse one strict physical designator. Program-only Ω forms are rejected here. */
export function parseTerminalId(text: string): TerminalId {
  if (typeof text !== 'string' || indexById[text] === undefined) {
    fail('invalid physical terminal ' + JSON.stringify(text));
  }
  return text as TerminalId;
}

/** Return the terminal's zero-based frozen index, rejecting forged branded strings. */
export function terminalIndex(id: TerminalId): number {
  const index = indexById[id];
  if (index === undefined) fail('invalid physical terminal ' + JSON.stringify(id));
  return index;
}

export function terminalAt(index: number): TerminalDef {
  if (!Number.isInteger(index) || index < 0 || index >= TERMINAL_COUNT) {
    fail('terminal index out of range: ' + JSON.stringify(index));
  }
  return TERMINALS[index] as TerminalDef;
}

export function holeAt(terminal: TerminalId, hole: number): HoleRef {
  const def = terminalAt(terminalIndex(terminal));
  if (!Number.isInteger(hole) || hole < 1 || hole > def.holes) {
    fail('hole out of range for ' + JSON.stringify(terminal) + ': ' + JSON.stringify(hole));
  }
  return Object.freeze({
    id: (terminal + '#' + hole) as HoleId,
    terminal,
    hole,
    index: def.holePrefix + hole - 1,
  });
}

export function holeByIndex(index: number): HoleRef {
  if (!Number.isInteger(index) || index < 0 || index >= HOLE_COUNT) {
    fail('hole index out of range: ' + JSON.stringify(index));
  }

  let low = 0;
  let high = TERMINAL_COUNT;
  while (low + 1 < high) {
    const middle = low + Math.floor((high - low) / 2);
    if ((HOLE_PREFIXES[middle] as number) <= index) low = middle;
    else high = middle;
  }

  const def = TERMINALS[low] as TerminalDef;
  return holeAt(def.id, index - def.holePrefix + 1);
}

/** Parse exactly one fully-qualified physical `A/B` wire. */
export function parseTerminalWire(text: string): TerminalWire {
  if (typeof text !== 'string') fail('invalid terminal wire ' + JSON.stringify(text));
  const slash = text.indexOf('/');
  if (slash <= 0 || slash !== text.lastIndexOf('/') || slash === text.length - 1) {
    fail('invalid terminal wire ' + JSON.stringify(text));
  }
  const a = parseTerminalId(text.slice(0, slash));
  const b = parseTerminalId(text.slice(slash + 1));
  return Object.freeze([a, b]);
}

/** Parse the canonical `TerminalId#oneBasedHole` spelling of one physical hole. */
export function parseHoleId(text: string): HoleRef {
  if (typeof text !== 'string') fail('invalid hole id ' + JSON.stringify(text));
  const hash = text.indexOf('#');
  if (hash <= 0 || hash !== text.lastIndexOf('#') || hash === text.length - 1) {
    fail('invalid hole id ' + JSON.stringify(text));
  }
  const terminal = parseTerminalId(text.slice(0, hash));
  const holeText = text.slice(hash + 1);
  if (!/^[1-9][0-9]*$/.test(holeText)) fail('invalid hole id ' + JSON.stringify(text));
  const ref = holeAt(terminal, Number(holeText));
  if (ref.id !== text) fail('invalid hole id ' + JSON.stringify(text));
  return ref;
}

export type ProgramDesignator =
  | { readonly k: 'terminal'; readonly id: TerminalId }
  | { readonly k: 'resistor-splice'; readonly form: 'unspecified' }
  | { readonly k: 'resistor-splice'; readonly form: 'literal'; readonly text: string }
  | { readonly k: 'resistor-splice'; readonly form: 'bias'; readonly relay: 1 | 2 | 3 | 4 | 5 | 6 };

/** Parse a physical terminal or Book VII's three Ω resistor-splice syntaxes. */
export function parseProgramDesignator(text: string): ProgramDesignator {
  if (typeof text !== 'string') fail('invalid program designator ' + JSON.stringify(text));
  if (indexById[text] !== undefined) {
    return Object.freeze({ k: 'terminal', id: text as TerminalId });
  }
  if (text === 'Ω') return Object.freeze({ k: 'resistor-splice', form: 'unspecified' });

  const ohms = /^Ω_([1-9][0-9]*)$/.exec(text);
  if (ohms !== null) {
    return Object.freeze({ k: 'resistor-splice', form: 'literal', text: ohms[1] as string });
  }

  const bias = /^Ω_B([1-6])$/.exec(text);
  if (bias !== null) {
    return Object.freeze({
      k: 'resistor-splice',
      form: 'bias',
      relay: Number(bias[1]) as 1 | 2 | 3 | 4 | 5 | 6,
    });
  }

  fail('invalid program designator ' + JSON.stringify(text));
}

export class HoleAllocationError extends Error {
  readonly code = 'hole_occupied' as const;
  readonly wireIndex: number;
  readonly terminal: TerminalId;

  constructor(wireIndex: number, terminal: TerminalId) {
    super('terminals: hole_occupied at wire ' + wireIndex + ' terminal ' + JSON.stringify(terminal));
    this.name = 'HoleAllocationError';
    this.wireIndex = wireIndex;
    this.terminal = terminal;
  }
}

/** Allocate each endpoint to its terminal's lowest free one-based hole, in wire order. */
export function allocateHoles(wires: readonly TerminalWire[]): readonly AllocatedCord[] {
  const used = new Int32Array(TERMINAL_COUNT);
  const cords: AllocatedCord[] = [];

  for (let wireIndex = 0; wireIndex < wires.length; wireIndex++) {
    const wire = wires[wireIndex] as TerminalWire;
    const aIndex = terminalIndex(wire[0]);
    const aDef = TERMINALS[aIndex] as TerminalDef;
    const aHole = (used[aIndex] as number) + 1;
    if (aHole > aDef.holes) throw new HoleAllocationError(wireIndex, aDef.id);
    used[aIndex] = aHole;

    const bIndex = terminalIndex(wire[1]);
    const bDef = TERMINALS[bIndex] as TerminalDef;
    const bHole = (used[bIndex] as number) + 1;
    if (bHole > bDef.holes) throw new HoleAllocationError(wireIndex, bDef.id);
    used[bIndex] = bHole;

    cords.push(Object.freeze({
      wireIndex,
      a: holeAt(aDef.id, aHole),
      b: holeAt(bDef.id, bHole),
    }));
  }

  return Object.freeze(cords);
}
