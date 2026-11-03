import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newSession, parseWire, replay, runBatch, sessionOf } from '../../src/hands/table.ts';
import type { Session, ToolCall } from '../../src/hands/table.ts';
import { checkItem, readItem, run } from '../../tools/checklist/check.ts';
import type { BasicItem, Item, OperateItem, WireItem } from '../../tools/checklist/check.ts';
import { formatSession, loadRepoNetlist, loadRepoProfile } from '../../tools/hands/session-file.ts';
import { readStrictJson, REPO_ROOT } from '../conformance/helpers.ts';
import type { Fixture } from '../conformance/types.ts';

const netlist = loadRepoNetlist();
const ITEMS = resolve(REPO_ROOT, 'checklist/items');
const WIRE_IDS = ['I-EXP4', 'I-EXP5', 'III-XOR-PB', 'III-RELAYOR', 'IV-EXP4'];
const BASIC_IDS = ['B1', 'B2', 'B3', 'B4'];
const OPERATE_IDS = ['OP1', 'OP2', 'OP3'];
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'mv601-check-'));
  roots.push(root);
  return root;
}

function item(id: string): Item {
  return readItem(join(ITEMS, id + '.json'));
}

function wireItem(id: string): WireItem {
  const found = item(id);
  if (found.kind !== 'wire') throw new Error(id + ' is not a wire item');
  return found;
}

function withoutExtra(found: WireItem): WireItem {
  const copy = { ...found };
  delete copy.extra;
  return copy;
}

function fixtureOf(found: WireItem): Fixture {
  return readStrictJson(resolve(REPO_ROOT, found.fixture), found.fixture) as Fixture;
}

function connect(text: string): ToolCall {
  const wire = parseWire(text);
  if ('ok' in wire) throw new Error('bad wire ' + text);
  return { name: 'connect', args: wire };
}

/** A session built through the tool table, one batch per entry (each batch settles). */
function session(batches: ToolCall[][], profileId = 'MV601-REF-A'): Session {
  const profile = loadRepoProfile(profileId);
  const base = newSession(netlist, profile);
  const rig = replay(netlist, profile, base);
  for (const calls of batches) {
    const outcome = runBatch(rig, calls);
    if (!outcome.ok) throw new Error('batch failed at ' + outcome.failedAt + ': ' + outcome.result.detail);
  }
  return sessionOf(rig, base);
}

function wired(wires: readonly string[], ...more: ToolCall[][]): Session {
  return session([wires.map(connect), ...more]);
}

const POWER_ON: ToolCall = { name: 'power', args: { on: true } };
const load = (program: string, wires: string[]): ToolCall => ({ name: 'loadProgram', args: { program, wires } });
const button = (n: number, target: number): ToolCall => ({ name: 'button', args: { n, target } });
const slide = (n: number, target: number): ToolCall => ({ name: 'switch', args: { n, target } });

