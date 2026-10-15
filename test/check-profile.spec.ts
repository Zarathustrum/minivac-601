/**
 * `tools/check-profile.ts` under vitest.
 *
 * **Why this file exists.** A passing suite that silently omits the file under test is worse than
 * a failing one: `vite.config.ts` collects only `test/**\/*.spec.ts`. `check-profile` is a gate;
 * a gate nothing executes buys confidence it has not earned. So the gate runs in the suite, on
 * every `npm test`, and its measurements are pinned.
 *
 * **What is asserted, and what deliberately is not.** The assertions below are on *measurements*
 * and on the *shape* of the report: the numbers `components.md` §8.2 prints for AT-01, AT-04,
 * AT-05, AT-06 and AT-07, the completeness of every section, and determinism. Nothing here asserts
 * that the profile is acceptable — that AT-11 passes, that R6 passes, that a feasible `L_coil`
 * exists. Those are the wave's open question, and a test that demanded a particular answer would be
 * the fit-to-the-outcome pattern `DECISIONS.md` rejects by name. If the physics changes, these
 * tests break loudly and a human reads the new numbers.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertWaveDMinDecisionUa,
  formatDReport,
  formatReport,
  runAll,
  runD,
  summary,
} from '../tools/check-profile.ts';
import type { DReport, Report } from '../tools/check-profile.ts';

/** One run, shared. `runAll` is pure apart from reading the two profile JSON files. */
const r: Report = runAll();
const b = r.battery;
const d: DReport = runD();

describe('check-profile runs at all', () => {
  it('loads MV601-REF-A and reports no non-portable arithmetic', () => {
    expect(r.profile.id).toBe('MV601-REF-A');
    expect(r.profile.marginal).toBe(true);
    expect(b.nonPortable).toBe(false);
  });

  it('is deterministic: two runs produce byte-identical reports', () => {
    expect(formatReport(runAll())).toBe(formatReport(r));
  });

  it('does not write the shipped profiles', () => {
    // The sweep and the three controls each load a mutated document; every one of them is an
    // in-memory copy. If that ever stopped being true the shipped L_coil would have moved.
    expect(r.profile.v.L_coil_uh).toBe(1_200_000);
    expect([...r.profile.dVRelayMv]).toEqual([-282, -169, -56, 56, 169, 282]);
  });
});

