/**
 * Pure, normalized artwork oracle for the MINIVAC 601 panel.
 *
 * This module deliberately knows nothing about netlist loading or electrical behavior. Gross
 * boundaries are PH2 redraw measurements; fine placements are explicitly unverified chosen tokens
 * constrained by the documented panel relationships (panel.md §§2–8), not dimensional facts.
 */

export const PANEL_ASPECT = 1.8;

export const PH2_HORIZONTAL = Object.freeze({
  leftFieldRight: 0.716,
  rightColumnLeft: 0.728,
  channelPitch: 0.113,
});
export const PH2_HORIZONTAL_SOURCE = 'panel.md §3 — PH2 unverified image measurement';

export const PH2_POWER_STRIPE = Object.freeze({ top: 0.184, bottom: 0.229 });

export interface PanelPoint {
  readonly x: number;
  readonly y: number;
}

export interface PanelPlate extends PanelPoint {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly source: string;
}

export type PanelBand = readonly [
  id: string,
  plate: string,
  tone: 'dark' | 'teal',
  top: number,
  bottom: number,
  title: string | null,
];

export interface PanelRegion {
  readonly id: string;
  readonly terminalIds: readonly string[];
  readonly source: string;
}

export type TerminalArtwork = 'none' | 'pair-bar' | 'closed-loop';

export interface PanelHole extends PanelPoint {
  readonly id: string;
  readonly terminal: string;
  readonly hole: number;
}

export interface PanelTerminal extends PanelPoint {
  readonly id: string;
  readonly region: string;
  readonly artwork: TerminalArtwork;
  readonly holes: readonly PanelHole[];
  readonly source: string;
}

export interface PanelLegend extends PanelPoint {
  readonly id: string;
  readonly text: string;
  readonly form: string;
  /** A `PANEL_REGIONS` id, except on `band-title` legends, which carry the `PANEL_BANDS` id they title. */
  readonly region: string;
  readonly source: string;
}

export interface PanelComponent extends PanelPoint {
  readonly id: string;
  readonly kind: string;
  readonly region: string;
  readonly source: string;
}

export interface PanelControl extends PanelPoint {
  readonly id: string;
  readonly kind: string;
  readonly region: string;
  readonly section: number | null;
  readonly source: string;
}

export interface PanelLinework extends PanelPoint {
  readonly id: string;
  readonly kind: 'arrow' | 'bracket' | 'circle' | 'closed-loop' | 'pair-bar' | 'radial' | 'rule';
  readonly points: readonly PanelPoint[];
  readonly radiusX?: number;
  readonly radiusY?: number;
  readonly source: string;
}

export interface PanelFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RawTerminalView {
  readonly id: string;
  readonly holes: number;
}

export interface RawNetlistView {
  readonly terminals: readonly RawTerminalView[];
}

const SOURCE_PLATES = 'panel.md §§2–3 — PH2 unverified image measurement';
const SOURCE_SECTIONS = 'panel.md §§4–6';
const SOURCE_RIGHT = 'panel.md §§6–8';
const SOURCE_SECTION_LAYOUT = SOURCE_SECTIONS + ' — unverified chosen redraw token';
const SOURCE_RIGHT_LAYOUT = SOURCE_RIGHT + ' — unverified chosen redraw token';
const COLUMN_SPACING = PH2_HORIZONTAL.channelPitch * 0.28;
const HOLE_SPACING = COLUMN_SPACING * 0.35;
const FIRST_CHANNEL_CENTER = 0.085;

function freezeRecords<T extends object>(values: T[]): readonly Readonly<T>[] {
  for (const value of values) Object.freeze(value);
  return Object.freeze(values);
}

function point(x: number, y: number): PanelPoint {
  return Object.freeze({ x, y });
}

export const PANEL_PLATES: readonly PanelPlate[] = freezeRecords([
  { id: 'left', x: 0.019, y: 0.019, width: 0.697, height: 0.966, source: SOURCE_PLATES },
  { id: 'upper-right', x: 0.728, y: 0.019, width: 0.253, height: 0.455, source: SOURCE_PLATES },
  { id: 'lower-right', x: 0.728, y: 0.501, width: 0.253, height: 0.484, source: SOURCE_PLATES },
]);

