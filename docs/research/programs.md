# Minivac 601 — the program corpus as fixtures

98 program records transcribed from the six manual books and the errata sheet, with the errata applied.
Three further records — the Maintenance Manual's own check circuits — are carried separately in §4.7 and are
deliberately **not** counted in the 98 (§3.1 C-21).
This is the source the golden conformance fixtures are generated from. Tic-Tac-Toe is §1 because it is the
project's centrepiece and the one program most likely to be miswired from a bad "correction".

**Sources.** `docs/research/raw/pdf/book1.pdf`, `book2-3-4.pdf`, `book5-6.pdf`, and — the one that was missed
for a whole research pass and corrects eight transcribed programs — `errata.pdf`. `maintenance-manual.pdf`
supplies three further printed programs (§4.7) and settles the relay and slide-switch contact polarity (§0).
Page offsets: Book I printed page N = PDF page N+2 for pp.3-32; Books II/III/IV are **one continuously paginated volume**, printed page N =
PDF page N+6 (Book II = pp.1-33, Book III begins p.35, Book IV begins p.66); Book V printed page N = PDF page
N+6 in `book5-6.pdf`, Book VI printed p.51 = PDF p.57; **Maintenance Manual printed page N = PDF page N+2**.

## 0. How to read this file

**Shorthand.** Two terminals joined by a slash: `1+/1A`. Stated in Book I printed p.5: "A WIRING SHORTHAND is
used to indicate connections which are to be made on the computer by simply writing the two terminal
designations with a slash in between." [verified] `book1.pdf` PDF p.7.

**Tags.** `[verified]` = read in a rendered page image of a primary source. `[likely]` = clean typeset OCR from
a primary PDF text layer, internally consistent with the terminal grammar, but not image-read. `[unverified]` =
a single damaged OCR line, or inference. The first research pass used a looser definition that admitted
cross-checked OCR to `[verified]`; that policy is struck and every affected program is re-tagged down (§3.1
C-20). The verified count is lower as a result, and that is the correct outcome — a fixture built on a
`[likely]` wire list is still usable, it just has to be labelled unconfirmed, and a failure triaged as
"possible transcription error" before "simulator bug".

**Two netlist rules the comparator must apply before declaring any mismatch.** [verified] `errata.pdf` p.1:

| Rule | Consequence |
|---|---|
| All `+` terminals — `1+`..`6+` **and `M+`** — are one electrical node. All `-` terminals — `1-`..`6-` **and `M-`** — are one electrical node. | Two wire lists that differ only in *which* plus or minus terminal they name are the same circuit. Normalise every `n+` to PLUS and every `n-` to MINUS. |
| A "terminal" is a set of interconnected holes: `6R` has two holes, `M10` has six, `3com` has four. Holes of one terminal are one node. | `1X/6A` == `1X/4R` + `4R/6A` == `1X/4com` + `4com/6A`. The errata prints that worked example itself, as a wire-length trick. |

**Contact polarity**, needed to read any of these lists. [verified] from print:

| Device | Common | Normally open | Normally closed | Transfer |
|---|---|---|---|---|
| Pushbutton `n` | `nY` | `nX` (closes when DOWN) | `nZ` (opens when DOWN) | **break-before-make**, Book I p.9 |
| Relay `n`, first contact set | `nH` | `nG` | `nJ` | not settled |
| Relay `n`, second contact set | `nL` | `nK` | `nN` | not settled |
| Slide switch `n` | `nS`, `nV` | RIGHT closes `S-T`, `V-W`; LEFT closes `S-R`, `V-U` | — | not settled |
| Rotary switch | `D16` (wiper) | `D0`..`D15` dial positions; `D17`/`D18` motor RUN, `D18`/`D19` short = STOP | — | **break-before-make**, Book I p.21 |

All four relay contacts and both slide-switch positions are settled directly from the Maintenance Manual's
check circuits (§4.7), which print a netlist *and* SDC's own expected lamp states: in `MM-RLY-CHECK` the relay
at rest lights the lamps fed from `J` and `N` and, once the coil is energised, the lamps fed from `G` and `K`;
in `MM-SW-CHECK` the slide at RIGHT lights the lamps fed from `T` and `W`, at LEFT those fed from `R` and `U`.
[verified] `maintenance-manual.pdf` PDF pp.9-10 (printed pp.7-8), rendered at 300-400 dpi this pass. Only the
**transfer order** — whether a relay's normally-closed contact breaks before its normally-open contact makes —
remains open (N-2). Corroborating the same mapping from the books: relay `G` = normally open is proved by
`III-RELAYAND` as corrected (light 3 ON only when both relays are ON); relay `J` = normally closed is proved by
`III-RELAYNOT` (lamp 2 ON while relay 1 is OFF); relay `K` = normally open is proved by `I-EXP9`, which would
latch at power-up and never release if `K` were the closed contact.

The relay indicator lamp is a **series element in the coil path**, not a passive tap — energising a coil
through `C` and `F` lights it, through `E` and `F` does not (Book I p.14), and the errata's alternate counter exists specifically to
"by-pass the relay indicator lights so that full voltage is supplied to the relay coils".

**Free-ended wires — four programs, stated once.** Four programs need a wire with one end plugged and the
other end **loose**, which the operator relocates while the program is running. A simulator without a
first-class "loose wire end" input cannot run any of them. Each program's own printed text is the source; the
four-program tally exists once in `find-programs.json` and nowhere else, so it is stated here to stop it being
re-derived.

| Program | Free wire(s) | What the operator does with the free end | Tag |
|---|---|---|---|
| `VI-TICTACTOE` | one on `M10` (machine's play wire), one on `M11` (player's play wire) | 'Place the free end … in 6 com', then in the BOTTOM contact (machine) or TOP contact (player) of a matrix square | [verified] |
| `V-EXP12` | four on `M10`, four on `M11` | 'draws' a numeral on the **TOP** terminals of the matrix (ER-33) | [likely] |
| `V-MAZESOLVER` | one on `6E` | moved between `D3`, `D5` and `D7` to nominate the goal | [likely] |
| `VI-MAZE` | one on `M+` | touched to the TOP terminals of the matrix squares | [likely] |

Only Book VI prints the mechanism, and only for `VI-MAZE`: '(The wire need not be plugged into the terminal;
touching the terminal will make the contact.)' [verified] `book5-6.pdf` PDF p.60. Whether the other three are
meant to be *touched* or actually *inserted* is **[unverified]** — Tic-Tac-Toe's own wording, 'place the free
end … in 6 com', reads as insertion. Touch-without-insertion is the `VI-MAZE` special case, not a corpus-wide
rule.

**Correction policy.** Where the errata sheet changes a wire, both lists are given: the printed one and the
corrected one, with the `ER-nn` reference. Ship the corrected list. Where a printed line is anomalous but
correct, it is flagged with a ruling so nobody "fixes" it.

## 1. Tic-Tac-Toe — the reference table

Book VI, printed p.55 (prose and rules) and p.56 (wiring table and play procedure) · `book5-6.pdf` PDF p.61-62 · 72 wires · tier D (smoke test, not a fixture) · **[verified]** (read **three** times from page images: finder at 600 dpi, verifier at 110 dpi, and a 300 dpi render of PDF p.62 this pass — all four columns, entry for entry in column-major order, zero disagreements. The third read closes gap-verify DG-04, which held RUL-01 at [likely] pending exactly this render; the ruling stands unchanged and `4G/5N` is confirmed in place. Do not re-spend this image read.)

Printed as 4 columns x 18 rows, read **column-major**. Reproduced in printed layout.

| col 1 | col 2 | col 3 | col 4 |
|---|---|---|---|
| `1A/1N` | `2L/D18` | `4F/5F` | `5L/M4t` |
| `1B/1-` | `2N/D19` | `4G/D5` | `5G/6N` |
| `1C/2C` | `2X/3X` | `4H/M1b` | `5Y/M10` |
| `1F/M11` | `2Y/3Y` | `4H/M5t` | `6+/6Y` |
| `1G/2A` | `3C/4C` | `4J/4K` | `6-/6C` |
| `1H/5X` | `3F/4F` | `4K/D6` | `6G/D1` |
| `1J/2F` | `3G/D7` | `4L/M2b` | `6H/M1t` |
| `1L/1Z` | `3G/4N` | `4L/M6t` | `6H/M5b` |
| `1N/3F` | `3H/M3b` | `4G/5N` | `6J/6K` |
| `1X/2H` | `3H/M7t` | `4Y/5Y` | `6K/D2` |
| `1X/2X` | `3J/3K` | `5C/6C` | `6L/M2t` |
| `1Y/2Y` | `3K/D8` | `5F/6F` | `6L/M6b` |
| `1Y/2G` | `3L/M4b` | `5G/D3` | `6X/M10` |
| `2B/2-` | `3L/M8t` | `5H/M7b` | `6com/D9` |
| `2C/3C` | `3N/6G` | `5H/M3t` | `M9b/M11` |
| `2E/D16` | `3X/4X` | `5J/5K` | `M-/D17` |
| `2F/2H` | `3Y/4Y` | `5K/D4` | `M10/free*` |
| `2G/2K` | `4C/5C` | `5L/M8b` | `M11/free**` |

Footnotes, verbatim and complete: `* this is the machine's "play" wire` / `** this is the player's "play" wire`. The finder's file appended `(attached to M10)` / `(attached to M11)` inside an `as_printed` field; that gloss is true but it is not print. The footnotes carry no parenthetical gloss on the page. [verified] verify-programs R2, re-confirmed on the 300 dpi render this pass, `book5-6.pdf` PDF p.62.

**Per-line confidence**

| Line | Tag | Note |
|---|---|---|
| `4G/5N` | [verified] | **Correct as printed. Do not 'fix' it to `4N/5N`.** It is the middle link of the printed chain `3G/4N` (col 2), `4G/5N` (col 3), `5G/6N` (col 4), and the table legitimately prints each of 3G/4G/5G twice (`3G/D7`+`3G/4N`, `4G/D5`+`4G/5N`, `5G/D3`+`5G/6N`). The out-of-alphabetical-order placement occurs in the same relative slot in two consecutive columns, so it is a printing pattern, not a typo. verify-programs R1; gap ruling RUL-01. The finder's `4N/5N` inference is struck. |
| `6+/6Y` | [verified] | Printed with the plus spaced: `6 + /6Y`. |
| `6-/6C` | [verified] | Printed `6 — /6C`. |
| `M10/free*`, `M11/free**` | [verified] | Not jack-to-jack connections: each is a wire with one end in the matrix terminal and the other end loose. The simulator needs a first-class loose-wire-end input. All four programs that need one are tabulated together in §0, *Free-ended wires*. |

**Initial settings (as printed)**

- Power ON.
- Place the free end of the machine's 'play' wire (the wire on M10) in 6com.
- Player's 'play' wire (the wire on M11) starts free.
- No slide-switch or dial pre-setting is stated.

**Procedure (as printed)**

- (Note: it will probably be most convenient to keep track of the game on a piece of paper.)
- Turn power ON.
- Place the free end of the machine's 'play' wire in 6 com.
- Push pushbutton 6 and hold pushbutton 6 down while you push pushbutton 1. The pointer knob will turn to indicate the machine's first move.
- Release both pushbuttons 1 and 6.
- All succeeding moves: place the free end of the machine's 'play' wire in the BOTTOM contact of the matrix terminal corresponding to the machine's last move (as indicated by the pointer knob).
- Player selects his move and indicates it by placing the free end of the player's 'play' wire in the TOP contact of the matrix terminal corresponding to his move.
- Push pushbutton 6 and hold pushbutton 6 down while you push the pushbutton corresponding to the move (pushbutton 2 the second time, pushbutton 3 the third time, etc.)
- Play continues until either light 1 comes on - indicating that MINIVAC wins; or light 2 comes on - indicating a tie.
- To begin another game, be sure that the player's 'play' wire and the machine's 'play' wire are both free.

**Expected behaviour**

- Light 1 ON = MINIVAC wins. [verified] Book VI p.55-56
- Light 2 ON = tie. [verified] Book VI p.55-56
- The pointer knob of the rotary switch indicates the machine's move. [verified] Book VI p.56
- The machine always moves first, and its first move is always the centre of the game matrix. [verified] Book VI p.55
- **The centre is matrix square 9.** [verified] `raw/photos/commons-minivac601-main.jpg`, MATRIX block read at native 4208 px this pass: top row `1 2 3`, middle row `8 9 4`, bottom row `7 6 5`, with the six-hole `M10` and `M11` terminals flanking. Independently `panel.md` and `find-panel.json` claims[33]. Book VI's page prints only 'the center of the game matrix' — the numbering comes from the panel, not from this page. verify-programs R7 downgraded the finder's tag for want of the photograph; the photograph has now been read and the tag is restored (critic-completeness C8).
- Errata ER-44: 'if the game is a tie, MINIVAC will indicate a tie on the fifth move but will not indicate a move into the last available space.' [verified] `errata.pdf` p.4 right col (image-read at 300 dpi by gap-verify UP-04).

**Stated playing rule, verbatim.** The MINIVAC is so programmed that the machine will move 5 squares to the right of its own last move if and only if the human opponent has blocked that last move by moving 4 squares to the right of the machine's last move. If the human player did not move 4 squares to the right of the machine's last move, MINIVAC will move into that square and indicate a win. If the human player consistently follows the 'move 4 to the right' rule, every game will end in a tie.

**Cannot-lose claim, verbatim.** MINIVAC can be programmed to play tic-tac-toe against a human opponent. A warning though: with this program, MINIVAC can not lose. The human opponent may tie the game, but he can never win. This is because of the decision rules which are the basis of the program.

**First-move claim, verbatim.** This program requires that MINIVAC make the first move; the machine's first move will always be to the center of the game matrix. A program which would allow the human opponent to move first would require more storage and processing capacity than is available on MINIVAC 601.

**The ring order is settled. The direction convention is not.**

- **Ring order — [verified].** The panel silkscreens the matrix as top row `1 2 3`, middle row `8 9 4`, bottom row `7 6 5`, so 9 is the centre and the eight outer squares run **clockwise** around it from top-left: 1-2-3-4-5-6-7-8. `raw/photos/commons-minivac601-main.jpg` read this pass; `panel.md`; `find-panel.json` claims[33]. It does not come from Book VI, which states the rule and never restates the numbering, nor from Book I, which gives only the naming convention `M<n><t|b>`.
- **Direction semantics — not settled by the sources.** 'Five squares to the right' and 'four squares to the right' are moves around that eight-square ring, but neither Book VI's rule paragraph nor its play procedure defines which way 'right' runs, and ER-44 adds only the fifth-move tie note. `book5-6.pdf` PDF pp.61-62, read at 300 dpi this pass. Nor does anything state how the rule anchors when the machine's last move was the **centre**, which is not on the ring.
- **Named fallback `FALLBACK-TTT-RING-CW`.** 'N squares to the right' = advance N positions **modulo 8 through the printed numbering**, 1→2→…→8→1. Reasoning: the panel's own numbering runs clockwise and is the only cyclic order the machine expresses anywhere. Every step generated under it is tagged **[unverified]** and carries `source: "FALLBACK-TTT-RING-CW"`. Do not ship a Tic-Tac-Toe fixture that asserts a specific machine move as though it were printed.

## 2. Which programs are fixtures, and which are demos

A fixture is a triple: (corrected wire list, initial settings, expected-state script). It passes when, for every step of the script, the simulator's state after the step's settle policy matches **every observable the printed page names, and no others**. [verified] as a definition supplied by gap-canonical (the manuals define no such thing); gap-verify confirms the definition is sound and corrects two of its tier assignments.

**Anti-fabrication rule.** Never write an expected value the page does not state. Where a power-up state is obvious but unprinted, record it with tag [unverified] and source `FALLBACK-PWRUP-COLD`. A single fabricated expectation destroys the corpus's only real property — that it is not invented.

### 2.1 Tiers

| Tier | What it covers | Pass criterion | Build order |
|---|---|---|---|
| A | Combinational. No self-holding, no motor, no rotary, no timing language in the printed procedure. Output is a pure function of current button/switch positions. | Apply the step's events, iterate the relay network to fixpoint, compare the named lamps/relays. A mismatch is a bug. | 1 |
| B | Sequential / latching: self-holding relays, flip-flops, counters. Printed procedure distinguishes press from release, or says 'do not release'. | Same as A, but **press and release are separate events with a settle between them**, and step order is load-bearing. A tier-B fixture that still passes when press+release are collapsed into one event is testing nothing. | 2 |
| C1 | Static rotary only: reads a hand-set dial position (`D16` closes to `D<n>` at position n) but never runs the motor. | Same as A/B plus the static dial-position-to-contact map. Buildable before the motor model exists. | 2 |
| C2 | Motor / rotary stepping: `D17`/`D18` RUN, `D18`/`D19` STOP, or any timing-dependent behaviour. | Deferred until the rotary timing model exists. A passing C2 fixture before then is a fixture passing over an invented model. | 3 |
| D | Free play / games with no deterministic printed trace. | **Not fixtures.** Smoke tests only: the wire list must load without shorting PLUS to MINUS through no load, and the stated invariant must hold. Do not fabricate an expected trace. | 4 |

The C1/C2 split is **a judgement call made in this file, not a source fact.** gap-canonical wrote a single tier C covering 'any program touching D0..D19, M+, M-, or the RUN/STOP/ARM jacks' and marked it deferred, then put two rotary programs (`II-EXP2`, `I-EXP11`) in its own build-this-first list — a direct self-contradiction that gap-verify caught (RF-01, RF-02). Splitting the tier is the defensible repair; moving the programs is not. [verified] as a contradiction; [unverified] as a repair.

### 2.2 Conformance seed set — tier A (build first)

These are the right conformance floor: short, printed with a stated observable, and free of the motor.

| ID | Program | Locator | Wires | Tag | Why |
|---|---|---|---|---|---|
| `MM-PB-CHECK` | Pushbutton Check | MAINT p.6-7 / maintenance-manual.pdf p.8-9 | 5 | [verified] | **Build this first.** Printed netlist plus SDC's own printed expected lamp states; no relay, no motor, no rotary (§4.7) |
| `MM-RLY-CHECK` | Relay Check | MAINT p.7 / maintenance-manual.pdf p.9 | 13 | [verified] | Printed netlist plus printed expected lamp states; exercises all four relay contacts and the coil-driven-at-`E` case in one circuit (§4.7) |
| `MM-SW-CHECK` | Slide Switch Check | MAINT p.8 / maintenance-manual.pdf p.10 | 10 | [verified] | Printed netlist plus printed expected lamp states; settles both slide-switch positions (§4.7) |
| `I-EXP1` | Use of Programming Wires | Book I p.5 / book1.pdf p.7 | 2 | [likely] | Simplest possible closed circuit |
| `I-EXP2` | Single Light Operation | Book I p.7 / book1.pdf p.9 | 2 | [likely] | Establishes lamp ON = 1 |
| `I-EXP3` | Pushbutton Operation | Book I p.9 / book1.pdf p.11 | 5 | [likely] | Both pushbutton contacts; the break-before-make page |
| `I-EXP4` | Series Circuit (AND) | Book I p.10 / book1.pdf p.12 | 4 | [verified] | Three printed steps, three stated outcomes |
| `I-EXP5` | Parallel Circuit (OR) | Book I p.11 / book1.pdf p.13 | 5 | [verified] | Four printed steps |
| `I-EXP6` | Manual Relay Operation | Book I p.13 / book1.pdf p.15 | 5 | [verified] | Manual relay actuation; contact polarity check |
| `I-EXP7` | Electrical Relay Operation | Book I p.15 / book1.pdf p.17 | 8 | [verified] | Coil via C vs via E — the indicator-lamp-in-series fact |
| `I-EXP8-STEP5` | A Relay Controls Another, step 5 | Book I p.16 / book1.pdf p.18 | 21 | [verified] | Printed six-relay expansion and the AT-11 all-relays-operate circuit |
| `I-EXP10` | Slide Switch Operation | Book I p.19 / book1.pdf p.21 | 6 | [likely] | Printed slide-switch transfer and lamp outcomes |
| `II-EXP5` | Decision Making (equality comparator) | Book II p.13-14 / book2-3-4.pdf p.19-20 | 13 | [likely] | **Best-specified combinational fixture in the corpus** — five printed numbered steps each with a stated relay-3 outcome. Also the corpus's **relay contact-set isolation regression test**: its printed `1H/1L` bridge means a simulator that internally ties `H` to `L` passes all three Maintenance Manual check circuits and fails this one |
| `II-EXP6` | Arithmetic (one-bit adder) | Book II p.14 / book2-3-4.pdf p.20 | 15 | [likely] | Five printed steps with stated lamp outcomes; needs ER-06 |
| `III-3STMT` | Three statements (A AND B -> C) | Book III p.36 / book2-3-4.pdf p.42 | 4 | [likely] | Two-pushbutton AND, four wires |
| `III-XOR-PB` | EITHER BUT NOT BOTH (pushbutton XOR) | Book III p.41 / book2-3-4.pdf p.47 | 5 | [verified] | Image-verified; printed prose covers both non-trivial cases |
| `III-RELAYAND` | The Relay AND Circuit | Book III p.43 / book2-3-4.pdf p.49 | 10 | [verified] | **Mandatory ER-12** — the as-printed circuit does not implement AND |
| `III-RELAYOR` | The Relay OR Circuit | Book III p.43 / book2-3-4.pdf p.49 | 11 | [verified] | Image-verified by the verifier |
| `III-RELAYNOT` | The Relay NOT Circuit | Book III p.44 / book2-3-4.pdf p.50 | 6 | [verified] | 300 dpi image-read; settles relay J = normally closed |
| `III-RELAYXOR` | The Relay EITHER BUT NOT BOTH Circuit | Book III p.44 / book2-3-4.pdf p.50 | 11 | [verified] | **Structural test case for the J/G contact model** — the only cross-coupled two-relay circuit in the manuals. Expected trace is *derived, not printed*: weak fixture, every step [unverified] |
| `V-EXP1` | The Lights on the Stairs | Book V p.2 / book5-6.pdf p.8 | 5 | [verified] | Image-read wires/diagram give XNOR; ER-28 proves only the one-switch toggle invariant, and the contradictory absolute phase is fallback-tagged |

### 2.3 Conformance seed set — tier B (build second)

| ID | Program | Locator | Wires | Tag | Why |
|---|---|---|---|---|---|
| `I-EXP9` | A Relay Controls Itself | Book I p.17 / book1.pdf p.19 | 6 | [verified] | Bistable, and Book I short — build it early. Collapsing press and release on it is exactly the failure this tier exists to catch |
| `II-MANUALMEM` | Manual Relay Memory Circuit | Book II p.10 / book2-3-4.pdf p.16 | 6 | [likely] | The minimal *non*-latching relay memory — the control for the next one |
| `II-SELFLOCK` | Self-Locking Relay Memory Circuit | Book II p.10 / book2-3-4.pdf p.16 | 7 | [likely] | Adds `1C/1A`; latches and cannot be cleared except by removing power. If the simulator can clear it, the self-holding model is wrong |
| `II-2BUTTONMEM` | Two-Button Relay Memory (two-input flip-flop) | Book II p.11 / book2-3-4.pdf p.17 | 8 | [verified] | Needs ER-05 (`1A/1C` -> `1A/1G`) |
| `II-FF1` | The Single Input Flip-Flop | Book II p.12 / book2-3-4.pdf p.18 | 14 | [verified] | **The primary release-edge fixture.** Behaviour lives entirely on the pushbutton *release* edge. No erratum applies to it — ER-19 is `IV-FF1`'s (C-23) |
| `IV-FF2` | Single-input flip-flop, second version | Book IV p.69-70 / book2-3-4.pdf p.75-76 | 14 | [verified] | **Fullest printed step-by-step trace of any flip-flop** — and it prints a power-up assertion, which is the strongest evidence for the cold-start fallback |
| `IV-FF2-CARRY` | Single-Input Flip-Flop With Carry | Book IV p.70 / book2-3-4.pdf p.76 | 18 | [verified] | The actual building block of the three-bit counter; a distinct program from IV-FF2 |
| `IV-FF1` | Single-input flip-flop, first version | Book IV p.68-69 / book2-3-4.pdf p.74-75 | 15 | [likely] | Genuinely different 15-wire circuit; the only flip-flop that consumes **both** contact sets on both relays. **ER-19's circuit** — the one SDC itself says to operate slowly — so it, not `II-FF1`, is what the timing profile's 'must misbehave when hammered' half gets proved against (C-23) |
| `ER-ALTCOUNTER` | Three-Bit Binary Counter, alternate circuit | errata.pdf p.2 | 48 | [verified] | **The counter fixture the manufacturer itself prefers** — Book IV's own counter 'strains the relays' |
| `IV-EXP1` | A Three-Bit Binary Counter | Book IV p.71-72 / book2-3-4.pdf p.77-78 | 44 | [verified] | 500 dpi image-read; carries the **17-row printed SEQUENCE OF OPERATIONS chart** — the richest printed golden trace in the manual set |

### 2.4 Shipped demos (tier D, and the tier-C set)

These are what a user plays with. They are not conformance fixtures — none prints a deterministic trace, and most run the motor.

| ID | Demo | Tier | Note |
|---|---|---|---|
| `VI-TICTACTOE` | Tic-Tac-Toe | D | The centrepiece. Smoke test only: the wire list must load, and the 'move 5 to the right' invariant must hold. The matrix ring order is **settled** from the panel (1-2-3 / 8-9-4 / 7-6-5, centre 9); what is still open is the direction convention for 'squares to the right' — see `FALLBACK-TTT-RING-CW` (§1) and N-1. Do not re-open the numbering |
| `VI-MATCHGAME` | The Match Game | D | MINIVAC always wins. ER-43 changes the setup: turn the dial to 15 **by hand**, not with pushbutton 3 |
| `VI-SECRETCODE` | The Secret Code | D | 74 wires; reuses `VI-SEQREC` |
| `VI-COMBOLOCK` | The Combination Lock | D | Reuses `VI-SEQREC`; reset by turning the rotary switch one full revolution (ER-41) |
| `VI-MAZE` | The Electronic Maze | D | Reuses `VI-SEQREC`; needs the loose-wire-touch input |
| `VI-SPS` | Scissors, Paper or Stone | D | Two-player, purely combinational underneath but no printed trace |
| `VI-FORTUNETELLER` | The Fortune Teller / Random Number Generator | D | One wire list, two games |
| `VI-TUGOFWAR` | The Philosophic Tug of War | D | Motor direction race |
| `VI-REACTION` | Reaction Time Tester | D | ER-46: cover the dial or add dummy connections |
| `VI-MINDREADING` | The Mind Reading Trick | C1/D | Three slide switches select a dial position; the dial is *driven*, so C2 in practice |
| `V-EXP2` | The Burglar Alarm | B | Named in the project brief's demo set; latching, no motor |
| `V-EXP4` | The Traffic Light | C2 | The canonical motor demo, image-verified |
| `V-EXP5` | Traffic Light with Pedestrian Control | C2 | Image-verified |
| `V-EXP3` | The Metronome | C2 | Rotary oscillator |
| `IV-EXP1` | Three-Bit Binary Counter | B | Named in the project brief's demo set |
| `III-RELAYAND / OR / NOT / XOR` | The logic-gate demos | A | Named in the project brief's demo set |

The project brief's demo list also names 'the dating machine' and 'dice'. Their manual sources are `V-JOBSELECT` (Job Selection / Mate Selection, Book V p.41-43 — one 5-wire section repeated six times) and `VI-RANDOM` (The Random Number Generator, Book VI p.59, same wiring as the Fortune Teller — a four-sided die, not six). [verified] 400 dpi image reads of `book5-6.pdf` PDF pp.48, 64-65.

## 3. Corrections

### 3.1 Corrections to the research record

Everything here is a claim that was made and then overturned. It is recorded so nobody re-derives it. 'The finder' is the first-pass transcription agent (`find-programs.json`); 'the verifier' is the adversarial checker that outranks it (`verify-programs.json`); `gap-canonical` and `gap-verify` are the follow-up pair that opened the errata sheet and defined the fixtures. All four are in `docs/research/raw/`.

| # | The claim | The correction | Authority |
|---|---|---|---|
| C-01 | Tic-Tac-Toe's printed `4G/5N` is anomalous; `4N/5N` is the intended line. | **REFUTED.** `4G/5N` is correct as printed and is the middle link of the `3G/4N` / `4G/5N` / `5G/6N` chain. 'Fixing' it breaks the relay-G-to-relay-N chain. The finder's discrepancy D2 is struck. | verify-programs R1; gap RUL-01; `book5-6.pdf` p.62 [verified] |
| C-02 | Book I Exp 12 prints `6-/D18` while Exp 13 prints `5-/D18` — a printing discrepancy needing resolution. | **REFUTED.** Same electrical node. The errata sheet states flatly that all `+` terminals (including `M+`) are one node and all `-` terminals (including `M-`) are one node. No typo exists. Book I ANSWER 13 prints `D18/M-` for the same connection, a third spelling of the same node. | ERG-02, `errata.pdf` p.1 left col [verified]; gap image read of `book1.pdf` p.33 |
| C-03 | Whether the six section minus terminals and plus terminals are one supply rail or six fused nodes is not settled. | **REFUTED — settled.** Two nodes total: PLUS and MINUS. This is a first-order netlist fact and the fixture comparator must normalise on it before declaring a mismatch. | ERG-02, `errata.pdf` p.1 left col [verified] |
| C-04 | Book I says four COMMON terminals; Books III-VI address six (`1com`..`6com`); not settled by the manuals. | **REFUTED — settled.** A 'terminal' is a set of interconnected holes. The errata sheet enumerates them by hole count: 'the two terminals at `6R`, the six at `M10`, or the four at `3com`.' So `3com` is one terminal with four holes, and there is a com terminal per section. Book I's 'the four COMMON terminals' counts holes. | ERG-03, `errata.pdf` p.1 left col [verified]; the holes-not-terminals reading is [likely] |
| C-05 | Book V Exp 4 puts two rotary terminals on `M-` — a discrepancy against Exp 5. | **DOWNGRADED to not-a-discrepancy.** Both printings are image-confirmed and both are electrically sensible; given C-03 there is nothing anomalous about two rotary terminals landing on `M-`. Record it as two programs with two motor polarities. | verify-programs R9; `book5-6.pdf` p.11 @130 dpi [verified] |
| C-06 | The Relay AND circuit's intended line is probably `1G/2H` in place of `2+/2H` — inference, [unverified]. | **UPGRADED to [verified].** The errata sheet says exactly that. The circuit *diagram* on the same page already draws `1G` to `2H`; only the program list was wrong. | ER-12, `errata.pdf` p.2 left col [verified]; `book2-3-4.pdf` p.49 @130 dpi |
| C-07 | Book V Exp 14's `4F/5G` could be a print error for `4F/4G` — [unverified]. | **UPGRADED to [verified].** The errata sheet corrects it. This is the one errata line the OCR text layer destroyed completely (rendered `rk a n n a A A P /A fl`), which is why two earlier passes missed it. | ER-34, `errata.pdf` p.3 right col @300 dpi [verified] |
| C-08 | `II-3STMT`, 'Computer representation of three statements', is in Book II. | **REFUTED.** Printed p.36 is in **Book III**. Books II/III/IV are one continuously paginated volume: Book II = pp.1-33, Book III begins p.35, Book IV begins p.66. Renamed `III-3STMT`. Key the corpus on (pdf_file, pdf_page, printed_page) and *derive* the book label — a fixture set keyed on book name misfiles this program. | gap RUL-03; `book2-3-4.pdf` CONTENTS PDF p.5 [verified]; corroborated independently by gap-verify UP-07 |
| C-09 | The errata's elevator reliability block (`remove 5F/6C, 6C/6-; add 5F/6E, 6E/6-, 4E/6C`) belongs to Book V Experiment 8. | **REFUTED.** It belongs to **Experiment 9**. Both Notes sit under the Experiment 9 heading and precede the 'page 12:' entry. Experiment 8's only erratum is the pushbutton-5 procedure change. Applying it to Experiment 8 builds a circuit that does not exist. | gap RUL-04, `errata.pdf` p.3 right col @300 dpi [verified]; gap-verify UP-08 |
| C-10 | `III-MINDREADING`'s first line is `5V/4S`. | **Silent correction, now sourced.** The Book III printing reads `5V/45`; the errata corrects it to `5V/4S`. The corrected value is right — the Book VI reprint genuinely prints `5V/4S` — but the finder presented the corrected form as the printed form with no flag. | verify-programs R8; ER-14 [verified] |
| C-11 | `IV-FF1` has 16 connections. | **Arithmetic error — it is 15.** The page builds the circuit in four stages of 6 + 4 + 3 + 2, and the finder's own four stage arrays contain exactly 15 items. The wires are unchanged. | gap RUL-07; `book2-3-4.pdf` pp.74-75 text layer [likely]; corroborated gap-verify DG-05 |
| C-12 | Book II's 14-wire flip-flop, `IV-FF1` and `IV-FF2` are three printings of one circuit. | **Two circuits, not three.** Under the all-plus-one-node / all-minus-one-node rule and the relabelling {relay 1->5, relay 2->6, pushbutton 1->pushbutton 6}, Book II's flip-flop and `IV-FF2` share **four of six** electrical nets and differ only in where indicator lamp 5's anode taps (`5E` vs the `{5F,5H,6F}` node). `IV-FF1` is a genuinely different 15-wire circuit using the K/L/N contact set. gap-canonical's headline said 'five of six', contradicting its own computed table; four is right. | gap flip_flop_settlement; gap-verify RF-06 [verified]; `book2-3-4.pdf` p.18 and p.76, both image-read |
| C-13 | The lamp-tap difference between Book II's flip-flop and `IV-FF2` is cosmetic — 'they will agree in the stable states'. | **DOWNGRADED to [unverified].** On this machine an indicator lamp is a **series element in the coil path**, not a passive tap — the errata says so directly ('by-passes the relay indicator lights so that full voltage is supplied to the relay coils'). Moving the tap changes coil loading. Keep both as separate fixtures; do not unify the wire lists; do not assume the stable states agree. | gap-verify DG-01; ER-21 @300 dpi [verified for the lamp-in-series topology] |
| C-14 | The self-locking memory `II-SELFLOCK` comes up ON at power-up, latched by the first settle. | **REFUTED — it comes up OFF.** Its holding path runs `1+ -> 1H -> 1G (normally open) -> 1A -> 1C -> lamp -> coil -> 1F -> minus`. At cold start relay 1 is unoperated, so `1H`-`1G` is open and the coil sees nothing. It latches only after pushbutton 1 has been pressed once. The rule this example was attached to (`FALLBACK-PWRUP-COLD`) is unaffected; the example was backwards. | gap-verify RF-04 [verified]; contact polarity derived two ways from print |
| C-15 | `II-EXP2` (Decimal Input) is a tier-A fixture asserting **lamps** 4 ON then OFF. | **REFUTED twice.** (a) It is tier C1 — its 23 wires include `5Y/D16`, `D1/1G`..`D5/5G`, six rotary terminals. (b) The observable is the **relay indicator light**, not the binary output lamp: the program contains no `A` or `B` terminal at all, so a lamp assertion would assert the state of an unwired lamp. The page's own sentence: 'the number being remembered corresponds with the section which has a relay light ON.' | gap-verify RF-01, RF-03; `book2-3-4.pdf` p.13 [verified] |
| C-16 | `I-EXP11` (Manual Operation of Rotary Switch) is a tier-A build-this-first fixture. | **REFUTED.** Its entire five-wire program is rotary (`6+/D16`, `D1/5A`, `D2/6A`, `5B/6B`, `6-/6B`). Tier C1. | gap-verify RF-02; `book1.pdf` p.23 [verified] |
| C-17 | `III-XOR-PB`'s step 5 (both buttons released, lamp 3 OFF) is [verified] from print. | **DOWNGRADED to [unverified].** Book III p.41 prints only the either-pushed and both-pushed cases. The neither-pushed state is derived. The same physical state was tagged [unverified] at step 1 and [verified] at step 5 in the same script. | gap-verify RF-08; `book2-3-4.pdf` p.47 [verified] |
| C-18 | 'Relay pull-in and drop-out times, and contact transfer order, are not settled by the manuals.' | **PARTLY REFUTED.** Contact transfer order **is** settled for pushbuttons and the rotary switch, in Book I body text, and called out there as load-bearing: both are **break-before-make**, and Book I says explicitly 'the normally open contact is never connected directly to the normally closed contact, even for a very short time. This feature is necessary for the proper operation of some MINIVAC circuits.' Only **relay** contact transfer order and the millisecond figures remain open. | gap-verify RF-05; `book1.pdf` p.9 and p.21 [verified] |
| C-19 | errata.txt drops 12 of the 48 connections in the alternate three-bit counter. | **REFUTED.** The OCR has all 48. It corrupts four glyph classes, all recoverable: two terminal letters (`IF/TH` for `1F/1H`, `61/6-` for `6L/6-`), every plus sign (rendered `-f` / `-\|-`), the two-column reading order, and exactly one line destroyed to noise (the Book V p.24 correction, see C-07). | gap RUL-08 and gap-verify UP-01/UP-02; `errata.pdf` p.2 right col @300 dpi [verified] |
| C-20 | The finder's `[verified]` tag policy admitted OCR-only claims cross-checked against a second printing. | **Policy struck.** [verified] means read in a rendered page image of a primary source (or the panel photograph). Every program whose verification field does not name a page image drops to [likely]. The finder's own nine-entry image-read list is the whitelist. This lowers the verified count sharply, and that is the correct outcome: a fixture built on a [likely] wire list is still usable, it just has to be labelled unconfirmed, and a failure triaged as 'possible transcription error' before 'simulator bug'. | verify-programs R6; gap RUL-05 [verified] |
| C-22 | Book I ANSWER 13's wiring is `6+/6Y`, `6J/6A`, `6B/6-`, `6Y/D17`, `D18/M-`. | **Two lines wrong.** The image reads `6X/6A` and `6X/D17`: pushbutton 6's normally-open contact `6X` feeds both lamp 6 (via `6A`) and the motor RUN terminal `D17`, with the common `6Y` tied to `6+`. The finder's `6J/6A` (a relay contact) and `6Y/D17` (the pushbutton common) do not match the drawing on the page. | gap-canonical 300 dpi read of `book1.pdf` p.33, independently confirmed by gap-verify UP-06 [verified] |
| C-23 | Errata **ER-19** ('push pushbutton 6 slowly when operating the single-input flip-flop. Light 6 will go off and on, indicating the state of the whole flip-flop') belongs to Book II's single-input flip-flop (find-relays RLY-26), or to '`IV-FF1` / `IV-FF2`' (the verifier's hedge). | **Both wrong — it is `IV-FF1` alone.** (a) The erratum is filed at Book IV printed p.69 = PDF p.75, the page carrying `IV-FF1`'s build stages 2-4 and its circuit diagram; `IV-FF2`'s program, diagram, caption and all three numbered steps sit on printed p.70 = PDF p.76. (b) `IV-FF1`'s stage-4 wires are `6G/6A`, `6B/6-`, so light 6 *is* its indicator — exactly what the erratum describes. (c) `IV-FF2`'s own printed text refutes the note for itself: 'light 6 is not used as an indicator in this program.' `II-FF1` uses pushbutton 1 and light 1, not 6. Consequence: `IV-FF1`, not `II-FF1`, is the circuit the timing model's 'must misbehave when hammered' half is proved against. | `book2-3-4.pdf` PDF pp.74-76 read in full this pass [verified]; `errata.pdf` p.2 **right** col (the `BOOK IV` block; the left column of that sheet runs Book III pp.38-62) [verified] at 200 dpi this pass; `find-relays.json` RLY-26 (attaches it to the Book II circuit); `verify-programs.json` line 206 (`affects_finder_program: IV-FF1 / IV-FF2`); critic-completeness C11 catches the find-relays half only |
| C-21 | 'Corpus = 98 programs + 1 errata circuit.' | **Off by one.** 84 finder records + 14 recovered = 98, and the errata alternate counter is already one of the 14. The corpus is **98 records**. A merge that trusts the stated total looks for a 99th that does not exist. (`IV-FF2-CARRY` is an additional *fixture* built from the `IV-FF2` record, not a 99th record.) | gap-verify RF-07 [verified by structural read] |

