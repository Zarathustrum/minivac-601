/**
 * Wave C's pre-registered counter experiment. These tests pin the experiment harness, not a
 * preferred scientific outcome: either `(a)` or `(b)` is a successful completed run.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  COUNTER_PROGRAMS,
  REGISTERED_STATES,
  gateP,
  gateTAgainstOracle,
  stampCounter,
  validateProgramLiteral,
} from '../tools/stamp-counter.ts';
import {
  counterAggregate,
  counterOutcome,
  deriveCounterProfile,
  formatCounterReport,
  runCounter,
  runCounterInvocation,
} from '../tools/check-profile.ts';

const REF = new URL('../data/profiles/MV601-REF-A.json', import.meta.url);
const IDEAL = new URL('../data/profiles/MV601-IDEAL.json', import.meta.url);
const beforeRef = readFileSync(REF);
const beforeIdeal = readFileSync(IDEAL);
const report = runCounter();

describe('Wave C literal sources and Gate T', () => {
  it('rejects dropped, corrupt, repaired and out-of-alphabet wire tokens', () => {
    const iv = COUNTER_PROGRAMS['IV-EXP1'];
    expect(() => validateProgramLiteral('IV-EXP1', iv.slice(1))).toThrow(/44 tokens/);
    expect(() => validateProgramLiteral('IV-EXP1', [...iv.slice(0, -1), '6Y\/6Q'])).toThrow(/grammar/);
    expect(() => validateProgramLiteral('IV-EXP1', [...iv.slice(0, -1), '6y\/6+'])).toThrow(/grammar/);
    expect(() => validateProgramLiteral('IV-EXP1', [...iv.slice(0, -1), ' 6Y\/6+'])).toThrow(/grammar/);
    expect(() => validateProgramLiteral('IV-EXP1', [...iv.slice(0, -1), '6Y\/6-'])).toThrow(/MD5/);
  });

  it('matches the independent Gate T partition, contacts, element order and orientation', () => {
    expect(report.gateT.violations).toEqual([]);
    expect(report.gateT.elements).toHaveLength(22);
    expect(report.gateT.elements.slice(-4).map((e) => e.id)).toEqual(['R1', 'R2', 'motor', 'source']);
    expect(report.gateT.elements.slice(-4).map((e) => `${e.a}->${e.b}`)).toEqual([
      'D17->D19', 'D18->D19', 'D18->D19', 'P->D',
    ]);

    const wrongOrder = { ...report.gateT, elements: [...report.gateT.elements].reverse() };
    expect(gateTAgainstOracle(wrongOrder).some((x) => x.includes('element'))).toBe(true);
    const wrongCord = {
      ...report.gateT,
      cords: report.gateT.cords.map((c, i) => i === 0 ? { ...c, united: false } : c),
    };
    expect(gateTAgainstOracle(wrongCord).some((x) => x.includes('cord 1'))).toBe(true);
    const wrongContacts = stampCounter('ER-ALTCOUNTER', {
      event: 'UP', mask: '000001', pushbutton6Down: false, gateT: true,
    }, report.gateT.profile);
    expect(gateTAgainstOracle(wrongContacts).some((x) => x.includes('partition'))).toBe(true);

    const mutateFirst = (change: Record<string, string>): string[] => gateTAgainstOracle({
      ...report.gateT,
      contacts: report.gateT.contacts.map((c, i) => i === 0 ? { ...c, ...change } : c),
    });
    expect(mutateFirst({ id: 'relay-WRONG' }).some((x) => x.includes('contact 1'))).toBe(true);
    expect(mutateFirst({ arm: '1L' }).some((x) => x.includes('contact 1'))).toBe(true);
    expect(mutateFirst({ activeTerminal: '1G' }).some((x) => x.includes('contact 1'))).toBe(true);
    expect(mutateFirst({ inactiveTerminal: '1J' }).some((x) => x.includes('contact 1'))).toBe(true);

    const first = report.gateT.contacts[0];
    const second = report.gateT.contacts[1];
    if (first === undefined || second === undefined) throw new Error('Gate T contact oracle is incomplete');
    const duplicate = { ...report.gateT, contacts: [first, first, ...report.gateT.contacts.slice(2)] };
    expect(gateTAgainstOracle(duplicate)).toContain('Gate T contact ids are not unique');
    const missing = { ...report.gateT, contacts: report.gateT.contacts.slice(1) };
    expect(gateTAgainstOracle(missing).some((x) => x.includes('contact decisions 17 != 18'))).toBe(true);
    const reordered = { ...report.gateT, contacts: [second, first, ...report.gateT.contacts.slice(2)] };
    expect(gateTAgainstOracle(reordered).some((x) => x.includes('contact 1'))).toBe(true);
  });
});

describe('Wave C profiles are derived before solving and never written', () => {
  it('clones REF-A, applies both raw overrides, and derives exactly once from them', () => {
    const z = deriveCounterProfile(12_000, [0, 0, 0, 0, 0, 0]);
    expect(z.v.L_coil_uh).toBe(12_000);
    expect(z.dVRelayMv).toEqual([0, 0, 0, 0, 0, 0]);
    expect(z.derived.relayPullInUa).toEqual([43_333, 43_333, 43_333, 43_333, 43_333, 43_333]);
    expect(z.derived.arcStepUa).not.toBe(report.gateT.profile.derived.arcStepUa);

    const n = deriveCounterProfile(1_200_000, [-300, 240, -290, 110, -250, 170]);
    expect(n.derived.relayPullInUa).not.toEqual(z.derived.relayPullInUa);
    expect(n.derived.relayPullInUa[0]).toBeLessThan(43_333);
    expect(n.derived.relayPullInUa[1]).toBeGreaterThan(43_333);
  });

  it('preserves both registered profile files byte for byte', () => {
    expect(readFileSync(REF)).toEqual(beforeRef);
    expect(readFileSync(IDEAL)).toEqual(beforeIdeal);
    expect(report.profileHashes.refBefore).toBe(report.profileHashes.refAfter);
    expect(report.profileHashes.idealBefore).toBe(report.profileHashes.idealAfter);
  });
});

describe('Gate P and the fixed result tables', () => {
  it('keeps all 34 census rows and carries full details for any registered refusal', () => {
    expect(report.gateP).toHaveLength(34);
    expect(new Set(report.gateP.map((r) => `${r.program}|${r.case}|${r.event}|${r.mask}`)).size).toBe(34);
    expect(report.gateP.some((r) => r.status === 'VALUE')).toBe(true);
    for (const row of report.gateP.filter((r) => r.status === 'REFUSED')) {
      expect(row.refusals.length).toBeGreaterThan(0);
      for (const refusal of row.refusals) {
        expect(refusal.members.length).toBeGreaterThan(0);
        expect(refusal.coils).toHaveLength(2);
      }
    }
  });

  it('Gate P refuses exactly a bare two-coil super-node and accepts the registered negative', () => {
    const negative = stampCounter('IV-EXP1', {
      event: 'UP', mask: '000000', pushbutton6Down: false,
    }, report.gateT.profile);
    expect(gateP(negative)).toEqual([]);

    const syntheticNode = negative.members.length;
    const els = negative.els.map((e) => ({ ...e }));
    const coil1 = els[12];
    const coil2 = els[13];
    if (coil1?.k !== 'coil' || coil2?.k !== 'coil') throw new Error('counter element order moved');
    coil1.b = syntheticNode;
    coil2.a = syntheticNode;
    const positive = { ...negative, els, members: [...negative.members, ['SYNTHETIC-BARE-NODE']] };
    expect(gateP(positive)).toEqual([{
      members: ['SYNTHETIC-BARE-NODE'], coils: ['coil-1', 'coil-2'],
    }]);
  });

  it('never silently excludes a refused registered IV state from C-B', () => {
    for (const state of REGISTERED_STATES) {
      const gate = report.gateP.find((r) =>
        r.program === 'IV-EXP1' && r.case === state.case && r.event === state.event && r.mask === state.mask);
      expect(gate).toBeDefined();
      const rows = report.boundMargins.filter((r) => r.case === state.case && r.event === state.event);
      expect(rows).toHaveLength(12);
      if (gate?.status === 'REFUSED') expect(rows.every((r) => r.status === 'REFUSED')).toBe(true);
    }
  });

  it('prints the exact fixed table sizes and only registered statuses', () => {
    expect(report.boundMargins).toHaveLength(192);
    expect(report.sourceCurrents).toHaveLength(32);
    expect(report.sourceMaxima).toHaveLength(2);
    expect(report.q1Deltas).toHaveLength(96);
    expect(report.q1CountZero).toHaveLength(8);
    expect(report.q2Structural).toHaveLength(6);
    expect(report.q2Comparisons).toHaveLength(2);
    const statuses = [
      ...report.gateP, ...report.boundMargins, ...report.sourceCurrents,
      ...report.sourceMaxima, ...report.q1Deltas, ...report.q1CountZero,
      ...report.q2Structural, ...report.q2Comparisons,
    ].map((r) => r.status);
    expect(statuses.every((s) => ['VALUE', 'REFUSED', 'NO_SETTLE', 'NO_CROSSING'].includes(s))).toBe(true);
    expect(report.nominalPullInUa).toBe(43_333);
  });
});

describe('Wave C outcome and report', () => {
  it('distinguishes predicate failure, Gate P, no-settle and no-crossing aggregates', () => {
    expect(counterAggregate(['VALUE'], true).status).toBe('PASS');
    expect(counterAggregate(['VALUE'], false)).toEqual({
      status: 'FAIL', reason: 'one or more registered predicates failed',
    });
    expect(counterAggregate(['REFUSED'], false).status).toBe('INDETERMINATE (Gate P)');
    expect(counterAggregate(['NO_SETTLE'], false).status).toBe('INDETERMINATE (NO SETTLE)');
    expect(counterAggregate(['NO_CROSSING'], true)).toEqual({
      status: 'FAIL', reason: '1 required Q2 row(s) had NO_CROSSING',
    });
    expect(counterAggregate(['NO_SETTLE', 'REFUSED'], false).status).toBe('INDETERMINATE (Gate P)');
  });

  it('does not let one aggregate or a control rescue another', () => {
    expect(counterOutcome('PASS', 'PASS', 'PASS')).toBe('(a)');
    expect(counterOutcome('FAIL', 'PASS', 'PASS')).toBe('(b)');
    expect(counterOutcome('PASS', 'INDETERMINATE (Gate P)', 'PASS')).toBe('(b)');
    expect(counterOutcome('PASS', 'PASS', 'INDETERMINATE (NO SETTLE)')).toBe('(b)');
    expect(report.outcome).toBe(counterOutcome(
      report.boundAggregate.status, report.q1Aggregate.status, report.q2Aggregate.status,
    ));
  });

  it('is deterministic and ends with exactly one outcome line', () => {
    const first = formatCounterReport(report);
    const second = formatCounterReport(runCounter());
    expect(second).toBe(first);
    expect(first.split('\n').length - 1).toBe(447);
    const normalized = first.replace(
      /^PROFILE id=MV601-REF-A before=[0-9a-f]+ after=[0-9a-f]+$/m,
      'PROFILE id=MV601-REF-A before=<REF-A> after=<REF-A>',
    );
    // 2026-10-14 Phase 5 wave 3: only the `SOURCE id=programs.md` line moved (245727 / 21478560... ->
    // 252989 / 612f2961...). Old md5 371ba873325ea7d9cac625793502f243.
    // 2026-10-14 coast set from printed bounds: only the `PROFILE id=MV601-IDEAL` line moved (profile
    // bytes, b6c97295... -> 760661d7...). Old md5 82bd04fe6edd5dd8afef7005d9c472a7.
    expect(createHash('md5').update(normalized).digest('hex')).toBe('b24773d388a566dd167682c111ee126b');
    expect(first.match(/^WAVE C OUTCOME: \([ab]\)$/gm)).toHaveLength(1);
    expect(first.trimEnd().split('\n').at(-1)).toBe(`WAVE C OUTCOME: ${report.outcome}`);
  });

  it('prints after hashes but no scientific result when infrastructure fails', () => {
    const failed = runCounterInvocation({ failAfterGateT: 'INJECTED GATE-T FAILURE' });
    expect(failed.exitCode).toBe(1);
    expect(failed.report).toBeNull();
    expect(failed.text).toContain(
      'PROFILE id=MV601-REF-A before=b502742a830c84ba974effcae1046135 ' +
      'after=b502742a830c84ba974effcae1046135',
    );
    expect(failed.text).toContain(
      'PROFILE id=MV601-IDEAL before=4af4ba732c9abee8fca75113c31e7aba ' +
      'after=4af4ba732c9abee8fca75113c31e7aba',
    );
    expect(failed.text).toContain('WAVE C INFRASTRUCTURE ERROR: INJECTED GATE-T FAILURE');
    expect(failed.text).not.toContain('GATE P CENSUS');
    expect(failed.text).not.toContain('C-B EXPECTED-MARGIN');
    expect(failed.text).not.toContain('WAVE C OUTCOME');
  });
});
