# Rotary switch — the 16-position motorized DECIMAL INPUT-OUTPUT dial

The MINIVAC 601's only analog-ish part: a single-wiper, 16-contact, non-shorting rotary switch on a
shaft that can be turned by hand or driven by a DC motor through a friction wheel. It is the machine's
decimal input, its decimal output, its storage register, and its clock. Everything mechanically subtle
about the 601 is in this subsystem.

Sources cited by short name:

| Short name | Document |
|---|---|
| Book I | *Getting acquainted with MINIVAC 601*, Book I |
| Books II–IV | Books II, III & IV |
| Books V–VI | Books V & VI |
| Book VII | *Minivac 601/6010 Capacitor/Resistor Manual*, SDC, © 1962 — **joint 601/6010 scope** by its own cover |
| MM | *MINIVAC 601 Maintenance Manual*, Scientific Development Corp. |
| Errata | *Notes and Corrections to the Minivac Manual*, SDC factory errata sheet |
| Photo A | Top-down photograph of an original unit, 1536 × 1152, programming wires laid across the dial (`raw/prebrief/images/image_3.jpg`) |
| Photo B | Wikimedia Commons, 4208 × 2457, flat top-down in daylight; red/blue/yellow wires cross the dial (`raw/photos/commons-minivac601-main.jpg`) |
| Photo C | Wikimedia Commons, 4288 × 2848, museum tungsten light, dial completely unobstructed (`raw/photos/commons-minivac601-DSCF1392.jpg`) |

**Photo scope note.** `raw/photos/commons-minivac6010-mit-museum.jpg` is a **MINIVAC 6010**, not a 601. It
is cited nowhere in this file and must not be used for 601 panel claims.

**Book VII scope note.** Book VII is a joint 601/6010 document by its own cover, and every load-bearing
citation of it below is labelled as such. It is carried here because its rotary connections are written in
601 D-terminal nomenclature and are consistent with the topology verified from two 601-only schematics —
not because the document says 601.

Program transcriptions below are the errata-applied, verification-corrected forms. The full program
corpus lives in `programs.md`; only the rotary-critical programs are repeated here.

---

## 1. Panel geometry and terminals