describe('the acceptance tests reproduce components.md §8.2', () => {
  it('AT-01 — the Experiment 9 latch settles at the printed 46.2 mA / 6.92 V', () => {
    // §8.2: "loop 281.7 ohm, 46.2 mA, V_coil 6.92 V". Self-consistent with the filament, so the
    // agreement is to the exact fixed point rather than to §8.2's single-pass arithmetic.
    expect(b.at01.coilUa).toBeGreaterThan(46_000);
    expect(b.at01.coilUa).toBeLessThan(46_500);
    expect(b.at01.coilMv).toBeGreaterThan(6_900);
    expect(b.at01.coilMv).toBeLessThan(6_960);
    expect(b.at01.lampUa).toBe(b.at01.coilUa); // one series branch: §1.4's nC-lamp-nE-coil-nF
    expect(b.at01.coilUa).toBe(46_218);
    expect(b.at01.thrUa).toBe(41_453);
    expect(b.at01.marginUa).toBe(4_765);
    expect(b.at01.pullsIn).toBe(true);
    expect(b.at01.holds).toBe(true);
    expect(b.at01.quiet).toBe(true);
  });

  it('AT-04 — 180..470 ohm land strictly inside the band, 120 above it', () => {
    const inside = b.at04.filter((x) => [180, 220, 270, 330, 390, 470].indexOf(x.rOhm) >= 0);
    expect(inside.length).toBe(6);
    for (const row of inside) expect(row.inside).toBe(true);
    const r120 = b.at04.find((x) => x.rOhm === 120);
    expect(r120?.abovePullIn).toBe(true);
    // §8.2: "150 Ω sits at pull-in, where the descending search terminates."
    const r150 = b.at04.find((x) => x.rOhm === 150);
    expect(r150).toBeDefined();
    expect(Math.abs((r150?.iUa ?? 0) - r.profile.derived.pullInUa)).toBeLessThan(200);
  });

  it('AT-05 — the realistic case is well under trip, the worst case is at the knife edge', () => {
    expect(b.at05.cFedTrips).toBe(false);
    expect(b.at05.cFedSupplyUa).toBeGreaterThan(800_000);
    expect(b.at05.cFedSupplyUa).toBeLessThan(860_000);
    // §8.2 puts the six-at-E, thirteen-lamps case at 1.57 A; the solved self-consistent answer is
    // lower because the sag it produces feeds back into every lamp.
    expect(b.at05.eFedSupplyUa).toBeGreaterThan(1_400_000);
    expect(b.at05.eFedSupplyUa).toBeLessThan(1_600_000);
  });

  it('AT-06 — the dead cord is the zero-unknown system and yields 19.403 A', () => {
    expect(b.at06.supplyUa).toBe(19_402_985);
    expect(b.at06.trips).toBe(true);
  });

  it('AT-07 — E operates with the lamp dark, C operates with the lamp lit', () => {
    expect(b.at07.eCoilUa).toBeGreaterThan(86_000);
    expect(Math.abs(b.at07.eLampUa)).toBeLessThan(10); // the dangling C branch carries ~0
    expect(b.at07.cLampUa).toBe(b.at07.cCoilUa);
    expect(b.at07.cLampMilli).toBeGreaterThan(b.at07.dimMilli);
  });

  it('AT-10 — the STOP short is limited by R1 and does not trip; +/- does', () => {
    expect(b.at10.trips).toBe(false);
    expect(b.at10.stopShortUa).toBeGreaterThan(500_000);
    expect(b.at10.stopShortUa).toBeLessThan(600_000);
    expect(b.at10.shortTrips).toBe(true);
  });

  it('AT-09 is reported as a documented claim, not as a measurement', () => {
    const text = formatReport(r);
    expect(text).toContain('NO MEASUREMENT IS OFFERED FOR IT');
  });
});

describe('AT-11 and AT-02 are reported jointly and completely', () => {
  it('AT-11 sweeps the output lamps from zero and reports both readings', () => {
    expect(b.at11.rows.length).toBe(7); // 0..6 lit output lamps
    for (const row of b.at11.rows) {
      expect(row.peakUa.length).toBe(6);
      expect(row.settledUa.length).toBe(6);
      expect(row.dcMarginUa.length).toBe(6);
    }
    // Monotone: every extra lit lamp sags the rail and lowers every coil current.
    for (let i = 1; i < b.at11.rows.length; i++) {
      const prev = b.at11.rows[i - 1];
      const cur = b.at11.rows[i];
      expect(cur?.railMv ?? 0).toBeLessThan(prev?.railMv ?? 0);
      expect(cur?.supplyUa ?? 0).toBeGreaterThan(prev?.supplyUa ?? 0);
    }
  });

  it('AT-02 carries the load, and reports the four numbers the finding needs', () => {
    // Six coils, thirteen lamps and R_src: about twenty elements.
    expect(b.at02.nOut).toBe(6);
    expect(b.at02.tETicks).not.toBeNull();
    expect(b.at02.railSagPct).toBeGreaterThan(0);
    expect(b.at02.coilSagPct).toBeGreaterThan(0);
    expect(b.at02.neededSagPct).toBeGreaterThan(0);
    expect(b.at02.lightCoilMv).toBeGreaterThan(b.at02.loadedCoilMv);
  });

  it('the release paths are measured, and the open ramp beats the V_arc/L shorthand', () => {
    // DECISIONS, *2026-08-30 — Phase 1 Wave 1a spec readings*: the companion gives the arc term
    // PLUS the L/R decay, so the real first step is larger than `arcStepUa` and the open release
    // is correspondingly faster.
    expect(b.release.eOpenHoldOff).not.toBeNull();
    expect(b.release.eShortedHoldOff).not.toBeNull();
    const shorthandTicks = Math.ceil(
      (b.release.eStartUa - r.profile.derived.relayDropOutUa[0]!) / r.profile.derived.arcStepUa,
    );
    expect(b.release.eOpenHoldOff ?? 0).toBeLessThan(shorthandTicks);
    // The shorted path is the slow one; that is the whole point of §4.2.
    expect(b.release.eShortedHoldOff ?? 0).toBeGreaterThan(b.release.eOpenHoldOff ?? 0);
  });
});

