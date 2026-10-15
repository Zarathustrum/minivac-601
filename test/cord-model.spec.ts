import { describe, expect, it, vi } from 'vitest';
import type { CmdResult, CordEnd, HoleId, TerminalId } from '../src/core/contract.ts';
import {
  addFreeCord,
  beginCordDrag,
  beginMomentaryTouch,
  cancelCordDrag,
  createCordController,
  endMomentaryTouch,
  endpointKey,
  freeTraySlots,
  isHoleOccupied,
  orderedEndpoints,
  previewCordDrag,
  removeCord,
  replaceCordEndpoint,
  resolveCordDrop,
  type ApplyCommand,
  type CordRecord,
} from '../src/ui/cord-model.ts';

const free = (): CordEnd => ({ k: 'free' });
const hole = (value: string): CordEnd => ({ k: 'hole', hole: value as HoleId });

function cord(id: number, a: CordEnd, b: CordEnd, r_uohm = 0): CordRecord {
  return { id, a, b, r_uohm };
}

function scripted(...results: CmdResult[]): { readonly apply: ApplyCommand; readonly commands: unknown[] } {
  const commands: unknown[] = [];
  const apply = vi.fn((command) => {
    commands.push(command);
    const result = results.shift();
    if (result === undefined) throw new Error('unexpected command ' + JSON.stringify(command));
    return result;
  });
  return { apply, commands };
}

