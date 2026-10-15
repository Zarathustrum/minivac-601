using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using System.Text.Json;
using Minivac.Conformance;
using Xunit;

namespace Minivac.Core.Tests;

public sealed class RotaryPortTests
{
    private const long MAX_SAFE_INTEGER = 9_007_199_254_740_991;
    private static readonly string RepositoryRoot = FindRepositoryRoot();
    private static readonly FileSystemSource Artifacts = new(RepositoryRoot);
    private static readonly Profile ReferenceProfile = LoadReferenceProfile();

    [Fact]
    public void Rotary_tick_path_has_no_heap_backed_integer_or_transient_scratch_construction()
    {
        var source = File.ReadAllText(Path.Combine(RepositoryRoot, "dotnet", "Minivac.Core", "Rotary.cs"));
        var tickPath = source[source.IndexOf("public static int motorRateMrpm", StringComparison.Ordinal)..];
        Assert.DoesNotContain("BigInteger", source, StringComparison.Ordinal);
        Assert.DoesNotContain("new ", tickPath, StringComparison.Ordinal);
        Assert.DoesNotContain("=>", tickPath, StringComparison.Ordinal);
    }

    [Fact]
    public void Contact_uses_the_circular_pad_zero_difference_on_both_sides_of_zero()
    {
        Assert.Equal(0, Rotary.contactAt(355_000_000, ReferenceProfile));
        Assert.Equal(0, Rotary.contactAt(359_999_000, ReferenceProfile));
        Assert.Equal(0, Rotary.contactAt(1_000, ReferenceProfile));
    }

    [Fact]
    public void Contact_endpoints_are_inclusive_and_the_dead_gap_is_open()
    {
        Assert.Equal(0, Rotary.contactAt(8_437_500, ReferenceProfile));
        Assert.Null(Rotary.contactAt(8_437_501, ReferenceProfile));
        Assert.Null(Rotary.contactAt(14_062_499, ReferenceProfile));
        Assert.Equal(1, Rotary.contactAt(14_062_500, ReferenceProfile));
    }

    [Fact]
    public void Contact_pitch_tie_and_adjacent_microdegrees_are_open()
    {
        Assert.Null(Rotary.contactAt(11_249_999, ReferenceProfile));
        Assert.Null(Rotary.contactAt(11_250_000, ReferenceProfile));
        Assert.Null(Rotary.contactAt(11_250_001, ReferenceProfile));
    }

    [Fact]
    public void Contact_wraps_the_wiper_offset_without_shifting_pad_numbers()
    {
        var shifted = ProfileWith((ScalarKey.wiper_offset_udeg, 5_000_000));
        Assert.Equal(0, Rotary.contactAt(0, shifted));
        Assert.Equal(0, Rotary.contactAt(5_000_000, shifted));
        Assert.Equal(1, Rotary.contactAt(27_500_000, shifted));
    }

    [Fact]
    public void Contact_normalizes_a_safe_integer_offset_before_endpoint_subtraction()
    {
        var extreme = ProfileWith((ScalarKey.wiper_offset_udeg, -MAX_SAFE_INTEGER));
        var normalized = ProfileWith((ScalarKey.wiper_offset_udeg, 25_259_009));
        var probes = new long[] { 16_821_508, 16_821_509, 33_696_509, 33_696_510 };
        int?[] expected = [null, 0, 0, null];
        for (var i = 0; i < probes.Length; i++)
        {
            Assert.Equal(Rotary.contactAt(probes[i], normalized), Rotary.contactAt(probes[i], extreme));
            Assert.Equal(expected[i], Rotary.contactAt(probes[i], normalized));
        }
    }

    [Fact]
    public void Rotary_starts_power_off_at_dial_zero_without_controller_history()
    {
        var state = Rotary.createRotaryState(ReferenceProfile);
        Assert.Equal(0, state.udeg);
        Assert.Equal(0, state.contact);
        Assert.False(state.held);
        Assert.Equal(0, state.targetUdeg);
        Assert.Equal(0, state.mrpm);
        Assert.Equal(0, state.remainder);
        Assert.Equal(0, state.lastMotorMrpm);
        Assert.Equal(0, state.coastDeferTicks);
    }

