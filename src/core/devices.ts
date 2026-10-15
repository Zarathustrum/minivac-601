/** Movers, transfer contacts, lamp state and breaker latch (§13.4.3–§13.4.4). */
import { iabs, idiv } from './ints.ts';
import { CONTACT_NC, CONTACT_NO, CONTACT_OPEN } from './graph.ts';
import type { LoadedNetlist, NetContact } from './netlist.ts';
import { pwlLookup } from './solve.ts';
import type { Pwl } from './solve.ts';
import type { TerminalId } from './terminals.ts';

export type Direction = -1 | 0 | 1;

/** Caller-owned parallel storage shared by relays, buttons and slide switches. */
export interface MoverBank {
  readonly travel: Int32Array;
  readonly dir: Int8Array;
  readonly acc: Int32Array;
}

export type RelayBand = 'below' | 'hold' | 'above';
export const RELAY_DROP_OUT = -1;
export const RELAY_NO_EVENT = 0;
export const RELAY_PULL_IN = 1;
export type RelayDirectionEvent = -1 | 0 | 1;

/** Re-export the one GraphInput encoding; the wiper row is likewise -1 or pad 0..15. */
export { CONTACT_NC, CONTACT_NO, CONTACT_OPEN } from './graph.ts';
export type TransferPosition = -1 | 0 | 1;
type TransferContact = Exclude<NetContact, { readonly k: 'wiper' }>;

export type ContactEdge = 'break' | 'make';
export type ContactEdgeSink = (edge: ContactEdge, arm: TerminalId, to: TerminalId) => void;

export type LampClass = 'off' | 'dim' | 'on';
export const LAMP_OFF = -1;
export const LAMP_NO_EVENT = 0;
export const LAMP_ON = 1;
export type LampClassEvent = -1 | 0 | 1;

export interface BreakerState {
  overloadTicks: number;
  tripPending: boolean;
  tripped: boolean;
}

/** Rising power resets electrical state and unheld relay mechanics; held relay travel survives. */
export function coldResetElectrical(
  relays: MoverBank,
  iCoil: Float64Array,
  rLamp: Float64Array,
  rColdOhm: number,
  held?: ArrayLike<number>,
  lastPhysicalDir?: Int8Array,
): void {
  for (let n = 0; n < relays.travel.length; n++) {
    if ((held?.[n] ?? 0) === 0) {
      relays.travel[n] = 0;
      if (lastPhysicalDir !== undefined) lastPhysicalDir[n] = 0;
    }
    relays.dir[n] = 0;
    relays.acc[n] = 0;
  }
  for (let n = 0; n < iCoil.length; n++) iCoil[n] = 0;
  for (let n = 0; n < rLamp.length; n++) rLamp[n] = rColdOhm;
}

function targetDirection(travel: number, target: number): Direction {
  if (target > travel) return 1;
  if (target < travel) return -1;
  return 0;
}

/** One allocation-free tick of §13.4.4's integer-remainder mover. */
function advanceMover(bank: MoverBank, n: number, requested: Direction, target: number, strokeTicks: number): void {
  const travel = bank.travel[n] as number;
  let direction = requested;
  if ((direction > 0 && travel >= target) || (direction < 0 && travel <= target)) direction = 0;

  const prior = bank.dir[n] as Direction;
  let acc = direction === prior ? bank.acc[n] as number : 0;
  bank.dir[n] = direction;
  if (direction === 0) {
    bank.acc[n] = 0;
    return;
  }

  acc += 1000;
  const step = idiv(acc, strokeTicks);
  acc -= step * strokeTicks;
  const next = travel + direction * step;
  if ((direction > 0 && next >= target) || (direction < 0 && next <= target)) {
    bank.travel[n] = target;
    bank.dir[n] = 0;
    bank.acc[n] = 0;
  } else {
    bank.travel[n] = next;
    bank.acc[n] = acc;
  }
}

export function advanceTargetMover(bank: MoverBank, n: number, target: number, strokeTicks: number): void {
  advanceMover(bank, n, targetDirection(bank.travel[n] as number, target), target, strokeTicks);
}

export function relayBand(coilUa: number, pullInUa: number, dropOutUa: number): RelayBand {
  const ua = iabs(coilUa);
  if (ua >= pullInUa) return 'above';
  if (ua <= dropOutUa) return 'below';
  return 'hold';
}

export function relayMarginUa(event: RelayDirectionEvent, coilUa: number, pullInUa: number, dropOutUa: number): number {
  const ua = iabs(coilUa);
  if (event === RELAY_PULL_IN) return ua - pullInUa;
  if (event === RELAY_DROP_OUT) return dropOutUa - ua;
  return 0;
}

/** Returns a threshold-direction Event code; arrival at a stop is not an Event. */
export function advanceRelay(
  bank: MoverBank,
  n: number,
  coilUa: number,
  pullInUa: number,
  dropOutUa: number,
  operateTicks: number,
  releaseTicks: number,
  stoppedMidstrokeDirection: Direction = 0,
): RelayDirectionEvent {
  const travel = bank.travel[n] as number;
  const band = relayBand(coilUa, pullInUa, dropOutUa);
  let requested: Direction;
  if (band === 'above') requested = 1;
  else if (band === 'below') requested = -1;
  else requested = travel === 0 || travel === 1000
    ? 0
    : (bank.dir[n] as Direction) || stoppedMidstrokeDirection;

  const target = requested < 0 ? 0 : 1000;
  let effective = requested;
  if ((effective > 0 && travel >= target) || (effective < 0 && travel <= target)) effective = 0;
  const event: RelayDirectionEvent = effective !== bank.dir[n] && effective !== 0 ? effective : RELAY_NO_EVENT;
  advanceMover(bank, n, effective, target, effective < 0 ? releaseTicks : operateTicks);
  return event;
}

