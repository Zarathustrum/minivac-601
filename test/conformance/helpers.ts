import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import type { AnySchema, ErrorObject, ValidateFunction } from 'ajv';
import { loadNetlist } from '../../src/core/netlist.ts';
import { ARRAY_KEYS, SCALAR_KEYS, loadProfile } from '../../src/core/profile.ts';
import type { Profile } from '../../src/core/profile.ts';
import { OBSERVABLES } from '../../src/core/trace.ts';
import {
  allocateHoles,
  parseHoleId,
  parseTerminalId,
  parseTerminalWire,
} from '../../src/core/terminals.ts';
import type { Command, CordEnd } from '../../src/core/contract.ts';
import type {
  Fixture,
  LoadedFixture,
  Metrics,
  ReviewedDigest,
} from './types.ts';

const INT32_MAX = 2147483647;
export const DECISION_ANCHOR =
  'docs/DECISIONS.md#2026-09-01-canonical-marginal-counter-ruling-after-w1';
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const schema = readStrictJson(new URL('./fixture.schema.json', import.meta.url), 'fixture schema');
const validateFixture: ValidateFunction = new Ajv2020({ strict: true, allErrors: true })
  .compile(schema as AnySchema);

function fail(message: string): never {
  throw new Error('fixture: ' + message);
}

function renderAjvErrors(errors: ErrorObject[] | null | undefined): string {
  if (errors === null || errors === undefined) return 'unknown schema error';
  return errors.map((error) => (error.instancePath || '/') + ' ' + error.message).join('; ');
}

function strictUtf8(bytes: Uint8Array, where: string): string {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail(where + ' has a UTF-8 BOM');
  }
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d) fail(where + ' contains CR at byte ' + i);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail(where + ' is not valid UTF-8');
  }
}

export function readStrictJson(path: string | URL, where: string): unknown {
  const bytes = new Uint8Array(readFileSync(path));
  const text = strictUtf8(bytes, where);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    fail(where + ' is not valid JSON');
  }
}

function validateEnd(end: CordEnd, where: string): void {
  try {
    if (end.k === 'hole') parseHoleId(end.hole);
    else if (end.k === 'touch') parseTerminalId(end.term);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(where + ' is not a physical endpoint: ' + detail);
  }
}

function validateCommand(command: Command, where: string): void {
  if (command.k === 'connect') {
    validateEnd(command.a, where + '.a');
    validateEnd(command.b, where + '.b');
  }
}

function validateUnicodeScalars(text: string, where: string): void {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const low = i + 1 < text.length ? text.charCodeAt(i + 1) : -1;
      if (low < 0xdc00 || low > 0xdfff) fail(where + ' contains an unpaired high surrogate');
      i++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      fail(where + ' contains an unpaired low surrogate');
    }
  }
}

function railName(terminal: string): string {
  if (/^[1-6]\+$/.test(terminal) || terminal === 'M+') return 'PLUS';
  if (/^[1-6]-$/.test(terminal) || terminal === 'M-') return 'MINUS';
  return terminal;
}

function canonicalPair(text: string, where: string): string {
  try {
    const wire = parseTerminalWire(text);
    const ends = [railName(wire[0]), railName(wire[1])];
    ends.sort();
    return ends[0] + '/' + ends[1];
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(where + ' is not a physical wire: ' + detail);
  }
}

function validateSemantics(fixture: Fixture): {
  wires: ReturnType<typeof parseTerminalWire>[];
  cords: ReturnType<typeof allocateHoles>;
} {
  const wires: ReturnType<typeof parseTerminalWire>[] = [];
  for (let i = 0; i < fixture.wires.length; i++) {
    try {
      wires.push(parseTerminalWire(fixture.wires[i] as string));
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      fail('wires[' + i + '] is not a physical wire: ' + detail);
    }
  }

  let cords: ReturnType<typeof allocateHoles>;
  try {
    cords = allocateHoles(wires);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    fail('wire hole allocation failed: ' + detail);
  }
  if (cords.length > 256) fail('initial wiring needs cord id ' + cords.length + ', above 255');

  const canonicalWires = fixture.wires.map((wire, i) => canonicalPair(wire, 'wires[' + i + ']'));
  for (let i = 0; i < fixture.errata_applied.length; i++) {
    const erratum = fixture.errata_applied[i] as Fixture['errata_applied'][number];
    const from = canonicalPair(erratum.from, 'errata_applied[' + i + '].from');
    const to = canonicalPair(erratum.to, 'errata_applied[' + i + '].to');
    if (canonicalWires.includes(from)) {
      fail('errata_applied[' + i + '] canonical from remains in wires');
    }
    let count = 0;
    for (const wire of canonicalWires) if (wire === to) count++;
    if (count !== 1) fail('errata_applied[' + i + '] canonical to occurs ' + count + ' times, expected 1');
  }

  if (fixture.marginal === true) {
    const mechanism = fixture.mechanism as NonNullable<Fixture['mechanism']>;
    if (![...SCALAR_KEYS, ...ARRAY_KEYS].includes(mechanism.profileKey)) {
      fail('mechanism.profileKey is not a normative profile key: ' + JSON.stringify(mechanism.profileKey));
    }
    if (mechanism.decision !== DECISION_ANCHOR) {
      fail('mechanism.decision must equal ' + JSON.stringify(DECISION_ANCHOR));
    }
  }

  for (let i = 0; i < fixture.script.length; i++) {
    const step = fixture.script[i] as Fixture['script'][number];
    if (step.k === 'do') validateCommand(step.cmd, 'script[' + i + '].cmd');
    else {
      if (step.k !== 'expect') {
        const ms = step.k === 'advance' ? step.ms : step.maxMs;
        if (ms > Math.floor(INT32_MAX / 10)) {
          fail('script[' + i + '] milliseconds overflow int32 ticks');
        }
      }
      if (step.k === 'expect' || step.k === 'until') {
        validateUnicodeScalars(step.cite, 'script[' + i + '].cite');
        validateUnicodeScalars(step.quote, 'script[' + i + '].quote');
      }
    }
  }
  return { wires, cords };
}

