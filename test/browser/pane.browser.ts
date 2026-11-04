// The chat pane end to end (docs/plans/stage-3-chat-pane.md, step 10): dev.html on the Playwright
// dev server, the pane server started here in-process, and a scripted fake model on node:http in
// place of the gateway. No real model is called. Desktop only: the pane is a desktop dev tool.

import { expect, test } from '@playwright/test';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkItem, readItem } from '../../tools/checklist/check.ts';
import { readSession } from '../../tools/hands/session-file.ts';
import { startPaneServer } from '../../tools/hands-pane/server.ts';
import { closeDrawer, nextPaint } from './console-helpers.ts';

const PRIMARY = 'http://primary.test/v1';
const FALLBACK = 'http://fallback.test/v1';
const ROUTES = ['model-a', 'model-b'];
const B1 = fileURLToPath(new URL('../../checklist/items/B1.json', import.meta.url));

/**
 * A model that answers the nth request with the nth reply, served by `servedBy(n)` (from 0), the
 * primary by default, once `hold(n)` settles. A null `servedBy` sends no served-by header, as an
 * endpoint without a LiteLLM proxy in front does.
 */
async function scriptedModel(replies: object[], servedBy: (n: number) => string | null = () => PRIMARY,
  hold: (n: number) => Promise<void> = () => Promise.resolve()):
  Promise<{ base: string; requests: () => number; close: () => Promise<void> }> {
  let requests = 0;
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      const n = requests++;
      const message = replies[n];
      void hold(n).then(() => {
        const base = servedBy(n);
        res.writeHead(message === undefined ? 500 : 200,
          { 'Content-Type': 'application/json', ...(base === null ? {} : { 'x-litellm-model-api-base': base }) });
        res.end(JSON.stringify(message === undefined ? { error: 'script exhausted' } :
          { choices: [{ message, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }));
      });
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return {
    base: 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/v1',
    requests: () => requests,
    close: () => new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    }),
  };
}

function control(id: string, args: string): object {
  return {
    role: 'assistant', content: null,
    tool_calls: [{ id, type: 'function', function: { name: 'minivac_control', arguments: JSON.stringify({ args }) } }],
  };
}

const ON = /(?:^|\s)on(?:\s|$)/u;
const OFF = /(?:^|\s)off(?:\s|$)/u;

