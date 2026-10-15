/** Mirror the byte-bearing inputs required by the packed Godot self-test. */
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OVERRIDE = process.env['MINIVAC_GODOT_DIR'];
/** An unset or empty override means the in-repo tree; a relative one is anchored to ROOT, never cwd. */
const GODOT = OVERRIDE === undefined || OVERRIDE === '' ? join(ROOT, 'godot') : resolve(ROOT, OVERRIDE);

const trees: readonly [string, string][] = [
  ['data', 'godot/data'],
  ['test/conformance/fixtures', 'godot/conformance/fixtures'],
  ['test/conformance/golden', 'godot/conformance/golden'],
  ['test/conformance/probes', 'godot/conformance/probes'],
];
/** Audio is `*.wav` only (docs/plans/phase-3-godot.md, `audio/`), so Godot's `.import` sidecars survive. */
const wavTrees: readonly [string, string][] = [
  ['public/audio', 'godot/audio'],
];
const files: readonly [string, string][] = [
  ['test/conformance/fixture.schema.json', 'godot/conformance/fixture.schema.json'],
  ['test/conformance/probe.schema.json', 'godot/conformance/probe.schema.json'],
];

function isSameOrChild(path: string, parent: string): boolean {
  const rel = relative(parent, path);
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
}

/** Realpath of the nearest existing ancestor with the not-yet-created tail re-appended. */
function canonical(path: string): string {
  const tail: string[] = [];
  let head = path;
  while (!existsSync(head)) {
    const parent = dirname(head);
    if (parent === head) return path;
    tail.unshift(basename(head));
    head = parent;
  }
  return join(realpathSync(head), ...tail);
}

function assertSafeTargets(): void {
  for (const [sourceRelative, destinationRelative] of [...trees, ...wavTrees, ...files]) {
    const source = canonical(resolve(ROOT, sourceRelative));
    const destination = canonical(destinationPath(destinationRelative));
    if (isSameOrChild(destination, source) || isSameOrChild(source, destination)) {
      throw new Error('sync-data: destination overlaps source: ' + destinationRelative);
    }
  }
}

/** Every source is checked before the first deletion, so no tree is wiped for a copy that cannot run. */
function assertSourcesPresent(): void {
  for (const [sourceRelative] of [...trees, ...wavTrees, ...files]) {
    if (!existsSync(join(ROOT, sourceRelative))) throw new Error('sync-data: missing source ' + sourceRelative);
  }
}

function mirrorTree(sourceRelative: string, destinationRelative: string): void {
  const source = join(ROOT, sourceRelative);
  const destination = destinationPath(destinationRelative);
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, force: true });
}

function mirrorWav(sourceRelative: string, destinationRelative: string): void {
  const source = join(ROOT, sourceRelative);
  const destination = destinationPath(destinationRelative);
  const names = readdirSync(source).filter((name) => name.endsWith('.wav')).sort();
  mkdirSync(destination, { recursive: true });
  for (const name of readdirSync(destination)) {
    if (name.endsWith('.wav') && !names.includes(name)) rmSync(join(destination, name), { force: true });
  }
  for (const name of names) cpSync(join(source, name), join(destination, name), { force: true });
}

function copyFile(sourceRelative: string, destinationRelative: string): void {
  const source = join(ROOT, sourceRelative);
  const destination = destinationPath(destinationRelative);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { force: true });
}

function destinationPath(destinationRelative: string): string {
  const prefix = 'godot/';
  if (!destinationRelative.startsWith(prefix)) throw new Error('sync-data: destination is outside godot/: ' + destinationRelative);
  return resolve(GODOT, destinationRelative.slice(prefix.length));
}

assertSafeTargets();
assertSourcesPresent();

for (const [source, destination] of trees) mirrorTree(source, destination);
for (const [source, destination] of wavTrees) mirrorWav(source, destination);
for (const [source, destination] of files) copyFile(source, destination);

for (const [source, destination] of [...trees, ...wavTrees, ...files]) {
  process.stdout.write(source + ' -> ' + destinationPath(destination) + '\n');
}
