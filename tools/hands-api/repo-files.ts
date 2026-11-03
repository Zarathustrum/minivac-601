// The model loop's read-only view of the repository (openai-loop.ts): which paths its file tools may
// read, and grep. A path is refused when it, or where its links lead, is outside the repo, in .git
// or node_modules (in any case: macOS folds case), hidden, or outside READABLE. grep runs in a worker thread with a
// time limit, so a pattern that backtracks without end (`(-*)*x` over a line of dashes) cannot hang
// the loop's process, and with it the chat pane's server: past the limit the worker is terminated.

import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

const REPO = resolve(new URL('../..', import.meta.url).pathname);
const REAL_REPO = realpathSync(REPO);
const MAX_GREP_HITS = 100;
const MAX_FILE_BYTES = 1_000_000;
export const GREP_TIMEOUT_MS = 10_000;

/**
 * The trees the file tools read: the manuals and their research, and the conformance fixtures,
 * the lookups the skill sends the model to. The simulator's source and the checklist's items are
 * not among them (Tom, DECISIONS 2026-11-03).
 */
export const READABLE: readonly string[] = Object.freeze(['docs/research', 'test/conformance/fixtures']);
const SCOPE = ' (the file tools read ' + READABLE.map((root) => root + '/').join(' and ') + ')';

/** A repo-relative path: in a readable tree, a directory on the way to one, or neither. */
function scope(rel: string): 'in' | 'above' | 'out' {
  if (READABLE.some((root) => rel === root || rel.startsWith(root + '/'))) return 'in';
  return rel === '' || READABLE.some((root) => root.startsWith(rel + '/')) ? 'above' : 'out';
}

function rule(rel: string): 'outside' | 'hidden' | 'unreadable' | null {
  const parts = rel.split('/');
  if (rel.startsWith('..') || parts.some((part) => part.toLowerCase() === '.git' || part.toLowerCase() === 'node_modules')) {
    return 'outside';
  }
  if (parts.some((part) => part.startsWith('.'))) return 'hidden';
  return scope(rel) === 'out' ? 'unreadable' : null;
}

/** Why `full` may not be read: by its own name, or by where its links lead; null when it may. */
function refusal(full: string): 'outside' | 'hidden' | 'unreadable' | null {
  const named = rule(relative(REPO, full));
  if (named !== null) return named;
  let real: string;
  try {
    real = realpathSync(full);
  } catch {
    // Missing: the read itself reports it.
    return null;
  }
  return rule(relative(REAL_REPO, real));
}

/** The absolute path of a repo path the file tools may read; throws when they may not. */
export function visibleInRepo(path: string): string {
  const full = resolve(REPO, path);
  const why = refusal(full);
  if (why === 'outside') throw new Error('path is outside the repository: ' + path);
  // Hidden files and directories (.claude, .gitignore, review-loop logs) are not the repo's
  // content, and the chat pane sends transcripts to a browser.
  if (why === 'hidden') throw new Error('path is hidden: ' + path);
  if (why === 'unreadable') throw new Error('path is not one the file tools read: ' + path + SCOPE);
  return full;
}

/** A directory's entries the file tools may name: none hidden, and above READABLE only the way down. */
export function listInRepo(path: string): string[] {
  const full = visibleInRepo(path);
  return readdirSync(full).filter((entry) => !entry.startsWith('.') && scope(relative(REPO, join(full, entry))) !== 'out').sort();
}

function grepFiles(pattern: string, start: string): string {
  const re = new RegExp(pattern, 'i');
  const hits: string[] = [];
  const walk = (path: string): void => {
    if (hits.length >= MAX_GREP_HITS) return;
    const name = path.split('/').pop() ?? '';
    // Hidden directories (.git, review-loop logs) and dependencies are not the repo's content; above
    // READABLE the walk goes only down into it.
    if (path !== start && (name.startsWith('.') || name.toLowerCase() === 'node_modules')) return;
    if (path !== start && scope(relative(REPO, path)) === 'out') return;
    // A link is followed only to where the file tools could read (AGENTS.md -> CLAUDE.md).
    if (path !== start && lstatSync(path).isSymbolicLink() && refusal(path) !== null) return;
    const info = statSync(path);
    if (info.isDirectory()) {
      for (const entry of readdirSync(path).sort()) walk(join(path, entry));
      return;
    }
    if (info.size > MAX_FILE_BYTES) return;
    const text = readFileSync(path, 'utf8');
    if (text.includes('\u0000')) return;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      if (hits.length < MAX_GREP_HITS && re.test(line)) {
        hits.push(relative(REPO, path) + ':' + (i + 1) + ': ' + line.slice(0, 300));
      }
    });
  };
  walk(start);
  return hits.length === 0 ? 'no matches' : hits.join('\n') +
    (hits.length >= MAX_GREP_HITS ? '\n[stopped at ' + MAX_GREP_HITS + ' matches]' : '');
}

type GrepAnswer = { ok: string } | { error: string };

/**
 * `pattern` (JavaScript syntax, ignoring case) over `start` (from `visibleInRepo`), in a worker
 * thread: `path:line: text` per match. Rejects with grep's own error, or once `timeoutMs` passes.
 */
export function grep(pattern: string, start: string, timeoutMs = GREP_TIMEOUT_MS): Promise<string> {
  return new Promise((done, failed) => {
    const worker = new Worker(new URL(import.meta.url), { workerData: { minivacGrep: { pattern, start } } });
    const settle = (finish: () => void): void => {
      clearTimeout(timer);
      worker.removeAllListeners();
      worker.on('error', () => { /* terminated */ });
      void worker.terminate();
      finish();
    };
    const timer = setTimeout(() => settle(() => failed(new Error('grep timed out after ' + timeoutMs / 1000 +
      ' s: use a simpler pattern'))), timeoutMs);
    worker.once('message', (answer: GrepAnswer) =>
      settle(() => ('ok' in answer ? done(answer.ok) : failed(new Error(answer.error)))));
    worker.once('error', (problem) => settle(() => failed(problem)));
    worker.once('exit', () => settle(() => failed(new Error('grep stopped before it answered'))));
  });
}

const task = (workerData as { minivacGrep?: { pattern: string; start: string } } | null)?.minivacGrep;
if (!isMainThread && task !== undefined) {
  let answer: GrepAnswer;
  try {
    answer = { ok: grepFiles(task.pattern, task.start) };
  } catch (problem: unknown) {
    answer = { error: problem instanceof Error ? problem.message : String(problem) };
  }
  parentPort?.postMessage(answer);
}
