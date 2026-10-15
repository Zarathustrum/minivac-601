using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json.Nodes;
using Minivac.Conformance;
using Xunit;
using TraceProgram = Minivac.TraceCli.Program;

namespace Minivac.Core.Tests;

/// <summary>
/// D1 `until` step (architecture §13.5.1; docs/plans/phase-5-corpus.md Step 2). Mirrors the until
/// cases in test/conformance/schema.spec.ts, run.spec.ts, cli.spec.ts and tier-c-fixtures.spec.ts.
/// </summary>
public sealed class D1UntilStepTests
{
    private static readonly string Root = FindRoot();

    // ---- schema and semantic validation ----

    [Fact]
    public void Until_is_accepted_in_every_tier_and_C2_with_expect_and_until_still_needs_its_digest()
    {
        foreach (var tier in new[] { "A", "B", "C1", "C2" })
        {
            var value = Fixture([Until([Obs("power", "off")], 1)]);
            value["tier"] = tier;
            if (tier == "C2") value["digest"] = Digest();
            Load(value);
        }

        var c2 = Fixture([Expect([Obs("power", "off")]), Until([Obs("power", "off")], 1)]);
        c2["tier"] = "C2";
        Assert.StartsWith("fixture: schema validation failed:", Failure(c2));
        c2["digest"] = Digest();
        Load(c2);

        var nonC2 = Fixture([Until([Obs("power", "off")], 1)]);
        nonC2["digest"] = Digest();
        Assert.StartsWith("fixture: schema validation failed:", Failure(nonC2));
    }

    [Fact]
    public void Until_maxMs_has_the_same_checked_int32_tick_conversion_as_settle()
    {
        var value = Fixture([Until([Obs("power", "off")], 214748365)]);
        Assert.Contains("script[0] milliseconds overflow int32 ticks", Failure(value), StringComparison.Ordinal);
        value["script"]![0]!["maxMs"] = 214748364;
        Load(value);
    }

    [Fact]
    public void Every_malformed_until_shape_is_rejected_by_the_expect_rules()
    {
        JsonObject Base() => Until([Obs("power", "off")], 1);
        JsonObject With(Action<JsonObject> edit)
        {
            var step = Base();
            edit(step);
            return step;
        }

        var bad = new (string Label, JsonObject Step)[]
        {
            ("maxMs zero", With(step => step["maxMs"] = 0)),
            ("maxMs negative", With(step => step["maxMs"] = -1)),
            ("maxMs fractional", With(step => step["maxMs"] = 1.5)),
            ("maxMs string", With(step => step["maxMs"] = "1")),
            ("maxMs above int32", With(step => step["maxMs"] = 2147483648L)),
            ("ms instead of maxMs", With(step => { step.Remove("maxMs"); step["ms"] = 1; })),
            ("empty obs", With(step => step["obs"] = new JsonArray())),
            ("same dev twice", With(step => step["obs"] = new JsonArray(Obs("relay1", "nc"), Obs("relay1", "no")))),
            ("illegal pair", With(step => step["obs"] = new JsonArray(Obs("power", "nc")))),
            ("unknown dev", With(step => step["obs"] = new JsonArray(Obs("relay7", "nc")))),
            ("empty cite", With(step => step["cite"] = "")),
            ("empty quote", With(step => step["quote"] = "")),
            ("control in cite", With(step => step["cite"] = "bad\tfield")),
            ("control in quote", With(step => step["quote"] = "bad\nfield")),
            ("tag without source", With(step => step["tag"] = "unverified")),
            ("source without tag", With(step => step["source"] = "FALLBACK-X")),
            ("wrong tag", With(step => { step["tag"] = "likely"; step["source"] = "FALLBACK-X"; })),
            ("lowercase source", With(step => { step["tag"] = "unverified"; step["source"] = "FALLBACK-lowercase"; })),
            ("collapse member", With(step => step["collapse"] = true)),
        };
        Assert.Equal(19, bad.Length);
        foreach (var (label, step) in bad)
        {
            var message = Failure(Fixture([step]));
            Assert.True(message.StartsWith("fixture: schema validation failed:", StringComparison.Ordinal), label + ": " + message);
        }

        Load(Fixture([With(step => { step["tag"] = "unverified"; step["source"] = "FALLBACK-X"; })]));

        foreach (var field in new[] { "cite", "quote" })
        {
            var text = Fixture([With(step => step[field] = "SURROGATE")]).ToJsonString()
                .Replace("SURROGATE", "bad\\ud800", StringComparison.Ordinal);
            Assert.Contains("unpaired high surrogate", Failure(Encoding.UTF8.GetBytes(text + "\n")), StringComparison.Ordinal);
            Load(Fixture([With(step => step[field] = "valid 🚀 scalar")]));
        }

        var everyPair = new JsonArray(Trace.OBSERVABLES.Select(row => (JsonNode)Obs(row.name, row.values[0])).ToArray());
        Load(Fixture([With(step => step["obs"] = everyPair)]));
    }