describe('checklist items', () => {
  it('every item file validates, is named by its id, and wire items name an existing fixture of that id', () => {
    const files = readdirSync(ITEMS).filter((name) => name.endsWith('.json')).sort();
    expect(files).toEqual([...BASIC_IDS, ...WIRE_IDS, ...OPERATE_IDS].map((id) => id + '.json').sort());
    for (const file of files) {
      const found = readItem(join(ITEMS, file));
      expect(found.id + '.json').toBe(file);
      if (found.kind === 'wire') {
        expect(existsSync(resolve(REPO_ROOT, found.fixture))).toBe(true);
        expect(fixtureOf(found).id).toBe(found.id);
        expect(found.extra?.length ?? 0).toBeGreaterThan(0);
      }
      if (found.kind === 'operate') expect(existsSync(resolve(REPO_ROOT, found.program))).toBe(true);
    }
  });

  it('rejects an item that breaks the schema or names an unknown terminal', () => {
    const dir = tempDir();
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ schema: 'minivac.checkitem/1', id: 'X1', kind: 'wire', prompt: 'p' }));
    expect(() => readItem(bad)).toThrow(/invalid item/);
    writeFileSync(bad, JSON.stringify({
      schema: 'minivac.checkitem/1', id: 'X1', kind: 'basic', prompt: 'p', cords: ['1+/1Q'],
      expect: [{ dev: 'power', v: 'on' }],
    }));
    expect(() => readItem(bad)).toThrow(/cord "1\+\/1Q"/);
    writeFileSync(bad, JSON.stringify({
      schema: 'minivac.checkitem/1', id: 'X1', kind: 'operate', prompt: 'p',
      program: 'test/conformance/fixtures/A/I-EXP4.fixture.json',
      steps: [{ cmd: { k: 'disconnect', cord: 0 } }], expect: [{ dev: 'power', v: 'on' }],
    }));
    expect(() => readItem(bad)).toThrow(/steps cannot disconnect/);
    // A dial step matches any angle, so its checkpoint must name the dial position.
    const dialStep = (obs: { dev: string; v: string }[]) => ({
      cmd: { k: 'dialGrab', targetUdeg: 22500000 },
      expect: { k: 'expect', obs, cite: 'c', quote: 'q' },
    });
    const dialItem = (steps: unknown[]) => JSON.stringify({
      schema: 'minivac.checkitem/1', id: 'X1', kind: 'operate', prompt: 'p',
      program: 'test/conformance/fixtures/C1/I-EXP11.fixture.json', steps, expect: [{ dev: 'dial', v: 'c1' }],
    });
    writeFileSync(bad, dialItem([{ cmd: { k: 'dialGrab', targetUdeg: 22500000 } }]));
    expect(() => readItem(bad)).toThrow(/dial step 1 needs a checkpoint on the dial/);
    writeFileSync(bad, dialItem([dialStep([{ dev: 'outLamp5', v: 'on' }])]));
    expect(() => readItem(bad)).toThrow(/dial step 1 needs a checkpoint on the dial/);
    writeFileSync(bad, dialItem([dialStep([{ dev: 'dial', v: 'c1' }])]));
    expect(readItem(bad).id).toBe('X1');
  });
});

describe('free-ended cords', () => {
  it('a basic item counts a free-ended cord as an extra cord', () => {
    const result = checkItem(item('B1'), wired(['1+/1A', '1B/1-', 'M10/free'], [POWER_ON]));
    expect(result.code).not.toBe(0);
    expect(result.stdout).toContain('extra cord M10/free (cord 2)');
  });

  it('a wire item ignores a free-ended lead, which joins nothing', () => {
    const found = wireItem('I-EXP4');
    expect(checkItem(found, wired([...fixtureOf(found).wires, 'M10/free'])).stdout).toBe('PASS I-EXP4\n');
  });
});

