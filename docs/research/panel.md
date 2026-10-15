# Front Panel — Layout, Legends, Geometry, Materials

Everything printed on, mounted in, or cut through the MINIVAC 601 console top. Enough to lay the UI out from this file alone. Electrical behaviour of what sits behind each jack is in `components.md`, `rotary.md` and `programs.md`; this file stops at the panel face and the jack namespace.

## Sources

| Key | What | Note |
|---|---|---|
| B1 | Book I, *Getting acquainted with Minivac 601*, SDC, first printing Aug 1961 | Citations use **printed** page numbers. PDF page = printed page + 2. |
| B234 | Books II, III, IV | |
| B56 | Books V, VI | |
| B7 | *Minivac 601/6010 Capacitor/Resistor Manual*, SDC, © 1962 | **Joint 601/6010 scope** — flagged wherever cited. |
| MM | SDC *Minivac 601 Maintenance Manual*, 13 pp. (printed folios 1–11 plus cover and blank) | Cover: "SCIENTIFIC DEVELOPMENT CORP., 372 Main Street, Watertown, Massachusetts". Citations use **printed** page numbers. PDF page = printed page + 2. |
| ER | SDC *Notes and Corrections to the Minivac Manual* (errata sheet) | Unpaginated. Official post-publication corrections to Books I–VI. |
| PH2 | `photos/commons-minivac601-main.jpg`, 4208×2457 | **The authoritative panel photograph.** Top-down, legible to individual jack rings and to engraving on the POWER strip. |
| PH3 | `photos/commons-minivac601-DSCF1392.jpg`, 4288×2848 | A **different physical unit**, Centre for Computing History, oblique, behind acrylic. Geometry unreliable; POWER strip and logo plate readable. |
| PH1 | `prebrief/images/image_3.jpg`, 1536×1152 | Low-resolution, warm/dim tungsten light. **Do not use for fine silkscreen or colour.** Several errors in this file's corrections section came from trusting it. |
| PH4 | `photos/commons-minivac6010-mit-museum.jpg`, 5161×2759 | **A MINIVAC 6010, not a 601** (MIT Museum, behind glass). Present in `photos/` and easily mistaken for a 601. Its panel is materially different and **must not be used for 601 layout**: one single large dark plate — the blue stripes run the full panel width *including* through the right column, and MATRIX and DECIMAL share that plate with sections 1–6, so the 601's three-sub-panel construction does not carry over; the section numerals `1`–`6` print along the bottom edge below the pushbuttons, not in the BINARY OUTPUT band; the relays carry clear plastic dust covers; the stripes are wider. Useful only as explicitly-flagged 6010 contrast. |
| WP | Wikipedia, *Minivac 601* | Secondary. |
| CHM | Computer History Museum catalogue record, MINIVAC 601 (serial 1886) | Secondary. Exposes **no** dimensions field and gives weight **10 lb** — contradicting WP's 9 kg, which is sourced to this same record. Detail in `history-and-artifacts.md`. |

---

## Implementer summary

1. The console top is **blue**. Set into it are **three separate dark sub-panels**, each with blue showing all round as a border: the big left panel carrying sections 1–6, an upper-right panel carrying the logo plate + power stripe + MATRIX + POWER controls, and a lower-right panel carrying DECIMAL INPUT-OUTPUT. What reads as a "printed divider stripe" is the blue console frame between plates. [likely] — PH2, PH3; MM pp.1, 3
2. The left panel is **six identical vertical channels × six horizontal bands**: BINARY OUTPUT / power stripe / STORAGE-PROCESSING / COMMON-CAPACITOR stripe / SECONDARY STORAGE / blank stripe / BINARY INPUT, top to bottom. Every channel is on **three terminal columns of equal pitch** (left, middle, right); the component always sits on the middle column. [verified] — PH2; B1 cover photo
3. **Every terminal is two bare holes side by side**, joined under the panel, letter silkscreened below. Exceptions: `ncom` = 4 holes, `M10`/`M11` = 6 holes. There are **no printed ovals or joining bars around hole pairs in the six sections** — that artwork exists only in the MATRIX block. [verified] — B1 p.4; PH2
4. **7 `+` jacks and 7 `-` jacks, but only 2 electrical nodes.** "All + and - terminals are connected together. For example, a connection to 1+ is the same as a connection to 3+, 6+, or M+." [verified] — ER
5. The panel silkscreens bare `+` and `-` above the matrix. **`M+` / `M-` are manual designators, not panel legends.** A renderer prints `+` and `-`; a program parser must accept `M+` and `M-`. [verified] — PH2, PH1; ER; B1 pp.31–32
6. Absolute dimensions are **not settled by any source**. The proportional table in §3 is a measurement of photographs, tagged [unverified] throughout. Case footprint 5⅛ × 24 × 13¼ in and weight 9 kg (20 lb) come from **Wikipedia alone**, and the weight is **contradicted** — the live CHM record gives 10 lb, half of it. No absolute figure, inch or millimetre or pound, may be encoded as fact. [unverified] — WP; CHM (see §1 and O-P4)

---

## 1. Panel construction

- The console top face is blue; three dark rectangular sub-panels are set into it with a blue margin all round. [likely] — PH2, PH3
- The upper-right sub-panel is a **removable assembly** that SDC calls the *power panel*: "Push the power panel out of the computer console through the holes in the dividing section." [verified] — MM p.3
- The console has an internal **dividing section**; the mains cord stows in a compartment under the power panel, reached "through the three-inch hole in the bottom of the computer." [verified] — MM p.1
- The bottom panel comes off "by unscrewing the screws from the rubber feet." [verified] — MM p.1
- Mains input **110 VAC**. [verified] — B1 p.3 "the power supply converts the 110-volt AC power obtained from a standard electric outlet"; MM p.3 step 4 "Check the 110 volt outlet with a lamp or other appliance".
- Case 5⅛ × 24 × 13¼ inches, 9 kg (20 lb), blue-painted **wooden** case. [unverified] — WP alone. None of the three — dimensions, weight, wooden construction — is stated in B1–B7, MM or ER, and **the weight is contradicted by the source Wikipedia leans on**: the live CHM record for that museum's unit exposes no dimensions field at all and gives the weight as **10 lb**, against Wikipedia's 9 kg (≈20 lb). Two secondary figures a factor of two apart; neither may be encoded as fact. See `history-and-artifacts.md` and O-P4 in `open-questions.md`.
  Consistency check, re-run off **PH2** (PH1 is not trustworthy for measurement — see the source table): the console outline measures ≈4032 × 2240 px, aspect **1.80 : 1**, against 24 / 13.25 = 1.81 : 1. That makes the *ratio* of the Wikipedia footprint plausible and says nothing whatever about absolute size or weight. [unverified — my measurement] — PH2
- Panel substrate material: **not established by any source read.** Nothing in B1–B7, MM or ER names it. MM's repair language (drilled-out rivets, machine screws and nuts, soldering under the console) fits hardboard or sheet metal equally. [unverified] — see §11.
- Consequence of the three-plate construction: the COMMON/CAPACITOR stripe stopping at the divider, and the right column's stripe sitting at a different height, are **not** one printed stripe terminating — they are two plates with independent internal layouts. [likely] — PH2

## 2. Gross layout

Three dark plates set into a blue console top. The `+` / `-` power stripe is the only stripe that crosses from the left plate into the right; the other two stripes belong to the left plate alone.

```
 blue console top face ..........................................................
 :                                                                              :
 :  +--------------------------------------------+  +------------------------+  :
 :  |  1     2     3     4     5     6           |  |  Minivac 601           |  :
 :  |             BINARY OUTPUT                  |  |  Scientific Developm.. |  :
 :  |~~~~~~~~ + / - power stripe ~~~~~~~~~~~~~~~~|  |~~ + - ~~~~~~~~ POWER ~~|  :
 :  |                                            |  |              |         |  :
 :  |             STORAGE/PROCESSING             |  |    MATRIX    |  POWER  |  :
 :  |                                            |  |              | controls|  :
 :  |~~~~~ COMMON / CAPACITOR stripe ~~~~~~~~~~~~|  +------------------------+  :
 :  |                                            |        (blue frame)          :
 :  |             SECONDARY STORAGE              |  +------------------------+  :
 :  |~~~~~ blank stripe, no jacks ~~~~~~~~~~~~~~~|  |                        |  :
 :  |             BINARY INPUT                   |  | DECIMAL INPUT-OUTPUT   |  :
 :  +--------------------------------------------+  +------------------------+  :
 :                                                                              :
 ................................................................................
```

