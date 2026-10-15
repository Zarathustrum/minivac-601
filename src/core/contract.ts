/**
 * The public core contract frozen by architecture §§7–8 and §13.4.
 *
 * Types only, apart from the version literal. Runtime validation belongs to Machine and the
 * conformance fixture loader; physical terminal and hole identity belongs to `terminals.ts`.
 *
 * DOM-free, dependency-free, no filesystem, no clock, no runtime type registry.
 */
import type { HoleId, TerminalId } from './terminals.ts';

export type { HoleId, TerminalId } from './terminals.ts';

export const CONTRACT = '1.1.0';

/** Caller-assigned int32 in 0..255. Runtime validation belongs to Machine. */
export type CordId = number;

export type Sect = 1 | 2 | 3 | 4 | 5 | 6;

export type CordEnd =
  | { k: 'hole'; hole: HoleId }
  | { k: 'touch'; term: TerminalId }
  | { k: 'free' };

export type Command =
  | { k: 'power'; on: boolean }
  | { k: 'breaker'; reset: true }
  | { k: 'connect'; cord: CordId; a: CordEnd; b: CordEnd; r_uohm?: number }
  | { k: 'disconnect'; cord: CordId }
  | { k: 'button'; n: Sect; target: number }
  | { k: 'switch'; n: Sect; target: number }
  | { k: 'relayGrab'; n: Sect; target: number }
  | { k: 'relayRelease'; n: Sect }
  | { k: 'dialGrab'; targetUdeg: number }
  | { k: 'dialRelease' };

export type CmdResult =
  | { ok: true }
  | {
      ok: false;
      why:
        | 'hole_occupied'
        | 'unknown_hole'
        | 'unknown_terminal'
        | 'unknown_cord'
        | 'cord_exists'
        | 'bad_cord_id'
        | 'bad_target';
    };

export type ChatterDev =
  | 'relay1' | 'relay2' | 'relay3' | 'relay4' | 'relay5' | 'relay6'
  | 'pb1' | 'pb2' | 'pb3' | 'pb4' | 'pb5' | 'pb6'
  | 'sw1' | 'sw2' | 'sw3' | 'sw4' | 'sw5' | 'sw6'
  | 'dial';

export type TraceAnomaly =
  | {
      k: 'chatter';
      dev: ChatterDev;
      transitions: number;
      windowTicks: number;
      quietTicks: number;
    }
  | { k: 'no-settle'; waitedTicks: number };

export type Note =
  | {
      k: 'coil-starved';
      relay: Sect;
      coilUa: number;
      needsUa: number;
      drops: { el: string; mv: number }[];
    }
  | { k: 'lamp-in-coil-path'; relay: Sect; lampMv: number };

export type Event =
  | { t: number; k: 'power.on' | 'power.off' | 'breaker.trip' | 'breaker.reset' }
  | { t: number; k: 'relay.pullIn' | 'relay.dropOut'; n: Sect; coilUa: number; marginUa: number }
  | { t: number; k: 'contact.make' | 'contact.break'; arm: TerminalId; to: TerminalId }
  | { t: number; k: 'lamp.on' | 'lamp.off'; kind: 'out' | 'ind'; n: Sect }
  | { t: number; k: 'dial.make' | 'dial.break'; pos: number }
  | ({ t: number } & Extract<TraceAnomaly, { k: 'chatter' }>);

export interface State {
  contract: string;
  netlistHash: string;
  profileId: string;
  profileHash: string;
  tick: number;

  power: boolean;
  breakerTripped: boolean;
  railMv: number;
  supplyUa: number;

  relays: {
    travel: number;
    coilMv: number;
    coilUa: number;
    pullInUa: number;
    dropOutUa: number;
    band: 'below' | 'hold' | 'above';
    coilShorted: boolean;
    set1: { nc: boolean; no: boolean };
    set2: { nc: boolean; no: boolean };
    indicatorUa: number;
    held: boolean;
  }[];

  outLamps: { ua: number; milli: number; cls: 'off' | 'dim' | 'on' }[];
  indLamps: { ua: number; milli: number; cls: 'off' | 'dim' | 'on' }[];
  buttons: { travel: number; nc: boolean; no: boolean }[];
  switches: {
    travel: number;
    set1: [boolean, boolean];
    set2: [boolean, boolean];
  }[];
  dial: { udeg: number; contact: number | null; mrpm: number; held: boolean };

  cords: { id: CordId; a: CordEnd; b: CordEnd; r_uohm: number }[];
  terminalMv: (number | null)[];
  notes: Note[];
  flags: { chattering: ChatterDev[]; overCurrent: boolean; nonPortable: boolean };
}

export interface Machine {
  apply(c: Command): CmdResult;
  advance(ticks: number): void;
  snapshot(): State;
  observables(): Int32Array;
  motionMask(): number;
  drainEvents(): Event[];
}
