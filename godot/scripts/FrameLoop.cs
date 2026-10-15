using System;
using System.Collections.Generic;
using Minivac.Core;

namespace Minivac.Godot;

// The accounting below is the literal C# image quoted in phase-3-godot.md §2.7.
// Godot stays outside this class so tests can drive the clock seam directly.
public sealed class FrameLoop
{
    private const long TickUs = 100;
    private const long MaxCatchUpUs = 50_000;
    private readonly Machine _machine;
    private readonly Action<int, int[], IReadOnlyList<Event>> _sample;
    private readonly Action<State, long> _render;
    private long? _lastUs;
    private long _carryUs;
    private int _nextBoundaryTick;

    public FrameLoop(
        Machine machine,
        Action<int, int[], IReadOnlyList<Event>> sample,
        Action<State, long> render)
    {
        _machine = machine;
        _sample = sample;
        _render = render;
        _nextBoundaryTick = machine.Snapshot().tick;
    }

    public void Frame(long nowUs)
    {
        _lastUs ??= nowUs;
        long dtUs = Math.Min(nowUs - _lastUs.Value, MaxCatchUpUs);
        long total = dtUs + _carryUs;
        long ticks = total / TickUs;
        _carryUs = total - ticks * TickUs;
        for (long i = 0; i < ticks; i++)
        {
            _machine.Advance(1);
            IReadOnlyList<Event> events = _machine.DrainEvents();
            int boundaryTick = events.Count == 0 ? _nextBoundaryTick : events[0].t;
            foreach (var item in events)
            {
                if (item.t != boundaryTick)
                    throw new InvalidOperationException("ui loop: one-tick drain had mixed timestamps");
            }
            _sample(boundaryTick, _machine.Observables(), events);
            _nextBoundaryTick = boundaryTick + 1;
        }
        _render(_machine.Snapshot(), nowUs);
        _lastUs = nowUs;
    }
}
