import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readManifest } from './manifest.ts';
import { runFixture } from './run.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_ROOT = resolve(ROOT, 'test/conformance/fixtures');
const GOLDEN_ROOT = resolve(ROOT, 'test/conformance/golden');
const CASES = readManifest()
  .filter((entry) => entry.path.startsWith('C1/') || entry.path.startsWith('C2/'))
  .map((entry) => {
    const [tier, name] = entry.path.split('/') as [string, string];
    return { tier, id: name.slice(0, -'.fixture.json'.length), suite: entry.suite };
  });

describe('Tier-C fixture/golden integration', () => {
  it('owns a non-empty C1 and C2 set', () => {
    expect(CASES.some(({ tier }) => tier === 'C1')).toBe(true);
    expect(CASES.some(({ tier }) => tier === 'C2')).toBe(true);
  });

  it.each(CASES.map(({ suite, tier, id }) => [suite, tier, id] as const))(
    '[%s] %s/%s runs twice byte-identically and matches its golden',
    (_suite, tier, id) => {
      const path = resolve(FIXTURE_ROOT, tier, id + '.fixture.json');
      const first = runFixture(path);
      const second = runFixture(path);
      expect(first.failures).toEqual([]);
      expect(second.failures).toEqual([]);
      const firstBytes = Buffer.from(first.trace, 'utf8');
      expect(Buffer.from(second.trace, 'utf8')).toEqual(firstBytes);
      expect(readFileSync(resolve(GOLDEN_ROOT, tier, id + '.trace'))).toEqual(firstBytes);
    },
    // Motor programs simulate tens of seconds, past vitest's 5 s default. IV-APX-2BITADDER, the longest,
    // simulates 280 s of machine time (about 25 s of CPU per run, and the test runs it twice).
    180_000,
  );
});
