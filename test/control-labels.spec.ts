import { describe, expect, it } from 'vitest';
import type { PeriodPanelControls } from '../src/ui/panel-view.ts';
import {
  CONTROL_IDENTITIES,
  controlAccessibleName,
  controlBaseName,
  createControlLabelAdapter,
} from '../src/ui/control-labels.ts';

class FakeControl {
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  title = '';
  type = 'button';
  value = 'unchanged';
  min = '0';
  max = '1000';
  disabled = false;
  onclick: (() => void) | null = null;

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }
}

function element(identity: string): FakeControl {
  const value = new FakeControl();
  value.dataset.control = identity;
  value.setAttribute('aria-label', controlBaseName(identity));
  return value;
}

interface Fixture {
  readonly controls: PeriodPanelControls;
  readonly byId: ReadonlyMap<string, FakeControl>;
  readonly breaker: FakeControl;
}

function fixture(): Fixture {
  const byId = new Map<string, FakeControl>(
    CONTROL_IDENTITIES.map((identity) => [identity, element(identity)]),
  );
  const take = (identity: string): FakeControl => {
    const value = byId.get(identity);
    if (value === undefined) throw new Error('test: missing ' + identity);
    return value;
  };
  const breaker = new FakeControl();
  breaker.dataset.control = 'breaker';
  breaker.setAttribute('aria-label', 'Reset circuit breaker');

  return {
    byId,
    breaker,
    controls: {
      power: take('power') as unknown as HTMLButtonElement,
      breaker: breaker as unknown as HTMLButtonElement,
      pushbuttons: ['button6', 'button2', 'button4', 'button1', 'button5', 'button3']
        .map((id) => take(id) as unknown as HTMLButtonElement),
      switches: ['switch3', 'switch6', 'switch1', 'switch5', 'switch2', 'switch4']
        .map((id) => take(id) as unknown as HTMLButtonElement),
      relays: ['relay5', 'relay1', 'relay6', 'relay3', 'relay2', 'relay4']
        .map((id) => take(id) as unknown as HTMLInputElement),
      dial: take('dial') as unknown as HTMLInputElement,
    },
  };
}

function labels(prefix: string): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(CONTROL_IDENTITIES.map((identity) => [identity, prefix + identity])));
}

function behavior(value: FakeControl): object {
  return {
    type: value.type,
    value: value.value,
    min: value.min,
    max: value.max,
    disabled: value.disabled,
    onclick: value.onclick,
  };
}

describe('demo control-label projection', () => {
  it('owns exact deterministic base names for all 20 identities', () => {
    expect(CONTROL_IDENTITIES).toEqual([
      'button1', 'button2', 'button3', 'button4', 'button5', 'button6',
      'switch1', 'switch2', 'switch3', 'switch4', 'switch5', 'switch6',
      'relay1', 'relay2', 'relay3', 'relay4', 'relay5', 'relay6',
      'dial', 'power',
    ]);
    expect(CONTROL_IDENTITIES.map(controlBaseName)).toEqual([
      'Pushbutton 1', 'Pushbutton 2', 'Pushbutton 3', 'Pushbutton 4', 'Pushbutton 5', 'Pushbutton 6',
      'Slide switch 1', 'Slide switch 2', 'Slide switch 3', 'Slide switch 4', 'Slide switch 5', 'Slide switch 6',
      'Relay 1 crossbar', 'Relay 2 crossbar', 'Relay 3 crossbar',
      'Relay 4 crossbar', 'Relay 5 crossbar', 'Relay 6 crossbar',
      'Decimal dial angle', 'Power',
    ]);
    expect(controlAccessibleName('button3', 'Reset')).toBe('Pushbutton 3: Reset');
    expect(controlAccessibleName('dial')).toBe('Decimal dial angle');
    expect(() => controlBaseName('breaker')).toThrow('unknown identity "breaker"');
  });

  it('maps a complete record by explicit identity despite shuffled arrays', () => {
    const setup = fixture();
    const adapter = createControlLabelAdapter(setup.controls);
    adapter.update(labels('Demo '));

    for (const identity of CONTROL_IDENTITIES) {
      const control = setup.byId.get(identity) as FakeControl;
      const base = controlBaseName(identity);
      expect(control.dataset.baseLabel).toBe(base);
      expect(control.dataset.demoLabel).toBe('Demo ' + identity);
      expect(control.getAttribute('aria-label')).toBe(base + ': Demo ' + identity);
      expect(control.title).toBe(base + ': Demo ' + identity);
    }
    expect(setup.breaker.getAttribute('aria-label')).toBe('Reset circuit breaker');
    expect(setup.breaker.dataset.demoLabel).toBeUndefined();
  });

  it('clears every omitted label and rejects unknown keys before mutation', () => {
    const setup = fixture();
    const adapter = createControlLabelAdapter(setup.controls);
    adapter.update(labels('Old '));
    adapter.update({ switch4: 'Answer four' });

    for (const identity of CONTROL_IDENTITIES) {
      const control = setup.byId.get(identity) as FakeControl;
      if (identity === 'switch4') {
        expect(control.dataset.demoLabel).toBe('Answer four');
        expect(control.getAttribute('aria-label')).toBe('Slide switch 4: Answer four');
        expect(control.title).toBe('Slide switch 4: Answer four');
      } else {
        expect(control.dataset.demoLabel).toBeUndefined();
        expect(control.getAttribute('aria-label')).toBe(controlBaseName(identity));
        expect(control.title).toBe('');
      }
    }

    const before = [...setup.byId].map(([id, control]) => [
      id, control.getAttribute('aria-label'), control.title, control.dataset.demoLabel,
    ]);
    expect(() => adapter.update({ button1: 'Changed', bogus: 'No' }))
      .toThrow('unknown label key "bogus"');
    expect([...setup.byId].map(([id, control]) => [
      id, control.getAttribute('aria-label'), control.title, control.dataset.demoLabel,
    ])).toEqual(before);
  });

  it('changes no control behavior and restores original metadata once disposed', () => {
    const setup = fixture();
    const power = setup.byId.get('power') as FakeControl;
    const handler = (): void => undefined;
    power.onclick = handler;
    power.type = 'submit';
    power.value = 'power-value';
    power.disabled = true;
    power.title = 'original title';
    power.dataset.baseLabel = 'original base data';
    power.dataset.demoLabel = 'original demo data';
    power.setAttribute('aria-label', 'original accessible name');
    const before = new Map([...setup.byId].map(([id, control]) => [id, behavior(control)]));

    const adapter = createControlLabelAdapter(setup.controls);
    adapter.update({ power: 'Start' });
    for (const [identity, control] of setup.byId) expect(behavior(control)).toEqual(before.get(identity));

    adapter.dispose();
    adapter.dispose();
    expect(power.getAttribute('aria-label')).toBe('original accessible name');
    expect(power.title).toBe('original title');
    expect(power.dataset.baseLabel).toBe('original base data');
    expect(power.dataset.demoLabel).toBe('original demo data');
    expect(() => adapter.update({ power: 'Ignored after disposal' })).not.toThrow();
    expect(power.getAttribute('aria-label')).toBe('original accessible name');
  });
});