- Left field: six identical channels numbered 1 (leftmost) to 6 (rightmost), in six horizontal bands. Order top to bottom: **(1) BINARY OUTPUT** [dark], **(2) power stripe** [blue, carries `+` / `-`], **(3) STORAGE/PROCESSING** [dark], **(4) auxiliary stripe** [blue, carries COMMON / CAPACITOR], **(5) SECONDARY STORAGE** [dark], **blank stripe** [blue, no jacks and no legend], **(6) BINARY INPUT** [dark]. [verified] — PH2; B1 cover photo; corroborated by B1 p.25 "Auxiliary terminals are provided between the slide switches and the relays for each of the six sections."
- Right column top to bottom: logo plate; blue power stripe carrying one `+`, one `-` and the legend POWER at its right end; a dark block split by a vertical cream rule into MATRIX (left, wider) and the POWER controls (right, narrow); a blue stripe; the DECIMAL INPUT-OUTPUT block. [verified] — PH2; B1 pp.20, 25 figures
- The power stripe runs across **both** the left field and the right column at the same height. The auxiliary stripe and the blank stripe do not cross into the right column. [verified] — PH2
- **The POWER control block contains no jacks.** [verified] — PH2, PH3

## 3. Proportional geometry — [unverified], for redraws only

Every number below is a **measured proportion, never a dimension** — each is tagged with the photograph it came off. The band table began as a measurement off **PH1**, the lowest-resolution of the three photographs, at an estimated ±2 % of panel dimension. No manufacturer figure exists in any source read. The re-measurement off PH2 (4208 px, ~2.7× the linear resolution) has been done and is carried in the PH2 columns below, so a later pass need not repeat it: the two photographs agree within that ±2 % on every band **except BINARY INPUT**, where they disagree by nearly a fifth of the band (PH1 0.176 of panel height, PH2 0.209). The PH1 table is therefore sound as a proportional guide and is kept. PH2 still carries perspective — the left plate's top edge is not level in frame — so the whole section stays [unverified]. Use for proportioning; never as a dimensional authority. [unverified]

Panel extent on PH1 measured 1423 × 795 px, aspect **1.79 : 1**; the same console outline on PH2 measures ≈4032 × 2240 px, aspect **1.80 : 1**. The aspect is reproducible across both photographs; the pixel counts are not comparable to each other and neither carries a scale.

**Bands, left field — fraction of panel height from the top**

| Band | PH1 from | PH1 to | PH2 from | PH2 to |
|---|---|---|---|---|
| outer blue border (top) | 0.000 | 0.016 | 0.000 | 0.019 |
| 1 BINARY OUTPUT (dark) | 0.016 | 0.170 | 0.019 | 0.184 |
| 2 power stripe (blue) | 0.170 | 0.220 | 0.184 | 0.229 |
| 3 STORAGE/PROCESSING (dark) | 0.220 | 0.547 | 0.229 | 0.549 |
| 4 COMMON/CAPACITOR stripe (blue) | 0.547 | 0.610 | 0.549 | 0.598 |
| 5 SECONDARY STORAGE (dark) | 0.610 | 0.767 | 0.598 | 0.757 |
| blank divider stripe (blue) | 0.767 | 0.799 | 0.757 | 0.776 |
| 6 BINARY INPUT (dark) | 0.799 | 0.975 | 0.776 | 0.985 |
| outer blue border (bottom) | 0.975 | 1.000 | 0.985 | 1.000 |

PH2 method: panel top edge y=115, bottom edge y=2345 (height 2230 px), from row-wise blue-minus-red colour profiling through a component-free strip at x=1230–1350 over the full image height — teal bands at y 528–630, 1342–1446 and 1804–1844, blue borders at y 115–158 and from y 2310. Cross-checked at x=3030 in the right-hand plates, where the power stripe reads y 530–634. [unverified — my measurement] — PH2

**Blocks, right column — fraction of panel height**

| Block | From | To |
|---|---|---|
| logo plate (dark) | 0.019 | 0.184 |
| power stripe (blue): `+`, `-`, POWER | 0.184 | 0.229 |
| MATRIX + POWER controls (dark) | 0.229 | 0.474 |
| divider stripe (blue) | 0.474 | 0.501 |
| DECIMAL INPUT-OUTPUT (dark) | 0.501 | 0.985 |

These right-column boundaries use the same PH2 y=530–634 power-stripe cross-check as the left
table. They supersede the older PH1-local `0.170–0.210` crop estimate; the stripe is one aligned
console-frame band across two separate plates, not two independently placed stripes. [unverified]

**Horizontal** — ratios only. [unverified] — measurement off photographs. The absolute pixel figures previously carried here were PH1's; they are dropped, because they are not the numbers PH2 gives (see the paragraph below), they carry no scale, and O-P4 rules that no absolute figure may be encoded as fact. The *ratios* survive both photographs.

| Quantity | Value | Basis |
|---|---|---|
| Left field right edge | 0.716 of panel width | PH2 image measurement |
| Right column left edge | 0.728 of panel width | PH2 image measurement |
| Channel pitch (six evenly spaced) | 0.113 of panel width | PH2, 453 px over the measured panel span |
| Terminal-column spacing within a channel | **0.28 of channel pitch** | PH1 and PH2 agree |
| Hole-pair spacing within a terminal | **0.35–0.36 of column spacing** | PH1 0.36, PH2 0.35 |

Section 1's hole-pair x positions, repeated identically in every band: left column 134/151, middle 181/198, right 229/246. [unverified — my measurement] Independently confirmed as a *pattern* on PH2, but with **different numbers from those first published here**: section 2 reads left 747/791, middle 883/922, right 1008/1051 — hole-pair spacing **44 px** and column spacing **127 px**, not the 60 px and 185 px the earlier triple implied. The columns drift about 7 px right between the top band and the bottom band (perspective), so read the triple as one band's values, not the panel's. The qualitative claim — the same x positions repeat in every band — survives. [verified] — PH2 (dark-blob column analysis over crop x=690 y=320 w=460 h=130, cross-checked against the COMMON/CAPACITOR row of the same section, column centres 774 / 902 / 1029)

PH2 horizontal method: a teal-colour census over image rows 760–1260 finds the outer panel frame at
approximately x=90..4094 and the central frame gap at x=2956..3003. Normalizing the gap edges over
that 4004 px span gives 0.716 and 0.728. Perspective, wear and the colour threshold make these redraw
tokens, not dimensional facts. Derived pitches for the horizontal table above, measured off PH2:
channel pitch 453 px = 0.113 of that span; column spacing 127 px = 0.28 of channel pitch (matching
the table); hole-pair spacing 44 px = 0.35 of column spacing (PH1 gave 0.36; the table carries the
range); hole diameter ≈16 px; printed ring OD ≈24 px. [unverified — my measurement] — PH2

## 4. Channel structure

One channel, full height. `o o` = a two-hole terminal; the legend under or over each is what is printed on the panel.

```
          LEFT        MIDDLE        RIGHT      <- three columns, equal pitch

   n                                              section numeral, once per
         o o         ( LAMP )        o o          channel, above & left of lamp
          A                           B
   . . . . . . . BINARY OUTPUT . . . . . . . .    band title, centred on the
                                                  whole left field, below lamps
   ~~~~~~~~~~~ blue power stripe ~~~~~~~~~~~~~
          +                           -           glyphs printed ABOVE
         o o                         o o
   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
       |--LIGHT--|  |--COIL--|                    bracket ornaments
         o o         o o           o o
          C           E             F
       [ coil ]  [crossbar]  [contact stacks]     relay body, straddles all 3
                   ( LAMP )                       relay indicator lamp
   . . . . . . STORAGE/PROCESSING . . . . . . .
         N.O.         ARM          N.C.           govern BOTH rows below
         o o         o o           o o
          G           H             J
         o o         o o           o o
          K           L             N
   ~~~~~~~~~ blue auxiliary stripe ~~~~~~~~~~~~
        COMMON                  CAPACITOR
       o o o o                    o o
   ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
   . . . . . . SECONDARY STORAGE . . . . . . .    band title at TOP of band
          <-          ARM           ->            short arrows, gap to ARM
         o o         o o           o o
          R           S             T
         o o         o o           o o
          U           V             W
          (o)   [== red ==]   (o)              mounting discs, INBOARD of the
                                                  R/U and T/W columns
   ~~~~~~~~~ blank blue stripe ~~~~~~~~~~~~~~~
   . . . . . . . BINARY INPUT . . . . . . . . .   band title at TOP of band
         N.O.         ARM          N.C.
         o o         o o           o o
          X           Y             Z
                    ( RED )                       pushbutton
```

