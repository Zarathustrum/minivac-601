import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';
import type { Command, CordEnd, Event, Machine, State } from '../../src/core/contract.ts';
import { breakerOverThreshold } from '../../src/core/devices.ts';
import { quantize } from '../../src/core/ints.ts';
import { createMachine } from '../../src/core/machine.ts';
import { loadNetlist } from '../../src/core/netlist.ts';
import { loadProfile } from '../../src/core/profile.ts';
import type { Profile } from '../../src/core/profile.ts';
import { tickSolve } from '../../src/core/solve.ts';
import type { Carried, El, SolveCfg } from '../../src/core/solve.ts';
import {
  allocateHoles,
  parseHoleId,
  parseTerminalId,
  parseTerminalWire,
  terminalIndex,
} from '../../src/core/terminals.ts';
import { REPO_ROOT, loadFixture } from './helpers.ts';
import type { LoadedFixture, ScriptStep } from './types.ts';
import type {
  BoolRead,
  CheckResult,
  CheckpointAddress,
  EventSelector,
  LoadedProbe,
  MachineCase,
  MachineCheckpointState,
  MachineNumericRead,
  NumericOperand,
  NumericRead,
  ProbeAction,
  ProbeCase,
  ProbeCaseResult,
  ProbeCheck,
  ProbeDocument,
  ProbeProfileId,
  ProbeResult,
  ProfileLoad,
  ProfileLoadCase,
  ProfileLoadState,
  ProfileNumericRead,
} from './probe-types.ts';

const fixtureSchema = readProbeJson(new URL('./fixture.schema.json', import.meta.url), 'fixture schema');
const probeSchema = readProbeJson(new URL('./probe.schema.json', import.meta.url), 'probe schema');
const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(fixtureSchema as AnySchema, 'minivac.probe/minivac.fixture/1');
const validateProbe: ValidateFunction = ajv.compile(probeSchema as AnySchema);

const MACHINE_READ_KINDS = ['state', 'relay', 'lamp', 'terminalPairMv', 'profile'] as const;
const PROFILE_READ_KINDS = ['load', 'profile', 'relayThreshold'] as const;

function fail(message: string): never {
  throw new Error('probe: ' + message);
}

function readProbeJson(path: string | URL, where: string): unknown {
  const bytes = new Uint8Array(readFileSync(path));
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail(where + ' has a UTF-8 BOM');
  }
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 0x0d) fail(where + ' contains CR at byte ' + i);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(where + ' is not valid UTF-8');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail(where + ' is not valid JSON');
  }
}

function renderAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (errors === null || errors === undefined) return 'unknown schema error';
  return errors.map((error) => (error.instancePath || '/') + ' ' + error.message).join('; ');
}

function validateUnicodeScalars(text: string, where: string): void {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
      if (low < 0xdc00 || low > 0xdfff) fail(where + ' contains an unpaired high surrogate');
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(where + ' contains an unpaired low surrogate');
    }
  }
}

function includesKind(kinds: readonly string[], kind: string): boolean {
  for (const candidate of kinds) if (candidate === kind) return true;
  return false;
}

function readsOf(check: ProbeCheck): NumericRead[] {
  if (check.k === 'near') return [check.read];
  if (check.k !== 'compare') return [];
  return check.right.k === 'literal' ? [check.left] : [check.left, check.right];
}

function validateCheckScope(check: ProbeCheck, machine: boolean, where: string): void {
  if (!machine && (check.k === 'bool' || check.k === 'eventSeen')) {
    fail(where + ' profileLoad checks cannot read Machine booleans or events');
  }
  for (const read of readsOf(check)) {
    const legal = machine
      ? includesKind(MACHINE_READ_KINDS, read.k)
      : includesKind(PROFILE_READ_KINDS, read.k);
    if (!legal) fail(where + ' uses ' + read.k + ' in the wrong execution scope');
    if (read.k === 'terminalPairMv') {
      try {
        parseTerminalId(read.a);
        parseTerminalId(read.b);
      } catch (error: unknown) {
        fail(where + ' has a non-physical terminal-pair read: ' + String(error));
      }
    }
  }
}

