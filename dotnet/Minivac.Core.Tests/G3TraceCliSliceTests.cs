using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Minivac.Conformance;
using Xunit;
using TraceProgram = Minivac.TraceCli.Program;

namespace Minivac.Core.Tests;

public sealed class G3TraceCliSliceTests
{
    [Fact]
    public void All_manifest_fixture_traces_are_repeatable_and_byte_equal_to_goldens()
    {
        var source = ArtifactSource();
        var fixturePaths = source.EnumerateFiles("conformance/fixtures", "*.fixture.json");
        var manifest = FixtureManifest.Read(source);
        Assert.Equal(manifest.Select(entry => entry.SourcePath), fixturePaths);
        foreach (var tier in new[] { "A", "B", "C1", "C2" })
            Assert.Equal(manifest.Count(entry => entry.Tier == tier), CountTier(fixturePaths, tier));

        foreach (var fixturePath in fixturePaths)
        {
            var first = TraceRunner.RunFixture(source, fixturePath);
            var second = TraceRunner.RunFixture(source, fixturePath);
            Assert.Empty(first.failures);
            Assert.Empty(second.failures);
            var actual = new UTF8Encoding(false).GetBytes(first.trace);
            Assert.Equal(actual, new UTF8Encoding(false).GetBytes(second.trace));
            Assert.Equal(source.ReadAllBytes(GoldenPath(fixturePath)), actual);
        }
    }

    [Theory]
    [InlineData("IV-EXP1-SLOW", 24, 9)]
    [InlineData("IV-EXP1-FAST", 8, 9)]
    [InlineData("ER-ALTCOUNTER", 65, 9)]
    public void Counter_metrics_match_the_three_pinned_pairs(
        string id,
        int minDecisionUa,
        int minTickGap)
    {
        var result = TraceRunner.RunFixture(
            ArtifactSource(),
            "conformance/fixtures/B/" + id + ".fixture.json");
        Assert.Empty(result.failures);
        Assert.Equal(minDecisionUa, result.metrics.minDecisionUa);
        Assert.Equal(minTickGap, result.metrics.minTickGap);
    }

    [Fact]
    public void Cli_preserves_exact_streams_and_exit_codes_for_all_five_cases()
    {
        var root = FindRepositoryRoot();
        var source = new FileSystemSource(root);
        var fixturePath = "case.fixture.json";

        var cleanBytes = CliFixture(expected: "off");
        var clean = ExecuteCli(root, [fixturePath], _ => cleanBytes);
        Assert.Equal(0, clean.ExitCode);
        Assert.Empty(clean.StandardError);
        Assert.Equal(
            TraceRunner.RunFixture(source, fixturePath, cleanBytes).trace,
            clean.StandardOutput);

        var assertionBytes = CliFixture(expected: "on");
        var assertion = ExecuteCli(root, [fixturePath], _ => assertionBytes);
        Assert.Equal(1, assertion.ExitCode);
        Assert.Equal(
            TraceRunner.RunFixture(source, fixturePath, assertionBytes).trace,
            assertion.StandardOutput);
        Assert.Equal(
            "minivac-trace: assertion failed at script[0] power: expected on, got off\n",
            assertion.StandardError);

        var invalid = ExecuteCli(root, [fixturePath], _ => "{}\n"u8.ToArray());
        Assert.Equal(1, invalid.ExitCode);
        Assert.Empty(invalid.StandardOutput);
        Assert.StartsWith(
            "minivac-trace: fixture: schema validation failed:",
            invalid.StandardError,
            StringComparison.Ordinal);

        var fallbacks = ExecuteCli(root, ["--list-fallbacks"], _ => throw new InvalidOperationException());
        Assert.Equal(0, fallbacks.ExitCode);
        Assert.Empty(fallbacks.StandardError);
        Assert.Equal(Fallbacks.Format(Fallbacks.List(source)), fallbacks.StandardOutput);

        var arity = ExecuteCli(root, [], _ => throw new InvalidOperationException());
        Assert.Equal(1, arity.ExitCode);
        Assert.Empty(arity.StandardOutput);
        Assert.Equal(
            "minivac-trace: usage: minivac-trace <fixture.json> | minivac-trace --list-fallbacks\n",
            arity.StandardError);
    }

    private static int CountTier(IReadOnlyList<string> paths, string tier)
    {
        var prefix = "conformance/fixtures/" + tier + "/";
        var count = 0;
        foreach (var path in paths)
        {
            if (path.StartsWith(prefix, StringComparison.Ordinal)) count++;
        }
        return count;
    }

    private static string GoldenPath(string fixturePath) =>
        fixturePath.Replace("conformance/fixtures/", "conformance/golden/", StringComparison.Ordinal)
            .Replace(".fixture.json", ".trace", StringComparison.Ordinal);

    private static byte[] CliFixture(string expected) => Encoding.UTF8.GetBytes(
        "{\"schema\":\"minivac.fixture/1\",\"id\":\"CLI-CASE\",\"source\":\"cli test\"," +
        "\"tier\":\"A\",\"confidence\":\"verified\",\"profile\":\"MV601-REF-A\"," +
        "\"contract\":\"1.1.0\",\"as_printed\":[\"A/B\"],\"errata_applied\":[]," +
        "\"wires\":[\"1A/1B\"],\"script\":[{\"k\":\"expect\",\"obs\":[{\"dev\":\"power\"," +
        "\"v\":\"" + expected + "\"}],\"cite\":\"cli test\",\"quote\":\"Power state.\"}]}\n");

    private static (int ExitCode, string StandardOutput, string StandardError) ExecuteCli(
        string root,
        string[] args,
        Func<string, byte[]> fixtureReader)
    {
        using var standardOutput = new MemoryStream();
        using var standardError = new MemoryStream();
        var exitCode = TraceProgram.Execute(args, root, standardOutput, standardError, fixtureReader);
        return (
            exitCode,
            Encoding.UTF8.GetString(standardOutput.ToArray()),
            Encoding.UTF8.GetString(standardError.ToArray()));
    }

    private static IArtifactSource ArtifactSource() => new FileSystemSource(FindRepositoryRoot());

    private static string FindRepositoryRoot() =>
        Path.GetFullPath("../../../../../", AppContext.BaseDirectory);
}
