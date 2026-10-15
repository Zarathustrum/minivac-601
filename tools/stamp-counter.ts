/**
 * Wave C's deliberately throwaway counter stamp. W2's `graph.ts` supersedes this file.
 *
 * The two wire lists below are literal, column-major transcriptions registered before this tool
 * existed. This file does not scrape Markdown, expand aliases, repair OCR, or read an external
 * emulator. It turns cords and the selected ideal contacts into super-nodes, then emits the 22
 * fixed physical elements in architecture §2.1's order.
 */
import { createHash } from 'node:crypto';
import type { Profile } from '../src/core/profile.ts';
import type { El } from '../src/core/solve.ts';

export type CounterProgramId = 'IV-EXP1' | 'ER-ALTCOUNTER';
export type CounterEvent = 'UP' | 'DOWN';
export type RowStatus = 'VALUE' | 'REFUSED' | 'NO_SETTLE' | 'NO_CROSSING';

export const COUNTER_PROGRAMS: Readonly<Record<CounterProgramId, readonly string[]>> = {
  'IV-EXP1': [
    '1A/2E', '1B/1-', '1C/2C', '1E/2G', '1F/2F', '1F/1H', '1G/1+', '1J/2H',
    '1J/4K', '2A/4E', '2B/2-', '2C/3C', '2E/2J', '2F/4A', '3A/6E', '3B/3-',
    '3C/4C', '3E/4G', '3F/3H', '3F/4F', '3G/3+', '3J/4H', '3J/6K', '3L/4L',
    '3N/4H', '4B/4-', '4C/5C', '4E/4J', '4F/5A', '5B/5-', '5C/6C', '5E/6G',
    '5F/6F', '5F/5H', '5G/5+', '5J/6H', '5J/6X', '5L/6L', '5N/6H', '6A/6F',
    '6B/6-', '6C/6-', '6E/6J', '6Y/6+',
  ],
  'ER-ALTCOUNTER': [
    '1A/2E', '1B/1C', '1B/2B', '1C/2C', '1E/2G', '1F/2F', '1F/1H', '1G/1+',
    '1H/4A', '1J/2H', '2A/4E', '2B/3B', '2C/2-', '2E/2J', '2G/2N', '2H/3L',
    '2L/2-', '3A/6E', '3B/4B', '3C/4C', '3E/4G', '3F/3H', '3F/4F', '3G/3+',
    '3H/5A', '3J/4H', '3N/4N', '4B/5B', '4C/4-', '4E/4J', '4G/4N', '4H/5L',
    '4L/4-', '5B/6B', '5C/6C', '5E/6G', '5F/6F', '5F/5H', '5G/5+', '5H/6A',
    '5J/6H', '5N/6N', '6C/6-', '6E/6J', '6G/6N', '6H/6X', '6L/6-', '6Y/6+',
  ],
};

const REGISTERED_PROGRAMS: Readonly<Record<CounterProgramId, { count: number; bytes: number; md5: string }>> = {
  'IV-EXP1': { count: 44, bytes: 263, md5: '2b75157c79751961312bb7495a3c2458' },
  'ER-ALTCOUNTER': { count: 48, bytes: 287, md5: '7c0b73bb92237c9629c317b626964665' },
};

const SECTION_LETTERS = 'ABCEFGHJKLNRSTUVWXYZ';
const TERMINAL = new RegExp(`^[1-6](?:[+\\-]|[${SECTION_LETTERS}])$`);
const WIRE = new RegExp(`^[1-6](?:[+\\-]|[${SECTION_LETTERS}])\/[1-6](?:[+\\-]|[${SECTION_LETTERS}])$`);

export interface RegisteredState {
  case: string;
  event: CounterEvent;
  /** Six bits in relay6..relay1 order. */
  mask: string;
}

