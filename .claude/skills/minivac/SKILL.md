---
name: minivac
description: Operate the simulated Minivac 601 relay computer through bin/minivac-control - wire patch cords, switch power, press buttons, move switches, read lamps, or build a program from the 1961 manuals. Use only when asked to operate, wire or run the Minivac simulator, not for work on this codebase.
---

# Operating the Minivac 601 simulator

The Minivac 601 (1961, designed by Claude Shannon) is a relay computer for teaching. Its panel has
six numbered sections, each with an output lamp, a relay with an indicator lamp, a pushbutton and a
slide switch, plus a motor-driven rotary dial. Nothing is connected until you plug patch cords
between terminals. A program in the manuals is a list of cords to plug in, then a procedure of
presses and switch moves with the lamps you should see.

You drive it with one shell tool, run from the repo root: `bin/minivac-control`.

Run each `bin/minivac-control` call as its own plain shell command: no `mkdir`, no shell variables,
no `&&`, `;`, pipes or loops, and no other programs. You may be allowed to run only this tool, and
anything else in the same command gets refused. To send several commands at once, use the tool's
own `+` batches (below). Read files (the manuals' index, fixtures) with your file-reading tools,
not the shell.

## The order of work

For a task that asks for a circuit, in words or by name:

1. Read the tool's help and `help terminals` (next section).
2. Find the manual's circuit for the behaviour (see "Before you wire"). Do this even when the circuit
   looks simple: the manuals cover one-lamp circuits too, and wiring from memory is where most
   mistakes come from.
3. Plug its wires yourself with `connect` (one batch is fine), then power on. Do not use
   `load-program` for a circuit task, even once you know the program's id: building means plugging
   the cords yourself.
4. Test it against the task (see "Test a circuit you built").

For a task that says to load or run a program, or gives a procedure, see "Following a procedure".

## First, read the tool's own help

```bash
bin/minivac-control --help             # commands, batches, how time passes, output, exit codes
bin/minivac-control help terminals     # what 1+, 1-, 1A, 1Y, 2X, 3H ... are
```

Read `help terminals` before wiring anything. It says which terminals are lamp ends, relay coil and
contact terminals (ARM, N.C., N.O.), pushbutton and slide-switch contacts, and the + and - rails.

## Wires: the manual's shorthand

A wire is two terminal names with a slash: `1+/1Y` joins terminal 1+ to terminal 1Y. Type the minus
terminals with the ASCII hyphen-minus (`1-`, `M-`); a prompt or a manual may print a typographic
minus sign (U+2212), which the tool does not accept. A lamp lights when current runs from a +
terminal, through the lamp's two ends (nA, nB), to a - terminal; contacts in that path decide when.
Joining + straight to - is a short: it trips the breaker and everything goes dead. Unplug the short,
then `breaker reset`.

## A session

Use the session file your task names, with its full path exactly as given, in every call. In the
examples below `s.json` stands for that path; do not make another file.

```bash
bin/minivac-control new s.json                                       # power off, no cords
bin/minivac-control s.json connect 1+/1Y + connect 1X/2Y + connect 2X/2A + connect 2B/2-
bin/minivac-control s.json power on
bin/minivac-control s.json button 1 down + button 2 down + state
bin/minivac-control s.json button 1 up + button 2 up + button 3 press + state
```

- The session file is a replayable log, rebuilt from scratch on every call. Never edit it by hand.
  Keep it out of the repo (a scratch directory is fine).
- Several commands go in one call joined by a lone `+`. A batch is all or nothing: if one command
  is refused, nothing is saved and the exit code is 1. Fix it and resend the whole batch.
- `connect` prints the cord id it used. `disconnect <cordId>` or `disconnect <A>/<B>` unplugs.
  `disconnect all` unplugs every cord: use it to start the wiring over. `new` never overwrites an
  existing session, so keep using the one you have. Never unplug a finished circuit: the task's
  result is the machine as you leave it, wired.
- `button <n> press` pushes a button the way a finger does: down, held a moment, released. Use it
  for an ordinary push. It ends with the button already up, so never follow it with
  `button <n> up`. `button <n> down` holds a button until you send `button <n> up`; use that only
  when a button must stay held while you do something else.
- `state` may end a batch (`... + state`) to show the machine after it; anywhere else in a batch
  it is refused.
- `switch <n> left|right` moves a slide switch; it stays where you put it.
- `relay <n> hold in|out` pushes a relay's crossbar by hand and keeps holding it; `relay <n> release`
  lets the coil take over again. `dial hold <degrees>` turns the rotary dial by hand (position k is
  k x 22.5 degrees) and holds it; follow it with `wait`, because settle does not wait for the dial.
  `dial release` lets go. `breaker reset` resets a tripped breaker.
- `load-program <ID>` plugs in every wire of a manual program by its id (e.g. `IV-EXP1-SLOW`); it
  does not power on or press anything. An unknown id gets a list of close ids. Suffixed ids are
  variants of one program: `<ID>-DERIVED` has the same wires as `<ID>` (its expectations are
  derived, not printed), and `IV-EXP1-FAST`, `-SLOW`, `-DERIVED` share one wire list, so any loads
  the same cords; `bin/minivac-control --help` names the few variants whose wiring differs.

## How time passes

Simulated time moves only when you let it. After every batch the machine runs until nothing has
changed for a short quiet window ("settled after N ms"), capped at 500 ms (`--settle-ms <n>`).
"did NOT settle" means something is still moving (a relay buzzing, the dial motor); it is not an
error. Two things settle does not wait for, each reported as a `note:` line: the dial motor, and
lamp filaments still warming or cooling (a lamp just switched off can read `dim` for a moment).
When you see a note, use `wait <ms>`. Commands in one batch with no `wait` between them land on
the same instant, so `button 1 down + button 1 up` presses nothing; `button 1 press` does.

```bash
bin/minivac-control s.json button 1 down + wait 50 + button 1 up
bin/minivac-control s.json wait 500
```

`state` changes nothing and does not advance time.

## Confirm with state

`state` lists every observable (`power`, `breaker`, `relay1..6`, `pb1..6`, `sw1..6`, `dial`,
`outLamp1..6`, `indLamp1..6`) and every plugged cord with its id and terminal pair. Check it after
wiring (is every cord where you meant it?) and after each input change (did the lamp do what the
task asks?).

## Before you wire: find the manual's circuit

The manuals already hold a tested circuit for most things you will be asked to build. Look for it
before you design anything, and design your own only when nothing matches. Your own design is
where most wrong wiring comes from.

1. Name the behaviour in the manuals' words: AND (a series circuit, "only when both"), OR (a
   parallel circuit, "either one"), EITHER BUT NOT BOTH (exclusive or), NOT, adder, counter,
   memory, flip-flop, alarm, game. A circuit built on relays has "Relay" in its title.
