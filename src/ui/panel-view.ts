import {
  PANEL_BANDS,
  PANEL_COMPONENTS,
  PANEL_CONTROLS,
  PANEL_HOLES,
  PANEL_LEGENDS,
  PANEL_LINEWORK,
  PANEL_PLATES,
  PANEL_TERMINALS,
  validatePanelLayout,
  type PanelComponent,
  type PanelControl,
  type PanelLinework,
  type RawNetlistView,
} from './panel-layout.ts';

export interface PeriodPanelControls {
  readonly power: HTMLButtonElement;
  readonly breaker: HTMLButtonElement;
  readonly pushbuttons: readonly HTMLButtonElement[];
  readonly switches: readonly HTMLButtonElement[];
  readonly relays: readonly HTMLInputElement[];
  readonly dial: HTMLInputElement;
}

export interface PanelView {
  readonly surface: HTMLElement;
  readonly terminals: ReadonlyMap<string, HTMLElement>;
  readonly holes: ReadonlyMap<string, HTMLButtonElement>;
  readonly outLamps: readonly HTMLElement[];
  readonly relayLamps: readonly HTMLElement[];
  readonly powerJewel: HTMLElement;
  readonly dialPointer: HTMLElement;
  readonly controls: PeriodPanelControls;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const OUT_LAMP_IDS = Object.freeze([
  'out-lamp-1', 'out-lamp-2', 'out-lamp-3',
  'out-lamp-4', 'out-lamp-5', 'out-lamp-6',
]);
const RELAY_LAMP_IDS = Object.freeze([
  'relay-lamp-1', 'relay-lamp-2', 'relay-lamp-3',
  'relay-lamp-4', 'relay-lamp-5', 'relay-lamp-6',
]);

function html<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function place(node: HTMLElement, x: number, y: number): void {
  node.style.left = x * 100 + '%';
  node.style.top = y * 100 + '%';
  node.style.transform = 'translate(-50%, -50%)';
}

function sourceData(node: HTMLElement | SVGElement, source: string): void {
  node.dataset.source = source;
}

function requireElement<T extends HTMLElement>(
  values: ReadonlyMap<string, HTMLElement>,
  id: string,
): T {
  const value = values.get(id);
  if (value === undefined) throw new Error('panel view: missing component ' + id);
  return value as T;
}

function componentClass(kind: string): string {
  switch (kind) {
    case 'standard-lamp': return 'panel-lamp';
    case 'relay': return 'relay-component';
    case 'rivet': return 'panel-rivet';
    case 'power-jewel': return 'power-jewel';
    case 'dial-knob': return 'decimal-dial';
    case 'slide-switch':
    case 'pushbutton':
    case 'breaker-button':
    case 'power-switch': return 'panel-control-anchor';
    default: throw new Error('panel view: unknown component kind ' + JSON.stringify(kind));
  }
}

function renderComponent(document: Document, item: PanelComponent): HTMLElement {
  const node = html(document, 'span', 'panel-component ' + componentClass(item.kind));
  node.dataset.component = item.id;
  node.dataset.kind = item.kind;
  node.dataset.region = item.region;
  sourceData(node, item.source);
  place(node, item.x, item.y);

  if (item.kind === 'standard-lamp') {
    node.setAttribute('role', 'img');
  } else if (item.kind === 'rivet') {
    node.setAttribute('aria-hidden', 'true');
  } else if (item.kind === 'relay') {
    node.style.width = '9.5cqi';
    node.style.height = '5.8cqi';
    node.append(
      html(document, 'i', 'relay-coil'),
      html(document, 'i', 'relay-crossbar'),
      html(document, 'i', 'relay-contacts'),
    );
  } else if (item.kind === 'dial-knob') {
    node.style.width = '8.5cqi';
    node.style.height = '8.5cqi';
    const knob = html(document, 'div', 'decimal-knob');
    knob.setAttribute('aria-hidden', 'true');
    knob.style.position = 'absolute';
    knob.style.inset = '0';
    knob.style.width = '100%';
    knob.style.height = '100%';
    knob.append(html(document, 'i', 'decimal-pointer'));
    node.append(knob);
  }
  return node;
}

function svg<K extends keyof SVGElementTagNameMap>(
  document: Document,
  tag: K,
  className: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  node.setAttribute('class', className);
  return node;
}

function scaled(value: number): string {
  return String(value * 1000);
}

function points(item: PanelLinework): string {
  return item.points.map((value) => scaled(value.x) + ',' + scaled(value.y)).join(' ');
}

function renderArrow(document: Document, item: PanelLinework): SVGElement {
  const path = svg(document, 'path', 'panel-bracket panel-arrow');
  const start = item.points[0];
  const end = item.points[1];
  if (start === undefined || end === undefined) throw new Error('panel view: incomplete arrow ' + item.id);
  const x1 = start.x * 1000;
  const y1 = start.y * 1000;
  const x2 = end.x * 1000;
  const y2 = end.y * 1000;
  const direction = x2 >= x1 ? -1 : 1;
  path.setAttribute(
    'd',
    'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2 +
    ' M ' + x2 + ' ' + y2 + ' l ' + direction * 6 + ' -4' +
    ' M ' + x2 + ' ' + y2 + ' l ' + direction * 6 + ' 4',
  );
  return path;
}

function renderBracket(document: Document, item: PanelLinework): SVGElement {
  if (item.points.length !== 2) {
    const polyline = svg(document, 'polyline', 'panel-bracket');
    polyline.setAttribute('points', points(item));
    return polyline;
  }
  const start = item.points[0];
  const end = item.points[1];
  if (start === undefined || end === undefined) throw new Error('panel view: incomplete bracket ' + item.id);
  const path = svg(document, 'path', 'panel-bracket');
  path.setAttribute(
    'd',
    'M ' + scaled(start.x) + ' ' + scaled(start.y + 0.006) +
    ' V ' + scaled(start.y) + ' H ' + scaled(end.x) + ' V ' + scaled(end.y + 0.006),
  );
  return path;
}

function renderLinework(document: Document, item: PanelLinework): SVGElement {
  let node: SVGElement;
  switch (item.kind) {
    case 'circle': {
      if (item.radiusX === undefined || item.radiusY === undefined) {
        throw new Error('panel view: circle has no radii ' + item.id);
      }
      const ellipse = svg(document, 'ellipse', 'decimal-ring');
      ellipse.setAttribute('cx', scaled(item.x));
      ellipse.setAttribute('cy', scaled(item.y));
      ellipse.setAttribute('rx', scaled(item.radiusX));
      ellipse.setAttribute('ry', scaled(item.radiusY));
      node = ellipse;
      break;
    }
    case 'closed-loop': {
      const polygon = svg(document, 'polygon', 'matrix-terminal-loop');
      polygon.setAttribute('points', points(item));
      node = polygon;
      break;
    }
    case 'arrow': node = renderArrow(document, item); break;
    case 'bracket': node = renderBracket(document, item); break;
    case 'pair-bar': {
      const polyline = svg(document, 'polyline', 'matrix-terminal-bar');
      polyline.setAttribute('points', points(item));
      node = polyline;
      break;
    }
    case 'radial': {
      const polyline = svg(document, 'polyline', 'decimal-sector');
      polyline.setAttribute('points', points(item));
      node = polyline;
      break;
    }
    case 'rule': {
      const polyline = svg(document, 'polyline', 'matrix-rule');
      polyline.setAttribute('points', points(item));
      node = polyline;
      break;
    }
  }
  node.dataset.linework = item.id;
  node.dataset.kind = item.kind;
  sourceData(node, item.source);
  return node;
}

function labelClass(form: string): string {
  switch (form) {
    case 'section-number': return 'panel-section-number';
    case 'terminal': return 'panel-terminal-label';
    case 'terminal-above': return 'panel-terminal-label panel-terminal-label-above';
    case 'terminal-left': return 'panel-terminal-label panel-terminal-label-left';
    case 'band-title': return 'panel-title panel-band-title';
    case 'block-title': return 'panel-title';
    case 'block-title-left': return 'panel-title panel-title-left';
    case 'logotype': return 'panel-logo';
    case 'fine-print': return 'panel-fine-print';
    default: return 'panel-' + form;
  }
}

function componentIdForControl(control: PanelControl): string {
  switch (control.kind) {
    case 'relay-crossbar': return 'relay-' + requireSection(control);
    case 'slide-switch': return 'slide-' + requireSection(control);
    case 'pushbutton': return 'pushbutton-' + requireSection(control);
    case 'power-switch': return 'power-switch';
    case 'breaker-button': return 'breaker-button';
    case 'dial': return 'dial-knob';
    default: throw new Error('panel view: unknown control kind ' + JSON.stringify(control.kind));
  }
}

function requireSection(control: PanelControl): number {
  const section = control.section;
  if (!Number.isInteger(section) || section === null || section < 1 || section > 6) {
    throw new Error('panel view: invalid section on ' + control.id);
  }
  return section;
}

function button(document: Document, className: string, label: string): HTMLButtonElement {
  const node = html(document, 'button', 'panel-control ' + className);
  node.type = 'button';
  node.setAttribute('aria-label', label);
  return node;
}

function range(
  document: Document,
  className: string,
  label: string,
  maximum: number,
): HTMLInputElement {
  const node = html(document, 'input', className);
  node.type = 'range';
  node.min = '0';
  node.max = String(maximum);
  node.step = '1';
  node.setAttribute('aria-label', label);
  return node;
}

function completeSections<T>(values: readonly (T | undefined)[], name: string): readonly T[] {
  if (values.length !== 6 || values.some((value) => value === undefined)) {
    throw new Error('panel view: incomplete ' + name + ' controls');
  }
  return Object.freeze([...values]) as readonly T[];
}

/** Render the immutable period panel and return identity-bound controls for inspector wiring. */
export function createPeriodPanel(document: Document, rawNetlist: RawNetlistView): PanelView {
  validatePanelLayout(rawNetlist);

  const surface = html(document, 'section', 'console-surface');
  surface.setAttribute('aria-label', 'MINIVAC 601 console');

  const plates = new Map(PANEL_PLATES.map((plate) => [plate.id, plate]));
  for (const plate of PANEL_PLATES) {
    const node = html(document, 'div', 'console-plate');
    node.dataset.plate = plate.id;
    sourceData(node, plate.source);
    node.style.left = plate.x * 100 + '%';
    node.style.top = plate.y * 100 + '%';
    node.style.width = plate.width * 100 + '%';
    node.style.height = plate.height * 100 + '%';
    surface.append(node);
  }

  for (const band of PANEL_BANDS) {
    const [id, plateId, tone, top, bottom, title] = band;
    const plate = plateId === 'console' ? PANEL_PLATES.find((value) => value.id === 'upper-right') : plates.get(plateId);
    if (plate === undefined) throw new Error('panel view: missing plate for band ' + id);
    const node = html(document, 'div', 'console-band console-band-' + tone);
    node.dataset.band = id;
    node.dataset.plate = plateId;
    if (title !== null) node.dataset.title = title;
    node.style.left = plate.x * 100 + '%';
    node.style.top = top * 100 + '%';
    node.style.width = plate.width * 100 + '%';
    node.style.height = (bottom - top) * 100 + '%';
    surface.append(node);
  }

  const artwork = svg(document, 'svg', 'panel-linework');
  artwork.setAttribute('viewBox', '0 0 1000 1000');
  artwork.setAttribute('preserveAspectRatio', 'none');
  artwork.setAttribute('aria-hidden', 'true');
  artwork.style.inset = '0';
  artwork.style.width = '100%';
  artwork.style.height = '100%';
  for (const item of PANEL_LINEWORK) artwork.append(renderLinework(document, item));
  surface.append(artwork);

  for (const item of PANEL_LEGENDS) {
    const node = html(document, 'span', 'panel-label ' + labelClass(item.form));
    node.dataset.legend = item.id;
    node.dataset.form = item.form;
    node.dataset.region = item.region;
    sourceData(node, item.source);
    if (item.form === 'glyph') {
      node.dataset.text = item.text;
      node.setAttribute('aria-hidden', 'true');
    } else {
      node.textContent = item.text;
    }
    if (item.form === 'two-line') node.style.width = '5%';
    place(node, item.x, item.y);
    if (item.form === 'block-title-left') node.style.transform = 'translate(0, -50%)';
    surface.append(node);
  }

  const holesByTerminal = new Map<string, typeof PANEL_HOLES[number][]>();
  for (const hole of PANEL_HOLES) {
    const values = holesByTerminal.get(hole.terminal) ?? [];
    values.push(hole);
    holesByTerminal.set(hole.terminal, values);
  }
  const terminalElements = new Map<string, HTMLElement>();
  const holeButtons = new Map<string, HTMLButtonElement>();
  for (const terminal of PANEL_TERMINALS) {
    const wrapper = html(document, 'div', 'panel-terminal');
    wrapper.dataset.terminal = terminal.id;
    wrapper.dataset.region = terminal.region;
    wrapper.dataset.artwork = terminal.artwork;
    wrapper.dataset.holes = String(terminal.holes.length);
    sourceData(wrapper, terminal.source);
    wrapper.style.inset = '0';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.display = 'block';
    wrapper.style.transform = 'none';
    wrapper.style.pointerEvents = 'none';
    const holes = holesByTerminal.get(terminal.id);
    if (holes === undefined || holes.length !== terminal.holes.length) {
      throw new Error('panel view: incomplete holes for ' + terminal.id);
    }
    for (const hole of holes) {
      const node = html(document, 'button', 'panel-hole');
      node.type = 'button';
      node.dataset.terminal = terminal.id;
      node.dataset.hole = hole.id;
      node.setAttribute('aria-label', hole.id);
      node.title = hole.id;
      node.style.position = 'absolute';
      node.style.pointerEvents = 'auto';
      place(node, hole.x, hole.y);
      wrapper.append(node);
      holeButtons.set(hole.id, node);
    }
    terminalElements.set(terminal.id, wrapper);
    surface.append(wrapper);
  }

  const componentElements = new Map<string, HTMLElement>();
  for (const item of PANEL_COMPONENTS) {
    const node = renderComponent(document, item);
    componentElements.set(item.id, node);
    surface.append(node);
  }

  const outLamps = OUT_LAMP_IDS.map((id, index) => {
    const lamp = requireElement(componentElements, id);
    lamp.setAttribute('aria-label', 'Output lamp ' + (index + 1));
    return lamp;
  });
  const relayLamps = RELAY_LAMP_IDS.map((id, index) => {
    const lamp = requireElement(componentElements, id);
    lamp.setAttribute('aria-label', 'Relay ' + (index + 1) + ' indicator lamp');
    return lamp;
  });
  const powerJewel = requireElement(componentElements, 'power-jewel');
  powerJewel.setAttribute('role', 'img');
  powerJewel.setAttribute('aria-label', 'Power indicator');

  const pushbuttons: (HTMLButtonElement | undefined)[] = new Array(6);
  const switches: (HTMLButtonElement | undefined)[] = new Array(6);
  const relays: (HTMLInputElement | undefined)[] = new Array(6);
  let power: HTMLButtonElement | undefined;
  let breaker: HTMLButtonElement | undefined;
  let dial: HTMLInputElement | undefined;

  for (const item of PANEL_CONTROLS) {
    const anchor = requireElement(componentElements, componentIdForControl(item));
    let node: HTMLButtonElement | HTMLInputElement;
    switch (item.kind) {
      case 'pushbutton': {
        const section = requireSection(item);
        const value = button(document, 'panel-pushbutton', 'Pushbutton ' + section);
        value.dataset.section = String(section);
        pushbuttons[section - 1] = value;
        node = value;
        break;
      }
      case 'slide-switch': {
        const section = requireSection(item);
        const value = button(document, 'panel-slide', 'Slide switch ' + section);
        value.dataset.section = String(section);
        value.setAttribute('aria-pressed', 'false');
        switches[section - 1] = value;
        node = value;
        break;
      }
      case 'relay-crossbar': {
        const section = requireSection(item);
        const value = range(document, 'relay-crossbar-control', 'Relay ' + section + ' crossbar', 1000);
        value.dataset.section = String(section);
        relays[section - 1] = value;
        node = value;
        break;
      }
      case 'power-switch': {
        const value = button(document, 'power-switch', 'Power');
        value.setAttribute('aria-pressed', 'false');
        power = value;
        node = value;
        break;
      }
      case 'breaker-button': {
        const value = button(document, 'breaker-button', 'Reset circuit breaker');
        breaker = value;
        node = value;
        break;
      }
      case 'dial': {
        const value = range(document, 'dial-grab-control', 'Decimal dial angle', 359_999_999);
        dial = value;
        node = value;
        break;
      }
      default: throw new Error('panel view: unknown control kind ' + JSON.stringify(item.kind));
    }
    node.dataset.control = item.id;
    node.dataset.region = item.region;
    sourceData(node, item.source);
    anchor.append(node);
  }

  if (power === undefined || breaker === undefined || dial === undefined) {
    throw new Error('panel view: incomplete power or dial controls');
  }
  const dialPointer = requireElement(componentElements, 'dial-knob').querySelector<HTMLElement>('.decimal-pointer');
  if (dialPointer === null) throw new Error('panel view: missing dial pointer');

  return Object.freeze({
    surface,
    terminals: terminalElements,
    holes: holeButtons,
    outLamps: Object.freeze(outLamps),
    relayLamps: Object.freeze(relayLamps),
    powerJewel,
    dialPointer,
    controls: Object.freeze({
      power,
      breaker,
      pushbuttons: completeSections(pushbuttons, 'pushbutton'),
      switches: completeSections(switches, 'slide-switch'),
      relays: completeSections(relays, 'relay'),
      dial,
    }),
  });
}