test('the model wires B1 from the pane; the panel is locked until End session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'the pane is a desktop dev tool');
  test.setTimeout(60_000);
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  const runs = mkdtempSync(join(tmpdir(), 'mv601-pane-e2e-'));
  const model = await scriptedModel([
    control('call_1', 'new pane.json'),
    control('call_2', 'pane.json connect 1+/1A + connect 1B/1- + power on'),
    { role: 'assistant', content: 'Lamp 1 is on.' },
  ]);
  const server = await startPaneServer({
    base: model.base, key: 'e2e-key', port: 0, origins: [origin], routes: ROUTES, runsRoot: runs, primary: { 'model-a': PRIMARY },
  });
  try {
    await page.goto(server.url);
    await expect(page.locator('.console-surface')).toBeVisible();
    const closeHelp = page.getByRole('button', { name: 'Close help' });
    if (await closeHelp.isVisible()) await closeHelp.click();
    await expect(page.locator('.pane-status')).toHaveText('connected');
    await expect(page.getByRole('combobox', { name: 'Route' })).toHaveValue('model-a');

    await page.getByRole('textbox', { name: 'Message' })
      .fill('Plug a cord from 1+ to 1A and another from 1B to 1-, then turn the power on.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.pane-entry[data-kind="assistant"]').last()).toContainText('Lamp 1 is on.');
    await expect(page.getByRole('button', { name: 'Stop' })).toBeDisabled();
    expect(model.requests()).toBe(3);
    await expect(page.locator('.pane-call-head')).toHaveText([
      'minivac-control new pane.json',
      'minivac-control pane.json connect 1+/1A + connect 1B/1- + power on',
    ]);
    await expect(page.locator('.pane-call-output').last()).toContainText('ok  connect 1+/1A  -> cord 0 (1+#1 1A#1)');
    await expect(page.locator('.pane-badge').first()).toHaveText('served by ' + PRIMARY);

    // The model's machine, in the panel: lamp 1 lit and both cords plugged in.
    const lamp1 = page.locator('[data-component="out-lamp-1"]');
    const power = page.locator('.power-switch');
    await expect(lamp1).toHaveClass(ON);
    await expect(page.locator('.cord-path')).toHaveCount(2);
    await expect(page.locator('.panel-hole.occupied')).toHaveCount(4);
    await expect(power).toHaveAttribute('aria-pressed', 'true');

    // Locked while the session is live: a click on Power reaches nothing.
    await closeDrawer(page);
    await expect(page.locator('.console-stage')).toHaveJSProperty('inert', true);
    await power.click({ force: true });
    await nextPaint(page);
    await nextPaint(page);
    await expect(power).toHaveAttribute('aria-pressed', 'true');
    await expect(lamp1).toHaveClass(ON);
    await expect(page.locator('.cord-path')).toHaveCount(2);

    // End session hands the machine back live and unlocked, the circuit still plugged in.
    await page.getByRole('button', { name: 'End session' }).click();
    await expect(page.locator('.pane-entry[data-kind="note"]').last()).toHaveText('Session ended: the machine is live and unlocked.');
    await expect(page.locator('.console-stage')).toHaveJSProperty('inert', false);
    await expect(page.locator('.cord-path')).toHaveCount(2);
    await expect(lamp1).toHaveClass(ON);
    await closeDrawer(page);
    await power.click();
    await expect(power).toHaveAttribute('aria-pressed', 'false');
    await expect(lamp1).toHaveClass(OFF);

    // The run directory: the exported session passes the checklist's B1, and the run is valid.
    const [run, ...others] = readdirSync(runs);
    expect(others).toEqual([]);
    const dir = join(runs, run as string);
    expect(checkItem(readItem(B1), readSession(join(dir, 'session.json')))).toEqual({ code: 0, stdout: 'PASS B1\n', stderr: '' });
    const record = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8')) as Record<string, unknown>;
    expect(record).toMatchObject({ model: 'model-a', stop: 'done', toolCalls: 2, finalText: 'Lamp 1 is on.', served: [PRIMARY] });
    expect(record).not.toHaveProperty('invalid');
  } finally {
    await server.close();
    await model.close();
    rmSync(runs, { recursive: true, force: true });
  }
});

test('the pane shows the model working while a request is out, until its reply is in', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'the pane is a desktop dev tool');
  test.setTimeout(60_000);
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  const runs = mkdtempSync(join(tmpdir(), 'mv601-pane-e2e-'));
  let release = (): void => {};
  const held = new Promise<void>((done) => { release = done; });
  const model = await scriptedModel([control('call_1', 'new pane.json'), { role: 'assistant', content: 'Ready.' }],
    () => PRIMARY, (n) => (n === 1 ? held : Promise.resolve()));
  const server = await startPaneServer({
    base: model.base, key: 'e2e-key', port: 0, origins: [origin], routes: ROUTES, runsRoot: runs, primary: { 'model-a': PRIMARY },
  });
  try {
    await page.goto(server.url);
    const closeHelp = page.getByRole('button', { name: 'Close help' });
    if (await closeHelp.isVisible()) await closeHelp.click();
    await expect(page.locator('.pane-status')).toHaveText('connected');
    await page.getByRole('textbox', { name: 'Message' }).fill('Start a session.');
    await page.getByRole('button', { name: 'Send' }).click();

    // The second request is held: the line says so, after the first reply, and its clock runs.
    const working = page.locator('.pane-entry[data-kind="working"]');
    await expect(working).toHaveText(/^waiting for model-a · request 2 · \d+ s$/);
    await expect(page.locator('.pane-entry').last()).toHaveAttribute('data-kind', 'working');
    await expect(working).toContainText('· 1 s');
    release();
    await expect(page.locator('.pane-entry[data-kind="assistant"]').last()).toContainText('Ready.');
    await expect(working).toHaveCount(0);
  } finally {
    release();
    await server.close();
    await model.close();
    rmSync(runs, { recursive: true, force: true });
  }
});

