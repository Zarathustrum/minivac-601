/**
 * Machine-level motor and rotary-drive spec (Phase 5 Step 2, `docs/plans/phase-5-corpus.md`).
 *
 * `test/rotary.spec.ts` proves the integer rotary unit in isolation. This file drives the whole
 * Machine — shipped MV601-REF-A profile, shipped netlist, cords by terminal — and checks only
 * what the manuals print, as quoted in `docs/research/rotary.md` and `docs/research/programs.md`.
 *
 * Assertions are qualitative: signs, orderings, equalities and ratios above 1. No speed, angle,
 * current or time is pinned. Every window is derived from the loaded profile (one revolution at
 * `run_mrpm`, one pushbutton or slide stroke, one relay stroke) or is a small multiple of one.
 * The only literal numbers are the 16-position, 22.5-degree dial geometry (`rotary.md` §1,
 * [verified] Photo C and Book I p.20) and the 15/22/33 ohm shunts Book VII p.21 prints.
 *
 * Claims the simulator contradicts are `it.fails('DEFECT: ...')`, so the suite stays green and the
 * defect stays visible. Do not weaken them to make them pass; fix the simulator, then flip them.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import refJson from '../data/profiles/MV601-REF-A.json';
import type { Command, Event, Machine, Sect } from '../src/core/contract.ts';
import { createMachine } from '../src/core/machine.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import { loadProfile } from '../src/core/profile.ts';
import { parseTerminalId, terminalIndex } from '../src/core/terminals.ts';

const netlist = loadNetlist(new Uint8Array(readFileSync(new URL('../data/netlist.json', import.meta.url))));
const profile = loadProfile(refJson);

// rotary.md §1 [verified]: sixteen equally spaced positions, 360/16 = 22.5 degrees per pitch.
const FULL_UDEG = 360_000_000;
const PITCH_UDEG = FULL_UDEG / 16;

/** Ticks in one revolution at the profile's RUN rate (`run_mrpm` is rpm x 1000). */
const REV = Math.ceil((60_000_000 * 1000) / (profile.v.run_mrpm * profile.v.tick_us));
/** Two full pushbutton strokes: long enough for any press or release to finish and settle. */
const BUTTON_SETTLE = 2 * profile.derived.pushbuttonTicks;
/** Two full slide-switch strokes. */
const SLIDE_SETTLE = 2 * profile.derived.slideTicks;
/** A generous relay settle: four operate plus four release strokes. */
const RELAY_SETTLE = 4 * (profile.derived.relayOperateTicks + profile.derived.relayReleaseTicks);

function build(wires: readonly string[]): Machine {
  const m = createMachine(netlist, profile);
  wires.forEach((w, cord) => {
    const [a, b] = w.split('/') as [string, string];
    const command: Command = {
      k: 'connect',
      cord,
      a: { k: 'touch', term: parseTerminalId(a) },
      b: { k: 'touch', term: parseTerminalId(b) },
    };
    expect(m.apply(command), w).toEqual({ ok: true });
  });
  return m;
}

function powerOn(m: Machine): void {
  expect(m.apply({ k: 'power', on: true })).toEqual({ ok: true });
  m.advance(1);
}

function button(m: Machine, n: Sect, down: boolean): void {
  expect(m.apply({ k: 'button', n, target: down ? 1000 : 0 })).toEqual({ ok: true });
}

function press(m: Machine, n: Sect): void {
  button(m, n, true);
  m.advance(BUTTON_SETTLE);
  button(m, n, false);
  m.advance(BUTTON_SETTLE);
}

/** The pad centre for dial position `pos`, honouring the profile's wiper offset. */
function padUdeg(pos: number): number {
  const raw = (profile.v.wiper_offset_udeg + pos * PITCH_UDEG) % FULL_UDEG;
  return raw < 0 ? raw + FULL_UDEG : raw;
}

/** Hand-drag to an absolute target and wait until the knob is there. */
function grabTo(m: Machine, targetUdeg: number): void {
  expect(m.apply({ k: 'dialGrab', targetUdeg })).toEqual({ ok: true });
  // A hand move never exceeds half a turn; bound the wait by a generous multiple of a revolution
  // at the hand rate, derived from the profile.
  const handRev = Math.ceil((60_000_000 * 1000) / (profile.v.hand_slew_mrpm * profile.v.tick_us));
  for (let i = 0; i < 2 * handRev && m.snapshot().dial.udeg !== targetUdeg; i++) m.advance(1);
  expect(m.snapshot().dial.udeg).toBe(targetUdeg);
}

