/**
 * The deterministic Machine integration (architecture §13.4).
 *
 * The tick path owns and overwrites fixed graph, solve, device, quantization and note storage.
 * Only accepted-command pages, retained Event pages and retained chatter pages may grow at runtime.
 * Snapshot and drain materialize the public contract deliberately.
 *
 * DOM-free, filesystem-free, clock-free, and without a topology or solve cache.
 */
import { CONTRACT } from './contract.ts';
import type {
  ChatterDev,
  CmdResult,
  Command,
  CordEnd,
  Event,
  Machine,
  Note,
  Sect,
  State,
} from './contract.ts';
import {
  CONTACT_NC,
  CONTACT_NO,
  GRAPH_MAX_CORDS,
  GRAPH_MAX_ELEMENTS,
  GRAPH_MAX_NODES,
  GRAPH_TERMINALS,
  buildGraphInto,
  createGraphWorkspace,
} from './graph.ts';
import type { GraphWorkspace, ResolvedCord } from './graph.ts';
import {
  LAMP_NO_EVENT,
  LAMP_OFF,
  RELAY_NO_EVENT,
  RELAY_PULL_IN,
  advanceRelay,
  advanceTargetMover,
  applyLatchedBreakerTrip,
  clearBreakerDwell,
  coldResetElectrical,
  emitTransferEdges,
  lampBrightnessMilli,
  lampClass,
  lampClassEvent,
  latchBreakerPending,
  relayBand,
  relayMarginUa,
  resetBreaker,
  sampleBreaker,
  sourceEnabled,
  writeContactPositions,
} from './devices.ts';
import type {
  BreakerState,
  ContactEdge,
  LampClass,
  MoverBank,
  RelayDirectionEvent,
  TransferPosition,
} from './devices.ts';
import { quantize } from './ints.ts';
import type { PortFlags } from './ints.ts';
import type { LoadedNetlist, NetContact } from './netlist.ts';
import { SCALAR_KEYS } from './profile.ts';
import type { Derived, Profile, PwlPoint, ScalarKey } from './profile.ts';
import {
  createRotaryState,
  grabRotary,
  releaseRotary,
  stepRotary,
} from './rotary.ts';
import type { RotaryEdgeKind, RotaryState } from './rotary.ts';
import { createSolveWorkspace, tickSolveGraphInto } from './solve.ts';
import type { Carried, Pwl, SolveCfg, SolveWorkspace } from './solve.ts';
import {
  CHATTER_DEVICE_COUNT,
  CHATTER_DEVICES,
  OBSERVABLE_COUNT,
  createChatterWorkspace,
  reseedDialChatter,
  resetChatter,
  updateChatter,
  writeObservables,
} from './trace.ts';
import type { ChatterWorkspace, ObservableSource } from './trace.ts';
import {
  HOLE_COUNT,
  TERMINAL_IDS,
  holeByIndex,
  parseHoleId,
  parseTerminalId,
  terminalIndex,
} from './terminals.ts';
import type { HoleId, TerminalId } from './terminals.ts';

const INT32_MAX = 2147483647;
const SECTIONS = 6;
const LAMPS = 12;
const CONTACTS = 31;
const NOTE_STRIDE = GRAPH_MAX_ELEMENTS;
const STORE_PAGE_SIZE = 64;

const END_FREE = 0;
const END_TOUCH = 1;
const END_HOLE = 2;

const CMD_POWER = 1;
const CMD_BREAKER = 2;
const CMD_CONNECT = 3;
const CMD_DISCONNECT = 4;
const CMD_BUTTON = 5;
const CMD_SWITCH = 6;
const CMD_DIAL_GRAB = 7;
const CMD_DIAL_RELEASE = 8;
const CMD_RELAY_GRAB = 9;
const CMD_RELAY_RELEASE = 10;

const EV_POWER_ON = 1;
const EV_POWER_OFF = 2;
const EV_BREAKER_TRIP = 3;
const EV_BREAKER_RESET = 4;
const EV_RELAY_PULL = 5;
const EV_RELAY_DROP = 6;
const EV_CONTACT_MAKE = 7;
const EV_CONTACT_BREAK = 8;
const EV_LAMP_ON = 9;
const EV_LAMP_OFF = 10;
const EV_DIAL_MAKE = 11;
const EV_DIAL_BREAK = 12;
const EV_CHATTER = 13;

const CMD_OK: CmdResult = Object.freeze({ ok: true });
const BAD_CORD_ID: CmdResult = Object.freeze({ ok: false, why: 'bad_cord_id' });
const CORD_EXISTS: CmdResult = Object.freeze({ ok: false, why: 'cord_exists' });
const UNKNOWN_CORD: CmdResult = Object.freeze({ ok: false, why: 'unknown_cord' });
const UNKNOWN_HOLE: CmdResult = Object.freeze({ ok: false, why: 'unknown_hole' });
const UNKNOWN_TERMINAL: CmdResult = Object.freeze({ ok: false, why: 'unknown_terminal' });
const HOLE_OCCUPIED: CmdResult = Object.freeze({ ok: false, why: 'hole_occupied' });
const BAD_TARGET: CmdResult = Object.freeze({ ok: false, why: 'bad_target' });

interface PrimitivePage {
  readonly tag: Int8Array;
  readonly f0: Int32Array;
  readonly f1: Int32Array;
  readonly f2: Int32Array;
  readonly f3: Int32Array;
  readonly f4: Int32Array;
  readonly f5: Int32Array;
  readonly f6: Int32Array;
  readonly f7: Int32Array;
  end: number;
  next: PrimitivePage | null;
}

function makePage(): PrimitivePage {
  return {
    tag: new Int8Array(STORE_PAGE_SIZE),
    f0: new Int32Array(STORE_PAGE_SIZE),
    f1: new Int32Array(STORE_PAGE_SIZE),
    f2: new Int32Array(STORE_PAGE_SIZE),
    f3: new Int32Array(STORE_PAGE_SIZE),
    f4: new Int32Array(STORE_PAGE_SIZE),
    f5: new Int32Array(STORE_PAGE_SIZE),
    f6: new Int32Array(STORE_PAGE_SIZE),
    f7: new Int32Array(STORE_PAGE_SIZE),
    end: 0,
    next: null,
  };
}

/** Growable primitive pages. Callers constrain each append to an architecture-authorized site. */
class PrimitiveStore {
  head: PrimitivePage | null = null;
  tail: PrimitivePage | null = null;
  free: PrimitivePage | null = null;
  count = 0;

  append(
    tag: number,
    f0 = 0,
    f1 = 0,
    f2 = 0,
    f3 = 0,
    f4 = 0,
    f5 = 0,
    f6 = 0,
    f7 = 0,
  ): void {
    let page = this.tail;
    if (page === null || page.end === STORE_PAGE_SIZE) {
      page = this.acquire();
      if (this.tail === null) this.head = page;
      else this.tail.next = page;
      this.tail = page;
    }
    const at = page.end;
    page.tag[at] = tag;
    page.f0[at] = f0;
    page.f1[at] = f1;
    page.f2[at] = f2;
    page.f3[at] = f3;
    page.f4[at] = f4;
    page.f5[at] = f5;
    page.f6[at] = f6;
    page.f7[at] = f7;
    page.end++;
    this.count++;
  }

  copyInto(target: PrimitiveStore): void {
    let page = this.head;
    while (page !== null) {
      for (let i = 0; i < page.end; i++) {
        target.append(
          page.tag[i] as number,
          page.f0[i] as number,
          page.f1[i] as number,
          page.f2[i] as number,
          page.f3[i] as number,
          page.f4[i] as number,
          page.f5[i] as number,
          page.f6[i] as number,
          page.f7[i] as number,
        );
      }
      page = page.next;
    }
    this.clear();
  }

