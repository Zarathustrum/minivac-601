// The scripted fake model the pane's end-to-end runs use in place of the gateway: the web pane's
// (pane.browser.ts) and the Godot build's (test/pane/godot-e2e.godot.ts). No real model is called.

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export const PRIMARY = 'http://primary.test/v1';

/**
 * A model that answers the nth request with the nth reply, served by `servedBy(n)` (from 0), the
 * primary by default, once `hold(n)` settles. A null `servedBy` sends no served-by header, as an
 * endpoint without a LiteLLM proxy in front does. `bodies()` is every request body, as sent.
 */
export async function scriptedModel(replies: object[], servedBy: (n: number) => string | null = () => PRIMARY,
  hold: (n: number) => Promise<void> = () => Promise.resolve()):
  Promise<{ base: string; requests: () => number; bodies: () => string[]; close: () => Promise<void> }> {
  let requests = 0;
  const bodies: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const n = requests++;
      bodies[n] = Buffer.concat(chunks).toString('utf8');
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
    bodies: () => [...bodies],
    close: () => new Promise<void>((done) => {
      server.closeAllConnections();
      server.close(() => done());
    }),
  };
}

/** One assistant message calling minivac_control with `args`. */
export function control(id: string, args: string): object {
  return {
    role: 'assistant', content: null,
    tool_calls: [{ id, type: 'function', function: { name: 'minivac_control', arguments: JSON.stringify({ args }) } }],
  };
}
