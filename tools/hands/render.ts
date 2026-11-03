/**
 * `minivac-control`'s output: the text, exit code and stream for a parsed call
 * (`invocation.ts`) and what a backend answered (`backend.ts`). Nothing here reads a session or
 * a machine, so the chat pane's text is the CLI's text by construction.
 */
import { DEFAULT_PROFILE } from '../../src/hands/table.ts';
import type { BatchOutcome, Change, CordView, SettleOutcome, StateView, ToolResult } from '../../src/hands/table.ts';
import type { BatchReply, CreateReply, StateReply } from './backend.ts';
import { mainHelp, terminalsHelp } from './help.ts';
import type { BatchInvocation, LocalInvocation, NewInvocation, Rejection, StateInvocation } from './invocation.ts';
import { loadRepoNetlist, loadRepoProfile, noSessionMessage } from './session-file.ts';

export interface CliResult {
  code: 0 | 1;
  stdout: string;
  stderr: string;
}

function ok(stdout: string): CliResult {
  return { code: 0, stdout, stderr: '' };
}

export function error(message: string): CliResult {
  return { code: 1, stdout: '', stderr: 'minivac-control: ' + message + '\n' };
}

function ms(ticks: number): string {
  return String(ticks / 10) + ' ms';
}

/** A cord's two holes, `free` for an end left hanging: `(1+#1 1Y#1)`, `(M10#3 free)`. */
function holes(cord: CordView): string {
  return '(' + cord.a + ' ' + (cord.b ?? 'free') + ')';
}

/** A refused command, with the glossary hint for an unknown terminal and a fix for common slips. */
function rejected(label: string, result: Rejection, suffix: string): CliResult {
  let hint = '';
  if (result.why === 'unknown_terminal') {
    if (/"[+-]"/.test(result.detail)) hint += '; the + and - rails are per section: write 1+ to 6+ or 1- to 6-';
    if (result.detail.includes('−')) hint += '; type the minus as an ASCII hyphen-minus (1-), not −';
    hint += ' (see: minivac-control help terminals)';
  }
  return error(label + ' rejected: ' + result.why + ': ' + result.detail + hint + suffix);
}

function describeOk(words: readonly string[], result: Extract<ToolResult, { ok: true }>): string {
  let line = 'ok  ' + words.join(' ');
  if (result.cord !== undefined) line += '  -> cord ' + result.cord.id + ' ' + holes(result.cord);
  if (result.cords !== undefined) {
    const ids = result.cords.map((cord) => cord.id);
    const first = ids[0] as number;
    const run = ids.every((id, i) => id === first + i);
    line += '  -> ' + ids.length + ' cords, ids ' + (run ? first + '-' + (first + ids.length - 1) : ids.join(', ')) +
      ' (see: state)';
  }
  return line;
}

function changePath(change: Change): string {
  if (!change.elided) return change.values.join(' -> ');
  return change.values[0] + ' -> ... -> ' + change.values[change.values.length - 1] +
    ' (' + change.transitions + ' changes)';
}

function stillText(settle: SettleOutcome): string {
  const still = [
    ...settle.moving.map((dev) => dev + ' in travel'),
    ...(settle.dialMrpm !== 0 ? [settle.dialHeld ? 'dial turning by hand' : 'dial motor turning'] : []),
    ...settle.chattering.map((dev) => dev + ' chattering'),
  ];
  return still.length === 0 ? 'observables still changing' : still.join(', ');
}

/** A batch that ran: one `ok` line per command, how the settle ended, notes, then what changed. */
function formatBatch(commands: readonly string[][], outcome: Extract<BatchOutcome, { ok: true }>, settleMs: number): string {
  const lines = commands.map((words, i) => describeOk(words, outcome.results[i] as Extract<ToolResult, { ok: true }>));
  if (outcome.settle.settled) lines.push('settled after ' + ms(outcome.settle.waitedTicks));
  else lines.push('did NOT settle within ' + settleMs + ' ms: ' + stillText(outcome.settle));
  if (outcome.settle.dialMrpm !== 0 && outcome.settle.dialHeld) {
    lines.push('note: dial still turning by hand toward its hold angle; settle does not wait for the dial, ' +
      'use wait <ms> to let it get there');
  } else if (outcome.settle.dialMrpm !== 0) {
    lines.push('note: dial motor still turning (' + String(outcome.settle.dialMrpm / 1000) +
      ' rpm); settle does not wait for the dial, use wait <ms> to let it run');
  }
  if (outcome.settle.lampsMoving.length > 0) {
    lines.push('note: lamp(s) ' + outcome.settle.lampsMoving.join(', ') +
      ' still warming/cooling; settle does not wait for lamp filaments (use wait)');
  }
  if (outcome.changes.length === 0) lines.push('changed: nothing');
  for (const change of outcome.changes) lines.push('changed: ' + change.name + ' ' + changePath(change));
  return lines.join('\n') + '\n';
}

/** The `state` text: time, every observable, then the cords. */
export function formatState(view: StateView): string {
  const lines = ['time ' + ms(view.tick) + ' (tick ' + view.tick + ')'];
  for (const row of view.observables) lines.push(row.name + ' ' + row.value);
  lines.push('cords ' + view.cords.length);
  for (const cord of view.cords) lines.push('cord ' + cord.id + ' ' + cord.wire + ' ' + holes(cord));
  return lines.join('\n') + '\n';
}

/** Help, and the calls refused on their words alone. */
export function renderLocal(invocation: LocalInvocation): CliResult {
  switch (invocation.kind) {
    case 'empty':
      return { code: 1, stdout: '', stderr: mainHelp(loadRepoProfile(DEFAULT_PROFILE)) };
    case 'help':
      return ok(invocation.topic === 'main' ? mainHelp(loadRepoProfile(DEFAULT_PROFILE)) : terminalsHelp(loadRepoNetlist()));
    case 'error':
      return error(invocation.message);
    case 'rejected':
      return rejected(invocation.label, invocation.result, '');
  }
}

export function renderNew(invocation: NewInvocation, reply: CreateReply): CliResult {
  const { path } = invocation;
  if (reply === 'exists') {
    return error(path + ' already exists; not overwriting. To start the wiring over, keep this session and send: ' + path + ' disconnect all');
  }
  return ok('created ' + path + ' (profile ' + invocation.session.profile + ', power off, no cords)\n');
}

export function renderState(invocation: StateInvocation, reply: StateReply): CliResult {
  if (reply === 'missing') return error(noSessionMessage(invocation.path));
  return ok(invocation.json ? JSON.stringify(reply.snapshot, null, 2) + '\n' : formatState(reply));
}

export function renderBatch(invocation: BatchInvocation, reply: BatchReply): CliResult {
  if (reply === 'missing') return error(noSessionMessage(invocation.path));
  if (!reply.ok) {
    // failedAt past the last command is the settle step: still reachable via the int32 tick limit.
    const words = invocation.commands[reply.failedAt];
    const label = words === undefined ? 'settle (--settle-ms ' + invocation.settleMs + ')' :
      'command ' + (reply.failedAt + 1) + ' (' + words.join(' ') + ')';
    return rejected(label, reply.result, '; nothing saved');
  }
  return ok(formatBatch(invocation.commands, reply, invocation.settleMs) + (invocation.showState ? formatState(reply.view) : ''));
}