  clear(): void {
    let page = this.head;
    while (page !== null) {
      const next = page.next;
      page.end = 0;
      page.next = this.free;
      this.free = page;
      page = next;
    }
    this.head = null;
    this.tail = null;
    this.count = 0;
  }

  private acquire(): PrimitivePage {
    const page = this.free;
    if (page === null) return makePage();
    this.free = page.next;
    page.next = null;
    return page;
  }
}

interface MutableCord extends ResolvedCord {
  id: number;
  a: number;
  b: number;
  rUohm: number;
}

class CordView implements ArrayLike<ResolvedCord> {
  [index: number]: MutableCord;
  length = 0;

  constructor() {
    for (let i = 0; i < GRAPH_MAX_CORDS; i++) {
      this[i] = { id: i, a: -1, b: -1, rUohm: 0 };
    }
  }
}

interface CordTable {
  readonly live: Uint8Array;
  readonly aKind: Int8Array;
  readonly aTerminal: Int16Array;
  readonly aHole: Int16Array;
  readonly bKind: Int8Array;
  readonly bTerminal: Int16Array;
  readonly bHole: Int16Array;
  readonly rUohm: Int32Array;
  readonly holeOwner: Int16Array;
}

function cordTable(): CordTable {
  const table: CordTable = {
    live: new Uint8Array(GRAPH_MAX_CORDS),
    aKind: new Int8Array(GRAPH_MAX_CORDS),
    aTerminal: new Int16Array(GRAPH_MAX_CORDS),
    aHole: new Int16Array(GRAPH_MAX_CORDS),
    bKind: new Int8Array(GRAPH_MAX_CORDS),
    bTerminal: new Int16Array(GRAPH_MAX_CORDS),
    bHole: new Int16Array(GRAPH_MAX_CORDS),
    rUohm: new Int32Array(GRAPH_MAX_CORDS),
    holeOwner: new Int16Array(HOLE_COUNT),
  };
  table.aTerminal.fill(-1);
  table.aHole.fill(-1);
  table.bTerminal.fill(-1);
  table.bHole.fill(-1);
  table.holeOwner.fill(-1);
  return table;
}

function movers(): MoverBank {
  return {
    travel: new Int32Array(SECTIONS),
    dir: new Int8Array(SECTIONS),
    acc: new Int32Array(SECTIONS),
  };
}

function copyDerived(source: Readonly<Derived>): Derived {
  return {
    pullInUa: source.pullInUa,
    dropOutUa: source.dropOutUa,
    relayPullInUa: Array.from(source.relayPullInUa),
    relayDropOutUa: Array.from(source.relayDropOutUa),
    relayOperateTicks: source.relayOperateTicks,
    relayReleaseTicks: source.relayReleaseTicks,
    pushbuttonTicks: source.pushbuttonTicks,
    slideTicks: source.slideTicks,
    kThermal: source.kThermal,
    arcStepUa: source.arcStepUa,
    tripDelayTicks: source.tripDelayTicks,
    deadShortUa: source.deadShortUa,
    rMotorParUohm: source.rMotorParUohm,
    vMotorRunMv: source.vMotorRunMv,
    relayCycleTicks: source.relayCycleTicks,
    buttonCycleTicks: source.buttonCycleTicks,
    switchCycleTicks: source.switchCycleTicks,
    dialCycleTicks: source.dialCycleTicks,
    settleCapTicks: source.settleCapTicks,
  };
}

function copyProfile(source: Profile): Profile {
  const v = {} as Record<ScalarKey, number>;
  for (const key of SCALAR_KEYS) v[key] = source.v[key];
  const pwl: PwlPoint[] = [];
  for (let i = 0; i < source.pwl.length; i++) {
    const point = source.pwl[i] as PwlPoint;
    pwl.push([point[0], point[1]]);
  }
  return {
    id: source.id,
    marginal: source.marginal,
    provenance: source.provenance,
    hash: source.hash,
    v,
    dVRelayMv: Array.from(source.dVRelayMv),
    pwl,
    derived: copyDerived(source.derived),
  };
}

function solveCfg(profile: Profile): SolveCfg {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < profile.pwl.length; i++) {
    const point = profile.pwl[i] as PwlPoint;
    xs.push(point[0] * 1e-6);
    ys.push(point[1] * 1e-6);
  }
  const pwl: Pwl = { xs, ys };
  return {
    dtS: profile.v.tick_us * 1e-6,
    vArc: profile.v.V_arc_clamp_mv * 1e-3,
    kThermal: profile.derived.kThermal,
    gminS: profile.v.gmin_ns * 1e-9,
    pwl,
    datum: 0,
  };
}

function asSect(index: number): Sect {
  return (index + 1) as Sect;
}

function classFromCode(code: number): LampClass {
  if (code === 2) return 'on';
  if (code === 1) return 'dim';
  return 'off';
}

function classCode(value: LampClass): number {
  if (value === 'on') return 2;
  if (value === 'dim') return 1;
  return 0;
}

function closedPair(position: number): [boolean, boolean] {
  return [position === CONTACT_NC, position === CONTACT_NO];
}

class MachineImpl implements Machine {
  private readonly netlist: LoadedNetlist;
  private readonly profile: Profile;
  private readonly cfg: SolveCfg;
  private readonly graph: GraphWorkspace;
  private readonly solve: SolveWorkspace;
  private readonly carried: Carried;
  private readonly flags: PortFlags = { nonPortable: false };

  private readonly relays = movers();
  private readonly buttons = movers();
  private readonly switches = movers();
  private readonly buttonTargets = new Int32Array(SECTIONS);
  private readonly switchTargets = new Int32Array(SECTIONS);
  private readonly relayTargets = new Int32Array(SECTIONS);
  private readonly relayHeld = new Uint8Array(SECTIONS);
  private readonly relayHeldPriorTick = new Uint8Array(SECTIONS);
  private readonly relayLastPhysicalDir = new Int8Array(SECTIONS);
  private readonly rotary: RotaryState;
  private readonly breaker: BreakerState = { overloadTicks: 0, tripPending: false, tripped: false };

  private readonly actual = cordTable();
  private readonly projected = cordTable();
  private readonly cords = new CordView();
  private readonly commandStore = new PrimitiveStore();
  private readonly eventStore = new PrimitiveStore();
  private readonly dialEventStore = new PrimitiveStore();

  private readonly contactBefore = new Int8Array(CONTACTS);
  private readonly contactAfter = new Int8Array(CONTACTS);
  private readonly graphInput: { cords: ArrayLike<ResolvedCord>; contactPosition: ArrayLike<number> };
  private readonly priorTravel = new Int32Array(SECTIONS * 3);
  private readonly relayDirection = new Int8Array(SECTIONS);
  private priorDialContact: number | null = 0;

  private readonly nodeMv = new Int32Array(GRAPH_MAX_NODES);
  private readonly elementMv = new Int32Array(GRAPH_MAX_ELEMENTS);
  private readonly elementAbsMv = new Int32Array(GRAPH_MAX_ELEMENTS);
  private readonly terminalMv = new Int32Array(GRAPH_TERMINALS);
  private readonly terminalFloating = new Uint8Array(GRAPH_TERMINALS);
  private readonly relayCoilMv = new Int32Array(SECTIONS);
  private readonly relayCoilUa = new Int32Array(SECTIONS);
  private readonly relayIndicatorUa = new Int32Array(SECTIONS);
  private readonly relayCoilShorted = new Uint8Array(SECTIONS);
  private readonly outLampUa = new Int32Array(SECTIONS);
  private readonly indLampUa = new Int32Array(SECTIONS);
  private readonly outLampMilli = new Int32Array(SECTIONS);
  private readonly indLampMilli = new Int32Array(SECTIONS);
  private readonly outLampClass = new Int8Array(SECTIONS);
  private readonly indLampClass = new Int8Array(SECTIONS);
  private readonly beforeLampClass = new Int8Array(LAMPS);
  private railMv = 0;
  private supplyUa = 0;
  private overCurrent = false;

