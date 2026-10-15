using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.IO;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using Minivac.Core;

namespace Minivac.Conformance;

public sealed record StaticWire(int id, string a, string b);

public sealed record StaticState(
    IReadOnlyList<int> relays,
    IReadOnlyList<int> buttons,
    IReadOnlyList<int> switches,
    int wiper);

public sealed record StaticProgram(string id, string source, IReadOnlyList<StaticWire> wires);

public sealed record StaticInput(string schema, StaticState state, IReadOnlyList<StaticProgram> programs);

public sealed record StaticRow(
    string id,
    string source,
    int wires,
    IReadOnlyList<bool> lamps,
    string tuple);

public sealed record StaticReport(StaticInput input, IReadOnlyList<StaticRow> rows, bool pass);

public sealed record ClassifierGraph(
    IReadOnlyList<El> elements,
    IReadOnlyList<string> elementIds,
    int nodeCount);

public sealed class StaticClassifierException : Exception
{
    public StaticClassifierException(string message) : base("check-netlist: " + message) { }
}

public static class StaticClassifier
{
    public const string STATIC_SCHEMA = "minivac.w2-at02-static/1";
    public const string REVIEWED_STATIC_INPUT_FNV64 = "7dfc1d82a9341248";

    public static StaticReport RunStaticGate(IArtifactSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        var input = LoadStaticInput(source, "data/kat/w2-at02-static.json");
        var netlist = Netlist.LoadNetlist(source.ReadAllBytes("data/netlist.json"));
        using var profileDocument = StrictJson.Read(source, "data/profiles/MV601-REF-A.json", "MV601-REF-A profile", StaticFailure);
        var profile = Profile.LoadProfile(profileDocument.RootElement);
        var positions = ContactPositions(input.state);
        var rows = new StaticRow[input.programs.Count];
        for (var index = 0; index < input.programs.Count; index++)
        {
            var program = input.programs[index];
            var graph = Graph.buildGraph(netlist, profile, new GraphInput(ResolvedCords(program), positions));
            var lamps = new[]
            {
                ClassifyLamp(new ClassifierGraph(graph.elements, graph.elementIds, graph.nodeCount), "out4"),
                ClassifyLamp(new ClassifierGraph(graph.elements, graph.elementIds, graph.nodeCount), "out5"),
                ClassifyLamp(new ClassifierGraph(graph.elements, graph.elementIds, graph.nodeCount), "out6"),
            };
            var tuple = (lamps[0] ? "1" : "0") + (lamps[1] ? "1" : "0") + (lamps[2] ? "1" : "0");
            rows[index] = new StaticRow(program.id, program.source, program.wires.Count, Array.AsReadOnly(lamps), tuple);
        }
        var pass = rows.Length == 2 && rows[0].tuple == "111" && rows[1].tuple == "101";
        return new StaticReport(input, Array.AsReadOnly(rows), pass);
    }

    public static StaticInput LoadStaticInput(IArtifactSource source, string relativePath)
    {
        ArgumentNullException.ThrowIfNull(source);
        using var document = StrictJson.Read(source, relativePath, relativePath, StaticFailure);
        return LoadStaticInput(document.RootElement);
    }

    public static StaticInput LoadStaticInput(JsonElement raw)
    {
        ExactKeys(raw, ["schema", "state", "programs"], "document");
        var schema = String(raw.GetProperty("schema"), "schema");
        if (schema != STATIC_SCHEMA)
            Fail("schema must be " + JsonSerializer.Serialize(STATIC_SCHEMA));

        var rawState = raw.GetProperty("state");
        ExactKeys(rawState, ["relays", "buttons", "switches", "wiper"], "state");
        var state = new StaticState(
            StopArray(rawState.GetProperty("relays"), [1000, 1000, 0, 0, 0, 0], "state.relays"),
            StopArray(rawState.GetProperty("buttons"), [0, 0, 0, 0, 0, 0], "state.buttons"),
            StopArray(rawState.GetProperty("switches"), [0, 0, 0, 0, 0, 0], "state.switches"),
            Integer(rawState.GetProperty("wiper"), "state.wiper"));
        if (state.wiper != 0)
            Fail("state.wiper must be frozen at 0");

        var rawPrograms = raw.GetProperty("programs");
        if (rawPrograms.ValueKind != JsonValueKind.Array || rawPrograms.GetArrayLength() != 2)
            Fail("programs must contain IV-EXP1 then ER-ALTCOUNTER");
        var ids = new[] { "IV-EXP1", "ER-ALTCOUNTER" };
        var wireCounts = new[] { 44, 48 };
        var programs = new StaticProgram[2];
        for (var programIndex = 0; programIndex < programs.Length; programIndex++)
        {
            var where = "programs[" + programIndex + "]";
            var row = rawPrograms[programIndex];
            ExactKeys(row, ["id", "source", "wires"], where);
            var id = String(row.GetProperty("id"), where + ".id");
            if (id != ids[programIndex])
                Fail(where + ".id must be " + ids[programIndex]);
            var source = String(row.GetProperty("source"), where + ".source");
            if (source != "docs/research/programs.md#" + id)
                Fail(where + ".source is not the frozen citation");
            var rawWires = row.GetProperty("wires");
            if (rawWires.ValueKind != JsonValueKind.Array || rawWires.GetArrayLength() != wireCounts[programIndex])
                Fail(where + ".wires must contain " + wireCounts[programIndex] + " rows");
            var wires = new StaticWire[rawWires.GetArrayLength()];
            for (var wireIndex = 0; wireIndex < wires.Length; wireIndex++)
                wires[wireIndex] = LoadStaticWire(rawWires[wireIndex], wireIndex, where + ".wires[" + wireIndex + "]");
            programs[programIndex] = new StaticProgram(id, source, Array.AsReadOnly(wires));
        }

        var input = new StaticInput(schema, state, Array.AsReadOnly(programs));
        var hash = Ints.fnv1a64(StaticInputProjection(input));
        if (hash != REVIEWED_STATIC_INPUT_FNV64)
            Fail("reviewed static input projection hash " + hash + " != " + REVIEWED_STATIC_INPUT_FNV64);
        return input;
    }

