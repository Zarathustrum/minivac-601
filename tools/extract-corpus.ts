/**
 * `tools/extract-corpus.ts` — `docs/research/programs.md` §1 and §4 to `test/conformance/corpus/programs.json`
 * (docs/plans/phase-5-corpus.md, Step 4).
 *
 *   node tools/extract-corpus.ts [--out <programs.json>] [--printed-class <printed-class.json>]
 *
 * One entry per program record, in programs.md order: `VI-TICTACTOE` first (it is the level-2 heading
 * `## 1. Tic-Tac-Toe`, the one record `### ID —` does not find), then the 101 `### ID —` records of
 * §4.1-§4.7: 98 incl. ER-ALTCOUNTER and IV-FF2-CARRY + 3 MM; with VI-TICTACTOE, 99 non-MM. programs.md
 * states 98 (C-21: IV-FF2-CARRY is "not a 99th record"), so the build reports the 99 as a 'records' failure.
 *
 * What it does and does not do:
 *
 *   - Mismatches are REPORTED, never fixed. II-EXP1 and IV-EXP10 are expected to show up.
 *   - The wire grammar is parsePrograms' (tools/corpus-reachability.ts, D1-D6): a wire row is a markdown
 *     table row whose every non-empty cell is one backticked token; a trailing footnote `*` is print, not
 *     circuit, and is dropped. Unlike parsePrograms nothing is skipped: a record with tokens the terminal
 *     grammar rejects keeps them, and `checks.badTerminals` names them.
 *   - `wiresPrinted` is the wire list as the book prints it; `wiresCorrected` is that list with the
 *     errata sheet applied (§0 correction policy). The errata that change a wire are in ERRATA below,
 *     checked against the §3.2 row, and checked against the record's own "Corrected wire list" table
 *     wherever the record prints one.
 *   - `printed-class.json` (schema minivac.printed-class/1, entries {id, class, evidence, unprinted?}) is
 *     written by another agent; absent -> `printedClass`/`printedEvidence`/`printedUnprinted` are null. When present the merge throws on a missing or extra id, or on an evidence string that is
 *     not a verbatim substring of that record's programs.md text.
 *
 * Output is deterministic: no clock, stable ordering, LF, trailing newline.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HoleAllocationError, allocateHoles, parseTerminalWire } from '../src/core/terminals.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PROGRAMS_MD_REL = 'docs/research/programs.md';
export const PROGRAMS_JSON_PATH = ROOT + 'test/conformance/corpus/programs.json';
export const PRINTED_CLASS_PATH = ROOT + 'test/conformance/corpus/printed-class.json';
const MANIFEST_PATH = ROOT + 'test/conformance/fixtures/manifest.json';
const FIXTURE_DIR = ROOT + 'test/conformance/fixtures/';

// =================================================================================================
// Types
// =================================================================================================

export interface Answer { n: number; wires: string[]; tag: string }
export interface ErratumRef { id: string; from: string[]; to: string[] }
export interface Flags {
  motor: boolean;
  freeWire: boolean;
  touch: boolean;
  manualRelay: boolean;
  deltaOf: string | null;
  standalone: boolean;
}
export interface FixtureDiff { fixture: string; onlyCorpus: string[]; onlyFixture: string[] }
export interface Checks {
  countMatches: boolean | null;
  effectiveCountMatches: boolean | null;
  badTerminals: string[];
  freeEnded: string[];
  coilEnds: string[];
  errataApplied: boolean;
  holesFit: boolean;
  indexAgrees: boolean;
  fixtureWiresMatch: boolean | null;
  fixtureDiffs: FixtureDiff[];
}
export interface CorpusProgram {
  id: string;
  book: string;
  title: string;
  printedPage: string;
  pdfPage: string;
  tier: string | null;
  tag: string;
  statedWires: number | null;
  wiresPrinted: string[];
  wiresCorrected: string[];
  errata: ErratumRef[];
  errataRefs: string[];
  flags: Flags;
  standaloneReason: string | null;
  wiresEffective: string[] | null;
  wiresEffectiveNote: string | null;
  fixtures: string[];
  checks: Checks;
  answers: Answer[] | null;
  printedClass: 'yes' | 'partial' | 'no' | null;
  printedEvidence: string[] | null;
  printedUnprinted: string | null;
}
export interface Corpus {
  schema: 'minivac.corpus/1';
  source: { path: string; sha256: string };
  programs: CorpusProgram[];
}
export interface Failure { id: string; check: string; detail: string }
export interface FixtureRef { path: string; id: string; wires: string[] }
export interface PrintedClassEntry { id: string; printedClass: 'yes' | 'partial' | 'no'; printedEvidence: string[]; printedUnprinted: string | null }
export interface BuildResult { corpus: Corpus; failures: Failure[]; recordText: Map<string, string> }

// =================================================================================================
// Hand-kept knowledge. Everything here is cross-checked against programs.md at build time.
// =================================================================================================

/**
 * The errata that change a wire in a program's list (§3.2 `program_change` rows), as ER-nn ids as
 * printed. `shown` says which list the record's own wire table is: the printed one (the corrected one
 * is derived), the corrected one (printed is derived by reversing the erratum), or both (the record
 * prints the two tables and the derivation must reproduce the second from the first).
 *
 * Not here, on purpose: ER-22 and ER-24 (changes to the ALTERNATE counter variants, not to the base
 * program's list), ER-21 (substitution is the `ER-ALTCOUNTER` record itself), ER-33 (a rule about which
 * matrix terminals, no wire named), and the conditional "if performance is unsatisfactory" tail of ER-31.
 */
