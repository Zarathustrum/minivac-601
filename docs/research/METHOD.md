# How the research package was produced

Written 2026-08-30 so later sessions know what to trust and how to re-verify.

## Pipeline

A multi-agent Claude Code workflow, run in five stages:

1. **Find** — 6 topic finders: `panel`, `jackmap`, `relays`, `rotary`, `programs`,
   `context`. Each was given the three manual PDFs, `pdftotext -layout` extractions, all
   198 rendered page images, and the owner's panel photograph, and was told to read the
   *page image* wherever OCR could corrupt a terminal letter. Each wrote its full findings
   to `raw/find-<topic>.json` and returned a summary.
2. **Verify** — one adversarial fact-checker per topic, prompted to refute rather than
   agree and to default to refuted when it could not confirm. It hunted specifically for
   inference tagged `[verified]`, terminal letters taken from OCR instead of an image,
   601 facts contaminated by 6010 sources, and hallucinated lines in transcribed wiring.
   Output: `raw/verify-<topic>.json`.
3. **Critic** — one completeness critic read all twelve files and judged whether the
   package was sufficient to write a relay-level simulator from. It produced 5 blocking
   gaps and 17 cross-file contradictions. Output: `raw/critic-completeness.json`.
4. **Gaps** — a find+verify pair per blocking gap, allowed to spend page images freely,
   and required to propose a *named fallback* wherever the sources genuinely did not
   settle a question. Output: `raw/gap-<key>.json`, `raw/gap-verify-<key>.json`.
5. **Write** — one writer per research file, plus one for `README.md` and
   `open-questions.md`. Writers were instructed that the verifier outranks the finder:
   apply every refutation, carry no refuted claim forward except as a correction.

## Sources acquired during the run

The run started with three PDFs (Books I, II–IV, V–VI, 198 pages) downloaded from
ccapitalia.net. The `context` and `rotary` finders found three more on archive.org that
no source in the pre-brief listed correctly, and they changed the package materially:

- `raw/pdf/maintenance-manual.pdf` (13 pp) — the power-supply schematic, the only
  published electrical ratings, and the four check-circuit figures.
- `raw/pdf/errata.pdf` (4 pp) — filed on archive.org as `...-erratas.pdf`, which is why
  it was hard to find. **Load-bearing, not cosmetic:** it corrects wiring across Books
  I–VI and states the global power-net rule that appears nowhere in the books.
- `raw/pdf/book7-capacitor-resistor.pdf` (55 pp) — Book VII, absent from every source
  list we had. It documents relay hysteresis and builds bias-resistor circuits on it.

Consequence, and the package's main structural weakness: the `panel`, `jackmap`,
`relays`, `rotary` and `programs` finders had largely finished before those three
documents existed locally. The gap round and the writers used them; the topic finders
mostly did not. The `panel` verifier says so in its own verdict.

Also captured: three Wikimedia Commons photographs in `raw/photos/`, at much higher
resolution than the owner's panel photograph.

## Trust

- `[verified]` — the agent read it in a primary source (manual page, panel photograph).
  Treat as spec.
- `[likely]` — secondary sources agree, no primary read. Fine for design; confirm before
  encoding as simulation behaviour.
- `[unverified]` — single weak source or inference. Do not encode without checking.
  Listed in `open-questions.md`.
- Refuted claims are not carried forward except in `open-questions.md` with the correction.
- A *named fallback* is not a finding. Where the sources settle nothing — every timing and
  every analog quantity — `open-questions.md` names a specific default, its reasoning, and
  the evidence that would overturn it. `MV601-REF-A` is the fallback electrical profile.

## Oracle-only compliance

Greg Sadetsky's browser simulator (no declared licence) was deliberately **not read** — not its
source, not its repository. Every agent carried the rule. Only its URL, license, scope and
externally observable behaviour are recorded, in `history-and-artifacts.md`. See
`docs/DECISIONS.md` for why.

## Re-verifying

The primary sources are all in `raw/pdf/`. Render a page with
`pdftoppm -r 300 -png -f N -l N raw/pdf/<book>.pdf out` and read it. Note the page-offset
trap: in `maintenance-manual.pdf`, PDF page = printed page + 2. `book2-3-4.pdf` is three
books under one continuous pagination, so a fixture keyed on book name alone will misfile.

The page images under `raw/pdf/pages/` (about 200 PNGs) are gitignored. Rebuild them with
`for f in book1 book2-3-4 book5-6; do pdftoppm -r 120 -png raw/pdf/$f.pdf raw/pdf/pages/$f/p; done`
(needs `poppler`).

Nothing under `raw/` is ever edited — see `raw/README.md`.

## Consistency pass (2026-08-30)

Run in three stages: **Rule** (five per-file rulers plus one cross-cutting ruler, each
re-judging the written files against the three late-arriving sources and triaging the
critic's 17 contradictions), **Apply** (one editor per file, permitted to skip a ruling it
judged wrong), **Residue** (two read-only hunts — one for surviving refuted claims, one
auditing every confidence tag and citation — followed by a second apply pass).

The residue stage exists because a claim corrected in one file survives in another: it caught
a `[verified]` D-terminal range of "1 to 19" in `programs.md`, two relay pull-in voltages in
`components.md`, and two different fallbacks for the rotary contact arc (now one,
`UNIFORM-CONTACTS`).

### Traps recorded for the implementer

- Page offsets differ per document: Maintenance Manual printed = PDF − 2; Book I printed =
  PDF − 2; Book VII printed = PDF − 5; `book2-3-4.pdf` is three books under one continuous
  pagination. Six wrong Maintenance Manual citations came from assuming one offset.
- `raw/photos/commons-minivac6010-mit-museum.jpg` is a **MINIVAC 6010, not a 601** —
  materially different panel construction (single plate, numerals along the bottom edge,
  covered relays). An implementer could mistake it for a 601.
- The manufacturer address now has three primary attestations — Cambridge on the panel
  plate, Watertown in all six books, and a third string on the 6010 plate. Deliberately
  left unordered; see `open-questions.md`.