describe('the constraints, the sweep, the controls and the PWL comparison all run', () => {
  it('R1-R6 are evaluated at both ends of the fast-tap bracket', () => {
    expect(r.constraints.length).toBe(2);
    for (const run of r.constraints) {
      const ids = run.results.map((c) => c.id);
      expect(ids).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6']);
      // R6 was `unevaluated` before this file existed; the solver now supplies its two verdicts.
      expect(run.results[5]?.status).not.toBe('unevaluated');
      // R5 stays unevaluated: ripple is off, and an unsupplied input is never a pass.
      expect(run.results[4]?.status).toBe('unevaluated');
    }
  });

  it('the L_coil sweep spans the widened band and reports every constraint per value', () => {
    expect(r.sweep.length).toBeGreaterThanOrEqual(16);
    expect(r.sweep[0]?.lUh).toBe(300_000);
    expect(r.sweep[r.sweep.length - 1]?.lUh).toBe(5_000_000);
    expect(r.sweep.some((x) => x.lUh === r.profile.v.L_coil_uh)).toBe(true);
    // R1 is mechanical: `break_milli`, `make_milli` and the release stroke, none of them L.
    const r1 = r.sweep[0]?.r1Margin;
    expect(r.sweep.every((x) => x.r1Margin === r1)).toBe(true);
  });

  it('three controls run, and the third is the L_coil one the two dV controls cannot be', () => {
    expect(r.controls.length).toBe(3);
    expect([...(r.controls[0]?.battery.dVRelayMv ?? [])]).toEqual([0, 0, 0, 0, 0, 0]);
    // Rotated by one relay index: same multiset, every offset on a different relay.
    const rot = [...(r.controls[1]?.battery.dVRelayMv ?? [])];
    expect(rot).toEqual([282, -282, -169, -56, 56, 169]);
    expect([...rot].sort((x, y) => x - y)).toEqual([...r.profile.dVRelayMv].sort((x, y) => x - y));
    expect(r.controls[1]?.battery.lCoilUh).toBe(r.profile.v.L_coil_uh);
    // Control 3: L_coil neutralised, spread untouched.
    expect(r.controls[2]?.battery.lCoilUh).toBe(12_000);
    expect([...(r.controls[2]?.battery.dVRelayMv ?? [])]).toEqual([...r.profile.dVRelayMv]);
  });

  it('the 9-breakpoint table is compared against the 33-breakpoint one on every result', () => {
    expect(r.pwl9Battery.pwlPoints).toBe(9);
    expect(b.pwlPoints).toBe(33);
    expect(r.pwl.compared).toBeGreaterThan(200);
    // gen-lamp-pwl.ts reports the 9-point table ~2.3% low at the E-fed operating point; if the
    // re-sampled table did not reproduce that, the comparison would be testing nothing.
    const delta = (r.pwl.at9Ohm - r.pwl.at33Ohm) / r.pwl.at33Ohm;
    expect(delta).toBeLessThan(-0.015);
    expect(delta).toBeGreaterThan(-0.035);
  });

  it('the report and its machine-readable block carry every section the finding needs', () => {
    const text = formatReport(r);
    for (const section of [
      'AT-01', 'AT-04', 'AT-05', 'AT-06', 'AT-07', 'AT-09', 'AT-10', 'AT-11',
      'AT-02, LOADED', 'R1-R6', 'L_coil SWEEP', 'ANTI-FITTING CHECK', 'CONTROLS',
      'lamp_thermal_tau_us SWEEP', 'TWO DIFFERENT R6 PREDICATES',
      'RELEASE-MODEL-INVARIANT COUNTERFACTUAL', 'SETTLE CONVERGENCE',
      'PWL BREAKPOINT COUNT', 'MACHINE-READABLE SUMMARY', 'REPORT LINE COUNT',
    ]) {
      expect(text).toContain(section);
    }
    const s = summary(r) as Record<string, unknown>;
    expect(s['schema']).toBe('minivac.check-profile/1');
    for (const key of ['AT01', 'AT04', 'AT05', 'AT06', 'AT07', 'AT09', 'AT10', 'AT11', 'AT02',
      'release', 'verdict', 'constraints', 'sweep', 'controls', 'pwl_9_vs_33']) {
      expect(s[key]).toBeDefined();
    }
  });
});

