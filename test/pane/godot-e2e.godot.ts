/**
 * The Godot build's chat end to end (docs/plans/godot-chat-pane.md, C6): the real, unchanged pane
 * server (`node tools/hands-pane/server.ts`, its origin allow-list at the default) with the scripted
 * fake model the web pane's end to end uses (test/browser/scripted-model.ts), and the Godot build,
 * headless, launched with the link the server printed (`--pane-link`). Godot's `pane-e2e` and
 * `pane-quit` acceptance suites (godot/scripts/Acceptance.cs, "C6") send the message through the
 * dock and check the console inside the app; this file checks what the server wrote.
 *
 * Run it with `npm run godot-pane-e2e` (vitest.godot-e2e.config.ts), with `dotnet` (the .NET 10
 * SDK) on PATH and GODOT set to the Godot 4.7.2 mono binary (docs/port/CSHARP-PORT.md). It is not
 * in the default `npm test`. Before any case it builds the Godot project's C#, so it never runs a
 * stale build; it fails, never skips, when either tool is missing, the build fails, or the project
 * has not been imported.
 */
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPaneEngine } from '../../src/pane/engine.ts';
import type { PaneEngine } from '../../src/pane/engine.ts';
import type { PaneReply, PaneRequest } from '../../src/pane/protocol.ts';
import { loadRepoNetlist, loadRepoProfile } from '../../tools/hands/session-file.ts';
import { callOnPage } from '../../tools/hands-pane/server.ts';
import type { PageLink } from '../../tools/hands-pane/server.ts';
import { control, PRIMARY, scriptedModel } from '../browser/scripted-model.ts';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const PROJECT = join(REPO, 'godot');
const BUILD = ['build', 'godot/Minivac.Godot.sln', '--nologo'];
const PROMPT = 'Plug a cord from 1+ to 1A and another from 1B to 1-, then turn the power on.';
// The web e2e's B1 script (test/browser/pane.browser.ts).
const CALLS = ['new pane.json', 'pane.json connect 1+/1A + connect 1B/1- + power on'];
const FINAL = 'Lamp 1 is on.';
const LINK = /^http:\/\/127\.0\.0\.1:5173\/dev\.html#t=[A-Za-z0-9_-]+&port=[0-9]+$/u;

let godot = '';

beforeAll(() => {
  godot = process.env.GODOT ?? '';
  if (godot === '') throw new Error('set GODOT to the Godot 4.7.2 mono binary (docs/port/CSHARP-PORT.md, the toolchain)');
  if (!existsSync(godot)) throw new Error('GODOT is ' + godot + ', which does not exist: set it to the Godot 4.7.2 mono binary');
  const build = spawnSync('dotnet', BUILD, { cwd: REPO, encoding: 'utf8' });
  if (build.error !== undefined) throw new Error('cannot run dotnet (is the .NET SDK on PATH?): ' + build.error.message);
  if (build.status !== 0) throw new Error('dotnet ' + BUILD.join(' ') + ' failed:\n' + build.stdout + build.stderr);
  if (!existsSync(join(PROJECT, '.godot', 'imported'))) {
    throw new Error('the Godot project has not been imported: run "$GODOT" --headless --path godot --import once');
  }
}, 300_000);

/** Everything a case started, stopped and removed whether it passed or not. */
const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const port = (probe.address() as AddressInfo).port;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/** Polls `ready` every 20 ms; throws, saying what it waited for, after `ms`. */
async function waitFor(what: string, ready: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('timed out after ' + ms + ' ms waiting for ' + what);
    await new Promise((done) => setTimeout(done, 20));
  }
}

function exited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

