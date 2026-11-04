import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HoleId } from '../../src/core/terminals.ts';
import { loadNetlist } from '../../src/core/netlist.ts';
import { loadProfile } from '../../src/core/profile.ts';
import { createPaneEngine } from '../../src/pane/engine.ts';
import type { EngineError, PaneEngine } from '../../src/pane/engine.ts';
import { newSession, parseWire } from '../../src/hands/table.ts';
import type { StateView, ToolCall } from '../../src/hands/table.ts';
import { fileBackend } from '../../tools/hands/backend.ts';
import type { SessionBackend } from '../../tools/hands/backend.ts';
import { runWith } from '../../tools/hands/cli.ts';
import type { CliResult } from '../../tools/hands/cli.ts';
import { formatSession, loadRepoNetlist, loadRepoProfile } from '../../tools/hands/session-file.ts';

// The pane must give the model what the checklist runs gave it: the same words through the same
// parser and renderer, over the page's engine instead of the session file, must print the same
// bytes and leave the same session. The sequences in fixtures/ are the minivac_control calls models
// made in recorded runs, split as the model loop splits them, with the run's session path replaced
// by the pane's pinned `pane.json` and nothing naming a host, an address or an absolute path.

const PINNED = 'pane.json';
const netlist = loadRepoNetlist();
const refA = loadRepoProfile('MV601-REF-A');
const ideal = loadRepoProfile('MV601-IDEAL');
const PROFILES = [refA, ideal];

const home = process.cwd();
const roots: string[] = [];

afterEach(() => {
  process.chdir(home);
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A fresh temp dir as the working directory, so the file backend's `pane.json` lands there. */
function enterTempDir(): void {
  const root = mkdtempSync(join(tmpdir(), 'mv601-pane-'));
  roots.push(root);
  process.chdir(root);
}

/** What crosses the WebSocket: JSON text, parsed on the other side. Requires nothing was lost. */
function wire<T>(value: T): T {
  const sent = JSON.parse(JSON.stringify(value)) as T;
  expect(sent).toStrictEqual(value);
  return sent;
}

function isError(reply: unknown): reply is EngineError {
  return typeof reply === 'object' && reply !== null && 'error' in reply;
}

/** Node's side of the pane, in miniature: requests go over the wire, an EngineError is thrown. */
function engineBackend(engine: PaneEngine): SessionBackend {
  function answer<T>(reply: T | EngineError): T {
    const received = wire(reply);
    if (isError(received)) throw new Error(received.error);
    return received;
  }
  return {
    create: (_path, session) => answer(engine.create(wire(session))),
    state: () => answer(engine.state()),
    run: (_path, calls, settleMs) => answer(engine.run(wire(calls), settleMs)),
  };
}

interface Sequence {
  source: string;
  /** What this sequence is in the set for; each claim is checked against its own output. */
  covers: string[];
  calls: string[][];
}

const FIXTURES = new URL('./fixtures/', import.meta.url);
const SEQUENCES = readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).sort()
  .map((name) => ({ name, sequence: JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as Sequence }));

/** What one call exercised, read from its words and its output. */
function tags(words: readonly string[], result: CliResult): string[] {
  const out: string[] = [];
  const err = result.stderr;
  if (/unknown command "new"|new takes only the session file|usage: minivac-control new/.test(err)) out.push('new-refusal');
  if (/usage: |unknown command "(?!new")/.test(err)) out.push('usage-error');
  if (err.includes('already exists; not overwriting')) out.push('exists');
  if (err.includes('may use only the session file')) out.push('pinning');
  if (err.includes('the first word must be the session file')) out.push('first-word');
  if (err.includes('no session file')) out.push('missing');
  if (/no program "[^"]*" in test\/conformance\/fixtures/.test(err)) out.push('unknown-program');
  if (/\) rejected: [a-z_]+: .*; nothing saved/.test(err)) out.push('batch-rejection');
  if (result.code !== 0) return out;
  const text = words.join(' ');
  if (words.includes('+')) out.push('batch');
  if (words[words.length - 1] === 'state') out.push('state');
  if (words.includes('--json')) out.push('state-json');
  for (const verb of ['load-program', 'press', 'wait', 'disconnect', 'dial', 'relay', 'breaker']) {
    if (words.includes(verb)) out.push(verb);
  }
  if (text.includes('disconnect all')) out.push('disconnect-all');
  return out;
}

const REQUIRED = ['new-refusal', 'usage-error', 'exists', 'pinning', 'first-word', 'missing', 'unknown-program',
  'batch-rejection', 'batch', 'state', 'state-json', 'load-program', 'press', 'wait', 'disconnect', 'disconnect-all',
  'dial', 'relay', 'breaker'];

