using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Minivac.Core;
using Xunit;
using static Minivac.Hands.Tests.Support;

namespace Minivac.Hands.Tests;

// The xunit port of test/hands/table.spec.ts. Cases that exercise the Node session-file module
// (tools/hands/session-file.ts: readSession's schema validation, writeSessionFile, formatSession)
// keep their replay assertions here; the file I/O itself is not part of the C# port. Each test
// names the TypeScript case it ports.
public sealed class TableTests
{
    private const string Hole = "{\"k\":\"hole\",\"hole\":";

    // 'has one entry per v1 tool and every schema compiles under Ajv strict': the names and their
    // order. The schemas and descriptions are adapter metadata the engine never reads; not ported.
    [Fact]
    public void Has_one_entry_per_v1_tool()
    {
        Assert.Equal(
            ["power", "connect", "disconnect", "button", "press", "switch", "wait", "state",
                "breaker", "relayGrab", "relayRelease", "dialGrab", "dialRelease", "loadProgram"],
            Table.TOOL_NAMES);
    }

    // 'replays a session from its file to an identical machine, twice' (the file is the session's JSON).
    [Fact]
    public void Replays_a_session_to_an_identical_machine_twice()
    {
        var rig = FreshRig();
        Batch(rig, [Connect("1+/1Y"), Connect("1X/2Y"), Connect("2X/2A"), Connect("2B/2-"), PowerOn]);
        Batch(rig, [Button(1, 1000), Wait(50), Button(2, 1000)]);
        // Hole and id reuse: 1+ already has 1+#1 (cord 0); 3A takes 1+#2 as cord 4. Unplug cord 0 and
        // the next 1+ cord must get the freed 1+#1 and the freed id 0.
        var extra = Table.callTool(rig, Connect("1+/3A"));
        Assert.Equal(new CordView(4, "1+#2", "3A#1", "1+/3A"), ((ToolResult.Ok)extra).cord);
        Batch(rig, [Unplug(0)]);
        var reused = Table.callTool(rig, Connect("3B/1+"));
        Assert.Equal(new CordView(0, "3B#1", "1+#1", "3B/1+"), ((ToolResult.Ok)reused).cord);
        Batch(rig, [UnplugPair("1+", "3A"), Connect("1+/1Y"), Slide(3, 1000)]);
        Assert.Equal("on", Observable(rig, "outLamp2"));

        var file = HandsJson.Session(Table.sessionOf(rig, Table.newSession(Net, RefA)));
        var first = Table.replay(Net, RefA, Js.Parse(file));
        var second = Table.replay(Net, RefA, Js.Parse(file));
        Assert.Equal(Snap(rig), Snap(first));
        Assert.Equal(rig.machine.Observables(), first.machine.Observables());
        Assert.Equal(Snap(first), Snap(second));
        Assert.Equal(first.machine.Observables(), second.machine.Observables());
        Assert.Equal(Cords(rig), Cords(first));
    }

    // 'drives I-EXP4 through the table and matches every expect'
    [Fact]
    public void Drives_I_EXP4_through_the_table_and_matches_every_expect()
    {
        var fixture = Fixture("A/I-EXP4");
        var wires = Wires("A/I-EXP4");
        var rig = FreshRig();
        var pending = wires.Select(Connect).ToList();
        var seen = new List<string>();
        foreach (var step in fixture.GetProperty("script").EnumerateArray())
        {
            var kind = step.GetProperty("k").GetString();
            if (kind == "do")
            {
                var cmd = step.GetProperty("cmd");
                var cmdKind = cmd.GetProperty("k").GetString();
                if (cmdKind == "power") pending.Add(Call("power", "{\"on\":" + (cmd.GetProperty("on").GetBoolean() ? "true" : "false") + "}"));
                else if (cmdKind == "button") pending.Add(Button(cmd.GetProperty("n").GetInt32(), cmd.GetProperty("target").GetInt32()));
                else throw new InvalidOperationException("I-EXP4 uses an unexpected command " + cmdKind);
            }
            else if (kind == "settle")
            {
                Batch(rig, pending, step.GetProperty("maxMs").GetInt32());
                pending = [];
            }
            else if (kind == "expect")
            {
                foreach (var expected in step.GetProperty("obs").EnumerateArray())
                {
                    Assert.Equal(expected.GetProperty("v").GetString(), Observable(rig, expected.GetProperty("dev").GetString()!));
                    seen.Add(expected.GetProperty("v").GetString()!);
                }
            }
            else
            {
                throw new InvalidOperationException("I-EXP4 uses an unexpected step " + kind);
            }
        }
        Assert.Equal(["off", "off", "on"], seen);
        // The shorthand path allocates exactly the holes the fixture loader does.
        var loader = Terminals.AllocateHoles(wires.Select(Terminals.parseTerminalWire).ToList());
        for (var i = 0; i < loader.Count; i++)
            Assert.Equal(new CordView(i, loader[i].a.id, loader[i].b.id, wires[i]), rig.cords[i]);
    }

