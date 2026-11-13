using System;
using System.Collections.Generic;
using Minivac.Core;

namespace Minivac.Godot;

public sealed record SessionDemo(string Id, IReadOnlyList<Command> Commands);

/// <summary>Frozen and Locked are set only by <see cref="Session.Adopt"/>.</summary>
public sealed record SessionContext(string DemoId, string ProfileId, bool Frozen = false, bool Locked = false);

/// <summary>
/// Demo is what a later reset or profile switch replays on a fresh machine; it is never replayed
/// onto the adopted one.
/// </summary>
public sealed record AdoptContext(SessionDemo Demo, string ProfileId, bool Frozen, bool Locked);

public sealed class Session : IDisposable
{
    public const string DEFAULT_PROFILE_ID = "MV601-REF-A";

    private readonly Func<string, Machine> _createMachine;
    private readonly Func<Machine, SessionContext, Action> _mount;
    private readonly TraceView? _traceView;
    private SessionDemo? _loadedDemo;
    private Machine? _mountedMachine;
    private Action? _unmount;
    private string _profileId;
    private bool _frozen;
    private bool _locked;
    private bool _disposed;

    public Session(
        Func<string, Machine> createMachine,
        Func<Machine, SessionContext, Action> mount,
        string profileId = DEFAULT_PROFILE_ID)
    {
        _createMachine = createMachine ?? throw new ArgumentNullException(nameof(createMachine));
        _mount = mount ?? throw new ArgumentNullException(nameof(mount));
        _profileId = profileId;
    }

    public Session(
        Func<string, Machine> createMachine,
        Loop loop,
        TraceView traceView,
        Action<int, int[], IReadOnlyList<Event>>? sample = null,
        Action<State, long>? render = null,
        string profileId = DEFAULT_PROFILE_ID)
        : this(createMachine, CreateLoopMount(loop, traceView, sample, render), profileId)
    {
        _traceView = traceView;
    }

    public Machine? CurrentMachine => _mountedMachine;
    public string? DemoId => _loadedDemo?.Id;
    public string ProfileId => _profileId;
    public bool Frozen => _frozen;
    public bool Locked => _locked;
    /// <summary>Commands that reached <see cref="Apply"/> while locked; each was refused unapplied.</summary>
    public int RefusedWhileLocked { get; private set; }

    public void LoadDemo(SessionDemo demo)
    {
        RequireLive();
        ArgumentNullException.ThrowIfNull(demo);
        Replace(demo, _profileId);
    }

    public void LoadDemo(Demo demo)
    {
        ArgumentNullException.ThrowIfNull(demo);
        LoadDemo(demo.SessionDemo);
    }

    /// <summary>
    /// Mount a machine the caller built and keeps driving: no replay, no tick, no drain. A mount
    /// failure remounts the previous machine as it was, as <see cref="Replace"/> does, and rethrows.
    /// </summary>
    public void Adopt(Machine machine, AdoptContext context)
    {
        RequireLive();
        ArgumentNullException.ThrowIfNull(machine);
        ArgumentNullException.ThrowIfNull(context);
        DisposeMount();
        try
        {
            _unmount = _mount(machine, new SessionContext(context.Demo.Id, context.ProfileId, context.Frozen, context.Locked));
        }
        catch
        {
            if (_mountedMachine is not null && _loadedDemo is not null)
                _unmount = _mount(_mountedMachine, new SessionContext(_loadedDemo.Id, _profileId, _frozen, _locked));
            throw;
        }
        _mountedMachine = machine;
        _loadedDemo = context.Demo;
        _profileId = context.ProfileId;
        _frozen = context.Frozen;
        _locked = context.Locked;
    }

    public void Reset()
    {
        RequireLive();
        if (_loadedDemo is null) throw new InvalidOperationException("session: no demo loaded");
        Replace(_loadedDemo, _profileId);
    }

    public void SwitchProfile(string profileId)
    {
        RequireLive();
        if (_loadedDemo is null) throw new InvalidOperationException("session: no demo loaded");
        Replace(_loadedDemo, profileId);
    }

    public CmdResult Apply(Command command)
    {
        RequireLive();
        if (_mountedMachine is null) throw new InvalidOperationException("session: no demo loaded");
        // The one choke point: a locked machine belongs to its owner. The panel's input paths stop
        // before here, so reaching it is a bug, and it is refused loudly rather than reported as a
        // contract rejection.
        if (_locked)
        {
            RefusedWhileLocked++;
            throw new InvalidOperationException("session: locked, command " + command.k + " refused");
        }
        var acceptedState = _mountedMachine.Snapshot();
        var result = _mountedMachine.Apply(command);
        if (!result.ok) return result;
        _traceView?.Command(CommandTraceTick(acceptedState, command), command);
        return result;
    }

    public static int CommandTraceTick(State state, Command command) =>
        command is Command.Power { on: true } && !state.power ? 0 : state.tick;

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        DisposeMount();
        _mountedMachine = null;
    }

    private void Replace(SessionDemo demo, string nextProfileId)
    {
        var machine = _createMachine(nextProfileId);
        for (var index = 0; index < demo.Commands.Count; index++)
        {
            var result = machine.Apply(demo.Commands[index]);
            if (result is CmdResult.Failure failure)
            {
                throw new InvalidOperationException(
                    "session: demo " + demo.Id + " command " + index + " rejected: " + failure.why);
            }
            if (!result.ok)
                throw new InvalidOperationException("session: demo " + demo.Id + " command " + index + " rejected");
        }
        machine.Advance(1);
        machine.DrainEvents();

        var previousMachine = _mountedMachine;
        var previousDemo = _loadedDemo;
        var previousProfileId = _profileId;
        var previousFrozen = _frozen;
        var previousLocked = _locked;
        DisposeMount();
        Action nextUnmount;
        try
        {
            nextUnmount = _mount(machine, new SessionContext(demo.Id, nextProfileId));
        }
        catch
        {
            if (previousMachine is not null && previousDemo is not null)
            {
                _unmount = _mount(
                    previousMachine,
                    new SessionContext(previousDemo.Id, previousProfileId, previousFrozen, previousLocked));
            }
            throw;
        }
        _unmount = nextUnmount;
        _mountedMachine = machine;
        _loadedDemo = demo;
        _profileId = nextProfileId;
        _frozen = false;
        _locked = false;
    }

    private static Func<Machine, SessionContext, Action> CreateLoopMount(
        Loop loop,
        TraceView traceView,
        Action<int, int[], IReadOnlyList<Event>>? sample,
        Action<State, long>? render)
    {
        ArgumentNullException.ThrowIfNull(loop);
        ArgumentNullException.ThrowIfNull(traceView);
        return (machine, context) =>
        {
            traceView.Reset(machine.Observables());
            FrameLoop? mounted = null;
            mounted = new FrameLoop(
                machine,
                (tick, observables, events) =>
                {
                    traceView.Frame(tick, observables, events);
                    sample?.Invoke(tick, observables, events);
                },
                (state, nowUs) =>
                {
                    traceView.Flush();
                    render?.Invoke(state, nowUs);
                },
                context.Frozen);
            loop.Current = mounted;
            return () =>
            {
                if (ReferenceEquals(loop.Current, mounted)) loop.Current = null;
            };
        };
    }

    private void DisposeMount()
    {
        var active = _unmount;
        _unmount = null;
        active?.Invoke();
    }

    private void RequireLive()
    {
        if (_disposed) throw new InvalidOperationException("session: disposed");
    }
}
