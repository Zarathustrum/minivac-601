using System;
using System.Collections.Generic;
using Minivac.Core;

namespace Minivac.Godot;

public static class Commands
{
    public enum KeyStep { ArrowDown, ArrowUp, PageDown, PageUp, Home, End }

    public static Command Power(bool current) => new Command.Power(!current);

    public static Command Breaker() => new Command.Breaker();

    public static Command Pushbutton(int section, bool pressed) =>
        new Command.Button(section, pressed ? 1000 : 0);

    public static Command Switch(int section, int travel) =>
        new Command.Switch(section, travel < 500 ? 1000 : 0);

    public static Command RelayGrab(int section, int target) =>
        new Command.RelayGrab(section, Clamp(target, 0, 1000));

    public static Command RelayRelease(int section) => new Command.RelayRelease(section);

    public static Command DialGrab(double dx, double dy) =>
        new Command.DialGrab(DialTargetUdeg(dx, dy));

    public static Command DialGrab(long targetUdeg) =>
        new Command.DialGrab(Clamp(targetUdeg, 0, 359_999_999));

    public static Command DialRelease() => new Command.DialRelease();

    public static long DialTargetUdeg(double dx, double dy)
    {
        var degrees = (Math.Atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
        return Math.Min(359_999_999, (long)Math.Floor(degrees * 1_000_000 + 0.5));
    }

    public static IReadOnlyList<Command> RelayKeyboardStep(int section, int before, int after) =>
        before == after
            ? [new Command.RelayGrab(section, before)]
            : [new Command.RelayGrab(section, before), new Command.RelayGrab(section, after)];

    public static IReadOnlyList<Command> DialKeyboardStep(long targetUdeg) =>
        [DialGrab(targetUdeg), DialRelease()];

    public static long KeyboardTarget(long current, long maximum, KeyStep step)
    {
        var page = Math.Max(1, maximum / 10);
        return step switch
        {
            KeyStep.ArrowDown => Clamp(current - 1, 0, maximum),
            KeyStep.ArrowUp => Clamp(current + 1, 0, maximum),
            KeyStep.PageDown => Clamp(current - page, 0, maximum),
            KeyStep.PageUp => Clamp(current + page, 0, maximum),
            KeyStep.Home => 0,
            KeyStep.End => maximum,
            _ => throw new ArgumentOutOfRangeException(nameof(step)),
        };
    }

    private static int Clamp(int value, int minimum, int maximum) =>
        value < minimum ? minimum : value > maximum ? maximum : value;

    private static long Clamp(long value, long minimum, long maximum) =>
        value < minimum ? minimum : value > maximum ? maximum : value;
}
