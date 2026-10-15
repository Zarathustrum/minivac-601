import type { Command, Machine } from './core/contract.ts';

export const DEFAULT_PROFILE_ID = 'MV601-REF-A';

export interface SessionDemo {
  readonly id: string;
  readonly commands: readonly Command[];
}

export interface DemoSessionOptions {
  readonly profileId?: string;
  readonly createMachine: (profileId: string) => Machine;
  readonly mount: (machine: Machine, context: SessionContext) => () => void;
}

export interface SessionContext {
  readonly demoId: string;
  readonly profileId: string;
}

export interface DemoSession {
  loadDemo(demo: SessionDemo): void;
  reset(): void;
  switchProfile(profileId: string): void;
  dispose(): void;
}

/** Owns composition-layer replacement; Machine remains unaware of sessions and presentation. */
export function createDemoSession(options: DemoSessionOptions): DemoSession {
  let profileId = options.profileId ?? DEFAULT_PROFILE_ID;
  let loadedDemo: SessionDemo | null = null;
  let mountedMachine: Machine | null = null;
  let unmount: (() => void) | null = null;
  let disposed = false;

  function requireLive(): void {
    if (disposed) throw new Error('session: disposed');
  }

  function disposeMount(): void {
    const active = unmount;
    unmount = null;
    active?.();
  }

  function replace(demo: SessionDemo, nextProfileId: string): void {
    const machine = options.createMachine(nextProfileId);
    for (let index = 0; index < demo.commands.length; index++) {
      const result = machine.apply(demo.commands[index] as Command);
      if (!result.ok) {
        throw new Error(
          'session: demo ' + demo.id + ' command ' + index + ' rejected: ' + result.why,
        );
      }
    }
    machine.advance(1);
    machine.drainEvents();
    const previousMachine = mountedMachine;
    const previousDemo = loadedDemo;
    const previousProfileId = profileId;
    disposeMount();
    let nextUnmount: () => void;
    try {
      nextUnmount = options.mount(machine, Object.freeze({
        demoId: demo.id,
        profileId: nextProfileId,
      }));
    } catch (error: unknown) {
      if (previousMachine !== null && previousDemo !== null) {
        try {
          unmount = options.mount(previousMachine, Object.freeze({
            demoId: previousDemo.id,
            profileId: previousProfileId,
          }));
        } catch (rollbackError: unknown) {
          // Nothing is mounted now; surface both failures rather than hiding the original.
          mountedMachine = null;
          loadedDemo = null;
          throw new AggregateError([error, rollbackError], 'session: mount and rollback failed');
        }
      }
      throw error;
    }
    unmount = nextUnmount;
    mountedMachine = machine;
    loadedDemo = demo;
    profileId = nextProfileId;
  }

  return {
    loadDemo(demo): void {
      requireLive();
      replace(demo, profileId);
    },

    reset(): void {
      requireLive();
      if (loadedDemo === null) throw new Error('session: no demo loaded');
      replace(loadedDemo, profileId);
    },

    switchProfile(nextProfileId): void {
      requireLive();
      if (loadedDemo === null) throw new Error('session: no demo loaded');
      replace(loadedDemo, nextProfileId);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      disposeMount();
      mountedMachine = null;
    },
  };
}
