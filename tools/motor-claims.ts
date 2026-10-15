/**
 * `tools/motor-claims.ts` — printed claims about motor-driven programs, as checks over a profile
 * (Phase 5 Step 3, `docs/plans/phase-5-corpus.md`). `tools/motor-sweep.ts` runs every claim at every
 * grid point and reports the pass bands; nothing here tunes a profile constant (kill rule).
 *
 * Every claim rests on a PRINTED observable only. Its `quote` is verbatim from the manual page,
 * confirmed against the page image under `docs/research/raw/pdf/pages/<book>/p-NN.png` (Book I:
 * printed N = PDF N+2; Books V-VI: printed N = PDF N+6). Wires come from
 * `test/conformance/corpus/programs.json` (`wiresEffective`, errata applied) by id, read at module
 * load. The only operator actions are the ones the printed procedure states.
 *
 * A check builds its own Machine (shipped netlist, touch-ended cords, buttons 0/1000) and derives
 * every window from the profile it is given: one revolution at `run_mrpm`, one pad pitch, one
 * pushbutton stroke, one relay stroke, or a small multiple. It never pins a speed, angle or time.
 * The only literal numbers are the 16-pad, 22.5-degree dial geometry (rotary.md §1, [verified]).
 * Pure and deterministic: same profile in, same result out.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Command, CordEnd, Event, Machine, Sect } from '../src/core/contract.ts';
import { createMachine } from '../src/core/machine.ts';
import { loadNetlist } from '../src/core/netlist.ts';
import type { Profile } from '../src/core/profile.ts';
import { parseTerminalId } from '../src/core/terminals.ts';

export interface ClaimResult {
  readonly pass: boolean;
  readonly detail: string;
}

export interface MotorClaim {
  readonly id: string;
  readonly program: string;
  readonly cite: string;
  readonly quote: string;
  readonly check: (profile: Profile) => ClaimResult;
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NETLIST = loadNetlist(new Uint8Array(readFileSync(ROOT + 'data/netlist.json')));

interface CorpusProgram {
  id: string;
  wiresEffective: string[] | null;
  answers: { n: number; wires: string[] }[] | null;
}
const CORPUS = (JSON.parse(readFileSync(ROOT + 'test/conformance/corpus/programs.json', 'utf8')) as {
  programs: CorpusProgram[];
}).programs;

function program(id: string): CorpusProgram {
  const p = CORPUS.find((q) => q.id === id);
  if (p === undefined) throw new Error('motor-claims: no corpus program ' + id);
  return p;
}

function wiresOf(id: string): readonly string[] {
  const w = program(id).wiresEffective;
  if (w === null) throw new Error('motor-claims: ' + id + ' has no wiresEffective');
  return w;
}

function answerWires(n: number): readonly string[] {
  const a = program('I-PROBLEMS').answers?.find((q) => q.n === n);
  if (a === undefined) throw new Error('motor-claims: I-PROBLEMS has no Answer ' + n);
  return a.wires;
}

// rotary.md §1 [verified]: sixteen equally spaced positions, 360/16 = 22.5 degrees per pitch.
const FULL_UDEG = 360_000_000;
const PITCH_UDEG = FULL_UDEG / 16;

type Lamp = 'off' | 'dim' | 'on';

/** One Machine, the profile-derived windows, and every event seen so far. */
class Rig {
  readonly m: Machine;
  readonly p: Profile;
  /** Ticks in one revolution at `run_mrpm` (rpm x 1000). */
  readonly rev: number;
  /** Ticks in one pad pitch at `run_mrpm`. */
  readonly pitch: number;
  /** Two pushbutton strokes: any press or release finishes and settles. */
  readonly buttonSettle: number;
  /** Four operate plus four release relay strokes. */
  readonly relaySettle: number;
  /** One revolution at the hand rate. */
  readonly handRev: number;
  /** The quiet window `rest` looks for: two pitches plus a relay settle. */
  readonly quiet: number;
  private cords: string[];
  /** Every event drained so far, in order; `mark()` and `since()` cut windows out of it. */
  private all: Event[] = [];