export const REGISTERED_STATES: readonly RegisteredState[] = [
  { case: '0', event: 'UP', mask: '000000' },
  { case: '0->1', event: 'DOWN', mask: '010000' },
  { case: '1', event: 'UP', mask: '110000' },
  { case: '1->2', event: 'DOWN', mask: '100100' },
  { case: '2', event: 'UP', mask: '001100' },
  { case: '2->3', event: 'DOWN', mask: '011100' },
  { case: '3', event: 'UP', mask: '111100' },
  { case: '3->4', event: 'DOWN', mask: '101001' },
  { case: '4', event: 'UP', mask: '000011' },
  { case: '4->5', event: 'DOWN', mask: '010011' },
  { case: '5', event: 'UP', mask: '110011' },
  { case: '5->6', event: 'DOWN', mask: '100111' },
  { case: '6', event: 'UP', mask: '001111' },
  { case: '6->7', event: 'DOWN', mask: '011111' },
  { case: '7', event: 'UP', mask: '111111' },
  { case: '7->0', event: 'DOWN', mask: '101010' },
];

function md5(bytes: string | Uint8Array): string {
  return createHash('md5').update(bytes).digest('hex');
}

export function validateProgramLiteral(id: CounterProgramId, wires: readonly string[]): {
  count: number; bytes: number; md5: string;
} {
  const registered = REGISTERED_PROGRAMS[id];
  if (wires.length !== registered.count) {
    throw new Error(`${id}: expected exactly ${registered.count} tokens, got ${wires.length}`);
  }
  for (let i = 0; i < wires.length; i++) {
    const wire = wires[i] as string;
    if (!WIRE.test(wire)) throw new Error(`${id}: wire ${i + 1} ${JSON.stringify(wire)} is outside the strict grammar`);
    const [a, b] = wire.split('/');
    if (a === undefined || b === undefined || !TERMINAL.test(a) || !TERMINAL.test(b)) {
      throw new Error(`${id}: wire ${i + 1} ${JSON.stringify(wire)} is outside the strict grammar`);
    }
  }
  const text = wires.join('\n');
  const got = { count: wires.length, bytes: Buffer.byteLength(text), md5: md5(text) };
  if (got.bytes !== registered.bytes) {
    throw new Error(`${id}: expected ${registered.bytes} bytes, got ${got.bytes}`);
  }
  if (got.md5 !== registered.md5) {
    throw new Error(`${id}: expected MD5 ${registered.md5}, got ${got.md5}`);
  }
  return got;
}

interface ContactDecision {
  id: string;
  arm: string;
  activeTerminal: string;
  inactiveTerminal: string;
}

export interface StampElement {
  id: string;
  kind: El['k'];
  a: string;
  b: string;
}

export interface CounterStamp {
  program: CounterProgramId;
  profile: Profile;
  els: El[];
  datum: number;
  elements: StampElement[];
  contacts: ContactDecision[];
  cords: readonly { wire: string; united: boolean }[];
  /** Every relevant terminal in its super-node, keyed by dense solver node. */
  members: readonly (readonly string[])[];
  /** Terminal to dense solver node. */
  nodeByTerminal: Readonly<Record<string, number>>;
}

export interface StampOpts {
  event: CounterEvent;
  mask: string;
  pushbutton6Down: boolean;
  /** Gate T deliberately includes only the contact families named by its independent oracle. */
  gateT?: boolean;
}

const PLUS_MEMBERS = ['1+', '2+', '3+', '4+', '5+', '6+', 'M+'] as const;
const DATUM_MEMBERS = ['1-', '2-', '3-', '4-', '5-', '6-', 'M-'] as const;

function relayOperated(mask: string, relay: number): boolean {
  if (!/^[01]{6}$/.test(mask)) throw new Error(`counter stamp: invalid relay6..relay1 mask ${JSON.stringify(mask)}`);
  return mask[6 - relay] === '1';
}

/** A local, deterministic DSU. No global mutable stamp state crosses cases. */
class Dsu {
  readonly names: string[] = [];
  readonly ids = new Map<string, number>();
  parent: number[] = [];

