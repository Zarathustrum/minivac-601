import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { State } from '../../src/core/contract.ts';
import type { HoleId } from '../../src/core/terminals.ts';
import type { BatchOutcome, StateView } from '../../src/hands/table.ts';
import { fileBackend } from '../../tools/hands/backend.ts';
import type { BatchReply, SessionBackend } from '../../tools/hands/backend.ts';
import { run, runWith } from '../../tools/hands/cli.ts';
import { parseInvocation } from '../../tools/hands/invocation.ts';
import type { BatchInvocation } from '../../tools/hands/invocation.ts';
import { formatState, renderBatch, renderLocal, renderNew, renderState } from '../../tools/hands/render.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'mv601-render-'));
  roots.push(root);
  return root;
}

const hole = (id: string): HoleId => id as HoleId;
const snapshot = { tick: 12345, marker: 'snapshot' } as unknown as State;

/** A state view with no machine behind it, as the chat pane's page would send one. */
const view: StateView = {
  tick: 12345,
  observables: [{ name: 'power', value: 'on' }, { name: 'outLamp1', value: 'dim' }],
  cords: [{ id: 0, a: hole('1A#1'), b: hole('1B#1'), wire: '1A/1B' }, { id: 2, a: hole('1+#1'), b: hole('1Y#2'), wire: '1+/1Y' }],
  snapshot,
};

const stateText = 'time 1234.5 ms (tick 12345)\npower on\noutLamp1 dim\ncords 2\ncord 0 1A/1B (1A#1 1B#1)\ncord 2 1+/1Y (1+#1 1Y#2)\n';

function batch(...argv: string[]): BatchInvocation {
  const invocation = parseInvocation(['s.json', ...argv], {});
  if (invocation.kind !== 'batch') throw new Error('expected a batch, got ' + invocation.kind);
  return invocation;
}

const settled = (outcome: Partial<Extract<BatchOutcome, { ok: true }>> = {}): BatchReply => ({
  ok: true,
  results: [{ ok: true, cord: { id: 0, a: hole('1A#1'), b: hole('1B#1'), wire: '1A/1B' } }, { ok: true }],
  settle: { settled: true, waitedTicks: 25, moving: [], chattering: [], dialMrpm: 0, dialHeld: false, lampsMoving: [] },
  changes: [{ name: 'power', values: ['off', 'on'], transitions: 1, elided: false }],
  view,
  ...outcome,
});

describe('renderer: state from a StateView', () => {
  it('formatState and state --json need only the view', () => {
    expect(formatState(view)).toBe(stateText);
    const state = parseInvocation(['s.json', 'state'], {});
    const json = parseInvocation(['s.json', 'state', '--json'], {});
    if (state.kind !== 'state' || json.kind !== 'state') throw new Error('expected state invocations');
    expect(renderState(state, view)).toEqual({ code: 0, stdout: stateText, stderr: '' });
    expect(renderState(json, view).stdout).toBe(JSON.stringify(snapshot, null, 2) + '\n');
    expect(renderState(state, 'missing')).toEqual({
      code: 1, stdout: '', stderr: 'minivac-control: no session file s.json (create one with: minivac-control new s.json)\n',
    });
  });
});

