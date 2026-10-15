# Components — electrical behavior

Every fixed component on the panel: what it is electrically, what its jacks do, and what
the sources do and do not settle. Panel geometry and jack lettering live in `panel.md` and
`jackmap.md`; this file is the electrical contract.

Confidence tags are inline, one per claim, with its citation. The package legend, quoted
verbatim from `README.md`:

| Tag | Means |
|---|---|
| `[verified]` | Read by an agent in a **rendered page image** of a primary source, or in one of the panel photographs. Not OCR. |
| `[likely]` | Clean typeset OCR from a primary text layer, internally consistent, or consistent secondary sources with no primary read. |
| `[unverified]` | A single damaged OCR line, a single weak source, or an agent's own inference. **Every invented constant in this package is tagged `[unverified]`, and that tag is load-bearing.** |

Two corollaries this file previously violated and now obeys. There is no such thing as
`[verified] by deduction`: a conclusion drawn from verified facts is an inference and carries
`[likely]` at best — the tag goes on the page read, not on the argument built from it. And
arithmetic over `[unverified]` constants **inherits their tag**, however sound the arithmetic.

## Source keys

| Key | Document | Page mapping |
|---|---|---|
| BK1 | Book I, *Getting Acquainted with MINIVAC 601*, SDC, first printing August 1961 | printed p.N = PDF p.N+2 |
| BK2 / BK4 | Books II, III & IV (one volume) | Book II printed p.12 = PDF p.18 |
| BK56 | Books V & VI | — |
| BK7 | Book VII, *MINIVAC **601/6010** Capacitor/Resistor Manual*, © 1962 | printed p.N = PDF p.N+5 |
| MAINT | *Minivac 601 Maintenance Manual*, SDC, 1961, 13 pp. | printed p.N = PDF p.N+2 `[verified]` — folios read page by page |
| ERRATA | *Notes and Corrections to the Minivac Manual*, SDC, undated post-1961 | by book and page |
| PHOTO | Top-down panel photographs (`prebrief/images/image_3.jpg`, plus two higher-resolution Commons photographs of two other units) | — |

**Book VII scope flag.** Book VII is titled for the 601 **and** the 6010 and never
separates them; its relay text says "the MINIVAC's relays". Every Book VII claim below —
pull-in/drop-out, hysteresis, the bias procedure, capacitor values — carries that flag.
Corroboration for the 601 specifically: Book VII uses the 601 panel's own terminal letters
(G/H, K/L, C, E, F). `[verified]` BK7 cover and PDF metadata.

---

## 1. Relay (STORAGE / PROCESSING), ×6

Six identical relays, one per section, used to store and to process. `[verified]` BK1 p.12.
Each is an electromagnet whose coil sits left of the arms; energising it pulls a metal bar
on a plastic crossbar to the left. The relay can be worked by hand by pushing the crossbar.
`[verified]` BK1 p.14; manual operation BK1 p.13 Experiment 6.

Nine panel jacks per relay: C, E, F above the relay; G, H, J and K, L, N below it.

### 1.1 Terminals

| Jack | Element | Role |
|---|---|---|
| C | indicator lamp, far side | Lamp is between C and E |
| E | coil / lamp junction | Shared midpoint |
| F | coil, far side | |
| G | contact set 1 | N.O. |
| H | contact set 1 | ARM (common) |
| J | contact set 1 | N.C. |
| K | contact set 2 | N.O. |
| L | contact set 2 | ARM (common) |
| N | contact set 2 | N.C. |