/** Turn the knob by hand one way through whole pitches to `to`, then let go. */
function turnBy(m: Machine, dir: 1 | -1, to: number): void {
  let pos = m.snapshot().dial.contact;
  expect(pos).not.toBeNull();
  // Each grab stays well under half a turn so the shortest-path rule cannot pick the other way.
  while (pos !== to) {
    let steps = 0;
    while (pos !== to && steps < 4) {
      pos = (((pos as number) + dir) % 16 + 16) % 16;
      steps++;
    }
    grabTo(m, padUdeg(pos as number));
    m.advance(RELAY_SETTLE);
  }
  expect(m.apply({ k: 'dialRelease' })).toEqual({ ok: true });
  m.advance(RELAY_SETTLE);
}

interface Window {
  events: Extract<Event, { k: 'dial.make' | 'dial.break' }>[];
  makes: number[];
  startUdeg: number;
  endUdeg: number;
}

/** Advance `ticks` and return the dial edges seen in that window only. */
function watch(m: Machine, ticks: number): Window {
  m.drainEvents();
  const startUdeg = m.snapshot().dial.udeg;
  m.advance(ticks);
  const events = m.drainEvents().filter(
    (e): e is Extract<Event, { k: 'dial.make' | 'dial.break' }> => e.k === 'dial.make' || e.k === 'dial.break',
  );
  return { events, makes: events.filter((e) => e.k === 'dial.make').map((e) => e.pos), startUdeg, endUdeg: m.snapshot().dial.udeg };
}

/** Travel direction from consecutive pad makes: +1 increasing numbers, -1 decreasing. */
function direction(makes: readonly number[]): 1 | -1 {
  expect(makes.length).toBeGreaterThan(1);
  const step = (makes[1]! - makes[0]! + 16) % 16;
  expect([1, 15]).toContain(step);
  for (let i = 1; i < makes.length; i++) expect((makes[i]! - makes[i - 1]! + 16) % 16).toBe(step);
  return step === 1 ? 1 : -1;
}

function expectStill(w: Window): void {
  expect(w.events).toEqual([]);
  expect(w.endUdeg).toBe(w.startUdeg);
}

function mv(m: Machine, term: string): number {
  const v = m.snapshot().terminalMv[terminalIndex(parseTerminalId(term))];
  expect(v).not.toBeNull();
  return v as number;
}

function lamp(m: Machine, n: Sect): 'off' | 'dim' | 'on' {
  return m.snapshot().outLamps[n - 1]!.cls;
}

const RUN = ['M+/D17', 'M-/D18'] as const;
const RUN_REVERSED = ['M-/D17', 'M+/D18'] as const;
const ACROSS_STOP = ['M+/D18', 'M-/D19'] as const;
// Book I Exp 12, printed p.23 (book1.pdf PDF p.25), [verified] programs.md I-EXP12.
const EXP12 = ['6+/5Y', '5X/D17', '6-/D18', '6-/6Y', '6X/D19'] as const;

