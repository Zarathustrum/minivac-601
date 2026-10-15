/**
 * `tools/corpus-smoke.ts` — fault smoke over the program corpus (Phase 5 Step 4).
 *
 *   node tools/corpus-smoke.ts     writes test/conformance/corpus/smoke.json and docs/research/corpus-smoke.md
 *
 * Builds each program's effective wiring on a Machine, powers on, presses every touched pushbutton and
 * throws every touched slide switch, settling after each action (architecture §13.5.2: quiet counter over
 * the 33-observable vector plus motionMask, `settle_quiet_ticks`, cap 5000 ticks). It records faults only:
 * breaker trips, chatter, no-settle, dial motion. It never compares against printed answers.
 *
 * Free-ended wires (`M10/free`) are plugged into the next free hole of the real terminal, with a `free` far end.
 * The breaker is reset only after the control that tripped it is back at rest (before each press or throw).
 * Output is deterministic: no timestamps, stable order, LF, trailing newline.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Command, CordEnd, Machine, Sect } from '../src/core/contract.ts';
import { createMachine } from '../src/core/machine.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import { loadProfile } from '../src/core/profile.ts';
import type { Profile } from '../src/core/profile.ts';
import { HoleAllocationError, TERMINALS, holeAt, parseTerminalId, parseTerminalWire, terminalIndex } from '../src/core/terminals.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PROGRAMS_JSON_PATH = ROOT + 'test/conformance/corpus/programs.json';
export const SMOKE_JSON_PATH = ROOT + 'test/conformance/corpus/smoke.json';
export const SMOKE_MD_PATH = ROOT + 'docs/research/corpus-smoke.md';

export type SmokeClass = 'ok' | 'trip' | 'chatter' | 'no-settle' | 'skipped';

export interface PhaseResult {
  phase: string;
  trips: number;
  chatter: string[];
  noSettle: boolean;
  dialChanges: number;
  motorMrpm: number;
  lamps: string[];
}

export interface SmokeResult {
  id: string;
  tier: string;
  motor: boolean;
  class: SmokeClass;
  reason: string | null;
  phases: PhaseResult[];
}

interface CorpusProgram {
  id: string;
  tier: string;
  flags: { motor: boolean; touch: boolean; standalone: boolean };
  standaloneReason: string | null;
  wiresEffective: string[] | null;
  wiresEffectiveNote: string | null;
  checks: { badTerminals: string[] };
}

let loaded: { netlist: ReturnType<typeof loadNetlist>; profile: Profile } | null = null;
function assets() {
  if (loaded === null) {
    loaded = {
      netlist: loadNetlist(new Uint8Array(readFileSync(ROOT + 'data/netlist.json'))),
      profile: loadProfile(JSON.parse(readFileSync(ROOT + 'data/profiles/MV601-REF-A.json', 'utf8'))),
    };
  }
  return loaded;
}

function must(m: Machine, c: Command): void {
  const r = m.apply(c);
  if (!r.ok) throw new Error('corpus-smoke: command rejected: ' + JSON.stringify(c) + ' ' + r.why);
}

const WORD = { out: 'o', ind: 'i' } as const;

function lampsLit(m: Machine): string[] {
  const s = m.snapshot();
  const lit: string[] = [];
  s.outLamps.forEach((l, i) => { if (l.cls !== 'off') lit.push(WORD.out + (i + 1) + (l.cls === 'dim' ? '~' : '')); });
  s.indLamps.forEach((l, i) => { if (l.cls !== 'off') lit.push(WORD.ind + (i + 1) + (l.cls === 'dim' ? '~' : '')); });
  return lit;
}

/** Run one phase: `act` issues commands, then settle exactly per §13.5.2 with events drained every tick. */
function phase(m: Machine, name: string, act: () => void): PhaseResult {
  const { profile } = assets();
  act();
  const quietNeeded = profile.v.settle_quiet_ticks;
  const cap = profile.v.settle_cap_us / profile.v.tick_us;
  const prev = new Int32Array(m.observables());
  let quiet = 0;
  let waited = 0;
  let trips = 0;
  let dialChanges = 0;
  const chatter = new Set<string>();
  while (waited < cap) {
    m.advance(1);
    waited++;
    for (const e of m.drainEvents()) {
      if (e.k === 'breaker.trip') trips++;
      else if (e.k === 'chatter') chatter.add(e.dev);
    }
    const cur = m.observables();
    let changed = false;
    for (let i = 0; i < cur.length; i++) {
      if (cur[i] !== prev[i]) {
        changed = true;
        if (i === 20) dialChanges++;
        prev[i] = cur[i] as number;
      }
    }
    if (!changed && m.motionMask() === 0) quiet++;
    else quiet = 0;
    if (quiet >= quietNeeded) break;
  }
  return {
    phase: name,
    trips,
    chatter: [...chatter].sort(),
    noSettle: quiet < quietNeeded,
    dialChanges,
    motorMrpm: m.snapshot().dial.mrpm,
    lamps: lampsLit(m),
  };
}

