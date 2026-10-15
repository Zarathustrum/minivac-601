using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Minivac.Conformance;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class G3ProbeParityPortTests
{
    private static readonly string[] ProbeIds =
        ["AT-01", "AT-04", "AT-05", "AT-06", "AT-07", "AT-09", "AT-10", "AT-11"];

    [Fact]
    public void G3_probe_inventory_is_exact_and_every_registered_probe_passes_deterministically()
    {
        var source = Source();
        Assert.Equal(
            ProbeIds.Select(id => "conformance/probes/" + id + ".probe.json"),
            source.EnumerateFiles("conformance/probes", "*.probe.json"));

        foreach (var id in ProbeIds)
        {
            var path = "conformance/probes/" + id + ".probe.json";
            var first = ProbeRunner.Run(source, path);
            var second = ProbeRunner.Run(source, path);
            Assert.True(first.pass, id);
            Assert.Equal("minivac.probe-result/1", first.schema);
            Assert.Equal(id, first.id);
            Assert.Equal(ResultFingerprint(first), ResultFingerprint(second));
        }
    }

    [Fact]
    public void G3_probe_numeric_measurements_match_all_46_independent_pins()
    {
        var source = Source();
        var expected = ExpectedPins();
        Assert.Equal(46, expected.Sum(row => row.Value.Count));

        foreach (var id in ProbeIds)
        {
            var result = ProbeRunner.Run(source, "conformance/probes/" + id + ".probe.json");
            Assert.Equal(expected[id], NumericMeasurements(result));
        }
    }

    [Fact]
    public void G3_probe_loader_rejects_strict_bytes_wrong_scope_and_nonincreasing_checkpoints()
    {
        var source = Source();
        var valid = source.ReadAllBytes("conformance/probes/AT-06.probe.json");

        Assert.Throws<ProbeException>(() => ProbeLoader.loadProbe(
            new OverlaySource(source, "conformance/probes/case.probe.json", [0xef, 0xbb, 0xbf, 0x7b, 0x7d, 0x0a]),
            "conformance/probes/case.probe.json"));
        Assert.Throws<ProbeException>(() => ProbeLoader.loadProbe(
            new OverlaySource(source, "conformance/probes/case.probe.json", "{}\r\n"u8.ToArray()),
            "conformance/probes/case.probe.json"));
        Assert.Throws<ProbeException>(() => ProbeLoader.loadProbe(
            new OverlaySource(source, "conformance/probes/case.probe.json", [0xc3, 0x28]),
            "conformance/probes/case.probe.json"));
        var surrogate = System.Text.Encoding.UTF8.GetBytes(System.Text.Encoding.UTF8.GetString(valid).Replace(
            "\"source\": \"components.md §8.2 AT-06; architecture §13.4.3\"",
            "\"source\": \"\\uD800\"",
            StringComparison.Ordinal));
        Assert.Contains("unpaired high surrogate", Assert.Throws<ProbeException>(() => ProbeLoader.loadProbe(
            new OverlaySource(source, "conformance/probes/case.probe.json", surrogate),
            "conformance/probes/case.probe.json")).Message, StringComparison.Ordinal);

        var wrongScope = JsonNode(valid);
        wrongScope["cases"]![0]!["checkpoints"]![0]!["checks"]![0]!["read"] =
            System.Text.Json.Nodes.JsonNode.Parse("{\"k\":\"load\",\"field\":\"settledSupplyUa\"}");
        var wrongScopeError = Assert.Throws<ProbeException>(() => ProbeLoader.loadProbe(
            new OverlaySource(source, "conformance/probes/case.probe.json", JsonBytes(wrongScope)),
            "conformance/probes/case.probe.json"));
        Assert.Contains("wrong execution scope", wrongScopeError.Message, StringComparison.Ordinal);

        var nonIncreasing = JsonNode(valid);
        nonIncreasing["cases"]![0]!["checkpoints"]![1]!["at"]!["actionIndex"] = 1;
        nonIncreasing["cases"]![0]!["checkpoints"]![1]!["at"]!["actionKind"] = "advance";
        var orderError = Assert.Throws<ProbeException>(() => ProbeLoader.loadProbe(
            new OverlaySource(source, "conformance/probes/case.probe.json", JsonBytes(nonIncreasing)),
            "conformance/probes/case.probe.json"));
        Assert.Contains("strictly increasing", orderError.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void G3_probe_loader_accepts_a_literal_backslash_before_surrogate_text()
    {
        var source = Source();
        var valid = System.Text.Encoding.UTF8.GetString(source.ReadAllBytes("conformance/probes/AT-06.probe.json"));
        var literal = System.Text.Encoding.UTF8.GetBytes(valid.Replace(
            "\"source\": \"components.md §8.2 AT-06; architecture §13.4.3\"",
            "\"source\": \"\\\\uD800\"",
            StringComparison.Ordinal));

        var loaded = ProbeLoader.loadProbe(
            new OverlaySource(source, "conformance/probes/case.probe.json", literal),
            "conformance/probes/case.probe.json");

        Assert.Equal("\\uD800", loaded.probe.source);
    }

    [Fact]
    public void G3_probe_runner_rejects_a_profile_whose_id_does_not_match_the_probe()
    {
        var source = Source();
        var profile = JsonNode(source.ReadAllBytes("data/profiles/MV601-REF-A.json"));
        profile["id"] = "MV601-IDEAL";
        var overlay = new OverlaySource(source, "data/profiles/MV601-REF-A.json", JsonBytes(profile));

        var error = Assert.Throws<ProbeException>(() =>
            ProbeRunner.Run(overlay, "conformance/probes/AT-06.probe.json"));

        Assert.Contains("profile id does not match", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void G3_probe_diagnostic_case_is_still_required_for_overall_pass()
    {
        var source = Source();
        var raw = JsonNode(source.ReadAllBytes("conformance/probes/AT-05.probe.json"));
        raw["cases"]![1]!["checks"]![0]!["expected"] = 0;
        raw["cases"]![1]!["checks"]![0]!["tolerance"] = 0;
        var overlay = new OverlaySource(source, "conformance/probes/case.probe.json", JsonBytes(raw));

        var result = ProbeRunner.Run(overlay, "conformance/probes/case.probe.json");

        Assert.False(result.pass);
        var diagnostic = Assert.IsType<ProfileLoadCaseResult>(result.cases[1]);
        Assert.True(diagnostic.diagnostic);
        Assert.False(diagnostic.checks[0].pass);
    }

    [Fact]
    public void G3_probe_near_is_inclusive_and_all_five_integer_relations_are_exact()
    {
        var source = Source();
        var raw = JsonNode(source.ReadAllBytes("conformance/probes/AT-06.probe.json"));
        raw["cases"]![0]!["source"]!["wires"]![0] = "1+/1A";
        raw["cases"]![0]!["source"]!["actions"] = System.Text.Json.Nodes.JsonNode.Parse(
            "[{\"k\":\"do\",\"cmd\":{\"k\":\"power\",\"on\":true}},{\"k\":\"advance\",\"ticks\":1}]");
        raw["cases"]![0]!["checkpoints"] = System.Text.Json.Nodes.JsonNode.Parse(
            "[{\"name\":\"sample\",\"at\":{\"k\":\"action\",\"actionIndex\":1,\"actionKind\":\"advance\"},\"checks\":[" +
            "{\"k\":\"near\",\"name\":\"near-pass\",\"read\":{\"k\":\"state\",\"field\":\"railMv\"},\"expected\":12999,\"tolerance\":1}," +
            "{\"k\":\"near\",\"name\":\"near-fail\",\"read\":{\"k\":\"state\",\"field\":\"railMv\"},\"expected\":12998,\"tolerance\":1}," +
            "{\"k\":\"compare\",\"name\":\"lt\",\"left\":{\"k\":\"state\",\"field\":\"railMv\"},\"op\":\"lt\",\"right\":{\"k\":\"literal\",\"value\":13001}}," +
            "{\"k\":\"compare\",\"name\":\"le\",\"left\":{\"k\":\"state\",\"field\":\"railMv\"},\"op\":\"le\",\"right\":{\"k\":\"literal\",\"value\":13000}}," +
            "{\"k\":\"compare\",\"name\":\"eq\",\"left\":{\"k\":\"state\",\"field\":\"railMv\"},\"op\":\"eq\",\"right\":{\"k\":\"literal\",\"value\":13000}}," +
            "{\"k\":\"compare\",\"name\":\"ge\",\"left\":{\"k\":\"state\",\"field\":\"railMv\"},\"op\":\"ge\",\"right\":{\"k\":\"literal\",\"value\":13000}}," +
            "{\"k\":\"compare\",\"name\":\"gt\",\"left\":{\"k\":\"state\",\"field\":\"railMv\"},\"op\":\"gt\",\"right\":{\"k\":\"literal\",\"value\":12999}}]}]");
        var overlay = new OverlaySource(source, "conformance/probes/case.probe.json", JsonBytes(raw));

        var result = ProbeRunner.Run(overlay, "conformance/probes/case.probe.json");
        var checkpoint = Assert.IsType<MachineCaseResult>(result.cases[0]).checkpoints[0];

        Assert.Equal(new[] { true, false, true, true, true, true, true }, checkpoint.checks.Select(check => check.pass));
        Assert.False(result.pass);
    }

    [Fact]
    public void G3_probe_settle_exhaustion_and_floating_reads_throw_instead_of_failing_checks()
    {
        var source = Source();
        var raw = JsonNode(source.ReadAllBytes("conformance/probes/AT-06.probe.json"));
        raw["cases"]![0]!["source"]!["wires"]![0] = "1A/1B";
        raw["cases"]![0]!["source"]!["actions"] = System.Text.Json.Nodes.JsonNode.Parse(
            "[{\"k\":\"advance\",\"ticks\":1}]");
        raw["cases"]![0]!["checkpoints"] = System.Text.Json.Nodes.JsonNode.Parse(
            "[{\"name\":\"sample\",\"at\":{\"k\":\"action\",\"actionIndex\":0,\"actionKind\":\"advance\"},\"checks\":[{\"k\":\"near\",\"name\":\"floating\",\"read\":{\"k\":\"terminalPairMv\",\"a\":\"1A\",\"b\":\"1B\"},\"expected\":0,\"tolerance\":0}]}]");
        var overlay = new OverlaySource(source, "conformance/probes/case.probe.json", JsonBytes(raw));
        Assert.Contains("terminalPairMv read is floating", Assert.Throws<ProbeException>(() =>
            ProbeRunner.Run(overlay, "conformance/probes/case.probe.json")).Message, StringComparison.Ordinal);

        raw["cases"]![0]!["source"]!["actions"] = System.Text.Json.Nodes.JsonNode.Parse(
            "[{\"k\":\"do\",\"cmd\":{\"k\":\"button\",\"n\":1,\"target\":1000}},{\"k\":\"settle\",\"maxTicks\":1}]");
        raw["cases"]![0]!["checkpoints"]![0]!["at"]!["actionIndex"] = 1;
        raw["cases"]![0]!["checkpoints"]![0]!["at"]!["actionKind"] = "settle";
        raw["cases"]![0]!["checkpoints"]![0]!["checks"] = System.Text.Json.Nodes.JsonNode.Parse(
            "[{\"k\":\"bool\",\"name\":\"clear\",\"read\":{\"k\":\"stateBool\",\"field\":\"breakerTripped\"},\"expected\":false}]");
        overlay = new OverlaySource(source, "conformance/probes/case.probe.json", JsonBytes(raw));
        Assert.Contains("settle exhausted its cap", Assert.Throws<ProbeException>(() =>
            ProbeRunner.Run(overlay, "conformance/probes/case.probe.json")).Message, StringComparison.Ordinal);
    }

    [Fact]
    public void G3_probe_fixture_replay_refuses_an_until_step_rather_than_skipping_its_ticks()
    {
        var source = Source();
        var fixturePaths = source.EnumerateFiles("conformance/fixtures", "I-EXP8-STEP5.fixture.json");
        Assert.Single(fixturePaths);
        var fixture = JsonNode(source.ReadAllBytes(fixturePaths[0]));
        var expectStep = fixture["script"]![3]!;
        fixture["script"]![2] = new System.Text.Json.Nodes.JsonObject
        {
            ["k"] = "until",
            ["obs"] = expectStep["obs"]!.DeepClone(),
            ["maxMs"] = 500,
            ["cite"] = expectStep["cite"]!.DeepClone(),
            ["quote"] = expectStep["quote"]!.DeepClone(),
        };
        var probe = System.Text.Json.Nodes.JsonNode.Parse(
            "{\"schema\":\"minivac.probe/1\",\"id\":\"AT-11\",\"source\":\"runner test\",\"profile\":\"MV601-REF-A\"," +
            "\"cases\":[{\"k\":\"machine\",\"name\":\"until-replay\",\"source\":{\"k\":\"fixture\",\"fixture\":\"I-EXP8-STEP5\"}," +
            "\"checkpoints\":[{\"name\":\"after-expect\",\"at\":{\"k\":\"fixtureStep\",\"scriptIndex\":3,\"stepKind\":\"expect\"}," +
            "\"checks\":[{\"k\":\"bool\",\"name\":\"clear\",\"read\":{\"k\":\"stateBool\",\"field\":\"breakerTripped\"},\"expected\":false}]}]}]}")!;
        var overlay = new OverlaySource(
            new OverlaySource(source, fixturePaths[0], JsonBytes(fixture)),
            "conformance/probes/case.probe.json",
            JsonBytes(probe));

        var error = Assert.Throws<ProbeException>(() =>
            ProbeRunner.Run(overlay, "conformance/probes/case.probe.json"));

        Assert.Equal("probe: fixture replay does not support until steps", error.Message);
    }

    private static Dictionary<string, Dictionary<string, string>> ExpectedPins() => new(StringComparer.Ordinal)
    {
        ["AT-01"] = Pins(
            ("i-exp9-latch/latched-after-release/coil-voltage", "6933"),
            ("i-exp9-latch/latched-after-release/relay-operated", "1000,1000"),
            ("i-exp9-latch/latched-after-release/holds-above-dropout", "46221,14787")),
        ["AT-04"] = Pins(
            ("r180/settled/above-dropout", "39148,16667"), ("r180/settled/below-pullin", "39148,43333"),
            ("r220/settled/above-dropout", "34994,16667"), ("r220/settled/below-pullin", "34994,43333"),
            ("r270/settled/above-dropout", "30873,16667"), ("r270/settled/below-pullin", "30873,43333"),
            ("r330/settled/above-dropout", "27035,16667"), ("r330/settled/below-pullin", "27035,43333"),
            ("r390/settled/above-dropout", "24041,16667"), ("r390/settled/below-pullin", "24041,43333"),
            ("r470/settled/above-dropout", "20944,16667"), ("r470/settled/below-pullin", "20944,43333"),
            ("r120/settled/at-or-above-pullin", "48024,43333"),
            ("r150/settled/near-nominal-pullin", "43236")),
        ["AT-05"] = Pins(
            ("realistic-c-fed/profile/settled-load", "818779"),
            ("realistic-c-fed/profile/below-trip", "818779,1500000"),
            ("e-fed-diagnostic/profile/settled-load", "1476564"),
            ("e-fed-diagnostic/profile/inrush-shorter-than-delay", "1005,2000")),
        ["AT-06"] = Pins(
            ("dead-short/first-boundary/dead-short-current", "19402985"),
            ("dead-short/trip-boundary/rail-zero", "0,0")),
        ["AT-07"] = Pins(
            ("e-fed/after-e-fed/relay-operated", "1000,1000"),
            ("e-fed/after-e-fed/indicator-dark", "0"),
            ("c-fed/after-c-fed/relay-operated", "1000,1000"),
            ("c-fed/after-c-fed/indicator-equals-coil", "47217,47217"),
            ("c-fed/after-c-fed/indicator-brightness", "749"),
            ("c-fed/after-c-fed/indicator-lit", "749,150"),
            ("c-fed/after-c-fed/holds-above-dropout", "47217,14787")),
        ["AT-09"] = Pins(
            ("trip-and-reset/power-substitute-off/rail-zero", "0,0"),
            ("trip-and-reset/power-substitute-restored/rail-positive", "13000,0")),
        ["AT-10"] = Pins(
            ("stop-short/settled/limited-current", "573445"),
            ("stop-short/settled/below-trip", "573445,1500000")),
        ["AT-11"] = Pins(
            ("all-six-relays/after-step5-settle/relay1-operated", "1000,1000"),
            ("all-six-relays/after-step5-settle/relay2-operated", "1000,1000"),
            ("all-six-relays/after-step5-settle/relay3-operated", "1000,1000"),
            ("all-six-relays/after-step5-settle/relay4-operated", "1000,1000"),
            ("all-six-relays/after-step5-settle/relay5-operated", "1000,1000"),
            ("all-six-relays/after-step5-settle/relay6-operated", "1000,1000"),
            ("all-six-relays/after-step5-settle/relay1-holds", "45961,14787"),
            ("all-six-relays/after-step5-settle/relay2-holds", "46146,15540"),
            ("all-six-relays/after-step5-settle/relay3-holds", "46423,16293"),
            ("all-six-relays/after-step5-settle/relay4-holds", "46842,17040"),
            ("all-six-relays/after-step5-settle/relay5-holds", "47486,17793"),
            ("all-six-relays/after-step5-settle/relay6-holds", "48500,18547")),
    };

    private static Dictionary<string, string> Pins(params (string Key, string Value)[] rows) =>
        rows.ToDictionary(row => row.Key, row => row.Value, StringComparer.Ordinal);

    private static Dictionary<string, string> NumericMeasurements(ProbeResult result)
    {
        var values = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var row in result.cases)
        {
            var checkpoints = row is MachineCaseResult machine
                ? machine.checkpoints.Select(checkpoint => (checkpoint.name, checkpoint.checks))
                : [("profile", ((ProfileLoadCaseResult)row).checks)];
            foreach (var checkpoint in checkpoints)
            {
                foreach (var check in checkpoint.checks)
                {
                    var key = row.name + "/" + checkpoint.name + "/" + check.name;
                    if (check is NearCheckResult near) values.Add(key, near.actual.ToString());
                    else if (check is CompareCheckResult compare) values.Add(key, compare.left + "," + compare.right);
                }
            }
        }
        return values;
    }

    private static string ResultFingerprint(ProbeResult result)
    {
        var parts = new List<string> { result.schema, result.id, result.profile, result.pass.ToString() };
        foreach (var row in result.cases)
        {
            parts.Add(row.k + ":" + row.name);
            var checkpoints = row is MachineCaseResult machine
                ? machine.checkpoints.Select(checkpoint => (checkpoint.name, checkpoint.checks))
                : [("profile", ((ProfileLoadCaseResult)row).checks)];
            foreach (var checkpoint in checkpoints)
            {
                parts.Add(checkpoint.name);
                foreach (var check in checkpoint.checks)
                {
                    parts.Add(check switch
                    {
                        NearCheckResult near => near.name + ":" + near.actual + ":" + near.expected + ":" + near.tolerance + ":" + near.pass,
                        CompareCheckResult compare => compare.name + ":" + compare.left + ":" + compare.op + ":" + compare.right + ":" + compare.pass,
                        BoolCheckResult boolean => boolean.name + ":" + boolean.actual + ":" + boolean.expected + ":" + boolean.pass,
                        EventSeenCheckResult seen => seen.name + ":" + seen.count + ":" + seen.expected + ":" + seen.pass,
                        _ => throw new InvalidOperationException(),
                    });
                }
            }
        }
        return string.Join("|", parts);
    }

    private static System.Text.Json.Nodes.JsonNode JsonNode(byte[] bytes) =>
        System.Text.Json.Nodes.JsonNode.Parse(bytes)!;

    private static byte[] JsonBytes(System.Text.Json.Nodes.JsonNode node) =>
        System.Text.Encoding.UTF8.GetBytes(node.ToJsonString() + "\n");

    private static FileSystemSource Source() =>
        new(Path.GetFullPath("../../../../..", AppContext.BaseDirectory));

    private sealed class OverlaySource(IArtifactSource inner, string path, byte[] bytes) : IArtifactSource
    {
        public byte[] ReadAllBytes(string relativePath) => relativePath == path ? (byte[])bytes.Clone() : inner.ReadAllBytes(relativePath);
        public IReadOnlyList<string> EnumerateFiles(string relativeDir, string pattern) => inner.EnumerateFiles(relativeDir, pattern);
    }
}