describe('rotary.md §3.2: the seven documented drive conditions', () => {
  it('1. RUN energised: the knob turns, and the armature sees a divided voltage', () => {
    // Book I printed p.22 (PDF p.24): "Power must be supplied to terminals 17 and 18 (run) to
    // operate the motor drive." MM printed p.9 (PDF p.11): "connecting power to the RUN terminals
    // (D17 and D18). Turn power on. The rotary switch pointer knob should turn."
    // rotary.md §3.2 row 1: "Sees a divided voltage" (R1 in series, §3.1).
    const m = build(RUN);
    powerOn(m);
    const w = watch(m, REV);
    expect(w.makes.length).toBeGreaterThan(0);
    const armature = Math.abs(mv(m, 'D18') - mv(m, 'D19'));
    const run = Math.abs(mv(m, 'D17') - mv(m, 'D18'));
    expect(armature).toBeGreaterThan(0);
    expect(armature).toBeLessThan(run);
  });

  it('2. RUN with the polarity reversed turns the knob the other way', () => {
    // MM printed p.9 (PDF p.11): "Reverse the power connections: the pointer knob should turn in
    // the opposite direction." rotary.md §3.2 row 2.
    const forward = build(RUN);
    powerOn(forward);
    const reverse = build(RUN_REVERSED);
    powerOn(reverse);
    expect(direction(watch(reverse, REV).makes)).toBe(-direction(watch(forward, REV).makes));
  });

  it('3. STOP shorted with RUN still live: no travel, supply current still flows, no trip', () => {
    // Book I printed p.22 (PDF p.24): "A short circuit may be connected across terminals 18 and 19
    // (stop) to halt the motor drive." MM printed p.9: "Connect a short circuit across the STOP
    // terminals (D18 and D19): the pointer knob should stop turning." rotary.md §3.2 row 3:
    // "Supply current flows D17 -> R1 -> short, limited by R1 alone".
    const stopped = build([...RUN, 'D18/D19']);
    powerOn(stopped);
    stopped.advance(BUTTON_SETTLE);
    expectStill(watch(stopped, REV));
    // Book I printed p.23 (PDF p.25), Exp 12: "Current flows through pushbutton 6 instead of
    // through the motor."
    expect(stopped.snapshot().supplyUa).toBeGreaterThan(0);
    expect(stopped.snapshot().breakerTripped).toBe(false);
  });

  it('4. RUN de-energised: the motor stops', () => {
    // Book I printed p.23 (PDF p.25), Exp 12 step 5: "Release pushbutton 5. The motor drive again
    // stops, this time because power is no longer connected to the motor circuit."
    // rotary.md §3.2 row 4. (The R2 loading half of the row is not observable with no supply.)
    const m = build(RUN);
    powerOn(m);
    expect(watch(m, REV).makes.length).toBeGreaterThan(0);
    expect(m.apply({ k: 'disconnect', cord: 0 })).toEqual({ ok: true });
    m.advance(BUTTON_SETTLE);
    expectStill(watch(m, REV));
  });

  it('5. power directly across STOP turns the knob', () => {
    // MM printed p.9 (PDF p.11): "connect power momentarily across the STOP terminals: the knob
    // should turn very rapidly." rotary.md §3.2 row 5. The "faster than RUN" half is its own test.
    const m = build(ACROSS_STOP);
    powerOn(m);
    expect(watch(m, REV).makes.length).toBeGreaterThan(0);
  });

  it('6. a 15, 22 or 33 ohm resistor across STOP slows the motor without stopping it', () => {
    // Book VII printed p.21 (PDF p.26; 601/6010 joint manual), optional connection (D18/Ω)(Ω/D19):
    // "Use a 15, 22 or 33 ohm resistor to decrease the speed of the motor." rotary.md §3.2 row 6.
    // D3 excludes Book VII programs from the corpus; this row is kept only because Step 2 names all
    // seven §3.2 rows and the shunt needs no capacitor (Contract 1.2).
    const free = build(RUN);
    powerOn(free);
    const freePads = watch(free, REV).makes.length;
    for (const ohm of [15, 22, 33]) {
      const m = build(RUN);
      expect(m.apply({
        k: 'connect',
        cord: 2,
        a: { k: 'touch', term: parseTerminalId('D18') },
        b: { k: 'touch', term: parseTerminalId('D19') },
        r_uohm: ohm * 1_000_000,
      })).toEqual({ ok: true });
      powerOn(m);
      const pads = watch(m, REV).makes.length;
      expect(pads, ohm + ' ohm').toBeGreaterThan(0);
      expect(pads, ohm + ' ohm').toBeLessThan(freePads);
    }
  });

  it('7. the hand overrides a running motor without a stall, trip or damage', () => {
    // Book I printed p.22 (PDF p.24): "The rotary switch may be positioned either by hand or by the
    // motor drive. A DC motor turns the rotary switch through a friction drive." Errata, note to
    // Book V p.31 (errata.pdf PDF p.4): "slow the rotary switch down by holding the pointer knob
    // back during one revolution." rotary.md §3.2 row 7: "the operator wins. No stall, no damage."
    const m = build(RUN);
    powerOn(m);
    const freeDir = direction(watch(m, REV).makes);
    const target = padUdeg(8);
    grabTo(m, target);
    const held = watch(m, REV);
    expectStill(held);
    expect(m.snapshot().dial).toMatchObject({ udeg: target, held: true });
    expect(m.snapshot().breakerTripped).toBe(false);
    expect(m.apply({ k: 'dialRelease' })).toEqual({ ok: true });
    expect(direction(watch(m, REV).makes)).toBe(freeDir);
  });
});

