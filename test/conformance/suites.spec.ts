import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FIXTURE_ROOT,
  MANIFEST_PATH,
  buildManifest,
  fixtureFilesOnDisk,
  readManifest,
  serializeManifest,
  suiteOf,
} from './manifest.ts';
import { REPO_ROOT } from './helpers.ts';

const GOLDEN_ROOT = resolve(REPO_ROOT, 'test/conformance/golden');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function expectStep(tag?: 'unverified'): { k: string; tag?: string } {
  return tag === undefined ? { k: 'expect' } : { k: 'expect', tag };
}

describe('fixture manifest (docs/plans/phase-5-corpus.md, Step 1a)', () => {
  it('is byte-canonical', () => {
    expect(readFileSync(MANIFEST_PATH, 'utf8')).toBe(serializeManifest(readManifest()));
  });

  it('lists exactly the fixture files on disk, with their current bytes and suites', () => {
    // A failure here means a fixture was added, removed, edited or retagged without
    // `npm run gen-manifest` — read that diff, then regenerate.
    expect(readManifest().map((entry) => entry.path)).toEqual(fixtureFilesOnDisk());
    expect(readManifest()).toEqual(buildManifest());
  });

  it('puts every fixture in the directory its tier names, beside exactly one golden', () => {
    // bless.ts writes goldens by the `tier` field; parity, C# and Godot find them by directory.
    // Holding the two equal here is what lets both conventions keep working.
    const entries = readManifest();
    for (const entry of entries) {
      const fixture = JSON.parse(readFileSync(resolve(FIXTURE_ROOT, entry.path), 'utf8')) as {
        id: string;
        tier: string;
      };
      const [dir, file] = entry.path.split('/') as [string, string];
      expect(fixture.tier, entry.path).toBe(dir);
      expect(fixture.id + '.fixture.json', entry.path).toBe(file);
    }
    const traces = globSync('**/*.trace', { cwd: GOLDEN_ROOT }).map((path) => path.split('\\').join('/'));
    expect(traces.sort()).toEqual(entries.map((entry) => entry.path.replace(/\.fixture\.json$/, '.trace')).sort());
  });
});

describe('suiteOf', () => {
  it('is printed when any expect step is untagged', () => {
    expect(suiteOf({ script: [{ k: 'do' }, expectStep('unverified'), expectStep()] })).toBe('printed');
  });

  it('is speculative when every expect step is tagged', () => {
    expect(suiteOf({ script: [{ k: 'do' }, expectStep('unverified'), expectStep('unverified')] })).toBe('speculative');
  });

  it('is speculative with no expect step at all (digest-only C2)', () => {
    expect(suiteOf({ script: [{ k: 'do' }, { k: 'advance' }] })).toBe('speculative');
  });

  it('is printed when any until step is untagged, even with every expect tagged', () => {
    expect(suiteOf({ script: [{ k: 'do' }, { k: 'until' }] })).toBe('printed');
    expect(suiteOf({ script: [expectStep('unverified'), { k: 'until' }] })).toBe('printed');
  });

  it('is speculative when every expect and until step is tagged', () => {
    expect(suiteOf({
      script: [expectStep('unverified'), { k: 'until', tag: 'unverified' }, { k: 'settle' }],
    })).toBe('speculative');
  });
});

describe('buildManifest over a scratch tree', () => {
  function scratch(): string {
    const root = mkdtempSync(join(tmpdir(), 'mv601-manifest-'));
    roots.push(root);
    mkdirSync(join(root, 'A'));
    writeFileSync(join(root, 'A', 'X-ONE.fixture.json'), JSON.stringify({ script: [expectStep()] }));
    return root;
  }

  it('picks up a stray fixture file, so the committed manifest cannot silently omit one', () => {
    const root = scratch();
    expect(buildManifest(root).map((entry) => entry.path)).toEqual(['A/X-ONE.fixture.json']);
    writeFileSync(join(root, 'A', 'X-TWO.fixture.json'), JSON.stringify({ script: [] }));
    expect(buildManifest(root).map((entry) => [entry.path, entry.suite])).toEqual([
      ['A/X-ONE.fixture.json', 'printed'],
      ['A/X-TWO.fixture.json', 'speculative'],
    ]);
  });

  it('changes the sha on a one-byte edit', () => {
    const root = scratch();
    const before = buildManifest(root)[0]!.sha256;
    writeFileSync(join(root, 'A', 'X-ONE.fixture.json'), JSON.stringify({ script: [expectStep()] }) + ' ');
    expect(buildManifest(root)[0]!.sha256).not.toBe(before);
  });
});