    [Fact]
    public void Hand_control_chooses_positive_at_180_degrees_and_emits_every_edge_in_order()
    {
        var state = Rotary.createRotaryState(ReferenceProfile);
        var output = new EdgeCollector();
        Rotary.grabRotary(state, 180_000_000);
        for (var tick = 0; tick < 10_000; tick++)
            Rotary.stepRotary(state, null, false, false, false, ReferenceProfile, new PortFlags(), output.Emit);

        var expected = new List<Edge> { new(RotaryEdgeKind.@break, 0) };
        for (var pos = 1; pos <= 7; pos++)
        {
            expected.Add(new Edge(RotaryEdgeKind.make, pos));
            expected.Add(new Edge(RotaryEdgeKind.@break, pos));
        }
        expected.Add(new Edge(RotaryEdgeKind.make, 8));
        Assert.Equal(expected, output.Edges);
        Assert.Equal("break", output.Edges[0].Kind.ToString());
        Assert.Equal("make", output.Edges[1].Kind.ToString());
        Assert.Equal(180_000_000, state.udeg);
        Assert.Equal(8, state.contact);
        Assert.True(state.held);
        Assert.Equal(180_000_000, state.targetUdeg);
        Assert.Equal(0, state.mrpm);
        Assert.Equal(0, state.remainder);
    }

    [Fact]
    public void Hand_control_takes_the_short_negative_path_wraps_and_clamps_to_target()
    {
        var state = Rotary.createRotaryState(ReferenceProfile);
        var output = new EdgeCollector();
        Rotary.grabRotary(state, 359_999_999);
        Rotary.stepRotary(state, null, false, false, false, ReferenceProfile, new PortFlags(), output.Emit);
        Assert.Equal(359_999_999, state.udeg);
        Assert.Equal(0, state.contact);
        Assert.Equal(0, state.mrpm);
        Assert.Equal(0, state.remainder);
        Assert.Empty(output.Edges);
    }

    [Fact]
    public void Hand_control_retains_signed_sub_microdegree_remainder_and_new_grab_resets_it()
    {
        var slow = ProfileWith((ScalarKey.tick_us, 1), (ScalarKey.hand_slew_mrpm, 1));
        var state = Rotary.createRotaryState(slow);
        Rotary.grabRotary(state, 10);
        for (var tick = 0; tick < 167; tick++)
            Rotary.stepRotary(state, 0, false, false, false, slow, new PortFlags(), IgnoreEdge);
        Assert.Equal(1, state.udeg);
        Assert.Equal(2, state.remainder);

        Rotary.grabRotary(state, 20);
        Assert.Equal(0, state.remainder);
        Assert.Equal(0, state.lastMotorMrpm);
    }

    [Fact]
    public void Repeated_release_while_unheld_preserves_motor_history()
    {
        var residual = ProfileWith((ScalarKey.run_mrpm, 45_001), (ScalarKey.tick_us, 1));
        var state = Rotary.createRotaryState(residual);
        Rotary.stepRotary(state, -residual.derived.vMotorRunMv, true, false, false, residual, new PortFlags(), IgnoreEdge);
        Assert.Equal(45_001, state.mrpm);
        Assert.Equal(6, state.remainder);
        Assert.Equal(45_001, state.lastMotorMrpm);

        Rotary.releaseRotary(state);
        Assert.False(state.held);
        Assert.Equal(45_001, state.mrpm);
        Assert.Equal(6, state.remainder);
        Assert.Equal(45_001, state.lastMotorMrpm);
    }

