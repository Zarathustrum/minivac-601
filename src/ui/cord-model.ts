import type {
  CmdResult,
  Command,
  CordEnd,
  CordId,
  HoleId,
  State,
  TerminalId,
} from '../core/contract.ts';

export type CordRecord = State['cords'][number];
export type CordSide = 'a' | 'b';
export type ApplyCommand = (command: Command) => CmdResult;

export interface EndpointRef {
  readonly cord: CordId;
  readonly side: CordSide;
}

export interface FreeTraySlot {
  readonly key: string;
  readonly endpoint: EndpointRef;
  readonly index: number;
}

export type CordDropTarget =
  | { readonly k: 'hole'; readonly hole: HoleId }
  | { readonly k: 'tray' }
  | { readonly k: 'outside' };

export interface CordDrag {
  readonly endpoint: EndpointRef;
  readonly origin: CordEnd;
  readonly preview: CordDropTarget | null;
}

export type DropResolution =
  | {
      readonly k: 'replace';
      readonly endpoint: EndpointRef;
      readonly from: CordEnd;
      readonly to: CordEnd;
    }
  | {
      readonly k: 'noop';
      readonly endpoint: EndpointRef;
      readonly end: CordEnd;
    }
  | {
      readonly k: 'cancelled';
      readonly endpoint: EndpointRef;
      readonly reason: 'cancel' | 'occupied' | 'outside';
      readonly end: CordEnd;
    };

export type ReplacementResult =
  | { readonly k: 'noop'; readonly cords: readonly CordRecord[] }
  | { readonly k: 'committed'; readonly cords: readonly CordRecord[] }
  | {
      readonly k: 'disconnect-rejected';
      readonly why: Extract<CmdResult, { ok: false }>['why'];
      readonly cords: readonly CordRecord[];
    }
  | {
      readonly k: 'connect-rejected';
      readonly why: Extract<CmdResult, { ok: false }>['why'];
      readonly cords: readonly CordRecord[];
    }
  | {
      readonly k: 'rollback-rejected';
      readonly why: Extract<CmdResult, { ok: false }>['why'];
      readonly rollbackWhy: Extract<CmdResult, { ok: false }>['why'];
      readonly cords: null;
    };

export interface MomentaryTouch {
  readonly endpoint: EndpointRef;
  readonly term: TerminalId;
}

export type TouchStartResult =
  | { readonly k: 'not-free'; readonly cords: readonly CordRecord[] }
  | {
      readonly k: 'started';
      readonly touch: MomentaryTouch;
      readonly cords: readonly CordRecord[];
    }
  | { readonly k: 'rejected'; readonly replacement: ReplacementResult };

export type AddCordResult =
  | { readonly k: 'added'; readonly cord: CordId; readonly cords: readonly CordRecord[] }
  | { readonly k: 'full'; readonly cords: readonly CordRecord[] }
  | {
      readonly k: 'rejected';
      readonly why: Extract<CmdResult, { ok: false }>['why'];
      readonly cords: readonly CordRecord[];
    };

export type RemoveCordResult =
  | { readonly k: 'removed'; readonly cord: CordId; readonly cords: readonly CordRecord[] }
  | {
      readonly k: 'rejected';
      readonly why: Extract<CmdResult, { ok: false }>['why'];
      readonly cords: readonly CordRecord[];
    };

export interface ControllerDropResult {
  readonly resolution: DropResolution;
  readonly replacement: ReplacementResult | null;
}

export interface CordController {
  snapshot(): readonly CordRecord[];
  traySlots(): readonly FreeTraySlot[];
  isOccupied(hole: HoleId, exclude?: EndpointRef): boolean;
  add(): AddCordResult;
  remove(cord: CordId): RemoveCordResult;
  beginDrag(endpoint: EndpointRef): CordDrag;
  preview(target: CordDropTarget): CordDrag;
  cancelDrag(): DropResolution;
  drop(target?: CordDropTarget): ControllerDropResult;
  beginTouch(endpoint: EndpointRef, term: TerminalId): TouchStartResult;
  releaseTouch(): ReplacementResult;
  cancelTouch(): ReplacementResult;
}

function cloneEnd(end: CordEnd): CordEnd {
  if (end.k === 'hole') return Object.freeze({ k: 'hole', hole: end.hole });
  if (end.k === 'touch') return Object.freeze({ k: 'touch', term: end.term });
  return Object.freeze({ k: 'free' });
}

function cloneEndpoint(endpoint: EndpointRef): EndpointRef {
  return Object.freeze({ cord: endpoint.cord, side: endpoint.side });
}

