/**
 * The portable observable vector, trace formatter and per-mover chatter monitor.
 *
 * Architecture §9.2 and §13.4.7 freeze every name, integer encoding and spelling here. The
 * formatter allocates strings by design; `writeObservables` and ordinary chatter ticks overwrite
 * caller-owned storage. Chatter may grow one retained primitive page on a transition.
 *
 * DOM-free, filesystem-free, no clock, no locale-sensitive numeric formatting.
 */
import type { ChatterDev, Command, CordEnd, TraceAnomaly } from './contract.ts';
import type { Profile } from './profile.ts';

export const OBSERVABLE_COUNT = 33;
export const MOVER_OBSERVABLE_START = 2;
export const CHATTER_DEVICE_COUNT = 19;
const INT32_MAX = 2147483647;
const CHATTER_PAGE_SIZE = 64;

export interface ObservableDef {
  readonly name: string;
  /** The integer represented by `values[0]`; dial alone starts at -1 for `gap`. */
  readonly minValue: number;
  readonly values: readonly string[];
}

const POWER_VALUES = Object.freeze(['off', 'on']);
const BREAKER_VALUES = Object.freeze(['ok', 'tripped']);
const MOVER_VALUES = Object.freeze(['nc', 'mid', 'no']);
const DIAL_VALUES = Object.freeze([
  'gap', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7',
  'c8', 'c9', 'c10', 'c11', 'c12', 'c13', 'c14', 'c15',
]);
const LAMP_VALUES = Object.freeze(['off', 'dim', 'on']);

function observable(name: string, minValue: number, values: readonly string[]): ObservableDef {
  return Object.freeze({ name, minValue, values });
}

/** Frozen golden order. A later contract version may append, never insert. */
export const OBSERVABLES: readonly ObservableDef[] = (() => {
  const rows: ObservableDef[] = [
    observable('power', 0, POWER_VALUES),
    observable('breaker', 0, BREAKER_VALUES),
  ];
  for (let n = 1; n <= 6; n++) rows.push(observable('relay' + n, 0, MOVER_VALUES));
  for (let n = 1; n <= 6; n++) rows.push(observable('pb' + n, 0, MOVER_VALUES));
  for (let n = 1; n <= 6; n++) rows.push(observable('sw' + n, 0, MOVER_VALUES));
  rows.push(observable('dial', -1, DIAL_VALUES));
  for (let n = 1; n <= 6; n++) rows.push(observable('outLamp' + n, 0, LAMP_VALUES));
  for (let n = 1; n <= 6; n++) rows.push(observable('indLamp' + n, 0, LAMP_VALUES));
  return Object.freeze(rows);
})();

/** The chatter/Event identifier order is the mover slice of the observable table. */
export const CHATTER_DEVICES: readonly ChatterDev[] = Object.freeze([
  'relay1', 'relay2', 'relay3', 'relay4', 'relay5', 'relay6',
  'pb1', 'pb2', 'pb3', 'pb4', 'pb5', 'pb6',
  'sw1', 'sw2', 'sw3', 'sw4', 'sw5', 'sw6', 'dial',
]);

/** The State subset needed to overwrite the 33-entry Machine buffer. */
export interface ObservableSource {
  power: boolean;
  breakerTripped: boolean;
  relays: { set1: { nc: boolean; no: boolean } }[];
  buttons: { nc: boolean; no: boolean }[];
  switches: { set1: readonly [boolean, boolean] }[];
  dial: { contact: number | null };
  outLamps: { cls: 'off' | 'dim' | 'on' }[];
  indLamps: { cls: 'off' | 'dim' | 'on' }[];
}

function contactEncoding(nc: boolean, no: boolean): number {
  if (no) return 2;
  if (nc) return 0;
  return 1;
}

function lampEncoding(cls: 'off' | 'dim' | 'on'): number {
  if (cls === 'on') return 2;
  if (cls === 'dim') return 1;
  return 0;
}

function requireSix(length: number, name: string): void {
  if (length !== 6) throw new Error('trace: ' + name + ' must have 6 entries');
}