    // 'rejects a connect to a terminal whose holes are exhausted'
    [Fact]
    public void Rejects_a_connect_to_a_terminal_whose_holes_are_exhausted()
    {
        var rig = FreshRig();
        Assert.True(Table.callTool(rig, Connect("1+/1A")).ok);
        Assert.True(Table.callTool(rig, Connect("1+/1B")).ok);
        var third = Failure(Table.callTool(rig, Connect("1C/1+")));
        Assert.Equal("hole_occupied", third.why);
        Assert.Contains("1+", third.detail, StringComparison.Ordinal);
        Assert.Contains("cords 0, 1", third.detail, StringComparison.Ordinal);
    }

    // 'treats a session that reuses an occupied hole as corrupt'
    [Fact]
    public void Treats_a_session_that_reuses_an_occupied_hole_as_corrupt()
    {
        var session = Table.newSession(Net, RefA) with
        {
            script =
            [
                new SessionStep.Do(new Command.Connect(0, new CordEnd.Hole("1A#1"), new CordEnd.Hole("1B#1"))),
                new SessionStep.Do(new Command.Connect(1, new CordEnd.Hole("1A#1"), new CordEnd.Hole("1C#1"))),
            ],
        };
        var error = Assert.Throws<SessionError>(() => Table.replay(Net, RefA, session));
        Assert.Contains("script[1] connect was rejected on replay: hole_occupied", error.Message, StringComparison.Ordinal);
    }

    // 'rejects unknown terminals'
    [Fact]
    public void Rejects_unknown_terminals()
    {
        Assert.Null(Table.parseWire("1+/1Q", out var parsed));
        Assert.Equal("unknown_terminal", parsed!.why);
        Assert.Contains("\"1Q\"", parsed.detail, StringComparison.Ordinal);
        Assert.Null(Table.parseWire("1+1Y", out var joined));
        Assert.Equal("unknown_terminal", joined!.why);
        Assert.Equal("unknown_terminal", Failure(Table.callTool(FreshRig(), Call("connect", "{\"a\":\"Q9\",\"b\":\"1A\"}"))).why);
    }

    // 'rejects unknown cords by id and by terminal pair'
    [Fact]
    public void Rejects_unknown_cords_by_id_and_by_terminal_pair()
    {
        var rig = FreshRig();
        Assert.Equal("unknown_cord", Failure(Table.callTool(rig, Unplug(9))).why);
        Assert.Equal("unknown_cord", Failure(Table.callTool(rig, UnplugPair("1A", "1B"))).why);
    }

    // 'refuses an ambiguous terminal-pair disconnect and names the candidates'
    [Fact]
    public void Refuses_an_ambiguous_terminal_pair_disconnect()
    {
        var rig = FreshRig();
        Table.callTool(rig, Connect("1A/1B"));
        Table.callTool(rig, Connect("1B/1A"));
        var result = Failure(Table.callTool(rig, UnplugPair("1B", "1A")));
        Assert.Equal("ambiguous_cord", result.why);
        Assert.Contains("cords 0, 1", result.detail, StringComparison.Ordinal);
    }

