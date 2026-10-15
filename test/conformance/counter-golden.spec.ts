import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runStaticGate } from '../../tools/check-netlist.ts';
import { loadFixture } from './helpers.ts';
import { readManifest } from './manifest.ts';
import { runFixture, runLoadedFixture } from './run.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_DIR = resolve(ROOT, 'test/conformance/fixtures/B');
const GOLDEN_DIR = resolve(ROOT, 'test/conformance/golden/B');
const ENTRIES = readManifest()
  .filter((entry) => entry.path.startsWith('B/'))
  .map((entry) => ({ id: entry.path.slice('B/'.length, -'.fixture.json'.length), suite: entry.suite }))
  .filter(({ id }) => id.startsWith('IV-EXP1-') || id === 'ER-ALTCOUNTER');
const IDS = ENTRIES.map((entry) => entry.id);
const METRICS: Readonly<Record<string, { minDecisionUa: number; minTickGap: number }>> = Object.freeze({
  'IV-EXP1-SLOW': Object.freeze({ minDecisionUa: 24, minTickGap: 9 }),
  'IV-EXP1-FAST': Object.freeze({ minDecisionUa: 8, minTickGap: 9 }),
  // Phase 5 Step 7 speculative fixture (FALLBACK-DERIVED-TOPOLOGY); its knife-edge trip held under BLESS-ROBUSTNESS.
  'IV-EXP1-DERIVED': Object.freeze({ minDecisionUa: 0, minTickGap: 9 }),
  'ER-ALTCOUNTER': Object.freeze({ minDecisionUa: 65, minTickGap: 9 }),
});

describe('W6 counter fixture/golden integration', () => {
  it('owns a non-empty set of counter fixtures', () => {
    expect(ENTRIES.length).toBeGreaterThan(0);
    for (const id of Object.keys(METRICS)) expect(IDS, id).toContain(id);
  });

  it.each(ENTRIES.map(({ suite, id }) => [suite, id] as const))(
    '[%s] %s runs twice byte-identically and matches its golden',
    (_suite, id) => {
      const path = resolve(FIXTURE_DIR, id + '.fixture.json');
      const first = runFixture(path);
      const second = runFixture(path);
      expect(first.failures).toEqual([]);
      expect(second.failures).toEqual([]);
      expect(first.metrics).toEqual(METRICS[id]);
      const bytes = Buffer.from(first.trace, 'utf8');
      expect(Buffer.from(second.trace, 'utf8')).toEqual(bytes);
      expect(readFileSync(resolve(GOLDEN_DIR, id + '.trace'))).toEqual(bytes);
    },
  );

  it('makes every counter fail when its release edges are collapsed', () => {
    for (const id of IDS) {
      const loaded = loadFixture(resolve(FIXTURE_DIR, id + '.fixture.json'));
      const script = loaded.fixture.script.filter((step) => !(step.k === 'do' && step.collapse === true));
      const collapsed = runLoadedFixture({
        ...loaded,
        fixture: { ...loaded.fixture, script },
      });
      expect(collapsed.failures.length, id).toBeGreaterThan(0);
    }
  });

  it('records no count-4 wrong/right discriminator under the shipped dynamic model', () => {
    const staticRows = runStaticGate().rows;
    expect(staticRows.map((row) => [row.id, row.tuple])).toEqual([
      ['IV-EXP1', '111'],
      ['ER-ALTCOUNTER', '101'],
    ]);

    for (const id of ['IV-EXP1-FAST', 'ER-ALTCOUNTER'] as const) {
      const result = runFixture(resolve(FIXTURE_DIR, id + '.fixture.json'));
      const finalCheckpoint = result.trace.split('\n').filter((line) => line.includes(' ? ')).at(-1);
      expect(finalCheckpoint, id).toContain('outLamp4=off outLamp5=dim outLamp6=dim');
      expect(finalCheckpoint, id).not.toContain('outLamp4=on outLamp5=off outLamp6=off');
    }
    const discriminatorFiles = readdirSync(resolve(ROOT, 'test/conformance'), { recursive: true })
      .filter((name): name is string => typeof name === 'string')
      .filter((name) => name.toLowerCase().includes('at-02') && name.toLowerCase().includes('discriminator'));
    expect(discriminatorFiles).toEqual([]);
  });
});
