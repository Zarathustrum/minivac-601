# Stage 3: the chat pane in minivac-601

## Context

Stage 2 is closed (Tom, 2026-11-02). Stage 3 is the last stage of the hands roadmap. It adds a chat pane in the web build where an LLM operates the page's own machine while Tom watches.

Results must carry over from the checklist runs. The model gets the same skill, the same `minivac-control` words, and output text identical to the CLI's.

**Rulings this builds on (Tom, all recorded in DECISIONS 2026-11-02):**
- The machine lives in the page, driven through `src/hands/`.
- A local Node process holds the model endpoint's key and talks to the page over a localhost WebSocket.
- The pane is dev-only. The public static build stays keyless and behaves as it does now.
- The default route can fail over to another server, so the pane shows which server answered.

**Rulings from planning (Tom, this session; to record in DECISIONS):**
- **Instant calls.** Each call runs synchronously, and the panel jumps to the settled state.
- **Frozen and locked.** In pane mode, simulated time is frozen between calls and the panel is input-locked. Ending the session hands back the machine as the model left it, live and unlocked.
- **Done bar.** All 12 items pass at least once from the pane on the default route, run ×3. Each result reproduces from its exported session file, and Tom has used the pane hands-on.
- **Public copy.** The public copy excludes the pane completely. (Superseded 2026-11-03: the pane is public, minus the checklist driver; DECISIONS, "Chat pane in the public copy".)

## Shape

```
dev.html#t=<token> ── src/pane/ (UI + engine, outside #app)
   │  WebSocket 127.0.0.1, token + Origin + Host checked
   ▼
tools/hands-pane/server.ts ── runLoop (openai-loop.ts) ── model endpoint (key from env)
   │  minivac_control words → parsed in Node (cli.ts front end)
   │  → ToolCall[] to page → page validates + runs on its Rig → data back
   │  → formatted in Node by the existing cli.ts formatters → model
   └─ writes <run folder>/<run>/{transcript.jsonl, run.json, session.json}
```

The page's Rig is the only machine. After each call, the page remounts the inspector on that same machine, frozen and locked. A remount re-reads the cords and gives no latch or drag state any chance to drift.

## Steps (in order; each ends with its own tests green and typecheck clean)

1. **`validateBatch` in `src/hands/table.ts`.** It builds a scratch rig with the live cords (same ids and holes, zero ticks) and runs the batch without time steps. It returns the same `failedAt/why/detail` as `runBatch`.
   - Why: every rejection is a static argument check or a cord-table lookup (`machine.ts:619-702`, `table.ts:385-500`). Validating first keeps the CLI's "a rejected batch changes nothing" without rebuilding anything.
   - If a live run still rejects after validation passed, the session ends with an error. It is never silently rebuilt.
   - Test: a property test against `runBatch` on a replayed clone, over the recorded command sets.
2. **Split `tools/hands/cli.ts`** into three pieces:
   - `parseInvocation(argv, {pinned})`: help, pinning, `new`, the batch parse, the rule that `state` may only end a batch, and `--settle-ms`.
   - A backend interface that returns data.
   - A renderer built from the existing `formatBatch`, `rejected`, `describeOk` and `formatState`. `formatState` changes to take a `StateView`.

   The file backend keeps today's behaviour. The pinned path becomes a parameter instead of the global `MINIVAC_CONTROL_SESSION` read in `cli.ts:264`; the env var stays as the CLI's input. `test/hands/cli.spec.ts` must pass unchanged.
3. **Export `runLoop` from `tools/hands-api/openai-loop.ts`.** It takes `{base, key, model, messages, execute, onTurn, signal, pinned}`, with an async `minivac_control` executor and messages that persist across user turns.
   - Tool calls run one at a time. After a stop, every tool-call id gets an answer.
   - `main()` sits behind `import.meta.main`, so the checklist runs' command line is unchanged.
   - Block hidden path parts in `read_file`, as `grep` already does, because transcripts now reach a browser.
   - Reuse `splitArgs`, `cap`, the `[exit N]` suffix, `skillText`, `SYSTEM_PREAMBLE`, `post` and the header accounting as they are.
   - Tests: these are the first tests for `tools/hands-api/`, run against a fake OpenAI-compatible `node:http` server. They cover turns, tool calls, the served base and fallback headers, the `wrong_api_base` stop, abort, and multi-turn.
4. **`src/pane/engine.ts`, DOM-free.**
   - `new` replays the empty session that Node builds with `newSession`, which cross-checks the hashes.
   - A call validates first, then runs `runBatch` on the live Rig, then returns the `BatchOutcome`, the `stateView` and the log.
   - `state` returns the state view.
   - **Transfer test:** take scrubbed `minivac_control` argument sequences from the r20 run transcripts, copied into `test/` because the run records are not in this repository. Run each through both the file backend and the engine, and diff the output text and the session.