/** Overwrite and return the same caller-owned buffer. No observable state is retained here. */
export function writeObservables(state: ObservableSource, into: Int32Array): Int32Array {
  if (into.length !== OBSERVABLE_COUNT) throw new Error('trace: observable buffer must have 33 entries');
  requireSix(state.relays.length, 'relays');
  requireSix(state.buttons.length, 'buttons');
  requireSix(state.switches.length, 'switches');
  requireSix(state.outLamps.length, 'outLamps');
  requireSix(state.indLamps.length, 'indLamps');

  into[0] = state.power ? 1 : 0;
  into[1] = state.breakerTripped ? 1 : 0;
  for (let i = 0; i < 6; i++) {
    const relay = state.relays[i] as ObservableSource['relays'][number];
    const button = state.buttons[i] as ObservableSource['buttons'][number];
    const slide = state.switches[i] as ObservableSource['switches'][number];
    into[2 + i] = contactEncoding(relay.set1.nc, relay.set1.no);
    into[8 + i] = contactEncoding(button.nc, button.no);
    into[14 + i] = contactEncoding(slide.set1[0], slide.set1[1]);
    into[21 + i] = lampEncoding((state.outLamps[i] as ObservableSource['outLamps'][number]).cls);
    into[27 + i] = lampEncoding((state.indLamps[i] as ObservableSource['indLamps'][number]).cls);
  }
  into[20] = state.dial.contact === null ? -1 : state.dial.contact;
  return into;
}

function requireTick(tick: number, name = 'tick'): void {
  if (!Number.isInteger(tick) || tick < 0 || tick > INT32_MAX) {
    throw new Error('trace: ' + name + ' must be an int32 in 0..2147483647');
  }
}

function requirePositiveInt32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1 || value > INT32_MAX) {
    throw new Error('trace: ' + name + ' must be a positive int32');
  }
}

function durationMs(ticks: number, name: string): string {
  requirePositiveInt32(ticks, name);
  return Math.floor(ticks / 10) + '.' + ticks % 10;
}

/** Integer-only, tenths-of-a-millisecond timestamp, right-aligned to at least eight columns. */
export function formatMs(tick: number): string {
  requireTick(tick);
  const text = Math.floor(tick / 10) + '.' + tick % 10;
  if (text.length >= 8) return text;
  return '        '.slice(text.length) + text;
}

function formatEnd(end: CordEnd): string {
  if (end.k === 'hole') return 'hole:' + end.hole;
  if (end.k === 'touch') return 'touch:' + end.term;
  return 'free';
}

/** Canonical accepted-input record. The caller owns acceptance timing and rejected-command omission. */
export function formatCommand(tick: number, command: Command): string {
  let payload: string;
  if (command.k === 'power') payload = 'power ' + (command.on ? 'on' : 'off');
  else if (command.k === 'breaker') payload = 'breaker reset';
  else if (command.k === 'connect') {
    payload = 'connect cord=' + command.cord + ' a=' + formatEnd(command.a) +
      ' b=' + formatEnd(command.b) + ' r_uohm=' + (command.r_uohm ?? 0);
  } else if (command.k === 'disconnect') payload = 'disconnect cord=' + command.cord;
  else if (command.k === 'button') payload = 'button' + command.n + ' target=' + command.target;
  else if (command.k === 'switch') payload = 'switch' + command.n + ' target=' + command.target;
  else if (command.k === 'relayGrab') payload = 'relayGrab' + command.n + ' target=' + command.target;
  else if (command.k === 'relayRelease') payload = 'relayRelease' + command.n;
  else if (command.k === 'dialGrab') payload = 'dialGrab targetUdeg=' + command.targetUdeg;
  else payload = 'dialRelease';
  return formatMs(tick) + ' > ' + payload;
}

function spelling(index: number, value: number): string {
  const row = OBSERVABLES[index] as ObservableDef;
  const at = value - row.minValue;
  if (!Number.isInteger(value) || at < 0 || at >= row.values.length) {
    throw new Error('trace: ' + row.name + ' has invalid observable encoding ' + value);
  }
  return row.values[at] as string;
}

/** One change-only line, scanning and rendering in frozen observable index order. */
export function formatTransitions(
  tick: number,
  before33: ArrayLike<number>,
  after33: ArrayLike<number>,
): string | null {
  if (before33.length !== OBSERVABLE_COUNT || after33.length !== OBSERVABLE_COUNT) {
    throw new Error('trace: transition vectors must have 33 entries');
  }
  let line = '';
  for (let i = 0; i < OBSERVABLE_COUNT; i++) {
    const before = before33[i] as number;
    const after = after33[i] as number;
    const beforeText = spelling(i, before);
    const afterText = spelling(i, after);
    if (before === after) continue;
    const row = OBSERVABLES[i] as ObservableDef;
    if (line.length > 0) line += '  ';
    line += row.name + ' ' + beforeText + '->' + afterText;
  }
  return line.length === 0 ? null : formatMs(tick) + ' * ' + line;
}

/** Exact rendering of Contract 1.1's unchanged two-member shared anomaly union. */
export function formatAnomaly(tick: number, anomaly: TraceAnomaly): string {
  let payload: string;
  if (anomaly.k === 'chatter') {
    requirePositiveInt32(anomaly.transitions, 'transitions');
    payload = anomaly.dev + ' chatter ' + anomaly.transitions + ' transitions in ' +
      durationMs(anomaly.windowTicks, 'windowTicks') + 'ms — suppressed ' +
      durationMs(anomaly.quietTicks, 'quietTicks') + 'ms';
  } else {
    payload = 'no settle in ' + durationMs(anomaly.waitedTicks, 'waitedTicks') + 'ms';
  }
  return formatMs(tick) + ' ! ' + payload;
}