describe('RUN / STOP semantics at Machine level', () => {
  it('RUN polarity sets direction: slide switch 6 reverses travel (Book I Exp 14)', () => {
    // Book I printed p.24 (PDF p.26), Exp 14 step 5: "Change the position of switch 6. The motor
    // reverses direction and the pointer knob turns in the opposite direction." Program from
    // programs.md I-EXP14 (ER-02 corrects only the diagram label, no wire).
    const m = build(['6+/6R', '6+/6W', '6-/6T', '6T/6U', '6S/D18', '6V/D17']);
    powerOn(m);
    m.advance(SLIDE_SETTLE);
    const before = direction(watch(m, REV).makes);
    expect(m.apply({ k: 'switch', n: 6, target: 1000 })).toEqual({ ok: true });
    m.advance(SLIDE_SETTLE);
    expect(direction(watch(m, REV).makes)).toBe(-before);
  });

  it('a slide-switch reversal on a pad is not dial chatter (Book I Exp 14; architecture §9.2)', () => {
    // Same program and step 5 as above, with the throw on the c8 arrival as fixture C2/I-EXP14 does.
    // The drive holds through the slide stroke (TRANSFER-COAST-DEFER) and resumes with the opposite
    // sign, so the wiper re-crosses the pad it is on. §9.2: the dial at 45 rpm never trips the
    // detector; a reversal must reseed the dial's history like a coast does.
    const m = build(['6+/6R', '6+/6W', '6-/6T', '6T/6U', '6S/D18', '6V/D17']);
    powerOn(m);
    for (let t = 0; t < 2 * REV && m.snapshot().dial.contact !== 8; t++) m.advance(1);
    expect(m.snapshot().dial.contact).toBe(8);
    m.drainEvents();
    expect(m.apply({ k: 'switch', n: 6, target: 1000 })).toEqual({ ok: true });
    m.advance(REV);
    expect(m.drainEvents().filter((e) => e.k === 'chatter')).toEqual([]);
    expect(m.snapshot().flags.chattering).toEqual([]);
  });

  it('a reversal-driven hunt is still dial chatter: the reversal reseed is once per window (architecture §9.2)', () => {
    // Relay 1, fed through the dial, delays relay 2, whose transfer picks the motor's direction. The
    // dial runs down to pad 8 and hunts back and forth across it, reversing on almost every crossing.
    // Only the dial detector can catch it (neither relay changes fast enough to trip its own). A reseed
    // on every reversal would hide it; once per dial window, the ninth transition still lands.
    const m = build([
      'D16/1+', 'D8/1E', '1F/1-', '1+/1H', '1G/2E', '2F/2-',
      '2+/2J', '2-/2G', '2-/2N', '2+/2K', '2H/D18', '2L/D17',
    ]);
    powerOn(m);
    m.advance(REV);
    const chatter = m.drainEvents().filter((e) => e.k === 'chatter');
    expect(chatter.map((e) => (e.k === 'chatter' ? e.dev : null))).toEqual(['dial']);
    expect(m.snapshot().flags.chattering).toEqual(['dial']);
  });

  it('D17+ / D18- drives toward increasing numbers: light 5 (D1) flashes before light 6 (D2) (Book I p.23 Exp 13)', () => {
    // Book I printed p.23 (PDF p.25) Exp 13: "First, light 5 flashes and then light 6 flashes, once
    // each revolution of the rotary switch." Restated p.24 (PDF p.26). Same sense: Books V-VI p.6
    // Exp 5 and the p.11 elevator below; Exp 4 disagrees with itself (p.5 fits, p.4 does not). Tom
    // ruled for this sign on 2026-10-13 (docs/DECISIONS.md); open-questions.md O-R11 has the evidence.
    const m = build(['6+/D16', 'D2/6A', '6-/6B', 'D1/5A', '5B/6B', '6+/5Y', '5X/D17', '5-/D18', '6-/6Y', '6X/D19']);
    powerOn(m);
    button(m, 5, true);
    m.advance(BUTTON_SETTLE);
    m.drainEvents();
    const firstOn = (n: Sect): number => {
      for (let t = 0; t < REV; t++) {
        if (lamp(m, n) === 'on') return t;
        m.advance(1);
      }
      return REV;
    };
    // From D0, light 5 (D1) must come on while light 6 (D2) is still dark.
    expect(firstOn(5)).toBeLessThan(REV);
    expect(lamp(m, 6)).toBe('off');
    expect(firstOn(6)).toBeLessThan(REV);
    expect(direction(watch(m, REV).makes)).toBe(1);
  });

  it('STOP wins over RUN, and lifting the short restores motion with power never cut (Book I Exp 12)', () => {
    // Book I printed p.23 (PDF p.25), Exp 12: "Push pushbutton 5. This supplies power to the RUN
    // terminals (D17 and D18) and causes the pointer of the rotary switch to rotate." / "While
    // holding pushbutton 5 down, push pushbutton 6. The motor stops when pushbutton 6 is pushed
    // because a short circuit is created across the STOP terminals (D18 and D19). Current flows
    // through pushbutton 6 instead of through the motor." / "While holding pushbutton 5 down,
    // release pushbutton 6. The motor drive operates again because the short circuit has been
    // removed." / "Release pushbutton 5. The motor drive again stops, this time because power is
    // no longer connected to the motor circuit."
    const m = build(EXP12);
    powerOn(m);
    expectStill(watch(m, REV));

    button(m, 5, true);
    m.advance(BUTTON_SETTLE);
    const dir = direction(watch(m, REV).makes);

    button(m, 6, true);
    m.advance(BUTTON_SETTLE);
    expectStill(watch(m, REV));
    expect(m.snapshot().supplyUa).toBeGreaterThan(0);

    button(m, 6, false);
    m.advance(BUTTON_SETTLE);
    expect(direction(watch(m, REV).makes)).toBe(dir);

    button(m, 5, false);
    m.advance(BUTTON_SETTLE);
    expectStill(watch(m, REV));
    expect(m.snapshot().supplyUa).toBe(0);
  });

  it('a sustained STOP short does not trip the breaker (Book I p.22)', () => {
    // Book I printed p.22 (PDF p.24): "The resistors make it possible to connect a short circuit
    // across the STOP terminals to stop the motor without over-loading the power supply."
    // The window is ten breaker delays from the profile; the positive control proves a dead
    // +/- short does trip inside that same window.
    const tripWindow = 10 * Math.ceil(profile.v.trip_delay_us / profile.v.tick_us);
    const m = build(EXP12);
    powerOn(m);
    button(m, 5, true);
    button(m, 6, true);
    m.advance(BUTTON_SETTLE + tripWindow);
    expect(m.snapshot().buttons[4]!.no && m.snapshot().buttons[5]!.no).toBe(true);
    expect(m.snapshot().supplyUa).toBeGreaterThan(0);
    expect(m.snapshot().breakerTripped).toBe(false);

    const control = build(['M+/M-']);
    powerOn(control);
    control.advance(tripWindow);
    expect(control.snapshot().breakerTripped).toBe(true);
  });

  it('power across STOP runs faster than RUN (MM p.9)', () => {
    // MM printed p.9 (PDF p.11): "If the pointer knob does not rotate, connect power momentarily
    // across the STOP terminals: the knob should turn very rapidly." rotary.md §3.2 row 5 / §4.
    // Positions advanced in equal windows; only the ratio's side of 1 is asserted.
    const run = build(RUN);
    powerOn(run);
    const runPads = watch(run, REV).makes.length;
    const fast = build(ACROSS_STOP);
    powerOn(fast);
    const fastPads = watch(fast, REV).makes.length;
    expect(runPads).toBeGreaterThan(0);
    expect(fastPads / runPads).toBeGreaterThan(1);
  });

  it('under the motor every pad edge comes in travel order, break-before-make', () => {
    // Book I printed p.21 (PDF p.23), Exp 11: "Notice that light 5 goes OFF before light 6 comes
    // ON. This shows that the rotary switch is designed to disconnect the arm from one contact
    // before making connection with the next contact." Book I printed p.22: "The rotary switch
    // connections are made sequentially whether the pointer is turned by hand or driven by the
    // motor." rotary.md §2. Checked at RUN in both polarities and at the fastest drive.
    for (const wires of [RUN, RUN_REVERSED, ACROSS_STOP]) {
      const m = build(wires);
      powerOn(m);
      let made: number | null = m.snapshot().dial.contact;
      const w = watch(m, 2 * REV);
      const dir = direction(w.makes);
      let lastBreak: number | null = null;
      for (const e of w.events) {
        if (e.k === 'dial.break') {
          expect(made, wires.join(' ')).toBe(e.pos);
          lastBreak = e.pos;
          made = null;
        } else {
          // Never two contacts at once, within a tick or across ticks.
          expect(made, wires.join(' ')).toBeNull();
          if (lastBreak !== null) expect((e.pos - lastBreak + 16) % 16).toBe(dir === 1 ? 1 : 15);
          made = e.pos;
        }
      }
      expect(m.snapshot().dial.contact).toBe(made);
      expect(new Set(w.makes).size, wires.join(' ')).toBe(16);
    }
  });
});

