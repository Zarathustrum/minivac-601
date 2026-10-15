# Jack Map — Terminal Inventory and Fixed-Component Netlist

The netlist spec. `src/core` generates its fixed-component netlist from this file. Everything unsettled is in §8 with a named fallback; nothing unsettled is stated as fact anywhere else.

**2026-09-01 W2 implementation clarification.** The sentence above is historical planning
language, not the W2 build rule. W2 hand-authors `data/netlist.json` once from §§1–7; core loads and
checks that artifact's bytes. No runtime or build-time Markdown parser generates the netlist.

## Implementer summary

1. **186 terminals, 392 holes.** Six identical sections of 24 terminals / 50 holes, plus a 42-terminal / 92-hole right column (matrix, power taps, decimal I/O). [unverified — arithmetic over verified per-item counts; no manual states a total]
2. **A terminal is a node with N holes.** Every hole of one terminal is the same node. N = 2 everywhere except `ncom` (4) and `M10` / `M11` (6). A wire may use either or both holes. [verified] — Book I p.4; Errata
3. **Only two internal busses exist.** All seven `+` jacks are one node; all seven `-` jacks are one node. Every other jack is its own node. [verified] — Errata: *"All + and - terminals are connected together. For example, a connection to 1+ is the same as a connection to 3+, 6+, or M+."*
4. **The fixed components are 12 lamps, 6 coils, 30 transfer contact sets, 6 capacitors, 1 rotary wiper, 1 motor, 2 resistors.** Full table in §5. Everything else on the panel — `ncom`, `ncap`'s neighbours, the 20 matrix points — is a bare junction with nothing behind it.
5. **The relay's two contact sets are electrically isolated.** Settled by deduction from two published SDC programs, not by any sentence. Do not tie `nH` to `nL`; Book I p.12 says "The two arms (H & L) are connected together" and means *mechanically*. See §7 and §9.
6. **`ncap` is not a dead jack.** Each section has an installed capacitor with one plate hard-wired to the minus rail and the other brought out to the `CAPACITOR` jack. 500 µF for sections 1–5, 1000 µF for section 6. Whether 1961 601 production shipped them is not settled — §8 row 1, fallback `FITTED-CAPS`. Construction type is stated nowhere in Book VII — §8 row 3, fallback `POLARIZED-ELECTROLYTIC`. [verified for the wiring and values, 601/6010 scope flag] — Book VII p.10–11.
7. **The motor branch has two resistors, not one.** R1 between D17 and D19; the motor *and* R2 both between D18 and D19. A one-resistor model gets STOP, coast and motor voltage wrong. [verified] — Maintenance Manual p.9 figure; Book I p.22 figure.
8. **The panel has no printed ovals or joining bars around section hole pairs.** Printed joining artwork exists only in the MATRIX block. A prior research pass asserted otherwise from a 1536 px photo; the 4208 px photo refutes it. See §10.

---

## 1. Designator grammar

The manuals address terminals by a shorthand; a connection is two designators with a slash between them (`1+/1A`). [verified] — Book I p.5

| Class | Form | Range | Example | Tag | Citation |
|---|---|---|---|---|---|
| Section terminal | `<1-6><letter>` | letters A B C E F G H J K L N R S T U V W X Y Z | `1A`, `6Z` | [verified] | Book I p.4 |
| Section power | `<1-6>+`, `<1-6>-` | 1–6 | `3+`, `5-` | [verified] | Book I p.3 |
| Common junction | `<1-6>com` | 1–6 | `3com` | [verified] | Book III p.58; Errata |
| Capacitor | `<1-6>cap` | 1–6 | `1cap` | [verified] | Book VII p.11 |
| Matrix cell | `M<1-9><t\|b>` | 1–9, top/bottom | `M6t` | [verified] | Book I p.25 |
| Matrix junction | `M10`, `M11` | — | `M10` | [verified] | Book I p.25; Errata |
| Matrix power tap | `M+`, `M-` | — | `M+` | [verified] | Errata |
| Decimal | `D<0-19>` | 0–19 | `D16` | [verified] | Book I p.20 + panel |

**Matrix parser trap.** Book I p.25's designation rule — *"M = matrix / 6 = terminal number (1 to 11) / t = top or 'b' for bottom"* — over-generalizes: the t/b split exists only for positions 1–9. `M10` and `M11` are single six-hole nodes with no `t`/`b` form. A parser must accept `M1t`..`M9t`, `M1b`..`M9b`, `M10`, `M11`, `M+`, `M-` and **reject** `M10t`, `M10b`, `M11t`, `M11b`. Same class of trap as Book I p.20's "(1 to 19)" — see §10. [verified] — Book I p.25; Errata (*"the six at M10"*)

**Letters deliberately unused as section letters: D, I, M, O, P, Q.** `D` and `M` are block prefixes; `I`, `O`, `Q` are absent, presumably to avoid confusion with 1 and 0. An independent token census over Books I–VI plus the errata returns exactly the 20 letters above, with one stray `2I` against 126 occurrences of `1J`-class `J` tokens — an OCR artefact. [verified] — whole-corpus census, confirmed by the verifier

**There is no `Q` terminal.** Book VII uses a subscripted Ω (omega) as a pseudo-terminal meaning "splice a resistor into this connection here". Three forms, and a parser told only about `Ω_220` will trip on the far commoner `Ω_22`:

| Form | Means | Attested | Tag | Citation |
|---|---|---|---|---|
| `Ω_<number>` | a plain resistor of that value **in ohms** | `Ω_22` (22 Ω) ~10 times in the pp.20–21 counter programs; `Ω_220` on p.11, glossed *"use a 220 ohm resistor to make the connection between 1 cap and 1+"* | [verified] | Book VII pp.11, 21 |
| `Ω_B<n>` | the bias resistor for relay *n*, value fixed by the owner's own measurement | `Ω_B1`..`Ω_B5` in the p.21 program | [verified] for `Ω_B1`..`Ω_B5` / [likely] for `Ω_B6` — the p.8 procedure is run per relay for all six, but no printed program uses `Ω_B6` | Book VII pp.8, 21 |
| bare `Ω` | a resistor whose value is **not yet fixed** | `(+/Ω)(Ω/E)*` on p.8, footnoted *"Decreasing values of resistance will be tried here"*; `(D18/Ω)(Ω/D19)*` on p.21, footnoted *"Use a 15, 22 or 33 ohm resistor to decrease the speed of the motor"* | [verified] | Book VII pp.8, 21 |