    public static bool ClassifyLamp(ClassifierGraph graph, string targetId)
    {
        ArgumentNullException.ThrowIfNull(graph);
        if (graph.elements.Count != graph.elementIds.Count)
            Fail("element/id cardinality mismatch");
        var target = UniqueIndex(graph.elementIds, targetId, "target must occur exactly once");
        var source = UniqueIndex(graph.elementIds, "PSU", "PSU must occur exactly once");
        if (graph.elements[target] is not LampEl)
            Fail(targetId + " is not a lamp");
        if (graph.elements[source] is not SourceEl)
            Fail("PSU is not a source");
        var targetElement = (LampEl)graph.elements[target];
        var sourceElement = (SourceEl)graph.elements[source];
        if (targetElement.a == targetElement.b)
            return false;

        var roots = ComponentRoots(graph, target, source);
        var plus = roots[sourceElement.a];
        var minus = roots[sourceElement.b];
        var a = roots[targetElement.a];
        var b = roots[targetElement.b];
        return a == plus && b == minus || a == minus && b == plus;
    }

    private static StaticWire LoadStaticWire(JsonElement raw, int index, string where)
    {
        ExactKeys(raw, ["id", "a", "b"], where);
        var id = Integer(raw.GetProperty("id"), where + ".id");
        if (id != index || id < 0)
            Fail(where + ".id must equal its array index");
        var a = PhysicalTerminal(raw.GetProperty("a"), where + ".a");
        var b = PhysicalTerminal(raw.GetProperty("b"), where + ".b");
        return new StaticWire(id, a, b);
    }