export function loadFixture(path: string): LoadedFixture {
  const raw = readStrictJson(path, path);
  if (!validateFixture(raw)) fail('schema validation failed: ' + renderAjvErrors(validateFixture.errors));
  const fixture = raw as Fixture;
  const checked = validateSemantics(fixture);

  const profileRaw = readStrictJson(
    new URL('../../data/profiles/' + fixture.profile + '.json', import.meta.url),
    fixture.profile + ' profile',
  );
  const profile = loadProfile(profileRaw);
  if (profile.id !== fixture.profile) fail('loaded profile id does not match fixture profile');
  if (profile.v.tick_us !== 100) fail('trace version 1 requires profile tick_us=100');
  const netlistBytes = new Uint8Array(readFileSync(new URL('../../data/netlist.json', import.meta.url)));
  const netlist = loadNetlist(netlistBytes);
  return {
    path,
    fixture,
    profile,
    netlist,
    wires: checked.wires,
    cords: checked.cords,
  };
}

export function observableIndex(name: string): number {
  for (let i = 0; i < OBSERVABLES.length; i++) {
    if (OBSERVABLES[i]?.name === name) return i;
  }
  fail('unknown observable ' + JSON.stringify(name));
}

export function observableValue(index: number, encoded: number): string {
  const row = OBSERVABLES[index];
  if (row === undefined) fail('observable index out of range: ' + index);
  const at = encoded - row.minValue;
  const value = row.values[at];
  if (value === undefined) fail(row.name + ' has invalid encoding ' + encoded);
  return value;
}

export function expectedEncoding(name: string, value: string): number {
  const index = observableIndex(name);
  const row = OBSERVABLES[index] as NonNullable<(typeof OBSERVABLES)[number]>;
  const at = row.values.indexOf(value);
  if (at < 0) fail(name + ' has invalid spelling ' + JSON.stringify(value));
  return row.minValue + at;
}

export function quoteGolden(text: string): string {
  return '"' + text.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"';
}

function metric(value: number | null): string {
  return value === null ? 'na' : String(value);
}

export function traceHeaders(
  fixture: Fixture,
  profile: Profile,
  netlistHash: string,
  metrics: Metrics,
): string[] {
  const cycles = profile.v.chatter_cycles;
  const quietCycles = profile.v.chatter_quiet_cycles;
  return [
    '#!mv601-trace 1',
    '# id=' + fixture.id + ' contract=' + fixture.contract + ' netlist=fnv1a64:' + netlistHash +
      ' profile=' + profile.id + '/fnv1a64:' + profile.hash + ' wires=' + fixture.wires.length,
    '# rules settleTicks=' + profile.v.settle_quiet_ticks + ' chatterN=' + profile.v.chatter_n +
      ' relayWinTicks=' + cycles * profile.derived.relayCycleTicks +
      ' relayQuietTicks=' + quietCycles * profile.derived.relayCycleTicks +
      ' buttonWinTicks=' + cycles * profile.derived.buttonCycleTicks +
      ' buttonQuietTicks=' + quietCycles * profile.derived.buttonCycleTicks +
      ' switchWinTicks=' + cycles * profile.derived.switchCycleTicks +
      ' switchQuietTicks=' + quietCycles * profile.derived.switchCycleTicks +
      ' dialWinTicks=' + cycles * profile.derived.dialCycleTicks +
      ' dialQuietTicks=' + quietCycles * profile.derived.dialCycleTicks,
    '# margins minDecisionUa=' + metric(metrics.minDecisionUa) +
      ' minTickGap=' + metric(metrics.minTickGap) +
      ' marginal=' + String(fixture.marginal === true),
  ];
}

export function digestEqual(a: ReviewedDigest, b: ReviewedDigest): boolean {
  if (a.eventCount !== b.eventCount || a.moverTransitions.length !== b.moverTransitions.length) return false;
  for (let i = 0; i < a.moverTransitions.length; i++) {
    if (a.moverTransitions[i] !== b.moverTransitions[i]) return false;
  }
  return true;
}