Three terminal columns of equal pitch per channel. Column assignment by band: [verified] — PH2

| Band | LEFT column | MIDDLE column | RIGHT column |
|---|---|---|---|
| BINARY OUTPUT | `A` | output lamp | `B` |
| power stripe | `+` | — | `-` |
| STORAGE/PROCESSING (coil group) | `C` | `E` | `F` |
| STORAGE/PROCESSING (contacts, top row) | `G` | `H` | `J` |
| STORAGE/PROCESSING (contacts, bottom row) | `K` | `L` | `N` |
| auxiliary stripe | `ncom` (4 holes, left→middle) | ↑ same terminal | `ncap` (2 holes) |
| SECONDARY STORAGE (top row) | `R` | `S` | `T` |
| SECONDARY STORAGE (bottom row) | `U` | `V` | `W` |
| BINARY INPUT | `X` | `Y` | `Z` |

- The component — output lamp, relay indicator lamp, slide-switch actuator — sits on the **middle** column. The pushbutton sits approximately on it. The relay body straddles all three. [verified] — PH2
- The section numeral **1..6 is printed once per channel**, large, in the BINARY OUTPUT band, above and slightly left of that channel's lamp. No section numerals appear in any lower band. [verified] — PH2; B1 p.4 "Each terminal is identified by a letter printed below it, and by the number printed at the top of the section in which it is located."
- Relay indicator lamp centres read 15–25 px left of the `E` column centre on PH2 — parallax on a proud component, not a real offset. [verified] — PH2

## 5. Terminals

- **Two holes per terminal, side by side, joined under the panel.** "Programming wires may be plugged into either (or both) holes of the terminal." [verified] — B1 p.4
- Wiring shorthand joins two terminals with a slash: `1+/1A`. [verified] — B1 p.5
- **Label placement is not uniform.** Letter designators (`A B C E F G H J K L N R S T U V W X Y Z`) print **below** their hole pair, set **very slightly left of centre** — a consistent 4–7 px at PH2's 4208 px width, about a fifth of a letter width. Centring them in a redraw is acceptable; claiming they are centred is not. The `+` and `-` glyphs print **above** their pairs. The DECIMAL numerals 16–19 print to the **left** of their pairs, with `ARM` below the 16. [verified] — PH2; B1 p.5 Experiment 1 confirms both senses in the same paragraph: "…one of the two holes just **below** the + in section 1" vs "…one of the two holes just **above** the letter A in section 1."
- The same slight left offset runs through every silkscreen element, not just the terminal letters. Section 2: `A`-pair holes 747.1/790.9 (centre 769.0) against a letter centroid of 763.3; `B`-pair 1002.5/1047.1 (centre 1024.8) against 1017.8. Section 6: `H` −3 px, `J` −7, `ARM` −2.5, `N.C.` −4. Also `COMMON` 810 against 817, `CAPACITOR` 1022 against 1028, and the section numeral `6` at 880 against its lamp bezel centre of 898. **The sign does not flip on the right half of the panel, so it is artwork, not perspective.** [verified] — PH2, hole-centroid and brightness-centroid measurement
- Group legends (`N.O.`, `ARM`, `N.C.`, `LIGHT`, `COIL`, the arrows, `COMMON`, `CAPACITOR`) print **above** the terminals they govern. [verified] — PH2
- **Every jack hole is encircled by a thin light ring**, on the dark field and on the blue stripes alike, and the ring is **printed ink**, not the drilled edge exposing a light substrate. In the MATRIX each `M10`/`M11` hole's cream ring is continuous with the cream bar joining it to its neighbour — one stroke, same weight, same colour — and the drilled hole sits visibly **off-centre inside its own ring**. An ordinary section pair shows the same cream, the same ~3–4 px stroke and the same eccentricity. A redraw that omits the ring looks wrong. [verified] printed, in the MATRIX; [likely] as a whole-panel rule — PH2 at 5–7× (M10 loop) and 11× (a section `R` pair)
- **No printed ovals and no printed joining bars anywhere in the six sections.** Every section terminal is two bare holes on the plain field. COMMON is four bare holes in a row under the word COMMON. Printed joining artwork exists only in the MATRIX. [verified] — PH2
- COMMON's four holes are evenly pitched at about the hole-pair spacing, spanning from the left column's left hole to the middle column's left hole. They are **not** two column-aligned pairs. [verified] — PH2
- Letter set actually used: `+ - A B C E F G H J K L N R S T U V W X Y Z`. **`D`, `I`, `M`, `O`, `P`, `Q` are never section letters** — `D` is reserved for Decimal Input-Output and `M` for Matrix; `I`/`O`/`Q` are absent, presumably to avoid confusion with 1 and 0. [verified] — token census over book1.txt + book2-3-4.txt + book5-6.txt + errata.txt, plus PH2 silkscreen
- **There is no `Q` terminal class.** OCR of B7 renders a Greek omega (a spliced-in user resistor, e.g. `Ω_B1`, `Ω_22`) as `Q`, `Qo`, `Q20`, `Q22`, `Q50`. Any token census over `book7-capacitor-resistor.txt` will otherwise invent one. [verified] — B7 pp.9, 11, 21
- Any terminal's two holes are a usable junction, not just the marked COMMONs: "common terminals are any set of terminals which are interconnected: for instance, the two terminals at 6R, the six at M10, or the four at 3com… to make the connections 1X/6A without using the longest wires, you can make the two connections 1X/4R and 4R/6A." [verified] — ER

### 5.1 Complete terminal inventory — per section, n = 1..6

| Terminal | Holes | Band | Column | Behind the panel |
|---|---|---|---|---|
| `n+` | 2 | power stripe | left | plus rail (one node with all other `+`) |
| `n-` | 2 | power stripe | right | minus rail (one node with all other `-`) |
| `nA` | 2 | BINARY OUTPUT | left | output lamp, one side |
| `nB` | 2 | BINARY OUTPUT | right | output lamp, other side |
| `nC` | 2 | STORAGE/PROCESSING | left | far side of relay indicator lamp |
| `nE` | 2 | STORAGE/PROCESSING | middle | junction of indicator lamp and coil |
| `nF` | 2 | STORAGE/PROCESSING | right | far end of relay coil |
| `nG` | 2 | S/P contacts, top row | left | N.O. contact, far set |
| `nH` | 2 | S/P contacts, top row | middle | arm, far set |
| `nJ` | 2 | S/P contacts, top row | right | N.C. contact, far set |
| `nK` | 2 | S/P contacts, bottom row | left | N.O. contact, near set |
| `nL` | 2 | S/P contacts, bottom row | middle | arm, near set |
| `nN` | 2 | S/P contacts, bottom row | right | N.C. contact, near set |
| `ncom` | **4** | auxiliary stripe | left→middle | isolated 4-hole junction, nothing else |
| `ncap` | 2 | auxiliary stripe | right | one plate of an installed electrolytic capacitor; other plate hard-wired to the minus rail |
| `nR` | 2 | SECONDARY STORAGE, top | left | left fixed contact, set 1 |
| `nS` | 2 | SECONDARY STORAGE, top | middle | arm, set 1 |
| `nT` | 2 | SECONDARY STORAGE, top | right | right fixed contact, set 1 |
| `nU` | 2 | SECONDARY STORAGE, bottom | left | left fixed contact, set 2 |
| `nV` | 2 | SECONDARY STORAGE, bottom | middle | arm, set 2 |
| `nW` | 2 | SECONDARY STORAGE, bottom | right | right fixed contact, set 2 |
| `nX` | 2 | BINARY INPUT | left | N.O. contact |
| `nY` | 2 | BINARY INPUT | middle | arm / common |
| `nZ` | 2 | BINARY INPUT | right | N.C. contact |

24 terminals, 50 holes per section (23 two-hole + one four-hole). [verified] — B1 pp.4, 6, 8, 12, 14, 18, 25; PH2

`ncom`: "The terminals with four holes labeled COMMON may be used when more than two connections must be made to a set of terminals on the computer panel. The four COMMON terminals are connected together, but are not connected to any other component." [verified] — B1 p.25. The sentence means the four **holes** of one COMMON terminal, settled outright by ER: "common terminals are any set of terminals which are interconnected: for instance… the four at 3com." The panel has **six independent four-hole junction blocks**, one per section. [verified] — ER; PH2; B56 p.53 chains `1com/2L … 5com/6L` plus `6F/6com`, which collapses if they were bussed.

