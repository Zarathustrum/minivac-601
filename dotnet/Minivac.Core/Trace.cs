using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Text;

namespace Minivac.Core;

public sealed record ObservableDef(string name, int minValue, IReadOnlyList<string> values);

public sealed class ObservableContact
{
    public bool nc { get; set; }
    public bool no { get; set; }
}

public sealed class ObservableRelay
{
    public ObservableContact set1 { get; } = new();
}

public sealed class ObservableButton
{
    public bool nc { get; set; }
    public bool no { get; set; }
}

public sealed class ObservableSwitch
{
    public (bool, bool) set1 { get; set; }
}

public sealed class ObservableDial
{
    public int? contact { get; set; }
}

public sealed class ObservableLamp
{
    public LampClass cls { get; set; }
}

public sealed class ObservableSource
{
    public bool power { get; set; }
    public bool breakerTripped { get; set; }
    public ObservableRelay[] relays { get; init; } = [];
    public ObservableButton[] buttons { get; init; } = [];
    public ObservableSwitch[] switches { get; init; } = [];
    public ObservableDial dial { get; init; } = new();
    public ObservableLamp[] outLamps { get; init; } = [];
    public ObservableLamp[] indLamps { get; init; } = [];
}

internal sealed class ChatterPage
{
    internal readonly int[] ticks = new int[Trace.CHATTER_PAGE_SIZE];
    internal int start;
    internal int end;
    internal ChatterPage? next;
}

public sealed class ChatterWorkspace
{
    internal ChatterWorkspace(Profile profile)
    {
        chatterN = checked((int)profile.v.chatter_n);
        triggerTransitions = checked(chatterN + 1);
        Array.Fill(lastTransitionTick, -1);
        for (var device = 0; device < Trace.CHATTER_DEVICE_COUNT; device++)
        {
            int cycle;
            if (device < 6) cycle = profile.derived.relayCycleTicks;
            else if (device < 12) cycle = profile.derived.buttonCycleTicks;
            else if (device < 18) cycle = profile.derived.switchCycleTicks;
            else cycle = profile.derived.dialCycleTicks;
            windowTicks[device] = checked((int)(profile.v.chatter_cycles * cycle));
            quietTicks[device] = checked((int)(profile.v.chatter_quiet_cycles * cycle));
        }
    }

    public int[] windowTicks { get; } = new int[Trace.CHATTER_DEVICE_COUNT];
    public int[] quietTicks { get; } = new int[Trace.CHATTER_DEVICE_COUNT];
    public int[] count { get; } = new int[Trace.CHATTER_DEVICE_COUNT];
    public int[] lastTransitionTick { get; } = new int[Trace.CHATTER_DEVICE_COUNT];
    public int[] lastValue { get; } = new int[Trace.CHATTER_DEVICE_COUNT];
    public byte[] suppressed { get; } = new byte[Trace.CHATTER_DEVICE_COUNT];
    public int[] allocatedPages { get; } = new int[Trace.CHATTER_DEVICE_COUNT];
    public int chatterN { get; }
    public int triggerTransitions { get; }
    internal ChatterPage?[] _headPages { get; } = new ChatterPage?[Trace.CHATTER_DEVICE_COUNT];
    internal ChatterPage?[] _tailPages { get; } = new ChatterPage?[Trace.CHATTER_DEVICE_COUNT];
    internal ChatterPage?[] _freePages { get; } = new ChatterPage?[Trace.CHATTER_DEVICE_COUNT];
    public bool initialized { get; internal set; }
    public int lastUpdateTick { get; internal set; } = -1;
}

public sealed class TraceException : Exception
{
    public TraceException(string message) : base("trace: " + message) { }
}

public static class Trace
{
    public const int OBSERVABLE_COUNT = 33;
    public const int MOVER_OBSERVABLE_START = 2;
    public const int CHATTER_DEVICE_COUNT = 19;
    internal const int CHATTER_PAGE_SIZE = 64;

