import { describe, expect, it } from 'vitest';
import { newSession, parseWire, replay, runBatch, sessionOf, validateBatch } from '../../src/hands/table.ts';
import type { BatchOutcome, Rig, Session, ToolCall, Why } from '../../src/hands/table.ts';
import { loadRepoNetlist, loadRepoProfile } from '../../tools/hands/session-file.ts';
import { readStrictJson } from '../conformance/helpers.ts';
import type { Fixture } from '../conformance/types.ts';

// validateBatch must say what runBatch would say, on the live rig, without touching it. Each case
// validates on the live rig, then runs runBatch on a clone replayed from the live rig's session and
// compares: same ok, and for a rejection the same failedAt, why and detail.

const netlist = loadRepoNetlist();
const profile = loadRepoProfile('MV601-REF-A');
const INT32_MAX = 2147483647;

function wires(path: string): string[] {
  return (readStrictJson(new URL('../conformance/fixtures/' + path + '.fixture.json', import.meta.url), path) as Fixture).wires;
}

function connect(text: string): ToolCall {
  const wire = parseWire(text);
  if ('ok' in wire) throw new Error('bad wire ' + text);
  return { name: 'connect', args: wire };
}

const POWER_ON: ToolCall = { name: 'power', args: { on: true } };
const button = (n: number, target: number): ToolCall => ({ name: 'button', args: { n, target } });
const slide = (n: number, target: number): ToolCall => ({ name: 'switch', args: { n, target } });
const press = (n: number, ms?: number): ToolCall => ({ name: 'press', args: ms === undefined ? { n } : { n, ms } });
const wait = (ms: number): ToolCall => ({ name: 'wait', args: { ms } });
const unplug = (cord: number): ToolCall => ({ name: 'disconnect', args: { cord } });
const unplugPair = (a: string, b: string): ToolCall => ({ name: 'disconnect', args: { a, b } });
const UNPLUG_ALL: ToolCall = { name: 'disconnect', args: { all: true } };
const load = (program: string, list: string[]): ToolCall => ({ name: 'loadProgram', args: { program, wires: list } });
const turn = (degrees: number): ToolCall[] => [
  { name: 'dialGrab', args: { targetUdeg: Math.round(degrees * 1_000_000) } }, wait(500),
];

/** Each press and release in its own call, as check.spec's `presses` sends them. */
function presses(n: number, count: number): ToolCall[][] {
  const out: ToolCall[][] = [];
  for (let i = 0; i < count; i++) out.push([button(n, 1000)], [button(n, 0)]);
  return out;
}

/** A live rig built through the table, one accepted runBatch per entry. */
function build(batches: readonly ToolCall[][]): { rig: Rig; base: Session } {
  const base = newSession(netlist, profile);
  const rig = replay(netlist, profile, base);
  for (const calls of batches) {
    const outcome = runBatch(rig, calls);
    if (!outcome.ok) throw new Error('setup batch failed at ' + outcome.failedAt + ': ' + outcome.result.detail);
  }
  return { rig, base };
}

/** Everything about a rig that validateBatch must leave alone. */
function picture(rig: Rig): unknown {
  return {
    log: structuredClone(rig.log),
    cords: structuredClone(rig.cords),
    previous: Array.from(rig.previous),
    watch: rig.watch,
    snapshot: rig.machine.snapshot(),
    observables: Array.from(rig.machine.observables()),
  };
}

/**
 * `rig` with its machine wrapped to count every call that could change the machine, and, when
 * `tick` is given, to report that tick (a tick near the int32 limit cannot be reached by simulating).
 */
function wrapped(rig: Rig, tick?: number): { rig: Rig; touches: () => number } {
  let touches = 0;
  const real = rig.machine;
  const machine = new Proxy(real, {
    get(target, key) {
      if (key === 'snapshot' && tick !== undefined) return () => ({ ...target.snapshot(), tick });
      const value = Reflect.get(target, key) as unknown;
      if (typeof value !== 'function') return value;
      const bound = (value as (...args: unknown[]) => unknown).bind(target);
      if (key !== 'apply' && key !== 'advance' && key !== 'drainEvents') return bound;
      return (...args: unknown[]) => {
        touches++;
        return bound(...args);
      };
    },
  });
  return { rig: { ...rig, machine }, touches: () => touches };
}