export const PANEL_BANDS: readonly PanelBand[] = Object.freeze([
  ['left/binary-output', 'left', 'dark', 0.019, 0.184, 'BINARY OUTPUT'],
  ['left/power-stripe', 'left', 'teal', PH2_POWER_STRIPE.top, PH2_POWER_STRIPE.bottom, null],
  ['left/storage-processing', 'left', 'dark', 0.229, 0.549, 'STORAGE/PROCESSING'],
  ['left/auxiliary', 'left', 'teal', 0.549, 0.598, null],
  ['left/secondary-storage', 'left', 'dark', 0.598, 0.757, 'SECONDARY STORAGE'],
  ['left/blank', 'left', 'teal', 0.757, 0.776, null],
  ['left/binary-input', 'left', 'dark', 0.776, 0.985, 'BINARY INPUT'],
  ['right/logo', 'upper-right', 'dark', 0.019, 0.184, null],
  ['right/power-stripe', 'upper-right', 'teal', PH2_POWER_STRIPE.top, PH2_POWER_STRIPE.bottom, 'POWER'],
  ['right/matrix-power', 'upper-right', 'dark', 0.229, 0.474, null],
  ['right/divider', 'console', 'teal', 0.474, 0.501, null],
  ['right/decimal', 'lower-right', 'dark', 0.501, 0.985, 'DECIMAL INPUT-OUTPUT'],
].map((band) => Object.freeze(band)) as PanelBand[]);

const SECTION_REGIONS = Object.freeze([
  ['binary-output', ['A', 'B']],
  ['power-stripe', ['+', '-']],
  ['storage-processing', ['C', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'N']],
  ['auxiliary', ['com', 'cap']],
  ['secondary-storage', ['R', 'S', 'T', 'U', 'V', 'W']],
  ['binary-input', ['X', 'Y', 'Z']],
] as const);

const MATRIX_IDS = Object.freeze([
  'M1t', 'M2t', 'M3t', 'M4t', 'M5t', 'M6t', 'M7t', 'M8t', 'M9t',
  'M1b', 'M2b', 'M3b', 'M4b', 'M5b', 'M6b', 'M7b', 'M8b', 'M9b', 'M10', 'M11',
]);

const regions: PanelRegion[] = [];
for (let section = 1; section <= 6; section++) {
  for (const [name, suffixes] of SECTION_REGIONS) {
    regions.push({
      id: 'section-' + section + '/' + name,
      terminalIds: Object.freeze(suffixes.map((suffix) => String(section) + suffix)),
      source: SOURCE_SECTIONS,
    });
  }
}
regions.push(
  { id: 'right-power', terminalIds: Object.freeze(['M+', 'M-']), source: SOURCE_RIGHT },
  { id: 'matrix', terminalIds: MATRIX_IDS, source: SOURCE_RIGHT },
  { id: 'power', terminalIds: Object.freeze([]), source: SOURCE_RIGHT },
  {
    id: 'decimal',
    terminalIds: Object.freeze(Array.from({ length: 20 }, (_, index) => 'D' + index)),
    source: SOURCE_RIGHT,
  },
);
export const PANEL_REGIONS: readonly PanelRegion[] = freezeRecords(regions) as readonly PanelRegion[];

function terminalHoles(
  id: string,
  count: number,
  x: number,
  y: number,
  artwork: TerminalArtwork,
): readonly PanelHole[] {
  const offsets: readonly PanelPoint[] = count === 2
    ? [point(-HOLE_SPACING / 2, 0), point(HOLE_SPACING / 2, 0)]
    : artwork === 'closed-loop'
      ? [
          point(-HOLE_SPACING / 2, -0.012), point(HOLE_SPACING / 2, -0.012),
          point(-HOLE_SPACING / 2, 0), point(HOLE_SPACING / 2, 0),
          point(-HOLE_SPACING / 2, 0.012), point(HOLE_SPACING / 2, 0.012),
        ]
      : [
          point(-1.5 * HOLE_SPACING, 0), point(-0.5 * HOLE_SPACING, 0),
          point(0.5 * HOLE_SPACING, 0), point(1.5 * HOLE_SPACING, 0),
        ];
  if (offsets.length !== count) {
    throw new Error(
      'panel layout: ' + id + ' declares ' + count + ' holes but ' + artwork + ' geometry emits ' + offsets.length,
    );
  }
  return freezeRecords(offsets.map((offset, index) => ({
    id: id + '#' + (index + 1),
    terminal: id,
    hole: index + 1,
    x: x + offset.x,
    y: y + offset.y,
  }))) as readonly PanelHole[];
}