export function transferPosition(travel: number, breakMilli: number, makeMilli: number): TransferPosition {
  if (travel < breakMilli) return CONTACT_NC;
  if (travel > makeMilli) return CONTACT_NO;
  return CONTACT_OPEN;
}

function transferTravel(row: TransferContact, relays: MoverBank, buttons: MoverBank, switches: MoverBank): number {
  if (row.k === 'relay') return relays.travel[row.n - 1] as number;
  if (row.k === 'button') return buttons.travel[row.n - 1] as number;
  return switches.travel[row.n - 1] as number;
}

/** Freeze all 31 validated contact rows in their stored order into caller-owned storage. */
export function writeContactPositions(
  netlist: LoadedNetlist,
  relays: MoverBank,
  buttons: MoverBank,
  switches: MoverBank,
  wiperContact: number | null,
  breakMilli: number,
  makeMilli: number,
  out: Int8Array,
): void {
  for (let i = 0; i < netlist.contacts.length; i++) {
    const row = netlist.contacts[i] as NetContact;
    out[i] = row.k === 'wiper'
      ? wiperContact === null ? -1 : wiperContact
      : transferPosition(transferTravel(row, relays, buttons, switches), breakMilli, makeMilli);
  }
}

/** A direct NC↔NO jump emits break before make, using terminals from the loaded row. */
export function emitTransferEdges(
  row: TransferContact,
  before: TransferPosition,
  after: TransferPosition,
  sink: ContactEdgeSink,
): void {
  if (before === after) return;
  if (before !== CONTACT_OPEN) sink('break', row.arm, before === CONTACT_NC ? row.nc : row.no);
  if (after !== CONTACT_OPEN) sink('make', row.arm, after === CONTACT_NC ? row.nc : row.no);
}

/** Disabled-source cooling and an independently testable form of §3.4's filament update. */
export function advanceLampFilament(rLampOhm: number, currentA: number, pwl: Pwl, kThermal: number): number {
  const target = pwlLookup(pwl, currentA < 0 ? -currentA : currentA);
  return rLampOhm + (target - rLampOhm) * kThermal;
}

/** Binary64 nearest-integer rounding with ties away from zero; §4.4's `idivRound` is integer-only. */
function roundHalfAwayDouble(value: number): number {
  const truncated = Math.trunc(value);
  const fraction = value - truncated;
  if (fraction >= 0.5) return truncated + 1;
  if (fraction <= -0.5) return truncated - 1;
  return truncated === 0 ? 0 : truncated;
}

export function lampBrightnessMilli(rLampOhm: number, rColdOhm: number, rHotOhm: number): number {
  if (
    !Number.isFinite(rColdOhm) || !Number.isFinite(rHotOhm) ||
    rColdOhm <= 0 || rHotOhm <= 0
  ) {
    throw new Error('lamp brightness resistance endpoints must be finite, positive, and increasing');
  }
  const spanOhm = rHotOhm - rColdOhm;
  if (!Number.isFinite(spanOhm) || spanOhm <= 0) {
    throw new Error('lamp brightness resistance endpoints must be finite, positive, and increasing');
  }
  const scaled = (1000 * (rLampOhm - rColdOhm)) / spanOhm;
  const milli = roundHalfAwayDouble(scaled);
  if (milli < 0) return 0;
  if (milli > 1000) return 1000;
  return milli;
}

export function lampClass(milli: number, dimMilli: number, onMilli: number): LampClass {
  if (milli >= onMilli) return 'on';
  if (milli >= dimMilli) return 'dim';
  return 'off';
}

export function lampClassEvent(before: LampClass, after: LampClass): LampClassEvent {
  if (before === 'off' && after !== 'off') return LAMP_ON;
  if (before !== 'off' && after === 'off') return LAMP_OFF;
  return LAMP_NO_EVENT;
}

export function sourceEnabled(power: boolean, breaker: BreakerState): boolean {
  return power && !breaker.tripped;
}

export function clearBreakerDwell(breaker: BreakerState): void {
  breaker.overloadTicks = 0;
}

export function breakerOverThreshold(supplyUa: number, tripUa: number): boolean {
  return iabs(supplyUa) >= tripUa;
}

/** Sample an enabled-source result; the returned boolean is `flags.overCurrent`. */
export function sampleBreaker(
  breaker: BreakerState,
  enabled: boolean,
  supplyUa: number,
  tripUa: number,
  deadShortUa: number,
  tripDelayTicks: number,
): boolean {
  if (!enabled) {
    breaker.overloadTicks = 0;
    return false;
  }
  const ua = iabs(supplyUa);
  if (ua >= deadShortUa) breaker.tripPending = true;
  else if (breakerOverThreshold(ua, tripUa)) {
    if (breaker.overloadTicks < tripDelayTicks) breaker.overloadTicks++;
    if (breaker.overloadTicks >= tripDelayTicks) breaker.tripPending = true;
  } else breaker.overloadTicks = 0;
  return breakerOverThreshold(ua, tripUa);
}

/** Consume pending before commands; the returned latch survives a same-boundary reset. */
export function latchBreakerPending(breaker: BreakerState): boolean {
  const pending = breaker.tripPending;
  breaker.tripPending = false;
  return pending;
}

/** Returns whether an effective reset Event is due. */
export function resetBreaker(breaker: BreakerState): boolean {
  const changed = breaker.tripped;
  breaker.tripped = false;
  breaker.tripPending = false;
  breaker.overloadTicks = 0;
  return changed;
}

export function applyLatchedBreakerTrip(breaker: BreakerState, pending: boolean): boolean {
  if (!pending) return false;
  breaker.tripped = true;
  breaker.overloadTicks = 0;
  return true;
}
