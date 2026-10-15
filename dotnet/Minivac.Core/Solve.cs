using System;
using System.Collections.Generic;

namespace Minivac.Core;

public sealed record Pwl(IReadOnlyList<double> xs, IReadOnlyList<double> ys);

public sealed record SolveCfg(
    double dtS,
    double vArc,
    double kThermal,
    double gminS,
    Pwl pwl,
    int datum);

public sealed record Carried(double[] iCoil, double[] rLamp);

public sealed record TickResult(
    double[] v,
    byte[] floating,
    double[] branchI,
    bool arcPass,
    bool openRamp,
    bool nonPortable);

public sealed class SolveException : Exception
{
    public SolveException(string message) : base("solve: " + message)
    {
    }
}

public sealed class SolveWorkspace
{
    internal SolveWorkspace(
        int nodeCapacity = Solve.SOLVE_MAX_NODES,
        int rowCapacity = Solve.SOLVE_MAX_ROWS,
        int elementCapacity = Solve.SOLVE_MAX_ELEMENTS)
    {
        v = new double[nodeCapacity];
        floating = new byte[nodeCapacity];
        branchI = new double[elementCapacity];
        _a = new double[rowCapacity * rowCapacity];
        _j = new double[rowCapacity];
        _x = new double[rowCapacity];
        _rowOf = new int[nodeCapacity];
        _inSource = new byte[nodeCapacity];
        _arcOn = new byte[elementCapacity];
        _rowStride = rowCapacity;
    }

    public double[] v { get; }
    public byte[] floating { get; }
    public double[] branchI { get; }
    public int nodeCount { get; internal set; }
    public int elementCount { get; internal set; }
    public int rowCount { get; internal set; }
    public bool arcPass { get; internal set; }
    public bool openRamp { get; internal set; }
    public bool nonPortable { get; internal set; }
    public double[] _a { get; }
    public double[] _j { get; }
    public double[] _x { get; }
    public int[] _rowOf { get; }
    public byte[] _inSource { get; }
    public byte[] _arcOn { get; }
    public int _rowStride { get; }
}

public static class Solve
{
    private static readonly double FloatingNaN = BitConverter.Int64BitsToDouble(0x7ff8000000000000L);

    public const int SOLVE_MAX_NODES = 174;
    public const int SOLVE_MAX_ROWS = 173;
    public const int SOLVE_MAX_ELEMENTS = 278;

    public static SolveWorkspace createSolveWorkspace() => new();

    public static double pwlLookup(Pwl pwl, double x)
    {
        var xs = pwl.xs;
        var ys = pwl.ys;
        var last = xs.Count - 1;
        if (double.IsNaN(x)) return ys[0];
        if (x <= xs[0]) return ys[0];
        if (x >= xs[last]) return ys[last];
        var j = 0;
        while (x > xs[j]) j++;
        var x0 = xs[j - 1];
        var x1 = xs[j];
        var y0 = ys[j - 1];
        var y1 = ys[j];
        var t = (x - x0) / (x1 - x0);
        return y0 + t * (y1 - y0);
    }

    public static SolveWorkspace tickSolveInto(
        IReadOnlyList<El> els,
        int elementCount,
        Carried carried,
        SolveCfg cfg,
        bool sourceEnabled,
        SolveWorkspace workspace)
    {
        return TickSolveCore(
            els,
            elementCount,
            carried,
            cfg,
            sourceEnabled,
            workspace,
            null,
            null,
            cfg.datum);
    }

    public static SolveWorkspace tickSolveGraphInto(
        GraphWorkspace graph,
        Carried carried,
        SolveCfg cfg,
        SolveWorkspace workspace)
    {
        return TickSolveCore(
            graph.elements,
            graph.elementCount,
            carried,
            cfg,
            graph.sourceEnabled,
            workspace,
            graph.inSource,
            graph.nodeCount,
            graph.datum);
    }

