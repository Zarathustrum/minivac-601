/**
 * Turn the fixed panel, patch cords and one frozen contact configuration into solver elements.
 *
 * Zero-ohm connections are unioned. Physical components and positive-resistance cords span the
 * resulting super-nodes. DSU roots are never observable: node ids come only from ascending minimum
 * member terminal index, with the MINUS super-node assigned the final sentinel id and no row.
 */
import { terminalIndex } from './terminals.ts';
import type { TerminalId } from './terminals.ts';
import type { LoadedNetlist, NetContact, NetElement, SourceDef } from './netlist.ts';
import type { Profile } from './profile.ts';
import type { El } from './solve.ts';

export const CONTACT_OPEN = -1;
export const CONTACT_NC = 0;
export const CONTACT_NO = 1;

export interface ResolvedCord {
  /** Frozen command-schema id: int32 0..255. */
  readonly id: number;
  /** Terminal index, or -1 for a free end. */
  readonly a: number;
  readonly b: number;
  /** Absent and zero are ideal cords; positive values are resistor elements in µΩ. */
  readonly rUohm?: number;
}

export interface GraphInput {
  readonly cords: ArrayLike<ResolvedCord>;
  /** Netlist contact order. Transfer: -1/0/1 = open/NC/NO. Wiper: -1 or pad 0..15. */
  readonly contactPosition: ArrayLike<number>;
}

export interface BuiltGraph {
  readonly elements: readonly Readonly<El>[];
  /** Parallel to `elements`; dynamic resistor cords use `cord:<id>`. */
  readonly elementIds: readonly string[];
  /** Terminal index -> canonical graph-node id. */
  readonly nodeByTerminal: readonly number[];
  /** Canonical node id -> ascending terminal indices. The datum is the final entry. */
  readonly members: readonly (readonly number[])[];
  /** Per graph-node id, 1 iff reached by the source-component element walk. */
  readonly inSource: readonly number[];
  readonly nodeCount: number;
  /** Final sentinel node id. It is never a matrix row. */
  readonly datum: number;
  readonly sourceNode: number;
}

export const GRAPH_TERMINALS = 186;
export const GRAPH_MAX_NODES = 174;
export const GRAPH_MAX_ROWS = 173;
export const GRAPH_MAX_CORDS = 256;
export const GRAPH_FIXED_ELEMENTS = 22;
export const GRAPH_MAX_ELEMENTS = GRAPH_FIXED_ELEMENTS + GRAPH_MAX_CORDS;
const INT32_MAX = 2147483647;

interface ElementSlot {
  k: El['k'];
  a: number;
  b: number;
  rOhm: number;
  lH: number;
  vOc: number;
  rSrcOhm: number;
}

/**
 * Fixed-capacity graph output and construction scratch owned by one caller.
 *
 * Only indices below the corresponding active count are meaningful after `buildGraphInto`.
 * The underscored arrays are construction scratch, not retained topology.
 */
export class GraphWorkspace {
  readonly elements: readonly Readonly<El>[];
  readonly elementIds: readonly string[];
  readonly nodeByTerminal = new Int16Array(GRAPH_TERMINALS);
  readonly memberOffsets = new Int16Array(GRAPH_MAX_NODES + 1);
  readonly memberTerminals = new Int16Array(GRAPH_TERMINALS);
  readonly inSource = new Uint8Array(GRAPH_MAX_NODES);
  elementCount = 0;
  nodeCount = 0;
  datum = 0;
  sourceNode = 0;
  sourceEnabled = false;

