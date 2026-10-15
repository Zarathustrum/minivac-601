import type { Command, Event, State } from '../../src/core/contract.ts';

export type ProbeId = 'AT-01' | 'AT-04' | 'AT-05' | 'AT-06' | 'AT-07' | 'AT-09' | 'AT-10' | 'AT-11';
export type ProbeProfileId = 'MV601-REF-A' | 'MV601-IDEAL';
export type StepKind = 'do' | 'advance' | 'settle' | 'expect';
export type ActionKind = 'do' | 'advance' | 'settle';

export type ProbeAction =
  | { k: 'do'; cmd: Command }
  | { k: 'advance'; ticks: number }
  | { k: 'settle'; maxTicks: number };

export type MachineSource =
  | { k: 'fixture'; fixture: string }
  | { k: 'scenario'; wires: string[]; actions: ProbeAction[] };

export type CheckpointAddress =
  | { k: 'fixtureStep'; scriptIndex: number; stepKind: StepKind }
  | { k: 'action'; actionIndex: number; actionKind: ActionKind };

export type MachineNumericRead =
  | { k: 'state'; field: 'railMv' | 'supplyUa' }
  | {
      k: 'relay';
      n: number;
      field: 'travel' | 'coilMv' | 'coilUa' | 'pullInUa' | 'dropOutUa' | 'indicatorUa';
    }
  | { k: 'lamp'; kind: 'out' | 'ind'; n: number; field: 'ua' | 'milli' }
  | { k: 'terminalPairMv'; a: string; b: string };

export type ProfileNumericRead =
  | { k: 'load'; field: 'settledSupplyUa' | 'peakSupplyUa' | 'ticksOverTrip' }
  | { k: 'profile'; field: 'ITripUa' | 'tripDelayTicks' | 'pullInUa' | 'dropOutUa' }
  | { k: 'relayThreshold'; n: number; field: 'pullInUa' | 'dropOutUa' };

export type NumericRead = MachineNumericRead | ProfileNumericRead;
export type BoolRead =
  | { k: 'stateBool'; field: 'breakerTripped' }
  | { k: 'relayBool'; n: number; field: 'held' };
export type NumericOperand = NumericRead | { k: 'literal'; value: number };

export type EventSelector =
  | { k: 'relay.pullIn' | 'relay.dropOut'; n: number }
  | { k: 'power.on' | 'power.off' | 'breaker.trip' | 'breaker.reset' };

export type ProbeCheck =
  | { k: 'near'; name: string; read: NumericRead; expected: number; tolerance: number }
  | {
      k: 'compare';
      name: string;
      left: NumericRead;
      op: 'lt' | 'le' | 'eq' | 'ge' | 'gt';
      right: NumericOperand;
    }
  | { k: 'bool'; name: string; read: BoolRead; expected: boolean }
  | { k: 'eventSeen'; name: string; event: EventSelector; expected: boolean };

export interface MachineCheckpoint {
  name: string;
  at: CheckpointAddress;
  checks: ProbeCheck[];
}

export interface MachineCase {
  k: 'machine';
  name: string;
  source: MachineSource;
  checkpoints: MachineCheckpoint[];
}

export interface ProfileLoad {
  coils: 6;
  feed: 'C' | 'E';
  outputLamps: number;
  indicatorLamps: 'series-with-coils' | 'across-rail';
  powerLamp: { k: 'panelLampModelSubstitute'; count: 1; status: 'unverified' };
}

export interface ProfileLoadCase {
  k: 'profileLoad';
  name: string;
  load: ProfileLoad;
  checks: ProbeCheck[];
  diagnostic?: true;
}

export type ProbeCase = MachineCase | ProfileLoadCase;

export interface ModeledObservableSubstitution {
  k: 'modeledObservableSubstitution';
  claim: string;
  model: string;
  status: 'unverified';
  sourceEquivalent: false;
}

export interface ProbeDocument {
  schema: 'minivac.probe/1';
  id: ProbeId;
  source: string;
  profile: ProbeProfileId;
  cases: ProbeCase[];
  modeledSubstitutions?: ModeledObservableSubstitution[];
}

export interface LoadedProbe {
  path: string;
  probe: ProbeDocument;
}

export type CheckResult =
  | {
      k: 'near'; name: string; actual: number; expected: number; tolerance: number; pass: boolean;
    }
  | {
      k: 'compare'; name: string; left: number; op: 'lt' | 'le' | 'eq' | 'ge' | 'gt';
      right: number; pass: boolean;
    }
  | { k: 'bool'; name: string; actual: boolean; expected: boolean; pass: boolean }
  | { k: 'eventSeen'; name: string; count: number; expected: boolean; pass: boolean };

export interface CheckpointResult {
  name: string;
  at: CheckpointAddress;
  checks: CheckResult[];
}

export type ProbeCaseResult =
  | { k: 'machine'; name: string; checkpoints: CheckpointResult[] }
  | { k: 'profileLoad'; name: string; checks: CheckResult[]; diagnostic: boolean };

export interface ProbeResult {
  schema: 'minivac.probe-result/1';
  id: ProbeId;
  profile: ProbeProfileId;
  cases: ProbeCaseResult[];
  pass: boolean;
}

export interface MachineCheckpointState {
  state: State;
  events: readonly Event[];
  profile: { ITripUa: number; tripDelayTicks: number; pullInUa: number; dropOutUa: number };
}

export interface ProfileLoadState {
  settledSupplyUa: number;
  peakSupplyUa: number;
  ticksOverTrip: number;
  ITripUa: number;
  tripDelayTicks: number;
  pullInUa: number;
  dropOutUa: number;
  relayPullInUa: readonly number[];
  relayDropOutUa: readonly number[];
}
