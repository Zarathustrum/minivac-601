import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixtureFilesOnDisk, manifestFixturePaths, readManifest } from '../test/conformance/manifest.ts';

const ROOT = resolve(import.meta.dirname, '..');
const TS_CLI = resolve(ROOT, 'bin/minivac-trace');
const DOTNET_CLI = resolve(
  ROOT, 'dotnet/Minivac.Trace/bin/Release/net10.0/',
  process.platform === 'win32' ? 'minivac-trace.exe' : 'minivac-trace',
);
const LOAD_PREFIX = Buffer.from('minivac-trace: fixture: schema validation failed:', 'utf8');

interface CliResult {
  readonly status: number;
  readonly stdout: Buffer;
  readonly stderr: Buffer;
}

function fail(message: string): never {
  throw new Error('parity: ' + message);
}

function run(command: string, args: readonly string[]): CliResult {
  const child = spawnSync(command, args, { cwd: ROOT, encoding: 'buffer' });
  if (child.error !== undefined) fail(command + ' failed to start: ' + child.error.message);
  if (child.status === null) fail(command + ' terminated without an exit code');
  return { status: child.status, stdout: child.stdout, stderr: child.stderr };
}

function sameBytes(actual: Buffer, expected: Buffer, where: string): void {
  if (!actual.equals(expected)) fail(where + ' bytes differ');
}

function compareCli(
  name: string,
  args: readonly string[],
  stderr: 'exact' | 'schema-prefix' = 'exact',
): { ts: CliResult; dotnet: CliResult } {
  const ts = run(process.execPath, [TS_CLI, ...args]);
  const dotnet = run(DOTNET_CLI, args);
  if (ts.status !== dotnet.status) fail(name + ' exit codes differ: TS=' + ts.status + ' C#=' + dotnet.status);
  sameBytes(dotnet.stdout, ts.stdout, name + ' stdout');
  if (stderr === 'exact') {
    sameBytes(dotnet.stderr, ts.stderr, name + ' stderr');
  } else if (!ts.stderr.subarray(0, LOAD_PREFIX.length).equals(LOAD_PREFIX) ||
      !dotnet.stderr.subarray(0, LOAD_PREFIX.length).equals(LOAD_PREFIX)) {
    fail(name + ' stderr does not share the fixed schema prefix');
  }
  return { ts, dotnet };
}

function fixtureId(path: string): string {
  return basename(path, '.fixture.json');
}

function fixtureTier(path: string): string {
  return basename(dirname(path));
}

function cliFixture(expected: 'off' | 'on'): string {
  return JSON.stringify({
    schema: 'minivac.fixture/1', id: 'CLI-CASE', source: 'parity', tier: 'A', confidence: 'verified',
    profile: 'MV601-REF-A', contract: '1.1.0', as_printed: ['A/B'], errata_applied: [], wires: ['1A/1B'],
    script: [{
      k: 'expect', obs: [{ dev: 'power', v: expected }], cite: 'parity', quote: 'Power state.',
    }],
  }) + '\n';
}

// C2 motor-run cases for the `until` step (architecture §13.5.1). The RUN drive is I-EXP12's
// (BK1 printed p.23: + to D17 through R1, D18 to -) with pb5 replaced by a direct rail, and D19 left
// free so the motor is not STOP-shorted. Run rate and wiper geometry are profile fallbacks O-R1,
// O-R3 and O-R5, so these pin TS/C# agreement, not a printed fact. Under MV601-REF-A the wiper
// leaves c0 for a gap at 31.2ms and reaches c1, not c15, by 100ms (increasing numbers, §13.4.5);
// the digests are the TS runner's.
function motorUntilFixture(target: 'gap' | 'c15'): string {
  const digest = target === 'gap'
    ? { eventCount: 2, moverTransitions: [...new Array<number>(18).fill(0), 1] }
    : { eventCount: 3, moverTransitions: [...new Array<number>(18).fill(0), 2] };
  return JSON.stringify({
    schema: 'minivac.fixture/1', id: 'CLI-MOTOR-UNTIL', source: 'parity', tier: 'C2', confidence: 'verified',
    profile: 'MV601-REF-A', contract: '1.1.0', as_printed: ['+/D17', '-/D18'], errata_applied: [],
    wires: ['1+/D17', '1-/D18'],
    script: [
      { k: 'do', cmd: { k: 'power', on: true } },
      { k: 'until', obs: [{ dev: 'dial', v: target }], maxMs: 100, cite: 'parity', quote: 'Wiper position.' },
    ],
    digest,
  }) + '\n';
}

function main(): void {
  const build = run('dotnet', ['build', 'dotnet/Minivac.Trace/Minivac.Trace.csproj', '-c', 'Release', '-warnaserror', '--nologo']);
  if (build.status !== 0) fail('dotnet CLI build failed:\n' + build.stdout.toString('utf8') + build.stderr.toString('utf8'));

  // On its own, parity must still refuse a fixture on disk that the manifest omits (suites.spec owns the rest).
  const listed = readManifest().map((entry) => entry.path);
  if (listed.join('\n') !== fixtureFilesOnDisk().join('\n')) fail('manifest does not list exactly the fixtures on disk');
  const fixtures = manifestFixturePaths();
  for (const fixture of fixtures) {
    const result = compareCli(fixtureId(fixture), [fixture]);
    if (result.ts.status !== 0) fail(fixtureId(fixture) + ' did not pass');
    const golden = readFileSync(resolve(
      ROOT, 'test/conformance/golden', fixtureTier(fixture), fixtureId(fixture) + '.trace',
    ));
    sameBytes(result.ts.stdout, golden, fixtureId(fixture) + ' TS/golden');
    sameBytes(result.dotnet.stdout, golden, fixtureId(fixture) + ' C#/golden');
  }

  const temporary = mkdtempSync(join(tmpdir(), 'mv601-parity-'));
  try {
    const clean = join(temporary, 'clean.fixture.json');
    const failed = join(temporary, 'failed.fixture.json');
    const invalid = join(temporary, 'invalid.fixture.json');
    writeFileSync(clean, cliFixture('off'));
    writeFileSync(failed, cliFixture('on'));
    writeFileSync(invalid, '{}\n');
    const untilMatch = join(temporary, 'until-match.fixture.json');
    const untilTimeout = join(temporary, 'until-timeout.fixture.json');
    writeFileSync(untilMatch, motorUntilFixture('gap'));
    writeFileSync(untilTimeout, motorUntilFixture('c15'));
    if (compareCli('clean CLI', [clean]).ts.status !== 0) fail('clean CLI case did not pass');
    if (compareCli('assertion CLI', [failed]).ts.status !== 1) fail('assertion CLI case did not fail');
    if (compareCli('schema CLI', [invalid], 'schema-prefix').ts.status !== 1) fail('schema CLI case did not fail');
    if (compareCli('fallback CLI', ['--list-fallbacks']).ts.status !== 0) fail('fallback CLI case did not pass');
    if (compareCli('arity CLI', []).ts.status !== 1) fail('arity CLI case did not fail');
    if (compareCli('until match CLI', [untilMatch]).ts.status !== 0) fail('until match CLI case did not pass');
    if (compareCli('until timeout CLI', [untilTimeout]).ts.status !== 1) fail('until timeout CLI case did not fail');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  process.stdout.write('parity: ' + fixtures.length + ' fixtures and 7 CLI cases passed\n');
}

try {
  main();
} catch (error: unknown) {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
  process.exitCode = 1;
}
