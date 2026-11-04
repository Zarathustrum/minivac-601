// tools/hands-pane/server.ts against a fake OpenAI-compatible server on node:http and a fake page:
// Node's global WebSocket with the page's own engine (src/pane/engine.ts) answering the server's
// requests in-process. No real model server is reached.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadNetlist } from '../../src/core/netlist.ts';
import { createPaneEngine } from '../../src/pane/engine.ts';
import type { PaneEngine } from '../../src/pane/engine.ts';
import { CLOSE_BAD_PROTOCOL, CLOSE_BAD_TOKEN, PANE_PROTOCOL } from '../../src/pane/protocol.ts';
import type { PageMessage, PaneReply, ServerMessage, TurnEvent } from '../../src/pane/protocol.ts';
import { readItem, checkItem } from '../../tools/checklist/check.ts';
import { SYSTEM_PREAMBLE, type Message } from '../../tools/hands-api/openai-loop.ts';
import { fileBackend } from '../../tools/hands/backend.ts';
import { runWith } from '../../tools/hands/cli.ts';
import { formatSession, loadRepoNetlist, loadRepoProfile, readSession } from '../../tools/hands/session-file.ts';
import {
  DEV_ORIGINS, FIRST_TURN_PREFIX, optionsFromEnv, redact, startPaneServer, type PaneServer, type PaneServerOptions,
} from '../../tools/hands-pane/server.ts';

const ORIGIN = 'http://127.0.0.1:4174';
const KEY = 'test-key-never-sent';
const PRIMARY = 'http://primary.test/v1';
/** The routes the test server allows, the default first. */
const ROUTES = ['model-a', 'model-b', 'model-c'];
const netlist = loadRepoNetlist();
const PROFILES = [loadRepoProfile('MV601-REF-A'), loadRepoProfile('MV601-IDEAL')];

const home = process.cwd();
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  process.chdir(home);
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mv601-pane-server-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- the fake model server ----

/** `raw` is sent as the body instead of `body` as JSON. */
interface Reply { status?: number; headers?: Record<string, string>; body: unknown; raw?: string; delayMs?: number }
interface Fake { base: string; seen: { messages: Message[]; model: string }[]; headers: Record<string, string | string[] | undefined>[] }

async function fakeLlm(replies: Reply[]): Promise<Fake> {
  const fake: Fake = { base: '', seen: [], headers: [] };
  const timers = new Set<NodeJS.Timeout>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      fake.seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Fake['seen'][number]);
      fake.headers.push(req.headers);
      const reply = replies[fake.seen.length - 1] ?? { body: { error: 'script exhausted' } };
      const answer = (): void => {
        res.writeHead(reply.status ?? (replies[fake.seen.length - 1] ? 200 : 500), { 'Content-Type': 'application/json', ...reply.headers });
        res.end(reply.raw ?? JSON.stringify(reply.body));
      };
      if (reply.delayMs === undefined) answer();
      else timers.add(setTimeout(answer, reply.delayMs));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  fake.base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1';
  cleanups.push(() => new Promise<void>((done) => {
    for (const timer of timers) clearTimeout(timer);
    server.closeAllConnections();
    server.close(() => done());
  }));
  return fake;
}

let nextId = 0;
const usage = { prompt_tokens: 10, completion_tokens: 2 };
const served = (base: string, extra: Record<string, string> = {}): Record<string, string> =>
  ({ 'x-litellm-model-api-base': base, ...extra });

function tool(name: string, args: object, headers = served(PRIMARY)): Reply {
  const call = { id: 'call_' + nextId++, type: 'function', function: { name, arguments: JSON.stringify(args) } };
  return { headers, body: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [call] }, finish_reason: 'tool_calls' }], usage } };
}

function control(args: string, headers = served(PRIMARY)): Reply {
  return tool('minivac_control', { args }, headers);
}

function say(text: string, headers = served(PRIMARY)): Reply {
  return { headers, body: { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage } };
}

// ---- the server and the fake page ----

async function startServer(fake: Fake, extra: Partial<PaneServerOptions> = {}): Promise<{ server: PaneServer; runs: string }> {
  const runs = join(tempDir(), 'runs');
  const server = await startPaneServer({
    base: fake.base, key: KEY, port: 0, origins: [ORIGIN], routes: ROUTES, runsRoot: runs, primary: { 'model-a': PRIMARY }, ...extra,
  });
  cleanups.push(() => server.close());
  return { server, runs };
}

interface FakePage {
  frames: ServerMessage[];
  /** Every text frame as received, to check what never crosses the socket. */
  raw: string[];
  send(message: PageMessage): void;
  /** The first frame (from the start) matching `match`, waiting for it if need be. */
  waitFor<T extends ServerMessage['type']>(type: T, match?: (frame: Extract<ServerMessage, { type: T }>) => boolean):
    Promise<Extract<ServerMessage, { type: T }>>;
  closed: Promise<number>;
  close(): void;
}

interface PageOptions {
  origin?: string;
  /** The engine's data; a fresh engine is built on every `started`, as the page does. */
  engine?: () => PaneEngine;
  /** Answer a request yourself; return true when handled. */
  onRequest?: (frame: Extract<ServerMessage, { type: 'request' }>, page: FakePage) => boolean;
}

