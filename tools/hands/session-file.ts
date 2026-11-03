/**
 * Session file I/O for `minivac-control`: loads the netlist and a profile from `data/`, reads and
 * validates `minivac.session/1` files, and writes them atomically. All simulation lives in
 * `src/hands/table.ts`; this module only moves bytes.
 */
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema, ValidateFunction } from 'ajv';
import { loadNetlist } from '../../src/core/netlist.ts';
import type { LoadedNetlist } from '../../src/core/netlist.ts';
import { loadProfile } from '../../src/core/profile.ts';
import type { Profile } from '../../src/core/profile.ts';
import { SessionError } from '../../src/hands/table.ts';
import type { Session, SessionStep } from '../../src/hands/table.ts';
import { readStrictJson } from '../../test/conformance/helpers.ts';

let validateCache: ValidateFunction | null = null;

/** Compiled on first use, so `help` and `new` do not pay for Ajv. */
function sessionValidator(): ValidateFunction {
  if (validateCache === null) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    ajv.addSchema(readStrictJson(new URL('../../test/conformance/fixture.schema.json', import.meta.url), 'fixture schema') as AnySchema);
    validateCache = ajv.compile(readStrictJson(new URL('./session.schema.json', import.meta.url), 'session schema') as AnySchema);
  }
  return validateCache;
}

let netlistCache: LoadedNetlist | null = null;

export function loadRepoNetlist(): LoadedNetlist {
  netlistCache ??= loadNetlist(new Uint8Array(readFileSync(new URL('../../data/netlist.json', import.meta.url))));
  return netlistCache;
}

export function loadRepoProfile(id: string): Profile {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(id)) throw new SessionError('invalid profile id ' + JSON.stringify(id));
  const url = new URL('../../data/profiles/' + id + '.json', import.meta.url);
  if (!existsSync(url)) throw new SessionError('no profile ' + JSON.stringify(id) + ' in data/profiles/');
  const profile = loadProfile(readStrictJson(url, id + ' profile'));
  if (profile.id !== id) throw new SessionError('profile file ' + id + '.json declares id ' + profile.id);
  return profile;
}

const FIXTURES = new URL('../../test/conformance/fixtures/', import.meta.url);
const FIXTURE_SUFFIX = '.fixture.json';
let programCache: Map<string, string> | null = null;

/** Every conformance fixture by id: id -> repo-relative path under test/conformance/fixtures/. */
function programIndex(): Map<string, string> {
  if (programCache !== null) return programCache;
  const index = new Map<string, string>();
  for (const entry of readdirSync(FIXTURES, { recursive: true, encoding: 'utf8' }).sort()) {
    const name = entry.split(/[\\/]/).pop() as string;
    if (!name.endsWith(FIXTURE_SUFFIX)) continue;
    const id = name.slice(0, -FIXTURE_SUFFIX.length);
    if (index.has(id)) throw new SessionError('two fixtures share the id ' + id + ': ' + index.get(id) + ' and ' + entry);
    index.set(id, entry);
  }
  programCache = index;
  return index;
}

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next.push(Math.min((row[j] as number) + 1, (next[j - 1] as number) + 1,
        (row[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1)));
    }
    row = next;
  }
  return row[b.length] as number;
}

/** Ids that extend `id` (IV-EXP1 -> IV-EXP1-FAST ...), else ids within two edits, nearest first; at most 8. */
function closePrograms(id: string, ids: readonly string[]): string[] {
  const wanted = id.toUpperCase();
  const extended = ids.filter((other) => other.startsWith(wanted + '-') || (other === wanted && other !== id));
  if (extended.length > 0) return extended.sort().slice(0, 8);
  return ids.map((other) => ({ other, distance: editDistance(wanted, other) }))
    .filter((row) => row.distance <= 2)
    .sort((a, b) => a.distance - b.distance || (a.other < b.other ? -1 : 1))
    .slice(0, 8)
    .map((row) => row.other);
}

function fixtureWires(id: string, entry: string): string[] {
  const fixture = readStrictJson(new URL(entry, FIXTURES), id + ' fixture') as { id?: unknown; wires?: unknown };
  if (fixture.id !== id || !Array.isArray(fixture.wires) || !fixture.wires.every((wire) => typeof wire === 'string')) {
    throw new SessionError('fixture ' + entry + ' has no id ' + id + ' or no wire list');
  }
  return fixture.wires as string[];
}

/**
 * What variants of one program (`<ID>-<suffix>`) have in common, for the unknown-id message:
 * `-DERIVED` fixtures keep the program's wires and carry expectations derived from them, not
 * printed (docs/plans/phase-5-corpus.md Step 7); other suffixes are timing or wiring variants.
 */