  private readonly outElement = new Int16Array(SECTIONS);
  private readonly indElement = new Int16Array(SECTIONS);
  private readonly coilElement = new Int16Array(SECTIONS);
  private readonly outCarried = new Int8Array(SECTIONS);
  private readonly indCarried = new Int8Array(SECTIONS);
  private readonly relaySet1Row = new Int8Array(SECTIONS);
  private readonly relaySet2Row = new Int8Array(SECTIONS);
  private readonly buttonRow = new Int8Array(SECTIONS);
  private readonly switchSet1Row = new Int8Array(SECTIONS);
  private readonly switchSet2Row = new Int8Array(SECTIONS);
  private motorElement = -1;
  private motorA = -1;
  private motorB = -1;
  private plusTerminal = -1;

  private readonly holeIds: HoleId[] = new Array<HoleId>(HOLE_COUNT);
  private readonly validatedKind = new Int8Array(2);
  private readonly validatedTerminal = new Int16Array(2);
  private readonly validatedHole = new Int16Array(2);

  private readonly observableSource: ObservableSource;
  private readonly publicObservables = new Int32Array(OBSERVABLE_COUNT);
  private readonly currentObservables = new Int32Array(OBSERVABLE_COUNT);
  private readonly previousObservables = new Int32Array(OBSERVABLE_COUNT);
  private readonly chatter: ChatterWorkspace;

  private steadyTicks = 0;
  private readonly noteCoil = new Uint8Array(SECTIONS);
  private readonly noteLamp = new Uint8Array(SECTIONS);
  private readonly noteLampMv = new Int32Array(SECTIONS);
  private readonly noteDropCount = new Int16Array(SECTIONS);
  private readonly noteDropElement = new Int16Array(SECTIONS * NOTE_STRIDE);
  private readonly noteDropMv = new Int32Array(SECTIONS * NOTE_STRIDE);
  private readonly chainVisited = new Uint8Array(GRAPH_MAX_ELEMENTS);

  private readonly netlistHash: string;
  private readonly profileHash: string;
  private power = false;
  private tick = 0;
  /** Tick of the last dial chatter reseed (coast or reversal) this power epoch; -1 for none. */
  private lastDialReseedTick = -1;

  private readonly contactSink: (edge: ContactEdge, arm: TerminalId, to: TerminalId) => void;
  private readonly rotarySink: (kind: RotaryEdgeKind, pos: number) => void;

  constructor(netlist: LoadedNetlist, profile: Profile) {
    this.netlist = netlist;
    this.profile = copyProfile(profile);
    this.cfg = solveCfg(this.profile);
    this.graph = createGraphWorkspace();
    this.solve = createSolveWorkspace();
    this.carried = {
      iCoil: new Float64Array(SECTIONS),
      rLamp: new Float64Array(LAMPS),
    };
    this.carried.rLamp.fill(this.profile.v.R_cold_uohm * 1e-6);
    this.rotary = createRotaryState(this.profile);
    this.chatter = createChatterWorkspace(this.profile);
    this.graphInput = { cords: this.cords, contactPosition: this.contactBefore };
    this.netlistHash = 'fnv1a64:' + netlist.hash;
    this.profileHash = 'fnv1a64:' + this.profile.hash;

    this.outElement.fill(-1);
    this.indElement.fill(-1);
    this.coilElement.fill(-1);
    this.relaySet1Row.fill(-1);
    this.relaySet2Row.fill(-1);
    this.buttonRow.fill(-1);
    this.switchSet1Row.fill(-1);
    this.switchSet2Row.fill(-1);
    this.indexNetlist();
    this.indexHoles();

    const relaySources: { set1: { nc: boolean; no: boolean } }[] = [];
    const buttonSources: { nc: boolean; no: boolean }[] = [];
    const switchSources: { set1: [boolean, boolean] }[] = [];
    const outSources: { cls: LampClass }[] = [];
    const indSources: { cls: LampClass }[] = [];
    for (let n = 0; n < SECTIONS; n++) {
      relaySources.push({ set1: { nc: true, no: false } });
      buttonSources.push({ nc: true, no: false });
      switchSources.push({ set1: [true, false] });
      outSources.push({ cls: 'off' });
      indSources.push({ cls: 'off' });
    }
    this.observableSource = {
      power: false,
      breakerTripped: false,
      relays: relaySources,
      buttons: buttonSources,
      switches: switchSources,
      dial: { contact: 0 },
      outLamps: outSources,
      indLamps: indSources,
    };

    this.contactSink = this.recordContactEdge.bind(this);
    this.rotarySink = this.recordRotaryEdge.bind(this);

    this.writeContacts(this.contactBefore);
    this.contactAfter.set(this.contactBefore);
    this.rebuildCordView();
    buildGraphInto(
      this.netlist,
      this.profile,
      this.graphInput,
      false,
      this.graph,
    );
    tickSolveGraphInto(this.graph, this.carried, this.cfg, this.solve);
    this.quantizeElectrical(false);
    this.refreshObservableSource();
    writeObservables(this.observableSource, this.currentObservables);
    this.previousObservables.set(this.currentObservables);
    resetChatter(this.chatter, this.currentObservables);
  }

  private indexNetlist(): void {
    let lampCarried = 0;
    for (let i = 0; i < this.netlist.elements.length; i++) {
      const element = this.netlist.elements[i];
      if (element === undefined) continue;
      if (element.k === 'lamp') {
        const section = Number(element.id.slice(3)) - 1;
        if (element.id.startsWith('out')) {
          this.outElement[section] = i;
          this.outCarried[section] = lampCarried;
        } else {
          this.indElement[section] = i;
          this.indCarried[section] = lampCarried;
        }
        lampCarried++;
      } else if (element.k === 'coil') {
        this.coilElement[element.relay - 1] = i;
      } else if (element.k === 'res' && element.drives === 'dial') {
        this.motorElement = i;
        this.motorA = terminalIndex(element.a);
        this.motorB = terminalIndex(element.b);
      }
    }
    for (let i = 0; i < this.netlist.contacts.length; i++) {
      const row = this.netlist.contacts[i] as NetContact;
      if (row.k === 'relay') {
        if (row.set === 1) this.relaySet1Row[row.n - 1] = i;
        else this.relaySet2Row[row.n - 1] = i;
      } else if (row.k === 'button') this.buttonRow[row.n - 1] = i;
      else if (row.k === 'slide') {
        if (row.set === 1) this.switchSet1Row[row.n - 1] = i;
        else this.switchSet2Row[row.n - 1] = i;
      }
    }
    this.plusTerminal = terminalIndex(this.netlist.plusMembers[0] as TerminalId);
    if (lampCarried !== LAMPS || this.motorElement < 0 || this.plusTerminal < 0) {
      throw new Error('machine: validated netlist indexes are incomplete');
    }
  }

  private indexHoles(): void {
    for (let hole = 0; hole < HOLE_COUNT; hole++) {
      const ref = holeByIndex(hole);
      this.holeIds[hole] = ref.id;
    }
  }