  id(name: string): number {
    const old = this.ids.get(name);
    if (old !== undefined) return old;
    const id = this.names.length;
    this.names.push(name);
    this.ids.set(name, id);
    this.parent.push(id);
    return id;
  }

  find(x: number): number {
    let root = x;
    while ((this.parent[root] as number) !== root) root = this.parent[root] as number;
    while ((this.parent[x] as number) !== x) {
      const next = this.parent[x] as number;
      this.parent[x] = root;
      x = next;
    }
    return root;
  }

  unionNames(a: string, b: string): void {
    const ra = this.find(this.id(a));
    const rb = this.find(this.id(b));
    if (ra === rb) return;
    this.parent[ra > rb ? ra : rb] = ra > rb ? rb : ra;
  }
}

interface Physical {
  id: string;
  kind: El['k'];
  a: string;
  b: string;
}

function physicalElements(): Physical[] {
  const out: Physical[] = [];
  for (let n = 1; n <= 6; n++) out.push({ id: `output-lamp-${n}`, kind: 'lamp', a: `${n}A`, b: `${n}B` });
  for (let n = 1; n <= 6; n++) out.push({ id: `indicator-lamp-${n}`, kind: 'lamp', a: `${n}C`, b: `${n}E` });
  for (let n = 1; n <= 6; n++) out.push({ id: `coil-${n}`, kind: 'coil', a: `${n}E`, b: `${n}F` });
  out.push({ id: 'R1', kind: 'res', a: 'D17', b: 'D19' });
  out.push({ id: 'R2', kind: 'res', a: 'D18', b: 'D19' });
  out.push({ id: 'motor', kind: 'res', a: 'D18', b: 'D19' });
  out.push({ id: 'source', kind: 'source', a: 'PLUS', b: 'MINUS' });
  return out;
}

function canonicalName(members: readonly string[]): string {
  if (members.includes('MINUS')) return 'D';
  if (members.includes('PLUS')) return 'P';
  if (members.includes('3A')) return 'Q';
  return members[0] as string;
}

