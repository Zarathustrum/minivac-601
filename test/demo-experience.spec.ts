import { describe, expect, it, vi } from 'vitest';
import rawLibrary from '../data/demo-library.json';
import {
  DEMO_PROFILE_IDS,
  PROFILE_DISCLOSURE,
  createDemoExperience,
  type DemoProfileId,
} from '../src/ui/demo-experience.ts';

class FakeElement extends EventTarget {
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  className = '';
  textContent = '';
  value = '';
  type = '';
  name = '';
  id = '';
  checked = false;
  selectedIndex = 0;
  hidden = false;
  focusCount = 0;

  constructor(readonly tagName: string) {
    super();
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'class') this.className = value;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  focus(): void {
    this.focusCount++;
  }
}

class FakeDocument {
  createElement(tag: string): FakeElement {
    return new FakeElement(tag.toUpperCase());
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

function click(node: FakeElement): void {
  node.dispatchEvent(new Event('click'));
}

function change(node: FakeElement): void {
  node.dispatchEvent(new Event('change'));
}

function fixture() {
  const onDemoSelect = vi.fn();
  const onManual = vi.fn();
  const onReset = vi.fn();
  const onProfileSelect = vi.fn();
  const view = createDemoExperience(fakeDocument(), {
    demos: rawLibrary.demos,
    demoId: rawLibrary.demos[0]!.id,
    profileId: 'MV601-REF-A',
    callbacks: { onDemoSelect, onManual, onReset, onProfileSelect },
  });
  return { view, onDemoSelect, onManual, onReset, onProfileSelect };
}

describe('demo library presentation', () => {
  it('renders all seventeen production records in caller order with every public field', () => {
    const { view } = fixture();
    const root = fake(view.element);
    const panels = byClass(root, 'demo-entry');

    expect(panels.map((panel) => panel.dataset.demo)).toEqual(rawLibrary.demos.map((demo) => demo.id));
    expect([...view.demoPanels.keys()]).toEqual(rawLibrary.demos.map((demo) => demo.id));
    expect(fake(view.demoSelect).children.map((option) => option.dataset.demo))
      .toEqual(rawLibrary.demos.map((demo) => demo.id));

    for (const [index, demo] of rawLibrary.demos.entries()) {
      const panel = panels[index] as FakeElement;
      expect(byClass(panel, 'demo-title').map((node) => node.textContent)).toEqual([demo.title]);
      expect(byClass(panel, 'demo-category').map((node) => node.textContent)).toEqual([demo.category]);
      expect(byClass(panel, 'demo-source-program').map((node) => node.textContent)).toEqual([demo.source.program]);
      expect(byClass(panel, 'demo-source-locator').map((node) => node.textContent)).toEqual([demo.source.locator]);
      expect(byClass(panel, 'demo-source-confidence').map((node) => node.textContent))
        .toEqual([demo.source.confidence]);
      expect(byClass(panel, 'demo-erratum').map((node) => node.textContent)).toEqual(demo.source.errata);
      expect(byClass(panel, 'demo-fallback').map((node) => node.textContent)).toEqual(demo.source.fallbacks);
      expect(byClass(panel, 'demo-instruction').map((node) => node.textContent)).toEqual(demo.instructions);
      expect(byClass(panel, 'demo-control-label').map((node) => [node.dataset.control, node.textContent]))
        .toEqual(Object.entries(demo.controlLabels).map(([control, label]) => [control, control + ': ' + label]));
      expect(byClass(panel, 'demo-notice-paragraph').map((node) => node.textContent))
        .toEqual(demo.notice === undefined ? [] : demo.notice.split('\n\n'));
    }
  });

  it('preserves the adjacent counter comparison and its exact shared D2 notice', () => {
    const { view } = fixture();
    const first = rawLibrary.demos[0]!;
    const second = rawLibrary.demos[1]!;

    expect([first.id, second.id]).toEqual(['IV-EXP1', 'ER-ALTCOUNTER']);
    expect(first.category).toBe('counter');
    expect(second.category).toBe('counter');
    expect(first.notice).toBeDefined();
    expect(second.notice).toBe(first.notice);
    expect(byClass(fake(view.demoPanels.get(first.id)), 'demo-notice-paragraph')
      .map((node) => node.textContent).join('\n\n')).toBe(first.notice);
    expect(byClass(fake(view.demoPanels.get(second.id)), 'demo-notice-paragraph')
      .map((node) => node.textContent).join('\n\n')).toBe(first.notice);
  });

  it('offers accessible selection, reset, exact profile choices and ruled disclosure', () => {
    const { view } = fixture();
    const root = fake(view.element);

    expect(root.getAttribute('aria-label')).toBe('Demo library');
    expect(fake(view.demoSelect).getAttribute('aria-label')).toBe('Select demo');
    expect(fake(view.loadButton).textContent).toBe('Load demo');
    expect(fake(view.loadButton).getAttribute('aria-label')).toBe('Load selected demo');
    expect(fake(view.resetButton).getAttribute('aria-label')).toBe('Reset selected demo');
    expect(fake(view.resetButton).textContent).toBe('Reset');
    expect(fake(view.manualButton).textContent).toBe('Blank panel');
    expect(fake(view.manualButton).getAttribute('aria-label')).toBe('Start with a blank panel for manual wiring');
    expect(fake(view.manualButton).getAttribute('aria-pressed')).toBe('false');
    expect(byClass(root, 'demo-profile-disclosure').map((node) => node.textContent))
      .toEqual([PROFILE_DISCLOSURE]);
    expect(PROFILE_DISCLOSURE).toBe(
      'Both choices are unmeasured simulator profiles. REF-A is the default marginal-behavior profile; IDEAL is the forgiving profile.',
    );
    expect([...view.profileInputs.keys()]).toEqual(DEMO_PROFILE_IDS);
    expect(byClass(root, 'demo-profile-choice').map((node) => node.value)).toEqual(DEMO_PROFILE_IDS);
    expect(byClass(root, 'demo-profile-choice').map((node) => node.getAttribute('aria-label'))).toEqual([
      'REF-A — default marginal-behavior unmeasured simulator profile',
      'IDEAL — forgiving unmeasured simulator profile',
    ]);
    for (const panel of view.demoPanels.values()) {
      expect(fake(panel).getAttribute('aria-labelledby')).toBe('demo-' + fake(panel).dataset.demo + '-title');
    }
  });

  it('dispatches callbacks and updates selection without rebuilding demo panels', () => {
    const { view, onDemoSelect, onManual, onReset, onProfileSelect } = fixture();
    const panels = new Map(view.demoPanels);
    const select = fake(view.demoSelect);

    select.value = 'VI-RANDOM';
    change(select);
    expect(onDemoSelect).toHaveBeenCalledOnce();
    expect(onDemoSelect).toHaveBeenCalledWith('VI-RANDOM');
    expect(select.focusCount).toBe(1);
    expect(select.value).toBe('IV-EXP1');
    expect(fake(view.demoPanels.get('VI-RANDOM')).hidden).toBe(true);
    expect(fake(view.demoPanels.get('IV-EXP1')).hidden).toBe(false);

    click(fake(view.manualButton));
    expect(onManual).toHaveBeenCalledOnce();
    expect(fake(view.manualButton).focusCount).toBe(1);
    expect(fake(view.manualButton).getAttribute('aria-pressed')).toBe('false');

    view.update({ demoId: 'IV-EXP1', profileId: 'MV601-REF-A', manual: true });
    expect(fake(view.manualButton).getAttribute('aria-pressed')).toBe('true');
    expect(select.value).toBe('IV-EXP1');
    expect(fake(view.resetButton).getAttribute('aria-label')).toBe('Reset blank panel');
    expect([...view.demoPanels.values()].every((panel) => fake(panel).hidden)).toBe(true);

    view.update({ demoId: 'VI-RANDOM', profileId: 'MV601-REF-A' });
    expect(select.value).toBe('VI-RANDOM');

    click(fake(view.loadButton));
    expect(onDemoSelect).toHaveBeenCalledTimes(2);
    expect(onDemoSelect).toHaveBeenLastCalledWith('VI-RANDOM');
    expect(fake(view.loadButton).focusCount).toBe(1);

    const ideal = fake(view.profileInputs.get('MV601-IDEAL'));
    ideal.checked = true;
    change(ideal);
    expect(onProfileSelect).toHaveBeenCalledOnce();
    expect(onProfileSelect).toHaveBeenCalledWith('MV601-IDEAL');
    expect(ideal.focusCount).toBe(1);
    expect(fake(view.profileInputs.get('MV601-REF-A')).checked).toBe(true);
    expect(ideal.checked).toBe(false);
    click(fake(view.resetButton));
    expect(onReset).toHaveBeenCalledOnce();
    expect(fake(view.resetButton).focusCount).toBe(1);

    view.update({ demoId: 'V-EXP2', profileId: 'MV601-REF-A', manual: false });
    expect(select.value).toBe('V-EXP2');
    expect(fake(view.resetButton).getAttribute('aria-label')).toBe('Reset selected demo');
    expect(fake(view.profileInputs.get('MV601-REF-A')).checked).toBe(true);
    expect(fake(view.profileInputs.get('MV601-IDEAL')).checked).toBe(false);
    expect([...view.demoPanels.entries()]).toEqual([...panels.entries()]);
    expect(fake(view.demoPanels.get('V-EXP2')).hidden).toBe(false);
    expect(() => view.update({ demoId: 'missing', profileId: 'MV601-REF-A' }))
      .toThrow('demo experience: unknown demo "missing"');
    expect(() => view.update({ demoId: 'V-EXP2', profileId: 'other' as DemoProfileId }))
      .toThrow('demo experience: unknown profile "other"');
  });

  it('honours initial manual selection in the reset label and panel visibility', () => {
    const view = createDemoExperience(fakeDocument(), {
      demos: rawLibrary.demos,
      demoId: rawLibrary.demos[0]!.id,
      profileId: 'MV601-REF-A',
      manual: true,
      callbacks: { onDemoSelect: vi.fn(), onManual: vi.fn(), onReset: vi.fn(), onProfileSelect: vi.fn() },
    });
    expect(fake(view.manualButton).getAttribute('aria-pressed')).toBe('true');
    expect(fake(view.resetButton).getAttribute('aria-label')).toBe('Reset blank panel');
    for (const panel of view.demoPanels.values()) expect(fake(panel).hidden).toBe(true);
  });

  it('disposes listeners idempotently', () => {
    const { view, onDemoSelect, onManual, onReset, onProfileSelect } = fixture();
    view.dispose();
    view.dispose();

    const select = fake(view.demoSelect);
    select.value = 'VI-RANDOM';
    change(select);
    click(fake(view.loadButton));
    click(fake(view.manualButton));
    click(fake(view.resetButton));
    const ideal = fake(view.profileInputs.get('MV601-IDEAL'));
    ideal.checked = true;
    change(ideal);
    expect(onDemoSelect).not.toHaveBeenCalled();
    expect(onManual).not.toHaveBeenCalled();
    expect(onReset).not.toHaveBeenCalled();
    expect(onProfileSelect).not.toHaveBeenCalled();
  });
});