  apply(command: Command): CmdResult {
    if (command.k === 'connect' || command.k === 'disconnect') {
      const id = command.cord;
      if (!Number.isInteger(id) || id < 0 || id >= GRAPH_MAX_CORDS) return BAD_CORD_ID;
      if (command.k === 'connect') {
        if ((this.projected.live[id] as number) !== 0) return CORD_EXISTS;
        const invalidA = this.validateEnd(0, command.a);
        if (invalidA !== null) return invalidA;
        const invalidB = this.validateEnd(1, command.b);
        if (invalidB !== null) return invalidB;
        const resistance = command.r_uohm === undefined ? 0 : command.r_uohm;
        if (!Number.isInteger(resistance) || resistance < 0 || resistance > INT32_MAX) return BAD_TARGET;
        const aHole = this.validatedHole[0] as number;
        const bHole = this.validatedHole[1] as number;
        if (aHole >= 0 && (this.projected.holeOwner[aHole] as number) >= 0) return HOLE_OCCUPIED;
        if (bHole >= 0 && bHole === aHole) return HOLE_OCCUPIED;
        if (bHole >= 0 && (this.projected.holeOwner[bHole] as number) >= 0) return HOLE_OCCUPIED;

        this.setCord(
          this.projected,
          id,
          this.validatedKind[0] as number,
          this.validatedTerminal[0] as number,
          aHole,
          this.validatedKind[1] as number,
          this.validatedTerminal[1] as number,
          bHole,
          resistance,
        );
        this.commandStore.append(
          CMD_CONNECT,
          id,
          this.validatedKind[0] as number,
          this.validatedTerminal[0] as number,
          aHole,
          this.validatedKind[1] as number,
          this.validatedTerminal[1] as number,
          bHole,
          resistance,
        );
        return CMD_OK;
      }

      if ((this.projected.live[id] as number) === 0) return UNKNOWN_CORD;
      this.removeCord(this.projected, id);
      this.commandStore.append(CMD_DISCONNECT, id);
      return CMD_OK;
    }

    if (command.k === 'power') {
      if (typeof command.on !== 'boolean') return BAD_TARGET;
      this.commandStore.append(CMD_POWER, command.on ? 1 : 0);
      return CMD_OK;
    }
    if (command.k === 'breaker') {
      if (command.reset !== true) return BAD_TARGET;
      this.commandStore.append(CMD_BREAKER);
      return CMD_OK;
    }
    if (command.k === 'button' || command.k === 'switch' || command.k === 'relayGrab') {
      if (!Number.isInteger(command.n) || command.n < 1 || command.n > SECTIONS ||
          !Number.isInteger(command.target) || command.target < 0 || command.target > 1000) {
        return BAD_TARGET;
      }
      const tag = command.k === 'button' ? CMD_BUTTON
        : command.k === 'switch' ? CMD_SWITCH
          : CMD_RELAY_GRAB;
      this.commandStore.append(tag, command.n - 1, command.target);
      return CMD_OK;
    }
    if (command.k === 'relayRelease') {
      if (!Number.isInteger(command.n) || command.n < 1 || command.n > SECTIONS) return BAD_TARGET;
      this.commandStore.append(CMD_RELAY_RELEASE, command.n - 1);
      return CMD_OK;
    }
    if (command.k === 'dialGrab') {
      if (!Number.isInteger(command.targetUdeg) || command.targetUdeg < 0 || command.targetUdeg >= 360_000_000) {
        return BAD_TARGET;
      }
      this.commandStore.append(CMD_DIAL_GRAB, command.targetUdeg);
      return CMD_OK;
    }
    if (command.k === 'dialRelease') {
      this.commandStore.append(CMD_DIAL_RELEASE);
      return CMD_OK;
    }
    return BAD_TARGET;
  }

  advance(ticks: number): void {
    if (!Number.isInteger(ticks) || ticks < 0 || ticks > INT32_MAX) {
      throw new RangeError('machine: ticks must be an int32 in 0..2147483647');
    }
    if (ticks === 0) return;
    if (!this.queuedPowerRise() && this.tick > INT32_MAX - ticks) {
      throw new RangeError('machine: tick would exceed int32');
    }
    for (let i = 0; i < ticks; i++) this.advanceOne();
  }

  observables(): Int32Array {
    this.refreshObservableSource();
    return writeObservables(this.observableSource, this.publicObservables);
  }

  motionMask(): number {
    let mask = 0;
    for (let n = 0; n < SECTIONS; n++) {
      if ((this.relays.dir[n] as number) !== 0) mask |= 1 << n;
      if ((this.buttons.dir[n] as number) !== 0) mask |= 1 << (SECTIONS + n);
      if ((this.switches.dir[n] as number) !== 0) mask |= 1 << (SECTIONS * 2 + n);
    }
    return mask;
  }

  snapshot(): State {
    const relays: State['relays'] = [];
    const outLamps: State['outLamps'] = [];
    const indLamps: State['indLamps'] = [];
    const buttons: State['buttons'] = [];
    const switches: State['switches'] = [];
    for (let n = 0; n < SECTIONS; n++) {
      const set1 = this.contactAfter[this.relaySet1Row[n] as number] as number;
      const set2 = this.contactAfter[this.relaySet2Row[n] as number] as number;
      const button = this.contactAfter[this.buttonRow[n] as number] as number;
      const sw1 = this.contactAfter[this.switchSet1Row[n] as number] as number;
      const sw2 = this.contactAfter[this.switchSet2Row[n] as number] as number;
      const coilUa = this.relayCoilUa[n] as number;
      const pullInUa = this.profile.derived.relayPullInUa[n] as number;
      const dropOutUa = this.profile.derived.relayDropOutUa[n] as number;
      relays.push({
        travel: this.relays.travel[n] as number,
        coilMv: this.relayCoilMv[n] as number,
        coilUa,
        pullInUa,
        dropOutUa,
        band: relayBand(coilUa, pullInUa, dropOutUa),
        coilShorted: (this.relayCoilShorted[n] as number) !== 0,
        set1: { nc: set1 === CONTACT_NC, no: set1 === CONTACT_NO },
        set2: { nc: set2 === CONTACT_NC, no: set2 === CONTACT_NO },
        indicatorUa: this.relayIndicatorUa[n] as number,
        held: (this.relayHeld[n] as number) !== 0,
      });
      outLamps.push({
        ua: this.outLampUa[n] as number,
        milli: this.outLampMilli[n] as number,
        cls: classFromCode(this.outLampClass[n] as number),
      });
      indLamps.push({
        ua: this.indLampUa[n] as number,
        milli: this.indLampMilli[n] as number,
        cls: classFromCode(this.indLampClass[n] as number),
      });
      buttons.push({
        travel: this.buttons.travel[n] as number,
        nc: button === CONTACT_NC,
        no: button === CONTACT_NO,
      });
      switches.push({
        travel: this.switches.travel[n] as number,
        set1: closedPair(sw1),
        set2: closedPair(sw2),
      });
    }

    const cords: State['cords'] = [];
    for (let id = 0; id < GRAPH_MAX_CORDS; id++) {
      if ((this.actual.live[id] as number) === 0) continue;
      cords.push({
        id,
        a: this.materializeEnd(
          this.actual.aKind[id] as number,
          this.actual.aTerminal[id] as number,
          this.actual.aHole[id] as number,
        ),
        b: this.materializeEnd(
          this.actual.bKind[id] as number,
          this.actual.bTerminal[id] as number,
          this.actual.bHole[id] as number,
        ),
        r_uohm: this.actual.rUohm[id] as number,
      });
    }

    const terminalMv: (number | null)[] = [];
    for (let i = 0; i < GRAPH_TERMINALS; i++) {
      terminalMv.push((this.terminalFloating[i] as number) !== 0 ? null : this.terminalMv[i] as number);
    }
    const chattering: ChatterDev[] = [];
    for (let i = 0; i < CHATTER_DEVICES.length; i++) {
      if ((this.chatter.suppressed[i] as number) !== 0) chattering.push(CHATTER_DEVICES[i]!);
    }

    return {
      contract: CONTRACT,
      netlistHash: this.netlistHash,
      profileId: this.profile.id,
      profileHash: this.profileHash,
      tick: this.tick,
      power: this.power,
      breakerTripped: this.breaker.tripped,
      railMv: this.railMv,
      supplyUa: this.supplyUa,
      relays,
      outLamps,
      indLamps,
      buttons,
      switches,
      dial: {
        udeg: this.rotary.udeg,
        contact: this.rotary.contact,
        mrpm: this.rotary.mrpm,
        held: this.rotary.held,
      },
      cords,
      terminalMv,
      notes: this.materializeNotes(),
      flags: { chattering, overCurrent: this.overCurrent, nonPortable: this.flags.nonPortable },
    };
  }

