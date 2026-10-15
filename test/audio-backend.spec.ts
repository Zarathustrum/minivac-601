import { describe, expect, it, vi } from 'vitest';
import type { MotorCue, RelayCue } from '../src/ui/audio-router.ts';
import {
  MOTOR_AUDIO_URL,
  RELAY_AUDIO_URL,
  createWebAudioBackend,
} from '../src/web-audio.ts';

class FakeParam {
  readonly values: Array<{ value: number; at: number }> = [];

  setValueAtTime(value: number, at: number): AudioParam {
    this.values.push({ value, at });
    return this as unknown as AudioParam;
  }
}

class FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  readonly playbackRate = new FakeParam();
  readonly starts: number[] = [];
  stops = 0;
  stopFailures = 0;
  connected = false;
  ended: (() => void) | null = null;

  connect(): AudioNode {
    this.connected = true;
    return this as unknown as AudioNode;
  }

  start(when = 0): void {
    this.starts.push(when);
  }

  stop(): void {
    this.stops++;
    if (this.stopFailures > 0) {
      this.stopFailures--;
      throw new Error('stop failed');
    }
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'ended') this.ended = listener;
  }
}

class FakeContext {
  state: AudioContextState = 'suspended';
  currentTime = 12;
  readonly destination = {} as AudioDestinationNode;
  readonly sources: FakeSource[] = [];
  resumeCalls = 0;
  closeCalls = 0;

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  async resume(): Promise<void> {
    this.resumeCalls++;
    this.state = 'running';
  }

  async close(): Promise<void> {
    this.closeCalls++;
    this.state = 'closed';
  }
}

function relay(onsetSeconds = 13): RelayCue {
  return { kind: 'pullIn', relay: 2, onsetSeconds };
}

function motor(kind: MotorCue['kind'], direction: -1 | 1, rate: number): MotorCue {
  return { kind, direction, rate };
}