  constructor(p: Profile, wires: readonly string[]) {
    this.p = p;
    this.m = createMachine(NETLIST, p);
    this.rev = Math.ceil((60_000_000 * 1000) / (p.v.run_mrpm * p.v.tick_us));
    this.pitch = Math.ceil(this.rev / 16);
    this.buttonSettle = 2 * p.derived.pushbuttonTicks;
    this.relaySettle = 4 * (p.derived.relayOperateTicks + p.derived.relayReleaseTicks);
    this.handRev = Math.ceil((60_000_000 * 1000) / (p.v.hand_slew_mrpm * p.v.tick_us));
    this.quiet = 2 * this.pitch + this.relaySettle;
    this.cords = [...wires];
    wires.forEach((w, cord) => this.connect(cord, w));
  }

  private connect(cord: number, w: string): void {
    const [a, b] = w.split('/') as [string, string];
    const end = (t: string): CordEnd => (t === 'free' ? { k: 'free' } : { k: 'touch', term: parseTerminalId(t) });
    this.apply({ k: 'connect', cord, a: end(a), b: end(b) });
  }

  apply(c: Command): void {
    const r = this.m.apply(c);
    if (!r.ok) throw new Error('motor-claims: command rejected: ' + JSON.stringify(c) + ' ' + r.why);
  }

  /** Re-plug the cord printed as `from` (e.g. `M10/free`) as `to` (e.g. `M10/6com`). */
  replug(from: string, to: string): void {
    const cord = this.cords.indexOf(from);
    if (cord < 0) throw new Error('motor-claims: no cord ' + from);
    this.apply({ k: 'disconnect', cord });
    this.connect(cord, to);
    this.cords[cord] = to;
  }

  /** Advance and return the events of this window only (they also join the running log). */
  run(ticks: number): Event[] {
    this.m.advance(ticks);
    const ev = this.m.drainEvents();
    this.all.push(...ev);
    return ev;
  }

  mark(): number {
    return this.all.length;
  }

  since(mark: number): readonly Event[] {
    return this.all.slice(mark);
  }

  power(): void {
    this.apply({ k: 'power', on: true });
    this.run(1);
  }

  button(n: Sect, down: boolean): void {
    this.apply({ k: 'button', n, target: down ? 1000 : 0 });
    this.run(this.buttonSettle);
  }

  press(n: Sect): void {
    this.button(n, true);
    this.button(n, false);
  }

  udeg(): number {
    return this.m.snapshot().dial.udeg;
  }

  contact(): number | null {
    return this.m.snapshot().dial.contact;
  }

  lamp(n: Sect): Lamp {
    return this.m.snapshot().outLamps[n - 1]!.cls;
  }

  lamps(ns: readonly Sect[]): Lamp[] {
    return ns.map((n) => this.lamp(n));
  }

  /** True when `ticks` pass with no dial edge and the knob angle unchanged. */
  still(ticks: number): boolean {
    const u = this.udeg();
    return !this.run(ticks).some(isDial) && this.udeg() === u;
  }

  /** Advance in quiet windows until one is still, within `cap` ticks; false if it never rests. */
  rest(cap: number): boolean {
    for (let spent = 0; spent < cap; spent += this.quiet) {
      if (this.still(this.quiet)) return true;
    }
    return false;
  }

  /** Advance one tick at a time until `pred` holds, within `cap` ticks. */
  until(pred: () => boolean, cap: number): boolean {
    for (let t = 0; t < cap; t++) {
      if (pred()) return true;
      this.run(1);
    }
    return pred();
  }

  /** Set the knob by hand onto pad `pos` and let go. */
  set(pos: number): boolean {
    const raw = (this.p.v.wiper_offset_udeg + pos * PITCH_UDEG) % FULL_UDEG;
    const target = raw < 0 ? raw + FULL_UDEG : raw;
    this.apply({ k: 'dialGrab', targetUdeg: target });
    const there = this.until(() => this.udeg() === target, 2 * this.handRev);
    this.apply({ k: 'dialRelease' });
    this.run(this.relaySettle);
    return there;
  }
}

function isDial(e: Event): boolean {
  return e.k === 'dial.make' || e.k === 'dial.break';
}

