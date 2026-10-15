using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class DataIdentityTests
{
    [Theory]
    [InlineData("data", "godot/data", false, false)]
    [InlineData("test/conformance", "godot/conformance", false, true)]
    [InlineData("public/audio", "godot/audio", true, false)]
    public void Godot_copy_matches_authoritative_bytes(
        string sourceRelative,
        string copyRelative,
        bool audioOnly,
        bool conformanceOnly)
    {
        var root = FindRepositoryRoot();
        Assert.Equal(
            Hashes(Path.Combine(root, sourceRelative), audioOnly, conformanceOnly),
            Hashes(Path.Combine(root, copyRelative), audioOnly, conformanceOnly));
    }

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(Directory.GetCurrentDirectory()); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "package.json")) && Directory.Exists(Path.Combine(directory.FullName, "godot")))
                return directory.FullName;
        }

        throw new InvalidOperationException("repository root not found");
    }

    private static IReadOnlyDictionary<string, string> Hashes(string root, bool audioOnly, bool conformanceOnly)
    {
        var hashes = new SortedDictionary<string, string>(StringComparer.Ordinal);
        foreach (var path in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(root, path).Replace(Path.DirectorySeparatorChar, '/');
            if (audioOnly && !relative.EndsWith(".wav", StringComparison.Ordinal)) continue;
            if (conformanceOnly && relative is not "fixture.schema.json" and not "probe.schema.json" &&
                !relative.StartsWith("fixtures/", StringComparison.Ordinal) &&
                !relative.StartsWith("golden/", StringComparison.Ordinal) &&
                !relative.StartsWith("probes/", StringComparison.Ordinal)) continue;
            hashes.Add(relative, Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))));
        }

        return hashes;
    }
}
