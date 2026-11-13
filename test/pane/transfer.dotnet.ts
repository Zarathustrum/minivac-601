/**
 * The transfer test (docs/plans/godot-chat-pane.md, C1): the C# pane engine
 * (`dotnet/Minivac.Hands/`, run by the `minivac-hands-transfer` tool) must answer every request
 * exactly as `src/pane/engine.ts` does, so the Godot build gives the model the bytes the web page
 * gives it.
 *
 * Run it with `npm run transfer` (vitest.transfer.config.ts), with `dotnet` (the .NET 10 SDK) on
 * PATH. It is not in the default `npm test`, which needs no .NET. Before any case it builds the
 * tool in Release with warnings as errors, as `npm run parity` builds its CLI, so it never runs a
 * stale binary; it fails, never skips, when `dotnet` is missing or the build fails.
 *
 * Each sequence runs twice through the server's own `callOnPage` (the same parser and renderer
 * Node uses): once over the TypeScript engine, in-process, recording every request and reply as the
 * JSON text that crosses the socket; then the recorded requests go to one C# tool process, and the
 * words run again over its replies. Per request the replies must be equal after JSON parsing and
 * byte-identical as JSON text (the C# writes keys in the TypeScript's order, which `state --json`
 * and the session export print); per call the rendered results must be identical; and the final
 * session export must match. Requests carry the `type` and `id` of the server's frame, as Godot
 * will receive them.
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { createPaneEngine } from '../../src/pane/engine.ts';
import type { PaneEngine } from '../../src/pane/engine.ts';
import type { PaneReply, PaneRequest } from '../../src/pane/protocol.ts';
import { newSession, PATH_LIMIT } from '../../src/hands/table.ts';
import { TERMINALS } from '../../src/core/terminals.ts';
import { formatSession, loadRepoNetlist, loadRepoProfile } from '../../tools/hands/session-file.ts';
import { callOnPage } from '../../tools/hands-pane/server.ts';
import type { PageLink, PaneCall } from '../../tools/hands-pane/server.ts';
import type { Session } from '../../src/hands/table.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const TOOL = fileURLToPath(new URL('../../dotnet/Minivac.Hands.Transfer/bin/Release/net10.0/minivac-hands-transfer.dll', import.meta.url));
const BUILD = ['build', 'dotnet/Minivac.Hands.Transfer/Minivac.Hands.Transfer.csproj', '-c', 'Release', '-warnaserror', '--nologo'];

beforeAll(() => {
  const build = spawnSync('dotnet', BUILD, { cwd: REPO, encoding: 'utf8' });
  if (build.error !== undefined) throw new Error('cannot run dotnet (is the .NET SDK on PATH?): ' + build.error.message);
  if (build.status !== 0) throw new Error('dotnet ' + BUILD.join(' ') + ' failed:\n' + build.stdout + build.stderr);
}, 300_000);

const netlist = loadRepoNetlist();
const refA = loadRepoProfile('MV601-REF-A');
const ideal = loadRepoProfile('MV601-IDEAL');
// The page's profiles, in the page's order (src/app.ts:42); the tool loads the same two.
const PROFILES = [refA, ideal];

function message(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}

/** The web page's `answer` (src/pane/ui.ts:185), without the socket. */
function pageAnswer(engine: PaneEngine, request: PaneRequest): PaneReply | undefined {
  let reply: PaneReply | undefined;
  try {
    switch (request.op) {
      case 'create': reply = engine.create(request.session); break;
      case 'run': reply = engine.run(request.calls, request.settleMs); break;
      case 'state': reply = engine.state(); break;
      case 'session': reply = engine.session(); break;
    }
  } catch (problem: unknown) {
    reply = { error: 'the page engine threw: ' + message(problem) };
  }
  return reply;
}

/** One request as the server frames it, the TypeScript engine's reply as JSON text ('' for none). */
interface Exchange { request: string; reply: string }

/** The TypeScript side: requests and replies cross as JSON text, as over the socket. */
function typescriptPage(): { exchanges: Exchange[]; send: (request: unknown) => string } {
  const engine = createPaneEngine(netlist, PROFILES);
  const exchanges: Exchange[] = [];
  return {
    exchanges,
    send(request) {
      const text = JSON.stringify({ type: 'request', id: exchanges.length + 1, ...(request as object) });
      const reply = JSON.stringify(pageAnswer(engine, JSON.parse(text) as PaneRequest)) ?? '';
      exchanges.push({ request: text, reply });
      return reply;
    },
  };
}

