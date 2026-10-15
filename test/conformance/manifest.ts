/**
 * `fixtures/manifest.json` — the one fixture inventory (docs/plans/phase-5-corpus.md, Step 1a).
 *
 * Every fixture listing and count in TS, C# and Godot reads this file instead of hardcoding it.
 * `suites.spec.ts` holds it equal to the `*.fixture.json` files on disk, to their bytes, and to the
 * printed/speculative rule in `suiteOf`. It lives inside `fixtures/` so `npm run sync-data` mirrors
 * it into the Godot tree with the fixtures it lists. Regenerate with `npm run gen-manifest`.
 */
import { createHash } from 'node:crypto';
import { globSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export type Suite = 'printed' | 'speculative';

export interface ManifestEntry {
  /** Relative to `test/conformance/fixtures`, e.g. `A/I-EXP1.fixture.json`. */
  readonly path: string;
  readonly suite: Suite;
  /** Lowercase hex SHA-256 of the fixture file's raw bytes. */
  readonly sha256: string;
}

export const MANIFEST_SCHEMA = 'minivac.fixture-manifest/1';
export const FIXTURE_ROOT = fileURLToPath(new URL('./fixtures', import.meta.url));
export const MANIFEST_PATH = resolve(FIXTURE_ROOT, 'manifest.json');

const PATH_PATTERN = /^(A|B|C1|C2)\/[A-Z0-9-]+\.fixture\.json$/;
const SHA_PATTERN = /^[0-9a-f]{64}$/;

function fail(message: string): never {
  throw new Error('manifest: ' + message);
}

/**
 * A fixture is `printed` when at least one expect or until step carries no `tag` — that step
 * asserts what the page states. With every such step tagged `unverified` (a `FALLBACK-*` source),
 * or with none at all (digest-only C2), nothing it asserts was read off a page, and it is
 * `speculative`.
 */
export function suiteOf(fixture: { readonly script: readonly { readonly k: string; readonly tag?: string }[] }): Suite {
  return fixture.script.some((step) => (step.k === 'expect' || step.k === 'until') && step.tag === undefined)
    ? 'printed'
    : 'speculative';
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Every `*.fixture.json` under `root`, relative and in ordinal order. */
export function fixtureFilesOnDisk(root = FIXTURE_ROOT): string[] {
  return globSync('**/*.fixture.json', { cwd: root }).map((path) => path.split('\\').join('/')).sort();
}

/** The manifest the files on disk imply. `suites.spec.ts` requires the committed one to equal it. */
export function buildManifest(root = FIXTURE_ROOT): ManifestEntry[] {
  return fixtureFilesOnDisk(root).map((path) => {
    const bytes = new Uint8Array(readFileSync(resolve(root, path)));
    const fixture = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as {
      script: { k: string; tag?: string }[];
    };
    return { path, suite: suiteOf(fixture), sha256: sha256Hex(bytes) };
  });
}

/** One entry per line, so a batch's manifest diff reads as one line per fixture. */
export function serializeManifest(entries: readonly ManifestEntry[]): string {
  const rows = entries.map((entry) =>
    '    ' + JSON.stringify({ path: entry.path, suite: entry.suite, sha256: entry.sha256 }));
  return '{\n  "schema": "' + MANIFEST_SCHEMA + '",\n  "fixtures": [\n' + rows.join(',\n') + '\n  ]\n}\n';
}

/** The committed manifest, shape-checked: schema, path grammar, suite, sha, strict ordinal order. */
export function readManifest(path = MANIFEST_PATH): ManifestEntry[] {
  const document = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (typeof document !== 'object' || document === null) fail('not an object');
  const { schema, fixtures } = document as { schema?: unknown; fixtures?: unknown };
  if (schema !== MANIFEST_SCHEMA) fail('schema is not ' + MANIFEST_SCHEMA);
  if (!Array.isArray(fixtures) || fixtures.length === 0) fail('fixtures is not a non-empty array');
  const entries = fixtures.map((row: unknown, index): ManifestEntry => {
    const where = 'fixtures[' + index + ']';
    if (typeof row !== 'object' || row === null) fail(where + ' is not an object');
    const keys = Object.keys(row).sort().join(',');
    if (keys !== 'path,sha256,suite') fail(where + ' keys are ' + keys);
    const { path: rel, suite, sha256 } = row as Record<string, unknown>;
    if (typeof rel !== 'string' || !PATH_PATTERN.test(rel)) fail(where + ' path is invalid');
    if (suite !== 'printed' && suite !== 'speculative') fail(where + ' suite is invalid');
    if (typeof sha256 !== 'string' || !SHA_PATTERN.test(sha256)) fail(where + ' sha256 is invalid');
    return { path: rel, suite, sha256 };
  });
  for (let i = 1; i < entries.length; i++) {
    if (!(entries[i - 1]!.path < entries[i]!.path)) fail('paths are not in strict ordinal order at ' + i);
  }
  return entries;
}

/** Absolute fixture paths in manifest order, optionally one suite only. */
export function manifestFixturePaths(suite?: Suite, path = MANIFEST_PATH): string[] {
  return readManifest(path)
    .filter((entry) => suite === undefined || entry.suite === suite)
    .map((entry) => resolve(FIXTURE_ROOT, entry.path));
}
