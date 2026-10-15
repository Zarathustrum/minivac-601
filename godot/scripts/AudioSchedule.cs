using System;
using System.Collections.Generic;
using Minivac.Core;

namespace Minivac.Godot;

public enum RelayCueKind
{
    PullIn,
    DropOut,
}

public readonly record struct RelayCue(RelayCueKind Kind, int Relay, long DueUs);

public enum MotorCueKind
{
    Start,
    Rate,
    Direction,
}

public readonly record struct MotorCue(MotorCueKind Kind, int Direction, double Rate);

public abstract record MotorDirective
{
    private MotorDirective() { }

    public sealed record Set(MotorCue Cue) : MotorDirective;
    public sealed record Stop : MotorDirective;
}

public enum AudioCueClass
{
    Relay,
    Motor,
}

public static class AudioSchedule
{
    private const long TickUs = 100;
    private const double MinMotorRate = 0.5;
    private const double MaxMotorRate = 2.0;
    private const double ReferenceMrpm = 45_000.0;

    public sealed record Cursor(
        long LastOnsetUs,
        int? LastEventTick,
        int MotorDirection,
        double MotorRate);

    public sealed record Plan(
        Cursor Cursor,
        IReadOnlyList<RelayCue> RelayCues,
        MotorDirective? Motor);

    public static Cursor Initial { get; } = new(0, null, 0, 0);

    public static double MotorPlaybackRate(int mrpm)
    {
        var rate = Math.Abs((long)mrpm) / ReferenceMrpm;
        return Math.Min(MaxMotorRate, Math.Max(MinMotorRate, rate));
    }

    public static Plan Frame(
        Cursor cursor,
        State state,
        IReadOnlyList<Event> events,
        long nowUs)
    {
        ArgumentNullException.ThrowIfNull(cursor);
        ArgumentNullException.ThrowIfNull(state);
        ArgumentNullException.ThrowIfNull(events);

        var relayEvents = new List<Event>();
        foreach (var item in events)
        {
            if (item is Event.RelayPullIn or Event.RelayDropOut)
                relayEvents.Add(item);
        }

        var next = cursor;
        IReadOnlyList<RelayCue> cues = Array.Empty<RelayCue>();
        if (relayEvents.Count > 0)
        {
            var scheduled = new RelayCue[relayEvents.Count];
            var firstTick = relayEvents[0].t;
            var priorTick = firstTick;
            var anchorUs = Math.Max(cursor.LastOnsetUs, nowUs);
            if (cursor.LastEventTick is int lastEventTick && firstTick >= lastEventTick)
            {
                anchorUs = Math.Max(
                    anchorUs,
                    cursor.LastOnsetUs + ((long)firstTick - lastEventTick) * TickUs);
            }

            var lastOnsetUs = cursor.LastOnsetUs;
            int? nextLastEventTick = cursor.LastEventTick;
            for (var index = 0; index < relayEvents.Count; index++)
            {
                var item = relayEvents[index];
                var tick = Math.Max(priorTick, item.t);
                var dueUs = Math.Max(
                    lastOnsetUs,
                    anchorUs + ((long)tick - firstTick) * TickUs);
                scheduled[index] = item switch
                {
                    Event.RelayPullIn pullIn => new(RelayCueKind.PullIn, pullIn.n, dueUs),
                    Event.RelayDropOut dropOut => new(RelayCueKind.DropOut, dropOut.n, dueUs),
                    _ => throw new InvalidOperationException("audio schedule: non-relay event survived filtering"),
                };
                lastOnsetUs = dueUs;
                nextLastEventTick = tick;
                priorTick = tick;
            }
            cues = Array.AsReadOnly(scheduled);
            next = next with
            {
                LastOnsetUs = lastOnsetUs,
                LastEventTick = nextLastEventTick,
            };
        }

        return new(next, cues, MotorFor(next, state.dial.mrpm));
    }

    public static Cursor ResolveMotor(Cursor cursor, MotorDirective directive, bool applied)
    {
        ArgumentNullException.ThrowIfNull(cursor);
        ArgumentNullException.ThrowIfNull(directive);
        if (ShouldRetry(AudioCueClass.Motor, applied)) return cursor;

        return directive switch
        {
            MotorDirective.Set set => cursor with
            {
                MotorDirection = set.Cue.Direction,
                MotorRate = set.Cue.Rate,
            },
            MotorDirective.Stop => cursor with { MotorDirection = 0, MotorRate = 0 },
            _ => throw new InvalidOperationException("audio schedule: unknown motor directive"),
        };
    }

    public static bool ShouldRetry(AudioCueClass cueClass, bool applied) =>
        !applied && cueClass == AudioCueClass.Motor;

    private static MotorDirective? MotorFor(Cursor cursor, int mrpm)
    {
        var direction = Math.Sign(mrpm);
        if (direction == 0)
            return cursor.MotorDirection == 0 ? null : new MotorDirective.Stop();

        var rate = MotorPlaybackRate(mrpm);
        if (direction == cursor.MotorDirection && rate == cursor.MotorRate) return null;
        var kind = cursor.MotorDirection == 0
            ? MotorCueKind.Start
            : direction == cursor.MotorDirection ? MotorCueKind.Rate : MotorCueKind.Direction;
        return new MotorDirective.Set(new MotorCue(kind, direction, rate));
    }
}
