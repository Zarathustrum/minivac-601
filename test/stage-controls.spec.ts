import { describe, expect, it } from 'vitest';
import { PANEL_TERMINALS } from '../src/ui/panel-layout.ts';
import {
  createStageController,
  createTerminalPicker,
  type PickerResult,
  type StageResizeObserverFactory,
  type StageState,
} from '../src/ui/stage-controls.ts';

interface FakeRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

class FakeElement extends EventTarget {
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly tagName: string;
  className = '';
  textContent = '';
  value = '';
  type = '';
  hidden = false;
  tabIndex = -1;
  isContentEditable = false;
  focused = false;
  capturedPointer: number | null = null;
  rect: FakeRect = { left: 0, top: 0, width: 1, height: 1 };
  scaleSource: FakeElement | null = null;

  constructor(readonly ownerDocument: FakeDocument, tagName: string) {
    super();
    this.tagName = tagName.toUpperCase();
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
    if (name === 'tabindex') this.tabIndex = Number(value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
    if (name === 'tabindex') this.tabIndex = -1;
  }

  getBoundingClientRect(): DOMRect {
    const scale = elementScale(this.scaleSource ?? this);
    return {
      ...this.rect,
      width: this.rect.width * scale,
      height: this.rect.height * scale,
      right: this.rect.left + this.rect.width * scale,
      bottom: this.rect.top + this.rect.height * scale,
      x: this.rect.left,
      y: this.rect.top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  querySelector<T extends FakeElement>(selector: string): T | null {
    if (selector !== '[data-touch]') throw new Error('fake element: unsupported selector ' + selector);
    return descendants(this).find((node) => node.dataset.touch !== undefined) as T | undefined ?? null;
  }

  setPointerCapture(pointerId: number): void {
    this.capturedPointer = pointerId;
  }

  focus(): void {
    this.focused = true;
  }
}

class FakeDocument {
  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag);
  }
}

function elementScale(element: FakeElement): number {
  const match = /scale\(([^)]+)\)/u.exec(element.style.transform ?? '');
  return match === null ? 1 : Number(match[1]);
}

function descendants(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(descendants)];
}

function byText(root: FakeElement, text: string): FakeElement {
  const value = descendants(root).find((node) => node.textContent === text);
  if (value === undefined) throw new Error('missing fake element ' + JSON.stringify(text));
  return value;
}

function byData(root: FakeElement, key: 'hole' | 'terminal' | 'touch', value: string): FakeElement {
  const result = descendants(root).find((node) => node.dataset[key] === value);
  if (result === undefined) throw new Error('missing fake data ' + key + '=' + value);
  return result;
}

function event(type: string, values: Record<string, unknown> = {}): Event {
  const result = new Event(type, { cancelable: true });
  for (const [key, value] of Object.entries(values)) Object.defineProperty(result, key, { value });
  return result;
}

function stageFixture(overrides: { maxScale?: number; onChange?: (state: StageState) => void } = {}) {
  const document = new FakeDocument();
  const stage = document.createElement('div');
  stage.rect = { left: 0, top: 0, width: 800, height: 400 };
  stage.style.overflow = '';
  stage.style.scrollBehavior = '';
  const surface = document.createElement('div');
  surface.rect = { left: 40, top: 0, width: 720, height: 400 };
  surface.style.transform = '';
  surface.style.transformOrigin = '';
  surface.style.transition = '';
  const holes = [10, 12].map((size) => {
    const hole = document.createElement('button');
    hole.rect = { left: 0, top: 0, width: size, height: size };
    hole.scaleSource = surface;
    return hole;
  });
  let resize: (() => void) | null = null;
  let disconnects = 0;
  const resizeObserver: StageResizeObserverFactory = (callback) => {
    resize = callback;
    return { observe: (target) => expect(target).toBe(stage), disconnect: () => { disconnects++; } };
  };
  const controller = createStageController({
    stage: stage as unknown as HTMLElement,
    surface: surface as unknown as HTMLElement,
    holes: holes as unknown as readonly HTMLElement[],
    resizeObserver,
    ...(overrides.maxScale === undefined ? {} : { maxScale: overrides.maxScale }),
    ...(overrides.onChange === undefined ? {} : { onChange: overrides.onChange }),
  });
  return {
    document,
    stage,
    surface,
    holes,
    controller,
    resize: () => {
      if (resize === null) throw new Error('resize observer was not installed');
      resize();
    },
    disconnects: () => disconnects,
  };
}

