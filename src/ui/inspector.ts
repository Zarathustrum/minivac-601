import type {
  CmdResult,
  Command,
  CordEnd,
  HoleId,
  Machine,
  Note,
  Sect,
  State,
  TerminalId,
} from '../core/contract.ts';
import type { AudioRouter } from './audio-router.ts';
import type { HelpCreditsView } from './help-credits.ts';
import { createFrameLoop, startFrameLoop, type Frame, type FrameTarget } from './loop.ts';
import { applyLampPresentation } from './lamp-presentation.ts';
import { bindKeyboardHold, createDrawerController } from './interaction-accessibility.ts';
import {
  controlAccessibleName,
  createControlLabelAdapter,
  type ControlLabels,
} from './control-labels.ts';
import {
  createCordController,
  type CordController,
  type EndpointRef,
  type ReplacementResult,
} from './cord-model.ts';
import {
  createCordView,
  type CordResult,
  type CordView,
} from './cord-view.ts';
import { createPeriodPanel, type PeriodPanelControls } from './panel-view.ts';
import { PANEL_TERMINALS } from './panel-layout.ts';
import {
  createStageController,
  createTerminalPicker,
  type PickerResult,
  type StageController,
  type TerminalPicker,
} from './stage-controls.ts';
import { createTraceView, type TraceView } from './trace-view.ts';

export interface InspectorTerminal {
  readonly id: string;
  readonly holes: number;
}

export interface InspectorNetlist {
  readonly schema: string;
  readonly terminals: readonly InspectorTerminal[];
}

export interface InspectorOptions {
  readonly experience?: HTMLElement;
  readonly controlLabels?: ControlLabels;
  readonly audio?: Pick<AudioRouter, 'control' | 'sample' | 'frame' | 'reset'>;
  readonly help?: Pick<HelpCreditsView, 'control' | 'dialog'>;
  readonly startWithFreeCord?: boolean;
}

export interface LampProjection {
  readonly cls: 'off' | 'dim' | 'on';
  readonly ua: number;
  readonly milli: number;
  readonly label: string;
}

export interface RelayProjection {
  readonly travel: number;
  readonly held: boolean;
  readonly band: 'below' | 'hold' | 'above';
  readonly label: string;
}

export interface InspectorPanelProjection {
  readonly powerPressed: boolean;
  readonly breakerCanReset: boolean;
  readonly powerJewelLit: boolean;
  readonly outLamps: readonly LampProjection[];
  readonly relayLamps: readonly LampProjection[];
  readonly relays: readonly RelayProjection[];
  readonly buttonsPressed: readonly boolean[];
  readonly switchesRight: readonly boolean[];
  readonly switchTravel: readonly number[];
  readonly dialUdeg: number;
  readonly dialLabel: string;
}

/** Read the section identity supplied by PanelView; visual or DOM order is never consulted. */
export function panelSection(value: string | undefined): Sect {
  const section = Number(value);
  if (!Number.isInteger(section) || section < 1 || section > 6) {
    throw new Error('inspector: invalid panel control section ' + JSON.stringify(value));
  }
  return section as Sect;
}

export function powerToggleCommand(current: boolean): Command {
  return { k: 'power', on: !current };
}

export function breakerResetCommand(): Command {
  return { k: 'breaker', reset: true };
}

export function buttonMomentaryCommand(n: Sect, pressed: boolean): Command {
  return { k: 'button', n, target: pressed ? 1000 : 0 };
}

export function switchToggleCommand(n: Sect, travel: number): Command {
  return { k: 'switch', n, target: travel < 500 ? 1000 : 0 };
}

export function relayGrabCommand(n: Sect, target: number): Command {
  return { k: 'relayGrab', n, target };
}

export function relayReleaseCommand(n: Sect): Command {
  return { k: 'relayRelease', n };
}

export function dialGrabCommand(targetUdeg: number): Command {
  return { k: 'dialGrab', targetUdeg };
}

export function dialReleaseCommand(): Command {
  return { k: 'dialRelease' };
}

export interface PanelCommandBindings {
  readonly buttonActive: ReadonlySet<Sect>;
  readonly buttonKeyboardActive: ReadonlySet<Sect>;
  readonly buttonLatched: ReadonlySet<Sect>;
  readonly relayActive: ReadonlySet<Sect>;
  readonly relayKeyboardActive: ReadonlySet<Sect>;
  dialIsActive(): boolean;
  dispose(): void;
}

