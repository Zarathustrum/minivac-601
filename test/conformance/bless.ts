import { globSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digestEqual, loadFixture, REPO_ROOT } from './helpers.ts';
import { checkRobustness } from './robust.ts';
import type { RobustnessOptions } from './robust.ts';
import { runFixture } from './run.ts';
import type { RunResult } from './types.ts';

function fail(message: string): never {
  throw new Error('bless: ' + message);
}

export interface BlessOptions extends RobustnessOptions {
  /** Where the one robustness success line goes; stderr by default, so stdout stays the path. */
  readonly log?: (line: string) => void;
}

/**
 * The two numeric knife-edge gates are triggers (DECISIONS.md 2026-10-13, architecture §9.3): a
 * non-marginal fixture that trips one is refused only if an assert fails under one of the
 * BLESS-ROBUSTNESS perturbations (`robust.ts`). A declared marginal fixture skips both.
 */
export function assertBlessable(result: RunResult, options: BlessOptions = {}): void {
  if (result.failures.length > 0) {
    const first = result.failures[0] as RunResult['failures'][number];
    fail('assertion failed at script[' + first.scriptIndex + '] ' + first.dev +
      ': expected ' + first.expected + ', got ' + first.actual);
  }

  const fixture = result.loaded.fixture;
  const profile = result.loaded.profile;
  const marginal = fixture.marginal === true;
  const trips: string[] = [];
  if (result.metrics.minDecisionUa !== null &&
      result.metrics.minDecisionUa < profile.v.min_decision_ua && !marginal) {
    trips.push('minDecisionUa ' + result.metrics.minDecisionUa +
      ' is below profile minimum ' + profile.v.min_decision_ua);
  }
  if (result.metrics.minTickGap !== null &&
      result.metrics.minTickGap < profile.v.min_tick_gap && !marginal) {
    trips.push('minTickGap ' + result.metrics.minTickGap +
      ' is below profile minimum ' + profile.v.min_tick_gap);
  }
  let held: string | null = null;
  if (trips.length > 0) {
    const trip = trips.join(' and ');
    // Tom's ruling (DECISIONS 2026-10-14): with no assert, every perturbation would
    // hold vacuously, so a tripped fixture with no expect or until step is refused as before the ruling.
    if (!fixture.script.some((step) => step.k === 'expect' || step.k === 'until')) {
      fail(trip + ', and the fixture has no expect or until step for the robustness check to hold');
    }
    const outcomes = checkRobustness(result.loaded, options);
    const failed = outcomes.find((outcome) => outcome.failure !== null);
    if (failed !== undefined) {
      fail(trip + ', and the robustness check failed under ' + failed.name + ': ' + failed.failure);
    }
    held = 'bless: ' + fixture.id + ' tripped (' + trip + '); all ' + outcomes.length +
      ' robustness perturbations held';
  }
  if (fixture.tier === 'C2') {
    const reviewed = fixture.digest;
    if (reviewed === undefined || !digestEqual(result.digest, reviewed)) {
      fail('computed C2 digest differs from reviewed fixture digest');
    }
  }
  if (held !== null) {
    const log = options.log ?? ((line: string) => { process.stderr.write(line + '\n'); });
    log(held);
  }
}

export function blessPath(fixturePath: string, goldenPath: string): string {
  const result = runFixture(fixturePath);
  return writeBlessed(result, goldenPath);
}

export function writeBlessed(result: RunResult, goldenPath: string, options: BlessOptions = {}): string {
  assertBlessable(result, options);
  mkdirSync(dirname(goldenPath), { recursive: true });
  writeFileSync(goldenPath, result.trace, { encoding: 'utf8' });
  return goldenPath;
}

export function findFixtureById(id: string): string {
  if (id.length === 0) fail('fixture id is empty');
  const root = resolve(REPO_ROOT, 'test/conformance/fixtures');
  const matches: string[] = [];
  for (const relativePath of globSync('**/*.fixture.json', { cwd: root })) {
    const path = resolve(root, relativePath);
    const file = loadFixture(path).fixture;
    if (file.id === id) matches.push(path);
  }
  if (matches.length !== 1) fail('fixture id ' + JSON.stringify(id) + ' resolved to ' + matches.length + ' files');
  return matches[0] as string;
}

export function blessFixture(id: string): string {
  const fixturePath = findFixtureById(id);
  const result = runFixture(fixturePath);
  const fixture = result.loaded.fixture;
  const goldenRoot = resolve(REPO_ROOT, 'test/conformance/golden');
  const goldenPath = resolve(goldenRoot, fixture.tier, fixture.id + '.trace');
  if (!goldenPath.startsWith(goldenRoot + sep)) fail('fixture id escapes the golden directory');
  return writeBlessed(result, goldenPath);
}

function main(): void {
  const id = process.argv[2];
  if (id === undefined || process.argv.length !== 3) fail('usage: npm run bless -- <id>');
  const path = blessFixture(id);
  process.stdout.write(path + '\n');
}

const invoked = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invoked) {
  try {
    main();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(message + '\n');
    process.exitCode = 1;
  }
}