    // 'rejects bad button and switch targets'
    [Fact]
    public void Rejects_bad_button_and_switch_targets()
    {
        var rig = FreshRig();
        Assert.Equal("bad_target", Failure(Table.callTool(rig, Button(1, 1001))).why);
        Assert.Equal("bad_target", Failure(Table.callTool(rig, Button(7, 0))).why);
        Assert.Equal("bad_target", Failure(Table.callTool(rig, Slide(1, -1))).why);
        Assert.Equal("bad_target", Failure(Table.callTool(rig, Wait(0))).why);
        Assert.Empty(rig.log);
    }

    // 'rejects malformed session files': the replay assertions. readSession's schema checks (an
    // extra top-level key, an `expect` step, a lower-case load marker, a missing file) belong to the
    // Node session-file module and are not ported.
    [Fact]
    public void Rejects_malformed_sessions_on_replay()
    {
        var wrongProfile = Table.newSession(Net, RefA) with { profile = "MV601-IDEAL" };
        Assert.Contains("profile", Assert.Throws<SessionError>(() => Table.replay(Net, RefA, wrongProfile)).Message, StringComparison.Ordinal);
        var shortLoad = Table.newSession(Net, RefA) with
        {
            script =
            [
                new SessionStep.Load("I-EXP4", 2),
                new SessionStep.Do(new Command.Connect(0, new CordEnd.Hole("1A#1"), new CordEnd.Hole("1B#1"))),
            ],
        };
        Assert.Contains("script[0] load of I-EXP4 must be followed by its 2 connect steps",
            Assert.Throws<SessionError>(() => Table.replay(Net, RefA, shortLoad)).Message, StringComparison.Ordinal);
        var touch = Table.newSession(Net, RefA) with
        {
            script = [new SessionStep.Do(new Command.Connect(0, new CordEnd.Touch("1A"), new CordEnd.Free()))],
        };
        Assert.Contains("hole to hole", Assert.Throws<SessionError>(() => Table.replay(Net, RefA, touch)).Message, StringComparison.Ordinal);
    }

    // 'reports a batch that does not settle without failing it'
    [Fact]
    public void Reports_a_batch_that_does_not_settle_without_failing_it()
    {
        var rig = Table.createRig(Net, RefA);
        // A relay fed through its own N.C. contact (+ -> 1H arm, 1J N.C. -> 1E coil, 1F -> -) buzzes.
        var outcome = Accepted(Table.runBatch(rig, [Connect("1+/1H"), Connect("1J/1E"), Connect("1F/1-"), PowerOn], 100));
        Assert.False(outcome.settle.settled);
        Assert.Equal(1000, outcome.settle.waitedTicks);
        Assert.Contains("relay1", outcome.settle.moving);
        Assert.Equal("{\"k\":\"settle\",\"maxMs\":100}", HandsJson.Step(rig.log[^1]));
    }

    // 'flags a dial motor that is still turning after a settle'
    [Fact]
    public void Flags_a_dial_motor_that_is_still_turning_after_a_settle()
    {
        var rig = Table.createRig(Net, RefA);
        // RUN: power across D17 and D18 turns the dial motor.
        Batch(rig, [Connect("1+/D17"), Connect("D18/1-"), PowerOn]);
        var outcome = Accepted(Table.runBatch(rig, [Wait(1000)]));
        Assert.True(outcome.settle.dialMrpm > 0);
    }

    // 'names the self-connect case when a terminal has only one free hole'
    [Fact]
    public void Names_the_self_connect_case()
    {
        var rig = FreshRig();
        Assert.True(Table.callTool(rig, Connect("1A/1B")).ok);
        var result = Failure(Table.callTool(rig, Connect("1A/1A")));
        Assert.Equal("hole_occupied", result.why);
        Assert.Contains("connecting 1A to itself needs two free holes on 1A; only one is free", result.detail, StringComparison.Ordinal);
    }

