export type StageView = 'fit' | 'wire';

export interface StageState {
  readonly view: StageView;
  readonly scale: number;
  readonly panX: number;
  readonly panY: number;
  readonly transform: string;
}

export interface StageResizeObserver {
  observe(target: Element): void;
  disconnect(): void;
}

export type StageResizeObserverFactory = (refresh: () => void) => StageResizeObserver;

export interface StageControllerOptions {
  readonly stage: HTMLElement;
  readonly surface: HTMLElement;
  readonly holes: readonly HTMLElement[];
  readonly minScale?: number;
  readonly maxScale?: number;
  readonly zoomStep?: number;
  readonly panStepPx?: number;
  readonly resizeObserver?: StageResizeObserverFactory;
  readonly onChange?: (state: StageState) => void;
}

export interface StageController {
  readonly controls: HTMLElement;
  readonly state: StageState;
  setView(view: StageView): void;
  zoomBy(factor: number): void;
  panBy(dx: number, dy: number): void;
  refresh(): void;
  dispose(): void;
}

export interface PickerEndpoint {
  readonly cordId: number;
  readonly side: 'a' | 'b';
}

export interface PickerTerminal {
  readonly id: string;
  readonly holes: readonly string[];
}

export type PickerResult =
  | { readonly k: 'hole'; readonly endpoint: PickerEndpoint; readonly hole: string }
  | { readonly k: 'free'; readonly endpoint: PickerEndpoint }
  | { readonly k: 'touch'; readonly endpoint: PickerEndpoint; readonly terminal: string; readonly active: boolean }
  | { readonly k: 'cancel'; readonly endpoint: PickerEndpoint };

export interface TerminalPicker {
  readonly element: HTMLElement;
  readonly search: HTMLInputElement;
  focus(): void;
  dispose(): void;
}

interface RectSize {
  readonly width: number;
  readonly height: number;
}

// Leave a subpixel guard so browser transform rounding cannot undershoot the 24px gate.
const MIN_HOLE_PX = 24.25;

function finitePositive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error('stage controls: invalid ' + name);
  return value;
}