describe('wire items', () => {
  it.each(WIRE_IDS)('%s passes on its reference wiring, extras included, and never writes the fixture', (id) => {
    const found = wireItem(id);
    const before = readFileSync(resolve(REPO_ROOT, found.fixture));
    const result = checkItem(found, wired(fixtureOf(found).wires));
    expect(result.stdout).toBe('PASS ' + id + '\n');
    expect(result.code).toBe(0);
    expect(readFileSync(resolve(REPO_ROOT, found.fixture)).equals(before)).toBe(true);
  });

  it('ignores the operator presses and power: only the final cords count', () => {
    const found = wireItem('I-EXP4');
    const pressed = wired(fixtureOf(found).wires, [POWER_ON, button(1, 1000)]);
    expect(checkItem(found, pressed).code).toBe(0);
  });

  it('I-EXP4 passes an equivalent circuit wired differently (another + tap, buttons swapped)', () => {
    const result = checkItem(wireItem('I-EXP4'), wired(['3+/2Y', '2X/1Y', '1X/2A', '2B/2-']));
    expect(result.stdout).toBe('PASS I-EXP4\n');
  });

  it('III-RELAYOR: lamp 3 straight across + and - passes the reference alone but fails the extras', () => {
    const found = wireItem('III-RELAYOR');
    const straight = wired(['3+/3A', '3B/3-']);
    expect(checkItem(withoutExtra(found), straight).code).toBe(0);
    const result = checkItem(found, straight);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL III-RELAYOR: extra\[\d+\] relay1 expected no, got nc: "/);
  });

  it('III-RELAYOR: buttons straight to lamp 3 with no relay pass the reference alone but fail the relay extras', () => {
    const found = wireItem('III-RELAYOR');
    const noRelay = wired(['1+/1Y', '1X/3A', '2+/2Y', '2X/3A', '3B/3-']);
    expect(checkItem(withoutExtra(found), noRelay).code).toBe(0);
    const result = checkItem(found, noRelay);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL III-RELAYOR: extra\[\d+\] relay1 expected no, got nc: ".*" \[unverified, derived\]\n/);
  });

  it('III-RELAYOR: the relay XOR circuit passes the reference alone but fails the both-relays extra', () => {
    const found = wireItem('III-RELAYOR');
    const xorWires = (readStrictJson(resolve(REPO_ROOT, 'test/conformance/fixtures/A/III-RELAYXOR.fixture.json'), 'xor') as Fixture).wires;
    const xor = wired(xorWires);
    expect(checkItem(withoutExtra(found), xor).code).toBe(0);
    expect(checkItem(found, xor).stdout).toMatch(/^FAIL III-RELAYOR: extra\[\d+\] outLamp3 expected on, got off: ".*" \[unverified, derived\]\n/);
  });

  it('III-XOR-PB: a NAND (both N.C. contacts in parallel) passes the reference alone but fails the extra', () => {
    const found = wireItem('III-XOR-PB');
    const nand = wired(['1+/1Y', '1Z/3A', '2+/2Y', '2Z/3A', '3B/3-']);
    expect(checkItem(withoutExtra(found), nand).code).toBe(0);
    expect(checkItem(found, nand).stdout).toMatch(/^FAIL III-XOR-PB: extra\[3\] outLamp3 expected off, got on: ".*" \[unverified, derived\]\n$/);
  });

  it('I-EXP5: a relay that latches lamp 1 on passes the reference alone but fails the extra', () => {
    const found = wireItem('I-EXP5');
    const latch = wired([
      '1+/1Y', '1X/M10', '2+/2Y', '2X/M10', 'M10/1C', '1F/1-', // either button energises relay 1
      '1+/1H', '1G/M10', // relay 1 holds itself in
      '3+/1L', '1K/1A', '1B/1-', // lamp 1 follows relay 1
    ]);
    expect(checkItem(withoutExtra(found), latch).code).toBe(0);
    expect(checkItem(found, latch).stdout).toMatch(/^FAIL I-EXP5: extra\[4\] outLamp1 expected off, got on: "The light does not come on because there is not a closed circuit\." \[unverified, derived\]\n$/);
  });

  it('IV-EXP4: carry lamp 5 on pushbutton 6 alone passes the reference alone but fails the carry-off extras', () => {
    const found = wireItem('IV-EXP4');
    const wrong = wired(['6X/5A', '5B/5-', '6A/6S', '6B/6-', '6R/6Z', '6T/6X', '6T/6V', '6Y/6+']);
    expect(checkItem(withoutExtra(found), wrong).code).toBe(0);
    expect(checkItem(found, wrong).stdout).toMatch(/^FAIL IV-EXP4: extra\[9\] outLamp5 expected off, got on/);
  });

  it('reports a wiring that fails the manual script with the manual quote', () => {
    const result = checkItem(wireItem('I-EXP4'), wired(['1+/2A', '2B/2-']));
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL I-EXP4: script\[3\] outLamp2 expected off, got on: "It does NOT light because/);
  });

  it('fails a session that used load-program, even with the right wires (O4)', () => {
    const found = wireItem('I-EXP4');
    const loaded = session([[load('I-EXP4', fixtureOf(found).wires)]]);
    const result = checkItem(found, loaded);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('FAIL I-EXP4: used load-program, which a wiring item does not allow (O4)\n');
  });

  it('errors on an empty session and on a profile mismatch', () => {
    const found = wireItem('I-EXP4');
    const empty = checkItem(found, session([]));
    expect(empty.code).toBe(2);
    expect(empty.stdout).toMatch(/^ERROR I-EXP4: the session has no cords/);
    const ideal = checkItem(found, session([fixtureOf(found).wires.map(connect)], 'MV601-IDEAL'));
    expect(ideal.code).toBe(2);
    expect(ideal.stdout).toMatch(/^ERROR I-EXP4: profile mismatch: the session uses MV601-IDEAL/);
  });
});