`ncap`: designator confirmed. "As indicated in Book I (page 25) there are terminals on the MINIVAC console for the capacitors. These terminals will be indicated in a program by: 1cap, 2cap, 3cap, etc." and "Since one end of the capacitor is permanently connected to the negative power source…". Values: sections 1–5 = 500 µF, section 6 = 1000 µF. Used in SDC programs: `1cap/2L`, `1cap/D16`, `2cap/3L`, `3cap/4L`, `4cap/5L`, `5cap/6L`. [verified] — B7 pp.10, 11, 21. **Scoping caveat:** B7 is a joint 601/6010 manual dated 1962; B1 (601, 1961) says only that these terminals "are used when auxiliary components are added to the MINIVAC 601 in advanced programs. At present these terminals may be ignored." Whether the capacitors were fitted in all 1961 601 production is **not settled** — see §11. No `<n>cap` token appears anywhere in Books I–VI.

### 5.2 Complete terminal inventory — right column

| Terminal | Holes | Position | Behind the panel |
|---|---|---|---|
| `M+` (panel prints `+`) | 2 | power stripe, above MATRIX | plus rail |
| `M-` (panel prints `-`) | 2 | power stripe, above MATRIX | minus rail |
| `M1t`..`M9t` | 2 | top pair of matrix cells 1–9 | nothing — junction only |
| `M1b`..`M9b` | 2 | bottom pair of matrix cells 1–9 | nothing — junction only |
| `M10` | **6** | six-hole cluster left of the 3×3 board | nothing — junction only |
| `M11` | **6** | six-hole cluster right of the 3×3 board | nothing — junction only |
| `D0`..`D15` | 2 | outer annulus of the dial, one per sector | rotary switch fixed contacts |
| `D16` | 2 | upper left of decimal block, `16` with `ARM` below | rotary wiper arm |
| `D17` | 2 | left of the dial | motor drive, RUN with D18 |
| `D18` | 2 | left of the dial | motor drive |
| `D19` | 2 | left of the dial | motor drive, STOP when shorted to D18 |

42 terminals, 92 holes. [verified per item] — PH2; B1 pp.20, 25; ER; MM pp.9–10

**Panel totals: 186 terminals, 392 holes** (144 terminals / 300 holes in the six sections + 42 / 92 in the right column). [unverified — arithmetic over verified per-item counts; no manual states a total]

### 5.3 Internal busses

| Bus | Members | Evidence |
|---|---|---|
| PLUS rail | `1+ 2+ 3+ 4+ 5+ 6+ M+` | "All + and - terminals are connected together. For example, a connection to 1+ is the same as a connection to 3+, 6+, or M+." [verified] — ER; also B1 p.3 |
| MINUS rail | `1- 2- 3- 4- 5- 6- M-` | "Similarly, a connection to 2- is the same as a connection to 4-, 5-, or M-." [verified] — ER |
| relay arm gang, per relay | `nH` arm + `nL` arm | **Mechanical, not electrical** — "The two relay arms are connected together mechanically with a plastic crossbar"; the two sets make "separate electrical connections". [verified] — B1 p.12 |
| slide-switch arm gang, per switch | `nS` arm + `nV` arm | Mechanical. "Each switch has two sets of contacts which open and close together." [verified] — B1 p.18 |
| COMMON | none — six independent blocks | [verified] — ER; B56 pp.51, 53 |
| MATRIX | none | "The terminals are used as junction points, and there are no connections to the terminals below the panel." [verified] — B1 p.25 |

`M10` and `M11` are **not** internally joined: B56 p.22 has to add an explicit `M10/M11` wire. [verified] — B56 p.22

## 6. Band-by-band detail

### Band 1 — BINARY OUTPUT

- Six indicator lamps, one per channel, on the middle column. Red translucent cap in a white/cream bezel ring, standing proud of the panel. `A` on the left column, `B` on the right. [verified] — PH2; B1 p.6 "The terminals labeled A and B on either side of each light are used to supply the electrical power to turn the light ON."
- Band legend `BINARY OUTPUT` centred on the left field, **below** the lamp row, near the bottom of the band. [verified] — PH2

### Band 2 — power stripe

- Light-blue stripe. Per channel: `+` (2 holes) on the left column, `-` (2 holes) on the right, glyph printed above each. Seven `+` and seven `-` jacks on the panel — six in the left field plus one pair in the right column. [verified] — PH2
- **The holes sit directly on the flat blue stripe.** No dark oval, no escutcheon, no field behind them — just the same thin light ring every jack carries. [verified] — PH2

### Band 3 — STORAGE/PROCESSING

- Above each relay: three 2-hole terminals `C` (left), `E` (middle), `F` (right), with two bracket ornaments above them — `LIGHT` spanning C→E and `COIL` spanning E→F. Each bracket is a horizontal cream rule with downturned end-ticks, the word set into the middle. [verified] — PH2; B1 p.14
- Chain implied and stated: **C —(indicator lamp)— E —(relay coil)— F**. Power across C and F lights the lamp *and* pulls the relay; power across E and F pulls the relay with the lamp dark. [verified] — B1 p.14
- Relay body mounted on the panel face, contacts visible. Left to right: **white cylindrical coil bobbin**, then a **white plastic crossbar block with a vertical slot**, then the **contact stacks — plainly visible to the right of the crossbar** as two vertically separated assemblies of brown/copper springs, an upper stack and a lower stack. [verified] — PH2; B1 pp.12, 14
- The upper/lower stack arrangement is what makes B1 p.12's rule concrete: "The set of contacts closer to the operator is connected to the set of terminals closer to the operator" → upper stack = `G H J`, lower/nearer stack = `K L N`. [verified] — PH2 + B1 p.12
- Below each relay, on the middle column under `E`: that relay's indicator lamp, red lens in a cream bezel, same style as the output lamps. **Twelve lamps on the panel in total.** [verified] — PH2; B1 p.14
- Legend `STORAGE/PROCESSING` centred on the left field, in the gap between the relay indicator lamp row and the contact terminals. [verified] — PH2
- Below the legend, two rows of three terminals: top `G H J`, bottom `K L N`. `N.O.` / `ARM` / `N.C.` print once, **above the top row only**, over the left / middle / right columns; they govern both rows. [verified] — PH2; B1 p.12
- Relay OFF: H–J and L–N closed. Relay ON: H–G and L–K closed. Both sets switch together. [verified] — B1 p.12
- MM corroborates the count: "disconnect the eight connections to the relay" = 2 coil lugs + 6 contact lugs. [verified] — MM p.8

### Band 4 — COMMON / CAPACITOR stripe

