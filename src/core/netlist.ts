/**
 * The checked-in panel netlist loader.
 *
 * The input is bytes, not a decoded string: determinism rule 13 hashes the exact file and the
 * parser must consume those same bytes. `data/netlist.json` is deliberately ASCII-only (the Ω
 * fixture syntax is a cord, never a terminal), so a small local decoder keeps `src/core` free of
 * both DOM `TextDecoder` and Node's `Buffer`.
 */
import { fnv1a64 } from './ints.ts';
import {
  HOLE_PREFIXES,
  TERMINALS,
  TERMINAL_IDS,
  parseTerminalId,
  terminalIndex,
} from './terminals.ts';
import type { TerminalDef, TerminalId } from './terminals.ts';

export const NETLIST_SCHEMA = 'minivac.netlist/1';

export type ResistanceKey = 'R1_uohm' | 'R2_uohm' | 'R_arm_uohm';

export interface LampDef {
  readonly k: 'lamp';
  readonly id: string;
  readonly a: TerminalId;
  readonly b: TerminalId;
  readonly curve: 'lamp6435';
}

export interface CoilDef {
  readonly k: 'coil';
  readonly id: string;
  readonly a: TerminalId;
  readonly b: TerminalId;
  readonly relay: number;
}

export interface ResDef {
  readonly k: 'res';
  readonly id: string;
  readonly a: TerminalId;
  readonly b: TerminalId;
  readonly r: ResistanceKey;
  readonly drives?: 'dial';
}

export interface SourceDef {
  readonly k: 'source';
  readonly id: string;
  readonly a: 'PLUS';
  readonly b: 'MINUS';
}

export type NetElement = LampDef | CoilDef | ResDef | SourceDef;

export interface RelayContactDef {
  readonly k: 'relay';
  readonly n: number;
  readonly set: number;
  readonly arm: TerminalId;
  readonly nc: TerminalId;
  readonly no: TerminalId;
}

export interface ButtonContactDef {
  readonly k: 'button';
  readonly n: number;
  readonly arm: TerminalId;
  readonly nc: TerminalId;
  readonly no: TerminalId;
}

export interface SlideContactDef {
  readonly k: 'slide';
  readonly n: number;
  readonly set: number;
  readonly arm: TerminalId;
  readonly nc: TerminalId;
  readonly no: TerminalId;
}

export interface WiperContactDef {
  readonly k: 'wiper';
  readonly arm: TerminalId;
  readonly pads: readonly TerminalId[];
}

export type NetContact = RelayContactDef | ButtonContactDef | SlideContactDef | WiperContactDef;

export interface LoadedNetlist {
  readonly schema: typeof NETLIST_SCHEMA;
  /** Bare 16-digit lowercase FNV-1a 64. Trace formatting adds the `fnv1a64:` label. */
  readonly hash: string;
  readonly terminals: readonly TerminalDef[];
  readonly terminalIds: readonly TerminalId[];
  readonly holePrefixes: readonly number[];
  readonly plusMembers: readonly TerminalId[];
  readonly minusMembers: readonly TerminalId[];
  readonly elements: readonly NetElement[];
  readonly contacts: readonly NetContact[];
}

const TERMINAL_COUNT = 186;
const HOLE_COUNT = 392;
const BASE_NODE_COUNT = 174;
const ELEMENT_COUNT = 22;
const CONTACT_COUNT = 31;

function fail(message: string): never {
  throw new Error('netlist: ' + message);
}

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function obj(value: unknown, where: string): Record<string, unknown> {
  if (!isObj(value)) fail(where + ' must be an object');
  return value;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], where: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail('unknown key ' + JSON.stringify(key) + ' in ' + where);
  }
  for (const key of allowed) {
    if (!(key in value)) fail('missing required key ' + JSON.stringify(key) + ' in ' + where);
  }
}

function string(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0) fail(where + ' must be a non-empty string');
  return value;
}

function integer(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(where + ' must be a safe integer');
  return value;
}

function terminal(value: unknown, where: string): TerminalId {
  const id = string(value, where);
  try {
    return parseTerminalId(id);
  } catch {
    fail(where + ' is not a terminal: ' + JSON.stringify(id));
  }
}

/** ASCII is a strict subset of UTF-8 and is all the normative netlist schema needs. */
function decodeAscii(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i] as number;
    if (byte > 0x7f) fail('byte ' + i + ' is not ASCII');
    text += String.fromCharCode(byte);
  }
  return text;
}

