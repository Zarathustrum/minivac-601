# Phase 5 Step 7 backlog

Derived checks that Step 6 reviewers deferred to Step 7. Step 7 is done; the entries kept are the ones fixture notes or `open-questions.md` cite, the reason II-EXP4's script tail stays, and the one still open for Tom's end review (IV-EXP10). Each line carries the printed basis of the finding it came from. Sources: the batch-1 and batch-2 review findings (2026-10-13) and the fixture notes.

## V-EXP10

- The 5L/6G-kept variant of ER-32, a speculative fixture beside the as-printed one. Basis: errata.pdf p.3, right column, "page 12: program corrections for automatic toll collector" ("remove 5L/6G"); Tom ruling O-C8, 2026-10-13: ER-32 stays as printed, Step 7 adds this variant. Neither variant pays on a nickel and five pennies in the simulator (O-C8, rests on O-R1/O-R3/O-R5).

## V-MAZESOLVER

- Re-run and re-review after any O-R13/O-R14 coast fix and in the motor sweep run. All six goal rests (c5/c3/c7) and four start rests (c1) depend on the wiper stopping on the pad with no coast overrun (pad-stops after a STOP short: 6G/D19, 6Z/D19).

## I-PROBLEMS

- Pushing pushbutton 5 while the dial is already turning under pushbutton 6 (Answers 14 and 15) and the dial then staying still. Basis: Book I p.28 Problem 14 "The rotary switch should NOT turn when pushbutton 6 is up, or when both pushbutton 6 and pushbutton 5 are down." The fixture asserts only the both-down case from rest; the in-motion case needs the rest position after the invented STOP-short or drive-removed coast (O-R5).
- Problem 13's converse (dial still and light 6 off with pushbutton 6 up), stop positions after pushbutton 6 is released, and the direction of rotation for Answers 13-15. Basis: p.28 Problem 13 says only "when pushbutton 6 is pushed"; none is printed.

## II-EXP4

- The script tail (pushbutton 5 release, then 3000 ms) asserts nothing but stays: it records relay drop-out and the one-shot drive-removed coast (unprinted, `[unverified]`; O-R5, O-R13), which gives the C# port conformance coverage of drive removal at RUN speed, so any change to coast re-blesses this printed-claims fixture.

## V-EXP6

- Proposed `tools/motor-claims.ts` claim, not added: `V-EXP6/zero-to-fifteen-is-15-16`, from rest push pushbutton 6 and check that the dial runs 0 to 15 (increasing) in 15/16 of a revolution, so a D17/D18 swap fails it. Basis: Books V-VI p.7 "indicates a revolution ... when the dial has completed 15/16 of a revolution" (O-R11). Companion: `V-EXP6/pb5-stops-motor`, push pushbutton 5 mid-run and check the dial rests and stays still (`r.rest`/`r.still`, no fixed contact).

## IV-EXP10

- Parked, not a Step 7 derivation: ER-27 overfills terminal `3G` as printed (O-C13). If Tom rules for a corrected wiring, the p.83 dividend (011011) and first subtraction (001 / 110) output-light claims must be asserted.

## IV-FF2-CARRY

- Light 4's value at each of steps 1-3 (the carry indicator). Basis: Book IV p.70 (PDF p.76) "Light 4 will now indicate that a carry is taking place." with step 3 "We want a carry signal to occur NOW."; no sentence says light 4 is ON or OFF at any step. Trace, diagnostic only: `outLamp4` goes off, dim, on at 157.5 and 176.5 ms, right after relay 5 drops in step 3. The three relay expects carry `FALLBACK-FF2-CARRY-BASE-CIRCUIT` (O-C26). Nothing printed to upgrade.

## Fidelity reading rules (orchestrator working choices, not Tom's rulings)

