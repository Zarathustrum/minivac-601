// tools/check-dist.ts: the public build holds nothing of the dev-only chat pane.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { distProblems } from '../tools/check-dist.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function dist(files: Record<string, string | Uint8Array>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mv601-dist-'));
  dirs.push(dir);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  return dir;
}

describe('check-dist', () => {
  it('passes a build with no trace of the pane', () => {
    expect(distProblems(dist({ 'index.html': '<div id="app"></div>', 'assets/index.js': 'startApp();', 'audio/click.wav': new Uint8Array([0, 1, 2]) })))
      .toEqual([]);
  });

  it('finds dev.html, and each pane string in any file, at any depth', () => {
    expect(distProblems(dist({
      'dev.html': '<aside id="pane"></aside>',
      'index.html': '<div id="app"></div>',
      'assets/a.js': 'process.env.MINIVAC_LLM_API_KEY',
      'assets/deep/b.js': '// tools/hands-pane/server.ts',
      'assets/c.css': '/* src/pane/pane.css */',
      'audio/d.bin': new Uint8Array([0, ...new TextEncoder().encode('src/pane'), 0]),
    }))).toEqual([
      'dist/assets/a.js names MINIVAC_LLM',
      'dist/assets/c.css names src/pane',
      'dist/assets/deep/b.js names hands-pane',
      'dist/audio/d.bin names src/pane',
      'dist/dev.html is in the build',
    ]);
  });

  it('runs after every npm run build', () => {
    const scripts = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts.build).toBe('vite build');
    expect(scripts.postbuild).toBe('node tools/check-dist.ts');
  });
});
