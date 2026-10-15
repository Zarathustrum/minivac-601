using System;
using System.IO;
using System.Text;
using Minivac.Conformance;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class G3BlessRefusalPolicyTests
{
    [Fact]
    public void Structured_expectation_failure_is_refused_first()
    {
        var failed = Run(expectedPower: "on");
        var result = AsC2(failed with
        {
            metrics = new Metrics(0, 1),
        }, digest: null);
        var failure = Assert.Single(result.failures);
        Assert.Equal(0, failure.scriptIndex);

        var error = Assert.Throws<GoldenAcceptanceException>(
            () => GoldenAcceptancePolicy.AssertAcceptable(result));
        Assert.Equal(
            "bless: assertion failed at script[0] power: expected on, got off",
            error.Message);
    }

    [Fact]
    public void Non_marginal_minimum_decision_margin_is_refused()
    {
        var baseline = Run();
        var minimum = baseline.loaded.profile.v.min_decision_ua;
        var result = baseline with { metrics = new Metrics(checked((int)minimum - 1), null) };

        var error = Assert.Throws<GoldenAcceptanceException>(
            () => GoldenAcceptancePolicy.AssertAcceptable(result));
        Assert.Equal(
            "bless: minDecisionUa " + (minimum - 1) + " is below profile minimum " + minimum,
            error.Message);
    }

    [Fact]
    public void Non_marginal_minimum_tick_gap_is_refused()
    {
        var baseline = Run();
        var minimum = baseline.loaded.profile.v.min_tick_gap;
        var result = baseline with { metrics = new Metrics(null, checked((int)minimum - 1)) };

        var error = Assert.Throws<GoldenAcceptanceException>(
            () => GoldenAcceptancePolicy.AssertAcceptable(result));
        Assert.Equal(
            "bless: minTickGap " + (minimum - 1) + " is below profile minimum " + minimum,
            error.Message);
    }

    [Fact]
    public void C2_missing_or_unequal_reviewed_digest_is_refused_field_by_field()
    {
        var baseline = AsC2(Run(), digest: null);
        AssertC2Refused(baseline);

        var actual = baseline.digest;
        AssertC2Refused(AsC2(baseline, new ReviewedDigest(
            actual.eventCount + 1,
            actual.moverTransitions)));

        var changedMover = CopyMovers(actual);
        changedMover[7]++;
        AssertC2Refused(AsC2(baseline, new ReviewedDigest(
            actual.eventCount,
            Array.AsReadOnly(changedMover))));

        var shortMovers = new int[actual.moverTransitions.Count - 1];
        for (var index = 0; index < shortMovers.Length; index++)
            shortMovers[index] = actual.moverTransitions[index];
        AssertC2Refused(AsC2(baseline, new ReviewedDigest(
            actual.eventCount,
            Array.AsReadOnly(shortMovers))));
    }

    [Fact]
    public void Exact_C2_digest_and_marginal_numeric_exceptions_are_accepted()
    {
        var source = new FileSystemSource(RepositoryRoot());
        var baseline = TraceRunner.RunFixture(
            source,
            "conformance/fixtures/B/IV-FF2.fixture.json");
        Assert.True(baseline.loaded.fixture.marginal);
        Assert.NotNull(baseline.loaded.fixture.mechanism);
        var marginalFixture = baseline.loaded.fixture with
        {
            tier = "C2",
            digest = baseline.digest,
        };
        var result = baseline with
        {
            loaded = baseline.loaded with { fixture = marginalFixture },
            metrics = new Metrics(0, 1),
        };

        GoldenAcceptancePolicy.AssertAcceptable(result);
    }

    private static void AssertC2Refused(RunResult result)
    {
        var error = Assert.Throws<GoldenAcceptanceException>(
            () => GoldenAcceptancePolicy.AssertAcceptable(result));
        Assert.Equal(
            "bless: computed C2 digest differs from reviewed fixture digest",
            error.Message);
    }

    private static RunResult AsC2(RunResult result, ReviewedDigest? digest)
    {
        var fixture = result.loaded.fixture with { tier = "C2", digest = digest };
        return result with { loaded = result.loaded with { fixture = fixture } };
    }

    private static int[] CopyMovers(ReviewedDigest digest)
    {
        var copy = new int[digest.moverTransitions.Count];
        for (var index = 0; index < copy.Length; index++) copy[index] = digest.moverTransitions[index];
        return copy;
    }

    private static RunResult Run(string expectedPower = "off")
    {
        var source = new FileSystemSource(RepositoryRoot());
        return TraceRunner.RunFixture(
            source,
            "bless-policy.fixture.json",
            FixtureBytes(expectedPower));
    }

    private static byte[] FixtureBytes(string expectedPower) => Encoding.UTF8.GetBytes(
        "{\"schema\":\"minivac.fixture/1\",\"id\":\"BLESS-POLICY\",\"source\":\"policy test\"," +
        "\"tier\":\"A\",\"confidence\":\"verified\",\"profile\":\"MV601-REF-A\"," +
        "\"contract\":\"1.1.0\",\"as_printed\":[\"A/B\"],\"errata_applied\":[]," +
        "\"wires\":[\"1A/1B\"],\"script\":[{\"k\":\"expect\",\"obs\":[{\"dev\":\"power\"," +
        "\"v\":\"" + expectedPower + "\"}],\"cite\":\"policy test\",\"quote\":\"Power state.\"}]}\n");

    private static string RepositoryRoot() =>
        Path.GetFullPath("../../../../../", AppContext.BaseDirectory);
}
