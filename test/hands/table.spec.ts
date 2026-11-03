import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { afterEach, describe, expect, it } from 'vitest';
import { allocateHoles, parseTerminalWire } from '../../src/core/terminals.ts';
import { OBSERVABLES } from '../../src/core/trace.ts';
import {
  MAX_STEP_MS,
  PRESS_MS,
  SessionError,
  TOOL_TABLE,
  callTool,
  createRig,
  newSession,
  parseWire,
  replay,
  runBatch,
  sessionOf,
} from '../../src/hands/table.ts';
import type { Rig, Session, ToolCall, ToolResult } from '../../src/hands/table.ts';
import {
  formatSession,
  loadRepoNetlist,
  loadRepoProfile,
  readSession,
  writeSessionFile,
} from '../../tools/hands/session-file.ts';
import { readStrictJson } from '../conformance/helpers.ts';
import type { Fixture } from '../conformance/types.ts';

const netlist = loadRepoNetlist();
const profile = loadRepoProfile('MV601-REF-A');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'mv601-hands-'));
  roots.push(root);
  return root;
}

function freshRig(): Rig {
  return replay(netlist, profile, newSession(netlist, profile));
}

function connectCall(text: string): ToolCall {
  const wire = parseWire(text);
  if ('ok' in wire) throw new Error('bad wire ' + text);
  return { name: 'connect', args: wire };
}

function batch(rig: Rig, calls: ToolCall[], settleMs?: number): void {
  const outcome = runBatch(rig, calls, settleMs);
  if (!outcome.ok) throw new Error('batch failed at ' + outcome.failedAt + ': ' + outcome.result.detail);
}

function failure(result: ToolResult): Extract<ToolResult, { ok: false }> {
  if (result.ok) throw new Error('expected a rejection');
  return result;
}

function observable(rig: Rig, name: string): string {
  const index = OBSERVABLES.findIndex((row) => row.name === name);
  const row = OBSERVABLES[index] as (typeof OBSERVABLES)[number];
  return row.values[(rig.machine.observables()[index] as number) - row.minValue] as string;
}

