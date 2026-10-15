/**
 * The solver: stamp, dense LU, the arc pass, branch currents, carried state.
 *
 * Architecture §3.1 (node model and the datum), §3.2 (a tick, steps 3-6), §3.3 (the stamping
 * table and the companion equations), §3.4 (LU and the lamp filament). Determinism rules 2, 3, 4,
 * 5, 11, 14 and 16 all land in this file.
 *
 * The solver sees only an element array over small non-negative integer node ids. `graph.ts`
 * builds that array from the netlist, patch cords and contact positions, unioning closed contacts
 * and zero-ohm connections into super-nodes first; tools and tests may also hand-stamp one. A
 * closed contact is two element ends sharing a node id — contacts do not exist here.
 *
 * Nothing in this file calls a transcendental, reads a clock, or iterates a Map or a Set.
 */

export interface CoilEl {
  k: 'coil';
  a: number;
  b: number;
  rOhm: number;
  lH: number;
}
export interface LampEl {
  k: 'lamp';
  a: number;
  b: number;
}
export interface ResEl {
  k: 'res';
  a: number;
  b: number;
  rOhm: number;
}
export interface SourceEl {
  k: 'source';
  a: number;
  b: number;
  vOc: number;
  rSrcOhm: number;
}
export type El = CoilEl | LampEl | ResEl | SourceEl;

/** Amps -> ohms. `xs` strictly increasing. Architecture §3.4's 33-breakpoint tungsten table. */
export interface Pwl {
  xs: readonly number[];
  ys: readonly number[];
}

export interface SolveCfg {
  /** tick_us * 1e-6. */
  dtS: number;
  /** Volts. The arc clamp, `V_arc_clamp_mv * 1e-3`. */
  vArc: number;
  /** dtS / (tauS + dtS), computed by the caller at profile load (§3.4). */
  kThermal: number;
  /** Siemens. Stamped on the diagonal of every solved row only (§3.1.5). */
  gminS: number;
  /** The shared lamp table. */
  pwl: Pwl;
  /** The node id that contains MINUS. Eliminated from the matrix; its voltage is 0 (§3.1.2). */
  datum: number;
}

/**
 * The two carried doubles of determinism rule 11, each indexed by the order of appearance of that
 * element kind in the element array. The caller seeds `rLamp` (cold start = R_cold); the solver
 * never resets it.
 */
export interface Carried {
  iCoil: Float64Array;
  rLamp: Float64Array;
}

export interface TickResult {
  /** Per node id. 0 at the datum, NaN at floating nodes. */
  v: Float64Array;
  /** Per node id. 1 = pruned: no element path to the source component (§3.1.4). */
  floating: Uint8Array;
  /** Per element index, amps, from the companion equations of §3.3 (determinism rule 16). */
  branchI: Float64Array;
  /**
   * True iff the SECOND solve of §3.2 step 5 ran — nothing else sets it. It says a coil branch
   * exceeded the clamp in pass 1 and the system was re-stamped and re-solved. It does not say a
   * coil released, and it is not implied by `openRamp`: a circuit whose only open coil is pruned
   * runs exactly one solve and reports `arcPass: false`.
   */
  arcPass: boolean;
  /**
   * True iff at least one coil pruned at BOTH ends took the `V_arc * dt / L` hand-ramp from a
   * non-zero carried current (see the pruned-element block in `tickSolve`). That path never
   * touches the matrix, so it is a different mechanism from `arcPass` and is reported separately.
   */
  openRamp: boolean;
  /** NaN seen in a solution vector (determinism rule 14). Reported, never thrown. */
  nonPortable: boolean;
}

/**
 * The fourteen power terminals collapse to two nodes before user wiring, leaving 174 base nodes.
 * Eliminating the datum leaves 173 rows, and 22 fixed elements plus 256 live CordIds gives 278
 * elements. Loops use the active counts; these capacities are structural bounds, not occupancy.
 */
export const SOLVE_MAX_NODES = 174;
export const SOLVE_MAX_ROWS = 173;
export const SOLVE_MAX_ELEMENTS = 278;