The OCR of `book7-capacitor-resistor.txt` renders these as `Q`, `Qo`, `Q20`, `Q22`, `Q50`, `Q54`, `63`. Any parser or census run over that text layer **will** invent a `Q` terminal class. [verified] — Book VII pp.8, 11, 21

**Routing rule.** Any interconnected hole set is a legal junction, not just the ones marked COMMON. SDC's own example: `1X/6A` may be replaced by `1X/4R` + `4R/6A`, or by `1X/4com` + `4com/6A`. The netlist model must therefore treat every jack as an N-hole node, with no notion of "reserved" or "component-only" terminals. [verified] — Errata

**Silkscreen does not equal designator.** The panel prints:

| Designator | What the panel actually prints | Where | Tag |
|---|---|---|---|
| `1A`..`6Z` | the bare letter | **below** the hole pair | [verified] |
| `n+`, `n-` | `+` and `-` | **above** the hole pair | [verified] |
| `M+`, `M-` | `+` and `-` — **no `M` prefix** | above the pair, in the blue stripe over MATRIX | [verified] |
| `ncom` | `COMMON` | above the 4-hole row | [verified] |
| `ncap` | `CAPACITOR` — **no designator printed anywhere on the panel** | above the 2-hole pair | [verified] |
| `D0`..`D15` | the sector numeral `0`..`15` | in the dial's inner annulus | [verified] |
| `D16`..`D19` | `16`, `17`, `18`, `19` | to the **left** of the hole pair; `ARM` below the `16` | [verified] |

Citations: Book I p.5 (*"one of the two holes just below the + in section 1"* vs *"one of the two holes just above the letter A"*), confirmed at 4208 px on `photos/commons-minivac601-main.jpg`.

A panel renderer must silkscreen `+` and `-` over the matrix stripe, not `M+`/`M-`; a program parser must accept `M+` and `M-`. [verified]

---

## 2. Per-section terminal inventory (n = 1..6)

Every row below exists six times. Band order top to bottom: BINARY OUTPUT, power stripe, STORAGE/PROCESSING, COMMON/CAPACITOR stripe, SECONDARY STORAGE, BINARY INPUT. [verified] — two panel photographs; Book I p.25

| Designator | Group legend | Holes | Band | Connects to (internal) | Tag | Citation |
|---|---|---|---|---|---|---|
| `nA` | — | 2 | BINARY OUTPUT | binary output lamp *n*, side 1 | [verified] | Book I p.6–7 |
| `nB` | — | 2 | BINARY OUTPUT | binary output lamp *n*, side 2 | [verified] | Book I p.6–7 |
| `n+` | — | 2 | power stripe | PLUS rail (§4) | [verified] | Errata; Book I p.3 |
| `n-` | — | 2 | power stripe | MINUS rail (§4) | [verified] | Errata; Book I p.3 |
| `nC` | `LIGHT` bracket spans C–E | 2 | STORAGE/PROCESSING, upper row | far side of relay-*n* indicator lamp | [verified] | Book I p.14; Maint. p.7 figure |
| `nE` | `LIGHT` / `COIL` brackets meet here | 2 | STORAGE/PROCESSING, upper row | junction of indicator lamp and relay-*n* coil | [verified] | Book I p.14 |
| `nF` | `COIL` bracket spans E–F | 2 | STORAGE/PROCESSING, upper row | far end of relay-*n* coil | [verified] | Book I p.14 |
| `nG` | `N.O.` | 2 | contact row 1 | relay-*n* set 1, normally-open fixed contact | [verified] | Book I p.12 |
| `nH` | `ARM` | 2 | contact row 1 | relay-*n* set 1, arm | [verified] | Book I p.12 |
| `nJ` | `N.C.` | 2 | contact row 1 | relay-*n* set 1, normally-closed fixed contact | [verified] | Book I p.12 |
| `nK` | (row 1 headings govern row 2) | 2 | contact row 2 | relay-*n* set 2, normally-open fixed contact | [verified] | Book I p.12 |
| `nL` | | 2 | contact row 2 | relay-*n* set 2, arm | [verified] | Book I p.12 |
| `nN` | | 2 | contact row 2 | relay-*n* set 2, normally-closed fixed contact | [verified] | Book I p.12 |
| `ncom` | `COMMON` | **4** | aux stripe | **nothing** — isolated 4-hole junction | [verified] | Book I p.25; Errata |
| `ncap` | `CAPACITOR` | 2 | aux stripe | free plate of section-*n* capacitor; other plate hard-wired to the MINUS rail | [verified] ¹ | Book VII p.11 |
| `nR` | `←` | 2 | SECONDARY STORAGE, row 1 | slide-switch *n* set 1, LEFT contact | [verified] | Book I p.18 |
| `nS` | `ARM` | 2 | SECONDARY STORAGE, row 1 | slide-switch *n* set 1, arm | [verified] | Book I p.18 |
| `nT` | `→` | 2 | SECONDARY STORAGE, row 1 | slide-switch *n* set 1, RIGHT contact | [verified] | Book I p.18 |
| `nU` | (row 1 headings govern row 2) | 2 | SECONDARY STORAGE, row 2 | slide-switch *n* set 2, LEFT contact | [verified] ² | Book I p.18; Maint. p.8 figure |
| `nV` | | 2 | SECONDARY STORAGE, row 2 | slide-switch *n* set 2, arm | [verified] | Book I p.18 |
| `nW` | | 2 | SECONDARY STORAGE, row 2 | slide-switch *n* set 2, RIGHT contact | [verified] | Book I p.18 |
| `nX` | `N.O.` | 2 | BINARY INPUT | pushbutton *n*, normally-open fixed contact | [verified] | Book I p.8 |
| `nY` | `ARM` | 2 | BINARY INPUT | pushbutton *n*, arm / common | [verified] | Book I p.8 |
| `nZ` | `N.C.` | 2 | BINARY INPUT | pushbutton *n*, normally-closed fixed contact | [verified] | Book I p.8 |