    public static TickResult tickSolve(IReadOnlyList<El> els, Carried carried, SolveCfg cfg)
    {
        var validBounds = cfg.datum >= 0 && cfg.datum < SOLVE_MAX_NODES;
        var nodeCount = validBounds ? cfg.datum + 1 : SOLVE_MAX_NODES;
        for (var e = 0; e < els.Count; e++)
        {
            var el = els[e];
            if (el.a < 0 || el.b < 0 || el.a >= SOLVE_MAX_NODES || el.b >= SOLVE_MAX_NODES)
            {
                validBounds = false;
                break;
            }
            if (el.a + 1 > nodeCount) nodeCount = el.a + 1;
            if (el.b + 1 > nodeCount) nodeCount = el.b + 1;
        }
        if (!validBounds) nodeCount = SOLVE_MAX_NODES;
        var rowCapacity = nodeCount - 1;
        var elementCapacity = els.Count <= SOLVE_MAX_ELEMENTS ? els.Count : SOLVE_MAX_ELEMENTS;
        var transient = new SolveWorkspace(nodeCount, rowCapacity, elementCapacity);
        var workspace = tickSolveInto(els, els.Count, carried, cfg, true, transient);
        var v = new double[workspace.nodeCount];
        var floating = new byte[workspace.nodeCount];
        var branchI = new double[workspace.elementCount];
        Array.Copy(workspace.v, v, v.Length);
        Array.Copy(workspace.floating, floating, floating.Length);
        Array.Copy(workspace.branchI, branchI, branchI.Length);
        return new TickResult(
            v,
            floating,
            branchI,
            workspace.arcPass,
            workspace.openRamp,
            workspace.nonPortable);
    }

