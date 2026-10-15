using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Minivac.Conformance;
using Minivac.Core;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class G3TierBCollapsePortTests
{
    [Fact]
    public void G3_collapse_gate_runs_all_eight_shipped_fixtures_and_pins_live_functional_failures()
    {
        var source = Source();
        var expectedPaths = CollapseGate.IDS.Select(PathFor).ToArray();
        Assert.Equal(
            expectedPaths.Order(StringComparer.Ordinal),
            source.EnumerateFiles("conformance/fixtures/B", "*.fixture.json")
                .Where(expectedPaths.Contains)
                .Order(StringComparer.Ordinal));

        foreach (var id in CollapseGate.IDS)
        {
            var loaded = FixtureLoader.LoadFixture(source, PathFor(id));
            var first = TraceRunner.RunLoadedFixture(loaded);
            var second = TraceRunner.RunLoadedFixture(loaded);
            Assert.Empty(first.failures);
            Assert.Empty(second.failures);
            Assert.Equal(first.trace, second.trace);
            Assert.Equal(first.metrics, second.metrics);
            Assert.Equal(first.digest.eventCount, second.digest.eventCount);
            Assert.Equal(first.digest.moverTransitions, second.digest.moverTransitions);

            var collapsedScript = CollapseGate.withoutCollapseSteps(loaded.fixture.script);
            Assert.True(collapsedScript.Count < loaded.fixture.script.Count, id);
            var collapsed = TraceRunner.RunLoadedFixture(loaded with
            {
                fixture = loaded.fixture with { script = collapsedScript },
            });
            var functional = collapsed.failures
                .Where(failure => !CollapseGate.isControlPosition(failure.dev))
                .Select(Failure)
                .ToArray();
            Assert.Equal(CollapseGate.expectedFunctionalFailures(id).ToArray(), functional);

            if (id == "II-SELFLOCK")
            {
                Assert.Contains(
                    collapsed.failures,
                    failure => Failure(failure) == CollapseGate.SELF_LOCK_WITNESS);
                Assert.Empty(functional);
            }
        }
    }

    [Fact]
    public void G3_neutralised_coil_live_runs_keep_II_FF1_green_and_pin_IV_FF2_failures()
    {
        var source = Source();
        var raw = System.Text.Json.Nodes.JsonNode.Parse(
            source.ReadAllBytes("data/profiles/MV601-REF-A.json"))!;
        raw["values"]!["L_coil_uh"]!["v"] = 12_000;
        using var document = JsonDocument.Parse(Encoding.UTF8.GetBytes(raw.ToJsonString() + "\n"));
        var neutralised = Profile.LoadProfile(document.RootElement);

        var control = FixtureLoader.LoadFixture(source, PathFor("II-FF1"));
        var controlResult = TraceRunner.RunLoadedFixture(control with { profile = neutralised });
        Assert.Equal(CollapseGate.NEUTRALISED_II_FF1, controlResult.failures.Select(Failure));

        var witness = FixtureLoader.LoadFixture(source, PathFor("IV-FF2"));
        var witnessResult = TraceRunner.RunLoadedFixture(witness with { profile = neutralised });
        Assert.Equal(CollapseGate.NEUTRALISED_IV_FF2, witnessResult.failures.Select(Failure));
    }

    private static CollapseFailure Failure(ExpectationFailure failure) =>
        new(failure.scriptIndex, failure.dev, failure.expected, failure.actual);

    private static string PathFor(string id) => "conformance/fixtures/B/" + id + ".fixture.json";

    private static FileSystemSource Source() =>
        new(Path.GetFullPath("../../../../..", AppContext.BaseDirectory));
}