¹ Book VII is titled *Minivac 601/6010 Capacitor/Resistor Manual* (1962) and cross-references Book I p.25. Book I (1961) says only that these terminals *"are used when auxiliary components are added to the MINIVAC 601 in advanced programs. At present these terminals may be ignored."* Whether the capacitors shipped in all 1961 production is **not settled by the sources** — see §8, fallback `FITTED-CAPS`.

² The electrical roles (S and V are the arms; T/W close RIGHT; R/U close LEFT) are [verified] from the Maintenance Manual's Slide Switch Check schematic. Which *panel column* U/V/W sit under is the schematic combined with the panel legend — [likely], and of no electrical consequence.

The arrows over R and T are **position labels**, not signal-flow indicators: the arrow says which contact closes when the slide is pushed that way. They are short and self-contained, sitting wholly above their own columns with a clear gap either side of the word `ARM`. [verified]

---

## 3. Right-column terminal inventory

| Designator | Panel print | Holes | Position | Connects to (internal) | Tag | Citation |
|---|---|---|---|---|---|---|
| `M+` | `+` | 2 | blue power stripe above MATRIX | PLUS rail | [verified] | Errata; panel |
| `M-` | `-` | 2 | blue power stripe above MATRIX | MINUS rail | [verified] | Errata; panel |
| `M1t`..`M9t` | cell numeral between the pairs | 2 each | top pair of each of the nine cells | **nothing** — free junction | [verified] | Book I p.25 |
| `M1b`..`M9b` | | 2 each | bottom pair of each cell | **nothing** — free junction, not joined to the same cell's `t` | [verified] | Book I p.25; panel |
| `M10` | `10` below the cluster | **6** | immediately LEFT of the 3×3 grid, middle-row height | **nothing** — all six holes one node | [verified] | Errata: *"the six at M10"* |
| `M11` | `11` below the cluster | **6** | immediately RIGHT of the grid, middle-row height | **nothing** — one node; **not** joined to M10 | [verified] | Errata; Book V p.22 has to wire `M10/M11` explicitly |
| `D0`..`D15` | sector numerals | 2 each | outer ring of the dial, one pair per sector | fixed contact for dial position *N* | [verified] | Book I p.20; Maint. p.10 |
| `D16` | `16` + `ARM` | 2 | left column of the decimal block | rotary wiper arm | [verified] | Book I p.20 |
| `D17` | `17`, `RUN` bracket spans 17–18 | 2 | left column | one end of motor resistor R1 | [verified] | Maint. p.9 figure; Book I p.22 figure |
| `D18` | `18`, `RUN` above / `STOP` below | 2 | left column | one motor terminal, and one end of R2 | [verified] | Maint. p.9 figure |
| `D19` | `19`, `STOP` bracket spans 18–19 | 2 | left column | other end of R1, other motor terminal, other end of R2 | [verified] | Maint. p.9 figure |

**Matrix cell numbering** is `1 2 3` / `8 9 4` / `7 6 5` — 9 at centre, numbering spiralling clockwise from the top-left. `M10` sits outside the grid on the left at middle-row height, `M11` outside on the right. [verified] — 4208 px matrix crop; Book I p.25 perspective drawing

**Matrix printed artwork is real** (unlike the sections): a short bar joins the two holes of each `Mnt` and each `Mnb`; a closed rectangular loop — top bar, bottom bar, and vertical rails down both columns — encloses the six holes of `M10` and of `M11`. No line joins a cell's top pair to its bottom pair. [verified] — 4.7× crop of `commons-minivac601-main.jpg`; Book I p.25 (*"lines between the terminals indicate terminals which are connected together to form a single contact"*)

**Dial layout:** `0` at 12 o'clock, increasing clockwise; 4 at 3 o'clock, 8 at 6, 12 at 9. The `VIEW UNDER PANEL` figure on Book I p.20 runs 0..15 counter-clockwise because it is the mirror view — not a contradiction. [verified] — panel; Book I p.20

**Rotation sense: increasing numbers run clockwise.** Book VI p.56 (Philosophic Tug of War) says the knob turns *"counterclockwise (towards 9)"* and *"clockwise (towards 7)"*. That agrees with the panel: the p.57 program stops the dial on 7, 8 or 9, so 9 is reached from 10 and 7 from 6. It was once read as a conflict (`open-questions.md` C13, resolved 2026-10-13). No netlist consequence — the D block is a plain node set either way. [verified] — Book VI pp.56–57; panel; Book I p.20

**The `RUN` and `STOP` brackets each span two jacks.** `RUN` = D17 **and** D18; `STOP` = D18 **and** D19. Any "18 = RUN, 19 = STOP" one-label-one-jack reading is wrong. [verified] — panel; Book I p.20 figure; Maint. p.9 (*"connecting power to the RUN terminals (D17 and D18)"*)

**The POWER block contains no jacks** — circuit-breaker button, ON/OFF switch, and a lamp or fuseholder (varies between surviving units) are all unpatchable. [verified]

---

## 4. Internal busses

| Bus | Members | Holes | Tag | Citation |
|---|---|---|---|---|
| **PLUS rail** | `1+` `2+` `3+` `4+` `5+` `6+` `M+` | 14 | [verified] | Errata, opening notes |
| **MINUS rail** | `1-` `2-` `3-` `4-` `5-` `6-` `M-`, plus the fixed plate of each of the six capacitors | 14 (+6 internal) | [verified] | Errata; Book VII p.11 |

Errata verbatim: *"All + and - terminals are connected together. For example, a connection to 1+ is the same as a connection to 3+, 6+, or M+. Similarly, a connection to 2- is the same as a connection to 4-, 5-, or M-."*

**There are no other busses.** Specifically:

- The six `ncom` terminals are **not** bussed to each other. Each is an isolated 4-hole junction. Book I p.25's full sentence is *"The four COMMON terminals are connected together, **but are not connected to any other component**"* — the dropped second clause rules out bussing to anything else, on the very page that supplies the misleading half-sentence. Its own lead-in, *"The terminals with four holes labeled COMMON…"*, independently proves the four-hole/one-terminal reading: SDC uses "terminal" here for what Book I p.4 calls a "hole". [verified] — Book I p.25; Errata: *"common terminals are any set of terminals which are interconnected: for instance, the two terminals at 6R, the six at M10, or the four at 3com."* Behavioural confirmation: Book VI Secret Code (p.51) wires all six independently and warns *"Be sure though, that there are connections to each of the six common terminals"*; Electronic Maze (p.53) chains `1com/2L`, `2com/3L`, `3com/4L`, `4com/5L`, `5com/6L`, `6F/6com`. Both circuits collapse if the commons are bussed.
- No matrix **junction** terminal — `M1t`..`M9t`, `M1b`..`M9b`, `M10`, `M11` — is connected to anything. [verified] — Book I p.25: *"The terminals are used as junction points, and there are no connections to the terminals below the panel."* That sentence's subject is the junction grid, **not** the power pair: `M+` and `M-` sit in the blue power stripe above the MATRIX block and are on the two rails, which the errata states outright. A netlist generator reading the sentence literally would strand them. [verified] — Errata
- The relay arm pair `nH`/`nL` and the slide-switch arm pair `nS`/`nV` are **mechanically** ganged, not electrically bussed. See §7 and §9.

---

## 5. Fixed-component netlist

What `src/core` instantiates. *n* = 1..6.

| Component | Count | Terminals | Topology | Tag | Citation |
|---|---|---|---|---|---|
| Binary output lamp *n* | 6 | `nA`, `nB` | lamp between `nA` and `nB`, nothing else | [verified] | Book I p.6 |
| Relay *n* indicator lamp | 6 | `nC`, `nE` | lamp between `nC` and `nE` | [verified] | Book I p.14; Maint. p.7 figure |
| Relay *n* coil | 6 | `nE`, `nF` | coil between `nE` and `nF`; coil and indicator lamp in series across `nC`–`nF` | [verified] | Book I p.14 |
| Relay *n* transfer set 1 | 6 | `nG`, `nH`, `nJ` | arm `nH`; N.C. `nJ`; N.O. `nG` | [verified] | Book I p.12 |
| Relay *n* transfer set 2 | 6 | `nK`, `nL`, `nN` | arm `nL`; N.C. `nN`; N.O. `nK` | [verified] | Book I p.12 |
| Pushbutton *n* | 6 | `nX`, `nY`, `nZ` | SPDT; arm `nY`; N.C. `nZ`; N.O. `nX`; momentary | [verified] | Book I p.8 |
| Slide switch *n* set 1 | 6 | `nR`, `nS`, `nT` | arm `nS`; LEFT `nR`; RIGHT `nT`; latching | [verified] | Book I p.18 |
| Slide switch *n* set 2 | 6 | `nU`, `nV`, `nW` | arm `nV`; LEFT `nU`; RIGHT `nW`; latching | [verified] | Book I p.18 |
| Capacitor *n* | 6 | `ncap`, MINUS rail | one plate on `ncap`, other plate hard-wired to the minus rail; 500 µF for n = 1..5, 1000 µF for n = 6; polarised electrolytic | [verified] for the wiring and values ¹ / [unverified] for "electrolytic" | Book VII pp.10–11 |
| Rotary wiper | 1 | `D16`, `D0`..`D15` | single-pole 16-position; `D16` shorts to `DN` at position *N*; the 16 fixed contacts have no internal connection to one another | [verified] | Book I p.20 |
| Drive motor | 1 | `D18`, `D19` | DC motor across `D18`–`D19`; friction drive to the dial | [verified] | Maint. p.9 figure; Book I p.22 |
| Resistor R1 | 1 | `D17`, `D19` | series | [verified] | Maint. p.9 figure; Book I p.22 figure |
| Resistor R2 | 1 | `D18`, `D19` | **parallel with the motor** | [verified] | Maint. p.9 figure |
| COMMON junction *n* | 6 | `ncom` | isolated 4-hole node, no component | [verified] | Book I p.25 |
| Matrix junction | 20 | `M1t`..`M9t`, `M1b`..`M9b`, `M10`, `M11` | isolated nodes, no component | [verified] | Book I p.25 |
| Power supply | 1 | PLUS rail, MINUS rail | 110 V AC → nominal 12 V DC, ~13 V unloaded, 1.5 A continuous; centre-tapped transformer into a two-diode full-wave rectifier; resettable circuit breaker in series in the **MINUS** leg; ON/OFF switch; POWER light permanently across `+` and `-`. None of these four controls has a jack. Topology below. | [verified] | Book I p.3; Maint. pp.2–3 |

¹ 601/6010 scope flag: the value split is stated once, for "the MINIVAC", in a joint 601/6010 manual. See §8.

**Component totals:** 12 lamps (6 output + 6 relay indicator, same replaceable part 6435 [likely]), 6 coils, 30 transfer contact sets (12 relay + 6 pushbutton + 12 slide-switch), 6 capacitors, 1 wiper, 1 motor, 2 resistors. 26 bare junctions (6 COMMON + 20 matrix).

### The power supply as the Maintenance Manual draws it

The Power Supply Circuit Diagram (Maint. p.3) is the only published drawing of the supply, so it is read off directly here.

- Transformer with a **centre-tapped secondary**. The two secondary ends feed two diodes; the diode junction is the **PLUS** node, the centre tap is the **MINUS** node. [verified] — Maint. p.3
- The **circuit breaker is in series in the MINUS leg**, between the centre tap and the `-` terminal. A trip therefore opens the minus rail, not the plus rail. Corroborated by fault-tree step 9 (Maint. p.4), which measures *both* breaker terminals against `+` — so the breaker cannot be in the `+` leg. [verified]
- The **POWER light is permanently across `+` and `-`**, downstream of the breaker. (The panel jewel, not a relay indicator lamp — those are the per-relay `nC`–`nE` lamps of §5 and §7.) The rails are therefore never truly unloaded; step 3's *"unloaded power supply outlet voltage should be approximately 13 volts"* (Maint. p.3) means "no program load". [verified for the POWER light placement / [likely] for the reading of "unloaded"]
- **No smoothing capacitor is drawn.** This file asserts no filtered rail. Whether the rail is raw 120 Hz full-wave ripple or is smoothed by something the drawing omits is an electrical-model question, not a netlist one — see the electrical-model file. [verified that none is drawn / **not settled by the sources** otherwise]
- **No fuse is drawn**, and the fault tree never mentions one. See §8 row 12.