/** SIGTERM, then SIGKILL after 5 s; resolves once the process is gone. */
async function stop(child: ChildProcess): Promise<void> {
  if (exited(child)) return;
  const gone = new Promise<void>((done) => child.once('exit', () => done()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5_000);
  await gone;
  clearTimeout(timer);
}

/** A child's stdout and stderr, as lines so far. */
function collect(child: ChildProcess): () => string[] {
  let text = '';
  child.stdout?.on('data', (chunk: Buffer) => { text += chunk.toString('utf8'); });
  child.stderr?.on('data', (chunk: Buffer) => { text += chunk.toString('utf8'); });
  return () => text.split('\n');
}

interface Scenario { runs: string; link: string; log: () => string[]; bodies: () => string[] }

/** The fake model, then the real server on a free port, its runs in a temp dir; registered for cleanup. */
async function startScenario(): Promise<Scenario> {
  const runs = mkdtempSync(join(tmpdir(), 'mv601-godot-e2e-'));
  cleanup.push(() => Promise.resolve(rmSync(runs, { recursive: true, force: true })));
  const model = await scriptedModel([control('call_1', CALLS[0] as string), control('call_2', CALLS[1] as string), { role: 'assistant', content: FINAL }]);
  cleanup.push(model.close);
  const env: NodeJS.ProcessEnv = {
    ...process.env, MINIVAC_LLM_BASE_URL: model.base, MINIVAC_LLM_API_KEY: 'e2e-key', MINIVAC_PANE_ROUTES: 'model-a,model-b',
    MINIVAC_PANE_PORT: String(await freePort()), MINIVAC_PANE_RUNS: runs, MINIVAC_PANE_PRIMARY: JSON.stringify({ 'model-a': PRIMARY }),
    // Its link file goes under the temp dir, not over the link of a server the tester has running.
    HOME: runs, USERPROFILE: runs,
  };
  // The origin allow-list stays at its default (the Vite dev origins), as a user starts it.
  delete env.MINIVAC_PANE_ORIGINS;
  delete env.MINIVAC_PANE_MAX_TURNS;
  const server = spawn(process.execPath, ['tools/hands-pane/server.ts'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'] });
  cleanup.push(() => stop(server));
  const log = collect(server);
  await waitFor('the pane server to print its link', () => exited(server) || log().some((line) => LINK.test(line)), 15_000);
  const link = log().find((line) => LINK.test(line));
  if (link === undefined) throw new Error('the pane server exited before printing its link:\n' + log().join('\n'));
  return { runs, link, log, bodies: model.bodies };
}

/** The Godot build, headless, running one acceptance suite with the link; its exit code and output. */
async function runGodot(suite: string, link: string): Promise<{ code: number | null; out: string[] }> {
  const child = spawn(godot, ['--headless', '--path', PROJECT, '--', '--acceptance', suite, '--pane-link', link],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  cleanup.push(() => stop(child));
  const out = collect(child);
  const code = await new Promise<number | null>((done, failed) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      failed(new Error('Godot (' + suite + ') did not exit within 90 s:\n' + out().join('\n')));
    }, 90_000);
    child.once('exit', (status) => {
      clearTimeout(timer);
      done(status);
    });
  });
  return { code, out: out() };
}

/** The suite passed every check it made, and made some. */
function expectSuitePassed(suite: string, run: { code: number | null; out: string[] }): void {
  const summary = run.out.find((line) => line.startsWith('acceptance: ' + suite + ' '));
  const failures = run.out.filter((line) => line.startsWith('FAIL '));
  expect(failures, run.out.join('\n')).toEqual([]);
  expect(run.code, run.out.join('\n')).toBe(0);
  const [passed, total] = (summary ?? '').slice(('acceptance: ' + suite + ' ').length).split('/').map(Number);
  expect(passed, 'the suite summary: ' + summary).toBe(total);
  expect(total).toBeGreaterThan(0);
  process.stdout.write(run.out.filter((line) => line.startsWith('PASS ') || line.startsWith('acceptance: ')).join('\n') + '\n');
}

/** The web page's `answer` (src/pane/ui.ts), without the socket. */
function pageAnswer(engine: PaneEngine, request: PaneRequest): PaneReply | undefined {
  switch (request.op) {
    case 'create': return engine.create(request.session);
    case 'run': return engine.run(request.calls, request.settleMs);
    case 'state': return engine.state();
    case 'session': return engine.session();
  }
  return undefined;
}

/**
 * What the model is shown for each call when the web page's engine answers: the server's own
 * `callOnPage` over `src/pane/engine.ts`, requests and replies crossing as JSON text as on the socket,
 * then the loop's tool text (tools/hands-api/openai-loop.ts, `callTool`).
 */
async function webTexts(calls: readonly string[]): Promise<string[]> {
  const engine = createPaneEngine(loadRepoNetlist(), [loadRepoProfile('MV601-REF-A'), loadRepoProfile('MV601-IDEAL')]);
  const page: PageLink = {
    request: (request) => Promise.resolve(JSON.parse(JSON.stringify(pageAnswer(engine, JSON.parse(JSON.stringify(request)) as PaneRequest)) ?? 'null') as never),
  };
  const texts: string[] = [];
  for (const args of calls) {
    const { result } = await callOnPage(args.trim().split(/\s+/u), page);
    texts.push(result.stdout + result.stderr + '\n[exit ' + result.code + ']');
  }
  return texts;
}

function onlyRun(runs: string): string {
  const [run, ...others] = readdirSync(runs);
  expect(others, 'one run folder').toEqual([]);
  expect(run).toBeDefined();
  return run as string;
}

function runRecord(dir: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as Record<string, unknown>;
}

describe('the chat in the Godot build, against the real pane server', () => {
  it('the model wires B1 from the Godot dock; the panel is locked until End session', async () => {
    const began = Date.now();
    const scenario = await startScenario();
    const godotRun = await runGodot('pane-e2e', scenario.link);
    expectSuitePassed('pane-e2e', godotRun);

    const run = onlyRun(scenario.runs);
    const dir = join(scenario.runs, run);
    expect(readdirSync(dir).sort()).toEqual(['run.json', 'session.json', 'transcript.jsonl']);
    const record = runRecord(dir);
    expect(record).toMatchObject({
      model: 'model-a', stop: 'done', toolCalls: 2, finalText: FINAL, served: [PRIMARY], prompts: [{ route: 'model-a', text: PROMPT }],
    });
    expect(record).not.toHaveProperty('invalid');

    // The exported session passes the checklist's own checker for B1, run as a user runs it.
    const check = spawnSync(process.execPath, ['bin/minivac-check', 'checklist/items/B1.json', join(dir, 'session.json')],
      { cwd: REPO, encoding: 'utf8' });
    expect({ status: check.status, stdout: check.stdout, stderr: check.stderr }).toEqual({ status: 0, stdout: 'PASS B1\n', stderr: '' });

    // The text the model was shown for each call is the web page engine's, byte for byte: in the
    // model's last request, and in the transcript.
    const expected = await webTexts(CALLS);
    const bodies = scenario.bodies();
    expect(bodies).toHaveLength(3);
    const shown = (JSON.parse(bodies[2] as string) as { messages: { role: string; content: string }[] }).messages
      .filter((message) => message.role === 'tool').map((message) => message.content);
    expect(shown).toEqual(expected);
    const recorded = readFileSync(join(dir, 'transcript.jsonl'), 'utf8').trim().split('\n')
      .flatMap((line) => (JSON.parse(line) as { calls: { output: string }[] }).calls.map((call) => call.output));
    expect(recorded).toEqual(expected);

    // The server saw a session start and end cleanly: End session came before Godot quit.
    const log = scenario.log();
    expect(log).toContain('pane session ' + run + ' started');
    expect(log).toContain(run + ': turn ended, done');
    expect(log.filter((line) => line.includes('marked invalid'))).toEqual([]);
    process.stdout.write('pane-e2e wall time ' + ((Date.now() - began) / 1000).toFixed(1) + ' s\n');
  }, 150_000);

  it('quitting the Godot build mid-session marks the run invalid, as a reload does on the web', async () => {
    const began = Date.now();
    const scenario = await startScenario();
    const godotRun = await runGodot('pane-quit', scenario.link);
    expectSuitePassed('pane-quit', godotRun);

    const run = onlyRun(scenario.runs);
    const dir = join(scenario.runs, run);
    const line = run + ': the page disconnected, run marked invalid';
    await waitFor('the server to log "' + line + '"', () => scenario.log().includes(line), 10_000);
    await waitFor('run.json to carry "invalid"', () => 'invalid' in runRecord(dir), 10_000);
    const record = runRecord(dir);
    expect(record).toMatchObject({ stop: 'done', toolCalls: 2, finalText: FINAL });
    expect(record.invalid).toBe('the page disconnected mid-session (a reload or a closed tab), and the machine went with it');
    process.stdout.write('pane-quit wall time ' + ((Date.now() - began) / 1000).toFixed(1) + ' s\n');
  }, 150_000);
});