/** The C# side: every request line through one tool process; one reply line each. */
function csharpReplies(requests: readonly string[]): string[] {
  const run = spawnSync('dotnet', [TOOL], {
    cwd: REPO, input: requests.map((line) => line + '\n').join(''), encoding: 'utf8', maxBuffer: 1 << 30,
  });
  if (run.error !== undefined) throw new Error('cannot run dotnet (is the .NET SDK on PATH?): ' + run.error.message);
  if (run.status !== 0) throw new Error('the transfer tool failed with status ' + String(run.status) + ': ' + run.stderr);
  const lines = run.stdout.split('\n');
  expect(lines.pop(), 'the tool output ends with a newline').toBe('');
  expect(lines.length, 'one reply line per request').toBe(requests.length);
  return lines;
}

function parsed(text: string): unknown {
  return text === '' ? undefined : JSON.parse(text);
}

/** Each C# reply equals the TypeScript reply, parsed and as text. */
function compareReplies(exchanges: readonly Exchange[], replies: readonly string[]): void {
  exchanges.forEach(({ request, reply }, i) => {
    const label = 'request ' + (i + 1) + ': ' + request.slice(0, 300);
    expect(parsed(replies[i] as string), label).toStrictEqual(parsed(reply));
    expect(replies[i], label).toBe(reply);
  });
}

/** A page link over recorded replies: checks each request is the recorded one. */
function replayLink(exchanges: readonly Exchange[], replies: readonly string[]): PageLink {
  let at = 0;
  return {
    request(request) {
      const exchange = exchanges[at];
      const text = JSON.stringify({ type: 'request', id: at + 1, ...request });
      expect(text, 'the second pass sends the recorded request ' + (at + 1)).toBe(exchange?.request);
      const reply = replies[at] as string;
      at++;
      return Promise.resolve(parsed(reply) as never);
    },
  };
}

/** Run a sequence of minivac_control words over both engines and require the same bytes. */
async function transfer(calls: readonly string[][]): Promise<readonly Exchange[]> {
  const page = typescriptPage();
  const tsLink: PageLink = { request: (request) => Promise.resolve(parsed(page.send(request)) as never) };
  const viaTs: PaneCall[] = [];
  for (const words of calls) viaTs.push(await callOnPage(words, tsLink));
  page.send({ op: 'session' });

  const replies = csharpReplies(page.exchanges.map((exchange) => exchange.request));
  compareReplies(page.exchanges, replies);

  const csLink = replayLink(page.exchanges, replies);
  for (let i = 0; i < calls.length; i++) {
    const viaCs = await callOnPage(calls[i] as string[], csLink);
    expect(viaCs, 'call ' + (i + 1) + ': ' + (calls[i] as string[]).join(' ')).toStrictEqual(viaTs[i]);
  }
  const tsSession = parsed(page.exchanges[page.exchanges.length - 1]?.reply as string) as Session | 'missing';
  const csSession = parsed(replies[replies.length - 1] as string) as Session | 'missing';
  expect(csSession).toStrictEqual(tsSession);
  if (tsSession !== 'missing' && csSession !== 'missing') expect(formatSession(csSession)).toBe(formatSession(tsSession));
  return page.exchanges;
}

/** Raw requests, straight to both engines: the shapes Node's parser never builds. */
function transferRequests(requests: readonly unknown[]): void {
  const page = typescriptPage();
  for (const request of requests) page.send(request);
  compareReplies(page.exchanges, csharpReplies(page.exchanges.map((exchange) => exchange.request)));
}

interface Sequence { source: string; covers: string[]; calls: string[][] }