    private const int INT32_MAX = int.MaxValue;
    private static readonly string[] PowerValues = ["off", "on"];
    private static readonly string[] BreakerValues = ["ok", "tripped"];
    private static readonly string[] MoverValues = ["nc", "mid", "no"];
    private static readonly string[] DialValues =
    [
        "gap", "c0", "c1", "c2", "c3", "c4", "c5", "c6", "c7",
        "c8", "c9", "c10", "c11", "c12", "c13", "c14", "c15",
    ];
    private static readonly string[] LampValues = ["off", "dim", "on"];
    private static readonly ChatterDev[] ChatterDevices =
    [
        ChatterDev.relay1, ChatterDev.relay2, ChatterDev.relay3,
        ChatterDev.relay4, ChatterDev.relay5, ChatterDev.relay6,
        ChatterDev.pb1, ChatterDev.pb2, ChatterDev.pb3,
        ChatterDev.pb4, ChatterDev.pb5, ChatterDev.pb6,
        ChatterDev.sw1, ChatterDev.sw2, ChatterDev.sw3,
        ChatterDev.sw4, ChatterDev.sw5, ChatterDev.sw6,
        ChatterDev.dial,
    ];

    public static readonly IReadOnlyList<ObservableDef> OBSERVABLES = BuildObservables();
    public static readonly IReadOnlyList<ChatterDev> CHATTER_DEVICES =
        new ReadOnlyCollection<ChatterDev>(ChatterDevices);

    private static IReadOnlyList<ObservableDef> BuildObservables()
    {
        var rows = new ObservableDef[OBSERVABLE_COUNT];
        rows[0] = Observable("power", 0, PowerValues);
        rows[1] = Observable("breaker", 0, BreakerValues);
        for (var n = 0; n < 6; n++) rows[2 + n] = Observable("relay" + F(n + 1), 0, MoverValues);
        for (var n = 0; n < 6; n++) rows[8 + n] = Observable("pb" + F(n + 1), 0, MoverValues);
        for (var n = 0; n < 6; n++) rows[14 + n] = Observable("sw" + F(n + 1), 0, MoverValues);
        rows[20] = Observable("dial", -1, DialValues);
        for (var n = 0; n < 6; n++) rows[21 + n] = Observable("outLamp" + F(n + 1), 0, LampValues);
        for (var n = 0; n < 6; n++) rows[27 + n] = Observable("indLamp" + F(n + 1), 0, LampValues);
        return new ReadOnlyCollection<ObservableDef>(rows);
    }

    private static ObservableDef Observable(string name, int minValue, string[] values) =>
        new(name, minValue, new ReadOnlyCollection<string>((string[])values.Clone()));

    public static int[] writeObservables(ObservableSource state, int[] into)
    {
        ArgumentNullException.ThrowIfNull(state);
        RequireBuffer(into);
        RequireSix(state.relays.Length, "relays");
        RequireSix(state.buttons.Length, "buttons");
        RequireSix(state.switches.Length, "switches");
        RequireSix(state.outLamps.Length, "outLamps");
        RequireSix(state.indLamps.Length, "indLamps");

        into[0] = state.power ? 1 : 0;
        into[1] = state.breakerTripped ? 1 : 0;
        for (var i = 0; i < 6; i++)
        {
            into[2 + i] = ContactEncoding(state.relays[i].set1.nc, state.relays[i].set1.no);
            into[8 + i] = ContactEncoding(state.buttons[i].nc, state.buttons[i].no);
            into[14 + i] = ContactEncoding(state.switches[i].set1.Item1, state.switches[i].set1.Item2);
            into[21 + i] = LampEncoding(state.outLamps[i].cls);
            into[27 + i] = LampEncoding(state.indLamps[i].cls);
        }
        into[20] = state.dial.contact ?? -1;
        return into;
    }