    private static byte[] StaticInputProjection(StaticInput input)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, new JsonWriterOptions
        {
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        }))
        {
            writer.WriteStartArray();
            writer.WriteStringValue(input.schema);
            writer.WriteStartArray();
            WriteIntegers(writer, input.state.relays);
            WriteIntegers(writer, input.state.buttons);
            WriteIntegers(writer, input.state.switches);
            writer.WriteNumberValue(input.state.wiper);
            writer.WriteEndArray();
            writer.WriteStartArray();
            for (var programIndex = 0; programIndex < input.programs.Count; programIndex++)
            {
                var program = input.programs[programIndex];
                writer.WriteStartArray();
                writer.WriteStringValue(program.id);
                writer.WriteStringValue(program.source);
                writer.WriteStartArray();
                for (var wireIndex = 0; wireIndex < program.wires.Count; wireIndex++)
                {
                    var wire = program.wires[wireIndex];
                    writer.WriteStartArray();
                    writer.WriteNumberValue(wire.id);
                    writer.WriteStringValue(wire.a);
                    writer.WriteStringValue(wire.b);
                    writer.WriteEndArray();
                }
                writer.WriteEndArray();
                writer.WriteEndArray();
            }
            writer.WriteEndArray();
            writer.WriteEndArray();
        }
        return stream.ToArray();
    }

    private static int[] ComponentRoots(ClassifierGraph graph, int target, int source)
    {
        if (graph.nodeCount < 0)
            Fail("node count must be nonnegative");
        var parent = new int[graph.nodeCount];
        for (var index = 0; index < parent.Length; index++)
            parent[index] = index;
        int Find(int start)
        {
            var at = start;
            while (parent[at] != at)
                at = parent[at];
            return at;
        }
        void Union(int a, int b)
        {
            var rootA = Find(a);
            var rootB = Find(b);
            if (rootA != rootB)
                parent[rootB] = rootA;
        }
        for (var index = 0; index < graph.elements.Count; index++)
        {
            if (index == target || index == source)
                continue;
            var element = graph.elements[index];
            Union(element.a, element.b);
        }
        for (var index = 0; index < parent.Length; index++)
            parent[index] = Find(index);
        return parent;
    }

    private static IReadOnlyList<int> ContactPositions(StaticState state)
    {
        var positions = new int[31];
        var index = 0;
        for (var section = 0; section < 6; section++)
        {
            var relay = state.relays[section] / 1000;
            var button = state.buttons[section] / 1000;
            var slide = state.switches[section] / 1000;
            positions[index++] = relay;
            positions[index++] = relay;
            positions[index++] = button;
            positions[index++] = slide;
            positions[index++] = slide;
        }
        positions[index] = state.wiper;
        return Array.AsReadOnly(positions);
    }

    private static IReadOnlyList<ResolvedCord> ResolvedCords(StaticProgram program)
    {
        var pairs = new TerminalWire[program.wires.Count];
        var cords = new ResolvedCord[program.wires.Count];
        for (var index = 0; index < program.wires.Count; index++)
        {
            var wire = program.wires[index];
            pairs[index] = new TerminalWire(Terminals.parseTerminalId(wire.a), Terminals.parseTerminalId(wire.b));
            cords[index] = new ResolvedCord(wire.id, Terminals.terminalIndex(wire.a), Terminals.terminalIndex(wire.b));
        }
        Terminals.AllocateHoles(pairs);
        return Array.AsReadOnly(cords);
    }

    private static IReadOnlyList<int> StopArray(JsonElement raw, int[] expected, string where)
    {
        if (raw.ValueKind != JsonValueKind.Array || raw.GetArrayLength() != 6)
            Fail(where + " must contain six stops");
        var values = new int[6];
        for (var index = 0; index < values.Length; index++)
        {
            var stop = Integer(raw[index], where + "[" + index + "]");
            if (stop != 0 && stop != 1000)
                Fail(where + "[" + index + "] must be 0 or 1000");
            if (stop != expected[index])
                Fail(where + "[" + index + "] does not match the frozen count-4 state");
            values[index] = stop;
        }
        return Array.AsReadOnly(values);
    }

    private static void ExactKeys(JsonElement raw, string[] keys, string where)
    {
        if (raw.ValueKind != JsonValueKind.Object)
            Fail(where + " must be an object");
        foreach (var property in raw.EnumerateObject())
        {
            var found = false;
            for (var index = 0; index < keys.Length; index++)
            {
                if (property.NameEquals(keys[index]))
                {
                    found = true;
                    break;
                }
            }
            if (!found)
                Fail(where + " must contain exactly " + string.Join(',', keys));
        }
        for (var index = 0; index < keys.Length; index++)
        {
            if (!raw.TryGetProperty(keys[index], out _))
                Fail(where + " is missing " + keys[index]);
        }
    }

    private static string PhysicalTerminal(JsonElement raw, string where)
    {
        var value = String(raw, where);
        try
        {
            return Terminals.parseTerminalId(value);
        }
        catch (TerminalsException error)
        {
            throw new StaticClassifierException(error.Message);
        }
    }

    private static string String(JsonElement raw, string where)
    {
        if (raw.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(raw.GetString()))
            Fail(where + " must be a non-empty string");
        return raw.GetString()!;
    }

    private static int Integer(JsonElement raw, string where)
    {
        if (raw.ValueKind != JsonValueKind.Number)
            Fail(where + " must be a safe integer");
        if (raw.TryGetInt32(out var integer))
            return integer;
        try
        {
            var number = raw.GetDecimal();
            if (number != decimal.Truncate(number) || number < int.MinValue || number > int.MaxValue)
                Fail(where + " must be a safe integer");
            return (int)number;
        }
        catch (FormatException)
        {
            Fail(where + " must be a safe integer");
            return 0;
        }
    }

    private static int UniqueIndex(IReadOnlyList<string> values, string target, string error)
    {
        var found = -1;
        for (var index = 0; index < values.Count; index++)
        {
            if (!string.Equals(values[index], target, StringComparison.Ordinal))
                continue;
            if (found >= 0)
                Fail(error);
            found = index;
        }
        if (found < 0)
            Fail(error);
        return found;
    }

    private static void WriteIntegers(Utf8JsonWriter writer, IReadOnlyList<int> values)
    {
        writer.WriteStartArray();
        for (var index = 0; index < values.Count; index++)
            writer.WriteNumberValue(values[index]);
        writer.WriteEndArray();
    }

    private static Exception StaticFailure(string message) => new StaticClassifierException(message);

    private static void Fail(string message) => throw new StaticClassifierException(message);
}