const ERRATA: readonly { id: string; program: string; from: readonly string[]; to: readonly string[]; shown: 'printed' | 'corrected' | 'both' }[] = [
  { id: 'ER-05', program: 'II-2BUTTONMEM', from: ['1A/1C'], to: ['1A/1G'], shown: 'both' },
  { id: 'ER-06', program: 'II-EXP6', from: ['2Z/2C'], to: ['2X/2C'], shown: 'both' },
  { id: 'ER-12', program: 'III-RELAYAND', from: ['2+/2H'], to: ['1G/2H'], shown: 'both' },
  { id: 'ER-14', program: 'III-MINDREADING', from: ['5V/45'], to: ['5V/4S'], shown: 'corrected' },
  { id: 'ER-27', program: 'IV-EXP10', from: ['2C/3G', '2Y/6S', '3C/4G', '5C/6K', '6F/M10'], to: ['2E/3G', '2Y/3G', '3E/4G', '5E/6K', '6C/M10', '6F/M+'], shown: 'printed' },
  { id: 'ER-31', program: 'V-EXP9', from: ['4G/4H', 'D16/M-'], to: ['4G/5H', 'D16/M+'], shown: 'both' },
  { id: 'ER-32', program: 'V-EXP10', from: ['3J/4X', '3N/6Y', '4H/5N', '4K/5N', '5L/6G'], to: ['3J/4K', '3Y/4Y', '4J/4X', '4X/6L', '5N/6K'], shown: 'printed' },
  { id: 'ER-34', program: 'V-EXP14', from: ['4F/5G'], to: ['4F/4G'], shown: 'both' },
  { id: 'ER-36', program: 'V-EXP16', from: ['5X/6E'], to: ['5X/6C'], shown: 'both' },
];

/**
 * Records that are not a runnable circuit on their own, and why: sub-circuits and fragments that other
 * records build on. Complete programs that reuse or modify another record's wiring are standalone;
 * `flags.deltaOf` carries that dependency.
 */
const NOT_STANDALONE: Readonly<Record<string, string>> = {
  'I-PROBLEMS': 'problem set: twenty answer programs in a prose table, not one circuit',
  'IV-SELFHOLD': 'sub-circuit: the title says it is the base of IV-FF1 (its stage 1)',
  'V-JOBSELECT': 'fragment: one section of six identical sections',
  'VI-SEQREC': 'sub-circuit shared by VI-SECRETCODE, VI-COMBOLOCK and VI-MAZE',
};

/**
 * Composition the record states in words but that does not reduce to base + one fixed table. These
 * get `wiresEffective: null` and the reason, rather than a guess.
 */
const EFFECTIVE_UNRESOLVED: Readonly<Record<string, string>> = {
  'I-PROBLEMS': 'problem set: each of the twenty answers is its own alternative program (prose table, not a wire table)',
  'IV-EXP3': 'delta: remove/add modification of IV-EXP1 (and a second one for the alternate counter), resolved by hand in its batch',
  'IV-EXP7': 'delta: remove/add modification of IV-EXP6 (and an alternate-counter variant), resolved by hand in its batch',
  'VI-COMBOLOCK': 'VI-SEQREC + D16/M+ + a player-chosen combination; the printed combination table has prose cells and is one example',
  'VI-MAZE': 'VI-SEQREC + a loose-ended play wire at M+ + one of two alternative example path programs; no single composition',
};

// =================================================================================================
// Source parsing
// =================================================================================================

const CELL = /^`([^`]+)`$/;

interface Table { label: string; colMajor: boolean; rows: (string | null)[][]; tokens: string[] }
interface Block {
  id: string;
  title: string;
  start: number; // 0-based index of the heading line
  lines: string[];
  text: string;
  tables: Table[];
}
interface IndexRow { id: string; printed: string; pdf: string; wires: string; tier: string; tag: string }

function parseBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const close = (): void => {
    if (cur !== null) {
      cur.text = cur.lines.join('\n');
      blocks.push(cur);
    }
    cur = null;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const h3 = /^### ([A-Z0-9-]+) — (.*)$/.exec(line);
    // The centrepiece is `## 1. Tic-Tac-Toe`, a level-2 heading (parsePrograms D4).
    const ttt = /^## 1\. Tic-Tac-Toe/.test(line);
    if (h3 !== null || ttt) {
      close();
      cur = { id: ttt ? 'VI-TICTACTOE' : (h3 as RegExpExecArray)[1] as string, title: ttt ? 'Tic-Tac-Toe' : (h3 as RegExpExecArray)[2] as string, start: i, lines: [line], text: '', tables: [] };
      continue;
    }
    if (/^#{1,3} /.test(line)) { close(); continue; }
    if (cur !== null) cur.lines.push(line);
  }
  close();
  for (const b of blocks) b.tables = parseTables(b.lines);
  return blocks;
}