**Two things that are still not fixed, and are not this file's to fix.** (a) `docs/programs.json` — the reconciled machine-readable corpus the fixtures are supposed to be generated from — **does not exist on disk**. The research that unblocks it is done; the merge has not been run. [verified] gap-verify MS-05, directory listing. (b) `find-relays.json` RLY-27 gives Book I Experiment 8 a wire list containing `1Y/1C`; the correct line is `1X/1C`. `1Y/1C` bypasses pushbutton 1 entirely and leaves relay 1 permanently energised at power-up, which contradicts the experiment's own first three printed steps. Strike RLY-27's list; this file's `I-EXP8` is right. [likely] gap RUL-02, from `pages/book1/p-18.png`.

### 3.2 The errata sheet

`docs/research/raw/pdf/errata.pdf` — *Notes and Corrections to the Minivac Manual*, Scientific Development Corporation, 4pp. Byte-identical twin on disk at `errata.pdf`. **It is primary and it corrects the programs.** It was in the same directory as the book PDFs through the entire first research pass and the string 'errata' appears zero times in `find-programs.json`. All 46 corrections and 5 global facts below are image-verified at 300 dpi end to end (42 by gap-canonical, the last 4 by gap-verify UP-04).

**Global facts.** These are simulator-level, not program-level.

| ID | Fact | Impact |
|---|---|---|
| ERG-01 | Always be certain that the power is OFF when you are either wiring a program or removing one from the board of the MINIVAC. | — |
| ERG-02 | All + and - terminals are connected together. For example, a connection to 1+ is the same as a connection to 3+, 6+, or M+. Similarly, a connection to 2- is the same as a connection to 4-, 5-, or M-. | first-order netlist fact - two nodes total for power |
| ERG-03 | In addition to those terminals specifically marked 'common,' common terminals are any set of terminals which are interconnected: for instance, the two terminals at 6R, the six at M10, or the four at 3com. | gives HOLE COUNTS: 6R has 2 holes, M10 has 6, 3com has 4. Confirms that Book I's 'the four COMMON terminals' counts holes of one terminal, not four terminals. |
| ERG-04 | Worked example: to make 1X/6A with shorter wires, use 1X/4R + 4R/6A, or (if slide switch 4 is in use) 1X/4com + 4com/6A. Either produces the same result as the single connection 1X/6A. | — |
| ERG-05 | Troubleshooting order: (1) check this sheet; (2) check the operating instructions, and try carrying out the procedure SLOWLY - some programs are not designed for high-speed operation; (3) check all connections, then the circuit breaker (a programming error causing a short trips it; push it in after correcting); (4) if the program uses relays, check the relay arms are free to move - replace short wires with longer ones so wires do not interfere with relay arms. | 'some programs are not designed for high-speed operation' is the manufacturer conceding that some published programs are timing-marginal on real hardware. Relevant to how a fixture failure is triaged. |

_All five [verified], `errata.pdf` p.1._

**Program and text corrections.** `kind` says whether it changes the wire list (`program_change` / `program_replacement`), only the printed circuit diagram (`diagram_only`), only the operating procedure (`procedure`), or only prose (`prose_only`). Only the first and third classes can change a fixture.

| ID | Book | Printed p. | Kind | Correction | Affects |
|---|---|---|---|---|---|
| ER-01 | I | 13 | diagram_only | circuit diagram incorrect - delete line connecting 1B and 2B. [verified] | I-EXP6 (program list unchanged) |
| ER-02 | I | 24 | diagram_only | 'MOTOR REVERSING' circuit diagram incorrectly labeled - change 6Y to 6V. [verified] | I-EXP14 (the printed PROGRAM already reads 6V/D17, so the six-line list stands) |
| ER-03 | I | 28 | prose_only | Problem 7: light 1 and relay 1 should both be on ONLY if BOTH pushbutton 1 and pushbutton 2 are DOWN. Problem 18: pushbutton 5 is used to keep the rotary switch from stopping at D0 when pushbutton 6 is being held down. [verified] | I-PROBLEMS |
| ER-04 | II | 10 | prose_only | third complete paragraph, second line - change DOWN to ON. [verified] | — |
| ER-05 | II | 11 | program_change | program correction for 'TWO-BUTTON RELAY MEMORY CIRCUIT' - change 1A/1C to 1A/1G; delete 1A/1C connection on circuit diagram. [verified] | II-2BUTTONMEM: corrected last line is 1A/1G |
| ER-06 | II | 14 | program_change | program correction for Experiment 6 - change 2Z/2C to 2X/2C. [verified] | II-EXP6 |
| ER-07 | III | 36 | diagram_only | RECOVERED - this entry's body is a REPLACEMENT CIRCUIT DIAGRAM, not text, which is why errata.txt shows the heading with nothing under it. The replacement diagram reads, left to right: 1+ (filled node) - 1Y ; slide/pushbutton 1 arm rising to 1Z ; 1X - 2Y ; pushbutton 2 arm rising to 2Z ; 2X - up to 3A - lamp - 3B - 3- (filled node). Terminal labels legible: 1+, 1Y, 1Z, 1X, 2Y, 2Z, 2X, 3A, 3B, 3-. [verified] | III-3STMT (printed p.36). The program list 1+/1Y, 1X/2Y, 2X/3A, 3B/3- is UNCHANGED by this erratum; only the printed diagram was wrong. |
| ER-08 | III | 38 | prose_only | insert 'THEN' between statements B and C in first statement set (1x1=1). [verified] | — |
| ER-09 | III | 40 | prose_only | paragraph directly below COMPUTER REPRESENTATION OF THREE 'NOT' STATEMENTS - second sentence should read: 'Light 3 comes ON if pushbutton 1 is pushed and . . .' [verified] | III-NOT |
| ER-10 | III | 41 | prose_only | Note - the operation EITHER BUT NOT BOTH is often referred to as the EXCLUSIVE OR. Notice the 'exclusive' nature of statements A and B in the example: if EITHER A or B is true, then C will also be true. However, if BOTH A and B are either true or not true, then C will not be true. [verified] | III-XOR-PB |
| ER-11 | III | 43 | prose_only | second line on page should read: '. . . relay 2 is ON (=1) then light 3 will be ON (=1). Symbolically. . .' [verified] | III-RELAYAND |
| ER-12 | III | 43 | program_change | program correction for 'Relay AND Circuit' - change 2+/2H to 1G/2H. [verified] | III-RELAYAND - this is the correction that makes the circuit actually implement AND. The finder's inference was right and is now primary. Corrected list: 1+/1Y, 1X/1C, 1F/1-, 2+/2Y, 2X/2C, 2F/2-, 1+/1H, 1G/2H, 2G/3A, 3B/3-. |
| ER-13 | III | 46 | prose_only | the complementarity laws should be written: 1) A x notA = 0 ; 2) A + notA = 1 [verified] | — |
| ER-14 | III | 54 | program_change | program correction for 'Mind Reading' program - change 5V/45 to 5V/4S. Note: Zero (0) is considered an even number for this problem. [verified] | III-MINDREADING |
| ER-15 | III | 58 | prose_only | The condition for 'It is impossible that the statements Sara should and Camille could not can both be true' should be stated as: notC x S = error, or C + notS = truth [verified] | III-3GIRLS-BOOLEAN |
| ER-16 | III | 59 | diagram_only | circuit diagram for 'Boolean Solution' is incorrectly labeled - change 1R, 1S, 1T on far right slide switch to 3R, 3S, 3T respectively. [verified] | III-3GIRLS-BOOLEAN (diagram only) |
| ER-17 | III | 61 | diagram_only | CIRCUIT REPRESENTATION incorrect - insert 'E' before negative power connection. The sheet prints the corrected fragment: a relay-coil box whose output runs to a labelled 'E' terminal and then to the filled '-' node. [verified] | III-FARMER (diagram only, no wire change) |
| ER-18 | III | 62 | procedure | Note — when attempting solutions to the Farmer's problem, follow these steps: place the farmer and an additional passenger in the boat (move the appropriate slide switches LEFT); move the boat across the river (push pushbutton 6 to cross the river; push pushbutton 1 for the return trip); unload the boat (move the slide switches RIGHT). These steps should be repeated until the farmer and all his possessions are across the river. Notice that the farmer may make trips alone. The sheet's goal ('across the river') and p.62 step 5 ('all four objects are at home (output lights 1 through 4 are ON.)') name the same end state from different frames. [verified] | III-FARMER |
| ER-19 | IV | 69 | prose_only | Note — push pushbutton 6 slowly when operating the single-input flip-flop. Light 6 will go off and on, indicating the state of the whole flip-flop. [verified] | **`IV-FF1` only** — see C-23. Not `IV-FF2`, whose own printed text says 'light 6 is not used as an indicator in this program'; not `II-FF1`, which uses pushbutton 1 and light 1 |
| ER-20 | IV | 71 | prose_only | chart title incorrect - change 'Pushbutton carry' to 'Pushbutton.' [verified] | IV-EXP1 |
| ER-21 | IV | 72 | program_replacement | Note on 'Three-Bit Binary Counter' - the design of this counter is such that the capabilities of the relays are somewhat strained. Relays which perform to satisfaction in every other case may not perform adequately in this circuit. If the counter in Book IV does not perform correctly, use the program and circuit which follow. The circuit below by-passes the relay indicator lights so that full voltage is supplied to the relay coils, causing them to pull in more reliably. [verified] | IV-EXP1 -> substitute ER-ALTCOUNTER (48 connections, above) |
| ER-22 | IV | 73 | program_change | Experiment 2 - use the above [alternate] circuit if necessary. Experiment 3 - if you used the alternate circuit for experiments 1 and 2, use it for this experiment as well. To modify the ALTERNATE circuit for a universal counter: REMOVE 3N/4N, 5N/6N. ADD 3K/4V, 5K/6V, 3N/4S, 5N/6S, 4J/4W, 6J/6W, 4N/4R, 6N/6R. Follow the procedure on page 73 with this exception: the counter will count UP when BOTH slide switch 4 and slide switch 6 are LEFT; the counter will count DOWN when BOTH slide switch 4 and slide switch 6 are RIGHT. [verified] | IV-EXP2, IV-EXP3 |
| ER-23 | IV | 77 | prose_only | Experiment 6 - Note that the connections to M10 indicate the 'end-around carry.' This is the 'carry out' of the high order stage, and will be used when the adder is converted to a subtractor for experiment 7. (See page 78). [verified] | IV-EXP6 |
| ER-24 | IV | 79 | program_change | Experiment 7 - if you used the alternate circuit for the counter: first build the adder and modify it for a subtractor, then REMOVE 2C/2G, 3C/3G, 5C/6K, 6C/6F, 6F/M10 and ADD 2E/2G, 3E/3G, 5E/6K, 6C/M10, 6F/M+. Note that relay indicator light 6 will come ON if the subtraction has proceeded properly; light 6 ON indicates an 'end-around carry' - a carry out from the high order stage. [verified] | IV-EXP7 |
| ER-25 | IV | 80 | prose_only | Note - An ACCUMULATOR must be capable of shifting and so must include a shift register. A SHIFT REGISTER, however, need not be capable of accumulating (see automatic shift register - page 86). [verified] | IV-EXP8 |
| ER-26 | IV | 82 | prose_only | Note that decimal 60 is 111100 in binary. It is written incorrectly in two places. [verified] | IV-EXP9 - the two '11100' strings on p.82 (the last shift result and 'the final result: 11100 or 60'); the page's own '110 X 1010 = 111100' agrees |
| ER-27 | IV | 83 | program_change | Program correction for Experiment 10: REMOVE 2C/3G, 2Y/6S, 3C/4G, 5C/6K, 6F/M10. ADD 2E/3G, 2Y/3G, 3E/4G, 5E/6K, 6C/M10, 6F/M+. [verified] | IV-EXP10 - five removals, six additions, so the corrected list is one line longer than the printed 56 -> 57 |
| ER-28 | V | 2 | prose_only | Experiment 1 - Note that moving either slide switch will change the light to the opposite state (ON or OFF), regardless of the position of the other slide switch. [verified] | V-EXP1 |
| ER-29 | V | 10 | prose_only | second sentence on page should read: 'The same will be true for a train moving right through. . . .' [verified] | V-EXP7 |
| ER-30 | V | 11 | procedure | First sentence under 'To use the program' (EXPERIMENT 8) should read: 'Set the elevator at the first floor by pushing pushbutton 5.' [verified] | V-EXP8 - and this is Experiment 8's ONLY erratum. See RUL-04. |
| ER-31 | V | 11 | program_change | EXPERIMENT 9 program corrections: change 4G/4H to 4G/5H; change D16/M- to D16/M+. Note: the 'elevator' can get stuck at a floor when the pointer knob stops between adjacent terminals (e.g. between D6 and D7) and is not making proper connection with either; move the knob so it points directly at one terminal. Note: if performance is unsatisfactory, REMOVE 5F/6C, 6C/6- and ADD 5F/6E, 6E/6-, 4E/6C. [verified] | V-EXP9 |
| ER-32 | V | 12 | program_change | program corrections for automatic toll collector: REMOVE 3J/4X, 3N/6Y, 4H/5N, 4K/5N, 5L/6G. ADD 3J/4K, 3Y/4Y, 4J/4X, 4X/6L, 5N/6K. [verified] | V-EXP10 - five out, five in, corrected list stays 55 lines |
| ER-33 | V | 21-22 | program_change | Note - when programming a geometric form or a numeral for recognition, be sure that the connections from M10 are made to the TOP terminals in the matrix. [verified] | V-EXP12 and the geometric shape recognition circuit (Book V p.21, PDF p.27; no programs.md record yet) |
| ER-34 | V | 24 | program_change | RECOVERED - Experiment 14 program correction: change 4F/5G to 4F/4G. [verified] | V-EXP14 |
| ER-35 | V | 25 | prose_only | Note - to re-set the automatic sequence control, turn power OFF, then ON again. [verified] | V-EXP15 |
| ER-36 | V | 30 | program_change | 'CQ' transmitter program correction: change 5X/6E to 5X/6C (correct circuit diagram to correspond). [verified] | V-EXP16 |
| ER-37 | V | 31 | prose_only | Note - Light 6 flashes on very briefly when indicating a dot. The three successive dots may be so rapid and so close together that they are almost indistinguishable. To see them more clearly, slow the rotary switch down by holding the pointer knob back during one revolution. [verified] | V-EXP17, V-EXP18 |
| ER-38 | V | 33 | prose_only | Note to Experiment 19 - always turn the pointer knob CLOCKWISE when indicating a letter for coding. [verified] | V-EXP19 |
| ER-39 | V | 35 | prose_only | Last paragraph on page - third sentence should read: 'Light 6 will flash on whenever . . .' [verified] | V-EXP21 |
| ER-40 | VI | 51 | procedure | The Secret Code - Note: to re-set the game, turn power off, then on again. [verified] | VI-SECRETCODE |
| ER-41 | VI | 52 | procedure | The Combination Lock - Note: to re-set the game, turn the rotary switch through one complete revolution. [verified] | VI-COMBOLOCK |
| ER-42 | VI | 53 | procedure | The Electronic Maze - Note: to re-set the game, turn power off, then on again. (The sheet misspells it 'Elecronic'.) [verified] | VI-MAZE |
| ER-43 | VI | 55 | procedure | The Match Game - the first two sentences under 'To Play the Match Game' should be changed to: 'Turn the rotary switch to 15, indicating that there are 15 matches in the pile.' [verified] | VI-MATCHGAME - the finder's step 1 ('Push the re-set button (pushbutton 3). The rotary switch dial will turn to 15') is the UNCORRECTED text; per errata the dial is turned BY HAND |
| ER-44 | VI | 55 | prose_only | Tic-Tac-Toe - Note: if the game is a tie, MINIVAC will indicate a tie on the fifth move but will not indicate a move into the last available space. [verified] | VI-TICTACTOE |
| ER-45 | VI | 57 | prose_only | The Mind Reading Trick - Note: Zero (0) is considered even for this problem. [verified] | VI-MINDREADING |
| ER-46 | VI | 60 | procedure | Reaction Time Tester - Note: to prevent the players' anticipating the start signal, either make dummy connections to the rotary switch or cover the dial with an inverted box. [verified] | VI-REACTION |

Two transcriptions of **ER-15** (Book III p.58) disagree: verify-programs reads '`C x S = error, or notC + notS = truth`', gap-canonical's 300-dpi image read reads '`notC x S = error, or C + notS = truth`'. The image read wins on method. It is a `prose_only` Boolean restatement of a word problem and changes no wire. **Resolved 2026-10-14:** `errata.pdf` PDF p.2 at 400 dpi reads 'C̄ x S = error or C + S̄ = truth' (overbar on C in the error term, on S in the truth term), which agrees with gap-canonical; the verify-programs reading is wrong. The p.59 wire list implements this expression (`2R/1S`, `1T/3com`, so the circuit is S x C̄ = error).

Editor named on the sheet: Linda G. Sprague; SDC was preparing a second edition of the manual, and there is no evidence in these sources that it shipped. [verified] `errata.pdf` p.4. The sheet's own imprint reads '372 Main Street, Watertown, Massachusetts' in both header and footer — a third paper attestation of Watertown against the panel legend's Cambridge. It does **not** resolve that split; it only weights the paper side.

## 4. The corpus

98 program records from Books I-VI and the errata sheet (§4.1-§4.6), plus three Maintenance Manual check
circuits carried as a separate labelled group in §4.7 and **not** counted in the 98 — C-21's total stands.
Connection lists are given in printed reading order; where the manual prints the program as a multi-column table and the layout was recorded from an image, the printed grid is reproduced and labelled. Otherwise wires are grouped four per row for reading only — **the grouping is not the printed layout**. A mis-read column order silently permutes a list, so read order matters and is stated wherever it is known.

### 4.1 Book I — *Getting acquainted with MINIVAC 601*

Fourteen experiments, every one of them 2 to 10 wires with a stated observable. This is the conformance suite's floor. `book1.pdf`, printed page N = PDF page N+2 for pp.3-32.

| ID | Program | Printed p. | PDF p. | Wires | Tier | Tag |
|---|---|---|---|---|---|---|
| `I-EXP1` | Use of Programming Wires | 5 | 7 | 2 | A | [likely] |
| `I-EXP2` | Single Light Operation | 7 | 9 | 2 | A | [likely] |
| `I-EXP3` | Pushbutton Operation | 9 | 11 | 5 | A | [likely] |
| `I-EXP4` | Series Circuit (AND) | 10 | 12 | 4 | A | [verified] |
| `I-EXP5` | Parallel Circuit (OR) | 11 | 13 | 5 | A | [verified] |
| `I-EXP6` | Manual Relay Operation | 13 | 15 | 5 | A | [verified] |
| `I-EXP7` | Electrical Relay Operation | 15 | 17 | 8 | A | [verified] |
| `I-EXP8` | A Relay Controls Another | 16 | 18 | 9 | A | [verified] |
| `I-EXP9` | A Relay Controls Itself (bistable) | 17 | 19 | 6 | B | [verified] |
| `I-EXP10` | Slide Switch Operation | 19 | 21 | 6 | A | [likely] |
| `I-EXP11` | Manual Operation of Rotary Switch | 21 | 23 | 5 | C1 | [verified] |
| `I-EXP12` | Basic Motor Operation | 23 | 25 | 5 | C2 | [verified] |
| `I-EXP13` | Motor Driven Rotary Switch | 23 | 25 | 10 | C2 | [verified] |
| `I-EXP14` | Motor Reversing | 24 | 26 | 6 | C2 | [verified] |
| `I-PROBLEMS` | Problem set (20 problems + printed answers) | 28-32 | 30-34 | varies | — | [unverified] except ANSWER 13-15 |

### I-EXP1 — Experiment 1: Use of Programming Wires

Book I printed p.5 · `book1.pdf` PDF p.7 · 2 wires · tier A · **[likely]** clean body OCR; not image-read (finder tagged [verified] under the struck policy, C-20)

| | | | |
|---|---|---|---|
| `1+/1A` | `1B/1-` |  |  |

**Procedure (as printed)**

- Take two programming wires. Connect one end of the first wire to terminal 1+ 'by pushing it into one of the two holes just below the + in section 1 of the computer.'
- Connect the other end of that wire to terminal 1A 'by pushing it into one of the two holes just above the letter A in section 1 of the computer.'
- Similarly, connect terminal 1B to terminal 1- with the second programming wire.
- Turn the Power Switch on: lamp 1 lights.
- Disconnect the wires by pulling both ends from the terminals - not by pulling on the wire.

**Expected behaviour (as printed)**

- Light 1 comes on when power is on.

**Notes**

- This page is the source of the two-holes-per-terminal statement and of the slash shorthand. [verified]

### I-EXP2 — Experiment 2: Single Light Operation

Book I printed p.7 · `book1.pdf` PDF p.9 · 2 wires · tier A · **[likely]** clean body OCR; not image-read

| | | | |
|---|---|---|---|
| `1+/1A` | `1-/1B` |  |  |

**Procedure (as printed)**

- Using two short programming wires, make the connections 1+/1A and 1-/1B.
- Turn the power switch ON. Light 1 comes ON because current flows through the light.
- Turn the power switch OFF and disconnect the programming wires.

**Expected behaviour (as printed)**

- Light 1 ON. 'Any of the lights may be operated by connecting programming wires from + to A and from - to B just as was done for light 1.'
- 'The light OFF will represent a zero (0) and the light ON will represent a one (1).'

### I-EXP3 — Experiment 3: Pushbutton Operation

Book I printed p.9 · `book1.pdf` PDF p.11 · 5 wires · tier A · **[likely]** clean body OCR; not image-read

First three wires are step 2 (normally-open branch); last two are added at step 4 (normally-closed branch). This is the page that establishes break-before-make.

| | | | |
|---|---|---|---|
| `1+/1Y` | `1X/1A` | `1-/1B` | `1Z/2A` |
| `2B/2-` |  |  |  |

**Procedure (as printed)**

- Program the normally-open pushbutton-light circuit: 1+/1Y, 1X/1A, 1-/1B.
- Turn power ON. Push DOWN on pushbutton 1: light 1 comes ON. Release: light 1 goes OFF. Turn power OFF.
- Add the normally-closed branch: 1Z/2A, 2B/2-.
- Turn power ON. Light 2 comes on as soon as power is turned ON (through the normally closed contact Z of pushbutton 1).
- Push down on pushbutton 1. Light 2 goes OFF and light 1 comes ON.
- Push up and down slowly: one light always goes OFF before the other comes ON - the pushbuttons are 'break-before-make'.

**Expected behaviour (as printed)**

- Pushbutton contacts: UP = Y/Z connected; DOWN = X/Y connected. Y is the common contact. [verified from the same page]
- 'The pushbutton UP will represent a zero (0), and the pushbutton DOWN will represent a one (1).'

### I-EXP4 — Experiment 4: Series Circuit (AND)

Book I printed p.10 · `book1.pdf` PDF p.12 · 4 wires · tier A · **[verified]** 500 dpi crop of `book1.pdf` p.12

| | | | |
|---|---|---|---|
| `1+/1Y` | `1X/2Y` | `2X/2A` | `2B/2-` |

**Procedure (as printed)**

- Turn the power switch ON and push down pushbutton 1. Light 2 does NOT light.
- Release pushbutton 1 and push down pushbutton 2. Light 2 still does NOT light.
- Push down both pushbutton 1 and pushbutton 2 at the same time and see light 2 go ON.

**Expected behaviour (as printed)**

- Light 2 lights only when both pushbuttons are down. 'AN AND CIRCUIT.'

### I-EXP5 — Experiment 5: Parallel Circuit (OR)

Book I printed p.11 · `book1.pdf` PDF p.13 · 5 wires · tier A · **[verified]** 500 dpi crop of `book1.pdf` p.13

| | | | |
|---|---|---|---|
| `1+/1Y` | `1X/1A` | `1B/1-` | `1Y/2Y` |
| `2X/1X` |  |  |  |

**Procedure (as printed)**

- Turn the power switch ON. The light does not come on.
- Push down pushbutton 1. Light 1 comes ON (through 1X).
- Release pushbutton 1 and push down pushbutton 2. The light again comes ON (through 2X).
- Push down both at the same time. The light is ON.

**Expected behaviour (as printed)**

- Light 1 lights if pushbutton 1 OR pushbutton 2 OR both are down. 'AN OR CIRCUIT.'

### I-EXP6 — Experiment 6: Manual Relay Operation

Book I printed p.13 · `book1.pdf` PDF p.15 · 5 wires · tier A · **[verified]** 500 dpi crop of `book1.pdf` p.15; restated on printed p.15

| | | | |
|---|---|---|---|
| `1+/1H` | `1J/2A` | `1B/1-` | `1G/1A` |
| `2B/2-` |  |  |  |

**Procedure (as printed)**

- Connect the contacts of relay 1 to turn light 2 ON when the relay is OFF, and to turn light 1 ON when the relay is ON.
- Turn power ON. Light 2 comes ON.
- Gently push the relay crossbar to the left. Light 2 goes OFF and light 1 comes ON.
- Watch the relay arm alternately touch one contact and then the other as the relay crossbar is moved back and forth.

**Expected behaviour (as printed)**

- Relay OFF: H-J and L-N connected. Relay ON: H-G and L-K connected. [verified, book1 PDF p14 printed p12]
- Relay terminals below the relay: G, H, J, K, L, N. [verified, same page]

Errata **ER-01**: the circuit diagram on p.13 is wrong — delete the line connecting `1B` and `2B`. Diagram only; the program list stands. [verified]

### I-EXP7 — Experiment 7: Electrical Relay Operation

Book I printed p.15 · `book1.pdf` PDF p.17 · 8 wires · tier A · **[verified]** 500 dpi crops of `book1.pdf` p.17

First five wires are the contact circuit; last three are the coil circuit.

| | | | |
|---|---|---|---|
| `1+/1H` | `1J/2A` | `1B/1-` | `1G/1A` |
| `2B/2-` | `1+/1Y` | `1X/1E` | `1F/1-` |

**Procedure (as printed)**

- Turn power ON. Light 2 comes ON.
- Press down pushbutton 1 and see the relay operate. Light 2 goes OFF and light 1 comes ON.
- (Open exercise) Connect the other set of relay contacts (1K, 1L, 1N) to two unused lights so one light comes ON when the relay is OFF and the other when it is ON.

**Expected behaviour (as printed)**

- Relay coil terminals above each relay are C, E and F. Energizing through C and F lights the relay indicator lamp (which is wired in series with the coil); energizing through E and F does not. [verified, book1 PDF p16 printed p14]

**Modification (as printed):** remove `1X/1E`, add `1X/1C` — the coil indicator lamp then lights when relay 1's coil is energised. This is the page that establishes the lamp-in-series-with-coil topology: energising through `C` and `F` lights the relay indicator lamp, energising through `E` and `F` does not. [verified] Book I printed p.14.

### I-EXP8 — Experiment 8: A Relay Controls Another

Book I printed p.16 · `book1.pdf` PDF p.18 · 9 wires · tier A · **[verified]** 500 dpi crop of `book1.pdf` p.18

| | | | |
|---|---|---|---|
| `1+/1Y` | `1X/1C` | `1F/1-` | `1+/1H` |
| `1G/2C` | `2F/2-` | `2+/2H` | `2G/2A` |
| `2B/2-` |  |  |  |

**Procedure (as printed)**

- Turn power ON and manually operate relay 2 by pushing the plastic crossbar to the left. See light 2 come ON.
- Release relay 2 and manually operate relay 1. Relay 2 will click ON and light 2 will come ON.
- Release relay 1 and press pushbutton 1. Relay 1 is turned ON by pushbutton 1, relay 2 by relay 1's contacts, and light 2 by relay 2's contacts.
- (Open exercise) Expand to all six relays in a chain, the last turning light 6 ON.

`1X/1C` is correct. `find-relays.json` RLY-27 gives `1Y/1C` for this program; that is wrong and would leave relay 1 permanently energised at power-up. [likely] gap RUL-02.

### I-EXP9 — Experiment 9: A Relay Controls Itself (bistable / self-holding)

Book I printed p.17 · `book1.pdf` PDF p.19 · 6 wires · tier B · **[verified]** 500 dpi crop of `book1.pdf` p.19

| | | | |
|---|---|---|---|
| `1F/1-` | `1C/1X` | `1Y/2Y` | `2Y/2+` |
| `2Z/1L` | `1K/1C` |  |  |

**Procedure (as printed)**

- Push pushbutton 1 and release. The relay indicator light comes ON and stays ON.
- Push pushbutton 2 and release. This momentarily interrupts current flow through the coil and turns the relay OFF.
- Operate the circuit back and forth a few times.

**Expected behaviour (as printed)**

- Relay 1 latches ON via its own K/L contacts; pushbutton 2 (normally-closed 2Z) breaks the hold. 'This circuit is called bistable.'
- Relay OFF represents 0, relay ON represents 1.

### I-EXP10 — Experiment 10: Slide Switch Operation

Book I printed p.19 · `book1.pdf` PDF p.21 · 6 wires · tier A · **[likely]** clean OCR; not image-read

| | | | |
|---|---|---|---|
| `1-/1B` | `1A/1R` | `1S/1+` | `2-/2B` |
| `2A/1W` | `1V/1S` |  |  |

**Procedure (as printed)**

- Move switch 1 to the LEFT and turn the power ON. Light 1 comes ON but light 2 remains OFF.
- Move switch 1 to the right. Light 1 goes OFF and light 2 comes ON.

**Expected behaviour (as printed)**

- Slide switch terminals are R, S, T, U, V, W. LEFT: S-R and V-U connected. RIGHT: S-T and V-W connected. [verified, book1 PDF p20 printed p18]

### I-EXP11 — Experiment 11: Manual Operation of Rotary Switch

Book I printed p.21 · `book1.pdf` PDF p.23 · 5 wires · tier C1 · **[verified]** the same five wires appear verbatim inside the image-read Exp 13 combined list, `book1.pdf` p.25

| | | | |
|---|---|---|---|
| `6+/D16` | `D2/6A` | `6-/6B` | `D1/5A` |
| `5B/6B` |  |  |  |

**Procedure (as printed)**

- Turn power ON and rotate the pointer to number 1. Light 5 comes ON and remains ON as long as the pointer points at 1.
- Rotate the pointer to number 2. Light 5 goes OFF and light 6 comes ON. Light 5 goes OFF BEFORE light 6 comes on - the rotary switch is 'break-before-make'.

**Expected behaviour (as printed)**

- D = Decimal Input-Output; terminal numbers 1 to 19; the wiper-arm contact is referred to as D16. When the pointer knob points at 1, the wiper connects D1 and D16. [verified as printed, book1 PDF p22 printed p20] — but **the printed range `1 to 19` is an SDC misprint**, and the factory errata never corrects it. The real range is **D0..D19**. MM p.10 gives it correctly ("connecting output lights through the rotary switch contacts, D0 through D15"), `D0` has its own jack pair under dial sector 0, the same page's VIEW UNDER PANEL figure shows a contact at 0, the errata sheet itself names `D0` in passing (ER-03, Book I p.28 Problem 18: "keep the rotary switch from stopping at D0") while never correcting the range statement, and `D0` appears in **13 program lines in this file** (`V-EXP4` `D15/D0`, `V-EXP19` `3E/D0`, `ER-ALTCOUNTER`'s neighbours among them). A terminal namespace generated from this block must be D0..D19, not D1..D19. See `jack-map.md` §10 / `open-questions.md` C15 / `panel.md` D5.

This is the page that establishes the rotary switch is **break-before-make**, in the same words used for the pushbuttons. [verified] Book I printed p.21.

### I-EXP12 — Experiment 12: Basic Motor Operation

Book I printed p.23 · `book1.pdf` PDF p.25 · 5 wires · tier C2 · **[verified]** 130 dpi image read of `book1.pdf` p.25 by the verifier (UP-03)

| | | | |
|---|---|---|---|
| `6+/5Y` | `5X/D17` | `6-/D18` | `6-/6Y` |
| `6X/D19` |  |  |  |

**Procedure (as printed)**

- Turn the power ON. Push pushbutton 5. This supplies power to the RUN terminals (D17 and D18) and causes the pointer of the rotary switch to rotate.
- While holding pushbutton 5 down, push pushbutton 6. The motor stops when pushbutton 6 is pushed because a short circuit is created across the STOP terminals (D18 and D19). Current flows through pushbutton 6 instead of through the motor.
- While holding pushbutton 5 down, release pushbutton 6. The motor drive operates again because the short circuit has been removed.
- Release pushbutton 5. The motor drive again stops, this time because power is no longer connected to the motor circuit.

