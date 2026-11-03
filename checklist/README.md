# Checklist

Tasks for an operator driving `bin/minivac-control`, and the yardstick that grades them. Each file in
`items/` is one item, `minivac.checkitem/1` (schema: `item.schema.json`): an `id`, a `kind` and the
`prompt` the operator is given.

- **wire** items name a conformance fixture (`fixture`, repo-relative). The check replays the
  operator's session, turns its final cords into a wire list, and runs a copy of the fixture with
  those `wires` (errata emptied) through the conformance runner. The manual's own script and
  expectations decide, so a circuit wired differently but behaving the same passes, and the
  operator's own presses do not count. `extra` holds further fixture-shaped steps appended to the
  copy, for properties the manual's script never asserts (e.g. "neither button pressed, lamp off");
  each extra expect cites its source and is tagged `unverified` when it is derived rather than
  printed. The fixture file itself is never written. A session that used `load-program` fails a
  wire item (ruling O4: loading skips the wiring the item tests).
- **basic** items are literal instructions; a session that used `load-program` fails them (O4).
  The check replays the operator's own session, runs
  500 ms more simulated time so lamp filaments finish (open-questions O-C28), and compares the
  exact cord set (`cords`: unordered pairs, unordered multiset, exact terminal names), the pairs in
  the optional `connected` list (each must have been plugged by some connect in the session log,
  even if later unplugged, e.g. B3's `3+/3A`), and the observables in `expect`.
- **operate** items ask the operator to run a program (ruling O3); `load-program` is allowed (O4).
  The check replays the operator's own session and, in order:
  1. runs the wire check above on the final cords against `program` (a fixture path), with the
     item's optional `extra` steps appended as for a wire item, so loaded and hand-wired
     programs both count;
  2. looks for `steps` in order among the commands sent after the last connect, disconnect or
     load. Each step is `{ "cmd": <contract command> }`, e.g.
     `{ "cmd": { "k": "button", "n": 6, "target": 1000 } }`, and takes the first qualifying command.
     A dial step (`dialGrab`) is taken by a dial hold at any angle, since a contact spans about 15
     degrees; it must carry a checkpoint on `dial` naming the contact, and the checker refuses an
     item whose dial step has none. A `dial release` after the last dial step is allowed: letting
     go of the knob is not a further turn, and the end state still reads the dial.
     Commands sent with no simulated time between them land on one tick, so of several on one
     control only the last counts: `button 6 down + button 6 up` in one call moves nothing, and its
     `down` does not count. After a control's last step no further command on it may follow
     (eleven presses are not "count to three", though they end on the same lamps). Power is not
     a step: checkpoints and the end state show it;
  3. checks each step's optional checkpoint, `expect`: a fixture expect step (observables, `cite`,
     `quote`, and `tag`/`source` when derived) that must hold once the call holding that step's
     command has settled, read after 500 ms more simulated time in a copy of the replay;
  4. runs 500 ms more and compares `expect`, as a basic item does.

  The first failing stage is reported, e.g.
  `FAIL OP2: step 2 of 4 (button 1 up) checkpoint: outLamp5 expected off, got on: "..."`.
- Every kind refuses a session on another profile: a wire or operate item needs its fixture's
  profile, a basic item `MV601-REF-A`.

Run it from the repo root:

```bash
bin/minivac-check checklist/items/I-EXP4.json s.json
```

The first line is `PASS <id>`, `FAIL <id>: <first mismatch>` (further mismatches follow, indented)
or `ERROR <id>: <why>` (corrupt session, profile mismatch, no cords, a reference command the
machine refused). A wire item run on a loaded session prints
`FAIL <id>: used load-program, which a wiring item does not allow (O4)`. Exit 0 pass, 1 fail, 2 error. The checker is a separate binary from
`minivac-control` on purpose: an operator allowed only that tool cannot reach it.
