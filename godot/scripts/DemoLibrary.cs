using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Diagnostics.CodeAnalysis;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Minivac.Conformance;
using Minivac.Core;

namespace Minivac.Godot;

public enum DemoCategory { counter, game, comparison, random, logic, alarm, memory, control, @lock, code, arithmetic }

public enum DemoConfidence { verified, likely, unverified }

public sealed record DemoSource(
    string Program,
    string Locator,
    DemoConfidence Confidence,
    IReadOnlyList<string> Errata,
    IReadOnlyList<string> Fallbacks);

public sealed record DemoInitial(
    bool Power,
    IReadOnlyList<int> Switches,
    IReadOnlyList<int> Buttons,
    IReadOnlyList<int?> RelayHands,
    long? DialHand);

public sealed record DemoConnection(string Wire, CordEnd A, CordEnd B, long? ResistanceUohm);

public sealed record Demo(
    string Id,
    string Title,
    DemoCategory Category,
    DemoSource Source,
    IReadOnlyList<DemoConnection> Connections,
    DemoInitial Initial,
    IReadOnlyList<string> Instructions,
    IReadOnlyDictionary<string, string> ControlLabels,
    string? Notice,
    IReadOnlyList<Command> Commands)
{
    public SessionDemo SessionDemo => new(Id, Commands);
}

public sealed partial class DemoLibrary
{
    public const string DEMO_LIBRARY_SCHEMA = "minivac.demo-library/1";
    public static readonly SessionDemo MANUAL = new("MANUAL", Array.Empty<Command>());

    private static readonly string[] DocumentKeys = ["schema", "demos"];
    private static readonly string[] DemoKeys =
        ["id", "title", "category", "source", "connections", "initial", "instructions", "controlLabels", "notice"];
    private static readonly string[] SourceKeys = ["program", "locator", "confidence", "errata", "fallbacks"];
    private static readonly string[] InitialKeys = ["power", "switches", "buttons", "relayHands", "dialHand"];
    private static readonly string[] ConnectionKeys = ["wire", "r_uohm"];

    private readonly IReadOnlyList<Demo> _demos;

    private DemoLibrary(IReadOnlyList<Demo> demos) => _demos = demos;

    public string Schema => DEMO_LIBRARY_SCHEMA;
    public IReadOnlyList<Demo> Demos => _demos;

    public static DemoLibrary Load(IArtifactSource source, LoadedNetlist netlist)
    {
        ArgumentNullException.ThrowIfNull(source);
        return Parse(source.ReadAllBytes("data/demo-library.json"), netlist);
    }