The block is titled **DECIMAL INPUT-OUTPUT** and carries exactly 20 terminals. Every terminal is a
*pair* of holes side by side, strapped together under the panel, so the block shows 40 holes:
16 pairs in a ring around the knob, 4 pairs in a vertical column to its left. [verified] Photo C;
Book I p.2 ("Each terminal has two holes side-by-side which are connected together underneath the
computer panel. Programming wires may be plugged into either (or both) holes of the terminal.")

| Terminal | Panel legend | Function |
|---|---|---|
| D0–D15 | numeral in each of 16 dial sectors | Fixed contacts, one per dial position. [verified] MM pp.9–10: "connecting output lights through the rotary switch contacts, D0 through D15" |
| D16 | `16` with `ARM` beneath | The wiper arm's own terminal. [verified] Book I p.20: "The contact on the wiper arm is referred to as "D16."" |
| D17 | `17`, bracketed to 18 as `RUN` | Motor supply, through internal R1 to the D19 node. [verified] Book I p.22 figure; MM p.9 figure |
| D18 | `18`, **shared** by both brackets | One motor terminal. [verified] same figures |
| D19 | `19`, bracketed to 18 as `STOP` | Other motor terminal; also the R1 mid-node. [verified] same figures |

Terminal shorthand is `D` + number; wires are written as a slash pair, e.g. `D16/M+`. [verified] Book I p.20

**Numbering and rotation sense.** 16 positions, 0 through 15, equally spaced at 360/16 = **22.5° pitch**.
Position 0 sits at 12 o'clock and numbers increase **clockwise** as the operator sees them:
15-0-1 across the top, 2-3-4-5-6 down the right, 7-8-9 across the bottom, 10-11-12-13-14-15 up the left.
[verified] Photo C (dial unobstructed; all sixteen sector numbers legible, one hole pair per sector, and
the left column reading `16`/`ARM`, `17`, `18`, `19` with RUN bracketing 17–18 and STOP bracketing 18–19)
and Book I p.20 perspective drawing, read independently. Equal spacing is [verified] by SDC's own arithmetic in Books V–VI pp.6–7, which treats
D15 as "15/16 of a revolution" and multiplies by 16/15.

One primary-source trap on rotation sense, and one false alarm:

- Book I p.20's **VIEW UNDER PANEL** figure is *mirrored* — 0 at top, 1…15 running counter-clockwise —
  because it is drawn from beneath. It is a drafting convention, not a second numbering. [verified]
  Book I p.20, figure read as an image.
- Books V–VI p.56 (Philosophic Tug of War) says the knob turns "counterclockwise (towards 9) …
  clockwise (towards 7)". That **agrees** with the panel: the p.57 program stops the dial on 7, 8 or 9,
  so 9 is reached from 10 (counterclockwise) and 7 from 6 (clockwise). It was once read as a conflict
  by assuming travel from 7 to 9 through 8. [verified] Photo C, Book I p.20, Books V–VI pp.56–57;
  `open-questions.md` C13, resolved 2026-10-13.

**Position 0 is not a home position.** It is an ordinary contact, wired and used exactly like the other
fifteen — the traffic light straps `D15/D0` and lights a lamp off that arc; Book I Answer 18 stops on it.
[verified] Books V–VI p.5; Book I p.32. That no automatic homing, indexing or power-on reset exists
anywhere is an argument from silence over an OCR'd corpus, so [likely]; it is well supported, because
every program that needs a known starting position instructs the *operator* to set it by hand
("set the pointer knob of the rotary switch at 0", Books V–VI p.9) and every documented reset is
"turn power OFF, then ON again" or "turn the rotary switch through one complete revolution"
(Errata, Book V p.25 and Book VI p.52). The factory says as much directly: "Problem 18: Note that
pushbutton 5 is used to keep the rotary switch from stopping at D0 when pushbutton 6 is being held down."
[verified] Errata, notes to Book I p.28. Holding pushbutton 5 breaks its normally-closed pair, lifting D0
out of the stop net — the documented way to run past position 0, and further evidence that D0 is an
ordinary contact whose stop behaviour is created and removed by ordinary program wiring.

**Two unlabelled metal fasteners** sit in the upper part of the decimal block, above the `16`/`ARM` hole
pair and offset slightly to its **right**. They render as solid round heads with a struck burr, not as the
dark two-hole jacks used elsewhere, and carry no silkscreen. [verified] that they exist and where they are
(Photos B and C, full-resolution crops); [unverified] what they are and what metal — they read silver-white
in Photo B's daylight and warm gold under Photo C's museum tungsten, so no colour claim survives.
Do not model them as terminals.

---

## 2. Contact structure

One wiper arm, 16 fixed contacts, no second deck, no per-position outputs beyond the sixteen.
The arm rides on the same shaft as the pointer knob and its contact is brought out as D16.
[verified] Book I p.20 body text plus the VIEW UNDER PANEL figure, which draws exactly one radial bar
labelled "Wiper Arm Connected to D16" on a filled hub, sweeping one circle of sixteen positions.

**Break-before-make.** [verified] Book I p.21, Experiment 11: "Notice that light 5 goes OFF before light
6 comes ON. This shows that the rotary switch is designed to disconnect the arm from one contact before
making connection with the next contact. The switch operation is described as "break-before-make"…"
`contact_at(angle)` must therefore be able to return *no* contact, and can never return two.

**The dead gap is real and is a documented hang.** [verified] Errata, Book V p.11 (Experiment 9,
three-floor elevator): "It is possible for the "elevator" to get stuck at a floor. This happens when the
pointer knob stops between adjacent terminals — for example, between D6 and D7 — and is not making proper
connection with either. In such case, move the pointer knob so that it is pointing directly at one of the
terminals." The Experiment 9 program contains `D6/D7`, so those two contacts are the *same net*: the
wiper can rest in the physical gap between two electrically identical contacts and connect to neither.
Nothing in the machine recovers automatically. The same hazard is called out for hand use:
"(Be sure that the pointer knob is pointing directly at the number.)" [verified] Books V–VI p.14.

**Sweep semantics: every contact the wiper crosses fires.** [verified] Book I p.22: "The rotary switch
connections are made sequentially whether the pointer is turned by hand or driven by the motor."
Corroborated by a shipped program that depends on it — the Combination Lock's optional `D8/6E` trap,
"it will cause the machine to indicate an error if 8 is passed at any point", and its design rule
"you must not include any connection which will touch off a connection further along". [verified]
Books V–VI pp.52–53. The Combination Lock is entirely hand-driven (`D16/M+`, no D17/D18/D19), so the
sequential rule binds hand motion too. **Any jump-to-destination optimisation is wrong.**

**The dead gap is what generates the pulse train.** Book VII Experiment 9 (Decimal to Binary Converter,
Book VII p.24, 601/6010 joint manual) straps D1 through D15 into **one** net — `D1/D2`, `D2/D3`, …,
`D14/D15` — and feeds that single net through relay 6 into a binary counter: "As the rotary switch turns,
it makes contact with the terminals and produces pulses which operates the counter." [verified] Book VII
p.24; "The rotary switch returns to zero, sending a pulse to the counter as it passes each rotary switch
terminal." [verified] Book VII p.25. With all fifteen contacts on one net there is no other edge available,
so every counter pulse *is* a break at an inter-contact gap followed by the next make. A model with no dead
gap, or one whose gap the relay model cannot resolve at running speed, produces one pulse instead of n and
the converter reads zero.

**Contact materials and bearing.** [verified] MM p.2, verbatim including SDC's own misspelling:
"To provide low contact resistance, the rotary switch uses silver-plated circuits. The rotary switch
contact fingers are made of berryllium copper [sic]; the drive shaft is made of stainless steel running
in an oil-impregnated bronze bearing."

**Knob-to-wiper alignment is a loose, drifting, per-unit quantity.** The knob is a friction/set fit on the
shaft and the factory realignment procedure is electrical-by-eye: "realign it by connecting a light
through one of the switch contacts on the rotary switch dial. Adjust the position of the knob on the
shaft so the light comes on when the knob is pointing at the connected switch position." [verified]
MM p.2; also MM p.10, "Check the knob alignment to be sure that the knob has not turned on the drive
shaft." Expose a `wiper_offset_deg` parameter — it is the one quantity the hardware itself treated as
adjustable.

**No detents, ratchet, index spring or click stop.** [likely] — this is an argument from silence over an
OCR corpus whose text layer excludes all figure callouts. What raises it above a guess: the errata's
documented rest-between-contacts hang is impossible on a detented switch, and the MM parts list names only
Motor (6471), Drive Wheel Assembly (6472) and Complete Rotary Switch Assembly (6473). A UI that snaps the
knob to integer positions silently destroys both the gap hang and the hand-parking hazard.

### 2.1 Contact arc versus gap — **not settled by the sources**

Pitch is 22.5° [verified]. The split between conducting arc and dead gap is **given nowhere** — not in
Books I–VII, not in the Maintenance Manual, not in the errata. The one under-panel figure is schematic:
it draws a plain circle, sixteen pairs of dots (the terminal holes), and a hatched wiper bar. No contact
arcs, no pad outlines, no gap, no dimensions. [verified] Book I p.20, figure read as an image.

The corpus bounds the gap only as **0 < gap < 22.5°**:

- Greater than zero: break-before-make is stated outright, the wiper "momentarily connects" with each
  contact, and a rest position in the gap is documented. [verified] Book I pp.20–21; Errata Book V p.11.
- Perceptible to the naked eye: Book I p.21 Experiment 11 step 4 tells the reader to "Rotate the pointer
  knob back and forth a few times between numbers 1 and 2" and observe the both-off interval. [verified]
  that the observation is prescribed; [unverified] any inference from it to a number.
- Nothing narrows it further. Attempts to bound the gap fraction from the Morse programs do **not**
  survive verification — see §8, correction 6.

**Fallback: `UNIFORM-CONTACTS`** (the quarter-gap contact model; same name in `README.md`,
`jack-map.md` §8 and `open-questions.md` §G3, where the same unknown is tracked as O-R1). Point wiper; sixteen pads at 22.5° pitch; each pad an arc
`contact_arc_deg = 16.875°` centred on its nominal angle; dead gap 5.625° (gap fraction 0.25).
`contact_at(θ) → Optional[int]`:

```
phi   = normalise(theta_deg - wiper_offset_deg)
k     = round(phi / 22.5) mod 16
delta = angular_difference(phi, k * 22.5)
return k if abs(delta) <= contact_arc_deg / 2 else None
```

Invariants: never returns two contacts (break-before-make is structural, not a special case); returns
`None` on 25% of the circle at the default; the sweep is *integrated*, never jumped — every intermediate
pad between old and new angle gets its own make and break edges, under motor drive and under hand drag alike.

**0.25 is an unsourced engineering default, [unverified], not a finding.** The appeal to "the classic
proportion for a mid-century non-shorting wafer switch" is itself uncited — it appears in the gap finder's
file with no source, and the adversarial pass looked for one and found none. Treat 0.25 as an arbitrary
tunable chosen because it is a round number strictly inside the only bound the corpus gives
(0 < gap < 22.5°) and because it produces the right qualitative behaviours. Name the constant, comment it as unsourced, and expose it. If a finite-width wiper is
modelled instead: break-before-make holds iff wiper face width `w` < gap width `g`, and the electrical ON
window is `c + w` — so the point-wiper formulation is exactly equivalent with one free parameter. [verified]
arithmetic on top of the 22.5° pitch and the break-before-make statement.

---

## 3. Drive: motor, friction wheel, and the internal resistor network

"The rotary switch may be positioned either by hand or by the motor drive. A DC motor turns the rotary
switch through a friction drive." [verified] Book I p.22.

The coupling is the **bare motor shaft bearing on the rim of a drive wheel**. [verified] MM p.10, repair
step 5: "To assure proper friction drive, adjust the motor bracket and spring the motor shaft against the
edge of the drive wheel." That it is held by an actual *spring* is [likely] only — in that sentence
"spring" is a verb, and no spring appears in the parts list. That the drive is permanently engaged, with
no clutch and nothing that disengages when unpowered, is [likely] (argument from silence, but the parts
list and every diagnostic in MM are consistent with it).

Motion is continuous while energised — a plain DC motor turning a shaft, not a stepper, not one step per
pulse. [verified] Book I p.23, Experiment 13: "As the pointer knob turns, light 5 and light 6 flash ON in
sequence… once each revolution of the rotary switch."

The motor is deliberately under-driven: **"The drive motor is operated at less than one-third rated
voltage."** [verified] MM p.2. Supply context: "rated at 1.5 amps continuous with a nominal 12 volts
output", ~13 V unloaded, resettable circuit breaker, switches rated 3 A. [verified] MM pp.2–4.

### 3.1 Internal topology — settled

Read independently off **two** primary schematics that agree exactly: Book I p.22 (unlabelled figure at
the head of section 7, MOTOR DRIVE) and MM p.9 ("Circuit Diagram — Rotary Switch Motor Drive"). Both
rendered and read as images. [verified]

| Element | Between | Note |
|---|---|---|
| R1 | D17 — D19 | series dropper in the RUN path |
| Motor | D18 — D19 | the armature |
| R2 | D18 — D19 | permanently in parallel with the motor |

D19 is the mid-node. Alternatives were tested against the drawings and eliminated: R2 in *series* with the
motor (would satisfy every prose sentence equally well, and would invert the braking model), motor between
D17 and D18, R2 across the whole supply. All refuted by the figures. Neither manual states R1 or R2's
resistance anywhere.

Every documented drive behaviour falls out of this one topology. Nothing else needs to be invented.

### 3.2 The documented drive conditions

| # | Condition | Wiring | Behaviour | Confidence |
|---|---|---|---|---|
| 1 | RUN, normal polarity | supply across D17/D18 | Motor runs. Sees a divided voltage — "less than one-third rated". | [verified] Book I p.22; MM p.9 |
| 2 | RUN, reversed polarity | supply across D17/D18, swapped | Runs the other way. | [verified] MM p.9; Book I p.24 Exp 14 |
| 3 | STOP shorted, RUN still live | short D18–D19 | Motor stops. Supply current flows D17 → R1 → short, limited by **R1 alone**. | [verified] Book I pp.22–23; MM p.9 |
| 4 | RUN de-energised | no supply at D17/D18 | Motor stops, armature still loaded by R2. | [verified] Book I p.23 Exp 12 step 5; R2 loading [verified] from topology |
| 5 | Power across STOP (diagnostic) | supply across D18–D19 | R1 bypassed, full supply on the motor: "the knob should turn very rapidly." | [verified] qualitatively, MM p.9 |
| 6 | Resistance across STOP | 15, 22 or 33 Ω across D18–D19 | Shunts the motor; slows it continuously. | [verified] Book VII p.21 (601/6010 joint manual) |
| 7 | Hand operation | any | Friction drive slips; the operator wins. No stall, no damage. | [verified] Book I p.22; Errata Book V p.31 |

Condition 6 is the one most implementations get wrong. Book VII p.21 ships an optional program connection
written as the braced pair `(D18/Ω)(Ω/D19)` with the footnote, image-verified: *"This is an optional
connection. Use a 15, 22 or 33 ohm resistor to decrease the speed of the motor."* **The D18–D19 net must
accept an arbitrary resistance, not just short/open/driven.** It also independently confirms the topology:
a resistor across D18–D19 can only slow the motor if the motor is directly across D18–D19 with a series
element upstream.

**The shunt is not always optional.** Book VII p.24 (601/6010 joint manual) wires `(D18/Ω33)(Ω33/D19)` as
an ordinary program line — no asterisk anywhere on the page, no optional footnote — putting a 33 Ω resistor
permanently across STOP for the whole run. Contrast Book VII p.21, where the same shape is printed
`(D18/Ω)(Ω/D19)*` under "* Optional". [verified] both pages image-read. So the D18–D19 net must accept an
arbitrary resistance as a **first-class wiring case**, and a fixture generator that treats every braced Ω
pair as optional will drop a wire this program needs.

### 3.3 Braking and coast

Shorting D18–D19 dead-shorts a permanent-magnet DC armature, so it is dynamic braking, not merely removal
of drive. With RUN de-energised and nothing across STOP, the armature is **not open** — R2 sits across it
permanently — so even "power off" is a braked stop, just a weaker one. The *premise* is [verified] from
the image-verified topology; the *magnitudes* — coast angle, spin-down time, reversal time — are
[unverified] and unsourced. The words coast, overrun, momentum and inertia appear nowhere in any of the
nine documents (Books I–VII, the Maintenance Manual and the errata sheet).

Whether coast is physically real is genuinely undecided, and the arguments cut both ways:

- For coast: the elevator's arrival is sensed by the wiper touching the destination pad. If it stopped
  dead on contact it could never rest between D6 and D7 — yet the errata says it can, and says the knob
  "stops" there, i.e. the machine puts it there. [unverified] inference from Errata Book V p.11 and
  Books V–VI p.11 step 8.
- For coast: the errata's example is D6–D7, floor **2** — a landing reachable only under motor drive.
  Floor 1 (D0–D1) is the only one an operator ever parks by hand, and SDC did not use it as the example.
  [unverified] inference.
- For coast: Book VII p.21's automatic counter must halt on one specific contact ("When the rotary switch
  has returned to 0 it stops") and ships with an optional speed-reducing shunt. [unverified] inference —
  the footnote never says why.
- Against coast: an operator *can* park the knob in a gap during setup and produce the identical symptom.
  SDC evidently knew hand-parking was error-prone, because a *separate* errata entry replaces Experiment
  8's hand-park setup with a pushbutton one. [unverified].

Model coast if the PMDC physics demand it, but tag it as invention and expose it as two parameters
(`coast_deg_stop_shorted` for condition 3, `coast_deg_drive_removed` for condition 4), not one. Do not
cite the manuals for it.

**Which brake applies when one transfer set does both jobs** (simulator rule, 2026-10-13, Tom's ruling;
[unverified]). Tic-Tac-Toe and the elevators stop the motor through one transfer set. The arm leaves
the contact that feeds RUN and lands on the one that shorts STOP; between the two, the armature is
undriven and unbraked for the both-open part of the stroke (under 1 ms
for a relay at MV601-REF-A, about 6 ms for a slide). The simulator waits for that stroke to land before choosing the
offset, so the STOP short counts as the brake. The wait is capped by the profile's longest stroke.
The wait changes which of the two invented offsets applies, never their size. Architecture §13.4.5;
fallback `TRANSFER-COAST-DEFER`, open-questions.md O-R12.

**How far it coasts depends on the speed it stops from** (simulator rule, 2026-10-13; [unverified]).
A permanent-magnet armature under dynamic (back-EMF) braking decelerates in proportion to its speed,
so its stopping distance is proportional to the speed it stops from. Both stops are dynamic braking (STOP short through R_arm; drive
removed through R2, which sits permanently across the armature). Friction makes the true distance convex
in speed, so linear scaling from RUN is an upper bound below RUN and the cap understates above RUN. The
V-EXP12 creep ends at -11 mrpm, so the fixture shows only that a near-zero-speed stop must not coast.
The simulator reads the two
invented offsets as the overrun from RUN speed and scales whichever applies by
`min(1, |rate the drive left at| / run_mrpm)`, in exact integers rounded half away from zero. The cap
at 1 is deliberate: power across STOP runs the motor faster than RUN (Maintenance Manual p.9), and the
cap keeps every stop at or above RUN speed on exactly the configured offset, so no stop overruns
further than the pad-tuned numbers allow. It was forced by `V-EXP12`, where a coil-flyback creep at
about 3.6% of RUN took the whole 20° drive-removed jump (the shipped value then) and left the dial one pad short of Books V–VI
p.23's "The pointer knob of the rotary switch will turn to the number drawn on the matrix". The
premise is textbook PMDC physics; no Minivac source states it. Architecture §13.4.5; fallback
`COAST-SCALES-WITH-SPEED`, open-questions.md O-R13 (offsets O-R5).

**How far the drive-removed stop coasts is bounded by two printed claims** (Tom's ruling, 2026-10-14,
a one-off exception to the kill rule; the value stays [unverified]). No source gives a coast angle, so
the invented 20° was replaced by the middle of the band in which every printed claim and printed
assert passes at MV601-REF-A. Below: Book V p.14 V-EXP11, "The rotary switch will return to 0" — the
return crosses each 5.625° gap between pads on coast alone, and fails at 5.692551°. Above: Books V–VI
p.55 VI-MATCHGAME. Its first failure, at 13.385388°, is script[68], the machine-move until on the gap
("the rotary switch will turn to the number of matches remaining after the machine's move"). The dial
does turn, but c13→gap→c12 completes inside the fixture's 50 ms pushbutton 6 tap, before the until
starts, so the until never sees the gap. That edge comes from the observation window of a
script-chosen tap length, not from a printed rest position; the printed rest asserts after the
player's move ("the rotary switch dial will indicate the number of matches remaining") hold to
13.713926°. The band is [5.692552°, 13.385387°] (edges bisected to 1 µdeg; no holes at 0.1°), its
midpoint 9.5389695°, and `coast_udeg_drive_removed` is 9.54°. Discounting the tap-window edge would
give [5.692552°, 13.713926°] and a midpoint of 9.70°; the ruling's letter (every printed assert) gives
9.54°. The stop-shorted 5° stays the shorter of the two. The manuals bound the number; they do not
give it.
Open-questions.md O-R5, O-R14.

### 3.4 Speed

**No speed is specified anywhere.** Books V–VI pp.6–7 instead tells the owner to measure his own unit:
"Count the number of complete revolutions which your rotary switch makes in one minute and note this
number." [verified] That instruction is itself evidence SDC expected unit-to-unit variation.

The one numeric figure in the whole corpus is a worked-example assumption: "assume that the checkpoints
are 50 yards apart, and that the rotary switch turns **45 full revolutions per minute**." [verified] as an
*example figure*, Books V–VI pp.6–7. 45 rpm = 0.75 rev/s = 12 contacts/s = **83.33 ms per 22.5° pitch**.

Two traps:

- **48 is not a dial speed.** The same page derives 45 × 16/15 = 48 rpm. That is the rate at which the
  *program* registers revolutions, because its count fires at D15, 15/16 of the way round. Do not import
  it as an rpm. [verified]
- **"More than a second to go from zero to nine" is not a motor speed.** Books II–IV, "The Binary Nature
  of Storage", is comparing *a human setting a decimal dial* against *a human pressing a binary button*,
  in a passage arguing for binary input. Reading it as a motor RPM (and calling it "in tension" with the
  45 rpm example) is inference dressed as measurement. [verified] as a quote, refuted as a speed datum.
  (The two verification passes cite different printed pages for this paragraph, p.6 and p.8.)

**Constant angular velocity under steady applied voltage is [verified] as SDC's own working assumption.**
The Automobile Speed Timer computes 83.52 mph for one revolution during the run, then divides:
83.52 / 2 = 41.76 for two revolutions, 83.52 / 3 = 27.64 for three (SDC's own arithmetic slip — 83.52 / 3
is 27.84; the page really prints 27.64, image-verified at 400 dpi, so it is not OCR damage, and the factory
errata does not correct it). Dividing by revolution count is only
valid if every revolution takes the same time. [verified] Books V–VI pp.6–7. This is not a claim that
spin-up is instantaneous — the speed timer simply ignores it; model spin-up as a small parameter.

Recommended: first-order approach to a target angular velocity set by the drive-condition table, with
`run_rpm = 45.0` labelled **in the code comment** as Book V's assumption and never as a specification.
`fast_rpm` for condition 5 is [unverified]: "less than one-third rated voltage" refers to the *motor's*
rating, which is nowhere given, so the ~3× estimate collapses if the motor is not a 12 V unit. Keep it
tunable and label it a guess. Do **not** derive RUN speed from a resistive divider using invented values
for R1 and R2.

---

## 4. RUN / STOP semantics

- **RUN** = power across D17 and D18. "Power must be supplied to terminals 17 and 18 (run) to operate the
  motor drive." [verified] Book I p.22. Current path: D17 → R1 → D19 → (motor ∥ R2) → D18. Direction is
  set purely by polarity. [verified] Book I p.24 Experiment 14; MM p.9. D17 at + and D18 at − turns the dial
  toward increasing numbers: Book I p.23 Exp 13 prints "First, light 5 flashes and then light 6 flashes"
  (D1, then D2), the Books V–VI p.11 elevator keeps its selected direction (steps 4, 5, 7) only in
  that sense, and Books V–VI p.7 Exp 6 counts a revolution "when the dial has completed 15/16 of a
  revolution" from 0 to 15 with D17 fed + through 6L/6K and D18 on M- (so the page states D17 + / D18 -
  turns toward increasing numbers; no fixture assert covers it). [likely]; Tom's ruling, `docs/DECISIONS.md` 2026-10-13; evidence and Exp 4's self-conflict
  in `open-questions.md` O-R11. No `V-EXP4` assert depends on direction either (with D17 and D18 swapped
  every assert passes, lamp order 4-6-5), and Exp 4's p.5 sentence can be read as a plain list, which
  leaves p.4 "from red to green to yellow" as its only explicitly ordered sentence.