  drainEvents(): Event[] {
    const events: Event[] = [];
    let page = this.eventStore.head;
    while (page !== null) {
      for (let i = 0; i < page.end; i++) {
        const tag = page.tag[i] as number;
        const t = page.f0[i] as number;
        if (tag === EV_POWER_ON) events.push({ t, k: 'power.on' });
        else if (tag === EV_POWER_OFF) events.push({ t, k: 'power.off' });
        else if (tag === EV_BREAKER_TRIP) events.push({ t, k: 'breaker.trip' });
        else if (tag === EV_BREAKER_RESET) events.push({ t, k: 'breaker.reset' });
        else if (tag === EV_RELAY_PULL || tag === EV_RELAY_DROP) {
          events.push({
            t,
            k: tag === EV_RELAY_PULL ? 'relay.pullIn' : 'relay.dropOut',
            n: asSect(page.f1[i] as number),
            coilUa: page.f2[i] as number,
            marginUa: page.f3[i] as number,
          });
        } else if (tag === EV_CONTACT_MAKE || tag === EV_CONTACT_BREAK) {
          events.push({
            t,
            k: tag === EV_CONTACT_MAKE ? 'contact.make' : 'contact.break',
            arm: TERMINAL_IDS[page.f1[i] as number] as TerminalId,
            to: TERMINAL_IDS[page.f2[i] as number] as TerminalId,
          });
        } else if (tag === EV_LAMP_ON || tag === EV_LAMP_OFF) {
          events.push({
            t,
            k: tag === EV_LAMP_ON ? 'lamp.on' : 'lamp.off',
            kind: (page.f1[i] as number) === 0 ? 'out' : 'ind',
            n: asSect(page.f2[i] as number),
          });
        } else if (tag === EV_DIAL_MAKE || tag === EV_DIAL_BREAK) {
          events.push({
            t,
            k: tag === EV_DIAL_MAKE ? 'dial.make' : 'dial.break',
            pos: page.f1[i] as number,
          });
        } else if (tag === EV_CHATTER) {
          events.push({
            t,
            k: 'chatter',
            dev: CHATTER_DEVICES[page.f1[i] as number] as ChatterDev,
            transitions: page.f2[i] as number,
            windowTicks: page.f3[i] as number,
            quietTicks: page.f4[i] as number,
          });
        }
      }
      page = page.next;
    }
    this.eventStore.clear();
    return events;
  }

  private validateEnd(at: number, end: CordEnd): CmdResult | null {
    this.validatedKind[at] = END_FREE;
    this.validatedTerminal[at] = -1;
    this.validatedHole[at] = -1;
    if (end.k === 'free') return null;
    if (end.k === 'hole') {
      try {
        const ref = parseHoleId(end.hole);
        this.validatedKind[at] = END_HOLE;
        this.validatedTerminal[at] = terminalIndex(ref.terminal);
        this.validatedHole[at] = ref.index;
        return null;
      } catch {
        return UNKNOWN_HOLE;
      }
    }
    if (end.k === 'touch') {
      try {
        const terminal = parseTerminalId(end.term);
        this.validatedKind[at] = END_TOUCH;
        this.validatedTerminal[at] = terminalIndex(terminal);
        return null;
      } catch {
        return UNKNOWN_TERMINAL;
      }
    }
    return BAD_TARGET;
  }

  private setCord(
    table: CordTable,
    id: number,
    aKind: number,
    aTerminal: number,
    aHole: number,
    bKind: number,
    bTerminal: number,
    bHole: number,
    resistance: number,
  ): void {
    table.live[id] = 1;
    table.aKind[id] = aKind;
    table.aTerminal[id] = aTerminal;
    table.aHole[id] = aHole;
    table.bKind[id] = bKind;
    table.bTerminal[id] = bTerminal;
    table.bHole[id] = bHole;
    table.rUohm[id] = resistance;
    if (aHole >= 0) table.holeOwner[aHole] = id;
    if (bHole >= 0) table.holeOwner[bHole] = id;
  }

  private removeCord(table: CordTable, id: number): void {
    const aHole = table.aHole[id] as number;
    const bHole = table.bHole[id] as number;
    if (aHole >= 0) table.holeOwner[aHole] = -1;
    if (bHole >= 0) table.holeOwner[bHole] = -1;
    table.live[id] = 0;
    table.aKind[id] = END_FREE;
    table.aTerminal[id] = -1;
    table.aHole[id] = -1;
    table.bKind[id] = END_FREE;
    table.bTerminal[id] = -1;
    table.bHole[id] = -1;
    table.rUohm[id] = 0;
  }

  private materializeEnd(kind: number, terminal: number, hole: number): CordEnd {
    if (kind === END_HOLE) return { k: 'hole', hole: this.holeIds[hole] as HoleId };
    if (kind === END_TOUCH) return { k: 'touch', term: TERMINAL_IDS[terminal] as TerminalId };
    return { k: 'free' };
  }

  private queuedPowerRise(): boolean {
    let power = this.power;
    let rise = false;
    let page = this.commandStore.head;
    while (page !== null) {
      for (let i = 0; i < page.end; i++) {
        if ((page.tag[i] as number) !== CMD_POWER) continue;
        const next = (page.f0[i] as number) !== 0;
        if (!power && next) rise = true;
        power = next;
      }
      page = page.next;
    }
    return rise;
  }

  private applyQueuedCommands(): void {
    let page = this.commandStore.head;
    while (page !== null) {
      for (let i = 0; i < page.end; i++) {
        const tag = page.tag[i] as number;
        if (tag === CMD_POWER) {
          const next = (page.f0[i] as number) !== 0;
          if (next !== this.power) {
            if (next) this.beginPowerEpoch();
            else {
              this.power = false;
              clearBreakerDwell(this.breaker);
              this.eventStore.append(EV_POWER_OFF, this.tick);
            }
          }
        } else if (tag === CMD_BREAKER) {
          if (resetBreaker(this.breaker)) this.eventStore.append(EV_BREAKER_RESET, this.tick);
        } else if (tag === CMD_CONNECT) {
          this.setCord(
            this.actual,
            page.f0[i] as number,
            page.f1[i] as number,
            page.f2[i] as number,
            page.f3[i] as number,
            page.f4[i] as number,
            page.f5[i] as number,
            page.f6[i] as number,
            page.f7[i] as number,
          );
        } else if (tag === CMD_DISCONNECT) this.removeCord(this.actual, page.f0[i] as number);
        else if (tag === CMD_BUTTON) this.buttonTargets[page.f0[i] as number] = page.f1[i] as number;
        else if (tag === CMD_SWITCH) this.switchTargets[page.f0[i] as number] = page.f1[i] as number;
        else if (tag === CMD_RELAY_GRAB) {
          const n = page.f0[i] as number;
          this.relayHeld[n] = 1;
          this.relayTargets[n] = page.f1[i] as number;
        } else if (tag === CMD_RELAY_RELEASE) this.relayHeld[page.f0[i] as number] = 0;
        else if (tag === CMD_DIAL_GRAB) grabRotary(this.rotary, page.f0[i] as number);
        else if (tag === CMD_DIAL_RELEASE) releaseRotary(this.rotary);
      }
      page = page.next;
    }
    this.commandStore.clear();
  }

