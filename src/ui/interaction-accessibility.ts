export interface KeyboardHoldOptions {
  readonly keys: readonly string[];
  readonly preventDefault: boolean;
  readonly onPress: () => void;
  readonly onRelease: () => void;
  /** Called instead of a hold when a bound key arrives with Shift held. */
  readonly onShiftToggle?: () => void;
}

/** Bind keyboard keys to a physical control that remains held until release or cancellation. */
export function bindKeyboardHold(
  control: HTMLElement,
  options: KeyboardHoldOptions,
): () => void {
  const keys = new Set(options.keys);
  const active = new Set<string>();

  function release(): void {
    if (active.size === 0) return;
    active.clear();
    options.onRelease();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (active.size === 0) return;
      event.preventDefault();
      release();
      return;
    }
    if (!keys.has(event.key)) return;
    if (options.preventDefault) event.preventDefault();
    if (event.shiftKey && options.onShiftToggle !== undefined) {
      if (!event.repeat) options.onShiftToggle();
      return;
    }
    if (event.repeat || active.has(event.key)) return;
    const wasReleased = active.size === 0;
    active.add(event.key);
    if (wasReleased) options.onPress();
  }

  function onKeyUp(event: KeyboardEvent): void {
    if (!active.delete(event.key)) return;
    if (options.preventDefault) event.preventDefault();
    if (active.size === 0) options.onRelease();
  }

  control.addEventListener('keydown', onKeyDown);
  control.addEventListener('keyup', onKeyUp);
  control.addEventListener('blur', release);
  return (): void => {
    release();
    control.removeEventListener('keydown', onKeyDown);
    control.removeEventListener('keyup', onKeyUp);
    control.removeEventListener('blur', release);
  };
}

export interface DrawerController {
  readonly open: (focusTarget?: boolean) => void;
  readonly close: (restoreFocus?: boolean) => void;
  readonly dispose: () => void;
}

/** Keep the drawer disclosure state and focus round-trip on explicit open/close paths. */
export function createDrawerController(
  toggle: HTMLButtonElement,
  drawer: HTMLElement,
  closeButton: HTMLButtonElement,
): DrawerController {
  if (drawer.id.length === 0) throw new Error('drawer controller: drawer needs an id');
  toggle.setAttribute('aria-controls', drawer.id);
  toggle.setAttribute('aria-expanded', String(!drawer.hidden));

  function open(focusTarget = true): void {
    drawer.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    if (focusTarget) closeButton.focus();
  }

  function close(restoreFocus = true): void {
    drawer.hidden = true;
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }

  function onToggle(): void {
    if (drawer.hidden) open();
    else close(false);
  }

  function onClose(): void {
    close();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || drawer.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  toggle.addEventListener('click', onToggle);
  closeButton.addEventListener('click', onClose);
  drawer.addEventListener('keydown', onKeyDown);

  return Object.freeze({
    open,
    close,
    dispose(): void {
      toggle.removeEventListener('click', onToggle);
      closeButton.removeEventListener('click', onClose);
      drawer.removeEventListener('keydown', onKeyDown);
    },
  });
}
