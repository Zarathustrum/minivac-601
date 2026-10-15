import { describe, expect, it } from 'vitest';
import {
  LAMP_INTENSITY_PROPERTY,
  applyLampPresentation,
  lampLensIntensity,
  type LampReading,
} from '../src/ui/lamp-presentation.ts';

class FakeClassList {
  readonly values = new Set<string>(['panel-lamp', 'off']);

  add(...values: string[]): void {
    for (const value of values) this.values.add(value);
  }

  remove(...values: string[]): void {
    for (const value of values) this.values.delete(value);
  }
}

class FakeStyle {
  readonly values = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }

  getPropertyValue(name: string): string {
    return this.values.get(name) ?? '';
  }
}

class FakeLamp {
  readonly attributes = new Map<string, string>();
  readonly classList = new FakeClassList();
  readonly dataset: Record<string, string> = {};
  readonly style = new FakeStyle();
  title = '';

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }
}

function element(component = 'out-lamp-1'): FakeLamp {
  const node = new FakeLamp();
  node.dataset.component = component;
  return node;
}

describe('continuous standard-lamp presentation', () => {
  it('pins exact endpoints and representative warm, dim, and on intensities', () => {
    expect(LAMP_INTENSITY_PROPERTY).toBe('--lamp-intensity');
    expect(lampLensIntensity(0)).toBe(0);
    expect(lampLensIntensity(125)).toBe(0.125);
    expect(lampLensIntensity(500)).toBe(0.5);
    expect(lampLensIntensity(900)).toBe(0.9);
    expect(lampLensIntensity(1000)).toBe(1);
  });

  it('is monotone across every valid whole-milli input', () => {
    const values = Array.from({ length: 1001 }, (_, milli) => lampLensIntensity(milli));
    expect(values).toHaveLength(1001);
    for (let milli = 1; milli <= 1000; milli++) {
      expect(values[milli]).toBeGreaterThanOrEqual(values[milli - 1] as number);
    }
  });

  it.each([-1, 1001, 0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid milli value %s',
    (milli) => {
      expect(() => lampLensIntensity(milli)).toThrow(
        'lamp presentation: milli must be an integer from 0 through 1000',
      );
    },
  );

  it.each([
    [{ ua: 41, milli: 125, cls: 'off' }, '0.125', 'off · 41 µA · 125 milli'],
    [{ ua: 12_345, milli: 500, cls: 'dim' }, '0.5', 'dim · 12345 µA · 500 milli'],
    [{ ua: 67_890, milli: 1000, cls: 'on' }, '1', 'on · 67890 µA · 1000 milli'],
  ] as const)('applies exact warm/dim/on DOM state for %o', (reading, intensity, text) => {
    const node = element();
    const before = structuredClone(reading);

    applyLampPresentation(node as unknown as HTMLElement, 'Output lamp 1', reading);

    expect(node.classList.values).toEqual(new Set(['panel-lamp', reading.cls]));
    expect(node.style.values).toEqual(new Map([[LAMP_INTENSITY_PROPERTY, intensity]]));
    expect(node.getAttribute('aria-label')).toBe('Output lamp 1: ' + text);
    expect(node.title).toBe(text);
    expect(reading).toEqual(before);
  });

  it('refuses the POWER jewel without changing its binary presentation', () => {
    const node = element('power-jewel');
    node.classList.values.clear();
    node.classList.values.add('power-jewel');
    node.classList.values.add('is-lit');
    const reading: LampReading = Object.freeze({ ua: 50_000, milli: 1000, cls: 'on' });

    expect(() => applyLampPresentation(
      node as unknown as HTMLElement,
      'Power indicator',
      reading,
    )).toThrow('lamp presentation: POWER jewel does not consume lamp milli');
    expect(node.classList.values).toEqual(new Set(['power-jewel', 'is-lit']));
    expect(node.style.getPropertyValue(LAMP_INTENSITY_PROPERTY)).toBe('');
    expect(node.attributes.size).toBe(0);
    expect(node.title).toBe('');
  });
});
