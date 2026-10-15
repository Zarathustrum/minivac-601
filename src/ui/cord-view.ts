import type { CordEnd, HoleId } from '../core/contract.ts';

export type CordSide = 'a' | 'b';

export interface CordRef {
  readonly cord: number;
  readonly side: CordSide;
}

export interface CordViewCord {
  readonly id: number;
  readonly a: CordEnd;
  readonly b: CordEnd;
  readonly r_uohm: number;
}

export type CordDropTarget =
  | { readonly k: 'hole'; readonly hole: HoleId }
  | { readonly k: 'free' }
  | { readonly k: 'outside' }
  | { readonly k: 'occupied'; readonly hole: HoleId };

export type CordResult = CordRef & (
  | CordDropTarget
  | { readonly k: 'cancel'; readonly reason: 'escape' | 'pointercancel' }
);

export interface CordViewCallbacks {
  onResult(result: CordResult): void;
  onKeyboardPickup?(end: CordRef): void;
  onKeyboardTarget?(end: CordRef, target: CordDropTarget): void;
  onKeyboardCancel?(end: CordRef): void;
}

export interface CordViewOptions {
  readonly stage: HTMLElement;
  readonly surface: HTMLElement;
  readonly holes: ReadonlyMap<string, HTMLButtonElement>;
  readonly cords: readonly CordViewCord[];
  /** Stable presentation order, normally CordId then side A before B. */
  readonly freeSlots: readonly CordRef[];
  readonly callbacks: CordViewCallbacks;
}