  private beginPowerEpoch(): void {
    this.eventStore.clear();
    this.dialEventStore.clear();
    this.tick = 0;
    this.lastDialReseedTick = -1;
    coldResetElectrical(
      this.relays,
      this.carried.iCoil,
      this.carried.rLamp,
      this.profile.v.R_cold_uohm * 1e-6,
      this.relayHeld,
      this.relayLastPhysicalDir,
    );
    this.steadyTicks = 0;
    this.clearNotes();
    this.outLampUa.fill(0);
    this.indLampUa.fill(0);
    this.outLampMilli.fill(0);
    this.indLampMilli.fill(0);
    this.outLampClass.fill(0);
    this.indLampClass.fill(0);
    this.power = true;
    this.writeContacts(this.contactAfter);
    this.refreshObservableSource();
    writeObservables(this.observableSource, this.currentObservables);
    this.previousObservables.set(this.currentObservables);
    resetChatter(this.chatter, this.currentObservables);
    this.eventStore.append(EV_POWER_ON, 0);
  }

  private advanceOne(): void {
    const latchedTrip = latchBreakerPending(this.breaker);
    this.applyQueuedCommands();
    if (applyLatchedBreakerTrip(this.breaker, latchedTrip)) {
      this.eventStore.append(EV_BREAKER_TRIP, this.tick);
    }

    this.writeContacts(this.contactBefore);
    this.contactAfter.set(this.contactBefore);
    for (let n = 0; n < SECTIONS; n++) {
      this.priorTravel[n] = this.relays.travel[n] as number;
      this.priorTravel[SECTIONS + n] = this.buttons.travel[n] as number;
      this.priorTravel[SECTIONS * 2 + n] = this.switches.travel[n] as number;
      this.beforeLampClass[n] = this.outLampClass[n] as number;
      this.beforeLampClass[SECTIONS + n] = this.indLampClass[n] as number;
    }
    this.priorDialContact = this.rotary.contact;

    this.rebuildCordView();
    const enabled = sourceEnabled(this.power, this.breaker);
    buildGraphInto(
      this.netlist,
      this.profile,
      this.graphInput,
      enabled,
      this.graph,
    );
    tickSolveGraphInto(this.graph, this.carried, this.cfg, this.solve);
    if (this.solve.nonPortable) this.flags.nonPortable = true;
    this.quantizeElectrical(enabled);
    this.overCurrent = sampleBreaker(
      this.breaker,
      enabled,
      this.supplyUa,
      this.profile.v.I_trip_ua,
      this.profile.derived.deadShortUa,
      this.profile.derived.tripDelayTicks,
    );

    const motorMv = enabled && this.motorElement >= 0 &&
      (this.solve.floating[(this.graph.elements[this.motorElement] as { a: number }).a] as number) === 0 &&
      (this.solve.floating[(this.graph.elements[this.motorElement] as { b: number }).b] as number) === 0
      ? this.elementMv[this.motorElement] as number
      : enabled ? null : 0;
    const stopShorted = (this.graph.nodeByTerminal[this.motorA] as number) ===
      (this.graph.nodeByTerminal[this.motorB] as number);
    const priorMotorMrpm = this.rotary.lastMotorMrpm;
    // A mover mid-stroke may be about to short STOP; stepRotary then waits to pick the coast.
    const moversInTransit = this.motionMask() !== 0;
    stepRotary(this.rotary, motorMv, enabled, stopShorted, moversInTransit, this.profile, this.flags, this.rotarySink);
    // Architecture §9.2: a coast to zero drive is a modelled discontinuity, so the dial's chatter history
    // is reseeded. A drive-sign reversal (immediate, or resumed after a TRANSFER-COAST-DEFER hold) is one
    // too, but is forgiven at most once per dial chatter window and never while the dial is suppressed:
    // repeated reversals are what a hunting oscillation is made of, and must still trip the detector.
    const dial = CHATTER_DEVICE_COUNT - 1;
    const dialCoast = priorMotorMrpm !== 0 && this.rotary.lastMotorMrpm === 0;
    const dialReversal = priorMotorMrpm !== 0 && this.rotary.lastMotorMrpm !== 0 &&
      (this.rotary.lastMotorMrpm < 0) !== (priorMotorMrpm < 0) &&
      (this.lastDialReseedTick < 0 ||
        this.tick - this.lastDialReseedTick >= (this.chatter.windowTicks[dial] as number)) &&
      (this.chatter.suppressed[dial] as number) === 0;
    const dialReseed = dialCoast || dialReversal;
    if (dialReseed) this.lastDialReseedTick = this.tick;

    for (let n = 0; n < SECTIONS; n++) {
      if ((this.relayHeld[n] as number) !== 0) {
        const target = this.relayTargets[n] as number;
        const ticks = target < (this.relays.travel[n] as number)
          ? this.profile.derived.relayReleaseTicks
          : this.profile.derived.relayOperateTicks;
        advanceTargetMover(this.relays, n, target, ticks);
        this.relayDirection[n] = RELAY_NO_EVENT;
      } else {
        const event = advanceRelay(
          this.relays,
          n,
          this.relayCoilUa[n] as number,
          this.profile.derived.relayPullInUa[n] as number,
          this.profile.derived.relayDropOutUa[n] as number,
          this.profile.derived.relayOperateTicks,
          this.profile.derived.relayReleaseTicks,
          (this.relayHeldPriorTick[n] as number) !== 0
            ? this.relayLastPhysicalDir[n] as -1 | 0 | 1
            : 0,
        );
        this.relayDirection[n] = (this.relayHeldPriorTick[n] as number) !== 0
          ? RELAY_NO_EVENT
          : event;
      }
      const delta = (this.relays.travel[n] as number) - (this.priorTravel[n] as number);
      if (delta !== 0) this.relayLastPhysicalDir[n] = delta > 0 ? 1 : -1;
    }
    for (let n = 0; n < SECTIONS; n++) {
      advanceTargetMover(this.buttons, n, this.buttonTargets[n] as number, this.profile.derived.pushbuttonTicks);
    }
    for (let n = 0; n < SECTIONS; n++) {
      advanceTargetMover(this.switches, n, this.switchTargets[n] as number, this.profile.derived.slideTicks);
    }

    this.writeContacts(this.contactAfter);
    this.emitMoverEvents();
    this.dialEventStore.copyInto(this.eventStore);
    this.emitLampEvents();
    this.finishObservablesAndNotes(dialReseed);
    this.relayHeldPriorTick.set(this.relayHeld);
    this.tick++;
  }

