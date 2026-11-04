/**
 * The dev-only chat pane beside the console (docs/plans/stage-3-chat-pane.md, step 9): the
 * transcript, the message box, the route select, Stop, New session and End session, and a
 * served-by badge on every model reply. It connects to the local pane server
 * (`tools/hands-pane/server.ts`) and answers its requests from the page's engine
 * (`src/pane/engine.ts`), whose machine the console shows frozen and locked while the model has
 * it (`App.adopt`, again after every call so the cords re-render) and hands back live on End
 * session (`App.release`). The pane lives in its own element: a console mount wipes `#app`.
 */
import type { App } from '../app.ts';
import { createPaneEngine } from './engine.ts';
import type { PaneEngine } from './engine.ts';
import { CLOSE_BAD_PROTOCOL, CLOSE_BAD_TOKEN, DEFAULT_PANE_PORT, PANE_PROTOCOL } from './protocol.ts';
import type { PageMessage, PaneReply, ServedEvent, ServerMessage, TurnCall, TurnEvent } from './protocol.ts';

/** Where the pane server is, from the page URL the server printed: `#t=<token>&port=<n>`. */
export interface PaneLink {
  token: string;
  port: number;
}

export function readPaneLink(hash: string): PaneLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get('t');
  const portText = params.get('port');
  const port = portText === null ? DEFAULT_PANE_PORT : Number(portText);
  if (!token || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { token, port };
}

function message(problem: unknown): string {
  return problem instanceof Error ? problem.message : String(problem);
}

/** How a minivac_control call reads in the transcript: the command line the model typed. */
function callLabel(call: TurnCall): string {
  if (call.name === 'minivac_control') {
    try {
      const args = (JSON.parse(call.args) as { args?: unknown }).args;
      if (typeof args === 'string') return 'minivac-control ' + args;
    } catch {
      // Shown raw below.
    }
  }
  return call.name + ' ' + call.args;
}

/** The badge's text; empty when the endpoint said nothing about who served the reply (no LiteLLM proxy). */
function servedText(turn: ServedEvent | TurnEvent): string {
  const parts = turn.servedBy === '?' ? [] : ['served by ' + turn.servedBy];
  if (turn.offPrimary) parts.push('FALLBACK: not the route\'s primary');
  if (turn.fallbacks > 0) parts.push(turn.fallbacks + (turn.fallbacks === 1 ? ' fallback' : ' fallbacks') + ' tried');
  if (turn.costUsd > 0) parts.push('$' + turn.costUsd.toFixed(4));
  if ('stop' in turn && turn.stop !== undefined) parts.push('request failed: ' + turn.stop);
  return parts.join(' · ');
}

const CLOSE_REASONS: Readonly<Record<number, string>> = {
  [CLOSE_BAD_TOKEN]: 'the server refused the token: open the URL the pane server printed',
  [CLOSE_BAD_PROTOCOL]: 'this page is from another build than the server: reload it',
};

