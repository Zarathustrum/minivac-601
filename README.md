# MINIVAC 601 simulator

A playable simulation of the 1961 Minivac 601, the relay-logic educational computer sold by Scientific Development Corporation. Relay-level, discrete-time and deterministic: the same wiring and the same inputs always produce the same trace.

- `src/core/` — DOM-free relay simulator with frozen JSON command/state schemas.
- `test/conformance/` — golden fixtures (wiring + input script, expected state trace).
- `src/ui/`, `index.html` — the Vite browser build.
- `dotnet/`, `godot/` — the C# port of the core and the Godot 4 desktop build; both must pass the same conformance fixtures.

There is no physical unit behind it: the model is built from scans of the original manuals and from photographs, with each fact tagged by confidence in `docs/research/`. This repository is a source snapshot; no hosted build or packaged release is published.

## Web build

Requires Node 26 or newer (`engines` in `package.json`).

```bash
npm install
npm run dev            # Vite dev server
npm run build          # production bundle
npm run typecheck      # three tsc projects
npm run lint
npm test               # Vitest; runs lint first (pretest)
npm run test:browser   # Playwright at desktop, tablet and mobile viewports
```

The other scripts (`check-*`, `sync-data`, `parity`, `bless`, and so on) are listed in `package.json`.

## Command-line tools

- `bin/minivac-trace <fixture.json>` prints a conformance fixture's trace; `bin/minivac-trace --list-fallbacks` lists every fixture's `[unverified]` expectations.
- `bin/minivac-control` operates the simulator from the shell, one batch of commands per call, over the tool table in `src/hands/`. The session is a `minivac.session/1` command log (schema in `tools/hands/session.schema.json`) that is replayed from scratch on every call. `minivac-control --help` covers the commands and how simulated time passes; `minivac-control help terminals` lists the panel terminals.

```bash
bin/minivac-control new s.json
bin/minivac-control s.json connect 1+/1Y + connect 1X/2Y + connect 2X/2A + connect 2B/2- + power on
bin/minivac-control s.json button 1 down + button 2 down
bin/minivac-control s.json state
```

- `bin/minivac-check <item.json> <session.json>` grades a `minivac-control` session against one checklist item in `checklist/items/` and prints `PASS`, `FAIL` (with the failing manual quote or the mismatches) or `ERROR`; exit 0, 1 or 2. A wire item replays the session's final cords through the item's reference conformance fixture, so any circuit that behaves as the manual says passes; a basic item checks the session's exact cords and end state; an operate item checks that the session's cords run a named program, that the operator sent its steps and the state after each checkpointed step, and its end state. See `checklist/README.md`.

## .NET / Godot build

The .NET and Godot toolchain, the data sync (`npm run sync-data`), the exports and the packaged `--selftest` proof are documented in [`docs/port/CSHARP-PORT.md`](docs/port/CSHARP-PORT.md). The .NET SDK is pinned in `global.json`.

## Where things are

- [`docs/STATUS.md`](docs/STATUS.md) — latest recorded work state, parked items and dated check results.
- [`docs/PROJECT-BRIEF.md`](docs/PROJECT-BRIEF.md) — the spec, and the Step 0 questions with Tom's answers.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — settled choices.
- [`docs/research/`](docs/research/README.md) — source-backed machine facts; [`open-questions.md`](docs/research/open-questions.md) records unresolved evidence and named fallbacks.
- [`docs/plans/architecture.md`](docs/plans/architecture.md) and the [Phase 5 plan](docs/plans/phase-5-corpus.md) — design and completed-run records; use `docs/STATUS.md` for the latest recorded work state.
- [`CLAUDE.md`](CLAUDE.md) (also `AGENTS.md`) — project rules for LLM coding sessions.

## License

The project's code and text are MIT-licensed; see [`LICENSE`](LICENSE). Third-party material is listed in [`NOTICE`](NOTICE): the scanned 1961–62 Scientific Development Corporation manuals under `docs/research/raw/pdf/` (US public domain, lapsed copyright; status elsewhere may differ), the Wikimedia Commons photographs, and the CC0 audio. Not affiliated with Scientific Development Corporation.