describe('UI-owned cord interaction model', () => {
  it('adds the lowest unused free cord id and removes only the requested cord', () => {
    const initial = [cord(2, free(), hole('1A#1'), 9), cord(0, hole('1B#1'), free(), 7)];
    const script = scripted({ ok: true }, { ok: true });

    const added = addFreeCord(initial, script.apply);
    expect(added).toEqual({
      k: 'added',
      cord: 1,
      cords: [
        cord(2, free(), hole('1A#1'), 9),
        cord(0, hole('1B#1'), free(), 7),
        cord(1, free(), free()),
      ],
    });
    if (added.k !== 'added') throw new Error('cord was not added');
    expect(removeCord(added.cords, 2, script.apply)).toEqual({
      k: 'removed',
      cord: 2,
      cords: [cord(0, hole('1B#1'), free(), 7), cord(1, free(), free())],
    });
    expect(script.commands).toEqual([
      { k: 'connect', cord: 1, a: free(), b: free(), r_uohm: 0 },
      { k: 'disconnect', cord: 2 },
    ]);
  });

  it('does not mutate local cords when add or remove is rejected', () => {
    const initial = [cord(0, hole('1A#1'), free(), 7)];
    const addScript = scripted({ ok: false, why: 'cord_exists' });
    expect(addFreeCord(initial, addScript.apply)).toEqual({
      k: 'rejected', why: 'cord_exists', cords: initial,
    });
    const removeScript = scripted({ ok: false, why: 'unknown_cord' });
    expect(removeCord(initial, 0, removeScript.apply)).toEqual({
      k: 'rejected', why: 'unknown_cord', cords: initial,
    });
  });

  it('reports a full 0..255 id space without issuing a command', () => {
    const full = Array.from({ length: 256 }, (_, id) => cord(id, free(), free()));
    const apply = vi.fn<ApplyCommand>();
    expect(addFreeCord(full, apply)).toEqual({ k: 'full', cords: full });
    expect(apply).not.toHaveBeenCalled();
  });

  it('orders endpoint identities by numeric CordId and a before b', () => {
    const cords = [cord(10, free(), hole('1A#1')), cord(2, free(), free()), cord(7, hole('2B#1'), free())];
    expect(orderedEndpoints(cords).map(endpointKey)).toEqual([
      '2:a', '2:b', '7:a', '7:b', '10:a', '10:b',
    ]);
    expect(freeTraySlots(cords)).toEqual([
      { key: '2:a', endpoint: { cord: 2, side: 'a' }, index: 0 },
      { key: '2:b', endpoint: { cord: 2, side: 'b' }, index: 1 },
      { key: '7:b', endpoint: { cord: 7, side: 'b' }, index: 2 },
      { key: '10:a', endpoint: { cord: 10, side: 'a' }, index: 3 },
    ]);
  });

  it('gives the two VI-TICTACTOE play ends distinct repeatable tray slots', () => {
    const tictactoe = [
      cord(70, hole('M10#1'), free()),
      cord(71, hole('M11#1'), free()),
    ];
    const first = freeTraySlots(tictactoe);
    const second = freeTraySlots(structuredClone(tictactoe));
    expect(first).toEqual([
      { key: '70:b', endpoint: { cord: 70, side: 'b' }, index: 0 },
      { key: '71:b', endpoint: { cord: 71, side: 'b' }, index: 1 },
    ]);
    expect(second).toEqual(first);
    expect(first[0]!.index).not.toBe(first[1]!.index);
  });

  it('computes occupancy while excluding only the dragged endpoint', () => {
    const cords = [
      cord(3, hole('1A#1'), hole('1B#1')),
      cord(4, hole('2A#1'), free()),
    ];
    expect(isHoleOccupied(cords, '1A#1' as HoleId)).toBe(true);
    expect(isHoleOccupied(cords, '1A#1' as HoleId, { cord: 3, side: 'a' })).toBe(false);
    expect(isHoleOccupied(cords, '1B#1' as HoleId, { cord: 3, side: 'a' })).toBe(true);
    expect(isHoleOccupied(cords, '2A#1' as HoleId, { cord: 3, side: 'a' })).toBe(true);
  });

  it('resolves drag preview, cancel, outside, tray, occupied, valid and same-end paths', () => {
    const cords = [cord(1, hole('1A#1'), hole('1B#1')), cord(2, hole('2A#1'), free())];
    const drag = beginCordDrag(cords, { cord: 1, side: 'a' });
    expect(drag).toEqual({
      endpoint: { cord: 1, side: 'a' },
      origin: { k: 'hole', hole: '1A#1' },
      preview: null,
    });

    const previewed = previewCordDrag(drag, { k: 'hole', hole: '3A#1' as HoleId });
    expect(previewed.preview).toEqual({ k: 'hole', hole: '3A#1' });
    expect(cancelCordDrag(previewed)).toEqual({
      k: 'cancelled', endpoint: { cord: 1, side: 'a' }, reason: 'cancel', end: hole('1A#1'),
    });
    expect(resolveCordDrop(cords, drag, { k: 'outside' })).toEqual({
      k: 'cancelled', endpoint: { cord: 1, side: 'a' }, reason: 'outside', end: hole('1A#1'),
    });
    expect(resolveCordDrop(cords, drag, { k: 'tray' })).toEqual({
      k: 'replace', endpoint: { cord: 1, side: 'a' }, from: hole('1A#1'), to: free(),
    });
    expect(resolveCordDrop(cords, drag, { k: 'hole', hole: '2A#1' as HoleId })).toEqual({
      k: 'cancelled', endpoint: { cord: 1, side: 'a' }, reason: 'occupied', end: hole('1A#1'),
    });
    expect(resolveCordDrop(cords, drag, { k: 'hole', hole: '3A#1' as HoleId })).toEqual({
      k: 'replace', endpoint: { cord: 1, side: 'a' }, from: hole('1A#1'), to: hole('3A#1'),
    });
    expect(resolveCordDrop(cords, drag, { k: 'hole', hole: '1A#1' as HoleId })).toEqual({
      k: 'noop', endpoint: { cord: 1, side: 'a' }, end: hole('1A#1'),
    });
    expect(resolveCordDrop(cords, previewed)).toEqual({
      k: 'replace', endpoint: { cord: 1, side: 'a' }, from: hole('1A#1'), to: hole('3A#1'),
    });
  });

  it('commits disconnect plus resistance-preserving connect transactionally', () => {
    const cords = [cord(5, hole('1A#1'), hole('1B#1'), 987_654)];
    const script = scripted({ ok: true }, { ok: true });
    const result = replaceCordEndpoint(cords, { cord: 5, side: 'a' }, hole('2A#1'), script.apply);
    expect(result).toEqual({
      k: 'committed',
      cords: [cord(5, hole('2A#1'), hole('1B#1'), 987_654)],
    });
    expect(script.commands).toEqual([
      { k: 'disconnect', cord: 5 },
      { k: 'connect', cord: 5, a: hole('2A#1'), b: hole('1B#1'), r_uohm: 987_654 },
    ]);
    expect(cords).toEqual([cord(5, hole('1A#1'), hole('1B#1'), 987_654)]);
  });

  it('does nothing for the same endpoint and preserves the old hole', () => {
    const cords = [cord(5, hole('1A#1'), hole('1B#1'), 7)];
    const apply = vi.fn<ApplyCommand>();
    expect(replaceCordEndpoint(cords, { cord: 5, side: 'a' }, hole('1A#1'), apply)).toEqual({
      k: 'noop', cords,
    });
    expect(apply).not.toHaveBeenCalled();
  });

  it('stops on disconnect rejection without changing local state', () => {
    const cords = [cord(5, hole('1A#1'), free(), 7)];
    const script = scripted({ ok: false, why: 'unknown_cord' });
    expect(replaceCordEndpoint(cords, { cord: 5, side: 'a' }, hole('2A#1'), script.apply)).toEqual({
      k: 'disconnect-rejected', why: 'unknown_cord', cords,
    });
    expect(script.commands).toEqual([{ k: 'disconnect', cord: 5 }]);
  });

  it('rolls back the exact original cord after connect rejection', () => {
    const cords = [cord(5, hole('1A#1'), free(), 987_654)];
    const script = scripted(
      { ok: true },
      { ok: false, why: 'hole_occupied' },
      { ok: true },
    );
    expect(replaceCordEndpoint(cords, { cord: 5, side: 'b' }, hole('2A#1'), script.apply)).toEqual({
      k: 'connect-rejected', why: 'hole_occupied', cords,
    });
    expect(script.commands).toEqual([
      { k: 'disconnect', cord: 5 },
      { k: 'connect', cord: 5, a: hole('1A#1'), b: hole('2A#1'), r_uohm: 987_654 },
      { k: 'connect', cord: 5, a: hole('1A#1'), b: free(), r_uohm: 987_654 },
    ]);
  });

  it('reports rollback rejection without inventing synchronized cord state', () => {
    const cords = [cord(5, hole('1A#1'), free(), 9)];
    const script = scripted(
      { ok: true },
      { ok: false, why: 'unknown_hole' },
      { ok: false, why: 'cord_exists' },
    );
    expect(replaceCordEndpoint(cords, { cord: 5, side: 'b' }, hole('2A#1'), script.apply)).toEqual({
      k: 'rollback-rejected', why: 'unknown_hole', rollbackWhy: 'cord_exists', cords: null,
    });
    expect(script.commands[2]).toEqual({
      k: 'connect', cord: 5, a: hole('1A#1'), b: free(), r_uohm: 9,
    });
  });

  it('forgets a cord the core lost when a drop rollback fails, and stays usable', () => {
    const script = scripted(
      { ok: true },
      { ok: false, why: 'unknown_hole' },
      { ok: false, why: 'cord_exists' },
      { ok: true },
    );
    const controller = createCordController([cord(5, hole('1A#1'), free(), 9)], script.apply);
    controller.beginDrag({ cord: 5, side: 'b' });
    const dropped = controller.drop({ k: 'hole', hole: '2A#1' as HoleId });
    expect(dropped.replacement?.k).toBe('rollback-rejected');
    expect(controller.snapshot()).toEqual([]);
    expect(controller.add()).toMatchObject({ k: 'added', cord: 0 });
  });

  it('forgets a cord the core lost when a touch release rollback fails', () => {
    const script = scripted(
      { ok: true },
      { ok: true },
      { ok: true },
      { ok: false, why: 'unknown_hole' },
      { ok: false, why: 'cord_exists' },
      { ok: true },
    );
    const controller = createCordController([cord(5, hole('1A#1'), free(), 9)], script.apply);
    expect(controller.beginTouch({ cord: 5, side: 'b' }, '3A' as TerminalId).k).toBe('started');
    expect(controller.releaseTouch().k).toBe('rollback-rejected');
    expect(controller.snapshot()).toEqual([]);
    expect(controller.add()).toMatchObject({ k: 'added', cord: 0 });
  });

  it('allows momentary touch only from free, occupies no hole, and restores free', () => {
    const initial = [cord(8, hole('1A#1'), free(), 42), cord(9, hole('2A#1'), free())];
    const startScript = scripted({ ok: true }, { ok: true });
    const started = beginMomentaryTouch(
      initial,
      { cord: 8, side: 'b' },
      '3A' as TerminalId,
      startScript.apply,
    );
    expect(started).toEqual({
      k: 'started',
      touch: { endpoint: { cord: 8, side: 'b' }, term: '3A' },
      cords: [cord(8, hole('1A#1'), { k: 'touch', term: '3A' as TerminalId }, 42), cord(9, hole('2A#1'), free())],
    });
    expect(startScript.commands).toEqual([
      { k: 'disconnect', cord: 8 },
      {
        k: 'connect', cord: 8, a: hole('1A#1'),
        b: { k: 'touch', term: '3A' as TerminalId }, r_uohm: 42,
      },
    ]);
    if (started.k !== 'started') throw new Error('touch did not start');
    expect(isHoleOccupied(started.cords, '3A#1' as HoleId)).toBe(false);
    const endScript = scripted({ ok: true }, { ok: true });
    expect(endMomentaryTouch(started.cords, started.touch, endScript.apply)).toEqual({
      k: 'committed', cords: initial,
    });
    expect(endScript.commands.at(-1)).toEqual({
      k: 'connect', cord: 8, a: hole('1A#1'), b: free(), r_uohm: 42,
    });

    const blocked = beginMomentaryTouch(initial, { cord: 8, side: 'a' }, '3A' as TerminalId, vi.fn());
    expect(blocked).toEqual({ k: 'not-free', cords: initial });
  });

  it('offers a controller with command-free preview and transactional drop/touch', () => {
    const script = scripted(
      { ok: true }, { ok: true },
      { ok: true }, { ok: true },
      { ok: true }, { ok: true },
    );
    const controller = createCordController([cord(4, hole('1A#1'), free(), 11)], script.apply);
    controller.beginDrag({ cord: 4, side: 'a' });
    controller.preview({ k: 'hole', hole: '2A#1' as HoleId });
    expect(script.commands).toEqual([]);
    expect(controller.drop()).toMatchObject({
      resolution: { k: 'replace', to: hole('2A#1') },
      replacement: { k: 'committed' },
    });
    expect(controller.snapshot()[0]).toEqual(cord(4, hole('2A#1'), free(), 11));

    expect(controller.beginTouch({ cord: 4, side: 'b' }, '3A' as TerminalId)).toMatchObject({ k: 'started' });
    expect(controller.releaseTouch()).toMatchObject({ k: 'committed' });
    expect(controller.snapshot()[0]).toEqual(cord(4, hole('2A#1'), free(), 11));
  });

  it('offers controller add and remove operations over the same serialized snapshot', () => {
    const script = scripted({ ok: true }, { ok: true });
    const controller = createCordController([cord(3, hole('1A#1'), free(), 11)], script.apply);
    expect(controller.add()).toMatchObject({ k: 'added', cord: 0 });
    expect(controller.snapshot()).toEqual([
      cord(3, hole('1A#1'), free(), 11),
      cord(0, free(), free()),
    ]);
    expect(controller.remove(3)).toMatchObject({ k: 'removed', cord: 3 });
    expect(controller.snapshot()).toEqual([cord(0, free(), free())]);
  });

  it('uses the same exact free restoration for touch cancellation', () => {
    const script = scripted({ ok: true }, { ok: true }, { ok: true }, { ok: true });
    const controller = createCordController([cord(4, hole('1A#1'), free(), 11)], script.apply);
    expect(controller.beginTouch({ cord: 4, side: 'b' }, '3A' as TerminalId)).toMatchObject({ k: 'started' });
    expect(controller.cancelTouch()).toEqual({
      k: 'committed', cords: [cord(4, hole('1A#1'), free(), 11)],
    });
    expect(script.commands.slice(-2)).toEqual([
      { k: 'disconnect', cord: 4 },
      { k: 'connect', cord: 4, a: hole('1A#1'), b: free(), r_uohm: 11 },
    ]);
  });

  it('keeps tray coordinates and all other presentation state out of contract objects', () => {
    const cords = [cord(70, hole('M10#1'), free(), 123), cord(71, hole('M11#1'), free())];
    const script = scripted({ ok: true }, { ok: true });
    const result = replaceCordEndpoint(cords, { cord: 70, side: 'b' }, hole('6com#1'), script.apply);
    expect(result.k).toBe('committed');
    const contractJson = JSON.stringify(result.k === 'committed' ? result.cords : cords);
    expect(contractJson).toBe('[{"id":70,"a":{"k":"hole","hole":"M10#1"},"b":{"k":"hole","hole":"6com#1"},"r_uohm":123},{"id":71,"a":{"k":"hole","hole":"M11#1"},"b":{"k":"free"},"r_uohm":0}]');
    expect(contractJson).not.toMatch(/"(?:x|y|slot|index)"/u);
    expect(JSON.stringify(script.commands)).not.toMatch(/"(?:x|y|slot|index)"/u);
    expect(freeTraySlots(cords)[0]).toEqual({
      key: '70:b', endpoint: { cord: 70, side: 'b' }, index: 0,
    });
  });
});