function cordEnds(wires: readonly string[]): [CordEnd, CordEnd][] {
  const used = new Map<number, number>();
  const take = (wire: number, id: string): CordEnd => {
    const t = parseTerminalId(id);
    const ti = terminalIndex(t);
    const n = (used.get(ti) ?? 0) + 1;
    if (n > (TERMINALS[ti]!).holes) throw new HoleAllocationError(wire, t);
    used.set(ti, n);
    return { k: 'hole', hole: holeAt(t, n).id };
  };
  return wires.map((w, i) => {
    const [a, b] = w.split('/') as [string, string];
    if (a === 'free' || b === 'free') {
      const end = take(i, a === 'free' ? b : a);
      return a === 'free' ? [{ k: 'free' }, end] : [end, { k: 'free' }];
    }
    parseTerminalWire(w);
    const ea = take(i, a);
    return [ea, take(i, b)];
  });
}

/** Smoke one wiring. Returns the phases and the touched controls. */
export function runWiring(wires: readonly string[]): PhaseResult[] {
  const { netlist, profile } = assets();
  const m = createMachine(netlist, profile);
  const ends = cordEnds(wires);
  const buttons = new Set<number>();
  const switches = new Set<number>();
  for (const w of wires) {
    for (const t of w.split('/')) {
      const bm = /^([1-6])[XYZ]$/.exec(t);
      if (bm) buttons.add(Number(bm[1]));
      const sm = /^([1-6])[R-W]$/.exec(t);
      if (sm) switches.add(Number(sm[1]));
    }
  }
  const phases: PhaseResult[] = [];
  // The reset lands only once the previous control is back at rest, so a press that trips is not
  // re-tripped by its own release: reset before each press or throw, never before a release or a back.
  const run = (name: string, act: () => void, reset: boolean) => {
    if (reset && m.snapshot().breakerTripped) must(m, { k: 'breaker', reset: true });
    phases.push(phase(m, name, act));
  };
  run('power', () => {
    ends.forEach(([a, b], i) => must(m, { k: 'connect', cord: i, a, b }));
    must(m, { k: 'power', on: true });
  }, false);
  for (const n of [...buttons].sort()) {
    run('pb' + n + ' press', () => must(m, { k: 'button', n: n as Sect, target: 1000 }), true);
    run('pb' + n + ' release', () => must(m, { k: 'button', n: n as Sect, target: 0 }), false);
  }
  for (const n of [...switches].sort()) {
    const home = m.snapshot().switches[n - 1]!.travel >= 500 ? 1000 : 0;
    run('sw' + n + ' throw', () => must(m, { k: 'switch', n: n as Sect, target: 1000 - home }), true);
    run('sw' + n + ' back', () => must(m, { k: 'switch', n: n as Sect, target: home }), false);
  }
  return phases;
}

function classify(phases: PhaseResult[]): SmokeClass {
  if (phases.some((p) => p.trips > 0)) return 'trip';
  if (phases.some((p) => p.chatter.length > 0)) return 'chatter';
  if (phases.some((p) => p.noSettle)) return 'no-settle';
  return 'ok';
}

export function smokeProgram(p: CorpusProgram): SmokeResult {
  const base = { id: p.id, tier: p.tier, motor: p.flags.motor };
  let skip: string | null = null;
  if (p.checks.badTerminals.length > 0) skip = 'bad terminals: ' + p.checks.badTerminals.join(' ');
  else if (p.wiresEffective === null) skip = 'null wiresEffective' + (p.wiresEffectiveNote ? ' (' + p.wiresEffectiveNote + ')' : '');
  else if (p.flags.touch) skip = 'touch-only input';
  else if (!p.flags.standalone) skip = 'not standalone' + (p.standaloneReason ? ' (' + p.standaloneReason + ')' : '');
  if (skip !== null) return { ...base, class: 'skipped', reason: skip, phases: [] };
  let phases: PhaseResult[];
  try {
    phases = runWiring(p.wiresEffective!);
  } catch (e) {
    if (!(e instanceof HoleAllocationError)) throw e;
    return { ...base, class: 'skipped', reason: 'hole allocation: ' + e.message.replace(/^terminals: /, ''), phases: [] };
  }
  return { ...base, class: classify(phases), reason: null, phases };
}

