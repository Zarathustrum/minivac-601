using System;
using System.Collections.Generic;
using System.Linq;
using Xunit;
using static Minivac.Hands.Tests.Support;

namespace Minivac.Hands.Tests;

// The xunit port of test/hands/validate-batch.spec.ts. validateBatch must say what runBatch would
// say, on the live rig, without touching it. Each case validates on the live rig, then runs
// runBatch on a clone replayed from the live rig's session and compares: same ok, and for a
// rejection the same failedAt, why and detail. Outcomes compare as their JSON text.
public sealed class ValidateBatchTests
{
    private const int INT32_MAX = int.MaxValue;

    private static (Rig rig, Session @base) Build(IEnumerable<ToolCall[]> batches)
    {
        var @base = Table.newSession(Net, RefA);
        var rig = Table.replay(Net, RefA, @base);
        foreach (var calls in batches)
        {
            if (Table.runBatch(rig, calls) is BatchRejection rejection)
                throw new InvalidOperationException("setup batch failed at " + rejection.failedAt + ": " + rejection.result.detail);
        }
        return (rig, @base);
    }

    /// <summary>Everything about a rig that validateBatch must leave alone.</summary>
    private static string Picture(Rig rig) => string.Join("\n",
        Steps(rig.log), Cords(rig), string.Join(",", rig.previous), rig.watch is null ? "null" : "watch",
        Snap(rig), string.Join(",", rig.machine.Observables()));

    private static string Text(BatchRejection? verdict) => verdict is null ? "{\"ok\":true}" : HandsJson.Outcome(verdict);

    private static BatchOutcome Agrees(Rig rig, Session @base, IReadOnlyList<ToolCall> calls, int settleMs = Table.DEFAULT_SETTLE_MS, int? tick = null)
    {
        var before = Picture(rig);
        var live = new Wrapped(rig.machine, tick);
        var verdict = Table.validateBatch(WithMachine(rig, live), calls, settleMs);
        Assert.Equal(0, live.Touches);
        Assert.Equal(before, Picture(rig));

        var replayed = Table.replay(Net, RefA, Table.sessionOf(rig, @base));
        Assert.Equal(Snap(rig), Snap(replayed));
        Assert.Equal(Cords(rig), Cords(replayed));
        var outcome = Table.runBatch(WithMachine(replayed, new Wrapped(replayed.machine, tick)), calls, settleMs);
        Assert.Equal(outcome.ok ? "{\"ok\":true}" : HandsJson.Outcome(outcome), Text(verdict));
        return outcome;
    }

    private static IEnumerable<ToolCall[]> Presses(int n, int count)
    {
        for (var i = 0; i < count; i++)
        {
            yield return [Button(n, 1000)];
            yield return [Button(n, 0)];
        }
    }

    private static ToolCall[] Turn(double degrees) => [Call("dialGrab", "{\"targetUdeg\":" + Js.NumberToString(Math.Floor(degrees * 1_000_000 + 0.5)) + "}"), Wait(500)];

    private static readonly string[] OP1_WIRES = Wires("B/IV-EXP1-SLOW");
    private static readonly string[] OP2_WIRES = Wires("B/V-EXP2");
    private static readonly string[] OP3_WIRES = Wires("C1/I-EXP11");
    private static readonly string[] I_EXP4 = Wires("A/I-EXP4");

