using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class P6AssetProvenanceTests
{
    private const string DropOutId = "relay-drop-out-cue";
    private const string DropOutPath = "public/audio/relay-drop-out-cue.wav";
    private const string RequiredAudioSuffix = "is not an authenticated MINIVAC recording";
    private const string PullInSha256 = "ed35a3c8c59b0ec3ecc8688a040851cce25df9688475152d31d9c8a1aeb1517f";
    private static readonly string[] ExistingRecordIds =
    [
        "panel-ph2-primary", "panel-ph3-corroboration", "relay-simulation-source",
        "rotary-drive-simulation-source", "relay-cue", "rotary-drive-loop",
    ];
    private static readonly string[] RequiredFields =
    [
        "id", "kind", "localPath", "sourcePage", "directSource", "creator", "captureDate",
        "license", "licenseUrl", "sha256", "purpose", "derivativeStatus", "ship",
    ];

    [Fact]
    public void Drop_out_asset_is_complete_hashed_and_mirrored_without_changing_the_pinned_inventory()
    {
        var root = RepoRoot();
        using var document = JsonDocument.Parse(File.ReadAllBytes(Path.Combine(root, "data/public-assets.json")));
        var records = document.RootElement.GetProperty("records").EnumerateArray().ToArray();
        Assert.Equal(7, records.Length);
        foreach (var id in ExistingRecordIds)
            Assert.Single(records, record => record.GetProperty("id").GetString() == id);

        var dropOut = Assert.Single(records, record => record.GetProperty("id").GetString() == DropOutId);
        foreach (var field in RequiredFields)
            AssertRequired(dropOut, field);
        Assert.Equal("shipped-audio", dropOut.GetProperty("kind").GetString());
        Assert.Equal(DropOutPath, dropOut.GetProperty("localPath").GetString());
        Assert.True(dropOut.GetProperty("ship").GetBoolean());
        Assert.EndsWith(RequiredAudioSuffix, dropOut.GetProperty("derivativeStatus").GetString(), StringComparison.Ordinal);

        var source = Path.Combine(root, DropOutPath);
        var mirror = Path.Combine(root, "godot/audio/relay-drop-out-cue.wav");
        Assert.True(File.Exists(source), "missing source drop-out WAV");
        Assert.True(File.Exists(mirror), "missing Godot mirror drop-out WAV");
        var sourceHash = Hash(File.ReadAllBytes(source));
        Assert.Equal(sourceHash, Hash(File.ReadAllBytes(mirror)));
        Assert.Equal(dropOut.GetProperty("sha256").GetString(), sourceHash);
        Assert.Equal(PullInSha256, Hash(File.ReadAllBytes(Path.Combine(root, "public/audio/relay-cue.wav"))));

        Assert.Equal(2, document.RootElement.GetProperty("excludedReferences").GetArrayLength());
        Assert.Equal(new[] { "panel-ph1-low-resolution", "panel-ph4-minivac-6010" },
            document.RootElement.GetProperty("excludedReferences").EnumerateArray()
                .Select(row => row.GetProperty("id").GetString()));
        Assert.Equal(new[] { "relay-cue.wav", "relay-drop-out-cue.wav", "rotary-drive-loop.wav" },
            Directory.GetFiles(Path.Combine(root, "public/audio"), "*.wav").Select(Path.GetFileName).OrderBy(name => name));
        Assert.Equal(new[] { "relay-cue.wav", "relay-drop-out-cue.wav", "rotary-drive-loop.wav" },
            Directory.GetFiles(Path.Combine(root, "godot/audio"), "*.wav").Select(Path.GetFileName).OrderBy(name => name));
        Assert.Empty(Directory.GetFiles(Path.Combine(root, "godot"), "*.ttf", SearchOption.AllDirectories)
            .Concat(Directory.GetFiles(Path.Combine(root, "godot"), "*.otf", SearchOption.AllDirectories))
            .Concat(Directory.GetFiles(Path.Combine(root, "public"), "*.ttf", SearchOption.AllDirectories))
            .Concat(Directory.GetFiles(Path.Combine(root, "public"), "*.otf", SearchOption.AllDirectories)));
        Assert.Equal("b9149d8ca70d77b4a1ee23fb04adb685563491a83a34127ee0b5e5be91f2b931",
            Hash(File.ReadAllBytes(Path.Combine(root, "docs/research/raw/audio/relay-switch-bassmosphere-preview.mp3"))));
    }

    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static void AssertRequired(JsonElement record, string field)
    {
        Assert.True(record.TryGetProperty(field, out var value), "relay-drop-out-cue." + field + " is required");
        if (field == "ship")
        {
            Assert.Equal(JsonValueKind.True, value.ValueKind);
            return;
        }
        Assert.Equal(JsonValueKind.String, value.ValueKind);
        Assert.False(string.IsNullOrWhiteSpace(value.GetString()), "relay-drop-out-cue." + field + " is empty");
    }

    private static string RepoRoot() => Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));
}