    // 'caps wait and settle at one minute, before simulating anything'
    [Fact]
    public void Caps_wait_and_settle_at_one_minute()
    {
        var rig = FreshRig();
        var wait = Failure(Table.callTool(rig, Wait(60001)));
        Assert.Equal("bad_target", wait.why);
        Assert.Contains("1..60000", wait.detail, StringComparison.Ordinal);
        var outcome = Assert.IsType<BatchRejection>(Table.runBatch(rig, [PowerOn], 60001));
        Assert.Equal(1, outcome.failedAt);
        Assert.Empty(rig.log);
    }

    // 'refuses a wait that would run the tick counter past int32, without advancing'
    [Fact]
    public void Refuses_a_wait_past_the_int32_tick_limit_without_advancing()
    {
        var rig = FreshRig();
        var machine = new Wrapped(rig.machine, tick: int.MaxValue - 100);
        var nearEnd = WithMachine(rig, machine);
        var wait = Failure(Table.callTool(nearEnd, Wait(20)));
        Assert.Contains("int32 tick limit", wait.detail, StringComparison.Ordinal);
        var outcome = Assert.IsType<BatchRejection>(Table.runBatch(nearEnd, [Wait(5)]));
        Assert.Equal(1, outcome.failedAt);
        Assert.Contains("int32 tick limit", outcome.result.detail, StringComparison.Ordinal);
        Assert.Equal(0, machine.Advanced);
    }

    // 'refuses to replay a session recorded against a different netlist or profile'
    [Fact]
    public void Refuses_a_session_recorded_against_a_different_netlist_or_profile()
    {
        var @base = Table.newSession(Net, RefA);
        var netlist = Assert.Throws<SessionError>(() => Table.replay(Net, RefA, @base with { netlistHash = "fnv1a64:0000000000000000" }));
        Assert.Matches("recorded against a different netlist.*start a new session", netlist.Message);
        var profile = Assert.Throws<SessionError>(() => Table.replay(Net, RefA, @base with { profileHash = "fnv1a64:0000000000000000" }));
        Assert.Matches("recorded against a different profile.*start a new session", profile.Message);
    }

    // 'reports a malformed session file as a session error, not a fixture error': readSession's
    // own message for a file that is not JSON; the Node session-file module, not ported.

    // 'shortens a buzzing relay change path to first -> ... -> last with a count'
    [Fact]
    public void Shortens_a_buzzing_relay_change_path()
    {
        var rig = FreshRig();
        var outcome = Accepted(Table.runBatch(rig, [Connect("1+/1H"), Connect("1J/1E"), Connect("1F/1-"), PowerOn]));
        var relay = outcome.changes.Single(change => change.name == "relay1");
        Assert.True(relay.elided);
        Assert.Equal(2, relay.values.Count);
        Assert.Equal("nc", relay.values[0]);
        Assert.True(relay.transitions > 6);
        var power = outcome.changes.Single(change => change.name == "power");
        Assert.Equal(["off", "on"], power.values);
        Assert.Equal(1, power.transitions);
        Assert.False(power.elided);
    }

    // 'flags an I-EXP4 lamp still cooling through dim when settle returns'
    [Fact]
    public void Flags_an_I_EXP4_lamp_still_cooling_when_settle_returns()
    {
        var rig = FreshRig();
        Batch(rig, [Connect("1+/1Y"), Connect("1X/2Y"), Connect("2X/2A"), Connect("2B/2-"), PowerOn, Button(1, 1000), Button(2, 1000)]);
        var steady = Accepted(Table.runBatch(rig, [Wait(500)]));
        Assert.Empty(steady.settle.lampsMoving);
        var release = Accepted(Table.runBatch(rig, [Button(1, 0)]));
        Assert.True(release.settle.settled);
        Assert.Equal("dim", Observable(rig, "outLamp2"));
        Assert.Equal(["outLamp2"], release.settle.lampsMoving);
    }

    private static readonly string[] I_EXP4_WIRES = ["1+/1Y", "1X/2Y", "2X/2A", "2B/2-"];

