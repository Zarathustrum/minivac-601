# Minivac 601 simulator — project instructions

This file carries project-specific context for any LLM session.

## What this is

A faithful, playable simulation of the **Minivac 601** — the 1961 relay-logic educational computer designed by Claude Shannon and sold by Scientific Development Corporation. There is no physical unit: every fact comes from scans and photographs on the web.

Web first (TypeScript, Vite, browser), plus a Godot 4 desktop build in `godot/` off the same core through a C# port (`docs/DECISIONS.md`, 2026-09-03 — this superseded Unity). Both exist: Phases 1–4 are built, the Godot build through Phase 4 (playable console, 3D shell, tactile) with the native Windows runtime leg deferred, and Phase 5 (full-corpus conformance) is done. The **audience** is public — strangers who have never seen a patch panel — but no build is released: public deployment or distribution of either build needs Tom's explicit approval (`docs/DECISIONS.md`, "Audience: public" and the Phase 3 "Public distribution is not Phase 3" ruling).

## Read these first

- `docs/PROJECT-BRIEF.md` — the spec, and the Step 0 questions with Tom's answers.
- `docs/DECISIONS.md` — settled choices. Don't re-litigate without new info.
- `docs/STATUS.md` — forward-looking state: what's done, what's next. Update before ending a session.
- `docs/research/` — verified Minivac 601 facts. `METHOD.md` explains how the package was produced and how to re-verify. `open-questions.md` lists what is still unverified.
- `docs/plans/` — architecture and per-phase plans.

## Engineering rules

- **Three hard boundaries.** `src/core/` is DOM-free and framework-free: a fixed-component netlist, a patch-cord graph, a deterministic discrete-time relay simulator. `test/conformance/` holds golden fixtures (wiring + input script → expected state trace). `src/ui/` reads state and sends commands and owns all rendering and sound — no simulation logic.
- **The schemas are the engine contract.** The command schema (connect/disconnect cord, set switch, press/release button, tick) and the state schema (every lamp, relay, switch, rotary position, jack voltage) serialize to JSON. The C# port that the Godot build runs implements those and must pass the same conformance fixtures. Phase 3 is planned in `docs/plans/phase-3-godot.md`; architecture §13.6 carries the Godot amendment.
- **Determinism is non-negotiable.** Same wiring + same inputs → same trace, always.
- **Cite or flag.** Every modeled electrical behavior cites the manual page or photograph it came from. Confidence tags: `[verified]` read in a primary source, `[likely]` consistent secondaries, `[unverified]` single weak source or inference. Anything `[unverified]` gets a named fallback and an entry in `open-questions.md`.
- **Never invent panel geometry or jack numbering.** If the scans do not settle it, say so.
- Simplicity first. Six relays and a jack grid do not need a plugin system, an event bus, or a device framework. Data tables over class hierarchies.
- Commit messages use `[SCOPE]: description`.