    public static int[] writeObservables(State state, int[] into)
    {
        ArgumentNullException.ThrowIfNull(state);
        RequireBuffer(into);
        RequireSix(state.relays.Length, "relays");
        RequireSix(state.buttons.Length, "buttons");
        RequireSix(state.switches.Length, "switches");
        RequireSix(state.outLamps.Length, "outLamps");
        RequireSix(state.indLamps.Length, "indLamps");

        into[0] = state.power ? 1 : 0;
        into[1] = state.breakerTripped ? 1 : 0;
        for (var i = 0; i < 6; i++)
        {
            into[2 + i] = ContactEncoding(state.relays[i].set1.nc, state.relays[i].set1.no);
            into[8 + i] = ContactEncoding(state.buttons[i].nc, state.buttons[i].no);
            into[14 + i] = ContactEncoding(state.switches[i].set1.Item1, state.switches[i].set1.Item2);
            into[21 + i] = LampEncoding(state.outLamps[i].cls);
            into[27 + i] = LampEncoding(state.indLamps[i].cls);
        }
        into[20] = state.dial.contact ?? -1;
        return into;
    }

    public static string formatMs(int tick)
    {
        RequireTick(tick);
        var text = F(tick / 10) + "." + F(tick % 10);
        return text.Length >= 8 ? text : new string(' ', 8 - text.Length) + text;
    }

    public static string formatCommand(int tick, Command command)
    {
        ArgumentNullException.ThrowIfNull(command);
        string payload;
        switch (command)
        {
            case Command.Power power:
                payload = "power " + (power.on ? "on" : "off");
                break;
            case Command.Breaker:
                payload = "breaker reset";
                break;
            case Command.Connect connect:
                payload = "connect cord=" + F(connect.cord) + " a=" + FormatEnd(connect.a) +
                    " b=" + FormatEnd(connect.b) + " r_uohm=" + F(connect.r_uohm ?? 0);
                break;
            case Command.Disconnect disconnect:
                payload = "disconnect cord=" + F(disconnect.cord);
                break;
            case Command.Button button:
                payload = "button" + F(button.n) + " target=" + F(button.target);
                break;
            case Command.Switch slide:
                payload = "switch" + F(slide.n) + " target=" + F(slide.target);
                break;
            case Command.RelayGrab relay:
                payload = "relayGrab" + F(relay.n) + " target=" + F(relay.target);
                break;
            case Command.RelayRelease relay:
                payload = "relayRelease" + F(relay.n);
                break;
            case Command.DialGrab dial:
                payload = "dialGrab targetUdeg=" + F(dial.targetUdeg);
                break;
            case Command.DialRelease:
                payload = "dialRelease";
                break;
            default:
                throw new TraceException("unknown command discriminator");
        }
        return formatMs(tick) + " > " + payload;
    }

    public static string? formatTransitions(int tick, IReadOnlyList<int> before33, IReadOnlyList<int> after33)
    {
        if (before33.Count != OBSERVABLE_COUNT || after33.Count != OBSERVABLE_COUNT)
            throw new TraceException("transition vectors must have 33 entries");
        var line = new StringBuilder();
        for (var i = 0; i < OBSERVABLE_COUNT; i++)
        {
            var before = before33[i];
            var after = after33[i];
            var beforeText = Spelling(i, before);
            var afterText = Spelling(i, after);
            if (before == after) continue;
            if (line.Length > 0) line.Append("  ");
            line.Append(OBSERVABLES[i].name).Append(' ').Append(beforeText).Append("->").Append(afterText);
        }
        return line.Length == 0 ? null : formatMs(tick) + " * " + line;
    }

    public static string formatAnomaly(int tick, TraceAnomaly anomaly)
    {
        ArgumentNullException.ThrowIfNull(anomaly);
        string payload;
        if (anomaly is TraceAnomaly.Chatter chatter)
        {
            RequirePositiveInt32(chatter.transitions, "transitions");
            payload = ChatterName(chatter.dev) + " chatter " + F(chatter.transitions) + " transitions in " +
                DurationMs(chatter.windowTicks, "windowTicks") + "ms — suppressed " +
                DurationMs(chatter.quietTicks, "quietTicks") + "ms";
        }
        else if (anomaly is TraceAnomaly.NoSettle noSettle)
        {
            payload = "no settle in " + DurationMs(noSettle.waitedTicks, "waitedTicks") + "ms";
        }
        else
        {
            throw new TraceException("unknown anomaly discriminator");
        }
        return formatMs(tick) + " ! " + payload;
    }