### Motor-branch behaviour that falls out of the two-resistor topology

- **RUN** (supply across D17/D18): current runs D17 → R1 → D19 → (motor ∥ R2) → D18. R2 steals current, so the motor never sees full rail. [verified topology / [unverified] the magnitude, values unknown]
- **STOP** (short across D18/D19): the motor **and** R2 are both shunted; only R1 limits rail current. The armature is dead-shorted, giving maximum dynamic braking. [verified topology]
- **Power directly across D18/D19** gives the motor full rail: *"connect power momentarily across the STOP terminals: the knob should turn very rapidly."* [verified] — Maint. p.9
- **Power removed from RUN with nothing on STOP** still leaves R2 permanently across the armature, so even "off" is a braked stop, not a free coast. [verified topology / [unverified] the coast distance]
- Book I p.22's claim that "the resistors" let you short STOP without overloading the supply is loose prose: R2 is shorted by the very short it is credited with surviving. Only R1 limits it. [verified]

### Polarity

Book I p.4 describes current as electrons flowing from `-` through the component to `+`. Model the rails as signed:

- Lamps and relay coils are **non-polarised**. SDC published programs driving the same lamp+coil chain in both directions — Book II p.12's single-input flip-flop wires `1-/1C` and `2-/2C`, while Book I Experiments 7/8/9 and Book VII p.8 drive C or E from `+`. A simulator that assumes current always enters at C fails Book II p.12. [verified]
- The **motor** is polarity-sensitive: reversing the RUN connections reverses rotation. Book I Experiment 14 (p.24) uses slide switch 6 as a reversing pair. [verified] — Errata corrects that diagram's label: change `6Y` to `6V`.
- The **capacitors** are polarised, far plate negative. [verified] for the fixed-negative wiring / [unverified] for the electrolytic construction.

### The indicator lamp is load-bearing, not cosmetic

The relay indicator lamp sits in series with the coil, so driving a coil at `nC` gives it *rail minus a lamp drop*, while driving at `nE` gives it the full rail. This is not a rendering detail:

- SDC published an alternate three-bit counter whose stated purpose is to bypass the lamps: *"The circuit below by-passes the relay indicator lights so that full voltage is supplied to the relay coils, causing them to pull in more reliably."* [verified] — Errata, Book IV p.72
- SDC treats the lamps as deliberate current-limiting elements: *"The electrical resistors used with the motor drive limit the current which flows through the circuit in the same way that the lights limit the amount of current which flows through a relay coil."* [verified] — Book I p.22
- Book I Experiment 7 step 6 demonstrates the C-vs-E distinction directly: remove `1X/1E`, add `1X/1C`, and the indicator lights. [verified] — Book I p.15

Component *values* (coil resistance, lamp resistance model, pull-in / drop-out) are not in this file — see the electrical-model file and the `MV601-REF-A` fallback profile. SDC published no coil or lamp ratings anywhere in Books I–VII, the Maintenance Manual or the Errata; Book VII instead has the owner measure a bias resistor per relay into a blank table, which is affirmative evidence that unit-to-unit variation was large. [verified]

---

## 6. Counts

| Scope | Terminals | Holes |
|---|---|---|
| One section (23 × 2-hole + 1 × 4-hole) | 24 | 50 |
| Six sections | 144 | 300 |
| `M+`, `M-` | 2 | 4 |
| `M1t`..`M9t`, `M1b`..`M9b` | 18 | 36 |
| `M10`, `M11` | 2 | 12 |
| `D0`..`D19` | 20 | 40 |
| Right column subtotal | 42 | 92 |
| **Panel total** | **186** | **392** |

[unverified] — arithmetic by this package over the per-item counts above; no manual gives a total. Independently recomputed by the verification pass and found correct. The six `ncap` terminals are already inside the 24-per-section figure.

---

## 7. Switching tables

**Relay *n*** — both sets always transfer together and in the same sense. [verified] — Book I p.12

| Coil state | Closed | Open |
|---|---|---|
| De-energised | `nH`–`nJ`, `nL`–`nN` | `nH`–`nG`, `nL`–`nK` |
| Energised | `nH`–`nG`, `nL`–`nK` | `nH`–`nJ`, `nL`–`nN` |

**Pushbutton *n*** — momentary. [verified] — Book I p.8

| Button | Closed | Open |
|---|---|---|
| Up (rest) | `nY`–`nZ` | `nY`–`nX` |
| Down | `nY`–`nX` | `nY`–`nZ` |

**Slide switch *n*** — latching. [verified] — Book I p.18; Maint. p.8 figure

| Position | Closed | Open |
|---|---|---|
| Left | `nS`–`nR`, `nV`–`nU` | `nS`–`nT`, `nV`–`nW` |
| Right | `nS`–`nT`, `nV`–`nW` | `nS`–`nR`, `nV`–`nU` |

**Rotary** — `D16` shorts to `DN` at position *N*, to nothing else. [verified] — Book I p.20

**Break-before-make.** Explicitly stated and demonstrated for the **pushbutton** (Book I p.9, Experiment 3 step 8: *"There is a position, with the pushbutton only partly depressed, where both lights are OFF… This feature is necessary for the proper operation of some MINIVAC circuits."*) and for the **rotary switch** (Book I p.21, Experiment 11 step 3). Never stated for the relay or the slide switch — see §8, fallback `BBM-EVERYWHERE`. [verified for pushbutton and rotary]

**Isolation.** The two contact sets of one relay are electrically isolated. The claim splits by what each source actually carries:

- `nG`, `nJ`, `nK`, `nN` are **four distinct nodes**. The Relay Check figure drives four different lamps from them (`J/1A`, `G/2A`, `N/3A`, `K/4A`), and Book I p.12 calls H–J and L–N *"separate electrical connections"*. [verified] — Maint. p.7; Book I p.12
- `nH` and `nL` are **distinct nodes** — the two arms are not internally common. No source says so in words, and the Relay Check **cannot settle it**: that figure feeds both arms from `+` (`+/H`, `+/L`), so under `H ≡ L` the printed result is unchanged. The proof is Book II Experiments 5 and 6, whose printed results are impossible under a common arm. [verified by deduction] — Book II pp.13–14; see §9

**Power-on state.** All relays de-energised, all latches cleared. There is no reset line — SDC's published global reset is a power cycle: *"to re-set the automatic sequence control, turn power OFF, then ON again"* (Errata, Book V p.25) and the same for the Book VI games. [verified]

**Programs strap D contacts together.** `D0/D1`, `D6/D7`, `D12/D13` widen the elevator's landing pads (Book V p.11); `D3/D6` and `D8/D11` bridge *across* intervening positions in the SOS program (Book V p.31); Book VII p.26 instructs the operator to *remove* `D6/D7` mid-program (*"Set the rotary switch to 6. Remove D6/D7."*, the multiply-4-by-6 worked example), and the division example on the same page generalizes it (*"if the divisor is 7, remove D7/D8"*, and *"Enter 5 (00101) on the rotary switch by removing D5/D6"*). The D block is a plain node set with no exclusivity assumption. [verified] — Book V pp.11, 31; Book VII p.26

**Schematic reading convention** (matters when transcribing figures into fixtures): solid line = conductor; dashed vertical = mechanical linkage between coil and contact sets, or between the two contact sets. Crossing solid lines are **not** connected unless a junction dot is unmistakably larger than the line width. Published circuit diagrams always draw the relay OFF and the pushbutton UP. [verified] — Book I p.12; Maint. p.7; Book II p.13

---

## 8. Not settled by the sources — with named fallbacks

| # | Question | What is known | Named fallback |
|---|---|---|---|
| 1 | Were the capacitors fitted in 1961 601 production, or added by the 1962 accessory programme? | Book I **p.25** (1961): the CAPACITOR terminals are for *"when auxiliary components are added to the MINIVAC 601 in advanced programs"* and *"At present these terminals may be ignored."* Book VII **p.11** (1962, 601/6010) cites that exact page as its authority that the terminals exist — *"As indicated in Book I (page 25) there are terminals on the MINIVAC console for the capacitors"* — while stating the values as a fact about "the MINIVAC" and that one end is *"permanently connected to the negative power source"*. The 1962 manual's cited authority for the parts is the 1961 page that says to ignore them. Book VII p.8 also mentions *"the highest valued resistor in the kit"*, proving a resistor kit was a separate article — which weakens the argument that the capacitors must have been factory-fitted. | **`FITTED-CAPS`** — model `1cap`..`6cap` as installed, far plate on the MINUS rail. Books I–VI never touch them, so the base corpus is unaffected either way. |
| 2 | Is the 500 / 1000 µF split identical on the 601 and the 6010? | Stated once, for "the MINIVAC", in a manual titled for both machines. | Use 500 µF (n = 1..5) / 1000 µF (n = 6), carrying the 601/6010 scope flag. |
| 3 | Capacitor voltage rating and construction | Not given. Book VII only warns generically that exceeding a rating destroys the part. | **`POLARIZED-ELECTROLYTIC`** — polarised, far plate negative, rating above the ~13 V rail. |
| 4 | Is the relay coil pair (`nE`, `nF`) galvanically distinct from all six contact nodes? | The Relay Check figure draws the coil in its own loop; Book I p.12 says the relay's six *panel* terminals are G H J K L N; the parts list carries "Light Assembly" separately from "Relay"; the relay has eight solder lugs (6 contact + 2 coil). No source states isolation. | **`IDEAL-ISOLATED-COIL`** — coil is a two-terminal element between `nE` and `nF` with no relationship to `nG`/`nH`/`nJ`/`nK`/`nL`/`nN`; indicator lamp a two-terminal element between `nC` and `nE`. Overturned by an ohmmeter reading, or an under-panel photo showing a strap between a coil lug and a contact lug. |
| 5 | Are the slide switch's two transfer sets isolated from each other? | [likely]. Book V p.13 wires `6S` to the odd rotary chain and `6V` to the even chain; if S and V were common the Gray-code decode would be impossible. The Slide Switch Check (Maint. p.8) reads `R`, `T`, `U`, `W` out on four separate lamps, which establishes the **four fixed contacts as four distinct nodes**; it does **not** discriminate `S` from `V`, because it drives both arms from `+` (`+/S`, `+/V`) — exactly the relay's evidentiary situation (§7). Not traced to a full truth table. | **`ISOLATED-SETS`** — model as independent, exactly like the relay's. |
| 6 | Are the relay and slide-switch contacts break-before-make? | Stated for the pushbutton and rotary only. The relay's single arm swinging between two fixed contacts is mechanically break-before-make — a **cited inference**, not a statement: Book I p.12, *"Notice how the arm leaves the normally-closed contact and swings over to touch the normally open contact."* That describes the geometry, not the timing, so the question stays open. | **`BBM-EVERYWHERE`** — every transfer set goes break → both-open interval → make. Never model an instantaneous swap. |
| 7 | Resistance values of R1 and R2, and the motor's running resistance | Two resistors, topology settled. Book VII p.21 offers a user-added 15 / 22 / 33 Ω across D18–D19 to slow the motor, which brackets the order of magnitude. The parts list has no resistor part number, suggesting both are inside assembly 6473. | See the electrical-model file; `MV601-REF-A`. Not a netlist question — the topology is settled. |
| 8 | Does dial position 0 have the same contact geometry as 1..15? | The Book I p.20 under-panel drawing renders 0 as a small rectangle while 1..15 are dot pairs — probably draughtsmanship. The panel has a jack pair under sector 0 and `D0` is used in 13 published program lines. | **`UNIFORM-CONTACTS`** — 16 identical contacts on a 22.5° pitch. |
| 9 | Absolute panel geometry — hole pitch, band heights, jack coordinates in mm | Relative order and grouping settled on two independent photographs. Absolute dimensions are not. | Relative layout only; no mm figure may be encoded as fact. |
| 10 | Which physical contact stack (front vs rear of the relay body) is G/H/J and which is K/L/N | Book I p.12: *"The set of contacts closer to the operator is connected to the set of terminals closer to the operator"*, plus row order. A two-step inference. [likely] | Do not make front-vs-rear identity load-bearing. It has no electrical consequence. |
| 11 | Whether the thin light ring around every jack hole is printed ink or the drilled edge exposing a light substrate | Visible at 4.7× on both high-resolution photographs, on the dark field and on the blue stripes alike. | Rendering only. Draw the ring; do not claim a cause. |
| 12 | What the factory fitted at the top of the POWER strip | `commons-minivac601-main.jpg` shows a black knurled **fuseholder** cap (word FUSE legible three times); a second unit shows a **red pilot jewel**, matching Book I p.3's *"The red power light shows when the power is ON"*. The Maintenance Manual is one-sided against the fuse: the Power Supply Circuit Diagram (Maint. p.3) draws a POWER LIGHT straight across the `+` and `-` output nodes and **no fuse anywhere**; the fault tree (Maint. pp.4–5) walks breaker → power light → power switch → transformer → rectifier and never mentions a fuse; the parts list (Maint. p.11, 6431–6491) carries **6435 Light Assembly** and no fuse part. | Factory-stock default is the **power lamp**; the fuseholder reads as an owner retrofit [unverified]. No netlist consequence — the POWER block has no jacks. Record as a between-unit variant; do not encode the fuse as the stock part. |

