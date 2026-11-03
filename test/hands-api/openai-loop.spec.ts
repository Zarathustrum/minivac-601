// tools/hands-api/openai-loop.ts against a fake OpenAI-compatible server on node:http, scripted one
// reply per request. No real model server is reached.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runLoop, SYSTEM_PREAMBLE, type Execute, type LoopOptions, type Message, type TurnInfo,
} from '../../tools/hands-api/openai-loop.ts';

const REPO = fileURLToPath(new URL('../..', import.meta.url));

interface Reply { status?: number; headers?: Record<string, string>; body: unknown; delayMs?: number }
interface Seen { body: { model: string; messages: Message[]; tools: unknown[]; tool_choice: string }; headers: IncomingHttpHeaders }
interface Fake { base: string; seen: Seen[]; close: () => Promise<void> }

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

/** A server on 127.0.0.1 that answers the nth request with replies[n] (500 once they run out). */
async function fakeServer(replies: Reply[]): Promise<Fake> {
  const seen: Seen[] = [];
  const timers = new Set<NodeJS.Timeout>();
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Seen['body'], headers: req.headers });
      const reply = replies[seen.length - 1] ?? { status: 500, body: { error: 'script exhausted' } };
      const send = (): void => {
        res.writeHead(reply.status ?? 200, { 'Content-Type': 'application/json', ...reply.headers });
        res.end(JSON.stringify(reply.body));
      };
      if (reply.delayMs === undefined) send();
      else timers.add(setTimeout(send, reply.delayMs));
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;
  const fake: Fake = {
    base: 'http://127.0.0.1:' + port + '/v1',
    seen,
    close: () => new Promise<void>((done) => {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      server.close(() => done());
    }),
  };
  cleanups.push(fake.close);
  return fake;
}

let nextId = 0;
const usage = { prompt_tokens: 10, completion_tokens: 2 };

function toolReply(calls: [string, object][], headers?: Record<string, string>): Reply {
  const toolCalls = calls.map(([name, args]) => ({
    id: 'call_' + nextId++, type: 'function', function: { name, arguments: JSON.stringify(args) },
  }));
  return {
    body: { choices: [{ message: { role: 'assistant', content: null, tool_calls: toolCalls }, finish_reason: 'tool_calls' }], usage },
    ...(headers ? { headers } : {}),
  };
}

function textReply(text: string, headers?: Record<string, string>): Reply {
  return {
    body: { choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage },
    ...(headers ? { headers } : {}),
  };
}

/** An executor that records the words of each call and echoes them back. */
function recorder(): { execute: Execute; ran: string[][] } {
  const ran: string[][] = [];
  return { ran, execute: (words) => { ran.push(words); return Promise.resolve({ text: 'ran ' + words.join(' ') + '\n', exit: 0 }); } };
}

/**
 * A fresh directory the file tools may read, removed after the test: under docs/research/'s
 * git-ignored page images, so nothing is left in the tracked tree.
 */
