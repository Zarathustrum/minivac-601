# The chat pane in the Godot build

Status: written 2026-11-11 at Tom's direction; **approved to build by Tom, 2026-11-11** (phases C0
to C6); **built 2026-11-12**, except the teletype cue, which waits for Tom's pick, and Tom's
hands-on session. Tom ran a first hands-on session on 2026-11-12; his two rulings from it (cord marks stop at 12 a call; the dock renders markdown in the reply) are in `docs/DECISIONS.md`, 2026-11-12, and are written into "Cord marks" and "Parity with the web pane" below. The record of what was built and checked is `docs/STATUS.md`, 2026-11-12. The rulings it rests on are in `docs/DECISIONS.md`, 2026-11-11, "Chat pane in the Godot
build". Everything under "Working choices" and "Execution" is the orchestrator's, not Tom's.

## Context

The web build has a chat pane where a model of your own operates the page's machine through
`minivac-control` (`docs/plans/stage-3-chat-pane.md`; guide `tools/hands-pane/README.md`). That plan
left the Godot build out of v1. This plan brings the same chat to the Godot desktop build: the same
server, the same words, the same output text, with the machine living in the Godot process.

**Rulings this builds on (Tom, 2026-11-11):**
- Chat comes to the Godot build now.
- Godot connects to the existing pane server as a WebSocket client. No model loop in C#.
- While the model has the machine the panel takes no input, and the camera stays free.
- After each call, the cords that call added are marked. Cords only.
- The machine is silent during the model's calls. A short 1960s-style teletype cue is wanted, as a
  maybe.
- The Chat tab is visible in the build without a launch flag.