describe('pane engine: transfer from the CLI', () => {
  it('the fixture set covers every kind of call the pane must carry over', () => {
    expect(SEQUENCES.length).toBeGreaterThan(0);
    const declared = new Set(SEQUENCES.flatMap(({ sequence }) => sequence.covers));
    expect(REQUIRED.filter((kind) => !declared.has(kind))).toEqual([]);
  });

  it.each(SEQUENCES)('$name: same words, same text and session through the file and the engine', ({ sequence }) => {
    enterTempDir();
    const engine = createPaneEngine(netlist, PROFILES);
    const pane = engineBackend(engine);
    const seen = new Set<string>();
    sequence.calls.forEach((words, i) => {
      const viaFile = runWith(words, fileBackend, { pinned: PINNED });
      const viaPane = runWith(words, pane, { pinned: PINNED });
      expect(viaPane, 'call ' + (i + 1) + ': ' + words.join(' ')).toEqual(viaFile);
      for (const kind of tags(words, viaFile)) seen.add(kind);
    });
    expect(sequence.covers.filter((kind) => !seen.has(kind))).toEqual([]);

    const exported = wire(engine.session());
    if (!existsSync(PINNED)) {
      expect(exported).toBe('missing');
      return;
    }
    if (exported === 'missing') throw new Error('the file backend has a session and the engine has none');
    expect(formatSession(exported)).toBe(readFileSync(PINNED, 'utf8'));
    // The file backend replays the whole session on every call (seconds for the longer runs), so
    // vitest's 5 s default is too close under a loaded machine.
  }, 30_000);
});

const hole = (id: string): HoleId => id as HoleId;

function connect(text: string): ToolCall {
  const parsed = parseWire(text);
  if ('ok' in parsed) throw new Error('bad wire ' + text);
  return { name: 'connect', args: parsed };
}

const POWER_ON: ToolCall = { name: 'power', args: { on: true } };

function liveState(engine: PaneEngine): StateView {
  const view = engine.state();
  if (view === 'missing') throw new Error('expected a live session');
  return view;
}

/** An engine with a live session on the reference profile. */
function started(): PaneEngine {
  const engine = createPaneEngine(netlist, PROFILES);
  expect(wire(engine.create(wire(newSession(netlist, refA))))).toBe('created');
  return engine;
}

describe('pane engine: replies', () => {
  it('create, state, run and session with and without a live session', () => {
    const engine = createPaneEngine(netlist, PROFILES);
    expect(engine.state()).toBe('missing');
    expect(engine.session()).toBe('missing');
    expect(engine.run([POWER_ON], 500)).toBe('missing');
    expect(engine.machine()).toBeNull();

    const base = newSession(netlist, refA);
    expect(engine.create(base)).toBe('created');
    const machine = engine.machine();
    expect(machine).not.toBeNull();
    expect(engine.create(newSession(netlist, ideal))).toBe('exists');
    expect(engine.machine()).toBe(machine);

    const reply = wire(engine.run([connect('1+/1A'), connect('1B/1-'), POWER_ON], 500));
    if (typeof reply !== 'object' || !('ok' in reply) || !reply.ok) throw new Error('expected an accepted batch');
    expect(reply.results.map((result) => result.ok && result.cord?.wire)).toEqual(['1+/1A', '1B/1-', undefined]);
    expect(reply.view).toStrictEqual(engine.state());
    expect(engine.machine()).toBe(machine);
    expect(machine?.snapshot()).toStrictEqual(wire(liveState(engine)).snapshot);

    const session = wire(engine.session());
    if (session === 'missing') throw new Error('expected a session');
    expect({ ...session, script: [] }).toStrictEqual(base);
    expect(session.script.filter((step) => step.k === 'do').map((step) => step.k === 'do' && step.cmd.k))
      .toEqual(['connect', 'connect', 'power']);
  });

  it('a refused batch is answered as runBatch would refuse it and changes nothing', () => {
    const engine = started();
    expect(engine.run([connect('1+/1A'), POWER_ON], 500)).toMatchObject({ ok: true });
    const before = { session: wire(engine.session()), state: wire(engine.state()) };
    const refused = wire(engine.run([connect('1B/1-'), { name: 'disconnect', args: { a: '2A', b: '2B' } }], 500));
    expect(refused).toStrictEqual({
      ok: false, failedAt: 1, result: { ok: false, why: 'unknown_cord', detail: 'no cord runs between 2A and 2B' },
    });
    expect(engine.session()).toStrictEqual(before.session);
    expect(engine.state()).toStrictEqual(before.state);
  });

  it('a batch that fails after validation passed ends the session instead of rebuilding it', () => {
    const engine = started();
    expect(engine.run([connect('1+/1A'), POWER_ON], 500)).toMatchObject({ ok: true });
    // A cord plugged straight into the machine, outside the log (what an unlocked inspector would
    // do): validation sees cord id 1 free, the live machine already has it.
    const machine = engine.machine();
    if (machine === null) throw new Error('expected a live machine');
    expect(machine.apply({ k: 'connect', cord: 1, a: { k: 'hole', hole: hole('6+#1') }, b: { k: 'hole', hole: hole('6-#1') } }).ok)
      .toBe(true);

    const reply = wire(engine.run([{ name: 'power', args: { on: false } }, connect('1B/1-')], 500));
    expect(reply).toStrictEqual({
      error: 'the page machine refused command 2 of a validated batch (cord_exists: connect 1B/1- rejected by the machine); ' +
        'the pane session has ended (start a new one)',
    });
    expect(engine.machine()).toBeNull();
    expect(engine.state()).toBe('missing');
    expect(engine.session()).toBe('missing');
    expect(engine.run([POWER_ON], 500)).toBe('missing');
    // Only an explicit new session brings a machine back, built from scratch.
    expect(engine.create(newSession(netlist, refA))).toBe('created');
    expect(engine.machine()).not.toBe(machine);
    expect(liveState(engine).cords).toEqual([]);
  });

  it('a malformed call is reported and leaves the session standing', () => {
    const engine = started();
    const reply = wire(engine.run([{ name: 'nope', args: {} } as unknown as ToolCall], 500));
    expect(reply).toStrictEqual({ error: 'the page could not check this batch: hands: no tool "nope"' });
    expect(engine.state()).not.toBe('missing');
  });
});