/** Caller-owned fixed-capacity scratch and result storage for the allocation-free tick path. */
export interface SolveWorkspace {
  readonly v: Float64Array;
  readonly floating: Uint8Array;
  readonly branchI: Float64Array;
  nodeCount: number;
  elementCount: number;
  rowCount: number;
  arcPass: boolean;
  openRamp: boolean;
  nonPortable: boolean;
  /** @internal */ readonly _a: Float64Array;
  /** @internal */ readonly _j: Float64Array;
  /** @internal */ readonly _x: Float64Array;
  /** @internal */ readonly _rowOf: Int32Array;
  /** @internal */ readonly _inSource: Uint8Array;
  /** @internal */ readonly _arcOn: Uint8Array;
  /** @internal */ readonly _rowStride: number;
}

class SolveBuffers implements SolveWorkspace {
  readonly v: Float64Array;
  readonly floating: Uint8Array;
  readonly branchI: Float64Array;
  nodeCount = 0;
  elementCount = 0;
  rowCount = 0;
  arcPass = false;
  openRamp = false;
  nonPortable = false;
  readonly _a: Float64Array;
  readonly _j: Float64Array;
  readonly _x: Float64Array;
  readonly _rowOf: Int32Array;
  readonly _inSource: Uint8Array;
  readonly _arcOn: Uint8Array;
  readonly _rowStride: number;

  /** @internal Compatibility wrappers may request smaller transient buffers; the public factory does not. */
  constructor(
    nodeCapacity = SOLVE_MAX_NODES,
    rowCapacity = SOLVE_MAX_ROWS,
    elementCapacity = SOLVE_MAX_ELEMENTS,
  ) {
    this.v = new Float64Array(nodeCapacity);
    this.floating = new Uint8Array(nodeCapacity);
    this.branchI = new Float64Array(elementCapacity);
    this._a = new Float64Array(rowCapacity * rowCapacity);
    this._j = new Float64Array(rowCapacity);
    this._x = new Float64Array(rowCapacity);
    this._rowOf = new Int32Array(nodeCapacity);
    this._inSource = new Uint8Array(nodeCapacity);
    this._arcOn = new Uint8Array(elementCapacity);
    this._rowStride = rowCapacity;
  }
}

export function createSolveWorkspace(): SolveWorkspace {
  return new SolveBuffers();
}

/**
 * The pinned interpolation of architecture §3.4. Linear scan from index 0, first j with x <= xs[j],
 * ties take that j, clamped at both ends. `+ - * /` only — `Math.pow` is not required to be
 * correctly rounded and V8 and .NET disagree in the last ulps, which is why the lamp law ships as
 * a table rather than as a formula.
 */
export function pwlLookup(pwl: Pwl, x: number): number {
  const xs = pwl.xs;
  const ys = pwl.ys;
  const last = xs.length - 1;
  // NaN first, before any comparison. Every relational operator below is false for NaN, so the two
  // clamps fall through and the segment scan leaves j at 0, which then reads `xs[-1]` — undefined,
  // and the interpolation returns NaN. `noUncheckedIndexedAccess` does not catch that: the `as
  // number` casts throughout this function are exactly what defeats it. The consequence is not a
  // bad answer for one tick, it is permanent: the caller feeds the result back as the carried
  // filament resistance (rule 11), so one NaN poisons that lamp for the rest of the run. NaN in
  // means the cold clamp out — the same answer as x <= xs[0].
  if (Number.isNaN(x)) return ys[0] as number;
  if (x <= (xs[0] as number)) return ys[0] as number;
  if (x >= (xs[last] as number)) return ys[last] as number;
  let j = 0;
  while (x > (xs[j] as number)) j++;
  const x0 = xs[j - 1] as number;
  const x1 = xs[j] as number;
  const y0 = ys[j - 1] as number;
  const y1 = ys[j] as number;
  const t = (x - x0) / (x1 - x0);
  return y0 + t * (y1 - y0);
}

/** Allocation-free generic entry point over a caller-provided active element prefix. */
export function tickSolveInto(
  els: ArrayLike<Readonly<El>>,
  elementCount: number,
  carried: Carried,
  cfg: SolveCfg,
  sourceEnabled: boolean,
  workspace: SolveWorkspace,
): SolveWorkspace {
  return tickSolveCore(els, elementCount, carried, cfg, sourceEnabled, workspace, undefined, undefined);
}