function cloneCords(cords: readonly CordRecord[]): readonly CordRecord[] {
  return Object.freeze(cords.map((cord) => Object.freeze({
    id: cord.id,
    a: cloneEnd(cord.a),
    b: cloneEnd(cord.b),
    r_uohm: cord.r_uohm,
  })));
}

function findCord(cords: readonly CordRecord[], endpoint: EndpointRef): CordRecord {
  const cord = cords.find((candidate) => candidate.id === endpoint.cord);
  if (cord === undefined) throw new Error('cord model: unknown cord ' + endpoint.cord);
  return cord;
}

function endpointEnd(cords: readonly CordRecord[], endpoint: EndpointRef): CordEnd {
  const cord = findCord(cords, endpoint);
  return cord[endpoint.side];
}

function sameEnd(left: CordEnd, right: CordEnd): boolean {
  if (left.k !== right.k) return false;
  if (left.k === 'hole' && right.k === 'hole') return left.hole === right.hole;
  if (left.k === 'touch' && right.k === 'touch') return left.term === right.term;
  return left.k === 'free' && right.k === 'free';
}

function cloneTarget(target: CordDropTarget): CordDropTarget {
  if (target.k === 'hole') return Object.freeze({ k: 'hole', hole: target.hole });
  return Object.freeze({ k: target.k });
}

export function endpointKey(endpoint: EndpointRef): string {
  return endpoint.cord + ':' + endpoint.side;
}

/** Return every endpoint in stable numeric CordId order, with a before b. */
export function orderedEndpoints(cords: readonly CordRecord[]): readonly EndpointRef[] {
  const sorted = [...cords].sort((left, right) => left.id - right.id);
  return Object.freeze(sorted.flatMap((cord) => [
    Object.freeze({ cord: cord.id, side: 'a' as const }),
    Object.freeze({ cord: cord.id, side: 'b' as const }),
  ]));
}

/** Presentation-only tray indices. Coordinates remain the renderer's responsibility. */
export function freeTraySlots(cords: readonly CordRecord[]): readonly FreeTraySlot[] {
  const slots: FreeTraySlot[] = [];
  for (const endpoint of orderedEndpoints(cords)) {
    if (endpointEnd(cords, endpoint).k !== 'free') continue;
    slots.push(Object.freeze({
      key: endpointKey(endpoint),
      endpoint: cloneEndpoint(endpoint),
      index: slots.length,
    }));
  }
  return Object.freeze(slots);
}

/** Hole occupancy excludes precisely the endpoint currently being dragged, if supplied. */
export function isHoleOccupied(
  cords: readonly CordRecord[],
  hole: HoleId,
  exclude?: EndpointRef,
): boolean {
  for (const endpoint of orderedEndpoints(cords)) {
    if (exclude !== undefined && endpoint.cord === exclude.cord && endpoint.side === exclude.side) continue;
    const end = endpointEnd(cords, endpoint);
    if (end.k === 'hole' && end.hole === hole) return true;
  }
  return false;
}

/** Add two loose ends with the lowest unused contract CordId. */
export function addFreeCord(
  cords: readonly CordRecord[],
  apply: ApplyCommand,
): AddCordResult {
  const snapshot = cloneCords(cords);
  const used = new Set(snapshot.map((cord) => cord.id));
  let id: CordId | null = null;
  for (let candidate = 0; candidate <= 255; candidate++) {
    if (!used.has(candidate)) {
      id = candidate;
      break;
    }
  }
  if (id === null) return Object.freeze({ k: 'full', cords: snapshot });
  const free = Object.freeze({ k: 'free' as const });
  const result = apply({ k: 'connect', cord: id, a: free, b: free, r_uohm: 0 });
  if (!result.ok) {
    return Object.freeze({ k: 'rejected', why: result.why, cords: snapshot });
  }
  const added = Object.freeze({ id, a: free, b: free, r_uohm: 0 });
  return Object.freeze({ k: 'added', cord: id, cords: Object.freeze([...snapshot, added]) });
}

/** Remove one cord only after the core accepts its disconnect command. */
export function removeCord(
  cords: readonly CordRecord[],
  cord: CordId,
  apply: ApplyCommand,
): RemoveCordResult {
  const snapshot = cloneCords(cords);
  const result = apply({ k: 'disconnect', cord });
  if (!result.ok) {
    return Object.freeze({ k: 'rejected', why: result.why, cords: snapshot });
  }
  return Object.freeze({
    k: 'removed',
    cord,
    cords: Object.freeze(snapshot.filter((candidate) => candidate.id !== cord)),
  });
}

