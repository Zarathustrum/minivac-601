using System;
using System.Buffers;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Security.Cryptography;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class P3FrozenCopyTests
{
    private const string CapturePrefix = "frozen-copy: ";
    private const string CaptureSchema = "minivac.frozen-copy/1";

    private static readonly string[] Limits =
    [
        "The palette and panel geometry are approximate and photograph-derived. The 1.80 ratio, band boundaries, and placement values are unverified proportions, not physical dimensions. Exact RGB values, typeface, coating, substrate, mounting-disc function, and rotary-knob colour and form remain unresolved. The three-dimensional case, knob, control heights, relay bodies, bezels and patch cords are chosen redraw tokens recorded in the project's open questions; no dimension of the original is known.",
        "The POWER jewel is a binary interface projection: lit when rail voltage is above zero and dark at zero. It is not a modeled lamp-current or intensity result. Lamp glow and every sound other than the relay click are simulated presentation, not evidence about the original; the relay click is the only sound the manuals describe.",
    ];

    private static readonly string[] ProfileCopy =
    [
        "Both choices are unmeasured simulator profiles. REF-A is the default marginal-behavior profile; IDEAL is the forgiving profile.",
        "REF-A — default marginal-behavior unmeasured simulator profile",
        "IDEAL — forgiving unmeasured simulator profile",
    ];

    private static readonly (string Heading, string Description)[] Credits =
    [
        ("Primary panel photograph (PH2)", "Primary evidence for panel geometry and visual facts. The procedural HTML/CSS/SVG redraw changes the photograph into measured, fixed-geometry shapes without shipping the raster. It is an adaptation, and the panel-art derivative is licensed CC BY-SA 4.0."),
        ("POWER-jewel evidence (PH3)", "Corroboration for the factory POWER jewel and unit-to-unit variation only; its oblique geometry was not measured and the raster is not shipped."),
        ("Relay simulation cue", "The shipped attenuated derivative is a simulated operation cue, not an authenticated MINIVAC recording."),
        ("Rotary drive-wheel simulation loop", "The shipped attenuated, wrap-crossfaded derivative is a simulated motor cue, not an authenticated MINIVAC recording."),
        ("Relay release simulation", "Both builds include the derivative; the desktop build uses it as a simulated relay drop-out cue. It is not an authenticated MINIVAC recording."),
    ];

    [Fact]
    public void Literal_copy_is_present_only_in_live_Godot_string_literals()
    {
        var sources = GodotSources();
        foreach (var text in Limits.Concat(ProfileCopy)) AssertLiteral(sources, text);
        foreach (var (heading, description) in Credits)
        {
            AssertLiteral(sources, heading);
            AssertLiteral(sources, description);
        }
        Assert.Contains("It is an adaptation, and the panel-art derivative is licensed CC BY-SA 4.0.", Credits[0].Description, StringComparison.Ordinal);
    }

    [Fact]
    public void Redraw_limit_literals_match_the_web_source_byte_for_byte()
    {
        var web = File.ReadAllText(Path.Combine(RepoRoot(), "src/ui/help-credits.ts"));
        var fields = new[] { "RedrawLimits", "PowerLimits" };
        var classes = new[] { "redraw", "power" };
        var hashes = new string[Limits.Length];
        for (var index = 0; index < Limits.Length; index++)
        {
            var expected = Limits[index];
            var webLiteral = WebLimitLiteral(web, classes[index]);
            var godotLiteral = HelpCreditsConstant(fields[index]);
            Assert.Equal(expected, webLiteral);
            Assert.Equal(expected, godotLiteral);
            hashes[index] = Hash(webLiteral);
            Assert.Equal(hashes[index], Hash(godotLiteral));
        }
        const string citation = "docs/plans/phase-3-godot.md:655";
        var appendix = File.ReadAllText(Path.Combine(RepoRoot(), "docs/plans/phase-3-godot.md"));
        Assert.Contains("| Redraw and simulation limits, two paragraphs | `src/ui/help-credits.ts` 145–156 |", appendix, StringComparison.Ordinal);
        Console.WriteLine($"frozen-copy: redraw-sha256={hashes[0]} power-sha256={hashes[1]} citation={citation}");
    }

    [Fact]
    public void Named_help_credit_constants_match_the_frozen_credit_pairs()
    {
        var fields = new[]
        {
            ("PrimaryPanelHeading", "PrimaryPanelDescription"),
            ("PowerJewelHeading", "PowerJewelDescription"),
            ("RelayCueHeading", "RelayCueDescription"),
            ("RotaryLoopHeading", "RotaryLoopDescription"),
            ("RelayDropOutHeading", "RelayDropOutDescription"),
        };

        foreach (var (fieldsForCredit, expected) in fields.Zip(Credits))
        {
            var actualHeading = HelpCreditsConstant(fieldsForCredit.Item1);
            var actualDescription = HelpCreditsConstant(fieldsForCredit.Item2);
            Assert.Equal(expected.Heading, actualHeading);
            Assert.Equal(expected.Description, actualDescription);
            Assert.Equal(Hash(expected.Heading), Hash(actualHeading));
            Assert.Equal(Hash(expected.Description), Hash(actualDescription));
        }
    }

    [Fact]
    public void Named_help_credit_constant_extraction_cannot_be_fooled_by_a_decoy_literal()
    {
        const string expected = "frozen value";
        const string source = "// public const string RedrawLimits = \"frozen value\";\n" +
            "public const string RedrawLimits = \"wrong value\";\n" +
            "public const string Unused = \"frozen value\";";
        Assert.Equal("wrong value", ExtractNamedStringConstant(source, "RedrawLimits"));
        Assert.NotEqual(expected, ExtractNamedStringConstant(source, "RedrawLimits"));
    }

    [Fact]
    public void Literal_copy_includes_license_workflow_reset_and_source_labels()
    {
        var sources = GodotSources();
        foreach (var text in new[]
        {
            "CC BY-SA 4.0", "CC BY 2.0", "CC0 1.0",
            "Load", "Power", "Operate", "Wire", "Momentary Touch",
            "Reset selected demo", "Reset blank panel",
            "Source", "Program", "Locator", "Confidence", "Errata", "Fallbacks", "Instructions", "Controls", "Notice", "None",
            "Pushbutton 1", "Pushbutton 2", "Pushbutton 3", "Pushbutton 4", "Pushbutton 5", "Pushbutton 6",
            "Slide switch 1", "Slide switch 2", "Slide switch 3", "Slide switch 4", "Slide switch 5", "Slide switch 6",
            "Relay 1 crossbar", "Relay 2 crossbar", "Relay 3 crossbar", "Relay 4 crossbar", "Relay 5 crossbar", "Relay 6 crossbar",
            "Decimal dial angle", "Power",
        })
        {
            AssertLiteralPresent(sources, text);
        }
    }

    [Fact]
    public void Control_identity_to_base_name_table_is_exact_and_ordered()
    {
        var expected = new (string Identity, string BaseName)[]
        {
            ("button1", "Pushbutton 1"),
            ("button2", "Pushbutton 2"),
            ("button3", "Pushbutton 3"),
            ("button4", "Pushbutton 4"),
            ("button5", "Pushbutton 5"),
            ("button6", "Pushbutton 6"),
            ("switch1", "Slide switch 1"),
            ("switch2", "Slide switch 2"),
            ("switch3", "Slide switch 3"),
            ("switch4", "Slide switch 4"),
            ("switch5", "Slide switch 5"),
            ("switch6", "Slide switch 6"),
            ("relay1", "Relay 1 crossbar"),
            ("relay2", "Relay 2 crossbar"),
            ("relay3", "Relay 3 crossbar"),
            ("relay4", "Relay 4 crossbar"),
            ("relay5", "Relay 5 crossbar"),
            ("relay6", "Relay 6 crossbar"),
            ("dial", "Decimal dial angle"),
            ("power", "Power"),
        };
        var expectedLiterals = expected.SelectMany(pair => new[] { pair.Identity, pair.BaseName }).ToArray();
        var source = File.ReadAllText(Path.Combine(RepoRoot(), "godot/scripts/Controls.cs"));
        var actualLiterals = LiteralExtractor.Extract(source).Select(literal => literal.Value).ToArray();
        var exactTable = Enumerable.Range(0, actualLiterals.Length - expectedLiterals.Length + 1)
            .Any(offset => actualLiterals.Skip(offset).Take(expectedLiterals.Length).SequenceEqual(expectedLiterals));
        Assert.True(exactTable, "Controls.cs does not contain the exact ordered identity/base-name table");
    }

    [Fact]
    public void Frozen_copy_capture_contract_covers_all_seventeen_JSON_records()
    {
        var line = ExpectedCaptureLine();
        Assert.StartsWith(CapturePrefix, line, StringComparison.Ordinal);
        using var document = JsonDocument.Parse(line[CapturePrefix.Length..]);
        var root = document.RootElement;
        Assert.Equal(CaptureSchema, root.GetProperty("schema").GetString());
        var records = root.GetProperty("records");
        Assert.Equal(17, records.GetArrayLength());

        var sourceDemos = LoadDemos();
        for (var index = 0; index < sourceDemos.GetArrayLength(); index++)
        {
            var expected = sourceDemos[index];
            var actual = records[index];
            Assert.Equal(expected.GetProperty("id").GetString(), actual.GetProperty("id").GetString());
            Assert.Equal(expected.GetProperty("title").GetString(), actual.GetProperty("title").GetString());
            Assert.Equal(expected.GetProperty("category").GetString(), actual.GetProperty("category").GetString());
            AssertJsonStringsEqual(expected.GetProperty("instructions"), actual.GetProperty("instructions"));
            AssertJsonStringsEqual(expected.GetProperty("controlLabels"), actual.GetProperty("controlLabels"));
            AssertJsonStringsEqual(expected.GetProperty("source"), actual.GetProperty("source"));
            var paragraphs = actual.GetProperty("noticeParagraphs");
            if (expected.TryGetProperty("notice", out var notice))
            {
                Assert.Equal(notice.GetString()!.Split("\n\n", StringSplitOptions.None), paragraphs.EnumerateArray().Select(value => value.GetString()));
                Assert.Equal(expected.GetProperty("id").GetString() is "IV-EXP1" or "ER-ALTCOUNTER" ? 3 : 1, paragraphs.GetArrayLength());
            }
            else Assert.Equal(0, paragraphs.GetArrayLength());
        }
        Assert.Contains(records.EnumerateArray(), record => record.GetProperty("id").GetString() == "VI-TICTACTOE" &&
            record.GetProperty("source").GetProperty("fallbacks").EnumerateArray().Any(value => value.GetString() == "FALLBACK-TTT-RING-CW"));
    }

    internal static string ExpectedCaptureLine()
    {
        var bytes = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(bytes))
        {
            writer.WriteStartObject();
            writer.WriteString("schema", CaptureSchema);
            writer.WritePropertyName("records");
            writer.WriteStartArray();
            foreach (var demo in LoadDemos().EnumerateArray()) WriteCaptureRecord(writer, demo);
            writer.WriteEndArray();
            writer.WriteEndObject();
        }
        return CapturePrefix + Encoding.UTF8.GetString(bytes.WrittenSpan);
    }

    private static void WriteCaptureRecord(Utf8JsonWriter writer, JsonElement demo)
    {
        writer.WriteStartObject();
        Copy(writer, "id", demo);
        Copy(writer, "title", demo);
        Copy(writer, "category", demo);
        Copy(writer, "instructions", demo);
        Copy(writer, "controlLabels", demo);
        Copy(writer, "source", demo);
        writer.WritePropertyName("noticeParagraphs");
        writer.WriteStartArray();
        if (demo.TryGetProperty("notice", out var notice))
            foreach (var paragraph in notice.GetString()!.Split("\n\n", StringSplitOptions.None)) writer.WriteStringValue(paragraph);
        writer.WriteEndArray();
        writer.WriteEndObject();
    }

    private static void Copy(Utf8JsonWriter writer, string name, JsonElement objectValue)
    {
        writer.WritePropertyName(name);
        objectValue.GetProperty(name).WriteTo(writer);
    }

    private static void AssertJsonStringsEqual(JsonElement expected, JsonElement actual)
    {
        Assert.Equal(expected.ValueKind, actual.ValueKind);
        switch (expected.ValueKind)
        {
            case JsonValueKind.String:
                Assert.Equal(expected.GetString(), actual.GetString());
                break;
            case JsonValueKind.Array:
                Assert.Equal(expected.GetArrayLength(), actual.GetArrayLength());
                for (var index = 0; index < expected.GetArrayLength(); index++)
                    AssertJsonStringsEqual(expected[index], actual[index]);
                break;
            case JsonValueKind.Object:
                var expectedProperties = expected.EnumerateObject().ToArray();
                var actualProperties = actual.EnumerateObject().ToArray();
                Assert.Equal(expectedProperties.Select(property => property.Name), actualProperties.Select(property => property.Name));
                for (var index = 0; index < expectedProperties.Length; index++)
                    AssertJsonStringsEqual(expectedProperties[index].Value, actualProperties[index].Value);
                break;
            default:
                throw new InvalidOperationException("frozen-copy: expected a string-only JSON value");
        }
    }

    private static JsonElement LoadDemos()
    {
        using var document = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(RepoRoot(), "data/demo-library.json")));
        return document.RootElement.GetProperty("demos").Clone();
    }

    private static IReadOnlyList<(string Path, string Source, IReadOnlyList<LiteralSpan> Literals)> GodotSources() =>
        Directory.GetFiles(Path.Combine(RepoRoot(), "godot/scripts"), "*.cs")
            .Select(path => (path, File.ReadAllText(path)))
            .Select(row => (row.path, row.Item2, LiteralExtractor.Extract(row.Item2)))
            .ToArray();

    private static void AssertLiteral(
        IReadOnlyList<(string Path, string Source, IReadOnlyList<LiteralSpan> Literals)> sources,
        string expected)
    {
        var match = sources.FirstOrDefault(file => file.Literals.Any(literal => literal.Value == expected));
        Assert.False(string.IsNullOrEmpty(match.Path), "missing Godot literal: " + expected);
        Assert.DoesNotContain(expected, InverseMask(match.Source, match.Literals), StringComparison.Ordinal);
    }

    private static void AssertLiteralPresent(
        IReadOnlyList<(string Path, string Source, IReadOnlyList<LiteralSpan> Literals)> sources,
        string expected) =>
        Assert.Contains(sources, file => file.Literals.Any(literal => literal.Value == expected));

    private static string InverseMask(string source, IReadOnlyList<LiteralSpan> literals)
    {
        var masked = source.ToCharArray();
        foreach (var literal in literals)
            for (var index = literal.Offset; index < literal.Offset + literal.Length; index++) masked[index] = ' ';
        return new string(masked);
    }

    private static string Hash(string value) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));

    private static string HelpCreditsConstant(string field) =>
        ExtractNamedStringConstant(
            File.ReadAllText(Path.Combine(RepoRoot(), "godot", "scripts", "HelpCredits.cs")),
            field);

    private static string ExtractNamedStringConstant(string source, string field)
    {
        var declarations = Regex.Matches(source,
            "\\bpublic\\s+const\\s+string\\s+" + Regex.Escape(field) +
            "\\s*=\\s*(?<literal>\"(?:\\\\.|[^\"\\\\])*\")\\s*;",
            RegexOptions.Singleline)
            .Cast<Match>();
        var literals = LiteralExtractor.Extract(source);
        var liveDeclarations = declarations
            .Where(declaration => literals.Any(literal =>
                literal.Offset == declaration.Groups["literal"].Index &&
                literal.Length == declaration.Groups["literal"].Length))
            .ToArray();
        var declaration = Assert.Single(liveDeclarations);
        var literal = Assert.Single(literals, literal =>
            literal.Offset == declaration.Groups["literal"].Index &&
            literal.Length == declaration.Groups["literal"].Length);
        return literal.Value;
    }

    private static string WebLimitLiteral(string source, string limit)
    {
        var anchor = "'help-limit help-limit-" + limit + "',";
        var anchorIndex = source.IndexOf(anchor, StringComparison.Ordinal);
        Assert.True(anchorIndex >= 0, "missing web help-limit anchor " + limit);
        Assert.Equal(anchorIndex, source.LastIndexOf(anchor, StringComparison.Ordinal));
        var quote = source.IndexOf('\'', anchorIndex + anchor.Length);
        Assert.True(quote >= 0, "missing web help-limit literal " + limit);
        var value = new StringBuilder();
        for (var index = quote + 1; index < source.Length; index++)
        {
            var character = source[index];
            if (character == '\\')
            {
                Assert.True(index + 1 < source.Length, "unterminated web escape " + limit);
                var escaped = source[++index];
                value.Append(escaped switch
                {
                    '\\' => '\\',
                    '\'' => '\'',
                    _ => throw new InvalidOperationException("unsupported web escape " + limit),
                });
                continue;
            }
            if (character == '\'') return value.ToString();
            value.Append(character);
        }
        throw new InvalidOperationException("unterminated web help-limit literal " + limit);
    }

    private static string RepoRoot() => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));
}