/**
 * Wire tables of one record. Same row rule as parsePrograms D1; footnote `*` dropped. Empty cells are kept
 * while reading so a table labelled "read column-major" can be flattened column by column.
 */
function parseTables(lines: readonly string[]): Table[] {
  const out: Table[] = [];
  let prev = '';
  let tab: Table | null = null;
  let isWire = false;
  const clean = (c: string): string => ((CELL.exec(c) as RegExpExecArray)[1] as string).trim().replace(/\*+$/, '');
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) {
      tab = null;
      if (line.trim() !== '') prev = line.trim();
      continue;
    }
    if (/^\s*\|[\s|:-]+\|\s*$/.test(line)) { tab = { label: prev, colMajor: /read \**column-major/i.test(prev), rows: [], tokens: [] }; isWire = false; continue; }
    if (tab === null) continue;
    const raw = line.split('|').slice(1, -1).map((c) => c.trim());
    const filled = raw.filter((c) => c !== '');
    if (filled.length === 0) continue;
    if (!filled.every((c) => CELL.test(c))) { tab = null; continue; }
    if (!isWire) { out.push(tab); isWire = true; }
    tab.rows.push(raw.map((c) => (c === '' ? null : clean(c))));
  }
  for (const t of out) {
    if (t.colMajor) {
      const width = Math.max(...t.rows.map((r) => r.length));
      for (let c = 0; c < width; c++) for (const r of t.rows) { const v = r[c]; if (v !== undefined && v !== null) t.tokens.push(v); }
    } else {
      for (const r of t.rows) for (const v of r) if (v !== null) t.tokens.push(v);
    }
  }
  return out;
}

/** I-PROBLEMS' answer rows: `| n | `w` `w` ... | tag | note |`. */
function parseAnswers(lines: readonly string[]): Answer[] {
  const out: Answer[] = [];
  for (const line of lines) {
    const m = /^\|\s*(\d+)\s*\|([^|]*)\|([^|]*)\|/.exec(line);
    if (m === null) continue;
    const wires = [...(m[2] as string).matchAll(/`([^`]+)`/g)].map((x) => (x[1] as string).trim());
    if (wires.length === 0) continue;
    out.push({ n: Number(m[1]), wires, tag: (m[3] as string).trim() });
  }
  return out;
}

/** §3.2 errata rows: ER-nn -> the record ids its Affects cell names (cut at the first of ' — ', ' - ', ':', '(', '->'). */
function parseErrataAffects(lines: readonly string[], ids: ReadonlySet<string>): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const line of lines) {
    const m = /^\| (ER-\d\d) \| .* \| ([^|]*) \|$/.exec(line);
    if (m === null) continue;
    let cell = m[2] as string;
    let cut = cell.length;
    for (const d of [' — ', ' - ', ':', '(', '->']) { const at = cell.indexOf(d); if (at >= 0 && at < cut) cut = at; }
    cell = cell.slice(0, cut).replace(/`/g, '');
    const found = (cell.match(/[A-Z0-9]+(?:-[A-Z0-9]+)+/g) ?? []).filter((x) => ids.has(x));
    out.set(m[1] as string, found);
  }
  return out;
}

/** §4's index tables: `| `ID` | title | printed | pdf | wires | tier | tag |`. */
function parseIndex(lines: readonly string[]): Map<string, IndexRow> {
  const rows = new Map<string, IndexRow>();
  const from = lines.findIndex((l) => /^## 4\. The corpus/.test(l));
  for (let i = Math.max(from, 0); i < lines.length; i++) {
    const m = /^\|\s*`([A-Z0-9-]+)`\s*\|/.exec(lines[i] as string);
    if (m === null) continue;
    const cells = (lines[i] as string).split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 7) continue;
    const id = m[1] as string;
    if (rows.has(id)) continue;
    rows.set(id, { id, printed: cells[2] as string, pdf: cells[3] as string, wires: cells[4] as string, tier: cells[5] as string, tag: cells[6] as string });
  }
  return rows;
}

