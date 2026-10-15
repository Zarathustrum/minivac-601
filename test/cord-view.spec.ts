import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { CordEnd, HoleId } from '../src/core/contract.ts';
import {
  cordSlotKey,
  createCordView,
  type CordRef,
  type CordResult,
  type CordViewCord,
} from '../src/ui/cord-view.ts';

interface RectInit {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

type Listener = (event: never) => void;

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, Set<Listener>>();
  readonly captures = new Set<number>();
  parentElement: FakeElement | null = null;
  className = '';
  textContent = '';
  type = '';
  rect: RectInit = { left: 0, top: 0, width: 0, height: 0 };

  constructor(readonly ownerDocument: FakeDocument, readonly tagName: string) {}

  append(...nodes: FakeElement[]): void {
    for (const node of nodes) {
      node.parentElement = this;
      this.children.push(node);
    }
  }

  replaceChildren(...nodes: FakeElement[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.append(...nodes);
  }

  remove(): void {
    const parent = this.parentElement;
    if (parent === null) return;
    const index = parent.children.indexOf(this);
    if (index >= 0) parent.children.splice(index, 1);
    this.parentElement = null;
  }

  contains(candidate: FakeElement): boolean {
    return candidate === this || this.children.some((child) => child.contains(candidate));
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  getBoundingClientRect(): DOMRect {
    const { left, top, width, height } = this.rect;
    return {
      left, top, width, height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const values = this.listeners.get(type) ?? new Set<Listener>();
    values.add(listener as Listener);
    this.listeners.set(type, values);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener as Listener);
  }

  dispatch(type: string, event: object): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event as never);
  }

  setPointerCapture(pointerId: number): void {
    this.captures.add(pointerId);
  }

  hasPointerCapture(pointerId: number): boolean {
    return this.captures.has(pointerId);
  }

  releasePointerCapture(pointerId: number): void {
    this.captures.delete(pointerId);
  }
}

class FakeDocument {
  hits: FakeElement[] = [];

  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag);
  }

  createElementNS(_namespace: string, tag: string): FakeElement {
    return new FakeElement(this, tag);
  }

  elementsFromPoint(_x: number, _y: number): FakeElement[] {
    return this.hits;
  }
}

function asElement(value: FakeElement): HTMLElement {
  return value as unknown as HTMLElement;
}

function fake(value: unknown): FakeElement {
  return value as FakeElement;
}

function descendants(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(descendants)];
}

function classes(node: FakeElement): string[] {
  return node.className.split(/\s+/u).filter(Boolean);
}

function withClass(root: FakeElement, className: string): FakeElement[] {
  return descendants(root).filter((node) => classes(node).includes(className));
}

