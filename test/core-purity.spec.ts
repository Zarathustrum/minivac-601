/** Static enforcement of architecture §1.1 and §13.4.9's core boundary. */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const CORE_DIR = new URL('../src/core/', import.meta.url);
const FORBIDDEN_GLOBAL = /\b(?:Date|document|performance|window)\b/u;
const FORBIDDEN_MATH =
  /\bMath\s*\.\s*(?:pow|exp|expm1|log|log2|log10|log1p|sqrt|cbrt|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|fround|random)\b/u;

function coreFiles(): string[] {
  return readdirSync(CORE_DIR)
    .filter((name) => name.endsWith('.ts'))
    .sort();
}

function maskedText(source: string): string {
  const blank = (text: string): string => text.replace(/[^\n]/gu, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, blank)
    .replace(/\/\/[^\n]*/gu, blank)
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/gsu, blank);
}

function blockEnd(source: string, open: number): number {
  let depth = 1;
  for (let at = open + 1; at < source.length; at++) {
    if (source[at] === '{') depth++;
    else if (source[at] === '}' && --depth === 0) return at;
  }
  return -1;
}

interface Body {
  readonly code: string;
  readonly machineMethod: boolean;
}

function machineBodies(source: string): Map<string, Body> {
  const masked = maskedText(source);
  const bodies = new Map<string, Body>();
  const functions = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::\s*[^;{]+)?\s*\{/gu;
  for (const match of masked.matchAll(functions)) {
    const open = (match.index as number) + match[0].lastIndexOf('{');
    const end = blockEnd(masked, open);
    if (end >= 0) bodies.set(match[1] as string, { code: masked.slice(open + 1, end), machineMethod: false });
  }

  const classMatch = /\bclass\s+[A-Za-z_$][\w$]*\s+implements\s+Machine\s*\{/u.exec(masked);
  if (classMatch === null) return bodies;
  const classOpen = classMatch.index + classMatch[0].lastIndexOf('{');
  const classEnd = blockEnd(masked, classOpen);
  const classBody = masked.slice(classOpen + 1, classEnd);
  const methods = /(?:^|\n)[ \t]*(?:(?:private|public|protected|static|async)\s+)*(constructor|[A-Za-z_$][\w$]*)\s*\([^;{}]*\)\s*(?::\s*[^;{]+)?\s*\{/gu;
  for (const match of classBody.matchAll(methods)) {
    let depth = 0;
    for (let at = 0; at < (match.index as number); at++) {
      if (classBody[at] === '{') depth++;
      else if (classBody[at] === '}') depth--;
    }
    if (depth !== 0) continue;
    const open = (match.index as number) + match[0].lastIndexOf('{');
    const end = blockEnd(classBody, open);
    if (end >= 0) bodies.set(match[1] as string, { code: classBody.slice(open + 1, end), machineMethod: true });
  }
  return bodies;
}

function reachable(bodies: ReadonlyMap<string, Body>, roots: readonly string[]): Set<string> {
  const found = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const name = pending.pop() as string;
    if (found.has(name)) continue;
    const body = bodies.get(name);
    if (body === undefined) continue;
    found.add(name);
    for (const match of body.code.matchAll(/\b(?:this\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(/gu)) {
      const called = match[1] as string;
      if (bodies.has(called) && !found.has(called)) pending.push(called);
    }
  }
  return found;
}

describe('the portable core boundary', () => {
  it('keeps every current and future core module inside src/core with zero package dependencies', () => {
    const violations: string[] = [];
    for (const name of coreFiles()) {
      const source = readFileSync(new URL(name, CORE_DIR), 'utf8');
      const imports = source.matchAll(
        /^[ \t]*(?:import|export)\b(?:[^;]*?\bfrom[ \t]*)?['"]([^'"]+)['"][ \t]*;/gmu,
      );
      for (const match of imports) {
        const specifier = match[1] as string;
        if (!specifier.startsWith('./')) violations.push(name + ': import escapes core: ' + specifier);
      }
      if (/\bimport\s*\(/u.test(maskedText(source))) {
        violations.push(name + ': dynamic import escapes the static core graph');
      }
    }
    expect(coreFiles().length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
  });

  it('contains no executable DOM, clock, RNG or transcendental reference', () => {
    const violations: string[] = [];
    for (const name of coreFiles()) {
      const executable = maskedText(readFileSync(new URL(name, CORE_DIR), 'utf8'));
      const global = executable.match(FORBIDDEN_GLOBAL)?.[0];
      const math = executable.match(FORBIDDEN_MATH)?.[0];
      if (global !== undefined) violations.push(name + ': forbidden global ' + global);
      if (math !== undefined) violations.push(name + ': forbidden operation ' + math.replace(/\s/gu, ''));
    }
    expect(violations).toEqual([]);
  });

  it('keeps Machine runtime paths on fixed storage and in-place graph/solve entry points', () => {
    const machineUrl = new URL('machine.ts', CORE_DIR);
    if (!coreFiles().includes('machine.ts')) return;

    const source = readFileSync(machineUrl, 'utf8');
    const executable = maskedText(source);
    expect(executable).not.toMatch(/\b(?:buildGraph|tickSolve)\s*\(/u);
    expect(executable).not.toMatch(/\bBigInt\b|\b\d+n\b/u);

    const bodies = machineBodies(source);
    expect(bodies.has('advance')).toBe(true);
    expect(bodies.has('observables')).toBe(true);
    const constructionOnly = reachable(bodies, ['constructor', 'apply', 'snapshot', 'drainEvents']);
    const runtime = reachable(bodies, ['advance', 'observables']);
    for (const [name, body] of bodies) {
      if (body.machineMethod && !constructionOnly.has(name)) runtime.add(name);
    }
    const runtimeCode = Array.from(runtime, (name) => bodies.get(name)?.code ?? '').join('\n');
    expect(runtimeCode).not.toMatch(/\bnew\s+(?!(?:Error|RangeError)\b)[A-Za-z_$][\w$]*/u);
    expect(runtimeCode).not.toMatch(/(?:^|[=(,])\s*[\[{]|\breturn\s*[\[{]/u);
    expect(runtimeCode).not.toMatch(/=>|\bfunction\b/u);
    expect(runtimeCode).not.toMatch(
      /\bArray\s*\.\s*(?:from|of)\s*\(|\bObject\s*\.\s*(?:create|assign|fromEntries)\s*\(|\.(?:map|filter|flatMap|slice|concat)\s*\(/u,
    );
  });
});
