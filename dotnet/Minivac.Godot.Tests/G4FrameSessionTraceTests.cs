using System;
using System.Collections.Generic;
using System.Text.Encodings.Web;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Minivac.Conformance;
using Minivac.Core;
using Xunit;

namespace Minivac.Godot.Tests;

public sealed class G4FrameSessionTraceTests
{
    private static readonly IReadOnlyDictionary<string, string> DemoWireHashes =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["IV-EXP1"] = "ae1e587f3abf52b7ab4bd6b2b2b4a6368cd67cbb2efbbb38df0aecb9fb4b29ff",
            ["ER-ALTCOUNTER"] = "62b27eb7819a8206f99bbf8de77e0c4cdc437f3e5e2e27009cc0275aa5acd034",
            ["VI-TICTACTOE"] = "e5ab782ae2232e1062ac4c8e58579349cb1efe87e151e5dbf685ff193b7afb72",
            ["V-JOBSELECT"] = "7189d1344ab2130cafea7b9330a1866a99ba77fdd9bf04869bf32c3ba6670bf1",
            ["VI-RANDOM"] = "4327040d7249289efbb3d413f38246400a9ad6a9565a3332ecbf6999a7833c2c",
            ["III-RELAYAND"] = "753465e23503cd579d457c25c2457fbccb7879a1a872ba3db175360cc655820c",
            ["III-RELAYOR"] = "184819a892f1155a0d95bf38a3c35321083557c7194a93905dfcbd5ee05d58e4",
            ["III-RELAYNOT"] = "9f7509fc70205dbbd4f20796752e0343c521eb1de100d8d13f7e0c7247a16bed",
            ["III-RELAYXOR"] = "d1ead981ef5b9a6e860c5c6d46aa9ff618054f05a30da05e70aaa9d2b752560e",
            ["V-EXP2"] = "400aeae966ca406c18b00fe466049a6e0060a8f3640a1f04ec2a0227cb214bb4",
            ["IV-FF2"] = "3a3657827b5e2fb5b99fb48795f45a8ed22bf6cbe204fed692745b5ee986f024",
            ["V-EXP4"] = "a84ebfe0e20f9bd1a28775fd859935ff35d962f604282a85bbda54e91027218c",
            ["VI-SPS"] = "f0bf59b28541a7d41051ab8fe9b1b93d537ca882ca580dbb84999a5dfdf60f23",
            ["VI-COMBOLOCK"] = "28f80c8ee5383cca7f4482395054373c909b2e7bf3280ef4de82d1b820a8d5df",
            ["V-EXP19"] = "49bc3c47624636ac78094ce80e11ee768ed7af29f6a2fca2fed1278f30e376e6",
            ["VI-REACTION"] = "69bff6ebda92f9abb9603f5b8d91395949589a9fab86bb5f998ff5f02f7dd08a",
            ["IV-EXP4"] = "468862a16a5694ba0fdec6151d0be9064609bd402c3f9416d35c5cb227f48a6b",
        };

    private static readonly IReadOnlyDictionary<string, string> DemoFixtures =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["IV-EXP1"] = "conformance/fixtures/B/IV-EXP1-FAST.fixture.json",
            ["ER-ALTCOUNTER"] = "conformance/fixtures/B/ER-ALTCOUNTER.fixture.json",
            ["III-RELAYAND"] = "conformance/fixtures/A/III-RELAYAND.fixture.json",
            ["III-RELAYOR"] = "conformance/fixtures/A/III-RELAYOR.fixture.json",
            ["III-RELAYNOT"] = "conformance/fixtures/A/III-RELAYNOT.fixture.json",
            ["III-RELAYXOR"] = "conformance/fixtures/A/III-RELAYXOR.fixture.json",
            ["IV-FF2"] = "conformance/fixtures/B/IV-FF2.fixture.json",
            ["V-EXP4"] = "conformance/fixtures/C2/V-EXP4.fixture.json",
            ["VI-SPS"] = "conformance/fixtures/A/VI-SPS.fixture.json",
            ["VI-COMBOLOCK"] = "conformance/fixtures/C1/VI-COMBOLOCK.fixture.json",
            ["V-EXP19"] = "conformance/fixtures/C1/V-EXP19.fixture.json",
            ["VI-REACTION"] = "conformance/fixtures/C2/VI-REACTION.fixture.json",
            ["IV-EXP4"] = "conformance/fixtures/A/IV-EXP4.fixture.json",
        };

    [Fact]
    public void Frame_loop_preserves_the_quoted_cap_carry_timestamps_and_counts()
    {
        var machine = new FakeMachine();
        var samples = new List<int>();
        var renders = new List<(int Tick, long NowUs)>();
        var loop = new FrameLoop(
            machine,
            (tick, _, _) => samples.Add(tick),
            (state, nowUs) => renders.Add((state.tick, nowUs)));

        long[] times = [0, 62, 125, 100_125, 100_187, 100_250];
        foreach (var nowUs in times) loop.Frame(nowUs);

        Assert.Equal([0, 0, 1, 501, 501, 502], renders.Select(row => row.Tick));
        Assert.Equal(times, renders.Select(row => row.NowUs));
        Assert.Equal(Enumerable.Range(0, 502), samples);
        Assert.Equal(502, machine.AdvanceCalls);
        Assert.Equal(502, machine.DrainCalls);
    }

    [Fact]
    public void Frame_loop_rejects_mixed_timestamps_from_one_tick_drain()
    {
        var machine = new FakeMachine(tick =>
            tick == 1 ? [new Event.PowerOn(0), new Event.PowerOff(1)] : []);
        var loop = new FrameLoop(machine, (_, _, _) => { }, (_, _) => { });

        loop.Frame(0);
        var error = Assert.Throws<InvalidOperationException>(() => loop.Frame(100));

        Assert.Equal("ui loop: one-tick drain had mixed timestamps", error.Message);
        Assert.Equal(1, machine.DrainCalls);
    }

    [Fact]
    public void Five_hundred_tick_frame_samples_and_drains_before_its_single_render()
    {
        var machine = new FakeMachine(tick => [new Event.PowerOn(tick - 1)]);
        var order = new List<string>();
        var loop = new FrameLoop(
            machine,
            (tick, _, events) => order.Add("sample:" + tick + ":" + events[0].t),
            (state, _) => order.Add("render:" + state.tick));
        loop.Frame(0);
        order.Clear();

        loop.Frame(50_000);

        Assert.Equal(501, order.Count);
        Assert.Equal("sample:0:0", order[0]);
        Assert.Equal("sample:499:499", order[499]);
        Assert.Equal("render:500", order[500]);
        Assert.Equal(500, machine.DrainCalls);
    }

    [Fact]
    public void MM_RLY_CHECK_frame_trace_matches_TraceRunner_tick_for_tick_and_byte_for_byte()
    {
        var source = new FileSystemSource(RepoRoot());
        var loaded = FixtureLoader.LoadFixture(
            source,
            "conformance/fixtures/A/MM-RLY-CHECK.fixture.json");
        ScriptStep[] script =
        [
            new ScriptStep.Do(new Command.Power(true)),
            new ScriptStep.Advance(50),
        ];
        var expected = TraceRunner.RunLoadedFixture(loaded with
        {
            fixture = loaded.fixture with { script = script },
        }).trace;

        var machine = Machine.CreateMachine(loaded.netlist, loaded.profile);
        foreach (var cord in loaded.cords)
        {
            Assert.True(machine.Apply(new Command.Connect(
                cord.wireIndex,
                new CordEnd.Hole(cord.a.id),
                new CordEnd.Hole(cord.b.id))).ok);
        }
        var previous = (int[])machine.Observables().Clone();
        var actualLines = new List<string>();
        var power = new Command.Power(true);
        Assert.True(machine.Apply(power).ok);
        actualLines.Add(Trace.formatCommand(machine.Snapshot().tick, power));
        var samples = 0;
        var drains = 0;
        var loop = new FrameLoop(
            machine,
            (tick, observables, events) =>
            {
                samples++;
                drains++;
                var transition = Trace.formatTransitions(tick, previous, observables);
                if (transition is not null) actualLines.Add(transition);
                foreach (var item in events)
                {
                    if (item is Event.Chatter chatter)
                    {
                        actualLines.Add(Trace.formatAnomaly(chatter.t, new TraceAnomaly.Chatter(
                            chatter.dev,
                            chatter.transitions,
                            chatter.windowTicks,
                            chatter.quietTicks)));
                    }
                }
                Array.Copy(observables, previous, previous.Length);
            },
            (_, _) => { });
        loop.Frame(0);
        loop.Frame(50_000);

        var expectedBody = string.Join('\n', expected.Split('\n').Skip(4));
        Assert.Equal(expectedBody, Trace.formatTrace(actualLines));
        Assert.Equal(500, samples);
        Assert.Equal(500, drains);
    }

    [Fact]
    public void Seventeen_library_records_and_blank_mount_fresh_tick_one_machines_with_exact_cord_counts()
    {
        var assets = ProductionAssets();
        Assert.Equal(17, assets.Library.Demos.Count);
        Assert.Equal(
            [
                ("IV-EXP1", 44), ("ER-ALTCOUNTER", 48), ("VI-TICTACTOE", 72),
                ("V-JOBSELECT", 30), ("VI-RANDOM", 40), ("III-RELAYAND", 10),
                ("III-RELAYOR", 11), ("III-RELAYNOT", 6), ("III-RELAYXOR", 11),
                ("V-EXP2", 16), ("IV-FF2", 14), ("V-EXP4", 22),
                ("VI-SPS", 41), ("VI-COMBOLOCK", 46), ("V-EXP19", 49),
                ("VI-REACTION", 51), ("IV-EXP4", 8),
            ],
            assets.Library.Demos.Select(demo => (demo.Id, demo.Connections.Count)));
        var machines = new List<Machine>();
        var mounted = new List<(string Id, int Tick, int Cords)>();
        using var session = new Session(
            profileId =>
            {
                var machine = CreateProductionMachine(assets.Source, assets.Netlist, profileId);
                machines.Add(machine);
                return machine;
            },
            (machine, context) =>
            {
                var state = machine.Snapshot();
                mounted.Add((context.DemoId, state.tick, state.cords.Length));
                Assert.Empty(machine.DrainEvents());
                return () => { };
            });

        foreach (var demo in assets.Library.Demos) session.LoadDemo(demo);
        session.LoadDemo(DemoLibrary.MANUAL);

        Assert.Equal(18, machines.Count);
        Assert.Equal(
            assets.Library.Demos.Select(demo => (demo.Id, Tick: 1, Cords: demo.Connections.Count))
                .Append(("MANUAL", 1, 0)),
            mounted);
        Assert.Equal(18, new HashSet<Machine>(machines, ReferenceEqualityComparer.Instance).Count);
    }

    [Fact]
    public void Reset_and_profile_switch_replace_the_machine_and_leave_one_live_mount()
    {
        var assets = ProductionAssets();
        var machines = new List<Machine>();
        var loops = new List<FrameLoop>();
        var live = 0;
        var maxLive = 0;
        using var session = new Session(
            profileId =>
            {
                var machine = CreateProductionMachine(assets.Source, assets.Netlist, profileId);
                machines.Add(machine);
                return machine;
            },
            (machine, _) =>
            {
                live++;
                maxLive = Math.Max(maxLive, live);
                loops.Add(new FrameLoop(machine, (_, _, _) => { }, (_, _) => { }));
                var disposed = false;
                return () =>
                {
                    Assert.False(disposed);
                    disposed = true;
                    live--;
                };
            });

        session.LoadDemo(assets.Library.Get("III-RELAYAND"));
        var first = session.CurrentMachine;
        session.Reset();
        var second = session.CurrentMachine;
        session.SwitchProfile("MV601-IDEAL");

        Assert.Equal(3, machines.Count);
        Assert.Equal(3, loops.Count);
        Assert.Equal(3, new HashSet<FrameLoop>(loops, ReferenceEqualityComparer.Instance).Count);
        Assert.NotSame(first, second);
        Assert.NotSame(second, session.CurrentMachine);
        Assert.Equal("III-RELAYAND", session.DemoId);
        Assert.Equal("MV601-IDEAL", session.ProfileId);
        Assert.Equal(1, session.CurrentMachine!.Snapshot().tick);
        Assert.Empty(session.CurrentMachine.DrainEvents());
        Assert.Equal(1, live);
        Assert.Equal(1, maxLive);
    }

    [Fact]
    public void Failed_replacement_mount_remounts_the_previous_machine_and_selection()
    {
        var assets = ProductionAssets();
        var machines = new List<Machine>();
        var mounts = new List<(Machine Machine, SessionContext Context)>();
        var failSecond = true;
        using var session = new Session(
            profileId =>
            {
                var machine = CreateProductionMachine(assets.Source, assets.Netlist, profileId);
                machines.Add(machine);
                return machine;
            },
            (machine, context) =>
            {
                mounts.Add((machine, context));
                if (machines.Count == 2 && ReferenceEquals(machine, machines[1]) && failSecond)
                {
                    failSecond = false;
                    throw new InvalidOperationException("test mount failed");
                }
                return () => { };
            });
        var good = assets.Library.Get("III-RELAYAND");
        session.LoadDemo(good);
        var original = session.CurrentMachine;

        Assert.Throws<InvalidOperationException>(() =>
            session.LoadDemo(assets.Library.Get("III-RELAYOR")));

        Assert.Same(original, session.CurrentMachine);
        Assert.Equal("III-RELAYAND", session.DemoId);
        Assert.Equal(Session.DEFAULT_PROFILE_ID, session.ProfileId);
        Assert.Equal(
            ["III-RELAYAND", "III-RELAYOR", "III-RELAYAND"],
            mounts.Select(row => row.Context.DemoId));
        Assert.Same(machines[0], mounts[2].Machine);
        session.Reset();
        Assert.NotSame(original, session.CurrentMachine);
        Assert.Equal(1, session.CurrentMachine!.Snapshot().tick);
    }

    [Fact]
    public void Loading_the_same_real_demo_twice_replays_identical_state_events_and_trace()
    {
        var assets = ProductionAssets();
        using var session = new Session(
            profileId => CreateProductionMachine(assets.Source, assets.Netlist, profileId),
            (_, _) => () => { });
        var demo = assets.Library.Get("III-RELAYAND");

        var first = Replay(session, demo);
        var second = Replay(session, demo);

        Assert.Equivalent(first.State, second.State, strict: true);
        Assert.Equivalent(first.Events, second.Events, strict: true);
        Assert.Equal(first.Trace, second.Trace);
    }

    [Fact]
    public void Demo_library_matches_independent_source_and_fixture_pins()
    {
        var assets = ProductionAssets();
        Assert.Equal(DemoWireHashes.Keys, assets.Library.Demos.Select(demo => demo.Id));
        foreach (var demo in assets.Library.Demos)
        {
            var wires = demo.Connections.Select(connection => connection.Wire).ToArray();
            var wireJson = JsonSerializer.Serialize(wires, new JsonSerializerOptions
            {
                Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
            });
            var wireHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(wireJson)))
                .ToLowerInvariant();
            Assert.Equal(DemoWireHashes[demo.Id], wireHash);

            var expectedConnections = DemoFixtures.TryGetValue(demo.Id, out var fixturePath)
                ? FixtureConnections(assets.Source, fixturePath)
                : IndependentlyAllocate(wires);
            Assert.Equivalent(expectedConnections, demo.Connections, strict: true);

            var expectedCommands = ExpectedCommands(expectedConnections, demo.Initial);
            Assert.Equal(
                expectedCommands.Select(command => Trace.formatCommand(0, command)),
                demo.Commands.Select(command => Trace.formatCommand(0, command)));
        }
    }

    private static string RepoRoot()
    {
        return Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "../../../../.."));
    }

    private static (IArtifactSource Source, LoadedNetlist Netlist, DemoLibrary Library) ProductionAssets()
    {
        IArtifactSource source = new FileSystemSource(RepoRoot());
        var netlist = Netlist.LoadNetlist(source.ReadAllBytes("data/netlist.json"));
        return (source, netlist, DemoLibrary.Load(source, netlist));
    }

    private static Machine CreateProductionMachine(
        IArtifactSource source,
        LoadedNetlist netlist,
        string profileId)
    {
        using var document = JsonDocument.Parse(source.ReadAllBytes("data/profiles/" + profileId + ".json"));
        var profile = Profile.LoadProfile(document.RootElement);
        return Machine.CreateMachine(netlist, profile);
    }

    private static ReplayResult Replay(Session session, Demo demo)
    {
        session.LoadDemo(demo);
        var machine = session.CurrentMachine!;
        var previous = (int[])machine.Observables().Clone();
        var lines = new List<string>();
        var events = new List<Event>();
        var loop = new FrameLoop(
            machine,
            (tick, observables, drained) =>
            {
                var transition = Trace.formatTransitions(tick, previous, observables);
                if (transition is not null) lines.Add(transition);
                foreach (var item in drained)
                {
                    events.Add(item);
                    if (item is Event.Chatter chatter)
                    {
                        lines.Add(Trace.formatAnomaly(chatter.t, new TraceAnomaly.Chatter(
                            chatter.dev,
                            chatter.transitions,
                            chatter.windowTicks,
                            chatter.quietTicks)));
                    }
                }
                Array.Copy(observables, previous, previous.Length);
            },
            (_, _) => { });
        long nowUs = 0;
        loop.Frame(nowUs);
        Command[] actions =
        [
            new Command.Power(true),
            new Command.Button(1, 1000),
            new Command.Button(2, 1000),
            new Command.Button(1, 0),
            new Command.Button(2, 0),
        ];
        foreach (var action in actions)
        {
            var before = machine.Snapshot();
            Assert.True(session.Apply(action).ok);
            lines.Add(Trace.formatCommand(Session.CommandTraceTick(before, action), action));
            nowUs += 50_000;
            loop.Frame(nowUs);
        }
        return new ReplayResult(machine.Snapshot(), events.ToArray(), Trace.formatTrace(lines));
    }

    private sealed record ReplayResult(State State, Event[] Events, string Trace);

    private static IReadOnlyList<DemoConnection> FixtureConnections(
        IArtifactSource source,
        string fixturePath)
    {
        var loaded = FixtureLoader.LoadFixture(source, fixturePath);
        Assert.Equal(loaded.wires.Count, loaded.cords.Count);
        var result = new DemoConnection[loaded.wires.Count];
        for (var index = 0; index < result.Length; index++)
        {
            var wire = loaded.wires[index];
            var cord = loaded.cords[index];
            Assert.Equal(index, cord.wireIndex);
            result[index] = new DemoConnection(
                wire.a + "/" + wire.b,
                new CordEnd.Hole(cord.a.id),
                new CordEnd.Hole(cord.b.id),
                null);
        }
        return result;
    }

    private static IReadOnlyList<DemoConnection> IndependentlyAllocate(IReadOnlyList<string> wires)
    {
        var ends = wires.Select(wire =>
        {
            var slash = wire.IndexOf('/', StringComparison.Ordinal);
            Assert.True(slash > 0 && slash == wire.LastIndexOf('/') && slash < wire.Length - 1);
            return (A: PinEnd.Parse(wire[..slash]), B: PinEnd.Parse(wire[(slash + 1)..]));
        }).ToArray();
        var occupied = new bool[Terminals.HOLE_COUNT];
        foreach (var pair in ends)
        {
            Reserve(pair.A, occupied);
            Reserve(pair.B, occupied);
        }
        var result = new DemoConnection[wires.Count];
        for (var index = 0; index < result.Length; index++)
        {
            result[index] = new DemoConnection(
                wires[index],
                Allocate(ends[index].A, occupied),
                Allocate(ends[index].B, occupied),
                null);
        }
        return result;
    }

    private static void Reserve(PinEnd end, bool[] occupied)
    {
        if (end is PinEnd.Hole hole)
        {
            Assert.False(occupied[hole.Value.index]);
            occupied[hole.Value.index] = true;
        }
    }

    private static CordEnd Allocate(PinEnd end, bool[] occupied)
    {
        if (end is PinEnd.Free) return new CordEnd.Free();
        if (end is PinEnd.Hole exact) return new CordEnd.Hole(exact.Value.id);
        var terminal = ((PinEnd.Terminal)end).Value;
        var definition = Terminals.terminalAt(Terminals.terminalIndex(terminal));
        for (var number = 1; number <= definition.holes; number++)
        {
            var hole = Terminals.holeAt(terminal, number);
            if (occupied[hole.index]) continue;
            occupied[hole.index] = true;
            return new CordEnd.Hole(hole.id);
        }
        throw new InvalidOperationException("test pin exhausted terminal " + terminal);
    }

    private static IReadOnlyList<Command> ExpectedCommands(
        IReadOnlyList<DemoConnection> connections,
        DemoInitial initial)
    {
        var result = new List<Command>(connections.Count + 20);
        for (var index = 0; index < connections.Count; index++)
        {
            var connection = connections[index];
            result.Add(new Command.Connect(index, connection.A, connection.B, connection.ResistanceUohm));
        }
        for (var index = 0; index < 6; index++)
            result.Add(new Command.Switch(index + 1, initial.Switches[index]));
        for (var index = 0; index < 6; index++)
            result.Add(new Command.Button(index + 1, initial.Buttons[index]));
        for (var index = 0; index < 6; index++)
        {
            result.Add(initial.RelayHands[index] is int target
                ? new Command.RelayGrab(index + 1, target)
                : new Command.RelayRelease(index + 1));
        }
        result.Add(initial.DialHand is long dial
            ? new Command.DialGrab(dial)
            : new Command.DialRelease());
        result.Add(new Command.Power(initial.Power));
        return result;
    }

    private abstract record PinEnd
    {
        internal static PinEnd Parse(string text)
        {
            if (text == "free") return new Free();
            return text.Contains('#', StringComparison.Ordinal)
                ? new Hole(Terminals.parseHoleId(text))
                : new Terminal(Terminals.parseTerminalId(text));
        }

        internal sealed record Free : PinEnd;
        internal sealed record Terminal(string Value) : PinEnd;
        internal sealed record Hole(HoleRef Value) : PinEnd;
    }

    private sealed class FakeMachine : Machine
    {
        private readonly Func<int, Event[]> _events;
        private readonly List<State.Cord> _cords = [];
        private int _tick;

        internal FakeMachine(Func<int, Event[]>? events = null) => _events = events ?? (_ => []);

        internal int AdvanceCalls { get; private set; }
        internal int DrainCalls { get; private set; }

        public CmdResult Apply(Command command)
        {
            if (command is Command.Connect connect)
                _cords.Add(new State.Cord(connect.cord, connect.a, connect.b, connect.r_uohm ?? 0));
            return new CmdResult.Success();
        }

        public void Advance(int ticks)
        {
            Assert.Equal(1, ticks);
            AdvanceCalls++;
            _tick++;
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
            _cords.ToArray(),
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
            DrainCalls++;
            return _events(_tick);
        }
    }
}