  /** @internal */ readonly _elementSlots: ElementSlot[];
  /** @internal */ readonly _elementIds: string[];
  /** @internal */ readonly _cordElementIds: readonly string[];
  /** @internal */ readonly _parent = new Int16Array(GRAPH_TERMINALS);
  /** @internal */ readonly _size = new Int16Array(GRAPH_TERMINALS);
  /** @internal */ readonly _rootMin = new Int16Array(GRAPH_TERMINALS);
  /** @internal */ readonly _rootNode = new Int16Array(GRAPH_TERMINALS);
  /** @internal */ readonly _memberCounts = new Int16Array(GRAPH_MAX_NODES);
  /** @internal */ readonly _memberCursor = new Int16Array(GRAPH_MAX_NODES);
  /** @internal */ readonly _cordPresent = new Uint8Array(GRAPH_MAX_CORDS);
  /** @internal */ readonly _cordA = new Int16Array(GRAPH_MAX_CORDS);
  /** @internal */ readonly _cordB = new Int16Array(GRAPH_MAX_CORDS);
  /** @internal */ readonly _cordR = new Int32Array(GRAPH_MAX_CORDS);

  constructor() {
    this._elementSlots = Array.from({ length: GRAPH_MAX_ELEMENTS }, () => ({
      k: 'res', a: 0, b: 0, rOhm: 1, lH: 0, vOc: 0, rSrcOhm: 1,
    }));
    this._elementIds = new Array<string>(GRAPH_MAX_ELEMENTS).fill('');
    this._cordElementIds = Object.freeze(
      Array.from({ length: GRAPH_MAX_CORDS }, (_unused, id) => 'cord:' + id),
    );
    this.elements = this._elementSlots as unknown as readonly Readonly<El>[];
    this.elementIds = this._elementIds;
  }
}

export function createGraphWorkspace(): GraphWorkspace {
  return new GraphWorkspace();
}

function fail(message: string): never {
  throw new Error('graph: ' + message);
}

function find(workspace: GraphWorkspace, x: number): number {
  const parent = workspace._parent;
  let root = x;
  while ((parent[root] as number) !== root) root = parent[root] as number;
  while ((parent[x] as number) !== x) {
    const next = parent[x] as number;
    parent[x] = root;
    x = next;
  }
  return root;
}

/** Union by size; equal-sized roots choose the smaller index so even the hidden tree is stable. */
function union(workspace: GraphWorkspace, a: number, b: number): void {
  const parent = workspace._parent;
  const size = workspace._size;
  let ra = find(workspace, a);
  let rb = find(workspace, b);
  if (ra === rb) return;
  const sa = size[ra] as number;
  const sb = size[rb] as number;
  if (sa < sb || (sa === sb && ra > rb)) {
    const swap = ra;
    ra = rb;
    rb = swap;
  }
  parent[rb] = ra;
  size[ra] = sa + sb;
}

function tid(id: TerminalId): number {
  return terminalIndex(id);
}

function resetWorkspace(workspace: GraphWorkspace): void {
  workspace.elementCount = 0;
  workspace.nodeCount = 0;
  workspace.datum = 0;
  workspace.sourceNode = 0;
  workspace.sourceEnabled = false;
  workspace._cordPresent.fill(0);
  for (let i = 0; i < GRAPH_TERMINALS; i++) {
    workspace._parent[i] = i;
    workspace._size[i] = 1;
    workspace._rootMin[i] = -1;
    workspace._rootNode[i] = -1;
  }
}

function checkTerminalIndex(index: number, where: string): void {
  if (!Number.isInteger(index) || index < -1 || index >= GRAPH_TERMINALS) {
    fail(where + ' terminal index must be -1 or 0..185');
  }
}

/** Validate once into an id-indexed scratch table, then every electrical pass is CordId order. */
function indexCords(workspace: GraphWorkspace, cords: ArrayLike<ResolvedCord>): void {
  const cordCount = cords.length;
  if (!Number.isInteger(cordCount) || cordCount < 0) {
    fail('cords length must be an integer in 0..256');
  }
  if (cordCount > GRAPH_MAX_CORDS) fail('more than 256 cords');
  for (let i = 0; i < cordCount; i++) {
    const value: unknown = cords[i];
    if (typeof value !== 'object' || value === null) {
      fail('cord[' + i + '] must be a non-null object');
    }
    const cord = value as ResolvedCord;
    if (!Number.isInteger(cord.id) || cord.id < 0 || cord.id >= GRAPH_MAX_CORDS) {
      fail('cord[' + i + '].id must be 0..255');
    }
    if (workspace._cordPresent[cord.id] === 1) fail('duplicate cord id ' + cord.id);
    checkTerminalIndex(cord.a, 'cord ' + cord.id + ' end a');
    checkTerminalIndex(cord.b, 'cord ' + cord.id + ' end b');
    const r = cord.rUohm ?? 0;
    if (!Number.isInteger(r) || r < 0 || r > INT32_MAX) fail('cord ' + cord.id + ' rUohm must be int32 >= 0');
    workspace._cordPresent[cord.id] = 1;
    workspace._cordA[cord.id] = cord.a;
    workspace._cordB[cord.id] = cord.b;
    workspace._cordR[cord.id] = r;
  }
}

