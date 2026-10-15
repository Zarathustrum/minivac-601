import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const GODOT_PROJECT = resolve(ROOT, 'godot');
const FAILURE_MARKERS = [
  'Target platform not supported.',
  'Target platform not yet implemented.',
  'no solution file was found',
  'Failed to build project.',
] as const;

function fail(message: string): never {
  throw new Error('export-proof: ' + message);
}

export function verifyExport(preset: string, output: string): string {
  const outputStat = statSync(output);
  if (!outputStat.isFile() && !outputStat.isDirectory()) fail('output is not a file or directory: ' + output);

  if (preset === 'macOS Universal 2') {
    if (!outputStat.isDirectory()) fail('macOS export is not an app directory: ' + output);

    const executableDir = resolve(output, 'Contents', 'MacOS');
    const executables = readdirSync(executableDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
    if (executables.length !== 1)
      fail('expected one executable in Contents/MacOS, found ' + String(executables.length));

    const executableName = executables[0]!;
    const executable = resolve(executableDir, executableName);
    const mode = statSync(executable).mode & 0o777;
    if ((mode & 0o111) === 0)
      fail('macOS executable has no executable mode bit: ' + mode.toString(8).padStart(3, '0'));

    const payloads = readdirSync(resolve(output, 'Contents', 'Resources'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('data_'))
      .map((entry) => entry.name)
      .sort();
    const architectures = payloads.map((payload) => payload.match(/_macos_(arm64|x86_64)$/)?.[1] ?? '');
    if (architectures.length !== 2 || architectures[0] !== 'arm64' || architectures[1] !== 'x86_64')
      fail('expected arm64 and x86_64 macOS payloads, found ' + payloads.join(','));

    return `export proof preset=${preset} executable=${executableName} payloads=${payloads.join(',')} mode=${mode.toString(8).padStart(3, '0')}`;
  }

  if (!outputStat.isFile()) fail('exported binary is not a file: ' + output);

  const payloads = readdirSync(dirname(output), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('data_'))
    .map((entry) => entry.name);
  if (payloads.length !== 1)
    fail('expected one data_* payload beside the export, found ' + String(payloads.length));
  const expectedPayloadSuffix =
    preset === 'Linux' ? '_linuxbsd_x86_64' : preset === 'Windows Desktop' ? '_windows_x86_64' : undefined;
  if (expectedPayloadSuffix !== undefined && !payloads[0]!.endsWith(expectedPayloadSuffix))
    fail('payload does not match ' + preset + ': ' + payloads[0]);

  const mode = outputStat.mode & 0o777;
  if (preset === 'Linux' && !outputStat.isDirectory() && (mode & 0o111) === 0)
    fail('exported binary has no executable mode bit: ' + mode.toString(8).padStart(3, '0'));

  if (preset === 'Windows Desktop') {
    if (extname(output).toLowerCase() !== '.exe') fail('Windows export does not have an .exe extension: ' + output);
    const expectedWrapper = basename(output, extname(output)) + '.console.exe';
    const wrappers = readdirSync(dirname(output), { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.console.exe'))
      .map((entry) => entry.name)
      .sort();
    if (wrappers.length !== 1 || wrappers[0] !== expectedWrapper)
      fail('expected exactly one Windows console wrapper named ' + expectedWrapper + ', found ' + wrappers.join(','));
  }

  return `export proof preset=${preset} payload=${payloads[0]} mode=${mode.toString(8).padStart(3, '0')}`;
}

function main(): void {
  const [preset, output] = process.argv.slice(2);
  if (preset === undefined || output === undefined || process.argv.length !== 4)
    fail('usage: npm run export-proof -- <preset> <absolute-output-path>');
  if (!isAbsolute(output)) fail('output path must be absolute');

  const child = spawnSync(
    'godot-mono',
    ['--headless', '--path', GODOT_PROJECT, '--export-release', preset, output],
    { cwd: ROOT, encoding: 'utf8' },
  );
  if (child.error !== undefined) fail('godot-mono failed to start: ' + child.error.message);

  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  const transcript = child.stdout + child.stderr;
  if (child.status !== 0) fail('Godot exited ' + String(child.status));
  for (const marker of FAILURE_MARKERS) {
    if (transcript.includes(marker)) fail('Godot reported: ' + marker);
  }

  process.stdout.write(verifyExport(preset, output) + '\n');
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    main();
  } catch (error: unknown) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    process.exitCode = 1;
  }
}
