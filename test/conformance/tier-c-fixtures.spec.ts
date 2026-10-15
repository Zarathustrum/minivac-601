import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { assertBlessable } from './bless.ts';
import { digestEqual, loadFixture } from './helpers.ts';
import { runFixture } from './run.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const C1_PATH = ROOT + '/test/conformance/fixtures/C1/I-EXP11.fixture.json';
const C2_IDS = ['I-EXP12', 'I-EXP13', 'I-EXP14'] as const;
const roots: string[] = [];

function c2Path(id: (typeof C2_IDS)[number]): string {
  return ROOT + '/test/conformance/fixtures/C2/' + id + '.fixture.json';
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('I-EXP11 manual rotary conformance', () => {
  it('rests in a sourced dead gap and integrates every make/break across 180 degrees', () => {
    const first = runFixture(C1_PATH);
    const second = runFixture(C1_PATH);
    expect(first.failures).toEqual([]);
    expect(second.failures).toEqual([]);
    expect(second.trace).toBe(first.trace);
    expect(second.digest).toEqual(first.digest);
    expect(first.trace.match(/\? dial=gap /g)).toHaveLength(2);

    const lines = first.trace.split('\n');
    const sweepStart = lines.findIndex((line) => line.includes('dialGrab targetUdeg=326250000'));
    expect(sweepStart).toBeGreaterThan(0);
    const sweep = lines.slice(sweepStart)
      .filter((line) => line.includes(' * dial '))
      .map((line) => line.slice(line.indexOf('dial ') + 5));
    expect(sweep).toEqual([
      'gap->c7', 'c7->gap',
      'gap->c8', 'c8->gap',
      'gap->c9', 'c9->gap',
      'gap->c10', 'c10->gap',
      'gap->c11', 'c11->gap',
      'gap->c12', 'c12->gap',
      'gap->c13', 'c13->gap',
      'gap->c14', 'c14->gap',
    ]);
  });
});

describe('C2 digest-only conformance', () => {
  it('runs twice identically and matches every reviewed digest member', () => {
    for (const id of C2_IDS) {
      const first = runFixture(c2Path(id));
      const second = runFixture(c2Path(id));
      expect(first.failures, id).toEqual([]);
      expect(second.failures, id).toEqual([]);
      expect(second.trace, id).toBe(first.trace);
      expect(second.digest, id).toEqual(first.digest);
      expect(first.trace, id).not.toContain(' ! dial chatter ');
      expect(first.loaded.fixture.digest, id).toBeDefined();
      expect(digestEqual(first.digest, first.loaded.fixture.digest!), id).toBe(true);
      expect(() => assertBlessable(first), id).not.toThrow();
    }
    // The upgraded printed I-EXP12..14 run long motor windows twice; under full-suite load that
    // passes vitest's 5 s default.
  }, 60_000);

  it('schema-accepts expect and until added to each actual C2 fixture, which still needs its digest', () => {
    for (const id of C2_IDS) {
      const raw = JSON.parse(readFileSync(c2Path(id), 'utf8')) as Record<string, unknown>;
      const script = raw['script'] as unknown[];
      script.push({
        k: 'expect',
        obs: [{ dev: 'dial', v: 'c0' }],
        cite: 'schema case',
        quote: 'schema case',
      }, {
        k: 'until',
        obs: [{ dev: 'dial', v: 'c0' }],
        maxMs: 1,
        cite: 'schema case',
        quote: 'schema case',
      });
      const root = mkdtempSync(join(tmpdir(), 'mv601-c2-schema-'));
      roots.push(root);
      const path = join(root, id + '.fixture.json');
      writeFileSync(path, JSON.stringify(raw) + '\n');
      expect(() => loadFixture(path), id).not.toThrow();
      delete raw['digest'];
      writeFileSync(path, JSON.stringify(raw) + '\n');
      expect(() => loadFixture(path), id + ' without digest').toThrow(/schema validation failed/);
    }
  });

  it('refuses independent event-count and mover-transition drift', () => {
    for (const id of C2_IDS) {
      const eventDrift = runFixture(c2Path(id));
      eventDrift.digest.eventCount++;
      expect(() => assertBlessable(eventDrift), id + ' eventCount').toThrow(/C2 digest differs/);

      const moverDrift = runFixture(c2Path(id));
      moverDrift.digest.moverTransitions[18] =
        (moverDrift.digest.moverTransitions[18] as number) + 1;
      expect(() => assertBlessable(moverDrift), id + ' moverTransitions').toThrow(/C2 digest differs/);
    }
  }, 60_000);
});