- **STOP** = a **short circuit** across D18 and D19 — a dead short across the motor itself. Not a brake
  solenoid, not a power cut. "A short circuit may be connected across terminals 18 and 19 (stop) to halt
  the motor drive." [verified] Book I p.22. "The motor stops when pushbutton 6 is pushed because a short
  circuit is created across the STOP terminals (D18 and D19). Current flows through pushbutton 6 instead
  of through the motor." [verified] Book I p.23. MM p.9 states the same operation independently — "Connect
  a short circuit across the STOP terminals (D18 and D19): the pointer knob should stop turning" — and then
  supplies the discriminator: "If the pointer knob does not rotate, connect power **momentarily** across the
  STOP terminals: the knob should turn very rapidly." [verified] MM p.9. A brake, a detent or a power-cut
  input would not spin the motor at full supply when energised; only a terminal pair sitting directly across
  the armature does. The same sentence dates the R1 bypass — hence SDC's *momentarily*.
- **STOP wins over RUN, through the shared terminal 18.** With supply still on D17/D18, closing D18–D19
  diverts the current through the short and leaves zero volts across the motor; removing the short
  restores motion immediately, power never having been interrupted. Book I Experiment 12 explicitly
  distinguishes the two stopping mechanisms: releasing pushbutton 6 restarts the motor, then releasing
  pushbutton 5 "again stops [it], this time because power is no longer connected to the motor circuit."
  [verified] Book I p.23.
