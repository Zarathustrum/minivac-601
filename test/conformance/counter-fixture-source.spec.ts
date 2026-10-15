/**
 * W6 counter fixture source and measurement-input pins.
 *
 * The PDF and programs.md hashes bind the cited source container. The Wave C literal arrays and
 * W2's separately frozen static input then bind every endpoint and its order without parsing
 * Markdown. The 17-row slow script pins every printed cell, including three zeros that the PDF
 * text layer omits but the rendered source image shows.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { allocateHoles, parseTerminalWire } from '../../src/core/terminals.ts';
import { loadStaticInput } from '../../tools/check-netlist.ts';
import { COUNTER_PROGRAMS, validateProgramLiteral } from '../../tools/stamp-counter.ts';
import { readManifest } from './manifest.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE_DIR = ROOT + '/test/conformance/fixtures/B/';
const IDS = ['IV-EXP1-SLOW', 'IV-EXP1-FAST', 'ER-ALTCOUNTER'] as const;
type Id = (typeof IDS)[number];

const DECISION = 'docs/DECISIONS.md#2026-09-01-canonical-marginal-counter-ruling-after-w1';
const MAINTAINER_NOTE = 'Profile-dependent accepted margin: `dV_relay_mv`. ' +
  'SDC documented the original counter as marginal and supplied `ER-ALTCOUNTER`; this fixture ' +
  'does not identify the physical cause. Authority: `docs/DECISIONS.md`, “2026-09-01 — canonical ' +
  'marginal-counter ruling after W1”.';
const FALLBACK = 'FALLBACK-W6-ACTUAL-TAP-TRACE';
const MEASURED_CITE = 'docs/DECISIONS.md, 2026-09-02 — W6 measure-only counter trace';

interface Step {
  readonly k: string;
  readonly cmd?: Readonly<Record<string, unknown>>;
  readonly collapse?: true;
  readonly ms?: number;
  readonly maxMs?: number;
  readonly obs?: readonly { readonly dev: string; readonly v: string }[];
  readonly cite?: string;
  readonly quote?: string;
  readonly tag?: string;
  readonly source?: string;
}

interface FixtureDoc {
  readonly id: string;
  readonly source: string;
  readonly tier: string;
  readonly confidence: string;
  readonly profile: string;
  readonly contract: string;
  readonly as_printed: readonly string[];
  readonly errata_applied: readonly Readonly<Record<string, string>>[];
  readonly wires: readonly string[];
  readonly script: readonly Step[];
  readonly note?: string;
  readonly marginal?: true;
  readonly mechanism?: Readonly<Record<string, string>>;
}

const CHART = [
  '0 | NO | 0 | NO | 0 | UP | 0',
  '0 | NO | 0 | NO | 1 | DOWN |',
  '0 | NO | 0 | NO | 1 | UP | 1',
  '0 | NO | 1 | YES | 1 | DOWN |',
  '0 | NO | 1 | NO | 0 | UP | 2',
  '0 | NO | 1 | NO | 1 | DOWN |',
  '0 | NO | 1 | NO | 1 | UP | 3',
  '1 | YES | 1 | YES | 1 | DOWN |',
  '1 | NO | 0 | NO | 0 | UP | 4',
  '1 | NO | 0 | NO | 1 | DOWN |',
  '1 | NO | 1 | NO | 1 | UP | 5',
  '1 | NO | 1 | YES | 1 | DOWN |',
  '1 | NO | 1 | NO | 0 | UP | 6',
  '1 | NO | 1 | NO | 1 | DOWN |',
  '1 | NO | 1 | NO | 1 | UP | 7',
  '1 | YES | 1 | YES | 1 | DOWN |',
  '0 | NO | 0 | NO | 0 | UP | 0 or 8',
] as const;

function slowCite(row: number, suffix: string): string {
  return 'Book IV printed p.71 = book2-3-4.pdf PDF p.77, ' +
    'BINARY COUNTER — SEQUENCE OF OPERATIONS row ' + row + suffix;
}

const SLOW_CITES = [
  slowCite(1, '; ER-20'),
  slowCite(2, '; ER-20'),
  slowCite(3, '; output-light assignment on printed p.72'),
  slowCite(4, '; ER-20'),
  slowCite(5, '; rendered source image confirms Flip-Flop C = 0; ER-20'),
  slowCite(6, '; ER-20'),
  slowCite(7, '; ER-20'),
  slowCite(8, '; ER-20'),
  slowCite(9, '; rendered source image confirms Flip-Flop C = 0; ER-20'),
  slowCite(10, '; ER-20'),
  slowCite(11, '; ER-20'),
  slowCite(12, '; ER-20'),
  slowCite(13, '; rendered source image confirms Flip-Flop C = 0; ER-20'),
  slowCite(14, '; ER-20'),
  slowCite(15, '; ER-20'),
  slowCite(16, '; ER-20'),
  slowCite(17, '; output-light assignment on printed p.72; ER-20'),
] as const;

const SLOW_PROJECTIONS = [
  'outLamp4=off,outLamp5=off,outLamp6=off,pb6=nc',
  'outLamp4=off,outLamp5=off,outLamp6=on,pb6=no',
  'outLamp4=off,outLamp5=off,outLamp6=on,pb6=nc',
  'outLamp4=off,outLamp5=on,outLamp6=on,pb6=no',
  'outLamp4=off,outLamp5=on,outLamp6=off,pb6=nc',
  'outLamp4=off,outLamp5=on,outLamp6=on,pb6=no',
  'outLamp4=off,outLamp5=on,outLamp6=on,pb6=nc',
  'outLamp4=on,outLamp5=on,outLamp6=on,pb6=no',
  'outLamp4=on,outLamp5=off,outLamp6=off,pb6=nc',
  'outLamp4=on,outLamp5=off,outLamp6=on,pb6=no',
  'outLamp4=on,outLamp6=on,pb6=nc',
  'outLamp4=on,outLamp5=on,outLamp6=on,pb6=no',
  'outLamp4=on,outLamp5=on,outLamp6=off,pb6=nc',
  'outLamp4=on,outLamp5=on,outLamp6=on,pb6=no',
  'outLamp4=on,outLamp5=on,outLamp6=on,pb6=nc',
  'outLamp4=on,outLamp5=on,outLamp6=on,pb6=no',
  'outLamp4=off,outLamp5=off,outLamp6=off,pb6=nc',
] as const;

const MEASURED = Object.freeze<Record<Exclude<Id, 'IV-EXP1-SLOW'>, readonly string[]>>({
  'IV-EXP1-FAST': [
    'IV-EXP1-FAST count=0 phase=UP lamps=off,off,off',
    'IV-EXP1-FAST count=1 phase=DOWN lamps=off,off,dim',
    'IV-EXP1-FAST count=1 phase=UP lamps=off,off,on',
    'IV-EXP1-FAST count=2 phase=DOWN lamps=off,dim,on',
    'IV-EXP1-FAST count=2 phase=UP lamps=off,on,off',
    'IV-EXP1-FAST count=3 phase=DOWN lamps=off,on,dim',
    'IV-EXP1-FAST count=3 phase=UP lamps=off,on,on',
    'IV-EXP1-FAST count=4 phase=DOWN lamps=off,on,on',
    'IV-EXP1-FAST count=4 phase=UP lamps=off,dim,dim',
  ],
  'ER-ALTCOUNTER': [
    'ER-ALTCOUNTER count=0 phase=UP lamps=off,off,off',
    'ER-ALTCOUNTER count=1 phase=DOWN lamps=off,off,dim',
    'ER-ALTCOUNTER count=1 phase=UP lamps=off,off,on',
    'ER-ALTCOUNTER count=2 phase=DOWN lamps=off,dim,on',
    'ER-ALTCOUNTER count=2 phase=UP lamps=off,on,dim',
    'ER-ALTCOUNTER count=3 phase=DOWN lamps=off,on,dim',
    'ER-ALTCOUNTER count=3 phase=UP lamps=off,on,on',
    'ER-ALTCOUNTER count=4 phase=DOWN lamps=off,on,on',
    'ER-ALTCOUNTER count=4 phase=UP lamps=off,dim,dim',
  ],
});

function fixture(id: Id): FixtureDoc {
  return JSON.parse(readFileSync(FIXTURE_DIR + id + '.fixture.json', 'utf8')) as FixtureDoc;
}

function projection(step: Step): string {
  return step.obs?.map((obs) => obs.dev + '=' + obs.v).join(',') ?? '';
}

describe('W6 counter fixture reviewed inputs', () => {
  it('binds the two primary PDFs and canonical programs.md bytes', () => {
    const sources = [
      ['raw/pdf/book2-3-4.pdf', 2_933_205, '85a40731b0dbe9d9bd2c502155e22a78d26238ebd1c5f36dc8fd86436f8776f7', 'sha256'],
      ['raw/pdf/errata.pdf', 140_730, '33ede94ea3663e0a7e5b303efc3d965907eb37ac1dcb804cfc220b65b78b83e9', 'sha256'],
      // 2026-10-14 Phase 5 wave 3 (II-EXP1 5F/5-, ER-33 Affects, image-read records): old 245_727 / 21478560d04f7f7f733613f5c17bacc1.
      ['programs.md', 252_989, '612f296118a8c6458cf21e6aa5720d7b', 'md5'],
    ] as const;
    for (const [name, size, hash, algorithm] of sources) {
      const bytes = readFileSync(ROOT + '/docs/research/' + name);
      expect(bytes.length, name).toBe(size);
      expect(createHash(algorithm).update(bytes).digest('hex'), name).toBe(hash);
    }
  });

  it('owns exactly the three counter variants and pins every endpoint three ways', () => {
    const manifestPaths = new Set(readManifest().map((entry) => entry.path));
    for (const id of IDS) expect(manifestPaths.has('B/' + id + '.fixture.json'), id).toBe(true);

    const staticInput = loadStaticInput(JSON.parse(
      readFileSync(ROOT + '/data/kat/w2-at02-static.json', 'utf8'),
    ));
    for (const id of IDS) {
      const doc = fixture(id);
      const programId = id === 'ER-ALTCOUNTER' ? 'ER-ALTCOUNTER' : 'IV-EXP1';
      const sourceProgram = staticInput.programs.find((program) => program.id === programId);
      expect(doc.id).toBe(id);
      expect(doc.source).toBe('docs/research/programs.md#' + programId);
      expect(doc.tier).toBe('B');
      expect(doc.confidence).toBe('verified');
      expect(doc.profile).toBe('MV601-REF-A');
      expect(doc.contract).toBe('1.1.0');
      expect(doc.errata_applied).toEqual([]);
      expect(doc.as_printed).toEqual(COUNTER_PROGRAMS[programId]);
      expect(doc.wires).toEqual(COUNTER_PROGRAMS[programId]);
      expect(doc.wires).toEqual(sourceProgram?.wires.map((wire) => wire.a + '/' + wire.b));
      expect(validateProgramLiteral(programId, doc.wires).count).toBe(doc.wires.length);
      expect(() => allocateHoles(doc.wires.map(parseTerminalWire))).not.toThrow();
    }
  });

  it('pins all 17 printed chart rows including the three image-confirmed C zeros', () => {
    const expects = fixture('IV-EXP1-SLOW').script.filter((step) => step.k === 'expect');
    expect(expects.map((step) => step.cite)).toEqual(SLOW_CITES);
    expect(expects.map((step) => step.quote)).toEqual(CHART);
    expect(expects.map(projection)).toEqual(SLOW_PROJECTIONS);
    for (const row of [4, 8, 12]) {
      expect(expects[row]?.quote).toContain('| 0 | UP |');
      expect(expects[row]?.obs?.find((obs) => obs.dev === 'outLamp6')).toEqual({
        dev: 'outLamp6',
        v: 'off',
      });
    }
    expect(expects.some((step) => step.tag !== undefined || step.source !== undefined)).toBe(false);
    expect(fixture('IV-EXP1-SLOW').script.filter((step) => step.k === 'advance').map((step) => step.ms))
      .toEqual([80, 100, 80, 100, 80, 100, 80, 100, 80, 100, 80, 100, 80, 100, 80, 100]);
  });

  it('pins the preregistered 30 ms measured traces and exact marginal attribution', () => {
    for (const id of ['IV-EXP1-FAST', 'ER-ALTCOUNTER'] as const) {
      const doc = fixture(id);
      const expects = doc.script.filter((step) => step.k === 'expect');
      expect(expects.map((step) => step.cite)).toEqual(new Array<string>(9).fill(MEASURED_CITE));
      expect(expects.map((step) => step.quote)).toEqual(MEASURED[id]);
      expect(expects.every((step) => step.tag === 'unverified' && step.source === FALLBACK)).toBe(true);
      expect(doc.script.filter((step) => step.k === 'advance').map((step) => step.ms))
        .toEqual(new Array<number>(8).fill(30));
    }
    const marginal = fixture('IV-EXP1-FAST');
    expect(marginal.marginal).toBe(true);
    expect(marginal.mechanism).toEqual({ profileKey: 'dV_relay_mv', decision: DECISION });
    expect(marginal.note).toBe(MAINTAINER_NOTE);
    const control = fixture('ER-ALTCOUNTER');
    expect(control.marginal).toBeUndefined();
    expect(control.mechanism).toBeUndefined();
    expect(control.note).toBeUndefined();
    expect(MEASURED['IV-EXP1-FAST'].at(-1)).toContain('lamps=off,dim,dim');
    expect(MEASURED['ER-ALTCOUNTER'].at(-1)).toContain('lamps=off,dim,dim');
    expect(MEASURED['IV-EXP1-FAST'][4]?.split('lamps=')[1]).toBe('off,on,off');
    expect(MEASURED['ER-ALTCOUNTER'][4]?.split('lamps=')[1]).toBe('off,on,dim');
  });

  it('keeps every release explicit and collapse-tagged', () => {
    for (const id of IDS) {
      const releases = fixture(id).script.filter((step) =>
        step.k === 'do' && step.cmd?.['k'] === 'button' && step.cmd['target'] === 0);
      expect(releases.length, id).toBe(id === 'IV-EXP1-SLOW' ? 8 : 4);
      expect(releases.every((step) => step.collapse === true)).toBe(true);
    }
  });
});