Also unresolved, and outside this file's scope but recorded because it recurs in every source: the panel legend reads **Cambridge, Massachusetts** while all seven books, the errata sheet and the Maintenance Manual read **372 Main Street, Watertown, Massachusetts**, and a third unit's plate appears to read a ~7-glyph word ending `-tham`. Six independent print documents — `book1`, `book2-3-4`, `book5-6`, `book7`, `errata`, `maintenance-manual` — against one panel legend, on two independent photographs of two different machines. Both readings are primary. Not resolved. [verified — both readings]

---

## 9. Netlist-pinning acceptance fixtures

Wire these, run them, compare against SDC's printed results. They pin the fixed netlist harder than any prose does.

**Pushbutton Check** — Maintenance Manual p.6. `+/Y`, `Z/1A`, `1B/-`, `X/2A`, `2B/-`. Expected: button up → light 1 ON; button down → light 2 ON.
*Transcription note:* the page prints **both** of light 2's terminals as `2B`. That is on the page, not an OCR artefact. The intended left-hand label is `2A`. The lamp returns on this figure are bare `-` signs with no section number, unlike the other two figures. [verified]

**Relay Check** — Maintenance Manual p.7. `+/H`, `+/L`, `+/Y`, `X/E`, `F/-`, `J/1A`, `1B/1-`, `G/2A`, `2B/2-`, `N/3A`, `3B/3-`, `K/4A`, `4B/4-`. Expected: *"Turn power on. Lights 1 and 3 should come on. Push the pushbutton. Lights 1 and 3 should go off and lights 2 and 4 should come on."* [verified]
Note SDC spends two separate wires, `+/H` and `+/L`. One would do if the arms were common — **suggestive, not proof**: both arms are driven from `+` here, so under `H ≡ L` this figure's printed result is identical. It establishes only that `G`/`J`/`K`/`N` are four distinct nodes. The arm proof is Experiments 5 and 6 below.

**Slide Switch Check** — Maintenance Manual p.8. `+/S`, `+/V`, `T/1A`, `1B/1-`, `R/2A`, `2B/2-`, `W/3A`, `3B/3-`, `U/4A`, `4B/4-`. Expected: slide RIGHT → lights 1 and 3 ON; LEFT → lights 1 and 3 OFF, lights 2 and 4 ON. [verified]

**Book II Experiment 5, DECISION MAKING** — wiring on p.13, results on p.14. Thirteen wires, in printed order: `1+/1H`, `1H/1L`, `1L/1X`, `1Y/1C`, `1F/1-`, `1X/2X`, `2Y/2C`, `2F/2-`, `1J/2H`, `2J/2K`, `1K/2L`, `2K/3C`, `3F/3-`. No erratum applies. Expected: both buttons up → relay 3 ON; PB1 only → OFF; both down → ON; PB2 only → OFF. [verified]
*This is the isolation proof.* With `2H` identified with `2L`, PB1-only puts `1K` live → `2L` = `2H` live → relay 2 OFF closes `2H`–`2J` → `2J/2K` makes `2K` live → relay 3 comes ON, contradicting SDC's printed step 3. Therefore H and L are not internally common.
*Transcription trap:* the wire `2Y/2C` is drawn as a long solid vertical that **crosses** the `2H` and `2L` feed lines. At high resolution the crossings show ink thickening that reads like junction dots. They are crossings.

**Book II Experiment 6, ARITHMETIC** — p.14, **errata-corrected**: change `2Z/2C` to `2X/2C`. Wires: `1+/1H`, `1H/1L`, `1L/1Y`, `1Y/2Y`, `2X/2C`, `2F/2-`, `1X/1C`, `1F/1-`, `1G/2G`, `2H/2A`, `2B/2-`, `1N/2K`, `1K/2N`, `2L/1A`, `1B/1-`. Expected: 0+0 → no lights; PB1 → light 1 (1+0=1); PB1+PB2 → light 2 (1+1=2); PB2 only → light 1 (0+1=1). [verified]
*The stronger isolation proof:* relay 2's two arms drive two **different** lamps, and SDC prints all four rows. Under a common arm, PB1-only lights both lamps and the adder reads 1+0=3.