describe('Book I Answers 14 and 15 (printed p.31), the wiring programs.md marks verified', () => {
  // Problem 14, Book I printed p.28 (PDF p.30, clean body OCR): "Design a circuit in which the
  // rotary switch turns only when pushbutton 6 is down. The rotary switch should NOT turn when
  // pushbutton 6 is up, or when both pushbutton 6 and pushbutton 5 are down." Problem 15: "Design a
  // circuit to meet the requirements of problem 14 using terminal 5X." Wiring [verified] at 300 dpi,
  // book1.pdf PDF p.33 (programs.md I-PROBLEMS; Answer 15 is five lines in full, read off the
  // book1.pdf PDF p.33 page image).
  // rotary.md §4: Answer 14 "Motor runs only while pushbutton 6 is down and pushbutton 5 is up";
  // Answer 15 "Pushbutton 5's normally-open pair bridges D18 to D19 and halts the dial."
  const answers = {
    'Answer 14': ['5+/5Y', '5Z/6X', '6Y/D17', 'M-/D18'],
    'Answer 15': ['6+/6X', '6Y/D17', 'M-/D18', 'D18/5X', '5Y/D19'],
  } as const;
  for (const [name, wires] of Object.entries(answers)) {
    it(name + ': turns only while pushbutton 6 is down and pushbutton 5 is up', () => {
      for (const [pb5, pb6] of [[false, false], [false, true], [true, false], [true, true]] as const) {
        const m = build(wires);
        powerOn(m);
        button(m, 5, pb5);
        button(m, 6, pb6);
        m.advance(BUTTON_SETTLE);
        const w = watch(m, REV);
        const label = name + ' pb5=' + String(pb5) + ' pb6=' + String(pb6);
        if (pb6 && !pb5) expect(w.makes.length, label).toBeGreaterThan(0);
        else expectStill(w);
        expect(m.snapshot().breakerTripped, label).toBe(false);
      }
    });
  }
});

