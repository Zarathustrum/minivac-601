# Phase 4 S3 — review findings and remediation

Adversarial review of the Phase 4 P4 S3 commit (28 files, +1883/−125), run 2026-09-08 on a clean
tree. Four correctness defects (C1–C4) and three performance items (P1, P4, P5) were fixed at the
time. Everything else was recorded here unfixed, with the evidence needed to act on it.

**2026-09-08 follow-up:** Tom approved C5's proposed persistent wire-framing behavior. The fix
retains the 15° FOV through orbit, pan and dolly, clamps dolly to 0.6–0.639434 W, and uses Fit/R as
the exit to the normal 45° camera. A live `trace-equality` gate was proved red at 1/5 before the
fix and green at 5/5 after it. C6, C7, P2, P3, P6, P7 and S1–S12 remain as recorded.

Finding IDs are stable: `C*` correctness, `P*` performance, `S*` style. Test counts in this file
are the literal output of runs the orchestrator executed and read.

## Constraints the S3 fixes revealed

- **No Godot object can be constructed in `Minivac.Godot.Tests`.** `new StandardMaterial3D()` or
  `new QuadInput()` aborts the run with "Test host process crashed" — no exception, no stack.
  Public **static** members on Godot-derived partial classes *are* callable without the engine.
  That is why `QuadPointFromRay`, `ForwardsButton` and `Gesture.After` are statics. Use the same
  seam rather than concluding a thing is untestable; but when it genuinely needs a live tree, say
  so and record the gap instead of adding a vacuous gate.
- **The rule-7 allow-list is enforced both ways.** Adding a Godot API to a script requires the
  token in `GodotBoundaryTests.LiveAllowList` *and* in Appendix A of
  `docs/plans/phase-4-presentation.md`; the plan's own rule is that it is "amended here and in the
  dated record, never widened silently in the test." This gate caught a bad splice during this
  work — it earns its keep.

---

## Part 2 — Found and not fixed at review close

Ordered by value. Nothing here was committed at review close; all line numbers are as of the 2026-09-08 review close.

### Correctness

**C5 — FIXED in the approved 2026-09-08 follow-up. Wire view's 24 px framing survived no mouse
input; "Zoom In" shrank the panel 3×.**
`WirePose()` sets `Fov = CameraWireFovDeg` (15°) at dolly 0.639434 — the pose gate 3.2.9b solved
to land hole targets at exactly 24.000031 px. But `DollyBy` (`OrbitCamera.cs:60`), `PanBy` (`:70`)
and the orbit branch (`:92`) each unconditionally reassign `Fov = CameraFovDeg` (45°). Press `w`
then Zoom In: apparent scale goes 1/(0.639·tan 7.5°) = 11.89 → 1/(0.6·tan 22.5°) = 4.02, i.e. the
panel gets **2.96× smaller when you press Zoom In**, and hole targets fall from 24 px to ~8 px.
§PR-8 records 9.12 px as the best achievable anywhere on the dolly interval at 45°. Flat mode has
no such hole: `Stage.ZoomBy` clamps to `WireMinimumScale()`. The plan's key table called 3D `w`
"the same meaning" as flat's wire view; it was not. **Resolution:** `_wireFramed` now holds the
wire FOV and clamps dolly to `[CameraDolly.X, CameraWireDollyW]` until `ResetPose()`. Tom approved
that meaning; the new runtime gate drives zoom in, zoom out, pan, orbit and reset.

**C6 — The 3D→flat restore is unasserted and its apparent gate cannot fail.**
`Acceptance.cs:1066-1089`. `toggle-normalizes-panel` asserts only flat→3D. Nothing asserts the
panel returns to `FitPanel(stage.Size)` with the stage's scale and pan. Worse, the harness
manufactures its premise: it force-sets `flatStage.SetAnchorsAndOffsetsPreset(TopLeft)` and
`flatStage.Size = 800×600` before measuring, so a zero-size or mis-anchored `Stage2D` from
`MountStage` would be papered over and the gate would still pass. The reparenting itself **is
correct** — `Stage.ApplyTransform` writes all four properties `Stage3D.Initialize` clobbers, and
this was checked hard — but nothing pins it, and every other functional gate boots cold into one
mode. Only `trace-equality` toggles at all.

