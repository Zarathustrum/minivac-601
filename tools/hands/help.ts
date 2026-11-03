/**
 * Help text for `minivac-control`. The terminal glossary's device-to-terminal table is read out of
 * the loaded netlist (`data/netlist.json`) rather than typed in, so it cannot drift from what the
 * simulator wires; the prose around it cites `docs/research/jack-map.md` and the manuals it quotes.
 */
import type { LoadedNetlist, NetContact, NetElement } from '../../src/core/netlist.ts';
import type { Profile } from '../../src/core/profile.ts';
import { TERMINALS } from '../../src/core/terminals.ts';
import { OBSERVABLES } from '../../src/core/trace.ts';
import { DEFAULT_PROFILE, DEFAULT_SETTLE_MS, MAX_STEP_MS, PATH_LIMIT, PRESS_MS } from '../../src/hands/table.ts';

function holes(id: string): number {
  const def = TERMINALS.find((row) => row.id === id);
  if (def === undefined) fail('no terminal ' + id);
  return def.holes;
}

/** `relay1` -> `nc|mid|no`; the dial's 17 values as `gap|c0..c15`. */
function values(name: string): string {
  const row = OBSERVABLES.find((entry) => entry.name === name);
  if (row === undefined) fail('no observable ' + name);
  const v = row.values;
  return name === 'dial' ? v[0] + '|' + v[1] + '..' + v[v.length - 1] : v.join('|');
}

/** `67500000` -> `67.5`. */
function deg(udeg: number): string {
  return String(udeg / 1_000_000);
}