5. **`DemoSession.adopt(machine, context)` in `src/session.ts`.** It calls `disposeMount()` then `options.mount`, with no replay and no extra tick. The demo, reset and profile callbacks in the composition do nothing while pane mode is on. Add a demo-session spec.
6. **`src/ui`: mount options `frozen` and `locked`.**
   - Under `frozen`, `loop.ts` renders but does not advance.
   - Under `locked`, the stage and drawer controls are `inert`.
   - The mount sets `startWithFreeCord: false`; otherwise `inspector.ts:909` would plug in a cord outside the log.
   - Don't use the word "session" in `src/ui` (`ui-boundary.spec.ts:56`).
   - Tests: a `ui-loop` spec for the freeze, and a test with a counting Machine wrapper that must see zero applies from a frozen, locked inspector, including on unmount.
7. **`src/app.ts` with `startApp(hooks)`.** It takes the composition now in `src/main.ts`, and `main.ts` shrinks to one call. Move the `ui-boundary.spec.ts:61-87` pins to `app.ts`, and pin `main.ts` to its single import. Existing browser tests must pass unchanged.
8. **`tools/hands-pane/server.ts`.**
   - `node:http` plus `ws`, as a pinned devDependency with `@types/ws`, bound to 127.0.0.1.
   - A random per-launch token in the printed `dev.html#t=…` URL, compared in constant time.
   - An exact Origin allowlist plus a Host header check.
   - The base URL and key come only from env. The model must be on a server-side route allowlist, the default first. Turns and message sizes are capped.
   - The pinned session path is `pane.json`, and the first user turn gets the same prefix the checklist runs use.
   - Per session, under `<run folder>/<date>-pane-<n>/`: `transcript.jsonl` and `run.json`, plus `session.json` written after `new` and after every successful call.
   - A served-by event goes to the page on every reply, with a flag when the served base isn't the route's expected primary (env).
   - Protocol tests: a fake LLM and a fake page client on the Node 26 global WebSocket. Cover a bad token, a bad Origin and a disallowed model.
9. **`dev.html` and the `src/pane/` UI**, mounted outside `#app`:
   - the transcript, the input box, and a route select;
   - the controls Stop, New session and End session (hands back the machine, unlocked);
   - a served-by badge with the fallback highlight.

   A reload mid-session marks that run invalid.
10. **Playwright pane e2e**, desktop project only, run against the pane server with a scripted fake LLM:
    - wiring B1 lights lamp 1 and the cords render;
    - the panel is locked during the session and unlocked after End session;
    - the exported `session.json` passes `checkItem` B1.
11. **`tools/hands-pane/run-checklist.ts`.**
    - Headless Playwright drives the real pane: 12 items ×3 on the default route.
    - The fallback guard is on, with up to 3 attempts per run.
    - Each run is graded with `checkItem` (`tools/checklist/check.ts`).
    - Each session's replayed state is diffed against the page's state.
    - Output: `<run folder>/<date>-pane-checklist/RESULTS.md`. (The driver stays private.)
12. **Public copy and docs.** (Superseded 2026-11-03: the pane is public, minus the checklist driver.)
    - `tools/public-snapshot.sh:29` excludes `dev.html`, `src/pane/`, `tools/hands-pane/` and their tests (`test/pane/`, the pane browser spec).
    - A check confirms that `dist/` contains no `dev.html` and no `MINIVAC_LLM` or pane strings.
    - DECISIONS gets Tom's planning rulings and the orchestrator working choices below.
    - STATUS and the README get the dev run instructions.

## Orchestrator working choices (record as such)

- Parsing and formatting stay in Node. The page returns data, so the model's text is identical to the CLI's by construction.
- A rejected batch is validated up front instead of rebuilt.
- The page remounts on the same machine after each call instead of resyncing its cords.
- The live trace stays blank in pane mode; the pane's transcript shows the calls.
- The server is a separate Node process rather than Vite's own WebSocket, so the key never sits in the dev server's env.

## Out of v1

- Real-time animation of calls, and sound or trace for the model's actions.
- Live cord resync without a remount.
- The Godot build.

## Verification

- After each step: typecheck, lint, and the tests the step touches. The transfer test (step 4) and the zero-applies test (step 6) are the load-bearing ones.
- Once, at the end: the full gate. That is `npm test` with lint, `npm run build` plus the dist check, `npm run test:browser`, `check-docs`, and `public-snapshot.sh check`.
- End to end:
  1. Run `npm run dev:pane` and `node tools/hands-pane/server.ts`, and open the printed URL (`tools/hands-pane/README.md`).
  2. Ask "Make light 2 come on only while I'm holding buttons 1 and 2 together." The panel shows the cords and lamp states after each call, and the badge names the server.
  3. Press End session; the panel unlocks with the circuit still plugged in.
  4. `bin/minivac-check checklist/items/I-EXP4.json <run folder>/<run>/session.json` prints PASS.
- Done when the step 11 run has every item passing at least once, each reproducing from its `session.json`, and Tom has used the pane.

## Execution (orchestrator plan, not Tom-approved beyond the plan itself)

- I orchestrate, integrate and commit.
- Workers take steps 1–4 and 8.
- An adversarial review runs on the finished pane before the step 11 run.
- One commit per step; no push without Tom's say.