export function beginCordDrag(cords: readonly CordRecord[], endpoint: EndpointRef): CordDrag {
  return Object.freeze({
    endpoint: cloneEndpoint(endpoint),
    origin: cloneEnd(endpointEnd(cords, endpoint)),
    preview: null,
  });
}

/** Preview changes UI state only and cannot emit a core command. */
export function previewCordDrag(drag: CordDrag, target: CordDropTarget): CordDrag {
  return Object.freeze({
    endpoint: cloneEndpoint(drag.endpoint),
    origin: cloneEnd(drag.origin),
    preview: cloneTarget(target),
  });
}

export function cancelCordDrag(drag: CordDrag): DropResolution {
  return Object.freeze({
    k: 'cancelled',
    endpoint: cloneEndpoint(drag.endpoint),
    reason: 'cancel',
    end: cloneEnd(drag.origin),
  });
}

export function resolveCordDrop(
  cords: readonly CordRecord[],
  drag: CordDrag,
  target: CordDropTarget = drag.preview ?? { k: 'outside' },
): DropResolution {
  if (target.k === 'outside') {
    return Object.freeze({
      k: 'cancelled', endpoint: cloneEndpoint(drag.endpoint), reason: 'outside', end: cloneEnd(drag.origin),
    });
  }
  const end: CordEnd = target.k === 'tray'
    ? Object.freeze({ k: 'free' })
    : Object.freeze({ k: 'hole', hole: target.hole });
  if (target.k === 'hole' && isHoleOccupied(cords, target.hole, drag.endpoint)) {
    return Object.freeze({
      k: 'cancelled', endpoint: cloneEndpoint(drag.endpoint), reason: 'occupied', end: cloneEnd(drag.origin),
    });
  }
  if (sameEnd(drag.origin, end)) {
    return Object.freeze({ k: 'noop', endpoint: cloneEndpoint(drag.endpoint), end: cloneEnd(drag.origin) });
  }
  return Object.freeze({
    k: 'replace',
    endpoint: cloneEndpoint(drag.endpoint),
    from: cloneEnd(drag.origin),
    to: cloneEnd(end),
  });
}

/** Disconnect, connect the replacement, and restore the exact original cord on rejection. */
export function replaceCordEndpoint(
  cords: readonly CordRecord[],
  endpoint: EndpointRef,
  nextEnd: CordEnd,
  apply: ApplyCommand,
): ReplacementResult {
  const snapshot = cloneCords(cords);
  const cord = findCord(snapshot, endpoint);
  const prior = cord[endpoint.side];
  if (sameEnd(prior, nextEnd)) return Object.freeze({ k: 'noop', cords: snapshot });

  const disconnected = apply({ k: 'disconnect', cord: cord.id });
  if (!disconnected.ok) {
    return Object.freeze({ k: 'disconnect-rejected', why: disconnected.why, cords: snapshot });
  }

  const replacement = Object.freeze({
    id: cord.id,
    a: endpoint.side === 'a' ? cloneEnd(nextEnd) : cloneEnd(cord.a),
    b: endpoint.side === 'b' ? cloneEnd(nextEnd) : cloneEnd(cord.b),
    r_uohm: cord.r_uohm,
  });
  const connected = apply({
    k: 'connect',
    cord: replacement.id,
    a: replacement.a,
    b: replacement.b,
    r_uohm: replacement.r_uohm,
  });
  if (connected.ok) {
    return Object.freeze({
      k: 'committed',
      cords: Object.freeze(snapshot.map((value) => value.id === replacement.id ? replacement : value)),
    });
  }

  const rolledBack = apply({
    k: 'connect',
    cord: cord.id,
    a: cord.a,
    b: cord.b,
    r_uohm: cord.r_uohm,
  });
  if (!rolledBack.ok) {
    return Object.freeze({
      k: 'rollback-rejected',
      why: connected.why,
      rollbackWhy: rolledBack.why,
      cords: null,
    });
  }
  return Object.freeze({ k: 'connect-rejected', why: connected.why, cords: snapshot });
}

