import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SYNC = join(ROOT, 'tools/sync-data.ts');

const COPIES: readonly [string, string][] = [
  ['data', 'data'],
  ['test/conformance/fixtures', 'conformance/fixtures'],
  ['test/conformance/golden', 'conformance/golden'],
  ['test/conformance/probes', 'conformance/probes'],
  ['test/conformance/fixture.schema.json', 'conformance/fixture.schema.json'],
  ['test/conformance/probe.schema.json', 'conformance/probe.schema.json'],
  ['public/audio', 'audio'],
];

function bytesByPath(root: string, include = (_path: string): boolean => true): Record<string, string> {
  const out: Record<string, string> = {};
  if (statSync(root).isFile()) {
    out[''] = createHash('sha256').update(readFileSync(root)).digest('hex');
    return out;
  }
  const walk = (directory: string, relative: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = relative === '' ? entry.name : relative + '/' + entry.name;
      const child = join(directory, entry.name);
      if (entry.isDirectory()) walk(child, childRelative);
    else if (entry.isFile() && include(childRelative)) {
      out[childRelative] = createHash('sha256').update(readFileSync(child)).digest('hex');
    }
    }
  };
  walk(root, '');
  return out;
}

describe('G0 data synchronizer', () => {
  it('mirrors each prescribed source byte-for-byte and is content-idempotent', () => {
    const target = mkdtempSync(join(tmpdir(), 'minivac-sync-data-'));
    try {
      const run = (): void => {
        execFileSync(process.execPath, [SYNC], {
          cwd: ROOT,
          env: { ...process.env, MINIVAC_GODOT_DIR: target },
          stdio: 'pipe',
        });
      };

      run();
      for (const [source, destination] of COPIES) {
        expect(bytesByPath(join(target, destination))).toEqual(bytesByPath(join(ROOT, source)));
      }
      const first = bytesByPath(target);
      run();
      expect(bytesByPath(target)).toEqual(first);

      for (const [source, destination] of COPIES) {
        const audio = destination === 'audio';
        const include = audio ? (path: string): boolean => path.endsWith('.wav') : undefined;
        expect(bytesByPath(join(ROOT, 'godot', destination), include)).toEqual(bytesByPath(join(ROOT, source), include));
      }
    } finally {
      rmSync(target, { recursive: true, force: true });
    }
  });

  it('refuses an override that overlaps an authoritative source', () => {
    expect(() => execFileSync(process.execPath, [SYNC], {
      cwd: ROOT,
      env: { ...process.env, MINIVAC_GODOT_DIR: ROOT },
      stdio: 'pipe',
    })).toThrow(/destination overlaps source/);
  });
});
