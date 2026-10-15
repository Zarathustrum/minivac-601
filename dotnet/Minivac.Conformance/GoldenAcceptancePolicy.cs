using System;
using System.Globalization;

namespace Minivac.Conformance;

public sealed class GoldenAcceptanceException : Exception
{
    public GoldenAcceptanceException(string message) : base("bless: " + message) { }
}

public static class GoldenAcceptancePolicy
{
    public static void AssertAcceptable(RunResult result)
    {
        if (result.failures.Count > 0)
        {
            var first = result.failures[0];
            Fail("assertion failed at script[" + F(first.scriptIndex) + "] " + first.dev +
                ": expected " + first.expected + ", got " + first.actual);
        }

        var fixture = result.loaded.fixture;
        var profile = result.loaded.profile;
        if (result.metrics.minDecisionUa is int minDecisionUa &&
            minDecisionUa < profile.v.min_decision_ua && !fixture.marginal)
        {
            Fail("minDecisionUa " + F(minDecisionUa) +
                " is below profile minimum " + F(profile.v.min_decision_ua));
        }
        if (result.metrics.minTickGap is int minTickGap &&
            minTickGap < profile.v.min_tick_gap && !fixture.marginal)
        {
            Fail("minTickGap " + F(minTickGap) +
                " is below profile minimum " + F(profile.v.min_tick_gap));
        }
        if (string.Equals(fixture.tier, "C2", StringComparison.Ordinal) &&
            (fixture.digest is null || !DigestEqual(result.digest, fixture.digest)))
        {
            Fail("computed C2 digest differs from reviewed fixture digest");
        }
    }

    private static bool DigestEqual(ReviewedDigest left, ReviewedDigest right)
    {
        if (left.eventCount != right.eventCount ||
            left.moverTransitions.Count != right.moverTransitions.Count)
        {
            return false;
        }
        for (var index = 0; index < left.moverTransitions.Count; index++)
        {
            if (left.moverTransitions[index] != right.moverTransitions[index]) return false;
        }
        return true;
    }

    private static void Fail(string message) => throw new GoldenAcceptanceException(message);

    private static string F(int value) => value.ToString(CultureInfo.InvariantCulture);

    private static string F(long value) => value.ToString(CultureInfo.InvariantCulture);
}