/** Bind physical panel identities to their exact core commands. */
export function bindPanelCommandControls(
  view: Window,
  controls: PeriodPanelControls,
  snapshot: () => State,
  issue: (command: Command) => boolean,
): PanelCommandBindings {
  const relayActive = new Set<Sect>();
  const buttonActive = new Set<Sect>();
  const buttonKeyboardActive = new Set<Sect>();
  /** Shift-click latches: held until a click on that button or Escape, not by focus or power. */
  const buttonLatched = new Set<Sect>();
  const relayKeyboardActive = new Set<Sect>();
  const keyboardDisposers: (() => void)[] = [];
  /** Which pointer holds which control, so one finger lifting cannot release another finger's control. */
  const buttonPointers = new Map<number, Sect>();
  const relayPointers = new Map<number, Sect>();
  const seenPointers = new Set<number>();
  let dialPointerId: number | null = null;
  let dialActive = false;

  const pointerIdOf = (event: Event): number => (event as PointerEvent).pointerId ?? 0;
  const holdsSection = (pointers: Map<number, Sect>, n: Sect): boolean => {
    for (const held of pointers.values()) if (held === n) return true;
    return false;
  };
  const buttonHeld = (n: Sect): boolean =>
    buttonActive.has(n) || buttonKeyboardActive.has(n) || buttonLatched.has(n);
  /** Issue a press or release only when pointer, keyboard and latch together change the held state. */
  const updateButton = (n: Sect, change: () => void): void => {
    const was = buttonHeld(n);
    change();
    if (buttonHeld(n) !== was) issue(buttonMomentaryCommand(n, !was));
  };
  const toggleLatch = (n: Sect): void => {
    updateButton(n, () => { if (!buttonLatched.delete(n)) buttonLatched.add(n); });
  };
  function releaseLatches(): void {
    for (const n of [...buttonLatched]) updateButton(n, () => buttonLatched.delete(n));
  }

  const onPower = (): void => { issue(powerToggleCommand(snapshot().power)); };
  const onBreaker = (): void => { issue(breakerResetCommand()); };
  controls.power.addEventListener('click', onPower);
  controls.breaker.addEventListener('click', onBreaker);

  const pointerPresses = new Map<HTMLButtonElement, (event: Event) => void>();
  for (const button of controls.pushbuttons) {
    const n = panelSection(button.dataset.section);
    const onPointerDown = (event: Event): void => {
      if ((event as PointerEvent).button > 0) return;
      // A latch toggle records no pointer, so its pointerup cannot release the button.
      if ((event as PointerEvent).shiftKey || buttonLatched.has(n)) {
        toggleLatch(n);
        return;
      }
      buttonPointers.set(pointerIdOf(event), n);
      updateButton(n, () => buttonActive.add(n));
    };
    pointerPresses.set(button, onPointerDown);
    button.addEventListener('pointerdown', onPointerDown);
    keyboardDisposers.push(bindKeyboardHold(button, {
      keys: [' ', 'Enter'],
      preventDefault: true,
      onPress: () => { updateButton(n, () => buttonKeyboardActive.add(n)); },
      onRelease: () => { updateButton(n, () => buttonKeyboardActive.delete(n)); },
      onShiftToggle: () => { toggleLatch(n); },
    }));
  }

  const switchClicks = new Map<HTMLButtonElement, () => void>();
  for (const slide of controls.switches) {
    const n = panelSection(slide.dataset.section);
    const onClick = (): void => {
      issue(switchToggleCommand(n, snapshot().switches[n - 1]?.travel ?? 0));
    };
    switchClicks.set(slide, onClick);
    slide.addEventListener('click', onClick);
  }

  const relayPointerPresses = new Map<HTMLInputElement, (event: Event) => void>();
  const relayInputs = new Map<HTMLInputElement, () => void>();
  for (const relay of controls.relays) {
    const n = panelSection(relay.dataset.section);
    const onPointerDown = (event: Event): void => {
      if ((event as PointerEvent).button > 0) return;
      relayPointers.set(pointerIdOf(event), n);
      if (relayActive.has(n)) return;
      relayActive.add(n);
      issue(relayGrabCommand(n, Number(relay.value)));
    };
    const onInput = (): void => {
      if (relayActive.has(n) || relayKeyboardActive.has(n)) {
        issue(relayGrabCommand(n, Number(relay.value)));
      }
    };
    relayPointerPresses.set(relay, onPointerDown);
    relayInputs.set(relay, onInput);
    relay.addEventListener('pointerdown', onPointerDown);
    relay.addEventListener('input', onInput);
    keyboardDisposers.push(bindKeyboardHold(relay, {
      keys: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'],
      preventDefault: false,
      onPress: () => {
        relayKeyboardActive.add(n);
        if (!relayActive.has(n)) issue(relayGrabCommand(n, Number(relay.value)));
      },
      onRelease: () => {
        relayKeyboardActive.delete(n);
        if (!relayActive.has(n)) issue(relayReleaseCommand(n));
      },
    }));
  }

  const onDialPointerDown = (event: PointerEvent): void => {
    if (event.button > 0) return;
    if (dialActive) return;
    dialActive = true;
    dialPointerId = pointerIdOf(event);
    controls.dial.setPointerCapture(event.pointerId);
    issue(dialGrabCommand(dialTargetUdeg(
      event.clientX,
      event.clientY,
      controls.dial.getBoundingClientRect(),
    )));
  };
  const onDialPointerMove = (event: PointerEvent): void => {
    if (!dialActive) return;
    issue(dialGrabCommand(dialTargetUdeg(
      event.clientX,
      event.clientY,
      controls.dial.getBoundingClientRect(),
    )));
  };
  const onDialInput = (): void => {
    if (dialActive) return;
    issue(dialGrabCommand(Number(controls.dial.value)));
    issue(dialReleaseCommand());
  };
  controls.dial.addEventListener('pointerdown', onDialPointerDown);
  controls.dial.addEventListener('pointermove', onDialPointerMove);
  controls.dial.addEventListener('input', onDialInput);

  function releaseDial(): void {
    if (!dialActive) return;
    dialActive = false;
    dialPointerId = null;
    issue(dialReleaseCommand());
  }

  function releaseAll(): void {
    relayPointers.clear();
    for (const n of relayActive) {
      if (!relayKeyboardActive.has(n)) issue(relayReleaseCommand(n));
    }
    relayActive.clear();
    buttonPointers.clear();
    for (const n of [...buttonActive]) updateButton(n, () => buttonActive.delete(n));
    releaseDial();
  }

  const trackPointer = (event: Event): void => { seenPointers.add(pointerIdOf(event)); };

  function releasePointers(event: Event): void {
    const id = pointerIdOf(event);
    // A lift from a pointer we never saw press cannot be attributed, so it clears everything
    // rather than strand held hardware; every tracked pointer releases only what it holds.
    if (!seenPointers.delete(id)) {
      releaseAll();
      return;
    }
    const relay = relayPointers.get(id);
    if (relay !== undefined) {
      relayPointers.delete(id);
      if (!holdsSection(relayPointers, relay)) {
        relayActive.delete(relay);
        if (!relayKeyboardActive.has(relay)) issue(relayReleaseCommand(relay));
      }
    }
    const button = buttonPointers.get(id);
    if (button !== undefined) {
      buttonPointers.delete(id);
      if (!holdsSection(buttonPointers, button)) updateButton(button, () => buttonActive.delete(button));
    }
    if (dialPointerId === id) releaseDial();
  }
  view.addEventListener('pointerdown', trackPointer);
  view.addEventListener('pointerup', releasePointers);
  view.addEventListener('pointercancel', releasePointers);
  // Escape anywhere drops every latch; the focused control's own Escape handles its keyboard hold.
  const onEscape = (event: Event): void => {
    if ((event as KeyboardEvent).key !== 'Escape' || buttonLatched.size === 0) return;
    event.preventDefault();
    releaseLatches();
  };
  view.addEventListener('keydown', onEscape);

  let disposed = false;
  return Object.freeze({
    buttonActive,
    buttonKeyboardActive,
    buttonLatched,
    relayActive,
    relayKeyboardActive,
    dialIsActive: () => dialActive,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      view.removeEventListener('pointerdown', trackPointer);
      view.removeEventListener('pointerup', releasePointers);
      view.removeEventListener('pointercancel', releasePointers);
      view.removeEventListener('keydown', onEscape);
      controls.power.removeEventListener('click', onPower);
      controls.breaker.removeEventListener('click', onBreaker);
      for (const button of controls.pushbuttons) {
        button.removeEventListener('pointerdown', pointerPresses.get(button) as EventListener);
      }
      for (const slide of controls.switches) {
        slide.removeEventListener('click', switchClicks.get(slide) as () => void);
      }
      for (const relay of controls.relays) {
        relay.removeEventListener('pointerdown', relayPointerPresses.get(relay) as EventListener);
        relay.removeEventListener('input', relayInputs.get(relay) as () => void);
      }
      controls.dial.removeEventListener('pointerdown', onDialPointerDown);
      controls.dial.removeEventListener('pointermove', onDialPointerMove);
      controls.dial.removeEventListener('input', onDialInput);
      for (const disposeKeyboard of keyboardDisposers) disposeKeyboard();
      releaseLatches();
    },
  });
}