describe('pane engine: create checks the page data against the session', () => {
  const netlistText = readFileSync(new URL('../../data/netlist.json', import.meta.url), 'utf8');
  const profileDocument = JSON.parse(readFileSync(new URL('../../data/profiles/MV601-REF-A.json', import.meta.url), 'utf8')) as {
    values: Record<string, { v: number }>;
  };

  it('refuses a session built on another netlist', () => {
    // Same netlist content, different bytes: the hash covers the exact file.
    const other = loadNetlist(new TextEncoder().encode(netlistText.replace('{', '{ ')));
    const session = newSession(other, refA);
    expect(session.netlistHash).not.toBe(newSession(netlist, refA).netlistHash);
    const engine = createPaneEngine(netlist, PROFILES);
    const reply = wire(engine.create(wire(session)));
    expect(isError(reply) && reply.error).toMatch(/^the page cannot start this session: session was recorded against a different netlist/);
    expect(engine.machine()).toBeNull();
    expect(engine.create(newSession(netlist, refA))).toBe('created');
  });

  it('refuses a session built on another version of the profile', () => {
    const changed = structuredClone(profileDocument);
    (changed.values.V_oc_mv as { v: number }).v += 1;
    const session = newSession(netlist, loadProfile(changed));
    expect(session.profile).toBe(refA.id);
    expect(session.profileHash).not.toBe(refA.hash);
    const engine = createPaneEngine(netlist, PROFILES);
    const reply = wire(engine.create(wire(session)));
    expect(isError(reply) && reply.error).toMatch(/^the page cannot start this session: session was recorded against a different profile MV601-REF-A/);
    expect(engine.machine()).toBeNull();
  });

  it('refuses a profile the page does not bundle', () => {
    const engine = createPaneEngine(netlist, [refA]);
    expect(wire(engine.create(wire(newSession(netlist, ideal))))).toStrictEqual({
      error: 'the page has no profile "MV601-IDEAL" (it has MV601-REF-A)',
    });
    expect(engine.state()).toBe('missing');
  });
});

describe('pane engine: browser-safe', () => {
  it('imports only from src/hands/ and src/core/', () => {
    const source = readFileSync(new URL('../../src/pane/engine.ts', import.meta.url), 'utf8');
    const specifiers = [...source.matchAll(/^import\b[^'"]*['"]([^'"]+)['"]/gm)].map((match) => match[1] as string);
    expect(specifiers.length).toBeGreaterThan(0);
    expect(specifiers.filter((specifier) => !/^\.\.\/(hands|core)\/[\w-]+\.ts$/.test(specifier))).toEqual([]);
  });
});
