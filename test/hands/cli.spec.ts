import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from '../../tools/hands/cli.ts';
import { REPO_ROOT } from '../conformance/helpers.ts';

const cli = resolve(REPO_ROOT, 'bin/minivac-control');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'mv601-control-'));
  roots.push(root);
  return root;
}

function lampOf(stateText: string, name: string): string | undefined {
  return stateText.split('\n').find((line) => line.startsWith(name + ' '))?.slice(name.length + 1);
}

describe('minivac-control CLI (spawned)', () => {
  it('prints help, wires I-EXP4 with + batches, and reports state and exit codes', () => {
    const cwd = tempDir();
    const sh = (...args: string[]) => spawnSync(cli, args, { cwd, encoding: 'utf8' });

    const help = sh('--help');
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('minivac-control help terminals');
    expect(help.stdout).toContain('HOW TIME PASSES');
    expect(sh('help').stdout).toBe(help.stdout);
    const terminals = sh('help', 'terminals');
    expect(terminals.status).toBe(0);
    expect(terminals.stdout).toMatch(/nY ARM, nZ N\.C\..*\n.*nX N\.O\./);
    expect(terminals.stdout).toContain('nA, nB');
    expect(terminals.stdout).toContain('Never join nA to nB: that cord');
    expect(terminals.stdout).toContain('n+/nY, nX/nC, nF/n-');

    expect(sh('new', 's.json').status).toBe(0);
    const again = sh('new', 's.json');
    expect(again.status).toBe(1);
    expect(again.stderr).toMatch(/^minivac-control: .*already exists; not overwriting\. To start the wiring over, keep this session and send: s\.json disconnect all/);

    const wired = sh('s.json', 'connect', '1+/1Y', '+', 'connect', '1X/2Y', '+', 'connect', '2X/2A', '+',
      'connect', '2B/2-', '+', 'power', 'on', '--settle-ms', '200');
    expect(wired.status).toBe(0);
    expect(wired.stdout).toContain('ok  connect 1X/2Y  -> cord 1 (1X#1 2Y#1)');
    expect(wired.stdout).toMatch(/^settled after /m);
    expect(wired.stdout).toContain('changed: power off -> on');

    expect(sh('s.json', 'button', '1', 'down').status).toBe(0);
    expect(lampOf(sh('s.json', 'state').stdout, 'outLamp2')).toBe('off');
    expect(sh('s.json', 'button', '1', 'up', '+', 'button', '2', 'down').status).toBe(0);
    expect(lampOf(sh('s.json', 'state').stdout, 'outLamp2')).toBe('off');
    const both = sh('s.json', 'button', '1', 'down');
    expect(both.stdout).toMatch(/changed: outLamp2 off .*-> on/);
    const state = sh('s.json', 'state');
    expect(state.status).toBe(0);
    expect(lampOf(state.stdout, 'outLamp2')).toBe('on');
    expect(state.stdout).toContain('cord 3 2B/2- (2B#1 2-#1)');
    const json = JSON.parse(sh('s.json', 'state', '--json').stdout) as { cords: unknown[] };
    expect(json.cords).toHaveLength(4);

    const bad = sh('s.json', 'frobnicate');
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/^minivac-control: command 1 \(frobnicate\): unknown command/);
    expect(sh('s.json', 'power', 'on', '+').status).toBe(1);
    expect(sh().status).toBe(1);
  });
});

