/**
 * Wave 3's frozen observable, trace-format and chatter contract (architecture §13.4.7).
 *
 * The formatter tests use literal strings rather than a second formatter. Chatter is driven by
 * integer observable vectors, so this spec does not need Machine or the Wave 4 runner.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import refJson from '../data/profiles/MV601-REF-A.json';
import type { Command, State } from '../src/core/contract.ts';
import { loadProfile } from '../src/core/profile.ts';
import type { Profile } from '../src/core/profile.ts';
import { parseHoleId, parseTerminalId } from '../src/core/terminals.ts';
import {
  CHATTER_DEVICES,
  MOVER_OBSERVABLE_START,
  OBSERVABLE_COUNT,
  OBSERVABLES,
  createChatterWorkspace,
  formatAnomaly,
  formatCommand,
  formatMs,
  formatTrace,
  formatTransitions,
  reseedDialChatter,
  resetChatter,
  updateChatter,
  writeObservables,
} from '../src/core/trace.ts';
import type { ObservableSource } from '../src/core/trace.ts';

const profile = loadProfile(refJson);

function compileStateSeam(state: State, into: Int32Array): void {
  writeObservables(state, into);
}
void compileStateSeam;

function source(): ObservableSource {
  return {
    power: false,
    breakerTripped: false,
    relays: Array.from({ length: 6 }, () => ({ set1: { nc: true, no: false } })),
    buttons: Array.from({ length: 6 }, () => ({ nc: true, no: false })),
    switches: Array.from({ length: 6 }, () => ({ set1: [true, false] as const })),
    dial: { contact: 0 },
    outLamps: Array.from({ length: 6 }, () => ({ cls: 'off' as const })),
    indLamps: Array.from({ length: 6 }, () => ({ cls: 'off' as const })),
  };
}

describe('the frozen 33-observable table and overwrite seam', () => {
  it('pins every name, encoding floor and spelling in index order', () => {
    expect(OBSERVABLE_COUNT).toBe(33);
    expect(OBSERVABLES.map((row) => row.name)).toEqual([
      'power', 'breaker',
      'relay1', 'relay2', 'relay3', 'relay4', 'relay5', 'relay6',
      'pb1', 'pb2', 'pb3', 'pb4', 'pb5', 'pb6',
      'sw1', 'sw2', 'sw3', 'sw4', 'sw5', 'sw6',
      'dial',
      'outLamp1', 'outLamp2', 'outLamp3', 'outLamp4', 'outLamp5', 'outLamp6',
      'indLamp1', 'indLamp2', 'indLamp3', 'indLamp4', 'indLamp5', 'indLamp6',
    ]);
    expect(OBSERVABLES.map((row) => row.minValue)).toEqual([
      0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      -1,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
    ]);
    expect(OBSERVABLES[0]?.values).toEqual(['off', 'on']);
    expect(OBSERVABLES[1]?.values).toEqual(['ok', 'tripped']);
    for (let i = 2; i <= 19; i++) expect(OBSERVABLES[i]?.values).toEqual(['nc', 'mid', 'no']);
    expect(OBSERVABLES[20]?.values).toEqual([
      'gap', 'c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7',
      'c8', 'c9', 'c10', 'c11', 'c12', 'c13', 'c14', 'c15',
    ]);
    for (let i = 21; i < 33; i++) expect(OBSERVABLES[i]?.values).toEqual(['off', 'dim', 'on']);
    expect(Object.isFrozen(OBSERVABLES)).toBe(true);
    for (const row of OBSERVABLES) {
      expect(Object.isFrozen(row)).toBe(true);
      expect(Object.isFrozen(row.values)).toBe(true);
    }
  });

  it('encodes all bands and overwrites the same caller-owned buffer', () => {
    const state = source();
    state.power = true;
    state.breakerTripped = true;
    state.relays[0] = { set1: { nc: false, no: false } };
    state.relays[1] = { set1: { nc: false, no: true } };
    state.buttons[0] = { nc: false, no: false };
    state.buttons[1] = { nc: false, no: true };
    state.switches[0] = { set1: [false, false] };
    state.switches[1] = { set1: [false, true] };
    state.dial.contact = null;
    state.outLamps[0] = { cls: 'dim' };
    state.outLamps[1] = { cls: 'on' };
    state.indLamps[0] = { cls: 'dim' };
    state.indLamps[1] = { cls: 'on' };

    const into = new Int32Array(OBSERVABLE_COUNT).fill(99);
    expect(writeObservables(state, into)).toBe(into);
    expect(Array.from(into)).toEqual([
      1, 1,
      1, 2, 0, 0, 0, 0,
      1, 2, 0, 0, 0, 0,
      1, 2, 0, 0, 0, 0,
      -1,
      1, 2, 0, 0, 0, 0,
      1, 2, 0, 0, 0, 0,
    ]);

    into.fill(-99);
    const cold = source();
    cold.dial.contact = 15;
    expect(writeObservables(cold, into)).toBe(into);
    expect(into[20]).toBe(15);
    expect(Array.from(into).includes(-99)).toBe(false);
    expect(() => writeObservables(cold, new Int32Array(32))).toThrow(/33/);
  });
});

describe('the canonical formatter', () => {
  it('formats integer ticks without a floating conversion', () => {
    expect(formatMs(0)).toBe('     0.0');
    expect(formatMs(1)).toBe('     0.1');
    expect(formatMs(10)).toBe('     1.0');
    expect(formatMs(2147483647)).toBe('214748364.7');
    for (const bad of [-1, 0.5, 2147483648, NaN]) expect(() => formatMs(bad)).toThrow(/tick/);
  });

  it('pins all ten command spellings, field order and end variants', () => {
    const hole = parseHoleId('1A#1').id;
    const terminal = parseTerminalId('2com');
    const commands: Command[] = [
      { k: 'power', on: true },
      { k: 'breaker', reset: true },
      { k: 'connect', cord: 7, a: { k: 'hole', hole }, b: { k: 'touch', term: terminal } },
      { k: 'connect', cord: 8, a: { k: 'free' }, b: { k: 'free' }, r_uohm: 22_000_000 },
      { k: 'disconnect', cord: 7 },
      { k: 'button', n: 6, target: 500 },
      { k: 'switch', n: 2, target: 1000 },
      { k: 'relayGrab', n: 1, target: 1000 },
      { k: 'relayRelease', n: 1 },
      { k: 'dialGrab', targetUdeg: 359_999_999 },
      { k: 'dialRelease' },
    ];
    expect(commands.map((command) => formatCommand(567, command))).toEqual([
      '    56.7 > power on',
      '    56.7 > breaker reset',
      '    56.7 > connect cord=7 a=hole:1A#1 b=touch:2com r_uohm=0',
      '    56.7 > connect cord=8 a=free b=free r_uohm=22000000',
      '    56.7 > disconnect cord=7',
      '    56.7 > button6 target=500',
      '    56.7 > switch2 target=1000',
      '    56.7 > relayGrab1 target=1000',
      '    56.7 > relayRelease1',
      '    56.7 > dialGrab targetUdeg=359999999',
      '    56.7 > dialRelease',
    ]);
    expect(formatCommand(0, { k: 'power', on: false })).toBe('     0.0 > power off');
  });

  it('renders one index-ordered transition line covering all 33 value vocabularies', () => {
    const before = new Int32Array(OBSERVABLE_COUNT);
    const after = new Int32Array(OBSERVABLE_COUNT);
    after[0] = 1;
    after[1] = 1;
    for (let i = 2; i <= 19; i++) after[i] = 2;
    after[20] = -1;
    for (let i = 21; i < OBSERVABLE_COUNT; i++) after[i] = 2;
    expect(formatTransitions(65, before, after)).toBe(
      '     6.5 * power off->on  breaker ok->tripped' +
      '  relay1 nc->no  relay2 nc->no  relay3 nc->no  relay4 nc->no  relay5 nc->no  relay6 nc->no' +
      '  pb1 nc->no  pb2 nc->no  pb3 nc->no  pb4 nc->no  pb5 nc->no  pb6 nc->no' +
      '  sw1 nc->no  sw2 nc->no  sw3 nc->no  sw4 nc->no  sw5 nc->no  sw6 nc->no' +
      '  dial c0->gap' +
      '  outLamp1 off->on  outLamp2 off->on  outLamp3 off->on' +
      '  outLamp4 off->on  outLamp5 off->on  outLamp6 off->on' +
      '  indLamp1 off->on  indLamp2 off->on  indLamp3 off->on' +
      '  indLamp4 off->on  indLamp5 off->on  indLamp6 off->on',
    );
    expect(formatTransitions(66, after, after)).toBeNull();
    expect(() => formatTransitions(0, new Int32Array(32), after)).toThrow(/33/);
    const corrupt = after.slice();
    corrupt[20] = 16;
    expect(() => formatTransitions(0, before, corrupt)).toThrow(/dial.*16/);
  });

  it('renders the exact shared anomaly union with unpadded durations', () => {
    expect(formatAnomaly(7, {
      k: 'chatter', dev: 'relay3', transitions: 9, windowTicks: 800, quietTicks: 2400,
    })).toBe('     0.7 ! relay3 chatter 9 transitions in 80.0ms — suppressed 240.0ms');
    expect(formatAnomaly(5000, { k: 'no-settle', waitedTicks: 5000 })).toBe(
      '   500.0 ! no settle in 500.0ms',
    );
    expect(() => formatAnomaly(0, {
      k: 'chatter', dev: 'dial', transitions: 0, windowTicks: 1, quietTicks: 1,
    })).toThrow(/transitions/);
    expect(() => formatAnomaly(0, {
      k: 'chatter', dev: 'dial', transitions: 1, windowTicks: 0, quietTicks: 1,
    })).toThrow(/windowTicks/);
    expect(() => formatAnomaly(0, {
      k: 'chatter', dev: 'dial', transitions: 1, windowTicks: 1, quietTicks: 0,
    })).toThrow(/quietTicks/);
    expect(() => formatAnomaly(0, { k: 'no-settle', waitedTicks: 0 })).toThrow(/waitedTicks/);
  });

  it('preserves supplied action order and emits UTF-8 text with exactly one final LF', () => {
    const lines = [
      formatCommand(0, { k: 'power', on: true }),
      '     0.0 * power off->on',
      '     0.0 ? power=on  "accepted input and assertion may share a numeric tick"',
      formatAnomaly(0, { k: 'no-settle', waitedTicks: 1 }),
    ];
    const trace = formatTrace(lines);
    expect(trace).toBe(lines.join('\n') + '\n');
    expect(trace.endsWith('\n')).toBe(true);
    expect(trace.endsWith('\n\n')).toBe(false);
    const bytes = new TextEncoder().encode(trace);
    expect(Array.from(bytes.slice(0, 3))).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder('utf-8', { fatal: true }).decode(bytes)).toBe(trace);

    for (const bad of ['trailing ', 'trailing\t', 'embedded\nline', 'carriage\rreturn', '\ufeffbom']) {
      expect(() => formatTrace([bad]), bad).toThrow();
    }
    expect(formatTrace([])).toBe('\n');
  });
});

describe('the allocation-free 19-mover chatter monitor', () => {
  it('pins device/order fields and every derived family window', () => {
    expect(MOVER_OBSERVABLE_START).toBe(2);
    expect(CHATTER_DEVICES).toEqual([
      'relay1', 'relay2', 'relay3', 'relay4', 'relay5', 'relay6',
      'pb1', 'pb2', 'pb3', 'pb4', 'pb5', 'pb6',
      'sw1', 'sw2', 'sw3', 'sw4', 'sw5', 'sw6', 'dial',
    ]);
    const chatter = createChatterWorkspace(profile);
    expect(chatter.triggerTransitions).toBe(9);
    expect(Array.from(chatter.windowTicks)).toEqual([
      800, 800, 800, 800, 800, 800,
      2000, 2000, 2000, 2000, 2000, 2000,
      4800, 4800, 4800, 4800, 4800, 4800,
      3332,
    ]);
    expect(Array.from(chatter.quietTicks)).toEqual([
      2400, 2400, 2400, 2400, 2400, 2400,
      6000, 6000, 6000, 6000, 6000, 6000,
      14400, 14400, 14400, 14400, 14400, 14400,
      9996,
    ]);
  });

  for (const [family, device, observable, step] of [
    ['relay', 0, 2, 99],
    ['button', 6, 8, 249],
    ['switch', 12, 14, 599],
    ['dial', 18, 20, 416],
  ] as const) {
    it(`${family}: permits N transitions and triggers exactly once at N+1`, () => {
      const chatter = createChatterWorkspace(profile);
      const values = new Int32Array(OBSERVABLE_COUNT);
      resetChatter(chatter, values);
      for (let transition = 0; transition < 8; transition++) {
        values[observable] = values[observable] === 0 ? 1 : 0;
        expect(updateChatter(transition * step, values, chatter)).toBe(0);
      }
      expect(chatter.count[device]).toBe(8);
      values[observable] = values[observable] === 0 ? 1 : 0;
      expect(updateChatter(8 * step, values, chatter)).toBe(1 << device);
      expect(chatter.count[device]).toBe(9);
      expect(chatter.suppressed[device]).toBe(1);

      values[observable] = values[observable] === 0 ? 1 : 0;
      expect(updateChatter(8 * step + 1, values, chatter)).toBe(0);
      expect(chatter.count[device]).toBe(9);
    });
  }

  it('evicts a transition exactly at t-window before inserting the current transition', () => {
    const chatter = createChatterWorkspace(profile);
    const values = new Int32Array(OBSERVABLE_COUNT);
    resetChatter(chatter, values);
    for (let tick = 0; tick <= 700; tick += 100) {
      values[2] = values[2] === 0 ? 1 : 0;
      expect(updateChatter(tick, values, chatter)).toBe(0);
    }
    expect(chatter.count[0]).toBe(8);
    values[2] = values[2] === 0 ? 1 : 0;
    expect(updateChatter(800, values, chatter)).toBe(0);
    expect(chatter.count[0]).toBe(8);
    values[2] = values[2] === 0 ? 1 : 0;
    expect(updateChatter(801, values, chatter)).toBe(1);
  });

  it('ends suppression at the exact quiet boundary and resumes with empty history', () => {
    const chatter = createChatterWorkspace(profile);
    const values = new Int32Array(OBSERVABLE_COUNT);
    resetChatter(chatter, values);
    for (let transition = 0; transition < 9; transition++) {
      values[2] = values[2] === 0 ? 1 : 0;
      updateChatter(transition * 99, values, chatter);
    }
    const last = 8 * 99;
    expect(chatter.suppressed[0]).toBe(1);
    expect(updateChatter(last + 2399, values, chatter)).toBe(0);
    expect(chatter.suppressed[0]).toBe(1);
    expect(updateChatter(last + 2400, values, chatter)).toBe(0);
    expect(chatter.suppressed[0]).toBe(0);
    expect(chatter.count[0]).toBe(0);

    values[2] = values[2] === 0 ? 1 : 0;
    expect(updateChatter(last + 2401, values, chatter)).toBe(0);
    expect(chatter.count[0]).toBe(1);
  });

  it('reseeds only dial history across an intentional one-tick coast displacement', () => {
    const chatter = createChatterWorkspace(profile);
    const values = new Int32Array(OBSERVABLE_COUNT);
    resetChatter(chatter, values);

    for (let observable = 2; observable < 20; observable++) values[observable] = 1;
    expect(updateChatter(1, values, chatter)).toBe(0);
    for (let transition = 0; transition < 9; transition++) {
      values[20] = values[20] === 0 ? 1 : 0;
      updateChatter(10 + transition, values, chatter);
    }
    expect(Array.from(chatter.count.subarray(0, 18))).toEqual(new Array<number>(18).fill(1));
    expect(chatter.suppressed[18]).toBe(1);

    reseedDialChatter(chatter, values);
    expect(Array.from(chatter.count.subarray(0, 18))).toEqual(new Array<number>(18).fill(1));
    expect(Array.from(chatter.lastTransitionTick.subarray(0, 18)))
      .toEqual(new Array<number>(18).fill(1));
    expect(chatter.count[18]).toBe(0);
    expect(chatter.lastTransitionTick[18]).toBe(-1);
    expect(chatter.lastValue[18]).toBe(values[20]);
    expect(chatter.suppressed[18]).toBe(0);
    expect(chatter.lastUpdateTick).toBe(18);
  });

  it('returns simultaneous trigger bits in observable/device order', () => {
    const chatter = createChatterWorkspace(profile);
    const values = new Int32Array(OBSERVABLE_COUNT);
    const observables = [2, 8, 14, 20] as const;
    resetChatter(chatter, values);
    let mask = 0;
    for (let transition = 0; transition < 9; transition++) {
      for (const observable of observables) values[observable] = values[observable] === 0 ? 1 : 0;
      mask = updateChatter(transition * 99, values, chatter);
    }
    expect(mask).toBe((1 << 0) | (1 << 6) | (1 << 12) | (1 << 18));
    const ordered: string[] = [];
    for (let device = 0; device < CHATTER_DEVICES.length; device++) {
      if ((mask & (1 << device)) !== 0) ordered.push(CHATTER_DEVICES[device] as string);
    }
    expect(ordered).toEqual(['relay1', 'pb1', 'sw1', 'dial']);
  });

  it('resets every primitive field and reuses all storage', () => {
    const chatter = createChatterWorkspace(profile);
    const refs = {
      count: chatter.count,
      last: chatter.lastTransitionTick,
      values: chatter.lastValue,
      suppressed: chatter.suppressed,
      allocated: chatter.allocatedPages,
      heads: chatter._headPages,
      tails: chatter._tailPages,
      free: chatter._freePages,
    };
    const values = new Int32Array(OBSERVABLE_COUNT);
    resetChatter(chatter, values);
    values[2] = 1;
    updateChatter(1, values, chatter);
    resetChatter(chatter, new Int32Array(OBSERVABLE_COUNT).fill(2));
    expect(chatter.count).toBe(refs.count);
    expect(chatter.lastTransitionTick).toBe(refs.last);
    expect(chatter.lastValue).toBe(refs.values);
    expect(chatter.suppressed).toBe(refs.suppressed);
    expect(chatter.allocatedPages).toBe(refs.allocated);
    expect(chatter._headPages).toBe(refs.heads);
    expect(chatter._tailPages).toBe(refs.tails);
    expect(chatter._freePages).toBe(refs.free);
    expect(Array.from(chatter.count)).toEqual(new Array<number>(19).fill(0));
    expect(Array.from(chatter.lastTransitionTick)).toEqual(new Array<number>(19).fill(-1));
    expect(Array.from(chatter.lastValue)).toEqual(new Array<number>(19).fill(2));
    expect(Array.from(chatter.suppressed)).toEqual(new Array<number>(19).fill(0));
  });

  it('constructs at int32 chatter_n without O(N) storage and grows retained pages on demand', () => {
    const huge = {
      ...profile,
      v: { ...profile.v, chatter_n: 2147483646 },
    } as Profile;
    const chatter = createChatterWorkspace(huge);
    expect(chatter.triggerTransitions).toBe(2147483647);
    expect(Array.from(chatter.allocatedPages)).toEqual(new Array<number>(19).fill(0));

    const values = new Int32Array(OBSERVABLE_COUNT);
    resetChatter(chatter, values);
    for (let transition = 0; transition < 65; transition++) {
      values[2] = values[2] === 0 ? 1 : 0;
      expect(updateChatter(0, values, chatter)).toBe(0);
    }
    expect(chatter.count[0]).toBe(65);
    expect(chatter.allocatedPages[0]).toBe(2);
    expect(Array.from(chatter.allocatedPages.subarray(1))).toEqual(new Array<number>(18).fill(0));

    resetChatter(chatter, values);
    for (let transition = 0; transition < 65; transition++) {
      values[2] = values[2] === 0 ? 1 : 0;
      updateChatter(0, values, chatter);
    }
    expect(chatter.allocatedPages[0]).toBe(2);
  });

  it('keeps ordinary update/reset paths free of allocation and module-global mutable scratch', () => {
    const text = readFileSync(new URL('../src/core/trace.ts', import.meta.url), 'utf8');
    const mutableTypedArray = /^(?:const|let|var)\s+\w+\s*=\s*new\s+(?:Int32|Uint8)Array/gm;
    expect(text.match(mutableTypedArray)).toBeNull();
    for (const functionName of ['resetChatter', 'updateChatter']) {
      const start = text.indexOf(`export function ${functionName}`);
      const next = text.indexOf('\nexport function ', start + 1);
      const body = text.slice(start, next < 0 ? text.length : next);
      // Error construction is confined to rejected-input branches; no successful-path storage is
      // constructed here. The behavioral reuse test above proves those branches are not taken.
      expect([...body.matchAll(/\bnew\s+(\w+)/g)].map((match) => match[1]), functionName)
        .toEqual(functionName === 'resetChatter' ? [] : ['Error', 'Error']);
      expect(body, functionName).not.toMatch(/Array\.from|\.slice\(|\.map\(|'cord:'\s*\+/);
    }
  });
});