2. Search `docs/research/programs.md` for those words, ignoring case (titles mix capitals and
   lower case). The file is thousands of lines long: search it, do not read it whole. The index
   tables near the top give each program's id, title and wire count. Pick the entry whose title
   and parts (pushbuttons, slide switches, relays) fit the task, and prefer the smallest one that
   does the whole job.
3. Find that program's fixture: `grep` `test/conformance/fixtures/manifest.json` for the id; the
   match gives the path under `test/conformance/fixtures/`, such as `A/<ID>.fixture.json`. Read
   that fixture; it is short. Its `wires` field is the wire list to plug in (errata already applied; prefer it to
   `as_printed`), and its `script` is the procedure, with each expected lamp state and the manual
   sentence it rests on. An expect tagged `"tag": "unverified"` is derived, not printed, and the
   `*-DERIVED` fixtures are derived throughout: prefer the plain `<ID>` fixture.
4. If the task names other buttons, switches or lamps than the program uses, keep the program's
   circuit and change only those terminal numbers.

Use `load-program` only when the task itself says "load" or "run" a program. Any task that
describes a circuit or what the lamps should do ("build", "make", "wire", or a behaviour in words)
is a wiring task: plug every cord yourself with `connect`, even when a manual program matches.
`connect` every wire in the fixture's `wires` yourself (one batch is fine), then power on. For a
load task, `load-program <ID>`, power on and follow its procedure.

## Test a circuit you built before you finish

When you have wired a circuit, test it against the task before you stop:

1. List every combination of the inputs the task names, including none pressed. Two buttons give
   four: none, the first only, the second only, both. A slide switch counts as an input with two
   positions.
2. For each combination, set it up (hold buttons with `button <n> down`), end that batch with
   `state`, and compare every lamp the task mentions with what the task asks for.
3. Release every held button (`button <n> up`) before the next combination.
4. If any lamp is wrong, the wiring is wrong. Compare the cords in `state` with the program's
   `wires`, fix the difference, and test every combination again.

Finish only when every combination matches the task, and leave the circuit plugged in and the
power on. This is for circuits you build.

## Following a procedure

When the task says to load or run a program, or to do something a number of times (count, press,
step), follow the procedure as written:

- Before the first press, list the steps from the task's own words, not from the manual's
  procedure: the manual's procedure often tests more than the task asks. Setting a program up
  means plugging its cords and switching power on; it is not a press. Each push the task names is
  sent once, even where the manual names it differently (its "set the system" can be the task's
  "reset": one push, not two).
- Send each step as its own call, ending with `state`: `s.json button 2 press + state`. Never put
  two steps in one call; the lamps after each step are part of the result.
- Compare `state` with what the step should show before sending the next.
- A pushbutton on this machine springs back when you let go. Pushing one, whatever the task calls
  it (a door or window opening, a key, a reset, a trigger), is one `button <n> press`: down and
  back up. Use `button <n> down` only when the task says to hold the button, or the next step
  needs it still held. If the task says to keep holding it, leave it held at the end; otherwise
  send its `button <n> up` when the hold is no longer needed.
- Do exactly the steps on your list, then stop: send nothing after the last one.

## When something is refused

The error names the command and the reason. `unknown_terminal`: check `help terminals` and the
minus sign. `hole_occupied`: every hole of that terminal already has a cord; most terminals have 2
holes, so route a third connection through another terminal on the same point (any + tap for +, or
a free junction such as M10). A lock error means another call on the same session is running, or a
killed call left `<session>.lock` behind.