function makeTerminal(
  id: string,
  region: string,
  x: number,
  y: number,
  count = 2,
  artwork: TerminalArtwork = 'none',
  source = SOURCE_SECTION_LAYOUT,
): PanelTerminal {
  return Object.freeze({ id, region, x, y, artwork, holes: terminalHoles(id, count, x, y, artwork), source });
}

const terminals: PanelTerminal[] = [];
for (let section = 1; section <= 6; section++) {
  const center = FIRST_CHANNEL_CENTER + (section - 1) * PH2_HORIZONTAL.channelPitch;
  const left = center - COLUMN_SPACING;
  const right = center + COLUMN_SPACING;
  const prefix = String(section);
  terminals.push(
    makeTerminal(prefix + 'A', 'section-' + section + '/binary-output', left, 0.085),
    makeTerminal(prefix + 'B', 'section-' + section + '/binary-output', right, 0.085),
    makeTerminal(prefix + '+', 'section-' + section + '/power-stripe', left, 0.2065),
    makeTerminal(prefix + '-', 'section-' + section + '/power-stripe', right, 0.2065),
    makeTerminal(prefix + 'C', 'section-' + section + '/storage-processing', left, 0.275),
    makeTerminal(prefix + 'E', 'section-' + section + '/storage-processing', center, 0.275),
    makeTerminal(prefix + 'F', 'section-' + section + '/storage-processing', right, 0.275),
    makeTerminal(prefix + 'G', 'section-' + section + '/storage-processing', left, 0.499),
    makeTerminal(prefix + 'H', 'section-' + section + '/storage-processing', center, 0.499),
    makeTerminal(prefix + 'J', 'section-' + section + '/storage-processing', right, 0.499),
    makeTerminal(prefix + 'K', 'section-' + section + '/storage-processing', left, 0.529),
    makeTerminal(prefix + 'L', 'section-' + section + '/storage-processing', center, 0.529),
    makeTerminal(prefix + 'N', 'section-' + section + '/storage-processing', right, 0.529),
    makeTerminal(prefix + 'com', 'section-' + section + '/auxiliary', left, 0.574, 4),
    makeTerminal(prefix + 'cap', 'section-' + section + '/auxiliary', right, 0.574),
    makeTerminal(prefix + 'R', 'section-' + section + '/secondary-storage', left, 0.665),
    makeTerminal(prefix + 'S', 'section-' + section + '/secondary-storage', center, 0.665),
    makeTerminal(prefix + 'T', 'section-' + section + '/secondary-storage', right, 0.665),
    makeTerminal(prefix + 'U', 'section-' + section + '/secondary-storage', left, 0.715),
    makeTerminal(prefix + 'V', 'section-' + section + '/secondary-storage', center, 0.715),
    makeTerminal(prefix + 'W', 'section-' + section + '/secondary-storage', right, 0.715),
    makeTerminal(prefix + 'X', 'section-' + section + '/binary-input', left, 0.86),
    makeTerminal(prefix + 'Y', 'section-' + section + '/binary-input', center, 0.86),
    makeTerminal(prefix + 'Z', 'section-' + section + '/binary-input', right, 0.86),
  );
}

terminals.push(
  makeTerminal('M+', 'right-power', 0.77, 0.2065, 2, 'none', SOURCE_RIGHT_LAYOUT),
  makeTerminal('M-', 'right-power', 0.82, 0.2065, 2, 'none', SOURCE_RIGHT_LAYOUT),
);

export const MATRIX_ORDER = Object.freeze([
  Object.freeze([1, 2, 3]),
  Object.freeze([8, 9, 4]),
  Object.freeze([7, 6, 5]),
]);

const matrixCenters = new Map<number, PanelPoint>();
for (let row = 0; row < MATRIX_ORDER.length; row++) {
  const numbers = MATRIX_ORDER[row];
  if (numbers === undefined) continue;
  for (let column = 0; column < numbers.length; column++) {
    const number = numbers[column];
    if (number !== undefined) matrixCenters.set(number, point(0.77 + column * 0.045, 0.285 + row * 0.07));
  }
}
for (let number = 1; number <= 9; number++) {
  const center = matrixCenters.get(number);
  if (center === undefined) throw new Error('panel layout: missing matrix center ' + number);
  terminals.push(makeTerminal('M' + number + 't', 'matrix', center.x, center.y - 0.016, 2, 'pair-bar', SOURCE_RIGHT_LAYOUT));
}
for (let number = 1; number <= 9; number++) {
  const center = matrixCenters.get(number);
  if (center === undefined) throw new Error('panel layout: missing matrix center ' + number);
  terminals.push(makeTerminal('M' + number + 'b', 'matrix', center.x, center.y + 0.016, 2, 'pair-bar', SOURCE_RIGHT_LAYOUT));
}
terminals.push(
  makeTerminal('M10', 'matrix', 0.745, 0.355, 6, 'closed-loop', SOURCE_RIGHT_LAYOUT),
  makeTerminal('M11', 'matrix', 0.885, 0.355, 6, 'closed-loop', SOURCE_RIGHT_LAYOUT),
);