export function beginMomentaryTouch(
  cords: readonly CordRecord[],
  endpoint: EndpointRef,
  term: TerminalId,
  apply: ApplyCommand,
): TouchStartResult {
  const snapshot = cloneCords(cords);
  if (endpointEnd(snapshot, endpoint).k !== 'free') {
    return Object.freeze({ k: 'not-free', cords: snapshot });
  }
  const replacement = replaceCordEndpoint(snapshot, endpoint, { k: 'touch', term }, apply);
  if (replacement.k !== 'committed') return Object.freeze({ k: 'rejected', replacement });
  return Object.freeze({
    k: 'started',
    touch: Object.freeze({ endpoint: cloneEndpoint(endpoint), term }),
    cords: replacement.cords,
  });
}

export function endMomentaryTouch(
  cords: readonly CordRecord[],
  touch: MomentaryTouch,
  apply: ApplyCommand,
): ReplacementResult {
  return replaceCordEndpoint(cords, touch.endpoint, { k: 'free' }, apply);
}

function requireDrag(drag: CordDrag | null): CordDrag {
  if (drag === null) throw new Error('cord model: no active drag');
  return drag;
}

function requireTouch(touch: MomentaryTouch | null): MomentaryTouch {
  if (touch === null) throw new Error('cord model: no active touch');
  return touch;
}

/** Minimal stateful adapter for a DOM owner; all decisions remain in the pure functions above. */
export function createCordController(
  initialCords: readonly CordRecord[],
  apply: ApplyCommand,
): CordController {
  let cords = cloneCords(initialCords);
  let drag: CordDrag | null = null;
  let touch: MomentaryTouch | null = null;

  /** A failed rollback leaves the cord disconnected in the core; forget it here too. */
  function forgetCord(cord: CordId): void {
    cords = Object.freeze(cords.filter((value) => value.id !== cord));
  }

  function finishTouch(): ReplacementResult {
    const active = requireTouch(touch);
    const result = endMomentaryTouch(cords, active, apply);
    if (result.k === 'committed' || result.k === 'noop') {
      cords = result.cords;
      touch = null;
    } else if (result.k === 'rollback-rejected') {
      forgetCord(active.endpoint.cord);
      touch = null;
    }
    return result;
  }

  return Object.freeze({
    snapshot: () => cords,
    traySlots: () => freeTraySlots(cords),
    isOccupied: (hole: HoleId, exclude?: EndpointRef) => isHoleOccupied(cords, hole, exclude),
    add(): AddCordResult {
      if (drag !== null) throw new Error('cord model: drag already active');
      if (touch !== null) throw new Error('cord model: touch already active');
      const result = addFreeCord(cords, apply);
      if (result.k === 'added') cords = result.cords;
      return result;
    },
    remove(cord: CordId): RemoveCordResult {
      if (drag !== null) throw new Error('cord model: drag already active');
      if (touch !== null) throw new Error('cord model: touch already active');
      const result = removeCord(cords, cord, apply);
      if (result.k === 'removed') cords = result.cords;
      return result;
    },
    beginDrag(endpoint: EndpointRef): CordDrag {
      if (drag !== null) throw new Error('cord model: drag already active');
      if (touch !== null) throw new Error('cord model: touch already active');
      drag = beginCordDrag(cords, endpoint);
      return drag;
    },
    preview(target: CordDropTarget): CordDrag {
      drag = previewCordDrag(requireDrag(drag), target);
      return drag;
    },
    cancelDrag(): DropResolution {
      const resolution = cancelCordDrag(requireDrag(drag));
      drag = null;
      return resolution;
    },
    drop(target?: CordDropTarget): ControllerDropResult {
      const resolution = target === undefined
        ? resolveCordDrop(cords, requireDrag(drag))
        : resolveCordDrop(cords, requireDrag(drag), target);
      drag = null;
      if (resolution.k !== 'replace') {
        return Object.freeze({ resolution, replacement: null });
      }
      const replacement = replaceCordEndpoint(cords, resolution.endpoint, resolution.to, apply);
      if (replacement.k === 'committed') cords = replacement.cords;
      else if (replacement.k === 'rollback-rejected') forgetCord(resolution.endpoint.cord);
      return Object.freeze({ resolution, replacement });
    },
    beginTouch(endpoint: EndpointRef, term: TerminalId): TouchStartResult {
      if (drag !== null) throw new Error('cord model: drag already active');
      if (touch !== null) throw new Error('cord model: touch already active');
      const result = beginMomentaryTouch(cords, endpoint, term, apply);
      if (result.k === 'started') {
        cords = result.cords;
        touch = result.touch;
      } else if (result.k === 'rejected' && result.replacement.k === 'rollback-rejected') {
        forgetCord(endpoint.cord);
      }
      return result;
    },
    releaseTouch: finishTouch,
    cancelTouch: finishTouch,
  });
}