export interface CordView {
  readonly overlay: SVGSVGElement;
  readonly tray: HTMLElement;
  update(cords: readonly CordViewCord[], freeSlots: readonly CordRef[]): void;
  repaint(): void;
  keyboardTarget(target: { readonly k: 'hole'; readonly hole: HoleId } | { readonly k: 'free' }): void;
  cancel(): void;
  dispose(): void;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

interface ActivePointer extends CordRef {
  readonly pointerId: number;
  readonly handle: HTMLButtonElement;
  point: Point;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

export function cordSlotKey(cord: number, side: CordSide): string {
  return String(cord) + ':' + side;
}

function html<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function asElement(value: EventTarget | null): HTMLElement | null {
  if (value === null || typeof value !== 'object' || !('dataset' in value)) return null;
  return value as HTMLElement;
}

function ancestors(start: HTMLElement | null): HTMLElement[] {
  const values: HTMLElement[] = [];
  let node = start;
  while (node !== null) {
    values.push(node);
    node = node.parentElement;
  }
  return values;
}

function sameEnd(a: CordRef, b: CordRef): boolean {
  return a.cord === b.cord && a.side === b.side;
}

function endOf(cord: CordViewCord, side: CordSide): CordEnd {
  return side === 'a' ? cord.a : cord.b;
}

function center(element: Element, stageRect: DOMRect): Point {
  const rect = element.getBoundingClientRect();
  return Object.freeze({
    x: rect.left + rect.width / 2 - stageRect.left,
    y: rect.top + rect.height / 2 - stageRect.top,
  });
}

function setPoint(element: HTMLElement, point: Point): void {
  element.style.left = point.x + 'px';
  element.style.top = point.y + 'px';
}

function setPath(path: SVGPathElement, a: Point, b: Point): void {
  path.setAttribute('d', 'M ' + a.x + ' ' + a.y + ' L ' + b.x + ' ' + b.y);
}

function isActivationKey(event: KeyboardEvent): boolean {
  return event.key === 'Enter' || event.key === ' ';
}

/** Render flat patch cords and classify gestures without applying Machine commands. */
export function createCordView(options: CordViewOptions): CordView {
  const { stage, surface, holes, callbacks } = options;
  const document = stage.ownerDocument;
  let cords: readonly CordViewCord[] = [];
  let freeSlots: readonly CordRef[] = [];
  let disposed = false;
  let pointer: ActivePointer | null = null;
  let keyboard: CordRef | null = null;

  for (const [id, hole] of holes) {
    if (hole.dataset.hole !== id || !surface.contains(hole)) {
      throw new Error('cord view: invalid hole map entry ' + JSON.stringify(id));
    }
  }

  const overlay = document.createElementNS(SVG_NS, 'svg');
  overlay.setAttribute('class', 'cord-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.pointerEvents = 'none';

  const handles = html(document, 'div', 'cord-handles');
  handles.style.position = 'absolute';
  handles.style.inset = '0';
  handles.style.pointerEvents = 'none';

  const tray = html(document, 'section', 'cord-tray');
  tray.dataset.cordTray = 'free';
  tray.setAttribute('aria-label', 'Free cord ends');
  const trayLabel = html(document, 'h2', 'cord-tray-label');
  trayLabel.textContent = 'CORD TRAY';
  tray.append(trayLabel);

  stage.append(overlay, handles, tray);

  const paths = new Map<number, SVGPathElement>();
  const endpointHandles = new Map<string, HTMLButtonElement>();
  const refsByHandle = new WeakMap<HTMLButtonElement, CordRef>();
  const slots = new Map<string, HTMLButtonElement>();

  function setHandleState(ref: CordRef, state: 'dragging' | 'keyboard-picked', active: boolean): void {
    const handle = endpointHandles.get(cordSlotKey(ref.cord, ref.side));
    if (handle === undefined) return;
    const names = new Set(handle.className.split(/\s+/u).filter(Boolean));
    if (active) names.add(state);
    else names.delete(state);
    handle.className = [...names].join(' ');
  }

  function ensureLive(): boolean {
    return !disposed;
  }

  function cordById(id: number): CordViewCord {
    const value = cords.find((cord) => cord.id === id);
    if (value === undefined) throw new Error('cord view: unknown cord ' + id);
    return value;
  }

  function endpointPoint(ref: CordRef, stageRect: DOMRect): Point {
    if (pointer !== null && sameEnd(pointer, ref)) return pointer.point;
    const end = endOf(cordById(ref.cord), ref.side);
    if (end.k === 'hole') {
      const hole = holes.get(end.hole);
      if (hole === undefined) throw new Error('cord view: missing hole ' + end.hole);
      return center(hole, stageRect);
    }
    const slot = slots.get(cordSlotKey(ref.cord, ref.side));
    if (slot === undefined) throw new Error('cord view: missing free slot ' + cordSlotKey(ref.cord, ref.side));
    return center(slot, stageRect);
  }

  function repaint(): void {
    if (!ensureLive()) return;
    const stageRect = stage.getBoundingClientRect();
    overlay.setAttribute('viewBox', '0 0 ' + stageRect.width + ' ' + stageRect.height);
    for (const cord of cords) {
      const a = endpointPoint({ cord: cord.id, side: 'a' }, stageRect);
      const b = endpointPoint({ cord: cord.id, side: 'b' }, stageRect);
      const path = paths.get(cord.id);
      if (path === undefined) throw new Error('cord view: missing path ' + cord.id);
      setPath(path, a, b);
      const handleA = endpointHandles.get(cordSlotKey(cord.id, 'a'));
      const handleB = endpointHandles.get(cordSlotKey(cord.id, 'b'));
      if (handleA === undefined || handleB === undefined) {
        throw new Error('cord view: missing handles ' + cord.id);
      }
      setPoint(handleA, a);
      setPoint(handleB, b);
    }
  }

  function rebuild(nextCords: readonly CordViewCord[], nextFreeSlots: readonly CordRef[]): void {
    pointer = null;
    keyboard = null;
    const seenCords = new Set<number>();
    for (const cord of nextCords) {
      if (seenCords.has(cord.id)) throw new Error('cord view: duplicate cord ' + cord.id);
      seenCords.add(cord.id);
    }
    const seenSlots = new Set<string>();
    for (const ref of nextFreeSlots) {
      const key = cordSlotKey(ref.cord, ref.side);
      if (seenSlots.has(key)) throw new Error('cord view: duplicate free slot ' + key);
      const cord = nextCords.find((value) => value.id === ref.cord);
      if (cord === undefined || endOf(cord, ref.side).k === 'hole') {
        throw new Error('cord view: free slot does not name a free endpoint ' + key);
      }
      seenSlots.add(key);
    }
    for (const cord of nextCords) {
      for (const side of ['a', 'b'] as const) {
        if (endOf(cord, side).k !== 'hole' && !seenSlots.has(cordSlotKey(cord.id, side))) {
          throw new Error('cord view: no free slot for ' + cordSlotKey(cord.id, side));
        }
      }
    }

    cords = Object.freeze([...nextCords]);
    freeSlots = Object.freeze(nextFreeSlots.map((ref) => Object.freeze({ ...ref })));
    overlay.replaceChildren();
    handles.replaceChildren();
    tray.replaceChildren(trayLabel);
    paths.clear();
    endpointHandles.clear();
    slots.clear();

    for (const ref of freeSlots) {
      const slot = html(document, 'button', 'cord-tray-slot');
      slot.type = 'button';
      slot.dataset.cordTray = 'free';
      slot.dataset.cord = String(ref.cord);
      slot.dataset.side = ref.side;
      slot.setAttribute('aria-label', 'Free slot for cord ' + ref.cord + ' end ' + ref.side.toUpperCase());
      tray.append(slot);
      slots.set(cordSlotKey(ref.cord, ref.side), slot);
    }

    for (const cord of cords) {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('class', 'cord-path');
      path.dataset.cord = String(cord.id);
      path.dataset.resistanceUohm = String(cord.r_uohm);
      path.setAttribute('fill', 'none');
      overlay.append(path);
      paths.set(cord.id, path);

      for (const side of ['a', 'b'] as const) {
        const handle = html(document, 'button', 'cord-handle');
        handle.type = 'button';
        handle.dataset.cord = String(cord.id);
        handle.dataset.side = side;
        handle.dataset.resistanceUohm = String(cord.r_uohm);
        handle.setAttribute('aria-label', 'Cord ' + cord.id + ' end ' + side.toUpperCase());
        handle.style.position = 'absolute';
        handle.style.pointerEvents = 'auto';
        handles.append(handle);
        const key = cordSlotKey(cord.id, side);
        endpointHandles.set(key, handle);
        refsByHandle.set(handle, Object.freeze({ cord: cord.id, side }));
      }
    }
    repaint();
  }

  function occupied(hole: HoleId, moving: CordRef): boolean {
    for (const cord of cords) {
      for (const side of ['a', 'b'] as const) {
        if (cord.id === moving.cord && side === moving.side) continue;
        const end = endOf(cord, side);
        if (end.k === 'hole' && end.hole === hole) return true;
      }
    }
    return false;
  }

  function classifyElements(elements: readonly Element[], moving: CordRef): CordDropTarget {
    for (const element of elements) {
      for (const candidate of ancestors(element as HTMLElement)) {
        const holeId = candidate.dataset.hole;
        if (holeId !== undefined && holes.get(holeId) === candidate) {
          const hole = holeId as HoleId;
          return occupied(hole, moving) ? { k: 'occupied', hole } : { k: 'hole', hole };
        }
        if (candidate.dataset.cordTray === 'free') return { k: 'free' };
        if (candidate === surface) break;
      }
    }
    return { k: 'outside' };
  }

  function classifyPoint(x: number, y: number, moving: CordRef): CordDropTarget {
    const elements = document.elementsFromPoint?.(x, y);
    if (elements !== undefined) return classifyElements(elements, moving);
    const element = document.elementFromPoint(x, y);
    return classifyElements(element === null ? [] : [element], moving);
  }

  function releasePointer(active: ActivePointer): void {
    if (active.handle.hasPointerCapture?.(active.pointerId)) {
      active.handle.releasePointerCapture(active.pointerId);
    }
  }

  function finishPointer(target: CordDropTarget): void {
    const active = pointer;
    if (active === null) return;
    releasePointer(active);
    setHandleState(active, 'dragging', false);
    pointer = null;
    callbacks.onResult({ cord: active.cord, side: active.side, ...target });
    repaint();
  }

  function cancelPointer(reason: 'escape' | 'pointercancel'): void {
    const active = pointer;
    if (active === null) return;
    releasePointer(active);
    setHandleState(active, 'dragging', false);
    pointer = null;
    callbacks.onResult({ cord: active.cord, side: active.side, k: 'cancel', reason });
    repaint();
  }

  function onPointerDown(event: PointerEvent): void {
    if (pointer !== null) return;
    const target = asElement(event.target);
    if (target === null) return;
    const ref = refsByHandle.get(target as HTMLButtonElement);
    if (ref === undefined) return;
    if (event.button > 0) return;
    event.preventDefault();
    target.setPointerCapture(event.pointerId);
    const stageRect = stage.getBoundingClientRect();
    pointer = {
      ...ref,
      pointerId: event.pointerId,
      handle: target as HTMLButtonElement,
      point: { x: event.clientX - stageRect.left, y: event.clientY - stageRect.top },
    };
    setHandleState(ref, 'dragging', true);
    repaint();
  }

  function onPointerMove(event: PointerEvent): void {
    if (pointer === null || pointer.pointerId !== event.pointerId) return;
    event.preventDefault();
    const stageRect = stage.getBoundingClientRect();
    pointer.point = { x: event.clientX - stageRect.left, y: event.clientY - stageRect.top };
    repaint();
  }

  function onPointerUp(event: PointerEvent): void {
    if (pointer === null || pointer.pointerId !== event.pointerId) return;
    event.preventDefault();
    finishPointer(classifyPoint(event.clientX, event.clientY, pointer));
  }

  function onPointerCancel(event: PointerEvent): void {
    if (pointer?.pointerId !== event.pointerId) return;
    event.preventDefault();
    cancelPointer('pointercancel');
  }

  function cancelKeyboard(): void {
    const active = keyboard;
    if (active === null) return;
    setHandleState(active, 'keyboard-picked', false);
    keyboard = null;
    callbacks.onKeyboardCancel?.(active);
    callbacks.onResult({ ...active, k: 'cancel', reason: 'escape' });
  }

  function deliverKeyboardTarget(target: CordDropTarget): void {
    const active = keyboard;
    if (active === null) return;
    setHandleState(active, 'keyboard-picked', false);
    keyboard = null;
    callbacks.onKeyboardTarget?.(active, target);
    callbacks.onResult({ ...active, ...target });
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (pointer !== null) {
        event.preventDefault();
        cancelPointer('escape');
      } else if (keyboard !== null) {
        event.preventDefault();
        cancelKeyboard();
      }
      return;
    }
    if (!isActivationKey(event)) return;
    const target = asElement(event.target);
    if (target === null) return;
    const endpoint = refsByHandle.get(target as HTMLButtonElement);
    if (endpoint !== undefined) {
      event.preventDefault();
      if (keyboard !== null) setHandleState(keyboard, 'keyboard-picked', false);
      keyboard = endpoint;
      setHandleState(endpoint, 'keyboard-picked', true);
      callbacks.onKeyboardPickup?.(endpoint);
      return;
    }
    if (keyboard === null) return;
    const classified = classifyElements([target], keyboard);
    if (classified.k !== 'outside') {
      event.preventDefault();
      deliverKeyboardTarget(classified);
    }
  }

  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerCancel);
  stage.addEventListener('keydown', onKeyDown);

