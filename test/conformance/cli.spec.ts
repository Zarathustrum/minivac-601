import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { REPO_ROOT } from './helpers.ts';
import { runFixture } from './run.ts';

const roots: string[] = [];
const cli = resolve(REPO_ROOT, 'bin/minivac-trace');

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeFixture(expected: 'off' | 'on' = 'off'): string {
  const root = mkdtempSync(join(tmpdir(), 'mv601-cli-'));
  roots.push(root);
  const path = join(root, 'case.fixture.json');
  writeFileSync(path, JSON.stringify({
    schema: 'minivac.fixture/1',
    id: 'CLI-CASE',
    source: 'cli test',
    tier: 'A',
    confidence: 'verified',
    profile: 'MV601-REF-A',
    contract: '1.1.0',
    as_printed: ['A/B'],
    errata_applied: [],
    wires: ['1A/1B'],
    script: [{
      k: 'expect', obs: [{ dev: 'power', v: expected }], cite: 'cli test', quote: 'Power state.',
    }],
  }) + '\n');
  return path;
}

describe('minivac-trace CLI', () => {
  it('writes byte-identical trace stdout and no diagnostics on success', () => {
    const path = writeFixture();
    const child = spawnSync(cli, [path], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(child.status).toBe(0);
    expect(child.stdout).toBe(runFixture(path).trace);
    expect(child.stderr).toBe('');
  });

  it('keeps a failed assertion as trace stdout and diagnostics-only stderr', () => {
    const path = writeFixture('on');
    const child = spawnSync(process.execPath, [cli, path], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(child.status).toBe(1);
    expect(child.stdout).toBe(runFixture(path).trace);
    expect(child.stderr).toMatch(/^minivac-trace: assertion failed at script\[0\] power:/);
  });

  it('reports an until timeout like a failed expect and exits 1', () => {
    const root = mkdtempSync(join(tmpdir(), 'mv601-cli-until-'));
    roots.push(root);
    const path = join(root, 'until.fixture.json');
    writeFileSync(path, JSON.stringify({
      schema: 'minivac.fixture/1', id: 'CLI-UNTIL', source: 'cli test', tier: 'A', confidence: 'verified',
      profile: 'MV601-REF-A', contract: '1.1.0', as_printed: ['A/B'], errata_applied: [], wires: ['1A/1B'],
      script: [
        { k: 'do', cmd: { k: 'switch', n: 1, target: 1000 } },
        { k: 'until', obs: [{ dev: 'sw1', v: 'mid' }], maxMs: 26, cite: 'cli test', quote: 'Moving.' },
      ],
    }) + '\n');
    const child = spawnSync(process.execPath, [cli, path], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(child.status).toBe(1);
    expect(child.stdout).toBe(runFixture(path).trace);
    expect(child.stderr).toBe('minivac-trace: assertion failed at script[1] sw1: expected mid, got nc\n');
  });

  it('writes validation failures only to stderr with non-zero exit', () => {
    const root = mkdtempSync(join(tmpdir(), 'mv601-cli-bad-'));
    roots.push(root);
    const path = join(root, 'bad.fixture.json');
    writeFileSync(path, '{}\n');
    const child = spawnSync(process.execPath, [cli, path], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(child.status).toBe(1);
    expect(child.stdout).toBe('');
    expect(child.stderr).toMatch(/^minivac-trace: fixture: schema validation failed:/);
  });

  it('supports the exact fallback-inventory switch without diagnostics', () => {
    const child = spawnSync(process.execPath, [cli, '--list-fallbacks'], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(child.status).toBe(0);
    expect(child.stderr).toBe('');
    for (const line of child.stdout.split('\n').filter(Boolean)) {
      expect(line.split('\t')).toHaveLength(4);
    }
  });

  it('rejects any other arity on stderr', () => {
    const child = spawnSync(process.execPath, [cli], { cwd: REPO_ROOT, encoding: 'utf8' });
    expect(child.status).toBe(1);
    expect(child.stdout).toBe('');
    expect(child.stderr).toContain('usage: minivac-trace');
  });
});
