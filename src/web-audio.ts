import type {
  AudioBackend,
  AudioBackendState,
  MotorCue,
  RelayCue,
} from './ui/audio-router.ts';

export const RELAY_AUDIO_URL = '/audio/relay-cue.wav';
export const MOTOR_AUDIO_URL = '/audio/rotary-drive-loop.wav';

export interface WebAudioBackendOptions {
  readonly createContext?: () => AudioContext;
  readonly loadBuffer?: (context: AudioContext, url: string) => Promise<AudioBuffer>;
}

async function loadAudioBuffer(context: AudioContext, url: string): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('audio backend: failed to load ' + url + ' (' + response.status + ')');
  return context.decodeAudioData(await response.arrayBuffer());
}

/** Lazy browser-only playback backend. It does not create an AudioContext before a user unlock. */
export function createWebAudioBackend(options: WebAudioBackendOptions = {}): AudioBackend {
  const createContext = options.createContext ?? (() => new AudioContext({ latencyHint: 'interactive' }));
  const loadBuffer = options.loadBuffer ?? loadAudioBuffer;
  let context: AudioContext | null = null;
  let relayBuffer: AudioBuffer | null = null;
  let motorBuffer: AudioBuffer | null = null;
  let motorSource: AudioBufferSourceNode | null = null;
  const relaySources = new Set<AudioBufferSourceNode>();
  let motorDirection: -1 | 1 | 0 = 0;
  let unlockPromise: Promise<void> | null = null;
  let disposed = false;

  function state(): AudioBackendState {
    if (disposed || context === null) return 'locked';
    return context.state === 'running' && relayBuffer !== null && motorBuffer !== null
      ? 'running'
      : 'suspended';
  }

  function stopMotor(): void {
    const source = motorSource;
    if (source === null) return;
    source.stop();
    if (motorSource === source) {
      motorSource = null;
      motorDirection = 0;
    }
  }

  function startMotor(cue: MotorCue): boolean {
    if (context === null || motorBuffer === null || context.state !== 'running') return false;
    const source = context.createBufferSource();
    source.buffer = motorBuffer;
    source.loop = true;
    source.playbackRate.setValueAtTime(cue.rate, context.currentTime);
    source.connect(context.destination);
    source.start(context.currentTime);
    motorSource = source;
    motorDirection = cue.direction;
    return true;
  }

  return Object.freeze({
    state,

    now(): number {
      return context?.currentTime ?? 0;
    },

    unlock(): Promise<void> {
      if (disposed) return Promise.resolve();
      if (state() === 'running') return Promise.resolve();
      if (unlockPromise !== null) return unlockPromise;
      const candidate = context ?? createContext();
      context = candidate;
      unlockPromise = (async () => {
        try {
          await candidate.resume();
          if (relayBuffer !== null && motorBuffer !== null) return;
          const [relay, motor] = await Promise.all([
            loadBuffer(candidate, RELAY_AUDIO_URL),
            loadBuffer(candidate, MOTOR_AUDIO_URL),
          ]);
          if (disposed) return;
          relayBuffer = relay;
          motorBuffer = motor;
        } catch (error) {
          // Disposal closes the context under an in-flight load; that rejection is teardown, not a fault to report.
          if (disposed) return;
          throw error;
        }
      })().finally(() => { unlockPromise = null; });
      return unlockPromise;
    },

    playRelay(cue: RelayCue): void {
      if (context === null || relayBuffer === null || context.state !== 'running' || disposed) return;
      const source = context.createBufferSource();
      source.buffer = relayBuffer;
      source.connect(context.destination);
      relaySources.add(source);
      source.addEventListener('ended', () => relaySources.delete(source), { once: true });
      source.start(Math.max(context.currentTime, cue.onsetSeconds));
    },

    stopRelayCues(): void {
      for (const source of relaySources) {
        try {
          source.stop();
        } catch {
          // A source can finish between iteration and stop; either state is already silent.
        }
      }
      relaySources.clear();
    },

    setMotor(cue: MotorCue): boolean {
      if (disposed || state() !== 'running') return false;
      if (motorSource !== null && motorDirection === cue.direction && cue.kind === 'rate') {
        motorSource.playbackRate.setValueAtTime(cue.rate, context?.currentTime ?? 0);
        return true;
      }
      stopMotor();
      return startMotor(cue);
    },

    stopMotor,

    dispose(): void {
      if (disposed) return;
      disposed = true;
      try {
        stopMotor();
      } catch {
        // Closing the context below is the final stop path when a source rejects stop().
      }
      motorSource = null;
      motorDirection = 0;
      for (const source of relaySources) {
        try {
          source.stop();
        } catch {
          // Already-ended sources need no teardown.
        }
      }
      relaySources.clear();
      relayBuffer = null;
      motorBuffer = null;
      if (context !== null) void context.close().catch(() => undefined);
      context = null;
    },
  });
}