    [Fact]
    public void Expect_and_until_added_to_each_shipped_C2_fixture_load_and_still_need_the_digest()
    {
        var source = new FileSystemSource(Root);
        var c2 = FixtureManifest.Read(source).Where(entry => entry.Tier == "C2").ToArray();
        Assert.NotEmpty(c2);
        foreach (var entry in c2)
        {
            var raw = JsonNode.Parse(source.ReadAllBytes(entry.SourcePath))!.AsObject();
            var script = raw["script"]!.AsArray();
            script.Add(new JsonObject
            {
                ["k"] = "expect", ["obs"] = new JsonArray(Obs("dial", "c0")),
                ["cite"] = "schema case", ["quote"] = "schema case",
            });
            script.Add(new JsonObject
            {
                ["k"] = "until", ["obs"] = new JsonArray(Obs("dial", "c0")), ["maxMs"] = 1,
                ["cite"] = "schema case", ["quote"] = "schema case",
            });
            FixtureLoader.LoadFixture(source, entry.SourcePath, Bytes(raw));
            raw.Remove("digest");
            var error = Assert.Throws<FixtureException>(() => FixtureLoader.LoadFixture(source, entry.SourcePath, Bytes(raw)));
            Assert.StartsWith("fixture: schema validation failed:", error.Message, StringComparison.Ordinal);
        }
    }

    // ---- runner semantics ----

    [Fact]
    public void Immediate_match_advances_zero_ticks_and_emits_exactly_the_expect_line()
    {
        var viaUntil = Run(Fixture([Until([Obs("power", "off")], 1)], "UNTIL-NOW"));
        var viaExpect = Run(Fixture([Expect([Obs("power", "off")])], "UNTIL-NOW"));
        Assert.Empty(viaUntil.failures);
        Assert.Equal(viaExpect.trace, viaUntil.trace);
        Assert.Contains("     0.0 ? power=off  \"q\"\n", viaUntil.trace, StringComparison.Ordinal);
        Assert.Equal(0, viaUntil.digest.eventCount);

        // A queued command has not landed until the next boundary, so this still matches at zero ticks.
        var queued = Run(Fixture([Do(new JsonObject { ["k"] = "power", ["on"] = true }), Until([Obs("power", "off")], 1), Advance(1)], "UNTIL-QUEUED"));
        Assert.Empty(queued.failures);
        Assert.Contains("     0.0 > power on\n     0.0 ? power=off  \"q\"\n     0.0 * power off->on\n", queued.trace, StringComparison.Ordinal);
    }

    [Fact]
    public void Match_after_k_ticks_equals_advance_by_k_then_expect_including_a_match_on_the_cap_tick()
    {
        JsonObject[] Obs2() => [Obs("power", "off"), Obs("sw1", "mid")];
        var reference = Run(Fixture([Sw1On(), Advance(27), Expect(Obs2()), Advance(1)], "UNTIL-K"));
        Assert.Empty(reference.failures);
        Assert.Contains("    27.0 ? power=off sw1=mid  \"q\"\n", reference.trace, StringComparison.Ordinal);
        foreach (var maxMs in new[] { 27, 1000 })
        {
            var result = Run(Fixture([Sw1On(), Until(Obs2(), maxMs), Advance(1)], "UNTIL-K"));
            Assert.Empty(result.failures);
            Assert.Equal(reference.trace, result.trace);
            Assert.Equal(reference.digest.eventCount, result.digest.eventCount);
            Assert.Equal(reference.digest.moverTransitions, result.digest.moverTransitions);
            Assert.Equal(reference.metrics, result.metrics);
        }
    }