/** §0's free-ended-wire table: the first backticked cell of each row between its header and the prose after it. */
function parseFreeWirePrograms(lines: readonly string[]): Set<string> {
  const ids = new Set<string>();
  const from = lines.findIndex((l) => /^\*\*Free-ended wires/.test(l));
  if (from < 0) return ids;
  for (let i = from + 1; i < lines.length; i++) {
    const line = lines[i] as string;
    if (/^## /.test(line)) break;
    const m = /^\|\s*`([A-Z0-9-]+)`\s*\|/.exec(line);
    if (m !== null) ids.add(m[1] as string);
    else if (ids.size > 0 && !/^\s*\|/.test(line)) break;
  }
  return ids;
}

function errataRow(lines: readonly string[], id: string): string {
  const row = lines.find((l) => l.startsWith('| ' + id + ' |'));
  return row ?? '';
}

// =================================================================================================
// Derivation
// =================================================================================================

/** Replace `from[i]` by `to[i]` in place; surplus removals are dropped, surplus additions appended. */
function applyErratum(list: readonly string[], from: readonly string[], to: readonly string[]): { wires: string[]; missing: string[] } {
  const wires = list.slice();
  const missing: string[] = [];
  const claimed = new Set<number>();
  const drop: number[] = [];
  const extra: string[] = [];
  for (let i = 0; i < Math.max(from.length, to.length); i++) {
    const f = from[i];
    const t = to[i];
    if (f !== undefined) {
      let at = -1;
      for (let j = 0; j < wires.length; j++) if (!claimed.has(j) && wires[j] === f) { at = j; break; }
      if (at < 0) { missing.push(f); if (t !== undefined) extra.push(t); continue; }
      claimed.add(at);
      if (t !== undefined) wires[at] = t;
      else drop.push(at);
    } else if (t !== undefined) extra.push(t);
  }
  const kept = wires.filter((_, j) => !drop.includes(j));
  return { wires: kept.concat(extra), missing };
}

function sameSeq(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function pairKey(w: string): string {
  const [a, b] = w.split('/');
  if (a === undefined || b === undefined) return w;
  return a <= b ? a + '/' + b : b + '/' + a;
}

function multisetDiff(a: readonly string[], b: readonly string[]): { onlyA: string[]; onlyB: string[] } {
  const bag = new Map<string, number>();
  for (const w of b) bag.set(pairKey(w), (bag.get(pairKey(w)) ?? 0) + 1);
  const onlyA: string[] = [];
  for (const w of a) {
    const k = pairKey(w);
    const n = bag.get(k) ?? 0;
    if (n > 0) bag.set(k, n - 1);
    else onlyA.push(w);
  }
  const onlyB: string[] = [];
  for (const [k, n] of bag) for (let i = 0; i < n; i++) onlyB.push(k);
  return { onlyA: onlyA.sort(), onlyB: onlyB.sort() };
}

function bookOf(id: string): string {
  if (id.startsWith('ER-')) return 'ERRATA';
  if (id.startsWith('MM-')) return 'MM';
  return id.split('-')[0] as string;
}

function isFreeEnded(token: string): boolean {
  return token.split('/').some((p) => /^free/i.test(p.trim()));
}

function terminalsOf(token: string): string[] {
  return token.split('/').map((p) => p.trim());
}

function badTerminalsOf(wires: readonly string[]): { bad: string[]; free: string[] } {
  const bad: string[] = [];
  const free: string[] = [];
  for (const w of wires) {
    if (isFreeEnded(w)) { if (!free.includes(w)) free.push(w); continue; }
    try { parseTerminalWire(w); } catch { if (!bad.includes(w)) bad.push(w); }
  }
  return { bad, free };
}

/**
 * Relay-section lint. A coil is driven through `nC` (lamp in series) or `nE` (lamp bypassed) and
 * returns at `nF`. `nC` wired with neither `nE` nor `nF` wired drives nothing, and `nF` wired with
 * neither `nC` nor `nE` returns nothing. `nC` with `nE` and no `nF` is NOT flagged: that is the
 * indicator lamp used as a lamp (`nC`-`nE` is the lamp's own pair), which many programs do. This is a
 * lint on the list, not a claim about the circuit; it is the shape II-EXP1 has (`5G/5C`, no `5F/5-`).
 */
function coilEndsOf(wires: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const w of wires) for (const t of terminalsOf(w)) seen.add(t);
  const out: string[] = [];
  for (let n = 1; n <= 6; n++) {
    const c = seen.has(n + 'C');
    const e = seen.has(n + 'E');
    const f = seen.has(n + 'F');
    if (c && !e && !f) out.push('section ' + n + ': ' + n + 'C is wired but neither ' + n + 'E nor ' + n + 'F is (coil never returned)');
    if (f && !c && !e) out.push('section ' + n + ': ' + n + 'F is wired but neither ' + n + 'C nor ' + n + 'E is (coil never driven)');
  }
  return out;
}

const MANUAL_RELAY = /manual relay actuation|manually (?:push|move|operate|set)\w*[^.\n]*relay|push the relay crossbar|pushing the plastic crossbar/i;
const TOUCH = /touching the terminal will make the contact/i;

// =================================================================================================
// Build
// =================================================================================================

interface Own {
  block: Block;
  stated: number | null;
  requires: string | null;
  requiresTotal: number | null;
  baseOf: string | null; // composition base: Requires / NO NEW WIRING / SAME WIRING AS
  composes: 'requires' | 'same' | null;
  modifies: string | null;
  printed: string[];
  corrected: string[];
  errata: ErratumRef[];
  multiTable: boolean;
  tableMatches: number;
  tableCount: number;
}

function readOwn(block: Block, byId: ReadonlySet<string>, lines: readonly string[], fail: (id: string, check: string, detail: string) => void): Own {
  const id = block.id;
  let stated: number | null = null;
  let requires: string | null = null;
  let requiresTotal: number | null = null;
  let baseOf: string | null = null;
  let composes: 'requires' | 'same' | null = null;
  for (const line of block.lines) {
    const w = /·\s*(\d+)\s*wires?\s*·/.exec(line);
    if (w !== null && stated === null) stated = Number(w[1]);
    const req = /^Requires\s+`([A-Z0-9-]+)`/.exec(line);
    if (req !== null && requires === null) {
      requires = req[1] as string;
      const tot = /(\d+)\s+total/.exec(line);
      if (tot !== null) requiresTotal = Number(tot[1]);
    }
    const same = /^SAME WIRING AS ([A-Z0-9-]+)/.exec(line);
    if (same !== null && baseOf === null) { baseOf = same[1] as string; composes = 'same'; }
    const nnw = /^NO NEW WIRING - uses the Experiment (\d+) /.exec(line);
    if (nnw !== null && baseOf === null) { baseOf = id.split('-')[0] + '-EXP' + nnw[1]; composes = 'same'; }
  }
  if (requires !== null) { baseOf = requires; composes = 'requires'; }
  const meta = block.lines.find((l, i) => i > 0 && l.trim() !== '') ?? '';
  const mod = /modifies\s+`([A-Z0-9-]+)`/.exec(meta);
  // IV-FF2-CARRY: "`IV-FF2`'s 14 wires plus the four printed additions" (its own table is the full list).
  const plus = /^`([A-Z0-9-]+)`'s \d+ wires plus the/.exec(block.lines.find((l, i) => i > 0 && l.trim() !== '' && !/^Book /.test(l)) ?? '');
  const modifies = mod !== null ? (mod[1] as string) : plus !== null ? (plus[1] as string) : null;
  if (baseOf !== null && !byId.has(baseOf)) fail(id, 'composition', 'base ' + baseOf + ' is not a record');
  if (modifies !== null && !byId.has(modifies)) fail(id, 'composition', 'modifies ' + modifies + ', which is not a record');

  // Tables: the record's own "Corrected wire list" (the errata-applied one) is told apart by its label.
  const corrTables = block.tables.filter((t) => /corrected wire list/i.test(t.label));
  const others = block.tables.filter((t) => !/corrected wire list/i.test(t.label));
  let printedTbl: Table | null = null;
  let matchCount = 0;
  if (others.length > 0) {
    const match = stated === null ? [] : others.filter((t) => t.tokens.length === stated);
    matchCount = match.length;
    // D2: the last table matching the stated count; with no match (or no count) the first table.
    printedTbl = match.length > 0 ? (match[match.length - 1] as Table) : (others[0] as Table);
  }
  const correctedTbl = corrTables.length > 0 ? (corrTables[corrTables.length - 1] as Table) : null;
  const multiTable = others.length > 1;

  const errata: ErratumRef[] = [];
  let printed = printedTbl === null ? [] : printedTbl.tokens.slice();
  let corrected = correctedTbl !== null ? correctedTbl.tokens.slice() : printed.slice();
  for (const e of ERRATA.filter((x) => x.program === id)) {
    const row = errataRow(lines, e.id);
    for (const t of [...e.from, ...e.to]) if (!row.includes(t)) fail(id, 'errata', e.id + ' token ' + t + ' is not in the §3.2 row for ' + e.id);
    errata.push({ id: e.id, from: e.from.slice(), to: e.to.slice() });
    if (e.shown === 'corrected') {
      const back = applyErratum(printed, e.to, e.from);
      for (const m of back.missing) fail(id, 'errata', e.id + ' corrected token ' + m + ' is not in the record table');
      corrected = printed.slice();
      printed = back.wires;
    } else if (e.shown === 'printed') {
      const fwd = applyErratum(printed, e.from, e.to);
      for (const m of fwd.missing) fail(id, 'errata', e.id + ' removal target ' + m + ' is not in the printed table');
      corrected = fwd.wires;
    } else {
      if (printedTbl === null || correctedTbl === null) fail(id, 'errata', e.id + ' expects both a printed and a corrected table');
    }
  }
  // 'both' records: the two tables must differ by exactly the errata, in order.
  if (correctedTbl !== null) {
    let derived = printed.slice();
    for (const e of errata) derived = applyErratum(derived, e.from, e.to).wires;
    if (!sameSeq(derived, corrected)) fail(id, 'errata', 'applying ' + errata.map((e) => e.id).join('+') + ' to the printed table does not give the record\'s corrected table');
    if (errata.length === 0) fail(id, 'errata', 'record prints a corrected table but no ERRATA entry covers it');
  }
  return { block, stated, requires, requiresTotal, baseOf, composes, modifies, printed, corrected, errata, multiTable, tableMatches: matchCount, tableCount: others.length };
}

export function buildCorpus(input: { text: string; fixtures: readonly FixtureRef[]; printedClass: readonly PrintedClassEntry[] | null }): BuildResult {
  const failures: Failure[] = [];
  const fail = (id: string, check: string, detail: string): void => { failures.push({ id, check, detail }); };
  const lines = input.text.split('\n');
  const blocks = parseBlocks(lines);
  const index = parseIndex(lines);
  const freeSet = parseFreeWirePrograms(lines);
  const ids = new Set(blocks.map((b) => b.id));
  if (ids.size !== blocks.length) fail('-', 'records', 'duplicate record ids in programs.md');
  for (const f of freeSet) if (!ids.has(f)) fail(f, 'flags', 'the §0 free-ended-wire table names a program that is not a record');
  for (const k of index.keys()) if (!ids.has(k)) fail(k, 'index', 'a §4 index row has no record');

  const owns = new Map<string, Own>();
  for (const b of blocks) owns.set(b.id, readOwn(b, ids, lines, fail));

  // wiresEffective, resolved through the composition chain.
  const effCache = new Map<string, { wires: string[] | null; note: string | null }>();
  const effective = (id: string, stack: readonly string[]): { wires: string[] | null; note: string | null } => {
    const hit = effCache.get(id);
    if (hit !== undefined) return hit;
    const own = owns.get(id) as Own;
    let res: { wires: string[] | null; note: string | null };
    const unresolved = EFFECTIVE_UNRESOLVED[id];
    if (unresolved !== undefined) res = { wires: null, note: unresolved };
    else if (stack.includes(id)) res = { wires: null, note: 'composition cycle through ' + id };
    else if (own.baseOf !== null) {
      const base = effective(own.baseOf, [...stack, id]);
      if (base.wires === null) res = { wires: null, note: 'base ' + own.baseOf + ' has no effective wires: ' + (base.note ?? '') };
      else res = { wires: base.wires.concat(own.corrected), note: null };
    } else if (own.corrected.length > 0) res = { wires: own.corrected.slice(), note: null };
    else res = { wires: null, note: 'no wire table in the record (prose-only)' };
    effCache.set(id, res);
    return res;
  };

  // Fixtures: longest record id that is the fixture id, or its id plus "-".
  const sortedIds = [...ids].sort((a, b) => b.length - a.length || (a < b ? -1 : 1));
  const fixturesOf = new Map<string, FixtureRef[]>();
  for (const fx of input.fixtures) {
    const owner = sortedIds.find((id) => fx.id === id || fx.id.startsWith(id + '-'));
    if (owner === undefined) { fail(fx.id, 'fixtures', 'fixture ' + fx.path + ' matches no program id'); continue; }
    const list = fixturesOf.get(owner) ?? [];
    list.push(fx);
    fixturesOf.set(owner, list);
  }

  const affects = parseErrataAffects(lines, ids);
  const programs: CorpusProgram[] = [];
  for (const b of blocks) {
    const own = owns.get(b.id) as Own;
    const row = index.get(b.id);
    if (row === undefined) fail(b.id, 'index', 'no §4 index row (page, tier and tag fall back to the record\'s own metadata line)');
    const meta = b.lines.find((l, i) => i > 0 && l.trim() !== '') ?? '';
    const metaTag = /\*\*\[(verified|likely|unverified)\]/.exec(meta);
    const metaTier = /\btier (A|B|C1|C2|D)\b/.exec(meta);
    const idxTag = row === undefined ? null : /\[(verified|likely|unverified)\]/.exec(row.tag);
    const idxTier = row === undefined ? null : (row.tier === '—' || row.tier === '' ? null : row.tier);
    const tag = (idxTag?.[1] ?? metaTag?.[1] ?? 'unverified');
    const tierVal = row === undefined ? (metaTier?.[1] ?? null) : idxTier;
    let indexAgrees = true;
    if (row !== undefined) {
      if (metaTag !== null && idxTag !== null && metaTag[1] !== idxTag[1]) { indexAgrees = false; fail(b.id, 'index', 'tag: index says ' + idxTag[1] + ', record says ' + metaTag[1]); }
      if (idxTier !== null && metaTier !== null && metaTier[1] !== idxTier) { indexAgrees = false; fail(b.id, 'index', 'tier: index says ' + idxTier + ', record says ' + metaTier[1]); }
      if (/^\d+$/.test(row.wires) && own.stated !== null && Number(row.wires) !== own.stated) { indexAgrees = false; fail(b.id, 'index', 'wire count: index says ' + row.wires + ', record says ' + own.stated); }
    }

    const eff = effective(b.id, []);
    const deltaOf = own.modifies ?? own.baseOf;
    // Tokens the flags look at: the effective list, else the record's own plus its base's.
    const baseEff = own.baseOf !== null ? effective(own.baseOf, []).wires : null;
    const verifiedAnswers = b.id === 'I-PROBLEMS' ? parseAnswers(b.lines).filter((a) => a.tag.startsWith('[verified')).flatMap((a) => a.wires) : [];
    const flagTokens = eff.wires ?? [...own.corrected, ...(baseEff ?? []), ...verifiedAnswers];
    const motor = flagTokens.some((w) => terminalsOf(w).some((t) => t === 'D17' || t === 'D18' || t === 'D19'));
    const freeTokens = flagTokens.some(isFreeEnded);
    const freeWire = freeSet.has(b.id) || freeTokens;
    const touch = TOUCH.test(b.text);
    const manualRelay = MANUAL_RELAY.test(b.text);
    const standaloneReason = NOT_STANDALONE[b.id] ?? null;

    const { bad, free } = badTerminalsOf(own.corrected);
    const coilEnds = eff.wires === null ? coilEndsOf(own.corrected) : coilEndsOf(eff.wires);
    const countMatches = own.stated === null ? null : own.corrected.length === own.stated;
    const effectiveCountMatches = own.requiresTotal === null || eff.wires === null ? null : eff.wires.length === own.requiresTotal;

    const fxs = (fixturesOf.get(b.id) ?? []).slice().sort((a, c) => (a.path < c.path ? -1 : 1));
    const diffs: FixtureDiff[] = [];
    for (const fx of fxs) {
      const d = multisetDiff(own.corrected, fx.wires);
      if (d.onlyA.length > 0 || d.onlyB.length > 0) diffs.push({ fixture: fx.path, onlyCorpus: d.onlyA, onlyFixture: d.onlyB });
    }
    const errataApplied = own.errata.length === 0 || !sameSeq(own.printed, own.corrected);

    const refs: string[] = [];
    for (const [erId, affected] of affects) if (affected.includes(b.id)) refs.push(erId);

    let holesFit = true;
    try {
      allocateHoles(own.corrected.filter((w) => !isFreeEnded(w) && !bad.includes(w)).map((w) => parseTerminalWire(w)));
    } catch (e) {
      if (!(e instanceof HoleAllocationError)) throw e;
      holesFit = false;
      fail(b.id, 'holes', e.message);
    }

    const checks: Checks = {
      countMatches,
      effectiveCountMatches,
      badTerminals: bad,
      freeEnded: free,
      coilEnds,
      errataApplied,
      holesFit,
      indexAgrees,
      fixtureWiresMatch: fxs.length === 0 ? null : diffs.length === 0,
      fixtureDiffs: diffs,
    };
    if (countMatches === false) fail(b.id, 'countMatches', 'corrected ' + own.corrected.length + ' wires, record states ' + own.stated + (own.printed.length !== own.corrected.length ? ' (printed ' + own.printed.length + ')' : ''));
    if (effectiveCountMatches === false) fail(b.id, 'effectiveCountMatches', 'effective ' + (eff.wires as string[]).length + ' wires, record states ' + own.requiresTotal + ' total');
    if (bad.length > 0) fail(b.id, 'badTerminals', bad.length + ' of ' + own.corrected.length + ': ' + bad.slice(0, 6).join(' ') + (bad.length > 6 ? ' ...' : ''));
    for (const c of coilEnds) fail(b.id, 'coilEnds', c);
    for (const d of diffs) fail(b.id, 'fixtureWiresMatch', d.fixture + ': corpus-only [' + d.onlyCorpus.join(' ') + '] fixture-only [' + d.onlyFixture.join(' ') + ']');
    if (own.multiTable && own.tableMatches !== 1) fail(b.id, 'tables', 'record prints ' + own.tableCount + ' wire tables (stated count ' + (own.stated ?? 'none') + '); the ' + (own.tableMatches > 0 ? 'last matching' : 'first') + ' is used');

    programs.push({
      id: b.id,
      book: bookOf(b.id),
      title: b.title,
      printedPage: row?.printed ?? '',
      pdfPage: row?.pdf ?? '',
      tier: tierVal,
      tag,
      statedWires: own.stated,
      wiresPrinted: own.printed,
      wiresCorrected: own.corrected,
      errata: own.errata,
      errataRefs: refs,
      flags: { motor, freeWire, touch, manualRelay, deltaOf, standalone: standaloneReason === null },
      standaloneReason,
      wiresEffective: eff.wires,
      wiresEffectiveNote: eff.note,
      fixtures: fxs.map((f) => f.path),
      checks,
      answers: b.id === 'I-PROBLEMS' ? parseAnswers(b.lines) : null,
      printedClass: null,
      printedEvidence: null,
      printedUnprinted: null,
    });
  }
  const nonMM = programs.filter((p) => p.book !== 'MM').length;
  if (nonMM !== 98) fail('-', 'records', nonMM + ' non-MM records; programs.md states 98 (C-21); IV-FF2-CARRY has its own heading and index row');

  const recordText = new Map<string, string>();
  for (const b of blocks) recordText.set(b.id, b.text);
  if (input.printedClass !== null) mergePrintedClass(programs, input.printedClass, recordText);

  const corpus: Corpus = {
    schema: 'minivac.corpus/1',
    source: { path: PROGRAMS_MD_REL, sha256: createHash('sha256').update(input.text).digest('hex') },
    programs,
  };
  return { corpus, failures, recordText };
}

/** Merge printed-class.json into the programs. Throws on a missing or extra id, or evidence that is not verbatim. */
export function mergePrintedClass(programs: CorpusProgram[], entries: readonly PrintedClassEntry[], recordText: ReadonlyMap<string, string>): void {
  const byId = new Map<string, PrintedClassEntry>();
  for (const e of entries) {
    if (byId.has(e.id)) throw new Error('printed-class: duplicate id ' + e.id);
    byId.set(e.id, e);
  }
  const missing = programs.filter((p) => !byId.has(p.id)).map((p) => p.id);
  const known = new Set(programs.map((p) => p.id));
  const extra = [...byId.keys()].filter((k) => !known.has(k));
  if (missing.length > 0) throw new Error('printed-class: missing ' + missing.length + ' id(s): ' + missing.join(' '));
  if (extra.length > 0) throw new Error('printed-class: extra ' + extra.length + ' id(s): ' + extra.join(' '));
  for (const p of programs) {
    const e = byId.get(p.id) as PrintedClassEntry;
    const text = recordText.get(p.id) as string;
    for (const s of e.printedEvidence) {
      if (typeof s !== 'string' || s === '') throw new Error('printed-class: ' + p.id + ' has an empty or non-string evidence entry');
      if (!text.includes(s)) throw new Error('printed-class: ' + p.id + ' evidence is not a verbatim substring of its programs.md record: ' + JSON.stringify(s.slice(0, 80)));
    }
    p.printedClass = e.printedClass;
    p.printedEvidence = e.printedEvidence;
    p.printedUnprinted = e.printedUnprinted;
  }
}

// =================================================================================================
// I/O
// =================================================================================================

export function readPrintedClass(path: string): PrintedClassEntry[] | null {
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, 'utf8')) as { schema?: unknown; programs?: unknown } | null;
  if (raw === null || typeof raw !== 'object' || raw.schema !== 'minivac.printed-class/1' || !Array.isArray(raw.programs)) {
    throw new Error('printed-class: ' + path + ' is not {schema: "minivac.printed-class/1", programs: [...]}');
  }
  return raw.programs.map((x: unknown, i: number) => {
    const e = x as { id?: unknown; class?: unknown; evidence?: unknown; unprinted?: unknown } | null;
    if (e === null || typeof e !== 'object' || typeof e.id !== 'string' || (e.class !== 'yes' && e.class !== 'partial' && e.class !== 'no') ||
      !Array.isArray(e.evidence) || !e.evidence.every((v) => typeof v === 'string') || (e.unprinted !== undefined && typeof e.unprinted !== 'string')) {
      throw new Error('printed-class: entry ' + i + ' needs {id, class: yes|partial|no, evidence: string[], unprinted?: string}');
    }
    if (e.class !== 'no' && e.evidence.length === 0) throw new Error('printed-class: ' + e.id + ' is class ' + e.class + ' with no evidence');
    return { id: e.id, printedClass: e.class, printedEvidence: e.evidence as string[], printedUnprinted: (e.unprinted as string | undefined) ?? null };
  });
}