function parseJson(bytes: Uint8Array): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(decodeAscii(bytes));
  } catch (error: unknown) {
    if (error instanceof Error && error.message.startsWith('netlist: ')) throw error;
    fail('invalid JSON: ' + (error instanceof Error ? error.message : String(error)));
  }
  return obj(raw, 'document');
}

function loadTerminals(raw: unknown): void {
  if (!Array.isArray(raw)) fail('terminals must be an array');
  if (raw.length !== TERMINAL_COUNT) fail('terminals count ' + raw.length + ' != ' + TERMINAL_COUNT);
  if (TERMINALS.length !== TERMINAL_COUNT || TERMINAL_IDS.length !== TERMINAL_COUNT) {
    fail('frozen terminal table count is not ' + TERMINAL_COUNT);
  }
  if (HOLE_PREFIXES.length !== TERMINAL_COUNT + 1) fail('frozen hole-prefix table must have 187 entries');

  for (let i = 0; i < TERMINAL_COUNT; i++) {
    const row = obj(raw[i], 'terminals[' + i + ']');
    exactKeys(row, ['id', 'holes'], 'terminals[' + i + ']');
    const id = terminal(row['id'], 'terminals[' + i + '].id');
    const holes = integer(row['holes'], 'terminals[' + i + '].holes');
    const frozen = TERMINALS[i] as TerminalDef;
    if (id !== frozen.id || id !== TERMINAL_IDS[i]) {
      fail('terminals[' + i + '].id ' + JSON.stringify(id) + ' != frozen ' + JSON.stringify(frozen.id));
    }
    if (holes !== frozen.holes) fail(id + ' holes ' + holes + ' != frozen ' + frozen.holes);
    if (frozen.index !== i || terminalIndex(id) !== i) fail(id + ' frozen index is not ' + i);
    if (frozen.holePrefix !== HOLE_PREFIXES[i]) fail(id + ' frozen hole prefix disagrees with HOLE_PREFIXES');
  }
  if (HOLE_PREFIXES[TERMINAL_COUNT] !== HOLE_COUNT) fail('frozen hole count is not ' + HOLE_COUNT);
}

function sectionTerminal(section: number, suffix: string): TerminalId {
  return parseTerminalId(String(section) + suffix);
}

function loadBus(raw: unknown, name: 'PLUS' | 'MINUS'): readonly TerminalId[] {
  if (!Array.isArray(raw)) fail('bus.' + name + ' must be an array');
  if (raw.length !== 7) fail('bus.' + name + ' must have 7 members');
  const out: TerminalId[] = [];
  for (let i = 0; i < raw.length; i++) {
    const id = terminal(raw[i], 'bus.' + name + '[' + i + ']');
    const expected = i < 6 ? sectionTerminal(i + 1, name === 'PLUS' ? '+' : '-') : parseTerminalId('M' + (name === 'PLUS' ? '+' : '-'));
    if (id !== expected) fail('bus.' + name + '[' + i + '] must be ' + JSON.stringify(expected));
    out.push(id);
  }
  return Object.freeze(out);
}

function expectedElement(index: number): NetElement {
  if (index < 18) {
    const section = Math.floor(index / 3) + 1;
    const within = index % 3;
    if (within === 0) {
      return { k: 'lamp', id: 'out' + section, a: sectionTerminal(section, 'A'), b: sectionTerminal(section, 'B'), curve: 'lamp6435' };
    }
    if (within === 1) {
      return { k: 'lamp', id: 'ind' + section, a: sectionTerminal(section, 'C'), b: sectionTerminal(section, 'E'), curve: 'lamp6435' };
    }
    return { k: 'coil', id: 'coil' + section, a: sectionTerminal(section, 'E'), b: sectionTerminal(section, 'F'), relay: section };
  }
  if (index === 18) return { k: 'res', id: 'R1', a: parseTerminalId('D17'), b: parseTerminalId('D19'), r: 'R1_uohm' };
  if (index === 19) return { k: 'res', id: 'R2', a: parseTerminalId('D18'), b: parseTerminalId('D19'), r: 'R2_uohm' };
  if (index === 20) {
    return { k: 'res', id: 'MOT', a: parseTerminalId('D18'), b: parseTerminalId('D19'), r: 'R_arm_uohm', drives: 'dial' };
  }
  return { k: 'source', id: 'PSU', a: 'PLUS', b: 'MINUS' };
}