describe('renderer: batches, new and local answers', () => {
  it('a batch that ran, with and without a closing state', () => {
    const lines = 'ok  connect 1A/1B  -> cord 0 (1A#1 1B#1)\nok  power on\nsettled after 2.5 ms\nchanged: power off -> on\n';
    expect(renderBatch(batch('connect', '1A/1B', '+', 'power', 'on'), settled())).toEqual({ code: 0, stdout: lines, stderr: '' });
    expect(renderBatch(batch('connect', '1A/1B', '+', 'power', 'on', '+', 'state'), settled()).stdout).toBe(lines + stateText);
  });

  it('a batch that did not settle, with every note', () => {
    const reply = settled({
      settle: {
        settled: false, waitedTicks: 2000, moving: ['relay1'], chattering: ['relay2'], dialMrpm: 1500, dialHeld: false,
        lampsMoving: ['outLamp1'],
      } as Extract<BatchOutcome, { ok: true }>['settle'],
      changes: [{ name: 'relay1', values: ['nc', 'no'], transitions: 9, elided: true }],
    });
    expect(renderBatch(batch('connect', '1A/1B', '+', 'power', 'on', '--settle-ms', '200'), reply).stdout).toBe(
      'ok  connect 1A/1B  -> cord 0 (1A#1 1B#1)\nok  power on\n' +
      'did NOT settle within 200 ms: relay1 in travel, dial motor turning, relay2 chattering\n' +
      'note: dial motor still turning (1.5 rpm); settle does not wait for the dial, use wait <ms> to let it run\n' +
      'note: lamp(s) outLamp1 still warming/cooling; settle does not wait for lamp filaments (use wait)\n' +
      'changed: relay1 nc -> ... -> no (9 changes)\n');
  });

  it('a refused batch names the command, or the settle step past the last command', () => {
    const refused = (failedAt: number): BatchReply =>
      ({ ok: false, failedAt, result: { ok: false, why: 'hole_occupied', detail: 'every hole of 1+ is in use' } });
    const invocation = batch('power', 'on', '+', 'connect', '1+/1C', '--settle-ms', '300');
    expect(renderBatch(invocation, refused(1)).stderr).toBe(
      'minivac-control: command 2 (connect 1+/1C) rejected: hole_occupied: every hole of 1+ is in use; nothing saved\n');
    expect(renderBatch(invocation, refused(2)).stderr).toBe(
      'minivac-control: settle (--settle-ms 300) rejected: hole_occupied: every hole of 1+ is in use; nothing saved\n');
    expect(renderBatch(invocation, 'missing').stderr).toBe(
      'minivac-control: no session file s.json (create one with: minivac-control new s.json)\n');
  });

  it('new, help, usage errors and a refused wire', () => {
    const made = parseInvocation(['new', 's.json', '--profile', 'MV601-IDEAL'], {});
    if (made.kind !== 'new') throw new Error('expected new');
    expect(renderNew(made, 'created').stdout).toBe('created s.json (profile MV601-IDEAL, power off, no cords)\n');
    expect(renderNew(made, 'exists')).toEqual({
      code: 1, stdout: '', stderr: 'minivac-control: s.json already exists; not overwriting. To start the wiring over, ' +
        'keep this session and send: s.json disconnect all\n',
    });
    const empty = renderLocal({ kind: 'empty' });
    expect([empty.code, empty.stdout]).toEqual([1, '']);
    expect(empty.stderr).toBe(renderLocal({ kind: 'help', topic: 'main' }).stdout);
    expect(renderLocal({ kind: 'help', topic: 'terminals' }).stdout).toMatch(/^minivac-control help terminals: /);
    expect(renderLocal({ kind: 'error', message: 'usage: x' })).toEqual({ code: 1, stdout: '', stderr: 'minivac-control: usage: x\n' });
    const wire = parseInvocation(['s.json', 'connect', '+/1X'], {});
    if (wire.kind !== 'rejected') throw new Error('expected a rejection');
    expect(renderLocal(wire).stderr).toMatch(/^minivac-control: command 1 \(connect \+\/1X\) rejected: unknown_terminal: .*; the \+ and - rails are per section: write 1\+ to 6\+ or 1- to 6- \(see: minivac-control help terminals\)\n$/);
  });
});

describe('a backend that only returns data gives the CLI text', () => {
  it('replies recorded from the session file and sent through JSON render the same', () => {
    const dir = tempDir();
    const path = join(dir, 's.json');
    const replies: string[] = [];
    const record = <T>(reply: T): T => { replies.push(JSON.stringify(reply)); return reply; };
    const recording: SessionBackend = {
      create: (at, session) => record(fileBackend.create(at, session)),
      state: (at) => record(fileBackend.state(at)),
      run: (at, calls, settleMs) => record(fileBackend.run(at, calls, settleMs)),
    };
    const next = (): never => JSON.parse(replies.shift() as string) as never;
    const replayed: SessionBackend = { create: next, state: next, run: next };

    const calls = [
      ['new', path], ['new', path],
      [path, 'connect', '1+/1Y', '+', 'connect', '1X/2Y', '+', 'connect', '2X/2A', '+', 'connect', '2B/2-', '+', 'power', 'on'],
      [path, 'button', '1', 'down', '+', 'button', '2', 'down', '+', 'state'],
      [path, 'button', '1', 'up'],
      [path, 'power', 'on', '+', 'connect', '1+/1C', '+', 'connect', '1+/1C'],
      [path, 'load-program', 'I-EXP11', '+', 'dial', 'hold', '30', '+', 'state'],
      [path, 'state'], [path, 'state', '--json'],
      [join(dir, 'missing.json'), 'state'], [join(dir, 'missing.json'), 'power', 'on'],
    ];
    for (const argv of calls) {
      const fromFile = runWith(argv, recording, {});
      expect(runWith(argv, replayed, {})).toEqual(fromFile);
    }
    expect(replies).toEqual([]);
    expect(runWith([path, 'state'], fileBackend, {})).toEqual(run([path, 'state']));
  });
});
