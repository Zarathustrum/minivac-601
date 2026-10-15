using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;
using System.Text.Json;

namespace Minivac.Core;

public readonly record struct Tag(string value);

public enum ScalarKey
{
    tick_us,
    gmin_ns,
    V_oc_mv,
    R_src_uohm,
    I_trip_ua,
    trip_delay_us,
    R_coil_uohm,
    L_coil_uh,
    V_arc_clamp_mv,
    V_pullin_mv,
    V_dropout_mv,
    relay_operate_stroke_us,
    relay_release_stroke_us,
    pushbutton_stroke_us,
    slide_stroke_us,
    relay_bounce_us,
    break_milli,
    make_milli,
    R_cold_uohm,
    R_hot_uohm,
    I_hot_ua,
    lamp_thermal_tau_us,
    lamp_on_milli,
    lamp_dim_milli,
    contact_arc_udeg,
    wiper_offset_udeg,
    run_mrpm,
    hand_slew_mrpm,
    coast_udeg_stop_shorted,
    coast_udeg_drive_removed,
    R1_uohm,
    R2_uohm,
    R_arm_uohm,
    settle_quiet_ticks,
    settle_cap_us,
    chatter_n,
    chatter_cycles,
    chatter_quiet_cycles,
    min_decision_ua,
    min_tick_gap,
    R_contact_uohm,
    R_wire_uohm,
    visual_decay_us,
}

public readonly struct PwlPoint
{
    private readonly long _currentUa;
    private readonly long _resistanceUohm;

    internal PwlPoint(long currentUa, long resistanceUohm)
    {
        _currentUa = currentUa;
        _resistanceUohm = resistanceUohm;
    }

    public long this[int index] => index switch
    {
        0 => _currentUa,
        1 => _resistanceUohm,
        _ => throw new ArgumentOutOfRangeException(nameof(index)),
    };
}

public sealed record Derived(
    int pullInUa,
    int dropOutUa,
    IReadOnlyList<int> relayPullInUa,
    IReadOnlyList<int> relayDropOutUa,
    long relayOperateTicks,
    long relayReleaseTicks,
    long pushbuttonTicks,
    long slideTicks,
    double kThermal,
    int arcStepUa,
    int tripDelayTicks,
    int deadShortUa,
    int rMotorParUohm,
    int vMotorRunMv,
    int relayCycleTicks,
    int buttonCycleTicks,
    int switchCycleTicks,
    int dialCycleTicks,
    int settleCapTicks);

public enum ConstraintId
{
    R1,
    R2,
    R3,
    R4,
    R5,
    R6,
}

public sealed record ConstraintResult(
    ConstraintId id,
    string status,
    long actual,
    long required,
    long margin,
    string unit,
    string why);

public sealed record ConstraintInputs(
    long? buttonHoldTicks,
    long? buttonUpTicks,
    long? shortedHoldOffTicks,
    ConstraintInputs.CarryChain? carryChain,
    long? ripplePeriodUs,
    ConstraintInputs.R6Input? r6)
{
    public sealed record CarryChain(long shortedReleases, long operates);
    public sealed record R6Input(bool miscountsWithLamp, bool countsWithoutLamp, long marginUa);
}