/** Node's WebSocket takes headers (undici); the DOM type it is declared with does not say so. */
type NodeWebSocket = new (url: string, init: { headers: Record<string, string> }) => WebSocket;

function openPage(server: PaneServer, options: PageOptions = {}): FakePage {
  const ws = new (WebSocket as unknown as NodeWebSocket)('ws://127.0.0.1:' + server.port + '/', {
    headers: { Origin: options.origin ?? ORIGIN },
  });
  const makeEngine = options.engine ?? ((): PaneEngine => createPaneEngine(netlist, PROFILES));
  let engine = makeEngine();
  const waiters = new Set<() => boolean>();
  const outbox: string[] = [];
  const page: FakePage = {
    frames: [],
    raw: [],
    send(message) {
      const text = JSON.stringify(message);
      if (ws.readyState === WebSocket.OPEN) ws.send(text);
      else outbox.push(text);
    },
    waitFor(type, match) {
      const find = (): Extract<ServerMessage, { type: typeof type }> | undefined => page.frames.find(
        (frame): frame is Extract<ServerMessage, { type: typeof type }> => frame.type === type &&
          (match === undefined || match(frame as Extract<ServerMessage, { type: typeof type }>)));
      return new Promise((done, fail) => {
        const check = (): boolean => {
          const found = find();
          if (found === undefined) return false;
          clearTimeout(timer);
          done(found);
          return true;
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          fail(new Error('no ' + type + ' frame; got ' + JSON.stringify(page.frames.map((f) => f.type))));
        }, 5000);
        if (!check()) waiters.add(check);
      });
    },
    closed: new Promise((done) => ws.addEventListener('close', (event) => done(event.code))),
    close: () => ws.close(),
  };
  ws.addEventListener('open', () => { for (const text of outbox.splice(0)) ws.send(text); });
  ws.addEventListener('message', (event) => {
    const text = String(event.data);
    page.raw.push(text);
    const frame = JSON.parse(text) as ServerMessage;
    page.frames.push(frame);
    if (frame.type === 'started') engine = makeEngine();
    if (frame.type === 'request' && !(options.onRequest?.(frame, page) ?? false)) {
      let reply: PaneReply;
      switch (frame.op) {
        case 'create': reply = engine.create(frame.session); break;
        case 'run': reply = engine.run(frame.calls, frame.settleMs); break;
        case 'state': reply = engine.state(); break;
        case 'session': reply = engine.session(); break;
      }
      page.send({ type: 'reply', id: frame.id, reply });
    }
    for (const check of [...waiters]) if (check()) waiters.delete(check);
  });
  cleanups.push(() => ws.close());
  return page;
}

async function connected(server: PaneServer, options: PageOptions = {}): Promise<FakePage> {
  const page = openPage(server, options);
  page.send({ type: 'hello', protocol: PANE_PROTOCOL, token: server.token });
  await page.waitFor('ready');
  return page;
}

/** The status of a bare upgrade request with these headers: 101 when the server takes it. */
function upgradeStatus(port: number, headers: Record<string, string>): Promise<number> {
  return new Promise((done, fail) => {
    const req = request({
      host: '127.0.0.1', port, path: '/',
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': randomBytes(16).toString('base64'), Host: '127.0.0.1:' + port, ...headers,
      },
    });
    req.on('response', (res) => { res.resume(); done(res.statusCode ?? 0); });
    req.on('upgrade', (_res, socket) => { socket.destroy(); done(101); });
    req.on('error', fail);
    req.end();
  });
}

async function eventually<T>(read: () => T | undefined, what: string): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((done) => setTimeout(done, 20));
  }
  throw new Error('timed out waiting for ' + what);
}

function readJson(path: string): Record<string, unknown> | undefined {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> : undefined;
}

const B1 = ['new pane.json', 'pane.json connect 1+/1A + connect 1B/1- + power on'];