**Earlier rulings that carry over unchanged:** instant calls, frozen and locked (2026-11-02,
"Stage 3 plan rulings"); the waiting line (2026-11-03, "Pane hands-on"); cord-by-cord animation
stays deferred (same entry); the key never leaves the server process (2026-11-02, "Stage 3
shape"); no screen-reader parity claim for Godot, but keyboard operability, visible focus and
tooltips (2026-09-03, "Accessibility obligation").

**The 2026-09-03 "no socket bridge" ruling** rejected a socket as a way to avoid porting the
simulator. Here the simulator stays native C# and the socket carries chat frames and tool-call
data to a model loop. Tom ruled the transport with that reading in front of him.

## Shape

```
Godot build ── godot/scripts/ (dock, link, socket client)
   │  dotnet/Minivac.Hands (C#): the engine, over the session's own machine
   │  WebSocket 127.0.0.1, token + Origin + Host checked (the server is unchanged)
   ▼
tools/hands-pane/server.ts ── runLoop ── model endpoint (key from env)
   │  minivac_control words → parsed in Node → ToolCall[] to Godot
   │  → Godot validates and runs on its Rig → data back → formatted in Node → model
   └─ writes <run folder>/<run>/{transcript.jsonl, run.json, session.json}
```

Godot takes the web page's place and nothing else moves. Node still parses the model's words and
writes the text, so the model sees the CLI's own text as long as the C# engine returns the same
data as `src/pane/engine.ts`. That equality is this plan's load-bearing test (C1).

## Design

### Layout

The right-hand column gets a two-tab head, `Cords | Chat`. Cords is today's cord list. Selecting
Chat widens the column from 248 px to 360 px and hides the cord list.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Library  Blank  Reset  Profile  Sound  Help  Fit  Wire  Zoom  Pan      │
│ (greyed) (grey) (grey) (greyed)                                        │
├─────────────────────────────────────────────┬──────────────────────────┤
│▌The model has the machine. Look, don't touch│ [ Cords ]  [ Chat ● ]    │
│▌waiting for <route> · request 2 · 14 s      │ session <date>-pane-1    │
│▌                    [Stop] [End session]    ├──────────────────────────┤
│                                             │ You                      │
│      ┌───────────────────────────────┐      │  Make light 2 come on…   │
│      │  MINIVAC 601 console          │      │ Model   served by <host> │
│      │  flat or 3D, camera live,     │      │  I'll wire both buttons… │
│      │  panel takes no input         │      │  ▾ minivac-control       │
│      │  ◎ = a cord the last call     │      │      connect 1+/1Y …     │
│      │      added                    │      │    ok  connect 1+/1Y …   │
│      └───────────────────────────────┘      │    settled after … ms    │
│                                             │    changed: <name> … → … │
│                                             │ ⋯ waiting for <route>…   │
│                                             ├──────────────────────────┤
│                                             │ ┌──────────────────────┐ │
│                                             │ │ message box          │ │
│                                             │ └──────────────────────┘ │
│                                             │ [route ▾] [Send] [Stop]  │
│                                             │ [New session] [End sess.]│
└─────────────────────────────────────────────┴──────────────────────────┘
```

- **Why a tab, not a toolbar button.** The toolbar's 14 buttons at an 80 px pitch fill its 1120 px
  `[verified: godot/scripts/Toolbar.cs, Chrome.cs LayoutChrome]`.
- **Flat view.** The stage inset on the right grows from 272 px to 384 px while Chat is selected.
  At the 1152 × 640 base window the console goes from about 868 × 482 to 756 × 420
  `[likely: computed from the insets, not measured]`.
- **3D view.** The stage fills the window and the dock overlays it, as the cord list does today
  `[verified: Boot.cs LayoutStage moves only the flat stage]`. While Chat is selected the camera
  frames the console in the area left of the dock.
- **Rejected:** the left drawer (covers the console); a bottom strip (leaves the console smaller
  than the side dock does); a separate OS window (splits keyboard focus, and adds a multi-window
  surface to the deferred Windows leg); chat drawn inside the 3D scene.

### The dock's states

| State | Status line | Transcript | Controls |
|---|---|---|---|
| No link | `not connected` | The setup card: what the chat does, that it needs a model of your own, where the guide is, a field for the link the server prints, Connect | Send off |
| Connecting | `connecting…` | Setup card | All off |
| Refused | The web pane's two reasons: token refused; another build than the server | Setup card | Connect on |
| Ready, no session | `connected` | One note: the model takes over the panel; one example request | Send on when the box has text |
| Request out | `session <run>` | Ends in `waiting for <route> · request <n> · <s> s` | Stop on, Send off |
| Reply landed | `session <run>` | Model entry: badge, text, calls with their output | As web |
| Error | unchanged | Error entry; an engine error ends the session and says End session unlocks the panel | End session on |
| Ended | `connected` | Note: the machine is live and unlocked | Send on |
| Connection lost | `disconnected` | Error entry: the run is marked invalid | End session on while the panel is locked; Connect on |

Enable rules are the web pane's (`src/pane/ui.ts`, `update`). Quitting the app mid-session is the
web's page reload: the server marks the run invalid `[verified: DECISIONS 2026-11-03, "Invalid
runs"]`.

### Focus

- Selecting Chat focuses the message box. Enter sends; Shift+Enter is a newline.
- Escape leaves the box. It never stops the model: Stop is a button.
- A new `chat_focus` action (suggested key `/`) selects Chat and focuses the box from the console.
- Stage and camera shortcuts already run only when no control has focus, and Escape already
  releases focus `[verified: Stage.cs HandleStageKey, OrbitCamera.cs _UnhandledKeyInput]`. So text
  typed in the box does not reach them `[verified: C0 run 2026-11-11, flat and 3D]`.
- The wheel over the dock scrolls the transcript and does not zoom. Stopping mouse events is not
  enough in 3D: `Control.MouseForcePassScrollEvents` defaults to true and lets the wheel through
  to the camera, so the dock root sets it false `[verified: C0 run 2026-11-11; Tom ruled
  the fix in, DECISIONS]`.
- Tab order: toolbar, column tabs, transcript, message box, route, Send, Stop, New session, End
  session. Every dock control has a tooltip and visible focus.

### The lock

From the session's `create` until End session:
- **Frozen:** simulated time moves only inside the model's calls. The frame loop renders and does
  not advance.
- **Locked:** panel controls, cord dragging, the cord list's buttons, the terminal picker, and
  Library, Blank panel, Reset and Profile apply nothing.
- **Free:** orbit, zoom, pan, Fit, Wire, the flat/3D toggle, Sound, Help.
- **Banner:** a strip across the top of the stage says the model has the machine, repeats the
  waiting line, and carries Stop and End session. It shows whichever tab is selected.
- **End session** hands the machine back live and unlocked, as a blank-panel session with the
  circuit still plugged in. Reset after that clears it, as on the web.

### Cord marks

After each `run` reply, the cords that call added are drawn with a mark in both views until the
next call, New session or End session. The engine's reply already names them
(`results[].cord` and `results[].cords`) `[verified: tools/hands/render.ts describeOk]`. The mark is
static: no motion, no simulated time. Its colour is one new presentation token that is not a cord
or lamp colour. Lamps, relays and controls get no mark.

A call that adds more than 12 cords shows no marks (Tom, 2026-11-12): in his hands-on session the
model plugged all 72 Tic-Tac-Toe cords in one call, and a ring on every cord picked nothing out.

### Sound

Relay and motor sound stay off while the lock is on. The teletype cue is one short burst, under a
second, when a call lands. It is interface sound: it plays outside the machine's audio router and
obeys the Sound mute. It ships only with a full record in `data/public-assets.json`.

### Parity with the web pane

| Web behaviour | Godot form |
|---|---|
| Transcript entries: user, model, note, error, working | Same |
| The model's reply shown as plain text | A small markdown subset rendered: bold, italic, code, code blocks, headings, bullets; links print as `text (url)`. The model's text is escaped first. Godot only (Tom, 2026-11-12) |
| Message box, 8,000-character cap from the server's `ready` | Same |
| Route select; Send, Stop, New session, End session | Same |
| Waiting line | Same text, also on the banner |
| Served-by badge, fallback highlight, cost, failed | Same |
| Calls shown open for `minivac_control`, folded for file tools | Fold buttons |
| Frozen and locked | Same rule; Godot adds the banner and keeps the camera free |
| Instant calls | Same. No remount: Godot redraws from the machine each frame `[likely: Boot.cs RenderConsole]` |
| Sound and trace blank during calls | Same, plus the teletype cue |
| Link in the page URL (`#t=<token>&port=<n>`) | Pasted into the setup card, or `--pane-link` |
| Reload ends the session | Quitting does |
| Pane drops under the console below 900 px | None; the banner covers a narrow window |
| ARIA labels and status role | Not carried (no screen-reader claim for Godot) |
| Run folder: `transcript.jsonl`, `run.json`, `session.json` | Unchanged; the server writes them |

## Facts this plan leans on

- `[verified]` Neither `dotnet/` nor `godot/` has any of `src/hands/` or `src/pane/engine.ts`.
- `[verified]` `godot/scripts/Session.cs` and `FrameLoop.cs` have no adopt, release, frozen or
  locked mode.
- `[verified]` The server admits a client on three checks: an Origin on its allowlist, its own
  Host, and the launch token in `hello` (`tools/hands-pane/server.ts`).
- `[verified]` `dotnet/Minivac.Godot.Tests/GodotBoundaryTests.cs` holds an allow list with one row
  per script; every new script needs a row.
- `[verified]` `P6AssetProvenanceTests.cs` pins the asset inventory at 7 records.
- `[verified: C0 run 2026-11-11]` Godot 4.7.2's `WebSocketPeer.HandshakeHeaders` sends an allowed
  Origin with no server change. `FALLBACK-GCP-ORIGIN` (.NET's `ClientWebSocket`) was not needed.
- `[verified: C0 run 2026-11-11]` Godot's socket buffers default to 65535 bytes each way and a
  larger frame fails. `FALLBACK-GCP-FRAME` is taken: both buffers are 4 MiB, the server's own
  `maxPayload`, set before `ConnectToUrl`. The largest frame is the `session` reply, which grows
  with the log (about 48 bytes a step); a 70-cord session's largest is 18,598 bytes.
- `[verified: tools/hands-pane/server.ts]` A web page and the Godot build can connect at once:
  each socket gets its own connection, session and run folder. This plan does not change it.
- The C0 record, with what Godot reports on each refusal, is in `docs/STATUS.md`, 2026-11-11.

## Phases

Each phase ends with its own tests green and both builds clean. The full gate runs once, in C6.

**C0 — Probes.** Record each result in `docs/STATUS.md` before C1 starts.
- The Godot socket client connects to the real pane server and passes all three checks.
- A frame the size of a 70-cord session's largest crosses each way intact.
- A focused text box keeps F, W, R, the arrows and +/− from the stage, in flat and 3D; the wheel
  over a mouse-stopping control does not zoom.
- A headless Godot run can hold the socket open (C6 needs it).
- Stops: any probe that fails takes its named fallback, or goes to Tom if it has none.

**C1 — The hands table and the engine in C#.**
- A new project `dotnet/Minivac.Hands/`, referencing `Minivac.Core` only: `replay`,
  `validateBatch`, `runBatch`, `stateView`, `sessionOf` and the engine of `src/pane/engine.ts`.
  No Godot types, no filesystem.
- **Transfer test (load-bearing):** a small console tool reads the engine's requests as JSON lines
  and writes its replies. A Vitest spec runs the 15 recorded sequences in `test/pane/fixtures/`
  through `src/pane/engine.ts` and through the tool, and requires equal replies, byte-identical
  rendered text and equal sessions.
- Port `test/hands/table.spec.ts` and `validate-batch.spec.ts` as xunit tests.
- An adversarial review before C2.

**C2 — Adopt, freeze and lock in the Godot session.**
- `Session` gains adopt and release; `FrameLoop` gains a render-only mode.
- The lock covers every path listed under "The lock", and survives the flat/3D toggle.
- **Zero-applies test (load-bearing):** a counting machine wrapper sees no command from a locked
  session while every panel control, the cord list, the picker and the four toolbar buttons are
  exercised, and the camera moves.
- Machine audio is reset on adopt and not driven while the lock is on.
- The banner, with its text and buttons wired to callbacks.

**C3 — The link and the socket.**
- Parse the server's printed link into token, port and origin (the C# of `readPaneLink`).
  `--pane-link <url>` gives the same link at launch, for tests.
- The socket client and the C# of `src/pane/protocol.ts`. A test reads `PANE_PROTOCOL` from the
  TypeScript source and fails if the C# constant differs.
- A transport seam with two implementations: the socket, and a scripted fake for tests.
- The server is not changed in this phase.

**C4 — The dock.**
- The column tabs, the dock, every state in the table above, the enable rules, the setup card.
- The flat inset and the 3D framing while Chat is selected; the `chat_focus` action.
- Allow-list rows for each new script.
- A `chat` acceptance suite on the fake transport: each state, keyboard-only operation, and the
  focus rules.

**C5 — Cord marks and the teletype cue.**
- Marks in the flat cord lines and the 3D cord meshes, from the last `run` reply. One new colour
  token; the token table's row-count gate moves with it.
- The cue: Tom picks it by ear from a synthesized candidate (a committed generator, so the hash is
  reproducible) or a CC0 source. Its record goes in `data/public-assets.json` and the inventory
  test's count moves. If Tom drops the cue, this bullet is deleted and nothing else changes.

**C6 — End to end, docs, hands-on.**
- Headless Godot against the real pane server with the scripted fake model the web e2e uses:
  wiring B1 lights lamp 1; the panel is locked during the session and live after End session; the
  exported `session.json` passes `checkItem` B1.
- The full gate, once.
- `tools/hands-pane/README.md` gains the Godot section; `docs/port/CSHARP-PORT.md` records the
  hands port; `docs/STATUS.md` and `docs/DECISIONS.md` are brought up to date.
- Tom uses the chat in the Godot build.

## Working choices (orchestrator, not Tom-approved)

- The dock is a tab in the right column, 360 px wide; the banner sits at the top of the stage.
- The link is the URL the server already prints, pasted as it is. Godot sends that URL's origin as
  its Origin, so the server needs no change and no second kind of client.
- The token is never saved. A lost connection is not retried; Connect is pressed again.
  (Superseded in part by Tom, 2026-11-12: a running server leaves its link in a file and the dock
  fills its field from it; `docs/DECISIONS.md`, "Godot chat pane: the link is filled in; the UI
  scales with the window".)
- Escape leaves the box; `/` focuses it.
- The hands port is its own project beside `Minivac.Core`, as `src/hands/` sits beside `src/core/`.
- The transfer test compares replies after JSON parsing and text byte for byte.
- The teletype cue has its own player in the chrome.

## Proposed done bar (Tom to set)

- The transfer test passes on all 15 recorded sequences.
- The C6 end-to-end run passes, and its session reproduces with `bin/minivac-check`.
- Tom has used the chat in the Godot build.
- **Not proposed:** the 12-item checklist ×3 from Godot. The checklist grades the model, the skill
  and the text; the transfer test shows Godot gives the model the same text. Tom's call.

## Out of this plan

- Voice input.
- Cord-by-cord animation, and marks on lamps, relays or controls.
- Cord marks in the web pane.
- A model loop inside the Godot process.
- The native Windows runtime leg: the chat is proven on the macOS proof host only.
- Public distribution of the Godot build, which still needs Tom's explicit approval.

## Execution (orchestrator plan, not Tom-approved)

- Roles and models follow `CLAUDE.md`, "Model policy". The orchestrator integrates and commits;
  workers never commit.
- C1 and C3 go to complex workers; C2 and C4 are built by the orchestrator or one complex worker
  each, in order, because they share `Boot.cs` and `Chrome.cs`.
- Adversarial reviews: after C1, and on the finished chat before the C6 run.
- One commit per phase; no push without Tom's say.