interface GraphSolveInput {
  readonly elements: ArrayLike<Readonly<El>>;
  readonly elementCount: number;
  readonly nodeCount: number;
  readonly datum: number;
  readonly inSource: ArrayLike<number>;
  readonly sourceEnabled: boolean;
}

/** Allocation-free graph entry point; the built graph is the one authoritative source mask/gate. */
export function tickSolveGraphInto(
  graph: GraphSolveInput,
  carried: Carried,
  cfg: SolveCfg,
  workspace: SolveWorkspace,
): SolveWorkspace {
  return tickSolveCore(
    graph.elements,
    graph.elementCount,
    carried,
    cfg,
    graph.sourceEnabled,
    workspace,
    graph.inSource,
    graph.nodeCount,
    graph.datum,
  );
}

function tickSolveCore(
  els: ArrayLike<Readonly<El>>,
  nEls: number,
  carried: Carried,
  cfg: SolveCfg,
  sourceEnabled: boolean,
  workspace: SolveWorkspace,
  authoritativeInSource: ArrayLike<number> | undefined,
  authoritativeNodeCount: number | undefined,
  authoritativeDatum = cfg.datum,
): SolveWorkspace {
  if (!Number.isInteger(nEls) || nEls < 0 || nEls > els.length) {
    throw new Error('solve: elementCount must be within the element array');
  }
  if (nEls > SOLVE_MAX_ELEMENTS) throw new Error('solve: more than 278 elements');
  workspace.elementCount = nEls;
  workspace.nodeCount = 0;
  workspace.rowCount = 0;
  workspace.arcPass = false;
  workspace.openRamp = false;
  workspace.nonPortable = false;
  // The datum indexes `rowOf` and `inSrc` and sets the floor on `nodeCount`, so it is range-checked
  // exactly like an element endpoint. Unchecked, a large datum both allocates a huge result array
  // per tick and writes past the two scratch arrays, silently, because typed arrays drop
  // out-of-range stores instead of throwing.
  if (
    !Number.isInteger(authoritativeDatum)
    || authoritativeDatum < 0
    || authoritativeDatum >= SOLVE_MAX_NODES
  ) {
    throw new Error('solve: datum node id out of range');
  }

  // --- Determinism rule 2: the source is stamped last. That is the circuit author's duty, and
  // --- it is asserted rather than assumed, because getting it wrong changes every golden byte.
  let srcIdx = -1;
  for (let e = 0; e < nEls; e++) {
    if ((els[e] as El).k === 'source') {
      if (e !== nEls - 1) throw new Error('solve: a source element must be last in the element array');
      srcIdx = e;
    }
  }

  let nodeCount = authoritativeNodeCount ?? authoritativeDatum + 1;
  if (
    !Number.isInteger(nodeCount)
    || nodeCount < 1
    || nodeCount > SOLVE_MAX_NODES
    || authoritativeDatum >= nodeCount
  ) {
    throw new Error('solve: active node count out of range');
  }
  for (let e = 0; e < nEls; e++) {
    const el = els[e] as El;
    if (
      !Number.isInteger(el.a)
      || !Number.isInteger(el.b)
      || el.a < 0
      || el.b < 0
      || el.a >= SOLVE_MAX_NODES
      || el.b >= SOLVE_MAX_NODES
    ) {
      throw new Error('solve: node id out of range');
    }
    if (authoritativeNodeCount === undefined) {
      if (el.a + 1 > nodeCount) nodeCount = el.a + 1;
      if (el.b + 1 > nodeCount) nodeCount = el.b + 1;
    } else if (el.a >= nodeCount || el.b >= nodeCount) {
      throw new Error('solve: graph element endpoint outside active node count');
    }
  }
  if (nodeCount < 1 || nodeCount > SOLVE_MAX_NODES || authoritativeDatum >= nodeCount) {
    throw new Error('solve: active node count out of range');
  }
  workspace.nodeCount = nodeCount;

  // --- §3.1.4 source-component prune, BEFORE stamping. Walk the element graph from the source
  // --- element's two nodes; everything outside that component is floating. With no source
  // --- element, nothing is in the component and every non-datum node floats.
  let inSrc: ArrayLike<number>;
  if (authoritativeInSource !== undefined) {
    inSrc = authoritativeInSource;
    if (authoritativeInSource.length < nodeCount) throw new Error('solve: graph source mask is too short');
    if (!sourceEnabled) {
      for (let node = 0; node < nodeCount; node++) {
        if (authoritativeInSource[node] !== 0) throw new Error('solve: disabled graph has a source member');
      }
    }
  } else {
    const generated = workspace._inSource;
    inSrc = generated;
    for (let node = 0; node < nodeCount; node++) workspace._inSource[node] = 0;
    if (sourceEnabled && srcIdx >= 0) {
      const src = els[srcIdx] as El;
      generated[src.a] = 1;
      generated[src.b] = 1;
      let changed = true;
      while (changed) {
        changed = false;
        for (let e = 0; e < nEls; e++) {
          const el = els[e] as El;
          if (generated[el.a] === 1 && generated[el.b] === 0) {
            generated[el.b] = 1;
            changed = true;
          } else if (generated[el.b] === 1 && generated[el.a] === 0) {
            generated[el.a] = 1;
            changed = true;
          }
        }
      }
    }
  }

  // --- §3.1.2 + §3.1.3: the datum is eliminated and gets no row; the survivors are ordered by
  // --- ascending node id and renumbered 0..N-1. (`graph.ts` numbers super-nodes by ascending
  // --- minimum member terminal index, so node id order is §3.1.3's order; a hand-stamped array's
  // --- ids are taken as given.) The datum is skipped before renumbering,
  // --- so a datum that is not the lowest id still numbers identically in both languages.
  let n = 0;
  const rowOf = workspace._rowOf;
  for (let i = 0; i < nodeCount; i++) {
    rowOf[i] = -1;
    if (i !== authoritativeDatum && inSrc[i] === 1) {
      rowOf[i] = n;
      n++;
    }
  }
  const N = n;
  if (N > SOLVE_MAX_ROWS) throw new Error('solve: more than 173 non-datum rows');
  workspace.rowCount = N;

  for (let e = 0; e < nEls; e++) workspace._arcOn[e] = 0;

  // --- Solve 1.
  buildSystem(els, nEls, carried, cfg, N, false, workspace, inSrc);
  luSolve(N, workspace);
  let nonPortable = scanNaN(N, workspace);

  // --- §3.2 step 5 / §3.3: any coil whose solved branch voltage exceeded the arc clamp is
  // --- re-stamped with its arc conductance and the system is solved exactly once more. At most
  // --- two solves per tick, never three, even if pass 2 produces new exceedances.
  let anyArc = false;
  for (let e = 0; sourceEnabled && e < nEls; e++) {
    const el = els[e] as El;
    if (el.k !== 'coil') continue;
    if (inSrc[el.a] === 0 || inSrc[el.b] === 0) continue;
    const v = nodeV(el.a, authoritativeDatum, workspace) - nodeV(el.b, authoritativeDatum, workspace);
    if (v > cfg.vArc || v < -cfg.vArc) {
      workspace._arcOn[e] = 1;
      anyArc = true;
    }
  }
  if (anyArc) {
    buildSystem(els, nEls, carried, cfg, N, true, workspace, inSrc);
    luSolve(N, workspace);
    if (scanNaN(N, workspace)) nonPortable = true;
  }

  // --- Report the node voltages. The datum is 0 by definition; a pruned node is NaN.
  const v = workspace.v;
  const floating = workspace.floating;
  for (let i = 0; i < nodeCount; i++) {
    if (i === authoritativeDatum) {
      v[i] = 0;
      floating[i] = 0;
    } else if (inSrc[i] === 1) {
      v[i] = workspace._x[rowOf[i] as number] as number;
      floating[i] = 0;
    } else {
      v[i] = NaN;
      floating[i] = 1;
    }
  }

  // --- §3.3 + determinism rule 16: every branch current comes from the element's own companion
  // --- equation on the FINAL node voltages, never out of the matrix, which carries no information
  // --- about an element whose two ends landed on one node.
  const branchI = workspace.branchI;
  let openRamp = false;
  let coilSeen = 0;
  let lampSeen = 0;
  for (let e = 0; e < nEls; e++) {
    const el = els[e] as El;
    if (!sourceEnabled) {
      branchI[e] = 0;
      if (el.k === 'coil') coilSeen++;
      else if (el.k === 'lamp') lampSeen++;
      continue;
    }
    if (inSrc[el.a] === 0 || inSrc[el.b] === 0) {
      // Outside the source component: the solve defines no voltage for this element.
      //
      // WHICH CASE THIS IS. The prune above runs to a fixpoint across every element, so if either
      // end of an element is in the source component the other end is too. Reaching here therefore
      // means BOTH ends are pruned. For a coil that is the doubly-isolated relay coil — one whose
      // feed contact *and* whose return contact have both opened — not §4.2's open-release row,
      // which is the single-open case: there one end still reaches the datum or the rail, the coil
      // stays in the matrix, and the arc pass of §3.2 step 5 handles it.
      //
      // PROJECT RULING, flagged. §3.1.4 drops these nodes and reports them as null voltage, so it
      // leaves a doubly-pruned element's current UNDEFINED, while determinism rule 16 says every
      // element has one. That is a hole in the spec, and this block is the project's ruling on it:
      // a coil isolated at both ends is still an inductor with a stored current and an arc across
      // each opened contact, so it ramps toward zero by one `V_arc * dt / L` step per tick — the
      // same rate §4.2 gives the single-open case, reached by a hand-written ramp rather than by a
      // solve. Resistors and lamps outside the component carry 0.
      if (el.k === 'coil') {
        const iPrev = carried.iCoil[coilSeen] as number;
        const di = (cfg.vArc * cfg.dtS) / el.lH;
        const mag = iabsD(iPrev) - di;
        const m = mag > 0 ? mag : 0;
        const iNew = iPrev < 0 ? -m : m;
        branchI[e] = iNew;
        if (iPrev !== 0) openRamp = true;
        coilSeen++;
      } else {
        branchI[e] = 0;
        if (el.k === 'lamp') lampSeen++;
      }
      continue;
    }

    const vb = nodeV(el.a, authoritativeDatum, workspace)
      - nodeV(el.b, authoritativeDatum, workspace); // 0 for a collapsed element
    if (el.k === 'coil') {
      const geq = 1 / (el.rOhm + el.lH / cfg.dtS);
      const iPrev = carried.iCoil[coilSeen] as number;
      // Same parenthesisation as the stamp (§3.3). The arc conductance is deliberately absent:
      // it is a numerical clamp on the node voltage, not a branch of the inductor.
      branchI[e] = geq * vb + geq * ((el.lH / cfg.dtS) * iPrev);
      coilSeen++;
    } else if (el.k === 'lamp') {
      branchI[e] = vb / (carried.rLamp[lampSeen] as number);
      lampSeen++;
    } else if (el.k === 'res') {
      branchI[e] = vb / el.rOhm;
    } else {
      const gsrc = 1 / el.rSrcOhm;
      branchI[e] = gsrc * (el.vOc - vb);
    }
  }

  // --- §3.2 step 8 / §3.4: carried state advances from that one solution, in frozen element
  // --- order, AFTER the branch currents. The filament relaxes toward the PWL target on kThermal;
  // --- it is never reset here.
  let coilJ = 0;
  let lampJ = 0;
  for (let e = 0; e < nEls; e++) {
    const el = els[e] as El;
    if (el.k === 'coil') {
      const iNext = sourceEnabled ? branchI[e] as number : 0;
      // A singular solve (rule 14) reports NaN node voltages, and the coil's companion turns those
      // into a NaN branch current. Committing that is not one bad tick: the next tick stamps it as
      // the companion current, so every later solve reads NaN even after the topology becomes
      // solvable again -- the same permanent poisoning `pwlLookup` guards for the filament. Hold
      // the last finite current instead and report the tick as non-portable.
      if (Number.isFinite(iNext)) carried.iCoil[coilJ] = iNext;
      else nonPortable = true;
      coilJ++;
    } else if (el.k === 'lamp') {
      const rLamp = carried.rLamp[lampJ] as number;
      const rTarget = pwlLookup(cfg.pwl, iabsD(branchI[e] as number));
      carried.rLamp[lampJ] = rLamp + (rTarget - rLamp) * cfg.kThermal;
      lampJ++;
    }
  }

  workspace.arcPass = anyArc;
  workspace.openRamp = openRamp;
  workspace.nonPortable = nonPortable;
  return workspace;
}