function sameApprovedRow(actual: object, expected: object, where: string): void {
  const got = actual as Record<string, unknown>;
  const want = expected as Record<string, unknown>;
  const keys = Object.keys(want);
  if (Object.keys(got).length !== keys.length) fail(where + ' does not match the approved topology');
  for (const key of keys) {
    const a = got[key];
    const b = want[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) fail(where + '.' + key + ' does not match the approved topology');
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) fail(where + '.' + key + '[' + i + '] must be ' + JSON.stringify(b[i]));
      }
    } else if (a !== b) {
      fail(where + '.' + key + ' must be ' + JSON.stringify(b));
    }
  }
}

function loadElements(raw: unknown): readonly NetElement[] {
  if (!Array.isArray(raw)) fail('elements must be an array');
  if (raw.length !== ELEMENT_COUNT) fail('elements count ' + raw.length + ' != ' + ELEMENT_COUNT);
  const out: NetElement[] = [];

  for (let i = 0; i < raw.length; i++) {
    const where = 'elements[' + i + ']';
    const row = obj(raw[i], where);
    const k = string(row['k'], where + '.k');
    const id = string(row['id'], where + '.id');

    if (k === 'lamp') {
      exactKeys(row, ['k', 'id', 'a', 'b', 'curve'], where);
      if (row['curve'] !== 'lamp6435') fail(where + '.curve must be "lamp6435"');
      out.push(Object.freeze({
        k,
        id,
        a: terminal(row['a'], where + '.a'),
        b: terminal(row['b'], where + '.b'),
        curve: 'lamp6435',
      }));
    } else if (k === 'coil') {
      exactKeys(row, ['k', 'id', 'a', 'b', 'relay'], where);
      const relay = integer(row['relay'], where + '.relay');
      if (relay < 1 || relay > 6) fail(where + '.relay must be 1..6');
      out.push(Object.freeze({ k, id, a: terminal(row['a'], where + '.a'), b: terminal(row['b'], where + '.b'), relay }));
    } else if (k === 'res') {
      const hasDrives = 'drives' in row;
      exactKeys(row, hasDrives ? ['k', 'id', 'a', 'b', 'r', 'drives'] : ['k', 'id', 'a', 'b', 'r'], where);
      const r = row['r'];
      if (r !== 'R1_uohm' && r !== 'R2_uohm' && r !== 'R_arm_uohm') {
        fail(where + '.r is not a resistance profile key');
      }
      if (hasDrives && row['drives'] !== 'dial') fail(where + '.drives must be "dial"');
      const a = terminal(row['a'], where + '.a');
      const b = terminal(row['b'], where + '.b');
      out.push(Object.freeze(hasDrives ? { k: 'res', id, a, b, r, drives: 'dial' as const } : { k: 'res', id, a, b, r }));
    } else if (k === 'source') {
      exactKeys(row, ['k', 'id', 'a', 'b'], where);
      if (row['a'] !== 'PLUS' || row['b'] !== 'MINUS') fail(where + ' must span PLUS to MINUS');
      out.push(Object.freeze({ k, id, a: 'PLUS', b: 'MINUS' }));
      if (i !== raw.length - 1) fail('source element must be last');
    } else {
      fail(where + '.k is unknown: ' + JSON.stringify(k));
    }
  }
  for (let i = 0; i < out.length; i++) sameApprovedRow(out[i] as NetElement, expectedElement(i), 'elements[' + i + ']');
  return Object.freeze(out);
}

function transferTerminals(row: Record<string, unknown>, where: string): {
  arm: TerminalId;
  nc: TerminalId;
  no: TerminalId;
} {
  return {
    arm: terminal(row['arm'], where + '.arm'),
    nc: terminal(row['nc'], where + '.nc'),
    no: terminal(row['no'], where + '.no'),
  };
}

function expectedContact(index: number): NetContact {
  if (index === 30) {
    const pads: TerminalId[] = [];
    for (let pad = 0; pad < 16; pad++) pads.push(parseTerminalId('D' + pad));
    return { k: 'wiper', arm: parseTerminalId('D16'), pads };
  }
  const section = Math.floor(index / 5) + 1;
  const within = index % 5;
  if (within === 0) {
    return { k: 'relay', n: section, set: 1, arm: sectionTerminal(section, 'H'), nc: sectionTerminal(section, 'J'), no: sectionTerminal(section, 'G') };
  }
  if (within === 1) {
    return { k: 'relay', n: section, set: 2, arm: sectionTerminal(section, 'L'), nc: sectionTerminal(section, 'N'), no: sectionTerminal(section, 'K') };
  }
  if (within === 2) {
    return { k: 'button', n: section, arm: sectionTerminal(section, 'Y'), nc: sectionTerminal(section, 'Z'), no: sectionTerminal(section, 'X') };
  }
  if (within === 3) {
    return { k: 'slide', n: section, set: 1, arm: sectionTerminal(section, 'S'), nc: sectionTerminal(section, 'R'), no: sectionTerminal(section, 'T') };
  }
  return { k: 'slide', n: section, set: 2, arm: sectionTerminal(section, 'V'), nc: sectionTerminal(section, 'U'), no: sectionTerminal(section, 'W') };
}

