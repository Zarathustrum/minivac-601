import { describe, expect, it, vi } from 'vitest';
import type { Event, Sect, State } from '../src/core/contract.ts';
import {
  AUDIO_MUTE_PREFERENCE,
  createAudioRouter,
  motorPlaybackRate,
  safePreferenceStorage,
  type AudioBackend,
  type AudioBackendState,
  type MotorCue,
  type PreferenceStorage,
  type RelayCue,
} from '../src/ui/audio-router.ts';

class FakeButton {
  type = '';
  className = '';
  textContent: string | null = null;
  title = '';
  readonly attributes = new Map<string, string>();
  readonly listeners = new Set<() => void>();

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'click') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'click') this.listeners.delete(listener);
  }

  click(): void {
    for (const listener of this.listeners) listener();
  }
}

class FakeBackend implements AudioBackend {
  backendState: AudioBackendState = 'running';
  nowSeconds = 10;
  readonly relays: RelayCue[] = [];
  readonly motors: MotorCue[] = [];
  readonly calls: string[] = [];
  throwRelay = false;
  readonly throwMotor = new Set<MotorCue['kind']>();
  readonly refuseMotor = new Set<MotorCue['kind']>();
  throwStop = false;
  unlockResult: void | Promise<void> = undefined;

  state(): AudioBackendState {
    return this.backendState;
  }

  now(): number {
    return this.nowSeconds;
  }

  unlock(): void | Promise<void> {
    this.calls.push('unlock');
    return this.unlockResult;
  }

  playRelay(cue: RelayCue): void {
    this.calls.push('relay:' + cue.kind + ':' + cue.relay);
    if (this.throwRelay) {
      this.throwRelay = false;
      throw new Error('relay callback failed');
    }
    this.relays.push(cue);
  }

  stopRelayCues(): void {
    this.calls.push('stop-relays');
  }

  setMotor(cue: MotorCue): boolean {
    this.calls.push('motor:' + cue.kind + ':' + cue.direction);
    if (this.throwMotor.delete(cue.kind)) throw new Error('motor callback failed: ' + cue.kind);
    if (this.refuseMotor.delete(cue.kind)) return false;
    this.motors.push(cue);
    return true;
  }

  stopMotor(): void {
    this.calls.push('stop');
    if (this.throwStop) {
      this.throwStop = false;
      throw new Error('motor stop failed');
    }
  }

  dispose(): void {
    this.calls.push('dispose');
  }
}

class FakeStorage implements PreferenceStorage {
  readonly values = new Map<string, string>();
  readonly writes: [string, string][] = [];

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
    this.writes.push([key, value]);
  }
}

function documentWith(button: FakeButton): Document {
  return {
    createElement(tag: string): FakeButton {
      if (tag !== 'button') throw new Error('unexpected tag ' + tag);
      return button;
    },
  } as unknown as Document;
}

function relay(t: number, kind: 'relay.pullIn' | 'relay.dropOut', n: Sect): Event {
  return { t, k: kind, n, coilUa: 40_000, marginUa: 1_000 };
}

function dial(mrpm: number): Pick<State, 'dial'> {
  return { dial: { udeg: 0, contact: null, mrpm, held: false } };
}