// rotary.md §7 reference programs.
// Books V-VI printed p.11 (book5-6.pdf PDF p.17), Experiment 9, with errata ER-31's two program
// corrections (4G/4H -> 4G/5H, D16/M- -> D16/M+) — the BASE variant, not the optional reliability
// variant. programs.md V-EXP9 [likely] (clean OCR); ER-31 [verified].
const ELEVATOR = [
  '1A/1E', '1B/1-', '1C/2C', '1E/D1', '1F/1G', '1G/1X', '1H/1+', '1H/1L', '1J/2H', '1K/5E',
  '1Y/2Y', '2A/2E', '2B/2-', '2C/3C', '2E/D7', '2F/2G', '2G/2X', '2J/3H', '2X/6H', '2Y/3Y',
  '3A/3E', '3B/3-', '3C/4C', '3E/D13', '3F/3G', '3G/3X', '3J/4E', '3Y/4J', '4C/5F', '4F/4+',
  '4G/5H', '4H/4+', '4L/D19', '4N/D18', '5C/5G', '5E/6G', '5F/6C', '5G/5N', '5J/5K', '5J/D17',
  '5L/5-', '5N/D18', '6C/6-', '6F/D12', 'D0/D1', 'D6/D7', 'D12/D13', 'D16/M+',
] as const;

/** Lights 1-3 are the floor indicators (programs.md V-EXP9 floor map). */
function floorLamps(m: Machine): string[] {
  return ([1, 2, 3] as const).map((n) => lamp(m, n));
}

