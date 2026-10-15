using System;
using System.Linq;
using Minivac.Core;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class P3AudioRouterTests
{
    [Fact]
    public void Relay_layers_select_distinct_samples_and_six_fixed_pitch_offsets()
    {
        Assert.Equal(RelaySampleKind.PullIn, AudioLayers.SelectRelaySample(RelayCueKind.PullIn));
        Assert.Equal(RelaySampleKind.DropOut, AudioLayers.SelectRelaySample(RelayCueKind.DropOut));
        Assert.Equal(
            [-0.030f, -0.018f, -0.006f, 0.006f, 0.018f, 0.030f],
            Enumerable.Range(1, 6).Select(AudioLayers.PitchOffsetForRelay));
        Assert.Equal(
            [0.970f, 0.982f, 0.994f, 1.006f, 1.018f, 1.030f],
            Enumerable.Range(1, 6).Select(AudioLayers.PitchScaleForRelay));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(7)]
    public void Relay_layers_reject_out_of_range_relay_indices(int relay)
    {
        var error = Assert.Throws<ArgumentOutOfRangeException>(
            () => AudioLayers.PitchScaleForRelay(relay));
        Assert.Equal("relay", error.ParamName);
    }

    [Fact]
    public void Relay_due_times_are_monotone_and_tick_spaced_across_a_500_tick_catch_up()
    {
        Event[] events = Enumerable.Range(0, 500)
            .Select(offset => offset % 2 == 0
                ? (Event)new Event.RelayPullIn(100 + offset, offset % 6 + 1, 40_000, 1_000)
                : new Event.RelayDropOut(100 + offset, offset % 6 + 1, 30_000, 1_000))
            .ToArray();

        var plan = AudioSchedule.Frame(AudioSchedule.Initial, StateWithMotor(0), events, 10_000_000);

        Assert.Equal(500, plan.RelayCues.Count);
        Assert.Equal(10_000_000, plan.RelayCues[0].DueUs);
        Assert.Equal(10_049_900, plan.RelayCues[^1].DueUs);
        Assert.Equal(599, plan.Cursor.LastEventTick);
        Assert.Equal(10_049_900, plan.Cursor.LastOnsetUs);
        for (var index = 1; index < plan.RelayCues.Count; index++)
            Assert.Equal(100, plan.RelayCues[index].DueUs - plan.RelayCues[index - 1].DueUs);
    }

    [Fact]
    public void Relay_schedule_filters_silent_events_and_preserves_same_tick_order()
    {
        Event[] events =
        [
            new Event.PowerOn(20),
            new Event.RelayPullIn(20, 4, 40_000, 1_000),
            new Event.ContactMake(20, "4A", "4B"),
            new Event.RelayDropOut(20, 4, 30_000, 1_000),
            new Event.DialMake(21, 3),
        ];

        var plan = AudioSchedule.Frame(AudioSchedule.Initial, StateWithMotor(0), events, 5_000);

        Assert.Collection(
            plan.RelayCues,
            cue => Assert.Equal(new RelayCue(RelayCueKind.PullIn, 4, 5_000), cue),
            cue => Assert.Equal(new RelayCue(RelayCueKind.DropOut, 4, 5_000), cue));
    }

    [Fact]
    public void Regressing_event_ticks_are_clamped_without_regressing_due_time()
    {
        Event[] events =
        [
            new Event.RelayPullIn(20, 1, 0, 0),
            new Event.RelayDropOut(19, 2, 0, 0),
            new Event.RelayPullIn(25, 3, 0, 0),
        ];

        var plan = AudioSchedule.Frame(AudioSchedule.Initial, StateWithMotor(0), events, 70_000);

        Assert.Equal([70_000L, 70_000L, 70_500L], plan.RelayCues.Select(cue => cue.DueUs));
        Assert.Equal(25, plan.Cursor.LastEventTick);
    }

    [Fact]
    public void Next_burst_anchor_uses_last_event_tick_spacing()
    {
        var cursor = new AudioSchedule.Cursor(1_000_000, 100, 0, 0);
        Event[] events = [new Event.RelayPullIn(600, 2, 0, 0)];

        var plan = AudioSchedule.Frame(cursor, StateWithMotor(0), events, 900_000);

        Assert.Equal(1_050_000, Assert.Single(plan.RelayCues).DueUs);

        var resetTickPlan = AudioSchedule.Frame(
            plan.Cursor,
            StateWithMotor(0),
            [new Event.RelayDropOut(1, 2, 0, 0)],
            1_040_000);
        Assert.Equal(1_050_000, Assert.Single(resetTickPlan.RelayCues).DueUs);
    }

    [Theory]
    [InlineData(0, 0.5)]
    [InlineData(1, 0.5)]
    [InlineData(-22_500, 0.5)]
    [InlineData(45_000, 1.0)]
    [InlineData(-90_000, 2.0)]
    [InlineData(int.MaxValue, 2.0)]
    [InlineData(int.MinValue, 2.0)]
    public void Motor_rate_uses_absolute_speed_and_the_pinned_clamp(int mrpm, double expected) =>
        Assert.Equal(expected, AudioSchedule.MotorPlaybackRate(mrpm));

    [Fact]
    public void Motor_cues_coalesce_to_start_rate_direction_and_stop()
    {
        var cursor = AudioSchedule.Initial;

        var start = MotorSet(AudioSchedule.Frame(cursor, StateWithMotor(45_000), [], 0));
        Assert.Equal(new MotorCue(MotorCueKind.Start, 1, 1), start);
        cursor = AudioSchedule.ResolveMotor(cursor, new MotorDirective.Set(start), true);
        Assert.Null(AudioSchedule.Frame(cursor, StateWithMotor(45_000), [], 0).Motor);

        var rate = MotorSet(AudioSchedule.Frame(cursor, StateWithMotor(90_000), [], 0));
        Assert.Equal(new MotorCue(MotorCueKind.Rate, 1, 2), rate);
        cursor = AudioSchedule.ResolveMotor(cursor, new MotorDirective.Set(rate), true);

        var direction = MotorSet(AudioSchedule.Frame(cursor, StateWithMotor(-22_500), [], 0));
        Assert.Equal(new MotorCue(MotorCueKind.Direction, -1, 0.5), direction);
        cursor = AudioSchedule.ResolveMotor(cursor, new MotorDirective.Set(direction), true);

        var stop = Assert.IsType<MotorDirective.Stop>(
            AudioSchedule.Frame(cursor, StateWithMotor(0), [], 0).Motor);
        cursor = AudioSchedule.ResolveMotor(cursor, stop, true);
        Assert.Null(AudioSchedule.Frame(cursor, StateWithMotor(0), [], 0).Motor);
    }

    [Fact]
    public void Refused_motor_start_rate_direction_and_stop_retry_but_relay_cues_drop()
    {
        Assert.False(AudioSchedule.ShouldRetry(AudioCueClass.Relay, applied: false));
        Assert.True(AudioSchedule.ShouldRetry(AudioCueClass.Motor, applied: false));
        Assert.False(AudioSchedule.ShouldRetry(AudioCueClass.Relay, applied: true));
        Assert.False(AudioSchedule.ShouldRetry(AudioCueClass.Motor, applied: true));

        var cursor = AudioSchedule.Initial;
        cursor = RefuseThenAccept(cursor, 45_000, MotorCueKind.Start);
        cursor = RefuseThenAccept(cursor, 90_000, MotorCueKind.Rate);
        cursor = RefuseThenAccept(cursor, -22_500, MotorCueKind.Direction);

        var stop = Assert.IsType<MotorDirective.Stop>(
            AudioSchedule.Frame(cursor, StateWithMotor(0), [], 0).Motor);
        var refusedStop = AudioSchedule.ResolveMotor(cursor, stop, applied: false);
        Assert.Equal(cursor, refusedStop);
        Assert.IsType<MotorDirective.Stop>(
            AudioSchedule.Frame(refusedStop, StateWithMotor(0), [], 0).Motor);
    }

    private static MotorCue MotorSet(AudioSchedule.Plan plan) =>
        Assert.IsType<MotorDirective.Set>(plan.Motor).Cue;

    private static AudioSchedule.Cursor RefuseThenAccept(
        AudioSchedule.Cursor cursor,
        int mrpm,
        MotorCueKind expectedKind)
    {
        var first = AudioSchedule.Frame(cursor, StateWithMotor(mrpm), [], 0);
        var directive = Assert.IsType<MotorDirective.Set>(first.Motor);
        Assert.Equal(expectedKind, directive.Cue.Kind);
        var refused = AudioSchedule.ResolveMotor(first.Cursor, directive, applied: false);
        Assert.Equal(cursor, refused);
        Assert.Equal(directive, AudioSchedule.Frame(refused, StateWithMotor(mrpm), [], 0).Motor);
        return AudioSchedule.ResolveMotor(first.Cursor, directive, applied: true);
    }

    private static State StateWithMotor(int mrpm) => new(
        "MV601-CONTRACT-1.1",
        "netlist",
        "MV601-REF-A",
        "profile",
        0,
        false,
        false,
        0,
        0,
        [],
        [],
        [],
        [],
        [],
        new State.Dial(0, null, mrpm, false),
        [],
        [],
        [],
        new State.Flags([], false, false));
}