describe('pane server: a full turn', () => {
  it('wires B1 on the page with the CLI\'s text, and writes the run directory', async () => {
    const fake = await fakeLlm([control(B1[0] as string), control(B1[1] as string), say('Lamp 1 is on.')]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server);
    expect(page.frames[0]).toStrictEqual({ type: 'ready', routes: [...ROUTES], maxUserChars: 8000 });

    page.send({ type: 'user', text: 'Wire B1.', route: 'model-a' });
    const done = await page.waitFor('done');
    expect(done).toStrictEqual({ type: 'done', stop: 'done', text: 'Lamp 1 is on.' });
    const started = await page.waitFor('started');
    expect(started.run).toMatch(/^\d{4}-\d{2}-\d{2}-pane-1$/);

    // What the model saw: the CLI's bytes for the same words, from the file backend.
    process.chdir(tempDir());
    const turns = page.frames.filter((frame): frame is TurnEvent => frame.type === 'turn');
    expect(turns).toHaveLength(3);
    for (const [i, args] of B1.entries()) {
      const cli = runWith(args.split(' '), fileBackend, { pinned: 'pane.json' });
      expect(cli.code).toBe(0);
      expect(turns[i]?.calls).toStrictEqual([{
        name: 'minivac_control', args: JSON.stringify({ args }), output: cli.stdout + cli.stderr + '\n[exit 0]',
      }]);
      expect(turns[i]).toMatchObject({ servedBy: PRIMARY, offPrimary: false, fallbacks: 0, status: 200 });
    }
    expect(turns[2]).toMatchObject({ content: 'Lamp 1 is on.', calls: [] });

    // The prompt: the skill as system prompt, the checklist runs' prefix naming pane.json on the first message.
    const first = fake.seen[0] as Fake['seen'][number];
    expect(first.model).toBe('model-a');
    expect(first.messages[0]?.content?.startsWith(SYSTEM_PREAMBLE)).toBe(true);
    expect(first.messages[1]).toStrictEqual({ role: 'user', content: FIRST_TURN_PREFIX + 'Wire B1.\n' });
    expect(fake.headers[0]?.authorization).toBe('Bearer ' + KEY);
    for (const text of page.raw) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(fake.base);
    }

    const dir = join(runs, started.run);
    expect(readdirSync(dir).sort()).toEqual(['run.json', 'session.json', 'transcript.jsonl']);
    const lines = readFileSync(join(dir, 'transcript.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line) as object);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatchObject({ turn: 1, servedBy: PRIMARY, calls: [{ name: 'minivac_control' }] });
    expect(readJson(join(dir, 'run.json'))).toMatchObject({
      model: 'model-a', turns: 3, toolCalls: 2, promptTokens: 30, completionTokens: 6, served: [PRIMARY], fallbacks: 0,
      stop: 'done', finalText: 'Lamp 1 is on.', prompts: [{ route: 'model-a', text: 'Wire B1.' }],
    });
    expect(readJson(join(dir, 'run.json'))).not.toHaveProperty('invalid');
    const session = readSession(join(dir, 'session.json'));
    expect(formatSession(session)).toBe(readFileSync('pane.json', 'utf8'));
    expect(checkItem(readItem(join(home, 'checklist/items/B1.json')), session)).toMatchObject({ code: 0, stdout: 'PASS B1\n' });

    page.send({ type: 'end' });
    expect(await page.waitFor('ended')).toStrictEqual({ type: 'ended', run: started.run });
    expect(readJson(join(dir, 'run.json'))).not.toHaveProperty('invalid');
  });

  it('continues the conversation on the next message, and a new session after end', async () => {
    const fake = await fakeLlm([control('new pane.json'), say('Made it.'), control('pane.json state'), say('All off.'), say('Fresh.')]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    await page.waitFor('done');
    page.send({ type: 'user', text: 'Look.', route: 'model-b' });
    await page.waitFor('done', (frame) => frame.text === 'All off.');
    const second = fake.seen[2] as Fake['seen'][number];
    expect(second.model).toBe('model-b');
    expect(second.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'user']);
    expect(second.messages[5]).toStrictEqual({ role: 'user', content: 'Look.' });
    const run = (await page.waitFor('started')).run;
    expect(readJson(join(runs, run, 'run.json'))).toMatchObject({
      model: 'model-b', turns: 4, toolCalls: 2, stop: 'done', finalText: 'All off.',
      prompts: [{ route: 'model-a', text: 'Start.' }, { route: 'model-b', text: 'Look.' }],
    });

    page.send({ type: 'end' });
    await page.waitFor('ended');
    page.send({ type: 'user', text: 'Again.', route: 'model-a' });
    const next = await page.waitFor('started', (frame) => frame.run !== run);
    expect(next.run).toBe(run.replace(/-1$/, '-2'));
    await page.waitFor('done', (frame) => frame.text === 'Fresh.');
    expect((fake.seen[4] as Fake['seen'][number]).messages.map((m) => m.role)).toEqual(['system', 'user']);
  });
});

describe('pane server: stop', () => {
  it('stops a turn waiting on the model, and the next message continues the conversation', async () => {
    const fake = await fakeLlm([{ ...say('too late'), delayMs: 10_000 }, say('Here.')]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    const run = (await page.waitFor('started')).run;
    await eventually(() => (fake.seen.length === 1 ? true : undefined), 'the request');
    const asked = Date.now();
    page.send({ type: 'stop' });
    expect(await page.waitFor('done')).toStrictEqual({ type: 'done', stop: 'aborted', text: '' });
    expect(Date.now() - asked).toBeLessThan(2000);
    expect(readJson(join(runs, run, 'run.json'))).toMatchObject({ stop: 'aborted', turns: 1 });
    page.send({ type: 'user', text: 'Again.', route: 'model-a' });
    await page.waitFor('done', (frame) => frame.text === 'Here.');
    expect((fake.seen[1] as Fake['seen'][number]).messages.map((m) => m.content)).toEqual([
      expect.stringContaining(SYSTEM_PREAMBLE), FIRST_TURN_PREFIX + 'Start.\n', 'Again.',
    ]);
  });
});

describe('pane server: refusals', () => {
  it('closes on a bad token, saying nothing', async () => {
    const fake = await fakeLlm([]);
    const { server } = await startServer(fake);
    const page = openPage(server);
    page.send({ type: 'hello', protocol: PANE_PROTOCOL, token: server.token.slice(1) + 'x' });
    expect(await page.closed).toBe(CLOSE_BAD_TOKEN);
    expect(page.frames).toEqual([]);
  });

  it('closes when the first frame is not a hello', async () => {
    const fake = await fakeLlm([]);
    const { server } = await startServer(fake);
    const page = openPage(server);
    page.send({ type: 'user', text: 'hi', route: 'model-a' });
    expect(await page.closed).toBe(CLOSE_BAD_TOKEN);
    expect(fake.seen).toEqual([]);
  });

  it('closes on another protocol version', async () => {
    const fake = await fakeLlm([]);
    const { server } = await startServer(fake);
    const page = openPage(server);
    page.send({ type: 'hello', protocol: PANE_PROTOCOL + 1, token: server.token });
    expect(await page.closed).toBe(CLOSE_BAD_PROTOCOL);
  });

  it('refuses an Origin not on the allowlist, and a missing one', async () => {
    const fake = await fakeLlm([]);
    const { server } = await startServer(fake);
    expect(await upgradeStatus(server.port, { Origin: ORIGIN })).toBe(101);
    expect(await upgradeStatus(server.port, { Origin: 'http://localhost:4174' })).toBe(403);
    expect(await upgradeStatus(server.port, { Origin: ORIGIN + '.evil.test' })).toBe(403);
    expect(await upgradeStatus(server.port, {})).toBe(403);
    const page = openPage(server, { origin: 'http://evil.test' });
    expect(await page.closed).toBe(1006);
  });

  it('refuses a Host that is not this server', async () => {
    const fake = await fakeLlm([]);
    const { server } = await startServer(fake);
    expect(await upgradeStatus(server.port, { Origin: ORIGIN, Host: 'localhost:' + server.port })).toBe(101);
    expect(await upgradeStatus(server.port, { Origin: ORIGIN, Host: 'rebound.evil.test:' + server.port })).toBe(403);
    expect(await upgradeStatus(server.port, { Origin: ORIGIN, Host: '127.0.0.1:1' })).toBe(403);
  });

  it('refuses a route off the allowlist, and an oversized message, without calling the model', async () => {
    const fake = await fakeLlm([say('never')]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Wire B1.', route: 'gpt-9-ultra' });
    expect(await page.waitFor('done')).toStrictEqual({
      type: 'done', stop: 'refused', text: 'route "gpt-9-ultra" is not allowed; use one of ' + ROUTES.join(', '),
    });
    page.send({ type: 'user', text: 'x'.repeat(8001), route: 'model-a' });
    expect((await page.waitFor('done', (frame) => frame.text.includes('characters'))).text)
      .toBe('the message is over 8000 characters');
    page.send({ type: 'user', text: ' \n ', route: 'model-a' });
    expect((await page.waitFor('done', (frame) => frame.text.includes('empty'))).text).toBe('the message is empty');
    expect(fake.seen).toEqual([]);
    expect(existsSync(runs)).toBe(false);
  });
});

describe('pane server: the page going away and failing', () => {
  it('settles the executor when the page disconnects mid-call, and marks the run invalid', async () => {
    const fake = await fakeLlm([control('new pane.json'), say('never reached')]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server, { onRequest: (_frame, self) => { self.close(); return true; } });
    page.send({ type: 'user', text: 'Wire B1.', route: 'model-a' });
    const run = (await page.waitFor('started')).run;
    await page.closed;
    const record = await eventually(() => {
      const json = readJson(join(runs, run, 'run.json'));
      return json?.stop === undefined || json.stop === 'running' ? undefined : json;
    }, 'run.json');
    expect(record).toMatchObject({ stop: 'aborted', toolCalls: 1, turns: 1 });
    expect(String(record.invalid)).toMatch(/^the page disconnected mid-session/);
    expect(fake.seen).toHaveLength(1);
    expect(existsSync(join(runs, run, 'session.json'))).toBe(false);
  });

  it('marks the run invalid when the page reloads between turns', async () => {
    const fake = await fakeLlm([control('new pane.json'), say('Made it.')]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    await page.waitFor('done');
    const run = (await page.waitFor('started')).run;
    expect(readJson(join(runs, run, 'run.json'))).not.toHaveProperty('invalid');
    page.close();
    await page.closed;
    const record = await eventually(() => {
      const json = readJson(join(runs, run, 'run.json'));
      return json?.invalid === undefined ? undefined : json;
    }, 'invalid run.json');
    expect(record).toMatchObject({ stop: 'done', finalText: 'Made it.' });
    expect(existsSync(join(runs, run, 'session.json'))).toBe(true);
  });

  it('ends the session when the page cannot start it (a stale page build)', async () => {
    const netlistText = readFileSync(new URL('../../data/netlist.json', import.meta.url), 'utf8');
    const stale = loadNetlist(new TextEncoder().encode(netlistText.replace('{', '{ ')));
    const fake = await fakeLlm([control('new pane.json'), say('never reached')]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server, { engine: () => createPaneEngine(stale, PROFILES) });
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    const ended = await page.waitFor('ended');
    expect(ended.error).toMatch(/^the page could not start the session \(a stale page build\? reload it\): the page cannot start this session: session was recorded against a different netlist/);
    const turn = await page.waitFor('turn');
    expect(turn.calls[0]?.output).toMatch(/^minivac-control: the page cannot start this session: .*\n\n\[exit 1\]$/s);
    expect(await page.waitFor('done')).toMatchObject({ stop: 'aborted' });
    expect(fake.seen).toHaveLength(1);
    const record = readJson(join(runs, ended.run as string, 'run.json'));
    expect(String(record?.invalid)).toBe(ended.error);
  });
});

describe('pane server: served by', () => {
  it('flags a reply the route\'s primary did not serve, with the fallbacks and cost', async () => {
    const cloud = served('https://cloud.test/v1', { 'x-litellm-attempted-fallbacks': '1', 'x-litellm-response-cost': '0.25' });
    const fake = await fakeLlm([control('new pane.json'), say('Done.', cloud)]);
    const { server } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    await page.waitFor('done');
    const turns = page.frames.filter((frame): frame is TurnEvent => frame.type === 'turn');
    expect(turns.map(({ servedBy, offPrimary, fallbacks, costUsd }) => ({ servedBy, offPrimary, fallbacks, costUsd }))).toEqual([
      { servedBy: PRIMARY, offPrimary: false, fallbacks: 0, costUsd: 0 },
      { servedBy: 'https://cloud.test/v1', offPrimary: true, fallbacks: 1, costUsd: 0.25 },
    ]);
  });

  it('flags nothing on a route with no expected primary', async () => {
    const fake = await fakeLlm([say('Hi.', served('https://cloud.test/v1'))]);
    const { server } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Hello.', route: 'model-b' });
    expect(await page.waitFor('turn')).toMatchObject({ servedBy: 'https://cloud.test/v1', offPrimary: false });
  });

  it('says a request is out, then who served it, before the page runs its calls', async () => {
    const cloud = served('https://cloud.test/v1', { 'x-litellm-attempted-fallbacks': '1' });
    const fake = await fakeLlm([control('new pane.json', cloud), say('Done.')]);
    const { server } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    await page.waitFor('done');
    const order = page.frames.map((frame) => frame.type + (frame.type === 'request' ? ':' + frame.op : ''));
    expect(order.slice(order.indexOf('started'))).toEqual([
      'started', 'requesting', 'served', 'request:create', 'request:session', 'turn', 'requesting', 'served', 'turn', 'done',
    ]);
    expect(page.frames.filter((frame) => frame.type === 'requesting')).toStrictEqual([
      { type: 'requesting', turn: 1, route: 'model-a' }, { type: 'requesting', turn: 2, route: 'model-a' },
    ]);
    expect(page.frames.find((frame) => frame.type === 'served')).toStrictEqual({
      type: 'served', turn: 1, status: 200, servedBy: 'https://cloud.test/v1', fallbacks: 1, costUsd: 0, offPrimary: true,
    });
  });

  it('with requirePrimary, stops at a reply another server served, before any of its calls', async () => {
    const fake = await fakeLlm([control('new pane.json', served('https://cloud.test/v1')), say('never')]);
    const { server, runs } = await startServer(fake, { requirePrimary: true });
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    expect(await page.waitFor('done')).toMatchObject({ stop: 'wrong_api_base' });
    expect(page.frames.filter((frame) => frame.type === 'request')).toEqual([]);
    expect(await page.waitFor('turn')).toMatchObject({ stop: 'wrong_api_base', offPrimary: true, calls: [] });
    expect(fake.seen).toHaveLength(1);
    const run = (await page.waitFor('started')).run;
    expect(readJson(join(runs, run, 'run.json'))).toMatchObject({ stop: 'wrong_api_base', toolCalls: 0, served: ['https://cloud.test/v1'] });
  });
});

describe('pane server: the pinned session file', () => {
  it('gives read_file pane.json the run\'s current session.json', async () => {
    const fake = await fakeLlm([
      tool('read_file', { path: 'pane.json' }), control('new pane.json'), tool('read_file', { path: 'pane.json' }), say('Read it.'),
    ]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    await page.waitFor('done');
    const run = (await page.waitFor('started')).run;
    const turns = page.frames.filter((frame): frame is TurnEvent => frame.type === 'turn');
    expect(turns[0]?.calls[0]?.output).toBe('error: ENOENT: no such file or directory, open \'pane.json\'');
    const lines = readFileSync(join(runs, run, 'session.json'), 'utf8').split('\n');
    expect(turns[2]?.calls[0]?.output).toBe(lines.map((line, i) => (i + 1) + '\t' + line).join('\n'));
    for (const text of page.raw) expect(text).not.toContain(runs);
  });
});

describe('pane server: run.json while a turn runs', () => {
  it('writes run.json as running when a turn starts', async () => {
    const fake = await fakeLlm([{ ...say('too late'), delayMs: 10_000 }]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    const run = (await page.waitFor('started')).run;
    await eventually(() => (fake.seen.length === 1 ? true : undefined), 'the request');
    expect(readJson(join(runs, run, 'run.json'))).toMatchObject({
      model: 'model-a', stop: 'running', prompts: [{ route: 'model-a', text: 'Start.' }],
    });
    page.send({ type: 'stop' });
    await page.waitFor('done');
    expect(readJson(join(runs, run, 'run.json'))).toMatchObject({ stop: 'aborted' });
  });

  it('marks a running turn interrupted and the run invalid when the server is killed', async () => {
    const fake = await fakeLlm([{ ...say('too late'), delayMs: 10_000 }]);
    const dir = tempDir();
    const runs = join(dir, 'runs');
    const script = join(dir, 'serve.ts');
    writeFileSync(script, [
      'import { exitOnSignals, startPaneServer } from ' + JSON.stringify(join(home, 'tools/hands-pane/server.ts')) + ';',
      'const server = await startPaneServer({ base: ' + JSON.stringify(fake.base) + ', key: "k", port: 0, origins: [' +
        JSON.stringify(ORIGIN) + '], routes: ["model-a"], runsRoot: ' + JSON.stringify(runs) + ' });',
      'exitOnSignals();',
      'process.stdout.write(JSON.stringify({ port: server.port, token: server.token }) + "\\n");',
    ].join('\n'));
    const child = spawn('node', [script], { stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = new Promise<number | null>((done) => child.on('close', done));
    cleanups.push(() => { child.kill('SIGKILL'); });
    const started = await new Promise<{ port: number; token: string }>((done, fail) => {
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
        if (out.includes('\n')) done(JSON.parse(out.split('\n')[0] as string) as { port: number; token: string });
      });
      child.on('close', (code) => fail(new Error('the server exited with ' + String(code))));
    });
    const page = await connected({ ...started, url: '', close: async () => {} });
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    const run = (await page.waitFor('started')).run;
    await eventually(() => (fake.seen.length === 1 ? true : undefined), 'the request');
    expect(readJson(join(runs, run, 'run.json'))).toMatchObject({ stop: 'running' });
    child.kill('SIGTERM');
    expect(await exited).toBe(143);
    const record = readJson(join(runs, run, 'run.json'));
    expect(record).toMatchObject({ stop: 'interrupted' });
    expect(String(record?.invalid)).toMatch(/^interrupted: the pane server got SIGTERM/);
  }, 20_000);
});

describe('pane server: errors', () => {
  it('lists each turn\'s error with its prompt, so a later good turn does not inherit it', async () => {
    const fake = await fakeLlm([{ raw: 'not json', body: null }, say('Fine now.')]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    expect(await page.waitFor('done')).toStrictEqual({ type: 'done', stop: 'error', text: 'Unexpected token \'o\', "not json" is not valid JSON' });
    const run = (await page.waitFor('started')).run;
    page.send({ type: 'user', text: 'Again.', route: 'model-a' });
    await page.waitFor('done', (frame) => frame.text === 'Fine now.');
    const record = readJson(join(runs, run, 'run.json'));
    expect(record).toMatchObject({ stop: 'done', finalText: 'Fine now.', errors: [{ prompt: 1, error: 'Unexpected token \'o\', "not json" is not valid JSON' }] });
    expect(record).not.toHaveProperty('error');
  });

  it('gives the page an HTTP error\'s status and a fixed reason, never its body', async () => {
    const replies: Reply[] = [];
    const fake = await fakeLlm(replies);
    const body = { error: 'budget exceeded for key sk-live-0123456789 at ' + fake.base };
    replies.push({ status: 429, body });
    const { server, runs } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    expect(await page.waitFor('done')).toMatchObject({ stop: 'http_429' });
    expect(await page.waitFor('turn')).toStrictEqual({
      type: 'turn', turn: 1, status: 429, servedBy: '?', fallbacks: 0, costUsd: 0, offPrimary: true, stop: 'http_429',
      reason: 'Too Many Requests; the gateway\'s reply is in the run\'s transcript.jsonl', content: null, calls: [],
    });
    for (const text of page.raw) {
      expect(text).not.toContain('sk-live');
      expect(text).not.toContain('budget');
    }
    const run = (await page.waitFor('started')).run;
    const line = JSON.parse(readFileSync(join(runs, run, 'transcript.jsonl'), 'utf8').trim()) as { body: string };
    expect(line.body).toBe(JSON.stringify(body));
  });

  it('takes the key, the gateway\'s address and anything key-like out of error text for the page', () => {
    const base = 'http://gateway.test:4000/v1';
    expect(redact('connect ECONNREFUSED gateway.test:4000 for ' + base + '/chat/completions with KEY-123', base, 'KEY-123'))
      .toBe('connect ECONNREFUSED [redacted] for [redacted]/chat/completions with [redacted]');
    expect(redact('Unexpected token \'s\', "sk-live-01"... is not valid JSON', base, 'k3y'))
      .toBe('Unexpected token \'s\', "[redacted]"... is not valid JSON');
    expect(redact('Authorization: Bearer abc.def and api_key=hunter2', base, 'k3y'))
      .toBe('Authorization: Bearer [redacted] and api_key=[redacted]');
    expect(redact('token Q2xhdWRlU2hhbm5vbjE5NjFNaW5pdmFjNjAx here', base, 'k3y')).toBe('token [redacted] here');
    expect(redact('the page engine failed: relay 3 is stuck', base, 'k3y')).toBe('the page engine failed: relay 3 is stuck');
  });

  it('redacts error text before it reaches the page', async () => {
    const fake = await fakeLlm([{ raw: 'sk-live-0123456789abcdef is not JSON', body: null }]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    expect(await page.waitFor('done')).toStrictEqual({
      type: 'done', stop: 'error', text: 'Unexpected token \'s\', "[redacted]"... is not valid JSON',
    });
    const run = (await page.waitFor('started')).run;
    expect(readJson(join(runs, run, 'run.json'))).toMatchObject({
      errors: [{ prompt: 1, error: 'Unexpected token \'s\', "sk-live-01"... is not valid JSON' }],
    });
  });

  it('keeps the key and the gateway\'s address out of every frame, though the model reads them', async () => {
    // Any file the model can read may hold the key (a gateway's raw reply), in a git-ignored corner of its scope.
    const pages = join(home, 'docs/research/raw/pdf/pages');
    mkdirSync(pages, { recursive: true });
    const scratch = mkdtempSync(join(pages, 'mv601-gateway-'));
    cleanups.push(() => rmSync(scratch, { recursive: true, force: true }));
    writeFileSync(join(scratch, 'reply.txt'), '{"error":"budget exceeded for key ' + KEY + '"}\n');
    const replies: Reply[] = [];
    const fake = await fakeLlm(replies);
    replies.push(
      tool('read_file', { path: relative(home, join(scratch, 'reply.txt')) }),
      control('pane.json ' + KEY),
      say('The gateway at ' + fake.base + ' refused key ' + KEY + '.'),
    );
    const { server } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    expect(await page.waitFor('done')).toStrictEqual({ type: 'done', stop: 'done', text: 'The gateway at [redacted] refused key [redacted].' });
    // The model's view is the CLI's: only the page's copy is redacted.
    expect(fake.seen[2]?.messages.find((m) => m.role === 'tool')?.content).toContain('budget exceeded for key ' + KEY);
    const outputs = page.frames.filter((frame): frame is TurnEvent => frame.type === 'turn').flatMap((frame) => frame.calls.map((call) => call.output));
    expect(outputs[0]).toContain('budget exceeded for key [redacted]');
    for (const text of page.raw) {
      expect(text).not.toContain(KEY);
      expect(text).not.toContain(new URL(fake.base).host);
    }
  });

  it('keeps a turn\'s totals up to a failure later in it', async () => {
    const cost = { 'x-litellm-response-cost': '0.25' };
    const fake = await fakeLlm([
      control('new pane.json', served(PRIMARY, cost)), { raw: 'not json', body: null, headers: served(PRIMARY, cost) },
    ]);
    const { server, runs } = await startServer(fake);
    const page = await connected(server);
    page.send({ type: 'user', text: 'Start.', route: 'model-a' });
    expect(await page.waitFor('done')).toMatchObject({ stop: 'error' });
    const run = (await page.waitFor('started')).run;
    expect(readJson(join(runs, run, 'run.json'))).toMatchObject({
      stop: 'error', turns: 2, toolCalls: 1, promptTokens: 10, completionTokens: 2, served: [PRIMARY], costUsd: 0.5,
      errors: [{ prompt: 1, error: 'Unexpected token \'o\', "not json" is not valid JSON' }],
    });
    expect(existsSync(join(runs, run, 'session.json'))).toBe(true);
  });
});

describe('pane server: configuration', () => {
  const env = { MINIVAC_LLM_BASE_URL: 'http://gateway.test/v1', MINIVAC_LLM_API_KEY: KEY, MINIVAC_PANE_ROUTES: 'model-a, model-b' };

  it('refuses a base URL that is not plain http(s), without echoing it', () => {
    for (const bad of ['gateway.test/v1', 'ftp://gateway.test/v1', 'http://user:s3cret@gateway.test/v1', 'http://:s3cret@gateway.test/v1']) {
      let thrown = '';
      try {
        optionsFromEnv({ ...env, MINIVAC_LLM_BASE_URL: bad });
      } catch (problem: unknown) {
        thrown = (problem as Error).message;
      }
      expect(thrown).toMatch(/^MINIVAC_LLM_BASE_URL must be/);
      expect(thrown).not.toContain('s3cret');
      expect(thrown).not.toContain('gateway.test');
    }
    expect(optionsFromEnv({ ...env, MINIVAC_LLM_BASE_URL: 'https://gateway.test/v1' }).base).toBe('https://gateway.test/v1');
  });

  it('prints the URL for the strict dev:pane origin, and `npm run dev` is as it was', async () => {
    const pkg = JSON.parse(readFileSync(join(home, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(pkg.scripts.dev).toBe('vite');
    expect(pkg.scripts['dev:pane']).toBe('vite --host 127.0.0.1 --port 5173 --strictPort');
    expect(DEV_ORIGINS[0]).toBe('http://127.0.0.1:5173');

    const port = await new Promise<number>((done) => {
      const probe = createNetServer().listen(0, '127.0.0.1', () => {
        const { port: free } = probe.address() as AddressInfo;
        probe.close(() => done(free));
      });
    });
    const env2: NodeJS.ProcessEnv = { ...process.env, ...env, MINIVAC_PANE_PORT: String(port) };
    for (const name of ['MINIVAC_PANE_ORIGINS', 'MINIVAC_PANE_PRIMARY', 'MINIVAC_PANE_MAX_TURNS', 'MINIVAC_PANE_RUNS']) delete env2[name];
    const child = spawn('node', ['tools/hands-pane/server.ts'], { cwd: home, env: env2, stdio: ['ignore', 'pipe', 'inherit'] });
    const exited = new Promise<number | null>((done) => child.on('close', done));
    cleanups.push(() => { child.kill('SIGKILL'); });
    const printed = await new Promise<string>((done) => {
      let out = '';
      child.stdout.on('data', (chunk: Buffer) => {
        out += chunk.toString('utf8');
        if (/#t=[A-Za-z0-9_-]+&port=[0-9]+\n/.test(out)) done(out);
      });
    });
    expect(printed).toMatch(new RegExp('^minivac pane server on 127\\.0\\.0\\.1:' + port + ', runs in pane-runs/\n' +
      'start the dev page with `npm run dev:pane` \\(Vite on 127\\.0\\.0\\.1:5173, which fails rather than move to another port\\), then open\n' +
      'http://127\\.0\\.0\\.1:5173/dev\\.html#t=[A-Za-z0-9_-]{43}&port=' + port + '\n$'));
    child.kill('SIGTERM');
    expect(await exited).toBe(143);
  }, 20_000);

  it('takes the base URL and key from the environment only, with the dev defaults', () => {
    expect(() => optionsFromEnv({ MINIVAC_LLM_BASE_URL: 'http://gateway.test/v1' })).toThrow('set MINIVAC_LLM_BASE_URL and MINIVAC_LLM_API_KEY');
    expect(optionsFromEnv(env)).toMatchObject({
      base: 'http://gateway.test/v1', key: KEY, port: 8601, origins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
      maxTurns: 40, primary: undefined, routes: ['model-a', 'model-b'], runsRoot: join(home, 'pane-runs'),
    });
  });

  it('needs the routes: the model names the endpoint serves, the default first', () => {
    const { MINIVAC_PANE_ROUTES: _routes, ...unset } = env;
    const needed = 'set MINIVAC_PANE_ROUTES to the model names your endpoint serves (comma-separated, default first)';
    expect(() => optionsFromEnv(unset)).toThrow(needed);
    expect(() => optionsFromEnv({ ...env, MINIVAC_PANE_ROUTES: ' , ' })).toThrow(needed);
    expect(() => optionsFromEnv({ ...env, MINIVAC_PANE_ROUTES: 'model-a,model-b,model-a' }))
      .toThrow('MINIVAC_PANE_ROUTES names "model-a" twice');
    expect(optionsFromEnv({ ...env, MINIVAC_PANE_ROUTES: ' gpt-x ,, local/q:8b ' }).routes).toEqual(['gpt-x', 'local/q:8b']);
  });

  it('writes the runs where MINIVAC_PANE_RUNS says, relative to the repo or absolute', () => {
    expect(optionsFromEnv({ ...env, MINIVAC_PANE_RUNS: 'records/runs' }).runsRoot).toBe(join(home, 'records/runs'));
    expect(optionsFromEnv({ ...env, MINIVAC_PANE_RUNS: '/tmp/pane' }).runsRoot).toBe('/tmp/pane');
  });

  it('reads the origin allowlist, the primaries and the caps', () => {
    expect(optionsFromEnv({
      ...env, MINIVAC_PANE_ORIGINS: 'http://127.0.0.1:4174, http://localhost:4174', MINIVAC_PANE_PORT: '9000',
      MINIVAC_PANE_PRIMARY: JSON.stringify({ 'model-a': PRIMARY }), MINIVAC_PANE_MAX_TURNS: '12',
    })).toMatchObject({
      origins: ['http://127.0.0.1:4174', 'http://localhost:4174'], port: 9000, primary: { 'model-a': PRIMARY }, maxTurns: 12,
    });
    expect(() => optionsFromEnv({ ...env, MINIVAC_PANE_ORIGINS: 'http://localhost:5173/' })).toThrow('is not an exact origin');
    expect(() => optionsFromEnv({ ...env, MINIVAC_PANE_PRIMARY: '{"model-c":"x"}' })).toThrow('MINIVAC_PANE_PRIMARY must be');
    let thrown = '';
    try {
      optionsFromEnv({ ...env, MINIVAC_PANE_PRIMARY: '{model-a: http://secret-host.test/v1}' });
    } catch (problem: unknown) {
      thrown = (problem as Error).message;
    }
    expect(thrown).toMatch(/^MINIVAC_PANE_PRIMARY must be a JSON object/);
    expect(thrown).not.toContain('secret-host');
    expect(() => optionsFromEnv({ ...env, MINIVAC_PANE_PORT: '0x10' })).toThrow('MINIVAC_PANE_PORT must be');
  });

  it('prints the page URL with the token and the port', async () => {
    const fake = await fakeLlm([]);
    const { server } = await startServer(fake);
    expect(server.url).toBe(ORIGIN + '/dev.html#t=' + server.token + '&port=' + server.port);
    expect(server.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('keeps the checklist runs\' first-turn prefix, naming pane.json', () => {
    expect(FIRST_TURN_PREFIX).toBe('You are operating the Minivac 601 simulator in this repository. Use the session file pane.json (create it).\n\n');
  });
});
