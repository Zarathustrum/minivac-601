# MINIVAC 601 — history, provenance and artifacts

Scope: 601 only. Every 6010 statement is labelled `6010 DELTA`.

Tag legend: `[verified]` read from a primary page image, panel photograph, or a source fetched and checked in this pass · `[likely]` a secondary source, or a primary reading through OCR only · `[unverified]` inference, single-source, or asserted with no traceable evidence.

This file is the verified merge of `raw/find-context.json` and `raw/verify-context.json`. Where the two disagree, the verifier wins; every refutation is applied in place and restated in [Corrections applied](#corrections-applied).

---

## What an implementer needs from this file

1. **The primary corpus is nine documents, not six.** Books I–VI (Aug 1961), the Maintenance Manual, the errata sheet, and **Book VII, the MINIVAC 601/6010 Capacitor/Resistor Manual (1962)**. The phrase "the six-book set" is the errata sheet's own wording about itself and must not be generalised. `[verified]` — errata masthead; `raw/pdf/book7-capacitor-resistor.pdf` cover.
2. **Never build a wire list from `raw/pdf/errata.txt`.** All 48 connections of the alternate three-bit counter do survive the extraction — the damage is glyph-level and reading-order-level, not lossy. Four corruption classes: the two-column sheet is interleaved line by line; every `+` renders as `-f` or `-|-` (`1G/1+` → `lG/l-f`); `1F/1H` → `IF/TH`; `6L/6-` → `61/6-`. Exactly one line is destroyed to noise, the Book V p.24 Experiment 14 correction. Use the page images. `[verified]`
3. **Never build a Book VII wire list from its OCR either.** The local copy is the Internet Archive `_text` derivative; its text layer garbles the cover title and renders the Greek omega bias-resistor notation as `Q`. There is no `Q` terminal on the MINIVAC 601. `[verified]`
4. **Plain `grep` over any of these OCR layers is unsafe.** `grep -i watertown book1.txt` returns zero hits on a page that carries "372 Main Street, Watertown, Massachusetts" — the OCR renders it `W atertow n`. Every argument-from-silence must be re-run whitespace-insensitively. `[verified]`
5. **The only existing browser simulator has no declared licence, and its source was deliberately not read.** See [Oracle-only ruling](#oracle-only-ruling-sadetsky-simulator). Default copyright applies; nothing may be derived from it.
6. **The one published replica measured nothing from an original.** Mike Gardi built from the same photographs and manuals we have. He is downstream evidence, not an authority on original dimensions. `[verified]`

---

## Primary document set

| Document | Date | Pages | Local file | Bytes / md5 | Tag |
|---|---|---|---|---|---|
| Book I — *Getting Acquainted with Minivac 601* | First Printing Aug 1961, © 1961 | — | `raw/pdf/book1.pdf` | 1,707,863 / `b25e4dcb50071d1e047eeae33d737eb7` | `[verified]` |
| Books II, III & IV (one continuously paginated volume) | Aug 1961 | II pp.1–33, III pp.35–65, IV pp.66– | `raw/pdf/book2-3-4.pdf` | 2,933,205 / `e93e0924618ddc24b2af16820e02418b` | `[verified]` |
| Books V & VI | Aug 1961 | — | `raw/pdf/book5-6.pdf` | 1,929,436 / `485d742e52772c4c44d4324de1eaab7b` | `[verified]` |
| MINIVAC 601 Maintenance Manual | 1961 | 13 | `raw/pdf/maintenance-manual.pdf` | 231,416 / `6294aa4933971c6564f94a98a1c5ed40` | `[verified]` |
| *Notes and Corrections to the Minivac Manual* (errata sheet) | 1961/62 | 4 | `raw/pdf/errata.pdf` | 140,730 / `f78de9222b01596b9073e8655e27fff1` | `[verified]` |
| **Book VII — MINIVAC 601/6010 Capacitor/Resistor Manual** | © 1962 | 55 | `raw/pdf/book7-capacitor-resistor.pdf` | 4,052,767 / `d03919b7d05537ff3410ceb3e29d2170` | `[verified]` |

All six books credit the company, not a person: "The Minivac Manual was prepared and edited by the staff of Scientific Development Corporation." / "First Printing — August, 1961." `[verified]` — front matter of Book I, Books II–IV, Books V–VI.

One named SDC individual survives anywhere in the primary record: the errata sheet closes "Please address correspondence of this nature to the Editor of the MINIVAC Manual: **Linda G. Sprague**." `[verified]` — errata sheet, final paragraph. She is the only traceable SDC employee name; any biographical identification would be inference and is not made here.

### Scan provenance

| Fact | Detail | Tag |
|---|---|---|
| Origin of every Minivac scan in circulation | Adolfo García Yagüe / ccapitalia.net, article dated 16 Jan 2014 at `http://www.ccapitalia.net/?p=1257`. Every page of all five 1961 PDFs carries an "EX LIBRIS ccapitalia.net" watermark; PDF CreationDates are 2014-01-13. | `[verified]` |
| archive.org mirror (Books I–VI, MM, errata) | `https://archive.org/details/1961Minivac601Book234` — "Minivac 601 (1961) Owner Manuals", uploaded 2015-07-06 by (uploader's email withheld), stated source ccapitalia. Five files. | `[verified]` |
| archive.org item for Book VII | `https://archive.org/details/book-vii_202512` — creator "Scientific Development Corporation", date 1962-01-01, uploaded 2025-12-21 21:41:39 by (uploader's email withheld). Subject tags: MINIVAC 601, MINIVAC 6010, MINIVAC Book VII. | `[verified]` |
| **Book I is *not* the archive.org file** | Our local `book1.pdf` (1,707,863 B, md5 `b25e4dcb…`) is byte-identical to the ccapitalia publisher scan. The archive.org copy is a different, IA-re-derived file (1,714,771 B, md5 `984a7035c6e1d049a76c1f188ee9b55c`). `book2-3-4.pdf` and `book5-6.pdf` do match the archive item exactly. | `[verified]` |
| Consequence | Page-count and page-offset arithmetic derived from one `book1` file must not be assumed to hold for the other. Key on printed page number, not PDF offset. | `[verified]` |
| Better Book VII scan exists | Same archive item, `Book VII.pdf`, 139,626,576 B, md5 `d9953e46808f3435ed03782eecb57e2c`. Acquire it before mining Book VII for terminal letters. | `[verified]` |
| Fetching from ccapitalia | Requires a **full** Chrome User-Agent; a bare `Mozilla/5.0` still 403s. `?p=1257` intermittently serves a CloudLinux "Test Page for the HTTP Server". The site is not reliably up — mirror anything still wanted now. | `[verified]` |
| Re-hosts, not new sources | Scribd `document/371661752`, manualslib, manualzz are all re-uploads of the ccapitalia scans. | `[likely]` |
| US copyright status of the manuals | Book I registered 19 Aug 1961 as A526420 (*Catalog of Copyright Entries*, 3rd ser., vol. 15, p. 1698). | `[verified]` |
| No renewal found | The US Copyright Office online catalog and NYPL's cce-renewals transcription (renewals 1978–2001), searched 2026-10-15, show no renewal of any Minivac manual. Conclusion: the noticed 1961 books lapsed into the US public domain at the end of 1989, Book VII (1962) at the end of 1990; status outside the US may differ. | `[likely]` |
| Not present | bitsavers has no Minivac / Scientific Development Corporation directory. worldradiohistory has nothing Minivac-specific. Museum sites offer catalogue records only, no scans. | `[likely]` |

### Document hygiene — citation and extraction traps

| Trap | Correct handling | Tag |
|---|---|---|
| `errata.txt` interleaves the sheet's two columns line by line | All 48 counter connections survive; the damage is glyph-level and reading-order-level. Four corruption classes: two-column interleave; every `+` → `-f` / `-|-` (`1G/1+` → `lG/l-f`); `1F/1H` → `IF/TH`; `6L/6-` → `61/6-`. One line destroyed to noise (the Book V p.24 Experiment 14 correction). Transcribe from the rendered page image only. | `[verified]` |
| Errata sheet-page numbering | 4 sheet pages. Page 1 = masthead + general notes + Book I (pp.13, 24, 28) + Book II complete (pp.10, 11, 14) + Book III's first entry, p.36, with its replacement circuit diagram. Page 2 = Book III pp.38–62 (left col) and Book IV pp.69–72 plus the alternate-counter figure and its 48-connection program (right col). Page 3 = Book IV pp.73–83 and Book V pp.2–25. Verified against a 200 dpi render of `errata.pdf` p.1. | `[verified]` |
| `book2-3-4.pdf` pagination | Continuous across three books. Key on PDF page, derive the book label. | `[verified]` |
| Book VII OCR | Omega notation renders as `Q`, `Qo`, `Q20`, `Q22`, `Q50`, `Q54`, `63`. A token census over it will invent a nonexistent `Q` terminal class. | `[verified]` |
| Any grep-based absence claim | Re-run whitespace-insensitive (`tr -d ' \t'`) and hyphen/newline-joined. | `[verified]` |

---

## Existing emulators

### Oracle-only ruling (Sadetsky simulator)

**Tom's ruling: do not open, fetch, clone, read or quote the source code of any existing Minivac emulator, in particular Greg Sadetsky's simulator at `minivac.greg.technology` and its GitHub repository.**

Both the research pass and the adversarial verification pass complied, and both recorded exactly what they did and did not touch. `[verified]`

Not done, in either pass:

- No file from `github.com/gregsadetsky/minivac` (nor its former name `minivac-601-simulator`, nor `package.json`, nor any blob URL) was cloned, fetched or opened.
- No `.js`, bundle or asset was fetched from `minivac.greg.technology`.
- No file from `github.com/jkoets/Minivac-601-Emulator` was fetched — the same caution was applied pre-emptively to the second emulator, pending Tom's ruling on scope.
- Willy McAllister's `circuit-sandbox` (the library the simulator is stated to be built on) was not read.

Done instead: the GitHub REST **metadata** record (name, description, homepage, dates, stars, licence field — no source code); third-party write-ups; the author's own public Hacker News comments, retrieved as JSON from the Algolia API. One WebFetch of the site root returned only the page `<title>` ("Minivac 601 Simulator") because the page is script-rendered — no code reached the agent.

**Everything below about this simulator is external observation. None of it is derived from its source.**

### Greg Sadetsky — Minivac 601 Simulator

| Field | Value | Tag |
|---|---|---|
| Site | `https://minivac.greg.technology/` — simulator at `/simulator/`, mirrored original manuals at `/manuals/`, a "Relay Tetris" demo at `/tetris/` | `[likely]` |
| Repository | `github.com/gregsadetsky/minivac` — created 2025-11-16, renamed from `minivac-601-simulator`, homepage field points at the site, 14 stars, last pushed 2026-08-28 (metadata read 2026-08-30) | `[likely]` |
| **Licence** | **None declared.** GitHub `license` field is `null`; FOSSi Foundation describes the project as available "under an unspecified licence". Absent a declared licence, default copyright applies — an independent practical reason, beyond Tom's ruling, not to derive anything from it. | `[likely]` |
| Modelled scope | A **real DC circuit solver**, not a boolean-gate simulator. Author: "The biggest unlock was finding Willy McAllister's excellent Circuit Sandbox, which provides the Minivac Simulator's underlying electrical math. I tried so many approaches to simulate electricity (a doomed DIY approach, Falstad, Spice…) but Circuit Sandbox's DC analysis did the job perfectly." | `[likely]`, quotation checked verbatim at source |
| Stated status | "This site is a work in progress. For now, you can peruse the original Minivac manuals (don't forget to check the erratas) and play around with the simulator." Runs entirely in-browser; drag wires; connect components; make short circuits; optional simulated relay clack. | `[likely]` |

Citations: GitHub REST repository-search metadata, queried 2026-08-30 · Greg Sadetsky, Hacker News item 45950396 (2025-11-17), full comment tree re-read at `https://hn.algolia.com/api/v1/items/45950396` · FOSSi Foundation, *El Correo Libre* 92, `https://fossi-foundation.org/blog/2025-12-11-ecl92` · Hackster.io news item (403s to direct fetch; read via search-result summary).

**Externally observable behaviour** — all from the author's own public statements, every quotation reproduced verbatim at source in the verification pass:

| Behaviour | Statement | Tag |
|---|---|---|
| Relay sound | Plays when a relay turns ON and when it turns OFF, and at no other time. "There is no sound when a button is pressed." | `[likely]` |
| Sound source | Not a recording of a real Minivac relay — "I'm using (gasp) not the original Minivac Relay sound". | `[likely]` |
| Shareable state | A wired circuit serialises into the URL fragment: `https://minivac.greg.technology/simulator/#wires=1%2B%2F1C%2C…` — i.e. the manuals' own slash shorthand (`1+/1C`), percent-encoded, comma-separated. | `[likely]` |
| Rotary wheel | **Not user-controllable** as of Nov 2025: "One of the crucial things I didn't get to yet is making that wheel controllable — some circuits in the manuals do require you to turn it. That's high in the todo list (with mobile support)." | `[likely]` |
| Author's hardware access | None. "Once/if I get to see a Minivac in real life, I may learn that buttons do make sounds." | `[likely]` |

**Practical consequences for using it as an oracle:**

- The `#wires=` fragment is the hook. A program listing lifted from a manual page converts mechanically into a URL and its result compares against our engine — with no code read.
- Because his core is a DC solver, any divergence may be a **circuit-solver** difference (what a short circuit does, how a marginal coil behaves) rather than a **MINIVAC-semantics** difference. Do not treat a mismatch as evidence about the machine without isolating which.
- Any manual experiment requiring the dial to be turned could not be cross-checked at the November 2025 snapshot. Re-check current behaviour before relying on it.
- **Independent corroboration that the rotary motor is undocumented:** Sadetsky publicly asked a Minivac owner for help "to figure out some specifics about the motor wheel (its speed and whether it experiences any speed up)". He is the other person who has read these manuals closely, and he could not find the answer either. `[likely]`

### Second emulator — jkoets

`github.com/jkoets/Minivac-601-Emulator`, described as "A TypeScript emulator core for the Minivac 601 (Scientific Development Corp., 1961) — the relay-logic educational computer designed under Claude Shannon." Created 2026-06-12, last pushed 2026-06-13, no licence declared, 0 stars. `[unverified]` — GitHub REST repository-search metadata, queried 2026-08-30.

Its code was **not** read. Tom's oracle-only ruling names Sadetsky's simulator specifically; the same caution was applied here pre-emptively. **Tom needs to rule on whether this one is in scope.** Existence recorded, nothing more.

A homebrew *hardware* MINIVAC 601 relay computer is described in a Facebook group post (`facebook.com/groups/402177264898386/posts/775075254275250/`); not accessible without login. Existence only. `[unverified]`

---

## The Gardi replica — evidentiary status

**Mike Gardi measured nothing from an original.** In his own words: "I don't have a 'vintage' unit so this replica has been constructed based on photos and from the original manuals that were available online." His panel geometry is inference from the same photographs we hold. He is a downstream reconstruction, not an upstream source, and must not be cited as an authority on original dimensions, jack spacing, or panel material. `[verified]` — Instructables *Minivac 601 Replica (Version 0.9)*, author `megardi`, 2019-06-12, step 1, `https://www.instructables.com/Minivac-601-Replica-Version-09/`, CC BY-NC-SA 4.0.

His explicit statements of uncertainty each mark a point where the original is undetermined `[verified]`:

- Panel material — "I'm not sure what the top panels were constructed from" (he 3D-printed his).
- Relay appearance — sourced relays that "don't look too bad".
- Lamp appearance — the lamps he found "did not have the right look", so he 3D-printed caps "more in line with the photographs".
- Pushbuttons — "considerably larger than the original's".

Substitutions, in full `[verified]` (Instructables v0.9, steps 2–9):

| Subsystem | Gardi's replica | Relation to the original |
|---|---|---|
| Power | 12 V 2 A wall-wart + T7812 regulator; barrel jack replaces the Power Panel circuit breaker | Replaces an internal transformer and 110 VAC mains |
| Lamps | 13 × 12 V panel-mount, ~15 mm mounting dia. | 12 panel indicators + power lamp |
| Slide switches | 7 × DPDT panel-mount, 28 mm hole centres, mounted under the panel | He says they "seem pretty much identical" to the original |
| Pushbuttons | 6 × SPDT arcade-style, Digi-Key 1568-1476-ND | Larger than original |
| Relays | 6 × NTE R14-11D10-12, DPDT, 12 V | Substitute part |
| Rotary switch | His own 3D-printed design using 16 reed switches | Not the original mechanism |
| Jacks | 388 rivets — 0.089 in (2.26 mm) tin-plated brass eyelets (36-35-ND) with solder lugs (36-4004-ND) | **His count of his own holes**, implying 194 two-hole terminals. A sanity check on an independently derived jack census, nothing more |
| Patch cords | Spaenaur 239-497 taper pins on 20 AWG: 20 × 8 in yellow, 20 × 16 in red, 10 × 24 in blue, "because the original did so as well" | |
| Frame | Laser-cut 1/8 in plywood, painted light blue "close to the original's" | |

**Motorised rotary switch — do not copy his clutch.** v0.9 does not implement the motor ("For this version I am asking the operator to be the motor"). v1.0, a drop-in replacement Decimal Input-Output panel published 2019-07-09, adds a friction drive with a 12 V speed-reduction motor, a 3D-printed flywheel with a 4 mm urethane round-belt tyre, ball bearings, and a **12 V solenoid that engages and disengages the motor**. The solenoid is Gardi's own invention. The original drives the wheel by permanent friction contact — "To assure proper friction drive, adjust the motor bracket and spring the motor shaft against the edge of the drive wheel" (Maintenance Manual p.10). **Do not model a clutch.** `[verified]`

Files and coverage `[likely]`: Thingiverse `thing:3689581` · Hackaday 2019-06-17 and 2019-07-13 · Boing Boing 2019-06-18 · Hackster.io · EDN.

---

## Surviving units, museums and collectors

| Holder | Record | Detail | Tag |
|---|---|---|---|
| Computer History Museum, Mountain View | catalog 102622941, accession X2079.2001 | Gift of Gene Mandel. Manufacturer "Scientific Development Corporation", place "Watertown, MA", date "ca. 1963 (Made)". **Serial number 1886.** Weight 10 lb. Lot: main unit in its original cardboard box (owner's name stamped inside the lid), 3 bags of jumper cables, **6 electrolytic capacitors**. | `[likely]`, every field reproduced verbatim against the live record 2026-08-30 |
| Centre for Computing History, Cambridge UK | CH499 | Dated 1 October 1961, price $85. One photograph. The museum also runs an SDC manufacturer page (`/det/564/`). | `[likely]` |
| System Source Computer Museum, Hunt Valley MD | artifact 205 | Dated 1961, price noted $85. Donated by Dr. Richard Taylor, who received the unit as a Bar Mitzvah gift. | `[likely]` |
| MIT Museum, Cambridge MA | — | `6010 DELTA`. Exhibits a MINIVAC **6010** attributed to SDC, 1962. | `[verified]` |
| Trammell Hudson (private) | trmm.net/Minivac_601 | "six relays, six switches, six buttons, twelve indicator lamps, a 3×3 matrix plug board and a 16-position rotating input/output device". Independent cross-check on lamp count: **12 panel indicators** (6 binary output + 6 relay), POWER lamp separate. | `[likely]` |
| Collectors (reachable) | HN item 45950396; retrocomputingforum.com/t/…/711 | One reports "a stack of these … they still work (they are fairly easy to fix)"; a unit was offered on the Vintage Computer Federation forums in 2021 for $500; a restorer who used one at age 11 in 1972 acquired one. | `[likely]` |

Two things in the CHM record matter for the build. Serial **1886** is the only serial number found anywhere and is a real production-quantity datum. The six loose electrolytics in the CHM lot bear on O-N5 — whether the capacitors were factory-fitted in 1961 production or shipped with the 1962 accessory kit — and on nothing else. They are not evidence about the jack's topology: Book VII printed p.11 has one plate permanently on the negative rail, with only the free plate brought out to the two-hole CAPACITOR jack.

**Dimensions and weight are not established.** Wikipedia's infobox gives 5 1/8 × 24 × 13 1/4 in sourced to the CHM record, but the live CHM record exposes no dimensions field at all — only weight 10 lb. Wikipedia's own infobox then gives weight 9 kg (≈20 lb), contradicting the CHM figure it otherwise leans on. `[unverified]` for any dimension or weight until one primary measurement exists.

**Production quantity and survival count are unknown.** Not settled by the sources. Fallback: treat serial 1886 as the only hard datum and make no population estimate. A serial-number census across museum records and collector reports would settle it.

### Panel variants

No panel variant of any kind surfaced. Three independently photographed 601 units share band layout and sub-panel arrangement: BINARY OUTPUT / a `+` and `−` strip / STORAGE-PROCESSING / a COMMON and CAPACITOR strip / SECONDARY STORAGE / BINARY INPUT, with the right-hand column carrying the logo plate, MATRIX, POWER and DECIMAL INPUT-OUTPUT. `[verified]`

This does **not** rule out variants; it means none surfaced in the photographs available. One observation is recorded rather than suppressed: the console frame reads teal/blue-green on the Wikimedia "Autopilot" unit and on `raw/prebrief/images/image_3.jpg`, and near-black on the CCH unit's photograph. Almost certainly lighting and a dark display plinth. `[unverified]` as to whether it means anything.

---

## Photographs on disk

| File | Subject | Resolution | Licence / author | Tag |
|---|---|---|---|---|
| `raw/photos/commons-minivac601-main.jpg` | Best flat-on whole-panel 601. All six bands, MATRIX, POWER and DECIMAL INPUT-OUTPUT legible; logo-plate fine print resolves at full crop. **Primary panel-geometry artifact.** | 4208 × 2457 | CC BY-SA 4.0, Wikimedia user "Autopilot", own work, 2015-05-12 | `[verified]` |
| `raw/photos/commons-minivac601-DSCF1392.jpg` | Second independent 601 — the Centre for Computing History unit in its display case (CCH interpretation card in frame). Band layout and sub-panel arrangement match. Logo-plate fine print is marginal at that angle: the company line and the trailing sentence resolve under a 5× upscale, the city word does not resolve to certainty. | 4288 × 2848 | CC BY 2.0, Mike Rosenberg, flickr `aleutia/7068639095`, 2012-04-10 | `[verified]` |
| `raw/photos/commons-minivac6010-mit-museum.jpg` | `6010 DELTA`. Direct top view of a 6010 panel, MIT Museum exhibit. **Do not mine for 601 geometry.** | 5161 × 2759 | CC0, Wikimedia user "Daderot", photographed 2026-04-17 | `[verified]` |
| `raw/prebrief/images/image_3.jpg` | Top-down 601 panel, legible to jack lettering. Supplied by Tom in the prebrief. | 1536 × 1152 | — | `[verified]` |

Geometry warning carried from the panel pass: `find-panel.json`'s redraw spec was measured entirely off the 1536 px `image_3.jpg` while the 4208 px photograph sat unopened in the same repository. Redo any geometry measurement off `commons-minivac601-main.jpg`.

### Logo plates — read at full resolution

| Machine | Legend verbatim | Read on | Tag |
|---|---|---|---|
| Minivac 601 | "Scientific Development Corporation, **Cambridge**, Massachusetts. Made in U. S. A. Patents applied for." | `commons-minivac601-main.jpg` (full-res crop) and `prebrief/images/image_3.jpg` | `[verified]` |
| Minivac 601 — third unit (Centre for Computing History) | "Scientific Development Corporation, **[…tham]**, Massachusetts. Made in U. S. A. Patents applied for." — identical layout and trailing sentence; the city is a short ~7-glyph word ending `-tham`, ascenders at t/h, no descender. That rules out *Cambridge* (9 glyphs, descender at g) and *Watertown*. Most plausible reading **Waltham**. | `commons-minivac601-DSCF1392.jpg` (full-res crop, 5× lanczos upscale) | **Variance** `[verified]`; the reading *Waltham* `[unverified]` — resolution-limited |
| Minivac 6010 | "Scientific Development Corporation, **Watertown**, Massachusetts. Made in U. S. A. Patents applied for." | `commons-minivac6010-mit-museum.jpg` (full-res crop) | `[verified]` |

Same plate layout, same trailing sentence on all three. Three different cities: two 601 plates read Cambridge, a third 601 plate reads neither Cambridge nor Watertown, and the 6010 plate reads Watertown.

### Film

**The "1961 SDC promotional film" appears not to exist**, or is not findable. The only moving-image candidate is a YouTube video titled "Minivac 601 — Scientific Development Corporation, 1961": a 2 min 36 s demonstration uploaded **2014-01-16** by the channel `ccapitalia`, Spanish description linking to `ccapitalia.net/?p=1257`. The "1961" in the title is the machine's date, not the film's. `[verified]` — page metadata read directly: `lengthSeconds` 156, `uploadDate` 2014-01-16. Do not cite a "1961 SDC promotional film" as a source without new evidence.

A search of the Prelinger / AV Geeks / Internet Moving Images collections under "Scientific Development Corporation" has not been attempted and is the cheapest remaining step.

---

## Company, dates and prices

| Fact | Value | Tag |
|---|---|---|
| Manufacturer | Scientific Development Corporation | `[verified]` |
| Paper address, 1961 **and** 1962 | 372 Main Street, Watertown, Massachusetts | `[verified]` as an enumeration — see below |
| Spare-parts order address | "Scientific Development Corporation / 372 Main Street / **Watertown 72**, Massachusetts" — a pre-ZIP postal zone, in use until 1 July 1963. Consistent with a 1961–62 imprint. | `[verified]` |
| Documentation in print | "First Printing — August, 1961", "Copyright © 1961" | `[verified]` — firmest date anchor in the record |
| Consumer launch | Autumn 1961. CCH dates it 1 October 1961; the first known advertisement is Popular Science, October 1961. | `[likely]` |
| List price | **$85.00** — printed in the Oct-1961 Popular Science ad and repeated independently by IEEE Spectrum, System Source, CCH, Old Computer Museum and the Time-Line Computer Archive. | `[likely]` |
| Seller styling, Oct 1961 | "Scientific Development Corporation, Consumer Products Division, 372 Main Street, Watertown, Massachusetts" | `[likely]` |
| Division renamed | "Digital Equipment Division", per the Nov 1961 Popular Science ad (p.31) | `[unverified]` — Wikipedia's reading of an ad not read here |
| Other SDC products | "Basic Communications Kits" advertised in Popular Science, June 1962, p.16 | `[unverified]` — Wikipedia, not read here |

The Watertown enumeration, stated as a list rather than a universal: Book I copyright page and back cover; Books II–IV copyright page and back cover; Books V–VI copyright page and back cover; Book VII back cover (1962); errata sheet masthead and footer; Maintenance Manual title page; Maintenance Manual spare-parts order block (with the postal zone). `[verified]`

### The $79.95 figure is unreliable — do not use it

A widely repeated price history says the 601 sold at $79.95 and the 6010 at $479. **The $79.95 traces to a single source** — a 2011 marketing-textbook anecdote (Lodish, Morgan & Archambeau, *Marketing That Works*, ch.3 p.11) — and it **conflicts with the $85.00 printed in the period advertisement**. Every other source repeating $79.95 is downstream of Wikipedia, which is downstream of that textbook. `[unverified]`

Treat $79.95 as unreliable. The primary ad says $85.00. Do not let a simulator's UI or docs repeat $79.95 as fact. Whether SDC ever discounted to $79.95 is unknown.

Inflation-adjusted figures quoted by third parties vary with their publication year — ~$675 (Spectrum, 2016), ~$718–720 (2019 sources), ~$916 (Wikipedia, 2025 dollars). None is a source about the machine.

### SDC spare-parts price list, 1961

Maintenance Manual, printed page 11 (PDF p.13), read from the rendered page image. All twelve rows resolve unambiguously; the two OCR casualties were "T.00" (circuit breaker) and "io.oo" (transformer). `[verified]`

| Part No. | Description | Price |
|---|---|---|
| 6431 | Circuit Breaker | 1.00 |
| 6432 | Slide Switch | .50 |
| 6433 | Rectifier | 3.00 |
| 6434 | Transformer | 10.00 |
| 6435 | Light Assembly | 1.00 |
| 6436 | Pushbutton Switch | .75 |
| 6437 | Relay | 6.00 |
| 6471 | Motor | 4.00 |
| 6472 | Drive Wheel Assembly | 2.00 |
| 6473 | Complete Rotary Switch Assembly | 20.00 |
| 6490 | Set of 100 Programming Wires | 12.00 |
| 6491 | Set of 2 test wires with clips | 1.00 |

Terms as printed: "To avoid C.O.D. charges please send check or money order with your spare parts order directly to [the above]. There is a handling charge of 25 cents for orders less than $5.00." `[verified]`

Two readings worth carrying forward. The part-number structure — 64xx console components, 647x rotary-switch subassembly, 649x wire sets — is consistent with the drive train (motor, drive wheel, complete rotary switch assembly) being a distinct subassembly. "Set of 100 Programming Wires" at $12.00 implies the machine shipped with on the order of 100 wires; the CHM unit came with three bags of jumper cables. `[likely]`

A previous owner's pencil arithmetic survives below the rule on the scanned page ("6 1.25 / 2.50 / 6 3.75", approximate reading). Not part of the printed document.

---

## Watertown vs Cambridge — moved, not settled

The corrected picture:

| Evidence stream | Address | Tag |
|---|---|---|
| 601 panels (two units read at full resolution) | Cambridge | `[verified]` |
| 601 panel, third unit — the CCH machine, `commons-minivac601-DSCF1392.jpg` | **Neither.** A ~7-glyph city word ending `-tham`, ascenders at t/h, no descender — excludes both *Cambridge* and *Watertown*. Most plausible reading *Waltham*. | Variance `[verified]`; the reading `[unverified]` — resolution-limited |
| 6010 panel, 1962 (one unit read) | Watertown | `[verified]` |
| All paper, 1961 and 1962 (Books I–VI, Book VII, errata, Maintenance Manual) | Watertown, 372 Main Street | `[verified]` |

That pattern is **consistent with** Cambridge being the earlier address, which is what Wikipedia's infobox says — but Wikipedia's `manufacturer` field carries no citation, and a silkscreen cut in Cambridge and reused unchanged after a move would produce exactly the same pattern. The third plate makes it worse, not better: at least three distinct address strings are now in evidence on 601-family panels, so a simple two-address chronology may not be the right shape at all. `[likely]` for the Cambridge-then-Watertown ordering; **not settled by the sources**.

Fallback for the build: render the 601 legend as it reads on the primary panel-geometry artifact, `commons-minivac601-main.jpg` — "Scientific Development Corporation, Cambridge, Massachusetts. Made in U. S. A. Patents applied for." — and carry the open question, noting that the legend is not uniform across surviving units. This affects a rendered string, not behaviour.

What would settle it: a MINIVAC trademark registration (owner address of record plus first-use-in-commerce date; USPTO and Justia both blocked automated access and are a live lead for a human); a Massachusetts corporate registration for Scientific Development Corporation 1960–63; a Cambridge or Boston city directory entry for those years; any dated advertisement carrying a Cambridge address; and, now, a Waltham directory or corporate entry for the same years. Cheapest incremental step: read the logo plate on every further 601 photograph that surfaces — one 601 reading Watertown would settle the direction immediately, and a second plate confirming *Waltham* would promote that reading out of `[unverified]`.

---

## Shannon: documented versus marketed

| Layer | Statement | Tag |
|---|---|---|
| **Documented** | The manuals never claim Shannon designed, invented or built the machine. The name appears in exactly one passage across the entire primary corpus — Books I–VII, the Maintenance Manual and the errata sheet — in the Boolean-algebra introduction: "The application of the operations and techniques of Boolean Algebra to switching circuits was first suggested in 1938 by Dr. Claude Shannon of the Massachusetts Institute of Technology. It was Dr. Shannon's original development work which led to the MINIVAC 601." Two occurrences, two consecutive sentences, one passage. That is a claim of intellectual lineage from his 1938 thesis, not of authorship of the product. | `[verified]` — Book III, printed page 44, read from a rendered page image: `book2-3-4.pdf` PDF page 50, folio 44, section "3. THINKING AND DECISION-MAKING", sub-head "Boolean Algebra". Absence elsewhere re-tested whitespace-insensitively (`tr -d ' \t'`) across all six local text layers — `book1.txt`, `book2-3-4.txt`, `book5-6.txt`, `book7-capacitor-resistor.txt`, `maintenance-manual.txt`, `errata.txt` — two hits, both at `book2-3-4.txt` lines 2205–2206, zero further hits anywhere. Book VII is a 1962 document, written *after* the advertising claim, and it too is silent; that one silence is `[likely]` rather than `[verified]`, because its text layer is the garbled IA `_text` derivative flagged above. |
| **Marketed** | The October 1961 Popular Science advertisement (p.33) says the MINIVAC 601 was "created as a private project by Dr. Claude E. Shannon, now Donner Professor of Science, MIT", and developed by the SDC staff. | `[likely]` — RF Cafe transcription of the ad; the same phrase quoted independently by IEEE Spectrum (Magoun 2016) and oldcomputermuseum.com. Original is Google Books id `XCEDAAAAMBAJ` p.33; the printed page was not read here. |
| **Investigated and not found** | IEEE Spectrum found no trace of the MINIVAC in Shannon's own record: not in his papers at the Library of Congress, not at the Charles Babbage Institute, not in the papers or accounts of his known home-computer collaborators Edmund Berkeley and Oliver Garfield. Spectrum's conclusion: "The nature of Shannon's association with the MINIVAC remains unsolved." The article ends by asking readers for help. | `[likely]` — Alexander B. Magoun, *Did Claude Shannon Invent a Groundbreaking Personal Computer?*, IEEE Spectrum, 28 April 2016. |
| **Suggestive, load-bearing on nothing** | Magoun notes SDC in Watertown was about 3.2 km from Berkeley Enterprises in Newton — the two known Shannon-licensed home-computer ventures were geographic neighbours of SDC. Magoun draws no conclusion from it and neither should we. | `[likely]` |
| **Laundered back in** | Wikipedia's infobox asserts `developer = Claude Shannon` with **no citation**, exactly as it asserts the uncited manufacturer-city ordering. Named here so nobody re-imports it as evidence. | `[verified]` that the field is uncited |

**Net position:** documented = his 1938 relay-switching thesis is the intellectual ancestor, and SDC's own manual says so. Marketed = "created as a private project by Dr. Claude E. Shannon", advertising copy only. Undocumented = any design contribution, contract, royalty, or correspondence. Nothing found in this research pass changes Spectrum's 2016 verdict. `[unverified]` as a claim about the world — it is a synthesis, not a finding.

Two cheapest next steps, neither taken: check whether Spectrum ever published a follow-up to its reader appeal, and read the paywalled IEEE conference paper *The Mystery of Claude Shannon's Personal Computer* (`ieeexplore.ieee.org/abstract/document/9039960/`).

---

## The 601-to-6010 repackaging

`6010 DELTA` throughout this section.

| Claim | Detail | Tag |
|---|---|---|
| What it was | Announced as an "advanced and improved" version, in a gunmetal-grey metal case rather than the 601's blue-painted wooden case. Released late 1961 / early 1962. | `[likely]` |
| Documented changes | Case colour and material; switches "upgraded to higher tolerances"; additional patch cords carrying special resistors, capacitors and diodes. | `[likely]` |
| **A joint 601/6010 manual exists** | Book VII's cover reads "Minivac 601/6010 / Capacitor/Resistor Manual / Copyright © 1962 by SCIENTIFIC DEVELOPMENT CORPORATION"; its back cover reads "MINIVAC 601/6010 AND THE MINIVAC MANUAL ARE PRODUCTS OF: SCIENTIFIC DEVELOPMENT CORPORATION / 372 Main Street, Watertown, Massachusetts". A manual whose programs are written to be wired on either machine is direct primary evidence that the two share terminal designations and the programming model. | `[verified]` |
| Panel comparison, 601 vs 6010 | **Same:** six horizontal bands in the same order; right-hand column carries logo plate, MATRIX (3×3 with 10 and 11 outside), POWER, DECIMAL INPUT-OUTPUT with a 16-position dial; terminal lettering unchanged (A/B binary output; N.O. ARM N.C. over G H J and K L N on relay sections; R S T over U V W on secondary storage; X Y Z binary input; COMMON and CAPACITOR on the intermediate strip); six relays, six slide switches, six pushbuttons. **Different:** dark metal case; relays carry clear plastic dust covers where the 601's are open; clear tubular patch-cord components (the resistor/capacitor cords) plugged into the panel in the photograph — the physical accessory Book VII is written for. | `[verified]` for the observations listed |
| Are they electrically identical? | **Not settled by the sources.** No 6010 schematic, maintenance manual or parts list was found anywhere. The resistor/capacitor/diode patch cords are a real functional addition, not a cosmetic one — they extend what circuits are constructible even if the console is unchanged. | `[unverified]` |
| The pricing story | The 601 was rejected by corporate buyers as "just a toy"; the identical-function 6010 at a much higher price ($479) sold well into the corporate segment. | `[likely]` for the mechanism, `[unverified]` for the numbers — every telling is downstream of the same Lodish et al. textbook anecdote, written 50 years after the fact |

Project scope is 601-only, so this does not block the build. Book VII being a joint manual is a tagging caveat on Book VII-derived claims, not a simulator requirement.

What would settle the internals question: a 6010 maintenance manual. Failing that, a full-resolution jack-by-jack comparison of the MIT Museum 6010 photograph against the 601 photographs — the images are already on disk.

---

## Corrections applied

Every item below was a claim in `find-context.json` that `verify-context.json` refuted or downgraded. Stated here as corrections so they are not silently re-imported.

| # | Claim as originally written | Correction | Tag |
|---|---|---|---|
| R1 | "archive.org — the item `1961Minivac601Book234` is the only Minivac item; it holds five originals, all now local." `[verified]` | **False.** archive.org holds a second MINIVAC 601 text item, `book-vii_202512` — Book VII, the MINIVAC 601/6010 Capacitor/Resistor Manual, 1962. The file was already on disk twelve minutes before the finder's file was written. | `[verified]` |
| R2 | "A MINIVAC 6010 manual or schematic of any kind. Nothing found anywhere." | **Refuted.** Book VII is a joint 601/6010 manual. It is not a schematic, so the internals question stays open — but "nothing found anywhere" is wrong and the blocker is smaller than stated. | `[verified]` |
| R3 | "Every piece of paper says Watertown, every panel says Cambridge." / "No Watertown-legend panel has been found." `[verified]` | **Second half false.** The MIT Museum 6010's plate reads Watertown, in the identical layout. The finder had downloaded that photograph and declared reading it out of scope while asserting a universal the photograph refutes. | `[verified]` |
| R4 | "The complete errata sheet is transcribed verbatim in `errata.txt` … read it directly." | **False and actively dangerous.** The extraction interleaves two columns, corrupts four glyph classes and destroys one line to noise. All 48 counter connections do survive — an earlier statement here that 12 were dropped was itself wrong and is struck. Never build an errata-corrected test vector from a text layer that mangles terminal letters. | `[verified]` |
| R5 | Errata citations "page 3" (Book IV p.72 relay-lamp note) and "page 4" (Book V p.11 wiper dead-zone note). | **Both off by one.** They are on errata sheet pages **2** and **3**. The quoted text of both notes is verbatim correct; only the page numbers are wrong. | `[verified]` |
| R6 | "Across all six books the name Shannon appears exactly once … verified by exhaustive grep." `[verified]` | **Two problems.** It appears **twice**, in two consecutive sentences of one passage. And a plain grep is unsound on this OCR — `grep -i watertown book1.txt` returns zero hits on a page that carries it as `W atertow n`. The conclusion survives a whitespace-insensitive re-run; the count and the method do not. | `[verified]` |
| R7 | "No panel variant of any kind was found. **Two** independently photographed units…" `[verified]` | **Undercount.** A third 601 photograph was already on disk, acquired and never opened. Its band layout and sub-panel arrangement do match. Its logo plate is marginal at that angle but not illegible: read at full resolution it adds no third *Cambridge* reading because the city word is a ~7-glyph `-tham` word, most plausibly *Waltham*. | `[verified]` |
| R8 | "all five originals in the item" — listing the archive.org file sizes as the originals we hold. | **Wrong for Book I.** Our local `book1.pdf` is the ccapitalia publisher scan; the archive.org copy is a different, IA-re-derived file. ccapitalia is the origin, archive.org a mirror with at least one reprocessed file. | `[verified]` |
| R10 | "the six-book set", "all six books", "Books I–VI" used throughout as the documentation set. | **The set is larger:** Books I–VI + Maintenance Manual + errata sheet + Book VII (1962). The errata's own masthead says "six-book set", which is correct *for the errata* and must not be generalised. | `[verified]` |
| D2 | "**Every** printed SDC document I hold gives 372 Main Street, Watertown." `[verified]` | Still true, and it survives the addition of Book VII — but it was a universal asserted over an incomplete census. Restated above as an enumeration. | `[verified]` as an enumeration |
| D5 | CHM record cited approvingly together with Wikipedia's dimensions field. | The live CHM record exposes **no** dimensions field, only weight 10 lb — and Wikipedia's own infobox gives 9 kg (≈20 lb), contradicting it. | `[unverified]` for any dimension or weight |
| D6 | "ccapitalia.net 403s a bare curl; it requires a browser User-Agent." | Reproduces, but the note undersells it: a short `Mozilla/5.0` still 403s; a full Chrome UA is needed. The site also intermittently serves a CloudLinux test page. Mirror now. | `[verified]` with a reproduction caveat |

Also recorded by the verifier and folded in above: Book VII's material on relay pull-in/drop-out hysteresis and its "15, 22 or 33 ohm" figures (which are for an **external, user-added patch resistor**, not the two internal motor-drive resistors — do not conflate); and Wikipedia's uncited `developer = Claude Shannon` field.

---

## Not settled by the sources

Historical and bibliographic open questions only. Electrical and timing gaps live in the electrical and timing files.

| Question | Status | Fallback / what would settle it |
|---|---|---|
| Watertown vs Cambridge — which is earlier | Moved, not settled. 601 panels Cambridge, 6010 panel Watertown, all paper Watertown, and a third 601 plate that reads as neither (a ~7-glyph `-tham` word, most plausibly *Waltham*). | Render the legend as photographed. Settle with a MINIVAC trademark registration, a MA corporate registration 1960–63, a Cambridge/Boston city directory entry, or a dated ad with a Cambridge address. |
| Shannon's actual role | Unchanged from IEEE Spectrum's 2016 open question. | State documented-vs-marketed as above and claim nothing more. SDC business records, or correspondence in Linda G. Sprague's papers, would settle it. |
| Are the 601 and 6010 electrically identical | Open, but the "no 6010 document exists" framing is gone. | 601-only scope makes this non-blocking. A 6010 maintenance manual would settle it; a full-resolution jack-by-jack panel comparison would settle most of it from images already on disk. |
| Whether Book VII shipped with the 601, the 6010, or a separately sold accessory kit | Open. Its title covers both machines, its copyright is 1962, and the 1961/62 errata calls the set "six-book", suggesting Book VII postdates it. Book VII's own footnote referring to "the highest valued resistor in the kit" proves a resistor kit was a separate article. | Bibliographic only. A period advertisement or price list for the capacitor/resistor kit, or a museum lot recording whether Book VII accompanied a 601 or a 6010. |
| Whether the six capacitors were factory-fitted in 1961 601 production or came with the 1962 kit | Open. CHM's unit shipped with six loose electrolytics in the box. | Non-blocking: the netlist is the same either way. Make it a config flag. |
| Whether a period SDC promotional film exists | No evidence found. The only candidate is a 2014 fan video whose title contains "1961". | Search Prelinger / AV Geeks / Internet Moving Images under "Scientific Development Corporation". Not attempted. |
| Production quantity and how many units survive | Unknown. The single hard datum is CHM serial 1886. | A serial-number census across museum records and collector reports. Make no population estimate. |
| Whether `jkoets/Minivac-601-Emulator` falls under the oracle-only ruling | **Awaiting Tom's ruling.** Treated as in-scope for the ruling pre-emptively; its code has not been read. | Tom decides. |

---

## Sources

**Local primary.** `raw/pdf/book1.pdf` · `book2-3-4.pdf` · `book5-6.pdf` · `book7-capacitor-resistor.pdf` · `maintenance-manual.pdf` · `errata.pdf`, with their text layers and rendered page images (`raw/pdf/pages/maintenance/p-05, p-10, p-11, p-13`; `raw/pdf/pages/book1/p-20`; errata pages 1–3 rendered at 170–175 dpi).

**Local primary photographs.** `raw/prebrief/images/image_3.jpg` · `raw/photos/commons-minivac601-main.jpg` · `raw/photos/commons-minivac601-DSCF1392.jpg` · `raw/photos/commons-minivac6010-mit-museum.jpg`.

**Fetched and checked.** `archive.org/metadata/1961Minivac601Book234` · `archive.org/metadata/book-vii_202512` · `archive.org/advancedsearch.php?q=minivac` · `ccapitalia.net/?p=1257` and `/descarga/docs/` (full browser UA) · `computerhistory.org/collections/catalog/102622941` · `computinghistory.org.uk/det/499/minivac-601/` and `/det/564/` · `museumlegacy.syssrc.com/artifact/205/` · `en.wikipedia.org/wiki/Minivac_601` (raw wikitext, for reference structure) · `hn.algolia.com/api/v1/items/45950396` · GitHub REST repository-search metadata for repositories named `minivac` (metadata only, no code) · Wikimedia Commons API, `Category:Minivac601`.

**Secondary.** IEEE Spectrum, Magoun 2016 · RF Cafe transcription of the Oct-1961 Popular Science ad · `oldcomputermuseum.com/minivac_601.html` and `/minivac_6010.html` · `t-lcarchive.org/minivac-601/` · `trmm.net/Minivac_601/` · `retrocomputingforum.com/t/minivac601-claude-shannon/711` · Instructables `Minivac-601-Replica-Version-09` and `Minivac-601-Version-10-Motorized-Rotary-Switch` (full step text via the Instructables JSON API) · Thingiverse `thing:3689581` · Hackaday, Boing Boing, EDN, Hackster.io · FOSSi Foundation *El Correo Libre* 92 · `youtube.com/watch?v=q6OA8HfnxxU` (page metadata only) · Lodish, Morgan & Archambeau, *Marketing That Works*, ch.3 (via the Wikipedia reference and an archived PDF).

**Not read, deliberately.** Any source file of `github.com/gregsadetsky/minivac`, any asset of `minivac.greg.technology`, any file of `github.com/jkoets/Minivac-601-Emulator`, and Willy McAllister's `circuit-sandbox`.
