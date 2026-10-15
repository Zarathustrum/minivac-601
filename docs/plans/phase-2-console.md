# Phase 2 — the console

Status: complete. Phase 2 stopped before Phase 3 or public deployment.
This plan delivers the Phase 2 product named in `docs/PROJECT-BRIEF.md`: a runnable,
period-accurate flat web console with draggable patch cords, relay and rotary mechanism sound,
lamp behaviour, public help, and the settled demo set. It does not start Phase 3.

> **2026-09-03:** §1.2's "No Unity code or C# port guide. Those are Phase 3." now reads Godot; the
> engine target changed by `docs/DECISIONS.md` (2026-09-03) and Phase 3 is `phase-3-godot.md`.

Binding inputs are `docs/PROJECT-BRIEF.md`, `docs/DECISIONS.md`,
`docs/research/panel.md`, `docs/research/programs.md`, `docs/research/components.md`,
`docs/research/rotary.md`, and the implemented Phase 1 architecture. When those sources disagree,
`DECISIONS.md` wins; a research catalogue does not silently expand a settled product decision.

---

## 1. Scope rulings

### 1.1 What ships

- One runnable MINIVAC 601 web console, replacing the Phase 1 inspector as the default page.
- A fixed-geometry 1.80:1 panel redraw based on PH2, with the three-plate teal/dark construction,
  six repeated section channels, MATRIX/POWER/DECIMAL blocks, all 186 terminals and 392 holes,
  twelve working lamps, six relays, six pushbuttons, six slide switches, power controls, and the
  continuous rotary dial.
- Flat SVG patch cords. Either endpoint can be dragged between holes, left free, or held against a
  terminal. Connected cords have no sag or physics; only the active drag preview follows a pointer.
- Relay and rotary-mechanism audio cues from provenance-cleared samples. The samples are simulation
  cues, not authenticated recordings of a MINIVAC. Buttons make no sound.
- Continuous lamp intensity from the core's existing `milli` values, including warm/dim transitions.
- Public onboarding, control help, demo instructions, source/confidence disclosure, reset, the
  default-on marginal-behavior control (`MV601-REF-A` on a fresh document and `MV601-IDEAL` as the
  forgiving choice), mute, zoom/pan, and a keyboard/mobile terminal picker.
- An access and geometry envelope, at 1440×900, 768×1024 and 390×844: every control has an
  accessible name, visible focus and keyboard operation; reduced motion is honored; wire view gives
  jack hit targets of at least 24×24 CSS px; the console aspect stays in 1.78–1.82 and the page
  never scrolls horizontally. `playwright.config.ts` sets the three viewports and
  `test/browser/console.browser.ts` enforces the rest.
- Eleven production demo entries covering the seven categories Tom settled:

  | Public entry | Source program | Connections |
  |---|---|---:|
  | Original three-bit counter | `IV-EXP1` | 44 |
  | SDC alternate three-bit counter | `ER-ALTCOUNTER` | 48 |
  | Tic-Tac-Toe | `VI-TICTACTOE` | 72, including two free play ends |
  | Mate Selection | `V-JOBSELECT` repeated across six sections | 30 |
  | Four-sided die | `VI-RANDOM`, reusing `VI-FORTUNETELLER` | 40 |
  | Relay AND | `III-RELAYAND` | 10 |
  | Relay OR | `III-RELAYOR` | 11 |
  | Relay NOT | `III-RELAYNOT` | 6 |
  | Relay XOR | `III-RELAYXOR` | 11 |
  | Burglar Alarm | `V-EXP2` | 16 |
  | Two-relay flip-flop | `IV-FF2` | 14 |

`IV-FF2` is the flip-flop mapping because it is image-verified and has the strongest printed
three-step procedure. The dating and dice labels are application names for the printed
Job/Mate Selection and four-outcome Random Number Generator circuits; they do not invent a second
wire list or a six-sided result.

Both counters appear adjacent in the library and render the exact public explanation frozen in
`DECISIONS.md` D2. The UI must not claim that this implementation reproduces the physical cause of
SDC's documented marginality.

### 1.2 What does not ship

