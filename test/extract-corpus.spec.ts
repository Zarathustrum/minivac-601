/**
 * `tools/extract-corpus.ts` under vitest: the extractor's own contract, and the checked-in
 * `test/conformance/corpus/programs.json` against a fresh run.
 *
 * What is asserted here is the extractor, not the corpus: the corpus's known defects (II-EXP1 is one
 * wire short of a circuit, IV-EXP10 prints 56 and corrects to 57) are asserted as REPORTED, because the
 * tool's job is to say so rather than to fix them.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePrograms } from '../tools/corpus-reachability.ts';
import {
  PRINTED_CLASS_PATH,
  PROGRAMS_JSON_PATH,
  buildCorpus,
  mergePrintedClass,
  readFixtures,
  readPrintedClass,
  serializeCorpus,
} from '../tools/extract-corpus.ts';
import type { CorpusProgram, PrintedClassEntry } from '../tools/extract-corpus.ts';

const ROOT = new URL('..', import.meta.url).pathname;
const TEXT = readFileSync(ROOT + 'docs/research/programs.md', 'utf8');
const FIXTURES = readFixtures();
const build = () => buildCorpus({ text: TEXT, fixtures: FIXTURES, printedClass: readPrintedClass(PRINTED_CLASS_PATH) });
const buildBare = () => buildCorpus({ text: TEXT, fixtures: FIXTURES, printedClass: null });
const R = build();
const byId = new Map(R.corpus.programs.map((p) => [p.id, p]));
const get = (id: string): CorpusProgram => {
  const p = byId.get(id);
  if (p === undefined) throw new Error('no program ' + id);
  return p;
};

describe('extract-corpus: records', () => {
  it('finds 101 `### ID —` records plus VI-TICTACTOE, the level-2 heading, and says so', () => {
    const h3 = TEXT.split('\n').filter((l) => /^### [A-Z0-9-]+ — /.test(l));
    expect(h3.length).toBe(101);
    expect(TEXT.split('\n').filter((l) => /^## 1\. Tic-Tac-Toe/.test(l)).length).toBe(1);
    expect(R.corpus.programs.length).toBe(102);
    expect(R.corpus.programs[0]?.id).toBe('VI-TICTACTOE');
    expect(R.corpus.programs.slice(1).map((p) => p.id)).toEqual(h3.map((l) => (/^### ([A-Z0-9-]+) — /.exec(l) as RegExpExecArray)[1]));
    expect(new Set(R.corpus.programs.map((p) => p.id)).size).toBe(102);
  });

  it('carries the Maintenance Manual checks separately and the books by id prefix', () => {
    expect(R.corpus.programs.filter((p) => p.book === 'MM').map((p) => p.id)).toEqual(['MM-PB-CHECK', 'MM-RLY-CHECK', 'MM-SW-CHECK']);
    expect(get('ER-ALTCOUNTER').book).toBe('ERRATA');
    expect(R.corpus.programs.filter((p) => p.book !== 'MM').length).toBe(99);
    // programs.md states 98 (C-21); IV-FF2-CARRY has its own heading, so the build reports the difference.
    expect(R.failures.some((f) => f.check === 'records' && /99 non-MM records/.test(f.detail))).toBe(true);
  });

  it('Tic-Tac-Toe keeps all 72 wires, the two free-ended ones included and flagged', () => {
    const t = get('VI-TICTACTOE');
    expect(t.wiresCorrected.length).toBe(72);
    expect(t.statedWires).toBe(72);
    expect(t.checks.countMatches).toBe(true);
    expect(t.checks.freeEnded).toEqual(['M10/free', 'M11/free']);
    expect(t.checks.badTerminals).toEqual([]);
    expect(t.flags.freeWire).toBe(true);
    expect(t.wiresCorrected).toContain('4G/5N'); // RUL-01: printed, not 'fixed' to 4N/5N
  });

  it('is byte-identical on a second run and matches the checked-in programs.json', () => {
    const a = serializeCorpus(build().corpus);
    expect(serializeCorpus(build().corpus)).toBe(a);
    expect(a.endsWith('\n') && !a.endsWith('\n\n')).toBe(true);
    expect(a.includes('\r')).toBe(false);
    expect(readFileSync(PROGRAMS_JSON_PATH, 'utf8')).toBe(a);
  });
});

const PRINTED_ONLY_TABLE = new Set(['IV-EXP10', 'V-EXP10']);
// parsePrograms reads every table row-major; these seven are printed "read column-major", so only the set agrees.
const COLUMN_MAJOR = new Set(['VI-TICTACTOE', 'II-EXP1', 'II-EXP2', 'II-EXP7', 'IV-FF2', 'IV-EXP1', 'ER-ALTCOUNTER']);

describe('extract-corpus: agreement with parsePrograms', () => {
  it('every record parsePrograms did not skip as unusable has the same wire list, in order', () => {
    const parsed = parsePrograms(TEXT);
    expect(parsed.map((p) => p.name)).toEqual(R.corpus.programs.map((p) => p.id));
    let compared = 0;
    for (const q of parsed) {
      // 'only the connections ADDED' is parsePrograms' own D6 skip: its wires are still the record's table.
      if (q.skip !== '' && !q.skip.startsWith('wire table is only the connections ADDED')) continue;
      // VI-MAZE prints two alternative path tables; parsePrograms takes the last (its D6 defect), this tool the first.
      if (q.name === 'VI-MAZE') continue;
      const mine = get(q.name);
      // parsePrograms applies no errata: it takes the record's table. For the two records whose only table is
      // the PRINTED one (ER-27, ER-32 are remove/add prose), that is wiresPrinted; elsewhere the table is, or
      // is the last of two ending in, the corrected one.
      const theirs = q.wires.map(([a, b]) => a + '/' + b);
      const ours = PRINTED_ONLY_TABLE.has(q.name) ? mine.wiresPrinted : mine.wiresCorrected;
      if (COLUMN_MAJOR.has(q.name)) expect(theirs.slice().sort(), q.name).toEqual(ours.slice().sort());
      else expect(theirs, q.name).toEqual(ours);
      expect(mine.statedWires, q.name).toBe(q.stated);
      compared++;
    }
    expect(compared).toBeGreaterThanOrEqual(85);
    // ...and for those two, the corrected list is NOT what parsePrograms (so the reachability census) ran.
    for (const id of PRINTED_ONLY_TABLE) expect(get(id).wiresCorrected, id).not.toEqual(get(id).wiresPrinted);
  });
});

describe('extract-corpus: column-major tables', () => {
  it('keeps the printed reading order, not the row order', () => {
    expect(get('VI-TICTACTOE').wiresPrinted.slice(0, 3)).toEqual(['1A/1N', '1B/1-', '1C/2C']);
    const slow = FIXTURES.find((f) => f.path === 'B/IV-EXP1-SLOW.fixture.json');
    expect(get('IV-EXP1').wiresCorrected).toEqual(slow?.wires);
    for (const id of COLUMN_MAJOR) expect(get(id).wiresPrinted.length, id).toBe(get(id).wiresCorrected.length);
  });
});

describe('extract-corpus: errata', () => {
  it('errataRefs come from the §3.2 Affects cells, not from mentions in the text', () => {
    expect(get('II-FF1').errataRefs).toEqual([]);
    expect(get('IV-FF1').errataRefs).toContain('ER-19');
    expect(get('V-EXP18').errataRefs).toEqual(['ER-37']);
    // 2026-10-14 (Phase 5 wave 3): ER-33's Affects cell no longer names V-EXP13 (ER-33 covers
    // Book V pp.21-22; V-EXP13 is p.24), so the ER-33 case moved to V-EXP12, which the cell still
    // names. Old assertion: V-EXP13 errataRefs contains 'ER-33'.
    expect(get('V-EXP12').errataRefs).toContain('ER-33');
    expect(get('V-EXP13').errataRefs).toEqual([]);
  });

  it('IV-EXP10 is reported for a wire list that needs three plugs on the two-hole terminal 3G', () => {
    expect(get('IV-EXP10').checks.holesFit).toBe(false);
    expect(R.failures.some((f) => f.id === 'IV-EXP10' && f.check === 'holes')).toBe(true);
    expect(get('I-EXP1').checks.holesFit).toBe(true);
  });

  it('II-2BUTTONMEM: printed keeps 1A/1C, corrected has 1A/1G, same length', () => {
    const p = get('II-2BUTTONMEM');
    expect(p.wiresPrinted).toContain('1A/1C');
    expect(p.wiresCorrected).not.toContain('1A/1C');
    expect(p.wiresCorrected).toContain('1A/1G');
    expect(p.wiresPrinted.length).toBe(p.wiresCorrected.length);
    expect(p.errata).toEqual([{ id: 'ER-05', from: ['1A/1C'], to: ['1A/1G'] }]);
  });

  it('IV-EXP10: 56 printed, 57 corrected, and the mismatch is reported rather than fixed', () => {
    const p = get('IV-EXP10');
    expect(p.wiresPrinted.length).toBe(56);
    expect(p.wiresCorrected.length).toBe(57);
    expect(p.statedWires).toBe(56);
    expect(p.checks.countMatches).toBe(false);
    expect(R.failures.some((f) => f.id === 'IV-EXP10' && f.check === 'countMatches')).toBe(true);
  });

  it('II-EXP1: the printed 5F return is present, the count matches at 26, and the lint is clean', () => {
    // 2026-10-14 (Phase 5 wave 3): the page image prints 5F/5-, which the old transcription
    // dropped, so the record went 25 -> 26 wires. Old assertion: coilEnds held one 'section 5: '
    // entry (the missing 5F return). The coil-end lint still runs; this record no longer trips it.
    const p = get('II-EXP1');
    expect(p.wiresPrinted).toContain('5F/5-');
    expect(p.wiresCorrected).toContain('5F/5-');
    expect(p.statedWires).toBe(26);
    expect(p.wiresPrinted.length).toBe(26);
    expect(p.checks.countMatches).toBe(true);
    expect(p.checks.coilEnds).toEqual([]);
    // The guard still bites: drop the printed 5F/5- from this record's table and the lint reports
    // relay 5's unreturned coil end again, exactly as it did on the old 25-wire transcription.
    const ROW = '| `1X/2X` | `6Z/6+` | `2H/1H` | `2G/2C` | `4Y/4G` | `5F/5-` |';
    expect(TEXT.split(ROW).length - 1).toBe(1);
    const dropped = buildCorpus({ text: TEXT.replace(ROW, ROW.replace('`5F/5-`', '')), fixtures: FIXTURES, printedClass: null });
    const q = dropped.corpus.programs.find((x) => x.id === 'II-EXP1');
    expect(q?.checks.coilEnds.length).toBe(1);
    expect(q?.checks.coilEnds[0]).toMatch(/^section 5: /);
    expect(dropped.failures.some((f) => f.id === 'II-EXP1' && f.check === 'coilEnds')).toBe(true);
  });

  it('III-MINDREADING prints 5V/45, which is not a terminal; the corrected list has 5V/4S', () => {
    const p = get('III-MINDREADING');
    expect(p.wiresPrinted).toContain('5V/45');
    expect(p.wiresCorrected).toContain('5V/4S');
    expect(p.checks.badTerminals).toEqual([]);
  });

  it('the nine wire-changing errata land on exactly nine programs, every id as printed', () => {
    const withErrata = R.corpus.programs.filter((p) => p.errata.length > 0);
    expect(withErrata.map((p) => p.id)).toEqual(['II-2BUTTONMEM', 'II-EXP6', 'III-RELAYAND', 'III-MINDREADING', 'IV-EXP10', 'V-EXP9', 'V-EXP10', 'V-EXP14', 'V-EXP16']);
    expect(withErrata.flatMap((p) => p.errata.map((e) => e.id))).toEqual(['ER-05', 'ER-06', 'ER-12', 'ER-14', 'ER-27', 'ER-31', 'ER-32', 'ER-34', 'ER-36']);
    for (const p of withErrata) expect(p.checks.errataApplied, p.id).toBe(true);
    // No errata check failed: every erratum token is in its §3.2 row and every printed/corrected pair derives.
    expect(R.failures.filter((f) => f.check === 'errata')).toEqual([]);
  });
});

describe('extract-corpus: composition, flags, fixtures', () => {
  it('wiresEffective follows NO NEW WIRING / SAME WIRING AS / Requires', () => {
    expect(get('IV-EXP2').wiresEffective).toEqual(get('IV-EXP1').wiresCorrected);
    expect(get('IV-EXP9').wiresEffective).toEqual(get('IV-EXP8').wiresCorrected);
    expect(get('VI-RANDOM').wiresEffective).toEqual(get('VI-FORTUNETELLER').wiresCorrected);
    const s = get('VI-SECRETCODE');
    expect(s.wiresEffective).toEqual([...get('VI-SEQREC').wiresCorrected, ...s.wiresCorrected]);
    expect(s.wiresEffective?.length).toBe(74);
    expect(s.checks.countMatches).toBe(true);
    expect(s.checks.effectiveCountMatches).toBe(true);
    expect(s.flags.deltaOf).toBe('VI-SEQREC');
    expect(s.flags.standalone).toBe(true);
    for (const id of ['IV-EXP2', 'IV-EXP9', 'VI-RANDOM', 'VI-MAZE']) expect(get(id).flags.standalone, id).toBe(true);
    for (const id of ['I-PROBLEMS', 'IV-SELFHOLD', 'V-JOBSELECT', 'VI-SEQREC']) expect(get(id).flags.standalone, id).toBe(false);
    expect(get('IV-FF2-CARRY').flags.deltaOf).toBe('IV-FF2');
    expect(get('IV-FF2-CARRY').wiresEffective?.length).toBe(18);
  });

  it('I-PROBLEMS carries its twenty answers, and is a motor program through the verified ones', () => {
    const a = get('I-PROBLEMS').answers;
    expect(a?.length).toBe(20);
    expect(a?.[12]).toEqual({ n: 13, wires: ['6+/6Y', '6X/6A', '6B/6-', '6X/D17', 'D18/M-'], tag: '[verified]' });
    expect(get('I-PROBLEMS').flags.motor).toBe(true);
    expect(get('I-PROBLEMS').wiresEffective).toBeNull();
    expect(get('I-EXP1').answers).toBeNull();
  });

  it('records that cannot be composed say why instead of guessing', () => {
    for (const id of ['I-PROBLEMS', 'IV-EXP3', 'IV-EXP7', 'VI-COMBOLOCK', 'VI-MAZE']) {
      expect(get(id).wiresEffective, id).toBeNull();
      expect(get(id).wiresEffectiveNote, id).toMatch(/\S/);
    }
    expect(get('IV-EXP3').flags.deltaOf).toBe('IV-EXP1');
    expect(get('IV-EXP7').flags.deltaOf).toBe('IV-EXP6');
  });

  it('flag sets are the ones programs.md names', () => {
    const ids = (k: 'freeWire' | 'touch' | 'manualRelay') => R.corpus.programs.filter((p) => p.flags[k]).map((p) => p.id);
    expect(ids('freeWire')).toEqual(['VI-TICTACTOE', 'V-EXP12', 'V-MAZESOLVER', 'VI-MAZE']);
    expect(ids('touch')).toEqual(['VI-MAZE']);
    expect(ids('manualRelay')).toEqual(['I-EXP6', 'I-EXP8', 'III-FARMER', 'IV-EXP5', 'VI-MAZE']);
    expect(get('I-EXP12').flags.motor).toBe(true);
    expect(get('I-EXP4').flags.motor).toBe(false);
    expect(get('I-PROBLEMS').flags.standalone).toBe(false);
  });

  it('section-less Maintenance Manual designators are reported, not guessed', () => {
    expect(get('MM-RLY-CHECK').checks.badTerminals).toContain('+/H');
    expect(get('MM-RLY-CHECK').wiresCorrected).toContain('+/H');
    expect(get('MM-PB-CHECK').checks.fixtureWiresMatch).toBe(false);
  });

  it('fixture ownership: longest id wins, and I-EXP1 does not claim I-EXP10', () => {
    expect(get('I-EXP1').fixtures).toEqual(['A/I-EXP1.fixture.json']);
    expect(get('I-EXP10').fixtures).toEqual(['A/I-EXP10.fixture.json']);
    expect(get('IV-FF2').fixtures).toEqual(['B/IV-FF2.fixture.json']);
    expect(get('IV-FF2-CARRY').fixtures).toEqual(['B/IV-FF2-CARRY-DERIVED.fixture.json', 'B/IV-FF2-CARRY.fixture.json']);
    expect(get('IV-EXP1').fixtures).toEqual(['B/IV-EXP1-DERIVED.fixture.json', 'B/IV-EXP1-FAST.fixture.json', 'B/IV-EXP1-SLOW.fixture.json']);
    expect(get('I-EXP8').fixtures).toEqual(['A/I-EXP8-STEP5.fixture.json']);
    expect(R.corpus.programs.reduce((n, p) => n + p.fixtures.length, 0)).toBe(FIXTURES.length);
    expect(get('I-EXP1').checks.fixtureWiresMatch).toBe(true);
    expect(get('ER-ALTCOUNTER').checks.fixtureWiresMatch).toBe(true);
  });
});

describe('extract-corpus: printed-class merge', () => {
  it('the checked-in printed-class.json merges into every entry', () => {
    const ps = R.corpus.programs;
    expect(ps.every((p) => p.printedClass !== null && Array.isArray(p.printedEvidence))).toBe(true);
    expect(ps.filter((p) => p.printedClass === 'no').every((p) => p.printedUnprinted !== null)).toBe(true);
    expect(ps.find((p) => p.id === 'VI-RANDOM')?.printedClass).toBe('no');
    expect(ps.find((p) => p.id === 'II-EXP1')?.printedClass).toBe('partial');
  });

  const entries = (): PrintedClassEntry[] =>
    R.corpus.programs.map((p) => ({ id: p.id, printedClass: 'yes' as const, printedEvidence: [(R.recordText.get(p.id) as string).split('\n')[2] as string].filter((s) => s !== ''), printedUnprinted: null }))
      .map((e) => (e.printedEvidence.length === 0 ? { ...e, printedEvidence: [(R.recordText.get(e.id) as string).split('\n')[0] as string] } : e));
  const fresh = (): CorpusProgram[] => buildBare().corpus.programs;

  it('is null when no file is given and merges when every id is present with verbatim evidence', () => {
    expect(fresh().every((p) => p.printedClass === null && p.printedEvidence === null && p.printedUnprinted === null)).toBe(true);
    const merged = fresh();
    mergePrintedClass(merged, entries(), R.recordText);
    expect(merged.every((p) => p.printedClass === 'yes')).toBe(true);
  });

  it('fails loudly on a missing id, an extra id, and evidence that is not verbatim', () => {
    expect(() => mergePrintedClass(fresh(), entries().slice(1), R.recordText)).toThrow(/missing 1 id\(s\): VI-TICTACTOE/);
    expect(() => mergePrintedClass(fresh(), [...entries(), { id: 'X-NOPE', printedClass: 'no', printedEvidence: ['x'], printedUnprinted: null }], R.recordText)).toThrow(/extra 1 id\(s\): X-NOPE/);
    const bad = entries();
    bad[5] = { ...(bad[5] as PrintedClassEntry), printedEvidence: ['this sentence is not in the record'] };
    expect(() => mergePrintedClass(fresh(), bad, R.recordText)).toThrow(/not a verbatim substring/);
    // Evidence quoted from a DIFFERENT record is not verbatim for this one either.
    const swapped = entries();
    swapped[1] = { ...(swapped[1] as PrintedClassEntry), printedEvidence: [(R.recordText.get('I-EXP2') as string).split('\n')[2] as string] };
    expect(() => mergePrintedClass(fresh(), swapped, R.recordText)).toThrow(/not a verbatim substring/);
  });

  it('CLI on a scratch copy: a complete file merges, a file missing one id exits 1 and writes nothing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'extract-corpus-'));
    const good = entries();
    const goodPath = join(dir, 'printed-class.json');
    const outPath = join(dir, 'programs.json');
    writeFileSync(goodPath, JSON.stringify({ schema: 'minivac.printed-class/1', programs: good.map((e) => ({ id: e.id, class: e.printedClass, evidence: e.printedEvidence })) }));
    const ok = spawnSync('node', [ROOT + 'tools/extract-corpus.ts', '--out', outPath, '--printed-class', goodPath], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect((JSON.parse(readFileSync(outPath, 'utf8')) as { programs: CorpusProgram[] }).programs.every((p) => p.printedClass === 'yes')).toBe(true);

    const badPath = join(dir, 'missing-one.json');
    const badOut = join(dir, 'bad-programs.json');
    writeFileSync(badPath, JSON.stringify({ schema: 'minivac.printed-class/1', programs: good.filter((e) => e.id !== 'I-EXP4').map((e) => ({ id: e.id, class: e.printedClass, evidence: e.printedEvidence })) }));
    const bad = spawnSync('node', [ROOT + 'tools/extract-corpus.ts', '--out', badOut, '--printed-class', badPath], { encoding: 'utf8' });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toMatch(/printed-class: missing 1 id\(s\): I-EXP4/);
    expect(() => readFileSync(badOut, 'utf8')).toThrow();
  });
});