function pointerEvent(
  target: FakeElement,
  pointerId: number,
  clientX: number,
  clientY: number,
  button = 0,
): PointerEvent {
  return {
    target,
    pointerId,
    clientX,
    clientY,
    button,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
}

function keyEvent(target: FakeElement, key: string): KeyboardEvent {
  return { target, key, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

function atHole(id: string): CordEnd {
  return { k: 'hole', hole: id as HoleId };
}

const FREE: CordEnd = Object.freeze({ k: 'free' });

interface Fixture {
  readonly document: FakeDocument;
  readonly stage: FakeElement;
  readonly surface: FakeElement;
  readonly holes: ReadonlyMap<string, HTMLButtonElement>;
  readonly cords: readonly CordViewCord[];
}

function fixture(): Fixture {
  const document = new FakeDocument();
  const stage = document.createElement('main');
  stage.rect = { left: 100, top: 50, width: 900, height: 500 };
  const surface = document.createElement('section');
  surface.rect = { left: 100, top: 50, width: 900, height: 500 };
  stage.append(surface);
  const holes = new Map<string, HTMLButtonElement>();
  const rects: readonly RectInit[] = [
    { left: 200, top: 100, width: 20, height: 20 },
    { left: 400, top: 200, width: 20, height: 20 },
    { left: 600, top: 300, width: 20, height: 20 },
    { left: 800, top: 400, width: 20, height: 20 },
  ];
  for (let index = 0; index < rects.length; index++) {
    const id = '1A#' + (index + 1);
    const hole = document.createElement('button');
    hole.dataset.hole = id;
    hole.rect = rects[index] as RectInit;
    surface.append(hole);
    holes.set(id, hole as unknown as HTMLButtonElement);
  }
  return {
    document,
    stage,
    surface,
    holes,
    cords: Object.freeze([
      Object.freeze({ id: 7, a: atHole('1A#1'), b: atHole('1A#2'), r_uohm: 123 }),
      Object.freeze({ id: 3, a: FREE, b: atHole('1A#3'), r_uohm: 456 }),
    ]),
  };
}

function setFreeSlotRect(stage: FakeElement, cord: number, side: string, rect: RectInit): FakeElement {
  const slot = descendants(stage).find((node) =>
    classes(node).includes('cord-tray-slot') &&
    node.dataset.cord === String(cord) && node.dataset.side === side,
  );
  if (slot === undefined) throw new Error('test: missing free slot');
  slot.rect = rect;
  return slot;
}

describe('cord presentation', () => {
  it('keeps pointer handles above their free tray slots in the production stylesheet', () => {
    const css = readFileSync(new URL('../main.css', import.meta.url), 'utf8');
    const handles = /\.cord-handles\s*\{[^}]*z-index:\s*(\d+)/u.exec(css);
    const tray = /\.cord-tray\s*\{[^}]*z-index:\s*(\d+)/u.exec(css);
    expect(Number(handles?.[1])).toBeGreaterThan(Number(tray?.[1]));
  });

  it('renders one flat path and two identity-bound handles per cord', () => {
    const setup = fixture();
    const view = createCordView({
      stage: asElement(setup.stage),
      surface: asElement(setup.surface),
      holes: setup.holes,
      cords: setup.cords,
      freeSlots: [{ cord: 3, side: 'a' }],
      callbacks: { onResult: vi.fn() },
    });
    setFreeSlotRect(setup.stage, 3, 'a', { left: 120, top: 470, width: 20, height: 20 });
    view.repaint();

    const paths = withClass(fake(view.overlay), 'cord-path');
    const handles = withClass(setup.stage, 'cord-handle');
    expect(paths).toHaveLength(2);
    expect(handles).toHaveLength(4);
    expect(paths.map((node) => [node.dataset.cord, node.dataset.resistanceUohm])).toEqual([
      ['7', '123'], ['3', '456'],
    ]);
    expect(handles.map((node) => [node.dataset.cord, node.dataset.side, node.dataset.resistanceUohm]))
      .toEqual([
        ['7', 'a', '123'], ['7', 'b', '123'],
        ['3', 'a', '456'], ['3', 'b', '456'],
      ]);
    expect(handles.map((node) => node.getAttribute('aria-label'))).toEqual([
      'Cord 7 end A', 'Cord 7 end B', 'Cord 3 end A', 'Cord 3 end B',
    ]);
    expect(fake(view.tray).getAttribute('aria-label')).toBe('Free cord ends');
    expect(fake(view.tray).textContent).toBe('');
    expect(descendants(fake(view.tray)).map((node) => node.textContent)).toContain('CORD TRAY');
    expect(cordSlotKey(3, 'a')).toBe('3:a');

    const first = paths[0] as FakeElement;
    expect(first.getAttribute('d')).toBe('M 110 60 L 310 160');
    const before = first.getAttribute('d');
    view.repaint();
    expect(first.getAttribute('d')).toBe(before);
  });

  it('reprojects live geometry and moves only the active pointer preview', () => {
    const setup = fixture();
    const results: CordResult[] = [];
    const view = createCordView({
      stage: asElement(setup.stage), surface: asElement(setup.surface), holes: setup.holes,
      cords: setup.cords, freeSlots: [{ cord: 3, side: 'a' }],
      callbacks: { onResult: (result) => results.push(result) },
    });
    setFreeSlotRect(setup.stage, 3, 'a', { left: 120, top: 470, width: 20, height: 20 });
    view.repaint();
    const paths = withClass(fake(view.overlay), 'cord-path');
    const path7 = paths.find((node) => node.dataset.cord === '7') as FakeElement;
    const path3 = paths.find((node) => node.dataset.cord === '3') as FakeElement;
    const handle = withClass(setup.stage, 'cord-handle').find((node) =>
      node.dataset.cord === '7' && node.dataset.side === 'a',
    ) as FakeElement;
    const originalOther = path3.getAttribute('d');

    setup.stage.dispatch('pointerdown', pointerEvent(handle, 18, 250, 125, 2));
    expect(handle.captures.has(18)).toBe(false);
    expect(classes(handle)).not.toContain('dragging');
    setup.stage.dispatch('pointerdown', pointerEvent(handle, 19, 250, 125));
    expect(handle.captures.has(19)).toBe(true);
    expect(classes(handle)).toContain('dragging');
    setup.stage.dispatch('pointerdown', pointerEvent(handle, 20, 999, 999));
    expect(handle.captures.has(20)).toBe(false);
    setup.stage.dispatch('pointermove', pointerEvent(handle, 19, 350, 175));
    expect(path7.getAttribute('d')).toBe('M 250 125 L 310 160');
    expect(path3.getAttribute('d')).toBe(originalOther);
    expect(setup.cords[0]?.a).toEqual(atHole('1A#1'));

    const secondHole = fake(setup.holes.get('1A#2'));
    secondHole.rect = { left: 500, top: 250, width: 40, height: 40 };
    setup.document.hits = [];
    setup.stage.dispatch('pointerup', pointerEvent(handle, 19, 350, 175));
    expect(results).toEqual([{ cord: 7, side: 'a', k: 'outside' }]);
    expect(handle.captures.has(19)).toBe(false);
    expect(classes(handle)).not.toContain('dragging');
    expect(path7.getAttribute('d')).toBe('M 110 60 L 420 220');
  });

  it('reports occupied, tray, outside, cancellation and keyboard targets', () => {
    const setup = fixture();
    const results: CordResult[] = [];
    const pickups: CordRef[] = [];
    const targets: unknown[] = [];
    const cancels: CordRef[] = [];
    const view = createCordView({
      stage: asElement(setup.stage), surface: asElement(setup.surface), holes: setup.holes,
      cords: setup.cords, freeSlots: [{ cord: 3, side: 'a' }],
      callbacks: {
        onResult: (result) => results.push(result),
        onKeyboardPickup: (ref) => pickups.push(ref),
        onKeyboardTarget: (ref, target) => targets.push([ref, target]),
        onKeyboardCancel: (ref) => cancels.push(ref),
      },
    });
    const slot = setFreeSlotRect(setup.stage, 3, 'a', { left: 120, top: 470, width: 20, height: 20 });
    view.repaint();
    const handle = withClass(setup.stage, 'cord-handle').find((node) =>
      node.dataset.cord === '7' && node.dataset.side === 'a',
    ) as FakeElement;

    setup.stage.dispatch('pointerdown', pointerEvent(handle, 1, 210, 110));
    setup.document.hits = [fake(setup.holes.get('1A#3'))];
    setup.stage.dispatch('pointerup', pointerEvent(handle, 1, 610, 310));
    expect(results.pop()).toEqual({ cord: 7, side: 'a', k: 'occupied', hole: '1A#3' });

    setup.stage.dispatch('pointerdown', pointerEvent(handle, 2, 210, 110));
    setup.document.hits = [slot];
    setup.stage.dispatch('pointerup', pointerEvent(handle, 2, 130, 480));
    expect(results.pop()).toEqual({ cord: 7, side: 'a', k: 'free' });

    setup.stage.dispatch('pointerdown', pointerEvent(handle, 3, 210, 110));
    setup.stage.dispatch('pointercancel', pointerEvent(handle, 3, 0, 0));
    expect(results.pop()).toEqual({ cord: 7, side: 'a', k: 'cancel', reason: 'pointercancel' });

    setup.stage.dispatch('pointerdown', pointerEvent(handle, 4, 210, 110));
    setup.stage.dispatch('keydown', keyEvent(handle, 'Escape'));
    expect(results.pop()).toEqual({ cord: 7, side: 'a', k: 'cancel', reason: 'escape' });

    setup.stage.dispatch('keydown', keyEvent(handle, 'Enter'));
    expect(pickups).toEqual([{ cord: 7, side: 'a' }]);
    expect(classes(handle)).toContain('keyboard-picked');
    view.keyboardTarget({ k: 'hole', hole: '1A#4' as HoleId });
    expect(classes(handle)).not.toContain('keyboard-picked');
    expect(targets).toEqual([[{ cord: 7, side: 'a' }, { k: 'hole', hole: '1A#4' }]]);
    expect(results.pop()).toEqual({ cord: 7, side: 'a', k: 'hole', hole: '1A#4' });

    setup.stage.dispatch('keydown', keyEvent(handle, ' '));
    view.keyboardTarget({ k: 'free' });
    expect(results.pop()).toEqual({ cord: 7, side: 'a', k: 'free' });

    setup.stage.dispatch('keydown', keyEvent(handle, 'Enter'));
    setup.stage.dispatch('keydown', keyEvent(handle, 'Escape'));
    expect(cancels).toEqual([{ cord: 7, side: 'a' }]);
    expect(results.pop()).toEqual({ cord: 7, side: 'a', k: 'cancel', reason: 'escape' });
  });

  it('rebuilds from explicit snapshots and disposes once', () => {
    const setup = fixture();
    const view = createCordView({
      stage: asElement(setup.stage), surface: asElement(setup.surface), holes: setup.holes,
      cords: setup.cords, freeSlots: [{ cord: 3, side: 'a' }],
      callbacks: { onResult: vi.fn() },
    });
    view.update([setup.cords[0] as CordViewCord], []);
    expect(withClass(setup.stage, 'cord-path')).toHaveLength(1);
    expect(withClass(setup.stage, 'cord-handle')).toHaveLength(2);
    expect(withClass(setup.stage, 'cord-tray-slot')).toHaveLength(0);

    view.dispose();
    view.dispose();
    expect(setup.stage.children).toEqual([setup.surface]);
    expect([...setup.stage.listeners.values()].every((listeners) => listeners.size === 0)).toBe(true);
    expect(() => view.repaint()).not.toThrow();
    expect(() => view.update([], [])).not.toThrow();
  });
});