export function smokeWires(id: string, wires: string[], motor = false): SmokeResult {
  const phases = runWiring(wires);
  return { id, tier: '-', motor, class: classify(phases), reason: null, phases };
}

function detail(r: SmokeResult): string {
  if (r.class === 'skipped') return r.reason as string;
  const parts: string[] = [];
  for (const p of r.phases) {
    const bits: string[] = [];
    if (p.trips) bits.push('trip x' + p.trips);
    if (p.chatter.length) bits.push('chatter ' + p.chatter.join(','));
    if (p.noSettle) bits.push('no-settle');
    if (p.motorMrpm !== 0) bits.push('motor ' + p.motorMrpm + ' mrpm');
    if (bits.length) parts.push(p.phase + ': ' + bits.join('; '));
  }
  const dial = r.phases.reduce((n, p) => n + p.dialChanges, 0);
  if (dial > 0) parts.push('dial changes ' + dial);
  return parts.join(' | ');
}

const CLASSES: SmokeClass[] = ['ok', 'trip', 'chatter', 'no-settle', 'skipped'];

export function counts(results: SmokeResult[]): Record<SmokeClass, number> {
  const c = Object.fromEntries(CLASSES.map((k) => [k, 0])) as Record<SmokeClass, number>;
  for (const r of results) c[r.class]++;
  return c;
}

export function buildSmoke(): SmokeResult[] {
  const corpus = JSON.parse(readFileSync(PROGRAMS_JSON_PATH, 'utf8')) as { programs: CorpusProgram[] };
  return corpus.programs.map(smokeProgram);
}

export function serializeSmoke(results: SmokeResult[]): string {
  return JSON.stringify({ schema: 'minivac.corpus-smoke/1', profile: 'MV601-REF-A', counts: counts(results), programs: results }, null, 2) + '\n';
}

export function renderMarkdown(results: SmokeResult[]): string {
  const c = counts(results);
  const lines = [
    '# Corpus fault smoke',
    '',
    'Generated by `node tools/corpus-smoke.ts` from `test/conformance/corpus/programs.json` on profile MV601-REF-A. Do not edit by hand.',
    '',
    'A smoke checks only for faults: breaker trips, chatter, no-settle and dial motion while each program\'s effective wiring is powered on, each touched pushbutton is pressed and released, and each touched slide switch is thrown and returned. It does not compare any result with a printed answer. `ok` means no fault, not correct. Settle follows architecture §13.5.2: the dial has no motion bit, so a running motor does not prevent settle; each phase reports the dial speed at its end. Chatter and no-settle are recorded, not judged: some programs oscillate by design (V-EXP2\'s alarm relay, VI-FORTUNETELLER\'s contemplate hold).',
    '',
    '| id | tier | motor | class | detail |',
    '|---|---|---|---|---|',
  ];
  for (const r of results) lines.push('| ' + [r.id, r.tier, r.motor ? 'yes' : 'no', r.class, detail(r).replace(/\|/g, '\\|')].join(' | ') + ' |');
  lines.push('', 'Counts: ' + CLASSES.map((k) => k + ' ' + c[k]).join(', ') + ' (total ' + results.length + ').', '');
  return lines.join('\n');
}

function main(): void {
  const results = buildSmoke();
  writeFileSync(SMOKE_JSON_PATH, serializeSmoke(results));
  writeFileSync(SMOKE_MD_PATH, renderMarkdown(results));
  const c = counts(results);
  process.stdout.write('corpus-smoke: ' + results.length + ' programs; ' + CLASSES.map((k) => k + ' ' + c[k]).join(', ') + '\n');
}

const argv1 = process.argv[1];
if (argv1 !== undefined && argv1.endsWith('corpus-smoke.ts')) {
  try {
    main();
  } catch (e) {
    process.stderr.write((e instanceof Error ? e.message : String(e)) + '\n');
    process.exitCode = 1;
  }
}
