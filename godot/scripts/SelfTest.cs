using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Godot;
using Minivac.Conformance;
using Minivac.Core;

namespace Minivac.Godot;

public partial class SelfTest : Node
{
    private static readonly string[] SolverCases =
    [
        "divider", "series-through-float", "collapsed-coil", "collapsed-armature", "zero-unknown",
        "datum-not-lowest-index", "arc-clamp-single", "arc-clamp-series-junction", "lamp-cold-start",
        "lamp-warm-relaxation", "pwl-below-first-breakpoint", "pwl-above-last-breakpoint",
        "pwl-on-a-breakpoint", "saturating-quantize", "pivot-tie", "rl-rise-500", "freewheel-500",
        "six-coil-load", "whole-panel-cold", "whole-panel-500", "whole-panel-open-feed",
    ];

    private static readonly string[] NetlistCases =
    [
        "I-EXP1", "I-EXP2", "I-EXP3", "I-EXP4", "I-EXP5", "I-EXP6", "I-EXP7", "I-EXP8",
        "I-EXP9", "I-EXP10", "I-EXP11", "I-EXP12", "I-EXP13", "I-EXP14", "II-EXP1", "II-EXP2",
        "II-EXP3", "II-MANUALMEM", "II-SELFLOCK", "II-2BUTTONMEM", "II-FF1", "II-EXP4", "II-EXP5",
        "II-EXP6", "II-EXP7", "III-3STMT", "III-ANDOR", "III-XOR-PB", "III-RELAYAND",
        "III-RELAYOR", "III-RELAYNOT", "III-RELAYXOR", "MM-PB-CHECK", "MM-RLY-CHECK",
        "MM-SW-CHECK", "SYN-HOLE-EXHAUSTION", "SYN-SAME-TERMINAL", "SYN-ALL-FLOATING-ISLAND",
        "SYN-RAILS-PREUNIONED-NO-CORD", "SYN-DATUM-NOT-LOWEST",
    ];

    private static readonly string[] ProbeIds =
        ["AT-01", "AT-04", "AT-05", "AT-06", "AT-07", "AT-09", "AT-10", "AT-11"];

    private static readonly ProbePin[] ProbePins =
    [
        new("AT-01", "i-exp9-latch/latched-after-release/coil-voltage", "6933"),
        new("AT-01", "i-exp9-latch/latched-after-release/relay-operated", "1000,1000"),
        new("AT-01", "i-exp9-latch/latched-after-release/holds-above-dropout", "46221,14787"),
        new("AT-04", "r180/settled/above-dropout", "39148,16667"),
        new("AT-04", "r180/settled/below-pullin", "39148,43333"),
        new("AT-04", "r220/settled/above-dropout", "34994,16667"),
        new("AT-04", "r220/settled/below-pullin", "34994,43333"),
        new("AT-04", "r270/settled/above-dropout", "30873,16667"),
        new("AT-04", "r270/settled/below-pullin", "30873,43333"),
        new("AT-04", "r330/settled/above-dropout", "27035,16667"),
        new("AT-04", "r330/settled/below-pullin", "27035,43333"),
        new("AT-04", "r390/settled/above-dropout", "24041,16667"),
        new("AT-04", "r390/settled/below-pullin", "24041,43333"),
        new("AT-04", "r470/settled/above-dropout", "20944,16667"),
        new("AT-04", "r470/settled/below-pullin", "20944,43333"),
        new("AT-04", "r120/settled/at-or-above-pullin", "48024,43333"),
        new("AT-04", "r150/settled/near-nominal-pullin", "43236"),
        new("AT-05", "realistic-c-fed/profile/settled-load", "818779"),
        new("AT-05", "realistic-c-fed/profile/below-trip", "818779,1500000"),
        new("AT-05", "e-fed-diagnostic/profile/settled-load", "1476564"),
        new("AT-05", "e-fed-diagnostic/profile/inrush-shorter-than-delay", "1005,2000"),
        new("AT-06", "dead-short/first-boundary/dead-short-current", "19402985"),
        new("AT-06", "dead-short/trip-boundary/rail-zero", "0,0"),
        new("AT-07", "e-fed/after-e-fed/relay-operated", "1000,1000"),
        new("AT-07", "e-fed/after-e-fed/indicator-dark", "0"),
        new("AT-07", "c-fed/after-c-fed/relay-operated", "1000,1000"),
        new("AT-07", "c-fed/after-c-fed/indicator-equals-coil", "47217,47217"),
        new("AT-07", "c-fed/after-c-fed/indicator-brightness", "749"),
        new("AT-07", "c-fed/after-c-fed/indicator-lit", "749,150"),
        new("AT-07", "c-fed/after-c-fed/holds-above-dropout", "47217,14787"),
        new("AT-09", "trip-and-reset/power-substitute-off/rail-zero", "0,0"),
        new("AT-09", "trip-and-reset/power-substitute-restored/rail-positive", "13000,0"),
        new("AT-10", "stop-short/settled/limited-current", "573445"),
        new("AT-10", "stop-short/settled/below-trip", "573445,1500000"),
        new("AT-11", "all-six-relays/after-step5-settle/relay1-operated", "1000,1000"),
        new("AT-11", "all-six-relays/after-step5-settle/relay2-operated", "1000,1000"),
        new("AT-11", "all-six-relays/after-step5-settle/relay3-operated", "1000,1000"),
        new("AT-11", "all-six-relays/after-step5-settle/relay4-operated", "1000,1000"),
        new("AT-11", "all-six-relays/after-step5-settle/relay5-operated", "1000,1000"),
        new("AT-11", "all-six-relays/after-step5-settle/relay6-operated", "1000,1000"),
        new("AT-11", "all-six-relays/after-step5-settle/relay1-holds", "45961,14787"),
        new("AT-11", "all-six-relays/after-step5-settle/relay2-holds", "46146,15540"),
        new("AT-11", "all-six-relays/after-step5-settle/relay3-holds", "46423,16293"),
        new("AT-11", "all-six-relays/after-step5-settle/relay4-holds", "46842,17040"),
        new("AT-11", "all-six-relays/after-step5-settle/relay5-holds", "47486,17793"),
        new("AT-11", "all-six-relays/after-step5-settle/relay6-holds", "48500,18547"),
    ];