function pos(c: number | null): string {
  return c === null ? 'a gap' : String(c);
}

function ok(detail: string): ClaimResult {
  return { pass: true, detail };
}

function no(detail: string): ClaimResult {
  return { pass: false, detail };
}

/** Lamp-on edges of output lamps in `ns`, in order, with consecutive repeats folded. */
function lampOnOrder(events: readonly Event[], ns: readonly Sect[]): number[] {
  const out: number[] = [];
  for (const e of events) {
    if (e.k === 'lamp.on' && e.kind === 'out' && ns.includes(e.n) && out[out.length - 1] !== e.n) out.push(e.n);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Book I

function exp13(p: Profile): ClaimResult {
  // The dial starts at D0: the power-off construction state (architecture §13.4.3).
  const r = new Rig(p, wiresOf('I-EXP13'));
  const start = r.contact();
  r.power();
  const t0 = r.mark();
  r.button(5, true);
  r.until(() => lampOnOrder(r.since(t0), [5, 6]).length >= 2, r.rev + r.pitch);
  const order = lampOnOrder(r.since(t0), [5, 6]);
  const from = 'from ' + pos(start);
  if (order.length === 0) return no(from + ': neither light came on');
  if (order[0] !== 5) return no(from + ': light 6 came on first');
  if (order.length < 2) return no(from + ': light 6 never came on');
  return ok(from + ': light 5 then light 6');
}

function exp12(p: Profile): ClaimResult {
  const r = new Rig(p, wiresOf('I-EXP12'));
  r.power();
  r.button(5, true);
  if (r.still(r.rev)) return no('pb5 did not run the dial');
  r.button(6, true);
  if (!r.rest(r.rev) || !r.still(r.rev)) return no('pb5+pb6 did not stop it');
  r.button(6, false);
  if (r.still(r.rev)) return no('releasing pb6 did not run it again');
  r.button(5, false);
  if (!r.rest(r.rev) || !r.still(r.rev)) return no('releasing pb5 did not stop it');
  return ok('runs, stops, runs, stops');
}

/** Problem 14's truth table: the dial turns only for pb6 down with pb5 up. */
function problem14(wires: readonly string[]): (p: Profile) => ClaimResult {
  return (p) => {
    const wrong: string[] = [];
    for (const [pb5, pb6] of [[false, false], [false, true], [true, false], [true, true]] as const) {
      const r = new Rig(p, wires);
      r.power();
      r.button(5, pb5);
      r.button(6, pb6);
      r.rest(r.rev);
      const turns = !r.still(r.rev);
      if (turns !== (pb6 && !pb5)) {
        wrong.push('pb5 ' + (pb5 ? 'dn' : 'up') + ' pb6 ' + (pb6 ? 'dn' : 'up') + (turns ? ' turns' : ' still'));
      }
    }
    return wrong.length === 0 ? ok('turns only for pb6 down, pb5 up') : no(wrong.join('; '));
  };
}

// ---------------------------------------------------------------------------------------------
// Books V-VI

const FLOOR_LAMPS = [1, 2, 3] as const;

/** Push a floor button and check the elevator rests on one of `pads` with only `lamp` lit. */
function trip(r: Rig, button: Sect, pads: readonly number[], lamp: Sect): string | null {
  r.press(button);
  const rested = r.rest(3 * r.rev);
  const at = r.contact();
  const lit = r.lamps(FLOOR_LAMPS);
  const want = FLOOR_LAMPS.map((n) => (n === lamp ? 'on' : 'off'));
  const label = 'pb' + button + ' -> ' + pos(at) + ' lights ' + lit.join('/');
  if (!rested) return 'pb' + button + ': never came to rest';
  if (at === null || !pads.includes(at)) return label;
  if (lit.join() !== want.join()) return label;
  return null;
}

function elevatorAtD0(p: Profile): Rig | ClaimResult {
  const r = new Rig(p, wiresOf('V-EXP9'));
  if (!r.set(0)) return no('could not set the knob at D0');
  r.power();
  r.run(r.relaySettle);
  if (!r.still(r.quiet) || r.contact() !== 0) return no('did not hold at D0 after power-on (' + pos(r.contact()) + ')');
  if (r.lamps(FLOOR_LAMPS).join() !== 'on,off,off') return no('at D0 lights ' + r.lamps(FLOOR_LAMPS).join('/'));
  return r;
}

function exp9FloorTwo(p: Profile): ClaimResult {
  const r = elevatorAtD0(p);
  if (!(r instanceof Rig)) return r;
  const bad = trip(r, 2, [6, 7], 2);
  if (bad !== null) return no(bad);
  return ok('pb2 -> rests on ' + pos(r.contact()) + ', light 2 only');
}

function exp9ThreeThenTwo(p: Profile): ClaimResult {
  const r = elevatorAtD0(p);
  if (!(r instanceof Rig)) return r;
  const up = trip(r, 3, [12, 13], 3);
  if (up !== null) return no(up);
  const first = pos(r.contact());
  const down = trip(r, 2, [6, 7], 2);
  if (down !== null) return no('pb3 -> ' + first + '; ' + down);
  return ok('pb3 -> ' + first + ', pb2 -> ' + pos(r.contact()) + ', one light each');
}

function tictactoe(p: Profile): ClaimResult {
  // Starts at D0, the construction state (architecture §13.4.3); the page states no start and says "always".
  const r = new Rig(p, wiresOf('VI-TICTACTOE'));
  r.power();
  r.replug('M10/free', 'M10/6com');
  r.run(r.relaySettle);
  // "Push pushbutton 6 and hold pushbutton 6 down while you push pushbutton 1 ... Release both pushbuttons 1 and 6."
  r.button(6, true);
  r.button(1, true);
  if (!r.rest(3 * r.rev)) return no('never came to rest with pb1 and pb6 held');
  const at = r.contact();
  r.apply({ k: 'button', n: 1, target: 0 });
  r.apply({ k: 'button', n: 6, target: 0 });
  r.run(r.buttonSettle);
  const stays = r.still(r.rev) && r.contact() === at;
  if (at !== 9) return no('stopped at ' + pos(at));
  if (!stays) return no('stopped at 9, then moved after pb1 and pb6 released (now ' + pos(r.contact()) + ')');
  return ok('stopped at 9');
}

function exp5(p: Profile): ClaimResult {
  const r = new Rig(p, wiresOf('V-EXP5'));
  const rgb = [4, 5, 6] as const;
  r.power();
  if (!r.rest(2 * r.rev)) return no('never came to rest at power-on');
  if (r.lamps(rgb).join() !== 'on,off,off') return no('power-on lights 4/5/6 ' + r.lamps(rgb).join('/'));
  r.apply({ k: 'button', n: 5, target: 1000 });
  const green = r.until(() => r.lamp(4) === 'off' && r.lamp(6) === 'on', 2 * r.rev);
  r.button(5, false);
  if (!green) return no('holding pb5 never gave green with red off');
  const t0 = r.mark();
  const rested = r.rest(2 * r.rev);
  // Green is already lit at release; fold away its own re-lights across the D7-D13 pad gaps.
  const order = lampOnOrder(r.since(t0), rgb);
  while (order[0] === 6) order.shift();
  const end = r.lamps(rgb).join('/');
  if (!rested) return no('never came to rest after green');
  if (order.join() !== '5,4' || end !== 'on/off/off') return no('after green: on-order ' + (order.join('>') || 'none') + ', rests ' + end);
  return ok('red; pb5 -> green; then amber, red');
}

function tugOfWar(p: Profile): ClaimResult {
  const stop = [7, 8, 9];
  const got: string[] = [];
  let pass = true;
  for (const [pb1, pb6] of [[false, false], [true, true], [false, true], [true, false]] as const) {
    const r = new Rig(p, wiresOf('VI-TUGOFWAR'));
    r.power();
    r.rest(2 * r.rev);
    r.button(1, pb1);
    r.button(6, pb6);
    r.run(r.relaySettle);
    // "Push pushbutton 4 ... Release pushbutton 4 as the rotary switch knob starts to turn."
    r.apply({ k: 'button', n: 4, target: 1000 });
    r.until(() => {
      const c = r.contact();
      return c !== null && !stop.includes(c);
    }, r.rev);
    r.button(4, false);
    const rested = r.rest(2 * r.rev) && r.still(r.rev);
    const at = r.contact();
    const want = pb1 === pb6 ? 9 : 7;
    const tag = (pb1 === pb6 ? 'same' : 'diff') + '->' + (rested ? pos(at) : 'running');
    got.push(tag);
    if (!rested || at !== want) pass = false;
  }
  return { pass, detail: got.join(' ') };
}

function exp8(p: Profile): ClaimResult {
  const r = new Rig(p, wiresOf('V-EXP8'));
  const floor = [5, 6] as const;
  r.power();
  const steps: [Sect, number, string][] = [[5, 1, 'on,off'], [6, 7, 'off,on'], [5, 1, 'on,off']];
  const seen: string[] = [];
  for (const [b, want, lights] of steps) {
    r.press(b);
    const rested = r.rest(3 * r.rev);
    const at = r.contact();
    seen.push('pb' + b + '->' + (rested ? pos(at) : 'running'));
    if (!rested || at !== want || r.lamps(floor).join() !== lights) {
      return no(seen.join(' ') + ' lights 5/6 ' + r.lamps(floor).join('/'));
    }
  }
  return ok(seen.join(' '));
}

function trainGateAtZero(p: Profile): Rig | ClaimResult {
  const r = new Rig(p, wiresOf('V-EXP7'));
  r.power();
  if (!r.set(0)) return no('could not set the knob at 0');
  if (!r.rest(r.rev) || r.contact() !== 0) return no('did not hold at 0 (gate up): ' + pos(r.contact()));
  return r;
}

function exp7Closes(p: Profile): ClaimResult {
  const r = trainGateAtZero(p);
  if (!(r instanceof Rig)) return r;
  // Book V p.9 steps 1-5, left to right; the gate must reach 7 at step 1 and hold it through 5.
  const steps: [string, Sect, boolean][] = [
    ['1', 4, true], ['2', 5, true], ['3', 4, false], ['4', 6, true], ['5', 5, false],
  ];
  let held = -1;
  for (const [step, n, down] of steps) {
    r.button(n, down);
    const rested = r.rest(2 * r.rev);
    if (!rested || r.contact() !== 7) return no('step ' + step + ': ' + (rested ? 'at ' + pos(r.contact()) : 'running'));
    if (step === '1') held = r.mark();
  }
  if (r.since(held).some(isDial)) return no('gate left 7 between steps 2 and 5');
  return ok('closed (7) from step 1 through step 5');
}

function exp7Centre(p: Profile): ClaimResult {
  const r = trainGateAtZero(p);
  if (!(r instanceof Rig)) return r;
  const t0 = r.mark();
  r.button(5, true);
  r.run(r.rev); // held a full revolution; a gate-closing switch (pb4 or pb6) reaches 7 well inside this
  r.button(5, false);
  r.rest(2 * r.rev);
  const reached = r.since(t0).some((e) => e.k === 'dial.make' && e.pos === 7) || r.contact() === 7;
  return reached ? no('pb5 alone closed the gate') : ok('pb5 alone: gate stays at ' + pos(r.contact()));
}

// ---------------------------------------------------------------------------------------------

export const MOTOR_CLAIMS: readonly MotorClaim[] = Object.freeze([
  {
    id: 'I-EXP13/light-5-before-light-6',
    program: 'I-EXP13',
    cite: 'Book I printed p.23 (book1.pdf PDF p.25), Experiment 13 step 3',
    quote: 'Push pushbutton 5. The motor rotates the pointer knob as in Experiment 11. As the pointer knob turns, '
      + 'light 5 and light 6 flash ON in sequence. The rotary switch is automatically generating electrical pulses '
      + 'to flash the lights. First, light 5 flashes and then light 6 flashes, once each revolution of the rotary switch.',
    check: exp13,
  },
  {
    id: 'I-EXP12/pb6-stops-release-runs',
    program: 'I-EXP12',
    cite: 'Book I printed p.23 (book1.pdf PDF p.25), Experiment 12 steps 2-5',
    quote: 'Turn the power ON. Push pushbutton 5. This supplies power to the RUN terminals (D17 and D18) and causes '
      + 'the pointer of the rotary switch to rotate. / While holding pushbutton 5 down, push pushbutton 6. The motor '
      + 'stops when pushbutton 6 is pushed because a short circuit is created across the STOP terminals (D18 and D19). '
      + '/ While holding pushbutton 5 down, release pushbutton 6. The motor drive operates again because the short '
      + 'circuit has been removed. / Release pushbutton 5. The motor drive again stops, this time because power is no '
      + 'longer connected to the motor circuit.',
    check: exp12,
  },
  {
    id: 'I-PROBLEMS/answer-14-turns-only-pb6',
    program: 'I-PROBLEMS',
    cite: 'Book I printed p.28 (book1.pdf PDF p.30) problem 14; printed p.31 (PDF p.33) Answer 14 wiring',
    quote: 'Design a circuit in which the rotary switch turns only when pushbutton 6 is down. The rotary switch should '
      + 'NOT turn when pushbutton 6 is up, or when both pushbutton 6 and pushbutton 5 are down.',
    check: problem14(answerWires(14)),
  },
  {
    id: 'I-PROBLEMS/answer-15-turns-only-pb6',
    program: 'I-PROBLEMS',
    cite: 'Book I printed p.28 (book1.pdf PDF p.30) problems 14-15; printed p.31 (PDF p.33) Answer 15 wiring',
    quote: 'Design a circuit in which the rotary switch turns only when pushbutton 6 is down. The rotary switch should '
      + 'NOT turn when pushbutton 6 is up, or when both pushbutton 6 and pushbutton 5 are down. / Design a circuit to '
      + 'meet the requirements of problem 14 using terminal 5X.',
    check: problem14(answerWires(15)),
  },
  {
    id: 'V-EXP9/floor-1-to-floor-2',
    program: 'V-EXP9',
    cite: 'Books V-VI printed p.11 (book5-6.pdf PDF p.17) steps 1-9 and floor table; printed p.12 (PDF p.18) '
      + 'operation; errata ER-31 program corrections (errata.pdf PDF p.3)',
    quote: 'Set the "elevator" at the first floor by setting the pointer knob at D0. Turn power on. Output light 1 '
      + 'will come on indicating the location of the "elevator". / To direct the "elevator" to the second floor, push '
      + 'pushbutton 2. / Floor 2 | pushbutton 2 | output light 2 | D6-D7 / Whenever a pushbutton is pushed, the '
      + 'system will go through the following steps: / 7. The "elevator" will continue to move to its stored '
      + 'destination. 8. When it reaches the stored destination, the "elevator" will stop and clear the destination '
      + 'from its memory.',
    check: exp9FloorTwo,
  },
  {
    id: 'V-EXP9/floor-3-then-floor-2',
    program: 'V-EXP9',
    cite: 'Books V-VI printed p.12 (book5-6.pdf PDF p.18) operation; printed p.11 (PDF p.17) floor table; '
      + 'errata ER-31 program corrections (errata.pdf PDF p.3)',
    quote: 'Set the "elevator" at the first floor by setting the pointer knob at D0. Turn power on. Output light 1 '
      + 'will come on indicating the location of the "elevator". To call the "elevator" to the third floor, push '
      + 'pushbutton 3. To direct the "elevator" to the second floor, push pushbutton 2. / Floor 2 | pushbutton 2 | '
      + 'output light 2 | D6-D7 / Floor 3 | pushbutton 3 | output light 3 | D12-D13',
    check: exp9ThreeThenTwo,
  },
  {
    id: 'VI-TICTACTOE/first-move-centre',
    program: 'VI-TICTACTOE',
    cite: 'Books V-VI printed p.55 (book5-6.pdf PDF p.61) rule; printed p.56 (PDF p.62) procedure; '
      + 'centre = 9 per programs.md (ring 1-2-3 / 8-9-4 / 7-6-5); start D0 is the construction state, not printed '
      + '(programs.md §1)',
    quote: 'This program requires that MINIVAC make the first move; the machine\'s first move will always be to the '
      + 'center of the game matrix. / Turn power ON. Place the free end of the machine\'s "play" wire in 6 com. Push '
      + 'pushbutton 6 and hold pushbutton 6 down while you push pushbutton 1. The pointer knob will turn to indicate '
      + 'the machine\'s first move. Release both pushbuttons 1 and 6.',
    check: tictactoe,
  },
  {
    id: 'V-EXP5/red-green-amber-red',
    program: 'V-EXP5',
    cite: 'Books V-VI printed p.6 (book5-6.pdf PDF p.12) "To use the program"; program printed p.5 (PDF p.11)',
    quote: 'Turn power on. The "red" light (light 4) comes ON. To cross the street: push pushbutton 5 until the "red" '
      + 'light (light 4) goes OFF and the "green light" (light 6) comes ON. After the light has turned green, it will '
      + 'go to amber (light 5) and return to red again.',
    check: exp5,
  },
  {
    id: 'VI-TUGOFWAR/same-9-different-7',
    program: 'VI-TUGOFWAR',
    cite: 'Books V-VI printed p.56 (book5-6.pdf PDF p.62) rules; printed p.57 (PDF p.63) program and start',
    quote: 'If the dial stops at 9, player 1 wins; if the dial stops at 7, player 2 wins. / Player 1 uses pushbutton '
      + '1; player 2 uses pushbutton 6. The rotary switch knob turns: counterclockwise (towards 9) if pushbuttons 1 '
      + 'and 6 are in the same position (both up or both down.) clockwise (towards 7) if pushbuttons 1 and 6 are in '
      + 'different positions. / Push pushbutton 4; this is the re-set button. Release pushbutton 4 as the rotary '
      + 'switch knob starts to turn. / The game ends when the pointer knob stops—either at 9 (player 1 wins) or at 7 '
      + '(player 2 wins).',
    check: tugOfWar,
  },
  {
    id: 'V-EXP8/call-7-return-1',
    program: 'V-EXP8',
    cite: 'Books V-VI printed p.10 (book5-6.pdf PDF p.16) floor map; printed p.11 (PDF p.17) procedure; '
      + 'errata ER-30 (errata.pdf PDF p.3)',
    quote: 'The rotary switch dial at 1 indicates that the elevator is at the first floor; the dial at 7 indicates '
      + 'that the elevator is at the second floor. Similarly, binary output light 5 on indicates that the elevator is '
      + 'at the first floor; binary output light 6 on indicates that the elevator is at the second floor. / Set the '
      + '\'elevator\' at the first floor by pushing pushbutton 5. / To call the "elevator" to the second floor, push '
      + 'pushbutton 6. The "elevator" will immediately move to the second floor (the pointer knob will point to 7). '
      + 'To return the "elevator" to the first floor, push pushbutton 5.',
    check: exp8,
  },
  {
    id: 'V-EXP7/first-switch-closes-gate',
    program: 'V-EXP7',
    cite: 'Books V-VI printed p.9 (book5-6.pdf PDF p.15) procedure; printed p.10 (PDF p.16) observation',
    quote: 'Turn power on and set the pointer knob of the rotary switch at 0. The rotary switch at 0 represents the '
      + 'gate up. / 1. Push pushbutton 4. 2. While holding pushbutton 4 down, push pushbutton 5. 3. Hold pushbutton 5 '
      + 'down and release pushbutton 4. 4. While holding pushbutton 5 down, push pushbutton 6. 5. Hold pushbutton 6 '
      + 'down and release pushbutton 5. / Notice that the gate closes (the pointer knob moves to the "gate closed" '
      + 'position—7) as soon as the first switch is activated and remains closed until none of the switches is activated',
    check: exp7Closes,
  },
  {
    id: 'V-EXP7/centre-switch-no-close',
    program: 'V-EXP7',
    cite: 'Books V-VI printed p.9 (book5-6.pdf PDF p.15) setup; printed p.10 (PDF p.16) centre switch',
    quote: 'Turn power on and set the pointer knob of the rotary switch at 0. The rotary switch at 0 represents the '
      + 'gate up. / Push pushbutton 5. This represents a car passing over the center of the crossing. Notice that the '
      + 'gate does not close.',
    check: exp7Centre,
  },
]);