/** Validate canonical line content, join with LF, and append exactly one final LF. */
export function formatTrace(lines: readonly string[]): string {
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.includes('\r')) throw new Error('trace: line ' + i + ' contains CR');
    if (line.includes('\n')) throw new Error('trace: line ' + i + ' contains embedded LF');
    if (line.includes('\ufeff')) throw new Error('trace: line ' + i + ' contains a BOM');
    if (/\s$/u.test(line)) throw new Error('trace: line ' + i + ' has trailing whitespace');
    if (i > 0) out += '\n';
    out += line;
  }
  return out + '\n';
}

interface ChatterPage {
  readonly ticks: Int32Array;
  start: number;
  end: number;
  next: ChatterPage | null;
}

function makeChatterPage(): ChatterPage {
  return { ticks: new Int32Array(CHATTER_PAGE_SIZE), start: 0, end: 0, next: null };
}

/**
 * Caller-owned primitive storage. Timestamp pages grow only on a transition that exceeds retained
 * capacity; eviction, quiet and epoch reset retain them for later reuse. There is no behavioral cap.
 */
export class ChatterWorkspace {
  readonly windowTicks = new Int32Array(CHATTER_DEVICE_COUNT);
  readonly quietTicks = new Int32Array(CHATTER_DEVICE_COUNT);
  readonly count = new Int32Array(CHATTER_DEVICE_COUNT);
  readonly lastTransitionTick = new Int32Array(CHATTER_DEVICE_COUNT);
  readonly lastValue = new Int32Array(CHATTER_DEVICE_COUNT);
  readonly suppressed = new Uint8Array(CHATTER_DEVICE_COUNT);
  readonly allocatedPages = new Int32Array(CHATTER_DEVICE_COUNT);
  readonly chatterN: number;
  readonly triggerTransitions: number;
  /** @internal */ readonly _headPages: (ChatterPage | null)[];
  /** @internal */ readonly _tailPages: (ChatterPage | null)[];
  /** @internal */ readonly _freePages: (ChatterPage | null)[];
  initialized = false;
  lastUpdateTick = -1;

  /** @internal Use `createChatterWorkspace`, which binds these fields to one loaded Profile. */
  constructor(profile: Profile) {
    this.chatterN = profile.v.chatter_n;
    this.triggerTransitions = this.chatterN + 1;
    this._headPages = new Array<ChatterPage | null>(CHATTER_DEVICE_COUNT).fill(null);
    this._tailPages = new Array<ChatterPage | null>(CHATTER_DEVICE_COUNT).fill(null);
    this._freePages = new Array<ChatterPage | null>(CHATTER_DEVICE_COUNT).fill(null);
    this.lastTransitionTick.fill(-1);
    for (let device = 0; device < CHATTER_DEVICE_COUNT; device++) {
      let cycle: number;
      if (device < 6) cycle = profile.derived.relayCycleTicks;
      else if (device < 12) cycle = profile.derived.buttonCycleTicks;
      else if (device < 18) cycle = profile.derived.switchCycleTicks;
      else cycle = profile.derived.dialCycleTicks;
      this.windowTicks[device] = profile.v.chatter_cycles * cycle;
      this.quietTicks[device] = profile.v.chatter_quiet_cycles * cycle;
    }
  }
}

export function createChatterWorkspace(profile: Profile): ChatterWorkspace {
  return new ChatterWorkspace(profile);
}

function requireObservableVector(observables: ArrayLike<number>): void {
  if (observables.length !== OBSERVABLE_COUNT) {
    throw new Error('trace: chatter observable vector must have 33 entries');
  }
}

function releasePage(workspace: ChatterWorkspace, device: number, page: ChatterPage): void {
  page.start = 0;
  page.end = 0;
  page.next = workspace._freePages[device] as ChatterPage | null;
  workspace._freePages[device] = page;
}

function clearHistory(workspace: ChatterWorkspace, device: number): void {
  let page = workspace._headPages[device] as ChatterPage | null;
  while (page !== null) {
    const next = page.next;
    releasePage(workspace, device, page);
    page = next;
  }
  workspace._headPages[device] = null;
  workspace._tailPages[device] = null;
  workspace.count[device] = 0;
}

