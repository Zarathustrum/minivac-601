using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Json.Schema;
using Minivac.Core;

namespace Minivac.Conformance;

public sealed class ProbeException : Exception
{
    public ProbeException(string message) : base("probe: " + message) { }
}

public static class ProbeLoader
{
    private static readonly string[] MachineReadKinds = ["state", "relay", "lamp", "terminalPairMv", "profile"];
    private static readonly string[] ProfileReadKinds = ["load", "profile", "relayThreshold"];

    public static LoadedProbe loadProbe(
        IArtifactSource source,
        string relativePath,
        IProbeFixtureProvider? fixtures = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        var fixtureSchemaText = StrictText(source.ReadAllBytes("conformance/fixture.schema.json"), "fixture schema");
        var probeSchemaText = StrictText(source.ReadAllBytes("conformance/probe.schema.json"), "probe schema");
        var text = StrictText(source.ReadAllBytes(relativePath), relativePath);

        Dialect.Default = Dialect.Draft202012;
        var registry = new SchemaRegistry();
        var build = new BuildOptions { Dialect = Dialect.Draft202012, SchemaRegistry = registry };
        var fixtureSchema = BuildSchema(fixtureSchemaText, build, "fixture schema");
        registry.Register(fixtureSchema);
        registry.Register(new Uri("https://json-everything.lib/minivac.probe/minivac.fixture/1"), fixtureSchema);
        var probeSchema = BuildSchema(probeSchemaText, build, "probe schema");

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(text);
        }
        catch (JsonException)
        {
            throw new ProbeException(relativePath + " is not valid JSON");
        }