- **R1 is what makes the short safe.** "The resistors make it possible to connect a short circuit across
  the STOP terminals to stop the motor without over-loading the power supply." [verified] Book I p.22 —
  but note SDC's plural is loose prose: on the verified topology R2 is *shorted out by the very short it
  is credited with surviving*. Only R1 limits the current. Do not cite that sentence as corroboration of
  the topology.
- **R1 and R2 are power resistors.** "Check each of the two resistors by connecting power across them.
  The resistors should heat up in about 20 seconds. If a resistor does not heat up, it is defective."
  [verified] MM p.10, repair step 3. Values never given.

Minimal reference circuits, the cleanest smoke tests in the corpus — Book I p.31, Answers 14 and 15
[verified]:

| Program | Wires | Behaviour |
|---|---|---|
| Answer 14 — minimal RUN | `5+/5Y`, `5Z/6X`, `6Y/D17`, `M-/D18` | Motor runs only while pushbutton 6 is down and pushbutton 5 is up. |
| Answer 15 — minimal STOP | `6+/6X`, `6Y/D17`, `M-/D18`, `D18/5X`, `5Y/D19` | Pushbutton 5's normally-open pair bridges D18 to D19 and halts the dial. |

**Net-model prerequisite.** All `+` terminals on the machine are one node and all `−` terminals are one
node: "All + and — terminals are connected together. For example, a connection to 1+ is the same as a
connection to 3+, 6+, or M+." [verified] Errata, general notes. This resolves the apparent inconsistency
between Book I programs (which power the motor from `6+`/`6-`) and Books II–VI programs (which use
`M+`/`M-`) — identical circuits. A second, equally load-bearing rule follows it in the same errata:
"In addition to those terminals specifically marked "common," common terminals are any set of terminals
which are interconnected: for instance, the two terminals at 6R, the six at M10, or the four at 3com."
[verified] Any internally strapped set of holes is one node and may be used as a free wiring junction —
which is what licenses D-contact strapping chains like the traffic light's.

