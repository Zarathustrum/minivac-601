# Minivac 601 simulator — project instructions

This file carries project-specific context for any LLM session.

## What this is

A faithful, playable simulation of the **Minivac 601** — the 1961 relay-logic educational computer designed by Claude Shannon and sold by Scientific Development Corporation. There is no physical unit: every fact comes from scans and photographs on the web.

Web first (TypeScript, Vite, browser), plus a Godot 4 desktop build in `godot/` off the same core through a C# port (`docs/DECISIONS.md`, 2026-09-03 — this superseded Unity). Both exist: Phases 1–4 are built, the Godot build through Phase 4 (playable console, 3D shell, tactile) with the native Windows runtime leg deferred, and Phase 5 (full-corpus conformance) is done. The **audience** is public — strangers who have never seen a patch panel — but no build is released: public deployment or distribution of either build needs Tom's explicit approval (`docs/DECISIONS.md`, "Audience: public" and the Phase 3 "Public distribution is not Phase 3" ruling).

## Read these first

- `docs/PROJECT-BRIEF.md` — the spec, and the Step 0 questions with Tom's answers.
- `docs/DECISIONS.md` — the decision record. Tom's rulings and approvals in it are settled: don't re-litigate them without new info. Entries headed "(orchestrator)" are working choices, not Tom-approved.
- `docs/STATUS.md` — session state: what's done, what's parked, dated check results. Update before ending a session. It carries no authority, and its "Open for Tom's end review" list is evidence, not approval.
- `docs/research/` — verified Minivac 601 facts. `METHOD.md` explains how the package was produced and how to re-verify. `open-questions.md` lists what is still unverified.
- `docs/plans/` — architecture and per-phase plans.

## Where things are

- `src/` — `core/` the DOM-free simulator, `ui/` rendering and input; `app.ts` (the composition root, which `main.ts` calls), `session.ts`, `demo-library.ts`, `web-audio.ts` assemble the web app. `pane/` is the chat pane's page side, its UI and DOM-free engine; its server is `tools/hands-pane/` (guide in its README; plan `docs/plans/stage-3-chat-pane.md`).
  `hands/` is the filesystem-free tool table that `minivac-control` drives (DECISIONS, 2026-10-31).
- `test/` — Vitest specs; `conformance/` golden fixtures and their runner, `browser/` Playwright tests.
- `dotnet/` — the C# port of the core, its conformance runner, trace tool and tests (`Minivac.sln`).
- `godot/` — the Godot 4 desktop build: scenes, scripts, export presets; `godot/data/` is mirrored from `data/` by `npm run sync-data`.
- `tools/` — check, generator and sync scripts behind the `npm run` targets.
- `data/` — shared tables: netlist, panel layout, demo library, profiles, KATs. `bin/minivac-trace` is the fixture-trace CLI; `bin/minivac-control` operates the machine from the shell over a session file (`tools/hands/`); `public/` holds web audio assets.
- **Reading paths.** Implementation and operations: README, `src/core/`, `docs/plans/architecture.md`, `docs/port/CSHARP-PORT.md`. Checks and recorded state: README commands, `docs/STATUS.md` "Full gate", `docs/DECISIONS.md`. Research and outcomes: `docs/research/` (`METHOD.md` first), `docs/plans/`, `docs/DECISIONS.md`.
- **Canonical:** `docs/PROJECT-BRIEF.md`, Tom's rulings in `docs/DECISIONS.md`, `docs/research/`, `docs/plans/architecture.md`, `docs/port/`. `docs/research/open-questions.md` is the notes record inside that package: read it before writing code. **Completed plans** (their design sections remain reference): `docs/plans/phase-2-console.md`, `phase-3-godot.md`, `phase-4-presentation.md`; `phase-5-corpus.md` is the record of the completed Phase 5 run. **Session state:** `docs/STATUS.md` carries no authority despite sitting in `docs/`. **Working material:** `docs/research/raw/` (pristine captures; see its README), `docs/plans/phase-4-s3-review-findings.md`, `docs/plans/phase-5-step7-notes.md`.
- **Record equivalents:** decisions = `docs/DECISIONS.md`; notes = `docs/research/open-questions.md`; session state = `docs/STATUS.md`.
- **Handoffs:** none are tracked. Any handoff or session-state note carries no authority; a saved plan is not a fresh instruction from Tom.

## Engineering rules

- **Three hard boundaries.** `src/core/` is DOM-free and framework-free: a fixed-component netlist, a patch-cord graph, a deterministic discrete-time relay simulator. `test/conformance/` holds golden fixtures (wiring + input script → expected state trace). `src/ui/` reads state and sends commands and owns all rendering and sound — no simulation logic.
- **The schemas are the engine contract.** The command schema (connect/disconnect cord, set switch, press/release button, tick) and the state schema (every lamp, relay, switch, rotary position, jack voltage) serialize to JSON. The C# port that the Godot build runs implements those and must pass the same conformance fixtures. Phase 3 is planned in `docs/plans/phase-3-godot.md`; architecture §13.6 carries the Godot amendment.
- **Determinism is non-negotiable.** Same wiring + same inputs → same trace, always.
- **Cite or flag.** Every modeled electrical behavior cites the manual page or photograph it came from. Confidence tags: `[verified]` read in a primary source, `[likely]` consistent secondaries, `[unverified]` single weak source or inference. Anything `[unverified]` gets a named fallback and an entry in `open-questions.md`.
- **Never invent panel geometry or jack numbering.** If the scans do not settle it, say so.
- Simplicity first. Six relays and a jack grid do not need a plugin system, an event bus, or a device framework. Data tables over class hierarchies.
- Commit messages use `[SCOPE]: description`.