const FIXTURES = new URL('./fixtures/', import.meta.url);
const SEQUENCES = readdirSync(FIXTURES).filter((name) => name.endsWith('.json')).sort()
  .map((name) => ({ name, sequence: JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8')) as Sequence }));

const P = 'pane.json';
const NEW = ['new', P];

describe('transfer: the recorded sequences', () => {
  it('has the 15 recorded sequences', () => {
    expect(SEQUENCES.length).toBe(15);
  });

  it.each(SEQUENCES)('$name: same replies, same text, same session from the C# engine', async ({ sequence }) => {
    await transfer(sequence.calls);
  }, 60_000);
});

// Paths the recordings do not reach, driven through the words where Node's parser can build them.
const WORD_SEQUENCES: Record<string, string[][]> = {
  'missing before new, then exists': [
    [P, 'state'], [P, 'state', '--json'], [P, 'power', 'on'], NEW, NEW, ['new', P, '--profile', 'MV601-IDEAL'], [P, 'state', '--json'],
  ],
  'the dial motor turning, a hand turn, and state --json': [
    NEW,
    [P, 'connect', '1+/D17', '+', 'connect', 'D18/1-', '+', 'power', 'on', '+', 'state'],
    [P, 'wait', '1000', '+', 'state'],
    [P, 'state', '--json'],
    [P, 'disconnect', 'all', '+', 'dial', 'hold', '45', '+', 'wait', '300'],
    [P, 'dial', 'hold', '359.999999'],
    [P, 'dial', 'release', '+', 'wait', '500', '+', 'state'],
    [P, 'dial', 'hold', '22.5', '+', 'wait', '2000', '+', 'state'],
  ],
  'a buzzing relay that does not settle, a cooling lamp, a long wait': [
    NEW,
    [P, 'connect', '1+/1H', '+', 'connect', '1J/1E', '+', 'connect', '1F/1-', '+', 'power', 'on', '--settle-ms', '100'],
    [P, 'wait', '2000', '+', 'state'],
    [P, 'disconnect', 'all', '+', 'connect', '1+/1Y', '+', 'connect', '1X/2Y', '+', 'connect', '2X/2A', '+', 'connect', '2B/2-'],
    [P, 'button', '1', 'down', '+', 'button', '2', 'down', '+', 'wait', '500'],
    [P, 'button', '1', 'up'],
    [P, 'wait', '60000', '--settle-ms', '60000', '+', 'state'],
  ],
  'free ends, pairs, holes, ids and odd numbers': [
    NEW,
    [P, 'connect', 'M10/free', '+', 'connect', 'FREE/1A', '+', 'state'],
    [P, 'connect', 'free/free'],
    [P, 'connect', '1A/1B', '+', 'connect', '1B/1A'],
    [P, 'disconnect', '1B/1A'],
    [P, 'disconnect', 'M10/free', '+', 'disconnect', '1A/free', '+', 'state'],
    [P, 'connect', '1A/1A'],
    [P, 'connect', '1+/1C', '+', 'connect', '1+/1E', '+', 'connect', '1C/1+'],
    [P, 'disconnect', '99999999999999999999'],
    [P, 'disconnect', '9999999999999999999999'],
    [P, 'disconnect', '256'],
    [P, 'disconnect', '00003', '+', 'disconnect', '3'],
    [P, 'button', '1', '-0', '+', 'switch', '2', '1000'],
    [P, 'switch', '7', 'left'],
    [P, 'button', '1', '1001'],
    [P, 'relay', '1', 'hold', 'in', '+', 'wait', '200', '+', 'relay', '1', 'release'],
    [P, 'relay', '0', 'release'],
    [P, 'relay', '7', 'hold', '500'],
    [P, 'press', '1'],
    [P, 'button', '1', 'press', '30001'],
    [P, 'button', '1', 'press', '0'],
    [P, 'button', '2', 'press', '7', '+', 'button', '2', 'press'],
    [P, 'wait', '60001'],
    [P, 'wait', '0'],
    [P, 'wait', '-5'],
    [P, 'state'],
  ],
  'breaker trip and reset, load-program over itself': [
    NEW,
    [P, 'connect', '1+/1-', '+', 'power', 'on', '+', 'state'],
    [P, 'disconnect', '0', '+', 'breaker', 'reset', '+', 'state'],
    [P, 'load-program', 'I-EXP4', '+', 'power', 'on', '+', 'button', '1', 'down', '+', 'button', '2', 'down', '+', 'state'],
    [P, 'load-program', 'I-EXP4'],
    [P, 'load-program', 'I-EXP4', '+', 'state'],
    [P, 'disconnect', 'all', '+', 'load-program', 'IV-EXP1-SLOW', '+', 'power', 'on'],
    [P, 'button', '6', 'press', '+', 'button', '6', 'press', '+', 'state'],
  ],
  'three relays in series, starved (snapshot notes)': [
    NEW,
    [P, 'connect', '1+/1C', '+', 'connect', '1F/2C', '+', 'connect', '2F/3C', '+', 'connect', '3F/1-', '+', 'power', 'on', '+', 'state'],
    [P, 'state', '--json'],
    [P, 'disconnect', 'all', '+', 'connect', '1+/1A', '+', 'connect', '1B/2A', '+', 'connect', '2B/3A', '+', 'connect', '3B/4A', '+',
      'connect', '4B/1C', '+', 'connect', '1F/1-', '+', 'power', 'on', '+', 'wait', '1000'],
    [P, 'state', '--json'],
  ],
  'the IDEAL profile': [
    ['new', P, '--profile', 'MV601-IDEAL'],
    [P, 'load-program', 'I-EXP4', '+', 'power', 'on', '+', 'button', '1', 'down', '+', 'button', '2', 'down', '+', 'state'],
    [P, 'state', '--json'],
  ],
  // The boundaries below each pinned a C# mutation the sequences above let through.
  // PATH_LIMIT: the dial steps exactly 6 times (all values kept, `elided` false), then 7 (elided);
  // pins PATH_LIMIT itself and the head's `<=` length bound.
  'a change path of exactly PATH_LIMIT transitions': [
    NEW,
    [P, 'connect', '1+/D17', '+', 'connect', 'D18/1-', '+', 'power', 'on', '+', 'wait', '10', '+', 'wait', '250', '--settle-ms', '1'],
  ],
  'a change path one past PATH_LIMIT': [
    NEW,
    [P, 'connect', '1+/D17', '+', 'connect', 'D18/1-', '+', 'power', 'on', '+', 'wait', '50', '+', 'wait', '250', '--settle-ms', '1'],
  ],
  // A lamp still warming when a 1 ms settle (10 ticks, far short of the 200 quiet ticks) runs
  // out: only the cap tick's lamp reading (`waited + 1 === maxTicks`) reports it.
  'a lamp still moving at an unsettled cap': [
    NEW,
    [P, 'connect', '1+/1A', '+', 'connect', '1B/1-', '+', 'power', 'on', '--settle-ms', '1'],
  ],
  // Both press arguments bad: the section number is checked before the time.
  'a press with a bad section and a bad time': [
    NEW,
    [P, 'button', '7', 'press', '30001'],
    [P, 'button', '0', 'press', '0'],
  ],
  // A lone surrogate in the words reaches the table as one UTF-16 unit, as JSON.parse keeps it,
  // and is refused as an unknown terminal, not answered with an engine error.
  'a lone surrogate in a free-end wire': [
    NEW,
    [P, 'connect', '\ud800/free'],
    [P, 'connect', 'x\udc00y/FREE', '+', 'state'],
    [P, 'disconnect', '\ud800/free'],
    [P, 'connect', '1A/free'],
    [P, 'state'],
  ],
};

/** Reply shapes the added sequences must carry, so the comparison is not vacuous for them. */
const SHAPES: Record<string, RegExp> = {
  'a snapshot note': /"notes":\[\{"k":"(?:lamp-in-coil-path|coil-starved)"/,
  'a device still moving at the settle cap': /"moving":\["/,
  'a lamp still cooling at settle': /"lampsMoving":\["/,
  'an elided change path': /"elided":true/,
  'a dial on a contact': /"contact":[0-9]/,
  'the dial motor turning': /"dialMrpm":[1-9]/,
  'a free cord end': /"b":null,"wire":"[^"]+\/free"/,
  'a tripped breaker': /"breakerTripped":true/,
  'a held relay': /"held":true/,
  'a change path of exactly PATH_LIMIT transitions': new RegExp('"transitions":' + PATH_LIMIT + ',"elided":false'),
  'a change path one past PATH_LIMIT': new RegExp('"transitions":' + (PATH_LIMIT + 1) + ',"elided":true'),
  'a lamp moving at an unsettled cap': /"settled":false,[^}]*"lampsMoving":\["/,
  'a lone surrogate refused as a terminal': /"detail":"\\"\\\\ud800\\" is not a terminal"/,
};

describe('transfer: sequences the recordings do not reach', () => {
  const replies: string[] = [];

  it.each(Object.entries(WORD_SEQUENCES))('%s', async (_, calls) => {
    for (const exchange of await transfer(calls)) replies.push(exchange.reply);
  }, 120_000);

  it('those sequences reached every reply shape listed', () => {
    expect(Object.entries(SHAPES).filter(([, shape]) => !replies.some((reply) => shape.test(reply))).map(([name]) => name)).toEqual([]);
  });
});

const BASE = newSession(netlist, refA);
const HEAD = {
  schema: BASE.schema, profile: BASE.profile, contract: BASE.contract, netlistHash: BASE.netlistHash, profileHash: BASE.profileHash,
};
const run = (calls: unknown, settleMs?: unknown): unknown => (settleMs === undefined ? { op: 'run', calls } : { op: 'run', calls, settleMs });
const call = (name: unknown, args?: unknown): unknown => (args === undefined ? { name } : { name, args });
const createWith = (script: unknown, extra: object = {}): unknown => ({ op: 'create', session: { ...HEAD, script, ...extra } });
const connectStep = (cord: unknown, a: string, b: string | null): unknown =>
  ({ k: 'do', cmd: { k: 'connect', cord, a: { k: 'hole', hole: a }, b: b === null ? { k: 'free' } : { k: 'hole', hole: b } } });

const REQUEST_SEQUENCES: Record<string, unknown[]> = {
  'missing, unknown profile, no session, exists': [
    { op: 'state' }, { op: 'session' }, run([call('power', { on: true })], 500),
    { op: 'create', session: { ...BASE, profile: 'MV601-NOPE' } },
    { op: 'create', session: { ...BASE, profile: 7 } },
    { op: 'create' },
    { op: 'nope' },
    { op: 'create', session: BASE },
    { op: 'create', session: BASE },
    { op: 'create', session: { ...BASE, profile: 'MV601-IDEAL' } },
    { op: 'state' }, { op: 'session' },
  ],
  'malformed batches': [
    { op: 'create', session: BASE },
    run([call('nope', {})], 500),
    run([call(5, {})], 500),
    run([call('power')], 500),
    run([call('power', null)], 500),
    run(undefined, 500),
    run(null, 500),
    run('', 500),
    run(7, 500),
    run([null], 500),
    run([call('connect', { a: 5, b: '1A' })], 500),
    run([call('connect', { b: '1A' })], 500),
    run([call('connect', { a: '1A', b: 5 })], 500),
    run([call('connect', { a: 'free', b: 5 })], 500),
    run([call('connect', { a: '1Q', b: '1A' })], 500),
    run([call('connect', { a: '1+', b: '1−' })], 500),
    run([call('connect', { a: '+', b: '1A' })], 500),
    run([call('connect', { a: 'tab\there "q" \\ \u0001   é', b: '1A' })], 500),
    run([call('disconnect', 'all')], 500),
    run([call('disconnect', [1])], 500),
    run([call('disconnect', { all: false })], 500),
    run([call('disconnect', { cord: 1.5 })], 500),
    run([call('disconnect', { cord: '3' })], 500),
    run([call('disconnect', { cord: null })], 500),
    run([call('disconnect', { cord: [1, null, 'x'] })], 500),
    run([call('disconnect', { cord: { a: 1 } })], 500),
    run([call('disconnect', { cord: 1e-7 })], 500),
    run([call('disconnect', { cord: 123456789.125 })], 500),
    run([call('disconnect', { a: '1A', b: 'x' })], 500),
    run([call('button', { n: '1', target: 0 })], 500),
    run([call('button', { n: 1 })], 500),
    run([call('power', { on: 1 })], 500),
    run([call('breaker', { reset: false })], 500),
    run([call('breaker', { reset: 'true' })], 500),
    run([call('dialGrab', { targetUdeg: -1 })], 500),
    run([call('dialGrab', { targetUdeg: 1.5 })], 500),
    run([call('relayRelease', {})], 500),
    run([call('press', { n: 1, ms: null })], 500),
    run([call('press', { n: 1, ms: '5' })], 500),
    run([call('press', { n: 1.5 })], 500),
    run([call('wait', { ms: 1.5 })], 500),
    run([call('wait', {})], 500),
    run([call('wait')], 500),
    run([call('loadProgram', { program: 5, wires: ['1A/1B'] })], 500),
    run([call('loadProgram', { wires: ['1A/1B'] })], 500),
    run([call('loadProgram', { program: 'X1', wires: '1A/1B' })], 500),
    run([call('loadProgram', { program: 'X1', wires: [] })], 500),
    run([call('loadProgram', { program: 'X1\n', wires: ['1A/1B'] })], 500),
    run([call('loadProgram', { program: 'X1', wires: ['1A/free'] })], 500),
    run([call('loadProgram', { program: 'X1', wires: ['free/1A'] })], 500),
    run([call('loadProgram', { program: 'X1', wires: [5] })], 500),
    run([call('loadProgram', { program: 'X1', wires: [null] })], 500),
    run([call('loadProgram', { program: 'X1', wires: ['1A/1B/1C'] })], 500),
    run([call('state', {})], 500),
    run([call('power', { on: true })]),
    run([call('power', { on: true })], 0),
    run([call('power', { on: true })], 60001),
    run([call('power', { on: true })], null),
    run([call('power', { on: true })], 1.5),
    run([call('power', { on: true })], '500'),
    run([call('wait', { ms: 50 }), call('press', { n: 1, ms: 30001 })], 500),
    run([call('wait', { ms: 50 }), call('wait', { ms: 50 })], 1),
    { op: 'state' }, { op: 'session' },
  ],
  'a replayed session keeps its own spelling': [
    // The session's own key order (index key first, as a JS object orders it), an extra key, and
    // its step spellings must come back in the export.
    { op: 'create', session: { note: 'kept', profileHash: HEAD.profileHash, '7': 'index key', schema: HEAD.schema,
      profile: HEAD.profile, contract: HEAD.contract, netlistHash: HEAD.netlistHash, script: [
      { k: 'load', program: 'I-EXP4', cords: 4, extra: 'dropped' },
      connectStep(0, '1+#1', '1Y#1'), connectStep(1, '1X#1', '2Y#1'), connectStep(2.0, '2X#1', '2A#1'),
      { cmd: { b: { hole: '2-#1', k: 'hole' }, a: { k: 'hole', hole: '2B#1' }, cord: 3, k: 'connect', '5': 'odd', x: 1 }, k: 'do' },
      { k: 'do', cmd: { on: true, k: 'power', on2: null } },
      { k: 'settle', maxMs: 500.0, ignored: true },
      { k: 'do', cmd: { k: 'button', n: 1, target: 1e3 } },
      { k: 'do', cmd: { k: 'button', n: 2, target: 1000, k2: 'x' } },
      { k: 'advance', ms: 200 },
      connectStep(4, 'M10#1', null),
      { k: 'do', cmd: { k: 'relayGrab', n: 1, target: 1000 } }, { k: 'advance', ms: 50 },
      { k: 'do', cmd: { k: 'relayRelease', n: 1 } },
      { k: 'do', cmd: { k: 'dialGrab', targetUdeg: 45000000 } }, { k: 'settle', maxMs: 100 },
      { k: 'do', cmd: { k: 'dialRelease' } },
      { k: 'do', cmd: { k: 'breaker', reset: true } },
      { k: 'do', cmd: { k: 'disconnect', cord: 4 } },
    ] } },
    { op: 'session' },
    run([call('press', { n: 3 }), call('connect', { a: 'M10', b: 'free' })], 500),
    { op: 'session' }, { op: 'state' },
  ],
  'corrupt sessions are refused and the next create works': [
    createWith([], { schema: 'minivac.session/2' }),
    createWith([], { contract: '9.9.9' }),
    createWith([], { contract: undefined }),
    createWith([], { netlistHash: 'fnv1a64:0000000000000000' }),
    createWith([], { netlistHash: 12 }),
    createWith([], { profileHash: ['a', null, 2] }),
    createWith(undefined),
    createWith(null),
    createWith('ab'),
    createWith(''),
    createWith(3),
    createWith([null]),
    createWith([{ k: 'nope' }]),
    createWith([{ k: 'do' }]),
    createWith([{ k: 'do', cmd: 5 }]),
    createWith([{ k: 'do', cmd: {} }]),
    createWith([{ k: 'do', cmd: { k: 'power', on: true }, collapse: true }]),
    createWith([{ k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'touch', term: '1A' }, b: { k: 'free' } } }]),
    createWith([{ k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'hole', hole: '1A#1' }, b: { k: 'free' }, r_uohm: null } }]),
    createWith([{ k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'hole', hole: 5 }, b: { k: 'free' } } }]),
    createWith([{ k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'hole', hole: '1A#3' }, b: { k: 'free' } } }]),
    createWith([{ k: 'do', cmd: { k: 'connect', cord: 0.5, a: { k: 'hole', hole: '1A#1' }, b: { k: 'free' } } }]),
    createWith([{ k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'hole', hole: '1A#1' } } }]),
    createWith([connectStep(0, '1A#1', '1B#1'), connectStep(1, '1A#1', '1C#1')]),
    createWith([connectStep(0, '1A#1', '1B#1'), connectStep(0, '1C#1', '1E#1')]),
    createWith([{ k: 'do', cmd: { k: 'disconnect', cord: 3 } }]),
    createWith([{ k: 'do', cmd: { k: 'power', on: 'yes' } }]),
    createWith([{ k: 'do', cmd: { k: 'button', n: 1, target: 1000.5 } }]),
    createWith([{ k: 'do', cmd: { k: 'warp' } }]),
    createWith([{ k: 'load', program: 'I-EXP4', cords: 2 }, connectStep(0, '1A#1', '1B#1')]),
    createWith([{ k: 'load', program: 'I-EXP4', cords: 1 }, null]),
    createWith([{ k: 'load', program: 'i-exp4', cords: 1 }]),
    createWith([{ k: 'load', program: 'I-EXP4', cords: 0 }]),
    createWith([{ k: 'load', program: 'I-EXP4', cords: 1.5 }]),
    createWith([{ k: 'advance', ms: 0 }]),
    createWith([{ k: 'advance', ms: '5' }]),
    createWith([{ k: 'settle', maxMs: 60001 }]),
    { op: 'state' },
    { op: 'create', session: { ...BASE, profile: 'MV601-IDEAL', profileHash: newSession(netlist, ideal).profileHash } },
    { op: 'session' },
  ],
  // JSON.parse keeps an escaped lone surrogate as one UTF-16 unit, in keys and in values.
  'lone surrogates in keys and values': [
    createWith([{ k: 'load', program: '\ud800', cords: 1 }]),
    createWith([{ k: 'do', cmd: { k: 'connect', cord: 0, a: { k: 'hole', hole: 'x\udfff' }, b: { k: 'free' } } }]),
    { op: 'create', session: { '\udc00x': '\ud800', ...BASE } },
    run([call('power', { '\ud800': 1, on: true }), call('loadProgram', { program: '\ud800', wires: ['1A/1B'] })], 500),
    run([call('connect', { a: '\udfff', b: '1A' })], 500),
    run([call('\ud800', {})], 500),
    run('\ud800', 500),
    { op: 'session' },
  ],
};