- Light-blue stripe. Per channel, left half: a **four-hole** terminal with `COMMON` above it, spanning left column to middle column. Right half: a **two-hole** terminal with `CAPACITOR` above it, on the right column. [verified] — PH2; B1 p.25
- B1 p.25 §9 AUXILIARY TERMINALS, verbatim: "Auxiliary terminals are provided between the slide switches and the relays for each of the six sections." / "The terminals with four holes labeled COMMON may be used when more than two connections must be made to a set of terminals on the computer panel. The four COMMON terminals are connected together, but are not connected to any other component." / "The terminals marked 'CAPACITOR' are used when auxiliary components are added to the MINIVAC 601 in advanced programs. At present these terminals may be ignored." [verified] — B1 p.25
- Addressed in programs as `<n>com` and `<n>cap`. [verified] — B234 p.59 "(The notation for a connection to a common terminal is '1com', '2com,' etc.)", the same page printing `1T/3com`, `2W/3com`, `3A/3com` and `3T/3com`; B7 p.11
- **A parser must also accept the capacitor terminal written bare.** B7 drops the section number in section-agnostic circuit listings — p.18 prints `F/cap` and `E/cap`, and the instruction "change E/cap to C/cap" — and spaces it in prose on p.11 ("the connection between 1 cap and 1+"). Accept `<n>cap`, bare `cap`, and `1 cap`. [verified] — B7 pp.11, 18, read from the page images (B7's OCR is unreliable). **B7 is the joint 601/6010 manual** — same scoping caveat as every other B7 citation.

### Band 5 — SECONDARY STORAGE

- Legend `SECONDARY STORAGE` centred on the left field at the **top** of the band, below the auxiliary stripe. [verified] — PH2
- Two rows of three terminals: top `R S T`, bottom `U V W`. Above the top row: a **short left-pointing arrow over the R column**, `ARM` over the S column, a **short right-pointing arrow over the T column**. Each arrow is roughly one hole-pair wide, self-contained, with a clear unprinted gap to the word ARM. No legends over the bottom row. [verified] — PH2 (section 1: left arrow spans x≈165–235, ARM 330–405, right arrow 495–565 in the crop; section 2 identical)
- Pushed left connects S–R and V–U; pushed right connects S–T and V–W. B1 p.18 prints, underlined, "(The two sets of terminals R, S, T, and U, V, W, always work together.)" [verified] — B1 p.18, read from the page image
- Below the `U V W` row, on the middle column: the slide switch. A **red rectangular actuator protruding through a plain dark rectangular slot cut in the dark panel field.** The switch body is under the panel; there is no ivory or cream housing on the panel face. [verified] — PH2; MM p.9
- Flanking each slide switch: **two round pale discs**, most likely the switch's panel-mounting rivet heads. They are **not** under the R/U and T/W columns — they sit inboard of them, about three-quarters of a column pitch either side of the switch centre. Section 2 measured on PH2: left disc x=805 against an R/U column centre of 774; right disc x=994 against a T/W centre of 1029; column pitch 127, disc separation 189. At 8× the discs are **domed and cast a lower-right shadow**, so they are fasteners and not printing. MM p.9: "Drill out the rivets which hold the unit in place. Install a new switch with machine screws and nuts." MM p.5 says the POWER switch is rivet-mounted the same way — "drill out the rivets which hold the switch… fastening it with machine screws and nuts" — and that second, independent switch carries the same two discs, above `ON` and below `OFF`. [likely] — MM pp.5, 9; PH2. No source states that the visible discs *are* those rivet heads.
- MM p.9 independently confirms six connections to each slide switch, matching R,S,T,U,V,W. [verified] — MM p.9

### Blank stripe

A third light-blue stripe separates SECONDARY STORAGE from BINARY INPUT. **It carries nothing — no jacks, no legend.** [verified] — PH2

### Band 6 — BINARY INPUT

- Legend `BINARY INPUT` centred on the left field at the **top** of the band. [verified] — PH2
- One row of three terminals per channel: `X` (left), `Y` (middle), `Z` (right), with `N.O.` / `ARM` / `N.C.` above them. [verified] — PH2; B1 p.8
- Below the row, approximately on the middle column: the pushbutton — a large round flat-topped **red cap with a chrome/cream bezel ring around its base**. **No slotted screw head appears beside or above any button**; the mounting screw is under the cap: "Pull the red plastic button off the pushbutton; unscrew the exposed mounting screw." [verified] — PH2; MM p.7
- UP connects Y–Z (normally closed); DOWN connects X–Y (normally open). `Y` is the common contact. Break-before-make. [verified] — B1 pp.8–9

## 7. Right column

### 7.1 Logo plate

- Full width of the right column at the top, on the dark field. Main line **`Minivac 601`** — large, mixed case (capital M, lowercase "inivac", space, "601"), heavy geometric/grotesque sans, very tight sidebearings, left-aligned, running nearly the full plate width. [verified] — PH2
- Second line, one line of small type, verbatim and character-for-character (confirmed at native resolution on PH2, including the full stop after Massachusetts and the spaced "U. S. A."):

  `Scientific Development Corporation, Cambridge, Massachusetts. Made in U. S. A. Patents applied for.`

  [verified] — PH2

- **The plate city varies between units.** PH2 reads *Cambridge* cleanly. PH3, a different unit, shows a short ~7-glyph word ending `-tham` with ascenders at t/h and no descender — which rules out both *Cambridge* (9 glyphs, descender at g) and *Watertown*. Most plausible reading *Waltham* [unverified — resolution-limited]. Every printed SDC document says Watertown. See §10 and §11. [verified — that it varies]

### 7.2 Power stripe, right column

Carries one `+` terminal, one `-` terminal, and the legend `POWER` at the right end over the POWER sub-block. The panel prints bare `+` and `-`; the designators `M+` / `M-` come from the manuals. [verified] — PH2; ER; B1 pp.31–32; B56 pp.22, 35; B7 p.21

### 7.3 MATRIX

`o-o` = a hole pair joined by a printed cream bar. `M10` / `M11` are six holes inside a closed printed loop.

```
             o-o   |  o-o   |  o-o           A bare tic-tac-toe hash, NOT a
              1    |   2    |   3            boxed grid: two long verticals
             o-o   |  o-o   |  o-o           crossing two shorter horizontals.
            -------+--------+-------         No outer border, no rule above
    o-o      o-o   |  o-o   |  o-o    o-o    the top row, none below the
    | |       8    |   9    |   4     | |    bottom row. The verticals overrun
    o o      o-o   |  o-o   |  o-o    o o    both outer rows of holes; the
    | |     -------+--------+-------  | |    horizontals are inset at both
    o-o      o-o   |  o-o   |  o-o    o-o    ends, stopping short of the
     10       7    |   6    |   5      11    outer cells' holes. No rule
             o-o   |  o-o   |  o-o           touches any hole.

    MATRIX
```

- Left/wider part of the dark upper-right plate. Terminals laid out as a tic-tac-toe board: a 3×3 array with **two long vertical and two long horizontal cream rules** drawn between the cells, not touching any hole. **There is no border round the board** — the verticals run from above the top row of holes to below the bottom row, the horizontals are inset at both ends, and no rule runs above the top row, below the bottom row, or down the outside. [verified] — PH2 at 2×; B1 p.25 figure
- Numbering: **top row 1 2 3; middle row 8 9 4; bottom row 7 6 5.** Position 9 is the centre; 1..8 run clockwise around it from top-left. [verified] — PH2
- Each of cells 1–9 is a **2×2 cluster of four holes**: a top pair joined by a short printed cream bar, a bottom pair joined by a short printed cream bar, **no bar between top and bottom**. The cell numeral prints in the gap between the pairs. Top pair = `M<n>t`, bottom pair = `M<n>b`. [verified] — PH2; B1 p.25 "M = matrix / 6 = terminal number (1 to 11) / t = top or 'b' for bottom … for example M6t" and "The lines between the terminals indicate terminals which are connected together to form a single contact."
- Positions **10 and 11 sit outside the board**, on the middle row's height — 10 to the left, 11 to the right. Each is a **2-wide × 3-tall array of six holes** enclosed by a **closed rectangular loop** of printed cream line (bar across the top pair, bar across the bottom pair, verticals down both columns through the middle holes). All six holes are one terminal. The numeral prints **below** the cluster, not inside it. [verified] — PH2 (crop at 4.7×); ER "the six at M10"
- **No program in Books I–VI, in ER, or in B7 ever writes `M10t`, `M10b`, `M11t` or `M11b`.** Positions 10 and 11 are always addressed bare. Tally over book1 + book2-3-4 + book5-6: `M10` ×11, `M11` ×1, zero suffixed forms; ER adds 7 more bare `M10`. [verified]
- Matrix total: 48 holes (9 × 4 + 6 + 6). [verified] — PH2
- **Not part of the panel:** on PH2 a small pale object roughly 15 × 30 px stands proud of the plate at native (3663, 708), between matrix cell 3 and the `M11` cluster, casting a hard shadow to its right. It is not a hole and not printing, and PH3's matrix plate shows nothing at the corresponding position — incidental debris or damage on the PH2 unit. Omit from a clean redraw. [unverified] — PH2
- Purpose, verbatim: "The matrix provides convenient junction points for use when the computer plays games or recognizes symbols… When the computer is programmed to play tic-tac-toe, the various plays are recorded by making connections on the matrix terminals. When the computer is programmed to recognize characters, the characters are formed by making connections on the matrix." [verified] — B1 p.25
- Tic-Tac-Toe convention: the machine's play wire goes into the **bottom** contact `M<n>b` of the position matching its last move; the player's goes into the **top** contact `M<n>t`. `M10` is the machine's play-wire home, `M11` the player's; the program table ends `M10/free*` and `M11/free**` with the footnotes "* this is the machine's 'play' wire" / "** this is the player's 'play' wire". Play starts with the machine's free end in `6com`. [verified] — B56 pp.55–56
- Character-recognition programs invert that: "when programming a geometric form or a numeral for recognition, be sure that the connections from M10 are made to the **top** terminals in the matrix." Different application, both correct. [verified] — ER, Book V pp.21–22 note
- Legend `MATRIX` printed in the **bottom-left corner** of the matrix block, left-aligned against the plate's own left edge (the blue console frame) — **not** against the MATRIX/POWER divider rule, which is at the far right, a full matrix-width away at native x≈3778. Heavy caps, larger than the small labels. [verified] — PH2

### 7.4 POWER controls

Narrow vertical strip at the far right, separated from MATRIX by a vertical cream rule that runs from inside the blue stripe down to the bottom of the plate. Contents top to bottom: [likely] — PH2, PH3

1. **The red power light. Settled: the factory power panel carried a power light and no fuse.** MM p.3's *Power Supply Circuit Diagram* enumerates the whole power-panel circuit — POWER CORD, POWER SWITCH, TRANSFORMER, RECTIFIER, CIRCUIT BREAKER, POWER LIGHT, `+` / `-` outputs — and contains no fuse; MM p.4 step 8 treats the light as a replaceable panel item ("replace it with a new light assembly"); MM p.11's spare-parts list runs 6431–6491, carries 6435 *Light Assembly*, and lists no fuse; B1 p.3 says "The red power light shows when the power is ON". PH3 shows it in place: a small **red translucent jewel** on a knurled threaded barrel. [verified] — B1 p.3; MM pp.3, 4, 11; PH3. That *this* position is where it was mounted: [likely] — PH2, PH3, PH1 agree only that a round component sits here.
   PH2's unit instead carries a black knurled bayonet **fuseholder cap**, engraved `FUSE` four times radially (roughly 12, 3, 6 and 9 o'clock, the 6 o'clock instance inverted) around **two** short curved rotation arrows set inside the ring of text. It is a **later owner modification**, not a factory variant: the holder is oversize, physically overhangs the panel, and hides the word `CIRCUIT` in the `CIRCUIT BREAKER` legend below it — a factory fit would not obscure its neighbour's legend, and PH3 shows `CIRCUIT BREAKER` fully legible. [verified] — PH2 at 8× (cap engraving) and 3× (overhang); PH3 at 4×
2. Two-line legend `CIRCUIT BREAKER`.
3. A large red push button with a chrome/cream bezel ring — the circuit breaker. "The red button above the power switch labeled CIRCUIT BREAKER is a safety switch which automatically turns off the power supply when it is overloaded." [verified] — B1 p.3; MM pp.3–4
4. A small cream disc — a mounting rivet head. MM p.5 rivet-mounts the power switch just as MM p.9 rivet-mounts the slide switches; see §6 Band 5. [likely] — MM pp.5, 9; PH2
5. Legend `ON`.
6. A red slide actuator, vertical — the power switch. [verified] — B1 p.3
7. Legend `OFF`.
8. A second small cream disc, the matching rivet head. [likely] — MM pp.5, 9; PH2

**No jacks in this block.** [verified] — PH2, PH3

### 7.5 DECIMAL INPUT-OUTPUT

```
   16  o o                      15   0   1
       ARM                  14             2
                          13                 3
   17  o o -+                      ( knob )
            | RUN         12                 4     0 at 12 o'clock,
   18  o o -+                                       increasing CLOCKWISE
            | STOP        11                 5     4 at 3, 8 at 6, 12 at 9
   19  o o -+                10             6
                                 9   8   7

                 DECIMAL INPUT-OUTPUT
```

Numerals sit in the inner annulus; each sector's two-hole terminal sits in the outer annulus.

- Fills the lower-right plate. A circular dial divided into **sixteen sectors** by radial cream rules, drawn between **three concentric cream circles**: inner (around the knob), middle, outer. The sector **number** prints in the inner annulus; the sector's **terminal — two holes —** sits in the outer annulus. [verified] — PH2; B1 p.20 figure
- Numbering: **0 at 12 o'clock, increasing clockwise** through 15. Position 4 at 3 o'clock, 8 at 6 o'clock, 12 at 9 o'clock. [verified] — PH2; B1 p.20 panel figure
- Centre: the pointer knob. **Colour and pointer form are not settled** — B1 p.20 draws a teardrop/leaf; PH1 shows a red cylinder with a cream blade reaching the number ring; PH2 shows a **dark brown/maroon** cylinder whose white pointer is a **pie-wedge on the top face terminating at the knob's own rim** (radius ≈150 px against the dial's inner circle at ≈195 px), not reaching the ring. Three sources, three forms. [verified that they differ / unverified which is stock] — see §11
- To the left of the dial, a vertical stack of four numbered 2-hole terminals: `16` with `ARM` printed below it, then `17`, `18`, `19` lower down. Numerals print to the **left** of each hole pair. A printed cream bracket links 17 and 18 labelled `RUN`; a second links 18 and 19 labelled `STOP`. **The brackets span pairs of jacks — RUN is not a label on jack 18.** [verified] — PH2; B1 p.20 figure
- Function: `D16` is the wiper arm. RUN = power across D17/D18; STOP = a short across D18/D19. "Check the motor drive by connecting power to the RUN terminals (D17 and D18)… Connect a short circuit across the STOP terminals (D18 and D19): the pointer knob should stop turning." [verified] — MM p.9; B1 pp.20, 22. Motor branch topology in `rotary.md`.
- Designation rule as printed: "D = Decimal Input-Output / 8 = terminal number (1 to 19) … for example D8. The contact on the wiper arm is referred to as 'D16.'" **The `(1 to 19)` is a manual error** — see §10. [verified as printed] — B1 p.20, confirmed on the page image, not just OCR
- Legend `DECIMAL INPUT-OUTPUT` printed across the **bottom** of the block, below the dial, roughly centred/slightly right, heavy letterspaced caps with a hyphen. [verified] — PH2
- Two small pale marks on the dark field at the upper left of the block, above the `16 ARM` terminal, are **finish damage, not fasteners.** At 4× they are irregular, ragged-edged, flat, matte and chalky-white, flush with the panel and casting no shadow — where the slide-switch discs under the same light are round, slightly domed and cast a lower-right shadow. They therefore bear on the panel-material question: the dark field is a coating over a lighter core. [verified] not fasteners; [likely] chips exposing a lighter substrate or primer — PH2 (marks at native ≈(3230,1395) and (3190,1425))