**Expected behaviour (as printed)**

- Terminals 17, 18 and 19 are located on the panel just to the left of the pointer knob and rotary switch terminals. Power must be supplied to terminals 17 and 18 (run) to operate the motor drive. A short circuit may be connected across terminals 18 and 19 (stop) to halt the motor drive. [verified, book1 PDF p24 printed p22]

**Per-line flags**

| Line | Tag | Note |
|---|---|---|
| `6-/D18` | [verified] | Book I Exp 13 restates the same connection as `5-/D18` and Book I Answer 13 as `D18/M-`. All three are the same node — the errata makes every `-` terminal one node (ERG-02). Not a discrepancy; recorded only so it is not re-opened. |

The finder flagged `6-/D18` against Exp 13's `5-/D18`. **No discrepancy** — same node (C-02, C-03). The flag is struck.

### I-EXP13 — Experiment 13: Motor Driven Rotary Switch (pulse generator / programmer)

Book I printed p.23 · `book1.pdf` PDF p.25 · 10 wires · tier C2 · **[verified]** 500 dpi crop (finder) and 130 dpi read (verifier) of `book1.pdf` p.25; both complete and in order

| | | | |
|---|---|---|---|
| `6+/D16` | `D2/6A` | `6-/6B` | `D1/5A` |
| `5B/6B` | `6+/5Y` | `5X/D17` | `5-/D18` |
| `6-/6Y` | `6X/D19` |  |  |

**Procedure (as printed)**

- Push pushbutton 5. The motor rotates the pointer knob as in Experiment 11. As the pointer knob turns, light 5 and light 6 flash ON in sequence. The rotary switch is automatically generating electrical pulses to flash the lights. First, light 5 flashes and then light 6 flashes, once each revolution of the rotary switch.
- While holding pushbutton 5 down, push pushbutton 6. The pointer knob STOPS turning and the lights STOP flashing.

**Expected behaviour (as printed)**

- The rotary switch is automatically generating electrical pulses to flash the lights. First, light 5 flashes and then light 6 flashes, once each revolution of the rotary switch.

### I-EXP14 — Experiment 14: Motor Reversing

Book I printed p.24 · `book1.pdf` PDF p.26 · 6 wires · tier C2 · **[verified]** image-read at 300 dpi (Phase 5 batch 04-06 review): the program block reads `6+/6R 6T/6U 6V/D17 / 6+/6W 6S/D18 / 6-/6T`, six lines, all match

| | | | |
|---|---|---|---|
| `6+/6R` | `6+/6W` | `6-/6T` | `6T/6U` |
| `6S/D18` | `6V/D17` |  |  |

**Procedure (as printed)**

- Trace the direction of current flow from 6+ through the motor to 6- with the switch in the right position and then again with the switch in the left position.
- Turn power ON and notice the direction of rotation.
- Change the position of switch 6. The motor reverses direction and the pointer knob turns in the opposite direction.
- Step 3 also prints: "The current flow through the motor is reversed when the switch position is changed."

**Expected behaviour (as printed)**

- Slide switch 6 reverses the polarity applied to the motor RUN terminals D17/D18, reversing the rotary switch direction.

**Notes**

- Self-consistent: with the switch LEFT, S-R puts D18 at +, V-U puts D17 at - (via the 6T/6U jumper to 6-); with the switch RIGHT, S-T puts D18 at - and V-W puts D17 at +.

Errata **ER-02**: the MOTOR REVERSING *diagram* is mislabelled — change `6Y` to `6V`. The printed *program* already reads `6V/D17`, so this six-line list needs no change. [verified] `errata.pdf` p.1 (image-read at 150 dpi: "page 24: 'MOTOR REVERSING' circuit diagram incorrectly labeled — change 6Y to 6V"); `book1.pdf` p.26 image-read at 300 dpi.

- The page prints no answers and no direction of rotation for either switch position. The motor reversal is printed but cannot be asserted: the fixture observable set has no motor direction or speed field, and a dial-position `until` also matches when the wiper comes the long way round (O-C14). The simulator does reverse the drive (corpus-smoke: `power: motor -45000 mrpm | sw6 throw: motor 45000 mrpm`).

### I-PROBLEMS — Book I problem set and printed answers

Book I printed p.28 (problems), pp.29-32 (answers) · `book1.pdf` PDF p.30, pp.31-34 · 20 answer programs · tier A/C · **[unverified]** except ANSWERS 13-15

**Do not use these as fixtures without an image pass.** The answer pages are hand-lettered and interleaved with circuit drawings; the OCR layer is materially degraded (1/I/l and 0/O/D confusions, dropped lines). gap-canonical image-read `book1.pdf` PDF p.33 at 300 dpi, which promotes ANSWER 13, ANSWER 14 and ANSWER 15 (complete: five lines; its diagram draws `5Z` but wires nothing to it); gap-verify UP-06 independently confirmed 13 and 14. Everything else is still OCR. Six 300-dpi crops of `book1.pdf` pp.31-34 would close this.