/** Measured geometry can be zero while the stage is hidden or pre-layout; that is not an error. */
function measurable(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function clean(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function transform(scale: number, panX: number, panY: number): string {
  return 'translate(' + clean(panX) + 'px, ' + clean(panY) + 'px) scale(' + clean(scale) + ')';
}

function button(document: Document, text: string, label: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = text;
  node.setAttribute('aria-label', label);
  return node;
}

/** Own the fixed panel surface transform. It never schedules animation or touches Machine state. */
export function createStageController(options: StageControllerOptions): StageController {
  const { stage, surface, holes } = options;
  if (holes.length === 0) throw new Error('stage controls: at least one hole is required');
  const document = stage.ownerDocument;
  const minScale = finitePositive(options.minScale ?? 1, 'minScale');
  const maxScale = finitePositive(options.maxScale ?? 32, 'maxScale');
  const zoomStep = finitePositive(options.zoomStep ?? 1.25, 'zoomStep');
  const panStep = finitePositive(options.panStepPx ?? 32, 'panStepPx');
  if (minScale > maxScale) throw new Error('stage controls: minScale exceeds maxScale');
  if (zoomStep <= 1) throw new Error('stage controls: zoomStep must exceed one');

  let view: StageView = 'fit';
  let scale = minScale;
  let appliedScale = 1;
  let panX = 0;
  let panY = 0;
  let disposed = false;
  const prior = {
    transform: surface.style.transform,
    transformOrigin: surface.style.transformOrigin,
    transition: surface.style.transition,
    scrollBehavior: stage.style.scrollBehavior,
    overflow: stage.style.overflow,
    tabIndex: stage.getAttribute('tabindex'),
  };

  const controls = document.createElement('div');
  controls.className = 'stage-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Panel view');
  const fit = button(document, 'Fit', 'Fit panel');
  const wire = button(document, 'Wire', 'Wire view');
  const zoomOut = button(document, '−', 'Zoom out');
  const zoomIn = button(document, '+', 'Zoom in');
  const panLeft = button(document, '←', 'Pan view left');
  const panRight = button(document, '→', 'Pan view right');
  const panUp = button(document, '↑', 'Pan view up');
  const panDown = button(document, '↓', 'Pan view down');
  controls.append(fit, wire, zoomOut, zoomIn, panLeft, panRight, panUp, panDown);

  stage.style.overflow = 'hidden';
  stage.style.scrollBehavior = 'auto';
  surface.style.transformOrigin = '50% 50%';
  surface.style.transition = 'none';
  if (stage.getAttribute('tabindex') === null) stage.tabIndex = 0;

  function baseSurfaceSize(): RectSize | null {
    const rect = surface.getBoundingClientRect();
    const width = rect.width / appliedScale;
    const height = rect.height / appliedScale;
    if (!measurable(width) || !measurable(height)) return null;
    return { width, height };
  }

  function wireMinimumScale(): number | null {
    let smallest = Number.POSITIVE_INFINITY;
    for (const hole of holes) {
      const rect = hole.getBoundingClientRect();
      smallest = Math.min(smallest, rect.width / appliedScale, rect.height / appliedScale);
    }
    if (!measurable(smallest)) return null;
    const required = Math.max(minScale, MIN_HOLE_PX / smallest);
    if (required > maxScale) {
      throw new Error('stage controls: maxScale cannot provide 24px hole targets');
    }
    return required;
  }

  function minimumForView(): number | null {
    return view === 'wire' ? wireMinimumScale() : minScale;
  }

  function containPan(): void {
    const stageRect = stage.getBoundingClientRect();
    const base = baseSurfaceSize();
    if (base === null) return;
    const limitX = Math.max(0, (base.width * scale - stageRect.width) / 2);
    const limitY = Math.max(0, (base.height * scale - stageRect.height) / 2);
    panX = clamp(panX, -limitX, limitX);
    panY = clamp(panY, -limitY, limitY);
  }

  function snapshot(): StageState {
    return Object.freeze({
      view,
      scale: clean(scale),
      panX: clean(panX),
      panY: clean(panY),
      transform: transform(scale, panX, panY),
    });
  }

  function render(): void {
    containPan();
    const current = snapshot();
    surface.style.transform = current.transform;
    appliedScale = scale;
    fit.setAttribute('aria-pressed', String(view === 'fit'));
    wire.setAttribute('aria-pressed', String(view === 'wire'));
    options.onChange?.(current);
  }

  function setView(next: StageView): void {
    if (disposed) return;
    const nextScale = next === 'fit' ? minScale : wireMinimumScale();
    view = next;
    panX = 0;
    panY = 0;
    if (nextScale !== null) scale = nextScale;
    render();
  }

  function zoomBy(factor: number): void {
    if (disposed) return;
    finitePositive(factor, 'zoom factor');
    const minimum = (view === 'fit' ? wireMinimumScale() : minimumForView()) ?? minScale;
    view = 'wire';
    scale = clamp(scale * factor, minimum, maxScale);
    render();
  }

  function panBy(dx: number, dy: number): void {
    if (disposed) return;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('stage controls: invalid pan');
    if (view === 'fit') {
      const wireScale = wireMinimumScale();
      view = 'wire';
      if (wireScale !== null) scale = wireScale;
    }
    panX += dx;
    panY += dy;
    render();
  }

  function refresh(): void {
    if (disposed) return;
    const minimum = minimumForView();
    if (minimum === null) return;
    scale = clamp(scale, minimum, maxScale);
    render();
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.deltaY === 0) return;
    zoomBy(event.deltaY < 0 ? zoomStep : 1 / zoomStep);
  }

  function editableTarget(target: EventTarget | null): boolean {
    if (target === null || typeof (target as HTMLElement).tagName !== 'string') return false;
    const element = target as HTMLElement;
    return element.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (editableTarget(event.target)) return;
    // Leave browser and OS shortcuts (Alt+Arrow, Ctrl/Cmd+W, Ctrl/Cmd+0) alone; Shift still reaches '+'/'_'.
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    let handled = true;
    switch (event.key) {
      case '+': case '=': zoomBy(zoomStep); break;
      case '-': case '_': zoomBy(1 / zoomStep); break;
      case 'ArrowLeft': panBy(panStep, 0); break;
      case 'ArrowRight': panBy(-panStep, 0); break;
      case 'ArrowUp': panBy(0, panStep); break;
      case 'ArrowDown': panBy(0, -panStep); break;
      case '0': case 'Home': setView('fit'); break;
      case 'w': case 'W': setView('wire'); break;
      default: handled = false;
    }
    if (handled) event.preventDefault();
  }

  const listeners: (() => void)[] = [];
  function listen(target: EventTarget, type: string, listener: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, listener, options);
    listeners.push(() => target.removeEventListener(type, listener, options));
  }
  listen(fit, 'click', () => setView('fit'));
  listen(wire, 'click', () => setView('wire'));
  listen(zoomOut, 'click', () => zoomBy(1 / zoomStep));
  listen(zoomIn, 'click', () => zoomBy(zoomStep));
  listen(panLeft, 'click', () => panBy(panStep, 0));
  listen(panRight, 'click', () => panBy(-panStep, 0));
  listen(panUp, 'click', () => panBy(0, panStep));
  listen(panDown, 'click', () => panBy(0, -panStep));
  listen(stage, 'wheel', onWheel as EventListener, { passive: false });
  listen(stage, 'keydown', onKeydown as EventListener);

  const resizeObserverFactory = options.resizeObserver ?? (
    typeof ResizeObserver === 'undefined'
      ? undefined
      : (callback: () => void) => new ResizeObserver(callback)
  );
  const resizeObserver = resizeObserverFactory?.(refresh);
  resizeObserver?.observe(stage);

  render();

  return {
    controls,
    get state(): StageState { return snapshot(); },
    setView,
    zoomBy,
    panBy,
    refresh,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const remove of listeners.splice(0)) remove();
      resizeObserver?.disconnect();
      surface.style.transform = prior.transform;
      surface.style.transformOrigin = prior.transformOrigin;
      surface.style.transition = prior.transition;
      stage.style.scrollBehavior = prior.scrollBehavior;
      stage.style.overflow = prior.overflow;
      if (prior.tabIndex === null) stage.removeAttribute('tabindex');
      else stage.setAttribute('tabindex', prior.tabIndex);
    },
  };
}