---

## 5. Manual operation

The knob can be turned by hand at any time and registers electrically exactly as if the motor had driven
it — same shaft, no clutch. "The rotary switch connections are made sequentially whether the pointer is
turned by hand or driven by the motor." [verified] Book I p.22.

Hand operation is a first-class programming input, not a fallback:

- **Hand rotation as the clock.** Books II–IV pp.86–87, Automatic Shift Register (program p.86, both
  quoted sentences at the top of p.87): "Shift LEFT one bit by
  slowly turning the rotary switch dial one complete revolution… To shift left more than one bit simply
  turn the rotary switch dial the desired number of revolutions." [verified] The motor is not wired.
- **Hand rotation against a running motor.** The friction drive slips, and the factory tells you to do it:
  "slow the rotary switch down by holding the pointer knob back during one revolution." [verified] Errata,
  Book V p.31. A hand-drag interaction must coexist with the motor drive without a stall state.
- **Direction can be programmatically significant.** "always turn the pointer knob clockwise when
  indicating a letter for coding" [verified] Errata, Book V p.33; "Turn the rotary switch clockwise until
  the pointer knob is pointing at the letter you wish to code" [verified] Books V–VI p.34.
- **Some programs are simply too fast for the relays**, and the factory remedy is to slow the machine:
  "try carrying out the procedure slowly; some programs are not designed for high-speed operation."
  [verified] Errata, general notes.

---

## 6. Use as decimal I/O and as a clock

The manual classifies the dial as **both** an input and an output unit, and as storage:
"When operated with the motor, the rotary switch becomes an output device, since the motor may be
controlled by the processing unit… and caused to stop with the pointer indicating the number which is to
be communicated as output information." [verified] Books II–IV p.3. "The rotary switch remains in a
particular position until it is moved and thus enables MINIVAC 601 to "remember" a decimal number."
[verified] Books II–IV p.3. Range is 0 through 15: "The decimal input capabilities of the MINIVAC 601 are
limited to the numbers from zero through fifteen." [verified] Books II–IV p.5. The manuals never use the
word *hexadecimal* — that framing is Wikipedia's gloss. [verified] by contrast with Books II–IV p.5.

### 6.1 The eight idioms

| Idiom | Wiring shape | Source |
|---|---|---|
| **Read position** | Energise D16 from a rail; take output off D0…D15. Or drive a contact and read D16. | [verified] Book I p.20; MM pp.9–10 |
| **Range detect** | Strap adjacent contacts into arcs (`D1/D2`, `D2/D3`, …). Omitting a strap separates two groups. | [verified] Books V–VI pp.4–5 traffic light (narrative p.4, program p.5) |
| **Seek and stop** | Tie the wiper to one STOP terminal and drive the target contact to the other. Arrival shorts D18–D19 through the arm and the motor halts on the target. Both polarities are shipped: `D16/D19` with the target on the D18 side, and `D18/D16` with the target chain on `D19`. | [verified] Books II–IV p.85 Exp 12, p.87 two-bit adder and Book I Answer 18 (`D16/D19`); Books II–IV p.15 Exp 7 (`D18/D16`, `6S/D19`) |
| **Seek one of two, relay-chosen direction** | Two targets at opposite rails, wiper to D19, a relay swaps which rail feeds D17 and D18 — choosing both direction of travel and which target's polarity matches. Mechanism is *derived* from relay contact conventions, not stated. | [verified] program, Books V–VI pp.10–11; mechanism [likely] |
| **Relay as brake** | Any relay contact pair wired between D18 and D19 stops the dial on command (e.g. `4K/D19` with `4L/4−` while `D18/M−`). | [verified] Books V–VI p.60 |
| **Wiper as rail** | Tie the arm to a RUN terminal (`D16/D17`) so it distributes the motor's own supply rail to the contacts it sweeps. | [verified] Books V–VI pp.29–30 CQ transmitter; p.60 reaction timer |
| **Arithmetic offset** | Strap contact *n* to contact *n+k* so a seek-and-stop lands *k* positions away. The Match Game subtracts with offset 3: `D1/D4`, `D2/D5`, … `D12/D15`. | [verified] Books V–VI pp.54–55 |
| **Ring with one break** | Strap D1 through D15 into one chain — fourteen straps, `D1/D2`…`D14/D15` — and encode a number by *removing* one strap: "Enter 5 (00101) on the rotary switch by removing D5/D6." D0 is deliberately **off** the chain and wired `D0/D19` as the stop. Breaking the chain at the entered digit makes the switch emit *n* pulses per revolution instead of sixteen. | [verified] Book VII p.24 (chain program) and pp.25, 26, 29 (the idiom stated three ways), all four pages image-read; 601/6010 joint manual |