    [Fact]
    public void Hand_motion_continues_with_source_off_then_motor_resumes_after_release()
    {
        var state = Rotary.createRotaryState(ReferenceProfile);
        Rotary.grabRotary(state, 1_000_000);
        Rotary.stepRotary(state, 0, false, false, false, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(18_000, state.udeg);
        Assert.Equal(30_000, state.mrpm);

        state.remainder = 777;
        Rotary.releaseRotary(state);
        Assert.Equal(0, state.mrpm);
        Assert.Equal(0, state.remainder);
        Rotary.stepRotary(
            state, -ReferenceProfile.derived.vMotorRunMv, true, false, false, ReferenceProfile,
            new PortFlags(), IgnoreEdge);
        Assert.Equal(45_000, state.udeg);
        Assert.Equal(45_000, state.mrpm);
    }

    [Fact]
    public void Motor_rate_maps_signed_run_voltage_and_null_to_exact_rates()
    {
        var flags = new PortFlags();
        Assert.Equal(ReferenceProfile.v.run_mrpm,
            Rotary.motorRateMrpm(-ReferenceProfile.derived.vMotorRunMv, ReferenceProfile, flags));
        Assert.Equal(-ReferenceProfile.v.run_mrpm,
            Rotary.motorRateMrpm(ReferenceProfile.derived.vMotorRunMv, ReferenceProfile, flags));
        Assert.Equal(0, Rotary.motorRateMrpm(null, ReferenceProfile, flags));
        Assert.False(flags.nonPortable);
    }

    [Fact]
    public void Motor_rate_rounds_half_away_from_zero_before_clamping()
    {
        var half = ReferenceProfile with
        {
            derived = ReferenceProfile.derived with { vMotorRunMv = 90_000 },
        };
        Assert.Equal(1, Rotary.motorRateMrpm(-1, half, new PortFlags()));
        Assert.Equal(-1, Rotary.motorRateMrpm(1, half, new PortFlags()));
    }

    [Fact]
    public void Motor_rate_saturates_both_int32_rails_and_marks_nonportable()
    {
        var high = new PortFlags();
        Assert.Equal(int.MaxValue, Rotary.motorRateMrpm(int.MinValue, ReferenceProfile, high));
        Assert.True(high.nonPortable);

        var low = new PortFlags();
        Assert.Equal(int.MinValue, Rotary.motorRateMrpm(int.MaxValue, ReferenceProfile, low));
        Assert.True(low.nonPortable);
    }

    [Fact]
    public void Motor_rate_returns_exactly_int32_min_without_saturating_when_the_product_lands_on_the_rail()
    {
        var profile = ProfileWithDerived(
            ReferenceProfile.derived with { vMotorRunMv = 1 },
            (ScalarKey.run_mrpm, 2));
        var flags = new PortFlags();
        Assert.Equal(int.MinValue, Rotary.motorRateMrpm(1_073_741_824, profile, flags));
        Assert.False(flags.nonPortable);
    }

    [Fact]
    public void Motor_rate_matches_exact_integer_reference_across_product_and_divisor_extremes()
    {
        int[] runs = [1, 45_000, 65_537, int.MaxValue];
        int[] voltages = [int.MinValue, -int.MaxValue, -1, 1, 65_537, int.MaxValue];
        int[] divisors = [1, 2, 4_065, 65_537, int.MaxValue];

        foreach (var run in runs)
        foreach (var voltage in voltages)
        foreach (var divisor in divisors)
        {
            var profile = ProfileWithDerived(
                ReferenceProfile.derived with { vMotorRunMv = divisor },
                (ScalarKey.run_mrpm, run));
            var flags = new PortFlags();
            var exact = ReferenceMotorRate(run, voltage, divisor);
            var expected = exact > int.MaxValue ? int.MaxValue : exact < int.MinValue ? int.MinValue : (int)exact;
            Assert.Equal(expected, Rotary.motorRateMrpm(voltage, profile, flags));
            Assert.Equal(exact > int.MaxValue || exact < int.MinValue, flags.nonPortable);
        }
    }

    [Fact]
    public void Motor_integration_matches_signed_accumulation_saturation_and_wrap()
    {
        var cases = new[]
        {
            (Run: 1, Voltage: -1, TickUs: 1L),
            (Run: 65_537, Voltage: -1, TickUs: 65_539L),
            (Run: int.MaxValue, Voltage: -1, TickUs: 100L),
            (Run: int.MaxValue, Voltage: -1, TickUs: 1_000L),
            (Run: int.MaxValue, Voltage: 1, TickUs: 100L),
            (Run: int.MaxValue, Voltage: 2, TickUs: 100L),
        };

        foreach (var item in cases)
        {
            var profile = ProfileWithDerived(
                ReferenceProfile.derived with { vMotorRunMv = 1 },
                (ScalarKey.run_mrpm, item.Run), (ScalarKey.tick_us, item.TickUs));
            var state = Rotary.createRotaryState(profile);
            var flags = new PortFlags();
            var exactRate = ReferenceMotorRate(item.Run, item.Voltage, 1);
            var rate = exactRate > int.MaxValue ? int.MaxValue : exactRate < int.MinValue ? int.MinValue : (int)exactRate;
            var numerator = (long)rate * 6 * item.TickUs;
            var displacement = numerator / 1000;
            var remainder = numerator % 1000;

            Rotary.stepRotary(state, item.Voltage, true, false, false, profile, flags, IgnoreEdge);
            Assert.Equal(WrapReference(0, displacement), state.udeg);
            Assert.Equal(remainder, state.remainder);
            Assert.Equal(rate, state.mrpm);
            Assert.Equal(exactRate > int.MaxValue || exactRate < int.MinValue, flags.nonPortable);
        }
    }

    [Fact]
    public void Hand_integration_handles_the_maximum_validated_signed_64_bit_product()
    {
        var maxTickUs = (long.MaxValue - 999) / ((long)int.MaxValue * 6);
        var product = (UInt128)int.MaxValue * 6 * (ulong)maxTickUs + 999;
        Assert.True(product <= (UInt128)long.MaxValue);
        Assert.True(product > (UInt128)MAX_SAFE_INTEGER);

        var profile = ProfileWith(
            (ScalarKey.hand_slew_mrpm, int.MaxValue),
            (ScalarKey.tick_us, maxTickUs));
        var state = Rotary.createRotaryState(profile);
        var output = new EdgeCollector();
        Rotary.grabRotary(state, 180_000_000);
        Rotary.stepRotary(state, 0, false, false, false, profile, new PortFlags(), output.Emit);
        Assert.Equal(180_000_000, state.udeg);
        Assert.Equal(8, state.contact);
        Assert.Equal(0, state.mrpm);
        Assert.Equal(0, state.remainder);
        Assert.Equal(16, output.Edges.Count);
    }

    [Fact]
    public void Motor_reverses_immediately_without_stale_remainder()
    {
        var state = Rotary.createRotaryState(ReferenceProfile);
        var flags = new PortFlags();
        Rotary.stepRotary(
            state, -ReferenceProfile.derived.vMotorRunMv, true, false, false, ReferenceProfile, flags, IgnoreEdge);
        Assert.Equal(27_000, state.udeg);
        Assert.Equal(45_000, state.mrpm);

        state.remainder = 999;
        Rotary.stepRotary(
            state, ReferenceProfile.derived.vMotorRunMv, true, false, false, ReferenceProfile, flags, IgnoreEdge);
        Assert.Equal(0, state.udeg);
        Assert.Equal(-45_000, state.mrpm);
        Assert.Equal(0, state.remainder);
    }

    // Coast deferred while a contact is mid-transfer. A relay, pushbutton or slide that cuts the drive
    // by leaving one contact and then shorts STOP by landing on the other leaves the armature undriven
    // but not yet braked for the transfer. The coast waits for the stroke to land, so the brake it lands
    // on picks the offset.
    private static readonly long LongestStroke = Math.Max(
        Math.Max(ReferenceProfile.derived.relayOperateTicks, ReferenceProfile.derived.relayReleaseTicks),
        Math.Max(ReferenceProfile.derived.pushbuttonTicks, ReferenceProfile.derived.slideTicks));

    private static RotaryState Running()
    {
        var state = Rotary.createRotaryState(ReferenceProfile);
        Rotary.stepRotary(
            state, -ReferenceProfile.derived.vMotorRunMv, true, false, false, ReferenceProfile,
            new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000, state.udeg);
        return state;
    }

    [Fact]
    public void Coast_defer_holds_while_the_stroke_is_in_flight_then_takes_the_stop_shorted_offset_when_the_short_lands()
    {
        var state = Running();
        Rotary.stepRotary(state, null, true, false, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Rotary.stepRotary(state, null, true, false, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000, state.udeg);
        Assert.Equal(0, state.mrpm);
        Assert.Equal(45_000, state.lastMotorMrpm);

        Rotary.stepRotary(state, 0, true, true, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000 + ReferenceProfile.v.coast_udeg_stop_shorted, state.udeg);
        Assert.Equal(0, state.mrpm);
        Assert.Equal(0, state.lastMotorMrpm);
        Assert.Equal(0, state.coastDeferTicks);
    }

    [Fact]
    public void Coast_defer_takes_the_drive_removed_offset_once_every_stroke_has_landed_without_a_short()
    {
        var state = Running();
        Rotary.stepRotary(state, null, true, false, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Rotary.stepRotary(state, null, true, false, false, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000 + ReferenceProfile.v.coast_udeg_drive_removed, state.udeg);
        Assert.Equal(0, state.lastMotorMrpm);
    }

    [Fact]
    public void Coast_defer_owes_no_coast_when_the_drive_returns_before_the_stroke_lands()
    {
        var state = Running();
        Rotary.stepRotary(state, null, true, false, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Rotary.stepRotary(
            state, -ReferenceProfile.derived.vMotorRunMv, true, false, true, ReferenceProfile,
            new PortFlags(), IgnoreEdge);
        Assert.Equal(54_000, state.udeg);
        Assert.Equal(45_000, state.mrpm);
        Assert.Equal(0, state.coastDeferTicks);
    }

    [Fact]
    public void Coast_defer_waits_at_most_the_longest_stroke_in_the_profile()
    {
        var state = Running();
        for (var i = 0; i < LongestStroke; i++)
            Rotary.stepRotary(state, null, true, false, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000, state.udeg);
        Assert.Equal(LongestStroke, (long)state.coastDeferTicks);
        Rotary.stepRotary(state, null, true, false, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000 + ReferenceProfile.v.coast_udeg_drive_removed, state.udeg);
        Assert.Equal(0, state.coastDeferTicks);
    }

    // Architecture §13.4.5; fallback TRANSFER-COAST-DEFER (open-questions.md O-R12).
    [Fact]
    public void Coast_defer_takes_the_stop_shorted_offset_when_the_short_lands_on_the_cap_tick()
    {
        var state = Running();
        for (var i = 0; i < LongestStroke; i++)
            Rotary.stepRotary(state, null, true, false, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000, state.udeg);
        Assert.Equal(LongestStroke, (long)state.coastDeferTicks);
        Rotary.stepRotary(state, 0, true, true, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000 + ReferenceProfile.v.coast_udeg_stop_shorted, state.udeg);
        Assert.Equal(0, state.mrpm);
        Assert.Equal(0, state.lastMotorMrpm);
        Assert.Equal(0, state.coastDeferTicks);
    }

    // Architecture §13.4.5; fallback TRANSFER-COAST-DEFER (open-questions.md O-R12).
    [Fact]
    public void Coast_defer_owes_no_coast_when_the_drive_returns_reversed_within_the_wait()
    {
        var state = Running();
        Rotary.stepRotary(state, null, true, false, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Rotary.stepRotary(state, null, true, false, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000, state.udeg);
        Assert.Equal(45_000, state.lastMotorMrpm);
        Assert.Equal(2, state.coastDeferTicks);
        Rotary.stepRotary(
            state, ReferenceProfile.derived.vMotorRunMv, true, false, true, ReferenceProfile,
            new PortFlags(), IgnoreEdge);
        Assert.Equal(0, state.udeg);
        Assert.Equal(-45_000, state.mrpm);
        Assert.Equal(-45_000, state.lastMotorMrpm);
        Assert.Equal(0, state.coastDeferTicks);
    }

    [Fact]
    public void Coast_defer_never_waits_on_power_loss_or_on_a_short_that_is_already_there()
    {
        var lost = Running();
        Rotary.stepRotary(lost, 0, false, false, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000 + ReferenceProfile.v.coast_udeg_drive_removed, lost.udeg);

        var shorted = Running();
        Rotary.stepRotary(shorted, 0, true, true, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000 + ReferenceProfile.v.coast_udeg_stop_shorted, shorted.udeg);
    }

    [Fact]
    public void Coast_defer_is_cancelled_by_a_hand_grab()
    {
        var state = Running();
        Rotary.stepRotary(state, null, true, false, true, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Rotary.grabRotary(state, 27_000);
        Rotary.releaseRotary(state);
        Assert.Equal(0, state.lastMotorMrpm);
        Assert.Equal(0, state.coastDeferTicks);
        Rotary.stepRotary(state, null, true, false, false, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(27_000, state.udeg);
    }

    [Fact]
    public void Zero_drive_uses_the_shorted_stop_offset_once_in_the_last_positive_direction()
    {
        var state = Rotary.createRotaryState(ReferenceProfile);
        Rotary.stepRotary(
            state, -ReferenceProfile.derived.vMotorRunMv, true, false, false, ReferenceProfile,
            new PortFlags(), IgnoreEdge);
        Rotary.stepRotary(state, 0, true, true, false, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(5_027_000, state.udeg);
        Assert.Equal(0, state.mrpm);
        Assert.Equal(0, state.lastMotorMrpm);
        Rotary.stepRotary(state, 0, true, true, false, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(5_027_000, state.udeg);
    }

    [Fact]
    public void Zero_drive_uses_drive_removed_offset_on_power_loss_and_keeps_negative_direction()
    {
        var positive = Rotary.createRotaryState(ReferenceProfile);
        var negative = Rotary.createRotaryState(ReferenceProfile);
        Rotary.stepRotary(
            positive, -ReferenceProfile.derived.vMotorRunMv, true, false, false, ReferenceProfile,
            new PortFlags(), IgnoreEdge);
        Rotary.stepRotary(positive, 0, false, true, false, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(9_567_000, positive.udeg);

        Rotary.stepRotary(
            negative, ReferenceProfile.derived.vMotorRunMv, true, false, false, ReferenceProfile,
            new PortFlags(), IgnoreEdge);
        Rotary.stepRotary(negative, null, false, false, false, ReferenceProfile, new PortFlags(), IgnoreEdge);
        Assert.Equal(350_433_000, negative.udeg);
        Assert.Equal(0, negative.mrpm);
    }

    [Fact]
    public void Crossing_enumeration_handles_several_boundaries_and_a_complete_revolution()
    {
        var profile = ProfileWith((ScalarKey.coast_udeg_drive_removed, 400_000_000));
        var state = Rotary.createRotaryState(profile);
        var output = new EdgeCollector();
        Rotary.stepRotary(state, -profile.derived.vMotorRunMv, true, false, false, profile, new PortFlags(), output.Emit);
        Rotary.stepRotary(state, 0, false, false, false, profile, new PortFlags(), output.Emit);

        Assert.Equal(40_027_000, state.udeg);
        Assert.Equal(2, state.contact);
        Assert.Equal(36, output.Edges.Count);
        Assert.Equal(
            [
                new Edge(RotaryEdgeKind.@break, 0), new Edge(RotaryEdgeKind.make, 1),
                new Edge(RotaryEdgeKind.@break, 1), new Edge(RotaryEdgeKind.make, 2),
                new Edge(RotaryEdgeKind.@break, 2), new Edge(RotaryEdgeKind.make, 3),
            ],
            output.Edges.GetRange(0, 6));
        Assert.Equal(
            [
                new Edge(RotaryEdgeKind.@break, 0), new Edge(RotaryEdgeKind.make, 1),
                new Edge(RotaryEdgeKind.@break, 1), new Edge(RotaryEdgeKind.make, 2),
            ],
            output.Edges.GetRange(output.Edges.Count - 4, 4));
    }

    [Fact]
    public void Negative_crossings_emit_in_reverse_physical_order()
    {
        var profile = ProfileWith((ScalarKey.coast_udeg_drive_removed, 100_000_000));
        var state = Rotary.createRotaryState(profile);
        var output = new EdgeCollector();
        Rotary.stepRotary(state, profile.derived.vMotorRunMv, true, false, false, profile, new PortFlags(), output.Emit);
        Rotary.stepRotary(state, 0, false, false, false, profile, new PortFlags(), output.Emit);
        Assert.Equal(
            [
                new Edge(RotaryEdgeKind.@break, 0), new Edge(RotaryEdgeKind.make, 15),
                new Edge(RotaryEdgeKind.@break, 15), new Edge(RotaryEdgeKind.make, 14),
                new Edge(RotaryEdgeKind.@break, 14), new Edge(RotaryEdgeKind.make, 13),
            ],
            output.Edges.GetRange(0, 6));
    }

    // Coast scales with the speed it stops from. Architecture §13.4.5; fallback COAST-SCALES-WITH-SPEED
    // (open-questions.md O-R13, offsets O-R5). With vMotorRunMv equal to run_mrpm the rate law is the
    // identity: |voltage| mrpm, exactly.
    private static Profile Identity(params (ScalarKey Key, long Value)[] changes)
    {
        var run = ReferenceProfile.v.run_mrpm;
        foreach (var change in changes)
            if (change.Key == ScalarKey.run_mrpm) run = change.Value;
        return ProfileWithDerived(ReferenceProfile.derived with { vMotorRunMv = (int)run }, changes);
    }

    // Stop distance from one driven tick at speed, then a stop through the given brake.
    private static long CoastFrom(Profile profile, int speed, bool shorted)
    {
        var state = Rotary.createRotaryState(profile);
        Rotary.stepRotary(state, -speed, true, false, false, profile, new PortFlags(), IgnoreEdge);
        var driven = state.udeg;
        Rotary.stepRotary(state, 0, true, shorted, false, profile, new PortFlags(), IgnoreEdge);
        Assert.Equal(0, state.mrpm);
        Assert.Equal(0, state.lastMotorMrpm);
        return (state.udeg - driven + 360_000_000) % 360_000_000;
    }

    private static long ReferenceCoast(long coast, long speed, long run)
    {
        if (speed >= run) return coast;
        var product = (Int128)coast * speed;
        var quotient = product / run;
        return (long)((product - quotient * run) * 2 >= run ? quotient + 1 : quotient);
    }

    [Fact]
    public void Coast_scaling_leaves_a_full_speed_stop_on_exactly_the_configured_offsets()
    {
        Assert.Equal(ReferenceProfile.v.coast_udeg_drive_removed, CoastFrom(Identity(), 45_000, false));
        Assert.Equal(ReferenceProfile.v.coast_udeg_stop_shorted, CoastFrom(Identity(), 45_000, true));
    }

    [Fact]
    public void Coast_scaling_halves_the_offset_at_half_speed_rounding_an_exact_half_away_from_zero()
    {
        Assert.Equal(4_770_000, CoastFrom(Identity(), 22_500, false));
        Assert.Equal(2_500_000, CoastFrom(Identity(), 22_500, true));
        var odd = Identity(
            (ScalarKey.coast_udeg_drive_removed, 20_000_001), (ScalarKey.coast_udeg_stop_shorted, 4_999_999));
        Assert.Equal(10_000_001, CoastFrom(odd, 22_500, false)); // 10_000_000.5
        Assert.Equal(2_500_000, CoastFrom(odd, 22_500, true)); // 2_499_999.5
    }

    [Fact]
    public void Coast_scaling_gives_a_creep_stop_almost_no_overrun()
    {
        // REF-A's own rate law: 146 mV of reverse flyback drive is 1616 mrpm, 3.6% of RUN (V-EXP12, O-R13).
        Assert.Equal(-1616, Rotary.motorRateMrpm(146, ReferenceProfile, new PortFlags()));
        // A local 20 deg coast, independent of the shipped value, keeps inexact quotients that tell rounding
        // from truncation.
        var coast20 = ProfileWith((ScalarKey.coast_udeg_drive_removed, 20_000_000));
        var state = Rotary.createRotaryState(coast20);
        Rotary.stepRotary(state, 146, true, false, false, coast20, new PortFlags(), IgnoreEdge);
        var driven = state.udeg;
        Rotary.stepRotary(state, null, true, false, false, coast20, new PortFlags(), IgnoreEdge);
        Assert.Equal(718_222, driven - state.udeg); // 20_000_000 * 1616 / 45_000 = 718_222.2
        Assert.Equal(4_889, CoastFrom(Identity((ScalarKey.coast_udeg_drive_removed, 20_000_000)), 11, false)); // 4_888.9
        Assert.Equal(1_222, CoastFrom(Identity(), 11, true)); // 1_222.2
    }

    [Fact]
    public void Coast_scaling_scales_the_stop_shorted_offset_after_a_deferred_transfer_by_the_speed_the_drive_left_at()
    {
        var profile = Identity();
        var state = Rotary.createRotaryState(profile);
        Rotary.stepRotary(state, -9_000, true, false, false, profile, new PortFlags(), IgnoreEdge);
        var driven = state.udeg;
        Rotary.stepRotary(state, null, true, false, true, profile, new PortFlags(), IgnoreEdge);
        Assert.Equal(driven, state.udeg);
        Assert.Equal(9_000, state.lastMotorMrpm);
        Assert.Equal(1, state.coastDeferTicks);
        Rotary.stepRotary(state, 0, true, true, true, profile, new PortFlags(), IgnoreEdge);
        Assert.Equal(1_000_000, state.udeg - driven); // 5_000_000 * 9_000 / 45_000
    }

    [Fact]
    public void Coast_scaling_caps_a_stop_from_faster_than_run_at_the_configured_offset()
    {
        Assert.Equal(ReferenceProfile.v.coast_udeg_drive_removed, CoastFrom(Identity(), 90_000, false));
        Assert.Equal(ReferenceProfile.v.coast_udeg_stop_shorted, CoastFrom(Identity(), 45_001, true));
    }

    [Fact]
    public void Coast_scaling_matches_an_exact_integer_reference_up_to_a_2_62_product()
    {
        long[] coasts = [1, 5_000_000, 20_000_001, 359_999_999, int.MaxValue];
        long[] runs = [1, 3, 45_000, 65_537, int.MaxValue];
        foreach (var coast in coasts)
        foreach (var run in runs)
        foreach (var speed in new[] { 1, run / 2, run - 1, run, run + 1 })
        {
            if (speed <= 0 || speed > int.MaxValue) continue;
            var profile = Identity((ScalarKey.run_mrpm, run), (ScalarKey.coast_udeg_drive_removed, coast));
            Assert.Equal(ReferenceCoast(coast, speed, run) % 360_000_000, CoastFrom(profile, (int)speed, false));
        }
    }

    private sealed record Edge(RotaryEdgeKind Kind, int Pos);

    private sealed class EdgeCollector
    {
        public List<Edge> Edges { get; } = [];
        public void Emit(RotaryEdgeKind kind, int pos) => Edges.Add(new Edge(kind, pos));
    }

    private static void IgnoreEdge(RotaryEdgeKind kind, int pos)
    {
    }

    private static long ReferenceMotorRate(long runMrpm, int voltage, int divisor)
    {
        // Positive travel for negative V(D18)-V(D19), i.e. D17 side positive (§13.4.5).
        var numerator = -(Int128)runMrpm * voltage;
        var quotient = numerator / divisor;
        var remainder = numerator % divisor;
        var magnitude = remainder < 0 ? -remainder : remainder;
        if (magnitude * 2 >= divisor)
            quotient += numerator < 0 ? -1 : 1;
        return (long)quotient;
    }

    private static long WrapReference(long udeg, long displacement)
    {
        const long full = 360_000_000;
        var wrapped = (udeg + displacement) % full;
        return wrapped < 0 ? wrapped + full : wrapped;
    }

    private static Profile ProfileWith(params (ScalarKey Key, long Value)[] changes) =>
        ProfileWithDerived(ReferenceProfile.derived, changes);

    private static Profile ProfileWithDerived(Derived derived, params (ScalarKey Key, long Value)[] changes)
    {
        var keys = Enum.GetValues<ScalarKey>();
        var values = new long[keys.Length];
        for (var i = 0; i < keys.Length; i++)
        {
            var property = typeof(Profile.Values).GetProperty(keys[i].ToString())!;
            values[i] = (long)property.GetValue(ReferenceProfile.v)!;
        }
        foreach (var change in changes)
            values[(int)change.Key] = change.Value;
        var constructor = typeof(Profile.Values).GetConstructor(
            BindingFlags.Instance | BindingFlags.NonPublic, null, [typeof(long[])], null)!;
        var profileValues = (Profile.Values)constructor.Invoke([values]);
        return ReferenceProfile with { v = profileValues, derived = derived };
    }

    private static Profile LoadReferenceProfile()
    {
        using var document = JsonDocument.Parse(Artifacts.ReadAllBytes("data/profiles/MV601-REF-A.json"));
        return Profile.LoadProfile(document.RootElement);
    }

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
            if (File.Exists(Path.Combine(directory.FullName, "package.json"))) return directory.FullName;
        throw new InvalidOperationException("repository root not found");
    }
}
