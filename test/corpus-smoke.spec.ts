/** `tools/corpus-smoke.ts`: determinism, a hand-built short, and I-EXP1. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  SMOKE_JSON_PATH,
  SMOKE_MD_PATH,
  buildSmoke,
  renderMarkdown,
  serializeSmoke,
  smokeWires,
} from '../tools/corpus-smoke.ts';

describe('corpus smoke', () => {
  const results = buildSmoke();

  it('is byte-identical across runs and matches the checked-in files', () => {
    const again = buildSmoke();
    expect(serializeSmoke(again)).toBe(serializeSmoke(results));
    expect(renderMarkdown(again)).toBe(renderMarkdown(results));
    expect(readFileSync(SMOKE_JSON_PATH, 'utf8')).toBe(serializeSmoke(results));
    expect(readFileSync(SMOKE_MD_PATH, 'utf8')).toBe(renderMarkdown(results));
  }, 30_000);

  it('classifies a hand-built 1+/1- short as trip', () => {
    const r = smokeWires('SHORT', ['1+/1-']);
    expect(r.class).toBe('trip');
    expect(r.phases[0]!.trips).toBeGreaterThan(0);
  });

  it('classifies I-EXP1 as ok', () => {
    const r = results.find((x) => x.id === 'I-EXP1')!;
    expect(r.class).toBe('ok');
    expect(r.phases.length).toBeGreaterThan(0);
  });

  it('sees a running motor: I-EXP14 reports a non-zero dial speed after settle', () => {
    expect(results.find((r) => r.id === 'I-EXP14')!.phases[0]!.motorMrpm).not.toBe(0);
  });

  it('does not re-trip a release: V-EXP16 trips on the pb5 press only', () => {
    const r = results.find((x) => x.id === 'V-EXP16')!;
    expect(r.phases.find((p) => p.phase === 'pb5 press')!.trips).toBeGreaterThan(0);
    expect(r.phases.find((p) => p.phase === 'pb5 release')!.trips).toBe(0);
  });

  it('covers every corpus program in order, skipped ones with a reason', () => {
    expect(results.length).toBe(102);
    for (const r of results) if (r.class === 'skipped') expect(r.reason).toBeTruthy();
  });
});