describe('basic items', () => {
  const reference: Record<string, ToolCall[][]> = {
    B1: [[connect('1+/1A'), connect('1B/1-'), POWER_ON]],
    B2: [[connect('1+/1Y'), connect('1X/1A'), connect('1B/1-'), POWER_ON], [button(1, 1000)]],
    B3: [[connect('3+/3A'), connect('3B/3-'), POWER_ON], [{ name: 'disconnect', args: { a: '3+', b: '3A' } }]],
    B4: [[connect('2+/2V'), connect('2W/2A'), connect('2B/2-'), POWER_ON], [slide(2, 1000)]],
  };

  it.each(BASIC_IDS)('%s passes when the prompt is followed literally', (id) => {
    expect(checkItem(item(id), session(reference[id] as ToolCall[][])).stdout).toBe('PASS ' + id + '\n');
  });

  it('matches cords as unordered pairs but keeps exact terminals', () => {
    const b1 = item('B1');
    expect(checkItem(b1, session([[connect('1A/1+'), connect('1-/1B'), POWER_ON]])).code).toBe(0);
    const other = checkItem(b1, session([[connect('2+/1A'), connect('1B/1-'), POWER_ON]]));
    expect(other.code).toBe(1);
    expect(other.stdout).toBe('FAIL B1: missing cord 1+/1A\n  extra cord 2+/1A (cord 0)\n');
  });

  it('B1 fails with the wrong cord and lists every mismatch', () => {
    const result = checkItem(item('B1'), session([[connect('1+/1B'), connect('1B/1-'), POWER_ON]]));
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL B1: missing cord 1\+\/1A\n {2}extra cord 1\+\/1B \(cord 0\)\n {2}.*outLamp1 expected on, got off\n$/s);
  });

  it('B2 fails with the button released', () => {
    const steps = [reference['B2']?.[0] as ToolCall[], [button(1, 1000)], [button(1, 0)]];
    const result = checkItem(item('B2'), session(steps));
    expect(result.stdout).toBe('FAIL B2: pb1 expected no, got nc\n  outLamp1 expected on, got off\n');
  });

  it('B3 fails with the 3A cord still in', () => {
    const result = checkItem(item('B3'), session([reference['B3']?.[0] as ToolCall[]]));
    expect(result.stdout).toBe('FAIL B3: extra cord 3+/3A (cord 0)\n  outLamp3 expected off, got on\n');
  });

  it('B3 fails when 3+/3A was never plugged in', () => {
    const result = checkItem(item('B3'), session([[connect('3B/3-'), POWER_ON]]));
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('FAIL B3: never connected 3+/3A\n');
  });

  it('refuses a session on a profile other than MV601-REF-A', () => {
    const result = checkItem(item('B1'), session(reference['B1'] as ToolCall[][], 'MV601-IDEAL'));
    expect(result.code).toBe(2);
    expect(result.stdout).toMatch(/^ERROR B1: profile mismatch: the session uses MV601-IDEAL/);
  });

  it('B1 fails when its cords came from load-program I-EXP1 (O4)', () => {
    const loaded = session([[load('I-EXP1', ['1+/1A', '1B/1-']), POWER_ON]]);
    const result = checkItem(item('B1'), loaded);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('FAIL B1: used load-program, which a basic item does not allow (O4)\n');
  });

  it('B4 fails with the switch left', () => {
    const result = checkItem(item('B4'), session([reference['B4']?.[0] as ToolCall[]]));
    expect(result.stdout).toBe('FAIL B4: sw2 expected no, got nc\n  outLamp2 expected on, got off\n');
  });

  it('is deterministic: same item and session, same output', () => {
    const b2 = item('B2') as BasicItem;
    const s = session(reference['B2'] as ToolCall[][]);
    expect(checkItem(b2, s)).toEqual(checkItem(b2, s));
  });
});

