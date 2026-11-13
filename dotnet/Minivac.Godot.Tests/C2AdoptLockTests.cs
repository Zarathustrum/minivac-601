using System;
using System.Collections.Generic;
using Minivac.Core;
using Xunit;

namespace Minivac.Godot.Tests;

// C2: Session.Adopt and the frozen frame loop (docs/plans/godot-chat-pane.md, "The lock").
public sealed class C2AdoptLockTests
{
    [Fact]
    public void Frozen_frame_loop_renders_every_frame_and_never_advances_drains_or_samples()
    {
        var machine = new CountingMachine();
        var samples = 0;
        var renders = new List<long>();
        var loop = new FrameLoop(machine, (_, _, _) => samples++, (_, nowUs) => renders.Add(nowUs), frozen: true);

        foreach (var nowUs in new long[] { 0, 100_000, 5_000_000 }) loop.Frame(nowUs);

        Assert.True(loop.Frozen);
        Assert.Equal([0, 100_000, 5_000_000], renders);
        Assert.Equal(0, samples);
        Assert.Equal(0, machine.Mutations);
    }

    [Fact]
    public void Adopt_mounts_the_given_machine_with_no_replay_tick_or_drain_and_carries_the_flags()
    {
        var created = 0;
        var mounts = new List<(Machine Machine, SessionContext Context)>();
        using var session = new Session(_ => { created++; return new CountingMachine(); }, (machine, context) =>
        {
            mounts.Add((machine, context));
            return () => { };
        });
        var owned = new CountingMachine();

        session.Adopt(owned, new AdoptContext(DemoLibrary.MANUAL, "MV601-IDEAL", Frozen: true, Locked: true));

        Assert.Equal(0, created);
        Assert.Equal(0, owned.Mutations);
        Assert.Same(owned, session.CurrentMachine);
        Assert.Equal(new SessionContext("MANUAL", "MV601-IDEAL", true, true), Assert.Single(mounts).Context);
        Assert.True(session.Frozen);
        Assert.True(session.Locked);
        Assert.Equal("MANUAL", session.DemoId);
        Assert.Equal("MV601-IDEAL", session.ProfileId);
    }

    [Fact]
    public void A_locked_session_refuses_every_command_before_the_machine()
    {
        using var session = new Session(_ => new CountingMachine(), (_, _) => () => { });
        var owned = new CountingMachine();
        session.Adopt(owned, new AdoptContext(DemoLibrary.MANUAL, Session.DEFAULT_PROFILE_ID, true, true));

        Assert.Throws<InvalidOperationException>(() => session.Apply(new Command.Power(true)));
        Assert.Throws<InvalidOperationException>(() => session.Apply(new Command.Button(1, 1000)));

        Assert.Equal(0, owned.Mutations);
        Assert.Equal(2, session.RefusedWhileLocked);
    }

    [Fact]
    public void Adopting_again_remounts_the_same_machine_and_leaves_one_live_mount()
    {
        var live = 0;
        var maxLive = 0;
        var mounted = new List<Machine>();
        using var session = new Session(_ => new CountingMachine(), (machine, _) =>
        {
            mounted.Add(machine);
            maxLive = Math.Max(maxLive, ++live);
            return () => live--;
        });
        var owned = new CountingMachine();
        var context = new AdoptContext(DemoLibrary.MANUAL, Session.DEFAULT_PROFILE_ID, true, true);

        session.Adopt(owned, context);
        session.Adopt(owned, context);
        session.Adopt(owned, context);

        Assert.Equal([owned, owned, owned], mounted);
        Assert.Equal(1, live);
        Assert.Equal(1, maxLive);
        Assert.Equal(0, owned.Mutations);
    }

