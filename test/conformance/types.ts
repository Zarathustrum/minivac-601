import type { Command } from '../../src/core/contract.ts';
import type { LoadedNetlist } from '../../src/core/netlist.ts';
import type { Profile, ScalarKey } from '../../src/core/profile.ts';
import type { AllocatedCord, TerminalWire } from '../../src/core/terminals.ts';

export type Tier = 'A' | 'B' | 'C1' | 'C2';
export type Confidence = 'verified' | 'likely' | 'unverified';

export interface Erratum {
  id: string;
  from: string;
  to: string;
}

export interface Mechanism {
  profileKey: ScalarKey | 'dV_relay_mv' | 'lamp_pwl_uohm';
  decision: string;
}

export interface ReviewedDigest {
  eventCount: number;
  moverTransitions: number[];
}

export interface ExpectedObservable {
  dev: string;
  v: string;
}

export interface ExpectStep {
  k: 'expect';
  obs: ExpectedObservable[];
  cite: string;
  quote: string;
  tag?: 'unverified';
  source?: string;
}

/** An expect that first advances, one tick at a time, until every `obs` matches or `maxMs` runs out. */
export interface UntilStep extends Omit<ExpectStep, 'k'> {
  k: 'until';
  maxMs: number;
}

export type ScriptStep =
  | { k: 'do'; cmd: Command; collapse?: true }
  | { k: 'advance'; ms: number }
  | { k: 'settle'; maxMs: number }
  | ExpectStep
  | UntilStep;

export interface Fixture {
  schema: 'minivac.fixture/1';
  id: string;
  source: string;
  tier: Tier;
  confidence: Confidence;
  profile: 'MV601-REF-A' | 'MV601-IDEAL';
  contract: '1.1.0';
  as_printed: string[];
  errata_applied: Erratum[];
  wires: string[];
  script: ScriptStep[];
  note?: string;
  marginal?: true;
  mechanism?: Mechanism;
  digest?: ReviewedDigest;
}

export interface LoadedFixture {
  path: string;
  fixture: Fixture;
  profile: Profile;
  netlist: LoadedNetlist;
  wires: readonly TerminalWire[];
  cords: readonly AllocatedCord[];
}

export interface ExpectationFailure {
  scriptIndex: number;
  dev: string;
  expected: string;
  actual: string;
}

export interface Metrics {
  minDecisionUa: number | null;
  minTickGap: number | null;
}

export interface RunResult {
  loaded: LoadedFixture;
  trace: string;
  failures: ExpectationFailure[];
  metrics: Metrics;
  digest: ReviewedDigest;
}

export interface FallbackRecord {
  fixtureId: string;
  scriptIndex: number;
  source: string;
  cite: string;
}