export function readFixtures(): FixtureRef[] {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as { fixtures: { path: string }[] };
  return manifest.fixtures.map((f) => {
    const fx = JSON.parse(readFileSync(FIXTURE_DIR + f.path, 'utf8')) as { id?: unknown; wires?: unknown };
    const base = (f.path.split('/').pop() as string).replace(/\.fixture\.json$/, '');
    const wires = Array.isArray(fx.wires) ? (fx.wires as unknown[]).map(String) : [];
    return { path: f.path, id: typeof fx.id === 'string' ? fx.id : base, wires };
  });
}

/** Stable pretty-printer: objects one key per line, arrays of primitives on one line. */
export function serialize(value: unknown, indent = ''): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.every((v) => v === null || typeof v !== 'object')) return '[' + value.map((v) => JSON.stringify(v)).join(', ') + ']';
    const inner = indent + '  ';
    return '[\n' + value.map((v) => inner + serialize(v, inner)).join(',\n') + '\n' + indent + ']';
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  const inner = indent + '  ';
  return '{\n' + entries.map(([k, v]) => inner + JSON.stringify(k) + ': ' + serialize(v, inner)).join(',\n') + '\n' + indent + '}';
}

export function serializeCorpus(c: Corpus): string {
  return serialize(c) + '\n';
}