/** Bind each rendered hole's frozen identity instead of inferring it from DOM order. */
export function bindHoleControls(
  holes: ReadonlyMap<string, HTMLButtonElement>,
  activate: (holeId: string) => void,
): () => void {
  const listeners = new Map<HTMLButtonElement, () => void>();
  for (const [id, button] of holes) {
    const listener = (): void => { activate(id); };
    listeners.set(button, listener);
    button.addEventListener('click', listener);
  }
  return (): void => {
    for (const [button, listener] of listeners) button.removeEventListener('click', listener);
  };
}

/** Preserve every tick sample for trace/audio, then coalesce visual and motor state per frame. */
export function createInspectorFrame(
  machine: FrameTarget,
  trace: Pick<TraceView, 'frame' | 'flush'>,
  audio: Pick<AudioRouter, 'sample' | 'frame'> | undefined,
  render: (state: State) => void,
): Frame {
  return createFrameLoop(
    machine,
    (boundaryTick, observables, events) => {
      trace.frame(boundaryTick, observables, events);
      audio?.sample(events);
    },
    (state) => {
      trace.flush();
      audio?.frame(state);
      render(state);
    },
  );
}

export interface DialBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** Convert a panel pointer to clockwise microdegrees with twelve o'clock as zero. */
export function dialTargetUdeg(clientX: number, clientY: number, bounds: DialBounds): number {
  const dx = clientX - (bounds.left + bounds.width / 2);
  const dy = clientY - (bounds.top + bounds.height / 2);
  const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  return Math.min(359_999_999, Math.round(degrees * 1_000_000));
}

