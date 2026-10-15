using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using Json.Schema;
using Minivac.Core;

namespace Minivac.Conformance;

public sealed class FixtureException : Exception
{
    public FixtureException(string message) : base("fixture: " + message) { }
}

public static class FixtureLoader
{
    public const string DECISION_ANCHOR =
        "docs/DECISIONS.md#2026-09-01-canonical-marginal-counter-ruling-after-w1";

    private const int Int32MaxTicksInMilliseconds = int.MaxValue / 10;

    public static LoadedFixture LoadFixture(IArtifactSource source, string relativePath)
    {
        ArgumentNullException.ThrowIfNull(source);
        return LoadFixture(source, relativePath, source.ReadAllBytes(relativePath));
    }

    public static LoadedFixture LoadFixture(IArtifactSource source, string path, byte[] fixtureBytes)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentException.ThrowIfNullOrWhiteSpace(path);
        ArgumentNullException.ThrowIfNull(fixtureBytes);

        using var raw = StrictJson.Read(fixtureBytes, path);
        ValidateSchema(source, raw.RootElement);
        ValidateUnicodeFields(raw.RootElement);
        var fixture = ParseFixture(raw.RootElement);
        var checkedWiring = ValidateSemantics(fixture);

        using var profileRaw = StrictJson.Read(
            source,
            "data/profiles/" + fixture.profile + ".json",
            fixture.profile + " profile");
        var profile = Profile.LoadProfile(profileRaw.RootElement);
        if (!string.Equals(profile.id, fixture.profile, StringComparison.Ordinal))
            Fail("loaded profile id does not match fixture profile");
        if (profile.v.tick_us != 100)
            Fail("trace version 1 requires profile tick_us=100");
        var netlist = Netlist.LoadNetlist(source.ReadAllBytes("data/netlist.json"));
        return new LoadedFixture(path, fixture, profile, netlist, checkedWiring.wires, checkedWiring.cords);
    }

    private static void ValidateSchema(IArtifactSource source, JsonElement instance)
    {
        using var schemaDocument = StrictJson.Read(source, "conformance/fixture.schema.json", "fixture schema");
        Dialect.Default = Dialect.Draft202012;
        var schema = JsonSchema.Build(schemaDocument.RootElement, new BuildOptions
        {
            Dialect = Dialect.Draft202012,
            SchemaRegistry = new SchemaRegistry(),
        });
        var options = new EvaluationOptions
        {
            OutputFormat = OutputFormat.List,
            Culture = CultureInfo.InvariantCulture,
        };
        EvaluationResults result;
        try
        {
            result = schema.Evaluate(instance, options);
        }
        catch (InvalidOperationException)
        {
            // Lone UTF-16 surrogates make the validator's string reads throw; validate a
            // sanitized copy so the schema verdict still lands. ParseFixture keeps the
            // original code units.
            using var sanitized = JsonDocument.Parse(SanitizeUnpairedSurrogateEscapes(instance.GetRawText()));
            result = schema.Evaluate(sanitized.RootElement, options);
        }
        if (!result.IsValid)
            Fail("schema validation failed: " + RenderSchemaErrors(result));
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

    private static void ValidateUnicodeFields(JsonElement raw)
    {
        if (!raw.TryGetProperty("script", out var script) || script.ValueKind != JsonValueKind.Array)
            return;
        var index = 0;
        foreach (var step in script.EnumerateArray())
        {
            if (step.ValueKind == JsonValueKind.Object)
            {
                if (step.TryGetProperty("cite", out var cite) && cite.ValueKind == JsonValueKind.String)
                    ValidateUnicodeScalarToken(cite.GetRawText(), "script[" + index + "].cite");
                if (step.TryGetProperty("quote", out var quote) && quote.ValueKind == JsonValueKind.String)
                    ValidateUnicodeScalarToken(quote.GetRawText(), "script[" + index + "].quote");
            }
            index++;
        }
    }

    private static void ValidateUnicodeScalarToken(string token, string where)
    {
        for (var index = 1; index < token.Length - 1; index++)
        {
            if (token[index] == '\\')
            {
                if (index + 1 >= token.Length - 1)
                    return;
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
                        Fail(where + " contains an unpaired high surrogate");
                    index += 11;
                }
                else
                {
                    if (char.IsLowSurrogate((char)unit))
                        Fail(where + " contains an unpaired low surrogate");
                    index += 5;
                }
            }
            else if (char.IsHighSurrogate(token[index]))
            {
                if (index + 1 >= token.Length - 1 || !char.IsLowSurrogate(token[index + 1]))
                    Fail(where + " contains an unpaired high surrogate");
                index++;
            }
            else if (char.IsLowSurrogate(token[index]))
            {
                Fail(where + " contains an unpaired low surrogate");
            }
        }
    }

    private static int HexUnit(string text, int start)
    {
        var value = 0;
        for (var index = 0; index < 4; index++)
        {
            var c = text[start + index];
            value = value * 16 + (c <= '9' ? c - '0' : c <= 'F' ? c - 'A' + 10 : c - 'a' + 10);
        }
        return value;
    }

    private static string SanitizeUnpairedSurrogateEscapes(string text)
    {
        var output = new System.Text.StringBuilder(text.Length);
        for (var index = 0; index < text.Length; index++)
        {
            if (text[index] != '\\')
            {
                output.Append(text[index]);
                continue;
            }
            if (index + 1 >= text.Length || text[index + 1] != 'u')
            {
                output.Append(text[index]);
                if (index + 1 < text.Length)
                    output.Append(text[++index]);
                continue;
            }
            if (index + 5 >= text.Length)
            {
                output.Append(text[index]);
                continue;
            }
            var unit = HexUnit(text, index + 2);
            if (char.IsHighSurrogate((char)unit) && index + 11 < text.Length &&
                text[index + 6] == '\\' && text[index + 7] == 'u' &&
                char.IsLowSurrogate((char)HexUnit(text, index + 8)))
            {
                output.Append(text, index, 12);
                index += 11;
            }
            else if (char.IsSurrogate((char)unit))
            {
                output.Append("\\ufffd");
                index += 5;
            }
            else
            {
                output.Append(text, index, 6);
                index += 5;
            }
        }
        return output.ToString();
    }

    private static Fixture ParseFixture(JsonElement raw)
    {
        var errataRaw = raw.GetProperty("errata_applied");
        var errata = new Erratum[errataRaw.GetArrayLength()];
        var index = 0;
        foreach (var row in errataRaw.EnumerateArray())
            errata[index++] = new Erratum(Text(row, "id"), Text(row, "from"), Text(row, "to"));

        var wires = Strings(raw.GetProperty("wires"));
        var asPrinted = Strings(raw.GetProperty("as_printed"));
        var scriptRaw = raw.GetProperty("script");
        var script = new ScriptStep[scriptRaw.GetArrayLength()];
        index = 0;
        foreach (var step in scriptRaw.EnumerateArray())
            script[index++] = ParseStep(step);

        Mechanism? mechanism = null;
        if (raw.TryGetProperty("mechanism", out var mechanismRaw))
            mechanism = new Mechanism(Text(mechanismRaw, "profileKey"), Text(mechanismRaw, "decision"));

        ReviewedDigest? digest = null;
        if (raw.TryGetProperty("digest", out var digestRaw))
            digest = new ReviewedDigest(Integer(digestRaw.GetProperty("eventCount")), Integers(digestRaw.GetProperty("moverTransitions")));

        return new Fixture(
            Text(raw, "schema"),
            Text(raw, "id"),
            Text(raw, "source"),
            Text(raw, "tier"),
            Text(raw, "confidence"),
            Text(raw, "profile"),
            Text(raw, "contract"),
            asPrinted,
            Array.AsReadOnly(errata),
            wires,
            Array.AsReadOnly(script),
            OptionalText(raw, "note"),
            raw.TryGetProperty("marginal", out var marginal) && marginal.GetBoolean(),
            mechanism,
            digest);
    }

    private static ScriptStep ParseStep(JsonElement step)
    {
        return Text(step, "k") switch
        {
            "do" => new ScriptStep.Do(
                ParseCommand(step.GetProperty("cmd")),
                step.TryGetProperty("collapse", out var collapse) && collapse.GetBoolean()),
            "advance" => new ScriptStep.Advance(Integer(step.GetProperty("ms"))),
            "settle" => new ScriptStep.Settle(Integer(step.GetProperty("maxMs"))),
            "expect" => ParseExpect(step),
            "until" => ParseUntil(step),
            _ => throw new InvalidOperationException("schema admitted an unknown fixture step"),
        };
    }

    private static ScriptStep.Expect ParseExpect(JsonElement step)
    {
        return new ScriptStep.Expect(
            ParseObservables(step),
            Text(step, "cite"),
            Text(step, "quote"),
            OptionalText(step, "tag"),
            OptionalText(step, "source"));
    }

    private static ScriptStep.Until ParseUntil(JsonElement step)
    {
        return new ScriptStep.Until(
            ParseObservables(step),
            Integer(step.GetProperty("maxMs")),
            Text(step, "cite"),
            Text(step, "quote"),
            OptionalText(step, "tag"),
            OptionalText(step, "source"));
    }

    private static IReadOnlyList<ExpectedObservable> ParseObservables(JsonElement step)
    {
        var rawObs = step.GetProperty("obs");
        var obs = new ExpectedObservable[rawObs.GetArrayLength()];
        var index = 0;
        foreach (var row in rawObs.EnumerateArray())
            obs[index++] = new ExpectedObservable(Text(row, "dev"), Text(row, "v"));
        return Array.AsReadOnly(obs);
    }

    private static Command ParseCommand(JsonElement command)
    {
        return Text(command, "k") switch
        {
            "power" => new Command.Power(command.GetProperty("on").GetBoolean()),
            "breaker" => new Command.Breaker(),
            "connect" => new Command.Connect(
                Integer(command.GetProperty("cord")),
                ParseEnd(command.GetProperty("a")),
                ParseEnd(command.GetProperty("b")),
                command.TryGetProperty("r_uohm", out var resistance) ? Integer(resistance) : null),
            "disconnect" => new Command.Disconnect(Integer(command.GetProperty("cord"))),
            "button" => new Command.Button(Integer(command.GetProperty("n")), Integer(command.GetProperty("target"))),
            "switch" => new Command.Switch(Integer(command.GetProperty("n")), Integer(command.GetProperty("target"))),
            "relayGrab" => new Command.RelayGrab(Integer(command.GetProperty("n")), Integer(command.GetProperty("target"))),
            "relayRelease" => new Command.RelayRelease(Integer(command.GetProperty("n"))),
            "dialGrab" => new Command.DialGrab(Integer(command.GetProperty("targetUdeg"))),
            "dialRelease" => new Command.DialRelease(),
            _ => throw new InvalidOperationException("schema admitted an unknown command"),
        };
    }

    private static CordEnd ParseEnd(JsonElement end)
    {
        return Text(end, "k") switch
        {
            "hole" => new CordEnd.Hole(Text(end, "hole")),
            "touch" => new CordEnd.Touch(Text(end, "term")),
            "free" => new CordEnd.Free(),
            _ => throw new InvalidOperationException("schema admitted an unknown cord end"),
        };
    }

    private static (IReadOnlyList<TerminalWire> wires, IReadOnlyList<AllocatedCord> cords) ValidateSemantics(Fixture fixture)
    {
        var wires = new TerminalWire[fixture.wires.Count];
        for (var index = 0; index < wires.Length; index++)
        {
            try
            {
                wires[index] = Terminals.parseTerminalWire(fixture.wires[index]);
            }
            catch (Exception error) when (error is TerminalsException)
            {
                Fail("wires[" + index + "] is not a physical wire: " + error.Message);
            }
        }

        IReadOnlyList<AllocatedCord> cords;
        try
        {
            cords = Terminals.AllocateHoles(wires);
        }
        catch (Exception error) when (error is HoleAllocationException or TerminalsException)
        {
            throw new FixtureException("wire hole allocation failed: " + error.Message);
        }
        if (cords.Count > 256)
            Fail("initial wiring needs cord id " + cords.Count + ", above 255");

        var canonicalWires = new string[fixture.wires.Count];
        for (var index = 0; index < canonicalWires.Length; index++)
            canonicalWires[index] = CanonicalPair(fixture.wires[index], "wires[" + index + "]");
        for (var index = 0; index < fixture.errata_applied.Count; index++)
        {
            var erratum = fixture.errata_applied[index];
            var from = CanonicalPair(erratum.from, "errata_applied[" + index + "].from");
            var to = CanonicalPair(erratum.to, "errata_applied[" + index + "].to");
            var toCount = 0;
            for (var wireIndex = 0; wireIndex < canonicalWires.Length; wireIndex++)
            {
                if (string.Equals(canonicalWires[wireIndex], from, StringComparison.Ordinal))
                    Fail("errata_applied[" + index + "] canonical from remains in wires");
                if (string.Equals(canonicalWires[wireIndex], to, StringComparison.Ordinal))
                    toCount++;
            }
            if (toCount != 1)
                Fail("errata_applied[" + index + "] canonical to occurs " + toCount + " times, expected 1");
        }

        if (fixture.marginal)
        {
            var mechanism = fixture.mechanism!;
            if (!ContainsOrdinal(Profile.SCALAR_KEYS, mechanism.profileKey) &&
                !ContainsOrdinal(Profile.ARRAY_KEYS, mechanism.profileKey))
                Fail("mechanism.profileKey is not a normative profile key: " + JsonSerializer.Serialize(mechanism.profileKey));
            if (!string.Equals(mechanism.decision, DECISION_ANCHOR, StringComparison.Ordinal))
                Fail("mechanism.decision must equal " + JsonSerializer.Serialize(DECISION_ANCHOR));
        }

        for (var index = 0; index < fixture.script.Count; index++)
        {
            switch (fixture.script[index])
            {
                case ScriptStep.Do action:
                    ValidateCommand(action.cmd, "script[" + index + "].cmd");
                    break;
                case ScriptStep.Advance advance when advance.ms > Int32MaxTicksInMilliseconds:
                    Fail("script[" + index + "] milliseconds overflow int32 ticks");
                    break;
                case ScriptStep.Settle settle when settle.maxMs > Int32MaxTicksInMilliseconds:
                    Fail("script[" + index + "] milliseconds overflow int32 ticks");
                    break;
                case ScriptStep.Expect expect:
                    ValidateUnicodeScalars(expect.cite, "script[" + index + "].cite");
                    ValidateUnicodeScalars(expect.quote, "script[" + index + "].quote");
                    break;
                case ScriptStep.Until until:
                    if (until.maxMs > Int32MaxTicksInMilliseconds)
                        Fail("script[" + index + "] milliseconds overflow int32 ticks");
                    ValidateUnicodeScalars(until.cite, "script[" + index + "].cite");
                    ValidateUnicodeScalars(until.quote, "script[" + index + "].quote");
                    break;
            }
        }

        return (Array.AsReadOnly(wires), cords);
    }

    private static void ValidateCommand(Command command, string where)
    {
        if (command is not Command.Connect connect)
            return;
        ValidateEnd(connect.a, where + ".a");
        ValidateEnd(connect.b, where + ".b");
    }

    private static void ValidateEnd(CordEnd end, string where)
    {
        try
        {
            if (end is CordEnd.Hole hole)
                Terminals.parseHoleId(hole.hole);
            else if (end is CordEnd.Touch touch)
                Terminals.parseTerminalId(touch.term);
        }
        catch (Exception error) when (error is TerminalsException)
        {
            throw new FixtureException(where + " is not a physical endpoint: " + error.Message);
        }
    }

    private static string CanonicalPair(string text, string where)
    {
        TerminalWire wire;
        try
        {
            wire = Terminals.parseTerminalWire(text);
        }
        catch (Exception error) when (error is TerminalsException)
        {
            throw new FixtureException(where + " is not a physical wire: " + error.Message);
        }
        var a = RailName(wire.a);
        var b = RailName(wire.b);
        return string.CompareOrdinal(a, b) <= 0 ? a + "/" + b : b + "/" + a;
    }

    private static string RailName(string terminal)
    {
        if (terminal == "M+" || terminal.Length == 2 && terminal[0] is >= '1' and <= '6' && terminal[1] == '+')
            return "PLUS";
        if (terminal == "M-" || terminal.Length == 2 && terminal[0] is >= '1' and <= '6' && terminal[1] == '-')
            return "MINUS";
        return terminal;
    }

    private static void ValidateUnicodeScalars(string text, string where)
    {
        for (var index = 0; index < text.Length; index++)
        {
            var unit = text[index];
            if (char.IsHighSurrogate(unit))
            {
                if (index + 1 >= text.Length || !char.IsLowSurrogate(text[index + 1]))
                    Fail(where + " contains an unpaired high surrogate");
                index++;
            }
            else if (char.IsLowSurrogate(unit))
            {
                Fail(where + " contains an unpaired low surrogate");
            }
        }
    }

    private static bool ContainsOrdinal(IReadOnlyList<string> values, string target)
    {
        for (var index = 0; index < values.Count; index++)
        {
            if (string.Equals(values[index], target, StringComparison.Ordinal))
                return true;
        }
        return false;
    }

    private static IReadOnlyList<string> Strings(JsonElement raw)
    {
        var values = new string[raw.GetArrayLength()];
        var index = 0;
        foreach (var value in raw.EnumerateArray())
            values[index++] = Utf16Text(value);
        return Array.AsReadOnly(values);
    }

    private static IReadOnlyList<int> Integers(JsonElement raw)
    {
        var values = new int[raw.GetArrayLength()];
        var index = 0;
        foreach (var value in raw.EnumerateArray())
            values[index++] = Integer(value);
        return Array.AsReadOnly(values);
    }

    private static int Integer(JsonElement raw)
    {
        if (raw.TryGetInt32(out var integer))
            return integer;
        var number = raw.GetDecimal();
        return checked((int)number);
    }

    private static string Text(JsonElement raw, string property) => Utf16Text(raw.GetProperty(property));

    private static string? OptionalText(JsonElement raw, string property) =>
        raw.TryGetProperty(property, out var value) ? Utf16Text(value) : null;

    // GetString refuses lone UTF-16 surrogates, which JavaScript strings carry happily. Only
    // cite and quote reject them (ValidateUnicodeFields); every other field must load in both
    // ports, so fall back to decoding the raw token and keep the code unit as written.
    private static string Utf16Text(JsonElement value)
    {
        try
        {
            return value.GetString()!;
        }
        catch (InvalidOperationException)
        {
            return DecodeStringToken(value.GetRawText());
        }
    }

    private static string DecodeStringToken(string token)
    {
        var output = new System.Text.StringBuilder(token.Length);
        for (var index = 1; index < token.Length - 1; index++)
        {
            if (token[index] != '\\')
            {
                output.Append(token[index]);
                continue;
            }
            var escape = token[++index];
            switch (escape)
            {
                case 'u':
                    output.Append((char)HexUnit(token, index + 1));
                    index += 4;
                    break;
                case 'b': output.Append('\b'); break;
                case 'f': output.Append('\f'); break;
                case 'n': output.Append('\n'); break;
                case 'r': output.Append('\r'); break;
                case 't': output.Append('\t'); break;
                default: output.Append(escape); break;
            }
        }
        return output.ToString();
    }

    private static void Fail(string message) => throw new FixtureException(message);
}