    [Fact]
    public void Timeout_stops_at_exactly_cap_ticks_records_only_differing_observables_and_continues()
    {
        JsonObject[] Obs2() => [Obs("power", "off"), Obs("sw1", "mid")];
        var result = Run(Fixture([Sw1On(), Until(Obs2(), 26), Advance(1), Expect([Obs("sw1", "mid")])], "UNTIL-CAP"));
        var reference = Run(Fixture([Sw1On(), Advance(26), Expect(Obs2()), Advance(1), Expect([Obs("sw1", "mid")])], "UNTIL-CAP"));
        Assert.Equal([new ExpectationFailure(1, "sw1", "mid", "nc")], result.failures);
        Assert.Equal([new ExpectationFailure(2, "sw1", "mid", "nc")], reference.failures);
        Assert.Equal(reference.trace, result.trace);
        Assert.Equal(reference.digest.eventCount, result.digest.eventCount);
        Assert.Equal(reference.digest.moverTransitions, result.digest.moverTransitions);
        Assert.Contains("    26.0 ? power=off sw1=nc  \"q\"\n", result.trace, StringComparison.Ordinal);
        Assert.Contains("    27.0 ? sw1=mid  \"q\"\n", result.trace, StringComparison.Ordinal);
        Assert.DoesNotContain("no settle", result.trace, StringComparison.Ordinal);
    }

    [Fact]
    public void Until_inside_a_C2_fixture_feeds_the_digest_like_advance()
    {
        JsonObject C2(JsonObject[] script)
        {
            var value = Fixture(script, "UNTIL-C2");
            value["tier"] = "C2";
            value["digest"] = Digest();
            return value;
        }
        var viaUntil = Run(C2([Sw1On(), Until([Obs("sw1", "mid")], 1000)]));
        var viaAdvance = Run(C2([Sw1On(), Advance(27), Expect([Obs("sw1", "mid")])]));
        Assert.Empty(viaUntil.failures);
        Assert.Equal(viaAdvance.trace, viaUntil.trace);
        Assert.Equal(viaAdvance.digest.eventCount, viaUntil.digest.eventCount);
        Assert.Equal(viaAdvance.digest.moverTransitions, viaUntil.digest.moverTransitions);
        Assert.Equal(1, viaUntil.digest.moverTransitions[12]);
    }

    // ---- fallbacks and CLI ----

    [Fact]
    public void Tagged_until_steps_are_listed_exactly_as_tagged_expect_steps()
    {
        JsonObject Tagged(JsonObject step)
        {
            step["tag"] = "unverified";
            step["source"] = "FALLBACK-NAME";
            return step;
        }
        var untilTagged = Tagged(Until([Obs("power", "off")], 1));
        untilTagged["cite"] = "cite-until";
        var expectTagged = Tagged(Expect([Obs("power", "off")]));
        expectTagged["cite"] = "cite-expect";
        var untagged = Until([Obs("power", "off")], 1);
        untagged["cite"] = "untagged";

        var source = new ListingSource(new FileSystemSource(Root));
        source.Bytes["conformance/fixtures/U0.fixture.json"] = Bytes(Fixture([untilTagged, expectTagged, untagged], "U0"));

        Assert.Equal(
            "U0\tscript[0]\tFALLBACK-NAME\tcite-until\n" +
            "U0\tscript[1]\tFALLBACK-NAME\tcite-expect\n",
            Fallbacks.Format(Fallbacks.List(source)));
    }