    // 'presses a pushbutton as a spring-return press: down, held, up, released time; replays identically'
    [Fact]
    public void Presses_a_pushbutton_as_a_spring_return_press()
    {
        var rig = FreshRig();
        Batch(rig, [Connect("1+/1Y"), Connect("1X/1A"), Connect("1B/1-"), PowerOn]);
        var at = rig.log.Count;
        Batch(rig, [Press(1), Press(1, 30)]);
        Assert.Equal(string.Join("\n",
                "{\"k\":\"do\",\"cmd\":{\"k\":\"button\",\"n\":1,\"target\":1000}}", "{\"k\":\"advance\",\"ms\":100}",
                "{\"k\":\"do\",\"cmd\":{\"k\":\"button\",\"n\":1,\"target\":0}}", "{\"k\":\"advance\",\"ms\":100}",
                "{\"k\":\"do\",\"cmd\":{\"k\":\"button\",\"n\":1,\"target\":1000}}", "{\"k\":\"advance\",\"ms\":30}",
                "{\"k\":\"do\",\"cmd\":{\"k\":\"button\",\"n\":1,\"target\":0}}", "{\"k\":\"advance\",\"ms\":30}"),
            Steps(rig.log.Skip(at).Take(8)));
        Assert.Equal("nc", Observable(rig, "pb1"));
        var again = Table.replay(Net, RefA, Table.sessionOf(rig, Table.newSession(Net, RefA)));
        Assert.Equal(Snap(rig), Snap(again));
        Assert.Equal("bad_target", Failure(Table.callTool(rig, Press(7))).why);
        Assert.Equal("bad_target", Failure(Table.callTool(rig, Press(1, 0))).why);
        Assert.False(Table.runBatch(rig, [Press(1, Table.MAX_STEP_MS + 1)]).ok);
    }

    // 'resets a tripped breaker and replays identically'
    [Fact]
    public void Resets_a_tripped_breaker_and_replays_identically()
    {
        var rig = FreshRig();
        Batch(rig, [Connect("1+/1-"), PowerOn]);
        Assert.Equal("tripped", Observable(rig, "breaker"));
        Batch(rig, [Unplug(0), Call("breaker", "{\"reset\":true}")]);
        Assert.Equal("ok", Observable(rig, "breaker"));
        Assert.Equal(["connect", "power", "disconnect", "breaker"],
            rig.log.OfType<SessionStep.Do>().Select(step => step.cmd!.k).ToArray());
        var again = Table.replay(Net, RefA, Table.sessionOf(rig, Table.newSession(Net, RefA)));
        Assert.Equal(Snap(rig), Snap(again));
    }

    // 'holds relay 1 in by hand against its coil (Book I Exp 6), releases it, and replays identically'
    [Fact]
    public void Holds_relay_1_in_by_hand_releases_it_and_replays_identically()
    {
        var rig = FreshRig();
        Batch(rig, [.. Wires("A/I-EXP6").Select(Connect), PowerOn]);
        Batch(rig, [Call("relayGrab", "{\"n\":1,\"target\":1000}"), Wait(200)]);
        Assert.Equal(["no", "on", "off"], [Observable(rig, "relay1"), Observable(rig, "outLamp1"), Observable(rig, "outLamp2")]);
        Assert.True(rig.machine.Snapshot().relays[0].held);
        Batch(rig, [Call("relayRelease", "{\"n\":1}"), Wait(200)]);
        Assert.Equal(["nc", "on"], [Observable(rig, "relay1"), Observable(rig, "outLamp2")]);
        Assert.False(rig.machine.Snapshot().relays[0].held);
        Assert.Equal("bad_target", Failure(Table.callTool(rig, Call("relayGrab", "{\"n\":7,\"target\":0}"))).why);
        Assert.Equal("bad_target", Failure(Table.callTool(rig, Call("relayRelease", "{\"n\":0}"))).why);
        var again = Table.replay(Net, RefA, Table.sessionOf(rig, Table.newSession(Net, RefA)));
        Assert.Equal(Snap(rig), Snap(again));
    }

