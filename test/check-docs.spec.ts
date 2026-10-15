import { describe, expect, it } from 'vitest';
import { checkDocs, checkText } from '../tools/check-docs.ts';

describe('Wave B0 documentation residue checker', () => {
  it('is green against the corrected corpus and verifies every exact allow anchor', () => {
    const result = checkDocs();
    expect(result).toEqual({ findings: [], anchoredAllows: 12 });
  });

  it.each([
    ["L_coil is O-E1's named timing fallback made concrete.", 'timing-fallback-purpose'],
    ['L_coil exists to lengthen the carry window.', 'inductance-lengthens-race-window'],
    ['L_coil sets both the operate spread and the release ratio.', 'inductance-sets-operate-cause'],
    ['the L/R race model the invented inductance exists to provide.', 'inductance-race-model-purpose'],
    ['components.md §8.2 (the electrical fallback)', 'electrical-fallback-label'],
    ['0.012 H, suppressing most electrical carry-over', 'electrical-carry-over-control'],
    ['Model it as a timing effect (§8.3), not a DC threshold.', 'timing-section-not-dc'],
    ['MV601-REF-A ships `dV_relay_mv = [300, -240, 290, -110, 250, -170]` mV.', 'legacy-dv-vector'],
    ['Whether the shipped gate should apply  `dV_relay_mv` by default is unresolved.', 'unresolved-reachability-policy'],
  ])('catches the surviving causal variant %s', (line, rule) => {
    expect(checkText('docs/example.md', line).map((finding) => finding.rule)).toContain(rule);
  });

  it('scans decoded strings throughout valid shipping JSON without duplicate findings', () => {
    const findings = checkText(
      'data/profiles/example.json',
      [
        '{',
        '  "nested": {',
        '    "src": "L_coil is O-E1\\u0027s timing fallback made concrete.",',
        '    "items": ["L_coil exists to lengthen the carry window.", 21, true, null]',
        '  }',
        '}',
      ].join('\n'),
    );
    expect(findings.map((finding) => [finding.rule, finding.line])).toEqual([
      ['timing-fallback-purpose', 3],
      ['inductance-lengthens-race-window', 4],
    ]);
  });

  it('catches the legacy vector through JSON Unicode escapes, but not the approved D vector', () => {
    expect(checkText(
      'data/profiles/example.json',
      '{"src":"MV601-REF-A ships dV_relay_mv = \\u005b300, -240, 290, -110, 250, -170\\u005d"}',
    ).map((finding) => finding.rule)).toContain('legacy-dv-vector');
    expect(checkText(
      'data/profiles/example.json',
      '{"src":"[-282, -169, -56, 56, 169, 282] is the approved D convention"}',
    )).toEqual([]);
  });

  it('catches canonical numeric JSON arrays and wrapped reachability-policy wording once each', () => {
    expect(checkText(
      'data/profiles/example.json',
      '{\n  "dV_relay_mv": [ 300, -240, 290, -110, 250, -170 ]\n}',
    ).map((finding) => [finding.rule, finding.line])).toEqual([['legacy-dv-vector', 2]]);
    expect(checkText(
      'docs/example.md',
      'Whether\nthe shipped\ngate should apply\n`dV_relay_mv` by\ndefault is\nunresolved.',
    ).map((finding) => [finding.rule, finding.line])).toEqual([['unresolved-reachability-policy', 1]]);
  });

  it.each([
    ['L_coil\n  exists to lengthen the carry window.', 'inductance-lengthens-race-window'],
    ['a carry\nrace in the counter', 'carry-race'],
    ['time-to-pull-in has\ndoubled', 'time-to-pull-in-doubled'],
  ])('catches a rule restated across a line wrap %s', (content, rule) => {
    expect(checkText('docs/example.md', content).map((finding) => finding.rule)).toContain(rule);
  });

  it('rejects malformed shipping JSON', () => {
    expect(() => checkText('data/profiles/example.json', '{"src":')).toThrow(
      /mechanism-claims could not parse data\/profiles\/example\.json/,
    );
  });
});
