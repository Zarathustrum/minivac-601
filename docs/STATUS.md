# Status

Update before ending a session. The newest dated section is this checkout's forward-looking state; older
"Next" lines are historical snapshots. Settled choices are in `docs/DECISIONS.md`.

## 2026-11-12 — Godot chat pane: link pre-fill and a UI that scales. **Next: Tom's word on the pre-filled link and the scaled window under a real mouse; his pick of the teletype cue; then the full gate once more.**

- **Built** (rulings and working choices in `docs/DECISIONS.md`, same date): the pane server
  writes its link to `~/.minivac/pane-link`; the dock fills its field from it; the 2D UI scales
  with the window (`canvas_items` stretch) and the window opens at up to 80 % of the screen.
- **Checks** (orchestrator's runs, the macOS arm64 development host, uncommitted tree on `c024b0d`): `tsc --noEmit` clean
  and `test/pane/server.spec.ts` 34/34, both run before the later Godot-side edits, which touched
  no TypeScript; `dotnet test dotnet/Minivac.Godot.Tests` 382/382; Godot acceptance, windowed, at
  1152 × 640: boot 9/9, commands 8/8 flat and 3D, session 9/9, frozen-copy 7/7, keyboard 8/8 flat
  and 3D, geometry 8/8, geometry-3d 10/10, popouts 21/21, a11y 1/1, lock 29/29 flat and 3D, chat
  67/67, chat-3d 66/66, cords 4/4, lamps 2/2, manual 3/3; and at 1728 × 960: boot, commands,
  keyboard and lock flat and 3D, geometry, geometry-3d, popouts, chat, chat-3d and cords, same
  counts. **Not run:** the full gate, `godot-pane-e2e`, the exports.
- **Tom's look at the relaunched build:** he connected from it and ran `2026-11-12-pane-3`
  ("clear the booard", 5 turns, 4 tool calls, 15 s, stop `done`; marked invalid because the window
  was closed with the session open). He has not said whether the link was the pre-filled one or
  how the scaled window felt under a real mouse. Twice during the build a Connect on the pre-filled field was refused by a
  live server ("the server refused the token") while the orchestrator was injecting keystrokes
  into the window Tom was also using; the suspected cause is a stray `/` typed into the field,
  unconfirmed. The same link connected through `--pane-link`.
- **The run Tom made meanwhile:** `2026-11-12-pane-2`, the default route, "wire up tic-tac-toe", 14
  turns, 16 tool calls, 138 s, stop `done`. Its 72 cords are the fixture `VI-TICTACTOE`'s 70 wires
  plus the two play wires (M10 to 6com, M11 free); replayed, the dial rests at c9.
- **Review loop, same day** (Tom's `/review-loop 3`, scope: the 32 non-test source files changed
  since 2026-11-11; claude opus high, codex gpt-6-astra high, agy Gemini 3.8 Flash Medium; artifacts
  in `.review-loop-2026-11-12T22-12-16Z` and `.review-loop-2026-11-12T22-29-41Z`). Three rounds in
  two runs: 21 findings fixed, 3 skipped (one design choice, one false positive, one coverage
  request). agy reviewed round 1 only: it timed out at 900 s in the next round and was dropped, so
  rounds 2 and 3 had two reviewers. Twice the fixer's work failed the boundary allow list and the
  orchestrator repaired it by hand: `Picker.cs` now calls the inherited `IsInstanceValid`, and
  `HelpCredits.cs`'s row gained `InputEvent*` and `Key` for keyboard scrolling in Help. **That row
  change is the orchestrator's, not Tom-approved.** Commits `f4ffd0f` to `fc4a579`,
  pushed on Tom's word.
- **Found after the loop** (`1b64bed`, pushed): the two tests that start the server through its
  command-line entry wrote, then deleted, the tester's own `~/.minivac/pane-link`, wiping a running
  server's link. Both now give the server a temporary HOME. `godot-pane-e2e` not rerun.
- **Checks on the final tree:** typecheck clean; `vitest run test/pane` 77/77;
  `Minivac.Godot.Tests` 387/387; `Minivac.Hands.Tests` 137/137; Godot acceptance, windowed, at
  1152 x 640, every suite listed above with the same counts. `lock` failed its `audio-back` check
  once in five runs today (28/29) and passed the rest; cause not looked into. **Not run:** the
  full gate, `godot-pane-e2e`, `npm run transfer` and `parity` (the loop changed nothing in
  `dotnet/Minivac.Hands/`), the exports.

## 2026-11-12 — Godot chat pane: Tom's first hands-on session; five findings repaired. **Next: Tom's look at the repaired build; his pick of the teletype cue; then the full gate once more.**

- **The session.** Tom ran the Godot build (Debug, editor binary) on the second development host against the unchanged
  pane server and the default route: "wire up tic-tac-toe". Run `2026-11-12-pane-1`: 6 turns, 8 tool
  calls, 72 cords plugged in one call, power on, 95 s, no fallbacks. This is the first time a real
  model, a real mouse and a real clipboard drove the build; until now every input was injected and
  every model scripted. The run is marked invalid because the window was closed with the session
  still open; its transcript is complete.
- **Five findings, all repaired the same day** (rulings in DECISIONS 2026-11-12):
  1. The first-run help dialog was wider than the window, with "Close help" and the title bar off
     screen (Phase 4 code). Its page now wraps inside a scroll box and the dialog keeps 82 % of the
     window. `boot` `help-fits-window`: before `dialog=0,10+1291x584` (later pages 3892 px wide),
     after `pages=7/7 dialog=104,58+944x524 inside`.
  2. Toolbar labels overlapped (Phase 4 code: every button 76 px wide). Each button is now as wide
     as its label. `toolbar-labels-fit`: before `row=1127/1120` with four overlaps, after
     `row=1015/1120`.
  3. Tool output in the dock broke lines inside words. The output block and the call line now wrap
     between words.
  4. Cord marks ringed all 72 cords. By Tom's ruling a call that adds more than 12 cords shows none.
  5. Replies showed raw markdown. By Tom's ruling the Godot dock renders a small subset
     (`godot/scripts/ChatMarkdown.cs`); the web pane is unchanged.
- **Review of repair 5** (one independent pass, the markdown converter and the label swap only).
  The escape held: about twenty BBCode tag kinds typed as model text, tags split across the
  converter's own tags, and literal `[lb]`/`[rb]` all showed as typed in a Godot 4.7.2 label. It
  found rendering faults in the first version, all repaired: crossing tags (`***both***` printed a
  stray `[/b]` and left the rest of the reply bold), bold around a code span left as typed, fences
  that dropped text, characters lost from `x*y + z*w`, and a regex cost of 60 to 90 ms on a
  hostile 4 KiB line with no test. The converter is now one left-to-right pass per line: the same
  lines take about 0.2 ms.
- **Checks on the final tree** (orchestrator's runs, the second development host, uncommitted tree on `fb7d16b`):
  - `dotnet build dotnet/Minivac.sln -c Release -warnaserror` and both Godot builds: 0 warnings,
    0 errors. `dotnet test dotnet/Minivac.Godot.Tests`: 381/381 (293 before; 88 new: one marks
    case and 87 markdown cases, among them a seeded property test, seed 601, 4,000 strings).
  - Godot acceptance, windowed: boot 9/9; commands 8/8, flat and 3D; session 9/9; frozen-copy
    7/7; keyboard 8/8, flat and 3D; geometry 8/8; geometry-3d 10/10; popouts 21/21; a11y 1/1; lock
    29/29, flat and 3D; chat 67/67; chat-3d 66/66.
  - `npm run godot-pane-e2e`: 2/2 (`pane-e2e` 13/13, `pane-quit` 7/7). `check-docs`: 0 findings.
    `git diff --check`: clean.
  - Each new check was shown failing on the code before its fix (the worker's runs, not repeated
    by the orchestrator).
- **Not run: the full gate.** The repairs were checked with the suites they touch. The full gate
  ("Full gate" below, last run on `d462d1c`) runs once more after the cue is settled.
- **Not verified:** the repaired build under Tom's own hands; a screen reader on the rendered reply
  (its label is now a focus stop for assistive tech); Linux and Windows at runtime, as before.
- **Known and left:** `lock`, `lock-3d` and `keyboard` need a window; run headless they fail on
  the committed code too (stage size 0). Prose `__init__` renders as a bold "init". The panel is
  not locked between Send and the model's `create`, which took about a minute in this run; Tom has
  not asked for that to change.

## 2026-11-12 — Chat pane in the Godot build: C0 to C6 built, the full gate run once. **Next: Tom's hands-on session in the Godot build; Tom's pick of the teletype cue.**

- **C6, the end-to-end run:** `npm run godot-pane-e2e` starts the unchanged pane server with the
  web e2e's scripted fake model (now shared from `test/browser/scripted-model.ts`) and runs the
  Godot build headless through the real socket. `pane-e2e` 13/13: the model wires checklist item
  B1 from the dock, lamp 1 lights, the machine is adopted, frozen and locked from `create` until
  End session and live after it. In Node: the run folder holds the three files, `run.json` ends
  `done` and is not invalid, `bin/minivac-check checklist/items/B1.json` prints `PASS B1`, and
  the text the model was shown equals the web engine's byte for byte. `pane-quit` 7/7: quitting
  with a session live marks the run invalid. About 3 s in all. Not covered: a turn interrupted by
  quitting, the pasted-link path against the real server (the `chat` suite covers it on the fake),
  and the two suites were not broken on purpose to prove they fail.
- **The full gate, once, 2026-11-12, on `d462d1c` with a clean tree, on the second development host:**
  - typecheck, lint, `check-profile`, `check-netlist`, `check-reachability`, `check-docs` (0
    findings), `git diff --check`: pass.
  - `dotnet build dotnet/Minivac.sln -c Release -warnaserror` and the Godot C# build: 0 warnings,
    0 errors. `dotnet test dotnet/Minivac.sln -c Release`: `Minivac.Core.Tests` 262/262 (15 min),
    `Minivac.Hands.Tests` 137/137, `Minivac.Godot.Tests` 293/293.
  - `parity`: 155 fixtures and 7 CLI cases. `transfer`: 58/58. `godot-pane-e2e`: 2/2.
  - `npm run build` with the dist check: pass. `npm run test:browser`: 51 passed, 18 skipped.
  - `npx vitest run`: the gate's run had one failure of 2041, a 5 s timeout in
    `test/check-profile.spec.ts` ("two runs produce byte-identical reports", 5.6 s) while the
    windowed Godot suites ran beside it. Rerun alone on the same commit: 74 files, 2040 passed,
    1 expected fail.
  - Godot acceptance, windowed: boot 8/8; commands 8/8, flat and 3D; session 9/9; frozen-copy
    7/7; cords 4/4, lamps 2/2, manual 3/3 and keyboard 8/8, each flat and 3D; geometry 8/8 and
    geometry-3d 10/10; trace-equality 11/11; handles 108/108; popouts 21/21; renderer 2/2; a11y
    1/1; audio 9/9; visuals 5/5; budget 1/1 (mean 3.624722 ms, p95 3.692000 ms); lock 29/29 and
    lock-3d 29/29; chat 59/59 and chat-3d 58/58; headless3d 5/5 (headless).
  - `--headless -- --selftest`, editor build, 440 s, and inside the macOS export, 1451 s; both
    print `profile-kat=1/1 w3-derived-kat=9/9 contraction=1/1 solver-kat=21/21 netlist-kat=40/40
    fixtures=155/155 goldens=155/155 probes=8/8 probe-pins=46/46 collapse=8/8 static=2/2`. The
    export's proof-host line: `proof host=macOS cpu=Apple M4 Max arch=arm64 audio=Dummy
    method=forward_plus driver=metal`.
  - Exports (`npm run export-proof`, verification artifacts in scratch, nothing signed or
    distributed): macOS Universal 2 with arm64 and x86_64 payloads; Linux x86_64; Windows x86_64.
    The Linux and Windows exports were produced and checked for structure only: neither was run,
    and the macOS x86_64 payload was not run under Rosetta.
  - Key-like strings in everything added since `afe87a1`: 0 found.
  - **`npm audit`: FAIL, 15 advisories (12 moderate, 3 high)** against dev dependencies: `vite`
    8.2.2, `vitest` 4.1.11 with `@vitest/mocker`, `brace-expansion`, `fast-uri`, `minimatch`,
    `source-map-js`. The lockfile last changed on 2026-11-03 and this build did not touch it.
    Clearing them means moving the exact pins of `vite` and `vitest`, which is not this plan's
    work; it waits for Tom.
  - `export-proof` runs `godot-mono` from PATH. A symlink of that name to the Godot binary hung
    the export at 0% CPU; a two-line wrapper script that execs the binary works.

- **Second review** (independent, read-only, on `f569d39`, the finished chat): the lock held (no
  path found that changes a locked machine, no stale machine carried into a new session) and the
  reviewer's own run against the real server with a stub model ended cleanly. Accepted and
  repaired, each with a test that failed first; counts rerun by the orchestrator:
  - A long string in the transcript froze the app (64 KiB of words, 5.6 s; 1 MiB, never back).
    Each displayed field is now cut at 4 KiB and a model entry at 16 KiB and 50 calls, with a
    last line saying how much is shown. Measured: a full 16 KiB entry costs about 115 ms once, a
    typical reply about 70 ms, and a request sent after a 1 MiB turn is answered in 7 ms.
  - A frame holding an unpaired surrogate was dropped whole, and a dropped `done` left the dock
    busy until restart. Server strings are now read leniently (the unpaired half shows as the
    replacement character) and `done`, `ended` and `error` frames are always read.
  - "connecting…" had no way out, and neither did a server that never answers End session. No
    `ready` within 10 s falls to could-not-connect; no `ended` within 15 s closes the link and
    takes the connection-lost path, so the panel can be ended locally.
  - The link field's undo history restored the token. The field is replaced after it is read.
  - The banner's Stop and End session ignored the enable rules; they now follow the dock's.
  - A failed adopt would have left the console locked; it now stays live and unlocked.
  - Control characters in model text showed as glyphs; the display drops them.
  - Four planted bugs had passed the suites; the suites now catch all four (the worker's run).
    The scripted session now sends the `session` and `state` requests the real server sends.
  - Checks after the repairs, windowed: `chat` 59/59, `chat-3d` 58/58, `lock` 29/29, `lock-3d`
    29/29; boot 8/8, session 9/9, cords 4/4, keyboard 8/8, geometry 8/8, visuals 5/5, a11y 1/1,
    audio 9/9; filtered `dotnet test` 209/209; both solutions build 0 warnings / 0 errors.
  - Left as they are, for Tom: `--pane-link` shows the token in the process arguments, which
    other accounts on the machine can read (the plan specifies the flag); calls run on the main
    thread, so one `wait 60000` froze the window 29.8 s in a Debug build ("instant calls").
  - Not bounded: 50 capped entries arriving in one frame cost about 1.1 s. Only a flooding
    server does that.

- **C5, cord marks:** after each `run` reply, the cords that call added carry a yellow ring at
  their midpoint in both views, until the next `run`, New session or End session. The set is
  read from the reply in `ChatModel.AddedCords`: every cord id in a successful result's `cord` or
  `cords` that is still in the reply's view. A refused batch or an error clears the marks; a
  `state` or `session` request does not. The colour is one new presentation token,
  `cordMarkColour` `#ffcc00` (84 tokens, was 83; Appendix H of the Phase 4 plan has its row).
  Marks are drawn only while the chat holds the machine. Checks, 2026-11-12, rerun by the
  orchestrator, windowed:
  - `chat` 54/54 and `chat-3d` 53/53 (were 39 and 38). The new checks read the mark nodes: which
    cords carry one, its colour, that it sits on its own cord, and zero mark nodes after each
    clear. The worker broke the marks four ways to prove the suites fail (never cleared, 52/54
    and 49/54; wrong cord, 44/53; drawn on the first cord's line, 47/54).
  - `dotnet test`, filtered: C2 to C5, the token table and boundary tests, 184/184. Both
    solutions build 0 warnings / 0 errors.
  - Existing suites: cords 4/4 and cords-3d 4/4; geometry 8/8 and geometry-3d 10/10; visuals
    5/5; lock 26/26 and lock-3d 26/26; boot 8/8; renderer 2/2. The worker also ran headless3d
    5/5.
  - Known limits: the ring sits at the cord's midpoint, which can land on a small label or an
    empty hole; nothing keeps it clear of labels. In 3D it draws on top of everything.
- **The teletype cue is not built.** Six synthesized candidates, with a generator and an
  audition script, are scratch files outside the tree; Tom picks one by ear or drops the cue.
  The gate above ran without it. Adding it moves `data/public-assets.json` and the inventory
  test's count, so those checks and the audio suite rerun then.

- **C4, the dock:** the right column has `Cords | Chat` tabs; `ChatModel.cs` (no Godot types) is
  the dock's state and rules, ported message for message from `src/pane/ui.ts`, and `ChatDock.cs`
  draws it. The Godot project now references `Minivac.Hands`: each `request` frame is answered by
  `PaneJson.Answer` on the main thread, the machine is adopted after `create` and after every
  `run`, and released on `ended`. `--pane-link <url>` after `--` connects at launch; `/` is the
  new `chat_focus` action. The dock root has `MouseForcePassScrollEvents = false` (Tom's ruling).
  Checks, 2026-11-12, rerun by the orchestrator, windowed:
  - `chat` 39/39 and `chat-3d` 38/38 on the scripted fake transport: every row of the plan's
    states table, a whole scripted session with each frame the dock sends, keyboard-only
    operation, the focus rules, the wheel over the dock in both views, the 8,000-character cap
    and the layout numbers. The worker broke two behaviours to prove the suites fail: the wheel
    property removed (`chat-3d` 36/38) and Shift+Enter made to send (`chat` 35/38).
  - `dotnet test`, filtered: C2, C3, C4 and boundary tests, 159/159. Both solutions build
    0 warnings / 0 errors.
  - Existing suites: lock 26/26 and lock-3d 26/26; boot 8/8; session 9/9; commands 8/8, flat and
    3D; cords-3d 4/4; keyboard 8/8; geometry 8/8 and geometry-3d 10/10; popouts 21/21; a11y 1/1.
    The worker also ran cords 4/4, keyboard-3d 8/8, manual 3/3 flat and 3D, headless3d 5/5.
  - Against the real, unchanged server with an unreachable model (the worker's throwaway run, not
    a suite): `--pane-link` reached "connected"; a sent message came back as the server's error
    and showed as an error entry; End session ended the run, which was not marked invalid.
  - Measured at 1152 x 640: with Chat selected the dock is 360 px wide and the flat console is
    756 x 420 (868 x 482 with Cords); a hole is 7.9 px across in the fit view. In 3D the console
    keeps its size and is centred left of the dock by a lens shift.
  - Not exercised by the suites: the four `--pane-link` lines in `Boot.Start` (the real-server
    run used the same calls), toggling flat and 3D with Chat selected, resizing the window in 3D,
    keyboard scrolling of the transcript, a real keyboard, an IME, the OS clipboard.
  - The message box can hold more than 8,000 characters for one frame before the cap trims it;
    the server refuses a longer message either way.

- **C2, adopt, freeze and lock:** `Session.Adopt` shows a machine someone else owns, frozen and
  locked, as a blank manual panel; `Boot.Adopt(Machine)` and `Boot.Release()` are what C4 calls.
  `FrameLoop` has a render-only mode. While locked, `Session.Apply` refuses (the choke point),
  panel controls, cord drags, the cord list, the picker and the toolbar's Library, Blank panel,
  Reset and Profile are off, and the camera, Fit, Wire, the view toggle, Sound and Help stay live.
  Machine audio resets on adopt and is not driven while adopted. `Banner.cs` is the strip across
  the stage, with Stop and End session as events for C4. Checks, 2026-11-12, rerun by the
  orchestrator, windowed:
  - **Zero-applies suite:** `lock` 26/26 and `lock-3d` 26/26. A counting wrapper sees no apply,
    advance or drain while 29 input paths are exercised with injected events in each view, and
    the same paths reach the machine after release. The worker broke the lock two ways to prove
    it fails: a pushbutton guard removed (20/26), and the choke point plus a cord guard removed
    (9/26, with applies counted).
  - Existing suites: session 9/9; commands 8/8, flat and 3D; cords 4/4, flat and 3D; keyboard
    8/8, flat and 3D. The worker also ran manual 3/3 flat and 3D, audio 9/9, trace-equality
    11/11, a11y 1/1, boot 8/8, headless3d 5/5. "Full gate" below records commands and keyboard
    as 7/7; both suites hold 8 checks and C2 did not change them, so that record is stale.
  - `dotnet test`, filtered: C2, C3, boundary and frame-trace tests, 134/134. Both solutions
    build 0 warnings / 0 errors.
  - Not exercised by the suite: the picker's hold-to-touch buttons, focus-out releases, Escape
    cancel paths, and the F key (the suite calls the view toggle directly).
  - Seen once, cause unknown: in one `lock-3d` run the motor sound did not report playing in the
    same frame as release. The check now looks a few frames later and has passed since.
  - The banner is 64 px high and moves the flat stage down 72 px while a machine is adopted; in 3D
    it overlays the stage.
- **C1 review** (independent, read-only, on `f5ea72d`): no divergence between the two engines on
  about 6,600 server-built requests, 295,528 number formats and four non-English cultures.
  Accepted and repaired (the C1 bullet below has the repairs): a lone UTF-16 surrogate in a cord-end word ends the run in C#
  where the web refuses it; the transfer test sat in default `npm test` and could run a stale
  tool; four of ten planted bugs passed it; `PaneJson.Answer` could throw on malformed JSON.
  Deferred: the purity facts are regex scans that other APIs could slip past (the source is
  clean). Measured: C# Release runs the core at about 2.1 times V8's time per tick, Debug about
  6.5 times, so a call that waits 60 s of simulated time blocks the Godot main thread for about
  10 s in Release; 70 connects and a 500 ms settle take 23 ms.

- **C1, the hands table and the engine in C#:** `dotnet/Minivac.Hands/` (references
  `Minivac.Core` only; `Minivac.Core` did not change) ports `src/hands/table.ts` and
  `src/pane/engine.ts`, with `PaneJson.Answer` as the request-in, reply-out JSON boundary that
  Godot will call. `dotnet/Minivac.Hands.Transfer/` is the JSON-lines tool, and
  `dotnet/Minivac.Hands.Tests/` the xunit ports. Checks, 2026-11-11, rerun by the orchestrator:
  - Both solutions build 0 warnings / 0 errors. `Minivac.Hands.Tests` 123/123;
    `CorePurityTests` 12/12 (two new facts hold the hands project to the core's purity rules).
  - **Transfer test** (`test/pane/transfer.spec.ts`), 28/28: all 15 recorded sequences plus 11
    added ones, driven through the server's own `callOnPage`. Each reply is equal after parsing
    and byte-identical as JSON text, each call renders the same text, and the sessions end equal.
    `npx vitest run test/pane test/hands`: 254/254. Typecheck and lint clean.
  - **Repairs after the C1 review, 2026-11-12** (counts rerun by the orchestrator): the
    transfer test moved to `test/pane/transfer.dotnet.ts`, out of the default Vitest include,
    and runs with `npm run transfer` (`vitest.transfer.config.ts`), which builds the tool in
    Release with warnings as errors first and fails when `dotnet` is missing or the build fails.
    `npm test` no longer needs .NET; `tools/public-snapshot.sh gate` runs `transfer` after
    `parity`. Strings read from request JSON go through `Js.Text`/`Js.Name`, which keep an
    escaped lone surrogate as one UTF-16 unit as `JSON.parse` does (System.Text.Json throws on
    it, which had turned a model's `connect \ud800/free` into a fatal engine error).
    `PaneJson.Answer` never throws: unparseable text answers `{ error: 'the page engine threw:
    ...' }` and leaves the session alone. Added boundary cases (exactly `PATH_LIMIT` transitions,
    a lamp moving at an unsettled cap, a press with both arguments bad, lone surrogates) and a
    seeded random differential (seed 601, 24 sessions of 40 calls). Checks, 2026-11-12:
    `npm run transfer` 58/58 in 61 s; `Minivac.Hands.Tests` 137/137; `CorePurityTests` 12/12;
    `npx vitest run test/pane test/hands` 226/226 without .NET. The review's four surviving C#
    mutants (`PATH_LIMIT` 6→5, no cap-tick lamp reading, `<` on the head length, press checking
    the time first) each fail the new transfer test.
  - Not reached by the transfer test, covered in xunit only: the int32 tick-limit refusals, and
    "the page machine failed/refused a validated batch". Not covered anywhere: the
    `tick_us != 100` profile refusal (no such profile) and `bad_cord_id` with all 256 ids in use.
  - Not ported from `table.spec.ts`: the Ajv schema and description checks, and the session-file
    module's own assertions (Node-only code outside the port).
  - `[likely]` .NET's shortest round-trip digits equal V8's for every double; tested on 20 values.
- **Found in the core, not changed:** `Minivac.Core/Terminals.cs` quotes terminal names in its
  error text with the default `JsonSerializer.Serialize`, which escapes `+` and the minus sign
  where TypeScript's `JSON.stringify` writes them as they are. The hands port builds its own
  messages and does not depend on it. No fixture or golden shows the difference.

- **C3, the link and the socket** (built in a worktree, in parallel with C1): `PaneLink`,
  `PaneProtocol`, `PaneTransport` (the seam and the scripted fake), `PaneSocket`
  (`WebSocketPeer`) and `PaneConnection` (the link state machine, no Godot types) in
  `godot/scripts/`, with five allow-list rows. Nothing is wired into `Boot.cs` or the scene yet,
  and `--pane-link` is parsed but not read at launch; both are C4's. Checks, 2026-11-11:
  both solutions build 0 warnings / 0 errors; `C3PaneProtocolTests` 79/79,
  `C3PaneConnectionTests` 18/18, `GodotBoundaryTests` 22/22. Against the real, unchanged server,
  headless: a good link reaches ready; a wrong token, token-refused; a wrong origin and no server,
  could-not-connect; the server killed while connected, connection lost. That run used a
  throwaway harness; there is no permanent real-socket suite. The two refusal texts are still the
  web page's words ("this page…", "open the URL…"); C4 rewords them for the dock.
- Tom ruled at the C0 stop: the dock root sets `MouseForcePassScrollEvents = false` (DECISIONS).

- Tom approved the plan to build on 2026-11-11 (DECISIONS, same entry, "Approved to build"). The
  plan's status line says so; the bullets at the end of this section that call it unapproved
  predate that.
- **Build host.** The build runs on a second development host, by Tom's choice on 2026-11-11, which had no Godot and
  no .NET SDK. Installed user-local, no Homebrew, no admin rights: Godot 4.7.2 mono from the
  official release (SHA-512 matched against the release's sums; notarized) in `~/Applications`,
  and .NET SDK 10.0.403 from Microsoft's install script in `~/.dotnet`. Homebrew's `dotnet-sdk`
  cask is now 11.0.100, which `global.json` (10.0.400, `latestPatch`) does not accept. The macOS
  proof host on record is still the macOS arm64 development host (`docs/port/CSHARP-PORT.md`).
- **New-host baseline, 2026-11-11:** `dotnet build` of both solutions, 0 warnings / 0 errors.
  `npx vitest run test/conformance`: 19 files, 286/286 in 612 s. The .NET suites and the Godot
  self-test have not completed a run on this host yet. The core suite passes 258 tests in 29 s
  and then runs `All_manifest_fixture_traces_are_repeatable_and_byte_equal_to_goldens`, the whole
  corpus twice, which had not finished after 28 minutes; it is slow, not shown to be hung, and it
  runs to completion in the C6 gate.
- **C0 probes** `[verified: run 2026-11-11 on Godot 4.7.2, the second development host]`, against the server as it is:
  - **Admission: pass, no fallback.** `WebSocketPeer.HandshakeHeaders = ["Origin: <origin>"]`,
    set before `ConnectToUrl`, with the origin of the link the server prints, passes the Origin,
    Host and token checks and gets `ready`. Godot sends no Origin of its own. No Origin or a wrong
    one gets the server's 403, which Godot reports only as closed-before-open with code -1: the
    same as no server at all. A wrong token is open, then closed 4001 "bad token"; another
    protocol, 4002. So the dock can tell token refused, other build and could-not-connect apart,
    and cannot tell a refused Origin from a server that is down. `FALLBACK-GCP-ORIGIN` not taken.
  - **Frames: pass with `FALLBACK-GCP-FRAME`.** At the default 65535-byte buffers a 65536-byte
    frame fails each way: outbound, `SendText` returns `OutOfMemory` and the socket stays open
    with the frame unsent; inbound, the socket closes 1009. With both buffers at 4 MiB, the
    server's own `maxPayload`, frames up to 4,194,304 bytes cross both ways byte-identical
    (length and SHA-256). Both must be set before `ConnectToUrl`; the inbound size is fixed at
    the handshake. Measured with the real parser, renderer and engine: the largest frame of a
    70-cord session is the `run` reply, 18,598 bytes; the largest overall is the `session` reply,
    about 48 bytes per log step (291,487 bytes at 6,014 steps). The build uses 4 MiB.
  - **The plan's frame fact was wrong in one detail:** `create` never carries a log (217 bytes,
    always the fresh session). The log travels from Godot to the server as the `session` reply.
  - **Keys: pass, flat and 3D, headless and windowed.** With a `TextEdit` focused, F, W, R and the
    arrows do not reach the stage or the camera and the characters land in the box; Escape
    releases focus and the keys work again. In 3D, focusing the box clears the panel
    SubViewport's focus, so there is one focus owner.
  - **Wheel: pass in flat; FAIL in 3D, with no fallback named in the plan.** A wheel over a
    `MouseFilter = Stop` control still dollies the 3D camera, because
    `Control.MouseForcePassScrollEvents` defaults to true and the event reaches
    `OrbitCamera._UnhandledInput`. With that property false on the control, there is no zoom in
    either view, including over a default Button inside it, and a `ScrollContainer` scrolls
    without zooming in both. Tom ruled the same day: the dock root sets it false in C4.
  - **Headless socket: pass.** A `--headless` run held the socket for 65 s, exchanged 13 frames
    and closed 1000. `Poll()` was called once per `_Process` frame; a slower rate was not tested.
  - **Two clients on one server** `[verified: tools/hands-pane/server.ts, connect and onMessage]`:
    every admitted socket gets its own connection, session and run folder. A web page and the
    Godot build can be connected at once, and neither sees the other's machine.
  - **Quitting mid-session:** `Quit()` sends no close frame (the server sees 1006), and the server
    logs "the page disconnected, run marked invalid" for a quit, a kill, and a clean close alike.
    Only End session leaves a valid run.
- **Found, not changed** `[likely: injected key events, not a real keyboard]`: with nothing
  focused, +, = and − do not zoom the flat stage. `Stage.HandleStageKey` compares
  `InputEventKey.AsText()` to "+", "=", "-" and "_", and Godot returns "Plus", "Equal" and
  "Minus". Outside this plan; for Tom to confirm by hand.
- No code changed in C0. The probe sources and logs are scratch files, not in the tree.
- Tom ruled on the proposal's open questions (DECISIONS 2026-11-11, "Chat pane in the Godot
  build"): Godot as a WebSocket client of the existing pane server; camera free
  while the panel is locked; cord marks, cords only; the machine silent during calls, with a
  teletype cue as a maybe; the Chat tab visible.
- The plan is `docs/plans/godot-chat-pane.md`, phases C0 to C6. It is written, not approved to
  build. Its "Working choices" and its proposed done bar are the orchestrator's and wait for Tom.
- Docs only: no code changed. The one check run, 2026-11-11: `npm run check-docs` on Node 26.12.0,
  0 findings, 12 allow anchors verified. The new plan and DECISIONS entry are clean on the public
  snapshot's exposure patterns.

## 2026-11-03 — The chat pane goes public as a bring-your-own-model tool. **Next: nothing owed.**

- Routes come from `MINIVAC_PANE_ROUTES` and runs go to `MINIVAC_PANE_RUNS` (default `pane-runs/`);
  a reply with no served-by header gets no badge. The pane tree, its tests and the stage 3 plan are
  public-safe at source; `tools/hands-pane/README.md` is the guide. The checklist driver and
  `test/private/` stay private (DECISIONS, 2026-11-03, "Chat pane in the public copy").
- Checks, 2026-11-03: typecheck, lint, Vitest 74 files (2037 passed, 1 expected fail), build with
  check-dist, and the browser suite (51 passed) all clean. B1 from the pane passed twice on live
  models: through the LiteLLM gateway on the default route with the fallback guard on (the
  checklist driver, `.env.pane`), and against a vLLM server directly, with no proxy, where no reply
  carried a badge and the run went to `pane-runs/`, which git ignores.

## 2026-11-03 — Public snapshot of stages 2–3 published. **Next: nothing owed.**

- The snapshot of stages 2 and 3 is published, per DECISIONS 2026-11-03 "Public snapshot calls".
  Its gate passed 15/15; the scrub had the exposure grep (now with the lab's route and
  infrastructure names), a wide grep, and an independent cold review, whose eight findings were
  fixed.

## 2026-11-03 — Stage 3 closed; the hands roadmap is done. **Next: nothing owed; parked items below.**

- Tom closed stage 3 (DECISIONS 2026-11-03, "Stage 3 closed") after his third pane session wired
  tic-tac-toe and made the machine's first move.
- Awaiting Tom's view, not owed: the orchestrator working choices in DECISIONS 2026-11-03 ("Stage 3
  build"), e.g. any engine error ends the session, End and New session hand the machine back live,
  `grep` stops at 10 s, and a turn that threw is a driver error.
- Parked: Sonnet 5.5 on r20; the Claude rungs on OP3; gemma-4-31b on r20; cord-by-cord animation.

## 2026-11-03 — Pane hands-on, second pass: file-tool scope narrowed; `connect` takes a free end. **Next: Tom tries tic-tac-toe again from the pane.**

- Tom's second tic-tac-toe session could not plug the
  fixture's two free-ended leads and searched the simulator's source for a way. Per Tom (DECISIONS
  2026-11-03, "file tools"): the file tools now read only `docs/research/` and
  `test/conformance/fixtures/`, plus the run's own session file. Checklist runs from here on are
  not like-for-like with the earlier ones.
- `connect <A>/free` plugs a free-ended lead (DECISIONS 2026-11-03, "Free cord ends"). Building
  tic-tac-toe's 70 wires, its two leads and its first move from the CLI gives exactly the fixture's
  commands (`test/hands/cli.spec.ts`), and the pane draws a free end in the panel's tray.

## 2026-11-03 — Pane hands-on, first pass: the pane shows the model working

- Tom wired tic-tac-toe from the pane on the default route. Its 70 cords match
  `VI-TICTACTOE.fixture.json`: the model grepped for the fixture and copied it.
- Added, per Tom (DECISIONS 2026-11-03, "Pane hands-on"): a "waiting for …" line with a running
  clock while a request is out. PANE_PROTOCOL is 3, so restart the pane server and reload the page.
  Cord-by-cord animation is deferred.

## 2026-11-03 — Review of `ab94216..42bfd9e`: two P2 findings, both fixed

- **Fixed**, each with a failing test first:
  - every string the server sends the page loses the key and the gateway's address, whatever its
    source: read_file output, call args, the model's text. The model's own view is unchanged, the
    same as the CLI's.
  - `runLoop` throws a `LoopError` carrying the totals up to the failure. The pane records them;
    the CLI prints the original error as before.
- Typecheck, lint, check-docs, full vitest (73 files, 2027 passed, one expected failure) and the six
  pane browser tests pass. The review as written:

- The pane server: a later model-response exception discards the current prompt's
  completed-call accounting even though its transcript and exported session remain. Preserve
  partial loop totals on failure.
- The same server withholds raw gateway errors from the page, but a later `read_file` of the run's
  transcript sends them back in unredacted tool output. A synthetic key in a 429 response reached
  the page in the reproduction. Protect raw run artifacts or redact every browser-bound string.
- Both findings reproduced with a local fake gateway and the actual pane engine. Typecheck,
  lint, production build and dist check, documentation check, and six desktop pane browser tests
  pass. All 36 committed checklist verdicts reproduce (35 pass, the recorded OP3 s2 fails).
  Full `npm test`: 73 files passed, 2024 tests passed and one expected failure. The completed run
  allowed localhost listeners; the sandbox-restricted attempt was stopped after listener timeouts.
  No implementation changes made.

## 2026-11-03 — Stage 3: the chat pane is built; the checklist passes from it. **Next: Tom's hands-on use of the pane, then his call on closing stage 3.**

- **Built** (DECISIONS 2026-11-02 "Stage 3 plan rulings", 2026-11-03 "Stage 3 build"): the pane
  UI and its DOM-free engine, a local server running the model loop over a 127.0.0.1 WebSocket, and
  a checklist driver that runs items through the pane (all kept out of the public copy); and the
  supporting changes: `validateBatch`, the `minivac-control` parse/backend/render split, `runLoop`,
  `DemoSession.adopt`, frozen and locked mounts, and the composition moved to `src/app.ts`.
- **Review** — one adversarial pass: no high-severity findings; 11 medium and low findings fixed,
  each with a test that failed first (`f055793`).
- **Checks** — the full gate once after the fixes: typecheck; `npm test` 73 files, 2024 passed
  plus the one expected fail; `npm run build` with the pane-free dist check; `npm run
  test:browser` 48 passed, 12 skipped (pane specs run on desktop only); `check-docs` clean;
  the public-copy exposure check clean, with the pane excluded from the public copy.
- **Checklist from the pane**: the default route x3, 12/12 items passing at least once, 35/36 runs, every verdict reproduced from its exported
  session and every replay matching the page. The one fail is OP3 s2 (an extra turn to 3 first).
- **Open:** Tom's hands-on use (the rest of the stage 3 bar). Out of v1: real-time animation and
  sound or trace for model calls, live cord resync, voice and the Godot build, the Claude rungs in
  the pane.

## 2026-11-02 — The dial item OP3; working choices ratified; stage 2 closed; stage 3 shape ruled. **Next: the stage 3 build (machine in the page, local loop, default route; DECISIONS 2026-11-02).**

- **Built** (DECISIONS, 2026-11-02 "Dial item OP3; orchestrator choices ratified"): OP3, an operate
  item on `I-EXP11` ("Load the manual rotary switch circuit, turn the pointer to 1, then to 2").
  In `bin/minivac-check`, a dial step now matches a dial hold at any angle, its checkpoint must
  name `dial`, and a `dial release` after the last dial step is allowed.
- **Runs** (skill r20): qwen3.8-flash-next, qwen3.8-27b
  and gpt-oss-120b 3/3 each, all served by their own servers; gemma-4-26b 2/3 (one run turned the
  pointer back to 0 after reaching 2). Not run: gemma-4-31b and the Claude rungs.
- **Checks** — typecheck, lint and `check-docs` clean; `npm test` passed: 64 files, 1829 tests,
  plus the one expected fail (O-E11).
- **Ratified** — Tom made the 2026-10-31 to 2026-11-02 orchestrator working choices rulings
  (listed in that DECISIONS entry); gemma-4-26b's cost under r20 was already ruled.
- **Stage 2 closed** — Tom, 2026-11-02 (DECISIONS, "Stage 2 closed").
- **Stage 3 shape** — Tom, 2026-11-02 (DECISIONS, "Stage 3 shape"): the pane operates the page's own
  machine through `src/hands/`; a local process holds the key and passes tool calls over a localhost
  WebSocket; a selectable default route that may fall back to a cloud model.
  `tools/hands-api/` has no tests, which matters if the local process reuses `openai-loop.ts`.
- **Parked:** Sonnet 5.5 on r20 (Tom); Haiku on OP3; gemma-4-31b on r20.

## 2026-11-02 — Stage 2: the hands loop on local and Claude models; skill r20. **Next: Tom's call on gemma-4-26b's cost under r20.**

- **Built** (DECISIONS, 2026-11-02 entries): `tools/hands-api/openai-loop.ts`, the OpenAI-compatible
  loop over the same tools, with a fallback guard (`MINIVAC_LLM_REQUIRE_API_BASE`) and per-run cost;
  tool aids (`disconnect all`, case-insensitive grep, help pointers). Skill r20 is the repo skill:
  r14 plus "a push is one `button <n> press`, hold only when asked" and "list the steps from the
  task's words before the first press".
- **Runs** (all 11 items x3, 40 turns): on r20
  Haiku 5.5, qwen3.8-27b and qwen3.8-flash-next 33/33 each. On r14 gpt-oss-120b 33/33 at
  concurrency 3, gemma-4-31b 33/33, Sonnet 5.5 30/33. gemma-4-26b is 31/33 on r14 and about 28-30/33
  on r19/r20 (`load-program` on wiring items); Tom put Haiku ahead of gemma.
- **Checks** — the full suite passed after the tool aids (64 files, 1822 tests, 1 expected fail);
  the later loop changes touch only `tools/hands-api/`, which has no tests; typecheck clean at
  `f92017a`.

## 2026-10-31 — Days 4–5: all contract commands, load-program, operating items; 11/11 PASS. **Next: Tom confirms stage 1 closed; stage 2 (hands API).**

- **Built** (DECISIONS, 2026-10-31 entries from "Operating items" on): `breaker reset`,
  `relay <n> hold/release`, `dial hold/release`, `load-program <ID>`; operate items with steps,
  checkpoints and an end state (OP1 counter on `IV-EXP1-SLOW`, OP2 burglar alarm on `V-EXP2`);
  wiring and basic items fail a session that used load-program.
- **Checks** — typecheck and lint clean; `test/hands` plus `test/checklist` 91/91. One review pass
  found OP2 passing a two-cord fake and operate steps that checked commands sent rather than their
  effect; fixed with operate extras and Tom's checkpoints, every reviewer scenario now a failing test.
- **Run** — 11/11 PASS from fresh sessions, 0 denied calls, every verdict reproducing. That meets the O6 bar as ruled.

## 2026-10-31 — Day 3: checker, nine items, skill v0; first run 9/9 PASS. **Next: Tom reads the run; Day 4.**

- **Built** (DECISIONS, 2026-10-31 checklist entries): `bin/minivac-check` (`tools/checklist/`),
  nine items in `checklist/items/` (five wiring, four basic), `.claude/skills/minivac/SKILL.md`.
  Extras are tagged `unverified` under O-C30's `FALLBACK-CHECKLIST-EXTRA`, except III-XOR-PB's,
  which is O-C29's.
- **Checks** — typecheck and lint clean; `test/hands` plus `test/checklist` 58/58; all nine items
  pass on their reference sessions. One review pass: two medium findings (III-RELAYOR passed a
  circuit with no relays; one extra untagged) and five low, all fixed.
- **Run** — one fresh `claude -p --model opus` session per item, 9/9 PASS, every verdict reproducing from its session file. 29 Bash calls were
  denied for not being a bare `minivac-control` call (mkdir, shell variables, loops). A skill line
  fixed it: the rerun is 9/9 PASS with 0 denied, the first
  human-in-the-loop cycle on record. Open for Tom: O3, O4, O6, O-C28 and what load-program loads.

## 2026-10-31 — `minivac-control`, the CLI an LLM operates the machine through. **Next: Day 3 (checker, skill v0).**

- **Built** (DECISIONS, 2026-10-31, both entries). `src/hands/table.ts` is the tool table: power,
  connect, disconnect, button, switch, wait, state. `tools/hands/` holds the session file
  (`minivac.session/1`), the CLI and its help. `bin/minivac-control` is the entry point. `breaker`,
  relay and dial grabs, load-program, the checker and MCP are later days.
- **Checks** — typecheck and lint clean; `test/hands` 27/27; `test/conformance` 286/286 before the
  simplify pass; after it, `npm test` (lint plus the full vitest suite) passed: 63 files, 1752 tests,
  plus the one existing expected fail (O-E11).
- **Cold-reader demo** — a headless `claude -p --model opus` session with Bash restricted to the CLI,
  given only `--help` and "Make light 2 come on only while I'm holding buttons 1 and 2 together",
  wired I-EXP4's circuit on its first try and showed lamp 2 off with either button alone and on with
  both (7 turns). It also caught a lamp still `dim` after a settle, which is O-C28. The CLI
  now prints a note for it; whether settle should wait for filaments is still Tom's call.
- **Known costs** — each call replays the whole session at about 6 µs per simulated tick, so after
  5 minutes of simulated time one call takes about 19 s; nearly all of it is the core's per-tick
  solve. A call killed mid-run leaves `<session>.lock`, and the error message names it.

## 2026-10-16 — The panel logotype fits its plate; work is on `main`. **Next: Tom's end review.**

- **Logotype** (Tom's smoke test: Godot clipped it at the panel's right edge). Both builds now set
  "Minivac 601" in Arial Bold, at the same size, centred on its point. It spans 0.738–0.971 of panel
  width, inside the upper-right plate (0.728–0.981). Arial Black had made it 110% of the plate's width;
  on PH2 the title is 83%, with about the same letter height. New checks: the browser test "fits the
  logotype inside its plate" and the Godot geometry check `logotype-fit`.
- **Branch.** `feature/phase-5-corpus` is merged and deleted. New work goes on `main`.

## 2026-10-15 — Phase 5 closed; the public copy is on GitHub (private). **Next: Tom's end review.**

- **Step 9 done.** The full gate passed, the public-exposure audit ran, and Tom made the publish
  calls (DECISIONS, *2026-10-15 — Public copy calls*). The public copy is a scrubbed single-commit
  snapshot of this repo: personal and lab-specific text removed, MIT `LICENSE` and `NOTICE` added. It
  passed the full gate before the push. Making it public is Tom's step.
- **Updates to the public copy** arrive as new commits titled "snapshot of private `<sha>`", each
  checked by the exposure grep and the full gate.
- **Pushbutton latch** (DECISIONS, *2026-10-15 — Pushbutton latch*): shift-click, or Shift+Space /
  Shift+Enter, keeps a pushbutton down, so one mouse can hold two.
- **Phase 5 process tools retired:** the queue generator, its spec and the generated queue. The
  Phase 5 run rules stay in DECISIONS as a record.

## 2026-10-15 — Repo cleanup before GitHub

- **Removed** (Tom asked for what served design and build but is not useful going forward):
  - the Phase 1 to 2 handoff, four finished plans and briefs, `BUILD-LOG.md`, `w1-remediation.md`,
    `phase-1-core.md` and the prebrief zip;
  - this file's session log;
  - the closed-phase sections of the plans, the research docs and DECISIONS.
  Rulings and measured records that lived only there moved to DECISIONS first. Git history on the
  private origin keeps everything.
- **Tree rule for a HEAD-only publish:** no tracked file points at a removed file, a commit hash,
  a temp or session path, or a local checkout path. The raw JSON captures' paths are now
  repo-relative, an exception to `raw/README.md`'s do-not-edit rule. An Opus high-effort review
  found 27 issues, none high; all are repaired, the last (lab host names) in the public copy.
- **Kept on purpose:**
  - the two `raw/pdf/minivac601-*.txt` duplicates, because the raw captures cite them;
  - the Wave C counter experiment, because Wave D's live identity report computes through it;
  - the phase-named test titles.

## 2026-10-14 — Step 8: six demos land; the library is 17. **Next: Step 9 (pre-GitHub gate), and Tom's end review.**

- **Demos added** (Tom accepted the orchestrator's pick, DECISIONS 2026-10-14):
  - Traffic Light (`V-EXP4`, new category `control`)
  - Scissors, Paper or Stone (`VI-SPS`, `game`)
  - Combination Lock (`VI-COMBOLOCK`, new `lock`)
  - Morse Code Encoder (`V-EXP19`, new `code`)
  - Reaction Time Tester (`VI-REACTION`, `game`)
  - Half-Adder (`IV-EXP4`, new `arithmetic`)

  Each one's wiring is its passing printed fixture's `wires`, pinned by sha256 in
  `demo-library-source.spec.ts`. The count guards are now exactly 17 in TS, Godot and C#.
- **Godot notice loader.** It accepted only 0- or 3-paragraph notices. It now takes exactly 0, 1 or 3
  non-empty paragraphs, and the per-demo shapes are pinned in `Acceptance.cs` and
  `P3FrozenCopyTests`. `main.css` renders single newlines in a notice, for the Morse dial plate.
  - No test proves the loader rejects a bad notice. The guard is in a private method of a Godot
    `Control`, and `Minivac.Godot.Tests` never builds Godot nodes. A test would first need the check
    moved into a plain helper class.
- **Process** (Tom: no reviews until the end, then one Opus high review). Six Sonnet drafters wrote
  one entry each from the page images. One Opus coder integrated them. One Opus high reviewer read the
  copy against the pages.
  - 6 of its 8 findings were repaired: an exact Godot notice guard, SPS hold wording, Combination Lock
    left/right, Traffic Light wording, no `; ER-nn` locator suffix for prose-only errata, and the
    Morse notice header and per-letter restart.
- **Copy that rests on a fixture reading, not a printed sentence** (the orchestrator's working choice,
  for Tom's end review):
  - SPS "holds ... while both pushbuttons are held down" (the circuit shows a result only while both
    are down).
  - Combination Lock "left (counterclockwise, numbers going down)" (the fixture's reading of the table
    and the D8 footnote).
  - Morse "for each new letter, turn power off and start again" (each printed per-letter procedure
    starts by turning power on).
- **Recorded, not changed:**
  - Combination Lock light 6 is on from power-on until 13 latches relay 6, so a stranger may read it
    as an error. The page does not print this, so no copy covers it.
  - The reviewer reported that a mouse alone cannot hold two pushbuttons at once. Confirmed
    2026-10-15 and fixed by the shift-click latch (DECISIONS, 2026-10-15).
- **Also today:**
  - `motor-sweep --jobs N` now splits each axis across child processes: a full `--check --jobs 16`
    matched the committed baseline byte for byte in 1780 s.
  - Tom's ruling recorded in DECISIONS: one batch review for Step 8, not one per demo.
- **Stale count left in a record:** the cord-collision tripwire in `docs/plans/phase-4-presentation.md`
  still says "the eleven demos". It is history, not a guard.

## Open for Tom's end review

Parked items are logged here with their evidence (DECISIONS, *2026-10-13 — Phase 5 run rules*).

- **Coast tap-window edge.** `coast_udeg_drive_removed` is 9.54°, the midpoint of the printed band
  [5.692552°, 13.385387°] (Tom's ruling, DECISIONS 2026-10-14; O-R5, O-R14). The upper edge is
  VI-MATCHGAME script[68], the machine-move until on the gap: from 13.385388° the turn c13→gap→c12
  completes inside the fixture's 50 ms pb6 tap, before the until starts. The printed rest asserts hold
  to 13.713926°. Discounting script[68] gives [5.692552°, 13.713926°] and a midpoint of 9.70°. By the
  ruling's letter 9.54° stands. VI-MATCHGAME also passes on an island at about 13.65–13.71° (0.01° scan).
- **Motor-sweep verdict changes** from the 9.54° coast, accepted into the regenerated baseline (77 cases,
  40 non-ROBUST case-axes); `--check` gates only against that baseline:
  - Worse on `contact_arc_udeg`: the V-EXP5 claim and FIXTURE/V-EXP5 (FRAGILE 12.66–21.09°), and
    FIXTURE/V-EXP11 (ROBUST 2.81–21.09° → FRAGILE 14.06–21.09°). A 9.54° coast no longer clears the
    wider gaps of a narrower pad.
  - Better on `run_mrpm`: the V-EXP5 claim (FRAGILE 42.5–60 rpm → ROBUST 25–60 rpm).
  - New: VI-MATCHGAME is FRAGILE on drive_removed (0–11.25° plus the shipped 9.54°) and on contact_arc
    (14.06–21.09°). V-EXP5 is FRAGILE on drive_removed (0–11.25°, 19.69–36.56°).
  - FRAGILE on `coast_udeg_stop_shorted`: printed II-EXP7, III-MINDREADING, IV-EXP12, V-EXP7, V-EXP8,
    VI-MINDREADING, VI-TUGOFWAR, and 11 speculative.
- **IV-EXP10 (O-C13).** ER-27 puts three plugs on two-hole 3G, so the corrected program cannot be wired.
  No printed fixture.
- **Parked speculative fixtures.** Both are knife-edge trips that did not hold under BLESS-ROBUSTNESS.
  Their fixtures were never committed.
  - V-EXP9-DERIVED fails the coil R −10% perturbation.
  - VI-RANDOM fails lamp τ ×2.
- **O-C8 and O-C9** were ruled (ER-32 and ER-36 kept as printed, DECISIONS 2026-10-13). V-EXP10-5L6G's
  nickel-plus-five-pennies carry pulse is a timing knife-edge and was dropped from that fixture.
- **`FALLBACK-TTT-RING-CW`.** Tic-Tac-Toe's derived later moves were to be checked against the flipped
  motor at Step 8. No record shows that check was done.
- **Corpus inputs found and not fixed:**
  - The record count is 99 non-MM; `programs.md` says 98 (IV-FF2-CARRY).
  - `programs.md` I-PROBLEMS: Answer 15 is five lines in full.
  - `parsePrograms` runs IV-EXP10 and V-EXP10 with the printed (uncorrected) wires.
- **Lamp PWL breakpoints.** The lamp table ships 33 breakpoints, although W1 measured that 9 change
  no relay decision (`architecture.md` §3.4's dated note). No ruling is recorded.

## Known limitations

- The atomic keyboard dial grab/release pair does not advance the core dial angle. Inherited and
  deferred; no gate may claim motion from it.
- Raised cap centre probes pass 3/3 at the default pose and 2/3 at 25° elevation, under the quad-only
  footprint contract: at 25° one raised cap centre misses its 2D footprint.
- Headless `commands` acceptance fails routing, so the Godot UI acceptance suites run windowed with the
  same exit-code contract. `headless3d` is the required headless check.
- Spatial audio listening is deferred under R12 (DECISIONS).
- 3D parked-focus recovery (Escape in `OrbitCamera.cs` and a left press in `QuadInput.cs` release
  the root focus owner) has no test: it needs a live `Viewport` with a real focus owner.
- The fallback index in `docs/research/README.md` lists only a few `FALLBACK-*` source names, so most
  fixture fallback sources are not indexed. This predates Phase 5.

## Full gate

This is the recorded Phase 4 and Phase 5 Step 9 gate, not a fresh run in this checkout. Step 9
closed on 2026-10-15 (above; DECISIONS, *Public copy calls*).

- npm: typecheck, lint, production build, `check-profile`, `check-netlist`, `check-reachability`,
  Vitest, browser tests.
- `check-docs`: 0 findings, every allow anchor present.
- .NET: the solution builds with 0 warnings / 0 errors; the core and Godot suites pass.
- Parity: every manifest fixture plus the CLI cases.
- Transfer (`npm run transfer`, added 2026-11-12 with the Godot chat pane's C1; not part of the gate
  recorded above): the C# pane engine against `src/pane/engine.ts`, byte for byte.
- `npm audit`: 0 vulnerabilities.
- Scoped secret scan over the changed text files: 0 findings.
- `git diff --check` clean.
- The Godot acceptance matrix (UI suites windowed; see Known limitations). The 2026-11-12 run at
  the top of this file has the current counts, with the lock and chat suites. Pass counts at Phase 4
  close: boot 8/8; commands 7/7 in flat and 3D; session 9/9; frozen-copy 7/7; cords 4/4, lamps 2/2,
  manual 3/3 and keyboard 7/7, each in flat and 3D; geometry 7/7 flat and 9/9 3D; trace-equality
  11/11; budget 1/1 (mean 3.288476 ms, p95 3.441100 ms); handles 108/108; popouts 21/21; renderer 2/2;
  headless3d 5/5; a11y 1/1; audio 9/9; visuals 5/5.
- Packaged exports: macOS (arm64 and x86_64 payloads), Linux x86_64 and Windows x86_64. Each macOS
  and Linux export passes `--headless -- --selftest` on a proof host of that platform (macOS x86_64
  under Rosetta) and reproduces the frozen summary: one `proof host` line per run, then the check
  lines. At Phase 4 close every run printed:

  ```text
  proof host=<OS> cpu=<CPU name> arch=<arm64|x86_64> audio=Dummy method=forward_plus driver=<metal|vulkan>
  profile-kat=1/1 w3-derived-kat=9/9 contraction=1/1 solver-kat=21/21 netlist-kat=40/40
  fixtures=36/36 goldens=36/36 probes=8/8 probe-pins=46/46 collapse=8/8 static=2/2
  ```

  The fixtures and goldens counts are the manifest's size, which Phase 5 grew to 155, so they now
  read 155/155.

- Exports are verification artifacts: nothing is signed, notarized, release-packaged or publicly
  distributed.

The native Windows runtime leg stays deferred under R8d (DECISIONS).

## History

The dated session log and the build record up to 2026-10-15 were removed from the tree. Rulings that
lived there are in `docs/DECISIONS.md`.