describe('pure audio routing', () => {
  it('falls back to document-local mute storage when persistent storage is unavailable', () => {
    const load = vi.fn((): PreferenceStorage => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const storage = safePreferenceStorage(load);

    expect(load).toHaveBeenCalledOnce();
    expect(storage.getItem(AUDIO_MUTE_PREFERENCE)).toBeNull();
    storage.setItem(AUDIO_MUTE_PREFERENCE, 'true');
    expect(storage.getItem(AUDIO_MUTE_PREFERENCE)).toBe('true');
    expect(load).toHaveBeenCalledOnce();
  });

  it('creates a native accessible control and unlocks only from its click gesture', () => {
    const button = new FakeButton();
    const backend = new FakeBackend();
    backend.backendState = 'locked';
    const storage = new FakeStorage();
    const router = createAudioRouter(documentWith(button), backend, storage);

    expect(router.control).toBe(button);
    expect(button.type).toBe('button');
    expect(button.textContent).toBe('Enable sound');
    expect(button.attributes.get('aria-label')).toBe('Enable sound');
    expect(button.attributes.get('aria-pressed')).toBe('false');
    expect(backend.calls).toEqual([]);

    button.click();
    expect(backend.calls).toEqual(['unlock']);
    expect(storage.writes).toEqual([]);

    backend.backendState = 'running';
    button.click();
    expect(storage.writes).toEqual([[AUDIO_MUTE_PREFERENCE, 'true']]);
    expect(button.textContent).toBe('Sound muted');
    button.click();
    expect(storage.writes).toEqual([
      [AUDIO_MUTE_PREFERENCE, 'true'],
      [AUDIO_MUTE_PREFERENCE, 'false'],
    ]);
    expect(backend.calls.filter((value) => value === 'unlock')).toHaveLength(2);
  });

  it('routes only relay threshold Events once in frozen order with 100us tick spacing', () => {
    const backend = new FakeBackend();
    const router = createAudioRouter(
      documentWith(new FakeButton()),
      backend,
      new FakeStorage(),
    );
    const drainedKinds: string[] = [];
    for (let offset = 0; offset < 500; offset++) {
      const tick = 100 + offset;
      const threshold = relay(
        tick,
        offset % 2 === 0 ? 'relay.pullIn' : 'relay.dropOut',
        (offset % 6 + 1) as Sect,
      );
      const events: readonly Event[] = offset === 0
        ? Object.freeze([threshold, { t: tick, k: 'power.on' }, relay(tick, 'relay.dropOut', 1)])
        : offset === 250
          ? Object.freeze([threshold, { t: tick, k: 'dial.make', pos: 4 }])
          : Object.freeze([threshold]);
      drainedKinds.push(...events.map((event) => event.k));
      router.sample(events);
    }
    expect(backend.relays).toEqual([]);
    router.frame(dial(0));

    expect(backend.relays).toHaveLength(501);
    expect(backend.relays.slice(0, 2).map(({ kind, relay: section }) => [kind, section])).toEqual([
      ['pullIn', 1],
      ['dropOut', 1],
    ]);
    expect(backend.relays.slice(-2).map(({ kind, relay: section }) => [kind, section])).toEqual([
      ['pullIn', 1],
      ['dropOut', 2],
    ]);
    expect(backend.relays[0]?.onsetSeconds).toBe(10);
    expect(backend.relays[1]?.onsetSeconds).toBe(10);
    expect(backend.relays[500]?.onsetSeconds).toBeCloseTo(10.0499, 10);
    expect(drainedKinds.slice(0, 3)).toEqual([
      'relay.pullIn', 'power.on', 'relay.dropOut',
    ]);
    expect(drainedKinds.slice(252, 255)).toEqual([
      'relay.pullIn', 'dial.make', 'relay.dropOut',
    ]);

    backend.nowSeconds = 10.01;
    router.sample([relay(600, 'relay.dropOut', 3)]);
    router.frame(dial(0));
    expect(backend.relays[501]?.onsetSeconds).toBeCloseTo(10.05, 10);
  });

  it('coalesces motor routing to final frame state and updates rate without restarting', () => {
    const backend = new FakeBackend();
    const router = createAudioRouter(documentWith(new FakeButton()), backend, new FakeStorage());

    router.sample([
      { t: 1, k: 'dial.make', pos: 1 },
      { t: 2, k: 'dial.break', pos: 1 },
    ]);
    router.frame(dial(45_000));
    router.frame(dial(90_000));
    router.frame(dial(-22_500));
    router.frame(dial(0));
    router.frame(dial(0));

    expect(backend.relays).toEqual([]);
    expect(backend.motors).toEqual([
      { kind: 'start', direction: 1, rate: 1 },
      { kind: 'rate', direction: 1, rate: 2 },
      { kind: 'direction', direction: -1, rate: 0.5 },
    ]);
    expect(backend.calls.filter((value) => value === 'stop')).toHaveLength(1);
    expect(motorPlaybackRate(1)).toBe(0.5);
    expect(motorPlaybackRate(-45_000)).toBe(1);
    expect(motorPlaybackRate(900_000)).toBe(2);
  });

  it('drops muted, locked, and suspended cues instead of replaying them', () => {
    const backend = new FakeBackend();
    backend.backendState = 'locked';
    const storage = new FakeStorage();
    const button = new FakeButton();
    const router = createAudioRouter(documentWith(button), backend, storage);

    router.sample([relay(1, 'relay.pullIn', 1)]);
    router.frame(dial(45_000));
    backend.backendState = 'running';
    router.frame(dial(0));
    expect(backend.relays).toEqual([]);
    expect(backend.motors).toEqual([]);

    router.sample([relay(2, 'relay.pullIn', 2)]);
    backend.backendState = 'suspended';
    router.frame(dial(45_000));
    backend.backendState = 'running';
    router.frame(dial(0));
    expect(backend.relays).toEqual([]);

    button.click();
    router.sample([relay(3, 'relay.pullIn', 3)]);
    router.frame(dial(45_000));
    button.click();
    router.frame(dial(0));
    expect(backend.relays).toEqual([]);
    expect(backend.motors).toEqual([]);
  });

  it('persists only mute and starts from that preference without persisting unlock', () => {
    const backend = new FakeBackend();
    const storage = new FakeStorage();
    storage.values.set(AUDIO_MUTE_PREFERENCE, 'true');
    storage.values.set('profile', 'must remain untouched');
    const button = new FakeButton();
    const router = createAudioRouter(documentWith(button), backend, storage);

    router.sample([relay(1, 'relay.pullIn', 1)]);
    router.frame(dial(45_000));
    expect(backend.relays).toEqual([]);
    expect(backend.motors).toEqual([]);
    expect(button.textContent).toBe('Sound muted');

    button.click();
    expect(storage.writes).toEqual([[AUDIO_MUTE_PREFERENCE, 'false']]);
    expect([...storage.values.keys()].sort()).toEqual([AUDIO_MUTE_PREFERENCE, 'profile']);
  });

  it('cancels already-scheduled relay cues on mute and session reset', () => {
    const backend = new FakeBackend();
    const button = new FakeButton();
    const router = createAudioRouter(documentWith(button), backend, new FakeStorage());

    router.sample([relay(1, 'relay.pullIn', 1), relay(500, 'relay.dropOut', 2)]);
    router.frame(dial(45_000));
    expect(backend.relays).toHaveLength(2);
    button.click();
    expect(backend.calls.filter((value) => value === 'stop-relays')).toHaveLength(1);

    router.reset();
    expect(backend.calls.filter((value) => value === 'stop-relays')).toHaveLength(2);
    expect(backend.calls.filter((value) => value === 'stop')).toHaveLength(1);
  });

  it('contains backend and error-callback failures and keeps later cues routable', () => {
    const backend = new FakeBackend();
    backend.throwRelay = true;
    const errors: unknown[] = [];
    const router = createAudioRouter(
      documentWith(new FakeButton()),
      backend,
      new FakeStorage(),
      (error) => {
        errors.push(error);
        throw new Error('diagnostic callback failed');
      },
    );

    router.sample([
      relay(1, 'relay.pullIn', 1),
      relay(2, 'relay.dropOut', 2),
    ]);
    expect(() => router.frame(dial(0))).not.toThrow();
    expect(errors).toHaveLength(1);
    expect(backend.relays.map((cue) => cue.relay)).toEqual([2]);
  });

  it('retries failed motor start, rate, direction, and stop operations', () => {
    const backend = new FakeBackend();
    const errors: unknown[] = [];
    const router = createAudioRouter(
      documentWith(new FakeButton()),
      backend,
      new FakeStorage(),
      (error) => errors.push(error),
    );

    backend.throwMotor.add('start');
    router.frame(dial(45_000));
    router.frame(dial(45_000));
    backend.throwMotor.add('rate');
    router.frame(dial(90_000));
    router.frame(dial(90_000));
    backend.throwMotor.add('direction');
    router.frame(dial(-22_500));
    router.frame(dial(-22_500));
    backend.throwStop = true;
    router.frame(dial(0));
    router.frame(dial(0));

    expect(backend.motors).toEqual([
      { kind: 'start', direction: 1, rate: 1 },
      { kind: 'rate', direction: 1, rate: 2 },
      { kind: 'direction', direction: -1, rate: 0.5 },
    ]);
    expect(backend.calls.filter((value) => value === 'motor:start:1')).toHaveLength(2);
    expect(backend.calls.filter((value) => value === 'motor:rate:1')).toHaveLength(2);
    expect(backend.calls.filter((value) => value === 'motor:direction:-1')).toHaveLength(2);
    expect(backend.calls.filter((value) => value === 'stop')).toHaveLength(2);
    expect(errors).toHaveLength(4);
  });

  it('retries a motor cue the backend could not apply', () => {
    const backend = new FakeBackend();
    const router = createAudioRouter(documentWith(new FakeButton()), backend, new FakeStorage());
    backend.refuseMotor.add('start');

    router.frame(dial(45_000));
    router.frame(dial(45_000));

    expect(backend.calls.filter((value) => value === 'motor:start:1')).toHaveLength(2);
    expect(backend.motors).toEqual([{ kind: 'start', direction: 1, rate: 1 }]);
  });

  it('disposes idempotently, dropping buffers, stopping motor, and removing its listener', () => {
    const backend = new FakeBackend();
    const button = new FakeButton();
    const router = createAudioRouter(documentWith(button), backend, new FakeStorage());
    router.frame(dial(45_000));
    router.sample([relay(2, 'relay.dropOut', 2)]);

    router.dispose();
    router.dispose();
    expect(button.listeners.size).toBe(0);
    expect(backend.calls.filter((value) => value === 'dispose')).toHaveLength(1);
    expect(backend.calls.filter((value) => value === 'stop')).toHaveLength(1);

    button.click();
    router.sample([relay(3, 'relay.pullIn', 3)]);
    router.frame(dial(-45_000));
    expect(backend.relays).toEqual([]);
    expect(backend.calls.filter((value) => value === 'unlock')).toHaveLength(0);
  });
});