`[verified]` BK1 p.12 ("The normally-open (N.O.) contact is connected to the left terminal,
the relay arm (common contact) is connected to the center terminal, and the normally-closed
(N.C.) contact is connected to the right terminal"); panel legend `N.O. / ARM / N.C.` over
G, H, J with K, L, N sharing those columns, PHOTO. Independently re-confirmed off the
Maintenance Manual's Relay Check figure, MAINT printed p.7. `[verified]`

The same passage settles which physical contact set is which: *"The set of contacts closer to
the operator is connected to the set of terminals closer to the operator."* `[verified]` BK1
printed p.12. G/H/J is the **upper** terminal row and K/L/N the **lower**, operator-side row
(`[verified]` PHOTO, `commons-minivac601-main.jpg` at native resolution), so K/L/N is the
contact set nearest the operator. `[likely]` Still do not make front-vs-rear identity
load-bearing: nothing in the electrical model depends on it.

The relay unit itself has **eight** solder connections. `[verified]` MAINT printed p.8. The
Relay Check figure draws six contact terminals plus a coil with exactly two ends, which is
those eight. `[verified]` MAINT printed p.7. That C is *not* one of the relay's eight lugs —
i.e. the lamp is a separate part — is a **two-source inference**, `[likely]`, matching
open-questions.md's ruling on the same residual ("C's exclusion from the eight a two-source
inference `[likely]`"). It rests on four converging statements, each of them itself
`[verified]`. BK1 printed p.14: *"Three terminals are located directly above each relay on the
computer panel. These terminals are connected under the panel to the relay coil. Two terminals
are connected directly to the relay coil, and the third terminal is connected to a light wired
in series with the relay coil as shown."* Two of C/E/F therefore go to the coil and one to the
lamp. BK1 p.12 says the relay's own panel terminals are "G, H, J, & K, L, N". The Relay Check
figure draws six contact terminals plus a two-ended coil — MAINT p.8's eight — leaving no lug
for C. And a lamp is replaced by cutting its leads ¾ inch from the terminal (MAINT printed
p.6), not by unsoldering a relay lug. The parts list carrying Light Assembly (6435) separately
from Relay (6437) corroborates.

### 1.2 Contact truth table

| Coil | H–G | H–J | L–K | L–N |
|---|---|---|---|---|
| de-energised | open | **closed** | open | **closed** |
| energised | **closed** | open | **closed** | open |

`[verified]` BK1 p.12. Both sets always transfer together and in the same sense — confirmed
behaviourally by the Relay Check ("Lights 1 and 3 should come on. Push the pushbutton.
Lights 1 and 3 should go off and lights 2 and 4 should come on"). `[verified]` MAINT p.7.

Published circuit diagrams **always** draw the relay OFF. `[verified]` BK1 p.12.

### 1.3 Contact-set isolation — settled

The two contact sets are electrically independent. H and L are distinct nodes; G, J, K, N
are four further distinct nodes. The only coupling is the mechanical crossbar.
`[likely]` — no source states it in words. What is `[verified]` is the evidence below: the
printed wiring lists, SDC's own printed step results, and the drawing convention. The
*conclusion* drawn from them is an inference, re-derived independently by two agents. It is
the best-supported reading of the sources and this file models it, and it overrides an
explicit primary sentence (the Trap, below), which is exactly why the tag on the conclusion
must stay honest.

- Book II Experiment 5, DECISION MAKING: wiring on printed p.13, operating steps on printed
  **p.14**. With H and L internally common, step 3 ("Push pushbutton 1. Relay 3 goes OFF")
  is impossible — the trace produces relay 3 ON. `[verified]`
- Book II Experiment 6, ARITHMETIC, printed p.14: relay 2's two arms drive two *different*
  lamps, and a common-arm relay makes the adder read 1+0 = 3. Stronger than Experiment 5
  because the contradiction is visible in two of four rows. `[verified]`
- Book V printed p.13 puts a third instance in a different book (relay 6's arms on two
  different nodes). `[likely]`
- SDC's drawing convention, on two independent documents: **solid = conductor, dashed =
  mechanical linkage**. The vertical between the two contact sets is dashed at 1200 dpi.
  `[verified]` MAINT p.7; BK2 p.13.

**Trap.** BK1 printed p.12, right column under the hand-lettered heading RELAY ON, reads
verbatim: *"The two arms (H & L) are connected together. Both contacts always close
together."* This means **mechanically**. The same page's left column says H–J and L–N are
"separate electrical connections", and two paragraphs down: "The two relay arms are
connected together mechanically with a plastic crossbar." Do not model any node identity
between H and L. `[verified]`

Whether the coil pair (E, F) is galvanically distinct from all six contact nodes is not
stated anywhere. Fallback **IDEAL-ISOLATED-COIL**: model the coil as a two-terminal element
between E and F with no electrical relationship to G/H/J/K/L/N. Every published circuit is
consistent with it, the Relay Check figure draws it that way, and any coil-to-arm bond
would latch nG/nC-style programs permanently at power-on. `[likely]`

### 1.4 Coil and indicator lamp — the central fact

```
C ──[ LAMP ]── E ──[ COIL ]── F
```

The indicator lamp is hard-wired **in series** with the coil, on the C side. E is the shared
midpoint. `[verified]` BK1 printed p.14 schematic, read from the page image; panel
silkscreen bracket `LIGHT` spanning C–E and `COIL` spanning E–F, PHOTO magnified crop;
redrawn the same way in the Relay Check figure and in the errata's alternate-counter
diagram.

Three distinct drives, all used in the manuals:

| Drive | Coil sees | Lamp |
|---|---|---|
| C–F | rail minus the lamp drop | lit |
| E–F | full rail | dark |
| C–E | nothing | lit |

`[verified]` BK1 p.14: *"When the relay coil is energized by connecting power to C and F,
the light directly below the relay comes ON because the light is wired in series with the
relay coil. If the relay coil is energized by supplying power through contacts E and F, the
light beneath the relay will NOT come on because there is no current flowing through the
light."* Book I Experiment 7 step 6 teaches the distinction directly: remove `1X/1E`, add
`1X/1C`, and the indicator lights. `[verified]` BK1 p.15. The C–E-alone case is a
consequence of the topology, not a demonstrated behaviour. `[unverified]`

**The lamp is a deliberate current-limiting element**, in SDC's own words: *"The electrical
resistors used with the motor drive limit the current which flows through the circuit in
the same way that the lights limit the amount of current which flows through a relay
coil."* `[verified]` BK1 printed p.22, section RESISTORS.

**Driving through the lamp is weaker, and SDC published two fixes.** `[verified]` — both
quotes below are read in the errata. Neither carries a magnitude: SDC says "somewhat
strained" and "full voltage … more reliably", and no source anywhere measures the
difference.

- ERRATA, Book IV p.72: *"the design of this counter is such that the capabilities of the
  relays are somewhat strained. Relays which perform to satisfaction in every other case may
  not perform adequately in this circuit. … The circuit below by-passes the relay indicator
  lights so that full voltage is supplied to the relay coils, causing them to pull in more
  reliably."*
- ERRATA, Book V p.11 (Experiment 9, the elevator): *"If the performance of the circuit is
  unsatisfactory … remove 5F/6C, 6C/6-; add 5F/6E, 6E/6-, 4E/6C."* Same shape — move the
  coil return off C onto E so the lamp leaves the series path, and re-purpose C as a shunt
  indicator. Two independent occurrences make the phenomenon systemic.

**Polarity: none.** Book II's single-input flip-flop (printed p.12) contains `1-/1C` and
`2-/2C` — the lamp-plus-coil chain driven with C **negative** — while Book I Experiments 7,
8 and 9, Book II p.10 and Book VII p.8 all drive C or E from **+** with F to −. The same
chain is published in both polarities, so neither coil nor lamp may be modelled as
polarity-sensitive. `[verified]`

**Non-obvious consequence.** The relay indicator lamp is *not* an output of the relay's
state. In the Maintenance Manual's own Relay Check the coil is driven at E and C is left
unconnected, so the lamp stays **dark** the whole time the relay is operating. In the
errata's alternate counter the lamp is short-circuited by a contact and also goes dark. And in
Book VII's bias-resistor circuit the coil is driven through a resistor into E with C
unconnected, the relay's state being read off binary light 1 through its G/H contacts while
the indicator lamp dangles dark. `[verified]` BK7 printed p.8, page image (601/6010). An
implementation that lights the indicator whenever the coil is energised therefore
contradicts all three published circuits — a consequence of the three verified reads above,
not a fourth source statement.

### 1.5 Hysteresis (601/6010)

**Scope.** This whole section is Book VII, which is titled for the 601 **and** the 6010 and
never separates them. Every statement in it — pull-in, drop-out, the bi-stable band, the
bias procedure — carries the 601/6010 scope flag declared under Source keys, and is repeated
inline here so a reader arriving from a cross-reference cannot miss it.

*"The voltage at which a relay turns on is called the pull-in voltage; the voltage at which
a relay turns off is called the drop-out voltage."* `[verified]` BK7 printed **p.6**.
*"The MINIVAC's relays are deliberately designed so that there is a great difference between
the pull-in and drop-out voltages."* `[verified]` BK7 printed p.6.

Between drop-out and pull-in the relay is **bi-stable** — it stays in whichever state it is
already in. `[verified]` BK7 printed p.7, page image: shaded region, callout *"RELAY WILL
REMAIN EITHER ON OR OFF IN THIS REGION"*.

SDC's own physical explanation, which is a better modelling basis than any invented number:
magnetic force depends on coil voltage **and** on the gap between core and armature; for a
given voltage a smaller gap gives greater force; once the arm is pulled in the gap is very
small, so less voltage is required to hold it than to pull it in. `[verified]` BK7 p.6.

**No numbers exist.** Both hysteresis graphs have entirely unnumbered axes. The x-axis
carries only DROP-OUT VOLTAGE, PULL-IN VOLTAGE and `VOLTAGE → (TO FULL POWER SUPPLY
VOLTAGE)`; the second graph adds BIAS VOLTAGE between them; the y-axis carries only RELAY ON
and RELAY OFF. `[verified]` BK7 p.7. What the graph *does* fix is the ordering:

```
0 < drop-out < bias < pull-in < full supply voltage
```

`[verified]` — pull-in is drawn strictly inside the span to full supply voltage.

Instead of publishing figures, SDC makes the owner determine a **bias resistor per relay**,
by descending resistance until the lowest value is found at which the relay stays OFF at
power-on and stays ON after a momentary short. The chart (Ω-B1 … Ω-B6) is printed **blank**.
*"THE FOLLOWING INSTRUCTIONS ARE FOR A SINGLE RELAY. THIS PROCEDURE MUST BE CARRIED OUT FOR
EACH INDIVIDUAL RELAY."* `[verified]` BK7 pp.8–9, page images. SDC also warns that more than
one value may qualify per relay. `[verified]` BK7 p.9.

Two consequences the sources force:

- **Per-relay parameter spread is a documented property of the real machine**, not a
  simulator affectation: the six-row bias chart is printed blank and the instruction reads
  *"THIS PROCEDURE MUST BE CARRIED OUT FOR EACH INDIVIDUAL RELAY."* `[verified]` BK7 printed
  pp.8–9, page images (601/6010). Exposing pull-in and drop-out per relay instance is the
  modelling consequence of that, not itself a source statement.
- The Book VII band is characterised on the **bare coil**: the bias current enters at E, and
  in that program C is unconnected, so the indicator lamp is dangling and dark. The relay's
  state is read from a *binary output* light wired through its G/H contacts, not from the
  indicator lamp. `[verified]` BK7 p.8, page image.

Bias test program, verbatim: `A/G, B/-, E/X, F/-, H/+, Y/+`, plus the braced pair
`(+/Ω, Ω/E)` carrying the footnote *"Decreasing values of resistance will be tried here.
Start with the highest valued resistor in the kit."* `[verified]` BK7 p.8. The word "kit"
appears only on the page image, not in the OCR layer, and it is primary evidence that a
graded resistor set shipped as a separate article. `[verified]`

Stated motivation: using a relay as a bi-stable normally consumes one N.O. contact for the
self-hold path ("either G and H or K and L"), leaving one contact set free; a bias resistor
frees both. `[verified]` BK7 p.6.

### 1.6 Self-holding

The canonical latch, Book I Experiment 9, "A RELAY CONTROLS ITSELF" — six connections,
transcribed from the page image and independently re-read:

```
1F/1-   1C/1X   1Y/2Y   2Y/2+   2Z/1L   1K/1C
```

- **Set:** `2+ → 2Y → 1Y → 1X` (PB1 held) `→ 1C → LAMP → 1E → COIL → 1F → 1-`
- **Hold:** `2+ → 2Y → 2Z` (PB2 up) `→ 1L → 1K` (closed only when relay 1 is ON) `→ 1C →
  LAMP → COIL → 1F → 1-`
- **Reset:** press PB2, opening 2Z.

`[verified]` BK1 printed p.17. `1N` and `1Z` are left unconnected. **Both** the set path and
the hold path run through the indicator lamp, so the coil never sees full rail in the
simplest published relay circuit and must still pull in and hold. That is the hard lower
bound on any pull-in number. `[verified]`

Other published latch/flip-flop circuits in scope:

| Circuit | Source | Program |
|---|---|---|
| Self-locking relay memory | BK2 printed p.10 | `1+/1Y, 1+/1H, 1X/1C, 1-/1F, 1G/1A, 1B/1-, 1C/1A` `[verified]` (OCR normalisation forced by the clean twin circuit above it on the same page) |
| Two-button relay memory | BK2 printed p.11 | as printed, **with the erratum**: change `1A/1C` to `1A/1G`, and delete the `1A/1C` connection on the diagram `[verified]` |
| Single-input flip-flop (two relays) | BK2 printed **p.12** | `1-/1B, 1-/1C, 1A/1E, 1E/2G, 1F/2F, 1H/1F, 1G/1Y, 1Y/1+, 1X/1J, 1J/2H, 2J/2E, 2E/2A, 2B/2-, 2-/2C` `[verified]` |
| Relay controls another | BK1 printed p.16 | `1+/1Y, 1+/1H, 2+/2H, **1X/1C**, 1G/2C, 2G/2A, 1F/1-, 2F/2-, 2B/2-` `[verified]` — see corrections |

SDC calls a self-holding relay "bistable"; OFF = binary 0, ON = binary 1. `[verified]`
BK1 p.17. Relays can be chained, each controlling the next, and Book I Experiment 8 step 5
tells the reader to extend the chain to **all six relays at once**, every coil driven
through its own indicator lamp, with no caveat. `[verified]` BK1 p.16.

**Global reset is a power cycle.** ERRATA twice instructs the user to turn power off and on
again to reset a sequence controller or a game. `[verified]` The machine has no reset line.
The modelling rule that follows is an initial condition, not a steady state: armatures come up
de-energised and the first solve then runs normally, so a relay whose circuit energises it at
power-on pulls in immediately (§8.1).

### 1.7 Mechanical and maintenance facts that carry electrical weight

- Contacts need cleaning once or twice a year (draw clean dry paper between closed
  contacts); if arm pressure is wrong, bend the arm so it "should engage the normally open
  and normally closed contacts and should push them slightly as they meet". Real contact
  resistance, real wear. `[verified]` MAINT printed pp.1, 8.
- The relay clicks audibly on operate. `[verified]` BK1 p.15.
- Programming wires can physically foul the arms: *"replace short programming wires with
  longer ones so that the wires do not interfere with the movement of the relay arms."*
  `[verified]` ERRATA, opening notes, troubleshooting step 4 (right-hand column).
- Relay = spare part 6437, $6.00; replaceable by disconnecting the eight connections and
  unscrewing the mounting screws. `[verified]` MAINT printed pp.8, 11.

---

## 2. Binary output lamps, ×6

Two jacks, A and B, one either side of the lamp. *"A light comes ON when terminal A is
connected to one power supply terminal (+ or −) and terminal B is connected to the other
power supply terminal (− or +)."* The parenthetical permits either polarity — an
incandescent bulb, not a neon or an LED. `[verified]` BK1 printed p.6. Light OFF = binary 0,
ON = binary 1. `[verified]` BK1 pp.6–7.

- The binary output lamps, the relay indicator lamps and the power light are all replaced by
  the same "light assembly": spare part 6435, $1.00. That they are literally the same part is
  inferred from one parts-list entry plus MAINT p.6's instruction to check "the binary lights
  and the relay indicator lights" the same way. `[likely]`
- *"The lights are operated at less than their rated voltage to extend their operating life"*
  and are "conservatively operated and should not require replacement for at least a year".
  `[verified]` MAINT printed pp.2, 6.
- **A single lamp connected directly across + and − is a sanctioned operating condition**,
  not an abuse case: MAINT p.6 tells the owner to test lamps exactly that way. Combined with
  "less than their rated voltage", the lamp's rated voltage therefore exceeds the ~13 V rail.
  `[likely]` — the specific figure of 14 V that appears in earlier drafts is invented and is
  withdrawn.
- Lamps respond fast enough to render Morse dots visibly but blur when adjacent: *"Light 6
  flashes on very briefly when indicating a dot. The three successive dots may be so rapid
  and so close together that they are almost indistinguishable. To see them more clearly,
  slow the rotary switch down…"* `[verified]` ERRATA, Book V p.31.
- Replacement is by cutting the leads ¾ inch from the terminal and soldering in a new
  assembly. `[verified]` MAINT printed p.6.

No source anywhere gives lamp voltage, current, bulb number or base type. `[likely]` — a
negative existential, not a page read. Re-run whitespace-insensitively (`tr -d ' \t'`) over
all six text layers for `volt|amp|ohm|watt|bulb|candela` in this pass: the only hits are the
110 V AC / 12 V DC sentences, MAINT's ratings, Book VII's 92 Ω colour-code worked example
and its 15/22/33 Ω motor-slowing note. But rotary.md's rule applies — *"absence of a word in
an OCR layer that excludes all figure text is not proof"* — and no exhaustive page-image
sweep of all six documents has been done, so this cannot be `[verified]`.

---

## 3. Binary input pushbuttons, ×6

SPDT, one transfer set, three jacks. Momentary. `[verified]` BK1 printed p.8.

| Jack | Role | Closed when |
|---|---|---|
| X | N.O. | button DOWN |
| Y | ARM (common) | always in circuit |
| Z | N.C. | button UP |

*"When the pushbutton is UP, an electrical connection is made between terminals Y and Z.
When the pushbutton is DOWN, the electrical connection is switched to terminals Y and X.
Terminal Y is connected to the 'common' contact and is always used when the pushbutton is
connected in a circuit."* `[verified]` BK1 p.8; panel legend `N.O. / ARM / N.C.` over X, Y,
Z, PHOTO; independently confirmed by the Maintenance Manual's Pushbutton Check.
`[verified]`

**Break-before-make, with a dead zone wide enough for a human to hold.** `[verified]`
BK1 printed p.9, Experiment 3 step 8: *"Push up and down slowly on pushbutton 1 … One light
always goes OFF before the other light comes ON. There is a position, with the pushbutton
only partly depressed, where both lights are OFF. Try to find this position. … This is
important because it shows that the normally open contact is never connected directly to
the normally closed contact, even for a very short time. This feature is necessary for the
proper operation of some MINIVAC circuits."*

That last sentence is a specification: the simulator must never permit an instantaneous X↔Z
transfer, and it should expose the held-in-the-dead-zone state.

Diagrams always draw the button UP. `[verified]` BK1 p.8. Rated 3 A. `[verified]` MAINT p.2.
Spare part 6436, $0.75; red cap pulls off to expose a mounting screw, switch body under the
console with soldered leads. `[verified]` MAINT printed pp.7, 11.

---

## 4. Secondary storage slide switches, ×6

DPDT, two transfer sets ganged by the actuator, **latching** — set by hand and stays put, so
it "remembers" its position. `[verified]` BK1 printed p.18.

| Jack | Set | Closed when |
|---|---|---|
| R | 1 | slide LEFT |
| S | 1 | ARM |
| T | 1 | slide RIGHT |
| U | 2 | slide LEFT |
| V | 2 | ARM |
| W | 2 | slide RIGHT |

*"When the switch is pushed to the left, separate electrical connections are made between
terminals S and R and between terminals V and U. When the switch is pushed to the right,
separate electrical connections are made between terminals S and T and between terminals V
and W."* `[verified]` BK1 p.18. The electrical roles are independently confirmed by the
Slide Switch Check figure plus its stated results. `[verified]` MAINT printed p.8.

Panel legend: a left arrow over the R column, `ARM` over S, a right arrow over T, with
U/V/W sharing those columns. The arrows are **position labels**, not signal-flow arrows.
`[verified]` PHOTO. Mapping U/V/W onto those columns is figure-plus-legend, i.e. two
sources. `[likely]`

Terminal ordering differs from the relay and pushbutton: LEFT / ARM / RIGHT, not
N.O. / ARM / N.C. `[verified]` BK1 pp.12, 18.

- Break-before-make is **not stated for the slide switch anywhere**. `[verified]` (absence
  confirmed by two independent full reads of BK1 pp.17–19 and MAINT). Fallback: model it
  break-before-make like the pushbutton. Supporting arguments, both `[unverified]`: two of
  the machine's three contact families are explicitly break-before-make and are described in
  the same language; and Book I's MOTOR REVERSING circuit uses both sets to reverse current
  through the motor, where a shorting switch would short the supply through the motor leads
  on every throw.
- Whether the two transfer sets are electrically isolated from each other is not stated. Book
  V printed p.13 wires 6S and 6V to two deliberately separated rotary chains, which would
  collapse if S and V were common. `[likely]` Structural identity with the relay ("Cut all
  six connections to the slide switch", MAINT printed p.9) is the background argument.
- Rated 3 A. `[verified]` MAINT p.2. Spare part 6432, $0.50; riveted in place, replacement
  requires drilling out the rivets. `[verified]` MAINT printed pp.9, 11.
- Book I Experiment 14 uses both poles as a reversing pair for the rotary motor:
  `6+/6R, 6+/6W, 6-/6T, 6T/6U, 6S/D18, 6V/D17`. `[verified]` BK1 printed p.24. The erratum
  for that page corrects the **diagram** label (6Y → 6V), not the program. `[verified]`

---

## 5. COMMON terminals, ×6

A four-hole junction block per section, on the blue strip between the relays and the slide
switches, addressed `1com` … `6com`. `[verified]` BK1 printed p.25 §9; PHOTO.

*"The terminals with four holes labeled COMMON may be used when more than two connections
must be made to a set of terminals on the computer panel. The four COMMON terminals are
connected together, but are not connected to any other component."* `[verified]` BK1 p.25.

That sentence is ambiguous as printed. The errata settles it and establishes SDC's
vocabulary — each **hole** is a "terminal": *"common terminals are any set of terminals
which are interconnected: for instance, the two terminals at 6R, the six at M10, or the four
at 3com."* `[verified]` ERRATA, first column.

**The six COMMON blocks are six isolated nodes, not a bus.** `[verified]` — Book VI's Secret
Code wires `1com/2L, 2com/3L, 3com/4L, 4com/5L, 5com/6L`, which would short every relay arm
together on a single node, and its starred-connection paragraph says interchanging which
`com` a wire lands on generates 63 different codes, which is impossible on one node. The
warning *"Be sure though, that there are connections to each of the six common terminals"*
is the footnote at the bottom of BK56 Book VI printed **p.51**, under the Secret Code
program. `[verified]`

Any interconnected hole set can be used as a routing junction to work around a shortage of
long wires: to make `1X/6A`, use `1X/4R` + `4R/6A`, or `1X/4com` + `4com/6A`. `[verified]`
ERRATA. The netlist model must therefore treat every jack as a node with N holes — 2
normally, 4 at COMMON, 6 at a matrix point. `[verified]` BK1 printed p.4: *"Each terminal has
two holes side-by-side which are connected together underneath the computer panel.
Programming wires may be plugged into either (or both) holes of the terminal."*

---

## 6. CAPACITOR terminals, ×6

A two-hole jack per section beside the COMMON block, addressed `1cap` … `6cap`. `[verified]`
PHOTO magnified crop; BK7 printed p.11.

Book I (August 1961) reserves them: *"The terminals marked CAPACITOR are used when auxiliary
components are added to the MINIVAC 601 in advanced programs. At present these terminals may
be ignored."* `[verified]` BK1 p.25. **Nothing in Books I–VI uses them.** `[verified]`

Book VII (1962) fills them in. All Book VII claims carry the 601/6010 scope flag.

| Fact | Detail |
|---|---|
| Values | Sections 1–5: **500 µF**. Section 6: **1000 µF**. `[verified]` BK7 printed p.10, page image **(601/6010)** |
| Wiring | *"Since one end of the capacitor is permanently connected to the negative power source … No connection need be made between the capacitor and negative power."* The panel jack is the single free plate. `[verified]` BK7 printed p.11 **(601/6010)** |
| Purpose | *"Because capacitors can store and release electric energy, they can be used to turn relays on and off. This is their principal application in MINIVAC circuits — providing the voltage changes required to pull in or drop out a biased relay."* `[verified]` BK7 p.11 **(601/6010)** |
| Notation | A resistor may substitute for a wire: `(1+/Ω220, Ω220 1/cap)` means "use a 220 ohm resistor to make the connection between 1cap and 1+". `[verified]` BK7 p.11 **(601/6010)** |
| Voltage rating | Not given. Book VII warns only that exceeding a capacitor's rating destroys it. `[verified]` BK7 **(601/6010)** |

They are **not** contact protection and **not** slow-release elements. A charged capacitor
across a coil injects a surge past pull-in; a discharged one absorbs energy and drops the
coil below drop-out; in both cases the bias voltage then holds the new state. `[verified]`
BK7 p.11 **(601/6010)**.

Whether the six capacitors are factory-fitted in a base 601 or arrive with an accessory kit
is **not settled by the sources**, and this file does not lean either way. On the "kit" side:
Book VII's own footnote "the highest valued resistor in the kit" proves a *resistor* kit
shipped as a separate article, which weakens the argument-from-symmetry for factory-fitted
capacitors. On the "factory" side, and untouched by that footnote: BK7 printed p.11's *"Since
one end of the capacitor is permanently connected to the negative power source … No connection
need be made between the capacitor and negative power"*, and BK7 printed p.10's present-tense
*"the capacitors for sections 1 through 5 of the MINIVAC are 500 micro-farad capacitors"* —
with no purchase or installation instruction anywhere in Book VII. `[verified]` BK7 printed
pp.10–11, page images. The 601/6010 scope flag bites hardest here: the machine those sentences
describe may be the 6010. `[unverified]` A Books I–VI-faithful build may treat `1cap`…`6cap` as
unconnected two-hole junctions and be correct for the whole base manual set. `[verified]`

Electrolytic construction (polarised, hence the fixed negative end) is an inference from the
values, the date and the fixed-end wiring. `[unverified]`

---

## 7. Power supply

### 7.1 Published numbers — the complete set

| Quantity | Value | Cite |
|---|---|---|
| Mains input | 110 V AC | `[verified]` BK1 printed p.3; MAINT p.3 step 4 |
| DC output, nominal | 12 V | `[verified]` BK1 p.3; MAINT printed p.2 |
| DC output, **unloaded** | ≈ 13 V | `[verified]` MAINT printed p.3, step 3 |
| Continuous rating | 1.5 A | `[verified]` MAINT printed p.2 |
| Switch rating | 3 A | `[verified]` MAINT printed p.2 |
| Relay contact rating | in excess of 3 A | `[verified]` MAINT printed p.2 |
| Lamps | operated below rated voltage | `[verified]` MAINT printed p.2 |
| Drive motor | operated at less than ⅓ rated voltage | `[verified]` MAINT printed p.2 |

**That is the entire published electrical record for the machine itself.** `[likely]` — a
negative existential over OCR text layers, re-run whitespace-insensitively (`tr -d ' \t'`)
this pass over **all six** documents, not just Books I–VI. Books I–VI return only the 110 V
AC / 12 V DC sentences plus an unrelated analogue-computer passage in Book III. Book VII
does carry ohm figures, and they are named here so the negative is honestly scoped: a 92 Ω
colour-code worked example and an optional user-added 15/22/33 Ω resistor to slow the motor
(BK7, 601/6010) — neither is a specification of a MINIVAC part. Nowhere in any of the six is
there a coil resistance, a lamp resistance, a pull-in or drop-out voltage, a source
impedance, a transformer or rectifier rating, or a breaker trip current. Not `[verified]`:
these OCR layers exclude all figure text, so absence from them is strong evidence and not
proof (the rule stated at rotary.md §2 for the detent negative).

### 7.2 Topology

Read directly off the *Power Supply Circuit Diagram*, MAINT printed p.3 (PDF p.5), by three
agents independently:

```
POWER CORD ─ POWER SWITCH (in one black primary leg) ─ TRANSFORMER primary
TRANSFORMER secondary, CENTRE-TAPPED:
    two YELLOW/BLACK end leads ──▶ two diodes inside one RECTIFIER block ──▶ + terminal
    YELLOW centre tap ──▶ CIRCUIT BREAKER ──▶ − terminal
POWER LIGHT across the + and − output nodes (downstream of the breaker)
```

`[verified]` Full-wave centre-tapped. **No filter capacitor is drawn anywhere.**
`[verified]` as "absent from the drawing" — this is a troubleshooting diagram, not a
manufacturing schematic, so absence from the drawing is strong but not conclusive evidence
of absence from the chassis. That no filter capacitor exists in the machine is `[likely]`.
(The argument-from-the-spare-parts-list is worthless and is withdrawn: that list also omits
the two motor-drive resistors, which the same manual three pages earlier tells you to test
and replace.)

Consequences the topology forces:

- **The circuit breaker is in the DC return** and carries the total current of every load.
  Model it in series with the whole negative rail and trip it on total current, never
  per-branch. `[verified]`
- **A tripped breaker extinguishes the POWER light** along with everything else, because the
  power light sits on the breaker's downstream side. MAINT printed p.4 step 9 names the
  breaker's two terminals as "the terminal which leads to the transformer" and "the terminal
  which leads to the power light". `[verified]`
- If there is no filter, the rails are unsmoothed 120 Hz pulsating DC dipping toward zero
  every 8.33 ms. `[unverified]` — a consequence of an unproven absence.

### 7.3 Rails, breaker, controls

- **All + terminals are one node and all − terminals are one node, including M+ and M−.**
  *"All + and − terminals are connected together. For example, a connection to 1+ is the same
  as a connection to 3+, 6+, or M+. Similarly, a connection to 2− is the same as a connection
  to 4−, 5−, or M−."* `[verified]` ERRATA, opening notes. Two global nodes; do not model
  per-section rails. Book I corroborates for the six section pairs: *"This low voltage DC is
  used to power MINIVAC and is connected to all terminals + and − on the power panel."*
  `[verified]` BK1 printed p.3. The errata is the only source that extends the identity to
  **M+ and M−**, which is why it is load-bearing rather than cosmetic — a reader who descopes
  the errata falls back to the weaker Book I statement, not to nothing.
- **Closed-circuit principle.** Every component needs at least two connections to operate;
  the manuals teach a strict closed-circuit model. `[verified]` BK1 printed p.4.
- **Circuit breaker**: a red pushbutton above the power switch. It trips on overload or
  short, "just like a household fuse"; a short circuit is "+ wired directly to − without a
  component in between"; restore by correcting the wiring and pushing the button back in; do
  not hold it in if it keeps blowing. `[verified]` BK1 printed p.3. Spare part 6431, $1.00.
- **Power control**: a two-position ON/OFF switch, called "the POWER SWITCH" by SDC.
  `[verified]` BK1 p.3. Photographs show a red vertical slide actuator with ON above OFF —
  but no source uses the word "slide" for it, so that word is `[likely]`, not verified.
- **Power light**: red, shows when power is ON, wired across the DC output as a replaceable
  light assembly. `[verified]` BK1 p.3; MAINT printed p.4 step 8. The POWER strip runs, top to
  bottom: power light, the silkscreen legend `CIRCUIT BREAKER`, the red breaker pushbutton,
  then the ON/OFF switch. `[verified]` PHOTO, both Commons units at native resolution; BK1
  printed p.3 ("The red button above the power switch labeled CIRCUIT BREAKER"). Both
  photographed 601s carry an identical breaker under that legend and differ **only** in the
  top position: one has the red pilot jewel, the other a black bayonet cap engraved `FUSE`
  **four times radially** (roughly 12, 3, 6 and 9 o'clock, the 6 o'clock instance inverted)
  around **two** short curved rotation arrows. `[verified]` — panel.md §7.4 / PH2
  (`commons-minivac601-main.jpg`) at 8×, re-confirmed on a native-resolution crop this pass.
  That is the read of record; the earlier three-repetition count from verify-panel V-R01 is
  superseded and must not be reinstated.
  **The factory part is a Light Assembly**, not a fuse — MAINT printed p.3's Power Supply
  Circuit Diagram draws a POWER LIGHT and no fuse anywhere, MAINT printed p.4's fault tree
  walks breaker → power light → power switch → transformer → rectifier and never mentions
  one, MAINT printed p.11 lists 6435 Light Assembly and no fuse part, and a grep for "fuse"
  across all six OCR extracts returns only BK1 p.3's household-fuse simile. `[verified]`
  That *this particular cap* is an owner replacement of a burnt-out power light is an
  inference about one photographed unit — supported (the holder is oversize and obscures the
  `CIRCUIT` of the legend below it, which a factory fit would not do) but not settled.
  `[likely]`; see open-questions.md O-P5, which carries "pilot jewel vs fuseholder" as an
  open question closable only by panel photographs of several dated units. No netlist
  consequence either way: the POWER block has no jacks.
- **Motor-drive resistors**: two of them, in the rotary-switch motor circuit. Stated purpose,
  verbatim: *"The electrical resistors used with the motor drive limit the current which flows
  through the circuit in the same way that the lights limit the amount of current which flows
  through a relay coil. The resistors make it possible to connect a short circuit across the
  STOP terminals to stop the motor without over-loading the power supply."* `[verified]`
  BK1 printed p.22. Maintenance test: "The resistors should heat up in about 20 seconds."
  `[verified]` MAINT printed p.10. **Values are not given anywhere.** `[verified]`

That STOP-terminal sentence is load-bearing beyond the motor: SDC states that a deliberate
short between two panel terminals is harmless *because series resistors are present*, while
the errata states that a programming short trips the breaker. Both are "the user joined two
terminals with a wire". Only computed branch current separates them. `[verified]`

### 7.4 Source impedance

**Not settled by the sources.** The often-quoted 0.67 Ω is `(13.0 − 12.0) / 1.5`, which reads
"nominal 12 volts output" as the *measured terminal voltage at rated current*. No source says
that; it is the conventional way to state a supply rating, but SDC does not state it.
`[unverified]`

What is `[verified]` is that the supply is **not** stiff enough to be ignored: SDC published a
lamp-bypass circuit whose stated purpose is to get "full voltage" to the coils, and a second
fix of the same shape for the Book V elevator. Model the supply as a Thévenin source with
non-zero resistance; **do not set it to zero**, or loads stop interacting and both documented
failures become unreachable. Fallback value 0.67 Ω, tunable, sane range 0.3–1.5 Ω.
`[unverified]`

### 7.5 Spare parts — the only handle on component identity

| Part | Description | 1961 price |
|---|---|---|
| 6431 | Circuit Breaker | $1.00 |
| 6432 | Slide Switch | $0.50 |
| 6433 | Rectifier | $3.00 |
| 6434 | Transformer | $10.00 |
| 6435 | Light Assembly | $1.00 |
| 6436 | Pushbutton Switch | $0.75 |
| 6437 | Relay | $6.00 |
| 6471 | Motor | $4.00 |
| 6472 | Drive Wheel Assembly | $2.00 |
| 6473 | Complete Rotary Switch Assembly | $20.00 |
| 6490 | Set of 100 Programming Wires | $12.00 |
| 6491 | Set of 2 test wires with clips | $1.00 |

`[verified]` MAINT printed p.11. No specification accompanies any entry. Whether the
rectifier is selenium or silicon is `[unverified]`; the $3.00 price is expensive for two 1961
silicon diodes and cheap for a selenium stack, which is a hint and nothing more.

---

## 8. Electrical model — what the sources force, and the named fallback

### 8.1 The ruling: a DC resistive network, not boolean connectivity

Boolean connectivity is not merely less faithful; it cannot express behaviours SDC published.
`[likely]` — the facts below are verified, the conclusion is inference.

- **The decisive case.** The original Book IV three-bit counter (printed p.72) and the
  errata's alternate counter have **identical boolean connectivity** and different published
  outcomes. In both, all six C terminals are chained to the negative rail; in both, each
  relay's lamp spans the same two nodes and both nodes are reachable. The only difference is
  that the alternate adds **three contact bypasses, one each for relays 1, 3 and 5** —
  `2G/2N + 2L/2-`, `4G/4N + 4L/4-`, `6G/6N + 6L/6-` — which, with the pre-existing
  `1E/2G`, `3E/4G`, `5E/6G`, put a ~0.05 Ω contact in **parallel** with each odd relay's
  indicator lamp on the coil's return leg. Relays 2, 4 and 6 already had such a bypass in the
  original. `[verified]` — both wire lists and both published outcomes read off the page
  images. That nothing short of a conductance solve tells the two circuits apart is the
  inference drawn from them.
- A cheap patch of the form "a coil driven through N lamps is degraded" fails: both counters
  put exactly one lamp on the coil path. `[verified]` for the lamp count in both wire lists;
  the adequacy verdict on the patch is inference.
- The STOP-terminal statement (§7.3) is `[verified]` BK1 printed p.22. That satisfying it
  needs computed branch current rather than connectivity is inference.
- The breaker is in the DC return and carries total current. `[verified]` MAINT printed p.3.
- The whole of Book VII — continuous coil voltage, two thresholds, per-relay
  characterisation — is `[verified]` BK7 printed pp.6–9, page images (601/6010). That it is
  inexpressible without a modelled coil voltage is inference.

Descoping Book VII does **not** let the core fall back to boolean: the counter, the elevator
fix, the breaker and the C-vs-E lesson are all Books I–IV plus errata. Hysteresis survives
the descope too. `[likely]`

**What a net is.** A node in a conductance graph, not a boolean equipotential class.
Union-find over patch wires and currently-closed contacts; two-terminal elements (coils,
lamps, resistors, capacitors, motor, source) span two nodes and are **never** collapsed. So
`1C` and `1E` are always distinct nodes even though the lamp joins them, and `1+` and `3+`
are always the same node. `[likely]`

Degenerate cases: a node with no conductive path to the source is **floating** — do not treat
floating as grounded. Power-on is an **initial condition, not a clamp**: armatures initialise
de-energised (`t = 0`), then the first network solve runs normally and may immediately pull
some of them in. Do **not** hold relays OFF after that solve — §8.2's AT-04 has "120 Ω and
below pull in at power-on", and Book VII's whole bias-resistor acceptance criterion is *"Turn
power on. If the relay remains OFF (the light will remain off), place a check in the RELAY OFF
column"* `[verified]` BK7 printed p.9, a test that only means anything because a too-small bias
resistor makes the relay come on at power-on. Clamping destroys the Book VII bias search.
Breaker trip opens the entire negative return, so all rails die at once
and the power light goes out; requires an explicit reset. `[verified]`

### 8.2 Named fallback profile: MV601-REF-A

**This is an engineering decision, not a research result.** SDC published zero relay and lamp
parameters and made the owner measure. Every number below is inference, individually tagged,
and belongs in one named constants table with load-time assertions.

| Symbol | Value | Tag | Basis |
|---|---|---|---|
| `V_oc` supply open-circuit | ≈ 13 V read; **modelled as 13.0** | `[verified]` for the reading, `[unverified]` for the extra digit | MAINT printed p.3, verbatim: *"The unloaded power supply outlet voltage should be **approximately** 13 volts."* The modelling choice to carry it as 13.0 is ours, not SDC's |
| `R_src` source resistance | 0.67 Ω | `[unverified]` | §7.4; must not be zero |
| `R_coil` | 150 Ω | `[unverified]` | chosen from the 1.5 A current budget |
| `R_lamp(I)` | `R_hot·(I/I_hot)^0.36`, clamped to `[R_cold, 2·R_hot]`, with `R_hot` = 160 Ω at 81 mA, `R_cold` = 18 Ω | `[unverified]` | tungsten power law, anchored to "one lamp across the rail" — a *sanctioned* operating point per MAINT p.6 |
| `V_pullin` | 6.5 V nominal | `[unverified]` | see §8.3 |
| `V_dropout` | 2.5 V nominal | `[unverified]` | ratio 0.38, "great difference" per BK7 |
| `dV_relay` per-relay threshold offset | ±0.30 V, drawn once per relay instance from a fixed seed and applied to `V_pullin` and `V_dropout` **together** | `[unverified]` | Book VII's blank six-row bias chart is primary evidence the relays differ (BK7 printed pp.8–9: *"THIS PROCEDURE MUST BE CARRIED OUT FOR EACH INDIVIDUAL RELAY"*). Bounded **above** by AT-01 — 6.5 + spread must stay under the 6.92 V the lamp-fed Book I Experiment 9 latch delivers, i.e. ≤ +0.42 V — and **below** by the requirement that Book VII's per-relay procedure be necessary at all. Not an explanation of §8.3 |
| `R_contact` closed | 0.05 Ω | `[unverified]` | nominal; keeps the matrix conditioned |
| `R_wire` | 0.02 Ω | `[unverified]` | nominal |
| `I_trip` | 1.5 A, thermal (time-current curve, instantaneous above ~3×) | `[unverified]` | no source connects the supply rating to the trip point |

Three dimensionless ratios are the load-bearing part; the ohms follow from the current
budget:

- **α = lamp divider ratio** = `R_coil / (R_coil + R_lamp_series + R_src)` ≈ 0.53 — the
  fraction of rail a coil gets when driven through its own indicator lamp.
- **β = V_pullin / V_oc** ≈ 0.50.
- **γ = V_dropout / V_oc** ≈ 0.19.

**A correction that matters.** An earlier draft proposed the series lamp at ~40 Ω against a
185 Ω coil, i.e. α ≈ 0.82. At that ratio the coil sees 10.7 V against a 7.5 V pull-in — 42%
margin — so the Book IV counter always works and the only relay failure SDC ever documented
is silently erased. The lamp must be **comparable to or larger than** the coil in the series
path. `[likely]` (The arithmetic stands; the supporting appeal to SDC's word "limit" does
not — "limit" carries no magnitude.)

**Acceptance tests the profile does satisfy:**

| ID | Test | Result under MV601-REF-A |
|---|---|---|
| AT-01 | Book I Experiment 9 latch pulls in and holds *through the lamp* | loop 281.7 Ω, 46.2 mA, `V_coil` 6.92 V > 6.5 V pull-in. PASS. Fails first if pull-in is raised above ~6.9 V |
| AT-04 | A common 1961 resistor lands the coil inside the band | E12 sweep at 13 V into 150 Ω: 180, 220, 270, 330, 390, 470 Ω all land strictly inside (2.5, 6.5); 150 Ω sits at pull-in, where the descending search terminates; 120 Ω and below pull in at power-on. Reproduces BK7's "more than one value may qualify" without being asked to |
| AT-05 | Six coils + lamps stay under 1.5 A | 0.844 A worst realistic case, 44% headroom. Driving all six coils at E while lighting thirteen lamps reaches 1.57 A and does trip — reachable by an unusual program, not by a normal one |
| AT-06 | Dead + to − short trips immediately | 13.0/0.67 = 19.4 A, ~13× trip |
| AT-07 | `1X/1E` operates the relay with the lamp dark; `1X/1C` operates it with the lamp lit | trivial under a network solve, impossible to get right by accident under a boolean core |
| AT-09 | Breaker trip extinguishes the POWER lamp until reset | free and `[verified]` from §7.2 |
| AT-10 | Short across the STOP terminals is harmless; short across + and − trips | `[verified]` from §7.3 |

### 8.3 The unresolved core of the electrical model

**Why the Book IV counter's lamp-fed relays fail when Book I Experiment 9's lamp-fed relay
does not is NOT settled by the sources.** This is the single largest open question in the
electrical model, and earlier drafts got it wrong.

- The counter's odd relays (1, 3, 5) are driven exactly as Experiment 9's relay is: coil in
  series with one indicator lamp across the rail. Same α, same voltage. `[verified]`
- Rail sag cannot be the discriminator. On the profile's own numbers the light-load coil sees
  6.92 V and the fully loaded coil 6.62 V — a 0.29 V window. Making four of six relays fail
  in that window while none fails at 6.92 V demands a per-relay spread of ±0.15 V, not the
  ±0.7 V an earlier draft declared; at ±0.7 V, about one relay in six would fail Book I
  Experiment 9, which SDC presents as reliable. `[unverified]` — this is **arithmetic over
  unsourced constants** (`R_coil`, `R_hot`, `R_src` are all invented and all `[unverified]`),
  so 6.92 V, 6.62 V, the 0.29 V window and the ±0.15 V spread all inherit their tag. What
  survives independently of the numbers is the *internal-consistency* argument — whatever the
  true constants, a spread wide enough to fail four of six counter relays cannot also leave
  Experiment 9 reliable — and that argument alone is `[likely]`.
- Book I Experiment 8 step 5 tells beginners to drive **all six** coils through their lamps
  simultaneously, with no caveat. So "six coils through lamps" is not itself a marginal
  condition. `[verified]`

**Best-supported hypothesis: it is a timing effect, not a DC threshold effect.** `[unverified]`
SDC attaches speed warnings to precisely these circuits and no others — "push pushbutton 6
slowly" on the Book IV flip-flop, "hold the pushbutton down long enough for any carry to
propagate to the highest stage" on the counter. In Experiment 9 the user holds the button
until the relay latches; in the counter a relay must pull in inside a carry window set by
another relay's transfer. A lamp-fed coil has a longer L/R rise to pull-in current, so it
loses races it would win given time. "Full voltage … causing them to pull in more reliably"
reads as much like a speed statement as a threshold statement.

Consequence for planning: relay actuation and release times move from "nice to have, defer
with the capacitors" to **required for the Books I–VI milestone**. `[unverified]`

**Superseded 2026-09-01 — the section above is left as read; nothing in it is deleted or
rewritten.** `docs/DECISIONS.md`'s *canonical marginal-counter ruling after W1* governs the
simulator claim.

| Clause above | Status after W1 |
|---|---|
| *"Best-supported hypothesis: it is a timing effect, not a DC threshold effect."* | **Refuted in this implementation, not as a hypothesis about physical relays.** W1 did not observe the proposed simulator mechanism across the tested `L_coil` range. The corpus still has no bench measurement that could settle timing, relay variation, contact transfer or another real-machine explanation. |
| The internal-consistency argument | **Narrowed, and still standing.** Book I Experiment 8 step 5 as printed extends the chain to all six relays, drives every coil through its indicator lamp, and lights **one** binary output lamp at the end. That verified program rules out treating *six lamp-fed coils under that printed load* as sufficient for marginality. It does not establish reliability under arbitrary output-lamp load, and it does not identify the Book IV counter's cause. |

### 8.4 Solve procedure

1. Union-find over patch wires and currently-closed contacts to build the node set. Elements
   are never collapsed.
2. Stamp conductance matrix `G` and current vector `i`. Ground the − node. Stamp the source
   as a Thévenin pair (`V_oc`, `R_src`) between + and −.
3. Solve `G v = i` by dense LU. ~60 nodes, ~30 two-terminal elements — microseconds. This is
   not a SPICE-scale problem.
4. **Inner fixed point** for lamp non-linearity: recompute each `R_lamp` from its own current
   and re-solve. 3–5 passes; damp if it oscillates.
5. Evaluate relays with **hysteresis**: `V_coil ≥ pull_in` → energise; `V_coil ≤ drop_out` →
   de-energise; otherwise **hold previous state**. The hold branch is what makes Book VII
   expressible.
6. If any relay changed state, contacts changed — repeat. Cap the iterations. Non-convergence
   is **not** an error: it is a real oscillator. Report it and time-average the display.

Book VII capacitors need real time-stepping against the coil and any series resistor; gate
that behind a flag. Books I–VI contain no reactive element. If there is no filter capacitor,
a Book VII capacitor across the rails charges toward the **peak**, not the average, which
materially changes its kick energy. `[unverified]`

---

## 9. Timing

### 9.1 Stated figures

**No relay operate time, release time, contact-bounce figure or coil time constant appears
anywhere in Books I–VII, the Maintenance Manual or the Errata.** `[likely]` — searched
independently by three agents and re-run whitespace-insensitively this pass, but it remains
a negative existential over OCR text layers that exclude all figure callouts, and absence
from such a layer is not proof (rotary.md §2's rule for the detent negative). Nothing found
contradicts it; no exhaustive page-image sweep of all six documents backs it.

The corpus is *not* free of all timing figures. These exist and are none of them relay data:

| Figure | Source |
|---|---|
| Rotary switch turns 45 full revolutions per minute (16 positions ⇒ ~83 ms/position) — explicitly an *assumption inside a worked example*, and the same procedure tells the owner to count their own machine's revolutions | `[verified]` BK56 Book V printed **p.7** (= book5-6.pdf PDF p.13; folio checked against the "6" on PDF p.12 and the "8" on PDF p.14). Printed p.6 carries only the automobile-speed-timer wire list — the frequently repeated "p.6" citation is off by one |
| "the rotary switch system requires more than a second to go from zero to nine" (⇒ >~111 ms/position) — a rhetorical comparison, not a spec | `[verified]` BK2 Book II printed p.8 |
| The motor-drive resistors "should heat up in about 20 seconds" | `[verified]` MAINT printed p.10 |

**The two rotary figures disagree.** `[verified]` — both are read above, and 83 ms/position
against >111 ms/position cannot both be right. Keeping dial speed configurable with 45 rpm as
the default is therefore a **named fallback, not a finding**: it is the one number SDC prints,
inside a worked example that in the same breath tells the owner to count their own machine's
revolutions. See open-questions.md **O-R3** (`run_rpm = 45.0`, "labelled an assumption"),
which this file instantiates and must not restate at a different value.

Qualitative statements that constrain the model:

- *"try carrying out the procedure slowly; some programs are not designed for high-speed
  operation."* `[verified]` ERRATA, troubleshooting step 2.
- *"push pushbutton 6 slowly when operating the single-input flip-flop. Light 6 will go off
  and on, indicating the state of the whole flip-flop."* `[verified]` ERRATA, Book IV p.69.
  This note attaches to the **first-version** flip-flop assembled over Book IV pp.68–69
  (`IV-FF1`), not to the second version, and it is the circuit the timing profile's "must
  misbehave when hammered" half is proved against. `[verified]` — programs.md **C-23**, on a
  full read of `book2-3-4.pdf` PDF pp.74–76, re-confirmed against the printed p.69 page image
  in this pass. Three independent legs: (a) the erratum is filed at printed p.69 = PDF p.75,
  which carries `IV-FF1`'s build stages 2–4 and its SINGLE-INPUT FLIP-FLOP CIRCUIT diagram,
  while `IV-FF2`'s program, diagram, caption and all three numbered steps sit wholly on
  printed p.70 = PDF p.76; (b) `IV-FF1`'s stage-4 wires are `6G/6A`, `6B/6—`, added under
  *"we will add an indicator light to show what state the flip-flop is in"*, so light 6 **is**
  its indicator, exactly as the erratum describes; (c) `IV-FF2`'s own printed text on p.69
  refutes the note for itself — *"light 6 is not used as an indicator in this program"*. The
  earlier hedge (that the errata never names a version and p.69 carries both) is withdrawn:
  it does not survive leg (b) or leg (c).
- *"When pushing pushbutton 6, be sure to hold the pushbutton down long enough for any carry
  to propagate to the highest stage of the counter."* `[verified]` ERRATA, Book IV p.72. Note
  it is a **hold** instruction: the ripple happens while the button is DOWN.
- The Morse-dot note (§2) bounds visible lamp lag: short relative to a dial dwell, long enough
  that fast successive flashes blur. `[verified]`
- No astable circuit is published anywhere in Books I–VI, Book VII or the errata; the only
  oscillator in the machine is the rotary motor. `[likely]` — a negative existential over OCR'd
  program tables; the self-interrupting pattern was re-searched and every occurrence turned
  out to be the flip-flop "slave relay shorted out when OFF" idiom. The simulator still needs
  to *detect and report* a non-settling relay, because user wiring can make one.

### 9.2 Contact transfer semantics

| Family | Break-before-make? |
|---|---|
| Pushbutton | **Stated explicitly**, with a demonstrated dead zone. `[verified]` BK1 p.9 |
| Rotary switch | **Stated explicitly**, in the same language. `[verified]` BK1 p.21 |
| Relay | Never stated. Described as a single arm swinging between two fixed stops — "Notice how the arm leaves the normally-closed contact and swings over to touch the normally open contact" — and the arm-pressure adjustment describes the same geometry, which cannot make before it breaks. `[likely]` BK1 p.12; MAINT p.8 |
| Slide switch | Never stated. `[likely]` (absence) — two full reads of BK1 pp.17–19 and MAINT found nothing, but this is a negative existential over an OCR layer that excludes figure text, so it is not `[verified]` (rotary.md §2's rule). Fallback: break-before-make, §4 |

### 9.3 Named fallback: MV601-TIMING-A

**Structure first — that is where the confidence is.**

- **A fixed 100 µs integer tick.** Reproducible and bit-exact across platforms, trivially
  interleaved with a 60 Hz render loop and with continuous inputs (a partly depressed button,
  a hand-retarded dial). A "skip to the next scheduled event when nothing is moving"
  optimisation is safe. `[unverified]`
- **Freeze contacts, solve once, then advance armatures.** No element in the MINIVAC closes a
  loop from a node voltage back to a contact position in zero time, so with contacts frozen
  the per-tick network is a static graph: no iteration, no fixpoint ambiguity, no settling
  algorithm. `[unverified]` — this is a consequence of the tick being ~2 orders of magnitude
  below the shortest device latency, not an independent structural result. State that
  dependency: a coarser tick brings the settling question straight back.
- **Intra-tick determinism rule** (the thing the model actually has to guarantee): simultaneous
  threshold crossings are resolved simultaneously. Freeze all contacts, solve once, advance
  **all** armatures from that one solution. An implementer who mutates contacts *inside* the
  armature-update loop instead of after it silently reintroduces order dependence.
  `[unverified]`
- **Armature as a continuous travel scalar** `t ∈ [0,1]`, moving toward 1 at `1/t_operate`
  above pull-in, toward 0 at `1/t_release` below drop-out. Inside the bi-stable band the
  rule is *not* a literal freeze: an armature already at a stop stays there (`t = 0` holds 0,
  `t = 1` holds 1), but an armature strictly between the stops is not in equilibrium and
  continues in its current direction of travel until it reaches one. The band exists because
  magnetic force varies with the core-to-armature gap — *"for a given voltage, the smaller
  the gap, the greater the magnetic force. Since the gap on a closed relay is very small,
  less voltage is required to hold it in than is required to pull it in"* `[verified]` BK7
  printed p.6 — so it is a property of the two end positions, and a literal freeze at
  `t = 0.4` would park the arm inside the both-open window indefinitely, which the mechanism
  cannot do. Contacts: N.C. closed while `t < break_frac`, N.O. closed while
  `t > make_frac`; the interval between them is the both-open window. One parameter set then
  yields operate time, release time, both-open interval, interrupted-stroke behaviour and
  marginal-bias behaviour with no special cases — and the same machinery gives the pushbutton
  and slide switch for free, which is what makes BK1 p.9's "find the position where both
  lights are OFF" directly reproducible. `[unverified]`
- **Two release rates.** Every flip-flop in the corpus turns a relay OFF by putting the same
  potential on both ends of an energised coil, not by opening it. Electrically that is a
  freewheeling loop decaying on L/R rather than collapsing into an open circuit — the slow
  "slugged relay" effect, typically 2–5×. Select the rate per tick from live connectivity
  (the short opens partway through the stroke when the arm leaves its contact).
  `[unverified]` The *mechanism* is standard; the claim that it alone explains the "push
  slowly" errata is not supported — the same file's own trace attributes that failure to the
  slave relay's **operate** stroke on alternating presses. Both are true, on alternating
  presses.

**Parameters** — every one a tunable constant in one place. No relay, contact or lamp figure
here is source-derived; the two exceptions in the table are `rotary_default_rpm` (BK56 Book V
printed **p.7**, and see §9.1 for the conflicting Book II figure) and the 120 Hz ripple frequency,
which follows from the 110 V AC mains and the full-wave rectifier (§7.2).

| Parameter | Value |
|---|---|
| `tick_us` | 100 |
| `relay_operate_ms` | 12.0 |
| `relay_release_open_ms` | 8.0 → **raise to 10.0** if ripple is ever enabled (see R5) |
| `relay_release_shorted_ms` | 20.0 |
| `relay_break_frac` / `relay_make_frac` | 0.35 / 0.60 |
| `relay_bounce_on_make_ms` / `on_break` | 0.5 / 0.0 |
| `relay_pull_in_v` / `drop_out_v` | 6.5 / 2.5 — MV601-REF-A is the single source of these two constants; §9.3 must not restate them at a different value. (A 7.5 V pull-in is refuted by this file's own AT-01: the Book I Experiment 9 latch delivers only 6.92 V through its own indicator lamp) |
| `pushbutton_travel_ms` (default press) | 25.0 |
| `pushbutton_break_frac` / `make_frac` | 0.35 / 0.60 |
| `slide_switch_travel_ms` | 60.0 |
| `rotary_contact_arc_deg` / `dead_gap_deg` | **16.875 / 5.625** (gap fraction 0.25) — UNIFORM-CONTACTS / the QUARTER-GAP CONTACT MODEL (rotary.md §2.1, open-questions.md O-R1, jack-map.md §8 row 8) is the single source of these two constants; this block must not restate them at a different value. The 18.0 / 4.5 shipped in an earlier draft is a gap fraction of 0.20 and was a silent divergence, not a second choice |
| `rotary_default_rpm` | 45.0 — the named fallback of open-questions.md O-R3, an assumption, not a measurement (§9.1) |
| `lamp_thermal_tau_ms` / `visual_decay_ms` | 40 / 60 |
| `supply_ripple` | 120 Hz full-wave, **default OFF** |

**Partly superseded — the block above is left as read, the rows below are not what ships.** This
file records what the sources supported at the time of the read; `architecture.md` is what the
simulator implements. Where the two differ, follow the architecture.

| Row above | Superseded by | The ruling |
|---|---|---|
| `relay_operate_ms` 12.0, whole operate | `architecture.md` §4.4 | **Narrowed.** The figure survives as `relay_operate_stroke_us` 12000 but now covers the *mechanical* stroke only: with the coil an R-L branch the electrical rise to pull-in is solved rather than asserted, so the row above bundles two quantities the simulator keeps apart |
| `relay_release_open_ms` 8.0 / `relay_release_shorted_ms` 20.0 | `architecture.md` §4.2 and §4.4 | Both **deleted**. There is no rate selection and no per-tick connectivity test: both release paths fall out of one solve of an R-L coil branch — an open coil collapses in about a tick against the arc clamp (`open-questions.md` **O-E11**), a short-circuited coil freewheels on `L/R_coil`. What remains is a single mechanical `relay_release_stroke_us`, and the "typically 2–5×" ratio above becomes a constraint `tools/check-profile.ts` enforces rather than two literals |
| `lamp_thermal_tau_ms` 40, display-only | `open-questions.md` **O-E12** (`LAMP-THERMAL-R`); `architecture.md` §3.4 | **Promoted.** The same number now governs the filament's *resistance*, not merely displayed brightness — the indicator lamp is in series with its coil (`nC —lamp— nE —coil— nF`, `[verified]` §1.4), so filament warm-up sets coil drive through the first tens of ms. Still `[unverified]`, as here: the promotion adds no number and raises the evidentiary burden on the one it reuses |

The profile schema (`architecture.md` §10.1) carries all of these as **integers in µs** —
`relay_release_stroke_us`, `lamp_thermal_tau_us`, `visual_decay_us` — so no shipped value is a
decimal. The millisecond figures above are this file's reading and stay as read.

**Do not adopt this parameter block until two things are fixed.** `[unverified]` — arithmetic
over unsourced constants, so the conclusion inherits their tag; every number in the block
above is invented. What is `[likely]` independently of the values is the *shape* of both
objections: the wrong stroke is being constrained, and two constraints are self-inconsistent
with their own defaults whatever those defaults are set to.

1. **The both-open constraint (R1) is derived against the wrong stroke, and its physical
   premise is wrong.** The claim was: when relay 1's arm floats mid-transfer, relay 2's coil
   is dead, so `t_bothopen` must be shorter than `t_release`. On the Book II p.12 topology it
   is not dead — node_B floating leaves the two coils in **series** between a live node and
   ground (`POS → node_A → coil1 → node_B → coil2 → node_C → lamps → NEG`), so relay 2 stays
   partially energised at roughly half current. Worse, that series path puts a non-zero
   voltage back across coil 1 while it is mid-release; under a magnitude-only travel model the
   solver arrests and reverses the release, and the canonical flip-flop **chatters** instead of
   toggling. Decide what the solver does with a series path through a floating node **before**
   sizing `break_frac`/`make_frac`. That is a solver-semantics question, not a tuning one.
2. **Two of the five stated constraints fail on the shipped defaults.** The binding transfer
   is the memory relay's *shorted release*, not its operate: float = 0.25 × 20.0 = 5.0 ms
   against relay 2 reaching `break_frac` at (1 − 0.35) × 8.0 = 5.2 ms — margin 1.04×, against a
   stated requirement of 3×. And `relay_release_open_ms` 8.0 < the 8.33 ms ripple half-period.
   An implementer who writes the load-time assertions will not get past startup.

**Ordering constraints** (keep these; they are what make the model correct rather than merely
plausible):

| ID | Constraint | Why |
|---|---|---|
| R1 | both-open window ≪ release time, checked against the **shorted-release** stroke | The memory relay's own arm is the common bottom of both coils in the flip-flop family |
| R2 | minimum button hold > max(`t_operate`, `t_release_shorted`) | The push phase must complete before the release phase evaluates — this is "push pushbutton 6 slowly" |
| R3 | minimum button-up interval > slave relay `t_operate` | The release phase must complete before the next press |
| R4 | minimum hold ≥ the sum along the **actual** carry chain, with the terminating stage contributing `t_operate` when it goes 0→1 | The ripple is serial on the DOWN edge; parallel on the UP edge |
| R5 | `t_operate` and `t_release` both > 8.33 ms *if* ripple is enabled | Otherwise relays chatter at 120 Hz, which the real machine demonstrably does not do |
| R6 | Lamp-in-series must make the counter marginal; lamp bypassed must make it reliable | The only constraint anchored to a **verified** primary statement about observable behaviour (ERRATA Book IV p.72) |

**Falsifiable prediction, corrected.** A brisk tap on pushbutton 6 mis-counts *selectively*.
The serial device-time chain lengths on the down edge are **1, 2, 1, 3, 1, 2, 1, 3** for
0→1 … 7→0: a stage going 0→1 does an operate and emits no carry; a stage going 1→0 does a
shorted release and emits a carry; the hold must cover the terminating operate too. A
marginal tap fails **first** at 3→4 and 7→0, **second** at 1→2 and 5→6, and never at the
even→odd steps. `[unverified]` — this is a **prediction**, not a reading. What is `[verified]`
is the chart it is derived against: SDC's own BINARY COUNTER — SEQUENCE OF OPERATIONS,
BK4 printed p.71, which shows every carry asserted on a DOWN row. The mis-count *ordering*
derived from that chart plus the invented timing constants is unsourced, and open-questions.md
**O-T5** carries this same 1,2,1,3,1,2,1,3 pattern as an open question whose fallback is
"ship it as the falsifiable prediction it is", closable only by video of a real unit being
tapped fast. A unit that instead fails uniformly at all counts kills the
serial-ripple-on-the-down-edge model.

**Human-scale sanity check.** For SDC to have needed a printed warning, the relay timescale
must be an appreciable fraction of a fast tap (~30–50 ms). At 2 ms nobody would ever have
failed; at 200 ms the circuit would be unusable and would have been redesigned. ~20 ms per
stage puts the counter's worst case at ~60 ms: a fast tap fails, a normal press succeeds.
`[unverified]` Do **not** read the frequently quoted "8–40 ms operate" bracket as derived —
the ripple argument bounds *release* dynamics, not operate, and the 40 ms upper is an
unexplained halving of its own dwell bound.

**Where determinism actually comes from.** In the three canonical circuits, at every instant
exactly one relay is being driven to change and topology fixes which — SDC's own description
is master–slave with the button's two edges as the clock phases. `[verified]` BK4 printed
p.68. But the claim that *no* published circuit depends on which relay wins is **refuted**:
Book VI's Reaction Time Tester (printed p.60) exists precisely to decide which of two
near-simultaneous presses came first, and Book VI's Scissors Paper or Stone (printed p.59)
resolves an ordering hazard by instructing the human — *"Player 1 should move just before
player 2 moves since the relays will move after player 2 indicates his move."* `[verified]`
Per-relay variation is therefore **not** an optional fidelity flourish; it is also what
SDC's own "relays which perform to satisfaction in every other case" sentence describes.

---

## 10. Acceptance fixtures

Published circuits with SDC's own stated results. These are the cheapest regression tests
available and every one is `[verified]`.

### MM-PUSHBUTTON-CHECK — MAINT printed pp.6–7

Wiring: `+/Y`, `Z/1A`, `1B/-`, `X/2A`, `2B/-`.
*The page prints `2B` on **both** terminals of light 2; the intended left label is `2A`.
Record the typo, use 2A, do not silently correct the transcription. The lamp returns are bare
minus signs on this figure — the Relay and Slide Switch figures do number theirs.*

| Step | Expect |
|---|---|
| power ON | light 1 ON, light 2 OFF |
| press | light 1 OFF, light 2 ON |
| release | light 1 ON, light 2 OFF *(implied by the momentary button, not stated)* |

### MM-RELAY-CHECK — MAINT printed p.7

Wiring: `+/H`, `+/L`, `+/Y`, `X/E`, `F/-`, `J/1A`, `1B/1-`, `G/2A`, `2B/2-`, `N/3A`,
`3B/3-`, `K/4A`, `4B/4-`. **C and Z are deliberately unconnected.**

| Step | Expect |
|---|---|
| power ON (relay OFF) | lights 1 and 3 ON; 2 and 4 OFF; **relay indicator lamp DARK** |
| press (relay ON) | lights 1 and 3 OFF; 2 and 4 ON; **indicator still DARK** |

The dark indicator is the trap: the coil is driven at E, so the lamp is out of circuit. Note
also that SDC spends *two* separate wires, `+/H` and `+/L`, where one would do if the arms
were common — weak but real isolation evidence inside the very figure that cannot prove
isolation on its own (both arms are tied to + here).

### MM-SLIDE-SWITCH-CHECK — MAINT printed p.8

Wiring: `+/S`, `+/V`, `T/1A`, `1B/1-`, `R/2A`, `2B/2-`, `W/3A`, `3B/3-`, `U/4A`, `4B/4-`.

| Step | Expect |
|---|---|
| slide RIGHT, power ON | lights 1 and 3 ON; 2 and 4 OFF |
| slide LEFT | lights 1 and 3 OFF; 2 and 4 ON |

### BK2-EXP5-DECISION-MAKING — isolation regression

Wiring (BK2 printed p.13): `1+/1H`, `1H/1L`, `1L/1X`, `1Y/1C`, `1F/1-`, `1X/2X`, `2Y/2C`,
`2F/2-`, `1J/2H`, `2J/2K`, `1K/2L`, `2K/3C`, `3F/3-`.
Steps (BK2 printed **p.14**): power ON, both buttons up → relay 3 ON; PB1 only → relay 3 OFF;
PB2 while holding PB1 → relay 3 ON; release PB1 while holding PB2 → relay 3 OFF.
No erratum applies to Book II p.13.

### BK2-EXP6-ARITHMETIC — second isolation regression

Wiring as printed (BK2 printed p.14): `1+/1H`, `1H/1L`, `1L/1Y`, `1Y/2Y`, `2Z/2C`, `2F/2-`,
`1X/1C`, `1F/1-`, `1G/2G`, `2H/2A`, `2B/2-`, `1N/2K`, `1K/2N`, `2L/1A`, `1B/1-`.
**Apply the erratum: change `2Z/2C` to `2X/2C`.** All other wires stand.
Results: power ON → no lights (0+0=0); PB1 → light 1 (1+0=1); PB2 while holding PB1 → light 2
(1+1=2); release PB1 holding PB2 → light 1 (0+1=1). A simulator that ties H to L makes this
read 1+0 = 3.

### BK4-COUNTER-SEQUENCE — golden trace for the timing model

SDC's own tick-by-tick behavioural spec: the chart *BINARY COUNTER — SEQUENCE OF OPERATIONS*,
BK4 printed p.71, with alternating UP and DOWN rows and every carry asserted on a DOWN row.
(The erratum "page 71: chart title incorrect — change *Pushbutton carry* to *Pushbutton*"
confirms which chart.) Regression-test the corrected 1,2,1,3,1,2,1,3 hold-chain lengths
against it.

---

## 11. Corrections applied

Claims from the finder passes that the verifier refuted or downgraded. They are recorded here
as corrections and are **not** carried anywhere else in this file.

| Was claimed | Correction |
|---|---|
| Book I Experiment 8 program contains `1Y/1C`, tagged `[verified]` | It is **`1X/1C`**, read off the page image (BK1 PDF p.18). With `1Y/1C` the pushbutton is bypassed and relay 1 is latched ON at power-up, destroying the experiment |
| "NO timing numbers ANYWHERE in the corpus", `[verified]` | Refuted. Rotary-speed figures and the 20-second resistor test exist. The correct claim — no **relay** operate/release/bounce figure anywhere — still stands `[verified]` |
| The Book II single-input flip-flop is on printed p.11 | It is on printed **p.12**; p.11 carries the two-button memory circuit and the prose introducing the single-input one |
| The errata "push pushbutton 6 slowly" note applies to the Book II flip-flop | It applies to the **Book IV p.69 first-version** flip-flop (`IV-FF1`), whose indicator is light 6 `[verified]` — programs.md C-23, on `book2-3-4.pdf` PDF pp.74–76 read in full, re-confirmed against the printed p.69 page image this pass (§9.1). Earlier `[likely]` hedges in this file and in open-questions.md's refuted-claims table were written before those pages were opened; the page read outranks them |
| The pull-in/drop-out definition sentence is on BK7 printed p.7 | It is on printed **p.6**; p.7 carries the graphs and the shaded-region paragraph |
| Book VI's "connections to each of the six common terminals" warning is on p.53 | It is the starred footnote at the bottom of printed **p.51**, under the Secret Code program |
| Supply source resistance 0.67 Ω, `[likely]` | `[unverified]`. The premise — that "nominal 12 volts" is the measured terminal voltage at 1.5 A — is in no source |
| Selenium rectifier; relay break-before-make; C–E alone lights the lamp; capacitors factory-fitted — all `[likely]` | All are the finder's own inference with no secondary corroboration ⇒ `[unverified]` (relay break-before-make survives as `[likely]` on the stronger BK1 p.12 arm-geometry sentences) |
| The POWER control is a slide switch, `[verified]` | The word "slide" is nobody's but ours ⇒ `[likely]`. ON/OFF two-position behaviour and panel layout stay `[verified]` |
| "8 relay connections = 2 coil + 6 contact" was unread inference | **Now read** off the Relay Check figure ⇒ `[verified]`. The residual — C's exclusion from the eight — stays a two-source inference, `[likely]`, on BK1 p.14's "three terminals … two to the coil, the third to a light" plus the figure (§1.1), matching open-questions.md's ruling. An earlier draft of this file upgraded it to "`[verified]` by deduction"; that tag does not exist |
| Lamp rated at 14 V | Invented. Withdrawn. Only "operated at less than their rated voltage" is published |
| Book VII relay claims presented as plain 601 facts | All carry the 601/6010 scope flag (§ Source keys) |
| COMMON terminals isolated, `[likely]` | Upgraded to `[verified]` — the Secret Code program and its starred-connection paragraph settle it |
| The errata's alternate counter differs from the original by tying C to the negative rail | Refuted. **Both** programs chain all six C terminals to the negative rail. The real difference is three added contact bypasses, one each for relays 1, 3, 5 (§8.1) |
| "The bypassed lamp still glows" | Refuted. The bypass is a contact short **across the lamp**; both its terminals sit at the negative rail and it goes **dark** while the bypass conducts |
| The counter's marginality is a rail-sag phenomenon; per-relay pull-in spread ±0.7 V | Refuted — the discrimination window is 0.29 V and the declared spread would break Book I Experiment 9 on a typical machine. Mechanism unresolved (§8.3) |
| "No published circuit depends on which of two relays wins" | Refuted by Book VI's Reaction Time Tester and Scissors Paper or Stone |
| Counter mis-count prediction "3→4 needs two stage-times, 7→0 needs three" | Corrected to **1,2,1,3,1,2,1,3** |
| Relay contact isolation "proved" by the wire `1H/1L` being redundant | That is corroboration, not proof — a daisy chain reaches 1X either way. The proof is Experiment 5's *stated results*, plus Experiment 6 |
| No filter capacitor, argued partly from the spare-parts list | Drop the parts-list leg — that list also omits the two motor-drive resistors, which the same manual tells you to test. The schematic read alone is good evidence, and the conclusion stays `[likely]` |

Errata corrections touching components that earlier passes missed, all `[verified]`:

- **BK1 p.13** (Experiment 6, manual relay operation): circuit diagram incorrect — delete the
  line connecting 1B and 2B.
- **BK2 p.10**: third complete paragraph, second line — change DOWN to ON.
- **BK2 p.14** (Experiment 6): change `2Z/2C` to `2X/2C`.
- **BK4 p.43** (Relay AND circuit): change `2+/2H` to `1G/2H`.
- **BK1 p.24** (motor reversing): diagram label 6Y → 6V. The **program** is unaffected.

Two transcription traps for anyone reading the figures:

- **Crossing solid lines are not junctions** unless a dot is unmistakably larger than the line
  width. In Book II Experiment 5 the wire `2Y/2C` crosses both the 2H and 2L feed lines, and
  at 1000 dpi the crossings show ink thickening that reads as dots. Joining 2C to 2H or 2L
  would energise relay 2 whenever 1J or 1K went live and destroy the experiment. `[verified]`
- The errata's alternate-counter program list is OCR-hostile (`61/6-` is almost certainly
  `6J/6-`, `IF/TH` is `1F/1H`, `lG/l-f` is `1G/1+`). Transcribe it from the page image only.
  `[verified]`

---

## 12. Not settled by the sources

Each carries its named fallback. Every one would be closed by a measurement session on a
surviving unit — that single action would replace most of §8 and §9.

| Question | Fallback | What would settle it |
|---|---|---|
| Relay coil resistance, rated coil voltage, pull-in, drop-out | MV601-REF-A (§8.2), with per-relay spread `dV_relay` = ±0.30 V from a fixed seed | Ohmmeter across E–F plus a bench sweep on all six relays; or a photo of the coil bobbin stamping |
| Lamp voltage, current, bulb number, base | MV601-REF-A's `R_lamp(I)`; anchor the first real measurement by putting one lamp across the rail and reading the current | Pull one Light Assembly and read the bulb |
| Why the Book IV counter's lamp-fed relays are marginal when Book I Experiment 9's is not | Model it as a timing effect (§8.3), not a DC threshold | Pull-in **time** at lamp-divided vs full-rail drive; or a scope on a real carry cascade |
| Relay operate / release time; whether shorted and open release differ | MV601-TIMING-A (§9.3) | Slow-motion or scoped video of a running unit; or identification of SDC part 6437 with a 1961 datasheet |
| Relay break-before-make, and its both-open interval | Model as break → both-open → make | Two-channel scope on H–J and H–G during operate; or a close photo of the contact geometry |
| Contact bounce, any contact | 0.5 ms on make, 0 on break | Scope capture |
| Slide switch transfer semantics | Break-before-make | Continuity test while sliding slowly |
| Whether the slide switch's two sets are isolated | Isolated | Trace the full Book V p.13 program to a truth table |
| Whether the relay coil pair is galvanically distinct from the contact nodes | IDEAL-ISOLATED-COIL (§1.3) | Ohmmeter, or an under-panel photo of the eight lugs |
| Whether a filter capacitor exists in the chassis | No filter; ripple modelled but **default off** | Photo of the underside of the power panel, or a scope on the rails |
| Whether "nominal 12 V" is the loaded figure at 1.5 A | 0.67 Ω, non-zero, tunable | A loaded-rail measurement, or SDC dealer literature quoting load regulation |
| Circuit-breaker trip current | 1.5 A thermal with a time-current curve | Meter/photo of the breaker label |
| Transformer secondary voltage and VA; rectifier technology | — | Meter readings; photo of the transformer and rectifier |
| Motor-drive resistor values | — | Colour-code photo of the two resistors |
| Resistor values in the Book VII kit | MV601-REF-A predicts a useful bias range of roughly 100–700 Ω — falsifiable | A kit parts list or photograph |
| Whether the six capacitors are factory-fitted or a kit | Treat `1cap`…`6cap` as unconnected for Books I–VI | Under-panel photo, or SDC price literature listing a capacitor kit |
| ~~Which physical contact set (front vs rear) is G/H/J and which K/L/N~~ **CLOSED** — BK1 printed p.12: "the set of contacts closer to the operator is connected to the set of terminals closer to the operator", and K/L/N is the operator-side row (§1.1) | Still do not make front-vs-rear identity load-bearing | — |

**Status of two rows above (2026-09-01).** The counter row's timing-effect fallback is research
history, not current simulator guidance: W1 did not reproduce that explanation, the physical
mechanism remains open, and the shipped `L_coil` is retained only for the R-L carried state and
release-path role. The first row's fixed-seed `±0.30 V` spread is superseded as profile guidance by
the Wave D `dV_relay_mv` vector `[-282, -169, -56, 56, 169, 282]`, an `[unverified]` simulator
convention generated by a dated rule in `docs/DECISIONS.md`; it does not describe measured relay
variation or establish a counter mechanism.
