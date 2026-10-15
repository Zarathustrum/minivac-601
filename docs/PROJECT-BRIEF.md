# Project brief — Minivac 601 interactive simulation

## What we are building

A faithful, playable simulation of the **Minivac 601**: the 1961 electromechanical
relay-logic educational computer sold by Scientific Development Corporation and marketed
as a private project of Claude Shannon. Six relays, six lamps, six pushbuttons, six slide
switches, a 3×3 matrix, a 16-position motorized decimal dial, and a panel of tapered-pin
jacks you wire with patch cords.

Web first (TypeScript, Vite, browser), plus a Godot 4 desktop build off the same core through a
C# port (Godot superseded Unity, `docs/DECISIONS.md` 2026-09-03).

There is no unit and there are no personal manuals — every fact comes from scans and
photographs.

## Delivery phases

Each phase ends with something runnable.

1. **Core + conformance + inspector.** DOM-free relay simulator, frozen command/state
   schemas, golden conformance fixtures from the manuals, and a bare inspector page
   (jack grid, lamps, switches) that can run a manual circuit.
2. **The console.** Period-accurate web UI: draggable patch cords, relay and ratchet
   sound, lamp behaviour, the pre-wired demo programs.
3. **Engine port.** A proven C# port of the core passing the same fixtures, and a Godot proof
   build (`docs/DECISIONS.md` 2026-09-03; it replaced the Unity handoff document set).
4. **Tactile and 3D presentation** on the Godot build (`docs/DECISIONS.md` 2026-09-04).
5. **Full-corpus conformance.** Conformance fixtures across the whole program corpus
   (`docs/DECISIONS.md` 2026-10-13).

## Step 0 — the questions, and Tom's answers (2026-08-30)

**1. Unity strategy.** Options were (a) a TypeScript reference core with a formal
state/command schema and a golden conformance suite, making a C# port mechanical and
verifiable; (b) running the TS core inside Unity via a JS runtime or WebView; (c) driving
Unity over a local socket.
→ **(a).** Six relays and a jack grid do not justify an embedded JS runtime or an IPC hop,
and both would cost the determinism the conformance suite depends on.

**2. Fidelity.** Relay-level (coils, contacts, pull-in/drop-out timing, rotary mechanics)
versus logic-level (boolean net solve, instant settle).
→ **Relay-level, discrete-time tick.** The manuals' counters and games depend on
transfer-time behaviour; a logic-level model would agree on steady states and be a
different machine. The feel is relays clacking in sequence.

**3. Model/version.** 601 only, or 601 plus the 6010's differences.
→ **601 only.** The 6010 is a documented deferral.

**4. Feel.** How far to go on sound, lamp glow, cord rendering, and console typography in
the web build, given 3D comes later. Offered: *schematic* (clean, no chrome),
*period-accurate flat* (correct panel art, sampled sound, static cords), *tactile*
(cord sag, layered audio, lamp bloom).
→ **Period-accurate flat for Phase 2**; tactile deferred to the 3D version.

**5. Demos.** Which manual programs ship pre-wired, and does Tom have a unit or manuals?
→ Ship the candidate set: binary counter, tic-tac-toe, the dating machine, dice, the
logic-gate demos, the burglar alarm, the two-relay flip-flop. **No unit, no manuals.** All
sources are web scans.

**6. Audience.** Tom alone, family, or public.
→ **Public.** The UI has to work for someone who has never seen a patch panel, which sets
the tutorial and help depth. A public deploy needs Tom's explicit approval.

## Mid-session rulings

**Existing emulator — oracle only (2026-08-30).** Greg Sadetsky shipped a browser Minivac
601 simulator in November 2025: TypeScript, no declared licence, with a test suite. Tom's ruling:
**nobody reads its source.** We build from the manuals and use the running app only as an
external behavioural check. Reading it would make our core partly derivative and the Unity
port would inherit that. Every research agent carries this rule.

**Engine target — Godot, not Unity (2026-09-03).** Tom redirected the engine port to Godot 4.
Every "Unity" in this file — the Deterministic-core Constraint below included — reads as "the
engine port". The
Step 0 answer (a) and every constraint stand unchanged in substance. Only the engine target itself
is settled; Phase 3's shape was re-scoped from a handoff document set to a proven C# port plus
a Godot desktop application, and Tom settled that scope the same day (`docs/DECISIONS.md`,
*2026-09-03 — engine target: Godot supersedes Unity*). The plan is `docs/plans/phase-3-godot.md`.

## Constraints

- Simplicity first. No plugin systems, event buses, or device frameworks for a machine with
  six relays. Data tables over class hierarchies.
- Every modelled electrical behaviour cites the manual page or photograph it came from.
  Anything `[unverified]` gets a named fallback and an entry in `open-questions.md`.
- Deterministic core: same wiring plus same inputs produces the same trace, always. This is
  what makes both the conformance suite and the Unity port possible.
- Never invent panel geometry or jack numbering. If the scans do not settle it, say so.