describe('minivac-control CLI (in-process)', () => {
  it('button <n> press is a spring-return press; state may end a batch; nowhere else', () => {
    const path = join(tempDir(), 's.json');
    run(['new', path]);
    expect(run([path, 'connect', '1+/1Y', '+', 'connect', '1X/1A', '+', 'connect', '1B/1-', '+', 'power', 'on']).code).toBe(0);
    const pressed = run([path, 'button', '1', 'press', '+', 'button', '1', 'press', '40', '+', 'state']);
    expect(pressed.code).toBe(0);
    expect(pressed.stdout).toContain('ok  button 1 press\n');
    expect(pressed.stdout).toContain('ok  button 1 press 40\n');
    expect(pressed.stdout).toContain('changed: outLamp1 ');
    expect(pressed.stdout).toMatch(/\ntime [0-9.]+ ms \(tick [0-9]+\)\n/);
    expect(pressed.stdout).toContain('\npb1 nc\n');
    const middle = run([path, 'state', '+', 'power', 'off']);
    expect(middle.code).toBe(1);
    expect(middle.stderr).toContain('state can only be the last command in a batch');
    const inside = run([path, 'power', 'off', '+', 'state', '+', 'power', 'on']);
    expect(inside.stderr).toContain('state can only be the last command in a batch');
    expect(run([path, 'button', '1', 'press', 'x']).stderr).toContain('press time must be an integer');
  });

  it('explains the common grammar mistakes', () => {
    const dir = tempDir();
    const path = join(dir, 's.json');
    run(['new', path]);
    expect(run([path, 'connect', '+/1X']).stderr).toContain('the + and - rails are per section: write 1+ to 6+ or 1- to 6-');
    expect(run([path, 'connect', '1Y/-']).stderr).toContain('the + and - rails are per section');
    expect(run([path, 'connect', '1B/1\u2212']).stderr).toContain('type the minus as an ASCII hyphen-minus');
    const noSession = run(['connect', '1Y/1+']);
    expect(noSession.code).toBe(1);
    expect(noSession.stderr).toContain('the first word must be the session file: minivac-control <session.json> connect 1Y/1+');
    const newBatch = run(['new', join(dir, 't.json'), '+', 'connect', '1A/1B']);
    expect(newBatch.stderr).toContain('new takes only the session file; send commands in a second call');
    expect(existsSync(join(dir, 't.json'))).toBe(false);
  });

  it('MINIVAC_CONTROL_SESSION pins the one session file a run may create or use', () => {
    const dir = tempDir();
    const pinned = join(dir, 'session.json');
    const other = join(dir, 'other.json');
    expect(run(['new', other]).code).toBe(0);
    process.env.MINIVAC_CONTROL_SESSION = pinned;
    try {
      const refusedNew = run(['new', join(dir, 's.json')]);
      expect(refusedNew.code).toBe(1);
      expect(refusedNew.stderr).toContain('only the session file ' + pinned + '; resend as: new ' + pinned);
      expect(existsSync(join(dir, 's.json'))).toBe(false);
      const before = readFileSync(other, 'utf8');
      const refused = run([other, 'power', 'on', '+', 'state']);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain('; resend as: ' + pinned + ' power on + state');
      expect(run(['power', 'on']).stderr).toContain('the first word must be the session file: minivac-control ' + pinned + ' power on');
      expect(run([other, 'state']).code).toBe(1);
      expect(readFileSync(other, 'utf8')).toBe(before);
      expect(run(['--help']).code).toBe(0);
      expect(run(['new', join(dir, '.', 'session.json')]).code).toBe(0);
      expect(run([pinned, 'power', 'on']).code).toBe(0);
    } finally {
      delete process.env.MINIVAC_CONTROL_SESSION;
    }
  });

  it('keeps a batch atomic: a failing second command leaves the file byte-identical', () => {
    const path = join(tempDir(), 's.json');
    expect(run(['new', path]).code).toBe(0);
    expect(run([path, 'connect', '1+/1A', '+', 'connect', '1+/1B']).code).toBe(0);
    const before = readFileSync(path, 'utf8');

    const result = run([path, 'power', 'on', '+', 'connect', '1+/1C']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('minivac-control: command 2 (connect 1+/1C) rejected: hole_occupied: ' +
      'every hole of 1+ is in use (cords 0, 1); nothing saved\n');
    expect(readFileSync(path, 'utf8')).toBe(before);

    const ambiguous = run([path, 'connect', '1C/1E', '+', 'connect', '1E/1C', '+', 'disconnect', '1C/1E']);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.stderr).toContain('ambiguous_cord: cords 2, 3');
    expect(readFileSync(path, 'utf8')).toBe(before);

    const cleared = run([path, 'disconnect', 'all', '+', 'state']);
    expect(cleared.code).toBe(0);
    expect(cleared.stdout).toMatch(/\ncords 0\n/);
    expect(run([path, 'disconnect', 'all']).code).toBe(0);
  });

  it('reports a corrupt session file on replay', () => {
    const path = join(tempDir(), 's.json');
    run(['new', path]);
    run([path, 'connect', '1A/1B', '+', 'connect', '1C/1E']);
    writeFileSync(path, readFileSync(path, 'utf8').replace('"1C#1"', '"1A#1"'));
    const result = run([path, 'state']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/^minivac-control: corrupt session: script\[1\] connect was rejected on replay: hole_occupied/);
  });

  it('caps the changed: line for a buzzing relay and notes lamps still cooling', () => {
    const root = tempDir();
    const buzz = join(root, 'buzz.json');
    run(['new', buzz]);
    const result = run([buzz, 'connect', '1+/1H', '+', 'connect', '1J/1E', '+', 'connect', '1F/1-', '+',
      'power', 'on', '+', 'wait', '2000']);
    expect(result.code).toBe(0);
    const line = result.stdout.split('\n').find((text) => text.startsWith('changed: relay1 ')) as string;
    expect(line).toMatch(/^changed: relay1 nc -> \.\.\. -> (nc|mid|no) \([0-9]+ changes\)$/);
    expect(result.stdout.length).toBeLessThan(1000);

    const lamp = join(root, 'lamp.json');
    run(['new', lamp]);
    run([lamp, 'connect', '1+/1Y', '+', 'connect', '1X/2Y', '+', 'connect', '2X/2A', '+', 'connect', '2B/2-',
      '+', 'power', 'on', '+', 'button', '1', 'down', '+', 'button', '2', 'down']);
    const release = run([lamp, 'button', '1', 'up']);
    expect(release.stdout).toContain('note: lamp(s) outLamp2 still warming/cooling; settle does not wait ' +
      'for lamp filaments (use wait)\n');
    expect(run([lamp, 'wait', '60001']).stderr).toContain('1..60000');
    expect(run([lamp, 'wait', '1', '--settle-ms', '60001']).stderr).toContain('--settle-ms must be in 1..60000');
  });

});