        using (document)
        {
            ValidateUnicodeFieldTokens(document.RootElement);
            var validation = probeSchema.Evaluate(document.RootElement, new EvaluationOptions
            {
                OutputFormat = OutputFormat.List,
                Culture = CultureInfo.InvariantCulture,
            });
            if (!validation.IsValid)
                throw new ProbeException("schema validation failed: " + RenderSchemaErrors(validation));

            var probe = ParseDocument(document.RootElement);
            fixtures ??= new ArtifactProbeFixtureProvider(source);
            ValidateUnicodeScalars(probe.source, "source");
            for (var i = 0; i < probe.modeledSubstitutions.Count; i++)
            {
                ValidateUnicodeScalars(probe.modeledSubstitutions[i].claim, "modeledSubstitutions[" + F(i) + "].claim");
                ValidateUnicodeScalars(probe.modeledSubstitutions[i].model, "modeledSubstitutions[" + F(i) + "].model");
            }
            ValidateUniqueNames(probe.cases, row => row.name, "cases");
            for (var i = 0; i < probe.cases.Count; i++)
            {
                if (probe.cases[i] is MachineCase machine)
                    ValidateMachineCase(machine, fixtures, "cases[" + F(i) + "]");
                else
                    ValidateProfileCase((ProfileLoadCase)probe.cases[i], "cases[" + F(i) + "]");
            }
            return new LoadedProbe(relativePath, probe);
        }
    }

    private static JsonSchema BuildSchema(string text, BuildOptions build, string where)
    {
        try
        {
            return JsonSchema.FromText(text, build);
        }
        catch (JsonException)
        {
            throw new ProbeException(where + " is not valid JSON");
        }
        catch (JsonSchemaException error)
        {
            throw new ProbeException(where + " is not a valid schema: " + error.Message);
        }
    }

    private static string StrictText(byte[] bytes, string where)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xef && bytes[1] == 0xbb && bytes[2] == 0xbf)
            throw new ProbeException(where + " has a UTF-8 BOM");
        for (var i = 0; i < bytes.Length; i++)
        {
            if (bytes[i] == 0x0d)
                throw new ProbeException(where + " contains CR at byte " + F(i));
        }
        try
        {
            return new UTF8Encoding(false, true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            throw new ProbeException(where + " is not valid UTF-8");
        }
    }

    private static string RenderSchemaErrors(EvaluationResults results)
    {
        results.ToList();
        var parts = new List<string>();
        foreach (var result in results.Details ?? [])
        {
            if (result.IsValid || result.Errors is null) continue;
            foreach (var error in result.Errors)
                parts.Add((result.InstanceLocation.ToString() is "" ? "/" : result.InstanceLocation.ToString()) + " " + error.Value);
        }
        return parts.Count == 0 ? "unknown schema error" : string.Join("; ", parts);
    }

    private static ProbeDocument ParseDocument(JsonElement root)
    {
        var cases = new List<ProbeCase>();
        foreach (var row in root.GetProperty("cases").EnumerateArray())
        {
            cases.Add(row.GetProperty("k").GetString() == "machine"
                ? ParseMachineCase(row)
                : ParseProfileLoadCase(row));
        }
        var substitutions = new List<ModeledObservableSubstitution>();
        if (root.TryGetProperty("modeledSubstitutions", out var rawSubstitutions))
        {
            foreach (var row in rawSubstitutions.EnumerateArray())
            {
                substitutions.Add(new ModeledObservableSubstitution(
                    String(row, "k"), String(row, "claim"), String(row, "model"),
                    String(row, "status"), row.GetProperty("sourceEquivalent").GetBoolean()));
            }
        }
        return new ProbeDocument(
            String(root, "schema"), String(root, "id"), String(root, "source"), String(root, "profile"),
            cases.AsReadOnly(), substitutions.AsReadOnly());
    }

    private static MachineCase ParseMachineCase(JsonElement row)
    {
        var rawSource = row.GetProperty("source");
        MachineSource source;
        if (String(rawSource, "k") == "fixture")
        {
            source = new FixtureMachineSource(String(rawSource, "fixture"));
        }
        else
        {
            var wires = Strings(rawSource.GetProperty("wires"));
            var actions = new List<ProbeAction>();
            foreach (var action in rawSource.GetProperty("actions").EnumerateArray())
                actions.Add(ParseAction(action));
            source = new ScenarioMachineSource(wires, actions.AsReadOnly());
        }

        var checkpoints = new List<MachineCheckpoint>();
        foreach (var checkpoint in row.GetProperty("checkpoints").EnumerateArray())
        {
            var address = checkpoint.GetProperty("at");
            CheckpointAddress at = String(address, "k") == "fixtureStep"
                ? new FixtureStepAddress(Int(address, "scriptIndex"), String(address, "stepKind"))
                : new ActionAddress(Int(address, "actionIndex"), String(address, "actionKind"));
            checkpoints.Add(new MachineCheckpoint(
                String(checkpoint, "name"), at, ParseChecks(checkpoint.GetProperty("checks"))));
        }
        return new MachineCase(String(row, "name"), source, checkpoints.AsReadOnly());
    }

    private static ProfileLoadCase ParseProfileLoadCase(JsonElement row)
    {
        var load = row.GetProperty("load");
        var powerLamp = load.GetProperty("powerLamp");
        return new ProfileLoadCase(
            String(row, "name"),
            new ProfileLoad(
                Int(load, "coils"), String(load, "feed"), Int(load, "outputLamps"),
                String(load, "indicatorLamps"),
                new PanelLampModelSubstitute(String(powerLamp, "k"), Int(powerLamp, "count"), String(powerLamp, "status"))),
            ParseChecks(row.GetProperty("checks")),
            row.TryGetProperty("diagnostic", out var diagnostic) && diagnostic.GetBoolean());
    }

    private static ProbeAction ParseAction(JsonElement row) => String(row, "k") switch
    {
        "do" => new ProbeDoAction(ParseCommand(row.GetProperty("cmd"))),
        "advance" => new ProbeAdvanceAction(Int(row, "ticks")),
        "settle" => new ProbeSettleAction(Int(row, "maxTicks")),
        _ => throw new InvalidOperationException("schema admitted an unknown probe action"),
    };

    internal static Command ParseCommand(JsonElement row) => String(row, "k") switch
    {
        "power" => new Command.Power(row.GetProperty("on").GetBoolean()),
        "breaker" => new Command.Breaker(),
        "connect" => new Command.Connect(
            Int(row, "cord"), ParseEnd(row.GetProperty("a")), ParseEnd(row.GetProperty("b")),
            row.TryGetProperty("r_uohm", out var resistance) ? Integer(resistance) : null),
        "disconnect" => new Command.Disconnect(Int(row, "cord")),
        "button" => new Command.Button(Int(row, "n"), Int(row, "target")),
        "switch" => new Command.Switch(Int(row, "n"), Int(row, "target")),
        "relayGrab" => new Command.RelayGrab(Int(row, "n"), Int(row, "target")),
        "relayRelease" => new Command.RelayRelease(Int(row, "n")),
        "dialGrab" => new Command.DialGrab(Int(row, "targetUdeg")),
        "dialRelease" => new Command.DialRelease(),
        _ => throw new InvalidOperationException("schema admitted an unknown command"),
    };

    private static CordEnd ParseEnd(JsonElement row) => String(row, "k") switch
    {
        "hole" => new CordEnd.Hole(String(row, "hole")),
        "touch" => new CordEnd.Touch(String(row, "term")),
        "free" => new CordEnd.Free(),
        _ => throw new InvalidOperationException("schema admitted an unknown cord end"),
    };

    private static IReadOnlyList<ProbeCheck> ParseChecks(JsonElement rows)
    {
        var checks = new List<ProbeCheck>();
        foreach (var row in rows.EnumerateArray())
        {
            var kind = String(row, "k");
            var name = String(row, "name");
            checks.Add(kind switch
            {
                "near" => new NearProbeCheck(name, ParseRead(row.GetProperty("read")), Int(row, "expected"), Int(row, "tolerance")),
                "compare" => new CompareProbeCheck(name, ParseRead(row.GetProperty("left")), String(row, "op"), ParseOperand(row.GetProperty("right"))),
                "bool" => new BoolProbeCheck(name, ParseBoolRead(row.GetProperty("read")), row.GetProperty("expected").GetBoolean()),
                "eventSeen" => new EventSeenProbeCheck(name, ParseEvent(row.GetProperty("event")), row.GetProperty("expected").GetBoolean()),
                _ => throw new InvalidOperationException("schema admitted an unknown probe check"),
            });
        }
        return checks.AsReadOnly();
    }

    private static NumericRead ParseRead(JsonElement row) => String(row, "k") switch
    {
        "state" => new StateNumericRead(String(row, "field")),
        "relay" => new RelayNumericRead(Int(row, "n"), String(row, "field")),
        "lamp" => new LampNumericRead(String(row, "kind"), Int(row, "n"), String(row, "field")),
        "terminalPairMv" => new TerminalPairMvRead(String(row, "a"), String(row, "b")),
        "load" => new LoadNumericRead(String(row, "field")),
        "profile" => new ProfileNumericRead(String(row, "field")),
        "relayThreshold" => new RelayThresholdNumericRead(Int(row, "n"), String(row, "field")),
        _ => throw new InvalidOperationException("schema admitted an unknown numeric read"),
    };

    private static NumericOperand ParseOperand(JsonElement row) =>
        String(row, "k") == "literal" ? new LiteralNumericOperand(Int(row, "value")) : new ReadNumericOperand(ParseRead(row));

    private static BoolRead ParseBoolRead(JsonElement row) => String(row, "k") == "stateBool"
        ? new StateBoolRead(String(row, "field"))
        : new RelayBoolRead(Int(row, "n"), String(row, "field"));

    private static EventSelector ParseEvent(JsonElement row) => new(
        String(row, "k"), row.TryGetProperty("n", out var n) ? (int?)Integer(n) : null);

    private static void ValidateMachineCase(MachineCase row, IProbeFixtureProvider fixtures, string where)
    {
        ValidateUniqueNames(row.checkpoints, item => item.name, where + ".checkpoints");
        var last = -1;
        for (var i = 0; i < row.checkpoints.Count; i++)
        {
            var checkpoint = row.checkpoints[i];
            if (checkpoint.at.Index <= last)
                throw new ProbeException(where + ".checkpoints must use strictly increasing source indexes");
            last = checkpoint.at.Index;
            ValidateUniqueNames(checkpoint.checks, item => item.name, where + ".checkpoints[" + F(i) + "].checks");
            for (var j = 0; j < checkpoint.checks.Count; j++)
                ValidateCheckScope(checkpoint.checks[j], true, where + ".checkpoints[" + F(i) + "].checks[" + F(j) + "]");
        }

        if (row.source is FixtureMachineSource fixtureSource)
        {
            foreach (var checkpoint in row.checkpoints)
            {
                if (checkpoint.at is not FixtureStepAddress)
                    throw new ProbeException(where + " fixture source requires fixtureStep checkpoints");
            }
            var fixture = fixtures.LoadFixture(fixtureSource.fixture);
            foreach (var checkpoint in row.checkpoints)
            {
                var at = (FixtureStepAddress)checkpoint.at;
                if (at.scriptIndex >= fixture.fixture.script.Count)
                    throw new ProbeException(where + " checkpoint scriptIndex is outside fixture " + fixtureSource.fixture);
                var actual = fixture.fixture.script[at.scriptIndex].k;
                if (actual != at.stepKind)
                    throw new ProbeException(where + " checkpoint expected script[" + F(at.scriptIndex) + "]=" + at.stepKind + ", got " + actual);
            }
            return;
        }

        var scenario = (ScenarioMachineSource)row.source;
        var wires = new List<TerminalWire>(scenario.wires.Count);
        for (var i = 0; i < scenario.wires.Count; i++)
        {
            try { wires.Add(Terminals.parseTerminalWire(scenario.wires[i])); }
            catch (Exception error) { throw new ProbeException(where + ".source.wires[" + F(i) + "] is not physical: " + error.Message); }
        }
        try { Terminals.AllocateHoles(wires); }
        catch (Exception error) { throw new ProbeException(where + ".source.wires cannot allocate holes: " + error.Message); }
        for (var i = 0; i < scenario.actions.Count; i++)
        {
            if (scenario.actions[i] is ProbeDoAction action)
                ValidateCommandSemantics(action.cmd, where + ".source.actions[" + F(i) + "].cmd");
        }
        foreach (var checkpoint in row.checkpoints)
        {
            if (checkpoint.at is not ActionAddress at)
                throw new ProbeException(where + " scenario source requires action checkpoints");
            if (at.actionIndex >= scenario.actions.Count)
                throw new ProbeException(where + " checkpoint actionIndex is outside scenario");
            var actual = scenario.actions[at.actionIndex].k;
            if (actual != at.actionKind)
                throw new ProbeException(where + " checkpoint expected action[" + F(at.actionIndex) + "]=" + at.actionKind + ", got " + actual);
        }
    }

    private static void ValidateProfileCase(ProfileLoadCase row, string where)
    {
        if (row.load.feed == "C" && row.load.indicatorLamps != "series-with-coils")
            throw new ProbeException(where + " C feed requires series-with-coils indicator lamps");
        if (row.load.feed == "E" && row.load.indicatorLamps != "across-rail")
            throw new ProbeException(where + " E feed requires across-rail indicator lamps");
        ValidateUniqueNames(row.checks, item => item.name, where + ".checks");
        for (var i = 0; i < row.checks.Count; i++)
            ValidateCheckScope(row.checks[i], false, where + ".checks[" + F(i) + "]");
    }

    private static void ValidateCheckScope(ProbeCheck check, bool machine, string where)
    {
        if (!machine && check is BoolProbeCheck or EventSeenProbeCheck)
            throw new ProbeException(where + " profileLoad checks cannot read Machine booleans or events");
        foreach (var read in ReadsOf(check))
        {
            var kinds = machine ? MachineReadKinds : ProfileReadKinds;
            if (Array.IndexOf(kinds, read.k) < 0)
                throw new ProbeException(where + " uses " + read.k + " in the wrong execution scope");
            if (read is TerminalPairMvRead pair)
            {
                try { Terminals.parseTerminalId(pair.a); Terminals.parseTerminalId(pair.b); }
                catch (Exception error) { throw new ProbeException(where + " has a non-physical terminal-pair read: " + error.Message); }
            }
        }
    }

    private static IEnumerable<NumericRead> ReadsOf(ProbeCheck check)
    {
        if (check is NearProbeCheck near) yield return near.read;
        if (check is not CompareProbeCheck compare) yield break;
        yield return compare.left;
        if (compare.right is ReadNumericOperand right) yield return right.read;
    }

    private static void ValidateCommandSemantics(Command command, string where)
    {
        if (command is not Command.Connect connect) return;
        var ends = new[] { connect.a, connect.b };
        for (var i = 0; i < ends.Length; i++)
        {
            try
            {
                if (ends[i] is CordEnd.Hole hole) Terminals.parseHoleId(hole.hole);
                else if (ends[i] is CordEnd.Touch touch) Terminals.parseTerminalId(touch.term);
            }
            catch (Exception error)
            {
                throw new ProbeException(where + ".end[" + F(i) + "] is not physical: " + error.Message);
            }
        }
    }

    private static void ValidateUniqueNames<T>(IReadOnlyList<T> items, Func<T, string> name, string where)
    {
        var seen = new List<string>();
        foreach (var item in items)
        {
            var value = name(item);
            if (seen.Contains(value))
                throw new ProbeException(where + " has duplicate name " + JsonSerializer.Serialize(value));
            seen.Add(value);
        }
    }

    private static void ValidateUnicodeScalars(string text, string where)
    {
        for (var i = 0; i < text.Length; i++)
        {
            var unit = text[i];
            if (char.IsHighSurrogate(unit))
            {
                if (i + 1 >= text.Length || !char.IsLowSurrogate(text[i + 1]))
                    throw new ProbeException(where + " contains an unpaired high surrogate");
                i++;
            }
            else if (char.IsLowSurrogate(unit))
            {
                throw new ProbeException(where + " contains an unpaired low surrogate");
            }
        }
    }

    private static void ValidateUnicodeFieldTokens(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object) return;
        if (root.TryGetProperty("source", out var source) && source.ValueKind == JsonValueKind.String)
            ValidateUnicodeScalarToken(source.GetRawText(), "source");
        if (!root.TryGetProperty("modeledSubstitutions", out var substitutions) ||
            substitutions.ValueKind != JsonValueKind.Array) return;
        var index = 0;
        foreach (var row in substitutions.EnumerateArray())
        {
            if (row.ValueKind == JsonValueKind.Object)
            {
                if (row.TryGetProperty("claim", out var claim) && claim.ValueKind == JsonValueKind.String)
                    ValidateUnicodeScalarToken(claim.GetRawText(), "modeledSubstitutions[" + F(index) + "].claim");
                if (row.TryGetProperty("model", out var model) && model.ValueKind == JsonValueKind.String)
                    ValidateUnicodeScalarToken(model.GetRawText(), "modeledSubstitutions[" + F(index) + "].model");
            }
            index++;
        }
    }

    private static void ValidateUnicodeScalarToken(string token, string where)
    {
        for (var index = 1; index < token.Length - 1; index++)
        {
            if (token[index] != '\\') continue;
            if (index + 1 >= token.Length - 1) return;
            if (token[index + 1] != 'u')
            {
                index++;
                continue;
            }
            var unit = HexUnit(token, index + 2);
            if (char.IsHighSurrogate((char)unit))
            {
                if (index + 11 >= token.Length || token[index + 6] != '\\' || token[index + 7] != 'u' ||
                    !char.IsLowSurrogate((char)HexUnit(token, index + 8)))
                    throw new ProbeException(where + " contains an unpaired high surrogate");
                index += 11;
            }
            else
            {
                if (char.IsLowSurrogate((char)unit))
                    throw new ProbeException(where + " contains an unpaired low surrogate");
                index += 5;
            }
        }
    }

    private static int HexUnit(string token, int start)
    {
        if (start + 4 > token.Length) return -1;
        var value = 0;
        for (var i = 0; i < 4; i++)
        {
            var c = token[start + i];
            var digit = c is >= '0' and <= '9' ? c - '0' :
                c is >= 'a' and <= 'f' ? c - 'a' + 10 :
                c is >= 'A' and <= 'F' ? c - 'A' + 10 : -1;
            if (digit < 0) return -1;
            value = value * 16 + digit;
        }
        return value;
    }

    private static string String(JsonElement row, string property) => row.GetProperty(property).GetString()!;

    private static int Int(JsonElement row, string property) => checked((int)Integer(row.GetProperty(property)));

    private static long Integer(JsonElement value)
    {
        if (value.TryGetInt64(out var integer)) return integer;
        if (value.TryGetDecimal(out var decimalValue) && decimal.Truncate(decimalValue) == decimalValue)
            return checked((long)decimalValue);
        throw new ProbeException("schema integer could not be represented exactly");
    }

    private static IReadOnlyList<string> Strings(JsonElement rows)
    {
        var values = new List<string>();
        foreach (var row in rows.EnumerateArray()) values.Add(row.GetString()!);
        return values.AsReadOnly();
    }

    private static string F(int value) => value.ToString(CultureInfo.InvariantCulture);
}