    /// <summary>The sessions test/checklist/check.spec.ts builds as each item's passing reference.</summary>
    private static readonly Dictionary<string, ToolCall[][]> Reference = new(StringComparer.Ordinal)
    {
        ["B1"] = [[Connect("1+/1A"), Connect("1B/1-"), PowerOn]],
        ["B2"] = [[Connect("1+/1Y"), Connect("1X/1A"), Connect("1B/1-"), PowerOn], [Button(1, 1000)]],
        ["B3"] = [[Connect("3+/3A"), Connect("3B/3-"), PowerOn], [UnplugPair("3+", "3A")]],
        ["B4"] = [[Connect("2+/2V"), Connect("2W/2A"), Connect("2B/2-"), PowerOn], [Slide(2, 1000)]],
        ["I-EXP4"] = [I_EXP4.Select(Connect).ToArray()],
        ["I-EXP5"] = [Wires("A/I-EXP5").Select(Connect).ToArray()],
        ["III-XOR-PB"] = [Wires("A/III-XOR-PB").Select(Connect).ToArray()],
        ["III-RELAYOR"] = [Wires("A/III-RELAYOR").Select(Connect).ToArray()],
        ["IV-EXP4"] = [Wires("A/IV-EXP4").Select(Connect).ToArray()],
        ["OP1"] = [[Load("IV-EXP1-SLOW", OP1_WIRES), PowerOn], .. Presses(6, 3)],
        ["OP1 hand-wired"] = [OP1_WIRES.Reverse().Select(wire => Connect(wire == "1G/1+" ? "1G/2+" : wire)).ToArray(), [PowerOn], .. Presses(6, 3)],
        ["OP1 press tool"] = [[Load("IV-EXP1-SLOW", OP1_WIRES), PowerOn], [Press(6)], [Press(6)], [Press(6)]],
        ["OP2"] = [[Load("V-EXP2", OP2_WIRES), PowerOn], .. Presses(1, 1), .. Presses(3, 1)],
        ["OP2 press tool"] = [[Load("V-EXP2", OP2_WIRES), PowerOn], [Press(1)], [Press(3)]],
        ["OP3"] = [[Load("I-EXP11", OP3_WIRES), PowerOn], Turn(22.5), Turn(45), [Call("dialRelease", "{}"), Wait(500)]],
    };

    /// <summary>Batches whose verdict depends on the cords in place: run on an empty panel and on each finished reference session.</summary>
    private static readonly ToolCall[][] Probes =
    [
        [UnplugAll, Unplug(0)],
        [Unplug(0), Wait(10), Unplug(0)],
        [Unplug(3)],
        [UnplugPair("1+", "1Y")],
        [UnplugPair("3+", "3A")],
        [Connect("1+/1Y"), Connect("1+/1A"), Connect("1+/3A")],
        [Load("I-EXP4", I_EXP4)],
        [UnplugAll, Load("I-EXP4", I_EXP4), PowerOn],
        [Press(1), Wait(100), Connect("6com/6com"), Connect("6com/6com"), Connect("6com/6com")],
    ];

    // 'validateBatch agrees with runBatch on the checklist reference sessions' > 'every probe on an empty panel'
    [Fact]
    public void Every_probe_on_an_empty_panel()
    {
        var (rig, @base) = Build([]);
        foreach (var probe in Probes) Agrees(rig, @base, probe);
    }

    public static TheoryData<string> ReferenceNames => [.. Reference.Keys];

    // '%s: every batch, then every probe on the finished session'
    [Theory]
    [MemberData(nameof(ReferenceNames))]
    public void Every_batch_then_every_probe_on_the_finished_session(string name)
    {
        var batches = Reference[name];
        var (rig, @base) = Build([]);
        for (var i = 0; i < batches.Length; i++)
        {
            var outcome = Agrees(rig, @base, batches[i]);
            Assert.True(outcome.ok);
            // The pane's order: validate, then run on the live rig itself.
            Assert.Equal(HandsJson.Outcome(outcome), HandsJson.Outcome(Table.runBatch(rig, batches[i])));
            if (i == batches.Length - 1)
            {
                foreach (var probe in Probes) Agrees(rig, @base, probe);
            }
        }
    }

    private sealed record Case(
        string Name,
        ToolCall[][] Setup,
        ToolCall[] Calls,
        int SettleMs,
        int? Tick,
        bool Ok,
        int FailedAt = -1,
        string Why = "",
        string? Detail = null);

    private static Case Ok(string name, ToolCall[] calls, ToolCall[][]? setup = null, int? tick = null) =>
        new(name, setup ?? [], calls, Table.DEFAULT_SETTLE_MS, tick, true);

    private static Case No(string name, ToolCall[] calls, int failedAt, string why, string? detail = null,
        ToolCall[][]? setup = null, int settleMs = Table.DEFAULT_SETTLE_MS, int? tick = null) =>
        new(name, setup ?? [], calls, settleMs, tick, false, failedAt, why, detail);