export function stampCounter(program: CounterProgramId, opts: StampOpts, profile: Profile): CounterStamp {
  validateProgramLiteral(program, COUNTER_PROGRAMS[program]);
  if ((opts.event === 'DOWN') !== opts.pushbutton6Down) {
    throw new Error(`counter stamp: event ${opts.event} disagrees with pushbutton 6 ${opts.pushbutton6Down ? 'DOWN' : 'UP'}`);
  }
  const dsu = new Dsu();
  const partitionRelevant = new Set<string>();
  const contacts: ContactDecision[] = [];
  const touch = (name: string, report: boolean): void => {
    dsu.id(name);
    if (report) partitionRelevant.add(name);
  };
  const unite = (a: string, b: string, report = false): void => {
    touch(a, report);
    touch(b, report);
    dsu.unionNames(a, b);
  };

  touch('PLUS', true);
  touch('MINUS', true);
  for (const n of PLUS_MEMBERS) unite('PLUS', n, true);
  for (const n of DATUM_MEMBERS) unite('MINUS', n, true);
  for (const wire of COUNTER_PROGRAMS[program]) {
    const [a, b] = wire.split('/') as [string, string];
    unite(a, b, true);
  }

  for (let n = 1; n <= 6; n++) {
    const operated = relayOperated(opts.mask, n);
    const senses = operated
      ? [[`${n}H`, `${n}G`], [`${n}L`, `${n}K`]] as const
      : [[`${n}H`, `${n}J`], [`${n}L`, `${n}N`]] as const;
    for (let set = 0; set < senses.length; set++) {
      const [arm, sense] = senses[set] as readonly [string, string];
      unite(arm, sense);
      const inactiveTerminal = operated ? (set === 0 ? `${n}J` : `${n}N`) : (set === 0 ? `${n}G` : `${n}K`);
      contacts.push({ id: `relay-${n}-set-${set + 1}`, arm, activeTerminal: sense, inactiveTerminal });
    }
  }
  for (let n = 1; n <= 6; n++) {
    const down = n === 6 && opts.pushbutton6Down;
    const arm = `${n}Y`;
    const sense = down ? `${n}X` : `${n}Z`;
    unite(arm, sense);
    contacts.push({
      id: `pushbutton-${n}`, arm, activeTerminal: sense, inactiveTerminal: down ? `${n}Z` : `${n}X`,
    });
  }
  if (opts.gateT !== true) {
    for (let n = 1; n <= 6; n++) {
      unite(`${n}S`, `${n}R`);
      unite(`${n}V`, `${n}U`);
      contacts.push({ id: `slide-${n}-set-1`, arm: `${n}S`, activeTerminal: `${n}R`, inactiveTerminal: `${n}T` });
      contacts.push({ id: `slide-${n}-set-2`, arm: `${n}V`, activeTerminal: `${n}U`, inactiveTerminal: `${n}W` });
    }
    unite('D16', 'D0');
    contacts.push({ id: 'wiper', arm: 'D16', activeTerminal: 'D0', inactiveTerminal: 'D1..D15' });
  }

  const physical = physicalElements();
  for (const e of physical) {
    if (e.a !== 'PLUS' && e.a !== 'MINUS') touch(e.a, true);
    if (e.b !== 'PLUS' && e.b !== 'MINUS') touch(e.b, true);
  }

  const groups = new Map<number, string[]>();
  const relevantRoots = new Set<number>();
  for (const name of partitionRelevant) relevantRoots.add(dsu.find(dsu.id(name)));
  for (const name of dsu.names) {
    const root = dsu.find(dsu.id(name));
    if (!relevantRoots.has(root)) continue;
    const group = groups.get(root) ?? [];
    group.push(name);
    groups.set(root, group);
  }
  for (const group of groups.values()) group.sort();

  const datumRoot = dsu.find(dsu.id('MINUS'));
  const plusRoot = dsu.find(dsu.id('PLUS'));
  const roots = [...groups.keys()].sort((a, b) => {
    if (a === datumRoot) return b === datumRoot ? 0 : -1;
    if (b === datumRoot) return 1;
    const aa = (groups.get(a) as string[])[0] as string;
    const bb = (groups.get(b) as string[])[0] as string;
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  });
  const dense = new Map<number, number>();
  const members: string[][] = [];
  for (let i = 0; i < roots.length; i++) {
    dense.set(roots[i] as number, i);
    members.push(groups.get(roots[i] as number) as string[]);
  }
  if (dense.get(datumRoot) !== 0) throw new Error('counter stamp: datum was not assigned node 0');
  const nodeByTerminal: Record<string, number> = {};
  for (const [root, node] of dense) for (const name of groups.get(root) as string[]) nodeByTerminal[name] = node;
  nodeByTerminal['PLUS'] = dense.get(plusRoot) as number;
  nodeByTerminal['MINUS'] = 0;

  const endpoint = (name: string): number => {
    const node = nodeByTerminal[name];
    if (node === undefined) throw new Error(`counter stamp: no dense node for ${name}`);
    return node;
  };
  const elements: StampElement[] = [];
  const els: El[] = [];
  let coilN = 0;
  for (const e of physical) {
    const a = endpoint(e.a);
    const b = endpoint(e.b);
    const aName = canonicalName(members[a] as string[]);
    const bName = canonicalName(members[b] as string[]);
    elements.push({ id: e.id, kind: e.kind, a: aName, b: bName });
    if (e.kind === 'lamp') els.push({ k: 'lamp', a, b });
    else if (e.kind === 'coil') {
      els.push({ k: 'coil', a, b, rOhm: profile.v.R_coil_uohm * 1e-6, lH: profile.v.L_coil_uh * 1e-6 });
      coilN++;
    } else if (e.kind === 'res') {
      const r = e.id === 'R1' ? profile.v.R1_uohm : e.id === 'R2' ? profile.v.R2_uohm : profile.v.R_arm_uohm;
      els.push({ k: 'res', a, b, rOhm: r * 1e-6 });
    } else {
      els.push({ k: 'source', a, b, vOc: profile.v.V_oc_mv * 1e-3, rSrcOhm: profile.v.R_src_uohm * 1e-6 });
    }
  }
  if (coilN !== 6 || els.length !== 22) throw new Error('counter stamp: physical element count changed');
  const cords = COUNTER_PROGRAMS[program].map((wire) => {
    const [a, b] = wire.split('/') as [string, string];
    return { wire, united: nodeByTerminal[a] === nodeByTerminal[b] };
  });
  return { program, profile, els, datum: 0, elements, contacts, cords, members, nodeByTerminal };
}