const LOCK_MESSAGE = /^minivac-control: another call is using this session \(.*s\.json\.lock\); if no other minivac-control call is running, delete that file and re-run\n$/;

describe('minivac-control session lock', () => {
  it('fails a state-changing call while the lock is held and leaves the session unchanged', () => {
    const path = join(tempDir(), 's.json');
    run(['new', path]);
    const before = readFileSync(path, 'utf8');
    writeFileSync(path + '.lock', 'held\n');
    const result = run([path, 'power', 'on']);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(LOCK_MESSAGE);
    expect(readFileSync(path, 'utf8')).toBe(before);
    expect(readFileSync(path + '.lock', 'utf8')).toBe('held\n');
    expect(run([path, 'state']).code).toBe(0);
  });

  it('removes the lock after a successful and after a rejected batch', () => {
    const path = join(tempDir(), 's.json');
    expect(run(['new', path]).code).toBe(0);
    expect(existsSync(path + '.lock')).toBe(false);
    expect(run([path, 'power', 'on']).code).toBe(0);
    expect(existsSync(path + '.lock')).toBe(false);
    expect(run([path, 'button', '1', '1001']).code).toBe(1);
    expect(existsSync(path + '.lock')).toBe(false);
  });

  it('serialises parallel calls: every call succeeds or gets the lock message, none is lost', async () => {
    const cwd = tempDir();
    expect(spawnSync(cli, ['new', 's.json'], { cwd, encoding: 'utf8' }).status).toBe(0);
    const wires = [1, 2, 3, 4, 5, 6].map((n) => n + 'A/' + n + 'B');
    const results = await Promise.all(wires.map((wire) => new Promise<{ wire: string; code: number | null; stderr: string }>(
      (done) => {
        const child = spawn(cli, ['s.json', 'connect', wire], { cwd });
        let stderr = '';
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
        child.on('close', (code) => done({ wire, code, stderr }));
      })));
    for (const result of results) {
      if (result.code !== 0) {
        expect(result.code).toBe(1);
        expect(result.stderr).toMatch(LOCK_MESSAGE);
      }
    }
    const okWires = results.filter((result) => result.code === 0).map((result) => result.wire).sort();
    expect(okWires.length).toBeGreaterThan(0);
    const session = JSON.parse(readFileSync(join(cwd, 's.json'), 'utf8')) as {
      script: { k: string; cmd?: { k: string; a: { hole: string }; b: { hole: string } } }[];
    };
    const saved = session.script
      .filter((step) => step.k === 'do' && step.cmd?.k === 'connect')
      .map((step) => (step.cmd?.a.hole.split('#')[0] as string) + '/' + (step.cmd?.b.hole.split('#')[0] as string))
      .sort();
    expect(saved).toEqual(okWires);
    expect(existsSync(join(cwd, 's.json.lock'))).toBe(false);
  });
});

