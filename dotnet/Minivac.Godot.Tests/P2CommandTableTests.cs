using System;
using Minivac.Core;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class P2CommandTableTests
{
    [Fact]
    public void Fixed_controls_emit_the_appendix_C_commands()
    {
        AssertCommand(new Command.Power(false), Commands.Power(true));
        AssertCommand(new Command.Power(true), Commands.Power(false));
        AssertCommand(new Command.Breaker(), Commands.Breaker());
        AssertCommand(new Command.Button(3, 1000), Commands.Pushbutton(3, true));
        AssertCommand(new Command.Button(3, 0), Commands.Pushbutton(3, false));
        AssertCommand(new Command.Switch(4, 1000), Commands.Switch(4, 499));
        AssertCommand(new Command.Switch(4, 0), Commands.Switch(4, 500));
        AssertCommand(new Command.RelayRelease(5), Commands.RelayRelease(5));
        AssertCommand(new Command.DialRelease(), Commands.DialRelease());
    }

    [Theory]
    [InlineData(0.0, -1.0, 0L)]
    [InlineData(1.0, 0.0, 90_000_000L)]
    [InlineData(0.0, 1.0, 180_000_000L)]
    [InlineData(-1.0, 0.0, 270_000_000L)]
    [InlineData(-0.00000001, -1.0, 359_999_999L)]
    public void Dial_pointer_math_is_clockwise_half_up_and_clamped(
        double dx,
        double dy,
        long expected)
    {
        var command = Assert.IsType<Command.DialGrab>(Commands.DialGrab(dx, dy));
        Assert.Equal(expected, command.targetUdeg);
    }

    [Fact]
    public void Relay_keyboard_step_emits_pre_step_then_actual_change()
    {
        var ordinary = Commands.RelayKeyboardStep(2, 400, 401);
        Assert.Collection(
            ordinary,
            command => AssertCommand(new Command.RelayGrab(2, 400), command),
            command => AssertCommand(new Command.RelayGrab(2, 401), command));

        var atBound = Commands.RelayKeyboardStep(2, 1000, 1000);
        Assert.Collection(
            atBound,
            command => AssertCommand(new Command.RelayGrab(2, 1000), command));
    }

    [Fact]
    public void Dial_keyboard_step_is_a_momentary_grab_release_pair()
    {
        Assert.Collection(
            Commands.DialKeyboardStep(123_456_789),
            command => AssertCommand(new Command.DialGrab(123_456_789), command),
            command => AssertCommand(new Command.DialRelease(), command));
    }

    [Theory]
    [InlineData(1000, 0, 100)]
    [InlineData(1000, 1000, 1000)]
    [InlineData(359_999_999, 0, 35_999_999)]
    public void Keyboard_delta_matches_Godot_rule(long maximum, long current, long expectedPage)
    {
        Assert.Equal(Math.Min(maximum, current + 1), Commands.KeyboardTarget(current, maximum, Commands.KeyStep.ArrowUp));
        Assert.Equal(expectedPage, Commands.KeyboardTarget(current, maximum, Commands.KeyStep.PageUp));
        Assert.Equal(0, Commands.KeyboardTarget(current, maximum, Commands.KeyStep.Home));
        Assert.Equal(maximum, Commands.KeyboardTarget(current, maximum, Commands.KeyStep.End));
    }

    private static void AssertCommand(Command expected, Command actual) =>
        Assert.Equal(Trace.formatCommand(0, expected), Trace.formatCommand(0, actual));
}