    private static SolveWorkspace TickSolveCore(
        IReadOnlyList<El> els,
        int nEls,
        Carried carried,
        SolveCfg cfg,
        bool sourceEnabled,
        SolveWorkspace workspace,
        IReadOnlyList<byte>? authoritativeInSource,
        int? authoritativeNodeCount,
        int authoritativeDatum)
    {
        if (nEls < 0 || nEls > els.Count)
            Fail("elementCount must be within the element array");
        if (nEls > SOLVE_MAX_ELEMENTS)
            Fail("more than 278 elements");
        workspace.elementCount = nEls;
        workspace.nodeCount = 0;
        workspace.rowCount = 0;
        workspace.arcPass = false;
        workspace.openRamp = false;
        workspace.nonPortable = false;
        if (authoritativeDatum < 0 || authoritativeDatum >= SOLVE_MAX_NODES)
            Fail("datum node id out of range");

        var srcIdx = -1;
        for (var e = 0; e < nEls; e++)
        {
            if (els[e] is SourceEl)
            {
                if (e != nEls - 1)
                    Fail("a source element must be last in the element array");
                srcIdx = e;
            }
        }

        var nodeCount = authoritativeNodeCount ?? authoritativeDatum + 1;
        if (nodeCount < 1 || nodeCount > SOLVE_MAX_NODES || authoritativeDatum >= nodeCount)
            Fail("active node count out of range");
        for (var e = 0; e < nEls; e++)
        {
            var el = els[e];
            if (el.a < 0 || el.b < 0 || el.a >= SOLVE_MAX_NODES || el.b >= SOLVE_MAX_NODES)
                Fail("node id out of range");
            if (authoritativeNodeCount is null)
            {
                if (el.a + 1 > nodeCount) nodeCount = el.a + 1;
                if (el.b + 1 > nodeCount) nodeCount = el.b + 1;
            }
            else if (el.a >= nodeCount || el.b >= nodeCount)
            {
                Fail("graph element endpoint outside active node count");
            }
        }
        if (nodeCount < 1 || nodeCount > SOLVE_MAX_NODES || authoritativeDatum >= nodeCount)
            Fail("active node count out of range");
        workspace.nodeCount = nodeCount;

        IReadOnlyList<byte> inSource;
        if (authoritativeInSource is not null)
        {
            inSource = authoritativeInSource;
            if (authoritativeInSource.Count < nodeCount)
                Fail("graph source mask is too short");
            if (!sourceEnabled)
            {
                for (var node = 0; node < nodeCount; node++)
                {
                    if (authoritativeInSource[node] != 0)
                        Fail("disabled graph has a source member");
                }
            }
        }
        else
        {
            var generated = workspace._inSource;
            inSource = generated;
            Array.Clear(generated, 0, nodeCount);
            if (sourceEnabled && srcIdx >= 0)
            {
                var source = els[srcIdx];
                generated[source.a] = 1;
                generated[source.b] = 1;
                var changed = true;
                while (changed)
                {
                    changed = false;
                    for (var e = 0; e < nEls; e++)
                    {
                        var el = els[e];
                        if (generated[el.a] == 1 && generated[el.b] == 0)
                        {
                            generated[el.b] = 1;
                            changed = true;
                        }
                        else if (generated[el.b] == 1 && generated[el.a] == 0)
                        {
                            generated[el.a] = 1;
                            changed = true;
                        }
                    }
                }
            }
        }

        var n = 0;
        var rowOf = workspace._rowOf;
        for (var i = 0; i < nodeCount; i++)
        {
            rowOf[i] = -1;
            if (i != authoritativeDatum && inSource[i] == 1)
            {
                rowOf[i] = n;
                n++;
            }
        }
        var N = n;
        if (N > SOLVE_MAX_ROWS)
            Fail("more than 173 non-datum rows");
        workspace.rowCount = N;

        Array.Clear(workspace._arcOn, 0, nEls);

        BuildSystem(els, nEls, carried, cfg, N, false, workspace, inSource);
        LuSolve(N, workspace);
        var nonPortable = ScanNaN(N, workspace);

        var anyArc = false;
        for (var e = 0; sourceEnabled && e < nEls; e++)
        {
            var el = els[e];
            if (el is not CoilEl) continue;
            if (inSource[el.a] == 0 || inSource[el.b] == 0) continue;
            var branchVoltage = NodeV(el.a, authoritativeDatum, workspace)
                - NodeV(el.b, authoritativeDatum, workspace);
            if (branchVoltage > cfg.vArc || branchVoltage < -cfg.vArc)
            {
                workspace._arcOn[e] = 1;
                anyArc = true;
            }
        }
        if (anyArc)
        {
            BuildSystem(els, nEls, carried, cfg, N, true, workspace, inSource);
            LuSolve(N, workspace);
            if (ScanNaN(N, workspace)) nonPortable = true;
        }

        var v = workspace.v;
        var floating = workspace.floating;
        for (var i = 0; i < nodeCount; i++)
        {
            if (i == authoritativeDatum)
            {
                v[i] = 0;
                floating[i] = 0;
            }
            else if (inSource[i] == 1)
            {
                v[i] = workspace._x[rowOf[i]];
                floating[i] = 0;
            }
            else
            {
                v[i] = FloatingNaN;
                floating[i] = 1;
            }
        }

        var branchI = workspace.branchI;
        var openRamp = false;
        var coilSeen = 0;
        var lampSeen = 0;
        for (var e = 0; e < nEls; e++)
        {
            var el = els[e];
            if (!sourceEnabled)
            {
                branchI[e] = 0;
                if (el is CoilEl) coilSeen++;
                else if (el is LampEl) lampSeen++;
                continue;
            }
            if (inSource[el.a] == 0 || inSource[el.b] == 0)
            {
                if (el is CoilEl coil)
                {
                    var iPrev = carried.iCoil[coilSeen];
                    var di = (cfg.vArc * cfg.dtS) / coil.lH;
                    var magnitude = IabsD(iPrev) - di;
                    var m = magnitude > 0 ? magnitude : 0;
                    var iNew = iPrev < 0 ? -m : m;
                    branchI[e] = iNew;
                    if (iPrev != 0) openRamp = true;
                    coilSeen++;
                }
                else
                {
                    branchI[e] = 0;
                    if (el is LampEl) lampSeen++;
                }
                continue;
            }

            var vb = NodeV(el.a, authoritativeDatum, workspace)
                - NodeV(el.b, authoritativeDatum, workspace);
            if (el is CoilEl coilEl)
            {
                var geq = 1 / (coilEl.rOhm + coilEl.lH / cfg.dtS);
                var iPrev = carried.iCoil[coilSeen];
                branchI[e] = geq * vb + geq * ((coilEl.lH / cfg.dtS) * iPrev);
                coilSeen++;
            }
            else if (el is LampEl)
            {
                branchI[e] = vb / carried.rLamp[lampSeen];
                lampSeen++;
            }
            else if (el is ResEl resistor)
            {
                branchI[e] = vb / resistor.rOhm;
            }
            else
            {
                var source = (SourceEl)el;
                var gsrc = 1 / source.rSrcOhm;
                branchI[e] = gsrc * (source.vOc - vb);
            }
        }

        var coilJ = 0;
        var lampJ = 0;
        for (var e = 0; e < nEls; e++)
        {
            var el = els[e];
            if (el is CoilEl)
            {
                carried.iCoil[coilJ] = sourceEnabled ? branchI[e] : 0;
                coilJ++;
            }
            else if (el is LampEl)
            {
                var rLamp = carried.rLamp[lampJ];
                var rTarget = pwlLookup(cfg.pwl, IabsD(branchI[e]));
                carried.rLamp[lampJ] = rLamp + (rTarget - rLamp) * cfg.kThermal;
                lampJ++;
            }
        }

        workspace.arcPass = anyArc;
        workspace.openRamp = openRamp;
        workspace.nonPortable = nonPortable;
        return workspace;
    }

    private static double IabsD(double x) => x < 0 ? -x : x;

    private static double NodeV(int node, int datum, SolveWorkspace workspace)
    {
        if (node == datum) return 0;
        return workspace._x[workspace._rowOf[node]];
    }