describe('hands tool table', () => {
  it('has one entry per v1 tool and every schema compiles under Ajv strict', () => {
    expect(TOOL_TABLE.map((row) => row.name)).toEqual([
      'power', 'connect', 'disconnect', 'button', 'press', 'switch', 'wait', 'state',
      'breaker', 'relayGrab', 'relayRelease', 'dialGrab', 'dialRelease', 'loadProgram',
    ]);
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    const validators = Object.fromEntries(TOOL_TABLE.map((row) => [row.name, ajv.compile(row.schema)]));
    expect(validators['power']?.({ on: true })).toBe(true);
    expect(validators['power']?.({ on: 1 })).toBe(false);
    expect(validators['connect']?.({ a: '1+', b: '1Y' })).toBe(true);
    expect(validators['disconnect']?.({ cord: 3 })).toBe(true);
    expect(validators['disconnect']?.({ a: '1+', b: '1Y' })).toBe(true);
    expect(validators['disconnect']?.({ cord: 3, a: '1+' })).toBe(false);
    expect(validators['disconnect']?.({ all: true })).toBe(true);
    expect(validators['disconnect']?.({ all: false })).toBe(false);
    expect(validators['button']?.({ n: 1, target: 1000 })).toBe(true);
    expect(validators['button']?.({ n: 7, target: 1000 })).toBe(false);
    expect(validators['press']?.({ n: 3 })).toBe(true);
    expect(validators['press']?.({ n: 3, ms: 100 })).toBe(true);
    expect(validators['press']?.({ n: 7 })).toBe(false);
    expect(validators['press']?.({ n: 1, ms: 0 })).toBe(false);
    expect(validators['switch']?.({ n: 6, target: 0 })).toBe(true);
    expect(validators['wait']?.({ ms: 0 })).toBe(false);
    expect(validators['state']?.({})).toBe(true);
    expect(validators['breaker']?.({ reset: true })).toBe(true);
    expect(validators['breaker']?.({ reset: false })).toBe(false);
    expect(validators['relayGrab']?.({ n: 1, target: 1000 })).toBe(true);
    expect(validators['relayGrab']?.({ n: 0, target: 1000 })).toBe(false);
    expect(validators['relayRelease']?.({ n: 6 })).toBe(true);
    expect(validators['dialGrab']?.({ targetUdeg: 359999999 })).toBe(true);
    expect(validators['dialGrab']?.({ targetUdeg: 360000000 })).toBe(false);
    expect(validators['dialRelease']?.({})).toBe(true);
    expect(validators['loadProgram']?.({ program: 'I-EXP4', wires: ['1+/1Y'] })).toBe(true);
    expect(validators['loadProgram']?.({ program: 'i-exp4', wires: ['1+/1Y'] })).toBe(false);
    expect(validators['loadProgram']?.({ program: 'I-EXP4', wires: [] })).toBe(false);
    for (const row of TOOL_TABLE) expect(row.description.length).toBeGreaterThan(0);
  });

  it('src/hands stays filesystem- and process-free', () => {
    const dir = new URL('../../src/hands/', import.meta.url);
    for (const name of readdirSync(dir).filter((file) => file.endsWith('.ts'))) {
      const source = readFileSync(new URL(name, dir), 'utf8');
      expect(source, name).not.toMatch(/from '(?:node:)?(?:fs|path|os|child_process|process|url)'/);
      expect(source, name).not.toMatch(/\bprocess\./);
    }
  });

  it('replays a session from its file to an identical machine, twice', () => {
    const rig = freshRig();
    batch(rig, [connectCall('1+/1Y'), connectCall('1X/2Y'), connectCall('2X/2A'), connectCall('2B/2-'),
      { name: 'power', args: { on: true } }]);
    batch(rig, [{ name: 'button', args: { n: 1, target: 1000 } }, { name: 'wait', args: { ms: 50 } },
      { name: 'button', args: { n: 2, target: 1000 } }]);
    // Hole and id reuse: 1+ already has 1+#1 (cord 0); 3A takes 1+#2 as cord 4. Unplug cord 0 and
    // the next 1+ cord must get the freed 1+#1 and the freed id 0.
    const extra = callTool(rig, connectCall('1+/3A'));
    expect(extra.ok && extra.cord).toEqual({ id: 4, a: '1+#2', b: '3A#1', wire: '1+/3A' });
    batch(rig, [{ name: 'disconnect', args: { cord: 0 } }]);
    const reused = callTool(rig, connectCall('3B/1+'));
    expect(reused.ok && reused.cord).toEqual({ id: 0, a: '3B#1', b: '1+#1', wire: '3B/1+' });
    batch(rig, [{ name: 'disconnect', args: { a: '1+', b: '3A' } }, connectCall('1+/1Y'),
      { name: 'switch', args: { n: 3, target: 1000 } }]);
    expect(observable(rig, 'outLamp2')).toBe('on');

    const path = join(tempDir(), 's.json');
    const session = sessionOf(rig, newSession(netlist, profile));
    writeSessionFile(path, session);
    expect(readFileSync(path, 'utf8')).toBe(formatSession(session));

    const first = replay(netlist, profile, readSession(path));
    const second = replay(netlist, profile, readSession(path));
    expect(first.machine.snapshot()).toEqual(rig.machine.snapshot());
    expect(Array.from(first.machine.observables())).toEqual(Array.from(rig.machine.observables()));
    expect(second.machine.snapshot()).toEqual(first.machine.snapshot());
    expect(Array.from(second.machine.observables())).toEqual(Array.from(first.machine.observables()));
    expect(first.cords).toEqual(rig.cords);
  });

  it('drives I-EXP4 through the table and matches every expect', () => {
    const fixture = readStrictJson(
      new URL('../conformance/fixtures/A/I-EXP4.fixture.json', import.meta.url), 'I-EXP4',
    ) as Fixture;
    const rig = freshRig();
    let pending: ToolCall[] = fixture.wires.map(connectCall);
    const seen: string[] = [];
    for (const step of fixture.script) {
      if (step.k === 'do') {
        const cmd = step.cmd;
        if (cmd.k === 'power') pending.push({ name: 'power', args: { on: cmd.on } });
        else if (cmd.k === 'button') pending.push({ name: 'button', args: { n: cmd.n, target: cmd.target } });
        else throw new Error('I-EXP4 uses an unexpected command ' + cmd.k);
      } else if (step.k === 'settle') {
        batch(rig, pending, step.maxMs);
        pending = [];
      } else if (step.k === 'expect') {
        for (const expected of step.obs) {
          expect(observable(rig, expected.dev), step.quote).toBe(expected.v);
          seen.push(expected.v);
        }
      } else {
        throw new Error('I-EXP4 uses an unexpected step ' + step.k);
      }
    }
    expect(seen).toEqual(['off', 'off', 'on']);
    // The shorthand path allocates exactly the holes the fixture loader does.
    const loader = allocateHoles(fixture.wires.map((wire) => parseTerminalWire(wire)));
    expect(rig.cords.slice(0, loader.length)).toEqual(loader.map((cord, i) => ({
      id: i, a: cord.a.id, b: cord.b.id, wire: fixture.wires[i],
    })));
  });
});