test('a free-ended lead the model plugs shows on the panel, its free end in the tray', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'the pane is a desktop dev tool');
  test.setTimeout(60_000);
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  const runs = mkdtempSync(join(tmpdir(), 'mv601-pane-e2e-'));
  const model = await scriptedModel([
    control('call_1', 'new pane.json'),
    control('call_2', 'pane.json connect M10/free'),
    { role: 'assistant', content: 'The lead is in.' },
  ]);
  const server = await startPaneServer({
    base: model.base, key: 'e2e-key', port: 0, origins: [origin], routes: ROUTES, runsRoot: runs, primary: { 'model-a': PRIMARY },
  });
  try {
    await page.goto(server.url);
    const closeHelp = page.getByRole('button', { name: 'Close help' });
    if (await closeHelp.isVisible()) await closeHelp.click();
    await expect(page.locator('.pane-status')).toHaveText('connected');
    await page.getByRole('textbox', { name: 'Message' }).fill('Plug a free-ended lead into M10.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.pane-entry[data-kind="assistant"]').last()).toContainText('The lead is in.');
    await expect(page.locator('.pane-call-output').last()).toContainText('ok  connect M10/free  -> cord 0 (M10#1 free)');
    await expect(page.locator('.panel-hole.occupied')).toHaveCount(1);
    await expect(page.locator('[data-cord-tray="free"][data-cord="0"][data-side="b"]')).toHaveCount(1);
  } finally {
    await server.close();
    await model.close();
    rmSync(runs, { recursive: true, force: true });
  }
});

test('the served-by badge turns before the reply\'s calls run on the page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'the pane is a desktop dev tool');
  test.setTimeout(60_000);
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  const runs = mkdtempSync(join(tmpdir(), 'mv601-pane-e2e-'));
  const model = await scriptedModel([control('call_1', 'new pane.json'), { role: 'assistant', content: 'Made it.' }],
    (n) => (n === 0 ? FALLBACK : PRIMARY));
  const server = await startPaneServer({
    base: model.base, key: 'e2e-key', port: 0, origins: [origin], routes: ROUTES, runsRoot: runs, primary: { 'model-a': PRIMARY },
  });
  // Each request for the page's engine is held until the badges on the page have been read.
  const atRequest: { text: string; fallback: boolean }[][] = [];
  await page.routeWebSocket('ws://127.0.0.1:' + server.port + '/', (ws) => {
    const upstream = ws.connectToServer();
    ws.onMessage((message) => upstream.send(message));
    upstream.onMessage(async (message) => {
      if ((JSON.parse(String(message)) as { type: string }).type === 'request') {
        atRequest.push(await page.locator('.pane-badge').evaluateAll((badges) =>
          badges.map((badge) => ({ text: badge.textContent ?? '', fallback: badge.classList.contains('pane-badge-fallback') }))));
      }
      ws.send(message);
    });
  });
  try {
    await page.goto(server.url);
    await expect(page.locator('.console-surface')).toBeVisible();
    const closeHelp = page.getByRole('button', { name: 'Close help' });
    if (await closeHelp.isVisible()) await closeHelp.click();
    await expect(page.locator('.pane-status')).toHaveText('connected');
    await page.getByRole('textbox', { name: 'Message' }).fill('Start a session.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.pane-entry[data-kind="assistant"]').last()).toContainText('Made it.');

    // The fallback's badge was up before `new` ran (its create and session requests).
    expect(atRequest).toHaveLength(2);
    for (const badges of atRequest) {
      expect(badges).toEqual([{ text: 'served by ' + FALLBACK + ' · FALLBACK: not the route\'s primary', fallback: true }]);
    }
    // One entry per reply, its calls under the badge that came first.
    const replies = page.locator('.pane-entry[data-kind="assistant"]');
    await expect(replies).toHaveCount(2);
    await expect(replies.first().locator('.pane-badge')).toHaveCount(1);
    await expect(replies.first().locator('.pane-call-head')).toHaveText('minivac-control new pane.json');
    await expect(replies.last().locator('.pane-badge')).toHaveText('served by ' + PRIMARY);
  } finally {
    await server.close();
    await model.close();
    rmSync(runs, { recursive: true, force: true });
  }
});