/**
 * Validate `calls` on the live rig, check the rig was not touched, then run them with runBatch on
 * a replayed clone and check the verdicts agree. Leaves the live rig as it was; returns the clone's
 * outcome so a case can say which path it hit.
 */
function agrees(rig: Rig, base: Session, calls: ToolCall[], settleMs?: number, tick?: number): BatchOutcome {
  const before = picture(rig);
  const live = wrapped(rig, tick);
  const verdict = validateBatch(live.rig, calls, settleMs);
  expect(live.touches()).toBe(0);
  expect(picture(rig)).toEqual(before);

  const replayed = replay(netlist, profile, sessionOf(rig, base));
  expect(replayed.machine.snapshot()).toEqual(rig.machine.snapshot());
  expect(replayed.cords).toEqual(rig.cords);
  const outcome = runBatch(wrapped(replayed, tick).rig, calls, settleMs);
  expect(verdict).toEqual(outcome.ok ? { ok: true } : outcome);
  return outcome;
}

const OP1_WIRES = wires('B/IV-EXP1-SLOW');
const OP2_WIRES = wires('B/V-EXP2');
const OP3_WIRES = wires('C1/I-EXP11');
const I_EXP4 = wires('A/I-EXP4');

/** The sessions test/checklist/check.spec.ts builds as each item's passing reference. */
const REFERENCE: Record<string, ToolCall[][]> = {
  B1: [[connect('1+/1A'), connect('1B/1-'), POWER_ON]],
  B2: [[connect('1+/1Y'), connect('1X/1A'), connect('1B/1-'), POWER_ON], [button(1, 1000)]],
  B3: [[connect('3+/3A'), connect('3B/3-'), POWER_ON], [unplugPair('3+', '3A')]],
  B4: [[connect('2+/2V'), connect('2W/2A'), connect('2B/2-'), POWER_ON], [slide(2, 1000)]],
  'I-EXP4': [I_EXP4.map(connect)],
  'I-EXP5': [wires('A/I-EXP5').map(connect)],
  'III-XOR-PB': [wires('A/III-XOR-PB').map(connect)],
  'III-RELAYOR': [wires('A/III-RELAYOR').map(connect)],
  'IV-EXP4': [wires('A/IV-EXP4').map(connect)],
  OP1: [[load('IV-EXP1-SLOW', OP1_WIRES), POWER_ON], ...presses(6, 3)],
  'OP1 hand-wired': [OP1_WIRES.slice().reverse().map((wire) => connect(wire === '1G/1+' ? '1G/2+' : wire)), [POWER_ON],
    ...presses(6, 3)],
  'OP1 press tool': [[load('IV-EXP1-SLOW', OP1_WIRES), POWER_ON], [press(6)], [press(6)], [press(6)]],
  OP2: [[load('V-EXP2', OP2_WIRES), POWER_ON], ...presses(1, 1), ...presses(3, 1)],
  'OP2 press tool': [[load('V-EXP2', OP2_WIRES), POWER_ON], [press(1)], [press(3)]],
  OP3: [[load('I-EXP11', OP3_WIRES), POWER_ON], turn(22.5), turn(45), [{ name: 'dialRelease', args: {} }, wait(500)]],
};

/** Batches whose verdict depends on the cords in place: run on an empty panel and on each finished reference session. */
const PROBES: ToolCall[][] = [
  [UNPLUG_ALL, unplug(0)],
  [unplug(0), wait(10), unplug(0)],
  [unplug(3)],
  [unplugPair('1+', '1Y')],
  [unplugPair('3+', '3A')],
  [connect('1+/1Y'), connect('1+/1A'), connect('1+/3A')],
  [load('I-EXP4', I_EXP4)],
  [UNPLUG_ALL, load('I-EXP4', I_EXP4), POWER_ON],
  [press(1), wait(100), connect('6com/6com'), connect('6com/6com'), connect('6com/6com')],
];