    public static string formatTrace(IReadOnlyList<string> lines)
    {
        ArgumentNullException.ThrowIfNull(lines);
        var output = new StringBuilder();
        for (var i = 0; i < lines.Count; i++)
        {
            var line = lines[i];
            if (line.Contains('\r')) throw new TraceException("line " + F(i) + " contains CR");
            if (line.Contains('\n')) throw new TraceException("line " + F(i) + " contains embedded LF");
            if (line.Contains('\ufeff')) throw new TraceException("line " + F(i) + " contains a BOM");
            if (line.Length > 0 && char.IsWhiteSpace(line[^1]))
                throw new TraceException("line " + F(i) + " has trailing whitespace");
            if (i > 0) output.Append('\n');
            output.Append(line);
        }
        output.Append('\n');
        return output.ToString(0, output.Length);
    }

    public static ChatterWorkspace createChatterWorkspace(Profile profile) => new(profile);

    public static void resetChatter(ChatterWorkspace workspace, IReadOnlyList<int> observables)
    {
        RequireObservableVector(observables);
        for (var device = 0; device < CHATTER_DEVICE_COUNT; device++) ClearHistory(workspace, device);
        Array.Fill(workspace.lastTransitionTick, -1);
        Array.Clear(workspace.suppressed);
        for (var device = 0; device < CHATTER_DEVICE_COUNT; device++)
            workspace.lastValue[device] = observables[MOVER_OBSERVABLE_START + device];
        workspace.initialized = true;
        workspace.lastUpdateTick = -1;
    }

    public static void reseedDialChatter(ChatterWorkspace workspace, IReadOnlyList<int> observables)
    {
        RequireObservableVector(observables);
        if (!workspace.initialized) throw new TraceException("chatter workspace must be reset before reseed");
        const int device = CHATTER_DEVICE_COUNT - 1;
        ClearHistory(workspace, device);
        workspace.lastTransitionTick[device] = -1;
        workspace.lastValue[device] = observables[MOVER_OBSERVABLE_START + device];
        workspace.suppressed[device] = 0;
    }

    public static int updateChatter(int tick, IReadOnlyList<int> observables, ChatterWorkspace workspace)
    {
        RequireTick(tick);
        RequireObservableVector(observables);
        if (!workspace.initialized) throw new TraceException("chatter workspace must be reset before update");
        if (tick < workspace.lastUpdateTick)
            throw new TraceException("chatter tick moved backward without reset");
        workspace.lastUpdateTick = tick;

        var triggerMask = 0;
        for (var device = 0; device < CHATTER_DEVICE_COUNT; device++)
        {
            var lastTick = workspace.lastTransitionTick[device];
            if (lastTick >= 0 && tick - lastTick >= workspace.quietTicks[device])
            {
                ClearHistory(workspace, device);
                workspace.lastTransitionTick[device] = -1;
                workspace.suppressed[device] = 0;
            }

            var value = observables[MOVER_OBSERVABLE_START + device];
            if (value == workspace.lastValue[device]) continue;
            workspace.lastValue[device] = value;
            workspace.lastTransitionTick[device] = tick;
            if (workspace.suppressed[device] == 1) continue;

            var cutoff = tick - workspace.windowTicks[device];
            EvictTransitions(workspace, device, cutoff);
            AppendTransition(workspace, device, tick);
            if (workspace.count[device] > workspace.chatterN)
            {
                workspace.suppressed[device] = 1;
                triggerMask |= 1 << device;
            }
        }
        return triggerMask;
    }

    private static int ContactEncoding(bool nc, bool no) => no ? 2 : nc ? 0 : 1;

    private static int LampEncoding(LampClass value) => value switch
    {
        LampClass.@on => 2,
        LampClass.dim => 1,
        _ => 0,
    };

    private static void RequireBuffer(int[] into)
    {
        if (into.Length != OBSERVABLE_COUNT)
            throw new TraceException("observable buffer must have 33 entries");
    }

    private static void RequireSix(int length, string name)
    {
        if (length != 6) throw new TraceException(name + " must have 6 entries");
    }

    private static void RequireTick(int tick, string name = "tick")
    {
        if (tick < 0) throw new TraceException(name + " must be an int32 in 0..2147483647");
    }