const GATE_T_PARTITION: readonly (readonly [string, readonly string[]])[] = [
  ['P', ['1+', '1G', '2+', '3+', '3G', '4+', '5+', '5G', '6+', '6Y', '6Z', 'M+', 'PLUS']],
  ['D', [
    '1-', '1A', '1B', '1C', '1E', '1F', '1H', '1J', '2-', '2A', '2B', '2C', '2E', '2F',
    '2G', '2H', '2J', '2L', '2N', '3-', '3B', '3C', '3E', '3F', '3H', '3J', '3L', '3N',
    '4-', '4A', '4B', '4C', '4E', '4F', '4G', '4H', '4J', '4L', '4N', '5-', '5A', '5B',
    '5C', '5E', '5L', '5N', '6-', '6B', '6C', '6G', '6L', '6N', 'M-', 'MINUS',
  ]],
  ['Q', ['3A', '5F', '5H', '5J', '6A', '6E', '6F', '6H', '6J', '6X']],
  ['D17', ['D17']],
  ['D18', ['D18']],
  ['D19', ['D19']],
];

const GATE_T_ELEMENTS: readonly StampElement[] = [
  { id: 'output-lamp-1', kind: 'lamp', a: 'D', b: 'D' },
  { id: 'output-lamp-2', kind: 'lamp', a: 'D', b: 'D' },
  { id: 'output-lamp-3', kind: 'lamp', a: 'Q', b: 'D' },
  { id: 'output-lamp-4', kind: 'lamp', a: 'D', b: 'D' },
  { id: 'output-lamp-5', kind: 'lamp', a: 'D', b: 'D' },
  { id: 'output-lamp-6', kind: 'lamp', a: 'Q', b: 'D' },
  { id: 'indicator-lamp-1', kind: 'lamp', a: 'D', b: 'D' },
  { id: 'indicator-lamp-2', kind: 'lamp', a: 'D', b: 'D' },
  { id: 'indicator-lamp-3', kind: 'lamp', a: 'D', b: 'D' },
  { id: 'indicator-lamp-4', kind: 'lamp', a: 'D', b: 'D' },
  { id: 'indicator-lamp-5', kind: 'lamp', a: 'D', b: 'D' },
  { id: 'indicator-lamp-6', kind: 'lamp', a: 'D', b: 'Q' },
  { id: 'coil-1', kind: 'coil', a: 'D', b: 'D' },
  { id: 'coil-2', kind: 'coil', a: 'D', b: 'D' },
  { id: 'coil-3', kind: 'coil', a: 'D', b: 'D' },
  { id: 'coil-4', kind: 'coil', a: 'D', b: 'D' },
  { id: 'coil-5', kind: 'coil', a: 'D', b: 'Q' },
  { id: 'coil-6', kind: 'coil', a: 'Q', b: 'Q' },
  { id: 'R1', kind: 'res', a: 'D17', b: 'D19' },
  { id: 'R2', kind: 'res', a: 'D18', b: 'D19' },
  { id: 'motor', kind: 'res', a: 'D18', b: 'D19' },
  { id: 'source', kind: 'source', a: 'P', b: 'D' },
];

