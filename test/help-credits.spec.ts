import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import rawAssets from '../data/public-assets.json';
import {
  HELP_SEEN_PREFERENCE,
  createHelpCredits,
  type HelpPreferenceStorage,
} from '../src/ui/help-credits.ts';

class FakeElement extends EventTarget {
  readonly children: FakeElement[] = [];
  readonly attributes = new Map<string, string>();
  className = '';
  textContent = '';
  hidden = false;
  open = false;
  id = '';
  type = '';
  href = '';
  target = '';
  rel = '';
  focusCount = 0;

  constructor(readonly tagName: string) {
    super();
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  focus(): void {
    this.focusCount++;
  }

  showModal(): void {
    this.open = true;
  }

  close(): void {
    this.open = false;
  }
}

class FakeDocument {
  createElement(tag: string): FakeElement {
    return new FakeElement(tag.toUpperCase());
  }

  createTextNode(text: string): FakeElement {
    const node = new FakeElement('#text');
    node.textContent = text;
    return node;
  }
}

class FakeStorage implements HelpPreferenceStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function fakeDocument(): Document {
  return new FakeDocument() as unknown as Document;
}

function fake(value: unknown): FakeElement {
  return value as FakeElement;
}

function descendants(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(descendants)];
}

function byClass(root: FakeElement, className: string): FakeElement[] {
  return descendants(root).filter((node) => node.className.split(/\s+/u).includes(className));
}

function create(storage: HelpPreferenceStorage = new FakeStorage(), prefix?: string) {
  return createHelpCredits(fakeDocument(), storage, rawAssets.records, prefix);
}

function click(node: FakeElement): void {
  node.dispatchEvent(new Event('click'));
}

function cancel(node: FakeElement): void {
  node.dispatchEvent(new Event('cancel', { cancelable: true }));
}

