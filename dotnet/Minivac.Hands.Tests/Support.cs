using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using Minivac.Conformance;
using Minivac.Core;

namespace Minivac.Hands.Tests;

/// <summary>Shared fixtures for the hands port tests: the repo data and the call builders the TS specs use.</summary>
internal static class Support
{
    public static readonly string Root = FindRepositoryRoot();
    private static readonly FileSystemSource Source = new(Root);
    public static readonly LoadedNetlist Net = Core.Netlist.LoadNetlist(Source.ReadAllBytes("data/netlist.json"));
    public static readonly Profile RefA = LoadProfile("MV601-REF-A");
    public static readonly Profile Ideal = LoadProfile("MV601-IDEAL");

    private static Profile LoadProfile(string id)
    {
        using var document = JsonDocument.Parse(Source.ReadAllBytes("data/profiles/" + id + ".json"));
        return Profile.LoadProfile(document.RootElement);
    }

    private static string FindRepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "data", "netlist.json")) &&
                Directory.Exists(Path.Combine(directory.FullName, "test", "conformance")))
            {
                return directory.FullName;
            }
        }
        throw new InvalidOperationException("cannot locate the repository root");
    }

    /// <summary>A conformance fixture's `wires` (path relative to test/conformance/fixtures/, no suffix).</summary>
    public static string[] Wires(string path) => [.. Fixture(path).GetProperty("wires").EnumerateArray().Select(w => w.GetString()!)];

    public static JsonElement Fixture(string path) =>
        Js.Parse(File.ReadAllText(Path.Combine(Root, "test", "conformance", "fixtures", path + ".fixture.json"), Encoding.UTF8));

    public static Rig FreshRig() => Table.replay(Net, RefA, Table.newSession(Net, RefA));

    public static ToolCall Call(string name, string args) => ToolCall.Of(name, args);

    public static ToolCall Connect(string text)
    {
        var wire = Table.parseWire(text, out var bad) ?? throw new InvalidOperationException("bad wire " + text + ": " + bad!.detail);
        return Call("connect", "{\"a\":" + Js.Quote(wire.a) + ",\"b\":" + Js.Quote(wire.b) + "}");
    }

    public static readonly ToolCall PowerOn = Call("power", "{\"on\":true}");

    public static ToolCall Button(double n, double target) => Call("button", "{\"n\":" + N(n) + ",\"target\":" + N(target) + "}");
    public static ToolCall Slide(double n, double target) => Call("switch", "{\"n\":" + N(n) + ",\"target\":" + N(target) + "}");
    public static ToolCall Press(double n, double? ms = null) =>
        Call("press", ms is null ? "{\"n\":" + N(n) + "}" : "{\"n\":" + N(n) + ",\"ms\":" + N(ms.Value) + "}");
    public static ToolCall Wait(double ms) => Call("wait", "{\"ms\":" + N(ms) + "}");
    public static ToolCall Unplug(double cord) => Call("disconnect", "{\"cord\":" + N(cord) + "}");
    public static ToolCall UnplugPair(string a, string b) => Call("disconnect", "{\"a\":" + Js.Quote(a) + ",\"b\":" + Js.Quote(b) + "}");
    public static readonly ToolCall UnplugAll = Call("disconnect", "{\"all\":true}");

    public static ToolCall Load(string program, IEnumerable<string> wires)
    {
        var list = new List<string>();
        foreach (var wire in wires) list.Add(Js.Quote(wire));
        return Call("loadProgram", "{\"program\":" + Js.Quote(program) + ",\"wires\":[" + string.Join(",", list) + "]}");
    }

    private static string N(double value) => Js.NumberToString(value);

    public static void Batch(Rig rig, IReadOnlyList<ToolCall> calls, int settleMs = Table.DEFAULT_SETTLE_MS)
    {
        var outcome = Table.runBatch(rig, calls, settleMs);
        if (outcome is BatchRejection rejection)
            throw new InvalidOperationException("batch failed at " + rejection.failedAt + ": " + rejection.result.detail);
    }

    public static ToolResult.Fail Failure(ToolResult result) =>
        result as ToolResult.Fail ?? throw new InvalidOperationException("expected a rejection");

    public static BatchOutcome.Accepted Accepted(BatchOutcome outcome) =>
        outcome as BatchOutcome.Accepted ?? throw new InvalidOperationException("batch failed");

    public static string Observable(Rig rig, string name)
    {
        for (var i = 0; i < Trace.OBSERVABLE_COUNT; i++)
        {
            if (Trace.OBSERVABLES[i].name == name) return Table.observableText(i, rig.machine.Observables()[i]);
        }
        throw new ArgumentException("no observable " + name);
    }

    public static string Snap(Rig rig) => HandsJson.Snapshot(rig.machine.Snapshot());

    public static string Steps(IEnumerable<SessionStep> steps)
    {
        var lines = new List<string>();
        foreach (var step in steps) lines.Add(HandsJson.Step(step));
        return string.Join("\n", lines);
    }

    public static string Cords(Rig rig) => HandsJson.Cords(rig.cords);

    public static Rig WithMachine(Rig rig, Machine machine) => new(machine, rig.netlist, rig.profile, rig.previous, rig.cords, rig.log);
}

/// <summary>
/// The TS specs' Proxy over a machine: counts the calls that could change it, can report another
/// tick, and can refuse a chosen connect.
/// </summary>
internal sealed class Wrapped : Machine
{
    private readonly Machine _real;
    private readonly int? _tick;
    private readonly Func<Command, CmdResult?>? _apply;

    public Wrapped(Machine real, int? tick = null, Func<Command, CmdResult?>? apply = null)
    {
        _real = real;
        _tick = tick;
        _apply = apply;
    }

    public int Touches { get; private set; }
    public long Advanced { get; private set; }

    public CmdResult Apply(Command c)
    {
        Touches++;
        return _apply?.Invoke(c) ?? _real.Apply(c);
    }

    public void Advance(int ticks)
    {
        Touches++;
        Advanced += ticks;
        _real.Advance(ticks);
    }

    public State Snapshot() => _tick is null ? _real.Snapshot() : _real.Snapshot() with { tick = _tick.Value };
    public int[] Observables() => _real.Observables();
    public int MotionMask() => _real.MotionMask();

    public Event[] DrainEvents()
    {
        Touches++;
        return _real.DrainEvents();
    }
}
