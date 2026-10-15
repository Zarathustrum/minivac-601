import { describe, expect, it } from 'vitest';
import rawNetlist from '../data/netlist.json';
import {
  PANEL_COMPONENTS,
  PANEL_CONTROLS,
  PANEL_HOLES,
  PANEL_TERMINALS,
} from '../src/ui/panel-layout.ts';
import { createPeriodPanel } from '../src/ui/panel-view.ts';

class FakeElement {
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  className = '';
  textContent = '';
  title = '';
  type = '';
  min = '';
  max = '';
  step = '';

  constructor(readonly tagName: string) {}

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  querySelector<T extends FakeElement>(selector: string): T | null {
    if (!selector.startsWith('.')) throw new Error('fake document: class selectors only');
    const className = selector.slice(1);
    return descendants(this).find((node) => classes(node).includes(className)) as T | undefined ?? null;
  }
}

class FakeDocument {
  createElement(tag: string): FakeElement {
    return new FakeElement(tag);
  }

  createElementNS(_namespace: string, tag: string): FakeElement {
    return new FakeElement(tag);
  }
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

function withData(root: FakeElement, key: string): FakeElement[] {
  return descendants(root).filter((node) => node.dataset[key] !== undefined);
}

function fakeDocument(): Document {
  return new FakeDocument() as unknown as Document;
}

function fakeElement(value: unknown): FakeElement {
  return value as FakeElement;
}

describe('period panel renderer', () => {
  it('renders the complete frozen artwork and physical inventory', () => {
    const view = createPeriodPanel(fakeDocument(), rawNetlist);
    const surface = fakeElement(view.surface);

    expect(withClass(surface, 'console-plate')).toHaveLength(3);
    expect(withData(surface, 'band')).toHaveLength(12);
    expect(withClass(surface, 'panel-terminal')).toHaveLength(186);
    expect(withClass(surface, 'panel-hole')).toHaveLength(392);
    expect(withData(surface, 'legend')).toHaveLength(264);
    expect(withData(surface, 'component')).toHaveLength(48);
    expect(withData(surface, 'control')).toHaveLength(21);
    expect(withData(surface, 'linework')).toHaveLength(70);

    const glyphs = withData(surface, 'legend').filter((node) => node.dataset.form === 'glyph');
    expect(glyphs).toHaveLength(12);
    expect(glyphs.every((node) => node.textContent === '')).toBe(true);
    expect(glyphs.map((node) => node.dataset.text)).toEqual([
      '←', '→', '←', '→', '←', '→', '←', '→', '←', '→', '←', '→',
    ]);
    expect(withData(surface, 'linework').filter((node) => node.dataset.kind === 'arrow')).toHaveLength(12);

    const matrixTitle = withData(surface, 'legend').find((node) => node.dataset.legend === 'matrix/title');
    expect(matrixTitle?.dataset.form).toBe('block-title-left');
    expect(classes(matrixTitle as FakeElement)).toContain('panel-title-left');
    expect(matrixTitle?.textContent).toBe('MATRIX');
  });

  it('keeps every map entry on the exact rendered identity and accessible hole', () => {
    const view = createPeriodPanel(fakeDocument(), rawNetlist);
    const surface = fakeElement(view.surface);
    const terminalNodes = withClass(surface, 'panel-terminal');
    const holeNodes = withClass(surface, 'panel-hole');

    expect([...view.terminals.keys()]).toEqual(PANEL_TERMINALS.map((terminal) => terminal.id));
    expect([...view.holes.keys()]).toEqual(PANEL_HOLES.map((hole) => hole.id));
    expect(terminalNodes.map((node) => node.dataset.terminal))
      .toEqual(PANEL_TERMINALS.map((terminal) => terminal.id));
    expect(holeNodes.map((node) => node.dataset.hole)).toEqual(PANEL_HOLES.map((hole) => hole.id));

    for (const terminal of PANEL_TERMINALS) {
      const node = fakeElement(view.terminals.get(terminal.id));
      expect(node.dataset.terminal).toBe(terminal.id);
      expect(node.dataset.region).toBe(terminal.region);
    }
    for (const hole of PANEL_HOLES) {
      const node = fakeElement(view.holes.get(hole.id));
      expect(node.dataset.terminal).toBe(hole.terminal);
      expect(node.dataset.hole).toBe(hole.id);
      expect(node.getAttribute('aria-label')).toBe(hole.id);
      expect(node.title).toBe(hole.id);
    }
  });

  it('returns source-bound lamps and controls with direct section identities', () => {
    const view = createPeriodPanel(fakeDocument(), rawNetlist);

    expect(view.outLamps.map((node) => node.dataset.component)).toEqual([
      'out-lamp-1', 'out-lamp-2', 'out-lamp-3', 'out-lamp-4', 'out-lamp-5', 'out-lamp-6',
    ]);
    expect(view.relayLamps.map((node) => node.dataset.component)).toEqual([
      'relay-lamp-1', 'relay-lamp-2', 'relay-lamp-3',
      'relay-lamp-4', 'relay-lamp-5', 'relay-lamp-6',
    ]);
    expect(view.powerJewel.dataset.component).toBe('power-jewel');
    expect([...view.outLamps, ...view.relayLamps]).not.toContain(view.powerJewel);
    expect(new Set([...view.outLamps, ...view.relayLamps])).toHaveProperty('size', 12);

    expect(view.controls.pushbuttons.map((node) => node.dataset.section))
      .toEqual(['1', '2', '3', '4', '5', '6']);
    expect(view.controls.switches.map((node) => node.dataset.section))
      .toEqual(['1', '2', '3', '4', '5', '6']);
    expect(view.controls.relays.map((node) => node.dataset.section))
      .toEqual(['1', '2', '3', '4', '5', '6']);
    expect(view.controls.pushbuttons.map((node) => node.getAttribute('aria-label')))
      .toEqual(['Pushbutton 1', 'Pushbutton 2', 'Pushbutton 3', 'Pushbutton 4', 'Pushbutton 5', 'Pushbutton 6']);
    expect(view.controls.switches.map((node) => node.getAttribute('aria-label')))
      .toEqual(['Slide switch 1', 'Slide switch 2', 'Slide switch 3', 'Slide switch 4', 'Slide switch 5', 'Slide switch 6']);
    expect(view.controls.relays.map((node) => node.getAttribute('aria-label')))
      .toEqual([
        'Relay 1 crossbar', 'Relay 2 crossbar', 'Relay 3 crossbar',
        'Relay 4 crossbar', 'Relay 5 crossbar', 'Relay 6 crossbar',
      ]);
    expect(view.controls.power.getAttribute('aria-label')).toBe('Power');
    expect(view.controls.breaker.getAttribute('aria-label')).toBe('Reset circuit breaker');
    expect(view.controls.dial.getAttribute('aria-label')).toBe('Decimal dial angle');
    expect(view.controls.pushbuttons.every((node) => node.type === 'button')).toBe(true);
    expect(view.controls.switches.every((node) => node.type === 'button')).toBe(true);
    expect(view.controls.relays.every((node) => node.type === 'range')).toBe(true);
    expect(view.controls.dial.type).toBe('range');
    expect(Object.isFrozen(view.outLamps)).toBe(true);
    expect(Object.isFrozen(view.relayLamps)).toBe(true);
    expect(Object.isFrozen(view.controls)).toBe(true);
  });

  it('uses one dial containing block and one center translation', () => {
    const view = createPeriodPanel(fakeDocument(), rawNetlist);
    const surface = fakeElement(view.surface);
    const wrapper = withData(surface, 'component').find((node) => node.dataset.component === 'dial-knob');
    const knob = wrapper?.querySelector<FakeElement>('.decimal-knob');
    const pointer = wrapper?.querySelector<FakeElement>('.decimal-pointer');
    const dialComponent = PANEL_COMPONENTS.find((item) => item.id === 'dial-knob');
    const dialControl = PANEL_CONTROLS.find((item) => item.id === 'dial');

    expect(dialComponent).toBeDefined();
    expect(dialControl).toMatchObject({ x: dialComponent?.x, y: dialComponent?.y });
    expect(wrapper?.style.left).toBe((dialComponent?.x ?? 0) * 100 + '%');
    expect(wrapper?.style.top).toBe((dialComponent?.y ?? 0) * 100 + '%');
    expect(wrapper?.style.transform).toBe('translate(-50%, -50%)');
    expect(knob?.style.inset).toBe('0');
    expect(knob?.style.transform).toBeUndefined();
    expect(pointer?.style.transform).toBeUndefined();
    expect(wrapper?.children).toContain(fakeElement(view.controls.dial));
    expect(fakeElement(view.controls.dial).style.transform).toBeUndefined();
    expect(fakeElement(view.dialPointer)).toBe(pointer);
  });
});