function variantNote(base: string, close: readonly string[], index: Map<string, string>): string {
  if (close.length < 2 || !close.every((id) => id.startsWith(base.toUpperCase() + '-'))) return '';
  const lists = close.map((id) => JSON.stringify(fixtureWires(id, index.get(id) as string)));
  const same = lists.every((list) => list === lists[0]);
  return '; these are variants of one program' + (same ? ' with the same wires, so load any of them' :
    ' and their wires differ (see docs/research/programs.md)') +
    '; -DERIVED fixtures carry expectations derived from the wiring, not printed';
}

/**
 * The `wires` of the conformance fixture with this id (errata already applied), for load-program.
 * Throws a SessionError naming close ids when there is no such fixture.
 */
export function readProgramWires(id: string): string[] {
  const index = programIndex();
  const entry = index.get(id);
  if (entry === undefined) {
    const close = closePrograms(id, [...index.keys()]);
    throw new SessionError('no program ' + JSON.stringify(id) + ' in test/conformance/fixtures/' +
      (close.length === 0 ? '' : '; did you mean: ' + close.join(', ') + variantNote(id, close, index)) +
      ' (ids are listed in docs/research/programs.md)');
  }
  return fixtureWires(id, entry);
}

function malformed(path: string, why: string): never {
  throw new SessionError('malformed session file ' + path + ': ' + why);
}

/** What `readSession` says, and what `minivac-control` prints, when there is no file at `path`. */
export function noSessionMessage(path: string): string {
  return 'no session file ' + path + ' (create one with: minivac-control new ' + path + ')';
}

export function readSession(path: string): Session {
  if (!existsSync(path)) throw new SessionError(noSessionMessage(path));
  let raw: unknown;
  try {
    // The fixture loader's byte rules (no BOM, no CR, strict UTF-8); `where` reads as "it ...".
    raw = readStrictJson(path, 'it');
  } catch (error: unknown) {
    malformed(path, (error instanceof Error ? error.message : String(error)).replace(/^fixture: /, ''));
  }
  const validateSession = sessionValidator();
  if (!validateSession(raw)) {
    const detail = (validateSession.errors ?? [])
      .map((error) => (error.instancePath || '/') + ' ' + error.message).join('; ');
    malformed(path, detail);
  }
  return raw as Session;
}

/** Stable text: header fields, then one script step per line. */
export function formatSession(session: Session): string {
  const head = '{\n' +
    '  "schema": ' + JSON.stringify(session.schema) + ',\n' +
    '  "profile": ' + JSON.stringify(session.profile) + ',\n' +
    '  "contract": ' + JSON.stringify(session.contract) + ',\n' +
    '  "netlistHash": ' + JSON.stringify(session.netlistHash) + ',\n' +
    '  "profileHash": ' + JSON.stringify(session.profileHash) + ',\n';
  if (session.script.length === 0) return head + '  "script": []\n}\n';
  const steps = session.script.map((step: SessionStep) => '    ' + JSON.stringify(step));
  return head + '  "script": [\n' + steps.join(',\n') + '\n  ]\n}\n';
}

/** Create a new session file; refuses to overwrite. Returns false, writing nothing, if it exists. */
export function createSessionFile(path: string, session: Session): boolean {
  try {
    writeFileSync(path, formatSession(session), { flag: 'wx' });
    return true;
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'EEXIST') return false;
    throw error;
  }
}

/** Replace an existing session file atomically (write a sibling, then rename over it). */
export function writeSessionFile(path: string, session: Session): void {
  const temp = path + '.tmp-' + process.pid;
  writeFileSync(temp, formatSession(session));
  renameSync(temp, path);
}

function lockPath(path: string): string {
  return path + '.lock';
}

/**
 * Run `body` holding `<session>.lock`, created exclusively (`wx`) and removed in `finally`. Every
 * state-changing call and `new` takes it across read, replay and write, so two calls on one
 * session cannot interleave. A lock left by a killed process must be deleted by hand.
 */
export function withSessionLock<T>(path: string, body: () => T): T {
  const lock = lockPath(path);
  try {
    writeFileSync(lock, String(process.pid) + '\n', { flag: 'wx' });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === 'EEXIST') {
      throw new SessionError('another call is using this session (' + lock + '); if no other ' +
        'minivac-control call is running, delete that file and re-run');
    }
    throw error;
  }
  try {
    return body();
  } finally {
    rmSync(lock, { force: true });
  }
}