function unionBusses(workspace: GraphWorkspace, netlist: LoadedNetlist): void {
  const plus0 = tid(netlist.plusMembers[0] as TerminalId);
  const minus0 = tid(netlist.minusMembers[0] as TerminalId);
  for (let i = 1; i < netlist.plusMembers.length; i++) {
    union(workspace, plus0, tid(netlist.plusMembers[i] as TerminalId));
  }
  for (let i = 1; i < netlist.minusMembers.length; i++) {
    union(workspace, minus0, tid(netlist.minusMembers[i] as TerminalId));
  }
}

function unionIdealCords(workspace: GraphWorkspace): void {
  for (let id = 0; id < GRAPH_MAX_CORDS; id++) {
    const a = workspace._cordA[id] as number;
    const b = workspace._cordB[id] as number;
    if (workspace._cordPresent[id] === 0 || a < 0 || b < 0 || (workspace._cordR[id] as number) > 0) continue;
    union(workspace, a, b);
  }
}

function unionContact(workspace: GraphWorkspace, contact: NetContact, position: number, index: number): void {
  if (!Number.isInteger(position)) fail('contactPosition[' + index + '] must be an integer');
  if (contact.k === 'wiper') {
    if (position === CONTACT_OPEN) return;
    if (position < 0 || position >= contact.pads.length) fail('wiper position must be -1 or 0..15');
    union(workspace, tid(contact.arm), tid(contact.pads[position] as TerminalId));
    return;
  }
  if (position === CONTACT_OPEN) return;
  if (position === CONTACT_NC) union(workspace, tid(contact.arm), tid(contact.nc));
  else if (position === CONTACT_NO) union(workspace, tid(contact.arm), tid(contact.no));
  else fail('transfer contact position must be -1, 0 or 1 at index ' + index);
}

function unionContacts(workspace: GraphWorkspace, netlist: LoadedNetlist, positions: ArrayLike<number>): void {
  if (positions.length !== netlist.contacts.length) {
    fail('contactPosition length ' + positions.length + ' != ' + netlist.contacts.length);
  }
  for (let i = 0; i < netlist.contacts.length; i++) {
    unionContact(workspace, netlist.contacts[i] as NetContact, positions[i] as number, i);
  }
}

function canonicalNodesInto(workspace: GraphWorkspace, netlist: LoadedNetlist): void {
  const rootMin = workspace._rootMin;
  const rootNode = workspace._rootNode;
  for (let terminal = 0; terminal < GRAPH_TERMINALS; terminal++) {
    const root = find(workspace, terminal);
    if ((rootMin[root] as number) < 0) rootMin[root] = terminal;
  }
  const datumRoot = find(workspace, tid(netlist.minusMembers[0] as TerminalId));
  let next = 0;
  for (let terminal = 0; terminal < GRAPH_TERMINALS; terminal++) {
    const root = find(workspace, terminal);
    if (root !== datumRoot && (rootMin[root] as number) === terminal) {
      rootNode[root] = next;
      next++;
    }
  }
  const datum = next;
  rootNode[datumRoot] = datum;
  const nodeCount = datum + 1;
  if (nodeCount > GRAPH_MAX_NODES) fail('more than 174 panel nodes after union');
  if (datum > GRAPH_MAX_ROWS) fail('more than 173 non-datum panel nodes');

  for (let node = 0; node < nodeCount; node++) workspace._memberCounts[node] = 0;
  for (let terminal = 0; terminal < GRAPH_TERMINALS; terminal++) {
    const node = rootNode[find(workspace, terminal)] as number;
    if (node < 0) fail('terminal ' + terminal + ' has no canonical node');
    workspace.nodeByTerminal[terminal] = node;
    workspace._memberCounts[node] = (workspace._memberCounts[node] as number) + 1;
  }
  let offset = 0;
  for (let node = 0; node < nodeCount; node++) {
    workspace.memberOffsets[node] = offset;
    workspace._memberCursor[node] = offset;
    offset += workspace._memberCounts[node] as number;
  }
  workspace.memberOffsets[nodeCount] = offset;
  for (let terminal = 0; terminal < GRAPH_TERMINALS; terminal++) {
    const node = workspace.nodeByTerminal[terminal] as number;
    const at = workspace._memberCursor[node] as number;
    workspace.memberTerminals[at] = terminal;
    workspace._memberCursor[node] = at + 1;
  }
  workspace.nodeCount = nodeCount;
  workspace.datum = datum;
}