  private writeContacts(out: Int8Array): void {
    writeContactPositions(
      this.netlist,
      this.relays,
      this.buttons,
      this.switches,
      this.rotary.contact,
      this.profile.v.break_milli,
      this.profile.v.make_milli,
      out,
    );
  }

  private rebuildCordView(): void {
    let at = 0;
    for (let id = 0; id < GRAPH_MAX_CORDS; id++) {
      if ((this.actual.live[id] as number) === 0) continue;
      const slot = this.cords[at] as MutableCord;
      slot.id = id;
      slot.a = this.actual.aTerminal[id] as number;
      slot.b = this.actual.bTerminal[id] as number;
      slot.rUohm = this.actual.rUohm[id] as number;
      at++;
    }
    this.cords.length = at;
  }

  private quantizeElectrical(enabled: boolean): void {
    for (let node = 0; node < this.graph.nodeCount; node++) {
      if (node === this.graph.datum) this.nodeMv[node] = 0;
      else if ((this.solve.floating[node] as number) !== 0) this.nodeMv[node] = 0;
      else this.nodeMv[node] = quantize(this.solve.v[node] as number, 1000, this.flags);
    }
    for (let element = 0; element < this.graph.elementCount; element++) {
      if (!enabled) {
        this.elementMv[element] = 0;
        this.elementAbsMv[element] = 0;
        continue;
      }
      const el = this.graph.elements[element] as { a: number; b: number };
      if ((this.solve.floating[el.a] as number) !== 0 || (this.solve.floating[el.b] as number) !== 0) {
        this.elementMv[element] = 0;
        this.elementAbsMv[element] = 0;
      } else {
        const branchV = (this.solve.v[el.a] as number) - (this.solve.v[el.b] as number);
        this.elementMv[element] = quantize(branchV, 1000, this.flags);
        this.elementAbsMv[element] = quantize(Math.abs(branchV), 1000, this.flags);
      }
    }

    for (let terminal = 0; terminal < GRAPH_TERMINALS; terminal++) {
      const node = this.graph.nodeByTerminal[terminal] as number;
      if (node === this.graph.datum) {
        this.terminalMv[terminal] = 0;
        this.terminalFloating[terminal] = 0;
      } else if ((this.solve.floating[node] as number) !== 0) {
        this.terminalMv[terminal] = 0;
        this.terminalFloating[terminal] = 1;
      } else {
        this.terminalMv[terminal] = this.nodeMv[node] as number;
        this.terminalFloating[terminal] = 0;
      }
    }

    if (!enabled) {
      this.railMv = 0;
      this.supplyUa = 0;
    } else {
      const plusNode = this.graph.nodeByTerminal[this.plusTerminal] as number;
      this.railMv = quantize(this.solve.v[plusNode] as number, 1000, this.flags);
      this.supplyUa = quantize(
        Math.abs(this.solve.branchI[this.graph.elementCount - 1] as number),
        1_000_000,
        this.flags,
      );
    }

    for (let n = 0; n < SECTIONS; n++) {
      const coil = this.coilElement[n] as number;
      const indicator = this.indElement[n] as number;
      const out = this.outElement[n] as number;
      const coilDef = this.graph.elements[coil] as { a: number; b: number };
      this.relayCoilMv[n] = this.elementAbsMv[coil] as number;
      this.relayCoilUa[n] = enabled
        ? quantize(Math.abs(this.solve.branchI[coil] as number), 1_000_000, this.flags)
        : 0;
      this.relayIndicatorUa[n] = enabled
        ? quantize(Math.abs(this.solve.branchI[indicator] as number), 1_000_000, this.flags)
        : 0;
      this.relayCoilShorted[n] = coilDef.a === coilDef.b ? 1 : 0;
      this.outLampUa[n] = enabled
        ? quantize(Math.abs(this.solve.branchI[out] as number), 1_000_000, this.flags)
        : 0;
      this.indLampUa[n] = this.relayIndicatorUa[n] as number;
      const outMilli = lampBrightnessMilli(
        this.carried.rLamp[this.outCarried[n] as number] as number,
        this.profile.v.R_cold_uohm * 1e-6,
        this.profile.v.R_hot_uohm * 1e-6,
      );
      const indMilli = lampBrightnessMilli(
        this.carried.rLamp[this.indCarried[n] as number] as number,
        this.profile.v.R_cold_uohm * 1e-6,
        this.profile.v.R_hot_uohm * 1e-6,
      );
      this.outLampMilli[n] = outMilli;
      this.indLampMilli[n] = indMilli;
      this.outLampClass[n] = classCode(lampClass(outMilli, this.profile.v.lamp_dim_milli, this.profile.v.lamp_on_milli));
      this.indLampClass[n] = classCode(lampClass(indMilli, this.profile.v.lamp_dim_milli, this.profile.v.lamp_on_milli));
    }
  }

  private emitMoverEvents(): void {
    for (let n = 0; n < SECTIONS; n++) {
      const direction = this.relayDirection[n] as RelayDirectionEvent;
      if (direction !== RELAY_NO_EVENT) {
        const coilUa = this.relayCoilUa[n] as number;
        const pull = this.profile.derived.relayPullInUa[n] as number;
        const drop = this.profile.derived.relayDropOutUa[n] as number;
        this.eventStore.append(
          direction === RELAY_PULL_IN ? EV_RELAY_PULL : EV_RELAY_DROP,
          this.tick,
          n,
          coilUa,
          relayMarginUa(direction, coilUa, pull, drop),
        );
      }
      this.emitContactRow(this.relaySet1Row[n] as number);
      this.emitContactRow(this.relaySet2Row[n] as number);
    }
    for (let n = 0; n < SECTIONS; n++) this.emitContactRow(this.buttonRow[n] as number);
    for (let n = 0; n < SECTIONS; n++) {
      this.emitContactRow(this.switchSet1Row[n] as number);
      this.emitContactRow(this.switchSet2Row[n] as number);
    }
  }

  private emitContactRow(index: number): void {
    const row = this.netlist.contacts[index] as NetContact;
    if (row.k === 'wiper') return;
    emitTransferEdges(
      row,
      this.contactBefore[index] as TransferPosition,
      this.contactAfter[index] as TransferPosition,
      this.contactSink,
    );
  }

  private recordContactEdge(edge: ContactEdge, arm: TerminalId, to: TerminalId): void {
    this.eventStore.append(
      edge === 'make' ? EV_CONTACT_MAKE : EV_CONTACT_BREAK,
      this.tick,
      terminalIndex(arm),
      terminalIndex(to),
    );
  }

  private recordRotaryEdge(kind: RotaryEdgeKind, pos: number): void {
    this.dialEventStore.append(kind === 'make' ? EV_DIAL_MAKE : EV_DIAL_BREAK, this.tick, pos);
  }

  private emitLampEvents(): void {
    for (let n = 0; n < SECTIONS; n++) {
      this.emitLampEvent(0, n, this.beforeLampClass[n] as number, this.outLampClass[n] as number);
    }
    for (let n = 0; n < SECTIONS; n++) {
      this.emitLampEvent(1, n, this.beforeLampClass[SECTIONS + n] as number, this.indLampClass[n] as number);
    }
  }

  private emitLampEvent(kind: number, n: number, before: number, after: number): void {
    const event = lampClassEvent(classFromCode(before), classFromCode(after));
    if (event === LAMP_NO_EVENT) return;
    this.eventStore.append(event === LAMP_OFF ? EV_LAMP_OFF : EV_LAMP_ON, this.tick, kind, n);
  }

