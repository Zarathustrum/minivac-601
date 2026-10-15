using System;
using System.Collections.Generic;
using Godot;
using Minivac.Core;

namespace Minivac.Godot;

public interface IAudioSink
{
    void PlayRelay(RelayCue cue);
    bool SetMotor(MotorCue cue);
    void StopMotor();
    void StopRelayCues();
}

public partial class AudioRouter : Node
{
    private readonly List<Event> _pending = [];
    private AudioSchedule.Cursor _cursor = AudioSchedule.Initial;
    private IAudioSink? _sink;
    private Action<Exception>? _onError;
    private bool _muted;
    private bool _motorStopPending;
    private bool _disposed;

    public IAudioSink Sink => _sink ?? throw new InvalidOperationException("audio router: not initialized");
    public bool Muted => _muted;

    public void Initialize(IAudioSink sink, bool muted = false, Action<Exception>? onError = null)
    {
        ArgumentNullException.ThrowIfNull(sink);
        if (_sink is not null) throw new InvalidOperationException("audio router: already initialized");
        _sink = sink;
        _muted = muted;
        _onError = onError;
        if (sink is GodotAudioSink godotSink)
        {
            AddChild(godotSink.RelayPlayer);
            AddChild(godotSink.MotorPlayer);
            if (IsInsideTree()) Safe(godotSink.Start);
        }
    }

    public override void _Ready()
    {
        if (_sink is GodotAudioSink godotSink) Safe(godotSink.Start);
    }

    public void Sample(IReadOnlyList<Event> events)
    {
        ArgumentNullException.ThrowIfNull(events);
        if (_disposed || _muted) return;
        _pending.AddRange(events);
    }

    public void Frame(State state, long nowUs)
    {
        ArgumentNullException.ThrowIfNull(state);
        if (_disposed) return;
        var sink = Sink;
        if (_motorStopPending)
        {
            if (SafeStopMotor()) _motorStopPending = false;
            else
            {
                _pending.Clear();
                return;
            }
        }
        if (_muted)
        {
            _pending.Clear();
            return;
        }

        var plan = AudioSchedule.Frame(_cursor, state, _pending, nowUs);
        _pending.Clear();
        _cursor = plan.Cursor;
        foreach (var cue in plan.RelayCues) Safe(() => sink.PlayRelay(cue));
        if (sink is GodotAudioSink godotSink) Safe(() => godotSink.Frame(nowUs));

        if (plan.Motor is null) return;
        var applied = false;
        switch (plan.Motor)
        {
            case MotorDirective.Set set:
                applied = Safe(() => sink.SetMotor(set.Cue));
                break;
            case MotorDirective.Stop:
                applied = SafeStopMotor();
                break;
        }
        _cursor = AudioSchedule.ResolveMotor(_cursor, plan.Motor, applied);
    }

    public void SetMuted(bool muted)
    {
        if (_disposed || muted == _muted) return;
        _muted = muted;
        if (muted) ResetRouting();
    }

    public void Reset()
    {
        if (_disposed) return;
        ResetRouting();
    }

    public new void Dispose()
    {
        if (_disposed) return;
        ResetRouting();
        _disposed = true;
        if (_sink is IDisposable disposable) Safe(disposable.Dispose);
    }

    public override void _Notification(int what)
    {
        if (what == NotificationWMCloseRequest) Dispose();
    }

    public override void _ExitTree() => Dispose();

    private void ResetRouting()
    {
        _pending.Clear();
        _cursor = AudioSchedule.Initial;
        if (_sink is null) return;
        Safe(_sink.StopRelayCues);
        _motorStopPending = !SafeStopMotor();
    }

    private bool SafeStopMotor()
    {
        if (_sink is null) return false;
        try
        {
            _sink.StopMotor();
            return true;
        }
        catch (Exception error)
        {
            Report(error);
            return false;
        }
    }

    private bool Safe(Func<bool> action)
    {
        try
        {
            return action();
        }
        catch (Exception error)
        {
            Report(error);
            return false;
        }
    }

    private void Safe(Action action)
    {
        try
        {
            action();
        }
        catch (Exception error)
        {
            Report(error);
        }
    }

    private void Report(Exception error)
    {
        try
        {
            _onError?.Invoke(error);
        }
        catch
        {
            // Audio diagnostics cannot interrupt the simulator.
        }
    }
}
