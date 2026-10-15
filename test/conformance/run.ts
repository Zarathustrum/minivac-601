import { globSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import type { Event, Machine, TraceAnomaly } from '../../src/core/contract.ts';
import { createMachine } from '../../src/core/machine.ts';
import {
  CHATTER_DEVICES,
  MOVER_OBSERVABLE_START,
  OBSERVABLE_COUNT,
  OBSERVABLES,
  formatAnomaly,
  formatCommand,
  formatMs,
  formatTrace,
  formatTransitions,
} from '../../src/core/trace.ts';
import {
  expectedEncoding,
  loadFixture,
  observableIndex,
  observableValue,
  quoteGolden,
  REPO_ROOT,
  traceHeaders,
} from './helpers.ts';
import type {
  ExpectationFailure,
  ExpectStep,
  FallbackRecord,
  Fixture,
  LoadedFixture,
  Metrics,
  ReviewedDigest,
  RunResult,
  UntilStep,
} from './types.ts';

const INT32_MAX = 2147483647;

function fail(message: string): never {
  throw new Error('runner: ' + message);
}

function copy33(source: ArrayLike<number>, target: Int32Array): void {
  if (source.length !== OBSERVABLE_COUNT) fail('Machine.observables() did not return 33 entries');
  for (let i = 0; i < OBSERVABLE_COUNT; i++) target[i] = source[i] as number;
}

function connectInitialWiring(machine: Machine, loaded: LoadedFixture): void {
  for (const cord of loaded.cords) {
    const result = machine.apply({
      k: 'connect',
      cord: cord.wireIndex,
      a: { k: 'hole', hole: cord.a.id },
      b: { k: 'hole', hole: cord.b.id },
    });
    if (!result.ok) fail('initial wire ' + cord.wireIndex + ' was rejected: ' + result.why);
  }
}

function isChatter(event: Event): event is Extract<Event, { k: 'chatter' }> {
  return event.k === 'chatter';
}

class Execution {
  readonly loaded: LoadedFixture;
  readonly machine: Machine;
  readonly body: string[] = [];
  readonly failures: ExpectationFailure[] = [];
  readonly previous = new Int32Array(OBSERVABLE_COUNT);
  readonly lastChange = new Int32Array(OBSERVABLE_COUNT);
  readonly moverTransitions = new Array<number>(CHATTER_DEVICES.length).fill(0);
  minDecisionUa: number | null = null;
  minTickGap: number | null = null;
  eventCount = 0;
  nextBoundaryTick: number;

  constructor(loaded: LoadedFixture) {
    this.loaded = loaded;
    this.machine = createMachine(loaded.netlist, loaded.profile);
    connectInitialWiring(this.machine, loaded);
    copy33(this.machine.observables(), this.previous);
    this.lastChange.fill(-1);
    this.nextBoundaryTick = this.machine.snapshot().tick;
  }

  private recordEvents(events: readonly Event[]): boolean {
    if (this.eventCount > INT32_MAX - events.length) fail('event digest exceeds int32');
    this.eventCount += events.length;
    let epochRestart = false;
    for (const event of events) {
      if (event.k === 'power.on') epochRestart = true;
      if ((event.k === 'relay.pullIn' || event.k === 'relay.dropOut') && event.marginUa >= 0) {
        if (this.minDecisionUa === null || event.marginUa < this.minDecisionUa) {
          this.minDecisionUa = event.marginUa;
        }
      }
    }
    return epochRestart;
  }

  private recordChanges(boundaryTick: number, after: ArrayLike<number>, epochRestart: boolean): boolean {
    if (epochRestart) this.lastChange.fill(-1);
    let changed = false;
    for (let i = 0; i < OBSERVABLE_COUNT; i++) {
      if (this.previous[i] === after[i]) continue;
      changed = true;
      const priorTick = this.lastChange[i] as number;
      const gap = boundaryTick - priorTick;
      if (priorTick >= 0 && gap > 0 && (this.minTickGap === null || gap < this.minTickGap)) {
        this.minTickGap = gap;
      }
      this.lastChange[i] = boundaryTick;
      if (i >= MOVER_OBSERVABLE_START && i < MOVER_OBSERVABLE_START + CHATTER_DEVICES.length) {
        const mover = i - MOVER_OBSERVABLE_START;
        const count = (this.moverTransitions[mover] as number) + 1;
        if (count > INT32_MAX) fail('mover transition digest exceeds int32');
        this.moverTransitions[mover] = count;
      }
    }
    return changed;
  }

  advanceOne(): { boundaryTick: number; changed: boolean } {
    this.machine.advance(1);
    const events = this.machine.drainEvents();
    let boundaryTick = this.nextBoundaryTick;
    if (events.length > 0) {
      boundaryTick = (events[0] as Event).t;
      for (const event of events) {
        if (event.t !== boundaryTick) fail('one-tick drain returned mixed event timestamps');
      }
    }
    const epochRestart = this.recordEvents(events);
    const after = this.machine.observables();
    const changed = this.recordChanges(boundaryTick, after, epochRestart);
    const transition = formatTransitions(boundaryTick, this.previous, after);
    if (transition !== null) this.body.push(transition);
    for (const event of events) {
      if (isChatter(event)) this.body.push(formatAnomaly(event.t, event));
    }
    copy33(after, this.previous);
    this.nextBoundaryTick = boundaryTick + 1;
    return { boundaryTick, changed };
  }

  advance(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.advanceOne();
  }

  settle(maxTicks: number): void {
    let quiet = 0;
    let waited = 0;
    let boundaryTick = this.nextBoundaryTick;
    while (waited < maxTicks) {
      const tick = this.advanceOne();
      boundaryTick = tick.boundaryTick;
      waited++;
      if (!tick.changed && this.machine.motionMask() === 0) quiet++;
      else quiet = 0;
      if (quiet >= this.loaded.profile.v.settle_quiet_ticks) return;
    }
    const anomaly: TraceAnomaly = { k: 'no-settle', waitedTicks: waited };
    this.body.push(formatAnomaly(boundaryTick, anomaly));
  }

  apply(command: Fixture['script'][number] & { k: 'do' }): void {
    const acceptedAt = this.machine.snapshot().tick;
    const result = this.machine.apply(command.cmd);
    if (!result.ok) fail('script command was rejected: ' + result.why);
    this.body.push(formatCommand(acceptedAt, command.cmd));
  }

  /**
   * `until` (architecture §13.5.1): match is tested before each tick, the cap after it, so a
   * match on the cap tick is a match. Ticks run through `advanceOne`, the same path as advance and
   * settle. The step then emits exactly the `?` line an expect would at that moment, and on a
   * timeout records the same failures.
   */
  until(step: UntilStep, scriptIndex: number): void {
    const indices = step.obs.map((expected) => observableIndex(expected.dev));
    const wanted = step.obs.map((expected) => expectedEncoding(expected.dev, expected.v));
    const cap = step.maxMs * 10;
    let waited = 0;
    for (;;) {
      const current = this.machine.observables();
      if (indices.every((index, at) => current[index] === wanted[at])) break;
      if (waited === cap) break;
      this.advanceOne();
      waited++;
    }
    this.expect(step, scriptIndex);
  }

  expect(step: ExpectStep | UntilStep, scriptIndex: number): void {
    const current = this.machine.observables();
    const selected = new Int32Array(OBSERVABLE_COUNT);
    const included = new Uint8Array(OBSERVABLE_COUNT);
    for (const expected of step.obs) {
      const index = observableIndex(expected.dev);
      selected[index] = expectedEncoding(expected.dev, expected.v);
      included[index] = 1;
    }

    let payload = '';
    for (let i = 0; i < OBSERVABLES.length; i++) {
      if ((included[i] as number) === 0) continue;
      const row = OBSERVABLES[i] as NonNullable<(typeof OBSERVABLES)[number]>;
      const actual = observableValue(i, current[i] as number);
      const expected = observableValue(i, selected[i] as number);
      if (payload.length > 0) payload += ' ';
      payload += row.name + '=' + actual;
      if (actual !== expected) {
        this.failures.push({ scriptIndex, dev: row.name, expected, actual });
      }
    }
    const tick = this.machine.snapshot().tick;
    this.body.push(formatMs(tick) + ' ? ' + payload + '  ' + quoteGolden(step.quote));
  }

  result(): RunResult {
    const state = this.machine.snapshot();
    if (state.flags.nonPortable) fail('Machine marked the trace non-portable');
    const metrics: Metrics = {
      minDecisionUa: this.minDecisionUa,
      minTickGap: this.minTickGap,
    };
    const digest: ReviewedDigest = {
      eventCount: this.eventCount,
      moverTransitions: this.moverTransitions.slice(),
    };
    const headers = traceHeaders(
      this.loaded.fixture,
      this.loaded.profile,
      this.loaded.netlist.hash,
      metrics,
    );
    return {
      loaded: this.loaded,
      trace: formatTrace([...headers, ...this.body]),
      failures: this.failures.slice(),
      metrics,
      digest,
    };
  }
}

export function runLoadedFixture(loaded: LoadedFixture): RunResult {
  const execution = new Execution(loaded);
  for (let i = 0; i < loaded.fixture.script.length; i++) {
    const step = loaded.fixture.script[i] as Fixture['script'][number];
    if (step.k === 'do') execution.apply(step);
    else if (step.k === 'advance') execution.advance(step.ms * 10);
    else if (step.k === 'settle') execution.settle(step.maxMs * 10);
    else if (step.k === 'until') execution.until(step, i);
    else execution.expect(step, i);
  }
  return execution.result();
}

export function runFixture(path: string): RunResult {
  return runLoadedFixture(loadFixture(path));
}

export function listFallbacks(root = resolve(REPO_ROOT, 'test/conformance/fixtures')): FallbackRecord[] {
  const paths = globSync('**/*.fixture.json', { cwd: root });
  const records: FallbackRecord[] = [];
  for (const relativePath of paths) {
    const path = resolve(root, relativePath);
    const fixture = loadFixture(path).fixture;
    for (let i = 0; i < fixture.script.length; i++) {
      const step = fixture.script[i] as Fixture['script'][number];
      if ((step.k === 'expect' || step.k === 'until') && step.tag === 'unverified') {
        records.push({
          fixtureId: fixture.id,
          scriptIndex: i,
          source: step.source as string,
          cite: step.cite,
        });
      }
    }
  }
  records.sort((a, b) => {
    if (a.fixtureId < b.fixtureId) return -1;
    if (a.fixtureId > b.fixtureId) return 1;
    return a.scriptIndex - b.scriptIndex;
  });
  return records;
}

export function formatFallbacks(records: readonly FallbackRecord[]): string {
  let output = '';
  for (const record of records) {
    output += record.fixtureId + '\t' + 'script[' + record.scriptIndex + ']\t' +
      record.source + '\t' + record.cite + '\n';
  }
  return output;
}

export function fixtureDisplayPath(path: string): string {
  const rel = relative(REPO_ROOT, path);
  return rel.startsWith('..') ? path : rel;
}