    public static DemoLibrary Parse(byte[] bytes, LoadedNetlist netlist)
    {
        ArgumentNullException.ThrowIfNull(bytes);
        ArgumentNullException.ThrowIfNull(netlist);
        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(bytes);
        }
        catch (JsonException)
        {
            throw new InvalidOperationException("demo library: document is not valid JSON");
        }
        using (document)
        {
            var root = Object(document.RootElement, "document");
            ExactKeys(root, DocumentKeys, "document");
            if (String(Required(root, "schema", "document"), "document.schema") != DEMO_LIBRARY_SCHEMA)
                Fail("document.schema must be " + JsonSerializer.Serialize(DEMO_LIBRARY_SCHEMA));
            var rows = Required(root, "demos", "document");
            if (rows.ValueKind != JsonValueKind.Array || rows.GetArrayLength() != 17)
                Fail("document.demos must contain exactly seventeen demos");
            var demos = new Demo[rows.GetArrayLength()];
            var ids = new HashSet<string>(StringComparer.Ordinal);
            var index = 0;
            foreach (var row in rows.EnumerateArray())
            {
                demos[index] = LoadDemo(row, netlist, index);
                if (!ids.Add(demos[index].Id)) Fail("duplicate id " + JsonSerializer.Serialize(demos[index].Id));
                index++;
            }
            return new DemoLibrary(Array.AsReadOnly(demos));
        }
    }

    public Demo Get(string id)
    {
        for (var index = 0; index < _demos.Count; index++)
        {
            if (string.Equals(_demos[index].Id, id, StringComparison.Ordinal)) return _demos[index];
        }
        Fail("unknown demo " + JsonSerializer.Serialize(id));
        throw new InvalidOperationException();
    }

    private static Demo LoadDemo(JsonElement value, LoadedNetlist netlist, int index)
    {
        var where = "demos[" + F(index) + "]";
        var raw = Object(value, where);
        ExactKeys(raw, DemoKeys, where);
        var categoryText = String(Required(raw, "category", where), where + ".category");
        if (!Enum.TryParse<DemoCategory>(categoryText, out var category) || category.ToString() != categoryText)
            Fail(where + ".category is not a recognized category");
        var connections = LoadConnections(Required(raw, "connections", where), netlist, where + ".connections");
        var initial = LoadInitial(Required(raw, "initial", where), where + ".initial");
        var notice = raw.TryGetProperty("notice", out var noticeValue)
            ? NonEmptyString(noticeValue, where + ".notice")
            : null;
        return new Demo(
            NonEmptyString(Required(raw, "id", where), where + ".id"),
            NonEmptyString(Required(raw, "title", where), where + ".title"),
            category,
            LoadSource(Required(raw, "source", where), where + ".source"),
            connections,
            initial,
            StringArray(Required(raw, "instructions", where), where + ".instructions", 1, false),
            LoadControlLabels(Required(raw, "controlLabels", where), where + ".controlLabels"),
            notice,
            InitialCommands(connections, initial));
    }

    private static DemoSource LoadSource(JsonElement value, string where)
    {
        var raw = Object(value, where);
        ExactKeys(raw, SourceKeys, where);
        var confidenceText = String(Required(raw, "confidence", where), where + ".confidence");
        if (!Enum.TryParse<DemoConfidence>(confidenceText, out var confidence) || confidence.ToString() != confidenceText)
            Fail(where + ".confidence is not a recognized confidence");
        var fallbacks = StringArray(Required(raw, "fallbacks", where), where + ".fallbacks", 0, true);
        for (var index = 0; index < fallbacks.Count; index++)
        {
            if (!FallbackId().IsMatch(fallbacks[index]))
                Fail(where + ".fallbacks[" + F(index) + "] is not a fallback id");
        }
        return new DemoSource(
            NonEmptyString(Required(raw, "program", where), where + ".program"),
            NonEmptyString(Required(raw, "locator", where), where + ".locator"),
            confidence,
            StringArray(Required(raw, "errata", where), where + ".errata", 0, true),
            fallbacks);
    }

    private static DemoInitial LoadInitial(JsonElement value, string where)
    {
        var raw = Object(value, where);
        ExactKeys(raw, InitialKeys, where);
        var powerValue = Required(raw, "power", where);
        if (powerValue.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            Fail(where + ".power must be a boolean");
        var relayValue = Required(raw, "relayHands", where);
        if (relayValue.ValueKind != JsonValueKind.Array || relayValue.GetArrayLength() != 6)
            Fail(where + ".relayHands must contain exactly six entries");
        var relayHands = new int?[6];
        var relayIndex = 0;
        foreach (var entry in relayValue.EnumerateArray())
        {
            relayHands[relayIndex] = entry.ValueKind == JsonValueKind.Null
                ? null
                : checked((int)Integer(entry, 0, 1000, where + ".relayHands[" + F(relayIndex) + "]"));
            relayIndex++;
        }
        var dialValue = Required(raw, "dialHand", where);
        long? dialHand = dialValue.ValueKind == JsonValueKind.Null
            ? null
            : Integer(dialValue, 0, 359_999_999, where + ".dialHand");
        return new DemoInitial(
            powerValue.GetBoolean(),
            SixTargets(Required(raw, "switches", where), where + ".switches"),
            SixTargets(Required(raw, "buttons", where), where + ".buttons"),
            Array.AsReadOnly(relayHands),
            dialHand);
    }

    private static IReadOnlyList<DemoConnection> LoadConnections(
        JsonElement value,
        LoadedNetlist netlist,
        string where)
    {
        if (value.ValueKind != JsonValueKind.Array) Fail(where + " must be an array");
        if (value.GetArrayLength() > 256) Fail(where + " needs more than 256 cord ids");
        var parsed = new ParsedConnection[value.GetArrayLength()];
        var index = 0;
        foreach (var entry in value.EnumerateArray())
        {
            parsed[index] = ParseConnection(entry, where + "[" + F(index) + "]");
            index++;
        }
        var occupied = new byte[Terminals.HOLE_COUNT];
        for (index = 0; index < parsed.Length; index++)
        {
            ReserveExact(parsed[index].A, occupied, where + "[" + F(index) + "].a");
            ReserveExact(parsed[index].B, occupied, where + "[" + F(index) + "].b");
        }
        var plus = new HashSet<string>(netlist.plusMembers, StringComparer.Ordinal);
        var minus = new HashSet<string>(netlist.minusMembers, StringComparer.Ordinal);
        var connections = new DemoConnection[parsed.Length];
        for (index = 0; index < parsed.Length; index++)
        {
            var source = parsed[index];
            var connection = new DemoConnection(
                source.Wire,
                AllocateEnd(source.A, occupied, where + "[" + F(index) + "].a"),
                AllocateEnd(source.B, occupied, where + "[" + F(index) + "].b"),
                source.ResistanceUohm);
            if (IsDirectRailShort(connection, plus, minus))
                Fail(where + "[" + F(index) + "] is a direct unloaded PLUS-to-MINUS short");
            connections[index] = connection;
        }
        return Array.AsReadOnly(connections);
    }

    private static ParsedConnection ParseConnection(JsonElement value, string where)
    {
        string wire;
        long? resistance = null;
        if (value.ValueKind == JsonValueKind.String)
        {
            wire = NonEmptyString(value, where);
        }
        else
        {
            var raw = Object(value, where);
            ExactKeys(raw, ConnectionKeys, where);
            wire = NonEmptyString(Required(raw, "wire", where), where + ".wire");
            resistance = Integer(Required(raw, "r_uohm", where), 0, int.MaxValue, where + ".r_uohm");
        }
        var slash = wire.IndexOf('/', StringComparison.Ordinal);
        if (slash <= 0 || slash != wire.LastIndexOf('/') || slash == wire.Length - 1)
            Fail(where + ".wire must contain exactly two endpoints");
        var a = ParseEnd(wire[..slash], where + ".a");
        var b = ParseEnd(wire[(slash + 1)..], where + ".b");
        if (a is ParsedEnd.Free && b is ParsedEnd.Free) Fail(where + " cannot have two free ends");
        return new ParsedConnection(wire, a, b, resistance);
    }

    private static ParsedEnd ParseEnd(string text, string where)
    {
        if (text == "free") return new ParsedEnd.Free();
        try
        {
            return text.Contains('#', StringComparison.Ordinal)
                ? new ParsedEnd.Hole(Terminals.parseHoleId(text))
                : new ParsedEnd.Terminal(Terminals.parseTerminalId(text));
        }
        catch (Exception error) when (error is TerminalsException or ArgumentException)
        {
            Fail(where + " is invalid: " + error.Message);
            throw;
        }
    }

    private static void ReserveExact(ParsedEnd end, byte[] occupied, string where)
    {
        if (end is not ParsedEnd.Hole exact) return;
        if (occupied[exact.Value.index] != 0) Fail(where + " uses occupied hole " + exact.Value.id);
        occupied[exact.Value.index] = 1;
    }

    private static CordEnd AllocateEnd(ParsedEnd end, byte[] occupied, string where)
    {
        if (end is ParsedEnd.Free) return new CordEnd.Free();
        if (end is ParsedEnd.Hole exact) return new CordEnd.Hole(exact.Value.id);
        var terminal = ((ParsedEnd.Terminal)end).Value;
        var definition = Terminals.terminalAt(Terminals.terminalIndex(terminal));
        for (var number = 1; number <= definition.holes; number++)
        {
            var hole = Terminals.holeAt(terminal, number);
            if (occupied[hole.index] != 0) continue;
            occupied[hole.index] = 1;
            return new CordEnd.Hole(hole.id);
        }
        Fail(where + " terminal " + terminal + " has no free hole");
        throw new InvalidOperationException();
    }

    private static bool IsDirectRailShort(
        DemoConnection connection,
        IReadOnlySet<string> plus,
        IReadOnlySet<string> minus)
    {
        if ((connection.ResistanceUohm ?? 0) != 0) return false;
        var a = TerminalOf(connection.A);
        var b = TerminalOf(connection.B);
        return a is not null && b is not null &&
            ((plus.Contains(a) && minus.Contains(b)) || (minus.Contains(a) && plus.Contains(b)));
    }

    private static string? TerminalOf(CordEnd end) =>
        end is CordEnd.Hole hole ? Terminals.parseHoleId(hole.hole).terminal : null;

    private static IReadOnlyList<Command> InitialCommands(
        IReadOnlyList<DemoConnection> connections,
        DemoInitial initial)
    {
        var commands = new Command[connections.Count + 20];
        var offset = 0;
        for (var index = 0; index < connections.Count; index++)
        {
            var connection = connections[index];
            commands[offset++] = new Command.Connect(index, connection.A, connection.B, connection.ResistanceUohm);
        }
        for (var index = 0; index < 6; index++)
            commands[offset++] = new Command.Switch(index + 1, initial.Switches[index]);
        for (var index = 0; index < 6; index++)
            commands[offset++] = new Command.Button(index + 1, initial.Buttons[index]);
        for (var index = 0; index < 6; index++)
        {
            var target = initial.RelayHands[index];
            commands[offset++] = target is null
                ? new Command.RelayRelease(index + 1)
                : new Command.RelayGrab(index + 1, target.Value);
        }
        commands[offset++] = initial.DialHand is null
            ? new Command.DialRelease()
            : new Command.DialGrab(initial.DialHand.Value);
        commands[offset] = new Command.Power(initial.Power);
        return Array.AsReadOnly(commands);
    }

    private static IReadOnlyDictionary<string, string> LoadControlLabels(JsonElement value, string where)
    {
        var raw = Object(value, where);
        // JSON.parse collapses duplicate keys before the TypeScript loader sees them; System.Text.Json
        // enumerates both, so collapse last-wins first to keep the documented duplicate-key contract.
        var collapsed = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (var property in raw.EnumerateObject())
        {
            if (!collapsed.ContainsKey(property.Name)) order.Add(property.Name);
            collapsed[property.Name] = property.Value;
        }
        var labels = new Dictionary<string, string>(StringComparer.Ordinal);
        for (var index = 0; index < order.Count; index++)
        {
            var key = order[index];
            if (!ControlKey().IsMatch(key))
                Fail(where + " has unknown key " + JsonSerializer.Serialize(key));
            labels.Add(key, NonEmptyString(collapsed[key], where + "." + key));
        }
        return new ReadOnlyDictionary<string, string>(labels);
    }

    private static IReadOnlyList<int> SixTargets(JsonElement value, string where)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != 6)
            Fail(where + " must contain exactly six targets");
        var result = new int[6];
        var index = 0;
        foreach (var entry in value.EnumerateArray())
        {
            result[index] = checked((int)Integer(entry, 0, 1000, where + "[" + F(index) + "]"));
            index++;
        }
        return Array.AsReadOnly(result);
    }

    private static IReadOnlyList<string> StringArray(
        JsonElement value,
        string where,
        int minimum,
        bool unique)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() < minimum)
            Fail(where + " must contain at least " + F(minimum) + " string" + (minimum == 1 ? "" : "s"));
        var result = new string[value.GetArrayLength()];
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var index = 0;
        foreach (var entry in value.EnumerateArray())
        {
            result[index] = NonEmptyString(entry, where + "[" + F(index) + "]");
            if (unique && !seen.Add(result[index])) Fail(where + " must not contain duplicates");
            index++;
        }
        return Array.AsReadOnly(result);
    }

    private static JsonElement Object(JsonElement value, string where)
    {
        if (value.ValueKind != JsonValueKind.Object) Fail(where + " must be an object");
        return value;
    }

    private static void ExactKeys(JsonElement value, IReadOnlyList<string> allowed, string where)
    {
        foreach (var property in value.EnumerateObject())
        {
            var found = false;
            for (var index = 0; index < allowed.Count; index++)
                found |= property.NameEquals(allowed[index]);
            if (!found) Fail(where + " has unknown key " + JsonSerializer.Serialize(property.Name));
        }
    }

    private static JsonElement Required(JsonElement value, string key, string where)
    {
        if (!value.TryGetProperty(key, out var result))
            Fail(where + " is missing " + JsonSerializer.Serialize(key));
        return result;
    }

    private static string String(JsonElement value, string where)
    {
        if (value.ValueKind != JsonValueKind.String) Fail(where + " must be a string");
        return value.GetString()!;
    }

    private static string NonEmptyString(JsonElement value, string where)
    {
        var result = value.ValueKind == JsonValueKind.String ? value.GetString() : null;
        if (string.IsNullOrEmpty(result)) Fail(where + " must be a non-empty string");
        return result;
    }

    private static long Integer(JsonElement value, long minimum, long maximum, string where)
    {
        long result = 0;
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetInt64(out result) ||
            result < minimum || result > maximum)
            Fail(where + " must be an integer in " + F(minimum) + ".." + F(maximum));
        return result;
    }

    [DoesNotReturn]
    private static void Fail(string message) => throw new InvalidOperationException("demo library: " + message);

    private static string F(long value) => value.ToString(CultureInfo.InvariantCulture);

    private abstract record ParsedEnd
    {
        internal sealed record Free : ParsedEnd;
        internal sealed record Terminal(string Value) : ParsedEnd;
        internal sealed record Hole(HoleRef Value) : ParsedEnd;
    }

    private sealed record ParsedConnection(
        string Wire,
        ParsedEnd A,
        ParsedEnd B,
        long? ResistanceUohm);

    [GeneratedRegex("^(?:(?:button|switch|relay)[1-6]|dial|power)$", RegexOptions.CultureInvariant)]
    private static partial Regex ControlKey();

    [GeneratedRegex("^FALLBACK-[A-Z0-9]+(?:-[A-Z0-9]+)*$", RegexOptions.CultureInvariant)]
    private static partial Regex FallbackId();
}