    private static void RequirePositiveInt32(int value, string name)
    {
        if (value < 1) throw new TraceException(name + " must be a positive int32");
    }

    private static string DurationMs(int ticks, string name)
    {
        RequirePositiveInt32(ticks, name);
        return F(ticks / 10) + "." + F(ticks % 10);
    }

    private static string FormatEnd(CordEnd end) => end switch
    {
        CordEnd.Hole hole => "hole:" + hole.hole,
        CordEnd.Touch touch => "touch:" + touch.term,
        CordEnd.Free => "free",
        _ => throw new TraceException("unknown cord end discriminator"),
    };

    private static string Spelling(int index, int value)
    {
        var row = OBSERVABLES[index];
        var at = value - row.minValue;
        if (at < 0 || at >= row.values.Count)
            throw new TraceException(row.name + " has invalid observable encoding " + F(value));
        return row.values[at];
    }

    private static string ChatterName(ChatterDev device) => device switch
    {
        ChatterDev.relay1 => "relay1", ChatterDev.relay2 => "relay2",
        ChatterDev.relay3 => "relay3", ChatterDev.relay4 => "relay4",
        ChatterDev.relay5 => "relay5", ChatterDev.relay6 => "relay6",
        ChatterDev.pb1 => "pb1", ChatterDev.pb2 => "pb2", ChatterDev.pb3 => "pb3",
        ChatterDev.pb4 => "pb4", ChatterDev.pb5 => "pb5", ChatterDev.pb6 => "pb6",
        ChatterDev.sw1 => "sw1", ChatterDev.sw2 => "sw2", ChatterDev.sw3 => "sw3",
        ChatterDev.sw4 => "sw4", ChatterDev.sw5 => "sw5", ChatterDev.sw6 => "sw6",
        ChatterDev.dial => "dial",
        _ => throw new TraceException("unknown chatter device"),
    };

    private static string F(int value) => value.ToString(CultureInfo.InvariantCulture);
    private static string F(long value) => value.ToString(CultureInfo.InvariantCulture);

    private static void RequireObservableVector(IReadOnlyList<int> observables)
    {
        if (observables.Count != OBSERVABLE_COUNT)
            throw new TraceException("chatter observable vector must have 33 entries");
    }

    private static void ReleasePage(ChatterWorkspace workspace, int device, ChatterPage page)
    {
        page.start = 0;
        page.end = 0;
        page.next = workspace._freePages[device];
        workspace._freePages[device] = page;
    }

    private static void ClearHistory(ChatterWorkspace workspace, int device)
    {
        var page = workspace._headPages[device];
        while (page is not null)
        {
            var next = page.next;
            ReleasePage(workspace, device, page);
            page = next;
        }
        workspace._headPages[device] = null;
        workspace._tailPages[device] = null;
        workspace.count[device] = 0;
    }

    private static ChatterPage AcquirePage(ChatterWorkspace workspace, int device)
    {
        var retained = workspace._freePages[device];
        if (retained is not null)
        {
            workspace._freePages[device] = retained.next;
            retained.next = null;
            return retained;
        }
        workspace.allocatedPages[device]++;
        return new ChatterPage();
    }

    private static void AppendTransition(ChatterWorkspace workspace, int device, int tick)
    {
        var tail = workspace._tailPages[device];
        if (tail is null || tail.end == CHATTER_PAGE_SIZE)
        {
            var page = AcquirePage(workspace, device);
            if (tail is null) workspace._headPages[device] = page;
            else tail.next = page;
            workspace._tailPages[device] = page;
            tail = page;
        }
        tail.ticks[tail.end++] = tick;
        workspace.count[device]++;
    }

    private static void EvictTransitions(ChatterWorkspace workspace, int device, int cutoff)
    {
        var head = workspace._headPages[device];
        while (head is not null)
        {
            while (head.start < head.end && head.ticks[head.start] <= cutoff)
            {
                head.start++;
                workspace.count[device]--;
            }
            if (head.start < head.end) break;
            var next = head.next;
            ReleasePage(workspace, device, head);
            head = next;
            workspace._headPages[device] = head;
            if (head is null) workspace._tailPages[device] = null;
        }
    }
}