Every program transcribed as a fixture must have the errata applied first, or the fixture encodes SDC's own typos. Terminal-letter corrections in the errata include: Book I p.13 delete the line joining 1B and 2B; Book I p.24 change `6Y` to `6V`; Book II p.11 change `1A/1C` to `1A/1G` and delete `1A/1C` from the diagram; Book II p.14 change `2Z/2C` to `2X/2C`; Book III p.43 change `2+/2H` to `1G/2H`; Book III p.54 change `5V/45` to `5V/4S`; Book III p.59 relabel `1R,1S,1T` to `3R,3S,3T` on the far-right slide switch; Book V p.11 change `4G/4H` to `4G/5H` and `D16/M-` to `D16/M+`; Book V p.30 change `5X/6E` to `5X/6C`. [verified]
*Grep trap:* the errata's line *"page 13: circuit diagram incorrect — delete line connecting 1B and 2B"* sits under **BOOK I**, not Book II. Book II's errata block is pages 10, 11 and 14 only. Experiment 5 is not errata'd.

---

## 10. Corrections applied

The verification pass overrules the discovery pass. These claims appeared in earlier research and are **wrong**; they are recorded here so no later pass reinstates them.

| Refuted claim | Correction | Citation |
|---|---|---|
| "The two holes of one terminal sit inside a printed oval / are joined by a short printed bar; COMMON is four holes inside one printed oval." | **No printed ovals or joining bars anywhere in the six sections.** Every section terminal is two bare holes on the plain panel field, identified by the letter below (or `+`/`-` above). COMMON is four bare holes under the word COMMON. Printed joining artwork exists **only** in the MATRIX. | 4208 px crops of `commons-minivac601-main.jpg`; the original claim came from a 1536 px photo that cannot resolve the question |
| "The letter is silkscreened below the hole pair" (asserted panel-wide) | True for A..Z. **False** for `+`/`-`, printed above; **false** for the decimal block, where 16/17/18/19 are printed to the left. | Book I p.5, Experiment 1 steps 2 and 3 |
| "No shorthand designator for the CAPACITOR jacks appears anywhere; they connect to nothing settled; model them as dead jacks." | Designator is `ncap`; a real capacitor is installed with one plate on the minus rail; values 500 µF / 1000 µF; SDC published programs using `1cap/D16`, `2cap/3L`, `3cap/4L`, `4cap/5L`, `5cap/6L`. The "whole-corpus census" that found zero uses covered three of the seven PDFs in the same directory. | Book VII pp.10, 11, 21 |
| "A resistor between D17 and D19, and the motor between D19 and D18" (one resistor) | **Two** resistors. R1 between D17 and D19; motor **and** R2 both between D18 and D19. A one-resistor model gets STOP current, motor voltage and coast all wrong. | Maintenance Manual p.9 figure; corroborated by *"Check each of the two resistors"* (Maint. p.10) |
| "No manual sentence says M+ is on the plus rail; the inclusion rests on panel position and program usage." | Such a sentence exists and names M+ and M- outright. The conclusion was right; the stated evidentiary basis was wrong. | Errata, opening notes |
| "Book I p.20's '(1 to 19)' means D1..D19." | Erratum in the manual. The real range is **D0..D19**. The `0` sector has its own jack pair, the same page's under-panel drawing shows a contact at 0, the Maintenance Manual says *"D0 through D15"*, and `D0` appears in 13 published program lines. The printed text genuinely reads "(1 to 19)" — confirmed on the page image, not an OCR mangle. | Book I p.20; Maint. p.10 |
| "Book I p.25: 'The four COMMON terminals are connected together' — so the COMMONs may be bussed." | Counts the four **holes** of one COMMON terminal. Six independent 4-hole junctions. | Errata: *"the four at 3com"* |
| "The two arms (H & L) are connected together" (Book I p.12, read as electrical) | **Mechanical.** Two paragraphs down the same column: *"The two relay arms are connected together mechanically with a plastic crossbar."* The left column of the same page calls H–J and L–N *"separate electrical connections"*. Isolation is independently proved by Book II Experiments 5 and 6. If a future pass proposes tying H to L, point it here. | Book I p.12; Book II pp.13–14 |
| ~~Citation "`2K/3com`, `4G/5com`, `6A/6com`" offered for the `ncom` designator is fabricated — the lines appear nowhere in Books I–VI~~ — **this refutation is itself refuted** | All three lines appear, **together**, in **Book IV printed p.85** (`book2-3-4.pdf` PDF p.91), in the Program for Decimal to Binary Converter, alongside `D16/M+`. The earlier grep missed them because the OCR text layer letter-spaces the tokens (`2 K /3 c o m`). The citation stands; the `ncom` conclusion was never in doubt either way. | Image read of `book2-3-4.pdf` PDF p.91; whitespace-insensitive grep hits `book2-3-4.txt` line 4156 |

---

## 11. Source key

| Short form | File | Notes |
|---|---|---|
| Book I | `raw/pdf/book1.pdf` | Printed page + 2 = rendered page index (printed p.14 = `pages/book1/p-16.png`) |
| Books II–IV | `raw/pdf/book2-3-4.pdf` | |
| Books V–VI | `raw/pdf/book5-6.pdf` | |
| Book VII | `raw/pdf/book7-capacitor-resistor.pdf` | *Minivac 601/6010 Capacitor/Resistor Manual*, © 1962. **Joint 601/6010 document** — every claim about the *hardware* taken from it carries a scope flag. Claims about the document's own notation and program syntax (§1) do not: those are facts about the manual, not about either machine. |
| Maint. | `raw/pdf/maintenance-manual.pdf` | 11 printed pages. Printed page + 2 = PDF page. Carries the Power Supply, Motor Drive, Pushbutton Check, Relay Check and Slide Switch Check schematics. |
| Errata | `raw/pdf/errata.pdf` | SDC *"Notes and Corrections to the Minivac Manual"*, unpaginated. Carries the +/- bus statement, the hole-count statement, the routing rule, and the page-by-page corrections. |
| Panel photo | `raw/photos/commons-minivac601-main.jpg` (4208×2457) | Primary for silkscreen and hole counts. `commons-minivac601-DSCF1392.jpg` (4288×2848) is a second unit. `prebrief/images/image_3.jpg` (1536×1152) is too low-resolution for fine silkscreen and produced several refuted claims. |
| Quarantined | `raw/photos/commons-minivac6010-mit-museum.jpg` | A **6010**. Not evidence for the 601. |

Duplicate copies `minivac601-errata.*` and `minivac601-maintenance-manual.*` are byte-identical to `errata.*` and `maintenance-manual.*`.
