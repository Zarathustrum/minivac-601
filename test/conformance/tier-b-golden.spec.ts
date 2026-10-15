import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readManifest } from './manifest.ts';
import { runFixture } from './run.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_DIR = resolve(ROOT, 'test/conformance/fixtures/B');
const GOLDEN_DIR = resolve(ROOT, 'test/conformance/golden/B');
// Counter variants (IV-EXP1-*, ER-ALTCOUNTER) are owned by counter-golden.spec.ts.
const isCounter = (id: string): boolean => id.startsWith('IV-EXP1-') || id === 'ER-ALTCOUNTER';
const ENTRIES = readManifest()
  .filter((entry) => entry.path.startsWith('B/'))
  .map((entry) => ({ id: entry.path.slice('B/'.length, -'.fixture.json'.length), suite: entry.suite }))
  .filter((entry) => !isCounter(entry.id));

describe('Tier-B fixture/golden integration', () => {
  it('owns a non-empty set of non-counter B fixtures', () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
  });

  it.each(ENTRIES.map(({ suite, id }) => [suite, id] as const))(
    '[%s] %s runs twice byte-identically and matches its golden',
    (_suite, id) => {
      const path = resolve(FIXTURE_DIR, id + '.fixture.json');
      const first = runFixture(path);
      const second = runFixture(path);
      expect(first.failures).toEqual([]);
      expect(second.failures).toEqual([]);
      const firstBytes = Buffer.from(first.trace, 'utf8');
      expect(Buffer.from(second.trace, 'utf8')).toEqual(firstBytes);
      expect(readFileSync(resolve(GOLDEN_DIR, id + '.trace'))).toEqual(firstBytes);
    },
    // Step 7 speculative fixtures exercise many cases (VI-COMBOLOCK-DERIVED runs past vitest's 5 s default twice).
    60_000,
  );
});