describe('browser audio backend', () => {
  it('is lazy, loads only the two shipped cues on unlock, and schedules relay onset', async () => {
    const context = new FakeContext();
    const relayBuffer = { id: 'relay' } as unknown as AudioBuffer;
    const motorBuffer = { id: 'motor' } as unknown as AudioBuffer;
    const loadBuffer = vi.fn(async (_context: AudioContext, url: string) =>
      url === RELAY_AUDIO_URL ? relayBuffer : motorBuffer);
    const createContext = vi.fn(() => context as unknown as AudioContext);
    const backend = createWebAudioBackend({ createContext, loadBuffer });

    expect(backend.state()).toBe('locked');
    backend.playRelay(relay());
    expect(createContext).not.toHaveBeenCalled();

    await backend.unlock();
    expect(createContext).toHaveBeenCalledOnce();
    expect(context.resumeCalls).toBe(1);
    expect(loadBuffer.mock.calls.map((call) => call[1])).toEqual([RELAY_AUDIO_URL, MOTOR_AUDIO_URL]);
    expect(backend.state()).toBe('running');
    await backend.unlock();
    expect(context.resumeCalls).toBe(1);
    expect(loadBuffer).toHaveBeenCalledTimes(2);

    backend.playRelay(relay(13.5));
    expect(context.sources).toHaveLength(1);
    expect(context.sources[0]).toMatchObject({
      buffer: relayBuffer,
      loop: false,
      connected: true,
      starts: [13.5],
    });
    backend.stopRelayCues();
    expect(context.sources[0]?.stops).toBe(1);
  });

  it('updates one motor loop for rate, restarts on direction, and stops once', async () => {
    const context = new FakeContext();
    const relayBuffer = {} as AudioBuffer;
    const motorBuffer = {} as AudioBuffer;
    const backend = createWebAudioBackend({
      createContext: () => context as unknown as AudioContext,
      loadBuffer: async (_context, url) => url === RELAY_AUDIO_URL ? relayBuffer : motorBuffer,
    });
    await backend.unlock();

    expect(backend.setMotor(motor('start', 1, 0.5))).toBe(true);
    const first = context.sources[0] as FakeSource;
    expect(first.buffer).toBe(motorBuffer);
    expect(first.loop).toBe(true);
    expect(first.starts).toEqual([12]);
    expect(first.playbackRate.values).toEqual([{ value: 0.5, at: 12 }]);

    expect(backend.setMotor(motor('rate', 1, 1.25))).toBe(true);
    expect(context.sources).toHaveLength(1);
    expect(first.playbackRate.values.at(-1)).toEqual({ value: 1.25, at: 12 });

    expect(backend.setMotor(motor('direction', -1, 0.75))).toBe(true);
    expect(first.stops).toBe(1);
    expect(context.sources).toHaveLength(2);
    const second = context.sources[1] as FakeSource;
    expect(second.playbackRate.values).toEqual([{ value: 0.75, at: 12 }]);

    backend.stopMotor();
    backend.stopMotor();
    expect(second.stops).toBe(1);
  });

  it('retains a motor source for retry when stopping it fails', async () => {
    const context = new FakeContext();
    const backend = createWebAudioBackend({
      createContext: () => context as unknown as AudioContext,
      loadBuffer: async () => ({} as AudioBuffer),
    });
    await backend.unlock();
    backend.setMotor(motor('start', 1, 1));
    const source = context.sources[0] as FakeSource;
    source.stopFailures = 1;

    expect(() => backend.stopMotor()).toThrow('stop failed');
    expect(() => backend.stopMotor()).not.toThrow();
    backend.stopMotor();
    expect(source.stops).toBe(2);
  });

  it('reports a suspended-context refusal so the router can retry', async () => {
    const context = new FakeContext();
    const backend = createWebAudioBackend({
      createContext: () => context as unknown as AudioContext,
      loadBuffer: async () => ({} as AudioBuffer),
    });
    await backend.unlock();
    context.state = 'suspended';

    expect(backend.setMotor(motor('start', 1, 1))).toBe(false);
    expect(context.sources).toHaveLength(0);
    context.state = 'running';
    expect(backend.setMotor(motor('start', 1, 1))).toBe(true);
    expect(context.sources).toHaveLength(1);
  });

  it('shares one unlock, contains unavailable playback, and disposes once', async () => {
    const context = new FakeContext();
    let releaseLoad: (() => void) | undefined;
    const pendingLoad = new Promise<void>((resolve) => { releaseLoad = resolve; });
    const loadBuffer = vi.fn(async () => {
      await pendingLoad;
      return {} as AudioBuffer;
    });
    const backend = createWebAudioBackend({
      createContext: () => context as unknown as AudioContext,
      loadBuffer,
    });

    const first = backend.unlock();
    const second = backend.unlock();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadBuffer).toHaveBeenCalledTimes(2);
    releaseLoad?.();
    await Promise.all([first, second]);
    expect(context.resumeCalls).toBe(1);

    backend.dispose();
    backend.dispose();
    backend.playRelay(relay());
    backend.setMotor(motor('start', 1, 1));
    await backend.unlock();
    expect(context.closeCalls).toBe(1);
    expect(context.sources).toHaveLength(0);
    expect(backend.state()).toBe('locked');
  });

  it('finishes relay and context teardown when motor stop fails during disposal', async () => {
    const context = new FakeContext();
    const backend = createWebAudioBackend({
      createContext: () => context as unknown as AudioContext,
      loadBuffer: async () => ({} as AudioBuffer),
    });
    await backend.unlock();
    backend.setMotor(motor('start', 1, 1));
    backend.playRelay(relay());
    const motorSource = context.sources[0] as FakeSource;
    const relaySource = context.sources[1] as FakeSource;
    motorSource.stopFailures = 1;

    expect(() => backend.dispose()).not.toThrow();
    backend.dispose();
    expect(motorSource.stops).toBe(1);
    expect(relaySource.stops).toBe(1);
    expect(context.closeCalls).toBe(1);
    expect(backend.state()).toBe('locked');
  });
});