- No 6010 layout or behavior.
- No cord sag, cord collision, layered audio, lamp bloom, 3-D materials, or tactile simulation.
- No public deployment. A public build is required; publishing it still needs Tom's approval.
- No Unity code or C# port guide. Those are Phase 3.
- No source or assets from either existing emulator.
- No expansion to every program in `programs.md` §2.4 or the full 98-record corpus. The eleven
  entries above are the complete settled Phase 2 demo inventory.
- No Book VII capacitor program and therefore no capacitor element, netlist mutation, or
  `FITTED-CAPS` branch.
- No speculative back-EMF, inertia, torque, or dynamical braking model. The implemented voltage
  rate law and two explicitly unverified coast-angle fallbacks remain authoritative. Phase 2 tests
  them only through source-pinned demo smoke/invariants; it does not claim motor conformance or
  invent missing motor constants. This is the dated Phase 2 ruling in `DECISIONS.md`, which
  supersedes the stale Phase 1 handoff sentence requiring a 1.2 motor-conformance bump.

### 1.3 Contract and schema ruling

Core Contract `1.1.0`, trace format 1, `minivac.fixture/1`, `minivac.netlist/1`, and
`minivac.profile/1` remain unchanged. Existing commands already express every Phase 2 interaction:
`connect`/`disconnect`, `hole`/`touch`/`free`, all controls, relay hand operation, and continuous
dial hand operation.

Dragging preserves a `CordId` by applying `disconnect` then `connect` before the next solve, exactly
as the Phase 1 inspector does. Demo selection creates a fresh Machine in the composition root; it
does not add `session()` or reset state to the core. Audio consumes existing Events in the adapter.

The demo library gets its own closed application schema, `minivac.demo-library/1`. It is not a
fixture schema: Tier D content must not gain invented `expect` blocks or goldens.

---

## 2. Architectural boundaries

### 2.1 Core remains frozen

No Phase 2 module changes `src/core/**`. If implementation discovers a real need for a core field,
command, Event, element, or observable, that wave stops and records the versioning case before any
contract edit. Presentation convenience is not such a need.

### 2.2 Composition root owns construction

`src/main.ts` owns raw netlist/profile/demo imports, validation, Machine creation, profile changes,
and fresh-session replacement. `src/ui/**` may import only the frozen contract/trace surfaces and
other UI modules. UI tests extend the exact boundary allowlist rather than weakening it broadly.

`startFrameLoop` returns a cancellation function. Replacing a demo or profile cancels the old loop,
disposes its audio routing, and mounts exactly one fresh session; no old Machine advances afterward.

### 2.3 Panel renderer

`src/ui/panel-layout.ts` is one normalized, source-traceable layout table generated from six
repeated section channels plus explicit MATRIX, POWER, and DECIMAL blocks. It binds placements to
validated terminal ids and contains no electrical meaning.

The table owns a frozen `region` and normalized placement for every terminal plus a frozen
legend/linework inventory. For each section `n`, BINARY OUTPUT owns `nA,nB`; the power stripe owns
`n+,n-`; STORAGE/PROCESSING owns `nC,nE,nF,nG,nH,nJ,nK,nL,nN`; the auxiliary stripe owns
`ncom,ncap`; SECONDARY STORAGE owns `nR,nS,nT,nU,nV,nW`; and BINARY INPUT owns `nX,nY,nZ`.
The right power stripe owns `M+,M-`; MATRIX owns `M1t..M9t`, `M1b..M9b`, `M10`, and `M11`;
DECIMAL owns `D0..D19`; POWER controls own no terminal. These are panel identities, not electrical
meaning. Every rendered control carries its frozen section/terminal identity; handlers derive
commands from that identity, never from visual index or DOM order.

The console itself never responsively reflows. A `.console-stage` fits, pans, and zooms the fixed
1.80:1 surface. Diagnostics, demo selection, tutorial, and help live outside the historical panel
in a toolbar/drawer. DOM/CSS renders controls, lamps, print, and jack rings; small inline SVG layers
render fixed linework and cords. No raster photograph is shipped as panel art.

The palette is an explicitly approximate PH2-derived teal/dark/cream/red set. Panel text uses a
heavy, wide system grotesque; exact RGB values, typeface, coating/substrate, mounting-disc function,
and rotary-knob colour/form remain unresolved and are disclosed as such. No webfont or texture is
required.

