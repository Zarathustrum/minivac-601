export const LAMP_INTENSITY_PROPERTY = '--lamp-intensity';

export type LampClass = 'off' | 'dim' | 'on';

export interface LampReading {
  readonly ua: number;
  readonly milli: number;
  readonly cls: LampClass;
}

/** Project the core's whole-milli lamp level to a continuous CSS intensity. */
export function lampLensIntensity(milli: number): number {
  if (!Number.isInteger(milli) || milli < 0 || milli > 1000) {
    throw new Error('lamp presentation: milli must be an integer from 0 through 1000');
  }
  return milli / 1000;
}

/** Apply one standard output/relay lamp reading; the binary POWER jewel is separate. */
export function applyLampPresentation(
  node: HTMLElement,
  name: string,
  reading: LampReading,
): void {
  if (node.dataset.component === 'power-jewel') {
    throw new Error('lamp presentation: POWER jewel does not consume lamp milli');
  }

  const intensity = lampLensIntensity(reading.milli);
  const text = reading.cls + ' · ' + reading.ua + ' µA · ' + reading.milli + ' milli';
  node.classList.remove('off', 'dim', 'on');
  node.classList.add(reading.cls);
  node.style.setProperty(LAMP_INTENSITY_PROPERTY, String(intensity));
  node.setAttribute('aria-label', name + ': ' + text);
  node.title = text;
}