test('New session pressed during a call that breaks the engine keeps the error in view', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'the pane is a desktop dev tool');
  test.setTimeout(60_000);
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  const runs = mkdtempSync(join(tmpdir(), 'mv601-pane-e2e-'));
  const model = await scriptedModel([
    control('call_1', 'new pane.json'), control('call_2', 'pane.json connect 1+/1A'), { role: 'assistant', content: 'never' },
  ]);
  const server = await startPaneServer({
    base: model.base, key: 'e2e-key', port: 0, origins: [origin], routes: ROUTES, runsRoot: runs, primary: { 'model-a': PRIMARY },
  });
  // The batch request is held; New session is pressed, and once its `end` has gone to the server
  // the page's engine is made to fail the batch.
  let endSent = (): void => {};
  const ended = new Promise<void>((done) => { endSent = done; });
  await page.routeWebSocket('ws://127.0.0.1:' + server.port + '/', (ws) => {
    const upstream = ws.connectToServer();
    ws.onMessage((message) => {
      upstream.send(message);
      if ((JSON.parse(String(message)) as { type: string }).type === 'end') endSent();
    });
    upstream.onMessage(async (message) => {
      const frame = JSON.parse(String(message)) as { type: string; op?: string; id?: number };
      if (frame.type === 'request' && frame.op === 'run') {
        await page.getByRole('button', { name: 'New session' }).click();
        await ended;
        upstream.send(JSON.stringify({ type: 'reply', id: frame.id, reply: { error: 'the page engine threw: boom' } }));
        return;
      }
      ws.send(message);
    });
  });
  try {
    await page.goto(server.url);
    await expect(page.locator('.console-surface')).toBeVisible();
    const closeHelp = page.getByRole('button', { name: 'Close help' });
    if (await closeHelp.isVisible()) await closeHelp.click();
    await expect(page.locator('.pane-status')).toHaveText('connected');
    await page.getByRole('textbox', { name: 'Message' }).fill('Plug in a cord.');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.locator('.pane-entry[data-kind="note"]')).toHaveText(['New session: the next message starts from nothing.']);
    await expect(page.locator('.pane-entry[data-kind="error"]'))
      .toHaveText(['The session ended: the page engine failed: the page engine threw: boom.']);
    await expect(page.locator('.pane-entry[data-kind="error"]')).toBeVisible();
    await expect(page.locator('.console-stage')).toHaveJSProperty('inert', false);
    expect(model.requests()).toBe(2);
  } finally {
    await server.close();
    await model.close();
    rmSync(runs, { recursive: true, force: true });
  }
});

test('a reply from an endpoint that does not say who served it gets no badge', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'the pane is a desktop dev tool');
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  const runs = mkdtempSync(join(tmpdir(), 'mv601-pane-e2e-'));
  const model = await scriptedModel([{ role: 'assistant', content: 'Hello from a plain endpoint.' }], () => null);
  const server = await startPaneServer({ base: model.base, key: 'e2e-key', port: 0, origins: [origin], routes: ROUTES, runsRoot: runs });
  try {
    await page.goto(server.url);
    const closeHelp = page.getByRole('button', { name: 'Close help' });
    if (await closeHelp.isVisible()) await closeHelp.click();
    await expect(page.locator('.pane-status')).toHaveText('connected');
    await page.getByRole('textbox', { name: 'Message' }).fill('Say hello.');
    await page.getByRole('button', { name: 'Send' }).click();
    const reply = page.locator('.pane-entry[data-kind="assistant"]').last();
    await expect(reply).toContainText('Hello from a plain endpoint.');
    await expect(reply.locator('.pane-badge')).toBeHidden();
    await expect(reply).not.toContainText('served by');
  } finally {
    await server.close();
    await model.close();
    rmSync(runs, { recursive: true, force: true });
  }
});