function endpoint(id: TerminalId, nodeByTerminal: Int16Array): number {
  return nodeByTerminal[tid(id)] as number;
}

function setFixedElement(
  slot: ElementSlot,
  def: Exclude<NetElement, SourceDef>,
  profile: Profile,
  nodes: Int16Array,
): void {
  slot.a = endpoint(def.a, nodes);
  slot.b = endpoint(def.b, nodes);
  slot.k = def.k;
  if (def.k === 'lamp') return;
  if (def.k === 'coil') {
    slot.rOhm = profile.v.R_coil_uohm * 1e-6;
    slot.lH = profile.v.L_coil_uh * 1e-6;
    return;
  }
  slot.rOhm = profile.v[def.r] * 1e-6;
}

function buildElementsInto(
  workspace: GraphWorkspace,
  netlist: LoadedNetlist,
  profile: Profile,
  nodes: Int16Array,
): void {
  const last = netlist.elements[netlist.elements.length - 1];
  if (last === undefined || last.k !== 'source') fail('fixed source is not last');

  let at = 0;
  for (let i = 0; i < netlist.elements.length - 1; i++) {
    const def = netlist.elements[i];
    if (def === undefined || def.k === 'source') fail('source appears before the final fixed element');
    setFixedElement(workspace._elementSlots[at] as ElementSlot, def, profile, nodes);
    workspace._elementIds[at] = def.id;
    at++;
  }
  for (let id = 0; id < GRAPH_MAX_CORDS; id++) {
    const a = workspace._cordA[id] as number;
    const b = workspace._cordB[id] as number;
    const rUohm = workspace._cordR[id] as number;
    if (workspace._cordPresent[id] === 0 || a < 0 || b < 0 || rUohm === 0) continue;
    const slot = workspace._elementSlots[at] as ElementSlot;
    slot.k = 'res';
    slot.a = nodes[a] as number;
    slot.b = nodes[b] as number;
    slot.rOhm = rUohm * 1e-6;
    workspace._elementIds[at] = workspace._cordElementIds[id] as string;
    at++;
  }

  const source = workspace._elementSlots[at] as ElementSlot;
  source.k = 'source';
  source.a = nodes[tid(netlist.plusMembers[0] as TerminalId)] as number;
  source.b = nodes[tid(netlist.minusMembers[0] as TerminalId)] as number;
  source.vOc = profile.v.V_oc_mv * 1e-3;
  source.rSrcOhm = profile.v.R_src_uohm * 1e-6;
  workspace._elementIds[at] = last.id;
  at++;
  if (at > GRAPH_MAX_ELEMENTS) fail('more than 278 active elements');
  workspace.elementCount = at;
  workspace.sourceNode = source.a;
}