**C7 — Three latent items.**
`OrbitMath.WireDolly` (`:24-27`) clamps azimuth but substitutes raw constants for elevation and
dolly, and `WirePose` assigns the result unclamped. Safe today, but `P4OrbitMathTests.cs:62`
asserts the solved dolly against `CameraDollyMinW` = 0.45, a floor *below* the clamp envelope's
0.6 (see S2) — a future re-solve returning 0.55 passes the gate, ships as the token, and snaps on
the first wheel notch. Wrap in `ClampPose`, tighten the assert to `CameraDolly.Value.X`.
`OrbitMath.cs:49-50` uses int division for the screen centre (harmless today: `WorstExtent` takes
max−min so the centre cancels, and both test windows are even). `Project` derives `forward` from
`-camera`, hard-assuming the target is the origin, while `PanBy` moves `_target` — tests-only
today, needs a `target` parameter before anyone hit-tests with it.

### Performance

All measured against the per-frame render pass driven by `Boot.RenderConsole`. **P1, P4 and P5
are now fixed** — kept here with their evidence because the reasoning is the reusable part. P2,
P3, P6 and P7 remain open.

- **P1 — FIXED after review. `Diagnostics.Render` ran every frame into a hidden panel.** `Boot.cs:239` calls it
  unconditionally; `Chrome.cs:106` creates `DiagnosticsMount` hidden and only `OpenDrawer` shows
  it. With the drawer closed — the normal case — every frame walks 186 terminals doing
  `GetMeta("terminal").AsString()` plus two concats plus `Text` plus `TooltipText`, allocates a
  `List<string>`, then `ApplyLayout()` re-walks all 186 writing `Visible`/`Position`/`Size` and a
  theme-override font size each. ~1–1.5k allocations and ~1k interop calls per frame for pixels
  nobody sees. **Biggest single win in the app.** Gate on `DiagnosticsMount.Visible` in
  `RenderConsole` and render once from `OpenDrawer`; do not early-out inside `Render`, because
  `Acceptance.cs:385` reads `TerminalVoltages`. *As shipped:* gated on `DiagnosticsMount.Visible`
  in `RenderConsole`, with a new `Chrome.DrawerOpened` event rendering once on open so the panel
  is not stale. `Acceptance.RunSession` opens the drawer before asserting, so every gate stayed
  correct. New `3.2.3 diagnostics-on-open` check; session suite 8/8 → 9/9.
- **P2 — The SubViewport is 2880×1600 RGBA16F, ~40× oversampled, re-rendered every frame.**
  4.61 Mpx × 8 B/px ≈ 36.9 MB. The quad covers roughly 15% of a default 1152×640 window — ~110k
  screen pixels fed from 4.6M texels. `Acceptance.cs:1043` pins `RenderTargetUpdateMode == 2`
  (`UPDATE_WHEN_VISIBLE`), and the material samples the target every frame, so it is effectively
  `UPDATE_ALWAYS`. `StandardMaterial3D` defaults to `LINEAR_WITH_MIPMAPS` and a `ViewportTexture`
  has no mips: cache thrash plus shimmer. Suggested: 1440×800 (`Acceptance.cs:781` already
  exercises that size; `QuadMap`/`OrbitMath` are resolution-parameterised) and drop `UseHdr2D`
  until a glow pass exists. `Acceptance.cs:1042-1045` pins both and moves with them.
- **P3 — `PanelView.SetOccupied` touches all 392 holes every frame.** `Cords.cs:57-68` →
  `PanelView.cs:155-164`: a `List<string>` and `HashSet<string>` per frame, then
  `SetMeta("occupied", …)` on 392 buttons, each converting the literal to a `StringName` and
  boxing a bool. `HoleButton.Occupied` is already change-guarded, so only the `SetMeta` traffic is
  waste. Cache a `static readonly StringName` and keep the previous set for a `SetEquals`
  early-out.
- **P4 — FIXED after review. `RangeControl.Value` redrew unconditionally.** `Controls.cs:97-102` has no equality
  guard; its sibling `PanelButton.Lit` at `:44-52` does. Seven canvas items — including the dial's
  trig-heavy `_Draw` — re-rasterise every frame. **One line**, but the register's precondition was
  incomplete: `_Draw` *does* read state that changes without `Value` — `DrawFocusOutline` reads
  `HasFocus()`, and neither `AddRelay` nor `AddDial` wires focus to `QueueRedraw`. Measured on
  4.7.2: Godot's `Control` redraws once on focus enter and once on exit by itself, so the guard is
  safe and the outline does not freeze.