function loadContacts(raw: unknown): readonly NetContact[] {
  if (!Array.isArray(raw)) fail('contacts must be an array');
  if (raw.length !== CONTACT_COUNT) fail('contacts count ' + raw.length + ' != ' + CONTACT_COUNT);
  const out: NetContact[] = [];

  for (let i = 0; i < raw.length; i++) {
    const where = 'contacts[' + i + ']';
    const row = obj(raw[i], where);
    const k = string(row['k'], where + '.k');
    if (k === 'relay' || k === 'slide') {
      exactKeys(row, ['k', 'n', 'set', 'arm', 'nc', 'no'], where);
      const n = integer(row['n'], where + '.n');
      const set = integer(row['set'], where + '.set');
      if (n < 1 || n > 6) fail(where + '.n must be 1..6');
      if (set !== 1 && set !== 2) fail(where + '.set must be 1 or 2');
      const ends = transferTerminals(row, where);
      if (k === 'relay') {
        out.push(Object.freeze({ k, n, set, ...ends }));
      } else {
        out.push(Object.freeze({ k, n, set, ...ends }));
      }
    } else if (k === 'button') {
      exactKeys(row, ['k', 'n', 'arm', 'nc', 'no'], where);
      const n = integer(row['n'], where + '.n');
      if (n < 1 || n > 6) fail(where + '.n must be 1..6');
      out.push(Object.freeze({ k, n, ...transferTerminals(row, where) }));
    } else if (k === 'wiper') {
      exactKeys(row, ['k', 'arm', 'pads'], where);
      if (!Array.isArray(row['pads']) || row['pads'].length !== 16) fail(where + '.pads must contain 16 terminals');
      const pads: TerminalId[] = [];
      for (let p = 0; p < row['pads'].length; p++) pads.push(terminal(row['pads'][p], where + '.pads[' + p + ']'));
      out.push(Object.freeze({ k, arm: terminal(row['arm'], where + '.arm'), pads: Object.freeze(pads) }));
    } else {
      fail(where + '.k is unknown: ' + JSON.stringify(k));
    }
  }
  for (let i = 0; i < out.length; i++) sameApprovedRow(out[i] as NetContact, expectedContact(i), 'contacts[' + i + ']');
  return Object.freeze(out);
}

/** Load, validate and index exactly one `minivac.netlist/1` document. */
export function loadNetlist(rawBytes: Uint8Array): LoadedNetlist {
  const bytes = Uint8Array.from(rawBytes);
  // Hash first. Parsing must never change which bytes identify this netlist.
  const hash = fnv1a64(bytes);
  const raw = parseJson(bytes);
  exactKeys(raw, ['schema', 'terminals', 'bus', 'elements', 'contacts'], 'document');
  if (raw['schema'] !== NETLIST_SCHEMA) fail('schema must be ' + JSON.stringify(NETLIST_SCHEMA));

  loadTerminals(raw['terminals']);
  const bus = obj(raw['bus'], 'bus');
  exactKeys(bus, ['PLUS', 'MINUS'], 'bus');
  const plusMembers = loadBus(bus['PLUS'], 'PLUS');
  const minusMembers = loadBus(bus['MINUS'], 'MINUS');
  for (const id of plusMembers) if (minusMembers.includes(id)) fail(id + ' belongs to both power busses');
  const busTerminals = new Set<TerminalId>();
  for (const id of plusMembers) busTerminals.add(id);
  for (const id of minusMembers) busTerminals.add(id);
  if (TERMINAL_COUNT - busTerminals.size + 2 !== BASE_NODE_COUNT) {
    fail('base node count is not ' + BASE_NODE_COUNT);
  }

  return Object.freeze({
    schema: NETLIST_SCHEMA,
    hash,
    terminals: TERMINALS,
    terminalIds: TERMINAL_IDS,
    holePrefixes: HOLE_PREFIXES,
    plusMembers,
    minusMembers,
    elements: loadElements(raw['elements']),
    contacts: loadContacts(raw['contacts']),
  });
}