/** The main help; the quiet window, hand speed and wiper offset are read from the default profile. */
export function mainHelp(profile: Profile): string {
  const quietMs = profile.v.settle_quiet_ticks * profile.v.tick_us / 1000;
  const handRpm = profile.v.hand_slew_mrpm / 1000;
  const halfTurnMs = Math.round(30_000_000 / profile.v.hand_slew_mrpm);
  const offset = profile.v.wiper_offset_udeg;
  const position3 = deg(3 * 22_500_000 + offset);
  return `minivac-control: operate a simulated Minivac 601 relay computer (1961) from the shell.

The machine is a panel of terminals (jacks). You build a circuit by plugging patch cords between
terminals, switch power on, then press pushbuttons and move slide switches and watch the lamps.

USAGE
  minivac-control new <session.json> [--profile <id>]
      Create an empty session (power off, no cords). Refuses to overwrite. Default profile
      ${DEFAULT_PROFILE}.
  minivac-control <session.json> <command> [args] [+ <command> [args]]... [--settle-ms <n>]
      Apply one or more commands in order, then let the machine settle, then save.
  minivac-control <session.json> state [--json]
      Show the current state. Changes nothing. "state" may also end a batch (... + state): it
      shows the state after that batch settles. Anywhere else in a batch it is refused.
  minivac-control help [terminals]
      This text, or the terminal glossary (what 1+, 1Y, 2A ... are).

  Before wiring anything, read:  minivac-control help terminals

COMMANDS (join several with a lone + between them)
  power on | power off            main power switch (it starts off). A cord straight from a +
                                  to a - terminal trips the circuit breaker (breaker tripped):
                                  everything goes dead until you unplug the short and send
                                  breaker reset. Power off and on does not reset it.
  breaker reset                   push the red CIRCUIT BREAKER button back in (breaker
                                  tripped -> ok). Fix the wiring first or it trips again.
                                  [Book I p.3; the trip model is unverified, architecture 13.4.3]
  connect <A>/<B>                 plug a cord between terminals A and B, e.g. connect 1+/1Y
                                  (prints the cord id; each terminal has a fixed number of holes,
                                  usually 2, and a cord takes one hole at each end)
  connect <A>/free                plug a cord into A only, its other end left hanging free, as for
                                  a program's free-ended leads (M10/free). To touch that end to a
                                  terminal B, disconnect the cord and connect <A>/<B>.
  disconnect <cordId>             unplug cord by id (see: state)
  disconnect <A>/<B>              unplug the one cord between A and B (either order)
  disconnect all                  unplug every cord, to start the wiring over on the same
                                  session. Not for tidying up: a finished circuit stays plugged in.
  button <n> press [ms]           press pushbutton n = 1..6 the way a finger does: down, held
                                  ms (default ${PRESS_MS}), up, then released for the same time.
                                  Use this for an ordinary push; it is logged as down, wait, up, wait.
  button <n> down | up | <0..1000>  move pushbutton n and leave it there. down = pressed. Buttons
                                  spring back in life, but a button sent down stays down until
                                  you send up: use down/up to hold a button while you do
                                  something else.
  switch <n> left | right | <0..1000>  slide switch n = 1..6 (0 = left, 1000 = right). Latching.
  relay <n> hold in | out | <0..1000>  push relay n's crossbar by hand and keep holding it
                                  (relay n = 1..6). in = pulled in (N.O. contacts closed, as if
                                  the coil were energised), out = released (N.C. closed). The
                                  hand wins against the coil until you let go. Book I Exp 6:
                                  "Gently push the relay crossbar to the left. Light 2 goes OFF
                                  and light 1 comes ON." [Book I p.13]. The hand moves it at the
                                  relay's own operate/release speed [unverified].
  relay <n> release               let go of relay n: its coil controls it again
  dial hold <degrees>             turn the rotary dial knob by hand to an angle and hold it
                                  there (0 <= degrees < 360). Position k (observable dial ck) is
                                  centred on k x 22.5 degrees${offset === 0 ? '' : ' + ' + deg(offset)}, 0 at the top, numbers
                                  increasing clockwise: dial hold ${position3} = position 3. The wiper
                                  touches every pad on the way [Book I p.20, p.22]. The hand turns
                                  at ${handRpm} rpm [unverified] (a half turn takes ${halfTurnMs} ms) and settle
                                  does not wait for it, so follow with wait:
                                  dial hold ${position3} + wait 500
  dial release                    let go of the knob: the motor (if wired to run) turns it again
  wait <ms>                       let exactly <ms> milliseconds of simulated time pass
                                  (1..${MAX_STEP_MS} per wait; chain waits for longer)
  load-program <ID>               plug in every wire of a program from the manuals, as connect
                                  would, in one step. <ID> is a program id from
                                  docs/research/programs.md, e.g. I-EXP4, IV-EXP1-SLOW, V-EXP2
                                  (the wire list of test/conformance/fixtures/*/<ID>.fixture.json).
                                  It loads wiring only: it does not power on or press anything.
                                  Use it only when you are asked to load or run a program. When
                                  you are asked to build, make or wire a circuit, plug each wire
                                  yourself with connect, even when you know the program's id.
                                  A suffix marks a variant of one program. <ID>-DERIVED has the
                                  same wires as <ID>, with expectations derived from the wiring,
                                  not printed [docs/plans/phase-5-corpus.md Step 7]. IV-EXP1-FAST,
                                  -SLOW and -DERIVED share one wire list: load any. A few variants
                                  change the wiring (IV-FF2-CARRY, V-EXP10-5L6G, V-EXP16-5X6E).

  Example (Book I experiment 4: two pushbuttons in series with lamp 2):
    minivac-control new s.json
    minivac-control s.json connect 1+/1Y + connect 1X/2Y + connect 2X/2A + connect 2B/2- + power on
    minivac-control s.json button 1 down + button 2 down + state

HOW TIME PASSES
  Time only moves when you tell it to. Commands themselves take zero time. After every batch the
  machine runs until nothing has changed and nothing is moving for the profile's quiet window
  (${quietMs} ms in ${profile.id}) of simulated time ("settled"), or until the cap of
  ${DEFAULT_SETTLE_MS} ms (--settle-ms <n> to change it, at most ${MAX_STEP_MS}). A relay takes some
  milliseconds to pull in. A circuit that keeps moving (e.g. a relay buzzing) is reported as
  "did NOT settle", which is not an error. Two things settle does not wait for, each reported
  with a "note:" line when it happens:
    - the dial: a dial turning under the motor or your hand can settle between two contact
      changes ("note: dial motor still turning", "note: dial still turning by hand");
    - lamp filaments: a lamp just switched off can still be cooling through dim, or one just
      switched on still warming ("note: lamp(s) ... still warming/cooling").
  Use wait to let more time run. Commands in one batch with no wait between them land on the
  same instant: "button 1 down + button 1 up" presses nothing. Use button 1 press, or
    button 1 down + wait 50 + button 1 up
  "state" does not advance time.

OUTPUT
  One line per command (ok, or the reason it was refused), then the settle outcome, then every
  observable whose value changed during the call, as "changed: <name> <old> -> <new>" (with any
  in-between values, e.g. "changed: pb1 nc -> mid -> no"). A path of more than ${PATH_LIMIT} changes is
  shortened to first and last value plus a count: "changed: relay1 nc -> ... -> mid (57 changes)".
  Observables (the same names the conformance fixtures use):
    power ${values('power')}, breaker ${values('breaker')}
    relay1..6 ${values('relay1')}      nc = released (N.C. contacts closed), no = pulled in
    pb1..6 ${values('pb1')}         pushbutton: nc = up, no = pressed
    sw1..6 ${values('sw1')}         slide switch: nc = left, no = right
    dial ${values('dial')}         rotary dial: which contact the wiper is on
    outLamp1..6 ${values('outLamp1')}   the six output lamps (top row)
    indLamp1..6 ${values('indLamp1')}   the six relay indicator lamps
  mid means the contacts are between positions (in travel).

SESSIONS
  The session file is a replayable log of every accepted command and time step. Each call
  rebuilds the machine from it, so a session is exactly reproducible. A batch is all-or-nothing:
  if any command is refused, nothing is saved and the exit code is 1.
  A changing call holds <session>.lock while it runs; a second call on the same session fails.

EXIT CODES
  0 success (including "did NOT settle"); 1 any error. Errors go to stderr.
`;
}