/** The allocating wrapper for a hand-stamped element array. */
export function tickSolve(els: readonly El[], carried: Carried, cfg: SolveCfg): TickResult {
  let validBounds = Number.isInteger(cfg.datum) && cfg.datum >= 0 && cfg.datum < SOLVE_MAX_NODES;
  let nodeCount = validBounds ? cfg.datum + 1 : SOLVE_MAX_NODES;
  for (let e = 0; e < els.length; e++) {
    const el = els[e] as El;
    if (
      !Number.isInteger(el.a)
      || !Number.isInteger(el.b)
      || el.a < 0
      || el.b < 0
      || el.a >= SOLVE_MAX_NODES
      || el.b >= SOLVE_MAX_NODES
    ) {
      validBounds = false;
      break;
    }
    if (el.a + 1 > nodeCount) nodeCount = el.a + 1;
    if (el.b + 1 > nodeCount) nodeCount = el.b + 1;
  }
  if (!validBounds) nodeCount = SOLVE_MAX_NODES;
  const rowCapacity = nodeCount - 1;
  const elementCapacity = els.length <= SOLVE_MAX_ELEMENTS ? els.length : SOLVE_MAX_ELEMENTS;
  const transient = new SolveBuffers(nodeCount, rowCapacity, elementCapacity);
  const workspace = tickSolveInto(els, els.length, carried, cfg, true, transient);
  return {
    v: workspace.v.slice(0, workspace.nodeCount),
    floating: workspace.floating.slice(0, workspace.nodeCount),
    branchI: workspace.branchI.slice(0, workspace.elementCount),
    arcPass: workspace.arcPass,
    openRamp: workspace.openRamp,
    nonPortable: workspace.nonPortable,
  };
}