| # | Answer wiring | Tag | Note |
|---|---|---|---|
| 1 | `1+/1Y` `1X/1A` `2+/2Y` `2X/2A` `1B/1-` `2B/2-` | [unverified] |  |
| 2 | `1+/1Y` `1Z/2X` `2Y/1A` `1B/1-` | [unverified] |  |
| 3 | `1+/1Y` `1X/2X` `1Z/2Z` `2Y/1A` `1B/1-` | [unverified] | OCR shows '1 +/1 Y  1 V 2Z / 1 V 2X  2Y/1A / 1B/l -'; the middle two lines are ambiguous. Best mechanical reading is 1X/2Z and 1Z/2X (an EITHER-BUT-NOT-BOTH), which the problem statement demands (light 1 ON if either pushbutton but not both). NOT settled by the OCR. |
| 4 | `1+/1Y` `1X/2A` `2B/2-` `1Z/2X` `2Y/1A` `1B/1-` | [unverified] |  |
| 5 | `1+/1S` `1S/1Y` `1Y/2Y` `2X/1X` `1R/1X` `1X/1A` `1B/1-` | [unverified] | OCR shows '1+ /1S  1 V 'R / 1S/1 Y  1 V IA / 1Y/2Y  1B/l - / 2X/1X'. The two '1 V' tokens are unreadable; my reading of 1R/1X and 1X/1A is inference. |
| 6 | `1+/1Y` `1X/1R` `1S/2Y` `2X/2T` `2S/1A` `1-/1B` | [unverified] |  |
| 7 | `1-/1B` `1A/1X` `1+/1Y` `1X/1Z` `1X/2X` `2Y/1C` `1F/2-` | [unverified] | heavily damaged OCR |
| 8 | `1-/1B` `1X/1R` `1+/1S` `1S/1V` `1W/1C` `1F/1-` `2-/2B` `2A/1T` `2-/2F` `2C/1U` | [unverified] |  |
| 9 | `1+/1G` `1G/1X` `1Y/1H` `1H/1C` `1F/1-` `1F/2Y` `1E/2X` | [unverified] | printed note: '2Z (not used)' - this is the answer to problem 9, which forbids terminal 2Z |
| 10 | `1+/1Y` `1X/1S` `1R/1C` `1T/2C` `1F/1-` `2F/2-` | [unverified] |  |
| 11 | `1+/1H` `1H/1Y` `1Y/2Y` `1X/1C` `1F/1-` `2X/2C` `2F/2-` `1G/1R` `1S/2S` `2T/2J` `2H/1A` `1B/2-` | [unverified] |  |
| 12 | `2-/2B` `2A/1T` `2+/2Y` `2Y/1Y` `1T/2R` `2R/1J` `1J/2G` `1+/1S` `1S/2S` `2S/1H` `1H/2H` `1X/1C` `1F/1-` `2X/2C` `2F/2-` | [unverified] |  |
| 13 | `6+/6Y` `6X/6A` `6B/6-` `6X/D17` `D18/M-` | [verified] | **[verified]** 300 dpi, `book1.pdf` p.33 (gap + gap-verify UP-06). Diagram: `6A`-lamp-`6B`-`6-`; `6X` tied both to `6A` and down to `D17`; `6Y` tied to `6+`; `6Z` unused; `M-`/`D18`/`D19` feed the motor through resistors. Dissolves the `6-/D18` vs `5-/D18` question — this prints `D18/M-`, a third spelling of the same node. **The finder's OCR list for this answer was wrong on two lines** — it read `6J/6A` and `6Y/D17`; the image reads `6X/6A` and `6X/D17`, and both image passes agree. |
| 14 | `5+/5Y` `5Z/6X` `6Y/D17` `M-/D18` | [verified] | **[verified]** 300 dpi, `book1.pdf` p.33 (gap + gap-verify UP-06). |
| 15 | `6+/6X` `6Y/D17` `M-/D18` `D18/5X` `5Y/D19` | [verified] | **[verified]** 300 dpi, `book1.pdf` p.33; five lines in full, nothing further in the diagram (re-read, Phase 5 batch 04-06 review). |
| 16 | `5+/5Y` `5Z/6X` `6Y/6J` `6Z/5X` `6Z/6C` `6F/6-` `6J/6K` `6-/6G` `6G/6N` `6L/D18` `6H/D17` | [unverified] |  |
| 17 | `6+/6J` `6J/6K` `6K/D6` `6E/D16` `6F/6-` `6G/D1` `6C/6L` `6L/D18` `6H/D17` `6-/6N` `6N/6G` | [unverified] | This is the cleanest of the answer OCRs (11 wires, matching the problem's 'Use only 11 programming wires'). Problem 17: turn the rotary switch back and forth between numbers 1 and 6. |
| 18 | `6+/6Y` `6X/D17` `M-/D18` `5Z/D18` `5Y/D0` `D16/D19` | [unverified] | OCR shows '6X/DU' for the second line |
| 19 | `D1/1A` `D2/2A` `D3/3A` `D4/4A` `D5/5A` `D6/6A` `1B/1-` `2B/2-` `3B/3-` `4B/4-` `5B/5-` `6B/6-` `6+/6Y` `6X/D17` `M-/D18` `M+/D16` | [unverified] |  |
| 20 | `1-/1B` `1-/1C` `1A/1E` `1E/2G` `1F/2F` `1H/1F` `1G/1Y` `1Y/1+` `1X/1J` `1J/2H` `2J/2E` `2E/2A` `2B/2-` `2-/2C` | [unverified] |  |

Errata **ER-03** [verified]: *Problem 7* — light 1 and relay 1 should both be on **only** if **both** pushbutton 1 and pushbutton 2 are DOWN. *Problem 18* — pushbutton 5 is used to keep the rotary switch from stopping at `D0` when pushbutton 6 is being held down.

Problem statements are in clean body OCR on `book1.pdf` PDF p.30. The load-bearing ones: P1 two independent lights; P2 exclusive-or; P3/P4 truth tables given; P5 OR with a slide switch; P6 four-term AND; P7-P12 relays; P13-P19 rotary switch (Problems 13-15 are image-verified at 300 dpi, `book1.pdf` PDF p.30 **[verified]**: "13) Design a circuit in which the rotary switch turns and light 6 comes ON when pushbutton 6 is pushed." "14) Design a circuit in which the rotary switch turns only when pushbutton 6 is down. The rotary switch should NOT turn when pushbutton 6 is up, or when both pushbutton 6 and pushbutton 5 are down." "15) Design a circuit to meet the requirements of problem 14 using terminal 5X."); P17 'turn the rotary switch back and forth between numbers 1 and 6, use only 11 programming wires'; P20 toggle relay 1 on successive presses of pushbutton 1 without the rotary switch. [likely] `book1.pdf` p.30.

### 4.2 Book II — *What is a Digital Computer?*

**The entire book was missing from the first research pass.** `find-programs.json` contains exactly one Book II entry and that entry is actually Book III (C-08). Eleven programs recovered by the verifier; four of them since image-verified. Book II printed page N = PDF page N+6 in `book2-3-4.pdf`.

| ID | Program | Printed p. | PDF p. | Wires | Tier | Tag |
|---|---|---|---|---|---|---|
| `II-EXP1` | Experiment 1: Binary Input | 6 | 12 | 26 | B | [verified] |
| `II-EXP2` | Experiment 2: Decimal Input | 7 | 13 | 23 | C1 | [verified] |
| `II-EXP3` | Experiment 3: Secondary Storage | 9 | 15 | 3 | A | [verified] |
| `II-MANUALMEM` | Manual Relay Memory Circuit | 10 | 16 | 6 | B | [likely] |
| `II-SELFLOCK` | Self-Locking Relay Memory Circuit | 10 | 16 | 7 | B | [likely] |
| `II-2BUTTONMEM` | Two-Button Relay Memory (two-input flip-flop) | 11 | 17 | 8 | B | [verified] |
| `II-FF1` | The Single Input Flip-Flop | 12 | 18 | 14 | B | [verified] |
| `II-EXP4` | Experiment 4: Control | 13 | 19 | 9 | C2 | [verified] |
| `II-EXP5` | Experiment 5: Decision Making (equality comparator) | 13-14 | 19-20 | 13 | A | [likely] |
| `II-EXP6` | Experiment 6: Arithmetic (one-bit adder) | 14 | 20 | 15 | A | [likely] |
| `II-EXP7` | Experiment 7: Decimal Output | 15-16 | 21-22 | 16 | C2 | [verified] |

### II-EXP1 — Experiment 1: Binary Input

Book II printed p.6 · `book2-3-4.pdf` PDF p.12 · 26 wires · tier B · **[verified]** 300 dpi image read, `book2-3-4.pdf` p.12 (Phase 5 batch 10-13, wave 3: author and fidelity reviewer): six columns, column 6 holds only `5F/5-`; the `pdftotext` layer drops column 6 (the earlier 25-wire record was a transcription defect, not a manual defect)

Column 6 holds only one entry; columns 1-5 hold five each. Read column-major.

| col 1 | col 2 | col 3 | col 4 | col 5 | col 6 |
|---|---|---|---|---|---|
| `1X/2X` | `6Z/6+` | `2H/1H` | `2G/2C` | `4Y/4G` | `5F/5-` |
| `2X/3X` | `6Y/5H` | `1Y/1G` | `2F/2-` | `4G/4C` |  |
| `3X/4X` | `5H/4H` | `1G/1C` | `3Y/3G` | `4F/4-` |  |
| `4X/5X` | `4H/3H` | `1F/1-` | `3G/3C` | `5Y/5G` |  |
| `5X/6Y` | `3H/2H` | `2Y/2G` | `3F/3-` | `5G/5C` |  |

**Behaviour (as printed)**

- Relay light 1 comes ON to indicate that a "one" is being remembered (stored).
- Relay light 2 remains OFF to indicate that a "zero" is being remembered (stored).
- Relay light 3 remains OFF to indicate that a "zero" is being remembered.
- Relay light 4 comes ON to indicate that a "one" is being remembered by section 4.
- Relay light 5 comes ON to indicate that a "one" is being remembered by section 5.
- All relay lights go OFF, and the previous number is forgotten ("cleared" from the memory).

Steps 1-6 of BK2 printed p.6 (PDF p.12), in order: push pushbutton 1 and release; pushbuttons 2 and 3 are not pushed; push pushbutton 4; push pushbutton 5; push pushbutton 6. Steps 4 and 5 print "Push pushbutton N" without "and release"; the fixture releases after each, following step 1's "Push pushbutton 1 and release" (the same "transmit a one" action). Convention: pushbutton down = "one", up = "zero"; pushbutton 6 is the clear instruction. The binary number 10011 (19) is stated to be remembered in the first five sections once step 5 is done, with no lamp named; relay armature states are not stated (Step 7). Relay 6 and lamp 6 are unwired.

### II-EXP2 — Experiment 2: Decimal Input

Book II printed p.7 · `book2-3-4.pdf` PDF p.13 · 23 wires · tier C1 · **[verified]** 300 dpi crop of `book2-3-4.pdf` p.13; count closed at 23

Column 5 holds only three entries; columns 1-4 hold five each.

Printed layout: 5 columns x 5 rows, read column-major.

| col 1 | col 2 | col 3 | col 4 | col 5 |
|---|---|---|---|---|
| `1H/2H` | `6Z/6+` | `1F/1-` | `3G/3C` | `D5/5G` |
| `2H/3H` | `6Y/5X` | `D2/2G` | `3F/3-` | `5G/5C` |
| `3H/4H` | `5Y/D16` | `2G/2C` | `D4/4G` | `5F/5-` |
| `4H/5H` | `D1/1G` | `2F/2-` | `4G/4C` |  |
| `5H/6Y` | `1G/1C` | `D3/3G` | `4F/4-` |  |

**Initial settings (as printed)**

- Power ON.

**Printed semantics**

'With decimal data, the number being remembered corresponds with the section (1-6) which has a relay light ON.' Program covers digits 1-5 only.

**Expected observables are the relay indicator lights, not the binary output lamps.** The program contains no `A` or `B` terminal, so a lamp assertion would assert the state of an unwired lamp (C-15). Printed steps: turn the dial to 4, push pushbutton 5 — relay light 4 comes ON; push pushbutton 6 — relay light 4 goes OFF. [verified] `book2-3-4.pdf` p.13. Printed semantics: 'With decimal data, the number being remembered corresponds with the section (1-6) which has a relay light ON.' Program covers digits 1-5 only.

### II-EXP3 — Experiment 3: Secondary Storage

Book II printed p.9 · `book2-3-4.pdf` PDF p.15 · 3 wires · tier A · **[verified]** 150 dpi page image, `book2-3-4.pdf` p.15

| | | | |
|---|---|---|---|
| `1+/1R` | `1S/1A` | `1B/1-` |  |

**Behaviour (as printed)**

Slide switch left = 1 (light 1 ON), right = 0 (light 1 OFF). Convention stated on the same page: switch right = 0, switch left = 1.

Convention stated on the same page: slide switch RIGHT = 0, LEFT = 1.

### II-MANUALMEM — Manual Relay Memory Circuit

Book II printed p.10 · `book2-3-4.pdf` PDF p.16 · 6 wires · tier B · **[likely]** OCR of `book2-3-4.pdf` p.16; not image-verified

| | | | |
|---|---|---|---|
| `1+/1Y` | `1+/1H` | `1X/1C` | `1-/1F` |
| `1G/1A` | `1B/1-` |  |  |

**Behaviour (as printed)**

Relay 1 remembers 1 only while pushbutton 1 is held down; releasing it reverts to 0.

Errata **ER-04** [verified]: p.10 third complete paragraph, second line — change DOWN to ON. Prose only.

### II-SELFLOCK — Self-Locking Relay Memory Circuit

Book II printed p.10 · `book2-3-4.pdf` PDF p.16 · 7 wires · tier B · **[likely]** OCR of `book2-3-4.pdf` p.16; not image-verified

| | | | |
|---|---|---|---|
| `1+/1Y` | `1+/1H` | `1X/1C` | `1-/1F` |
| `1G/1A` | `1B/1-` | `1C/1A` |  |

**Behaviour (as printed)**

Adds 1C/1A, giving a second current path through the relay's own normally-open contact - the relay latches ON and cannot be cleared except by removing power.

**Power-up state is OFF, not ON.** The holding path runs `1+ -> 1H -> 1G` (normally open) `-> 1A -> 1C ->` lamp `->` coil `-> 1F ->` minus. At cold start relay 1 is unoperated, `1H`-`1G` is open, the coil sees nothing. It latches only after pushbutton 1 has been pressed once (C-14). This is the fixture that catches a wrong self-holding model: once latched, the simulator must **not** be able to clear it except by removing power.

### II-2BUTTONMEM — Two-Button Relay Memory Circuit (two-input flip-flop)

Book II printed p.11 · `book2-3-4.pdf` PDF p.17 · 8 wires · tier B · **[verified]** 130 dpi page image, `book2-3-4.pdf` p.17

| | | | |
|---|---|---|---|
| `1+/1Y` | `1+/1H` | `1X/1C` | `1G/1C` |
| `1B/1-` | `2-/2Y` | `2Z/1F` | `1A/1C` |

**Corrected wire list (errata ER-05: `1A/1C` -> `1A/1G`)**

| | | | |
|---|---|---|---|
| `1+/1Y` | `1+/1H` | `1X/1C` | `1G/1C` |
| `1B/1-` | `2-/2Y` | `2Z/1F` | `1A/1G` |

**Behaviour (as printed)**

Pushbutton 1 = 'forget 0, remember 1'; pushbutton 2 (normally-closed contacts, via 2Z) = 'forget 1, remember 0'. Book II names this the two-input flip-flop.

Errata **ER-05** [verified]: change `1A/1C` to `1A/1G`; delete the `1A/1C` connection on the circuit diagram. Book II names this the two-input flip-flop: pushbutton 1 = 'forget 0, remember 1'; pushbutton 2 (normally-closed, via `2Z`) = 'forget 1, remember 0'.

### II-FF1 — The Single Input Flip-Flop (Book II printing)

Book II printed p.12 · `book2-3-4.pdf` PDF p.18 · 14 wires · tier B · **[verified]** 260 dpi crop of `book2-3-4.pdf` p.18 (program) and p.17 (prose)

Printed as a single column of 14.

| | | | |
|---|---|---|---|
| `1-/1B` | `1-/1C` | `1A/1E` | `1E/2G` |
| `1F/2F` | `1H/1F` | `1G/1Y` | `1Y/1+` |
| `1X/1J` | `1J/2H` | `2J/2E` | `2E/2A` |
| `2B/2-` | `2-/2C` |  |  |

**Printed behaviour, verbatim**

'Once this circuit has been programmed on MINIVAC 601, pushing one pushbutton will signal the computer to remember a 1 or a 0. If the relays are remembering a 1, pushing pushbutton 1 will signal them to "forget 1 and start remembering 0". If the relays are remembering a 0, pushing pushbutton 1 will signal them to "stop remembering 0 and start remembering 1". Light 1 will be ON when the flip-flop is remembering a 1, and will be OFF when the flip-flop is remembering a 0.'

**The primary timing fixture.** Its behaviour lives entirely in the pushbutton *release* edge: on press, relay B copies relay A; on release, relay B forces relay A to the opposite state. The simulator must model press and release as separate events and settle to fixpoint between them. A simulator that settles once per 'button press' passes every combinational fixture in this corpus and fails this one.

**No erratum applies to this record.** ER-19 is filed at Book IV printed p.69 and names *pushbutton 6* and
*Light 6*; this circuit uses pushbutton 1 and light 1, and the erratum belongs to `IV-FF1` alone (C-23). Cite it
as a cross-reference, not as this program's erratum. That the 'operate it slowly' caution *generalises* to every
single-input flip-flop is **[unverified]** — physically plausible, nowhere printed. The press/release-edge
requirement above stands on this record's own printed behaviour text, not on ER-19.

Power-up assertion (lamp 1 OFF) is **[unverified]** — derived from 'Light 1 will be OFF when the flip-flop is remembering a 0'; the page prints no numbered power-up step. Source `FALLBACK-PWRUP-COLD`.

### II-EXP4 — Experiment 4: Control

Book II printed p.13 · `book2-3-4.pdf` PDF p.19 · 9 wires · tier C2 · **[verified]** wire list image-read from `book2-3-4.pdf` PDF p.19 at 300 and 400 dpi (Phase 5 Step 6 author plus two reviewers), all 9 lines match

| | | | |
|---|---|---|---|
| `5+/5Y` | `5X/5C` | `5F/5-` | `5+/5H` |
| `5G/6C` | `6F/6-` | `6+/6H` | `6G/D17` |
| `D18/M-` |  |  |  |

**Behaviour (as printed)**

The rotary switch is controlled by the Processing Unit. Turn power ON. Push pushbutton 5. This energizes relay 5 (turns it ON) and causes current to flow through the switch contacts of relay 5 to relay 6. Relay 6 controls the operation of the motor. If pushbutton 5 is DOWN, turn relay 5 ON. If relay 5 is ON, turn relay 6 ON. If relay 6 is ON, turn motor ON. (`book2-3-4.pdf` PDF p.19, image-read.) The page prints no lamp state, release step, dial position or direction.

### II-EXP5 — Experiment 5: Decision Making (equality comparator)

Book II printed pp.13-14 · `book2-3-4.pdf` PDF pp.19-20 · 13 wires · tier A · **[likely]** OCR of `book2-3-4.pdf` p.19; not image-verified

| | | | |
|---|---|---|---|
| `1+/1H` | `1H/1L` | `1L/1X` | `1Y/1C` |
| `1F/1-` | `1X/2X` | `2Y/2C` | `2F/2-` |
| `1J/2H` | `2J/2K` | `1K/2L` | `2K/3C` |
| `3F/3-` |  |  |  |

**Behaviour (as printed)**

Pushbuttons 1 and 2 carry the two binary numbers to compare. Relay 3 comes ON if they are equal, goes OFF if not.

**Structural fact — the printed `1H/1L` bridge.** The first three lines are `1+/1H`, `1H/1L`, `1L/1X`: an
explicit **H-to-L programming wire**. SDC has to patch relay 1's two contact sets together with a wire, which is
printed evidence that the `G`/`H`/`J` set and the `K`/`L`/`N` set are electrically **isolated** inside the relay
— nobody prints a jumper between two terminals that are already one node in a thirteen-wire minimal program.
`II-EXP6` carries the same bridge. [verified] `book2-3-4.pdf` PDF p.19, read as a page image at 300 dpi by
gap-unread-maintenance (ISO-1) and independently in the text layer this pass.

**This is the corpus's isolation regression test.** The Maintenance Manual's Relay Check (§4.7 `MM-RLY-CHECK`)
*cannot* prove isolation: it ties both `H` and `L` to `+`, so an internal H-L short would leave every printed
lamp state unchanged. This program can. With `H` and `L` internally common, pressing pushbutton 1 alone opens a
path `1K → 2L (= 2H) → 2J → 2K → relay 3 coil` and relay 3 would come ON — contradicting the page's own step 3.
A simulator that internally ties `H` to `L` passes all three Maintenance Manual check circuits and **fails this
one**. Argument from gap-unread-maintenance `#theIsolationQuestion`; the refuting step is printed below.

**Best-specified combinational fixture in the corpus** — five printed numbered steps, each with a stated relay-3
outcome. The numbered steps are on printed p.14 (PDF p.20), not p.13 where the heading sits.

**Printed trace, verbatim** — `pdftotext -layout` of `book2-3-4.pdf` PDF p.20; not image-read, so **[likely]**:

| Step | Printed |
|---|---|
| 1 | 'Transfer the decision rule to the computer by wiring the program onto the console. Pushbuttons 1 and 2 will represent the numbers to be compared. Relay 3 will indicate the computer's decision. If the numbers are equal, relay 3 will come ON. If the numbers are NOT equal, relay 3 will go OFF. (Note: a pushbutton UP represents zero; a pushbutton DOWN represents 1.)' |
| 2 | 'Turn power ON. Relay 3 comes ON because both numbers are zero.' |
| 3 | 'Push pushbutton 1. Relay 3 goes OFF because the numbers are no longer equal. (The first number is now 1; the second number is 0.)' |
| 4 | 'Push pushbutton 2 while holding down pushbutton 1. Once again the numbers are equal (both are 1) and relay 3 comes ON.' |
| 5 | 'Release pushbutton 1 while holding down pushbutton 2. Relay 3 goes OFF because the numbers are not equal.' |

Step 2 is a printed power-up assertion — cold-start-then-settle, stated on the page rather than derived. No
erratum applies to Book II printed p.13 or p.14's Experiment 5; the listing stands as printed.

### II-EXP6 — Experiment 6: Arithmetic (one-bit adder)

Book II printed p.14 · `book2-3-4.pdf` PDF p.20 · 15 wires · tier A · **[likely]** OCR of `book2-3-4.pdf` p.20; not image-verified

| | | | |
|---|---|---|---|
| `1+/1H` | `1H/1L` | `1L/1Y` | `1Y/2Y` |
| `2Z/2C` | `2F/2-` | `1X/1C` | `1F/1-` |
| `1G/2G` | `2H/2A` | `2B/2-` | `1N/2K` |
| `1K/2N` | `2L/1A` | `1B/1-` |  |

**Corrected wire list (errata ER-06 changes `2Z/2C` to `2X/2C`)**

| | | | |
|---|---|---|---|
| `1+/1H` | `1H/1L` | `1L/1Y` | `1Y/2Y` |
| `2X/2C` | `2F/2-` | `1X/1C` | `1F/1-` |
| `1G/2G` | `2H/2A` | `2B/2-` | `1N/2K` |
| `1K/2N` | `2L/1A` | `1B/1-` |  |

**Behaviour (as printed)**

Pushbuttons 1 and 2 are the addends (up = 0, down = 1). Light 1 ON = answer 1; light 2 ON = answer 2; no lights = 0.

This record carries the same `1H/1L` H-to-L bridge as `II-EXP5`, and for the same reason: relay 1's two contact
sets are electrically isolated and have to be patched together with a programming wire. **[likely]** —
`book2-3-4.pdf` PDF p.20 text layer, in line with this record's own tag; the image-read instance of the bridge
is `II-EXP5`'s. `II-EXP5` is the regression test, because it is the one whose printed outcome breaks
if the sets are internally common.

**Printed trace, verbatim (errata applied — ER-06)** — `pdftotext -layout` of `book2-3-4.pdf` PDF p.20; not
image-read, so **[likely]**:

| Step | Printed |
|---|---|
| 1 | 'Transfer the rules of addition to the computer by wiring the program onto the console. Pushbuttons 1 and 2 will represent the numbers to be added. Light 1 ON will represent an answer of 1; light 2 ON will represent an answer of 2; NO lights on will represent an answer of 0. (Note: a pushbutton UP represents 0; a pushbutton DOWN represents 1)' |
| 2 | 'Turn power ON. No lights come on because the input numbers are both zero: 0 + 0 = 0' |
| 3 | 'Push pushbutton 1. Light 1 comes ON: 1 + 0 = 1' |
| 4 | 'Push pushbutton 2 while holding pushbutton 1 down. Light 2 comes ON: 1 + 1 = 2' |
| 5 | 'Release pushbutton 1 while holding pushbutton 2 down. Light 1 comes ON: 0 + 1 = 1.' |

The trace is printed against the **uncorrected** program; ER-06 (`2Z/2C` → `2X/2C`) is a wire fix, not a
behaviour change, and the corrected list is the one that actually produces it.

### II-EXP7 — Experiment 7: Decimal Output

Book II printed pp.15-16 · `book2-3-4.pdf` PDF pp.21-22 · 16 wires · tier C2 · **[verified]** 300 dpi crop of `book2-3-4.pdf` p.21; count closed at 16; re-read at 400 dpi in the Step 6 review (4 columns, column 4 holds only `6Y/6+`), all 16 match; no erratum touches Book II p.15 or p.16

Column 4 holds only one entry.

Printed layout: 4 columns x 5 rows, read column-major.

| col 1 | col 2 | col 3 | col 4 |
|---|---|---|---|
| `1R/D1` | `3S/4S` | `6R/D6` | `6Y/6+` |
| `1S/2S` | `4R/D4` | `6S/D19` |  |
| `2R/D2` | `4S/5S` | `D18/D16` |  |
| `2S/3S` | `5R/D5` | `D16/M-` |  |
| `3R/D3` | `5S/6S` | `D17/6X` |  |

**Initial settings (as printed)**

Initial setting, verbatim: 'Set all slide switches in the RIGHT position.' [verified]

The stray `6Z` that appears beside this table in the OCR is a **circuit-diagram label, not a program line** — it sits above the table, outside the program block. [verified] that it is outside the block; [likely] that it is pushbutton 6's normally-closed terminal drawn on the diagram.

**Procedure (as printed)** [verified] image-read, printed p.16 = PDF p.22 (the wire table is on printed p.15 = PDF p.21, which ends partway through step 1)

- 1. Set all slide switches in the RIGHT position. The slide switches will represent the numbers 1 through 6. To place a number in secondary storage, the appropriate slide switch will be moved to the LEFT position. Pushbutton 6 will be used to give the computer the instruction: Indicate number in Secondary Storage using Decimal Output rotary switch.
- 2. Turn power ON. Move slide switch 4 to the LEFT position. This places the number 4 in Secondary Storage.
- 3. Push pushbutton 6. This instructs the computer to communicate the contents of Secondary Storage to the operator. The rotary switch turns to 4 on the Decimal Input-Output dial. The number 4 is the Decimal Output.
- 4. Move slide switch 4 to the RIGHT position and select another number to be placed in Secondary Storage. Again, push pushbutton 6 to instruct the computer to communicate the contents of Secondary Storage through Decimal Output.

Step 3 ties switch 4 LEFT to dial 4; step 4 names no number and states no dial result. The page prints no direction of travel, speed or release step.

Behaviour: slide switches 1-6 (secondary storage) drive the rotary switch to display the stored number as decimal output (summary, not page text).

### 4.3 Book III — *How Computers Make Logical Decisions*

Book III begins at printed p.35 in the same volume as Books II and IV. Printed page N = PDF page N+6.

| ID | Program | Printed p. | PDF p. | Wires | Tier | Tag |
|---|---|---|---|---|---|---|
| `III-3STMT` | Three statements (A AND B -> C) | 36 | 42 | 4 | A | [likely] |
| `III-ANDOR` | 'AND' and 'OR' statements | 38-39 | 45 | 5 | A | [likely] |
| `III-NOT` | A x B x notC + D = E | 40 | 46 | 7 | A | [verified] |
| `III-XOR-PB` | EITHER BUT NOT BOTH (pushbutton XOR) | 41 | 47 | 5 | A | [verified] |
| `III-RELAYAND` | The Relay AND Circuit | 43 | 49 | 10 | A | [verified] |
| `III-RELAYOR` | The Relay OR Circuit | 43 | 49 | 11 | A | [verified] |
| `III-RELAYNOT` | The Relay NOT Circuit | 44 | 50 | 6 | A | [verified] |
| `III-RELAYXOR` | The Relay EITHER BUT NOT BOTH Circuit | 44 | 50 | 11 | A | [verified] |
| `III-MINDREADING` | A Mind Reading Program | 50-54 | 56-60 | 32 | C2 | [verified] |
| `III-QUANTITY` | Quantity Recognition | 54-57 | 60-63 | 50 | A | [verified] |
| `III-3GIRLS-BOOLEAN` | Three Girls — 'Boolean' solution | 59 | 65 | 12 | A | [verified] |
| `III-3GIRLS-AUTO` | Three Girls — 'automatic' solution | 60 | 66 | 16 | B | [verified] |
| `III-FARMER` | The Farmer, the Goose, the Corn and the Wolf | 60-63 | 66-69 | 42 | B | [verified] image-read p.62 (2026-10-13) |
| `III-TELEVISION` | The Television Problem | 63-65 | 69-71 | 15 | A | [verified] |

### III-3STMT — Computer representation of three statements (A AND B -> C)

Book III printed p.36 · `book2-3-4.pdf` PDF p.42 · 4 wires · tier A · **[likely]** clean OCR; not image-read

| | | | |
|---|---|---|---|
| `1+/1Y` | `1X/2Y` | `2X/3A` | `3B/3-` |

**Expected behaviour (as printed)**

- Pushbutton 1 = statement A, pushbutton 2 = statement B, light 3 = statement C. Both down -> light 3 ON.

Renamed from `II-3STMT`. Printed p.36 is Book III, not Book II (C-08).

Errata **ER-07** [verified]: the p.36 *circuit diagram* is replaced. The replacement diagram reads left to right: `1+` (filled node) — `1Y` — pushbutton arm rising to `1Z` — `1X` — `2Y` — pushbutton arm rising to `2Z` — `2X` — up to `3A` — lamp — `3B` — `3-` (filled node). That is precisely this four-wire program, so **the wire list is unchanged**. This entry looked truncated in the OCR because its body is a drawing, not text.

### III-ANDOR — Computer representation of 'AND' and 'OR' statements

Book III printed pp.38-39 · `book2-3-4.pdf` PDF p.45 · 5 wires · tier A · **[likely]** clean OCR; not image-read

| | | | |
|---|---|---|---|
| `1Y/3Y` | `1X/2Y` | `2X/3X` | `3X/4A` |
| `4B/4-` |  |  |  |

Errata **ER-08** [verified]: p.38, insert 'THEN' between statements B and C in the first statement set. Prose only.

### III-NOT — A x B x C(not) + D = E  (pushbutton NOT / OR combination)

Book III printed p.40 · `book2-3-4.pdf` PDF p.46 · 7 wires · tier A · **[verified]** 400 dpi crop of `book2-3-4.pdf` p.46 (Phase 5 batch 10-13, wave 3: author and fidelity reviewer): all 7 wires read, including `1+/1Y`

| | | | |
|---|---|---|---|
| `1+/1Y` | `1X/2Y` | `2X/3Y` | `3Z/5A` |
| `1Y/4Y` | `4X/5A` | `5B/5-` |  |

**Expected behaviour (as printed)**

- (p.40, PDF p.46) In the following program, statement A is represented by pushbutton 1, statement B is represented by pushbutton 2, statement C is represented by bushbutton 3, statement D is represented by pushbutton 4, and statement E is represented by light 5. ('bushbutton' is the page's own typo.)
- (p.41, PDF p.47) 'Symbolically, the set of relationships may be expressed as: A X B X C̄ + D = E', written here as A x B x C(not) + D = E (the page prints the overbar on C).
- 'the normally open contacts of pushbuttons 1, 2 and 4 are used, while pushbutton 3 is wired using the normally closed contacts.'

**Per-line flags**

| Line | Tag | Note |
|---|---|---|
| `1+/1Y` | [verified] | Image-read at 400 dpi; the OCR break was the large + glyph. |

Errata **ER-09** [verified]: p.40, the paragraph below the heading — second sentence should read 'Light 3 comes ON if pushbutton 1 is pushed and . . .' Prose only.

### III-XOR-PB — The Operation 'EITHER BUT NOT BOTH' (pushbutton XOR)

Book III printed p.41 · `book2-3-4.pdf` PDF p.47 · 5 wires · tier A · **[verified]** 300 dpi crop of `book2-3-4.pdf` p.47

| | | | |
|---|---|---|---|
| `1+/1Y` | `1Z/2X` | `1X/2Z` | `2Y/3A` |
| `3B/3-` |  |  |  |

**Printed behaviour, verbatim**

'Pushbutton 1 is used to represent statement A, pushbutton 2 to represent statement B, and light 3 to represent statement C. The program uses the contacts so that if either pushbutton 1 or pushbutton 2 is pushed, light 3 will come ON. Light 3 will NOT come on if both pushbuttons 1 and 2 are pushed.'

Printed behaviour covers exactly two cases: either pushed -> light 3 ON; both pushed -> light 3 not ON. **The neither-pushed case is not printed.** Any step asserting lamp 3 OFF with both buttons up is derived — tag it [unverified], at step 1 and at the end of the sequence alike (C-17).

Errata **ER-10** [verified]: this operation is often called the EXCLUSIVE OR.

### III-RELAYAND — The Relay AND Circuit

Book III printed p.43 · `book2-3-4.pdf` PDF p.49 · 10 wires · tier A · **[verified]** 500 dpi crop (finder) and 130 dpi read (verifier); exactly ten printed lines

| | | | |
|---|---|---|---|
| `1+/1Y` | `1X/1C` | `1F/1-` | `2+/2Y` |
| `2X/2C` | `2F/2-` | `1+/1H` | `2+/2H` |
| `2G/3A` | `3B/3-` |  |  |

**Corrected wire list — **use this one** (errata ER-12 changes `2+/2H` to `1G/2H`)**

| | | | |
|---|---|---|---|
| `1+/1Y` | `1X/1C` | `1F/1-` | `2+/2Y` |
| `2X/2C` | `2F/2-` | `1+/1H` | `1G/2H` |
| `2G/3A` | `3B/3-` |  |  |

**Expected behaviour (as printed)**

- Stated intent: 'if relay 1 is ON (=1) AND relay 2 is ON (=1) then light 3 will be ON (=1). Symbolically, A x B = C'

**As printed, this circuit does not implement AND.** Relay 1's `G` contact goes nowhere and light 3 follows relay 2 alone. Errata **ER-12** [verified] supplies the fix, and the *circuit diagram on the same page already draws `1G` wired to `2H`* — diagram and program list disagree in the original, and the errata sides with the diagram. Ship the corrected list.

This program is also the primary evidence that relay contact `G` is normally open: light 3 is ON only when both relays are ON. [verified]

Errata **ER-11** [verified]: p.43 second line should read '. . . relay 2 is ON (=1) then light 3 will be ON (=1). Symbolically. . .' Prose only.

### III-RELAYOR — The Relay OR Circuit

Book III printed p.43 · `book2-3-4.pdf` PDF p.49 · 11 wires · tier A · **[verified]** 130 dpi image read of `book2-3-4.pdf` p.49 (verifier UP-04); matches line for line

| | | | |
|---|---|---|---|
| `1+/1Y` | `1X/1C` | `1F/1-` | `2+/2Y` |
| `2X/2C` | `2F/2-` | `1+/1H` | `1G/3A` |
| `2+/2H` | `2G/3A` | `3B/3-` |  |

Two genuinely parallel paths (`1+/1H`,`1G/3A` and `2+/2H`,`2G/3A`) — the structural contrast with the AND circuit above.

### III-RELAYNOT — The Relay NOT Circuit

Book III printed p.44 · `book2-3-4.pdf` PDF p.50 · 6 wires · tier A · **[verified]** 300 dpi image read; matches line for line

| | | | |
|---|---|---|---|
| `1+/1Y` | `1X/1C` | `1F/1-` | `1+/1H` |
| `1J/2A` | `2B/2-` |  |  |

**Expected behaviour (as printed)**

- 'if relay 1 is not energized (is not ON) light 2 will come ON'

This program is the primary evidence that relay contact `J` is normally closed: `1+/1H`, `1J/2A`, so lamp 2 is ON while relay 1 is OFF. [verified] `book2-3-4.pdf` p.50.

### III-RELAYXOR — The Relay EITHER BUT NOT BOTH Circuit

Book III printed p.44 · `book2-3-4.pdf` PDF p.50 · 11 wires · tier A · **[verified]** 300 dpi crop of `book2-3-4.pdf` p.50

| | | | |
|---|---|---|---|
| `1+/1Y` | `1X/1C` | `1F/1-` | `1+/1H` |
| `1J/2G` | `1G/2J` | `2+/2Y` | `2X/2C` |
| `2F/2-` | `2H/3A` | `3B/3-` |  |

**Printed symbolic form**

(A x notB) + (notA x B) = C

**Printed intro (verbatim)**

'The circuit and program below represent the EITHER BUT NOT BOTH condition using relays 1 and 2 controlled by pushbuttons 1 and 2 respectively.'

**Missing from the first research pass entirely.** It is the fourth member of Book III's published relay-logic set (AND p.43, OR p.43, NOT p.44, EITHER-BUT-NOT-BOTH p.44); the finder transcribed three and stopped.

The cross-coupling is the pair `1J/2G` and `1G/2J`: relay 1's normally-closed contact feeds relay 2's coil-side terminal and vice versa. Exactly one branch conducts when the relays disagree, neither when they agree. **This is the structural test case for the J/G contact model** — the only cross-coupled two-relay circuit in the manuals. If J and G are modelled wrongly, this is the circuit that catches it.

**Weak fixture.** Book III p.44 prints no numbered procedure, only the symbolic form `(A x notB) + (notA x B) = C`. The expected trace is derived, not read. gap-verify re-derived all four steps independently and confirms them, but every step still gets tag [unverified] and a mismatch is an investigation, not a red build.

### III-MINDREADING — A Mind Reading Program

Book III printed pp.50-54 · `book2-3-4.pdf` PDF pp.56-60 · 32 wires · tier C2 · **[verified]** image-read 400 dpi PDF p.60 (all 32 match; the first line's last glyph is a hand overdraw and ER-14 quotes the printed form back as `5V/45`); matches the Book VI reprint (`book5-6.pdf` PDF p.63)

| | | | |
|---|---|---|---|
| `5V/4S` | `4R/4A` | `4B/4-` | `5C/5A` |
| `5B/5-` | `6C/6A` | `6B/6-` | `6X/6V` |
| `6V/5V` | `6U/6C` | `5U/5C` | `5F/6F` |
| `6F/6-` | `M-/D18` | `D18/4V` | `4U/6S` |
| `4W/5S` | `5R/6H` | `5T/6L` | `6R/5H` |
| `6T/5L` | `M+/6Y` | `6X/D17` | `D16/D19` |
| `D0/6N` | `D1/6K` | `D2/6J` | `D3/6G` |
| `D4/5N` | `D5/5J` | `D6/5K` | `D7/5G` |

**Initial settings (as printed)**

- Slide switch LEFT indicates a YES answer; a slide switch RIGHT indicates a NO answer.
- A (slide switch 4): Is the number greater than 3?
- B (slide switch 5): When the number is divided by 4, is the remainder greater than 1?
- C (slide switch 6): Is the number odd?

**Procedure (as printed)**

- 3. Indicate the answers to the questions as follows: If the answer to question A is YES, move slide switch 4 to the LEFT. If the answer to question A is NO, move slide switch 4 to the RIGHT. If the answer to question B is YES, move slide switch 5 to the LEFT. If the answer to question B is NO, move slide switch 5 to the RIGHT. If the answer to question C is YES, move slide switch 6 to the LEFT. If the answer to question C is NO, move slide switch 6 to the RIGHT.
- 4. Push pushbutton 6. The pointer knob of the rotary switch will turn to the number your friend was thinking of. (BK3 printed p.54 = PDF p.60, image-read.)

**Expected behaviour (as printed)**

- Slide switches = data input/storage; relays = processing and operating storage; rotary switch = output; pushbutton 6 = the read-out instruction.
- The dial position for each of the eight switch settings is printed on BK3 p.51 (PDF p.57), image-read: the flow chart prints a number at every leaf, and the table prints all eight equations. The PDF text layer drops the chart entirely and loses the NOT overbars in the table. [BK3 p.51 flow chart leaves] Yes (Number) ( is 7 ) … No (Number) ( is 0 ); [BK3 p.51 table] A X B X C = 7 … Ā X B̄ X C̄ = 0 (overbars image-read; the text layer drops the chart and the bars). Leaves left to right: Yes 7, No 6, Yes 5, No 4, Yes 3, No 2, Yes 1, No 0.

The list above is the **corrected** form. The Book III printing's first line reads `5V/45`; errata **ER-14** [verified] changes it to `5V/4S`. The Book VI reprint (`book5-6.pdf` PDF p.63) genuinely prints `5V/4S`.

ER-14 also adds: **zero is considered an even number for this problem.**

The fixture applies ER-14 in `wires` but cannot list it in `errata_applied`: the loader canonicalises the erratum's `from`, and the printed `5V/45` names a terminal `45` that does not exist (O-C17).

### III-QUANTITY — Quantity Recognition

Book III printed pp.54-57 · `book2-3-4.pdf` PDF pp.60-63 · 50 wires · tier A · **[verified]** image-read p.57 (PDF p.63) at 300 dpi, 50 wires, five-column grid 10/10/10/10/10 (Step 6 author plus reviewer, 2026-10-14); no erratum touches Quantity Recognition (Book III errata are pages 38, 40, 41, 43, 46, 54 (Mind Reading), 58, 59, 61, 62). The wire list and the numbered procedure are on printed p.57; the light convention is on printed p.54

| | | | |
|---|---|---|---|
| `1B/1-` | `2B/2-` | `3B/3-` | `4B/4-` |
| `5B/5-` | `6B/6-` | `2F/3F` | `3F/4F` |
| `4F/5F` | `5F/6F` | `6F/6-` | `6+/6S` |
| `6S/4V` | `4V/3V` | `3V/2V` | `2U/2C` |
| `2C/3C` | `3U/4C` | `4C/5C` | `4U/6C` |
| `5A/2G` | `4A/2K` | `3A/2N` | `2A/2T` |
| `1A/3J` | `6A/3N` | `6T/5V` | `6R/5S` |
| `5U/5T` | `5U/4S` | `5R/6H` | `5W/6L` |
| `4T/6K` | `4R/6J` | `6N/5L` | `6J/5H` |
| `6G/4H` | `6K/4L` | `5J/4K` | `5N/3L` |
| `5K/4N` | `5G/4J` | `4N/3H` | `4J/2L` |
| `4G/2H` | `4K/2S` | `3J/3K` | `3G/2T` |
| `2J/2K` | `2N/2R` |  |  |

**Initial settings (as printed)**

- Set slide switches 2 through 6 to the RIGHT (the slide switches are now OFF).
- Turn power ON. Light 6 will come ON indicating that NO switches are ON.

**Procedure (as printed)**

- Set any two of the slide switches 2 through 6 to the LEFT. Light 2 will come ON indicating that two switches are ON.
- Set all switches to the RIGHT again. Once again, light 6 will come ON indicating that NO switches are ON.
- Select various combinations of switches and note that in each case the output lights indicate how many switches are ON (to the LEFT). There are 120 possible combinations of switches, and in each case MINIVAC 601 will recognize how many switches are ON, regardless of which switches are used.

**Expected behaviour (as printed)** [verified] printed p.54 = PDF p.60

- Slide switches 2 through 6 will be used to provide input: a slide switch LEFT is ON, a slide switch RIGHT is OFF. Lights 1 through 6 will be used for output according to the following convention:
- Light 1 ON indicates that 1 switch is ON
- Light 2 ON indicates that 2 switches are ON
- Light 3 ON indicates that 3 switches are ON
- Light 4 ON indicates that 4 switches are ON
- Light 5 ON indicates that 5 switches are ON
- Light 6 ON indicates that No switches are ON.
- 'There are 120 possible combinations of switches' (as printed - there are 2^5 = 32 states of five switches; recorded as printed, not corrected).

'There are 120 possible combinations of switches' is printed; five slide switches give 32 states. Recorded as printed, not corrected. [verified] Book III p.57 (PDF p.63).

### III-3GIRLS-BOOLEAN — A Problem Involving Three Girls - 'Boolean' solution

Book III printed p.59 · `book2-3-4.pdf` PDF p.65 · 12 wires · tier A · **[verified]** image-read p.59 (PDF p.65), 12 wires, single-column list (Step 6 author plus reviewer, 2026-10-14)

| | | | |
|---|---|---|---|
| `1+/2S` | `2S/3V` | `2T/3S` | `3T/3com` |
| `2R/1S` | `1T/3com` | `3U/2V` | `2V/1V` |
| `1W/2W` | `2W/3com` | `3A/3com` | `3B/3-` |

**Initial settings (as printed)**

- Slide switch 1 = Camille, slide switch 2 = Sara, slide switch 3 = Wanda.
- Slide switch LEFT = the positive condition (Camille could / Sara should / Wanda would); RIGHT = the negative condition.
- Light 3 ON = an error.

**Procedure (as printed)**

- Turn power ON. Try combinations on slide switches 1, 2 and 3 until the error light (light 3) goes OFF.
- If power is ON and light 3 is OFF, the slide switches indicate a correct solution.

**Notes**

- The 'com' terminals are used here because light 3 needs three contacts and only two are available: 'Since there are three error conditions and only two contacts for light 3, we will use the Common terminals to provide the necessary extra contacts. (The notation for a connection to a common terminal is 1com, 2com, etc.)' [verified quote]

Errata **ER-16** [verified]: the p.59 *diagram* is mislabelled — change `1R`, `1S`, `1T` on the far right slide switch to `3R`, `3S`, `3T`. Diagram only; the wire list stands. The list already names that switch `3S` and `3T` (`2T/3S`, `3T/3com`); `3R` is unused.

Errata **ER-15** [verified]: p.58, the condition should be stated as `notC x S = error, or C + notS = truth`. Prose only; the two earlier transcriptions of this line disagreed and §3.2 resolves it (2026-10-14). The p.59 wire list implements this expression (`2R/1S`, `1T/3com`).

### III-3GIRLS-AUTO — A Problem Involving Three Girls - 'automatic' solution

Book III printed p.60 · `book2-3-4.pdf` PDF p.66 · 16 wires · tier B · **[verified]** image-read p.60 (PDF p.66), 16 wires, list (400 dpi) and circuit diagram (300 dpi) agree (Phase 5 batch 10-13, wave 3, 2026-10-14)

| | | | |
|---|---|---|---|
| `1+/1Y` | `1Y/2Y` | `2Y/3Y` | `1X/1C` |
| `2X/2C` | `3X/3C` | `2K/1X` | `2L/2+` |
| `2N/3C` | `3G/1H` | `1H/1C` | `1G/2C` |
| `3H/3+` | `1F/2F` | `2F/3F` | `3F/3-` |

**Expected behaviour (as printed)**

- (p.59, PDF p.65) Relay light 1 will indicate the condition of Camille / Relay light 2 will indicate the condition of Sara / Relay light 3 will indicate the conditon of Wanda ('conditon' is the page's own spelling).
- (p.59) A relay light ON will indicate the positive condition; a relay light OFF will indicate the negative condition.
- (p.60, PDF p.66) When the power is turned ON, a correct solution will immediately appear in the relay indicator lights.
- (p.60) Turn power ON. The solution to the problem appears in the relay indicator lights.
- (p.60) A pushbutton UP transmits no additional information to the computer. A pushbutton DOWN, however, supplies the positive condition (Camille could, Sara should, Wanda would).
- (p.60) To add positive information about a girl, push the appropriate pushbutton. The relay indicator lights will indicate the new solution, given this additional information.

No erratum covers p.60 (errata.pdf p.2 lists pages 58, 59, 61, 62). ER-15 (p.58) changes only the error expression; the truth expression `C + notS` the automatic solution is built on is unchanged. [verified]

### III-FARMER — The Farmer, the Goose, the Corn and the Wolf

Book III printed pp.60-63 · `book2-3-4.pdf` PDF pp.66-69 · 42 wires · tier B · **[verified]** image-read p.62 (PDF p.68), 42 wires, five-column grid 10/10/10/9/3 (2026-10-13)

| | | | |
|---|---|---|---|
| `1A/1J` | `1B/1-` | `1C/1G` | `1E/1U` |
| `1F/2F` | `1H/2H` | `1K/2K` | `1K/1+` |
| `1L/2L` | `1N/3K` | `1U/2V` | `1V/1X` |
| `1X/6X` | `1Y/1+` | `2A/2J` | `2B/2-` |
| `2E/2U` | `2C/2G` | `2F/3F` | `2H/3H` |
| `2N/3N` | `2W/3V` | `3A/3J` | `3B/3-` |
| `3C/3G` | `3E/3U` | `3F/4F` | `3H/4H` |
| `3K/4K` | `3L/5A` | `3N/4N` | `3W/4V` |
| `4A/4J` | `4B/4-` | `4C/4G` | `4E/4U` |
| `4F/4-` | `4H/4+` | `4L/6A` | `5B/5-` |
| `6B/6-` | `6Y/6-` |  |  |

**Procedure (as printed)**

- 1. Turn power ON. Manually push relays 1 through 4 to the LEFT. Move slide switches 1 through 4 to the RIGHT.
- 2. Place the farmer in the boat by moving slide switch 1 to the LEFT. (The farmer must be in the boat or the boat will not move.)
- 3. Choose another object and place it in the boat by pushing the appropriate slide switch to the LEFT.
- 4. Move the boat across the river by pushing pushbutton 6. If lights 5 and 6 remain OFF, no error has been made.
- 5. Continue moving the boat back and forth across the river with the different objects until all four objects are at home (output lights 1 through 4 are ON.) Remove objects from the boat when they reach the other side.
- 6. If an error is made, reset by setting slide switches 1 through 4 RIGHT and manually setting relays 1 through 4 LEFT.

**Conventions (verbatim)**

- An output light ON represents an object at home.
- A relay indicator light ON represents an object across the river.
- A slide switch LEFT represents an object in the boat.
- A slide switch RIGHT represents an object not in the boat.
- Light 5 ON represents the condition 'Wolf eats goose'.
- Light 6 ON represents the condition 'Goose eats corn'.
- Pushbutton 6 represents moving the boat towards home.
- Pushbutton 1 represents moving the boat from home.

**Component map (as printed)**

| &nbsp; | Output Light | Relay | Slide Switch |
|---|---|---|---|
| Farmer | 1 | 1 | 1 |
| Goose | 2 | 2 | 2 |
| Wolf | 3 | 3 | 3 |
| Corn | 4 | 4 | 4 |

_[likely] _

Errata **ER-17** [verified]: p.61 CIRCUIT REPRESENTATION is incorrect — insert `E` before the negative power connection. Diagram only.

Errata **ER-18** [verified] adds a procedure note (it does not withdraw the p.62 steps): place the farmer and one additional passenger in the boat (move the appropriate slide switches LEFT); move the boat across the river (pushbutton 6 to cross, pushbutton 1 for the return trip); unload the boat (move the slide switches RIGHT); repeat until the farmer and all his possessions are across. The farmer may make trips alone.

This program requires **manual relay actuation** at reset — the operator pushes relays 1-4 left by hand. The simulator needs that as a first-class input.

### III-TELEVISION — The Television Problem ('Boolean' solution)

Book III printed pp.63-65 · `book2-3-4.pdf` PDF pp.69-71 · 15 wires · tier A · **[verified]** image-read at 300 dpi (PDF p.71), all 15 wires match (Phase 5 batch 10-13, wave 3, 2026-10-14)

| | | | |
|---|---|---|---|
| `1U/1S` | `1S/2S` | `1T/2R` | `2R/2V` |
| `2U/3W` | `2W/3U` | `3R/4R` | `3S/3V` |
| `3T/4T` | `4A/4S` | `4B/4-` | `4U/5V` |
| `4U/1V` | `4V/4+` | `5W/1U` |  |

**Procedure (as printed)**

- Set slide switches 1 through 5 to the LEFT (this indicates that no one is watching television).
- Turn power ON. By moving slide switches 1 through 5, try various solutions to the problem. Light 4 will come ON only when the correct solution has been indicated.

**Conventions (paraphrase, except where quoted)**

- Slide switch 1 = Barry, 2 = Clara, 3 = David, 4 = Edward, 5 = Francis (the page prints 'Slide switch 1 represent Barry' ... 'Slide switch 5 represent Francis').
- 'A slide switch LEFT indicates that the person is watching television'; a slide switch RIGHT indicates that the person is NOT watching television.
- 'Light 4 will indicate the correct solution: light 4 ON indicates that the solution represented by the slide switches is CORRECT; light 4 OFF indicates that the solution is NOT CORRECT.'

**Internal contradiction, as printed, on one page.** The conventions say a slide switch LEFT means the person *is* watching television; the operating instruction on the same page says 'Set slide switches 1 through 5 to the LEFT (this indicates that **no one** is watching television).' [verified] Book III p.65. The errata sheet does not address it. **Not settled by the sources.** Fallback: take the conventions block as authoritative (LEFT = watching) and treat the operating instruction's parenthetical as the error, because the conventions block is the one the wire list is built from — but tag any fixture step here [unverified]. Derived cross-check (not verification): simulating the printed wiring, light 4 lights only at the setting that solves the p.63 conditions under LEFT = watching (David and Edward watching), which supports the fallback. The tag stays [unverified].

### 4.4 Book IV — arithmetic

Book IV begins at printed p.66 in the same volume. Printed page N = PDF page N+6.

| ID | Program | Printed p. | PDF p. | Wires | Tier | Tag |
|---|---|---|---|---|---|---|
| `IV-SELFHOLD` | Two self-holding relays (base of the flip-flop) | 68 | 74 | 6 | B | [likely] |
| `IV-FF1` | Single-input flip-flop, FIRST version | 68-69 | 74-75 | 15 | B | [verified] |
| `IV-FF2` | Single-input flip-flop, SECOND version | 69-70 | 75-76 | 14 | B | [verified] |
| `IV-FF2-CARRY` | Single-Input Flip-Flop With Carry | 70 | 76 | 18 | B | [verified] |
| `IV-EXP1` | Experiment 1: A Three-Bit Binary Counter | 71-72 | 77-78 | 44 | B | [verified] |
| `IV-EXP2` | Experiment 2: Counter Arithmetic | 73 | 79 | (reuses EXP1) | B | [verified] |
| `IV-EXP3` | Experiment 3: Universal Counter Arithmetic | 73-74 | 79-80 | (modifies EXP1) | B | [verified] |
| `IV-EXP4` | Experiment 4: A Half-Adder with Carry | 75 | 81 | 8 | A | [verified] |
| `IV-EXP5` | Experiment 5: A Full Adder | 76-77 | 82-83 | 15 | B | [verified] |
| `IV-EXP6` | Experiment 6: A Three-Bit Adder | 77 | 83 | 48 | A | [verified] |
| `IV-EXP7` | Experiment 7: A Three-Bit Subtractor | 78-79 | 84-85 | (modifies EXP6) | A | [verified] |
| `IV-EXP8` | Experiment 8: The Shifting Operation | 80 | 86 | 67 | A | [verified] |
| `IV-EXP9` | Experiment 9: The Accumulator | 81-82 | 87-88 | (reuses EXP8) | A | [verified] |
| `IV-EXP10` | Experiment 10: Division | 83-84 | 89-90 | 56 | A | [verified] |
| `IV-EXP11` | Experiment 11: Decimal to Binary Converter | 84-85 | 90-91 | 49 | C1 | [verified] image-read 300 dpi (2026-10-14) |
| `IV-EXP12` | Experiment 12: Binary to Decimal Converter | 85 | 91 | 50 | C2 | [verified] image-read 300 dpi (2026-10-13) |
| `IV-APX-SHIFTREG` | Appendix: Automatic Shift Register | 86-87 | 92-93 | 60 | C2 | [verified] |
| `IV-APX-2BITADDER` | Appendix: Two-Bit Adder with Decimal Conversion | 87 | 93 | 49 | C2 | [verified] image-read 600 dpi (2026-10-13) |
| `ER-ALTCOUNTER` | Three-Bit Binary Counter — alternate circuit | errata p.2 | errata p.2 | 48 | B | [verified] |

### IV-SELFHOLD — Two self-holding relays (base of the single-input flip-flop)

Book IV printed p.68 · `book2-3-4.pdf` PDF p.74 · 6 wires · tier B · **[likely]** OCR; not image-read

| | | | |
|---|---|---|---|
| `5+/5H` | `5H/6H` | `5G/5F` | `6G/6F` |
| `5C/6C` | `6C/6-` |  |  |

### IV-FF1 — Single-input flip-flop, FIRST version

Book IV printed pp.68-69 · `book2-3-4.pdf` PDF pp.74-75 · 15 wires · tier B · **[verified]** 300 dpi image read, `book2-3-4.pdf` PDF pp.74-75 (Phase 5 batch 10-13, wave 3, 2026-10-14); the four stage blocks are cleanly separated by their introductory sentences

Built incrementally in four printed stages: 6 + 4 + 3 + 2 = **15 wires**, not 16 (C-11). Stage 1 (self-holding, wires 1-6); stage 2 (pushbutton 6 makes relay 6 follow relay 5, wires 7-10); stage 3 (on release relay 5 goes opposite to relay 6, wires 11-13); stage 4 (indicator light, wires 14-15).

| | | | |
|---|---|---|---|
| `5+/5H` | `5H/6H` | `5G/5F` | `6G/6F` |
| `5C/6C` | `6C/6-` | `6H/6Y` | `6X/5L` |
| `5K/6F` | `5N/6E` | `6Z/6L` | `6K/5E` |
| `6N/5F` | `6G/6A` | `6B/6-` |  |

**Notes**

- Printed build relations, each scoped to an intermediate build and not to the 15-wire circuit. Stage 2 (10 wires, p.68, PDF p.74): 'We will now add to the program so that when pushbutton 6 is pushed, relay 6 will go to the same state that relay 5 is in.' Stage 3 (13 wires, p.69, PDF p.75): 'Again we will add to the program so that when pushbutton 6 is released, relay 5 will go to the opposite state from relay 6:'. No power-up state is printed.
- Stated limitation: 'our single-input flip-flop still cannot be used for arithmetic: it does not provide a carry signal ... since all contacts on both relays are used, we cannot arrange for a carry signal by merely adding connections.'

**A genuinely different circuit from the Book II / `IV-FF2` flip-flop** — eight electrical nets against six, and the only flip-flop in the corpus that consumes *both* contact sets on both of its relays, which is precisely why it cannot carry. (It is not the only program to touch `K`/`L`/`N`: `I-EXP9`, `II-EXP5` and `II-EXP6` all use the second set.) Stated limitation, printed: 'since all contacts on both relays are used, we cannot arrange for a carry signal by merely adding connections.'

**Errata ER-19 — this program's erratum, and no other's.** [verified] `errata.pdf` p.2 **right** col (the `BOOK IV` block: pp.69, 71, 72 and the alternate-counter figure; the left column of that sheet runs Book III pp.38-62), verbatim:
'Note — push pushbutton 6 slowly when operating the single-input flip-flop. Light 6 will go off and on,
indicating the state of the whole flip-flop.' It is filed at Book IV printed p.69 = PDF p.75, the page carrying
this circuit's stages 2-4 and its diagram, and stage 4's wires are `6G/6A`, `6B/6-` — light 6 *is* this
circuit's indicator, exactly as the note describes. `IV-FF2`, two pages on, prints the opposite ('light 6 is not
used as an indicator in this program'), and `II-FF1` uses pushbutton 1 and light 1. See C-23.

That makes `IV-FF1` the **one circuit SDC singles out with an 'operate it slowly' caution**, and therefore the
fixture the timing profile's 'must misbehave when hammered' half has to be proved against. It is a real-hardware race warning: relay pull-in time is load-bearing on real iron, and the fixpoint
model deliberately abstracts it away. Record that as a known divergence, not a bug. Distinct from `II-FF1`'s
role, which is the primary *release-edge* fixture.

Wire list image-read at 300 dpi from `book2-3-4.pdf` PDF pp.74-75 (Phase 5 batch 10-13, wave 3, 2026-10-14): all 15 wires match term for term and in order.

### IV-FF2 — Single-input flip-flop, SECOND version (contacts free for a carry)

Book IV printed pp.69-70 · `book2-3-4.pdf` PDF pp.75-76 · 14 wires · tier B · **[verified]** 300 dpi render of `book2-3-4.pdf` p.76 (gap-verify UP-03); two columns of seven, 14 wires, matches line for line

**Locator, exactly.** Under this file's own offset (printed = PDF − 6), printed pp.69-70 is PDF pp.75-76 — not p.76 alone. Everything a fixture needs (program table, circuit diagram, caption, all three numbered steps) is on **printed p.70 = PDF p.76**; printed p.69 = PDF p.75 carries only the introductory prose and the tail of `IV-FF1`. Cite the pair or cite p.70, never 'printed pp.69-70 · PDF p.76'. gap-verify DG-03; load-bearing for a corpus keyed on (pdf_file, pdf_page, printed_page).

Printed layout: 2 columns x 7 rows, read column-major.

| col 1 | col 2 |
|---|---|
| `5+/5G` | `6J/6E` |
| `5H/5F` | `6E/6A` |
| `5F/6F` | `6B/6-` |
| `5C/6C` | `5H/5A` |
| `6C/6-` | `5B/5-` |
| `5J/6H` | `6+/6Y` |
| `6G/5E` | `6X/6H` |

**Printed trace, image-verified — the fullest of any flip-flop, and the numbered steps are on printed p.70 (PDF p.76), not p.69 where the prose sits:**

| Step | Do | Settle | Then |
|---|---|---|---|
| 1 | Turn power ON | fixpoint | relays 5 and 6 both OFF |
| 2 | Push and release pushbutton 6 | fixpoint | relays 5 and 6 both ON |
| 3 | Push pushbutton 6, **do not release** | hold | relay 5 OFF, relay 6 ON |

All three steps [verified], `book2-3-4.pdf` p.76. Step 1 is a **printed power-up assertion for a bistable circuit** — the hard case — so it does not rest on the cold-start fallback, and it is the strongest single piece of evidence *for* that fallback.

Printed observable, verbatim: 'Light 5 is used to indicate the state of the flip-flop. Light 6 is used only to provide a path for current when relay 6 is shorted-out (OFF); light 6 is not used as an indicator in this program.'

Relation to the Book II flip-flop: same topology, **four of six** electrical nets identical, differing only in where lamp 5's anode taps. Do not unify the two wire lists — a lamp on this machine is a series element in the coil path, so the tap changes coil loading (C-12, C-13).

### IV-FF2-CARRY — Single-Input Flip-Flop With Carry

Book IV printed p.70 · `book2-3-4.pdf` PDF p.76 · 18 wires · tier B · **[verified]** 300 dpi render of `book2-3-4.pdf` p.76 (gap-verify MS-03)

`IV-FF2`'s 14 wires plus the four printed additions `5G/5N`, `5L/6L`, `6K/4A`, `4B/4-`.

| | | | |
|---|---|---|---|
| `5+/5G` | `5H/5F` | `5F/6F` | `5C/6C` |
| `6C/6-` | `5J/6H` | `6G/5E` | `6J/6E` |
| `6E/6A` | `6B/6-` | `5H/5A` | `5B/5-` |
| `6+/6Y` | `6X/6H` | `5G/5N` | `5L/6L` |
| `6K/4A` | `4B/4-` |  |  |

**Printed addition (verbatim)**

'To add the carry signal, we will add the connections: 5G/5N  6K/4A / 5L/6L  4B/4-'

**Printed observable (verbatim)**

'Light 4 will now indicate that a carry is taking place.'

**This is the actual building block of the three-bit counter** — three of these, one per bit — and it is a distinct program from `IV-FF2`. The page prints no separate numbered trace: it inherits `IV-FF2`'s steps 1-3 and adds the light-4 carry observable at step 3. Any step asserting light 4's *value* is [unverified]; the page states what light 4 means, not what it reads at a given step.

### IV-EXP1 — Experiment 1: A Three-Bit Binary Counter

Book IV printed pp.71-72 · `book2-3-4.pdf` PDF pp.77-78 · 44 wires · tier B · **[verified]** 500 dpi image reads; all 44 wires match line for line, including the OCR-risk glyphs `1B/1-`, `1G/1+`, `3G/3+`, `5G/5+`, and `6Y/6+`

Printed layout: 4 columns x 11 rows, read column-major.

| col 1 | col 2 | col 3 | col 4 |
|---|---|---|---|
| `1A/2E` | `2C/3C` | `3J/6K` | `5F/5H` |
| `1B/1-` | `2E/2J` | `3L/4L` | `5G/5+` |
| `1C/2C` | `2F/4A` | `3N/4H` | `5J/6H` |
| `1E/2G` | `3A/6E` | `4B/4-` | `5J/6X` |
| `1F/2F` | `3B/3-` | `4C/5C` | `5L/6L` |
| `1F/1H` | `3C/4C` | `4E/4J` | `5N/6H` |
| `1G/1+` | `3E/4G` | `4F/5A` | `6A/6F` |
| `1J/2H` | `3F/3H` | `5B/5-` | `6B/6-` |
| `1J/4K` | `3F/4F` | `5C/6C` | `6C/6-` |
| `2A/4E` | `3G/3+` | `5E/6G` | `6E/6J` |
| `2B/2-` | `3J/4H` | `5F/6F` | `6Y/6+` |

**Printed procedure, image-verified**

1. Turn power ON, then push and release pushbutton 6. Lamps 4, 5 and 6 read OFF, OFF,
   ON (`001`), displaying 1.
2. Push and release pushbutton 6 again. The lamps read OFF, ON, OFF (`010`), displaying 2.
3. Continue pushing and releasing pushbutton 6. After each release, read lamps 4, 5 and 6 and
   compare the result with the binary table (the page prints "page 66"; the table is on printed p.68, PDF p.74).
4. The counter repeats after 7 because three flip-flops provide eight states, 0 through 7.
5. Lamp 6, the low-order bit, changes on every press-release; lamp 5 changes on every other
   press-release. The printed high-order explanation continues beyond these two experiment pages.

Printed bit assignment: **light 4 = MSB (4's), light 5 = 2's, light 6 = LSB (1's)**; the counter repeats after 7. [verified] from the printed prose.

Errata **ER-20** [verified]: the p.71 chart title should read 'Pushbutton', not 'Pushbutton carry'.

Errata **ER-21** [verified]: 'the design of this counter is such that the capabilities of the relays are somewhat strained. Relays which perform to satisfaction in every other case may not perform adequately in this circuit.' If it does not work, use `ER-ALTCOUNTER` instead. **The manufacturer is conceding that a published program is marginal on real hardware** — that is a modelling fact, and it is how a fixture failure here should be triaged.

**BINARY COUNTER — SEQUENCE OF OPERATIONS** (Book IV printed p.71, `book2-3-4.pdf` PDF p.77). Seventeen printed rows of ground truth for a sequential circuit, carry signals included. **This is the richest printed expected-output source in the entire manual set** and it was missed by every pass before gap-verify. The manual states the chart is read right to left. [verified] from a 500-dpi render of PDF p.77.

| Flip-Flop A | Carry B to A | Flip-Flop B | Carry C to B | Flip-Flop C | Pushbutton | Times Pushed |
|---|---|---|---|---|---|---|
| 0 | NO | 0 | NO | 0 | UP | 0 |
| 0 | NO | 0 | NO | 1 | DOWN | &nbsp; |
| 0 | NO | 0 | NO | 1 | UP | 1 |
| 0 | NO | 1 | YES | 1 | DOWN | &nbsp; |
| 0 | NO | 1 | NO | 0 | UP | 2 |
| 0 | NO | 1 | NO | 1 | DOWN | &nbsp; |
| 0 | NO | 1 | NO | 1 | UP | 3 |
| 1 | YES | 1 | YES | 1 | DOWN | &nbsp; |
| 1 | NO | 0 | NO | 0 | UP | 4 |
| 1 | NO | 0 | NO | 1 | DOWN | &nbsp; |
| 1 | NO | 1 | NO | 1 | UP | 5 |
| 1 | NO | 1 | YES | 1 | DOWN | &nbsp; |
| 1 | NO | 1 | NO | 0 | UP | 6 |
| 1 | NO | 1 | NO | 1 | DOWN | &nbsp; |
| 1 | NO | 1 | NO | 1 | UP | 7 |
| 1 | YES | 1 | YES | 1 | DOWN | &nbsp; |
| 0 | NO | 0 | NO | 0 | UP | 0 or 8 |

Three cells in the Flip-Flop C column are absent from the PDF text layer (the UP rows for counts 2, 4 and 6), but the 500-dpi source render visibly prints `0` in all three. These are source values, not inferred counter logic.

**The count-5 UP row is a misprint** [verified] 250-dpi render of PDF p.77, 2026-10-13 (Phase 5 Step 1b audit). It prints Flip-Flop B = `1`, which would read as binary 7. The chart contradicts itself here. The count-4 DOWN row leaves B at `0` with Carry C to B = `NO`, so nothing can set B before the count-5 DOWN row, and that row is where Carry C to B = `YES` first sets it. B is `0` at count 5. Until 2026-10-13 the `IV-EXP1-SLOW` fixture quoted that row as `1 | NO | 0 | NO | 1 | UP | 5`, an unflagged correction presented as a verbatim quote. It now quotes the row as printed and does not assert light 5 at count 5.

### IV-EXP2 — Experiment 2: Counter Arithmetic

Book IV printed p.73 · `book2-3-4.pdf` PDF p.79 · tier B · **[verified]** image-read PDF p.79 (procedure) and PDF p.78 (inherited IV-EXP1 44-wire list), 2026-10-14

NO NEW WIRING - uses the Experiment 1 counter as wired.

**Procedure (as printed)**

- To add 2 and 3: push and release pushbutton 6 twice (counter shows 2); push three more times (counter shows 5).
- Push five more times (ten total): the counter shows 010, the low-order three bits of decimal 10 (1010).

Errata **ER-22** [verified]: use the alternate counter circuit here too if you used it for Experiment 1.

### IV-EXP3 — Experiment 3: Universal Counter Arithmetic (up/down counter)

Book IV printed pp.73-74 · `book2-3-4.pdf` PDF pp.79-80 · modifies `IV-EXP1` · tier B · **[verified]** image-read, `book2-3-4.pdf` PDF p.79 modification block (Remove `6K/3J` `4K/1J`; Add `3K/6W` `3N/4N` `6R/6K` `4K/6U` `5N/6N` `5K/6T` `6S/3J` `6V/1J`) and PDF p.78 44-wire base list (Phase 5 batch 10-13, wave 3, 2026-10-14); resolved list 44 - 2 + 8 = 50 wires

**Modification of the Book IV counter, as printed**

| Remove | Add |
|---|---|
| `6K/3J` `4K/1J` | `3K/6W` `3N/4N` `6R/6K` `4K/6U` `5N/6N` `5K/6T` `6S/3J` `6V/1J` |

**Notes**

- The removes are written 6K/3J and 4K/1J; in the Experiment 1 list the same connections appear as 3J/6K and 1J/4K.
- Note that Experiment 1 already contains 3N/4H and 5N/6H; the additions 3N/4N and 5N/6N are ADDITIONAL, not substitutions, as printed. Flagged.

**Procedure (as printed)**

- If slide switch 6 is LEFT, the counter will count UP; if slide switch 6 is RIGHT, the counter will count DOWN. (p.73, PDF p.79, step 1)
- Subtract 4 from 7: (a) slide switch 6 LEFT, (b) push pushbutton 6 seven times, (c) slide switch 6 RIGHT, (d) push pushbutton 6 four times. The counter is now displaying the answer: 7 — 4 = 3. (p.74, PDF p.80)
- Addition is carried out exactly as in experiment 2 when slide switch 6 is LEFT.

**Modification of the ALTERNATE counter (errata ER-22) [verified]**

| Remove | Add |
|---|---|
| `3N/4N` `5N/6N` | `3K/4V` `5K/6V` `3N/4S` `5N/6S` `4J/4W` `6J/6W` `4N/4R` `6N/6R` |

Read the errata's remove/add blocks **row-major across two columns**. Exception to the printed p.73 procedure, ER-22 text for the alternate circuit only (not the printed circuit): 'the counter will count UP when BOTH slide switch 4 and slide switch 6 are LEFT', and DOWN when both are RIGHT. [verified] `errata.pdf` p.3 left col @300 dpi.

### IV-EXP4 — Experiment 4: A Half-Adder with Carry

Book IV printed p.75 · `book2-3-4.pdf` PDF p.81 · 8 wires · tier A · **[verified]** image-read 300 dpi (PDF p.81 program list and circuit diagram; 2026-10-14); all 8 wires match and each traces on the circuit diagram; no errata entry

| | | | |
|---|---|---|---|
| `5A/6U` | `5B/5-` | `6A/6S` | `6B/6-` |
| `6R/6Z` | `6T/6X` | `6T/6V` | `6Y/6+` |

**Initial settings (as printed)**

- Slide switch 6 = input A (RIGHT = 0, LEFT = 1). Pushbutton 6 = input B (up = 0, down = 1).

**Procedure (as printed)**

- 1. Power ON, slide switch 6 RIGHT, pushbutton up: lights 5 and 6 OFF (sum 0, carry 0).
- 2. Push pushbutton 6 and hold: light 6 comes ON (0 + 1 = 1).
- 3. Release, move slide switch 6 LEFT: light 6 comes ON (1 + 0 = 1).
- 4. With the slide switch LEFT, push pushbutton 6: light 6 goes OFF and light 5 comes ON (1 + 1 = 0 carry 1).

**Expected behaviour (as printed)**

- Light 6 = sum; light 5 = carry out.

### IV-EXP5 — Experiment 5: A Full Adder

Book IV printed pp.76-77 · `book2-3-4.pdf` PDF pp.82-83 · 15 wires · tier B · **[verified]** image-read 300 dpi (PDF p.82 table, 400 dpi crop; PDF p.83 procedure; 2026-10-14); all 15 wires match and each traces on the circuit diagram; no errata entry

| | | | |
|---|---|---|---|
| `5A/6U` | `5B/5-` | `5C/6S` | `5F/5-` |
| `5G/6J` | `5H/5+` | `5J/6G` | `6A/6H` |
| `6B/6-` | `6J/6L` | `6K/6U` | `6R/6Z` |
| `6T/6X` | `6T/6V` | `6Y/6+` |  |

**Procedure (as printed)**

- 1. Power ON, slide switch 6 RIGHT (A=0), pushbutton 6 up (B=0), relay 6 OFF (carry in = 0). Lights 5 and 6 OFF.
- 2. Slide switch 6 LEFT (A=1): light 6 comes ON (1+0+0=1).
- 3. Manually move relay 6 to the left (carry in = 1): light 6 goes OFF and light 5 comes ON (1+0+1 = 0 carry 1).
- 4. Try other combinations.

**Expected behaviour (as printed)**

- Relay 6 = carry in from a previous stage. Relay 5 = the sum of inputs A and B.

Step 3 requires **manual relay actuation** — the operator moves relay 6 left by hand to set the carry-in. [likely] Book IV p.77.

### IV-EXP6 — Experiment 6: A Three-Bit Adder

Book IV printed p.77 · `book2-3-4.pdf` PDF p.83 · 48 wires · tier A · **[verified]** image-read 300 dpi (2026-10-14); all 48 wires match

| | | | |
|---|---|---|---|
| `2C/3G` | `2F/3F` | `2G/4S` | `2H/4Y` |
| `2K/4W` | `2L/2+` | `2N/4U` | `3A/M10` |
| `3B/3-` | `3C/4G` | `3F/4E` | `3G/3N` |
| `3H/4Z` | `3J/4T` | `3K/4R` | `3K/M10` |
| `3L/4X` | `4A/4V` | `4B/4-` | `4E/5F` |
| `4F/5S` | `4G/5U` | `4H/4N` | `4K/5Z` |
| `4L/5A` | `4N/5X` | `4Y/5Y` | `5B/5-` |
| `5C/6K` | `5F/6E` | `5G/6S` | `5H/5+` |
| `5K/6W` | `5L/6A` | `5N/6U` | `5R/6T` |
| `5T/6R` | `5T/5V` | `5Y/6V` | `6B/6-` |
| `6E/6-` | `6G/6R` | `6H/6X` | `6J/6K` |
| `6L/6Z` | `6N/6T` | `6V/6Y` | `6Y/6+` |

**Procedure (as printed)**

- 1. ... to enter binary 4 (100) set slide switch 4 LEFT, slide switch 5 RIGHT and slide switch 6 RIGHT.
- 2. ... to enter binary 5 (101) push button 4 and 6; do not push pushbutton 5.
- 3. The answer will be displayed in binary output lights 3, 4, 5 and 6. For example, if lights 3 and 6 are ON and lights 4 and 5 are OFF, the answer is 1001 (9).

**Expected behaviour (as printed)**

- Three full adders using only five relays; the carry out of the high-order stage is displayed by light 3, giving a 4-bit result from a 3-bit adder.
- Uses matrix terminal M10 purely as a junction point (3A/M10 and 3K/M10).

Errata **ER-23** [verified]: the connections to `M10` indicate the **end-around carry** — the carry out of the high-order stage, used when the adder is converted to a subtractor in Experiment 7. `M10` is used purely as a junction node here (`3A/M10`, `3K/M10`).

### IV-EXP7 — Experiment 7: A Three-Bit Subtractor (two's complement)

Book IV printed pp.78-79 · `book2-3-4.pdf` PDF pp.84-85 · modifies `IV-EXP6` · tier A · **[verified]** remove/add lists image-read 2026-10-14 against PDF p.85 (300 dpi page, 600 dpi crop); base is IV-EXP6 [verified]

**Modification, as printed**

| Remove | Add |
|---|---|
| `3A/M10` `3L/4X` `3H/4Z` `4N/5X` `4K/5Z` `6H/6X` `6L/6Z` | `6F/M10` `3L/4Z` `3H/4X` `4N/5Z` `4K/5X` `6C/6F` `6H/6Z` `6L/6X` |

**Procedure (as printed)**

- Enter the subtrahend (3-bit) on slide switches 4, 5, 6.
- Enter the subtractor on pushbuttons 4, 5, 6 (uncomplemented - the program complements it automatically).
- The answer appears in the binary output lights.
- Example: 5 - 2: slide switches 4 and 6 LEFT, 5 RIGHT; push pushbutton 5 only. Lights: 4 OFF, 5 and 6 ON = 011 = 3.

**Expected behaviour (as printed)**

- 3. The answer appears in the binary output lights: light 4 is OFF, and lights 5 and 6 are ON. This is read as 011, which is binary 3 : 5 - 2 = 3.
- Had we attempted to enter binary 7 (111) in the pushbuttons, relay 6—the carry in relay for the low order stage— would not have pulled in and the answer displayed in the output lights would be incorrect.
- If this relay fails to pull in when the subtraction takes place, we have attempted an incorrect subtraction.

**Alternate-counter variant (errata ER-24) [verified]:** first build the adder and modify it for a subtractor, then remove `2C/2G`, `3C/3G`, `5C/6K`, `6C/6F`, `6F/M10` and add `2E/2G`, `3E/3G`, `5E/6K`, `6C/M10`, `6F/M+`. The light-6 note (relay indicator light 6 ON indicates an end-around carry, i.e. the subtraction proceeded properly) sits inside this alternate-counter entry and applies to that variant only, not to the book circuit. ER-24's remove list names `2C/2G` and `3C/3G`, which the IV-EXP6/IV-EXP7 base does not wire (it has `2C/3G` and `3C/4G`, the wires ER-27 removes for Experiment 10): see O-C25. Fallback: fixture the book circuit only.

### IV-EXP8 — Experiment 8: The Shifting Operation (the accumulator, manual shift register)

Book IV printed p.80 · `book2-3-4.pdf` PDF p.86 · 67 wires · tier A · **[verified]** table image-read at 400 dpi against PDF p.86 (Step 6 IV-EXP9 review, 2026-10-14): all 67 wires match in order (columns of 17/17/17/16), no duplicates, no erratum on any wire (ER-25 is prose only)

| | | | |
|---|---|---|---|
| `1A/1S` | `1B/1-` | `1C/3U` | `1F/2F` |
| `1G/2W` | `1H/2A` | `1J/2U` | `1K/1T` |
| `1L/2R` | `1N/1R` | `1N/2T` | `1U/M10` |
| `1V/1T` | `2B/2-` | `2C/3G` | `2F/3F` |
| `2G/4S` | `2H/4Y` | `2K/4W` | `2L/2+` |
| `2L/2S` | `2N/4U` | `2S/2V` | `3A/3S` |
| `3B/3-` | `3C/4G` | `3F/4E` | `3G/3N` |
| `3H/4Z` | `3J/3R` | `3J/4T` | `3K/4R` |
| `3L/4X` | `3V/3T` | `3T/4R` | `4A/4V` |
| `4B/4-` | `4E/5F` | `4F/5S` | `4G/5U` |
| `4H/4N` | `4K/5Z` | `4L/5A` | `4N/5X` |
| `4Y/5Y` | `5B/5-` | `5C/6K` | `5F/6E` |
| `5G/6S` | `5H/5+` | `5K/6W` | `5L/6A` |
| `5N/6U` | `5R/6T` | `5T/6R` | `5T/5V` |
| `5Y/6V` | `6B/6-` | `6C/M10` | `6E/6-` |
| `6G/6R` | `6H/6X` | `6J/6K` | `6L/6Z` |
| `6N/6T` | `6V/6Y` | `6Y/6+` |  |

**Procedure (as printed)**

- LEFT SHIFT (multiply by two): 1. Enter a binary number on the slide switches (RIGHT = 0, LEFT = 1). 2. Beginning at the left end of the console, set slide switch 1 to whatever position slide switch 2 is in, switch 2 to switch 3's position, and so on until switches 1-5 hold what 2-6 held. Set slide switch 6 to zero.
- RIGHT SHIFT (divide by two): 1. Enter a binary number. 2. Beginning at the right end, set slide switch 6 to switch 5's position, 5 to 4's, and so on until switches 2-6 hold what 1-5 held. Set slide switch 1 to zero. Anything to the right of the binary point is remainder.
- Leave this program wired for experiment 9.

**Notes**

- Uses matrix terminal M10 as a junction point (1U/M10, 6C/M10).

Errata **ER-25** [verified]: an accumulator must be capable of shifting and so must include a shift register; a shift register need not be capable of accumulating.

### IV-EXP9 — Experiment 9: The Accumulator (multiplication by successive additions and shifts)

Book IV printed pp.81-82 · `book2-3-4.pdf` PDF pp.87-88 · tier A · **[verified]** wiring is the Experiment 8 table (67 wires, image-read at 400 dpi against PDF p.86); the p.82 worked-example text image-read at 400 dpi (PDF p.88), 2026-10-14

NO NEW WIRING - uses the Experiment 8 accumulator as wired.

**Procedure (as printed)**

- Worked example 6 x 10 (110 x 1010), printed p.82 = PDF p.88, verbatim (the em dashes are the page's):
- We will do this by pushing the appropriate pushbuttons (in this case, pushbuttons 4 and 5.) The slide switches should all be RIGHT. As we push the pushbuttons, the output lights display the number—000110.
- Enter the number which you recorded in the slide switches and perform a left shift one bit as described in experiment 8. The output lights will now read 001100.
- The next left-most bit of the multiplier is 0. We will add nothing to the accumulator, but will shift left one bit. The output lights now show 011000.
- The next left-most bit of the multiplier is 1, so we will add—through the pushbuttons: 110 X 1 or 110 The output lights now show 011110.
- Enter the number which you just recorded in the slide switches and shift left one bit. The output lights now show 11100. The low order bit of the multiplier is 0, so it is not necessary to add anything more into the accumulator. The binary output lights now show the final result: 11100 or 60. 110 X 1010 = 111100 or 6 X 10 = 60
- The final shift is the first erratum-corrected observable: ER-26 (`errata.pdf` PDF p.3, 'page 82') reads "Note that decimal 60 is 111100 in binary. It is written incorrectly in two places." The page has exactly two '11100' strings, so the erratum means those two, and the page's own equation prints 111100. The fixture asserts 111100 (kept; reviewer ruling, 2026-10-14).

**Expected behaviour (as printed)**

- 'The limit of this accumulator is 111111 (63).'
- The printed worked example contains arithmetic slips (it writes 11100 then 111100 then '= 60' where 6 x 10 = 60 and 111100 = 60). Recorded as printed.

Errata **ER-26** [verified]: decimal 60 is `111100` in binary; p.82 writes it incorrectly in two places.

### IV-EXP10 — Experiment 10: Division (combination shift register and subtractor)

Book IV printed pp.83-84 · `book2-3-4.pdf` PDF pp.89-90 · 56 wires · tier A · **[verified]** table image-read 2026-10-14 against PDF p.89 (200 dpi page, 600 dpi crop; all 56 lines match); ER-27 image-read against `errata.pdf` p.3 at 600 dpi, and as printed it overfills `3G` (O-C13)

| | | | |
|---|---|---|---|
| `1A/1V` | `1B/1-` | `1R/3K` | `1S/2G` |
| `1T/3J` | `1U/2N` | `1W/2K` | `1X/3H` |
| `1Y/2H` | `1Y/2Y` | `1Z/3L` | `2A/4L` |
| `2B/2-` | `2C/3G` | `2F/3F` | `2L/2+` |
| `2R/3T` | `2S/4F` | `2T/3R` | `2T/2V` |
| `2U/4G` | `2X/4K` | `2Y/6S` | `2Z/4N` |
| `3A/5L` | `3B/3-` | `3C/4G` | `3F/4E` |
| `3G/3N` | `3K/M10` | `3R/6G` | `3S/5G` |
| `3T/6N` | `3U/5N` | `3V/3Y` | `3W/5K` |
| `3X/6L` | `3Y/3+` | `3Z/6H` | `4A/4R` |
| `4B/4-` | `4E/5F` | `4H/4N` | `4S/4+` |
| `5A/5R` | `5B/5-` | `5C/6K` | `5F/6E` |
| `5H/5+` | `5S/5+` | `6A/6R` | `6B/6-` |
| `6E/6-` | `6F/M10` | `6J/6K` | `6S/6+` |

**Procedure (as printed)**

- Worked example 27 / 5 (011011 / 101): write the dividend with a vertical line between the third and fourth digits so the divisor is greater than whatever is left of the line.
- Place the dividend on the slide switches. The dividend is now displayed in the output lights as 011011.
- Shift left one bit whenever the divisor is greater than the left-most three bits.
- Subtract the divisor from the dividend by entering the divisor on pushbuttons 1, 2 and 3. The result will appear in the output lights: p.83: first subtraction 110|110 - 101; "The result will appear in the output lights" 001|110. Then place the result in the slide switches; when the subtraction proceeded properly add 1 to the low order bit. The p.84 rows (001|111, 011|110, 111|100, 010|100, 010|101) are paper or slide-switch entries with no output-light claim.
- Continue until there have been as many left shifts as there were bits to the right of the vertical line. Answer is right of the line, remainder left of it: 010 | 101 -> 27/5 = 5 remainder 2.

**Notes**

- Uses matrix terminal M10 as a junction point (3K/M10; printed 6F/M10, which ER-27 moves to 6C/M10).

**Errata ER-27 [verified] — mandatory.** Remove `2C/3G`, `2Y/6S`, `3C/4G`, `5C/6K`, `6F/M10`; add `2E/3G`, `2Y/3G`, `3E/4G`, `5E/6K`, `6C/M10`, `6F/M+`. All five removal targets are present in the 56-line list above; the corrected list is **57 lines**, but it puts three plugs on two-hole `3G` (`2E/3G`, `2Y/3G` and the kept `3G/3N`): manual defect, see O-C13.

### IV-EXP11 — Experiment 11: Decimal to Binary Converter

Book IV printed pp.84-85 · `book2-3-4.pdf` PDF pp.90-91 · 49 wires · tier C1 · **[verified]** image-read 300 dpi (author) and 400 dpi crops (reviewer), 2026-10-14; all 49 wires match; no errata entry for Book IV pp.84-85 (the Book IV block on `errata.pdf` p.3 ends at page 83)

| | | | |
|---|---|---|---|
| `1E/D10` | `1F/2F` | `1G/3com` | `1H/1L` |
| `1K/6K` | `1L/2L` | `2E/D9` | `2F/3F` |
| `2G/5G` | `2H/2L` | `2H/3H` | `2K/3com` |
| `3A/3com` | `3B/3-` | `3E/D7` | `3F/4F` |
| `3G/6E` | `3H/3L` | `3K/4K` | `3L/4L` |
| `4A/4com` | `4B/4-` | `4E/D6` | `4F/5F` |
| `4G/5com` | `4H/4L` | `4H/5H` | `4K/4com` |
| `5A/5com` | `5B/5-` | `5E/D5` | `5F/6F` |
| `5G/6G` | `5H/5L` | `5K/4com` | `5L/6L` |
| `6A/6com` | `6B/6-` | `6E/D3` | `6F/6-` |
| `6G/6com` | `6H/6L` | `6H/6+` | `6K/5com` |
| `D1/6com` | `D2/5com` | `D4/4com` | `D8/3com` |
| `D16/M+` |  |  |  |

**Procedure (as printed)**

- Enter any decimal number from 0 through 10 by turning the rotary switch to the desired position. The binary equivalent of the decimal number will appear in the binary output lights. (A light ON represents 1; a light OFF represents 0.)

**Notes**

- Heavy use of the four COMMON terminals plus 5com/6com. Note the manual's own Book I text says only FOUR common terminals exist ('The four COMMON terminals are connected together'), yet 1com through 6com are used throughout Books III-VI. Settled elsewhere: `jack-map.md` §1 has `<1-6>com` [verified] (Book III p.58; Errata), and `open-questions.md` C18 settled the p.85 lines.

### IV-EXP12 — Experiment 12: Binary to Decimal Converter (tree circuit)

Book IV printed p.85 · `book2-3-4.pdf` PDF p.91 · 50 wires · tier C2 · **[verified]** image-read 300 dpi (2026-10-13); all 50 wires match; no errata entry for Book IV p.85

| | | | |
|---|---|---|---|
| `1C/4R` | `1F/2F` | `1G/6H` | `1H/5U` |
| `1J/5H` | `1K/6L` | `1L/5W` | `1N/5L` |
| `2C/5R` | `2F/3F` | `2G/3H` | `2H/4U` |
| `2J/4H` | `2K/3L` | `2L/4W` | `2N/4L` |
| `3C/6R` | `3C/4C` | `3F/4F` | `3G/D15` |
| `3J/D14` | `3K/D11` | `3N/D10` | `3U/4V` |
| `3V/3-` | `3W/5V` | `4C/5C` | `4F/5F` |
| `4G/D13` | `4J/D12` | `4K/D9` | `4N/D8` |
| `4S/4+` | `4S/5S` | `5C/6C` | `5F/6F` |
| `5G/D3` | `5J/D2` | `5K/D1` | `5N/D0` |
| `5S/6S` | `6F/6-` | `6G/D7` | `6J/D6` |
| `6K/D5` | `6N/D4` | `6X/D17` | `6Y/6+` |
| `D16/D19` | `D18/M-` |  |  |

**Procedure (as printed)**

- Enter any binary number from 0 through 15 on slide switches 3 through 6.
- Push pushbutton 6. The rotary switch will indicate the decimal equivalent of the binary number.

### IV-APX-SHIFTREG — Appendix: Automatic Shift Register (full six-bit)

Book IV printed pp.86-87 · `book2-3-4.pdf` PDF pp.92-93 · 60 wires · tier C2 · **[verified]** image-read `book2-3-4.pdf` PDF p.92 at 150 dpi plus a 300 dpi crop of columns 2-3 (2026-10-14); all 60 wires match, and the middle-two-bits circuit diagram agrees with the table; no erratum touches pp.86-87 (the errata sheet's page 80 entry points at this program as prose only)

| | | | |
|---|---|---|---|
| `1A/1X` | `1B/1-` | `1C/2C` | `1E/2N` |
| `1F/1G` | `1F/2K` | `1G/1X` | `1H/2H` |
| `1L/D1` | `1Y/2Y` | `2A/2X` | `2B/2-` |
| `2C/3C` | `2E/3N` | `2F/2G` | `2F/3K` |
| `2G/2X` | `2H/3H` | `2L/D2` | `2Y/3Y` |
| `3A/3X` | `3B/3-` | `3C/4C` | `3E/4N` |
| `3F/3G` | `3F/4K` | `3G/3X` | `3H/4H` |
| `3L/D3` | `3Y/4Y` | `4A/4X` | `4B/4-` |
| `4C/5C` | `4E/5N` | `4F/4G` | `4F/5K` |
| `4G/4X` | `4H/5H` | `4L/D4` | `4Y/5Y` |
| `5A/5X` | `5B/5-` | `5C/6C` | `5E/6N` |
| `5F/5G` | `5F/6K` | `5G/5X` | `5H/6H` |
| `5L/D5` | `5Y/6Y` | `6A/6X` | `6B/6-` |
| `6C/6-` | `6E/D7` | `6F/6G` | `6G/6X` |
| `6H/6+` | `6L/D6` | `6Y/D16` | `D16/M+` |

**Procedure (as printed)**

- Enter a binary number in the shift register by pushing and releasing the appropriate pushbuttons. The number will appear in the output lights.
- Shift LEFT one bit by slowly turning the rotary switch dial one complete revolution. The shifted binary number will now appear in the output lights.
- To shift left more than one bit simply turn the rotary switch dial the desired number of revolutions.

The page prints no lamp pattern, no pushbutton-to-light tie and no turn direction (the only printed pushbutton-to-light pattern in Book IV is `IV-EXP9`'s p.82 example, O-C18).

### IV-APX-2BITADDER — Appendix: Two-Bit Adder with Automatic Decimal Conversion

Book IV printed p.87 · `book2-3-4.pdf` PDF p.93 · 49 wires · tier C2 · **[verified]** image-read `book2-3-4.pdf` PDF p.93 at 600 dpi (2026-10-13)

| | | | |
|---|---|---|---|
| `1C/4H` | `1F/2F` | `1G/3H` | `1H/6G` |
| `1J/2H` | `1K/3L` | `1L/6J` | `1N/2L` |
| `2C/4K` | `2C/3C` | `2F/3F` | `2G/D5` |
| `2J/D1` | `2K/D4` | `2N/D0` | `3F/4F` |
| `3G/D7` | `3J/D3` | `3K/D6` | `3N/D2` |
| `4A/5R` | `4A/4K` | `4B/4-` | `4C/5V` |
| `4F/5F` | `4G/5J` | `4H/5A` | `4J/5G` |
| `4L/4J` | `5B/5-` | `5C/6R` | `5F/6F` |
| `5H/5+` | `5S/5W` | `5U/5Z` | `5W/5X` |
| `5Y/6Y` | `6A/6C` | `6B/6-` | `6C/6V` |
| `6F/6-` | `6H/5-` | `6S/6W` | `6U/6Z` |
| `6W/6X` | `6Y/6+` | `D16/D19` | `D17/M+` |
| `D18/M-` |  |  |  |

**Procedure (as printed)**

- Enter a 2-bit binary number in slide switches 5 and 6.
- Enter a second 2-bit binary number on pushbuttons 5 and 6.
- The rotary switch dial will turn to the decimal sum of the numbers. (Binary output lights 4, 5 and 6 will display the sum in binary.)

### ER-ALTCOUNTER — THREE-BIT BINARY COUNTER — ALTERNATE CIRCUIT

`errata.pdf` p.2, right column · 48 wires · tier B · **[verified]** 300 dpi crop of `errata.pdf` p.2 right col, read twice (gap-canonical, then gap-verify UP-01 independently)

**A complete program that appears in no book.** The errata sheet supplies it because Book IV's own counter strains the relays; this circuit bypasses the relay indicator lamps so full voltage reaches the coils. Any conformance suite that runs `IV-EXP1` needs this one too.

Printed layout: 4 columns x 12 rows, read column-major.

| col 1 | col 2 | col 3 | col 4 |
|---|---|---|---|
| `1A/2E` | `2C/2-` | `3H/5A` | `5F/6F` |
| `1B/1C` | `2E/2J` | `3J/4H` | `5F/5H` |
| `1B/2B` | `2G/2N` | `3N/4N` | `5G/5+` |
| `1C/2C` | `2H/3L` | `4B/5B` | `5H/6A` |
| `1E/2G` | `2L/2-` | `4C/4-` | `5J/6H` |
| `1F/2F` | `3A/6E` | `4E/4J` | `5N/6N` |
| `1F/1H` | `3B/4B` | `4G/4N` | `6C/6-` |
| `1G/1+` | `3C/4C` | `4H/5L` | `6E/6J` |
| `1H/4A` | `3E/4G` | `4L/4-` | `6G/6N` |
| `1J/2H` | `3F/3H` | `5B/6B` | `6H/6X` |
| `2A/4E` | `3F/4F` | `5C/6C` | `6L/6-` |
| `2B/3B` | `3G/3+` | `5E/6G` | `6Y/6+` |

**Procedure (as printed)**

Use the procedure on page 72 of Book IV. When pushing pushbutton 6, be sure to hold the pushbutton down long enough for any carry to propagate to the highest stage of the counter.

Procedure, verbatim: 'Use the procedure on page 72 of Book IV. When pushing pushbutton 6, be sure to hold the pushbutton down long enough for any carry to propagate to the highest stage of the counter.'

OCR corrections applied and image-confirmed: `IF/TH` -> `1F/1H`; `61/6-` -> `6L/6-`; and every plus sign, which the text layer renders `-f` or `-|-`, in `1G/1+`, `3G/3+`, `5G/5+`, `6Y/6+`.

Circuit-diagram labels on the same crop (middle stage only): `3C`-lamp-`3E`-resistor-`3F`; `4-`; `4C`-lamp-`4E`-resistor-`4F`; `4J`; `3J`; `3G` `3+`; **'TO 5L (CARRY IN)'**; `4H`; `4G`; `3H`; `3N`; `4N`; **'TO 2H (CARRY OUT)'**; `3L`-`3K`; `4-` `4L`-`4K`. The carry labels corroborate the program's `2H/3L` and `4H/5L` stage-boundary wires.

**Do not lift `IV-EXP1`'s expected trace onto this wire list mechanically.** Book IV p.72 asserts 'binary output lights 4, 5 and 6 will read OFF, OFF, ON or 001', but this circuit taps all three of those lamps differently (main counter ties `2F/4A`, `4F/5A`, `6A/6F` — coil far ends; alternate ties `1H/4A`, `3H/5A`, `5H/6A` — contact commons) and chains the cathodes instead of running six separate `nB/n-` wires. Whether lights 4, 5 and 6 still read the count here is answered for Procedure steps 1 and 2 only, by the errata's reference to the p.72 procedure (Book IV p.72, PDF p.78, step 1: 'Turn power ON. Push pushbutton 6 and release. Binary output lights 4, 5 and 6 will read OFF, OFF, ON or 001. The Binary Counter is displaying a 1.'; step 2: 'Push pushbutton 6 again and release. Binary output lights 4, 5 and 6 will now read OFF, ON, OFF or 010. The Binary Counter is now displaying a 2.'); per-press states from press 3 on remain derived (Step 7). Only the p.72 Procedure step 1 and 2 readings are lifted, by the errata's own reference ("Use the procedure on page 72 of Book IV"; ER-21 makes this circuit the substitute for the Book IV counter; errata p.3 says the alternate circuit is used "for experiments 1 and 2"). Nothing from the p.71 chart is lifted.

### 4.5 Book V — *How Computers Work for Man*

Twenty-one experiments plus seven standalone circuits. Coverage confirmed complete against the CONTENTS page. `book5-6.pdf`, printed page N = PDF page N+6.

| ID | Program | Printed p. | PDF p. | Wires | Tier | Tag |
|---|---|---|---|---|---|---|
| `V-EXP1` | Experiment 1: The Lights on the Stairs | 2 | 8 | 5 | A | [verified] |
| `V-EXP2` | Experiment 2: The Burglar Alarm | 2-3 | 8-9 | 16 | B | [verified] |
| `V-EXP3` | Experiment 3: The Metronome | 3-4 | 9-10 | 17 | C2 | [verified] |
| `V-EXP4` | Experiment 4: The Traffic Light | 5 | 11 | 22 | C2 | [verified] |
| `V-EXP5` | Experiment 5: Traffic Light with Pedestrian Control | 5-6 | 11-12 | 26 | C2 | [verified] |
| `V-EXP6` | Experiment 6: The Automobile Speed Timer | 6-8 | 12-14 | 35 | C2 | [verified] image-read 300 dpi (PDF p.12), all 35 lines confirmed |
| `V-EXP7` | Experiment 7: The Train Gate Control | 8-10 | 14-16 | 25 | C2 | [verified] |
| `V-EXP8` | Experiment 8: The Two-Floor Elevator | 10-11 | 16-17 | 23 | C2 | [verified] |
| `V-EXP9` | Experiment 9: The Three-Floor Elevator | 11-12 | 17-18 | 48 | C2 | [likely] |
| `V-EXP10` | Experiment 10: The Automatic Toll Collector | 12-13 | 18-19 | 55 | C2 | [verified] |
| `V-EXP11` | Experiment 11: The Telephone Dialing System | 13-14 | 19-20 | 52 | C2 | [verified] image-read 300/400 dpi (2026-10-13) |
| `V-EXP12` | Experiment 12: Arabic Numeral Recognition | 22-23 | 28-29 | 38 | C2 | [verified] image-read 300 dpi (2026-10-13) |
| `V-EXP13` | Experiment 13: Multiple Point Control | 24 | 30 | 28 | B | [verified] image-read 300/400 dpi (Step 6 fidelity review, 2026-10-14), all 28 lines confirmed |
| `V-EXP14` | Experiment 14: Sequence Control with Manual Operation | 24-25 | 30-31 | 60 | B | [verified] image-read (batch review, 2026-10-14) |
| `V-EXP15` | Experiment 15: Automatic Sequence Control | 25 | 31 | 47 | C2 | [verified] image-read (batch 1 review, 2026-10-13) |
| `V-EXP16` | Experiment 16: Automatic Message Transmission (CQ) | 29-30 | 35-36 | 20 | C2 | [verified] |
| `V-EXP17` | Experiment 17: Automatic Name Transmission (JOHN) | 30-31 | 37 | 38 | C2 | [likely] |
| `V-EXP18` | Experiment 18: Differential Spacing (SOS) | 31 | 37 | 28 | C2 | [verified] |
| `V-EXP19` | Experiment 19: Encoder for Morse Code | 32-34 | 38-40 | 49 | C1 | [verified] all 49 wires image-read at 600 dpi of PDF p.39 |
| `V-EXP20` | Experiment 20: Decoder for Morse Code | 34-35 | 40-41 | 60 | C2 | [verified] image-read 300 dpi (2026-10-13) |
| `V-EXP21` | Experiment 21: 'Search and Track' Radar | 35-36 | 41-42 | 37 | C2 | [verified] |
| `V-XLAT-IHREM` | Selection rule for translation of 'ihrem' | 38 | 45 | 14 | A | [likely] |
| `V-XLAT-FULL` | English/German translation program | 39-40 | 46 | 28 | A | [likely] |
| `V-JOBSELECT` | Job Selection (one section, repeated x6) | 41-42 | 48 | 5 x 6 | A | [verified] |
| `V-ASSOCMEM` | Associative Memory (conditioning simulation) | 44 | 50 | 40 | B | [verified] |
| `V-MAZESOLVER` | A Simulated Maze Solver | 44-45 | 50-51 | 40 | C2 | [likely] |
| `V-FLASHINGLIGHTS` | The Flashing Lights Circuit | 45 | 51-52 | 24 | C2 | [likely] |
| `V-SUPERCIRCUIT` | The 'Super' Circuit | 46 | 52 | 63 | C2 | [likely] |

'Mate Selection' (Book V p.42) has no separate program — the text says it reuses the Job Selection wiring with different questionnaires, so its absence is correct. [verified] `book5-6.pdf` CONTENTS and p.48.

### V-EXP1 — Experiment 1: The Lights on the Stairs (dual-control light)

Book V printed p.2 · `book5-6.pdf` PDF p.8 · 5 wires · tier A · **[verified]** 400 dpi image read

| | | | |
|---|---|---|---|
| `1A/1+` | `1B/1V` | `1U/2U` | `1W/2W` |
| `2V/2-` |  |  |  |

**Initial settings (as printed)**

- Slide switch 1 = the switch at the top of the stairs; slide switch 2 = the switch at the bottom.

**Procedure (as printed)**

- Light 1 can be turned either ON or OFF using slide switches 1 or 2.
- For example, moving slide switch 1 to the LEFT will turn light 1 ON if slide switch 2 is RIGHT. The light will go OFF if slide switch 2 is now moved to the LEFT.

**Expected behaviour (as printed)**

- Two-way switching: light 1 toggles from either switch, regardless of the other switch's position.

**Topology-derived absolute phase** `[unverified]`

- With Book I and Maintenance's independently verified LEFT=`V-U`, RIGHT=`V-W` polarity, the
  image-verified wires and printed circuit diagram both give LL=ON, LR=OFF, RL=OFF, RR=ON.
- Book V's worked LR-ON/LL-OFF prose prints the exact inverse and is not an acceptance oracle. This is a manual defect, and it does not depend on switch polarity: the printed wires (`1U/2U`, `1W/2W`) conduct only when both arms are on the same side, under any uniform polarity, so the inversion cannot be repaired by relabelling LEFT and RIGHT (O-C24).
  `V-EXP1` preserves the wires and tags all four absolute outcomes
  `FALLBACK-V-EXP1-TOPOLOGY`; ER-28 supports only each one-switch toggle.

**Notes**

- TOC calls it 'The Light on the Stairs'; the section heading reads 'The Lights on the Stairs'. The manual calls this 'a version of the AND circuit'.

Errata **ER-28** [verified]: 'moving either slide switch will change the light to the opposite state (ON or OFF), regardless of the position of the other slide switch.' This is a printed toggle invariant compatible with either XOR or XNOR; it does not repair or select the contradictory absolute phase. The manual itself calls this circuit 'a version of the AND circuit'.

### V-EXP2 — Experiment 2: The Burglar Alarm

Book V printed pp.2-3 · `book5-6.pdf` PDF pp.8-9 · 16 wires · tier B · **[verified]** 400 dpi image read of PDF p.9 (wires and procedure on printed p.3); matches line for line

| | | | |
|---|---|---|---|
| `1X/6F` | `1Y/2Y` | `2Y/2-` | `2Z/3Y` |
| `3Z/4Y` | `4Z/5Y` | `5A/5+` | `5B/5J` |
| `5E/5+` | `5F/5H` | `5J/6J` | `5Z/6Y` |
| `6C/6+` | `6F/6L` | `6H/6-` | `6K/6Z` |

**Procedure (as printed)**

- Intro, printed p.2 = PDF p.8 (image-read): If any contact is broken by pushing any of pushbuttons 2 through 6, the alarm (light 5) comes on. The system is re-set by pushing pushbutton 1.
- Turn power ON. The alarm (light 5) comes ON.
- Set the system by pushing the re-set button (pushbutton 1). The burglar alarm is now set.
- If any contact is broken by pushing any of pushbuttons 2 through 6, the alarm will come on.
- After an alarm has been given, the system can be re-set by pushing pushbutton 1.

**Expected behaviour (as printed)**

- Light 5 = the alarm. Pushbutton 1 = re-set. Pushbuttons 2-6 = the protected contacts. Illustrates the NOT function.

### V-EXP3 — Experiment 3: The Metronome

Book V printed pp.3-4 · `book5-6.pdf` PDF pp.9-10 · 17 wires · tier C2 · **[verified]** image-read at 300 dpi (PDF p.10), 17 wires match in order

| | | | |
|---|---|---|---|
| `4R/D3` | `4S/5R` | `4T/D5` | `4U/D7` |
| `4V/5T` | `4W/D9` | `5S/6K` | `6C/6L` |
| `6E/D16` | `6F/6-` | `6G/D1` | `6G/6N` |
| `6H/D17` | `6J/6K` | `6J/6+` | `6L/D18` |
| `6N/6-` |  |  |  |

**Procedure (as printed)**

- Turn power on. The rotary switch dial will begin to turn back and forth, generating a periodic signal.
- To change the period of the signal, move slide switches 4 and 5.

**Expected behaviour (as printed)**

- Rotary switch oscillates between two dial points. Four periods are selectable via slide switches 4 and 5. 'Through an appropriate circuit, the MINIVAC is capable of generating 15 different periods.'
- Diagram versus table: the printed circuit diagram on PDF p.10 (read at 600 dpi) draws the `6K` feed to `4S` rather than `5S` and leaves `5S` unconnected. The program table's `5S/6K` is followed: with the diagram's wiring switch 5 would be inert, which contradicts p.3's 'only four periods can be produced using the positions of slide switches 4 and 5'. No erratum covers it (errata.pdf pp.3-4 have no Book V p.3 or p.4 entry). The derivation therefore rests on the table plus the p.3 text, not on the diagram.

### V-EXP6 — Experiment 6: The Automobile Speed Timer

Book V printed pp.6-8 · `book5-6.pdf` PDF pp.12-14 · 35 wires · tier C2 · **[verified]** image-read at 300 dpi (`book5-6.pdf` PDF p.12), all 35 lines confirmed (columns of 9/9/9/8; author and Step 6 reviewer)

| | | | |
|---|---|---|---|
| `1C/1G` | `1C/2K` | `1F/1-` | `1H/1+` |
| `1H/2H` | `2C/2G` | `2C/3K` | `2F/2-` |
| `2H/3H` | `2L/D11` | `3C/3G` | `3C/4K` |
| `3F/3-` | `3H/4H` | `3L/D12` | `4C/4G` |
| `4C/5K` | `4F/4-` | `4H/5H` | `4L/D13` |
| `5C/5G` | `5C/D15` | `5F/5-` | `5L/D14` |
| `5X/6E` | `5Y/5-` | `6C/6G` | `6C/6X` |
| `6F/6-` | `6H/6+` | `6H/6L` | `6K/D17` |
| `6Y/6+` | `D16/M+` | `D18/M-` |  |

**Procedure (as printed)**

- Push pushbutton 6 as a car passes the first check point (starts the timing motor).
- Push pushbutton 5 as the car passes the second check point (stops the motor).
- Read the speed of the passing car from the dial plate: the speed is read from the band corresponding to the LOWEST NUMBERED relay indicator light which is on.

**Expected behaviour (as printed)**

- The rotary switch runs while timing; relay indicator lights 1-5 count the revolutions.
- Manual note: 'the program above indicates a revolution of the rotary switch when the dial has completed 15/16 of a revolution' - so the counted cycle is 0..15 then 15..14 then 14..13, etc.
- Printed direction support for O-R11: p.7 counts a revolution from 0 to 15, and in this circuit relay 6 feeds + to D17 through `6L/6K` while D18 sits on M-. The page therefore states that D17 at + and D18 at - turns the dial toward increasing numbers (`open-questions.md` O-R11, `rotary.md` §4). No Step 6 assert covers it: with D17 and D18 swapped every assert still passes (reviewer scratch run).
- The p.8 dial plate prints each example speed in one sector only: 83.52 at sector 15 in band 5, 41.76 at 14 in band 4, 27.64 at 13 in band 3 (image-read, PDF p.14, with 20.13 and 16.70 at 12 and 11). That points to a three-revolution stop at 13; the pb5 rest pad depends on the coast constant (O-R14).

**Dial-plate calibration (as printed)**

- 1. Measure the distance between the two check-points.
- 2. Convert to miles (e.g. yards / 1760).
- 3. Count complete revolutions per minute, multiply by 16/15.
- 4. Multiply by 60 -> revolutions per hour.
- 5. Multiply by the distance in miles -> mph for one revolution.
- Worked example: 50 yards = .029 miles; 45 rev/min x 16/15 = 48 rev/min; x60 = 2880 rev/hr; .029 x 2880 = 83.52 mph for one revolution; 41.76 mph for two; 27.64 mph for three (as printed - 83.52/3 = 27.84, the manual prints 27.64).

**Per-line flags**

| Line | Tag | Note |
|---|---|---|
| `2L/D11` | [verified] | Printed '2L/D11' (image-read at 300 dpi, PDF p.12). The series 2L/D11, 3L/D12, 4L/D13, 5L/D14 is internally consistent. |
| `5L/D14` | [verified] | The p.6 circuit diagram labels relay 5's lower arm 5L with D13 (a second D13), against the list's 5L/D14. The list is wired: p.7's count order 15, 14, 13 needs D14. Not in the errata (Book V entries are pages 2, 10, 11, 12, 21-22, 24, 25, 30, 31, 33 and 35). |
| `D18/M-` | [verified] | The p.6 diagram draws D18 to a bare 'M'; the list prints D18/M-. Not in the errata. |

The printed worked example computes 83.52 / 3 as **27.64** mph; it is 27.84. Recorded as printed, not corrected. [likely] Book V p.7.

### V-EXP7 — Experiment 7: The Train Gate Control

Book V printed pp.8-10 · `book5-6.pdf` PDF pp.14-16 · 25 wires · tier C2 · **[verified]** image-read at 400 dpi (`book5-6.pdf` PDF p.15) plus the author's repo-render read; all 25 lines confirmed

| | | | |
|---|---|---|---|
| `4C/5C` | `4F/4X` | `4F/4K` | `4G/5G` |
| `4H/5H` | `4L/5L` | `4Y/5Y` | `5C/6C` |
| `5F/6X` | `5F/5K` | `5G/6F` | `5H/5+` |
| `5L/5X` | `5Y/6Y` | `6C/6-` | `6G/6N` |
| `6H/6-` | `6J/6K` | `6J/D17` | `6L/6+` |
| `6L/6Y` | `6N/D18` | `D0/M+` | `D7/M-` |
| `D16/D19` |  |  |  |

**Initial settings (as printed)**

- Turn power on and set the pointer knob of the rotary switch at 0.
- The rotary switch at 0 represents the gate up; 7 represents the gate closed.

**Procedure (as printed)**

- 1. Push pushbutton 4.
- 2. While holding pushbutton 4 down, push pushbutton 5.
- 3. Hold pushbutton 5 down and release pushbutton 4.
- 4. While holding pushbutton 5 down, push pushbutton 6.
- 5. Hold pushbutton 6 down and release pushbutton 5.
- 6. Release pushbutton 6.
- Push pushbutton 5. This represents a car passing over the center of the crossing. Notice that the gate does not close.

**Expected behaviour (as printed)**

- Notice that the gate closes (the pointer knob moves to the "gate closed" position—7) as soon as the first switch is activated and remains closed until none of the switches is activated
- Push pushbutton 5. This represents a car passing over the center of the crossing. Notice that the gate does not close.

**Input sequence (as printed)**

| Pushbutton 4 | Pushbutton 5 | Pushbutton 6 |
|---|---|---|
| 0 | 0 | 0 |
| 1 | 0 | 0 |
| 1 | 1 | 0 |
| 0 | 1 | 0 |
| 0 | 1 | 1 |
| 0 | 0 | 1 |
| 0 | 0 | 0 |

_[likely] _

Errata **ER-29** [verified]: p.10 second sentence should read 'The same will be true for a train moving **right** through. . . .'

### V-EXP4 — Experiment 4: The Traffic Light

Book V printed p.5 · `book5-6.pdf` PDF p.11 · 22 wires · tier C2 · **[verified]** 500 dpi (finder) and 130 dpi (verifier) image reads of `book5-6.pdf` p.11; all 22 lines confirmed

| | | | |
|---|---|---|---|
| `4A/4+` | `4B/D11` | `5A/5+` | `5B/D7` |
| `6A/6+` | `6B/D1` | `D1/D2` | `D2/D3` |
| `D3/D4` | `D4/D5` | `D5/D6` | `D7/D8` |
| `D8/D9` | `D9/D10` | `D11/D12` | `D12/D13` |
| `D13/D14` | `D14/D15` | `D15/D0` | `D16/M-` |
| `D17/M-` | `D18/M+` |  |  |

**Procedure (as printed)**

- Turn power on. The rotary switch will turn, turning lights 4, 5 and 6 on and off in succession.
- Light 4 represents "red", light 5 represents "amber", and light 6 represents "green".
- p.4 narrative (PDF p.10): 'follows a pre-programmed cycle from red to green to yellow and back to red' - conflicts with the p.5 order under O-R11.
- The length of time any given light remains on may be varied by changing the connections on the rotary switch.

**Per-line flags**

| Line | Tag | Note |
|---|---|---|
| `D17/M-` | [verified] | As printed, D16 and D17 both go to `M-` and D18 to `M+` - the motor across the rail in one polarity. Under the errata's single-node `-` rule this is unremarkable, not anomalous; V-EXP5 is the opposite polarity. Not a discrepancy (C-05). |
| `D11/D12` | [verified] | OCR text layer renders 'D1I/D12'; image confirms D11/D12. |

`D16/M-`, `D17/M-`, `D18/M+` is what the page prints. The finder flagged it as anomalous against Experiment 5; it is not (C-05). Given that all `-` terminals are one node, two rotary terminals landing on `M-` is unremarkable. Experiment 4 puts the motor across the rail one way, Experiment 5 the other. Record it as a polarity difference, not a printing discrepancy.

`D11/D12` is image-confirmed; the OCR text layer renders it `D1I/D12`.

### V-EXP5 — Experiment 5: The Traffic Light with Pedestrian Control

Book V printed pp.5-6 · `book5-6.pdf` PDF pp.11-12 · 26 wires · tier C2 · **[verified]** 500 dpi (finder) and 130 dpi (verifier) image reads of `book5-6.pdf` p.11; all 26 lines confirmed

| | | | |
|---|---|---|---|
| `4A/4+` | `4B/D1` | `5A/5+` | `5B/D14` |
| `5E/5+` | `5F/5Z` | `5H/5-` | `5J/D18` |
| `5Y/D6` | `6A/6+` | `6B/D7` | `D1/D2` |
| `D2/D3` | `D3/D4` | `D4/D5` | `D5/D6` |
| `D7/D8` | `D8/D9` | `D9/D10` | `D10/D11` |
| `D11/D12` | `D12/D13` | `D14/D15` | `D15/D0` |
| `D16/M-` | `D17/M+` |  |  |

**Procedure (as printed)**

- Turn power on. The 'red' light (light 4) comes ON.
- To cross the street: push pushbutton 5 until the 'red' light (light 4) goes OFF and the 'green light' (light 6) comes ON.
- After the light has turned green, it will go to amber (light 5) and return to red again.
- This traffic light, facing the pedestrian, would normally be red,

**Notes**

- Note there is no D13/D14 connection in this program, unlike V-EXP4. As printed.

The absence of a `D13/D14` line is real, not a dropped line — confirmed by both image reads. `D18` is taken over here by the pedestrian interrupt (`5J/D18`).

### V-EXP8 — Experiment 8: The Two-Floor Elevator

Book V printed pp.10-11 · `book5-6.pdf` PDF pp.16-17 · 23 wires · tier C2 · **[verified]** image-read at 400 dpi (PDF p.17; 23 of 23 lines match; the PDF p.16 circuit diagram at 300 dpi agrees)

| | | | |
|---|---|---|---|
| `5A/6C` | `5B/5-` | `5B/6B` | `5C/5-` |
| `5C/5H` | `5F/6X` | `5G/6E` | `5L/5X` |
| `5N/6E` | `5Y/6Y` | `6A/6K` | `6C/6G` |
| `6J/D17` | `6F/6-` | `6G/6N` | `6H/6+` |
| `6J/6K` | `6L/6-` | `6N/D18` | `6Y/D1` |
| `D1/M+` | `D7/M-` | `D16/D19` |  |

**Procedure (as printed)**

- To call the "elevator" to the second floor, push pushbutton 6. The "elevator" will immediately move to the second floor (the pointer knob will point to 7).
- To return the "elevator" to the first floor, push pushbutton 5.

**Expected behaviour (as printed)**

- The rotary switch dial at 1 indicates that the elevator is at the first floor; the dial at 7 indicates that the elevator is at the second floor.
- Similarly, binary output light 5 on indicates that the elevator is at the first floor; binary output light 6 on indicates that the elevator is at the second floor.
- Lights 5 and 6 follow relay 6 (`6J/6K`/`6A/6K` and `6G/6C`/`5A/6C`), so each changes at the push, before the knob arrives (about 0.42 s at 45 rpm); the p.10 floor map and the p.26 "as soon as light 6 comes on" hold only at rest.
- Pushbuttons 5 and 6 serve as both the floor call buttons and the in-car buttons.

**Initial setting is superseded.** The list above's 'set the pointer knob of the rotary switch at 1' is the uncorrected text. Errata **ER-30** [verified]: 'Set the elevator at the first floor by **pushing pushbutton 5**.'

**This is Experiment 8's only erratum.** The reliability block (`remove 5F/6C, 6C/6-`...) that some earlier files filed here belongs to Experiment 9 (C-09).

Reused on printed p.26 (`book5-6.pdf` PDF p.32, image-read) to demonstrate manual control with feedback: knob at 1, push pushbutton 6 (knob to 7, light 6 = feedback), push pushbutton 5 (knob to 1, light 5 = feedback). The page says: "To start the system, we will set the pointer knob at 1 and push pushbutton 6. This moves the pointer knob to 7, and light 6 will come on to indicate that the system is now at 7." ER-30 does not correct that start. It has no record of its own; it stays a cross-reference here.

### V-EXP9 — Experiment 9: The Three-Floor Elevator

Book V printed pp.11-12 · `book5-6.pdf` PDF pp.17-18 · 48 wires · tier C2 · **[likely]** clean OCR; not image-read

| | | | |
|---|---|---|---|
| `1A/1E` | `1B/1-` | `1C/2C` | `1E/D1` |
| `1F/1G` | `1G/1X` | `1H/1+` | `1H/1L` |
| `1J/2H` | `1K/5E` | `1Y/2Y` | `2A/2E` |
| `2B/2-` | `2C/3C` | `2E/D7` | `2F/2G` |
| `2G/2X` | `2J/3H` | `2X/6H` | `2Y/3Y` |
| `3A/3E` | `3B/3-` | `3C/4C` | `3E/D13` |
| `3F/3G` | `3G/3X` | `3J/4E` | `3Y/4J` |
| `4C/5F` | `4F/4+` | `4G/4H` | `4H/4+` |
| `4L/D19` | `4N/D18` | `5C/5G` | `5E/6G` |
| `5F/6C` | `5G/5N` | `5J/5K` | `5J/D17` |
| `5L/5-` | `5N/D18` | `6C/6-` | `6F/D12` |
| `D0/D1` | `D6/D7` | `D12/D13` | `D16/M-` |

**Corrected wire list (errata ER-31: `4G/4H` -> `4G/5H`, `D16/M-` -> `D16/M+`)**

| | | | |
|---|---|---|---|
| `1A/1E` | `1B/1-` | `1C/2C` | `1E/D1` |
| `1F/1G` | `1G/1X` | `1H/1+` | `1H/1L` |
| `1J/2H` | `1K/5E` | `1Y/2Y` | `2A/2E` |
| `2B/2-` | `2C/3C` | `2E/D7` | `2F/2G` |
| `2G/2X` | `2J/3H` | `2X/6H` | `2Y/3Y` |
| `3A/3E` | `3B/3-` | `3C/4C` | `3E/D13` |
| `3F/3G` | `3G/3X` | `3J/4E` | `3Y/4J` |
| `4C/5F` | `4F/4+` | `4G/5H` | `4H/4+` |
| `4L/D19` | `4N/D18` | `5C/5G` | `5E/6G` |
| `5F/6C` | `5G/5N` | `5J/5K` | `5J/D17` |
| `5L/5-` | `5N/D18` | `6C/6-` | `6F/D12` |
| `D0/D1` | `D6/D7` | `D12/D13` | `D16/M+` |

**Initial settings (as printed)**

- Set the 'elevator' at the first floor by setting the pointer knob at D0.
- Turn power on. Output light 1 will come on indicating the location of the 'elevator'.

**Procedure (as printed)**

- To call the 'elevator' to the third floor, push pushbutton 3.
- To direct the 'elevator' to the second floor, push pushbutton 2.

**Expected behaviour (as printed)**

- Nine-step behaviour is stated: sense present floor, compare with destination, store destination, select direction, move, interlock the pushbuttons while moving, continue to destination, stop and clear the stored destination, clear the interlock.
- 'the system is still not able to accept more than one command at once.'

**Notes**

- Both 4N/D18 and 5N/D18 appear. As printed.

**Floor map (as printed)**

| &nbsp; | call button | indicator light | rotary switch pair |
|---|---|---|---|
| Floor 1 | pushbutton 1 | output light 1 | D0-D1 |
| Floor 2 | pushbutton 2 | output light 2 | D6-D7 |
| Floor 3 | pushbutton 3 | output light 3 | D12-D13 |

_[likely] _

**Errata ER-31 [verified] — mandatory, and it lands on four unflagged lines of the printed list.** Two program changes (above), plus two Notes that belong to *this* experiment, not Experiment 8:

- The 'elevator' can get stuck when the pointer knob stops **between** adjacent terminals (e.g. between `D6` and `D7`) and makes proper contact with neither. This is a real hardware failure mode the simulator may want to model or explicitly exclude. [verified]
- If performance is unsatisfactory: remove `5F/6C`, `6C/6-`; add `5F/6E`, `6E/6-`, `4E/6C`. [verified]

Both `4N/D18` and `5N/D18` appear in the printed list. As printed; same node either way.

### V-EXP10 — Experiment 10: The Automatic Toll Collector

Book V printed pp.12-13 · `book5-6.pdf` PDF pp.18-19 · 55 wires · tier C2 · **[verified]** wire table and ER-32 image-read at 400 dpi (Phase 5 batch 1 review, 2026-10-13). ER-32 as printed strands relay 5 set 2: open-questions.md O-C8

| | | | |
|---|---|---|---|
| `1A/3K` | `1A/2E` | `1B/1E` | `1B/2B` |
| `1C/1J` | `1E/2C` | `1F/1H` | `1J/2K` |
| `2A/3N` | `2B/3B` | `2C/3C` | `2F/2G` |
| `2F/4N` | `2H/2L` | `2H/2+` | `3A/3E` |
| `3B/4B` | `3C/4C` | `3E/4G` | `3F/3H` |
| `3F/4F` | `3G/3L` | `3G/3+` | `3J/4H` |
| `3J/4X` | `3L/3Y` | `3N/6Y` | `3X/4L` |
| `4A/4E` | `4B/5B` | `4C/5C` | `4E/4J` |
| `4H/5N` | `4K/5N` | `4Y/5Y` | `5A/5E` |
| `5B/6B` | `5C/6C` | `5E/6G` | `5F/5H` |
| `5F/6F` | `5G/5+` | `5J/5X` | `5J/6H` |
| `5L/6G` | `5X/D5` | `5Y/6Y` | `6A/6E` |
| `6C/6-` | `6E/6J` | `6X/D16` | `6X/D18` |
| `D0/D19` | `D5/D10` | `D17/M-` |  |

**Procedure (as printed)**

- Turn power on. Output light 2 comes on indicating 'Stop - Pay Toll 10c'.
- one dime: push pushbutton 4
- two nickels: push pushbutton 5 twice
- one nickel and five pennies: push pushbutton 5 once; then set the rotary switch dial to 5 and push pushbutton 6
- ten pennies: set the rotary switch dial to 10 and push pushbutton 6
- When 10c has been deposited, output light 1 comes on ('Thank You - Go Ahead').
- Push pushbutton 3 to 'Drive Away'. The toll collector will re-set.
- If you try to drive away without depositing enough money, the alarm will sound. To turn off the alarm, deposit 10c.
- If you deposit more than 10c, the automatic toll collector will accept the extra money and do nothing about it.

**Control assignment (verbatim)**

- Output light 1 ON represents 'Thank You - Go Ahead'
- Output light 2 ON represents 'Stop - Pay Toll 10c'
- Relay 1 and relay indicator light 1 ON represents 'Alarm'
- Pushing pushbutton 3 represents 'Drive Away'
- Pushing pushbutton 4 represents depositing one dime
- Pushing pushbutton 5 represents depositing one nickel
- Pushing pushbutton 6 represents depositing pennies (number of pennies indicated on rotary switch)

**Errata ER-32 [verified] — mandatory.** Remove `3J/4X`, `3N/6Y`, `4H/5N`, `4K/5N`, `5L/6G`; add `3J/4K`, `3Y/4Y`, `4J/4X`, `4X/6L`, `5N/6K`. All five removal targets are present in the 55-line list above, unflagged; the corrected list stays at 55.

### V-EXP11 — Experiment 11: The Telephone Dialing System (decimal to 3-bit Gray code)

Book V printed pp.13-14 · `book5-6.pdf` PDF pp.19-20 · 52 wires · tier C2 · **[verified]** wire table and Gray-code table image-read at 300 and 400 dpi (Phase 5 batch 3 author and fidelity review, 2026-10-13); no errata entry for Book V pp.13-14

| | | | |
|---|---|---|---|
| `1C/1-` | `1C/1H` | `1F/D0` | `1G/4B` |
| `2C/3C` | `2E/3E` | `2F/3F` | `2F/3G` |
| `2G/2N` | `2H/5G` | `2J/2K` | `2J/6E` |
| `2L/5J` | `2N/6G` | `3A/6E` | `3B/3-` |
| `3C/4C` | `3E/4J` | `3F/4G` | `3G/4A` |
| `3H/3+` | `3K/4E` | `3L/6K` | `3N/4F` |
| `4B/5B` | `4C/5C` | `4E/5E` | `4F/5F` |
| `4H/6N` | `5A/5K` | `5B/6B` | `5C/6C` |
| `5F/5K` | `5H/6T` | `5L/6H` | `6A/6F` |
| `6C/6-` | `6F/6G` | `6H/6+` | `6L/6W` |
| `6R/6U` | `6S/D1` | `6U/D18` | `6V/D2` |
| `D1/D3` | `D2/D4` | `D3/D5` | `D4/D6` |
| `D5/D7` | `D6/D8` | `D16/M+` | `D17/M-` |

**Initial settings (as printed)**

- With power OFF, set slide switch 6 RIGHT.
- Set the rotary switch dial at 0.
- Turn power on.

**Procedure (as printed)**

- Slowly turn the rotary switch dial to the number you wish to 'dial'. (Be sure that the pointer knob is pointing directly at the number.)
- Set slide switch 6 LEFT.
- The rotary switch will return to 0 and the number 'dialed' will appear in Gray Code on output lights 4, 5, and 6.
- (Note: output light 3 should be ignored.)
- To 'dial' another number, set slide switch 6 RIGHT and re-set the system by turning power off and on again.

**Gray code table (as printed)**

| Decimal Number | Three-Bit Gray Code |
|---|---|
| 1 | 001 |
| 2 | 011 |
| 3 | 010 |
| 4 | 110 |
| 5 | 111 |
| 6 | 101 |
| 7 | 100 |
| 8 | 000 |

_[likely] OCR renders 2 as 'O ll' and 4/5 with a leading space; normalised on the stated Gray-code rule (one bit changes per step). The row label for 1 is missing in the OCR but the table is headed 'we will use the Gray Code equivalent of zero for 8 so that we can represent the numbers 1 through 8'. Image read confirms all eight rows, including the row label 1; the codes are as listed._

### V-EXP12 — Experiment 12: Arabic Numeral Recognition

Book V printed pp.22-23 · `book5-6.pdf` PDF pp.28-29 · 38 wires · tier C2 · **[verified]** wires and FORM/CODE table image-read at 300 dpi (Phase 5 batch 2 review, 2026-10-13)

| | | | |
|---|---|---|---|
| `1C/2C` | `1F/M9t` | `1G/6com` | `1H/4K` |
| `1J/D0` | `2C/3C` | `2F/M5t` | `2G/D2` |
| `2H/4G` | `2J/D3` | `3C/4C` | `3F/M6t` |
| `3G/D6` | `3H/4N` | `3J/D9` | `3K/D8` |
| `3L/4J` | `3N/D7` | `4C/5C` | `4F/M8t` |
| `4H/5J` | `4L/5K` | `5C/6C` | `5F/M4t` |
| `5G/D5` | `5H/6G` | `5L/6J` | `5N/D1` |
| `6C/6-` | `6F/M7t` | `6H/6-` | `6X/M10` |
| `6X/D17` | `6Y/6+` | `6com/D4` | `M10/M11` |
| `D16/D19` | `D18/M-` |  |  |

**Procedure (as printed)**

- Turn power on. Select a number from 0 to 10.
- 'Draw' this number on the TOP terminals of the matrix with the free wires from M10 and M11, using the arabic numeral code.
- Push pushbutton 6. The pointer knob of the rotary switch will turn to the number 'drawn' on the matrix.
- To try another number, be sure that all eight wires to M10 and M11 are free.

**Extra setup (verbatim)**

Now connect four short programming wires to M10, leaving one end of each free. Also, connect four short programming wires to M11, leaving one end of each free.

**Errata ER-33 [verified]:** when programming a geometric form or a numeral for recognition, be sure the connections from `M10` are made to the **TOP** terminals in the matrix. This is exactly the kind of thing a simulator gets wrong, and it tells us matrix nodes have a top and a non-top terminal.

**The FORM/CODE character table on printed p.22 is [verified]**, image-read on a 300 dpi render of PDF p.28 (2026-10-13): `1`=`269`, `2`=`2356789`, `3`=`126789`, `4`=`24689`, `5`=`2345679`, `6`=`24569`, `7`=`12379`, `8`=`23679`, `9`=`23459`, and a tenth form, a diamond, =`2468`. All 38 wires (4 columns, column-major) match the list above entry for entry. The diamond is 0 only by elimination from p.21; no form is printed for 10.

This program uses **eight loose-ended wires** — four on `M10`, four on `M11` — whose free ends the operator places on matrix terminals to 'draw' the numeral. Whether they are *touched* or *inserted* is [unverified]: only `VI-MAZE` prints the touch-without-insertion allowance. See §0, *Free-ended wires*.

### V-EXP13 — Experiment 13: Multiple Point Control

Book V printed p.24 · `book5-6.pdf` PDF p.30 · 28 wires · tier B · **[verified]** image-read 300/400 dpi of PDF p.30 (2026-10-14), all 28 wires confirmed

| | | | |
|---|---|---|---|
| `1V/1Y` | `1W/2V` | `1Z/2Y` | `2W/3V` |
| `2Z/3Y` | `3W/4V` | `3Z/4Y` | `4A/6K` |
| `4B/4-` | `4W/5V` | `4Z/5Y` | `5A/5E` |
| `5B/5-` | `5C/6C` | `5E/6G` | `5F/6F` |
| `5F/5H` | `5G/5+` | `5J/6H` | `5W/6V` |
| `5Z/6Y` | `6A/6E` | `6B/6-` | `6C/6-` |
| `6E/6J` | `6H/6W` | `6L/6Z` | `6Z/6+` |

**Initial settings (as printed)**

- Set all slide switches to the RIGHT. Turn power on.

**Procedure (as printed)**

- Light 4 may be turned on or off by pushing any pushbutton or by moving any slide switch to the LEFT and then back to the RIGHT.
- (Note: lights 5 and 6 are wired into the control circuit.)

**Expected behaviour (as printed)**

- A single light controlled from twelve different 'locations' (six pushbuttons + six slide switches). An expansion of the Light on the Stairs circuit.

### V-EXP14 — Experiment 14: Sequence Control with Manual Operation

Book V printed pp.24-25 · `book5-6.pdf` PDF pp.30-31 · 60 wires · tier B · **[verified]** wire table image-read at 400 dpi (batch review, 2026-10-14): five columns of 12, all 60 match as printed; ER-34 image-read

| | | | |
|---|---|---|---|
| `1A/1G` | `1B/1-` | `1C/2C` | `1F/1G` |
| `1F/2K` | `1H/2G` | `1com/2L` | `1R/6com` |
| `1S/1X` | `1T/2T` | `1Y/2Y` | `2C/3C` |
| `2F/2G` | `2F/3K` | `2H/3G` | `2N/3N` |
| `2com/3L` | `2R/5com` | `2S/2X` | `2T/3T` |
| `2Y/3Y` | `3C/4C` | `3F/3G` | `3F/4K` |
| `3H/4G` | `3N/4N` | `3com/4L` | `3R/4com` |
| `3S/3X` | `3T/4T` | `3Y/4Y` | `4C/5C` |
| `4F/5G` | `4F/5K` | `4H/5G` | `4N/5N` |
| `4com/5L` | `4R/3com` | `4S/4X` | `4T/5T` |
| `4Y/5Y` | `5C/6C` | `5F/5G` | `5F/6K` |
| `5H/6G` | `5N/6N` | `5com/6L` | `5R/2com` |
| `5S/5X` | `5T/6T` | `5Y/6Y` | `6A/6J` |
| `6B/6-` | `6C/6-` | `6F/6G` | `6F/6com` |
| `6H/6+` | `6R/1com` | `6S/6X` | `6Y/6+` |

**Corrected wire list (errata ER-34: `4F/5G` -> `4F/4G`)**

| | | | |
|---|---|---|---|
| `1A/1G` | `1B/1-` | `1C/2C` | `1F/1G` |
| `1F/2K` | `1H/2G` | `1com/2L` | `1R/6com` |
| `1S/1X` | `1T/2T` | `1Y/2Y` | `2C/3C` |
| `2F/2G` | `2F/3K` | `2H/3G` | `2N/3N` |
| `2com/3L` | `2R/5com` | `2S/2X` | `2T/3T` |
| `2Y/3Y` | `3C/4C` | `3F/3G` | `3F/4K` |
| `3H/4G` | `3N/4N` | `3com/4L` | `3R/4com` |
| `3S/3X` | `3T/4T` | `3Y/4Y` | `4C/5C` |
| `4F/4G` | `4F/5K` | `4H/5G` | `4N/5N` |
| `4com/5L` | `4R/3com` | `4S/4X` | `4T/5T` |
| `4Y/5Y` | `5C/6C` | `5F/5G` | `5F/6K` |
| `5H/6G` | `5N/6N` | `5com/6L` | `5R/2com` |
| `5S/5X` | `5T/6T` | `5Y/6Y` | `6A/6J` |
| `6B/6-` | `6C/6-` | `6F/6G` | `6F/6com` |
| `6H/6+` | `6R/1com` | `6S/6X` | `6Y/6+` |

**Initial settings (as printed)**

- Set all six slide switches to the RIGHT and turn power on.

**Procedure (as printed)**

- Set slide switch 1 LEFT; push pushbutton 1; set slide switch 2 LEFT; push pushbutton 2; set slide switch 3 LEFT; push pushbutton 3; and so on, through pushbutton 6.
- When you have completed all twelve steps, light 1 will come on indicating "operation complete."
- If you attempt to carry out a step in the wrong order, nothing will happen.
- To re-set the system, set all slide switches to the RIGHT and turn power off, then on again.

**Per-line flags**

| Line | Tag | Note |
|---|---|---|
| `4F/5G` (as printed) | [verified] | The printed line really is `4F/5G`. **ER-34 quotes it back verbatim in order to change it**, which corroborates the reading from a second primary. It is out of pattern against `1F/1G`, `3F/3G`, `5F/5G` because it is *wrong*, not because it is mis-transcribed. Keep it in the record; do not carry it into a fixture. |
| `4F/4G` (corrected) | [verified] | The corrected line, per ER-34, image-read at 400 dpi this pass on `errata.pdf` PDF p.3 right column: 'page 24: Experiment 14 program correction: change 4F/5G to 4F/4G'. This is what ships. |

The finder flagged `4F/5G` as out of pattern against `1F/1G`, `3F/3G`, `5F/5G` and guessed `4F/4G`. **The guess was right and is now primary:** errata **ER-34** [verified] changes `4F/5G` to `4F/4G`. This is the one errata line the OCR text layer destroyed completely, rendering it `rk a n n a A A P /A fl` — which is why two passes missed it.

### V-EXP15 — Experiment 15: Automatic Sequence Control

Book V printed p.25 · `book5-6.pdf` PDF p.31 · 47 wires · tier C2 · **[verified]** wire table image-read (Phase 5 batch 1 review, 2026-10-13)

| | | | |
|---|---|---|---|
| `1A/6G` | `1B/1-` | `1C/1G` | `1C/2K` |
| `1F/1-` | `1G/6A` | `1H/1+` | `1H/2H` |
| `2A/5G` | `2B/2-` | `2C/2G` | `2C/3K` |
| `2F/2-` | `2G/5A` | `2H/3H` | `2L/D11` |
| `3A/4G` | `3B/3-` | `3C/3G` | `3C/4K` |
| `3F/3-` | `3G/4A` | `3H/4H` | `3L/D12` |
| `4B/4-` | `4C/4G` | `4C/5K` | `4F/4-` |
| `4H/5H` | `4L/D13` | `5B/5-` | `5C/5G` |
| `5C/D15` | `5F/5-` | `5L/D14` | `5X/6E` |
| `5Y/M-` | `6B/6-` | `6C/6G` | `6C/6X` |
| `6F/6-` | `6H/6+` | `6H/6L` | `6K/D17` |
| `6Y/6+` | `D16/M+` | `D18/M-` |  |

**Procedure (as printed)**

- Turn power on. Start the system by pushing pushbutton 6.
- Lights 1 through 6 will come on in order, representing the completion of six successive steps.
- When light 6 has come on, push pushbutton 5 to stop the system.
- The sequence can be stopped at any time by pushing pushbutton 5.

Errata **ER-35** [verified]: to re-set, turn power OFF then ON again.

### V-EXP16 — Experiment 16: Automatic Message Transmission (automatic CQ transmitter)

Book V printed pp.29-30 · `book5-6.pdf` PDF pp.35-36 · 20 wires · tier C2 · **[verified]** wire table and ER-36 image-read (Phase 5 batch 1 review, 2026-10-13). ER-36 shorts the supply on pb5: open-questions.md O-C9

| | | | |
|---|---|---|---|
| `5A/D3` | `5B/5-` | `5X/6E` | `5Y/6Y` |
| `6A/D4` | `6B/6-` | `6C/6-` | `6F/6G` |
| `6F/D17` | `6G/6X` | `6H/6+` | `6H/6Y` |
| `D3/D5` | `D4/D6` | `D5/D8` | `D6/D10` |
| `D8/D9` | `D9/D11` | `D16/D17` | `D18/M-` |

**Corrected wire list (errata ER-36: `5X/6E` -> `5X/6C`)**

| | | | |
|---|---|---|---|
| `5A/D3` | `5B/5-` | `5X/6C` | `5Y/6Y` |
| `6A/D4` | `6B/6-` | `6C/6-` | `6F/6G` |
| `6F/D17` | `6G/6X` | `6H/6+` | `6H/6Y` |
| `D3/D5` | `D4/D6` | `D5/D8` | `D6/D10` |
| `D8/D9` | `D9/D11` | `D16/D17` | `D18/M-` |

**Initial settings (as printed)**

- Set the rotary switch at 0 and turn power on.

**Procedure (as printed)**

- Push pushbutton 6. This provides the input command 'start transmission.'
- As the rotary switch turns, lights 5 and 6 will flash the CQ signal.
- To stop transmission, push pushbutton 5.

**Expected behaviour (as printed)**

- Light 5 on represents a DASH. Light 6 on represents a DOT.

Errata **ER-36** [verified] also says to correct the circuit diagram to correspond. `5X/6E` sits unflagged in the printed 20-line list.

### V-EXP17 — Experiment 17: Automatic Name Transmission (JOHN in Morse)

Book V printed pp.30-31 · `book5-6.pdf` PDF p.37 · 38 wires · tier C2 · **[likely]** clean OCR; not image-read

| | | | |
|---|---|---|---|
| `3C/4C` | `3F/4G` | `3G/3K` | `3G/5com` |
| `3H/D12` | `3J/6com` | `3L/D13` | `4C/5C` |
| `4E/5K` | `4F/4G` | `4F/5N` | `4H/5H` |
| `4K/5F` | `4L/D15` | `4N/5E` | `5A/5com` |
| `5B/6B` | `5C/6C` | `5F/5G` | `5H/5+` |
| `5L/D0` | `5X/6E` | `5Y/6Y` | `5com/D11` |
| `6A/6com` | `6B/6-` | `6C/6-` | `6F/6G` |
| `6F/6X` | `6G/D17` | `6H/6+` | `6H/6Y` |
| `6com/D2` | `D3/D4` | `D4/D5` | `D5/D12` |
| `D16/D17` | `D18/M-` |  |  |

**Initial settings (as printed)**

- Set the rotary switch at 0 and turn power on.

**Procedure (as printed)**

- Push pushbutton 6. The system will immediately begin transmitting.
- To stop transmission, push pushbutton 5.

**Expected behaviour (as printed)**

- Two-path 'selective sequencing': on its first revolution the rotary switch transmits 'JO', on its second 'HN'.
- Light 5 on represents a dash. Light 6 on represents a dot.

Errata **ER-37** [verified]: light 6 flashes on very briefly for a dot; three successive dots may be nearly indistinguishable — slow the rotary switch by holding the pointer knob back during one revolution.

### V-EXP18 — Experiment 18: Automatic Transmission with Differential Spacing (SOS)

Book V printed p.31 · `book5-6.pdf` PDF p.37 · 28 wires · tier C2 · **[verified]** 28 wires image-read at 400 dpi of PDF p.37 (Phase 5 batch fidelity review round 2, 2026-10-14); all match

| | | | |
|---|---|---|---|
| `3E/3H` | `3F/3-` | `3J/6A` | `4C/5C` |
| `4C/4F` | `4E/5E` | `5C/5F` | `5E/D19` |
| `5F/6K` | `6A/D1` | `6B/6-` | `6C/6-` |
| `6E/D9` | `6F/6G` | `6G/D4` | `6H/D16` |
| `6L/D18` | `D1/D2` | `D2/D3` | `D3/D6` |
| `D6/D7` | `D7/D8` | `D8/D11` | `D11/D12` |
| `D12/D13` | `D16/D17` | `D17/M+` | `D18/M-` |

**Procedure (as printed)**

- Turn power on. The system will immediately begin transmitting "SOS".
- Light 6 and relay 3 will both indicate dots and dashes: they will remain on longer for a dash than for a dot.
- The computer will continue to transmit "SOS" until the power is turned off.

Errata **ER-37** [verified, `errata.pdf` p.4 image-read at 300 dpi]: the errata's "page 31" note covers Experiments 17 and 18 (see `V-EXP17`). "Three successive dots" fits this program's S of SOS (JOHN has no run of three dots) **[likely]**. The page prints no initial dial setting and no expected lamp sequence.

### V-EXP19 — Experiment 19: Encoder for Morse Code

Book V printed pp.32-34 · `book5-6.pdf` PDF pp.38-40 · 49 wires · tier C1 · **[verified]** all 49 wires image-read at 600 dpi of PDF p.39 (author and Step 6 reviewer, 2026-10-14); the Morse table is printed p.32 = PDF p.38, the program and the dial plate p.33 = PDF p.39, the procedure p.34 = PDF p.40

| | | | |
|---|---|---|---|
| `2C/3B` | `2C/3C` | `2F/D15` | `2G/4F` |
| `2H/2L` | `2H/3H` | `2K/5F` | `3A/3K` |
| `3B/4B` | `3C/4C` | `3E/D0` | `3F/3G` |
| `3G/D8` | `3H/3L` | `3L/4L` | `4A/4com` |
| `4B/5B` | `4C/5C` | `4F/D14` | `4G/4com` |
| `4H/4L` | `4H/5L` | `4K/5com` | `4com/D12` |
| `4com/5G` | `5A/5com` | `5B/6B` | `5C/6C` |
| `5F/D13` | `5H/5L` | `5H/6L` | `5K/6com` |
| `5com/6K` | `5com/D2` | `6A/6com` | `6C/6-` |
| `6F/D3` | `6G/6com` | `6H/6L` | `6H/6+` |
| `6com/D1` | `D1/D9` | `D2/D10` | `D3/D11` |
| `D4/D12` | `D5/D13` | `D6/D14` | `D7/D15` |
| `D16/M+` |  |  |  |

**Initial settings (as printed)**

- To use this program most easily, the rotary switch dial should be fitted with a dial plate made by tracing the illustration below on a piece of paper (printed p.33 = PDF p.39, 'MORSE CODE: ALPHABETIC DIAL PLATE'). Image-read, from the inside out: Band 1 E, T (8 sectors each); Band 2 I, A, N, M (4 each); Band 3 S, U, R, W, D, K, G, O (2 each); Band 4, one letter per sector, H V F - L - P J B X C Y Z Q - - (a dash is a blank cell). The '0' label sits in the first 22.5 degree sector clockwise from the top line.
- The Morse Code table is printed p.32 = PDF p.38; the program's lamp patterns match all 26 letters (light on = dash).

**Procedure (as printed)**

- Set the rotary switch dial to 0 and turn power on. Turn the rotary switch clockwise until the pointer knob is pointing at the letter you wish to code. Read the Morse Code representation of the letter starting with output light 3. If the letter you wish to code is in band 1 of the dial plate, read only light 3. If the letter is in band 2, read lights 3 and 4. If the letter is in band 3, read lights 3, 4, 5. If the letter is in band 4, read lights 3, 4, 5 and 6.
- A light on represents a dash.
- A light off represents a dot.
- Output lights 3 through 6 will be the display lights. (printed p.32)

**Per-line flags**

| Line | Tag | Note |
|---|---|---|
| `4H/5L` | [verified] | Image-read at 600 dpi, PDF p.39, second column, tenth line: printed `4H/5L` (the stroke is an L, not a U). `4H/5U` was an OCR error; '5U' is a slide-switch terminal, which nothing else in this program uses. |
| `4com/D12` | [verified] | OCR renders '4com/Dl 2'; the image reads 'D12' clearly. |

Errata **ER-38** [verified]: always turn the pointer knob **clockwise** when indicating a letter for coding.

### V-EXP20 — Experiment 20: Decoder for Morse Code

Book V printed pp.34-35 · `book5-6.pdf` PDF pp.40-41 · 60 wires · tier C2 · **[verified]** all 60 wires image-read at 300 dpi of PDF p.40 (Phase 5 batch 3 fidelity review, 2026-10-13); errata Book V entries cover pp.30, 31, 33 and 35 only, none for p.34

| | | | |
|---|---|---|---|
| `1A/1T` | `1B/1C` | `1B/2B` | `1C/2C` |
| `1F/2F` | `1G/3H` | `1H/5R` | `1J/5H` |
| `1K/3L` | `1L/5U` | `1N/5L` | `1R/3A` |
| `1S/2U` | `1U/2A` | `1V/2W` | `1W/4A` |
| `2B/3B` | `2C/3C` | `2F/4R` | `2G/4H` |
| `2H/5T` | `2J/6H` | `2K/4L` | `2L/5W` |
| `2N/6L` | `2V/2+` | `3B/4B` | `3C/4C` |
| `3F/3R` | `3F/4F` | `3G/D15` | `3J/D7` |
| `3K/D14` | `3N/D6` | `3S/4S` | `4C/5C` |
| `4F/5F` | `4G/D13` | `4J/D5` | `4K/D12` |
| `4N/D4` | `4S/6X` | `5C/6C` | `5F/6F` |
| `5G/D11` | `5J/D3` | `5K/D10` | `5N/D2` |
| `5S/6R` | `5V/6T` | `6C/6-` | `6G/D9` |
| `6J/D1` | `6K/D8` | `6N/D0` | `6S/6-` |
| `6X/D17` | `6Y/6+` | `D16/D19` | `D18/M-` |

**Initial settings (as printed)**

- With the dial plate from experiment 19 in place, turn power on.
- Set slide switches 1 and 2 to indicate the NUMBER OF CHARACTERS to decode.

**Procedure (as printed)**

- Starting with slide switch 3, enter the dots and dashes: a slide switch RIGHT represents a DOT; a slide switch LEFT represents a DASH.
- Push pushbutton 6: this gives the computer the instruction "read out." The rotary switch will turn to the correct spot on the dial.
- Read the letter in Band 1 if output light 1 is on; Band 2 if light 2 is on; Band 3 if light 3 is on; Band 4 if light 4 is on.

**Character-count table (as printed)**

| Number of Characters | Slide Switch 1 | Slide Switch 2 |
|---|---|---|
| 1 | 0 (right) | 1 (left) |
| 2 | 1 (left) | 0 (right) |
| 3 | 1 (left) | 1 (left) |
| 4 | 0 (right) | 0 (right) |

_[likely] _

### V-EXP21 — Experiment 21: 'Search and Track' Radar

Book V printed pp.35-36 · `book5-6.pdf` PDF pp.41-42 · 37 wires · tier C2 · **[verified]** PDF p.41 image-read (the four columns hold 37 entries, all match; no wire erratum)

| | | | |
|---|---|---|---|
| `1A/2E` | `1B/1-` | `2A/3E` | `2B/2-` |
| `2C/3C` | `2E/3G` | `2F/3F` | `2F/2H` |
| `2G/2+` | `2J/3H` | `2K/3N` | `2K/2-` |
| `2L/D17` | `2N/3K` | `3A/5E` | `3H/4F` |
| `3B/3-` | `3C/4C` | `3E/3J` | `3K/3+` |
| `3L/D18` | `4C/5C` | `4F/5K` | `4G/5E` |
| `4H/5H` | `5C/6E` | `5F/5G` | `5F/6G` |
| `5H/6H` | `5L/6J` | `6A/6V` | `6B/6-` |
| `6E/6-` | `6F/6U` | `6H/6+` | `6V/D16` |
| `M+/D1` |  |  |  |

**Initial settings (as printed)**

- Set slide switch 6 RIGHT and turn power on. The system is now operating in the search mode.

**Procedure (as printed)**

- Light 3 will flash on whenever the system detects an object signal (a connection on the rotary switch dial). You may move the object signal by changing the connection on the rotary switch dial.
- When operating in the search mode, the system constantly scans its environment, signalling the operator when it senses an object in the path of its scan.
- It sweeps past the "object signal" until it has lost it and then reverses its direction, returning to the object signal. It again sweeps past, reverses and continues in this fashion until given other instructions or until the object signal is out of range.
- Set slide switch 6 LEFT. The system is now operating in the track mode. Notice that the rotary switch oscillates about the object signal.
- If you now move the object signal, the system will continue to search until it finds the new location and will then resume tracking it.

**Footnote (verbatim)**

M+/D1, 2, etc.   * Connection can be made between M+ and any point on the rotary switch dial.

Errata **ER-39** [verified]: p.35 last paragraph, third sentence should read 'Light 6 will flash on whenever . . .'

### V-XLAT-IHREM — Selection rule for translation of 'ihrem' (German/English)

Book V printed p.38 · `book5-6.pdf` PDF p.45 · 14 wires · tier A · **[likely]** clean OCR; not image-read

| | | | |
|---|---|---|---|
| `1A/3G` | `1B/1-` | `1X/3H` | `1Y/3X` |
| `1Y/4A` | `2A/3J` | `2B/2-` | `2X/3C` |
| `2Y/3Y` | `2Y/2+` | `3A/3C` | `3B/3-` |
| `3B/3F` | `4B/4-` |  |  |

**Procedure (as printed)**

- Select a singular or plural subject by pushing pushbuttons 2 and/or 3.
- Enter the adjective 'ihrem' by pushing pushbutton 1.
- The English translation of the German input will appear in the output lights.

**Control assignment (verbatim)**

- Output light 1 on represents 'their'
- Output light 2 on represents 'her'
- Output light 3 on represents 'Pete'
- Output light 4 on represents 'Eve'
- Pushbutton 1 represents 'ihrem'
- Pushbutton 2 represents 'Piet'
- Pushbutton 3 represents 'Eva'

### V-XLAT-FULL — English/German translation program (tense + adjective selection)

Book V printed pp.39-40 · `book5-6.pdf` PDF p.46 · 28 wires · tier A · **[likely]** clean OCR; not image-read

| | | | |
|---|---|---|---|
| `1A/2V` | `1B/1E` | `1B/2B` | `1C/2U` |
| `1C/4C` | `1E/2E` | `1R/2U` | `1S/2S` |
| `1T/2V` | `2A/3G` | `2B/3B` | `2C/3K` |
| `2E/3E` | `2R/3H` | `2S/3S` | `2T/3L` |
| `2W/4A` | `3A/3N` | `3B/4B` | `3C/3J` |
| `3E/4E` | `3F/6A` | `3F/3R` | `3S/3+` |
| `4B/5B` | `5A/5+` | `5B/6B` | `6B/6-` |

**Procedure (as printed)**

- Enter an English idea by moving slide switches 1, 2 and 3 appropriately. Read the German sentence from the output lights and the relay indicator lights, in the stated sequence.

**Control assignment (verbatim)**

- Slide switch 1 RIGHT = 'Pete'; LEFT = 'Eve'
- Slide switch 2 RIGHT = 'Pete or Eve'; LEFT = 'Pete and Eve'
- Slide switch 3 RIGHT = present tense; LEFT = past perfect tense
- Output light 1 on = 'Piet'; Relay light 1 on = 'Eva'
- Output light 2 on = 'haben mit'; Relay light 2 on = 'hat mit'
- Output light 3 on = 'spielt mit'; Relay light 3 on = 'spielen mit'
- Output light 4 on = 'seinem'; Relay light 4 on = 'ihrem'
- Output light 5 on = 'Ball'
- Output light 6 on = 'gespielt'

### V-JOBSELECT — Job Selection comparison program (one section shown, repeated x6)

Book V printed pp.41-42 · `book5-6.pdf` PDF p.48 · 5 wires · tier A · **[verified]** 400 dpi image read; matches line for line

Section 1 only, as printed. Repeat for sections 2-6: 30 connections in total.

| | | | |
|---|---|---|---|
| `1A/1S` | `1B/1-` | `1Y/1+` | `1R/1X` |
| `1T/1Z` |  |  |  |

**Procedure (as printed)**

- Enter the job requirements on the slide switches: LEFT if the answer was 'a', RIGHT if the answer was 'b'.
- Enter each applicant answer by pushing the corresponding button for 'a' and not pushing it for 'b'.
- Some lights may already be on after the requirements are set; count one only if it does not go
  off while that applicant's answers are entered.
- Record the total positive comparisons. The best-qualified applicant is the one with the greatest
  number of lights.

**Extra setup (verbatim)**

Repeat this program for sections 2 through 6 on MINIVAC.  (i.e. 30 connections in total)

**Notes**

- The Mate Selection application (printed pp.42-43) reuses this wiring; no separate list is printed.
  Put one person's replies on the slide switches, check the second person's replies with the
  pushbuttons, and interpret all lights on as total compatibility. Run both questionnaires A and B
  and add their results.

### V-ASSOCMEM — Associative Memory (conditioning simulation)

Book V printed p.44 · `book5-6.pdf` PDF p.50 · 40 wires · tier B · **[verified]** image-read at 400 dpi (PDF p.50) in Step 6 fidelity review round 2, 40/40 lines agree; no erratum (errata sheet Book V entries end at page 35)

| | | | |
|---|---|---|---|
| `1A/1K` | `1B/1-` | `1C/2C` | `1F/4H` |
| `1F/1X` | `1G/6F` | `1H/3K` | `1K/2H` |
| `1L/2L` | `1L/1Y` | `1Y/2Y` | `2A/2K` |
| `2B/2-` | `2C/3C` | `2F/5H` | `2F/2X` |
| `2G/4F` | `2K/3H` | `2L/3L` | `2Y/3Y` |
| `3A/3K` | `3B/3-` | `3C/4C` | `3F/6H` |
| `3F/3X` | `3G/5F` | `3L/4L` | `4C/5C` |
| `4F/4K` | `4G/5H` | `4H/6G` | `4L/5L` |
| `5C/6C` | `5F/5K` | `5G/6H` | `5L/6L` |
| `6C/6-` | `6F/6K` | `6L/6Z` | `6Y/6+` |

**Procedure (as printed)**

- MINIVAC is programmed so that if pushbuttons 1, 2 or 3 are pushed separately lights 1, 2 or 3 respectively will come on.
- Turn power on. Push pushbuttons 1, 2 and 3 individually - each turns on the single light associated with it.
- Now push two pushbuttons simultaneously (e.g. 2 and 3). From now on, pushing either of the associated pushbuttons will turn on both of the associated lights.
- Pushing all three together makes any one of them turn on all three lights.
- To instruct the computer to forget the associations, push the 'forget' button - pushbutton 6.

### V-MAZESOLVER — A Simulated Maze Solver

Book V printed pp.44-45 · `book5-6.pdf` PDF pp.50-51 · 40 wires · tier C2 · **[likely]** clean OCR; image-read at 300 dpi (PDF p.51) in Step 6 fidelity review round 2, 40/40 lines agree

| | | | |
|---|---|---|---|
| `1A/D8` | `1B/1+` | `2E/4Z` | `2F/2+` |
| `2G/6L` | `2H/2-` | `2K/4Y` | `2L/2-` |
| `3A/4J` | `3B/3+` | `3E/4E` | `3E/6N` |
| `3F/4F` | `3F/3+` | `3H/D3` | `3J/5A` |
| `3K/D2` | `3L/3-` | `4A/4N` | `4B/4+` |
| `4H/D7` | `4L/D5` | `4Y/5G` | `5B/5+` |
| `5E/6E` | `5F/6F` | `5H/5-` | `5Y/5-` |
| `6F/6+` | `6G/D19` | `6H/5Z` | `6Y/D1` |
| `6Z/D19` | `D2/D4` | `D4/D6` | `D6/D8` |
| `D16/M-` | `D17/M+` | `D18/M-` | `6E/free*` |

**Procedure (as printed)**

- Turn power on. The computer will go directly to the start position.
- Push pushbutton 6. The computer is now 'exploring' the possible paths.
- Release pushbutton 6 and indicate a 'correct' path by connecting the wire from 6E to D3, D5 or D7.
- Push pushbutton 6 again. The computer selects the 'correct' path and stops.
- Return the computer to its start position by pushing pushbutton 5. Pushing pushbutton 6 now goes directly to the correct path without exploring.
- To set the computer to the 'exploring' stage again, remove the 6E connection and push the 'forget' button - pushbutton 4.

**Footnote (verbatim)**

* This programming wire may be connected to D3, D5 or D7 to indicate the goal.

**Paths (verbatim)**

- Start = the '1' setting on the rotary switch dial.
- Path A: from 1 to 3 on the rotary switch dial
- Path B: from 1 to 5 on the rotary switch dial
- Path C: from 1 to 7 on the rotary switch dial

**Notes**

- Both D16/M- and D18/M- appear, plus D17/M+. As printed.

Uses a **loose-ended wire** at `6E` that the operator moves between `D3`, `D5` and `D7` to nominate the goal. See §0, *Free-ended wires*.

### V-FLASHINGLIGHTS — The Flashing Lights Circuit (science-fiction film prop)

Book V printed p.45 · `book5-6.pdf` PDF pp.51-52 · 24 wires · tier C2 · **[likely]** clean OCR; not image-read

| | | | |
|---|---|---|---|
| `1A/D1` | `1B/1-` | `2A/D2` | `2B/2-` |
| `3A/D3` | `3B/3-` | `4A/D4` | `4B/4-` |
| `5A/D5` | `5B/5-` | `6A/D6` | `6B/6-` |
| `D1/D12` | `D2/D11` | `D3/D10` | `D4/D9` |
| `D5/D8` | `D6/D13` | `D8/D14` | `D10/D0` |
| `D11/D15` | `D16/M+` | `D17/M+` | `D18/M-` |

**Notes**

- Both D16/M+ and D17/M+ appear. As printed.
- No operating procedure is printed beyond wiring it and turning it on.

### V-SUPERCIRCUIT — The 'Super' Circuit

Book V printed p.46 · `book5-6.pdf` PDF p.52 · 63 wires · tier C2 · **[likely]** clean OCR; not image-read

| | | | |
|---|---|---|---|
| `1A/1E` | `1B/1-` | `1C/2C` | `1E/2G` |
| `1F/1H` | `1F/2F` | `1G/1+` | `1J/2H` |
| `1K/D1` | `1L/3K` | `1N/D8` | `2A/D14` |
| `2B/2-` | `2C/3C` | `2E/5A` | `2E/2J` |
| `2H/4N` | `2K/D4` | `2L/3N` | `3A/3E` |
| `3B/3-` | `3C/4C` | `3E/4G` | `3F/3H` |
| `3F/4F` | `3G/3+` | `3H/4L` | `3J/4H` |
| `3L/6com` | `4A/4E` | `4B/4-` | `4C/3-` |
| `4E/4J` | `4H/5K` | `5B/5-` | `5C/5com` |
| `5F/5-` | `5G/6E` | `5H/4-` | `5L/5+` |
| `5com/D13` | `6A/D0` | `6B/6-` | `6C/6G` |
| `6E/6com` | `6F/6-` | `6G/6N` | `6H/6+` |
| `6H/D16` | `6J/6K` | `6J/D17` | `6L/M-` |
| `6N/D18` | `D0/D2` | `D2/D6` | `D3/D15` |
| `D3/D5` | `D5/D9` | `D6/D7` | `D7/D11` |
| `D9/D10` | `D11/D12` | `D14/D15` |  |

**Notes**

- The manual: 'this one does absolutely nothing constructive, although it appears to be diligently operating to solve the problems of the world.'

**Per-line flags**

| Line | Tag | Note |
|---|---|---|
| `4C/3-` | [unverified] | Cross-section connection to a minus power terminal of a different section; unusual but not impossible. Could be an OCR error for 4C/4- (but 4B/4- already present). Not image-verified. |
| `5H/4-` | [unverified] | Same class of oddity. Not image-verified. |
| `5com/D13` | [likely] | OCR renders '5com/Dl 3'. |
| `6A/D0` | [likely] | OCR renders '6A/DO'. |

### 4.6 Book VI — *MINIVAC Games*

Twelve records; all eleven printed games plus the shared sequence-recognition subcircuit. Coverage confirmed complete against the CONTENTS page. `book5-6.pdf`, Book VI printed p.51 = PDF p.57. Tic-Tac-Toe is in §1.

| ID | Program | Printed p. | PDF p. | Wires | Tier | Tag |
|---|---|---|---|---|---|---|
| `VI-TICTACTOE` | Tic-Tac-Toe | 55-56 | 61-62 | 72 | D | [verified] — see §1 |
| `VI-SEQREC` | Basic sequence recognition circuit | 51 / 52 / 53 | 57 / 58 / 59 | 38 | B | [verified] |
| `VI-SECRETCODE` | The Secret Code | 51-52 | 57-58 | 38 + 36 = 74 | D | [verified] image-read (all 74 lines) |
| `VI-COMBOLOCK` | The Combination Lock | 52 | 58 | 38 + 8 | D | [verified] (combination table) |
| `VI-MAZE` | The Electronic Maze | 53-54 | 59-60 | 38 + play wire | D | [verified] image-read (PDF pp.59-60) |
| `VI-MATCHGAME` | The Match Game | 54-55 | 60-61 | 45 | D | [verified] image-read 300 dpi, all 45 lines (2026-10-13) |
| `VI-TUGOFWAR` | The Philosophic Tug of War | 56-57 | 62-63 | 16 | D | [likely] |
| `VI-MINDREADING` | The Mind Reading Trick | 57 | 63 | 32 | C2 | [verified] |
| `VI-FORTUNETELLER` | The Fortune Teller | 58 | 64 | 40 | D | [verified] |
| `VI-RANDOM` | The Random Number Generator | 59 | 65 | (same as Fortune Teller) | D | [verified] |
| `VI-SPS` | Scissors, Paper or Stone | 59 | 65 | 41 | D | [verified] |
| `VI-REACTION` | Reaction Time Tester | 60 | 66 | 51 | D | [verified] image-read 300 dpi (2026-10-13) |

### VI-SEQREC — Basic sequence recognition circuit

Book VI printed pp.51, 52, 53 · `book5-6.pdf` PDF pp.57, 58, 59 · 38 wires · tier B · **[verified]** 130 dpi image read of the Combination Lock printing, `book5-6.pdf` p.58, all 38 lines

**Getting this one subcircuit right buys three games at once** — the Secret Code, the Combination Lock and the Electronic Maze all build on it. It is printed three times, otherwise identically, differing only in column break-up.

| | | | |
|---|---|---|---|
| `1A/1G` | `1B/1-` | `1C/2C` | `1F/1G` |
| `1F/2K` | `1H/2G` | `1com/2L` | `2C/3C` |
| `2F/2G` | `2F/3K` | `2H/3G` | `2N/3N` |
| `2com/3L` | `3C/4C` | `3F/3G` | `3F/4K` |
| `3H/4G` | `3N/4N` | `3com/4L` | `4C/5C` |
| `4F/4G` | `4F/5K` | `4H/5G` | `4N/5N` |
| `4com/5L` | `5C/6C` | `5F/5G` | `5F/6K` |
| `5H/6G` | `5N/6N` | `5com/6L` | `6A/6J` |
| `6B/6-` | `6C/6-` | `6E/6N` | `6F/6G` |
| `6F/6com` | `6H/6+` |  |  |

**Notes**

- All three printings are otherwise identical, 38 connections, differing only in column break-up.
- The circuit chains relays 1..6 so that the pushbuttons (or dial positions, or matrix touches) must be actuated in one specific order; light 1 = solved, light 6 = error + automatic re-set.

**Per-line flags**

| Line | Tag | Note |
|---|---|---|
| `6A/6J` | [likely] | Cross-printing conflict, resolved in favour of `6A/6J`: two printings (PDF pp.57, 59) print it, one (PDF p.58) prints `5A/6J`, but the 38-line circuit has `6B/6-` and no `5B` at all, so `5A/6J` would leave light 5 without a return and light 6 undriven against the page's own prose. The text is image-verified; the resolution is electrical inference. |

**Line 32, `6A/6J`: a real cross-printing conflict, and it is resolvable.** The Secret Code printing (PDF p.57) and the Electronic Maze printing (PDF p.59) both read `6A/6J`. The Combination Lock printing (PDF p.58) reads `5A/6J` — image-confirmed at both 500 and 130 dpi — on a page that says 'This is the same basic circuit as was used in the previous game.'

**Use `6A/6J`. [likely]** The 38-line circuit contains `6B/6-` and contains no `5B` connection at all. A light needs both its A and its B terminal wired, so `5A/6J` would leave light 5 with no return path *and* leave light 6 undriven — while the same page's prose says 'light 6 comes on when an error is made.' The Combination Lock printing carries a 6->5 typo. Local source-correction id VI-SEQREC-PRINT-01: {from `5A/6J`, to `6A/6J`}, applies to the Combination Lock printing (PDF p.58) only; not an SDC errata-sheet item (precedent: MM-PB-PRINT-01, `docs/plans/architecture.md`). [likely] The conclusion is [likely], not [verified]: the *text* is image-verified, the *resolution* is electrical inference.

The circuit chains relays 1..6 so the inputs must be actuated in one specific order; light 1 = solved, light 6 = error plus automatic re-set.

### VI-SECRETCODE — The Secret Code

Book VI printed pp.51-52 · `book5-6.pdf` PDF pp.57-58 · 36 wires · tier D · **[verified]** the 36 additions image-read (500 dpi on the last nine lines of column 4, then a full column-by-column read in the Step 6 review, 2026-10-14); the 38 basic lines (line 32 reads `6A/6J` in this printing) read the same way; all 74 match, and no erratum changes a wire (ER-40 is procedure only)

Requires `VI-SEQREC` wired first. These are the 36 **additional** connections; 74 total.

| | | | |
|---|---|---|---|
| `1R/6V` | `1R/1W` | `1S/1X` | `1T/1U` |
| `1T/2S` | `1V/2X` | `1Y/2Y` | `2R/2W` |
| `2T/2U` | `2V/3R` | `2Y/3Y` | `3R/3W` |
| `3S/3X` | `3T/3U` | `3T/4S` | `3V/4X` |
| `3Y/4Y` | `4R/4W` | `4T/4U` | `4V/5R` |
| `4Y/5Y` | `5R/5W` | `5S/5X` | `5T/5U` |
| `5T/6S` | `5V/6X` | `5Y/6Y` | `6R/6W` |
| `6T/6U` | `6Y/6+` | `2T/1com*` | `6W/2com*` |
| `4T/3com*` | `2W/4com*` | `6T/5com*` | `4W/6com*` |

**Requires**

VI-SEQREC (the 38-connection basic sequence recognition circuit) wired first

**Initial settings (as printed)**

- Program a code by setting the six slide switches in various positions.
- Example given (printed p.52 = PDF p.58): For example, with the above program and all six slide switches to the right, the code is solved by pushing the pushbuttons in sequence from 6 through 1.

**Procedure (as printed)**

- Wire the basic circuit, then add the connections above.
- Set the slide switches to choose a code.
- Player pushes the six pushbuttons in an attempted order.
- When the code has been correctly solved, light 1 comes on indicating "code Solved." If light 6 comes on, an error has been made and MINIVAC will automatically re-set for the next attempt.
- The light-6 assert reads that one-way conditional in its natural converse direction. The Combination Lock paragraph on the same page, which uses 'the same basic circuit', prints the converse directly ("light 6 comes on when an error is made, and the machine then automatically re-sets for the next attempt.").
- Example of re-coding: change 2T/1com to 2T/2com and 6W/2com to 6W/1com.

**Expected behaviour (as printed)**

- 'Using the slide switches, you can generate 63 different codes; by simple re-programming you can generate 720 different codes.' [verified quote]
- Later on the same page: 'you will be able to generate 63 different codes' after interchanging starred connections. The 63 vs 720 figures both appear; recorded as printed.

**Footnote (verbatim)**

* These connections may be interchanged for new codes. Be sure though, that there are connections to each of the six common terminals.

All six starred entries carry a single asterisk and the footnote is verbatim: '* These connections may be interchanged for new codes. Be sure though, that there are connections to each of the six common terminals.' [verified] 500 dpi read of `book5-6.pdf` p.57.

Two code-count figures are both printed on p.51-52: 'you can generate 63 different codes; by simple re-programming you can generate 720 different codes' at the top, and 'you will be able to generate 63 different codes' after interchanging the starred connections. Recorded as printed, not reconciled. [likely]

Errata **ER-40** [verified]: to re-set the game, turn power off then on.

### VI-COMBOLOCK — The Combination Lock

Book VI printed p.52 · `book5-6.pdf` PDF p.58 · `VI-SEQREC` + `D16/M+` + the combination wires · tier D · **[verified]** (130 dpi image read of the combination table, the `D16/M+` line and the footnote)

Requires `VI-SEQREC` (in the printing that reads `5A/6J` — use `6A/6J`, see above), plus `D16/M+`.

**Combination program, as printed**

| Combination step | Connection |
|---|---|
| left to 13 | `D13/6com` |
| right to 2 | `D2/5com` |
| left to 10 | `D11/4com` |
| left to 10 (second wire) | `D10/3com` |
| right to 6 | `D6/2com` |
| left to 9 | `D9/1com` |
| (optional) | `D8/6E*` |

The 'left to 10' row genuinely carries **two** connections — the dial passes 11 then stops on 10. [verified] 130 dpi read of `book5-6.pdf` p.58.

**Footnote, verbatim.** * This last connection is optional; it will cause the machine to indicate an error if 8 is passed at any point.

**Design rules, verbatim.** When you are designing a combination, you must not include any connection which will touch off a connection further along. Also, you must make connections to each of the six common terminals in order.

**Expected behaviour (as printed)**

- Light 1 ON = combination solved. Light 6 ON = error, machine re-sets and the player must start over.

**Notes**

- The 'left to 10' row of the printed table carries TWO connections (D11/4com and D10/3com) - the dial passes 11 then stops on 10. Printed as two lines against one combination step. [verified] (image-read, `book5-6.pdf` p.58)
- 'You may wish to add dummy connections to the rotary switch dial so that the pertinent connections will not be obvious.'

Errata **ER-41** [verified]: to re-set the game, turn the rotary switch through one complete revolution — **not** power-cycle, unlike the other two sequence games.

### VI-MAZE — The Electronic Maze

Book VI printed pp.53-54 · `book5-6.pdf` PDF pp.59-60 · `VI-SEQREC` + a loose-ended play wire · tier D · **[verified]** image-read (Step 6 reviewer, 2026-10-14): the 38-line basic table (columns of 10/10/9/9) and the example path on PDF p.59, the dummy lines, the short path and the relay-push sentences on PDF p.60; all 44 fixture wires match line for line; `errata.pdf` p.4 has the ER-42 note and no wire change

Requires `VI-SEQREC` (this printing reads `6A/6J`), plus a programming wire at `M+` with one end left free — the play wire. This is the **only** program in the corpus that prints the touch-without-insertion mechanism; see §0, *Free-ended wires*.

**Example path program** — path 'from 8 to 1 to 2 to 9 to 6 to 5'

| | | | |
|---|---|---|---|
| `M8t/6com` | `M1t/5com` | `M2t/4com` | `M9t/3com` |
| `M6t/2com` | `M5t/1com` |  |  |

**Dummy connections (example):** `M3t/6R` `M4t/6S` `M7t/6T`

Printed p.54: This will not affect the maze, but conceals the fact that squares 3, 4 and 7 are not part of the path.

**Composition (resolved by hand, 2026-10-14):** the 38 `VI-SEQREC` lines, plus the 6 p.53 example-path lines, plus the `M+` free-end play cord (44 printed wires and the cord). The p.54 dummy lines are optional; the short-path program is a separate variant, not an addition.

**Short-path variant** — path 'from 8 to 9 to 4'

| | | | |
|---|---|---|---|
| `M8t/3com` | `M9t/2com` | `M4t/1com` |  |

Extra setup for the short-path variant (printed p.54): If you wish to program a path which has less than six steps, connect this path to the lower common terminals and manually push the remaining relays to the left before beginning play. Before beginning the play, manually push relays 4, 5 and 6 to the left. Whenever an error is made, relays 4, 5 and 6 must be pushed to the left before play is resumed. (another program requiring **manual relay actuation**.) The order of the relay pushes is unstated (O-C21).

**Procedure (as printed)**

- The player takes the free end of the 'play wire' (connected to M+) and touches it to the TOP terminals of the game matrix squares.
- '(The wire need not be plugged into the terminal; touching the terminal will make the contact.)'
- You may tell the player his START and GOAL points; if you wish to make the game more difficult you need not give him this information.

**Expected behaviour (as printed)**

- Light 1 indicates success; light 6 indicates error and re-set.

Errata **ER-42** [verified]: to re-set the game, turn power off then on. (The sheet misspells it 'Elecronic'.) It reads: "Note — to re-set the game, turn power off, then on again." (`errata.pdf` p.4, 'The Elecronic Maze (page 53)'.) Whether an error re-sets the chain without a power cycle, as the p.54 resume sentence implies, is O-C21.

### VI-MATCHGAME — The Match Game

Book VI printed pp.54-55 · `book5-6.pdf` PDF pp.60-61 · 45 wires · tier D · **[verified]** all 45 lines image-read at 300 dpi, PDF p.61, line for line (b02 round-2 review, 2026-10-13; see flags)

| | | | |
|---|---|---|---|
| `3A/3E` | `3B/3-` | `3E/3G` | `3F/3-` |
| `3G/D0` | `3H/3Z` | `3Y/4Y` | `4C/5C` |
| `4E/D14` | `4F/4X` | `4F/4G` | `4H/4L` |
| `4H/5H` | `4K/5K` | `4L/5L` | `4Y/5Y` |
| `5C/6C` | `5E/D13` | `5F/5X` | `5F/5G` |
| `5H/6H` | `5K/6K` | `5L/6L` | `5Y/6Y` |
| `6C/6-` | `6E/D15` | `6F/6X` | `6F/6G` |
| `6H/6+` | `6K/D18` | `6Y/6+` | `D1/D4` |
| `D2/D5` | `D3/D6` | `D4/D7` | `D5/D8` |
| `D6/D9` | `D7/D10` | `D8/D11` | `D9/D12` |
| `D10/D13` | `D11/D14` | `D12/D15` | `D16/M+` |
| `D17/M-` |  |  |  |

**Expected behaviour (as printed)**

- 'The game is started with the rotary switch dial at 15 ... MINIVAC 601 will always win.' [verified quote, printed p54]

**Control assignment (verbatim)**

- Pushbutton 3 is the re-set button.
- Pushbutton 4 is used for 'player removes 1 match.'
- Pushbutton 5 is used for 'player removes 2 matches.'
- Pushbutton 6 is used for 'machine moves.'
- Light 3 is the 'win' indicator. The last player to move before light 3 comes on wins the game.

**Per-line flags**

| Line | Tag | Note |
|---|---|---|
| `6Y/6+` | [verified] | OCR text layer renders this as '6Y/&+'. Read from the 500 dpi image of PDF p61: it is 6Y/6+. |
| `D16/M+` | [verified] | image-confirmed, PDF p61 @500dpi |
| `D17/M-` | [verified] | image-confirmed, PDF p61 @500dpi |

**The printed procedure's first two sentences are superseded.** The finder's step 1 ('Push the re-set button (pushbutton 3). The rotary switch dial will turn to 15') is the uncorrected text. Errata **ER-43** [verified, image-read at 300 dpi by gap-verify UP-04] replaces it with: **'Turn the rotary switch to 15, indicating that there are 15 matches in the pile.'** The dial is set **by hand**, not by pushbutton.

Remaining printed procedure: player moves first — pushbutton 4 removes 1 match, pushbutton 5 removes 2; the dial then shows the matches remaining. MINIVAC moves next: the player pushes pushbutton 6 and the dial turns to the number remaining after the machine's move. Play alternates. Light 3 comes on after the last move, and the last player to move before light 3 comes on wins.

'The game is started with the rotary switch dial at 15 ... MINIVAC 601 will always win.' [verified] Book VI p.54.

### VI-TUGOFWAR — The Philosophic Tug of War

Book VI printed pp.56-57 · `book5-6.pdf` PDF pp.62-63 · 16 wires · tier D · **[likely]** image-read of `book5-6.pdf` PDF p.63 (column 1 at 1700 px wide, columns 2-4 in a 300 dpi crop); matches line for line (Step 6 reviewer, 2026-10-14); the tag stays [likely] unless Tom raises it

| | | | |
|---|---|---|---|
| `1X/6X` | `1Y/1+` | `1Z/6Z` | `4Y/D18` |
| `4Z/D9` | `6E/6Y` | `6F/6-` | `6F/6L` |
| `6G/6N` | `6H/6+` | `6J/6K` | `6J/D17` |
| `6N/D18` | `D7/D8` | `D8/D9` | `D16/D19` |

**Initial settings (as printed)**

- Player 1 uses pushbutton 1; player 2 uses pushbutton 6.
- Pushbutton 4 is the re-set button.

**Procedure (as printed)**

- Push pushbutton 4 (re-set). Release pushbutton 4 as the rotary switch knob starts to turn.
- As soon as the knob starts to turn, each player tries to control its direction using his pushbutton.
- The game ends when the pointer knob stops - either at 9 (player 1 wins) or at 7 (player 2 wins).
- To start another game, push the re-set button (pushbutton 4).

**Expected behaviour (as printed)**

- The rotary switch knob turns counterclockwise (towards 9) if pushbuttons 1 and 6 are in the same position (both up or both down).
- It turns clockwise (towards 7) if pushbuttons 1 and 6 are in different positions.
- Dial stops at 9 -> player 1 wins. Dial stops at 7 -> player 2 wins.

**Direction words — they agree with the panel.** The dial reads 0 at 12 o'clock and increases **clockwise**
[verified] (`raw/photos/commons-minivac601-main.jpg`, Book I printed p.20, `panel.md`). This program's
`D16/D19`, `4Y/D18`, `4Z/D9`, `D7/D8` and `D8/D9` short STOP whenever the wiper is on 7, 8 or 9 with pushbutton 4
up. Play therefore runs over 10–15 and 0–6, so 9 is reached from 10 (counterclockwise) and 7 from 6
(clockwise), exactly as printed. An earlier reading took "towards 9" as travel from 7 through 8 and
recorded a conflict, with the rule "never cite Book VI for direction". That reading and rule are withdrawn
(`open-questions.md` C13, resolved 2026-10-13). The Book VI sentence sits on the same printed page
image-read at 300 dpi.

### VI-MINDREADING — The Mind Reading Trick

Book VI printed p.57 · `book5-6.pdf` PDF p.63 · 32 wires · tier C2 · **[verified]** 300 dpi image read of `book5-6.pdf` PDF p.63; matches line for line (and the Book III printing, with `6A/6C` here and `6C/6A` there)

| | | | |
|---|---|---|---|
| `5V/4S` | `4R/4A` | `4B/4-` | `5C/5A` |
| `5B/5-` | `6A/6C` | `6B/6-` | `6X/6V` |
| `6V/5V` | `6U/6C` | `5U/5C` | `5F/6F` |
| `6F/6-` | `M-/D18` | `D18/4V` | `4U/6S` |
| `4W/5S` | `5R/6H` | `5T/6L` | `6R/5H` |
| `6T/5L` | `M+/6Y` | `6X/D17` | `D16/D19` |
| `D0/6N` | `D1/6K` | `D2/6J` | `D3/6G` |
| `D4/5N` | `D5/5J` | `D6/5K` | `D7/5G` |

**Initial settings (as printed)**

- Slide switches 4, 5 and 6 carry the three answers. LEFT = YES, RIGHT = NO.

**Procedure (as printed)**

- Ask a friend to think of a number between 0 and 7.
- A. Is the number greater than 3?  -> slide switch 4 LEFT for YES, RIGHT for NO
- B. When the number is divided by 4, is the remainder greater than 1? -> slide switch 5 LEFT for YES, RIGHT for NO
- C. Is the number odd? -> slide switch 6 LEFT for YES, RIGHT for NO
- If the answer to question A is YES, move slide switch 4 to the LEFT.
- If the answer to question A is NO, move slide switch 4 to the RIGHT.
- If the answer to question B is YES, move slide switch 5 to the LEFT.
- If the answer to question B is NO, move slide switch 5 to the RIGHT.
- If the answer to question C is YES, move slide switch 6 to the LEFT.
- If the answer to question C is NO, move slide switch 6 to the RIGHT.
- After the replies to the questions have been indicated, push pushbutton 6. The pointer knob of the rotary switch will turn to the number your friend had in mind.

**Variation (verbatim)**

(BK6 printed p.58 = PDF p.64, image-read.) The same program can be used substituting names for numbers as follows: 0 = Karen 1 = David 2 = Catherine 3 = Robert 4 = Peggy 5 = Andy 6 = Dorothy 7 = Hartley Questions: A. Does the name end in 'Y'? B. Does the name have more than 5 letters? C. Is the name a boy's name?

Identical to `III-MINDREADING`'s 32 connections; the two printings differ only in writing `6A/6C` here and `6C/6A` there — the same connection. The Book VI printing genuinely prints `5V/4S`, which is the errata-corrected form of Book III's `5V/45`.

Errata **ER-45** [verified, image-read at 300 dpi by gap-verify UP-04]: **zero is considered even** for this problem.

### VI-FORTUNETELLER — The Fortune Teller

Book VI printed p.58 · `book5-6.pdf` PDF p.64 · 40 wires · tier D · **[verified]** 400 dpi image read; matches line for line

| | | | |
|---|---|---|---|
| `1A/3G` | `1B/1-` | `1C/3E` | `1E/2E` |
| `2A/3K` | `2B/2-` | `2C/4E` | `2E/3C` |
| `2F/2X` | `2G/6L` | `2H/2L` | `2K/5L` |
| `2L/2Y` | `2Y/2+` | `3A/3J` | `3B/3-` |
| `3C/4C` | `3F/5G` | `3H/4K` | `3L/4N` |
| `3N/4A` | `4B/4-` | `4C/5C` | `4F/6G` |
| `4L/4X` | `4Y/4+` | `5A/5E` | `5B/5-` |
| `5C/6C` | `5E/6K` | `5F/6N` | `5F/5G` |
| `5H/5+` | `5K/6F` | `5N/6E` | `6A/6E` |
| `6B/6-` | `6C/6-` | `6F/6G` | `6H/6+` |

**Procedure (as printed)**

- Ask MINIVAC a yes-or-no question. Push the "contemplate" button (pushbutton 2). Hold the "contemplate" button down while MINIVAC considers the question. When you feel that MINIVAC has had sufficient time to consider the question, release the "contemplate" button and push the "answer" button (pushbutton 4). MINIVAC's answer will appear in the lights as indicated above.
- Image-read, `book5-6.pdf` PDF p.64 (300 dpi crop of the table; the 40 wires in three columns of 14/14/12 all match). The page prints no specific answer and no description of lights 5 and 6 behaviour; any oscillation of the contemplate hold is `[likely]`, from the topology (`5K/6F`, `5N/6E`, `5E/6K`, `5F/6N`) and p.59 "Push pushbutton 2 to allow MINIVAC to generate a random number.", not stated.

**Expected behaviour (as printed)**

- light 1 - Absolutely No
- light 2 - Doubtful
- light 3 - Perhaps
- light 4 - Definitely Yes
- Lights 5 and 6 are MINIVAC's 'contemplation' lights.
- The manual suggests labeling the four answer lights with pieces of paper.

### VI-RANDOM — The Random Number Generator

Book VI printed p.59 · `book5-6.pdf` PDF p.65 · tier D · **[verified]** 400 dpi image read

SAME WIRING AS VI-FORTUNETELLER - no separate program is printed.

**Procedure (as printed)**

- Push pushbutton 2 to allow MINIVAC to generate a random number. Release pushbutton 2 and push pushbutton 4 to allow MINIVAC to display the number it has generated. (`book5-6.pdf` PDF p.65, image-read; the page's line-break hyphen in MINI-VAC dropped.)

**Expected behaviour (as printed)**

- Light 1 indicates '1', light 2 indicates '2', light 3 indicates '3', light 4 indicates '4'. Equivalent to throwing a four-sided die.

### VI-SPS — Scissors, Paper or Stone

Book VI printed p.59 · `book5-6.pdf` PDF p.65 · 41 wires · tier D · **[verified]** image-read at 400 dpi 2026-10-14 (Phase 5 batch 10-13 author and fidelity reviewer): 41 wires, line for line equal to the table below; the image reads `3C/4C`

| | | | |
|---|---|---|---|
| `1A/1G` | `1B/1-` | `1C/2C` | `1F/2F` |
| `1G/3G` | `1H/4H` | `1H/5L` | `1K/3K` |
| `1L/1X` | `1L/3H` | `1Y/2Y` | `2C/4X` |
| `2F/3F` | `2G/4G` | `2H/5H` | `2X/3L` |
| `2Y/3Y` | `3A/5K` | `3A/4A` | `3B/4B` |
| `3C/4C` | `3F/4F` | `3G/5G` | `3H/6H` |
| `3K/5K` | `3L/5H` | `3X/5L` | `3Y/4Y` |
| `4B/4-` | `4C/5X` | `4F/5F` | `4G/6G` |
| `4Y/5Y` | `5C/6C` | `5F/6F` | `5Y/6Y` |
| `6A/6G` | `6B/6-` | `6C/6X` | `6F/6-` |
| `6Y/6+` |  |  |  |

**Procedure (as printed)**

- Each player decides upon a move (scissors, paper or stone) and indicates it by pushing his appropriate pushbutton.
- Player 1 should move just before player 2 moves since the relays will move after player 2 indicates his move. MINIVAC will indicate a win or a tie on the lights.
- You may find it convenient to fix a tall piece of cardboard between pushbuttons 3 and 4 to keep players from observing their opponent's move in advance.

**Expected behaviour (as printed)**

- Scissors cut paper (scissors will win over paper)
- Paper covers stone (paper will win over stone)
- Stone breaks scissors (stone will win over scissors)
- Player 1 wins: light 1 comes on
- Player 2 wins: light 6 comes on
- Tie: lights 3 and 4 come on

**Control assignment (verbatim)**

- Player 1: Scissors = pushbutton 1, Paper = pushbutton 2, Stone = pushbutton 3
- Player 2: Scissors = pushbutton 4, Paper = pushbutton 5, Stone = pushbutton 6

### VI-REACTION — Reaction Time Tester

Book VI printed p.60 · `book5-6.pdf` PDF p.66 · 51 wires · tier D · **[verified]** image-read at 300 dpi 2026-10-13 (b02 author and fidelity reviewer)

| | | | |
|---|---|---|---|
| `1A/3F` | `1B/1-` | `1E/2E` | `1E/1-` |
| `1F/2A` | `1F/1G` | `1G/5J` | `1H/2H` |
| `1H/3Z` | `1K/2K` | `1L/2L` | `1X/5H` |
| `1Y/4J` | `2B/2-` | `2E/3E` | `2F/2G` |
| `2F/5A` | `2G/5N` | `2H/3H` | `2K/3K` |
| `2L/3L` | `3A/6K` | `3A/4A` | `3B/4B` |
| `3E/4E` | `3F/3G` | `3G/5G` | `3H/4H` |
| `3J/6Y` | `3K/4K` | `3L/4L` | `3Y/3+` |
| `3Z/6H` | `4B/4-` | `4F/6A` | `4F/4G` |
| `4G/5K` | `4K/D19` | `4L/4-` | `5B/5-` |
| `5E/6G` | `5F/5-` | `5L/6X` | `6B/6-` |
| `6E/6G` | `6E/D2` | `6F/6-` | `6L/6+` |
| `6L/D17` | `D16/D17` | `D18/M-` |  |

**Procedure (as printed)**

- Each player should be ready at his pushbutton.
- Push the re-set button (pushbutton 3).
- As soon as lights 3 and 4 come on, each player tries to be the first to push his pushbutton. MINIVAC will indicate the winner on the lights.
- If either player pushes his pushbutton *before* lights 3 and 4 come on, MINIVAC will indicate who has fouled and the game must be begun again.
- To start another game push the re-set button and proceed as above.

**Control assignment (verbatim)**

- Player 1 uses pushbutton 1
- Player 2 uses pushbutton 6
- Pushbutton 3 is the re-set button
- Light 1 indicates that player 1 wins.
- Light 2 indicates that player 1 has fouled.
- Light 5 indicates that player 2 has fouled.
- Light 6 indicates that player 2 wins.
- Lights 3 and 4 give the signal 'START'.

Errata **ER-46** [verified, image-read at 300 dpi by gap-verify UP-04]: to stop players anticipating the start signal, either make dummy connections to the rotary switch or cover the dial with an inverted box.

### 4.7 Maintenance Manual check circuits — three programs outside the 98

`docs/research/raw/pdf/maintenance-manual.pdf` — *MINIVAC 601 Maintenance Manual*, Scientific Development
Corporation, 13pp. **PDF page = printed page + 2**, [verified] by reading the printed folio at the foot of each
rendered page; this offset is the trap that made two earlier files cite the wrong figures.

These three are **not** part of the 98. They are not manual experiments, they are in none of Books I-VI and none
of the errata sheet, and C-21's count is unaffected. They are carried here because each is a complete printed
netlist accompanied by SDC's own printed expected lamp states, with **no relay chain, no motor and no rotary** —
the cheapest correct fixtures in the whole package, and the artefacts that settle relay and slide-switch contact
polarity in §0. Every wire and every quoted expectation below was image-read at 300-400 dpi this pass and
independently at 300-1000 dpi by the gap round.

| ID | Figure | Printed p. | PDF p. | Wires | Tier | Tag |
|---|---|---|---|---|---|---|
| `MM-PB-CHECK` | Circuit Diagram — Pushbutton Check | 6 (expected states run over to 7) | 8 (states on 9) | 5 | A | [verified] |
| `MM-RLY-CHECK` | Circuit Diagram — Relay Check | 7 | 9 | 13 | A | [verified] |
| `MM-SW-CHECK` | Circuit Diagram — Slide Switch Check | 8 | 10 | 10 | A | [verified] |

The figures are drawn **generically** — the pushbutton, relay and slide switch under test carry no section
number, so each figure is a template for any section. The four binary output lights are drawn as sections 1-4.

### MM-PB-CHECK — Pushbutton Check

Maintenance Manual printed pp.6-7 · `maintenance-manual.pdf` PDF pp.8-9 · 5 wires · tier A · **[verified]** 400 dpi render of PDF p.8

Intro, verbatim: 'Check a pushbutton by connecting it in series with two lights as indicated:'

| | | | |
|---|---|---|---|
| `+/Y` | `Z/1A` | `1B/1-` | `X/2A` |
| `2B/2-` |  |  |  |

**Printing error, recorded not fixed.** The left-hand terminal of light 2 is printed **`2B`**, so both terminals
of light 2 read `2B` in the figure. That is what is on the page [verified] — not an OCR artefact and not a
rendering artefact. The intended reading is `2A` [likely]: the left lamp is correctly labelled `1A` … `1B`, and
the Relay Check figure on the next printed page labels all four lamps `nA` … `nB`. Build the fixture with `2A`
and carry this note with it. (The two minus terminals in this one figure print as a bare `—`; under ERG-02 that
is the same node as `1-` and `2-`.)

**Initial settings**

- Pushbutton released. Power ON.

**Expected behaviour, verbatim** (printed p.7, first two lines — the section runs over the page break)

- 'Turn power on. Light 1 should come on. Push the pushbutton. Light 1 should go off and light 2 should come on.'

| Step | Do | Then | Tag |
|---|---|---|---|
| 1 | Power ON, pushbutton released | light 1 ON, light 2 OFF | [verified] |
| 2 | Press the pushbutton | light 1 OFF, light 2 ON | [verified] |
| 3 | Release the pushbutton | light 1 ON, light 2 OFF | **[unverified]** — implied by the momentary pushbutton, not printed |

The at-rest arm is drawn touching `Z`, which is what makes light 1 the power-on lamp: an independent primary
confirmation of `Y` = arm, `Z` = normally closed, `X` = normally open.

### MM-RLY-CHECK — Relay Check

Maintenance Manual printed p.7 · `maintenance-manual.pdf` PDF p.9 · 13 wires · tier A · **[verified]** 400 dpi render of PDF p.9

Intro, verbatim: 'Check a relay by connecting the coil with power through a pushbutton as indicated:'

| | | | |
|---|---|---|---|
| `+/H` | `+/L` | `+/Y` | `X/E` |
| `F/-` | `J/1A` | `1B/1-` | `G/2A` |
| `2B/2-` | `N/3A` | `3B/3-` | `K/4A` |
| `4B/4-` |  |  |  |

`C` and `Z` are drawn with terminal dots and **deliberately left unconnected**. [verified]

**Initial settings**

- Pushbutton released (relay OFF). Power ON.

**Expected behaviour, verbatim**

- 'Turn power on. Lights 1 and 3 should come on. Push the pushbutton. Lights 1 and 3 should go off and lights 2 and 4 should come on.'

| Step | Do | Then | Tag |
|---|---|---|---|
| 1 | Power ON, pushbutton released, relay OFF | lights 1 and 3 ON; lights 2 and 4 OFF; **relay indicator lamp OFF** | [verified] |
| 2 | Press the pushbutton (relay ON) | lights 1 and 3 OFF; lights 2 and 4 ON; relay indicator lamp still OFF | [verified] |
| 3 | Release the pushbutton | lights 1 and 3 ON; lights 2 and 4 OFF | **[unverified]** — implied, not printed |

**The coil is driven at `E`, not at `C`.** The relay's own indicator lamp sits in the `C`-to-`E` path under the
panel, so wiring `X/E` puts the lamp **out of circuit**: the coil sees the full rail, and the relay indicator
lamp **stays dark throughout the test**. An implementation that lights the indicator lamp whenever a coil is
energised fails this fixture. [verified] — and it is the same fact ER-21 leans on when it by-passes the
indicator lights 'so that full voltage is supplied to the relay coils'.

**What this circuit settles, and what it does not.** It settles contact polarity for both sets: with the relay
at rest the lit lamps are those fed from `J` and `N`, and with the coil energised those fed from `G` and `K`, so
`J`/`N` are normally closed and `G`/`K` normally open, with `H`/`L` the arms (§0). It also shows both sets
transferring in the same sense — lights 1 and 3 track each other, 2 and 4 track each other. It does **not**
prove that the two contact sets are electrically isolated: `H` and `L` are both tied to `+` here, so an internal
H-L short would leave every printed result unchanged. Anyone citing this figure as the isolation proof is
over-reading it. The isolation proof is `II-EXP5`.

### MM-SW-CHECK — Slide Switch Check

Maintenance Manual printed p.8 · `maintenance-manual.pdf` PDF p.10 · 10 wires · tier A · **[verified]** 300 dpi render of PDF p.10

Intro, verbatim: 'Check a slide switch by connecting binary output lights to the terminals as indicated:'

| | | | |
|---|---|---|---|
| `+/S` | `+/V` | `T/1A` | `1B/1-` |
| `R/2A` | `2B/2-` | `W/3A` | `3B/3-` |
| `U/4A` | `4B/4-` |  |  |

**Initial settings, as printed**

- Set the slide switch RIGHT. Power ON.

**Expected behaviour, verbatim**

- 'Set the slide switch RIGHT. Turn power on. Lights 1 and 3 should come on. Move the slide switch to the LEFT. Lights 1 and 3 should go off and lights 2 and 4 should come on.'

| Step | Do | Then | Tag |
|---|---|---|---|
| 1 | Slide RIGHT, power ON | lights 1 and 3 ON; lights 2 and 4 OFF | [verified] |
| 2 | Move the slide LEFT | lights 1 and 3 OFF; lights 2 and 4 ON | [verified] |

Settles the slide-switch terminal roles from figure plus expected states together: `S` and `V` are the two arms;
`T` and `W` are made when the slide is RIGHT; `R` and `U` are made when it is LEFT (§0). The figure draws the
arms touching `T` and `W`, matching its own first printed line.

## 5. Not settled by the sources

Each item names its fallback. Nothing here is written around.

| # | Not settled | Fallback |
|---|---|---|
| N-1 | **The direction convention** behind Tic-Tac-Toe's "move 4 / move 5 squares to the right", and how the rule anchors when the machine's last move was the **centre**, which is not on the ring. The ring *order* is no longer open: the panel numbers the matrix 1 2 3 / 8 9 4 / 7 6 5, centre 9, outer squares clockwise from top-left [verified] (§1). Book VI states the rule and never restates the numbering; the errata sheet adds only ER-44's tie note. | **`FALLBACK-TTT-RING-CW`** (§1): "N squares to the right" = advance N positions modulo 8 through the printed numbering, because the panel's own numbering runs clockwise and is the only cyclic order the machine expresses. Every step generated under it is [unverified]. Do not ship a Tic-Tac-Toe fixture that asserts a specific machine move as though it were printed. |
| N-2 | **Relay pull-in and drop-out times**, and **relay** contact transfer order. No manual gives a millisecond figure. Pushbutton and rotary transfer order *is* settled (both break-before-make, Book I pp.9 and 21) — do not bundle them together. | The discrete-time timing model file owns this. Direct evidence that it matters: the errata says "some programs are not designed for high-speed operation", "push pushbutton 6 slowly", and supplies a whole alternate counter because Book IV's "strains the relays". The Maintenance Manual has now been read end to end and carries **no** millisecond figure and no transfer-order statement — only 'the switch arm should engage the normally open and normally closed contacts and should push them slightly as they meet' (printed p.8 = PDF p.10, the run-over of the Relays section). Settling this needs a measurement on a surviving unit. |
| N-3 | **Which of `K` and `N` is the normally-open contact** of the relay's second set. *Settled: `nL` = arm, `nK` = normally open, `nN` = normally closed.* [verified] `maintenance-manual.pdf` PDF p.9 (printed p.7) — the Relay Check figure plus its printed expected lamp states (§0, §4.7 `MM-RLY-CHECK`), image-read at 400 dpi this pass and at 700-1000 dpi by the gap round. *Retained here with its original number only because earlier files leave it open, and because §6 item 3 refers to it.* Relay contact **transfer order** is a separate question and stays open at N-2. | — |
| N-4 | **Rotary-switch dial speed in rpm.** Nowhere in the manuals or the errata. Book V asks the reader to count revolutions per minute on their own machine. Every timing program depends on it. | The rotary contact geometry / motor law file owns this. Tier C2 fixtures stay deferred until it exists. |
| N-5 | **Book I ANSWERS 1-12 and 16-20.** Hand-lettered, interleaved with drawings, OCR materially degraded. ANSWERS 13, 14 and 15 are image-verified (15 is five lines in full); the rest are not. | Do not use them as fixtures. Six 300 dpi crops of `book1.pdf` PDF pp.31-34 would close it. |
| N-6 | **The Television Problem's internal contradiction** (Book III p.65: conventions say slide switch LEFT = watching; the operating instruction says all-LEFT = nobody watching). | Take the conventions block as authoritative and treat the operating instruction's parenthetical as the error, because the wire list is built from the conventions. Any fixture step here is tagged `[unverified]`. Derived cross-check (not verification): the simulated printed wiring lights light 4 only at the setting that solves p.63 under LEFT = watching, which supports the fallback. |
| N-7 | **The Arabic Numeral Recognition FORM/CODE table** (Book V printed p.22). OCR destroyed. | Unusable as a fixture. Needs an image read. |
| N-8 | **Whether Book II Experiment 2's and Experiment 7's counts were ever in doubt** — closed at 23 and 16 by 300 dpi image reads. *Listed here only because two earlier files leave it open; it is settled.* | — |
| N-9 | **Watertown vs Cambridge.** Three paper primaries (Book II-III-IV copyright page, Book V-VI copyright page, errata header and footer) all say "372 Main Street, Watertown, Massachusetts"; the panel legend reportedly says Cambridge. Both primary. The errata does **not** resolve it — it only weights the paper side. | Out of scope for this file; the context/panel files own it. |
| N-10 | **Whether the power-up state of a bistable circuit is deterministic on real hardware.** Book IV p.70 asserts it for that circuit ("Turn power ON. Notice that both relays 5 and 6 are OFF"); Book II's flip-flop prints no such step. | `FALLBACK-PWRUP-COLD`, below. |
| N-11 | **Scope of `book7-capacitor-resistor.pdf`** — a joint **601/6010** document carrying relay hysteresis, bias-resistor circuits and rotary-switch program fragments. Not read by the programs pass and never declared in or out. (The Maintenance Manual half of this item is struck: it is a **601-only** document, it has been read end to end, its offset is fixed at PDF = printed + 2, and three of its figures are program records in §4.7.) | Scope `book7` in or out explicitly. If it is scoped in, the 601/6010 caveat applies to **all** of it, not only its capacitor material — its cover and running heads read 'MINIVAC 601/6010' and its relay text says 'the MINIVAC's relays' without distinguishing models (critic-completeness C10, from verify-relays REF-11). So every Book VII fragment entering this corpus must be labelled **601/6010**, never 601. The hysteresis model, the bias resistors and the `ncap` terminals all ride on that one in/out decision. |

### Named fallback: `FALLBACK-PWRUP-COLD`

**Applies to** every fixture's step 1, wherever the printed page does not state the power-up state.

**Behaviour.** At power ON, every relay coil is de-energised and every relay sits in its unoperated position
(normally-closed contacts made, normally-open contacts broken). Slide switches hold whatever position the
fixture's initial settings gave them; pushbuttons are up; the dial holds its initial position. **Then** iterate
the relay network to fixpoint, and only then evaluate step 1's assertions.

**Why it is defensible.** It is physically correct for single-coil spring-return relays, which is what this
machine has — with no current there is exactly one mechanical rest position. It is the only power-up rule the
manuals ever assert, and they assert it twice: Book IV printed p.70 step 1, "Turn power ON. Notice that both
relays 5 and 6 are OFF" — a *bistable* circuit, the hard case — and Book II Experiment 5 step 2 (printed p.14 = PDF
p.20), "Turn power ON. Relay 3 comes ON because both numbers are zero", which is cold-start-then-settle
exactly — [likely], text layer, not image-read. Book I p.9 step 6
gives a third: "Turn the power switch ON. Light 2 comes on as soon as power is turned ON", through a normally
closed contact. It composes with the errata's own reset advice — four Book VI notes say "to re-set the game,
turn power off, then on again", which only makes sense if power-cycling is a clean total reset. And it makes
every fixture reproducible; modelling a power-up race would make the flip-flop fixtures non-deterministic and
would be an *invented* model, which is worse than a wrong one.

**A circuit that latches during the first settle comes up ON — but `II-SELFLOCK` is not such a circuit.** Its
holding path runs through its own **normally open** contact, so at cold start the coil sees nothing and it
comes up OFF, latching only after the first button press. An earlier file used it as the worked example for
this rule and had it backwards (§3.1 C-14).

**How to record it.** Every step-1 assertion generated under this fallback carries `tag: "unverified"` and
`source: "FALLBACK-PWRUP-COLD"`, and the harness must be able to list on demand exactly which expectations in
the suite rest on the fallback rather than on print.

**What would overturn it.** A printed step anywhere in Books I-VII asserting a relay is ON immediately at
power-up in a circuit where no closed path to its coil exists through de-energised contacts; or a Maintenance
Manual passage describing a latching or magnetically-held relay. Neither appears in anything read so far, and
the Maintenance Manual has now been read end to end (§4.7) without producing one. If found, the fallback becomes
per-circuit rather than global.

## 6. Open questions this file raises

1. `docs/programs.json` — the reconciled machine-readable corpus these fixtures are generated from — does not
   exist. The blocking research is done; the blocking engineering is not. Nothing downstream can key off a
   corpus that is not on disk.
2. The tier C1/C2 split is this file's judgement, not a source fact. It exists because the prior tiering
   simultaneously said "build `II-EXP2` and `I-EXP11` first" and "defer every program touching `D0`..`D19`".
   Someone has to ratify the split or pick the other repair.
3. Cheapest high-value image reads remaining, in order: **one** 300 dpi crop of
   `book2-3-4.pdf` PDF p.75 (promoted `IV-FF1`'s wire list — done 2026-10-14; it no longer bore on N-3, which the Maintenance
   Manual settled); **six** of `book1.pdf` pp.31-34 (the Book I answers).
4. Does the errata's alternate counter still display the count on lights 4, 5 and 6? It taps all three lamps
   differently from the Book IV counter, and the sheet is silent. **Answered from printed text (2026-10-14,
   wave 3):** errata p.2 directs "Use the procedure on page 72 of Book IV" and ER-21 makes this circuit the
   substitute for the Book IV counter; errata p.3 says the alternate circuit is used "for experiments 1 and 2".
   The p.72 step 1 and 2 readings (OFF, OFF, ON; OFF, ON, OFF) apply untagged. Later per-press states remain
   derived (Step 7).
5. `find-relays.json` RLY-27's Book I Experiment 8 wire list contains `1Y/1C` where this file has `1X/1C`.
   Struck here; it should be struck there too.
6. Is `book7-capacitor-resistor.pdf` in scope? It is a joint 601/6010 document and reading it risks 6010
   contamination against the project's 601-only ruling; if it is ruled in, **every** fragment taken from it must
   be labelled 601/6010, not 601 — the caveat covers its relay material, not just its capacitor material. The
   Maintenance Manual is no longer part of this question: it is 601-only, it has been read, and §4.7 carries its
   three check circuits.