export function mountPane(root: HTMLElement, app: App, link: PaneLink | null): void {
  const document = root.ownerDocument;

  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(className: string, label: string): HTMLButtonElement {
    const node = element('button', 'pane-button ' + className, label);
    node.type = 'button';
    return node;
  }

  const status = element('p', 'pane-status', 'connecting…');
  status.setAttribute('role', 'status');
  const head = element('header', 'pane-head');
  head.append(element('h2', 'pane-title', 'Chat pane'), status);
  const transcript = element('ol', 'pane-transcript');
  transcript.setAttribute('aria-label', 'Transcript');
  const input = element('textarea', 'pane-input');
  input.rows = 3;
  input.setAttribute('aria-label', 'Message');
  input.placeholder = 'Ask the model to wire or operate the panel';
  const route = element('select', 'pane-route');
  route.setAttribute('aria-label', 'Route');
  const sendButton = element('button', 'pane-button pane-send', 'Send');
  sendButton.type = 'submit';
  const stopButton = button('pane-stop', 'Stop');
  const newButton = button('pane-new', 'New session');
  const endButton = button('pane-end', 'End session');
  const controls = element('div', 'pane-controls');
  controls.append(route, sendButton, stopButton, newButton, endButton);
  const form = element('form', 'pane-form');
  form.append(input, controls);
  root.replaceChildren(head, transcript, form);

  let socket: WebSocket | null = null;
  let ready = false;
  /** A user message is out and its `done` has not come back. */
  let busy = false;
  /** The server has a pane session for this page: from `started` to `ended`. */
  let run: string | null = null;
  /** The console shows the engine's machine, frozen and locked. */
  let adopted = false;
  /** Which button asked for `end`: New session also clears the transcript. */
  let ending: 'end' | 'new' | null = null;
  /** The reply whose badge is up and whose calls are running: its `turn` fills the same entry. */
  let replying: { turn: number; item: HTMLLIElement; badge: HTMLParagraphElement } | null = null;
  /** A request to the model is out: a line at the transcript's end, its clock running, until the reply is in. */
  let waiting: { item: HTMLLIElement; timer: ReturnType<typeof setInterval> } | null = null;
  let engine: PaneEngine = createPaneEngine(app.netlist, app.profiles);

  function update(): void {
    sendButton.disabled = !ready || busy || ending !== null || input.value.trim() === '';
    route.disabled = !ready || busy;
    stopButton.disabled = !ready || !busy;
    newButton.disabled = ending !== null;
    endButton.disabled = ending !== null || (run === null && !adopted);
  }

  function entry(kind: 'user' | 'assistant' | 'note' | 'error' | 'working', text?: string): HTMLLIElement {
    const item = element('li', 'pane-entry pane-' + kind);
    item.dataset.kind = kind;
    if (text !== undefined) item.append(element('p', 'pane-text', text));
    transcript.append(item);
    transcript.scrollTop = transcript.scrollHeight;
    return item;
  }

  function send(out: PageMessage): void {
    if (socket !== null && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(out));
  }

  function stopWaiting(): void {
    if (waiting === null) return;
    clearInterval(waiting.timer);
    waiting.item.remove();
    waiting = null;
  }

  function showWaiting(request: Extract<ServerMessage, { type: 'requesting' }>): void {
    stopWaiting();
    const item = entry('working');
    const text = element('p', 'pane-text');
    item.append(text);
    const began = Date.now();
    const paint = (): void => {
      text.textContent = 'waiting for ' + request.route + ' · request ' + request.turn + ' · ' +
        Math.floor((Date.now() - began) / 1000) + ' s';
    };
    paint();
    waiting = { item, timer: setInterval(paint, 1000) };
  }

  function showMachine(): void {
    const machine = engine.machine();
    if (machine === null) return;
    try {
      app.adopt(machine);
      adopted = true;
    } catch (problem: unknown) {
      console.error('pane:', problem);
      entry('error', 'The console could not show the machine: ' + message(problem));
    }
  }

  /** Hand the machine back live and unlocked; New session also clears the transcript. */
  function handBack(kind: 'end' | 'new'): void {
    if (adopted) app.release();
    adopted = false;
    if (kind === 'new') {
      stopWaiting();
      transcript.replaceChildren();
      replying = null;
    }
    entry('note', kind === 'new' ? 'New session: the next message starts from nothing.' :
      'Session ended: the machine is live and unlocked.');
  }

  function answer(request: Extract<ServerMessage, { type: 'request' }>): void {
    let reply: PaneReply;
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
    send({ type: 'reply', id: request.id, reply });
    if (request.op === 'create' || request.op === 'run') showMachine();
  }

  function paintBadge(badge: HTMLParagraphElement, served: ServedEvent | TurnEvent): void {
    badge.textContent = servedText(served);
    badge.hidden = badge.textContent === '';
    badge.classList.toggle('pane-badge-fallback', served.offPrimary || served.fallbacks > 0);
    badge.classList.toggle('pane-badge-failed', 'stop' in served && served.stop !== undefined);
  }

  /** A reply's entry with its served-by badge, up before any of its calls run. */
  function showServed(served: ServedEvent | TurnEvent): NonNullable<typeof replying> {
    const item = entry('assistant');
    const badge = element('p', 'pane-badge');
    paintBadge(badge, served);
    item.append(badge);
    replying = { turn: served.turn, item, badge };
    return replying;
  }

  function showTurn(turn: TurnEvent): void {
    const { item, badge } = replying !== null && replying.turn === turn.turn ? replying : showServed(turn);
    replying = null;
    paintBadge(badge, turn);
    if (turn.reason !== undefined) item.append(element('pre', 'pane-call-output', turn.reason));
    if (turn.content !== null && turn.content.trim() !== '') item.append(element('p', 'pane-text', turn.content));
    for (const call of turn.calls) {
      const details = element('details', 'pane-call');
      details.open = call.name === 'minivac_control';
      details.append(element('summary', 'pane-call-head', callLabel(call)), element('pre', 'pane-call-output', call.output));
      item.append(details);
    }
    transcript.scrollTop = transcript.scrollHeight;
  }

  function onServer(frame: ServerMessage): void {
    switch (frame.type) {
      case 'ready':
        ready = true;
        route.replaceChildren(...frame.routes.map((name) => element('option', '', name)));
        input.maxLength = frame.maxUserChars;
        status.textContent = 'connected';
        break;
      case 'started':
        engine = createPaneEngine(app.netlist, app.profiles);
        run = frame.run;
        status.textContent = 'session ' + frame.run;
        entry('note', 'Session ' + frame.run + ' started; the model must create pane.json.');
        break;
      case 'request':
        answer(frame);
        break;
      case 'requesting':
        showWaiting(frame);
        break;
      case 'served':
        stopWaiting();
        showServed(frame);
        break;
      case 'turn':
        stopWaiting();
        showTurn(frame);
        break;
      case 'done':
        stopWaiting();
        busy = false;
        replying = null;
        if (frame.stop === 'refused' || frame.stop === 'error') entry('error', frame.text);
        else if (frame.stop !== 'done') entry('note', 'The turn stopped: ' + frame.stop + '.');
        break;
      case 'ended': {
        run = null;
        status.textContent = 'connected';
        const kind = ending;
        ending = null;
        // New session wipes the transcript: an error that ended the session goes in after it.
        if (kind === 'new') handBack(kind);
        if (frame.error !== undefined) {
          entry('error', 'The session ended: ' + frame.error + (kind === null ? '. End session unlocks the panel.' : '.'));
        }
        if (kind === 'end') handBack(kind);
        break;
      }
      case 'error':
        entry('error', frame.message);
        break;
    }
    update();
  }

  function connect(where: PaneLink): void {
    const ws = new WebSocket('ws://127.0.0.1:' + where.port + '/');
    socket = ws;
    ws.addEventListener('open', () => {
      send({ type: 'hello', protocol: PANE_PROTOCOL, token: where.token });
    });
    ws.addEventListener('message', (event) => {
      let frame: ServerMessage;
      try {
        frame = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return;
      }
      onServer(frame);
    });
    ws.addEventListener('close', (event) => {
      socket = null;
      ready = false;
      busy = false;
      stopWaiting();
      status.textContent = 'disconnected: ' + (CLOSE_REASONS[event.code] ?? 'is the pane server running? reload to reconnect');
      if (run !== null) entry('error', 'The pane server connection closed; run ' + run + ' is marked invalid.');
      run = null;
      const kind = ending;
      ending = null;
      if (kind !== null) handBack(kind);
      update();
    });
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!ready || busy || ending !== null || text === '') return;
    busy = true;
    entry('user', text);
    send({ type: 'user', text, route: route.value });
    input.value = '';
    update();
  });
  input.addEventListener('input', update);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  stopButton.addEventListener('click', () => send({ type: 'stop' }));
  for (const [control, kind] of [[newButton, 'new'], [endButton, 'end']] as const) {
    control.addEventListener('click', () => {
      if (!ready) {
        handBack(kind);
        update();
        return;
      }
      ending = kind;
      send({ type: 'end' });
      update();
    });
  }

  update();
  if (link === null) {
    status.textContent = 'no server link: open the URL the pane server printed (dev.html#t=…)';
    return;
  }
  connect(link);
}