function fail(message: string): never {
  throw new Error('help: ' + message);
}

/** `3X` -> `nX` when it belongs to section `section`. */
function pattern(id: string, section: number): string {
  if (!id.startsWith(String(section))) fail(id + ' is not in section ' + section);
  return 'n' + id.slice(1);
}

function element(netlist: LoadedNetlist, id: string): NetElement {
  const found = netlist.elements.find((row) => row.id === id);
  if (found === undefined) fail('netlist has no element ' + id);
  return found;
}

type SpdtContact = Exclude<NetContact, { k: 'wiper' }>;

function contact(netlist: LoadedNetlist, k: SpdtContact['k'], n: number, set: number | null): SpdtContact {
  const found = netlist.contacts.find((row): row is SpdtContact =>
    row.k === k && row.n === n && (set === null || ('set' in row && row.set === set)));
  if (found === undefined) fail('netlist has no ' + k + ' contact ' + n + '/' + String(set));
  return found;
}

/** Per-section terminal roles as `n`-patterns, read from section 1 and checked in sections 2..6. */
function sectionRoles(netlist: LoadedNetlist): Record<string, string[]> {
  const roles = (n: number): Record<string, string[]> => {
    const out = element(netlist, 'out' + n);
    const ind = element(netlist, 'ind' + n);
    const coil = element(netlist, 'coil' + n);
    const r1 = contact(netlist, 'relay', n, 1);
    const r2 = contact(netlist, 'relay', n, 2);
    const pb = contact(netlist, 'button', n, null);
    const s1 = contact(netlist, 'slide', n, 1);
    const s2 = contact(netlist, 'slide', n, 2);
    const p = (ids: string[]): string[] => ids.map((id) => pattern(id, n));
    return {
      outLamp: p([out.a, out.b]),
      indLamp: p([ind.a, ind.b]),
      coil: p([coil.a, coil.b]),
      relay1: p([r1.arm, r1.nc, r1.no]),
      relay2: p([r2.arm, r2.nc, r2.no]),
      button: p([pb.arm, pb.nc, pb.no]),
      slide1: p([s1.arm, s1.nc, s1.no]),
      slide2: p([s2.arm, s2.nc, s2.no]),
    };
  };
  const first = roles(1);
  for (let n = 2; n <= 6; n++) {
    if (JSON.stringify(roles(n)) !== JSON.stringify(first)) fail('section ' + n + ' differs from section 1');
  }
  return first;
}