function validateUniqueNames(items: readonly { name: string }[], where: string): void {
  const seen: string[] = [];
  for (const item of items) {
    if (seen.includes(item.name)) fail(where + ' has duplicate name ' + JSON.stringify(item.name));
    seen.push(item.name);
  }
}

function addressIndex(address: CheckpointAddress): number {
  return address.k === 'fixtureStep' ? address.scriptIndex : address.actionIndex;
}

function validateCommandSemantics(command: Command, where: string): void {
  if (command.k !== 'connect') return;
  const ends: CordEnd[] = [command.a, command.b];
  for (let i = 0; i < ends.length; i++) {
    const end = ends[i] as CordEnd;
    try {
      if (end.k === 'hole') parseHoleId(end.hole);
      else if (end.k === 'touch') parseTerminalId(end.term);
    } catch (error: unknown) {
      fail(where + '.end[' + i + '] is not physical: ' + String(error));
    }
  }
}

function validateMachineCase(row: MachineCase, fixtureRoot: string, where: string): void {
  validateUniqueNames(row.checkpoints, where + '.checkpoints');
  let last = -1;
  for (let i = 0; i < row.checkpoints.length; i++) {
    const checkpoint = row.checkpoints[i] as MachineCase['checkpoints'][number];
    const index = addressIndex(checkpoint.at);
    if (index <= last) fail(where + '.checkpoints must use strictly increasing source indexes');
    last = index;
    validateUniqueNames(checkpoint.checks, where + '.checkpoints[' + i + '].checks');
    for (let j = 0; j < checkpoint.checks.length; j++) {
      validateCheckScope(checkpoint.checks[j] as ProbeCheck, true, where + '.checkpoints[' + i + '].checks[' + j + ']');
    }
  }

  if (row.source.k === 'fixture') {
    for (const checkpoint of row.checkpoints) {
      if (checkpoint.at.k !== 'fixtureStep') fail(where + ' fixture source requires fixtureStep checkpoints');
    }
    const loaded = loadFixture(resolve(fixtureRoot, row.source.fixture + '.fixture.json'));
    for (const checkpoint of row.checkpoints) {
      const at = checkpoint.at;
      if (at.k !== 'fixtureStep') continue;
      const step = loaded.fixture.script[at.scriptIndex];
      if (step === undefined) fail(where + ' checkpoint scriptIndex is outside fixture ' + row.source.fixture);
      if (step.k !== at.stepKind) {
        fail(where + ' checkpoint expected script[' + at.scriptIndex + ']=' + at.stepKind + ', got ' + step.k);
      }
    }
  } else {
    for (let i = 0; i < row.source.wires.length; i++) {
      try {
        parseTerminalWire(row.source.wires[i] as string);
      } catch (error: unknown) {
        fail(where + '.source.wires[' + i + '] is not physical: ' + String(error));
      }
    }
    try {
      allocateHoles(row.source.wires.map((wire) => parseTerminalWire(wire)));
    } catch (error: unknown) {
      fail(where + '.source.wires cannot allocate holes: ' + String(error));
    }
    for (let i = 0; i < row.source.actions.length; i++) {
      const action = row.source.actions[i] as ProbeAction;
      if (action.k === 'do') validateCommandSemantics(action.cmd, where + '.source.actions[' + i + '].cmd');
    }
    for (const checkpoint of row.checkpoints) {
      const at = checkpoint.at;
      if (at.k !== 'action') fail(where + ' scenario source requires action checkpoints');
      const action = row.source.actions[at.actionIndex];
      if (action === undefined) fail(where + ' checkpoint actionIndex is outside scenario');
      if (action.k !== at.actionKind) {
        fail(where + ' checkpoint expected action[' + at.actionIndex + ']=' + at.actionKind + ', got ' + action.k);
      }
    }
  }
}

function validateProfileCase(row: ProfileLoadCase, where: string): void {
  if (row.load.feed === 'C' && row.load.indicatorLamps !== 'series-with-coils') {
    fail(where + ' C feed requires series-with-coils indicator lamps');
  }
  if (row.load.feed === 'E' && row.load.indicatorLamps !== 'across-rail') {
    fail(where + ' E feed requires across-rail indicator lamps');
  }
  validateUniqueNames(row.checks, where + '.checks');
  for (let i = 0; i < row.checks.length; i++) {
    validateCheckScope(row.checks[i] as ProbeCheck, false, where + '.checks[' + i + ']');
  }
}