    private const int NEAR_END = INT32_MAX - 100;
    private static readonly string TICK_TEXT = "the session is at tick " + NEAR_END + "; this would pass the int32 tick limit 2147483647; start a new session";
    private static readonly ToolCall[][] I_EXP4_ON = [[.. I_EXP4.Select(Connect), PowerOn]];
    private static readonly ToolCall Q9 = Call("connect", "{\"a\":\"Q9\",\"b\":\"1A\"}");

    private static readonly Case[] Cases =
    [
        // Cord table: holes.
        No("hole_occupied: the second terminal is full", [Connect("1C/1+")], 0, "hole_occupied", "every hole of 1+ is in use (cords 0, 1)",
            setup: [[Connect("1+/1A"), Connect("1+/1B")]]),
        No("hole_occupied: the first terminal is full", [Connect("1+/1C")], 0, "hole_occupied", "every hole of 1+ is in use (cords 0, 1)",
            setup: [[Connect("1+/1A"), Connect("1+/1B")]]),
        No("hole_occupied: a self-connect with one free hole", [Connect("1A/1A")], 0, "hole_occupied",
            "connecting 1A to itself needs two free holes on 1A; only one is free (cords 0 use the rest)", setup: [[Connect("1A/1B")]]),
        No("hole_occupied: holes filled earlier in the same batch, after time", [Connect("2A/1A"), Wait(100), Connect("2A/1B"), Connect("2A/1C")],
            3, "hole_occupied", "every hole of 2A is in use (cords 0, 1)"),
        No("freed holes and ids are reused within one batch (no spurious cord_exists or hole_occupied)",
            [Unplug(0), Connect("1+/1C"), UnplugPair("1+", "1B"), Connect("1+/1E"), Connect("1+/1F")],
            4, "hole_occupied", "every hole of 1+ is in use (cords 0, 1)", setup: [[Connect("1+/1A"), Connect("1+/1B")]]),
        // Terminals.
        No("unknown_terminal on connect", [Q9], 0, "unknown_terminal", "\"Q9\" is not a terminal"),
        No("unknown_terminal on a terminal-pair disconnect", [UnplugPair("1+", "1Q")], 0, "unknown_terminal", "\"1Q\" is not a terminal", setup: I_EXP4_ON),
        No("unknown_terminal in a load-program wire", [Load("X1", ["1A/1B", "1A/1Q"])], 0, "unknown_terminal"),
        // Cords by id and by pair.
        No("unknown_cord by id", [Unplug(9)], 0, "unknown_cord", "no cord 9 is plugged in", setup: I_EXP4_ON),
        No("unknown_cord: disconnecting a pair that was unplugged", [UnplugPair("3+", "3A")], 0, "unknown_cord", "no cord runs between 3+ and 3A",
            setup: Reference["B3"]),
        No("unknown_cord: a pair unplugged earlier in the same batch", [UnplugPair("2B", "2-"), Wait(20), UnplugPair("2-", "2B")],
            2, "unknown_cord", "no cord runs between 2- and 2B", setup: I_EXP4_ON),
        No("unknown_cord after disconnect all", [UnplugAll, Unplug(2)], 1, "unknown_cord", "no cord 2 is plugged in", setup: I_EXP4_ON),
        Ok("disconnect all on an empty panel", [UnplugAll]),
        No("ambiguous_cord", [UnplugPair("1B", "1A")], 0, "ambiguous_cord", "cords 0, 1 all run between 1B and 1A; disconnect one by id",
            setup: [[Connect("1A/1B"), Connect("1B/1A")]]),
        No("bad_cord_id: id 256", [Unplug(256)], 0, "bad_cord_id", "no cord 256 is plugged in"),
        No("bad_cord_id: id -1", [Unplug(-1)], 0, "bad_cord_id"),
        No("bad_cord_id: id 1.5", [Unplug(1.5)], 0, "bad_cord_id", setup: I_EXP4_ON),
        // load-program.
        No("load-program onto occupied holes", [PowerOn, Load("I-EXP4", I_EXP4)], 1, "hole_occupied",
            "load-program I-EXP4: wire 3 (2X/2A) cannot be placed: every hole of 2A is in use (cords 0, 1, and earlier wires of this program); " +
            "nothing was plugged", setup: [[Connect("2A/1A"), Connect("2A/1B")]]),
        No("load-program over its own loaded copy", [Load("IV-EXP1-SLOW", OP1_WIRES)], 0, "hole_occupied",
            setup: [[Load("IV-EXP1-SLOW", OP1_WIRES), PowerOn]]),
        No("load-program twice in one batch, after a press", [Load("I-EXP4", I_EXP4), Press(1), Load("I-EXP4", I_EXP4), Load("I-EXP4", I_EXP4)],
            3, "hole_occupied"),
        No("bad_program: id", [Load("x1", ["1A/1B"])], 0, "bad_program", "\"x1\" is not a program id"),
        No("bad_program: no wires", [Load("X1", [])], 0, "bad_program", "program X1 needs 1..256 wires"),
        // Static targets.
        No("bad_target: button n", [Button(7, 0)], 0, "bad_target", "button needs n in 1..6 and target an integer 0..1000"),
        No("bad_target: button target", [Button(1, 1001)], 0, "bad_target"),
        No("bad_target: switch target", [Slide(1, -1)], 0, "bad_target", "switch needs n in 1..6 and target an integer 0..1000"),
        No("bad_target: relayGrab n", [Call("relayGrab", "{\"n\":0,\"target\":1000}")], 0, "bad_target",
            "relayGrab needs n in 1..6 and target an integer 0..1000"),
        No("bad_target: relayRelease n", [Call("relayRelease", "{\"n\":7}")], 0, "bad_target", "relayRelease needs n in 1..6"),
        No("bad_target: dialGrab angle", [Call("dialGrab", "{\"targetUdeg\":360000000}")], 0, "bad_target",
            "dialGrab needs targetUdeg an integer 0..359999999"),
        No("bad_target: power not a boolean", [Call("power", "{\"on\":\"yes\"}")], 0, "bad_target", "power needs on: true or false"),
        No("bad_target: breaker reset false", [Call("breaker", "{\"reset\":false}")], 0, "bad_target", "breaker needs reset: true"),
        No("bad_target: press n", [Press(7)], 0, "bad_target", "press needs n in 1..6"),
        No("bad_target: press ms 0, refused up front", [Press(1, 0)], 0, "bad_target",
            "press time must be an integer number of milliseconds in 1..60000"),
        No("bad_target: press ms 30001, refused by the press handler after up-front passes", [Button(1, 1000), Wait(10), Press(2, 30001)],
            2, "bad_target", "press time must be an integer number of milliseconds in 1..60000", setup: I_EXP4_ON),
        No("bad_target: wait 0", [Wait(0)], 0, "bad_target", "wait must be an integer number of milliseconds in 1..60000"),
        No("bad_target: wait 60001", [PowerOn, Wait(60001)], 1, "bad_target"),
        No("bad_target: wait 1.5", [Wait(1.5)], 0, "bad_target"),
        No("bad_target: settle cap 0", [PowerOn], 1, "bad_target", "settle cap must be an integer number of milliseconds in 1..60000", settleMs: 0),
        No("bad_target: settle cap 60001", [], 0, "bad_target", settleMs: 60001),
        No("the up-front time check wins over an earlier rejection", [Q9, Wait(60001)], 1, "bad_target"),
        // Machine state other than cords does not reject: breaker, held relay, held dial.
        Ok("a tripped breaker: reset, power and presses are accepted",
            [Call("breaker", "{\"reset\":true}"), PowerOn, Press(1), Unplug(0), Call("breaker", "{\"reset\":true}")],
            setup: [[Connect("1+/1-"), PowerOn]]),
        Ok("releasing a relay and the dial that are not held", [Call("relayRelease", "{\"n\":1}"), Call("dialRelease", "{}")]),
        // A reject late in a long batch, after time steps and every kind of command.
        No("a late unknown_terminal after time steps",
            [Button(1, 1000), Wait(200), Press(2), Wait(1000), Slide(3, 1000), Press(1, 50), UnplugPair("2B", "2-"), Connect("2B/2-"),
                Call("relayGrab", "{\"n\":1,\"target\":1000}"), Wait(500), Call("relayRelease", "{\"n\":1}"),
                Call("dialGrab", "{\"targetUdeg\":45000000}"), Wait(300), Call("dialRelease", "{}"), Call("state", "{}"),
                Call("connect", "{\"a\":\"1+\",\"b\":\"1Q\"}")],
            15, "unknown_terminal", "\"1Q\" is not a terminal", setup: I_EXP4_ON),
        No("a late unknown_cord after a power cycle",
            [Press(1), Call("power", "{\"on\":false}"), Wait(100), PowerOn, Press(2, 200), Unplug(3), Wait(50), Unplug(3)],
            7, "unknown_cord", "no cord 3 is plugged in", setup: I_EXP4_ON),
        Ok("a long accepted batch", [Press(1), Wait(300), UnplugPair("2B", "2-"), Connect("2-/2B"), Button(1, 1000), Button(2, 1000), Wait(200)],
            setup: I_EXP4_ON),
        // Tick limit: the text names the live tick.
        No("tick limit: the settle would pass it", [Wait(5)], 1, "bad_target", TICK_TEXT, tick: NEAR_END),
        No("tick limit: a press would pass it", [PowerOn, Press(1)], 1, "bad_target", TICK_TEXT, setup: I_EXP4_ON, tick: NEAR_END),
        No("tick limit: refused before an earlier unknown terminal", [Q9, Wait(20)], 1, "bad_target", TICK_TEXT, tick: NEAR_END),
        Ok("tick limit: exactly at the limit is accepted", [Wait(50), Wait(50)], tick: INT32_MAX - 6000),
        No("tick limit: one millisecond more is refused at the settle", [Wait(50), Wait(51)], 2, "bad_target",
            "the session is at tick " + (INT32_MAX - 6000) + "; this would pass the int32 tick limit 2147483647; start a new session",
            tick: INT32_MAX - 6000),
        No("tick limit: near it, a press then a cord rejection", [Press(1, 10), Unplug(7)], 1, "unknown_cord", setup: I_EXP4_ON, tick: INT32_MAX - 6000),
    ];