    [Fact]
    public void Cli_reports_an_until_timeout_like_a_failed_expect_and_exits_1()
    {
        var value = Fixture([Sw1On(), CliUntil()], "CLI-UNTIL");
        value["source"] = "cli test";
        var bytes = Bytes(value);
        using var stdout = new MemoryStream();
        using var stderr = new MemoryStream();

        var exit = TraceProgram.Execute(["until.fixture.json"], Root, stdout, stderr, _ => bytes);

        Assert.Equal(1, exit);
        Assert.Equal(
            TraceRunner.RunFixture(new FileSystemSource(Root), "until.fixture.json", bytes).trace,
            Encoding.UTF8.GetString(stdout.ToArray()));
        Assert.Equal(
            "minivac-trace: assertion failed at script[1] sw1: expected mid, got nc\n",
            Encoding.UTF8.GetString(stderr.ToArray()));

        static JsonObject CliUntil()
        {
            var step = Until([Obs("sw1", "mid")], 26);
            step["cite"] = "cli test";
            step["quote"] = "Moving.";
            return step;
        }
    }

    // ---- helpers ----

    private static JsonObject Fixture(JsonObject[] script, string id = "RUN-CASE") => new()
    {
        ["schema"] = "minivac.fixture/1",
        ["id"] = id,
        ["source"] = "runner test",
        ["tier"] = "A",
        ["confidence"] = "verified",
        ["profile"] = "MV601-REF-A",
        ["contract"] = "1.1.0",
        ["as_printed"] = new JsonArray("A/B"),
        ["errata_applied"] = new JsonArray(),
        ["wires"] = new JsonArray("1A/1B"),
        ["script"] = new JsonArray(script.Select(step => (JsonNode)step).ToArray()),
    };

    private static JsonObject Obs(string dev, string v) => new() { ["dev"] = dev, ["v"] = v };

    private static JsonArray ObsArray(JsonObject[] obs) => new(obs.Select(row => (JsonNode)row.DeepClone()).ToArray());

    private static JsonObject Until(JsonObject[] obs, int maxMs) =>
        new() { ["k"] = "until", ["obs"] = ObsArray(obs), ["maxMs"] = maxMs, ["cite"] = "x", ["quote"] = "q" };

    private static JsonObject Expect(JsonObject[] obs) =>
        new() { ["k"] = "expect", ["obs"] = ObsArray(obs), ["cite"] = "x", ["quote"] = "q" };

    private static JsonObject Advance(int ms) => new() { ["k"] = "advance", ["ms"] = ms };

    private static JsonObject Do(JsonObject cmd) => new() { ["k"] = "do", ["cmd"] = cmd };

    private static JsonObject Sw1On() => Do(new JsonObject { ["k"] = "switch", ["n"] = 1, ["target"] = 1000 });

    private static JsonObject Digest() => new()
    {
        ["eventCount"] = 0,
        ["moverTransitions"] = new JsonArray(Enumerable.Repeat(0, 19).Select(zero => (JsonNode)zero).ToArray()),
    };

    private static byte[] Bytes(JsonNode value) => Encoding.UTF8.GetBytes(value.ToJsonString() + "\n");

    private static LoadedFixture Load(JsonObject value) =>
        FixtureLoader.LoadFixture(new FileSystemSource(Root), "case.fixture.json", Bytes(value));

    private static string Failure(JsonObject value) => Failure(Bytes(value));

    private static string Failure(byte[] bytes) =>
        Assert.Throws<FixtureException>(() =>
            FixtureLoader.LoadFixture(new FileSystemSource(Root), "case.fixture.json", bytes)).Message;

    private static RunResult Run(JsonObject value) =>
        TraceRunner.RunFixture(new FileSystemSource(Root), "case.fixture.json", Bytes(value));

    private sealed class ListingSource(IArtifactSource fallback) : IArtifactSource
    {
        public Dictionary<string, byte[]> Bytes { get; } = new(StringComparer.Ordinal);

        public byte[] ReadAllBytes(string relativePath) =>
            Bytes.TryGetValue(relativePath, out var bytes) ? (byte[])bytes.Clone() : fallback.ReadAllBytes(relativePath);

        public IReadOnlyList<string> EnumerateFiles(string relativeDir, string pattern) =>
            Bytes.Keys.Order(StringComparer.Ordinal).ToArray();
    }

    private static string FindRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "package.json")) && Directory.Exists(Path.Combine(directory.FullName, "godot")))
                return directory.FullName;
        }
        throw new InvalidOperationException("repository root not found");
    }
}