export function loadProbe(path: string, fixtureRoot = resolve(REPO_ROOT, 'test/conformance/fixtures/A')): LoadedProbe {
  const raw = readProbeJson(path, path);
  if (!validateProbe(raw)) fail('schema validation failed: ' + renderAjvErrors(validateProbe.errors));
  const probe = raw as ProbeDocument;
  validateUnicodeScalars(probe.source, 'source');
  for (let i = 0; i < (probe.modeledSubstitutions?.length ?? 0); i++) {
    const row = probe.modeledSubstitutions?.[i];
    if (row !== undefined) {
      validateUnicodeScalars(row.claim, 'modeledSubstitutions[' + i + '].claim');
      validateUnicodeScalars(row.model, 'modeledSubstitutions[' + i + '].model');
    }
  }
  validateUniqueNames(probe.cases, 'cases');
  for (let i = 0; i < probe.cases.length; i++) {
    const row = probe.cases[i] as ProbeCase;
    if (row.k === 'machine') validateMachineCase(row, fixtureRoot, 'cases[' + i + ']');
    else validateProfileCase(row, 'cases[' + i + ']');
  }
  return { path, probe };
}

function loadAssets(profileId: ProbeProfileId): { profile: Profile; netlist: ReturnType<typeof loadNetlist> } {
  const profile = loadProfile(readProbeJson(
    resolve(REPO_ROOT, 'data/profiles/' + profileId + '.json'),
    profileId + ' profile',
  ));
  const netlist = loadNetlist(new Uint8Array(readFileSync(resolve(REPO_ROOT, 'data/netlist.json'))));
  return { profile, netlist };
}

function applyInitial(machine: Machine, cords: ReturnType<typeof allocateHoles>): void {
  for (const cord of cords) {
    const result = machine.apply({
      k: 'connect', cord: cord.wireIndex,
      a: { k: 'hole', hole: cord.a.id }, b: { k: 'hole', hole: cord.b.id },
    });
    if (!result.ok) fail('initial wire ' + cord.wireIndex + ' rejected: ' + result.why);
  }
}

function drain(machine: Machine, events: Event[]): void {
  events.push(...machine.drainEvents());
}

export function assertProbePortable(state: Pick<State, 'flags'>): void {
  if (state.flags.nonPortable) fail('Machine marked probe non-portable');
}

function advance(machine: Machine, ticks: number, events: Event[]): void {
  machine.advance(ticks);
  drain(machine, events);
  assertProbePortable(machine.snapshot());
}

