# Open questions, contradictions and refutations

Everything this package did **not** settle, plus everything a verifier overturned. Nothing
here is hedging: each open item names the fallback the simulator uses meanwhile, and each
refuted claim is stated as a correction so it cannot be silently re-imported.

**Entry shape.** Question → why it matters to the build → what was tried → **named fallback**
→ what evidence would settle it.

**Standing ruling.** The verifier outranks the finder; the critic outranks both on
cross-file consistency. Where a claim appears below as refuted, it is refuted everywhere in
the package, and the topic files carry only the correction.

---

## 1. Blocking gaps

Five gaps stopped this package short of a deterministic core and a golden fixture suite. G4,
the program corpus, is closed: `tools/extract-corpus.ts` generates `test/conformance/corpus/programs.json`
from `programs.md`.
`[verified]` — raw:critic-completeness.json#blocking_gaps

### G1 — Electrical solver class, and the parameter profile it runs on

**Question.** Is the core a boolean connectivity solver or a DC resistive-network solver, and
if analog, what named profile supplies coil resistance, lamp resistance at its series
operating point, pull-in and drop-out voltage, and supply source impedance?

**Why it matters.** This decides what a "net" means. It cannot be deferred, because SDC
published circuits whose documented behaviour is a **voltage** phenomenon, not a connectivity
one:

- ER, Book IV p.72 replaces the three-bit counter with a circuit whose stated purpose is
  *"by-passes the relay indicator lights so that full voltage is supplied to the relay coils,
  causing them to pull in more reliably"*, and warns *"the capabilities of the relays are
  somewhat strained. Relays which perform to satisfaction in every other case may not perform
  adequately in this circuit."* `[verified]` — ER sheet p.2
- The whole of B7's bias-resistor chapter requires the coil to sit **between** drop-out and
  pull-in and stay there. `[verified]` — B7 pp.6–7
- B1 Experiment 9's canonical latch drives the coil **through** the indicator lamp on both the
  set and the hold path, so the coil never sees rail voltage even in the most basic relay
  circuit in the manual. `[verified]` — B1 p.17
- The decisive case: the original Book IV counter and the errata's alternate counter have
  **identical boolean connectivity** and different published outcomes. Both chain all six `C`
  terminals to the negative rail. The only difference is three added contact bypasses that put
  a ~0.05 Ω contact in **parallel** with each odd relay's indicator lamp. No connectivity walk
  distinguishes them. A lamp-count-in-path heuristic does not either — it sees one lamp on the
  coil path in both. `[verified]` — B4 p.72; ER sheet p.2

**What was tried.** All nine primary documents (Books I–VII, MM, ER; six PDFs on disk) searched
by three independent agents for a
coil resistance, coil voltage, pull-in voltage, drop-out voltage, lamp rating or bulb number.
**None exists.** B7 pp.8–9 instead prints a **blank table** (Ω-B1..Ω-B6) and orders the owner
to measure a bias resistance for each individual relay, warning that values differ per relay —
affirmative evidence SDC never published a number. `[verified]` — B7 pp.8–9;
raw:verify-relays.json#still_not_settled_by_the_sources

**Named fallback.** `MV601-REF-A` (`components.md` §8.2): a DC resistive-network solver over
a conductance graph — union-find across patch wires and closed contacts, two-terminal elements
never collapsed, Thévenin source, dense LU, inner fixed point for lamp non-linearity, relay
evaluation with **hysteresis** (the hold branch is what makes B7 expressible), outer loop
capped and non-convergence reported as a real oscillator rather than an error. Every constant
`[unverified]` and tunable. The solver-class ruling itself is `[likely]` — the facts are
verified, the conclusion is inference; nobody read "build a resistive solver" in a 1961 manual.

**Acceptance criteria the profile must meet.** `[verified]` — raw:critic-completeness.json

| ID | Requirement |
|---|---|
| AT-01 | B1 Experiment 9's latch pulls in **and holds** with the indicator lamp in series on both paths |
| AT-02 | The B234/ER three-bit counter is **marginal** (capable of failing) driven via `C`, and reliable via `E` through the ER lamp-bypass circuit. **Currently unsatisfiable — see O-E1** |
| AT-04 | A common 1961 resistor value lands the coil strictly between drop-out and pull-in |
| AT-05 | Six coils plus the panel's lamps stay under the published 1.5 A |
| AT-06 | A dead `+`-to-`-` short trips the breaker immediately |
| AT-07 | `1X/1E` operates the relay with the lamp dark; `1X/1C` operates it with the lamp lit |
| AT-09 | A breaker trip extinguishes the POWER lamp until reset |
| AT-10 | A short across the STOP terminals is harmless; a short across `+` and `-` trips |

**Scope decision riding on this.** If the core is boolean, B7's bias resistors, capacitor
kicks and the `ncap` block are unimplementable and this is a Books I–VI machine. Note that
descoping B7 does **not** rescue a boolean core: the counter, the elevator fix, the breaker
and the C-vs-E lesson are all Books I–IV plus errata. `[likely]` — `components.md` §8.1

**What would settle it.** Nothing on paper. Only a measurement session on a surviving unit,
or identification of the exact relay and lamp parts from an under-chassis photograph followed
by 1961 datasheets. Cheapest partial: an under-panel photograph showing the relay body's
maker's mark and the lamp base.

---

### G2 — Discrete-time timing model

**Question.** What is the tick, and what are the per-device latencies — relay operate,
release, both-open interval during transfer, contact bounce, pushbutton and slide-switch
transfer gaps? What is the settling rule for a combinational relay chain within one tick?

**Why it matters.** A deterministic discrete-time core is *specified by* exactly these
numbers and there are none. The machine is demonstrably race-sensitive and SDC says so:

- *"some programs are not designed for high-speed operation … try carrying out the procedure
  slowly."* `[verified]` — ER, troubleshooting
- *"push pushbutton 6 slowly when operating the single-input flip-flop."* `[verified]` — ER,
  Book IV p.69
- *"hold the pushbutton down long enough for any carry to propagate to the highest stage of
  the counter."* `[verified]` — ER, Book IV p.72

Without a latency model the single-input flip-flop either toggles deterministically — wrong,
it is the circuit SDC warns about — or oscillates unboundedly.

**What was tried.** Confirmed absent across all nine primary documents (Books I–VII, MM, ER;
six PDFs on disk) by three agents. The corpus is
not free of *all* timing figures, and the finder's `[verified]` "NO NUMBERS ANYWHERE" was
refuted: the rotary "more than a second from zero to nine", the 45 rpm worked-example
assumption and MM's "resistors should heat up in about 20 seconds" all exist. None is relay
data. `[verified]` — raw:verify-relays.json#refuted.REF-02

One genuine lower bound exists and it is `[likely]`, not `[verified]`: the published supply is
an unfiltered full-wave centre-tapped rectifier, so the rails are 120 Hz pulsating DC dipping
toward zero every 8.33 ms; the relays demonstrably do not chatter at 120 Hz; so the armature
time constant exceeds roughly 8 ms. It rests on "no filter capacitor is *drawn*", which is not
proof none exists.

**Named fallback.** `MV601-TIMING-A` (`components.md` §9.3): fixed 100 µs integer tick;
freeze contacts → solve once → advance **all** armatures from that one solution (the
intra-tick determinism rule); armature as a continuous travel scalar with `break_frac` /
`make_frac` giving operate, release, both-open and interrupted-stroke behaviour from one
parameter set; two release rates (open vs shorted coil, the slugged-relay effect); ordering
constraints R1–R6 as load-time assertions.

**Do not adopt the shipped parameter block as-is.** `[verified]` (arithmetic on its own
numbers): the both-open constraint R1 is derived against the wrong stroke and its physical
premise is wrong — a floating node in the Book II p.12 flip-flop leaves the two coils in
**series**, not dead; and two of the five constraints fail on the defaults
(`relay_release_open_ms` 8.0 < the 8.33 ms ripple half-period; the binding shorted-release
margin is 1.04× against a stated requirement of 3×). Fix those before shipping the numbers.

**What would settle it.** Not closable from paper. Scope or slow-motion video of a surviving
unit; or identification of SDC part 6437 (Relay, $6.00) with a 1961 datasheet. A timed video
would also bound the rotary rate and crudely bound relay operate time.

---

### G3 — Rotary contact geometry and motor law

**Question.** What is the angular width of a rotary contact versus the dead gap between
contacts, and what angular-velocity law does the motor obey under the four documented drive
conditions?

**Why it matters.** `contact_at(angle)` is the rotary's entire interface to the netlist and the
gap fraction is its one free parameter. It is not cosmetic: ER's Book V p.11 note documents the
elevator hanging because the pointer came to rest **between D6 and D7**, making proper contact
with neither — a primary-sourced failure mode a faithful simulator should reproduce. And period
programs depend on every intermediate contact firing momentarily as the wiper sweeps (the
Combination Lock's optional `D8/6E` trap: "indicate an error if 8 is passed at any point").

**What was tried.** Netlist read twice independently from MM p.9's *Circuit Diagram — Rotary
Switch Motor Drive*. Drive conditions, break-before-make at the wiper, absence of detents,
friction drive, rotation sense and the D0 question are all settled (see `rotary.md`). What is
missing is every number. The finder's manufactured "30–45 rpm band" was killed: the only
defensible primary anchor is B56's worked example, *"assume 45 revolutions per minute"* = 12
contacts/s ≈ 83 ms per contact — and it is framed as an assumption. The `48` on the same page is
the **program's registered-revolution count** (45 × 16/15), not a dial speed; do not import it.
`[verified]` — raw:verify-rotary.json#simulator_spec_deltas

The finder's claim that the Morse programs bound the gap fraction below 0.5 was refuted on
three independent counts (the Experiment 18 program merges all nine mark contacts into one
net; SDC's hand-slowing remedy scales lit and dark equally; an incandescent filament smears a
42 ms dark interval anyway). **No primary source bounds the gap fraction.** `[verified]`

**Named fallback.** `UNIFORM-CONTACTS` with `contact_arc_deg = 16.875°` (gap fraction 0.25),
`run_rpm = 45.0`, `fast_rpm` ≈ 3× as a guess, and two coast parameters — every one labelled
unsourced and tunable. A **point wiper** is provably equivalent under break-before-make. Do
**not** derive RUN speed from a resistor divider; configure it directly and model the D18/D19
network only where a program varies it. `rotary.md` §9

**What would settle it.** An under-panel photograph of an original SDC part 6473 assembly at
measurable resolution — the single highest-value acquisition for the rotary model. Or an
ohmmeter across D16 and one contact while rotating slowly. Or frame-counted video of an
original running the Traffic Light (rpm plus the gap fraction directly from dark frames) and
the Three-Floor Elevator (both coast parameters).

---

### G5 — Unread maintenance check circuits and relay contact isolation

**Question.** Are the relay's two contact sets (`G/H/J` and `K/L/N`) electrically isolated, and
what do MM's check-circuit figures show?

**Status: largely closed since the critic wrote.** `[verified]`

- **Isolation is settled.** The two sets are electrically independent; `H` and `L` are distinct
  nodes. Proof is not a sentence but SDC's own printed results: Book II Experiment 5's step 3
  ("Push pushbutton 1. Relay 3 goes OFF") is impossible with `H` and `L` common, and
  Experiment 6's one-bit adder reads 1+0 = 3 under a common arm — visible in two of four
  printed rows. Corroborated by SDC's drawing convention (solid = conductor, dashed =
  mechanical linkage; the vertical between the two contact sets is dashed at 1200 dpi).
  `[verified]` — B234 pp.13–14; MM p.7
- **Trap.** B1 p.12's *"The two arms (H & L) are connected together"* means **mechanically** —
  the same page says H–J and L–N make "separate electrical connections" and, two paragraphs
  down, "connected together mechanically with a plastic crossbar". Never model node identity
  between `H` and `L`. `[verified]`
- **The three check circuits are transcribed** with SDC's own expected lamp states, in
  `components.md` §10 and `jack-map.md` §9. The Relay Check's trap is that the coil is driven at
  `E`, so the indicator lamp stays **dark** through the whole test.

**Still open.** Whether the coil pair (`nE`, `nF`) is galvanically distinct from all six
contact nodes — no source states it. **Fallback `IDEAL-ISOLATED-COIL`**: model the coil as a
two-terminal element with no relationship to the contact nodes. Every published circuit is
consistent with it, the Relay Check figure draws it that way, and any coil-to-arm bond would
latch `nG`/`nC`-style programs permanently at power-on. `[likely]` Settled by an ohmmeter, or
an under-panel photo of the eight lugs.

Also still open: which physical stack (front vs rear of the relay body) is `G/H/J` and which is
`K/L/N`. Two-step inference from B1 p.12 plus row order. **Fallback:** do not make front-vs-rear
identity load-bearing — it has no electrical consequence.