- **P5 — FIXED after review. `viewport/hdr_2d=true` was project-wide.** `project.godot:51` applies to the root window
  viewport and is redundant with the per-SubViewport flag. Negligible at 1152×640; 66 MB vs 33 MB
  with doubled blend bandwidth on a maximised 4K window. Removing it cannot affect the SubViewport:
  P0 spike check 8 (`docs/DECISIONS.md`, *P7 review amendments, 2026-09-08*) measured `project_only_UseHdr2D=False` against
  `explicit_UseHdr2D=True`, so a non-root SubViewport needs the explicit property and
  `Stage3D.cs:40` was always what satisfied the gate.
- **P6 — `PhysicsObjectPicking` is set globally and never cleared.** `Stage3D.cs:23` sets it on
  the root viewport; `MountStage` frees `_stage3D` on the flat toggle but never restores it, so
  the root keeps raycasting into an empty 3D space for the session. One line in the flat branch.
- **P7 — `Duplicate()` per forwarded event.** `QuadInput.cs` duplicates the event to rewrite its
  position. `use_accumulated_input` defaults true so motion merges to ~1/frame — ~60/sec while
  hovering, not per raw sample. Modest, but free to remove by mutating one reused instance;
  `PushInput` dispatches synchronously so reuse is safe. Also `PixelFromWorld` is computed before
  the gesture early-out, paying an `AffineInverse` per event during drags that discard it.

Checked and clean: no `_Process`/`_PhysicsProcess` in any 3D file, no LINQ or node lookups in any
per-frame path, `Machine.Observables()` returns a cached array despite ~166 calls/frame, MSAA off
everywhere, and the flat path's only per-frame cost is `RenderConsole`.

### Style

- **S1 — 12 of 26 `TactileTheme` tokens have zero consumers** anywhere in `godot/`, `dotnet/`,
  `src/` or `test/`: `CordColour`, `CordRadius`, `DtStep`, `ConvergeSteps`, `RebuildEpsilon`,
  `CordGravityWPerStep2`, `CordRelaxIterations`, `CordDamping`, `CordSlack`, `CordSegments`,
  `TubeSides`, `TaperPinGrey`. Two are worse than dead: **`dtStep` (240) and `convergeSteps` (480)
  are simulator parameters parked in a presentation theme.** The moment anything reads them the UI
  layer owns simulation timing — that is the `src/core` boundary. P5 will legitimately consume
  several of the cord tokens; land them with the code that reads them.
- **S2 — `CameraDollyMinW` (0.45) is referenced only by tests** (`P4OrbitMathTests.cs:62, :71`)
  while production clamps with `CameraDolly.Value.X` (0.6). The test asserts a looser bound than
  the shipped clamp enforces. Either the clamp is wrong or the token is; see C7.
- **S3 — The token registry is an abstraction built for one test.** `ITactileToken`,
  `TactileToken<T>`, `UntypedValue` (zero readers anywhere) and `Tokens` (read only by
  `TactileThemeTests`) sit over 26 constants. Project rule is data tables over class hierarchies.
- **S4 — `Chrome.Initialize` takes 21 parameters,** eight of them pure pass-through
  (`Chrome.cs:45-51` null-checks and `:132-139` forwards them, never using one). Four are
  structurally identical bare `Action`s distinguished only by position — transpose `panUp`/
  `panDown` and nothing catches it. Cause is avoidable: `SetView` and `ZoomBy` already match
  across both stages, only `PanBy` diverges (`Stage.PanBy(Vector2)` vs
  `Stage3D.PanBy(float, float)`). Align that signature and `Boot` hands `Chrome` three delegates
  instead of eight.
- **S6 — The quad mapping is written four times.** `QuadMap.PixelFromWorld` is the production
  copy; its inverse is hand-rolled identically at `Acceptance.cs:1556-1563`,
  `P4QuadMapTests.cs:89-96` and `P4OrbitMathTests.cs:139-146`. Any change to the convention
  desyncs the acceptance harness from the thing it certifies. **`P4QuadMapTests`'s
  `QuadMap_has_only_the_specified_public_member` (`:78-87`) asserts by reflection that `QuadMap`
  has exactly one public method — its only effect is to fail when someone adds the
  `WorldFromPixel` that would collapse the duplication.** Drop it. (This is also why `QuadPointFromRay`, the static that
  intersects the camera ray with the quad plane so an off-quad drag release resolves `Outside`,
  went on `QuadInput` rather than `QuadMap`.)