describe('minivac-control: breaker, relay, dial and load-program', () => {
  it('help lists every command and no longer says the breaker cannot be reset', () => {
    const help = run(['--help']).stdout;
    for (const usage of ['breaker reset', 'relay <n> hold in | out | <0..1000>', 'relay <n> release',
      'dial hold <degrees>', 'dial release', 'load-program <ID>', 'button <n> press [ms]']) {
      expect(help).toContain('  ' + usage);
    }
    expect(help).toContain('It loads wiring only: it does not power on or press anything.');
    expect(help).toContain('<ID>-DERIVED has the');
    expect(help).not.toMatch(/cannot reset|not in v1/);
    expect(run(['help', 'terminals']).stdout).not.toMatch(/not in v1/);
  });

  it('breaker reset clears a trip after the short is unplugged, and the session replays it', () => {
    const path = join(tempDir(), 's.json');
    run(['new', path]);
    expect(run([path, 'connect', '1+/1-', '+', 'power', 'on']).stdout).toContain('changed: breaker ok -> tripped');
    const reset = run([path, 'disconnect', '0', '+', 'breaker', 'reset']);
    expect(reset.code).toBe(0);
    expect(reset.stdout).toContain('ok  breaker reset\n');
    expect(reset.stdout).toContain('changed: breaker tripped -> ok');
    expect(lampOf(run([path, 'state']).stdout, 'breaker')).toBe('ok');
    expect(run([path, 'breaker']).stderr).toContain('usage: breaker reset');
  });

  it('relay hold in / release drives I-EXP6, and state reads it back from the replayed file', () => {
    const path = join(tempDir(), 's.json');
    run(['new', path]);
    expect(run([path, 'connect', '1+/1H', '+', 'connect', '1J/2A', '+', 'connect', '1B/1-', '+', 'connect', '1G/1A',
      '+', 'connect', '2B/2-', '+', 'power', 'on']).code).toBe(0);
    const hold = run([path, 'relay', '1', 'hold', 'in', '+', 'wait', '200']);
    expect(hold.stdout).toContain('changed: relay1 nc -> mid -> no');
    const held = run([path, 'state']).stdout;
    expect([lampOf(held, 'relay1'), lampOf(held, 'outLamp1'), lampOf(held, 'outLamp2')]).toEqual(['no', 'on', 'off']);
    const json = JSON.parse(run([path, 'state', '--json']).stdout) as { relays: { held: boolean }[] };
    expect(json.relays[0]?.held).toBe(true);
    expect(run([path, 'relay', '1', 'release', '+', 'wait', '200']).stdout).toContain('changed: relay1 no -> mid -> nc');
    expect(run([path, 'relay', '1', 'hold', '500']).code).toBe(0);
    expect(run([path, 'relay', '1', 'hold']).stderr).toContain('usage: relay <n> hold in|out|<0..1000> | relay <n> release');
    expect(run([path, 'relay', '7', 'release']).stderr).toContain('relayRelease needs n in 1..6');
  });

  it('dial hold turns the dial by hand with a note, wait lets it arrive, dial release lets go', () => {
    const path = join(tempDir(), 's.json');
    run(['new', path]);
    const hold = run([path, 'dial', 'hold', '67.5']);
    expect(hold.stdout).toContain('note: dial still turning by hand toward its hold angle; settle does not wait for the dial, use wait <ms> to let it get there\n');
    expect(run([path, 'wait', '500']).stdout).toContain('changed: dial c0 -> gap -> c1 -> gap -> c2 -> gap -> c3\n');
    const json = JSON.parse(run([path, 'state', '--json']).stdout) as { dial: { udeg: number; held: boolean } };
    expect(json.dial).toMatchObject({ udeg: 67_500_000, held: true });
    expect(run([path, 'dial', 'release']).code).toBe(0);
    expect(run([path, 'dial', 'hold', '360']).stderr).toContain('below 360 degrees');
    expect(run([path, 'dial', 'hold', '1.1234567']).stderr).toContain('degrees 0..359.999999');
    expect(run([path, 'dial', 'spin']).stderr).toContain('usage: dial hold <degrees> | dial release');
  });

  it('connect <A>/free plugs a cord with its other end hanging free; state shows it, disconnect takes it out', () => {
    const path = join(tempDir(), 's.json');
    run(['new', path]);
    const plugged = run([path, 'connect', 'M10/free', '+', 'connect', 'free/M11']);
    expect(plugged.code).toBe(0);
    expect(plugged.stdout).toContain('ok  connect M10/free  -> cord 0 (M10#1 free)\n');
    expect(plugged.stdout).toContain('ok  connect free/M11  -> cord 1 (M11#1 free)\n');
    const script = (JSON.parse(readFileSync(path, 'utf8')) as { script: { k: string; cmd?: unknown }[] }).script;
    expect(script.slice(0, 2)).toEqual([
      { k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'hole', hole: 'M10#1' }, b: { k: 'free' } } },
      { k: 'do', cmd: { k: 'connect', cord: 1, a: { k: 'hole', hole: 'M11#1' }, b: { k: 'free' } } },
    ]);
    const state = run([path, 'state']).stdout;
    expect(state).toContain('cord 0 M10/free (M10#1 free)\n');
    expect(state).toContain('cord 1 M11/free (M11#1 free)\n');
    // The free cords hold their ids and holes.
    expect(run([path, 'connect', 'M10/1A']).stdout).toContain('ok  connect M10/1A  -> cord 2 (M10#2 1A#1)\n');
    expect(run([path, 'disconnect', 'free/M11']).code).toBe(0);
    expect(run([path, 'state']).stdout).not.toContain('cord 1 ');
    const both = run([path, 'connect', 'free/free']);
    expect(both.code).not.toBe(0);
    expect(both.stderr).toContain('rejected: unknown_terminal: a cord needs a terminal at one end at least');
  });

  it('plugs tic-tac-toe\'s free-ended leads and makes its first move exactly as the fixture does', () => {
    const fixture = JSON.parse(readFileSync(resolve(REPO_ROOT, 'test/conformance/fixtures/C2/VI-TICTACTOE.fixture.json'), 'utf8')) as
      { wires: string[]; script: { k: string; cmd?: unknown }[] };
    const path = join(tempDir(), 's.json');
    run(['new', path]);
    expect(run([path, ...fixture.wires.flatMap((wire, i) => (i === 0 ? ['connect', wire] : ['+', 'connect', wire]))]).code).toBe(0);
    const move = run([path, 'connect', 'M10/free', '+', 'connect', 'M11/free', '+', 'power', 'on', '+', 'wait', '500',
      '+', 'disconnect', '70', '+', 'connect', 'M10/6com']);
    expect(move.code).toBe(0);
    const ours = (JSON.parse(readFileSync(path, 'utf8')) as { script: { k: string; cmd?: unknown }[] }).script
      .filter((step) => step.k === 'do').slice(fixture.wires.length).map((step) => step.cmd);
    // The two leads on the next free holes, power, and the machine's play wire's free end into 6com#2.
    expect(ours).toEqual(fixture.script.filter((step) => step.k === 'do').slice(0, 5).map((step) => step.cmd));
  });

  it('load-program plugs a fixture wire list in a batch, logs the load, and powers nothing', () => {
    const path = join(tempDir(), 's.json');
    run(['new', path]);
    const loaded = run([path, 'load-program', 'I-EXP4', '+', 'power', 'on', '+', 'button', '1', 'down', '+', 'button', '2', 'down']);
    expect(loaded.code).toBe(0);
    expect(loaded.stdout).toContain('ok  load-program I-EXP4  -> 4 cords, ids 0-3 (see: state)\n');
    expect(lampOf(run([path, 'state']).stdout, 'outLamp2')).toBe('on');
    const script = (JSON.parse(readFileSync(path, 'utf8')) as { script: { k: string }[] }).script;
    expect(script[0]).toEqual({ k: 'load', program: 'I-EXP4', cords: 4 });
    expect(script.slice(1, 5).every((step) => step.k === 'do')).toBe(true);

    const unpowered = join(tempDir(), 'u.json');
    run(['new', unpowered]);
    expect(run([unpowered, 'load-program', 'I-EXP4']).stdout).toContain('changed: nothing');
    expect(lampOf(run([unpowered, 'state']).stdout, 'power')).toBe('off');
  });

  it('the help variant claims hold: -DERIVED and the IV-EXP1 variants load the same cords, IV-FF2-CARRY does not', () => {
    const cordsAfter = (id: string): string => {
      const fresh = join(tempDir(), id + '.json');
      run(['new', fresh]);
      expect(run([fresh, 'load-program', id]).code).toBe(0);
      return run([fresh, 'state']).stdout.split('\n').filter((line) => line.startsWith('cord ')).join('\n');
    };
    expect(cordsAfter('IV-EXP1-FAST')).toBe(cordsAfter('IV-EXP1-SLOW'));
    expect(cordsAfter('IV-EXP1-DERIVED')).toBe(cordsAfter('IV-EXP1-SLOW'));
    expect(cordsAfter('V-EXP2-DERIVED')).toBe(cordsAfter('V-EXP2'));
    expect(cordsAfter('IV-FF2-CARRY')).not.toBe(cordsAfter('IV-FF2'));
  });

  it('names close ids for an unknown program and leaves the file untouched when a load cannot fit', () => {
    const path = join(tempDir(), 's.json');
    run(['new', path]);
    const unknown = run([path, 'load-program', 'IV-EXP1']);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toBe('minivac-control: command 1 (load-program IV-EXP1): no program "IV-EXP1" in ' +
      'test/conformance/fixtures/; did you mean: IV-EXP1-DERIVED, IV-EXP1-FAST, IV-EXP1-SLOW; these are ' +
      'variants of one program with the same wires, so load any of them; -DERIVED fixtures carry expectations ' +
      'derived from the wiring, not printed (ids are listed in docs/research/programs.md)\n');
    expect(run([path, 'load-program', 'i-exp4']).stderr).toContain('did you mean: I-EXP4 ');
    expect(run([path, 'load-program', 'I-EXP4X']).stderr).toContain('did you mean: I-EXP4, ');

    run([path, 'connect', '2A/1A', '+', 'connect', '2A/1B']);
    const before = readFileSync(path, 'utf8');
    const full = run([path, 'power', 'on', '+', 'load-program', 'I-EXP4']);
    expect(full.code).toBe(1);
    expect(full.stderr).toContain('command 2 (load-program I-EXP4) rejected: hole_occupied: load-program I-EXP4: ' +
      'wire 3 (2X/2A) cannot be placed');
    expect(full.stderr).toContain('; nothing saved\n');
    expect(readFileSync(path, 'utf8')).toBe(before);
  });
});