describe('validateBatch agrees with runBatch on the checklist reference sessions', () => {
  it('every probe on an empty panel', () => {
    const { rig, base } = build([]);
    for (const probe of PROBES) agrees(rig, base, probe);
  });

  // Probes run on the finished session only: replaying the clone for every probe at every step
  // costs about 25 s, most of it in V-EXP2, whose relay 5 buzzes through every 500 ms settle.
  it.each(Object.keys(REFERENCE))('%s: every batch, then every probe on the finished session', (name) => {
    const batches = REFERENCE[name] as ToolCall[][];
    const { rig, base } = build([]);
    batches.forEach((calls, i) => {
      const outcome = agrees(rig, base, calls);
      expect(outcome.ok).toBe(true);
      // The pane's order: validate, then run on the live rig itself.
      expect(runBatch(rig, calls)).toEqual(outcome);
      if (i === batches.length - 1) for (const probe of PROBES) agrees(rig, base, probe);
    });
  });
});

interface Case {
  name: string;
  setup?: ToolCall[][];
  calls: ToolCall[];
  settleMs?: number;
  /** The tick the live rig and the clone report (both wrapped). */
  tick?: number;
  expected: 'ok' | { failedAt: number; why: Why; detail?: string };
}

const NEAR_END = INT32_MAX - 100;
const TICK_TEXT = 'the session is at tick ' + NEAR_END + '; this would pass the int32 tick limit 2147483647; start a new session';
const I_EXP4_ON: ToolCall[][] = [[...I_EXP4.map(connect), POWER_ON]];

