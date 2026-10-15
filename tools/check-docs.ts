/**
 * Documentation residue gate: flags lines in the scanned docs that match a
 * `docs/mechanism-claims.json` rule and are not on its anchored allow list.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST_PATH = join(ROOT, 'docs/mechanism-claims.json');

interface Rule {
  id: string;
  pattern: string;
  flags: string;
  guidance: string;
}

interface Allow {
  path: string;
  line: string;
  reason: string;
}

interface Manifest {
  schema: 'minivac.mechanism-claims/1';
  scan: { roots: string[]; extensions: string[]; exclude: string[] };
  rules: Rule[];
  allow: Allow[];
}

export interface Finding {
  rule: string;
  path: string;
  line: number;
  text: string;
  guidance: string;
}

export interface CheckResult {
  findings: Finding[];
  anchoredAllows: number;
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as Manifest;
}

/** Paths stay POSIX-separated so manifest excludes and allow keys match on every platform. */
function walk(root: string, extensions: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, root), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const child = root + '/' + entry.name;
    if (entry.isDirectory()) out.push(...walk(child, extensions));
    else if (entry.isFile() && extensions.some((extension) => entry.name.endsWith(extension))) out.push(child);
  }
  return out;
}

function isExcluded(path: string, excludes: readonly string[]): boolean {
  return excludes.some((exclude) => {
    const prefix = exclude.endsWith('/**') ? exclude.slice(0, -3) : exclude;
    return path === prefix || path.startsWith(prefix + '/');
  });
}

function allowKey(path: string, line: string): string {
  return path + '\u0000' + line;
}

function validateJson(path: string, content: string): void {
  try {
    JSON.parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`mechanism-claims could not parse ${path}: ${detail}`);
  }
}

function findingFor(
  rule: Rule,
  path: string,
  line: number,
  text: string,
): Finding {
  return { rule: rule.id, path, line, text, guidance: rule.guidance };
}

function addFinding(findings: Finding[], finding: Finding): void {
  if (!findings.some((existing) =>
    existing.rule === finding.rule && existing.path === finding.path && existing.line === finding.line && existing.text === finding.text,
  )) findings.push(finding);
}

interface DocumentView {
  /** The document as written; findings quote and number lines from it. */
  source: string;
  /** Every whitespace run collapsed to one space, so a wrapped restatement cannot evade a rule. */
  view: string;
  /** origin[i] is the source index the view's character i came from. */
  origin: number[];
}

function buildView(content: string): DocumentView {
  // Runs of text are copied by slice and joined once, and origin is filled into a
  // preallocated array. The obvious per-character `view += character` costs ~3.9s
  // over this repo's multi-megabyte docs corpus — enough to time the spec out.
  const chunks: string[] = [];
  const origin: number[] = new Array(content.length);
  let length = 0;
  let lastIsSpace = false;
  let cursor = 0;

  const emitText = (start: number, end: number): void => {
    if (end <= start) return;
    chunks.push(content.slice(start, end));
    for (let index = start; index < end; index += 1) {
      origin[length] = index;
      length += 1;
    }
    lastIsSpace = false;
  };

  const whitespace = /[ \t\n\r]+/g;
  for (let match = whitespace.exec(content); match !== null; match = whitespace.exec(content)) {
    emitText(cursor, match.index);
    // A run collapses to one space, which maps to the run's first source index.
    // Leading whitespace emits nothing, so the view never starts with a space.
    if (length > 0 && !lastIsSpace) {
      chunks.push(' ');
      origin[length] = match.index;
      length += 1;
      lastIsSpace = true;
    }
    cursor = match.index + match[0].length;
  }
  emitText(cursor, content.length);

  origin.length = length;
  return { source: content, view: chunks.join(''), origin };
}

function scanRules(
  manifest: Manifest,
  allows: ReadonlyMap<string, Allow>,
  path: string,
  document: DocumentView,
  findings: Finding[],
  ruleIds?: readonly string[],
): void {
  const { source, view, origin } = document;
  for (const rule of manifest.rules) {
    if (ruleIds !== undefined && !ruleIds.includes(rule.id)) continue;
    const flags = rule.flags.includes('g') ? rule.flags : rule.flags + 'g';
    const pattern = new RegExp(rule.pattern, flags);
    for (let match = pattern.exec(view); match !== null; match = pattern.exec(view)) {
      if (match[0].length === 0) pattern.lastIndex += 1;
      const index = origin[match.index] ?? source.length;
      const line = source.slice(0, index).split('\n').length;
      const lineStart = source.lastIndexOf('\n', index) + 1;
      const lineEnd = source.indexOf('\n', index);
      const text = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
      if (!allows.has(allowKey(path, text))) addFinding(findings, findingFor(rule, path, line, text));
    }
  }
}

