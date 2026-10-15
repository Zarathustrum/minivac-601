import { describe, expect, it, vi } from 'vitest';
import {
  bindKeyboardHold,
  createDrawerController,
} from '../src/ui/interaction-accessibility.ts';

class FakeElement extends EventTarget {
  readonly attributes = new Map<string, string>();
  hidden = false;
  id = '';
  focusCount = 0;

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  focus(): void {
    this.focusCount++;
  }
}

function keyboard(type: 'keydown' | 'keyup', key: string, repeat = false): KeyboardEvent {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(event, {
    key: { value: key },
    repeat: { value: repeat },
  });
  return event as KeyboardEvent;
}

function fake(value: FakeElement): HTMLElement {
  return value as unknown as HTMLElement;
}

describe('held-control keyboard access', () => {
  it('holds a momentary control across repeats and releases on the matching keyup', () => {
    const control = new FakeElement();
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const dispose = bindKeyboardHold(fake(control), {
      keys: [' ', 'Enter'],
      preventDefault: true,
      onPress,
      onRelease,
    });

    const down = keyboard('keydown', ' ');
    control.dispatchEvent(down);
    control.dispatchEvent(keyboard('keydown', ' ', true));
    control.dispatchEvent(keyboard('keyup', 'Enter'));
    expect(down.defaultPrevented).toBe(true);
    expect(onPress).toHaveBeenCalledOnce();
    expect(onRelease).not.toHaveBeenCalled();

    const up = keyboard('keyup', ' ');
    control.dispatchEvent(up);
    expect(up.defaultPrevented).toBe(true);
    expect(onRelease).toHaveBeenCalledOnce();
    dispose();
  });

  it('routes a Shift-modified hold key to onShiftToggle without starting a hold', () => {
    const control = new FakeElement();
    const onPress = vi.fn();
    const onRelease = vi.fn();
    const onShiftToggle = vi.fn();
    const dispose = bindKeyboardHold(fake(control), {
      keys: [' ', 'Enter'],
      preventDefault: true,
      onPress,
      onRelease,
      onShiftToggle,
    });
    const shifted = (type: 'keydown' | 'keyup', key: string, repeat = false): KeyboardEvent =>
      Object.defineProperty(keyboard(type, key, repeat), 'shiftKey', { value: true });

    const down = shifted('keydown', ' ');
    control.dispatchEvent(down);
    control.dispatchEvent(shifted('keydown', ' ', true));
    control.dispatchEvent(shifted('keyup', ' '));
    control.dispatchEvent(shifted('keydown', 'Enter'));
    control.dispatchEvent(new Event('blur'));
    expect(down.defaultPrevented).toBe(true);
    expect(onShiftToggle).toHaveBeenCalledTimes(2);
    expect(onPress).not.toHaveBeenCalled();
    expect(onRelease).not.toHaveBeenCalled();
    dispose();
    expect(onRelease).not.toHaveBeenCalled();
  });

  it('releases held controls once on Escape, blur, or disposal', () => {
    const control = new FakeElement();
    const onRelease = vi.fn();
    const dispose = bindKeyboardHold(fake(control), {
      keys: ['ArrowLeft', 'ArrowRight'],
      preventDefault: false,
      onPress: vi.fn(),
      onRelease,
    });

    control.dispatchEvent(keyboard('keydown', 'ArrowLeft'));
    const escape = keyboard('keydown', 'Escape');
    control.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(onRelease).toHaveBeenCalledTimes(1);

    control.dispatchEvent(keyboard('keydown', 'ArrowRight'));
    control.dispatchEvent(new Event('blur'));
    expect(onRelease).toHaveBeenCalledTimes(2);
    control.dispatchEvent(keyboard('keydown', 'ArrowLeft'));
    dispose();
    expect(onRelease).toHaveBeenCalledTimes(3);
    control.dispatchEvent(keyboard('keyup', 'ArrowLeft'));
    expect(onRelease).toHaveBeenCalledTimes(3);
  });

  it('leaves native range-key defaults available while tracking a multi-key hold', () => {
    const control = new FakeElement();
    const onPress = vi.fn();
    const onRelease = vi.fn();
    bindKeyboardHold(fake(control), {
      keys: ['ArrowLeft', 'ArrowRight'],
      preventDefault: false,
      onPress,
      onRelease,
    });

    const left = keyboard('keydown', 'ArrowLeft');
    control.dispatchEvent(left);
    control.dispatchEvent(keyboard('keydown', 'ArrowRight'));
    control.dispatchEvent(keyboard('keyup', 'ArrowLeft'));
    expect(left.defaultPrevented).toBe(false);
    expect(onPress).toHaveBeenCalledOnce();
    expect(onRelease).not.toHaveBeenCalled();
    control.dispatchEvent(keyboard('keyup', 'ArrowRight'));
    expect(onRelease).toHaveBeenCalledOnce();
  });
});

describe('diagnostics drawer access', () => {
  it('owns the disclosure relationship and round-trips focus on open, Close, and Escape', () => {
    const toggle = new FakeElement();
    const drawer = new FakeElement();
    const close = new FakeElement();
    drawer.id = 'diagnostics-drawer';
    const controller = createDrawerController(
      toggle as unknown as HTMLButtonElement,
      fake(drawer),
      close as unknown as HTMLButtonElement,
    );

    expect(toggle.getAttribute('aria-controls')).toBe('diagnostics-drawer');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.dispatchEvent(new Event('click'));
    expect(drawer.hidden).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.dispatchEvent(new Event('click'));
    expect(drawer.hidden).toBe(false);
    expect(close.focusCount).toBe(1);

    close.dispatchEvent(new Event('click'));
    expect(drawer.hidden).toBe(true);
    expect(toggle.focusCount).toBe(1);
    controller.open(false);
    expect(close.focusCount).toBe(1);
    const escape = keyboard('keydown', 'Escape');
    drawer.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(drawer.hidden).toBe(true);
    expect(toggle.focusCount).toBe(2);

    controller.dispose();
    toggle.dispatchEvent(new Event('click'));
    expect(drawer.hidden).toBe(true);
  });

  it('rejects an unnamed drawer instead of emitting a broken aria-controls target', () => {
    expect(() => createDrawerController(
      new FakeElement() as unknown as HTMLButtonElement,
      fake(new FakeElement()),
      new FakeElement() as unknown as HTMLButtonElement,
    )).toThrow('drawer needs an id');
  });
});