export const DECIMAL_ANGLES = freezeRecords(Array.from({ length: 16 }, (_, index) => ({
  id: 'D' + index,
  degrees: index * 22.5,
})));

const dialCenter = point(0.875, 0.735);
for (const angle of DECIMAL_ANGLES) {
  const radians = angle.degrees * Math.PI / 180;
  terminals.push(makeTerminal(
    angle.id,
    'decimal',
    dialCenter.x + Math.sin(radians) * 0.078,
    dialCenter.y - Math.cos(radians) * 0.14,
    2,
    'none',
    SOURCE_RIGHT_LAYOUT,
  ));
}
for (const [index, y] of [0.58, 0.67, 0.755, 0.835].entries()) {
  terminals.push(makeTerminal('D' + (index + 16), 'decimal', 0.755, y, 2, 'none', SOURCE_RIGHT_LAYOUT));
}

export const PANEL_TERMINALS: readonly PanelTerminal[] = Object.freeze(terminals);
export const PANEL_HOLES: readonly PanelHole[] = Object.freeze(PANEL_TERMINALS.flatMap((terminal) => terminal.holes));

function sectionX(section: number): number {
  return FIRST_CHANNEL_CENTER + (section - 1) * PH2_HORIZONTAL.channelPitch;
}

function legend(id: string, text: string, form: string, region: string, x: number, y: number): PanelLegend {
  return {
    id,
    text,
    form,
    region,
    x,
    y,
    source: region.startsWith('section-') || region.startsWith('left/')
      ? SOURCE_SECTION_LAYOUT
      : SOURCE_RIGHT_LAYOUT,
  };
}