## 8. Complete legend inventory

Exact text and capitalisation as printed. Position is relative to the jacks or control the legend labels. [verified] — PH2, corroborated where possible by B1 figures.

### Left field

| Text | Form | Position |
|---|---|---|
| `1` `2` `3` `4` `5` `6` | large numerals, one per channel | top of each channel, in the BINARY OUTPUT band, above and slightly left of that channel's lamp |
| `BINARY OUTPUT` | band title | centred on the left field, below the row of six lamps, bottom of band 1 |
| `A` | terminal letter | below the left 2-hole terminal of each output lamp |
| `B` | terminal letter | below the right 2-hole terminal of each output lamp |
| `+` | glyph | **above** the left 2-hole terminal of each channel, on the blue power stripe |
| `-` | glyph | **above** the right 2-hole terminal of each channel, on the blue power stripe |
| `LIGHT` | bracket ornament | band 3, cream rule with downturned end-ticks spanning C→E, above them |
| `COIL` | bracket ornament | band 3, spanning E→F, above them |
| `C` `E` `F` | terminal letters | below the left / middle / right coil-side terminals above each relay |
| `STORAGE/PROCESSING` | band title | centred on the left field, between the relay indicator lamp row and the contact terminals |
| `N.O.` `ARM` `N.C.` | group legends | band 3, above the **top row only** (over G / H / J); govern both rows |
| `G` `H` `J` | terminal letters | below the top-row left / middle / right contact terminals |
| `K` `L` `N` | terminal letters | below the bottom-row left / middle / right contact terminals |
| `COMMON` | group legend | above the 4-hole terminal in the left half of each channel, on the blue auxiliary stripe |
| `CAPACITOR` | group legend | above the 2-hole terminal in the right half of each channel, on the blue auxiliary stripe |
| `SECONDARY STORAGE` | band title | centred on the left field, **top** of band 5 |
| ← (short arrow) | glyph | band 5, above the R column only, ~one hole-pair wide, clear gap to ARM |
| `ARM` | group legend | band 5, above the S column |
| → (short arrow) | glyph | band 5, above the T column only, ~one hole-pair wide, clear gap to ARM |
| `R` `S` `T` | terminal letters | below the top-row slide-switch terminals |
| `U` `V` `W` | terminal letters | below the bottom-row slide-switch terminals |
| `BINARY INPUT` | band title | centred on the left field, **top** of band 6 |
| `N.O.` `ARM` `N.C.` | group legends | band 6, above X / Y / Z |
| `X` `Y` `Z` | terminal letters | below the left / middle / right pushbutton terminals |

### Right column