    // 'turns the dial by hand through every pad, flags the hand turn at settle, and replays identically'
    [Fact]
    public void Turns_the_dial_by_hand_through_every_pad()
    {
        var rig = FreshRig();
        var grab = Accepted(Table.runBatch(rig, [Call("dialGrab", "{\"targetUdeg\":67500000}")]));
        // Settle does not count the dial as motion, so it returns while the hand is still turning.
        Assert.NotEqual(0, grab.settle.dialMrpm);
        Assert.True(grab.settle.dialHeld);
        var turned = Accepted(Table.runBatch(rig, [Wait(500)]));
        Assert.Equal(["c0", "gap", "c1", "gap", "c2", "gap", "c3"], turned.changes.Single(change => change.name == "dial").values);
        Batch(rig, [Call("dialRelease", "{}")]);
        Assert.False(rig.machine.Snapshot().dial.held);
        Assert.Equal("bad_target", Failure(Table.callTool(rig, Call("dialGrab", "{\"targetUdeg\":360000000}"))).why);
        var again = Table.replay(Net, RefA, Table.sessionOf(rig, Table.newSession(Net, RefA)));
        Assert.Equal(Snap(rig), Snap(again));
    }

    // 'loads I-EXP4 to the same cords as connecting its wires, behind one load marker'
    [Fact]
    public void Loads_I_EXP4_to_the_same_cords_as_connecting_its_wires()
    {
        var loaded = FreshRig();
        var result = Assert.IsType<ToolResult.Ok>(Table.callTool(loaded, Load("I-EXP4", I_EXP4_WIRES)));
        Assert.Equal(I_EXP4_WIRES, result.cords!.Select(cord => cord.wire));
        var connected = FreshRig();
        foreach (var wire in I_EXP4_WIRES) Assert.True(Table.callTool(connected, Connect(wire)).ok);
        Assert.Equal(Cords(connected), Cords(loaded));
        Assert.Equal("{\"k\":\"load\",\"program\":\"I-EXP4\",\"cords\":4}", HandsJson.Step(loaded.log[0]));
        Assert.Equal(Steps(connected.log), Steps(loaded.log.Skip(1)));
        Assert.Equal("off", Observable(loaded, "power"));

        Batch(loaded, [PowerOn, Button(1, 1000), Button(2, 1000)]);
        var file = HandsJson.Session(Table.sessionOf(loaded, Table.newSession(Net, RefA)));
        var again = Table.replay(Net, RefA, Js.Parse(file));
        Assert.Equal(Steps(loaded.log), Steps(again.log));
        Assert.Equal(Snap(loaded), Snap(again));
        Assert.Equal("on", Observable(again, "outLamp2"));
    }

    // 'takes the lowest free holes after existing cords, as connect does'
    [Fact]
    public void Load_program_takes_the_lowest_free_holes_after_existing_cords()
    {
        var rig = FreshRig();
        Table.callTool(rig, Connect("1+/3A"));
        var result = Assert.IsType<ToolResult.Ok>(Table.callTool(rig, Load("I-EXP4", I_EXP4_WIRES)));
        Assert.Equal(new CordView(1, "1+#2", "1Y#1", "1+/1Y"), result.cords![0]);
    }