describe('hands error paths', () => {
  it('rejects a connect to a terminal whose holes are exhausted', () => {
    const rig = freshRig();
    expect(callTool(rig, connectCall('1+/1A')).ok).toBe(true);
    expect(callTool(rig, connectCall('1+/1B')).ok).toBe(true);
    const third = failure(callTool(rig, connectCall('1C/1+')));
    expect(third.why).toBe('hole_occupied');
    expect(third.detail).toContain('1+');
    expect(third.detail).toContain('cords 0, 1');
  });

  it('treats a session that reuses an occupied hole as corrupt', () => {
    const session: Session = {
      ...newSession(netlist, profile),
      script: [
        { k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'hole', hole: '1A#1' as never }, b: { k: 'hole', hole: '1B#1' as never } } },
        { k: 'do', cmd: { k: 'connect', cord: 1, a: { k: 'hole', hole: '1A#1' as never }, b: { k: 'hole', hole: '1C#1' as never } } },
      ],
    };
    expect(() => replay(netlist, profile, session)).toThrow(/script\[1\] connect was rejected on replay: hole_occupied/);
  });

  it('rejects unknown terminals', () => {
    const parsed = failure(parseWire('1+/1Q') as ToolResult);
    expect(parsed.why).toBe('unknown_terminal');
    expect(parsed.detail).toContain('"1Q"');
    expect(failure(parseWire('1+1Y') as ToolResult).why).toBe('unknown_terminal');
    expect(failure(callTool(freshRig(), { name: 'connect', args: { a: 'Q9', b: '1A' } })).why).toBe('unknown_terminal');
  });

  it('rejects unknown cords by id and by terminal pair', () => {
    const rig = freshRig();
    expect(failure(callTool(rig, { name: 'disconnect', args: { cord: 9 } })).why).toBe('unknown_cord');
    expect(failure(callTool(rig, { name: 'disconnect', args: { a: '1A', b: '1B' } })).why).toBe('unknown_cord');
  });

  it('refuses an ambiguous terminal-pair disconnect and names the candidates', () => {
    const rig = freshRig();
    callTool(rig, connectCall('1A/1B'));
    callTool(rig, connectCall('1B/1A'));
    const result = failure(callTool(rig, { name: 'disconnect', args: { a: '1B', b: '1A' } }));
    expect(result.why).toBe('ambiguous_cord');
    expect(result.detail).toContain('cords 0, 1');
  });

  it('rejects bad button and switch targets', () => {
    const rig = freshRig();
    expect(failure(callTool(rig, { name: 'button', args: { n: 1, target: 1001 } })).why).toBe('bad_target');
    expect(failure(callTool(rig, { name: 'button', args: { n: 7, target: 0 } })).why).toBe('bad_target');
    expect(failure(callTool(rig, { name: 'switch', args: { n: 1, target: -1 } })).why).toBe('bad_target');
    expect(failure(callTool(rig, { name: 'wait', args: { ms: 0 } })).why).toBe('bad_target');
    expect(rig.log).toEqual([]);
  });

  it('rejects malformed session files', () => {
    const root = tempDir();
    const extra = join(root, 'extra.json');
    writeFileSync(extra, JSON.stringify({ ...newSession(netlist, profile), wires: [] }));
    expect(() => readSession(extra)).toThrow(/malformed session file/);
    const badStep = join(root, 'step.json');
    writeFileSync(badStep, JSON.stringify({ ...newSession(netlist, profile), script: [{ k: 'expect', obs: [] }] }));
    expect(() => readSession(badStep)).toThrow(/malformed session file/);
    expect(() => readSession(join(root, 'missing.json'))).toThrow(/no session file/);

    const wrongProfile: Session = { ...newSession(netlist, profile), profile: 'MV601-IDEAL' };
    expect(() => replay(netlist, profile, wrongProfile)).toThrow(/profile/);
    const shortLoad: Session = {
      ...newSession(netlist, profile),
      script: [
        { k: 'load', program: 'I-EXP4', cords: 2 },
        { k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'hole', hole: '1A#1' as never }, b: { k: 'hole', hole: '1B#1' as never } } },
      ],
    };
    expect(() => replay(netlist, profile, shortLoad)).toThrow(/script\[0\] load of I-EXP4 must be followed by its 2 connect steps/);
    const badMarker = join(root, 'marker.json');
    writeFileSync(badMarker, JSON.stringify({ ...newSession(netlist, profile), script: [{ k: 'load', program: 'i-exp4', cords: 1 }] }));
    expect(() => readSession(badMarker)).toThrow(/malformed session file/);
    const touch: Session = {
      ...newSession(netlist, profile),
      script: [{ k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'touch', term: '1A' as never }, b: { k: 'free' } } }],
    };
    expect(() => replay(netlist, profile, touch)).toThrow(/hole to hole/);
  });

  it('reports a batch that does not settle without failing it', () => {
    const rig = createRig(netlist, profile);
    // A relay fed through its own N.C. contact (+ -> 1H arm, 1J N.C. -> 1E coil, 1F -> -) buzzes.
    const outcome = runBatch(rig, [connectCall('1+/1H'), connectCall('1J/1E'), connectCall('1F/1-'),
      { name: 'power', args: { on: true } }], 100);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.settle.settled).toBe(false);
    expect(outcome.settle.waitedTicks).toBe(1000);
    expect(outcome.settle.moving).toContain('relay1');
    expect(rig.log[rig.log.length - 1]).toEqual({ k: 'settle', maxMs: 100 });
  });

  it('flags a dial motor that is still turning after a settle', () => {
    const rig = createRig(netlist, profile);
    // RUN: power across D17 and D18 turns the dial motor.
    batch(rig, [connectCall('1+/D17'), connectCall('D18/1-'), { name: 'power', args: { on: true } }]);
    const outcome = runBatch(rig, [{ name: 'wait', args: { ms: 1000 } }]);
    expect(outcome.ok && outcome.settle.dialMrpm).toBeGreaterThan(0);
  });

  it('names the self-connect case when a terminal has only one free hole', () => {
    const rig = freshRig();
    expect(callTool(rig, connectCall('1A/1B')).ok).toBe(true);
    const result = failure(callTool(rig, connectCall('1A/1A')));
    expect(result.why).toBe('hole_occupied');
    expect(result.detail).toContain('connecting 1A to itself needs two free holes on 1A; only one is free');
  });

  it('caps wait and settle at one minute, before simulating anything', () => {
    const rig = freshRig();
    const wait = failure(callTool(rig, { name: 'wait', args: { ms: 60001 } }));
    expect(wait.why).toBe('bad_target');
    expect(wait.detail).toContain('1..60000');
    const outcome = runBatch(rig, [{ name: 'power', args: { on: true } }], 60001);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failedAt).toBe(1);
    expect(rig.log).toEqual([]);
  });

  it('refuses a wait that would run the tick counter past int32, without advancing', () => {
    const rig = freshRig();
    const real = rig.machine;
    let advanced = 0;
    const nearEnd: Rig = {
      ...rig,
      machine: new Proxy(real, {
        get(target, key) {
          if (key === 'snapshot') return () => ({ ...target.snapshot(), tick: 2147483647 - 100 });
          if (key === 'advance') return (ticks: number) => { advanced += ticks; target.advance(ticks); };
          const value = Reflect.get(target, key) as unknown;
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      }),
    };
    const wait = failure(callTool(nearEnd, { name: 'wait', args: { ms: 20 } }));
    expect(wait.detail).toContain('int32 tick limit');
    const outcome = runBatch(nearEnd, [{ name: 'wait', args: { ms: 5 } }]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.failedAt).toBe(1);
    expect(outcome.result.detail).toContain('int32 tick limit');
    expect(advanced).toBe(0);
  });

  it('refuses to replay a session recorded against a different netlist or profile', () => {
    const base = newSession(netlist, profile);
    expect(() => replay(netlist, profile, { ...base, netlistHash: 'fnv1a64:0000000000000000' }))
      .toThrow(/recorded against a different netlist.*start a new session/);
    expect(() => replay(netlist, profile, { ...base, profileHash: 'fnv1a64:0000000000000000' }))
      .toThrow(/recorded against a different profile.*start a new session/);
  });

  it('reports a malformed session file as a session error, not a fixture error', () => {
    const path = join(tempDir(), 'bad.json');
    writeFileSync(path, '{ not json');
    expect(() => readSession(path)).toThrow(SessionError);
    expect(() => readSession(path)).toThrow(/^malformed session file .*bad\.json: it is not valid JSON$/);
    expect(() => readSession(path)).not.toThrow(/fixture/);
  });
});

