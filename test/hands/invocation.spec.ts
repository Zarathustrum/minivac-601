import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { newSession } from '../../src/hands/table.ts';
import { parseInvocation } from '../../tools/hands/invocation.ts';
import type { Invocation } from '../../tools/hands/invocation.ts';
import { loadRepoNetlist, loadRepoProfile, readProgramWires } from '../../tools/hands/session-file.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'mv601-invocation-'));
  roots.push(root);
  return root;
}

const unpinned = {};
const parse = (...argv: string[]): Invocation => parseInvocation(argv, unpinned);

function message(invocation: Invocation): string {
  if (invocation.kind !== 'error') throw new Error('expected an error, got ' + invocation.kind);
  return invocation.message;
}

describe('parseInvocation: help and new', () => {
  it('describes help without rendering it', () => {
    expect(parse()).toEqual({ kind: 'empty' });
    for (const word of ['help', '--help', '-h']) {
      expect(parse(word)).toEqual({ kind: 'help', topic: 'main' });
      expect(parse(word, 'terminals')).toEqual({ kind: 'help', topic: 'terminals' });
      expect(message(parse(word, 'x'))).toBe('usage: minivac-control help [terminals]');
    }
  });

  it('new carries the empty session it would start, and touches no file', () => {
    const path = join(tempDir(), 's.json');
    expect(parse('new', path)).toEqual({
      kind: 'new', path, session: newSession(loadRepoNetlist(), loadRepoProfile('MV601-REF-A')),
    });
    const ideal = parse('new', path, '--profile', 'MV601-IDEAL');
    expect(ideal.kind === 'new' && ideal.session.profile).toBe('MV601-IDEAL');
    expect(existsSync(path)).toBe(false);
    expect(existsSync(path + '.lock')).toBe(false);

    expect(message(parse('new', path, '--profile', 'nope'))).toBe('no profile "nope" in data/profiles/');
    expect(message(parse('new', path, '+', 'power', 'on'))).toMatch(/^new takes only the session file; /);
    expect(message(parse('new'))).toBe('usage: minivac-control new <session.json> [--profile <id>]');
  });
});

describe('parseInvocation: state and batches', () => {
  it('a lone state reads the session; --json asks for the snapshot', () => {
    expect(parse('s.json', 'state')).toEqual({ kind: 'state', path: 's.json', json: false });
    expect(parse('s.json', 'state', '--json')).toEqual({ kind: 'state', path: 's.json', json: true });
    expect(message(parse('s.json', 'state', 'x'))).toBe('usage: minivac-control <session.json> state [--json]');
  });

  it('splits a + batch into words and tool calls, with the settle cap', () => {
    expect(parse('s.json', 'connect', '1A/1B', '+', 'button', '1', 'press', '+', 'dial', 'hold', '67.5')).toEqual({
      kind: 'batch',
      path: 's.json',
      commands: [['connect', '1A/1B'], ['button', '1', 'press'], ['dial', 'hold', '67.5']],
      calls: [
        { name: 'connect', args: { a: '1A', b: '1B' } },
        { name: 'press', args: { n: 1 } },
        { name: 'dialGrab', args: { targetUdeg: 67_500_000 } },
      ],
      settleMs: 500,
      showState: false,
    });
    const capped = parse('s.json', 'power', 'on', '--settle-ms', '200');
    expect(capped.kind === 'batch' && capped.settleMs).toBe(200);
    expect(message(parse('s.json', 'power', 'on', '--settle-ms', '0'))).toBe('--settle-ms must be in 1..60000 (one minute)');
    expect(message(parse('s.json', 'power', 'on', '+'))).toBe('empty command in batch (stray +)');
    expect(message(parse('s.json'))).toBe('no command (see: minivac-control --help)');
  });

  it('load-program carries the fixture wires it resolved', () => {
    const loaded = parse('s.json', 'load-program', 'I-EXP4');
    expect(loaded.kind === 'batch' && loaded.calls).toEqual([
      { name: 'loadProgram', args: { program: 'I-EXP4', wires: readProgramWires('I-EXP4') } },
    ]);
    expect(message(parse('s.json', 'load-program', 'IV-EXP1'))).toMatch(/^command 1 \(load-program IV-EXP1\): no program "IV-EXP1" /);
  });

  it('state may only end a batch', () => {
    const ended = parse('s.json', 'power', 'on', '+', 'state');
    expect(ended.kind === 'batch' && [ended.commands, ended.showState]).toEqual([[['power', 'on']], true]);
    const rule = 'state can only be the last command in a batch, or a call of its own';
    expect(message(parse('s.json', 'state', '+', 'power', 'off'))).toBe('command 1 (state): ' + rule);
    expect(message(parse('s.json', 'power', 'off', '+', 'state', '+', 'power', 'on'))).toBe('command 2 (state): ' + rule);
    expect(message(parse('s.json', 'power', 'on', '+', 'state', '--json'))).toBe('command 2 (state): ' + rule);
    expect(message(parse('s.json', 'state', '+', 'state'))).toBe('command 1 (state): ' + rule);
  });

  it('labels a bad command by its place and words; a bad wire comes back as a rejection', () => {
    expect(message(parse('s.json', 'power', 'on', '+', 'button', 'x', 'down'))).toBe(
      'command 2 (button x down): button number must be an integer, got "x"');
    const wire = parse('s.json', 'power', 'on', '+', 'connect', '+/1X');
    expect(wire.kind).toBe('rejected');
    if (wire.kind !== 'rejected') return;
    expect(wire.label).toBe('command 2 (connect +/1X)');
    expect(wire.result.why).toBe('unknown_terminal');
  });

  it('a parse touches no file, even for a session that does not exist', () => {
    const path = join(tempDir(), 'missing.json');
    expect(parse(path, 'power', 'on').kind).toBe('batch');
    expect(parse(path, 'state').kind).toBe('state');
    expect(existsSync(path)).toBe(false);
    expect(existsSync(path + '.lock')).toBe(false);
  });
});