### 6.2 The dial as clock

"Most automatic digital computers have a mechanical or electronic device, similar in function to the
rotary switch, to generate a continuous series of electrical pulses… Continuous pulses, generated to
operate a digital computer, are called "clock" pulses." [verified] Book I p.24, section PULSE GENERATOR. (Printed p.23 is Experiments
12 and 13; the section runs at the head of p.24.)

**Free-running.** Take pulses off individual contacts as the arm sweeps. One pulse per contact per
revolution, in fixed sequence. The traffic light is the cleanest demonstration: with `D17/M−` and
`D18/M+` the motor runs forever with no relay involvement at all, and dwell per lamp is set purely by how
many contacts you strap together — 6 green, 4 amber, 6 red, covering all sixteen positions. [verified]
Books V–VI pp.4–5 (narrative and circuit diagram p.4; the program table and the "To use the traffic light
program" prose p.5).

```
Traffic light (Books V–VI p.5, image-verified, 22 wires)
4A/4+  4B/D11  5A/5+  5B/D7  6A/6+  6B/D1
D1/D2  D2/D3  D3/D4  D4/D5  D5/D6
D7/D8  D8/D9  D9/D10
D11/D12  D12/D13  D13/D14  D14/D15  D15/D0
D16/M—  D17/M—  D18/M+
```

`D15/D0` in that list is the clearest primary proof that the contact ring wraps 15 → 0. [verified]

**Metronome (reversing oscillator).** Books V–VI pp.3–4, Experiment 3, image-verified, 17 wires:

```
4R/D3  4S/5R  4T/D5  4U/D7  4V/5T  4W/D9  5S/6K
6C/6L  6E/D16  6F/6—  6G/D1  6G/6N  6H/D17  6J/6K  6J/6+  6L/D18  6N/6—
```

"Turn power on. The rotary switch dial will begin to turn back and forth, generating a periodic signal.
To change the period of the signal, move slide switches 4 and 5." [verified]

Derived operation — every wire and every relay convention it uses is [verified]; the derivation itself is
inference, and rests on the program table plus the p.3 text. The printed circuit diagram (PDF p.10, read
as an image at 600 dpi) agrees with the table except on one wire: it draws the `6K` feed to `4S` (which is
also tied down to the `5R` line) and leaves `5S` with no external connection. The table's `5S/6K` is
followed, because wired the diagram's way switch 5 would do nothing and only D3 and D5 could be selected
(two periods, not the four that p.3 prints). No erratum covers it (`errata.pdf` pp.3-4 have no Book V p.3 or
p.4 entry):

1. Relay 6 arms H and L: OFF connects H–J and L–N, ON connects H–G and L–K (Book I p.13).
   Coil terminal F is one end; the other end is reachable via E directly or via C through the relay's own
   indicator lamp in series (Book I p.14).
2. J and K are strapped to `6+`; G and N to `6−`. D1 sits at the negative rail (via G); the selected one
   of D3/D5/D7/D9 sits at the positive rail (via K).
3. Arm H drives D17; arm L drives D18 and also feeds coil terminal C.
4. Relay OFF → D17 at +, D18 at − → motor runs one way. Relay ON → polarity across 17/18 flips → the dial
   reverses.
5. E is tied to the wiper D16. Reaching the selected positive contact pulls the relay in. With the relay
   in, arm L is at + via K, so C is at + and the coil holds *through the indicator lamp* after the wiper
   leaves — light 6 is the beat.
6. Reaching D1 (negative rail) pulls E hard to `6−` through the bare wiper, shunting the coil and dropping
   the relay out. The motor reverses again.

Net: the dial oscillates between D1 and the selected far contact forever. Period selection: slide switch 4
deck 1 (pole 4S) picks D3 or D5, deck 2 (pole 4V) picks D7 or D9, and slide switch 5 (pole 5S) picks which
deck reaches 6K — so exactly one of D3/D5/D7/D9 is the far turning point, giving arcs of 2, 4, 6 and 8
positions. Which *physical* slide-switch position (LEFT or RIGHT) selects which throw is **not stated for
this experiment**. SDC: "only four periods can be produced using the positions of slide switches 4 and 5.
Through an appropriate circuit, the MINIVAC is capable of generating 15 different periods." [verified]

The manual generalises the pattern itself: "this can be done by a program which will automatically sense
the position of the pointer knob and immediately act to change its position. An example of such a program
is the metronome… the system automatically reacts to its own operation." [verified] Books V–VI p.26.

**The metronome's tick is not a fixed frequency.** It is dial travel time between two contacts, so it
inherits motor speed, reversal time and whatever settling behaviour the model has. A model that treats the
dial as an integer with instant reversal produces a degenerate metronome. Assert only that the four
settings give **strictly increasing** periods — the ratio 2:4:6:8 is *not* stated by any source, and a
reversing drive's half-period necessarily includes acceleration and deceleration, so strict proportionality
is contradicted by the physics.

Book I Problem 17 (p.28) sets the same task in 11 wires and Answer 17 (p.32 — printed p.31 carries
Answers 12–16 and stops) is the same topology with a
fixed far point: `6+/6J`, `6J/6K`, `6K/D6`, `6E/D16`, `6F/6-`, `6G/D1`, `6C/6L`, `6L/D18`, `6H/D17`,
`6-/6N`, `6N/6G`. [verified]

---

## 7. Reference programs for the rotary model

Errata applied. Full corpus in `programs.md`.

| Program | Cite | Rotary role |
|---|---|---|
| Exp 11, manual rotary | Book I p.21 | `6+/D16`, `D1/5A`, `D2/6A`, `5B/6B`, `6-/6B`. Break-before-make demonstrator. |
| Exp 12, basic motor | Book I p.22 | `6+/5Y`, `5X/D17`, `6-/D18`, `6-/6Y`, `6X/D19`. RUN and STOP, both stop mechanisms. |
| Exp 13, pulse generator | Book I p.23 | `6+/D16`, `D2/6A`, `6-/6B`, `D1/5A`, `5B/6B`, `6+/5Y`, `5X/D17`, `5-/D18`, `6-/6Y`, `6X/D19`. Exp 11 + Exp 12 combined; lights 5 and 6 flash once per revolution. The clock demo. The page prints `5-/D18` where Exp 12 printed `6-/D18` for the same node — identical under the errata power-net rule, not a typo. [verified] image-read at 500 dpi. |
| Exp 14, motor reversing | Book I p.24 | `6+/6R`, `6T/6U`, `6V/D17`, `6+/6W`, `6S/D18`, `6-/6T`. Errata corrects the *diagram* label 6Y → 6V; the printed program list is not corrected. |
| Answer 13, minimal motor + light | Book I p.31 | `6+/6Y`, `6X/6A`, `6B/6-`, `6X/D17`, `D18/M-`. The corpus's minimal "motor runs and a light lights while pushbutton 6 is held" program, answering Problem 13 on p.28. [verified] image-read at 500 dpi. |
| Answer 18, stop at zero | Book I p.32 | `6+/6Y`, `6X/D17`, `M-/D18`, `5Z/D18`, `5Y/D0`, `D16/D19`. Seek-and-stop on a single contact via a normally-closed pushbutton pair. The errata's note to Book I p.28 governs it: pushbutton 5 held lifts D0 out of the stop net so the dial runs past zero (see §1). |
| Exp 7, decimal output | Books II–IV p.15 | Slide-switch poles daisy-chained `1S/2S`…`5S/6S`, first switch thrown breaks the chain; `6S/D19`, `D18/D16`, `D16/M—`. Dial turns to the stored number. |
| Exp 12, binary→decimal | Books II–IV p.85 | Tree circuit energises exactly one contact; `D16/D19`, `D18/M—`, `6X/D17`. "each combination of switches energizes one and only one terminal of the rotary switch." |
| Two-bit adder | Books II–IV p.87 | `D16/D19`, `D17/M+`, `D18/M—` hard-wired to the rails — seek-and-stop with the opposite rail assignment from Exp 12. |
| Metronome | Books V–VI pp.3–4 | See §6.2. |
| Traffic light | Books V–VI p.5 (narrative p.4) | See §6.2. |
| Exp 9, three-floor elevator | Books V–VI p.11 | Three seek targets, two relay contacts as brakes (`4L/D19`, `4N/D18`, `5N/D18`), landing pads widened to two contacts each: floor 1 = D0-D1, floor 2 = D6-D7, floor 3 = D12-D13. **The documented dead-gap hang.** |
| Combination Lock | Books V–VI p.52 | `D16/M+` only — no motor wiring. Sweep-sensitive by design. |
| Book VII automatic counter | Book VII p.21 (601/6010 joint manual) | `1K/D18`, `1cap/D16`, `2L/D0`, `D15/M—`, `D17/M+`, plus the optional `(D18/Ω)(Ω/D19)` shunt. Must halt on position 0 after exactly one revolution. |
| Exp 9, decimal→binary converter | Book VII p.24 (601/6010 joint manual) | Rotary side: `D0/D19`, `D1/D2`, `D2/D3`, … `D14/D15`, `D16/M+`, `D16/D18`, `D17/M−`, `(D18/Ω33)(Ω33/D19)`; relay-6 side: `6C/D1`, `(6C/Ω150)(Ω150/6E)`, `6F/6−`. D1–D15 strapped into **one** net, D0 kept off it and tied to D19 as the stop. The counter's pulse train comes from the inter-contact gaps — see §2. The 33 Ω STOP shunt here is **not** optional. [verified] image-read at 200 dpi. |

**Landing-pad design.** Experiment 9's two-contact pads are SDC's own mitigation for the stopping problem
— two pitches of landing instead of one — and the errata records that even two is not always enough.
[verified] Books V–VI p.11 floor table and program lines `D0/D1`, `D6/D7`, `D12/D13`.

**Required regression case: `errata_elevator_hangs_between_D6_and_D7`.** Load Experiment 9 with the errata
applied and *state which variant* — the base corrections (`4G/4H` → `4G/5H`, `D16/M—` → `D16/M+`) or the
errata's second, optional reliability variant (remove `5F/6C` and `6C/6—`; add `5F/6E`, `6E/6-`, `4E/6C`).
Park at D0, power on, verify light 1. Push pushbutton 2. With the coast parameter set inside the hang
window, the wiper must come to rest in the gap: `contact_at` returns `None`, no floor indicator lights,
and the machine is hung as the errata describes. (An earlier reading added "further pushbutton presses do
nothing". No page prints that, and under the Exp 9 wiring the relays stand the same at D6 and in the gap,
so the model serves a call from the gap; see O-R6.) Moving the
knob onto D6 or D7 must recover it. With the coast parameter at its safe default, the same scenario must
*not* hang. This is the only test in the corpus that exercises the gap parameter at all; if someone later
flattens `contact_at` to snap-to-integer, it fails, which is the point.

Second required case: **`combination_lock_D8_trap`** — hand-drag the dial past position 8 en route to a
later number and assert the error fires. Exercises the no-jump rule in hand mode.

---

## 8. Corrections

Claims that appear in circulation or in the first research pass and do **not** survive verification.
Stated here as corrections; none of them is carried forward above.

1. **"Book VI confirms that increasing dial numbers run clockwise."** This correction is withdrawn
   (2026-10-13): Book VI does agree with the panel. It had read "counterclockwise (towards 9)" as travel
   from 7 through 8, which the p.57 program's STOP wiring prevents. See `open-questions.md` C13.
2. **"Book I p.20's '(1 to 19)' is an OCR artefact of a `#` placeholder."** No. The manual literally
   prints a digit as its exemplar: "8 = terminal number (1 to 19) … for example D8", and does the identical
   thing on p.25 for the matrix ("6 = terminal number (1 to 11) … for example M6t"). Image-read at 200 dpi;
   clean glyphs. The *substantive* point stands: the printed range omits D0, which exists and is used;
   MM p.10 gives the correct range, "D0 through D15". The factory errata does not correct it. [verified]
3. **"The errata's reliability changes apply to Experiment 8."** No — they belong to **Experiment 9**.
   Experiment 8's program contains neither `5F/6C` nor `6C/6—` (it has `5F/6X` and `6C/6G`); Experiment 9's
   contains both, plus `4G/4H` and `D16/M—`, exactly the wires the errata names. Applying them to
   Experiment 8 produces a circuit that does not exist. The errata's *only* Experiment 8 change is the
   operating instruction: "Set the "elevator" at the first floor by pushing pushbutton 5." [verified]
4. **"Overrun is proven by the Philosophic Tug of War."** No. The manual says only "Release pushbutton 4
   as the rotary switch knob starts to turn", and holding the button until the wiper has left the D7-D8-D9
   arc is an equally consistent reading. What that program *does* verify is the stop wiring: `D16/D19`
   puts the arm on D19, and `4Y/D18` + `4Z/D9` put D18 on the strapped D7-D8-D9 arc through pushbutton 4's
   normally-closed pair, so releasing the reset button arms a stop over that whole arc. [verified] wiring;
   [unverified] momentum.
5. **"'More than a second from zero to nine' bounds the motor at ≤34 rpm."** No — see §3.4. It is a human
   operation comparison. There is no 30–45 rpm "band" in the sources; there is one assumed example, 45 rpm.
6. **"The Morse programs bound the gap fraction below 0.5."** No, on three independent counts.
   (a) Books V–VI p.31 Experiment 18 does *not* strap runs of adjacent contacts: `D3/D6` and `D8/D11`
   bridge *across* D4/D5 and D9/D10, merging all nine mark contacts into **one net**, one contact per Morse
   element. Dot-versus-dash length comes from relay logic (relays 3–6, still unanalysed), not run length.
   (b) The errata's "the three successive dots … almost indistinguishable" is cured by SDC's own remedy of
   hand-slowing, which scales lit and dark intervals equally and leaves duty cycle unchanged — so the note
   constrains absolute rate, not the ratio. (c) The observation is made through an incandescent pilot lamp
   with a filament time constant of tens of milliseconds, which smears a 42 ms dark interval; the physics
   does not discriminate 0.25 from 0.5. **No primary source bounds the gap fraction.** [verified] by
   image-read of the Experiment 18 program table.
   The refutation cuts both ways, and this is not a defence of 0.25. The adversarial pass records, without
   asserting it, that if the dash is latched from one contact's make to the next, then
   dash/dot = pitch / pad_arc = 1/(1 − gap_fraction) — 1.33 at a gap fraction of 0.25, 2.0 at 0.5. On that
   unresolved reading Experiment 18 would argue for a **larger** gap. [unverified] on both sides until
   somebody solves relays 3–6.
7. **"Book I's 'the resistors make it possible to short the STOP terminals' corroborates the topology."**
   It does not. On the verified topology R2 is shorted out by that very short; only R1 limits the current.
   SDC's plural is loose prose. [verified]
8. **Transcription corrections.** The Automobile Speed Timer (Books V–VI p.6) has **35** wires, not 34 —
   `6C/6G` is easy to drop between columns 3 and 4. The Morse encoder (Books V–VI pp.32–33) has **17**
   decimal-side wires, not 12 — add `2F/D15`, `3G/D8`, `4F/D14`, `5com/D2`, `6F/D3`. [verified] both from
   layout-preserved extraction of the printed pages.

---

## 9. Not settled by the sources

| Unknown | Fallback | What would settle it |
|---|---|---|
| Angular width of a contact pad vs. the dead gap. **The single unresolved parameter of the rotary model.** | **`UNIFORM-CONTACTS`** — 16 identical contacts on a 22.5° pitch, `contact_arc_deg = 16.875°` (gap fraction 0.25), tunable, commented as unsourced. See §2.1. | Under-panel photograph of an original SDC 6473 assembly at measurable resolution; ohmmeter across D16 and one contact while rotating slowly; frame-counted video of an original running the traffic light; solving the Experiment 18 relay circuit (relays 3–6, with the off-net contacts D4 and D9 sitting at the S/O and O/S boundaries), which would decide whether the Morse timing argues for a larger gap or for nothing. |
| Wiper contact face width; single finger or bifurcated. MM says "contact fingers", most naturally read as the fixed contacts. Book I's under-panel figure draws a finite-width tip, but it is a hand drawing with no dimension. | Point wiper — provably equivalent under break-before-make. | Same as above. |
| How D16 is taken off the rotating arm — central hub, slip ring, or concentric collector ring. | Irrelevant to behaviour; model as an ideal node. | Under-panel photograph. |
| Ohmic values of R1 and R2. Never stated. Loosely bracketed at tens of ohms by three weak arguments (the 15–33 Ω shunt is effective; a sustained short must not overload a 1.5 A supply shared with lamps and relays; both resistors warm in ~20 s at ~13 V). | Do **not** derive RUN speed from a divider. Configure RUN speed directly; model the network only where a program varies it. | SDC parts drawing, or a surviving unit. |
| Motor make, rating, no-load rpm; drive-wheel and shaft diameters, hence the friction ratio. | Configurable rpm. | Drawing for part 6471 or 6472. |
| As-built rpm of any real unit. SDC did not specify one and told owners to measure. | `run_rpm = 45.0`, labelled an assumption. | Frame-counted video. |
| Direct-across-STOP speed ratio. "Less than one-third rated voltage" refers to the motor's unknown rating. | `fast_rpm` tunable, ~3× as a guess. | Motor rating. |
| Coast angle, spin-up, spin-down, reversal time. The vocabulary of momentum appears in no source. | Two coast parameters, both labelled invention. | Video of an original executing the three-floor elevator. |
| Whether the elevator hang is machine coast or operator hand-parking. | Reproduce it as a parameterised test, not as asserted physics. | Same video. |
| Whether the friction drive slips under load during normal running (which would make RUN speed load-dependent). MM's "spring the motor shaft against the edge of the drive wheel" implies slip is a live failure mode; nothing quantifies it. | Ignore. | Measurement. |
| Whether the drive wheel is held by an actual spring or a bent bracket. "Spring" is used as a verb; no spring in the parts list. | Cosmetic. | Photograph. |
| Which physical slide-switch position (LEFT/RIGHT) selects which metronome throw. | Either; assert only monotone periods. | A second-edition manual. |
| What the two unlabelled metal fasteners in the upper part of the decimal block are, and what metal. | Rivets or screws. **Not** terminals. | Oblique or under-panel photograph. |
| Why the panel logo plate reads "Cambridge, Massachusetts" while the Maintenance Manual, the errata, Book I's back matter and the Books V–VI copyright page all read "372 Main Street, Watertown, Massachusetts". Both are primary. | Report, do not resolve. "Watertown 72" is a pre-ZIP postal zone, consistent with 1961. | Corporate records. |

The errata sheet ends by saying SDC "is preparing for a second edition of the MINIVAC Manual" (signed
Linda G. Sprague, Editor). A second edition would be the highest-value single acquisition after an
under-panel photograph.

---

## 10. The replica documentation — what it does and does not settle

Mike Gardi's *Minivac 601 (Version 1.0) Motorized Rotary Switch* (Instructables, 2019-07-09, CC BY-NC-SA
4.0) is the best secondary source, and it is **not** a teardown. From his own Version 0.9 introduction:
"I don't have a 'vintage' unit so this replica has been constructed based on photos and from the original
manuals that were available online." [verified] It is a competent re-interpretation *of the same manuals
in this package*.