const legends: PanelLegend[] = [];
for (let section = 1; section <= 6; section++) {
  const x = sectionX(section);
  const left = x - COLUMN_SPACING;
  const right = x + COLUMN_SPACING;
  const prefix = 'section-' + section + '/';
  const output = prefix + 'binary-output';
  const stripe = prefix + 'power-stripe';
  const storage = prefix + 'storage-processing';
  const aux = prefix + 'auxiliary';
  const secondary = prefix + 'secondary-storage';
  const input = prefix + 'binary-input';
  legends.push(
    legend(prefix + 'number', String(section), 'section-number', output, x, 0.04),
    legend(prefix + 'A', 'A', 'terminal', output, left, 0.11),
    legend(prefix + 'B', 'B', 'terminal', output, right, 0.11),
    legend(prefix + 'plus', '+', 'terminal-above', stripe, left, 0.194),
    legend(prefix + 'minus', '-', 'terminal-above', stripe, right, 0.194),
    legend(prefix + 'light', 'LIGHT', 'group', storage, (left + x) / 2, 0.239),
    legend(prefix + 'coil', 'COIL', 'group', storage, (x + right) / 2, 0.239),
    legend(prefix + 'C', 'C', 'terminal', storage, left, 0.3),
    legend(prefix + 'E', 'E', 'terminal', storage, x, 0.3),
    legend(prefix + 'F', 'F', 'terminal', storage, right, 0.3),
    legend(prefix + 'contact-no', 'N.O.', 'group', storage, left, 0.482),
    legend(prefix + 'contact-arm', 'ARM', 'group', storage, x, 0.482),
    legend(prefix + 'contact-nc', 'N.C.', 'group', storage, right, 0.482),
    legend(prefix + 'G', 'G', 'terminal', storage, left, 0.515),
    legend(prefix + 'H', 'H', 'terminal', storage, x, 0.515),
    legend(prefix + 'J', 'J', 'terminal', storage, right, 0.515),
    legend(prefix + 'K', 'K', 'terminal', storage, left, 0.545),
    legend(prefix + 'L', 'L', 'terminal', storage, x, 0.545),
    legend(prefix + 'N', 'N', 'terminal', storage, right, 0.545),
    legend(prefix + 'common', 'COMMON', 'group', aux, left, 0.558),
    legend(prefix + 'capacitor', 'CAPACITOR', 'group', aux, right, 0.558),
    legend(prefix + 'left-arrow', '←', 'glyph', secondary, left, 0.63),
    legend(prefix + 'switch-arm', 'ARM', 'group', secondary, x, 0.63),
    legend(prefix + 'right-arrow', '→', 'glyph', secondary, right, 0.63),
    legend(prefix + 'R', 'R', 'terminal', secondary, left, 0.685),
    legend(prefix + 'S', 'S', 'terminal', secondary, x, 0.685),
    legend(prefix + 'T', 'T', 'terminal', secondary, right, 0.685),
    legend(prefix + 'U', 'U', 'terminal', secondary, left, 0.735),
    legend(prefix + 'V', 'V', 'terminal', secondary, x, 0.735),
    legend(prefix + 'W', 'W', 'terminal', secondary, right, 0.735),
    legend(prefix + 'input-no', 'N.O.', 'group', input, left, 0.82),
    legend(prefix + 'input-arm', 'ARM', 'group', input, x, 0.82),
    legend(prefix + 'input-nc', 'N.C.', 'group', input, right, 0.82),
    legend(prefix + 'X', 'X', 'terminal', input, left, 0.885),
    legend(prefix + 'Y', 'Y', 'terminal', input, x, 0.885),
    legend(prefix + 'Z', 'Z', 'terminal', input, right, 0.885),
  );
}
legends.push(
  legend('left/binary-output', 'BINARY OUTPUT', 'band-title', 'left/binary-output', 0.3675, 0.158),
  legend('left/storage-processing', 'STORAGE/PROCESSING', 'band-title', 'left/storage-processing', 0.3675, 0.466),
  legend('left/secondary-storage', 'SECONDARY STORAGE', 'band-title', 'left/secondary-storage', 0.3675, 0.615),
  legend('left/binary-input', 'BINARY INPUT', 'band-title', 'left/binary-input', 0.3675, 0.792),
  legend('right/logotype', 'Minivac 601', 'logotype', 'right-power', 0.8545, 0.075),
  legend('right/fine-print', 'Scientific Development Corporation, Cambridge, Massachusetts. Made in U. S. A. Patents applied for.', 'fine-print', 'right-power', 0.8545, 0.145),
  legend('right/plus', '+', 'terminal-above', 'right-power', 0.77, 0.194),
  legend('right/minus', '-', 'terminal-above', 'right-power', 0.82, 0.194),
  legend('right/power-title', 'POWER', 'block-title', 'right-power', 0.947, 0.207),
);
for (const number of [1, 2, 3, 8, 9, 4, 7, 6, 5, 10, 11]) {
  const terminal = PANEL_TERMINALS.find((candidate) => candidate.id === (number <= 9 ? 'M' + number + 't' : 'M' + number));
  if (terminal === undefined) throw new Error('panel layout: missing matrix legend anchor ' + number);
  const y = number <= 9
    ? (terminal.y + (PANEL_TERMINALS.find((candidate) => candidate.id === 'M' + number + 'b')?.y ?? terminal.y)) / 2
    : terminal.y + 0.038;
  legends.push(legend('matrix/' + number, String(number), 'matrix-number', 'matrix', terminal.x, y));
}
legends.push(
  legend('matrix/title', 'MATRIX', 'block-title-left', 'matrix', PH2_HORIZONTAL.rightColumnLeft, 0.458),
  legend('power/breaker', 'CIRCUIT BREAKER', 'two-line', 'power', 0.945, 0.285),
  legend('power/on', 'ON', 'control-label', 'power', 0.945, 0.355),
  legend('power/off', 'OFF', 'control-label', 'power', 0.945, 0.425),
);
for (let index = 0; index < 16; index++) {
  const radians = DECIMAL_ANGLES[index]!.degrees * Math.PI / 180;
  legends.push(legend(
    'decimal/' + index,
    String(index),
    'dial-number',
    'decimal',
    dialCenter.x + Math.sin(radians) * 0.045,
    dialCenter.y - Math.cos(radians) * 0.081,
  ));
}
for (let index = 16; index < 20; index++) {
  const terminal = PANEL_TERMINALS.find((candidate) => candidate.id === 'D' + index);
  if (terminal === undefined) throw new Error('panel layout: missing decimal legend anchor ' + index);
  legends.push(legend('decimal/' + index, String(index), 'terminal-left', 'decimal', terminal.x - 0.018, terminal.y));
}
legends.push(
  legend('decimal/arm', 'ARM', 'group', 'decimal', 0.755, 0.615),
  legend('decimal/run', 'RUN', 'group', 'decimal', 0.755, 0.7125),
  legend('decimal/stop', 'STOP', 'group', 'decimal', 0.755, 0.795),
  legend('decimal/title', 'DECIMAL INPUT-OUTPUT', 'block-title', 'decimal', 0.875, 0.955),
);
export const PANEL_LEGENDS: readonly PanelLegend[] = freezeRecords(legends) as readonly PanelLegend[];