/** Pure projection from the frozen State contract to the panel's visual states. */
export function projectPanelState(state: State): InspectorPanelProjection {
  const lamp = (value: State['outLamps'][number]): LampProjection => Object.freeze({
    cls: value.cls,
    ua: value.ua,
    milli: value.milli,
    label: value.cls + ' · ' + value.ua + ' µA',
  });
  return Object.freeze({
    powerPressed: state.power,
    breakerCanReset: state.breakerTripped,
    powerJewelLit: state.railMv > 0,
    outLamps: Object.freeze(state.outLamps.map(lamp)),
    relayLamps: Object.freeze(state.indLamps.map(lamp)),
    relays: Object.freeze(state.relays.map((relay) => Object.freeze({
      travel: relay.travel,
      held: relay.held,
      band: relay.band,
      label: relay.coilUa + ' µA · ' + relay.band +
        (relay.coilShorted ? ' · shorted' : '') +
        ' · drop ' + relay.dropOutUa + ' / pull ' + relay.pullInUa + ' µA',
    }))),
    buttonsPressed: Object.freeze(state.buttons.map((button) => button.no)),
    switchesRight: Object.freeze(state.switches.map((value) => value.travel === 1000)),
    switchTravel: Object.freeze(state.switches.map((value) => value.travel)),
    dialUdeg: state.dial.udeg,
    dialLabel: state.dial.udeg + ' µdeg · ' +
      (state.dial.contact === null ? 'dead gap' : 'D' + state.dial.contact) +
      (state.dial.held ? ' · held' : ''),
  });
}

export function renderNote(note: Note): string {
  if (note.k === 'lamp-in-coil-path') {
    return "Relay " + note.relay + "'s indicator lamp is in series with its coil and drops " +
      note.lampMv + ' mV.';
  }
  const drops = note.drops.map((drop) => drop.el + ' ' + drop.mv + ' mV').join('; ');
  return 'Relay ' + note.relay + ' needs ' + note.needsUa + ' µA and has ' + note.coilUa +
    ' µA. Largest drops: ' + (drops || 'none') + '.';
}

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function drawerSection(document: Document, title: string): HTMLElement {
  const section = element(document, 'section', 'console-drawer-section');
  section.append(element(document, 'h2', 'panel-heading', title));
  return section;
}

function endpointText(end: CordEnd): string {
  if (end.k === 'hole') return end.hole;
  if (end.k === 'touch') return 'touch:' + end.term;
  return 'free';
}