describe('fixed panel stage controls', () => {
  it('pins Wire scale to actual hole geometry, clamps zoom, and resets Fit exactly', () => {
    const values: StageState[] = [];
    const fixture = stageFixture({ maxScale: 3, onChange: (state) => values.push(state) });

    expect(fixture.controller.state).toEqual({
      view: 'fit', scale: 1, panX: 0, panY: 0,
      transform: 'translate(0px, 0px) scale(1)',
    });
    fixture.controller.setView('wire');
    expect(fixture.controller.state.scale).toBe(2.425);
    expect(fixture.holes[0]!.getBoundingClientRect().width).toBe(24.25);
    expect(fixture.holes[1]!.getBoundingClientRect().width).toBeCloseTo(29.1);

    fixture.controller.zoomBy(100);
    expect(fixture.controller.state.scale).toBe(3);
    fixture.controller.zoomBy(0.001);
    expect(fixture.controller.state.scale).toBe(2.425);
    fixture.controller.setView('fit');
    expect(fixture.controller.state).toEqual({
      view: 'fit', scale: 1, panX: 0, panY: 0,
      transform: 'translate(0px, 0px) scale(1)',
    });
    expect(values.at(-1)).toEqual(fixture.controller.state);
  });

  it('contains pan against scaled surface edges with deterministic transform math', () => {
    const fixture = stageFixture();
    fixture.controller.setView('wire');
    fixture.controller.panBy(10_000, -10_000);

    expect(fixture.controller.state).toEqual({
      view: 'wire', scale: 2.425, panX: 473, panY: -285,
      transform: 'translate(473px, -285px) scale(2.425)',
    });
    expect(fixture.surface.style.transform).toBe('translate(473px, -285px) scale(2.425)');
  });

  it('refreshes Wire scale and containment after observed geometry changes', () => {
    const changes: StageState[] = [];
    const fixture = stageFixture({ onChange: (state) => changes.push(state) });
    fixture.controller.setView('wire');
    fixture.controller.panBy(10_000, 10_000);
    fixture.holes[0]!.rect.width = 6;
    fixture.holes[0]!.rect.height = 6;
    fixture.stage.rect.width = 1000;
    fixture.stage.rect.height = 500;
    fixture.resize();

    expect(fixture.controller.state).toEqual({
      view: 'wire', scale: 4.041667, panX: 473, panY: 285,
      transform: 'translate(473px, 285px) scale(4.041667)',
    });
    expect(fixture.holes[0]!.getBoundingClientRect().width).toBeCloseTo(24.25);
    expect(changes.at(-1)).toEqual(fixture.controller.state);
  });

  it('supports wheel, button, and stage-key controls without animation', () => {
    const fixture = stageFixture();
    const controls = fixture.controller.controls as unknown as FakeElement;
    expect(fixture.surface.style.transition).toBe('none');
    expect(fixture.stage.style.scrollBehavior).toBe('auto');

    const wheel = event('wheel', { deltaY: -1 });
    fixture.stage.dispatchEvent(wheel);
    expect(wheel.defaultPrevented).toBe(true);
    expect(fixture.controller.state.view).toBe('wire');

    byText(controls, 'Fit').dispatchEvent(event('click'));
    expect(fixture.controller.state.scale).toBe(1);
    byText(controls, 'Wire').dispatchEvent(event('click'));
    expect(fixture.controller.state.scale).toBe(2.425);
    byText(controls, '+').dispatchEvent(event('click'));
    expect(fixture.controller.state.scale).toBe(3.03125);
    byText(controls, '→').dispatchEvent(event('click'));
    expect(fixture.controller.state.panX).toBe(-32);

    const left = event('keydown', { key: 'ArrowLeft' });
    fixture.stage.dispatchEvent(left);
    expect(left.defaultPrevented).toBe(true);
    expect(fixture.controller.state.panX).toBe(0);
    fixture.stage.dispatchEvent(event('keydown', { key: 'Home' }));
    expect(fixture.controller.state.view).toBe('fit');
  });

  it('fails rather than claiming Wire accessibility beyond its configured clamp', () => {
    const fixture = stageFixture({ maxScale: 2 });
    expect(() => fixture.controller.setView('wire')).toThrow('cannot provide 24px');
    expect(fixture.controller.state).toEqual({
      view: 'fit', scale: 1, panX: 0, panY: 0,
      transform: 'translate(0px, 0px) scale(1)',
    });
  });

  it('tears down listeners, resize observation, attributes, and styles idempotently', () => {
    const fixture = stageFixture();
    const controls = fixture.controller.controls as unknown as FakeElement;
    fixture.controller.dispose();
    fixture.controller.dispose();

    expect(fixture.disconnects()).toBe(1);
    expect(fixture.stage.getAttribute('tabindex')).toBeNull();
    expect(fixture.stage.style.overflow).toBe('');
    expect(fixture.surface.style.transform).toBe('');
    expect(fixture.surface.style.transition).toBe('');
    fixture.stage.dispatchEvent(event('wheel', { deltaY: -1 }));
    byText(controls, 'Wire').dispatchEvent(event('click'));
    fixture.resize();
    expect(fixture.controller.state).toEqual({
      view: 'fit', scale: 1, panX: 0, panY: 0,
      transform: 'translate(0px, 0px) scale(1)',
    });
  });
});

function pickerFixture(terminals = [
  { id: '1A', holes: ['1A#2', '1A#1'] },
  { id: 'D0', holes: ['D0#1', 'D0#2'] },
]) {
  const document = new FakeDocument();
  const results: PickerResult[] = [];
  const picker = createTerminalPicker(
    document as unknown as Document,
    { cordId: 7, side: 'b' },
    terminals,
    (result) => results.push(result),
  );
  return { document, picker, root: picker.element as unknown as FakeElement, results };
}