function endpointCopy(endpoint: PickerEndpoint): PickerEndpoint {
  if (!Number.isInteger(endpoint.cordId) || endpoint.cordId < 0) {
    throw new Error('terminal picker: invalid cord id');
  }
  return Object.freeze({ cordId: endpoint.cordId, side: endpoint.side });
}

function pickerButton(document: Document, text: string): HTMLButtonElement {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = text;
  return node;
}

/** Build a presentation-only picker for one already-selected cord endpoint. */
export function createTerminalPicker(
  document: Document,
  selectedEndpoint: PickerEndpoint,
  terminals: readonly PickerTerminal[],
  onResult: (result: PickerResult) => void,
): TerminalPicker {
  const endpoint = endpointCopy(selectedEndpoint);
  if (endpoint.side !== 'a' && endpoint.side !== 'b') throw new Error('terminal picker: invalid cord side');
  const terminalIds = new Set<string>();
  const holeIds = new Set<string>();
  for (const terminal of terminals) {
    if (terminal.id.length === 0 || terminalIds.has(terminal.id)) {
      throw new Error('terminal picker: duplicate or empty terminal id');
    }
    terminalIds.add(terminal.id);
    for (const hole of terminal.holes) {
      if (hole.length === 0 || holeIds.has(hole)) throw new Error('terminal picker: duplicate or empty hole id');
      holeIds.add(hole);
    }
  }

  const root = document.createElement('section');
  root.className = 'terminal-picker';
  root.setAttribute('aria-label', 'Choose Cord ' + endpoint.cordId + ' end ' + endpoint.side.toUpperCase());
  root.style.display = 'grid';
  root.style.gap = '0.5rem';
  root.style.width = '100%';
  root.style.maxWidth = '24rem';
  root.style.minWidth = '0';
  root.style.maxHeight = 'min(70dvh, 32rem)';
  root.style.overflow = 'auto';

  const searchLabel = document.createElement('label');
  searchLabel.textContent = 'Find terminal or hole';
  const search = document.createElement('input');
  search.type = 'search';
  search.setAttribute('aria-label', 'Find terminal or hole');
  searchLabel.append(search);
  const actions = document.createElement('div');
  actions.className = 'terminal-picker-actions';
  const free = pickerButton(document, 'Free');
  const cancel = pickerButton(document, 'Cancel');
  actions.append(free, cancel);
  const list = document.createElement('div');
  list.className = 'terminal-picker-list';
  root.append(searchLabel, actions, list);

  const listeners: (() => void)[] = [];
  const releaseTouches: ((forceEmit: boolean) => void)[] = [];
  let disposed = false;
  function listen(target: EventTarget, type: string, listener: EventListener): void {
    target.addEventListener(type, listener);
    listeners.push(() => target.removeEventListener(type, listener));
  }
  function emit(result: PickerResult): void {
    if (!disposed) onResult(Object.freeze(result));
  }

  const rows: { readonly terminal: PickerTerminal; readonly row: HTMLElement }[] = [];
  for (const terminal of terminals) {
    const row = document.createElement('section');
    row.className = 'terminal-picker-row';
    row.dataset.terminal = terminal.id;
    const heading = document.createElement('strong');
    heading.textContent = terminal.id;
    const choices = document.createElement('div');
    choices.className = 'terminal-picker-choices';
    for (const hole of terminal.holes) {
      const choose = pickerButton(document, hole);
      choose.dataset.hole = hole;
      listen(choose, 'click', () => {
        for (const release of releaseTouches) release(false);
        emit({ k: 'hole', endpoint, hole });
      });
      choices.append(choose);
    }
    const touch = pickerButton(document, 'Touch ' + terminal.id);
    touch.dataset.touch = terminal.id;
    touch.setAttribute('aria-pressed', 'false');
    let active = false;
    let owner: number | null = null;
    function setTouch(next: boolean, forceEmit = false): void {
      if (!next) owner = null;
      if (active === next || (disposed && next)) return;
      active = next;
      touch.setAttribute('aria-pressed', String(active));
      const result = Object.freeze({ k: 'touch' as const, endpoint, terminal: terminal.id, active });
      if (forceEmit) onResult(result);
      else emit(result);
    }
    releaseTouches.push((forceEmit) => setTouch(false, forceEmit));
    listen(touch, 'pointerdown', ((event: PointerEvent) => {
      event.preventDefault();
      if (active && owner !== null && owner !== event.pointerId) return;
      owner = event.pointerId;
      touch.setPointerCapture?.(event.pointerId);
      setTouch(true);
    }) as EventListener);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      listen(touch, type, ((event: PointerEvent) => {
        if (owner !== null && owner !== event.pointerId) return;
        setTouch(false);
      }) as EventListener);
    }
    listen(touch, 'keydown', ((event: KeyboardEvent) => {
      if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
        event.preventDefault();
        setTouch(true);
      }
    }) as EventListener);
    listen(touch, 'keyup', ((event: KeyboardEvent) => {
      if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        setTouch(false);
      }
    }) as EventListener);
    listen(touch, 'blur', () => setTouch(false));
    row.append(heading, choices, touch);
    list.append(row);
    rows.push({ terminal, row });
  }

  listen(search, 'input', () => {
    const query = search.value.trim().toLowerCase();
    for (const { terminal, row } of rows) {
      row.hidden = query.length > 0 && !terminal.id.toLowerCase().includes(query) &&
        !terminal.holes.some((hole) => hole.toLowerCase().includes(query));
    }
  });
  function releaseAllTouches(forceEmit = false): void {
    for (const release of releaseTouches) release(forceEmit);
  }
  function cancelPicker(): void {
    releaseAllTouches();
    emit({ k: 'cancel', endpoint });
  }
  listen(free, 'click', () => {
    releaseAllTouches();
    emit({ k: 'free', endpoint });
  });
  listen(cancel, 'click', cancelPicker);
  listen(root, 'keydown', ((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    cancelPicker();
  }) as EventListener);

  return {
    element: root,
    search,
    focus(): void { if (!disposed) search.focus(); },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      releaseAllTouches(true);
      for (const remove of listeners.splice(0)) remove();
    },
  };
}