| Text | Form | Position |
|---|---|---|
| `Minivac 601` | mixed-case logotype, large | logo plate, top of the right column, left-aligned, near full plate width |
| `Scientific Development Corporation, Cambridge, Massachusetts. Made in U. S. A. Patents applied for.` | one line of small type | immediately below the logotype, same plate. **City varies between units** — see §10 |
| `+` | glyph | above a 2-hole terminal on the right column's blue power stripe (designated `M+` in manuals) |
| `-` | glyph | above a 2-hole terminal on the same stripe (designated `M-`) |
| `POWER` | block title | right end of the blue power stripe, over the POWER sub-block |
| `1 2 3` / `8 9 4` / `7 6 5` | small numerals | one per matrix cell, in the gap between that cell's top and bottom hole pairs |
| `10` | small numeral | **below** the six-hole cluster left of the 3×3 board |
| `11` | small numeral | **below** the six-hole cluster right of the 3×3 board |
| `MATRIX` | block title | bottom-left corner of the matrix block, left-aligned against the plate's left edge (the blue console frame), not against the MATRIX/POWER divider |
| `CIRCUIT BREAKER` | two lines, all caps | POWER sub-block, above the large red button |
| `ON` | legend | POWER sub-block, above the vertical red slide switch |
| `OFF` | legend | POWER sub-block, below the vertical red slide switch |
| `0`–`15` | small numerals | one per dial sector, inner annulus, 0 at 12 o'clock increasing clockwise |
| `16` | numeral | **left** of the wiper-arm terminal, upper left of the decimal block |
| `ARM` | legend | below the 16 terminal |
| `17` `18` `19` | numerals | **left** of their 2-hole terminals |
| `RUN` | bracket label | outside a printed bracket linking terminals 17 and 18 |
| `STOP` | bracket label | outside a printed bracket linking terminals 18 and 19 |
| `DECIMAL INPUT-OUTPUT` | block title | across the bottom of the decimal block, below the dial |

## 9. Typography, colour, materials

**Typography** [verified as description; typeface family not named by any source]
- All block and group legends: heavy, wide, sans-serif grotesque, all caps. Generous letterspacing on the long band titles (`BINARY OUTPUT`, `SECONDARY STORAGE`, `BINARY INPUT`, `DECIMAL INPUT-OUTPUT`); `STORAGE/PROCESSING` is letterspaced comparably, not tighter — no measurement supports the tighter reading.
- **The small group legends are letterspaced too**, and a redraw must track them out or they will not match the photograph: `N.O.` and `N.C.` read on the panel as `N. O.` and `N. C.`, with a clear gap after each period. It is tracking, not a typed space. [verified] — PH2 at 8×
- Terminal letters: same heavy caps at small size.
- Section numerals 1–6: same face, much larger and bolder.
- `Minivac 601` logotype is the odd one out — mixed case, tightly fitted, heavier and more geometric than the panel legends.
— PH2 at native resolution

**Colour** [verified as scheme]
- Panel field: very dark, reads black to near-black, with brown/olive mottling from age and handling.
- Separator stripes, panel outer border, the frame between plates, and the case's outer edges: **a single light blue / turquoise**.
- All printed legends, rules, brackets, board lines and dial graphics: **a single cream / off-white**.
- Controls: all six BINARY INPUT pushbuttons red; all six slide actuators red; POWER slide actuator red; CIRCUIT BREAKER button red; all twelve lamp lenses red in white/cream bezel rings. The rotary pointer knob is **not** reliably red — see §7.5.
— PH2, PH3; B1 cover photograph (printed black plus one light-blue spot colour, same stripe/border scheme)

**Precise colour values are not established.** [unverified] RGB sampled off PH1 gives the blue stripe ≈ `#7C909D`–`#658795` and the dark field ≈ `#533E2C`, but PH1 is the worst of the three photographs for colour — warm, dim, low-resolution. PH2 shows the blue as a distinctly **greener teal** than PH1's grey-blue. These are photograph values, not paint values; the B1 cover is a two-colour print and cannot settle it. Any colour work should be redone off PH2.

**Panel substrate: not established by any source read.** [unverified] Candidates searched and none confirmed: hardboard/Masonite, phenolic, painted metal. Nothing in B1–B7, MM or ER names it. What the chipped finish above the `16 ARM` terminal does establish is that the dark field is a **coating over a distinctly lighter, chalky off-white core** — so the field is not a self-coloured dark material. [likely] — PH2, see §7.5. See §11.

**Ratings behind the panel** [verified] — MM pp.2–3
- Power supply rated 1.5 A continuous, nominal 12 V output; **unloaded outlet voltage ≈13 V**.
- All switches rated 3 A; relay contacts rated in excess of 3 A.
- "The lights are operated at less than their rated voltage to extend their operating life."
- "The drive motor is operated at less than one-third rated voltage."
- Rotary switch uses silver-plated circuits; contact fingers are beryllium copper; drive shaft is stainless steel in an oil-impregnated bronze bearing.

## 10. Panel vs manual differences

| # | Difference | Status |
|---|---|---|
| D1 | **Address.** The panel plate reads *Cambridge, Massachusetts*. All six books' copyright pages and back covers, MM's cover, and ER's footer read *372 Main Street, Watertown, Massachusetts* (MM's spare-parts address adds the zone, "Watertown 72"). Four printed Watertown attestations against one photographed Cambridge plate. WP asserts Cambridge is the earlier address, which would make the photographed unit older than the Aug 1961 first printing — single secondary source. | **Reported, not resolved.** Both primary. [verified — both readings] |
| D1b | **The plate city varies between units.** PH3, a different machine, reads neither Cambridge nor Watertown: a ~7-glyph word ending `-tham`, ascenders at t/h, no descender. Most plausible *Waltham*. At least three distinct address strings are now in evidence. A fourth reading, recorded **as an observation only**: PH4's plate — a **MINIVAC 6010**, not a 601 — reads "Scientific Development Corporation, Watertow[n], Massachusetts", unambiguous at 10×. | Variance **[verified]**; the specific PH3 reading **[unverified]** — resolution-limited. The 6010 reading **[verified]** but **6010 scope**. Not resolved. |
| D2 | Panel prints `STORAGE/PROCESSING` (slash, no spaces); B1 p.12 body text writes "storage-processing" (hyphen, lower case). | [verified] |
| D3 | Panel prints `DECIMAL INPUT-OUTPUT` (caps); B1 pp.20, 22 write "Decimal Input-Output" in prose. | [verified] |
| D4 | **Matrix designation rule is over-general.** B1 p.25 states "M = matrix / 6 = terminal number (**1 to 11**) / t = top or 'b' for bottom", implying `M10t`/`M10b`/`M11t`/`M11b` exist. The panel shows 10 and 11 as single six-hole terminals with no top/bottom split, and every program addresses them bare. The rule holds only for positions 1–9. | [verified] |
| D5 | **D-terminal range is wrong in the manual.** B1 p.20 says "8 = terminal number (**1 to 19**)", excluding D0. D0 exists: the dial has a 0 sector with its own hole pair; the same page's under-panel figure shows a 0 contact; MM p.10 says "connecting output lights through the rotary switch contacts, D0 through D15"; D0 appears in 13 program lines across Books IV–VI and in B7. **Correct range is D0..D19.** Confirmed on the page image, not just OCR — the manual really does print "1 to 19". | [verified] |
| D6 | B1 p.20's second figure, "VIEW UNDER PANEL", numbers the dial 0 at top running **counter-clockwise** — the mirror of the panel face. Expected for an under-panel view. Not a contradiction. | [verified] |
| D7 | B1 p.20's *panel* figure draws each dial sector's two holes **joined by a short line**, using the matrix's "lines indicate terminals connected together" convention. On the real panel the two holes of a dial terminal are plain and unjoined. Drawing convention. **A redraw must not copy it.** | [verified] |
| D8 | B1 p.20's panel figure draws the rotary pointer knob as a **teardrop/leaf**. PH2 shows a brown/maroon cylinder with a white pie-wedge on its top face; PH1 shows a red cylinder with a cream blade. | Not settled. [verified that they differ] |
| D9 | B1 p.18's slide-switch figure draws the switch schematically and omits the two round pale discs that flank every slide switch on the real panel, and that reappear above `ON` and below `OFF`. | [verified]. MM p.9's "drill out the rivets" makes mounting rivets the [likely] explanation. |
| D10 | **Agreement, recorded as a positive cross-check.** B1's cover product photograph, p.25's matrix figure, p.20's rotary figure and p.18's slide-switch figure all agree with the photographed units on band order, right-column contents, matrix arrangement, dial numbering, terminal lettering and section-numeral placement. No layout differences found. | [verified] |
| — | **Closed:** B1 p.25's "The four COMMON terminals are connected together" is not a discrepancy. ER settles the reading: "…the four at 3com." Six independent four-hole blocks. | [verified] — ER |
| — | **Struck:** the apparent "manual says white coil, unit shows tan" discrepancy was an artefact of PH1's warm tungsten light. On PH2 the coil bobbins are white/cream, exactly as B1 p.14 says. No discrepancy. | [verified] — PH2 |