/** Absolute value on a solver double. `Math.abs` is exact and is not on §1.1's banned list. */
function iabsD(x: number): number {
  return x < 0 ? -x : x;
}

/** The solved voltage of a node, with the datum pinned at 0. */
function nodeV(node: number, datum: number, workspace: SolveWorkspace): number {
  if (node === datum) return 0;
  return workspace._x[workspace._rowOf[node] as number] as number;
}

/**
 * Stamp G and i per §3.3's table, in element array order, source last.
 *
 * Accumulation order is part of the contract: no re-association, and the parenthesisation below is
 * literal (determinism rule 3).
 *
 * WHERE `gmin` LANDS IS A PROJECT RULING, NOT A QUOTATION. §3.1.5 says only that `gmin` is
 * "stamped on the diagonal only, on every solved row, purely for conditioning". It does not say
 * where in the accumulation it goes, and the answer is bit-load-bearing: `(gmin + G_coil) + G_src`
 * and `(G_coil + G_src) + gmin` differ by 1 ULP on the shipped divider row. Rule 3 makes
 * accumulation order part of the port contract, so a porter reading §3.1 and §3.3 literally has a
 * coin-flip chance of failing a bit-exact KAT with no clause to appeal to.
 *
 * The ruling: `gmin` goes on the diagonal of EVERY solved row FIRST, before any element is
 * stamped, which is what the loop below does. This must reach `docs/port/CSHARP-PORT.md` when that
 * file is written — it is not derivable from the architecture as written.
 */
