using System;
using System.Collections.Generic;
using Godot;
using Minivac.Core;

namespace Minivac.Godot;

public partial class TraceView : RichTextLabel
{
    // A session runs unbounded; the view is a scrollback, not the trace record. Dropping the
    // oldest lines past this cap keeps the list and the per-flush reformat bounded instead of
    // growing the frame cost with session length.
    private const int MAX_LINES = 2000;

    private readonly List<string> _lines = [];
    private readonly int[] _previous = new int[Trace.OBSERVABLE_COUNT];
    private bool _initialized;
    private bool _dirty;

    public string TraceText { get; private set; } = "";

    public override void _Ready()
    {
        // FitContent would grow the minimum size with the trace and push past the viewport; the
        // view stays inside its assigned rectangle and scrolls instead.
        FitContent = false;
        ScrollFollowing = true;
        Text = TraceText;
    }

    public void Reset(IReadOnlyList<int> initial)
    {
        ArgumentNullException.ThrowIfNull(initial);
        if (initial.Count != Trace.OBSERVABLE_COUNT)
            throw new ArgumentException("trace view: initial vector must have 33 entries", nameof(initial));
        _lines.Clear();
        CopyObservables(initial);
        _initialized = true;
        _dirty = false;
        TraceText = "";
        if (IsInsideTree()) Text = "";
    }

    public void Command(int tick, Command command)
    {
        RequireInitialized();
        Append(Trace.formatCommand(tick, command));
    }

    public void Frame(int tick, int[] observables, IReadOnlyList<Event> events)
    {
        RequireInitialized();
        ArgumentNullException.ThrowIfNull(observables);
        ArgumentNullException.ThrowIfNull(events);
        var transition = Trace.formatTransitions(tick, _previous, observables);
        if (transition is not null) Append(transition);
        foreach (var item in events)
        {
            if (item is not Event.Chatter chatter) continue;
            Append(Trace.formatAnomaly(chatter.t, new TraceAnomaly.Chatter(
                chatter.dev,
                chatter.transitions,
                chatter.windowTicks,
                chatter.quietTicks)));
        }
        CopyObservables(observables);
    }

    // Reformatting the whole trace every render frame would cost O(lines) per frame; only
    // re-render when a line was actually appended since the last flush.
    public void Flush()
    {
        RequireInitialized();
        if (!_dirty) return;
        _dirty = false;
        TraceText = _lines.Count == 0 ? "" : Trace.formatTrace(_lines);
        if (IsInsideTree()) Text = TraceText;
    }

    private void Append(string line)
    {
        _lines.Add(line);
        if (_lines.Count > MAX_LINES) _lines.RemoveRange(0, _lines.Count - MAX_LINES);
        _dirty = true;
    }

    private void CopyObservables(IReadOnlyList<int> source)
    {
        if (source.Count != _previous.Length)
            throw new ArgumentException("trace view: observable vector must have 33 entries", nameof(source));
        for (var i = 0; i < _previous.Length; i++) _previous[i] = source[i];
    }

    private void RequireInitialized()
    {
        if (!_initialized) throw new InvalidOperationException("trace view: not initialized");
    }
}