**No maintenance-manual page remains unread.** MM printed p.3 (= `pages/maintenance/p-05.png`
under this package's `printed + 2 = PDF` offset) is the *Power Supply Circuit Diagram* and has
been read three times; `raw:verify-panel.json` listing it as unopened is a stale research-state
claim, not an open question. `[verified]` — `maintenance-manual.pdf` PDF p.5.

---

## 2. Cross-file contradictions

The critic raised 17 and this pass found one more (C18). All but C14 are closed; each outcome
lives in its topic file, and the refutations among them in the §3 register. Of the closed ones,
only C13, C15 and C18 stay listed, because other files cite them by id.
`[verified]` — raw:critic-completeness.json#cross_file_contradictions

| ID | Severity | Subject | Status |
|---|---|---|---|
| C13 | medium | Rotary rotation sense | **Resolved 2026-10-13 (Tom).** Book VI agrees with the panel; the conflict was a misread of the travel path |
| C14 | medium | Manufacturer address on the logo plate | **UNRESOLVED — and now three-way. Do not resolve** |
| C15 | low | The D-terminal numbering rule | **Resolved.** `D0..D19`; the manual's "1 to 19" is an SDC misprint. Detail in the raw file |
| C18 | medium | A refutation that is itself refuted: the `2K/3com` / `4G/5com` citation | **Reversed.** The lines exist at Book IV printed p.85. Correct it in three files |

**C14 — Manufacturer address on the logo plate. UNRESOLVED, and it got more complex, not less.**

- **Panel.** PH2's plate legend, cropped and upscaled, reads cleanly: *"Scientific Development
  Corporation, Cambridge, Massachusetts. Made in U. S. A. Patents applied for."* Independently
  confirmed on PH1. `[verified]`
- **Paper.** Six primary print attestations of **Watertown**: B1's copyright page and back cover;
  B234's; B56's (twice); MM's title page and its spare-parts order block, which uniquely adds the
  pre-ZIP postal zone *"Watertown 72, Massachusetts"*; the errata masthead and footer; and B7's
  1962 back cover. All read *372 Main Street, Watertown, Massachusetts*. `[verified]`
- **New observation 1.** A MINIVAC panel *does* say Watertown — the **MINIVAC 6010** at the MIT
  Museum carries *"Scientific Development Corporation, Watertown, Massachusetts. Made in U. S. A.
  Patents applied for."* in the identical plate layout. So the split is not paper-vs-panel; it
  tracks **601-vs-6010**. `[verified]` (that photograph is quarantined as 6010 evidence for every
  other purpose)
- **New observation 2.** PH3's plate (Centre for Computing History unit, a third machine) reads as
  a short ~7-glyph word ending `-tham`, with ascenders at t/h and no descender — which rules out
  both *Cambridge* (9 glyphs, descender at g) and *Watertown*. Most plausible reading **Waltham**.
  `[unverified]` — resolution-limited. If it holds, there are **three** distinct address strings on
  601-family panels.

The pattern is consistent with Cambridge-then-Watertown, which is what Wikipedia's **uncited**
infobox says — but a silkscreen reused after a move produces the same pattern, and "Waltham" fits
neither story. **Do not encode either city as fact.**

**Named fallback.** Render the plate legend as a **configurable string** with all attested
variants recorded, defaulting to PH2's text verbatim; or omit the city. Report the discrepancy;
do not pick one. No behavioural consequence — this costs the simulator nothing.

**What would settle it.** A MINIVAC trademark registration (owner address of record plus
first-use-in-commerce date); a Massachusetts corporate registration for Scientific Development
Corporation 1960–63; a Cambridge or Boston city directory entry for those years; any dated
advertisement carrying a Cambridge address; a higher-resolution photograph of the CCH unit's
plate. **Cheapest ongoing step:** read the logo plate on every further 601 photograph that
surfaces — a 601 whose plate reads Watertown settles the direction immediately.

---

## 3. Refuted claims — the register

Every refutation that changes a fact an implementer would use, with its correction, so it is not
lost. This is a **selection**, not a transcript: the eleven `verify-*` / `gap-verify-*` files
carry far more refuted and downgraded entries than the rows below. Each topic file also carries
the refutations local to it — `components.md` §11, `jack-map.md` §10, `rotary.md` §8,
`programs.md` §3, `panel.md` §12, `history-and-artifacts.md` *Corrections applied*. Where this
register and a topic file differ, **this register is not automatically right**: check the cited
raw file. The `2K/3com` row in §3.1 is the worked example — one wrong refutation sitting in three files at once.

### 3.1 Netlist and components — `raw:verify-relays.json`, `raw:verify-jackmap.json`

| Refuted claim | Correction |
|---|---|
| Book I Exp 8 contains `1Y/1C`, `[verified]` | **`1X/1C`.** `1Y/1C` bypasses the pushbutton and latches relay 1 at power-up |
| "NO timing numbers ANYWHERE in the corpus", `[verified]` | Rotary-speed figures and the 20-second resistor test exist. The correct claim — no **relay** operate/release/bounce figure — stands |
| Book II single-input flip-flop is on printed p.11 | Printed **p.12**. p.11 carries the two-button memory circuit and the prose introducing the single-input one |
| ER's "push pushbutton 6 slowly" note applies to the Book II flip-flop | It applies to the **Book IV p.69 first-version** flip-flop (pushbutton 6, light 6), not the Book II p.12 circuit (pushbutton 1, light 1). `[likely]` |
| The pull-in/drop-out definition sentence is on B7 printed p.7 | Printed **p.6**. p.7 carries the graphs and the shaded-region paragraph |
| Book VI's "connections to each of the six common terminals" warning is on p.53 | It is the starred footnote at the bottom of printed **p.51**, under the Secret Code program |
| Supply source resistance 0.67 Ω, `[likely]` | **`[unverified]`.** The premise — that "nominal 12 volts" is the measured terminal voltage at 1.5 A — is in no source. Keep the *shape* (non-ideal source, loads interact); do not let the number inherit a tag |
| Selenium rectifier; relay break-before-make; C–E alone lights the lamp; capacitors factory-fitted — all `[likely]` | All are the finder's own inference with no secondary corroboration ⇒ **`[unverified]`**. (Relay break-before-make survives as `[likely]` on B1 p.12's arm-geometry sentences) |
| "The POWER control is a slide switch", `[verified]` | The word "slide" is nobody's but ours ⇒ `[likely]`. B1 p.3 calls it "The POWER SWITCH". ON/OFF behaviour and layout stay `[verified]` |
| "8 relay connections = 2 coil + 6 contact" presented inside a `[verified]` claim | MM says only *"disconnect the eight connections"*. Now **read** off the Relay Check figure ⇒ `[verified]`, with C's exclusion from the eight a two-source inference `[likely]` |
| "Lamp rated at 14 V" | **Invented. Withdrawn.** Only *"operated at less than their rated voltage"* is published |
| Book VII relay claims presented as plain 601 facts | All carry the **601/6010 scope flag** |
| One resistor between D17 and D19, motor between D19 and D18 | **Two** resistors — see `jack-map.md` §5 |
| "No manual sentence says M+ is the plus rail" | ER says it by name — see `jack-map.md` §4 |
| "No shorthand designator for the CAPACITOR jacks; model them as dead jacks" | `<n>cap`, real capacitors, published programs — see `panel.md` §5.1 |
| "The two holes of one terminal sit inside a printed oval / joined by a short bar"; "COMMON is four holes inside one printed oval" | **No such artwork** outside the MATRIX — see `panel.md` §5 |
| "The letter is silkscreened below the hole pair" (panel-wide) | True for `A`..`Z`. **False** for `+`/`-` (above) and for the decimal numerals 16–19 (to the left). B1 p.5 uses both senses in one paragraph |
| "Whole-corpus token census" | The census covered **three of the six PDFs on disk** — `book1.txt`, `book2-3-4.txt`, `book5-6.txt`, i.e. Books I–VI only. Book VII, the Maintenance Manual and the errata sheet were not searched, and the `ncap` designator lives in Book VII |
| ~~Citation `2K/3com`, `4G/5com` "in Books II–IV" for the `ncom` designator "does not exist in any spacing variant"~~ — **the refutation is wrong; the finder's citation was right** | All three lines (`2K/3com`, `4G/5com`, `6A/6com`) are printed in **Book IV, printed p.85** (`book2-3-4.pdf` PDF p.91), in the 49-wire *Program for Decimal to Binary Converter*, with `D16/M+`. The refuting regex allowed one space per glyph gap; the OCR sets `2 K /3 c o m`. `[verified]` — image read, PDF p.91; `programs.md` IV-EXP11. See `jack-map.md` §10 |
| B1 p.25's "The four COMMON terminals are connected together" read as licensing a bus | Counts the four **holes** of one terminal. **Six independent 4-hole junctions** |
| "The two arms (H & L) are connected together" read as electrical | **Mechanical.** Isolation independently proved by Book II Experiments 5 and 6 |
| COMMON isolation `[likely]` | **Upgraded to `[verified]`** — the Secret Code program plus its starred-connection footnote |
| Relay contact isolation "proved" by the wire `1H/1L` being redundant | Corroboration, not proof — a daisy chain reaches `1X` either way. The proof is Experiment 5's *stated results*, plus Experiment 6 |
| No filter capacitor, argued partly from the spare-parts list | Drop the parts-list leg — that list also omits the two motor-drive resistors the same manual tells you to test. The schematic read alone is good evidence; conclusion stays `[likely]` |

### 3.2 The electrical ruling — `raw:gap-verify-electrical-solver-class.json`

| Refuted claim | Correction |
|---|---|
| The errata's alternate counter differs from the original by tying `C` to the negative rail — presented as the killer argument | **Both** programs chain all six `C` terminals to the negative rail. The real difference is three added contact bypasses (relays 1, 3, 5) putting a ~0.05 Ω contact in parallel with each odd relay's lamp |
| "The bypassed lamp still carries current and still glows" | **Refuted.** The bypass is a contact short **across** the lamp; both its terminals sit at the negative rail and it goes **dark** while the bypass conducts — which is what SDC's own "by-passes the relay indicator lights" implies |
| The counter's marginality is a rail-sag phenomenon; per-relay pull-in spread ±0.7 V | **Refuted on the profile's own arithmetic.** The discrimination window is 0.29 V; ±0.7 V would fail about one relay in six on Book I Experiment 9, which SDC presents as reliable. AT-01 and AT-02 cannot both pass. Mechanism unresolved — see O-E1 |
| Series lamp ~40 Ω against a 185 Ω coil (α ≈ 0.82) | At that ratio the coil sees 10.7 V against a 7.5 V pull-in and the documented failure is unreachable. The lamp must be **comparable to or larger than** the coil in the series path. (The arithmetic stands; the supporting appeal to SDC's word "limit" does not — "limit" carries no magnitude) |
| Tags `verified_reasoning_from_verified_facts` and `verified_reasoning` | **Not permitted tags.** Both are inference from verified facts ⇒ `[likely]` at best. Inventing a tag whose first word is "verified" is precisely the failure the tag rules exist to prevent |
| `I_trip` = 1.5 A, `[likely]` | `[unverified]`. No source connects the supply's continuous rating to the breaker's trip point |
| MM p.10 cited for the "resistors limit current the way the lights limit relay current" analogy | That is **B1 printed p.22**, section RESISTORS. MM p.10's "resistors heat up in about 20 seconds" is a different fact |
| "Both graphs on B7 p.7 carry the BIAS VOLTAGE annotation" | Only the second does. The substantive point — no numeric ticks anywhere — is correct |

### 3.3 Timing — `raw:gap-verify-discrete-time-timing-model.json`

| Refuted claim | Correction |
|---|---|
| "No published circuit depends on which of two relays wins" | **Refuted.** Book VI's Reaction Time Tester (p.60) exists precisely to decide which of two near-simultaneous presses came first, (Scissors Paper or Stone, p.59, orders the players only so that player 1 cannot see player 2's relays move; its circuit is combinational and does not depend on which relay wins). Per-relay variation is not an optional flourish |
| The both-open constraint R1, derived against the relay's operate stroke, premised on the far coil being dead while an arm floats | On the Book II p.12 topology the far coil is **not** dead — a floating node leaves the two coils in **series** at roughly half current, and that path puts voltage back across the releasing coil. Under a magnitude-only travel model the flip-flop **chatters** instead of toggling. Decide the solver's semantics for a series path through a floating node **before** sizing `break_frac`/`make_frac` |
| The shipped default timing constants satisfy their own constraints | Two fail: the binding shorted-release margin is 1.04× against a required 3×, and `relay_release_open_ms` 8.0 < the 8.33 ms ripple half-period. An implementer who writes the prescribed load-time assertions does not get past startup |
| Counter mis-count prediction "3→4 needs two stage-times, 7→0 needs three" | Corrected to the serial chain **1, 2, 1, 3, 1, 2, 1, 3**. A marginal tap fails first at 3→4 and 7→0, second at 1→2 and 5→6, never at even→odd steps. Derived against SDC's own BINARY COUNTER — SEQUENCE OF OPERATIONS chart, B4 p.71 |
| The "8–40 ms operate" bracket read as derived | The ripple argument bounds **release** dynamics, not operate, and the 40 ms upper is an unexplained halving of its own dwell bound. Do not cite it as derived |

### 3.4 Rotary — `raw:verify-rotary.json`, `raw:gap-verify-rotary-…json`