function scratchInScope(prefix: string): string {
  const pages = join(REPO, 'docs/research/raw/pdf/pages');
  mkdirSync(pages, { recursive: true });
  const dir = mkdtempSync(join(pages, prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function start(): Message[] {
  return [{ role: 'system', content: 'sys' }, { role: 'user', content: 'wire B1' }];
}

function options(fake: Fake, messages: Message[], execute: Execute, extra: Partial<LoopOptions> = {}): LoopOptions {
  return { base: fake.base, key: 'test-key', model: 'fake-model', messages, execute, ...extra };
}

/** Every assistant tool call has exactly one tool message after it, in order. */
function answered(messages: Message[]): boolean {
  return messages.every((m, i) => (m.tool_calls ?? []).every((call, k) => messages[i + 1 + k]?.tool_call_id === call.id));
}

describe('runLoop', () => {
  it('runs a tool call, then ends on the reply with no tool call', async () => {
    const fake = await fakeServer([
      toolReply([['minivac_control', { args: 'bin/minivac-control s.json connect 1+/1Y + power on' }]]),
      textReply('Lamp 1 is lit.'),
    ]);
    const messages = start();
    const { execute, ran } = recorder();
    const result = await runLoop(options(fake, messages, execute));

    expect(result).toMatchObject({ stop: 'done', finalText: 'Lamp 1 is lit.', turns: 2, toolCalls: 1, promptTokens: 20,
      completionTokens: 4, served: ['?'], fallbacks: 0, nudges: 0, networkRetries: 0, costUsd: 0 });
    expect(ran).toEqual([['s.json', 'connect', '1+/1Y', '+', 'power', 'on']]);
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant']);
    expect(messages[3]?.content).toBe('ran s.json connect 1+/1Y + power on\n\n[exit 0]');
    expect(messages[4]).toEqual({ role: 'assistant', content: 'Lamp 1 is lit.' });

    const [first, second] = fake.seen;
    expect(first?.headers.authorization).toBe('Bearer test-key');
    expect(first?.body.model).toBe('fake-model');
    expect(first?.body.tool_choice).toBe('auto');
    expect(first?.body.tools).toHaveLength(4);
    expect(second?.body.messages).toEqual(messages.slice(0, 4));
  });

  it('runs the calls of one reply one at a time, in order', async () => {
    const fake = await fakeServer([
      toolReply([
        ['minivac_control', { args: 's.json power on' }],
        ['read_file', { path: 'docs/research/programs.md', limit: 1 }],
        ['minivac_control', { args: 's.json state' }],
      ]),
      textReply('done'),
    ]);
    const events: string[] = [];
    const execute: Execute = async (words) => {
      events.push('start ' + words.join(' '));
      await new Promise((done) => setTimeout(done, words.includes('power') ? 30 : 0));
      events.push('end ' + words.join(' '));
      return { text: words.join(' '), exit: words.includes('state') ? 1 : 0 };
    };
    const messages = start();
    await runLoop(options(fake, messages, execute));

    expect(events).toEqual(['start s.json power on', 'end s.json power on', 'start s.json state', 'end s.json state']);
    const ids = messages[2]?.tool_calls?.map((call) => call.id);
    const tools = messages.slice(3, 6);
    expect(tools.map((m) => m.tool_call_id)).toEqual(ids);
    expect(tools[0]?.content).toBe('s.json power on\n[exit 0]');
    expect(tools[1]?.content).toMatch(/^1\t/);
    expect(tools[2]?.content).toBe('s.json state\n[exit 1]');
  });

  it('continues the same conversation on a second call with the caller-owned messages', async () => {
    const fake = await fakeServer([
      textReply('Which lamp?'),
      toolReply([['minivac_control', { args: 's.json button 1 press' }]]),
      textReply('Pressed.'),
    ]);
    const messages = start();
    const { execute } = recorder();
    const one = await runLoop(options(fake, messages, execute));
    expect(one).toMatchObject({ stop: 'done', finalText: 'Which lamp?', turns: 1 });

    messages.push({ role: 'user', content: 'Lamp 1, then press button 1.' });
    const two = await runLoop(options(fake, messages, execute));
    expect(two).toMatchObject({ stop: 'done', finalText: 'Pressed.', turns: 2, toolCalls: 1 });
    expect(fake.seen[1]?.body.messages).toEqual([
      ...start(), { role: 'assistant', content: 'Which lamp?' }, { role: 'user', content: 'Lamp 1, then press button 1.' },
    ]);
    expect(messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user', 'assistant', 'tool', 'assistant']);
  });

  it('reports the served base, fallbacks, cost, finish and calls to onTurn', async () => {
    const cloud = { 'x-litellm-model-api-base': 'https://cloud.test/v1', 'x-litellm-attempted-fallbacks': '1',
      'x-litellm-response-cost': '0.0025' };
    const fake = await fakeServer([
      toolReply([['minivac_control', { args: 's.json state' }]], { 'x-litellm-model-api-base': 'http://primary/v1' }),
      textReply('ok', cloud),
    ]);
    const turns: TurnInfo[] = [];
    const { execute } = recorder();
    const result = await runLoop(options(fake, start(), execute, { onTurn: (turn) => turns.push(turn) }));

    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ turn: 1, status: 200, servedBy: 'http://primary/v1', fallbacks: 0, costUsd: 0,
      finish: 'tool_calls', content: null, usage });
    expect(turns[0]?.calls).toEqual([{ id: expect.any(String), name: 'minivac_control', args: '{"args":"s.json state"}',
      output: 'ran s.json state\n\n[exit 0]' }]);
    expect(turns[1]).toMatchObject({ turn: 2, servedBy: 'https://cloud.test/v1', fallbacks: 1, costUsd: 0.0025, finish: 'stop',
      content: 'ok', calls: [] });
    expect(turns[1]?.stop).toBeUndefined();
    expect(result).toMatchObject({ served: ['http://primary/v1', 'https://cloud.test/v1'], fallbacks: 1, costUsd: 0.0025 });
  });

  it('stops with wrong_api_base when another server answered, before running its calls', async () => {
    const fake = await fakeServer([
      toolReply([['minivac_control', { args: 's.json power on' }]],
        { 'x-litellm-model-api-base': 'https://cloud.test/v1', 'x-litellm-attempted-fallbacks': '1' }),
    ]);
    const messages = start();
    const turns: TurnInfo[] = [];
    const { execute, ran } = recorder();
    const result = await runLoop(options(fake, messages, execute,
      { requireApiBase: 'http://primary/v1', onTurn: (turn) => turns.push(turn) }));

    expect(result).toMatchObject({ stop: 'wrong_api_base', turns: 1, toolCalls: 0, served: ['https://cloud.test/v1'], fallbacks: 1 });
    expect(ran).toEqual([]);
    expect(messages).toEqual(start());
    expect(turns).toEqual([expect.objectContaining({ stop: 'wrong_api_base', servedBy: 'https://cloud.test/v1', calls: [] })]);
  });

  it('answers every tool call of the reply when aborted while a call runs', async () => {
    const fake = await fakeServer([
      toolReply([
        ['minivac_control', { args: 's.json power on' }],
        ['minivac_control', { args: 's.json button 1 press' }],
        ['read_file', { path: 'README.md' }],
      ]),
      textReply('never asked for'),
    ]);
    const controller = new AbortController();
    const ran: string[][] = [];
    const execute: Execute = (words) => {
      ran.push(words);
      controller.abort();
      return Promise.resolve({ text: 'powered', exit: 0 });
    };
    const messages = start();
    const turns: TurnInfo[] = [];
    const result = await runLoop(options(fake, messages, execute, { signal: controller.signal, onTurn: (t) => turns.push(t) }));

    expect(result.stop).toBe('aborted');
    expect(fake.seen).toHaveLength(1);
    expect(ran).toEqual([['s.json', 'power', 'on']]);
    expect(answered(messages)).toBe(true);
    expect(messages.slice(3).map((m) => m.content)).toEqual([
      'powered\n[exit 0]',
      'error: not run: the run was stopped before this call',
      'error: not run: the run was stopped before this call',
    ]);
    expect(turns[0]?.calls.map((call) => call.output)).toEqual(messages.slice(3).map((m) => m.content));
  });

  it('stops while waiting for the model, with no retry and nothing appended', async () => {
    const fake = await fakeServer([{ ...textReply('too late'), delayMs: 10_000 }]);
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    const messages = start();
    const { execute } = recorder();
    const result = await runLoop(options(fake, messages, execute, { signal: controller.signal }));

    expect(result).toMatchObject({ stop: 'aborted', networkRetries: 0 });
    expect(fake.seen).toHaveLength(1);
    expect(messages).toEqual(start());
  });

  it('refuses hidden paths in read_file, list_files and grep', async () => {
    const fake = await fakeServer([
      toolReply([
        ['read_file', { path: '.claude/skills/minivac/SKILL.md' }],
        ['read_file', { path: 'docs/../.gitignore' }],
        ['list_files', { path: '.claude' }],
        ['grep', { pattern: 'minivac', path: '.claude' }],
        ['read_file', { path: 'docs/research/programs.md', limit: 1 }],
        ['list_files', { path: '.' }],
      ]),
      textReply('done'),
    ]);
    const messages = start();
    const { execute } = recorder();
    await runLoop(options(fake, messages, execute));

    const outputs = messages.slice(3, 9).map((m) => m.content ?? '');
    expect(outputs.slice(0, 4)).toEqual([
      'error: path is hidden: .claude/skills/minivac/SKILL.md',
      'error: path is hidden: docs/../.gitignore',
      'error: path is hidden: .claude',
      'error: path is hidden: .claude',
    ]);
    expect(outputs[4]).toMatch(/^1\t/);
    expect(outputs[5]).toBe('docs\ntest');
  });

  it('reads only the manuals\' research and the conformance fixtures', async () => {
    const fake = await fakeServer([
      toolReply([
        ['read_file', { path: 'src/app.ts', limit: 1 }],
        ['read_file', { path: 'checklist/items/B1.json' }],
        ['read_file', { path: 'notebook/runs' }],
        ['list_files', { path: 'tools' }],
        ['grep', { pattern: 'x', path: 'src' }],
        ['list_files', { path: 'test' }],
        ['list_files', { path: 'docs' }],
        ['grep', { pattern: 'createPaneEngine|Minivac 601 — the program corpus', path: '.' }],
        ['read_file', { path: 'test/conformance/fixtures/manifest.json', limit: 1 }],
      ]),
      textReply('done'),
    ]);
    const messages = start();
    const { execute } = recorder();
    await runLoop(options(fake, messages, execute));

    const scope = ' (the file tools read docs/research/ and test/conformance/fixtures/)';
    const outputs = messages.slice(3, 12).map((m) => m.content ?? '');
    expect(outputs.slice(0, 5)).toEqual([
      'error: path is not one the file tools read: src/app.ts' + scope,
      'error: path is not one the file tools read: checklist/items/B1.json' + scope,
      'error: path is not one the file tools read: notebook/runs' + scope,
      'error: path is not one the file tools read: tools' + scope,
      'error: path is not one the file tools read: src' + scope,
    ]);
    // Above the readable trees, only the way to them shows, and a grep walks only into them.
    expect(outputs[5]).toBe('conformance');
    expect(outputs[6]).toBe('research');
    expect(outputs[7]).toMatch(/^docs\/research\/programs\.md:1: # Minivac 601/);
    expect(outputs[7]).not.toContain('src/');
    expect(outputs[8]).toMatch(/^1\t/);
  });

  it('refuses node_modules and .git in any case, and lists no hidden entry', async () => {
    const fake = await fakeServer([
      toolReply([
        ['read_file', { path: 'NODE_MODULES/ws/package.json', limit: 3 }],
        ['list_files', { path: 'Node_Modules' }],
        ['grep', { pattern: 'version', path: 'Node_Modules/ws' }],
        ['read_file', { path: '.GIT/config' }],
        ['list_files', { path: '.' }],
      ]),
      textReply('done'),
    ]);
    const messages = start();
    const { execute } = recorder();
    await runLoop(options(fake, messages, execute));

    const outputs = messages.slice(3, 8).map((m) => m.content ?? '');
    expect(outputs.slice(0, 4)).toEqual([
      'error: path is outside the repository: NODE_MODULES/ws/package.json',
      'error: path is outside the repository: Node_Modules',
      'error: path is outside the repository: Node_Modules/ws',
      'error: path is outside the repository: .GIT/config',
    ]);
    expect(outputs[4]?.split('\n')).toEqual(['docs', 'test']);
  });

  it('follows a link only to a readable place inside the repository', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'mv601-outside-'));
    cleanups.push(() => rmSync(outside, { recursive: true, force: true }));
    writeFileSync(join(outside, 'secret.txt'), 'outside the repo\n');
    const links = scratchInScope('mv601-links-');
    symlinkSync(outside, join(links, 'out'));
    symlinkSync(join(REPO, '.claude'), join(links, 'hidden'));
    symlinkSync(join(REPO, 'README.md'), join(links, 'readme.md'));
    symlinkSync(join(REPO, 'docs/research/programs.md'), join(links, 'programs.md'));
    const rel = relative(REPO, links);
    const fake = await fakeServer([
      toolReply([
        ['read_file', { path: rel + '/out/secret.txt' }],
        ['list_files', { path: rel + '/out' }],
        ['grep', { pattern: 'outside', path: rel + '/out' }],
        ['grep', { pattern: 'outside the repo|minivac|readme', path: rel }],
        ['read_file', { path: rel + '/hidden/skills/minivac/SKILL.md' }],
        ['read_file', { path: rel + '/readme.md', limit: 1 }],
        ['read_file', { path: rel + '/programs.md', limit: 1 }],
      ]),
      textReply('done'),
    ]);
    const messages = start();
    const { execute } = recorder();
    await runLoop(options(fake, messages, execute));

    const outputs = messages.slice(3, 10).map((m) => m.content ?? '');
    expect(outputs.slice(0, 3)).toEqual([
      'error: path is outside the repository: ' + rel + '/out/secret.txt',
      'error: path is outside the repository: ' + rel + '/out',
      'error: path is outside the repository: ' + rel + '/out',
    ]);
    // The walk skips the link out, the hidden one and the one to README.md, and follows the one to programs.md.
    expect(outputs[3]).not.toContain('outside the repo');
    expect(outputs[3]).not.toContain('/hidden/');
    expect(outputs[3]).not.toContain('/readme.md:');
    expect(outputs[3]?.split('\n')[0]).toMatch(new RegExp('^' + rel + '/programs\\.md:[0-9]+: '));
    expect(outputs[4]).toBe('error: path is hidden: ' + rel + '/hidden/skills/minivac/SKILL.md');
    expect(outputs[5]).toBe('error: path is not one the file tools read: ' + rel + '/readme.md' +
      ' (the file tools read docs/research/ and test/conformance/fixtures/)');
    const programs = readFileSync(join(REPO, 'docs/research/programs.md'), 'utf8').split('\n');
    expect(outputs[6]).toBe('1\t' + programs[0] + '\n[' + programs.length + ' lines in all]');
  });

  it('names paths in file-tool errors as the repo does, never absolutely', async () => {
    const fake = await fakeServer([
      toolReply([
        ['read_file', { path: 'docs/research/no/such/file.md' }],
        ['list_files', { path: 'docs/research/no/such' }],
        ['list_files', { path: 'docs/research/programs.md' }],
        ['grep', { pattern: 'x', path: 'docs/research/no/such/dir' }],
      ]),
      textReply('done'),
    ]);
    const messages = start();
    const { execute } = recorder();
    await runLoop(options(fake, messages, execute));

    expect(messages.slice(3, 7).map((m) => m.content)).toEqual([
      'error: ENOENT: no such file or directory, open \'docs/research/no/such/file.md\'',
      'error: ENOENT: no such file or directory, scandir \'docs/research/no/such\'',
      'error: ENOTDIR: not a directory, scandir \'docs/research/programs.md\'',
      'error: ENOENT: no such file or directory, stat \'docs/research/no/such/dir\'',
    ]);
  });

  it('reads the pinned session path from the file the caller names, not from the repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mv601-pinned-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, 'session.json');
    const fake = await fakeServer([
      toolReply([['read_file', { path: 'pane.json' }]]),
      toolReply([['minivac_control', { args: 'new pane.json' }]]),
      toolReply([['read_file', { path: './pane.json', limit: 2 }]]),
      textReply('done'),
    ]);
    const messages = start();
    const execute: Execute = () => {
      writeFileSync(file, '{\n  "format": "minivac.session/1"\n}\n');
      return Promise.resolve({ text: 'created', exit: 0 });
    };
    await runLoop(options(fake, messages, execute, { pinned: { name: 'pane.json', file } }));

    expect(messages[3]?.content).toBe('error: ENOENT: no such file or directory, open \'pane.json\'');
    expect(messages[7]?.content).toBe('1\t{\n2\t  "format": "minivac.session/1"\n[4 lines in all]');
  });

  it('answers a malformed tool call and gives an id to a call that has none', async () => {
    const good = { id: 'ok1', type: 'function', function: { name: 'minivac_control', arguments: '{"args":"--help"}' } };
    const noId = { type: 'function', function: { name: 'minivac_control', arguments: '{"args":"s.json state"}' } };
    const fake = await fakeServer([
      { body: { choices: [{ message: { role: 'assistant', content: null, tool_calls: [
        good, { id: 'bad1', type: 'function' }, { id: 'bad2', type: 'function', function: { arguments: '{}' } }, noId,
      ] }, finish_reason: 'tool_calls' }], usage } },
      textReply('Done.'),
      textReply('Again.'),
    ]);
    const messages = start();
    const turns: TurnInfo[] = [];
    const { execute, ran } = recorder();
    const result = await runLoop(options(fake, messages, execute, { onTurn: (turn) => turns.push(turn) }));

    expect(result).toMatchObject({ stop: 'done', finalText: 'Done.', toolCalls: 4 });
    expect(ran).toEqual([['--help'], ['s.json', 'state']]);
    expect(answered(messages)).toBe(true);
    const kept = messages[2]?.tool_calls ?? [];
    expect(kept.slice(0, 3)).toEqual([good, { id: 'bad1', type: 'function' }, { id: 'bad2', type: 'function', function: { arguments: '{}' } }]);
    expect(kept[3]).toEqual({ ...noId, id: expect.any(String) });
    expect(kept[3]?.id).not.toBe('');
    expect(messages.slice(3, 7).map((m) => [m.tool_call_id, m.content])).toEqual([
      ['ok1', 'ran --help\n\n[exit 0]'],
      ['bad1', 'error: malformed tool call'],
      ['bad2', 'error: malformed tool call'],
      [kept[3]?.id, 'ran s.json state\n\n[exit 0]'],
    ]);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.calls.map((call) => call.output)).toEqual(messages.slice(3, 7).map((m) => m.content));

    // The next user turn sends a history in which every call has its answer.
    messages.push({ role: 'user', content: 'Again.' });
    await runLoop(options(fake, messages, execute));
    expect(fake.seen[2]?.body.messages).toEqual(messages.slice(0, -1));
    expect(answered(fake.seen[2]?.body.messages ?? [])).toBe(true);
  });

  it('reports who served a reply before its calls run', async () => {
    const fake = await fakeServer([
      toolReply([['minivac_control', { args: 's.json power on' }]],
        { 'x-litellm-model-api-base': 'https://cloud.test/v1', 'x-litellm-attempted-fallbacks': '1' }),
      textReply('ok', { 'x-litellm-model-api-base': 'http://primary/v1' }),
    ]);
    const events: string[] = [];
    const execute: Execute = (words) => {
      events.push('call ' + words.join(' '));
      return Promise.resolve({ text: '', exit: 0 });
    };
    await runLoop(options(fake, start(), execute, {
      onResponse: (served) => events.push('served ' + JSON.stringify(served)),
      onTurn: (turn) => events.push('turn ' + turn.turn),
    }));
    expect(events).toEqual([
      'served ' + JSON.stringify({ turn: 1, status: 200, servedBy: 'https://cloud.test/v1', fallbacks: 1, costUsd: 0 }),
      'call s.json power on',
      'turn 1',
      'served ' + JSON.stringify({ turn: 2, status: 200, servedBy: 'http://primary/v1', fallbacks: 0, costUsd: 0 }),
      'turn 2',
    ]);
  });

  it('says each request is going out before its response is in', async () => {
    const fake = await fakeServer([toolReply([['minivac_control', { args: 's.json power on' }]]), textReply('ok')]);
    const events: string[] = [];
    await runLoop(options(fake, start(), () => Promise.resolve({ text: '', exit: 0 }), {
      onRequest: (turn) => events.push('request ' + turn),
      onResponse: (served) => events.push('served ' + served.turn),
    }));
    expect(events).toEqual(['request 1', 'served 1', 'request 2', 'served 2']);
  });
});

