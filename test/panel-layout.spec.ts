import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import rawNetlist from '../data/netlist.json';
import {
  DECIMAL_ANGLES,
  MATRIX_ORDER,
  PANEL_ASPECT,
  PANEL_BANDS,
  PANEL_COMPONENTS,
  PANEL_CONTROLS,
  PANEL_HOLES,
  PANEL_LEGENDS,
  PANEL_LINEWORK,
  PANEL_PLATES,
  PANEL_REGIONS,
  PANEL_TERMINALS,
  PH2_HORIZONTAL,
  PH2_HORIZONTAL_SOURCE,
  PH2_POWER_STRIPE,
  fitPanel,
  projectPanelPoint,
  validatePanelLayout,
} from '../src/ui/panel-layout.ts';

const SECTION_SUFFIXES = [
  'A', 'B', '+', '-', 'C', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'N', 'com', 'cap',
  'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
] as const;
const MATRIX_IDS = [
  'M1t', 'M2t', 'M3t', 'M4t', 'M5t', 'M6t', 'M7t', 'M8t', 'M9t',
  'M1b', 'M2b', 'M3b', 'M4b', 'M5b', 'M6b', 'M7b', 'M8b', 'M9b', 'M10', 'M11',
] as const;
const EXPECTED_TERMINALS = [
  ...Array.from({ length: 6 }, (_, index) => SECTION_SUFFIXES.map((suffix) => String(index + 1) + suffix)).flat(),
  'M+', 'M-', ...MATRIX_IDS, ...Array.from({ length: 20 }, (_, index) => 'D' + index),
];

const SECTION_REGION_SUFFIXES = [
  ['binary-output', ['A', 'B']],
  ['power-stripe', ['+', '-']],
  ['storage-processing', ['C', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'N']],
  ['auxiliary', ['com', 'cap']],
  ['secondary-storage', ['R', 'S', 'T', 'U', 'V', 'W']],
  ['binary-input', ['X', 'Y', 'Z']],
] as const;

function digest(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new Error('test inventory is not JSON serializable');
  return createHash('sha256').update(json).digest('hex');
}

const PANEL_LAYOUT_PATH = fileURLToPath(new URL('../data/panel-layout.json', import.meta.url));

function expectDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child, seen);
}

function terminal(id: string) {
  const value = PANEL_TERMINALS.find((candidate) => candidate.id === id);
  if (value === undefined) throw new Error('missing terminal ' + id);
  return value;
}

function legend(id: string) {
  const value = PANEL_LEGENDS.find((candidate) => candidate.id === id);
  if (value === undefined) throw new Error('missing legend ' + id);
  return value;
}

function component(id: string) {
  const value = PANEL_COMPONENTS.find((candidate) => candidate.id === id);
  if (value === undefined) throw new Error('missing component ' + id);
  return value;
}

function control(id: string) {
  const value = PANEL_CONTROLS.find((candidate) => candidate.id === id);
  if (value === undefined) throw new Error('missing control ' + id);
  return value;
}

function linework(id: string) {
  const value = PANEL_LINEWORK.find((candidate) => candidate.id === id);
  if (value === undefined) throw new Error('missing linework ' + id);
  return value;
}