describe('hands change paths and settle notes', () => {
  it('shortens a buzzing relay change path to first -> ... -> last with a count', () => {
    const rig = freshRig();
    const outcome = runBatch(rig, [connectCall('1+/1H'), connectCall('1J/1E'), connectCall('1F/1-'),
      { name: 'power', args: { on: true } }]);
    if (!outcome.ok) throw new Error('batch failed');
    const relay = outcome.changes.find((change) => change.name === 'relay1');
    expect(relay?.elided).toBe(true);
    expect(relay?.values).toHaveLength(2);
    expect(relay?.values[0]).toBe('nc');
    expect(relay?.transitions).toBeGreaterThan(6);
    const power = outcome.changes.find((change) => change.name === 'power');
    expect(power).toEqual({ name: 'power', values: ['off', 'on'], transitions: 1, elided: false });
  });

  it('flags an I-EXP4 lamp still cooling through dim when settle returns', () => {
    const rig = freshRig();
    batch(rig, [connectCall('1+/1Y'), connectCall('1X/2Y'), connectCall('2X/2A'), connectCall('2B/2-'),
      { name: 'power', args: { on: true } }, { name: 'button', args: { n: 1, target: 1000 } },
      { name: 'button', args: { n: 2, target: 1000 } }]);
    const steady = runBatch(rig, [{ name: 'wait', args: { ms: 500 } }]);
    expect(steady.ok && steady.settle.lampsMoving).toEqual([]);
    const release = runBatch(rig, [{ name: 'button', args: { n: 1, target: 0 } }]);
    if (!release.ok) throw new Error('batch failed');
    expect(release.settle.settled).toBe(true);
    expect(observable(rig, 'outLamp2')).toBe('dim');
    expect(release.settle.lampsMoving).toEqual(['outLamp2']);
  });
});

