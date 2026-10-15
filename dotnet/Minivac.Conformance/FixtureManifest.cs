using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Minivac.Conformance;

public sealed record ManifestEntry(string path, string suite, string sha256)
{
    /// <summary>Source-relative path, e.g. conformance/fixtures/A/I-EXP1.fixture.json.</summary>
    public string SourcePath => FixtureManifest.FixtureDir + "/" + path;

    /// <summary>Tier directory: A, B, C1 or C2.</summary>
    public string Tier => path[..path.IndexOf('/')];
}

/// <summary>
/// conformance/fixtures/manifest.json, the one fixture inventory (docs/plans/phase-5-corpus.md, Step 1a).
/// Shape rules mirror readManifest() in test/conformance/manifest.ts. Fixture bytes are not hashed here;
/// the TS suite pins sha256 and DataIdentityTests pins the Godot copy byte-identical.
/// </summary>
public static partial class FixtureManifest
{
    public const string Schema = "minivac.fixture-manifest/1";
    public const string FixtureDir = "conformance/fixtures";
    public const string ManifestPath = FixtureDir + "/manifest.json";

    [GeneratedRegex(@"^(A|B|C1|C2)/[A-Z0-9-]+\.fixture\.json\z")]
    private static partial Regex PathPattern();

    [GeneratedRegex(@"^[0-9a-f]{64}\z")]
    private static partial Regex ShaPattern();

    public static IReadOnlyList<ManifestEntry> Read(IArtifactSource source)
    {
        ArgumentNullException.ThrowIfNull(source);
        using var document = StrictJson.Read(source, ManifestPath, "manifest");
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object) throw Fail("not an object");
        if (!root.TryGetProperty("schema", out var schema) || schema.ValueKind != JsonValueKind.String
            || schema.GetString() != Schema)
            throw Fail("schema is not " + Schema);
        if (!root.TryGetProperty("fixtures", out var fixtures) || fixtures.ValueKind != JsonValueKind.Array
            || fixtures.GetArrayLength() == 0)
            throw Fail("fixtures is not a non-empty array");

        var entries = new List<ManifestEntry>();
        foreach (var row in fixtures.EnumerateArray())
        {
            var where = "fixtures[" + entries.Count + "]";
            if (row.ValueKind != JsonValueKind.Object) throw Fail(where + " is not an object");
            var keys = string.Join(",", row.EnumerateObject().Select(property => property.Name).Order(StringComparer.Ordinal));
            if (keys != "path,sha256,suite") throw Fail(where + " keys are " + keys);
            var path = String(row, "path");
            var suite = String(row, "suite");
            var sha256 = String(row, "sha256");
            if (path is null || !PathPattern().IsMatch(path)) throw Fail(where + " path is invalid");
            if (suite != "printed" && suite != "speculative") throw Fail(where + " suite is invalid");
            if (sha256 is null || !ShaPattern().IsMatch(sha256)) throw Fail(where + " sha256 is invalid");
            entries.Add(new ManifestEntry(path, suite, sha256));
        }

        for (var index = 1; index < entries.Count; index++)
        {
            if (string.CompareOrdinal(entries[index - 1].path, entries[index].path) >= 0)
                throw Fail("paths are not in strict ordinal order at " + index);
        }
        return entries;
    }

    /// <summary>Source-relative fixture paths in manifest order.</summary>
    public static IReadOnlyList<string> SourcePaths(IArtifactSource source) =>
        Read(source).Select(entry => entry.SourcePath).ToArray();

    private static string? String(JsonElement row, string name) =>
        row.GetProperty(name).ValueKind == JsonValueKind.String ? row.GetProperty(name).GetString() : null;

    private static FixtureException Fail(string message) => new("manifest: " + message);
}