    // 'fails atomically when a wire cannot be placed, plugging nothing'
    [Fact]
    public void Load_program_fails_atomically_when_a_wire_cannot_be_placed()
    {
        var rig = FreshRig();
        Batch(rig, [Connect("2A/1A"), Connect("2A/1B")]);
        var cords = Cords(rig);
        var log = Steps(rig.log);
        var result = Failure(Table.callTool(rig, Load("I-EXP4", I_EXP4_WIRES)));
        Assert.Equal("hole_occupied", result.why);
        Assert.Equal("load-program I-EXP4: wire 3 (2X/2A) cannot be placed: every hole of 2A is in use " +
            "(cords 0, 1, and earlier wires of this program); nothing was plugged", result.detail);
        Assert.Equal(cords, Cords(rig));
        Assert.Equal(log, Steps(rig.log));
        // A program whose own wires overfill a terminal fails the same way.
        var self = Failure(Table.callTool(FreshRig(), Load("X1", ["1A/1B", "1A/1C", "1A/1E"])));
        Assert.Contains("wire 3 (1A/1E) cannot be placed: every hole of 1A is in use by earlier wires of this program",
            self.detail, StringComparison.Ordinal);
        Assert.Equal("unknown_terminal", Failure(Table.callTool(FreshRig(), Load("X1", ["1A/1Q"]))).why);
        Assert.Equal("bad_program", Failure(Table.callTool(FreshRig(), Load("x1", ["1A/1B"]))).why);
    }

    // 'logs the load marker only after every connect of the load was applied'
    [Fact]
    public void Logs_the_load_marker_only_after_every_connect_was_applied()
    {
        var rig = FreshRig();
        // A machine that refuses the third connect: the plan succeeds, the apply fails part way.
        var connects = 0;
        var refusing = WithMachine(rig, new Wrapped(rig.machine, apply: cmd =>
            cmd is Command.Connect && ++connects == 3 ? new CmdResult.Failure(CmdWhy.hole_occupied) : null));
        var result = Failure(Table.callTool(refusing, Load("I-EXP4", I_EXP4_WIRES)));
        Assert.Equal("hole_occupied", result.why);
        Assert.DoesNotContain(refusing.log, step => step is SessionStep.Load);

        var ok = FreshRig();
        Table.callTool(ok, Load("I-EXP4", I_EXP4_WIRES));
        Assert.Equal(["load", "do", "do", "do", "do"], ok.log.Select(step => step.k));
    }

    // 'can sit inside a batch, between other commands'
    [Fact]
    public void Load_program_can_sit_inside_a_batch()
    {
        var rig = FreshRig();
        var outcome = Table.runBatch(rig, [Slide(1, 1000), Load("I-EXP4", I_EXP4_WIRES), PowerOn]);
        Assert.True(outcome.ok);
        Assert.Equal(["do", "load", "do", "do", "do", "do", "do", "settle"], rig.log.Select(step => step.k));
    }

    // 'still loads a session file written before load-program existed': the same file text,
    // replayed from its JSON; the export's steps are the file's step lines.
    [Fact]
    public void Still_loads_a_session_written_before_load_program_existed()
    {
        var @base = Table.newSession(Net, RefA);
        string[] steps =
        [
            "{\"k\":\"do\",\"cmd\":{\"k\":\"connect\",\"cord\":0,\"a\":" + Hole + "\"1+#1\"},\"b\":" + Hole + "\"1A#1\"}}}",
            "{\"k\":\"do\",\"cmd\":{\"k\":\"connect\",\"cord\":1,\"a\":" + Hole + "\"1B#1\"},\"b\":" + Hole + "\"1-#1\"}}}",
            "{\"k\":\"do\",\"cmd\":{\"k\":\"power\",\"on\":true}}",
            "{\"k\":\"settle\",\"maxMs\":500}",
            "{\"k\":\"advance\",\"ms\":500}",
        ];
        var file = "{\n" +
            "  \"schema\": \"minivac.session/1\",\n" +
            "  \"profile\": \"MV601-REF-A\",\n" +
            "  \"contract\": \"1.1.0\",\n" +
            "  \"netlistHash\": " + Js.Quote(@base.netlistHash) + ",\n" +
            "  \"profileHash\": " + Js.Quote(@base.profileHash) + ",\n" +
            "  \"script\": [\n    " + string.Join(",\n    ", steps) + "\n  ]\n}\n";
        var rig = Table.replay(Net, RefA, Js.Parse(file));
        Assert.Equal("on", Observable(rig, "outLamp1"));
        Assert.Equal(string.Join("\n", steps), Steps(Table.sessionOf(rig, @base).script));
    }
}