- **S7 — Vacuous gates.** `GodotBoundaryTests.cs:543` filters to six files that do not exist —
  `PopOuts.cs`, `CordMesh.cs`, `Case3D.cs`, `Knob3D.cs`, `Relay3D.cs`, `Bezels.cs` — then asserts
  `Empty` over an empty set. `Acceptance.RunPopouts` (`:1155-1162`) counts colliders under nodes
  never created. `Acceptance.cs:1038` tests three non-nullable, unconditionally assigned
  properties for null. **P5/P6 will create several of those six files — these gates start biting
  the moment you do, and they have never actually run.**
- **S8 — `Acceptance.cs:824` pins a leftover observation:**
  `Math.Abs(minimumHoleExtents[1] - 15.12f) <= 0.01f`, reported as `temp-observation=…px`. Fails
  on any layout tweak, for no stated reason.
- **S9 — Magic 24 px where `Stage.MinimumHolePixels = 24.25` already exists** (used at
  `Stage.cs:104`). New code writes bare `24` at `Acceptance.cs:791` and `P4OrbitMathTests.cs:63,
  :83, :94` — ignoring the constant and disagreeing with it by 0.25. This is the one number in the
  commit with a real normative basis.
- **S10 — Provenance defects.** `cameraWireDollyW = 0.639434` carries `Source = "engineering
  token"`, but that six-decimal value is the output of `P4OrbitMathTests.SolveWireDolly`, a
  bisection against a 24 px floor at 1440×900. Nothing says so, so anyone changing FOV, elevation
  or window size cannot know it must be re-solved. `TaperPinStub` (0.008, a taper-pin dimension)
  is used as the Z-depth of the panel picking box at `Stage3D.cs:62` — an unrelated quantity
  borrowed for its magnitude.
- **S11 — Dead members.** `QuadInput.Dragging` has zero readers (the property declaration is its
  only occurrence in the repo); it is now load-bearing internally via `_dragging` in the
  pairing guard that refuses any release whose press `QuadInput` did not forward, but the public accessor is still unused. `Stage3D.World` is read only by a
  non-null check.
- **S12 — Two key-dispatch conventions in one if/else chain.** `Stage.cs:109-133` matches
  `+`/`-`/arrows/`0`/`home` via `key.AsText().ToLowerInvariant()` while the two newer branches use
  `IsActionPressed`. Asymmetric too: `view_toggle` calls `SetInputAsHandled()`, `wire_view` does
  not.

### Traps

- **`Free()` → `QueueFree()` in `Boot.MountStage` is not a drop-in.** `AddChild` happens before
  `Name = "Stage2D"`/`"Stage3D"` (`Boot.cs:307-315` vs `Stage.cs:32`, `Stage3D.cs:22`), so a
  deferred free leaves the old node in the tree and Godot renames the new one `Stage2D2` —
  breaking `Acceptance.Node<T>`'s `FindChild` by name and leaving the old stage's
  `_UnhandledKeyInput` live an extra frame. Rename before `AddChild` and null the field before
  deferring. The current immediate `Free()` is safe only by accident: it can run with
  `OrbitCamera._UnhandledKeyInput` on the stack, and both paths happen to `return` straight after.
- **`Chrome._Notification` tests `Control.NotificationResized` on a `CanvasLayer`** (`Chrome.cs:156-159`),
  which never receives it. Chrome only relayouts on `NotificationReady` and explicit `Relayout()`,
  so window resizes leave the toolbar, cord list and drawer stale in **both** modes. Pre-existing,
  not from the S3 commit.

### Withdrawn

Recorded so they are not re-raised. `cordColour`'s citation of `main.css:197` is **correct** —
line 197 is `stroke: #cf5c4c;`; an off-by-one claim against it was checked and dropped.

---

## Suggested order

1. ~~**C5** — needs your design call on what `w` means in 3D.~~ Done in the approved 2026-09-08
   follow-up; `trace-equality` now pins all five transitions.
2. ~~**P1, P4, P5**~~ — done after review. **P3** (`SetOccupied`, 392 holes
   per frame) is now the largest remaining per-frame cost, then **P2** (SubViewport oversampling).
3. **S1/S2 + C7** — resolve the 0.45-vs-0.6 disagreement while deleting the dead tokens.
4. **S7 + S6** — delete the vacuous gates and the shape-assertion test *before* P5 creates the
   files they name.
5. **C6** — pin the 3D→flat restore while the reparenting code is still fresh.