function sameVector(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function settleMachine(machine: Machine, maxTicks: number, quietTicks: number, events: Event[]): void {
  let previous = Int32Array.from(machine.observables());
  let quiet = 0;
  for (let waited = 1; waited <= maxTicks; waited++) {
    machine.advance(1);
    drain(machine, events);
    const after = machine.observables();
    if (sameVector(previous, after) && machine.motionMask() === 0) quiet++;
    else quiet = 0;
    previous = Int32Array.from(after);
    const state = machine.snapshot();
    assertProbePortable(state);
    if (quiet >= quietTicks) return;
  }
  fail('settle exhausted its cap of ' + maxTicks + ' ticks');
}

function executeAction(machine: Machine, action: ProbeAction, profile: Profile, events: Event[]): void {
  if (action.k === 'do') {
    const result = machine.apply(action.cmd);
    if (!result.ok) fail('scenario command rejected: ' + result.why);
  } else if (action.k === 'advance') advance(machine, action.ticks, events);
  else settleMachine(machine, action.maxTicks, profile.v.settle_quiet_ticks, events);
}

function executeFixtureStep(machine: Machine, step: ScriptStep, profile: Profile, events: Event[]): void {
  if (step.k === 'do') {
    const result = machine.apply(step.cmd);
    if (!result.ok) fail('fixture command rejected: ' + result.why);
  } else if (step.k === 'advance') advance(machine, step.ms * 10, events);
  else if (step.k === 'settle') settleMachine(machine, step.maxMs * 10, profile.v.settle_quiet_ticks, events);
  else if (step.k === 'until') fail('fixture replay does not support until steps');
}

function runMachineCase(
  row: MachineCase,
  profileId: ProbeProfileId,
  fixtureRoot: string,
): ProbeCaseResult {
  let profile: Profile;
  let machine: Machine;
  let steps: readonly (ProbeAction | ScriptStep)[];
  if (row.source.k === 'fixture') {
    const loaded: LoadedFixture = loadFixture(resolve(fixtureRoot, row.source.fixture + '.fixture.json'));
    if (loaded.fixture.profile !== profileId) fail(row.name + ' fixture profile differs from probe profile');
    profile = loaded.profile;
    machine = createMachine(loaded.netlist, profile);
    applyInitial(machine, loaded.cords as ReturnType<typeof allocateHoles>);
    steps = loaded.fixture.script;
  } else {
    const assets = loadAssets(profileId);
    profile = assets.profile;
    machine = createMachine(assets.netlist, profile);
    const wires = row.source.wires.map((wire) => parseTerminalWire(wire));
    applyInitial(machine, allocateHoles(wires));
    steps = row.source.actions;
  }

  const events: Event[] = [];
  const checkpoints = [];
  let checkpointIndex = 0;
  const last = addressIndex((row.checkpoints.at(-1) as MachineCase['checkpoints'][number]).at);
  for (let i = 0; i <= last; i++) {
    const step = steps[i];
    if (step === undefined) fail(row.name + ' source ended before checkpoint');
    if (row.source.k === 'fixture') executeFixtureStep(machine, step as ScriptStep, profile, events);
    else executeAction(machine, step as ProbeAction, profile, events);
    const checkpoint = row.checkpoints[checkpointIndex];
    if (checkpoint !== undefined && addressIndex(checkpoint.at) === i) {
      const state = machine.snapshot();
      assertProbePortable(state);
      const context: MachineCheckpointState = {
        state,
        events,
        profile: {
          ITripUa: profile.v.I_trip_ua,
          tripDelayTicks: profile.derived.tripDelayTicks,
          pullInUa: profile.derived.pullInUa,
          dropOutUa: profile.derived.dropOutUa,
        },
      };
      checkpoints.push({
        name: checkpoint.name,
        at: checkpoint.at,
        checks: checkpoint.checks.map((check) => evaluateMachineCheck(check, context)),
      });
      checkpointIndex++;
    }
  }
  return { k: 'machine', name: row.name, checkpoints };
}

function eventCount(events: readonly Event[], selector: EventSelector): number {
  let count = 0;
  for (const event of events) {
    if (event.k !== selector.k) continue;
    if ('n' in selector && (!('n' in event) || event.n !== selector.n)) continue;
    count++;
  }
  return count;
}

function readMachineNumber(read: MachineNumericRead | Extract<ProfileNumericRead, { k: 'profile' }>, context: MachineCheckpointState): number {
  const state = context.state;
  if (read.k === 'profile') return context.profile[read.field];
  if (read.k === 'state') return state[read.field];
  if (read.k === 'relay') return state.relays[read.n - 1]?.[read.field] ?? fail('missing relay ' + read.n);
  if (read.k === 'lamp') {
    const lamp = (read.kind === 'out' ? state.outLamps : state.indLamps)[read.n - 1];
    if (lamp === undefined) fail('missing lamp ' + read.kind + read.n);
    return lamp[read.field];
  }
  const a = state.terminalMv[terminalIndex(parseTerminalId(read.a))];
  const b = state.terminalMv[terminalIndex(parseTerminalId(read.b))];
  if (a === null || b === null || a === undefined || b === undefined) {
    fail('terminalPairMv read is floating: ' + read.a + '/' + read.b);
  }
  const delta = a - b;
  return delta < 0 ? -delta : delta;
}

function readMachineBool(read: BoolRead, state: State): boolean {
  if (read.k === 'stateBool') return state.breakerTripped;
  return state.relays[read.n - 1]?.held ?? fail('missing relay ' + read.n);
}

function compare(left: number, op: 'lt' | 'le' | 'eq' | 'ge' | 'gt', right: number): boolean {
  if (op === 'lt') return left < right;
  if (op === 'le') return left <= right;
  if (op === 'eq') return left === right;
  if (op === 'ge') return left >= right;
  return left > right;
}

function near(actual: number, expected: number, tolerance: number): boolean {
  const delta = BigInt(actual) - BigInt(expected);
  const magnitude = delta < 0n ? -delta : delta;
  return magnitude <= BigInt(tolerance);
}

function machineOperand(operand: NumericOperand, context: MachineCheckpointState): number {
  if (operand.k === 'literal') return operand.value;
  return readMachineNumber(operand as MachineNumericRead, context);
}

function evaluateMachineCheck(check: ProbeCheck, context: MachineCheckpointState): CheckResult {
  if (check.k === 'near') {
    const actual = readMachineNumber(check.read as MachineNumericRead, context);
    return {
      k: check.k, name: check.name, actual, expected: check.expected, tolerance: check.tolerance,
      pass: near(actual, check.expected, check.tolerance),
    };
  }
  if (check.k === 'compare') {
    const left = readMachineNumber(check.left as MachineNumericRead, context);
    const right = machineOperand(check.right, context);
    return { k: check.k, name: check.name, left, op: check.op, right, pass: compare(left, check.op, right) };
  }
  if (check.k === 'bool') {
    const actual = readMachineBool(check.read, context.state);
    return { k: check.k, name: check.name, actual, expected: check.expected, pass: actual === check.expected };
  }
  const count = eventCount(context.events, check.event);
  return { k: check.k, name: check.name, count, expected: check.expected, pass: (count > 0) === check.expected };
}

function profileCircuit(load: ProfileLoad, profile: Profile): El[] {
  const minus = 0;
  const plus = 1;
  const rCoil = profile.v.R_coil_uohm * 1e-6;
  const lCoil = profile.v.L_coil_uh * 1e-6;
  const els: El[] = [];
  if (load.feed === 'C') {
    for (let n = 0; n < load.coils; n++) {
      const e = 2 + n;
      els.push({ k: 'lamp', a: plus, b: e });
      els.push({ k: 'coil', a: e, b: minus, rOhm: rCoil, lH: lCoil });
    }
  } else {
    for (let n = 0; n < load.coils; n++) els.push({ k: 'coil', a: plus, b: minus, rOhm: rCoil, lH: lCoil });
    for (let n = 0; n < load.coils; n++) els.push({ k: 'lamp', a: plus, b: minus });
  }
  for (let n = 0; n < load.outputLamps; n++) els.push({ k: 'lamp', a: plus, b: minus });
  els.push({ k: 'lamp', a: plus, b: minus });
  els.push({
    k: 'source', a: plus, b: minus,
    vOc: profile.v.V_oc_mv * 1e-3, rSrcOhm: profile.v.R_src_uohm * 1e-6,
  });
  return els;
}

function coldStart(els: readonly El[], profile: Profile): Carried {
  let coils = 0;
  let lamps = 0;
  for (const el of els) {
    if (el.k === 'coil') coils++;
    else if (el.k === 'lamp') lamps++;
  }
  return {
    iCoil: new Float64Array(coils),
    rLamp: new Float64Array(lamps).fill(profile.v.R_cold_uohm * 1e-6),
  };
}

function solveCfg(profile: Profile): SolveCfg {
  return {
    dtS: profile.v.tick_us * 1e-6,
    vArc: profile.v.V_arc_clamp_mv * 1e-3,
    kThermal: profile.derived.kThermal,
    gminS: profile.v.gmin_ns * 1e-9,
    pwl: {
      xs: profile.pwl.map((point) => point[0] * 1e-6),
      ys: profile.pwl.map((point) => point[1] * 1e-6),
    },
    datum: 0,
  };
}

function runProfileLoad(load: ProfileLoad, profile: Profile): ProfileLoadState {
  const els = profileCircuit(load, profile);
  const carried = coldStart(els, profile);
  const cfg = solveCfg(profile);
  const flags = { nonPortable: false };
  let previous: number[] | null = null;
  let quiet = 0;
  let settledSupplyUa = 0;
  let peakSupplyUa = 0;
  let ticksOverTrip = 0;
  let overRun = true;
  let settled = false;
  for (let tick = 0; tick < profile.derived.settleCapTicks; tick++) {
    const result = tickSolve(els, carried, cfg);
    if (result.nonPortable) flags.nonPortable = true;
    const currents: number[] = [];
    for (let i = 0; i < els.length; i++) {
      currents.push(quantize(Math.abs(result.branchI[i] as number), 1e6, flags));
    }
    settledSupplyUa = currents.at(-1) as number;
    if (settledSupplyUa > peakSupplyUa) peakSupplyUa = settledSupplyUa;
    if (overRun && breakerOverThreshold(settledSupplyUa, profile.v.I_trip_ua)) ticksOverTrip++;
    else overRun = false;
    let same = previous !== null && previous.length === currents.length;
    if (same && previous !== null) {
      for (let i = 0; i < currents.length; i++) if (previous[i] !== currents[i]) { same = false; break; }
    }
    if (same) quiet++;
    else {
      quiet = 0;
      previous = currents;
    }
    if (quiet >= profile.v.settle_quiet_ticks) {
      settled = true;
      break;
    }
  }
  if (flags.nonPortable) fail('profileLoad marked the solve non-portable');
  if (!settled) fail('profileLoad settle exhausted its profile cap');
  return {
    settledSupplyUa,
    peakSupplyUa,
    ticksOverTrip,
    ITripUa: profile.v.I_trip_ua,
    tripDelayTicks: profile.derived.tripDelayTicks,
    pullInUa: profile.derived.pullInUa,
    dropOutUa: profile.derived.dropOutUa,
    relayPullInUa: profile.derived.relayPullInUa,
    relayDropOutUa: profile.derived.relayDropOutUa,
  };
}

function readProfileNumber(read: ProfileNumericRead, state: ProfileLoadState): number {
  if (read.k === 'load') return state[read.field];
  if (read.k === 'profile') return state[read.field];
  const values = read.field === 'pullInUa' ? state.relayPullInUa : state.relayDropOutUa;
  return values[read.n - 1] ?? fail('missing relay threshold ' + read.n);
}

function profileOperand(operand: NumericOperand, state: ProfileLoadState): number {
  if (operand.k === 'literal') return operand.value;
  return readProfileNumber(operand as ProfileNumericRead, state);
}

function evaluateProfileCheck(check: ProbeCheck, state: ProfileLoadState): CheckResult {
  if (check.k === 'near') {
    const actual = readProfileNumber(check.read as ProfileNumericRead, state);
    return {
      k: check.k, name: check.name, actual, expected: check.expected, tolerance: check.tolerance,
      pass: near(actual, check.expected, check.tolerance),
    };
  }
  if (check.k !== 'compare') fail('profileLoad received a non-numeric check');
  const left = readProfileNumber(check.left as ProfileNumericRead, state);
  const right = profileOperand(check.right, state);
  return { k: check.k, name: check.name, left, op: check.op, right, pass: compare(left, check.op, right) };
}

function runProfileCase(row: ProfileLoadCase, profile: Profile): ProbeCaseResult {
  const state = runProfileLoad(row.load, profile);
  return {
    k: 'profileLoad',
    name: row.name,
    checks: row.checks.map((check) => evaluateProfileCheck(check, state)),
    diagnostic: row.diagnostic === true,
  };
}

function casePass(row: ProbeCaseResult): boolean {
  if (row.k === 'profileLoad') return row.checks.every((check) => check.pass);
  return row.checkpoints.every((checkpoint) => checkpoint.checks.every((check) => check.pass));
}

export function runLoadedProbe(
  loaded: LoadedProbe,
  fixtureRoot = resolve(REPO_ROOT, 'test/conformance/fixtures/A'),
): ProbeResult {
  const profile = loadAssets(loaded.probe.profile).profile;
  const cases: ProbeCaseResult[] = [];
  for (const row of loaded.probe.cases) {
    cases.push(row.k === 'machine'
      ? runMachineCase(row, loaded.probe.profile, fixtureRoot)
      : runProfileCase(row, profile));
  }
  return {
    schema: 'minivac.probe-result/1',
    id: loaded.probe.id,
    profile: loaded.probe.profile,
    cases,
    pass: cases.every(casePass),
  };
}

export function runProbe(
  path: string,
  fixtureRoot = resolve(REPO_ROOT, 'test/conformance/fixtures/A'),
): ProbeResult {
  return runLoadedProbe(loadProbe(path, fixtureRoot), fixtureRoot);
}
