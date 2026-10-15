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

## .NET / Godot build

The .NET and Godot toolchain, the data sync (`npm run sync-data`), the exports and the packaged `--selftest` proof are documented in [`docs/port/CSHARP-PORT.md`](docs/port/CSHARP-PORT.md). The .NET SDK is pinned in `global.json`.

## Where things are

- [`docs/STATUS.md`](docs/STATUS.md) — current state and what is next.
- [`docs/PROJECT-BRIEF.md`](docs/PROJECT-BRIEF.md) — the spec, and the Step 0 questions with Tom's answers.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — settled choices.
- [`docs/research/`](docs/research/README.md) — verified Minivac 601 facts and open questions.
- [`CLAUDE.md`](CLAUDE.md) (also `AGENTS.md`) — project rules for LLM coding sessions.

## License

The project's code and text are MIT-licensed; see [`LICENSE`](LICENSE). Third-party material is listed in [`NOTICE`](NOTICE): the scanned 1961–62 Scientific Development Corporation manuals under `docs/research/raw/pdf/` (US public domain, lapsed copyright; status elsewhere may differ), the Wikimedia Commons photographs, and the CC0 audio. Not affiliated with Scientific Development Corporation.