const CASES: Case[] = [
  // Cord table: holes.
  { name: 'hole_occupied: the second terminal is full', setup: [[connect('1+/1A'), connect('1+/1B')]], calls: [connect('1C/1+')],
    expected: { failedAt: 0, why: 'hole_occupied', detail: 'every hole of 1+ is in use (cords 0, 1)' } },
  { name: 'hole_occupied: the first terminal is full', setup: [[connect('1+/1A'), connect('1+/1B')]], calls: [connect('1+/1C')],
    expected: { failedAt: 0, why: 'hole_occupied', detail: 'every hole of 1+ is in use (cords 0, 1)' } },
  { name: 'hole_occupied: a self-connect with one free hole', setup: [[connect('1A/1B')]], calls: [connect('1A/1A')],
    expected: { failedAt: 0, why: 'hole_occupied',
      detail: 'connecting 1A to itself needs two free holes on 1A; only one is free (cords 0 use the rest)' } },
  { name: 'hole_occupied: holes filled earlier in the same batch, after time', calls: [connect('2A/1A'), wait(100), connect('2A/1B'), connect('2A/1C')],
    expected: { failedAt: 3, why: 'hole_occupied', detail: 'every hole of 2A is in use (cords 0, 1)' } },
  { name: 'freed holes and ids are reused within one batch (no spurious cord_exists or hole_occupied)', setup: [[connect('1+/1A'), connect('1+/1B')]],
    calls: [unplug(0), connect('1+/1C'), unplugPair('1+', '1B'), connect('1+/1E'), connect('1+/1F')],
    expected: { failedAt: 4, why: 'hole_occupied', detail: 'every hole of 1+ is in use (cords 0, 1)' } },
  // Terminals.
  { name: 'unknown_terminal on connect', calls: [{ name: 'connect', args: { a: 'Q9', b: '1A' } }],
    expected: { failedAt: 0, why: 'unknown_terminal', detail: '"Q9" is not a terminal' } },
  { name: 'unknown_terminal on a terminal-pair disconnect', setup: I_EXP4_ON, calls: [unplugPair('1+', '1Q')],
    expected: { failedAt: 0, why: 'unknown_terminal', detail: '"1Q" is not a terminal' } },
  { name: 'unknown_terminal in a load-program wire', calls: [load('X1', ['1A/1B', '1A/1Q'])],
    expected: { failedAt: 0, why: 'unknown_terminal' } },
  // Cords by id and by pair.
  { name: 'unknown_cord by id', setup: I_EXP4_ON, calls: [unplug(9)],
    expected: { failedAt: 0, why: 'unknown_cord', detail: 'no cord 9 is plugged in' } },
  { name: 'unknown_cord: disconnecting a pair that was unplugged', setup: REFERENCE['B3'] as ToolCall[][], calls: [unplugPair('3+', '3A')],
    expected: { failedAt: 0, why: 'unknown_cord', detail: 'no cord runs between 3+ and 3A' } },
  { name: 'unknown_cord: a pair unplugged earlier in the same batch', setup: I_EXP4_ON, calls: [unplugPair('2B', '2-'), wait(20), unplugPair('2-', '2B')],
    expected: { failedAt: 2, why: 'unknown_cord', detail: 'no cord runs between 2- and 2B' } },
  { name: 'unknown_cord after disconnect all', setup: I_EXP4_ON, calls: [UNPLUG_ALL, unplug(2)],
    expected: { failedAt: 1, why: 'unknown_cord', detail: 'no cord 2 is plugged in' } },
  { name: 'disconnect all on an empty panel', calls: [UNPLUG_ALL], expected: 'ok' },
  { name: 'ambiguous_cord', setup: [[connect('1A/1B'), connect('1B/1A')]], calls: [unplugPair('1B', '1A')],
    expected: { failedAt: 0, why: 'ambiguous_cord', detail: 'cords 0, 1 all run between 1B and 1A; disconnect one by id' } },
  { name: 'bad_cord_id: id 256', calls: [unplug(256)], expected: { failedAt: 0, why: 'bad_cord_id', detail: 'no cord 256 is plugged in' } },
  { name: 'bad_cord_id: id -1', calls: [unplug(-1)], expected: { failedAt: 0, why: 'bad_cord_id' } },
  { name: 'bad_cord_id: id 1.5', setup: I_EXP4_ON, calls: [unplug(1.5)], expected: { failedAt: 0, why: 'bad_cord_id' } },
  // load-program.
  { name: 'load-program onto occupied holes', setup: [[connect('2A/1A'), connect('2A/1B')]], calls: [POWER_ON, load('I-EXP4', I_EXP4)],
    expected: { failedAt: 1, why: 'hole_occupied', detail: 'load-program I-EXP4: wire 3 (2X/2A) cannot be placed: every hole of 2A is ' +
      'in use (cords 0, 1, and earlier wires of this program); nothing was plugged' } },
  { name: 'load-program over its own loaded copy', setup: [[load('IV-EXP1-SLOW', OP1_WIRES), POWER_ON]], calls: [load('IV-EXP1-SLOW', OP1_WIRES)],
    expected: { failedAt: 0, why: 'hole_occupied' } },
  { name: 'load-program twice in one batch, after a press', calls: [load('I-EXP4', I_EXP4), press(1), load('I-EXP4', I_EXP4), load('I-EXP4', I_EXP4)],
    expected: { failedAt: 3, why: 'hole_occupied' } },
  { name: 'bad_program: id', calls: [load('x1', ['1A/1B'])], expected: { failedAt: 0, why: 'bad_program', detail: '"x1" is not a program id' } },
  { name: 'bad_program: no wires', calls: [load('X1', [])], expected: { failedAt: 0, why: 'bad_program', detail: 'program X1 needs 1..256 wires' } },
  // Static targets.
  { name: 'bad_target: button n', calls: [button(7, 0)], expected: { failedAt: 0, why: 'bad_target', detail: 'button needs n in 1..6 and target an integer 0..1000' } },
  { name: 'bad_target: button target', calls: [button(1, 1001)], expected: { failedAt: 0, why: 'bad_target' } },
  { name: 'bad_target: switch target', calls: [slide(1, -1)], expected: { failedAt: 0, why: 'bad_target', detail: 'switch needs n in 1..6 and target an integer 0..1000' } },
  { name: 'bad_target: relayGrab n', calls: [{ name: 'relayGrab', args: { n: 0, target: 1000 } }],
    expected: { failedAt: 0, why: 'bad_target', detail: 'relayGrab needs n in 1..6 and target an integer 0..1000' } },
  { name: 'bad_target: relayRelease n', calls: [{ name: 'relayRelease', args: { n: 7 } }],
    expected: { failedAt: 0, why: 'bad_target', detail: 'relayRelease needs n in 1..6' } },
  { name: 'bad_target: dialGrab angle', calls: [{ name: 'dialGrab', args: { targetUdeg: 360_000_000 } }],
    expected: { failedAt: 0, why: 'bad_target', detail: 'dialGrab needs targetUdeg an integer 0..359999999' } },
  { name: 'bad_target: power not a boolean', calls: [{ name: 'power', args: { on: 'yes' as never } }],
    expected: { failedAt: 0, why: 'bad_target', detail: 'power needs on: true or false' } },
  { name: 'bad_target: breaker reset false', calls: [{ name: 'breaker', args: { reset: false as never } }],
    expected: { failedAt: 0, why: 'bad_target', detail: 'breaker needs reset: true' } },
  { name: 'bad_target: press n', calls: [press(7)], expected: { failedAt: 0, why: 'bad_target', detail: 'press needs n in 1..6' } },
  { name: 'bad_target: press ms 0, refused up front', calls: [press(1, 0)],
    expected: { failedAt: 0, why: 'bad_target', detail: 'press time must be an integer number of milliseconds in 1..60000' } },
  { name: 'bad_target: press ms 30001, refused by the press handler after up-front passes', setup: I_EXP4_ON, calls: [button(1, 1000), wait(10), press(2, 30001)],
    expected: { failedAt: 2, why: 'bad_target', detail: 'press time must be an integer number of milliseconds in 1..60000' } },
  { name: 'bad_target: wait 0', calls: [wait(0)], expected: { failedAt: 0, why: 'bad_target', detail: 'wait must be an integer number of milliseconds in 1..60000' } },
  { name: 'bad_target: wait 60001', calls: [POWER_ON, wait(60001)], expected: { failedAt: 1, why: 'bad_target' } },
  { name: 'bad_target: wait 1.5', calls: [wait(1.5)], expected: { failedAt: 0, why: 'bad_target' } },
  { name: 'bad_target: settle cap 0', calls: [POWER_ON], settleMs: 0,
    expected: { failedAt: 1, why: 'bad_target', detail: 'settle cap must be an integer number of milliseconds in 1..60000' } },
  { name: 'bad_target: settle cap 60001', calls: [], settleMs: 60001, expected: { failedAt: 0, why: 'bad_target' } },
  { name: 'the up-front time check wins over an earlier rejection', calls: [{ name: 'connect', args: { a: 'Q9', b: '1A' } }, wait(60001)],
    expected: { failedAt: 1, why: 'bad_target' } },
  // Machine state other than cords does not reject: breaker, held relay, held dial.
  { name: 'a tripped breaker: reset, power and presses are accepted', setup: [[connect('1+/1-'), POWER_ON]],
    calls: [{ name: 'breaker', args: { reset: true } }, POWER_ON, press(1), unplug(0), { name: 'breaker', args: { reset: true } }], expected: 'ok' },
  { name: 'releasing a relay and the dial that are not held', calls: [{ name: 'relayRelease', args: { n: 1 } }, { name: 'dialRelease', args: {} }], expected: 'ok' },
  // A reject late in a long batch, after time steps and every kind of command.
  { name: 'a late unknown_terminal after time steps', setup: I_EXP4_ON,
    calls: [button(1, 1000), wait(200), press(2), wait(1000), slide(3, 1000), press(1, 50), unplugPair('2B', '2-'), connect('2B/2-'),
      { name: 'relayGrab', args: { n: 1, target: 1000 } }, wait(500), { name: 'relayRelease', args: { n: 1 } },
      { name: 'dialGrab', args: { targetUdeg: 45_000_000 } }, wait(300), { name: 'dialRelease', args: {} }, { name: 'state', args: {} },
      { name: 'connect', args: { a: '1+', b: '1Q' } }],
    expected: { failedAt: 15, why: 'unknown_terminal', detail: '"1Q" is not a terminal' } },
  { name: 'a late unknown_cord after a power cycle', setup: I_EXP4_ON,
    calls: [press(1), { name: 'power', args: { on: false } }, wait(100), POWER_ON, press(2, 200), unplug(3), wait(50), unplug(3)],
    expected: { failedAt: 7, why: 'unknown_cord', detail: 'no cord 3 is plugged in' } },
  { name: 'a long accepted batch', setup: I_EXP4_ON,
    calls: [press(1), wait(300), unplugPair('2B', '2-'), connect('2-/2B'), button(1, 1000), button(2, 1000), wait(200)], expected: 'ok' },
  // Tick limit: the text names the live tick.
  { name: 'tick limit: the settle would pass it', tick: NEAR_END, calls: [wait(5)],
    expected: { failedAt: 1, why: 'bad_target', detail: TICK_TEXT } },
  { name: 'tick limit: a press would pass it', tick: NEAR_END, setup: I_EXP4_ON, calls: [POWER_ON, press(1)],
    expected: { failedAt: 1, why: 'bad_target', detail: TICK_TEXT } },
  { name: 'tick limit: refused before an earlier unknown terminal', tick: NEAR_END, calls: [{ name: 'connect', args: { a: 'Q9', b: '1A' } }, wait(20)],
    expected: { failedAt: 1, why: 'bad_target', detail: TICK_TEXT } },
  { name: 'tick limit: exactly at the limit is accepted', tick: INT32_MAX - 6000, calls: [wait(50), wait(50)], expected: 'ok' },
  { name: 'tick limit: one millisecond more is refused at the settle', tick: INT32_MAX - 6000, calls: [wait(50), wait(51)],
    expected: { failedAt: 2, why: 'bad_target', detail: 'the session is at tick ' + (INT32_MAX - 6000) +
      '; this would pass the int32 tick limit 2147483647; start a new session' } },
  { name: 'tick limit: near it, a press then a cord rejection', tick: INT32_MAX - 6000, setup: I_EXP4_ON, calls: [press(1, 10), unplug(7)],
    expected: { failedAt: 1, why: 'unknown_cord' } },
];

describe('validateBatch agrees with runBatch on handcrafted batches', () => {
  it.each(CASES.map((row) => [row.name, row] as const))('%s', (_, row) => {
    const { rig, base } = build(row.setup ?? []);
    const outcome = agrees(rig, base, row.calls, row.settleMs, row.tick);
    if (row.expected === 'ok') {
      expect(outcome.ok).toBe(true);
      return;
    }
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failedAt).toBe(row.expected.failedAt);
    expect(outcome.result.why).toBe(row.expected.why);
    if (row.expected.detail !== undefined) expect(outcome.result.detail).toBe(row.expected.detail);
  });

  it('throws as runBatch does for an unknown tool, before touching the live rig', () => {
    const { rig, base } = build(I_EXP4_ON);
    const before = picture(rig);
    const calls = [POWER_ON, { name: 'nope', args: {} } as unknown as ToolCall];
    const live = wrapped(rig);
    expect(() => validateBatch(live.rig, calls)).toThrow('hands: no tool "nope"');
    expect(live.touches()).toBe(0);
    expect(picture(rig)).toEqual(before);
    expect(() => runBatch(replay(netlist, profile, sessionOf(rig, base)), calls)).toThrow('hands: no tool "nope"');
  });
});