function component(id: string, kind: string, region: string, x: number, y: number): PanelComponent {
  return { id, kind, region, x, y, source: region.startsWith('section-') ? SOURCE_SECTION_LAYOUT : SOURCE_RIGHT_LAYOUT };
}

const components: PanelComponent[] = [];
for (let section = 1; section <= 6; section++) {
  components.push(component('out-lamp-' + section, 'standard-lamp', 'section-' + section + '/binary-output', sectionX(section), 0.085));
}
for (let section = 1; section <= 6; section++) {
  components.push(component('relay-' + section, 'relay', 'section-' + section + '/storage-processing', sectionX(section), 0.342));
}
for (let section = 1; section <= 6; section++) {
  components.push(component('relay-lamp-' + section, 'standard-lamp', 'section-' + section + '/storage-processing', sectionX(section), 0.432));
}
for (let section = 1; section <= 6; section++) {
  components.push(component('slide-' + section, 'slide-switch', 'section-' + section + '/secondary-storage', sectionX(section), 0.746));
}
for (let section = 1; section <= 6; section++) {
  components.push(
    component('slide-rivet-' + section + '-left', 'rivet', 'section-' + section + '/secondary-storage', sectionX(section) - 0.012, 0.746),
    component('slide-rivet-' + section + '-right', 'rivet', 'section-' + section + '/secondary-storage', sectionX(section) + 0.012, 0.746),
  );
}
for (let section = 1; section <= 6; section++) {
  components.push(component('pushbutton-' + section, 'pushbutton', 'section-' + section + '/binary-input', sectionX(section), 0.91));
}
components.push(
  component('power-jewel', 'power-jewel', 'power', 0.945, 0.245),
  component('breaker-button', 'breaker-button', 'power', 0.945, 0.31),
  component('power-rivet-top', 'rivet', 'power', 0.945, 0.34),
  component('power-switch', 'power-switch', 'power', 0.945, 0.385),
  component('power-rivet-bottom', 'rivet', 'power', 0.945, 0.445),
  component('dial-knob', 'dial-knob', 'decimal', dialCenter.x, dialCenter.y),
);
export const PANEL_COMPONENTS: readonly PanelComponent[] = freezeRecords(components) as readonly PanelComponent[];

const controls: PanelControl[] = [];
function control(id: string, kind: string, region: string, section: number | null, x: number, y: number): PanelControl {
  return {
    id,
    kind,
    region,
    section,
    x,
    y,
    source: region.startsWith('section-') ? SOURCE_SECTION_LAYOUT : SOURCE_RIGHT_LAYOUT,
  };
}
for (let section = 1; section <= 6; section++) controls.push(control('relay' + section, 'relay-crossbar', 'section-' + section + '/storage-processing', section, sectionX(section), 0.342));
for (let section = 1; section <= 6; section++) controls.push(control('switch' + section, 'slide-switch', 'section-' + section + '/secondary-storage', section, sectionX(section), 0.746));
for (let section = 1; section <= 6; section++) controls.push(control('button' + section, 'pushbutton', 'section-' + section + '/binary-input', section, sectionX(section), 0.91));
controls.push(
  control('power', 'power-switch', 'power', null, 0.945, 0.385),
  control('breaker', 'breaker-button', 'power', null, 0.945, 0.31),
  control('dial', 'dial', 'decimal', null, dialCenter.x, dialCenter.y),
);
export const PANEL_CONTROLS: readonly PanelControl[] = freezeRecords(controls) as readonly PanelControl[];

