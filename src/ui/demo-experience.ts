export const DEMO_PROFILE_IDS = Object.freeze([
  'MV601-REF-A',
  'MV601-IDEAL',
] as const);

export type DemoProfileId = typeof DEMO_PROFILE_IDS[number];

export const PROFILE_DISCLOSURE =
  'Both choices are unmeasured simulator profiles. REF-A is the default marginal-behavior profile; ' +
  'IDEAL is the forgiving profile.';

export interface DemoPresentationSource {
  readonly program: string;
  readonly locator: string;
  readonly confidence: string;
  readonly errata: readonly string[];
  readonly fallbacks: readonly string[];
}

/** Structural presentation boundary; validated demo records may carry additional machine data. */
export interface DemoPresentation {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly source: DemoPresentationSource;
  readonly instructions: readonly string[];
  readonly controlLabels: Readonly<Record<string, string>>;
  readonly notice?: string;
}

export interface DemoExperienceSelection {
  readonly demoId: string;
  readonly profileId: DemoProfileId;
  readonly manual?: boolean;
}

export interface DemoExperienceCallbacks {
  readonly onDemoSelect: (demoId: string) => void;
  readonly onManual: () => void;
  readonly onReset: () => void;
  readonly onProfileSelect: (profileId: DemoProfileId) => void;
}

export interface DemoExperienceOptions extends DemoExperienceSelection {
  readonly demos: readonly DemoPresentation[];
  readonly callbacks: DemoExperienceCallbacks;
}

export interface DemoExperienceView {
  readonly element: HTMLElement;
  readonly demoSelect: HTMLSelectElement;
  readonly loadButton: HTMLButtonElement;
  readonly manualButton: HTMLButtonElement;
  readonly resetButton: HTMLButtonElement;
  readonly profileInputs: ReadonlyMap<DemoProfileId, HTMLInputElement>;
  readonly demoPanels: ReadonlyMap<string, HTMLElement>;
  update(selection: DemoExperienceSelection): void;
  dispose(): void;
}

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function sourceValue(document: Document, className: string, label: string, value: string): HTMLElement {
  const row = element(document, 'div', 'demo-source-row');
  row.append(
    element(document, 'span', 'demo-source-label', label),
    element(document, 'span', className, value),
  );
  return row;
}

function sourceList(
  document: Document,
  className: string,
  label: string,
  values: readonly string[],
): HTMLElement {
  const row = element(document, 'div', 'demo-source-row');
  const list = element(document, 'ul', 'demo-source-list');
  if (values.length === 0) list.append(element(document, 'li', 'demo-source-none', 'None'));
  for (const value of values) list.append(element(document, 'li', className, value));
  row.append(element(document, 'span', 'demo-source-label', label), list);
  return row;
}

function demoPanel(document: Document, demo: DemoPresentation): HTMLElement {
  const panel = element(document, 'article', 'demo-entry');
  panel.dataset.demo = demo.id;
  const title = element(document, 'h2', 'demo-title', demo.title);
  title.id = 'demo-' + demo.id + '-title';
  panel.setAttribute('aria-labelledby', title.id);

  const source = element(document, 'section', 'demo-source');
  source.setAttribute('aria-label', 'Source');
  source.append(
    sourceValue(document, 'demo-source-program', 'Program', demo.source.program),
    sourceValue(document, 'demo-source-locator', 'Locator', demo.source.locator),
    sourceValue(document, 'demo-source-confidence', 'Confidence', demo.source.confidence),
    sourceList(document, 'demo-erratum', 'Errata', demo.source.errata),
    sourceList(document, 'demo-fallback', 'Fallbacks', demo.source.fallbacks),
  );

  const instructions = element(document, 'ol', 'demo-instructions');
  instructions.setAttribute('aria-label', 'Instructions');
  for (const instruction of demo.instructions) {
    instructions.append(element(document, 'li', 'demo-instruction', instruction));
  }

  const controls = element(document, 'ul', 'demo-control-labels');
  controls.setAttribute('aria-label', 'Controls');
  for (const [control, label] of Object.entries(demo.controlLabels)) {
    const item = element(document, 'li', 'demo-control-label', control + ': ' + label);
    item.dataset.control = control;
    controls.append(item);
  }

  panel.append(
    title,
    element(document, 'p', 'demo-category', demo.category),
    source,
    instructions,
    controls,
  );
  if (demo.notice !== undefined) {
    const notice = element(document, 'aside', 'demo-notice');
    for (const paragraph of demo.notice.split('\n\n')) {
      notice.append(element(document, 'p', 'demo-notice-paragraph', paragraph));
    }
    panel.append(notice);
  }
  return panel;
}

function isProfileId(value: string): value is DemoProfileId {
  return value === 'MV601-REF-A' || value === 'MV601-IDEAL';
}