## 11. Not settled by the sources

Each item names its fallback for the simulator and what would settle it.

| Question | Fallback | What would settle it |
|---|---|---|
| Panel substrate material (hardboard / phenolic / painted steel / aluminium). The dark field is now known to be a **coating over a lighter, chalky off-white core**, so it is not a self-coloured dark material — but the core is still unnamed. | Render as a matt dark coating over a lighter core; do not model the core material. | A photograph of a cut edge or the underside, or SDC production artwork. MM's repair language does not discriminate. The chips above the `16 ARM` terminal establish the coating-over-lighter-core structure [likely] but name no material. |
| True paint colours — the blue of the case and stripes, the black of the field, the cream of the printing. | Sample off PH2 (greener teal than PH1), not PH1; treat as approximate. | A colour-managed photograph of an unfaded unit with a colour target in frame, or a factory paint spec. |
| Typeface family for the panel legends and for the `Minivac 601` logotype. | Substitute a heavy geometric grotesque; do not claim a family. | Higher-resolution flat scans of the legends, or SDC artwork. |
| Absolute panel dimensions and the absolute pitch of the jack grid. | Use the §3 proportions, re-measured off PH2. | A dimensioned drawing, replica CAD, or a scale-referenced orthographic photograph. |
| **Closed** — the factory part is the red power light (MM p.3's power-supply diagram has no fuse; spare part 6435 is a *Light Assembly*), and PH2's fuseholder is an owner modification. What remains open is only the light's lens and bezel type. | Draw it like the panel's other lamps — red translucent lens in a cream bezel — on the knurled threaded barrel PH3 shows. | A macro photograph of an unmodified unit's power light, or SDC parts documentation. |
| Pointer-knob colour and pointer form (teardrop / red-with-blade / brown-with-wedge). | Do not commit to "red knob, blade reaching the ring". | More dated units, or SDC parts documentation. |
| Whether the six sections' jack rings are the same printed element as the MATRIX's, where the ring is demonstrably printed ink. | Draw them all as printed ink. | A macro photograph of a single section jack. |
| Function of the two round pale discs flanking each slide switch and bracketing the POWER switch. | Draw as rivet heads. [likely] | An underside photograph, or MM's slide-switch mounting detail. |
| Whether the CAPACITOR terminals were populated in 1961 601 production, or only from the 1962 accessory programme. B1 (1961) says "may be ignored"; B7 (1962, joint 601/6010) specifies 500 µF (sections 1–5) and 1000 µF (section 6), one plate permanently on the minus rail. | Model them as live per B7; make it a switchable assumption if a 1961-only mode is ever needed. | An under-panel photograph of a 601 predating the accessory manual, or an SDC accessory catalogue. |
| Whether the 500/1000 µF split is identical on the 601 and the 6010 — stated once, for "the MINIVAC", in a manual titled for both. | Apply to the 601. | A 6010-specific manual, or a measured example of each. |
| Which address is chronologically earlier, Cambridge (panel) or Watertown (all printed SDC documents), and what the PH3 unit's plate actually says. The 6010 plate on PH4 reads *Watertown*, but **that does not date the 601 plates and must not be used to order Cambridge, Waltham and Watertown** — different model, unknown date; the question stays open. | Print the PH2 text verbatim; do not encode a company history. | Dated SDC advertising, incorporation records, or serial-numbered units with photographed plates. |

## 12. Corrections applied

The verification pass overturned eight panel claims and one whole-corpus assertion that the first research pass had tagged [verified] off a single 1536-px photograph and three of the six PDFs on disk — Books I–VI only; Book VII, the Maintenance Manual and the errata sheet were not searched. Recorded here so a later pass does not reintroduce them. **All of these are wrong:**

- ~~"On the blue stripes the hole pairs sit on a dark oval escutcheon so they read against the blue."~~ There is no escutcheon. The dark blobs are the grey metal taper pins of **inserted programming wires** — on PH2 the terminals that read dark are exactly the ones with a wire in them, and unoccupied neighbours show plain ringed holes on flat blue. A redraw must not paint dark ovals under the blue-stripe jacks. — PH2
- ~~"The two holes of one terminal sit inside a single printed oval / are joined by a short printed bar."~~ Fabricated visual cue, asserted [verified] from a photograph that cannot resolve it. At 4208 px there is no such artwork anywhere in the six sections. Printed joining artwork exists **only** in the MATRIX. — PH2
- ~~"The letter is silkscreened below the hole pair"~~ as a whole-panel rule. True for the lettered terminals only; `+` and `-` print above, decimal numerals print to the left. B1 p.5 uses both senses in one paragraph. — B1 p.5; PH2
- ~~"A long left-pointing arrow whose tail extends back over the ARM."~~ The SECONDARY STORAGE arrows are short, self-contained, one over R and one over T, with a clear gap to the word ARM. — PH2
- ~~"A red rectangular actuator running in a light ivory/cream housing."~~ The actuator protrudes through a plain dark slot in the dark panel field; the switch body is under the panel. The pale impression is a PH1 lighting artefact. — PH2; MM p.9
- ~~"A slotted screw head is visible beside/above each pushbutton."~~ No such screw. It is the button's chrome/cream bezel ring peeking past the red cap. MM p.7 puts the mounting screw **under** the cap. — PH2; MM p.7
- ~~"Contact springs behind the crossbar."~~ The contact stacks are plainly visible **to the right** of the crossbar, as two vertically separated spring assemblies. This is what makes the upper→`G H J` / lower→`K L N` mapping a physical observation rather than an inference. — PH2
- ~~"The dark round component at the top of the POWER strip is the power indicator lamp."~~ Wrong for PH2, whose unit carries an owner-fitted fuseholder cap engraved FUSE in that position. But the **factory** part in that position *is* the power light, and that is now settled, not open: MM p.3's power-supply diagram lists a POWER LIGHT and no fuse, MM p.4 step 8 replaces it as a panel item, and MM p.11's spare-parts list carries 6435 *Light Assembly*. See §7.4. — PH2, PH3; MM pp.3, 4, 11
- ~~"No shorthand designator for the CAPACITOR jacks appears anywhere, and no program connects to them — whole-corpus census found zero uses."~~ The census covered three of the six PDFs on disk — Books I–VI only; Book VII, the Maintenance Manual and the errata sheet were not searched, and the `<n>cap` designator that broke the census lives in the first of those three. The designator is `<n>cap` and SDC published programs using it. — B7 pp.10, 11, 21. The narrower statement — that no `cap` token appears in **Books I–VI** — does survive.
- ~~"The panel is divided by a full-height printed vertical stripe."~~ It is the blue console frame between three separate dark sub-panels. — PH2, PH3; MM pp.1, 3
- ~~"'M+ is the plus rail' is nowhere stated; the inclusion rests on position and program usage."~~ ER states it by name: "a connection to 1+ is the same as a connection to 3+, 6+, or M+." — ER
- ~~"Coil bobbins read tan/buff — ambiguous against the manual's 'round white coil'."~~ PH1 lighting artefact. They are white/cream. — PH2
- **Withdrawn — this entry was itself wrong.** It previously read that a cited program line, `2K/3com` / `4G/5com` "in Books II–IV", does not exist in any spacing variant anywhere in Books I–VI, and charged the first pass with a fabricated citation. The lines do exist: `2K/3com`, `4G/5com` and `6A/6com` are all printed in the 49-wire *Program for Decimal to Binary Converter*, Book IV printed p.85 (`book2-3-4.pdf` PDF p.91). The verifying grep allowed only one optional space per glyph gap, and that page's OCR sets the line as `2 K /3 c o m`. The original citation was correct, so the verifier's headline should read "eight refutable claims", with no fabricated citation. — B234 p.85, read from the page image; corroborated by `programs.md` IV-EXP11 and by whitespace-insensitive grep on `book2-3-4.txt`. The `<n>com` addressing it supported is in any case corroborated by B234 p.59's notation sentence and its `1T/3com`, `2W/3com`, `3A/3com`, `3T/3com`, by ER's "the four at 3com", and by `1com`..`6com` throughout Book VI.