function linework(
  id: string,
  kind: PanelLinework['kind'],
  x: number,
  y: number,
  points: readonly PanelPoint[],
  radii?: readonly [number, number],
): PanelLinework {
  const value: PanelLinework = radii === undefined
    ? { id, kind, x, y, points: Object.freeze([...points]), source: SOURCE_RIGHT_LAYOUT }
    : { id, kind, x, y, points: Object.freeze([...points]), radiusX: radii[0], radiusY: radii[1], source: SOURCE_RIGHT_LAYOUT };
  return value;
}

const lines: PanelLinework[] = [];
for (let section = 1; section <= 6; section++) {
  const x = sectionX(section);
  const left = x - COLUMN_SPACING;
  const right = x + COLUMN_SPACING;
  lines.push(
    { ...linework('section-' + section + '/light-bracket', 'bracket', (left + x) / 2, 0.247, [point(left, 0.257), point(left, 0.247), point(x, 0.247), point(x, 0.257)]), source: SOURCE_SECTION_LAYOUT },
    { ...linework('section-' + section + '/coil-bracket', 'bracket', (x + right) / 2, 0.247, [point(x, 0.257), point(x, 0.247), point(right, 0.247), point(right, 0.257)]), source: SOURCE_SECTION_LAYOUT },
    { ...linework('section-' + section + '/left-arrow', 'arrow', left, 0.63, [point(left + 0.012, 0.63), point(left - 0.012, 0.63)]), source: SOURCE_SECTION_LAYOUT },
    { ...linework('section-' + section + '/right-arrow', 'arrow', right, 0.63, [point(right - 0.012, 0.63), point(right + 0.012, 0.63)]), source: SOURCE_SECTION_LAYOUT },
  );
}
lines.push(
  linework('matrix/vertical-1', 'rule', 0.7925, 0.355, [point(0.7925, 0.25), point(0.7925, 0.45)]),
  linework('matrix/vertical-2', 'rule', 0.8375, 0.355, [point(0.8375, 0.25), point(0.8375, 0.45)]),
  linework('matrix/horizontal-1', 'rule', 0.815, 0.32, [point(0.755, 0.32), point(0.875, 0.32)]),
  linework('matrix/horizontal-2', 'rule', 0.815, 0.39, [point(0.755, 0.39), point(0.875, 0.39)]),
);
for (let number = 1; number <= 9; number++) {
  const top = PANEL_TERMINALS.find((terminal) => terminal.id === 'M' + number + 't');
  const bottom = PANEL_TERMINALS.find((terminal) => terminal.id === 'M' + number + 'b');
  if (top === undefined || bottom === undefined) throw new Error('panel layout: missing matrix pair ' + number);
  lines.push(
    linework('matrix/' + number + '-top-bar', 'pair-bar', top.x, top.y, [point(top.x - HOLE_SPACING / 2, top.y), point(top.x + HOLE_SPACING / 2, top.y)]),
    linework('matrix/' + number + '-bottom-bar', 'pair-bar', bottom.x, bottom.y, [point(bottom.x - HOLE_SPACING / 2, bottom.y), point(bottom.x + HOLE_SPACING / 2, bottom.y)]),
  );
}
lines.push(
  linework('matrix/10-loop', 'closed-loop', 0.745, 0.355, [point(0.733, 0.331), point(0.757, 0.331), point(0.757, 0.379), point(0.733, 0.379)]),
  linework('matrix/11-loop', 'closed-loop', 0.885, 0.355, [point(0.873, 0.331), point(0.897, 0.331), point(0.897, 0.379), point(0.873, 0.379)]),
  linework('matrix/power-divider', 'rule', 0.91, 0.3515, [point(0.91, 0.24), point(0.91, 0.463)]),
  linework('decimal/inner-circle', 'circle', dialCenter.x, dialCenter.y, [], [0.032, 0.057]),
  linework('decimal/middle-circle', 'circle', dialCenter.x, dialCenter.y, [], [0.055, 0.099]),
  linework('decimal/outer-circle', 'circle', dialCenter.x, dialCenter.y, [], [0.081, 0.145]),
);
for (const angle of DECIMAL_ANGLES) {
  const radians = angle.degrees * Math.PI / 180;
  lines.push(linework(
    'decimal/sector-' + angle.id.slice(1),
    'radial',
    dialCenter.x,
    dialCenter.y,
    [
      point(dialCenter.x + Math.sin(radians) * 0.058, dialCenter.y - Math.cos(radians) * 0.104),
      point(dialCenter.x + Math.sin(radians) * 0.079, dialCenter.y - Math.cos(radians) * 0.143),
    ],
  ));
}
lines.push(
  linework('decimal/run-bracket', 'bracket', 0.755, 0.7125, [point(0.765, 0.67), point(0.772, 0.7125), point(0.765, 0.755)]),
  linework('decimal/stop-bracket', 'bracket', 0.755, 0.795, [point(0.765, 0.755), point(0.772, 0.795), point(0.765, 0.835)]),
);
export const PANEL_LINEWORK: readonly PanelLinework[] = freezeRecords(lines) as readonly PanelLinework[];

