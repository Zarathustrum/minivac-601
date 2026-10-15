using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Minivac.Conformance;
using Minivac.Core;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class G3FixtureClassifierSliceTests
{
    [Fact]
    public void G3_fixture_schema_rejects_the_complete_257_case_typescript_invalid_corpus()
    {
        var source = new OverlaySource(new FileSystemSource(TestRepository.Root));
        var rejected = 0;
        void Reject(JsonObject fixture, string label)
        {
            var error = Assert.Throws<FixtureException>(() =>
                FixtureLoader.LoadFixture(source, "schema-invalid:" + label, Raw(fixture)));
            Assert.StartsWith("fixture: schema validation failed:", error.Message);
            rejected++;
        }

        var fixture = FixtureNode();
        fixture["contract"] = "1.0.0";
        Reject(fixture, "old contract");

        var requiredRoot = new[]
        {
            "schema", "id", "source", "tier", "confidence", "profile", "contract",
            "as_printed", "errata_applied", "wires", "script",
        };
        foreach (var key in requiredRoot)
        {
            fixture = FixtureNode();
            fixture.Remove(key);
            Reject(fixture, "root missing " + key);
        }
        fixture = FixtureNode();
        fixture["extra"] = true;
        Reject(fixture, "root unknown");

        Reject(WithStep("""{"k":"do","cmd":{"k":"power","on":true,"tick":1}}"""), "early command unknown");
        Reject(WithStep("""{"k":"do","cmd":{"k":"dialRelease"},"collapse":false}"""), "false collapse");
        Reject(WithStep("""{"k":"expect","obs":[{"dev":"relay1","v":"nc"},{"dev":"relay1","v":"no"}],"cite":"x","quote":"q"}"""), "duplicate observable");
        Reject(WithStep("""{"k":"expect","obs":[{"dev":"power","v":"nc"}],"cite":"x","quote":"q"}"""), "bad observable pair");

        fixture = FixtureNode();
        fixture["errata_applied"] = Node("""[{"id":"E","from":"1A/1B","to":"1C/1E","extra":true}]""");
        Reject(fixture, "nested erratum unknown");
        Reject(WithStep("""{"k":"do","cmd":{"k":"power","on":true},"extra":true}"""), "nested do unknown");
        Reject(WithStep("""{"k":"do","cmd":{"k":"connect","cord":0,"a":{"k":"free","extra":true},"b":{"k":"free"}}}"""), "nested end unknown");
        Reject(WithStep("""{"k":"expect","obs":[{"dev":"power","v":"off","extra":true}],"cite":"x","quote":"q"}"""), "nested observable unknown");
        fixture = ValidC2();
        fixture["digest"]!["extra"] = true;
        Reject(fixture, "nested digest unknown");
        fixture = ValidMarginal();
        fixture["mechanism"]!["extra"] = true;
        Reject(fixture, "nested mechanism unknown");

        var commands = new (string Json, string[] Required)[]
        {
            ("""{"k":"power","on":true}""", ["k", "on"]),
            ("""{"k":"breaker","reset":true}""", ["k", "reset"]),
            ("""{"k":"connect","cord":0,"a":{"k":"hole","hole":"1A#1"},"b":{"k":"touch","term":"1B"},"r_uohm":0}""", ["k", "cord", "a", "b"]),
            ("""{"k":"disconnect","cord":0}""", ["k", "cord"]),
            ("""{"k":"button","n":1,"target":0}""", ["k", "n", "target"]),
            ("""{"k":"switch","n":1,"target":0}""", ["k", "n", "target"]),
            ("""{"k":"relayGrab","n":1,"target":0}""", ["k", "n", "target"]),
            ("""{"k":"relayRelease","n":1}""", ["k", "n"]),
            ("""{"k":"dialGrab","targetUdeg":0}""", ["k", "targetUdeg"]),
            ("""{"k":"dialRelease"}""", ["k"]),
        };
        foreach (var row in commands)
        {
            var kind = ParseObject(row.Json)["k"]!.GetValue<string>();
            foreach (var key in row.Required)
            {
                var command = ParseObject(row.Json);
                command.Remove(key);
                Reject(WithCommand(command), kind + " missing " + key);
            }
            var unknown = ParseObject(row.Json);
            unknown["extra"] = true;
            Reject(WithCommand(unknown), kind + " unknown");
            var discriminant = ParseObject(row.Json);
            discriminant["k"] = "invalid-command";
            Reject(WithCommand(discriminant), kind + " invalid k");
        }

        var ends = new (string Json, string[] Required)[]
        {
            ("""{"k":"hole","hole":"1A#1"}""", ["k", "hole"]),
            ("""{"k":"touch","term":"1A"}""", ["k", "term"]),
            ("""{"k":"free"}""", ["k"]),
        };
        foreach (var row in ends)
        {
            var kind = ParseObject(row.Json)["k"]!.GetValue<string>();
            foreach (var key in row.Required)
            {
                var end = ParseObject(row.Json);
                end.Remove(key);
                Reject(WithConnectEnd(end), kind + " end missing " + key);
            }
            var unknown = ParseObject(row.Json);
            unknown["extra"] = true;
            Reject(WithConnectEnd(unknown), kind + " end unknown");
            var discriminant = ParseObject(row.Json);
            discriminant["k"] = "invalid-end";
            Reject(WithConnectEnd(discriminant), kind + " end invalid k");
        }

        var steps = new (string Json, string[] Required)[]
        {
            ("""{"k":"do","cmd":{"k":"power","on":true}}""", ["k", "cmd"]),
            ("""{"k":"advance","ms":1}""", ["k", "ms"]),
            ("""{"k":"settle","maxMs":1}""", ["k", "maxMs"]),
            ("""{"k":"expect","obs":[{"dev":"power","v":"off"}],"cite":"x","quote":"q"}""", ["k", "obs", "cite", "quote"]),
            ("""{"k":"until","obs":[{"dev":"power","v":"off"}],"maxMs":1,"cite":"x","quote":"q"}""", ["k", "obs", "maxMs", "cite", "quote"]),
        };
        foreach (var row in steps)
        {
            var kind = ParseObject(row.Json)["k"]!.GetValue<string>();
            foreach (var key in row.Required)
            {
                var step = ParseObject(row.Json);
                step.Remove(key);
                Reject(WithStep(step), kind + " step missing " + key);
            }
            var unknown = ParseObject(row.Json);
            unknown["extra"] = true;
            Reject(WithStep(unknown), kind + " step unknown");
            var discriminant = ParseObject(row.Json);
            discriminant["k"] = "invalid-step";
            Reject(WithStep(discriminant), kind + " step invalid k");
        }

        foreach (var observable in Trace.OBSERVABLES)
        {
            var pair = new JsonObject { ["dev"] = observable.name, ["v"] = observable.values[0] };
            foreach (var key in new[] { "dev", "v" })
            {
                var missing = (JsonObject)pair.DeepClone();
                missing.Remove(key);
                Reject(WithObservable(missing), observable.name + " missing " + key);
            }
            var unknown = (JsonObject)pair.DeepClone();
            unknown["extra"] = true;
            Reject(WithObservable(unknown), observable.name + " unknown");
            Reject(
                WithObservable(new JsonObject { ["dev"] = "invalid-observable", ["v"] = observable.values[0] }),
                observable.name + " invalid dev");
        }

        foreach (var key in new[] { "id", "from", "to" })
        {
            fixture = FixtureNode();
            var erratum = ParseObject("""{"id":"E","from":"1A/1B","to":"1C/1E"}""");
            erratum.Remove(key);
            fixture["errata_applied"] = new JsonArray(erratum);
            Reject(fixture, "erratum missing " + key);
        }

        fixture = FixtureNode();
        fixture["marginal"] = true;
        Reject(fixture, "marginal without mechanism");
        fixture = FixtureNode();
        fixture["mechanism"] = Node("""{"profileKey":"L_coil_uh","decision":"docs/DECISIONS.md#2026-09-01-canonical-marginal-counter-ruling-after-w1"}""");
        Reject(fixture, "mechanism without marginal");
        foreach (var key in new[] { "profileKey", "decision" })
        {
            fixture = ValidMarginal();
            ((JsonObject)fixture["mechanism"]!).Remove(key);
            Reject(fixture, "mechanism missing " + key);
        }

        Reject(WithStep("""{"k":"expect","obs":[{"dev":"power","v":"off"}],"cite":"x","quote":"q","tag":"unverified"}"""), "tag without source");
        Reject(WithStep("""{"k":"expect","obs":[{"dev":"power","v":"off"}],"cite":"x","quote":"q","source":"FALLBACK-X"}"""), "source without tag");

        fixture = FixtureNode();
        fixture["digest"] = DigestNode();
        Reject(fixture, "digest on non-C2");
        foreach (var key in new[] { "eventCount", "moverTransitions" })
        {
            fixture = ValidC2();
            ((JsonObject)fixture["digest"]!).Remove(key);
            Reject(fixture, "digest missing " + key);
        }

        Reject(WithStep("""{"k":"expect","obs":[{"dev":"power","v":"off"}],"cite":"x","quote":"q","tag":"unverified"}"""), "conditional fallback missing source");
        Reject(WithStep("""{"k":"expect","obs":[{"dev":"power","v":"off"}],"cite":"x","quote":"q","tag":"unverified","source":"FALLBACK-lowercase"}"""), "bad fallback name");
        // D1 (architecture §13.5.1): C2 may carry expect and until, but still requires its digest.
        fixture = ValidC2();
        fixture["script"] = Node("""[{"k":"expect","obs":[{"dev":"power","v":"off"}],"cite":"x","quote":"q"}]""");
        FixtureLoader.LoadFixture(source, "schema-valid:C2 expect", Raw(fixture));
        fixture.Remove("digest");
        Reject(fixture, "C2 expect without digest");

        foreach (var id in new[] { "../../X", "A/B", "A\nB", "lowercase", "A--B" })
        {
            fixture = FixtureNode();
            fixture["id"] = id;
            Reject(fixture, "unsafe id " + JsonSerializer.Serialize(id));
        }
        foreach (var field in new[] { "cite", "quote" })
        {
            fixture = FixtureNode();
            fixture["script"]![0]![field] = "bad\tfield";
            Reject(fixture, field + " control");
        }

        Assert.Equal(257, rejected);
    }

    [Fact]
    public void G3_fixture_loader_accepts_the_exact_manifest_inventory()
    {
        var source = new FileSystemSource(TestRepository.Root);
        var paths = source.EnumerateFiles("conformance/fixtures", "*.fixture.json");

        var loaded = paths.Select(path => FixtureLoader.LoadFixture(source, path)).ToArray();

        var manifest = FixtureManifest.Read(source);
        Assert.Equal(manifest.Select(entry => entry.SourcePath), paths);
        Assert.Equal(manifest.Count, loaded.Length);
        foreach (var tier in new[] { "A", "B", "C1", "C2" })
            Assert.Equal(manifest.Count(entry => entry.Tier == tier), loaded.Count(row => row.fixture.tier == tier));
        Assert.All(loaded, row => Assert.Equal(row.fixture.wires.Count, row.cords.Count));
    }

    [Fact]
    public void G3_fixture_loader_rejects_bytes_before_schema_or_semantics_in_contract_order()
    {
        var source = new OverlaySource(new FileSystemSource(TestRepository.Root));

        Assert.StartsWith("fixture: case has a UTF-8 BOM", Failure(source, [0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
        Assert.StartsWith("fixture: case contains CR at byte 2", Failure(source, Encoding.UTF8.GetBytes("{}\r\n")));
        Assert.StartsWith("fixture: case is not valid UTF-8", Failure(source, [0xff]));
        Assert.StartsWith("fixture: case is not valid JSON", Failure(source, Encoding.UTF8.GetBytes("{")));
        Assert.StartsWith("fixture: schema validation failed:", Failure(source, Encoding.UTF8.GetBytes("{}\n")));
    }

    [Fact]
    public void G3_fixture_loader_renders_schema_detail_and_keeps_lone_surrogates_outside_cite_and_quote()
    {
        var source = new OverlaySource(new FileSystemSource(TestRepository.Root));

        var detail = Failure(source, Encoding.UTF8.GetBytes("{}\n"));
        Assert.Contains("schema validation failed: /", detail, StringComparison.Ordinal);
        Assert.Contains("\"contract\"", detail, StringComparison.Ordinal);

        var escaped = JsonSerializer.Serialize(MinimalFixture())
            .Replace("\"source\":\"schema test\"", "\"source\":\"\\ud800\"", StringComparison.Ordinal);
        var loaded = FixtureLoader.LoadFixture(source, "case", Encoding.UTF8.GetBytes(escaped + "\n"));

        Assert.Equal("\ud800", loaded.fixture.source);
    }

    [Fact]
    public void G3_fixture_schema_rejects_duplicate_observables_and_cross_field_violations()
    {
        var source = new OverlaySource(new FileSystemSource(TestRepository.Root));
        var fixture = MinimalFixture();
        var script = (JsonArrayProxy)fixture["script"]!;

        script[0] = new Dictionary<string, object?>
        {
            ["k"] = "expect",
            ["obs"] = new object[]
            {
                new Dictionary<string, object?> { ["dev"] = "relay1", ["v"] = "nc" },
                new Dictionary<string, object?> { ["dev"] = "relay1", ["v"] = "no" },
            },
            ["cite"] = "x",
            ["quote"] = "q",
        };
        Assert.Contains("schema validation failed", Failure(source, Json(fixture)));

        fixture = MinimalFixture();
        fixture["marginal"] = true;
        Assert.Contains("schema validation failed", Failure(source, Json(fixture)));

        fixture = MinimalFixture();
        fixture["tier"] = "C2";
        Assert.Contains("schema validation failed", Failure(source, Json(fixture)));
    }

    [Fact]
    public void G3_fixture_semantics_reject_physical_erratum_mechanism_and_tick_failures()
    {
        var source = new OverlaySource(new FileSystemSource(TestRepository.Root));
        var fixture = MinimalFixture();
        fixture["wires"] = new[] { "1A/NOPE" };
        Assert.Contains("wires[0] is not a physical wire", Failure(source, Json(fixture)));

        fixture = MinimalFixture();
        fixture["wires"] = new[] { "1A/1B", "1C/1A", "1A/1E" };
        Assert.Contains("wire hole allocation failed", Failure(source, Json(fixture)));

        fixture = MinimalFixture();
        fixture["wires"] = new[] { "1A/1B", "1C/1E" };
        fixture["errata_applied"] = new object[]
        {
            new Dictionary<string, object?> { ["id"] = "E", ["from"] = "1B/1A", ["to"] = "1C/1E" },
        };
        Assert.Contains("canonical from remains", Failure(source, Json(fixture)));

        fixture = MinimalFixture();
        fixture["marginal"] = true;
        fixture["mechanism"] = new Dictionary<string, object?>
        {
            ["profileKey"] = "not_a_profile_key",
            ["decision"] = FixtureLoader.DECISION_ANCHOR,
        };
        Assert.Contains("not a normative profile key", Failure(source, Json(fixture)));

        fixture = MinimalFixture();
        fixture["script"] = new object[] { new Dictionary<string, object?> { ["k"] = "advance", ["ms"] = 214748365 } };
        Assert.Contains("milliseconds overflow int32 ticks", Failure(source, Json(fixture)));

        var escapedSurrogate = JsonSerializer.Serialize(MinimalFixture())
            .Replace("\"cite\":\"schema test\"", "\"cite\":\"bad\\ud800\"", StringComparison.Ordinal);
        Assert.Contains("unpaired high surrogate", Failure(source, Encoding.UTF8.GetBytes(escapedSurrogate + "\n")));
    }

    [Fact]
    public void G3_fixture_parser_accepts_duplicate_keys_with_the_last_value()
    {
        var source = new OverlaySource(new FileSystemSource(TestRepository.Root));
        var text = JsonSerializer.Serialize(MinimalFixture());
        text = text.Replace("\"id\":\"SCHEMA-CASE\"", "\"id\":\"WRONG\",\"id\":\"SCHEMA-CASE\"", StringComparison.Ordinal);

        var loaded = FixtureLoader.LoadFixture(source, "case", Encoding.UTF8.GetBytes(text + "\n"));

        Assert.Equal("SCHEMA-CASE", loaded.fixture.id);
    }

    [Fact]
    public void G3_fixture_schema_accepts_all_ten_command_variants_and_integral_json_number_forms()
    {
        var source = new OverlaySource(new FileSystemSource(TestRepository.Root));
        var fixture = MinimalFixture();
        fixture["script"] = new object[]
        {
            new Dictionary<string, object?> { ["k"] = "do", ["cmd"] = new Dictionary<string, object?> { ["k"] = "power", ["on"] = true } },
            new Dictionary<string, object?> { ["k"] = "do", ["cmd"] = new Dictionary<string, object?> { ["k"] = "breaker", ["reset"] = true } },
            new Dictionary<string, object?>
            {
                ["k"] = "do",
                ["cmd"] = new Dictionary<string, object?>
                {
                    ["k"] = "connect", ["cord"] = 255,
                    ["a"] = new Dictionary<string, object?> { ["k"] = "hole", ["hole"] = "1A#1" },
                    ["b"] = new Dictionary<string, object?> { ["k"] = "touch", ["term"] = "1B" },
                    ["r_uohm"] = 0,
                },
            },
            new Dictionary<string, object?> { ["k"] = "do", ["cmd"] = new Dictionary<string, object?> { ["k"] = "disconnect", ["cord"] = 0 } },
            new Dictionary<string, object?> { ["k"] = "do", ["cmd"] = new Dictionary<string, object?> { ["k"] = "button", ["n"] = 1, ["target"] = 1000 } },
            new Dictionary<string, object?> { ["k"] = "do", ["cmd"] = new Dictionary<string, object?> { ["k"] = "switch", ["n"] = 6, ["target"] = 0 } },
            new Dictionary<string, object?> { ["k"] = "do", ["cmd"] = new Dictionary<string, object?> { ["k"] = "relayGrab", ["n"] = 1, ["target"] = 1000 } },
            new Dictionary<string, object?> { ["k"] = "do", ["cmd"] = new Dictionary<string, object?> { ["k"] = "relayRelease", ["n"] = 6 } },
            new Dictionary<string, object?> { ["k"] = "do", ["cmd"] = new Dictionary<string, object?> { ["k"] = "dialGrab", ["targetUdeg"] = 359999999 } },
            new Dictionary<string, object?> { ["k"] = "do", ["cmd"] = new Dictionary<string, object?> { ["k"] = "dialRelease" } },
        };
        var text = JsonSerializer.Serialize(fixture)
            .Replace("\"n\":1", "\"n\":1.0", StringComparison.Ordinal)
            .Replace("\"target\":1000", "\"target\":1e3", StringComparison.Ordinal);

        var loaded = FixtureLoader.LoadFixture(source, "case", Encoding.UTF8.GetBytes(text + "\n"));

        Assert.Equal(10, loaded.fixture.script.Count);
        Assert.Equal(1000, Assert.IsType<Command.Button>(Assert.IsType<ScriptStep.Do>(loaded.fixture.script[4]).cmd).target);
    }

    [Fact]
    public void G3_fallback_listing_is_ordinal_and_formats_exact_bytes()
    {
        var source = new OverlaySource(new FileSystemSource(TestRepository.Root));
        source.Files = ["conformance/fixtures/A0.fixture.json", "conformance/fixtures/A-1.fixture.json"];
        source.Bytes[source.Files[0]] = Json(FallbackFixture("A0", 1));
        source.Bytes[source.Files[1]] = Json(FallbackFixture("A-1", 2));

        var text = Fallbacks.Format(Fallbacks.List(source, "conformance/fixtures"));

        Assert.Equal(
            "A-1\tscript[0]\tFALLBACK-NAME\tcite-0\n" +
            "A-1\tscript[1]\tFALLBACK-NAME\tcite-1\n" +
            "A0\tscript[0]\tFALLBACK-NAME\tcite-0\n",
            text);
    }

    [Fact]
    public void G3_shipped_fallback_inventory_has_the_exact_752_records()
    {
        var records = Fallbacks.List(new FileSystemSource(TestRepository.Root));

        // The count includes the FALLBACK-DERIVED-TOPOLOGY speculative fixtures.
        Assert.Equal(752, records.Count);
        Assert.Equal(new FallbackRecord("ER-ALTCOUNTER", 2, "FALLBACK-W6-ACTUAL-TAP-TRACE", "docs/DECISIONS.md, 2026-09-02 — W6 measure-only counter trace"), records[0]);
        Assert.Equal("VI-TUGOFWAR-DERIVED", records[^1].fixtureId);
        Assert.Equal(39, records[^1].scriptIndex);
    }

    [Fact]
    public void G3_static_classifier_pins_projection_and_returns_111_then_101()
    {
        var source = new FileSystemSource(TestRepository.Root);

        var report = StaticClassifier.RunStaticGate(source);

        Assert.True(report.pass);
        Assert.Equal(["IV-EXP1", "ER-ALTCOUNTER"], report.rows.Select(row => row.id));
        Assert.Equal(["111", "101"], report.rows.Select(row => row.tuple));
        Assert.Equal([44, 48], report.rows.Select(row => row.wires));
    }

    [Fact]
    public void G3_classify_lamp_removes_target_and_source_and_accepts_either_polarity()
    {
        var graph = new ClassifierGraph(
            Array.AsReadOnly<El>(
            [
                new LampEl(2, 3),
                new ResEl(0, 3, 1),
                new ResEl(1, 2, 1),
                new SourceEl(0, 1, 1, 1),
            ]),
            Array.AsReadOnly(["out4", "R1", "R2", "PSU"]),
            4);

        Assert.True(StaticClassifier.ClassifyLamp(graph, "out4"));
        Assert.False(StaticClassifier.ClassifyLamp(
            graph with { elements = Array.AsReadOnly<El>([new LampEl(2, 2), new ResEl(0, 3, 1), new ResEl(1, 2, 1), new SourceEl(0, 1, 1, 1)]) },
            "out4"));
    }

    private static string Failure(OverlaySource source, byte[] bytes) =>
        Assert.Throws<FixtureException>(() => FixtureLoader.LoadFixture(source, "case", bytes)).Message;

    private static byte[] Json(object value) => Encoding.UTF8.GetBytes(JsonSerializer.Serialize(value) + "\n");

    private static byte[] Raw(JsonNode value) => Encoding.UTF8.GetBytes(value.ToJsonString() + "\n");

    private static JsonNode Node(string json) => JsonNode.Parse(json)!;

    private static JsonObject ParseObject(string json) => Node(json).AsObject();

    private static JsonObject FixtureNode() => Node(JsonSerializer.Serialize(MinimalFixture())).AsObject();

    private static JsonObject WithStep(string stepJson) => WithStep(ParseObject(stepJson));

    private static JsonObject WithStep(JsonObject step)
    {
        var fixture = FixtureNode();
        fixture["script"] = new JsonArray(step);
        return fixture;
    }

    private static JsonObject WithCommand(JsonObject command) =>
        WithStep(new JsonObject { ["k"] = "do", ["cmd"] = command });

    private static JsonObject WithConnectEnd(JsonObject end) => WithCommand(new JsonObject
    {
        ["k"] = "connect",
        ["cord"] = 0,
        ["a"] = end,
        ["b"] = Node("""{"k":"free"}"""),
    });

    private static JsonObject WithObservable(JsonObject observable) => WithStep(new JsonObject
    {
        ["k"] = "expect",
        ["obs"] = new JsonArray(observable),
        ["cite"] = "x",
        ["quote"] = "q",
    });

    private static JsonObject ValidMarginal()
    {
        var fixture = FixtureNode();
        fixture["marginal"] = true;
        fixture["mechanism"] = Node("""{"profileKey":"L_coil_uh","decision":"docs/DECISIONS.md#2026-09-01-canonical-marginal-counter-ruling-after-w1"}""");
        return fixture;
    }

    private static JsonObject ValidC2()
    {
        var fixture = FixtureNode();
        fixture["tier"] = "C2";
        fixture["script"] = Node("""[{"k":"advance","ms":1}]""");
        fixture["digest"] = DigestNode();
        return fixture;
    }

    private static JsonObject DigestNode() => Node(
        "{\"eventCount\":0,\"moverTransitions\":[" + string.Join(',', new int[19]) + "]}").AsObject();

    private static Dictionary<string, object?> MinimalFixture() => new()
    {
        ["schema"] = "minivac.fixture/1",
        ["id"] = "SCHEMA-CASE",
        ["source"] = "schema test",
        ["tier"] = "A",
        ["confidence"] = "verified",
        ["profile"] = "MV601-REF-A",
        ["contract"] = "1.1.0",
        ["as_printed"] = new[] { "1A/1B" },
        ["errata_applied"] = Array.Empty<object>(),
        ["wires"] = new[] { "1A/1B" },
        ["script"] = new JsonArrayProxy(new Dictionary<string, object?>
        {
            ["k"] = "expect",
            ["obs"] = new object[] { new Dictionary<string, object?> { ["dev"] = "power", ["v"] = "off" } },
            ["cite"] = "schema test",
            ["quote"] = "Power is off.",
        }),
    };

    private static Dictionary<string, object?> FallbackFixture(string id, int count)
    {
        var fixture = MinimalFixture();
        fixture["id"] = id;
        fixture["script"] = Enumerable.Range(0, count).Select(index => new Dictionary<string, object?>
        {
            ["k"] = "expect",
            ["obs"] = new object[] { new Dictionary<string, object?> { ["dev"] = "power", ["v"] = "off" } },
            ["cite"] = "cite-" + index,
            ["quote"] = "fallback",
            ["tag"] = "unverified",
            ["source"] = "FALLBACK-NAME",
        }).ToArray();
        return fixture;
    }

    private sealed class JsonArrayProxy : List<object?>
    {
        public JsonArrayProxy(object value) => Add(value);
    }

    private sealed class OverlaySource(IArtifactSource fallback) : IArtifactSource
    {
        public Dictionary<string, byte[]> Bytes { get; } = new(StringComparer.Ordinal);
        public IReadOnlyList<string> Files { get; set; } = Array.Empty<string>();

        public byte[] ReadAllBytes(string relativePath) =>
            Bytes.TryGetValue(relativePath, out var bytes) ? (byte[])bytes.Clone() : fallback.ReadAllBytes(relativePath);

        public IReadOnlyList<string> EnumerateFiles(string relativeDir, string pattern) => Files;
    }

    private static class TestRepository
    {
        public static string Root { get; } = FindRoot();

        private static string FindRoot()
        {
            for (var directory = new System.IO.DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            {
                if (directory.GetFiles("package.json", System.IO.SearchOption.TopDirectoryOnly).Length == 1)
                    return directory.FullName;
            }
            throw new InvalidOperationException("repository root not found");
        }
    }
}