const I_EXP4_WIRES = ['1+/1Y', '1X/2Y', '2X/2A', '2B/2-'];

describe('hands: breaker, relay and dial hand commands', () => {
  it('presses a pushbutton as a spring-return press: down, held, up, released time; replays identically', () => {
    const rig = freshRig();
    batch(rig, [connectCall('1+/1Y'), connectCall('1X/1A'), connectCall('1B/1-'), { name: 'power', args: { on: true } }]);
    const at = rig.log.length;
    batch(rig, [{ name: 'press', args: { n: 1 } }, { name: 'press', args: { n: 1, ms: 30 } }]);
    expect(rig.log.slice(at, at + 8)).toEqual([
      { k: 'do', cmd: { k: 'button', n: 1, target: 1000 } }, { k: 'advance', ms: PRESS_MS },
      { k: 'do', cmd: { k: 'button', n: 1, target: 0 } }, { k: 'advance', ms: PRESS_MS },
      { k: 'do', cmd: { k: 'button', n: 1, target: 1000 } }, { k: 'advance', ms: 30 },
      { k: 'do', cmd: { k: 'button', n: 1, target: 0 } }, { k: 'advance', ms: 30 },
    ]);
    expect(observable(rig, 'pb1')).toBe('nc');
    const again = replay(netlist, profile, sessionOf(rig, newSession(netlist, profile)));
    expect(again.machine.snapshot()).toEqual(rig.machine.snapshot());
    expect(failure(callTool(rig, { name: 'press', args: { n: 7 } })).why).toBe('bad_target');
    expect(failure(callTool(rig, { name: 'press', args: { n: 1, ms: 0 } })).why).toBe('bad_target');
    const tooLong = runBatch(rig, [{ name: 'press', args: { n: 1, ms: MAX_STEP_MS + 1 } }]);
    expect(tooLong.ok).toBe(false);
  });

  it('resets a tripped breaker and replays identically', () => {
    const rig = freshRig();
    batch(rig, [connectCall('1+/1-'), { name: 'power', args: { on: true } }]);
    expect(observable(rig, 'breaker')).toBe('tripped');
    batch(rig, [{ name: 'disconnect', args: { cord: 0 } }, { name: 'breaker', args: { reset: true } }]);
    expect(observable(rig, 'breaker')).toBe('ok');
    expect(rig.log.filter((step) => step.k === 'do').map((step) => step.k === 'do' && step.cmd.k))
      .toEqual(['connect', 'power', 'disconnect', 'breaker']);
    const again = replay(netlist, profile, sessionOf(rig, newSession(netlist, profile)));
    expect(again.machine.snapshot()).toEqual(rig.machine.snapshot());
  });

  it('holds relay 1 in by hand against its coil (Book I Exp 6), releases it, and replays identically', () => {
    const fixture = readStrictJson(new URL('../conformance/fixtures/A/I-EXP6.fixture.json', import.meta.url), 'I-EXP6') as Fixture;
    const rig = freshRig();
    batch(rig, [...fixture.wires.map(connectCall), { name: 'power', args: { on: true } }]);
    batch(rig, [{ name: 'relayGrab', args: { n: 1, target: 1000 } }, { name: 'wait', args: { ms: 200 } }]);
    expect([observable(rig, 'relay1'), observable(rig, 'outLamp1'), observable(rig, 'outLamp2')]).toEqual(['no', 'on', 'off']);
    expect(rig.machine.snapshot().relays[0]?.held).toBe(true);
    batch(rig, [{ name: 'relayRelease', args: { n: 1 } }, { name: 'wait', args: { ms: 200 } }]);
    expect([observable(rig, 'relay1'), observable(rig, 'outLamp2')]).toEqual(['nc', 'on']);
    expect(rig.machine.snapshot().relays[0]?.held).toBe(false);
    expect(failure(callTool(rig, { name: 'relayGrab', args: { n: 7, target: 0 } })).why).toBe('bad_target');
    expect(failure(callTool(rig, { name: 'relayRelease', args: { n: 0 } })).why).toBe('bad_target');
    const again = replay(netlist, profile, sessionOf(rig, newSession(netlist, profile)));
    expect(again.machine.snapshot()).toEqual(rig.machine.snapshot());
  });

  it('turns the dial by hand through every pad, flags the hand turn at settle, and replays identically', () => {
    const rig = freshRig();
    const grab = runBatch(rig, [{ name: 'dialGrab', args: { targetUdeg: 67_500_000 } }]);
    if (!grab.ok) throw new Error('batch failed');
    // Settle does not count the dial as motion, so it returns while the hand is still turning.
    expect(grab.settle.dialMrpm).not.toBe(0);
    expect(grab.settle.dialHeld).toBe(true);
    const turned = runBatch(rig, [{ name: 'wait', args: { ms: 500 } }]);
    if (!turned.ok) throw new Error('batch failed');
    expect(turned.changes.find((change) => change.name === 'dial')?.values).toEqual(['c0', 'gap', 'c1', 'gap', 'c2', 'gap', 'c3']);
    batch(rig, [{ name: 'dialRelease', args: {} }]);
    expect(rig.machine.snapshot().dial.held).toBe(false);
    expect(failure(callTool(rig, { name: 'dialGrab', args: { targetUdeg: 360_000_000 } })).why).toBe('bad_target');
    const again = replay(netlist, profile, sessionOf(rig, newSession(netlist, profile)));
    expect(again.machine.snapshot()).toEqual(rig.machine.snapshot());
  });
});