    private static void BuildSystem(
        IReadOnlyList<El> els,
        int elementCount,
        Carried carried,
        SolveCfg cfg,
        int N,
        bool withArc,
        SolveWorkspace workspace,
        IReadOnlyList<byte> inSource)
    {
        var A = workspace._a;
        var J = workspace._j;
        var stride = workspace._rowStride;
        for (var r = 0; r < N; r++)
        {
            for (var c = 0; c < N; c++) A[r * stride + c] = 0;
            J[r] = 0;
        }
        for (var r = 0; r < N; r++) A[r * stride + r] = cfg.gminS;

        var coilJ = 0;
        var lampJ = 0;
        for (var e = 0; e < elementCount; e++)
        {
            var el = els[e];
            var skip = inSource[el.a] == 0 || inSource[el.b] == 0;
            if (el is CoilEl coil)
            {
                if (!skip)
                {
                    var g = 1 / (coil.rOhm + coil.lH / cfg.dtS);
                    var ieq = g * ((coil.lH / cfg.dtS) * carried.iCoil[coilJ]);
                    if (withArc && workspace._arcOn[e] == 1)
                        g = g + IabsD(carried.iCoil[coilJ]) / cfg.vArc;
                    StampG(coil.a, coil.b, g, workspace);
                    StampI(coil.a, coil.b, ieq, workspace);
                }
                coilJ++;
            }
            else if (el is LampEl lamp)
            {
                if (!skip) StampG(lamp.a, lamp.b, 1 / carried.rLamp[lampJ], workspace);
                lampJ++;
            }
            else if (el is ResEl resistor)
            {
                if (!skip) StampG(resistor.a, resistor.b, 1 / resistor.rOhm, workspace);
            }
            else
            {
                var source = (SourceEl)el;
                if (!skip)
                {
                    var gsrc = 1 / source.rSrcOhm;
                    StampG(source.a, source.b, gsrc, workspace);
                    StampI(source.a, source.b, -(gsrc * source.vOc), workspace);
                }
            }
        }
    }

    private static void StampG(int a, int b, double g, SolveWorkspace workspace)
    {
        var A = workspace._a;
        var stride = workspace._rowStride;
        var ra = workspace._rowOf[a];
        var rb = workspace._rowOf[b];
        if (ra >= 0) A[ra * stride + ra] = A[ra * stride + ra] + g;
        if (rb >= 0) A[rb * stride + rb] = A[rb * stride + rb] + g;
        if (ra >= 0 && rb >= 0)
        {
            A[ra * stride + rb] = A[ra * stride + rb] - g;
            A[rb * stride + ra] = A[rb * stride + ra] - g;
        }
    }

    private static void StampI(int a, int b, double i, SolveWorkspace workspace)
    {
        var J = workspace._j;
        var ra = workspace._rowOf[a];
        var rb = workspace._rowOf[b];
        if (ra >= 0) J[ra] = J[ra] - i;
        if (rb >= 0) J[rb] = J[rb] + i;
    }

    private static void LuSolve(int N, SolveWorkspace workspace)
    {
        var A = workspace._a;
        var J = workspace._j;
        var X = workspace._x;
        var stride = workspace._rowStride;
        for (var k = 0; k < N; k++)
        {
            var p = k;
            var best = IabsD(A[k * stride + k]);
            for (var r = k + 1; r < N; r++)
            {
                var magnitude = IabsD(A[r * stride + k]);
                if (magnitude > best)
                {
                    best = magnitude;
                    p = r;
                }
            }
            if (p != k)
            {
                for (var c = k; c < N; c++)
                {
                    var temporary = A[k * stride + c];
                    A[k * stride + c] = A[p * stride + c];
                    A[p * stride + c] = temporary;
                }
                var temporaryJ = J[k];
                J[k] = J[p];
                J[p] = temporaryJ;
            }
            var pivot = A[k * stride + k];
            for (var r = k + 1; r < N; r++)
            {
                var multiplier = A[r * stride + k] / pivot;
                A[r * stride + k] = 0;
                for (var c = k + 1; c < N; c++)
                    A[r * stride + c] = A[r * stride + c] - multiplier * A[k * stride + c];
                J[r] = J[r] - multiplier * J[k];
            }
        }
        for (var k = N - 1; k >= 0; k--)
        {
            var sum = J[k];
            for (var c = k + 1; c < N; c++)
                sum = sum - A[k * stride + c] * X[c];
            X[k] = sum / A[k * stride + k];
        }
    }

    private static bool ScanNaN(int N, SolveWorkspace workspace)
    {
        for (var k = 0; k < N; k++)
        {
            if (double.IsNaN(workspace._x[k])) return true;
        }
        return false;
    }

    private static void Fail(string message) => throw new SolveException(message);
}