The redraw is procedural, but its measured geometry and visual facts remain derived from PH2.
The frozen horizontal redraw tokens are left-field edge `0.716`, right-column edge `0.728`, and
six-channel pitch `0.113`; the PH2 colour/terminal census and uncertainty are recorded in
`panel.md` §3. They are `[unverified]` photograph proportions, not dimensions.
`data/public-assets.json` pins the local source path, upstream URL, creator, licence, capture date,
SHA-256, purpose, and derivative status. It records PH3 as corroboration and the PH1/PH4 exclusions.
No source raster is shipped as panel art, and no external font or texture ships without an
equivalent provenance record.

### 2.4 Demo library

Each record carries:

- stable id, public title/category, source locator, confidence, and applied errata;
- an ordered corrected connection list, including free ends and optional cord resistance;
- initial switch, button, relay-hand, dial, and power state;
- concise public instructions and control labels;
- optional frozen public notice, used by the counter pair;
- no expected trace for Tier D.

A terminal-only source connection receives the lowest free hole in frozen terminal order. The
loader fails on over-capacity, unknown terminals, duplicate ids, an occupied hole, or a direct
unloaded PLUS-to-MINUS short. Fixture-backed demo wires are compared against their production
fixture sources so the copies cannot drift independently.

A fresh document selects `MV601-REF-A`. The public control exposes exactly REF-A and IDEAL, labels
both as unmeasured simulator profiles, and never describes the selection as the cause of SDC's
hardware result. Demo load and reset retain the current selection. Changing it constructs a fresh
Machine with identical demo data. Profile selection is not persisted in Phase 2, so a new document
again starts with REF-A; only mute preference persists.

### 2.5 Cord interaction

Pointer capture supports mouse, touch, and pen. Keyboard users and small screens use a searchable
terminal picker. Every `{k:'free'}` endpoint is rendered in a deterministic UI-owned cord-tray slot
ordered by `(CordId, a-before-b)`. That position is presentation state and never enters `CordEnd`,
Machine State, the demo schema, or trace. A valid hole drop reconnects the end. An explicit `Free`
action or drop on the labelled cord tray reconnects it as `{k:'free'}`. Escape, pointer cancellation,
an occupied target, or any other release outside a valid hole or the cord tray restores the exact
prior endpoint. Pointer movement changes preview state only.

Manual mode exposes Add Cord and Remove Cord. Add Cord chooses the lowest unused `CordId` and
creates two tray-anchored free ends; Remove Cord issues `disconnect`. A free play end may be picked
up from its tray slot and used in momentary Touch mode. `MM-RLY-CHECK` is a manual-wiring acceptance
circuit, never a demo-library record.

Touch mode is explicit and momentary: while held over a terminal it applies `{k:'touch'}`, occupies
no hole, and returns to `free` on release. Hover alone never conducts. Pointer movement updates only
UI preview state and never floods the command queue.

### 2.6 Sound and lamps

The adapter routes `relay.pullIn` and `relay.dropOut` to the relay sample once each in frozen Event
order. A separate motor/drive-wheel sample follows transitions in `State.dial.mrpm`: start, stop,
and direction change, with playback rate bounded by speed. It does not click at `dial.make` or
`dial.break` and is not described as evidence of a physical ratchet: research finds no detent,
ratchet, index spring, or click stop. Manual relay motion has no threshold Event and therefore no
invented impact cue.

Relay cues are scheduled from `Event.t`, preserving monotone simulated onset times through a
catch-up frame instead of collapsing a sequence into one audible burst. Motor state is coalesced to
the final `mrpm` transition for that frame; intermediate start/stop changes are not queued.

Audio unlocks only from a user gesture, starts muted when browser policy requires it, persists the
mute preference locally, and drops cues while muted/suspended rather than bursting them on resume.
Audio never changes Machine state, ticks, or trace.

Lamp lens luminance is a monotone projection of `milli`, with `cls` retained for accessible text.
The twelve output/relay indicators use red lenses in white/cream bezel rings. The POWER indicator
is a distinct, smaller factory red translucent jewel in the `panel.md` §11 fallback cream bezel on
the knurled threaded barrel shown by PH3; it is not reused from the twelve-lamp component. PH2's
black FUSE cap is an owner modification and is not rendered. The POWER jewel is a disclosed binary
UI projection: lit iff `State.railMv > 0`, dark iff `State.railMv === 0`; it is not described as
modeled lamp current or intensity. There is no bloom layer.