- Digit string to lamp states (from the V-EXP11 batch-3 finding). When a page prints a digit string for a specific input and names the lamps it appears on, the lamp states are printed: digits go onto the named lamps in order, 1 = ON, per Book IV p.72 (PDF p.78), "Binary output lights 4, 5 and 6 will read OFF, OFF, ON or 001." When no string is printed for an input (IV-EXP11, IV-EXP12, IV-APX-2BITADDER), the lamp pattern is derived and goes to Step 7.
- Stated rule over a range of steps. When a page states an observable over a range ("remains closed until none of the switches is activated"), it is printed for every step in that range; only the return or a case beyond the stated range is derived (V-EXP7 steps 1-5).
- Rule plus printed encoding is an input step. When the page prints the rule, the switch encoding and the final observable ("The pointer knob of the rotary switch will turn to the number your friend had in mind"), answering the printed questions is the printed procedure, not output derivation; ER-45 and ER-14 settle 0 as even. This matches O-C12 (Tom, 2026-10-14) and applies to III-MINDREADING and VI-MINDREADING.
- Do not classify from the PDF text layer alone. A flow chart or an overbar can be missing from it (III-MINDREADING p.51); a value is called derived only after the page image has been checked.
- Floor or indicator maps hold at rest. A lamp that follows a relay changes at the push, before the dial arrives; do not derive "lamp on means the dial is there" while the dial moves (V-EXP8).
- A position `until` on a motor circuit encodes motion only. It is the "turns" observable ("notice the direction of rotation", "As the rotary switch turns"); it gives no coverage of reversal, direction or duration, which need a schema observable or a run-rate window (I-EXP14, O-C14).
- General prose names no observable. A real-world description ("the alarm sounds") does not make a relay's buzz assertable; a sentence that does not name the lamp or relay ties to the nearest sentence that does (V-EXP2 p.2).
- An erratum that corrects a printed reading is printed text. Applying it is not editing the page: IV-EXP9's final shift (p.82 prints "11100" twice; ER-26 says "decimal 60 is 111100 in binary. It is written incorrectly in two places."; the page's own equation prints 111100) and V-EXP21 (ER-39). The IV-EXP9 reviewer kept the expect on this reading (2026-10-14); recorded so the two are treated alike. The erratum must be linked to its program in `programs.md` §3.2.
- Program list over diagram. When a printed circuit diagram disagrees with the printed wire list, the list is what is wired; record the diagram disagreement per line, and check that the page text backs the list (V-EXP3 `5S/6K` against a diagram that feeds `4S`; V-EXP6 `5L/D14` and `D18/M-`). An erratum is cited only if one exists.
- A printed assert must discriminate. An expect on a state that already holds before the stimulus (light 6 at power-on in VI-SECRETCODE and VI-MAZE) is not vacuous only if the script also observes the transition; the discriminating off-before assert is derived and goes to Step 7. A one-way conditional ("If light 6 comes on, an error has been made") is read in its converse only when the same page prints the converse for the same circuit.
- Quote the sentence that states the asserted observable. An until that waits only for its own lamp does not check an order claim, so it cites the sentence that names that lamp, not the order sentence (I-EXP13: "light 5 and light 6 flash ON in sequence"); the order claim goes to Step 7.
- Record quotes are page text. Evidence strings in `printed-class.json` and the record bullets quote the page with line-break hyphens rejoined and straight quotes; a paraphrase is labelled as one.
- A fixed-time script step is a script choice with a disclosed rate range (VI-TUGOFWAR game 5, 770 ms), not a printed timing.
- Count the printed columns on the image. The text layer can drop a whole column of a wire table (II-EXP1: `5F/5-`, a sixth column of one entry); a program whose corpus count fails the coil-return lint is checked against the page image before it is called a manual defect.
- Keep the sheet's case and punctuation in erratum quotes. The ER-19 sentence prints lowercase "slowly" after an em dash; capitals or bold in a record imply emphasis the sheet does not carry (IV-FF1, V-EXP1 ER-28).
- A stage-scoped sentence is not an absolute assert. A relation printed for an intermediate build (IV-FF1 p.68 and p.69 for the 10-wire and 13-wire stages) or for the circuit before wires are added (IV-FF2-CARRY p.70) does not give an absolute lamp or relay value on the final circuit; those values are derived and tagged.
- An erratum conditional on the alternate circuit does not apply to the book circuit (ER-22 on IV-EXP3, ER-24 on IV-EXP7); quote it labelled as the variant, or leave it out of the book circuit's evidence.
- "Use the procedure on page N" is incorporation by reference. When the errata sheet substitutes a circuit and directs the reader to a procedure, that procedure's printed readings are printed for the substituted circuit, scoped to the steps it prints (ER-ALTCOUNTER steps 1 and 2); later per-press states stay derived.
- A one-way conditional's contrapositive is not its converse. "If this relay fails to pull in ... we have attempted an incorrect subtraction" gives "incorrect subtraction implies relay 6 not in" as a derived candidate; "relay 6 in implies a proper subtraction" is read only where the page prints it (IV-EXP7).
- A fixture that cannot be asserted is routed, not weakened. A faithful script with no printed absolute observable (V-EXP13) goes to Step 7 whole, not into the manifest; no `marginal` flag and no profile change to make it bless.