  rebuild(options.cords, options.freeSlots);

  return Object.freeze({
    overlay,
    tray,
    update(nextCords: readonly CordViewCord[], nextFreeSlots: readonly CordRef[]): void {
      if (!ensureLive()) return;
      rebuild(nextCords, nextFreeSlots);
    },
    repaint,
    keyboardTarget(target: { readonly k: 'hole'; readonly hole: HoleId } | { readonly k: 'free' }): void {
      if (!ensureLive() || keyboard === null) return;
      const classified = target.k === 'free'
        ? target
        : occupied(target.hole, keyboard) ? { k: 'occupied' as const, hole: target.hole } : target;
      deliverKeyboardTarget(classified);
    },
    cancel(): void {
      if (!ensureLive()) return;
      if (pointer !== null) cancelPointer('escape');
      else cancelKeyboard();
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (pointer !== null) releasePointer(pointer);
      pointer = null;
      keyboard = null;
      stage.removeEventListener('pointerdown', onPointerDown);
      stage.removeEventListener('pointermove', onPointerMove);
      stage.removeEventListener('pointerup', onPointerUp);
      stage.removeEventListener('pointercancel', onPointerCancel);
      stage.removeEventListener('keydown', onKeyDown);
      overlay.remove();
      handles.remove();
      tray.remove();
      paths.clear();
      endpointHandles.clear();
      slots.clear();
    },
  });
}