/** Build the demo browser once; update changes only its selected presentation state. */
export function createDemoExperience(
  document: Document,
  options: DemoExperienceOptions,
): DemoExperienceView {
  const demos = new Map<string, DemoPresentation>();
  for (const demo of options.demos) {
    if (demos.has(demo.id)) throw new Error('demo experience: duplicate demo ' + JSON.stringify(demo.id));
    demos.set(demo.id, demo);
  }

  const root = element(document, 'section', 'demo-experience');
  root.setAttribute('aria-label', 'Demo library');
  const toolbar = element(document, 'div', 'demo-toolbar');
  const demoLabel = element(document, 'label', 'demo-selector-label', 'Demo');
  const demoSelect = element(document, 'select', 'demo-selector');
  demoSelect.setAttribute('aria-label', 'Select demo');
  for (const demo of options.demos) {
    const option = element(document, 'option', 'demo-option', demo.title);
    option.value = demo.id;
    option.dataset.demo = demo.id;
    demoSelect.append(option);
  }
  demoLabel.append(demoSelect);

  const loadButton = element(document, 'button', 'demo-load', 'Load demo');
  loadButton.type = 'button';
  loadButton.setAttribute('aria-label', 'Load selected demo');

  const resetButton = element(document, 'button', 'demo-reset', 'Reset');
  resetButton.type = 'button';
  resetButton.setAttribute('aria-label', 'Reset selected demo');
  const manualButton = element(document, 'button', 'demo-manual', 'Blank panel');
  manualButton.type = 'button';
  manualButton.setAttribute('aria-label', 'Start with a blank panel for manual wiring');
  toolbar.append(demoLabel, loadButton, manualButton, resetButton);

  const profiles = element(document, 'fieldset', 'demo-profiles');
  profiles.append(element(document, 'legend', 'demo-profile-title', 'Simulator profile'));
  const profileInputs = new Map<DemoProfileId, HTMLInputElement>();
  const profileLabels: Readonly<Record<DemoProfileId, string>> = Object.freeze({
    'MV601-REF-A': 'REF-A — default marginal-behavior unmeasured simulator profile',
    'MV601-IDEAL': 'IDEAL — forgiving unmeasured simulator profile',
  });
  for (const profileId of DEMO_PROFILE_IDS) {
    const label = element(document, 'label', 'demo-profile-label');
    const input = element(document, 'input', 'demo-profile-choice');
    input.type = 'radio';
    input.name = 'demo-profile';
    input.value = profileId;
    input.setAttribute('aria-label', profileLabels[profileId]);
    label.append(input, element(document, 'span', 'demo-profile-copy', profileLabels[profileId]));
    profiles.append(label);
    profileInputs.set(profileId, input);
  }
  profiles.append(element(document, 'p', 'demo-profile-disclosure', PROFILE_DISCLOSURE));

  const details = element(document, 'div', 'demo-details');
  const demoPanels = new Map<string, HTMLElement>();
  for (const demo of options.demos) {
    const panel = demoPanel(document, demo);
    details.append(panel);
    demoPanels.set(demo.id, panel);
  }
  root.append(toolbar, profiles, details);

  function validate(selection: DemoExperienceSelection): void {
    if (!demos.has(selection.demoId)) {
      throw new Error('demo experience: unknown demo ' + JSON.stringify(selection.demoId));
    }
    if (!isProfileId(selection.profileId)) {
      throw new Error('demo experience: unknown profile ' + JSON.stringify(selection.profileId));
    }
  }

  let currentSelection: DemoExperienceSelection;

  function update(selection: DemoExperienceSelection): void {
    validate(selection);
    currentSelection = Object.freeze({ ...selection });
    demoSelect.value = selection.demoId;
    manualButton.setAttribute('aria-pressed', String(selection.manual === true));
    resetButton.setAttribute(
      'aria-label',
      selection.manual === true ? 'Reset blank panel' : 'Reset selected demo',
    );
    for (const [id, panel] of demoPanels) {
      panel.hidden = selection.manual === true || id !== selection.demoId;
    }
    for (const [id, input] of profileInputs) input.checked = id === selection.profileId;
  }

  const onDemoChange = (): void => {
    const demoId = demoSelect.value;
    if (!demos.has(demoId)) throw new Error('demo experience: unknown demo ' + JSON.stringify(demoId));
    update(currentSelection);
    try {
      options.callbacks.onDemoSelect(demoId);
    } finally {
      demoSelect.focus();
    }
  };
  const onLoad = (): void => {
    const demoId = demoSelect.value;
    if (!demos.has(demoId)) throw new Error('demo experience: unknown demo ' + JSON.stringify(demoId));
    update(currentSelection);
    try {
      options.callbacks.onDemoSelect(demoId);
    } finally {
      loadButton.focus();
    }
  };
  const onReset = (): void => {
    try {
      options.callbacks.onReset();
    } finally {
      resetButton.focus();
    }
  };
  const onManual = (): void => {
    update(currentSelection);
    try {
      options.callbacks.onManual();
    } finally {
      manualButton.focus();
    }
  };
  const profileListeners = new Map<DemoProfileId, () => void>();
  for (const [profileId, input] of profileInputs) {
    const listener = (): void => {
      if (!input.checked) return;
      update(currentSelection);
      try {
        options.callbacks.onProfileSelect(profileId);
      } finally {
        input.focus();
      }
    };
    profileListeners.set(profileId, listener);
    input.addEventListener('change', listener);
  }
  demoSelect.addEventListener('change', onDemoChange);
  loadButton.addEventListener('click', onLoad);
  manualButton.addEventListener('click', onManual);
  resetButton.addEventListener('click', onReset);
  update({ demoId: options.demoId, profileId: options.profileId, manual: options.manual === true });

  let disposed = false;
  return Object.freeze({
    element: root,
    demoSelect,
    loadButton,
    manualButton,
    resetButton,
    profileInputs,
    demoPanels,
    update,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      demoSelect.removeEventListener('change', onDemoChange);
      loadButton.removeEventListener('click', onLoad);
      manualButton.removeEventListener('click', onManual);
      resetButton.removeEventListener('click', onReset);
      for (const [profileId, input] of profileInputs) {
        input.removeEventListener('change', profileListeners.get(profileId) as () => void);
      }
    },
  });
}