export function terminalsHelp(netlist: LoadedNetlist): string {
  if (holes('M10') !== holes('M11')) fail('M10 and M11 hole counts differ');
  const r = sectionRoles(netlist);
  const [outA, outB] = r['outLamp'] as string[];
  const [indC, indE] = r['indLamp'] as string[];
  const [, coilF] = r['coil'] as string[];
  const [r1Arm, r1Nc, r1No] = r['relay1'] as string[];
  const [r2Arm, r2Nc, r2No] = r['relay2'] as string[];
  const [pbArm, pbNc, pbNo] = r['button'] as string[];
  const [s1Arm, s1Left, s1Right] = r['slide1'] as string[];
  const [s2Arm, s2Left, s2Right] = r['slide2'] as string[];
  const wiper = netlist.contacts.find((row) => row.k === 'wiper');
  if (wiper === undefined || wiper.k !== 'wiper') fail('netlist has no wiper');
  const r1 = element(netlist, 'R1');
  const r2 = element(netlist, 'R2');
  const motor = element(netlist, 'MOT');
  const plus = netlist.plusMembers.join(' ');
  const minus = netlist.minusMembers.join(' ');
  const pads = wiper.pads;

  return `minivac-control help terminals: the panel's terminal names

A wire is two terminal names with a slash: connect 1+/1Y joins terminal 1+ to terminal 1Y.
Every hole of one terminal is the same electrical point. A cord end takes one hole; most
terminals have ${holes('1A')} holes (ncom has ${holes('1com')}, M10 and M11 have ${holes('M10')}), so usually at most ${holes('1A')} cords meet there.
Device-to-terminal roles below are read from this simulator's netlist (data/netlist.json).
The prose follows docs/research/jack-map.md, which takes it from the original documents: Books I
and III (1961), Book VII (1962, a joint 601/6010 manual), the Maintenance Manual and the Errata.
Statements are [verified] there unless tagged here; sources are in brackets.

POWER  nominal 12 V DC supply [jack-map 5; Book I p.3; Maint. pp.2-3]; the two rails are the
       only internal busses [jack-map 4; Errata]
  +   rail: ${plus}   all one point
  -   rail: ${minus}   all one point
  A circuit does something when it runs from a + terminal, through devices, to a - terminal.
  Joining + directly to - is a short and trips the circuit breaker in this simulator (the breaker:
  Book I p.3; Maint. pp.2-3); unplug the short, then send breaker reset.

EACH OF THE SIX SECTIONS, n = 1..6 (write the digit: 1A, 3G, 6Z)
  Output lamp n (top row, BINARY OUTPUT)                       [Book I p.6-7]
    ${outA}, ${outB}      the two ends of output lamp n (observable outLamp<n>). It lights when
                current flows through it from one end to the other: one cord from + (or a
                contact) to ${outA}, another from ${outB} to -. Never join ${outA} to ${outB}: that cord
                bypasses the lamp, and it stays dark.
  Power taps  n+ (PLUS rail), n- (MINUS rail)                    [Book I p.3; Errata]
  Relay n (STORAGE/PROCESSING)                                   [Book I p.12, p.14]
    ${indC}          far end of relay n's indicator lamp (indLamp<n>)
    ${indE}          junction of the indicator lamp and the relay coil
    ${coilF}          far end of the coil
                Coil alone is between ${indE} and ${coilF}. Coil plus indicator lamp in series is
                between ${indC} and ${coilF}. Energise it (+ to one end, - to the other) and the relay
                pulls in (relay<n> goes nc -> no).
                The manuals' usual way to let pushbutton n work relay n is three cords:
                n+/nY, nX/nC, nF/n- (15 programs, e.g. III-RELAYAND, III-RELAYNOT).
    contact set 1: ${r1Arm} ARM, ${r1Nc} N.C. (joined to the arm while released),
                   ${r1No} N.O. (joined to the arm while pulled in)
    contact set 2: ${r2Arm} ARM, ${r2Nc} N.C., ${r2No} N.O.  Same behaviour. The two sets move together
                   but are electrically separate.  [jack-map summary 5, 7, 9]
  Pushbutton n (bottom row, BINARY INPUT)                        [Book I p.8]
    ${pbArm} ARM, ${pbNc} N.C. (joined to the arm while the button is up),
    ${pbNo} N.O. (joined to the arm only while the button is pressed)
  Slide switch n (SECONDARY STORAGE)                             [Book I p.18]
    set 1: ${s1Arm} ARM, ${s1Left} joined to the arm when the switch is LEFT, ${s1Right} when RIGHT
    set 2: ${s2Arm} ARM, ${s2Left} LEFT, ${s2Right} RIGHT. The two sets move together, electrically separate.
  ncom  COMMON: a 4-hole junction connected to nothing (not to the other sections' ncom)
                                                                 [Book I p.25; Book III p.58; Errata]
  ncap  CAPACITOR jack. In this simulator (contract 1.1) it is a bare 2-hole junction with no
        capacitor behind it [docs/plans/architecture.md 2.1]. Book VII (1962, 601/6010) says a
        capacitor joins it to the - rail [Book VII p.11]; whether 1961 601 units had them fitted
        is [unverified] [jack-map 8 row 1, fallback FITTED-CAPS].

RIGHT COLUMN
  M+, M-          more + and - taps (printed as plain + and - on the panel)   [Errata]
  M1t..M9t, M1b..M9b  free 2-hole junctions; a cell's t and b are NOT joined  [Book I p.25]
  M10, M11        free 6-hole junctions, not joined to each other             [Errata]
  ${wiper.arm}             rotary dial wiper ARM. It touches ${pads[0]}..${pads[pads.length - 1]}, one at a time: the
                  pad at the dial's position (observable dial c0..c15; gap = between pads). [Book I p.20]
  ${r1.a}, ${motor.a}, ${motor.b}   dial motor block: resistor R1 between ${r1.a} and ${r1.b}; the motor and resistor R2
                  both between ${motor.a} and ${motor.b} (R2: ${r2.a}/${r2.b}).                  [Maint. p.9 figure]
                  RUN = power across ${r1.a} and ${motor.a} (motor turns the dial);
                  STOP = a cord joining ${motor.a} and ${motor.b} (brakes it).
                                       [jack-map 3, 5; Maint. p.9 figure; Book I p.20, p.22 figures]

There are no other hidden connections [jack-map 4, 5]. Letters D, I, M, O, P, Q are not section
letters [jack-map 1].

Before you wire a circuit of your own: the manuals already give tested wire lists for their
programs (AND, OR, EITHER BUT NOT BOTH, NOT, relay circuits, adders, counters, memories, games).
Search docs/research/programs.md for the behaviour (titles mix case); each program's wire list
is the "wires" field of test/conformance/fixtures/<tier>/<ID>.fixture.json (manifest.json there
lists the paths). Plug those wires with connect, renumbering only the parts your task names.
`;
}