function scanJsonContent(
  manifest: Manifest,
  allows: ReadonlyMap<string, Allow>,
  path: string,
  content: string,
  foundAllows?: Set<string>,
): Finding[] {
  validateJson(path, content);
  const findings: Finding[] = [];
  const lines = content.split('\n');

  for (const text of lines) {
    const key = allowKey(path, text);
    if (allows.has(key)) foundAllows?.add(key);
  }

  scanRules(manifest, allows, path, buildView(content), findings, ['legacy-dv-vector']);

  let line = 1;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '\n') {
      line += 1;
      continue;
    }
    if (character !== '"') continue;

    const start = index;
    const startLine = line;
    index += 1;
    while (index < content.length) {
      if (content[index] === '\\') {
        index += 2;
        continue;
      }
      if (content[index] === '"') break;
      index += 1;
    }

    const decoded = JSON.parse(content.slice(start, index + 1)) as string;
    const text = lines[startLine - 1] ?? decoded;
    const key = allowKey(path, text);
    for (const rule of manifest.rules) {
      if (!new RegExp(rule.pattern, rule.flags).test(decoded) || allows.has(key)) continue;
      addFinding(findings, findingFor(rule, path, startLine, text));
    }
  }
  return findings;
}

function scanContent(
  manifest: Manifest,
  allows: ReadonlyMap<string, Allow>,
  path: string,
  content: string,
  foundAllows?: Set<string>,
): Finding[] {
  if (path.endsWith('.json')) {
    return scanJsonContent(manifest, allows, path, content, foundAllows);
  }
  const findings: Finding[] = [];
  for (const text of content.split('\n')) {
    const key = allowKey(path, text);
    if (allows.has(key)) foundAllows?.add(key);
  }
  scanRules(manifest, allows, path, buildView(content), findings);
  return findings;
}

/** Checks an in-memory Markdown or JSON document with the production rules. */
export function checkText(path: string, content: string): Finding[] {
  const manifest = loadManifest();
  const allows = new Map<string, Allow>(
    manifest.allow.map((allow) => [allowKey(allow.path, allow.line), allow]),
  );
  return scanContent(manifest, allows, path, content);
}

/** Runs the manifest over the source tree; callers decide whether findings make their command fail. */
export function checkDocs(): CheckResult {
  const manifest = loadManifest();
  if (manifest.schema !== 'minivac.mechanism-claims/1') throw new Error(`unsupported manifest schema: ${manifest.schema}`);

  const files = manifest.scan.roots.flatMap((root) => walk(root, manifest.scan.extensions))
    .filter((path) => !isExcluded(path, manifest.scan.exclude))
    .sort();
  const allows = new Map<string, Allow>(
    manifest.allow.map((allow) => [allowKey(allow.path, allow.line), allow]),
  );
  const foundAllows = new Set<string>();
  const findings: Finding[] = [];

  for (const path of files) {
    findings.push(...scanContent(manifest, allows, path, readFileSync(join(ROOT, path), 'utf8'), foundAllows));
  }

  const missingAllows = [...allows.entries()].filter(([key]) => !foundAllows.has(key));
  if (missingAllows.length > 0) {
    const names = missingAllows.map(([, allow]) => `${allow.path}: ${allow.reason}`).join('\n');
    throw new Error(`mechanism-claims allow anchor missing or changed:\n${names}`);
  }
  return { findings, anchoredAllows: foundAllows.size };
}

function main(): void {
  const result = checkDocs();
  for (const finding of result.findings) {
    process.stdout.write(`${finding.path}:${finding.line} [${finding.rule}] ${finding.guidance}\n`);
    process.stdout.write(`  ${finding.text}\n`);
  }
  process.stdout.write(`check-docs: ${result.findings.length} finding(s); ${result.anchoredAllows} exact allow anchor(s) verified\n`);
  if (result.findings.length > 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