/** The sole authorized chatter-history allocation site; reached only by an actual transition. */
function acquirePage(workspace: ChatterWorkspace, device: number): ChatterPage {
  const retained = workspace._freePages[device] as ChatterPage | null;
  if (retained !== null) {
    workspace._freePages[device] = retained.next;
    retained.next = null;
    return retained;
  }
  workspace.allocatedPages[device] = (workspace.allocatedPages[device] as number) + 1;
  return makeChatterPage();
}

function appendTransition(workspace: ChatterWorkspace, device: number, tick: number): void {
  let tail = workspace._tailPages[device] as ChatterPage | null;
  if (tail === null || tail.end === CHATTER_PAGE_SIZE) {
    const page = acquirePage(workspace, device);
    if (tail === null) workspace._headPages[device] = page;
    else tail.next = page;
    workspace._tailPages[device] = page;
    tail = page;
  }
  tail.ticks[tail.end] = tick;
  tail.end++;
  workspace.count[device] = (workspace.count[device] as number) + 1;
}

function evictTransitions(workspace: ChatterWorkspace, device: number, cutoff: number): void {
  let head = workspace._headPages[device] as ChatterPage | null;
  while (head !== null) {
    while (head.start < head.end && (head.ticks[head.start] as number) <= cutoff) {
      head.start++;
      workspace.count[device] = (workspace.count[device] as number) - 1;
    }
    if (head.start < head.end) break;
    const next = head.next;
    releasePage(workspace, device, head);
    head = next;
    workspace._headPages[device] = head;
    if (head === null) workspace._tailPages[device] = null;
  }
}

/** Clear an epoch's history and seed the current 19 mover values. */
export function resetChatter(workspace: ChatterWorkspace, observables: ArrayLike<number>): void {
  requireObservableVector(observables);
  for (let device = 0; device < CHATTER_DEVICE_COUNT; device++) clearHistory(workspace, device);
  workspace.lastTransitionTick.fill(-1);
  workspace.suppressed.fill(0);
  for (let device = 0; device < CHATTER_DEVICE_COUNT; device++) {
    workspace.lastValue[device] = observables[MOVER_OBSERVABLE_START + device] as number;
  }
  workspace.initialized = true;
  workspace.lastUpdateTick = -1;
}

/**
 * Reseed only the dial after the rotary model's intentional one-tick coast displacement, or after an
 * instantaneous drive-sign reversal (architecture §9.2). The tick's observable transition and Events
 * remain visible, while unrelated mover histories
 * and the monitor's monotonic tick remain untouched.
 */
export function reseedDialChatter(
  workspace: ChatterWorkspace,
  observables: ArrayLike<number>,
): void {
  requireObservableVector(observables);
  if (!workspace.initialized) throw new Error('trace: chatter workspace must be reset before reseed');
  const device = CHATTER_DEVICE_COUNT - 1;
  clearHistory(workspace, device);
  workspace.lastTransitionTick[device] = -1;
  workspace.lastValue[device] = observables[MOVER_OBSERVABLE_START + device] as number;
  workspace.suppressed[device] = 0;
}

/**
 * Observe one post-tick vector and return a 19-bit trigger mask.
 *
 * A caller enumerates set bits from 0 upward, appending primitive Event fields with the parallel
 * device/window/quiet arrays. A timestamp page may grow on a transition; ordinary ticks and reuse
 * of retained pages allocate nothing.
 */
export function updateChatter(
  tick: number,
  observables: ArrayLike<number>,
  workspace: ChatterWorkspace,
): number {
  requireTick(tick);
  requireObservableVector(observables);
  if (!workspace.initialized) throw new Error('trace: chatter workspace must be reset before update');
  if (tick < workspace.lastUpdateTick) throw new Error('trace: chatter tick moved backward without reset');
  workspace.lastUpdateTick = tick;

  let triggerMask = 0;
  for (let device = 0; device < CHATTER_DEVICE_COUNT; device++) {
    const lastTick = workspace.lastTransitionTick[device] as number;
    if (lastTick >= 0 && tick - lastTick >= (workspace.quietTicks[device] as number)) {
      clearHistory(workspace, device);
      workspace.lastTransitionTick[device] = -1;
      workspace.suppressed[device] = 0;
    }

    const value = observables[MOVER_OBSERVABLE_START + device] as number;
    if (value === (workspace.lastValue[device] as number)) continue;
    workspace.lastValue[device] = value;
    workspace.lastTransitionTick[device] = tick;
    if (workspace.suppressed[device] === 1) continue;

    const cutoff = tick - (workspace.windowTicks[device] as number);
    evictTransitions(workspace, device, cutoff);
    appendTransition(workspace, device, tick);
    if ((workspace.count[device] as number) > workspace.chatterN) {
      workspace.suppressed[device] = 1;
      triggerMask |= 1 << device;
    }
  }
  return triggerMask;
}
