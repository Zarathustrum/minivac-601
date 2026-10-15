using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Minivac.Conformance;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class ProfileTests
{
    [Fact]
    public void exported_key_lists_and_shipped_profiles_match_the_profile_contract()
    {
        Assert.Equal(43, Profile.SCALAR_KEYS.Count);
        Assert.Equal(new[] { "dV_relay_mv", "lamp_pwl_uohm" }, Profile.ARRAY_KEYS);
        Assert.Equal(new[] { "schema", "id", "marginal", "provenance", "values" }, Profile.TOP_KEYS);
        Assert.Equal("minivac.profile/1", Profile.SCHEMA);

        using var referenceDocument = ReadJson("data/profiles/MV601-REF-A.json");
        using var idealDocument = ReadJson("data/profiles/MV601-IDEAL.json");
        var reference = Profile.LoadProfile(referenceDocument.RootElement);
        var ideal = Profile.LoadProfile(idealDocument.RootElement);
        Assert.Equal("MV601-REF-A", reference.id);
        Assert.True(reference.marginal);
        Assert.Equal("MV601-IDEAL", ideal.id);
        Assert.False(ideal.marginal);
    }

    [Fact]
    public void profile_kat_matches_all_ten_derived_members_bit_exact()
    {
        using var document = ReadJson("data/kat/profile-kat.json");
        var root = document.RootElement;
        Assert.Equal("minivac.profile-kat/1", root.GetProperty("schema").GetString());
        var profile = Profile.LoadProfile(root.GetProperty("profile"));
        var expected = root.GetProperty("derived");

        Assert.Equal("MV601-KAT-A", profile.id);
        Assert.Equal(9, profile.pwl.Count);
        Assert.Equal(expected.GetProperty("pullInUa").GetInt32(), profile.derived.pullInUa);
        Assert.Equal(expected.GetProperty("dropOutUa").GetInt32(), profile.derived.dropOutUa);
        Assert.Equal(ReadIntArray(expected.GetProperty("relayPullInUa")), profile.derived.relayPullInUa);
        Assert.Equal(ReadIntArray(expected.GetProperty("relayDropOutUa")), profile.derived.relayDropOutUa);
        Assert.Equal(expected.GetProperty("relayOperateTicks").GetInt64(), profile.derived.relayOperateTicks);
        Assert.Equal(expected.GetProperty("relayReleaseTicks").GetInt64(), profile.derived.relayReleaseTicks);
        Assert.Equal(expected.GetProperty("pushbuttonTicks").GetInt64(), profile.derived.pushbuttonTicks);
        Assert.Equal(expected.GetProperty("slideTicks").GetInt64(), profile.derived.slideTicks);
        Assert.Equal(expected.GetProperty("arcStepUa").GetInt32(), profile.derived.arcStepUa);

        var bitsText = expected.GetProperty("kThermal").GetString()!;
        var expectedBits = ulong.Parse(bitsText.AsSpan(2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        Assert.Equal(unchecked((long)expectedBits), BitConverter.DoubleToInt64Bits(profile.derived.kThermal));
    }

    [Fact]
    public void w3_kat_matches_nine_derived_members_and_source_hash()
    {
        using var profileKat = ReadJson("data/kat/profile-kat.json");
        using var w3Kat = ReadJson("data/kat/w3-derived-kat.json");
        var profile = Profile.LoadProfile(profileKat.RootElement.GetProperty("profile"));
        Assert.Equal("minivac.w3-derived-kat/1", w3Kat.RootElement.GetProperty("schema").GetString());
        var source = w3Kat.RootElement.GetProperty("source");
        Assert.Equal("data/kat/profile-kat.json", source.GetProperty("profileKat").GetString());
        Assert.Equal("MV601-KAT-A", source.GetProperty("profileId").GetString());
        var expected = w3Kat.RootElement.GetProperty("derived");

        Assert.Equal("8fb3c78e1d2c9a09", profile.hash);
        Assert.Equal(source.GetProperty("profileHash").GetString(), profile.hash);
        Assert.Equal(expected.GetProperty("tripDelayTicks").GetInt32(), profile.derived.tripDelayTicks);
        Assert.Equal(expected.GetProperty("deadShortUa").GetInt32(), profile.derived.deadShortUa);
        Assert.Equal(expected.GetProperty("rMotorParUohm").GetInt32(), profile.derived.rMotorParUohm);
        Assert.Equal(expected.GetProperty("vMotorRunMv").GetInt32(), profile.derived.vMotorRunMv);
        Assert.Equal(expected.GetProperty("relayCycleTicks").GetInt32(), profile.derived.relayCycleTicks);
        Assert.Equal(expected.GetProperty("buttonCycleTicks").GetInt32(), profile.derived.buttonCycleTicks);
        Assert.Equal(expected.GetProperty("switchCycleTicks").GetInt32(), profile.derived.switchCycleTicks);
        Assert.Equal(expected.GetProperty("dialCycleTicks").GetInt32(), profile.derived.dialCycleTicks);
        Assert.Equal(expected.GetProperty("settleCapTicks").GetInt32(), profile.derived.settleCapTicks);
    }

    [Fact]
    public void semantic_hash_pins_ref_a_and_ignores_provenance()
    {
        var baseline = RefNode();
        var baselineProfile = Load(baseline);
        Assert.Equal("92c1419fd8cdd210", baselineProfile.hash);

        var prose = RefNode();
        prose["provenance"] = "different profile provenance";
        var voltageEntry = (JsonObject)((JsonObject)prose["values"]!)["V_oc_mv"]!;
        voltageEntry["tag"] = "assumption";
        voltageEntry["src"] = "different value provenance";
        Assert.Equal(baselineProfile.hash, Load(prose).hash);

        var changed = RefNode();
        SetScalar(changed, "V_oc_mv", 13001);
        Assert.NotEqual(baselineProfile.hash, Load(changed).hash);
    }

    [Fact]
    public void duplicate_object_keys_are_accepted_and_the_last_value_wins()
    {
        var source = Encoding.UTF8.GetString(Artifacts.ReadAllBytes("data/profiles/MV601-REF-A.json"));
        const string marker = "\"tick_us\": {";
        var duplicate = "\"tick_us\": { \"v\": 101, \"tag\": \"unverified\", \"src\": \"test-local duplicate\" },\n    " + marker;
        var raw = source.Replace(marker, duplicate, StringComparison.Ordinal);
        Assert.NotEqual(source, raw);

        using var document = JsonDocument.Parse(raw);
        var profile = Profile.LoadProfile(document.RootElement);
        Assert.Equal(100, profile.v.tick_us);
    }

    public static TheoryData<string, string> ProfileRejectionCases => new()
    {
        { "nominal-product-overflow", "V_pullin_mv * 1000000000 overflows signed 64-bit" },
        { "offset-product-overflow", "V_pullin_mv + dV_relay_mv[0]" },
        { "arc-product-overflow", "V_arc_clamp_mv * tick_us * 1000 overflows signed 64-bit" },
        { "nominal-positive-int32", "pullInUa must be a positive int32" },
        { "relay-positive-int32", "relayPullInUa[0] must be a positive int32" },
        { "arc-positive-int32", "arcStepUa must be a positive int32" },
        { "dial-product-overflow", "16 * run_mrpm * tick_us overflows signed 64-bit" },
        { "angular-accumulator-overflow", "2147483647 * 6 * tick_us + 999 overflows signed 64-bit" },
        { "zero-trip", "tripDelayTicks must be a positive int32" },
        { "dead-short-positive-int32", "deadShortUa must be a positive int32" },
        { "relay-cycle-positive-int32", "relayCycleTicks must be a positive int32" },
        { "button-cycle-positive-int32", "buttonCycleTicks must be a positive int32" },
        { "switch-cycle-positive-int32", "switchCycleTicks must be a positive int32" },
        { "dial-cycle-positive-int32", "dialCycleTicks must be a positive int32" },
        { "rule-15-latency", "the tick is no longer the fixpoint" },
    };

    [Fact]
    public void profile_rejection_gate_has_exactly_fifteen_cases() =>
        Assert.Equal(15, ProfileRejectionCases.Count);

    [Theory]
    [MemberData(nameof(ProfileRejectionCases))]
    public void profile_rejection_gate_reports_each_case(string caseId, string expectedText)
    {
        var node = RefNode();
        ApplyRejectionMutation(node, caseId);
        AssertProfileFailure(node, expectedText);
    }

    [Fact]
    public void rule_15_accepts_a_strictly_shorter_tick()
    {
        var clear = RefNode();
        SetScalar(clear, "relay_release_stroke_us", 2100);
        Assert.Equal(21, Load(clear).derived.relayReleaseTicks);
    }

    [Theory]
    [InlineData("9007199254740991.1", 9_007_199_254_740_991L)]
    [InlineData("9007199254740990.9", 9_007_199_254_740_991L)]
    [InlineData("-9007199254740991.1", -9_007_199_254_740_991L)]
    [InlineData("1.0", 1L)]
    [InlineData("1e3", 1000L)]
    public void integer_tokens_follow_json_parse_binary64_before_safe_integer_validation(
        string token,
        long expected)
    {
        var profile = LoadRawScalarToken("R_contact_uohm", 50000, token);
        Assert.Equal(expected, profile.v.R_contact_uohm);
    }

    [Theory]
    [InlineData("9007199254740991.5")]
    [InlineData("9007199254740992")]
    [InlineData("1.1")]
    public void integer_tokens_reject_binary64_values_that_are_not_safe_integers(string token)
    {
        var exception = Assert.ThrowsAny<Exception>(() => LoadRawScalarToken("R_contact_uohm", 50000, token));
        Assert.StartsWith("profile: ", exception.Message, StringComparison.Ordinal);
        Assert.Contains("R_contact_uohm must be a safe integer", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void profile_constraint_exports_reproduce_the_reference_arithmetic()
    {
        using var document = ReadJson("data/profiles/MV601-REF-A.json");
        var profile = Profile.LoadProfile(document.RootElement);
        Assert.Equal(27_000, Profile.sweepUdegPerTick(45_000, 100));
        Assert.Equal(8, Profile.bothOpenTicks(profile));
        Assert.Equal(44, Profile.releaseToBreakTicks(profile));

        var empty = new ConstraintInputs(null, null, null, null, null, null);
        var results = Profile.evalConstraints(profile, empty);
        Assert.Equal(new[] { ConstraintId.R1, ConstraintId.R2, ConstraintId.R3, ConstraintId.R4, ConstraintId.R5, ConstraintId.R6 },
            Array.ConvertAll(results, result => result.id));
        Assert.Equal("pass", results[0].status);
        Assert.Equal(44, results[0].actual);
        Assert.Equal(24, results[0].required);
        Assert.Equal(20, results[0].margin);
        for (var i = 1; i < results.Length; i++) Assert.Equal("unevaluated", results[i].status);
    }

    private static JsonDocument ReadJson(string relativePath) =>
        JsonDocument.Parse(Artifacts.ReadAllBytes(relativePath));

    private static JsonObject RefNode() =>
        (JsonObject)JsonNode.Parse(Artifacts.ReadAllBytes("data/profiles/MV601-REF-A.json"))!;

    private static Profile Load(JsonObject node)
    {
        using var document = JsonDocument.Parse(node.ToJsonString());
        return Profile.LoadProfile(document.RootElement);
    }

    private static Profile LoadRawScalarToken(string key, long originalValue, string replacementToken)
    {
        var source = Encoding.UTF8.GetString(Artifacts.ReadAllBytes("data/profiles/MV601-REF-A.json"));
        var marker = "\"" + key + "\": {\n      \"v\": " + originalValue.ToString(CultureInfo.InvariantCulture) + ",";
        var replacement = "\"" + key + "\": {\n      \"v\": " + replacementToken + ",";
        var raw = source.Replace(marker, replacement, StringComparison.Ordinal);
        Assert.NotEqual(source, raw);
        using var document = JsonDocument.Parse(raw);
        return Profile.LoadProfile(document.RootElement);
    }

    private static void ApplyRejectionMutation(JsonObject node, string caseId)
    {
        switch (caseId)
        {
            case "nominal-product-overflow":
                SetScalar(node, "V_pullin_mv", 9_223_372_037);
                break;
            case "offset-product-overflow":
                SetScalar(node, "V_pullin_mv", 9_223_372_036);
                SetScalar(node, "V_dropout_mv", 5_000_000_000);
                SetScalar(node, "R_coil_uohm", 5_000_000_000);
                SetArray(node, "dV_relay_mv", 1, 0, 0, 0, 0, 0);
                break;
            case "arc-product-overflow":
                SetScalar(node, "V_arc_clamp_mv", 92_233_720_368_548);
                break;
            case "nominal-positive-int32":
                SetScalar(node, "V_pullin_mv", 3);
                SetScalar(node, "V_dropout_mv", 1);
                SetScalar(node, "R_coil_uohm", 1);
                SetArray(node, "dV_relay_mv", 0, 0, 0, 0, 0, 0);
                break;
            case "relay-positive-int32":
                SetScalar(node, "V_pullin_mv", 2);
                SetScalar(node, "V_dropout_mv", 1);
                SetScalar(node, "R_coil_uohm", 1);
                SetArray(node, "dV_relay_mv", 1, 0, 0, 0, 0, 0);
                break;
            case "arc-positive-int32":
                SetScalar(node, "V_arc_clamp_mv", 2_147_484);
                SetScalar(node, "L_coil_uh", 100);
                break;
            case "dial-product-overflow":
                foreach (var key in new[]
                {
                    "tick_us", "trip_delay_us", "relay_operate_stroke_us", "relay_release_stroke_us",
                    "pushbutton_stroke_us", "slide_stroke_us", "settle_cap_us",
                }) SetScalar(node, key, int.MaxValue);
                SetScalar(node, "run_mrpm", int.MaxValue);
                break;
            case "angular-accumulator-overflow":
                foreach (var key in new[]
                {
                    "tick_us", "relay_operate_stroke_us", "relay_release_stroke_us",
                    "pushbutton_stroke_us", "slide_stroke_us",
                }) SetScalar(node, key, 715_827_883);
                SetScalar(node, "trip_delay_us", int.MaxValue);
                SetScalar(node, "settle_cap_us", int.MaxValue);
                SetScalar(node, "run_mrpm", 1);
                SetScalar(node, "V_arc_clamp_mv", 1);
                break;
            case "zero-trip":
                SetScalar(node, "tick_us", 3);
                SetScalar(node, "trip_delay_us", 1);
                break;
            case "dead-short-positive-int32":
                SetScalar(node, "V_oc_mv", int.MaxValue);
                SetScalar(node, "R_src_uohm", 1);
                break;
            case "relay-cycle-positive-int32":
                SetScalar(node, "tick_us", 1);
                SetScalar(node, "relay_operate_stroke_us", int.MaxValue);
                SetScalar(node, "relay_release_stroke_us", 1);
                break;
            case "button-cycle-positive-int32":
                SetScalar(node, "tick_us", 1);
                SetScalar(node, "pushbutton_stroke_us", int.MaxValue);
                break;
            case "switch-cycle-positive-int32":
                SetScalar(node, "tick_us", 1);
                SetScalar(node, "slide_stroke_us", int.MaxValue);
                break;
            case "dial-cycle-positive-int32":
                SetScalar(node, "tick_us", 1);
                SetScalar(node, "run_mrpm", 1);
                break;
            case "rule-15-latency":
                SetScalar(node, "relay_release_stroke_us", 2000);
                break;
            default:
                throw new ArgumentOutOfRangeException(nameof(caseId));
        }
    }

    private static void SetScalar(JsonObject root, string key, long value) =>
        ((JsonObject)((JsonObject)root["values"]!)[key]!)["v"] = value;

    private static void SetArray(JsonObject root, string key, params long[] values)
    {
        var array = new JsonArray();
        foreach (var value in values) array.Add(value);
        ((JsonObject)((JsonObject)root["values"]!)[key]!)["v"] = array;
    }

    private static void AssertProfileFailure(JsonObject node, string expectedText)
    {
        var exception = Assert.ThrowsAny<Exception>(() => Load(node));
        Assert.StartsWith("profile: ", exception.Message, StringComparison.Ordinal);
        Assert.Contains(expectedText, exception.Message, StringComparison.Ordinal);
    }

    private static int[] ReadIntArray(JsonElement element)
    {
        var result = new int[element.GetArrayLength()];
        var index = 0;
        foreach (var value in element.EnumerateArray()) result[index++] = value.GetInt32();
        return result;
    }

    private static readonly string RepositoryRoot = FindRepositoryRoot();
    private static readonly FileSystemSource Artifacts = new(RepositoryRoot);

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(Directory.GetCurrentDirectory()); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "package.json"))) return directory.FullName;
        throw new InvalidOperationException("repository root not found");
    }
}