describe('minivac-check CLI', () => {
  it('errors on a corrupt session file and on bad arguments (in-process)', () => {
    const dir = tempDir();
    const corrupt = join(dir, 's.json');
    writeFileSync(corrupt, '{"schema": "minivac.session/1"}\n');
    const result = run([join(ITEMS, 'B1.json'), corrupt]);
    expect(result.code).toBe(2);
    expect(result.stdout).toMatch(/^ERROR B1: malformed session file /);
    expect(run([]).code).toBe(2);
  });

  it('exits 0 on pass, 1 on fail, 2 on error (spawned)', () => {
    const dir = tempDir();
    const cli = resolve(REPO_ROOT, 'bin/minivac-check');
    const good = join(dir, 'good.json');
    const bad = join(dir, 'bad.json');
    writeFileSync(good, formatSession(session([[connect('1+/1A'), connect('1B/1-'), POWER_ON]])));
    writeFileSync(bad, formatSession(session([[connect('1+/1A'), connect('1B/1-')]])));
    const sh = (...args: string[]) => spawnSync(cli, args, { cwd: dir, encoding: 'utf8' });
    const pass = sh(join(ITEMS, 'B1.json'), good);
    expect([pass.status, pass.stdout]).toEqual([0, 'PASS B1\n']);
    const fail = sh(join(ITEMS, 'B1.json'), bad);
    expect(fail.status).toBe(1);
    expect(fail.stdout).toMatch(/^FAIL B1: power expected on, got off\n/);
    const usage = sh(join(ITEMS, 'B1.json'));
    expect(usage.status).toBe(2);
    expect(usage.stderr).toMatch(/^usage: minivac-check/);
    const missing = sh(join(ITEMS, 'B1.json'), join(dir, 'nope.json'));
    expect(missing.status).toBe(2);
    expect(missing.stdout).toMatch(/^ERROR B1: no session file /);
  });
});

function operateItem(id: string): OperateItem {
  const found = item(id);
  if (found.kind !== 'operate') throw new Error(id + ' is not an operate item');
  return found;
}

function programWires(found: OperateItem): string[] {
  return (readStrictJson(resolve(REPO_ROOT, found.program), found.program) as Fixture).wires;
}

/** Each press and release in its own call, as an operator naturally sends them. */
function presses(n: number, count: number): ToolCall[][] {
  const out: ToolCall[][] = [];
  for (let i = 0; i < count; i++) out.push([button(n, 1000)], [button(n, 0)]);
  return out;
}