    public static TheoryData<string> CaseNames => [.. Cases.Select(row => row.Name)];

    // 'validateBatch agrees with runBatch on handcrafted batches' > '%s'
    [Theory]
    [MemberData(nameof(CaseNames))]
    public void Agrees_on_a_handcrafted_batch(string name)
    {
        var row = Cases.Single(candidate => candidate.Name == name);
        var (rig, @base) = Build(row.Setup);
        var outcome = Agrees(rig, @base, row.Calls, row.SettleMs, row.Tick);
        if (row.Ok)
        {
            Assert.True(outcome.ok);
            return;
        }
        var rejection = Assert.IsType<BatchRejection>(outcome);
        Assert.Equal(row.FailedAt, rejection.failedAt);
        Assert.Equal(row.Why, rejection.result.why);
        if (row.Detail is not null) Assert.Equal(row.Detail, rejection.result.detail);
    }

    // 'throws as runBatch does for an unknown tool, before touching the live rig'
    [Fact]
    public void Throws_as_runBatch_does_for_an_unknown_tool()
    {
        var (rig, @base) = Build(I_EXP4_ON);
        var before = Picture(rig);
        ToolCall[] calls = [PowerOn, Call("nope", "{}")];
        var live = new Wrapped(rig.machine);
        Assert.Equal("hands: no tool \"nope\"", Assert.Throws<HandsError>(() => Table.validateBatch(WithMachine(rig, live), calls)).Message);
        Assert.Equal(0, live.Touches);
        Assert.Equal(before, Picture(rig));
        Assert.Equal("hands: no tool \"nope\"",
            Assert.Throws<HandsError>(() => Table.runBatch(Table.replay(Net, RefA, Table.sessionOf(rig, @base)), calls)).Message);
    }
}
