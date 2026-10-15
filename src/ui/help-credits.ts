export const HELP_SEEN_PREFERENCE = 'minivac.help.seen';

export interface HelpPreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface HelpCreditAsset {
  readonly id: string;
  readonly creator: string;
  readonly sourcePage: string;
  readonly license: string;
  readonly licenseUrl: string;
}

export interface HelpCreditsView {
  readonly control: HTMLButtonElement;
  readonly dialog: HTMLDialogElement;
  readonly initiallyOpen: boolean;
  open(): void;
  close(): void;
  dispose(): void;
}

function asset(records: readonly HelpCreditAsset[], id: string): HelpCreditAsset {
  const record = records.find((candidate) => candidate.id === id);
  if (record === undefined) throw new Error('help credits: missing public asset ' + id);
  return record;
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

function externalLink(document: Document, text: string, href: string): HTMLAnchorElement {
  const link = element(document, 'a', 'help-credit-link', text);
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function licenseName(id: string): string {
  if (id === 'CC-BY-SA-4.0') return 'CC BY-SA 4.0';
  if (id === 'CC-BY-2.0') return 'CC BY 2.0';
  if (id === 'CC0-1.0') return 'CC0 1.0';
  throw new Error('help credits: unsupported license ' + id);
}

function credit(
  document: Document,
  heading: string,
  record: HelpCreditAsset,
  description: string,
): HTMLElement {
  const item = element(document, 'li', 'help-credit');
  const title = element(document, 'strong', 'help-credit-title', heading + ' — ' + record.creator + '. ');
  title.append(
    externalLink(document, heading + ' source', record.sourcePage),
    document.createTextNode(' · '),
    externalLink(document, licenseName(record.license), record.licenseUrl),
  );
  item.append(title, element(document, 'p', 'help-credit-description', description));
  return item;
}

function tutorialStep(document: Document, heading: string, instruction: string): HTMLElement {
  const item = element(document, 'li', 'help-step');
  item.append(
    element(document, 'strong', 'help-step-title', heading),
    element(document, 'p', 'help-step-copy', instruction),
  );
  return item;
}

/** Build the first-run tutorial and public asset credits without owning its placement. */
export function createHelpCredits(
  document: Document,
  storage: HelpPreferenceStorage,
  assets: readonly HelpCreditAsset[],
  idPrefix = 'minivac-help',
): HelpCreditsView {
  const control = element(document, 'button', 'help-control', 'Help & credits');
  control.type = 'button';
  control.setAttribute('aria-haspopup', 'dialog');
  control.setAttribute('aria-controls', idPrefix + '-dialog');

  const title = element(document, 'h1', 'help-title', 'MINIVAC 601 help');
  title.id = idPrefix + '-title';
  const closeButton = element(document, 'button', 'help-close', 'Close help');
  closeButton.type = 'button';

  const heading = element(document, 'header', 'help-dialog-header');
  heading.append(title, closeButton);

  const steps = element(document, 'ol', 'help-steps');
  steps.append(
    tutorialStep(
      document,
      'Load',
      'Open Library & diagnostics, choose a demo, activate Load demo, then use Reset whenever you want its original state.',
    ),
    tutorialStep(
      document,
      'Power',
      'Use the panel POWER switch. If the circuit breaker trips, remove the fault before resetting it.',
    ),
    tutorialStep(
      document,
      'Operate',
      'Use the red pushbuttons, slide switches, relay crossbars, and decimal dial directly on the panel. ' +
        'Shift-click a pushbutton to keep it held down; click it again to let it go.',
    ),
    tutorialStep(
      document,
      'Wire',
      'Choose Add free cord, select end A or B, then choose a jack hole on the panel or in the terminal picker.',
    ),
    tutorialStep(
      document,
      'Momentary Touch',
      'With a free cord end selected, hold its terminal-picker Touch control. It conducts only while held, occupies no hole, and returns the end to free when released.',
    ),
  );

  const tutorial = element(document, 'section', 'help-section');
  tutorial.setAttribute('aria-labelledby', idPrefix + '-tutorial');
  const tutorialTitle = element(document, 'h2', 'help-section-title', 'Five steps');
  tutorialTitle.id = idPrefix + '-tutorial';
  tutorial.append(tutorialTitle, steps);

  const limits = element(document, 'section', 'help-section');
  limits.setAttribute('aria-labelledby', idPrefix + '-limits');
  const limitsTitle = element(document, 'h2', 'help-section-title', 'Redraw and simulation limits');
  limitsTitle.id = idPrefix + '-limits';
  limits.append(
    limitsTitle,
    element(
      document,
      'p',
      'help-limit help-limit-redraw',
      'The palette and panel geometry are approximate and photograph-derived. The 1.80 ratio, band boundaries, and placement values are unverified proportions, not physical dimensions. Exact RGB values, typeface, coating, substrate, mounting-disc function, and rotary-knob colour and form remain unresolved. The three-dimensional case, knob, control heights, relay bodies, bezels and patch cords are chosen redraw tokens recorded in the project\'s open questions; no dimension of the original is known.',
    ),
    element(
      document,
      'p',
      'help-limit help-limit-power',
      'The POWER jewel is a binary interface projection: lit when rail voltage is above zero and dark at zero. It is not a modeled lamp-current or intensity result. Lamp glow and every sound other than the relay click are simulated presentation, not evidence about the original; the relay click is the only sound the manuals describe.',
    ),
  );

  const ph2 = asset(assets, 'panel-ph2-primary');
  const ph3 = asset(assets, 'panel-ph3-corroboration');
  const relay = asset(assets, 'relay-cue');
  const rotary = asset(assets, 'rotary-drive-loop');
  const relayDropOut = asset(assets, 'relay-drop-out-cue');
  const creditsList = element(document, 'ul', 'help-credits-list');
  creditsList.append(
    credit(
      document,
      'Primary panel photograph (PH2)',
      ph2,
      'Primary evidence for panel geometry and visual facts. The procedural HTML/CSS/SVG redraw changes the photograph into measured, fixed-geometry shapes without shipping the raster. It is an adaptation, and the panel-art derivative is licensed CC BY-SA 4.0.',
    ),
    credit(
      document,
      'POWER-jewel evidence (PH3)',
      ph3,
      'Corroboration for the factory POWER jewel and unit-to-unit variation only; its oblique geometry was not measured and the raster is not shipped.',
    ),
    credit(
      document,
      'Relay simulation cue',
      relay,
      'The shipped attenuated derivative is a simulated operation cue, not an authenticated MINIVAC recording.',
    ),
    credit(
      document,
      'Rotary drive-wheel simulation loop',
      rotary,
      'The shipped attenuated, wrap-crossfaded derivative is a simulated motor cue, not an authenticated MINIVAC recording.',
    ),
    credit(
      document,
      'Relay release simulation',
      relayDropOut,
      'Both builds include the derivative; the desktop build uses it as a simulated relay drop-out cue. It is not an authenticated MINIVAC recording.',
    ),
  );

  const credits = element(document, 'section', 'help-section');
  credits.setAttribute('aria-labelledby', idPrefix + '-credits');
  const creditsTitle = element(document, 'h2', 'help-section-title', 'Credits');
  creditsTitle.id = idPrefix + '-credits';
  credits.append(creditsTitle, creditsList);

  const body = element(document, 'div', 'help-dialog-body');
  body.append(tutorial, limits, credits);

  const dialog = element(document, 'dialog', 'help-dialog');
  dialog.id = idPrefix + '-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', title.id);
  dialog.append(heading, body);

  let disposed = false;
  let initiallyOpen = false;
  try {
    initiallyOpen = storage.getItem(HELP_SEEN_PREFERENCE) !== 'true';
  } catch {
    initiallyOpen = true;
  }
  control.setAttribute('aria-expanded', 'false');

  function open(): void {
    if (disposed || dialog.open) return;
    dialog.showModal();
    control.setAttribute('aria-expanded', 'true');
    closeButton.focus();
  }

  function close(): void {
    if (disposed || !dialog.open) return;
    dialog.close();
    control.setAttribute('aria-expanded', 'false');
    try {
      storage.setItem(HELP_SEEN_PREFERENCE, 'true');
    } catch {
      // Help remains usable when preference storage is unavailable.
    }
    control.focus();
  }

  function onDialogCancel(event: Event): void {
    event.preventDefault();
    close();
  }

  function onDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll<HTMLElement>('button, a[href]')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (first === undefined || last === undefined) return;
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    }
  }

  control.addEventListener('click', open);
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', onDialogCancel);
  dialog.addEventListener('keydown', onDialogKeydown);

  return Object.freeze({
    control,
    dialog,
    initiallyOpen,
    open,
    close,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      control.removeEventListener('click', open);
      closeButton.removeEventListener('click', close);
      dialog.removeEventListener('cancel', onDialogCancel);
      dialog.removeEventListener('keydown', onDialogKeydown);
      if (dialog.open) dialog.close();
      control.setAttribute('aria-expanded', 'false');
    },
  });
}
