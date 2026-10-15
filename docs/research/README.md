# MINIVAC 601 — research package

The research base for a relay-level MINIVAC 601 simulator, extracted from the nine primary SDC
documents (Books I–VII, the Maintenance Manual and the errata sheet, held here as six PDFs)
plus three panel photographs, verified adversarially, and written down with the confidence of
every claim attached to it.

**Read `open-questions.md` before you write code.** It carries the five blocking gaps, the
named fallbacks you must adopt in place of the missing numbers, and every claim a verifier
refuted. Provenance — what was read, at what resolution, by whom, and how the tags were
assigned — lives in `METHOD.md`.

## Standing constraints — binding on everyone who touches this package

**Oracle-only (Tom's ruling).** Do not open, fetch, clone, read or quote the source of any
existing Minivac emulator, in particular Greg Sadetsky's at `minivac.greg.technology` or any
associated repository. Its observable behaviour and its licence may be described; its code may
not be read. The compliance record, and the two emulators the ruling has been applied to
pre-emptively, are in `history-and-artifacts.md` § *Oracle-only ruling (Sadetsky simulator)*.

**MINIVAC 601 only.** Every 6010 fact is labelled `6010 DELTA` and is not evidence for the
601. Book VII is the *MINIVAC 601/6010 Capacitor/Resistor Manual*, so every fact taken from it
carries the joint 601/6010 scope flag.

---

## What the machine is

A 1961 educational computer trainer sold by Scientific Development Corporation. Not a
stored-program machine: a patch-panel relay logic kit. `[verified]` — B1 pp.3–4

- **Six identical sections**, numbered 1–6 left to right. Each section carries one binary
  output lamp, one DPDT relay with its own series indicator lamp, one DPDT slide switch, one
  SPDT pushbutton, a 4-hole COMMON junction and a CAPACITOR jack. `[verified]` — B1 pp.4–25
- **A 16-position motor-driven rotary dial** (DECIMAL INPUT-OUTPUT, `D0`..`D15` plus wiper
  `D16` and motor terminals `D17`/`D18`/`D19`) used as decimal I/O, as a sequencer and as the
  machine's only clock. `[verified]` — B1 pp.20–22; MM pp.9–10
- **An 11-position MATRIX** of pure junction points, used for tic-tac-toe and character
  recognition. `[verified]` — B1 p.25
- **12 V DC**, 1.5 A continuous, full-wave supply, one circuit breaker in the negative return.
  Two electrical nodes for power: every `+` jack is one node, every `-` jack is the other.
  `[verified]` — MM pp.2–3; ER p.1. No filter capacitor is drawn on the schematic, so the rail
  is taken as unfiltered 120 Hz pulsating DC — but a schematic omission is not proof of
  absence. `[likely]` — MM p.3; open-questions.md O-E6
- The user programs it by plugging taper-pin wires between panel jacks, written in SDC's
  shorthand `1+/1A`. `[verified]` — B1 pp.4–5
- **186 terminals, 392 holes.** `[unverified]` — arithmetic over verified per-item counts; no
  manual states a total.

There is no reset line. SDC's published global reset is a power cycle. `[verified]` — ER,
Book V p.25 ("to re-set the automatic sequence control, turn power OFF, then ON again" — a
per-program instruction). That the power-on state is all relays de-energised and all latches
clear is printed for exactly one circuit, B4 p.70, and is carried package-wide under
`FALLBACK-PWRUP-COLD`. `[likely]` — programs.md N-10, §5

---

## Which file answers which question

| File | Answers |
|---|---|
| `panel.md` | What is printed on, mounted in and cut through the console top. Band order, legends, geometry proportions, typography, colour, panel-vs-manual differences. Enough to lay out the UI from that file alone. |
| `jack-map.md` | The terminal namespace and the fixed netlist behind it. Designator grammar, per-section and right-column inventories, internal busses, switching tables, hole counts, netlist-pinning fixtures. |
| `components.md` | Electrical behaviour. Relay, lamps, pushbutton, slide switch, COMMON, CAPACITOR, power supply — plus the **solver-class ruling**, the named electrical profile `MV601-REF-A`, the named timing profile `MV601-TIMING-A`, and the acceptance fixtures with SDC's own printed expected states. |
| `rotary.md` | The motorised dial. Contact structure, the two-resistor motor drive, RUN/STOP semantics, braking and coast, speed, the eight programming idioms, the clock role, and what the Gardi replica does and does not settle. |
| `programs.md` | The 98-record program corpus with the errata applied, the fixture tier system (A / B / C1 / C2 / D), the conformance seed sets, and all 46 errata corrections. |
| `history-and-artifacts.md` | Document provenance, scan hashes, surviving units, panel variants, the oracle-only ruling on existing emulators, the Gardi replica's evidentiary status, company dates and prices. Historical narrative only — no behaviour. |
| `open-questions.md` | Everything unresolved: the four blocking gaps still open (G1–G3, G5), the one open cross-file contradiction (C14), the register of refuted claims, and every non-blocking open question with its named fallback. |
| `METHOD.md` | Provenance and method. How the find/verify/gap/critic passes were run and how tags were assigned. |
| `raw/` | **Pristine captures. Never edited.** The find/verify/gap JSON, the PDFs, the rendered page images, the photographs. If something in `raw/` is wrong, the correction goes in a research file and in `open-questions.md`, never in `raw/`. |

---

## How to read the confidence tags

Every claim carries exactly one tag, inline, with its citation.

| Tag | Means |
|---|---|
| `[verified]` | Read by an agent in a **rendered page image** of a primary source, or in one of the panel photographs. Not OCR. |
| `[likely]` | Clean typeset OCR from a primary text layer, internally consistent, or consistent secondary sources with no primary read. |
| `[unverified]` | A single damaged OCR line, a single weak source, or an agent's own inference. **Every invented constant in this package is tagged `[unverified]`, and that tag is load-bearing.** |

Two rules that govern the whole package:

1. **The verifier outranks the finder.** Where a `verify-*.json` refutes a `find-*.json`, the
   refutation is applied and the original claim survives only in a "corrections" section,
   stated as a correction.
2. **A negative asserted from a grep is suspect.** These OCR layers space letters out —
   `grep -i watertown book1.txt` returns zero hits on a page that prints
   `372 Main Street, Watertown, Massachusetts` as `W atertow n`. `[verified]` —
   raw:verify-context.json#refuted.R6
   **Most** arguments-from-silence here were re-run whitespace-insensitively — but not all,
   and this pass found the counter-example. `raw:verify-panel.json` V-R09 asserted that
   `2K/3com` and `4G/5com` appear nowhere "in any spacing variant", using
   `grep -E '2 ?K ?/ ?3 ?com'` — an optional *single* space where the OCR uses several. Both
   lines exist: `tr -d ' \t' < book2-3-4.txt | grep -n '2K/3com'` hits line 4156,
   `2K/3com4G/5com6A/6comD16/M+`, on `book2-3-4.pdf` PDF p.91 = printed p.85, Book IV,
   "Program for Decimal to Binary Converter" (49 wires), carried as `programs.md` record
   IV-EXP11. `[verified]` — B234 p.85 image read at 130 dpi. Re-test every remaining grep
   negative with `tr -d ' \t'`, never an optional-single-space regex.

---

## Settled enough to build on

Do not spend research effort here. Every item is `[verified]` in at least one raw file and
survived its verifier.
Source: `raw/critic-completeness.json#settled_enough_to_build_on` — the completeness critic's
judgement, not a source reading; each item's own citation is in the file that carries it.

- The complete 22-letter section terminal set: `+ - A B C E F G H J K L N R S T U V W X Y Z`.
  `D`, `I`, `M`, `O`, `P`, `Q` are never section letters. **There is no `Q` terminal** — that
  is Book VII's OCR mangling a Greek omega.
- The relay coil/lamp **series** topology: `nC —[lamp]— nE —[coil]— nF`. Driving C–F puts the
  lamp in circuit; driving E–F bypasses it and gives the coil full voltage.
- The DPDT contact truth table: relay OFF → `H–J` and `L–N` closed; ON → `H–G` and `L–K`
  closed. Both sets change together (plastic crossbar), and the two sets are **electrically
  isolated** — proved by Book II Experiments 5 and 6, whose printed results are impossible
  under a common arm.
- Pushbutton `nX`/`nY`/`nZ` (SPDT, break-before-make, wide dead zone) and slide switch
  `nR`/`nS`/`nT` + `nU`/`nV`/`nW` (DPDT, ganged, left = 1 / right = 0).
- `D0`..`D19` with the **two-resistor** motor drive: R1 in series `D17`–`D19`; the motor
  **and** R2 both across `D18`–`D19`.
- The two-node `+`/`-` rule: 7 `+` jacks and 7 `-` jacks, two electrical nodes.
- Six **independent** 4-hole COMMONs, one per section — not bussed to each other.
- The `ncap` block: 500 µF ×5, 1000 µF ×1, far plate hard-wired to the minus rail.
- The MATRIX: 1-2-3 / 8-9-4 / 7-6-5 with 9 at centre, six-hole `M10` and `M11`, `t` and `b`
  electrically distinct, nothing behind the panel.
- The only documented reset is a power cycle. (That it leaves all relays de-energised is
  `[likely]`, not settled — printed for one circuit only; see above and `FALLBACK-PWRUP-COLD`.)
- Any terminal's holes are a usable junction node, not just the marked COMMONs.
- The rotary wiper's swept contacts fire momentarily as it passes. **No jump-to-destination
  optimisation is permissible** — the Combination Lock's `D8`/`6E` trap depends on it.

---

## Named fallbacks — the index

Where the sources give nothing, the package names a fallback rather than hedging. Adopt them
by name so a later measurement can replace one cleanly. Full definitions in the file cited.

| Name | Covers | Defined in |
|---|---|---|
| `MV601-REF-A` | The DC electrical profile: `V_oc`, `R_src`, `R_coil`, `R_lamp(I)`, `V_pullin`, `V_dropout`, `R_contact`, `R_wire`, `I_trip` | `components.md` §8.2 |
| `MV601-TIMING-A` | Tick, relay/button/switch travel, break/make fractions, bounce, lamp thermal constants, ordering constraints R1–R6 | `components.md` §9.3 |
| `ARC-CLAMP` | The inductive transient clamp on an opening coil contact: `V_arc_clamp_mv`, 30 V indicative, bounding one tick's `Δi` on an opened R-L coil branch. Replaces a discretization artifact, not a missing measurement | `open-questions.md` O-E11; `architecture.md` §3.3, §4.2 |
| `LAMP-THERMAL-R` | `lamp_thermal_tau` promoted from a display filter to the filament's **electrical** time constant: `lamp_thermal_tau_us`, 40 ms indicative; `R_lamp` relaxes toward the PWL target each tick from `R_cold` at power-up | `open-questions.md` O-E12; `architecture.md` §3.4 |
| `O-P10` | Patch cords use one chosen colour token (`#cf5c4c`) and grey-metal taper pins; no gauge, inch length, colour set or count is claimed as original | `open-questions.md` O-P10 |
| `O-P11` | Case height and edge profile stay proportional chosen tokens; four feet are an unsourced redraw choice and the Wikipedia dimensions are rejected | `open-questions.md` O-P11 |
| `O-P12` | The 3D knob follows PH2's dark cylinder and top-face white wedge, with PH1 and B1 p.20 forms recorded as rejected alternatives | `open-questions.md` O-P12 |
| `O-P13` | Only the relay sound is sourced; all other tactile layers are labelled simulated, buttons stay silent, and no contact ratchet is implied | `open-questions.md` O-P13 |
| `O-P14` | Lamps use chosen warm, dim emission without added persistence; glow and bloom values remain labelled aesthetic inventions | `open-questions.md` O-P14 |
| `O-P15` | Control travel and proud-height distances are chosen presentation tokens derived from logical `travel`, never claimed measurements | `open-questions.md` O-P15 |
| `O-P16` | Relay geometry follows PH2's top view without a dust cover; unsourced dimensions and material RGB values remain chosen tokens | `open-questions.md` O-P16 |
| `O-P17` | All three plates use one chosen proportional recess depth, with blue stripes treated as exposed tray gaps | `open-questions.md` O-P17 |
| `O-P18` | Distinct sourced bezel colours are retained while proud heights, metalness, roughness and console-frame finish remain chosen tokens | `open-questions.md` O-P18 |
| `SERIES-THROUGH-FLOAT` | What the solver does with a series path through a floating node: floating is never treated as grounded and two-terminal elements are never collapsed, so the path carries series current and both coils sit at ~V/2. Whether the canonical flip-flop toggles or chatters is then a parameter question, not a semantics one | `components.md` §8.1, §8.4; `open-questions.md` O-T6 |
| `IDEAL-ISOLATED-COIL` | Coil is a two-terminal element `nE`–`nF` with no relationship to the six contact nodes | `components.md` §1.3; `jack-map.md` §8 |
| `ISOLATED-SETS` | Slide switch's two transfer sets modelled independent | `jack-map.md` §8 |
| `TRANSFER-COAST-DEFER` | The motor's one-shot coast waits while any relay, pushbutton or slide is mid-stroke (capped at the longest stroke), so a transfer that cuts RUN and then shorts STOP brakes on the STOP short | `rotary.md` §3.3, architecture §13.4.5, O-R12 |
| `COAST-SCALES-WITH-SPEED` | The one-shot coast offset is the overrun from RUN speed, scaled by `min(1, abs(rate the drive left at) / run_mrpm)` and rounded half away from zero; every stop at or above RUN takes exactly the configured offset | `rotary.md` §3.3, architecture §13.4.5, O-R13 |
| `BLESS-ROBUSTNESS` | A fixture that trips the 14 µA `min_decision_ua` or `min_tick_gap` bless trigger is still blessed if every assert holds under relay thresholds ±150 mV, coil resistance ±10% and lamp thermal τ ×0.5/×2. The magnitudes are invented harness constants in `test/conformance/robust.ts`, not profile values | `open-questions.md` O-C11; `architecture.md` §9.3 |
| `BBM-EVERYWHERE` | Every transfer set goes break → both-open → make; never an instantaneous swap | `jack-map.md` §8 |
| `UNIFORM-CONTACTS` | 16 identical rotary contacts on a 22.5° pitch; `contact_arc_deg = 16.875` (gap fraction 0.25), tunable | `jack-map.md` §8; `rotary.md` §9 |
| `FITTED-CAPS` | `1cap`..`6cap` modelled as installed, far plate on the minus rail; a config flag, not a fact | `jack-map.md` §8 |
| `POLARIZED-ELECTROLYTIC` | Capacitor construction: polarised, far plate negative, rating above the ~13 V rail | `jack-map.md` §8 |
| `FALLBACK-DERIVED-TOPOLOGY` | A Step 7 speculative expectation: two independent topology derivations agree on it, or an adjudicator ruled; never verification | `open-questions.md` O-C29; `docs/plans/phase-5-corpus.md` Step 7 |
| `FALLBACK-PWRUP-COLD` | Any unprinted power-up state recorded as `[unverified]` under this source label | `programs.md` §2 (the anti-fabrication rule) and §5 (the fallback definition) |

---

## Traps

Eight documented ways to get this wrong.
Source: `raw/critic-completeness.json#hygiene_warnings_for_the_implementer` — the completeness
critic's judgement, not a source reading.

1. `raw/errata.txt` is a `pdftotext -layout` extraction of a **two-column** sheet. It
   interleaves columns and corrupts terminal letters. **Never transcribe a wire list from
   it.** Use the 300 dpi page images.
2. `book2-3-4.pdf` is **continuously paginated across three books** (II = pp.1–33, III begins
   p.35, IV begins p.66). Key fixtures on `(pdf file, PDF page, printed page)` and derive the
   book label.
3. `raw:find-programs.json`'s `verified: 32` does not mean what this package's tag legend
   means — its own definition admitted OCR-only readings. `programs.md` re-tags every affected
   program down to `[likely]`.
4. `book7-capacitor-resistor.txt` renders the Greek omega as `Q`, `Q20`, `Q22`. A token census
   over it **will invent a nonexistent `Q` terminal class**.
5. Plain grep over any OCR layer here is unsafe (see tag rule 2 above).
6. `raw:find-panel.json#redraw_spec` was measured entirely off the 1536 px `image_3.jpg` while
   a 4208 px photograph sat unopened in the same repository. Redo any geometry measurement off
   `raw/photos/commons-minivac601-main.jpg`.
7. Crossing solid lines in SDC's circuit diagrams are **not** junctions unless the dot is
   unmistakably larger than the line width. At 1000 dpi the crossings show ink thickening.
8. TIM-05/TIM-06 (`raw:find-relays.json#timing` — 185 Ω coil, 7.5 V pull-in, 3.0 V drop-out,
   12 ms operate) are invented and from no source. Never lift them, and never drop the
   `[unverified]` tag on a lifted constant; use the profiles in `components.md` §8.2 and §9.3.

---

## Source keys

Used identically across all the topic files.

| Key | Document | Note |
|---|---|---|
| B1 | Book I, *Getting Acquainted with MINIVAC 601*, Aug 1961 | printed page + 2 = PDF page |
| B234 | Books II, III, IV | one continuously paginated volume; printed page + 6 = PDF page |
| B56 | Books V, VI | printed page + 6 = PDF page |
| B7 | *MINIVAC 601/6010 Capacitor/Resistor Manual*, © 1962 | **joint 601/6010 scope flag on every fact taken from it** |
| MM | *MINIVAC 601 Maintenance Manual*, 11 pp. | printed page + 2 = PDF page |
| ER | *Notes and Corrections to the Minivac Manual* (errata sheet), 4 pp. | unpaginated; primary and it corrects the programs |
| PH2 | `raw/photos/commons-minivac601-main.jpg`, 4208×2457 | **the authoritative panel photograph** |
| PH3 | `raw/photos/commons-minivac601-DSCF1392.jpg`, 4288×2848 | a different unit; geometry unreliable |
| PH1 | `raw/prebrief/images/image_3.jpg`, 1536×1152 | too low-resolution for silkscreen; source of several refuted claims |
| — | `raw/photos/commons-minivac6010-mit-museum.jpg` | **a 6010. Quarantined — not evidence for the 601.** |