describe('terminal picker', () => {
  it('preserves every supplied terminal and HoleId in caller order', () => {
    const supplied = PANEL_TERMINALS.map((terminal) => ({
      id: terminal.id,
      holes: terminal.holes.map((hole) => hole.id),
    }));
    const fixture = pickerFixture(supplied);
    const nodes = descendants(fixture.root);

    expect(nodes.filter((node) => node.dataset.terminal !== undefined).map((node) => node.dataset.terminal))
      .toEqual(supplied.map((terminal) => terminal.id));
    expect(nodes.filter((node) => node.dataset.hole !== undefined).map((node) => node.dataset.hole))
      .toEqual(supplied.flatMap((terminal) => terminal.holes));
    expect(nodes.filter((node) => node.dataset.hole !== undefined)).toHaveLength(392);
  });

  it('filters without reordering or discarding exact identity nodes', () => {
    const fixture = pickerFixture();
    const before = descendants(fixture.root).filter((node) => node.dataset.hole !== undefined);
    const search = fixture.picker.search as unknown as FakeElement;
    search.value = ' d0#2 ';
    search.dispatchEvent(event('input'));

    expect(byData(fixture.root, 'terminal', '1A').hidden).toBe(true);
    expect(byData(fixture.root, 'terminal', 'D0').hidden).toBe(false);
    expect(descendants(fixture.root).filter((node) => node.dataset.hole !== undefined)).toEqual(before);
  });

  it('returns explicit endpoint-bound hole, Free, and keyboard-cancel results', () => {
    const fixture = pickerFixture();
    byData(fixture.root, 'hole', '1A#2').dispatchEvent(event('click'));
    byText(fixture.root, 'Free').dispatchEvent(event('click'));
    const escape = event('keydown', { key: 'Escape' });
    fixture.root.dispatchEvent(escape);

    expect(escape.defaultPrevented).toBe(true);
    expect(fixture.results).toEqual([
      { k: 'hole', endpoint: { cordId: 7, side: 'b' }, hole: '1A#2' },
      { k: 'free', endpoint: { cordId: 7, side: 'b' } },
      { k: 'cancel', endpoint: { cordId: 7, side: 'b' } },
    ]);
    expect(Object.isFrozen(fixture.results[0])).toBe(true);
    expect(Object.isFrozen(fixture.results[0]!.endpoint)).toBe(true);
  });

  it('makes Touch momentary for pointer and keyboard activation', () => {
    const fixture = pickerFixture();
    const touch = byData(fixture.root, 'touch', 'D0');
    touch.dispatchEvent(event('pointerdown', { pointerId: 19 }));
    touch.dispatchEvent(event('pointerup', { pointerId: 19 }));
    touch.dispatchEvent(event('pointercancel', { pointerId: 19 }));
    const down = event('keydown', { key: 'Enter', repeat: false });
    const up = event('keyup', { key: 'Enter' });
    touch.dispatchEvent(down);
    touch.dispatchEvent(up);
    touch.dispatchEvent(event('pointerdown', { pointerId: 20 }));
    fixture.root.dispatchEvent(event('keydown', { key: 'Escape' }));

    expect(touch.capturedPointer).toBe(20);
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(fixture.results).toEqual([
      { k: 'touch', endpoint: { cordId: 7, side: 'b' }, terminal: 'D0', active: true },
      { k: 'touch', endpoint: { cordId: 7, side: 'b' }, terminal: 'D0', active: false },
      { k: 'touch', endpoint: { cordId: 7, side: 'b' }, terminal: 'D0', active: true },
      { k: 'touch', endpoint: { cordId: 7, side: 'b' }, terminal: 'D0', active: false },
      { k: 'touch', endpoint: { cordId: 7, side: 'b' }, terminal: 'D0', active: true },
      { k: 'touch', endpoint: { cordId: 7, side: 'b' }, terminal: 'D0', active: false },
      { k: 'cancel', endpoint: { cordId: 7, side: 'b' } },
    ]);
  });

  it('fits a narrow parent, focuses search, and removes every listener on dispose', () => {
    const fixture = pickerFixture();
    expect(fixture.root.style.width).toBe('100%');
    expect(fixture.root.style.minWidth).toBe('0');
    expect(fixture.root.style.overflow).toBe('auto');
    fixture.picker.focus();
    expect((fixture.picker.search as unknown as FakeElement).focused).toBe(true);

    const touch = byData(fixture.root, 'touch', '1A');
    touch.dispatchEvent(event('pointerdown', { pointerId: 4 }));
    fixture.picker.dispose();
    fixture.picker.dispose();
    byText(fixture.root, 'Free').dispatchEvent(event('click'));
    touch.dispatchEvent(event('pointerup', { pointerId: 4 }));
    fixture.root.dispatchEvent(event('keydown', { key: 'Escape' }));

    expect(fixture.results).toEqual([
      { k: 'touch', endpoint: { cordId: 7, side: 'b' }, terminal: '1A', active: true },
      { k: 'touch', endpoint: { cordId: 7, side: 'b' }, terminal: '1A', active: false },
    ]);
  });
});