describe('parseInvocation: the pinned session path', () => {
  it('takes the pin as a parameter, not from MINIVAC_CONTROL_SESSION', () => {
    process.env.MINIVAC_CONTROL_SESSION = '/elsewhere/pinned.json';
    try {
      expect(parse('s.json', 'power', 'on').kind).toBe('batch');
      expect(message(parse('power', 'on'))).toBe('the first word must be the session file: minivac-control <session.json> power on');
    } finally {
      delete process.env.MINIVAC_CONTROL_SESSION;
    }
    expect(parseInvocation(['s.json', 'power', 'on'], { pinned: '' }).kind).toBe('batch');
  });

  it('refuses every other path and spells out the call to resend', () => {
    const dir = tempDir();
    const pinned = join(dir, 'session.json');
    const options = { pinned };
    const pin = (...argv: string[]): Invocation => parseInvocation(argv, options);
    expect(message(pin('new', join(dir, 'other.json')))).toBe(
      'this run may use only the session file ' + pinned + '; resend as: new ' + pinned);
    expect(message(pin('other.json', 'power', 'on', '+', 'state'))).toBe(
      'this run may use only the session file ' + pinned + '; resend as: ' + pinned + ' power on + state');
    expect(message(pin('other.json', 'state', '--json'))).toBe(
      'this run may use only the session file ' + pinned + '; resend as: ' + pinned + ' state --json');
    expect(message(pin('power', 'on'))).toBe('the first word must be the session file: minivac-control ' + pinned + ' power on');
    // The pin is checked before the profile is loaded, and before the batch is parsed.
    expect(message(pin('new', 'other.json', '--profile', 'nope'))).toMatch(/^this run may use only /);
    expect(message(pin('other.json', 'frobnicate'))).toMatch(/^this run may use only /);

    expect(pin('new', join(dir, '.', 'session.json')).kind).toBe('new');
    expect(pin(pinned, 'power', 'on').kind).toBe('batch');
    expect(pin('help').kind).toBe('help');
  });

  it('shows a pinned path inside the working directory relative to it', () => {
    const inside = join(process.cwd(), 'pane.json');
    const shown = relative(process.cwd(), inside);
    expect(message(parseInvocation(['s.json', 'state'], { pinned: inside }))).toBe(
      'this run may use only the session file ' + shown + '; resend as: ' + shown + ' state');
    expect(parseInvocation(['pane.json', 'state'], { pinned: inside }).kind).toBe('state');
  });
});
