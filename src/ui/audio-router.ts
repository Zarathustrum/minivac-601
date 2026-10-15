import type { Event, Sect, State } from '../core/contract.ts';

export const AUDIO_MUTE_PREFERENCE = 'minivac.audio.muted';

const TICK_SECONDS = 0.0001;
const MIN_MOTOR_RATE = 0.5;
const MAX_MOTOR_RATE = 2;
const REFERENCE_MRPM = 45_000;

export type AudioBackendState = 'locked' | 'suspended' | 'running';
export type MotorDirection = -1 | 1;

export interface RelayCue {
  readonly kind: 'pullIn' | 'dropOut';
  readonly relay: Sect;
  readonly onsetSeconds: number;
}

export interface MotorCue {
  readonly kind: 'start' | 'direction' | 'rate';
  readonly direction: MotorDirection;
  readonly rate: number;
}

export interface AudioBackend {
  state(): AudioBackendState;
  now(): number;
  unlock(): void | Promise<void>;
  playRelay(cue: RelayCue): void;
  stopRelayCues(): void;
  setMotor(cue: MotorCue): boolean;
  stopMotor(): void;
  dispose(): void;
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Acquire persistent preferences without making storage policy a simulator startup dependency. */
export function safePreferenceStorage(load: () => PreferenceStorage): PreferenceStorage {
  try {
    return load();
  } catch {
    const values = new Map<string, string>();
    return Object.freeze({
      getItem(key: string): string | null {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        values.set(key, value);
      },
    });
  }
}

export interface AudioRouter {
  readonly control: HTMLButtonElement;
  sample(events: readonly Event[]): void;
  frame(state: Pick<State, 'dial'>): void;
  reset(): void;
  dispose(): void;
}

type RelayEvent = Extract<Event, { k: 'relay.pullIn' | 'relay.dropOut' }>;

/** Map absolute dial speed to a conservative bounded sample playback rate. */
export function motorPlaybackRate(mrpm: number): number {
  const rate = Math.abs(mrpm) / REFERENCE_MRPM;
  return Math.min(MAX_MOTOR_RATE, Math.max(MIN_MOTOR_RATE, rate));
}

function directionOf(mrpm: number): MotorDirection | 0 {
  return mrpm < 0 ? -1 : mrpm > 0 ? 1 : 0;
}

function isRelayEvent(event: Event): event is RelayEvent {
  return event.k === 'relay.pullIn' || event.k === 'relay.dropOut';
}

/**
 * Route core events into an injected audio backend without owning clocks, assets, or simulation.
 * Call `sample` for each tick drain and `frame` once with that browser frame's final State.
 */
export function createAudioRouter(
  document: Document,
  backend: AudioBackend,
  storage: PreferenceStorage,
  onError: (error: unknown) => void = () => undefined,
): AudioRouter {
  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'sound-control';

  let disposed = false;
  let muted = false;
  let motorDirection: MotorDirection | 0 = 0;
  let motorRate = 0;
  let lastOnsetSeconds = 0;
  let lastEventTick: number | null = null;
  let pending: RelayEvent[] = [];

  function report(error: unknown): void {
    try {
      onError(error);
    } catch {
      // Audio diagnostics must not interrupt the simulator if their callback fails.
    }
  }

  try {
    muted = storage.getItem(AUDIO_MUTE_PREFERENCE) === 'true';
  } catch (error) {
    report(error);
  }

  function backendState(): AudioBackendState | null {
    try {
      return backend.state();
    } catch (error) {
      report(error);
      return null;
    }
  }

  function audible(): boolean {
    return !disposed && !muted && backendState() === 'running';
  }

  function renderControl(): void {
    if (disposed) return;
    const active = !muted && backendState() === 'running';
    const label = muted ? 'Sound muted' : active ? 'Sound on' : 'Enable sound';
    control.textContent = label;
    control.setAttribute('aria-label', label);
    control.setAttribute('aria-pressed', String(active));
    control.title = label;
  }

  function persistMute(): void {
    try {
      storage.setItem(AUDIO_MUTE_PREFERENCE, String(muted));
    } catch (error) {
      report(error);
    }
  }

  function stopMotor(): void {
    if (motorDirection === 0) return;
    try {
      backend.stopMotor();
      motorDirection = 0;
      motorRate = 0;
    } catch (error) {
      report(error);
    }
  }

  function stopRelayCues(): void {
    try {
      backend.stopRelayCues();
    } catch (error) {
      report(error);
    }
  }

  function resetRouting(): void {
    pending = [];
    lastEventTick = null;
    lastOnsetSeconds = 0;
    stopRelayCues();
    stopMotor();
  }

  function unlock(): void {
    try {
      const result = backend.unlock();
      if (result === undefined) {
        renderControl();
      } else {
        // Assimilate any thenable: `instanceof Promise` misses promises from another realm.
        void Promise.resolve(result).then(renderControl, report);
      }
    } catch (error) {
      report(error);
      renderControl();
    }
  }

  function onControlClick(): void {
    if (disposed) return;
    const state = backendState();
    if (muted) {
      muted = false;
      persistMute();
      unlock();
      renderControl();
      return;
    }
    if (state !== 'running') {
      unlock();
      renderControl();
      return;
    }
    muted = true;
    persistMute();
    resetRouting();
    renderControl();
  }

  control.addEventListener('click', onControlClick);
  renderControl();

  return Object.freeze({
    control,

    sample(events: readonly Event[]): void {
      if (!audible()) return;
      for (const event of events) {
        if (isRelayEvent(event)) pending.push(event);
      }
    },

    frame(state: Pick<State, 'dial'>): void {
      if (disposed) return;
      if (!audible()) {
        resetRouting();
        renderControl();
        return;
      }

      if (pending.length > 0) {
        const firstTick = (pending[0] as RelayEvent).t;
        let priorTick = firstTick;
        let now = lastOnsetSeconds;
        try {
          now = Math.max(now, backend.now());
        } catch (error) {
          report(error);
        }
        if (lastEventTick !== null && firstTick >= lastEventTick) {
          now = Math.max(now, lastOnsetSeconds + (firstTick - lastEventTick) * TICK_SECONDS);
        }
        for (const event of pending) {
          const tick = Math.max(priorTick, event.t);
          const onsetSeconds = Math.max(lastOnsetSeconds, now + (tick - firstTick) * TICK_SECONDS);
          lastOnsetSeconds = onsetSeconds;
          lastEventTick = tick;
          priorTick = tick;
          try {
            backend.playRelay(Object.freeze({
              kind: event.k === 'relay.pullIn' ? 'pullIn' : 'dropOut',
              relay: event.n,
              onsetSeconds,
            }));
          } catch (error) {
            report(error);
          }
        }
        pending = [];
      }

      const direction = directionOf(state.dial.mrpm);
      if (direction === 0) {
        stopMotor();
        return;
      }
      const rate = motorPlaybackRate(state.dial.mrpm);
      if (direction === motorDirection && rate === motorRate) return;
      const cue = Object.freeze({
        kind: motorDirection === 0
          ? 'start' as const
          : direction === motorDirection ? 'rate' as const : 'direction' as const,
        direction,
        rate,
      });
      try {
        if (backend.setMotor(cue)) {
          motorDirection = direction;
          motorRate = rate;
        }
      } catch (error) {
        report(error);
      }
    },

    reset(): void {
      if (disposed) return;
      resetRouting();
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      control.removeEventListener('click', onControlClick);
      resetRouting();
      motorDirection = 0;
      motorRate = 0;
      try {
        backend.dispose();
      } catch (error) {
        report(error);
      }
    },
  });
}