/** A rising power edge starts its trace epoch at zero on the next command boundary. */
export function commandTraceTick(
  state: Pick<State, 'tick' | 'power'>,
  command: Command,
): number {
  return command.k === 'power' && command.on && !state.power ? 0 : state.tick;
}

/** Mount the period console around an already validated, caller-owned Machine. */
export function mountInspector(
  root: HTMLElement,
  machine: Machine,
  netlist: InspectorNetlist,
  options: InspectorOptions = {},
): () => void {
  const document = root.ownerDocument;
  const view = document.defaultView;
  if (view === null) throw new Error('inspector: document has no window');

  root.replaceChildren();
  root.className = 'console-app';

  const status = element(document, 'output', 'command-status', 'Ready.');
  const drawerToggle = element(document, 'button', 'diagnostics-toggle', 'Library & diagnostics');
  drawerToggle.type = 'button';
  const toolbar = element(document, 'header', 'console-toolbar');
  const titleGroup = element(document, 'div', 'console-toolbar-group');
  titleGroup.append(element(document, 'strong', 'console-toolbar-title', 'MINIVAC 601'));
  const actionGroup = element(document, 'div', 'console-toolbar-group');
  if (options.help !== undefined) actionGroup.append(options.help.control);
  if (options.audio !== undefined) actionGroup.append(options.audio.control);
  actionGroup.append(status, drawerToggle);
  toolbar.append(titleGroup, actionGroup);

  const panel = createPeriodPanel(document, netlist);
  const controlLabels = createControlLabelAdapter(panel.controls);
  controlLabels.update(options.controlLabels ?? {});
  const stage = element(document, 'div', 'console-stage');
  stage.append(panel.surface);

  const cordPanel = drawerSection(document, 'Patch cords');
  cordPanel.classList.add('cord-panel');
  cordPanel.append(element(
    document,
    'p',
    'cord-help',
    'Select end A or B, then click a jack hole. Free ends stay electrically loose.',
  ));
  const addCord = element(document, 'button', 'add-cord', 'Add free cord');
  addCord.type = 'button';
  const cordList = element(document, 'div', 'cord-list');
  const pickerHost = element(document, 'div', 'terminal-picker-host');
  pickerHost.hidden = true;
  cordPanel.append(addCord, pickerHost, cordList);

  const voltagePanel = drawerSection(document, 'Terminal voltages');
  voltagePanel.classList.add('voltage-panel');
  const voltageList = element(document, 'div', 'terminal-voltage-list');
  const voltageRefs: HTMLElement[] = [];
  for (const terminal of netlist.terminals) {
    if (!panel.terminals.has(terminal.id)) {
      throw new Error('inspector: panel view omitted terminal ' + terminal.id);
    }
    const row = element(document, 'div', 'terminal-voltage-row');
    row.dataset.terminal = terminal.id;
    row.append(element(document, 'span', 'terminal-id', terminal.id));
    const voltage = element(document, 'output', 'terminal-voltage', 'floating');
    row.append(voltage);
    voltageList.append(row);
    voltageRefs.push(voltage);
  }
  voltagePanel.append(voltageList);

  const notesPanel = drawerSection(document, 'Notes');
  notesPanel.classList.add('notes-panel');
  const notes = element(document, 'ul', 'notes-list');
  notesPanel.append(notes);

  const tracePanel = drawerSection(document, 'Live trace');
  tracePanel.classList.add('trace-panel');
  const traceText = element(document, 'pre', 'trace-text');
  tracePanel.append(traceText);

  const drawer = element(document, 'aside', 'console-drawer');
  drawer.id = 'diagnostics-drawer';
  drawer.setAttribute('aria-label', 'Demo library and diagnostics');
  const drawerClose = element(document, 'button', 'drawer-close', 'Close');
  drawerClose.type = 'button';
  drawer.append(drawerClose);
  if (options.experience !== undefined) drawer.append(options.experience);
  drawer.append(cordPanel, voltagePanel, notesPanel, tracePanel);
  const workspace = element(document, 'main', 'console-workspace');
  workspace.append(stage, drawer);
  root.append(toolbar, workspace);
  if (options.help !== undefined) root.append(options.help.dialog);

  let lastState = machine.snapshot();
  const trace = createTraceView(traceText, machine.observables());
  let selected: EndpointRef | null = null;
  let cordView: CordView | null = null;
  let terminalPicker: TerminalPicker | null = null;
  let pickerEndpoint: EndpointRef | null = null;
  let pickerFromCordView = false;
  let touchActive = false;
  let stageController: StageController | null = null;
  const drawerController = createDrawerController(drawerToggle, drawer, drawerClose);

  function applyCommand(command: Command): CmdResult {
    const acceptedState = machine.snapshot();
    const result = machine.apply(command);
    if (!result.ok) {
      status.textContent = 'Rejected: ' + result.why;
      return result;
    }
    trace.command(commandTraceTick(acceptedState, command), command);
    status.textContent = 'Accepted: ' + command.k;
    return result;
  }

  function issue(command: Command): boolean {
    return applyCommand(command).ok;
  }

  const cordController: CordController = createCordController(lastState.cords, applyCommand);

  function updateCordView(): void {
    const cords = cordController.snapshot();
    cordView?.update(
      cords,
      cordController.traySlots().map((slot) => slot.endpoint),
    );
  }

  function addFreeCord(): void {
    const result = cordController.add();
    if (result.k === 'full') {
      status.textContent = 'All 256 cord ids are in use.';
      return;
    }
    if (result.k === 'rejected') return;
    selected = { cord: result.cord, side: 'a' };
    renderCords();
    openTerminalPicker(selected, false);
  }

  function reportReplacement(result: ReplacementResult | null): void {
    if (result === null || result.k === 'noop') return;
    if (result.k === 'committed') {
      status.textContent = 'Cord endpoint connected.';
      return;
    }
    if (result.k === 'rollback-rejected') {
      status.textContent = 'Cord rollback rejected: ' + result.rollbackWhy + '.';
      return;
    }
    status.textContent = 'Cord change rejected: ' + result.why + '.';
  }

  function replaceEnd(endpoint: EndpointRef, end: CordEnd): void {
    closeTerminalPicker();
    cordController.beginDrag(endpoint);
    const target = end.k === 'hole' ? { k: 'hole' as const, hole: end.hole } : { k: 'tray' as const };
    const result = cordController.drop(target);
    if (result.resolution.k === 'cancelled' && result.resolution.reason === 'occupied') {
      status.textContent = target.k === 'hole' ? target.hole + ' is occupied.' : 'Cord change cancelled.';
    }
    reportReplacement(result.replacement);
    renderCords();
  }

  function acceptCordResult(result: CordResult): void {
    const endpoint = { cord: result.cord, side: result.side };
    selected = endpoint;
    pickerFromCordView = false;
    closeTerminalPicker();
    if (result.k === 'hole') replaceEnd(endpoint, { k: 'hole', hole: result.hole });
    else if (result.k === 'free') replaceEnd(endpoint, { k: 'free' });
    else {
      status.textContent = result.k === 'occupied'
        ? result.hole + ' is occupied.'
        : result.k === 'outside' ? 'Cord drop cancelled.' : 'Cord move cancelled.';
      renderCords();
    }
  }

  function renderCords(syncView = true): void {
    cordList.replaceChildren();
    const occupied = new Set<string>();
    for (const cord of cordController.snapshot()) {
      if (cord.a.k === 'hole') occupied.add(cord.a.hole);
      if (cord.b.k === 'hole') occupied.add(cord.b.hole);
      const row = element(document, 'div', 'cord-row');
      row.append(element(document, 'strong', '', 'Cord ' + cord.id));
      for (const side of ['a', 'b'] as const) {
        const end = side === 'a' ? cord.a : cord.b;
        const choose = element(document, 'button', 'cord-end', side.toUpperCase() + ': ' + endpointText(end));
        choose.type = 'button';
        choose.dataset.cord = String(cord.id);
        choose.dataset.side = side;
        if (selected?.cord === cord.id && selected.side === side) choose.classList.add('selected');
        choose.addEventListener('click', () => {
          selected = { cord: cord.id, side };
          renderCords();
          openTerminalPicker(selected, false);
        });
        const free = element(document, 'button', 'free-end', 'Free');
        free.type = 'button';
        free.addEventListener('click', () => replaceEnd({ cord: cord.id, side }, { k: 'free' }));
        row.append(choose, free);
      }
      const remove = element(document, 'button', 'remove-cord', 'Remove');
      remove.type = 'button';
      remove.addEventListener('click', () => {
        const result = cordController.remove(cord.id);
        if (result.k !== 'removed') return;
        if (pickerEndpoint?.cord === cord.id) {
          if (pickerFromCordView) cordView?.cancel();
          pickerFromCordView = false;
          closeTerminalPicker();
        }
        if (selected?.cord === cord.id) selected = null;
        renderCords();
      });
      row.append(remove);
      cordList.append(row);
    }
    for (const [id, button] of panel.holes) button.classList.toggle('occupied', occupied.has(id));
    if (syncView) updateCordView();
  }

  const pickerTerminals = netlist.terminals.map((terminal) => {
    const placement = PANEL_TERMINALS.find((candidate) => candidate.id === terminal.id);
    if (placement === undefined) throw new Error('inspector: picker omitted terminal ' + terminal.id);
    return Object.freeze({
      id: terminal.id,
      holes: Object.freeze(placement.holes.map((hole) => hole.id)),
    });
  });

  function closeTerminalPicker(): void {
    const current = terminalPicker;
    terminalPicker = null;
    pickerEndpoint = null;
    if (current !== null) current.dispose();
    pickerHost.replaceChildren();
    pickerHost.hidden = true;
  }

  /** The picker takes focus when it opens, so hand it back to the cord end that opened it. */
  function focusCordEnd(endpoint: EndpointRef): void {
    const selector = '.cord-end[data-cord="' + endpoint.cord + '"][data-side="' + endpoint.side + '"]';
    cordList.querySelector<HTMLButtonElement>(selector)?.focus();
  }

  function acceptPickerResult(result: PickerResult): void {
    const endpoint = { cord: result.endpoint.cordId, side: result.endpoint.side };
    if (result.k === 'touch') {
      if (result.active) {
        const started = cordController.beginTouch(endpoint, result.terminal as TerminalId);
        if (started.k === 'started') {
          touchActive = true;
          status.textContent = 'Touching terminal ' + result.terminal + '.';
          renderCords(false);
        } else if (started.k === 'not-free') {
          status.textContent = 'Touch requires a free cord end.';
        } else reportReplacement(started.replacement);
      } else {
        if (!touchActive) return;
        touchActive = false;
        const released = cordController.releaseTouch();
        reportReplacement(released);
        renderCords();
      }
      return;
    }
    if (result.k === 'cancel') {
      const fromCordView = pickerFromCordView;
      if (fromCordView) cordView?.cancel();
      else status.textContent = 'Cord move cancelled.';
      pickerFromCordView = false;
      closeTerminalPicker();
      if (!fromCordView) focusCordEnd(endpoint);
      return;
    }
    if (pickerFromCordView) {
      cordView?.keyboardTarget(result.k === 'free'
        ? { k: 'free' }
        : { k: 'hole', hole: result.hole as HoleId });
    } else {
      replaceEnd(endpoint, result.k === 'free'
        ? { k: 'free' }
        : { k: 'hole', hole: result.hole as HoleId });
      closeTerminalPicker();
      focusCordEnd(endpoint);
    }
  }

  function openTerminalPicker(endpoint: EndpointRef, fromCordView: boolean): void {
    closeTerminalPicker();
    drawerController.open(false);
    pickerFromCordView = fromCordView;
    pickerEndpoint = endpoint;
    terminalPicker = createTerminalPicker(
      document,
      { cordId: endpoint.cord, side: endpoint.side },
      pickerTerminals,
      acceptPickerResult,
    );
    pickerHost.hidden = false;
    pickerHost.append(terminalPicker.element);
    terminalPicker.focus();
  }

  cordView = createCordView({
    stage,
    surface: panel.surface,
    holes: panel.holes,
    cords: cordController.snapshot(),
    freeSlots: cordController.traySlots().map((slot) => slot.endpoint),
    callbacks: {
      onResult: acceptCordResult,
      onKeyboardPickup: (endpoint) => {
        selected = endpoint;
        status.textContent = 'Choose a terminal or Free for cord ' + endpoint.cord + endpoint.side.toUpperCase() + '.';
        renderCords(false);
        openTerminalPicker(endpoint, true);
      },
    },
  });

  const disposeHoleControls = bindHoleControls(panel.holes, (id) => {
    if (selected === null) {
      status.textContent = 'Select a cord end first.';
      return;
    }
    if (pickerFromCordView) {
      cordView?.keyboardTarget({ k: 'hole', hole: id as HoleId });
      return;
    }
    replaceEnd(selected, { k: 'hole', hole: id as HoleId });
  });

  addCord.addEventListener('click', addFreeCord);
  stageController = createStageController({
    stage,
    surface: panel.surface,
    holes: [...panel.holes.values()],
    onChange: () => cordView?.repaint(),
  });
  stage.append(stageController.controls);
  const panelCommands = bindPanelCommandControls(view, panel.controls, () => machine.snapshot(), issue);

  function renderState(state: State): void {
    lastState = state;
    const projection = projectPanelState(state);
    panel.controls.power.setAttribute('aria-pressed', String(projection.powerPressed));
    panel.controls.breaker.disabled = !projection.breakerCanReset;
    panel.powerJewel.classList.toggle('is-lit', projection.powerJewelLit);
    panel.powerJewel.setAttribute('aria-label', 'Power indicator: ' + (projection.powerJewelLit ? 'lit' : 'dark'));

    for (const lamp of panel.outLamps) {
      const n = panelSection(lamp.dataset.component?.replace('out-lamp-', ''));
      applyLampPresentation(lamp, 'Output lamp ' + n, projection.outLamps[n - 1]!);
    }
    for (const lamp of panel.relayLamps) {
      const n = panelSection(lamp.dataset.component?.replace('relay-lamp-', ''));
      applyLampPresentation(lamp, 'Relay ' + n + ' indicator lamp', projection.relayLamps[n - 1]!);
    }
    for (const relay of panel.controls.relays) {
      const n = panelSection(relay.dataset.section);
      const value = projection.relays[n - 1]!;
      if (!panelCommands.relayActive.has(n) && !panelCommands.relayKeyboardActive.has(n)) {
        relay.value = String(value.travel);
      }
      relay.dataset.band = value.band;
      relay.title = controlAccessibleName(
        relay.dataset.control ?? '',
        relay.dataset.demoLabel,
      ) + ' · ' + value.label;
      relay.setAttribute('aria-valuetext', value.label);
      relay.parentElement?.style.setProperty(
        '--relay-shift',
        (value.travel * 1.6 / 1000 - 0.8) + 'cqi',
      );
      if (relay.parentElement !== null) relay.parentElement.dataset.band = value.band;
    }
    for (const button of panel.controls.pushbuttons) {
      const n = panelSection(button.dataset.section);
      button.classList.toggle('down', projection.buttonsPressed[n - 1]!);
      button.setAttribute('aria-pressed', String(projection.buttonsPressed[n - 1]!));
    }
    for (const slide of panel.controls.switches) {
      const n = panelSection(slide.dataset.section);
      slide.classList.toggle('right', projection.switchesRight[n - 1]!);
      slide.setAttribute('aria-pressed', String(projection.switchesRight[n - 1]!));
      slide.dataset.travel = String(projection.switchTravel[n - 1]!);
    }
    if (!panelCommands.dialIsActive()) panel.controls.dial.value = String(projection.dialUdeg);
    panel.dialPointer.style.transform = 'rotate(' + projection.dialUdeg / 1_000_000 + 'deg)';
    panel.controls.dial.setAttribute('aria-valuetext', projection.dialLabel);
    panel.controls.dial.title = controlAccessibleName(
      panel.controls.dial.dataset.control ?? '',
      panel.controls.dial.dataset.demoLabel,
    ) + ' · ' + projection.dialLabel;

    for (let index = 0; index < voltageRefs.length; index++) {
      const mv = state.terminalMv[index];
      voltageRefs[index]!.textContent = mv === null ? 'floating' : mv + ' mV';
    }
    notes.replaceChildren();
    if (state.notes.length === 0) notes.append(element(document, 'li', 'empty-note', 'No steady-state notes.'));
    else for (const note of state.notes) notes.append(element(document, 'li', note.k, renderNote(note)));

    status.dataset.portable = String(!state.flags.nonPortable);
    status.title = 'tick ' + state.tick + ' · rail ' + state.railMv + ' mV · supply ' + state.supplyUa + ' µA';
  }

  if (cordController.snapshot().length === 0 && options.startWithFreeCord !== false) addFreeCord();
  else renderCords();
  renderState(lastState);
  options.audio?.frame(lastState);
  const frame = createInspectorFrame(machine, trace, options.audio, renderState);
  const stopFrameLoop = startFrameLoop(frame);
  let disposed = false;
  return (): void => {
    if (disposed) return;
    disposed = true;
    stopFrameLoop();
    options.audio?.reset();
    panelCommands.dispose();
    disposeHoleControls();
    drawerController.dispose();
    closeTerminalPicker();
    controlLabels.dispose();
    stageController?.dispose();
    cordView?.dispose();
    root.replaceChildren();
    root.className = '';
  };
}
