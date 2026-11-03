import { vi } from 'vitest';

/**
 * Just enough DOM to mount the console under Vitest's node environment, which has none. It is not
 * a browser: no layout (every rect is zero), no `inert` hit-testing, and events go straight to the
 * element they are dispatched on, synchronously, so a listener's throw reaches the dispatcher.
 * Anything the console calls that is not here fails loudly as "not a function".
 */

type Listener = (event: Event) => void;

class Listeners {
  private readonly byType = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener): void {
    let set = this.byType.get(type);
    if (set === undefined) this.byType.set(type, set = new Set());
    set.add(listener);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.byType.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    for (const listener of [...this.byType.get(event.type) ?? []]) listener.call(this, event);
    return true;
  }

  listenerCount(): number {
    let count = 0;
    for (const set of this.byType.values()) count += set.size;
    return count;
  }
}

function camel(dataAttribute: string): string {
  return dataAttribute.slice(5).replace(/-([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

export class FakeElement extends Listeners {
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, unknown> = {
    setProperty: (name: string, value: string): void => { this.style[name] = value; },
    removeProperty: (name: string): void => { delete this.style[name]; },
    getPropertyValue: (name: string): string => String(this.style[name] ?? ''),
  };
  private readonly classes = new Set<string>();
  readonly classList = {
    add: (...names: string[]): void => { for (const name of names) this.classes.add(name); },
    remove: (...names: string[]): void => { for (const name of names) this.classes.delete(name); },
    contains: (name: string): boolean => this.classes.has(name),
    toggle: (name: string, force?: boolean): boolean => {
      const on = force ?? !this.classes.has(name);
      if (on) this.classes.add(name);
      else this.classes.delete(name);
      return on;
    },
  };
  private readonly attributes = new Map<string, string>();
  textContent = '';
  hidden = false;
  inert = false;
  disabled = false;
  checked = false;
  open = false;
  value = '';
  type = '';
  title = '';
  id = '';
  name = '';
  tabIndex = -1;
  scrollTop = 0;
  scrollHeight = 0;

  readonly ownerDocument: FakeDocument;
  readonly tagName: string;

  constructor(ownerDocument: FakeDocument, tagName: string) {
    super();
    this.ownerDocument = ownerDocument;
    this.tagName = tagName;
  }

  get className(): string {
    return [...this.classes].join(' ');
  }

  set className(value: string) {
    this.classes.clear();
    for (const name of value.split(/\s+/u)) if (name !== '') this.classes.add(name);
  }

  setAttribute(name: string, value: string): void {
    const text = String(value);
    if (name === 'class') this.className = text;
    else if (name === 'id') this.id = text;
    else if (name.startsWith('data-')) this.dataset[camel(name)] = text;
    this.attributes.set(name, text);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  append(...nodes: (FakeElement | string)[]): void {
    for (const node of nodes) {
      const child = typeof node === 'string' ? this.ownerDocument.createTextNode(node) : node;
      child.remove();
      child.parentElement = this;
      this.children.push(child);
    }
  }

  replaceChildren(...nodes: (FakeElement | string)[]): void {
    for (const child of this.children) child.parentElement = null;
    this.children.length = 0;
    this.append(...nodes);
  }

  remove(): void {
    const parent = this.parentElement;
    if (parent === null) return;
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentElement = null;
  }

  contains(node: FakeElement | null): boolean {
    for (let at = node; at !== null; at = at.parentElement) if (at === this) return true;
    return false;
  }

  /** Every descendant, depth first. */
  all(): FakeElement[] {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }

  querySelectorAll(selector: string): FakeElement[] {
    const match = /^([.#])([\w-]+)$/u.exec(selector);
    if (match === null) throw new Error('fake dom: unsupported selector ' + JSON.stringify(selector));
    const [, kind, name] = match;
    return this.all().filter((node) => kind === '.' ? node.classList.contains(name!) : node.id === name);
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  getBoundingClientRect(): DOMRect {
    return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect;
  }

  focus(): void { this.ownerDocument.activeElement = this; }
  blur(): void { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  setPointerCapture(): void {}
  releasePointerCapture(): void {}
  hasPointerCapture(): boolean { return false; }
  showModal(): void { this.open = true; }
  close(): void { this.open = false; }
}

export class FakeWindow extends Listeners {
  private readonly stored = new Map<string, string>();
  readonly localStorage = {
    getItem: (key: string): string | null => this.stored.get(key) ?? null,
    setItem: (key: string, value: string): void => { this.stored.set(key, value); },
  };
}

export class FakeDocument {
  activeElement: FakeElement | null = null;
  readonly defaultView = new FakeWindow();
  readonly body = new FakeElement(this, 'BODY');

  createElement(tag: string): FakeElement {
    return new FakeElement(this, tag.toUpperCase());
  }

  createElementNS(_namespace: string, tag: string): FakeElement {
    return new FakeElement(this, tag);
  }

  createTextNode(content: string): FakeElement {
    const node = new FakeElement(this, '#text');
    node.textContent = content;
    return node;
  }

  querySelector(selector: string): FakeElement | null {
    return this.body.querySelector(selector);
  }
}

export interface FakeFrames {
  /** Run every animation-frame callback queued so far at `nowMs`. */
  run(nowMs: number): void;
  pending(): number;
}

/** Replace the global animation-frame pair; undo with `vi.unstubAllGlobals()`. */
export function stubAnimationFrames(): FakeFrames {
  const queue = new Map<number, FrameRequestCallback>();
  let nextId = 1;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    queue.set(nextId, callback);
    return nextId++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => { queue.delete(id); });
  return {
    run(nowMs: number): void {
      const due = [...queue.values()];
      queue.clear();
      for (const callback of due) callback(nowMs);
    },
    pending: () => queue.size,
  };
}

export function click(target: FakeElement): void {
  target.dispatchEvent(new Event('click'));
}