describe('openai-loop.ts command line', () => {
  it('writes run.json and transcript.jsonl in the shapes ralph.ts reads', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mv601-loop-'));
    cleanups.push(() => rmSync(out, { recursive: true, force: true }));
    const session = join(out, 'session.json');
    const prompt = join(out, 'prompt.txt');
    writeFileSync(prompt, 'Use the session file ' + session + ' (create it).\n');
    const served = { 'x-litellm-model-api-base': 'http://primary/v1', 'x-litellm-response-cost': '0.5' };
    const fake = await fakeServer([
      toolReply([['minivac_control', { args: 'new ' + session }]], served),
      textReply('Created.', served),
    ]);
    const env: NodeJS.ProcessEnv = { ...process.env, MINIVAC_LLM_BASE_URL: fake.base, MINIVAC_LLM_API_KEY: 'test-key' };
    for (const name of ['MINIVAC_LLM_MAX_TURNS', 'MINIVAC_LLM_NUDGES', 'MINIVAC_LLM_REQUIRE_API_BASE', 'MINIVAC_SKILL_PATH',
      'MINIVAC_CONTROL_SESSION']) delete env[name];
    // spawnSync would block this process's event loop, and with it the fake server.
    const code = await new Promise<number | null>((done) => {
      const child = spawn('node', ['tools/hands-api/openai-loop.ts', 'fake-model', out, prompt], { cwd: REPO, env, stdio: 'ignore' });
      child.on('close', done);
    });

    expect(code).toBe(0);
    expect(existsSync(session)).toBe(true);
    const run = JSON.parse(readFileSync(join(out, 'run.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(run)).toEqual(['model', 'turns', 'toolCalls', 'promptTokens', 'completionTokens', 'served', 'fallbacks',
      'nudges', 'networkRetries', 'stop', 'seconds', 'finalText', 'costUsd']);
    expect(run).toMatchObject({ model: 'fake-model', turns: 2, toolCalls: 1, promptTokens: 20, completionTokens: 4,
      served: ['http://primary/v1'], fallbacks: 0, nudges: 0, networkRetries: 0, stop: 'done', finalText: 'Created.', costUsd: 1 });
    expect(typeof run.seconds).toBe('number');

    const lines = readFileSync(join(out, 'transcript.jsonl'), 'utf8').trim().split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(2);
    expect(Object.keys(lines[0] ?? {})).toEqual(['turn', 'servedBy', 'fallbacks', 'finish', 'usage', 'content', 'calls']);
    const calls = lines[0]?.calls as { name: string; args: string; output: string }[];
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0] ?? {})).toEqual(['name', 'args', 'output']);
    expect(calls[0]?.output).toMatch(/\n\[exit 0\]$/);
    expect(lines[1]).toMatchObject({ turn: 2, servedBy: 'http://primary/v1', finish: 'stop', content: 'Created.', calls: [] });

    const system = fake.seen[0]?.body.messages[0]?.content ?? '';
    expect(system.startsWith(SYSTEM_PREAMBLE)).toBe(true);
    expect(fake.seen[0]?.body.messages[1]).toEqual({ role: 'user', content: readFileSync(prompt, 'utf8') });
  }, 30_000);

  it('times out a grep pattern that would never finish, and the run goes on', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mv601-loop-'));
    cleanups.push(() => rmSync(out, { recursive: true, force: true }));
    const prompt = join(out, 'prompt.txt');
    writeFileSync(prompt, 'Search.\n');
    // `(-*)*x` backtracks without end on a long dashed rule line.
    const rules = scratchInScope('mv601-rules-');
    writeFileSync(join(rules, 'rule.md'), '-'.repeat(100) + '\n');
    const fake = await fakeServer([toolReply([['grep', { pattern: '(-*)*x', path: relative(REPO, rules) }]]), textReply('Gave up.')]);
    const env: NodeJS.ProcessEnv = { ...process.env, MINIVAC_LLM_BASE_URL: fake.base, MINIVAC_LLM_API_KEY: 'test-key' };
    for (const name of ['MINIVAC_LLM_MAX_TURNS', 'MINIVAC_LLM_NUDGES', 'MINIVAC_LLM_REQUIRE_API_BASE', 'MINIVAC_SKILL_PATH',
      'MINIVAC_CONTROL_SESSION']) delete env[name];
    // The grep runs in the child: a hang there cannot block this process, and is killed below.
    const code = await new Promise<number | string | null>((done) => {
      const child = spawn('node', ['tools/hands-api/openai-loop.ts', 'fake-model', out, prompt], { cwd: REPO, env, stdio: 'ignore' });
      const kill = setTimeout(() => { child.kill('SIGKILL'); done('hung'); }, 25_000);
      child.on('close', (exit) => { clearTimeout(kill); done(exit); });
    });

    expect(code).toBe(0);
    const lines = readFileSync(join(out, 'transcript.jsonl'), 'utf8').trim().split('\n')
      .map((line) => JSON.parse(line) as { calls: { output: string }[] });
    expect(lines[0]?.calls[0]?.output).toBe('error: grep timed out after 10 s: use a simpler pattern');
    expect(JSON.parse(readFileSync(join(out, 'run.json'), 'utf8'))).toMatchObject({ stop: 'done', finalText: 'Gave up.' });
  }, 30_000);

  it('lets read_file read the run\'s own session file, though it is outside what the file tools read', async () => {
    const out = mkdtempSync(join(tmpdir(), 'mv601-loop-'));
    cleanups.push(() => rmSync(out, { recursive: true, force: true }));
    const session = join(out, 'session.json');
    const prompt = join(out, 'prompt.txt');
    writeFileSync(prompt, 'Use the session file ' + session + ' (create it).\n');
    const fake = await fakeServer([
      toolReply([['minivac_control', { args: 'new ' + session }]]),
      toolReply([['read_file', { path: session, limit: 1 }], ['read_file', { path: join(out, 'prompt.txt') }]]),
      textReply('Read it.'),
    ]);
    const env: NodeJS.ProcessEnv = { ...process.env, MINIVAC_LLM_BASE_URL: fake.base, MINIVAC_LLM_API_KEY: 'test-key' };
    for (const name of ['MINIVAC_LLM_MAX_TURNS', 'MINIVAC_LLM_NUDGES', 'MINIVAC_LLM_REQUIRE_API_BASE', 'MINIVAC_SKILL_PATH',
      'MINIVAC_CONTROL_SESSION']) delete env[name];
    const code = await new Promise<number | null>((done) => {
      const child = spawn('node', ['tools/hands-api/openai-loop.ts', 'fake-model', out, prompt], { cwd: REPO, env, stdio: 'ignore' });
      child.on('close', done);
    });

    expect(code).toBe(0);
    const lines = readFileSync(join(out, 'transcript.jsonl'), 'utf8').trim().split('\n')
      .map((line) => JSON.parse(line) as { calls: { output: string }[] });
    expect(lines[1]?.calls.map((call) => call.output.split('\n')[0])).toEqual([
      '1\t{', 'error: path is outside the repository: ' + join(out, 'prompt.txt'),
    ]);
  }, 30_000);
});