    public static bool Requested { get; private set; }
    public static string? AcceptanceSuite { get; private set; }
    public static string? AcceptanceError { get; private set; }

    public override void _Ready()
    {
        var arguments = OS.GetCmdlineUserArgs();
        Requested = Array.IndexOf(arguments, "--selftest") >= 0;
        var acceptance = Array.IndexOf(arguments, "--acceptance");
        if (acceptance < 0) return;
        if (acceptance + 1 >= arguments.Length || string.IsNullOrWhiteSpace(arguments[acceptance + 1]))
        {
            AcceptanceError = "acceptance: --acceptance requires a suite name";
            return;
        }
        AcceptanceSuite = arguments[acceptance + 1];
    }

    public static int Run(IArtifactSource source) => Run(source, line => GD.Print(line));

    public static int Run(IArtifactSource source, Action<string> writeLine)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(writeLine);

        try
        {
            writeLine($"proof host={OS.GetName()} cpu={OS.GetProcessorName()} arch={Engine.GetArchitectureName()} audio={AudioServer.GetDriverName()} method={RenderingServer.GetCurrentRenderingMethod()} driver={RenderingServer.GetCurrentRenderingDriverName()}");
            RunProfileKat(source);
            writeLine("selftest: PASS data/kat/profile-kat.json profile=1/1 derived=10/10");

            RunW3Kat(source);
            writeLine("selftest: PASS data/kat/w3-derived-kat.json derived=9/9");

            RunContractionSentinel();
            writeLine("selftest: PASS runtime/fma-contraction sentinel=1/1");

            RunSolverKat(source);
            writeLine("selftest: PASS data/kat/solver-kat.json cases=21/21");

            RunNetlistKat(source);
            writeLine("selftest: PASS data/kat/netlist-kat.json cases=40/40");

            var (fixtureCount, goldenCount, manifestCount) = RunFixtures(source, writeLine);
            var probePins = RunProbes(source, writeLine);
            RunCollapseGate(source, writeLine);
            RunStaticGate(source, writeLine);

            Require(probePins == 46, "probe numeric pin count " + probePins + " != 46");
            Equal(manifestCount, source.EnumerateFiles("conformance/fixtures", "*.fixture.json").Count, "fixture inventory count");
            Equal(8, CollapseGate.IDS.Count, "collapse gate id count");
            writeLine(
                "selftest: PASS profile-kat=1/1 w3-derived-kat=9/9 contraction=1/1 solver-kat=21/21 " +
                "netlist-kat=40/40 fixtures=" + fixtureCount + "/" + manifestCount + " goldens=" + goldenCount + "/" + manifestCount +
                " probes=8/8 probe-pins=46/46 " +
                "collapse=8/8 static=2/2");
            var root = ((SceneTree)Engine.GetMainLoop()).Root;
            writeLine("selftest nodes=" + string.Join(",", root.GetChildren()
                .Select(node => node.Name.ToString())
                .Order(StringComparer.Ordinal)));
            return 0;
        }
        catch (Exception exception)
        {
            writeLine("selftest: FAIL " + exception.GetType().Name + ": " + exception.Message);
            if (exception.StackTrace is not null) writeLine(exception.StackTrace);
            return 1;
        }
    }

    private static void RunProfileKat(IArtifactSource source)
    {
        using var document = JsonDocument.Parse(source.ReadAllBytes("data/kat/profile-kat.json"));
        var root = document.RootElement;
        Equal("minivac.profile-kat/1", root.GetProperty("schema").GetString(), "profile KAT schema");
        var profile = Profile.LoadProfile(root.GetProperty("profile"));
        var expected = root.GetProperty("derived");

        Equal("MV601-KAT-A", profile.id, "profile KAT id");
        Equal(9, profile.pwl.Count, "profile KAT PWL count");
        Equal(expected.GetProperty("pullInUa").GetInt32(), profile.derived.pullInUa, "pullInUa");
        Equal(expected.GetProperty("dropOutUa").GetInt32(), profile.derived.dropOutUa, "dropOutUa");
        SequenceEqual(IntArray(expected.GetProperty("relayPullInUa")), profile.derived.relayPullInUa, "relayPullInUa");
        SequenceEqual(IntArray(expected.GetProperty("relayDropOutUa")), profile.derived.relayDropOutUa, "relayDropOutUa");
        Equal(expected.GetProperty("relayOperateTicks").GetInt64(), profile.derived.relayOperateTicks, "relayOperateTicks");
        Equal(expected.GetProperty("relayReleaseTicks").GetInt64(), profile.derived.relayReleaseTicks, "relayReleaseTicks");
        Equal(expected.GetProperty("pushbuttonTicks").GetInt64(), profile.derived.pushbuttonTicks, "pushbuttonTicks");
        Equal(expected.GetProperty("slideTicks").GetInt64(), profile.derived.slideTicks, "slideTicks");
        Equal(expected.GetProperty("arcStepUa").GetInt32(), profile.derived.arcStepUa, "arcStepUa");
        var expectedBits = ulong.Parse(
            expected.GetProperty("kThermal").GetString()!.AsSpan(2),
            NumberStyles.HexNumber,
            CultureInfo.InvariantCulture);
        Equal(unchecked((long)expectedBits), BitConverter.DoubleToInt64Bits(profile.derived.kThermal), "kThermal bits");
    }

    private static void RunW3Kat(IArtifactSource source)
    {
        using var profileDocument = JsonDocument.Parse(source.ReadAllBytes("data/kat/profile-kat.json"));
        using var document = JsonDocument.Parse(source.ReadAllBytes("data/kat/w3-derived-kat.json"));
        var profile = Profile.LoadProfile(profileDocument.RootElement.GetProperty("profile"));
        var root = document.RootElement;
        var sourcePin = root.GetProperty("source");
        var expected = root.GetProperty("derived");

        Equal("minivac.w3-derived-kat/1", root.GetProperty("schema").GetString(), "W3 KAT schema");
        Equal("data/kat/profile-kat.json", sourcePin.GetProperty("profileKat").GetString(), "W3 source path");
        Equal("MV601-KAT-A", sourcePin.GetProperty("profileId").GetString(), "W3 source profile id");
        Equal("8fb3c78e1d2c9a09", profile.hash, "W3 source profile hash");
        Equal(sourcePin.GetProperty("profileHash").GetString(), profile.hash, "W3 pinned profile hash");
        Equal(expected.GetProperty("tripDelayTicks").GetInt32(), profile.derived.tripDelayTicks, "tripDelayTicks");
        Equal(expected.GetProperty("deadShortUa").GetInt32(), profile.derived.deadShortUa, "deadShortUa");
        Equal(expected.GetProperty("rMotorParUohm").GetInt32(), profile.derived.rMotorParUohm, "rMotorParUohm");
        Equal(expected.GetProperty("vMotorRunMv").GetInt32(), profile.derived.vMotorRunMv, "vMotorRunMv");
        Equal(expected.GetProperty("relayCycleTicks").GetInt32(), profile.derived.relayCycleTicks, "relayCycleTicks");
        Equal(expected.GetProperty("buttonCycleTicks").GetInt32(), profile.derived.buttonCycleTicks, "buttonCycleTicks");
        Equal(expected.GetProperty("switchCycleTicks").GetInt32(), profile.derived.switchCycleTicks, "switchCycleTicks");
        Equal(expected.GetProperty("dialCycleTicks").GetInt32(), profile.derived.dialCycleTicks, "dialCycleTicks");
        Equal(expected.GetProperty("settleCapTicks").GetInt32(), profile.derived.settleCapTicks, "settleCapTicks");
    }

    private static void RunContractionSentinel()
    {
        var a = BitConverter.Int64BitsToDouble(unchecked((long)0x3ff0000000000001UL));
        var b = BitConverter.Int64BitsToDouble(unchecked((long)0x3feffffffffffffeUL));
        const double c = -1.0;
        var fused = Math.FusedMultiplyAdd(a, b, c);
        var separate = a * b + c;
        Require(fused != separate, "runtime contracted multiply-add");
        Equal(0.0, separate, "separate multiply-add sentinel");
    }

    private static void RunSolverKat(IArtifactSource source)
    {
        using var document = JsonDocument.Parse(source.ReadAllBytes("data/kat/solver-kat.json"));
        var root = document.RootElement;
        Equal("minivac.solver-kat/1", root.GetProperty("schema").GetString(), "solver KAT schema");
        var cases = root.GetProperty("cases");
        Equal(SolverCases.Length, cases.GetArrayLength(), "solver KAT count");

        for (var index = 0; index < SolverCases.Length; index++)
        {
            var testCase = cases[index];
            var name = SolverCases[index];
            Equal(name, testCase.GetProperty("name").GetString(), "solver KAT case " + index);
            switch (testCase.GetProperty("kind").GetString())
            {
                case "solve":
                    RunSolveCase(root, testCase, name);
                    break;
                case "pwl":
                    RunPwlCase(root, testCase, name);
                    break;
                case "quantize":
                    RunQuantizeCase(testCase, name);
                    break;
                default:
                    Fail("unknown solver KAT kind in " + name);
                    break;
            }
        }
    }

    private static void RunSolveCase(JsonElement root, JsonElement testCase, string name)
    {
        var pwlElement = root.GetProperty("pwl");
        var pwl = new Pwl(DecodeArray(pwlElement.GetProperty("xs")), DecodeArray(pwlElement.GetProperty("ys")));
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
        for (var tick = 1; tick < ticks; tick++) result = Solve.tickSolve(elements, carried, cfg);

        var expected = testCase.GetProperty("expect");
        SequenceEqual(StringArray(expected.GetProperty("v")), HexArray(result.v), name + " voltages");
        SequenceEqual(ByteArray(expected.GetProperty("floating")), result.floating, name + " floating");
        SequenceEqual(StringArray(expected.GetProperty("branchI")), HexArray(result.branchI), name + " branch currents");
        Equal(expected.GetProperty("arcPass").GetBoolean(), result.arcPass, name + " arcPass");
        Equal(expected.GetProperty("openRamp").GetBoolean(), result.openRamp, name + " openRamp");
        Equal(expected.GetProperty("nonPortable").GetBoolean(), result.nonPortable, name + " nonPortable");
        SequenceEqual(StringArray(expected.GetProperty("iCoil")), HexArray(carried.iCoil), name + " carried coils");
        SequenceEqual(StringArray(expected.GetProperty("rLamp")), HexArray(carried.rLamp), name + " carried lamps");
    }

    private static void RunPwlCase(JsonElement root, JsonElement testCase, string name)
    {
        var pwlElement = root.GetProperty("pwl");
        var pwl = new Pwl(DecodeArray(pwlElement.GetProperty("xs")), DecodeArray(pwlElement.GetProperty("ys")));
        var actual = Solve.pwlLookup(pwl, Decode(testCase.GetProperty("x").GetString()!));
        Equal(testCase.GetProperty("expect").GetProperty("y").GetString(), Hex(actual), name + " PWL result");
    }

    private static void RunQuantizeCase(JsonElement testCase, string name)
    {
        var flags = new PortFlags();
        var actual = Ints.quantize(
            Decode(testCase.GetProperty("x").GetString()!),
            Decode(testCase.GetProperty("scale").GetString()!),
            flags);
        var expected = testCase.GetProperty("expect");
        Equal(expected.GetProperty("q").GetInt32(), actual, name + " quantized value");
        Equal(expected.GetProperty("nonPortable").GetBoolean(), flags.nonPortable, name + " quantize portability");
    }

    private static void RunNetlistKat(IArtifactSource source)
    {
        using var document = JsonDocument.Parse(source.ReadAllBytes("data/kat/netlist-kat.json"));
        using var profileDocument = JsonDocument.Parse(source.ReadAllBytes("data/profiles/MV601-REF-A.json"));
        var netlist = Netlist.LoadNetlist(source.ReadAllBytes("data/netlist.json"));
        var profile = Profile.LoadProfile(profileDocument.RootElement);
        var root = document.RootElement;
        Equal("minivac.netlist-kat/1", root.GetProperty("schema").GetString(), "netlist KAT schema");
        var cases = root.GetProperty("cases");
        Equal(NetlistCases.Length, cases.GetArrayLength(), "netlist KAT count");

        for (var caseIndex = 0; caseIndex < NetlistCases.Length; caseIndex++)
        {
            var testCase = cases[caseIndex];
            var id = NetlistCases[caseIndex];
            Equal(id, testCase.GetProperty("id").GetString(), "netlist KAT case " + caseIndex);
            var wiresElement = testCase.GetProperty("wires");
            var terminalWires = new TerminalWire[wiresElement.GetArrayLength()];
            var resolvedCords = new ResolvedCord[wiresElement.GetArrayLength()];
            var wireIndex = 0;
            foreach (var wire in wiresElement.EnumerateArray())
            {
                Equal(wireIndex, wire.GetProperty("id").GetInt32(), id + " wire id");
                var a = Terminals.parseTerminalId(wire.GetProperty("a").GetString()!);
                var b = Terminals.parseTerminalId(wire.GetProperty("b").GetString()!);
                terminalWires[wireIndex] = new TerminalWire(a, b);
                resolvedCords[wireIndex] = new ResolvedCord(
                    wireIndex,
                    Terminals.terminalIndex(a),
                    Terminals.terminalIndex(b),
                    wire.TryGetProperty("r_uohm", out var resistance) ? resistance.GetInt32() : null);
                wireIndex++;
            }

            var expected = testCase.GetProperty("expect");
            if (expected.GetProperty("k").GetString() == "error")
            {
                try
                {
                    _ = Terminals.AllocateHoles(terminalWires);
                    Fail(id + " expected hole allocation failure");
                }
                catch (HoleAllocationException exception)
                {
                    Equal(expected.GetProperty("why").GetString(), exception.Code, id + " allocation code");
                    Equal(expected.GetProperty("wire").GetInt32(), exception.WireIndex, id + " allocation wire");
                }
                continue;
            }

            var allocated = Terminals.AllocateHoles(terminalWires);
            CheckHoles(expected.GetProperty("holes"), allocated, id);
            var graph = Graph.buildGraph(
                netlist,
                profile,
                new GraphInput(resolvedCords, ContactPositions(testCase.GetProperty("movers"), testCase.GetProperty("wiper").GetInt32())));
            CheckGraph(expected.GetProperty("partition"), graph, id);
            CheckFloating(expected.GetProperty("floating"), graph, id);
        }
    }

    private static (int Fixtures, int Goldens, int Manifest) RunFixtures(IArtifactSource source, Action<string> writeLine)
    {
        var fixturePaths = FixtureManifest.SourcePaths(source);
        SequenceEqual(fixturePaths, source.EnumerateFiles("conformance/fixtures", "*.fixture.json"), "fixture inventory");
        var fixtures = 0;
        var goldens = 0;
        foreach (var fixturePath in fixturePaths)
        {
            var result = TraceRunner.RunFixture(source, fixturePath);
            Require(result.failures.Count == 0, fixturePath + " has " + result.failures.Count + " expectation failures");
            fixtures++;
            var actual = new UTF8Encoding(false).GetBytes(result.trace);
            var goldenPath = fixturePath
                .Replace("conformance/fixtures/", "conformance/golden/", StringComparison.Ordinal)
                .Replace(".fixture.json", ".trace", StringComparison.Ordinal);
            SequenceEqual(source.ReadAllBytes(goldenPath), actual, fixturePath + " golden bytes");
            goldens++;
            writeLine("selftest: PASS " + fixturePath + " expect=pass golden=pass");
        }
        return (fixtures, goldens, fixturePaths.Count);
    }

    private static int RunProbes(IArtifactSource source, Action<string> writeLine)
    {
        var expectedPaths = Array.ConvertAll(ProbeIds, id => "conformance/probes/" + id + ".probe.json");
        SequenceEqual(expectedPaths, source.EnumerateFiles("conformance/probes", "*.probe.json"), "probe inventory");
        Equal(46, ProbePins.Length, "probe pin table count");
        var numericPins = 0;
        for (var index = 0; index < ProbeIds.Length; index++)
        {
            var result = ProbeRunner.Run(source, expectedPaths[index]);
            Equal("minivac.probe-result/1", result.schema, ProbeIds[index] + " result schema");
            Equal(ProbeIds[index], result.id, ProbeIds[index] + " result id");
            Require(result.pass, ProbeIds[index] + " probe checks failed");
            var actualPins = NumericMeasurements(result);
            var expectedPins = ProbePins.Where(pin => pin.ProbeId == ProbeIds[index]).ToArray();
            Equal(expectedPins.Length, actualPins.Count, ProbeIds[index] + " numeric pin count");
            foreach (var pin in expectedPins)
            {
                Require(actualPins.TryGetValue(pin.Key, out var actual), ProbeIds[index] + " missing numeric pin " + pin.Key);
                Equal(pin.Value, actual, ProbeIds[index] + " numeric pin " + pin.Key);
            }
            numericPins += expectedPins.Length;
            writeLine("selftest: PASS " + expectedPaths[index] + " numeric-pins=" + expectedPins.Length + "/" + expectedPins.Length);
        }
        return numericPins;
    }

    private static void RunCollapseGate(IArtifactSource source, Action<string> writeLine)
    {
        foreach (var id in CollapseGate.IDS)
        {
            var path = "conformance/fixtures/B/" + id + ".fixture.json";
            var loaded = FixtureLoader.LoadFixture(source, path);
            var baseline = TraceRunner.RunLoadedFixture(loaded);
            Require(baseline.failures.Count == 0, id + " baseline failed before collapse gate");
            var collapsedScript = CollapseGate.withoutCollapseSteps(loaded.fixture.script);
            Require(collapsedScript.Count < loaded.fixture.script.Count, id + " has no collapse step");
            var collapsed = TraceRunner.RunLoadedFixture(loaded with
            {
                fixture = loaded.fixture with { script = collapsedScript },
            });
            var functional = collapsed.failures
                .Where(failure => !CollapseGate.isControlPosition(failure.dev))
                .Select(CollapseFailure)
                .ToArray();
            SequenceEqual(CollapseGate.expectedFunctionalFailures(id), functional, id + " collapse failures");
            if (id == "II-SELFLOCK")
            {
                Require(collapsed.failures.Select(CollapseFailure).Contains(CollapseGate.SELF_LOCK_WITNESS),
                    "II-SELFLOCK collapse witness missing");
                Require(functional.Length == 0, "II-SELFLOCK has functional collapse failures");
            }
            writeLine("selftest: PASS " + path + " collapse=pass");
        }

        using var neutralisedDocument = NeutralisedProfile(source);
        var neutralised = Profile.LoadProfile(neutralisedDocument.RootElement);
        CheckNeutralisedCollapse(source, neutralised, "II-FF1", CollapseGate.NEUTRALISED_II_FF1);
        CheckNeutralisedCollapse(source, neutralised, "IV-FF2", CollapseGate.NEUTRALISED_IV_FF2);
    }

    private static void RunStaticGate(IArtifactSource source, Action<string> writeLine)
    {
        var report = StaticClassifier.RunStaticGate(source);
        Require(report.pass, "W2 static classifier failed");
        SequenceEqual(new[] { "IV-EXP1", "ER-ALTCOUNTER" }, report.rows.Select(row => row.id), "static ids");
        SequenceEqual(new[] { "111", "101" }, report.rows.Select(row => row.tuple), "static tuples");
        SequenceEqual(new[] { 44, 48 }, report.rows.Select(row => row.wires), "static wire counts");
        writeLine("selftest: PASS data/kat/w2-at02-static.json rows=2/2 tuples=111,101");
    }

    private static void CheckNeutralisedCollapse(
        IArtifactSource source,
        Profile neutralised,
        string id,
        IReadOnlyList<CollapseFailure> expected)
    {
        var loaded = FixtureLoader.LoadFixture(source, "conformance/fixtures/B/" + id + ".fixture.json");
        var result = TraceRunner.RunLoadedFixture(loaded with { profile = neutralised });
        SequenceEqual(expected, result.failures.Select(CollapseFailure), id + " neutralised-coil failures");
    }

    private static JsonDocument NeutralisedProfile(IArtifactSource source)
    {
        var raw = JsonNode.Parse(source.ReadAllBytes("data/profiles/MV601-REF-A.json"))!;
        raw["values"]!["L_coil_uh"]!["v"] = 12_000;
        return JsonDocument.Parse(Encoding.UTF8.GetBytes(raw.ToJsonString() + "\n"));
    }

    private static CollapseFailure CollapseFailure(ExpectationFailure failure) =>
        new(failure.scriptIndex, failure.dev, failure.expected, failure.actual);

    private static Dictionary<string, string> NumericMeasurements(ProbeResult result)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var probeCase in result.cases)
        {
            if (probeCase is not MachineCaseResult && probeCase is not ProfileLoadCaseResult)
                Fail("unknown probe case type " + probeCase.GetType().Name + " in " + probeCase.name);
            var checkpoints = probeCase is MachineCaseResult machine
                ? machine.checkpoints.Select(checkpoint => (checkpoint.name, checkpoint.checks))
                : [("profile", ((ProfileLoadCaseResult)probeCase).checks)];
            foreach (var checkpoint in checkpoints)
            {
                foreach (var check in checkpoint.checks)
                {
                    var key = probeCase.name + "/" + checkpoint.name + "/" + check.name;
                    if (check is NearCheckResult near)
                    {
                        Require(
                            values.TryAdd(key, near.actual.ToString(CultureInfo.InvariantCulture)),
                            "duplicate probe pin " + key);
                    }
                    else if (check is CompareCheckResult compare)
                    {
                        Require(
                            values.TryAdd(
                                key,
                                compare.left.ToString(CultureInfo.InvariantCulture) + "," +
                                compare.right.ToString(CultureInfo.InvariantCulture)),
                            "duplicate probe pin " + key);
                    }
                }
            }
        }
        return values;
    }

    private sealed record ProbePin(string ProbeId, string Key, string Value);

    private static void CheckHoles(JsonElement expected, IReadOnlyList<AllocatedCord> actual, string id)
    {
        Equal(expected.GetArrayLength(), actual.Count, id + " allocated hole count");
        var index = 0;
        foreach (var row in expected.EnumerateArray())
        {
            Equal(row.GetProperty("id").GetInt32(), actual[index].wireIndex, id + " allocated wire " + index);
            Equal(row.GetProperty("a").GetString(), actual[index].a.id, id + " allocated a " + index);
            Equal(row.GetProperty("b").GetString(), actual[index].b.id, id + " allocated b " + index);
            index++;
        }
    }

    private static void CheckGraph(JsonElement expected, BuiltGraph graph, string id)
    {
        var ordered = new List<int[]>();
        int[]? datumMembers = null;
        foreach (var expectedGroup in expected.EnumerateArray())
        {
            var members = expectedGroup.EnumerateArray()
                .Select(value => Terminals.terminalIndex(value.GetString()!))
                .ToArray();
            if (members.Contains(Terminals.terminalIndex("1-"))) datumMembers = members;
            else ordered.Add(members);
        }
        Require(datumMembers is not null, id + " partition lacks datum");
        ordered.Add(datumMembers!);
        Equal(ordered.Count - 1, graph.datum, id + " datum");
        Equal(graph.datum, graph.nodeCount - 1, id + " datum ordering");
        Equal(ordered.Count, graph.nodeCount, id + " node count");
        Equal(ordered.Count, graph.members.Count, id + " member group count");
        for (var node = 0; node < ordered.Count; node++)
            SequenceEqual(ordered[node], graph.members[node], id + " node members " + node);

        var expectedNodeByTerminal = new short[Terminals.TERMINAL_COUNT];
        for (var node = 0; node < ordered.Count; node++)
            foreach (var terminal in ordered[node]) expectedNodeByTerminal[terminal] = (short)node;
        SequenceEqual(expectedNodeByTerminal, graph.nodeByTerminal, id + " terminal-to-node map");
        Equal(expectedNodeByTerminal[Terminals.terminalIndex("1+")], graph.sourceNode, id + " source node");
    }

    private static void CheckFloating(JsonElement expected, BuiltGraph graph, string id)
    {
        var actual = graph.members
            .Where((_group, node) => graph.inSource[node] == 0)
            .Select(group => Terminals.TERMINAL_IDS[group[0]])
            .ToArray();
        SequenceEqual(expected.EnumerateArray().Select(value => value.GetString()!), actual, id + " floating sets");
    }

    private static int[] ContactPositions(JsonElement movers, int wiper)
    {
        var relays = IntArray(movers.GetProperty("relays"));
        var buttons = IntArray(movers.GetProperty("buttons"));
        var switches = IntArray(movers.GetProperty("switches"));
        var result = new int[31];
        for (var section = 0; section < 6; section++)
        {
            result[section * 5] = relays[section] / 1000;
            result[(section * 5) + 1] = relays[section] / 1000;
            result[(section * 5) + 2] = buttons[section] / 1000;
            result[(section * 5) + 3] = switches[section] / 1000;
            result[(section * 5) + 4] = switches[section] / 1000;
        }
        result[30] = wiper;
        return result;
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
                "coil" => new CoilEl(a, b, Decode(element.GetProperty("rOhm").GetString()!), Decode(element.GetProperty("lH").GetString()!)),
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
        Require(hex.Length == 18 && hex.StartsWith("0x", StringComparison.Ordinal), "invalid KAT hex double " + hex);
        for (var index = 2; index < hex.Length; index++)
            Require(hex[index] is >= '0' and <= '9' or >= 'a' and <= 'f', "invalid KAT hex double " + hex);
        var bits = ulong.Parse(hex.AsSpan(2), NumberStyles.AllowHexSpecifier, CultureInfo.InvariantCulture);
        return BitConverter.Int64BitsToDouble(unchecked((long)bits));
    }

    private static double[] DecodeArray(JsonElement source) =>
        source.EnumerateArray().Select(item => Decode(item.GetString()!)).ToArray();

    private static string Hex(double value) =>
        "0x" + unchecked((ulong)BitConverter.DoubleToInt64Bits(value)).ToString("x16", CultureInfo.InvariantCulture);

    private static string[] HexArray(IReadOnlyList<double> source) =>
        source.Select(Hex).ToArray();

    private static string[] StringArray(JsonElement source) =>
        source.EnumerateArray().Select(item => item.GetString()!).ToArray();

    private static byte[] ByteArray(JsonElement source) =>
        source.EnumerateArray().Select(item => item.GetByte()).ToArray();

    private static int[] IntArray(JsonElement source) =>
        source.EnumerateArray().Select(item => item.GetInt32()).ToArray();

    private static void SequenceEqual<T>(IEnumerable<T> expected, IEnumerable<T> actual, string where)
    {
        if (!expected.SequenceEqual(actual)) Fail(where + " mismatch");
    }

    private static void Equal<T>(T expected, T actual, string where)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            Fail(where + ": expected " + expected + ", got " + actual);
    }

    private static void Require(bool condition, string message)
    {
        if (!condition) Fail(message);
    }

    private static void Fail(string message) => throw new InvalidOperationException(message);
}