/** Source-component prune over post-union physical element edges. `gmin` is deliberately absent. */
function sourceComponentInto(workspace: GraphWorkspace): void {
  const inSource = workspace.inSource;
  for (let node = 0; node < workspace.nodeCount; node++) inSource[node] = 0;
  if (!workspace.sourceEnabled) return;
  const source = workspace._elementSlots[workspace.elementCount - 1] as ElementSlot;
  inSource[source.a] = 1;
  inSource[source.b] = 1;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < workspace.elementCount; i++) {
      const el = workspace._elementSlots[i] as ElementSlot;
      if (inSource[el.a] === 1 && inSource[el.b] === 0) {
        inSource[el.b] = 1;
        changed = true;
      } else if (inSource[el.b] === 1 && inSource[el.a] === 0) {
        inSource[el.a] = 1;
        changed = true;
      }
    }
  }
}

/**
 * Recompute one frozen-tick graph into caller-owned fixed-capacity storage.
 *
 * This function allocates nothing: every array, element slot and dynamic cord id belongs to the
 * workspace created outside the tick loop. No topology survives except as overwritten output.
 */
export function buildGraphInto(
  netlist: LoadedNetlist,
  profile: Profile,
  input: GraphInput,
  sourceEnabled: boolean,
  workspace: GraphWorkspace,
): GraphWorkspace {
  if (netlist.terminals.length !== GRAPH_TERMINALS) fail('loaded terminal count is not 186');
  // The 278 element slots are 22 fixed plus 256 cords; without this the fixed count is only
  // checked after `buildElementsInto` has already written past the end of the slot array.
  if (netlist.elements.length !== GRAPH_FIXED_ELEMENTS) fail('loaded fixed element count is not 22');
  resetWorkspace(workspace);
  workspace.sourceEnabled = sourceEnabled;
  indexCords(workspace, input.cords);
  unionBusses(workspace, netlist);
  unionIdealCords(workspace);
  unionContacts(workspace, netlist, input.contactPosition);
  canonicalNodesInto(workspace, netlist);
  buildElementsInto(workspace, netlist, profile, workspace.nodeByTerminal);
  sourceComponentInto(workspace);
  return workspace;
}

function copyElement(slot: ElementSlot): Readonly<El> {
  if (slot.k === 'lamp') return Object.freeze({ k: 'lamp', a: slot.a, b: slot.b });
  if (slot.k === 'coil') {
    return Object.freeze({ k: 'coil', a: slot.a, b: slot.b, rOhm: slot.rOhm, lH: slot.lH });
  }
  if (slot.k === 'res') return Object.freeze({ k: 'res', a: slot.a, b: slot.b, rOhm: slot.rOhm });
  return Object.freeze({
    k: 'source', a: slot.a, b: slot.b, vOc: slot.vOc, rSrcOhm: slot.rSrcOhm,
  });
}

/** Build one immutable graph through the allocating wrapper over `buildGraphInto`. */
export function buildGraph(netlist: LoadedNetlist, profile: Profile, input: GraphInput): BuiltGraph {
  const workspace = buildGraphInto(netlist, profile, input, true, createGraphWorkspace());
  const elements: Readonly<El>[] = [];
  const elementIds: string[] = [];
  for (let i = 0; i < workspace.elementCount; i++) {
    elements.push(copyElement(workspace._elementSlots[i] as ElementSlot));
    elementIds.push(workspace._elementIds[i] as string);
  }
  const members: number[][] = [];
  for (let node = 0; node < workspace.nodeCount; node++) {
    const row: number[] = [];
    const end = workspace.memberOffsets[node + 1] as number;
    for (let i = workspace.memberOffsets[node] as number; i < end; i++) {
      row.push(workspace.memberTerminals[i] as number);
    }
    members.push(Object.freeze(row) as number[]);
  }
  const nodeByTerminal = Object.freeze(Array.from(workspace.nodeByTerminal));
  const frozenInSource = Object.freeze(Array.from(workspace.inSource.subarray(0, workspace.nodeCount)));
  return Object.freeze({
    elements: Object.freeze(elements),
    elementIds: Object.freeze(elementIds),
    nodeByTerminal,
    members: Object.freeze(members),
    inSource: frozenInSource,
    nodeCount: workspace.nodeCount,
    datum: workspace.datum,
    sourceNode: workspace.sourceNode,
  });
}