describe('hands: loadProgram', () => {
  it('loads I-EXP4 to the same cords as connecting its wires, behind one load marker', () => {
    const loaded = freshRig();
    const result = callTool(loaded, { name: 'loadProgram', args: { program: 'I-EXP4', wires: I_EXP4_WIRES } });
    expect(result.ok).toBe(true);
    expect(result.ok && result.cords?.map((cord) => cord.wire)).toEqual(I_EXP4_WIRES);
    const connected = freshRig();
    for (const wire of I_EXP4_WIRES) expect(callTool(connected, connectCall(wire)).ok).toBe(true);
    expect(loaded.cords).toEqual(connected.cords);
    expect(loaded.log[0]).toEqual({ k: 'load', program: 'I-EXP4', cords: 4 });
    expect(loaded.log.slice(1)).toEqual(connected.log);
    expect(observable(loaded, 'power')).toBe('off');

    batch(loaded, [{ name: 'power', args: { on: true } }, { name: 'button', args: { n: 1, target: 1000 } },
      { name: 'button', args: { n: 2, target: 1000 } }]);
    const path = join(tempDir(), 's.json');
    writeSessionFile(path, sessionOf(loaded, newSession(netlist, profile)));
    const again = replay(netlist, profile, readSession(path));
    expect(again.log).toEqual(loaded.log);
    expect(again.machine.snapshot()).toEqual(loaded.machine.snapshot());
    expect(observable(again, 'outLamp2')).toBe('on');
  });

  it('takes the lowest free holes after existing cords, as connect does', () => {
    const rig = freshRig();
    callTool(rig, connectCall('1+/3A'));
    const result = callTool(rig, { name: 'loadProgram', args: { program: 'I-EXP4', wires: I_EXP4_WIRES } });
    expect(result.ok && result.cords?.[0]).toEqual({ id: 1, a: '1+#2', b: '1Y#1', wire: '1+/1Y' });
  });

  it('fails atomically when a wire cannot be placed, plugging nothing', () => {
    const rig = freshRig();
    batch(rig, [connectCall('2A/1A'), connectCall('2A/1B')]);
    const cords = rig.cords.slice();
    const log = rig.log.slice();
    const result = failure(callTool(rig, { name: 'loadProgram', args: { program: 'I-EXP4', wires: I_EXP4_WIRES } }));
    expect(result.why).toBe('hole_occupied');
    expect(result.detail).toBe('load-program I-EXP4: wire 3 (2X/2A) cannot be placed: every hole of 2A is in use ' +
      '(cords 0, 1, and earlier wires of this program); nothing was plugged');
    expect(rig.cords).toEqual(cords);
    expect(rig.log).toEqual(log);
    // A program whose own wires overfill a terminal fails the same way.
    const self = failure(callTool(freshRig(), { name: 'loadProgram', args: { program: 'X1', wires: ['1A/1B', '1A/1C', '1A/1E'] } }));
    expect(self.detail).toContain('wire 3 (1A/1E) cannot be placed: every hole of 1A is in use by earlier wires of this program');
    expect(failure(callTool(freshRig(), { name: 'loadProgram', args: { program: 'X1', wires: ['1A/1Q'] } })).why).toBe('unknown_terminal');
    expect(failure(callTool(freshRig(), { name: 'loadProgram', args: { program: 'x1', wires: ['1A/1B'] } })).why).toBe('bad_program');
  });

  it('logs the load marker only after every connect of the load was applied', () => {
    const rig = freshRig();
    // A machine that refuses the third connect: the plan succeeds, the apply fails part way.
    let connects = 0;
    const real = rig.machine;
    const refusing: Rig = {
      ...rig,
      machine: new Proxy(real, {
        get(target, key) {
          if (key === 'apply') {
            return (cmd: Parameters<typeof real.apply>[0]) => {
              if (cmd.k === 'connect' && ++connects === 3) return { ok: false, why: 'hole_occupied' };
              return target.apply(cmd);
            };
          }
          const value = Reflect.get(target, key) as unknown;
          return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
        },
      }),
    };
    const result = failure(callTool(refusing, { name: 'loadProgram', args: { program: 'I-EXP4', wires: I_EXP4_WIRES } }));
    expect(result.why).toBe('hole_occupied');
    expect(refusing.log.some((step) => step.k === 'load')).toBe(false);

    const ok = freshRig();
    callTool(ok, { name: 'loadProgram', args: { program: 'I-EXP4', wires: I_EXP4_WIRES } });
    expect(ok.log.map((step) => step.k)).toEqual(['load', 'do', 'do', 'do', 'do']);
  });

  it('can sit inside a batch, between other commands', () => {
    const rig = freshRig();
    const outcome = runBatch(rig, [{ name: 'switch', args: { n: 1, target: 1000 } },
      { name: 'loadProgram', args: { program: 'I-EXP4', wires: I_EXP4_WIRES } }, { name: 'power', args: { on: true } }]);
    expect(outcome.ok).toBe(true);
    expect(rig.log.map((step) => step.k)).toEqual(['do', 'load', 'do', 'do', 'do', 'do', 'do', 'settle']);
  });

  it('still loads a session file written before load-program existed', () => {
    const path = join(tempDir(), 'old.json');
    const base = newSession(netlist, profile);
    writeFileSync(path, '{\n' +
      '  "schema": "minivac.session/1",\n' +
      '  "profile": "MV601-REF-A",\n' +
      '  "contract": "1.1.0",\n' +
      '  "netlistHash": ' + JSON.stringify(base.netlistHash) + ',\n' +
      '  "profileHash": ' + JSON.stringify(base.profileHash) + ',\n' +
      '  "script": [\n' +
      '    {"k":"do","cmd":{"k":"connect","cord":0,"a":{"k":"hole","hole":"1+#1"},"b":{"k":"hole","hole":"1A#1"}}},\n' +
      '    {"k":"do","cmd":{"k":"connect","cord":1,"a":{"k":"hole","hole":"1B#1"},"b":{"k":"hole","hole":"1-#1"}}},\n' +
      '    {"k":"do","cmd":{"k":"power","on":true}},\n' +
      '    {"k":"settle","maxMs":500},\n' +
      '    {"k":"advance","ms":500}\n' +
      '  ]\n}\n');
    const rig = replay(netlist, profile, readSession(path));
    expect(observable(rig, 'outLamp1')).toBe('on');
    expect(formatSession(sessionOf(rig, base))).toBe(readFileSync(path, 'utf8'));
  });
});
