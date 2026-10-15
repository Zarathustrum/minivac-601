import type { PeriodPanelControls } from './panel-view.ts';

export const CONTROL_IDENTITIES = Object.freeze([
  'button1', 'button2', 'button3', 'button4', 'button5', 'button6',
  'switch1', 'switch2', 'switch3', 'switch4', 'switch5', 'switch6',
  'relay1', 'relay2', 'relay3', 'relay4', 'relay5', 'relay6',
  'dial', 'power',
] as const);

export type ControlIdentity = typeof CONTROL_IDENTITIES[number];
export type ControlLabels = Readonly<Record<string, string>>;

export interface ControlLabelAdapter {
  update(labels: ControlLabels): void;
  dispose(): void;
}

interface OriginalLabelState {
  readonly ariaLabel: string | null;
  readonly title: string;
  readonly baseLabel: string | undefined;
  readonly demoLabel: string | undefined;
}

const BASE_NAMES: Readonly<Record<ControlIdentity, string>> = Object.freeze({
  button1: 'Pushbutton 1',
  button2: 'Pushbutton 2',
  button3: 'Pushbutton 3',
  button4: 'Pushbutton 4',
  button5: 'Pushbutton 5',
  button6: 'Pushbutton 6',
  switch1: 'Slide switch 1',
  switch2: 'Slide switch 2',
  switch3: 'Slide switch 3',
  switch4: 'Slide switch 4',
  switch5: 'Slide switch 5',
  switch6: 'Slide switch 6',
  relay1: 'Relay 1 crossbar',
  relay2: 'Relay 2 crossbar',
  relay3: 'Relay 3 crossbar',
  relay4: 'Relay 4 crossbar',
  relay5: 'Relay 5 crossbar',
  relay6: 'Relay 6 crossbar',
  dial: 'Decimal dial angle',
  power: 'Power',
});

function isControlIdentity(value: string): value is ControlIdentity {
  return Object.hasOwn(BASE_NAMES, value);
}

/** Return the permanent accessible name for one exact panel-control identity. */
export function controlBaseName(identity: string): string {
  if (!isControlIdentity(identity)) {
    throw new Error('control labels: unknown identity ' + JSON.stringify(identity));
  }
  return BASE_NAMES[identity];
}

/** Compose the stable hardware name with optional demo-specific meaning. */
export function controlAccessibleName(identity: string, demoLabel?: string): string {
  const base = controlBaseName(identity);
  return demoLabel === undefined ? base : base + ': ' + demoLabel;
}

function labelableControls(controls: PeriodPanelControls): readonly HTMLElement[] {
  return Object.freeze([
    controls.power,
    controls.dial,
    ...controls.pushbuttons,
    ...controls.switches,
    ...controls.relays,
  ]);
}

function restoreDataset(element: HTMLElement, key: 'baseLabel' | 'demoLabel', value: string | undefined): void {
  if (value === undefined) delete element.dataset[key];
  else element.dataset[key] = value;
}

/**
 * Apply validated demo labels without touching control state or event behavior.
 *
 * DOM arrays may be in any order: `data-control` is the sole lookup identity.
 */
export function createControlLabelAdapter(controls: PeriodPanelControls): ControlLabelAdapter {
  const elements = new Map<ControlIdentity, HTMLElement>();
  for (const element of labelableControls(controls)) {
    const identity = element.dataset.control;
    if (identity === undefined || !isControlIdentity(identity)) {
      throw new Error('control labels: control has unknown identity ' + JSON.stringify(identity));
    }
    if (elements.has(identity)) throw new Error('control labels: duplicate identity ' + JSON.stringify(identity));
    elements.set(identity, element);
  }
  for (const identity of CONTROL_IDENTITIES) {
    if (!elements.has(identity)) throw new Error('control labels: missing identity ' + JSON.stringify(identity));
  }
  if (elements.size !== CONTROL_IDENTITIES.length) {
    throw new Error('control labels: expected exactly 20 labelable controls');
  }

  const originals = new Map<ControlIdentity, OriginalLabelState>();
  for (const identity of CONTROL_IDENTITIES) {
    const element = elements.get(identity) as HTMLElement;
    originals.set(identity, Object.freeze({
      ariaLabel: element.getAttribute('aria-label'),
      title: element.title,
      baseLabel: element.dataset.baseLabel,
      demoLabel: element.dataset.demoLabel,
    }));
    const base = controlBaseName(identity);
    element.dataset.baseLabel = base;
    element.setAttribute('aria-label', base);
  }

  let disposed = false;

  return Object.freeze({
    update(labels: ControlLabels): void {
      if (disposed) return;

      const supplied = new Map<ControlIdentity, string>();
      for (const key of Object.keys(labels)) {
        if (!isControlIdentity(key)) {
          throw new Error('control labels: unknown label key ' + JSON.stringify(key));
        }
        const label = labels[key];
        if (typeof label !== 'string' || label.length === 0) {
          throw new Error('control labels: label for ' + JSON.stringify(key) + ' must be non-empty');
        }
        supplied.set(key, label);
      }

      for (const identity of CONTROL_IDENTITIES) {
        const element = elements.get(identity) as HTMLElement;
        const label = supplied.get(identity);
        element.dataset.baseLabel = controlBaseName(identity);
        element.setAttribute('aria-label', controlAccessibleName(identity, label));
        if (label === undefined) {
          delete element.dataset.demoLabel;
          element.removeAttribute('title');
          element.title = '';
        } else {
          element.dataset.demoLabel = label;
          element.title = controlAccessibleName(identity, label);
        }
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const identity of CONTROL_IDENTITIES) {
        const element = elements.get(identity) as HTMLElement;
        const original = originals.get(identity) as OriginalLabelState;
        if (original.ariaLabel === null) element.removeAttribute('aria-label');
        else element.setAttribute('aria-label', original.ariaLabel);
        element.title = original.title;
        if (original.title === '') element.removeAttribute('title');
        else element.setAttribute('title', original.title);
        restoreDataset(element, 'baseLabel', original.baseLabel);
        restoreDataset(element, 'demoLabel', original.demoLabel);
      }
    },
  });
}