| Refuted claim | Correction |
|---|---|
| "Book VI confirms increasing dial numbers run clockwise" | **Reinstated 2026-10-13.** The two agree — see `docs/DECISIONS.md`, 2026-10-13, *C13 resolved*. The refutation assumed travel from 7 to 9 through 8 |
| "B1 p.20's '(1 to 19)' is an OCR artefact of a `#` placeholder" | No placeholder. The manual literally prints a digit as its exemplar and reuses it: *"8 = terminal number (1 to 19) … for example D8"*, exactly as p.25 does with *"6 … for example M6t"*. Image-read at 200 dpi. The substantive point stands: the printed range omits `D0`, which exists and is used; MM p.10 gives the correct range *"D0 through D15"*; the factory errata never corrects it |
| The errata's reliability changes apply to Experiment 8 | **Experiment 9** — see `programs.md` C-09 |
| "Overrun is real and programs depend on it", `[verified]` from the Philosophic Tug of War | **`[unverified]`.** The manual says only *"Release pushbutton 4 as the rotary switch knob starts to turn"*; holding the button until the wiper leaves the D7-D8-D9 arc is equally consistent. The words *momentum*, *overrun*, *coast* and *inertia* appear in **no source** (whitespace-insensitive test). What the program *does* verify is the stop wiring |
| "'More than a second from zero to nine' bounds the motor at ≤34 rpm" | It is a comparison between a **human** setting a dial and a human pressing a button, in a passage arguing for binary input. Not a motor spec. There is no 30–45 rpm band; there is one assumed example, 45 rpm |
| "The Morse programs bound the gap fraction below 0.5" | Refuted on three counts. **No primary source bounds the gap fraction** |
| "B1's 'the resistors make it possible to short the STOP terminals' corroborates the two-resistor topology" | It does not — on the verified topology R2 is shorted out by that very short; only R1 limits. SDC's plural is loose prose |
| "No detents, ratchet, indexing spring or click stop", `[verified]` by grep | **`[likely]`.** The grep as described cannot have worked (OCR spaces letters: `frictio n d riv e`). Re-run whitespace-insensitively the word-absence **is** confirmed, but absence of a word in an OCR layer that excludes all figure text is not proof. Strongest positive support remains ER's documented hang between D6 and D7 — a detented switch cannot rest between positions |
| Automobile Speed Timer has 34 wires | **35.** `6C/6G` is easy to drop between columns 3 and 4 |
| Morse encoder decimal side has 12 wires | **17.** Add `2F/D15`, `3G/D8`, `4F/D14`, `5com/D2`, `6F/D3` |
| "MM and ER are not present in the local tree" | Both were already on disk when the file was written, along with B7, which was never opened |

### 3.5 Programs — `raw:verify-programs.json`, `raw:gap-verify-canonical-…json`

| Refuted claim | Correction |
|---|---|
| Tic-Tac-Toe's printed `4G/5N` is anomalous; `4N/5N` is intended | **Refuted.** `4G/5N` is the middle link of the printed chain `3G/4N` / `4G/5N` / `5G/6N`. The proposed "fix" breaks the chain. **An implementer who takes the finder's per-line flags at face value corrupts a correct fixture** |
| Tic-Tac-Toe footnotes read "(attached to M10)" / "(attached to M11)" as printed | The page prints only *"this is the machine's 'play' wire"* / *"the player's 'play' wire"*. The parenthetical is the finder's gloss inside a field named `as_printed` |
| `II-3STMT` is in Book II, printed p.36 | Printed p.36 is in **Book III** — see `programs.md` C-08 |
| The `+`/`-` rails and `M+`/`M-` placement are not settled | **Settled** — see `jack-map.md` §4 |
| How many COMMON terminals exist "must be settled from the panel photograph" | Settled by ER's hole-count sentence: six `com` terminals, four interconnected holes each |
| The finder's `[verified]` tag policy, which admitted OCR-only readings cross-checked against a second printing | **Policy struck.** `[verified]` requires a page-image read. Every affected program drops to `[likely]`. In practice the verifier re-read ten programs from images and found **zero** transcription errors — the corpus is sound, the tag was not |
| "The machine's first move is always the centre of the game matrix (matrix square 9)", `[verified]` | The page prints only "the center of the game matrix". Centre = `M9` comes from the panel photograph — cite it there |
| `III-MINDREADING` begins `5V/4S` (printed as such) | The Book III printing reads `5V/45`; ER corrects it to `5V/4S`. Corrected value right, provenance misstated — a silent normalisation |
| Book V Exp 4 vs Exp 5 rotary connections are a discrepancy | Not a discrepancy. Two programs, two motor polarities. Given the one-node rule there is nothing anomalous about two rotary terminals on `M-` |
| `IV-FF1` has 16 connections | **15.** The page builds it in stages of 6 + 4 + 3 + 2 |
| Book II's flip-flop, `IV-FF1` and `IV-FF2` are three printings of one circuit | **Two circuits.** Book II's and `IV-FF2` share four of six nets and differ in where lamp 5's anode taps; `IV-FF1` is a genuinely different 15-wire circuit using the `K/L/N` set that nothing else touches |
| The lamp-tap difference between them is cosmetic — "they agree in the stable states" | **`[unverified]`.** An indicator lamp is a **series element in the coil path**; moving the tap changes coil loading. Keep both as separate fixtures |
| `II-SELFLOCK` comes up ON at power-up | **OFF.** Its holding path runs through `1H`–`1G`, which is open at cold start. It latches only after pushbutton 1 has been pressed once |
| `II-EXP2` is a tier-A fixture asserting **lamps** | Refuted twice: it is tier **C1** (23 wires including six rotary terminals), and the observable is the **relay indicator light** — the program contains no `A` or `B` terminal at all |
| `I-EXP11` is a tier-A build-this-first fixture | Its entire five-wire program is rotary. Tier **C1** |
| `III-XOR-PB` step 5 (neither pushed, lamp 3 OFF) is `[verified]` from print | **`[unverified]`.** Book III p.41 prints only the either-pushed and both-pushed cases |
| "Relay pull-in/drop-out times and contact transfer order are not settled" | **Partly refuted.** Transfer order **is** settled for pushbuttons and the rotary, in B1 body text, and flagged there as load-bearing: *"the normally open contact is never connected directly to the normally closed contact, even for a very short time."* Only **relay** transfer order and the millisecond figures remain open |
| `errata.txt` drops 12 of the 48 connections in the alternate counter | The OCR has all 48; it corrupts four recoverable glyph classes and destroys exactly one line. (The stronger warning stands: never transcribe a wire list from that text layer) |
| "Corpus = 98 programs + 1 errata circuit" | **98 records** total; the errata counter is one of them |
| Book I Answer 13 is `6+/6Y`, `6J/6A`, `6B/6-`, `6Y/D17`, `D18/M-` | Two lines wrong: the image reads `6X/6A` and `6X/D17` |

### 3.6 Provenance and history — `raw:verify-context.json`

| Refuted claim | Correction |
|---|---|
| "archive.org holds only one Minivac item; five originals, all local" | **False.** A second item, `book-vii_202512`, holds Book VII — and the file was already on disk twelve minutes before that claim was written |
| "A MINIVAC 6010 manual or schematic of any kind — nothing found anywhere" | **Refuted.** Book VII is a joint 601/6010 manual. Not a schematic, so the internals question stays open, but the blocker is smaller than stated |
| "Every piece of paper says Watertown, every panel says Cambridge" / "No Watertown-legend panel has been found" | **Second half false** — the MIT Museum 6010's plate reads Watertown. See C14 |
| "The errata is transcribed verbatim in `errata.txt` — read it directly" | **False and dangerous.** Two-column interleave; terminal letters are the payload this project cannot lose |
| Errata citations "page 3" (Book IV p.72 note) and "page 4" (Book V p.11 note) | Both **off by one** — sheet pages **2** and **3**. Quoted text verbatim correct |
| "Shannon appears exactly once across all six books", `[verified]` by exhaustive grep | **Twice**, in consecutive sentences of one passage — and the method is unsound on this OCR |
| "No panel variant of any kind; two independently photographed units" | **Undercount.** A third 601 photograph was already on disk, acquired and never opened |
| The archive.org file list presented as the originals we hold | Wrong for Book I: our local copy is the ccapitalia publisher scan; archive.org's is a different, re-derived file |
| "The power light sits across the DC output, breaker in series on the rail from the transformer" | Imprecise where it matters: the breaker is in the **centre-tap (negative) rail**, not the rectifier output |
| "The six-book set" used as the documentation set throughout | The set is Books I–VI **+ MM + errata + Book VII**. ER's own "six-book set" is correct *for the errata* and must not be generalised |
| CHM record cited approvingly with Wikipedia's dimensions | The live CHM record exposes **no** dimensions, only 10 lb — and Wikipedia's infobox gives 9 kg (≈20 lb), contradicting it. `[unverified]` for any dimension or weight |

### 3.7 Panel — `raw:verify-panel.json`

Beyond the printed-artwork refutation (`panel.md` §5), the panel finder's `[verified]` claims that did not survive PH2:

| Refuted claim | Correction |
|---|---|
| "A long left-pointing arrow whose tail extends back over the ARM" | The SECONDARY STORAGE arrows are **short and self-contained**, one over `R` and one over `T`, with a clear gap to the word ARM |
| "A red rectangular actuator running in a light ivory/cream housing" | The actuator protrudes through a **plain dark slot** cut in the dark panel field; the switch body is under the panel. The pale impression is a PH1 lighting artefact |
| "A slotted screw head is visible beside/above each pushbutton" | **No such screw.** It is the button's chrome/cream bezel ring peeking past the red cap; MM p.7 puts the mounting screw **under** the cap |
| "Contact springs behind the crossbar" | The contact stacks are plainly visible **to the right** of the crossbar, as two vertically separated spring assemblies — which is what makes the upper→`G H J` / lower→`K L N` mapping a physical observation rather than an inference |
| "The dark round component atop the POWER strip is the power indicator lamp", `[likely]` | On PH2 it is a black knurled **fuseholder** cap engraved FUSE; on PH3 it is a **red pilot jewel**. Identity varies between units — see `panel.md` §7.4 and §11 |
| "Coil bobbins read tan/buff, ambiguous against the manual's 'round white coil'" | PH1 tungsten-lighting artefact. On PH2 they are white/cream, exactly as B1 p.14 says. **No discrepancy** |
| "The panel is divided by a full-height printed vertical stripe" | It is the **blue console frame** between three separate dark sub-panels. MM p.4 corroborates that the upper-right one is a removable *power panel* |
| "The pointer knob is a large red cylinder with a cream blade reaching the number ring", `[verified]` | On PH2 it is **dark brown/maroon** with a white **pie-wedge** on its top face terminating at the knob's own rim. B1 p.20 draws a teardrop. Three sources, three forms |
| Letter offset "measurably ~3 source-pixels left of the pair's centre" | Strike the number — it is below the noise floor of the image it was measured on. The substantive placement rule survives |

---

## 4. Open questions that are not blocking

Each with its named fallback. Grouped by where the fallback lives.

### Electrical

**O-E10, O-E11 and O-E12 are different in kind from O-E1..O-E9, and must not be read as research
findings.** The first nine record numbers the *sources* fail to give. These three record constants
that were **invented** to make `docs/plans/architecture.md` work — a coil inductance, an inductive
transient clamp, and a lamp thermal time constant promoted from cosmetic to electrical. **No primary
source states any of the three, or anything from which they could be derived.** They are on the
register because a constant beyond the research package goes on the record before it ships; each
lives in `data/profiles/*.json`, tagged `[unverified]`, and **never as a constant in code**, so a
measurement session replaces a data file and re-blesses rather than editing a source line. A reader
who cites any of the three as a MINIVAC fact is citing us, not SDC.