function buildSystem(
  els: ArrayLike<Readonly<El>>,
  elementCount: number,
  carried: Carried,
  cfg: SolveCfg,
  N: number,
  withArc: boolean,
  workspace: SolveWorkspace,
  inSource: ArrayLike<number>,
): void {
  const A = workspace._a;
  const J = workspace._j;
  const stride = workspace._rowStride;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) A[r * stride + c] = 0;
    J[r] = 0;
  }
  for (let r = 0; r < N; r++) A[r * stride + r] = cfg.gminS;

  let coilJ = 0;
  let lampJ = 0;
  for (let e = 0; e < elementCount; e++) {
    const el = els[e] as El;
    const skip = inSource[el.a] === 0 || inSource[el.b] === 0;
    if (el.k === 'coil') {
      if (!skip) {
        let g = 1 / (el.rOhm + el.lH / cfg.dtS);
        const ieq = g * ((el.lH / cfg.dtS) * (carried.iCoil[coilJ] as number));
        if (withArc && workspace._arcOn[e] === 1) {
          g = g + iabsD(carried.iCoil[coilJ] as number) / cfg.vArc;
        }
        stampG(el.a, el.b, g, workspace);
        stampI(el.a, el.b, ieq, workspace);
      }
      coilJ++;
    } else if (el.k === 'lamp') {
      if (!skip) stampG(el.a, el.b, 1 / (carried.rLamp[lampJ] as number), workspace);
      lampJ++;
    } else if (el.k === 'res') {
      if (!skip) stampG(el.a, el.b, 1 / el.rOhm, workspace);
    } else {
      if (!skip) {
        const gsrc = 1 / el.rSrcOhm;
        stampG(el.a, el.b, gsrc, workspace);
        stampI(el.a, el.b, -(gsrc * el.vOc), workspace);
      }
    }
  }
}