/** Independently authored from the released-contact senses frozen in the Wave C protocol. */
const GATE_T_CONTACTS: readonly ContactDecision[] = [
  { id: 'relay-1-set-1', arm: '1H', activeTerminal: '1J', inactiveTerminal: '1G' },
  { id: 'relay-1-set-2', arm: '1L', activeTerminal: '1N', inactiveTerminal: '1K' },
  { id: 'relay-2-set-1', arm: '2H', activeTerminal: '2J', inactiveTerminal: '2G' },
  { id: 'relay-2-set-2', arm: '2L', activeTerminal: '2N', inactiveTerminal: '2K' },
  { id: 'relay-3-set-1', arm: '3H', activeTerminal: '3J', inactiveTerminal: '3G' },
  { id: 'relay-3-set-2', arm: '3L', activeTerminal: '3N', inactiveTerminal: '3K' },
  { id: 'relay-4-set-1', arm: '4H', activeTerminal: '4J', inactiveTerminal: '4G' },
  { id: 'relay-4-set-2', arm: '4L', activeTerminal: '4N', inactiveTerminal: '4K' },
  { id: 'relay-5-set-1', arm: '5H', activeTerminal: '5J', inactiveTerminal: '5G' },
  { id: 'relay-5-set-2', arm: '5L', activeTerminal: '5N', inactiveTerminal: '5K' },
  { id: 'relay-6-set-1', arm: '6H', activeTerminal: '6J', inactiveTerminal: '6G' },
  { id: 'relay-6-set-2', arm: '6L', activeTerminal: '6N', inactiveTerminal: '6K' },
  { id: 'pushbutton-1', arm: '1Y', activeTerminal: '1Z', inactiveTerminal: '1X' },
  { id: 'pushbutton-2', arm: '2Y', activeTerminal: '2Z', inactiveTerminal: '2X' },
  { id: 'pushbutton-3', arm: '3Y', activeTerminal: '3Z', inactiveTerminal: '3X' },
  { id: 'pushbutton-4', arm: '4Y', activeTerminal: '4Z', inactiveTerminal: '4X' },
  { id: 'pushbutton-5', arm: '5Y', activeTerminal: '5Z', inactiveTerminal: '5X' },
  { id: 'pushbutton-6', arm: '6Y', activeTerminal: '6Z', inactiveTerminal: '6X' },
];

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const aa = [...a].sort();
  const bb = [...b].sort();
  return aa.every((x, i) => x === bb[i]);
}

