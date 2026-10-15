using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using Minivac.Conformance;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class ArtifactSourceTests
{
    [Theory]
    [InlineData("data/netlist.json", "315c25f15aac1a25296372b71d8ef850eacfba534b6b4577cd8593e7db579cd6")]
    [InlineData("data/profiles/MV601-REF-A.json", "34b35db1b099944c1f6abc90cee476ecaba9aa0fa4108cfdca594fcad24424e8")]
    [InlineData("conformance/fixture.schema.json", "22aa05e08a1122a2edbc8301384f393ca96c81d990574411b455e97d24135190")]
    public void ReadAllBytes_maps_both_artifact_roots_without_changing_bytes(
        string relativePath,
        string expectedSha256)
    {
        var source = new FileSystemSource(FindRepositoryRoot());

        var actual = Convert.ToHexString(SHA256.HashData(source.ReadAllBytes(relativePath))).ToLowerInvariant();

        Assert.Equal(expectedSha256, actual);
    }

    [Fact]
    public void EnumerateFiles_is_recursive_source_relative_and_ordinal()
    {
        var source = new FileSystemSource(FindRepositoryRoot());

        var paths = source.EnumerateFiles("conformance/fixtures", "*.fixture.json");

        Assert.Equal(FixtureManifest.SourcePaths(source), paths);
        Assert.Equal(paths.Order(StringComparer.Ordinal), paths);
        Assert.All(paths, path => Assert.StartsWith("conformance/fixtures/", path, StringComparison.Ordinal));
    }

    [Theory]
    [MemberData(nameof(InvalidArtifactPaths))]
    public void ReadAllBytes_rejects_paths_outside_the_two_artifact_roots(string path)
    {
        var source = new FileSystemSource(FindRepositoryRoot());

        Assert.Throws<ArgumentException>(() => source.ReadAllBytes(path));
    }

    public static IEnumerable<object[]> InvalidArtifactPaths()
    {
        yield return ["dotnet/Minivac.sln"];
        yield return ["test/conformance/fixture.schema.json"];
        yield return ["../package.json"];
        yield return ["data/../package.json"];
        yield return ["data\\netlist.json"];
        yield return [Path.GetFullPath("data/netlist.json")];
    }

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (directory.GetFiles("package.json", SearchOption.TopDirectoryOnly).Length == 1 &&
                directory.GetDirectories("data", SearchOption.TopDirectoryOnly).Length == 1 &&
                directory.GetDirectories("dotnet", SearchOption.TopDirectoryOnly).Length == 1)
                return directory.FullName;
        }

        throw new InvalidOperationException("repository root not found");
    }
}