describe('transfer: requests Node\'s parser never builds', () => {
  it.each(Object.entries(REQUEST_SEQUENCES))('%s', (_, requests) => {
    transferRequests(requests);
  }, 60_000);
});

// A seeded random differential: calls built from the words `tools/hands/invocation.ts` accepts
// (and some it refuses, and junk terminal names), each session sent through `callOnPage` to both
// engines as above. The seed is fixed, so a run is repeatable; a mismatch is shrunk to the
// fewest calls that still differ and reported with the seed.
const SEED = 601;
const RANDOM_SESSIONS = 24;
const RANDOM_CALLS = 40;

/** mulberry32: a small seeded generator, the same stream on every run. */
function generator(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROGRAMS = (readdirSync(new URL('../conformance/fixtures/', import.meta.url), { recursive: true, encoding: 'utf8' }))
  .map((path) => path.split('/').pop() as string).filter((name) => name.endsWith('.fixture.json'))
  .map((name) => name.slice(0, -'.fixture.json'.length)).sort();
const NEAR = ['1A', '1B', '1C', '1E', '1F', '1H', '1J', '1X', '1Y', '1+', '1-', '2A', '2B', '2C', '2F', '2X', '2Y', '2+', '2-',
  '3C', '3F', 'M10', 'M11', 'D0', 'D1', 'D17', 'D18'];
const JUNK = ['1a', '1y', 'X', '1−', '"', '\\', 'é', '\u0001', '😀', '\ud800', 'x\udc00y', 'free', 'FREE', 'Free', 'constructor',
  '__proto__', '1com', '+'];

function randomCalls(rnd: () => number, count: number): string[][] {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)] as T;
  const num = (items: readonly (string | number)[]): string => String(pick(items));
  const term = (): string => (rnd() < 0.8 ? pick(TERMINAL_NAMES) : pick(JUNK));
  const near = (): string => (rnd() < 0.7 ? pick(NEAR) : term());
  const command = (): string[] => {
    const r = rnd();
    if (r < 0.30) {
      const f = rnd();
      if (f < 0.12) return ['connect', near() + '/' + pick(['free', 'FREE', 'Free'])];
      if (f < 0.18) return ['connect', pick(['free', 'FREE']) + '/' + near()];
      return ['connect', near() + '/' + near()];
    }
    if (r < 0.40) {
      const f = rnd();
      if (f < 0.2) return ['disconnect', 'all'];
      if (f < 0.6) return ['disconnect', num([0, 1, 2, 3, 4, 5, 6, 10, 255, 256, '007', '00', '99999999999999999999'])];
      if (f < 0.75) return ['disconnect', near() + '/free'];
      return ['disconnect', near() + '/' + near()];
    }
    if (r < 0.48) return ['power', pick(['on', 'on', 'off'])];
    if (r < 0.60) {
      const n = num([1, 2, 3, 4, 5, 6, 1, 2, 0, 7, -1, '99999999999']);
      if (rnd() < 0.4) return ['button', n, 'press', ...(rnd() < 0.5 ? [] : [num([1, 5, 50, 100, 300, 30001, 0, -2])])];
      return ['button', n, pick(['down', 'up', '500', '1000', '0', '1001', '-0'])];
    }
    if (r < 0.66) return ['switch', num([1, 2, 3, 4, 5, 6, 0, 7]), pick(['left', 'right', '500', '1001'])];
    if (r < 0.76) return ['wait', num([1, 10, 50, 100, 300, 500, 1000, 2000, 0, -5, 60001, '99999999999'])];
    if (r < 0.82) {
      return rnd() < 0.5 ? ['relay', num([1, 2, 3, 6, 0, 7]), 'hold', pick(['in', 'out', '500', '1000', '1001'])]
        : ['relay', num([1, 2, 3, 7]), 'release'];
    }
    if (r < 0.88) return rnd() < 0.6 ? ['dial', 'hold', pick(['0', '22.5', '45', '90.000001', '180', '359.999999', '11.25'])] : ['dial', 'release'];
    if (r < 0.92) return ['breaker', 'reset'];
    return ['load-program', pick(PROGRAMS)];
  };
  const calls: string[][] = [rnd() < 0.5 ? NEW : ['new', P, '--profile', 'MV601-IDEAL']];
  for (let i = 0; i < count; i++) {
    const r = rnd();
    if (r < 0.06) {
      calls.push([P, 'state', ...(rnd() < 0.5 ? ['--json'] : [])]);
      continue;
    }
    if (r < 0.08) {
      calls.push(rnd() < 0.5 ? NEW : ['new', P, '--profile', 'MV601-IDEAL']);
      continue;
    }
    const words = [P];
    const commands = 1 + Math.floor(rnd() * 5);
    for (let c = 0; c < commands; c++) words.push(...(c > 0 ? ['+'] : []), ...command());
    if (rnd() < 0.3) words.push('+', 'state');
    if (rnd() < 0.3) words.push('--settle-ms', num([1, 5, 50, 100, 500, 2000]));
    calls.push(words);
  }
  return calls;
}