describe('Phase 2 period-panel layout oracle', () => {
  it('freezes the exact plate, band, and region manifests', () => {
    expect(PANEL_ASPECT).toBe(1.8);
    expect(PH2_HORIZONTAL).toEqual({ leftFieldRight: 0.716, rightColumnLeft: 0.728, channelPitch: 0.113 });
    expect(PH2_HORIZONTAL_SOURCE).toBe('panel.md §3 — PH2 unverified image measurement');
    expect(PH2_POWER_STRIPE).toEqual({ top: 0.184, bottom: 0.229 });
    expect(PANEL_PLATES).toEqual([
      { id: 'left', x: 0.019, y: 0.019, width: 0.697, height: 0.966, source: 'panel.md §§2–3 — PH2 unverified image measurement' },
      { id: 'upper-right', x: 0.728, y: 0.019, width: 0.253, height: 0.455, source: 'panel.md §§2–3 — PH2 unverified image measurement' },
      { id: 'lower-right', x: 0.728, y: 0.501, width: 0.253, height: 0.484, source: 'panel.md §§2–3 — PH2 unverified image measurement' },
    ]);
    expect(PANEL_BANDS).toEqual([
      ['left/binary-output', 'left', 'dark', 0.019, 0.184, 'BINARY OUTPUT'],
      ['left/power-stripe', 'left', 'teal', 0.184, 0.229, null],
      ['left/storage-processing', 'left', 'dark', 0.229, 0.549, 'STORAGE/PROCESSING'],
      ['left/auxiliary', 'left', 'teal', 0.549, 0.598, null],
      ['left/secondary-storage', 'left', 'dark', 0.598, 0.757, 'SECONDARY STORAGE'],
      ['left/blank', 'left', 'teal', 0.757, 0.776, null],
      ['left/binary-input', 'left', 'dark', 0.776, 0.985, 'BINARY INPUT'],
      ['right/logo', 'upper-right', 'dark', 0.019, 0.184, null],
      ['right/power-stripe', 'upper-right', 'teal', 0.184, 0.229, 'POWER'],
      ['right/matrix-power', 'upper-right', 'dark', 0.229, 0.474, null],
      ['right/divider', 'console', 'teal', 0.474, 0.501, null],
      ['right/decimal', 'lower-right', 'dark', 0.501, 0.985, 'DECIMAL INPUT-OUTPUT'],
    ]);

    const expectedRegions: [string, string[]][] = [];
    for (let section = 1; section <= 6; section++) {
      for (const [name, suffixes] of SECTION_REGION_SUFFIXES) {
        expectedRegions.push([
          'section-' + section + '/' + name,
          suffixes.map((suffix) => String(section) + suffix),
        ]);
      }
    }
    expectedRegions.push(
      ['right-power', ['M+', 'M-']],
      ['matrix', [...MATRIX_IDS]],
      ['power', []],
      ['decimal', Array.from({ length: 20 }, (_, index) => 'D' + index)],
    );
    expect(PANEL_REGIONS.map((region) => [region.id, [...region.terminalIds]])).toEqual(expectedRegions);
  });

  it('owns every terminal and hole identity in validated netlist order', () => {
    expect(PANEL_TERMINALS).toHaveLength(186);
    expect(PANEL_HOLES).toHaveLength(392);
    expect(PANEL_TERMINALS.map((terminal) => terminal.id)).toEqual(EXPECTED_TERMINALS);
    expect(PANEL_TERMINALS.map((terminal) => terminal.id)).toEqual(rawNetlist.terminals.map((row) => row.id));
    expect(PANEL_HOLES.map((hole) => hole.id)).toEqual(rawNetlist.terminals.flatMap((terminal) =>
      Array.from({ length: terminal.holes }, (_, index) => terminal.id + '#' + (index + 1)),
    ));
    expect(PANEL_TERMINALS.map((terminal) => terminal.holes.length))
      .toEqual(rawNetlist.terminals.map((terminal) => terminal.holes));
    expect(PANEL_REGIONS.flatMap((region) => region.terminalIds)).toEqual(EXPECTED_TERMINALS);
    expect(PANEL_REGIONS.find((region) => region.id === 'power')?.terminalIds).toEqual([]);
    expect(() => validatePanelLayout(rawNetlist)).not.toThrow();

    for (const point of [
      ...PANEL_TERMINALS,
      ...PANEL_HOLES,
      ...PANEL_LEGENDS,
      ...PANEL_COMPONENTS,
      ...PANEL_CONTROLS,
    ]) {
      expect(Number.isFinite(point.x) && point.x >= 0 && point.x <= 1, point.id + '.x').toBe(true);
      expect(Number.isFinite(point.y) && point.y >= 0 && point.y <= 1, point.id + '.y').toBe(true);
    }
  });

  it('freezes exact matrix and decimal topology instead of inferring it from DOM order', () => {
    expect(MATRIX_ORDER).toEqual([[1, 2, 3], [8, 9, 4], [7, 6, 5]]);
    expect(PANEL_TERMINALS.filter((terminal) => terminal.region === 'matrix')
      .map((terminal) => [terminal.id, terminal.artwork])).toEqual([
      ...Array.from({ length: 9 }, (_, index) => ['M' + (index + 1) + 't', 'pair-bar']),
      ...Array.from({ length: 9 }, (_, index) => ['M' + (index + 1) + 'b', 'pair-bar']),
      ['M10', 'closed-loop'],
      ['M11', 'closed-loop'],
    ]);
    expect(PANEL_TERMINALS.filter((terminal) => /^\dcom$/u.test(terminal.id))
      .map((terminal) => [terminal.id, terminal.holes.length, terminal.artwork])).toEqual(
      Array.from({ length: 6 }, (_, index) => [String(index + 1) + 'com', 4, 'none']),
    );
    expect(DECIMAL_ANGLES).toEqual(Array.from({ length: 16 }, (_, index) => ({
      id: 'D' + index,
      degrees: index * 22.5,
    })));
  });

  it('keeps the section print and controls in their documented vertical relationships', () => {
    const storageTitle = legend('left/storage-processing');
    const inputTitle = legend('left/binary-input');
    for (let section = 1; section <= 6; section++) {
      expect(storageTitle.y).toBeGreaterThan(component('relay-lamp-' + section).y);
      expect(storageTitle.y).toBeLessThan(Math.min(
        terminal(section + 'G').y,
        terminal(section + 'H').y,
        terminal(section + 'J').y,
      ));
      expect(inputTitle.y).toBeLessThan(legend('section-' + section + '/input-no').y);
      expect(legend('section-' + section + '/input-no').y).toBeLessThan(terminal(section + 'X').y);
      expect(terminal(section + 'X').y).toBeLessThan(component('pushbutton-' + section).y);

      const lowerRow = Math.max(terminal(section + 'U').y, terminal(section + 'V').y, terminal(section + 'W').y);
      expect(component('slide-' + section).y).toBeGreaterThan(lowerRow);
      expect(component('slide-rivet-' + section + '-left').y).toBeGreaterThan(lowerRow);
      expect(component('slide-rivet-' + section + '-right').y).toBeGreaterThan(lowerRow);
      expect(control('switch' + section).y).toBeGreaterThan(lowerRow);
    }
  });

  it('places matrix and decimal numerals relative to the artwork they identify', () => {
    for (let number = 1; number <= 9; number++) {
      const top = terminal('M' + number + 't');
      const bottom = terminal('M' + number + 'b');
      const numeral = legend('matrix/' + number);
      expect(numeral.x).toBe(top.x);
      expect(numeral.x).toBe(bottom.x);
      expect(numeral.y).toBeGreaterThan(top.y);
      expect(numeral.y).toBeLessThan(bottom.y);
    }
    for (const number of [10, 11]) {
      const loop = linework('matrix/' + number + '-loop');
      expect(legend('matrix/' + number).y).toBeGreaterThan(Math.max(
        ...terminal('M' + number).holes.map((hole) => hole.y),
        ...loop.points.map((point) => point.y),
      ));
    }
    expect(legend('matrix/title').x).toBe(PH2_HORIZONTAL.rightColumnLeft);

    const dial = component('dial-knob');
    const inner = linework('decimal/inner-circle');
    const middle = linework('decimal/middle-circle');
    const outer = linework('decimal/outer-circle');
    for (let number = 0; number < 16; number++) {
      const jack = terminal('D' + number);
      const numeral = legend('decimal/' + number);
      expect([numeral.x, numeral.y]).not.toEqual([jack.x, jack.y]);
      const ellipse = (x: number, y: number, radiusX: number, radiusY: number) =>
        ((x - dial.x) / radiusX) ** 2 + ((y - dial.y) / radiusY) ** 2;
      expect(ellipse(numeral.x, numeral.y, inner.radiusX!, inner.radiusY!)).toBeGreaterThan(1);
      expect(ellipse(numeral.x, numeral.y, middle.radiusX!, middle.radiusY!)).toBeLessThan(1);
      expect(ellipse(jack.x, jack.y, middle.radiusX!, middle.radiusY!)).toBeGreaterThan(1);
      expect(ellipse(jack.x, jack.y, outer.radiusX!, outer.radiusY!)).toBeLessThan(1);
    }
  });

  it('draws LIGHT over C-to-E and COIL over E-to-F with downturned end ticks', () => {
    for (let section = 1; section <= 6; section++) {
      for (const [name, from, to] of [['light', 'C', 'E'], ['coil', 'E', 'F']] as const) {
        const start = terminal(section + from);
        const end = terminal(section + to);
        const bracket = linework('section-' + section + '/' + name + '-bracket');
        expect(bracket.points.map((value) => value.x)).toEqual([start.x, start.x, end.x, end.x]);
        expect(bracket.points[0]!.y).toBeGreaterThan(bracket.points[1]!.y);
        expect(bracket.points[1]!.y).toBe(bracket.points[2]!.y);
        expect(bracket.points[3]!.y).toBeGreaterThan(bracket.points[2]!.y);
        const title = legend('section-' + section + '/' + name);
        expect(title.x).toBe((start.x + end.x) / 2);
        expect(title.y).toBeLessThan(bracket.points[1]!.y);
      }
    }
  });

  it('ends each matrix pair bar at its two hole centers', () => {
    for (let number = 1; number <= 9; number++) {
      for (const suffix of ['t', 'b'] as const) {
        const id = 'M' + number + suffix;
        const holes = PANEL_HOLES.filter((hole) => hole.terminal === id);
        const bar = linework('matrix/' + number + '-' + (suffix === 't' ? 'top' : 'bottom') + '-bar');
        expect(bar.points).toEqual([
          { x: Math.min(...holes.map((hole) => hole.x)), y: holes[0]!.y },
          { x: Math.max(...holes.map((hole) => hole.x)), y: holes[0]!.y },
        ]);
      }
    }
  });

  it('distinguishes measured gross geometry from chosen fine-placement tokens', () => {
    expect(PANEL_PLATES.map((plate) => plate.source)).toEqual(
      Array.from({ length: 3 }, () => 'panel.md §§2–3 — PH2 unverified image measurement'),
    );
    expect(PANEL_REGIONS.slice(0, 36).every((region) => region.source === 'panel.md §§4–6')).toBe(true);
    expect(PANEL_REGIONS.slice(36).every((region) => region.source === 'panel.md §§6–8')).toBe(true);
    const placed = [...PANEL_TERMINALS, ...PANEL_LEGENDS, ...PANEL_COMPONENTS, ...PANEL_CONTROLS];
    for (const item of placed) {
      const isSection = item.region.startsWith('section-') || item.region.startsWith('left/');
      expect(item.source).toBe(isSection
        ? 'panel.md §§4–6 — unverified chosen redraw token'
        : 'panel.md §§6–8 — unverified chosen redraw token');
    }
    for (const item of PANEL_LINEWORK) {
      expect(item.source).toBe(item.id.startsWith('section-')
        ? 'panel.md §§4–6 — unverified chosen redraw token'
        : 'panel.md §§6–8 — unverified chosen redraw token');
    }
    const fine = [...placed, ...PANEL_LINEWORK];
    expect(fine.some((item) => item.source.includes('PH2 unverified image measurement'))).toBe(false);
  });

  it('deep-owns the complete control, component, linework, and legend inventories', () => {
    expect(PANEL_CONTROLS.map((control) => [control.id, control.kind, control.region, control.section])).toEqual([
      ...Array.from({ length: 6 }, (_, index) => ['relay' + (index + 1), 'relay-crossbar', 'section-' + (index + 1) + '/storage-processing', index + 1]),
      ...Array.from({ length: 6 }, (_, index) => ['switch' + (index + 1), 'slide-switch', 'section-' + (index + 1) + '/secondary-storage', index + 1]),
      ...Array.from({ length: 6 }, (_, index) => ['button' + (index + 1), 'pushbutton', 'section-' + (index + 1) + '/binary-input', index + 1]),
      ['power', 'power-switch', 'power', null],
      ['breaker', 'breaker-button', 'power', null],
      ['dial', 'dial', 'decimal', null],
    ]);

    expect(PANEL_COMPONENTS.map((component) => [component.id, component.kind])).toEqual([
      ...Array.from({ length: 6 }, (_, index) => ['out-lamp-' + (index + 1), 'standard-lamp']),
      ...Array.from({ length: 6 }, (_, index) => ['relay-' + (index + 1), 'relay']),
      ...Array.from({ length: 6 }, (_, index) => ['relay-lamp-' + (index + 1), 'standard-lamp']),
      ...Array.from({ length: 6 }, (_, index) => ['slide-' + (index + 1), 'slide-switch']),
      ...Array.from({ length: 6 }, (_, index) => [
        ['slide-rivet-' + (index + 1) + '-left', 'rivet'],
        ['slide-rivet-' + (index + 1) + '-right', 'rivet'],
      ]).flat(),
      ...Array.from({ length: 6 }, (_, index) => ['pushbutton-' + (index + 1), 'pushbutton']),
      ['power-jewel', 'power-jewel'],
      ['breaker-button', 'breaker-button'],
      ['power-rivet-top', 'rivet'],
      ['power-switch', 'power-switch'],
      ['power-rivet-bottom', 'rivet'],
      ['dial-knob', 'dial-knob'],
    ]);
    expect(PANEL_COMPONENTS.filter((component) => component.kind === 'standard-lamp')).toHaveLength(12);
    expect(PANEL_COMPONENTS.filter((component) => component.kind === 'power-jewel')
      .map((component) => component.id)).toEqual(['power-jewel']);

    expect(PANEL_LINEWORK.map((line) => [line.id, line.kind])).toEqual([
      ...Array.from({ length: 6 }, (_, index) => [
        ['section-' + (index + 1) + '/light-bracket', 'bracket'],
        ['section-' + (index + 1) + '/coil-bracket', 'bracket'],
        ['section-' + (index + 1) + '/left-arrow', 'arrow'],
        ['section-' + (index + 1) + '/right-arrow', 'arrow'],
      ]).flat(),
      ['matrix/vertical-1', 'rule'],
      ['matrix/vertical-2', 'rule'],
      ['matrix/horizontal-1', 'rule'],
      ['matrix/horizontal-2', 'rule'],
      ...Array.from({ length: 9 }, (_, index) => [
        ['matrix/' + (index + 1) + '-top-bar', 'pair-bar'],
        ['matrix/' + (index + 1) + '-bottom-bar', 'pair-bar'],
      ]).flat(),
      ['matrix/10-loop', 'closed-loop'],
      ['matrix/11-loop', 'closed-loop'],
      ['matrix/power-divider', 'rule'],
      ['decimal/inner-circle', 'circle'],
      ['decimal/middle-circle', 'circle'],
      ['decimal/outer-circle', 'circle'],
      ...Array.from({ length: 16 }, (_, index) => ['decimal/sector-' + index, 'radial']),
      ['decimal/run-bracket', 'bracket'],
      ['decimal/stop-bracket', 'bracket'],
    ]);

    const expectedLegendCore: [string, string, string][] = [];
    for (let section = 1; section <= 6; section++) {
      const prefix = 'section-' + section + '/';
      expectedLegendCore.push(
        [prefix + 'number', String(section), 'section-number'],
        [prefix + 'A', 'A', 'terminal'], [prefix + 'B', 'B', 'terminal'],
        [prefix + 'plus', '+', 'terminal-above'], [prefix + 'minus', '-', 'terminal-above'],
        [prefix + 'light', 'LIGHT', 'group'], [prefix + 'coil', 'COIL', 'group'],
        ...['C', 'E', 'F'].map((text) => [prefix + text, text, 'terminal'] as [string, string, string]),
        [prefix + 'contact-no', 'N.O.', 'group'], [prefix + 'contact-arm', 'ARM', 'group'],
        [prefix + 'contact-nc', 'N.C.', 'group'],
        ...['G', 'H', 'J', 'K', 'L', 'N'].map((text) => [prefix + text, text, 'terminal'] as [string, string, string]),
        [prefix + 'common', 'COMMON', 'group'], [prefix + 'capacitor', 'CAPACITOR', 'group'],
        [prefix + 'left-arrow', '←', 'glyph'], [prefix + 'switch-arm', 'ARM', 'group'],
        [prefix + 'right-arrow', '→', 'glyph'],
        ...['R', 'S', 'T', 'U', 'V', 'W'].map((text) => [prefix + text, text, 'terminal'] as [string, string, string]),
        [prefix + 'input-no', 'N.O.', 'group'], [prefix + 'input-arm', 'ARM', 'group'],
        [prefix + 'input-nc', 'N.C.', 'group'],
        ...['X', 'Y', 'Z'].map((text) => [prefix + text, text, 'terminal'] as [string, string, string]),
      );
    }
    expectedLegendCore.push(
      ['left/binary-output', 'BINARY OUTPUT', 'band-title'],
      ['left/storage-processing', 'STORAGE/PROCESSING', 'band-title'],
      ['left/secondary-storage', 'SECONDARY STORAGE', 'band-title'],
      ['left/binary-input', 'BINARY INPUT', 'band-title'],
      ['right/logotype', 'Minivac 601', 'logotype'],
      ['right/fine-print', 'Scientific Development Corporation, Cambridge, Massachusetts. Made in U. S. A. Patents applied for.', 'fine-print'],
      ['right/plus', '+', 'terminal-above'], ['right/minus', '-', 'terminal-above'],
      ['right/power-title', 'POWER', 'block-title'],
      ...[1, 2, 3, 8, 9, 4, 7, 6, 5, 10, 11].map((number) => ['matrix/' + number, String(number), 'matrix-number'] as [string, string, string]),
      ['matrix/title', 'MATRIX', 'block-title-left'],
      ['power/breaker', 'CIRCUIT BREAKER', 'two-line'],
      ['power/on', 'ON', 'control-label'], ['power/off', 'OFF', 'control-label'],
      ...Array.from({ length: 16 }, (_, index) => ['decimal/' + index, String(index), 'dial-number'] as [string, string, string]),
      ...[16, 17, 18, 19].map((number) => ['decimal/' + number, String(number), 'terminal-left'] as [string, string, string]),
      ['decimal/arm', 'ARM', 'group'], ['decimal/run', 'RUN', 'group'], ['decimal/stop', 'STOP', 'group'],
      ['decimal/title', 'DECIMAL INPUT-OUTPUT', 'block-title'],
    );
    expect(PANEL_LEGENDS.map((legend) => [legend.id, legend.text, legend.form])).toEqual(expectedLegendCore);
  });

  it('pins every field and order in each frozen layout inventory', () => {
    const inventories = {
      plates: PANEL_PLATES,
      bands: PANEL_BANDS,
      regions: PANEL_REGIONS,
      terminals: PANEL_TERMINALS,
      holes: PANEL_HOLES,
      legends: PANEL_LEGENDS,
      components: PANEL_COMPONENTS,
      controls: PANEL_CONTROLS,
      linework: PANEL_LINEWORK,
      matrixOrder: MATRIX_ORDER,
      decimalAngles: DECIMAL_ANGLES,
    };
    expect(Object.fromEntries(Object.entries(inventories).map(([name, inventory]) => [name, digest(inventory)])))
      .toEqual({
        plates: '74b26a2360899543bb0bd737d23bff441e60caab6dda144dccfc41339e463f4c',
        bands: 'f19e64845f84f609b213917be15fcc17717c839e69dc456d18e0d211d77a890a',
        regions: '0d46f07ca4dfb828eacda55c5651367186ade64847936e37bb7449459d783465',
        terminals: 'd204bbda809d96362ff78fd94e3d99dd43661382c8628d71ce3b49aab4ae7b55',
        holes: '4a301187fca8006f075ecaa33bdad7cf466d954fac61df008a0e857831d17dc9',
        legends: 'bab7075a79a00fc3ada044e8a0282f272ef33630fb94277a5341a39d26db9fe1',
        components: '13250adc53d82451393dc0145a2c111415e139152915b8f9ea4bcf27e7e190c5',
        controls: 'c5fa8bc941602ea0359b097f24a4a0f3fbc57d89e4fb3f53fa0872178a967205',
        linework: '10edc795fa46d59f20d53730a0b0afaf5fd443f1fc8250b344f9608e50b04f27',
        matrixOrder: 'ebe9df45d2bdfc7d730ef443682af1e03ed3d33266a61b7489aacecee84a693e',
        decimalAngles: 'd6f5c0071f33b25a72ea7683284e5d0d3beca9174b5f1338f01f7b3f43cf7dbb',
      });
    for (const inventory of Object.values(inventories)) expectDeepFrozen(inventory);
  });

  it('exports the Godot layout input without re-deriving any coordinate', () => {
    const exported = JSON.parse(readFileSync(PANEL_LAYOUT_PATH, 'utf8')) as Record<string, unknown>;
    expect(exported).toEqual({
      schema: 'minivac.panel-layout/1',
      sources: {
        ph2HorizontalSource: PH2_HORIZONTAL_SOURCE,
        note: 'panel.md §11 — absolute dimensions and jack pitch are not settled by any source; every placement here is an unverified redraw token',
      },
      aspect: PANEL_ASPECT,
      ph2Horizontal: PH2_HORIZONTAL,
      ph2PowerStripe: PH2_POWER_STRIPE,
      plates: PANEL_PLATES,
      bands: PANEL_BANDS,
      regions: PANEL_REGIONS,
      terminals: PANEL_TERMINALS,
      holes: PANEL_HOLES,
      legends: PANEL_LEGENDS,
      components: PANEL_COMPONENTS,
      controls: PANEL_CONTROLS,
      linework: PANEL_LINEWORK,
      matrixOrder: MATRIX_ORDER,
      decimalAngles: DECIMAL_ANGLES,
    });
    expect(Object.fromEntries(Object.entries(exported)
      .filter(([name]) => ['plates', 'bands', 'regions', 'terminals', 'holes', 'legends', 'components', 'controls', 'linework', 'matrixOrder', 'decimalAngles'].includes(name))
      .map(([name, inventory]) => [name, digest(inventory)])))
      .toEqual({
        plates: '74b26a2360899543bb0bd737d23bff441e60caab6dda144dccfc41339e463f4c',
        bands: 'f19e64845f84f609b213917be15fcc17717c839e69dc456d18e0d211d77a890a',
        regions: '0d46f07ca4dfb828eacda55c5651367186ade64847936e37bb7449459d783465',
        terminals: 'd204bbda809d96362ff78fd94e3d99dd43661382c8628d71ce3b49aab4ae7b55',
        holes: '4a301187fca8006f075ecaa33bdad7cf466d954fac61df008a0e857831d17dc9',
        legends: 'bab7075a79a00fc3ada044e8a0282f272ef33630fb94277a5341a39d26db9fe1',
        components: '13250adc53d82451393dc0145a2c111415e139152915b8f9ea4bcf27e7e190c5',
        controls: 'c5fa8bc941602ea0359b097f24a4a0f3fbc57d89e4fb3f53fa0872178a967205',
        linework: '10edc795fa46d59f20d53730a0b0afaf5fd443f1fc8250b344f9608e50b04f27',
        matrixOrder: 'ebe9df45d2bdfc7d730ef443682af1e03ed3d33266a61b7489aacecee84a693e',
        decimalAngles: 'd6f5c0071f33b25a72ea7683284e5d0d3beca9174b5f1338f01f7b3f43cf7dbb',
      });
  });

  it('projects the same fixed 1.80 surface into two desktop viewports', () => {
    const first = fitPanel(1440, 900);
    const second = fitPanel(1800, 1200);
    expect(first).toEqual({ x: 0, y: 50, width: 1440, height: 800 });
    expect(second).toEqual({ x: 0, y: 100, width: 1800, height: 1000 });
    const anchors = ['1A', 'M+', 'D0', 'D19'].map((id) => {
      const point = PANEL_TERMINALS.find((terminal) => terminal.id === id);
      if (point === undefined) throw new Error('missing test anchor ' + id);
      return point;
    });
    expect(anchors.map((point) => [point.id, projectPanelPoint(point, first)])).toEqual([
      ['1A', { x: 76.8384, y: 118 }],
      ['M+', { x: 1108.8, y: 215.2 }],
      ['D0', { x: 1260, y: 526 }],
      ['D19', { x: 1087.2, y: 718 }],
    ]);
    expect(anchors.map((point) => [point.id, projectPanelPoint(point, second)])).toEqual([
      ['1A', { x: 96.048, y: 185 }],
      ['M+', { x: 1386, y: 306.5 }],
      ['D0', { x: 1575, y: 695 }],
      ['D19', { x: 1359, y: 935 }],
    ]);
  });

  it('rejects caller views whose terminal identity, order, or hole count drifts', () => {
    const reordered = structuredClone(rawNetlist);
    [reordered.terminals[0], reordered.terminals[1]] = [reordered.terminals[1]!, reordered.terminals[0]!];
    expect(() => validatePanelLayout(reordered)).toThrow('terminal 0');

    const holes = structuredClone(rawNetlist);
    holes.terminals[0]!.holes = 3;
    expect(() => validatePanelLayout(holes)).toThrow('1A holes');
  });
});