Consequences, and they are strict:

- Where Gardi agrees with the manuals (16 positions; friction drive; STOP is a short in the original, "not
  just a wire" in his), he adds **confidence, not evidence**. [likely]
- Where he differs, he is describing **his** design, and several of his choices **contradict** the original
  as documented: 16 reed switches with disc magnets in the rotor; a 12 V solenoid that pulls the friction
  wheel into contact; a relay so that powering STOP releases the drive; magnetic detents giving "stops at
  each of the 16 numbers". [unverified as to the original] — and the detents and the solenoid clutch
  directly contradict §2 and §3 above. **Do not import them.**
- The one structurally useful corroboration: his topology is one common bus to ARM plus sixteen
  individually brought-out position contacts, which matches the manual's single-wiper/16-contact
  description.
- **Contamination warning.** Hackaday and search-engine summaries routinely describe Gardi's
  solenoid-clutch replica as though it were the original — "when the rotor needs to move, a solenoid pulls
  the motor's friction drive wheel up against the rotor". That sentence is about the 2019 replica. It is
  not how the 601 works. [verified] by contrast with Book I p.22 and MM p.10.
- His demo video cannot stand in for an original: it shows a geared motor with a solenoid clutch, so it
  settles nothing about speed, coast or gap.

Wikipedia's summary — "A 16-position motorized dial rotary switch could be used to input decimal or
hexadecimal numbers, to output numbers, or to act as a clock signal generator" — is right on positions,
I/O role and clock role, all independently verified from the manuals. "Hexadecimal" is its own gloss.
[likely]