    [Fact]
    public void Release_hands_the_same_machine_back_live_and_reset_then_builds_a_fresh_blank_panel()
    {
        var created = new List<CountingMachine>();
        var contexts = new List<SessionContext>();
        using var session = new Session(
            _ =>
            {
                var machine = new CountingMachine();
                created.Add(machine);
                return machine;
            },
            (_, context) =>
            {
                contexts.Add(context);
                return () => { };
            });
        session.LoadDemo(DemoLibrary.MANUAL);
        var owned = new CountingMachine();
        session.Adopt(owned, new AdoptContext(DemoLibrary.MANUAL, Session.DEFAULT_PROFILE_ID, true, true));

        session.Adopt(owned, new AdoptContext(DemoLibrary.MANUAL, session.ProfileId, false, false));
        Assert.Same(owned, session.CurrentMachine);
        Assert.False(session.Locked);
        Assert.False(session.Frozen);
        Assert.True(session.Apply(new Command.Power(true)).ok);
        Assert.Equal(1, owned.Applies);

        session.Reset();
        Assert.Equal(2, created.Count);
        Assert.Same(created[1], session.CurrentMachine);
        Assert.Equal("MANUAL", session.DemoId);
        Assert.False(contexts[^1].Frozen);
        Assert.False(contexts[^1].Locked);
    }

    [Fact]
    public void A_failed_replacement_remounts_an_adopted_machine_still_frozen_and_locked()
    {
        var failNext = false;
        var contexts = new List<(Machine Machine, SessionContext Context)>();
        using var session = new Session(_ => new CountingMachine(), (machine, context) =>
        {
            contexts.Add((machine, context));
            if (failNext)
            {
                failNext = false;
                throw new InvalidOperationException("test mount failed");
            }
            return () => { };
        });
        var owned = new CountingMachine();
        session.Adopt(owned, new AdoptContext(DemoLibrary.MANUAL, Session.DEFAULT_PROFILE_ID, true, true));

        failNext = true;
        Assert.Throws<InvalidOperationException>(() => session.Reset());

        Assert.Same(owned, contexts[^1].Machine);
        Assert.True(contexts[^1].Context.Frozen);
        Assert.True(contexts[^1].Context.Locked);
        Assert.Same(owned, session.CurrentMachine);
        Assert.True(session.Locked);
    }

    [Fact]
    public void A_failed_adopt_remounts_the_live_machine_live_and_unlocked()
    {
        var live = 0;
        var mounts = new List<(Machine Machine, SessionContext Context)>();
        var refused = new CountingMachine();
        using var session = new Session(_ => new CountingMachine(), (machine, context) =>
        {
            mounts.Add((machine, context));
            if (ReferenceEquals(machine, refused)) throw new InvalidOperationException("test mount failed");
            live++;
            return () => live--;
        });
        session.LoadDemo(DemoLibrary.MANUAL);
        var before = session.CurrentMachine;

        Assert.Throws<InvalidOperationException>(() =>
            session.Adopt(refused, new AdoptContext(DemoLibrary.MANUAL, Session.DEFAULT_PROFILE_ID, Frozen: true, Locked: true)));

        Assert.Same(before, session.CurrentMachine);
        Assert.Same(before, mounts[^1].Machine);
        Assert.Equal(new SessionContext("MANUAL", Session.DEFAULT_PROFILE_ID), mounts[^1].Context);
        Assert.Equal(1, live);
        Assert.False(session.Locked);
        Assert.False(session.Frozen);
        Assert.True(session.Apply(new Command.Power(true)).ok);
    }

    private sealed class CountingMachine : Machine
    {
        private int _tick;

        internal int Applies { get; private set; }
        internal int Advances { get; private set; }
        internal int Drains { get; private set; }
        internal int Mutations => Applies + Advances + Drains;

        public CmdResult Apply(Command command)
        {
            Applies++;
            return new CmdResult.Success();
        }

        public void Advance(int ticks)
        {
            Advances++;
            _tick += ticks;
        }

        public State Snapshot() => new(
            Contract.CONTRACT,
            "test-netlist",
            Session.DEFAULT_PROFILE_ID,
            "test-profile",
            _tick,
            false,
            false,
            0,
            0,
            new State.Relay[6],
            new State.Lamp[6],
            new State.Lamp[6],
            new State.Button[6],
            new State.Switch[6],
            new State.Dial(0, null, 0, false),
            [],
            Array.Empty<int?>(),
            Array.Empty<Note>(),
            new State.Flags([], false, false));

        public int[] Observables()
        {
            var values = new int[Trace.OBSERVABLE_COUNT];
            values[20] = -1;
            return values;
        }

        public int MotionMask() => 0;

        public Event[] DrainEvents()
        {
            Drains++;
            return [];
        }
    }
}