describe('public help and credits', () => {
  it('opens on first run, persists acknowledgement on close, and remains reopenable', () => {
    const storage = new FakeStorage();
    const view = create(storage);
    const control = fake(view.control);
    const dialog = fake(view.dialog);
    const close = byClass(dialog, 'help-close')[0] as FakeElement;

    expect(view.initiallyOpen).toBe(true);
    expect(dialog.open).toBe(false);
    view.open();
    expect(dialog.open).toBe(true);
    expect(control.getAttribute('aria-expanded')).toBe('true');
    click(close);
    expect(dialog.open).toBe(false);
    expect(control.focusCount).toBe(1);
    expect(storage.values.get(HELP_SEEN_PREFERENCE)).toBe('true');
    click(control);
    expect(dialog.open).toBe(true);
    expect(close.focusCount).toBe(2);
    cancel(dialog);
    expect(dialog.open).toBe(false);
    expect(control.focusCount).toBe(2);
    const returning = create(storage);
    expect(returning.initiallyOpen).toBe(false);
    expect(fake(returning.dialog).open).toBe(false);
  });

  it('covers load, power, operate, wire, and momentary Touch', () => {
    const steps = byClass(fake(create().dialog), 'help-step');
    expect(steps.map((step) => byClass(step, 'help-step-title')[0]?.textContent)).toEqual([
      'Load', 'Power', 'Operate', 'Wire', 'Momentary Touch',
    ]);
    expect(byClass(steps[0] as FakeElement, 'help-step-copy')[0]?.textContent)
      .toContain('Library & diagnostics');
    expect(byClass(steps[1] as FakeElement, 'help-step-copy')[0]?.textContent).toContain('POWER switch');
    expect(byClass(steps[2] as FakeElement, 'help-step-copy')[0]?.textContent).toContain('decimal dial');
    expect(byClass(steps[2] as FakeElement, 'help-step-copy')[0]?.textContent).toContain('Shift-click a pushbutton');
    expect(byClass(steps[3] as FakeElement, 'help-step-copy')[0]?.textContent).toContain('Add free cord');
    expect(byClass(steps[4] as FakeElement, 'help-step-copy')[0]?.textContent)
      .toContain('conducts only while held');
  });

  it('exposes exact source and license links for PH2, PH3, and all shipped cues', () => {
    const dialog = fake(create().dialog);
    const credits = byClass(dialog, 'help-credit');
    const descriptions = byClass(dialog, 'help-credit-description').map((node) => node.textContent);
    const links = byClass(dialog, 'help-credit-link');

    expect(credits).toHaveLength(5);
    expect(byClass(credits[0] as FakeElement, 'help-credit-title')[0]?.textContent)
      .toBe('Primary panel photograph (PH2) — Autopilot. ');
    expect(byClass(credits[1] as FakeElement, 'help-credit-title')[0]?.textContent)
      .toBe('POWER-jewel evidence (PH3) — Mike Rosenberg. ');
    expect(byClass(credits[2] as FakeElement, 'help-credit-title')[0]?.textContent)
      .toBe('Relay simulation cue — bassmosphere. ');
    expect(byClass(credits[3] as FakeElement, 'help-credit-title')[0]?.textContent)
      .toBe('Rotary drive-wheel simulation loop — jwiese. ');
    expect(byClass(credits[4] as FakeElement, 'help-credit-title')[0]?.textContent)
      .toBe('Relay release simulation — bassmosphere. ');
    expect(links.map((link) => link.href)).toEqual([
      'https://commons.wikimedia.org/wiki/File:Minivac_601.jpg',
      'https://creativecommons.org/licenses/by-sa/4.0/',
      'https://commons.wikimedia.org/wiki/File:Minivac_601_DSCF1392.jpg',
      'https://creativecommons.org/licenses/by/2.0/',
      'https://freesound.org/people/bassmosphere/sounds/384698/',
      'https://creativecommons.org/publicdomain/zero/1.0/',
      'https://opengameart.org/content/enginemechanic-working-sound',
      'https://creativecommons.org/publicdomain/zero/1.0/',
      'https://freesound.org/people/bassmosphere/sounds/384698/',
      'https://creativecommons.org/publicdomain/zero/1.0/',
    ]);
    expect(links.every((link) => link.target === '_blank' && link.rel === 'noopener noreferrer')).toBe(true);
    expect(descriptions[0]).toContain('panel-art derivative is licensed CC BY-SA 4.0');
    expect(descriptions[1]).toContain('factory POWER jewel');
    expect(descriptions[2]).toContain('not an authenticated MINIVAC recording');
    expect(descriptions[3]).toContain('not an authenticated MINIVAC recording');
    expect(descriptions[4]).toBe('Both builds include the derivative; the desktop build uses it as a simulated relay drop-out cue. It is not an authenticated MINIVAC recording.');
  });

  it('discloses the public redraw and POWER-jewel model limits', () => {
    const dialog = fake(create().dialog);
    expect(byClass(dialog, 'help-limit-redraw')[0]?.textContent).toBe(
      'The palette and panel geometry are approximate and photograph-derived. The 1.80 ratio, band boundaries, and placement values are unverified proportions, not physical dimensions. Exact RGB values, typeface, coating, substrate, mounting-disc function, and rotary-knob colour and form remain unresolved. The three-dimensional case, knob, control heights, relay bodies, bezels and patch cords are chosen redraw tokens recorded in the project\'s open questions; no dimension of the original is known.',
    );
    expect(byClass(dialog, 'help-limit-power')[0]?.textContent).toBe(
      'The POWER jewel is a binary interface projection: lit when rail voltage is above zero and dark at zero. It is not a modeled lamp-current or intensity result. Lamp glow and every sound other than the relay click are simulated presentation, not evidence about the original; the relay click is the only sound the manuals describe.',
    );
  });

  it('uses labelled controls and mobile-bounded, focus-visible presentation', () => {
    const view = create(new FakeStorage(), 'test-help');
    const control = fake(view.control);
    const dialog = fake(view.dialog);
    const css = readFileSync(new URL('../main.css', import.meta.url), 'utf8');

    expect(control.tagName).toBe('BUTTON');
    expect(control.getAttribute('aria-haspopup')).toBe('dialog');
    expect(control.getAttribute('aria-controls')).toBe('test-help-dialog');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('test-help-title');
    expect(css).toMatch(/\.help-dialog\s*\{[^}]*width: min\(46rem, calc\(100% - 2rem\)\);/su);
    expect(css).toMatch(/\.help-dialog\s*\{[^}]*max-height: calc\(100dvh - 2rem\);/su);
    expect(css).toMatch(/\.help-control:focus-visible,[^{]*\.help-credit-link:focus-visible/su);
  });

  it('fails closed on missing assets, survives denied storage, and disposes idempotently', () => {
    expect(() => createHelpCredits(fakeDocument(), new FakeStorage(), rawAssets.records.slice(1)))
      .toThrow('help credits: missing public asset panel-ph2-primary');
    const storage: HelpPreferenceStorage = {
      getItem(): string | null { throw new Error('denied'); },
      setItem(): void { throw new Error('denied'); },
    };
    const view = create(storage);
    const control = fake(view.control);
    const dialog = fake(view.dialog);
    const close = byClass(dialog, 'help-close')[0] as FakeElement;
    expect(view.initiallyOpen).toBe(true);
    expect(() => click(close)).not.toThrow();
    view.dispose();
    view.dispose();
    click(control);
    cancel(dialog);
    expect(dialog.open).toBe(false);
    expect(control.getAttribute('aria-expanded')).toBe('false');
  });
});