describe('operate items', () => {
  const tap1ms = (n: number): ToolCall[] => [button(n, 1000), { name: 'wait', args: { ms: 1 } }, button(n, 0)];

  it('OP1 passes on load-program + power on + three presses of pushbutton 6, and on a hand-wired counter', () => {
    const op1 = operateItem('OP1');
    const wires = programWires(op1);
    expect(checkItem(op1, session([[load('IV-EXP1-SLOW', wires), POWER_ON], ...presses(6, 3)])).stdout).toBe('PASS OP1\n');
    // Hand-wired, in reverse order, with 1G on the 2+ tap instead of 1+.
    const hand = wires.slice().reverse().map((wire) => (wire === '1G/1+' ? '1G/2+' : wire));
    expect(checkItem(op1, session([hand.map(connect), [POWER_ON], ...presses(6, 3)])).stdout).toBe('PASS OP1\n');
  });

  it('passes OP1 and OP2 when power went on before load-program (power is not a step)', () => {
    const op1 = operateItem('OP1');
    expect(checkItem(op1, session([[POWER_ON], [load('IV-EXP1-SLOW', programWires(op1))], ...presses(6, 3)])).stdout)
      .toBe('PASS OP1\n');
    const op2 = operateItem('OP2');
    expect(checkItem(op2, session([[POWER_ON], [load('V-EXP2', programWires(op2))], ...presses(1, 1), ...presses(3, 1)])).stdout)
      .toBe('PASS OP2\n');
  });

  it('OP1 and OP2 pass with the press tool, one press per call', () => {
    const press = (n: number): ToolCall => ({ name: 'press', args: { n } });
    const op1 = operateItem('OP1');
    const counter = programWires(op1);
    expect(checkItem(op1, session([[load('IV-EXP1-SLOW', counter), POWER_ON], [press(6)], [press(6)], [press(6)]])).stdout)
      .toBe('PASS OP1\n');
    const op2 = operateItem('OP2');
    const alarm = programWires(op2);
    expect(checkItem(op2, session([[load('V-EXP2', alarm), POWER_ON], [press(1)], [press(3)]])).stdout).toBe('PASS OP2\n');
  });

  it('OP1 fails a count to two at the steps', () => {
    const op1 = operateItem('OP1');
    const two = checkItem(op1, session([[load('IV-EXP1-SLOW', programWires(op1)), POWER_ON], ...presses(6, 2)]));
    expect(two.code).toBe(1);
    expect(two.stdout).toBe('FAIL OP1: step 5 of 6 (button 6 down) not done after the wiring was finished\n');
  });

  it('OP1 fails a count to four and eleven presses (which wraps round to 3): nothing may follow the last step', () => {
    const op1 = operateItem('OP1');
    const line = 'FAIL OP1: button 6 down was sent after step 6 of 6 (button 6 up), the last step on that control\n';
    expect(checkItem(op1, session([[load('IV-EXP1-SLOW', programWires(op1)), POWER_ON], ...presses(6, 4)])).stdout).toBe(line);
    const eleven = session([[load('IV-EXP1-SLOW', programWires(op1)), POWER_ON], ...presses(6, 11)]);
    expect(checkItem(op1, eleven).stdout).toBe(line);
    // Eleven presses end on 011, so the end state alone would pass.
    expect(checkItem({ ...op1, steps: [] as never }, eleven).code).toBe(0);
  });

  it('OP1 fails three 1 ms presses followed by relays 3..6 held in and released, at the first checkpoint', () => {
    const op1 = operateItem('OP1');
    const relays = [3, 4, 5, 6];
    const result = checkItem(op1, session([[load('IV-EXP1-SLOW', programWires(op1)), POWER_ON], tap1ms(6), tap1ms(6), tap1ms(6),
      relays.map((n): ToolCall => ({ name: 'relayGrab', args: { n, target: 1000 } })),
      relays.map((n): ToolCall => ({ name: 'relayRelease', args: { n } }))]));
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL OP1: step 2 of 6 \(button 6 up\) checkpoint: outLamp6 expected on, got off: "0 \| NO \| 0 \| NO \| 1 \| UP \| 1"\n/);
  });

  it('OP1 does not count a press and release sent with no time between them', () => {
    const op1 = operateItem('OP1');
    const zero = [[button(6, 1000), button(6, 0)], [button(6, 1000), button(6, 0)], [button(6, 1000), button(6, 0)]];
    const result = checkItem(op1, session([[load('IV-EXP1-SLOW', programWires(op1)), POWER_ON], ...zero]));
    expect(result.stdout).toBe('FAIL OP1: step 1 of 6 (button 6 down) not done after the wiring was finished ' +
      '(it was sent, but a later command in the same call replaced it before any time passed)\n');
  });

  it('OP1 fails steps sent before the wiring was finished', () => {
    const op1 = operateItem('OP1');
    const wires = programWires(op1);
    const early = session([wires.slice(0, -1).map(connect), [POWER_ON], ...presses(6, 3), [connect(wires.at(-1) as string)]]);
    expect(checkItem(op1, early).stdout).toBe('FAIL OP1: step 1 of 6 (button 6 down) not done after the wiring was finished\n');
  });

  it('OP2 passes on load-program + power on + reset + door 3, and hand-wired', () => {
    const op2 = operateItem('OP2');
    const wires = programWires(op2);
    const procedure = [[POWER_ON], ...presses(1, 1), ...presses(3, 1)];
    expect(checkItem(op2, session([[load('V-EXP2', wires)], ...procedure])).stdout).toBe('PASS OP2\n');
    expect(checkItem(op2, session([wires.map(connect), ...procedure])).stdout).toBe('PASS OP2\n');
  });

  it('OP2 fails a session that never reset, though light 5 ends on either way', () => {
    const op2 = operateItem('OP2');
    const skipped = session([[load('V-EXP2', programWires(op2)), POWER_ON], ...presses(3, 1)]);
    const result = checkItem(op2, skipped);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('FAIL OP2: step 1 of 4 (button 1 down) not done after the wiring was finished\n');
    // The end state alone cannot tell: keep only the door steps and the same session passes.
    expect(checkItem({ ...op2, steps: op2.steps.slice(3) }, skipped).code).toBe(0);
  });

  it('OP2 fails a reset pressed while door 3 is held open, at the reset checkpoint', () => {
    const op2 = operateItem('OP2');
    const held = session([[load('V-EXP2', programWires(op2)), POWER_ON], [button(3, 1000)], ...presses(1, 1), [button(3, 0)],
      ...presses(3, 1)]);
    const result = checkItem(op2, held);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL OP2: step 2 of 4 \(button 1 up\) checkpoint: outLamp5 expected off, got on: "Set the system by pushing the re-set button \(pushbutton 1\)\. The burglar alarm is now set\." \[unverified, derived\]\n {2}relay6 expected no, got nc: /);
  });

  it('OP2 fails a 1 ms reset (button 1 down + wait 1 + button 1 up), at the reset checkpoint', () => {
    const op2 = operateItem('OP2');
    const result = checkItem(op2, session([[load('V-EXP2', programWires(op2)), POWER_ON], tap1ms(1), ...presses(3, 1)]));
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL OP2: step 2 of 4 \(button 1 up\) checkpoint: outLamp5 expected off, got on: /);
  });

  it('OP2 fails a reset and no door at the steps', () => {
    const op2 = operateItem('OP2');
    const noDoor = session([[load('V-EXP2', programWires(op2)), POWER_ON], ...presses(1, 1)]);
    expect(checkItem(op2, noDoor).stdout).toBe('FAIL OP2: step 3 of 4 (button 3 down) not done after the wiring was finished\n');
  });

  it('OP2 fails a two-cord circuit that only lights lamp 5, at the wiring stage (extras)', () => {
    const op2 = operateItem('OP2');
    const fake = session([[connect('5+/5A'), connect('5B/5-'), POWER_ON], ...presses(1, 1), ...presses(3, 1)]);
    const result = checkItem(op2, fake);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL OP2: the cords do not run V-EXP2: extra\[\d+\] relay6 expected no, got nc: "Set the system by pushing the re-set button \(pushbutton 1\)\./);
  });

  it('OP2 fails at the wiring stage when the session runs another program', () => {
    const op1 = operateItem('OP1');
    const op2 = operateItem('OP2');
    const counter = session([[load('IV-EXP1-SLOW', programWires(op1)), POWER_ON], ...presses(1, 1), ...presses(3, 1)]);
    const result = checkItem(op2, counter);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL OP2: the cords do not run V-EXP2: script\[\d+\] outLamp5 expected on, got off: "/);
  });

  it('an operate item fails at the wiring stage when the session runs another program', () => {
    const op1 = operateItem('OP1');
    const op2 = operateItem('OP2');
    const alarm = session([[load('V-EXP2', programWires(op2)), POWER_ON], ...presses(1, 1), ...presses(3, 1)]);
    const result = checkItem(op1, alarm);
    expect(result.code).toBe(1);
    expect(result.stdout).toMatch(/^FAIL OP1: the cords do not run IV-EXP1-SLOW: script\[2\] outLamp5 expected off, got on: "0 \| NO \| 0 \| NO \| 0 \| UP \| 0"\n {2}script\[5\] /);
    expect(checkItem(op1, session([])).stdout).toMatch(/^ERROR OP1: the session has no cords/);
  });
});