| # | Question | Fallback | Would settle it |
|---|---|---|---|
| O-E1 | **Why the Book IV counter's lamp-fed relays are marginal when Book I Experiment 9's is not.** The counter's odd relays are driven exactly as Experiment 9's is — same α, same voltage — yet SDC calls one reliable and one "somewhat strained". A pure DC threshold model cannot produce different outcomes from identical circuits. **The single largest open question in the electrical model** | Model it as a **timing** effect, not a DC threshold effect. `[unverified]` — SDC attaches speed warnings to precisely these circuits and no others; a lamp-fed coil has a longer L/R rise to pull-in current and loses races it would win given time. **Consequence: relay actuation and release times move from "defer with the capacitors" to required for the Books I–VI milestone** | Pull-in **time** at lamp-divided vs full-rail drive on a surviving unit, plus a coil inductance measurement; or a scope on a real carry cascade |
| O-E2 | Relay coil resistance, rated coil voltage, pull-in, drop-out | `MV601-REF-A`, per-relay tunable | Ohmmeter across E–F plus a bench sweep on all six relays; or a photograph of the coil bobbin stamping |
| O-E3 | Lamp voltage, current, bulb number, base type, cold and hot resistance | `MV601-REF-A`'s `R_lamp(I)`; anchor the first real measurement by putting one lamp across the rail and reading the current | Pull one Light Assembly (SDC 6435) and read the bulb |
| O-E4 | Drop-out as a fraction of pull-in. B7 establishes qualitatively that the gap is deliberately large; gives no number — and the number decides the both-open behaviour of the canonical flip-flop | `MV601-REF-A`'s 2.5 / 6.5 ratio ≈ 0.38 | Bench sweep |
| O-E5 | Whether "nominal 12 V" is the loaded figure at 1.5 A | `R_src` = 0.67 Ω, non-zero, tunable, `[unverified]` | A loaded-rail measurement, or SDC dealer literature quoting load regulation |
| O-E6 | Whether a filter capacitor exists in the chassis. None drawn; a schematic omission is not proof of absence | No filter; ripple modelled but **default off** | Photograph of the underside of the power panel, or a scope on the rails |
| O-E7 | Circuit-breaker trip current | 1.5 A thermal with a time-current curve, `[unverified]` | Meter or photograph of the breaker label |
| O-E8 | Transformer secondary voltage and VA; rectifier technology (the "selenium" reading is withdrawn) | **Not settled by the sources.** Do not model an AC side at all: fold it into `MV601-REF-A`'s Thévenin source (`V_oc` ≈ 13 V, `[verified]` from MM p.3's *"the unloaded power supply outlet voltage should be approximately 13 volts"*; `R_src` `[unverified]`), and model the rectifier as an **ideal full-wave centre-tapped rectifier with zero forward drop** — the drop is already inside `V_oc`, and double-counting it is the failure mode. Transformer VA is not modelled; the 1.5 A continuous rating (MM p.2) is the only published limit and belongs to the supply **as a whole**. The modelling choice is `[unverified]` | Meter readings; photograph of the transformer and rectifier |
| O-E9 | Resistor values in the Book VII kit | `MV601-REF-A` predicts a useful bias range of roughly 100–700 Ω — falsifiable | A kit parts list or photograph |
| O-E10 | **`L_coil`, the relay coil inductance. An INVENTED CONSTANT — no primary source states a coil inductance, or any inductance, anywhere in the corpus.** The architecture models the coil as a **series R-L branch with coil current as the carried state**, and makes pull-in and drop-out thresholds on quantized *current* rather than on a DC voltage (`architecture.md` §3.3, §4.1). **Why it matters.** It is O-E1's own named fallback made concrete — the mechanism, not a flourish. On `MV601-REF-A`'s own numbers a lamp-fed coil is **2.1× slower** to reach pull-in and sits at 94% of its own asymptote, so the Book IV counter loses carry races that Book I Experiment 9 — where the operator holds the button and there is no race — cannot lose. It is also the one element that makes the two release paths fall out of **a single solve with no rate-selection branch** (`architecture.md` §4.2): an open coil collapses in about one tick, while a coil turned off by short-circuiting it — which is how *every* flip-flop in the corpus turns a relay off — freewheels on `L/R_coil` and releases 2–5× slower, the slugged-relay effect `components.md` §9.3 describes. Delete `L_coil` and both behaviours revert to hand-written rules with no equation behind them. **What was tried.** The nine-document sweep behind G1 and O-E2 found no coil resistance, coil voltage, pull-in or drop-out figure; it likewise found **no inductance, no henry figure, and no relay identification** beyond SDC part 6437 (*Relay, $6.00*), which is a price, not a datasheet. Nothing on paper can produce this number, and none was inferred from one — **it was chosen** | `MV601-REF-A` extended with a new `L_coil_uh` key, tagged `[unverified]`, living in **`data/profiles/*.json` — never a constant in code** (`architecture.md` §10). Indicative 0.9–1.5 H; the shipped profile carries 1.2 H. The value is deliberately **not pinned in prose**: `tools/check-profile.ts` solves for it against ordering constraints R1 and R6, AT-11 and the 2–5× release band, and refuses to load a profile that fails. Reasoning: an R-L companion is **exact at DC**, so adding inductance does not perturb the DC operating point and leaves AT-01 untouched — the constant buys the timing mechanism without paying anything on the thresholds. **The standing risk, stated rather than buried:** the counter's failure could instead be produced by the six per-relay offsets `dV_relay_mv`, with `L_coil` doing no work at all. `architecture.md` §4.3 runs two controls — the spread zeroed, and the spread rotated by one relay index — and if the counter stops failing under either, the spread is the mechanism, this fallback has not earned its keep, and the plan stops rather than tuning around it | An LCR or bridge reading across `E`–`F` on a surviving unit — the direct measurement, and part of the same session that closes O-E2. Failing that: pull-in **time** at lamp-divided versus full-rail drive, which tests the prediction directly (~2× slower, and diverging as rail sag pushes `i_final` toward `i_pullin`); a scope on a real carry cascade; or identification of SDC part 6437 against a 1961 datasheet. **What would overturn it:** a measured inductance small enough that a lamp-fed coil never loses a race — that does not retune the profile, it **re-opens O-E1** with the timing explanation dead; or a real unit whose counter mis-counts **uniformly** rather than at the stages O-T5 predicts, which kills the serial-race model this constant exists to serve |
| O-E11 | **`V_arc_clamp_mv`, the inductive transient clamp. An INVENTED CONSTANT — no primary source states an arc voltage, a transient voltage, or any contact-opening figure.** Once the coil is an R-L branch (O-E10), backward Euler on an *opened* inductor is unphysical without a bound. **Why it matters.** The companion equation alone puts **~1 kV across a panel jack** and drives the coil current to zero in a single tick — both artifacts of `G_eq`, not physics — and in the `nE`/`mG` series-chaining idiom of Books II and IV and of `ER-ALTCOUNTER` it forces two series coil currents to the arithmetic mean of their previous values in one tick, putting a **dead** coil at 43.15 mA, above three of the six relays' pull-in on the shipped spread. `architecture.md` §4.3's direction latch then promotes that one-tick numerical artifact into a **permanent relay operation**. Unclamped, the simulator latches relays the machine does not, in the exact circuit family the counter is built from. **What was tried.** Nothing, because there is nothing to try: **this constant replaces a discretization artifact, not a missing measurement.** The corpus carries no arc, spark, transient or contact-erosion statement of any kind, and the Maintenance Manual — the one place such a thing could live — discusses only continuity checks | **`ARC-CLAMP`**, shipped as `V_arc_clamp_mv` in **`data/profiles/*.json`, tagged `[unverified]`, never a constant in code**. 30 V indicative. Mechanism: on any tick where a solved coil branch exceeds the clamp, that coil is re-stamped with an arc conductance `Garc = abs(i_prev)/V_arc` and the tick is solved **exactly once more** — a fixed second solve, taken or not taken, never a third, so it is not a fixpoint iteration and adds no convergence criterion to specify (`architecture.md` §3.2 step 5, §3.3). Reasoning: the quantity is at least *physical in kind* — an arc across an opening contact really does clamp at tens of volts — and its consequence is **checkable rather than free**: it sets the open-release ramp at `V_arc/L` per tick (2.5 mA/tick on the shipped numbers, 86 mA to 0 in ~3.5 ms), and `check-profile` requires that ramp to stay well inside the 8 ms mechanical release stroke, so the number cannot be set to whatever is convenient. **Name status:** `ARC-CLAMP` is named in `architecture.md` §10, here, and in `README.md`'s *Named fallbacks* index, which now carries a row for it pointing at `architecture.md` §3.3 and §4.2. The bare name is safe to cite | A two-channel scope across an opening relay contact on a surviving unit — the arc voltage is directly observable, and this is among the cheaper measurements in the register. **What would overturn it:** a measured clamp far from 30 V; or a demonstration that the open-release ramp it implies is comparable to or longer than the mechanical release stroke, which would mean release **ordering** is being set by a discretization parameter rather than by the armature. Note the asymmetry with everything else on this register: a change of integration scheme — trapezoidal, or a finer tick with an explicit arc model — **replaces** this constant rather than measures it. It is scheme-dependent and must be labelled so, never defended as a property of the machine |
| O-E12 | **`lamp_thermal_tau`, promoted from a display filter to the filament's electrical time constant. The 40 ms value is an INVENTED CONSTANT — no primary source states a filament time constant, a lamp thermal figure, or any lamp rating at all.** `components.md` §9.3 already ships `lamp_thermal_tau_ms = 40` and says of its own parameter block that *"every number in the block above is invented"* — but it ships it purely as a **cosmetic** smoothing of displayed brightness. `architecture.md` §3.4 makes the same number govern the filament's **resistance**. **Why it matters.** A tungsten filament's resistance is strongly temperature-dependent (~7× cold-to-hot on `MV601-REF-A`'s PWL table), and the relay indicator lamp is hard-wired **in series** with the coil — `nC —lamp— nE —coil— nF`, `[verified]` `components.md` §1.4 — so at power-on and at every contact make the filament's warm-up **directly sets the coil's drive voltage** through the first tens of milliseconds. Held cosmetic, the lamp is electrically massless, which deletes the cold inrush `FALLBACK-PWRUP-COLD` exists to exercise. Held electrical, it replaces revision 1's four-pass damped inner fixpoint — start value, damping form and residual all unspecified, its 2.8% residual on coil current from a cold start **larger than the decision margins the model claims sensitivity to** — with one stated time constant and a single linear system per tick. It changes observables: lamps now cross `dim` on the way to `on` in every golden, and a marginal C-fed coil can pull in at power-on or at a make it would otherwise miss. **What was tried.** No lamp voltage, current, bulb number, base type or resistance exists anywhere in the corpus (O-E3, G1); SDC prints only *"operated at less than their rated voltage"*, and the "rated at 14 V" reading was **withdrawn as invented** (§3.1). With no bulb identified there is no thermal mass to derive from. 40 ms is a plausible small-filament figure and nothing more | **`LAMP-THERMAL-R`**, carried as `lamp_thermal_tau_us` in **`data/profiles/*.json`, tagged `[unverified]`, never a constant in code**. One number serves both roles: `kThermal = tick_us ÷ (lamp_thermal_tau_us + tick_us)` is computed once at load, `R_lamp` relaxes toward the 33-breakpoint PWL target each tick, starts at `R_cold` at power-on and is carried thereafter (`architecture.md` §3.4). Reasoning: the promotion introduces **no new number** while deleting three unspecified degrees of freedom, and it makes the DC operating point converge to the *exact* self-consistent point over ~τ rather than to within 2.8% of it in one tick. **The honesty trap, recorded so nobody trips it:** "no new constant" is true of the value and false of the claim. A display filter wrong by 3× is invisible; an electrical time constant wrong by 3× moves coil current through exactly the window O-E1 and O-E10 turn on. Promotion raises the evidentiary burden on a number nobody measured. Risk entry: `architecture.md` §14 risk 3. **Name status:** as with `ARC-CLAMP`, `LAMP-THERMAL-R` now has a row in `README.md`'s *Named fallbacks* index — that edit has landed. It is a **fallback name, not an acceptance test**: the acceptance tests are AT-01, AT-02, AT-04..AT-07, AT-09, AT-10 and AT-11, and none of them covers the filament time constant | Pull one Light Assembly (SDC 6435), identify the bulb, and take a step-response trace of its resistance — the same acquisition that closes O-E3. A high-speed capture of a relay indicator lamp at power-on bounds τ directly off the current waveform. **What would overturn it:** a measured filament constant materially different from 40 ms — which does not merely retune brightness, it moves every marginal pull-in decision at power-on and at contact make and forces a re-bless of every golden; or a bulb whose cold-to-hot ratio is far from the ~7× the PWL table assumes, which changes the inrush independently of τ |

**Read the O-E1, O-E10, O-E11 and O-E12 rows above with these corrections.** The rows are left as read.
`docs/DECISIONS.md`'s *canonical marginal-counter ruling after W1* governs every simulator claim
about the Book IV counter.

- **O-E1 — fallback now `None. Open, with no fallback`.** The row's timing fallback was withdrawn
  2026-08-30: W1 tested it and the shipped model did not reproduce its predicted discriminator. The
  question is unchanged: why the physical Book IV counter is marginal when Book I Experiment 9 is
  not. W1 refutes the proposed implementation, not timing or any other hypothesis about a physical
  MINIVAC 601.