export function summaryLine(r: BuildResult): string {
  const ps = r.corpus.programs;
  const wires = ps.reduce((n, p) => n + p.wiresCorrected.length, 0);
  const withErr = ps.filter((p) => p.errata.length > 0).length;
  const classed = ps.filter((p) => p.printedClass !== null).length;
  return 'extract-corpus: ' + ps.length + ' programs (' + (ps.length - 1) + ' ### records + VI-TICTACTOE, the level-2 heading), ' +
    wires + ' corrected wires, ' + withErr + ' with wire-changing errata, ' +
    ps.filter((p) => p.wiresEffective === null).length + ' without effective wires, ' +
    ps.filter((p) => p.fixtures.length > 0).length + ' with fixtures, printedClass ' + (classed === 0 ? 'absent' : 'merged for ' + classed) + ', ' +
    r.failures.length + ' check failures';
}

function main(argv: readonly string[]): void {
  let out = PROGRAMS_JSON_PATH;
  let pc = PRINTED_CLASS_PATH;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i] as string;
    else if (argv[i] === '--printed-class') pc = argv[++i] as string;
    else throw new Error('extract-corpus: unknown argument ' + argv[i]);
  }
  const text = readFileSync(ROOT + PROGRAMS_MD_REL, 'utf8');
  const result = buildCorpus({ text, fixtures: readFixtures(), printedClass: readPrintedClass(pc) });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, serializeCorpus(result.corpus));
  let report = summaryLine(result) + '\n';
  for (const f of result.failures) report += f.id + ' ' + f.check + ': ' + f.detail + '\n';
  process.stdout.write(report);
}

const argv1 = process.argv[1];
if (argv1 !== undefined && argv1.endsWith('extract-corpus.ts')) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n');
    process.exitCode = 1;
  }
}