/** Compare against a separately authored oracle, never against a digest. */
export function gateTAgainstOracle(stamp: Pick<CounterStamp, 'members' | 'elements' | 'contacts' | 'cords'>): string[] {
  const bad: string[] = [];
  if (stamp.members.length !== GATE_T_PARTITION.length) {
    bad.push(`Gate T partition count ${stamp.members.length} != ${GATE_T_PARTITION.length}`);
  }
  for (const [label, expectedWithAliases] of GATE_T_PARTITION) {
    const expected = expectedWithAliases.filter((x) => x !== 'PLUS' && x !== 'MINUS');
    const group = stamp.members.find((m) => {
      if (label === 'P') return m.includes('PLUS');
      if (label === 'D') return m.includes('MINUS');
      if (label === 'Q') return m.includes('3A');
      return m.includes(label);
    });
    const got = (group ?? []).filter((x) => x !== 'PLUS' && x !== 'MINUS');
    if (!sameStrings(got, expected)) bad.push(`Gate T partition ${label}: [${got.join(' ')}] != [${expected.join(' ')}]`);
  }
  if (stamp.cords.length !== COUNTER_PROGRAMS['ER-ALTCOUNTER'].length) {
    bad.push(`Gate T cord decisions ${stamp.cords.length} != ${COUNTER_PROGRAMS['ER-ALTCOUNTER'].length}`);
  }
  for (let i = 0; i < COUNTER_PROGRAMS['ER-ALTCOUNTER'].length; i++) {
    const got = stamp.cords[i];
    const want = COUNTER_PROGRAMS['ER-ALTCOUNTER'][i];
    if (got === undefined || got.wire !== want || got.united !== true) {
      bad.push(`Gate T cord ${i + 1}: ${got === undefined ? 'missing' : `${got.wire} united=${got.united}`} != ${want} united=true`);
    }
  }
  if (stamp.elements.length !== GATE_T_ELEMENTS.length) {
    bad.push(`Gate T element count ${stamp.elements.length} != ${GATE_T_ELEMENTS.length}`);
  }
  for (let i = 0; i < GATE_T_ELEMENTS.length; i++) {
    const got = stamp.elements[i];
    const want = GATE_T_ELEMENTS[i];
    if (got === undefined || want === undefined || got.id !== want.id || got.kind !== want.kind || got.a !== want.a || got.b !== want.b) {
      bad.push(`Gate T element ${i + 1}: ${got === undefined ? 'missing' : `${got.id} ${got.kind} ${got.a}->${got.b}`} != ${want === undefined ? 'unexpected' : `${want.id} ${want.kind} ${want.a}->${want.b}`}`);
    }
  }
  if (stamp.contacts.length !== GATE_T_CONTACTS.length) {
    bad.push(`Gate T contact decisions ${stamp.contacts.length} != ${GATE_T_CONTACTS.length}`);
  }
  const contactIds = stamp.contacts.map((c) => c.id);
  if (new Set(contactIds).size !== contactIds.length) bad.push('Gate T contact ids are not unique');
  for (let i = 0; i < GATE_T_CONTACTS.length; i++) {
    const got = stamp.contacts[i];
    const want = GATE_T_CONTACTS[i];
    if (got === undefined || want === undefined || got.id !== want.id || got.arm !== want.arm ||
        got.activeTerminal !== want.activeTerminal || got.inactiveTerminal !== want.inactiveTerminal) {
      const show = (c: ContactDecision | undefined): string => c === undefined ? 'missing' :
        `${c.id} arm=${c.arm} active=${c.activeTerminal} inactive=${c.inactiveTerminal}`;
      bad.push(`Gate T contact ${i + 1}: ${show(got)} != ${show(want)}`);
    }
  }
  return bad;
}

export function runGateT(profile: Profile): CounterStamp & { violations: string[] } {
  const stamp = stampCounter('ER-ALTCOUNTER', {
    event: 'UP', mask: '000000', pushbutton6Down: false, gateT: true,
  }, profile);
  return { ...stamp, violations: gateTAgainstOracle(stamp) };
}

export interface GatePRefusal {
  members: string[];
  coils: [string, string];
}

/** Gate P's current-free structural predicate over non-collapsed physical elements. */
export function gateP(stamp: CounterStamp): GatePRefusal[] {
  const incident: { id: string; kind: El['k'] }[][] = stamp.members.map(() => []);
  for (let i = 0; i < stamp.els.length; i++) {
    const el = stamp.els[i] as El;
    if (el.a === el.b) continue;
    const desc = stamp.elements[i] as StampElement;
    const a = incident[el.a];
    const b = incident[el.b];
    if (a === undefined || b === undefined) {
      throw new Error(`gate P: element ${desc.id} references a node with no super-node entry`);
    }
    a.push({ id: desc.id, kind: desc.kind });
    b.push({ id: desc.id, kind: desc.kind });
  }
  const out: GatePRefusal[] = [];
  for (let node = 0; node < incident.length; node++) {
    if (node === stamp.datum) continue;
    const xs = incident[node] as { id: string; kind: El['k'] }[];
    if (xs.length === 2 && xs[0]?.kind === 'coil' && xs[1]?.kind === 'coil' && xs[0].id !== xs[1].id) {
      out.push({ members: [...(stamp.members[node] as string[])], coils: [xs[0].id, xs[1].id] });
    }
  }
  return out;
}