describe('dial steps (OP3)', () => {
  // On MV601-REF-A contact 1 holds from about 15 to 30 degrees, contact 2 from about 37.5 to 52.5.
  const turn = (degrees: number): ToolCall[] => [
    { name: 'dialGrab', args: { targetUdeg: Math.round(degrees * 1_000_000) } },
    { name: 'wait', args: { ms: 500 } },
  ];
  const op3 = (): OperateItem => operateItem('OP3');
  const loaded = (...angles: number[]): Session =>
    session([[load('I-EXP11', programWires(op3())), POWER_ON], ...angles.map(turn)]);

  it('passes on load-program + power on + the pointer to 1 then 2, at the nominal angles and others on the same contacts', () => {
    expect(checkItem(op3(), loaded(22.5, 45)).stdout).toBe('PASS OP3\n');
    expect(checkItem(op3(), loaded(20, 50)).stdout).toBe('PASS OP3\n');
  });

  it('passes hand-wired, in reverse order', () => {
    const hand = programWires(op3()).slice().reverse();
    expect(checkItem(op3(), session([hand.map(connect), [POWER_ON], turn(22.5), turn(45)])).stdout).toBe('PASS OP3\n');
  });

  it('fails the pointer turned to 2 first, at the first checkpoint', () => {
    expect(checkItem(op3(), loaded(45, 22.5)).stdout)
      .toMatch(/^FAIL OP3: step 1 of 2 \(dial hold, any angle\) checkpoint: dial expected c1, got c2: "Light 5 comes ON/);
  });

  it('fails a pointer left between contacts 1 and 2, at the second checkpoint', () => {
    expect(checkItem(op3(), loaded(22.5, 33.75)).stdout)
      .toMatch(/^FAIL OP3: step 2 of 2 \(dial hold, any angle\) checkpoint: dial expected c2, got gap: "Rotate the pointer/);
  });

  it('passes a dial release after the last turn: with no motor wired the pointer stays on 2', () => {
    const release: ToolCall[] = [{ name: 'dialRelease', args: {} }, { name: 'wait', args: { ms: 500 } }];
    const base = loaded(22.5, 45);
    const rig = replay(netlist, loadRepoProfile('MV601-REF-A'), base);
    const outcome = runBatch(rig, release);
    if (!outcome.ok) throw new Error('release refused');
    expect(checkItem(op3(), sessionOf(rig, base)).stdout).toBe('PASS OP3\n');
  });

  it('fails a further dial hold after the last turn', () => {
    expect(checkItem(op3(), loaded(22.5, 45, 22.5)).stdout)
      .toBe('FAIL OP3: dial hold 22.5 was sent after step 2 of 2 (dial hold, any angle), the last step on that control\n');
  });

  it('fails a pointer turned only to 1, at the steps', () => {
    expect(checkItem(op3(), loaded(22.5)).stdout)
      .toBe('FAIL OP3: step 2 of 2 (dial hold, any angle) not done after the wiring was finished\n');
  });
});