  private refreshObservableSource(): void {
    this.observableSource.power = this.power;
    this.observableSource.breakerTripped = this.breaker.tripped;
    for (let n = 0; n < SECTIONS; n++) {
      const relay = this.observableSource.relays[n] as ObservableSource['relays'][number];
      const button = this.observableSource.buttons[n] as ObservableSource['buttons'][number];
      const sw = this.observableSource.switches[n] as ObservableSource['switches'][number];
      const relayPos = this.contactAfter[this.relaySet1Row[n] as number] as number;
      const buttonPos = this.contactAfter[this.buttonRow[n] as number] as number;
      const switchPos = this.contactAfter[this.switchSet1Row[n] as number] as number;
      relay.set1.nc = relayPos === CONTACT_NC;
      relay.set1.no = relayPos === CONTACT_NO;
      button.nc = buttonPos === CONTACT_NC;
      button.no = buttonPos === CONTACT_NO;
      const swSet = sw.set1 as [boolean, boolean];
      swSet[0] = switchPos === CONTACT_NC;
      swSet[1] = switchPos === CONTACT_NO;
      (this.observableSource.outLamps[n] as ObservableSource['outLamps'][number]).cls =
        classFromCode(this.outLampClass[n] as number);
      (this.observableSource.indLamps[n] as ObservableSource['indLamps'][number]).cls =
        classFromCode(this.indLampClass[n] as number);
    }
    this.observableSource.dial.contact = this.rotary.contact;
  }

  private finishObservablesAndNotes(dialReseed: boolean): void {
    this.refreshObservableSource();
    writeObservables(this.observableSource, this.currentObservables);
    if (dialReseed) reseedDialChatter(this.chatter, this.currentObservables);
    const chatterMask = updateChatter(this.tick, this.currentObservables, this.chatter);
    for (let device = 0; device < CHATTER_DEVICES.length; device++) {
      if ((chatterMask & (1 << device)) === 0) continue;
      this.eventStore.append(
        EV_CHATTER,
        this.tick,
        device,
        this.chatter.triggerTransitions,
        this.chatter.windowTicks[device] as number,
        this.chatter.quietTicks[device] as number,
      );
    }

    let quiet = this.rotary.mrpm === 0 && this.priorDialContact === this.rotary.contact;
    for (let n = 0; n < SECTIONS && quiet; n++) {
      if ((this.priorTravel[n] as number) !== (this.relays.travel[n] as number) ||
          (this.priorTravel[SECTIONS + n] as number) !== (this.buttons.travel[n] as number) ||
          (this.priorTravel[SECTIONS * 2 + n] as number) !== (this.switches.travel[n] as number)) {
        quiet = false;
      }
    }
    for (let i = 0; i < OBSERVABLE_COUNT && quiet; i++) {
      if ((this.previousObservables[i] as number) !== (this.currentObservables[i] as number)) quiet = false;
    }

    if (!quiet) {
      this.steadyTicks = 0;
      this.clearNotes();
    } else {
      if (this.steadyTicks < this.profile.v.settle_quiet_ticks) this.steadyTicks++;
      if (this.steadyTicks >= this.profile.v.settle_quiet_ticks) this.deriveNotes();
    }
    this.previousObservables.set(this.currentObservables);
  }

  private clearNotes(): void {
    this.noteCoil.fill(0);
    this.noteLamp.fill(0);
    this.noteLampMv.fill(0);
    this.noteDropCount.fill(0);
  }

  private deriveNotes(): void {
    this.clearNotes();
    if (!sourceEnabled(this.power, this.breaker)) return;
    for (let relay = 0; relay < SECTIONS; relay++) {
      const ua = this.relayCoilUa[relay] as number;
      const dropOut = this.profile.derived.relayDropOutUa[relay] as number;
      const pullIn = this.profile.derived.relayPullInUa[relay] as number;
      if ((this.relays.travel[relay] as number) !== 0 || ua <= dropOut || ua >= pullIn) continue;
      const coil = this.coilElement[relay] as number;
      const coilDef = this.graph.elements[coil] as { a: number; b: number };
      this.chainVisited.fill(0);
      this.chainVisited[coil] = 1;
      this.walkChain(coilDef.a, coil);
      this.walkChain(coilDef.b, coil);
      this.noteCoil[relay] = 1;
      const base = relay * NOTE_STRIDE;
      let count = 0;
      for (let element = 0; element < this.graph.elementCount; element++) {
        if ((this.chainVisited[element] as number) === 0 || element === coil ||
            element === this.graph.elementCount - 1) continue;
        const mv = this.elementAbsMv[element] as number;
        if (mv === 0) continue;
        // Every accepted chain edge carries this relay's same non-negative quantized coilUa.
        // Comparing mv therefore exactly orders the signed-64 mv*ua products without tick BigInt.
        let insert = count;
        while (insert > 0) {
          const priorMv = this.noteDropMv[base + insert - 1] as number;
          const priorElement = this.noteDropElement[base + insert - 1] as number;
          if (priorMv > mv || (priorMv === mv && priorElement < element)) break;
          this.noteDropMv[base + insert] = priorMv;
          this.noteDropElement[base + insert] = priorElement;
          insert--;
        }
        this.noteDropMv[base + insert] = mv;
        this.noteDropElement[base + insert] = element;
        count++;
      }
      this.noteDropCount[relay] = count;
      const indicator = this.indElement[relay] as number;
      if ((this.chainVisited[indicator] as number) !== 0 && (this.indLampUa[relay] as number) !== 0) {
        this.noteLamp[relay] = 1;
        this.noteLampMv[relay] = this.elementAbsMv[indicator] as number;
      }
    }
  }

  private walkChain(startNode: number, firstIncoming: number): void {
    let node = startNode;
    let incoming = firstIncoming;
    while (true) {
      let candidate = -1;
      let count = 0;
      for (let element = 0; element < this.graph.elementCount; element++) {
        if (element === incoming) continue;
        const edge = this.graph.elements[element] as { a: number; b: number };
        if (edge.a === edge.b || (edge.a !== node && edge.b !== node)) continue;
        candidate = element;
        count++;
        if (count > 1) break;
      }
      if (count !== 1) return;
      if ((this.chainVisited[candidate] as number) !== 0) return;
      this.chainVisited[candidate] = 1;
      if (candidate === this.graph.elementCount - 1) return;
      const edge = this.graph.elements[candidate] as { a: number; b: number };
      node = edge.a === node ? edge.b : edge.a;
      incoming = candidate;
    }
  }

  private materializeNotes(): Note[] {
    const notes: Note[] = [];
    for (let relay = 0; relay < SECTIONS; relay++) {
      if ((this.noteCoil[relay] as number) !== 0) {
        const drops: { el: string; mv: number }[] = [];
        const base = relay * NOTE_STRIDE;
        for (let i = 0; i < (this.noteDropCount[relay] as number); i++) {
          const element = this.noteDropElement[base + i] as number;
          drops.push({ el: this.graph.elementIds[element] as string, mv: this.noteDropMv[base + i] as number });
        }
        notes.push({
          k: 'coil-starved',
          relay: asSect(relay),
          coilUa: this.relayCoilUa[relay] as number,
          needsUa: this.profile.derived.relayPullInUa[relay] as number,
          drops,
        });
      }
      if ((this.noteLamp[relay] as number) !== 0) {
        notes.push({ k: 'lamp-in-coil-path', relay: asSect(relay), lampMv: this.noteLampMv[relay] as number });
      }
    }
    return notes;
  }
}

/** Construct one filesystem-free machine from a netlist and profile already loaded by `loadNetlist` and `loadProfile`. */
export function createMachine(netlist: LoadedNetlist, profile: Profile): Machine {
  return new MachineImpl(netlist, profile);
}