describe('Wave D profile derivation and live C-Z identity report', () => {
  it('accepts W4a\'s live 14-uA gate without rewriting Wave D\'s dated 1,000-uA input', () => {
    expect(r.profile.v.min_decision_ua).toBe(14);
    expect(assertWaveDMinDecisionUa(r.profile.v.min_decision_ua)).toBe(14);
    expect(d.inputs.minDecisionUa).toBe(1000);
  });

  it('pins the frozen inputs, vector, thresholds and three D-AT01 assertions', () => {
    expect(d.inputs).toEqual({
      VPullInMv: 6500,
      RCoilUohm: 150_000_000,
      minDecisionUa: 1000,
      at01SettledUa: 46_218,
    });
    expect(d.aMv).toBe(282);
    expect(d.offsetsMv).toEqual([-282, -169, -56, 56, 169, 282]);
    expect(d.pullInUa).toEqual([41_453, 42_207, 42_960, 43_707, 44_460, 45_213]);
    expect(d.dropOutUa).toEqual([14_787, 15_540, 16_293, 17_040, 17_793, 18_547]);
    expect(d.at01).toEqual({
      actual: { relay: 1, thresholdUa: 41_453, marginUa: 4_765, pass: true },
      max: { relay: 6, thresholdUa: 45_213, marginUa: 1_005, pass: true },
      next: { aMv: 283, thresholdUa: 45_220, marginUa: 998, rejected: true },
    });
  });

  it('maps exactly 24 live C-Z rows one-to-one onto D by key, status and integer identity', () => {
    expect(d.sourceRows).toHaveLength(24);
    expect(d.rows).toHaveLength(24);
    expect(new Set(d.sourceRows.map((row) => row.key)).size).toBe(24);
    expect(new Set(d.rows.map((row) => row.key)).size).toBe(24);
    expect(d.rows.map((row) => row.key)).toEqual(d.sourceRows.map((row) => row.key));

    for (let i = 0; i < d.rows.length; i++) {
      const source = d.sourceRows[i];
      const row = d.rows[i];
      expect(row?.sourceStatus).toBe(source?.status);
      expect(row?.status).toBe(source?.status);
      expect(row?.sourceDeltaUa).toBe(source?.deltaUa);
      expect(row?.deltaUa).toBe((source?.deltaUa as number) - (row?.thresholdDifferenceUa as number));
      expect(row?.deltaUa).toBeGreaterThan(d.inputs.minDecisionUa);
    }
    expect(new Set(d.rows.map((row) => `${row.evenRelay}/${row.oddRelay}:${row.thresholdDifferenceUa}`)))
      .toEqual(new Set(['6/5:753', '4/3:747', '2/1:754']));
  });

  it('keeps 15,273 uA as a secondary bound and rejects a live threshold above 1,005 uA', () => {
    expect(d.aggregate).toEqual({ status: 'PASS', rows: 24 });
    expect(d.secondaryBound).toEqual({ sourceMinimumUa: 16_027, maximumThresholdDifferenceUa: 754, lowerBoundUa: 15_273 });
    expect(assertWaveDMinDecisionUa(1_005)).toBe(1_005);
    expect(() => assertWaveDMinDecisionUa(1_006)).toThrow('reopen Wave D and return to Tom');
  });

  it('formats independently, in the frozen order, and is byte-deterministic', () => {
    const text = formatDReport(d);
    expect(formatDReport(runD())).toBe(text);
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(42);
    const renderedRows = lines.filter((line) => line.startsWith('D/C-Q1 key='));
    expect(renderedRows).toHaveLength(24);
    for (let i = 0; i < d.rows.length; i++) {
      const row = d.rows[i];
      if (row === undefined) throw new Error(`missing D row ${i}`);
      expect(renderedRows[i]).toBe(
        `D/C-Q1 key=${row.key} sourceStatus=${row.sourceStatus} dStatus=${row.status} ` +
        `sourceDeltaUa=${row.sourceDeltaUa} thresholdDifferenceUa=${row.thresholdDifferenceUa} ` +
        `deltaUa=${row.deltaUa} minDecisionUa=${row.minDecisionUa} predicate=> result=${row.pass ? 'PASS' : 'FAIL'}`,
      );
    }
    const sections = [
      'WAVE D FROZEN INPUTS',
      'WAVE D VECTOR AND DERIVED THRESHOLDS',
      'D-AT01-ACTUAL',
      'D-AT01-MAX',
      'D-AT01-NEXT',
      'D/C-Q1 IDENTITY TABLE (24 rows)',
      'D/C-Q1 AGGREGATE status=PASS rows=24',
      'D/C-Q1 SECONDARY BOUND sourceMinimumUa=16027 maximumThresholdDifferenceUa=754 lowerBoundUa=15273',
    ];
    for (let i = 1; i < sections.length; i++) {
      expect(text.indexOf(sections[i] as string)).toBeGreaterThan(text.indexOf(sections[i - 1] as string));
    }
  });

  it('the --d CLI writes exactly the separately formatted live report', () => {
    const cli = spawnSync(process.execPath, [fileURLToPath(new URL('../tools/check-profile.ts', import.meta.url)), '--d'], {
      encoding: 'utf8',
    });
    expect(cli.status).toBe(0);
    expect(cli.stderr).toBe('');
    expect(cli.stdout).toBe(formatDReport(runD()));
  }, 15_000);
});

