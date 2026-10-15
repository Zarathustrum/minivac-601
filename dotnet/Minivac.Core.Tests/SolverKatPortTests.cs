using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;
using Minivac.Conformance;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class SolverKatPortTests
{
    private static readonly string[] CaseNames =
    [
        "divider",
        "series-through-float",
        "collapsed-coil",
        "collapsed-armature",
        "zero-unknown",
        "datum-not-lowest-index",
        "arc-clamp-single",
        "arc-clamp-series-junction",
        "lamp-cold-start",
        "lamp-warm-relaxation",
        "pwl-below-first-breakpoint",
        "pwl-above-last-breakpoint",
        "pwl-on-a-breakpoint",
        "saturating-quantize",
        "pivot-tie",
        "rl-rise-500",
        "freewheel-500",
        "six-coil-load",
        "whole-panel-cold",
        "whole-panel-500",
        "whole-panel-open-feed",
    ];

    public static IEnumerable<object[]> Cases()
    {
        for (var index = 0; index < CaseNames.Length; index++)
            yield return [index, CaseNames[index]];
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void solver_kat_case_is_bit_exact_by_kind(int caseIndex, string expectedName)
    {
        using var document = JsonDocument.Parse(ArtifactSource().ReadAllBytes("data/kat/solver-kat.json"));
        var root = document.RootElement;
        Assert.Equal("minivac.solver-kat/1", root.GetProperty("schema").GetString());
        var cases = root.GetProperty("cases");
        Assert.Equal(21, cases.GetArrayLength());
        var testCase = cases[caseIndex];
        Assert.Equal(expectedName, testCase.GetProperty("name").GetString());

        var kind = testCase.GetProperty("kind").GetString();
        if (kind == "solve")
            AssertSolve(root, testCase);
        else if (kind == "pwl")
            AssertPwl(root, testCase);
        else if (kind == "quantize")
            AssertQuantize(testCase);
        else
            throw new InvalidOperationException("unknown solver KAT kind " + kind);
    }

    [Fact]
    public void a_singular_system_reports_nonPortable_rather_than_throwing()
    {
        // Ported from test/solve.spec.ts. Deliberately degenerate: with gmin off and the source
        // spanning nodes 1 and 2, the datum (node 0) is touched by no element at all, so the
        // reference floats and both rows are the same equation. The LU divides 0 by 0. Rule 14's
        // contract is that this is REPORTED, never thrown and never silently continued.
        using var document = JsonDocument.Parse(ArtifactSource().ReadAllBytes("data/kat/solver-kat.json"));
        var root = document.RootElement;
        var pwlElement = root.GetProperty("pwl");
        var pwl = new Pwl(
            DecodeArray(pwlElement.GetProperty("xs")),
            DecodeArray(pwlElement.GetProperty("ys")));
        var cfgElement = root.GetProperty("cases")[0].GetProperty("cfg");
        var cfg = new SolveCfg(
            Decode(cfgElement.GetProperty("dtS").GetString()!),
            Decode(cfgElement.GetProperty("vArc").GetString()!),
            Decode(cfgElement.GetProperty("kThermal").GetString()!),
            0,
            pwl,
            0);
        var source = (SourceEl)DecodeElements(root.GetProperty("cases")[0].GetProperty("els"))[1];

        var result = Solve.tickSolve(
            [new ResEl(1, 2, 100), new SourceEl(1, 2, source.vOc, source.rSrcOhm)],
            new Carried([], []),
            cfg);

        Assert.True(result.nonPortable);
        Assert.True(double.IsNaN(result.v[1]));
        Assert.True(double.IsNaN(result.v[2]));
        // NaN is not floating: these nodes ARE in the source component, they just have no solution.
        Assert.Equal(0, result.floating[1]);
        Assert.Equal(0, result.floating[2]);
    }

    [Fact]
    public void runtime_does_not_contract_multiply_add()
    {
        var a = BitConverter.Int64BitsToDouble(unchecked((long)0x3ff0000000000001UL));
        var b = BitConverter.Int64BitsToDouble(unchecked((long)0x3feffffffffffffeUL));
        const double c = -1.0;

        var fused = Math.FusedMultiplyAdd(a, b, c);
        var separate = a * b + c;

        Assert.NotEqual(fused, separate);
        Assert.Equal(0.0, separate);
    }

    private static void AssertSolve(JsonElement root, JsonElement testCase)
    {
        var pwlElement = root.GetProperty("pwl");
        var pwl = new Pwl(
            DecodeArray(pwlElement.GetProperty("xs")),
            DecodeArray(pwlElement.GetProperty("ys")));
        var cfgElement = testCase.GetProperty("cfg");
        var cfg = new SolveCfg(
            Decode(cfgElement.GetProperty("dtS").GetString()!),
            Decode(cfgElement.GetProperty("vArc").GetString()!),
            Decode(cfgElement.GetProperty("kThermal").GetString()!),
            Decode(cfgElement.GetProperty("gminS").GetString()!),
            pwl,
            cfgElement.GetProperty("datum").GetInt32());
        var carriedElement = testCase.GetProperty("carried");
        var carried = new Carried(
            DecodeArray(carriedElement.GetProperty("iCoil")),
            DecodeArray(carriedElement.GetProperty("rLamp")));
        var elements = DecodeElements(testCase.GetProperty("els"));

        var ticks = testCase.GetProperty("ticks").GetInt32();
        var result = Solve.tickSolve(elements, carried, cfg);
        for (var tick = 1; tick < ticks; tick++)
            result = Solve.tickSolve(elements, carried, cfg);

        var expected = testCase.GetProperty("expect");
        Assert.Equal(StringArray(expected.GetProperty("v")), HexArray(result.v));
        Assert.Equal(ByteArray(expected.GetProperty("floating")), result.floating);
        Assert.Equal(StringArray(expected.GetProperty("branchI")), HexArray(result.branchI));
        Assert.Equal(expected.GetProperty("arcPass").GetBoolean(), result.arcPass);
        Assert.Equal(expected.GetProperty("openRamp").GetBoolean(), result.openRamp);
        Assert.Equal(expected.GetProperty("nonPortable").GetBoolean(), result.nonPortable);
        Assert.Equal(StringArray(expected.GetProperty("iCoil")), HexArray(carried.iCoil));
        Assert.Equal(StringArray(expected.GetProperty("rLamp")), HexArray(carried.rLamp));
    }

    private static void AssertPwl(JsonElement root, JsonElement testCase)
    {
        var pwlElement = root.GetProperty("pwl");
        var pwl = new Pwl(
            DecodeArray(pwlElement.GetProperty("xs")),
            DecodeArray(pwlElement.GetProperty("ys")));
        var actual = Solve.pwlLookup(pwl, Decode(testCase.GetProperty("x").GetString()!));
        Assert.Equal(testCase.GetProperty("expect").GetProperty("y").GetString(), Hex(actual));
    }

    private static void AssertQuantize(JsonElement testCase)
    {
        var flags = new PortFlags();
        var actual = Ints.quantize(
            Decode(testCase.GetProperty("x").GetString()!),
            Decode(testCase.GetProperty("scale").GetString()!),
            flags);
        var expected = testCase.GetProperty("expect");
        Assert.Equal(expected.GetProperty("q").GetInt32(), actual);
        Assert.Equal(expected.GetProperty("nonPortable").GetBoolean(), flags.nonPortable);
    }

    private static El[] DecodeElements(JsonElement source)
    {
        var result = new El[source.GetArrayLength()];
        var index = 0;
        foreach (var element in source.EnumerateArray())
        {
            var a = element.GetProperty("a").GetInt32();
            var b = element.GetProperty("b").GetInt32();
            result[index++] = element.GetProperty("k").GetString() switch
            {
                "coil" => new CoilEl(
                    a,
                    b,
                    Decode(element.GetProperty("rOhm").GetString()!),
                    Decode(element.GetProperty("lH").GetString()!)),
                "lamp" => new LampEl(a, b),
                "res" => new ResEl(a, b, Decode(element.GetProperty("rOhm").GetString()!)),
                "source" => new SourceEl(
                    a,
                    b,
                    Decode(element.GetProperty("vOc").GetString()!),
                    Decode(element.GetProperty("rSrcOhm").GetString()!)),
                var kind => throw new InvalidOperationException("unknown solver KAT element " + kind),
            };
        }
        return result;
    }

    private static double Decode(string hex)
    {
        Assert.Matches("^0x[0-9a-f]{16}$", hex);
        var bits = ulong.Parse(hex.AsSpan(2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture);
        return BitConverter.Int64BitsToDouble(unchecked((long)bits));
    }

    private static double[] DecodeArray(JsonElement source)
    {
        var result = new double[source.GetArrayLength()];
        var index = 0;
        foreach (var item in source.EnumerateArray())
            result[index++] = Decode(item.GetString()!);
        return result;
    }

    private static string Hex(double value) =>
        "0x" + unchecked((ulong)BitConverter.DoubleToInt64Bits(value)).ToString("x16", CultureInfo.InvariantCulture);

    private static string[] HexArray(IReadOnlyList<double> source)
    {
        var result = new string[source.Count];
        for (var index = 0; index < source.Count; index++)
            result[index] = Hex(source[index]);
        return result;
    }

    private static string[] StringArray(JsonElement source)
    {
        var result = new string[source.GetArrayLength()];
        var index = 0;
        foreach (var item in source.EnumerateArray())
            result[index++] = item.GetString()!;
        return result;
    }

    private static byte[] ByteArray(JsonElement source)
    {
        var result = new byte[source.GetArrayLength()];
        var index = 0;
        foreach (var item in source.EnumerateArray())
            result[index++] = item.GetByte();
        return result;
    }

    private static FileSystemSource ArtifactSource() => new(FindRepositoryRoot());

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "data", "kat", "solver-kat.json")))
                return directory.FullName;
        }
        throw new InvalidOperationException("repository root not found");
    }
}