- **O-E10.** Its published pull-in prediction was tested and not observed: the model measured
  **1.109** C-fed/E-fed, while **2.567** appears only when the filament is frozen warm. Its stated
  determination — that `check-profile` solves for `L_coil` against R1, R6, AT-11 and the 2–5×
  release band — is **false as written**: R1, AT-01 and AT-11 are `L_coil`-independent across the
  entire sweep, and R6 fails throughout it. `L_coil` is retained only for its **release-path role**:
  one R-L solve produces the open and short-circuited release paths without a handwritten
  rate-selection branch. W1 left two leads unsettled: whether a different release model would
  satisfy R6 (a ruling on `architecture.md` §4.2's two release paths, not a tuning pass); and reverting O-E12, the one
  change that makes R6 pass, though it moves the failure to AT-11 rather than making the region
  feasible. The row's registered `dV_relay_mv` vector is
  superseded as current profile guidance by the Wave D convention `[-282, -169, -56, 56, 169, 282]`
  (`docs/DECISIONS.md`, *Wave D relay-threshold convention and reachability policy*), a simulator
  convention tagged `[unverified]`, not a measurement.
- **O-E11 — amendment 2026-08-31, the mechanism clause.** Tom's ruling is in `docs/DECISIONS.md`,
  *2026-08-31 — O-E11 arc-pass latch*. The row's `V_arc/L` ramp figure is shorthand: the real
  open-release step is about 3.44 mA per tick (`docs/DECISIONS.md`, *2026-08-30 — Phase 1 Wave 1a
  spec readings*). `Garc` is stamped as a **parallel shunt**: right for a coil
  across an opened contact, wrong at a live junction, where it turns a one-tick artifact into a
  permanent latch. The arming test is not the cause; the placement is. Published programs do reach
  the state, and what holds is a **measured bound**, not an absence: no relay decision differs from
  the landed netlist's own DC answer, worst coil error **3.04101 mA**, 7.0% of the 43.333 mA
  pull-in, at the registered constants. `docs/plans/architecture.md` §3.3 and §15.1 carry the
  measurement and the margin. The row's last sentence — a change of integration scheme
  *"**replaces** this constant rather than measures it"* — is **extended** deliberately, as an
  extension and not a reading, to a series-gap node model: an opened contact contributing a node
  pair with the arc stamped across the gap (`architecture.md` §3.1, identified, not adopted). The
  clause's subject is the integration scheme; the reason carries over: the constant bounds backward
  Euler on an opened inductor the netlist gives the arc nowhere to live in, and a netlist with a real
  gap has no such quantity to set. The constant, its indicative 30 V, its home in
  `data/profiles/*.json` and the row's "Would settle it" column are unchanged.
- **O-E12 — a longer τ meets the settle cap.** W1's τ sweep found that at 60 ms and 80 ms the
  settle does not converge inside `settle_cap_us` = 500 ms (35 of 354 settles hit the cap). The
  shipped 40 ms converges, its longest settle 4171 of 5000 ticks. Revisiting τ means revisiting
  the cap.

**Amendment 2026-10-14 (Phase 5 wave 3) - `V-EXP13`'s 13 uA margin.** The bless refusal's `minDecisionUa` 13 on `V-EXP13` is the same mechanism as the other ramp-sampling margins: relay 6's coil current rises and decays on an L_coil_uh-limited ramp of roughly 250 uA per tick (pull-in) and 430 uA per tick (drop-out) behind a slide-switch transfer, and 13 uA is where the tick happens to sample it, not a marginal steady state (held about 60 mA against a 45213 uA pull-in; released about 1 mA against an 18547 uA drop-out). Under the six BLESS-ROBUSTNESS perturbations `minDecisionUa` moves from 1 to 29 uA while the relay 5 and 6 sequence and the light 4 toggle count are identical in all six. `V-EXP13` is the program with the 46 two-coils-in-series transfer hits of the O-E11 two-coil sweep (`architecture.md` §3.3): a candidate source of the low margin that this run now shows is ramp sampling.

### Timing and transfer semantics

| # | Question | Fallback | Would settle it |
|---|---|---|---|
| O-T1 | Relay operate / release time; whether shorted and open release differ | `MV601-TIMING-A`, with the two failing constraints fixed first | Slow-motion or scoped video; or identification of SDC part 6437 with a 1961 datasheet |
| O-T2 | Relay break-before-make and its both-open interval. Stated explicitly for the pushbutton and the rotary, **never** for the relay | `BBM-EVERYWHERE`: break → both-open → make, `[likely]` from B1 p.12's arm geometry | Two-channel scope on H–J and H–G during operate; or a close photograph of the contact geometry |
| O-T3 | Contact bounce, any contact | 0.5 ms on make, 0 on break, `[unverified]` | Scope capture |
| O-T4 | Slide-switch transfer semantics (break-before-make vs shorting) | Break-before-make | Continuity test while sliding slowly |
| O-T5 | Whether the counter's mis-count pattern under a fast tap really is 1,2,1,3,1,2,1,3 | Ship it as the falsifiable prediction it is | **One video of a real unit being tapped fast.** A unit that instead fails uniformly kills the serial-ripple-on-the-down-edge model |
| O-T6 | What the solver does with a series path through a floating node (decides whether the canonical flip-flop toggles or chatters) | **`SERIES-THROUGH-FLOAT`** — a fallback **named here and in `README.md`'s fallback register**, which now carries a row for it. It is still absent from `components.md` §8.1 and §8.4, which rule the *substance* without coining a name. Those two sections between them settle it: §8.1's *Degenerate cases* paragraph says a node with no conductive path to the source is **floating** and *"do not treat floating as grounded"*, and both §8.1's *What a net is* and §8.4 step 1 say two-terminal elements are **never** collapsed. So a series path through a floating node carries series current and both coils sit at ~V/2, and whether the canonical Book II flip-flop toggles or chatters is a **parameter** question — where V/2 falls between `V_dropout` and `V_pullin` — not a semantics one. Still decide it before sizing `break_frac`/`make_frac`. `[likely]` — inference from `components.md` §8.1/§8.4; stated in neither. **One edit outside this file remains, and is not this file's to make:** the `SERIES-THROUGH-FLOAT` row in `README.md`'s *Named fallbacks* register, pointing at `components.md` §8.1/§8.4, has landed; naming it explicitly in `components.md` §8.4 step 1 or in the §8.1 *Degenerate cases* paragraph has not. Until it does, cite the sections, not the bare name | Nothing external; it is a design ruling |

### Rotary

| # | Question | Fallback | Would settle it |
|---|---|---|---|
| O-R1 | Angular width of a contact pad vs the dead gap. **The single unresolved parameter of the rotary model** | `contact_arc_deg = 16.875°` (gap fraction 0.25), tunable, commented unsourced | Under-panel photograph of an SDC 6473 assembly; ohmmeter across D16 while rotating slowly; frame-counted video of the Traffic Light |
| O-R2 | R1 and R2 resistance values, and the motor's running resistance. Bracketed at tens of ohms only by the fact that a user-added 15/22/33 Ω shunt measurably slows the motor. **Those are values for an external patch resistor — never read them as R1/R2** | Configure RUN speed directly; do not derive it from a divider | SDC parts drawing, or a surviving unit. The parts list has no resistor part number, suggesting both live inside assembly 6473 |
| O-R3 | Motor make, rating, no-load rpm; drive-wheel and shaft diameters | Configurable rpm; `run_rpm = 45.0` labelled an assumption | Drawing for part 6471 or 6472 |
| O-R4 | Direct-across-STOP speed ratio ("less than one-third rated voltage" refers to an unknown rating) | `fast_rpm` ≈ 3×, a guess | Motor rating |
| O-R5 | Coast angle, spin-up, spin-down, reversal time. The vocabulary of momentum appears in **no** source | Two coast parameters, both labelled invention. Printed lower bound from `V-EXP11` (Book V p.14, PDF p.20, "The rotary switch will return to 0"): drive only on pads D1..D8, rotary break-before-make (Book I p.21), so the return crosses every gap between pads on coast alone. `coast_udeg_drive_removed` must exceed the gap (22.5 deg - contact_arc, 5.625 deg shipped) and stay below one pitch (22.5 deg). A speed-scaled coast must still clear the gap at full run rate. **Value set 2026-10-14 (Tom's ruling, a one-off kill-rule exception):** `coast_udeg_drive_removed` 20 deg (invented) -> 9.54 deg (9_540_000 udeg), the midpoint (9.5389695 deg, rounded to 0.01 deg) of the band [5.692552, 13.385387] deg in which every printed claim and printed assert passes at MV601-REF-A (12 motor claims and all 79 printed fixtures, VI-MATCHGAME among them, measured on the commit that landed Phase 5 wave 3, and the Step 7 commits after it add no printed fixture; edges bisected to 1 udeg, no holes at 0.1 deg). V-EXP11 sets the lower edge (fails at 5.692551 deg, script[85] dial gap, expected c0). VI-MATCHGAME script[68] sets the upper (fails at 13.385388 deg); that edge is a tap-window artifact, not a printed rest (O-R14): the printed rest asserts hold to 13.713926 deg, which would put the midpoint at 9.70 deg. Above the band VI-MATCHGAME passes again on an island of about 13.65-13.71 deg (0.01 deg scan); the band is the connected interval containing the midpoint. The non-binding V-EXP5 claim fails from 13.968534 deg. `coast_udeg_stop_shorted` (5 deg) is unchanged and stays the shorter; its R_arm / (R_arm + R2) rationale no longer supports 5 deg (0.3125 x 9.54 = 2.98 deg), so 5 deg rests on the BK7 p.21 arc argument and the braking order. Still `[unverified]`: the manuals bound the number, they do not give it. Cross-references: O-R1, O-R13, O-R14 (`V-EXP6`'s pb5 rest pad is a second, digest-only bound; see O-R14) | Video of an original executing the three-floor elevator |
| O-R6 | Whether the elevator hang is machine coast or operator hand-parking. 2026-10-13: no page prints that a parked elevator ignores calls; under the Exp 9 wiring the relays stand the same at D6 and in the gap, so the model answers a call from the gap (simulated in the 2026-10-13 motor review: from the gap, a floor-1 call runs 6…1 and lights floor 1, a floor-3 call runs 7…13 and lights floor 3). What the errata's "stuck" covers beyond the dark indicator is open | Reproduce it as a **parameterised regression test**, not as asserted physics | Same video |
| O-R7 | Whether the friction drive slips under load during normal running (which would make RUN speed load-dependent) | Ignore | Measurement |
| O-R8 | Whether the wiper reaches D16 via a centre hub, a slip ring or a collector ring | Irrelevant to behaviour; model as an ideal node | Under-panel photograph |
| O-R9 | Wiper contact face width; single finger or bifurcated | Point wiper — provably equivalent under break-before-make | Same |
| O-R10 | Whether the drive wheel is held by an actual spring or a bent bracket ("spring" is used as a verb; no spring in the parts list) | Cosmetic | Photograph |
| O-R11 | Which electrical polarity turns the dial toward increasing numbers. **Ruled 2026-10-13:** D17 at +, D18 at − (negative V(D18)−V(D19)) is increasing. Printed support: Book I p.23 Exp 13 ("First, light 5 flashes and then light 6 flashes": D1, then D2); Books V–VI p.6 Exp 5 ("After the light has turned green, it will go to amber (light 5) and return to red again"); Books V–VI p.11 Exp 9, whose trips keep their selected direction (steps 4, 5, 7) only in this sense; Books V–VI p.7 Exp 6 ("indicates a revolution ... when the dial has completed 15/16 of a revolution": the count runs 0 to 15 with D17 fed + through 6L/6K and D18 on M-, so the page states D17 + / D18 - turns toward increasing numbers; no Step 6 assert covers it, swapping D17 and D18 leaves every `V-EXP6` assert passing, and a `tools/motor-claims.ts` claim is proposed in `docs/plans/phase-5-step7-notes.md`); Books V–VI pp.56–57 Tug of War, whose 9 and 7 are reached from 10 and from 6 in this sense (wiring re-read, traced and simulated; see `docs/DECISIONS.md`, 2026-10-13, *C13 resolved*). Consistent, by inference: Book I Problem 17 ("back and forth between numbers 1 and 6") and the rotary.md §6.2 metronome arcs. Exp 4 disagrees with itself: p.5 "lights 4, 5 and 6 on and off in succession" fits this sense, p.4 "from red to green to yellow" does not; p.5 can also be read as a plain list, which leaves p.4 as Exp 4's only explicitly ordered sentence. No V-EXP4 Step 6 assert covers direction: with D17 and D18 swapped every assert still passes (reviewer scratch run, lamp order 4-6-5). The earlier convention was the reverse and had no source | `[likely]`; raising it is Tom's call | A second-edition manual, or video of an original running Exp 13 from D0 |
| O-R12 | Which brake sets the overrun when one transfer cuts RUN then shorts STOP, and whether an undriven gap of at most one stroke costs coast. No source speaks to momentum (O-R5) | `TRANSFER-COAST-DEFER`: hold the one-shot coast while any mover is mid-stroke, capped at the longest stroke; STOP short → stop-shorted, drive back → none, landed / power lost / cap → drive-removed (architecture §13.4.5), `[unverified]`. A drive that resumes reversed reseeds the dial's chatter history, at most once per dial chatter window and never while the dial is suppressed, so a reversal-driven hunt is still flagged (architecture §9.2, 2026-10-14: C2 `I-EXP14`'s false `! dial chatter`) | Video of an original running Tic-Tac-Toe's first move and the elevator |
| O-R13 | `V-EXP12`: coil flyback after the pb6 release back-drives the motor at about 3.6% of `run_mrpm` (-1616 mrpm against 45000) once the relay tree opens the STOP short; when that creep ends (rate rounds to 0, about 16 ms later) the full one-shot `coast_udeg_drive_removed` fires in the direction of the creep and moves the dial one pad (c7 to c6, 154.04 deg to 134.04 deg). Eight post-release expects fail (script[27,66,101,136,202,239,274,313]), against Books V-VI p.23 "The pointer knob of the rotary switch will turn to the number \"drawn\" on the matrix." The one-shot offset ignores the speed it stops from. Second instance: `V-EXP20` (in-flight, untracked) fails script[63] at HEAD, dial expected c4 and got c3, for the same reason and with the same creep ending at -11 mrpm; with the fix it has 0 failures. Repro: `node bin/minivac-trace` on `test/conformance/fixtures/C2/V-EXP20.fixture.json` in the main repo. With `coast_udeg_drive_removed` 0 the fixture has no dial failures (diagnosis only); the coil inductance behind the flyback (`L_coil_uh`, `V_arc_clamp_mv`) is `[unverified]`. `V-EXP12` shows the creep at its script[27] | `COAST-SCALES-WITH-SPEED`: the one-shot offset is scaled by the rate the drive left at, offset x min(1, abs(last rate) / `run_mrpm`), exact integers rounded half away from zero, no profile constant changed (architecture §13.4.5, `rotary.md` §3.3, O-R5), `[unverified]`. Capped at 1, so every stop at or above RUN (including power across STOP, Maintenance p.9) keeps the configured offset. With it `V-EXP12` passes all eight dial expects; it stays parked on its relay knife-edge (`minDecisionUa` 0). Two goldens moved, timing only (`V-EXP15`, `VI-REACTION`; C2 digests and every printed `?` outcome unchanged); every `tools/motor-claims.ts` claim unchanged at MV601-REF-A. The printed V-EXP5 claim loses margin (fine sweep, HEAD vs fix): `coast_udeg_drive_removed` passes from 19.45 deg at HEAD and from 19.675 deg with the fix (margin at the shipped 20 deg 0.55 to 0.325 deg, 1.6%); `run_mrpm` passes from 37.0 rpm at HEAD and from 40.5 rpm with the fix; the 2.8125 deg grid point drive_removed 42.1875 deg flipped from pass to fail. The O-R14 space is unchanged | Video of an original running Book V Experiment 12 or any stop-then-release program |
| O-R14 | `VI-MATCHGAME`: Book VI p.55 (PDF p.61) "After the player indicates his move, the rotary switch dial will indicate the number of matches remaining" bounds the drive-removed overrun. With about 3.2 deg of driven travel during relay 4's release (about 12 ms at 45 rpm) and STOP not shorted, the dial rests on the destination pad only for `coast_udeg_drive_removed` <= 13 deg; it rests in the gap at 14-15 deg and one pad over at the shipped 20 deg (script[12], [64], [68] fail). The shipped 20 deg is INVENTED (O-R5) and its elevator rationale (the D6-D7 hang, O-R6) is void since `TRANSFER-COAST-DEFER` (O-R12). The value must also stay at or above `coast_udeg_stop_shorted` (5 deg). Separate blocker: relay 4's pull-in margin is 5 uA against `min_decision_ua` 14 on every pb4 press, independent of coast. `V-EXP6` (Books V-VI pp.7-8) sits on the same edge: after pb5 stops the three-revolution run (pb5 lands on c13 at 4263.6 ms; relay 6 releases the drive at 4288.1 ms, about 6.6 deg into the pad) the wiper rests on c13 for a coast below about 10.3 deg, in the gap from about 10.3 to 15.9 deg, and on c14 above that (reviewer estimate from the trace, 2026-10-14). The p.8 dial plate prints 27.64 mph in sector 13 only (band 3), which points to c13 (derived). No `V-EXP6` assert depends on it, so its digest moves with the constant: refresh the digest in the same commit as the coast-constant change and expect the sweep to report the rest as FRAGILE (digest only, no assert). A sweep over the then 44 fixtures changed only `VI-MATCHGAME` (at 13, 10 and 8 deg), and `V-EXP12` failed at every value | **Resolved 2026-10-14 (Tom's ruling).** `coast_udeg_drive_removed` is 9.54 deg, the middle of the measured band [5.692552, 13.385387] deg (the ruling's "about 9.3°" came from the coarser (5.625 + 13) / 2). The upper edge is script[68], the machine-move until on the gap (p.55 "the rotary switch will turn to the number of matches remaining after the machine's move"), not a printed rest: at 13.385388 deg the dial does turn, but c13->gap->c12 completes inside the fixture's 50 ms pb6 tap (gap at 60333.6 ms, c12 at 60354.4 ms, pb6 release and until start at 60354.5 ms), so the until never sees the gap. The printed rest asserts after the player's move (script[10], [12], [62], [64]) hold to 13.713926 deg (first fail 13.713927, script[12] expected c14, got gap). By the ruling's letter (every printed assert) 9.54 deg stands; if Tom discounts the tap-window edge the band is [5.692552, 13.713926] deg and the midpoint 9.70 deg (9_703_239 udeg). Tom's call. At 9.54 deg all 8 asserts pass, every printed claim and printed assert still passes, and `VI-MATCHGAME` lands in C2 (digest 402 -> 430 events). Its relay-4 knife-edge (minDecisionUa 5 against 14) trips the bless gate and all 6 BLESS-ROBUSTNESS perturbations hold (DECISIONS.md 2026-10-13). `V-EXP6` rests on c13 after pb5 (below the about 10.3 deg edge), its digest refreshed in the same change. O-R5 carries the band | Tom's ruling to bound `coast_udeg_drive_removed` at 13 deg or less from the printed rest, or video of an original playing the Match Game |
| O-R15 | `I-EXP14`: a motor drive sign change through a slide-switch transfer prints a false `! dial chatter 9 transitions in 333.2ms` (trace 695.6 ms). While sw6 is mid-stroke, `stepRotary` takes the deferred-coast path (`rotary.ts` 401-408: rate 0, `moversInTransit`, `coastDeferTicks++`), which holds the dial and leaves `lastMotorMrpm` at its previous value. When sw6 lands, drive resumes at the opposite sign with no deceleration, so `machine.ts` 1103 `dialCoasted` is never true and `reseedDialChatter` is skipped. The c8 dwell shrinks from 62.5 to 60.2 ms, which puts a ninth transition in the 333.2 ms window; architecture §9.2 sets that window at exactly 8 transitions for 45 rpm, with zero margin. No printed assert is affected (chatter suppression changes only the flags and the annotation). `tier-c-fixtures.spec.ts` 61 asserts no ` ! dial chatter ` for `I-EXP14` and fails on it. This changes a §9.2 rule (when the dial chatter history is reseeded), not a profile constant. Repro: `node bin/minivac-trace test/conformance/fixtures/C2/I-EXP14.fixture.json` | Core fix in progress (reseed or clear the chatter history on a change of drive sign or a deferred-coast resume, not only on a coast to zero); no fallback needed once fixed. Opus review must confirm the fix is source-backed and not curve-fitting. Do not move the switch time in the script to dodge the detector. Until the fix lands, either the golden is blessed with the `!` line and the spec marked expected-fail, or the bless waits | The fix itself, then re-run `I-EXP14` |
| O-R16 | `VI-TUGOFWAR`: a re-set whose direction crosses the 7-9 arc stops the simulated wiper on 8, which is neither printed end position. From rest at 9 with pb1/pb6 in the same position (or from rest at 7 with them different), pushing pb4 and releasing it as soon as the dial leaves its contact (the fixture's own reading of "as the rotary switch knob starts to turn") leaves the wiper on c8, against Books V-VI p.57 "The game ends when the pointer knob stops—either at 9 (player 1 wins) or at 7 (player 2 wins)." Holding pb4 until the wiper clears 7 gives 7. How long a human holds pb4 is not fixed by the page, so the case stays out of the fixture. Repro (session scratchpad): `b07-09/VI-TUGOFWAR-r3/cross.fixture.json`: power on, advance 5000 (rests on c9, both buttons up), button4 1000, until dial gap (5055.6 ms), button4 0, advance 5000; the trace ends `dial gap->c8` at 5076.4 ms and stays there. Separately, the fixture's game-5 tug fires at a fixed 770 ms after the pb4 release: it holds at 10-60 rpm and fails from 70 rpm (770 ms is about 14.4 contacts there, and the dial reaches 7 before pb1 is pushed). 45 rpm is the manual's own example rate (`rotary.md` §3.4) | The fixture asserts only re-sets that move away from the arc. Keep the game-5 rate caveat in the fixture note and re-time game 5 if `run_rpm` (O-R3) ever moves above about 60; do not convert it to a dial-position `until` (the page prints no mid-run position) | Video of an original playing the Tug of War, or Tom's ruling on where pb4 is released |

### Netlist and structure

| # | Question | Fallback | Would settle it |
|---|---|---|---|
| O-N1 | Whether the relay coil pair (`nE`,`nF`) is galvanically distinct from all six contact nodes | `IDEAL-ISOLATED-COIL` | Ohmmeter, or an under-panel photo of the eight lugs |
| O-N2 | Whether the slide switch's two transfer sets are isolated. `[likely]` from Book V p.13's Gray-code decode, which is impossible under a common arm; not traced to a full truth table | `ISOLATED-SETS` | Trace the whole Book V p.13 program to a truth table |
| O-N3 | Whether the relay has a high-impedance internal frame bonding the two arms. Experiments 5 and 6 rule out a **low**-impedance bond, which is what the simulator needs | Full isolation | Ohmmeter |
| O-N4 | Which physical stack (front vs rear) is `G/H/J` and which `K/L/N` | Do not make front-vs-rear identity load-bearing | Close photograph of a relay against its terminal rows |
| O-N5 | Whether the capacitors were factory-fitted in 1961 601 production or came with the 1962 kit. B1 (1961) says "may be ignored"; B7 (1962) states values as fact; B7 p.8's "the highest valued resistor **in the kit**" proves a resistor kit was a separate article, which weakens the symmetry argument. CHM's unit shipped with six loose electrolytics in the box | `FITTED-CAPS`, as a **config flag**. Books I–VI never touch them, so the base corpus is unaffected either way | Under-panel photograph of a 601 predating the accessory manual, or an SDC accessory catalogue |
| O-N6 | Whether the 500/1000 µF split is identical on the 601 and the 6010 — stated once, for "the MINIVAC", in a manual titled for both | Apply to the 601, carrying the 601/6010 scope flag | A 6010-specific manual, or a measured example of each |
| O-N7 | Capacitor voltage rating and construction | `POLARIZED-ELECTROLYTIC` | Photograph of a fitted capacitor |
| O-N8 | Whether dial position 0 has the same contact geometry as 1..15 (B1's under-panel drawing renders 0 as a small rectangle — probably draughtsmanship) | `UNIFORM-CONTACTS` | Under-panel photograph |

### Panel and rendering

| # | Question | Fallback | Would settle it |
|---|---|---|---|
| O-P1 | Panel substrate material (hardboard / phenolic / painted steel / aluminium). MM's repair language fits several equally. Two pale chips at the upper left of the DECIMAL block hint at a light substrate under a dark finish but prove nothing | Render as a matt painted dark surface; do not model material | A photograph of a cut edge or the underside, or SDC production artwork |
| O-P2 | True paint colours — the blue of the case and stripes, the black of the field, the cream of the printing | Sample off **PH2** (a greener teal than PH1's grey-blue); treat as approximate. Never sample off PH1 | A colour-managed photograph of an unfaded unit with a target in frame, or a factory paint spec |
| O-P3 | Typeface family for the legends and for the `Minivac 601` logotype | Substitute a heavy geometric grotesque; claim no family | Higher-resolution flat scans, or SDC artwork |
| O-P4 | Absolute panel dimensions and jack pitch. The only figures in circulation — 5⅛ × 24 × 13¼ in, 9 kg — come from Wikipedia alone and contradict CHM's 10 lb | Relative proportions only, **re-measured off PH2**. No millimetre figure may be encoded as fact | A dimensioned drawing, replica CAD, or a scale-referenced orthographic photograph |
| O-P5 | **Not what is atop the POWER strip — that is closed (see `panel.md` §7.4 and §11).** The factory part is the red power light: MM p.3's power-supply diagram draws a POWER LIGHT across the DC output and **no fuse**, MM's spare-parts list (6431–6491) carries 6435 *Light Assembly* and no fuse part, and PH2's black `FUSE` cap is an owner retrofit — it is oversize, overhangs the panel and obscures the word `CIRCUIT` in the legend below, which PH3 shows fully legible. `[verified]`. What remains open is only the **lens and bezel type** of that light | Draw it like the panel's other lamps — red translucent lens in a cream bezel — on the knurled threaded barrel PH3 shows. No netlist consequence: the POWER block has no jacks | A macro photograph of an unmodified unit's power light, or SDC parts documentation |
| O-P6 | Pointer-knob colour and pointer form | Do not commit to "red knob, blade reaching the ring" | More dated units, or SDC parts documentation |
| O-P7 | Whether the thin light ring around each jack hole is printed ink or the drilled edge exposing substrate | **Draw the ring** — its appearance is certain either way | A macro photograph of a single jack, or an unpainted panel |
| O-P8 | What the two round pale discs flanking each slide switch (and bracketing the POWER switch) are | Draw as rivet heads, `[likely]` from MM p.9's "drill out the rivets" | An underside photograph |
| O-P9 | Whether the two pale marks at the upper left of the DECIMAL block are fasteners or finish damage | Omit from a clean redraw | Underside photograph, or a second unit |
| O-P10 | Original patch-cord specification: wire gauge, insulation colours, the length set and its counts, taper-pin form/finish/length, and whether wires shipped sorted (CHM's "three bags") | Render taper pins grey metal per PH2; ship one colour token (`#cf5c4c`, already a recorded UI invention) and record any colour or length set as a chosen redraw token, never as a fact. Encode no inch figure. Gardi's 20 AWG / 8-16-24 in / yellow-red-blue set may **not** be the source: it is downstream and its author measured nothing from an original | A photographed original wire set with a scale in frame, an SDC accessory catalogue, or a museum lot photograph |
| O-P11 | Case height, side-wall profile, edge treatment, and the number, size, shape and placement of the rubber feet | Derive height as a proportion of the 1.80:1 top face and label it a chosen token (0.20 W); vertical side walls with a chosen edge radius; the top face wraps, so no separate side colour token; four feet as an unsourced choice. The Wikipedia 5⅛ × 24 × 13¼ in figure is named as a **rejected** candidate — it is unverified and its companion weight is contradicted by CHM's 10 lb | A scale-referenced oblique or side photograph, or a dimensioned drawing |
| O-P12 | Which knob form a 3D build commits to. O-P6 records the form as unknown and rules "do not commit"; a renderer must nevertheless render one | Adopt PH2's dark brown/maroon cylinder with the white pie-wedge on the top face terminating at the knob's own rim (≈150 px against the dial's inner circle at ≈195 px), because PH2 is the authoritative photograph and PH1 is forbidden for colour — and record the choice with both rejected forms named: PH1's red cylinder with a cream blade reaching the ring, and B1 p.20's teardrop/leaf | More dated units, or SDC parts documentation (the same evidence that would close O-P6) |
| O-P13 | Sound layering and per-cue provenance for a tactile build: which cues exist (relay operate, relay release, motor/drive loop, spin-up/down, cord insertion/withdrawal, switch throw, breaker trip/reset, dial hand-drag), their attribution and their mix | Ship only the relay cue as sourced (BK1 p.15); every other layer is labelled simulated, carries a `data/public-assets.json` record ending "is not an authenticated MINIVAC recording", and no per-contact click is used to imply a ratchet. Buttons stay silent | A recording of a running original |
| O-P14 | Lamp optical behaviour: lens translucency, diffusion, filament visibility through the cap, glow spread, and whether any bloom is warranted at all | Warm, dim, low-colour-temperature emission driven linearly by the core's `milli` 0..1000; no persistence effect beyond the core's own ramp; any glow or bloom recorded as a labelled aesthetic invention with its parameter values as chosen tokens. There is no bloom evidence anywhere in the package | A photograph or video of an unmodified powered unit, or pulling one Light Assembly (SDC 6435) |
| O-P15 | Control travel distances and actuator throws: pushbutton stroke and dead-zone depth, slide-switch throw, relay crossbar travel, breaker pop-out distance, knob turning friction | Choose travels and proud heights from the existing `travel` state fields and label every distance a chosen token. The package supplies durations, never distances | A scale-referenced macro photograph, or a measurement session on a surviving unit |
| O-P16 | Relay body three-dimensional form: coil bobbin diameter and length, crossbar block dimensions and slot depth, contact-stack spring count and spacing, mounting-screw positions, whether any 601 relay carried a dust cover, **and the RGB values of the coil bobbin, the crossbar block and the contact springs — the package gives "white/cream" and "brown/copper" as descriptions only, with no value anywhere** | Model from PH2's top view only, in the settled panel-face order — white coil bobbin, white crossbar block with a vertical slot, then the upper and lower contact stacks to its right. Use four spring strips per stack with each strip filling 0.5 of its pitch; both count and fill ratio are chosen redraw values because the photograph does not resolve spacing. **No dust cover**: the only photograph of Minivac relays in the round with covers is PH4, a 6010, forbidden for 601 geometry | A close photograph of a 601 relay against its terminal rows, or identification of SDC part 6437 |
| O-P17 | Plate recess depth and the power-panel assembly depth. The three dark sub-panels are set into a blue console face, and the upper-right one is a removable *power panel*, but the recess depth is given nowhere | One recess-depth token as a fraction of panel width, labelled a chosen token and applied uniformly to all three plates. Consequence: the blue stripes are the tray showing through the gaps between plates, not paint on the plates | A scale-referenced oblique photograph, or an underside photograph showing the plate mounting |
| O-P18 | Bezel geometry **and surface response**: outer diameter and proud height of the lamp and indicator bezels, the pushbutton bezel, the breaker bezel, and the POWER jewel's knurled threaded barrel; **and the surface response of each — the package names bezel *colours* (lamp and indicator white/cream; pushbutton and breaker chrome/cream) but no gloss, metalness or roughness anywhere, no source describes the finish of the blue console frame, and no source specifies illumination for presenting those invented material responses** | Chosen tokens for each, with the sourced **colours** kept distinct: lamp and indicator bezels white/cream; pushbutton and breaker bezels chrome/cream; the jewel a red translucent lens on a knurled barrel. Use the chosen 0.004 W proud height for all four bezel-ring types; keep the jewel barrel's separate 0.008 W height. Reuse the pinned 0.0038 W border width for lamp, pushbutton and breaker bezels (`main.css` 594 and 627); the jewel keeps its pinned 0.0022 W width. Use one chosen neutral directional key plus flat ambient fill only to display the material response; it makes no claim about original lighting, and framed runtime captures decide whether it is adequate. **The jewel's lens and bezel *type* is O-P5's question, not this one**. The 16:24 hole-to-ring ratio is **printed ink** and must never be used as a bezel or chamfer dimension | A scale-referenced macro photograph of one lamp assembly and one pushbutton, or a sourced presentation-lighting requirement |

### Corpus and fixtures

| # | Question | Fallback | Would settle it |
|---|---|---|---|
| O-C1 | Which physical slide-switch position (LEFT/RIGHT) selects which throw in the Book V metronome | Either; assert only monotone periods. The general convention is settled (B1 pp.18–19; B234 II p.9 "switch right = 0, switch left = 1") | A second-edition manual |
| O-C2 | Whether Book I Experiment 13's combined program prints `5-/D18` or `6-/D18` | Electrically identical under the `+`/`-` commoning rule — **not** a discrepancy | Page image of B1 p.23 |
| O-C4 | Book I answer pages, printed 29–32 | Omit the hand-lettered answers from the corpus | Image reads of those pages |
| O-C6 | Which programs are designated conformance fixtures and what the pass criterion is — the manuals define no such thing | The tier system in `programs.md` §2.1, with the C1/C2 split flagged `[unverified]` as a repair to a self-contradiction in the source research | Nothing external; it is a project ruling |
| O-C7 | Which of `M10`/`M11` is machine and which is player varies by application — Tic-Tac-Toe puts the machine's play on `Mnb`, character recognition puts `M10`'s connections on the **top** terminals | Both are correct for their application. Do not unify | Already settled; recorded to prevent a "fix" |
| O-C8 | ER-32's "remove 5L/6G" (errata.pdf p.3, right column, "page 12: program corrections for automatic toll collector"; image-read, unambiguous) leaves 5K and 5L unwired. Relay 5 set 2 then has one wired terminal and 5N/6K–4X/6L is a dead stub, so no nickel or penny count reaches relay 3, and Books V–VI p.13's "When 10¢ has been deposited, output light 1 will come on" fails for two nickels, a nickel and five pennies, and ten pennies. This follows from the topology alone. The uncorrected list, and ER-32 with 5L/6G kept (56 wires), both pay on two nickels and on ten pennies. Neither pays on a nickel and five pennies in the simulator: with the dial resting on D5 the carry to 4E lasts only about 19 ms of wiper-on-pad time after pb6 makes, which rests on O-R1/O-R3/O-R5 `[unverified]` | The `V-EXP10` fixture keeps ER-32 as printed and asserts only the dime payment and the alarm on/off claims. Manual defect (plan Step 6): never in the fix queue. **Ruled 2026-10-13 (Tom):** ER-32 stays as printed; Step 7 adds a speculative variant with 5L/6G kept | A second printing of the errata sheet, or an original toll-collector build |
| O-C9 | ER-36 (errata.pdf p.4, no printed page number: "page 30: \"CQ\" transmitter program correction: change 5X/6E to 5X/6C") shorts the supply on the stop button. The printed 5Y/6Y, 6H/6Y and 6H/6+ put 5Y at +, and the printed 6C/6-, which the erratum leaves, puts 6C at −, so pb5 (5X–5Y) joins + to − and trips the latched breaker (relay layout nC–lamp–nE–coil–nF, `jack-map.md` `[verified]`). The trip does halt transmission, so the printed "To stop transmission, push pushbutton 5" (Books V–VI p.30) is reached only through the breaker. The uncorrected 5X/6E stops cleanly: pb5 puts + on 6E and shorts out relay 6's coil (brief chatter, timing-only `[unverified]`). Unsettled readings: the erratum is wrong; it also meant to move 6C/6-; or a trip was the intended stop | The `V-EXP16` fixture keeps ER-36 and does not assert the pb5 stop. Manual defect: never in the fix queue. **Ruled 2026-10-13 (Tom):** keep the drop; Step 7 adds a speculative variant on the uncorrected 5X/6E asserting a clean stop | A second printing of the errata sheet, or the corrected circuit diagram ER-36 asks for |
| O-C10 | `V-EXP15`: Book V p.25 sets no rotary start position. With the dial on D15 at power-on, the wiper (D16/M+) feeds 5C/D15, relay 5 latches (5C/5G) and light 2 lights before pushbutton 6 is pushed, so neither the printed "Lights 1 through 6 will come on in order" nor ER-35's power OFF/ON re-set ("to re-set the automatic sequence control, turn power OFF, then ON again") holds from D15. `[unverified]` inference from topology. Run 2 of the fixture starts where run 1's stop left the dial (the c11-c12 gap since the 2026-10-14 coast of 9.54 deg; c12 at the earlier invented 20 deg, O-R5); run 2's own stop leaves the dial in the c14-c15 gap (on D15 at 20 deg). Observed after a second run with the dial left on c15: `relay5 nc->mid` at 11.8 ms, `outLamp2 dim->on` at 22.1 ms, assertion `outLamp2: expected off, got on` | Fixtures start at c0 and never re-set from D15. Report FRAGILE, do not fix; include `V-EXP15` in the motor-sweep run | Printed rotary start position for Experiment 15, or video of an original running it through a re-set |
| O-C11 | Whether a fixture that trips the knife-edge bless gate (`minDecisionUa` < 14 µA or `minTickGap` < 6 ticks) is fragile on real hardware. The gate is a proxy: it measures one tick's overshoot of a threshold, not headroom. The BLESS-ROBUSTNESS check (architecture §9.3, DECISIONS.md 2026-10-13) replaces the refusal with six perturbed runs — relay thresholds ±150 mV, coil resistance ±10%, lamp thermal τ ×0.5 and ×2 — whose magnitudes are invented harness parameters `[unverified]`, not measured spread | `BLESS-ROBUSTNESS`: a tripped, non-marginal fixture blesses only if every assert holds under all six perturbations | Measured relay-to-relay spread (pull-in, drop-out, coil resistance) and lamp warm-up time from original units |
| O-C12 | `IV-EXP12`: whether Book IV p.80's "(A slide switch RIGHT represents 0; a slide switch LEFT represents 1.)" (Experiment 8 step 1, describing that program's output lights) counts as printed for p.85's "The rotary switch will indicate the decimal equivalent". p.85 itself states no switch-position-to-bit-value or dial-position tie, and Books II and III use LEFT differently (selected / YES). All nine dial asserts in the `IV-EXP12` fixture depend on it | **Ruled 2026-10-14 (Tom):** the convention counts as printed for Book IV's later binary programs; IV-EXP12 lands. Other books do not inherit it. `IV-EXP12` parked; Tom's call at end review. If yes, record in `docs/DECISIONS.md` so the other Book IV slide-switch binary programs follow it; if no, withdraw the fixture from the printed batch and route it whole to Step 7 | Tom's ruling |
| O-C13 | `IV-EXP10` (Book IV p.83 = PDF p.89): ER-27 (`errata.pdf` p.3, right column, "page 83: Program correction for Experiment 10", image-read at 600 dpi) removes `2C/3G`, `2Y/6S`, `3C/4G`, `5C/6K`, `6F/M10` and adds `2E/3G`, `2Y/3G`, `3E/4G`, `5E/6K`, `6C/M10`, `6F/M+`. It keeps the printed `3G/3N`, so as printed it puts three plugs on two-hole terminal `3G` (`2E/3G`, `2Y/3G`, `3G/3N`; `jack-map.md` `[verified]` gives every section terminal 2 holes). The corrected 57-wire program cannot be wired: `terminals.ts` raises `hole_occupied` at `3G`. Manual defect, not a transcription error: the 56-line table and the erratum both match the page images. Separately, p.83 does print that the first subtraction result appears in the output lights ("The result will appear in the output lights:", figure 110 over 110 minus 101 over 001 over 110), so a corrected wiring would have to assert it; the earlier record claim that p.83 prints no lamp pattern after a subtraction was wrong. `tools/corpus-reachability.ts` `parsePrograms` runs `IV-EXP10` on the uncorrected 56-wire list, so its reachability result is for uncorrected wiring only | `IV-EXP10` parked (its fixture is in the session scratchpad); no printed fixture; Tom's call at end review. Scratch diagnostics, not fixtures: (1) ER-27 without its `2Y/6S` to `2Y/3G` line (keep `2Y/6S`, 57 wires) loads and passes both p.83 lamp claims; the knife-edge trips (`minDecisionUa` 11 < 14, `minTickGap` 9) and all 6 robustness perturbations hold. (2) `2Y/3G` re-routed to `2Y/3N` loads but fails script[10] (`outLamp2` expected on, got off). Route to Step 7 / Tom's ruling | Another printing of the errata sheet or the Book IV page, or a surviving unit wired for Experiment 10; otherwise Tom's ruling |
| O-C14 | Schema gap: the fixture observable set has no motor direction or speed field (`fixture.schema.json` `obsDialValue` is `c0`..`c15` or `gap`). Printed reversal claims cannot be asserted: `I-EXP14` (Book I p.24 step 5, "The motor reverses direction and the pointer knob turns in the opposite direction.") and any similar Book V-VI reversal claim. A dial-position `until` also matches when the wiper comes the long way round, and a discriminating `maxMs` would rest on an unprinted upper bound on run rate (O-R3). The `I-EXP14` step-5 `until` proves only that the knob keeps turning after the switch: the same script with the switch command removed still passes it. The simulator does reverse the drive (`corpus-smoke.md`: `power: motor -45000 mrpm` then `sw6 throw: motor 45000 mrpm`; dial c15, c14 ... c8 before the switch, c9, c10 ... after it) | Leave the reversal unasserted. It is an observability gap, not a derivation, so Step 7's blind-derivation path does not cover it. Candidate that needs no schema change: a coded claim `I-EXP14/switch6-reverses` in `tools/motor-claims.ts` (event order: the first dial make after sw6 lands is the contact the wiper came from), which puts it in the motor sweep. A contract or schema change adding a motor direction observable goes to Tom | Tom's ruling on adding a direction observable |
| O-C15 | `VI-FORTUNETELLER`: whether lights 5 and 6 ("MINIVAC's 'contemplation' lights", Book VI p.58) should flicker visibly during the pb2 hold. The page does not say they flash or that anything runs; the free-running ring is `[likely]`, from the cross-wiring (`5K/6F`, `5N/6E`, `5E/6K`, `5F/6N`) and p.59 "Push pushbutton 2 to allow MINIVAC to generate a random number.", and not stated. In the trace `outLamp5` and `outLamp6` go steady on at 88 and 95 ms and never change while relays 5 and 6 toggle about every 15 ms: the lamp thermal tau smooths the toggling | Ship the model as is; not a fixture defect and not printed. Step 7 should know the contemplation lights do not visibly contemplate in the simulator | A video of an original during the hold, or a measured lamp warm-up and cool-down time (O-C11) |
| O-C16 | Whether the 2026-10-14 vacuity refusal (a tripped fixture with no expect or until step is refused outright) should extend to a fixture whose every assert finishes before the first tripping decision. Concrete case: `V-EXP3`, whose only assert (script[1] `until dial=gap`, 31.3 ms) comes before relay 6's first knife-edge decision (225.0 ms, margin 0), so "all 6 perturbations held" says nothing about the knife-edge. A reviewer rerun of the six perturbed profiles kept the oscillation (relay 6 transitions 252-254 against 254, dial transitions 835-841 against 838, perturbed `minDecisionUa` 25-198), so the fixture is not at risk. For Tom to decide; not a standing rule | Bless under the existing gate, with the note stating the vacuity | Tom's ruling |
| O-C17 | How to record an erratum whose printed `from` is not a physical wire. `III-MINDREADING` ER-14 (`errata.pdf` p.2, "change 5V/45 to 5V/4S") is applied in `wires` but cannot be listed in `errata_applied`: `helpers.ts` 139 runs `canonicalPair` on `erratum.from`, and the printed `5V/45` names a terminal `45` that does not exist. Same shape for any later erratum that quotes a misprinted terminal | Keep the note-only convention as the fixture documents it (the fixture note says ER-14 is not listed). Relaxing the loader reaches test infrastructure and the C# mirror, so it is Tom's call; if it changes, add `{"id":"ER-14","from":"5V/45","to":"5V/4S"}` to `errata_applied` and drop the "NOT listed" sentence from the note | Tom's ruling |
| O-C18 | `IV-APX-SHIFTREG`: whether Book IV p.82's "pushing the appropriate pushbuttons (in this case, pushbuttons 4 and 5.)" / "the output lights display the number—000110" (`IV-EXP9`, PDF p.88), with p.80's left-shift definition, counts as printed for p.87's "The number will appear in the output lights" and "The shifted binary number will now appear in the output lights" (PDF p.93). O-C12 does not reach it: the program uses no slide switches (none of the 60 wires touches an R/S/T/U/V/W terminal). If ruled yes, the fixture (pushbuttons 1, 3, 4, 6) would assert lamps 101101 after entry and 011010, 110100 and 101000 after revolutions 1-3 (the simulator already shows these), each taken after the dial has rested on D0 for at least 1000 ms, never as an `until` on a pass-through; whether bit 1 is dropped stays derived | No assert: the whole fixture goes to Step 7. A draft fixture is kept in the session scratchpad `step7/`, outside `fixtures/C2`, because its bless refuses (`minDecisionUa` 0, no expect or until step for the robustness check) | Tom's ruling |
| O-C19 | `IV-EXP11`: whether Book IV's output-light reading, light 3 high order through light 6 low order, counts as printed for p.85's "The binary equivalent of the decimal number will appear in the binary output lights". Basis: p.77 (PDF p.83) "The answer will be displayed in binary output lights 3, 4, 5 and 6. For example, if lights 3 and 6 are ON and lights 4 and 5 are OFF, the answer is 1001 (9)."; p.72 (PDF p.78) "Binary output lights 4, 5 and 6 will read OFF, OFF, ON or 001."; p.79 (PDF p.85) "light 4 is OFF, and lights 5 and 6 are ON. This is read as 011". p.84-85 state no lamp-to-bit tie, and O-C12 names slide switches only. The trace already gives 1={6}, 2={5}, 3={5,6}, 4={4}, 5={4,6}, 6={4,5}, 7={4,5,6}, 8={3}, 9={3,6}, 10={3,5}, so a yes needs no simulator change. The earlier fixture note cited p.70 for the 001 sentence; it is on p.72 | If ruled printed, positions 1-10 become expects in `C1/IV-EXP11`; otherwise they stay in Step 7 and the fixture asserts only decimal 0 (all lamps off) | Tom's ruling |
| O-C20 | `IV-EXP9`: whether p.80's display rule ("The number is now displayed in the binary output lights.", Experiment 8 step 1, PDF p.86), which p.82 brings in with "as described in experiment 8", counts as printed for the lamp states after each "Enter the number which you recorded in the slide switches" step (000110, then 011110, buttons released). p.82 states the numbers but prints no reading at those two points. O-C12 already counts p.80's slide-switch convention as printed for Book IV's later binary programs. The simulator already shows both values (outLamp4 on at 1327.8 ms and outLamp5 on at 1341.6 ms before the first shift; lamps 2-5 on at about 5051 ms before the last shift), so adding them cannot fail | Derived, Step 7: the fixture asserts only the readings p.82 states with "now show"/"will now read". If ruled printed, add two expects after the settles that follow the switch sets (1000,1000,1000,0,0,1000) and (1000,0,0,0,0,1000): lamps off,off,off,on,on,off and off,on,on,on,on,off, citing p.82 plus the p.80 display rule | Tom's ruling |
| O-C21 | `VI-MAZE`: (a) whether an error fully re-sets the relay chain on hardware without a power cycle. Book VI p.54 says "Whenever an error is made, relays 4, 5 and 6 must be pushed to the left before play is resumed" (short-path variant), while ER-42 (`errata.pdf` p.4) says "Note — to re-set the game, turn power off, then on again." The fixture's game 5 resumes by the p.54 sentence alone, and the model re-sets itself (relays 6, 5 and 4 drop at trace t=162-172 ms after the M9t touch), so the assert holds only on the model's self-re-set. (b) The order of the manual pushes of relays 4, 5 and 6 is unstated (session scratchpad probes `b07-09/VI-MAZE-r2/seq456` and `seq654`) | The p.54 resume as scripted, with an ER-42 power cycle as the alternative; relays pushed simultaneously | A video of an original, or Tom's call on which re-set reading to script |
| O-C22 | `VI-MAZE` and `VI-SECRETCODE` (the `VI-SEQREC` family): the model lights light 6 at power-on, before any touch or push (trace: `outLamp6` dim->on at 22.1 ms after every power-on; it goes off when the first correct step latches relay 6). The pages say "light 6 indicates error and re-set" (Maze p.53) and "If light 6 comes on, an error has been made" (Secret Code p.52) and never say it is lit before play. The fixtures' light-6 asserts follow an observed off->on transition, so they are not vacuous, but the idle state is derived. The same shape holds for light 1 ("comes on" implies off before; the page prints no off state) | Ship the model as is; Step 7 asserts outLamp6 off after the first correct push and outLamp1 off before the solving push | A video of an original at power-on |
| O-C23 | Whether a fixture with zero expect or until steps lands: a faithful script with no printed assert. Four exist in the Step 6 batch: `III-3GIRLS-BOOLEAN` (tier A, blessable, no knife-edge, 61 tick gap), `IV-APX-SHIFTREG`, `VI-FORTUNETELLER` and `V-EXP13` (all three refused by the vacuity rule, O-C11; `V-EXP13`'s tripping margin is 13 uA against 14, routed whole to Step 7). Wave 3 adds `III-NOT` and `III-TELEVISION` (both tier A, blessable, zero asserts); they need the same routing rule. No committed fixture has zero expects today; `III-3GIRLS-BOOLEAN`'s only observable is light 3, and the page names no switch setting | Hold zero-expect fixtures out of the manifest and queue their derivation for Step 7 (`III-3GIRLS-BOOLEAN`: light 3 for the eight settings, checked against the p.58 error expressions) | Tom's ruling |
| O-C24 | `V-EXP1`: the Book V p.2 worked example ("moving slide switch 1 to the LEFT will turn light 1 ON if slide switch 2 is RIGHT. The light will go OFF if slide switch 2 is now moved to the LEFT") contradicts the printed 5-wire list (`1A/1+`, `1B/1V`, `1U/2U`, `1W/2W`, `2V/2-`) and the circuit diagram. Those conduct only when both arms are on the same side, under any uniform switch polarity, so the example is the inverse and no relabelling of LEFT and RIGHT repairs it. A manual defect, not a transcription error (400 dpi image read) and not a simulator error. ER-28 states only a relative toggle, which is compatible with the wiring | The example is not asserted. The fixture keeps `FALLBACK-V-EXP1-TOPOLOGY` for the absolute phase | A second printing of Book V, or an original build wired per p.2 |
| O-C25 | `IV-EXP7`: ER-24 (errata.pdf p.3, "page 79: Note on Experiment 7 - if you used the alternate circuit for the counter"; 600 dpi crop) removes `2C/2G`, `3C/3G`, `5C/6K`, `6C/6F`, `6F/M10` and adds `2E/2G`, `3E/3G`, `5E/6K`, `6C/M10`, `6F/M+`. Two of the five remove targets (`2C/2G`, `3C/3G`) are not wired by the IV-EXP6/IV-EXP7 base; the other three are. It may be a misprint for `2C/3G` and `3C/4G` (compare ER-27, Experiment 10, which removes those with a parallel add list), `[unverified]`. The ER-24 light-6 note ("relay indicator light 6 will come ON if the subtraction has proceeded properly") sits inside this conditional entry | Fixture the book circuit only; no alternate-counter variant until resolved | A second printing of the errata sheet, or an original build |
| O-C26 | `FALLBACK-FF2-CARRY-BASE-CIRCUIT` (source label on `IV-FF2-CARRY` script steps 2, 7 and 10). Book IV printed p.70 (PDF p.76) prints steps 1-3 ("Turn power ON. Notice that both relays 5 and 6 are OFF." / "... both relays 5 and 6 are now ON." / "... relay 5 is OFF; relay 6 is ON.") for the 14-wire circuit, before "To add the carry signal, we will add the connections: `5G/5N` `6K/4A` `5L/6L` `4B/4-`". Applying them to the 18-wire circuit is an inference `[unverified]` | The four carry wires are on the lamp-4 path only (`5+`, `5G`, `5N`, `5L`, `6L`, `6K`, `4A`, lamp 4, `4B`, `4-`), so the relay states carry over. Overturned by a carry-wire path that loads either coil before relay 5 drops | An original build, or the p.70 steps re-run on the 18-wire circuit |
| O-C27 | Corpus gap: Book V printed p.21 (PDF p.27) prints "the program for the geometric shape recognition circuit" and has no `programs.md` record. ER-33 ("pages 21 and 22 ... connections from M10 are made to the TOP terminals in the matrix") covers it and `V-EXP12`, not `V-EXP13` (Experiment 13 is on p.24 and wires no matrix terminal) | Record and fixture it when a batch reaches it; until then ER-33 names `V-EXP12` and this circuit | An image read of PDF p.27 |
| O-C28 | Harness behaviour, not a core defect: `settle` treats the machine as quiet when no observable class changes and no relay moves (`test/conformance/run.ts`, `settle_quiet_ticks` 200), so it can return while an output lamp is still cooling through `dim` (`ER-ALTCOUNTER`: lamp 6 current is about 0 within about 25 ms of the count-2 release, the class stays `dim` for about 55 ms). An expect on a lamp that is turning off, taken right after a settle, can read `dim` | Take lamp-off reads after an explicit post-settle advance (200 ms in `ER-ALTCOUNTER`), or use an `until` with a generous `maxMs`. Under lamp tau x2 the same effect appears on `V-EXP13`'s light 4 | Tom's call on whether `settle` should watch filament temperature |
| O-C29 | Phase 5 Step 7 speculative fixtures. Their expectations come from each program's wiring and the rule its page states, worked out by two independent derivations that never ran the simulator, with an adjudicator settling any disagreement. Only values both derivations state are asserted. None comes from a printed answer | `FALLBACK-DERIVED-TOPOLOGY`: every such expect is tagged `unverified` with this source and sits in the speculative suite; it is never counted as verification. A step whose outcome the topology does not settle (timing knife-edges such as V-EXP10-5L6G's carry pulse, O-C8) is dropped | Printed answers, or an original unit running the program |

### History and bibliography — non-blocking by definition

| # | Question | Status | Fallback |
|---|---|---|---|
| O-H1 | Watertown vs Cambridge vs a possible third city | See C14. Moved, not settled, now three-way | Configurable legend string; report, do not resolve |
| O-H2 | Shannon's actual role | Unchanged from IEEE Spectrum's 2016 open question. Wikipedia's `developer = Claude Shannon` is uncited | State documented-vs-marketed and claim nothing more |
| O-H3 | Are the 601 and 6010 electrically identical | Open, but the "no 6010 document exists" framing is gone — B7 is a joint manual | 601-only scope makes it non-blocking |
| O-H4 | Whether Book VII shipped with the 601, the 6010, or a separately sold kit | Open. 1962 copyright; the errata calls the set "six-book", suggesting B7 postdates it | Bibliographic only |
| O-H5 | Whether a period SDC promotional film exists | No evidence found; the only candidate is a 2014 fan video | Search Prelinger / AV Geeks under "Scientific Development Corporation". Not attempted |
| O-H6 | Production quantity and survivor count | Unknown. The single hard datum is CHM serial 1886 | Make **no** population estimate |
| O-H7 | Whether `jkoets/Minivac-601-Emulator` falls under the oracle-only ruling | **Awaiting Tom's ruling.** Treated as in scope pre-emptively; its code has not been read | Tom decides |

---

## 5. What would settle the most at once

Ranked by how many open items each closes.

1. **A measurement session on a surviving unit.** Closes O-E2 through O-E8, the three invented
   constants O-E10 through O-E12, O-T1 through O-T4, O-N1 through O-N3, O-R2, and gives G1 and G2
   real numbers. It would replace most of `components.md` §8 and §9.
2. **An under-panel photograph set of a surviving unit** — rotary assembly (SDC 6473), relay
   lugs, power panel underside, capacitor bank. Closes O-R1, O-R8, O-R9, O-N1, O-N5, O-E6, and
   identifies the relay and lamp parts for datasheet lookup.
3. **Frame-counted video of an original running the Traffic Light and the Three-Floor
   Elevator.** Closes O-R1, O-R3, O-R5, O-R6, and bounds relay operate time.
4. **A video of an original's counter under a fast tap.** Settles O-T5, the sharpest falsifiable
   prediction in the package, and bounds O-E10 with it: a counter that fails *uniformly* rather than
   at O-T5's stages kills the L/R race model the invented inductance exists to provide.

   *Note:* the final clause above records the withdrawn pre-W1 model claim; it is
   not current simulator guidance. Such a video can still constrain physical relay timing and
   O-E10, but the shipped `L_coil` is retained only for the R-L carried state and release-path role,
   not as the cause of counter marginality. The physical mechanism remains open.
5. **The second edition of the MINIVAC Manual**, which the errata says was in preparation
   ("Scientific Development Corporation is preparing for a second edition … Linda G. Sprague,
   Editor"). It might state the dial speed and fix the elevator properly.