/** The first difference `transfer` finds for these calls, or null when both engines agree. */
async function difference(calls: readonly string[][]): Promise<string | null> {
  try {
    await transfer(calls);
    return null;
  } catch (problem: unknown) {
    return message(problem);
  }
}

/**
 * Drop calls one at a time, last first, keeping each drop that still leaves a difference, and
 * repeat until no single call can go: the result is minimal in that sense.
 */
async function shrink(calls: readonly string[][]): Promise<string[][]> {
  let fewest = [...calls];
  for (let dropped = true; dropped;) {
    dropped = false;
    for (let i = fewest.length - 1; i >= 0; i--) {
      const fewer = fewest.filter((_, j) => j !== i);
      if (await difference(fewer) !== null) {
        fewest = fewer;
        dropped = true;
      }
    }
  }
  return fewest;
}

const TERMINAL_NAMES = TERMINALS.map((terminal) => terminal.id);
const RANDOM = ((): string[][][] => {
  const rnd = generator(SEED);
  return Array.from({ length: RANDOM_SESSIONS }, () => randomCalls(rnd, RANDOM_CALLS));
})();

describe('transfer: a seeded random differential (seed ' + SEED + ')', () => {
  it.each(RANDOM.map((calls, session) => ({ name: 'session ' + session, session, calls })))('$name', async ({ session, calls }) => {
    const found = await difference(calls);
    if (found === null) return;
    const fewest = await shrink(calls);
    throw new Error('transfer differential: seed ' + SEED + ', session ' + session + '; the fewest calls that still differ:\n' +
      JSON.stringify(fewest) + '\nfirst difference: ' + (await difference(fewest) ?? found));
  }, 600_000);
});