/** Conductance between two nodes. The datum has no row (rowOf === -1), so it simply drops out. */
function stampG(a: number, b: number, g: number, workspace: SolveWorkspace): void {
  const A = workspace._a;
  const stride = workspace._rowStride;
  const ra = workspace._rowOf[a] as number;
  const rb = workspace._rowOf[b] as number;
  if (ra >= 0) A[ra * stride + ra] = (A[ra * stride + ra] as number) + g;
  if (rb >= 0) A[rb * stride + rb] = (A[rb * stride + rb] as number) + g;
  if (ra >= 0 && rb >= 0) {
    A[ra * stride + rb] = (A[ra * stride + rb] as number) - g;
    A[rb * stride + ra] = (A[rb * stride + ra] as number) - g;
  }
}

/** A fixed current `i` flowing through the element from node a to node b. */
function stampI(a: number, b: number, i: number, workspace: SolveWorkspace): void {
  const J = workspace._j;
  const ra = workspace._rowOf[a] as number;
  const rb = workspace._rowOf[b] as number;
  if (ra >= 0) J[ra] = (J[ra] as number) - i;
  if (rb >= 0) J[rb] = (J[rb] as number) + i;
}

/**
 * Dense LU with partial pivoting, in place, over the canonical row order (§3.4).
 *
 * Pivot = max |a| in the column, ties broken by LOWEST row index — which is what the strict `>`
 * in the search gives. The loop shape is FROZEN, not "free as long as the KAT passes": any
 * re-association changes the last bits and fails a bit-exact KAT. N = 0 is a legal no-op
 * (§3.3's zero-unknown case), not an error.
 */
function luSolve(N: number, workspace: SolveWorkspace): void {
  const A = workspace._a;
  const J = workspace._j;
  const X = workspace._x;
  const stride = workspace._rowStride;
  for (let k = 0; k < N; k++) {
    let p = k;
    let best = iabsD(A[k * stride + k] as number);
    for (let r = k + 1; r < N; r++) {
      const m = iabsD(A[r * stride + k] as number);
      if (m > best) {
        best = m;
        p = r;
      }
    }
    if (p !== k) {
      for (let c = k; c < N; c++) {
        const t = A[k * stride + c] as number;
        A[k * stride + c] = A[p * stride + c] as number;
        A[p * stride + c] = t;
      }
      const tj = J[k] as number;
      J[k] = J[p] as number;
      J[p] = tj;
    }
    const piv = A[k * stride + k] as number;
    for (let r = k + 1; r < N; r++) {
      const m = (A[r * stride + k] as number) / piv;
      A[r * stride + k] = 0;
      for (let c = k + 1; c < N; c++) {
        A[r * stride + c] = (A[r * stride + c] as number)
          - m * (A[k * stride + c] as number);
      }
      J[r] = (J[r] as number) - m * (J[k] as number);
    }
  }
  for (let k = N - 1; k >= 0; k--) {
    let s = J[k] as number;
    for (let c = k + 1; c < N; c++) {
      s = s - (A[k * stride + c] as number) * (X[c] as number);
    }
    X[k] = s / (A[k * stride + k] as number);
  }
}

/** Determinism rule 14: report NaN in the solution rather than throwing or continuing silently. */
function scanNaN(N: number, workspace: SolveWorkspace): boolean {
  for (let k = 0; k < N; k++) {
    if (Number.isNaN(workspace._x[k] as number)) return true;
  }
  return false;
}