public sealed record Profile(
    string id,
    bool marginal,
    string provenance,
    string hash,
    Profile.Values v,
    IReadOnlyList<long> dVRelayMv,
    IReadOnlyList<PwlPoint> pwl,
    Derived derived)
{
    public const string SCHEMA = "minivac.profile/1";

    public static readonly IReadOnlyList<string> SCALAR_KEYS = Array.AsReadOnly(new[]
    {
        "tick_us", "gmin_ns", "V_oc_mv", "R_src_uohm", "I_trip_ua", "trip_delay_us",
        "R_coil_uohm", "L_coil_uh", "V_arc_clamp_mv", "V_pullin_mv", "V_dropout_mv",
        "relay_operate_stroke_us", "relay_release_stroke_us", "pushbutton_stroke_us",
        "slide_stroke_us", "relay_bounce_us", "break_milli", "make_milli", "R_cold_uohm",
        "R_hot_uohm", "I_hot_ua", "lamp_thermal_tau_us", "lamp_on_milli", "lamp_dim_milli",
        "contact_arc_udeg", "wiper_offset_udeg", "run_mrpm", "hand_slew_mrpm",
        "coast_udeg_stop_shorted", "coast_udeg_drive_removed", "R1_uohm", "R2_uohm",
        "R_arm_uohm", "settle_quiet_ticks", "settle_cap_us", "chatter_n", "chatter_cycles",
        "chatter_quiet_cycles", "min_decision_ua", "min_tick_gap", "R_contact_uohm",
        "R_wire_uohm", "visual_decay_us",
    });

    public static readonly IReadOnlyList<string> ARRAY_KEYS =
        Array.AsReadOnly(new[] { "dV_relay_mv", "lamp_pwl_uohm" });

    public static readonly IReadOnlyList<string> TOP_KEYS =
        Array.AsReadOnly(new[] { "schema", "id", "marginal", "provenance", "values" });

    private const int Relays = 6;
    private const long MvUohmToUa = 1_000_000_000;
    private const long PitchUdeg = 360_000_000 / 16;
    private const long TickLatencyFactor = 20;
    private const long R1MinRatio = 3;
    private const long MaxSafeInteger = 9_007_199_254_740_991;

    private static readonly IReadOnlyList<string> AllValueKeys = Array.AsReadOnly(new[]
    {
        "tick_us", "gmin_ns", "V_oc_mv", "R_src_uohm", "I_trip_ua", "trip_delay_us",
        "R_coil_uohm", "L_coil_uh", "V_arc_clamp_mv", "V_pullin_mv", "V_dropout_mv",
        "relay_operate_stroke_us", "relay_release_stroke_us", "pushbutton_stroke_us",
        "slide_stroke_us", "relay_bounce_us", "break_milli", "make_milli", "R_cold_uohm",
        "R_hot_uohm", "I_hot_ua", "lamp_thermal_tau_us", "lamp_on_milli", "lamp_dim_milli",
        "contact_arc_udeg", "wiper_offset_udeg", "run_mrpm", "hand_slew_mrpm",
        "coast_udeg_stop_shorted", "coast_udeg_drive_removed", "R1_uohm", "R2_uohm",
        "R_arm_uohm", "settle_quiet_ticks", "settle_cap_us", "chatter_n", "chatter_cycles",
        "chatter_quiet_cycles", "min_decision_ua", "min_tick_gap", "R_contact_uohm",
        "R_wire_uohm", "visual_decay_us", "dV_relay_mv", "lamp_pwl_uohm",
    });

    public sealed class Values
    {
        private readonly long[] _values;

        internal Values(long[] values) => _values = (long[])values.Clone();

        internal long At(int index) => _values[index];

        public long tick_us => _values[0];
        public long gmin_ns => _values[1];
        public long V_oc_mv => _values[2];
        public long R_src_uohm => _values[3];
        public long I_trip_ua => _values[4];
        public long trip_delay_us => _values[5];
        public long R_coil_uohm => _values[6];
        public long L_coil_uh => _values[7];
        public long V_arc_clamp_mv => _values[8];
        public long V_pullin_mv => _values[9];
        public long V_dropout_mv => _values[10];
        public long relay_operate_stroke_us => _values[11];
        public long relay_release_stroke_us => _values[12];
        public long pushbutton_stroke_us => _values[13];
        public long slide_stroke_us => _values[14];
        public long relay_bounce_us => _values[15];
        public long break_milli => _values[16];
        public long make_milli => _values[17];
        public long R_cold_uohm => _values[18];
        public long R_hot_uohm => _values[19];
        public long I_hot_ua => _values[20];
        public long lamp_thermal_tau_us => _values[21];
        public long lamp_on_milli => _values[22];
        public long lamp_dim_milli => _values[23];
        public long contact_arc_udeg => _values[24];
        public long wiper_offset_udeg => _values[25];
        public long run_mrpm => _values[26];
        public long hand_slew_mrpm => _values[27];
        public long coast_udeg_stop_shorted => _values[28];
        public long coast_udeg_drive_removed => _values[29];
        public long R1_uohm => _values[30];
        public long R2_uohm => _values[31];
        public long R_arm_uohm => _values[32];
        public long settle_quiet_ticks => _values[33];
        public long settle_cap_us => _values[34];
        public long chatter_n => _values[35];
        public long chatter_cycles => _values[36];
        public long chatter_quiet_cycles => _values[37];
        public long min_decision_ua => _values[38];
        public long min_tick_gap => _values[39];
        public long R_contact_uohm => _values[40];
        public long R_wire_uohm => _values[41];
        public long visual_decay_us => _values[42];
    }

    public static Profile LoadProfile(JsonElement raw)
    {
        RequireObject(raw, "a profile is a JSON object");
        RejectUnknown(raw, TOP_KEYS, "the profile document");

        if (!TryProperty(raw, "schema", out var schema) ||
            schema.ValueKind != JsonValueKind.String || schema.GetString() != SCHEMA)
            Fail("schema must be \"" + SCHEMA + "\", got " + JsonText(schema));

        if (!TryProperty(raw, "id", out var idElement) || idElement.ValueKind != JsonValueKind.String ||
            string.IsNullOrEmpty(idElement.GetString()))
            Fail("id must be a non-empty string");
        var id = idElement.GetString()!;

        if (!TryProperty(raw, "marginal", out var marginalElement) ||
            marginalElement.ValueKind is not JsonValueKind.True and not JsonValueKind.False)
            Fail("marginal must be a boolean (§11: the toggle is a profile swap)");
        var marginal = marginalElement.GetBoolean();

        if (!TryProperty(raw, "provenance", out var provenanceElement) ||
            provenanceElement.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(provenanceElement.GetString()))
            Fail("provenance must be a non-empty string (§10)");
        var provenance = provenanceElement.GetString()!;

        if (!TryProperty(raw, "values", out var valuesElement) || valuesElement.ValueKind != JsonValueKind.Object)
            Fail("values must be an object");
        RejectUnknown(valuesElement, AllValueKeys, "values");

        var scalarValues = new long[SCALAR_KEYS.Count];
        for (var i = 0; i < scalarValues.Length; i++)
            scalarValues[i] = Integer(Entry(valuesElement, SCALAR_KEYS[i]), SCALAR_KEYS[i]);
        var values = new Values(scalarValues);
        AssertW3Domains(values);

        var rawDv = Entry(valuesElement, "dV_relay_mv");
        if (rawDv.ValueKind != JsonValueKind.Array || rawDv.GetArrayLength() != Relays)
            Fail("dV_relay_mv must be 6 integers, one per relay (§4.3)");
        var dV = new long[Relays];
        var dVIndex = 0;
        foreach (var item in rawDv.EnumerateArray())
            dV[dVIndex] = Integer(item, "dV_relay_mv[" + F(dVIndex++) + "]");

        var pwl = ParsePwl(Entry(valuesElement, "lamp_pwl_uohm"));
        var derived = Derive(values, dV);
        AssertW3Products(values, derived);
        AssertLoadTime(values, derived);
        AssertPwlColdAnchor(pwl, values.R_cold_uohm);
        var hash = SemanticHash(values, dV, pwl);

        return new Profile(
            id,
            marginal,
            provenance,
            hash,
            values,
            Array.AsReadOnly((long[])dV.Clone()),
            Array.AsReadOnly((PwlPoint[])pwl.Clone()),
            derived);
    }

    public static long sweepUdegPerTick(long mrpm, long tickUs) =>
        Ints.idivRound(checked(checked(mrpm * 6) * tickUs), 1000);

    public static long bothOpenTicks(Profile p) =>
        Ints.idivRound(checked((p.v.make_milli - p.v.break_milli) * p.derived.relayReleaseTicks), 1000);

    public static long releaseToBreakTicks(Profile p) =>
        Ints.idivRound(checked((1000 - p.v.break_milli) * p.derived.relayReleaseTicks), 1000);

    public static ConstraintResult[] evalConstraints(Profile p, ConstraintInputs input) => new[]
    {
        EvalR1(p),
        EvalR2(p, input),
        EvalR3(p, input),
        EvalR4(p, input),
        EvalR5(p, input),
        EvalR6(p, input),
    };

    private static PwlPoint[] ParsePwl(JsonElement raw)
    {
        if (raw.ValueKind != JsonValueKind.Array)
            Fail("lamp_pwl_uohm must be an array of [uA, uohm] pairs");
        var count = raw.GetArrayLength();
        if (count != 9 && count != 33)
            Fail("lamp_pwl_uohm has N=" + F(count) + "; architecture §10.1 allows N in {9, 33}");

        var result = new PwlPoint[count];
        var index = 0;
        foreach (var element in raw.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() != 2)
                Fail("lamp_pwl_uohm[" + F(index) + "] must be a [uA, uohm] pair");
            var pair = element.EnumerateArray();
            pair.MoveNext();
            var current = Integer(pair.Current, "lamp_pwl_uohm[" + F(index) + "][0]");
            pair.MoveNext();
            var resistance = Integer(pair.Current, "lamp_pwl_uohm[" + F(index) + "][1]");
            if (current < 0 || resistance <= 0)
                Fail("lamp_pwl_uohm[" + F(index) + "] must be a non-negative current and a positive resistance");
            if (index > 0)
            {
                var previous = result[index - 1];
                if (current <= previous[0])
                    Fail("lamp_pwl_uohm is not monotone: current " + F(current) + " at " + F(index) +
                        " does not exceed " + F(previous[0]));
                if (resistance < previous[1])
                    Fail("lamp_pwl_uohm is not monotone: resistance " + F(resistance) + " at " + F(index) +
                        " is below " + F(previous[1]));
            }
            result[index++] = new PwlPoint(current, resistance);
        }
        return result;
    }

    private static void AssertW3Domains(Values v)
    {
        for (var i = 0; i < PositiveInt32KeyIndexes.Length; i++)
        {
            var index = PositiveInt32KeyIndexes[i];
            var value = v.At(index);
            if (value < 1 || value > int.MaxValue)
                Fail(SCALAR_KEYS[index] + " must be an int32 in 1..2147483647, got " + F(value));
        }
        for (var i = 0; i < CoastInt32KeyIndexes.Length; i++)
        {
            var index = CoastInt32KeyIndexes[i];
            var value = v.At(index);
            if (value < 0 || value > int.MaxValue)
                Fail(SCALAR_KEYS[index] + " must be an int32 in 0..2147483647, got " + F(value));
        }
        for (var i = 0; i < BlessingGateKeyIndexes.Length; i++)
        {
            var index = BlessingGateKeyIndexes[i];
            var value = v.At(index);
            if (value < 0 || value > int.MaxValue)
                Fail(SCALAR_KEYS[index] + " must be an int32 in 0..2147483647, got " + F(value));
        }
        if (v.gmin_ns < 0) Fail("gmin_ns must be non-negative");
        if (v.V_arc_clamp_mv <= 0) Fail("V_arc_clamp_mv must be positive");
        if (v.I_hot_ua <= 0) Fail("I_hot_ua must be positive");
        if (v.relay_bounce_us != 0)
            Fail("relay_bounce_us must be zero: bounce is disabled by architecture §4.4");
    }

    private static readonly int[] PositiveInt32KeyIndexes =
        { 0, 2, 3, 30, 31, 32, 4, 5, 26, 27, 33, 34, 35, 36, 37 };
    private static readonly int[] CoastInt32KeyIndexes = { 28, 29 };
    private static readonly int[] BlessingGateKeyIndexes = { 38, 39 };

    private static Derived Derive(Values v, long[] dV)
    {
        if (v.R_coil_uohm <= 0)
            Fail("R_coil_uohm must be positive: every §4.4 threshold divides by it");
        if (v.tick_us <= 0) Fail("tick_us must be positive");
        if (v.L_coil_uh <= 0) Fail("L_coil_uh must be positive: arcStepUa divides by it");

        var pullInUa64 = IdivRound64(
            CheckedProduct64("V_pullin_mv * 1000000000", v.V_pullin_mv, MvUohmToUa),
            v.R_coil_uohm,
            "pullInUa");
        var dropOutUa64 = IdivRound64(
            CheckedProduct64("V_dropout_mv * 1000000000", v.V_dropout_mv, MvUohmToUa),
            v.R_coil_uohm,
            "dropOutUa");
        AssertThresholdPair("nominal relay", dropOutUa64, pullInUa64);
        var pullInUa = PositiveInt32(pullInUa64, "pullInUa");
        var dropOutUa = PositiveInt32(dropOutUa64, "dropOutUa");

        var relayPullInUa = new int[Relays];
        var relayDropOutUa = new int[Relays];
        for (var n = 0; n < Relays; n++)
        {
            var pullInMv = CheckedSum64("V_pullin_mv + dV_relay_mv[" + F(n) + "]", v.V_pullin_mv, dV[n]);
            var dropOutMv = CheckedSum64("V_dropout_mv + dV_relay_mv[" + F(n) + "]", v.V_dropout_mv, dV[n]);
            var relayPullInUa64 = IdivRound64(
                CheckedProduct64("(V_pullin_mv + dV_relay_mv[" + F(n) + "]) * 1000000000", pullInMv, MvUohmToUa),
                v.R_coil_uohm,
                "relayPullInUa[" + F(n) + "]");
            var relayDropOutUa64 = IdivRound64(
                CheckedProduct64("(V_dropout_mv + dV_relay_mv[" + F(n) + "]) * 1000000000", dropOutMv, MvUohmToUa),
                v.R_coil_uohm,
                "relayDropOutUa[" + F(n) + "]");
            AssertThresholdPair("relay " + F(n + 1), relayDropOutUa64, relayPullInUa64);
            relayPullInUa[n] = PositiveInt32(relayPullInUa64, "relayPullInUa[" + F(n) + "]");
            relayDropOutUa[n] = PositiveInt32(relayDropOutUa64, "relayDropOutUa[" + F(n) + "]");
        }

        var relayOperateTicks = Ints.idivRound(v.relay_operate_stroke_us, v.tick_us);
        var relayReleaseTicks = Ints.idivRound(v.relay_release_stroke_us, v.tick_us);
        var pushbuttonTicks = Ints.idivRound(v.pushbutton_stroke_us, v.tick_us);
        var slideTicks = Ints.idivRound(v.slide_stroke_us, v.tick_us);

        var tripDelayTicks = PositiveInt32(IdivRound64(v.trip_delay_us, v.tick_us, "tripDelayTicks"), "tripDelayTicks");
        var deadShortUa = PositiveInt32(
            IdivRound64(CheckedProduct64("V_oc_mv * 1000000000", v.V_oc_mv, MvUohmToUa), v.R_src_uohm, "deadShortUa"),
            "deadShortUa");
        var rMotorParUohm = PositiveInt32(
            IdivRound64(
                CheckedProduct64("R2_uohm * R_arm_uohm", v.R2_uohm, v.R_arm_uohm),
                CheckedSum64("R2_uohm + R_arm_uohm", v.R2_uohm, v.R_arm_uohm),
                "rMotorParUohm"),
            "rMotorParUohm");
        var vMotorRunMv = PositiveInt32(
            IdivRound64(
                CheckedProduct64("V_oc_mv * rMotorParUohm", v.V_oc_mv, rMotorParUohm),
                CheckedSum64("R_src_uohm + R1_uohm + rMotorParUohm", v.R_src_uohm, v.R1_uohm, rMotorParUohm),
                "vMotorRunMv"),
            "vMotorRunMv");
        var relayCycleTicks = PositiveInt32(CheckedSum64("relayCycleTicks", relayOperateTicks, relayReleaseTicks), "relayCycleTicks");
        var buttonCycleTicks = PositiveInt32(CheckedProduct64("2 * pushbuttonTicks", 2, pushbuttonTicks), "buttonCycleTicks");
        var switchCycleTicks = PositiveInt32(CheckedProduct64("2 * slideTicks", 2, slideTicks), "switchCycleTicks");
        var dialDenominator = CheckedProduct64("16 * run_mrpm * tick_us", 16, v.run_mrpm, v.tick_us);
        var dialCycleTicks = PositiveInt32(IdivRound64(60_000_000_000, dialDenominator, "dialCycleTicks"), "dialCycleTicks");
        var settleCapTicks = PositiveInt32(IdivRound64(v.settle_cap_us, v.tick_us, "settleCapTicks"), "settleCapTicks");
        var arcStepUa = PositiveInt32(
            IdivRound64(
                CheckedProduct64("V_arc_clamp_mv * tick_us * 1000", v.V_arc_clamp_mv, v.tick_us, 1000),
                v.L_coil_uh,
                "arcStepUa"),
            "arcStepUa");

        return new Derived(
            pullInUa,
            dropOutUa,
            Array.AsReadOnly((int[])relayPullInUa.Clone()),
            Array.AsReadOnly((int[])relayDropOutUa.Clone()),
            relayOperateTicks,
            relayReleaseTicks,
            pushbuttonTicks,
            slideTicks,
            v.tick_us / (double)checked(v.lamp_thermal_tau_us + v.tick_us),
            arcStepUa,
            tripDelayTicks,
            deadShortUa,
            rMotorParUohm,
            vMotorRunMv,
            relayCycleTicks,
            buttonCycleTicks,
            switchCycleTicks,
            dialCycleTicks,
            settleCapTicks);
    }

    private static void AssertW3Products(Values v, Derived d)
    {
        var angularProduct = CheckedProduct64("2147483647 * 6 * tick_us", int.MaxValue, 6, v.tick_us);
        try
        {
            _ = checked(angularProduct + 999);
        }
        catch (OverflowException)
        {
            Fail("2147483647 * 6 * tick_us + 999 overflows signed 64-bit");
        }
        if (v.chatter_n == int.MaxValue) Fail("chatter_n + 1 must fit int32");
        CheckedWindowProduct(v.chatter_cycles, d.relayCycleTicks, "chatter_cycles * relayCycleTicks");
        CheckedWindowProduct(v.chatter_quiet_cycles, d.relayCycleTicks, "chatter_quiet_cycles * relayCycleTicks");
        CheckedWindowProduct(v.chatter_cycles, d.buttonCycleTicks, "chatter_cycles * buttonCycleTicks");
        CheckedWindowProduct(v.chatter_quiet_cycles, d.buttonCycleTicks, "chatter_quiet_cycles * buttonCycleTicks");
        CheckedWindowProduct(v.chatter_cycles, d.switchCycleTicks, "chatter_cycles * switchCycleTicks");
        CheckedWindowProduct(v.chatter_quiet_cycles, d.switchCycleTicks, "chatter_quiet_cycles * switchCycleTicks");
        CheckedWindowProduct(v.chatter_cycles, d.dialCycleTicks, "chatter_cycles * dialCycleTicks");
        CheckedWindowProduct(v.chatter_quiet_cycles, d.dialCycleTicks, "chatter_quiet_cycles * dialCycleTicks");
    }

    private static void AssertLoadTime(Values v, Derived d)
    {
        if (v.R_cold_uohm <= 0) Fail("R_cold_uohm must be positive");
        if (v.R_hot_uohm <= v.R_cold_uohm) Fail("R_hot_uohm must be greater than R_cold_uohm");
        var coldOhm = v.R_cold_uohm * 1e-6;
        var hotOhm = v.R_hot_uohm * 1e-6;
        var spanOhm = hotOhm - coldOhm;
        if (!double.IsFinite(spanOhm) || spanOhm <= 0)
            Fail("lamp-resistance span must be finite and positive after µΩ-to-Ω conversion");

        var minLatency = MinDeviceLatencyUs(v);
        var scaledTick = CheckedProduct64("tick_us * 20", v.tick_us, TickLatencyFactor);
        if (scaledTick >= minLatency)
            Fail("the tick is no longer the fixpoint: tick_us * 20 = " + F(scaledTick) +
                " µs is not below the shortest device latency " + F(minLatency) + " µs");

        if (v.contact_arc_udeg <= 0 || v.contact_arc_udeg >= PitchUdeg)
            Fail("contact_arc_udeg must lie strictly inside the 22500000 µdeg pad pitch (O-R1: 0 < gap < 22.5°)");
        var deadGapUdeg = PitchUdeg - v.contact_arc_udeg;
        var fastest = v.run_mrpm > v.hand_slew_mrpm ? v.run_mrpm : v.hand_slew_mrpm;
        long perTick;
        try
        {
            perTick = sweepUdegPerTick(fastest, v.tick_us);
        }
        catch (OverflowException)
        {
            Fail("mrpm * 6 * tick_us overflows signed 64-bit");
            return;
        }
        if (perTick >= deadGapUdeg)
            Fail("a contact can be skipped: " + F(perTick) + " µdeg per tick at " + F(fastest) +
                " mrpm vs a " + F(deadGapUdeg) + " µdeg dead gap");

        AssertTickAgreement("relay_operate_stroke_us", v.relay_operate_stroke_us, d.relayOperateTicks, v.tick_us);
        AssertTickAgreement("relay_release_stroke_us", v.relay_release_stroke_us, d.relayReleaseTicks, v.tick_us);
        AssertTickAgreement("pushbutton_stroke_us", v.pushbutton_stroke_us, d.pushbuttonTicks, v.tick_us);
        AssertTickAgreement("slide_stroke_us", v.slide_stroke_us, d.slideTicks, v.tick_us);

        if (v.break_milli < 0 || v.make_milli > 1000 || v.break_milli >= v.make_milli)
            Fail("break_milli " + F(v.break_milli) + " and make_milli " + F(v.make_milli) +
                " must satisfy 0 <= break < make <= 1000 (§4.3)");
        if (v.lamp_dim_milli < 0 || v.lamp_dim_milli >= v.lamp_on_milli || v.lamp_on_milli > 1000)
            Fail("lamp thresholds " + F(v.lamp_dim_milli) + " and " + F(v.lamp_on_milli) +
                " must satisfy 0 <= lamp_dim_milli < lamp_on_milli <= 1000 (§9.2)");
    }

    private static string SemanticHash(Values v, long[] dV, PwlPoint[] pwl)
    {
        var payload = new StringBuilder("minivac.profile-hash/1\n");
        for (var i = 0; i < SCALAR_KEYS.Count; i++)
            payload.Append(SCALAR_KEYS[i]).Append('=').Append(F(v.At(i))).Append('\n');
        payload.Append("dV_relay_mv=");
        for (var i = 0; i < dV.Length; i++)
        {
            if (i != 0) payload.Append(',');
            payload.Append(F(dV[i]));
        }
        payload.Append('\n');
        for (var i = 0; i < pwl.Length; i++)
            payload.Append("lamp_pwl_uohm=").Append(F(pwl[i][0])).Append(':').Append(F(pwl[i][1])).Append('\n');

        for (var i = 0; i < payload.Length; i++)
            if (payload[i] > 0x7f) throw new InvalidOperationException("profile hash payload is not ASCII");
        return Ints.fnv1a64(Encoding.ASCII.GetBytes(payload.ToString(0, payload.Length)));
    }

    private static ConstraintResult EvalR1(Profile p)
    {
        var bothOpen = bothOpenTicks(p);
        var toBreak = releaseToBreakTicks(p);
        var required = checked(R1MinRatio * bothOpen);
        return Result(ConstraintId.R1, toBreak, required, toBreak >= required, "ticks",
            "both-open " + F(bothOpen) + " ticks vs the fed relay reaching break at " + F(toBreak) +
            " ticks; components.md §9.3 R1 wants 3x");
    }

    private static ConstraintResult EvalR2(Profile p, ConstraintInputs input)
    {
        if (input.buttonHoldTicks is null || input.shortedHoldOffTicks is null)
            return Unevaluated(ConstraintId.R2,
                "needs buttonHoldTicks (a script property) and shortedHoldOffTicks (solver-measured, §4.2)");
        var shorted = checked(input.shortedHoldOffTicks.Value + p.derived.relayReleaseTicks);
        var required = p.derived.relayOperateTicks > shorted ? p.derived.relayOperateTicks : shorted;
        return Result(ConstraintId.R2, input.buttonHoldTicks.Value, required, input.buttonHoldTicks.Value > required,
            "ticks", "hold " + F(input.buttonHoldTicks.Value) + " vs max(operate " +
            F(p.derived.relayOperateTicks) + ", shorted release " + F(shorted) + ")");
    }

    private static ConstraintResult EvalR3(Profile p, ConstraintInputs input)
    {
        if (input.buttonUpTicks is null)
            return Unevaluated(ConstraintId.R3, "needs buttonUpTicks (a script property)");
        var required = p.derived.relayOperateTicks;
        return Result(ConstraintId.R3, input.buttonUpTicks.Value, required, input.buttonUpTicks.Value > required,
            "ticks", "button-up " + F(input.buttonUpTicks.Value) + " vs slave operate " + F(required));
    }

    private static ConstraintResult EvalR4(Profile p, ConstraintInputs input)
    {
        if (input.buttonHoldTicks is null || input.shortedHoldOffTicks is null || input.carryChain is null)
            return Unevaluated(ConstraintId.R4,
                "needs buttonHoldTicks, shortedHoldOffTicks and the carry chain composition");
        var shorted = checked(input.shortedHoldOffTicks.Value + p.derived.relayReleaseTicks);
        var required = checked(input.carryChain.shortedReleases * shorted +
            input.carryChain.operates * p.derived.relayOperateTicks);
        return Result(ConstraintId.R4, input.buttonHoldTicks.Value, required, input.buttonHoldTicks.Value >= required,
            "ticks", "hold " + F(input.buttonHoldTicks.Value) + " vs " + F(input.carryChain.shortedReleases) +
            " shorted releases of " + F(shorted) + " + " + F(input.carryChain.operates) +
            " operates of " + F(p.derived.relayOperateTicks));
    }

    private static ConstraintResult EvalR5(Profile p, ConstraintInputs input)
    {
        if (input.ripplePeriodUs is null)
            return Unevaluated(ConstraintId.R5,
                "ripple is off (components.md §9.3 ships supply_ripple default OFF; §10.1 has no ripple key)");
        var required = Ints.idivRound(input.ripplePeriodUs.Value, p.v.tick_us);
        var actual = p.derived.relayOperateTicks < p.derived.relayReleaseTicks
            ? p.derived.relayOperateTicks : p.derived.relayReleaseTicks;
        return Result(ConstraintId.R5, actual, required, actual > required, "ticks",
            "min(operate " + F(p.derived.relayOperateTicks) + ", release " +
            F(p.derived.relayReleaseTicks) + ") vs a " + F(input.ripplePeriodUs.Value) +
            " µs ripple period = " + F(required) + " ticks");
    }

    private static ConstraintResult EvalR6(Profile p, ConstraintInputs input)
    {
        var numbers = "evaluated on pullInUa=" + F(p.derived.pullInUa) + ", relayPullInUa=[";
        for (var i = 0; i < p.derived.relayPullInUa.Count; i++)
        {
            if (i != 0) numbers += ",";
            numbers += F(p.derived.relayPullInUa[i]);
        }
        numbers += "], operate=" + F(p.derived.relayOperateTicks) + " ticks, arcStep=" +
            F(p.derived.arcStepUa) + " µA/tick";
        if (input.r6 is null) return Unevaluated(ConstraintId.R6, "needs the solver: " + numbers);
        var pass = input.r6.miscountsWithLamp && input.r6.countsWithoutLamp;
        return Result(ConstraintId.R6, input.r6.marginUa, 0, pass, "ua",
            "lamp in series miscounts=" + (input.r6.miscountsWithLamp ? "true" : "false") +
            ", lamp bypassed counts=" + (input.r6.countsWithoutLamp ? "true" : "false") + "; " + numbers);
    }

    private static ConstraintResult Result(
        ConstraintId id,
        long actual,
        long required,
        bool pass,
        string unit,
        string why) =>
        new(id, pass ? "pass" : "fail", actual, required, actual - required, unit, why);

    private static ConstraintResult Unevaluated(ConstraintId id, string why) =>
        new(id, "unevaluated", 0, 0, 0, "none", why);

    private static long MinDeviceLatencyUs(Values v)
    {
        var result = v.relay_operate_stroke_us;
        if (v.relay_release_stroke_us < result) result = v.relay_release_stroke_us;
        if (v.pushbutton_stroke_us < result) result = v.pushbutton_stroke_us;
        if (v.slide_stroke_us < result) result = v.slide_stroke_us;
        if (v.lamp_thermal_tau_us < result) result = v.lamp_thermal_tau_us;
        return result;
    }

    private static void AssertPwlColdAnchor(PwlPoint[] pwl, long coldResistance)
    {
        if (pwl[0][0] != 0)
            Fail("lamp_pwl_uohm[0] current must be 0, got " + F(pwl[0][0]));
        if (pwl[0][1] != coldResistance)
            Fail("lamp_pwl_uohm[0] resistance must equal R_cold_uohm " + F(coldResistance) +
                ", got " + F(pwl[0][1]));
    }

    private static void AssertTickAgreement(string key, long microseconds, long ticks, long tickUs)
    {
        var error = Ints.iabs(checked(checked(ticks * tickUs) - microseconds));
        if (error > tickUs)
            Fail(key + " quantizes to " + F(ticks) + " ticks = " + F(checked(ticks * tickUs)) +
                " µs, which is " + F(error) + " µs from " + F(microseconds) +
                " µs (§6: within one tick)");
    }

    private static void CheckedWindowProduct(long multiplier, int cycleTicks, string where) =>
        PositiveInt32(CheckedProduct64(where, multiplier, cycleTicks), where);

    private static long CheckedSum64(string where, params long[] terms)
    {
        var sum = 0L;
        for (var i = 0; i < terms.Length; i++)
        {
            try { sum = checked(sum + terms[i]); }
            catch (OverflowException) { Fail(where + " overflows signed 64-bit"); }
        }
        return sum;
    }

    private static long CheckedProduct64(string where, params long[] factors)
    {
        var product = 1L;
        for (var i = 0; i < factors.Length; i++)
        {
            try { product = checked(product * factors[i]); }
            catch (OverflowException) { Fail(where + " overflows signed 64-bit"); }
        }
        return product;
    }

    private static long IdivRound64(long a, long b, string where)
    {
        if (b == 0) Fail(where + " denominator must be positive");
        long quotient;
        long remainder;
        try
        {
            quotient = checked(a / b);
            remainder = checked(a % b);
        }
        catch (OverflowException)
        {
            Fail(where + " operands must fit signed 64-bit");
            return 0;
        }
        var absR = Abs64(remainder);
        var absB = Abs64(b);
        if (absR >= (absB + 1UL) / 2UL)
            return checked(quotient + ((a < 0) != (b < 0) ? -1 : 1));
        return quotient;
    }

    private static ulong Abs64(long value) => value == long.MinValue
        ? 9_223_372_036_854_775_808UL
        : (ulong)Math.Abs(value);

    private static int PositiveInt32(long value, string where)
    {
        if (value < 1 || value > int.MaxValue)
            Fail(where + " must be a positive int32, got " + F(value));
        return (int)value;
    }

    private static void AssertThresholdPair(string where, long dropOutUa, long pullInUa)
    {
        if (dropOutUa <= 0 || dropOutUa >= pullInUa)
            Fail(where + " thresholds must satisfy 0 < dropOutUa < pullInUa; got dropOutUa " +
                F(dropOutUa) + " and pullInUa " + F(pullInUa));
    }

    private static JsonElement Entry(JsonElement values, string key)
    {
        if (!TryProperty(values, key, out var entry)) Fail("missing required key \"" + key + "\"");
        if (entry.ValueKind != JsonValueKind.Object) Fail(key + " must be an object { v, tag, src }");
        RejectUnknown(entry, EntryKeys, key);
        if (!TryProperty(entry, "tag", out var tag) || tag.ValueKind != JsonValueKind.String ||
            tag.GetString() is not ("verified-reading" or "unverified" or "assumption"))
            Fail(key + ".tag must be verified-reading | unverified | assumption, got " + JsonText(tag));
        if (!TryProperty(entry, "src", out var source) || source.ValueKind != JsonValueKind.String ||
            string.IsNullOrEmpty(source.GetString()))
            Fail(key + ".src must be a non-empty citation string");
        if (!TryProperty(entry, "v", out var value)) Fail(key + ".v is missing");
        return value;
    }

    private static readonly IReadOnlyList<string> EntryKeys =
        Array.AsReadOnly(new[] { "v", "tag", "src" });

    private static long Integer(JsonElement element, string where)
    {
        if (element.ValueKind != JsonValueKind.Number)
            Fail(where + " must be a safe integer, got " + element.GetRawText());
        double value;
        try
        {
            value = element.GetDouble();
        }
        catch (FormatException)
        {
            Fail(where + " must be a safe integer, got " + element.GetRawText());
            return 0;
        }
        if (!double.IsFinite(value) || value != Math.Truncate(value) ||
            value < -MaxSafeInteger || value > MaxSafeInteger)
            Fail(where + " must be a safe integer, got " + element.GetRawText());
        return Convert.ToInt64(value);
    }

    private static void RequireObject(JsonElement element, string message)
    {
        if (element.ValueKind != JsonValueKind.Object) Fail(message);
    }

    private static void RejectUnknown(JsonElement element, IReadOnlyList<string> allowed, string where)
    {
        foreach (var property in element.EnumerateObject())
        {
            var accepted = false;
            for (var i = 0; i < allowed.Count; i++)
                if (property.Name == allowed[i]) accepted = true;
            if (!accepted) Fail("unknown key \"" + property.Name + "\" in " + where);
        }
    }

    private static bool TryProperty(JsonElement element, string name, out JsonElement value)
    {
        value = default;
        return element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out value);
    }

    private static string JsonText(JsonElement element) =>
        element.ValueKind == JsonValueKind.Undefined ? "undefined" : element.GetRawText();

    private static string F(long value) => value.ToString(CultureInfo.InvariantCulture);

    private static void Fail(string message) => throw new ProfileException("profile: " + message);
}

public sealed class ProfileException(string message) : Exception(message);