/** §7's scenario up to the hang: park at D0, power on, call floor 2, then rest in the D6-D7 gap. */
function elevatorInGap(): Machine {
  const m = build(ELEVATOR);
  powerOn(m);
  m.advance(RELAY_SETTLE);
  press(m, 2);
  m.advance(3 * REV);
  // Under the shipped profile the motor-driven arrival lands on D6, not in the gap. The errata
  // says only that "the pointer knob stops between adjacent terminals", not how it got there, so
  // the hand parks it there.
  grabTo(m, (padUdeg(6) + PITCH_UDEG / 2) % FULL_UDEG);
  expect(m.apply({ k: 'dialRelease' })).toEqual({ ok: true });
  m.advance(RELAY_SETTLE);
  return m;
}

describe('rotary.md §7: the three-floor elevator and the D6-D7 hang (Book V Exp 9, errata ER-31)', () => {
  it('parked at D0 shows floor 1; pushbutton 2 brings it to the D6-D7 landing and floor 2', () => {
    // Books V-VI printed p.12 (PDF p.18): "Set the 'elevator' at the first floor by setting the
    // pointer knob at D0. Turn power on. Output light 1 will come on indicating the location of the
    // 'elevator'." / "To direct the 'elevator' to the second floor, push pushbutton 2." Floor
    // table, printed p.11 (PDF p.17): floor 2 =
    // output light 2 = D6-D7. rotary.md §7: "Park at D0, power on, verify light 1. Push pushbutton 2."
    const m = build(ELEVATOR);
    powerOn(m);
    m.advance(RELAY_SETTLE);
    expect(m.snapshot().dial.contact).toBe(0);
    expect(floorLamps(m)).toEqual(['on', 'off', 'off']);
    press(m, 2);
    m.advance(3 * REV);
    expect(m.snapshot().dial.mrpm).toBe(0);
    expect([6, 7]).toContain(m.snapshot().dial.contact);
    expect(floorLamps(m)).toEqual(['off', 'on', 'off']);
  });

  it('a floor 1 to floor 2 trip keeps the direction it selected (Books V-VI p.11 steps 4, 5, 7)', () => {
    // Books V-VI printed p.11 (PDF p.17): "4. The system will select the direction in which it is
    // to move (up or down). 5. The 'elevator' will begin to move in the selected direction. ...
    // 7. The 'elevator' will continue to move to its stored destination." Same motor sign as the
    // Exp 13 test. direction() fails on any change of step, so a reversal fails this test.
    const m = build(ELEVATOR);
    powerOn(m);
    m.advance(RELAY_SETTLE);
    m.drainEvents();
    press(m, 2);
    m.advance(3 * REV);
    const makes = m.drainEvents().flatMap((e) => (e.k === 'dial.make' ? [e.pos] : []));
    // Floor 1 (D0-D1) to floor 2 (D6-D7) is up the numbers.
    expect(direction(makes)).toBe(1);
  });

  it('resting between D6 and D7 it connects to neither, so no floor indicator lights', () => {
    // Errata, Book V p.11 Exp 9 note (errata.pdf PDF p.3): "It is possible for the 'elevator' to
    // get stuck at a floor. This happens when the pointer knob stops between adjacent terminals —
    // for example, between D6 and D7 — and is not making proper connection with either."
    // rotary.md §7: "contact_at returns None, no floor indicator lights".
    const m = elevatorInGap();
    expect(m.snapshot().dial.contact).toBeNull();
    expect(floorLamps(m)).toEqual(['off', 'off', 'off']);
  });

  it('moving the knob onto D6 or D7 recovers it: floor 2 lights and the next call is served', () => {
    // Errata, Book V p.11: "In such case, move the pointer knob so that it is pointing directly at
    // one of the terminals." rotary.md §7: "Moving the knob onto D6 or D7 must recover it."
    for (const pos of [6, 7]) {
      const m = elevatorInGap();
      grabTo(m, padUdeg(pos));
      expect(m.apply({ k: 'dialRelease' })).toEqual({ ok: true });
      m.advance(RELAY_SETTLE);
      expect(floorLamps(m), 'D' + pos).toEqual(['off', 'on', 'off']);
      press(m, 3);
      m.advance(3 * REV);
      expect([12, 13], 'D' + pos).toContain(m.snapshot().dial.contact);
      expect(floorLamps(m), 'D' + pos).toEqual(['off', 'off', 'on']);
    }
  });
});