describe('the Wave 1b review fixes are all reported, and none of them is asserted into a verdict', () => {
  it('both §9.3 carry chains are composed, and the worst is taken per drive', () => {
    // 3->4 terminates on a stage going 0->1 and is charged an operate; 7->0 is three shorted
    // releases and no operate at all (components.md §9.3 R4's "when it goes 0->1" clause).
    expect(b.at02.chainCTicks.length).toBe(2);
    expect(b.at02.chainETicks.length).toBe(2);
    const cWorst = b.at02.chainWorstCTicks;
    const eWorst = b.at02.chainWorstETicks;
    expect(cWorst).not.toBeNull();
    expect(eWorst).not.toBeNull();
    expect(cWorst).toBe(Math.max(...(b.at02.chainCTicks as number[])));
    expect(eWorst).toBe(Math.max(...(b.at02.chainETicks as number[])));
    expect(['3->4', '7->0']).toContain(b.at02.chainWorstCId);
    expect(['3->4', '7->0']).toContain(b.at02.chainWorstEId);
    // The mechanical-only counterfactual strikes the electrical hold-off out of every release, so
    // it can never be longer than the composed chain it is derived from.
    expect(b.at02.mechOnlyWorstCTicks ?? 0).toBeLessThan(cWorst ?? 0);
    expect(b.at02.mechOnlyWorstETicks ?? 0).toBeLessThan(eWorst ?? 0);
  });

  it('R4 is evaluated once per chain and the binding one is the reported R4', () => {
    for (const run of r.constraints) {
      expect(run.r4ByChain.length).toBe(2);
      const required = run.r4ByChain.map((q) => q.result.required);
      expect(run.results[3]?.required).toBe(Math.max(...required));
      const binding = run.r4ByChain.find((q) => q.id === run.bindingChainId);
      expect(binding?.result.required).toBe(Math.max(...required));
    }
  });

  it('the DC route is two-sided: the bypassed side must succeed as well', () => {
    // The predicate used to be `tCTicks === null` alone, which never tested the second half of
    // R6's own sentence. It is not allowed to fire on a profile where neither side counts.
    if (r.verdict.counterFailsDc) expect(b.at02.tETicks).not.toBeNull();
    for (const c of r.controls) {
      if (c.verdict.counterFailsDc) expect(c.battery.at02.tETicks).not.toBeNull();
    }
  });

  it('the lamp_thermal_tau_us sweep runs, floors on determinism rule 15, and reports both R6s', () => {
    expect(r.tauSweep.length).toBeGreaterThanOrEqual(15);
    expect(r.tauSweep.some((x) => x.tauUs === r.profile.v.lamp_thermal_tau_us)).toBe(true);
    // tick_us * 20 = 2000 µs is the floor; anything at or under it must be rejected AT LOAD and
    // reported as such, not silently omitted from the sweep.
    for (const row of r.tauSweep) {
      if (row.tauUs <= r.profile.v.tick_us * 20) expect(row.rejected).not.toBeNull();
      else expect(row.rejected).toBeNull();
    }
    // The two R6 predicates are carried separately at every value; the point of the sweep is that
    // they disagree somewhere, and a test that demanded agreement would erase the finding.
    for (const row of r.tauSweep) {
      expect(typeof row.r6ObservablePass).toBe('boolean');
      expect(typeof row.r6HoldPass).toBe('boolean');
    }
  });

  it('the warm counterfactual moves one variable and reports a distinct ratio', () => {
    // With the five loading stages left settled and only the measured coil restarted, the ratio is
    // a distinct fixed-warm-filament comparison (higher here).
    expect(b.at02.warmTCTicks).not.toBeNull();
    expect(b.at02.warmTETicks).not.toBeNull();
    expect(b.at02.warmRatio ?? 0).toBeGreaterThan(2);
    expect(b.at02.warmRatio ?? 0).toBeLessThan(3);
    // ...and it is a different number from the one the model actually runs at.
    expect(b.at02.warmRatio ?? 0).toBeGreaterThan(b.at02.ratio ?? 0);
  });

  it('every settle reports its convergence, not just AT-01\'s', () => {
    expect(b.settles.length).toBeGreaterThan(20);
    for (const st of b.settles) {
      expect(typeof st.quiet).toBe('boolean');
      expect(st.ticks).toBeGreaterThan(0);
      expect(st.label.length).toBeGreaterThan(0);
    }
    // The two currents the release argument rests on come out of settles that are now checked.
    expect(b.release.cStartQuiet).toBe(true);
    expect(b.release.eStartQuiet).toBe(true);
  });

  it('AT-11 reports which relays go under on the DC reading, per control', () => {
    const s = summary(r) as Record<string, unknown>;
    const at11 = s['AT11'] as Record<string, unknown>;
    expect(Array.isArray(at11['dc_failing_relays_at_full_load'])).toBe(true);
    const controls = s['controls'] as Record<string, unknown>[];
    // Three §4.3/DECISIONS controls plus the dV-zeroed-and-short-tau cross control.
    expect(controls.length).toBe(4);
    for (const c of controls) {
      expect(Array.isArray(c['AT11_dc_failing_relays_at_first'])).toBe(true);
      expect(Array.isArray(c['AT11_dc_failing_relays_at_full_load'])).toBe(true);
    }
  });

  it('the report prints its own line count, and the count is right', () => {
    const text = formatReport(r);
    const lines = text.split('\n');
    // `text` ends with a newline, so the final split entry is empty and the printed total is the
    // number of newlines — which is what `wc -l` counts.
    expect(lines[lines.length - 1]).toBe('');
    const stated = /REPORT LINE COUNT: (\d+) lines/.exec(text);
    expect(stated).not.toBeNull();
    expect(Number(stated?.[1])).toBe(lines.length - 1);
  });
});