function assertNormalized(id: string, value: number, axis: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('panel layout: ' + id + ' has invalid ' + axis);
  }
}

/** Compare the complete layout identity/order to an already validated caller-owned raw netlist. */
export function validatePanelLayout(netlist: RawNetlistView): void {
  if (netlist.terminals.length !== PANEL_TERMINALS.length) {
    throw new Error('panel layout: expected ' + PANEL_TERMINALS.length + ' terminals, got ' + netlist.terminals.length);
  }
  for (let index = 0; index < PANEL_TERMINALS.length; index++) {
    const expected = PANEL_TERMINALS[index];
    const actual = netlist.terminals[index];
    if (expected === undefined || actual === undefined || actual.id !== expected.id) {
      throw new Error('panel layout: terminal ' + index + ' identity/order mismatch');
    }
    if (actual.holes !== expected.holes.length) {
      throw new Error('panel layout: ' + expected.id + ' holes expected ' + expected.holes.length + ', got ' + actual.holes);
    }
    for (let hole = 0; hole < expected.holes.length; hole++) {
      if (expected.holes[hole]?.id !== actual.id + '#' + (hole + 1)) {
        throw new Error('panel layout: ' + expected.id + ' hole ' + hole + ' identity/order mismatch');
      }
    }
  }

  const owned = PANEL_REGIONS.flatMap((region) => region.terminalIds);
  if (owned.length !== PANEL_TERMINALS.length) throw new Error('panel layout: incomplete region ownership');
  for (let index = 0; index < owned.length; index++) {
    if (owned[index] !== PANEL_TERMINALS[index]?.id) throw new Error('panel layout: region ownership order mismatch at ' + index);
  }

  for (const item of [...PANEL_TERMINALS, ...PANEL_HOLES, ...PANEL_LEGENDS, ...PANEL_COMPONENTS, ...PANEL_CONTROLS, ...PANEL_LINEWORK]) {
    assertNormalized(item.id, item.x, 'x');
    assertNormalized(item.id, item.y, 'y');
  }
  for (const line of PANEL_LINEWORK) {
    for (const linePoint of line.points) {
      assertNormalized(line.id, linePoint.x, 'point.x');
      assertNormalized(line.id, linePoint.y, 'point.y');
    }
    if (line.radiusX !== undefined && (!Number.isFinite(line.radiusX) || line.radiusX <= 0)) {
      throw new Error('panel layout: ' + line.id + ' has invalid radiusX');
    }
    if (line.radiusY !== undefined && (!Number.isFinite(line.radiusY) || line.radiusY <= 0)) {
      throw new Error('panel layout: ' + line.id + ' has invalid radiusY');
    }
  }
}

/** Fit the fixed 1.80:1 console inside a viewport without reflowing its contents. */
export function fitPanel(viewportWidth: number, viewportHeight: number): PanelFrame {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0 || !Number.isFinite(viewportHeight) || viewportHeight <= 0) {
    throw new Error('panel layout: viewport dimensions must be positive finite numbers');
  }
  const width = Math.min(viewportWidth, viewportHeight * PANEL_ASPECT);
  const height = width / PANEL_ASPECT;
  return Object.freeze({
    x: (viewportWidth - width) / 2,
    y: (viewportHeight - height) / 2,
    width,
    height,
  });
}

function roundProjection(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Project a normalized oracle point into a fitted panel frame. */
export function projectPanelPoint(value: PanelPoint, frame: PanelFrame): PanelPoint {
  return Object.freeze({
    x: roundProjection(frame.x + value.x * frame.width),
    y: roundProjection(frame.y + value.y * frame.height),
  });
}

// This keeps accidental edits to the generated tables from silently shipping incomplete art.
if (PANEL_TERMINALS.length !== 186 || PANEL_HOLES.length !== 392) {
  throw new Error('panel layout: generated inventory is not 186 terminals / 392 holes');
}