// Books V-VI printed p.51-53, basic sequence recognition circuit, 38 lines [verified] 130 dpi
// (programs.md VI-SEQREC, line 6A/6J per its [likely] cross-printing resolution), plus the
// Combination Lock wires of printed p.52 (book5-6.pdf PDF p.58) [verified].
const SEQREC = [
  '1A/1G', '1B/1-', '1C/2C', '1F/1G', '1F/2K', '1H/2G', '1com/2L', '2C/3C', '2F/2G', '2F/3K',
  '2H/3G', '2N/3N', '2com/3L', '3C/4C', '3F/3G', '3F/4K', '3H/4G', '3N/4N', '3com/4L', '4C/5C',
  '4F/4G', '4F/5K', '4H/5G', '4N/5N', '4com/5L', '5C/6C', '5F/5G', '5F/6K', '5H/6G', '5N/6N',
  '5com/6L', '6A/6J', '6B/6-', '6C/6-', '6E/6N', '6F/6G', '6F/6com', '6H/6+',
] as const;
const LOCK = ['D16/M+', 'D13/6com', 'D2/5com', 'D11/4com', 'D10/3com', 'D6/2com', 'D9/1com'] as const;
const TRAP = 'D8/6E';

/**
 * The printed combination: left to 13, right to 2, left to 10, right to 6, left to 9. "Left"
 * runs toward lower numbers: the page's "left to 10" row wires D11 then D10, and programs.md
 * reads it as "the dial passes 11 then stops on 10".
 */
const COMBINATION: readonly [1 | -1, number][] = [[-1, 13], [1, 2], [-1, 10], [1, 6], [-1, 9]];

describe('rotary.md §7: the Combination Lock D8 trap (Books V-VI p.52)', () => {
  it('passing 8 by hand on the way to a later number indicates an error; without D8/6E it does not', () => {
    // Books V-VI printed p.52 (PDF p.58), footnote to (optional) D8/6E*: "This last connection is
    // optional; it will cause the machine to indicate an error if 8 is passed at any point."
    // Light 1 = solved, light 6 = error (programs.md VI-COMBOLOCK / VI-SEQREC). rotary.md §7:
    // "hand-drag the dial past position 8 en route to a later number and assert the error fires."
    // Route: the first four steps as printed, then the last step taken RIGHT from 6 to 9, which
    // crosses 7 and 8 in one hand drag instead of going left round the dial.
    for (const trapped of [true, false]) {
      const m = build([...SEQREC, ...LOCK, ...(trapped ? [TRAP] : [])]);
      powerOn(m);
      m.advance(RELAY_SETTLE);
      for (const [dir, to] of COMBINATION.slice(0, 4)) turnBy(m, dir, to);
      expect(lamp(m, 6), 'before the last step').toBe('off');
      m.drainEvents();
      turnBy(m, 1, 9);
      expect(m.drainEvents().some((e) => e.k === 'dial.make' && e.pos === 8)).toBe(true);
      if (trapped) {
        expect(lamp(m, 6)).toBe('on');
        expect(lamp(m, 1)).toBe('off');
      } else {
        expect(lamp(m, 6)).toBe('off');
        // [unverified] control derived from the 38-line topology: the page prints "left to 9", not
        // this right-hand route; this check only shows that the trap, not the route, causes the error.
        expect(lamp(m, 1)).toBe('on');
      }
    }
  });

  it('the printed combination never passes 8, so the trap leaves it solvable', () => {
    // Books V-VI printed p.52 (PDF p.58): the combination table. Printed p.53 (PDF p.59): "When you
    // are designing a combination, you must not include any connection which will touch off a
    // connection further along."
    // Light 1 ON = combination solved (programs.md VI-COMBOLOCK).
    const m = build([...SEQREC, ...LOCK, TRAP]);
    powerOn(m);
    m.advance(RELAY_SETTLE);
    m.drainEvents();
    for (const [dir, to] of COMBINATION) turnBy(m, dir, to);
    expect(m.drainEvents().some((e) => e.k === 'dial.make' && e.pos === 8)).toBe(false);
    expect(lamp(m, 1)).toBe('on');
    expect(lamp(m, 6)).toBe('off');
  });
});
